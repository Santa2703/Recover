import React from 'react';
import { CircleCheck, CircleAlert, TriangleAlert, Clock, CirclePause } from 'lucide-react';
import type { SourceStatus, SyncRunStatus } from '@/services/sourceService';
import { clockNow } from '@/services/sourceService';

/** One place for status labels and colours so the tree, graph, list, matrix and detail agree. */
export const STATUS_META: Record<SourceStatus, { label: string; dot: string; fg: string; bg: string; edge: string; icon: React.ReactNode }> = {
  healthy: { label: 'Healthy', dot: '#10B981', fg: '#047857', bg: '#ECFDF5', edge: '#CBD5E1', icon: <CircleCheck size={12} strokeWidth={2.25} /> },
  warning: { label: 'Warning', dot: '#F59E0B', fg: '#D97706', bg: '#FEF3C7', edge: '#F59E0B', icon: <TriangleAlert size={12} strokeWidth={2.25} /> },
  stale: { label: 'Stale', dot: '#D97706', fg: '#B45309', bg: '#FFFBEB', edge: '#D97706', icon: <Clock size={12} strokeWidth={2.25} /> },
  failed: { label: 'Failed', dot: '#EF4444', fg: '#B91C1C', bg: '#FEE2E2', edge: '#DC2626', icon: <CircleAlert size={12} strokeWidth={2.25} /> },
  paused: { label: 'Paused', dot: '#94A3B8', fg: '#475569', bg: '#F1F5F9', edge: '#E2E8F0', icon: <CirclePause size={12} strokeWidth={2.25} /> },
};

export const STATUS_ORDER: SourceStatus[] = ['healthy', 'warning', 'stale', 'failed', 'paused'];

export function SourceStatusPill({ status, className = '' }: { status: SourceStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}
      style={{ color: m.fg, backgroundColor: m.bg }}
    >
      {m.icon}
      {m.label}
    </span>
  );
}

export function StatusDot({ status, size = 8 }: { status: SourceStatus; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, backgroundColor: STATUS_META[status].dot }}
      aria-label={STATUS_META[status].label}
      role="img"
    />
  );
}

export const RUN_META: Record<SyncRunStatus, { label: string; fg: string; bg: string }> = {
  success: { label: 'Success', fg: '#047857', bg: '#ECFDF5' },
  partial: { label: 'Partial', fg: '#D97706', bg: '#FEF3C7' },
  failed: { label: 'Failed', fg: '#B91C1C', bg: '#FEE2E2' },
};

export function relTime(iso: string) {
  const mins = Math.max(0, (clockNow() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  const h = mins / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
export const fmtDateTime = (iso: string) => FMT.format(new Date(iso));
export const fmtNum = (n: number) => n.toLocaleString('en-US');

/** Two-letter monogram tile for a system. */
export function SystemMark({ name, size = 22 }: { name: string; size?: number }) {
  const letters = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md border border-[#E2E8F0] bg-[#F8FAFC] font-mono font-bold text-[#475569]"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.4)) }}
      aria-hidden
    >
      {letters}
    </span>
  );
}
