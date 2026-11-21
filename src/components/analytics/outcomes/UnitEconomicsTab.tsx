'use client';

import React, { useMemo } from 'react';
import { message } from 'antd';
import { BarChart3, Table2 } from 'lucide-react';
import type { EconomicsReport, PathwayEconomics } from '@/services/analyticsService';
import { ChartSkeleton, DataTable, Panel, type DataColumn } from '@/components/ui';
import { HorizontalBarChart } from '@/components/charts';
import { downloadCsv, fmtMoney } from '@/components/analytics/AnalyticsControls';

const fmtMargin = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

export function exportEconomics(data: EconomicsReport, months: number) {
  downloadCsv(
    `pathway-economics-${months}m.csv`,
    ['Route', `Share of closed decisions ${data.range} (%)`, 'Avg direct cost ($)', 'Labour & test (h)', 'Gross recovered ($)', 'Net margin (%)', 'Payback (days)', 'Benefit-cost ratio'],
    data.pathways.map((p) => [p.pathway, p.share.toFixed(1), p.avgDirectCost, p.laborHours, p.grossRecovery, (p.netMargin * 100).toFixed(1), p.paybackDays ?? '', p.benefitCostRatio]),
  );
  message.success('Unit economics exported (CSV)');
}

const columns: DataColumn<PathwayEconomics>[] = [
  {
    title: 'Route',
    key: 'pathway',
    priority: 1,
    render: (_, p) => (
      <div className="min-w-0">
        <span className="block truncate text-xs font-bold text-[#141416]">{p.pathway}</span>
        <span className="text-[11px] text-[#64748B]">{p.share.toFixed(1)}% of closed decisions</span>
      </div>
    ),
  },
  { title: 'Direct cost', dataIndex: 'avgDirectCost', key: 'cost', priority: 2, align: 'right', render: (v: number) => <span className="font-mono text-xs text-[#475569]">{fmtMoney(v)}</span> },
  { title: 'Labour', dataIndex: 'laborHours', key: 'labour', priority: 3, align: 'right', render: (v: number) => <span className="font-mono text-xs text-[#475569]">{v.toFixed(1)} h</span> },
  { title: 'Gross recovered', dataIndex: 'grossRecovery', key: 'gross', priority: 2, align: 'right', render: (v: number) => <span className="font-mono text-xs font-bold text-[#141416]">{fmtMoney(v)}</span> },
  {
    title: 'Net margin',
    dataIndex: 'netMargin',
    key: 'margin',
    priority: 1,
    align: 'right',
    render: (v: number) => <span className={`font-mono text-xs font-bold ${v < 0 ? 'text-[#DC2626]' : 'text-[#059669]'}`}>{fmtMargin(v)}</span>,
  },
  {
    title: 'Payback',
    dataIndex: 'paybackDays',
    key: 'payback',
    priority: 3,
    align: 'right',
    render: (v: number | null) => <span className="font-mono text-xs text-[#475569]">{v === null ? 'N/A' : `${v} days`}</span>,
  },
];

/** Per-unit cost, labour and recovery of each route, and what each dollar spent returns. */
export function UnitEconomicsTab({ data, loading, onShowMix }: { data: EconomicsReport | undefined; loading: boolean; onShowMix: () => void }) {
  // Routes that recover nothing (Responsible Exit) have no benefit-cost ratio; they are named under the chart instead of drawn as an empty bar.
  const noRecovery = (data?.pathways ?? []).filter((p) => p.grossRecovery <= 0);
  const bcrData = useMemo(
    () =>
      (data?.pathways ?? [])
        .filter((p) => p.grossRecovery > 0)
        .sort((a, b) => b.benefitCostRatio - a.benefitCostRatio)
        .map((p) => ({ id: p.id, label: p.pathway, value: p.benefitCostRatio })),
    [data],
  );

  if (!data) {
    return (
      <div className="space-y-6">
        <Panel title="Benefit-cost ratio by route">
          <ChartSkeleton height={200} />
        </Panel>
        <Panel title="Route economics">
          <DataTable<PathwayEconomics> columns={columns} initialLoading />
        </Panel>
      </div>
    );
  }

  const k = data.kpis;

  return (
    <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
      <Panel
        title="Benefit-cost ratio by route"
        description={`Gross value recovered per dollar of direct cost, per unit. Avoided spend on new purchases: ${fmtMoney(k.avoidedSpend)} (${k.avoidedSpendRange}).`}
        icon={<BarChart3 />}
      >
        <HorizontalBarChart
          data={bcrData}
          ariaLabel={`Benefit-cost ratio by pathway: ${bcrData.map((d) => `${d.label} ${d.value}x`).join(', ')}`}
          highlight={bcrData[0]?.id}
          seriesName="Benefit-cost ratio"
          valueFormat={(v) => `${v.toFixed(1)}×`}
          labelWidth={200}
        />
        {noRecovery.length > 0 && (
          <p className="m-0 mt-3 text-[11px] text-[#64748B]">
            Not charted: {noRecovery.map((p) => p.pathway).join(', ')} recovers no value (cost only, {noRecovery.map((p) => fmtMoney(p.avgDirectCost)).join(', ')} per unit).
          </p>
        )}
      </Panel>

      <Panel
        title="Route economics"
        description={
          <>
            Average per unit. Payback is cash-to-cash recovery time; refurbishment breaks even at {k.breakEvenRefurbHours.toFixed(1)} h (scrap wins above {k.maxRefurbHours} h). Shares are closed
            decisions {data.range}, the same figures as{' '}
            <button type="button" onClick={onShowMix} className="cursor-pointer bg-transparent p-0 text-xs font-semibold text-[#141416] underline">
              Route mix
            </button>
            .
          </>
        }
        icon={<Table2 />}
      >
        <DataTable<PathwayEconomics> columns={columns} dataSource={data.pathways} rowKey="id" pagination={false} refreshing={loading} />
      </Panel>
    </div>
  );
}
