'use client';

import React, { useMemo, useState } from 'react';
import { Checkbox, Modal } from 'antd';
import { ArrowRight, ChevronDown, Save } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { mcpService, TENANTS, TOOL_SERVERS, type McpAgent, type McpTool, type PermChange, type PermLevel } from '@/services/mcpService';
import { ListSkeleton } from '@/components/ui';
import { Pill, PillToggle, TitleWithIcon } from './mcpUi';

/** Draft of unsaved grants, keyed `tenant|agentId|toolId`. */
export type PermDraft = Record<string, PermLevel>;
const key = (tenant: string, agentId: string, toolId: string) => `${tenant}|${agentId}|${toolId}`;

export function LevelPill({ level }: { level: PermLevel }) {
  if (level === 'read')
    return (
      <Pill tone="info" dot={false}>
        Read
      </Pill>
    );
  if (level === 'write_gated')
    return (
      <Pill tone="medium" dot={false}>
        Write · gated
      </Pill>
    );
  return <span className="text-[11px] font-semibold text-[#94A3B8]">None</span>;
}

const LEVEL_OPTIONS: { value: PermLevel; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'read', label: 'Read' },
  { value: 'write_gated', label: 'Write · gated' },
];
const ACTIVE_TONE: Record<PermLevel, string> = {
  none: 'bg-[#141416] text-white',
  read: 'bg-[#E0F2FE] text-[#0284C7]',
  write_gated: 'bg-[#FEF3C7] text-[#D97706]',
};
const SCOPE_DOT: Record<string, string> = { write_gated: 'bg-[#DC2626]', compute: 'bg-[#7C3AED]', read_only: 'bg-[#059669]' };

