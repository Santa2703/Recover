'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Drawer, Tabs, message } from 'antd';
import { CalendarClock, Clock, Download, FileText, Package, PackageCheck, Scale, Truck, Warehouse } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import { caseService } from '@/services/caseService';
import { intakeService } from '@/services/intakeService';
import { EXPECTED_STATUS_LABEL, PRODUCT_CLASS_LABEL, productService, type ExpectedQuery, type ExpectedReturn, type ExpectedStatus } from '@/services/productService';
import {
  CONTRACT_KIND_LABEL,
  CONTRACT_STATUS_LABEL,
  OUTCOME_LABEL,
  SIGNAL_LABEL,
  contractService,
  type ContractQuery,
  type ContractRow,
  type ContractStatus,
  type LikelyOutcome,
} from '@/services/contractService';
import { DataTable, ErrorState, KpiSkeletonRow, MetricCard, PageActions, StatusBadge, type DataColumn } from '@/components/ui';
import { SegmentedBar } from '@/components/charts';
import { downloadCsv } from '@/components/analytics/AnalyticsControls';
import { useTabExporter, useTabParam, type RegisterExport } from '@/components/analytics/useTabParam';
import { Card, CardTitle, ProductHeader, ClearFilters, FilterPick, FilterRow, ListPagination, MoreFilters, SearchBox, useUrlFilters } from '@/components/product/ui';
import { ReceiveAsnModal, useCanReceive } from '@/components/product/ReceiveAsnModal';
import { ReceivingPlan } from '@/components/product/ReceivingPlan';
import { seriesColors, type Tone } from '@/theme/tokens';
import { date, dateTime, money, moneyK, pct, relativeTime } from '@/utils/format';

const PAGE_SIZE = 10;
const STATUS_TONE: Record<ExpectedStatus, Tone> = { in_transit: 'info', scheduled: 'neutral', customs_hold: 'warning', staged: 'success' };
const CONTRACT_TONE: Record<ContractStatus, Tone> = { awaiting_return: 'warning', notice_sent: 'success', ending_soon: 'info', active: 'neutral' };

const TABS = ['transit', 'contracts', 'plan'] as const;
type TabKey = (typeof TABS)[number];

type Scope = { tenant?: string; site?: string };
const noopSubscribe = () => () => {};

