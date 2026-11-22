/**
 * Expected returns from contracts: leases and service / refresh contracts ending soon, read from the
 * tenant's contract system of record (sources.json: SAP S/4HANA for Customer A, Oracle ERP Cloud
 * lease contracts for Customers B and C). These are planning signals, not shipments: nothing is
 * committed until the unit arrives and is inspected.
 *
 * The likely outcome (return / buyout / extension) is modelled from the contract terms and the
 * customer's past outcomes for the same product class:
 *   1. Base rates = past outcomes for this customer and class (returned / bought out / extended).
 *      No history → expiry = return (100 %).
 *   2. Contract terms: an outcome the contract does not allow (no buyout option, no extension
 *      option) is folded into return.
 *   3. Customer signal on file (return confirmed, extension requested, buyout quoted) moves the
 *      signalled outcome to a fixed confidence; the rest keeps its relative shares.
 * Data: src/data/contracts.json (dates relative to the app as-of, meta.asOf).
 */
import contractsJson from '@/data/contracts.json';
import sourcesJson from '@/data/sources.json';
import type { CaseRecord, Paged } from '@/models/domain.model';
import { meta } from './mock/stores';
import { createCollection, delay, queryList, sum, type SortDir } from './mock/mockUtils';

type Scope = { tenant?: string; site?: string };

export type ContractKind = 'lease' | 'refresh' | 'service';
export type CustomerSignal = 'none' | 'return_confirmed' | 'extension_requested' | 'buyout_quoted';
export type LikelyOutcome = 'return' | 'buyout' | 'extension';
export type ContractStatus = 'awaiting_return' | 'notice_sent' | 'ending_soon' | 'active';

export interface ContractRecord {
  id: string;
  tenant: string;
  kind: ContractKind;
  productClass: CaseRecord['productClass'];
  category: string;
  equipment: string;
  quantity: number;
  leaseStart: string;
  leaseEnd: string;
  termMonths: number;
  /** Customer location the units are collected from. */
  customerSite: string;
  /** Receiving site (warehouse / repair centre). */
  site: string;
  unitValueLow: number;
  unitValueHigh: number;
  buyoutOption: boolean;
  buyoutPrice: number | null;
  extensionOption: boolean;
  history: { contracts: number; returned: number; buyout: number; extended: number };
  customerSignal: CustomerSignal;
  sourceId: string;
  sourceRef: string;
}

export interface EstimateStep {
  label: string;
  detail: string;
  /** Shares after this step (0–1). */
  shares: Record<LikelyOutcome, number>;
}

export interface ContractRow extends ContractRecord {
  sourceName: string;
  sourceSyncedAt: string | null;
  daysToExpiry: number;
  status: ContractStatus;
  shares: Record<LikelyOutcome, number>;
  outcome: LikelyOutcome;
  /** Share of the most likely outcome (0–1). */
  outcomeShare: number;
  /** Probability the units come back (0–1). */
  returnShare: number;
  noHistory: boolean;
  windowStart: string;
  windowEnd: string;
  valueLow: number;
  valueHigh: number;
  weightedLow: number;
  weightedHigh: number;
  expectedUnits: number;
  steps: EstimateStep[];
}

export interface ContractQuery {
  search?: string;
  site?: string;
  /** Contracts ending within this many days (negative expiries, i.e. overdue, are always included). */
  withinDays?: number;
  outcome?: LikelyOutcome | 'all';
  sortBy?: keyof ContractRow;
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
}

export interface ContractSummary {
  /** Contracts ending in the next 90 days (plus expired, not yet returned). */
  ending90: number;
  /** Probability-weighted units expected back from those contracts. */
  expectedUnits: number;
  /** Probability-weighted value (midpoint of the range) of those contracts. */
  weightedValue: number;
  weightedLow: number;
  weightedHigh: number;
  total: number;
}

