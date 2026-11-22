/**
 * Read models for the Dashboard, Key Figures and Integration health pages.
 * Every figure is derived from the same stores the tables use (via metricsService,
 * taskService, sourceService, workflowService and mcpService), so the pages agree.
 */
import type { CaseRecord, CaseStageId, Priority } from '@/models/domain.model';
import type { UserRole } from '@/models/user.model';
import { caseStore, meta, taskStore } from './mock/stores';
import { sum } from './mock/mockUtils';
import { scopeCases } from './caseService';
import { metricsService, fmtK, type PortfolioSummary, type Scope } from './metricsService';
import { taskService, TASK_TYPE_LABEL, type TaskRow } from './taskService';
import { sourceService, type SourceSummary } from './sourceService';
import { workflowService, type Workflow } from './workflowService';
import { mcpService, type McpCallRow } from './mcpService';
import { summary as decisionSummary } from './decisionService';
import type { DecisionSummary, KpiKey } from '@/models/decision.model';

const AS_OF_MS = Date.parse(meta.asOf);
const DAY = 864e5;

/** "As of 20 Nov 2026, 09:00 UTC" */
export function asOfLabel(iso: string = meta.asOf): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `As of ${date}, ${time} UTC`;
}

/** "12 min ago" relative to the dataset clock. */
export function ago(iso: string, now: number = AS_OF_MS): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 6e4));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const formatMoney = fmtK;

// ---------------------------------------------------------------- Key Figures

export type ComparePeriod = 7 | 14 | 30;

export interface WindowFigures {
  awaiting: number;
  potentialRecovery: number;
  valueAtRisk: number;
}

export interface KeyFigures {
  portfolio: PortfolioSummary;
  periodDays: ComparePeriod;
  /** Cases received in the last `periodDays` days … */
  current: WindowFigures;
  /** … and in the `periodDays` days before (the change shown on each KPI). */
  prior: WindowFigures;
  integration: { healthPct: number; priorPct: number; attention: number; failed: number; total: number };
}

function scoped(scope: Scope): CaseRecord[] {
  let cases = scopeCases(caseStore.all(), scope);
  if (scope.route && scope.route !== 'all') cases = cases.filter((c) => c.recommendedRoute === scope.route);
  if (scope.productClass && scope.productClass !== 'all') cases = cases.filter((c) => c.productClass === scope.productClass);
  return cases;
}

/** Figures for the cases received in one window (used to compare the last N days with the N days before). */
function windowFigures(scope: Scope, fromMs: number, toMs: number) {
  const cases = scoped(scope).filter((c) => {
    const t = Date.parse(c.receivedDate);
    return t > fromMs && t <= toMs;
  });
  return {
    awaiting: cases.filter((c) => c.stage === 'awaiting_approval').length,
    potentialRecovery: sum(cases.filter((c) => c.stage !== 'handed_off').map((c) => c.estimatedNetRecovery)),
    valueAtRisk: sum(cases.map((c) => c.valueAtRisk)),
  };
}

/** Window the Dashboard KPI strip trends compare (last N days vs the N days before). */
export const STRIP_PERIOD_DAYS = 14;

export interface StripFigure {
  id: string;
  label: string;
  value: number;
  /** Cases in this state received in the last 14 days … */
  now: number;
  /** … and in the 14 days before. */
  prior: number;
  upIsGood: boolean;
  money?: boolean;
  note: string;
  href: string;
  /** decisionService.howCalculated key explaining this figure, when there is one. */
  kpi?: KpiKey;
}

export interface AttentionItem {
  id: string;
  productName: string;
  priority: Priority;
  stage: CaseStageId;
  issue: string;
  impact: number;
  impactKind: 'at risk' | 'recovery';
  dueDate: string;
  dueInDays: number;
  exceptionId?: string;
}

const STAGE_ISSUE: Record<CaseStageId, string> = {
  awaiting_inspection: 'Waiting for inspection and condition grade',
  needs_information: 'Evidence missing before the case can be routed',
  ready_for_decision: 'Decision prepared; the Planner reviews and sends it to the approver',
  awaiting_approval: 'Decision waiting for approval',
  approved: 'Approved; hand-off instruction not yet sent',
  handed_off: 'Handed off; awaiting outcome',
  reevaluate: 'Decision declined; re-evaluate and resubmit',
  no_viable_route: 'No viable route found',
};

function issueOf(c: CaseRecord): string {
  if (c.blockedReason) return c.blockedReason;
  const reason = c.riskReason ? meta.riskReasons.find((r) => r.id === c.riskReason)?.label : undefined;
  return reason ? `${reason}: ${STAGE_ISSUE[c.stage].toLowerCase()}` : STAGE_ISSUE[c.stage];
}

export interface FilterOptions {
  tenants: string[];
  sites: string[];
  routes: { id: string; label: string }[];
  assetClasses: { id: string; label: string }[];
}

