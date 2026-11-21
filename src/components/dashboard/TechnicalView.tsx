'use client';

import React from 'react';
import Link from 'next/link';
import { Activity, Zap } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { dashboardService } from '@/services/dashboardService';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '@/components/ui';
import { AgentActivityList } from './AgentActivity';
import { CardLink, SectionCard } from './SectionCard';

const HEALTH = '/integration/map?tab=health';

/**
 * Developer view: one integration summary line (the detail lives on Integration health)
 * and the latest agent runs.
 */
export function TechnicalView() {
  const q = useServiceQuery(() => dashboardService.technical(), [], { subscribe: dashboardService.subscribeTechnical });
  const d = q.data;
  if (q.error && !d) return <ErrorState onRetry={q.refetch} />;

  const problems = d ? d.sources.failed + d.sources.warning + d.workflows.failing + d.calls.held : 0;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 rounded-2xl border border-[#E2E8F0] bg-white px-5 py-3.5 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${problems ? 'border-[#FEF3C7] bg-[#FFFBEB] text-amber-500' : 'border-[#D1FAE5] bg-[#ECFDF5] text-[#059669]'}`}>
            <Activity size={16} aria-hidden />
          </span>
          {q.initialLoading || !d ? (
            <Skeleton className="h-4 w-80 max-w-full" />
          ) : (
            <p className="m-0 min-w-0 text-xs text-[#141416]">
              <span className="font-extrabold">Integrations {d.sources.healthPct}% healthy</span>
              <span className="text-[#64748B]">
                {' '}
                · {d.sources.failed} failed and {d.sources.warning} warning {d.sources.failed + d.sources.warning === 1 ? 'source' : 'sources'} · {d.workflows.failing} failing{' '}
                {d.workflows.failing === 1 ? 'workflow' : 'workflows'} · {d.calls.held} MCP {d.calls.held === 1 ? 'call' : 'calls'} held for approval
              </span>
            </p>
          )}
        </div>
        <CardLink href={HEALTH}>Open Integration health</CardLink>
      </section>

      <SectionCard title="Recent agent runs" icon={<Zap />} actions={<CardLink href={HEALTH}>View all</CardLink>}>
        {q.initialLoading || !d ? (
          <ListSkeleton rows={3} />
        ) : d.recentCalls.length ? (
          <Link href={HEALTH} className="block text-inherit no-underline">
            <AgentActivityList calls={d.recentCalls} />
          </Link>
        ) : (
          <EmptyState compact title="No agent runs yet" />
        )}
      </SectionCard>
    </div>
  );
}
