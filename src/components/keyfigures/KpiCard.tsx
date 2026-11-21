import React from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui';

export type KpiTone = 'amber' | 'green' | 'red' | 'blue' | 'pink' | 'slate';

const TILE: Record<KpiTone, string> = {
  amber: 'bg-[#FFFBEB] border-[#FEF3C7] text-[#D97706]',
  green: 'bg-[#ECFDF5] border-[#D1FAE5] text-[#047857]',
  red: 'bg-[#FEF2F2] border-[#FEE2E2] text-[#DC2626]',
  blue: 'bg-[#EFF6FF] border-[#DBEAFE] text-[#3B82F6]',
  pink: 'bg-[#FDF2F8] border-[#FCE7F3] text-[#EC4899]',
  slate: 'bg-[#F8FAFC] border-[#E2E8F0] text-[#475569]',
};

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone?: KpiTone;
  /** Change line (TrendIndicator) or short context. */
  change?: React.ReactNode;
  /** Period / context in muted text. */
  period?: React.ReactNode;
  href?: string;
  loading?: boolean;
  /** Uppercase compact label (Dashboard work cards). */
  caps?: boolean;
  /** Control shown next to the label (e.g. <HowCalculated />); stays clickable above the card link. */
  info?: React.ReactNode;
}

/** KPI card: one coloured icon tile, label, mono value, change and period. p-5. */
export function KpiCard({ label, value, icon, tone = 'amber', change, period, href, loading, caps, info }: KpiCardProps) {
  return (
    <div className={`relative h-full min-w-0 rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-2xs transition-colors ${href ? 'hover:border-gray-400' : ''}`}>
      <div className="flex items-start gap-3.5">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border [&>svg]:h-5 [&>svg]:w-5 ${TILE[tone]}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-1">
            <div className={caps ? 'truncate text-[10px] font-bold uppercase tracking-[1.1px] text-[#6B7280]' : 'truncate text-xs font-semibold text-[#64748B]'}>{label}</div>
            {info && <div className="-my-1 -mr-1 shrink-0">{info}</div>}
          </div>
          {loading ? (
            <>
              <Skeleton className="mt-2 h-6 w-20" />
              <Skeleton className="mt-2 h-3 w-32" />
            </>
          ) : (
            <>
              <div className="mt-1 font-mono text-2xl font-black leading-tight tracking-tight text-[#141416]">{value}</div>
              {change && <div className="mt-1">{change}</div>}
              {period && <div className="mt-0.5 truncate text-[11px] font-medium text-[#94A3B8]">{period}</div>}
            </>
          )}
        </div>
      </div>
      {/* Stretched link: the whole card navigates, while `info` stays a separate control above it. */}
      {href && <Link href={href} aria-label={label} className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-[#FFD600]" />}
    </div>
  );
}