export const CONTRACT_KIND_LABEL: Record<ContractKind, string> = { lease: 'Lease ends', refresh: 'Refresh programme', service: 'Contract ends' };
export const OUTCOME_LABEL: Record<LikelyOutcome, string> = { return: 'Return', buyout: 'Buyout', extension: 'Extension' };
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  awaiting_return: 'Awaiting return',
  notice_sent: 'Notice sent',
  ending_soon: 'Ending soon',
  active: 'Active',
};
export const SIGNAL_LABEL: Record<CustomerSignal, string> = {
  none: 'No signal on file',
  return_confirmed: 'Customer confirmed the return',
  extension_requested: 'Customer requested an extension',
  buyout_quoted: 'Buyout quote sent to the customer',
};

const SIGNAL_TARGET: Record<Exclude<CustomerSignal, 'none'>, { outcome: LikelyOutcome; share: number }> = {
  return_confirmed: { outcome: 'return', share: 0.95 },
  extension_requested: { outcome: 'extension', share: 0.8 },
  buyout_quoted: { outcome: 'buyout', share: 0.6 },
};

type SourceRow = { id: string; name: string; lastSyncAt?: string };
const SOURCES = new Map((sourcesJson.sources as SourceRow[]).map((s) => [s.id, s]));

const DAY = 86_400_000;
const asOfDay = () => Date.parse(`${meta.asOf.slice(0, 10)}T00:00:00Z`);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const pctText = (v: number) => `${Math.round(v * 100)}%`;
const round10 = (v: number) => Math.round(v / 10) * 10;

function normalise(s: Record<LikelyOutcome, number>): Record<LikelyOutcome, number> {
  const t = s.return + s.buyout + s.extension || 1;
  return { return: s.return / t, buyout: s.buyout / t, extension: s.extension / t };
}

/** The outcome model, step by step (shown in the contract side panel). */
export function estimateOutcome(c: ContractRecord): { shares: Record<LikelyOutcome, number>; steps: EstimateStep[]; noHistory: boolean } {
  const steps: EstimateStep[] = [];
  const h = c.history;
  const noHistory = h.contracts === 0;
  let shares: Record<LikelyOutcome, number>;
  if (noHistory) {
    shares = { return: 1, buyout: 0, extension: 0 };
    steps.push({
      label: 'Past outcomes',
      detail: `No past ${c.category.toLowerCase()} contracts for ${c.tenant}, so expiry is treated as a return.`,
      shares,
    });
  } else {
    shares = normalise({ return: h.returned, buyout: h.buyout, extension: h.extended });
    steps.push({
      label: 'Past outcomes',
      detail: `${c.tenant} returned ${h.returned}, bought out ${h.buyout} and extended ${h.extended} of ${h.contracts} past ${c.category.toLowerCase()} contracts.`,
      shares,
    });
  }

  const folded: string[] = [];
  const next = { ...shares };
  if (!c.buyoutOption && next.buyout > 0) {
    next.return += next.buyout;
    next.buyout = 0;
    folded.push('no buyout option');
  }
  if (!c.extensionOption && next.extension > 0) {
    next.return += next.extension;
    next.extension = 0;
    folded.push('no extension option');
  }
  if (folded.length) {
    shares = normalise(next);
    steps.push({ label: 'Contract terms', detail: `The contract has ${folded.join(' and ')}; that share is counted as a return.`, shares });
  } else if (!noHistory) {
    const terms = [c.buyoutOption && c.buyoutPrice ? `buyout at ${moneyText(c.buyoutPrice)} per unit` : null, c.extensionOption ? 'extension allowed' : null].filter(Boolean);
    steps.push({ label: 'Contract terms', detail: terms.length ? `Terms allow ${terms.join(' and ')}; shares unchanged.` : 'Terms do not change the shares.', shares });
  }

  if (c.customerSignal !== 'none') {
    const t = SIGNAL_TARGET[c.customerSignal];
    const rest = 1 - shares[t.outcome];
    const scaled: Record<LikelyOutcome, number> = { return: 0, buyout: 0, extension: 0 };
    (Object.keys(shares) as LikelyOutcome[]).forEach((k) => {
      scaled[k] = k === t.outcome ? t.share : rest > 0 ? (shares[k] / rest) * (1 - t.share) : 0;
    });
    // Outcomes the contract does not allow stay at zero.
    if (!c.buyoutOption) scaled.buyout = 0;
    if (!c.extensionOption) scaled.extension = 0;
    shares = normalise(scaled);
    steps.push({ label: 'Customer signal', detail: `${SIGNAL_LABEL[c.customerSignal]}: ${OUTCOME_LABEL[t.outcome].toLowerCase()} set to ${pctText(shares[t.outcome])}.`, shares });
  }
  return { shares, steps, noHistory };
}

