'use client';

import React, { useState } from 'react';
import { Drawer, message } from 'antd';
import { Clock, Download, Package, Truck, Warehouse } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import { caseService } from '@/services/caseService';
import { EXPECTED_STATUS_LABEL, PRODUCT_CLASS_LABEL, productService, type ExpectedQuery, type ExpectedReturn, type ExpectedStatus } from '@/services/productService';
import { DataTable, ErrorState, KpiSkeletonRow, MetricCard, PageActions, StatusBadge, type DataColumn } from '@/components/ui';
import { downloadCsv } from '@/components/analytics/AnalyticsControls';
import { Card, CardTitle, ProductHeader, ClearFilters, FilterPick, FilterRow, ListPagination, MoreFilters, SearchBox, useUrlFilters } from '@/components/product/ui';
import type { Tone } from '@/theme/tokens';
import { date, dateTime, money, pct } from '@/utils/format';

const PAGE_SIZE = 10;
const STATUS_TONE: Record<ExpectedStatus, Tone> = { in_transit: 'info', scheduled: 'neutral', customs_hold: 'warning', staged: 'success' };

export default function ExpectedReturnsPage() {
  const { scope } = useAuth();
  const meta = caseService.meta();
  const [search, setSearch] = useState('');
  const [site, setSite] = useState('all');
  const [status, setStatus] = useState('all');
  const [productClass, setProductClass] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);

  useUrlFilters({ q: search, site, status, cls: productClass, page }, (p) => {
    setSearch(p.get('q') ?? '');
    setSite(p.get('site') ?? 'all');
    setStatus(p.get('status') ?? 'all');
    setProductClass(p.get('cls') ?? 'all');
    setPage(Number(p.get('page')) || 1);
  });

  const query: ExpectedQuery = {
    search,
    site: site === 'all' ? undefined : site,
    status: status as ExpectedStatus | 'all',
    productClass: productClass === 'all' ? undefined : productClass,
  };
  const scopeKey = [scope.tenant, scope.site];
  const listQ = useServiceQuery(() => productService.expected.list({ ...query, page, pageSize: PAGE_SIZE }, scope), [query, page, scopeKey], {
    subscribe: productService.expected.subscribe,
  });
  const summaryQ = useServiceQuery(() => productService.expected.summary(scope), [scopeKey], { subscribe: productService.expected.subscribe });

  const withReset = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };
  const filtered = search !== '' || site !== 'all' || status !== 'all' || productClass !== 'all';
  const clear = () => {
    setSearch('');
    setSite('all');
    setStatus('all');
    setProductClass('all');
    setPage(1);
  };

  const assignBay = async (r: ExpectedReturn) => {
    setAssigning(r.id);
    try {
      const next = await productService.expected.assignBay(r.id);
      message.success(`${next.id}: ${next.bay} reserved at ${next.site}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not assign a bay');
    } finally {
      setAssigning(null);
    }
  };

  const exportCsv = async () => {
    const { items } = await productService.expected.list(query, scope);
    downloadCsv(
      `expected-returns-${meta.asOf.slice(0, 10)}.csv`,
      ['ASN', 'Tenant', 'Equipment', 'Class', 'Quantity', 'Est. delivery', 'Destination', 'Carrier', 'Source', 'Contract', 'Est. value ($)', 'Status', 'Bay'],
      items.map((r) => [r.id, r.tenant, r.equipment, r.category, r.quantity, r.expectedDate, r.site, r.carrier, r.source, r.contractRef, r.estimatedValue, EXPECTED_STATUS_LABEL[r.status], r.bay ?? '']),
    );
    message.success(`Exported ${items.length} shipments (CSV)`);
  };

  const bayButton = (r: ExpectedReturn) =>
    r.bay ? (
      <span className="font-mono text-[11px] font-semibold text-[#059669]">{r.bay}</span>
    ) : (
      <button
        type="button"
        disabled={assigning === r.id}
        onClick={(e) => {
          e.stopPropagation();
          assignBay(r);
        }}
        className="cursor-pointer whitespace-nowrap bg-transparent p-0 text-xs font-semibold text-[#0369A1] underline-offset-2 hover:underline disabled:opacity-50"
      >
        {assigning === r.id ? 'Assigning…' : 'Assign Bay'}
      </button>
    );

  const columns: DataColumn<ExpectedReturn>[] = [
    {
      title: 'ASN / Expected Equipment',
      key: 'asn',
      priority: 1,
      ellipsis: false,
      render: (_: unknown, r: ExpectedReturn) => (
        <div className="min-w-0">
          <div className="font-mono font-bold text-[#141416]">{r.id}</div>
          <div className="text-[#141416]">{r.equipment}</div>
        </div>
      ),
    },
    {
      title: 'Customer Tenant',
      key: 'tenant',
      priority: 2,
      width: 160,
      render: (_: unknown, r: ExpectedReturn) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-[#141416]">{r.tenant}</div>
        </div>
      ),
    },
    {
      title: 'Quantity',
      key: 'qty',
      dataIndex: 'quantity',
      priority: 3,
      width: 90,
      render: (v: number) => <span className="font-mono font-bold text-[#0F172A]">{v} units</span>,
    },
    {
      title: 'Est. Delivery',
      key: 'eta',
      priority: 2,
      width: 150,
      render: (_: unknown, r: ExpectedReturn) => (
        <div className="min-w-0">
          <div className="font-mono text-[#475569]">{date(r.expectedDate, true)}</div>
          <div className="truncate text-[11px] text-[#64748B]">to {r.site}</div>
        </div>
      ),
    },
    {
      title: 'Est. Value',
      key: 'value',
      dataIndex: 'estimatedValue',
      priority: 3,
      align: 'right',
      width: 100,
      render: (v: number) => <span className="font-mono font-bold text-emerald-700">{money(v)}</span>,
    },
    {
      title: 'Logistics Status',
      key: 'status',
      priority: 1,
      width: 140,
      render: (_: unknown, r: ExpectedReturn) => <StatusBadge tone={STATUS_TONE[r.status]}>{EXPECTED_STATUS_LABEL[r.status]}</StatusBadge>,
    },
    {
      title: 'Bay',
      key: 'bay',
      priority: 2,
      width: 110,
      align: 'right',
      render: (_: unknown, r: ExpectedReturn) => bayButton(r),
    },
  ];

  const sm = summaryQ.data;
  const selected = listQ.data?.items.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <ProductHeader
        title="Expected Inbound Returns"
        description="Advance shipping notices and end-of-lease returns scheduled for warehouse intake and triage."
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
          <MetricCard label="Expected Inbound" value={sm.units} unit="units" icon={<Package />} context={`Across ${sm.asns} ASNs`} />
          <MetricCard
            label="In-Transit Freight"
            value={sm.inTransitUnits}
            unit="units"
            icon={<Truck />}
            iconTone="blue"
            context={`${sm.inTransitShipments} shipments en route`}
          />
          <MetricCard
            label="Bay Readiness"
            value={sm.dueSoon ? pct(sm.dueSoonWithBay / sm.dueSoon) : '—'}
            icon={<Clock />}
            context={`${sm.dueSoonWithBay} of ${sm.dueSoon} arriving within 7 days have a bay`}
          />
        </div>
      )}

      <Card>
        <CardTitle title="Scheduled Intake Log" />
        <FilterRow>
          <SearchBox value={search} onChange={withReset(setSearch)} placeholder="Search ASN, tenant, equipment or carrier" />
          {!scope.site && (
            <FilterPick
              value={site}
              onChange={withReset(setSite)}
              label="Destination"
              options={[{ value: 'all', label: 'All Destinations' }, ...meta.sites.map((s) => ({ value: s, label: s }))]}
            />
          )}
          <FilterPick
            value={status}
            onChange={withReset(setStatus)}
            label="Freight status"
            options={[{ value: 'all', label: 'All Freight Statuses' }, ...Object.entries(EXPECTED_STATUS_LABEL).map(([value, label]) => ({ value, label }))]}
          />
          <MoreFilters active={productClass !== 'all' ? 1 : 0}>
            <FilterPick
              value={productClass}
              onChange={withReset(setProductClass)}
              label="Equipment class"
              options={[{ value: 'all', label: 'All equipment classes' }, ...Object.entries(PRODUCT_CLASS_LABEL).map(([value, label]) => ({ value, label }))]}
            />
          </MoreFilters>
          <ClearFilters onClick={clear} disabled={!filtered} />
        </FilterRow>

        <div className="pt-4">
          {listQ.error && !listQ.data ? (
            <ErrorState onRetry={listQ.refetch} compact />
          ) : (
            <>
              <DataTable<ExpectedReturn>
                rowKey="id"
                columns={columns}
                dataSource={listQ.data?.items ?? []}
                initialLoading={listQ.initialLoading}
                refreshing={listQ.loading}
                filtered={filtered}
                onClearFilters={clear}
                emptyTitle="No inbound returns scheduled"
                onRowClick={(r) => setSelectedId(r.id)}
                rowClassName="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#141416]"
                onRow={(r) => ({
                  tabIndex: 0,
                  'aria-label': `Show shipment ${r.id}`,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      setSelectedId(r.id);
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
        open={!!selected}
        onClose={() => setSelectedId(null)}
        size={460}
        title={selected && <span className="font-mono text-sm font-bold">{selected.id}</span>}
        extra={selected && <StatusBadge tone={STATUS_TONE[selected.status]}>{EXPECTED_STATUS_LABEL[selected.status]}</StatusBadge>}
      >
        {selected && (
          <div className="space-y-5 text-xs">
            <div>
              <div className="text-sm font-extrabold text-[#141416]">{selected.equipment}</div>
              <div className="text-[#64748B]">
                {selected.category} · {selected.quantity} units · {money(selected.unitValue)} per unit
              </div>
            </div>
            <dl className="m-0 divide-y divide-[#F1F5F9]">
              {[
                ['Customer tenant', selected.tenant],
                ['Destination', selected.site],
                ['Est. delivery', date(selected.expectedDate, true)],
                ['Carrier', selected.carrier],
                ['Return source', selected.source],
                ['Contract', selected.contractRef],
                ['Est. value', money(selected.estimatedValue)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-2">
                  <dt className="text-[#64748B]">{k}</dt>
                  <dd className="m-0 text-right font-semibold text-[#141416]">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <div className="flex items-center gap-2">
                <Warehouse className="h-4 w-4 text-amber-500" />
                <span className="font-semibold">{selected.bay ? `Intake bay ${selected.bay}` : 'No intake bay reserved'}</span>
              </div>
              {!selected.bay && bayButton(selected)}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
