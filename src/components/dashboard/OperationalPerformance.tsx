'use client';

import React, { useState } from 'react';
import { Select } from 'antd';
import { TrendingUp } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { dashboardService } from '@/services/dashboardService';
import { metricsService } from '@/services/metricsService';
import { SegmentedBar, Sparkline } from '@/components/charts';
import { ErrorState, ListSkeleton } from '@/components/ui';
import { CardLink, SectionCard } from './SectionCard';

const PERIODS = [
  { value: 3, label: 'Last 3 months' },
  { value: 6, label: 'Last 6 months' },
  { value: 12, label: 'Last 12 months' },
];

function yieldStatus(pct: number) {
  if (pct >= 95) return { label: 'On track', cls: 'bg-[#ECFDF5] text-[#047857]' };
  if (pct >= 85) return { label: 'Watch', cls: 'bg-[#FEF3C7] text-[#D97706]' };
  return { label: 'Below target', cls: 'bg-[#FEE2E2] text-[#B91C1C]' };
}

/** Business performance: recovery yield (actual / predicted) and the case pipeline split. Links to Key Figures. */
export function OperationalPerformance() {
  const { scope } = useAuth();
  const [months, setMonths] = useState(3);
  const q = useServiceQuery(() => dashboardService.performance(months, scope), [months, scope.tenant, scope.site], { subscribe: metricsService.subscribe });
  const d = q.data;
  const status = d ? yieldStatus(d.yieldPct) : null;

  return (
    <SectionCard
      title="Operational Performance"
      icon={<TrendingUp />}
      actions={
        <Select
          size="small"
          value={months}
          onChange={setMonths}
          options={PERIODS}
          aria-label="Period"
          popupMatchSelectWidth={false}
          style={{ width: 140 }}
        />
      }
    >
      {q.error && !d ? (
        <ErrorState compact onRetry={q.refetch} />
      ) : q.initialLoading || !d || !status ? (
        <ListSkeleton rows={3} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#64748B]">Recovery yield</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[34px] font-extrabold leading-none tracking-tight text-[#141416]">{d.yieldPct}%</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${status.cls}`}>{status.label}</span>
              </div>
              <div className="mt-1 text-[11px] text-[#94A3B8]">Actual ÷ predicted recovery</div>
            </div>
            <div className="w-full min-w-0 sm:w-40">
              <Sparkline values={d.monthlyYield} color="#059669" height={48} ariaLabel={`Monthly recovery yield, ${d.months[0]} to ${d.months[d.months.length - 1]}: ${d.monthlyYield.join('%, ')}%`} />
              <div className="mt-0.5 text-right text-[10px] text-[#94A3B8]">
                Monthly yield, {d.months[0]}–{d.months[d.months.length - 1]}
              </div>
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-[#64748B]">Case pipeline</div>
            <SegmentedBar
              unit="cases"
              height={10}
              ariaLabel={`${d.pipeline.awaiting} awaiting approval, ${d.pipeline.handedOff} handed off, ${d.pipeline.evidence} needing evidence`}
              segments={[
                { id: 'awaiting', label: 'Awaiting approval', value: d.pipeline.awaiting, color: '#FFD600' },
                { id: 'handed', label: 'Handed off', value: d.pipeline.handedOff, color: '#141416' },
                { id: 'evidence', label: 'Needs evidence', value: d.pipeline.evidence, color: '#F59E0B' },
              ]}
            />
          </div>
          <div className="border-t border-[#F1F5F9] pt-3 text-right">
            <CardLink href="/command">View Key Figures</CardLink>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
