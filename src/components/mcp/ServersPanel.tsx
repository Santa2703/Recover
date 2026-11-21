'use client';

import React, { useState } from 'react';
import { Drawer, Form, Input, Modal, Select, message } from 'antd';
import { Plug, Unplug, Server, RefreshCw, Activity } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { BREAKPOINTS, useMediaQuery } from '@/hooks/useMediaQuery';
import { mcpService, type ConnectServerInput, type McpServer, type ServerStatus } from '@/services/mcpService';
import { DataTable, ProgressBar, type DataColumn } from '@/components/ui';
import { Btn, FactGrid, Pill, ScopeTag, TitleWithIcon, fmtMs, relTime, type PillTone } from './mcpUi';

export const SERVER_STATUS: Record<ServerStatus, { label: string; tone: PillTone }> = {
  connected: { label: 'Connected', tone: 'ok' },
  degraded: { label: 'Degraded', tone: 'medium' },
  disconnected: { label: 'Disconnected', tone: 'neutral' },
};

export const AUTH_TYPES = ['OAuth 2.0', 'API key', 'mTLS', 'Key pair', 'Service account'];
const TRANSPORTS = ['Streamable HTTP', 'SSE'];

/** Expanded row / phone drawer: connection facts and the tools the server exposes. */
function ServerDetail({ server: s }: { server: McpServer }) {
  return (
    <div className="space-y-3 p-2">
      <FactGrid
        items={[
          { label: 'Endpoint', value: <span className="break-all font-mono text-[11px]">{s.endpoint}</span> },
          { label: 'Authentication', value: s.authType },
          { label: 'Health', value: s.status === 'disconnected' ? '—' : `${s.health.toFixed(1)}% · ${fmtMs(s.latencyMs)}` },
          { label: 'Last activity', value: relTime(s.lastActivity) },
        ]}
      />
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] mb-1.5">
          Tools exposed by {s.name}
          {s.status === 'disconnected' && <span className="ml-2 normal-case tracking-normal font-semibold text-[#B91C1C]">Unavailable while disconnected</span>}
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {s.tools.map((t) => (
            <div key={t.name} className={`flex items-start justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 ${s.status === 'disconnected' ? 'opacity-60' : ''}`}>
              <div className="min-w-0">
                <div className="truncate font-mono text-xs font-bold text-[#141416]">{t.name}</div>
                <div className="text-[11px] text-[#64748B]">{t.description}</div>
              </div>
              <ScopeTag scope={t.scope} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Connected MCP servers (this workbench as MCP client) plus the Connect server dialog. */
export function ServersPanel({
  expanded,
  onExpandedChange,
  connectOpen,
  onConnectOpenChange,
}: {
  expanded: React.Key[];
  onExpandedChange: (keys: React.Key[]) => void;
  connectOpen: boolean;
  onConnectOpenChange: (open: boolean) => void;
}) {
  const isTablet = useMediaQuery(BREAKPOINTS.tablet);
  const [detailId, setDetailId] = useState<string | null>(null);
  const { data, initialLoading, loading } = useServiceQuery(() => mcpService.listServers(), [], { subscribe: mcpService.subscribeServers });
  const detail = data?.find((s) => s.id === detailId) ?? null;
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [form] = Form.useForm<ConnectServerInput>();

  const setBusyFor = (id: string, what: string | null) =>
    setBusy((b) => {
      const c = { ...b };
      if (what) c[id] = what;
      else delete c[id];
      return c;
    });

  const test = async (s: McpServer) => {
    setBusyFor(s.id, 'test');
    try {
      const r = await mcpService.testConnection(s.id);
      if (r.ok) message.success(`${s.name}: ${r.message}`);
      else message.error(r.message);
    } finally {
      setBusyFor(s.id, null);
    }
  };

  const disconnect = (s: McpServer) =>
    Modal.confirm({
      title: `Disconnect ${s.name}?`,
      content: `Agents lose access to its ${s.tools.length} tools until it is reconnected. Credentials are kept.`,
      okText: 'Disconnect',
      okButtonProps: { danger: true },
      onOk: async () => {
        await mcpService.disconnectServer(s.id);
        message.success(`${s.name} disconnected`);
      },
    });

  const reconnect = async (s: McpServer) => {
    setBusyFor(s.id, 'reconnect');
    try {
      await mcpService.reconnectServer(s.id);
      message.success(`${s.name} reconnected`);
    } finally {
      setBusyFor(s.id, null);
    }
  };

  const submitConnect = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return; // field errors are shown inline
    setConnecting(true);
    try {
      const s = await mcpService.connectServer(values);
      message.success(`${s.name} connected · ${s.tools.length} tools discovered`);
      onConnectOpenChange(false);
      form.resetFields();
      onExpandedChange([...expanded, s.id]);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const columns: DataColumn<McpServer>[] = [
    {
      title: 'Server',
      key: 'name',
      priority: 1,
      render: (_: unknown, s: McpServer) => (
        <div className="min-w-0">
          <span className="block truncate text-xs font-bold text-[#141416]">{s.name}</span>
          <span className="block truncate text-[11px] text-[#64748B]">
            {s.vendor} · {s.transport}
          </span>
          <span className="block truncate font-mono text-[11px] text-[#94A3B8]">{s.endpoint}</span>
        </div>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      priority: 1,
      width: 140,
      render: (_: unknown, s: McpServer) => (
        <div className="min-w-0">
          <Pill tone={SERVER_STATUS[s.status].tone}>{SERVER_STATUS[s.status].label}</Pill>
          <span className="mt-1 block truncate text-[11px] font-mono text-gray-500" data-tip="Last activity">
            {relTime(s.lastActivity)}
          </span>
        </div>
      ),
    },
    { title: 'Auth', dataIndex: 'authType', key: 'auth', priority: 3, width: 112, render: (v: string) => <span className="text-xs text-[#64748B]">{v}</span> },
    {
      title: 'Tools',
      key: 'tools',
      priority: 2,
      width: 64,
      align: 'right' as const,
      render: (_: unknown, s: McpServer) => <span className="font-mono text-xs font-bold">{s.tools.length}</span>,
    },
    {
      title: 'Health',
      key: 'health',
      priority: 3,
      width: 136,
      render: (_: unknown, s: McpServer) =>
        s.status === 'disconnected' ? (
          <span className="text-[11px] text-[#94A3B8]">—</span>
        ) : (
          <div className="min-w-0">
            <ProgressBar value={s.health} label={`${s.name} health`} tone={s.health >= 98 ? 'success' : 'warning'} />
            <div className="mt-0.5 truncate text-[11px] text-[#64748B]">
              <span className="font-mono font-bold text-[#141416]">{s.health.toFixed(1)}%</span> · {fmtMs(s.latencyMs)}
            </div>
          </div>
        ),
    },
    {
      title: '',
      key: 'actions',
      priority: 1,
      width: 184,
      ellipsis: false,
      align: 'right' as const,
      render: (_: unknown, s: McpServer) => (
        <div className="inline-flex flex-wrap items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Btn size="sm" icon={<Activity className="w-3 h-3" />} disabled={!!busy[s.id]} onClick={() => test(s)}>
            {busy[s.id] === 'test' ? 'Testing…' : 'Test'}
          </Btn>
          {s.status === 'disconnected' ? (
            <Btn size="sm" variant="primary" icon={<RefreshCw className="w-3 h-3" />} disabled={!!busy[s.id]} onClick={() => reconnect(s)}>
              {busy[s.id] === 'reconnect' ? 'Connecting…' : 'Reconnect'}
            </Btn>
          ) : (
            <Btn size="sm" variant="danger" icon={<Unplug className="w-3 h-3" />} disabled={!!busy[s.id]} onClick={() => disconnect(s)}>
              Disconnect
            </Btn>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-3 flex items-center gap-2 text-xs text-[#64748B]">
        <Server className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
        Expand a server to see the tools it exposes. Test runs initialize and tools/list against the endpoint.
      </div>
      <DataTable<McpServer>
        rowKey="id"
        tableLayout="fixed"
        columns={columns}
        dataSource={data ?? []}
        initialLoading={initialLoading}
        refreshing={loading && !initialLoading}
        pagination={false}
        emptyTitle="No servers connected"
        emptyDescription="Connect an enterprise MCP server to offer its tools to agents."
        onRowClick={isTablet ? undefined : (s) => setDetailId(s.id)}
        rowClassName={(s) => (expanded.includes(s.id) ? 'bg-[#FFFBEB]' : '')}
        expandable={{
          expandedRowKeys: expanded,
          onExpandedRowsChange: (keys) => onExpandedChange([...keys]),
          expandedRowRender: (s: McpServer) => <ServerDetail server={s} />,
        }}
      />

      {/* Phones: cards cannot expand, so the server's tools open in a drawer. */}
      <Drawer open={!!detail} onClose={() => setDetailId(null)} size={560} title={detail && <TitleWithIcon icon={<Server />} title={detail.name} sub={`${detail.vendor} · ${detail.transport}`} />}>
        {detail && <ServerDetail server={detail} />}
      </Drawer>

      <Modal
        open={connectOpen}
        onCancel={() => {
          onConnectOpenChange(false);
          form.resetFields();
        }}
        onOk={submitConnect}
        confirmLoading={connecting}
        okText={connecting ? 'Connecting…' : 'Connect'}
        okButtonProps={{ style: { backgroundColor: '#FFD600', color: '#141416', fontWeight: 'bold' } }}
        width={560}
        title={<TitleWithIcon icon={<Plug />} title="Connect an MCP server" sub="The workbench runs initialize and tools/list, then registers the discovered tools." />}
      >
        <Form form={form} layout="vertical" requiredMark className="pt-2" initialValues={{ transport: 'Streamable HTTP', authType: 'OAuth 2.0' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
            <Form.Item name="name" label="Display name" rules={[{ required: true, whitespace: true, message: 'Enter a name' }, { max: 60 }]}>
              <Input placeholder="e.g. Workday MCP" />
            </Form.Item>
            <Form.Item name="vendor" label="Vendor / system" rules={[{ required: true, whitespace: true, message: 'Enter the vendor' }]}>
              <Input placeholder="e.g. Workday" />
            </Form.Item>
          </div>
          <Form.Item
            name="endpoint"
            label="Endpoint URL"
            rules={[
              { required: true, message: 'Enter the endpoint' },
              { pattern: /^https:\/\/[^\s/$.?#].[^\s]*$/i, message: 'Must be an https:// URL' },
            ]}
          >
            <Input placeholder="https://mcp.example.com/v1" className="font-mono" />
          </Form.Item>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
            <Form.Item name="transport" label="Transport" rules={[{ required: true }]}>
              <Select options={TRANSPORTS.map((t) => ({ value: t, label: t }))} />
            </Form.Item>
            <Form.Item name="authType" label="Authentication" rules={[{ required: true }]}>
              <Select options={AUTH_TYPES.map((t) => ({ value: t, label: t }))} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  );
}
