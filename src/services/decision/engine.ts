/**
 * Decision engine core: pure, synchronous and deterministic.
 *
 * Implements docs/recover-reference.md section 1:
 *  - net value of each route = Σ value lines − Σ cost lines − holding cost/day × days,
 *    priced against named demand records when they exist;
 *  - timing, grade, life and fit-for-use gates;
 *  - business rules (exclude / prefer / require) and the intake-channel standard route;
 *  - a whole-queue plan (each demand used once, refurbishment slots limited) by regret,
 *    compared with first come, first served.
 *
 * This file has no runtime imports, so scripts (scripts/gen-decision-data.mjs,
 * scripts/check-decisions.mjs) run exactly the same engine as the app. All data
 * (policy, demand, case context, rules) is passed in through an EngineContext.
 */
import type { CaseRecord } from '@/models/domain.model';
import type {
  Availability,
  BusinessRule,
  CaseContext,
  CaseDecision,
  ContestedDemand,
  DecisionParams,
  Demand,
  Grade,
  IntakeChannel,
  LeaseDemand,
  LineKind,
  LineSource,
  OverrideRecord,
  Policy,
  QueueAssignment,
  QueuePlan,
  RecyclerQuoteDemand,
  RepairOrderDemand,
  RouteId,
  RouteTiming,
  RouteValue,
  ValueLine,
} from '@/models/decision.model';

/* ================================================================ context */

/** Everything the engine needs besides the case itself. */
export interface EngineContext {
  /** ISO timestamp the queue is valued at (today). */
  asOf: string;
  policy: Policy;
  /** All demand records (lease orders, sales orders, bids, requests, repair orders, recycler quotes). */
  demands: Demand[];
  /** Intake channel, remaining life and parts for a case. Must be total (never throw). */
  contextFor: (c: CaseRecord) => CaseContext;
  /** Published business rules. */
  rules: BusinessRule[];
  /** Routes removed from the flow (Studio / What-if). */
  blocked?: RouteId[];
  /** Routes withheld for a stated reason (Case page edge-case presets), e.g. "Customer requires a new unit". */
  restricted?: Partial<Record<RouteId, string>>;
}

/**
 * Days after the asset is ready until the route's value is realised (delivery confirmed,
 * lease started, parts issued, certificate filed). Cycle time = lead + transfer + settle days.
 */
export const SETTLE_DAYS: Record<RouteId, number> = { redeploy: 2, relase: 4, resale: 5, intparts: 2, extparts: 7, material: 4, exit: 2 };

/** Route evaluation order (also the ladder order for non-viable routes). */
export const ROUTE_IDS: RouteId[] = ['redeploy', 'relase', 'resale', 'intparts', 'extparts', 'material', 'exit'];

export const CHANNEL_LABEL: Record<IntakeChannel, string> = {
  lease_end: 'Lease / contract end',
  field_return: 'Field service return',
  trade_in: 'Customer trade-in',
  excess: 'Excess or idle stock',
};

/** Short channel name used inside sentences ("+$2,260 over the lease-end standard route"). */
export const CHANNEL_SHORT: Record<IntakeChannel, string> = {
  lease_end: 'lease-end',
  field_return: 'field-return',
  trade_in: 'trade-in',
  excess: 'excess-stock',
};

const GRADE_RANK: Record<Grade, number> = { A: 0, B: 1, C: 2, D: 3, Scrap: 4 };
/** Demand kinds that are used up by one case. Recycler quotes are shared rate cards. */
const EXCLUSIVE = (d: Demand) => d.kind !== 'recycler_quote';

/** The published policy as What-if parameters. */
export function defaultParams(policy: Policy): DecisionParams {
  return {
    resalePriceIndex: 1,
    refurbCostIndex: 1,
    leaseDemand: 1,
    customerWaitCost: policy.customerWaitCost,
    fitForUseThreshold: policy.fitForUseThreshold,
    holdingCostPerDay: policy.holdingCostPerDay,
    refurbSlots: policy.refurbSlots,
  };
}

/** Fills missing parameters from the policy. */
export function resolveParams(policy: Policy, params?: Partial<DecisionParams>): DecisionParams {
  return { ...defaultParams(policy), ...(params ?? {}) };
}

