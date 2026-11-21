'use client';

import React from 'react';
import { ChevronDown, Download, RotateCcw, Search } from 'lucide-react';

/** Native select in the local filter style (Exceptions page). */
export function SelectFilter<V extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
  title,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string }[];
  disabled?: boolean;
  title?: string;
}) {
  return (
    <select
      aria-label={label}
      title={title ?? label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as V)}
      className="px-3 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#141416] cursor-pointer hover:bg-white focus:outline-none focus:border-[#FFD600] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Pill toggle (Operational / Senior style). */
export function SegmentToggle<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="bg-[#F1F5F9] p-1 rounded-full flex items-center text-xs font-semibold">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`px-3.5 py-1 rounded-full transition-all cursor-pointer ${
              active ? 'bg-[#141416] text-white shadow-xs' : 'text-[#64748B] hover:text-[#141416]'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** "Show table" / "Hide table" text toggle for a panel header: exact values stay one click away. */
export function ShowToggle({ open, onToggle, controls, label = 'table' }: { open: boolean; onToggle: () => void; controls: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="flex cursor-pointer items-center gap-1 bg-transparent p-0 text-xs font-semibold text-[#64748B] hover:text-[#141416]"
    >
      {open ? 'Hide' : 'Show'} {label}
      <ChevronDown size={13} aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

/** The single primary (yellow) action on an analytics screen. */
export function ExportButton({ onClick, disabled, label = 'Export CSV' }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#FFD600] hover:bg-[#FACC15] text-[#141416] rounded-xl text-xs font-extrabold shadow-2xs transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Download className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
}

/** Pill shown at the right of a card header, e.g. "6 stages · Oct 26". */
export function CountPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-3 py-1 rounded-full bg-[#FEF08A] text-[#854D0E] font-extrabold text-xs whitespace-nowrap">{children}</span>
  );
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Builds a CSV in the browser and downloads it. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const body = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fmtPct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const fmtMoney = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`;
/** "+$1.2k" / "−$300" */
export const fmtSignedMoney = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtMoney(Math.abs(n))}`;
export const fmtSignedPct = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(digits)}%`;
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

export type Period = '3' | '6' | '12';
export const PERIODS: { value: Period; label: string }[] = [
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
];

/** Wrapping row for page-level filters (below the header, never scrolls sideways). */
export function FilterRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/** Text search in the local input style. */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full min-w-0 sm:w-72">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] py-1.5 pl-9 pr-3 text-xs text-[#141416] placeholder-[#94A3B8] transition-all focus:border-[#FFD600] focus:bg-white focus:outline-none"
      />
    </div>
  );
}

/** "Clear filters" text button. */
export function ClearButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-[#64748B] transition-colors hover:text-[#141416] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RotateCcw className="h-3.5 w-3.5" />
      <span>Clear filters</span>
    </button>
  );
}
