'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown, Input, message, Modal, Select } from 'antd';
import { AlertTriangle, Bell, CheckCircle2, ChevronDown, ChevronRight, Download, Layers, MoreHorizontal, Package, RotateCcw, Share2, UserPlus } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import { EXCEPTION_TYPE_LABEL, exceptionService, type ExceptionRow } from '@/services/exceptionService';
import { metricsService } from '@/services/metricsService';
import { userService } from '@/services/userService';
import type { ExceptionStatus, ExceptionType, Severity } from '@/models/domain.model';
import { KpiSkeletonRow, ListSkeleton, MetricCard, PageActions, PageHeader, Skeleton, ErrorState } from '@/components/ui';
import { HorizontalBarChart } from '@/components/charts';
import { CommandFilters, CommandSelect, ModeToggle, SectionCard } from '@/components/command/CommandUi';
import { ExceptionDrawer } from '@/components/command/ExceptionDrawer';
import { copyPageLink, downloadCsv, fmtMoney, fmtUsd, formatAsOf } from '@/components/command/commandUtils';

type Mode = 'Operational' | 'Senior';
type StatusFilter = ExceptionStatus | 'unresolved' | 'all';

interface Filters {
  search: string;
  warehouse: string;
  type: ExceptionType | 'all';
  status: StatusFilter;
  severity: Severity | 'all';
}

const DEFAULT_FILTERS: Filters = { search: '', warehouse: 'all', type: 'all', status: 'unresolved', severity: 'all' };
const URL_KEYS: Record<keyof Filters, string> = { search: 'q', warehouse: 'wh', type: 'type', status: 'status', severity: 'sev' };

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'unresolved', label: 'All open' },
  { value: 'open', label: 'Open' },
  { value: 'notified', label: 'Notified' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All status' },
];

const STATUS_PILL: Record<ExceptionStatus, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-[#F1F5F9] text-[#475569] font-medium' },
  notified: { label: 'Notified', cls: 'bg-[#E0F2FE] text-[#0284C7] font-semibold' },
  assigned: { label: 'Assigned', cls: 'bg-[#FEF3C7] text-[#D97706] font-semibold' },
  resolved: { label: 'Resolved', cls: 'bg-[#ECFDF5] text-[#047857] font-semibold' },
};

const SEVERITY_PILL: Record<Severity, { label: string; cls: string; dot: string }> = {
  high: { label: 'High', cls: 'bg-[#FEE2E2] text-[#B91C1C]', dot: 'bg-[#DC2626]' },
  medium: { label: 'Med', cls: 'bg-[#FEF3C7] text-[#D97706]', dot: 'bg-[#D97706]' },
  low: { label: 'Low', cls: 'bg-[#ECFDF5] text-[#047857]', dot: 'bg-[#059669]' },
};

const SITES = metricsService.meta().sites;

