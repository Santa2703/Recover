'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Drawer, Modal, Tabs, message } from 'antd';
import { Bot, Cog, UserCheck, PauseCircle, PlayCircle, Play, Save, Undo2 } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { mcpService, JOURNEY_STEPS, type RegistryEntry, type RegistryKind, type RegistryStatus } from '@/services/mcpService';
import { CaseLink, ListSkeleton } from '@/components/ui';
import { Btn, FactGrid, Pill, ResultPill, ScopeTag, SectionLabel, TitleWithIcon, absTime, fmtMs, relTime, type PillTone } from './mcpUi';
import { AgentPermissions, ReviewPermissionsModal, usePermChanges, type PermDraft } from './AgentPermissions';

export const KIND_META: Record<RegistryKind, { label: string; icon: React.ReactElement }> = {
  agent: { label: 'AI agent', icon: <Bot /> },
  service: { label: 'Service', icon: <Cog /> },
  control: { label: 'Human control', icon: <UserCheck /> },
};
export const STATUS_META: Record<RegistryStatus, { label: string; tone: PillTone }> = {
  active: { label: 'Active', tone: 'ok' },
  degraded: { label: 'Degraded', tone: 'medium' },
  paused: { label: 'Paused', tone: 'neutral' },
};

export function JourneySteps({ steps }: { steps: number[] }) {
  if (steps.length === JOURNEY_STEPS.length) return <span className="text-[11px] font-semibold text-[#475569]">All {steps.length} steps</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {steps.map((s) => (
        <span
          key={s}
          title={JOURNEY_STEPS.find((j) => j.id === s)?.label}
          className="w-6 h-6 rounded-full bg-[#FFD600] text-[#141416] font-bold flex items-center justify-center text-[11px] shadow-2xs"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

export function SystemChip({ name }: { name: string }) {
  return <span className="inline-flex max-w-full truncate rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-1.5 py-0.5 text-[10px] font-semibold text-[#475569]">{name}</span>;
}

export type AgentTab = 'overview' | 'permissions';

/**
 * Registry drawer for an agent, service or human control. MCP agents get a Permissions tab
 * with their tool × tenant grants (draft, then Review & save).
 */
export function AgentDetailDrawer({
  entry,
  tab,
  onTabChange,
  onClose,
  onChangeStatus,
}: {
  entry: RegistryEntry | null;
  tab: AgentTab;
  onTabChange: (t: AgentTab) => void;
  onClose: () => void;
  onChangeStatus: (e: RegistryEntry) => void;
}) {
  const router = useRouter();
  // The draft belongs to one agent; opening another agent starts clean (derived, no effect).
  const [draftState, setDraftState] = useState<{ agentId: string | null; draft: PermDraft }>({ agentId: null, draft: {} });
  const draft = entry && draftState.agentId === entry.id ? draftState.draft : {};
  const setDraft = (d: PermDraft) => setDraftState({ agentId: entry?.id ?? null, draft: d });
  const { changes } = usePermChanges(draft);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const mcp = useServiceQuery(() => (entry?.mcpId ? mcpService.agentDetail(entry.mcpId) : Promise.resolve(null)), [entry?.mcpId], {
    subscribe: mcpService.subscribeAgents,
  });
  const detail = entry?.mcpId && mcp.data?.agent.id === entry.mcpId ? mcp.data : null;
  const tools = useServiceQuery(() => mcpService.allTools(), [], { subscribe: mcpService.subscribeTools });
  const toolName = (id: string) => tools.data?.find((t) => t.id === id)?.name ?? id;

  const hasPerms = !!entry?.mcpId;
  const activeTab: AgentTab = hasPerms ? tab : 'overview';

  const close = () => {
    if (!changes.length) return onClose();
    Modal.confirm({
      title: 'Discard unsaved permission changes?',
      content: `${changes.length} change${changes.length === 1 ? '' : 's'} will be lost.`,
      okText: 'Discard',
      okButtonProps: { danger: true },
      onOk: () => {
        setDraft({});
        onClose();
      },
    });
  };

  const discard = () =>
    Modal.confirm({
      title: 'Discard unsaved changes?',
      content: `${changes.length} change${changes.length === 1 ? '' : 's'} across all tenants will be lost.`,
      okText: 'Discard',
      okButtonProps: { danger: true },
      onOk: () => {
        setDraft({});
        message.info('Changes discarded');
      },
    });

  const save = async () => {
    setSaving(true);
    try {
      const n = await mcpService.savePermissions(changes);
      setDraft({});
      setReviewOpen(false);
      message.success(`${n} permission change${n === 1 ? '' : 's'} saved`);
    } finally {
      setSaving(false);
    }
  };

  const footer =
    entry &&
    (activeTab === 'permissions' ? (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-[#64748B]">{changes.length ? `${changes.length} unsaved change${changes.length === 1 ? '' : 's'}` : 'No changes yet. Change a tool level to review and save.'}</span>
        <div className="flex items-center gap-2">
          <Btn icon={<Undo2 className="w-3.5 h-3.5" />} disabled={!changes.length} onClick={discard}>
            Discard
          </Btn>
          <Btn variant="primary" icon={<Save className="w-3.5 h-3.5" />} disabled={!changes.length} onClick={() => setReviewOpen(true)}>
            Review &amp; save{changes.length ? ` (${changes.length})` : ''}
          </Btn>
        </div>
      </div>
    ) : (
      (entry.kind !== 'control' || entry.mcpId) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {entry.kind !== 'control' ? (
            entry.status === 'paused' ? (
              <Btn icon={<PlayCircle className="w-3.5 h-3.5" />} onClick={() => onChangeStatus(entry)}>
                Resume
              </Btn>
            ) : (
              <Btn variant="danger" icon={<PauseCircle className="w-3.5 h-3.5" />} onClick={() => onChangeStatus(entry)}>
                Pause
              </Btn>
            )
          ) : (
            <span />
          )}
          {entry.mcpId && entry.tools.length > 0 && (
            <Btn
              variant="primary"
              icon={<Play className="w-3.5 h-3.5" />}
              onClick={() => router.push(`/mcp?playground=1&tool=${encodeURIComponent(entry.tools[0])}&agent=${encodeURIComponent(entry.mcpId!)}`)}
            >
              Test in playground
            </Btn>
          )}
        </div>
      )
    ));

  const overview = entry && (
    <div className="space-y-5 text-xs">
      <p className="m-0 leading-relaxed text-[#475569]">{entry.description}</p>
      {entry.status === 'paused' && entry.kind !== 'control' && (
        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-[#475569]">
          <div className="font-bold text-[#141416]">Paused</div>
          <div className="mt-0.5">{entry.statusReason ?? (entry.mcpId ? 'All tool calls from this agent are refused until it is resumed.' : 'New runs queue at this step until it is resumed.')}</div>
        </div>
      )}

      <FactGrid
        items={[
          { label: 'Status', value: <Pill tone={STATUS_META[entry.status].tone}>{STATUS_META[entry.status].label}</Pill> },
          { label: 'Last run', value: <span title={`${absTime(entry.lastRun)} UTC`}>{relTime(entry.lastRun)}</span> },
          { label: 'Runs in 24h', value: <span className="font-mono">{entry.runs24h}</span> },
          { label: 'Success rate', value: <span className="font-mono">{entry.successRate}%</span> },
          { label: 'Journey steps', value: <JourneySteps steps={entry.steps} /> },
          { label: 'Owner', value: entry.owner },
          ...(entry.version ? [{ label: 'Version', value: <span className="font-mono">v{entry.version}</span> }] : []),
          ...(entry.orchId ? [{ label: 'Model', value: entry.model ?? 'None (deterministic)' }] : []),
          ...(entry.mcpLimits
            ? [
                { label: 'Calls per hour', value: <span className="font-mono">{entry.mcpLimits.callsPerHour}</span> },
                { label: 'Writes per day', value: <span className="font-mono">{entry.mcpLimits.writesPerDay}</span> },
                { label: 'Max concurrent', value: <span className="font-mono">{entry.mcpLimits.maxConcurrent}</span> },
                { label: 'Timeout', value: <span className="font-mono">{entry.mcpLimits.timeoutSec}s</span> },
              ]
            : []),
        ]}
      />

      {entry.mcpId && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>MCP tools in manifest ({entry.tools.length})</SectionLabel>
            <button type="button" onClick={() => onTabChange('permissions')} className="mb-1.5 cursor-pointer text-[11px] font-semibold text-[#0284C7] hover:underline">
              Grants per tenant
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {entry.toolScopes.map((s) => (
              <ScopeTag key={s} scope={s} />
            ))}
            {entry.tools.map((t) => (
              <span key={t} className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#141416]">
                {toolName(t)}
              </span>
            ))}
          </div>
        </div>
      )}

      {entry.systems.length > 0 && (
        <div>
          <SectionLabel>Systems read</SectionLabel>
          <div className="flex flex-wrap gap-1">
            {entry.systems.map((s) => (
              <SystemChip key={s} name={s} />
            ))}
          </div>
        </div>
      )}
      {entry.scopes.length > 0 && (
        <div>
          <SectionLabel>Service scopes</SectionLabel>
          <div className="flex flex-wrap gap-1">
            {entry.scopes.map((s) => (
              <span key={s} className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 font-mono text-[11px]">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
      {entry.limits.length > 0 && (
        <div>
          <SectionLabel>Limits</SectionLabel>
          <ul className="m-0 pl-4 space-y-0.5 text-[#475569]">
            {entry.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {entry.kind === 'control' && (
        <div className="p-3 bg-[#FFFBEB] border border-[#FEF3C7] rounded-xl text-[11px] text-[#854D0E]">
          This is a human control point. It cannot be paused here; change who approves in{' '}
          <Link href="/access/delegations" className="font-bold underline text-[#854D0E]">
            Delegations
          </Link>
          .
        </div>
      )}

      {entry.mcpId && (
        <div>
          <SectionLabel>Recent tool calls</SectionLabel>
          {!detail ? (
            <ListSkeleton rows={3} />
          ) : detail.recent.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#E2E8F0] p-4 text-center text-[#94A3B8]">No calls recorded.</div>
          ) : (
            <div className="divide-y divide-[#F1F5F9] overflow-hidden rounded-xl border border-[#E2E8F0]">
              {detail.recent.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-[#F8FAFC]">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-[#141416] truncate">{c.toolName}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[#64748B]">
                      <span>{relTime(c.ts)}</span>
                      <span>{c.tenant}</span>
                      {c.caseId && <CaseLink id={c.caseId} />}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-[11px] text-[#64748B]">{fmtMs(c.latencyMs)}</span>
                    <ResultPill result={c.result} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <Drawer
        open={!!entry}
        onClose={close}
        size={640}
        destroyOnHidden
        title={
          entry ? (
            <TitleWithIcon
              icon={KIND_META[entry.kind].icon}
              title={entry.name}
              sub={`${KIND_META[entry.kind].label}${entry.version ? ` · v${entry.version}` : ''} · owner ${entry.owner}`}
            />
          ) : (
            'Agent'
          )
        }
        footer={footer}
      >
        {entry &&
          (hasPerms ? (
            <Tabs
              activeKey={activeTab}
              onChange={(k) => onTabChange(k as AgentTab)}
              items={[
                { key: 'overview', label: 'Overview', children: overview },
                {
                  key: 'permissions',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      Permissions
                      {changes.length > 0 && <span className="rounded-full bg-[#FFD600] px-1.5 text-[10px] font-extrabold text-[#141416]">{changes.length}</span>}
                    </span>
                  ),
                  children: detail ? <AgentPermissions agent={detail.agent} draft={draft} onDraftChange={setDraft} /> : <ListSkeleton rows={6} />,
                },
              ]}
            />
          ) : (
            overview
          ))}
      </Drawer>
      <ReviewPermissionsModal
        open={reviewOpen}
        changes={changes}
        saving={saving}
        onCancel={() => setReviewOpen(false)}
        onSave={save}
        agentName={(id) => (id === entry?.mcpId ? entry.name : id)}
        toolName={toolName}
      />
    </>
  );
}
