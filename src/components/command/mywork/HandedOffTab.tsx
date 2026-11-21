'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { message } from 'antd';
import { ExternalLink, Gauge, Send, Truck } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { commandService, type HandoffRow, type HandoffStatus } from '@/services/commandService';
import { DataTable, ErrorState, KpiSkeletonRow, MetricCard, SearchInput, StatusBadge, type DataColumn } from '@/components/ui';
import { RoutePill, SectionCard } from '@/components/command/CommandUi';
import { downloadCsv, formatDay } from '@/components/command/commandUtils';
import { rememberQueue } from '@/components/product/queueContext';
import { myWorkHref } from './myWorkTabs';
import { TabToolbar } from './TabToolbar';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import type { Tone } from '@/theme/tokens';

const STATUS_META: Record<HandoffStatus, { label: string; tone: Tone }> = {
  staged: { label: 'Staged at Bay', tone: 'neutral' },
  in_transit: { label: 'In Transit', tone: 'info' },
  refurbishing: { label: 'Refurbishing', tone: 'warning' },
  delivered: { label: 'Delivered / Confirmed', tone: 'success' },
};
type Filter = HandoffStatus | 'all' | 'overdue';
const FILTERS: Filter[] = ['all', 'overdue', 'staged', 'in_transit', 'refurbishing', 'delivered'];
const FILTER_LABEL: Record<Filter, string> = { all: 'All', overdue: 'Overdue', staged: 'Staged', in_transit: 'In transit', refurbishing: 'Refurbishing', delivered: 'Delivered' };

/** My work › Handed off: approved cases in physical fulfilment. */
export function HandedOffTab() {
  const router = useRouter();
  const { scope } = useAuth();
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

  const send = async (r: HandoffRow) => {
    setSending(r.id);
    try {
      await commandService.sendInstruction(r.id);
      message.success(`Instruction for ${r.id} sent to ${r.system}.`);
    } catch {
      message.error('The instruction could not be sent. Nothing was changed.');
    } finally {
      setSending(null);
    }
  };

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
            {r.trackingRef ? ` · #${r.trackingRef}` : ' · instruction not sent'}
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
      render: (_, r) =>
        r.status === 'staged' ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              send(r);
            }}
            disabled={sending === r.id}
            className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400 disabled:opacity-60"
          >
            <Send size={12} /> {sending === r.id ? 'Sending…' : 'Send instruction'}
          </button>
        ) : (
          <Link
            href={`/product/case/${r.id}`}
            onClick={(e) => {
              e.stopPropagation();
              fromQueue();
            }}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400"
          >
            <ExternalLink size={12} /> Open case
          </Link>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <TabToolbar
        description="Physical fulfilment tracking across WMS bays, repair centres, secondary remarketers and certified recyclers."
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
            emptyDescription="Approved cases appear here once their instruction is staged."
            pagination={{ current: page, pageSize: 10, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          />
        )}
      </SectionCard>
    </div>
  );
}
