'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Checkbox, message, Tabs } from 'antd';
import { ChevronRight, ListChecks } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { dashboardService, type TaskRow } from '@/services/dashboardService';
import { taskService } from '@/services/taskService';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui';
import { rememberQueue } from '@/components/product/queueContext';
import { CardLink, SectionCard } from './SectionCard';

type TabKey = 'due' | 'progress' | 'waiting' | 'done';
const TABS: { key: TabKey; label: string; empty: string }[] = [
  { key: 'due', label: 'Due soon', empty: 'Nothing due in the next 7 days.' },
  { key: 'progress', label: 'In progress', empty: 'No tasks in progress.' },
  { key: 'waiting', label: 'Waiting on others', empty: 'Nothing is waiting on others.' },
  { key: 'done', label: 'Completed', empty: 'No completed tasks yet.' },
];
const MAX_ROWS = 5;

const dateLabel = (t: TaskRow) => {
  const d = new Date(t.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (t.status === 'done') return d;
  if (t.dueInDays < 0) return `${d} · late`;
  if (t.dueInDays === 0) return 'Today';
  return d;
};

/** The signed-in role's tasks by status. Ticking a task marks it done through taskService. */
export function MyWork() {
  const router = useRouter();
  const { currentRole, currentTenant, scope } = useAuth();
  const [tab, setTab] = useState<TabKey>('due');
  const [busy, setBusy] = useState<string | null>(null);
  const q = useServiceQuery(
    () => dashboardService.myWork({ role: currentRole, tenant: currentTenant, scope }),
    [currentRole, currentTenant, scope.tenant, scope.site],
    { subscribe: taskService.subscribe },
  );
  const d = q.data;

  const toggle = async (t: TaskRow, checked: boolean) => {
    setBusy(t.id);
    try {
      await taskService.setStatus(t.id, checked ? 'done' : 'todo');
      message.success(checked ? `Marked done: ${t.title}` : `Reopened: ${t.title}`);
    } catch {
      message.error('The task could not be updated. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const list = (key: TabKey) => {
    const rows = d?.[key] ?? [];
    if (!rows.length) return <EmptyState compact title={TABS.find((x) => x.key === key)!.empty} />;
    return (
      <ul className="m-0 list-none divide-y divide-[#F1F5F9] p-0">
        {rows.slice(0, MAX_ROWS).map((t) => (
          <li
            key={t.id}
            onClick={() => {
              rememberQueue('Dashboard', '/dashboard', rows.slice(0, MAX_ROWS).filter((x) => x.caseId).map((x) => x.caseId));
              router.push(t.href ?? `/product/case/${t.caseId}`);
            }}
            className="group flex cursor-pointer items-center gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <span onClick={(e) => e.stopPropagation()} className="flex shrink-0">
              <Checkbox
                checked={t.status === 'done'}
                disabled={busy === t.id}
                onChange={(e) => toggle(t, e.target.checked)}
                aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Mark done: ${t.title}`}
              />
            </span>
            <span className={`min-w-0 flex-1 truncate text-xs font-medium ${t.status === 'done' ? 'text-[#94A3B8] line-through' : 'text-[#141416]'}`} title={t.title}>
              {t.title}
            </span>
            <span className={`shrink-0 whitespace-nowrap text-[11px] ${t.status !== 'done' && t.dueInDays <= 0 ? 'font-bold text-[#DC2626]' : 'text-[#64748B]'}`}>{dateLabel(t)}</span>
            <ChevronRight size={15} className="shrink-0 text-[#94A3B8] group-hover:text-[#141416]" />
          </li>
        ))}
        {rows.length > MAX_ROWS && (
          <li className="pt-2.5 text-[11px] text-[#64748B]">
            +{rows.length - MAX_ROWS} more in <CardLink href="/command/actions">My work</CardLink>
          </li>
        )}
      </ul>
    );
  };

  return (
    <SectionCard title="My Work" icon={<ListChecks />} actions={<CardLink href="/command/actions">Open My work</CardLink>}>
      {q.error && !d ? (
        <ErrorState compact onRetry={q.refetch} />
      ) : q.initialLoading || !d ? (
        <ListSkeleton rows={4} />
      ) : (
        <Tabs
          size="small"
          activeKey={tab}
          onChange={(k) => setTab(k as TabKey)}
          className="-mt-2"
          items={TABS.map((x) => ({
            key: x.key,
            label: (
              <span className="text-xs font-semibold">
                {x.label} <span className="ml-0.5 rounded-full bg-[#F1F5F9] px-1.5 py-px text-[10px] font-bold text-[#475569]">{d[x.key].length}</span>
              </span>
            ),
            children: list(x.key),
          }))}
        />
      )}
    </SectionCard>
  );
}
