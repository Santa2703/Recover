'use client';

import React, { useState } from 'react';
import { Drawer, Input, Modal, message } from 'antd';
import { ScrollText, Activity, Hourglass, TriangleAlert, Timer, Download, Check, X, ShieldCheck, ShieldX } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { BREAKPOINTS, useMediaQuery } from '@/hooks/useMediaQuery';
import { mcpService, TENANTS, type CallQuery, type CallResult, type GateStatus, type McpCallRow } from '@/services/mcpService';
import { CaseLink, DataTable, MetricCard, PageActions, PageHeader, Panel, type DataColumn } from '@/components/ui';
import {
  Btn,
  FactGrid,
  FilterCard,
  FilterField,
  GATE_META,
  GatePill,
  JsonBlock,
  MoreFilters,
  NativeSelect,
  RESULT_META,
  ResultPill,
  SearchBox,
  SectionLabel,
  TitleWithIcon,
  absTime,
  fmtMs,
  relTime,
} from '@/components/mcp/mcpUi';

const PAGE_SIZE = 15;
type ResultFilter = CallResult | 'all';
type GateFilter = GateStatus | 'all';

/** Expanded row / phone drawer: everything the narrow columns leave out. */
function CallDetail({ call: c }: { call: McpCallRow }) {
  return (
    <div className="space-y-3 p-2">
      <FactGrid
        items={[
          { label: 'Agent', value: `${c.agentName}${c.source === 'playground' ? ' (via playground)' : ''}` },
          { label: 'Tenant', value: c.tenant },
          { label: 'Time', value: `${absTime(c.ts)} UTC` },
          { label: 'Call ID', value: <span className="font-mono">{c.id}</span> },
        ]}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <SectionLabel>Input</SectionLabel>
          <JsonBlock value={c.input} maxHeight={200} />
        </div>
        <div className="min-w-0">
          <SectionLabel>{c.output ? 'Output' : 'Outcome'}</SectionLabel>
          {c.output ? (
            <JsonBlock value={c.output} maxHeight={200} />
          ) : (
            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs text-[#475569]">
              {c.error ?? (c.gate === 'pending' ? 'Waiting at the write gate. Nothing has been written yet.' : 'No output')}
            </div>
          )}
          {c.decidedBy && (
            <div className="mt-2 text-[11px] text-[#64748B]">
              {c.gate === 'approved' ? 'Approved' : 'Rejected'} by <span className="font-semibold text-[#141416]">{c.decidedBy}</span> · {absTime(c.decidedAt)} UTC
              {c.decisionNote ? ` · “${c.decisionNote}”` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CallLogPage() {
  const isTablet = useMediaQuery(BREAKPOINTS.tablet);
  const [detail, setDetail] = useState<McpCallRow | null>(null);
  const [search, setSearch] = useState('');
  const [agentId, setAgentId] = useState('all');
  const [toolId, setToolId] = useState('all');
  const [tenant, setTenant] = useState('all');
  const [result, setResult] = useState<ResultFilter>('all');
  // Opens on the calls waiting at the write gate; "Clear filters" shows the full log.
  const [gate, setGate] = useState<GateFilter>('pending');
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<{ call: McpCallRow; action: 'approved' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState(false);

  const query: CallQuery = { search, agentId, toolId, tenant, result, gate };
  const filterDeps = [search, agentId, toolId, tenant, result, gate];
  /** Wrap a filter setter so changing a filter returns to page 1. */
  const resetting =
    <V,>(set: (v: V) => void) =>
    (v: V) => {
      set(v);
      setPage(1);
    };

  const { data, initialLoading, loading } = useServiceQuery(() => mcpService.listCalls({ ...query, page, pageSize: PAGE_SIZE }), [...filterDeps, page], {
    subscribe: mcpService.subscribeCalls,
  });
  const summary = useServiceQuery(() => mcpService.callSummary(), [], { subscribe: mcpService.subscribeCalls });
  const tools = useServiceQuery(() => mcpService.allTools(), []);
  const agents = useServiceQuery(() => mcpService.allAgents(), []);
  const s = summary.data;

  const filtered = filterDeps.some((v) => v !== '' && v !== 'all');
  const clear = () => {
    setSearch('');
    setAgentId('all');
    setToolId('all');
    setTenant('all');
    setResult('all');
    setGate('all');
    setPage(1);
  };

  const openDecision = (call: McpCallRow, action: 'approved' | 'rejected') => {
    setNote('');
    setDecision({ call, action });
  };

  const confirmDecision = async () => {
    if (!decision) return;
    if (decision.action === 'rejected' && note.trim().length < 5) {
      message.error('Give a reason for rejecting (at least 5 characters)');
      return;
    }
    setDeciding(true);
    try {
      await mcpService.decideCall(decision.call.id, decision.action, note.trim());
      message.success(`${decision.call.toolName} ${decision.action === 'approved' ? 'approved and released' : 'rejected'}`);
      setDecision(null);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setDeciding(false);
    }
  };

  const exportCsv = async () => {
    const all = await mcpService.listCalls({ ...query, page: 1, pageSize: 10000 });
    const header = ['id', 'time_utc', 'agent', 'tool', 'server', 'tenant', 'case', 'result', 'latency_ms', 'gate', 'decided_by'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = all.items.map((c) => [c.id, c.ts, c.agentName, c.toolName, c.server, c.tenant, c.caseId, c.result, c.latencyMs, c.gate, c.decidedBy].map(esc).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mcp-call-log.csv';
    a.click();
    URL.revokeObjectURL(url);
    message.success(`Exported ${all.items.length} calls`);
  };

  const columns: DataColumn<McpCallRow>[] = [
    {
      title: 'Time',
      key: 'ts',
      priority: 2,
      width: 112,
      render: (_: unknown, c: McpCallRow) => (
        <div className="min-w-0" title={`${absTime(c.ts)} UTC`}>
          <span className="block truncate text-xs font-medium text-[#141416]">{relTime(c.ts)}</span>
          <span className="block truncate text-[11px] text-[#94A3B8]">{absTime(c.ts)}</span>
        </div>
      ),
    },
    {
      title: 'Tool',
      key: 'tool',
      priority: 1,
      render: (_: unknown, c: McpCallRow) => (
        <div className="min-w-0">
          <span className="block truncate font-mono text-xs font-bold text-[#141416]" title={c.toolName}>
            {c.toolName}
          </span>
          <span className="block truncate text-[11px] text-[#64748B]">{c.server}</span>
        </div>
      ),
    },
    {
      title: 'Agent',
      key: 'agent',
      priority: 3,
      render: (_: unknown, c: McpCallRow) => (
        <div className="min-w-0">
          <span className="block truncate text-xs font-semibold text-[#141416]" title={c.agentName}>
            {c.agentName}
          </span>
          {c.source === 'playground' && <span className="block truncate text-[11px] text-[#94A3B8]">via playground</span>}
        </div>
      ),
    },
    {
      title: 'Case',
      key: 'case',
      priority: 2,
      width: 112,
      render: (_: unknown, c: McpCallRow) => (
        <div className="min-w-0">
          {c.caseId ? <CaseLink id={c.caseId} /> : <span className="text-[11px] text-[#94A3B8]">—</span>}
          <span className="block truncate text-[11px] text-[#64748B]">{c.tenant}</span>
        </div>
      ),
    },
    {
      title: 'Result',
      key: 'result',
      priority: 1,
      width: 104,
      render: (_: unknown, c: McpCallRow) => (
        <div className="min-w-0">
          <ResultPill result={c.result} />
          <span className="mt-0.5 block font-mono text-[11px] text-[#64748B]">{fmtMs(c.latencyMs)}</span>
        </div>
      ),
    },
    {
      title: 'Gate',
      key: 'gate',
      priority: 1,
      width: 164,
      ellipsis: false,
      render: (_: unknown, c: McpCallRow) =>
        c.gate === 'pending' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Btn size="sm" variant="danger" icon={<X className="w-3 h-3" />} onClick={(e) => (e.stopPropagation(), openDecision(c, 'rejected'))}>
              Reject
            </Btn>
            <Btn size="sm" icon={<Check className="w-3 h-3" />} onClick={(e) => (e.stopPropagation(), openDecision(c, 'approved'))}>
              Approve
            </Btn>
          </div>
        ) : (
          <GatePill gate={c.gate} />
        ),
    },
  ];

  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Call log & write gate"
        description="Every tool call made by an agent, with its result and latency. Writes stop at the gate until an approver releases or rejects them."
        actions={<PageActions secondary={[{ key: 'export', label: 'Export CSV', icon: <Download />, onClick: exportCsv }]} />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard label="Calls in 24h" icon={<Activity />} iconTone="green" loading={!s} value={s?.calls24h ?? ''} context="All agents, all tenants" />
        <MetricCard
          label="Held at gate"
          icon={<Hourglass />}
          loading={!s}
          value={s?.held ?? ''}
          context={
            <button type="button" className="cursor-pointer text-[11px] font-semibold text-[#0284C7] hover:underline" onClick={() => resetting(setGate)('pending')}>
              Show only held calls
            </button>
          }
        />
        <MetricCard
          label="Error rate (24h)"
          icon={<TriangleAlert />}
          iconTone="red"
          loading={!s}
          value={s ? `${(s.errorRate * 100).toFixed(1)}%` : ''}
          context={s ? `${s.errors24h} errors or denials` : ''}
        />
        <MetricCard label="Avg latency" icon={<Timer />} iconTone="blue" loading={!s} value={s ? fmtMs(s.avgLatencyMs) : ''} context="Completed calls" />
      </div>

      <FilterCard search={<SearchBox value={search} onChange={resetting(setSearch)} placeholder="Search call id, case (RT-1065), agent or tool" />} onClear={clear} canClear={filtered}>
        <NativeSelect<ResultFilter>
          label="Result"
          value={result}
          onChange={resetting(setResult)}
          options={[{ value: 'all', label: 'All results' }, ...(Object.keys(RESULT_META) as CallResult[]).map((r) => ({ value: r, label: RESULT_META[r].label }))]}
        />
        <NativeSelect<GateFilter>
          label="Gate"
          value={gate}
          onChange={resetting(setGate)}
          options={[{ value: 'all', label: 'All gate status' }, ...(Object.keys(GATE_META) as GateStatus[]).map((g) => ({ value: g, label: GATE_META[g].label }))]}
        />
        <MoreFilters active={[agentId, toolId, tenant].filter((v) => v !== 'all').length}>
          <FilterField label="Agent">
            <NativeSelect
              label="Agent"
              value={agentId}
              onChange={resetting(setAgentId)}
              className="w-full"
              options={[{ value: 'all', label: 'All agents' }, ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name }))]}
            />
          </FilterField>
          <FilterField label="Tool">
            <NativeSelect
              label="Tool"
              value={toolId}
              onChange={resetting(setToolId)}
              className="w-full"
              options={[{ value: 'all', label: 'All tools' }, ...(tools.data ?? []).map((t) => ({ value: t.id, label: t.name }))]}
            />
          </FilterField>
          <FilterField label="Tenant">
            <NativeSelect
              label="Tenant"
              value={tenant}
              onChange={resetting(setTenant)}
              className="w-full"
              options={[{ value: 'all', label: 'All tenants' }, ...TENANTS.map((t) => ({ value: t, label: t }))]}
            />
          </FilterField>
        </MoreFilters>
      </FilterCard>

      <Panel
        icon={<ScrollText />}
        title={gate === 'pending' ? 'Held at the write gate' : 'Tool calls'}
        description={
          gate === 'pending'
            ? 'Writes waiting for an approver. Clear the filters to see every call. Expand a row for the input, output and gate decision.'
            : 'Newest first. Expand a row for the agent, input, output and gate decision.'
        }
      >
        <DataTable<McpCallRow>
          rowKey="id"
          tableLayout="fixed"
          columns={columns}
          dataSource={data?.items ?? []}
          initialLoading={initialLoading}
          refreshing={loading && !initialLoading}
          filtered={filtered}
          onClearFilters={clear}
          onRowClick={isTablet ? undefined : setDetail}
          rowClassName={(c) => (c.gate === 'pending' ? 'bg-[#FFFDF5]' : '')}
          expandable={{ expandedRowRender: (c: McpCallRow) => <CallDetail call={c} /> }}
          pagination={{
            current: data?.page ?? page,
            pageSize: PAGE_SIZE,
            total: data?.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
            size: 'small',
          }}
        />
      </Panel>

      {/* Phones: the table renders as cards, which cannot expand, so details open in a drawer. */}
      <Drawer open={!!detail} onClose={() => setDetail(null)} size={560} title={detail && <TitleWithIcon icon={<ScrollText />} title={detail.toolName} sub={`${detail.id} · ${relTime(detail.ts)}`} />}>
        {detail && <CallDetail call={detail} />}
      </Drawer>

      <Modal
        open={!!decision}
        onCancel={() => setDecision(null)}
        onOk={confirmDecision}
        confirmLoading={deciding}
        okText={decision?.action === 'approved' ? 'Approve and release' : 'Reject call'}
        okButtonProps={
          decision?.action === 'approved' ? { style: { backgroundColor: '#FFD600', color: '#141416', fontWeight: 'bold' } } : { danger: true }
        }
        title={
          decision && (
            <TitleWithIcon
              icon={decision.action === 'approved' ? <ShieldCheck /> : <ShieldX />}
              title={decision.action === 'approved' ? 'Approve gated write' : 'Reject gated write'}
              sub={`${decision.call.toolName} · ${decision.call.server}`}
            />
          )
        }
      >
        {decision && (
          <div className="space-y-3 py-2 text-xs text-[#475569]">
            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 space-y-1">
              <div>
                Requested by <strong className="text-[#141416]">{decision.call.agentName}</strong> for {decision.call.tenant}, {relTime(decision.call.ts)}
              </div>
              {decision.call.caseId && (
                <div className="flex items-center gap-1">
                  Case <CaseLink id={decision.call.caseId} label={decision.call.productName} />
                </div>
              )}
            </div>
            <JsonBlock value={decision.call.input} maxHeight={160} />
            <label className="block font-semibold text-[#141416]" htmlFor="gate-note">
              {decision.action === 'approved' ? 'Comment (optional)' : 'Reason (required)'}
            </label>
            <Input.TextArea id="gate-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} showCount />
          </div>
        )}
      </Modal>
    </div>
  );
}
