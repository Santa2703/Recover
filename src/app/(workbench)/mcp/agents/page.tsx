'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, CircleCheck, AlertTriangle, Activity, ShieldAlert, Play } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { mcpService, JOURNEY_STEPS, type RegistryEntry, type RegistryKind, type RegistryStatus } from '@/services/mcpService';
import { DataTable, ErrorState, MetricCard, PageActions, PageHeader, Panel, type DataColumn } from '@/components/ui';
import { Btn, FilterCard, FilterField, MoreFilters, NativeSelect, Pill, ScopeTag, SearchBox, relTime, useUrlState } from '@/components/mcp/mcpUi';
import { AgentDetailDrawer, JourneySteps, KIND_META, STATUS_META, SystemChip, type AgentTab } from '@/components/mcp/AgentDetailDrawer';
import { AgentStatusModal } from '@/components/mcp/AgentStatusModal';

type KindFilter = RegistryKind | 'all';
type StatusFilter = RegistryStatus | 'all';

export default function AgentRegistryPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [step, setStep] = useState('all');
  const [statusEntry, setStatusEntry] = useState<RegistryEntry | null>(null);

  const q = useServiceQuery(() => mcpService.listRegistry({ search, kind, status, step: step === 'all' ? 'all' : Number(step) }), [search, kind, status, step], {
    subscribe: mcpService.subscribeRegistry,
  });
  const allQ = useServiceQuery(() => mcpService.listRegistry(), [], { subscribe: mcpService.subscribeRegistry });
  const all = allQ.data;

  // Deep links: ?agent=<id>&tab=permissions. ?tab=permissions alone opens the first MCP agent's grants
  // (old /mcp/perms redirects here).
  const [url, setUrl] = useUrlState();
  const tab: AgentTab = url.get('tab') === 'permissions' ? 'permissions' : 'overview';
  const agentParam = url.get('agent');
  const openId = agentParam ?? (tab === 'permissions' ? (all?.find((a) => a.mcpId)?.id ?? null) : null);
  const selected = all?.find((a) => a.id === openId) ?? null;
  const openEntry = (id: string, t: AgentTab = 'overview') => setUrl({ agent: id, tab: t === 'overview' ? null : t });

  const filtered = search !== '' || kind !== 'all' || status !== 'all' || step !== 'all';
  const clear = () => {
    setSearch('');
    setKind('all');
    setStatus('all');
    setStep('all');
  };

  const columns: DataColumn<RegistryEntry>[] = [
    {
      title: 'Agent / service',
      key: 'name',
      priority: 1,
      ellipsis: false,
      render: (_: unknown, a: RegistryEntry) => (
        <button type="button" onClick={() => openEntry(a.id)} className="flex w-full min-w-0 items-start gap-2 text-left cursor-pointer group">
          <span className={`mt-0.5 shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5 ${a.kind === 'agent' ? 'text-amber-500' : 'text-[#64748B]'}`}>{KIND_META[a.kind].icon}</span>
          <span className="min-w-0">
            <span className="block truncate font-bold text-xs text-[#141416] group-hover:underline">{a.name}</span>
            <span className="block text-[11px] text-[#64748B] mt-0.5 whitespace-normal line-clamp-2">
              <span className="font-semibold text-[#475569]">{KIND_META[a.kind].label}</span> · {a.description}
            </span>
          </span>
        </button>
      ),
    },
    { title: 'Journey steps', key: 'steps', priority: 3, width: 120, ellipsis: false, render: (_: unknown, a: RegistryEntry) => <JourneySteps steps={a.steps} /> },
    {
      title: 'Tools / systems',
      key: 'access',
      priority: 2,
      width: 170,
      ellipsis: false,
      render: (_: unknown, a: RegistryEntry) =>
        a.mcpId ? (
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#141416]">{a.tools.length} MCP tools</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {a.toolScopes.map((s) => (
                <ScopeTag key={s} scope={s} />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap gap-1">
            {a.systems.map((s) => (
              <SystemChip key={s} name={s} />
            ))}
          </div>
        ),
    },
    {
      title: 'Status',
      key: 'status',
      priority: 1,
      width: 130,
      render: (_: unknown, a: RegistryEntry) => (
        <div className="min-w-0">
          <Pill tone={STATUS_META[a.status].tone}>{STATUS_META[a.status].label}</Pill>
          <span className="mt-1 block truncate text-[11px] text-[#94A3B8]" data-tip={`${a.runs24h} runs in 24h · ${a.successRate}% ok`}>
            {relTime(a.lastRun)} · {a.successRate}% ok
          </span>
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      priority: 1,
      width: 132,
      ellipsis: false,
      align: 'right' as const,
      render: (_: unknown, a: RegistryEntry) => (
        <div className="inline-flex items-center gap-1.5">
          <Btn size="sm" onClick={() => openEntry(a.id)}>
            View
          </Btn>
          {a.kind !== 'control' &&
            (a.status === 'paused' ? (
              <Btn size="sm" variant="primary" onClick={() => setStatusEntry(a)}>
                Resume
              </Btn>
            ) : (
              <Btn size="sm" variant="danger" onClick={() => setStatusEntry(a)}>
                Pause
              </Btn>
            ))}
        </div>
      ),
    },
  ];

  const running = all?.filter((a) => a.status === 'active').length;
  const attention = all?.filter((a) => a.status !== 'active') ?? [];
  const runs = all?.reduce((s, a) => s + a.runs24h, 0);
  const writers = all?.filter((a) => a.toolScopes.includes('write_gated')).length;

  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Agents"
        description="Every AI agent, service and human control in the journey: the steps it works on, the tools and systems it uses, its grants per tenant and whether it is running."
        actions={<PageActions primary={{ key: 'playground', label: 'Open playground', icon: <Play />, onClick: () => router.push('/mcp?playground=1') }} />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard label="Running" icon={<CircleCheck />} iconTone="green" loading={!all} value={running ?? ''} context={all ? `of ${all.length} registered` : ''} />
        <MetricCard
          label="Paused or degraded"
          icon={<AlertTriangle />}
          iconTone="red"
          loading={!all}
          value={attention.length}
          context={<span className="block truncate">{attention.map((a) => a.name).join(', ') || 'All running'}</span>}
        />
        <MetricCard label="Runs in 24h" icon={<Activity />} loading={!all} value={runs ?? ''} context="All agents and services" />
        <MetricCard label="Write-capable agents" icon={<ShieldAlert />} loading={!all} value={writers ?? ''} context="Writes always pass the gate" href="/mcp/calls" />
      </div>

      <FilterCard search={<SearchBox value={search} onChange={setSearch} placeholder="Search name, owner, tool, system or scope" />} onClear={clear} canClear={filtered}>
        <NativeSelect<KindFilter>
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All kinds' },
            { value: 'agent', label: 'AI agents' },
            { value: 'service', label: 'Services' },
            { value: 'control', label: 'Human controls' },
          ]}
        />
        <MoreFilters active={(status !== 'all' ? 1 : 0) + (step !== 'all' ? 1 : 0)}>
          <FilterField label="Status">
            <NativeSelect<StatusFilter>
              label="Status"
              value={status}
              onChange={setStatus}
              className="w-full"
              options={[
                { value: 'all', label: 'All status' },
                { value: 'active', label: 'Active' },
                { value: 'degraded', label: 'Degraded' },
                { value: 'paused', label: 'Paused' },
              ]}
            />
          </FilterField>
          <FilterField label="Journey step">
            <NativeSelect
              label="Journey step"
              value={step}
              onChange={setStep}
              className="w-full"
              options={[{ value: 'all', label: 'All journey steps' }, ...JOURNEY_STEPS.map((j) => ({ value: String(j.id), label: `${j.id} · ${j.label}` }))]}
            />
          </FilterField>
        </MoreFilters>
      </FilterCard>

      <Panel icon={<Bot />} title="Registry" description="Open an entry for its limits, recent activity and, for MCP agents, tool grants per tenant. Pausing refuses its calls or queues its steps.">
        {q.error ? (
          <ErrorState onRetry={q.refetch} compact />
        ) : (
          <DataTable<RegistryEntry>
            rowKey="id"
            tableLayout="fixed"
            columns={columns}
            dataSource={q.data ?? []}
            initialLoading={q.initialLoading}
            refreshing={q.loading && !q.initialLoading}
            filtered={filtered}
            onClearFilters={clear}
            pagination={false}
          />
        )}
      </Panel>

      <AgentDetailDrawer
        entry={selected}
        tab={tab}
        onTabChange={(t) => setUrl({ agent: selected?.id ?? null, tab: t === 'overview' ? null : t })}
        onClose={() => setUrl({ agent: null, tab: null })}
        onChangeStatus={setStatusEntry}
      />
      <AgentStatusModal entry={statusEntry} onClose={() => setStatusEntry(null)} />
    </div>
  );
}
