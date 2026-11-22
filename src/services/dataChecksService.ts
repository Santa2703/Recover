/**
 * Data checks (/audit?tab=checks): one data model feeds every page, so its numbers must reconcile.
 * Each check recomputes something from the live mock services (cases, decision engine, analytics,
 * exceptions, MCP gate, audit chain, governance settings) and compares it with what a page shows.
 * Mirrors the important checks in scripts/check-decisions.mjs, browser side. Nothing is faked:
 * a failing check means the data genuinely disagrees.
 */
import type { RouteValue } from '@/models/decision.model';
import { caseStore, meta } from './mock/stores';
import { delay, sum } from './mock/mockUtils';
import * as ds from './decisionService';
import { ruleMatches } from './decision/engine';
import { computeSummary } from './metricsService';
import { exceptionService } from './exceptionService';
import { caseService } from './caseService';
import { computePipeline, computePools, computeRouteMix, computeWaterfall } from './analyticsService';
import { auditService, type AuditEntry } from './auditService';
import { mcpService } from './mcpService';
import { currentThresholds } from './governanceService';
import { autonomyViolations } from './agentControlsService';

export type CheckOwner = 'Platform' | 'Finance' | 'Decision Services';
export interface DataCheckResult {
  id: string;
  name: string;
  /** What was measured, with the value. */
  measured: string;
  pass: boolean;
  owner: CheckOwner;
  /** How the check is computed, in plain words. */
  explain: string;
  /** Up to a few offending ids when the check fails. */
  failures: string[];
}
export interface DataCheckRun {
  ranAt: string;
  durationMs: number;
  results: DataCheckResult[];
  passing: number;
  failing: number;
}

