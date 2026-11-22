/**
 * Decision service: the single source of truth for routes and net values.
 *
 * - Pure, synchronous functions (valueRoute, decideCase, planQueue, decide, summary, …)
 *   for derive-during-render use and for other services.
 * - `decisionService` wraps them in async calls with simulated latency for pages
 *   (`useServiceQuery(() => decisionService.summary(scope), [scope], { subscribe: decisionService.subscribe })`).
 *
 * The engine maths lives in ./decision/engine.ts (see docs/recover-reference.md §1);
 * data lives in src/data/decision/*.json (scripts/gen-decision-data.mjs). The case store
 * is decorated with the queue plan, so caseService / metricsService / productService and
 * every page show the same recommended route and net as this service.
 */
import type { CaseRecord, Paged } from '@/models/domain.model';
import type {
  AccuracyMatrix,
  AccuracyStats,
  AgentStep,
  ApprovalRecord,
  DecisionInsights,
  HandoffInstruction,
  InstructionPreview,
  InstructionStatus,
  PresetFlip,
  PresetId,
  Availability,
  BusinessRule,
  CaseContext,
  CaseDecision,
  ChannelGap,
  DecisionHistoryRecord,
  DecisionParams,
  DecisionScope,
  DecisionSummary,
  Demand,
  Guardrail,
  HistoryGroup,
  HistoryQuery,
  HowCalculated,
  InboxItem,
  IntakeChannel,
  KpiKey,
  NextBestAction,
  OverrideReason,
  OverrideRecord,
  Policy,
  QueuePlan,
  RouteId,
  RouteMixRow,
  RouteProposal,
  RouteValue,
  RuleSet,
  RunAgentsResult,
  WhatIfResult,
} from '@/models/decision.model';
import handoffsJson from '@/data/commandHandoffs.json';
import outcomesJson from '@/data/commandOutcomes.json';
import { caseStore, meta } from './mock/stores';
import { delay, queryList, sum } from './mock/mockUtils';
import { scopeCases } from './caseService';
import * as engine from './decision/engine';
import { buildAgentTrail, buildNextBestAction } from './decision/explain';
import {
  addWorkingHours,
  insightsFor,
  instructionsFor,
  presetStress,
  previewFor,
  PRESETS as insightsPresets,
  snapshotIdFor,
  workingHoursBetween,
  type PresetStress,
} from './decision/insights';
import {
  ASOF,
  buildApproval,
  modelVersion,
  notifyDecisions,
  simNow,
  committedDemands,
  contextFor,
  currentPlan,
  decisionState as state,
  demands,
  engineContext,
  guardrails,
  isOpen,
  memoPlan,
  nextInboxTemplate,
  openRawCases,
  policy,
  rawCases,
  registerContext,
  RISK_SHARE,
  subscribeDecisions,
  touch,
  type DeclineRecord,
  type HandoffEvents,
  type ReevaluationResult,
} from './decision/runtime';

export type { DeclineRecord, ReevaluationResult, EscalationRecord } from './decision/runtime';

export { CHANNEL_LABEL, CHANNEL_SHORT, ROUTE_IDS, usd, fmtDay, defaultParams } from './decision/engine';
export { sourceText, demandText } from './decision/explain';
export type { EngineContext } from './decision/engine';

export const OVERRIDE_REASONS: OverrideReason[] = ['Customer commitment', 'Known condition issue not in data', 'Regulatory or contract hold', 'Market knowledge'];

const CHANNELS: IntakeChannel[] = ['lease_end', 'field_return', 'trade_in', 'excess'];

/* ================================================================ data access */

/** Published economics, route owners / systems and the source catalogue. */
export function getPolicy(): Policy {
  return policy;
}

/** All named demand records. */
export function getDemands(): Demand[] {
  return demands;
}

/** One demand record by id (LO-, SO-, BID-, RR-, RO-, RQ-). */
export function getDemand(id: string): Demand | undefined {
  return engine.findDemand(engineContext(), id);
}

/** Intake channel, remaining life and harvestable parts of a case. */
export function caseContext(c: CaseRecord): CaseContext {
  return contextFor(c);
}

/** Intake channel of a case (by record or id; 'excess' when the id is unknown). */
export function channelOf(c: CaseRecord | string): IntakeChannel {
  const rec = typeof c === 'string' ? caseStore.get(c) : c;
  return rec ? contextFor(rec).intakeChannel : 'excess';
}

/* ================================================================ core valuation */

/**
 * Values one route for one case (line items with sources, named demand, timing).
 * @param ctx engine context (defaults to the published rules and data)
 * @param avail free resources; omit to value the case alone
 */
export function valueRoute(c: CaseRecord, route: RouteId, params?: Partial<DecisionParams>, ctx?: engine.EngineContext, avail?: Availability): RouteValue {
  return engine.valueRoute(c, route, params, ctx ?? engineContext(), avail);
}

/** The route the intake team would use without Circularity (see engine.standardRoute). */
export function standardRoute(c: CaseRecord, params?: Partial<DecisionParams>): RouteId {
  return engine.standardRoute(c, engineContext(), params);
}

/**
 * Decides one case on its own (no queue): every route valued, rules applied, standard
 * route compared. Demand committed to approved cases is not available.
 */
export function decideCase(c: CaseRecord, opts: { params?: Partial<DecisionParams>; rules?: BusinessRule[]; blocked?: RouteId[] } = {}): CaseDecision {
  const committed = committedDemands(rawCases());
  for (const id of c.demandIds ?? []) committed.delete(id);
  const avail: Availability = { taken: new Set(committed.keys()), holder: committed, slotsLeft: Number.POSITIVE_INFINITY };
  return engine.decideCase(c, engineContext(), { ...opts, avail });
}

/**
 * Plans the open queue together (regret allocation, each demand once, refurbishment
 * slots limited) and compares with first come, first served. Memoized by inputs.
 * @param openCases defaults to every open case in the store
 */
export function planQueue(openCases?: CaseRecord[], params?: Partial<DecisionParams>, rules?: BusinessRule[], blocked?: RouteId[]): QueuePlan {
  return memoPlan(openCases ?? openRawCases(), { params, rules, blocked });
}

/** Availability for one case given the rest of the plan (resources others use are taken). */
function planAvailability(caseId: string, plan: QueuePlan): Availability {
  const holder = committedDemands(rawCases());
  let othersSlots = 0;
  for (const a of Object.values(plan.assignments)) {
    if (a.caseId === caseId) continue;
    for (const id of a.demandIds) holder.set(id, a.caseId);
    if (a.usesSlot) othersSlots += 1;
  }
  for (const id of caseStore.get(caseId)?.demandIds ?? []) if (holder.get(id) === caseId) holder.delete(id);
  return { taken: new Set(holder.keys()), holder, slotsLeft: plan.refurbSlots - othersSlots };
}

/**
 * The decision the app shows for a case. Open cases use the queue plan (with `planNote`
 * when the plan moved the case off its standalone best); approved / handed-off cases show
 * their recorded route.
 */
export function decide(caseId: string): CaseDecision | undefined {
  const c = caseStore.get(caseId);
  if (!c) return undefined;
  if (isOpen(c)) {
    const d = currentPlan().decisions[caseId];
    if (d) return d;
  }
  const dec = decideCase(c);
  if (isOpen(c)) return dec;
  const recorded = dec.all.find((r) => r.route === c.recommendedRoute && r.viable);
  if (!recorded || recorded.route === dec.best.route) return dec;
  return { ...dec, best: recorded, gainOverStandard: recorded.net - dec.standard.net, runnerUp: dec.all.find((r) => r.viable && r.route !== recorded.route) ?? null };
}

/**
 * Re-decides one case under different levers (Case page scenario panel) while keeping the
 * rest of the queue plan fixed. With no options it equals `decide(caseId)` for open cases.
 */
