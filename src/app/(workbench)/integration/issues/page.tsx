'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Drawer, Tabs, message } from 'antd';
import { CircleAlert, Clock, Download, GitCompareArrows, ShieldAlert, TriangleAlert, Zap } from 'lucide-react';
import { MetricCard, Skeleton } from '@/components/ui';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import type { Severity } from '@/models/domain.model';
import { conflictService, eventService, hoursSince, type Conflict, type IntegrationEvent } from '@/services/integrationService';
import { sourceService } from '@/services/sourceService';
import { FabricHeader, FilterField, FilterRow, MoreFilters, SearchField } from '@/components/integration/Filters';
import { IntTable, type IntColumn } from '@/components/integration/IntTable';
import { Pill, SourceChip } from '@/components/integration/Pills';
import { BTN_SECONDARY, SELECT } from '@/components/integration/styles';
import { downloadCsv, fmtAge, fmtDateTime } from '@/components/integration/format';
import { CONFLICT_STATUS_PILL, EVENT_STATUS_PILL, SEV_PILL, sourceHref } from '@/components/integration/issueMeta';
import { setQueryParams, useQueryParam } from '@/components/integration/useQueryParam';
import { ConflictResolver } from '@/components/integration/ConflictResolver';
import { EventDetail, ReplayButton } from '@/components/integration/EventDetail';
import { EventLog } from '@/components/integration/EventLog';

type Tab = 'open' | 'events';
type Kind = 'conflict' | 'event';

/** One row of the merged queue: an unresolved conflict or a failed / warning event. */
interface Issue {
  key: string;
  kind: Kind;
  id: string;
  severity: Severity;
  sources: string[];
  title: string;
  detail: string;
  at: string;
  conflict?: Conflict;
  event?: IntegrationEvent;
}

const SEV_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

function toIssues(conflicts: Conflict[], events: IntegrationEvent[]): Issue[] {
  const a: Issue[] = conflicts.map((c) => ({
    key: `c-${c.id}`,
    kind: 'conflict',
    id: c.id,
    severity: c.severity,
    sources: c.values.map((v) => v.system),
    title: `Systems disagree on ${c.field}`,
    detail: `${c.entityId} · ${c.entityLabel}`,
    at: c.detectedAt,
    conflict: c,
  }));
  const b: Issue[] = events.map((e) => ({
    key: `e-${e.id}`,
    kind: 'event',
    id: e.id,
    severity: e.status === 'error' ? 'high' : 'medium',
    sources: [e.source],
    title: e.message,
    detail: `${e.type} · ${e.entityId}`,
    at: e.ts,
    event: e,
  }));
  return [...a, ...b].sort((x, y) => SEV_RANK[y.severity] - SEV_RANK[x.severity] || (x.at < y.at ? -1 : 1));
}