/** Expected returns: shipments on their way (ASNs) and returns expected from contracts ending. */
export default function ExpectedReturnsPage() {
  const { scope } = useAuth();
  const meta = caseService.meta();
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'transit');
  const [exporter, registerExport] = useTabExporter();
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <ProductHeader
        title="Expected Inbound Returns"
        description="Shipments on their way to intake, and returns expected from leases and contracts ending, for bay and capacity planning."
        actions={
          <PageActions
            secondary={[{ key: 'export', label: 'Export CSV', icon: <Download />, onClick: () => exporter?.(), disabled: !exporter }]}
            meta={`As of ${dateTime(meta.asOf)}`}
          />
        }
      />

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'transit', label: 'In transit (shipping notices)' },
          { key: 'contracts', label: 'From contracts' },
          { key: 'plan', label: 'Receiving plan' },
        ]}
      />

      {/* Mount a view only once the URL is known: each view writes its own filters to the URL, which would drop ?tab= during hydration. */}
      {!hydrated ? (
        <KpiSkeletonRow count={3} />
      ) : tab === 'contracts' ? (
        <ContractsView scope={scope} registerExport={registerExport} />
      ) : tab === 'plan' ? (
        <PlanView scope={scope} registerExport={registerExport} />
      ) : (
        <TransitView scope={scope} registerExport={registerExport} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ in transit (ASNs) */

function TransitView({ scope, registerExport }: { scope: Scope; registerExport: RegisterExport }) {
  const meta = caseService.meta();
  const [search, setSearch] = useState('');
  const [site, setSite] = useState('all');
  const [status, setStatus] = useState('all');
  const [productClass, setProductClass] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const canReceive = useCanReceive();

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

  const serialisedQuery = JSON.stringify([query, scopeKey]);
  useEffect(() => {
    registerExport(async () => {
      const { items } = await productService.expected.list(query, scope);
      downloadCsv(
        `expected-returns-${meta.asOf.slice(0, 10)}.csv`,
        ['ASN', 'Tenant', 'Equipment', 'Class', 'Quantity', 'Est. delivery', 'Destination', 'Carrier', 'Source', 'Contract', 'Est. value ($)', 'Status', 'Bay'],
        items.map((r) => [r.id, r.tenant, r.equipment, r.category, r.quantity, r.expectedDate, r.site, r.carrier, r.source, r.contractRef, r.estimatedValue, EXPECTED_STATUS_LABEL[r.status], r.bay ?? '']),
      );
      message.success(`Exported ${items.length} shipments (CSV)`);
    });
    // The exporter only needs refreshing when the query or scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialisedQuery, registerExport]);

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
      align: 'right',
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
    {
      title: 'Actions',
      key: 'actions',
      priority: 1,
      width: 96,
      align: 'right',
      ellipsis: false,
      render: (_: unknown, r: ExpectedReturn) =>
        canReceive(r.site) ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setReceivingId(r.id);
            }}
            aria-label={`Receive ${r.id}`}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#141416] shadow-2xs transition-all hover:border-gray-400"
          >
            <PackageCheck size={12} aria-hidden />
            Receive
          </button>
        ) : null,
    },
  ];

  const sm = summaryQ.data;
  const selected = listQ.data?.items.find((r) => r.id === selectedId) ?? null;

  return (
    <>
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
            <DetailList
              rows={[
                ['Customer tenant', selected.tenant],
                ['Destination', selected.site],
                ['Est. delivery', date(selected.expectedDate, true)],
                ['Carrier', selected.carrier],
                ['Return source', selected.source],
                ['Contract', selected.contractRef],
                ['Est. value', money(selected.estimatedValue)],
              ]}
            />
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <div className="flex items-center gap-2">
                <Warehouse className="h-4 w-4 text-amber-500" />
                <span className="font-semibold">{selected.bay ? `Intake bay ${selected.bay}` : 'No intake bay reserved'}</span>
              </div>
              {!selected.bay && bayButton(selected)}
            </div>
            {canReceive(selected.site) && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] p-3">
                <span className="min-w-0 text-[#475569]">Goods arrived? Post the receipt to create the returned-asset cases.</span>
                <button
                  type="button"
                  onClick={() => setReceivingId(selected.id)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#FFD600] px-3.5 py-1.5 text-xs font-extrabold text-[#141416] shadow-2xs transition-all hover:bg-[#FACC15]"
                >
                  <PackageCheck size={14} aria-hidden />
                  Receive
                </button>
              </div>
            )}
          </div>
        )}
      </Drawer>
      {receivingId && (
        <ReceiveAsnModal
          key={receivingId}
          asnId={receivingId}
          onClose={() => {
            if (receivingId === selectedId && !productService.expected.get(receivingId)) setSelectedId(null);
            setReceivingId(null);
          }}
        />
      )}
    </>
  );
}

