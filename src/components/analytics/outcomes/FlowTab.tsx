'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Drawer, message } from 'antd';
import { ChevronRight, Filter, Layers, Timer } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import {
  analyticsService,
  caseAgeDays,
  type AnalyticsFilter,
  type FunnelStage,
  type FunnelStageId,
} from '@/services/analyticsService';
import {
  CaseLink,
  ChartSkeleton,
  DataTable,
  ErrorState,
  ListSkeleton,
  Panel,
  StageBadge,
  EmptyState,
  type DataColumn,
} from '@/components/ui';
import { BarChart, HorizontalBarChart } from '@/components/charts';
import {
  ClearButton,
  FilterRow,
  SelectFilter,
  ShowToggle,
  downloadCsv,
  fmtMoney,
  fmtPct,
} from '@/components/analytics/AnalyticsControls';
import type { RegisterExport } from '@/components/analytics/useTabParam';

const ALL = 'All';

/**
 * Operational flow (formerly the Pipeline funnel page): how return cases move from intake
 * to a reconciled outcome. Live cases, so it follows the site filter, not the page period.
 */
export function FlowTab({ registerExport }: { registerExport: RegisterExport }) {
  // Tenant (and a site-scoped role's site) come from the header scope switcher.
  const { scope } = useAuth();
  const meta = analyticsService.meta();
  const tenant = scope.tenant ?? ALL;
  const [sitePick, setSite] = useState<string>(ALL);
  const site = scope.site ?? sitePick;
  const [drillStage, setDrillStage] = useState<FunnelStage | null>(null);
  const [showTable, setShowTable] = useState(false);

  const filter: AnalyticsFilter = { tenant, site };
  const { data, initialLoading, loading, error, refetch } = useServiceQuery(
    () => analyticsService.pipeline({ tenant, site }),
    [tenant, site],
    { subscribe: analyticsService.subscribe },
  );

  const filtered = !scope.site && site !== ALL;
  const clearFilters = () => setSite(ALL);

  const scopeLabel = `${tenant === ALL ? 'All tenants' : tenant} · ${site === ALL ? 'All sites' : site}`;

  const funnelData = useMemo(
    () => (data?.stages ?? []).map((s) => ({ id: s.id, label: s.label, value: s.reached })),
    [data],
  );
  const durationData = useMemo(
    () =>
      (data?.stages ?? [])
        .filter((s) => s.medianDays !== null)
        .map((s) => ({ id: s.id, label: s.label, value: s.medianDays as number })),
    [data],
  );
  const slowest = durationData.reduce<{ id: string; value: number } | null>(
    (best, d) => (!best || d.value > best.value ? { id: d.id, value: d.value } : best),
    null,
  );

  // Hand this tab's export to the page-level Export button.
  useEffect(() => {
    if (!data) return;
    registerExport(() => {
      downloadCsv(
      `pipeline-funnel-${data.cohortMonth.replace(' ', '-').toLowerCase()}.csv`,
      ['Stage', 'Reached', 'Conversion from previous (%)', 'Cumulative conversion (%)', 'In stage now', 'Median days in stage', 'Tenant', 'Site'],
      data.stages.map((s) => [
        s.label,
        s.reached,
        (s.conversion * 100).toFixed(1),
        (s.cumulative * 100).toFixed(1),
        s.current,
        s.medianDays ?? '',
        tenant,
        site,
      ]),
      );
      message.success('Pipeline funnel exported (CSV)');
    });
    return () => registerExport(null);
  }, [data, tenant, site, registerExport]);

  const stageColumns: DataColumn<FunnelStage>[] = [
    {
      title: 'Stage',
      key: 'stage',
      priority: 1,
      render: (_, s) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-[11px] font-semibold text-[#64748B]">
            {(data?.stages.findIndex((x) => x.id === s.id) ?? 0) + 1}
          </span>
          <div className="min-w-0">
            <span className="block text-xs font-bold text-[#141416]">{s.label}</span>
            <span className="hidden truncate text-[11px] text-[#64748B] lg:block">{s.description}</span>
          </div>
        </div>
      ),
    },
    { title: 'Reached', dataIndex: 'reached', key: 'reached', priority: 1, align: 'right', render: (v: number) => <span className="font-mono text-xs font-bold text-[#141416]">{v}</span> },
    {
      title: 'From previous',
      key: 'conversion',
      priority: 2,
      align: 'right',
      render: (_, s) => {
        if (s.id === data?.stages[0]?.id) return <span className="text-[#94A3B8]">—</span>;
        const drop = 1 - s.conversion;
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono text-xs font-bold text-[#141416]">{fmtPct(s.conversion, 1)}</span>
            {drop >= 0.05 && <span className="rounded-md bg-[#FEF3C7] px-1.5 py-0.5 text-[10px] font-bold text-[#D97706]">−{fmtPct(drop, 0)}</span>}
          </span>
        );
      },
    },
    { title: 'From received', dataIndex: 'cumulative', key: 'cumulative', priority: 3, align: 'right', render: (v: number) => <span className="font-mono text-xs text-[#475569]">{fmtPct(v, 1)}</span> },
    { title: 'In stage now', dataIndex: 'current', key: 'current', priority: 2, align: 'right', render: (v: number) => <span className="font-mono text-xs text-[#475569]">{v}</span> },
    {
      title: 'Median days',
      dataIndex: 'medianDays',
      key: 'medianDays',
      priority: 3,
      align: 'right',
      render: (v: number | null) => <span className="font-mono text-xs text-[#475569]">{v === null ? '—' : `${v.toFixed(1)}d`}</span>,
    },
    {
      title: '',
      key: 'open',
      priority: 1,
      align: 'right',
      width: 40,
      render: (_, s) => <ChevronRight className="inline h-4 w-4 text-[#94A3B8]" aria-label={`Open ${s.label}`} />,
    },
  ];

  const openStage = (id: string) => {
    const s = data?.stages.find((x) => x.id === id);
    if (s) setDrillStage(s);
  };

  return (
    <div className="space-y-6">
      <FilterRow>
        {!scope.site && (
          <SelectFilter
            label="Site"
            value={site}
            onChange={setSite}
            options={[{ value: ALL, label: 'All sites' }, ...meta.sites.map((s) => ({ value: s, label: s }))]}
          />
        )}
        {filtered && <ClearButton onClick={clearFilters} />}
        <span className="text-[11px] text-[#64748B]">
          {data ? `Live cases + decisions reconciled in ${data.cohortMonth}; the period above does not apply.` : 'Live cases; the period above does not apply.'}
        </span>
      </FilterRow>

      {error && !data ? (
        <Panel>
          <ErrorState onRetry={refetch} />
        </Panel>
      ) : initialLoading || !data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title="Funnel: case to reconciled">
            <ChartSkeleton height={240} />
          </Panel>
          <Panel title="Median days in stage">
            <ChartSkeleton height={240} />
          </Panel>
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
          {/* Headline flow figures as one line (the page's KPI cards are the outcome figures above). */}
          <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[#64748B]">
            <div className="min-w-0">
              <dt className="inline">Conversion to approval </dt>
              <dd className="m-0 inline font-mono font-bold text-[#141416]">{fmtPct(data.kpis.conversionToApproval, 1)}</dd>
              <span> ({data.stages.find((s) => s.id === 'approved')?.reached ?? 0} of {data.stages[0]?.reached ?? 0} received)</span>
            </div>
            <div className="min-w-0">
              <dt className="inline">Median per stage </dt>
              <dd className="m-0 inline font-mono font-bold text-[#141416]">{data.kpis.medianDaysPerStage.toFixed(1)} days</dd>
              <span> ({data.kpis.endToEndDays.toFixed(1)} days end to end)</span>
            </div>
            <div className="min-w-0">
              <dt className="inline">Reconciled in {data.cohortMonth} </dt>
              <dd className="m-0 inline font-mono font-bold text-[#141416]">{data.kpis.reconciled} decisions</dd>
              <span> ({fmtPct(data.stages[data.stages.length - 1]?.cumulative ?? 0, 1)} of received cases)</span>
            </div>
          </dl>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel
              title="Funnel: case to reconciled"
              description="Cases that reached each stage (in it now or later). Click a bar to list its cases."
              icon={<Filter />}
              actions={<ShowToggle open={showTable} onToggle={() => setShowTable((o) => !o)} controls="pipeline-stages" />}
            >
              <HorizontalBarChart
                data={funnelData}
                ariaLabel={`Pipeline funnel for ${scopeLabel}: ${funnelData.map((d) => `${d.label} ${d.value}`).join(', ')}`}
                highlight="approved"
                seriesName="Cases reached"
                labelWidth={128}
                height={240}
                onBarClick={(d) => d.id && openStage(d.id)}
              />
            </Panel>
            <Panel
              title="Median days in stage"
              description="Typical time a case spends in each stage before moving on. The slowest stage is highlighted."
              icon={<Timer />}
            >
              <BarChart
                data={durationData}
                ariaLabel={`Median days in stage for ${scopeLabel}: ${durationData.map((d) => `${d.label} ${d.value} days`).join(', ')}`}
                highlight={slowest?.id}
                seriesName="Median days"
                valueFormat={(v) => `${v}d`}
                height={240}
                onBarClick={(d) => d.id && openStage(d.id)}
              />
            </Panel>
          </div>

          {/* Exact stage values, behind "Show table" on the funnel */}
          {showTable && (
            <div id="pipeline-stages">
              <Panel title="Stages" description="Exact funnel values. Stage durations are planning medians. Open a stage to see its cases." icon={<Layers />}>
                <DataTable<FunnelStage>
                  columns={stageColumns}
                  dataSource={data.stages}
                  rowKey="id"
                  pagination={false}
                  refreshing={loading}
                  onRowClick={setDrillStage}
                />
              </Panel>
            </div>
          )}
        </div>
      )}

      <Drawer
        open={!!drillStage}
        onClose={() => setDrillStage(null)}
        size={620}
        destroyOnHidden
        title={
          drillStage && (
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-500" />
              <span className="font-bold text-sm">{drillStage.label}</span>
              <span className="text-[11px] text-[#64748B] font-medium">{scopeLabel}</span>
            </div>
          )
        }
      >
        {drillStage &&
          (drillStage.id === 'reconciled' ? (
            <ReconciledBody filter={filter} />
          ) : (
            <StageCasesBody stage={drillStage} filter={filter} />
          ))}
      </Drawer>
    </div>
  );
}

