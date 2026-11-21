'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Drawer, message } from 'antd';
import { Download, Pause, Play, Zap } from 'lucide-react';
import { CaseLink, Skeleton } from '@/components/ui';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { eventService, type EventDirection, type EventStatus, type IntegrationEvent } from '@/services/integrationService';
import { IntTable, type IntColumn } from './IntTable';
import { DirectionTag, Pill, SourceChip } from './Pills';
import { FilterField, FilterRow, MoreFilters, SearchField } from './Filters';
import { BTN_ROW, BTN_SECONDARY, SELECT } from './styles';
import { downloadCsv, fmtClock, fmtLatency } from './format';
import { EVENT_STATUS_PILL } from './issueMeta';
import { EventDetail, ReplayButton } from './EventDetail';

const PAGE_SIZE = 20;
const TICK_MS = 4000;

interface Props {
  sources: string[];
  /** Pre-filter from ?source= until the user picks another source. */
  initialSource: string | null;
}

/** The full event stream (in and out of every source), newest first, with a simulated live feed. */
export function EventLog({ sources, initialSource }: Props) {
  const [search, setSearch] = useState('');
  const [pickedSource, setSource] = useState<string | null>(null);
  const source = pickedSource ?? initialSource ?? 'all';
  const [direction, setDirection] = useState<EventDirection | 'all'>('all');
  const [status, setStatus] = useState<EventStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [live, setLive] = useState(true);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const filters = { search, source, direction, status };
  const filtered = !!search || source !== 'all' || direction !== 'all' || status !== 'all';

  const list = useServiceQuery(() => eventService.list({ ...filters, page, pageSize: PAGE_SIZE }), [search, source, direction, status, page], {
    subscribe: eventService.subscribe,
  });
  const summary = useServiceQuery(() => eventService.summary(), [], { subscribe: eventService.subscribe });
  const selected = useServiceQuery(() => (selectedId ? eventService.get(selectedId) : Promise.resolve(undefined)), [selectedId], {
    subscribe: eventService.subscribe,
  });

  // Simulated live feed; the interval is cleared on pause and on unmount.
  const freshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const id = setInterval(() => {
      eventService.simulateTick().then((created) => {
        if (cancelled) return;
        setFresh(new Set(created.map((e) => e.id)));
        if (freshTimer.current) clearTimeout(freshTimer.current);
        freshTimer.current = setTimeout(() => setFresh(new Set()), 2500);
      });
    }, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (freshTimer.current) clearTimeout(freshTimer.current);
    };
  }, [live]);

  const resetPage =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  const clearFilters = () => {
    setSearch('');
    setSource('all');
    setDirection('all');
    setStatus('all');
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await eventService.list(filters);
      downloadCsv(
        `event-log-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Event ID', 'Time (UTC)', 'Source', 'Direction', 'Type', 'Entity type', 'Case ID', 'Status', 'Latency ms', 'Message'],
        all.items.map((e) => [e.id, e.ts, e.source, e.direction, e.type, e.entityType, e.entityId, e.status, e.latencyMs, e.message]),
      );
      message.success(`Exported ${all.total} events`);
    } finally {
      setExporting(false);
    }
  };

  const columns: IntColumn<IntegrationEvent>[] = [
    { key: 'ts', title: 'Time', render: (e) => <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-[#475569]">{fmtClock(e.ts)}</span> },
    {
      key: 'source',
      title: 'Source',
      render: (e) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <SourceChip system={e.source} />
          <DirectionTag direction={e.direction} />
        </div>
      ),
    },
    {
      key: 'type',
      title: 'Type',
      priority: 2,
      grow: true,
      render: (e) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px] font-bold text-[#141416]">{e.type}</div>
          <div className="truncate text-[11px] text-[#94A3B8]">{e.entityType}</div>
        </div>
      ),
    },
    {
      key: 'entity',
      title: 'Case',
      priority: 3,
      render: (e) => (
        <span onClick={(ev) => ev.stopPropagation()} className="block max-w-[200px] truncate whitespace-nowrap">
          <CaseLink id={e.entityId} label={eventService.caseLabel(e.entityId)} />
        </span>
      ),
    },
    {
      key: 'status',
      title: 'Status',
      render: (e) => (
        <div className="flex flex-col items-start gap-0.5">
          <Pill tone={EVENT_STATUS_PILL[e.status].tone}>{EVENT_STATUS_PILL[e.status].label}</Pill>
          <span className={`whitespace-nowrap font-mono text-[11px] font-bold ${e.latencyMs >= 1500 ? 'text-[#DC2626]' : e.latencyMs >= 600 ? 'text-[#D97706]' : 'text-[#141416]'}`}>
            {fmtLatency(e.latencyMs)}
          </span>
        </div>
      ),
    },
  ];

  const s = summary.data;
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const ev = selected.data && selected.data.id === selectedId ? selected.data : undefined;
  const sourceOptions = [...sources, ...(source !== 'all' && !sources.includes(source) ? [source] : [])];

  return (
    <div className="space-y-4">
      <FilterRow onClear={clearFilters} canClear={filtered}>
        <SearchField value={search} onChange={resetPage(setSearch)} placeholder="Search by event, type, case (e.g. RT-1065) or message" label="Search events" />
        <select aria-label="Source" value={source} onChange={(e) => resetPage(setSource)(e.target.value)} className={SELECT}>
          <option value="all">All sources</option>
          {sourceOptions.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => resetPage(setStatus)(e.target.value as EventStatus | 'all')} className={SELECT}>
          <option value="all">All status</option>
          <option value="ok">OK</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        <MoreFilters active={direction !== 'all' ? 1 : 0}>
          <FilterField label="Direction">
            <select aria-label="Direction" value={direction} onChange={(e) => resetPage(setDirection)(e.target.value as EventDirection | 'all')} className={`${SELECT} w-full`}>
              <option value="all">In and out</option>
              <option value="in">Inbound</option>
              <option value="out">Outbound</option>
            </select>
          </FilterField>
        </MoreFilters>
        <button type="button" className={BTN_SECONDARY} onClick={() => setLive((v) => !v)} aria-pressed={!live}>
          {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          <span>{live ? 'Pause feed' : 'Resume feed'}</span>
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={exportCsv} disabled={exporting || !total}>
          <Download className="h-3.5 w-3.5" />
          <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
        </button>
      </FilterRow>

      <section className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-2xs" aria-label="Event log">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#64748B]" aria-live="polite">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#141416]">
            <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-[#10B981]' : 'bg-[#94A3B8]'}`} />
            {live ? 'Live' : 'Paused'}
          </span>
          {s ? (
            <>
              <span>Last event {s.latestTs ? fmtClock(s.latestTs) : '--:--:--'} UTC</span>
              <span>{s.lastMinute} in the last minute</span>
              <span>p95 latency {fmtLatency(s.p95LatencyMs)}</span>
            </>
          ) : (
            <Skeleton className="h-3 w-48" />
          )}
        </div>
        <IntTable
          columns={columns}
          rows={list.data?.items}
          rowKey={(e) => e.id}
          initialLoading={list.initialLoading}
          filtered={filtered}
          onClearFilters={clearFilters}
          emptyText="No events received yet"
          onRowClick={(e) => setSelectedId(e.id)}
          selectedKey={selectedId}
          rowClassName={(e) => (fresh.has(e.id) ? 'animate-[pulse_1.2s_ease-in-out_2] bg-[#FEFCE8]' : '')}
          skeletonRows={10}
        />
        {!list.initialLoading && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-[11px] font-medium text-[#64748B]">
            <span>
              Showing {(list.data!.page - 1) * PAGE_SIZE + 1}-{Math.min(list.data!.page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1.5">
              <button type="button" className={BTN_ROW} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </button>
              <span className="px-1 font-mono">
                {page} / {pages}
              </span>
              <button type="button" className={BTN_ROW} disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      <Drawer
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        size={560}
        title={
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-bold">{selectedId}</span>
            {ev && <Pill tone={EVENT_STATUS_PILL[ev.status].tone}>{EVENT_STATUS_PILL[ev.status].label}</Pill>}
          </div>
        }
        extra={ev ? <ReplayButton event={ev} /> : null}
      >
        {!ev ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : (
          <EventDetail event={ev} />
        )}
      </Drawer>
    </div>
  );
}
