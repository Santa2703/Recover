/**
 * Decision engine runtime: loads src/data/decision/*.json, holds the mutable decision
 * state (published rules, owner overrides, recorded outcomes, inbox), memoizes the
 * whole-queue plan and decorates the case store so every screen shows the engine's
 * route and net.
 *
 * Imported by src/services/mock/stores.ts, so this module must never import stores
 * (that would be a cycle). The bound raw case collection is handed in by `withDecisions`.
 */
import channelsJson from '@/data/decision/channels.json';
import demandJson from '@/data/decision/demand.json';
import policyJson from '@/data/decision/policy.json';
import rulesJson from '@/data/decision/rules.json';
import guardrailsJson from '@/data/decision/guardrails.json';
import historyJson from '@/data/decision/history.json';
import inboxJson from '@/data/decision/inbox.json';
import metaJson from '@/data/meta.json';
import type { CaseRecord, CaseStageId, RiskReasonId } from '@/models/domain.model';
import type {
  BusinessRule,
  CaseContext,
  DecisionHistoryRecord,
  DecisionParams,
  Demand,
  Guardrail,
  InboxItem,
  IntakeChannel,
  OverrideRecord,
  Policy,
  QueuePlan,
  RouteId,
  RouteProposal,
  RuleSet,
} from '@/models/decision.model';
import type { Collection } from '../mock/mockUtils';
import { hashOf, planQueue, type EngineContext } from './engine';

/* ================================================================ static data */

export const ASOF: string = (metaJson as { asOf: string }).asOf;
export const policy = policyJson as unknown as Policy;
export const demands = demandJson as unknown as Demand[];
export const guardrails = guardrailsJson as unknown as Guardrail[];
const channels = channelsJson as unknown as Record<string, CaseContext>;
const inboxTemplates = inboxJson as unknown as InboxItem[];

/** Stages whose decision is still open (decided by the queue plan). */
export const OPEN_STAGES: ReadonlySet<CaseStageId> = new Set<CaseStageId>([
  'awaiting_inspection',
  'needs_information',
  'awaiting_approval',
  'reevaluate',
  'no_viable_route',
]);

export const isOpen = (c: CaseRecord) => OPEN_STAGES.has(c.stage);

/** Share of the best net exposed by each risk reason (same shares as the case generator). */
export const RISK_SHARE: Record<RiskReasonId, number> = {
  missing_evidence: 0.35,
  delayed_approval: 0.12,
  market_price_decline: 0.18,
  capacity_constraint: 0.22,
  condition_deterioration: 0.25,
  no_viable_route: 1,
};

/* ================================================================ mutable state */

type Listener = () => void;

const state = {
  version: 0,
  ruleSet: rulesJson as unknown as RuleSet,
  previousRuleSets: [] as RuleSet[],
  overrides: new Map<string, OverrideRecord>(),
  overrideLog: [] as OverrideRecord[],
  /** Routes sent for approval by non-approvers, by case id (decisionService.proposeRoute). */
  proposals: new Map<string, RouteProposal>(),
  history: historyJson as unknown as DecisionHistoryRecord[],
  runtimeContexts: new Map<string, CaseContext>(),
  inbox: inboxTemplates.slice(0, 3) as InboxItem[],
  inboxCursor: 3,
};
const listeners = new Set<Listener>();

/** Bumps the decision state version and notifies subscribers (rules, overrides, history, inbox). */
export function touch(): void {
  state.version += 1;
  listeners.forEach((l) => l());
}

