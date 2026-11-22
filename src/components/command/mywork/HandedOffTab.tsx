'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { message } from 'antd';
import { Cpu, ExternalLink, Gauge, RefreshCw, Send, Truck } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { commandService, type HandoffRow, type HandoffStatus } from '@/services/commandService';
import { caseLifecycleService, type Actor } from '@/services/caseLifecycleService';
import { DataTable, ErrorState, KpiSkeletonRow, MetricCard, SearchInput, StatusBadge, type DataColumn } from '@/components/ui';
import { RoutePill, SectionCard } from '@/components/command/CommandUi';
import { downloadCsv, formatDay } from '@/components/command/commandUtils';
import { rememberQueue } from '@/components/product/queueContext';
import { myWorkHref } from './myWorkTabs';
import { TabToolbar } from './TabToolbar';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import type { Tone } from '@/theme/tokens';

/* Status comes from the instruction steps (same steps as the Case page Execution tab). */
const STATUS_META: Record<HandoffStatus, { label: string; tone: Tone }> = {
  staged: { label: 'Staged · not sent', tone: 'neutral' },
  in_transit: { label: 'In transit', tone: 'info' },
  refurbishing: { label: 'In execution', tone: 'warning' },
  delivered: { label: 'Delivered', tone: 'success' },
};
const SENDERS = ['Planner', 'Approver', 'Admin', 'Warehouse Manager'];
const SIMULATORS = ['Admin', 'Developer'];
const RESENDERS = ['Planner', 'Approver', 'Admin', 'Developer', 'Warehouse Manager'];
const smallBtn =
  'inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-60';
type Filter = HandoffStatus | 'all' | 'overdue';
const FILTERS: Filter[] = ['all', 'overdue', 'staged', 'in_transit', 'refurbishing', 'delivered'];
const FILTER_LABEL: Record<Filter, string> = { all: 'All', overdue: 'Overdue', staged: 'Staged', in_transit: 'In transit', refurbishing: 'In execution', delivered: 'Delivered' };

