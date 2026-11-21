'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Drawer, message } from 'antd';
import { BookOpen, Download, Leaf, Recycle, Gauge, LineChart as LineIcon, Route } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { analyticsService, type EmissionFactor } from '@/services/analyticsService';
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
import { HorizontalBarChart, LineChart } from '@/components/charts';
import { FilterRow, PERIODS, SegmentToggle, downloadCsv, fmtPct, type Period } from '@/components/analytics/AnalyticsControls';

const fmtT = (v: number) => `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} t`;
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

const factorColumns: DataColumn<EmissionFactor>[] = [
  {
    title: 'Factor',
    key: 'factor',
    priority: 1,
    render: (_, f) => (
      <div className="min-w-0">
        <span className="block truncate text-xs font-semibold text-[#141416]" title={f.factor}>
          {f.factor}
        </span>
        <span className="block truncate text-[11px] text-[#64748B] md:hidden">{f.source}</span>
      </div>
    ),
  },
  {
    title: 'Value',
    key: 'value',
    priority: 1,
    align: 'right',
    render: (_, f) => (
      <span className="text-xs">
        <span className="font-mono font-bold text-[#141416]">{f.value}</span>
        <span className="ml-1 text-[11px] text-[#64748B]">{f.unit}</span>
      </span>
    ),
  },
  { title: 'Source', dataIndex: 'source', key: 'source', priority: 2, render: (v: string) => <span className="text-xs text-[#475569]">{v}</span> },
  {
    title: 'Version',
    dataIndex: 'version',
    key: 'version',
    priority: 3,
    render: (v: string) => <span className="rounded-md bg-[#F1F5F9] px-2 py-0.5 font-mono text-[10px] font-medium text-[#475569]">{v}</span>,
  },
  { title: 'Last updated', dataIndex: 'lastUpdated', key: 'lastUpdated', priority: 3, render: (v: string) => <span className="text-xs text-[#64748B]">{fmtDate(v)}</span> },
];

