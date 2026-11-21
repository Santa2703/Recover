import React from 'react';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react';
import { SOURCE_SHORT } from '@/services/integrationService';

export type PillTone = 'high' | 'medium' | 'low' | 'info' | 'neutral' | 'brand';

const TONE: Record<PillTone, { cls: string; dot: string }> = {
  high: { cls: 'bg-[#FEE2E2] text-[#B91C1C]', dot: 'bg-[#DC2626]' },
  medium: { cls: 'bg-[#FEF3C7] text-[#D97706]', dot: 'bg-[#D97706]' },
  low: { cls: 'bg-[#ECFDF5] text-[#047857]', dot: 'bg-[#059669]' },
  info: { cls: 'bg-[#E0F2FE] text-[#0284C7]', dot: 'bg-[#0284C7]' },
  neutral: { cls: 'bg-[#F1F5F9] text-[#475569]', dot: 'bg-[#94A3B8]' },
  brand: { cls: 'bg-[#FEF08A] text-[#854D0E]', dot: 'bg-[#854D0E]' },
};

/** Status pill with a dot, as on the Exceptions severity column. */
export function Pill({ tone, children, dot = true }: { tone: PillTone; children: React.ReactNode; dot?: boolean }) {
  const t = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${t.cls}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />}
      {children}
    </span>
  );
}

/** Source system name with its connector type tag (ERP, WMS…). */
export function SourceChip({ system, compact }: { system: string; compact?: boolean }) {
  const short = SOURCE_SHORT[system] ?? 'SRC';
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-1.5 py-px font-mono text-[9px] font-bold text-[#475569]">{short}</span>
      {!compact && <span className="truncate font-semibold text-[#141416]">{system}</span>}
    </span>
  );
}

export function DirectionTag({ direction }: { direction: 'in' | 'out' }) {
  return direction === 'in' ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0284C7]">
      <ArrowDownLeft size={13} /> In
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED]">
      <ArrowUpRight size={13} /> Out
    </span>
  );
}

/** "Connection Fabric › Page" breadcrumb, as on Source tables. */
export function FabricCrumb({ page }: { page: string }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#64748B]">
      <Link href="/integration/map" className="text-[#64748B] hover:text-black">
        Connection Fabric
      </Link>
      <ChevronRight size={13} className="text-[#94A3B8]" />
      <span className="font-semibold text-[#141416]">{page}</span>
    </div>
  );
}
