'use client';

import React, { useState } from 'react';
import { Checkbox, Drawer, Form, Input, Modal, Select, message } from 'antd';
import { FilePlus2, FileText, Check, X, PlugZap } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { mcpService, CURRENT_DEVELOPER, CURRENT_USER, type McpProposal, type NewProposalInput, type ProposalStatus } from '@/services/mcpService';
import { DataTable, type DataColumn } from '@/components/ui';
import { Btn, FactGrid, Pill, PillToggle, ScopeTag, SearchBox, SectionLabel, TitleWithIcon, absTime, relTime, type PillTone } from './mcpUi';
import { AUTH_TYPES } from './ServersPanel';

const STATUS_META: Record<ProposalStatus, { label: string; tone: PillTone }> = {
  pending: { label: 'Pending review', tone: 'medium' },
  approved: { label: 'Approved', tone: 'ok' },
  declined: { label: 'Declined', tone: 'high' },
};
const CLASS_TONE: Record<string, PillTone> = { Public: 'ok', Internal: 'info', Confidential: 'medium', Restricted: 'high' };
type StatusFilter = ProposalStatus | 'all';

/**
 * Requests to add MCP servers: developers propose, governance approves or declines with a comment,
 * and an approved proposal is then connected (it appears in the Servers tab).
 */