/* ================================================================ format helpers */

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "$12,340" (negative: "−$1,200"). Deterministic, no locale. */
export function usd(n: number): string {
  const v = Math.round(n);
  const s = Math.abs(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${v < 0 ? '−' : ''}$${s}`;
}

/** "24 Nov" from an ISO date. */
export function fmtDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

/** ISO date n days after an ISO date / timestamp. */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

const pct = (n: number) => `${Math.round(n * 100)} %`;
const r10 = (n: number) => Math.round(n / 10) * 10;
const round = (n: number) => Math.round(n);

/** True when grade `g` is at least as good as `min`. */
export function gradeAtLeast(g: Grade, min: Grade): boolean {
  return GRADE_RANK[g] <= GRADE_RANK[min];
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ================================================================ demand index */

interface DemandIndex {
  byClass: Map<string, Demand[]>;
  byId: Map<string, Demand>;
}

const indexCache = new WeakMap<Demand[], Map<number, DemandIndex>>();

/** Demands visible under the parameters (lease demand lever drops lease orders deterministically). */
function demandIndex(demands: Demand[], leaseDemand: number): DemandIndex {
  const key = Math.round(Math.max(0, Math.min(1, leaseDemand)) * 1000);
  let perKey = indexCache.get(demands);
  if (!perKey) {
    perKey = new Map();
    indexCache.set(demands, perKey);
  }
  const hit = perKey.get(key);
  if (hit) return hit;
  const leases = demands.filter((d) => d.kind === 'lease_order' || d.kind === 'lease_renewal');
  const keep = new Set(
    [...leases]
      .sort((a, b) => hashOf(a.id) - hashOf(b.id))
      .slice(0, Math.round((leases.length * key) / 1000))
      .map((d) => d.id),
  );
  const byClass = new Map<string, Demand[]>();
  const byId = new Map<string, Demand>();
  for (const d of demands) {
    byId.set(d.id, d);
    if ((d.kind === 'lease_order' || d.kind === 'lease_renewal') && !keep.has(d.id)) continue;
    const k = `${d.kind}|${d.productClass}`;
    const list = byClass.get(k);
    if (list) list.push(d);
    else byClass.set(k, [d]);
  }
  const idx = { byClass, byId };
  perKey.set(key, idx);
  return idx;
}

function candidates<K extends Demand['kind']>(idx: DemandIndex, kinds: K[], c: CaseRecord): Extract<Demand, { kind: K }>[] {
  const out: Extract<Demand, { kind: K }>[] = [];
  for (const k of kinds) {
    for (const d of idx.byClass.get(`${k}|${c.productClass}`) ?? []) {
      if (d.model === null || d.model === c.model) out.push(d as Extract<Demand, { kind: K }>);
    }
  }
  return out;
}

/** Looks up a demand record by id. */
export function findDemand(ctx: EngineContext, id: string): Demand | undefined {
  return demandIndex(ctx.demands, 1).byId.get(id);
}

/* ================================================================ rules */

/** True when a rule's scope covers the case. */
export function ruleMatches(rule: BusinessRule, c: CaseRecord, cc: CaseContext): boolean {
  if (rule.active === false) return false;
  const s = rule.scope;
  if (s.productClass?.length && !s.productClass.includes(c.productClass)) return false;
  if (s.condition?.length && !s.condition.includes(c.condition)) return false;
  if (s.channel?.length && !s.channel.includes(cc.intakeChannel)) return false;
  if (s.site?.length && !s.site.includes(c.location)) return false;
  if (s.lifeMax !== undefined && !(cc.lifePct < s.lifeMax)) return false;
  if (s.lifeMin !== undefined && !(cc.lifePct >= s.lifeMin)) return false;
  return true;
}

/* ================================================================ valuation */

const NO_AVAIL: Availability = { taken: new Set<string>(), slotsLeft: Number.POSITIVE_INFINITY };

interface Draft {
  viable: boolean;
  reason: string | null;
  lines: ValueLine[];
  demands: Demand[];
  estimate: boolean;
  timing: RouteTiming;
  usesSlot: boolean;
}

function src(ctx: EngineContext, kind: LineKind, reference?: string): LineSource[] {
  const s = ctx.policy.sources[kind];
  return [reference ? { ...s, reference } : s];
}

function line(ctx: EngineContext, type: ValueLine['type'], kind: LineKind, label: string, basis: string, amount: number, reference?: string): ValueLine {
  return { type, kind, label, basis, amount: Math.max(0, round(amount)), sources: src(ctx, kind, reference) };
}

function timingFor(ctx: EngineContext, c: CaseRecord, route: RouteId, demand: Demand | null, neededBy?: string | null): RouteTiming {
  const leadDays = ctx.policy.routes[route].leadDays;
  const transfer = !!demand && demand.site !== c.location;
  const transferDays = transfer ? ctx.policy.transferDays : 0;
  const ready = addDays(ctx.asOf, leadDays + transferDays);
  const need = neededBy !== undefined ? neededBy : demand ? (demand.kind === 'buyer_bid' ? demand.validTo : demand.neededBy) : null;
  const cycleDays = leadDays + transferDays + SETTLE_DAYS[route];
  return { leadDays, transferDays, transfer, ready, neededBy: need, bufferDays: need ? daysBetween(ready, need) : null, cycleDays };
}

function lateReason(d: Demand, t: RouteTiming): string {
  return `${d.id} needed by ${fmtDay(t.neededBy ?? t.ready)}; ready ${fmtDay(t.ready)}`;
}

/** Holder value that marks a demand record as cancelled (Case page "Demand cancelled" preset). */
export const CANCELLED = '__cancelled__';

function takenReason(ids: string[], avail: Availability): string {
  const id = ids[0];
  const who = avail.holder?.get(id);
  if (who === CANCELLED) return `${id} is cancelled`;
  return who ?`${id} goes to ${who} where it adds more` : `${id} is already committed to another case`;
}

function finish(c: CaseRecord, route: RouteId, d: Draft, p: DecisionParams, ctx: EngineContext): RouteValue {
  const rp = ctx.policy.routes[route];
  const days = d.timing.leadDays + d.timing.transferDays;
  const space = ctx.policy.classes[c.productClass].holdingSpace;
  const holdingAmount = round(p.holdingCostPerDay * space * days);
  const holdingLine: ValueLine = {
    type: 'time',
    kind: 'holding',
    label: 'Holding cost while the route runs',
    basis: `${usd(p.holdingCostPerDay)}/day × ${space} bay × ${days} days`,
    amount: holdingAmount,
    sources: src(ctx, 'holding'),
  };
  const lines = [...d.lines, holdingLine];
  const gross = d.lines.filter((l) => l.type === 'value').reduce((s, l) => s + l.amount, 0);
  const cost = d.lines.filter((l) => l.type === 'cost').reduce((s, l) => s + l.amount, 0);
  return {
    route,
    routeName: rp.name,
    viable: d.viable,
    reason: d.viable ? null : d.reason,
    net: d.viable ? gross - cost - holdingAmount : 0,
    gross,
    cost,
    holding: holdingAmount,
    lines,
    demand: d.demands[0] ?? null,
    demands: d.demands,
    committed: d.demands.length > 0,
    estimate: d.viable && d.estimate,
    usesSlot: d.usesSlot,
    timing: d.timing,
    executesIn: rp.executesIn,
    owner: rp.owner,
  };
}

function notViable(ctx: EngineContext, c: CaseRecord, route: RouteId, reason: string, extra?: Partial<Draft>): Draft {
  return {
    viable: false,
    reason,
    lines: [],
    demands: [],
    estimate: false,
    timing: timingFor(ctx, c, route, null),
    usesSlot: route === 'relase',
    ...extra,
  };
}

/** Picks the best draft: viable ones by net, else the first non-viable (its reason explains why). */
function pickDraft(drafts: Draft[], c: CaseRecord, route: RouteId, p: DecisionParams, ctx: EngineContext): RouteValue {
  let best: RouteValue | null = null;
  for (const d of drafts) {
    const v = finish(c, route, d, p, ctx);
    if (!best || (v.viable && (!best.viable || v.net > best.net))) best = v;
  }
  return best ?? finish(c, route, notViable(ctx, c, route, 'No option'), p, ctx);
}

/** Splits candidate demands into free / taken / late and returns the reason when none is usable. */
function usable<D extends Demand>(
  ctx: EngineContext,
  c: CaseRecord,
  route: RouteId,
  list: D[],
  avail: Availability,
  noneReason: string,
): { ok: D[]; reason: string | null; late: Draft | null } {
  if (!list.length) return { ok: [], reason: noneReason, late: null };
  const free = list.filter((d) => !avail.taken.has(d.id));
  if (!free.length) return { ok: [], reason: takenReason(list.map((d) => d.id), avail), late: null };
  const onTime = free.filter((d) => (timingFor(ctx, c, route, d).bufferDays ?? 0) >= 0);
  if (!onTime.length) {
    const first = [...free].sort((a, b) => (timingFor(ctx, c, route, b).bufferDays ?? 0) - (timingFor(ctx, c, route, a).bufferDays ?? 0))[0];
    const t = timingFor(ctx, c, route, first);
    return { ok: [], reason: lateReason(first, t), late: notViable(ctx, c, route, lateReason(first, t), { timing: t, demands: [] }) };
  }
  return { ok: onTime, reason: null, late: null };
}

function freightLine(ctx: EngineContext, c: CaseRecord, d: Demand): ValueLine {
  const f = ctx.policy.classes[c.productClass].freight;
  return line(ctx, 'cost', 'freight', 'Freight between sites', `${c.location} → ${d.site}, rate card ${usd(f)}`, f, d.id);
}

function valueRedeploy(c: CaseRecord, p: DecisionParams, ctx: EngineContext, avail: Availability, idx: DemandIndex): Draft[] {
  if (!gradeAtLeast(c.condition, 'B')) return [notViable(ctx, c, 'redeploy', `Redeploy needs grade A or B; asset is grade ${c.condition}`)];
  const list = candidates(idx, ['redeploy_request'], c).filter((d) => gradeAtLeast(c.condition, d.minGrade));
  const u = usable(ctx, c, 'redeploy', list, avail, `No site has asked for a ${c.model}`);
  if (!u.ok.length) return [u.late ?? notViable(ctx, c, 'redeploy', u.reason ?? '')];
  const recommission = c.refurbishmentCost * ctx.policy.recommissionShare * p.refurbCostIndex;
  return u.ok.map((d) => {
    const lines = [
      line(ctx, 'value', 'avoided_purchase', 'Avoided purchase at the requesting site', `${d.customer} is short of a ${c.model}; an equivalent unit costs ${usd(d.avoidedCost)}`, d.avoidedCost, d.id),
      line(ctx, 'cost', 'recommission', 'Test and recommission', `${pct(ctx.policy.recommissionShare)} of the ${usd(c.refurbishmentCost)} refurbishment estimate × cost index ${p.refurbCostIndex}`, recommission),
    ];
    if (d.site !== c.location) lines.push(freightLine(ctx, c, d));
    return { viable: true, reason: null, lines, demands: [d], estimate: false, timing: timingFor(ctx, c, 'redeploy', d), usesSlot: false };
  });
}

/** Present value of `months` monthly payments at annual rate `rate`. */
export function annuityFactor(months: number, rate: number): number {
  const m = rate / 12;
  return m === 0 ? months : (1 - Math.pow(1 + m, -months)) / m;
}

function valueRelease(c: CaseRecord, p: DecisionParams, ctx: EngineContext, avail: Availability, idx: DemandIndex, cc: CaseContext): Draft[] {
  const pol = ctx.policy;
  if (!gradeAtLeast(c.condition, 'C')) return [notViable(ctx, c, 'relase', `Grade ${c.condition} cannot be re-leased (GR-01)`)];
  if (cc.lifePct < pol.relaseMinLife) return [notViable(ctx, c, 'relase', `Remaining life ${cc.lifePct} % is below the ${pol.relaseMinLife} % re-lease minimum`)];
  const list = candidates(idx, ['lease_order', 'lease_renewal'], c).filter((d) => gradeAtLeast(c.condition, d.minGrade));
  const u = usable(ctx, c, 'relase', list, avail, `No open lease order for ${c.model}`);
  if (!u.ok.length) return [u.late ?? notViable(ctx, c, 'relase', u.reason ?? '')];
  if (avail.slotsLeft <= 0) {
    return [notViable(ctx, c, 'relase', `All ${p.refurbSlots} refurbishment slots go to cases where refurbishment adds more`)];
  }
  const refurb = c.refurbishmentCost * p.refurbCostIndex;
  return u.ok.map((d: LeaseDemand) => {
    const income = d.monthlyFee * annuityFactor(d.termMonths, pol.costOfCapital);
    const lifeAfter = Math.min(100, cc.lifePct + pol.refurbRestoresLife);
    const lifeEnd = Math.max(0, lifeAfter - pol.lifeUsedPerMonth * d.termMonths);
    const residualRaw = (c.predictedResale * p.resalePriceIndex * lifeEnd) / Math.max(cc.lifePct, 10);
    const residual = residualRaw / Math.pow(1 + pol.costOfCapital, d.termMonths / 12);
    const servicing = assetValue(c) * pol.servicingPctPerYear * (d.termMonths / 12);
    const lines = [
      line(ctx, 'value', 'lease_income', `Lease income from ${d.customer}`, `${usd(d.monthlyFee)}/month × ${d.termMonths} months, discounted at ${pct(pol.costOfCapital)}/yr`, income, d.id),
      line(
        ctx,
        'value',
        'residual_value',
        'Residual value at end of term (today’s money)',
        `${usd(c.predictedResale)} × life ${lifeAfter} % after refurbishment − ${pol.lifeUsedPerMonth} pts/month × ${d.termMonths} = ${Math.round(lifeEnd)} % of today’s ${cc.lifePct} %, discounted`,
        residual,
      ),
      line(ctx, 'cost', 'refurbishment', 'Refurbishment to lease standard', `Repair centre standard cost ${usd(c.refurbishmentCost)} × cost index ${p.refurbCostIndex}`, refurb),
      line(ctx, 'cost', 'servicing', 'Servicing during the term', `${pct(pol.servicingPctPerYear)} of replacement value ${usd(assetValue(c))} per year × ${d.termMonths / 12} years`, servicing),
    ];
    if (d.site !== c.location) lines.push(freightLine(ctx, c, d));
    return { viable: true, reason: null, lines, demands: [d], estimate: false, timing: timingFor(ctx, c, 'relase', d), usesSlot: true };
  });
}

function valueResale(c: CaseRecord, p: DecisionParams, ctx: EngineContext, avail: Availability, idx: DemandIndex): Draft[] {
  const pol = ctx.policy;
  if (!gradeAtLeast(c.condition, 'C')) return [notViable(ctx, c, 'resale', `Grade ${c.condition} is below the whole-asset resale threshold`)];
  const test = c.refurbishmentCost * pol.testCertifyShare * p.refurbCostIndex;
  const testLine = line(ctx, 'cost', 'test_certify', 'Test, clean and certify', `${pct(pol.testCertifyShare)} of the ${usd(c.refurbishmentCost)} refurbishment estimate × cost index ${p.refurbCostIndex}`, test);
  const list = candidates(idx, ['sales_order', 'buyer_bid'], c).filter((d) => d.kind !== 'buyer_bid' || gradeAtLeast(c.condition, d.minGrade));
  const named: Draft[] = list
    .filter((d) => !avail.taken.has(d.id))
    .map((d) => {
      const t = timingFor(ctx, c, 'resale', d);
      if ((t.bufferDays ?? 0) < 0) return notViable(ctx, c, 'resale', lateReason(d, t), { timing: t });
      const direct = d.kind === 'sales_order';
      const rate = direct ? pol.directCommission : pol.channelCommission;
      const lines = [
        direct
          ? line(ctx, 'value', 'sale_order', `Sales order from ${d.customer}`, `Confirmed price ${usd(d.price)}`, d.price, d.id)
          : line(ctx, 'value', 'buyer_bid', `Buyer bid from ${d.customer}`, `Open bid ${usd(d.price)}, valid to ${fmtDay(d.validTo)}, grade ${d.minGrade} or better`, d.price, d.id),
        line(ctx, 'cost', 'commission', direct ? 'Sales order handling' : 'Remarketing commission', `${pct(rate)} of ${usd(d.price)}`, d.price * rate),
        testLine,
      ];
      if (d.site !== c.location) lines.push(freightLine(ctx, c, d));
      return { viable: true, reason: null, lines, demands: [d], estimate: false, timing: t, usesSlot: false };
    });
  if (named.some((d) => d.viable)) return named.filter((d) => d.viable);
  const est = c.predictedResale * p.resalePriceIndex * pol.estimateHaircut;
  const estimate: Draft = {
    viable: true,
    reason: null,
    lines: [
      line(ctx, 'value', 'market_estimate', 'Estimated market price (no buyer yet)', `Predicted resale ${usd(c.predictedResale)} × price index ${p.resalePriceIndex} × ${pct(pol.estimateHaircut)} unsold haircut`, est),
      line(ctx, 'cost', 'commission', 'Remarketing commission', `${pct(pol.channelCommission)} of ${usd(est)}`, est * pol.channelCommission),
      testLine,
    ],
    demands: [],
    estimate: true,
    timing: timingFor(ctx, c, 'resale', null),
    usesSlot: false,
  };
  return [estimate];
}

/**
 * Replacement value used for servicing and teardown: the original price, or 1.3 × the
 * predicted resale when the recorded original price is lower than that (inconsistent record).
 */
export function assetValue(c: CaseRecord): number {
  return Math.max(c.facts.originalPrice, Math.round(c.predictedResale * 1.3));
}

function teardownLine(c: CaseRecord, p: DecisionParams, ctx: EngineContext): ValueLine {
  const pol = ctx.policy;
  return line(ctx, 'cost', 'teardown', 'Teardown and part certification', `${pct(pol.teardownPct)} of replacement value ${usd(assetValue(c))} × cost index ${p.refurbCostIndex}`, assetValue(c) * pol.teardownPct * p.refurbCostIndex);
}

function fitParts(cc: CaseContext, p: DecisionParams) {
  return cc.parts.filter((x) => x.lifePct >= p.fitForUseThreshold);
}

function materialValue(c: CaseRecord, p: DecisionParams, ctx: EngineContext): number {
  const kg = ctx.policy.classes[c.productClass].weightKg * c.quantity;
  return kg * ctx.policy.materialIndexPerKg[c.productClass] * p.resalePriceIndex;
}

function partsFor(
  c: CaseRecord,
  p: DecisionParams,
  ctx: EngineContext,
  avail: Availability,
  idx: DemandIndex,
  cc: CaseContext,
  route: 'intparts' | 'extparts',
): { matched: { part: CaseContext['parts'][number]; ro: RepairOrderDemand }[]; reason: string | null; fit: CaseContext['parts'] } {
  const fit = fitParts(cc, p);
  if (!fit.length) return { matched: [], fit, reason: `No part at or above the ${p.fitForUseThreshold} % fit-for-use threshold (GR-03)` };
  const network = route === 'intparts' ? 'internal' : 'external';
  const ros = candidates(idx, ['repair_order'], c).filter((d) => d.network === network);
  const matched: { part: CaseContext['parts'][number]; ro: RepairOrderDemand }[] = [];
  let reason: string | null = null;
  for (const part of fit) {
    const forPart = ros.filter((r) => r.part === part.name);
    if (!forPart.length) continue;
    const u = usable(ctx, c, route, forPart, avail, '');
    if (!u.ok.length) {
      reason = reason ?? u.reason;
      continue;
    }
    const pick = [...u.ok].sort((a, b) => Number(b.backordered) - Number(a.backordered) || a.neededBy.localeCompare(b.neededBy) || a.id.localeCompare(b.id))[0];
    matched.push({ part, ro: pick });
  }
  if (!matched.length && !reason) reason = `No open ${network} repair order needs ${fit.map((x) => x.name.toLowerCase()).join(', ')}`;
  return { matched, reason, fit };
}

function valueIntParts(c: CaseRecord, p: DecisionParams, ctx: EngineContext, avail: Availability, idx: DemandIndex, cc: CaseContext): Draft[] {
  const pol = ctx.policy;
  const { matched, reason } = partsFor(c, p, ctx, avail, idx, cc, 'intparts');
  if (!matched.length) return [notViable(ctx, c, 'intparts', reason ?? 'No repair order needs these parts')];
  const lines: ValueLine[] = [];
  for (const { part, ro } of matched) {
    lines.push(
      line(ctx, 'value', 'part_value', `Certified used ${part.name.toLowerCase()} for ${ro.id}`, `New price ${usd(part.newPrice)} × ${pct(pol.certifiedPartFactor)} certified-part factor (life ${part.lifePct} %)`, part.newPrice * pol.certifiedPartFactor, ro.id),
    );
    if (ro.backordered) {
      lines.push(line(ctx, 'value', 'wait_cost_avoided', `Customer wait avoided on ${ro.id}`, `Part is backordered; ${usd(p.customerWaitCost)} wait cost per blocked repair`, p.customerWaitCost, ro.id));
    }
  }
  lines.push(line(ctx, 'value', 'carcass_material', 'Remaining carcass to recycler', `${pct(pol.carcassMaterialShare)} of material value ${usd(materialValue(c, p, ctx))}`, materialValue(c, p, ctx) * pol.carcassMaterialShare));
  lines.push(teardownLine(c, p, ctx));
  const ros = matched.map((m) => m.ro);
  const main = ros[0];
  const t = timingFor(ctx, c, 'intparts', ros.find((r) => r.site !== c.location) ?? main, [...ros].sort((a, b) => a.neededBy.localeCompare(b.neededBy))[0].neededBy);
  if (ros.some((r) => r.site !== c.location)) lines.push(freightLine(ctx, c, ros.find((r) => r.site !== c.location) ?? main));
  return [{ viable: true, reason: null, lines, demands: ros, estimate: false, timing: t, usesSlot: false }];
}

function valueExtParts(c: CaseRecord, p: DecisionParams, ctx: EngineContext, avail: Availability, idx: DemandIndex, cc: CaseContext): Draft[] {
  const pol = ctx.policy;
  const { matched, fit } = partsFor(c, p, ctx, avail, idx, cc, 'extparts');
  if (!fit.length) return [notViable(ctx, c, 'extparts', `No part at or above the ${p.fitForUseThreshold} % fit-for-use threshold (GR-03)`)];
  const lines: ValueLine[] = [];
  let partsValue = 0;
  const named = new Set(matched.map((m) => m.part.name));
  for (const { part, ro } of matched) {
    const v = part.newPrice * pol.certifiedPartFactor * pol.externalPartsFactor;
    partsValue += v;
    lines.push(
      line(ctx, 'value', 'part_value', `Certified ${part.name.toLowerCase()} to ${ro.customer} (${ro.id})`, `New price ${usd(part.newPrice)} × ${pct(pol.certifiedPartFactor)} certified × ${pct(pol.externalPartsFactor)} network price`, v, ro.id),
    );
  }
  for (const part of fit.filter((x) => !named.has(x.name))) {
    const v = part.newPrice * pol.certifiedPartFactor * pol.marketplacePartsFactor * p.resalePriceIndex;
    partsValue += v;
    lines.push(
      line(ctx, 'value', 'parts_estimate', `${part.name} on the parts marketplace (no buyer yet)`, `New price ${usd(part.newPrice)} × ${pct(pol.certifiedPartFactor)} certified × ${pct(pol.marketplacePartsFactor)} marketplace price × index ${p.resalePriceIndex}`, v),
    );
  }
  lines.push(line(ctx, 'value', 'carcass_material', 'Remaining carcass to recycler', `${pct(pol.carcassMaterialShare)} of material value ${usd(materialValue(c, p, ctx))}`, materialValue(c, p, ctx) * pol.carcassMaterialShare));
  lines.push(teardownLine(c, p, ctx));
  lines.push(line(ctx, 'cost', 'parts_handling', 'Listing, packing and shipping', `${pct(pol.partsHandlingPct)} of parts value ${usd(partsValue)}`, partsValue * pol.partsHandlingPct));
  const ros = matched.map((m) => m.ro);
  const t = ros.length
    ? timingFor(ctx, c, 'extparts', ros[0], [...ros].sort((a, b) => a.neededBy.localeCompare(b.neededBy))[0].neededBy)
    : timingFor(ctx, c, 'extparts', null);
  return [{ viable: true, reason: null, lines, demands: ros, estimate: ros.length === 0, timing: t, usesSlot: false }];
}

function valueMaterial(c: CaseRecord, p: DecisionParams, ctx: EngineContext, idx: DemandIndex): Draft[] {
  const pol = ctx.policy;
  const cls = pol.classes[c.productClass];
  const kg = cls.weightKg * c.quantity;
  const decommission = line(ctx, 'cost', 'decommission', 'Decommission and hazardous-material handling', `${usd(cls.decommissionFee)} per unit × ${c.quantity}`, cls.decommissionFee * c.quantity * p.refurbCostIndex);
  const t0 = timingFor(ctx, c, 'material', null);
  const quotes = candidates(idx, ['recycler_quote'], c).filter((q: RecyclerQuoteDemand) => q.certified && q.validTo >= t0.ready);
  const best = [...quotes].sort((a, b) => b.ratePerKg - a.ratePerKg || a.id.localeCompare(b.id))[0];
  if (best) {
    const t = timingFor(ctx, c, 'material', best, best.validTo);
    return [
      {
        viable: true,
        reason: null,
        lines: [
          line(ctx, 'value', 'recycler_quote', `Recycler quote from ${best.customer}`, `${usd(kg).slice(1)} kg × ${usd(best.ratePerKg * 100)}/100 kg (certificate ${best.certificateRef})`, kg * best.ratePerKg, best.id),
          decommission,
        ],
        demands: [best],
        estimate: false,
        timing: t,
        usesSlot: false,
      },
    ];
  }
  const est = kg * pol.materialIndexPerKg[c.productClass] * pol.materialEstimateFactor * p.resalePriceIndex;
  return [
    {
      viable: true,
      reason: null,
      lines: [
        line(ctx, 'value', 'material_estimate', 'Material value (no quote on file)', `${kg} kg × index ${usd(pol.materialIndexPerKg[c.productClass] * 100)}/100 kg × ${pct(pol.materialEstimateFactor)} × price index ${p.resalePriceIndex}`, est),
        decommission,
      ],
      demands: [],
      estimate: true,
      timing: t0,
      usesSlot: false,
    },
  ];
}

function valueExit(c: CaseRecord, ctx: EngineContext): Draft[] {
  const fee = ctx.policy.classes[c.productClass].disposalFee;
  return [
    {
      viable: true,
      reason: null,
      lines: [line(ctx, 'cost', 'disposal_fee', 'Certified disposal fee', `${usd(fee)} per unit × ${c.quantity} (certificate on file, GR-06)`, fee * c.quantity)],
      demands: [],
      estimate: false,
      timing: timingFor(ctx, c, 'exit', null),
      usesSlot: false,
    },
  ];
}

/**
 * Values one route for one case.
 *
 * Picks the best usable named demand for the route (or a market estimate where the spec
 * allows one), applies grade / life / timing / fit-for-use gates, exclusion rules and
 * blocked routes, and returns the line items with their sources.
 *
 * @param avail resources still free (queue planning). Omit to value the case alone.
 */
export function valueRoute(c: CaseRecord, route: RouteId, params: Partial<DecisionParams> | undefined, ctx: EngineContext, avail: Availability = NO_AVAIL): RouteValue {
  const p = resolveParams(ctx.policy, params);
  const cc = ctx.contextFor(c);
  if (ctx.blocked?.includes(route)) return finish(c, route, notViable(ctx, c, route, 'Route removed from the decision flow'), p, ctx);
  const why = ctx.restricted?.[route];
  if (why) return finish(c, route, notViable(ctx, c, route, why), p, ctx);
  const excl = ctx.rules.find((r) => r.action === 'exclude' && r.route === route && ruleMatches(r, c, cc));
  if (excl) return finish(c, route, notViable(ctx, c, route, `Business rule ${excl.id}: ${excl.description}`), p, ctx);
  const idx = demandIndex(ctx.demands, p.leaseDemand);
  const slotAvail: Availability = { ...avail, slotsLeft: Math.min(avail.slotsLeft, p.refurbSlots) };
  switch (route) {
    case 'redeploy':
      return pickDraft(valueRedeploy(c, p, ctx, avail, idx), c, route, p, ctx);
    case 'relase':
      return pickDraft(valueRelease(c, p, ctx, slotAvail, idx, cc), c, route, p, ctx);
    case 'resale':
      return pickDraft(valueResale(c, p, ctx, avail, idx), c, route, p, ctx);
    case 'intparts':
      return pickDraft(valueIntParts(c, p, ctx, avail, idx, cc), c, route, p, ctx);
    case 'extparts':
      return pickDraft(valueExtParts(c, p, ctx, avail, idx, cc), c, route, p, ctx);
    case 'material':
      return pickDraft(valueMaterial(c, p, ctx, idx), c, route, p, ctx);
    case 'exit':
      return pickDraft(valueExit(c, ctx), c, route, p, ctx);
  }
}

/* ================================================================ choosing */

/** Sorts routes best first: viable by net (desc), then non-viable in ladder order. */
export function sortRoutes(all: RouteValue[]): RouteValue[] {
  return [...all].sort((a, b) => Number(b.viable) - Number(a.viable) || (a.viable ? b.net - a.net : ROUTE_IDS.indexOf(a.route) - ROUTE_IDS.indexOf(b.route)));
}

/** Applies require / prefer rules to a sorted route list. */
function choose(sorted: RouteValue[], c: CaseRecord, cc: CaseContext, ctx: EngineContext): { best: RouteValue; rulesApplied: string[] } {
  const top = sorted[0];
  const excluded = ctx.rules.filter((r) => r.action === 'exclude' && ruleMatches(r, c, cc)).map((r) => r.id);
  for (const r of ctx.rules) {
    if (r.action !== 'require' || !ruleMatches(r, c, cc)) continue;
    const v = sorted.find((x) => x.route === r.route && x.viable);
    if (v) return { best: v, rulesApplied: [...excluded, r.id] };
  }
  for (const r of ctx.rules) {
    if (r.action !== 'prefer' || !ruleMatches(r, c, cc) || !top?.viable) continue;
    const v = sorted.find((x) => x.route === r.route && x.viable);
    if (v && v.net >= top.net - Math.abs(top.net) * ctx.policy.preferTolerance) {
      return { best: v, rulesApplied: v.route !== top.route ? [...excluded, r.id] : excluded };
    }
  }
  return { best: top, rulesApplied: excluded };
}

/** Per-route parameter overrides on top of the case parameters (edge-case presets applied to one route). */
export type RouteParams = Partial<Record<RouteId, Partial<DecisionParams>>>;

/** Values every route and picks the best under the rules. */
function evaluate(c: CaseRecord, p: DecisionParams, ctx: EngineContext, avail: Availability, routeParams?: RouteParams) {
  const all = sortRoutes(ROUTE_IDS.map((r) => valueRoute(c, r, routeParams?.[r] ? { ...p, ...routeParams[r] } : p, ctx, avail)));
  const { best, rulesApplied } = choose(all, c, ctx.contextFor(c), ctx);
  return { all, best, rulesApplied };
}

/**
 * The route the intake team would use on its own, without Circularity:
 * - lease_end: grade A → re-lease if a lease demand exists, else resale (D/Scrap → material)
 * - field_return: A → redeploy if demand; B/C → re-lease if demand; else material
 * - trade_in: resale (D/Scrap → material)
 * - excess: resale; D/Scrap → material
 * Falls back to material, then exit, when the standard route is not viable.
 */
export function standardRoute(c: CaseRecord, ctx: EngineContext, params?: Partial<DecisionParams>, avail: Availability = NO_AVAIL): RouteId {
  const ch = ctx.contextFor(c).intakeChannel;
  const lowGrade = c.condition === 'D' || c.condition === 'Scrap';
  const has = (r: RouteId) => valueRoute(c, r, params, { ...ctx, rules: [], blocked: [] }, avail).viable;
  let route: RouteId;
  if (ch === 'lease_end') route = lowGrade ? 'material' : c.condition === 'A' && has('relase') ? 'relase' : 'resale';
  else if (ch === 'field_return') route = c.condition === 'A' && has('redeploy') ? 'redeploy' : (c.condition === 'B' || c.condition === 'C') && has('relase') ? 'relase' : 'material';
  else route = lowGrade ? 'material' : 'resale';
  if (!has(route)) route = has('material') ? 'material' : 'exit';
  return route;
}

export interface DecideOptions {
  params?: Partial<DecisionParams>;
  /** Replaces the context rules (Studio draft rules). */
  rules?: BusinessRule[];
  /** Routes removed from the flow. */
  blocked?: RouteId[];
  /** Routes withheld with a stated reason. */
  restricted?: Partial<Record<RouteId, string>>;
  /** Parameter overrides for single routes. */
  routeParams?: RouteParams;
  /** Resources still free; omit to decide the case alone. */
  avail?: Availability;
  /** Standalone availability used for the standard route (defaults to `avail`). */
  standardAvail?: Availability;
  override?: OverrideRecord | null;
}

/**
 * Decides one case on its own: values every route, applies the rules and compares with
 * the intake channel's standard route.
 */
export function decideCase(c: CaseRecord, ctx0: EngineContext, opts: DecideOptions = {}): CaseDecision {
  const ctx: EngineContext = { ...ctx0, rules: opts.rules ?? ctx0.rules, blocked: opts.blocked ?? ctx0.blocked, restricted: opts.restricted ?? ctx0.restricted };
  const p = resolveParams(ctx.policy, opts.params);
  const avail = opts.avail ?? NO_AVAIL;
  const { all, best: chosen, rulesApplied } = evaluate(c, p, ctx, avail, opts.routeParams);
  const ov = opts.override ?? null;
  const best = ov ? (all.find((r) => r.route === ov.route) ?? chosen) : chosen;
  const stdRoute = standardRoute(c, ctx, p, opts.standardAvail ?? avail);
  const standard = valueRoute(c, stdRoute, p, { ...ctx, rules: [], blocked: [] }, opts.standardAvail ?? avail);
  const runnerUp = all.find((r) => r.viable && r.route !== best.route) ?? null;
  return {
    caseId: c.id,
    channel: ctx.contextFor(c).intakeChannel,
    all,
    best,
    standardRoute: stdRoute,
    standard,
    gainOverStandard: best.net - standard.net,
    runnerUp,
    rulesApplied,
    mode: 'standalone',
    standaloneBest: null,
    planNote: null,
    override: ov,
  };
}

/* ================================================================ queue plan */

export interface PlanOptions {
  params?: Partial<DecisionParams>;
  rules?: BusinessRule[];
  blocked?: RouteId[];
  /** Demand ids already committed to approved / handed-off cases. */
  committed?: Map<string, string>;
  /** Owner overrides by case id (fixed first). */
  overrides?: Map<string, OverrideRecord>;
}

const exclusiveIds = (v: RouteValue) => v.demands.filter(EXCLUSIVE).map((d) => d.id);
const usesScarce = (v: RouteValue) => v.viable && (v.usesSlot || exclusiveIds(v).length > 0);

function availOf(taken: Map<string, string>, slotsLeft: number): Availability {
  return { taken: new Set(taken.keys()), holder: taken, slotsLeft };
}

function toAssignment(c: CaseRecord, v: RouteValue): QueueAssignment {
  return { caseId: c.id, route: v.route, demandIds: exclusiveIds(v), net: v.net, usesSlot: v.viable && v.usesSlot };
}

/**
 * Plans the whole open queue together.
 *
 * Each exclusive demand record goes to at most one case and refurbishment is limited to
 * `refurbSlots`. Allocation is by regret: at each step the case that would lose most if
 * denied its best option's scarce resources gets them. Cases whose best option uses no
 * scarce resource keep it. Owner overrides are fixed first. The result is compared with
 * first come, first served (oldest case picks first).
 */
export function planQueue(open: CaseRecord[], ctx0: EngineContext, opts: PlanOptions = {}): QueuePlan {
  const ctx: EngineContext = { ...ctx0, rules: opts.rules ?? ctx0.rules, blocked: opts.blocked ?? ctx0.blocked };
  const p = resolveParams(ctx.policy, opts.params);
  const committed = opts.committed ?? new Map<string, string>();
  const overrides = opts.overrides ?? new Map<string, OverrideRecord>();
  const cases = [...open].sort((a, b) => a.id.localeCompare(b.id));
  const baseAvail = availOf(committed, p.refurbSlots);

  /* ---- regret allocation ---- */
  const taken = new Map(committed);
  let slotsLeft = p.refurbSlots;
  const chosen = new Map<string, RouteValue>();

  const assign = (c: CaseRecord, v: RouteValue) => {
    chosen.set(c.id, v);
    if (!v.viable) return;
    for (const id of exclusiveIds(v)) taken.set(id, c.id);
    if (v.usesSlot) slotsLeft -= 1;
  };

  for (const c of cases) {
    const ov = overrides.get(c.id);
    if (!ov) continue;
    assign(c, valueRoute(c, ov.route, p, ctx, availOf(taken, slotsLeft)));
  }

  interface Cand {
    best: RouteValue;
    /** Best option when denied the scarce resources of `best`. */
    alt: RouteValue | null;
    regret: number;
  }
  const cache = new Map<string, Cand>();
  const candFor = (c: CaseRecord): Cand => {
    const hit = cache.get(c.id);
    if (hit) return hit;
    const av = availOf(taken, slotsLeft);
    const { best } = evaluate(c, p, ctx, av);
    let regret = 0;
    let alt: RouteValue | null = null;
    if (usesScarce(best)) {
      const denied = new Map(taken);
      for (const id of exclusiveIds(best)) denied.set(id, '');
      alt = evaluate(c, p, ctx, availOf(denied, best.usesSlot ? 0 : slotsLeft)).best;
      regret = best.net - (alt.viable ? alt.net : 0);
    }
    const cand = { best, alt, regret };
    cache.set(c.id, cand);
    return cand;
  };

  let remaining = cases.filter((c) => !chosen.has(c.id));
  while (remaining.length) {
    const free = remaining.filter((c) => !usesScarce(candFor(c).best));
    if (free.length) {
      for (const c of free) assign(c, candFor(c).best);
      remaining = remaining.filter((c) => !chosen.has(c.id));
      continue;
    }
    let pick = remaining[0];
    for (const c of remaining) {
      const a = candFor(c);
      const b = candFor(pick);
      if (a.regret > b.regret || (a.regret === b.regret && (a.best.net > b.best.net || (a.best.net === b.best.net && c.receivedDate < pick.receivedDate)))) pick = c;
    }
    const v = candFor(pick).best;
    assign(pick, v);
    remaining = remaining.filter((c) => c.id !== pick.id);
    const ids = new Set(exclusiveIds(v));
    // Anyone whose cached best touched what was just taken is re-evaluated.
    for (const c of remaining) {
      const cand = cache.get(c.id);
      if (!cand) continue;
      const touched = [cand.best, cand.alt].some((x) => x && (exclusiveIds(x).some((id) => ids.has(id)) || (v.usesSlot && x.usesSlot)));
      if (touched) cache.delete(c.id);
    }
  }

  /* ---- first come, first served ---- */
  const fcfsTaken = new Map(committed);
  let fcfsSlots = p.refurbSlots;
  const fcfsAssignments: Record<string, QueueAssignment> = {};
  let fcfsValue = 0;
  for (const c of [...cases].sort((a, b) => a.receivedDate.localeCompare(b.receivedDate) || a.id.localeCompare(b.id))) {
    const ov = overrides.get(c.id);
    const av = availOf(fcfsTaken, fcfsSlots);
    const v = ov ? valueRoute(c, ov.route, p, ctx, av) : evaluate(c, p, ctx, av).best;
    if (v.viable) {
      for (const id of exclusiveIds(v)) fcfsTaken.set(id, c.id);
      if (v.usesSlot) fcfsSlots -= 1;
    }
    fcfsAssignments[c.id] = toAssignment(c, v);
    fcfsValue += v.net;
  }

  /* ---- per-case decisions ---- */
  const assignments: Record<string, QueueAssignment> = {};
  const decisions: Record<string, CaseDecision> = {};
  let planValue = 0;
  let standardValue = 0;
  let slotsUsed = 0;
  const standaloneBest = new Map<string, RouteValue>();
  for (const c of cases) {
    const v = chosen.get(c.id);
    if (!v) continue;
    assignments[c.id] = toAssignment(c, v);
    planValue += v.net;
    if (v.viable && v.usesSlot) slotsUsed += 1;
  }
  for (const c of cases) {
    const v = chosen.get(c.id);
    if (!v) continue;
    const own = new Set(exclusiveIds(v));
    const othersTaken = new Map([...taken].filter(([id]) => !own.has(id)));
    const othersSlots = p.refurbSlots - slotsUsed + (v.viable && v.usesSlot ? 1 : 0);
    const av = availOf(othersTaken, othersSlots);
    const all = sortRoutes(ROUTE_IDS.map((r) => (r === v.route ? v : valueRoute(c, r, p, ctx, av))));
    const alone = evaluate(c, p, ctx, baseAvail);
    standaloneBest.set(c.id, alone.best);
    const stdRoute = standardRoute(c, ctx, p, av);
    const standard = valueRoute(c, stdRoute, p, { ...ctx, rules: [], blocked: [] }, av);
    standardValue += standard.net;
    const { rulesApplied } = choose(all, c, ctx.contextFor(c), ctx);
    let planNote: string | null = null;
    const sameChoice = alone.best.route === v.route && exclusiveIds(alone.best).join() === exclusiveIds(v).join();
    if (!overrides.has(c.id) && !sameChoice) {
      const lost = exclusiveIds(alone.best).filter((id) => othersTaken.has(id));
      const what = `${alone.best.routeName}${alone.best.demand ? ` on ${alone.best.demand.id}` : ''} (${usd(alone.best.net)})`;
      if (lost.length) planNote = `Deciding this case alone would choose ${what}; ${lost[0]} goes to ${othersTaken.get(lost[0])} where it adds more.`;
      else if (alone.best.usesSlot && !v.usesSlot) planNote = `Deciding this case alone would choose ${what}; all ${p.refurbSlots} refurbishment slots go to cases where refurbishment adds more.`;
      else planNote = `Deciding this case alone would choose ${what}; the queue plan picks ${v.routeName} (${usd(v.net)}).`;
    }
    const runnerUp = all.find((r) => r.viable && r.route !== v.route) ?? null;
    decisions[c.id] = {
      caseId: c.id,
      channel: ctx.contextFor(c).intakeChannel,
      all,
      best: v,
      standardRoute: stdRoute,
      standard,
      gainOverStandard: v.net - standard.net,
      runnerUp,
      rulesApplied,
      mode: 'plan',
      standaloneBest: alone.best,
      planNote,
      override: overrides.get(c.id) ?? null,
    };
  }

  /* ---- contested demands ---- */
  const wanted = new Map<string, string[]>();
  for (const c of cases) {
    const alone = standaloneBest.get(c.id);
    if (!alone || !alone.viable) continue;
    for (const id of exclusiveIds(alone)) wanted.set(id, [...(wanted.get(id) ?? []), c.id]);
  }
  const byId = new Map(cases.map((c) => [c.id, c]));
  const lossIfDenied = (caseId: string, demandId: string) => {
    const c = byId.get(caseId);
    if (!c) return 0;
    const base = standaloneBest.get(caseId)?.net ?? 0;
    const denied = new Map(committed);
    denied.set(demandId, '');
    const alt = evaluate(c, p, ctx, availOf(denied, p.refurbSlots)).best;
    return base - (alt.viable ? alt.net : 0);
  };
  const contested: ContestedDemand[] = [];
  for (const [demandId, wantedBy] of wanted) {
    if (wantedBy.length < 2) continue;
    const assignedTo = taken.get(demandId) ?? null;
    const losses = wantedBy.map((id) => ({ id, loss: lossIfDenied(id, demandId) }));
    const mine = losses.find((l) => l.id === assignedTo)?.loss ?? 0;
    const other = Math.max(0, ...losses.filter((l) => l.id !== assignedTo).map((l) => l.loss));
    const d = findDemand(ctx, demandId);
    contested.push({ demandId, kind: d?.kind ?? 'sales_order', wantedBy, assignedTo, gain: Math.max(0, mine - other) });
  }
  contested.sort((a, b) => b.gain - a.gain || a.demandId.localeCompare(b.demandId));

  return {
    assignments,
    decisions,
    planValue,
    fcfsValue,
    gain: planValue - fcfsValue,
    fcfsAssignments,
    contested,
    refurbSlotsUsed: slotsUsed,
    refurbSlots: p.refurbSlots,
    standardValue,
  };
}

/** Rounds to tens (used by generators for prices). */
export const roundTens = r10;
