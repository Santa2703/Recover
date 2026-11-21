'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { ArrowRight, FileText, MessageSquareWarning, Target, TrendingDown, TrendingUp, UserCheck, Users } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import type { DecisionHistoryRecord, OverrideReason } from '@/models/decision.model';
import { CHANNEL_LABEL } from '@/services/decisionService';
import { hasCase, isWithin5, portfolioAnalyticsService, routeName, routeShort } from '@/services/portfolioAnalyticsService';
import { CaseLink, ChartSkeleton, DataTable, ErrorState, KpiSkeletonRow, MetricCard, Panel, type DataColumn } from '@/components/ui';
import { HorizontalBarChart } from '@/components/charts';
import { ClearButton, FilterRow, SearchBox, SelectFilter, downloadCsv, fmtDateTime, fmtMoney, fmtPct, fmtSignedMoney, fmtSignedPct } from '@/components/analytics/AnalyticsControls';
import { DecisionDrillDown, type DrillTarget } from '@/components/analytics/DecisionDrillDown';
import type { RegisterExport } from '@/components/analytics/useTabParam';

const money = (n: number) => (n < 0 ? `−${fmtMoney(-n)}` : fmtMoney(n));
const errPct = (h: DecisionHistoryRecord) => (h.realisedNet - h.forecastNet) / Math.max(1, Math.abs(h.forecastNet));

