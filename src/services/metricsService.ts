/**
 * Portfolio metrics computed from the same case / exception / history data that
 * the tables use, so figures agree everywhere (Key Figures, Dashboard, Exceptions).
 *
 * Recommended route, estimated net recovery and value at risk on open cases come from the
 * decision engine's queue plan (caseStore is decorated by src/services/decision/runtime.ts):
 * potential recovery = Σ best-route net of cases not yet handed off, the same number as
 * decisionService.howCalculated('potentialRecovery', scope).
 */
import type { CaseRecord, CaseStageId, MonthlyHistory, RiskReasonId } from '@/models/domain.model';
import type { DispositionRouteId } from '@/models/treatment.model';
import { capacity, caseStore, exceptionStore, history, meta } from './mock/stores';
import { delay, sum } from './mock/mockUtils';
import { scopeCases } from './caseService';

export interface Scope {
  tenant?: string;
  site?: string;
  route?: DispositionRouteId | 'all';
  productClass?: string;
}

export interface PortfolioSummary {
  assetsInScope: number;
  potentialRecovery: number;
  valueAtRisk: number;
  awaitingApproval: { count: number; value: number };
  evidenceGaps: number;
  closingSoon: number;
  lifecycle: { id: CaseStageId; label: string; count: number }[];
  routeOpportunity: { id: DispositionRouteId; label: string; count: number; value: number }[];
  valueAtRiskByReason: { id: RiskReasonId; label: string; value: number; count: number }[];
  timeToAction: { id: string; label: string; count: number; tone: 'danger' | 'warning' | 'neutral' | 'success' }[];
  needsAttention: { id: string; label: string; detail: string; href: string; tone: 'danger' | 'warning' | 'info' }[];
}

export interface ValueRealisation {
  months: MonthlyHistory[];
  totals: { netRecovery: number; predicted: number; recoveryYield: number; cycleTimeDays: number; co2AvoidedT: number; avoidedSpend: number; decisionsClosed: number };
  previous: { netRecovery: number; recoveryYield: number; cycleTimeDays: number };
}

/** $1.25M / $58k / $460; negatives as "−$21" (sign before the currency, true minus sign). */
const fmtK = (n: number): string => {
  if (n < 0) return `−${fmtK(-n)}`;
  return n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;
};

function scoped(scope: Scope): CaseRecord[] {
  let cases = scopeCases(caseStore.all(), scope);
  if (scope.route && scope.route !== 'all') cases = cases.filter((c) => c.recommendedRoute === scope.route);
  if (scope.productClass && scope.productClass !== 'all') cases = cases.filter((c) => c.productClass === scope.productClass);
  return cases;
}