export function simulateCase(c: CaseRecord, opts: { params?: Partial<DecisionParams>; rules?: BusinessRule[]; blocked?: RouteId[] } = {}): CaseDecision {
  if (!opts.params && !opts.rules && !opts.blocked?.length) return decide(c.id) ?? decideCase(c);
  if (!isOpen(c) || !caseStore.get(c.id)) return decideCase(c, opts);
  const avail = planAvailability(c.id, currentPlan());
  return engine.decideCase(c, engineContext(opts.rules), { params: opts.params, blocked: opts.blocked, avail, standardAvail: avail, override: state.overrides.get(c.id) ?? null });
}

/* ================================================================ explain */

/** Next best action card (headline, dated steps, proof list, fallback, pill). */
export function nextBestAction(caseId: string): NextBestAction | undefined {
  const c = caseStore.get(caseId);
  const d = decide(caseId);
  if (!c || !d) return undefined;
  return buildNextBestAction(c, d, engineContext(), !isOpen(c), isOpen(c) ? currentPlan().refurbSlotsUsed : null);
}

/** The 7 agent steps for a case with plain-language conclusions. */
export function agentTrail(caseId: string): AgentStep[] {
  const c = caseStore.get(caseId);
  const d = decide(caseId);
  return c && d ? buildAgentTrail(c, d, engineContext()) : [];
}

/* ================================================================ scope + portfolio */

/** Cases in scope (same rules as metricsService: tenant / site / route / product class). */
export function scopedCases(scope: DecisionScope = {}): CaseRecord[] {
  let cases = scopeCases(caseStore.all(), scope);
  if (scope.route && scope.route !== 'all') cases = cases.filter((c) => c.recommendedRoute === scope.route);
  if (scope.productClass && scope.productClass !== 'all') cases = cases.filter((c) => c.productClass === scope.productClass);
  return cases;
}

/** Open decisions in scope with their plan decision. */
export function openDecisions(scope: DecisionScope = {}): { case: CaseRecord; decision: CaseDecision }[] {
  const plan = currentPlan();
  return scopedCases(scope)
    .filter(isOpen)
    .flatMap((c) => (plan.decisions[c.id] ? [{ case: c, decision: plan.decisions[c.id] }] : []));
}

function routeMix(rows: { route: RouteId; net: number }[]): RouteMixRow[] {
  return engine.ROUTE_IDS.map((route) => {
    const list = rows.filter((r) => r.route === route);
    return { route, name: policy.routes[route].name, n: list.length, value: sum(list.map((r) => r.net)) };
  }).filter((r) => r.n > 0);
}

/** Portfolio headline: open decisions, gain over the standard route, queue vs FCFS, gap by channel, route mix. */
export function summary(scope: DecisionScope = {}): DecisionSummary {
  const plan = currentPlan();
  const rows = openDecisions(scope);
  const ids = new Set(rows.map((r) => r.case.id));
  const queueValue = sum(rows.map((r) => r.decision.best.net));
  const standardValue = sum(rows.map((r) => r.decision.standard.net));
  const fcfsValue = sum([...ids].map((id) => plan.fcfsAssignments[id]?.net ?? 0));
  const byChannel: ChannelGap[] = CHANNELS.map((channel) => {
    const list = rows.filter((r) => r.decision.channel === channel);
    const standard = sum(list.map((r) => r.decision.standard.net));
    const best = sum(list.map((r) => r.decision.best.net));
    return { channel, label: engine.CHANNEL_LABEL[channel], standard, best, gain: best - standard, n: list.length };
  });
  return {
    openDecisions: rows.length,
    waiting: rows.filter((r) => r.case.stage === 'awaiting_approval').length,
    gainOverStandard: queueValue - standardValue,
    queueValue,
    standardValue,
    fcfsValue,
    planGain: queueValue - fcfsValue,
    contested: plan.contested.filter((x) => x.wantedBy.some((id) => ids.has(id))).length,
    namedDemandShare: rows.length ? rows.filter((r) => r.decision.best.committed).length / rows.length : 0,
    byChannel,
    routeMix: routeMix(rows.map((r) => ({ route: r.decision.best.route, net: r.decision.best.net }))),
  };
}

/** Portfolio What-if: queue value under new levers vs today vs the standard route, and the decisions that change. */
export function whatIf(params: Partial<DecisionParams>, scope: DecisionScope = {}): WhatIfResult {
  const full = engine.resolveParams(policy, params);
  const today = currentPlan();
  const scenario = memoPlan(openRawCases(), { params: full });
  const rows = openDecisions(scope);
  const changes = rows
    .flatMap(({ case: c, decision: d }) => {
      const s = scenario.decisions[c.id];
      if (!s || (s.best.route === d.best.route && s.best.net === d.best.net)) return [];
      return [{ caseId: c.id, from: d.best.route, to: s.best.route, netToday: d.best.net, netScenario: s.best.net, netDelta: s.best.net - d.best.net }];
    })
    .filter((x) => x.from !== x.to || Math.abs(x.netDelta) >= 1)
    .sort((a, b) => Number(b.from !== b.to) - Number(a.from !== a.to) || Math.abs(b.netDelta) - Math.abs(a.netDelta));
  return {
    params: full,
    today: sum(rows.map((r) => today.decisions[r.case.id]?.best.net ?? 0)),
    scenario: sum(rows.map((r) => scenario.decisions[r.case.id]?.best.net ?? 0)),
    standard: sum(rows.map((r) => scenario.decisions[r.case.id]?.standard.net ?? 0)),
    changes,
    mixToday: routeMix(rows.map((r) => ({ route: r.decision.best.route, net: r.decision.best.net }))),
    mixScenario: routeMix(rows.flatMap((r) => (scenario.decisions[r.case.id] ? [{ route: scenario.decisions[r.case.id].best.route, net: scenario.decisions[r.case.id].best.net }] : []))),
  };
}

/* ================================================================ learning */

const HISTORY_WINDOW_DAYS = 60;

function historyIn(scope: DecisionScope = {}): DecisionHistoryRecord[] {
  return state.history.filter(
    (h) => (!scope.tenant || scope.tenant === 'All' || h.snapshot.tenant === scope.tenant) && (!scope.site || h.snapshot.site === scope.site) && (!scope.productClass || scope.productClass === 'all' || h.snapshot.productClass === scope.productClass),
  );
}

/** Forecast accuracy statistics for a set of closed decisions. */
export function accuracyOf(records: DecisionHistoryRecord[]): AccuracyStats {
  const forecast = sum(records.map((h) => h.forecastNet));
  const realised = sum(records.map((h) => h.realisedNet));
  const absF = sum(records.map((h) => Math.abs(h.forecastNet)));
  const absErr = sum(records.map((h) => Math.abs(h.realisedNet - h.forecastNet)));
  return {
    n: records.length,
    accuracy: absF ? 1 - absErr / absF : 0,
    within5: records.length ? records.filter(within5).length / records.length : 0,
    bias: absF ? (realised - forecast) / absF : 0,
    forecast,
    realised,
  };
}

const within5 = (h: DecisionHistoryRecord) => Math.abs(h.realisedNet - h.forecastNet) <= 0.05 * Math.max(1, Math.abs(h.forecastNet));

/** Forecast accuracy over closed decisions in scope (last 60 days). */
export function accuracy(scope: DecisionScope = {}): AccuracyStats {
  return accuracyOf(historyIn(scope).filter((h) => h.closedDaysAgo < HISTORY_WINDOW_DAYS));
}

/** Closed decisions, filtered / sorted / paged. */
export function listHistory(q: HistoryQuery = {}, scope: DecisionScope = {}): Paged<DecisionHistoryRecord> {
  return queryList(historyIn(scope), {
    search: q.search,
    searchFields: ['id', 'caseId', (h) => h.snapshot.productName, (h) => h.actor],
    filters: { route: q.route, channel: q.channel },
    predicate: (h) => (q.overridden === undefined || h.overridden === q.overridden) && (q.sinceDays === undefined || h.closedDaysAgo < q.sinceDays),
    sortBy: q.sortBy ?? 'closedDaysAgo',
    sortDir: q.sortDir ?? 'asc',
    page: q.page,
    pageSize: q.pageSize,
  });
}

