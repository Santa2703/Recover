'use client';

import React, { useState } from 'react';
import { Switch, Select, InputNumber, Modal, DatePicker, Input, Popconfirm, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useRouter } from 'next/navigation';
import { UserCheck, CalendarClock, History, Plus, Trash2, Gavel, Network, Building2, Scale } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { governanceService, fmtUsd, type DelegationSetting, type CoverRecord } from '@/services/governanceService';
import { ApprovalLimitsCard } from '@/components/governance/ApprovalLimitsCard';
import { useAuth } from '@/store/authContext';
import { PageHeader, PageActions, ListSkeleton, DataTable, ErrorState, type DataColumn } from '@/components/ui';
import { Card } from '@/components/governance/Filters';
import { WorkflowRulesCard } from '@/components/governance/WorkflowRulesCard';
import { CardHeader, Pill, RoleGate, ReadOnlyNotice, btnPrimary, btnSecondary, btnRowSecondary, type PillTone } from '@/components/governance/shared';

const SCOPES: Record<DelegationSetting['id'], string[]> = {
  decisions: ['All tenants', 'Customer A', 'Customer B', 'Customer C'],
  mcp: ['Read-only servers', 'Read and write servers'],
  tenant: ['Customer A', 'Customer B', 'Customer C', 'All tenants'],
};
const ICON: Record<DelegationSetting['id'], React.ReactNode> = {
  decisions: <Gavel className="w-4 h-4" />,
  mcp: <Network className="w-4 h-4" />,
  tenant: <Building2 className="w-4 h-4" />,
};
const COVER_STATE: Record<'active' | 'scheduled' | 'expired', PillTone> = { active: 'green', scheduled: 'blue', expired: 'slate' };
type CoverRow = CoverRecord & { approverName: string; delegateName: string; state: 'active' | 'scheduled' | 'expired' };
const COVER_SCOPES = ['Decisions', 'Decisions and MCP proposals', 'All approvals'];