const usd = ds.usd;
const TENANTS = ['All', ...meta.tenants];
const plural = (n: number, w: string, p = `${w}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? w : p}`;
const first = (ids: string[]) => ids.slice(0, 5);

function dupes(values: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  values.forEach((v) => (seen.has(v) ? out.add(v) : seen.add(v)));
  return [...out];
}

/** value lines − cost lines − holding, and the stored gross / cost / holding equal their line sums. */
function routeTermsMismatch(r: RouteValue): boolean {
  const value = sum(r.lines.filter((l) => l.type === 'value').map((l) => l.amount));
  const cost = sum(r.lines.filter((l) => l.type === 'cost').map((l) => l.amount));
  const time = sum(r.lines.filter((l) => l.type === 'time').map((l) => l.amount));
  if (!r.viable) return r.net !== 0;
  return r.gross !== value || r.cost !== cost || r.holding !== time || r.net !== value - cost - time;
}

type Check = Omit<DataCheckResult, 'failures'> & { failures?: string[] };

async function computeChecks(): Promise<DataCheckResult[]> {
  const cases = caseStore.all();
  const open = ds.openDecisions();
  const out: Check[] = [];

  /* ---------------- Platform: identity of records ---------------- */
  {
    const d = dupes(cases.map((c) => c.id));
    const ids = cases.map((c) => c.id).sort();
    out.push({
      id: 'case-ids-unique',
      name: 'Return case IDs are unique',
      measured: `${plural(cases.length, 'case')} · ${ids[0]}…${ids[ids.length - 1]} · ${plural(d.length, 'duplicate')}`,
      pass: d.length === 0,
      owner: 'Platform',
      explain: 'Every case id in the case store appears once, so a link, approval or audit line can never point at two returns.',
      failures: first(d),
    });
  }
  {
    const d = [...dupes(cases.map((c) => c.assetTag)), ...dupes(cases.map((c) => c.serialNumber))];
    out.push({
      id: 'asset-ids-unique',
      name: 'Asset tags and serial numbers are unique',
      measured: `${plural(cases.length, 'asset tag')} · ${plural(d.length, 'duplicate')}`,
      pass: d.length === 0,
      owner: 'Platform',
      explain: 'Asset tags and serial numbers identify the physical asset in EAM and WMS. A duplicate would merge two assets.',
      failures: first(d),
    });
  }
  {
    const bad = cases.filter((c) => !meta.tenants.includes(c.tenant) || !meta.sites.includes(c.location)).map((c) => c.id);
    out.push({
      id: 'case-scope-known',
      name: 'Every case belongs to a known customer and site',
      measured: `${meta.tenants.length} customers · ${meta.sites.length} sites · ${plural(bad.length, 'unknown')}`,
      pass: bad.length === 0,
      owner: 'Platform',
      explain: 'Tenant and site scope every page. A case outside the known customers or sites would vanish from scoped views and break cross-tenant isolation.',
      failures: first(bad),
    });
  }

  /* ---------------- Finance: route economics ---------------- */
  {
    let routes = 0;
    const bad: string[] = [];
    open.forEach(({ case: c, decision }) =>
      decision.all.forEach((r) => {
        routes += 1;
        if (routeTermsMismatch(r)) bad.push(`${c.id} ${r.route}`);
      }),
    );
    out.push({
      id: 'route-net-terms',
      name: 'Every route net equals the sum of its cost terms',
      measured: `${plural(routes, 'route')} on ${plural(open.length, 'open case')} · ${plural(bad.length, 'mismatch', 'mismatches')}`,
      pass: bad.length === 0,
      owner: 'Finance',
      explain: 'For every route of every open case: net = Σ value lines − Σ cost lines − holding cost, and the stored gross, cost and holding equal their line sums. Non-viable routes carry a net of 0.',
      failures: first(bad),
    });
  }
  {
    const listed = (await caseService.list({ pageSize: 10000 })).items;
    const openListed = sum(listed.filter((c) => !['approved', 'handed_off'].includes(c.stage)).map((c) => c.estimatedNetRecovery));
    const openNet = sum(open.map((r) => r.decision.best.net));
    const mismatched = open.filter(({ case: c, decision }) => c.recommendedRoute !== decision.best.route || c.estimatedNetRecovery !== decision.best.net).map((r) => r.case.id);
    out.push({
      id: 'case-list-engine',
      name: 'Case list net equals the decision engine',
      measured: `${usd(openListed)} listed · ${usd(openNet)} engine · ${plural(mismatched.length, 'case')} differ`,
      pass: openListed === openNet && mismatched.length === 0,
      owner: 'Finance',
      explain: 'The recommended route and net on each open case (Returned assets, Case page) must equal the queue plan’s best route and net for that case.',
      failures: first(mismatched),
    });
  }
  {
    const bad: string[] = [];
    for (const tenant of TENANTS) {
      const scope = { tenant };
      const kf = computeSummary(scope).potentialRecovery;
      const how = ds.howCalculated('potentialRecovery', scope).value;
      if (kf !== how) bad.push(`${tenant}: ${usd(kf)} vs ${usd(how)}`);
    }
    out.push({
      id: 'kf-potential-how',
      name: 'Potential recovery on Key figures equals How calculated',
      measured: `${usd(computeSummary({}).potentialRecovery)} · ${TENANTS.length} scopes compared`,
      pass: bad.length === 0,
      owner: 'Finance',
      explain: 'Key figures (metricsService) and the “How calculated” drawer (decisionService.howCalculated) must give the same potential recovery for All and each customer.',
      failures: bad,
    });
  }
  {
    const bad: string[] = [];
    for (const tenant of TENANTS) {
      const scope = { tenant };
      const kf = computeSummary(scope).valueAtRisk;
      const how = ds.howCalculated('valueAtRisk', scope).value;
      const ex = (await exceptionService.summary(tenant === 'All' ? undefined : scope)).valueAtRisk;
      if (kf !== how || kf !== ex) bad.push(`${tenant}: KF ${usd(kf)} · How ${usd(how)} · Exceptions ${usd(ex)}`);
    }
    out.push({
      id: 'value-at-risk',
      name: 'Value at risk agrees on Key figures, How calculated and Exceptions',
      measured: `${usd(computeSummary({}).valueAtRisk)} · ${TENANTS.length} scopes compared`,
      pass: bad.length === 0,
      owner: 'Finance',
      explain: 'Value at risk is computed per case (net × exposure share of its risk reason). Key figures, the How calculated drawer and the Exceptions total must agree for every scope.',
      failures: bad,
    });
  }
  {
    const s = await exceptionService.summary();
    const byWh = sum(s.byWarehouse.map((w) => w.value));
    out.push({
      id: 'exceptions-by-warehouse',
      name: 'Exception value by warehouse equals the ranked total',
      measured: `${usd(byWh)} in ${plural(s.byWarehouse.length, 'warehouse')} · total ${usd(s.valueAtRisk)}`,
      pass: byWh === s.valueAtRisk && sum(s.byWarehouse.map((w) => w.count)) === s.open,
      owner: 'Finance',
      explain: 'On Exceptions, the value and count split by warehouse must add up to the headline value at risk and open count. An exception filed under an unknown warehouse would drop out of the split.',
    });
  }
  {
    const hist = ds.listHistory({ pageSize: 100000 }).items;
    const bad = hist.filter((h) => h.gain !== h.forecastNet - h.standardNet || h.realisedGain !== h.realisedNet - h.standardNet).map((h) => h.id);
    out.push({
      id: 'history-gain',
      name: 'Closed-decision gains equal forecast or actual minus the standard route',
      measured: `${plural(hist.length, 'closed decision')} · ${plural(bad.length, 'mismatch', 'mismatches')}`,
      pass: bad.length === 0 && hist.length > 0,
      owner: 'Finance',
      explain: 'For every closed decision: gain = forecast net − standard-route net, and realised gain = actual net − standard-route net. Forecast accuracy and the learning pages read these.',
      failures: first(bad),
    });
  }

  /* ---------------- Decision Services: gates ---------------- */
  {
    const gaps = (await auditService.listGaps()).items;
    const gapCases = new Set(gaps.map((g) => g.caseId));
    const waiting = open.filter((r) => r.case.stage === 'awaiting_approval');
    const bad = waiting
      .filter(({ case: c, decision }) => !decision.best.viable || c.blockedReason !== null || gapCases.has(c.id) || c.stage === 'no_viable_route')
      .map((r) => r.case.id);
    out.push({
      id: 'approvable-gates',
      name: 'No approvable recommendation where a gate failed or evidence is missing',
      measured: `${plural(waiting.length, 'decision')} awaiting approval · ${plural(bad.length, 'violation')}`,
      pass: bad.length === 0,
      owner: 'Decision Services',
      explain: 'A case can only sit in “Awaiting approval” when its recommended route is viable (every gate passed), it is not blocked, and it has no open evidence gap.',
      failures: first(bad),
    });
  }
  {
    const rules = ds.getPublishedRules().rules.filter((r) => r.active && r.action === 'exclude');
    const bad = open
      .filter(({ case: c, decision }) => !decision.override && rules.some((r) => r.route === decision.best.route && ruleMatches(r, c, ds.caseContext(c))))
      .map((r) => r.case.id);
    out.push({
      id: 'excluded-route',
      name: 'No excluded route is ever recommended',
      measured: `${plural(rules.length, 'exclude rule')} · ${plural(open.length, 'open decision')} · ${plural(bad.length, 'violation')}`,
      pass: bad.length === 0,
      owner: 'Decision Services',
      explain: 'For each published “exclude” business rule (e.g. BR-01), no open case it applies to may be recommended the excluded route.',
      failures: first(bad),
    });
  }
  {
    const bad = open
      .filter(({ case: c, decision }) => decision.best.viable && ((decision.best.route === 'relase' && ['D', 'Scrap'].includes(c.condition)) || (decision.best.usesSlot && !decision.best.committed)))
      .map((r) => r.case.id);
    out.push({
      id: 'guardrails',
      name: 'Locked guardrails hold on every recommendation (GR-01, GR-02)',
      measured: `${plural(open.length, 'open decision')} · ${plural(bad.length, 'violation')}`,
      pass: bad.length === 0,
      owner: 'Decision Services',
      explain: 'Grade D and scrap are never re-leased (GR-01), and a refurbishment slot is only used against a named lease or sales order (GR-02).',
      failures: first(bad),
    });
  }
  {
    const hist = ds.listHistory({ pageSize: 100000 }).items;
    const histOverrides = hist.filter((h) => h.overridden);
    const live = ds.getOverrides();
    const bad = [...histOverrides.filter((h) => !h.overrideReason).map((h) => h.id), ...live.filter((o) => !o.reason).map((o) => o.caseId)];
    const rate = hist.length ? histOverrides.length / hist.length : 0;
    out.push({
      id: 'override-reason',
      name: 'Every override has a reason',
      measured: `${plural(histOverrides.length + live.length, 'override')} · ${(rate * 100).toFixed(1)}% of closed decisions · ${plural(bad.length, 'without a reason', 'without a reason')}`,
      pass: bad.length === 0,
      owner: 'Decision Services',
      explain: 'Owner overrides on closed decisions and live overrides on open cases must each carry one of the override reasons, so the learning loop can use them.',
      failures: first(bad),
    });
  }
  {
    const plan = ds.planQueue();
    const ids = Object.values(plan.assignments).flatMap((a) => a.demandIds);
    const d = dupes(ids);
    const used = plan.refurbSlotsUsed;
    out.push({
      id: 'plan-demand-once',
      name: 'Queue plan gives each demand record to one case',
      measured: `${plural(ids.length, 'demand line')} assigned · ${used} of ${plan.refurbSlots} refurbishment slots · ${plural(d.length, 'duplicate')}`,
      pass: d.length === 0 && used <= plan.refurbSlots,
      owner: 'Decision Services',
      explain: 'In the queue plan every named demand record (lease order, sales order, bid, repair order) goes to at most one case, and refurbishment never exceeds its slots.',
      failures: first(d),
    });
  }
  {
    const held = cases.flatMap((c) => (c.demandIds ?? []).map((id) => `${id}`));
    const d = dupes(held);
    out.push({
      id: 'demand-held-once',
      name: 'No unit or demand line is allocated twice across cases',
      measured: `${plural(held.length, 'demand line')} held by ${plural(cases.filter((c) => c.demandIds?.length).length, 'case')} · ${plural(d.length, 'duplicate')}`,
      pass: d.length === 0,
      owner: 'Platform',
      explain: 'Across every case (open, approved and handed off) a demand record appears on one case only; approving a case freezes its demand so the plan cannot re-offer it.',
      failures: first(d),
    });
  }
  {
    const pools = computePools();
    const bad = pools.pools.filter((p) => p.allocated > p.available || p.allocated > p.demand || p.allocatedRedeploy > p.internalDemand || p.allocatedResale > p.externalDemand).map((p) => p.name);
    out.push({
      id: 'pool-allocation',
      name: 'Pool allocation never allocates a unit twice',
      measured: `${plural(pools.pools.length, 'pool')} · ${pools.kpis.allocated} of ${pools.kpis.available} units allocated · optimal ${usd(pools.kpis.optimalValue)} vs greedy ${usd(pools.kpis.greedyValue)}`,
      pass: bad.length === 0 && pools.kpis.allocated === sum(pools.pools.map((p) => p.allocated)),
      owner: 'Platform',
      explain: 'In each portfolio pool, allocated units never exceed the units available or the demand, redeploy never exceeds internal demand and resale never exceeds external demand.',
      failures: first(bad),
    });
  }

  /* ---------------- Platform: analytics reconcile with case rows ---------------- */
  {
    const s = computeSummary({});
    const routeTotal = sum(s.routeOpportunity.map((r) => r.value));
    const caseTotal = sum(cases.map((c) => c.estimatedNetRecovery));
    const routeCount = sum(s.routeOpportunity.map((r) => r.count));
    out.push({
      id: 'analytics-total',
      name: 'Analytics total equals the sum of case rows',
      measured: `${usd(routeTotal)} by route · ${usd(caseTotal)} over ${plural(cases.length, 'case')}`,
      pass: routeTotal === caseTotal && routeCount === cases.length,
      owner: 'Platform',
      explain: 'The route opportunity chart (value and count by recommended route) must add up to the estimated net recovery and number of every case row.',
    });
  }
  {
    const s = computeSummary({});
    const life = sum(s.lifecycle.map((l) => l.count));
    out.push({
      id: 'lifecycle-total',
      name: 'Lifecycle stage counts sum to assets in scope',
      measured: `${life} in stages · ${s.assetsInScope} assets`,
      pass: life === s.assetsInScope,
      owner: 'Platform',
      explain: 'Each case is in exactly one lifecycle stage, so the stage counts on Key figures add up to the assets in scope.',
    });
  }
  {
    const p = computePipeline({});
    const live = sum(p.stages.filter((st) => st.id !== 'reconciled').map((st) => st.current));
    out.push({
      id: 'pipeline-total',
      name: 'Pipeline stages account for every live case',
      measured: `${live} in funnel stages · ${p.kpis.inPipeline} in pipeline · ${p.kpis.reconciled} reconciled`,
      pass: live === p.kpis.inPipeline,
      owner: 'Platform',
      explain: 'The pipeline funnel maps every live case stage to one funnel stage. The live counts per stage must add up to the cases in the pipeline.',
    });
  }
  {
    const rm = computeRouteMix(12);
    const counted = sum(rm.routes.map((r) => r.decisions));
    const shares = rm.months.map((m) => sum(meta.routes.map((r) => m[r.id] ?? 0)));
    out.push({
      id: 'route-mix-total',
      name: 'Route counts sum to the reconciled total',
      measured: `${counted.toLocaleString('en-US')} by route · ${rm.kpis.decisionsClosed.toLocaleString('en-US')} closed`,
      pass: counted === rm.kpis.decisionsClosed && shares.every((s) => s === 100),
      owner: 'Decision Services',
      explain: 'On Route mix, the decisions per route over 12 months must add up to the decisions closed, and each month’s route shares must add up to 100%.',
    });
  }
  {
    const wf = computeWaterfall(12);
    const steps = sum(wf.steps.map((s) => s.value));
    out.push({
      id: 'waterfall-total',
      name: 'Value waterfall lands on net recovery',
      measured: `${usd(steps)} in ${plural(wf.steps.length, 'step')} · net recovery ${usd(wf.netRecovery)}`,
      pass: steps === wf.netRecovery,
      owner: 'Finance',
      explain: 'The recovery waterfall splits actual recovery across route groups; its steps must add up exactly to net recovery for the period.',
    });
  }

  /* ---------------- Platform: controls ---------------- */
  {
    const g = mcpService.writeGateCheck();
    out.push({
      id: 'write-gate',
      name: 'Nothing is sent to an enterprise system without an approval',
      measured: `${plural(g.writes, 'gated write')} sent · ${plural(g.unapproved.length, 'without approval', 'without approval')}`,
      pass: g.unapproved.length === 0,
      owner: 'Platform',
      explain: 'Every write-gated MCP tool call that reached a system (SAP, Maximo, WMS, Salesforce, Machinio) must have been approved at the write gate by a named person.',
      failures: first(g.unapproved),
    });
  }
  {
    // Follow the links, not the timestamps: several entries can share a second.
    const all: AuditEntry[] = (await auditService.list({ pageSize: 1000000 })).items;
    const hashes = new Set(all.map((e) => e.hash));
    const roots = all.filter((e) => !hashes.has(e.prevHash)).map((e) => e.id);
    const forks = dupes(all.map((e) => e.prevHash));
    const forkIds = all.filter((e) => forks.includes(e.prevHash)).map((e) => e.id);
    const dIds = dupes(all.map((e) => e.id));
    const broken = [...roots.slice(1), ...forkIds, ...dIds];
    out.push({
      id: 'audit-chain',
      name: 'Audit log hash chain is unbroken',
      measured: `${plural(all.length, 'entry', 'entries')} · ${plural(Math.max(0, roots.length - 1) + forks.length, 'broken link')}`,
      pass: roots.length <= 1 && forks.length === 0 && dIds.length === 0,
      owner: 'Platform',
      explain:
        'Every audit entry’s previous hash must be the hash of another entry (only the first entry starts the chain), no two entries may point at the same previous entry, and ids are unique. A break means an entry was edited, removed or inserted out of order.',
      failures: first(broken),
    });
  }
  {
    const t = currentThresholds();
    const bad = autonomyViolations();
    const ok = t.autoApproveBelow <= t.level2Above && t.level2Above <= t.delegationLimit && t.plannerLimit <= t.delegationLimit && bad.length === 0;
    out.push({
      id: 'governance-settings',
      name: 'Approval limits rise and agent autonomy stays within its caps',
      measured: `${usd(t.autoApproveBelow)} ≤ ${usd(t.level2Above)} ≤ ${usd(t.delegationLimit)} · Planner ${usd(t.plannerLimit)} · ${plural(bad.length, 'cell')} above cap`,
      pass: ok,
      owner: 'Platform',
      explain: 'Auto-approve ≤ level 2 sign-off ≤ Approver delegation limit, the Planner limit is not above the Approver’s, and no autonomy cell is set above its action type’s cap.',
      failures: bad.map((b) => `${b.role} · ${b.action}`).slice(0, 5),
    });
  }

  return out.map((c) => ({ ...c, failures: c.failures ?? [] }));
}

/* ------------------------------------------------------------------ */

let lastRun: DataCheckRun | null = null;
let running: Promise<DataCheckRun> | null = null;
const listeners = new Set<() => void>();

async function run(): Promise<DataCheckRun> {
  const t0 = Date.now();
  const results = await computeChecks();
  const passing = results.filter((r) => r.pass).length;
  lastRun = { ranAt: new Date().toISOString(), durationMs: Date.now() - t0, results, passing, failing: results.length - passing };
  return lastRun;
}

export const dataChecksService = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** The last run; runs the checks on first load. */
  async latest(): Promise<DataCheckRun> {
    if (lastRun) {
      await delay(120);
      return lastRun;
    }
    running ??= run().finally(() => (running = null));
    const [r] = await Promise.all([running, delay(300)]);
    return r;
  },
  /** Re-runs every check now and notifies the page. */
  async rerun(): Promise<DataCheckRun> {
    const [r] = await Promise.all([run(), delay(500)]);
    listeners.forEach((l) => l());
    return r;
  },
  /** Runs the checks without notifying (scripts). */
  run,
};
