'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Drawer, Tabs, message } from 'antd';
import { ArrowRight, Download, Layers, Scale, Sparkles, TrendingUp, Target } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import { analyticsService, type PoolResult } from '@/services/analyticsService';
import { caseService } from '@/services/caseService';
import type { CaseRecord } from '@/models/domain.model';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import {
  DataTable,
  ErrorState,
  KpiSkeletonRow,
  ListSkeleton,
  MetricCard,
  PageActions,
  ProgressBar,
  StageBadge,
  StatusBadge,
  type DataColumn,
} from '@/components/ui';
import { downloadCsv, fmtMoney, fmtPct } from '@/components/analytics/AnalyticsControls';
import { useTabParam, useUrlParam } from '@/components/analytics/useTabParam';
import { POOL_STATUS_META as STATUS_META, PoolResultsTab, exportPoolEfficiency, poolCode } from '@/components/analytics/pools/PoolResultsTab';
import { Card, CardTitle, ProductHeader, ClearFilters, FilterPick, FilterRow, SearchBox } from '@/components/product/ui';
import { dateTime, money, pct } from '@/utils/format';

const TABS = ['allocations', 'results'] as const;
type TabKey = (typeof TABS)[number];

/** Same eligibility the optimizer uses (evidence complete, not written off). */
const POOL_STAGES: CaseRecord['stage'][] = ['awaiting_approval', 'approved', 'handed_off', 'reevaluate'];

