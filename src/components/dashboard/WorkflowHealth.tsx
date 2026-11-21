import React from 'react';
import { SegmentedBar, Sparkline } from '@/components/charts';

export interface WorkflowBreakdown {
  total: number;
  published: number;
  failing: number;
  draft: number;
  successRate: number;
  failingNames: string[];
}

/** Workflow health in the original look: success rate, status split and a run trend. */
export function WorkflowHealthBody({ wf, runRecords }: { wf: WorkflowBreakdown; runRecords: number[] }) {
  const healthy = wf.failing === 0 && wf.successRate >= 90;
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[34px] font-extrabold leading-none tracking-tight text-[#111827]">{wf.successRate}%</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${healthy ? 'bg-[#ECFDF5] text-[#10B981]' : 'bg-[#FEF3C7] text-[#D97706]'}`}>
            {healthy ? 'Healthy' : 'Needs attention'}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-[#64748B]">Average run success across active workflows</div>
        <div className="mt-4">
          <SegmentedBar
            ariaLabel={`${wf.published} published, ${wf.failing} failing, ${wf.draft} draft workflows`}
            height={8}
            segments={[
              { id: 'published', label: 'Published', value: wf.published, color: '#10B981' },
              { id: 'failing', label: 'Failing', value: wf.failing, color: '#EF4444' },
              { id: 'draft', label: 'Draft', value: wf.draft, color: '#9CA3AF' },
            ]}
          />
        </div>
      </div>
      {runRecords.length > 1 && (
        <div className="w-full shrink-0 sm:w-44">
          <Sparkline values={runRecords} color="#10B981" height={56} ariaLabel={`Records processed in the last ${runRecords.length} workflow runs`} />
          <div className="mt-1 text-right text-[10px] text-[#94A3B8]">Records per run, last {runRecords.length} runs</div>
        </div>
      )}
    </div>
  );
}
