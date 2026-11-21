'use client';

import React, { useState } from 'react';
import { Modal, Select, Input, Popconfirm, message } from 'antd';
import { RefreshCw, KeyRound, Plus, Trash2, Link2 } from 'lucide-react';
import { USER_ROLES } from '@/constants/roles.constants';
import type { UserRole } from '@/models/user.model';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { governanceService, type GroupMapping } from '@/services/governanceService';
import { useAuth } from '@/store/authContext';
import { Skeleton, DataTable, ErrorState, type DataColumn } from '@/components/ui';
import { Card } from './Filters';
import { CardHeader, Pill, RoleGate, ReadOnlyNotice, btnPrimary, btnSecondary, fmtDateTime } from './shared';

const ROLES = Object.keys(USER_ROLES) as UserRole[];

/** Users & identity → Identity provider tab: the IdP connection, Sync now, and group → role mappings. */
export function IdentityTab({ onShowIssues }: { onShowIssues: () => void }) {
  const { user, isAdmin } = useAuth();
  const actor = { id: user.id, name: user.name, role: user.role };
  const q = useServiceQuery(() => governanceService.getIdentity(), [], { subscribe: governanceService.subscribeIdentity });
  const { tenants, sites } = governanceService.accessOptions();
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newMap, setNewMap] = useState<Omit<GroupMapping, 'id' | 'objectId'>>({ group: '', role: 'Planner', tenant: 'Customer A', site: 'Warehouse 1' });

  const data = q.data;
  const idp = data?.idp;

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await governanceService.syncIdp(actor);
      message.success(`Sync complete: ${r.lastResult}`);
    } finally {
      setSyncing(false);
    }
  };

  const updateMapping = async (m: GroupMapping, patch: Partial<GroupMapping>) => {
    await governanceService.updateMapping(m.id, patch, actor);
    message.success(`${m.group} mapping updated`);
  };

  const addMapping = async () => {
    if (!newMap.group.trim()) {
      message.error('Enter the IdP group name');
      return;
    }
    await governanceService.addMapping({ ...newMap, group: newMap.group.trim() }, actor);
    message.success(`${newMap.group.trim()} now maps to ${newMap.role}`);
    setAdding(false);
    setNewMap({ group: '', role: 'Planner', tenant: 'Customer A', site: 'Warehouse 1' });
  };

  const removeMapping = async (m: GroupMapping) => {
    await governanceService.removeMapping(m.id, actor);
    message.success(`${m.group} mapping removed`);
  };

  const memberCount = (g: string) => (data?.users ?? []).filter((u) => u.group === g).length;
  const issues = (data?.users ?? []).filter((u) => u.match !== 'matched').length;

  const mappingColumns: DataColumn<GroupMapping>[] = [
    {
      title: 'IdP group',
      dataIndex: 'group',
      key: 'group',
      priority: 1,
      render: (_: unknown, m: GroupMapping) => (
        <div className="min-w-0">
          <div className="font-mono font-bold text-[11px] text-[#141416] truncate">{m.group}</div>
          <div className="font-mono text-[10px] text-[#94A3B8] truncate">{m.objectId}</div>
        </div>
      ),
    },
    {
      title: 'Role / Tenant scope',
      key: 'role',
      priority: 1,
      ellipsis: false,
      render: (_: unknown, m: GroupMapping) => (
        <div className="flex flex-wrap gap-1.5 min-w-0">
          <Select size="small" disabled={!isAdmin} value={m.role} onChange={(v) => updateMapping(m, { role: v })} options={ROLES.map((r) => ({ value: r, label: r }))} style={{ width: 160, maxWidth: '100%' }} aria-label={`Role for ${m.group}`} />
          <Select size="small" disabled={!isAdmin} value={m.tenant} onChange={(v) => updateMapping(m, { tenant: v })} options={tenants.map((t) => ({ value: t, label: t }))} style={{ width: 120, maxWidth: '100%' }} aria-label={`Tenant for ${m.group}`} />
        </div>
      ),
    },
    {
      title: 'Facility',
      key: 'site',
      priority: 2,
      ellipsis: false,
      width: 150,
      render: (_: unknown, m: GroupMapping) => (
        <Select size="small" disabled={!isAdmin} value={m.site} onChange={(v) => updateMapping(m, { site: v })} options={sites.map((s) => ({ value: s, label: s }))} style={{ width: '100%' }} aria-label={`Facility for ${m.group}`} />
      ),
    },
    {
      title: 'Members',
      key: 'members',
      priority: 2,
      width: 90,
      align: 'right',
      render: (_: unknown, m: GroupMapping) => <span className="font-mono text-[#475569]">{memberCount(m.group)}</span>,
    },
    {
      title: '',
      key: 'actions',
      priority: 1,
      width: 50,
      align: 'right',
      ellipsis: false,
      render: (_: unknown, m: GroupMapping) =>
        !isAdmin ? (
          <RoleGate allowed={false}>
            <button disabled className="p-1 rounded-md text-[#CBD5E1]" aria-label={`Remove ${m.group}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </RoleGate>
        ) : (
          <Popconfirm title="Remove this mapping?" description="Members of the group will no longer get a role." okText="Remove" onConfirm={() => removeMapping(m)}>
            <button className="p-1 hover:bg-[#F1F5F9] rounded-md text-[#64748B] hover:text-[#DC2626] transition-colors cursor-pointer" aria-label={`Remove ${m.group}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      {!isAdmin && <ReadOnlyNotice>Read-only. Only Admins can sync the identity provider or change group mappings.</ReadOnlyNotice>}

      {/* Connection: one summary line */}
      <Card>
        {q.initialLoading || !idp ? (
          <Skeleton className="h-8 w-full rounded-xl" />
        ) : (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 min-w-0">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[#FFFBEB] border border-[#FEF3C7] flex items-center justify-center shrink-0 text-amber-500">
                <KeyRound className="w-4 h-4" />
              </div>
              <div className="min-w-0 text-xs">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-extrabold text-[#141416]">{idp.provider}</span>
                  {idp.status === 'syncing' ? <Pill tone="blue">Syncing</Pill> : idp.status === 'connected' ? <Pill tone="green">Connected</Pill> : <Pill tone="red">Error</Pill>}
                  <span className="text-[#64748B]">
                    {idp.domain} · {idp.protocol} · synced {fmtDateTime(idp.lastSync)} · {idp.interval.charAt(0).toLowerCase() + idp.interval.slice(1)}
                  </span>
                </div>
                <div className="text-[11px] text-[#64748B] mt-0.5">
                  Last result: <span className="font-semibold text-[#141416]">{idp.lastResult}</span>
                  {issues > 0 && (
                    <>
                      {' · '}
                      <button type="button" onClick={onShowIssues} className="p-0 bg-transparent border-0 underline font-semibold text-[#141416] cursor-pointer hover:no-underline">
                        {issues} users to review
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
            <RoleGate allowed={isAdmin}>
              <button onClick={sync} disabled={!isAdmin || syncing} className={`${btnPrimary} shrink-0 self-start md:self-auto`}>
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'Syncing…' : 'Sync now'}</span>
              </button>
            </RoleGate>
          </div>
        )}
      </Card>

      {/* Group mapping */}
      <Card>
        <CardHeader
          icon={<Link2 />}
          title="Group → role mapping"
          description="Members of each IdP group get this role, tenant scope and facility. Changes apply at the next sync."
          right={
            <RoleGate allowed={isAdmin}>
              <button onClick={() => setAdding(true)} disabled={!isAdmin} className={btnSecondary}>
                <Plus className="w-3.5 h-3.5" />
                <span>Add mapping</span>
              </button>
            </RoleGate>
          }
        />
        <div className="pt-3">
          {q.error ? (
            <ErrorState onRetry={q.refetch} compact />
          ) : (
            <DataTable<GroupMapping>
              rowKey="id"
              tableLayout="fixed"
              initialLoading={q.initialLoading}
              refreshing={q.loading}
              columns={mappingColumns}
              dataSource={data?.mappings ?? []}
              pagination={false}
              emptyTitle="No group mappings"
            />
          )}
        </div>
      </Card>

      <Modal
        open={adding && isAdmin}
        onCancel={() => setAdding(false)}
        title={
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-amber-500" />
            <span className="font-bold text-sm">Add group mapping</span>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={addMapping} className={btnPrimary}>
              Add mapping
            </button>
          </div>
        }
      >
        <div className="space-y-3 py-2 text-xs">
          <div>
            <span className="block text-[11px] font-bold text-[#64748B] mb-1">IdP group name</span>
            <Input value={newMap.group} onChange={(e) => setNewMap((m) => ({ ...m, group: e.target.value }))} placeholder="e.g. CIRC-Planners-CustomerD" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <span className="block text-[11px] font-bold text-[#64748B] mb-1">Role</span>
              <Select value={newMap.role} onChange={(v) => setNewMap((m) => ({ ...m, role: v }))} options={ROLES.map((r) => ({ value: r, label: r }))} className="w-full" />
            </div>
            <div>
              <span className="block text-[11px] font-bold text-[#64748B] mb-1">Tenant</span>
              <Select value={newMap.tenant} onChange={(v) => setNewMap((m) => ({ ...m, tenant: v }))} options={tenants.map((t) => ({ value: t, label: t }))} className="w-full" />
            </div>
            <div>
              <span className="block text-[11px] font-bold text-[#64748B] mb-1">Facility</span>
              <Select value={newMap.site} onChange={(v) => setNewMap((m) => ({ ...m, site: v }))} options={sites.map((s) => ({ value: s, label: s }))} className="w-full" />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
