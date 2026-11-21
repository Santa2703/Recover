'use client';

import React, { useEffect, useRef } from 'react';
import { Pagination, Popover, message } from 'antd';
import { Search, RotateCcw, SlidersHorizontal } from 'lucide-react';

/**
 * Small building blocks shared by the product screens (Returned, Expected, Pools,
 * Intelligence, Case). Local card style with p-5, wrapping filter rows, and
 * real Share / Export helpers.
 */

/**
 * Page title block in the PageHeader style, but the actions move beside the title only
 * from 1024px, so at tablet widths the title keeps the full row instead of being squeezed.
 */
export function ProductHeader({ title, description, actions }: { title: React.ReactNode; description: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-3 pt-1 lg:flex-row lg:items-start">
      <div className="min-w-0">
        <h1 className="m-0 text-2xl font-extrabold leading-tight tracking-tight text-[#141416]">{title}</h1>
        <p className="m-0 mt-1 max-w-2xl text-xs font-normal leading-relaxed text-[#6B7280]">{description}</p>
      </div>
      {actions && <div className="shrink-0 pt-1">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-2xs ${className}`}>{children}</section>;
}

export function CardTitle({
  icon,
  title,
  description,
  actions,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 pb-4">
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
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CountPill({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap rounded-full bg-[#FEF08A] px-2.5 py-0.5 text-[11px] font-extrabold text-[#854D0E]">{children}</span>;
}

const selectCls =
  'max-w-full px-3 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#141416] cursor-pointer hover:bg-white focus:outline-none focus:border-[#FFD600]';

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full min-w-0 sm:w-72 sm:flex-none">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] py-1.5 pl-9 pr-3 text-xs text-[#141416] placeholder-[#94A3B8] transition-all focus:border-[#FFD600] focus:bg-white focus:outline-none"
      />
    </div>
  );
}

export interface PickOption {
  value: string;
  label: string;
}

export function FilterPick({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: PickOption[]; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} title={label} className={selectCls}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** "More filters" button with the secondary filters in a popover. */
export function MoreFilters({ children, active }: { children: React.ReactNode; active: number }) {
  return (
    <Popover trigger="click" placement="bottomRight" content={<div className="flex w-60 max-w-[80vw] flex-col gap-2 [&_select]:w-full">{children}</div>}>
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span>More filters</span>
        {active > 0 && <span className="ml-0.5 rounded-full bg-[#FFD600] px-1.5 text-[10px] font-extrabold">{active}</span>}
      </button>
    </Popover>
  );
}

export function ClearFilters({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-[#64748B] transition-colors hover:text-[#141416] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <RotateCcw className="h-3.5 w-3.5" />
      <span>Clear filters</span>
    </button>
  );
}

export function FilterRow({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>;
}

/** Server-side pagination under a DataTable (works for both the table and the card layout). */
export function ListPagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  if (total <= pageSize) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
      <span className="text-[11px] text-[#64748B]">
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <Pagination size="small" current={page} pageSize={pageSize} total={total} onChange={onChange} showSizeChanger={false} />
    </div>
  );
}

/** Copies the current URL (filters included) to the clipboard. */
export async function copyPageLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    message.success('Link copied to clipboard');
  } catch {
    message.error('Clipboard is not available in this browser');
  }
}

/**
 * Keeps filter state in the URL so a copied link reopens the same view.
 * `read` runs once after mount (window is client-only); `values` are written back on change.
 */
export function useUrlFilters(values: Record<string, string | number>, read: (params: URLSearchParams) => void) {
  const readRef = useRef(read);
  const restored = useRef(false);
  const skipFirstWrite = useRef(true);
  useEffect(() => {
    // Read once (dev Strict Mode re-runs effects; a second read would see the URL mid-update).
    if (restored.current) return;
    restored.current = true;
    readRef.current(new URLSearchParams(window.location.search));
  }, []);
  const serialised = JSON.stringify(values);
  useEffect(() => {
    // The first run still holds the defaults; writing them would drop the params just read.
    if (skipFirstWrite.current) {
      skipFirstWrite.current = false;
      return;
    }
    const params = new URLSearchParams();
    Object.entries(JSON.parse(serialised) as Record<string, string | number>).forEach(([k, v]) => {
      if (v !== '' && v !== 'all' && v !== 1 && v !== undefined) params.set(k, String(v));
    });
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [serialised]);
}
