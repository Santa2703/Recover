'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { message } from 'antd';
import type { SorterResult } from 'antd/es/table/interface';
import { AlertTriangle, ChevronRight, Clock, Download, Package } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import { caseService, type CaseQuery } from '@/services/caseService';
import { CONDITION_LABEL, PRODUCT_CLASS_LABEL, productService } from '@/services/productService';
import type { CaseRecord, CaseStageId } from '@/models/domain.model';
import type { DispositionRouteId } from '@/models/treatment.model';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import { DataTable, ErrorState, KpiSkeletonRow, MetricCard, PageActions, StageBadge, STAGE_META, type DataColumn } from '@/components/ui';
import { rememberQueue } from '@/components/product/queueContext';
import { downloadCsv } from '@/components/analytics/AnalyticsControls';
import { Card, ProductHeader, ClearFilters, FilterPick, FilterRow, ListPagination, MoreFilters, SearchBox, useUrlFilters } from '@/components/product/ui';
import { dateTime, money, moneyK } from '@/utils/format';

const PAGE_SIZE = 10;
type SortKey = 'dueInDays' | 'estimatedNetRecovery' | 'residualLifeMonths' | 'receivedDate';

const GRADE_CLS: Record<CaseRecord['condition'], string> = {
  A: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  B: 'bg-blue-50 text-blue-800 border-blue-200',
  C: 'bg-amber-50 text-amber-800 border-amber-200',
  D: 'bg-rose-50 text-rose-800 border-rose-200',
  Scrap: 'bg-slate-100 text-slate-700 border-slate-200',
};

