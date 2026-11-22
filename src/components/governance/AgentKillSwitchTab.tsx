'use client';

import React, { useState } from 'react';
import { Input, Modal, Switch, message } from 'antd';
import Link from 'next/link';
import { Bot, OctagonX, Play, ShieldAlert, Lock } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import { agentControlsService, HARD_RULES, type AgentControlRow } from '@/services/agentControlsService';
import { DataTable, type DataColumn } from '@/components/ui';
import { Card } from './Filters';
import { CardHeader, Pill, ReadOnlyNotice, RoleGate, btnSecondary, fmtDateTime } from './shared';

const btnDanger =
  'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#FECACA] hover:border-[#DC2626] rounded-xl text-xs font-extrabold text-[#B91C1C] shadow-2xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

type StopTarget = { kind: 'all' } | { kind: 'one'; row: AgentControlRow };

/** Agents & kill switches: every agent with its scopes and limits, a stop switch each, and Stop all agents. */
export function AgentKillSwitchTab() {
  const { user, isAdmin } = useAuth();
  const actor = { id: user.id, name: user.name, role: user.role };
  const q = useServiceQuery(() => agentControlsService.listAgents(), [], { subscribe: agentControlsService.subscribe });
  const rows = q.data?.rows ?? [];
  const emergency = q.data?.emergency ?? null;
  const runningCount = rows.filter((r) => r.status !== 'paused').length;
  const [stop, setStop] = useState<StopTarget | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const openStop = (t: StopTarget) => {
    setReason('');
    setStop(t);
  };

  const confirmStop = async () => {
    if (!stop) return;
    if (!reason.trim()) {
      message.error('Give a reason');
      return;
    }
    setBusy(stop.kind === 'all' ? 'all' : stop.row.id);
    try {
      if (stop.kind === 'all') {
        const n = await agentControlsService.stopAll(reason, actor);
        message.success(`${n} ${n === 1 ? 'agent' : 'agents'} stopped`);
      } else {
        await agentControlsService.setAgentRunning(stop.row, false, reason, actor);
        message.success(`${stop.row.name} stopped`);
      }
      setStop(null);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not stop');
    } finally {
      setBusy(null);
    }
  };

  const resume = async (row: AgentControlRow) => {
    setBusy(row.id);
    try {
      await agentControlsService.setAgentRunning(row, true, '', actor);
      message.success(`${row.name} resumed`);
    } finally {
      setBusy(null);
    }
  };

  const resumeAll = async () => {
    setBusy('all');
    try {
      const n = await agentControlsService.resumeAll(actor);
      message.success(`${n} ${n === 1 ? 'agent' : 'agents'} resumed`);
    } finally {
      setBusy(null);
    }
  };

  const columns: DataColumn<AgentControlRow>[] = [
    {
      title: 'Agent',
      key: 'name',
      priority: 1,
      render: (_: unknown, r: AgentControlRow) => (
        <div className="min-w-0">
          <div className="font-semibold text-[#141416] truncate">{r.name}</div>
          <div className="font-mono text-[10px] text-[#94A3B8] truncate">
            {r.id} · {r.owner}
          </div>
        </div>
      ),
    },
    {
      title: 'Scopes',
      key: 'scopes',
      priority: 2,
      ellipsis: false,
      render: (_: unknown, r: AgentControlRow) => <div className="font-mono text-[11px] text-[#475569] line-clamp-2">{r.scopeList.join(', ') || '—'}</div>,
    },
    {
      title: 'Limits',
      key: 'limits',
      priority: 2,
      ellipsis: false,
      render: (_: unknown, r: AgentControlRow) => <div className="text-[11px] text-[#475569] line-clamp-2">{r.limitText}</div>,
    },
    {
      title: 'Prepared',
      key: 'prepared',
      priority: 3,
      width: 96,
      align: 'right',
      render: (_: unknown, r: AgentControlRow) => (
        <span className="font-mono font-bold text-[#141416]" data-tip="Write-gated calls prepared and waiting for a person at the write gate">
          {r.prepared}
        </span>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      priority: 1,
      width: 170,
      ellipsis: false,
      render: (_: unknown, r: AgentControlRow) => {
        const on = r.status !== 'paused';
        return (
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="min-w-0">
              <Pill tone={on ? (r.status === 'degraded' ? 'amber' : 'green') : 'red'}>{on ? (r.status === 'degraded' ? 'Degraded' : 'Running') : 'Stopped'}</Pill>
              {!on && r.statusReason && <div className="text-[10px] text-[#94A3B8] truncate mt-0.5">{r.statusReason}</div>}
              {!on && !r.statusReason && r.stoppedByEmergency && <div className="text-[10px] text-[#94A3B8] truncate mt-0.5">Emergency stop</div>}
            </div>
            <RoleGate allowed={isAdmin}>
              <Switch
                size="small"
                checked={on}
                disabled={!isAdmin}
                loading={busy === r.id}
                onChange={(v) => (v ? resume(r) : openStop({ kind: 'one', row: r }))}
                aria-label={`${on ? 'Stop' : 'Start'} ${r.name}`}
              />
            </RoleGate>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {!isAdmin && <ReadOnlyNotice>Read-only. Only Admins can stop or start agents.</ReadOnlyNotice>}

      {emergency && (
        <div role="alert" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-[#FECACA] bg-[#FEF2F2]">
          <div className="flex items-start gap-2.5 min-w-0">
            <ShieldAlert className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" />
            <div className="min-w-0 text-xs">
              <div className="font-extrabold text-[#B91C1C]">Emergency stop is on</div>
              <div className="text-[#475569]">
                {rows.filter((r) => r.stoppedByEmergency).length} agents stopped by {emergency.by}, {fmtDateTime(emergency.at)}. Reason: {emergency.reason}. Resume them one by one or all
                at once; agents that were already stopped stay stopped.
              </div>
            </div>
          </div>
          <RoleGate allowed={isAdmin}>
            <button onClick={resumeAll} disabled={!isAdmin || busy === 'all'} className={`${btnSecondary} shrink-0`}>
              <Play className="w-3.5 h-3.5" /> {busy === 'all' ? 'Resuming…' : 'Resume all'}
            </button>
          </RoleGate>
        </div>
      )}

      <Card>
        <CardHeader
          icon={<Bot />}
          title="Agents and kill switches"
          description={
            <>
              Each agent acts as the signed-in person and never has more rights. Services and control points are in the{' '}
              <Link href="/mcp/agents" className="font-semibold text-[#141416] underline">
                agent registry
              </Link>
              .
            </>
          }
          right={
            <RoleGate allowed={isAdmin}>
              <button onClick={() => openStop({ kind: 'all' })} disabled={!isAdmin || runningCount === 0 || q.initialLoading} className={btnDanger}>
                <OctagonX className="w-3.5 h-3.5" /> Stop all agents
              </button>
            </RoleGate>
          }
        />
        <div className="pt-3">
          <DataTable<AgentControlRow>
            rowKey="id"
            tableLayout="fixed"
            initialLoading={q.initialLoading}
            refreshing={q.loading}
            columns={columns}
            dataSource={rows}
            pagination={false}
            emptyTitle="No agents registered"
          />
        </div>
      </Card>

      <Card>
        <CardHeader icon={<Lock />} title="Hard rules (never configurable)" description="These hold for every agent, role and autonomy setting. No one can turn them off." />
        <ul className="pt-3 m-0 pl-0 list-none grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {HARD_RULES.map((r) => (
            <li key={r} className="flex items-start gap-2 text-xs text-[#141416] min-w-0">
              <Lock className="w-3.5 h-3.5 text-[#94A3B8] shrink-0 mt-0.5" />
              <span className="min-w-0">{r}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Modal
        open={!!stop}
        onCancel={() => setStop(null)}
        title={
          <div className="flex items-center gap-2">
            <OctagonX className="w-4 h-4 text-[#DC2626]" />
            <span className="font-bold text-sm">{stop?.kind === 'all' ? 'Stop all agents?' : `Stop ${stop?.kind === 'one' ? stop.row.name : ''}?`}</span>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setStop(null)} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={confirmStop} disabled={!reason.trim() || !!busy} className={btnDanger}>
              {busy ? 'Stopping…' : stop?.kind === 'all' ? `Stop ${runningCount} agents` : 'Stop agent'}
            </button>
          </div>
        }
      >
        <div className="space-y-3 py-2 text-xs text-[#475569]">
          <p className="m-0">
            {stop?.kind === 'all'
              ? `Every running agent (${runningCount}) stops at once: no new tool calls, prepared work stays at the write gate. Resume them one by one or with Resume all.`
              : 'The agent makes no new tool calls until it is started again. Work it prepared stays at the write gate.'}
          </p>
          <div>
            <span className="block text-[11px] font-bold text-[#64748B] mb-1">Reason (goes to the audit log)</span>
            <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Unexpected writes to the WMS" aria-label="Reason" autoFocus />
          </div>
        </div>
      </Modal>
    </div>
  );
}
