/**
 * Product screens (Returned assets, Expected returns, Asset intelligence, Case workspace).
 *
 * Case data comes from caseService so IDs, counts and values match the rest of the app.
 * Detail the core dataset does not carry (telemetry history, components, evidence items,
 * work orders) is generated deterministically from the case record: the same case always
 * yields the same detail, and it moves with the case's own facts. Route economics come from
 * the decision engine (decisionService), so they match the recommended route everywhere;
 * `scenarioDecision` re-decides one case under the Case page scenario levers.
 * Expected inbound returns (ASNs) live in src/data/expected.json.
 */
import expectedJson from '@/data/expected.json';
import type { CaseRecord, CaseStageId, Paged } from '@/models/domain.model';
import type { DispositionRouteId } from '@/models/treatment.model';
import { caseService } from './caseService';
import type { CaseDecision, NextBestAction } from '@/models/decision.model';
import { nextBestAction, simulateCase } from './decisionService';
import { buildNextBestAction } from './decision/explain';
import { engineContext } from './decision/runtime';
import { createCollection, delay, queryList, sum, type SortDir } from './mock/mockUtils';

type Scope = { tenant?: string; site?: string };
type ProductClass = CaseRecord['productClass'];

/* ------------------------------------------------------------- seeding */

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random sequence for a key (mulberry32). */
function seeded(key: string) {
  let s = hashOf(key);
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round10 = (v: number) => Math.round(v / 10) * 10;
const caseNumber = (id: string) => Number(id.replace(/\D/g, '')) || 0;

/* ------------------------------------------------------- shared labels */

export const PRODUCT_CLASS_LABEL: Record<ProductClass, string> = {
  motor: 'Electric motors',
  pump: 'Hydraulic pumps',
  control: 'Control & PLC',
  drill: 'Power tools',
  it: 'Field electronics',
  batch: 'Tool-fleet batches',
};

export const CONDITION_LABEL: Record<CaseRecord['condition'], string> = {
  A: 'Grade A (like new)',
  B: 'Grade B (good)',
  C: 'Grade C (fair / repair)',
  D: 'Grade D (harvest)',
  Scrap: 'Scrap',
};

export const ROUTE_ORDER: DispositionRouteId[] = ['redeploy', 'relase', 'resale', 'intparts', 'extparts', 'material', 'exit'];

/* ------------------------------------------------------- asset signals */

export type TelemetryStatus = 'active' | 'stale' | 'end_of_life';

export interface AssetSignals {
  /** 0–100 health index derived from grade and predicted failure risk. */
  conditionScore: number;
  operatingHours: number;
  telemetry: TelemetryStatus;
  /** Valuation confidence 0–100, from evidence completeness and demand. */
  confidence: number;
}

const GRADE_SCORE: Record<CaseRecord['condition'], number> = { A: 92, B: 78, C: 60, D: 38, Scrap: 14 };
const HOURS_PER_YEAR: Record<ProductClass, number> = { motor: 4200, pump: 3800, control: 6100, drill: 520, it: 1900, batch: 640 };

export function assetSignals(c: CaseRecord): AssetSignals {
  const r = seeded(`${c.id}:signals`);
  const conditionScore = Math.round(clamp(GRADE_SCORE[c.condition] - c.predictions.failureRiskScore * 18 + (r() - 0.5) * 8, 3, 99));
  const operatingHours = Math.round((c.facts.ageYears * HOURS_PER_YEAR[c.productClass] * (0.7 + r() * 0.6)) / 100) * 100;
  const telemetry: TelemetryStatus =
    c.condition === 'D' || c.condition === 'Scrap' || c.stage === 'no_viable_route' ? 'end_of_life' : r() < 0.2 ? 'stale' : 'active';
  const confidence = Math.round(clamp(52 + c.evidenceCompleteness * 0.3 + c.predictions.resaleDemandScore * 16, 50, 98));
  return { conditionScore, operatingHours, telemetry, confidence };
}

/* ------------------------------------------------------- asset detail */

export interface TelemetryPoint {
  month: string;
  health: number;
  fleet: number;
}

export interface AssetComponent {
  id: string;
  name: string;
  /** Wear 0–100 (100 = worn out). */
  wear: number;
  value: number;
  harvestable: boolean;
}

export interface EvidenceItem {
  id: string;
  label: string;
  source: string;
  status: 'received' | 'missing';
  reference: string;
  capturedAt: string | null;
  detail: string;
}

export interface WorkOrder {
  id: string;
  system: string;
  title: string;
  status: 'queued' | 'acknowledged' | 'in_progress';
  due: string;
}

export interface AssetDetail {
  signals: AssetSignals;
  telemetry: TelemetryPoint[];
  components: AssetComponent[];
  evidence: EvidenceItem[];
  workOrders: WorkOrder[];
  /** 1-based index into meta.journey for the case's current step. */
  journeyStep: number;
}

const COMPONENTS: Record<ProductClass, [string, number][]> = {
  motor: [['Stator winding', 0.32], ['Rotor and shaft', 0.22], ['Bearings (DE / NDE)', 0.08], ['Cooling fan', 0.05], ['Terminal box', 0.06]],
  pump: [['Piston assembly', 0.3], ['Swash plate', 0.18], ['Valve block', 0.2], ['Shaft seal kit', 0.05], ['Housing', 0.1]],
  control: [['CPU module', 0.38], ['I/O cards', 0.24], ['Power supply', 0.12], ['Comms module', 0.14], ['Backplane', 0.05]],
  drill: [['Brushless motor', 0.34], ['Gearbox', 0.2], ['Battery pack', 0.26], ['Chuck', 0.06], ['Housing', 0.04]],
  it: [['Mainboard', 0.36], ['SSD', 0.14], ['Display', 0.2], ['Battery', 0.08], ['Keyboard deck', 0.06]],
  batch: [['Tool bodies', 0.42], ['Battery packs', 0.28], ['Chargers', 0.14], ['Carry cases', 0.04]],
};

const EVIDENCE_TYPES: { id: string; label: string; source: string; prefix: string; detail: string }[] = [
  { id: 'eam', label: 'Service history', source: 'Maximo EAM', prefix: 'EAM', detail: 'Maintenance work orders and last overhaul' },
  { id: 'erp', label: 'Acquisition record', source: 'SAP FI', prefix: 'FI', detail: 'Original cost, depreciation and lease contract' },
  { id: 'wms', label: 'Goods receipt and bin', source: 'WMS', prefix: 'GR', detail: 'Inbound receipt, quantity check and bin location' },
  { id: 'photos', label: 'Inspection photos', source: 'Inspection app', prefix: 'IMG', detail: 'Six-side photo set with damage annotations' },
  { id: 'test', label: 'Functional test report', source: 'Test bench', prefix: 'TST', detail: 'Load test, insulation and vibration readings' },
  { id: 'ehs', label: 'Hazardous materials check', source: 'EHS register', prefix: 'EHS', detail: 'RoHS / PCB declaration and battery handling' },
];

const MONTHS = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];

