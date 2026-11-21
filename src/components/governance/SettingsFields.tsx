'use client';

import React, { useState } from 'react';
import { message } from 'antd';

export const fieldCls = 'w-full px-3 py-2 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl text-xs font-medium focus:outline-none focus:border-[#FFD600]';
export const labelCls = 'block text-xs font-semibold text-[#64748B] mb-1.5';

/** Saves through `onSave` when the value changed and the field loses focus (or Enter is pressed). */
export function SaveOnBlur({
  value,
  onSave,
  type = 'text',
  className = fieldCls,
  ariaLabel,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
  type?: 'text' | 'number';
  className?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  const commit = async () => {
    if (draft === value) return;
    if (type === 'number' && (draft === '' || Number(draft) < 0)) {
      message.error('Enter a number of 0 or more');
      setDraft(value);
      return;
    }
    await onSave(draft);
  };
  return (
    <input
      type={type}
      value={draft}
      min={type === 'number' ? 0 : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={className}
      aria-label={ariaLabel}
    />
  );
}

/** Title + help on the left, control on the right (stacks on narrow screens). */
export function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4">
      <div className="min-w-0 max-w-xl">
        <div className="font-bold text-[#141416]">{title}</div>
        <div className="text-[#64748B] text-[11px] mt-0.5">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="text-sm font-extrabold text-[#141416] tracking-tight m-0">{title}</h2>
      {description && <p className="text-xs text-[#64748B] m-0 mt-0.5">{description}</p>}
    </div>
  );
}
