/**
 * Portfolio analytics views built on the decision engine (decisionService):
 * - Portfolio What-if + queue plan (/analytics/whatif)
 * - Forecast accuracy from decision history (/analytics/forecast, Accuracy tab)
 * - Owner overrides from decision history (/analytics/forecast?tab=overrides)
 *
 * Every number comes from decisionService so these pages agree with the Case page,
 * the Dashboard and Key Figures. Pages call the async `portfolioAnalyticsService.*`
 * through useServiceQuery and subscribe with `portfolioAnalyticsService.subscribe`.
 */
import type {
  AccuracyMatrix,
  AccuracyStats,
  DecisionHistoryRecord,
  DecisionParams,
  DecisionScope,
  DemandKind,
  HistoryGroup,
  IntakeChannel,
  OverrideReason,
  QueuePlan,
  RouteId,
  WhatIfChange,
  WhatIfResult,
} from '@/models/decision.model';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import { delay, sum } from './mock/mockUtils';
import {
  accuracyMatrix,
  accuracyOf,
  CHANNEL_LABEL,
  channelOf,
  defaultParams,
  getDemand,
  getPolicy,
  historyByRoute,
  historyByWeek,
  listHistory,
  OVERRIDE_REASONS,
  overrideStats,
  planQueue,
  scopedCases,
  subscribe,
  whatIf,
} from './decisionService';

export const DEMAND_KIND_LABEL: Record<DemandKind, string> = {
  lease_order: 'Lease order',
  lease_renewal: 'Lease renewal',
  sales_order: 'Sales order',
  buyer_bid: 'Buyer bid',
  redeploy_request: 'Redeploy request',
  repair_order: 'Repair order',
  recycler_quote: 'Recycler quote',
};

export const routeName = (r: RouteId) => getPolicy().routes[r].name;
/** Short route label for tight table cells ("Re-lease", "Resale"). */
export const routeShort = (r: RouteId) => DISPOSITION_ROUTES[r]?.shortLabel ?? routeName(r);

/** True when the case is still in the case store (closed history cases from before the store are not), so it can be linked. */
export function hasCase(id: string): boolean {
  return scopedCases().some((c) => c.id === id);
}

/* ================================================================ what-if */

export interface WhatIfChangeRow extends WhatIfChange {
  productName: string;
  channel: IntakeChannel;
  channelLabel: string;
}

export interface ContestedRow {
  demandId: string;
  kind: DemandKind;
  kindLabel: string;
  customer: string;
  wantedBy: string[];
  /** Case the plan gives the demand to (null = nobody could use it in time). */
  plannedFor: string | null;
  /** How much more the plan earns by giving it to `plannedFor` instead of the next claimant. */
  worthMoreBy: number;
}

export interface QueuePlanView {
  planValue: number;
  fcfsValue: number;
  standardValue: number;
  /** planValue − fcfsValue. */
  gain: number;
  refurbSlotsUsed: number;
  refurbSlots: number;
  contested: ContestedRow[];
  openCases: number;
}

export interface WhatIfView {
  defaults: DecisionParams;
  result: WhatIfResult;
  /** today − 0 baseline helpers */
  gainVsToday: number;
  changes: WhatIfChangeRow[];
  /** Decisions whose route changes (not only the net). */
  routeChanges: number;
  plan: QueuePlanView;
}

function planView(plan: QueuePlan, openCases: number): QueuePlanView {
  return {
    planValue: plan.planValue,
    fcfsValue: plan.fcfsValue,
    standardValue: plan.standardValue,
    gain: plan.gain,
    refurbSlotsUsed: plan.refurbSlotsUsed,
    refurbSlots: plan.refurbSlots,
    openCases,
    contested: plan.contested
      .map((c) => ({
        demandId: c.demandId,
        kind: c.kind,
        kindLabel: DEMAND_KIND_LABEL[c.kind],
        customer: getDemand(c.demandId)?.customer ?? '—',
        wantedBy: c.wantedBy,
        plannedFor: c.assignedTo,
        worthMoreBy: c.gain,
      }))
      .sort((a, b) => b.worthMoreBy - a.worthMoreBy),
  };
}