const JOURNEY_STEP: Record<CaseStageId, number> = {
  awaiting_inspection: 1,
  needs_information: 1,
  no_viable_route: 2,
  reevaluate: 4,
  awaiting_approval: 5,
  approved: 6,
  handed_off: 8,
};

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function assetDetail(c: CaseRecord): AssetDetail {
  const signals = assetSignals(c);
  const r = seeded(`${c.id}:detail`);

  // Health index over the last 12 months, ending at today's condition score.
  const start = clamp(signals.conditionScore + 10 + r() * 14, signals.conditionScore, 99);
  const fleetEnd = GRADE_SCORE.B - 4;
  const telemetry: TelemetryPoint[] = MONTHS.map((month, i) => {
    const t = i / (MONTHS.length - 1);
    const noise = i === MONTHS.length - 1 ? 0 : (r() - 0.5) * 5;
    return {
      month,
      health: Math.round(clamp(start + (signals.conditionScore - start) * t + noise, 0, 100)),
      fleet: Math.round(fleetEnd + 6 - 6 * t),
    };
  });

  const wearBase = 100 - signals.conditionScore;
  const components: AssetComponent[] = COMPONENTS[c.productClass].map(([name, share], i) => {
    const wear = Math.round(clamp(wearBase + (r() - 0.45) * 40, 4, 98));
    return { id: `${c.id}-C${i + 1}`, name, wear, value: round10(c.predictedResale * share * (1 - wear / 140)), harvestable: wear < 55 };
  });

  const received = Math.round((c.evidenceCompleteness / 100) * EVIDENCE_TYPES.length);
  const missingFirst = c.stage === 'needs_information' || c.riskReason === 'missing_evidence';
  const evidence: EvidenceItem[] = EVIDENCE_TYPES.map((e, i) => {
    const ok = missingFirst ? i < Math.min(received, EVIDENCE_TYPES.length - 1) : i < received;
    return {
      id: e.id,
      label: e.label,
      source: e.source,
      status: ok ? 'received' : 'missing',
      reference: `${e.prefix}-${caseNumber(c.id) * 7 + i * 13}`,
      capturedAt: ok ? addDays(c.receivedDate, i === 2 ? 0 : 1 + Math.floor(r() * 4)) : null,
      detail: e.detail,
    };
  });

  const n = caseNumber(c.id);
  const workOrders: WorkOrder[] =
    c.stage === 'approved' || c.stage === 'handed_off'
      ? [
          {
            id: `WO-2026-${8800 + n}`,
            system: 'SAP PM',
            title: c.recommendedRoute === 'material' || c.recommendedRoute === 'exit' ? 'Decommission and certify for recovery' : 'Refurbish, test and certify',
            status: c.stage === 'handed_off' ? 'in_progress' : 'queued',
            due: addDays(c.dueDate, 5),
          },
          {
            id: `TO-${c.location === 'Warehouse 1' ? 'W1' : c.location === 'Warehouse 2' ? 'W2' : 'RC'}-${4400 + n}`,
            system: 'WMS',
            title: `Transfer from ${c.facts.wmsBinLocation} to outbound staging`,
            status: c.stage === 'handed_off' ? 'acknowledged' : 'queued',
            due: addDays(c.dueDate, 2),
          },
        ]
      : [];

  return { signals, telemetry, components, evidence, workOrders, journeyStep: JOURNEY_STEP[c.stage] };
}

