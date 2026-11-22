/**
 * Intake: receiving shipping notices (ASNs) into returned-asset cases, and the receiving plan.
 *
 * `receive` posts the goods receipt for an ASN: it builds one case per unit (one per lot for
 * tool-fleet batches) in stage "Awaiting inspection", inserts them into the case store (the
 * decision engine decorates them like any other open case), queues an inspection task per case,
 * writes the receipt to the audit log and closes the ASN.
 *
 * `plan` is the receiving plan: expected units per site and week for the next 6 weeks, from open
 * ASNs plus probability-weighted contract returns, against weekly receiving capacity. A draft:
 * nothing in it is booked.
 */
import type { CaseRecord, CapacityRecord, TaskRecord } from '@/models/domain.model';
import type { CaseContext, IntakeChannel } from '@/models/decision.model';
import { capacity, caseStore, meta, taskStore, userStore } from './mock/stores';
import { delay } from './mock/mockUtils';
import { decisionState, registerContext } from './decision/runtime';
import { SITE_CODE, productService, type ExpectedReturn } from './productService';
import { contractService } from './contractService';
import { auditService } from './auditService';

type Scope = { tenant?: string; site?: string };

export interface GoodsReceipt {
  /** Receipt date, yyyy-mm-dd. */
  date: string;
  bay: string;
  receivedBy: string;
}

export interface ReceiptPreview {
  asn: ExpectedReturn;
  /** Case ids that receiving will create, in order. */
  caseIds: string[];
  /** Units per case (1, or the lot size for tool-fleet batches). */
  unitsPerCase: number;
  defaultBay: string;
  evidenceReceived: string[];
  evidenceMissing: string[];
}

export interface ReceiptResult {
  asnId: string;
  receiptRef: string;
  cases: CaseRecord[];
}

const ASOF_DATE = meta.asOf.slice(0, 10);
const DAY = 86_400_000;
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const round10 = (v: number) => Math.round(v / 10) * 10;
const caseNo = (id: string) => Number(id.replace(/\D/g, '')) || 0;

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Evidence on file at receipt (assetDetail: the first 3 of 6 items at 50% completeness). */
export const RECEIPT_EVIDENCE = { received: ['Service history', 'Acquisition record', 'Goods receipt and bin'], missing: ['Inspection photos', 'Functional test report', 'Hazardous materials check'] };

const ASSET_PREFIX: Record<CaseRecord['productClass'], string> = { motor: 'MTR', pump: 'PMP', control: 'CTL', drill: 'DRL', it: 'ITD', batch: 'LOT' };
const CHANNEL: Record<string, IntakeChannel> = { 'End-of-lease': 'lease_end', 'Field swap': 'field_return', 'Warranty return': 'field_return', 'Fleet refresh': 'excess' };

/** Next RT- numbers, skipping ids already in the case store or waiting in the decision inbox. */
function nextCaseIds(count: number): string[] {
  const used = [...caseStore.all().map((c) => c.id), ...decisionState.inbox.map((i) => i.case.id)];
  const max = Math.max(1128, ...used.map(caseNo));
  return Array.from({ length: count }, (_, i) => `RT-${max + 1 + i}`);
}

/** One case per unit; tool-fleet batches arrive as lots, one case per lot. */
const casesFor = (asn: ExpectedReturn) => asn.quantity;
const unitsPerCase = (asn: ExpectedReturn) => (asn.productClass === 'batch' ? Number(/lot (\d+)/i.exec(asn.equipment)?.[1]) || 1 : 1);

/** Manufacturer and model from a matching case, else split from the equipment name. */
function makeAndModel(equipment: string): { manufacturer: string; model: string } {
  const known = caseStore.all().find((c) => c.productName === equipment);
  if (known) return { manufacturer: known.manufacturer, model: known.model };
  const i = equipment.lastIndexOf(' ');
  return i > 0 ? { manufacturer: equipment.slice(0, i), model: equipment.slice(i + 1) } : { manufacturer: equipment, model: equipment };
}