function groupBy(records: DecisionHistoryRecord[], keys: string[], keyOf: (h: DecisionHistoryRecord) => string, labelOf: (k: string) => string): HistoryGroup[] {
  return keys
    .map((key) => {
      const list = records.filter((h) => keyOf(h) === key);
      return { key, label: labelOf(key), gain: sum(list.map((h) => h.realisedGain)), ...accuracyOf(list) };
    })
    .filter((g) => g.n > 0);
}

/** Closed decisions grouped by executed route. */
export function historyByRoute(scope: DecisionScope = {}): HistoryGroup[] {
  return groupBy(historyIn(scope), engine.ROUTE_IDS, (h) => h.route, (k) => policy.routes[k as RouteId].name);
}

/** Closed decisions grouped by intake channel. */
export function historyByChannel(scope: DecisionScope = {}): HistoryGroup[] {
  return groupBy(historyIn(scope), CHANNELS, (h) => h.channel, (k) => engine.CHANNEL_LABEL[k as IntakeChannel]);
}

/** Closed decisions by week (oldest first), keyed W-8 … W0, labelled "Week of 23 Sep". */
export function historyByWeek(scope: DecisionScope = {}): HistoryGroup[] {
  const keys = Array.from({ length: Math.ceil(HISTORY_WINDOW_DAYS / 7) }, (_, i) => `W-${Math.ceil(HISTORY_WINDOW_DAYS / 7) - 1 - i}`);
  return groupBy(
    historyIn(scope),
    keys,
    (h) => `W-${Math.floor(h.closedDaysAgo / 7)}`,
    (k) => `Week of ${engine.fmtDay(engine.addDays(ASOF, -(Number(k.slice(2)) * 7 + 6)))}`,
  );
}

/** Overrides: how often owners override, why, and how those decisions turned out. */
export function overrideStats(scope: DecisionScope = {}): {
  n: number;
  share: number;
  byReason: { reason: OverrideReason; n: number; accuracy: number; realisedGain: number }[];
  recent: OverrideRecord[];
} {
  const all = historyIn(scope);
  const over = all.filter((h) => h.overridden);
  return {
    n: over.length,
    share: all.length ? over.length / all.length : 0,
    byReason: OVERRIDE_REASONS.map((reason) => {
      const list = over.filter((h) => h.overrideReason === reason);
      return { reason, n: list.length, accuracy: accuracyOf(list).accuracy, realisedGain: sum(list.map((h) => h.realisedGain)) };
    }),
    recent: [...state.overrideLog].reverse(),
  };
}

/** 2×2: who decided (Circularity / owner override) × within 5 % of forecast or not. */
export function accuracyMatrix(scope: DecisionScope = {}): AccuracyMatrix {
  const all = historyIn(scope);
  const cells: AccuracyMatrix['cells'] = [];
  for (const decidedBy of ['circularity', 'owner'] as const) {
    for (const w of [true, false]) {
      const list = all.filter((h) => h.decidedBy === decidedBy && within5(h) === w);
      cells.push({ decidedBy, within5: w, n: list.length, ids: list.map((h) => h.id) });
    }
  }
  return { cells };
}

/** Current owner overrides on open cases. */
export function getOverrides(): OverrideRecord[] {
  return [...state.overrides.values()];
}

/**
 * Owner override: choose another viable route with a required reason. The queue is
 * re-planned with this case fixed first. Throws when the route is not viable.
 */
export function override(caseId: string, route: RouteId, reason: OverrideReason, actor: string): CaseDecision {
  const c = caseStore.get(caseId);
  if (!c) throw new Error(`Case ${caseId} not found`);
  if (!isOpen(c)) throw new Error(`${caseId} is already ${c.stage.replace(/_/g, ' ')}`);
  if (!OVERRIDE_REASONS.includes(reason)) throw new Error('A reason is required');
  const current = decide(caseId);
  const option = current?.all.find((r) => r.route === route);
  if (!option?.viable) throw new Error(`${policy.routes[route].name} is not viable: ${option?.reason ?? 'unknown route'}`);
  const rec: OverrideRecord = { caseId, route, fromRoute: current?.override?.fromRoute ?? current?.best.route ?? route, reason, actor, at: new Date().toISOString() };
  state.overrides.set(caseId, rec);
  state.overrideLog.push(rec);
  touch();
  const next = decide(caseId);
  if (!next) throw new Error(`Case ${caseId} not found`);
  return next;
}

/** Removes an owner override (back to Circularity's route). */
export function clearOverride(caseId: string): void {
  if (state.overrides.delete(caseId)) touch();
}

/* ================================================================ proposals */

/** The route sent for approval on an open case, or null. */
export function getProposal(caseId: string): RouteProposal | null {
  return state.proposals.get(caseId) ?? null;
}

/**
 * Sends a case for approval (Planner, Engineer, Warehouse Manager: roles that work cases but
 * cannot approve). `route` null = Circularity's recommended route; another route must be viable
 * and needs a reason from OVERRIDE_REASONS (same validation as `override`). Cases not yet
 * awaiting approval move to "Awaiting approval". Approving the case applies the proposed route
 * (as an override by the proposer); declining or requesting evidence clears the proposal.
 */
export function proposeRoute(
  caseId: string,
  route: RouteId | null,
  reason: OverrideReason | null,
  note: string,
  actor: string,
  who: { id?: string; role?: string } = {},
): RouteProposal {
  const c = caseStore.get(caseId);
  if (!c) throw new Error(`Case ${caseId} not found`);
  if (!isOpen(c)) throw new Error(`${caseId} is already ${c.stage.replace(/_/g, ' ')}`);
  const block = sendBlockReason(c);
  if (block) throw new Error(block);
  const current = decide(caseId);
  if (!current) throw new Error(`Case ${caseId} not found`);
  // Proposing the route the case is already on is the same as sending the recommendation.
  const alt = route && route !== current.best.route ? route : null;
  if (alt) {
    if (!reason || !OVERRIDE_REASONS.includes(reason)) throw new Error('A reason is required to propose another route');
    const option = current.all.find((r) => r.route === alt);
    if (!option?.viable) throw new Error(`${policy.routes[alt].name} is not viable: ${option?.reason ?? 'unknown route'}`);
  } else if (!current.best.viable) {
    throw new Error(`${caseId} has no viable route to send for approval`);
  }
  const prior = state.proposals.get(caseId);
  const altValue = alt ? current.all.find((r) => r.route === alt) : undefined;
  const submitted: CaseDecision = altValue ? { ...current, best: altValue } : current;
  const rec: RouteProposal = {
    route: alt,
    reason: alt ? reason : null,
    note: note.trim(),
    proposedBy: actor,
    ...(who.id ? { proposedById: who.id } : {}),
    ...(who.role ? { proposedByRole: who.role } : {}),
    proposedAt: new Date().toISOString(),
    fromStage: prior?.fromStage ?? c.stage,
    snapshotId: snapshotIdFor(c, submitted, engineContext(), modelVersion()),
  };
  state.proposals.set(caseId, rec);
  touch();
  if (c.stage !== 'awaiting_approval') caseStore.update(caseId, { stage: 'awaiting_approval', blockedReason: null });
  return rec;
}

/**
 * Why a case cannot be sent to the approver yet (null when it can): the inspection result is
 * not recorded (Awaiting inspection / Needs information), or a declined case was not re-evaluated.
 */
export function sendBlockReason(c: CaseRecord): string | null {
  if (c.stage === 'awaiting_inspection') return `${c.id} waits for its inspection result. The Engineer records it first; then you can send it to the approver.`;
  if (c.stage === 'needs_information') return `${c.id} needs evidence: the Engineer records the inspection result first; then you can send it to the approver.`;
  if (c.stage === 'reevaluate') return `${c.id} was sent back for re-evaluation. Re-evaluate it first to see what changed.`;
  return null;
}

