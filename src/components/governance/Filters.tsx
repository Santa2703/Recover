'use client';

import React from 'react';
import { Popover } from 'antd';
import { Search, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { inputCls, selectCls } from './shared';

/** Card shell used by every governance section (local style, p-5). */
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-2xs ${className}`}>{children}</section>;
}

/** Search input that shrinks with its container (no fixed min width). */
export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="relative w-full min-w-0 sm:w-72 sm:flex-none">
      <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} aria-label={label} />
    </div>
  );
}

export interface SelectOpt {
  value: string;
  label: string;
}

/** Native select in the local style. */
export function FilterPick({ value, onChange, options, label, className = '' }: { value: string; onChange: (v: string) => void; options: SelectOpt[]; label: string; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${selectCls} max-w-full ${className}`} aria-label={label}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** "More filters" button + popover holding the secondary filters. */
export function MoreFilters({ children, active }: { children: React.ReactNode; active: number }) {
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      content={<div className="flex flex-col gap-2 w-60 max-w-[80vw] [&_select]:w-full">{children}</div>}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-xl text-xs font-semibold text-[#141416] shadow-2xs cursor-pointer"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span>More filters</span>
        {active > 0 && <span className="ml-0.5 px-1.5 rounded-full bg-[#FFD600] text-[10px] font-extrabold">{active}</span>}
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
      className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-[#64748B] hover:text-[#141416] font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <RotateCcw className="w-3.5 h-3.5" />
      <span>Clear</span>
    </button>
  );
}

/** Wrapping filter row: search first, then primary filters, More filters and Clear. */
export function FilterRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 min-w-0">{children}</div>;
}