export const dashboardService = {
  subscribe(listener: () => void) {
    const offs = [metricsService.subscribe(listener), taskStore.subscribe(listener), sourceService.subscribe(listener)];
    return () => offs.forEach((o) => o());
  },
  subscribeTechnical(listener: () => void) {
    const offs = [sourceService.subscribe(listener), workflowService.subscribe(listener), mcpService.subscribeCalls(listener)];
    return () => offs.forEach((o) => o());
  },

  filterOptions(): FilterOptions {
    const classes = new Map<string, string>();
    caseStore.all().forEach((c) => {
      if (!classes.has(c.productClass)) classes.set(c.productClass, c.category);
    });
    return {
      tenants: meta.tenants,
      sites: meta.sites,
      routes: meta.routes.map((r) => ({ id: r.id, label: r.name })),
      assetClasses: [...classes.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    };
  },

  async keyFigures(scope: Scope, periodDays: ComparePeriod): Promise<KeyFigures> {
    const [portfolio, sources] = await Promise.all([metricsService.portfolio(scope), sourceService.summary()]);
    const trend = sources.healthTrend;
    return {
      portfolio,
      periodDays,
      current: windowFigures(scope, AS_OF_MS - periodDays * DAY, AS_OF_MS),
      prior: windowFigures(scope, AS_OF_MS - 2 * periodDays * DAY, AS_OF_MS - periodDays * DAY),
      integration: { healthPct: sources.healthPct, priorPct: trend[0] ?? sources.healthPct, attention: sources.attention, failed: sources.failed, total: sources.connected },
    };
  },

  // ---------------------------------------------------------------- Dashboard (business)

  /** KPI strip (now vs. 30 days ago) and the prioritised attention list for the Business dashboard. */
  async today(scope: Scope) {
    const portfolio = await metricsService.portfolio(scope);
    const count = (id: string) => portfolio.lifecycle.find((l) => l.id === id)?.count ?? 0;
    // Trend = cases received in the last 14 days versus the 14 days before, per stage.
    const start = AS_OF_MS - STRIP_PERIOD_DAYS * DAY;
    const prevStart = start - STRIP_PERIOD_DAYS * DAY;
    const all = scoped(scope);
    const recent = all.filter((c) => Date.parse(c.receivedDate) > start);
    const previous = all.filter((c) => Date.parse(c.receivedDate) > prevStart && Date.parse(c.receivedDate) <= start);
    const inflow = (list: CaseRecord[], stage: string) => list.filter((c) => c.stage === stage).length;
    const fig = (stage: string) => ({ value: count(stage), now: inflow(recent, stage), prior: inflow(previous, stage) });
    // Gain over the standard route (headline): same number as decisionService.summary(scope).
    const gain = decisionSummary(scope).gainOverStandard;
    const openValue = (list: CaseRecord[]) => sum(list.filter((c) => c.stage !== 'handed_off').map((c) => c.estimatedNetRecovery));
    const strip: StripFigure[] = [
      { id: 'ready', label: 'Awaiting approval', ...fig('awaiting_approval'), upIsGood: true, note: 'Decisions ready to sign off', href: '/command/actions?tab=approvals', kpi: 'decisionsWaiting' },
      { id: 'evidence', label: 'Needs evidence', ...fig('needs_information'), upIsGood: false, note: 'Evidence missing', href: '/product/received?stage=needs_information' },
      { id: 'reeval', label: 'Re-evaluation', ...fig('reevaluate'), upIsGood: false, note: 'To prepare again', href: '/product/received?stage=reevaluate' },
      { id: 'inspect', label: 'Inspections due', ...fig('awaiting_inspection'), upIsGood: false, note: 'Awaiting inspection', href: '/product/received?stage=awaiting_inspection' },
      {
        id: 'recovery',
        label: 'Potential recovery',
        value: portfolio.potentialRecovery,
        now: openValue(recent),
        prior: openValue(previous),
        upIsGood: true,
        money: true,
        note: `${gain < 0 ? '−' : '+'}${fmtK(Math.abs(gain))} over the standard route`,
        href: '/command',
        kpi: 'potentialRecovery',
      },
    ];

    const rank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
    const candidates = scoped(scope).filter(
      (c) => c.stage !== 'handed_off' && (c.valueAtRisk > 0 || c.stage === 'awaiting_approval' || c.dueInDays <= 2),
    );
    const attention: AttentionItem[] = [...candidates]
      .sort((a, b) => rank[a.priority] - rank[b.priority] || a.dueInDays - b.dueInDays || b.valueAtRisk - a.valueAtRisk)
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        productName: c.productName,
        priority: c.priority,
        stage: c.stage,
        issue: issueOf(c),
        impact: c.valueAtRisk > 0 ? c.valueAtRisk : c.estimatedNetRecovery,
        impactKind: c.valueAtRisk > 0 ? 'at risk' : 'recovery',
        dueDate: c.dueDate,
        dueInDays: c.dueInDays,
        exceptionId: c.exceptionId,
      }));
    return { portfolio, strip, attention, attentionTotal: candidates.length, gainOverStandard: gain };
  },

  /** The signed-in role's tasks, grouped for the "My Work" tabs. */
  async myWork(input: { role: UserRole; tenant: string; scope: Scope }) {
    const res = await taskService.list({ role: input.role, tenant: input.tenant, status: 'all' });
    const rows = res.items.filter((t) => !t.case || scopeCases([t.case], input.scope).length > 0);
    return {
      due: rows.filter((t) => t.status === 'todo' && t.dueInDays <= 7),
      progress: rows.filter((t) => t.status === 'in_progress'),
      waiting: rows.filter((t) => t.status === 'waiting'),
      done: rows.filter((t) => t.status === 'done').sort((a, b) => b.dueInDays - a.dueInDays),
    };
  },

  /** Business performance: recovery yield over the last N months and the case pipeline split. */
  async performance(months: number, scope: Scope) {
    const [vr, portfolio] = await Promise.all([metricsService.valueRealisation(months), metricsService.portfolio(scope)]);
    const count = (id: string) => portfolio.lifecycle.find((l) => l.id === id)?.count ?? 0;
    return {
      yieldPct: Math.round(vr.totals.recoveryYield * 1000) / 10,
      monthlyYield: vr.months.map((m) => Math.round(m.recoveryYield * 1000) / 10),
      months: vr.months.map((m) => m.month),
      // Same definition as the "Needs evidence" KPI (stage needs_information); evidenceGaps also counts
      // cases awaiting inspection, which the KPI strip shows separately as "Inspections due".
      pipeline: { awaiting: count('awaiting_approval'), handedOff: count('handed_off'), evidence: count('needs_information') },
    };
  },

  // ---------------------------------------------------------------- Dashboard (technical) + Integration health

  async technical() {
    const [sources, workflows, calls, recent] = await Promise.all([
      sourceService.summary(),
      workflowService.all(),
      mcpService.callSummary(),
      mcpService.listCalls({ pageSize: 3 }),
    ]);
    return { sources: sourceBreakdown(sources), workflows: workflowBreakdown(workflows), calls, recentCalls: recent.items };
  },

  async health() {
    const [summary, sources, workflows, calls, recent] = await Promise.all([
      sourceService.summary(),
      sourceService.list(),
      workflowService.all(),
      mcpService.callSummary(),
      mcpService.listCalls({ pageSize: 5 }),
    ]);
    const runs = workflows
      .flatMap((w) => w.runs.map((r) => ({ ...r, workflow: w.name })))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .slice(-12);
    return {
      summary,
      breakdown: sourceBreakdown(summary),
      sources,
      workflows: workflowBreakdown(workflows),
      workflowRuns: runs,
      calls,
      recentCalls: recent.items,
    };
  },
};

