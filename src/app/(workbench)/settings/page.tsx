'use client';

import React, { useState } from 'react';
import { Modal, Popconfirm, Switch, Tabs, message } from 'antd';
import { Building, Warehouse, Bell, RotateCcw, Plus, Pencil, Trash2, UserRound } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { settingsService, type SettingsSnapshot, type SiteRecord } from '@/services/settingsService';
import { userService } from '@/services/userService';
import { useAuth } from '@/store/authContext';
import { PageHeader, PageActions, DataTable, ProgressBar, Skeleton, ErrorState, type DataColumn } from '@/components/ui';
import { btnPrimary, btnSecondary, btnRowSecondary, RoleGate, ReadOnlyNotice, useTabParam } from '@/components/governance/shared';
import { SaveOnBlur, SectionTitle, SettingRow, fieldCls, labelCls } from '@/components/governance/SettingsFields';
import { Card } from '@/components/governance/Filters';
import { ProfileTab } from './ProfileTab';

const TAB_KEYS = ['profile', 'organisation', 'sites', 'notifications'] as const;
type TabKey = (typeof TAB_KEYS)[number];
type OrgTabKey = Exclude<TabKey, 'profile'>;

const EMPTY_SITE: Omit<SiteRecord, 'status'> = { id: '', name: '', location: '', capacityPct: 0, baysCount: 0, manager: '' };

