'use client';

import React, { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Popover, Tag } from 'antd';
import { Search, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { mcpNow, type CallResult, type GateStatus, type RiskLevel, type ToolScope } from '@/services/mcpService';

/* ------------------------------------------------------------------ format */

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Math.max(0, mcpNow() - new Date(iso).getTime());
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function absTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`);

/* ------------------------------------------------------------------ pills */

export type PillTone = 'high' | 'medium' | 'ok' | 'info' | 'neutral' | 'dark';
const PILL: Record<PillTone, string> = {
  high: 'bg-[#FEE2E2] text-[#B91C1C]',
  medium: 'bg-[#FEF3C7] text-[#D97706]',
  ok: 'bg-[#ECFDF5] text-[#047857]',
  info: 'bg-[#E0F2FE] text-[#0284C7]',
  neutral: 'bg-[#F1F5F9] text-[#475569]',
  dark: 'bg-[#141416] text-white',
};
const DOT: Record<PillTone, string> = {
  high: 'bg-[#DC2626]',
  medium: 'bg-[#D97706]',
  ok: 'bg-[#059669]',
  info: 'bg-[#0284C7]',
  neutral: 'bg-[#94A3B8]',
  dark: 'bg-[#FFD600]',
};

export function Pill({ tone = 'neutral', children, dot = true, className = '' }: { tone?: PillTone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${PILL[tone]} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />}
      {children}
    </span>
  );
}

/** Safety scope tag, same look as the original catalog table. */
export function ScopeTag({ scope }: { scope: ToolScope }) {
  const color = scope === 'write_gated' ? 'red' : scope === 'compute' ? 'purple' : 'green';
  return (
    <Tag color={color} className="!m-0 font-mono !text-[10px] font-bold uppercase">
      {scope}
    </Tag>
  );
}

export function RiskPill({ risk }: { risk: RiskLevel }) {
  const tone: PillTone = risk === 'high' ? 'high' : risk === 'medium' ? 'medium' : 'ok';
  return <Pill tone={tone}>{risk === 'medium' ? 'Med' : risk[0].toUpperCase() + risk.slice(1)} risk</Pill>;
}

export const RESULT_META: Record<CallResult, { label: string; tone: PillTone }> = {
  success: { label: 'Success', tone: 'ok' },
  error: { label: 'Error', tone: 'high' },
  held: { label: 'Held', tone: 'medium' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  denied: { label: 'Denied', tone: 'high' },
};
export function ResultPill({ result }: { result: CallResult }) {
  const m = RESULT_META[result];
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

export const GATE_META: Record<GateStatus, { label: string; tone: PillTone }> = {
  not_required: { label: 'Not gated', tone: 'neutral' },
  pending: { label: 'Awaiting approval', tone: 'medium' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'high' },
};
export function GatePill({ gate }: { gate: GateStatus }) {
  const m = GATE_META[gate];
  if (gate === 'not_required') return <span className="text-[11px] text-[#94A3B8]">Not gated</span>;
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

/* ------------------------------------------------------------------ buttons & inputs */

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-[#FFD600] hover:bg-[#FACC15] text-[#141416] font-extrabold shadow-2xs',
  secondary: 'bg-white border border-[#E2E8F0] hover:border-gray-400 text-[#141416] font-semibold shadow-2xs',
  ghost: 'text-[#64748B] hover:text-[#141416] font-semibold',
  danger: 'bg-white border border-[#FECACA] hover:border-[#DC2626] text-[#DC2626] font-semibold shadow-2xs',
};

export function Btn({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; icon?: React.ReactNode }) {
  const sz = size === 'sm' ? 'px-2 py-0.5 rounded-lg text-[10px] gap-1' : 'px-3 py-1.5 rounded-xl text-xs gap-1.5';
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center whitespace-nowrap transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${sz} ${BTN[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

/** Link styled as a button (navigation actions). */
export function BtnLink({ href, variant = 'secondary', icon, children }: { href: string; variant?: BtnVariant; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex no-underline">
      {/* styling lives on the span: antd's global `a` reset would override utility backgrounds */}
      <span className={`inline-flex items-center justify-center whitespace-nowrap transition-all px-3 py-1.5 rounded-xl text-xs gap-1.5 ${BTN[variant]}`}>
        {icon}
        {children}
      </span>
    </Link>
  );
}

export function NativeSelect<V extends string>({
  value,
  onChange,
  options,
  label,
  className = '',
}: {
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as V)}
      className={`px-3 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#141416] cursor-pointer hover:bg-white focus:outline-none focus:border-[#FFD600] ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full max-w-md">
      <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        type="text"
        value={value}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-3 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs text-[#141416] placeholder-[#94A3B8] focus:outline-none focus:border-[#FFD600] focus:bg-white transition-all"
      />
    </div>
  );
}