export function ProposalsPanel({
  proposeOpen,
  onProposeOpenChange: setProposeOpen,
  onConnected,
}: {
  proposeOpen: boolean;
  onProposeOpenChange: (open: boolean) => void;
  onConnected: (serverId: string) => void;
}) {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [deciding, setDeciding] = useState<'approved' | 'declined' | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [form] = Form.useForm<NewProposalInput>();

  const { data, initialLoading, loading } = useServiceQuery(() => mcpService.listProposals({ status, search }), [status, search], {
    subscribe: mcpService.subscribeProposals,
  });
  const counts = useServiceQuery(() => mcpService.proposalCounts(), [], { subscribe: mcpService.subscribeProposals });
  const c = counts.data;
  // Keep the drawer showing the live record after a decision.
  const all = useServiceQuery(() => mcpService.listProposals(), [], { subscribe: mcpService.subscribeProposals });
  const open = all.data?.find((p) => p.id === openId) ?? null;

  const submitProposal = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return; // field errors are shown inline
    setSubmitting(true);
    try {
      const p = await mcpService.createProposal(values);
      message.success(`${p.name} submitted for review`);
      setProposeOpen(false);
      form.resetFields();
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (decision: 'approved' | 'declined') => {
    if (!open) return;
    if (comment.trim().length < 5) {
      message.error('Add a comment of at least 5 characters for the proposer');
      return;
    }
    setDeciding(decision);
    try {
      await mcpService.decideProposal(open.id, decision, comment.trim());
      message.success(`${open.name} ${decision}`);
      setComment('');
    } finally {
      setDeciding(null);
    }
  };

  const connect = async (p: McpProposal) => {
    setConnecting(p.id);
    try {
      const server = await mcpService.connectProposal(p.id);
      message.success({
        content: (
          <span>
            {server.name} connected with {server.tools.length} tools.{' '}
            <button
              type="button"
              onClick={() => {
                setOpenId(null);
                onConnected(server.id);
              }}
              className="cursor-pointer border-0 bg-transparent p-0 font-semibold underline"
            >
              Show in Servers
            </button>
          </span>
        ),
        duration: 5,
      });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setConnecting(null);
    }
  };

  const openProposal = (id: string) => {
    setComment('');
    setOpenId(id);
  };

  const columns: DataColumn<McpProposal>[] = [
    {
      title: 'Proposal',
      key: 'name',
      priority: 1,
      ellipsis: false,
      render: (_: unknown, p: McpProposal) => (
        <button type="button" onClick={() => openProposal(p.id)} className="block w-full min-w-0 text-left cursor-pointer group" title={p.purpose}>
          <span className="block truncate text-xs font-bold text-[#141416] group-hover:underline">{p.name}</span>
          <span className="text-[11px] text-[#64748B] mt-0.5 whitespace-normal line-clamp-2">{p.purpose}</span>
        </button>
      ),
    },
    {
      title: 'Proposer',
      key: 'proposer',
      priority: 2,
      width: 150,
      render: (_: unknown, p: McpProposal) => (
        <div className="min-w-0">
          <span className="block truncate text-xs font-semibold text-[#141416]">{p.proposer}</span>
          <span className="block truncate text-[11px] text-[#64748B]">{p.team}</span>
        </div>
      ),
    },
    {
      title: 'Scopes',
      key: 'scopes',
      priority: 3,
      width: 128,
      ellipsis: false,
      render: (_: unknown, p: McpProposal) => (
        <div className="flex flex-wrap items-start gap-1">
          {p.scopes.map((s) => (
            <ScopeTag key={s} scope={s} />
          ))}
        </div>
      ),
    },
    {
      title: 'Data',
      key: 'data',
      priority: 3,
      width: 112,
      render: (_: unknown, p: McpProposal) => (
        <Pill tone={CLASS_TONE[p.dataClassification] ?? 'neutral'} dot={false}>
          {p.dataClassification}
        </Pill>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      priority: 1,
      width: 150,
      render: (_: unknown, p: McpProposal) => (
        <div className="min-w-0">
          <Pill tone={STATUS_META[p.status].tone}>{STATUS_META[p.status].label}</Pill>
          <span className="mt-1 block truncate text-[11px] font-mono text-gray-500" title="Submitted">
            {relTime(p.submittedAt)}
            {p.connectedServerId ? ' · connected' : ''}
          </span>
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      priority: 1,
      width: 140,
      ellipsis: false,
      align: 'right' as const,
      render: (_: unknown, p: McpProposal) =>
        p.status === 'approved' && !p.connectedServerId ? (
          <Btn size="sm" icon={<PlugZap className="w-3 h-3" />} disabled={connecting === p.id} onClick={() => connect(p)}>
            {connecting === p.id ? 'Connecting…' : 'Connect server'}
          </Btn>
        ) : (
          <Btn size="sm" variant="secondary" onClick={() => openProposal(p.id)}>
            {p.status === 'pending' ? 'Review' : 'View'}
          </Btn>
        ),
    },
  ];

  const filtered = status !== 'all' || search !== '';

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-64 items-center">
          <SearchBox value={search} onChange={setSearch} placeholder="Search proposals, systems or proposers" />
        </div>
        <PillToggle<StatusFilter>
          label="Status"
          value={status}
          onChange={setStatus}
          options={(['all', 'pending', 'approved', 'declined'] as StatusFilter[]).map((s) => ({
            value: s,
            label: `${s === 'all' ? 'All' : STATUS_META[s as ProposalStatus].label.replace(' review', '')}${c ? ` (${c[s]})` : ''}`,
          }))}
        />
      </div>

      <DataTable<McpProposal>
        rowKey="id"
        tableLayout="fixed"
        columns={columns}
        dataSource={data ?? []}
        initialLoading={initialLoading}
        refreshing={loading && !initialLoading}
        filtered={filtered}
        onClearFilters={() => {
          setStatus('all');
          setSearch('');
        }}
        pagination={false}
        emptyTitle="No proposals yet"
      />

      {/* Review drawer */}
      <Drawer
        open={!!openId}
        onClose={() => setOpenId(null)}
        size={560}
        title={open ? <TitleWithIcon icon={<FileText />} title={open.name} sub={`${open.id} · submitted ${relTime(open.submittedAt)}`} /> : 'Proposal'}
        footer={
          open?.status === 'approved' ? (
            <div className="flex items-center justify-end gap-2">
              {open.connectedServerId ? (
                <button
                  type="button"
                  onClick={() => {
                    const id = open.connectedServerId!;
                    setOpenId(null);
                    onConnected(id);
                  }}
                  className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-[#0284C7] hover:underline"
                >
                  Connected · show in Servers
                </button>
              ) : (
                <Btn variant="primary" icon={<PlugZap className="w-3.5 h-3.5" />} disabled={connecting === open.id} onClick={() => connect(open)}>
                  {connecting === open.id ? 'Connecting…' : 'Connect server'}
                </Btn>
              )}
            </div>
          ) : (
            open?.status === 'pending' && (
            <div className="flex items-center justify-end gap-2">
              <Btn variant="danger" icon={<X className="w-3.5 h-3.5" />} disabled={!!deciding} onClick={() => decide('declined')}>
                {deciding === 'declined' ? 'Declining…' : 'Decline'}
              </Btn>
              <Btn variant="primary" icon={<Check className="w-3.5 h-3.5" />} disabled={!!deciding} onClick={() => decide('approved')}>
                {deciding === 'approved' ? 'Approving…' : 'Approve'}
              </Btn>
            </div>
            )
          )
        }
      >
        {open && (
          <div className="space-y-5 text-xs">
            <div className="flex items-center gap-2">
              <Pill tone={STATUS_META[open.status].tone}>{STATUS_META[open.status].label}</Pill>
            </div>
            <div>
              <SectionLabel>Purpose</SectionLabel>
              <p className="m-0 leading-relaxed text-[#475569]">{open.purpose}</p>
            </div>
            <FactGrid
              items={[
                { label: 'Target system', value: open.targetSystem },
                { label: 'Proposer', value: `${open.proposer} · ${open.team}` },
                { label: 'Authentication', value: open.authType },
                {
                  label: 'Data classification',
                  value: (
                    <Pill tone={CLASS_TONE[open.dataClassification] ?? 'neutral'} dot={false}>
                      {open.dataClassification}
                    </Pill>
                  ),
                },
                {
                  label: 'Scopes requested',
                  value: (
                    <div className="flex flex-wrap gap-1">
                      {open.scopes.map((s) => (
                        <ScopeTag key={s} scope={s} />
                      ))}
                    </div>
                  ),
                },
                { label: 'Tools', value: <span className="font-mono">{open.tools.join(', ')}</span> },
              ]}
            />
            <div>
              <SectionLabel>Endpoint</SectionLabel>
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 font-mono text-[11px] text-[#334155] break-all">{open.endpoint}</div>
            </div>
            {open.decision ? (
              <div className={`rounded-xl border p-3 ${open.status === 'approved' ? 'border-[#D1FAE5] bg-[#ECFDF5]' : 'border-[#FECACA] bg-[#FEF2F2]'}`}>
                <div className="font-bold text-[#141416]">
                  {open.status === 'approved' ? 'Approved' : 'Declined'} by {open.decision.by} · {absTime(open.decision.at)} UTC
                </div>
                <div className="mt-1 text-[#475569]">{open.decision.comment}</div>
              </div>
            ) : (
              <div>
                <label htmlFor="decision-comment" className="block">
                  <SectionLabel>Comment to the proposer (required)</SectionLabel>
                </label>
                <Input.TextArea
                  id="decision-comment"
                  rows={4}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={400}
                  showCount
                  placeholder="Conditions, scope limits or the reason for declining"
                />
                <div className="mt-1 text-[11px] text-[#94A3B8]">
                  Deciding as {CURRENT_USER.name} ({CURRENT_USER.role})
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Propose modal */}
      <Modal
        open={proposeOpen}
        onCancel={() => {
          setProposeOpen(false);
          form.resetFields();
        }}
        onOk={submitProposal}
        confirmLoading={submitting}
        okText="Submit proposal"
        okButtonProps={{ style: { backgroundColor: '#FFD600', color: '#141416', fontWeight: 'bold' } }}
        width={620}
        title={
          <TitleWithIcon icon={<FilePlus2 />} title="Propose a new MCP server" sub={`Submitting as ${CURRENT_DEVELOPER.name} (${CURRENT_DEVELOPER.role}). Governance reviews every proposal.`} />
        }
      >
        <Form
          form={form}
          layout="vertical"
          className="pt-2"
          initialValues={{ team: CURRENT_DEVELOPER.team, authType: 'OAuth 2.0', dataClassification: 'Internal', scopes: ['read_only'], tools: [] }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
            <Form.Item name="name" label="Server name" rules={[{ required: true, whitespace: true, message: 'Enter a server name' }, { max: 60 }]}>
              <Input placeholder="e.g. Coupa procurement MCP" />
            </Form.Item>
            <Form.Item name="targetSystem" label="Target system" rules={[{ required: true, whitespace: true, message: 'Enter the target system' }]}>
              <Input placeholder="e.g. Coupa" />
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3">
            <Form.Item name="team" label="Team" rules={[{ required: true, whitespace: true, message: 'Enter your team' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="authType" label="Authentication" rules={[{ required: true }]}>
              <Select options={AUTH_TYPES.map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="dataClassification" label="Data classification" rules={[{ required: true }]}>
              <Select options={['Public', 'Internal', 'Confidential', 'Restricted'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </div>
          <Form.Item name="scopes" label="Scopes requested" rules={[{ required: true, type: 'array', min: 1, message: 'Pick at least one scope' }]}>
            <Checkbox.Group
              options={[
                { value: 'read_only', label: 'read_only' },
                { value: 'compute', label: 'compute' },
                { value: 'write_gated', label: 'write_gated' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="tools"
            label="Tools to expose"
            extra="Type a tool name and press Enter. Use snake_case."
            rules={[
              { required: true, type: 'array', min: 1, message: 'List at least one tool' },
              {
                validator: (_, v: string[]) => (v ?? []).every((t) => /^[a-z][a-z0-9_]*$/.test(t)) ? Promise.resolve() : Promise.reject(new Error('Tool names must be snake_case')),
              },
            ]}
          >
            <Select mode="tags" open={false} placeholder="e.g. po_lookup" tokenSeparators={[',', ' ']} />
          </Form.Item>
          <Form.Item
            name="purpose"
            label="Purpose and agents that will use it"
            rules={[
              { required: true, whitespace: true, message: 'Describe the purpose' },
              { min: 30, message: 'At least 30 characters, so reviewers understand the need' },
            ]}
          >
            <Input.TextArea rows={3} maxLength={500} showCount placeholder="Which journey step it supports, which agent calls it and why" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
