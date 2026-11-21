'use client';

import React, { useMemo } from 'react';
import { message } from 'antd';
import { BarChart3, Layers } from 'lucide-react';
import type { PoolResult, PoolStatus } from '@/services/analyticsService';
import { chartColors } from '@/theme/tokens';
import { ChartSkeleton, DataTable, NoResultsState, Panel, ProgressBar, StatusBadge, TableSkeleton, type DataColumn } from '@/components/ui';
import { StackedBarChart } from '@/components/charts';
import { downloadCsv, fmtMoney, fmtPct } from '@/components/analytics/AnalyticsControls';

export const POOL_STATUS_META: Record<PoolStatus, { label: string; tone: 'danger' | 'success' | 'info' }> = {
  shortfall: { label: 'Shortfall', tone: 'danger' },
  balanced: { label: 'Balanced', tone: 'success' },
  surplus: { label: 'Surplus stock', tone: 'info' },
};

/** "Industrial Motor 75kW (MTR-75)" → "MTR-75" for compact chart axes. */
export const poolCode = (name: string) => name.match(/\(([^)]+)\)/)?.[1] ?? name;

export function exportPoolEfficiency(rows: PoolResult[], tenant: string) {
  downloadCsv(
    `pool-efficiency-${tenant.replace(/\s+/g, '-').toLowerCase()}.csv`,
    ['Pool', 'Available', 'Demand', 'Internal demand', 'External demand', 'Allocated', 'Redeploy', 'Resale', 'Unmet', 'Utilisation (%)', 'Fulfilment (%)', 'Optimised value ($)', 'First come, first served value ($)', 'Status'],
    rows.map((p) => [
      p.name,
      p.available,
      p.demand,
      p.internalDemand,
      p.externalDemand,
      p.allocated,
      p.allocatedRedeploy,
      p.allocatedResale,
      p.unmet,
      (p.utilisation * 100).toFixed(1),
      (p.fulfilment * 100).toFixed(1),
      p.optimalValue,
      p.greedyValue,
      POOL_STATUS_META[p.status].label,
    ]),
  );
  message.success('Pool efficiency exported (CSV)');
}

const columns: DataColumn<PoolResult>[] = [
  { title: 'Equipment class', dataIndex: 'name', key: 'name', priority: 1, render: (v: string) => <span className="text-xs font-bold text-[#141416]">{v}</span> },
  {
    title: 'Allocated',
    key: 'allocated',
    priority: 1,
    align: 'right',
    render: (_, p) => (
      <span className="font-mono text-xs">
        <span className="font-bold text-[#141416]">{p.allocated}</span>
        <span className="text-[#64748B]"> / {p.available} avail.</span>
      </span>
    ),
  },
  {
    title: 'Allocation',
    key: 'split',
    priority: 3,
    render: (_, p) => (
      <span className="text-xs text-[#475569]">
        {p.allocatedRedeploy} redeploy · {p.allocatedResale} resale
      </span>
    ),
  },
  {
    title: 'Utilisation',
    key: 'utilisation',
    priority: 3,
    width: 160,
    render: (_, p) => (
      <ProgressBar value={p.utilisation * 100} tone={p.utilisation >= 0.95 ? 'success' : p.utilisation >= 0.7 ? 'ink' : 'warning'} label={`${p.name} utilisation`} showValue />
    ),
  },
  {
    title: 'Value · gain',
    key: 'value',
    priority: 2,
    align: 'right',
    render: (_, p) => (
      <span className="font-mono text-xs">
        <span className="font-bold text-[#059669]">{fmtMoney(p.optimalValue)}</span>
        <span className="ml-1.5 text-[11px] text-[#64748B]" data-tip="Gain over first come, first served">
          +{fmtMoney(p.optimalValue - p.greedyValue)}
        </span>
      </span>
    ),
  },
  { title: 'Status', dataIndex: 'status', key: 'status', priority: 2, render: (s: PoolStatus) => <StatusBadge tone={POOL_STATUS_META[s].tone}>{POOL_STATUS_META[s].label}</StatusBadge> },
];

/**
 * Results of the pool allocation optimizer (formerly Analytics › Pool efficiency): allocated vs demand per pool,
 * and how the optimised allocation compares with first come, first served. Filters live on the page.
 */
export function PoolResultsTab({
  rows,
  ready,
  loading,
  filtered,
  onClearFilters,
}: {
  rows: PoolResult[];
  ready: boolean;
  loading: boolean;
  filtered: boolean;
  onClearFilters: () => void;
}) {
  const chartData = useMemo(() => rows.map((p) => ({ pool: poolCode(p.name), allocated: p.allocated, demand: p.demand })), [rows]);

  if (!ready) {
    return (
      <div className="space-y-6">
        <Panel title="Allocated vs demand by pool">
          <ChartSkeleton height={260} />
        </Panel>
        <Panel title="Pool results">
          <TableSkeleton rows={6} columns={6} />
        </Panel>
      </div>
    );
  }

  return (
    <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
      <Panel title="Allocated vs demand by pool" description="Units allocated by the optimizer against units requested (internal redeploy plus resale demand)." icon={<BarChart3 />}>
        {chartData.length ? (
          <StackedBarChart
            data={chartData}
            xKey="pool"
            grouped
            series={[
              { key: 'allocated', label: 'Allocated', color: chartColors.actual },
              { key: 'demand', label: 'Demand', color: chartColors.neutralSoft },
            ]}
            ariaLabel={`Allocated versus demand by pool: ${chartData.map((d) => `${d.pool} ${d.allocated} of ${d.demand}`).join(', ')}`}
            valueFormat={(v) => `${v}`}
            height={260}
          />
        ) : (
          <NoResultsState onClear={onClearFilters} compact />
        )}
      </Panel>

      <Panel
        title="Pool results"
        description="Available = evidence-complete cases in the class. The optimizer fills internal redeploy requests first, then resale. The comparison is first come, first served: units handed out in the order requests arrive. Expand a row for demand and fulfilment."
        icon={<Layers />}
      >
        {rows.length === 0 ? (
          <NoResultsState onClear={onClearFilters} compact />
        ) : (
          <DataTable<PoolResult>
            columns={columns}
            dataSource={rows}
            rowKey="id"
            pagination={false}
            refreshing={loading}
            filtered={filtered}
            onClearFilters={onClearFilters}
            expandable={{
              expandedRowRender: (p) => (
                <div className="grid grid-cols-2 gap-2 text-xs text-[#475569] sm:grid-cols-4">
                  <span>
                    Demand: <b className="text-[#141416]">{p.internalDemand} internal, {p.externalDemand} resale</b>
                  </span>
                  <span>
                    Fulfilment: <b className="text-[#141416]">{fmtPct(p.fulfilment, 0)}</b>
                  </span>
                  <span>
                    Unmet: <b className="text-[#141416]">{p.unmet}</b>
                  </span>
                  <span>
                    First come, first served: <b className="text-[#141416]">{fmtMoney(p.greedyValue)}</b>
                  </span>
                </div>
              ),
            }}
          />
        )}
      </Panel>
    </div>
  );
}
