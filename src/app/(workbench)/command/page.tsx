'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { message } from 'antd';
import { AlertTriangle, ArrowRight, BarChart2, Clock, Database, Download, Layers, Package, Sparkles, TrendingUp } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { metricsService, type Scope } from '@/services/metricsService';
import { asOfLabel, dashboardService, formatMoney, keyFiguresCsv, type ComparePeriod } from '@/services/dashboardService';
import type { DispositionRouteId } from '@/models/treatment.model';
import { ChartSkeleton, ErrorState, HowCalculated, KpiSkeletonRow, ListSkeleton, PageActions, PageHeader, TrendIndicator } from '@/components/ui';
import { decisionService } from '@/services/decisionService';
import { ChannelGapPanel } from '@/components/keyfigures/ChannelGapPanel';
import { QueuePlanPanel } from '@/components/keyfigures/QueuePlanPanel';
import { BarChart, HorizontalBarChart, SegmentedBar, StackedBarChart } from '@/components/charts';
import { chartColors } from '@/theme/tokens';
import { SectionCard } from '@/components/dashboard/SectionCard';
import { KpiCard } from '@/components/keyfigures/KpiCard';
import { LabeledSelect, MoreFilters } from '@/components/keyfigures/KeyFigureFilters';

const RANGES = [3, 6, 12] as const;
const PERIODS: { value: string; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
];
const TONE_COLOR = { danger: '#EF4444', warning: '#F59E0B', neutral: '#FDE047', success: '#10B981' } as const;

const pctChange = (cur: number, prior: number) => (prior ? Math.round(((cur - prior) / prior) * 100) : null);

/** Change in intake: cases received in the last N days versus the N days before. */
function WindowTrend({ now, prior, period, money, upIsGood = true }: { now: number; prior: number; period: number; money?: boolean; upIsGood?: boolean }) {
  const pct = pctChange(now, prior);
  const fmt = (v: number) => (money ? formatMoney(v) : String(v));
  return (
    <span title={`Received in the last ${period} days: ${fmt(now)}; the ${period} days before: ${fmt(prior)}`}>
      <TrendIndicator value={pct ?? now - prior} format={(v) => (pct === null ? fmt(v) : `${v}%`)} upIsGood={upIsGood} label={`vs previous ${period} days`} />
    </span>
  );
}

const SHORT_ROUTE: Record<string, string> = { intparts: 'Int. parts', extparts: 'Ext. parts', material: 'Material', exit: 'Exit', relase: 'Re-lease' };

