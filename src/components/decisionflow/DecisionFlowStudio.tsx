'use client';

import React, { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { ScrollText, Tag } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { fmtDay } from '@/services/decisionService';
import { decisionFlowService, useDecisionFlow } from '@/services/decisionFlowService';
import type { AuditEntry, FlowState } from '@/services/decisionFlowService';
import { DecisionCanvas } from './DecisionCanvas';
import { GovernanceBar } from './GovernanceBar';
import { ImpactPanel } from './ImpactPanel';
import { AssistantPanel } from './AssistantPanel';

const time = (iso: string) => `${fmtDay(iso)} ${iso.slice(11, 16)}`;

interface HistoryRow {
  id: string;
  at: string;
  action: string;
  actor: string;
  detail: string;
  version?: number;
  live?: boolean;
}

/** Version history and audit log as one timeline, newest first. Published versions carry a version tag. */
function HistoryList({ flow }: { flow: FlowState }) {
  const [all, setAll] = useState(false);
  const merged: HistoryRow[] = [
    ...flow.versions.map((v, i) => ({
      id: `v-${v.version}-${v.publishedAt}`,
      at: v.publishedAt,
      action: `Published v${v.version}`,
      actor: v.publishedBy,
      detail: `${v.rules} rule${v.rules === 1 ? '' : 's'} · ${v.note}`,
      version: v.version,
      live: i === 0,
    })),
    // A publish is already a version row; drop its duplicate audit entry.
    ...flow.audit
      .filter((a: AuditEntry) => !(a.action === 'Published' && flow.versions.some((v) => Math.abs(Date.parse(v.publishedAt) - Date.parse(a.at)) < 120_000)))
      .map((a: AuditEntry) => ({ ...a })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const rows = all ? merged : merged.slice(0, 8);
  return (
    <section className="bg-white border border-[#E2E8F0] rounded-2xl shadow-2xs p-5 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <ScrollText size={15} className="text-[#64748B]" />
        <h3 className="text-sm font-extrabold text-[#141416]">History</h3>
        <span className="text-[11px] text-[#94A3B8]">
          {flow.versions.length} versions · {flow.audit.length} changes
        </span>
      </div>
      <ol className="divide-y divide-[#F1F5F9]">
        {rows.map((a) => (
          <li key={a.id} className="py-2 grid grid-cols-[auto_1fr] gap-x-3 text-xs min-w-0">
            <span className="font-mono text-[11px] text-[#94A3B8] pt-px whitespace-nowrap">{time(a.at)}</span>
            <div className="min-w-0">
              {a.version != null && <Tag size={12} className="inline -mt-0.5 mr-1 text-[#64748B]" aria-hidden />}
              <span className="font-bold text-[#141416]">{a.action}</span>
              {a.live && <span className="ml-1.5 px-1.5 rounded-full bg-[#ECFDF5] text-[#047857] text-[10px] font-bold">Live</span>}
              <span className="text-[#64748B]"> · {a.actor}</span>
              <div className="text-[#475569] break-words">{a.detail}</div>
            </div>
          </li>
        ))}
      </ol>
      {merged.length > 8 && (
        <button onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-semibold text-[#141416] underline underline-offset-2 cursor-pointer">
          {all ? 'Show fewer' : `Show all ${merged.length}`}
        </button>
      )}
    </section>
  );
}

function StudioSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-24 w-full rounded-2xl" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Skeleton className="h-[640px] lg:col-span-8 rounded-2xl" />
        <Skeleton className="h-[420px] lg:col-span-4 rounded-2xl" />
      </div>
    </div>
  );
}

/** Workflow Studio, "Decision flow" mode (docs/recover-reference.md section 3). */
export function DecisionFlowStudio() {
  const loaded = useServiceQuery(() => decisionFlowService.load(), []);
  const flow = useDecisionFlow();
  if (loaded.initialLoading) return <StudioSkeleton />;

  return (
    <ReactFlowProvider>
      <div className="space-y-4">
        <GovernanceBar flow={flow} />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-8 min-w-0">
            <DecisionCanvas flow={flow} />
          </div>
          <div className="lg:col-span-4 min-w-0">
            <AssistantPanel flow={flow} />
          </div>
        </div>
        <ImpactPanel flow={flow} />
        <HistoryList flow={flow} />
      </div>
    </ReactFlowProvider>
  );
}
