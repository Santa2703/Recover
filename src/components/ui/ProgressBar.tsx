'use client';

import React, { useEffect, useState } from 'react';
import { statusTone, type Tone } from '@/theme/tokens';

interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: Tone | 'ink';
  /** Accessible label, e.g. "Inspection capacity used" */
  label: string;
  showValue?: boolean;
  height?: number;
}

/** Fills smoothly from 0 on mount (CSS transition; reduced motion handled globally). */
export function ProgressBar({ value, max = 100, tone = 'ink', label, showValue, height = 6 }: ProgressBarProps) {
  const pctValue = Math.max(0, Math.min(100, (value / max) * 100));
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(pctValue));
    return () => cancelAnimationFrame(id);
  }, [pctValue]);
  const color = tone === 'ink' ? 'var(--ink)' : statusTone[tone].fg;
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative flex-1 overflow-hidden rounded-full bg-surface-2"
        style={{ height }}
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className="progress-fill h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
      {showValue && <span className="tabular w-10 text-right text-[11px] text-ink-2">{Math.round(pctValue)}%</span>}
    </div>
  );
}
