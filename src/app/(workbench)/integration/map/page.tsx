'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Button, Segmented, Tabs, message } from 'antd';
import { Activity, Cable, GitBranch, LayoutGrid, List, Plus, RefreshCw, TriangleAlert, Workflow } from 'lucide-react';
import { PageHeader, PageActions, MetricCard, FilterBar, SearchInput, FilterSelect, ProgressBar, ErrorState } from '@/components/ui';
import { Sparkline } from '@/components/charts';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { setQueryParams, useQueryParam } from '@/components/integration/useQueryParam';
import { sourceService, type SourceQuery } from '@/services/sourceService';
import { SystemsTree } from '@/components/sourcemap/SystemsTree';
import { SourceGraph } from '@/components/sourcemap/SourceGraph';
import { SourceList } from '@/components/sourcemap/SourceList';
import { SourceMatrix } from '@/components/sourcemap/SourceMatrix';
import { SOURCE_PANELS, SourceDrawer, type SourcePanel } from '@/components/sourcemap/SourceDetail';
import { SourceHealth } from '@/components/sourcemap/SourceHealth';
import { ConnectWizard } from '@/components/sourcemap/ConnectWizard';
import { STATUS_META, STATUS_ORDER, fmtNum } from '@/components/sourcemap/sourceMeta';

type View = 'list' | 'graph' | 'matrix';
type PageTab = 'sources' | 'health';

/**
 * Sources: every connected system (list by default; graph and matrix as alternative views),
 * a drawer per source, the Add source wizard and the Health tab.
 * URL: ?tab=health · ?view=graph|matrix · ?source=<id or name>&panel=<drawer tab> · ?add=file|source
 */
