'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Drawer, message } from 'antd';
import { ArrowRight, Download, Layers, ShieldCheck, TrendingUp } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import { caseService, type CaseQuery } from '@/services/caseService';
import { PRODUCT_CLASS_LABEL, assetSignals, productService, type TelemetryStatus } from '@/services/productService';
import type { CaseRecord } from '@/models/domain.model';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import {
  ChartSkeleton,
  DataTable,
  EmptyState,
  ErrorState,
  KpiSkeletonRow,
  MetricCard,
  PageActions,
  ProgressBar,
  StatusBadge,
  type DataColumn,
} from '@/components/ui';
import { downloadCsv } from '@/components/analytics/AnalyticsControls';
import { AssetCondition } from '@/components/product/AssetCondition';
import { SimilarAssets } from '@/components/product/SimilarAssets';
import { Card, CardTitle, ProductHeader, ClearFilters, FilterPick, FilterRow, ListPagination, SearchBox, useUrlFilters } from '@/components/product/ui';
import type { Tone } from '@/theme/tokens';
import { dateTime, money, num, pct } from '@/utils/format';

const PAGE_SIZE = 10;
const TELEMETRY: Record<TelemetryStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active telemetry', tone: 'success' },
  stale: { label: 'Telemetry stale', tone: 'warning' },
  end_of_life: { label: 'End of life', tone: 'neutral' },
};
const scoreTone = (s: number): Tone => (s > 75 ? 'success' : s > 50 ? 'warning' : 'danger');