/** Owner overrides: closed decisions where a route owner chose a different route, why, and how they turned out. */
export function OverridesTab({ registerExport }: { registerExport: RegisterExport }) {
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState<'all' | OverrideReason>('all');
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const { data, initialLoading, loading, error, refetch } = useServiceQuery(() => portfolioAnalyticsService.overrides(), [], { subscribe: portfolioAnalyticsService.subscribe });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.overrides ?? []).filter(
      (h) =>
        (reason === 'all' || h.overrideReason === reason) &&
        (!term || [h.id, h.caseId, h.snapshot.productName, h.actor, h.overrideReason ?? ''].some((s) => s.toLowerCase().includes(term))),
    );
  }, [data, search, reason]);

  const filtered = reason !== 'all' || search.trim() !== '';
  const clear = () => {
    setReason('all');
    setSearch('');
  };

  const top = data ? [...data.byReason].sort((x, y) => y.n - x.n)[0] : undefined;

  const columns: DataColumn<DecisionHistoryRecord>[] = [
    {
      title: 'Case',
      key: 'case',
      priority: 1,
      render: (_, h) => (
        <div className="min-w-0">
          {hasCase(h.caseId) ? (
            <CaseLink id={h.caseId} label={h.snapshot.productName} />
          ) : (
            <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
              <span className="font-mono font-medium text-[#141416]">{h.caseId}</span>
              <span className="truncate text-[#64748B]">{h.snapshot.productName}</span>
            </span>
          )}
          <div className="truncate text-[11px] text-[#94A3B8]">
            {h.id} · {h.actor} · closed {h.closedAt}
          </div>
        </div>
      ),
    },
    {
      title: 'Circularity → owner · reason',
      key: 'routes',
      priority: 2,
      render: (_, h) => (
        <div className="min-w-0">
          <span className="flex min-w-0 items-center gap-1 text-xs">
            <span className="truncate text-[#64748B]" title={routeName(h.recommendedRoute)}>
              {routeShort(h.recommendedRoute)}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-[#94A3B8]" />
            <span className="truncate font-bold text-[#141416]" title={routeName(h.route)}>
              {routeShort(h.route)}
            </span>
          </span>
          <div className="truncate text-[11px] text-[#94A3B8]" title={h.overrideReason ?? ''}>
            {h.overrideReason}
          </div>
        </div>
      ),
    },
    {
      title: 'Realised',
      key: 'realised',
      priority: 1,
      align: 'right',
      render: (_, h) => (
        <div className="text-right">
          <span className="font-mono text-xs font-bold text-[#141416]">{money(h.realisedNet)}</span>
          {/* Within 5 % is neutral; outside it, above forecast is good (green) and below is bad (red). */}
          <div className={`font-mono text-[11px] ${isWithin5(h) ? 'text-[#64748B]' : h.realisedNet >= h.forecastNet ? 'text-[#047857]' : 'text-[#B91C1C]'}`}>
            {fmtSignedPct(errPct(h))} vs {money(h.forecastNet)}
          </div>
        </div>
      ),
    },
  ];

  // Hand this tab's export (the filtered log) to the page-level Export button.
  useEffect(() => {
    if (!data) return;
    registerExport(() => {
    downloadCsv(
      'owner-overrides.csv',
      ['Decision', 'Case', 'Asset', 'Intake channel', 'Circularity route', 'Owner route', 'Reason', 'Owner', 'Forecast net ($)', 'Realised net ($)', 'Standard net ($)', 'Realised gain over standard ($)', 'Closed'],
      rows.map((h) => [
        h.id,
        h.caseId,
        h.snapshot.productName,
        CHANNEL_LABEL[h.channel],
        routeName(h.recommendedRoute),
        routeName(h.route),
        h.overrideReason ?? '',
        h.actor,
        h.forecastNet,
        h.realisedNet,
        h.standardNet,
        h.realisedGain,
        h.closedAt,
      ]),
    );
    message.success('Override log exported (CSV)');
    });
    return () => registerExport(null);
  }, [data, rows, registerExport]);

  const realisedGain = data ? data.overrides.reduce((s, h) => s + h.realisedGain, 0) : 0;

  return (
    <div className="space-y-6">
      {error && !data ? (
        <Panel>
          <ErrorState onRetry={refetch} />
        </Panel>
      ) : initialLoading || !data ? (
        <>
          <KpiSkeletonRow count={4} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <Panel className="lg:col-span-2" title="Overrides by reason">
              <ChartSkeleton height={180} />
            </Panel>
            <Panel className="lg:col-span-3" title="Override log">
              <DataTable<DecisionHistoryRecord> columns={columns} initialLoading />
            </Panel>
          </div>
        </>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Owner overrides" value={data.overrides.length} unit="decisions" icon={<UserCheck />} context={`${fmtPct(data.share, 0)} of ${data.closed} closed decisions`} />
            <MetricCard
              label="Forecast accuracy, overrides"
              value={fmtPct(data.ownerAccuracy.accuracy, 1)}
              icon={<Target />}
              iconTone="blue"
              context={`All ${data.allAccuracy.n} closed decisions: ${fmtPct(data.allAccuracy.accuracy, 1)}`}
            />
            <MetricCard
              label="Realised gain over standard"
              value={fmtSignedMoney(realisedGain)}
              icon={realisedGain < 0 ? <TrendingDown /> : <TrendingUp />}
              iconTone={realisedGain >= 0 ? 'green' : 'red'}
              context="Overridden decisions vs the standard route"
            />
            <MetricCard
              label="Top override reason"
              value={<span className="block truncate font-sans text-base font-bold">{top?.n ? top.reason : '—'}</span>}
              icon={<FileText />}
              iconTone="slate"
              context={top?.n ? `${fmtPct(top.n / Math.max(1, data.overrides.length), 0)} of overrides` : undefined}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <Panel className="lg:col-span-2" title="Overrides by reason" description="Click a reason to see its decisions and how they turned out." icon={<MessageSquareWarning />}>
              <HorizontalBarChart
                data={data.byReason.map((r) => ({ id: r.reason, label: r.reason, value: r.n }))}
                seriesName="Overrides"
                labelWidth={170}
                ariaLabel="Owner overrides by reason"
                onBarClick={(d) => {
                  const records = data.overrides.filter((h) => h.overrideReason === d.id);
                  const r = data.byReason.find((x) => x.reason === d.id);
                  setDrill({ title: d.label, description: `${records.length} overrides · realised ${fmtSignedMoney(r?.realisedGain ?? 0)} over standard`, records });
                }}
              />
              <dl className="m-0 mt-4 divide-y divide-[#F1F5F9] border-t border-[#F1F5F9] text-xs">
                {data.byReason.map((r) => (
                  <div key={r.reason} className="flex items-center justify-between gap-3 py-2">
                    <dt className="min-w-0 truncate text-[#475569]">{r.reason}</dt>
                    <dd className="m-0 flex shrink-0 items-center gap-3 font-mono">
                      <span className="text-[#64748B]" title="Forecast accuracy">
                        {r.n ? fmtPct(r.accuracy, 1) : '—'}
                      </span>
                      <span className={`w-16 text-right font-bold ${r.realisedGain >= 0 ? 'text-[#047857]' : 'text-[#B91C1C]'}`} title="Realised gain over the standard route">
                        {fmtSignedMoney(r.realisedGain)}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="m-0 mt-2 text-[11px] text-[#94A3B8]">Per reason: forecast accuracy · realised gain over the standard route.</p>
            </Panel>

            <Panel className="lg:col-span-3" title="Override log" description="Open a row for the decision's forecast, realised value, standard route and reason." icon={<Users />}>
              <div className="space-y-4">
                <FilterRow>
                  <SearchBox value={search} onChange={setSearch} placeholder="Search case, asset, owner or reason" />
                  <SelectFilter<'all' | OverrideReason>
                    label="Reason"
                    value={reason}
                    onChange={setReason}
                    options={[{ value: 'all', label: 'All reasons' }, ...data.reasons.map((r) => ({ value: r, label: r }))]}
                  />
                  {filtered && <ClearButton onClick={clear} />}
                </FilterRow>
                <DataTable<DecisionHistoryRecord>
                  columns={columns}
                  dataSource={rows}
                  rowKey="id"
                  pagination={rows.length > 8 ? { pageSize: 8, size: 'small', showSizeChanger: false } : false}
                  refreshing={loading}
                  filtered={filtered}
                  onClearFilters={clear}
                  onRowClick={(h) => setDrill({ title: 'Override log', description: filtered ? 'Filtered overrides' : 'All overrides', records: rows, focusId: h.id })}
                />
              </div>
            </Panel>
          </div>

          {data.open.length > 0 && (
            <Panel title="Overrides on open cases" description="Logged on the Case page; they join the history when the outcome is recorded." icon={<UserCheck />}>
              <ul className="m-0 list-none divide-y divide-[#F1F5F9] p-0">
                {data.open.map((o) => (
                  <li key={`${o.caseId}-${o.at}`} className="flex flex-col gap-1 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                    <CaseLink id={o.caseId} label={o.productName} />
                    <span className="flex min-w-0 flex-wrap items-center gap-1 text-[#64748B]">
                      {routeName(o.fromRoute)} <ArrowRight className="h-3 w-3" /> <b className="text-[#141416]">{routeName(o.route)}</b> · {o.reason} · {o.actor} · {fmtDateTime(o.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      <DecisionDrillDown target={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
