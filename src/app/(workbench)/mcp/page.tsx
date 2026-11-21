'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Switch, message } from 'antd';
import { Power, ShieldAlert, Play, ScrollText } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { mcpService, TOOL_SERVERS, type McpToolRow, type ToolScope } from '@/services/mcpService';
import { DataTable, MetricCard, PageActions, PageHeader, type DataColumn } from '@/components/ui';
import { Btn, FilterCard, FilterField, MoreFilters, NativeSelect, ScopeTag, SearchBox, relTime, useUrlState } from '@/components/mcp/mcpUi';
import { ToolDetailDrawer } from '@/components/mcp/ToolDetailDrawer';
import { PlaygroundDrawer } from '@/components/mcp/PlaygroundDrawer';

type ScopeFilter = ToolScope | 'all';
type EnabledFilter = 'all' | 'enabled' | 'disabled';

export default function McpToolsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [server, setServer] = useState('all');
  const [enabled, setEnabled] = useState<EnabledFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ?playground=1&tool=<id>&agent=<id> opens the playground drawer (old /mcp/playground redirects here).
  const [url, setUrl] = useUrlState();
  const playgroundOpen = url.get('playground') === '1';
  const openPlayground = (toolId: string | null = null) => {
    setOpenId(null);
    setUrl({ playground: '1', tool: toolId, agent: null });
  };
  const closePlayground = () => setUrl({ playground: null, tool: null, agent: null });

  const { data, initialLoading, loading } = useServiceQuery(() => mcpService.listTools({ search, scope, server, enabled }), [search, scope, server, enabled], {
    subscribe: mcpService.subscribeTools,
  });
  const summary = useServiceQuery(() => mcpService.toolSummary(), [], { subscribe: mcpService.subscribeTools });
  const s = summary.data;

  const filtered = search !== '' || scope !== 'all' || server !== 'all' || enabled !== 'all';
  const clear = () => {
    setSearch('');
    setScope('all');
    setServer('all');
    setEnabled('all');
  };

  const toggle = async (row: McpToolRow, next: boolean) => {
    setBusyId(row.id);
    try {
      await mcpService.setToolEnabled(row.id, next);
      message.success(`${row.name} ${next ? 'enabled' : 'disabled'}`);
    } finally {
      setBusyId(null);
    }
  };

  const columns: DataColumn<McpToolRow>[] = [
    {
      title: 'Tool Name',
      dataIndex: 'name',
      key: 'name',
      priority: 1,
      ellipsis: false,
      render: (v: string, r: McpToolRow) => (
        <button type="button" onClick={() => setOpenId(r.id)} className="block w-full min-w-0 text-left cursor-pointer group" title={r.description}>
          <span className={`block truncate font-mono font-bold text-xs group-hover:underline ${r.enabled ? 'text-[#141414]' : 'text-[#94A3B8]'}`}>{v}</span>
          <span className="mt-0.5 whitespace-normal text-[11px] leading-snug text-[#64748B] line-clamp-2">
            <span className="font-semibold text-[#475569]">{r.server}</span> · {r.description}
          </span>
        </button>
      ),
    },
    {
      title: 'Safety Scope',
      dataIndex: 'scope',
      key: 'scope',
      priority: 1,
      width: 124,
      render: (v: ToolScope) => <ScopeTag scope={v} />,
    },
    {
      title: 'Last Invocations',
      dataIndex: 'lastUsed',
      key: 'lastUsed',
      priority: 2,
      width: 128,
      render: (v: string, r: McpToolRow) => (
        <div>
          <span className="block truncate text-xs font-mono text-gray-500">{relTime(v)}</span>
          <span className="block truncate text-[11px] text-[#94A3B8]">{r.calls24h} calls / 24h</span>
        </div>
      ),
    },
    {
      title: 'Enabled',
      key: 'enabled',
      priority: 1,
      width: 84,
      render: (_: unknown, r: McpToolRow) => (
        <Switch size="small" checked={r.enabled} loading={busyId === r.id} onChange={(next) => toggle(r, next)} aria-label={`Enable ${r.name}`} />
      ),
    },
    {
      title: '',
      key: 'actions',
      priority: 1,
      width: 132,
      align: 'right' as const,
      ellipsis: false,
      render: (_: unknown, r: McpToolRow) => (
        <div className="inline-flex items-center gap-1.5">
          <Btn size="sm" onClick={() => setOpenId(r.id)}>
            View
          </Btn>
          <Btn size="sm" icon={<Play className="w-3 h-3" />} onClick={() => openPlayground(r.id)}>
            Test
          </Btn>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Tools"
        description="MCP tools that agents can call, with their safety scope and whether writes are held at the gate. Open a tool for its schemas and recent executions, or test it in the playground. Disabled tools are refused for every agent."
        actions={
          <PageActions
            secondary={[{ key: 'calls', label: 'Call log', icon: <ScrollText />, onClick: () => router.push('/mcp/calls') }]}
            primary={{ key: 'playground', label: 'Open playground', icon: <Play />, onClick: () => openPlayground() }}
          />
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MetricCard label="Tools enabled" icon={<Power />} loading={!s} value={s ? `${s.enabled} of ${s.total}` : ''} context={s ? `${s.servers} source systems` : ''} />
        <MetricCard label="Write-gated tools" icon={<ShieldAlert />} iconTone="red" loading={!s} value={s?.writeGated ?? ''} context="Every write needs a human approval" />
      </div>

      <FilterCard
        search={<SearchBox value={search} onChange={setSearch} placeholder="Search tools, descriptions or servers (e.g. writeoff, SAP)" />}
        onClear={clear}
        canClear={filtered}
      >
        <NativeSelect<ScopeFilter>
          label="Safety scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'All scopes' },
            { value: 'read_only', label: 'read_only' },
            { value: 'compute', label: 'compute' },
            { value: 'write_gated', label: 'write_gated' },
          ]}
        />
        <NativeSelect
          label="Server"
          value={server}
          onChange={setServer}
          options={[{ value: 'all', label: 'All servers' }, ...TOOL_SERVERS.map((x) => ({ value: x, label: x }))]}
        />
        <MoreFilters active={enabled !== 'all' ? 1 : 0}>
          <FilterField label="Status">
            <NativeSelect<EnabledFilter>
              label="Status"
              value={enabled}
              onChange={setEnabled}
              className="w-full"
              options={[
                { value: 'all', label: 'All status' },
                { value: 'enabled', label: 'Enabled' },
                { value: 'disabled', label: 'Disabled' },
              ]}
            />
          </FilterField>
        </MoreFilters>
      </FilterCard>

      <section className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-2xs" aria-label="MCP tools">
        <DataTable<McpToolRow>
          rowKey="id"
          tableLayout="fixed"
          columns={columns}
          dataSource={data?.items ?? []}
          initialLoading={initialLoading}
          refreshing={loading && !initialLoading}
          filtered={filtered}
          onClearFilters={clear}
          pagination={false}
          rowClassName={(r) => (r.enabled ? '' : 'opacity-70')}
        />
      </section>

      <ToolDetailDrawer toolId={openId} onClose={() => setOpenId(null)} onTest={(id) => openPlayground(id)} />
      <PlaygroundDrawer open={playgroundOpen} toolId={url.get('tool')} agentId={url.get('agent')} onClose={closePlayground} />
    </div>
  );
}
