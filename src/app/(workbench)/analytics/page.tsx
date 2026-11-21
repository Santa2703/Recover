'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Tabs } from 'antd';
import { Download, Receipt, Scale, Shuffle, TrendingUp, Waypoints } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { analyticsService } from '@/services/analyticsService';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import { chartColors } from '@/theme/tokens';
import {
  ChartSkeleton,
  DataTable,
  ErrorState,
  KpiSkeletonRow,
  MetricCard,
  PageActions,
  PageHeader,
  Panel,
  TrendIndicator,
  type DataColumn,
} from '@/components/ui';
import { StackedBarChart } from '@/components/charts';
import { FilterRow, PERIODS, SegmentToggle, ShowToggle, fmtMoney, fmtPct, type Period } from '@/components/analytics/AnalyticsControls';
import { useTabExporter, useTabParam } from '@/components/analytics/useTabParam';
import { RouteMixTab, exportRouteMix } from '@/components/analytics/outcomes/RouteMixTab';
import { UnitEconomicsTab, exportEconomics } from '@/components/analytics/outcomes/UnitEconomicsTab';
import { FlowTab } from '@/components/analytics/outcomes/FlowTab';

interface StepRow {
  id: string;
  label: string;
  routes: string;
  value: number;
  share: number;
  total?: boolean;
}

const TABS = ['mix', 'economics', 'flow'] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABEL: Record<TabKey, string> = { mix: 'Route mix', economics: 'Unit economics', flow: 'Flow' };

const stepColumns: DataColumn<StepRow>[] = [
  {
    title: 'Step',
    key: 'label',
    priority: 1,
    render: (_, r) => <span className={`text-xs ${r.total ? 'font-extrabold' : 'font-semibold'} text-[#141416]`}>{r.label}</span>,
  },
  { title: 'Routes', dataIndex: 'routes', key: 'routes', priority: 2, render: (v: string) => <span className="text-xs text-[#64748B]">{v}</span> },
  {
    title: 'Value',
    dataIndex: 'value',
    key: 'value',
    priority: 1,
    align: 'right',
    render: (v: number, r) => (
      <span className={`font-mono text-xs font-bold ${r.total ? 'text-[#141416]' : 'text-[#059669]'}`}>
        {r.total || r.id === 'base' ? '' : '+'}
        {fmtMoney(v)}
      </span>
    ),
  },
  { title: 'Share', dataIndex: 'share', key: 'share', priority: 2, align: 'right', render: (v: number) => <span className="font-mono text-xs text-[#475569]">{fmtPct(v, 1)}</span> },
];

