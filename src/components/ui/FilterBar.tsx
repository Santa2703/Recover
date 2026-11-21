'use client';

import React from 'react';
import { Input, Select, Button } from 'antd';
import { Search, RotateCcw } from 'lucide-react';

/** One row of filters above a table or chart group. */
export function FilterBar({ children, onClear, canClear }: { children: React.ReactNode; onClear?: () => void; canClear?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {onClear && (
        <Button type="text" size="small" icon={<RotateCcw size={14} />} onClick={onClear} disabled={!canClear} className="!text-ink-2">
          Clear
        </Button>
      )}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  width = 280,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number | string;
}) {
  return (
    <Input
      allowClear
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      prefix={<Search size={14} className="text-ink-3" />}
      style={{ width, maxWidth: '100%' }}
      aria-label={placeholder}
    />
  );
}

export interface Option<V extends string = string> {
  value: V;
  label: string;
}

/** Labelled select; the label is rendered inside the control so the bar stays one row. */
export function FilterSelect<V extends string>({
  label,
  value,
  onChange,
  options,
  width = 170,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: Option<V>[];
  width?: number;
}) {
  return (
    <Select<V>
      value={value}
      onChange={onChange}
      style={{ width }}
      aria-label={label}
      options={options}
      prefix={<span className="text-ink-3">{label}:</span>}
      popupMatchSelectWidth={false}
    />
  );
}
