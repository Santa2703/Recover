'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Drawer, message } from 'antd';
import { AlertTriangle, BrainCircuit, Cpu, GitBranch, LineChart as LineIcon } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { analyticsService, type ModelRecord, type ModelStatus } from '@/services/analyticsService';
import { chartColors, type Tone } from '@/theme/tokens';
import {
  ChartSkeleton,
  DataTable,
  ErrorState,
  KpiSkeletonRow,
  MetricCard,
  Panel,
  StatusBadge,
  type DataColumn,
} from '@/components/ui';
import { LineChart } from '@/components/charts';
import { ClearButton, FilterRow, SearchBox, SelectFilter, downloadCsv } from '@/components/analytics/AnalyticsControls';
import type { RegisterExport } from '@/components/analytics/useTabParam';

const STATUS_META: Record<ModelStatus, { label: string; tone: Tone }> = {
  production: { label: 'Production', tone: 'success' },
  shadow: { label: 'Shadow / canary', tone: 'info' },
  retraining: { label: 'Retraining', tone: 'warning' },
  deprecated: { label: 'Deprecated', tone: 'neutral' },
};

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtBias = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

type StatusFilter = 'all' | ModelStatus;

/** Model versions: which decision models are live, their drift, and whether each recovery-model release reduced bias. */
export function ModelsTab({ registerExport }: { registerExport: RegisterExport }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [open, setOpen] = useState<ModelRecord | null>(null);
  const { data, initialLoading, loading, error, refetch } = useServiceQuery(() => analyticsService.models(), []);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.registry ?? []).filter(
      (m) =>
        (status === 'all' || m.status === status) &&
        (!term || [m.name, m.id, m.domain, m.framework, m.version].some((s) => s.toLowerCase().includes(term))),
    );
  }, [data, search, status]);

  const biasData = useMemo(() => (data?.releases ?? []).map((r) => ({ version: r.version, bias: Math.round(r.bias * 1000) / 10 })), [data]);
  const live = data?.releases.find((r) => r.current);
  const threshold = data?.driftThreshold ?? 5;
  const filtered = status !== 'all' || search.trim() !== '';
  const clear = () => {
    setStatus('all');
    setSearch('');
  };

  const columns: DataColumn<ModelRecord>[] = [
    {
      title: 'Model',
      key: 'name',
      priority: 1,
      render: (_, m) => (
        <div className="min-w-0">
          <span className="block truncate text-xs font-bold text-[#141416]">{m.name}</span>
          <span className="font-mono text-[11px] text-[#64748B]">
            {m.id} · {m.version}
          </span>
        </div>
      ),
    },
    { title: 'Domain', dataIndex: 'domain', key: 'domain', priority: 3, render: (v: string) => <span className="text-xs text-[#475569]">{v}</span> },
    { title: 'Status', dataIndex: 'status', key: 'status', priority: 1, render: (s: ModelStatus) => <StatusBadge tone={STATUS_META[s].tone}>{STATUS_META[s].label}</StatusBadge> },
    {
      title: 'Validation',
      key: 'metric',
      priority: 2,
      render: (_, m) => (
        <span className="text-xs text-[#64748B]">
          {m.primaryMetric} <span className="font-mono font-bold text-[#141416]">{m.metricValue}</span>
        </span>
      ),
    },
    {
      title: 'Drift',
      dataIndex: 'drift',
      key: 'drift',
      priority: 2,
      align: 'right',
      render: (v: number) => (
        <span className={`inline-flex items-center gap-1 font-mono text-xs font-semibold ${v > threshold ? 'text-[#D97706]' : 'text-[#059669]'}`}>
          {v > threshold && <AlertTriangle className="h-3.5 w-3.5" aria-label="Above drift threshold" />}
          {v.toFixed(1)}%
        </span>
      ),
    },
    { title: 'Last trained', dataIndex: 'lastTrained', key: 'lastTrained', priority: 3, render: (v: string) => <span className="text-xs text-[#64748B]">{fmtDate(v)}</span> },
  ];

  // Hand this tab's export (the filtered registry) to the page-level Export button.
  useEffect(() => {
    if (!data) return;
    registerExport(() => {
    downloadCsv(
      'model-registry.csv',
      ['Model ID', 'Name', 'Version', 'Domain', 'Status', 'Framework', 'Training cases', 'Metric', 'Metric value', 'Drift (%)', 'Last trained', 'Owner'],
      rows.map((m) => [m.id, m.name, m.version, m.domain, STATUS_META[m.status].label, m.framework, m.trainingCases, m.primaryMetric, m.metricValue, m.drift, m.lastTrained, m.owner]),
    );
    message.success('Model registry exported (CSV)');
    });
    return () => registerExport(null);
  }, [data, rows, registerExport]);

  return (
    <div className="space-y-6">
      {error && !data ? (
        <Panel>
          <ErrorState onRetry={refetch} />
        </Panel>
      ) : initialLoading || !data ? (
        <>
          <KpiSkeletonRow count={3} />
          <Panel title="Recovery bias by release">
            <ChartSkeleton height={220} />
          </Panel>
          <Panel title="Model registry">
            <DataTable<ModelRecord> columns={columns} initialLoading />
          </Panel>
        </>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-70' : ''}`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard
              label="Models in production"
              value={data.registry.filter((m) => m.status === 'production').length}
              icon={<Cpu />}
              context={`${data.registry.filter((m) => m.status === 'shadow').length} in shadow, ${data.registry.length} registered`}
            />
            <MetricCard
              label="Drift alerts"
              value={data.registry.filter((m) => m.status !== 'deprecated' && m.drift > threshold).length}
              icon={<AlertTriangle />}
              iconTone="red"
              context={`Active models above ${threshold.toFixed(1)}% feature drift`}
            />
            <MetricCard label="Live recovery model" value={live?.version ?? '—'} icon={<GitBranch />} context={live ? `${live.name}, since ${live.range.split(' – ')[0]}` : undefined} />
          </div>

          <Panel
            title="Recovery bias by release"
            description="Mean monthly (actual − predicted) / predicted while each release was live. Closer to 0% is better; negative means it over-predicts."
            icon={<LineIcon />}
          >
            <LineChart
              data={biasData}
              xKey="version"
              series={[{ key: 'bias', label: 'Bias', color: chartColors.actual }]}
              ariaLabel={`Recovery prediction bias by release: ${biasData.map((d) => `${d.version} ${fmtBias(d.bias)}`).join(', ')}`}
              valueFormat={fmtBias}
              yDomain={['auto', 0]}
              height={220}
            />
          </Panel>

          <Panel
            title="Model registry"
            description="Open a model to see its framework, training data and owner."
            icon={<BrainCircuit />}
          >
            <div className="space-y-4">
              <FilterRow>
                <SearchBox value={search} onChange={setSearch} placeholder="Search model, ID or framework" />
                <SelectFilter<StatusFilter>
                  label="Lifecycle status"
                  value={status}
                  onChange={setStatus}
                  options={[{ value: 'all', label: 'All statuses' }, ...(Object.keys(STATUS_META) as ModelStatus[]).map((s) => ({ value: s, label: STATUS_META[s].label }))]}
                />
                {filtered && <ClearButton onClick={clear} />}
              </FilterRow>
              <DataTable<ModelRecord>
                columns={columns}
                dataSource={rows}
                rowKey="id"
                pagination={false}
                refreshing={loading}
                filtered={filtered}
                onClearFilters={clear}
                onRowClick={setOpen}
              />
            </div>
          </Panel>
        </div>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} size={460} destroyOnHidden title={open && <span className="text-sm font-bold">{open.name}</span>}>
        {open && (
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            {[
              ['Model ID', open.id],
              ['Version', open.version],
              ['Domain', open.domain],
              ['Status', STATUS_META[open.status].label],
              ['Framework', open.framework],
              ['Owner', open.owner],
              ['Training cases', open.trainingCases.toLocaleString('en-US')],
              ['Last trained', fmtDate(open.lastTrained)],
              [open.primaryMetric, open.metricValue],
              ['Data drift', `${open.drift.toFixed(1)}% (threshold ${threshold.toFixed(1)}%)`],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">{k}</dt>
                <dd className="m-0 font-semibold text-[#141416]">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Drawer>
    </div>
  );
}