export default function EnterpriseSettingsPage() {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useTabParam(TAB_KEYS, 'profile');
  // Facility leads come from the user directory, so a site can only be led by a real account.
  const people = userService.all();
  const q = useServiceQuery(() => settingsService.get(), [], { subscribe: settingsService.subscribe });
  const data = q.data;
  const [siteForm, setSiteForm] = useState<(Omit<SiteRecord, 'status'> & { isNew: boolean }) | null>(null);
  const [savingSite, setSavingSite] = useState(false);
  const [modal, modalHolder] = Modal.useModal();

  const saved = (text: string) => message.success(text);

  const reset = async () => {
    await settingsService.reset();
    saved('Settings restored to the defaults');
  };

  const saveSite = async () => {
    if (!siteForm) return;
    if (!siteForm.name.trim() || !siteForm.location.trim()) {
      message.error('Enter a facility name and location');
      return;
    }
    if (!people.some((p) => p.name === siteForm.manager)) {
      message.error('Choose a facility lead from the user directory');
      return;
    }
    setSavingSite(true);
    try {
      const { isNew, ...site } = siteForm;
      const r = await settingsService.saveSite({ ...site, status: '', id: isNew ? site.id.trim() || undefined : site.id } as Omit<SiteRecord, 'id'> & { id?: string });
      saved(isNew ? `Facility ${r.id} registered` : `Facility ${r.id} updated`);
      setSiteForm(null);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not save the facility');
    } finally {
      setSavingSite(false);
    }
  };

  const siteColumns: DataColumn<SiteRecord>[] = [
    {
      title: 'Code / Facility Name',
      key: 'name',
      priority: 1,
      render: (_: unknown, s: SiteRecord) => (
        <div className="min-w-0">
          <div className="font-semibold text-[#141416] truncate">{s.name}</div>
          <div className="font-mono text-[11px] font-bold text-[#64748B]">{s.id}</div>
        </div>
      ),
    },
    { title: 'Location', dataIndex: 'location', key: 'location', priority: 2, render: (v: string) => <span className="text-[#64748B]">{v}</span> },
    { title: 'Active Bays', dataIndex: 'baysCount', key: 'bays', priority: 3, width: 110, render: (v: number) => <span className="font-mono text-[#141416]">{v} bays</span> },
    {
      title: 'Staging Capacity',
      dataIndex: 'capacityPct',
      key: 'capacity',
      priority: 2,
      width: 170,
      render: (v: number) => (
        <div className="w-full min-w-0">
          <ProgressBar value={v} tone={v > 85 ? 'danger' : v > 70 ? 'warning' : 'success'} label="Staging capacity" showValue />
        </div>
      ),
    },
    {
      title: 'Facility Lead',
      dataIndex: 'manager',
      key: 'manager',
      priority: 3,
      render: (v: string) => (
        <div className="min-w-0">
          <div className="text-[#141416] truncate">{v}</div>
          <div className="text-[11px] text-[#64748B] truncate">{people.find((p) => p.name === v)?.role ?? 'Not in the user directory'}</div>
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      priority: 1,
      width: 150,
      render: (v: string) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold max-w-full truncate ${
            v.includes('Warning') ? 'bg-[#FEF3C7] text-[#D97706]' : 'bg-[#DCFCE7] text-[#15803D]'
          }`}
        >
          {v}
        </span>
      ),
    },
    {
      title: '',
      key: 'actions',
      priority: 1,
      width: 100,
      align: 'right',
      ellipsis: false,
      render: (_: unknown, s: SiteRecord) =>
        !isAdmin ? (
          <RoleGate allowed={false}>
            <button disabled className={`${btnRowSecondary} inline-flex items-center gap-1`} aria-label={`Edit ${s.id}`}>
              <Pencil className="w-3 h-3" /> Edit
            </button>
          </RoleGate>
        ) : (
        <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setSiteForm({ ...s, isNew: false })} className={`${btnRowSecondary} inline-flex items-center gap-1`} aria-label={`Edit ${s.id}`}>
            <Pencil className="w-3 h-3" /> Edit
          </button>
          <Popconfirm
            title={`Remove ${s.id}?`}
            okText="Remove"
            onConfirm={async () => {
              await settingsService.removeSite(s.id);
              saved(`Facility ${s.id} removed`);
            }}
          >
            <button className="p-1 hover:bg-[#F1F5F9] rounded-md text-[#64748B] hover:text-[#DC2626] cursor-pointer" aria-label={`Remove ${s.id}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Popconfirm>
        </div>
        ),
    },
  ];

  const loadingCard = (
    <Card>
      <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-80 max-w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-xl" />
          ))}
        </div>
      </div>
    </Card>
  );

  const content = (d: SettingsSnapshot): Record<OrgTabKey, React.ReactNode> => ({
    organisation: (
      <div className="space-y-6">
      <Card className="space-y-4">
        <SectionTitle title="Organisation profile" description="Single sign-on and user provisioning are set up under Access → Users & identity." />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className={labelCls}>Tenant Legal Name</label>
            <SaveOnBlur
              key={d.tenant.name}
              value={d.tenant.name}
              ariaLabel="Tenant legal name"
              onSave={async (v) => {
                if (!v.trim()) {
                  message.error('The legal name cannot be empty');
                  return;
                }
                await settingsService.updateTenant({ name: v.trim() });
                saved('Tenant legal name saved');
              }}
            />
          </div>
          <div>
            <label className={labelCls}>Tenant Identifier (UID)</label>
            <input type="text" value={d.tenant.uid} disabled className="w-full px-3 py-2 bg-[#F1F5F9] border border-[#E2E8F0] rounded-xl text-xs font-mono text-[#64748B] cursor-not-allowed" aria-label="Tenant identifier" />
          </div>
          <div>
            <label className={labelCls}>Accounting Reporting Currency</label>
            <select
              value={d.tenant.currency}
              onChange={async (e) => {
                await settingsService.updateTenant({ currency: e.target.value });
                saved(`Reporting currency set to ${e.target.value}`);
              }}
              className={fieldCls}
              aria-label="Reporting currency"
            >
              {d.options.currencies.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Primary Facility Timezone</label>
            <select
              value={d.tenant.timezone}
              onChange={async (e) => {
                await settingsService.updateTenant({ timezone: e.target.value });
                saved(`Timezone set to ${e.target.value}`);
              }}
              className={fieldCls}
              aria-label="Primary facility timezone"
            >
              {d.options.timezones.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>
      <Card className="space-y-4">
        <SectionTitle title="Data retention" description={d.policies.description} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl min-w-0">
            <label className="block font-bold text-[#141416] mb-1.5">Audit Log Retention</label>
            <select
              value={d.policies.auditRetention}
              onChange={async (e) => {
                await settingsService.updatePolicies({ auditRetention: e.target.value });
                saved(`Audit log retention set to ${e.target.value}`);
              }}
              className={`${fieldCls} bg-white`}
              aria-label="Audit log retention"
            >
              {d.options.auditRetention.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="p-4 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl min-w-0">
            <label className="block font-bold text-[#141416] mb-1.5">Raw Ingestion Payload Purge</label>
            <select
              value={d.policies.payloadPurge}
              onChange={async (e) => {
                await settingsService.updatePolicies({ payloadPurge: e.target.value });
                saved(`Raw payload purge set to ${e.target.value}`);
              }}
              className={`${fieldCls} bg-white`}
              aria-label="Raw ingestion payload purge"
            >
              {d.options.payloadPurge.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>
      </div>
    ),
    sites: (
      <Card className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <SectionTitle title="Sites" description="Facilities that receive customer returns, run diagnostic tests and stage parts harvest." />
          <RoleGate allowed={isAdmin}>
            <button onClick={() => setSiteForm({ ...EMPTY_SITE, manager: '', isNew: true })} disabled={!isAdmin} className={`${btnSecondary} self-start sm:self-auto shrink-0`}>
              <Plus size={14} />
              <span>Register Facility</span>
            </button>
          </RoleGate>
        </div>
        <DataTable<SiteRecord>
          rowKey="id"
          tableLayout="fixed"
          refreshing={q.loading}
          columns={siteColumns}
          dataSource={d.sites}
          pagination={false}
          onRowClick={isAdmin ? (s) => setSiteForm({ ...s, isNew: false }) : undefined}
          emptyTitle="No facilities"
          emptyDescription="Register a facility to start receiving returns."
        />
      </Card>
    ),
    notifications: (
      <Card className="space-y-2">
        <SectionTitle title="Alert Channels & Webhook Subscriptions" description="Configure real-time dispatch for warehouse bottlenecks, missed gates, and high-value approvals." />
        <div className="space-y-4 text-xs divide-y divide-[#E2E8F0]">
          <SettingRow title="Email Digest & Critical Notifications" description="Send immediate emails to case owners when evidence requests or approvals are required.">
            <Switch
              disabled={!isAdmin}
              checked={d.notifications.emailAlerts}
              aria-label="Email notifications"
              onChange={async (v) => {
                await settingsService.updateNotifications({ emailAlerts: v });
                saved(`Email notifications turned ${v ? 'on' : 'off'}`);
              }}
            />
          </SettingRow>
          <div className="space-y-2">
            <SettingRow title="Slack Operational Incident Webhook" description="Stream urgent exceptions directly into the #circularity-ops Slack channel.">
              <Switch
                disabled={!isAdmin}
                checked={d.notifications.slackAlerts}
                aria-label="Slack webhook"
                onChange={async (v) => {
                  await settingsService.updateNotifications({ slackAlerts: v });
                  saved(`Slack webhook turned ${v ? 'on' : 'off'}`);
                }}
              />
            </SettingRow>
            {d.notifications.slackAlerts && (
              <SaveOnBlur
                key={d.notifications.slackWebhookUrl}
                value={d.notifications.slackWebhookUrl}
                ariaLabel="Slack webhook URL"
                className="w-full px-3 py-2 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl text-xs font-mono text-[#141416] focus:outline-none focus:border-[#FFD600]"
                onSave={async (v) => {
                  if (!/^https:\/\/\S+$/.test(v.trim())) {
                    message.error('Enter an https:// webhook URL');
                    return;
                  }
                  await settingsService.updateNotifications({ slackWebhookUrl: v.trim() });
                  saved('Slack webhook URL saved');
                }}
              />
            )}
          </div>
        </div>
      </Card>
    ),
  });

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'profile', label: 'Profile', icon: <UserRound size={16} /> },
    { key: 'organisation', label: 'Organisation', icon: <Building size={16} /> },
    { key: 'sites', label: 'Sites', icon: <Warehouse size={16} /> },
    { key: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
  ];
  const body = data ? content(data) : null;

  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      {modalHolder}
      <PageHeader
        title="Settings"
        description="Your profile and notification preferences, then the organisation profile, sites and notification channels (Admin only). Changes save as you make them."
        actions={
          <PageActions
            secondary={[
              {
                key: 'reset',
                label: 'Reset to defaults',
                icon: <RotateCcw />,
                disabled: !data || !isAdmin,
                onClick: () => modal.confirm({ title: 'Restore all settings to the defaults?', okText: 'Restore', onOk: reset }),
              },
            ]}
          />
        }
      />

      {!isAdmin && activeTab !== 'profile' && <ReadOnlyNotice>Read-only. Only Admins can change platform settings.</ReadOnlyNotice>}

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as TabKey)}
        items={tabs.map((t) => ({
          key: t.key,
          label: t.label,
          icon: t.icon,
          children: t.key === 'profile' ? (
            <ProfileTab />
          ) : q.error ? (
            <ErrorState onRetry={q.refetch} />
          ) : q.initialLoading || !body ? (
            loadingCard
          ) : (
            // A disabled fieldset makes every native input, select and button read-only for non-Admins.
            <fieldset disabled={!isAdmin} className="m-0 p-0 border-0 min-w-0">
              {body[t.key as OrgTabKey]}
            </fieldset>
          ),
        }))}
      />

      <Modal
        open={!!siteForm && isAdmin}
        onCancel={() => setSiteForm(null)}
        title={
          <div className="flex items-center gap-2">
            <Warehouse className="w-4 h-4 text-amber-500" />
            <span className="font-bold text-sm">{siteForm?.isNew ? 'Register facility' : `Edit facility · ${siteForm?.id}`}</span>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setSiteForm(null)} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={saveSite} disabled={savingSite} className={btnPrimary}>
              {savingSite ? 'Saving…' : siteForm?.isNew ? 'Register facility' : 'Save changes'}
            </button>
          </div>
        }
      >
        {siteForm && (
          <div className="space-y-3 py-2 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Code</label>
                <input
                  value={siteForm.id}
                  disabled={!siteForm.isNew}
                  placeholder="Auto"
                  onChange={(e) => setSiteForm((f) => f && { ...f, id: e.target.value.toUpperCase() })}
                  className={`${fieldCls} font-mono disabled:text-[#94A3B8]`}
                  aria-label="Facility code"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Facility Name</label>
                <input value={siteForm.name} onChange={(e) => setSiteForm((f) => f && { ...f, name: e.target.value })} className={fieldCls} aria-label="Facility name" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Location</label>
                <input value={siteForm.location} onChange={(e) => setSiteForm((f) => f && { ...f, location: e.target.value })} className={fieldCls} aria-label="Location" />
              </div>
              <div>
                <label className={labelCls}>Facility Lead</label>
                <select value={siteForm.manager} onChange={(e) => setSiteForm((f) => f && { ...f, manager: e.target.value })} className={fieldCls} aria-label="Facility lead">
                  <option value="" disabled>
                    Choose a person
                  </option>
                  {people.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name} · {p.role}, {p.site}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Active Bays</label>
                <input
                  type="number"
                  min={0}
                  value={siteForm.baysCount}
                  onChange={(e) => setSiteForm((f) => f && { ...f, baysCount: Math.max(0, Number(e.target.value) || 0) })}
                  className={fieldCls}
                  aria-label="Active bays"
                />
              </div>
              <div>
                <label className={labelCls}>Staging Capacity (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={siteForm.capacityPct}
                  onChange={(e) => setSiteForm((f) => f && { ...f, capacityPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                  className={fieldCls}
                  aria-label="Staging capacity"
                />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
