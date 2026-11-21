'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Tooltip } from 'antd';
import { CalendarClock, Hourglass, ListOrdered, TrendingDown } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { commandService, dueText, type PriorityRow } from '@/services/commandService';
import { metricsService } from '@/services/metricsService';
import { DataTable, ErrorState, KpiSkeletonRow, MetricCard, ProgressBar, type DataColumn } from '@/components/ui';
import { CommandFilters, CommandSelect, RoutePill, SectionCard } from '@/components/command/CommandUi';
import { downloadCsv, fmtMoney, fmtUsd } from '@/components/command/commandUtils';
import { rememberQueue } from '@/components/product/queueContext';
import { myWorkHref } from './myWorkTabs';
import { TabToolbar } from './TabToolbar';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';

const ROUTE_OPTIONS = [{ value: 'all', label: 'All Routes' }, ...metricsService.meta().routes.map((r) => ({ value: r.id as string, label: DISPOSITION_ROUTES[r.id]?.name ?? r.name }))];

/** My work › Prioritise: open cases ranked by urgency and value. */
export function PrioritiseTab() {
  const router = useRouter();
  const { scope } = useAuth();
  const [search, setSearch] = useState('');
  const [route, setRoute] = useState('all');
  const [page, setPage] = useState(1);

  const q = useServiceQuery(() => commandService.prioritise({ search, route }, scope), [search, route, scope.tenant, scope.site], { subscribe: commandService.subscribe });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const fromQueue = () => rememberQueue('Prioritise', myWorkHref('prioritise'), rows.map((r) => r.id));

  const kpis = useMemo(
    () => ({
      urgent: rows.filter((r) => r.score >= 60).length,
      decay: rows.reduce((s, r) => s + r.decayPerDay, 0),
      risk: rows.reduce((s, r) => s + r.case.valueAtRisk, 0),
      soon: rows.filter((r) => r.case.dueInDays <= 5).length,
    }),
    [rows],
  );

  const filtered = !!search || route !== 'all';
  const clear = () => {
    setSearch('');
    setRoute('all');
    setPage(1);
  };

  const exportCsv = () =>
    downloadCsv(
      'actions-to-prioritise.csv',
      ['Rank', 'Score', 'Case ID', 'Product', 'Asset tag', 'Stage', 'Urgency driver', 'Value decay per day', 'Recommended route', 'Est. net value', 'Due in days'],
      rows.map((r, i) => [i + 1, r.score, r.id, r.case.productName, r.case.assetTag, r.case.stage, r.driver, r.decayPerDay, DISPOSITION_ROUTES[r.case.recommendedRoute]?.name, r.case.estimatedNetRecovery, r.case.dueInDays]),
    );

  const columns: DataColumn<PriorityRow>[] = [
    {
      title: 'Priority Rank',
      key: 'score',
      priority: 1,
      ellipsis: false,
      render: (_, r) => (
        <div className="flex w-16 flex-col gap-1">
          <span className="font-mono text-sm font-extrabold text-[#0F172A]">{r.score}</span>
          <ProgressBar value={r.score} label={`Priority score ${r.score} of 100`} tone={r.score >= 60 ? 'danger' : r.score >= 40 ? 'warning' : 'success'} height={4} />
        </div>
      ),
    },
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
      title: 'Product / SKU',
      key: 'product',
      priority: 2,
      render: (_, r) => (
        <div className="min-w-0">
          <div className="line-clamp-2 break-words text-xs font-semibold text-[#0F172A]">{r.case.productName}</div>
          <div className="line-clamp-2 break-words font-mono text-[10px] text-[#64748B]">
            {r.case.assetTag}
            {/* Due date only here when the driver doesn't already say it. */}
            {r.driver.startsWith(dueText(r.case.dueInDays)) ? '' : ` · ${dueText(r.case.dueInDays).toLowerCase()}`}
          </div>
        </div>
      ),
    },
    {
      title: 'Primary Urgency Driver',
      key: 'driver',
      priority: 2,
      render: (_, r) => (
        <div className="min-w-0">
          <Tooltip title={r.driver}>
            <div className="line-clamp-2 break-words text-xs font-medium text-[#334155]">{r.driver}</div>
          </Tooltip>
          {r.decayPerDay > 0 && (
            <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-[#EF4444]">
              <TrendingDown size={12} />
              <span>Value decay: {fmtUsd(r.decayPerDay)}/day</span>
            </div>
          )}
        </div>
      ),
    },
    { title: 'Recommended Route', key: 'route', priority: 3, render: (_, r) => <RoutePill route={r.case.recommendedRoute} /> },
    {
      title: 'Est. Net Value',
      key: 'value',
      priority: 3,
      align: 'right',
      ellipsis: false,
      render: (_, r) => <span className="font-mono text-xs font-bold text-[#059669]">{fmtUsd(r.case.estimatedNetRecovery)}</span>,
    },
    {
      title: 'Action',
      key: 'action',
      priority: 1,
      align: 'right',
      ellipsis: false,
      render: (_, r) => (
        <Link
          href={`/product/case/${r.id}`}
          onClick={(e) => {
            e.stopPropagation();
            fromQueue();
          }}
          className="inline-flex whitespace-nowrap rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400"
        >
          Triage Case
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <TabToolbar
        description="Open cases ranked by how soon they are due, the value at risk, the predicted recovery and case priority. Work from the top."
        onExport={exportCsv}
        canExport={!!rows.length}
      />

      {q.initialLoading ? (
        <KpiSkeletonRow />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Backlog to Prioritise" value={rows.length} unit="cases" icon={<Hourglass />} context={`${kpis.urgent} cases scored 60 or more`} />
          <MetricCard label="Daily Value Decay" value={`${fmtMoney(kpis.decay)}/day`} icon={<TrendingDown />} iconTone="red" context="Value at risk spread over days to due date" />
          <MetricCard label="Value at Risk" value={fmtMoney(kpis.risk)} icon={<ListOrdered />} context="Across the ranked backlog" />
          <MetricCard label="Due Within 5 Days" value={kpis.soon} unit="cases" icon={<CalendarClock />} iconTone="blue" context="Including overdue cases" />
        </div>
      )}

      <CommandFilters
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search by Case ID, product or driver..."
        onClear={clear}
        canClear={filtered}
      >
        <CommandSelect
          label="Recommended route"
          value={route}
          onChange={(v) => {
            setRoute(v);
            setPage(1);
          }}
          options={ROUTE_OPTIONS}
        />
      </CommandFilters>

      <SectionCard
        title="Ranked Decision Priority Matrix"
        description="Score 0–100. Approved and handed-off cases are excluded."
        icon={<ListOrdered />}
      >
        {q.error && !q.data ? (
          <ErrorState onRetry={q.refetch} />
        ) : (
          <DataTable<PriorityRow>
            rowKey="id"
            onRowClick={(r) => {
              fromQueue();
              router.push(`/product/case/${r.id}`);
            }}
            columns={columns.map((c) => ({ ...c, ellipsis: false }))}
            dataSource={rows}
            initialLoading={q.initialLoading}
            refreshing={q.loading && !q.initialLoading}
            filtered={filtered}
            onClearFilters={clear}
            emptyTitle="Nothing to prioritise"
            emptyDescription="Every open case in your scope has been decided."
            pagination={{ current: page, pageSize: 10, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          />
        )}
      </SectionCard>
    </div>
  );
}
