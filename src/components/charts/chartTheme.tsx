'use client';

import React from 'react';
import { chartColors, tokens } from '@/theme/tokens';

export const AXIS_TICK = { fill: tokens.ink3, fontSize: 11 } as const;
export const GRID_PROPS = { stroke: chartColors.grid, strokeDasharray: '0', vertical: false } as const;
export const ANIMATION_MS = 700;

export type ValueFormat = (v: number) => string;
export const defaultFormat: ValueFormat = (v) => v.toLocaleString('en-US');

interface TooltipPayloadItem {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  fill?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

/** Shared tooltip body: series swatch + name in secondary ink, value in primary ink. */
export function ChartTooltip({
  active,
  payload,
  label,
  format = defaultFormat,
  labelFormat,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  format?: ValueFormat;
  labelFormat?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const title = label !== undefined && label !== '' ? String(label) : String(payload[0]?.payload?.label ?? '');
  return (
    <div className="min-w-[140px] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-[0_4px_16px_rgba(24,25,27,0.08)]">
      {title && <div className="mb-1 font-medium text-ink">{labelFormat ? labelFormat(title) : title}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-2">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color || p.fill }} />
            {p.name}
          </span>
          <span className="tabular font-medium text-ink">{typeof p.value === 'number' ? format(p.value) : String(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Legend for >= 2 series. Text stays in ink tokens; the swatch carries identity. */
export function ChartLegend({ items }: { items: { label: string; color: string; dashed?: boolean; value?: string }[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-xs text-ink-2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          {it.dashed ? (
            <span className="h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: it.color }} />
          ) : (
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: it.color }} />
          )}
          {it.label}
          {it.value && <span className="tabular font-medium text-ink">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Wraps a chart with an accessible description. */
export function ChartFrame({ label, children, height }: { label: string; children: React.ReactNode; height: number }) {
  return (
    <figure className="m-0 w-full min-w-0" role="img" aria-label={label} style={{ height }}>
      {children}
    </figure>
  );
}