/**
 * The decision and next best action as they would be if the proposed route were approved
 * (label "Proposed action", `override` names the proposer). Null when the case has no proposal
 * for another route.
 */
export function proposedAction(caseId: string): { decision: CaseDecision; action: NextBestAction } | null {
  const c = caseStore.get(caseId);
  const prop = state.proposals.get(caseId);
  const d = decide(caseId);
  if (!c || !d || !prop?.route || !prop.reason || !isOpen(c)) return null;
  const option = d.all.find((r) => r.route === prop.route && r.viable);
  if (!option || option.route === d.best.route) return null;
  const decision: CaseDecision = {
    ...d,
    best: option,
    gainOverStandard: option.net - d.standard.net,
    runnerUp: d.best.viable ? d.best : null,
    planNote: null,
    override: { caseId, route: option.route, fromRoute: d.best.route, reason: prop.reason, actor: prop.proposedBy, at: prop.proposedAt },
  };
  const action = buildNextBestAction(c, decision, engineContext(), false, currentPlan().refurbSlotsUsed);
  return { decision, action: { ...action, label: 'Proposed action' } };
}

/** Withdraws a proposal; a case the proposal moved to "Awaiting approval" goes back to its earlier stage. */
export function withdrawProposal(caseId: string, actor: string): void {
  const prop = state.proposals.get(caseId);
  if (!prop) return;
  void actor; // kept for the audit signature; the mock has no audit log for withdrawals
  state.proposals.delete(caseId);
  touch();
  const c = caseStore.get(caseId);
  if (c && c.stage === 'awaiting_approval' && prop.fromStage && prop.fromStage !== 'awaiting_approval') caseStore.update(caseId, { stage: prop.fromStage });
}

/** Deterministic noise in [−0.3, 0.3] with ~8 % standard deviation. */
function outcomeNoise(key: string): number {
  let s = engine.hashOf(key);
  const r = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const g = ((r() + r() + r() + r() - 2) / 0.5774) * 0.08;
  return Math.max(-0.3, Math.min(0.3, g));
}

/** The realised net the executing systems report for a case (forecast × deterministic noise, see outcomeNoise). */
export function realisedNetFor(caseId: string, forecastNet: number): number {
  return Math.round(forecastNet * (1 + outcomeNoise(`${caseId}:outcome`)));
}

/**
 * Records the realised outcome of a case's decision (realised = forecast × noise) in the
 * decision history. One record per case; recording again replaces it.
 */
export function recordOutcome(caseId: string, actor = 'Circularity', figures: { forecastNet?: number; realisedNet?: number } = {}): DecisionHistoryRecord {
  const c = caseStore.get(caseId);
  const d = decide(caseId);
  if (!c || !d) throw new Error(`Case ${caseId} not found`);
  const cc = contextFor(c);
  const forecastNet = figures.forecastNet ?? d.best.net;
  const realisedNet = figures.realisedNet ?? realisedNetFor(caseId, forecastNet);
  const maxId = Math.max(4000, ...state.history.map((h) => Number(h.id.replace(/\D/g, '')) || 0));
  const prior = state.history.find((h) => h.caseId === caseId);
  const rec: DecisionHistoryRecord = {
    id: prior?.id ?? `DH-${maxId + 1}`,
    caseId,
    snapshot: { productClass: c.productClass, productName: c.productName, model: c.model, condition: c.condition, lifePct: cc.lifePct, tenant: c.tenant, site: c.location, quantity: c.quantity },
    channel: cc.intakeChannel,
    route: d.best.route,
    recommendedRoute: d.override ? d.override.fromRoute : d.best.route,
    standardRoute: d.standardRoute,
    forecastNet,
    realisedNet,
    standardNet: d.standard.net,
    gain: forecastNet - d.standard.net,
    realisedGain: realisedNet - d.standard.net,
    namedDemand: d.best.committed && d.best.demands.some((x) => x.kind !== 'recycler_quote'),
    overridden: !!d.override,
    overrideReason: d.override?.reason ?? null,
    decidedBy: d.override ? 'owner' : 'circularity',
    actor: d.override?.actor ?? actor,
    hoursToComplete: Math.max(1, engine.daysBetween(c.receivedDate, ASOF)) * 24,
    closedDaysAgo: 0,
    closedAt: ASOF.slice(0, 10),
  };
  state.history = [rec, ...state.history.filter((h) => h.caseId !== caseId)];
  touch();
  return rec;
}

/* ================================================================ rules + guardrails */

/** The published business rules and their version. */
export function getPublishedRules(): RuleSet {
  return state.ruleSet;
}

/** Locked guardrails GR-01 … GR-06 (changed only by their owner). */
export function getGuardrails(): Guardrail[] {
  return guardrails;
}

/** Returns the guardrail a rule would break, or null when it is allowed. */
export function checkRule(rule: BusinessRule): { guardrailId: string; owner: string; message: string } | null {
  const gr = (id: string, message: string) => {
    const g = guardrails.find((x) => x.id === id);
    return { guardrailId: id, owner: g?.owner ?? '', message };
  };
  const grades = rule.scope.condition ?? [];
  if (rule.route === 'relase' && rule.action !== 'exclude' && grades.some((g) => g === 'D' || g === 'Scrap')) {
    return gr('GR-01', 'Grade D and scrap assets are never re-leased.');
  }
  if ((rule.route === 'intparts' || rule.route === 'extparts') && rule.action !== 'exclude' && rule.scope.lifeMax !== undefined && rule.scope.lifeMax <= policy.fitForUseThreshold) {
    return gr('GR-03', `Parts are certified only at or above the ${policy.fitForUseThreshold} % fit-for-use threshold.`);
  }
  if (rule.action === 'exclude' && (rule.route === 'exit' || rule.route === 'material') && !rule.scope.productClass?.length && !rule.scope.condition?.length && !rule.scope.channel?.length && !rule.scope.site?.length) {
    return gr('GR-06', 'Material Recovery and Responsible Exit cannot be removed for every asset; certified end-of-life must stay available.');
  }
  return null;
}

/**
 * Publishes a new rule set (Workflow Studio). Every decision re-plans. Throws when a rule
 * breaks a guardrail or the version does not move forward.
 */
export function publishRules(rules: BusinessRule[], version: number, actor: string): RuleSet {
  if (version <= state.ruleSet.version) throw new Error(`Version ${version} must be greater than the published version ${state.ruleSet.version}`);
  for (const r of rules) {
    const hit = checkRule(r);
    if (hit) throw new Error(`${r.id} breaks ${hit.guardrailId} (owner ${hit.owner}): ${hit.message}`);
  }
  state.previousRuleSets.push(state.ruleSet);
  state.ruleSet = { version, publishedAt: new Date().toISOString(), publishedBy: actor, rules: rules.map((r) => ({ ...r })) };
  touch();
  return state.ruleSet;
}

/** Rolls back to the previously published rule set (as a new version number). */
export function rollbackRules(actor: string): RuleSet {
  const prev = state.previousRuleSets.pop();
  if (!prev) throw new Error('No earlier version to roll back to');
  state.ruleSet = { ...prev, version: state.ruleSet.version + 1, publishedAt: new Date().toISOString(), publishedBy: actor };
  touch();
  return state.ruleSet;
}

/** Notified when rules, overrides, outcomes, the inbox or the case store change. */
export function subscribe(listener: () => void): () => void {
  return caseStore.subscribe(listener);
}

/* ================================================================ how calculated */

const stageLabel = (id: CaseRecord['stage']) => meta.stages.find((s) => s.id === id)?.label ?? id;
const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
/** "due in 3 days", "due today", "2 days overdue". */
const dueWords = (days: number) => (days < 0 ? `${dayWord(-days)} overdue` : days === 0 ? 'due today' : `due in ${dayWord(days)}`);

