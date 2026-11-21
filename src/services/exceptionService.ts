import type { CaseRecord, ExceptionRecord, ExceptionStatus, ExceptionType, Paged, Severity } from '@/models/domain.model';
import { caseStore, exceptionStore, meta, userStore } from './mock/stores';
import { delay, queryList, sum, type SortDir } from './mock/mockUtils';

export const EXCEPTION_TYPE_LABEL: Record<ExceptionType, string> = {
  missing_evidence: 'Missing evidence',
  condition_deterioration: 'Condition deterioration',
  delayed_approval: 'Delayed approval',
  market_price_decline: 'Market price decline',
  capacity_constraint: 'Capacity constraint',
  no_viable_route: 'No viable route',
  integration_failure: 'Integration failure',
  data_quality: 'Data quality',
};

export interface ExceptionQuery {
  search?: string;
  warehouse?: string;
  type?: ExceptionType | 'all';
  status?: ExceptionStatus | 'all' | 'unresolved';
  severity?: Severity | 'all';
  ownerId?: string;
  /** Tenant/site scope (same meaning as metricsService Scope). */
  scope?: ExceptionScope;
  sortBy?: 'valueAtRisk' | 'openedAt' | 'itemsCount' | 'severity';
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
}

export interface ExceptionRow extends ExceptionRecord {
  ownerName: string;
  ageDays: number;
  topCase?: CaseRecord;
}

export interface ExceptionSummary {
  open: number;
  valueAtRisk: number;
  warehousesImpacted: number;
  warehousesTotal: number;
  avgAgeDays: number;
  byWarehouse: { warehouse: string; count: number; value: number }[];
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const ageDays = (iso: string) => Math.max(0, Math.round((new Date(meta.asOf).getTime() - new Date(iso).getTime()) / 864e5));

export interface ExceptionScope {
  tenant?: string;
  site?: string;
}

const inScope = (c: CaseRecord | undefined, s: ExceptionScope) =>
  !!c && (!s.tenant || s.tenant === 'All' || c.tenant === s.tenant) && (!s.site || c.location === s.site);

/**
 * Exceptions group cases across tenants. A scoped view keeps only the in-scope cases and recomputes
 * value at risk from them, so totals match Key Figures (metricsService) for the same tenant/site.
 * Returns null when no case of the exception is in scope.
 */
function scopeException(e: ExceptionRecord, s?: ExceptionScope): ExceptionRecord | null {
  const all = !s || ((!s.tenant || s.tenant === 'All') && !s.site);
  const cases = e.caseIds.map((id) => caseStore.get(id)).filter((c): c is CaseRecord => (all ? !!c : inScope(c, s)));
  // Unscoped, value at risk is still recomputed from the live cases (the decision engine sets case values).
  if (all) return cases.length ? { ...e, valueAtRisk: e.valueAtRisk ? sum(cases.map((c) => c.valueAtRisk)) : 0 } : e;
  if (!cases.length) return null;
  const top = [...cases].sort((a, b) => b.valueAtRisk - a.valueAtRisk)[0];
  return {
    ...e,
    caseIds: cases.map((c) => c.id),
    itemsCount: cases.length,
    topCaseId: top.id,
    valueAtRisk: e.valueAtRisk ? sum(cases.map((c) => c.valueAtRisk)) : 0,
  };
}

const scoped = (s?: ExceptionScope) =>
  exceptionStore
    .all()
    .map((e) => scopeException(e, s))
    .filter((e): e is ExceptionRecord => !!e);

const toRow = (e: ExceptionRecord): ExceptionRow => ({
  ...e,
  ownerName: userStore.get(e.ownerId)?.name ?? 'Unassigned',
  ageDays: ageDays(e.openedAt),
  topCase: caseStore.get(e.topCaseId),
});

export const exceptionService = {
  subscribe: exceptionStore.subscribe,

  async list(q: ExceptionQuery = {}): Promise<Paged<ExceptionRow>> {
    await delay();
    const rows = scoped(q.scope).map(toRow);
    return queryList(rows, {
      search: q.search,
      searchFields: ['title', 'id', 'warehouse', 'ownerName', (r) => r.caseIds.join(' '), (r) => r.topCase?.productName ?? ''],
      filters: {
        warehouse: q.warehouse === 'all' ? undefined : q.warehouse,
        type: q.type,
        severity: q.severity,
        ownerId: q.ownerId,
        status: q.status === 'unresolved' ? undefined : q.status,
      },
      predicate: q.status === 'unresolved' ? (r) => r.status !== 'resolved' : undefined,
      sortBy: q.sortBy === 'severity' ? (r) => SEVERITY_RANK[r.severity] * 1e9 + r.valueAtRisk : q.sortBy ?? 'valueAtRisk',
      sortDir: q.sortDir ?? 'desc',
      page: q.page,
      pageSize: q.pageSize,
    });
  },

  async summary(scope?: ExceptionScope): Promise<ExceptionSummary> {
    await delay(180);
    const open = scoped(scope).filter((e) => e.status !== 'resolved');
    const byWarehouse = meta.sites.map((w) => {
      const list = open.filter((e) => e.warehouse === w);
      return { warehouse: w, count: list.length, value: sum(list.map((e) => e.valueAtRisk)) };
    });
    return {
      open: open.length,
      valueAtRisk: sum(open.map((e) => e.valueAtRisk)),
      warehousesImpacted: byWarehouse.filter((w) => w.count > 0).length,
      warehousesTotal: meta.sites.length,
      avgAgeDays: open.length ? +(sum(open.map((e) => ageDays(e.openedAt))) / open.length).toFixed(1) : 0,
      byWarehouse,
    };
  },

  /** Cases behind an exception; with a scope, only the cases in that tenant/site. */
  async affectedItems(id: string, scope?: ExceptionScope): Promise<CaseRecord[]> {
    await delay(200);
    const e = exceptionStore.get(id);
    const cases = e ? e.caseIds.map((cid) => caseStore.get(cid)).filter((c): c is CaseRecord => !!c) : [];
    return scope ? cases.filter((c) => inScope(c, scope)) : cases;
  },

  async notifyOwner(id: string): Promise<ExceptionRecord> {
    await delay(300);
    return exceptionStore.update(id, (e) => ({ status: e.status === 'open' ? 'notified' : e.status, lastNotifiedAt: meta.asOf }));
  },

  async assign(id: string, ownerId: string): Promise<ExceptionRecord> {
    await delay(300);
    return exceptionStore.update(id, { ownerId, status: 'assigned' });
  },

  async resolve(id: string, note: string): Promise<ExceptionRecord> {
    await delay(350);
    return exceptionStore.update(id, { status: 'resolved', resolvedAt: meta.asOf, resolutionNote: note });
  },

  async reopen(id: string): Promise<ExceptionRecord> {
    await delay(250);
    return exceptionStore.update(id, { status: 'open', resolvedAt: null, resolutionNote: undefined });
  },

  /** Unresolved count, used by navigation badges. */
  openCount: () => exceptionStore.all().filter((e) => e.status !== 'resolved').length,
};
