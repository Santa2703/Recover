import type { CaseRecord, Paged, TaskRecord, TaskStatus } from '@/models/domain.model';
import type { UserRole } from '@/models/user.model';
import { caseStore, meta, taskStore } from './mock/stores';
import { delay, queryList } from './mock/mockUtils';

export const TASK_TYPE_LABEL: Record<TaskRecord['type'], string> = {
  request_evidence: 'Request evidence',
  inspect: 'Inspect & grade',
  approve: 'Approve decision',
  prepare_decision: 'Prepare decision',
  confirm_outcome: 'Confirm outcome',
  acknowledge: 'Acknowledge hand-off',
  escalation: 'Escalation',
};

export interface TaskRow extends TaskRecord {
  case?: CaseRecord;
  dueInDays: number;
}

const dueIn = (iso: string) => Math.round((new Date(iso).getTime() - new Date(meta.asOf.slice(0, 10)).getTime()) / 864e5);
const toRow = (t: TaskRecord): TaskRow => ({ ...t, case: caseStore.get(t.caseId), dueInDays: dueIn(t.dueDate) });

/** Admin sees every task; other roles see tasks for their role (and tenant for Planners). */
function forRole(role: UserRole, tenant?: string) {
  return (t: TaskRecord) => {
    if (role === 'Admin') return true;
    // Executives see only what is escalated to them (sign-off above the approver's limit).
    if (role === 'Executive') return t.role === 'Executive';
    if (t.role !== role) return false;
    if (role === 'Planner' && tenant && tenant !== 'All') {
      // Tasks not about a case (e.g. an escalated source) are not tenant-scoped.
      const c = t.caseId ? caseStore.get(t.caseId) : undefined;
      return t.caseId ? c?.tenant === tenant : true;
    }
    return true;
  };
}

export const taskService = {
  subscribe: taskStore.subscribe,

  async list(q: { role: UserRole; tenant?: string; status?: TaskStatus | 'open' | 'all'; search?: string; page?: number; pageSize?: number }): Promise<Paged<TaskRow>> {
    await delay();
    const rows = taskStore.all().filter(forRole(q.role, q.tenant)).map(toRow);
    return queryList(rows, {
      search: q.search,
      searchFields: ['title', 'caseId', (r) => r.case?.productName ?? r.subject ?? ''],
      filters: { status: q.status === 'open' || q.status === 'all' ? undefined : q.status },
      predicate: q.status === 'open' ? (r) => r.status !== 'done' : undefined,
      sortBy: 'dueInDays',
      sortDir: 'asc',
      page: q.page,
      pageSize: q.pageSize,
    });
  },

  async setStatus(id: string, status: TaskStatus): Promise<TaskRecord> {
    await delay(250);
    return taskStore.update(id, { status });
  },

  openCount(role: UserRole, tenant?: string): number {
    return taskStore.all().filter(forRole(role, tenant)).filter((t) => t.status !== 'done').length;
  },

  /** Open escalation tasks for the role (escalations sent from Alerts). */
  openEscalations(role: UserRole, tenant?: string): number {
    return taskStore.all().filter(forRole(role, tenant)).filter((t) => t.type === 'escalation' && t.status !== 'done').length;
  },
};