/** Formula in plain words plus the rows behind a KPI, for the same scope as the KPI. */
export function howCalculated(key: KpiKey, scope: DecisionScope = {}): HowCalculated {
  const routeName = (r: RouteId) => policy.routes[r].name;
  switch (key) {
    case 'decisionsWaiting': {
      const rows = openDecisions(scope).filter((r) => r.case.stage === 'awaiting_approval');
      return {
        key,
        title: 'Awaiting approval',
        formula: 'Count of open cases whose recommended route is waiting for a named owner to approve it (stage "Awaiting approval", GR-05).',
        value: rows.length,
        unit: 'count',
        rows: rows
          .sort((a, b) => a.case.dueInDays - b.case.dueInDays)
          .map(({ case: c, decision: d }) => ({ id: c.id, caseId: c.id, label: `${c.id} · ${c.productName}`, detail: `${routeName(d.best.route)} · ${dueWords(c.dueInDays)} · owner ${d.best.owner}`, value: 1 })),
      };
    }
    case 'gainOverStandard': {
      const rows = openDecisions(scope);
      return {
        key,
        title: 'Gain over the standard route',
        formula:
          'Σ over open decisions of (best-route net in the queue plan − standard-route net). The standard route is what the intake team would do alone: lease end → re-lease (grade A with a lease order) or resale; field return → redeploy (A) or re-lease (B/C) with demand, else material; trade-in → resale; excess → resale (D/scrap → material).',
        value: sum(rows.map((r) => r.decision.gainOverStandard)),
        unit: 'usd',
        rows: rows
          .sort((a, b) => b.decision.gainOverStandard - a.decision.gainOverStandard)
          .map(({ case: c, decision: d }) => ({
            id: c.id,
            caseId: c.id,
            label: `${c.id} · ${c.productName}`,
            detail: `${routeName(d.best.route)} ${engine.usd(d.best.net)} vs ${engine.CHANNEL_SHORT[d.channel]} standard ${routeName(d.standardRoute)} ${engine.usd(d.standard.net)}`,
            value: d.gainOverStandard,
          })),
      };
    }
    case 'queueValue': {
      const rows = openDecisions(scope);
      const plan = currentPlan();
      return {
        key,
        title: 'Queue value',
        formula: `Σ best-route net of open decisions, planned together: each demand record goes to one case (the one that loses most without it) and refurbishment is limited to ${plan.refurbSlots} slots.`,
        value: sum(rows.map((r) => r.decision.best.net)),
        unit: 'usd',
        rows: routeMix(rows.map((r) => ({ route: r.decision.best.route, net: r.decision.best.net }))).map((m) => ({ id: m.route, label: m.name, detail: `${m.n} decisions`, value: m.value })),
      };
    }
    case 'potentialRecovery': {
      const rows = scopedCases(scope).filter((c) => c.stage !== 'handed_off');
      return {
        key,
        title: 'Potential recovery',
        formula:
          'Σ best-route net value of every case not yet handed off. Open cases use the queue plan; approved cases keep the net frozen when they were approved. Net = value lines − cost lines − holding cost per day × days.',
        value: sum(rows.map((c) => c.estimatedNetRecovery)),
        unit: 'usd',
        rows: rows
          .sort((a, b) => b.estimatedNetRecovery - a.estimatedNetRecovery)
          .map((c) => ({ id: c.id, caseId: c.id, label: `${c.id} · ${c.productName}`, detail: `${routeName(c.recommendedRoute)} · ${stageLabel(c.stage)}`, value: c.estimatedNetRecovery })),
      };
    }
    case 'valueAtRisk': {
      const rows = scopedCases(scope).filter((c) => c.valueAtRisk > 0);
      return {
        key,
        title: 'Value at risk',
        formula:
          'Σ over cases of best-route net × the exposure share of its risk reason: missing evidence 35 %, delayed approval 12 %, market price decline 18 %, capacity constraint 22 %, condition deterioration 25 %, no viable route 100 %.',
        value: sum(rows.map((c) => c.valueAtRisk)),
        unit: 'usd',
        rows: rows
          .sort((a, b) => b.valueAtRisk - a.valueAtRisk)
          .map((c) => ({
            id: c.id,
            caseId: c.id,
            label: `${c.id} · ${c.productName}`,
            detail: `${meta.riskReasons.find((r) => r.id === c.riskReason)?.label ?? 'Risk'} · ${Math.round((c.riskReason ? RISK_SHARE[c.riskReason] : 0) * 100)} % of ${engine.usd(c.estimatedNetRecovery)}`,
            value: c.valueAtRisk,
          })),
      };
    }
    case 'forecastAccuracy': {
      const stats = accuracy(scope);
      return {
        key,
        title: 'Forecast accuracy',
        formula: `1 − Σ |realised − forecast| ÷ Σ |forecast| over decisions closed in the last ${HISTORY_WINDOW_DAYS} days (${stats.n} decisions; ${Math.round(stats.within5 * 100)} % within 5 %).`,
        value: Math.round(stats.accuracy * 1000) / 10,
        unit: 'pct',
        rows: historyByRoute(scope).map((g) => ({ id: g.key, label: g.label, detail: `${g.n} decisions · forecast ${engine.usd(g.forecast)} · realised ${engine.usd(g.realised)}`, value: Math.round(g.accuracy * 1000) / 10 })),
      };
    }
  }
}

/* ================================================================ inbox */

type InboxScope = { tenant?: string; site?: string };
const inScopeItem = (it: InboxItem, s?: InboxScope) =>
  !s || ((!s.tenant || s.tenant === 'All' || it.case.tenant === s.tenant) && (!s.site || it.case.location === s.site));

/** New returns received but not yet decided (Dashboard inbox), limited to the user's tenant/site. */
export function getInbox(scope?: InboxScope): InboxItem[] {
  return state.inbox.filter((it) => inScopeItem(it, scope));
}

/**
 * Runs the 7 agents on the inbox items in scope (at most `maxItems`, the "max items per bulk plan"
 * limit): the cases join the open queue as prepared decisions ("Ready for decision", for the Planner
 * to review and send) and their plan decisions are returned. Items of other tenants stay in the inbox.
 */
export function runAgents(scope?: InboxScope, maxItems: number = Number.POSITIVE_INFINITY): RunAgentsResult {
  const inScope = state.inbox.filter((it) => inScopeItem(it, scope));
  const items = inScope.slice(0, Math.max(0, maxItems));
  const today = ASOF.slice(0, 10);
  for (const it of items) {
    registerContext(it.case.id, it.context);
    // Prepared decisions wait for the Planner to review and send them (never straight to the approver).
    if (!caseStore.get(it.case.id)) caseStore.insert({ ...it.case, receivedDate: today, stage: 'ready_for_decision', proposal: undefined });
  }
  state.inbox = state.inbox.filter((it) => !items.includes(it));
  touch();
  const decided = items.flatMap((it) => {
    const decision = decide(it.case.id);
    return decision ? [{ caseId: it.case.id, decision, trail: agentTrail(it.case.id) }] : [];
  });
  return {
    decided,
    gainOverStandard: sum(decided.map((d) => d.decision.gainOverStandard)),
    net: sum(decided.map((d) => d.decision.best.net)),
    remaining: inScope.length - items.length,
  };
}

/**
 * Tops the user's inbox up to 3 new returns (demo); ids never clash with existing cases.
 * With a tenant/site scope the new returns are placed in that tenant/site so the user sees them.
 */