function moneyText(n: number) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function statusOf(days: number, c: ContractRecord): ContractStatus {
  if (days < 0) return 'awaiting_return';
  if (days <= 30 || c.customerSignal === 'return_confirmed') return days <= 90 ? 'notice_sent' : 'active';
  if (days <= 90) return 'ending_soon';
  return 'active';
}

function toRow(c: ContractRecord): ContractRow {
  const { shares, steps, noHistory } = estimateOutcome(c);
  const outcome = (Object.keys(shares) as LikelyOutcome[]).reduce((a, b) => (shares[b] > shares[a] ? b : a), 'return');
  const daysToExpiry = Math.round((Date.parse(`${c.leaseEnd}T00:00:00Z`) - asOfDay()) / DAY);
  const valueLow = c.quantity * c.unitValueLow;
  const valueHigh = c.quantity * c.unitValueHigh;
  const src = SOURCES.get(c.sourceId);
  return {
    ...c,
    sourceName: src?.name ?? c.sourceId,
    sourceSyncedAt: src?.lastSyncAt ?? null,
    daysToExpiry,
    status: statusOf(daysToExpiry, c),
    shares,
    outcome,
    outcomeShare: shares[outcome],
    returnShare: shares.return,
    noHistory,
    // Collection window: the day before expiry to two weeks after.
    windowStart: addDays(c.leaseEnd, -1),
    windowEnd: addDays(c.leaseEnd, 13),
    valueLow,
    valueHigh,
    weightedLow: round10(valueLow * shares.return),
    weightedHigh: round10(valueHigh * shares.return),
    expectedUnits: Math.round(c.quantity * shares.return * 10) / 10,
    steps,
  };
}

const store = createCollection<ContractRecord>(contractsJson as ContractRecord[]);

const scoped = (scope: Scope) =>
  store
    .all()
    .filter((c) => (!scope.tenant || scope.tenant === 'All' || c.tenant === scope.tenant) && (!scope.site || c.site === scope.site))
    .map(toRow);

export const contractService = {
  subscribe: store.subscribe,

  async list(q: ContractQuery = {}, scope: Scope = {}): Promise<Paged<ContractRow>> {
    await delay();
    const within = q.withinDays;
    const rows = scoped(scope).filter((r) => within === undefined || r.daysToExpiry <= within);
    return queryList(rows, {
      search: q.search,
      searchFields: ['id', 'tenant', 'equipment', 'category', 'sourceRef', 'customerSite'],
      filters: { site: q.site, outcome: q.outcome },
      sortBy: q.sortBy ?? 'leaseEnd',
      sortDir: q.sortDir ?? 'asc',
      page: q.page,
      pageSize: q.pageSize,
    });
  },

  async get(id: string): Promise<ContractRow | undefined> {
    await delay(120);
    const c = store.get(id);
    return c ? toRow(c) : undefined;
  },

  async summary(scope: Scope = {}): Promise<ContractSummary> {
    await delay(200);
    const rows = scoped(scope);
    const soon = rows.filter((r) => r.daysToExpiry <= 90);
    const wLow = sum(soon.map((r) => r.weightedLow));
    const wHigh = sum(soon.map((r) => r.weightedHigh));
    return {
      ending90: soon.length,
      expectedUnits: Math.round(sum(soon.map((r) => r.quantity * r.returnShare))),
      weightedValue: round10((wLow + wHigh) / 2),
      weightedLow: wLow,
      weightedHigh: wHigh,
      total: rows.length,
    };
  },
};
