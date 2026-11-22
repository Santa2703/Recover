'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Modal, Popover, Segmented, Select, Tabs, message } from 'antd';
import { BellRing, Clock, Info, Megaphone, ShieldAlert, UserPlus } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth, SESSION_USER } from '@/store/authContext';
import { setQueryParams, useQueryParam } from '@/components/integration/useQueryParam';
import { ALERT_TYPES, ALERT_TYPE_LABEL, alertService, canEscalate, type AlertType, type InboxAlert } from '@/services/alertService';
import { EscalateModal } from '@/components/command/EscalateModal';
import { durationLabel } from '@/services/sourceService';
import { commandService } from '@/services/commandService';
import { userService } from '@/services/userService';
import { DataTable, ErrorState, KpiSkeletonRow, MetricCard, PageHeader, Panel, SeverityBadge, StatusBadge, type DataColumn } from '@/components/ui';

type View = 'open' | 'acknowledged' | 'all';
type TypeTab = AlertType | 'all';

const AS_OF_MS = Date.parse(commandService.asOf());
const ageOf = (a: InboxAlert) => durationLabel(Math.max(0, (AS_OF_MS - Date.parse(a.firedAt)) / 6e4));

const btn =
  'inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-xl border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] no-underline hover:border-gray-400 disabled:cursor-wait disabled:opacity-50';
const iconBtn = 'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#475569] hover:border-gray-400 hover:text-[#141416]';

