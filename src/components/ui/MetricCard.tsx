import React from 'react';
import Link from 'next/link';
import { Skeleton } from './Skeleton';

type IconTone = 'amber' | 'green' | 'red' | 'blue' | 'slate';

const ICON_TILE: Record<IconTone, string> = {
  amber: 'bg-[#FFFBEB] border-[#FEF3C7] text-amber-500',
  green: 'bg-[#ECFDF5] border-[#D1FAE5] text-[#047857]',
  red: 'bg-[#FEF2F2] border-[#FEE2E2] text-[#DC2626]',
  blue: 'bg-[#F0F9FF] border-[#E0F2FE] text-[#0284C7]',
  slate: 'bg-[#F8FAFC] border-[#E2E8F0] text-[#475569]',
};

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  /** Unit or period after the value, e.g. "assets", "days". */
  unit?: string;
  /** Trend or comparison line (use <TrendIndicator/>). */
  trend?: React.ReactNode;
  /** One line of context under the value. */
  context?: React.ReactNode;
  icon?: React.ReactNode;
  iconTone?: IconTone;
  /** Optional small visual, e.g. a <Sparkline/>. */
  visual?: React.ReactNode;
  href?: string;
  loading?: boolean;
}

/** KPI card in the local style: icon tile, label, bold mono value, trend/context line. */
export function MetricCard({ label, value, unit, trend, context, icon, iconTone = 'amber', visual, href, loading }: MetricCardProps) {
  const body = (
    <div className={`h-full rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-2xs transition-colors ${href ? 'hover:border-gray-400' : ''}`}>
      <div className="flex items-start gap-3">
        {icon && (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border [&>svg]:h-5 [&>svg]:w-5 ${ICON_TILE[iconTone]}`}>{icon}</div>
        )}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold text-[#64748B]">{label}</span>
          {loading ? (
            <>
              <Skeleton className="mt-1.5 h-6 w-20" />
              <Skeleton className="mt-2 h-3 w-32" />
            </>
          ) : (
            <>
              <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
                <span className="min-w-0 truncate font-mono text-2xl font-black leading-tight text-[#141416]">{value}</span>
                {unit && <span className="text-[11px] font-medium text-[#64748B]">{unit}</span>}
              </div>
              {trend && <div className="mt-1">{trend}</div>}
              {context && <div className="mt-1 text-[11px] font-medium text-[#64748B]">{context}</div>}
            </>
          )}
        </div>
      </div>
      {visual && !loading && <div className="mt-2">{visual}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full text-inherit no-underline">
      {body}
    </Link>
  ) : (
    body
  );
}

export const KPI = MetricCard;