export function refillInbox(scope?: InboxScope): InboxItem[] {
  const used = new Set([...caseStore.all().map((c) => c.id), ...state.inbox.map((i) => i.case.id)]);
  const next: InboxItem[] = [];
  while (next.length + getInbox(scope).length < 3) {
    const t = nextInboxTemplate(used);
    used.add(t.case.id);
    const tenant = scope?.tenant && scope.tenant !== 'All' ? scope.tenant : t.case.tenant;
    next.push({ ...t, case: { ...t.case, tenant, location: scope?.site ?? t.case.location } });
  }
  state.inbox = [...state.inbox, ...next];
  touch();
  return getInbox(scope);
}

/* ================================================================ insights, hand-off, presets */

/**
 * Gates (Eligible / Conditional / Restricted), P10–P90 ranges, cycle time, confidence,
 * "why not the runner-up" and the evidence snapshot id for a decision of a case.
 * @param d the decision on screen (scenario or proposal); defaults to `decide(c.id)`
 */
export function decisionInsights(c: CaseRecord, d?: CaseDecision): DecisionInsights | undefined {
  const dec = d ?? decide(c.id);
  return dec ? insightsFor(c, dec, engineContext(), modelVersion()) : undefined;
}

/**
 * The instructions approving a route would send, with the one-line summary.
 * @param route defaults to the route an approval applies (a proposed route, else the recommendation)
 */
export function instructionPreview(caseId: string, route?: RouteId): InstructionPreview | undefined {
  const c = caseStore.get(caseId);
  const d = decide(caseId);
  if (!c || !d) return undefined;
  const prop = state.proposals.get(caseId);
  const r = route ?? (isOpen(c) && prop?.route ? prop.route : d.best.route);
  const rv = d.all.find((x) => x.route === r) ?? d.best;
  return previewFor(c, rv);
}

/**
 * The frozen approval record of an approved / handed-off case (null while open). Cases approved
 * in this session keep the record made at approval; cases approved before it get a deterministic
 * record (approval time before the "as of" time), frozen on first read.
 */
export function approvalRecord(caseId: string): ApprovalRecord | null {
  const c = caseStore.get(caseId);
  if (!c || isOpen(c)) return null;
  const hit = state.approvals.get(caseId);
  if (hit) return hit;
  const d = decide(caseId);
  if (!d) return null;
  const h = engine.hashOf(`${caseId}:approved`);
  const hoursAgo = c.stage === 'handed_off' ? 80 + (h % 120) : 3 + (h % 70);
  const at = new Date(Date.parse(ASOF) - hoursAgo * 3_600_000).toISOString();
  const rec = buildApproval(c, d, at, 'Approver', true);
  state.approvals.set(caseId, rec);
  return rec;
}

/** Records who is about to approve a case (the Case page calls this just before approving). */
export function noteApprover(caseId: string, name: string): void {
  state.pendingApprover.set(caseId, name);
}

/* Seeded hand-off progress (src/data/commandHandoffs.json, commandOutcomes.json): a case with an
 * outcome reported, or marked delivered, has every step done; "in transit" has none done yet. */
const SEEDED_HANDOFF = new Map((handoffsJson as { id: string; status: string }[]).map((h) => [h.id, h.status]));
const SEEDED_OUTCOME = new Set((outcomesJson as { id: string }[]).map((o) => o.id));
const STATUS_RANK: Record<InstructionStatus, number> = { not_sent: 0, sent: 1, acknowledged: 2, done: 3 };

/**
 * Instructions of a case with their hand-off status: the one source for the Case page Execution
 * tab, My work › Handed off and alerts.
 *
 * - Before approval, and after approval until "Send instruction", every step is 'not_sent'.
 * - Sent in this session: each step is 'sent' at the send time and due `timeLimitHours` working
 *   hours later (Mon–Fri 08:00–17:00 UTC). It moves on only when the executing system reports back
 *   (simulated: acknowledgeInstruction / completeInstruction); the demo clock does not move it.
 * - Handed off before this session: progress is simulated deterministically on the demo clock from
 *   the approval time, consistent with the seeded register (delivered / outcome reported → all done).
 * `overdue` = not done and past due at `now`.
 * @param now ISO time to evaluate against (defaults to the demo clock, see runtime.simNow)
 */
export function handoffInstructions(caseId: string, now: string = simNow()): HandoffInstruction[] {
  const c = caseStore.get(caseId);
  const d = decide(caseId);
  if (!c || !d) return [];
  const apr = approvalRecord(caseId);
  const rv = (apr && d.all.find((r) => r.route === apr.route && r.viable)) || d.best;
  const list = instructionsFor(c, rv);
  const blank = (i: (typeof list)[number]): HandoffInstruction => ({
    ...i,
    caseId,
    approvalRef: apr?.ref ?? '',
    status: 'not_sent',
    sentAt: null,
    dueAt: null,
    overdue: false,
    overdueHours: 0,
    ackAt: null,
    doneAt: null,
    resends: 0,
    lastSentAt: null,
  });
  if (!apr) return list.map(blank);
  const ev = state.handoffs.get(caseId);
  const seeded = !ev?.sentAt && c.stage === 'handed_off';
  const sentAt = ev?.sentAt ?? (seeded ? apr.at : null);
  if (!sentAt) return list.map(blank);
  const seededStatus = SEEDED_HANDOFF.get(caseId);
  const delivered = seeded && (seededStatus === 'delivered' || SEEDED_OUTCOME.has(caseId));
  const t = Date.parse(now);
  return list.map((i, k) => {
    const dueAt = addWorkingHours(sentAt, i.timeLimitHours);
    let status: InstructionStatus = 'sent';
    let ackAt: string | null = null;
    let doneAt: string | null = null;
    if (seeded) {
      // Share of its time limit the owner takes to finish: 0.35–1.65 (above 1 = finishes late).
      const f = 0.35 + ((engine.hashOf(`${caseId}:${i.id}:progress`) % 100) / 100) * 1.3;
      const simDone = addWorkingHours(sentAt, i.timeLimitHours * (delivered ? Math.min(f, 0.9) : f));
      const simAck = addWorkingHours(sentAt, Math.min(1, i.timeLimitHours * 0.25));
      status = delivered || t >= Date.parse(simDone) ? 'done' : t >= Date.parse(simAck) ? 'acknowledged' : 'sent';
      // Not delivered yet: in transit has nothing done; otherwise the last step is still open.
      if (!delivered && status === 'done' && (seededStatus === 'in_transit' || k === list.length - 1)) status = 'acknowledged';
      if (STATUS_RANK[status] >= 2) ackAt = simAck;
      if (status === 'done') doneAt = simDone;
    }
    const se = ev?.steps.get(i.id);
    if (se?.ackAt && STATUS_RANK[status] < 2) {
      status = 'acknowledged';
      ackAt = se.ackAt;
    }
    if (se?.doneAt && status !== 'done') {
      status = 'done';
      doneAt = se.doneAt;
      ackAt = ackAt ?? se.ackAt ?? se.doneAt;
    }
    const overdue = status !== 'done' && t > Date.parse(dueAt);
    return {
      ...i,
      caseId,
      approvalRef: apr.ref,
      status,
      sentAt,
      dueAt,
      overdue,
      overdueHours: overdue ? workingHoursBetween(dueAt, now) : 0,
      ackAt,
      doneAt,
      resends: se?.resends ?? 0,
      lastSentAt: se?.lastSentAt ?? sentAt,
    };
  });
}

/** Where the hand-off of a case stands, from its instruction steps (My work › Handed off uses the same). */
export type HandoffStage = 'staged' | 'in_transit' | 'refurbishing' | 'delivered';
export function handoffStage(steps: HandoffInstruction[]): HandoffStage {
  if (!steps.length || steps.every((i) => i.status === 'not_sent')) return 'staged';
  if (steps.every((i) => i.status === 'done')) return 'delivered';
  return steps.some((i) => i.status === 'done') ? 'refurbishing' : 'in_transit';
}

