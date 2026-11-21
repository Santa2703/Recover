'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Popover } from 'antd';
import { Info } from 'lucide-react';
import type { DecisionScope, HowCalculated as HowCalculatedData, KpiKey } from '@/models/decision.model';
import { howCalculated } from '@/services/decisionService';
import { formatMoney } from '@/services/dashboardService';

const ROWS_SHOWN = 6;

/** Value in the KPI's unit: "$44k", "−$2k", "12", "94.5%". */
export function formatKpiValue(value: number, unit: HowCalculatedData['unit']): string {
  if (unit === 'pct') return `${value}%`;
  if (unit === 'count') return String(value);
  return `${value < 0 ? '−' : ''}${formatMoney(Math.abs(Math.round(value)))}`;
}

function Breakdown({ kpi, scope }: { kpi: KpiKey; scope: DecisionScope }) {
  const [all, setAll] = useState(false);
  // Synchronous and pure: derived during render for the scope the KPI uses.
  const h = howCalculated(kpi, scope);
  const rows = all ? h.rows : h.rows.slice(0, ROWS_SHOWN);
  return (
    <div className="w-[min(360px,calc(100vw-48px))] text-xs text-[#141416]">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-extrabold">{h.title}</div>
        <div className="shrink-0 font-mono text-sm font-black">{formatKpiValue(h.value, h.unit)}</div>
      </div>
      <p className="m-0 mt-1.5 leading-relaxed text-[#475569]">{h.formula}</p>
      <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
        {h.rows.length ? `Behind the number (${h.rows.length})` : 'Behind the number'}
      </div>
      {h.rows.length ? (
        <ul className={`m-0 mt-1 list-none divide-y divide-[#F1F5F9] p-0 ${all ? 'max-h-64 overflow-y-auto' : ''}`}>
          {rows.map((r) => {
            const text = (
              <>
                <span className="min-w-0">
                  <span className={`block truncate font-semibold ${r.caseId ? 'group-hover:underline' : ''}`}>{r.label}</span>
                  <span className="block truncate text-[11px] text-[#64748B]" title={r.detail}>
                    {r.detail}
                  </span>
                </span>
                {h.unit !== 'count' && <span className="shrink-0 font-mono font-bold">{formatKpiValue(r.value, h.unit)}</span>}
              </>
            );
            return (
              <li key={r.id}>
                {r.caseId ? (
                  <Link href={`/product/case/${r.caseId}`} className="group flex items-center justify-between gap-3 py-1.5 text-inherit no-underline">
                    {text}
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-3 py-1.5">{text}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 mt-1 text-[#64748B]">Nothing in this scope.</p>
      )}
      {h.rows.length > ROWS_SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-[#64748B] hover:text-[#141416]">
          {all ? 'Show fewer' : `Show all ${h.rows.length}`}
        </button>
      )}
    </div>
  );
}

interface HowCalculatedProps {
  /** KPI whose formula and rows to explain (decisionService.howCalculated). */
  kpi: KpiKey;
  /** Same scope as the number on screen. */
  scope?: DecisionScope;
  /** "icon": small info button (tight spaces); "text": "How calculated" text button. */
  variant?: 'icon' | 'text';
  /** Name of the KPI for the accessible label. */
  label?: string;
  className?: string;
}

/** "How calculated" affordance: opens the plain-language formula and the rows behind a KPI. */
export function HowCalculated({ kpi, scope = {}, variant = 'text', label, className = '' }: HowCalculatedProps) {
  const [open, setOpen] = useState(false);
  const aria = `How ${label ?? 'this number'} is calculated`;
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      destroyOnHidden
      content={
        <div
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          <Breakdown kpi={kpi} scope={scope} />
        </div>
      }
    >
      <button
        type="button"
        aria-label={aria}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={variant === 'icon' ? 'How calculated' : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className={
          variant === 'icon'
            ? `relative z-10 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 text-[#94A3B8] transition-colors hover:bg-[#F1F5F9] hover:text-[#141416] focus-visible:outline-2 focus-visible:outline-[#FFD600] ${className}`
            : `relative z-10 inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[11px] font-semibold text-[#64748B] underline decoration-dotted underline-offset-2 hover:text-[#141416] ${className}`
        }
      >
        {variant === 'icon' ? <Info size={14} aria-hidden /> : <>How calculated</>}
      </button>
    </Popover>
  );
}