/** What-if under the given levers plus the queue plan under the same levers. */
export function computeWhatIf(params: Partial<DecisionParams>, scope: DecisionScope = {}): WhatIfView {
  const defaults = defaultParams(getPolicy());
  // Decisions and totals follow the user's tenant/site; the queue plan stays whole-queue
  // because orders and refurbishment slots are shared across tenants.
  const result = whatIf(params, scope);
  const full = result.params;
  const plan = planQueue(undefined, full);
  const cases = new Map(scopedCases(scope).map((c) => [c.id, c]));
  const changes = result.changes.map((ch) => {
    const channel = channelOf(ch.caseId);
    return { ...ch, productName: cases.get(ch.caseId)?.productName ?? '', channel, channelLabel: CHANNEL_LABEL[channel] };
  });
  return {
    defaults,
    result,
    gainVsToday: result.scenario - result.today,
    changes,
    routeChanges: changes.filter((c) => c.from !== c.to).length,
    plan: planView(plan, Object.keys(plan.decisions).length),
  };
}

/* ================================================================ history (accuracy + overrides) */

function allHistory(): DecisionHistoryRecord[] {
  return listHistory({ pageSize: 100_000, sortBy: 'closedDaysAgo', sortDir: 'asc' }).items;
}

/** Records closed within 5 % of the forecast (same rule as decisionService.accuracyMatrix). */
export const isWithin5 = (h: DecisionHistoryRecord) => Math.abs(h.realisedNet - h.forecastNet) <= 0.05 * Math.max(1, Math.abs(h.forecastNet));

export interface DrillSummary extends AccuracyStats {
  gainOverStandard: number;
}

/** Summary KPIs for a drill-down set of decisions. */
export function drillSummary(records: DecisionHistoryRecord[]): DrillSummary {
  return { ...accuracyOf(records), gainOverStandard: sum(records.map((h) => h.realisedGain)) };
}

export interface ForecastView {
  accuracy: AccuracyStats;
  matrix: AccuracyMatrix;
  byRoute: HistoryGroup[];
  byWeek: HistoryGroup[];
  records: DecisionHistoryRecord[];
}

/** Forecast accuracy of every closed decision: the one figure shown on Predicted vs actual and Overrides. */
export function forecastAccuracy(records: DecisionHistoryRecord[] = allHistory()): AccuracyStats {
  return accuracyOf(records);
}

export function computeForecast(): ForecastView {
  const records = allHistory();
  return { accuracy: forecastAccuracy(records), matrix: accuracyMatrix(), byRoute: historyByRoute(), byWeek: historyByWeek(), records };
}

export interface OverridesView {
  /** Closed decisions in the history. */
  closed: number;
  overrides: DecisionHistoryRecord[];
  share: number;
  byReason: { reason: OverrideReason; n: number; accuracy: number; realisedGain: number }[];
  ownerAccuracy: AccuracyStats;
  circularityAccuracy: AccuracyStats;
  /** All closed decisions: the same computation and value as Predicted vs actual. */
  allAccuracy: AccuracyStats;
  /** Overrides on open cases logged in this session (Case page). */
  open: { caseId: string; productName: string; fromRoute: RouteId; route: RouteId; reason: OverrideReason; actor: string; at: string }[];
  reasons: OverrideReason[];
}

export function computeOverrides(): OverridesView {
  const records = allHistory();
  const stats = overrideStats();
  const overrides = records.filter((h) => h.overridden);
  const cases = new Map(scopedCases().map((c) => [c.id, c]));
  return {
    closed: records.length,
    overrides,
    share: stats.share,
    byReason: stats.byReason,
    ownerAccuracy: accuracyOf(overrides),
    circularityAccuracy: accuracyOf(records.filter((h) => !h.overridden)),
    allAccuracy: forecastAccuracy(records),
    open: stats.recent.map((o) => ({ ...o, productName: cases.get(o.caseId)?.productName ?? '' })),
    reasons: OVERRIDE_REASONS,
  };
}

/* ================================================================ async service */

export const portfolioAnalyticsService = {
  subscribe,
  async whatIf(params: Partial<DecisionParams>, scope: DecisionScope = {}): Promise<WhatIfView> {
    await delay(120);
    return computeWhatIf(params, scope);
  },
  async forecast(): Promise<ForecastView> {
    await delay();
    return computeForecast();
  },
  async overrides(): Promise<OverridesView> {
    await delay();
    return computeOverrides();
  },
};
