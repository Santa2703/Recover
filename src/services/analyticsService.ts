/**
 * Analytics: pipeline funnel, sustainability (CO₂e), pool efficiency, recovery
 * waterfall, route mix, predicted vs actual, model releases, overrides and economics.
 * History-based reports (waterfall, mix, accuracy, model bias) derive from history.json,
 * so they agree with Value realisation; analyticsReports.json holds their configuration
 * and the domain records (model registry, overrides, pathway economics).
 *
 * Live figures are computed from the core stores (cases, history, meta) so they
 * agree with Command Center and Value realisation. analytics.json only holds the
 * configuration the core dataset does not carry: stage durations, measured-share
 * per month, emission factors and pool demand.
 */
import analyticsJson from '@/data/analytics.json';
import reportsJson from '@/data/analyticsReports.json';
import type { CaseRecord, CaseStageId, MonthlyHistory } from '@/models/domain.model';
import type { DispositionRouteId } from '@/models/treatment.model';
import { caseStore, history, meta, userStore } from './mock/stores';
import { delay, sum } from './mock/mockUtils';
import { scopeCases } from './caseService';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';

/* ------------------------------------------------------------------ types */

export type FunnelStageId = 'received' | 'inspected' | 'evidence_complete' | 'approved' | 'handed_off' | 'reconciled';

interface AnalyticsConfig {
  pipeline: {
    cohortMonth: string;
    closedShareByTenant: Record<string, number>;
    closedShareBySite: Record<string, number>;
    stages: { id: FunnelStageId; label: string; description: string; liveStages: CaseStageId[]; medianDays: number | null }[];
    durationFactorByTenant: Record<string, number>;
    durationFactorBySite: Record<string, number>;
  };
  sustainability: {
    monthly: { month: string; measuredShare: number; materialsDivertedT: number }[];
    routeIntensity: Record<DispositionRouteId, number>;
    emissionFactors: EmissionFactor[];
  };
  pools: {
    id: string;
    productClass: CaseRecord['productClass'];
    name: string;
    unitValueRedeploy: number;
    unitValueResale: number;
    greedyFit: number;
    demand: Record<string, { internal: number; external: number }>;
  }[];
}

const config = analyticsJson as unknown as AnalyticsConfig;

export interface AnalyticsFilter {
  /** 'All' or undefined = every tenant. */
  tenant?: string;
  /** 'All' or undefined = every site. */
  site?: string;
}

export interface FunnelStage {
  id: FunnelStageId;
  label: string;
  description: string;
  /** Cases that reached this stage (live cases at or beyond it + reconciled decisions). */
  reached: number;
  /** Live cases sitting in this stage now. */
  current: number;
  /** reached / reached of previous stage (1 for the first stage). */
  conversion: number;
  /** reached / reached of the first stage. */
  cumulative: number;
  /** Median days spent in the stage; null for the terminal stage. */
  medianDays: number | null;
}

export interface PipelineReport {
  cohortMonth: string;
  stages: FunnelStage[];
  kpis: {
    inPipeline: number;
    conversionToApproval: number;
    medianDaysPerStage: number;
    endToEndDays: number;
    reconciled: number;
    offFunnel: number;
  };
}

export interface ReconciledMonth {
  month: string;
  decisions: number;
}

export interface SustainMonth {
  month: string;
  total: number;
  measured: number;
  estimated: number;
  materialsDivertedT: number;
}

export interface EmissionFactor {
  id: string;
  factor: string;
  value: number;
  unit: string;
  source: string;
  version: string;
  lastUpdated: string;
}

export interface SustainReport {
  months: SustainMonth[];
  byRoute: { id: DispositionRouteId; label: string; value: number }[];
  factors: EmissionFactor[];
  kpis: {
    co2AvoidedT: number;
    measuredShare: number;
    materialsDivertedT: number;
    /** Same figures for the preceding period of equal length (null when history is too short). */
    previous: { co2AvoidedT: number; measuredShare: number; materialsDivertedT: number } | null;
  };
}

export type PoolStatus = 'shortfall' | 'balanced' | 'surplus';

export interface PoolResult {
  id: string;
  name: string;
  productClass: CaseRecord['productClass'];
  available: number;
  demand: number;
  internalDemand: number;
  externalDemand: number;
  allocated: number;
  allocatedRedeploy: number;
  allocatedResale: number;
  unmet: number;
  /** allocated / available */
  utilisation: number;
  /** allocated / demand */
  fulfilment: number;
  optimalValue: number;
  greedyValue: number;
  status: PoolStatus;
}