/** "More filters" popover for secondary filters; shows how many of them are active. */
export function MoreFilters({ active, children }: { active: number; children: React.ReactNode }) {
  return (
    <Popover trigger="click" placement="bottomRight" content={<div className="flex w-64 max-w-[80vw] flex-col gap-3">{children}</div>}>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] shadow-2xs transition-all hover:border-gray-400 cursor-pointer"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        More filters
        {active > 0 && <span className="rounded-full bg-[#FFD600] px-1.5 text-[10px] font-extrabold text-[#141416]">{active}</span>}
      </button>
    </Popover>
  );
}

/** Labelled field inside the "More filters" popover. */
export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">{label}</span>
      {children}
    </div>
  );
}

/** Search + selects bar, same card as the Exceptions page. Wraps; never scrolls sideways. */
export function FilterCard({ search, children, onClear, canClear = true }: { search: React.ReactNode; children?: React.ReactNode; onClear?: () => void; canClear?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] p-3 shadow-2xs flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 basis-64 items-center gap-2.5">{search}</div>
      <div className="flex items-center gap-2 flex-wrap">
        {children}
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            disabled={!canClear}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#64748B] hover:text-[#141416] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear filters</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Pill toggle, same as the Operational / Senior switch. */
export function PillToggle<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: { value: V; label: React.ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="bg-[#F1F5F9] p-1 rounded-full flex items-center text-xs font-semibold">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3.5 py-1 rounded-full transition-all cursor-pointer whitespace-nowrap ${
            value === o.value ? 'bg-[#141416] text-white shadow-xs' : 'text-[#64748B] hover:text-[#141416]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ blocks */

export function JsonBlock({ value, maxHeight = 260 }: { value: unknown; maxHeight?: number }) {
  return (
    <pre
      className="m-0 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 font-mono text-[11px] leading-relaxed text-[#334155]"
      style={{ maxHeight }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] mb-1.5">{children}</div>;
}

export function FactGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#E2E8F0]">
      {items.map((it) => (
        <div key={it.label} className="bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">{it.label}</div>
          <div className="mt-0.5 text-xs font-semibold text-[#141416]">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Drawer / modal title with the amber icon tile. */
export function TitleWithIcon({ icon, title, sub }: { icon: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#FEF3C7] bg-[#FFFBEB] text-amber-500 [&>svg]:h-4 [&>svg]:w-4">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-extrabold text-[#141416] leading-tight">{title}</div>
        {sub && <div className="mt-0.5 text-xs font-normal text-[#64748B]">{sub}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ URL state */

const URL_EVENT = 'mcp:urlchange';
function subscribeUrl(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(URL_EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(URL_EVENT, cb);
  };
}
const readSearch = () => window.location.search;
const serverSearch = () => '';

/**
 * Query params as state for deep links (?tab=, ?agent=, ?playground=…). Reads window.location
 * (no useSearchParams, so no Suspense boundary) and writes with history.replaceState.
 * `null` removes a param.
 */
export function useUrlState(): [URLSearchParams, (patch: Record<string, string | null>) => void] {
  const search = useSyncExternalStore(subscribeUrl, readSearch, serverSearch);
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const set = (patch: Record<string, string | null>) => {
    try {
      const url = new URL(window.location.href);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) url.searchParams.delete(k);
        else url.searchParams.set(k, v);
      }
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new Event(URL_EVENT));
    } catch {
      /* ignore */
    }
  };
  return [params, set];
}