export default function KeyFiguresPage() {
  const { currentTenant, scope: authScope } = useAuth();
  const options = useMemo(() => dashboardService.filterOptions(), []);

  const [siteOverride, setSite] = useState<string | null>(null);
  const [assetClass, setAssetClass] = useState('all');
  const [route, setRoute] = useState('all');
  const [period, setPeriod] = useState<ComparePeriod>(14);
  const [months, setMonths] = useState<(typeof RANGES)[number]>(12);

  // Tenant comes from the header scope; the page has no tenant picker of its own.
  const tenant = currentTenant;
  const site = siteOverride ?? authScope.site ?? 'all';
  const scope: Scope = {
    tenant: tenant === 'All' ? undefined : tenant,
    site: site === 'all' ? undefined : site,
    route: route as DispositionRouteId | 'all',
    productClass: assetClass,
  };

  const kf = useServiceQuery(() => dashboardService.keyFigures(scope, period), [tenant, site, route, assetClass, period], { subscribe: metricsService.subscribe });
  const vr = useServiceQuery(() => metricsService.valueRealisation(months), [months]);
  // Decision figures for the same scope as the KPIs (gain over the standard route, queue plan, gap by channel).
  const dq = useServiceQuery(() => decisionService.summary(scope), [tenant, site, route, assetClass], { subscribe: decisionService.subscribe });
  const ds = dq.data;
  const k = kf.data;
  const p = k?.portfolio;
  const loading = kf.initialLoading || !k || !p;

  const tenantOptions = [{ value: 'All', label: 'All tenants' }, ...options.tenants.map((t) => ({ value: t, label: t }))];
  const siteOptions = [{ value: 'all', label: 'All operations' }, ...options.sites.map((s) => ({ value: s, label: s }))];
  const classOptions = [{ value: 'all', label: 'All assets' }, ...options.assetClasses.map((c) => ({ value: c.id, label: c.label }))];
  const routeOptions = [{ value: 'all', label: 'All routes' }, ...options.routes.map((r) => ({ value: r.id, label: r.label }))];
  const labelOf = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v;

  const exportCsv = () => {
    if (!k) return;
    const csv = keyFiguresCsv(k, ds, {
      Tenant: labelOf(tenantOptions, tenant),
      Scope: labelOf(siteOptions, site),
      'Asset class': labelOf(classOptions, assetClass),
      Route: labelOf(routeOptions, route),
      'Compared with': `${period} days ago`,
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `key-figures-${metricsService.meta().asOf.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('Key figures exported as CSV');
  };

  const vrd = vr.data;
  const t = vrd?.totals;
  const prev = vrd?.previous;
  const hasPrev = !!prev && prev.netRecovery > 0;

  const actionable = p ? p.timeToAction.reduce((s, x) => s + x.count, 0) : 0;
  const topRoute = p?.routeOpportunity.reduce<(typeof p.routeOpportunity)[number] | undefined>((best, r) => (!best || r.value > best.value ? r : best), undefined);
  const topReason = p?.valueAtRiskByReason[0];

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Circularity Command Center"
        description="Identify, prioritise and act on lifecycle opportunities to maximise economic, operational and sustainability outcomes."
        actions={
          <PageActions
            meta={asOfLabel(metricsService.meta().asOf)}
            secondary={[{ key: 'export', label: 'Export CSV', icon: <Download />, onClick: exportCsv, disabled: !k }]}
          />
        }
      />

      {/* Filters: Time visible, the rest in a popover. Tenant is set in the header. */}
      <div className="flex flex-wrap items-center gap-2">
        <LabeledSelect label="Time" value={String(period)} onChange={(v) => setPeriod(Number(v) as ComparePeriod)} options={PERIODS} width={190} />
        <MoreFilters
          filters={[
            { key: 'scope', label: 'Scope', value: site, options: siteOptions, onChange: setSite },
            { key: 'class', label: 'Asset class', value: assetClass, options: classOptions, onChange: setAssetClass },
            { key: 'route', label: 'Recommended route', value: route, options: routeOptions, onChange: setRoute },
          ]}
          onClear={() => {
            setSite('all');
            setAssetClass('all');
            setRoute('all');
          }}
        />
        {kf.loading && !kf.initialLoading && <span className="text-[11px] text-[#94A3B8]">Updating…</span>}
      </div>

      {kf.error && !k ? (
        <ErrorState onRetry={kf.refetch} />
      ) : loading || !k || !p || !ds ? (
        <KpiSkeletonRow count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Awaiting approval"
            value={p.awaitingApproval.count}
            icon={<Layers />}
            tone="amber"
            href="/command/actions?tab=approvals"
            info={<HowCalculated kpi="decisionsWaiting" scope={scope} variant="icon" label="Awaiting approval" />}
            change={<WindowTrend now={k.current.awaiting} prior={k.prior.awaiting} period={period} upIsGood={false} />}
            period="Decisions ready to sign off, now"
          />
          <KpiCard
            label="Potential recovery value"
            value={formatMoney(p.potentialRecovery)}
            icon={<Database />}
            tone="green"
            info={<HowCalculated kpi="potentialRecovery" scope={scope} variant="icon" label="Potential recovery value" />}
            change={<WindowTrend now={k.current.potentialRecovery} prior={k.prior.potentialRecovery} period={period} money />}
            period="Predicted net recovery, open cases"
          />
          <KpiCard
            label="Value at risk"
            value={formatMoney(p.valueAtRisk)}
            icon={<AlertTriangle />}
            tone="red"
            href="/command/exceptions"
            info={<HowCalculated kpi="valueAtRisk" scope={scope} variant="icon" label="Value at risk" />}
            change={<WindowTrend now={k.current.valueAtRisk} prior={k.prior.valueAtRisk} period={period} money upIsGood={false} />}
            period="All cases in scope, now"
          />
          <KpiCard
            label="Gain over standard"
            value={`${ds.gainOverStandard < 0 ? '−' : '+'}${formatMoney(Math.abs(ds.gainOverStandard))}`}
            icon={<TrendingUp />}
            tone="green"
            info={<HowCalculated kpi="gainOverStandard" scope={scope} variant="icon" label="Gain over the standard route" />}
            change={<span className="text-[11px] font-semibold text-[#64748B]">On {ds.openDecisions} open decisions</span>}
            period="vs each intake team's own route"
          />
        </div>
      )}

      {/* Where the gain comes from + queue plan */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <ChannelGapPanel className="xl:col-span-7" data={ds} scope={scope} />
        <QueuePlanPanel className="xl:col-span-5" data={ds} scope={scope} />
      </div>

      {/* Value realisation + value at risk */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <SectionCard
          className="xl:col-span-7"
          title="Value Realisation"
          icon={<BarChart2 />}
          actions={
            <div className="flex items-center gap-1 rounded-lg bg-[#F1F5F9] p-0.5 text-xs font-semibold" role="group" aria-label="Months shown">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={months === r}
                  onClick={() => setMonths(r)}
                  className={`cursor-pointer rounded-md px-2.5 py-1 transition-all ${months === r ? 'bg-[#FDE047] font-bold text-[#141416] shadow-xs' : 'text-[#64748B] hover:text-[#141416]'}`}
                >
                  {r} mo
                </button>
              ))}
            </div>
          }
        >
          {vr.initialLoading || !vrd || !t ? (
            <ChartSkeleton height={240} />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#64748B]">
                <span>
                  Net recovery <strong className="font-mono text-[#141416]">{formatMoney(t.netRecovery)}</strong>
                  {hasPrev && <> <TrendIndicator value={pctChange(t.netRecovery, prev.netRecovery) ?? 0} format={(v) => `${v}%`} /></>}
                </span>
                <span>
                  Yield <strong className="font-mono text-[#141416]">{Math.round(t.recoveryYield * 100)}%</strong>
                  {hasPrev && <> <TrendIndicator value={Math.round((t.recoveryYield - prev.recoveryYield) * 100)} format={(v) => `${v} pp`} /></>}
                </span>
                <span>
                  Cycle time <strong className="font-mono text-[#141416]">{t.cycleTimeDays} days</strong>
                  {hasPrev && <> <TrendIndicator value={Math.round((t.cycleTimeDays - prev.cycleTimeDays) * 10) / 10} format={(v) => `${v} d`} upIsGood={false} /></>}
                </span>
                <span>
                  CO₂e avoided <strong className="font-mono text-[#141416]">{t.co2AvoidedT} t</strong>
                </span>
              </div>
              <StackedBarChart
                grouped
                data={vrd.months}
                xKey="month"
                series={[
                  { key: 'predictedRecovery', label: 'Predicted recovery', color: chartColors.neutralSoft },
                  { key: 'actualRecovery', label: 'Actual recovery', color: chartColors.actual },
                ]}
                valueFormat={formatMoney}
                height={230}
                ariaLabel={`Predicted versus actual recovery per month, last ${months} months. Net recovery ${formatMoney(t.netRecovery)}.`}
              />
            </div>
          )}
        </SectionCard>

        <SectionCard
          className="xl:col-span-5"
          title="Value at risk by reason"
          icon={<AlertTriangle />}
          actions={p ? <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[10px] font-bold text-[#B91C1C]">{formatMoney(p.valueAtRisk)} total</span> : undefined}
        >
          {loading || !p ? (
            <ListSkeleton rows={4} />
          ) : (
            <div>
              {p.valueAtRiskByReason.length ? (
                <HorizontalBarChart
                  data={p.valueAtRiskByReason.map((r) => ({ id: r.id, label: r.label, value: r.value }))}
                  highlight={topReason?.id}
                  valueFormat={formatMoney}
                  labelWidth={150}
                  seriesName="Value at risk"
                  ariaLabel={`Value at risk by reason, total ${formatMoney(p.valueAtRisk)}`}
                />
              ) : (
                <div className="py-4 text-center text-xs text-[#64748B]">No value at risk in this scope.</div>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Channel opportunity + lifecycle */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <SectionCard className="xl:col-span-7" title="Channel Opportunity" icon={<Package />} actions={topRoute ? <span className="text-[11px] font-semibold text-[#64748B]">Top: {topRoute.label}</span> : undefined}>
          {loading || !p ? (
            <ChartSkeleton height={240} />
          ) : (
            <BarChart
              data={p.routeOpportunity.map((r) => ({ id: r.id, label: SHORT_ROUTE[r.id] ?? r.label, value: r.value }))}
              highlight={topRoute?.id}
              valueFormat={formatMoney}
              seriesName="Predicted net recovery"
              height={240}
              ariaLabel={`Predicted net recovery by recommended route; top route ${topRoute?.label ?? 'none'}`}
            />
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-5" title="Lifecycle Portfolio" icon={<Layers />} actions={p ? <span className="text-[11px] font-semibold text-[#64748B]">{p.assetsInScope} assets</span> : undefined}>
          {loading || !p ? (
            <ListSkeleton rows={5} />
          ) : (
            <HorizontalBarChart
              data={p.lifecycle.map((l) => ({ id: l.id, label: l.label, value: l.count }))}
              highlight="awaiting_approval"
              labelWidth={170}
              seriesName="Assets"
              ariaLabel={`Assets by lifecycle stage, ${p.assetsInScope} in scope`}
            />
          )}
        </SectionCard>
      </div>

      {/* Time to action */}
      <SectionCard title="Assets by Time to Action" icon={<Clock />} actions={p ? <span className="text-[11px] font-semibold text-[#64748B]">{actionable} actionable assets</span> : undefined}>
        {loading || !p ? (
          <ListSkeleton rows={1} />
        ) : (
          <SegmentedBar
            unit="assets"
            ariaLabel={`${actionable} actionable assets by days until action is due`}
            segments={p.timeToAction.map((s) => ({ id: s.id, label: s.label, value: s.count, color: TONE_COLOR[s.tone] }))}
          />
        )}
      </SectionCard>

      {/* What these figures mean: one line */}
      {p && topReason && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-[#FDE68A] bg-[#FFFDF2] px-5 py-3 shadow-2xs">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-[#D97706]">
              <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="hidden sm:inline">What these figures mean</span>
            </span>
            <p className="m-0 min-w-0 truncate text-xs font-medium text-[#78350F]">
              {Math.round((topReason.value / Math.max(1, p.valueAtRisk)) * 100)}% of value at risk is {topReason.label.toLowerCase()}. Clearing the {p.awaitingApproval.count} cases awaiting approval releases{' '}
              {formatMoney(p.awaitingApproval.value)} of predicted recovery.
            </p>
          </div>
          <Link href="/analytics" aria-label="Open analytics" className="flex shrink-0 items-center text-[#92400E] hover:text-[#78350F]">
            <ArrowRight size={16} />
          </Link>
        </div>
      )}
    </div>
  );
}
