'use client';

import React from 'react';
import { Popover, Select } from 'antd';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';

export interface Opt {
  value: string;
  label: string;
}

/** Select with its label inside the control, so the filter row stays one wrapping line. */
export function LabeledSelect({ label, value, onChange, options, width = 190, disabled }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  width?: number | string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      aria-label={label}
      style={{ width, maxWidth: '100%' }}
      popupMatchSelectWidth={false}
      prefix={<span className="text-[#94A3B8]">{label}:</span>}
    />
  );
}

export interface MoreFilter {
  key: string;
  label: string;
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
}

/** "More filters" popover: secondary filters stacked, with a count of the active ones. */
export function MoreFilters({ filters, onClear }: { filters: MoreFilter[]; onClear: () => void }) {
  const active = filters.filter((f) => f.value !== f.options[0]?.value).length;
  const content = (
    <div className="flex w-64 max-w-[80vw] flex-col gap-3">
      {filters.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">{f.label}</span>
          <Select value={f.value} onChange={f.onChange} options={f.options} aria-label={f.label} style={{ width: '100%' }} />
        </label>
      ))}
      <button
        type="button"
        onClick={onClear}
        disabled={!active}
        className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RotateCcw size={13} /> Clear
      </button>
    </div>
  );
  return (
    <Popover trigger="click" placement="bottomLeft" content={content}>
      <button
        type="button"
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400"
      >
        <SlidersHorizontal size={14} className="text-[#64748B]" />
        More filters
        {active > 0 && <span className="rounded-full bg-[#FFD600] px-1.5 text-[10px] font-extrabold text-[#141416]">{active}</span>}
      </button>
    </Popover>
  );
}
