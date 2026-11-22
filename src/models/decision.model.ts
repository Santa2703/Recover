/**
 * Decision engine types (see docs/recover-reference.md section 1).
 *
 * The engine prices every disposition route for a returned asset against named demand
 * records, picks the best route per case and plans the whole open queue together so each
 * demand record and each refurbishment slot is used where it adds most.
 */
import type { CaseRecord } from './domain.model';
import type { DispositionRouteId } from './treatment.model';

export type RouteId = DispositionRouteId;
export type ProductClass = CaseRecord['productClass'];
export type Grade = CaseRecord['condition'];

/* ------------------------------------------------------------ intake */

/** How the asset came back. Drives the "standard route" the owning team would use alone. */
export type IntakeChannel = 'lease_end' | 'field_return' | 'trade_in' | 'excess';

/** A harvestable part of one asset, with its remaining life. */
export interface HarvestPart {
  name: string;
  /** New part list price (USD, whole lot for batches). */
  newPrice: number;
  /** Remaining life 0–100 %. */
  lifePct: number;
}

/** Per-case decision context that the core case record does not carry (src/data/decision/channels.json). */
export interface CaseContext {
  intakeChannel: IntakeChannel;
  /** Remaining life of the whole asset, 0–100 %. */
  lifePct: number;
  parts: HarvestPart[];
}

/* ------------------------------------------------------------ demand */

export type DemandKind =
  | 'lease_order'
  | 'lease_renewal'
  | 'sales_order'
  | 'buyer_bid'
  | 'redeploy_request'
  | 'repair_order'
  | 'recycler_quote';

interface DemandBase {
  /** LO-xxxx, SO-xxxx, BID-xxxx, RR-xxxx, RO-xxxx, RQ-xxxx. */
  id: string;
  kind: DemandKind;
  /** Customer, buyer, requesting site or recycler. */
  customer: string;
  /** Site the asset has to be shipped to / collected from. */
  site: string;
  productClass: ProductClass;
  /** Specific model required, or null when any model of the class fits. */
  model: string | null;
  /** ISO date (yyyy-mm-dd) the asset (or part) is needed by. */
  neededBy: string;
  createdAt: string;
  /** Owning system for the demand record (shown as a source). */
  system: string;
}

/** New lease order or lease renewal (prices Secondary Re-lease). */
export interface LeaseDemand extends DemandBase {
  kind: 'lease_order' | 'lease_renewal';
  monthlyFee: number;
  termMonths: number;
  /** Lowest acceptable grade before refurbishment. */
  minGrade: Grade;
}

/** Confirmed sales order for a whole asset (prices Whole-Asset Resale). */
export interface SalesOrderDemand extends DemandBase {
  kind: 'sales_order';
  price: number;
}

/** Open buyer bid on the remarketing channel (prices Whole-Asset Resale). */
export interface BuyerBidDemand extends DemandBase {
  kind: 'buyer_bid';
  price: number;
  minGrade: Grade;
  /** ISO date the bid expires; the asset must be ready by then. */
  validTo: string;
}

/** Internal request from a site that is short of a model (prices Internal Redeploy). */
export interface RedeployDemand extends DemandBase {
  kind: 'redeploy_request';
  /** What the site would otherwise spend to get an equivalent unit. */
  avoidedCost: number;
  minGrade: Grade;
}

/** Open repair order that needs a part (prices Internal Parts Harvest / External Parts Sale). */
export interface RepairOrderDemand extends DemandBase {
  kind: 'repair_order';
  part: string;
  backordered: boolean;
  /** internal = our service fleet (intparts); external = third-party repair network (extparts). */
  network: 'internal' | 'external';
}

/** Recycler rate card (prices Material Recovery). Rate cards are shared, not used up. */
export interface RecyclerQuoteDemand extends DemandBase {
  kind: 'recycler_quote';
  ratePerKg: number;
  certified: boolean;
  certificateRef: string;
  validTo: string;
}

export type Demand =
  | LeaseDemand
  | SalesOrderDemand
  | BuyerBidDemand
  | RedeployDemand
  | RepairOrderDemand
  | RecyclerQuoteDemand;

/* ------------------------------------------------------------ policy */

