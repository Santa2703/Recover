'use client';

import React from 'react';
import { CalendarRange, Info } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { intakeService, type PlanCell } from '@/services/intakeService';
import { ErrorState, TableSkeleton } from '@/components/ui';
import { Card, CardTitle } from '@/components/product/ui';

type Scope = { tenant?: string; site?: string };

const th = 'px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-[#64748B]';

function cellTip(c: PlanCell) {
  return `${c.asnUnits} from shipping notices + ${c.contractUnits} weighted from contracts, against ${c.capacity} capacity`;
}

/** Receiving plan: expected units by site × week (next 6 weeks) against receiving capacity. */
export function ReceivingPlan({ scope }: { scope: Scope }) {
  const q = useServiceQuery(() => intakeService.plan(scope), [scope.tenant, scope.site], { subscribe: intakeService.subscribePlan });
  const plan = q.data;

  return (
    <Card>
      <CardTitle
        title="Receiving plan"
        description="Draft. Nothing is booked: expected units per site and week from open shipping notices plus probability-weighted contract returns, against weekly receiving capacity."
      />
      <div className="pt-4">
        {q.error && !plan ? (
          <ErrorState onRetry={q.refetch} compact />
        ) : !plan ? (
          <TableSkeleton rows={3} />
        ) : (
          <>
            <p className="m-0 mb-3 flex items-start gap-1.5 text-[11px] text-[#64748B]">
              <CalendarRange size={13} className="mt-px shrink-0 text-amber-500" aria-hidden />
              <span>
                <span className="font-mono">{plan.asnCount}</span> shipping notices and <span className="font-mono">{plan.contractCount}</span> contract returns in the next 6 weeks ·{' '}
                {plan.overCells ? (
                  <strong className="text-[#B91C1C]">
                    <span className="font-mono">{plan.overCells}</span> site-weeks over capacity
                  </strong>
                ) : (
                  'every week within capacity'
                )}
              </span>
            </p>
            <table className="w-full table-fixed border-collapse text-xs">
              <caption className="sr-only">Expected units against receiving capacity, by site and week</caption>
              <thead>
                <tr className="border-b border-[#F1F5F9]">
                  <th scope="col" className={`${th} w-[26%] text-left md:w-[22%]`}>
                    Site
                  </th>
                  {plan.weeks.map((w, i) => (
                    <th key={w.start} scope="col" className={`${th} text-right ${i >= 3 ? 'hidden md:table-cell' : ''}`}>
                      <span className="hidden sm:inline">Wk of </span>
                      <span className="font-mono">{w.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.site} className="border-b border-[#F8FAFC] hover:bg-[#F8FAFC]">
                    <th scope="row" className="px-2 py-2.5 text-left font-normal">
                      <div className="truncate font-semibold text-[#141416]">{r.site}</div>
                      <div className="truncate text-[11px] text-[#64748B]">{r.capacityLabel.split(' · ')[0]}</div>
                    </th>
                    {r.cells.map((c, i) => (
                      <td
                        key={plan.weeks[i].start}
                        data-tip={cellTip(c)}
                        className={`px-2 py-2.5 text-right font-mono ${i >= 3 ? 'hidden md:table-cell' : ''} ${c.over ? 'bg-[#FEE2E2] font-bold text-[#B91C1C]' : c.units ? 'text-[#141416]' : 'text-[#94A3B8]'}`}
                        aria-label={`${r.site}, week of ${plan.weeks[i].label}: ${c.units} of ${c.capacity}${c.over ? ', over capacity' : ''}`}
                      >
                        {c.units}
                        <span className={c.over ? '' : 'text-[#94A3B8]'}> / {c.capacity}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 mt-3 flex items-start gap-1.5 text-[11px] text-[#64748B]">
              <Info size={12} className="mt-px shrink-0" aria-hidden />
              Cells read units expected / capacity per week. Red cells are over capacity. Overdue arrivals and contract windows already open count in the current week. Weeks 4–6 show from 768px.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
