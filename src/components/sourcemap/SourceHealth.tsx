'use client';

import React, { useState } from 'react';
import { message } from 'antd';
import { ChevronDown, ChevronUp, Database, FileSpreadsheet, Zap } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { ago, dashboardService } from '@/services/dashboardService';
import { importService, type ImportHistoryRow } from '@/services/integrationService';
import { isFileSource, sourceService, type Source, type SourceStatus } from '@/services/sourceService';
import { DataTable, ErrorState, ListSkeleton, StatusBadge, type DataColumn } from '@/components/ui';
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

/** Health tab of the Sources page: connector health (problems first), workflow health and manual imports. */
export function SourceHealth({ onOpen }: { onOpen: (id: string) => void }) {
  const [testing, setTesting] = useState<string | null>(null);
  const [showHealthy, setShowHealthy] = useState(false);
  const q = useServiceQuery(() => dashboardService.health(), [], { subscribe: dashboardService.subscribeTechnical });
  const imports = useServiceQuery(() => importService.history(), [], { subscribe: importService.subscribe });
  const d = q.data;

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
    { title: 'Sync method', dataIndex: 'syncMethod', key: 'sync', priority: 3, render: (v: string) => <span className="text-xs text-[#334155]">{v}</span> },
    {
      title: 'Records (30 d)',
      dataIndex: 'records30d',
      key: 'records',
      priority: 2,
      align: 'right',
      render: (v: number) => <span className="font-mono text-xs font-bold text-[#141416]">{v.toLocaleString('en-US')}</span>,
    },
    {
      title: 'Last sync',
      dataIndex: 'lastSyncAt',
      key: 'last',
      priority: 2,
      render: (v: string, s) => (
        <span className="text-xs text-[#64748B]">
          {ago(v)} · <span className="font-mono">{s.successRate}%</span>
        </span>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      priority: 1,
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
