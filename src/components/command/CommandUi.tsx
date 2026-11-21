'use client';

import React from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import type { DispositionRouteId } from '@/models/treatment.model';

/** Filter row in the local style: search on the left, selects on the right, wraps instead of overflowing. */
export function CommandFilters({
  search,
  onSearch,
  placeholder,
  children,
  onClear,
  canClear,
}: {
  search: string;
  onSearch: (v: string) => void;
  placeholder: string;
  children?: React.ReactNode;
  onClear: () => void;
  canClear: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-2xs">
      <div className="relative min-w-0 flex-1 basis-60">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full max-w-md rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] py-1.5 pl-9 pr-3 text-xs text-[#141416] placeholder-[#94A3B8] transition-all focus:border-[#FFD600] focus:bg-white focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onClear}
          disabled={!canClear}
          className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#64748B] transition-colors hover:text-[#141416] disabled:cursor-default disabled:opacity-40 disabled:hover:text-[#64748B]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Clear filters</span>
        </button>
      </div>
    </div>
  );
}

export function CommandSelect<V extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string }[];
  label: string;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as V)}
      className="max-w-full cursor-pointer rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-xs font-semibold text-[#141416] hover:bg-white focus:border-[#FFD600] focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Operational / Senior switch. Only use where the two modes show different content. */
export function ModeToggle<M extends string>({ value, onChange, modes }: { value: M; onChange: (m: M) => void; modes: M[] }) {
  return (
    <div role="radiogroup" aria-label="View" className="flex items-center rounded-full bg-[#F1F5F9] p-1 text-xs font-semibold">
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          onClick={() => onChange(m)}
          className={`cursor-pointer rounded-full px-3.5 py-1 transition-all ${value === m ? 'bg-[#141416] text-white shadow-xs' : 'text-[#64748B] hover:text-[#141416]'}`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

/** Yellow count pill used in card headers ("11 open · $19k"). */
export function CountPill({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 rounded-full bg-[#FEF08A] px-3 py-1 text-xs font-extrabold text-[#854D0E]">{children}</span>;
}

/** Disposition route chip: route colour as a dot so light colours stay legible. */
export function RoutePill({ route }: { route: DispositionRouteId }) {
  const r = DISPOSITION_ROUTES[route];
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-0.5 text-[10px] font-bold text-[#141416]">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r?.color ?? '#94A3B8' }} />
      <span className="truncate">{r?.name ?? route}</span>
    </span>
  );
}

/** Section card with the local header (amber icon tile, title, description, right-hand slot). */
export function SectionCard({
  title,
  description,
  icon,
  right,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-2xs">
      <div className="flex flex-col justify-between gap-2 border-b border-[#F1F5F9] pb-3.5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon && (
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#FEF3C7] bg-[#FFFBEB] text-amber-500 [&>svg]:h-4 [&>svg]:w-4">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-extrabold text-[#141416]">{title}</h2>
            {description && <p className="m-0 mt-0.5 text-xs text-[#64748B]">{description}</p>}
          </div>
        </div>
        {right && <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-auto">{right}</div>}
      </div>
      <div className="pt-3">{children}</div>
    </section>
  );
}