function sourceBreakdown(s: SourceSummary) {
  const warning = s.attention - s.failed;
  return { healthy: s.connected - s.attention, warning, failed: s.failed, paused: s.paused, total: s.total, healthPct: s.healthPct, healthTrend: s.healthTrend };
}

function workflowBreakdown(list: Workflow[]) {
  const failing = list.filter((w) => w.status === 'Failing' || w.lastRunStatus === 'Failed');
  const published = list.filter((w) => w.status === 'Published' && !failing.includes(w));
  const draft = list.filter((w) => w.status === 'Draft' && !failing.includes(w));
  const active = list.filter((w) => w.active);
  const successRate = active.length ? Math.round((sum(active.map((w) => w.successRate)) / active.length) * 10) / 10 : 0;
  return { total: list.length, published: published.length, failing: failing.length, draft: draft.length, successRate, failingNames: failing.map((w) => w.name) };
}

/** CSV of the Key Figures view (what the user sees, with the filters applied). */
export function keyFiguresCsv(k: KeyFigures, decision: DecisionSummary | undefined, filters: Record<string, string>): string {
  const p = k.portfolio;
  const rows: (string | number)[][] = [['Section', 'Item', 'Value']];
  Object.entries(filters).forEach(([key, v]) => rows.push(['Filter', key, v]));
  rows.push(['Filter', 'As of', meta.asOf]);
  rows.push(['KPI', 'Awaiting approval (decisions)', p.awaitingApproval.count]);
  rows.push(['KPI', 'Potential recovery (USD)', p.potentialRecovery]);
  rows.push(['KPI', 'Value at risk (USD)', p.valueAtRisk]);
  if (decision) {
    rows.push(['KPI', 'Gain over the standard route (USD)', decision.gainOverStandard]);
    rows.push(['Queue plan', 'Adds vs first come, first served (USD)', decision.planGain]);
    rows.push(['Queue plan', 'Orders wanted by more than one return', decision.contested]);
    decision.byChannel.forEach((c) => rows.push(['Gap by intake channel (USD)', c.label, c.gain]));
  }
  p.valueAtRiskByReason.forEach((r) => rows.push(['Value at risk by reason (USD)', r.label, r.value]));
  p.lifecycle.forEach((l) => rows.push(['Lifecycle (assets)', l.label, l.count]));
  p.routeOpportunity.forEach((r) => rows.push(['Channel opportunity (USD)', r.label, r.value]));
  p.timeToAction.forEach((t) => rows.push(['Time to action (assets)', t.label, t.count]));
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

export type { TaskRow, McpCallRow };
export { TASK_TYPE_LABEL };