/** Where a number comes from, in plain language. */
export interface LineSource {
  system: string;
  method: string;
  freshness: string;
  approvedBy?: string;
  /** Record the number was read from (e.g. LO-2231), when there is one. */
  reference?: string;
}

/** Every kind of value / cost / time line the engine can produce. */
export type LineKind =
  | 'sale_order'
  | 'buyer_bid'
  | 'market_estimate'
  | 'commission'
  | 'test_certify'
  | 'lease_income'
  | 'residual_value'
  | 'servicing'
  | 'refurbishment'
  | 'avoided_purchase'
  | 'recommission'
  | 'freight'
  | 'part_value'
  | 'parts_estimate'
  | 'wait_cost_avoided'
  | 'teardown'
  | 'parts_handling'
  | 'carcass_material'
  | 'recycler_quote'
  | 'material_estimate'
  | 'decommission'
  | 'disposal_fee'
  | 'holding';

export interface RoutePolicy {
  name: string;
  leadDays: number;
  owner: string;
  /** Owning system where the route is executed. */
  executesIn: string;
}

export interface ClassPolicy {
  /** Weight of one unit in kg (material recovery). */
  weightKg: number;
  /** Floor-space factor applied to the holding cost per day (1 = one standard bay). */
  holdingSpace: number;
  /** Freight between sites, USD per unit / lot. */
  freight: number;
  /** Certified disposal fee per unit. */
  disposalFee: number;
  /** Decommission and hazardous-material handling before recycling. */
  decommissionFee: number;
}

export interface Policy {
  version: string;
  /** USD per standard bay per day while the asset waits (set by Finance, GR-04). */
  holdingCostPerDay: number;
  /** Annual cost of capital used to discount lease income and residual value. */
  costOfCapital: number;
  /** Remaining-life points used per month of lease. */
  lifeUsedPerMonth: number;
  /** Remaining-life points restored by a full refurbishment. */
  refurbRestoresLife: number;
  /** Servicing during a lease, as a share of the replacement value per year (engine.assetValue). */
  servicingPctPerYear: number;
  /** Minimum part remaining life (%) to certify a used part (GR-03). */
  fitForUseThreshold: number;
  /** Certified used part price as a share of the new part price. */
  certifiedPartFactor: number;
  /** Cost avoided per backordered repair order that a harvested part unblocks. */
  customerWaitCost: number;
  /** Refurbishment (re-lease) slots in the repair centre for the open queue. */
  refurbSlots: number;
  /** Extra days when the demand site differs from the asset site. */
  transferDays: number;
  /** Minimum remaining life for Secondary Re-lease. */
  relaseMinLife: number;
  /** Prefer-rules only win when within this share of the best net (0.15 = 15 %). */
  preferTolerance: number;
  /** Market estimate haircut when no buyer is named yet. */
  estimateHaircut: number;
  /** Remarketing commission on bids and estimates. */
  channelCommission: number;
  /** Commission on a direct confirmed sales order. */
  directCommission: number;
  /** Share of refurbishment cost spent to test, clean and certify for resale. */
  testCertifyShare: number;
  /** Share of refurbishment cost spent to recommission for redeploy. */
  recommissionShare: number;
  /** Teardown and certification as a share of the replacement value. */
  teardownPct: number;
  /** External repair networks pay this share of the certified part price. */
  externalPartsFactor: number;
  /** Marketplace estimate for unsold parts, as a share of the certified price. */
  marketplacePartsFactor: number;
  /** Listing, packing and shipping for external parts, share of parts value. */
  partsHandlingPct: number;
  /** Carcass left after teardown, share of the material value. */
  carcassMaterialShare: number;
  /** Index recycling rate per kg by class when no recycler quote is on file. */
  materialIndexPerKg: Record<ProductClass, number>;
  /** Discount on the index rate when no quote is on file. */
  materialEstimateFactor: number;
  classes: Record<ProductClass, ClassPolicy>;
  routes: Record<RouteId, RoutePolicy>;
  /** Plain-language source for every line kind. */
  sources: Record<LineKind, LineSource>;
}

/** Portfolio What-if levers. Every field defaults to the published policy. */
export interface DecisionParams {
  /** Multiplier on market-priced estimates (resale, parts, material). 1 = today. */
  resalePriceIndex: number;
  /** Multiplier on refurbishment, test and teardown costs. 1 = today. */
  refurbCostIndex: number;
  /** Share of open lease orders that stay available, 0–1. 1 = today. */
  leaseDemand: number;
  customerWaitCost: number;
  fitForUseThreshold: number;
  holdingCostPerDay: number;
  refurbSlots: number;
}

