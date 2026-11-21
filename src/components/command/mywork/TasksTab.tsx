'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarClock, CheckCircle, ShieldAlert, UserCheck } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { TASK_TYPE_LABEL, taskService, type TaskRow } from '@/services/taskService';
import type { Priority } from '@/models/domain.model';
import { DataTable, ErrorState, KpiSkeletonRow, MetricCard, type DataColumn } from '@/components/ui';
import { CommandFilters, CommandSelect, SectionCard } from '@/components/command/CommandUi';
import { downloadCsv, fmtMoney, fmtUsd } from '@/components/command/commandUtils';
import { rememberQueue } from '@/components/product/queueContext';
import { myWorkHref } from './myWorkTabs';
import { TabToolbar } from './TabToolbar';

type Sla = 'overdue' | 'due_today' | 'on_track';
const slaOf = (r: TaskRow): Sla => (r.dueInDays < 0 ? 'overdue' : r.dueInDays === 0 ? 'due_today' : 'on_track');

const PRIORITY_BADGE: Record<Priority, string> = {
  high: 'bg-rose-50 text-rose-800 border-rose-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  low: 'bg-slate-50 text-slate-800 border-slate-200',
};
const SLA_BADGE: Record<Sla, string> = {
  overdue: 'bg-rose-100 text-rose-900 border-rose-300',
  due_today: 'bg-amber-100 text-amber-900 border-amber-300',
  on_track: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};
const SLA_LABEL: Record<Sla, string> = { overdue: 'Overdue', due_today: 'Due today', on_track: 'On track' };

/** Task title without the case ID (it has its own column): "Approve exit for RT-1028" → "Approve exit". */
const actionText = (r: TaskRow) => r.title.replace(new RegExp(`\\s*(for\\s+)?${r.caseId}\\b`, 'i'), '').trim() || r.title;