/** Pool optimizer: allocations to act on (Allocations) and how well the optimizer did (Results, formerly Analytics › Pool efficiency). */
export default function PoolOptimizerPage() {
  const { scope } = useAuth();
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'allocations');
  const meta = caseService.meta();
  const tenant = scope.tenant ?? 'All';
  // Filters and tab each own one query parameter, so they never drop each other.
  const [search, setSearch] = useUrlParam('q', '');
  const [status, setStatus] = useUrlParam('status', 'all');
  const [poolId, setPoolId] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);

  const poolsQ = useServiceQuery(() => analyticsService.pools({ tenant }), [tenant], { subscribe: analyticsService.subscribe });
  const pool = poolsQ.data?.pools.find((p) => p.id === poolId) ?? null;
  const unitsQ = useServiceQuery(
    () => (pool ? caseService.list({ productClass: pool.productClass, sortBy: 'estimatedNetRecovery', sortDir: 'desc' }, { tenant: scope.tenant }) : Promise.resolve(null)),
    [pool?.productClass, scope.tenant],
    { subscribe: caseService.subscribe },
  );
  const units = (unitsQ.data?.items ?? []).filter((c) => POOL_STAGES.includes(c.stage));
  const approvedUnits = units.filter((c) => c.stage === 'approved');

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (poolsQ.data?.pools ?? []).filter((p) => (status === 'all' || p.status === status) && (!term || p.name.toLowerCase().includes(term)));
  }, [poolsQ.data, search, status]);

  const filtered = search !== '' || status !== 'all';
  const clear = () => {
    setSearch('');
    setStatus('all');
  };

  const resolve = () => {
    poolsQ.refetch();
    message.success('Allocations re-solved');
  };

  const exportCsv = () => {
    if (tab === 'results') {
      exportPoolEfficiency(rows, tenant);
      return;
    }
    downloadCsv(
      `pool-allocations-${tenant.replace(/\s+/g, '-').toLowerCase()}.csv`,
      ['Equipment class', 'Available', 'Demand', 'Allocated redeploy', 'Allocated resale', 'Unmet', 'Fulfilment (%)', 'Net value ($)', 'Status'],
      rows.map((p) => [p.name, p.available, p.demand, p.allocatedRedeploy, p.allocatedResale, p.unmet, (p.fulfilment * 100).toFixed(1), p.optimalValue, STATUS_META[p.status].label]),
    );
    message.success(`Exported ${rows.length} pools (CSV)`);
  };

  const handOff = async () => {
    setHandingOff(true);
    try {
      for (const c of approvedUnits) await caseService.updateStage(c.id, 'handed_off');
      message.success(`${approvedUnits.length} approved units handed off to execution`);
    } finally {
      setHandingOff(false);
    }
  };

  const columns: DataColumn<PoolResult>[] = [
    {
      title: 'Equipment Class',
      key: 'name',
      priority: 1,
      ellipsis: false,
      render: (_: unknown, p: PoolResult) => (
        <div className="min-w-0">
          <div className="font-bold text-[#141416]">{p.name}</div>
          <StatusBadge tone={STATUS_META[p.status].tone}>{STATUS_META[p.status].label}</StatusBadge>
        </div>
      ),
    },
    {
      title: 'Available Inventory',
      key: 'available',
      dataIndex: 'available',
      priority: 2,
      width: 110,
      render: (v: number) => <span className="font-mono font-bold text-[#0F172A]">{v} units</span>,
    },
    {
      title: 'Competing Demand',
      key: 'demand',
      priority: 3,
      width: 150,
      render: (_: unknown, p: PoolResult) => (
        <div>
          <span className="font-mono text-[#64748B]">{p.demand} units</span>
          <div className="text-[11px] text-[#94A3B8]">
            {p.internalDemand} internal · {p.externalDemand} resale
          </div>
        </div>
      ),
    },
    {
      title: 'Demand Fulfillment',
      key: 'fulfilment',
      priority: 1,
      width: 140,
      render: (_: unknown, p: PoolResult) => (
        <ProgressBar value={p.fulfilment * 100} tone={p.fulfilment >= 1 ? 'success' : 'warning'} label={`${p.name} demand fulfilment`} showValue />
      ),
    },
    {
      title: 'Optimal Allocation',
      key: 'allocation',
      priority: 3,
      width: 180,
      render: (_: unknown, p: PoolResult) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-800">{p.allocatedRedeploy} Redeploy</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">{p.allocatedResale} Resale</span>
        </div>
      ),
    },
    {
      title: 'Net Value Created',
      key: 'value',
      dataIndex: 'optimalValue',
      priority: 1,
      align: 'right',
      width: 120,
      render: (v: number) => <span className="font-mono font-bold text-emerald-700">{money(v)}</span>,
    },
  ];

  const k = poolsQ.data?.kpis;

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <ProductHeader
        title="Pool optimizer"
        description="Allocates evidence-complete inventory between internal plant requisitions and secondary-market resale, internal demand first, and shows how that compares with first come, first served."
        actions={
          <PageActions
            primary={{ key: 'resolve', label: 'Re-solve allocations', icon: <Sparkles />, onClick: resolve, disabled: poolsQ.loading }}
            secondary={[{ key: 'export', label: tab === 'results' ? 'Export results' : 'Export allocations', icon: <Download />, onClick: exportCsv, disabled: !poolsQ.data }]}
            meta={`${tenant === 'All' ? 'All tenants' : tenant} · as of ${dateTime(meta.asOf)}`}
          />
        }
      />

      {poolsQ.initialLoading || !k || !poolsQ.data ? (
        <KpiSkeletonRow count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Allocation rate" value={fmtPct(k.allocationRate, 1)} icon={<Scale />} context={`${k.allocated} of ${k.available} available units allocated`} />
          <MetricCard
            label="Mean fulfilment"
            value={pct(k.demand ? k.allocated / k.demand : 1, 1)}
            icon={<Target />}
            iconTone="blue"
            context={`${k.allocated} of ${k.demand} requested units allocated · ${k.unmet} unmet`}
          />
          <MetricCard
            label="Value captured"
            value={fmtMoney(k.optimalValue)}
            icon={<TrendingUp />}
            iconTone="green"
            trend={
              <span className="text-[11px] font-semibold text-[#059669]">
                +{fmtPct(k.uplift, 1)} vs first come, first served ({fmtMoney(k.greedyValue)})
              </span>
            }
          />
          <MetricCard
            label="Pools in shortfall"
            value={`${poolsQ.data.pools.filter((p) => p.status === 'shortfall').length} of ${poolsQ.data.pools.length}`}
            icon={<Layers />}
            context={
              poolsQ.data.pools
                .filter((p) => p.status === 'shortfall')
                .map((p) => poolCode(p.name))
                .join(', ') || 'Every pool can meet its demand'
            }
          />
        </div>
      )}

      {/* One filter row for both tabs. */}
      <FilterRow>
        <SearchBox value={search} onChange={setSearch} placeholder="Search by equipment class" />
        <FilterPick
          value={status}
          onChange={setStatus}
          label="Pool status"
          options={[{ value: 'all', label: 'All pool statuses' }, ...Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }))]}
        />
        <ClearFilters onClick={clear} disabled={!filtered} />
      </FilterRow>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden
        items={[
          {
            key: 'allocations',
            label: 'Allocations',
            children: (
              <Card>
                <CardTitle title="Optimized Pool Allocations" description="Select a pool to see its units and hand approved ones off to execution." />
                <div className="pt-2">
                  {poolsQ.error && !poolsQ.data ? (
                    <ErrorState onRetry={poolsQ.refetch} compact />
                  ) : (
                    <DataTable<PoolResult>
                      rowKey="id"
                      columns={columns}
                      dataSource={rows}
                      initialLoading={poolsQ.initialLoading}
                      refreshing={poolsQ.loading}
                      filtered={filtered}
                      onClearFilters={clear}
                      onRowClick={(p) => setPoolId(p.id)}
                      rowClassName="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#141416]"
                      onRow={(p) => ({
                        tabIndex: 0,
                        'aria-label': `Show pool ${p.name}`,
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            setPoolId(p.id);
                          }
                        },
                      })}
                      pagination={false}
                    />
                  )}
                </div>
              </Card>
            ),
          },
          {
            key: 'results',
            label: 'Results',
            children: poolsQ.error && !poolsQ.data ? (
              <ErrorState onRetry={poolsQ.refetch} />
            ) : (
              <PoolResultsTab rows={rows} ready={!!poolsQ.data} loading={poolsQ.loading} filtered={filtered} onClearFilters={clear} />
            ),
          },
        ]}
      />

      <Drawer
        open={!!pool}
        onClose={() => setPoolId(null)}
        size={480}
        title={pool && <span className="text-sm font-bold">{pool.name}</span>}
        extra={pool && <StatusBadge tone={STATUS_META[pool.status].tone}>{STATUS_META[pool.status].label}</StatusBadge>}
      >
        {pool && (
          <div className="space-y-5 text-xs">
            <p className="m-0 text-[#475569]">
              Demand {pool.demand} units ({pool.internalDemand} internal, {pool.externalDemand} resale). {pool.allocated} of {pool.available} available units allocated ({pool.allocatedRedeploy} redeploy, {pool.allocatedResale} resale)
              {pool.unmet > 0 ? `; ${pool.unmet} requested units cannot be met.` : '.'}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <span className="font-semibold">{approvedUnits.length} approved units ready for hand-off</span>
              <button
                type="button"
                disabled={!approvedUnits.length || handingOff}
                onClick={handOff}
                className="cursor-pointer rounded-lg bg-[#FFD600] px-3 py-1 text-xs font-bold text-[#141416] shadow-2xs hover:bg-[#FACC15] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {handingOff ? 'Handing off…' : 'Hand off approved'}
              </button>
            </div>
            {unitsQ.initialLoading || unitsQ.data === undefined ? (
              <ListSkeleton rows={5} />
            ) : (
              <ul className="m-0 list-none divide-y divide-[#F1F5F9] p-0">
                {units.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/product/case/${c.id}`} className="font-mono font-bold text-[#141416] hover:underline">
                        {c.id}
                      </Link>
                      <div className="truncate text-[11px] text-[#64748B]">
                        {c.productName} · {DISPOSITION_ROUTES[c.recommendedRoute].shortLabel}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <StageBadge stage={c.stage} />
                      <div className="mt-0.5 font-mono text-[11px] text-emerald-700">{money(c.estimatedNetRecovery)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => {
                setPoolId(null);
                setTab('results');
              }}
              className="inline-flex cursor-pointer items-center gap-1 bg-transparent p-0 text-xs font-semibold text-[#141416] hover:underline"
            >
              Allocation results <ArrowRight size={12} />
            </button>
          </div>
        )}
      </Drawer>
    </div>
  );
}
