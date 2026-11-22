'use client';

import React, { useState, useSyncExternalStore } from 'react';
import { Dropdown, Input, Modal, Radio, Select, message, type MenuProps } from 'antd';
import { Lock } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { tenantAccessService } from '@/services/tenantAccessService';
import { GRANT_DURATION_LABEL, type AccessRequest, type TenantGrantDuration } from '@/services/governanceService';
import { Pill, btnPrimary, btnSecondary, fmtDateTime, type PillTone } from '@/components/governance/shared';

const TENANT_LABELS: Record<string, string> = {
  'Customer A': 'Customer A · Northfield',
  'Customer B': 'Customer B · Midwest Hub',
  'Customer C': 'Customer C · Eastern Fleet',
  All: 'All Customer Tenants',
};
const labelOf = (t: string) => TENANT_LABELS[t] ?? t;
const REQUEST_KEY = 'request:';
const STATUS_PILL: Record<AccessRequest['status'], { label: string; tone: PillTone }> = {
  pending: { label: 'Pending', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
};

export function TenantSelector() {
  const { currentTenant, setTenant, tenantAccess, user, currentRole } = useAuth();
  const [requestFor, setRequestFor] = useState<string | null>(null);
  // Pending requests show on the locked menu items; re-read when requests change.
  useSyncExternalStore(tenantAccessService.subscribe, tenantAccessService.version, tenantAccessService.version);
  const mine = tenantAccessService.myRequests(user.id);
  const pendingFor = new Set(mine.filter((r) => r.status === 'pending').map((r) => r.target));
  const locked = tenantAccess.tenants.filter((t) => !tenantAccess.allowed.includes(t));
  const grantOf = (t: string) => tenantAccess.grants.find((g) => g.tenant === t);

  const tenantItem = (t: string): NonNullable<MenuProps['items']>[number] => {
    if (tenantAccess.allowed.includes(t)) {
      const g = grantOf(t);
      return {
        key: t,
        label: (
          <span className="flex items-center justify-between gap-3">
            <span>{labelOf(t)}</span>
            {g && <span className="text-[10px] font-semibold text-[#047857]">{g.expiresAt ? `Granted until ${g.expiresAt.slice(0, 10)}` : 'Granted'}</span>}
          </span>
        ),
      };
    }
    return {
      key: `${REQUEST_KEY}${t}`,
      label: (
        <span className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[#94A3B8]">
            <Lock size={12} aria-hidden />
            {labelOf(t)}
          </span>
          <span className="text-[10px] font-bold text-[#0369A1]">{pendingFor.has(t) ? 'Pending' : 'Request access'}</span>
        </span>
      ),
    };
  };

  const menuItems: MenuProps['items'] = [
    ...tenantAccess.tenants.map(tenantItem),
    { type: 'divider' },
    tenantAccess.canSeeAll
      ? { key: 'All', label: labelOf('All') }
      : { key: 'all-locked', disabled: true, label: <span className="text-[#94A3B8]">All Customer Tenants · not in your scope</span> },
  ];

  const handleMenuClick: MenuProps['onClick'] = (e) => {
    if (e.key.startsWith(REQUEST_KEY)) setRequestFor(e.key.slice(REQUEST_KEY.length));
    else if (e.key !== 'all-locked') setTenant(e.key);
  };

  return (
    <>
      <Dropdown menu={{ items: menuItems, onClick: handleMenuClick }} trigger={['click']}>
        <button
          type="button"
          aria-label={`Customer tenant: ${labelOf(currentTenant)}`}
          className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[#E2E8F0] hover:border-[#CBD5E1] rounded-lg text-xs font-medium text-[#334155] hover:text-[#0F172A] transition-all cursor-pointer select-none max-w-[150px] sm:max-w-none"
        >
          <span className="truncate">{labelOf(currentTenant)}</span>
          <span className="text-[11px] text-[#64748B] leading-none">▾</span>
        </button>
      </Dropdown>
      {requestFor !== null && (
        <RequestAccessModal
          key={requestFor}
          initialTenant={requestFor}
          locked={locked}
          requests={mine}
          onClose={() => setRequestFor(null)}
          actor={{ id: user.id, name: user.name, role: currentRole }}
          site={user.site}
        />
      )}
    </>
  );
}

function RequestAccessModal({
  initialTenant,
  locked,
  requests,
  onClose,
  actor,
  site,
}: {
  initialTenant: string;
  locked: string[];
  requests: AccessRequest[];
  onClose: () => void;
  actor: { id: string; name: string; role: string };
  site: string;
}) {
  const [tenant, setTenant] = useState(initialTenant);
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState<TenantGrantDuration>('7d');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const pending = requests.some((r) => r.target === tenant && r.status === 'pending');
  const reasonMissing = !reason.trim();

  const submit = async () => {
    setTried(true);
    if (reasonMissing || pending || !tenant) return;
    setBusy(true);
    try {
      const r = await tenantAccessService.request({ tenant, reason, duration, site: site === 'Head office' ? undefined : site }, actor);
      message.success(`${r.id} sent: an Approver or Admin will review your request for ${tenant}`);
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not send the request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title={<span className="text-sm font-bold">Request tenant access</span>}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy || pending || locked.length === 0} className={btnPrimary}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      }
    >
      <div className="space-y-4 py-2 text-xs text-[#475569]">
        <p>Approvers and Admins review tenant requests in the Tenant access queue. You can switch to the tenant once it is approved.</p>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-[#64748B]">Customer tenant</span>
          <Select
            className="w-full"
            value={tenant}
            onChange={setTenant}
            options={locked.map((t) => ({ value: t, label: labelOf(t) }))}
            aria-label="Customer tenant"
          />
        </label>
        {pending && <p className="font-semibold text-[#B45309]">You already have a pending request for {tenant}.</p>}
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-[#64748B]">Reason (required)</span>
          <Input.TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            status={tried && reasonMissing ? 'error' : undefined}
            placeholder="What do you need to do in this tenant, and for how long?"
          />
          {tried && reasonMissing && <span className="mt-1 block text-[11px] font-semibold text-[#B91C1C]">Add a reason so the approver can decide.</span>}
        </label>
        <div>
          <span className="mb-1 block text-[11px] font-bold text-[#64748B]" id="grant-duration">
            Duration
          </span>
          <Radio.Group
            aria-labelledby="grant-duration"
            value={duration}
            onChange={(e) => setDuration(e.target.value as TenantGrantDuration)}
            options={(Object.keys(GRANT_DURATION_LABEL) as TenantGrantDuration[]).map((k) => ({ value: k, label: GRANT_DURATION_LABEL[k] }))}
          />
        </div>
        {requests.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">Your requests</div>
            <ul className="m-0 list-none divide-y divide-[#F1F5F9] rounded-xl border border-[#E2E8F0] p-0">
              {requests.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[#141416]">
                      <span className="font-mono">{r.id}</span> · {r.target}
                    </div>
                    <div className="truncate text-[11px] text-[#64748B]">
                      <span className="font-mono">{fmtDateTime(r.requestedAt)}</span>
                      {r.duration && ` · ${GRANT_DURATION_LABEL[r.duration]}`}
                      {r.status === 'approved' && r.expiresAt && (
                        <>
                          {' · until '}
                          <span className="font-mono">{r.expiresAt.slice(0, 10)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Pill tone={STATUS_PILL[r.status].tone}>{STATUS_PILL[r.status].label}</Pill>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