export interface PoolReport {
  pools: PoolResult[];
  kpis: {
    available: number;
    allocated: number;
    demand: number;
    allocationRate: number;
    optimalValue: number;
    greedyValue: number;
    uplift: number;
    unmet: number;
  };
}

/* --------------------------------------------------------------- helpers */

const isAll = (v?: string) => !v || v === 'All';
const round1 = (n: number) => Math.round(n * 10) / 10;

function scopedCases(f: AnalyticsFilter): CaseRecord[] {
  return scopeCases(caseStore.all(), { tenant: isAll(f.tenant) ? undefined : f.tenant, site: isAll(f.site) ? undefined : f.site });
}

/** Share of closed decisions attributable to the filter (history is not split by tenant/site). */
function closedShare(f: AnalyticsFilter): number {
  const p = config.pipeline;
  const t = isAll(f.tenant) ? 1 : p.closedShareByTenant[f.tenant!] ?? 0;
  const s = isAll(f.site) ? 1 : p.closedShareBySite[f.site!] ?? 0;
  return t * s;
}

function durationFactor(f: AnalyticsFilter): number {
  const p = config.pipeline;
  const t = isAll(f.tenant) ? 1 : p.durationFactorByTenant[f.tenant!] ?? 1;
  const s = isAll(f.site) ? 1 : p.durationFactorBySite[f.site!] ?? 1;
  return t * s;
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/* -------------------------------------------------------------- pipeline */

export function computePipeline(f: AnalyticsFilter = {}): PipelineReport {
  const cases = scopedCases(f);
  const cohort = history.find((m) => m.month === config.pipeline.cohortMonth) ?? history[history.length - 1];
  const reconciled = Math.round(cohort.decisionsClosed * closedShare(f));
  const defs = config.pipeline.stages;
  const indexOfLive = (stage: CaseStageId) => defs.findIndex((d) => d.liveStages.includes(stage));
  const factor = durationFactor(f);

  const currentByIndex = defs.map((_, i) => cases.filter((c) => indexOfLive(c.stage) === i).length);
  const reachedByIndex = defs.map((_, i) => reconciled + sum(currentByIndex.slice(i)));
  // Re-evaluate and no-viable-route cases sit at "Evidence complete" but have left the forward path.
  const offFunnel = cases.filter((c) => c.stage === 'reevaluate' || c.stage === 'no_viable_route').length;

  const stages: FunnelStage[] = defs.map((d, i) => ({
    id: d.id,
    label: d.label,
    description: d.description,
    reached: reachedByIndex[i],
    current: d.id === 'reconciled' ? reconciled : currentByIndex[i],
    conversion: i === 0 ? 1 : reachedByIndex[i - 1] ? reachedByIndex[i] / reachedByIndex[i - 1] : 0,
    cumulative: reachedByIndex[0] ? reachedByIndex[i] / reachedByIndex[0] : 0,
    medianDays: d.medianDays === null ? null : round1(d.medianDays * factor),
  }));

  const durations = stages.map((s) => s.medianDays).filter((v): v is number => v !== null);
  const approvedIdx = defs.findIndex((d) => d.id === 'approved');
  return {
    cohortMonth: cohort.month,
    stages,
    kpis: {
      inPipeline: cases.length,
      conversionToApproval: reachedByIndex[0] ? reachedByIndex[approvedIdx] / reachedByIndex[0] : 0,
      medianDaysPerStage: round1(median(durations)),
      endToEndDays: round1(sum(durations)),
      reconciled,
      offFunnel,
    },
  };
}

export function stageCases(stage: FunnelStageId, f: AnalyticsFilter = {}): CaseRecord[] {
  const def = config.pipeline.stages.find((d) => d.id === stage);
  if (!def) return [];
  return scopedCases(f)
    .filter((c) => def.liveStages.includes(c.stage))
    .sort((a, b) => a.receivedDate.localeCompare(b.receivedDate));
}

export function reconciledByMonth(f: AnalyticsFilter = {}, months = 6): ReconciledMonth[] {
  const share = closedShare(f);
  return history.slice(-months).map((m) => ({ month: m.month, decisions: Math.round(m.decisionsClosed * share) }));
}

/** Days since the case was received, as of the dataset's "as of" date. */
export function caseAgeDays(c: CaseRecord): number {
  const asOf = new Date(meta.asOf).getTime();
  return Math.max(0, Math.round((asOf - new Date(`${c.receivedDate}T00:00:00Z`).getTime()) / 86_400_000));
}

/* -------------------------------------------------------- sustainability */

function sustainMonths(slice: MonthlyHistory[]): SustainMonth[] {
  return slice.map((h) => {
    const cfg = config.sustainability.monthly.find((m) => m.month === h.month);
    const share = cfg?.measuredShare ?? 0;
    const measured = round1(h.co2AvoidedT * share);
    return {
      month: h.month,
      total: h.co2AvoidedT,
      measured,
      estimated: round1(h.co2AvoidedT - measured),
      materialsDivertedT: cfg?.materialsDivertedT ?? 0,
    };
  });
}

function sustainTotals(list: SustainMonth[]) {
  const total = sum(list.map((m) => m.total));
  return {
    co2AvoidedT: round1(total),
    measuredShare: total ? sum(list.map((m) => m.measured)) / total : 0,
    materialsDivertedT: round1(sum(list.map((m) => m.materialsDivertedT))),
  };
}

export function computeSustainability(months: number): SustainReport {
  const slice = history.slice(-months);
  const prevSlice = history.length >= months * 2 ? history.slice(-months * 2, -months) : [];
  const list = sustainMonths(slice);
  const w = config.sustainability.routeIntensity;

  const byRouteMap = new Map<DispositionRouteId, number>();
  slice.forEach((h) => {
    const entries = Object.entries(h.routeMix) as [DispositionRouteId, number][];
    const weight = sum(entries.map(([r, share]) => share * (w[r] ?? 0)));
    if (!weight) return;
    entries.forEach(([r, share]) => {
      byRouteMap.set(r, (byRouteMap.get(r) ?? 0) + (h.co2AvoidedT * share * (w[r] ?? 0)) / weight);
    });
  });
  const byRoute = meta.routes
    .map((r) => ({ id: r.id, label: r.name, value: round1(byRouteMap.get(r.id) ?? 0) }))
    .sort((a, b) => b.value - a.value);

  return {
    months: list,
    byRoute,
    factors: config.sustainability.emissionFactors,
    kpis: { ...sustainTotals(list), previous: prevSlice.length ? sustainTotals(sustainMonths(prevSlice)) : null },
  };
}

/* ------------------------------------------------------------------ pools */

/** Units that can be allocated: evidence complete and not written off. */
const POOL_ELIGIBLE: CaseStageId[] = ['awaiting_approval', 'approved', 'handed_off', 'reevaluate'];

export function computePools(f: AnalyticsFilter = {}): PoolReport {
  const cases = scopedCases({ tenant: f.tenant }).filter((c) => POOL_ELIGIBLE.includes(c.stage));
  const tenants = isAll(f.tenant) ? meta.tenants : [f.tenant!];

  const pools: PoolResult[] = config.pools.map((p) => {
    let available = 0;
    let internalDemand = 0;
    let externalDemand = 0;
    let allocatedRedeploy = 0;
    let allocatedResale = 0;
    let greedyValue = 0;
    // Supply cannot cross tenants, so the optimiser solves each tenant separately.
    tenants.forEach((t) => {
      const s = cases.filter((c) => c.tenant === t && c.productClass === p.productClass).length;
      const d = p.demand[t] ?? { internal: 0, external: 0 };
      const redeploy = Math.min(s, d.internal); // highest-value use first
      const resale = Math.min(s - redeploy, d.external);
      const allocated = redeploy + resale;
      const totalDemand = d.internal + d.external;
      // First come, first served baseline: units go to requests in arrival order (demand mix as it arrives), with fit losses.
      const blended = totalDemand ? (d.internal * p.unitValueRedeploy + d.external * p.unitValueResale) / totalDemand : 0;
      greedyValue += allocated * blended * p.greedyFit;
      available += s;
      internalDemand += d.internal;
      externalDemand += d.external;
      allocatedRedeploy += redeploy;
      allocatedResale += resale;
    });
    const demand = internalDemand + externalDemand;
    const allocated = allocatedRedeploy + allocatedResale;
    const unmet = Math.max(0, demand - allocated);
    const spare = available - allocated;
    return {
      id: p.id,
      name: p.name,
      productClass: p.productClass,
      available,
      demand,
      internalDemand,
      externalDemand,
      allocated,
      allocatedRedeploy,
      allocatedResale,
      unmet,
      utilisation: available ? allocated / available : 0,
      fulfilment: demand ? allocated / demand : 1,
      optimalValue: allocatedRedeploy * p.unitValueRedeploy + allocatedResale * p.unitValueResale,
      greedyValue: Math.round(greedyValue),
      status: unmet > 0 ? 'shortfall' : spare > 0 ? 'surplus' : 'balanced',
    };
  });

  const available = sum(pools.map((p) => p.available));
  const allocated = sum(pools.map((p) => p.allocated));
  const optimalValue = sum(pools.map((p) => p.optimalValue));
  const greedyValue = sum(pools.map((p) => p.greedyValue));
  return {
    pools,
    kpis: {
      available,
      allocated,
      demand: sum(pools.map((p) => p.demand)),
      allocationRate: available ? allocated / available : 0,
      optimalValue,
      greedyValue,
      uplift: greedyValue ? (optimalValue - greedyValue) / greedyValue : 0,
      unmet: sum(pools.map((p) => p.unmet)),
    },
  };
}

/* --------------------------------------------- history-based reports */

interface ReportsConfig {
  waterfall: {
    routeValueWeight: Record<DispositionRouteId, number>;
    steps: { id: string; label: string; short: string; routes: DispositionRouteId[] }[];
  };
  routeMix: { targets: Record<DispositionRouteId, number>; highValueRoutes: DispositionRouteId[] };
  predicted: { tolerance: number };
  models: {
    releases: { version: string; name: string; framework: string; from: string; to: string }[];
    driftThreshold: number;
    registry: ModelRecord[];
  };
  overrides: {
    reasons: Record<OverrideReasonId, string>;
    records: (Omit<OverrideRecord, 'productName' | 'tenant' | 'plannerName' | 'delta' | 'reasonLabel'> & { plannerId: string })[];
  };
  economics: {
    breakEvenRefurbHours: number;
    maxRefurbHours: number;
    /** Per-unit cost and recovery of each of the 7 routes (the share comes from closed-decision history). */
    pathways: Omit<PathwayEconomics, 'netMargin' | 'benefitCostRatio' | 'share' | 'decisions'>[];
  };
}

const reports = reportsJson as unknown as ReportsConfig;

export interface WaterfallStep {
  id: string;
  label: string;
  short: string;
  routes: DispositionRouteId[];
  value: number;
  /** Running total before this step. */
  start: number;
  /** Share of net recovery. */
  share: number;
}

export interface WaterfallReport {
  range: string;
  steps: WaterfallStep[];
  /** Equals Value realisation net recovery for the same months. */
  netRecovery: number;
  predicted: number;
  decisionsClosed: number;
}

/** Splits each month's actual recovery across route groups (route mix × value weight); totals equal net recovery. */
export function computeWaterfall(months: number): WaterfallReport {
  const slice = history.slice(-months);
  const w = reports.waterfall.routeValueWeight;
  const byRoute = new Map<DispositionRouteId, number>();
  slice.forEach((h) => {
    const entries = Object.entries(h.routeMix) as [DispositionRouteId, number][];
    const weight = sum(entries.map(([r, s]) => s * (w[r] ?? 0)));
    if (!weight) return;
    entries.forEach(([r, s]) => byRoute.set(r, (byRoute.get(r) ?? 0) + (h.actualRecovery * s * (w[r] ?? 0)) / weight));
  });
  const netRecovery = sum(slice.map((h) => h.actualRecovery));
  const raw = reports.waterfall.steps.map((s) => Math.round(sum(s.routes.map((r) => byRoute.get(r) ?? 0)) / 100) * 100);
  // Put the rounding remainder on the largest step so the bridge lands exactly on net recovery.
  const remainder = netRecovery - sum(raw);
  const largest = raw.indexOf(Math.max(...raw));
  raw[largest] += remainder;
  let running = 0;
  const steps = reports.waterfall.steps.map((s, i) => {
    const step = { ...s, value: raw[i], start: running, share: netRecovery ? raw[i] / netRecovery : 0 };
    running += raw[i];
    return step;
  });
  return {
    range: slice.length ? `${slice[0].month} – ${slice[slice.length - 1].month}` : '',
    steps,
    netRecovery,
    predicted: sum(slice.map((h) => h.predictedRecovery)),
    decisionsClosed: sum(slice.map((h) => h.decisionsClosed)),
  };
}

export interface RouteMixRow {
  id: DispositionRouteId;
  label: string;
  /** Decision-weighted share over the period, 0–100. */
  share: number;
  decisions: number;
  target: number;
  /** Share in the last month minus the first month, in pp. */
  change: number;
}

export interface RouteMixReport {
  range: string;
  /** One row per month: { month, [routeId]: share 0–100 }, normalised to 100%. */
  months: ({ month: string } & Record<DispositionRouteId, number>)[];
  routes: RouteMixRow[];
  kpis: { highValueShare: number; highValueChange: number; exitShare: number; decisionsClosed: number };
}

export function computeRouteMix(months: number): RouteMixReport {
  const slice = history.slice(-months);
  const ids = meta.routes.map((r) => r.id);
  // Whole percents via largest remainder, so every month adds up to exactly 100.
  const norm = slice.map((h) => {
    const total = sum(ids.map((id) => h.routeMix[id] ?? 0)) || 1;
    const exact = ids.map((id) => ((h.routeMix[id] ?? 0) / total) * 100);
    const whole = exact.map(Math.floor);
    const order = exact.map((v, i) => ({ i, rem: v - whole[i] })).sort((a, b) => b.rem - a.rem);
    const deficit = 100 - sum(whole);
    for (let k = 0; k < deficit; k++) whole[order[k % order.length].i] += 1;
    const row = { month: h.month } as { month: string } & Record<DispositionRouteId, number>;
    ids.forEach((id, i) => (row[id] = whole[i]));
    return row;
  });
  const decisions = sum(slice.map((h) => h.decisionsClosed));
  const first = norm[0];
  const last = norm[norm.length - 1];
  // Whole decision counts per route via largest remainder, so the routes add up to exactly `decisions`.
  const units = meta.routes.map((r) => sum(slice.map((h, i) => (norm[i][r.id] / 100) * h.decisionsClosed)));
  const counts = units.map(Math.floor);
  const byRem = units.map((v, i) => ({ i, rem: v - counts[i] })).sort((a, b) => b.rem - a.rem);
  const short = decisions - sum(counts);
  for (let k = 0; k < short && byRem.length; k++) counts[byRem[k % byRem.length].i] += 1;
  const routes: RouteMixRow[] = meta.routes.map((r, ri) => {
    return {
      id: r.id,
      label: r.name,
      share: decisions ? round1((units[ri] / decisions) * 100) : 0,
      decisions: counts[ri],
      target: reports.routeMix.targets[r.id] ?? 0,
      change: first && last ? round1(last[r.id] - first[r.id]) : 0,
    };
  });
  const hv = reports.routeMix.highValueRoutes;
  const hvOf = (row?: Record<DispositionRouteId, number>) => (row ? sum(hv.map((id) => row[id] ?? 0)) : 0);
  return {
    range: slice.length ? `${slice[0].month} – ${slice[slice.length - 1].month}` : '',
    months: norm,
    routes,
    kpis: {
      highValueShare: round1(sum(routes.filter((r) => hv.includes(r.id)).map((r) => r.share))),
      highValueChange: round1(hvOf(last) - hvOf(first)),
      exitShare: routes.find((r) => r.id === 'exit')?.share ?? 0,
      decisionsClosed: decisions,
    },
  };
}

export interface AccuracyMonth {
  month: string;
  predicted: number;
  actual: number;
  /** actual − predicted */
  error: number;
  /** (actual − predicted) / predicted */
  errorPct: number;
  withinTolerance: boolean;
}

export interface AccuracyReport {
  range: string;
  months: AccuracyMonth[];
  tolerance: number;
  kpis: { recoveryYield: number; mape: number; withinTolerance: number; variance: number };
}

export function computeAccuracy(months: number): AccuracyReport {
  const tol = reports.predicted.tolerance;
  const list: AccuracyMonth[] = history.slice(-months).map((h) => {
    const errorPct = h.predictedRecovery ? (h.actualRecovery - h.predictedRecovery) / h.predictedRecovery : 0;
    return {
      month: h.month,
      predicted: h.predictedRecovery,
      actual: h.actualRecovery,
      error: h.actualRecovery - h.predictedRecovery,
      errorPct,
      withinTolerance: Math.abs(errorPct) <= tol,
    };
  });
  const predicted = sum(list.map((m) => m.predicted));
  const actual = sum(list.map((m) => m.actual));
  return {
    range: list.length ? `${list[0].month} – ${list[list.length - 1].month}` : '',
    months: list,
    tolerance: tol,
    kpis: {
      recoveryYield: predicted ? actual / predicted : 0,
      mape: list.length ? sum(list.map((m) => Math.abs(m.errorPct))) / list.length : 0,
      withinTolerance: list.filter((m) => m.withinTolerance).length,
      variance: actual - predicted,
    },
  };
}

export type ModelStatus = 'production' | 'shadow' | 'retraining' | 'deprecated';

export interface ModelRecord {
  id: string;
  name: string;
  domain: string;
  version: string;
  status: ModelStatus;
  trainingCases: number;
  primaryMetric: string;
  metricValue: string;
  drift: number;
  lastTrained: string;
  owner: string;
  framework: string;
}

export interface ModelRelease {
  version: string;
  name: string;
  framework: string;
  range: string;
  months: number;
  /** Mean (actual − predicted) / predicted over the months the release was live. Negative = over-predicts. */
  bias: number;
  mape: number;
  current: boolean;
}

export interface ModelsReport {
  releases: ModelRelease[];
  registry: ModelRecord[];
  driftThreshold: number;
}

export function computeModels(): ModelsReport {
  const monthIdx = (m: string) => history.findIndex((h) => h.month === m);
  const rel = reports.models.releases;
  const releases = rel.map((r, i) => {
    const live = history.slice(monthIdx(r.from), monthIdx(r.to) + 1);
    const errs = live.map((h) => (h.actualRecovery - h.predictedRecovery) / h.predictedRecovery);
    return {
      version: r.version,
      name: r.name,
      framework: r.framework,
      range: `${r.from} – ${r.to}`,
      months: live.length,
      bias: errs.length ? sum(errs) / errs.length : 0,
      mape: errs.length ? sum(errs.map(Math.abs)) / errs.length : 0,
      current: i === rel.length - 1,
    };
  });
  return { releases, registry: reports.models.registry, driftThreshold: reports.models.driftThreshold };
}

export type OverrideReasonId = 'contract' | 'hazmat' | 'condition' | 'demand' | 'obsolescence';
export type OverrideFeedback = 'incorporated' | 'pending' | 'reviewed';

export interface OverrideRecord {
  id: string;
  caseId: string;
  productName: string;
  tenant: string;
  aiRoute: DispositionRouteId;
  aiValue: number;
  aiConfidence: number;
  plannerRoute: DispositionRouteId;
  plannerValue: number;
  /** plannerValue − aiValue */
  delta: number;
  reason: OverrideReasonId;
  reasonLabel: string;
  plannerName: string;
  at: string;
  feedback: OverrideFeedback;
}

export interface OverridesReport {
  records: OverrideRecord[];
  reasons: { id: OverrideReasonId; label: string }[];
  kpis: { count: number; netDelta: number; topReason: { label: string; share: number } | null; pending: number };
}

export function computeOverrides(): OverridesReport {
  const records: OverrideRecord[] = reports.overrides.records.map((r) => {
    const c = caseStore.all().find((x) => x.id === r.caseId);
    return {
      ...r,
      productName: c?.productName ?? '',
      tenant: c?.tenant ?? '',
      delta: r.plannerValue - r.aiValue,
      reasonLabel: reports.overrides.reasons[r.reason],
      plannerName: userStore.all().find((u) => u.id === r.plannerId)?.name ?? r.plannerId,
    };
  });
  const reasons = (Object.entries(reports.overrides.reasons) as [OverrideReasonId, string][]).map(([id, label]) => ({ id, label }));
  const counts = reasons.map((r) => ({ ...r, n: records.filter((x) => x.reason === r.id).length })).sort((a, b) => b.n - a.n);
  return {
    records,
    reasons,
    kpis: {
      count: records.length,
      netDelta: sum(records.map((r) => r.delta)),
      topReason: counts[0]?.n ? { label: counts[0].label, share: counts[0].n / records.length } : null,
      pending: records.filter((r) => r.feedback === 'pending').length,
    },
  };
}

export interface PathwayEconomics {
  id: DispositionRouteId;
  /** Canonical route name (DISPOSITION_ROUTES). */
  pathway: string;
  /** Share of closed decisions in the period, 0–100: the same figure as Route mix. */
  share: number;
  /** Closed decisions on this route in the period (Route mix). */
  decisions: number;
  avgDirectCost: number;
  laborHours: number;
  grossRecovery: number;
  paybackDays: number | null;
  /** (gross − cost) / gross; −1 when nothing is recovered. */
  netMargin: number;
  /** gross / cost */
  benefitCostRatio: number;
}

export interface EconomicsReport {
  /** Months of closed-decision history behind the shares, e.g. "Nov 25 – Oct 26" (same as Route mix). */
  range: string;
  pathways: PathwayEconomics[];
  kpis: { avoidedSpend: number; avoidedSpendRange: string; weightedMargin: number; breakEvenRefurbHours: number; maxRefurbHours: number };
}

/**
 * Per-unit economics of the 7 canonical routes. Shares are the decision-weighted route shares
 * of Route mix (computeRouteMix over the same months of history), so both pages agree.
 */
export function computeEconomics(months = 12): EconomicsReport {
  const mix = computeRouteMix(months);
  const unit = new Map(reports.economics.pathways.map((p) => [p.id, p]));
  const pathways: PathwayEconomics[] = mix.routes.map((r) => {
    const p = unit.get(r.id) ?? { id: r.id, pathway: '', avgDirectCost: 0, laborHours: 0, grossRecovery: 0, paybackDays: null };
    return {
      ...p,
      id: r.id,
      pathway: DISPOSITION_ROUTES[r.id]?.name ?? r.label,
      share: r.share,
      decisions: r.decisions,
      netMargin: p.grossRecovery ? (p.grossRecovery - p.avgDirectCost) / p.grossRecovery : -1,
      benefitCostRatio: p.avgDirectCost ? Math.round((p.grossRecovery / p.avgDirectCost) * 10) / 10 : 0,
    };
  });
  const slice = history.slice(-months);
  const shareTotal = sum(pathways.map((p) => p.share)) || 1;
  return {
    range: mix.range,
    pathways,
    kpis: {
      avoidedSpend: sum(slice.map((h) => h.avoidedSpend)),
      avoidedSpendRange: slice.length ? `${slice[0].month} – ${slice[slice.length - 1].month}` : '',
      weightedMargin: sum(pathways.map((p) => p.netMargin * p.share)) / shareTotal,
      breakEvenRefurbHours: reports.economics.breakEvenRefurbHours,
      maxRefurbHours: reports.economics.maxRefurbHours,
    },
  };
}

/* ---------------------------------------------------------------- service */

export const analyticsService = {
  subscribe: caseStore.subscribe,

  async pipeline(f: AnalyticsFilter = {}): Promise<PipelineReport> {
    await delay();
    return computePipeline(f);
  },

  async stageCases(stage: FunnelStageId, f: AnalyticsFilter = {}): Promise<CaseRecord[]> {
    await delay(200);
    return stageCases(stage, f);
  },

  async reconciledByMonth(f: AnalyticsFilter = {}, months = 6): Promise<ReconciledMonth[]> {
    await delay(200);
    return reconciledByMonth(f, months);
  },

  async sustainability(months = 12): Promise<SustainReport> {
    await delay();
    return computeSustainability(months);
  },

  async pools(f: AnalyticsFilter = {}): Promise<PoolReport> {
    await delay();
    return computePools(f);
  },

  async waterfall(months = 12): Promise<WaterfallReport> {
    await delay();
    return computeWaterfall(months);
  },

  async routeMix(months = 12): Promise<RouteMixReport> {
    await delay();
    return computeRouteMix(months);
  },

  async accuracy(months = 12): Promise<AccuracyReport> {
    await delay();
    return computeAccuracy(months);
  },

  async models(): Promise<ModelsReport> {
    await delay();
    return computeModels();
  },

  async overrides(): Promise<OverridesReport> {
    await delay();
    return computeOverrides();
  },

  async economics(months = 12): Promise<EconomicsReport> {
    await delay();
    return computeEconomics(months);
  },

  meta: () => meta,
};