export default function SustainabilityPage() {
  const [period, setPeriod] = useState<Period>('12');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const months = Number(period);

  const { data, initialLoading, loading, error, refetch } = useServiceQuery(
    () => analyticsService.sustainability(months),
    [months],
  );

  const routeData = useMemo(
    () =>
      (data?.byRoute ?? [])
        .filter((r) => r.value > 0)
        .map((r) => ({ id: r.id, label: r.label, value: r.value, color: DISPOSITION_ROUTES[r.id]?.color })),
    [data],
  );

  const prev = data?.kpis.previous;
  const rangeLabel = data?.months.length ? `${data.months[0].month} – ${data.months[data.months.length - 1].month}` : '';

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `sustainability-co2e-${months}m.csv`,
      ['Month', 'CO2e avoided (t)', 'Measured (t)', 'Estimated (t)', 'Measured share (%)', 'Materials diverted (t)'],
      data.months.map((m) => [
        m.month,
        m.total,
        m.measured,
        m.estimated,
        m.total ? ((m.measured / m.total) * 100).toFixed(1) : '',
        m.materialsDivertedT,
      ]),
    );
    message.success('Sustainability data exported (CSV)');
  };

  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Sustainability"
        description="CO₂e avoided by closed decisions, split into what is backed by measured evidence (weighbridge tickets, metered energy) and what is estimated from emission factors."
        actions={
          <PageActions
            secondary={[
              { key: 'sources', label: 'Sources', icon: <BookOpen />, onClick: () => setSourcesOpen(true), disabled: !data },
              { key: 'export', label: 'Export CSV', icon: <Download />, onClick: exportCsv, disabled: !data },
            ]}
            meta={rangeLabel || undefined}
          />
        }
      />

      <FilterRow>
        <SegmentToggle label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      </FilterRow>

      {error && !data ? (
        <Panel>
          <ErrorState onRetry={refetch} />
        </Panel>
      ) : initialLoading || !data ? (
        <>
          <KpiSkeletonRow count={3} />
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Panel title="Estimated vs measured CO₂e" className="lg:col-span-3">
              <ChartSkeleton height={260} />
            </Panel>
            <Panel title="CO₂e avoided by route" className="lg:col-span-2">
              <ChartSkeleton height={260} />
            </Panel>
          </div>
        </>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard
              label="CO₂e avoided"
              value={data.kpis.co2AvoidedT.toFixed(1)}
              unit="tCO₂e"
              icon={<Leaf />}
              iconTone="green"
              trend={
                prev ? (
                  <TrendIndicator
                    value={prev.co2AvoidedT ? (data.kpis.co2AvoidedT - prev.co2AvoidedT) / prev.co2AvoidedT : 0}
                    format={(v) => fmtPct(v, 1)}
                    label={`vs prior ${months} months`}
                  />
                ) : undefined
              }
              context={prev ? undefined : `Across ${data.months.length} months of closed decisions`}
            />
            <MetricCard
              label="Measured share"
              value={fmtPct(data.kpis.measuredShare, 1)}
              icon={<Gauge />}
              iconTone="blue"
              trend={
                prev ? (
                  <TrendIndicator
                    value={Math.round((data.kpis.measuredShare - prev.measuredShare) * 1000) / 10}
                    format={(v) => `${v.toFixed(1)} pp`}
                    label={`vs prior ${months} months`}
                  />
                ) : undefined
              }
              context={prev ? undefined : 'Of CO₂e backed by measured evidence'}
            />
            <MetricCard
              label="Materials diverted"
              value={data.kpis.materialsDivertedT.toFixed(1)}
              unit="tonnes"
              icon={<Recycle />}
              trend={
                prev ? (
                  <TrendIndicator
                    value={prev.materialsDivertedT ? (data.kpis.materialsDivertedT - prev.materialsDivertedT) / prev.materialsDivertedT : 0}
                    format={(v) => fmtPct(v, 1)}
                    label={`vs prior ${months} months`}
                  />
                ) : undefined
              }
              context={prev ? undefined : 'Kept out of landfill by reuse and recovery'}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Panel
              title="Estimated vs measured CO₂e"
              description={
                <>
                  Monthly tCO₂e avoided. Both lines add up to the CO₂e total in the Value realisation chart on{' '}
                  <Link href="/command" className="font-semibold text-[#141416] underline">
                    Command Center › Key figures
                  </Link>
                  . Estimates use the emission factors under Sources.
                </>
              }
              icon={<LineIcon />}
              className="lg:col-span-3"
            >
              <LineChart
                data={data.months}
                xKey="month"
                series={[
                  { key: 'measured', label: 'Measured', color: chartColors.actual },
                  { key: 'estimated', label: 'Estimated (emission factors)', color: chartColors.predicted, dashed: true },
                ]}
                ariaLabel={`Monthly estimated and measured CO2e avoided, ${rangeLabel}`}
                valueFormat={(v) => `${v}t`}
                yDomain={[0, 'auto']}
                height={260}
              />
            </Panel>
            <Panel
              title="CO₂e avoided by route"
              description="tCO₂e for the period: each month's route mix weighted by the route's typical CO₂e intensity."
              icon={<Route />}
              className="lg:col-span-2"
            >
              <HorizontalBarChart
                data={routeData}
                ariaLabel={`CO2e avoided by route: ${routeData.map((r) => `${r.label} ${r.value} t`).join(', ')}`}
                seriesName="tCO₂e"
                valueFormat={fmtT}
                labelWidth={124}
              />
            </Panel>
          </div>

        </div>
      )}

      {/* Emission factors: reference detail, behind the "Sources" header action */}
      <Drawer
        open={sourcesOpen && !!data}
        onClose={() => setSourcesOpen(false)}
        size={720}
        title={
          <span className="flex items-center gap-2 text-sm font-bold">
            <BookOpen className="h-4 w-4 text-amber-500" /> Sources: emission factors
          </span>
        }
      >
        <p className="m-0 mb-4 text-xs text-[#64748B]">Factors used to estimate CO₂e where no measured evidence is available.</p>
        {data && <DataTable<EmissionFactor> columns={factorColumns} dataSource={data.factors} rowKey="id" pagination={false} />}
      </Drawer>
    </div>
  );
}