function StageCasesBody({ stage, filter }: { stage: FunnelStage; filter: AnalyticsFilter }) {
  const { data, initialLoading, error, refetch } = useServiceQuery(
    () => analyticsService.stageCases(stage.id as FunnelStageId, filter),
    [stage.id, filter.tenant, filter.site],
    { subscribe: analyticsService.subscribe },
  );
  if (error && !data) return <ErrorState onRetry={refetch} compact />;
  if (initialLoading || !data) return <ListSkeleton rows={6} />;
  return (
    <div className="space-y-3 text-xs">
      <p className="m-0 text-[#64748B]">
        {stage.description}. {data.length} {data.length === 1 ? 'case is' : 'cases are'} in this stage now, oldest first.
      </p>
      {data.length === 0 ? (
        <EmptyState title="No cases in this stage" description="Nothing is waiting here for the selected tenant and site." compact />
      ) : (
        <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#F1F5F9] text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
                <th className="py-2 px-3 font-bold">Case</th>
                <th className="py-2 px-2 font-bold">Status</th>
                <th className="py-2 px-2 font-bold text-right whitespace-nowrap">Age</th>
                <th className="py-2 px-3 font-bold text-right whitespace-nowrap">Est. net</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-b border-[#F8FAFC] hover:bg-[#F8FAFC] transition-colors">
                  <td className="py-2 px-3 max-w-[240px]">
                    <CaseLink id={c.id} label={c.productName} />
                    <div className="text-[11px] text-[#94A3B8] truncate">
                      {c.location} · {c.tenant}
                    </div>
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    <StageBadge stage={c.stage} />
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-[#475569] whitespace-nowrap">{caseAgeDays(c)}d</td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-[#141416] whitespace-nowrap">
                    {fmtMoney(c.estimatedNetRecovery)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReconciledBody({ filter }: { filter: AnalyticsFilter }) {
  const { data, initialLoading, error, refetch } = useServiceQuery(
    () => analyticsService.reconciledByMonth(filter, 6),
    [filter.tenant, filter.site],
  );
  if (error && !data) return <ErrorState onRetry={refetch} compact />;
  if (initialLoading || !data) return <ListSkeleton rows={6} />;
  return (
    <div className="space-y-3 text-xs">
      <p className="m-0 text-[#64748B]">
        Reconciled decisions are closed records, so they no longer appear as live cases. Decisions reconciled per month for the selected scope:
      </p>
      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-[#F8FAFC] border-b border-[#F1F5F9] text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
              <th className="py-2 px-3 font-bold">Month</th>
              <th className="py-2 px-3 font-bold text-right">Decisions reconciled</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((m) => (
              <tr key={m.month} className="border-b border-[#F8FAFC] hover:bg-[#F8FAFC] transition-colors">
                <td className="py-2 px-3 font-semibold text-[#141416]">{m.month}</td>
                <td className="py-2 px-3 text-right font-mono font-bold text-[#141416]">{m.decisions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