export default function SourcesPage() {
  const tab: PageTab = useQueryParam('tab') === 'health' ? 'health' : 'sources';
  const viewParam = useQueryParam('view');
  const view: View = viewParam === 'graph' || viewParam === 'matrix' ? viewParam : 'list';
  const sourceParam = useQueryParam('source');
  const panelParam = useQueryParam('panel') as SourcePanel | null;
  const panel: SourcePanel = panelParam && SOURCE_PANELS.includes(panelParam) ? panelParam : 'overview';
  const addParam = useQueryParam('add');
  const modelParam = useQueryParam('model');

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState<NonNullable<SourceQuery['status']>>('all');
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number; name: string } | null>(null);

  const meta = useServiceQuery(() => sourceService.meta(), []);
  const list = useServiceQuery(() => sourceService.list({ search, category, status }), [search, category, status], { subscribe: sourceService.subscribe });
  const summary = useServiceQuery(() => sourceService.summary(), [], { subscribe: sourceService.subscribe });

  const sources = useMemo(() => list.data ?? [], [list.data]);
  // ?source= may carry an id or a system name (links from events and conflicts); highlight the matching row.
  const selectedId = sources.find((s) => s.id === sourceParam || s.name === sourceParam)?.id ?? sourceParam;

  const filtersActive = !!search || category !== 'all' || status !== 'all';
  const clearFilters = () => {
    setSearch('');
    setCategory('all');
    setStatus('all');
  };

  const select = useCallback((id: string) => setQueryParams({ source: id, panel: null }), []);
  const closeDrawer = () => setQueryParams({ source: null, panel: null });

  const syncAll = async () => {
    const key = 'sync-all';
    setSyncProgress({ done: 0, total: 1, name: '' });
    message.loading({ content: 'Syncing all sources…', key, duration: 0 });
    try {
      const r = await sourceService.syncAll((done, total, name) => {
        setSyncProgress({ done, total, name });
        if (name) message.loading({ content: `Syncing ${done + 1} of ${total}: ${name}`, key, duration: 0 });
      });
      const parts = [`${r.synced} synced`, r.partial && `${r.partial} partial`, r.failed && `${r.failed} failed`, r.skipped && `${r.skipped} skipped`].filter(Boolean);
      const content = `Sync complete: ${parts.join(', ')} · ${fmtNum(r.records)} records`;
      if (r.failed) message.warning({ content, key, duration: 5 });
      else message.success({ content, key, duration: 4 });
    } catch (e) {
      message.error({ content: (e as Error).message, key });
    } finally {
      setSyncProgress(null);
    }
  };

  const sum = summary.data;
  const kpiLoading = summary.initialLoading;
  const models = useMemo(() => meta.data?.canonicalModels ?? [], [meta.data]);
  const steps = meta.data?.decisionSteps ?? [];
  const categories = meta.data?.categories ?? [];
  const firstLoad = list.initialLoading || meta.initialLoading;

  const sourcesTab = (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-2xs">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <FilterBar onClear={clearFilters} canClear={filtersActive}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search systems, tables or fields" width={240} />
            <FilterSelect
              label="Category"
              value={category}
              onChange={setCategory}
              options={[{ value: 'all', label: 'All' }, ...categories.map((c) => ({ value: c, label: c }))]}
              width={165}
            />
            <FilterSelect
              label="Status"
              value={status}
              onChange={(v) => setStatus(v as typeof status)}
              options={[
                { value: 'all', label: 'All' },
                { value: 'attention', label: 'Needs attention' },
                ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label })),
              ]}
              width={175}
            />
          </FilterBar>
          <Segmented<View>
            value={view}
            onChange={(v) => setQueryParams({ view: v === 'list' ? null : v })}
            aria-label="View"
            options={[
              { value: 'list', label: 'List', icon: <List size={13} className="inline -mt-0.5" /> },
              { value: 'graph', label: 'Graph', icon: <GitBranch size={13} className="inline -mt-0.5" /> },
              { value: 'matrix', label: 'Matrix', icon: <LayoutGrid size={13} className="inline -mt-0.5" /> },
            ]}
            className="self-start text-xs font-semibold lg:self-auto"
          />
        </div>
      </div>

      {list.error ? (
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5">
          <ErrorState onRetry={list.refetch} />
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-4 ${view === 'graph' ? 'lg:grid-cols-[250px_minmax(0,1fr)]' : ''}`}>
          {/* The list and matrix already name every system, so the tree only accompanies the graph. */}
          {view === 'graph' && <SystemsTree sources={list.data} categories={categories} selectedId={selectedId} onSelect={select} loading={firstLoad} />}

          <section className="min-w-0 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-2xs">
            {firstLoad ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="skeleton h-9" style={{ width: `${60 + ((i * 13) % 35)}%` }} />
                ))}
              </div>
            ) : sources.length === 0 ? (
              <div className="flex h-[360px] flex-col items-center justify-center gap-3 p-6 text-center">
                <Workflow size={22} className="text-[#94A3B8]" />
                <div className="text-xs font-semibold text-[#141416]">No systems match these filters</div>
                <Button onClick={clearFilters} className="!rounded-xl !text-xs !font-semibold">
                  Clear filters
                </Button>
              </div>
            ) : view === 'graph' ? (
              <SourceGraph sources={sources} models={models} steps={steps} selectedId={selectedId} showFieldLinks onSelectSystem={select} />
            ) : view === 'matrix' ? (
              <SourceMatrix sources={sources} models={models} selectedId={selectedId} onSelect={select} />
            ) : (
              <SourceList sources={sources} selectedId={selectedId} onSelect={select} loading={list.loading && !list.data} />
            )}
          </section>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Sources"
        description="Every system that feeds Circularity: ERP, WMS, PLM, telemetry, market data and files. Open a source to check its sync, fix it, resolve its conflicts or review its mappings."
        actions={
          <PageActions
            secondary={[
              {
                key: 'sync',
                label: 'Sync all sources',
                icon: <RefreshCw className={syncProgress ? 'animate-spin' : ''} />,
                onClick: syncAll,
                disabled: !!syncProgress || firstLoad,
              },
            ]}
            primary={{ key: 'add', label: 'Add source', icon: <Plus />, onClick: () => setQueryParams({ add: 'source' }), disabled: meta.initialLoading }}
          />
        }
      />

      {syncProgress && (
        <div className="rounded-2xl border border-[#E2E8F0] bg-white px-5 py-4 shadow-2xs" aria-live="polite">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-semibold text-[#141416]">{syncProgress.name ? `Syncing ${syncProgress.name}` : 'Preparing sync…'}</span>
            <span className="shrink-0 font-mono text-[#64748B]">
              {Math.min(syncProgress.done, syncProgress.total)} / {syncProgress.total}
            </span>
          </div>
          <ProgressBar value={syncProgress.done} max={syncProgress.total} label="Sync progress" tone="success" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Connected sources"
          value={sum?.connected ?? 0}
          context={sum ? `${sum.paused ? `${sum.paused} paused · ` : ''}${sum.tables} tables modelled` : undefined}
          icon={<Cable />}
          loading={kpiLoading}
        />
        <button
          type="button"
          onClick={() => {
            setStatus(status === 'attention' ? 'all' : 'attention');
            if (tab !== 'sources') setQueryParams({ tab: null });
          }}
          aria-pressed={status === 'attention'}
          aria-label={`Need attention: ${sum?.attention ?? 0} sources. ${status === 'attention' ? 'Clear the filter' : 'Show only these sources'}`}
          className={`block min-w-0 cursor-pointer rounded-2xl border-0 bg-transparent p-0 text-left outline-offset-2 transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-[#FFD600] ${
            status === 'attention' ? 'ring-2 ring-[#FFD600]' : ''
          }`}
        >
          <MetricCard
            label="Need attention"
            value={sum?.attention ?? 0}
            context={sum ? `${sum.failed} ${sum.failed === 1 ? 'source' : 'sources'} failing · ${status === 'attention' ? 'filter applied' : 'click to filter'}` : undefined}
            icon={<TriangleAlert />}
            iconTone={sum && sum.failed ? 'red' : 'amber'}
            loading={kpiLoading}
          />
        </button>
        <MetricCard
          label="Integration health"
          value={sum ? `${sum.healthPct}%` : '-'}
          context="Last 5 syncs of every active source"
          icon={<Activity />}
          iconTone="green"
          loading={kpiLoading}
          visual={sum ? <Sparkline values={sum.healthTrend} color="#059669" height={24} ariaLabel={`Integration health over the last 24 hours, now ${sum.healthPct}%`} /> : undefined}
        />
      </div>

      <Tabs
        activeKey={tab}
        onChange={(k) => setQueryParams({ tab: k === 'health' ? 'health' : null })}
        items={[
          { key: 'sources', label: `Sources${sum ? ` (${sum.total})` : ''}`, children: sourcesTab },
          { key: 'health', label: 'Health', children: <SourceHealth onOpen={select} /> },
        ]}
      />

      <SourceDrawer
        sourceId={sourceParam}
        panel={panel}
        onPanelChange={(p) => setQueryParams({ panel: p === 'overview' ? null : p })}
        meta={meta.data}
        onClose={closeDrawer}
        onDeleted={closeDrawer}
      />

      <ConnectWizard
        open={!!addParam}
        startWithFile={addParam === 'file'}
        fileModel={modelParam}
        meta={meta.data}
        onClose={() => setQueryParams({ add: null, model: null })}
        onView={(s) => {
          clearFilters();
          setQueryParams({ add: null, model: null, tab: null, source: s.id, panel: null });
        }}
      />
    </div>
  );
}
