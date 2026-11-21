'use client';

import React, { useState, useSyncExternalStore } from 'react';
import { Select, Tooltip } from 'antd';
import { Lock, Database, Box, ShieldCheck, Warehouse, FlaskConical, LineChart, Network, BookOpen, LayoutDashboard, KeyRound } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { governanceService, type StageRunStatus } from '@/services/governanceService';
import { STAGE_META } from '@/components/ui';

/** Button / input classes from the local pages (Exceptions). */
export const btnPrimary =
  'inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#FFD600] hover:bg-[#FACC15] text-[#141416] rounded-xl text-xs font-extrabold shadow-2xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const btnSecondary =
  'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-xl text-xs font-semibold text-[#141416] shadow-2xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const btnRowSecondary =
  'px-2 py-0.5 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-lg text-[10px] font-bold text-[#141416] shadow-2xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const btnRowPrimary =
  'px-2.5 py-0.5 bg-[#FFD600] hover:bg-[#FACC15] text-[#141416] rounded-lg text-[10px] font-extrabold shadow-2xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const selectCls =
  'px-3 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#141416] cursor-pointer hover:bg-white focus:outline-none focus:border-[#FFD600]';
export const inputCls =
  'w-full pl-9 pr-3 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs text-[#141416] placeholder-[#94A3B8] focus:outline-none focus:border-[#FFD600] focus:bg-white transition-all';
export const thCls = 'py-2 px-2 font-bold';
export const theadRowCls = 'border-b border-[#F1F5F9] text-[11px] font-bold text-[#64748B] uppercase tracking-wider';
export const trCls = 'border-b border-[#F8FAFC] hover:bg-[#F8FAFC] transition-colors';

