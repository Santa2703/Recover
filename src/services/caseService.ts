import type { CaseRecord, CaseStageId, Paged } from '@/models/domain.model';
import type { DispositionRouteId } from '@/models/treatment.model';
import { caseStore, meta } from './mock/stores';
import { delay, queryList, type ListQuery, type SortDir } from './mock/mockUtils';

export interface CaseQuery {
  search?: string;
  tenant?: string;
  location?: string;
  stage?: CaseStageId | 'all';
  route?: DispositionRouteId | 'all';
  productClass?: string;
  priority?: string;
  sortBy?: keyof CaseRecord;
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
}

/*
 * Cases come from the decision-engine view of the store: for open cases `recommendedRoute`,
 * `estimatedNetRecovery`, `valueAtRisk` and `demandIds` are the queue plan's decision
 * (decisionService). `approve` freezes that decision on the record and holds its demand.
 */

/** Applies the role / tenant scope used everywhere (Planner sees own tenant, Warehouse Manager own site). */
export function scopeCases(cases: CaseRecord[], scope: { tenant?: string; site?: string }): CaseRecord[] {
  return cases.filter(
    (c) => (!scope.tenant || scope.tenant === 'All' || c.tenant === scope.tenant) && (!scope.site || c.location === scope.site),
  );
}

export const caseService = {
  subscribe: caseStore.subscribe,

  async list(q: CaseQuery = {}, scope: { tenant?: string; site?: string } = {}): Promise<Paged<CaseRecord>> {
    await delay();
    const query: ListQuery<CaseRecord> = {
      search: q.search,
      searchFields: ['id', 'productName', 'assetTag', 'serialNumber', 'category', 'owner'],
      filters: { tenant: q.tenant === 'All' ? undefined : q.tenant, location: q.location, stage: q.stage, recommendedRoute: q.route, productClass: q.productClass, priority: q.priority },
      sortBy: q.sortBy ?? 'dueInDays',
      sortDir: q.sortDir ?? 'asc',
      page: q.page,
      pageSize: q.pageSize,
    };
    return queryList(scopeCases(caseStore.all(), scope), query);
  },

  async get(id: string): Promise<CaseRecord | undefined> {
    await delay(160);
    return caseStore.get(id);
  },

  /** Synchronous lookup for labels inside already-loaded views (no delay). */
  peek(id: string): CaseRecord | undefined {
    return caseStore.get(id);
  },

  async updateStage(id: string, stage: CaseStageId): Promise<CaseRecord> {
    await delay(300);
    return caseStore.update(id, { stage, blockedReason: null });
  },

  /** Optional note is stored on the case as `decisionNote`. */
  async approve(id: string, note?: string): Promise<CaseRecord> {
    await delay(350);
    return caseStore.update(id, { stage: 'approved', riskReason: null, valueAtRisk: 0, ...(note?.trim() ? { decisionNote: note.trim() } : {}) });
  },

  async decline(id: string, note?: string): Promise<CaseRecord> {
    await delay(350);
    return caseStore.update(id, { stage: 'reevaluate', ...(note?.trim() ? { decisionNote: note.trim() } : {}) });
  },

  async requestEvidence(id: string): Promise<CaseRecord> {
    await delay(300);
    return caseStore.update(id, { stage: 'needs_information' });
  },

  meta: () => meta,
};