export default function AssetIntelligencePage() {
  const { scope } = useAuth();
  const meta = caseService.meta();
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState('all');
  const [page, setPage] = useState(1);
  const [assetId, setAssetId] = useState<string | null>(null);

  useUrlFilters({ q: search, cls: family, page, asset: assetId ?? '' }, (p) => {
    setSearch(p.get('q') ?? '');
    setFamily(p.get('cls') ?? 'all');
    setPage(Number(p.get('page')) || 1);
    setAssetId(p.get('asset') || null);
  });

  const query: CaseQuery = { search, productClass: family === 'all' ? undefined : family, sortBy: 'id', sortDir: 'asc' };
  const scopeKey = [scope.tenant, scope.site];
  const listQ = useServiceQuery(() => caseService.list({ ...query, page, pageSize: PAGE_SIZE }, scope), [query, page, scopeKey], {
    subscribe: caseService.subscribe,
  });
  const summaryQ = useServiceQuery(() => productService.intelligenceSummary(scope), [scopeKey], { subscribe: caseService.subscribe });
  const assetQ = useServiceQuery(() => (assetId ? productService.asset(assetId) : Promise.resolve(undefined)), [assetId], {
    subscribe: caseService.subscribe,
  });

  const filtered = search !== '' || family !== 'all';
  const clear = () => {
    setSearch('');
    setFamily('all');
    setPage(1);
  };

  const exportCsv = async () => {
    const { items } = await caseService.list(query, scope);
    downloadCsv(
      `asset-intelligence-${meta.asOf.slice(0, 10)}.csv`,
      ['Case ID', 'Model', 'Serial', 'Family', 'Condition score', 'Operating hours', 'Recommended route', 'Est. value ($)', 'Confidence (%)', 'Telemetry'],
      items.map((c) => {
        const s = assetSignals(c);
        return [c.id, c.productName, c.serialNumber, c.category, s.conditionScore, s.operatingHours, DISPOSITION_ROUTES[c.recommendedRoute].name, c.estimatedNetRecovery, s.confidence, TELEMETRY[s.telemetry].label];
      }),
    );
    message.success(`Exported ${items.length} assets (CSV)`);
  };

  const columns: DataColumn<CaseRecord>[] = [
    {
      title: 'Asset ID & Model',
      key: 'asset',
      priority: 1,
      ellipsis: false,
      render: (_: unknown, c: CaseRecord) => (
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className="shrink-0 font-mono font-bold text-[#141416]">{c.id}</span>
            <span className="font-semibold text-[#0F172A]">{c.productName}</span>
          </div>
          <div className="font-mono text-[11px] text-[#94A3B8]">
            {c.serialNumber} · {c.category}
          </div>
        </div>
      ),
    },
    {
      title: 'Condition Score',
      key: 'score',
      priority: 2,
      width: 150,
      render: (_: unknown, c: CaseRecord) => {
        const s = assetSignals(c);
        return <ProgressBar value={s.conditionScore} tone={scoreTone(s.conditionScore)} label={`${c.id} condition score`} showValue />;
      },
    },
    {
      title: 'Operating Age',
      key: 'age',
      priority: 3,
      width: 120,
      render: (_: unknown, c: CaseRecord) => (
        <div>
          <span className="font-mono text-[#0F172A]">{num(assetSignals(c).operatingHours)} hrs</span>
          <div className="text-[11px] text-[#64748B]">{c.facts.ageYears} yrs</div>
        </div>
      ),
    },
    {
      title: 'Recommended Route',
      key: 'route',
      priority: 2,
      width: 160,
      render: (_: unknown, c: CaseRecord) => (
        <span className="rounded-full border border-[#E2E8F0] bg-[#F1F5F9] px-2.5 py-0.5 text-[11px] font-semibold text-[#1E293B]">
          {DISPOSITION_ROUTES[c.recommendedRoute].shortLabel}
        </span>
      ),
    },
    {
      title: 'Est. Value',
      key: 'value',
      priority: 1,
      align: 'right',
      width: 120,
      render: (_: unknown, c: CaseRecord) => (
        <div className="text-right">
          <span className="font-mono font-bold text-emerald-700">{money(c.estimatedNetRecovery)}</span>
          <div className="text-[10px] font-semibold text-[#64748B]">{assetSignals(c).confidence}% confidence</div>
        </div>
      ),
    },
    {
      title: 'Telemetry',
      key: 'telemetry',
      priority: 3,
      width: 140,
      render: (_: unknown, c: CaseRecord) => {
        const t = TELEMETRY[assetSignals(c).telemetry];
        return <StatusBadge tone={t.tone}>{t.label}</StatusBadge>;
      },
    },
  ];

  const sm = summaryQ.data;
  const asset = assetQ.data?.record.id === assetId ? assetQ.data : undefined;

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <ProductHeader
        title="Asset Intelligence"
        description="Condition trends, bill of materials and residual valuation for every returned asset. Select an asset for its digital twin."
        actions={<PageActions secondary={[{ key: 'export', label: 'Export CSV', icon: <Download />, onClick: exportCsv }]} meta={`As of ${dateTime(meta.asOf)}`} />}
      />

      {summaryQ.initialLoading || !sm ? (
        <KpiSkeletonRow count={3} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard label="Avg. Est. Value" value={money(sm.avgRecovery)} icon={<TrendingUp />} iconTone="green" context="Engine net recovery per asset" />
          <MetricCard label="Harvestable Components" value={num(sm.harvestable)} icon={<Layers />} iconTone="blue" context="Parts below 55% wear" />
          <MetricCard label="Provenance Verified" value={pct(sm.provenanceVerified, 1)} icon={<ShieldCheck />} context="Assets with 90%+ evidence complete" />
        </div>
      )}

      <Card>
        <CardTitle title="Asset Digital Twins" />
        <FilterRow>
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search by asset, serial or model"
          />
          <FilterPick
            value={family}
            onChange={(v) => {
              setFamily(v);
              setPage(1);
            }}
            label="Equipment family"
            options={[{ value: 'all', label: 'All Equipment Families' }, ...Object.entries(PRODUCT_CLASS_LABEL).map(([value, label]) => ({ value, label }))]}
          />
          <ClearFilters onClick={clear} disabled={!filtered} />
        </FilterRow>
        <div className="pt-4">
          {listQ.error && !listQ.data ? (
            <ErrorState onRetry={listQ.refetch} compact />
          ) : (
            <>
              <DataTable<CaseRecord>
                rowKey="id"
                columns={columns}
                dataSource={listQ.data?.items ?? []}
                initialLoading={listQ.initialLoading}
                refreshing={listQ.loading}
                filtered={filtered}
                onClearFilters={clear}
                onRowClick={(c) => setAssetId(c.id)}
                rowClassName="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#141416]"
                onRow={(c) => ({
                  tabIndex: 0,
                  'aria-label': `Show asset ${c.id}, ${c.productName}`,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      setAssetId(c.id);
                    }
                  },
                })}
                pagination={false}
              />
              {listQ.data && <ListPagination page={listQ.data.page} pageSize={PAGE_SIZE} total={listQ.data.total} onChange={setPage} />}
            </>
          )}
        </div>
      </Card>

      <Drawer
        open={!!assetId}
        onClose={() => setAssetId(null)}
        size={560}
        title={<span className="font-mono text-sm font-bold">{assetId}</span>}
        extra={
          asset && (
            <Link
              href={`/product/case/${asset.record.id}`}
              className="inline-flex items-center gap-1 rounded-lg bg-[#FFD600] px-3 py-1 text-xs font-bold text-[#141416] hover:bg-[#FACC15]"
            >
              Open case <ArrowRight size={12} />
            </Link>
          )
        }
      >
        {assetQ.loading && !asset ? (
          <ChartSkeleton height={180} />
        ) : !asset ? (
          <EmptyState title="Asset not found" description={`No returned asset with ID ${assetId}.`} />
        ) : (
          <div className="space-y-5">
            <div className="text-xs">
              <div className="text-sm font-extrabold text-[#141416]">{asset.record.productName}</div>
              <div className="text-[#64748B]">
                {asset.record.manufacturer} · <span className="font-mono">{asset.record.serialNumber}</span> · {asset.record.location}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusBadge tone={TELEMETRY[asset.detail.signals.telemetry].tone}>{TELEMETRY[asset.detail.signals.telemetry].label}</StatusBadge>
                <StatusBadge tone="neutral">
                  {DISPOSITION_ROUTES[asset.record.recommendedRoute].shortLabel} · {money(asset.record.estimatedNetRecovery)} est. value
                </StatusBadge>
              </div>
            </div>
            <AssetCondition record={asset.record} detail={asset.detail} compact />
            <SimilarAssets caseId={asset.record.id} scope={scope} onSelect={setAssetId} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