export default function DelegationsPage() {
  const { user, isApprover } = useAuth();
  const router = useRouter();
  const canManage = isApprover; // Admin and Approver may manage delegations
  const actor = { id: user.id, name: user.name, role: user.role };
  const q = useServiceQuery(() => governanceService.getDelegations(), [], { subscribe: governanceService.subscribeDelegations });
  const thQ = useServiceQuery(() => governanceService.getApprovalThresholds(), [], { subscribe: governanceService.subscribeThresholds });
  const data = q.data;

  const people = governanceService.delegateCandidates();
  const approvers = people.filter((p) => p.role === 'Approver' || p.role === 'Admin');
  const [creating, setCreating] = useState(false);
  const [cover, setCover] = useState<{ approverId: string; delegateId: string; range: [Dayjs, Dayjs] | null; scope: string; reason: string }>({
    approverId: 'u-approver',
    delegateId: '',
    range: null,
    scope: 'Decisions',
    reason: '',
  });
  const [saving, setSaving] = useState(false);

  const createCover = async () => {
    if (!cover.delegateId || !cover.range) {
      message.error('Choose a delegate and a date range');
      return;
    }
    if (cover.delegateId === cover.approverId) {
      message.error('The delegate must be a different person');
      return;
    }
    setSaving(true);
    try {
      await governanceService.createCover(
        {
          approverId: cover.approverId,
          delegateId: cover.delegateId,
          from: cover.range[0].format('YYYY-MM-DD'),
          to: cover.range[1].format('YYYY-MM-DD'),
          scope: cover.scope,
          reason: cover.reason.trim() || 'Out of office',
        },
        actor,
      );
      message.success('Out-of-office cover created');
      setCreating(false);
      setCover({ approverId: 'u-approver', delegateId: '', range: null, scope: 'Decisions', reason: '' });
    } finally {
      setSaving(false);
    }
  };

  const saveThreshold = async (fld: (typeof THRESHOLD_FIELDS)[number], v: number): Promise<boolean> => {
    try {
      await governanceService.updateApprovalThresholds({ [fld.key]: v }, actor);
      message.success(`${fld.label} set to ${fmtUsd(v)}`);
      return true;
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not save');
      return false;
    }
  };

  const deleteCover = async (c: CoverRow) => {
    await governanceService.deleteCover(c.id, actor);
    message.success('Cover deleted');
  };

  const coverColumns: DataColumn<CoverRow>[] = [
    {
      title: 'Approver → delegate',
      key: 'who',
      priority: 1,
      render: (_: unknown, c: CoverRow) => (
        <div className="min-w-0">
          <div className="font-semibold text-[#141416] truncate">
            {c.approverName} → {c.delegateName}
          </div>
          <div className="text-[10px] text-[#94A3B8] truncate">{c.reason}</div>
        </div>
      ),
    },
    {
      title: 'Dates / Scope',
      key: 'dates',
      priority: 2,
      render: (_: unknown, c: CoverRow) => (
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-[#475569] truncate">
            {dayjs(c.from).format('DD MMM')} – {dayjs(c.to).format('DD MMM YYYY')}
          </div>
          <div className="text-[11px] text-[#64748B] truncate">{c.scope}</div>
        </div>
      ),
    },
    { title: 'State', dataIndex: 'state', key: 'state', priority: 1, width: 100, render: (v: CoverRow['state']) => <Pill tone={COVER_STATE[v]}>{v[0].toUpperCase() + v.slice(1)}</Pill> },
    {
      title: '',
      key: 'actions',
      priority: 1,
      width: 90,
      align: 'right',
      ellipsis: false,
      render: (_: unknown, c: CoverRow) => (
canManage ? (
          <Popconfirm title="Delete this cover?" okText="Delete" onConfirm={() => deleteCover(c)}>
            <button className={`${btnRowSecondary} inline-flex items-center gap-1`} aria-label="Delete cover">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </Popconfirm>
        ) : (
          <RoleGate allowed={false} reason={GATE}>
            <button disabled className={`${btnRowSecondary} inline-flex items-center gap-1`} aria-label="Delete cover">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </RoleGate>
        )
      ),
    },
  ];

  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Delegations & thresholds"
        description="Approval value thresholds, approval limits and workflow rules, what the Admin delegates to the Approver, and who covers when an approver is away. Changes save as you make them."
        actions={
          <PageActions
            primary={{ key: 'new', label: 'New cover', icon: <Plus />, onClick: () => setCreating(true), disabled: !canManage }}
            secondary={[{ key: 'log', label: 'Change history', icon: <History />, onClick: () => router.push('/audit?type=access') }]}
          />
        }
      />
      {!canManage && <ReadOnlyNotice>Read-only. Only Admins and Approvers can change thresholds, delegations and cover.</ReadOnlyNotice>}

      <Card>
        <CardHeader
          icon={<Scale />}
          title="Approval thresholds"
          description="The one set of value thresholds (net recovery). Plan approval and the Process flow control points read them from here."
        />
        <div className="pt-4">
          {thQ.initialLoading || !thQ.data ? (
            <ListSkeleton rows={1} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {THRESHOLD_FIELDS.map((fld) => (
                <ThresholdField key={`${fld.key}-${thQ.data![fld.key]}`} field={fld} value={thQ.data![fld.key]} disabled={!canManage} onSave={(v) => saveThreshold(fld, v)} />
              ))}
            </div>
          )}
        </div>
      </Card>

      <ApprovalLimitsCard canManage={canManage} actor={actor} />

      <WorkflowRulesCard />

      <Card>
        <CardHeader icon={<UserCheck />} title="Delegated from Admin to Approver" description="Turn a delegation on or off, set its scope and its limit." />
        <div className="pt-3">
          {q.initialLoading ? (
            <ListSkeleton rows={3} />
          ) : q.error ? (
            <ErrorState onRetry={q.refetch} compact />
          ) : (
            <div className="divide-y divide-[#F1F5F9]">
              {(data?.settings ?? []).map((s) => (
                // Keyed on the saved values so the row's draft resets after a save.
                <DelegationRow key={`${s.id}-${s.scope}-${s.limit}`} setting={s} actor={actor} canManage={canManage} />
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={<CalendarClock />}
          title="Out-of-office cover"
          description="While an approver is away, the delegate approves in their place."
          right={data ? <span className="px-3 py-1 rounded-full bg-[#FEF08A] text-[#854D0E] font-extrabold text-xs">{data.covers.filter((c) => c.state !== 'expired').length} active or scheduled</span> : null}
        />
        <div className="pt-3">
          <DataTable<CoverRow>
            rowKey="id"
            tableLayout="fixed"
            initialLoading={q.initialLoading}
            refreshing={q.loading}
            columns={coverColumns}
            dataSource={data?.covers ?? []}
            pagination={false}
            emptyTitle="No cover set up"
            emptyDescription="Create one when an approver will be away."
          />
        </div>
      </Card>
      <Modal
        open={creating && canManage}
        onCancel={() => setCreating(false)}
        title={
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-amber-500" />
            <span className="font-bold text-sm">New out-of-office cover</span>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={createCover} disabled={saving} className={btnPrimary}>
              {saving ? 'Creating…' : 'Create cover'}
            </button>
          </div>
        }
      >
        <div className="space-y-3 py-2 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Labeled label="Approver away">
              <Select value={cover.approverId} onChange={(v) => setCover((c) => ({ ...c, approverId: v }))} options={approvers.map((p) => ({ value: p.id, label: `${p.name} (${p.role})` }))} className="w-full" />
            </Labeled>
            <Labeled label="Delegate">
              <Select
                value={cover.delegateId || undefined}
                placeholder="Choose a person"
                onChange={(v) => setCover((c) => ({ ...c, delegateId: v }))}
                options={people.filter((p) => p.id !== cover.approverId).map((p) => ({ value: p.id, label: `${p.name} (${p.role})` }))}
                className="w-full"
                showSearch={{ optionFilterProp: 'label' }}
              />
            </Labeled>
          </div>
          <Labeled label="Dates">
            <DatePicker.RangePicker
              value={cover.range}
              onChange={(v) => setCover((c) => ({ ...c, range: v && v[0] && v[1] ? [v[0], v[1]] : null }))}
              className="w-full"
              format="DD MMM YYYY"
            />
          </Labeled>
          <Labeled label="Scope">
            <Select value={cover.scope} onChange={(v) => setCover((c) => ({ ...c, scope: v }))} options={COVER_SCOPES.map((s) => ({ value: s, label: s }))} className="w-full" />
          </Labeled>
          <Labeled label="Reason (optional)">
            <Input value={cover.reason} onChange={(e) => setCover((c) => ({ ...c, reason: e.target.value }))} placeholder="e.g. Annual leave" />
          </Labeled>
        </div>
      </Modal>
    </div>
  );
}

function DelegationRow({ setting, actor, canManage }: { setting: DelegationSetting; actor: { id: string; name: string; role: string }; canManage: boolean }) {
  const [limit, setLimit] = useState<number>(setting.limit);
  const [busy, setBusy] = useState(false);

  /** Same save model as Settings: every change saves straight away and confirms with a toast. */
  const save = async (patch: Partial<Pick<DelegationSetting, 'enabled' | 'scope' | 'limit'>>, done: string) => {
    setBusy(true);
    try {
      await governanceService.updateDelegation(setting.id, patch, actor);
      message.success(done);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  const commitLimit = () => {
    if (limit === setting.limit) return;
    save({ limit }, `${setting.label}: ${setting.limitLabel.toLowerCase()} set to ${limit.toLocaleString('en-US')}`);
  };

  // The Decisions limit is the delegation-limit threshold, edited in Approval thresholds above.
  const isThreshold = setting.id === 'decisions';
  const locked = !canManage || !setting.enabled || busy;
  return (
    <div className="py-3 flex flex-col lg:flex-row lg:items-center gap-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${setting.enabled ? 'bg-[#FFFBEB] border-[#FEF3C7] text-amber-500' : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#94A3B8]'}`}>{ICON[setting.id]}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold text-[#141416]">{setting.label}</span>
            <Pill tone={setting.enabled ? 'green' : 'slate'}>{setting.enabled ? 'Delegated' : 'Admin only'}</Pill>
          </div>
          <div className="text-[11px] text-[#64748B] mt-0.5">{setting.description}</div>
        </div>
      </div>
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <span className="block text-[10px] font-semibold text-[#64748B] mb-1">Scope</span>
          <Select
            size="small"
            value={setting.scope}
            onChange={(v) => save({ scope: v }, `${setting.label} scope set to ${v}`)}
            disabled={locked}
            options={SCOPES[setting.id].map((s) => ({ value: s, label: s }))}
            style={{ width: 170 }}
            aria-label={`${setting.label} scope`}
          />
        </div>
        <div>
          <span className="block text-[10px] font-semibold text-[#64748B] mb-1">{setting.limitLabel}</span>
          {isThreshold ? (
            <div className="h-6 flex items-center text-xs font-mono font-bold text-[#141416]" style={{ width: 170 }}>
              {fmtUsd(setting.limit)}
              <span className="ml-1.5 font-sans font-normal text-[10px] text-[#64748B]">set in thresholds</span>
            </div>
          ) : (
            <InputNumber
              size="small"
              value={limit}
              min={0}
              step={10}
              disabled={locked}
              onChange={(v) => setLimit(typeof v === 'number' ? v : 0)}
              onBlur={commitLimit}
              onPressEnter={commitLimit}
              style={{ width: 170 }}
              aria-label={setting.limitLabel}
            />
          )}
        </div>
        <div className="flex items-center gap-2 pb-0.5">
          <RoleGate allowed={canManage} reason={GATE}>
            <Switch
              checked={setting.enabled}
              disabled={!canManage}
              loading={busy}
              onChange={(enabled) => save({ enabled }, `${setting.label} delegation turned ${enabled ? 'on' : 'off'}`)}
              aria-label={`Delegate ${setting.label}`}
            />
          </RoleGate>
        </div>
      </div>
    </div>
  );
}

const GATE = 'Admins and Approvers only';

type ThresholdKey = 'autoApproveBelow' | 'level2Above' | 'delegationLimit';
const THRESHOLD_FIELDS: { key: ThresholdKey; label: string; help: string }[] = [
  { key: 'autoApproveBelow', label: 'Auto-approve below', help: 'Grade A plans under this value skip manual approval.' },
  { key: 'level2Above', label: 'Level 2 sign-off above', help: 'Plans over this value are Level 2 in the Approvals inbox (an Approver signs off).' },
  { key: 'delegationLimit', label: 'Approver delegation limit', help: 'Approvers sign off up to this value; above it, Executive sign-off.' },
];

function ThresholdField({ field, value, disabled, onSave }: { field: (typeof THRESHOLD_FIELDS)[number]; value: number; disabled: boolean; onSave: (v: number) => Promise<boolean> }) {
  const [draft, setDraft] = useState<number>(value);
  const commit = async () => {
    if (draft === value) return;
    if (!(await onSave(draft))) setDraft(value);
  };
  return (
    <div className="min-w-0">
      <span className="block text-[11px] font-bold text-[#64748B] mb-1">{field.label}</span>
      <InputNumber
        value={draft}
        min={0}
        step={500}
        disabled={disabled}
        onChange={(v) => setDraft(typeof v === 'number' ? v : 0)}
        onBlur={commit}
        onPressEnter={commit}
        formatter={(v) => `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
        parser={(v) => Number((v ?? '').replace(/[^\d]/g, ''))}
        className="w-full"
        aria-label={field.label}
      />
      <div className="text-[11px] text-[#64748B] mt-1">{field.help}</div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-[11px] font-bold text-[#64748B] mb-1">{label}</span>
      {children}
    </div>
  );
}