/* ------------------------------------------------------ route economics */

export interface RouteScenario {
  /** Refurbishment cost index (1 = published). */
  costMultiplier: number;
  /** Resale price index on market-priced recovery (1 = published). */
  marketMultiplier: number;
  /** Simulate no internal demand: internal routes are blocked. */
  noInternalDemand: boolean;
}

export const BASE_SCENARIO: RouteScenario = { costMultiplier: 1, marketMultiplier: 1, noInternalDemand: false };

export const INTERNAL_ROUTES: DispositionRouteId[] = ['redeploy', 'relase', 'intparts'];

export const isBaseScenario = (s: RouteScenario) => s.costMultiplier === 1 && s.marketMultiplier === 1 && !s.noInternalDemand;

/**
 * The Case page decision under a scenario, from the decision engine (decisionService.simulateCase):
 * the case is re-decided with the rest of the queue plan fixed. costMultiplier → refurbishment
 * cost index, marketMultiplier → resale price index, noInternalDemand → internal routes blocked.
 * With BASE_SCENARIO it equals decisionService.decide / nextBestAction.
 */
export function scenarioDecision(c: CaseRecord, scenario: RouteScenario): { decision: CaseDecision; action: NextBestAction } {
  if (isBaseScenario(scenario)) {
    const decision = simulateCase(c);
    const action = nextBestAction(c.id);
    if (action) return { decision, action };
  }
  const decision = simulateCase(c, {
    params: { refurbCostIndex: scenario.costMultiplier, resalePriceIndex: scenario.marketMultiplier },
    blocked: scenario.noInternalDemand ? INTERNAL_ROUTES : undefined,
  });
  const open = !['approved', 'handed_off'].includes(c.stage);
  return { decision, action: buildNextBestAction(c, decision, engineContext(), !open, null) };
}

/* ------------------------------------------------------- summaries */

export interface ReceivedSummary {
  total: number;
  totalValue: number;
  inTriage: number;
  awaitingApproval: number;
  awaitingValue: number;
  avgTriageDays: number;
}

export interface IntelligenceSummary {
  monitored: number;
  connectedShare: number;
  avgRecovery: number;
  harvestable: number;
  provenanceVerified: number;
}

/* ------------------------------------------------------- expected returns */

export type ExpectedStatus = 'in_transit' | 'scheduled' | 'customs_hold' | 'staged';

export interface ExpectedReturn {
  id: string;
  tenant: string;
  site: string;
  productClass: ProductClass;
  equipment: string;
  category: string;
  quantity: number;
  unitValue: number;
  estimatedValue: number;
  expectedDate: string;
  carrier: string;
  source: string;
  contractRef: string;
  status: ExpectedStatus;
  bay: string | null;
}

export interface ExpectedQuery {
  search?: string;
  site?: string;
  status?: ExpectedStatus | 'all';
  productClass?: string;
  tenant?: string;
  sortBy?: keyof ExpectedReturn;
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
}

export interface ExpectedSummary {
  asns: number;
  units: number;
  value: number;
  inTransitUnits: number;
  inTransitShipments: number;
  /** Shipments due within 7 days and how many of them have a bay. */
  dueSoon: number;
  dueSoonWithBay: number;
}

export const EXPECTED_STATUS_LABEL: Record<ExpectedStatus, string> = {
  in_transit: 'In transit',
  scheduled: 'Scheduled',
  customs_hold: 'Customs hold',
  staged: 'Staged',
};

