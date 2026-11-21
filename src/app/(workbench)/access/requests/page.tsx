'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Modal, Drawer, Input, message } from 'antd';
import { Inbox, CheckCircle2, XCircle, Building2, Clock, Network, ArrowRight } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { governanceService, type AccessRequestRow, type RequestStatus } from '@/services/governanceService';
import { useAuth } from '@/store/authContext';
import { PageHeader, MetricCard, KpiSkeletonRow, DataTable, ErrorState, type DataColumn } from '@/components/ui';
import { Card, SearchBox, FilterPick, ClearFilters, FilterRow } from '@/components/governance/Filters';
import { CardHeader, Pill, btnPrimary, btnSecondary, btnRowPrimary, btnRowSecondary, fmtDateTime, type PillTone } from '@/components/governance/shared';

const STATUS: Record<RequestStatus, { label: string; tone: PillTone }> = {
  pending: { label: 'Pending', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
};
const RISK: Record<AccessRequestRow['risk'], PillTone> = { low: 'green', medium: 'amber', high: 'red' };
const TENANT_ICON = <Building2 className="w-3.5 h-3.5 text-[#64748B]" />;

export default function AccessRequestsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<RequestStatus | 'all'>('pending');
  const [deciding, setDeciding] = useState<{ row: AccessRequestRow; decision: 'approved' | 'declined' } | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);

  const q = useServiceQuery(() => governanceService.listRequests({ search, type: 'tenant', status }), [search, status], { subscribe: governanceService.subscribeRequests });
  const data = q.data;
  const viewing = data?.items.find((r) => r.id === viewId) ?? null;
  const filtered = search !== '' || status !== 'all';
  const clear = () => {
    setSearch('');
    setStatus('all');
  };

  const open = (row: AccessRequestRow, decision: 'approved' | 'declined') => {
    setDeciding({ row, decision });
    setComment('');
  };

  const submit = async () => {
    if (!deciding) return;
    if (deciding.decision === 'declined' && !comment.trim()) {
      message.error('Add a comment so the requester knows why');
      return;
    }
    setBusy(true);
    try {
      await governanceService.decideRequest(deciding.row.id, deciding.decision, comment.trim(), { id: user.id, name: user.name, role: user.role });
      message.success(`${deciding.row.id} ${deciding.decision}. ${deciding.row.requesterName} has been notified.`);
      setDeciding(null);
    } finally {
      setBusy(false);
    }
  };

  const decideButtons = (r: AccessRequestRow) => (
    <div className="inline-flex items-center gap-1.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          open(r, 'declined');
        }}
        className={btnRowSecondary}
      >
        Decline
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          open(r, 'approved');
        }}
        className={btnRowPrimary}
      >
        Approve
      </button>
    </div>
  );

  const columns: DataColumn<AccessRequestRow>[] = [
    {
      title: 'Request · Asks for',
      key: 'request',
      priority: 1,
      render: (_: unknown, r: AccessRequestRow) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="shrink-0">{TENANT_ICON}</span>
            <span className="font-mono font-bold text-[11px] text-[#141416] shrink-0">{r.id}</span>
            <span className="font-semibold text-[#141416] truncate">
              {r.target}
            </span>
          </div>
          <div className="text-[11px] text-[#64748B] truncate">
            {r.detail}
          </div>
        </div>
      ),
    },
    {
      title: 'Requester',
      key: 'requester',
      priority: 2,
      width: 190,
      render: (_: unknown, r: AccessRequestRow) => (
        <div className="min-w-0">
          <div className="font-semibold text-[#141416] truncate">{r.requesterName}</div>
          <div className="text-[10px] text-[#94A3B8] truncate">
            {r.requesterRole} · {fmtDateTime(r.requestedAt)}
          </div>
        </div>
      ),
    },
    {
      title: 'Justification',
      dataIndex: 'justification',
      key: 'justification',
      priority: 3,
      render: (v: string) => (
        <span className="text-[11px] text-[#475569]">{v}</span>
      ),
    },
    { title: 'Risk', dataIndex: 'risk', key: 'risk', priority: 2, width: 90, render: (v: AccessRequestRow['risk']) => <Pill tone={RISK[v]}>{v[0].toUpperCase() + v.slice(1)}</Pill> },
    { title: 'Status', dataIndex: 'status', key: 'status', priority: 1, width: 100, render: (v: RequestStatus) => <Pill tone={STATUS[v].tone}>{STATUS[v].label}</Pill> },
    {
      title: 'Actions',
      key: 'actions',
      priority: 1,
      width: 150,
      align: 'right',
      ellipsis: false,
      render: (_: unknown, r: AccessRequestRow) => (r.status === 'pending' ? decideButtons(r) : <span className="text-[10px] text-[#94A3B8]">Decided</span>),
    },
  ];

  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Access requests"
        description="Requests for access to a customer tenant. Approve or decline with a comment; every decision is written to the audit log."
      />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-[#F1F5F9] text-[11px] font-semibold text-[#475569]">
        <Network className="w-3.5 h-3.5 shrink-0 text-amber-500" />
        <span className="min-w-0">MCP server proposals are reviewed with the servers they connect.</span>
        <Link href="/mcp/servers?tab=requests" className="inline-flex items-center gap-1 text-[#141416] underline hover:no-underline">
          MCP server requests <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {q.initialLoading ? (
        <KpiSkeletonRow count={1} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <MetricCard label="Pending" value={data?.counts.pending ?? 0} icon={<Clock />} context="Waiting for a decision" />
        </div>
      )}

      <Card>
        <CardHeader icon={<Inbox />} title="Tenant access queue" description="Pending first, then newest. Select a request for its justification and decision." />
        <div className="pt-4">
          <FilterRow>
            <SearchBox value={search} onChange={setSearch} placeholder="Search request, requester or tenant" label="Search requests" />
            <FilterPick
              value={status}
              onChange={(v) => setStatus(v as RequestStatus | 'all')}
              label="Status"
              options={[
                { value: 'all', label: 'All status' },
                { value: 'pending', label: 'Pending' },
                { value: 'approved', label: 'Approved' },
                { value: 'declined', label: 'Declined' },
              ]}
            />
            <ClearFilters onClick={clear} disabled={!filtered} />
          </FilterRow>
        </div>
        <div className="pt-3">
          {q.error ? (
            <ErrorState onRetry={q.refetch} compact />
          ) : (
            <DataTable<AccessRequestRow>
              rowKey="id"
              tableLayout="fixed"
              initialLoading={q.initialLoading}
              refreshing={q.loading}
              filtered={filtered}
              onClearFilters={clear}
              emptyTitle="No requests"
              columns={columns}
              dataSource={data?.items ?? []}
              onRowClick={(r) => setViewId(r.id)}
              pagination={false}
            />
          )}
        </div>
      </Card>

      <Drawer
        open={!!viewing}
        onClose={() => setViewId(null)}
        size={460}
        title={
          viewing && (
            <div className="flex items-center gap-2 min-w-0">
              {TENANT_ICON}
              <span className="font-mono font-bold text-sm">{viewing.id}</span>
              <Pill tone={STATUS[viewing.status].tone}>{STATUS[viewing.status].label}</Pill>
            </div>
          )
        }
        extra={viewing && viewing.status === 'pending' ? decideButtons(viewing) : null}
      >
        {viewing && (
          <div className="space-y-4 text-xs text-[#475569]">
            <div>
              <div className="text-sm font-extrabold text-[#141416] break-words">{viewing.target}</div>
              <div className="mt-0.5">{viewing.detail}</div>
            </div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 m-0">
              <dt className="text-[#94A3B8]">Requester</dt>
              <dd className="m-0 font-semibold text-[#141416]">
                {viewing.requesterName} <span className="font-normal text-[#94A3B8]">({viewing.requesterRole})</span>
              </dd>
              <dt className="text-[#94A3B8]">Requested</dt>
              <dd className="m-0 font-mono text-[11px]">{fmtDateTime(viewing.requestedAt)}</dd>
              <dt className="text-[#94A3B8]">Risk</dt>
              <dd className="m-0">
                <Pill tone={RISK[viewing.risk]}>{viewing.risk[0].toUpperCase() + viewing.risk.slice(1)}</Pill>
              </dd>
            </dl>
            <div>
              <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Justification</div>
              <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#141416] leading-relaxed">{viewing.justification}</div>
            </div>
            {viewing.status !== 'pending' && (
              <div>
                <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Decision</div>
                <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl">
                  <span className="font-bold text-[#141416]">{viewing.decidedBy}</span>
                  {viewing.decidedAt && <span className="text-[#94A3B8]"> · {fmtDateTime(viewing.decidedAt)}</span>}
                  {viewing.comment && <div className="text-[#475569] mt-1">“{viewing.comment}”</div>}
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>
      <Modal
        open={!!deciding}
        onCancel={() => setDeciding(null)}
        title={
          deciding && (
            <div className="flex items-center gap-2">
              {deciding.decision === 'approved' ? <CheckCircle2 className="w-4 h-4 text-[#059669]" /> : <XCircle className="w-4 h-4 text-[#DC2626]" />}
              <span className="font-bold text-sm">
                {deciding.decision === 'approved' ? 'Approve' : 'Decline'} {deciding.row.id}
              </span>
            </div>
          )
        }
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeciding(null)} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={submit} disabled={busy} className={btnPrimary}>
              {busy ? 'Saving…' : deciding?.decision === 'approved' ? 'Approve' : 'Decline'}
            </button>
          </div>
        }
      >
        {deciding && (
          <div className="space-y-3 py-2 text-xs text-[#475569]">
            <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl space-y-1">
              <div className="font-bold text-[#141416]">
                Tenant access: {deciding.row.target}
              </div>
              <div>{deciding.row.detail}</div>
              <div>
                Requested by <strong className="text-[#141416]">{deciding.row.requesterName}</strong> · risk {deciding.row.risk}
              </div>
            </div>
            <div>
              <span className="block text-[11px] font-bold text-[#64748B] mb-1">Comment {deciding.decision === 'declined' ? '(required)' : '(optional)'}</span>
              <Input.TextArea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder={deciding.decision === 'declined' ? 'Why is this declined, and what would make it acceptable?' : 'Any conditions on this approval'}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
