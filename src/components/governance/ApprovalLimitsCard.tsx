'use client';

import React, { useState } from 'react';
import { InputNumber, Switch, message } from 'antd';
import { Gauge } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { governanceService, fmtUsd, type Actor, type ApprovalLimits } from '@/services/governanceService';
import { ListSkeleton } from '@/components/ui';
import { Card } from './Filters';
import { CardHeader, RoleGate } from './shared';

const GATE = 'Admins and Approvers only';
type NumKey = 'plannerLimit' | 'maxActionsPerAgentRun' | 'maxItemsPerBulkPlan';

/**
 * Approval limits beside the value thresholds: the Planner's approval limit, self-approval,
 * and caps on agent runs and bulk plans. Same save model as the thresholds: each change saves
 * on blur / toggle and is written to the change log and the audit log.
 */
export function ApprovalLimitsCard({ canManage, actor }: { canManage: boolean; actor: Actor }) {
  const q = useServiceQuery(() => governanceService.getApprovalLimits(), [], { subscribe: governanceService.subscribeThresholds });
  const [busy, setBusy] = useState(false);
  const d = q.data;

  const save = async (patch: Partial<ApprovalLimits>, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      await governanceService.updateApprovalLimits(patch, actor);
      message.success(done);
      return true;
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not save');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={<Gauge />} title="Approval limits" description="A decision above the approver's limit escalates. These limits also cap what one agent run or one bulk plan may do." />
      <div className="pt-4">
        {q.initialLoading || !d ? (
          <ListSkeleton rows={2} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <NumField
                key={`planner-${d.plannerLimit}`}
                label="Planner approval limit"
                value={d.plannerLimit}
                money
                step={500}
                disabled={!canManage || busy}
                help={
                  d.plannerLimit === 0
                    ? `$0 means Planners cannot approve; they send decisions to an Approver. Raise it to let them approve up to that value (at most the Approver limit, ${fmtUsd(d.approverLimit)}).`
                    : `Planners may approve decisions up to ${fmtUsd(d.plannerLimit)}; above it, an Approver (up to ${fmtUsd(d.approverLimit)}). Set $0 to stop Planners approving.`
                }
                onSave={(v) => save({ plannerLimit: v }, `Planner approval limit set to ${fmtUsd(v)}`)}
              />
              <NumField
                key={`run-${d.maxActionsPerAgentRun}`}
                label="Max actions per agent run"
                value={d.maxActionsPerAgentRun}
                min={1}
                step={5}
                disabled={!canManage || busy}
                help="An agent run stops and asks a person once it reaches this many actions."
                onSave={(v) => save({ maxActionsPerAgentRun: v }, `Max actions per agent run set to ${v}`)}
              />
              <NumField
                key={`bulk-${d.maxItemsPerBulkPlan}`}
                label="Max items per bulk plan"
                value={d.maxItemsPerBulkPlan}
                min={1}
                step={10}
                disabled={!canManage || busy}
                help="A bulk plan (approve, request evidence, hand off) covers at most this many cases."
                onSave={(v) => save({ maxItemsPerBulkPlan: v }, `Max items per bulk plan set to ${v}`)}
              />
            </div>
            <div className="flex items-start gap-3 pt-3 border-t border-[#F1F5F9]">
              <RoleGate allowed={canManage} reason={GATE}>
                <Switch
                  checked={d.allowSelfApproval}
                  disabled={!canManage}
                  loading={busy}
                  onChange={(v) => save({ allowSelfApproval: v }, v ? 'People may now approve decisions they submitted, within their limit' : 'Self-approval turned off')}
                  aria-label="Allow a person to approve a decision they submitted, within their limit"
                />
              </RoleGate>
              <div className="min-w-0">
                <div className="text-xs font-extrabold text-[#141416]">Allow a person to approve a decision they submitted, within their limit</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">
                  {d.allowSelfApproval ? 'On: the submitter may approve their own decision when it is within their approval limit.' : 'Off: a decision always needs a second person to approve it.'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function NumField({
  label,
  value,
  help,
  disabled,
  money,
  min = 0,
  step,
  onSave,
}: {
  label: string;
  value: number;
  help: string;
  disabled: boolean;
  money?: boolean;
  min?: number;
  step: number;
  onSave: (v: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<number>(value);
  const commit = async () => {
    if (draft === value) return;
    if (!(await onSave(draft))) setDraft(value);
  };
  return (
    <div className="min-w-0">
      <span className="block text-[11px] font-bold text-[#64748B] mb-1">{label}</span>
      <InputNumber
        value={draft}
        min={min}
        step={step}
        disabled={disabled}
        onChange={(v) => setDraft(typeof v === 'number' ? v : min)}
        onBlur={commit}
        onPressEnter={commit}
        formatter={money ? (v) => `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : undefined}
        parser={money ? (v) => Number((v ?? '').replace(/[^\d]/g, '')) : undefined}
        className="w-full"
        aria-label={label}
      />
      <div className="text-[11px] text-[#64748B] mt-1">{help}</div>
    </div>
  );
}