/* ------------------------------------------------------------ rules */

export type RuleAction = 'exclude' | 'prefer' | 'require';

export interface RuleScope {
  productClass?: ProductClass[];
  condition?: Grade[];
  channel?: IntakeChannel[];
  site?: string[];
  /** Applies when remaining life is below this %. */
  lifeMax?: number;
  /** Applies when remaining life is at least this %. */
  lifeMin?: number;
}

export interface BusinessRule {
  id: string;
  action: RuleAction;
  route: RouteId;
  scope: RuleScope;
  owner: string;
  /** Plain-language read-back, e.g. "Control units with life of at least 40 %: never Material Recovery". */
  description: string;
  active?: boolean;
}

export interface RuleSet {
  version: number;
  publishedAt: string;
  publishedBy: string;
  rules: BusinessRule[];
}

export interface Guardrail {
  id: string;
  title: string;
  description: string;
  owner: string;
  locked: true;
}

/* ------------------------------------------------------------ valuation */

export interface ValueLine {
  type: 'value' | 'cost' | 'time';
  kind: LineKind;
  label: string;
  /** Plain-language formula with the actual numbers. */
  basis: string;
  /** Always positive; `type` says whether it adds or subtracts. */
  amount: number;
  sources: LineSource[];
}

export interface RouteTiming {
  leadDays: number;
  /** Transfer days added because the demand site differs (0 when same site). */
  transferDays: number;
  transfer: boolean;
  /** ISO date the asset is ready at the demand site. */
  ready: string;
  /** ISO date the demand needs it by (null without a demand record). */
  neededBy: string | null;
  /** neededBy − ready in days (negative = late), null without a demand. */
  bufferDays: number | null;
  /** Days from approval until the route's value is realised: lead + transfer + settle days (engine.SETTLE_DAYS). */
  cycleDays: number;
}

export interface RouteValue {
  route: RouteId;
  routeName: string;
  viable: boolean;
  /** Why the route is not viable (or null). */
  reason: string | null;
  /** value − cost − holding. 0 when not viable. */
  net: number;
  /** Sum of value lines. */
  gross: number;
  /** Sum of cost lines (excluding holding). */
  cost: number;
  /** Holding cost while the route runs. */
  holding: number;
  lines: ValueLine[];
  /** The main named demand record used, or null (estimate / no demand). */
  demand: Demand | null;
  /** All demand records used (several repair orders for parts harvest). */
  demands: Demand[];
  /** True when priced against at least one named demand record. */
  committed: boolean;
  /** True when priced on a market estimate ("Estimate · no buyer yet"). */
  estimate: boolean;
  /** Uses one refurbishment slot (Secondary Re-lease). */
  usesSlot: boolean;
  timing: RouteTiming;
  executesIn: string;
  owner: string;
}

/** Resources still free when valuing a case (queue planning). */
export interface Availability {
  /** Demand ids already used by another case. */
  taken: ReadonlySet<string>;
  /** Who holds each taken demand id (for reason text). */
  holder?: ReadonlyMap<string, string>;
  /** Refurbishment slots still free. */
  slotsLeft: number;
}

export interface CaseDecision {
  caseId: string;
  channel: IntakeChannel;
  /** Every route, best first (viable before non-viable). */
  all: RouteValue[];
  best: RouteValue;
  standardRoute: RouteId;
  standard: RouteValue;
  gainOverStandard: number;
  /** Next best viable route on a different route, or null. */
  runnerUp: RouteValue | null;
  /** Ids of business rules that changed or constrained the decision. */
  rulesApplied: string[];
  /** 'plan' when allocated with the whole queue, 'standalone' when decided alone. */
  mode: 'plan' | 'standalone';
  /** Best route when deciding this case alone (plan mode only). */
  standaloneBest: RouteValue | null;
  /** Why the plan moved this case off its standalone best, or null. */
  planNote: string | null;
  override: OverrideRecord | null;
}

export interface QueueAssignment {
  caseId: string;
  route: RouteId;
  demandIds: string[];
  net: number;
  usesSlot: boolean;
}