function DetailList({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="m-0 divide-y divide-[#F1F5F9]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 py-2">
          <dt className="shrink-0 text-[#64748B]">{k}</dt>
          <dd className="m-0 min-w-0 text-right font-semibold text-[#141416]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ receiving plan */

function PlanView({ scope, registerExport }: { scope: Scope; registerExport: RegisterExport }) {
  const meta = caseService.meta();
  const scopeKey = JSON.stringify([scope.tenant, scope.site]);
  useEffect(() => {
    registerExport(async () => {
      const plan = await intakeService.plan(scope);
      downloadCsv(
        `receiving-plan-${meta.asOf.slice(0, 10)}.csv`,
        ['Site', 'Capacity', ...plan.weeks.flatMap((w) => [`Week of ${w.start} units`, `Week of ${w.start} capacity`])],
        plan.rows.map((r) => [r.site, r.capacityLabel, ...r.cells.flatMap((c) => [c.units, c.capacity])]),
      );
      message.success('Exported the receiving plan (CSV)');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, registerExport]);
  return <ReceivingPlan scope={scope} />;
}

/* ------------------------------------------------------------------ from contracts */

const WINDOW_OPTIONS = [
  { value: 'all', label: 'Any expiry' },
  { value: '30', label: 'Ending in 30 days' },
  { value: '90', label: 'Ending in 90 days' },
  { value: '180', label: 'Ending in 180 days' },
];

const outcomeText = (r: ContractRow) => `${OUTCOME_LABEL[r.outcome]} ${pct(r.outcomeShare)}`;
const rangeText = (lo: number, hi: number) => `${moneyK(lo)}–${moneyK(hi)}`;
const expiryText = (days: number) => (days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? 'today' : `in ${days}d`);
const windowText = (r: ContractRow) => `${date(r.windowStart)}–${date(r.windowEnd)}`;

function ContractsView({ scope, registerExport }: { scope: Scope; registerExport: RegisterExport }) {
  const meta = caseService.meta();
  const [search, setSearch] = useState('');
  const [site, setSite] = useState('all');
  const [within, setWithin] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Own URL keys so the two tabs never read each other's filters; `tab` is kept in the URL.
  useUrlFilters({ tab: 'contracts', cq: search, csite: site, within, outcome, cpage: page }, (p) => {
    setSearch(p.get('cq') ?? '');
    setSite(p.get('csite') ?? 'all');
    setWithin(p.get('within') ?? 'all');
    setOutcome(p.get('outcome') ?? 'all');
    setPage(Number(p.get('cpage')) || 1);
  });

  const query: ContractQuery = {
    search,
    site: site === 'all' ? undefined : site,
    withinDays: within === 'all' ? undefined : Number(within),
    outcome: outcome as LikelyOutcome | 'all',
  };
  const scopeKey = [scope.tenant, scope.site];
  const listQ = useServiceQuery(() => contractService.list({ ...query, page, pageSize: PAGE_SIZE }, scope), [query, page, scopeKey], {
    subscribe: contractService.subscribe,
  });
  const summaryQ = useServiceQuery(() => contractService.summary(scope), [scopeKey], { subscribe: contractService.subscribe });
  const selectedQ = useServiceQuery(() => (selectedId ? contractService.get(selectedId) : Promise.resolve(undefined)), [selectedId]);
  const selected = selectedId ? (selectedQ.data?.id === selectedId ? selectedQ.data : listQ.data?.items.find((r) => r.id === selectedId)) : undefined;

  const withReset = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };
  const filtered = search !== '' || site !== 'all' || within !== 'all' || outcome !== 'all';
  const clear = () => {
    setSearch('');
    setSite('all');
    setWithin('all');
    setOutcome('all');
    setPage(1);
  };

  const serialisedQuery = JSON.stringify([query, scopeKey]);
  useEffect(() => {
    registerExport(async () => {
      const { items } = await contractService.list(query, scope);
      downloadCsv(
        `expected-returns-contracts-${meta.asOf.slice(0, 10)}.csv`,
        [
          'Contract',
          'Type',
          'Customer',
          'Equipment',
          'Class',
          'Quantity',
          'Lease start',
          'Contract expiry',
          'Term (months)',
          'Likely outcome',
          'Return probability',
          'Return window start',
          'Return window end',
          'Site',
          'Range low ($)',
          'Range high ($)',
          'Weighted low ($)',
          'Weighted high ($)',
          'Source application',
          'Source reference',
          'Status',
        ],
        items.map((r) => [
          r.id,
          CONTRACT_KIND_LABEL[r.kind],
          r.tenant,
          r.equipment,
          r.category,
          r.quantity,
          r.leaseStart,
          r.leaseEnd,
          r.termMonths,
          OUTCOME_LABEL[r.outcome],
          Math.round(r.returnShare * 100) / 100,
          r.windowStart,
          r.windowEnd,
          r.site,
          r.valueLow,
          r.valueHigh,
          r.weightedLow,
          r.weightedHigh,
          r.sourceName,
          r.sourceRef,
          CONTRACT_STATUS_LABEL[r.status],
        ]),
      );
      message.success(`Exported ${items.length} contracts (CSV)`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialisedQuery, registerExport]);

  const columns: DataColumn<ContractRow>[] = [
    {
      title: 'Contract / Customer',
      key: 'contract',
      priority: 1,
      width: 120,
      ellipsis: false,
      render: (_: unknown, r: ContractRow) => (
        <div className="min-w-0">
          <div className="font-mono font-bold text-[#141416]">{r.id}</div>
          <div className="truncate text-[11px] text-[#64748B]">{r.tenant}</div>
        </div>
      ),
    },
    {
      title: 'Asset',
      key: 'asset',
      priority: 2,
      render: (_: unknown, r: ContractRow) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-[#141416]">{r.equipment}</div>
          <div className="truncate text-[11px] text-[#64748B]">
            {r.category} · <span className="font-mono">{r.quantity}</span> {r.quantity === 1 ? 'unit' : 'units'} · {CONTRACT_KIND_LABEL[r.kind]}
          </div>
        </div>
      ),
    },
    {
      title: 'Lease / Expiry',
      key: 'expiry',
      priority: 2,
      width: 170,
      render: (_: unknown, r: ContractRow) => (
        <div className="min-w-0">
          <div className="font-mono text-[#141416]">
            {date(r.leaseEnd, true)} <span className={`text-[11px] ${r.daysToExpiry < 0 ? 'font-semibold text-[#B45309]' : 'text-[#64748B]'}`}>· {expiryText(r.daysToExpiry)}</span>
          </div>
          <div className="truncate text-[11px] text-[#64748B]">
            From <span className="font-mono">{date(r.leaseStart, true)}</span> · <span className="font-mono">{r.termMonths}</span> mo
          </div>
        </div>
      ),
    },
    {
      title: 'Likely Outcome',
      key: 'outcome',
      priority: 1,
      width: 140,
      render: (_: unknown, r: ContractRow) => (
        <div className="min-w-0">
          <div className="font-semibold text-[#141416]">
            {OUTCOME_LABEL[r.outcome]} <span className="font-mono">{pct(r.outcomeShare)}</span>
          </div>
          {r.noHistory ? (
            <div className="truncate text-[11px] text-[#64748B]">No history: expiry = return</div>
          ) : r.outcome !== 'return' ? (
            <div className="truncate text-[11px] text-[#64748B]">
              Return <span className="font-mono">{pct(r.returnShare)}</span>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Expected Return',
      key: 'window',
      priority: 3,
      width: 130,
      render: (_: unknown, r: ContractRow) => (
        <div className="min-w-0">
          <div className="font-mono text-[#475569]">{windowText(r)}</div>
          <div className="truncate text-[11px] text-[#64748B]">to {r.site}</div>
        </div>
      ),
    },
    {
      title: 'Planning Range',
      key: 'range',
      dataIndex: 'weightedHigh',
      priority: 1,
      align: 'right',
      width: 130,
      render: (_: unknown, r: ContractRow) => (
        <div className="min-w-0">
          <div className="font-mono font-bold text-emerald-700">{rangeText(r.valueLow, r.valueHigh)}</div>
          <div className="text-[11px] text-[#64748B]">
            weighted <span className="font-mono">{rangeText(r.weightedLow, r.weightedHigh)}</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Source',
      key: 'source',
      priority: 3,
      width: 130,
      render: (_: unknown, r: ContractRow) => (
        <div className="min-w-0">
          <div className="truncate text-[#141416]">{r.sourceName}</div>
          <div className="truncate font-mono text-[11px] text-[#64748B]">{r.sourceRef}</div>
        </div>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      priority: 2,
      width: 130,
      render: (_: unknown, r: ContractRow) => <StatusBadge tone={CONTRACT_TONE[r.status]}>{CONTRACT_STATUS_LABEL[r.status]}</StatusBadge>,
    },
  ];

  const sm = summaryQ.data;

  return (
    <>
      {summaryQ.initialLoading || !sm ? (
        <KpiSkeletonRow count={3} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard
            label="Contracts Ending in 90 Days"
            value={sm.ending90}
            icon={<CalendarClock />}
            context={`Of ${sm.total} contracts tracked · incl. expired, not yet returned`}
          />
          <MetricCard label="Expected Units" value={sm.expectedUnits} unit="units" icon={<Package />} iconTone="blue" context="Probability-weighted, from those contracts" />
          <MetricCard
            label="Weighted Value"
            value={moneyK(sm.weightedValue)}
            icon={<Scale />}
            iconTone="green"
            context={`Planning range ${rangeText(sm.weightedLow, sm.weightedHigh)}`}
          />
        </div>
      )}

      <Card>
        <CardTitle
          title="Contracts Ending"
          description="Planning signals from lease and contract expiry in each customer's contract system. Nothing is committed until the unit is received and inspected."
        />
        <FilterRow>
          <SearchBox value={search} onChange={withReset(setSearch)} placeholder="Search contract, customer or equipment" />
          {!scope.site && (
            <FilterPick
              value={site}
              onChange={withReset(setSite)}
              label="Receiving site"
              options={[{ value: 'all', label: 'All Sites' }, ...meta.sites.map((s) => ({ value: s, label: s }))]}
            />
          )}
          <FilterPick value={within} onChange={withReset(setWithin)} label="Contract expiry" options={WINDOW_OPTIONS} />
          <MoreFilters active={outcome !== 'all' ? 1 : 0}>
            <FilterPick
              value={outcome}
              onChange={withReset(setOutcome)}
              label="Likely outcome"
              options={[{ value: 'all', label: 'All likely outcomes' }, ...Object.entries(OUTCOME_LABEL).map(([value, label]) => ({ value, label }))]}
            />
          </MoreFilters>
          <ClearFilters onClick={clear} disabled={!filtered} />
        </FilterRow>

        <div className="pt-4">
          {listQ.error && !listQ.data ? (
            <ErrorState onRetry={listQ.refetch} compact />
          ) : (
            <>
              <DataTable<ContractRow>
                rowKey="id"
                columns={columns}
                dataSource={listQ.data?.items ?? []}
                initialLoading={listQ.initialLoading}
                refreshing={listQ.loading}
                filtered={filtered}
                onClearFilters={clear}
                emptyTitle="No contracts ending in your scope"
                onRowClick={(r) => setSelectedId(r.id)}
                rowClassName="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#141416]"
                onRow={(r) => ({
                  tabIndex: 0,
                  'aria-label': `Show contract ${r.id}, ${outcomeText(r)}`,
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
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        size={480}
        title={selected && <span className="font-mono text-sm font-bold">{selected.id}</span>}
        extra={selected && <StatusBadge tone={CONTRACT_TONE[selected.status]}>{CONTRACT_STATUS_LABEL[selected.status]}</StatusBadge>}
      >
        {selected && <ContractDetail c={selected} asOf={meta.asOf} />}
      </Drawer>
    </>
  );
}

function ContractDetail({ c, asOf }: { c: ContractRow; asOf: string }) {
  const sectionTitle = 'm-0 mb-2 text-[11px] font-bold uppercase tracking-wider text-[#64748B]';
  return (
    <div className="space-y-6 text-xs">
      <div>
        <div className="text-sm font-extrabold text-[#141416]">{c.equipment}</div>
        <div className="text-[#64748B]">
          {c.category} · <span className="font-mono">{c.quantity}</span> {c.quantity === 1 ? 'unit' : 'units'} · {CONTRACT_KIND_LABEL[c.kind]}
        </div>
      </div>

      <section>
        <h3 className={sectionTitle}>Contract</h3>
        <DetailList
          rows={[
            ['Customer', `${c.tenant} · ${c.customerSite}`],
            ['Lease period', <span key="p" className="font-mono">{`${date(c.leaseStart, true)} – ${date(c.leaseEnd, true)} (${c.termMonths} months)`}</span>],
            ['Contract expiry', <span key="e" className="font-mono">{`${date(c.leaseEnd, true)} · ${expiryText(c.daysToExpiry)}`}</span>],
            ['Buyout option', c.buyoutOption && c.buyoutPrice ? <span key="b" className="font-mono">{`${money(c.buyoutPrice)} per unit`}</span> : 'None'],
            ['Extension option', c.extensionOption ? 'Allowed' : 'None'],
            ['Expected return', <span key="w" className="font-mono">{windowText(c)}</span>],
            ['Receiving site', c.site],
            [
              'Source application',
              <span key="s">
                {c.sourceName} · <span className="font-mono">{c.sourceRef}</span>
              </span>,
            ],
          ]}
        />
        {c.sourceSyncedAt && <p className="m-0 mt-1 text-[11px] text-[#94A3B8]">Retrieved · {c.sourceName} · {relativeTime(c.sourceSyncedAt, asOf)}</p>}
      </section>

      <section>
        <h3 className={sectionTitle}>Likely outcome</h3>
        <p className="m-0 mb-3 text-sm font-extrabold text-[#141416]">
          {OUTCOME_LABEL[c.outcome]} <span className="font-mono">{pct(c.outcomeShare)}</span>
          {c.noHistory && <span className="ml-2 text-xs font-medium text-[#64748B]">No history: expiry = return</span>}
        </p>
        <SegmentedBar
          ariaLabel={`Return ${pct(c.shares.return)}, buyout ${pct(c.shares.buyout)}, extension ${pct(c.shares.extension)}`}
          unit="%"
          height={10}
          segments={(['return', 'buyout', 'extension'] as LikelyOutcome[]).map((k, i) => ({
            id: k,
            label: OUTCOME_LABEL[k],
            value: Math.round(c.shares[k] * 100),
            color: seriesColors[i],
          }))}
        />
      </section>

      <section>
        <h3 className={sectionTitle}>How the probability was estimated</h3>
        <ol className="m-0 space-y-3 p-0 pl-4">
          {c.steps.map((s) => (
            <li key={s.label} className="text-[#475569]">
              <div className="font-semibold text-[#141416]">{s.label}</div>
              <div>{s.detail}</div>
              <div className="mt-0.5 text-[11px] text-[#64748B]">
                Return <span className="font-mono">{pct(s.shares.return)}</span> · Buyout <span className="font-mono">{pct(s.shares.buyout)}</span> · Extension{' '}
                <span className="font-mono">{pct(s.shares.extension)}</span>
              </div>
            </li>
          ))}
        </ol>
        <p className="m-0 mt-3 text-[11px] text-[#64748B]">Signal on file: {SIGNAL_LABEL[c.customerSignal]}.</p>
      </section>

      <section>
        <h3 className={sectionTitle}>Planning range</h3>
        <DetailList
          rows={[
            ['Unit value range', <span key="u" className="font-mono">{`${money(c.unitValueLow)}–${money(c.unitValueHigh)}`}</span>],
            ['Range', <span key="r" className="font-mono">{`${c.quantity} × unit value = ${money(c.valueLow)}–${money(c.valueHigh)}`}</span>],
            ['Probability-weighted', <span key="pw" className="font-mono">{`× ${pct(c.returnShare)} return = ${money(c.weightedLow)}–${money(c.weightedHigh)}`}</span>],
            ['Expected units', <span key="eu" className="font-mono">{c.expectedUnits}</span>],
          ]}
        />
        <p className="m-0 mt-2 flex items-start gap-1.5 text-[11px] text-[#64748B]">
          <FileText size={12} className="mt-px shrink-0" aria-hidden />A planning signal only: the shipping notice and the case are created when the customer books the return.
        </p>
      </section>
    </div>
  );
}
