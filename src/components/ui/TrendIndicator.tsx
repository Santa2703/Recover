import React from 'react';
import { ArrowDownRight, ArrowUpRight, ArrowRight } from 'lucide-react';

interface TrendIndicatorProps {
  /** Signed change, already formatted by the caller or numeric ratio when `asPercent`. */
  value: number;
  /** Text shown after the value, e.g. "vs prior 12 mo". */
  label?: string;
  /** Is an increase good (revenue) or bad (value at risk)? Default true. */
  upIsGood?: boolean;
  format?: (v: number) => string;
}

export function TrendIndicator({ value, label, upIsGood = true, format }: TrendIndicatorProps) {
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const good = dir === 'flat' ? null : (dir === 'up') === upIsGood;
  const color = good === null ? 'text-ink-2' : good ? 'text-success' : 'text-danger';
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : ArrowRight;
  const text = format ? format(Math.abs(value)) : `${Math.abs(value)}`;
  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      <span className={`inline-flex items-center gap-0.5 font-medium ${color}`}>
        <Icon size={13} strokeWidth={2.25} aria-hidden />
        <span className="sr-only">{dir === 'up' ? 'Up' : dir === 'down' ? 'Down' : 'Unchanged'}</span>
        {text}
      </span>
      {label && <span className="text-ink-3">{label}</span>}
    </span>
  );
}