/** Small pill in the Exceptions style. */
export type PillTone = 'red' | 'amber' | 'green' | 'blue' | 'slate' | 'dark' | 'yellow';
const PILL: Record<PillTone, string> = {
  red: 'bg-[#FEE2E2] text-[#B91C1C]',
  amber: 'bg-[#FEF3C7] text-[#D97706]',
  green: 'bg-[#ECFDF5] text-[#047857]',
  blue: 'bg-[#E0F2FE] text-[#0284C7]',
  slate: 'bg-[#F1F5F9] text-[#475569]',
  dark: 'bg-[#141416] text-white',
  yellow: 'bg-[#FEF08A] text-[#854D0E]',
};
const DOT: Record<PillTone, string> = {
  red: 'bg-[#DC2626]',
  amber: 'bg-[#D97706]',
  green: 'bg-[#059669]',
  blue: 'bg-[#0284C7]',
  slate: 'bg-[#94A3B8]',
  dark: 'bg-[#FFD600]',
  yellow: 'bg-[#CA8A04]',
};
export function Pill({ tone = 'slate', children, dot = true }: { tone?: PillTone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap px-2 py-0.5 rounded-full font-bold text-[10px] ${PILL[tone]}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${DOT[tone]}`} />}
      {children}
    </span>
  );
}

const SYSTEM_ICON: Record<string, React.ReactNode> = {
  EAM: <Database className="w-3 h-3" />,
  'PLM / quality': <Box className="w-3 h-3" />,
  ERP: <LineChart className="w-3 h-3" />,
  WMS: <Warehouse className="w-3 h-3" />,
  'Test bench': <FlaskConical className="w-3 h-3" />,
  'Market data': <LineChart className="w-3 h-3" />,
  'MCP gateway': <Network className="w-3 h-3" />,
  'Model registry': <BookOpen className="w-3 h-3" />,
  'Decision Workbench': <LayoutDashboard className="w-3 h-3" />,
  'Audit ledger': <ShieldCheck className="w-3 h-3" />,
  'Identity provider': <KeyRound className="w-3 h-3" />,
};

/** Source-system chip (EAM, ERP, WMS, …). */
export function SystemChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap px-1.5 py-0.5 rounded-md bg-[#F8FAFC] border border-[#E2E8F0] text-[10px] font-semibold text-[#475569]">
      {SYSTEM_ICON[name] ?? <Database className="w-3 h-3" />}
      {name}
    </span>
  );
}

export const RUN_STATUS: Record<StageRunStatus, { label: string; tone: PillTone }> = {
  completed: { label: 'Completed', tone: 'green' },
  running: { label: 'Running', tone: 'blue' },
  waiting: { label: 'Waiting for approval', tone: 'amber' },
  queued: { label: 'Queued', tone: 'slate' },
  failed: { label: 'Failed', tone: 'red' },
};

/** Reads ?case=RT-1048 once on load (no useSearchParams, so no Suspense needed). */
const noopSubscribe = () => () => {};
export function useInitialCaseParam(fallback: string): [string, (id: string) => void] {
  const fromUrl = useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get('case')?.toUpperCase() ?? null,
    () => null,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const caseId = picked ?? fromUrl ?? fallback;
  const set = (id: string) => {
    setPicked(id);
    replaceUrlParam('case', id);
  };
  return [caseId, set];
}

/** Writes one query param into the current URL without navigating (null removes it). */
export function replaceUrlParam(name: string, value: string | null) {
  try {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    /* ignore */
  }
}

/**
 * A query param as state: read from the URL on load (no useSearchParams, so no Suspense needed),
 * then kept in React state and mirrored back to the URL with history.replaceState.
 */
export function useUrlParam(name: string): [string | null, (v: string | null) => void] {
  const fromUrl = useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
  const [picked, setPicked] = useState<{ v: string | null } | null>(null);
  const value = picked ? picked.v : fromUrl;
  const set = (v: string | null) => {
    setPicked({ v });
    replaceUrlParam(name, v);
  };
  return [value, set];
}

/** `?tab=` deep link for a tabbed page. The default tab keeps the URL clean. */
export function useTabParam<T extends string>(keys: readonly T[], fallback: T): [T, (k: T) => void] {
  const [raw, setRaw] = useUrlParam('tab');
  const tab = raw && (keys as readonly string[]).includes(raw) ? (raw as T) : fallback;
  return [tab, (k: T) => setRaw(k === fallback ? null : k)];
}

/** Searchable case picker over the real case list. */
export function CaseSelect({ value, onChange, width = 300 }: { value: string; onChange: (id: string) => void; width?: number }) {
  const { data, initialLoading } = useServiceQuery(() => governanceService.caseOptions(), []);
  return (
    <Select
      showSearch={{ optionFilterProp: 'label' }}
      value={value}
      onChange={onChange}
      loading={initialLoading}
      style={{ width, maxWidth: '100%' }}
      aria-label="Case"
      popupMatchSelectWidth={false}
      prefix={<span className="text-[#94A3B8] text-xs">Case:</span>}
      options={(data ?? []).map((c) => ({ value: c.id, label: `${c.id} ${c.productName}` }))}
      optionRender={(opt) => {
        const c = data?.find((x) => x.id === opt.value);
        return (
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate">
              <span className="font-mono font-bold text-[#141416] mr-1.5">{c?.id}</span>
              <span className="text-[#475569]">{c?.productName}</span>
            </span>
            <span className="text-[10px] text-[#94A3B8] whitespace-nowrap">{c ? STAGE_META[c.stage].label : ''}</span>
          </div>
        );
      }}
    />
  );
}

/** Triggers a file download in the browser. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });

/** Header row for a governance page section (matches the Exceptions card header). */
export function CardHeader({ icon, title, description, right }: { icon: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-[#F1F5F9] gap-2">
      <div className="flex items-start gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-[#FFFBEB] border border-[#FEF3C7] flex items-center justify-center shrink-0 mt-0.5 text-amber-500 [&>svg]:w-4 [&>svg]:h-4">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-[#141416] m-0">{title}</h2>
          {description && <p className="text-xs text-[#64748B] m-0 mt-0.5">{description}</p>}
        </div>
      </div>
      {right && <div className="flex items-center gap-2 flex-wrap shrink-0">{right}</div>}
    </div>
  );
}

/**
 * Wraps a control that only some roles may use. When not allowed, the caller renders the control
 * disabled and this adds the explanation on hover / focus (disabled buttons get no pointer events,
 * so the tooltip sits on a focusable wrapper).
 */
export function RoleGate({ allowed, reason = 'Admins only', children }: { allowed: boolean; reason?: string; children: React.ReactNode }) {
  if (allowed) return <>{children}</>;
  return (
    <Tooltip title={reason}>
      <span tabIndex={0} aria-label={reason} className="inline-flex cursor-not-allowed [&>*]:pointer-events-none">
        {children}
      </span>
    </Tooltip>
  );
}

/** One-line notice shown to roles that see a governance page read-only. */
export function ReadOnlyNotice({ children = 'Read-only. Only Admins can change these settings.' }: { children?: React.ReactNode }) {
  return (
    <div role="note" className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F1F5F9] text-[11px] font-semibold text-[#475569]">
      <Lock className="w-3.5 h-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
