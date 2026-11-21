'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Slider, Tabs, message } from 'antd';
import { ArrowRight, ArrowRightLeft, Download, GitCompareArrows, Layers, ListOrdered, RotateCcw, Info, Scale, SlidersHorizontal, TrendingDown, TrendingUp, Wallet, Wrench, X } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import type { DecisionParams, RouteId } from '@/models/decision.model';
import { ROUTE_IDS, defaultParams, getPolicy } from '@/services/decisionService';
import { portfolioAnalyticsService, routeName, routeShort, type ContestedRow, type WhatIfChangeRow, type WhatIfView } from '@/services/portfolioAnalyticsService';
import { chartColors } from '@/theme/tokens';
import {
  CaseLink,
  ChartSkeleton,
  DataTable,
  ErrorState,
  KpiSkeletonRow,
  MetricCard,
  PageActions,
  PageHeader,
  Panel,
  ProgressBar,
  type DataColumn,
} from '@/components/ui';
import { HorizontalBarChart, StackedBarChart } from '@/components/charts';
import { SegmentToggle, downloadCsv, fmtMoney, fmtPct, fmtSignedMoney } from '@/components/analytics/AnalyticsControls';

type LeverKey = keyof DecisionParams;

interface Lever {
  key: LeverKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
const usd0 = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

const LEVERS: Lever[] = [
  { key: 'resalePriceIndex', label: 'Resale price index', hint: 'Market prices for resale, parts and material', min: 0.6, max: 1.4, step: 0.05, fmt: pct },
  { key: 'refurbCostIndex', label: 'Refurbishment cost index', hint: 'Refurbishment, test and teardown costs', min: 0.6, max: 1.6, step: 0.05, fmt: pct },
  { key: 'leaseDemand', label: 'Lease demand', hint: 'Share of open lease orders still available', min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'customerWaitCost', label: 'Customer-wait cost', hint: 'Avoided per backordered repair order', min: 0, max: 2000, step: 50, fmt: usd0 },
  { key: 'fitForUseThreshold', label: 'Fit-for-use threshold', hint: 'Minimum part life to certify a used part', min: 30, max: 80, step: 5, fmt: (v) => `${v} % life` },
  { key: 'holdingCostPerDay', label: 'Holding cost per day', hint: 'Per standard bay while an asset waits', min: 0, max: 40, step: 1, fmt: (v) => `${usd0(v)}/day` },
  { key: 'refurbSlots', label: 'Refurbishment slots', hint: 'Re-lease capacity in the repair centre', min: 0, max: 16, step: 1, fmt: (v) => `${v} slots` },
];

type MixMeasure = 'n' | 'value';
const short = routeShort;
/** "$1.2k" that keeps the sign for negatives. */
const money = (n: number) => (n < 0 ? `−${fmtMoney(-n)}` : fmtMoney(n));

function LeverControl({ lever, value, base, onChange }: { lever: Lever; value: number; base: number; onChange: (v: number) => void }) {
  const changed = value !== base;
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${changed ? 'border-[#FDE68A] bg-[#FFFBEB]' : 'border-[#E2E8F0] bg-[#F8FAFC]'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-bold text-[#141416]">{lever.label}</span>
        <span className="shrink-0 font-mono text-xs font-black text-[#141416]" aria-live="polite">
          {lever.fmt(value)}
        </span>
      </div>
      <Slider
        min={lever.min}
        max={lever.max}
        step={lever.step}
        value={value}
        onChange={(v) => onChange(v)}
        // The value is shown beside the label above; a floating tooltip would cover that label.
        tooltip={{ open: false }}
        ariaLabelForHandle={lever.label}
        className="!mx-1 !my-2"
      />
      <div className="flex items-center justify-between gap-2 text-[11px] text-[#94A3B8]">
        <span className="truncate">{lever.hint}</span>
        <span className="shrink-0">{changed ? `Today ${lever.fmt(base)}` : 'Today'}</span>
      </div>
    </div>
  );
}

interface ResultsProps {
  data: WhatIfView | undefined;
  loading: boolean;
  initialLoading: boolean;
  /** Levers differ from today's published values. */
  scenario: boolean;
}

/** KPIs, route mix, changed decisions and the queue plan. Memoised so dragging a lever only re-renders the levers. */
const WhatIfResults = React.memo(function WhatIfResults({ data, loading, initialLoading, scenario }: ResultsProps) {
  const [tab, setTab] = useState('changes');
  const [measure, setMeasure] = useState<MixMeasure>('n');
  const [routeFilter, setRouteFilter] = useState<RouteId | null>(null);

  const mixRows = useMemo(() => {
    if (!data) return [];
    const { mixToday, mixScenario } = data.result;
    return ROUTE_IDS.filter((r) => mixToday.some((m) => m.route === r) || mixScenario.some((m) => m.route === r)).map((r) => {
      const t = mixToday.find((m) => m.route === r);
      const s = mixScenario.find((m) => m.route === r);
      return { id: r, route: short(r), today: (measure === 'n' ? t?.n : t?.value) ?? 0, scenario: (measure === 'n' ? s?.n : s?.value) ?? 0 };
    });
  }, [data, measure]);

  const changeRows = useMemo(() => (data?.changes ?? []).filter((c) => !routeFilter || c.from === routeFilter || c.to === routeFilter), [data, routeFilter]);

  const changeColumns: DataColumn<WhatIfChangeRow>[] = [
    {
      title: 'Case',
      key: 'case',
      priority: 1,
      render: (_, r) => (
        <div className="min-w-0">
          <CaseLink id={r.caseId} label={r.productName} />
          <div className="truncate text-[11px] text-[#94A3B8]">{r.channelLabel}</div>
        </div>
      ),
    },
    {
      title: 'Today → scenario',
      key: 'routes',
      priority: 2,
      render: (_, r) =>
        r.from === r.to ? (
          <span className="text-xs text-[#64748B]" title={routeName(r.from)}>
            {short(r.from)} · value only
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1 text-xs">
            <span className="truncate text-[#64748B]" title={routeName(r.from)}>
              {short(r.from)}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-[#94A3B8]" />
            <span className="truncate font-bold text-[#141416]" title={routeName(r.to)}>
              {short(r.to)}
            </span>
          </span>
        ),
    },
    {
      title: 'Net change',
      dataIndex: 'netDelta',
      key: 'delta',
      priority: 1,
      align: 'right',
      sorter: (a, b) => a.netDelta - b.netDelta,
      render: (v: number, r) => (
        <div className="text-right">
          <span className={`font-mono text-xs font-bold ${v >= 0 ? 'text-[#047857]' : 'text-[#B91C1C]'}`}>{fmtSignedMoney(v)}</span>
          <div className="font-mono text-[11px] text-[#94A3B8]">
            {money(r.netToday)} → {money(r.netScenario)}
          </div>
        </div>
      ),
    },
  ];

  const contestedColumns: DataColumn<ContestedRow>[] = [
    {
      title: 'Demand',
      key: 'demand',
      priority: 1,
      render: (_, r) => (
        <div className="min-w-0">
          <span className="font-mono text-xs font-bold text-[#141416]">{r.demandId}</span>
          <div className="truncate text-[11px] text-[#94A3B8]">{r.kindLabel}</div>
        </div>
      ),
    },
    { title: 'Customer', dataIndex: 'customer', key: 'customer', priority: 2, render: (v: string) => <span className="text-xs text-[#475569]">{v}</span> },
    {
      title: 'Wanted by',
      key: 'wanted',
      priority: 2,
      ellipsis: false,
      render: (_, r) => (
        <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
          {r.wantedBy.map((id) => (
            <CaseLink key={id} id={id} />
          ))}
        </div>
      ),
    },
    {
      title: 'Planned for',
      key: 'planned',
      priority: 1,
      render: (_, r) => (r.plannedFor ? <CaseLink id={r.plannedFor} /> : <span className="text-xs text-[#94A3B8]">Nobody in time</span>),
    },
    {
      title: 'Worth more there by',
      dataIndex: 'worthMoreBy',
      key: 'gain',
      priority: 1,
      align: 'right',
      render: (v: number) => <span className="font-mono text-xs font-bold text-[#047857]">{fmtSignedMoney(v)}</span>,
    },
  ];

  const r = data?.result;
  const plan = data?.plan;
  const fmtMix = measure === 'n' ? (v: number) => String(v) : money;

  const changesTab =
    initialLoading || !data || !r ? (
      <div className="space-y-6">
        <KpiSkeletonRow count={4} />
        <Panel title="Route mix, today and in the scenario">
          <ChartSkeleton height={260} />
        </Panel>
      </div>
    ) : (
      <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Queue value · scenario" value={fmtMoney(r.scenario)} icon={<Wallet />} context={`Today ${fmtMoney(r.today)} · ${plan?.openCases ?? 0} open decisions`} />
          <MetricCard
            label="If the standard route decides"
            value={fmtMoney(r.standard)}
            icon={<Scale />}
            iconTone="slate"
            context={`Circularity adds ${fmtSignedMoney(r.scenario - r.standard)} in this scenario`}
          />
          <MetricCard
            label="Decisions that change"
            value={data.routeChanges}
            unit="change route"
            icon={<ArrowRightLeft />}
            iconTone="blue"
            context={`${data.changes.length - data.routeChanges} more change value only`}
          />
          <MetricCard
            label="Gain vs today"
            value={fmtSignedMoney(data.gainVsToday)}
            icon={data.gainVsToday < 0 ? <TrendingDown /> : <TrendingUp />}
            iconTone={data.gainVsToday > 0 ? 'green' : data.gainVsToday < 0 ? 'red' : 'slate'}
            context={r.today ? `${data.gainVsToday >= 0 ? '+' : '−'}${fmtPct(Math.abs(data.gainVsToday) / Math.abs(r.today), 1)} of today's queue value` : undefined}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Panel
            className="lg:col-span-2"
            title="Route mix, today and in the scenario"
            description="Click a route to list the decisions that move into or out of it."
            icon={<Layers />}
          >
            <div className="mb-3 flex justify-end">
              <SegmentToggle<MixMeasure>
                label="Measure"
                value={measure}
                onChange={setMeasure}
                options={[
                  { value: 'n', label: 'Decisions' },
                  { value: 'value', label: 'Net value' },
                ]}
              />
            </div>
            <StackedBarChart
              data={mixRows}
              xKey="route"
              grouped
              orientation="horizontal"
              series={[
                { key: 'today', label: 'Today', color: chartColors.neutralSoft },
                { key: 'scenario', label: 'Scenario', color: chartColors.neutral },
              ]}
              valueFormat={fmtMix}
              height={Math.max(220, mixRows.length * 44)}
              ariaLabel={`Route mix today and in the scenario by ${measure === 'n' ? 'number of decisions' : 'net value'}`}
              onBarClick={(row) => setRouteFilter(row.id)}
            />
          </Panel>

          <Panel
            className="lg:col-span-3"
            title="Decisions that change"
            description="Open cases whose route or net value differs from today's plan under these levers."
            icon={<GitCompareArrows />}
            actions={
              routeFilter && (
                <button
                  type="button"
                  onClick={() => setRouteFilter(null)}
                  className="flex cursor-pointer items-center gap-1 rounded-full bg-[#FEF08A] px-2.5 py-1 text-[11px] font-bold text-[#854D0E]"
                  aria-label={`Clear route filter ${routeName(routeFilter)}`}
                >
                  {routeName(routeFilter)} <X className="h-3 w-3" />
                </button>
              )
            }
          >
            <DataTable<WhatIfChangeRow>
              columns={changeColumns}
              dataSource={changeRows}
              rowKey="caseId"
              pagination={changeRows.length > 8 ? { pageSize: 8, size: 'small', showSizeChanger: false } : false}
              refreshing={loading}
              filtered={!!routeFilter}
              onClearFilters={() => setRouteFilter(null)}
              emptyTitle="No decision changes"
              emptyDescription="Move a lever to see which decisions would change."
            />
          </Panel>
        </div>
      </div>
    );

  const planTab =
    initialLoading || !plan ? (
      <Panel title="Queue plan">
        <ChartSkeleton height={160} />
      </Panel>
    ) : (
      <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
        <Panel
          title={`Plan adds ${fmtSignedMoney(plan.gain)} over first come, first served`}
          description={`All ${plan.openCases} open cases decided together: each demand record goes to the one case where it adds most, and refurbishment is limited to ${plan.refurbSlots} slots${scenario ? ' (under the levers above)' : ''}.`}
          icon={<ListOrdered />}
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <HorizontalBarChart
                data={[
                  { id: 'plan', label: 'Queue plan', value: plan.planValue },
                  { id: 'fcfs', label: 'First come, first served', value: plan.fcfsValue },
                  { id: 'standard', label: 'Standard route', value: plan.standardValue },
                ]}
                highlight="plan"
                valueFormat={money}
                seriesName="Queue value"
                labelWidth={150}
                ariaLabel={`Queue value: plan ${fmtMoney(plan.planValue)}, first come first served ${fmtMoney(plan.fcfsValue)}, standard route ${fmtMoney(plan.standardValue)}`}
              />
            </div>
            <div className="min-w-0 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[#141416]">
                <Wrench className="h-4 w-4 text-amber-500" /> Refurbishment slots used
              </div>
              <div className="font-mono text-2xl font-black text-[#141416]">
                {plan.refurbSlotsUsed} <span className="text-xs font-semibold text-[#64748B]">of {plan.refurbSlots}</span>
              </div>
              <ProgressBar value={plan.refurbSlotsUsed} max={Math.max(1, plan.refurbSlots)} label="Refurbishment slots used" tone={plan.refurbSlotsUsed >= plan.refurbSlots ? 'warning' : 'ink'} />
              <p className="m-0 text-xs text-[#64748B]">
                {plan.contested.length} demand records are wanted by more than one case. First come, first served would give each to the case that asked first.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Contested demands" description="Demand records more than one open case wants, who the plan gives each to, and how much more it is worth there." icon={<ArrowRightLeft />}>
          <DataTable<ContestedRow>
            columns={contestedColumns}
            dataSource={plan.contested}
            rowKey="demandId"
            pagination={plan.contested.length > 10 ? { pageSize: 10, size: 'small', showSizeChanger: false } : false}
            refreshing={loading}
            emptyTitle="No contested demand"
            emptyDescription="Every demand record is wanted by at most one open case."
          />
        </Panel>
      </div>
    );

  return (
    <Tabs
      activeKey={tab}
      onChange={setTab}
      items={[
        { key: 'changes', label: 'What changes', children: changesTab },
        { key: 'plan', label: 'Queue plan', children: planTab },
      ]}
    />
  );
});

export default function PortfolioWhatIfPage() {
  const base = useMemo(() => defaultParams(getPolicy()), []);
  /** What the sliders show (updates while dragging). */
  const [levers, setLevers] = useState<Partial<DecisionParams>>({});
  /** What the scenario is computed for (follows `levers` after a short pause, so a drag computes once). */
  const [applied, setApplied] = useState<Partial<DecisionParams>>(levers);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const { scope } = useAuth();
  const { data, initialLoading, loading, error, refetch } = useServiceQuery(() => portfolioAnalyticsService.whatIf(applied, scope), [applied, scope.tenant, scope.site], {
    subscribe: portfolioAnalyticsService.subscribe,
  });

  const params: DecisionParams = { ...base, ...levers };
  const changedCount = Object.keys(levers).length;
  const setLever = (key: LeverKey, v: number) => {
    const next = { ...levers };
    if (v === base[key]) delete next[key];
    else next[key] = v;
    setLevers(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setApplied(next), 220);
  };
  const reset = () => {
    if (timer.current) clearTimeout(timer.current);
    const none: Partial<DecisionParams> = {};
    setLevers(none);
    setApplied(none);
  };
  const pending = loading || levers !== applied;

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      'what-if-changes.csv',
      ['Case', 'Asset', 'Intake channel', 'Route today', 'Route in scenario', 'Net today ($)', 'Net in scenario ($)', 'Net change ($)'],
      data.changes.map((c) => [c.caseId, c.productName, c.channelLabel, routeName(c.from), routeName(c.to), c.netToday, c.netScenario, c.netDelta]),
    );
    message.success('Decisions that change exported (CSV)');
  };

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Portfolio what-if"
        description="Change market prices, costs and capacity to see how the whole open queue would be decided, and what the queue plan earns over first come, first served."
        actions={<PageActions secondary={[{ key: 'export', label: 'Export changes', icon: <Download />, onClick: exportCsv, disabled: !data?.changes.length }]} />}
      />

      <Panel
        title="Levers"
        description={changedCount ? `${changedCount} lever${changedCount > 1 ? 's' : ''} changed from today's published values.` : "Today's published values. Move a lever to build a scenario."}
        icon={<SlidersHorizontal />}
        actions={
          <>
            {pending && data && (
              <span className="text-[11px] font-medium text-[#64748B]" role="status">
                Recalculating…
              </span>
            )}
            <button
              type="button"
              onClick={reset}
              disabled={!changedCount}
              className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] shadow-2xs transition-all hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LEVERS.map((l) => (
            <LeverControl key={l.key} lever={l} value={params[l.key]} base={base[l.key]} onChange={(v) => setLever(l.key, v)} />
          ))}
          {changedCount > 0 && (
            <p className="m-0 flex min-w-0 items-center gap-2 rounded-xl border border-dashed border-[#E2E8F0] p-3 text-xs text-[#64748B]">
              <Info className="h-4 w-4 shrink-0 text-amber-500" />
              Scenario only. The decisions on cases keep today&rsquo;s published values.
            </p>
          )}
        </div>
      </Panel>

      {error && !data ? (
        <Panel>
          <ErrorState onRetry={refetch} />
        </Panel>
      ) : (
        <WhatIfResults data={data} loading={loading} initialLoading={initialLoading} scenario={Object.keys(applied).length > 0} />
      )}
    </div>
  );
}