/** Outcomes: what closed decisions realised (waterfall), how they split across routes, what each route costs and returns, and how cases flow. */
export default function OutcomesPage() {
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'mix');
  const [period, setPeriod] = useState<Period>('12');
  const [showTable, setShowTable] = useState(false);
  const [flowExport, registerFlowExport] = useTabExporter();
  const months = Number(period);

  const waterfallQ = useServiceQuery(() => analyticsService.waterfall(months), [months]);
  const mixQ = useServiceQuery(() => analyticsService.routeMix(months), [months]);
  const econQ = useServiceQuery(() => analyticsService.economics(months), [months]);
  const data = waterfallQ.data;

  const chartData = useMemo(() => {
    if (!data) return [];
    return [
      ...data.steps.map((s) => ({ step: s.short, carried: s.start || null, added: s.value, total: null })),
      { step: 'Net recovery', carried: null, added: null, total: data.netRecovery },
    ];
  }, [data]);

  const rows: StepRow[] = useMemo(
    () =>
      data
        ? [
            ...data.steps.map((s) => ({
              id: s.id,
              label: s.label,
              routes: s.routes.map((r) => DISPOSITION_ROUTES[r]?.name ?? r).join(', '),
              value: s.value,
              share: s.share,
            })),
            { id: 'total', label: 'Total realised circular value (net recovery)', routes: 'All routes', value: data.netRecovery, share: 1, total: true },
          ]
        : [],
    [data],
  );

  // One Export for the page: it exports the active tab.
  const exportActive =
    tab === 'mix' ? (mixQ.data ? () => exportRouteMix(mixQ.data!, months) : null) : tab === 'economics' ? (econQ.data ? () => exportEconomics(econQ.data!, months) : null) : flowExport;

  const base = data?.steps.find((s) => s.id === 'base')?.value ?? 0;
  const mix = mixQ.data;
  const econ = econQ.data;
  const kpisReady = data && mix && econ;

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Outcomes"
        description="What closed decisions realised over the scrap baseline, how they split across the 7 routes, what each route costs and returns, and how cases flow to an outcome."
        actions={
          <PageActions
            secondary={[{ key: 'export', label: `Export ${TAB_LABEL[tab].toLowerCase()}`, icon: <Download />, onClick: () => exportActive?.(), disabled: !exportActive }]}
            meta={data?.range}
          />
        }
      />

      <FilterRow>
        <SegmentToggle label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      </FilterRow>

      {/* Page KPIs: at most four, one home each. */}
      {!kpisReady ? (
        <KpiSkeletonRow count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Uplift over scrap"
            value={fmtMoney(data.netRecovery - base)}
            icon={<TrendingUp />}
            iconTone="green"
            context={`${base ? (data.netRecovery / base).toFixed(0) : '—'}× the scrap baseline of ${fmtMoney(base)}`}
          />
          <MetricCard
            label="Recovery per decision"
            value={fmtMoney(data.decisionsClosed ? data.netRecovery / data.decisionsClosed : 0)}
            icon={<Receipt />}
            context="Net recovery divided by the decisions closed in the period"
          />
          <MetricCard
            label="High-value diversion rate"
            value={`${mix.kpis.highValueShare.toFixed(1)}%`}
            icon={<Shuffle />}
            trend={<TrendIndicator value={mix.kpis.highValueChange} format={(v) => `${v.toFixed(1)} pp`} label={`${mix.months[0]?.month} to ${mix.months[mix.months.length - 1]?.month}`} />}
            context="Redeploy + resale + internal parts"
          />
          <MetricCard
            label="Weighted net margin"
            value={fmtPct(econ.kpis.weightedMargin, 1)}
            icon={<Scale />}
            context={`Across the 7 routes, weighted by share of closed decisions, ${econ.range}`}
          />
        </div>
      )}

      {waterfallQ.error && !data ? (
        <Panel>
          <ErrorState onRetry={waterfallQ.refetch} />
        </Panel>
      ) : waterfallQ.initialLoading || !data ? (
        <Panel title="Recovery waterfall">
          <ChartSkeleton height={260} />
        </Panel>
      ) : (
        <Panel
          className={`transition-opacity ${waterfallQ.loading ? 'opacity-70' : ''}`}
          title="Recovery waterfall"
          description={
            <>
              From the scrap base to net recovery: each bar starts where the previous step ended. The bridge lands on {fmtMoney(data.netRecovery)}, the same net recovery as the Value
              realisation chart on{' '}
              <Link href="/command" className="font-semibold text-[#141416] underline">
                Command Center › Key figures
              </Link>
              .
            </>
          }
          icon={<Waypoints />}
          actions={<ShowToggle open={showTable} onToggle={() => setShowTable((o) => !o)} controls="waterfall-steps" />}
        >
          <StackedBarChart
            data={chartData}
            xKey="step"
            orientation="horizontal"
            series={[
              { key: 'carried', label: 'Carried forward', color: chartColors.neutralSoft },
              { key: 'added', label: 'Added in this step', color: chartColors.neutral },
              { key: 'total', label: 'Net recovery', color: chartColors.highlight },
            ]}
            ariaLabel={`Recovery waterfall ${data.range}: ${data.steps.map((s) => `${s.short} ${fmtMoney(s.value)}`).join(', ')}, net recovery ${fmtMoney(data.netRecovery)}`}
            valueFormat={fmtMoney}
            height={260}
          />
          {showTable && (
            <div id="waterfall-steps" className="mt-4">
              <DataTable<StepRow> columns={stepColumns} dataSource={rows} rowKey="id" pagination={false} refreshing={waterfallQ.loading} />
            </div>
          )}
        </Panel>
      )}

      <Tabs
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden
        items={[
          {
            key: 'mix',
            label: TAB_LABEL.mix,
            children: mixQ.error && !mix ? <ErrorState onRetry={mixQ.refetch} /> : <RouteMixTab data={mix} loading={mixQ.loading} />,
          },
          {
            key: 'economics',
            label: TAB_LABEL.economics,
            children: econQ.error && !econ ? <ErrorState onRetry={econQ.refetch} /> : <UnitEconomicsTab data={econ} loading={econQ.loading} onShowMix={() => setTab('mix')} />,
          },
          { key: 'flow', label: TAB_LABEL.flow, children: <FlowTab registerExport={registerFlowExport} /> },
        ]}
      />
    </div>
  );
}
