'use client';

import React, { useMemo } from 'react';
import { message } from 'antd';
import { BarChart3, Table2 } from 'lucide-react';
import type { RouteMixReport, RouteMixRow } from '@/services/analyticsService';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import type { Tone } from '@/theme/tokens';
import { ChartSkeleton, DataTable, Panel, StatusBadge, TableSkeleton, type DataColumn } from '@/components/ui';
import { StackedBarChart } from '@/components/charts';
import { downloadCsv } from '@/components/analytics/AnalyticsControls';

const targetStatus = (r: RouteMixRow): { label: string; tone: Tone } => {
  const gap = r.share - r.target;
  if (r.id === 'exit') return gap <= 0 ? { label: 'Minimised', tone: 'success' } : { label: 'Above target', tone: 'warning' };
  if (Math.abs(gap) <= 1.5) return { label: 'On target', tone: 'info' };
  return gap > 0 ? { label: 'Above target', tone: 'success' } : { label: 'Under target', tone: 'warning' };
};

export function exportRouteMix(data: RouteMixReport, months: number) {
  const ids = data.routes.map((r) => r.id);
  downloadCsv(
    `route-mix-${months}m.csv`,
    ['Month', ...data.routes.map((r) => `${DISPOSITION_ROUTES[r.id]?.name ?? r.label} (%)`)],
    data.months.map((m) => [m.month, ...ids.map((id) => m[id])]),
  );
  message.success('Route mix exported (CSV)');
}

const columns: DataColumn<RouteMixRow>[] = [
  {
    title: 'Circularity pathway',
    key: 'route',
    priority: 1,
    render: (_, r) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="h-3 w-3 shrink-0 rounded-md" style={{ backgroundColor: DISPOSITION_ROUTES[r.id]?.color }} />
        <span className="truncate text-xs font-bold text-[#141416]">{DISPOSITION_ROUTES[r.id]?.name ?? r.label}</span>
      </span>
    ),
  },
  {
    title: 'Share',
    dataIndex: 'share',
    key: 'share',
    priority: 1,
    align: 'right',
    render: (v: number, r) => (
      <span className="font-mono text-xs">
        <span className="font-bold text-[#141416]">{v.toFixed(1)}%</span>
        <span className="ml-1.5 text-[11px] text-[#64748B]">/ {r.target}%</span>
      </span>
    ),
  },
  { title: 'Decisions', dataIndex: 'decisions', key: 'decisions', priority: 2, align: 'right', render: (v: number) => <span className="font-mono text-xs text-[#475569]">{v}</span> },
  {
    title: 'Change',
    dataIndex: 'change',
    key: 'change',
    priority: 3,
    align: 'right',
    render: (v: number) => <span className="font-mono text-xs text-[#475569]">{`${v > 0 ? '+' : ''}${v.toFixed(1)} pp`}</span>,
  },
  {
    title: 'Status',
    key: 'status',
    priority: 2,
    render: (_, r) => {
      const s = targetStatus(r);
      return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
    },
  },
];

/** Route mix progression: share of closed decisions per pathway by month, against the target mix. */
export function RouteMixTab({ data, loading }: { data: RouteMixReport | undefined; loading: boolean }) {
  const series = useMemo(
    () => (data?.routes ?? []).map((r) => ({ key: r.id, label: DISPOSITION_ROUTES[r.id]?.name ?? r.label, color: DISPOSITION_ROUTES[r.id]?.color })),
    [data],
  );

  if (!data) {
    return (
      <div className="space-y-6">
        <Panel title="Route share by month">
          <ChartSkeleton height={280} />
        </Panel>
        <Panel title="Routes against target">
          <TableSkeleton rows={7} columns={5} />
        </Panel>
      </div>
    );
  }

  const exitTarget = data.routes.find((r) => r.id === 'exit')?.target ?? 0;

  return (
    <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
      <Panel
        title="Route share by month"
        description={`Share of the ${data.kpis.decisionsClosed.toLocaleString('en-US')} decisions closed ${data.range}, per route; each bar adds up to 100%.`}
        icon={<BarChart3 />}
      >
        <StackedBarChart
          data={data.months}
          xKey="month"
          series={series}
          ariaLabel={`Route mix by month, ${data.range}, shares normalised to 100%`}
          valueFormat={(v) => `${Math.round(v)}%`}
          height={280}
        />
      </Panel>

      <Panel
        title="Routes against target"
        description={`Decision-weighted share for the period, the target share, and the change from the first to the last month. Responsible exit is ${data.kpis.exitShare.toFixed(1)}% against a target under ${exitTarget}%.`}
        icon={<Table2 />}
      >
        <DataTable<RouteMixRow> columns={columns} dataSource={data.routes} rowKey="id" pagination={false} refreshing={loading} />
      </Panel>
    </div>
  );
}
