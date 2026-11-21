'use client';

import React from 'react';
import { Switch, message } from 'antd';
import { Sliders } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { settingsService } from '@/services/settingsService';
import { USER_ROLES } from '@/constants/roles.constants';
import { useAuth } from '@/store/authContext';
import { ListSkeleton, ErrorState } from '@/components/ui';
import { Card } from './Filters';
import { CardHeader, RoleGate } from './shared';
import { SaveOnBlur, SettingRow } from './SettingsFields';

/** Approvals can only escalate to roles that exist and can approve. */
const ESCALATION_ROLES = (['Approver', 'Executive', 'Admin'] as const).filter((r) => r in USER_ROLES);

/**
 * Workflow rules (moved here from Settings): sign-off and escalation rules that sit next to the
 * approval thresholds. Admins change them; everyone else sees them read-only.
 */
export function WorkflowRulesCard() {
  const { isAdmin } = useAuth();
  const q = useServiceQuery(() => settingsService.get(), [], { subscribe: settingsService.subscribe });
  const w = q.data?.workflow;
  const saved = (t: string) => message.success(t);

  return (
    <Card>
      <CardHeader icon={<Sliders />} title="Workflow rules" description={isAdmin ? 'Sign-off and escalation rules for plan approval.' : 'Sign-off and escalation rules for plan approval. Only Admins can change these.'} />
      {q.initialLoading ? (
        <div className="pt-4">
          <ListSkeleton rows={3} />
        </div>
      ) : q.error || !w ? (
        <div className="pt-4">
          <ErrorState onRetry={q.refetch} compact />
        </div>
      ) : (
        // A disabled fieldset makes every native input and select read-only for non-Admins.
        <fieldset disabled={!isAdmin} className="m-0 p-0 border-0 min-w-0">
          <div className="space-y-4 text-xs divide-y divide-[#E2E8F0]">
            <SettingRow title="Engineering sign-off for high voltage and motors" description="A certified electrical engineer reviews the telemetry before a redeploy route can be approved.">
              <RoleGate allowed={isAdmin}>
                <Switch
                  disabled={!isAdmin}
                  checked={w.requireEngineeringSignoff}
                  aria-label="Mandatory engineering sign-off"
                  onChange={async (v) => {
                    await settingsService.updateWorkflow({ requireEngineeringSignoff: v });
                    saved(`Engineering sign-off ${v ? 'required' : 'no longer required'}`);
                  }}
                />
              </RoleGate>
            </SettingRow>
            <SettingRow title="Escalation window for pending approvals" description={`Hours before an unapproved case is escalated to the ${w.escalateToRole} role.`}>
              <div className="flex items-center gap-2">
                <SaveOnBlur
                  key={w.escalateAfterHours}
                  type="number"
                  value={String(w.escalateAfterHours)}
                  ariaLabel="Escalation window in hours"
                  className="w-20 px-3 py-1.5 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl text-xs font-bold text-[#141416] focus:outline-none focus:border-[#FFD600] disabled:text-[#94A3B8]"
                  onSave={async (v) => {
                    await settingsService.updateWorkflow({ escalateAfterHours: Number(v) });
                    saved(`Escalation window set to ${Number(v)} hours`);
                  }}
                />
                <span className="font-semibold text-[#64748B]">hours</span>
              </div>
            </SettingRow>
            <SettingRow title="Escalate to" description="Role that receives escalated approvals. Only existing roles can be chosen.">
              <select
                value={w.escalateToRole}
                onChange={async (e) => {
                  await settingsService.updateWorkflow({ escalateToRole: e.target.value });
                  saved(`Escalations now go to the ${e.target.value} role`);
                }}
                className="w-44 px-3 py-1.5 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#141416] focus:outline-none focus:border-[#FFD600] disabled:text-[#94A3B8]"
                aria-label="Escalate to role"
              >
                {ESCALATION_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </SettingRow>
            <SettingRow title="Strict carbon avoidance verification (GHG Protocol Scope 3)" description="Uses secondary-market embodied emissions factors from the Persefoni connector.">
              <RoleGate allowed={isAdmin}>
                <Switch
                  disabled={!isAdmin}
                  checked={w.strictCarbonTracking}
                  aria-label="Strict carbon avoidance verification"
                  onChange={async (v) => {
                    await settingsService.updateWorkflow({ strictCarbonTracking: v });
                    saved(`Strict carbon verification turned ${v ? 'on' : 'off'}`);
                  }}
                />
              </RoleGate>
            </SettingRow>
          </div>
        </fieldset>
      )}
    </Card>
  );
}