export function subscribeDecisions(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const decisionVersion = () => state.version;
export const decisionState = state;

/* ================================================================ case context */

const CHANNEL_ORDER: IntakeChannel[] = ['lease_end', 'field_return', 'trade_in', 'excess'];

/**
 * Intake channel, remaining life and parts for any case: generated data first, then
 * contexts registered at runtime (inbox), then a deterministic fallback from the case.
 */
export function contextFor(c: CaseRecord): CaseContext {
  const known = channels[c.id] ?? state.runtimeContexts.get(c.id);
  if (known) return known;
  const h = hashOf(c.id);
  const base: Record<CaseRecord['condition'], number> = { A: 96, B: 80, C: 62, D: 34, Scrap: 10 };
  const life = Math.max(3, Math.min(100, Math.round(base[c.condition] - c.facts.ageYears * 3)));
  const ctx: CaseContext = { intakeChannel: CHANNEL_ORDER[h % 4], lifePct: life, parts: [] };
  state.runtimeContexts.set(c.id, ctx);
  return ctx;
}

/** Registers the context of a case created at runtime (inbox). */
export function registerContext(id: string, ctx: CaseContext): void {
  state.runtimeContexts.set(id, ctx);
}

/* ================================================================ engine context */

let ctxCache: { version: number; ctx: EngineContext } | null = null;

/** The engine context for the published rules. */
export function engineContext(rules?: BusinessRule[]): EngineContext {
  if (rules) return { asOf: ASOF, policy, demands, contextFor, rules };
  if (!ctxCache || ctxCache.version !== state.version) {
    ctxCache = { version: state.version, ctx: { asOf: ASOF, policy, demands, contextFor, rules: state.ruleSet.rules.filter((r) => r.active !== false) } };
  }
  return ctxCache.ctx;
}

/* ================================================================ bound store */

let boundRaw: Collection<CaseRecord> | null = null;

/** Raw (undecorated) cases. */
export function rawCases(): CaseRecord[] {
  return boundRaw?.all() ?? [];
}

/** Demand ids held by approved / handed-off cases, with the holding case id. */
export function committedDemands(raw: CaseRecord[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of raw) if (!isOpen(c)) for (const id of c.demandIds ?? []) m.set(id, c.id);
  return m;
}

/* ================================================================ memoized plan */

interface PlanKey {
  cases: CaseRecord[];
  key: string;
  plan: QueuePlan;
}
const planMemo: PlanKey[] = [];

/**
 * Queue plan for a set of open cases, memoized by (case array, params, rules, blocked,
 * decision state version). The latest 8 plans are kept.
 */
export function memoPlan(
  open: CaseRecord[],
  opts: { params?: Partial<DecisionParams>; rules?: BusinessRule[]; blocked?: RouteId[]; committed?: Map<string, string> } = {},
): QueuePlan {
  const committed = opts.committed ?? committedDemands(rawCases());
  const key = JSON.stringify([state.version, opts.params ?? null, opts.rules ?? null, opts.blocked ?? null, [...committed.keys()].sort(), open.length]);
  const hit = planMemo.find((m) => m.cases === open && m.key === key);
  if (hit) return hit.plan;
  const plan = planQueue(open, engineContext(opts.rules), {
    params: opts.params,
    blocked: opts.blocked,
    committed,
    overrides: state.overrides,
  });
  planMemo.unshift({ cases: open, key, plan });
  if (planMemo.length > 8) planMemo.pop();
  return plan;
}

let openMemo: { raw: CaseRecord[]; open: CaseRecord[] } | null = null;

/** Open cases of the raw store (stable array identity while the store is unchanged). */
export function openRawCases(): CaseRecord[] {
  const raw = rawCases();
  if (!openMemo || openMemo.raw !== raw) openMemo = { raw, open: raw.filter(isOpen) };
  return openMemo.open;
}

/** The published queue plan for the current store. */
export function currentPlan(): QueuePlan {
  return memoPlan(openRawCases());
}

/* ================================================================ decoration */

let decoMemo: { raw: CaseRecord[]; version: number; list: CaseRecord[]; byId: Map<string, CaseRecord> } | null = null;

/** Applies the queue plan to open cases: recommended route, net, value at risk and demand ids. */
export function decorateCases(raw: CaseRecord[]): { list: CaseRecord[]; byId: Map<string, CaseRecord> } {
  if (decoMemo && decoMemo.raw === raw && decoMemo.version === state.version) return decoMemo;
  const plan = currentPlan();
  const list = raw.map((c) => {
    const d = plan.decisions[c.id];
    if (!isOpen(c) || !d) return c;
    const net = d.best.net;
    const valueAtRisk = c.riskReason ? Math.round((Math.max(0, net) * RISK_SHARE[c.riskReason]) / 10) * 10 : 0;
    const proposal = state.proposals.get(c.id);
    return {
      ...c,
      recommendedRoute: d.best.route,
      estimatedNetRecovery: net,
      valueAtRisk,
      demandIds: d.best.viable ? d.best.demands.filter((x) => x.kind !== 'recycler_quote').map((x) => x.id) : [],
      proposal,
    };
  });
  decoMemo = { raw, version: state.version, list, byId: new Map(list.map((c) => [c.id, c])) };
  return decoMemo;
}

/**
 * Applies a proposal for another route as an owner override (actor = the proposer) just before
 * the case is approved. Throws when the proposed route is no longer viable.
 */
function applyProposedRoute(id: string): boolean {
  const prop = state.proposals.get(id);
  const d = currentPlan().decisions[id];
  if (!prop?.route || !d || d.best.route === prop.route) return false;
  const option = d.all.find((r) => r.route === prop.route);
  if (!option?.viable) throw new Error(`${policy.routes[prop.route].name} is no longer viable: ${option?.reason ?? 'unknown route'}`);
  if (!prop.reason) throw new Error('The proposal has no reason');
  const rec: OverrideRecord = { caseId: id, route: prop.route, fromRoute: d.override?.fromRoute ?? d.best.route, reason: prop.reason, actor: prop.proposedBy, at: new Date().toISOString() };
  state.overrides.set(id, rec);
  state.overrideLog.push(rec);
  state.version += 1;
  return true;
}

/**
 * Wraps the raw case collection so reads return engine-decorated cases.
 *
 * When an update moves an open case to a closed stage (approve, hand off), the engine's
 * route, net and demand ids are frozen into the record so they stay put afterwards.
 * Approving a case with a route proposal applies the proposed route first (and keeps the
 * proposal on the record); any other stage change away from "Awaiting approval" (decline,
 * request evidence) clears the proposal.
 */
export function withDecisions(raw: Collection<CaseRecord>): Collection<CaseRecord> {
  boundRaw = raw;
  const view = () => decorateCases(raw.all());
  return {
    all: () => view().list,
    get: (id) => view().byId.get(id),
    update(id, patch) {
      let before = view().byId.get(id);
      if (!before) throw new Error(`Record ${id} not found`);
      const p = typeof patch === 'function' ? patch(before) : patch;
      const closing = isOpen(before) && p.stage !== undefined && !OPEN_STAGES.has(p.stage);
      const proposal = state.proposals.get(id);
      let proposalChanged = false;
      if (closing && p.stage === 'approved' && proposal) {
        proposalChanged = applyProposedRoute(id);
        before = view().byId.get(id) ?? before;
      }
      const frozen: Partial<CaseRecord> = closing
        ? {
            recommendedRoute: before.recommendedRoute,
            estimatedNetRecovery: before.estimatedNetRecovery,
            valueAtRisk: before.valueAtRisk,
            demandIds: before.demandIds ?? [],
            ...(p.stage === 'approved' && proposal ? { proposal } : {}),
          }
        : {};
      if (proposal && p.stage !== undefined && p.stage !== 'awaiting_approval') {
        state.proposals.delete(id);
        state.version += 1;
        proposalChanged = true;
      }
      raw.update(id, { ...frozen, ...p });
      if (closing) state.overrides.delete(id);
      if (proposalChanged) touch();
      const after = view().byId.get(id);
      if (!after) throw new Error(`Record ${id} not found`);
      return after;
    },
    insert(item) {
      raw.insert(item);
      return view().byId.get(item.id) ?? item;
    },
    remove: (id) => raw.remove(id),
    subscribe(listener) {
      const a = raw.subscribe(listener);
      const b = subscribeDecisions(listener);
      return () => {
        a();
        b();
      };
    },
    version: () => raw.version() * 100_000 + state.version,
  };
}

/* ================================================================ inbox templates */

/** Next inbox template (cycles), re-numbered when its id is already used. */
export function nextInboxTemplate(usedIds: Set<string>): InboxItem {
  const t = inboxTemplates[state.inboxCursor % inboxTemplates.length];
  state.inboxCursor += 1;
  let id = t.case.id;
  if (usedIds.has(id)) {
    const max = Math.max(1128, ...[...usedIds].map((x) => Number(x.replace(/\D/g, '')) || 0));
    id = `RT-${max + 1}`;
  }
  return { case: { ...t.case, id }, context: t.context };
}
