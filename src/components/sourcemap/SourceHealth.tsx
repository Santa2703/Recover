'use client';

import React, { useState } from 'react';
import { message } from 'antd';
import { BarChart3, CheckCircle2, ChevronDown, ChevronUp, Database, FileSpreadsheet, Gauge, Timer, TriangleAlert, Zap } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { dashboardService } from '@/services/dashboardService';
import { importService, type ImportHistoryRow } from '@/services/integrationService';
import { durationLabel, isFileSource, slaLabel, sourceService, type Source, type SourceSlaRow, type SourceStatus } from '@/services/sourceService';
import { ChartSkeleton, DataTable, ErrorState, KpiSkeletonRow, ListSkeleton, MetricCard, StatusBadge, type DataColumn } from '@/components/ui';
import { StackedBarChart } from '@/components/charts';
import { tokens } from '@/theme/tokens';
import type { Tone } from '@/theme/tokens';
import { CardLink, SectionCard } from '@/components/dashboard/SectionCard';
import { WorkflowHealthBody } from '@/components/dashboard/WorkflowHealth';
import { fmtDateTime } from '@/components/integration/format';

const STATUS: Record<SourceStatus, { label: string; tone: Tone }> = {
  healthy: { label: 'Operational', tone: 'success' },
  warning: { label: 'Warning', tone: 'warning' },
  stale: { label: 'Stale feed', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  paused: { label: 'Paused', tone: 'neutral' },
};
const STATUS_ORDER: Record<SourceStatus, number> = { failed: 0, warning: 1, stale: 2, paused: 3, healthy: 4 };

/**
 * Health tab of the Sources page: the integration SLA monitor (sync success, latency, failed records, freshness
 * against SLA and the last 24 hours of runs), connector health (problems first), workflow health and manual imports.
 */
export function SourceHealth({ onOpen }: { onOpen: (id: string) => void }) {
  const [testing, setTesting] = useState<string | null>(null);
  const [showHealthy, setShowHealthy] = useState(false);
  const q = useServiceQuery(() => dashboardService.health(), [], { subscribe: dashboardService.subscribeTechnical });
  const imports = useServiceQuery(() => importService.history(), [], { subscribe: importService.subscribe });
  const mon = useServiceQuery(() => sourceService.monitor(), [], { subscribe: sourceService.subscribe });
  const d = q.data;
  const sla = new Map<string, SourceSlaRow>((mon.data?.rows ?? []).map((r) => [r.id, r]));
  const k = mon.data?.kpis;

  const test = async (s: Source) => {
    setTesting(s.id);
    try {
      const r = await sourceService.testConnection(s.id);
      if (r.ok) message.success(`${s.name}: ${r.message}`);
      else message.error(`${s.name}: ${r.message}`);
    } finally {
      setTesting(null);
    }
  };

  const columns: DataColumn<Source>[] = [
    {
      title: 'Connected system',
      key: 'name',
      priority: 1,
      render: (_, s) => (
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-[#141416]">{s.name}</div>
          <div className="truncate text-[11px] text-[#64748B]">
            {s.category} · {s.vendor}
          </div>
        </div>
      ),
    },
    {
      title: 'SLA',
      key: 'sla',
      priority: 1,
      width: 140,
      render: (_, s) => {
        const r = sla.get(s.id);
        if (!r) return <span className="text-xs text-[#94A3B8]">-</span>;
        return (
          <div className="min-w-0">
            {r.withinSla === null ? (
              <StatusBadge tone="neutral" icon={false}>
                {r.slaMinutes == null ? 'No SLA' : 'Paused'}
              </StatusBadge>
            ) : r.withinSla ? (
              <StatusBadge tone="success">Within SLA</StatusBadge>
            ) : (
              <StatusBadge tone="danger">Outside SLA</StatusBadge>
            )}
            <div className="mt-0.5 truncate text-[11px] text-[#64748B]">{slaLabel(r.slaMinutes)}</div>
          </div>
        );
      },
    },
    {
      title: 'Freshness',
      key: 'fresh',
      priority: 2,
      width: 100,
      align: 'right',
      render: (_, s) => {
        const r = sla.get(s.id);
        return r ? (
          <span className="whitespace-nowrap font-mono text-xs text-[#334155]" data-tip={`Last data received ${fmtDateTime(r.lastSuccessAt)} · ${s.syncMethod}`}>
            {durationLabel(r.freshnessMin)}
          </span>
        ) : null;
      },
    },
    {
      title: 'Success (24 h)',
      key: 'success',
      priority: 2,
      width: 120,
      align: 'right',
      render: (_, s) => {
        const r = sla.get(s.id);
        if (!r) return null;
        return (
          <span className={`font-mono text-xs font-bold ${r.successPct24h != null && r.successPct24h < 95 ? 'text-[#B91C1C]' : 'text-[#141416]'}`} data-tip={`${r.runs24h} runs in the last 24 hours`}>
            {r.successPct24h == null ? '-' : `${r.successPct24h}%`}
          </span>
        );
      },
    },
    {
      title: 'Failed (7 d)',
      key: 'failed7',
      priority: 3,
      width: 105,
      align: 'right',
      render: (_, s) => <span className="font-mono text-xs text-[#141416]">{(sla.get(s.id)?.failedRecords7d ?? 0).toLocaleString('en-US')}</span>,
    },
    {
      title: 'Latency',
      key: 'latency',
      priority: 3,
      width: 95,
      align: 'right',
      render: (_, s) => {
        const v = sla.get(s.id)?.latencyMs;
        return <span className="font-mono text-xs text-[#141416]">{v == null ? '-' : `${v.toLocaleString('en-US')} ms`}</span>;
      },
    },
    {
      title: 'Status',
      key: 'status',
      priority: 1,
      width: 130,
      render: (_, s) => (
        <span data-tip={s.statusNote ?? undefined}>
          <StatusBadge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</StatusBadge>
        </span>
      ),
    },
    {
      title: '',
      key: 'action',
      priority: 1,
      align: 'right',
      width: 90,
      ellipsis: false,
      render: (_, s) =>
        isFileSource(s) ? null : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              test(s);
            }}
            disabled={testing === s.id}
            className="cursor-pointer whitespace-nowrap rounded-xl border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] hover:border-gray-400 disabled:cursor-wait disabled:opacity-50"
          >
            {testing === s.id ? 'Testing…' : 'Test'}
          </button>
        ),
    },
  ];

  const importColumns: DataColumn<ImportHistoryRow>[] = [
    {
      title: 'Import',
      key: 'id',
      priority: 1,
      render: (_, h) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-bold text-[#141416]">{h.fileName}</div>
          <div className="truncate text-[11px] text-[#64748B]">
            {h.id} → {h.modelName}
            {h.source ? ` · ${h.source}` : ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Rows',
      key: 'rows',
      priority: 1,
      align: 'right',
      render: (_, h) => (
        <span className="whitespace-nowrap font-mono text-xs">
          <span className="font-bold text-[#047857]">{h.committed}</span>
          <span className="text-[#94A3B8]"> / {h.rows}</span>
          {h.rejected > 0 && <span className="text-[#B91C1C]"> · {h.rejected} rejected</span>}
        </span>
      ),
    },
    {
      title: 'When',
      key: 'at',
      priority: 2,
      render: (_, h) => (
        <span className="text-xs text-[#64748B]">
          {fmtDateTime(h.at)} · {h.by}
        </span>
      ),
    },
  ];

  if (q.error && !d) return <ErrorState onRetry={q.refetch} />;
  const wf = d?.workflows;
  const sources = d?.sources ?? [];
  const problemSources = sources.filter((s) => s.status !== 'healthy').sort((a, c) => STATUS_ORDER[a.status] - STATUS_ORDER[c.status]);
  const healthySources = sources.filter((s) => s.status === 'healthy');
  const shownSources = showHealthy ? [...problemSources, ...healthySources] : problemSources;

  return (
    <div className="space-y-6">
      {mon.initialLoading || !k ? (
        <KpiSkeletonRow count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Sync success"
            value={`${k.syncSuccessPct}%`}
            context={`${k.successful24h.toLocaleString('en-US')} of ${k.runs24h.toLocaleString('en-US')} runs, last 24 hours`}
            icon={<CheckCircle2 />}
            iconTone={k.syncSuccessPct >= 97 ? 'green' : 'amber'}
          />
          <MetricCard label="Average latency" value={`${k.avgLatencyMs.toLocaleString('en-US')} ms`} context="Per sync request, last 24 hours" icon={<Timer />} />
          <MetricCard
            label="Failed records"
            value={k.failedRecords7d.toLocaleString('en-US')}
            context="Last 7 days, held for reprocessing"
            icon={<TriangleAlert />}
            iconTone={k.failedRecords7d ? 'amber' : 'green'}
          />
          <MetricCard
            label="Fresh within SLA"
            value={`${k.freshWithinSla} / ${k.slaSources}`}
            context="Connected sources with a freshness SLA"
            icon={<Gauge />}
            iconTone={k.freshWithinSla === k.slaSources ? 'green' : 'red'}
          />
        </div>
      )}

      <SectionCard
        title="Sync runs, last 24 hours"
        icon={<BarChart3 />}
        actions={k ? <span className="text-[11px] font-semibold text-[#64748B]">Each bar is one hour (UTC)</span> : undefined}
      >
        {mon.initialLoading || !mon.data || !k ? (
          <ChartSkeleton />
        ) : (
          <StackedBarChart
            data={mon.data.hourly}
            xKey="hour"
            height={220}
            ariaLabel={`Sync runs per hour over the last 24 hours: ${k.successful24h} successful, ${k.warnings24h} with warnings, ${k.failures24h} failed`}
            series={[
              { key: 'successful', label: `Successful ${k.successful24h.toLocaleString('en-US')}`, color: tokens.success },
              { key: 'warnings', label: `Warnings ${k.warnings24h}`, color: '#F59E0B' },
              { key: 'failures', label: `Failures ${k.failures24h}`, color: tokens.danger },
            ]}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Connector health"
        icon={<Database />}
        actions={d ? <span className="text-[11px] font-semibold text-[#64748B]">{problemSources.length} need attention · {sources.length} sources</span> : undefined}
      >
        <DataTable<Source>
          columns={columns}
          dataSource={shownSources}
          rowKey="id"
          initialLoading={q.initialLoading}
          refreshing={q.loading && !q.initialLoading}
          pagination={false}
          onRowClick={(s) => onOpen(s.id)}
          emptyTitle={healthySources.length ? 'Every connector is healthy' : 'No sources connected'}
        />
        {healthySources.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHealthy((v) => !v)}
            aria-expanded={showHealthy}
            className="mt-3 inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs font-semibold text-[#64748B] hover:text-[#141416]"
          >
            {showHealthy ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {healthySources.length} healthy, {showHealthy ? 'hide' : 'show'}
          </button>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Workflow health" icon={<Zap className="fill-[#F59E0B]" />} actions={<CardLink href="/integration/studio">Workflows</CardLink>}>
          {q.initialLoading || !d || !wf ? (
            <ListSkeleton rows={3} />
          ) : (
            <div className="space-y-4">
              <WorkflowHealthBody wf={wf} runRecords={d.workflowRuns.map((r) => r.records)} />
              {wf.failingNames.length > 0 && <div className="text-[11px] text-[#B91C1C]">Failing: {wf.failingNames.join(', ')}</div>}
            </div>
          )}
        </SectionCard>
        <SectionCard title="Manual imports" icon={<FileSpreadsheet />}>
          <DataTable<ImportHistoryRow>
            columns={importColumns}
            dataSource={(imports.data ?? []).slice(0, 5)}
            rowKey="id"
            initialLoading={imports.initialLoading}
            pagination={false}
            emptyTitle="No CSV imports yet"
          />
        </SectionCard>
      </div>
    </div>
  );
}