function handoffEvents(caseId: string): HandoffEvents {
  let e = state.handoffs.get(caseId);
  if (!e) {
    e = { steps: new Map() };
    state.handoffs.set(caseId, e);
  }
  return e;
}
function stepEvents(e: HandoffEvents, id: string) {
  let s = e.steps.get(id);
  if (!s) {
    s = { resends: 0 };
    e.steps.set(id, s);
  }
  return s;
}
function step(caseId: string, instructionId: string): HandoffInstruction {
  const hit = handoffInstructions(caseId).find((i) => i.id === instructionId);
  if (!hit) throw new Error(`${caseId} has no instruction ${instructionId}`);
  return hit;
}

/** Sends every hand-off instruction of an approved case (idempotent: a second call changes nothing). */
export function sendInstructions(caseId: string, at: string = simNow()): HandoffInstruction[] {
  const c = caseStore.get(caseId);
  if (!c) throw new Error(`Case ${caseId} not found`);
  if (c.stage !== 'approved' && c.stage !== 'handed_off') throw new Error(`${caseId} is not approved yet`);
  const e = handoffEvents(caseId);
  const already = handoffInstructions(caseId).some((i) => i.status !== 'not_sent');
  if (!already && !e.sentAt) {
    e.sentAt = at;
    notifyDecisions();
  }
  return handoffInstructions(caseId);
}

/** The executing system acknowledged a sent instruction (simulated system event). */
export function acknowledgeInstruction(caseId: string, instructionId: string, at: string = simNow()): HandoffInstruction {
  const cur = step(caseId, instructionId);
  if (cur.status !== 'sent') throw new Error(`${instructionId} is ${cur.status.replace('_', ' ')}; only a sent instruction can be acknowledged`);
  const e = handoffEvents(caseId);
  // Seeded cases record the send time so later reads keep the same baseline.
  if (!e.sentAt && cur.sentAt) e.sentAt = cur.sentAt;
  stepEvents(e, instructionId).ackAt = at;
  notifyDecisions();
  return step(caseId, instructionId);
}

/** The executing system reported an acknowledged step done (simulated system event). */
export function completeInstruction(caseId: string, instructionId: string, at: string = simNow()): HandoffInstruction {
  const cur = step(caseId, instructionId);
  if (cur.status !== 'acknowledged') throw new Error(`${instructionId} is ${cur.status.replace('_', ' ')}; it must be acknowledged before it can be done`);
  stepEvents(handoffEvents(caseId), instructionId).doneAt = at;
  notifyDecisions();
  return step(caseId, instructionId);
}

/**
 * Sends a sent-but-unacknowledged (or overdue) instruction again. Idempotent: the same instruction
 * id is re-sent, nothing is duplicated; only the resend count and time change.
 */
export function resendInstruction(caseId: string, instructionId: string, at: string = simNow()): HandoffInstruction {
  const cur = step(caseId, instructionId);
  if (!(cur.status === 'sent' || (cur.overdue && cur.status !== 'done'))) {
    throw new Error(`${instructionId} is ${cur.status.replace('_', ' ')}; only a sent, unacknowledged or overdue instruction can be resent`);
  }
  const s = stepEvents(handoffEvents(caseId), instructionId);
  s.resends += 1;
  s.lastSentAt = at;
  notifyDecisions();
  return step(caseId, instructionId);
}

/* ================================================================ decline + re-evaluate */

/** Records why the approver declined, with the decision that was declined. */
export function noteDecline(caseId: string, reason: string, actor: string): DeclineRecord {
  const c = caseStore.get(caseId);
  const d = decide(caseId);
  if (!c || !d) throw new Error(`Case ${caseId} not found`);
  if (!reason.trim()) throw new Error('Give a reason for declining');
  const rec: DeclineRecord = {
    caseId,
    reason: reason.trim(),
    actor,
    at: simNow(),
    route: d.best.route,
    routeName: d.best.routeName,
    net: d.best.net,
    snapshotId: snapshotIdFor(c, d, engineContext(), modelVersion()),
  };
  state.declines.set(caseId, rec);
  notifyDecisions();
  return rec;
}

export function getDecline(caseId: string): DeclineRecord | null {
  return state.declines.get(caseId) ?? null;
}

export function getReevaluation(caseId: string): ReevaluationResult | null {
  return state.reevaluations.get(caseId) ?? null;
}

/** Stages a Planner can re-evaluate from. */
export const REEVALUATE_STAGES: ReadonlySet<CaseRecord['stage']> = new Set<CaseRecord['stage']>(['reevaluate', 'ready_for_decision', 'no_viable_route']);

/**
 * Re-evaluate: rebuilds and re-ranks the routes on a new evidence snapshot (evaluation round + 1)
 * and reports what changed against the declined decision (else the decision before). The case
 * moves to "Ready for decision" (or "No viable route"), from where the Planner sends it again.
 */
export function reevaluate(caseId: string, actor: string): ReevaluationResult {
  const c = caseStore.get(caseId);
  const before = decide(caseId);
  if (!c || !before) throw new Error(`Case ${caseId} not found`);
  if (!REEVALUATE_STAGES.has(c.stage)) throw new Error(`${caseId} is ${c.stage.replace(/_/g, ' ')}; only a declined or prepared decision can be re-evaluated`);
  const declined = state.declines.get(caseId) ?? null;
  const from = declined
    ? { route: declined.route, routeName: declined.routeName, net: declined.net, snapshotId: declined.snapshotId }
    : { route: before.best.route, routeName: before.best.routeName, net: before.best.net, snapshotId: snapshotIdFor(c, before, engineContext(), modelVersion()) };
  caseStore.update(caseId, { evaluationRound: (c.evaluationRound ?? 0) + 1, blockedReason: null });
  const after = decide(caseId);
  if (!after) throw new Error(`Case ${caseId} not found`);
  const stage: CaseRecord['stage'] = after.best.viable ? 'ready_for_decision' : 'no_viable_route';
  if (caseStore.get(caseId)?.stage !== stage) caseStore.update(caseId, { stage });
  const c2 = caseStore.get(caseId) ?? c;
  const final = decide(caseId) ?? after;
  const changed = final.best.route !== from.route;
  const netDelta = final.best.net - from.net;
  const delta = `${netDelta >= 0 ? '+' : '−'}${engine.usd(Math.abs(netDelta))}`;
  const rec: ReevaluationResult = {
    caseId,
    at: simNow(),
    actor,
    fromRoute: from.route,
    fromRouteName: from.routeName,
    fromNet: from.net,
    fromSnapshotId: from.snapshotId,
    toRoute: final.best.route,
    toRouteName: final.best.routeName,
    toNet: final.best.net,
    toSnapshotId: snapshotIdFor(c2, final, engineContext(), modelVersion()),
    changed,
    netDelta,
    declineReason: declined?.reason ?? null,
    summary: !final.best.viable
      ? `No route is viable on the new evidence (was ${from.routeName} at ${engine.usd(from.net)}).`
      : changed
        ? `Recommendation changed from ${from.routeName} (${engine.usd(from.net)}) to ${final.best.routeName} (${engine.usd(final.best.net)}), net ${delta}.`
        : `Recommendation unchanged: ${final.best.routeName} at ${engine.usd(final.best.net)} (net ${delta}).`,
  };
  state.reevaluations.set(caseId, rec);
  notifyDecisions();
  return rec;
}

/** Escalation above the approver's limit for a case (null when none). */
export function getEscalation(caseId: string) {
  return state.escalations.get(caseId) ?? null;
}

/** Every overdue hand-off instruction across approved / handed-off cases in scope (for escalations). */
export function overdueInstructions(scope: DecisionScope = {}, now: string = simNow()): HandoffInstruction[] {
  return scopedCases(scope)
    .filter((c) => !isOpen(c))
    .flatMap((c) => handoffInstructions(c.id, now).filter((i) => i.overdue));
}

export { PRESETS, RANGE_FORMULA, compactRange, GATE_NAMES } from './decision/insights';

/** Scenario levers on screen: slider indices and blocked routes (Case page Scenario card). */
export interface CaseLevers {
  params?: Partial<DecisionParams>;
  blocked?: RouteId[];
}

