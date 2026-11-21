'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, ListOrdered } from 'lucide-react';
import type { DecisionScope, DecisionSummary } from '@/models/decision.model';
import { openDecisions, planQueue, usd } from '@/services/decisionService';
import { CaseLink, ListSkeleton, ProgressBar, formatKpiValue } from '@/components/ui';
import { SectionCard } from '@/components/dashboard/SectionCard';

const money = (n: number) => formatKpiValue(n, 'usd');
const signed = (n: number) => `${n < 0 ? '' : '+'}${money(n)}`;

/** Queue plan vs first come, first served, and the demand records several returns compete for. */
export function QueuePlanPanel({ data, scope, className = '' }: { data?: DecisionSummary; scope: DecisionScope; className?: string }) {
  // Contested demand in scope, biggest plan gain first (pure, derived during render; `data` refetches on store changes).
  const ids = data ? new Set(openDecisions(scope).map((r) => r.case.id)) : null;
  const contested = ids
    ? planQueue()
        .contested.filter((x) => x.wantedBy.some((id) => ids.has(id)))
        .sort((a, b) => b.gain - a.gain)
        .slice(0, 4)
    : [];
  return (
    <SectionCard className={className} title="Queue plan" icon={<ListOrdered />}>
      {!data ? (
        <ListSkeleton rows={3} />
      ) : (
        <div className="flex h-full flex-col gap-4">
          <div>
            <div className="text-sm font-extrabold text-[#141416]">
              Queue plan adds <span className="font-mono text-[#047857]">{data.planGain > 0 ? '+' : ''}{usd(data.planGain)}</span> vs first come, first served
            </div>
            <p className="m-0 mt-1 text-xs text-[#64748B]">
              {data.contested} {data.contested === 1 ? 'order is' : 'orders are'} wanted by more than one return. The plan gives each to the return that loses most without it, instead of the
              oldest return.
            </p>
          </div>
          <div className="space-y-2">
            {[
              { label: 'Queue plan', value: data.queueValue },
              { label: 'First come, first served', value: data.fcfsValue },
            ].map((r) => (
              <div key={r.label} className="text-xs">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-[#475569]">{r.label}</span>
                  <span className="font-mono font-bold text-[#141416]">{usd(r.value)}</span>
                </div>
                <ProgressBar value={Math.max(0, r.value)} max={Math.max(1, data.queueValue, data.fcfsValue)} label={`${r.label}: ${money(r.value)} net on open decisions`} />
              </div>
            ))}
          </div>
          {!!contested.length && (
            <ul className="m-0 list-none divide-y divide-[#F1F5F9] border-t border-[#F1F5F9] p-0">
              {contested.map((x) => (
                <li key={x.demandId} className="flex items-start justify-between gap-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-[#141416]">{x.demandId}</div>
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-[11px] text-[#64748B]">
                      <span>Wanted by {x.wantedBy.length} returns · goes to</span>
                      {x.assignedTo ? <CaseLink id={x.assignedTo} /> : <span>none</span>}
                    </div>
                  </div>
                  {x.gain > 0 && <span className="shrink-0 font-mono font-bold text-[#047857]" title="More than giving it to the next return that wants it">{signed(x.gain)}</span>}
                </li>
              ))}
            </ul>
          )}
          <Link href="/analytics/whatif" className="mt-auto inline-flex items-center gap-1 self-start text-xs font-semibold text-[#64748B] no-underline hover:text-[#141416]">
            Try other assumptions in What-if <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      )}
    </SectionCard>
  );
}