export interface ContestedDemand {
  demandId: string;
  kind: DemandKind;
  /** Case ids whose standalone best uses this demand. */
  wantedBy: string[];
  assignedTo: string | null;
  /** How much more the plan earns by giving it to `assignedTo` instead of the next-best claimant. */
  gain: number;
}

export interface QueuePlan {
  assignments: Record<string, QueueAssignment>;
  decisions: Record<string, CaseDecision>;
  planValue: number;
  fcfsValue: number;
  /** planValue − fcfsValue. */
  gain: number;
  fcfsAssignments: Record<string, QueueAssignment>;
  contested: ContestedDemand[];
  refurbSlotsUsed: number;
  refurbSlots: number;
  /** Standard-route value for the same cases (each decided alone). */
  standardValue: number;
}

/* ------------------------------------------------------------ explain */

export interface ActionStep {
  title: string;
  /** ISO date. */
  when: string;
  detail: string;
}

export interface ProofItem {
  ok: boolean;
  heading: 'Demand' | 'Condition' | 'Timing' | 'Capacity and cost' | 'Price';
  body: string;
  source: string;
}

export interface NextBestAction {
  caseId: string;
  label: 'Next best action' | 'Approved action' | 'Proposed action';
  headline: string;
  /** "$7,710 · +$2,260 over the lease-end standard route (Whole-Asset Resale, $5,450) · executes in …" */
  summary: string;
  net: number;
  gainOverStandard: number;
  steps: ActionStep[];
  proof: ProofItem[];
  /** "If this falls through: Whole-Asset Resale, $5,450" or null. */
  fallback: string | null;
  pill: 'Against named demand' | 'Estimate · no buyer yet' | 'No viable route';
  planNote: string | null;
}

export type AgentStepId = 'intake' | 'condition' | 'demand' | 'fit' | 'valuation' | 'decision' | 'follow';

export interface AgentStep {
  id: AgentStepId;
  title: string;
  status: 'done' | 'warning';
  conclusion: string;
}

export type KpiKey = 'decisionsWaiting' | 'gainOverStandard' | 'potentialRecovery' | 'valueAtRisk' | 'forecastAccuracy' | 'queueValue';

export interface HowCalculated {
  key: KpiKey;
  title: string;
  formula: string;
  value: number;
  /** Unit of `value` and row values. */
  unit: 'usd' | 'count' | 'pct';
  rows: { id: string; label: string; detail: string; value: number; caseId?: string }[];
}

/* ------------------------------------------------------------ portfolio */

/** Same scope shape as metricsService (tenant 'All' = every tenant). */
export interface DecisionScope {
  tenant?: string;
  site?: string;
  route?: RouteId | 'all';
  productClass?: string;
}

export interface ChannelGap {
  channel: IntakeChannel;
  label: string;
  standard: number;
  best: number;
  gain: number;
  n: number;
}

export interface RouteMixRow {
  route: RouteId;
  name: string;
  n: number;
  value: number;
}

export interface DecisionSummary {
  openDecisions: number;
  /** Open decisions awaiting approval. */
  waiting: number;
  gainOverStandard: number;
  queueValue: number;
  standardValue: number;
  /** Queue value under first come, first served. */
  fcfsValue: number;
  planGain: number;
  contested: number;
  namedDemandShare: number;
  byChannel: ChannelGap[];
  routeMix: RouteMixRow[];
}

export interface WhatIfChange {
  caseId: string;
  from: RouteId;
  to: RouteId;
  netToday: number;
  netScenario: number;
  netDelta: number;
}

export interface WhatIfResult {
  params: DecisionParams;
  today: number;
  scenario: number;
  standard: number;
  changes: WhatIfChange[];
  mixToday: RouteMixRow[];
  mixScenario: RouteMixRow[];
}

/* ------------------------------------------------------------ learning */

export type OverrideReason =
  | 'Customer commitment'
  | 'Known condition issue not in data'
  | 'Regulatory or contract hold'
  | 'Market knowledge';

/**
 * A route sent for approval by someone who cannot approve (Planner, Engineer, Warehouse
 * Manager). `route` null = Circularity's recommended route as it stands; otherwise another
 * viable route with a required reason. Approving the case applies the proposed route.
 */