const expectedStore = createCollection<ExpectedReturn>(expectedJson as ExpectedReturn[]);

const scopeExpected = (rows: ExpectedReturn[], scope: Scope) =>
  rows.filter((r) => (!scope.tenant || scope.tenant === 'All' || r.tenant === scope.tenant) && (!scope.site || r.site === scope.site));

const SITE_CODE: Record<string, string> = { 'Warehouse 1': 'W1', 'Warehouse 2': 'W2', 'Repair centre': 'RC' };

/* ------------------------------------------------------- service */

export const productService = {
  subscribe: caseService.subscribe,

  async receivedSummary(scope: Scope): Promise<ReceivedSummary> {
    const { items } = await caseService.list({}, scope);
    const asOf = Date.parse(caseService.meta().asOf);
    const triage = items.filter((c) => c.stage === 'awaiting_inspection' || c.stage === 'needs_information');
    const awaiting = items.filter((c) => c.stage === 'awaiting_approval');
    const ages = triage.map((c) => (asOf - Date.parse(`${c.receivedDate}T00:00:00Z`)) / 86_400_000);
    return {
      total: items.length,
      totalValue: sum(items.map((c) => c.estimatedNetRecovery)),
      inTriage: triage.length,
      awaitingApproval: awaiting.length,
      awaitingValue: sum(awaiting.map((c) => c.estimatedNetRecovery)),
      avgTriageDays: ages.length ? Math.round((sum(ages) / ages.length) * 10) / 10 : 0,
    };
  },

  async intelligenceSummary(scope: Scope): Promise<IntelligenceSummary> {
    const { items } = await caseService.list({}, scope);
    const signals = items.map(assetSignals);
    return {
      monitored: items.length,
      connectedShare: items.length ? signals.filter((s) => s.telemetry === 'active').length / items.length : 0,
      avgRecovery: items.length ? Math.round(sum(items.map((c) => c.estimatedNetRecovery)) / items.length) : 0,
      harvestable: sum(items.map((c) => assetDetail(c).components.filter((p) => p.harvestable).length)),
      provenanceVerified: items.length ? items.filter((c) => c.evidenceCompleteness >= 90).length / items.length : 0,
    };
  },

  /** Case plus the detail derived from it; undefined when the ID is unknown. */
  async asset(id: string): Promise<{ record: CaseRecord; detail: AssetDetail } | undefined> {
    const record = await caseService.get(id);
    return record ? { record, detail: assetDetail(record) } : undefined;
  },

  expected: {
    subscribe: expectedStore.subscribe,

    async list(q: ExpectedQuery = {}, scope: Scope = {}): Promise<Paged<ExpectedReturn>> {
      await delay();
      return queryList(scopeExpected(expectedStore.all(), scope), {
        search: q.search,
        searchFields: ['id', 'tenant', 'equipment', 'carrier', 'contractRef', 'category'],
        filters: { site: q.site, status: q.status, productClass: q.productClass, tenant: q.tenant === 'All' ? undefined : q.tenant },
        sortBy: q.sortBy ?? 'expectedDate',
        sortDir: q.sortDir ?? 'asc',
        page: q.page,
        pageSize: q.pageSize,
      });
    },

    async summary(scope: Scope = {}): Promise<ExpectedSummary> {
      await delay(200);
      const rows = scopeExpected(expectedStore.all(), scope);
      const soon = addDays(caseService.meta().asOf.slice(0, 10), 7);
      const transit = rows.filter((r) => r.status === 'in_transit');
      const dueSoon = rows.filter((r) => r.expectedDate <= soon);
      return {
        asns: rows.length,
        units: sum(rows.map((r) => r.quantity)),
        value: sum(rows.map((r) => r.estimatedValue)),
        inTransitUnits: sum(transit.map((r) => r.quantity)),
        inTransitShipments: transit.length,
        dueSoon: dueSoon.length,
        dueSoonWithBay: dueSoon.filter((r) => r.bay).length,
      };
    },

    /** Reserves the next free intake bay at the destination site. */
    async assignBay(id: string): Promise<ExpectedReturn> {
      await delay(300);
      const row = expectedStore.get(id);
      if (!row) throw new Error(`ASN ${id} not found`);
      if (row.bay) return row;
      const code = SITE_CODE[row.site] ?? 'XX';
      const used = new Set(expectedStore.all().filter((r) => r.site === row.site && r.bay).map((r) => r.bay));
      let n = 1;
      while (used.has(`${code}-Bay ${n}`)) n += 1;
      return expectedStore.update(id, { bay: `${code}-Bay ${n}` });
    },
  },
};
