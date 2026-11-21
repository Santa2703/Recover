'use client';

import React, { useMemo } from 'react';
import { ArrowRight, FlaskConical } from 'lucide-react';
import { CaseLink, DataTable, Skeleton } from '@/components/ui';
import type { DataColumn } from '@/components/ui';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import type { RouteId } from '@/models/decision.model';
import { decisionService, usd } from '@/services/decisionService';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { draftRules, publishedVersion, loadImpact, usdSigned } from '@/services/decisionFlowService';
import type { FlowState, ImpactRow } from '@/services/decisionFlowService';

function RouteChip({ route }: { route: RouteId }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="w-2 h-2 rounded-full shrink-0 border border-black/10" style={{ backgroundColor: DISPOSITION_ROUTES[route].color }} />
      <span className="truncate">{DISPOSITION_ROUTES[route].shortLabel}</span>
    </span>
  );
}

const deltaClass = (n: number) => (Math.round(n) > 0 ? 'text-[#047857]' : Math.round(n) < 0 ? 'text-[#B91C1C]' : 'text-[#64748B]');

const columns: DataColumn<ImpactRow>[] = [
  { title: 'Case', key: 'case', priority: 1, ellipsis: true, render: (_, r) => <CaseLink id={r.caseId} label={r.label} /> },
  {
    title: 'Published → draft route',
    key: 'route',
    priority: 1,
    render: (_, r) => (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
        <RouteChip route={r.from} />
        <ArrowRight size={12} className="text-[#94A3B8]" aria-label="to" />
        <RouteChip route={r.to} />
      </span>
    ),
  },
  { title: 'Published net', key: 'pub', priority: 3, align: 'right', render: (_, r) => <span className="font-mono text-xs">{usd(r.netPublished)}</span> },
  { title: 'Draft net', key: 'draft', priority: 3, align: 'right', render: (_, r) => <span className="font-mono text-xs">{usd(r.netDraft)}</span> },
  { title: 'Net change', key: 'delta', priority: 1, align: 'right', render: (_, r) => <span className={`font-mono text-xs font-bold ${deltaClass(r.netDelta)}`}>{usdSigned(r.netDelta)}</span> },
];

/** Draft rules vs published rules on the open queue. */
export function ImpactPanel({ flow }: { flow: FlowState }) {
  const { rules, blocked } = useMemo(() => draftRules(flow), [flow]);
  const key = JSON.stringify([rules, blocked, publishedVersion()]);
  const q = useServiceQuery(() => loadImpact(rules, blocked), [key], { subscribe: decisionService.subscribe });
  const imp = q.data;

  // Nothing changes: one line instead of an empty table.
  if (imp && imp.changes.length === 0) {
    return (
      <section className="bg-white border border-[#E2E8F0] rounded-2xl shadow-2xs px-5 py-3 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-label="Simulated impact">
        <FlaskConical size={15} className="text-amber-500 shrink-0" />
        <span className="font-bold text-[#141416]">No open cases change route</span>
        <span className="text-[#64748B]">
          Draft vs published rules (v{publishedVersion()}) on all {imp.openCases} open cases.
        </span>
      </section>
    );
  }

  return (
    <section className="bg-white border border-[#E2E8F0] rounded-2xl shadow-2xs p-5 space-y-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-8 h-8 rounded-xl bg-[#FFFBEB] border border-[#FEF3C7] flex items-center justify-center shrink-0">
            <FlaskConical size={16} className="text-amber-500" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-[#141416]">Simulated impact</h3>
            <p className="text-xs text-[#64748B]">Draft rules vs published rules (v{publishedVersion()}) on every open case, planned as a whole queue.</p>
          </div>
        </div>
        {imp ? (
          <div className="flex gap-6">
            <div>
              <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Decisions that change</div>
              <div className="text-2xl font-black font-mono text-[#141416]">
                {imp.changes.length}
                <span className="text-xs font-semibold text-[#94A3B8]"> / {imp.openCases}</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Net value difference</div>
              <div className={`text-2xl font-black font-mono ${deltaClass(imp.netDelta)}`}>{usdSigned(imp.netDelta)}</div>
            </div>
          </div>
        ) : (
          <div className="flex gap-6">
            <Skeleton className="h-12 w-28" />
            <Skeleton className="h-12 w-28" />
          </div>
        )}
      </div>
      <DataTable<ImpactRow>
        rowKey="caseId"
        columns={columns}
        dataSource={imp?.changes ?? []}
        initialLoading={q.initialLoading}
        refreshing={q.loading && !q.initialLoading}
        pagination={(imp?.changes.length ?? 0) > 8 ? { pageSize: 8, size: 'small' } : false}
        emptyTitle="No decisions change"
        emptyDescription="The draft routes every open case the same way as the published rules."
        size="small"
      />
    </section>
  );
}