/** My work › Tasks: open tasks assigned to the current role. */
export function TasksTab() {
  const router = useRouter();
  const { currentRole, currentTenant } = useAuth();
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const [sla, setSla] = useState<Sla | 'all'>('all');
  const [page, setPage] = useState(1);

  const q = useServiceQuery(() => taskService.list({ role: currentRole, tenant: currentTenant, status: 'open', search }), [currentRole, currentTenant, search], {
    subscribe: taskService.subscribe,
  });

  const rows = useMemo(
    () => (q.data?.items ?? []).filter((r) => (priority === 'all' || r.priority === priority) && (sla === 'all' || slaOf(r) === sla)),
    [q.data, priority, sla],
  );

  // The Case page offers Back to My work and Previous / Next over the tasks shown (in this order).
  const fromQueue = () => rememberQueue('My work', myWorkHref('tasks'), rows.map((r) => r.caseId));

  const kpis = useMemo(
    () => ({
      high: rows.filter((r) => r.priority === 'high').length,
      overdue: rows.filter((r) => slaOf(r) === 'overdue').length,
      dueToday: rows.filter((r) => slaOf(r) === 'due_today').length,
      risk: rows.reduce((s, r) => s + (r.case?.valueAtRisk ?? 0), 0),
      week: rows.filter((r) => r.dueInDays >= 0 && r.dueInDays <= 7).length,
    }),
    [rows],
  );

  const filtered = !!search || priority !== 'all' || sla !== 'all';
  const clear = () => {
    setSearch('');
    setPriority('all');
    setSla('all');
    setPage(1);
  };

  const exportCsv = () =>
    downloadCsv(
      'actions-on-me.csv',
      ['Task ID', 'Case ID', 'Equipment', 'Required action', 'Type', 'Priority', 'SLA status', 'Due date', 'Est. recovery'],
      rows.map((r) => [r.id, r.caseId, r.case?.productName, r.title, TASK_TYPE_LABEL[r.type], r.priority, SLA_LABEL[slaOf(r)], r.dueDate, r.case?.estimatedNetRecovery]),
    );

  const columns: DataColumn<TaskRow>[] = [
    {
      title: 'Case ID',
      key: 'case',
      priority: 1,
      ellipsis: false,
      render: (_, r) => (
        <Link href={`/product/case/${r.caseId}`} onClick={(e) => {
            e.stopPropagation();
            fromQueue();
          }} className="whitespace-nowrap font-mono font-bold text-[#141416] hover:underline">
          {r.caseId}
        </Link>
      ),
    },
    {
      title: 'Equipment / SKU',
      key: 'asset',
      priority: 2,
      render: (_, r) => (
        <div className="min-w-0">
          <div className="line-clamp-2 break-words font-semibold text-[#141416]">{r.case?.productName ?? '—'}</div>
          <div className="line-clamp-2 break-words font-mono text-[11px] text-[#64748B]">{r.case?.assetTag}</div>
        </div>
      ),
    },
    {
      title: 'Required Action',
      key: 'title',
      priority: 1,
      render: (_, r) => (
        <div className="min-w-0">
          <div className="line-clamp-2 break-words text-[#334155]">{actionText(r)}</div>
          <div className="text-[11px] text-[#94A3B8]">{TASK_TYPE_LABEL[r.type]}</div>
        </div>
      ),
    },
    {
      title: 'Priority',
      key: 'priority',
      priority: 2,
      ellipsis: false,
      render: (_, r) => <span className={`rounded border px-2 py-0.5 text-[11px] font-bold uppercase ${PRIORITY_BADGE[r.priority]}`}>{r.priority}</span>,
    },
    {
      title: 'SLA Status',
      key: 'sla',
      priority: 1,
      ellipsis: false,
      render: (_, r) => {
        const s = slaOf(r);
        return (
          <div>
            <span className={`whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-bold uppercase ${SLA_BADGE[s]}`}>{SLA_LABEL[s]}</span>
            <div className="mt-1 text-[11px] text-[#94A3B8]">{r.dueInDays < 0 ? `${-r.dueInDays}d late` : r.dueInDays === 0 ? 'today' : `in ${r.dueInDays}d`}</div>
          </div>
        );
      },
    },
    {
      title: 'Est. Recovery',
      key: 'value',
      priority: 3,
      align: 'right',
      ellipsis: false,
      render: (_, r) => <span className="font-mono text-xs font-bold text-emerald-700">{r.case ? fmtUsd(r.case.estimatedNetRecovery) : '—'}</span>,
    },
    {
      title: 'Action',
      key: 'act',
      priority: 1,
      align: 'right',
      ellipsis: false,
      render: (_, r) => (
        // Outline (not yellow): the whole row opens the case too. Styles sit on the inner span because of antd's `a` reset.
        <Link href={`/product/case/${r.caseId}`} onClick={(e) => {
            e.stopPropagation();
            fromQueue();
          }} className="inline-flex">
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#141416] shadow-2xs transition-all hover:border-gray-400">
            Open case <ArrowRight size={12} />
          </span>
        </Link>
      ),
    },
  ];

  const noTasksForRole = currentRole === 'Executive';

  return (
    <div className="space-y-6">
      <TabToolbar
        description={`Tasks, disposition reviews, evidence approvals and stage gates assigned to the ${currentRole} role. Resolve bottlenecks to keep cases advancing.`}
        onExport={exportCsv}
        canExport={!!rows.length}
      />

      {q.initialLoading ? (
        <KpiSkeletonRow count={3} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard label="Overdue SLAs" value={kpis.overdue} icon={<ShieldAlert />} iconTone="red" context={`${kpis.dueToday} more due today`} />
          <MetricCard label="Value at Risk" value={fmtMoney(kpis.risk)} icon={<CheckCircle />} iconTone="green" context="Under assigned cases" />
          <MetricCard label="Due This Week" value={kpis.week} icon={<CalendarClock />} iconTone="blue" context="Due in the next 7 days" />
        </div>
      )}

      <CommandFilters
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search by Case ID, Asset, or Required Action..."
        onClear={clear}
        canClear={filtered}
      >
        <CommandSelect<Priority | 'all'>
          label="Priority"
          value={priority}
          onChange={(v) => {
            setPriority(v);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'All Priorities' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ]}
        />
        <CommandSelect<Sla | 'all'>
          label="SLA status"
          value={sla}
          onChange={(v) => {
            setSla(v);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'All SLA Statuses' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'due_today', label: 'Due Today' },
            { value: 'on_track', label: 'On Track' },
          ]}
        />
      </CommandFilters>

      <SectionCard
        title={q.initialLoading ? 'Assigned tasks' : `Assigned tasks (${rows.length})`}
        description={q.initialLoading ? 'Sorted by SLA urgency: earliest due first.' : `${kpis.high} high priority. Sorted by SLA urgency: earliest due first.`}
        icon={<UserCheck />}
      >
        {q.error && !q.data ? (
          <ErrorState onRetry={q.refetch} />
        ) : (
          <DataTable<TaskRow>
            rowKey="id"
            onRowClick={(r) => {
              fromQueue();
              router.push(`/product/case/${r.caseId}`);
            }}
            columns={columns.map((c) => ({ ...c, ellipsis: false }))}
            dataSource={rows}
            initialLoading={q.initialLoading}
            refreshing={q.loading && !q.initialLoading}
            filtered={filtered}
            onClearFilters={clear}
            emptyTitle={noTasksForRole ? 'No tasks for the Executive role' : 'Nothing assigned to you'}
            emptyDescription={noTasksForRole ? 'Executives review outcomes on Key Figures; tasks go to Planners, Approvers, Engineers and Finance.' : 'New tasks appear here as cases need you.'}
            pagination={{ current: page, pageSize: 10, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          />
        )}
      </SectionCard>
    </div>
  );
}
