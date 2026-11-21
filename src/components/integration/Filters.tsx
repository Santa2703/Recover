'use client';

import React from 'react';
import { Popover } from 'antd';
import { RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { BTN_GHOST, BTN_SECONDARY } from './styles';

/** Search input in the Exceptions style; grows to fill the filter row. */
export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="relative w-full min-w-0 max-w-md flex-1 basis-56">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] py-1.5 pl-9 pr-3 text-xs text-[#141416] placeholder-[#94A3B8] transition-all focus:border-[#FFD600] focus:bg-white focus:outline-none"
      />
    </div>
  );
}

/** Secondary filters behind a "More filters" popover; shows how many are active. */
export function MoreFilters({ active, children }: { active: number; children: React.ReactNode }) {
  return (
    <Popover trigger="click" placement="bottomRight" content={<div className="flex w-56 flex-col gap-3 text-xs">{children}</div>}>
      <button type="button" className={BTN_SECONDARY} aria-label="More filters">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span>More filters</span>
        {active > 0 && <span className="rounded-full bg-[#FEF08A] px-1.5 text-[10px] font-extrabold text-[#854D0E]">{active}</span>}
      </button>
    </Popover>
  );
}

/** Label + control inside the "More filters" popover. */
export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">{label}</span>
      {children}
    </label>
  );
}

/** One wrapping filter row inside a card. */
export function FilterRow({ children, onClear, canClear }: { children: React.ReactNode; onClear: () => void; canClear: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-2xs">
      {children}
      <button type="button" onClick={onClear} disabled={!canClear} className={`${BTN_GHOST} ml-auto`}>
        <RotateCcw className="h-3.5 w-3.5" />
        <span>Clear filters</span>
      </button>
    </div>
  );
}

/** Page title block. The app header already shows the section breadcrumb, so pages normally pass no crumb. */
export function FabricHeader({ crumb, title, description, actions }: { crumb?: React.ReactNode; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 pt-1 md:flex-row md:items-start">
      <div className="min-w-0">
        {crumb}
        <h1 className="m-0 text-2xl font-extrabold leading-tight tracking-tight text-[#141416]">{title}</h1>
        <p className="m-0 mt-1 max-w-2xl text-xs leading-relaxed text-[#6B7280]">{description}</p>
      </div>
      {actions && <div className="shrink-0 pt-1">{actions}</div>}
    </div>
  );
}
