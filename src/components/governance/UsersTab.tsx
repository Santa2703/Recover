'use client';

import React, { useState } from 'react';
import { Modal, Select, Tag, message } from 'antd';
import { Users, Pencil, CheckCircle2 } from 'lucide-react';
import { USER_ROLES } from '@/constants/roles.constants';
import type { UserRole } from '@/models/user.model';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { governanceService, type AccountRecord, type AccountStatus, type DirectoryRow, type MatchStatus } from '@/services/governanceService';
import { useAuth } from '@/store/authContext';
import { DataTable, ErrorState, StatusBadge, type DataColumn } from '@/components/ui';
import { Card, SearchBox, FilterPick, ClearFilters, FilterRow } from './Filters';
import { CardHeader, Pill, RoleGate, ReadOnlyNotice, btnPrimary, btnSecondary, btnRowSecondary, type PillTone } from './shared';

const ROLES = Object.keys(USER_ROLES) as UserRole[];
export const MATCH: Record<MatchStatus | 'no_idp', { label: string; tone: PillTone; action?: string }> = {
  matched: { label: 'Matched', tone: 'green' },
  role_mismatch: { label: 'Role mismatch', tone: 'amber', action: 'Apply IdP role' },
  not_provisioned: { label: 'Not provisioned', tone: 'blue', action: 'Provision' },
  disabled_in_idp: { label: 'Disabled in IdP', tone: 'red', action: 'Suspend account' },
  unmapped_group: { label: 'Group not mapped', tone: 'slate' },
  no_idp: { label: 'Not in IdP', tone: 'slate' },
};
export type MatchFilter = MatchStatus | 'no_idp' | 'issues' | 'all';