function median(values: number[], fallback: number): number {
  if (!values.length) return fallback;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** A valid CaseRecord for unit `index` of an ASN received on `receipt.date`. */
export function buildCase(asn: ExpectedReturn, id: string, index: number, receipt: GoodsReceipt): CaseRecord {
  const h = hashOf(`${asn.id}:${index}`);
  const { manufacturer, model } = makeAndModel(asn.equipment);
  // Provisional grade until inspection: lease ends and refreshes come back in better shape.
  const condition: CaseRecord['condition'] = asn.source === 'End-of-lease' || asn.source === 'Fleet refresh' ? 'B' : 'C';
  const peers = caseStore.all().filter((c) => c.productClass === asn.productClass);
  const resale = round10(asn.unitValue);
  const refurb = round10(asn.unitValue * (condition === 'B' ? 0.18 : 0.3));
  const owner = userStore.all().find((u) => u.role === 'Planner' && u.tenant === asn.tenant) ?? userStore.all()[0];
  const due = addDays(receipt.date, 14);
  const bayNo = Number(/(\d+)\s*$/.exec(receipt.bay)?.[1]) || 1;
  const ageYears = asn.source === 'End-of-lease' ? 3 + (h % 10) / 10 : asn.source === 'Fleet refresh' ? 4 + (h % 10) / 10 : 2 + (h % 10) / 10;
  return {
    id,
    assetTag: `${ASSET_PREFIX[asn.productClass]}-${String(10000 + (h % 89999)).padStart(5, '0')}`,
    serialNumber: `${manufacturer.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()}${String(100000 + (h % 899999))}`,
    productClass: asn.productClass,
    productName: asn.equipment,
    category: peers[0]?.category ?? asn.category,
    manufacturer,
    model,
    quantity: unitsPerCase(asn),
    location: asn.site,
    tenant: asn.tenant,
    owner: owner.name,
    ownerId: owner.id,
    receivedDate: receipt.date,
    dueDate: due,
    dueInDays: daysBetween(ASOF_DATE, due),
    condition,
    residualLifeMonths: condition === 'B' ? 36 : 18,
    stage: 'awaiting_inspection',
    recommendedRoute: 'resale',
    estimatedNetRecovery: resale - refurb,
    predictedResale: resale,
    refurbishmentCost: refurb,
    valueAtRisk: 0,
    riskReason: null,
    carbonAvoidedKg: median(
      peers.map((c) => c.carbonAvoidedKg),
      0,
    ),
    priority: 'medium',
    evidenceCompleteness: 50,
    blockedReason: 'Condition grade missing: inspection not yet recorded',
    facts: {
      originalPrice: round10(asn.unitValue * 2.2),
      ageYears: Math.round(ageYears * 10) / 10,
      lastServiceDate: addDays(receipt.date, -(120 + (h % 240))),
      warrantyStatus: asn.source === 'Warranty return' ? 'active' : 'expired',
      wmsBinLocation: `${SITE_CODE[asn.site] ?? 'XX'}-B${String(bayNo).padStart(2, '0')}-${index + 1}`,
    },
    predictions: {
      secondaryMarketPrice: resale,
      refurbishmentCost: refurb,
      resaleDemandScore: median(
        peers.map((c) => c.predictions.resaleDemandScore),
        0.6,
      ),
      failureRiskScore: condition === 'B' ? 0.3 : 0.45,
    },
  };
}

/* ------------------------------------------------------- receiving plan */

export interface PlanWeek {
  /** Monday, yyyy-mm-dd. */
  start: string;
  label: string;
}

export interface PlanCell {
  /** Units from shipping notices due that week. */
  asnUnits: number;
  /** Probability-weighted units from contracts whose return window opens that week. */
  contractUnits: number;
  /** asnUnits + contractUnits, rounded. */
  units: number;
  capacity: number;
  over: boolean;
}

export interface PlanRow {
  site: string;
  capacityLabel: string;
  capacityUnit: string;
  cells: PlanCell[];
  total: number;
  overWeeks: number;
}

export interface ReceivingPlan {
  weeks: PlanWeek[];
  rows: PlanRow[];
  overCells: number;
  asnCount: number;
  contractCount: number;
}

const PLAN_WEEKS = 6;

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

/** Weekly receiving capacity per site: inspection bays at the warehouses, repair benches at the repair centre. */
function capacityFor(site: string): CapacityRecord | undefined {
  const rows = capacity.filter((c) => c.site === site && /week/i.test(c.unit));
  return rows.find((c) => c.id.startsWith('cap-insp')) ?? rows[0];
}

/* ------------------------------------------------------- service */

export const intakeService = {
  /** What receiving an ASN will create. */
  preview(asnId: string): ReceiptPreview | undefined {
    const asn = productService.expected.get(asnId);
    if (!asn) return undefined;
    return {
      asn,
      caseIds: nextCaseIds(casesFor(asn)),
      unitsPerCase: unitsPerCase(asn),
      defaultBay: asn.bay ?? productService.expected.nextFreeBay(asn.site),
      evidenceReceived: RECEIPT_EVIDENCE.received,
      evidenceMissing: RECEIPT_EVIDENCE.missing,
    };
  },

  /**
   * Posts the goods receipt for an ASN: creates the returned-asset cases (awaiting inspection),
   * queues inspection tasks, audits the receipt and closes the ASN.
   */
  async receive(asnId: string, receipt: GoodsReceipt, actor: { id: string; name: string; role: string }): Promise<ReceiptResult> {
    await delay(400);
    const asn = productService.expected.get(asnId);
    if (!asn) throw new Error(`${asnId} is no longer open: it may have been received already`);
    if (!receipt.date) throw new Error('Enter the receipt date');
    if (!receipt.bay.trim()) throw new Error('Enter the receiving bay');
    if (!receipt.receivedBy.trim()) throw new Error('Enter who received the goods');
    const ids = nextCaseIds(casesFor(asn));
    const receiptRef = `GR-${SITE_CODE[asn.site] ?? 'XX'}-${asnId.replace(/\D/g, '').slice(-3)}${ids.length}`;
    const created: CaseRecord[] = [];
    const maxTask = Math.max(0, ...taskStore.all().map((t) => Number(t.id.replace(/\D/g, '')) || 0));
    ids.forEach((id, i) => {
      const record = buildCase(asn, id, i, { ...receipt, bay: receipt.bay.trim(), receivedBy: receipt.receivedBy.trim() });
      const ctx: CaseContext = {
        intakeChannel: CHANNEL[asn.source] ?? 'field_return',
        lifePct: record.condition === 'B' ? 70 : 52,
        parts: [],
      };
      registerContext(id, ctx);
      created.push(caseStore.insert(record));
      const task: TaskRecord = {
        id: `TSK-${String(maxTask + 1 + i).padStart(4, '0')}`,
        type: 'inspect',
        title: `Inspect and grade ${record.productName}`,
        caseId: id,
        assigneeId: 'u-engineer',
        role: 'Engineer',
        dueDate: addDays(receipt.date, 3),
        priority: 'medium',
        status: 'todo',
      };
      taskStore.insert(task);
    });
    productService.expected.markReceived(asnId);
    auditService.record({
      caseId: ids[0] ?? null,
      tenant: asn.tenant,
      entity: `ASN · ${asn.id}`,
      action: `Goods receipt posted: ${ids.length} ${ids.length === 1 ? 'case' : 'cases'} created`,
      actionType: 'write',
      actorType: 'user',
      actorId: actor.id,
      actorName: `${actor.name} (${actor.role})`,
      source: 'WMS',
      sourceRef: receiptRef,
      payloadSummary: `${asn.quantity} × ${asn.equipment} received ${receipt.date} at ${asn.site} ${receipt.bay} by ${receipt.receivedBy}; cases ${ids[0]}${ids.length > 1 ? `–${ids[ids.length - 1]}` : ''} awaiting inspection`,
      journeyStep: 1,
    });
    return { asnId, receiptRef, cases: created };
  },

  /** Receiving plan for the next 6 weeks in scope (a draft: nothing is booked). */
  async plan(scope: Scope = {}): Promise<ReceivingPlan> {
    await delay(250);
    const firstWeek = mondayOf(ASOF_DATE);
    const weeks: PlanWeek[] = Array.from({ length: PLAN_WEEKS }, (_, i) => {
      const start = addDays(firstWeek, i * 7);
      return { start, label: new Date(`${start}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) };
    });
    const lastDay = addDays(firstWeek, PLAN_WEEKS * 7 - 1);
    // Overdue arrivals and windows already open land in the current week.
    const weekIndex = (iso: string) => {
      const d = iso < ASOF_DATE ? ASOF_DATE : iso;
      if (d > lastDay) return -1;
      return Math.floor(daysBetween(firstWeek, d) / 7);
    };

    const asns = productService.expected.allInScope(scope);
    const { items: contracts } = await contractService.list({}, scope);
    const upcoming = contracts.filter((c) => c.returnShare > 0 && weekIndex(c.windowStart) >= 0);

    const sites = meta.sites.filter((s) => !scope.site || s === scope.site);
    const rows: PlanRow[] = sites.map((site) => {
      const cap = capacityFor(site);
      const cells: PlanCell[] = weeks.map(() => ({ asnUnits: 0, contractUnits: 0, units: 0, capacity: cap?.capacity ?? 0, over: false }));
      asns
        .filter((a) => a.site === site)
        .forEach((a) => {
          const w = weekIndex(a.expectedDate);
          if (w >= 0) cells[w].asnUnits += a.quantity;
        });
      upcoming
        .filter((c) => c.site === site)
        .forEach((c) => {
          cells[weekIndex(c.windowStart)].contractUnits += c.quantity * c.returnShare;
        });
      cells.forEach((c) => {
        c.contractUnits = Math.round(c.contractUnits * 10) / 10;
        c.units = Math.round(c.asnUnits + c.contractUnits);
        c.over = c.capacity > 0 && c.units > c.capacity;
      });
      return {
        site,
        capacityLabel: cap?.label ?? 'No capacity on file',
        capacityUnit: cap?.unit ?? '',
        cells,
        total: cells.reduce((s, c) => s + c.units, 0),
        overWeeks: cells.filter((c) => c.over).length,
      };
    });
    return {
      weeks,
      rows,
      overCells: rows.reduce((s, r) => s + r.overWeeks, 0),
      asnCount: asns.filter((a) => weekIndex(a.expectedDate) >= 0).length,
      contractCount: upcoming.length,
    };
  },

  /** Re-run the plan when shipping notices or contracts change. */
  subscribePlan(listener: () => void): () => void {
    const a = productService.expected.subscribe(listener);
    const b = contractService.subscribe(listener);
    return () => {
      a();
      b();
    };
  },
};
