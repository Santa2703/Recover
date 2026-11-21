'use client';

import React, { useEffect, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface Segment {
  id: string;
  label: string;
  value: number;
  color: string;
}

interface SegmentedBarProps {
  segments: Segment[];
  ariaLabel: string;
  unit?: string;
  height?: number;
  onSegmentClick?: (s: Segment) => void;
}

/**
 * One 100% bar split into ordered segments (urgency buckets, status mix).
 * Segments grow in from the left on mount; a legend lists counts so identity is never colour-only.
 */
export function SegmentedBar({ segments, ariaLabel, unit = '', height = 14, onSegmentClick }: SegmentedBarProps) {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [reduced]);
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;

  return (
    <div className="space-y-3">
      <div className="flex w-full gap-[2px] overflow-hidden rounded-[4px]" style={{ height }} role="img" aria-label={ariaLabel}>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <button
              key={s.id}
              type="button"
              title={`${s.label}: ${s.value}${unit ? ` ${unit}` : ''}`}
              onClick={() => onSegmentClick?.(s)}
              disabled={!onSegmentClick}
              className="h-full border-0 p-0 transition-[width] duration-700 ease-out enabled:cursor-pointer enabled:hover:opacity-85"
              style={{ width: ready ? `${(s.value / total) * 100}%` : '0%', backgroundColor: s.color }}
            />
          ))}
      </div>
      {/* Legend wraps by available width (min 9rem per item) so labels never truncate in narrow cards. */}
      <ul className="m-0 grid list-none gap-x-4 gap-y-1.5 p-0" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))' }}>
        {segments.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{s.label}</span>
            <span className="tabular font-medium text-ink">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