export default function IssuesPage() {
  const tabParam = useQueryParam('tab');
  const sourceParam = useQueryParam('source');
  const tab: Tab = tabParam === 'events' ? 'events' : 'open';

  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [pickedSource, setSource] = useState<string | null>(null);
  const source = pickedSource ?? sourceParam ?? 'all';
  const [openKey, setOpenKey] = useState<string | null>(null);

  const conflicts = useServiceQuery(() => conflictService.list({ status: 'unresolved' }), [], { subscribe: conflictService.subscribe });
  const events = useServiceQuery(() => eventService.list({ issuesOnly: true }), [], { subscribe: eventService.subscribe });
  const sources = useServiceQuery(() => sourceService.list(), [], { subscribe: sourceService.subscribe });
  const sourceNames = useMemo(() => (sources.data ?? []).map((s) => s.name), [sources.data]);
  const idOf = useMemo(() => new Map((sources.data ?? []).map((s) => [s.name, s.id])), [sources.data]);

  const all = useMemo(() => (conflicts.data && events.data ? toIssues(conflicts.data, events.data.items) : undefined), [conflicts.data, events.data]);
  const term = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all?.filter(
        (i) =>
          (kind === 'all' || i.kind === kind) &&
          (severity === 'all' || i.severity === severity) &&
          (source === 'all' || i.sources.includes(source)) &&
          (!term || `${i.id} ${i.title} ${i.detail} ${i.sources.join(' ')}`.toLowerCase().includes(term)),
      ),
    [all, kind, severity, source, term],
  );
  const filtered = !!term || kind !== 'all' || severity !== 'all' || source !== 'all';
  const loading = conflicts.initialLoading || events.initialLoading;
  const current = all?.find((i) => i.key === openKey) ?? null;

  const kpi = useMemo(() => {
    const list = all ?? [];
    const c = list.filter((i) => i.kind === 'conflict');
    const oldest = c.reduce<Issue | null>((m, i) => (!m || i.at < m.at ? i : m), null);
    return {
      open: list.length,
      conflicts: c.length,
      escalated: c.filter((i) => i.conflict?.status === 'escalated').length,
      events: list.length - c.length,
      high: list.filter((i) => i.severity === 'high').length,
      oldest,
    };
  }, [all]);

  const clearFilters = () => {
    setSearch('');
    setKind('all');
    setSeverity('all');
    setSource('all');
  };

  const setTab = (t: string) => setQueryParams({ tab: t === 'events' ? 'events' : null });

  const exportCsv = () => {
    const list = rows ?? [];
    downloadCsv(
      'open-issues.csv',
      ['Issue', 'Type', 'Severity', 'Sources', 'Summary', 'Detail', 'Detected (UTC)'],
      list.map((i) => [i.id, i.kind, i.severity, i.sources.join(' | '), i.title, i.detail, i.at]),
    );
    message.success(`Exported ${list.length} issues`);
  };

  const sourceLinks = (names: string[]) => (
    <div className="flex min-w-0 flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      {names.map((n) => (
        <Link key={n} href={sourceHref(idOf.get(n) ?? n)} className="min-w-0 max-w-full hover:underline" aria-label={`Open ${n}`}>
          <SourceChip system={n} />
        </Link>
      ))}
    </div>
  );

  const columns: IntColumn<Issue>[] = [
    {
      key: 'issue',
      title: 'Issue',
      grow: true,
      render: (i) => (
        <div className="flex min-w-0 items-start gap-2">
          <span className={`mt-0.5 shrink-0 ${i.kind === 'conflict' ? 'text-amber-500' : i.severity === 'high' ? 'text-[#DC2626]' : 'text-[#D97706]'}`}>
            {i.kind === 'conflict' ? <GitCompareArrows size={14} /> : <Zap size={14} />}
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold text-[#141416]">{i.title}</div>
            <div className="truncate text-[11px] text-[#94A3B8]">
              <span className="font-mono">{i.id}</span> · {i.kind === 'conflict' ? 'Conflict' : 'Event'} · {i.detail}
            </div>
          </div>
        </div>
      ),
    },
    { key: 'source', title: 'Source', render: (i) => sourceLinks(i.sources) },
    {
      key: 'detected',
      title: 'Detected',
      priority: 2,
      render: (i) => (
        <div className="whitespace-nowrap">
          <div className="font-semibold text-[#141416]">{fmtAge(hoursSince(i.at))} ago</div>
          <div className="text-[11px] text-[#94A3B8]">{fmtDateTime(i.at).slice(0, 6)}</div>
        </div>
      ),
    },
    {
      key: 'sev',
      title: 'Severity · Status',
      render: (i) => (
        <div className="flex flex-col items-start gap-1">
          <Pill tone={SEV_PILL[i.severity].tone}>{SEV_PILL[i.severity].label}</Pill>
          {i.conflict ? (
            <Pill tone={CONFLICT_STATUS_PILL[i.conflict.status].tone} dot={false}>
              {CONFLICT_STATUS_PILL[i.conflict.status].label}
            </Pill>
          ) : (
            i.event && (
              <Pill tone="neutral" dot={false}>
                {i.event.status === 'error' ? 'Failed' : 'Warning'}
              </Pill>
            )
          )}
        </div>
      ),
    },
  ];

  const openTab = (
    <div className="space-y-4">
      <FilterRow onClear={clearFilters} canClear={filtered}>
        <SearchField value={search} onChange={setSearch} placeholder="Search by case, field, event or message" label="Search issues" />
        <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as Kind | 'all')} className={SELECT}>
          <option value="all">All types</option>
          <option value="conflict">Conflicts</option>
          <option value="event">Failed and warning events</option>
        </select>
        <select aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | 'all')} className={SELECT}>
          <option value="all">All severities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <MoreFilters active={source !== 'all' ? 1 : 0}>
          <FilterField label="Source">
            <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} className={`${SELECT} w-full`}>
              <option value="all">All sources</option>
              {[...sourceNames, ...(source !== 'all' && !sourceNames.includes(source) ? [source] : [])].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </FilterField>
        </MoreFilters>
        <button type="button" className={BTN_SECONDARY} onClick={exportCsv} disabled={!rows?.length}>
          <Download className="h-3.5 w-3.5" />
          <span>Export CSV</span>
        </button>
      </FilterRow>
      <section className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-2xs" aria-label="Open issues">
        <IntTable
          columns={columns}
          rows={rows}
          rowKey={(i) => i.key}
          initialLoading={loading}
          refreshing={(conflicts.loading || events.loading) && !loading}
          filtered={filtered}
          onClearFilters={clearFilters}
          emptyText="No open issues. Every source agrees and every event was delivered."
          onRowClick={(i) => setOpenKey(i.key)}
          selectedKey={openKey}
          skeletonRows={8}
        />
      </section>
    </div>
  );

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <FabricHeader
        title="Issues"
        description="Everything that needs a person: fields where source systems disagree, and events that failed or were delivered with warnings. Highest severity and oldest first; open an issue to resolve it, or its source to fix the cause."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="Open issues"
          value={kpi.open}
          context={`${kpi.conflicts} conflicts${kpi.escalated ? ` (${kpi.escalated} escalated)` : ''} · ${kpi.events} events`}
          icon={<TriangleAlert />}
          loading={loading}
        />
        <MetricCard label="High severity" value={kpi.high} context="Conflicts that block a decision, and failed events" icon={<ShieldAlert />} iconTone="red" loading={loading} />
        <MetricCard
          label="Oldest open conflict"
          value={kpi.oldest ? fmtAge(hoursSince(kpi.oldest.at)) : 'None'}
          context={kpi.oldest ? `${kpi.oldest.id}, awaiting a decision` : 'Queue is clear'}
          icon={<Clock />}
          iconTone="slate"
          loading={loading}
        />
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'open', label: `Open issues${all ? ` (${all.length})` : ''}`, children: openTab },
          { key: 'events', label: 'Event log', children: <EventLog sources={sourceNames} initialSource={sourceParam} /> },
        ]}
      />

      <Drawer
        open={!!current}
        onClose={() => setOpenKey(null)}
        size={520}
        title={
          current && (
            <div className="flex flex-wrap items-center gap-2">
              {current.kind === 'conflict' ? <GitCompareArrows className="h-4 w-4 text-amber-500" /> : <CircleAlert className="h-4 w-4 text-[#DC2626]" />}
              <span className="text-sm font-bold">{current.id}</span>
              <Pill tone={SEV_PILL[current.severity].tone}>{SEV_PILL[current.severity].label}</Pill>
              {current.event && <Pill tone={EVENT_STATUS_PILL[current.event.status].tone}>{EVENT_STATUS_PILL[current.event.status].label}</Pill>}
            </div>
          )
        }
        extra={current?.event ? <ReplayButton event={current.event} onDone={() => setOpenKey(null)} /> : null}
      >
        {!current ? (
          <Skeleton className="h-40 w-full" />
        ) : current.conflict ? (
          <ConflictResolver key={current.id} conflict={current.conflict} onDone={() => setOpenKey(null)} />
        ) : (
          current.event && (
            <div className="space-y-3">
              <EventDetail event={current.event} />
              <Link href={sourceHref(idOf.get(current.event.source) ?? current.event.source, 'sync')} className="inline-block text-xs font-semibold text-[#0284C7] hover:underline">
                Open {current.event.source} to fix the cause
              </Link>
            </div>
          )
        )}
      </Drawer>
    </div>
  );
}