function StatusPill({ status }: { status: ExceptionStatus }) {
  const s = STATUS_PILL[status];
  return <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] ${s.cls}`}>{s.label}</span>;
}

function SeverityPill({ severity }: { severity: Severity }) {
  const s = SEVERITY_PILL[severity];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function Dot({ severity }: { severity: Severity }) {
  return severity === 'low' ? <span className="h-2 w-2 shrink-0 rounded-full border border-[#94A3B8]" /> : <span className="h-2 w-2 shrink-0 rounded-full bg-[#F59E0B]" />;
}

type RowAction = 'view' | 'notify' | 'assign' | 'resolve' | 'reopen';

function RowActions({ row, onAction }: { row: ExceptionRow; onAction: (a: RowAction, row: ExceptionRow) => void }) {
  const resolved = row.status === 'resolved';
  return (
    // Rows open the View drawer on click; the buttons keep their own action.
    <div className="inline-flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => onAction('view', row)}
        className="cursor-pointer rounded-lg border border-[#E2E8F0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#141416] shadow-2xs transition-all hover:border-gray-400"
      >
        View
      </button>
      {!resolved && (
        <button
          type="button"
          onClick={() => onAction('notify', row)}
          className="cursor-pointer rounded-lg border border-[#E2E8F0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#141416] shadow-2xs transition-all hover:border-gray-400"
        >
          Notify
        </button>
      )}
      <Dropdown
        trigger={['click']}
        menu={{
          items: resolved
            ? [{ key: 'reopen', label: 'Reopen', icon: <RotateCcw size={14} /> }]
            : [
                { key: 'assign', label: 'Assign owner', icon: <UserPlus size={14} /> },
                { key: 'resolve', label: 'Mark resolved', icon: <CheckCircle2 size={14} /> },
              ],
          onClick: ({ key }) => onAction(key as RowAction, row),
        }}
      >
        <button
          type="button"
          aria-label={`More actions for ${row.title}`}
          className="cursor-pointer rounded-md p-0.5 text-[#64748B] transition-colors hover:bg-[#F1F5F9] hover:text-[#141416]"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </Dropdown>
    </div>
  );
}

function readUrlFilters(): { filters: Filters; mode: Mode } {
  const p = new URLSearchParams(window.location.search);
  const f = { ...DEFAULT_FILTERS };
  (Object.keys(URL_KEYS) as (keyof Filters)[]).forEach((k) => {
    const v = p.get(URL_KEYS[k]);
    if (v) (f as Record<keyof Filters, string>)[k] = v;
  });
  return { filters: f, mode: p.get('view') === 'senior' ? 'Senior' : 'Operational' };
}

export default function ExceptionsPage() {
  const { scope } = useAuth();
  const [mode, setMode] = useState<Mode>('Operational');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  // Groups the user opened or closed. Untouched groups fall back to "highest value open" (derived below).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [viewId, setViewId] = useState<string | null>(null);
  const [notifyRow, setNotifyRow] = useState<ExceptionRow | null>(null);
  const [assignRow, setAssignRow] = useState<ExceptionRow | null>(null);
  const [assignTo, setAssignTo] = useState<string | undefined>();
  const [resolveRow, setResolveRow] = useState<ExceptionRow | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Restore filters from a shared link (query string) once, after hydration. The ref keeps
  // StrictMode's second effect pass from re-reading the URL. `urlReady` stops the sync effect
  // below from rewriting the URL before the restored state has rendered (a remount in between
  // would otherwise read a stripped URL).
  const restoredRef = useRef(false);
  const [urlReady, setUrlReady] = useState(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const restored = readUrlFilters();
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from the URL */
    setFilters(restored.filters);
    setMode(restored.mode);
    if (restored.filters.warehouse !== 'all') setExpanded({ [restored.filters.warehouse]: true });
    setUrlReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Keep the URL in sync so Share copies exactly this view.
  useEffect(() => {
    if (!urlReady) return;
    const p = new URLSearchParams();
    (Object.keys(URL_KEYS) as (keyof Filters)[]).forEach((k) => {
      if (filters[k] !== DEFAULT_FILTERS[k]) p.set(URL_KEYS[k], filters[k]);
    });
    if (mode === 'Senior') p.set('view', 'senior');
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [filters, mode, urlReady]);

  const list = useServiceQuery(
    () => exceptionService.list({ ...filters, sortBy: 'valueAtRisk', scope }),
    [filters, scope.tenant, scope.site],
    { subscribe: exceptionService.subscribe },
  );
  const allOpen = useServiceQuery(() => exceptionService.list({ status: 'unresolved', sortBy: 'valueAtRisk', scope }), [scope.tenant, scope.site], {
    subscribe: exceptionService.subscribe,
  });
  const users = useServiceQuery(() => userService.list(), []);

  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const openRows = useMemo(() => rows.filter((r) => r.status !== 'resolved'), [rows]);
  const kpiRows = useMemo(() => (mode === 'Senior' ? allOpen.data?.items ?? [] : openRows), [mode, allOpen.data, openRows]);
  const kpiLoading = mode === 'Senior' ? allOpen.initialLoading : list.initialLoading;

  const kpis = useMemo(() => {
    const value = kpiRows.reduce((s, r) => s + r.valueAtRisk, 0);
    const high = kpiRows.filter((r) => r.severity !== 'low').length;
    return { count: kpiRows.length, value, high };
  }, [kpiRows]);

  const groups = useMemo(
    () =>
      SITES.filter((w) => filters.warehouse === 'all' || w === filters.warehouse).map((w) => {
        const items = rows.filter((r) => r.warehouse === w);
        const open = items.filter((r) => r.status !== 'resolved');
        return { name: w, items, openCount: open.length, value: open.reduce((s, r) => s + r.valueAtRisk, 0) };
      }),
    [rows, filters.warehouse],
  );
  // Open the highest-value warehouse by default; the user's own open/close choices win.
  const topGroup = groups.reduce<(typeof groups)[number] | undefined>((best, g) => (!best || g.value > best.value ? g : best), undefined)?.name;
  const isExpanded = (name: string) => expanded[name] ?? name === topGroup;
  const toggleGroup = (name: string) => setExpanded((e) => ({ ...e, [name]: !isExpanded(name) }));

  // The drawer reads the live row, so it reflects notify / assign / resolve straight away.
  const viewRow = viewId ? (rows.find((r) => r.id === viewId) ?? allOpen.data?.items.find((r) => r.id === viewId) ?? null) : null;

  const senior = useMemo(() => {
    const open = allOpen.data?.items ?? [];
    const byWarehouse = SITES.map((w) => ({ label: w, value: open.filter((r) => r.warehouse === w).reduce((s, r) => s + r.valueAtRisk, 0) }));
    const byType = (Object.keys(EXCEPTION_TYPE_LABEL) as ExceptionType[])
      .map((t) => ({ label: EXCEPTION_TYPE_LABEL[t], value: open.filter((r) => r.type === t).reduce((s, r) => s + r.valueAtRisk, 0) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
    return { byWarehouse, byType, top: open.slice(0, 5) };
  }, [allOpen.data]);

  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    if (k === 'warehouse' && v !== 'all') setExpanded((e) => ({ ...e, [v as string]: true }));
  };
  const filtered = (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).some((k) => filters[k] !== DEFAULT_FILTERS[k]);

  const onAction = (a: RowAction, row: ExceptionRow) => {
    if (a === 'view') setViewId(row.id);
    if (a === 'notify') setNotifyRow(row);
    if (a === 'assign') {
      setAssignTo(row.ownerId);
      setAssignRow(row);
    }
    if (a === 'resolve') {
      setResolveNote('');
      setResolveRow(row);
    }
    if (a === 'reopen') {
      exceptionService
        .reopen(row.id)
        .then(() => message.success(`${row.title} reopened`))
        .catch(() => message.error('Could not reopen the exception'));
    }
  };

  const run = async (fn: () => Promise<unknown>, ok: string, close: () => void) => {
    setBusy(true);
    try {
      await fn();
      message.success(ok);
      close();
    } catch {
      message.error('That did not work. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () =>
    downloadCsv(
      'exceptions.csv',
      ['Exception ID', 'Exception', 'Warehouse', 'Type', 'Items', 'Top item', 'Value at risk', 'Status', 'Severity', 'Age (days)', 'Owner'],
      rows.map((r) => [r.id, r.title, r.warehouse, EXCEPTION_TYPE_LABEL[r.type], r.itemsCount, r.topCase ? `${r.topCase.id} ${r.topCase.productName}` : r.topCaseId, r.valueAtRisk, STATUS_PILL[r.status].label, r.severity, r.ageDays, r.ownerName]),
    );

  const userOptions = (users.data ?? []).map((u) => ({ value: u.id, label: `${u.name} · ${u.role}` }));
  const okStyle = { style: { backgroundColor: '#FFD600', color: '#141416', fontWeight: 'bold' } };
  // Disabled OK buttons keep antd's disabled look instead of the yellow fill.
  const okProps = (disabled: boolean) => (disabled ? { disabled } : okStyle);

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Exceptions"
        description="Problems blocking returns, by warehouse: missing evidence, failed checks, delayed approvals, capacity. Notify the person who acts."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <ModeToggle value={mode} onChange={setMode} modes={['Operational', 'Senior']} />
            <PageActions
              meta={`As of ${formatAsOf(metricsService.meta().asOf)}`}
              secondary={[
                { key: 'share', label: 'Share', icon: <Share2 />, onClick: copyPageLink },
                ...(mode === 'Operational' ? [{ key: 'export', label: 'Export CSV', icon: <Download />, onClick: exportCsv, disabled: !rows.length }] : []),
              ]}
            />
          </div>
        }
      />

      {kpiLoading ? (
        <KpiSkeletonRow />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MetricCard label="Open exceptions" value={kpis.count} icon={<AlertTriangle />} context={`${kpis.high} medium or high severity`} />
          <MetricCard label="Total value at risk" value={fmtMoney(kpis.value)} icon={<Layers />} context={`Across ${kpis.count} open exceptions`} />
        </div>
      )}

      {mode === 'Senior' ? (
        <>
          {allOpen.error && <ErrorState onRetry={allOpen.refetch} />}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionCard title="Value at risk by warehouse" description="Open exceptions only." icon={<Package />}>
              {allOpen.initialLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <HorizontalBarChart data={senior.byWarehouse} ariaLabel="Value at risk by warehouse" valueFormat={fmtMoney} labelWidth={110} highlight={[...senior.byWarehouse].sort((a, b) => b.value - a.value)[0]?.label} seriesName="Value at risk" />
              )}
            </SectionCard>
            <SectionCard title="Value at risk by type" description="Where the money is stuck." icon={<Layers />}>
              {allOpen.initialLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <HorizontalBarChart data={senior.byType} ariaLabel="Value at risk by exception type" valueFormat={fmtMoney} labelWidth={150} highlight={senior.byType[0]?.label} seriesName="Value at risk" />
              )}
            </SectionCard>
          </div>
          <SectionCard title="Top 5 by value at risk" description="Open the exception to see every affected item." icon={<AlertTriangle />}>
            {allOpen.initialLoading ? (
              <ListSkeleton rows={5} />
            ) : (
              <ul className="m-0 list-none divide-y divide-[#F8FAFC] p-0">
                {senior.top.map((r) => (
                  <li key={r.id} onClick={() => setViewId(r.id)} className="flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2.5 text-xs hover:bg-[#F8FAFC]">
                    <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
                      <Dot severity={r.severity} />
                      <span className="font-semibold text-[#141416]">{r.title}</span>
                      <span className="text-[11px] text-[#64748B]">{r.warehouse}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold">{fmtMoney(r.valueAtRisk)}</span>
                      <StatusPill status={r.status} />
                      <SeverityPill severity={r.severity} />
                      <RowActions row={r} onAction={onAction} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      ) : (
        <>
          <CommandFilters
            search={filters.search}
            onSearch={(v) => setFilter('search', v)}
            placeholder="Search by exception, item, or asset (e.g., RT-1043)"
            onClear={() => setFilters(DEFAULT_FILTERS)}
            canClear={filtered}
          >
            <CommandSelect label="Warehouse" value={filters.warehouse} onChange={(v) => setFilter('warehouse', v)} options={[{ value: 'all', label: 'All Warehouses' }, ...SITES.map((s) => ({ value: s, label: s }))]} />
            <CommandSelect
              label="Exception type"
              value={filters.type}
              onChange={(v) => setFilter('type', v)}
              options={[{ value: 'all' as const, label: 'All Types' }, ...(Object.keys(EXCEPTION_TYPE_LABEL) as ExceptionType[]).map((t) => ({ value: t, label: EXCEPTION_TYPE_LABEL[t] }))]}
            />
            <CommandSelect label="Status" value={filters.status} onChange={(v) => setFilter('status', v)} options={STATUS_OPTIONS} />
            <CommandSelect
              label="Severity"
              value={filters.severity}
              onChange={(v) => setFilter('severity', v)}
              options={[
                { value: 'all', label: 'All Severities' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ]}
            />
          </CommandFilters>

          <SectionCard
            title="Exceptions by warehouse"
            description="Which warehouse, what item, what value. Notify the owner when something is not being actioned."
            icon={<AlertTriangle />}
          >
            {list.error && !list.data ? (
              <ErrorState onRetry={list.refetch} />
            ) : list.initialLoading ? (
              <ListSkeleton rows={6} />
            ) : (
              <div className={`transition-opacity ${list.loading ? 'opacity-60' : ''}`}>
                {/* Tablet and up: the warehouse accordion table. Items, Top item and Age show from 1200px (also in the View drawer). */}
                <table className="hidden w-full table-auto border-collapse text-left text-xs md:table">
                  <thead>
                    <tr className="border-b border-[#F1F5F9] text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                      <th className="px-3 py-2 font-bold">Exception</th>
                      <th className="hidden px-2 py-2 text-center font-bold min-[1200px]:table-cell">Items</th>
                      <th className="hidden px-2 py-2 font-bold min-[1200px]:table-cell">Top Item</th>
                      <th className="px-2 py-2 text-right font-bold">Value</th>
                      <th className="px-2 py-2 text-center font-bold">Status</th>
                      <th className="px-2 py-2 text-center font-bold">Severity</th>
                      <th className="hidden px-2 py-2 text-center font-bold min-[1200px]:table-cell">Age</th>
                      <th className="px-3 py-2 text-right font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const isOpen = isExpanded(g.name);
                      return (
                        <React.Fragment key={g.name}>
                          <tr>
                            <td colSpan={8} className="pb-1 pt-2.5">
                              <GroupHeader name={g.name} count={g.openCount} value={g.value} open={isOpen} onToggle={() => toggleGroup(g.name)} />
                            </td>
                          </tr>
                          {isOpen && !g.items.length && (
                            <tr>
                              <td colSpan={8} className="py-6 text-center text-xs text-[#94A3B8]">
                                No exceptions match the selected filters for {g.name}.
                              </td>
                            </tr>
                          )}
                          {isOpen &&
                            g.items.map((r) => (
                              <tr key={r.id} onClick={() => setViewId(r.id)} className="cursor-pointer border-b border-[#F8FAFC] transition-colors hover:bg-[#F8FAFC]">
                                <td className="px-3 py-2.5 font-semibold text-[#141416]">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <Dot severity={r.severity} />
                                    <span className="break-words">{r.title}</span>
                                  </div>
                                </td>
                                <td className="hidden whitespace-nowrap px-2 py-2.5 text-center font-medium text-[#64748B] min-[1200px]:table-cell">
                                  {r.itemsCount} {r.itemsCount === 1 ? 'item' : 'items'}
                                </td>
                                <td className="hidden px-2 py-2.5 font-medium text-[#141416] min-[1200px]:table-cell">
                                  <span className="mr-1 font-mono text-[11px] font-bold text-[#475569]">{r.topCaseId}</span>
                                  <span>{r.topCase?.productName}</span>
                                </td>
                                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono font-bold text-[#141416]">{fmtMoney(r.valueAtRisk)}</td>
                                <td className="px-2 py-2.5 text-center">
                                  <StatusPill status={r.status} />
                                </td>
                                <td className="px-2 py-2.5 text-center">
                                  <SeverityPill severity={r.severity} />
                                </td>
                                <td className="hidden whitespace-nowrap px-2 py-2.5 text-center text-[11px] font-medium text-[#64748B] min-[1200px]:table-cell">{r.ageDays}d</td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                                  <RowActions row={r} onAction={onAction} />
                                </td>
                              </tr>
                            ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>

                {/* Phones: the same accordion with one card per exception. */}
                <div className="space-y-2 md:hidden">
                  {groups.map((g) => {
                    const isOpen = isExpanded(g.name);
                    return (
                      <div key={g.name} className="space-y-2">
                        <GroupHeader name={g.name} count={g.openCount} value={g.value} open={isOpen} onToggle={() => toggleGroup(g.name)} />
                        {isOpen && !g.items.length && <p className="m-0 py-4 text-center text-xs text-[#94A3B8]">No exceptions match the selected filters for {g.name}.</p>}
                        {isOpen &&
                          g.items.map((r) => (
                            <div key={r.id} onClick={() => setViewId(r.id)} className="cursor-pointer rounded-xl border border-[#E2E8F0] bg-white p-3 text-xs hover:border-gray-400">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-2 font-semibold">
                                  <Dot severity={r.severity} />
                                  <span className="break-words">{r.title}</span>
                                </div>
                                <span className="shrink-0 font-mono font-bold">{fmtMoney(r.valueAtRisk)}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                  <StatusPill status={r.status} />
                                  <SeverityPill severity={r.severity} />
                                </div>
                                <RowActions row={r} onAction={onAction} />
                              </div>
                            </div>
                          ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </SectionCard>
        </>
      )}

      <ExceptionDrawer row={viewRow} onClose={() => setViewId(null)} onAction={(a, r) => onAction(a, r)} />

      <Modal
        title={
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-bold">Notify owner</span>
          </div>
        }
        open={!!notifyRow}
        confirmLoading={busy}
        onOk={() => notifyRow && run(() => exceptionService.notifyOwner(notifyRow.id), `Notification sent to ${notifyRow.ownerName}`, () => setNotifyRow(null))}
        onCancel={() => setNotifyRow(null)}
        okText="Send notification"
        okButtonProps={okStyle}
      >
        {notifyRow && (
          <div className="space-y-3 py-2 text-xs text-[#475569]">
            <p className="m-0">
              Send a reminder to <strong className="text-[#141416]">{notifyRow.ownerName}</strong>, who owns this exception:
            </p>
            <div className="space-y-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <div className="font-bold text-[#141416]">
                {notifyRow.title} · {notifyRow.warehouse}
              </div>
              <div>
                Top affected item: <strong className="font-mono">{notifyRow.topCaseId}</strong> ({notifyRow.topCase?.productName})
              </div>
              <div>
                Value at risk: <strong className="font-mono text-[#DC2626]">{fmtUsd(notifyRow.valueAtRisk)}</strong> across {notifyRow.itemsCount} {notifyRow.itemsCount === 1 ? 'item' : 'items'}.
              </div>
              <div>
                Open for <strong>{notifyRow.ageDays} days</strong>
                {notifyRow.lastNotifiedAt ? ' · already notified once' : ''}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={<span className="text-sm font-bold">Assign owner</span>}
        open={!!assignRow}
        confirmLoading={busy}
        onOk={() => {
          if (!assignRow || !assignTo) return;
          const name = users.data?.find((u) => u.id === assignTo)?.name ?? 'new owner';
          run(() => exceptionService.assign(assignRow.id, assignTo), `${assignRow.title} assigned to ${name}`, () => setAssignRow(null));
        }}
        onCancel={() => setAssignRow(null)}
        okText="Assign"
        okButtonProps={okProps(!assignTo || assignTo === assignRow?.ownerId)}
      >
        {assignRow && (
          <div className="space-y-2 py-2 text-xs text-[#475569]">
            <p className="m-0">
              {assignRow.title} · {assignRow.warehouse}. Current owner: <strong className="text-[#141416]">{assignRow.ownerName}</strong>.
            </p>
            <Select className="w-full" value={assignTo} onChange={setAssignTo} options={userOptions} loading={users.initialLoading} showSearch={{ optionFilterProp: 'label' }} aria-label="New owner" />
          </div>
        )}
      </Modal>

      <Modal
        title={<span className="text-sm font-bold">Mark resolved</span>}
        open={!!resolveRow}
        confirmLoading={busy}
        onOk={() => resolveRow && run(() => exceptionService.resolve(resolveRow.id, resolveNote.trim()), `${resolveRow.title} resolved`, () => setResolveRow(null))}
        onCancel={() => setResolveRow(null)}
        okText="Resolve"
        okButtonProps={okProps(!resolveNote.trim())}
      >
        {resolveRow && (
          <div className="space-y-2 py-2 text-xs text-[#475569]">
            <p className="m-0">
              {resolveRow.title} · {resolveRow.warehouse}. Say what fixed it; the note is kept with the exception.
            </p>
            <Input.TextArea rows={3} value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="e.g. Remaining-life evidence uploaded for all items" aria-label="Resolution note" />
          </div>
        )}
      </Modal>
    </div>
  );
}

function GroupHeader({ name, count, value, open, onToggle }: { name: string; count: number; value: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-[#FEF3C7] bg-[#FFFDF5] px-3.5 py-2 text-left shadow-2xs transition-colors hover:bg-[#FEFCE8]"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-[#141416]" /> : <ChevronRight className="h-3.5 w-3.5 text-[#64748B]" />}
        <span className="text-xs font-extrabold text-[#141416]">{name}</span>
        <span className="ml-2 text-[11px] font-medium text-[#64748B]">
          {count} {count === 1 ? 'exception' : 'exceptions'} · {fmtMoney(value)}
        </span>
      </div>
    </button>
  );
}