export interface RouteProposal {
  route: RouteId | null;
  reason: OverrideReason | null;
  note: string;
  proposedBy: string;
  /** User id and role of the proposer (self-approval check; the demo display name is shared by every role). */
  proposedById?: string;
  proposedByRole?: string;
  /** ISO time. */
  proposedAt: string;
  /** Stage before the proposal moved the case to "Awaiting approval" (restored on withdraw). */
  fromStage?: CaseRecord['stage'];
  /** Evidence snapshot the proposal was submitted on ("EVS-XXXXXXXX"). */
  snapshotId?: string;
}

export interface OverrideRecord {
  caseId: string;
  route: RouteId;
  fromRoute: RouteId;
  reason: OverrideReason;
  actor: string;
  at: string;
}

export interface DecisionHistoryRecord {
  id: string;
  caseId: string;
  snapshot: {
    productClass: ProductClass;
    productName: string;
    model: string;
    condition: Grade;
    lifePct: number;
    tenant: string;
    site: string;
    quantity: number;
  };
  channel: IntakeChannel;
  /** Route actually executed. */
  route: RouteId;
  /** Route Circularity recommended. */
  recommendedRoute: RouteId;
  standardRoute: RouteId;
  forecastNet: number;
  realisedNet: number;
  standardNet: number;
  /** forecastNet − standardNet. */
  gain: number;
  /** realisedNet − standardNet. */
  realisedGain: number;
  namedDemand: boolean;
  overridden: boolean;
  overrideReason: OverrideReason | null;
  decidedBy: 'circularity' | 'owner';
  actor: string;
  hoursToComplete: number;
  closedDaysAgo: number;
  /** ISO date. */
  closedAt: string;
}