/** Alerts: one inbox of everything broken or overdue, derived live from the owning services. ?type=<alert type>&view=acknowledged|all */
export default function AlertsPage() {
  const { currentRole, scope } = useAuth();
  const typeParam = useQueryParam('type') as TypeTab | null;
  const viewParam = useQueryParam('view') as View | null;
  const type: TypeTab = typeParam && (typeParam === 'all' || ALERT_TYPES.some((t) => t.key === typeParam)) ? typeParam : 'all';
  const view: View = viewParam === 'acknowledged' || viewParam === 'all' ? viewParam : 'open';

  const q = useServiceQuery(() => alertService.inbox(currentRole, scope), [currentRole, scope.tenant], { subscribe: alertService.subscribe });
  const all = useMemo(() => q.data ?? [], [q.data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<InboxAlert | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [escalatingId, setEscalatingId] = useState<string | null>(null);
  const escalating = all.find((a) => a.id === escalatingId) ?? null;
  const people = userService.all();

  const inView = useMemo(() => all.filter((a) => (view === 'open' ? !a.acknowledged : view === 'acknowledged' ? a.acknowledged : true)), [all, view]);
  const rows = type === 'all' ? inView : inView.filter((a) => a.type === type);
  const countOf = (t: TypeTab) => (t === 'all' ? inView.length : inView.filter((a) => a.type === t).length);

  const open = all.filter((a) => !a.acknowledged);
  const high = open.filter((a) => a.severity === 'high');
  const oldest = open.reduce<InboxAlert | null>((m, a) => (!m || a.firedAt < m.firedAt ? a : m), null);

  const act = async (a: InboxAlert, fn: () => Promise<void>, done: string) => {
    setBusy(a.id);
    try {
      await fn();
      message.success(done);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveAssign = async () => {
    if (!assigning || !assignee) return;
    const a = assigning;
    setAssigning(null);
    await act(a, () => alertService.assign(a.id, assignee), `Assigned to ${assignee}`);
  };

  const columns: DataColumn<InboxAlert>[] = [
    {
      title: 'Alert',
      key: 'alert',
      priority: 1,
      render: (_, a) => (
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-[#141416]">{a.title}</div>
          <div className="truncate text-[11px] text-[#64748B]">
            {a.system} · {a.assignee ? `assigned to ${a.assignee}` : `owner ${a.owner}`} · {ageOf(a)} ago
          </div>
          <div className="truncate text-[11px] text-[#94A3B8]">{a.acknowledged ? `Acknowledged${a.acknowledgedBy ? ` by ${a.acknowledgedBy}` : ''} · ${a.detail}` : a.detail}</div>
          {a.escalatedAt && (
            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] font-semibold text-[#B45309]">
              <Megaphone size={12} className="shrink-0" />
              <span className="truncate">
                Escalated to {a.escalatedTo} · {a.escalatedAt.slice(0, 16).replace('T', ' ')} UTC{a.escalationCount > 1 ? ` · ${a.escalationCount} times` : ''}
              </span>
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Type',
      key: 'type',
      priority: 3,
      width: 130,
      render: (_, a) => (
        <StatusBadge tone="neutral" icon={false}>
          {ALERT_TYPE_LABEL[a.type]}
        </StatusBadge>
      ),
    },
    {
      title: 'Severity',
      key: 'severity',
      priority: 1,
      width: 100,
      render: (_, a) => <SeverityBadge severity={a.severity} />,
    },
    {
      title: 'Age',
      key: 'age',
      priority: 2,
      width: 80,
      align: 'right',
      render: (_, a) => <span className="font-mono text-xs text-[#334155]">{ageOf(a)}</span>,
    },
    {
      title: '',
      key: 'actions',
      priority: 1,
      align: 'right',
      width: 300,
      ellipsis: false,
      render: (_, a) => (
        <div className="inline-flex flex-wrap items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Link href={a.href} className={btn} aria-label={`${a.hrefLabel}: ${a.title}`}>
            Open
          </Link>
          {a.acknowledged ? (
            <button type="button" className={btn} disabled={busy === a.id} onClick={() => act(a, () => alertService.reopen(a.id), 'Alert reopened')}>
              Reopen
            </button>
          ) : (
            <button type="button" className={btn} disabled={busy === a.id} onClick={() => act(a, () => alertService.acknowledge(a.id, SESSION_USER.name), 'Alert acknowledged')}>
              Acknowledge
            </button>
          )}
          {canEscalate(a) && !a.acknowledged && (
            <button
              type="button"
              className={iconBtn}
              aria-label={`Escalate: ${a.title}`}
              data-tip={a.escalatedAt ? `Escalated to ${a.escalatedTo}. Escalate again` : `Escalate to ${alertService.ownerLabel(a)}`}
              onClick={() => setEscalatingId(a.id)}
            >
              <Megaphone size={14} />
            </button>
          )}
          <button
            type="button"
            className={iconBtn}
            aria-label={`Assign: ${a.title}`}
            data-tip="Assign"
            onClick={() => {
              setAssignee(a.assignee);
              setAssigning(a);
            }}
          >
            <UserPlus size={14} />
          </button>
          <Popover
            trigger="click"
            placement="bottomRight"
            title={<span className="text-xs font-extrabold">Why this fired</span>}
            content={
              <div className="max-w-[300px] space-y-2 text-xs text-[#334155]">
                <p className="m-0">{a.why}</p>
                <p className="m-0 text-[11px] text-[#64748B]">
                  {ALERT_TYPE_LABEL[a.type]} · fired {a.firedAt.slice(0, 16).replace('T', ' ')} UTC · seen by {a.roles.includes('Admin') ? a.roles.join(', ') : [...a.roles, 'Admin'].join(', ')}
                </p>
              </div>
            }
          >
            <button type="button" className={iconBtn} aria-label={`Explain: ${a.title}`} data-tip="Explain">
              <Info size={14} />
            </button>
          </Popover>
        </div>
      ),
    },
  ];

  const tabs: TypeTab[] = ['all', ...ALERT_TYPES.map((t) => t.key)];

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Alerts"
        description="Everything broken or overdue in one place: hand-off escalations, failing workflows, stale sources, expiring credentials, open conflicts and notifications. Acknowledge, assign or open each one."
      />

      {q.error && !q.data ? (
        <Panel>
          <ErrorState onRetry={q.refetch} />
        </Panel>
      ) : (
        <>
          {q.initialLoading ? (
            <KpiSkeletonRow count={3} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard label="Open alerts" value={open.length} context={`${all.length - open.length} acknowledged`} icon={<BellRing />} />
              <MetricCard label="High severity" value={high.length} context={high.length ? 'Clear these first' : 'Nothing high open'} icon={<ShieldAlert />} iconTone={high.length ? 'red' : 'green'} />
              <MetricCard label="Oldest open" value={oldest ? ageOf(oldest) : '-'} context={oldest ? <span className="block truncate">{oldest.title}</span> : 'No open alerts'} icon={<Clock />} />
            </div>
          )}

          <Panel flush>
            <div className="flex flex-col gap-2 px-5 pt-3 lg:flex-row lg:items-center lg:justify-between">
              <Tabs
                className="min-w-0 flex-1"
                activeKey={type}
                onChange={(k) => setQueryParams({ type: k === 'all' ? null : k })}
                items={tabs.map((t) => ({
                  key: t,
                  label: `${t === 'all' ? 'All' : ALERT_TYPE_LABEL[t]} (${countOf(t)})`,
                }))}
              />
              <Segmented<View>
                value={view}
                onChange={(v) => setQueryParams({ view: v === 'open' ? null : v })}
                aria-label="Alert status"
                className="self-start text-xs font-semibold lg:self-auto"
                options={[
                  { value: 'open', label: `Open (${open.length})` },
                  { value: 'acknowledged', label: 'Acknowledged' },
                  { value: 'all', label: 'All' },
                ]}
              />
            </div>
            <div className="px-5 pb-5">
              <DataTable<InboxAlert>
                columns={columns}
                dataSource={rows}
                rowKey="id"
                initialLoading={q.initialLoading}
                refreshing={q.loading && !q.initialLoading}
                pagination={rows.length > 12 ? { pageSize: 12, size: 'small', showSizeChanger: false } : false}
                emptyTitle={view === 'open' ? 'No open alerts here' : view === 'acknowledged' ? 'Nothing acknowledged yet' : 'No alerts'}
                emptyDescription={view === 'open' ? 'Everything in this group is running within its limits.' : undefined}
              />
            </div>
          </Panel>
        </>
      )}

      <EscalateModal alert={escalating} onClose={() => setEscalatingId(null)} />

      <Modal
        open={!!assigning}
        onCancel={() => setAssigning(null)}
        onOk={saveAssign}
        okText="Assign"
        okButtonProps={{ disabled: !assignee }}
        title={<span className="text-sm font-bold">Assign alert</span>}
      >
        {assigning && (
          <div className="space-y-3 py-2 text-xs">
            <p className="m-0 text-[#334155]">{assigning.title}</p>
            <label className="block text-xs font-semibold text-[#64748B]" htmlFor="alert-assignee">
              Owner
            </label>
            <Select
              id="alert-assignee"
              className="w-full"
              value={assignee ?? undefined}
              onChange={setAssignee}
              placeholder="Choose a person"
              showSearch={{ optionFilterProp: 'label' }}
              options={people.map((p) => ({
                value: p.name,
                label: `${p.name} · ${p.role}${p.tenant && p.tenant !== 'All' ? `, ${p.tenant}` : ''}`,
              }))}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