/** The permission cell: None / Read / Write (gated). Write is only offered for write_gated tools. */
function LevelControl({ tool, agent, value, changed, onChange }: { tool: McpTool; agent: McpAgent; value: PermLevel; changed: boolean; onChange: (v: PermLevel) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label={`${agent.name} on ${tool.name}`}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#F1F5F9] p-0.5 text-[11px] font-semibold ${changed ? 'ring-2 ring-[#FFD600]' : ''}`}
    >
      {LEVEL_OPTIONS.filter((o) => o.value !== 'write_gated' || tool.scope === 'write_gated').map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-full px-2.5 py-0.5 transition-all cursor-pointer ${value === o.value ? ACTIVE_TONE[o.value] : 'text-[#64748B] hover:text-[#141416]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Saved grants as a map, plus the draft turned into a change list. */
export function usePermChanges(draft: PermDraft) {
  const perms = useServiceQuery(() => mcpService.getPermissions(), [], { subscribe: mcpService.subscribePerms });
  const saved = useMemo(() => {
    const m: Record<string, PermLevel> = {};
    perms.data?.forEach((p) => (m[p.id] = p.level));
    return m;
  }, [perms.data]);
  const changes: PermChange[] = useMemo(
    () =>
      Object.entries(draft).map(([id, to]) => {
        const [tenant, agentId, toolId] = id.split('|');
        return { tenant, agentId, toolId, from: saved[id] ?? 'none', to };
      }),
    [draft, saved],
  );
  return { saved, changes, loading: perms.initialLoading };
}

/** Agent × tool × tenant grants for one MCP agent. The draft lives in the parent so its footer can review and save. */
export function AgentPermissions({ agent, draft, onDraftChange }: { agent: McpAgent; draft: PermDraft; onDraftChange: (d: PermDraft) => void }) {
  const tools = useServiceQuery(() => mcpService.allTools(), [], { subscribe: mcpService.subscribeTools });
  const { saved, changes, loading } = usePermChanges(draft);
  const [tenant, setTenant] = useState(TENANTS[0]);
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const changesFor = (tn: string) => changes.filter((c) => c.tenant === tn).length;
  const levelOf = (toolId: string) => {
    const id = key(tenant, agent.id, toolId);
    return draft[id] ?? saved[id] ?? 'none';
  };
  const setLevel = (tool: McpTool, next: PermLevel) => {
    const id = key(tenant, agent.id, tool.id);
    const copy = { ...draft };
    if (next === (saved[id] ?? 'none')) delete copy[id];
    else copy[id] = next;
    onDraftChange(copy);
  };

  if (loading || !tools.data) return <ListSkeleton rows={6} />;

  const granted = agent.allowedTools.filter((t) => levelOf(t) !== 'none').length;
  const groups = TOOL_SERVERS.map((server) => ({
    server,
    tools: tools.data!.filter((t) => t.server === server && (showAll || agent.allowedTools.includes(t.id))),
  })).filter((g) => g.tools.length > 0);

  return (
    <div className="space-y-4 text-xs">
      <p className="m-0 text-[#475569]">
        Which tools {agent.name} may call, per tenant. Write (gated) is only offered for write_gated tools, and every write is held at the gate for approval. Tools outside the agent manifest cannot be
        granted.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillToggle
          label="Tenant"
          value={tenant}
          onChange={setTenant}
          options={TENANTS.map((t) => ({
            value: t,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t}
                {changesFor(t) > 0 && <span className="rounded-full bg-[#FFD600] px-1.5 text-[10px] font-extrabold text-[#141416]">{changesFor(t)}</span>}
              </span>
            ),
          }))}
        />
        <Checkbox checked={showAll} onChange={(e) => setShowAll(e.target.checked)}>
          <span className="text-xs font-semibold text-[#64748B]">Show tools outside the manifest</span>
        </Checkbox>
      </div>
      <div className="text-[11px] text-[#64748B]">
        <span className="font-mono font-bold text-[#141416]">{granted}</span> of {agent.allowedTools.length} manifest tools granted in {tenant}
      </div>

      {!groups.length ? (
        <div className="py-6 text-center text-[#94A3B8]">This agent declares no tools.</div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const isCollapsed = !!collapsed[g.server];
            return (
              <section key={g.server} className="overflow-hidden rounded-xl border border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [g.server]: !isCollapsed }))}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between gap-2 bg-[#F8FAFC] px-3 py-2 text-left cursor-pointer"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    {g.server} <span className="font-semibold normal-case tracking-normal text-[#94A3B8]">· {g.tools.length} tool{g.tools.length === 1 ? '' : 's'}</span>
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 text-[#94A3B8] transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                </button>
                {!isCollapsed && (
                  <ul className="m-0 list-none divide-y divide-[#F1F5F9] p-0">
                    {g.tools.map((t) => {
                      const declared = agent.allowedTools.includes(t.id);
                      return (
                        <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2 hover:bg-[#F8FAFC]">
                          <div className="min-w-0 flex-1 basis-48">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SCOPE_DOT[t.scope]}`} aria-hidden />
                              <span className={`truncate font-mono text-xs font-bold ${t.enabled ? 'text-[#141416]' : 'text-[#94A3B8] line-through'}`}>{t.name}</span>
                            </div>
                            <div className="truncate text-[11px] text-[#64748B]">{t.description}</div>
                          </div>
                          {declared ? (
                            <LevelControl tool={t} agent={agent} value={levelOf(t.id)} changed={key(tenant, agent.id, t.id) in draft} onChange={(v) => setLevel(t, v)} />
                          ) : (
                            <span className="text-[11px] font-semibold text-[#94A3B8]">Not in agent manifest</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Review & save dialog for a permission draft. */
export function ReviewPermissionsModal({
  open,
  changes,
  saving,
  onCancel,
  onSave,
  agentName,
  toolName,
}: {
  open: boolean;
  changes: PermChange[];
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  agentName: (id: string) => string;
  toolName: (id: string) => string;
}) {
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      onOk={onSave}
      confirmLoading={saving}
      okText={`Save ${changes.length} change${changes.length === 1 ? '' : 's'}`}
      okButtonProps={{ style: { backgroundColor: '#FFD600', color: '#141416', fontWeight: 'bold' } }}
      width={620}
      title={<TitleWithIcon icon={<Save />} title="Review permission changes" sub="Saved changes apply to the next tool call and are recorded in the audit log." />}
    >
      <div className="space-y-3 py-2">
        {TENANTS.filter((tn) => changes.some((c) => c.tenant === tn)).map((tn) => (
          <div key={tn}>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] mb-1.5">{tn}</div>
            <div className="divide-y divide-[#F1F5F9] overflow-hidden rounded-xl border border-[#E2E8F0]">
              {changes
                .filter((c) => c.tenant === tn)
                .map((c) => (
                  <div key={`${c.agentId}|${c.toolId}`} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-semibold text-[#141416]">{agentName(c.agentId)}</div>
                      <div className="font-mono text-[11px] text-[#64748B]">{toolName(c.toolId)}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <LevelPill level={c.from} />
                      <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8]" />
                      <LevelPill level={c.to} />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