export default function ReturnedAssetsPage() {
  const router = useRouter();
  const { scope } = useAuth();
  const meta = caseService.meta();

  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('all');
  const [productClass, setProductClass] = useState('all');
  const [stage, setStage] = useState('all');
  const [route, setRoute] = useState('all');
  const [priority, setPriority] = useState('all');
  const [sortBy, setSortBy] = useState<SortKey>('dueInDays');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const sortParam = sortBy === 'dueInDays' && sortDir === 'asc' ? '' : `${sortBy}:${sortDir}`;
  useUrlFilters({ q: search, site: location, cls: productClass, stage, route, priority, sort: sortParam, page }, (p) => {
    setSearch(p.get('q') ?? '');
    setLocation(p.get('site') ?? 'all');
    setProductClass(p.get('cls') ?? 'all');
    setStage(p.get('stage') ?? 'all');
    setRoute(p.get('route') ?? 'all');
    setPriority(p.get('priority') ?? 'all');
    const [sb, sd] = (p.get('sort') ?? '').split(':');
    if (sb) setSortBy(sb as SortKey);
    if (sd === 'asc' || sd === 'desc') setSortDir(sd);
    setPage(Number(p.get('page')) || 1);
  });

  const query: CaseQuery = {
    search,
    location: location === 'all' ? undefined : location,
    productClass: productClass === 'all' ? undefined : productClass,
    stage: stage as CaseStageId | 'all',
    route: route as DispositionRouteId | 'all',
    priority: priority === 'all' ? undefined : priority,
    sortBy,
    sortDir,
  };
  const scopeKey = [scope.tenant, scope.site];

  const listQ = useServiceQuery(() => caseService.list({ ...query, page, pageSize: PAGE_SIZE }, scope), [query, page, scopeKey], {
    subscribe: caseService.subscribe,
  });
  const summaryQ = useServiceQuery(() => productService.receivedSummary(scope), [scopeKey], { subscribe: caseService.subscribe });

  const withReset = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };
  const filtered = search !== '' || location !== 'all' || productClass !== 'all' || stage !== 'all' || route !== 'all' || priority !== 'all';
  const clear = () => {
    setSearch('');
    setLocation('all');
    setProductClass('all');
    setStage('all');
    setRoute('all');
    setPriority('all');
    setPage(1);
  };

  const exportCsv = async () => {
    const { items } = await caseService.list(query, scope);
    downloadCsv(
      `returned-assets-${meta.asOf.slice(0, 10)}.csv`,
      ['Case ID', 'Product', 'Serial', 'Asset tag', 'Equipment class', 'Grade', 'Residual (months)', 'Location', 'Tenant', 'Optimal route', 'Est. value ($)', 'Stage', 'Received', 'Due'],
      items.map((c) => [
        c.id,
        c.productName,
        c.serialNumber,
        c.assetTag,
        c.category,
        c.condition,
        c.residualLifeMonths,
        c.location,
        c.tenant,
        DISPOSITION_ROUTES[c.recommendedRoute].name,
        c.estimatedNetRecovery,
        STAGE_META[c.stage].label,
        c.receivedDate,
        c.dueDate,
      ]),
    );
    message.success(`Exported ${items.length} cases (CSV)`);
  };

  const sortOrder = (key: SortKey) => (sortBy === key ? (sortDir === 'asc' ? 'ascend' : 'descend') : null);

  // The Case page offers Back to Returned assets and Previous / Next over the cases on this page of the list.
  const fromQueue = () => rememberQueue('Returned assets', '/product/received', (listQ.data?.items ?? []).map((c) => c.id));

  const columns: DataColumn<CaseRecord>[] = [
    {
      title: 'Case / Equipment',
      key: 'case',
      priority: 1,
      ellipsis: false,
      render: (_: unknown, c: CaseRecord) => (
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <Link href={`/product/case/${c.id}`} tabIndex={-1} onClick={(e) => {
              e.stopPropagation();
              fromQueue();
            }} className="shrink-0 font-mono font-bold text-[#141416] hover:underline">
              {c.id}
            </Link>
            <span className="font-semibold text-[#141416]">{c.productName}</span>
          </div>
          <div className="text-[11px] text-[#64748B]">
            {c.category} · <span className="font-mono">{c.serialNumber}</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Grade / Residual',
      key: 'grade',
      dataIndex: 'residualLifeMonths',
      priority: 2,
      width: 140,
      sorter: true,
      sortOrder: sortOrder('residualLifeMonths'),
      render: (_: unknown, c: CaseRecord) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${GRADE_CLS[c.condition]}`} title={CONDITION_LABEL[c.condition]}>
            {c.condition === 'Scrap' ? 'Scrap' : `Grade ${c.condition}`}
          </span>
          <span className="font-mono text-[11px] text-[#475569]">{c.residualLifeMonths} mos</span>
        </div>
      ),
    },
    {
      title: 'Location & Tenant',
      key: 'location',
      priority: 3,
      width: 150,
      render: (_: unknown, c: CaseRecord) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-[#141416]">{c.location}</div>
          <div className="truncate text-[11px] text-[#64748B]">{c.tenant}</div>
        </div>
      ),
    },
    {
      title: 'Optimal Route',
      key: 'route',
      priority: 2,
      width: 130,
      render: (_: unknown, c: CaseRecord) => (
        <span className="rounded-full border border-[#E2E8F0] bg-[#F1F5F9] px-2.5 py-0.5 text-[11px] font-semibold text-[#1E293B]">
          {DISPOSITION_ROUTES[c.recommendedRoute].shortLabel}
        </span>
      ),
    },
    {
      title: 'Est. Value',
      key: 'value',
      dataIndex: 'estimatedNetRecovery',
      priority: 1,
      align: 'right',
      width: 110,
      sorter: true,
      sortOrder: sortOrder('estimatedNetRecovery'),
      render: (v: number) => <span className="font-mono text-xs font-bold text-emerald-700">{money(v)}</span>,
    },
    {
      title: 'Lifecycle Stage',
      key: 'stage',
      dataIndex: 'dueInDays',
      priority: 2,
      width: 170,
      sorter: true,
      sortOrder: sortOrder('dueInDays'),
      render: (_: unknown, c: CaseRecord) => (
        <div className="min-w-0">
          <StageBadge stage={c.stage} />
          <div className={`mt-0.5 text-[11px] ${c.dueInDays < 0 ? 'font-semibold text-[#DC2626]' : 'text-[#64748B]'}`}>
            {c.dueInDays < 0 ? `${Math.abs(c.dueInDays)}d overdue` : c.dueInDays === 0 ? 'Due today' : `Due in ${c.dueInDays}d`}
          </div>
        </div>
      ),
    },
    {
      title: '',
      key: 'open',
      priority: 2,
      width: 40,
      align: 'right',
      render: () => <ChevronRight size={16} aria-hidden className="text-[#94A3B8]" />,
    },
  ];

  const onTableChange = (_p: unknown, _f: unknown, sorter: SorterResult<CaseRecord> | SorterResult<CaseRecord>[]) => {
    const s = Array.isArray(sorter) ? sorter[0] : sorter;
    const key = (s?.column?.dataIndex as SortKey | undefined) ?? 'dueInDays';
    if (!s?.order) {
      setSortBy('dueInDays');
      setSortDir('asc');
    } else {
      setSortBy(key);
      setSortDir(s.order === 'ascend' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const sm = summaryQ.data;
  const moreActive = [stage, route, priority].filter((v) => v !== 'all').length + (sortBy !== 'dueInDays' || sortDir !== 'asc' ? 1 : 0);

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <ProductHeader
        title="Returned Assets Queue"
        description="Returned assets awaiting or undergoing disposition triage. Select a case to open its decision workspace."
        actions={
          <PageActions
            secondary={[{ key: 'export', label: 'Export CSV', icon: <Download />, onClick: exportCsv }]}
            meta={`As of ${dateTime(meta.asOf)}`}
          />
        }
      />

      {summaryQ.initialLoading || !sm ? (
        <KpiSkeletonRow count={3} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard label="Total Inbound Returns" value={sm.total} icon={<Package />} context={`${moneyK(sm.totalValue)} potential value`} />
          <MetricCard
            label="Awaiting Plan Approval"
            value={sm.awaitingApproval}
            icon={<AlertTriangle />}
            context={`${moneyK(sm.awaitingValue)} value retention`}
            href="/command/actions?tab=approvals"
          />
          <MetricCard label="Avg. Days in Triage" value={sm.avgTriageDays} unit="days" icon={<Clock />} iconTone="green" context={`${sm.inTriage} cases still awaiting inspection or information`} />
        </div>
      )}

      <Card>
        <FilterRow>
          <SearchBox value={search} onChange={withReset(setSearch)} placeholder="Search case ID, serial, product or owner" />
          {!scope.site && (
            <FilterPick
              value={location}
              onChange={withReset(setLocation)}
              label="Facility"
              options={[{ value: 'all', label: 'All Facilities' }, ...meta.sites.map((s) => ({ value: s, label: s }))]}
            />
          )}
          <FilterPick
            value={productClass}
            onChange={withReset(setProductClass)}
            label="Equipment class"
            options={[{ value: 'all', label: 'All Equipment Classes' }, ...Object.entries(PRODUCT_CLASS_LABEL).map(([value, label]) => ({ value, label }))]}
          />
          <MoreFilters active={moreActive}>
            <FilterPick
              value={stage}
              onChange={withReset(setStage)}
              label="Lifecycle stage"
              options={[{ value: 'all', label: 'All stages' }, ...Object.entries(STAGE_META).map(([value, m]) => ({ value, label: m.label }))]}
            />
            <FilterPick
              value={route}
              onChange={withReset(setRoute)}
              label="Optimal route"
              options={[{ value: 'all', label: 'All routes' }, ...Object.values(DISPOSITION_ROUTES).map((r) => ({ value: r.id, label: r.name }))]}
            />
            <FilterPick
              value={priority}
              onChange={withReset(setPriority)}
              label="Priority"
              options={[
                { value: 'all', label: 'All priorities' },
                { value: 'high', label: 'High priority' },
                { value: 'medium', label: 'Medium priority' },
                { value: 'low', label: 'Low priority' },
              ]}
            />
            <FilterPick
              value={`${sortBy}:${sortDir}`}
              onChange={(v) => {
                const [sb, sd] = v.split(':');
                setSortBy(sb as SortKey);
                setSortDir(sd as 'asc' | 'desc');
                setPage(1);
              }}
              label="Sort"
              options={[
                { value: 'dueInDays:asc', label: 'Sort: due soonest' },
                { value: 'estimatedNetRecovery:desc', label: 'Sort: highest value' },
                { value: 'residualLifeMonths:desc', label: 'Sort: most residual life' },
                { value: 'receivedDate:desc', label: 'Sort: newest received' },
              ]}
            />
          </MoreFilters>
          <ClearFilters onClick={clear} disabled={!filtered} />
        </FilterRow>

        <div className="pt-4">
          <p className="sr-only">Select a row, or focus it and press Enter, to open the case.</p>
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
                emptyTitle="No returned assets in your scope"
                onRowClick={(c) => {
                  fromQueue();
                  router.push(`/product/case/${c.id}`);
                }}
                rowClassName="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#141416]"
                onRow={(c) => ({
                  tabIndex: 0,
                  'aria-label': `Open case ${c.id}, ${c.productName}`,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      fromQueue();
                      router.push(`/product/case/${c.id}`);
                    }
                  },
                })}
                pagination={false}
                onChange={(p, f, s) => onTableChange(p, f, s)}
              />
              {listQ.data && <ListPagination page={listQ.data.page} pageSize={PAGE_SIZE} total={listQ.data.total} onChange={setPage} />}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
