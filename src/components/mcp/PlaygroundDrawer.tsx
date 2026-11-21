'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Drawer, Select, message } from 'antd';
import { FlaskConical, Play, RotateCcw, Braces, History, CircleCheck, CircleX, Hourglass, Ban, Trash2 } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { mcpService, validateToolInput, TENANTS, TOOL_SERVERS, type McpAgent, type McpTool, type PlaygroundRun, type RunStatus } from '@/services/mcpService';
import { ListSkeleton, Skeleton } from '@/components/ui';
import { Btn, BtnLink, JsonBlock, Pill, RiskPill, ScopeTag, SectionLabel, TitleWithIcon, fmtMs, relTime, type PillTone } from './mcpUi';

const RUN_META: Record<RunStatus, { label: string; tone: PillTone; icon: React.ReactNode }> = {
  success: { label: 'Success', tone: 'ok', icon: <CircleCheck className="w-4 h-4 text-[#059669]" /> },
  error: { label: 'Error', tone: 'high', icon: <CircleX className="w-4 h-4 text-[#DC2626]" /> },
  held: { label: 'Held at gate', tone: 'medium', icon: <Hourglass className="w-4 h-4 text-[#D97706]" /> },
  denied: { label: 'Denied', tone: 'high', icon: <Ban className="w-4 h-4 text-[#DC2626]" /> },
};

/** Default agent for a tool: an active agent that declares it, else any that declares it, else the first. */
const agentFor = (agents: McpAgent[], toolId: string) =>
  agents.find((x) => x.status === 'active' && x.allowedTools.includes(toolId)) ?? agents.find((x) => x.allowedTools.includes(toolId)) ?? agents[0];

/**
 * Tool playground as a right-side drawer: call a tool as an agent and tenant with the same
 * checks as production (catalog status, agent status, manifest, tenant grant, write gate).
 */
export function PlaygroundDrawer({ open, toolId, agentId, onClose }: { open: boolean; toolId?: string | null; agentId?: string | null; onClose: () => void }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={720}
      destroyOnHidden
      title={<TitleWithIcon icon={<FlaskConical />} title="Tool playground" sub="Same checks as production: catalog, agent status, manifest, tenant grant and the write gate." />}
    >
      {/* Remount when the requested tool/agent changes so the form starts from that tool. */}
      {open && <PlaygroundBody key={`${toolId ?? ''}|${agentId ?? ''}`} toolHint={toolId ?? null} agentHint={agentId ?? null} />}
    </Drawer>
  );
}

