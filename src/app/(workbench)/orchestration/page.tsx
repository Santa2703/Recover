'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Steps } from 'antd';
import { Bot, Cog, UserCheck, Workflow, ListTree, ShieldCheck, ChevronRight } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { governanceService, type AgentKind } from '@/services/governanceService';
import { caseService } from '@/services/caseService';
import { PageHeader, PageActions, ListSkeleton, ErrorState } from '@/components/ui';
import { CaseSelect, CardHeader, SystemChip, Pill, RUN_STATUS, useInitialCaseParam, useUrlParam } from '@/components/governance/shared';
import { RunTraceDrawer } from '@/components/governance/RunTraceDrawer';
import { Card } from '@/components/governance/Filters';

const KIND_ICON: Record<AgentKind, React.ReactNode> = {
  agent: <Bot className="w-3.5 h-3.5 text-amber-500" />,
  service: <Cog className="w-3.5 h-3.5 text-[#64748B]" />,
  control: <UserCheck className="w-3.5 h-3.5 text-[#141416]" />,
};
const KIND_LABEL: Record<AgentKind, string> = { agent: 'Agent', service: 'Service', control: 'Human control' };

export default function ProcessFlowPage() {
  const [caseId, setCaseId] = useInitialCaseParam('RT-1048');
  // ?trace=1 opens the run trace drawer (old /orchestration/runs links redirect here).
  const [traceParam, setTraceParam] = useUrlParam('trace');
  const traceOpen = traceParam === '1';
  const stagesQ = useServiceQuery(() => governanceService.listStages(), [], { subscribe: governanceService.subscribeThresholds });
  const runQ = useServiceQuery(() => governanceService.getRun(caseId), [caseId], { subscribe: caseService.subscribe });

  const run = runQ.data;
  const stages = stagesQ.data ?? [];
  const current = run?.currentIndex ?? 0;
  const status = run?.currentStatus;
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (step: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });

  const items = stages.map((s, i) => ({
    title: (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-xs font-extrabold text-[#141416]">
          {s.step}. {s.label}
        </span>
        <span className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wider">{s.phase}</span>
        {s.human && <Pill tone="dark">Human approval</Pill>}
        {run?.stages[i] && <Pill tone={RUN_STATUS[run.stages[i].finalStatus].tone}>{RUN_STATUS[run.stages[i].finalStatus].label}</Pill>}
        {run && i === current && <span className="text-[10px] font-semibold text-[#64748B]">{caseId} is here</span>}
      </span>
    ),
    content: (
      <div className="pb-3 pt-1 space-y-1.5 text-xs text-[#64748B]">
        <p className="leading-relaxed m-0">{s.description}</p>
        <button
          type="button"
          onClick={() => toggle(s.step)}
          aria-expanded={open.has(s.step)}
          aria-controls={`step-detail-${s.step}`}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#64748B] hover:text-[#141416] cursor-pointer bg-transparent border-0 p-0"
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open.has(s.step) ? 'rotate-90' : ''}`} />
          {open.has(s.step) ? 'Hide details' : 'Agent, systems, owner and control point'}
        </button>
        {open.has(s.step) && (
        <div id={`step-detail-${s.step}`} className="space-y-1.5 pl-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5">
            {KIND_ICON[s.performerKind]}
            <span className="text-[11px] text-[#94A3B8]">{KIND_LABEL[s.performerKind]}:</span>
            <Link href="/mcp/agents" className="font-semibold text-[#141416] hover:underline">
              {s.performerName}
            </Link>
          </span>
          <span className="inline-flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-[#94A3B8] mr-0.5">Reads:</span>
            {s.systems.map((sys) => (
              <SystemChip key={sys} name={sys} />
            ))}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-[#94A3B8]" />
            <span className="text-[11px] text-[#94A3B8]">Owner:</span>
            <span className="font-semibold text-[#475569]">{s.owner}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#94A3B8]" />
            <span className="text-[11px] text-[#94A3B8]">Control point:</span>
            <span className={`font-semibold ${s.human ? 'text-[#141416]' : 'text-[#475569]'}`}>{s.control}</span>
            {s.human && (
              <Link href="/access/delegations" className="text-[11px] font-semibold text-[#64748B] underline hover:text-[#141416]">
                Thresholds
              </Link>
            )}
          </span>
        </div>
        </div>
        )}
      </div>
    ),
  }));

  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Process flow"
        description="The 10 steps from evidence to reconciled value, with each step's run status for the selected case. Open the run trace to replay what the agents, tools and models did."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2 max-w-full">
            <CaseSelect value={caseId} onChange={setCaseId} width={260} />
            <PageActions primary={{ key: 'trace', label: 'View run trace', icon: <ListTree />, onClick: () => setTraceParam('1') }} />
          </div>
        }
      />

      <Card>
        <CardHeader icon={<Workflow />} title="Journey steps" description="Status of each step for the selected case. Expand a step for who performs it, the systems it reads, its owner and control point." />
        <div className="pt-4">
          {stagesQ.initialLoading ? (
            <ListSkeleton rows={8} />
          ) : stagesQ.error ? (
            <ErrorState onRetry={stagesQ.refetch} />
          ) : (
            <Steps
              orientation="vertical"
              size="small"
              current={current}
              status={status === 'failed' ? 'error' : status === 'waiting' ? 'wait' : 'process'}
              items={items}
            />
          )}
        </div>
      </Card>

      <RunTraceDrawer
        open={traceOpen}
        onClose={() => setTraceParam(null)}
        run={run}
        caseId={caseId}
        initialLoading={runQ.initialLoading}
        refreshing={runQ.loading}
        error={runQ.error}
        onRetry={runQ.refetch}
      />
    </div>
  );
}
