'use client';

import React from 'react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { caseService } from '@/services/caseService';
import { productService } from '@/services/productService';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import { CaseLink, ErrorState, ListSkeleton, StageBadge } from '@/components/ui';
import type { QueueContext } from '@/components/product/queueContext';
import { money } from '@/utils/format';

export interface SimilarAssetsProps {
  /** The case to compare against (it is left out of the list). */
  caseId: string;
  /** Data scope from useAuth().scope, so only units the user may see are compared. */
  scope: { tenant?: string; site?: string };
  /** Rows shown (default 8); the summary always covers every similar unit. */
  limit?: number;
  /** Optional heading; pass null to render without one (e.g. inside a titled section). */
  title?: React.ReactNode | null;
  /** Called instead of navigating when a case id is clicked (e.g. to swap a drawer to that asset). */
  onSelect?: (caseId: string) => void;
}

const th = 'px-1.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#64748B]';

/**
 * Compare similar assets: other units of the same product (or equipment class) in scope with
 * grade, residual life, est. value, recommended route and stage, plus a one-line summary
 * ("12 similar units · median value $X · most common route Y").
 */
export function SimilarAssets({ caseId, scope, limit = 8, title = 'Similar assets', onSelect }: SimilarAssetsProps) {
  const q = useServiceQuery(() => productService.similarAssets(caseId, scope, limit), [caseId, scope.tenant, scope.site, limit], {
    subscribe: caseService.subscribe,
  });
  const data = q.data?.target.id === caseId ? q.data : undefined;
  const queue: QueueContext | undefined = data ? { name: `Similar to ${caseId}`, href: `/product/case/${caseId}`, ids: data.items.map((c) => c.id) } : undefined;

  return (
    <section aria-label={typeof title === 'string' ? title : 'Similar assets'} className="min-w-0">
      {title !== null && <h3 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">{title}</h3>}
      {q.error && !data ? (
        <ErrorState onRetry={q.refetch} compact />
      ) : !data ? (
        <ListSkeleton rows={3} />
      ) : data.total === 0 ? (
        <p className="m-0 text-xs text-[#64748B]">No other {data.basisLabel.toLowerCase()} units in your scope to compare with.</p>
      ) : (
        <>
          <p className="m-0 mb-2 text-xs text-[#475569]">
            <span className="font-mono font-bold text-[#141416]">{data.total}</span> similar {data.total === 1 ? 'unit' : 'units'} ({data.basisLabel}) · median value{' '}
            <span className="font-mono font-bold text-[#141416]">{money(data.medianValue)}</span>
            {data.topRoute && (
              <>
                {' '}
                · most common route <strong className="text-[#141416]">{DISPOSITION_ROUTES[data.topRoute.route].name}</strong>
              </>
            )}
          </p>
          <table className="w-full table-fixed border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9]">
                <th scope="col" className={`${th} text-left`}>
                  Case · grade
                </th>
                <th scope="col" className={`${th} w-[18%] text-right`}>
                  Residual
                </th>
                <th scope="col" className={`${th} w-[20%] text-right`}>
                  Est. value
                </th>
                <th scope="col" className={`${th} w-[30%] text-left`}>
                  Route · stage
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="border-b border-[#F8FAFC] hover:bg-[#F8FAFC]">
                  <td className="min-w-0 px-1.5 py-2 align-top">
                    {onSelect ? (
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        className="cursor-pointer border-none bg-transparent p-0 font-mono text-xs font-medium text-[#141416] underline-offset-2 hover:underline"
                      >
                        {c.id}
                      </button>
                    ) : (
                      <CaseLink id={c.id} queue={queue} />
                    )}
                    <div className="truncate text-[11px] text-[#64748B]">
                      Grade {c.condition}
                      {data.basis === 'class' && ` · ${c.productName}`}
                    </div>
                  </td>
                  <td className="px-1.5 py-2 text-right align-top font-mono text-[#141416]">{c.residualLifeMonths} mo</td>
                  <td className="px-1.5 py-2 text-right align-top font-mono font-bold text-emerald-700">{money(c.estimatedNetRecovery)}</td>
                  <td className="min-w-0 px-1.5 py-2 align-top">
                    <div className="truncate font-semibold text-[#141416]">{DISPOSITION_ROUTES[c.recommendedRoute].shortLabel}</div>
                    <div className="truncate">
                      <StageBadge stage={c.stage} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.total > data.items.length && (
            <p className="m-0 mt-1.5 text-[11px] text-[#64748B]">
              Showing the <span className="font-mono">{data.items.length}</span> highest-value of <span className="font-mono">{data.total}</span>.
            </p>
          )}
        </>
      )}
    </section>
  );
}
