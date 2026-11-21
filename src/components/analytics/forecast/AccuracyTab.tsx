'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { CalendarRange, CheckCircle, Route, Scale, ScatterChart as ScatterIcon, Target } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import type { DecisionHistoryRecord, RouteId } from '@/models/decision.model';
import { CHANNEL_LABEL } from '@/services/decisionService';
import { isWithin5, portfolioAnalyticsService, routeName } from '@/services/portfolioAnalyticsService';
import { seriesColors, chartColors } from '@/theme/tokens';
import { ChartSkeleton, ErrorState, KpiSkeletonRow, MetricCard, Panel } from '@/components/ui';
import { HorizontalBarChart, ScatterChart, StackedBarChart } from '@/components/charts';
import { downloadCsv, fmtMoney, fmtPct, fmtSignedPct } from '@/components/analytics/AnalyticsControls';
import { DecisionDrillDown, type DrillTarget } from '@/components/analytics/DecisionDrillDown';
import type { RegisterExport } from '@/components/analytics/useTabParam';

const money = (n: number) => (n < 0 ? `−${fmtMoney(-n)}` : fmtMoney(n));
const WHO = { circularity: "Circularity's route", owner: 'Owner override' } as const;
const weekOf = (h: DecisionHistoryRecord) => `W-${Math.floor(h.closedDaysAgo / 7)}`;