function PlaygroundBody({ toolHint, agentHint }: { toolHint: string | null; agentHint: string | null }) {
  const tools = useServiceQuery(() => mcpService.allTools(), [], { subscribe: mcpService.subscribeTools });
  const agents = useServiceQuery(() => mcpService.allAgents(), [], { subscribe: mcpService.subscribeAgents });
  const perms = useServiceQuery(() => mcpService.getPermissions(), [], { subscribe: mcpService.subscribePerms });
  const runs = useServiceQuery(() => mcpService.listRuns(), [], { subscribe: mcpService.subscribeRuns });
  const topRef = useRef<HTMLDivElement>(null);

  const [pickedTool, setPickedTool] = useState<string | null>(null);
  const [pickedAgent, setPickedAgent] = useState<string | null>(null);
  const [tenant, setTenant] = useState(TENANTS[0]);
  const [inputDraft, setInputText] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PlaygroundRun | null>(null);

  // Derived selection: explicit pick, else the deep-link hint, else a sensible default.
  const hintedTool = tools.data?.find((t) => t.id === toolHint);
  const tool: McpTool | undefined = tools.data?.find((t) => t.id === pickedTool) ?? hintedTool ?? tools.data?.[0];
  const agent: McpAgent | undefined =
    agents.data?.find((a) => a.id === pickedAgent) ?? agents.data?.find((a) => a.id === agentHint) ?? (agents.data && tool ? agentFor(agents.data, tool.id) : undefined);
  const inputText = inputDraft ?? (tool ? JSON.stringify(tool.sampleInput, null, 2) : '');

  const pickTool = (id: string) => {
    const t = tools.data?.find((x) => x.id === id);
    if (!t) return;
    setPickedTool(id);
    setInputText(null);
    setResult(null);
    if (agent && !agent.allowedTools.includes(id)) {
      const better = agents.data?.find((x) => x.status === 'active' && x.allowedTools.includes(id));
      if (better) {
        setPickedAgent(better.id);
        message.info(`Switched agent to ${better.name}, which declares ${t.name}`);
      }
    }
  };

  const validation = useMemo(() => (tool ? validateToolInput(tool, inputText) : null), [tool, inputText]);
  const grant = perms.data?.find((p) => p.tenant === tenant && p.agentId === agent?.id && p.toolId === tool?.id)?.level ?? 'none';

  const checks =
    tool && agent
      ? [
          { ok: tool.enabled, label: tool.enabled ? 'Tool is enabled' : 'Tool is disabled in the catalog' },
          { ok: agent.status === 'active', label: agent.status === 'active' ? 'Agent is active' : 'Agent is paused' },
          { ok: agent.allowedTools.includes(tool.id), label: agent.allowedTools.includes(tool.id) ? 'Tool is in the agent manifest' : 'Tool is not in the agent manifest' },
          {
            ok: grant !== 'none' && (tool.scope !== 'write_gated' || grant === 'write_gated'),
            label: `${tenant} grant: ${grant === 'none' ? 'none' : grant === 'read' ? 'read' : 'write (gated)'}`,
          },
        ]
      : [];

  const run = async () => {
    if (!tool || !agent || !validation?.ok || !validation.value) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await mcpService.runTool({ toolId: tool.id, agentId: agent.id, tenant, input: validation.value });
      setResult(r);
      if (r.status === 'success') message.success(`${tool.name} returned in ${fmtMs(r.latencyMs)}`);
      else if (r.status === 'held') message.warning('Held at write gate: needs approval');
      else message.error(r.message);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const format = () => {
    try {
      setInputText(JSON.stringify(JSON.parse(inputText), null, 2));
    } catch {
      message.error('Fix the JSON before formatting');
    }
  };

  const loadRun = (r: PlaygroundRun) => {
    setPickedTool(r.toolId);
    setPickedAgent(r.agentId);
    setTenant(r.tenant);
    setInputText(JSON.stringify(r.input, null, 2));
    setResult(r);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const clearHistory = async () => {
    await mcpService.clearRuns();
    message.success('Run history cleared');
  };

  const toolName = (id: string) => tools.data?.find((t) => t.id === id)?.name ?? id;
  const agentName = (id: string) => agents.data?.find((a) => a.id === id)?.name ?? id;

  if (!tools.data || !agents.data || !tool || !agent) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div ref={topRef} className="space-y-5 text-xs">
      {toolHint && !hintedTool && <div className="rounded-xl border border-[#FEF3C7] bg-[#FFFBEB] px-3 py-2 text-[#92400E]">Tool &quot;{toolHint}&quot; was not found; showing {tool.name}.</div>}

      <section aria-label="Request" className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block min-w-0">
            <SectionLabel>Tool</SectionLabel>
            <Select
              className="w-full"
              showSearch={{ optionFilterProp: 'label' }}
              value={tool.id}
              onChange={pickTool}
              aria-label="Tool"
              popupMatchSelectWidth={false}
              options={TOOL_SERVERS.map((srv) => ({
                label: srv,
                title: srv,
                options: tools.data!.filter((t) => t.server === srv).map((t) => ({ value: t.id, label: t.name })),
              }))}
            />
          </label>
          <label className="block min-w-0">
            <SectionLabel>Agent</SectionLabel>
            <Select
              className="w-full"
              value={agent.id}
              onChange={(v) => {
                setPickedAgent(v);
                setResult(null);
              }}
              aria-label="Agent"
              popupMatchSelectWidth={false}
              options={agents.data.map((a) => ({ value: a.id, label: `${a.name}${a.status === 'suspended' ? ' (paused)' : ''}` }))}
            />
          </label>
          <label className="block min-w-0">
            <SectionLabel>Tenant</SectionLabel>
            <Select
              className="w-full"
              value={tenant}
              onChange={(v) => {
                setTenant(v);
                setResult(null);
              }}
              aria-label="Tenant"
              options={TENANTS.map((t) => ({ value: t, label: t }))}
            />
          </label>
        </div>

        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold">{tool.name}</span>
            <span className="text-[11px] text-[#64748B]">{tool.server}</span>
            <ScopeTag scope={tool.scope} />
            <RiskPill risk={tool.risk} />
            {tool.approvalRequired && <Pill tone="medium">Approval required</Pill>}
          </div>
          <p className="m-0 mt-1.5 text-xs text-[#475569]">{tool.description}</p>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {checks.map((c) => (
              <div key={c.label} className={`flex items-center gap-1.5 text-[11px] font-semibold ${c.ok ? 'text-[#047857]' : 'text-[#B91C1C]'}`}>
                {c.ok ? <CircleCheck className="w-3.5 h-3.5 shrink-0" /> : <CircleX className="w-3.5 h-3.5 shrink-0" />}
                {c.label}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>Input JSON</SectionLabel>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Btn size="sm" icon={<Braces className="w-3 h-3" />} onClick={format}>
                Format
              </Btn>
              <Btn size="sm" icon={<RotateCcw className="w-3 h-3" />} onClick={() => setInputText(null)}>
                Reset to sample
              </Btn>
            </div>
          </div>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            spellCheck={false}
            aria-label="Input JSON"
            rows={9}
            className={`w-full font-mono text-[11px] leading-relaxed p-3 bg-[#F8FAFC] border rounded-xl text-[#141416] focus:outline-none focus:bg-white transition-all resize-y ${
              validation?.ok ? 'border-[#E2E8F0] focus:border-[#FFD600]' : 'border-[#FCA5A5] focus:border-[#DC2626]'
            }`}
          />
          <div className="mt-1.5 min-h-[18px] text-[11px]">
            {validation?.ok ? (
              <span className="inline-flex items-center gap-1 font-semibold text-[#047857]">
                <CircleCheck className="w-3.5 h-3.5" /> Valid against input schema · required: {(tool.inputSchema.required ?? []).join(', ') || 'none'}
              </span>
            ) : (
              <ul className="m-0 list-none space-y-0.5 p-0 text-[#B91C1C] font-semibold">
                {validation?.errors.map((e) => (
                  <li key={e} className="flex items-center gap-1">
                    <CircleX className="w-3.5 h-3.5 shrink-0" /> {e}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Btn variant="primary" icon={<Play className="w-3.5 h-3.5" />} disabled={!validation?.ok || running} onClick={run}>
            {running ? 'Running…' : 'Run tool'}
          </Btn>
        </div>
      </section>

      <section aria-label="Response" className="border-t border-[#F1F5F9] pt-4">
        <SectionLabel>Response</SectionLabel>
        {running ? (
          <div className="space-y-3" aria-busy="true">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#64748B]">
              <span className="w-2 h-2 rounded-full bg-[#FFD600] animate-pulse" /> Calling {tool.server}…
            </div>
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : result ? (
          <div className="space-y-3" data-testid="playground-result">
            <div className="flex items-start gap-2.5">
              {RUN_META[result.status].icon}
              <div className="min-w-0">
                <div className="font-bold text-[#141416]">{result.message}</div>
                <div className="mt-0.5 text-[11px] text-[#64748B]">
                  <span className="font-mono">{toolName(result.toolId)}</span> as {agentName(result.agentId)} · {result.tenant}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={RUN_META[result.status].tone}>{RUN_META[result.status].label}</Pill>
              <span className="font-mono text-[11px] text-[#64748B]">{fmtMs(result.latencyMs)}</span>
              {result.callId && <span className="font-mono text-[11px] text-[#94A3B8]">{result.callId}</span>}
            </div>
            {result.status === 'held' && (
              <div className="rounded-xl border border-[#FEF3C7] bg-[#FFFBEB] p-3 text-[#92400E]">
                A pending call was added to the call log. An approver must release it before {toolName(result.toolId)} writes to {tool.server}.
                <div className="mt-2">
                  <BtnLink href="/mcp/calls" variant="secondary">
                    Review in call log
                  </BtnLink>
                </div>
              </div>
            )}
            <div>
              <SectionLabel>Output</SectionLabel>
              {result.output ? <JsonBlock value={result.output} maxHeight={280} /> : <div className="rounded-xl border border-dashed border-[#E2E8F0] p-4 text-center text-[#94A3B8]">No output</div>}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#E2E8F0] p-4 text-center text-[#64748B]">No run yet. Edit the input and press Run tool.</div>
        )}
      </section>

      <section aria-label="Session runs" className="border-t border-[#F1F5F9] pt-4">
        {runs.initialLoading ? (
          <ListSkeleton rows={2} />
        ) : !runs.data?.length ? (
          <p className="m-0 flex items-center gap-1.5 text-[#64748B]">
            <History className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
            <span>
              Runs from this session appear here to replay; every run is also recorded in the{' '}
              <Link href="/mcp/calls" className="font-semibold text-[#0284C7] hover:underline">
                call log
              </Link>
              .
            </span>
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>Session runs ({runs.data.length})</SectionLabel>
              <Btn size="sm" variant="ghost" icon={<Trash2 className="w-3 h-3" />} onClick={clearHistory} className="mb-1.5">
                Clear
              </Btn>
            </div>
            <ul className="m-0 list-none divide-y divide-[#F1F5F9] overflow-hidden rounded-xl border border-[#E2E8F0] p-0">
              {runs.data.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-[#F8FAFC]">
                  <div className="min-w-0">
                    <div className="truncate font-mono font-bold text-[#141416]">{toolName(r.toolId)}</div>
                    <div className="truncate text-[11px] text-[#64748B]">
                      {agentName(r.agentId)} · {r.tenant} · {relTime(r.ts)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Pill tone={RUN_META[r.status].tone}>{RUN_META[r.status].label}</Pill>
                    <Btn size="sm" onClick={() => loadRun(r)}>
                      Load
                    </Btn>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
