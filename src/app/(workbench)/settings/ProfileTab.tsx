'use client';

import React, { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Switch, message } from 'antd';
import { useAuth, SESSION_USER } from '@/store/authContext';
import { USER_ROLES } from '@/constants/roles.constants';
import { userService } from '@/services/userService';
import { ALERT_TYPES, alertService, type PrefKey } from '@/services/alertService';
import { SectionTitle, SettingRow } from '@/components/governance/SettingsFields';
import { Card } from '@/components/governance/Filters';

const PREF_ROWS: { key: PrefKey; title: string; description: string }[] = [
  ...ALERT_TYPES.map((t) => ({ key: t.key as PrefKey, title: t.pref, description: t.description })),
  { key: 'digest', title: 'A daily digest of what the agents prepared', description: 'One message each morning with the drafts, evidence requests and syncs the agents prepared for you.' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-[#64748B]">{label}</dt>
      <dd className="m-0 mt-0.5 truncate text-xs font-semibold text-[#141416]">{children}</dd>
    </div>
  );
}

/** Settings › Profile: who is signed in, what the role does, and personal notification preferences (editable by every role). */
export function ProfileTab() {
  const { currentRole, currentTenant, currentSite, user } = useAuth();
  const role = USER_ROLES[currentRole];
  const tenants = currentRole === 'Planner' || currentTenant !== 'All' ? [user.tenant === 'All' ? currentTenant : user.tenant] : userService.meta().tenants;
  const prefs = useSyncExternalStore(
    alertService.subscribePreferences,
    () => alertService.preferences(user.id),
    () => alertService.preferences(user.id),
  );

  const toggle = async (key: PrefKey, title: string, on: boolean) => {
    await alertService.setPreference(user.id, key, on);
    message.success(`${title}: ${on ? 'sent to you' : 'bell and Alerts page only'}`);
  };

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <SectionTitle title="Profile" description="The account you are signed in with and what its role can do." />
        <div className="flex items-start gap-4">
          <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#E2E8F0] bg-[#F1F5F9] text-sm font-bold text-[#334155]">
            {SESSION_USER.initials}
          </div>
          <dl className="m-0 grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Signed in as">{SESSION_USER.name}</Field>
            <Field label="Role">{role.label}</Field>
            <Field label="Sign-in ID">
              <span className="font-mono">{user.email}</span>
            </Field>
            <Field label={tenants.length > 1 ? 'Tenants' : 'Tenant'}>{tenants.join(', ')}</Field>
            {role.warehouseScoped && <Field label="Site">{currentSite}</Field>}
            <div className="min-w-0 sm:col-span-2 xl:col-span-4">
              <dt className="text-[11px] font-semibold text-[#64748B]">What the role does</dt>
              <dd className="m-0 mt-0.5 text-xs text-[#334155]">{role.desc}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card className="space-y-2">
        <SectionTitle title="Notification preferences" description="Personal to you, so every role can change them. Organisation channels stay on the Notifications tab." />
        <p className="m-0 text-[11px] text-[#64748B]">
          Alerts always show in the bell and on the{' '}
          <Link href="/command/alerts" className="font-semibold text-[#141416] underline">
            Alerts page
          </Link>
          ; these choose what is also sent to you.
        </p>
        <div className="divide-y divide-[#E2E8F0] text-xs">
          {PREF_ROWS.map((r) => (
            <SettingRow key={r.key} title={r.title} description={r.description}>
              <Switch checked={prefs[r.key]} aria-label={r.title} onChange={(v) => toggle(r.key, r.title, v)} />
            </SettingRow>
          ))}
        </div>
      </Card>
    </div>
  );
}