function availFor(c: CaseRecord, cancelled: string[] = []): Availability {
  let base: Availability;
  if (isOpen(c) && caseStore.get(c.id)) base = planAvailability(c.id, currentPlan());
  else {
    const committed = committedDemands(rawCases());
    for (const id of c.demandIds ?? []) committed.delete(id);
    base = { taken: new Set(committed.keys()), holder: committed, slotsLeft: Number.POSITIVE_INFINITY };
  }
  if (!cancelled.length) return base;
  const holder = new Map(base.holder ?? []);
  for (const id of cancelled) holder.set(id, engine.CANCELLED);
  return { taken: new Set([...base.taken, ...cancelled]), holder, slotsLeft: base.slotsLeft };
}

/**
 * Re-decides a case under the scenario levers plus an edge-case preset applied to all routes
 * or one route (rest of the queue fixed). Without a preset it equals `simulateCase`.
 */
export function stressCase(
  c: CaseRecord,
  levers: CaseLevers,
  preset: PresetId | null,
  applyTo: 'all' | RouteId = 'all',
): { decision: CaseDecision; action: NextBestAction; stress: PresetStress | null } {
  const hasLevers = !!levers.params || !!levers.blocked?.length;
  const base = hasLevers ? simulateCase(c, levers) : (decide(c.id) ?? decideCase(c));
  const open = isOpen(c);
  if (!preset) return { decision: base, action: buildNextBestAction(c, base, engineContext(), !open, null), stress: null };
  const stress = presetStress(preset, applyTo, base, levers.params);
  const avail = availFor(c, stress.cancelled);
  const decision = engine.decideCase(c, engineContext(), {
    params: { ...(levers.params ?? {}), ...(stress.params ?? {}) },
    blocked: levers.blocked,
    restricted: stress.restricted,
    routeParams: stress.routeParams,
    avail,
    standardAvail: avail,
    override: open ? (state.overrides.get(c.id) ?? null) : null,
  });
  return { decision, action: buildNextBestAction(c, decision, engineContext(), !open, null), stress };
}

/** For each preset (applied to all routes): does it change the recommended route? */
export function rankingFlips(c: CaseRecord, levers: CaseLevers = {}): PresetFlip[] {
  const base = stressCase(c, levers, null).decision;
  return insightsPresets.map((p) => {
    const d = stressCase(c, levers, p.id, 'all').decision;
    const to = d.best.viable ? d.best : null;
    const flips = !to || to.route !== base.best.route;
    const what = p.label.charAt(0).toLowerCase() + p.label.slice(1);
    return {
      preset: p.id,
      label: p.label,
      flips,
      from: base.best.route,
      to: to?.route ?? null,
      toName: to?.routeName ?? null,
      toNet: to?.net ?? null,
      text: flips
        ? `Ranking flips if ${what}: ${to ? `${to.routeName} (${engine.usd(to.net)}) moves to first` : 'no route stays viable'}.`
        : `${p.label}: ${base.best.routeName} stays first${to ? ` at ${engine.usd(to.net)}` : ''}.`,
    };
  });
}

/* ================================================================ async service */

/** Async wrappers for pages (simulated latency). Synchronous versions are exported above. */
export const decisionService = {
  subscribe,
  subscribeRules: subscribeDecisions,

  async decision(caseId: string): Promise<CaseDecision | undefined> {
    await delay(160);
    return decide(caseId);
  },
  async plan(): Promise<QueuePlan> {
    await delay();
    return planQueue();
  },
  async nextBestAction(caseId: string): Promise<NextBestAction | undefined> {
    await delay(160);
    return nextBestAction(caseId);
  },
  async agentTrail(caseId: string): Promise<AgentStep[]> {
    await delay(160);
    return agentTrail(caseId);
  },
  async summary(scope: DecisionScope = {}): Promise<DecisionSummary> {
    await delay();
    return summary(scope);
  },
  async whatIf(params: Partial<DecisionParams>, scope: DecisionScope = {}): Promise<WhatIfResult> {
    await delay(300);
    return whatIf(params, scope);
  },
  async howCalculated(key: KpiKey, scope: DecisionScope = {}): Promise<HowCalculated> {
    await delay(160);
    return howCalculated(key, scope);
  },
  async history(q: HistoryQuery = {}, scope: DecisionScope = {}): Promise<Paged<DecisionHistoryRecord>> {
    await delay();
    return listHistory(q, scope);
  },
  async learning(scope: DecisionScope = {}) {
    await delay();
    return {
      accuracy: accuracy(scope),
      byRoute: historyByRoute(scope),
      byChannel: historyByChannel(scope),
      byWeek: historyByWeek(scope),
      overrides: overrideStats(scope),
      matrix: accuracyMatrix(scope),
    };
  },
  async override(caseId: string, route: RouteId, reason: OverrideReason, actor: string): Promise<CaseDecision> {
    await delay(300);
    return override(caseId, route, reason, actor);
  },
  async clearOverride(caseId: string): Promise<void> {
    await delay(200);
    clearOverride(caseId);
  },
  async proposeRoute(caseId: string, route: RouteId | null, reason: OverrideReason | null, note: string, actor: string, who?: { id?: string; role?: string }): Promise<RouteProposal> {
    await delay(300);
    return proposeRoute(caseId, route, reason, note, actor, who);
  },
  async proposedAction(caseId: string): Promise<{ decision: CaseDecision; action: NextBestAction } | null> {
    await delay(160);
    return proposedAction(caseId);
  },
  async withdrawProposal(caseId: string, actor: string): Promise<void> {
    await delay(200);
    withdrawProposal(caseId, actor);
  },
  async recordOutcome(caseId: string, actor?: string): Promise<DecisionHistoryRecord> {
    await delay(300);
    return recordOutcome(caseId, actor);
  },
  async rules(): Promise<RuleSet> {
    await delay(160);
    return getPublishedRules();
  },
  async guardrails(): Promise<Guardrail[]> {
    await delay(160);
    return getGuardrails();
  },
  async publishRules(rules: BusinessRule[], version: number, actor: string): Promise<RuleSet> {
    await delay(350);
    return publishRules(rules, version, actor);
  },
  async rollbackRules(actor: string): Promise<RuleSet> {
    await delay(350);
    return rollbackRules(actor);
  },
  async inbox(scope?: InboxScope): Promise<InboxItem[]> {
    await delay(160);
    return getInbox(scope);
  },
  async runAgents(scope?: InboxScope, maxItems?: number): Promise<RunAgentsResult> {
    await delay(600);
    return runAgents(scope, maxItems);
  },
  async refillInbox(scope?: InboxScope): Promise<InboxItem[]> {
    await delay(200);
    return refillInbox(scope);
  },
  async insights(caseId: string): Promise<DecisionInsights | undefined> {
    await delay(120);
    const c = caseStore.get(caseId);
    return c ? decisionInsights(c) : undefined;
  },
  async instructionPreview(caseId: string, route?: RouteId): Promise<InstructionPreview | undefined> {
    await delay(120);
    return instructionPreview(caseId, route);
  },
  /** Hand-off instructions with status, due time and overdue flag (see `handoffInstructions`). */
  async handoffInstructions(caseId: string, now?: string): Promise<HandoffInstruction[]> {
    await delay(120);
    return handoffInstructions(caseId, now);
  },
  async overdueInstructions(scope: DecisionScope = {}, now?: string): Promise<HandoffInstruction[]> {
    await delay(160);
    return overdueInstructions(scope, now);
  },
  async approvalRecord(caseId: string): Promise<ApprovalRecord | null> {
    await delay(120);
    return approvalRecord(caseId);
  },
  async rankingFlips(caseId: string): Promise<PresetFlip[]> {
    await delay(160);
    const c = caseStore.get(caseId);
    return c ? rankingFlips(c) : [];
  },
};