export function computeSummary(scope: Scope = {}): PortfolioSummary {
  const cases = scoped(scope);
  const awaiting = cases.filter((c) => c.stage === 'awaiting_approval');
  const gaps = cases.filter((c) => c.stage === 'awaiting_inspection' || c.stage === 'needs_information');
  const actionable = cases.filter((c) => c.stage !== 'handed_off');

  const lifecycle = meta.stages.map((s) => ({ id: s.id, label: s.label, count: cases.filter((c) => c.stage === s.id).length }));

  const routeOpportunity = meta.routes
    .map((r) => {
      const list = cases.filter((c) => c.recommendedRoute === r.id);
      return { id: r.id, label: r.name, count: list.length, value: sum(list.map((c) => c.estimatedNetRecovery)) };
    })
    .filter((r) => r.count > 0);

  const valueAtRiskByReason = meta.riskReasons
    .map((r) => {
      const list = cases.filter((c) => c.riskReason === r.id);
      return { id: r.id, label: r.label, value: sum(list.map((c) => c.valueAtRisk)), count: list.length };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.value - a.value);

  const bucket = (lo: number, hi: number) => actionable.filter((c) => c.dueInDays >= lo && c.dueInDays <= hi).length;
  const timeToAction = [
    { id: 'lt5', label: 'Under 5 days', count: actionable.filter((c) => c.dueInDays < 5).length, tone: 'danger' as const },
    { id: '5to7', label: '5–7 days', count: bucket(5, 7), tone: 'warning' as const },
    { id: '8to10', label: '8–10 days', count: bucket(8, 10), tone: 'neutral' as const },
    { id: 'gt10', label: 'Over 10 days', count: actionable.filter((c) => c.dueInDays > 10).length, tone: 'success' as const },
  ];

  const valueAtRisk = sum(cases.map((c) => c.valueAtRisk));
  const topReason = valueAtRiskByReason[0];
  const openExceptions = exceptionStore.all().filter((e) => e.status !== 'resolved' && (!scope.site || e.warehouse === scope.site));
  const needsAttention: PortfolioSummary['needsAttention'] = [];
  if (awaiting.length)
    needsAttention.push({ id: 'approvals', label: `${awaiting.length} decisions await approval`, detail: `${fmtK(sum(awaiting.map((c) => c.estimatedNetRecovery)))} predicted net recovery`, href: '/command/actions?tab=approvals', tone: 'warning' });
  if (valueAtRisk && topReason)
    needsAttention.push({ id: 'risk', label: `${fmtK(valueAtRisk)} at risk`, detail: `Mostly ${topReason.label.toLowerCase()} (${Math.round((topReason.value / valueAtRisk) * 100)}%)`, href: '/command/exceptions', tone: 'danger' });
  if (gaps.length)
    needsAttention.push({ id: 'gaps', label: `${gaps.length} assets cannot be routed yet`, detail: 'Waiting for inspection or remaining-life evidence', href: '/product/received?stage=awaiting_inspection', tone: 'warning' });
  if (openExceptions.some((e) => e.type === 'integration_failure'))
    needsAttention.push({ id: 'feed', label: 'A source feed is stale', detail: 'EAM condition grades have not refreshed for 26 hours', href: '/integration/map', tone: 'info' });

  return {
    assetsInScope: cases.length,
    potentialRecovery: sum(actionable.map((c) => c.estimatedNetRecovery)),
    valueAtRisk,
    awaitingApproval: { count: awaiting.length, value: sum(awaiting.map((c) => c.estimatedNetRecovery)) },
    evidenceGaps: gaps.length,
    closingSoon: actionable.filter((c) => c.dueInDays >= 0 && c.dueInDays <= 5).length,
    lifecycle,
    routeOpportunity,
    valueAtRiskByReason,
    timeToAction,
    needsAttention,
  };
}

export function computeValueRealisation(months: number): ValueRealisation {
  const slice = history.slice(-months);
  const prev = history.slice(-months * 2, -months);
  const agg = (list: MonthlyHistory[]) => {
    const actual = sum(list.map((m) => m.actualRecovery));
    const predicted = sum(list.map((m) => m.predictedRecovery));
    return {
      netRecovery: actual,
      predicted,
      recoveryYield: predicted ? actual / predicted : 0,
      cycleTimeDays: list.length ? +(sum(list.map((m) => m.cycleTimeDays)) / list.length).toFixed(1) : 0,
      co2AvoidedT: +sum(list.map((m) => m.co2AvoidedT)).toFixed(0),
      avoidedSpend: sum(list.map((m) => m.avoidedSpend)),
      decisionsClosed: sum(list.map((m) => m.decisionsClosed)),
    };
  };
  const t = agg(slice);
  const p = agg(prev);
  return { months: slice, totals: t, previous: { netRecovery: p.netRecovery, recoveryYield: p.recoveryYield, cycleTimeDays: p.cycleTimeDays } };
}

export const metricsService = {
  subscribe: (l: () => void) => {
    const a = caseStore.subscribe(l);
    const b = exceptionStore.subscribe(l);
    return () => {
      a();
      b();
    };
  },
  async portfolio(scope: Scope = {}): Promise<PortfolioSummary> {
    await delay();
    return computeSummary(scope);
  },
  async valueRealisation(months = 12): Promise<ValueRealisation> {
    await delay(260);
    return computeValueRealisation(months);
  },
  async capacity(site?: string) {
    await delay(200);
    return capacity.filter((c) => !site || c.site === site);
  },
  meta: () => meta,
};

export { fmtK };