export interface HistoryQuery {
  route?: RouteId | 'all';
  channel?: IntakeChannel | 'all';
  overridden?: boolean;
  /** Only decisions closed within this many days. */
  sinceDays?: number;
  search?: string;
  sortBy?: keyof DecisionHistoryRecord;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface AccuracyStats {
  n: number;
  /** 1 − Σ|realised − forecast| / Σ|forecast|, 0–1. */
  accuracy: number;
  /** Share of decisions within 5 % of forecast. */
  within5: number;
  /** Σ(realised − forecast) / Σ|forecast| (positive = we under-forecast). */
  bias: number;
  forecast: number;
  realised: number;
}

export interface HistoryGroup extends AccuracyStats {
  key: string;
  label: string;
  gain: number;
}

export interface AccuracyMatrix {
  /** rows: who decided; cols: within 5 % / missed by more than 5 %. */
  cells: { decidedBy: 'circularity' | 'owner'; within5: boolean; n: number; ids: string[] }[];
}

export interface InboxItem {
  case: CaseRecord;
  context: CaseContext;
}

export interface RunAgentsResult {
  decided: { caseId: string; decision: CaseDecision; trail: AgentStep[] }[];
  gainOverStandard: number;
  net: number;
  /** Returns left in the inbox because the run hit the "max items per bulk plan" limit. */
  remaining?: number;
}

/* ------------------------------------------------------------ eligibility, ranges, hand-off */

/** The six eligibility gates every route passes through (decision/insights.ts). */
export type GateId = 'condition' | 'intervention' | 'policy' | 'demand' | 'economics' | 'sustainability';
/** 'na' = not checked because an earlier gate already withheld the route. */
export type GateStatus = 'ok' | 'warning' | 'failed' | 'na';

export interface GateResult {
  id: GateId;
  /** "Condition & life", "Post-intervention", … */
  name: string;
  status: GateStatus;
  /** One-line reason with the numbers behind it. */
  reason: string;
}

/** Eligible = all gates pass; Conditional = passes with a warning to verify; Restricted = withheld by a failed gate. */
export type RouteStatus = 'Eligible' | 'Conditional' | 'Restricted';
export type Confidence = 'High' | 'Medium' | 'Low';

/** P10–P90 net range of a route from the uncertainty of its value and cost lines. */
export interface ValueRange {
  p10: number;
  p90: number;
  /** Lines that drive most of the spread, largest first, with their volatility. */
  drivers: { label: string; volatility: number; share: number }[];
}

export interface RouteInsight {
  route: RouteId;
  status: RouteStatus;
  /** Why the route is Conditional or Restricted (null when Eligible). */
  statusReason: string | null;
  gates: GateResult[];
  /** Null when the route is not viable. */
  range: ValueRange | null;
  cycleDays: number;
}

/** "Why not the runner-up?": the constraints that put it second. */
export interface WhyNot {
  route: RouteId;
  routeName: string;
  summary: string;
  constraints: { label: 'Value gap' | 'Cycle time' | 'Gate status' | 'Demand certainty' | 'Range overlap'; detail: string; favoursBest: boolean }[];
}

export interface DecisionInsights {
  caseId: string;
  routes: Record<RouteId, RouteInsight>;
  best: RouteId;
  confidence: Confidence;
  confidenceReason: string;
  whyNot: WhyNot | null;
  /** Deterministic id of the evidence the decision rests on, "EVS-XXXXXXXX". */
  snapshotId: string;
  /** Policy version and published rule-set version, "2026.11 · rules v3". */
  modelVersion: string;
}

/** One enterprise instruction approval sends to an owning system. */
export interface Instruction {
  /** Stable id within the case, e.g. "RT-1048-I2". */
  id: string;
  /** Source system name as in src/data/sources.json, e.g. "IBM Maximo EAM". */
  system: string;
  /** "EAM · work order". */
  module: string;
  instruction: string;
  detail: string;
  /** Document reference(s), e.g. "WO-2026-8848". */
  doc: string;
  /** True when approval creates the document (false when it already exists, e.g. a sales order). */
  docNew: boolean;
  /** Role / team that owns the instruction in the target system. */
  owner: string;
  /** Time limit in working hours (Mon–Fri 08:00–17:00 UTC; 1 working day = 9 h). */
  timeLimitHours: number;
  /** "4 working h", "2 working days". */
  timeLimit: string;
}

export interface InstructionPreview {
  caseId: string;
  route: RouteId;
  routeName: string;
  instructions: Instruction[];
  systems: string[];
  /** Spend approval commits: Σ cost lines of the route. */
  spend: number;
  /** "Approval sends 5 instructions to … and commits up to $1,800 of spend." */
  summary: string;
}

export type InstructionStatus = 'not_sent' | 'sent' | 'acknowledged' | 'done';

/** An instruction after approval, with its due time (approval time + time limit in working hours). */
export interface HandoffInstruction extends Instruction {
  caseId: string;
  approvalRef: string;
  status: InstructionStatus;
  /** ISO time the instruction was sent (= approval time), null before approval. */
  sentAt: string | null;
  /** ISO due time, null before approval. */
  dueAt: string | null;
  overdue: boolean;
  /** Working hours past due (0 when not overdue). */
  overdueHours: number;
  /** ISO time the executing system acknowledged the instruction (null when not yet, or unknown). */
  ackAt?: string | null;
  /** ISO time the step was reported done. */
  doneAt?: string | null;
  /** Times the same instruction was sent again (Resend instruction; same id, never a duplicate). */
  resends?: number;
  lastSentAt?: string | null;
}

/** Frozen at approval: what was approved, on which evidence. */
export interface ApprovalRecord {
  caseId: string;
  /** "APR-2026-1048". */
  ref: string;
  /** ISO time of approval. */
  at: string;
  actor: string;
  route: RouteId;
  routeName: string;
  net: number;
  p10: number | null;
  p90: number | null;
  status: RouteStatus;
  confidence: Confidence;
  snapshotId: string;
  modelVersion: string;
  gates: GateResult[];
  /** True for cases approved before this session (deterministic record from the seed data). */
  seeded: boolean;
}

/** Case page edge-case presets. */
export type PresetId = 'demand_cancelled' | 'parts_cost_up' | 'resale_down' | 'cert_short' | 'part_unavailable' | 'new_unit';

export interface ScenarioPreset {
  id: PresetId;
  label: string;
  description: string;
}

/** What a preset does to a case's ranking. */
export interface PresetFlip {
  preset: PresetId;
  label: string;
  flips: boolean;
  from: RouteId;
  to: RouteId | null;
  toName: string | null;
  toNet: number | null;
  /** "Ranking flips if demand is cancelled: Whole-Asset Resale ($4,800) moves to first." */
  text: string;
}