/** My work › Handed off: approved cases in physical fulfilment. */
export function HandedOffTab() {
  const router = useRouter();
  const { scope, currentRole, user } = useAuth();
  const actor: Actor = { id: user.id, name: user.name, role: currentRole };
  const [status, setStatus] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sending, setSending] = useState<string | null>(null);

  const q = useServiceQuery(() => commandService.handoffs({ search }, scope), [search, scope.tenant, scope.site], { subscribe: commandService.subscribe });
  const all = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(() => (status === 'all' ? all : status === 'overdue' ? all.filter((r) => r.overdue) : all.filter((r) => r.status === status)), [all, status]);
  const fromQueue = () => rememberQueue('Handed off', myWorkHref('handed-off'), rows.map((r) => r.id));

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: all.length, overdue: 0, staged: 0, in_transit: 0, refurbishing: 0, delivered: 0 };
    all.forEach((r) => {
      c[r.status] += 1;
      if (r.overdue) c.overdue += 1;
    });
    return c;
  }, [all]);
  const overdue = counts.overdue;
  const adherence = all.length ? ((all.length - overdue) / all.length) * 100 : 100;

  const run = async (r: HandoffRow, fn: () => Promise<string>) => {
    setSending(r.id);
    try {
      message.success(await fn());
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'That did not work. Nothing was changed.');
    } finally {
      setSending(null);
    }
  };
  const send = (r: HandoffRow) =>
    run(r, async () => {
      const steps = await caseLifecycleService.sendInstruction(r.id, actor);
      return `${steps.length} instructions for ${r.id} sent to ${[...new Set(steps.map((i) => i.system))].join(', ')}.`;
    });
  const simulate = (r: HandoffRow) =>
    run(r, async () => {
      const res = await caseLifecycleService.advance(r.id, actor);
      if (res.delivered) return `${r.id} delivered: every step is done. The outcome is waiting for Finance in Outcomes to confirm.`;
      return `Simulated system event: ${res.step.system} ${res.event === 'acknowledged' ? 'acknowledged' : 'completed'} "${res.step.instruction}".`;
    });
  const resendable = (r: HandoffRow) => r.steps.find((i) => i.status === 'sent' || (i.overdue && i.status !== 'done')) ?? null;
  const resend = (r: HandoffRow) =>
    run(r, async () => {
      const step = resendable(r);
      if (!step) throw new Error('No step to resend');
      const i = await caseLifecycleService.resend(r.id, step.id, actor);
      return `Instruction ${i.doc} resent to ${i.system} (same instruction, resend ${i.resends}).`;
    });

  const exportCsv = () =>
    downloadCsv(
      'handed-off.csv',
      ['Case ID', 'Asset', 'Route', 'Destination', 'System', 'Instruction', 'Carrier', 'Tracking ref', 'Sent', 'Target', 'Status', 'Overdue'],
      rows.map((r) => [r.id, r.case.productName, DISPOSITION_ROUTES[r.case.recommendedRoute]?.name, r.destination, r.system, r.instructionId, r.carrier, r.trackingRef, r.sentAt, r.targetDate, STATUS_META[r.status].label, r.overdue ? 'yes' : 'no']),
    );

  const columns: DataColumn<HandoffRow>[] = [
    {
      title: 'Case ID',
      key: 'id',
      priority: 1,
      ellipsis: false,
      render: (_, r) => (
        <Link href={`/product/case/${r.id}`} onClick={(e) => {
            e.stopPropagation();
            fromQueue();
          }} className="whitespace-nowrap font-mono font-bold text-[#0F172A] hover:underline">
          {r.id}
        </Link>
      ),
    },
    {
      title: 'Asset / SKU',
      key: 'asset',
      priority: 2,
      render: (_, r) => (
        <div className="min-w-0">
          <div className="line-clamp-2 break-words text-xs font-semibold text-[#0F172A]">{r.case.productName}</div>
          <div className="line-clamp-2 break-words font-mono text-[10px] text-[#64748B]">{r.case.assetTag}</div>
        </div>
      ),
    },
    { title: 'Disposition Route', key: 'route', priority: 3, render: (_, r) => <RoutePill route={r.case.recommendedRoute} /> },
    {
      title: 'Destination & Logistics',
      key: 'dest',
      priority: 2,
      render: (_, r) => (
        <div className="min-w-0">
          <div className="line-clamp-2 break-words text-xs font-semibold text-[#0F172A]">{r.destination}</div>
          <div className="line-clamp-2 break-words font-mono text-[10px] text-[#64748B]">
            {r.system}
            {r.status === 'staged' ? ' · instruction not sent' : r.trackingRef ? ` · #${r.trackingRef}` : ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Steps',
      key: 'steps',
      priority: 2,
      ellipsis: false,
      render: (_, r) => (
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[#0F172A]">
            <span className="font-mono">{r.done}</span> of <span className="font-mono">{r.steps.length}</span> done
          </div>
          <div className="line-clamp-2 break-words text-[10px] text-[#64748B]">
            {r.status === 'staged'
              ? 'Sent only after Send instruction'
              : r.next
                ? `${r.next.system}: ${r.next.status === 'sent' ? 'waiting for acknowledgement' : 'acknowledged, in progress'}${r.next.resends ? ` · resent ${r.next.resends}×` : ''}`
                : 'Every step done'}
          </div>
        </div>
      ),
    },
    {
      title: 'Dispatched / Target',
      key: 'dates',
      priority: 3,
      render: (_, r) => (
        <div>
          <div className="text-xs font-medium text-[#0F172A]">{r.sentAt ? formatDay(r.sentAt) : 'Not dispatched'}</div>
          <div className="text-[10px] text-[#64748B]">Target: {formatDay(r.targetDate)}</div>
        </div>
      ),
    },
    {
      title: 'Execution Status',
      key: 'status',
      priority: 1,
      ellipsis: false,
      render: (_, r) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</StatusBadge>
          {r.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
        </div>
      ),
    },
    {
      title: 'Action',
      key: 'action',
      priority: 1,
      align: 'right',
      ellipsis: false,
      render: (_, r) => {
        const busy = sending === r.id;
        const open = (
          <Link
            href={`/product/case/${r.id}`}
            onClick={(e) => {
              e.stopPropagation();
              fromQueue();
            }}
            className={smallBtn}
          >
            <ExternalLink size={12} /> Open case
          </Link>
        );
        if (r.status === 'staged') {
          return SENDERS.includes(currentRole) ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); send(r); }} disabled={busy} className={smallBtn}>
              <Send size={12} /> {busy ? 'Sending…' : 'Send instruction'}
            </button>
          ) : (
            open
          );
        }
        const re = r.status !== 'delivered' && RESENDERS.includes(currentRole) ? resendable(r) : null;
        const sim = r.status !== 'delivered' && SIMULATORS.includes(currentRole) && r.next;
        if (!re && !sim) return open;
        return (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {re && (
              <button type="button" onClick={(e) => { e.stopPropagation(); resend(r); }} disabled={busy} className={smallBtn} data-tip={`Send ${re.doc} to ${re.system} again (same instruction, no duplicate)`}>
                <RefreshCw size={12} /> Resend
              </button>
            )}
            {sim && r.next && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); simulate(r); }}
                disabled={busy}
                className={smallBtn}
                data-tip={`Demo only: plays the event ${r.next.system} would send back`}
              >
                <Cpu size={12} /> {r.next.status === 'sent' ? 'Simulate system acknowledgement' : 'Simulate step done'}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <TabToolbar
        description={
          SIMULATORS.includes(currentRole)
            ? 'Hand-off steps per approved case, as the executing systems report them. In this demo you play those systems: Simulate system acknowledgement, then Simulate step done; the last step delivers the case and reports its outcome to Finance.'
            : 'Hand-off steps per approved case, as the executing systems (WMS, SAP PM, remarketing, recyclers) acknowledge and complete them. When every step is done the case is delivered and its outcome goes to Finance.'
        }
        onExport={exportCsv}
        canExport={!!rows.length}
      />

      {/* Status counts live in the filter tabs below; SLA adherence is the one figure they don't show. */}
      {q.initialLoading ? (
        <KpiSkeletonRow count={1} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="SLA Adherence" value={`${adherence.toFixed(1)}%`} icon={<Gauge />} iconTone={overdue ? 'red' : 'green'} context={`${overdue} past target date`} />
        </div>
      )}

      <SectionCard
        title="Dispatched Tracking Register"
        description={q.initialLoading ? undefined : `${rows.length} of ${all.length} records`}
        icon={<Truck />}
        right={<SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search tracking..." width={220} />}
      >
        <div className="mb-3 flex flex-wrap items-center gap-1 rounded-xl bg-[#F1F5F9] p-1 text-xs sm:inline-flex" role="group" aria-label="Filter by status">
          {FILTERS.map((st) => (
            <button
              key={st}
              type="button"
              aria-pressed={status === st}
              onClick={() => {
                setStatus(st);
                setPage(1);
              }}
              className={`cursor-pointer rounded-lg px-3 py-1 font-semibold transition-all ${status === st ? 'bg-white text-[#0F172A] shadow-xs' : 'text-[#64748B] hover:text-[#0F172A]'}`}
            >
              {FILTER_LABEL[st]}
              {!q.initialLoading && <span className={`ml-1.5 font-mono text-[10px] ${st === 'overdue' && counts.overdue ? 'font-bold text-[#B91C1C]' : 'text-[#94A3B8]'}`}>{counts[st]}</span>}
            </button>
          ))}
        </div>
        {q.error && !q.data ? (
          <ErrorState onRetry={q.refetch} />
        ) : (
          <DataTable<HandoffRow>
            rowKey="id"
            onRowClick={(r) => {
              fromQueue();
              router.push(`/product/case/${r.id}`);
            }}
            columns={columns.map((c) => ({ ...c, ellipsis: false }))}
            dataSource={rows}
            initialLoading={q.initialLoading}
            refreshing={q.loading && !q.initialLoading}
            filtered={!!search || status !== 'all'}
            onClearFilters={() => {
              setSearch('');
              setStatus('all');
            }}
            emptyTitle="Nothing handed off yet"
            emptyDescription="Approved cases appear here, staged until their instructions are sent."
            pagination={{ current: page, pageSize: 10, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          />
        )}
      </SectionCard>
    </div>
  );
}