/** Forecast accuracy (formerly Predicted vs. actual): how closely each closed decision's forecast net matched what was realised. */
export function AccuracyTab({ registerExport, onShowOverrides }: { registerExport: RegisterExport; onShowOverrides: () => void }) {
  const { data, initialLoading, loading, error, refetch } = useServiceQuery(() => portfolioAnalyticsService.forecast(), [], { subscribe: portfolioAnalyticsService.subscribe });
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const scatter = useMemo(() => {
    const recs = data?.records ?? [];
    const pts = (who: 'circularity' | 'owner') =>
      recs.filter((h) => h.decidedBy === who).map((h) => ({ id: h.id, x: h.forecastNet, y: h.realisedNet, label: `${h.id} · ${h.caseId} · ${routeName(h.route)}` }));
    return [
      { key: 'circularity', label: WHO.circularity, color: seriesColors[0], data: pts('circularity') },
      { key: 'owner', label: WHO.owner, color: seriesColors[1], data: pts('owner') },
    ];
  }, [data]);

  const weeks = useMemo(() => (data?.byWeek ?? []).map((g) => ({ key: g.key, week: g.label.replace('Week of ', ''), label: g.label, forecast: g.forecast, realised: g.realised })), [data]);

  // Hand this tab's export to the page-level Export button.
  useEffect(() => {
    if (!data) return;
    registerExport(() => {
    downloadCsv(
      'forecast-vs-realised.csv',
      ['Decision', 'Case', 'Asset', 'Intake channel', 'Route', 'Decided by', 'Override reason', 'Forecast net ($)', 'Realised net ($)', 'Error (%)', 'Standard route', 'Standard net ($)', 'Closed'],
      data.records.map((h) => [
        h.id,
        h.caseId,
        h.snapshot.productName,
        CHANNEL_LABEL[h.channel],
        routeName(h.route),
        WHO[h.decidedBy],
        h.overrideReason ?? '',
        h.forecastNet,
        h.realisedNet,
        (((h.realisedNet - h.forecastNet) / Math.max(1, Math.abs(h.forecastNet))) * 100).toFixed(1),
        routeName(h.standardRoute),
        h.standardNet,
        h.closedAt,
      ]),
    );
    message.success('Decision history exported (CSV)');
    });
    return () => registerExport(null);
  }, [data, registerExport]);

  const a = data?.accuracy;

  return (
    <div className="space-y-6">
      {error && !data ? (
        <Panel>
          <ErrorState onRetry={refetch} />
        </Panel>
      ) : initialLoading || !data || !a ? (
        <>
          <KpiSkeletonRow count={4} />
          <Panel title="Forecast vs realised">
            <ChartSkeleton height={300} />
          </Panel>
        </>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Forecast accuracy" value={fmtPct(a.accuracy, 1)} icon={<Target />} context="1 − total miss ÷ total forecast" />
            <MetricCard
              label="Within 5 % of forecast"
              value={fmtPct(a.within5, 0)}
              icon={<CheckCircle />}
              iconTone={a.within5 >= 0.5 ? 'green' : 'amber'}
              context={`${Math.round(a.within5 * a.n)} of ${a.n} decisions`}
            />
            <MetricCard
              label="Forecast bias"
              value={fmtSignedPct(a.bias, 1)}
              icon={<Scale />}
              iconTone="slate"
              context={a.bias < 0 ? 'Realised a little below forecast' : 'Realised a little above forecast'}
            />
            <MetricCard label="Realised net" value={money(a.realised)} icon={<CalendarRange />} iconTone="blue" context={`Forecast ${money(a.forecast)}`} />
          </div>

          <Panel
            title="Forecast vs realised"
            description={
              <>
                Each dot is one closed decision. Dots on the dashed line were forecast perfectly; click a dot to open that decision. How owner overrides compare is on{' '}
                <button type="button" onClick={onShowOverrides} className="cursor-pointer bg-transparent p-0 text-xs font-semibold text-[#141416] underline">
                  Overrides
                </button>
                .
              </>
            }
            icon={<ScatterIcon />}
          >
              <ScatterChart
                series={scatter}
                xLabel="Forecast net"
                yLabel="Realised net"
                identityLine="Perfect forecast"
                valueFormat={money}
                height={300}
                ariaLabel={`Forecast against realised net for ${a.n} closed decisions`}
                onPointClick={(p) => {
                  const h = data.records.find((r) => r.id === p.id);
                  if (h) setDrill({ title: `${h.id} · ${h.caseId}`, description: h.snapshot.productName, records: [h], focusId: h.id });
                }}
              />
          </Panel>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            <Panel
              className="xl:col-span-3"
              title="Forecast and realised by week"
              description="Net value of decisions closed each week. Click a week to see its decisions."
              icon={<CalendarRange />}
            >
              <StackedBarChart
                data={weeks}
                xKey="week"
                grouped
                series={[
                  { key: 'forecast', label: 'Forecast', color: chartColors.predicted },
                  { key: 'realised', label: 'Realised', color: chartColors.actual },
                ]}
                valueFormat={money}
                height={260}
                ariaLabel="Forecast and realised net value by week closed"
                onBarClick={(w) => {
                  const records = data.records.filter((h) => weekOf(h) === w.key);
                  setDrill({ title: w.label, description: `${records.length} decisions closed that week`, records });
                }}
              />
            </Panel>
            <Panel
              className="xl:col-span-2"
              title="Within 5 % by route"
              description="Share of decisions on each executed route that landed within 5 % of the forecast. Click a route to see its decisions."
              icon={<Route />}
            >
              <HorizontalBarChart
                data={data.byRoute.filter((g) => Math.round(g.within5 * 100) > 0).map((g) => ({ id: g.key, label: g.label, value: Math.round(g.within5 * 100) }))}
                valueFormat={(v) => `${v} %`}
                seriesName="Within 5 % of forecast"
                labelWidth={150}
                ariaLabel="Share of decisions within 5 % of forecast by route executed"
                onBarClick={(d) => {
                  const records = data.records.filter((h) => h.route === (d.id as RouteId));
                  setDrill({ title: d.label, description: `${records.length} closed decisions · ${records.filter(isWithin5).length} within 5 %`, records });
                }}
              />
              {data.byRoute.some((g) => Math.round(g.within5 * 100) === 0) && (
                <p className="m-0 mt-3 text-[11px] text-[#64748B]">
                  0 % within 5 %:{' '}
                  {data.byRoute
                    .filter((g) => Math.round(g.within5 * 100) === 0)
                    .map((g) => g.label)
                    .join(', ')}
                  .
                </p>
              )}
            </Panel>
          </div>
        </div>
      )}

      <DecisionDrillDown target={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