/** Users & identity → Users tab: every person once, with account access and IdP match side by side. */
export function UsersTab({ initialMatch = 'all' }: { initialMatch?: MatchFilter }) {
  const { user, isAdmin } = useAuth();
  const actor = { id: user.id, name: user.name, role: user.role };
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserRole | 'all'>('all');
  const [match, setMatch] = useState<MatchFilter>(initialMatch);
  const [editing, setEditing] = useState<DirectoryRow | null>(null);
  const [form, setForm] = useState<{ role: UserRole; tenant: string; site: string; status: AccountStatus }>({ role: 'Planner', tenant: 'All', site: 'Head office', status: 'active' });
  const [saving, setSaving] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const q = useServiceQuery(() => governanceService.listDirectory({ search, role, match }), [search, role, match], { subscribe: governanceService.subscribeIdentity });
  const allQ = useServiceQuery(() => governanceService.listDirectory(), [], { subscribe: governanceService.subscribeIdentity });
  const issues = (allQ.data ?? []).filter((r) => r.match !== 'matched' && r.match !== 'no_idp').length;
  const { tenants, sites } = governanceService.accessOptions();
  const filtered = search !== '' || role !== 'all' || match !== 'all';
  const clear = () => {
    setSearch('');
    setRole('all');
    setMatch('all');
  };

  const openEdit = (r: DirectoryRow) => {
    if (!isAdmin || !r.account) return;
    const a: AccountRecord = r.account;
    setEditing(r);
    setForm({ role: a.role, tenant: a.tenant, site: a.site, status: a.status });
  };

  const save = async () => {
    if (!editing?.account) return;
    setSaving(true);
    try {
      await governanceService.updateAccount(editing.account.id, form, actor);
      message.success(`${editing.name} updated: ${form.role}, ${form.tenant}, ${form.site}`);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const resolve = async (id: string) => {
    setBusyRow(id);
    try {
      message.success(await governanceService.resolveIdpUser(id, actor));
    } finally {
      setBusyRow(null);
    }
  };

  const columns: DataColumn<DirectoryRow>[] = [
    {
      title: 'Name / Email',
      dataIndex: 'name',
      key: 'name',
      priority: 1,
      render: (v: string, r: DirectoryRow) => (
        <div className="min-w-0">
          <div className="font-semibold text-xs text-[#141414] truncate">{v}</div>
          <div className="font-mono text-[11px] text-gray-500 truncate">{r.email}</div>
        </div>
      ),
    },
    {
      title: 'Role / Tenant scope',
      key: 'role',
      priority: 2,
      width: 170,
      render: (_: unknown, r: DirectoryRow) =>
        r.account ? (
          <div className="min-w-0">
            <Tag color="blue" className="font-bold text-xs !m-0">
              {r.account.role}
            </Tag>
            <div className="text-[11px] text-gray-700 truncate mt-0.5">
              {r.account.tenant} · {r.account.site}
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-[#94A3B8]">No account</span>
        ),
    },
    {
      title: 'IdP group',
      key: 'group',
      priority: 3,
      render: (_: unknown, r: DirectoryRow) =>
        r.idpUser ? (
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-[#475569] truncate">{r.idpUser.group}</div>
            <div className={`text-[10px] truncate ${r.match === 'role_mismatch' ? 'text-[#D97706] font-semibold' : 'text-[#94A3B8]'}`}>
              Group role: {r.idpUser.mappedRole ?? 'none'}
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-[#94A3B8]">—</span>
        ),
    },
    {
      title: 'Status / IdP match',
      key: 'status',
      priority: 1,
      width: 150,
      render: (_: unknown, r: DirectoryRow) => (
        <div className="flex flex-col items-start gap-1 min-w-0">
          {r.account && <StatusBadge tone={r.account.status === 'active' ? 'success' : 'warning'}>{r.account.status === 'active' ? 'Active' : 'Suspended'}</StatusBadge>}
          <Pill tone={MATCH[r.match].tone}>{MATCH[r.match].label}</Pill>
        </div>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      priority: 1,
      width: 190,
      align: 'right',
      ellipsis: false,
      render: (_: unknown, r: DirectoryRow) => {
        const fix = r.idpUser && MATCH[r.match].action && (r.match !== 'disabled_in_idp' || r.account) ? r.idpUser : null;
        return (
          <div className="inline-flex flex-wrap justify-end items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {fix && (
              <RoleGate allowed={isAdmin}>
                <button onClick={() => resolve(fix.id)} disabled={!isAdmin || busyRow === fix.id} className={btnRowSecondary}>
                  {busyRow === fix.id ? 'Working…' : MATCH[r.match].action}
                </button>
              </RoleGate>
            )}
            {!fix && r.match === 'matched' && <CheckCircle2 className="w-3.5 h-3.5 text-[#059669]" aria-label="IdP matches the account" />}
            {r.account && (
              <RoleGate allowed={isAdmin}>
                <button onClick={() => openEdit(r)} disabled={!isAdmin} className={`${btnRowSecondary} inline-flex items-center gap-1`} aria-label={`Edit ${r.name}`}>
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              </RoleGate>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {!isAdmin && <ReadOnlyNotice>Read-only. Only Admins can change roles, tenant scope, facility or status, or fix IdP mismatches.</ReadOnlyNotice>}
      <Card>
        <CardHeader
          icon={<Users />}
          title="People"
          description="Each person once: their Circularity account and the identity provider user matched to it by email. Changes are written to the audit log."
          right={
            <button type="button" onClick={() => setMatch('issues')} className="px-3 py-1 rounded-full bg-[#FEF08A] text-[#854D0E] font-extrabold text-xs border-0 cursor-pointer hover:bg-[#FDE047]">
              {issues} to resolve
            </button>
          }
        />
        <div className="pt-4">
          <FilterRow>
            <SearchBox value={search} onChange={setSearch} placeholder="Search name, email, tenant, facility or group" label="Search people" />
            <FilterPick
              value={role}
              onChange={(v) => setRole(v as UserRole | 'all')}
              label="Role"
              options={[{ value: 'all', label: 'All roles' }, ...ROLES.map((r) => ({ value: r, label: r }))]}
            />
            <FilterPick
              value={match}
              onChange={(v) => setMatch(v as MatchFilter)}
              label="IdP match"
              options={[
                { value: 'all', label: 'All match statuses' },
                { value: 'issues', label: 'Needs attention' },
                ...(Object.keys(MATCH) as (MatchStatus | 'no_idp')[]).map((k) => ({ value: k, label: MATCH[k].label })),
              ]}
            />
            <ClearFilters onClick={clear} disabled={!filtered} />
          </FilterRow>
        </div>
        <div className="pt-3">
          {q.error ? (
            <ErrorState onRetry={q.refetch} compact />
          ) : (
            <DataTable<DirectoryRow>
              rowKey="id"
              tableLayout="fixed"
              initialLoading={q.initialLoading}
              refreshing={q.loading}
              filtered={filtered}
              onClearFilters={clear}
              columns={columns}
              dataSource={q.data ?? []}
              onRowClick={isAdmin ? openEdit : undefined}
              pagination={false}
            />
          )}
        </div>
      </Card>

      <Modal
        open={!!editing && isAdmin}
        onCancel={() => setEditing(null)}
        title={
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-amber-500" />
            <span className="font-bold text-sm">Edit access · {editing?.name}</span>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={save} disabled={saving} className={btnPrimary}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        }
      >
        {editing && (
          <div className="space-y-3 py-2 text-xs">
            <div className="font-mono text-[11px] text-[#64748B]">{editing.email}</div>
            {editing.idpUser && (
              <div className="text-[11px] text-[#64748B]">
                IdP group <span className="font-mono text-[#141416]">{editing.idpUser.group}</span> maps to {editing.idpUser.mappedRole ?? 'no role'}.
              </div>
            )}
            <Field label="Role">
              <Select value={form.role} onChange={(v) => setForm((f) => ({ ...f, role: v }))} options={ROLES.map((r) => ({ value: r, label: r }))} className="w-full" />
              <div className="text-[11px] text-[#94A3B8] mt-1">{USER_ROLES[form.role].desc}</div>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Tenant scope">
                <Select value={form.tenant} onChange={(v) => setForm((f) => ({ ...f, tenant: v }))} options={tenants.map((t) => ({ value: t, label: t }))} className="w-full" />
              </Field>
              <Field label="Assigned facility">
                <Select value={form.site} onChange={(v) => setForm((f) => ({ ...f, site: v }))} options={sites.map((s) => ({ value: s, label: s }))} className="w-full" />
              </Field>
            </div>
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'suspended', label: 'Suspended' },
                ]}
                className="w-full"
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-[11px] font-bold text-[#64748B] mb-1">{label}</span>
      {children}
    </div>
  );
}
