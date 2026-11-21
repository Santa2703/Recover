'use client';

import React, { useState } from 'react';
import { Modal, message } from 'antd';
import { FileWarning, Lock, Clock, Send, Download, CheckCircle2 } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { auditService, type EvidenceGap } from '@/services/auditService';
import { useAuth } from '@/store/authContext';
import { MetricCard, KpiSkeletonRow, CaseLink, DataTable, ErrorState, type DataColumn } from '@/components/ui';
import { CardHeader, Pill, SystemChip, btnPrimary, btnSecondary, btnRowSecondary, downloadText } from './shared';
import { Card, SearchBox, FilterPick, MoreFilters, ClearFilters, FilterRow } from './Filters';

/** Audit log → Evidence gaps tab: missing or unproven evidence for cases at step 1, with bulk requests. */
export function EvidenceGapsTab() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('all');
  const [blocking, setBlocking] = useState<'all' | 'yes' | 'no'>('all');
  const [kind, setKind] = useState<'all' | EvidenceGap['kind']>('all');
  const [confirm, setConfirm] = useState<EvidenceGap[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [busy, setBusy] = useState(false);

  const q = useServiceQuery(() => auditService.listGaps({ search, source, blocking, kind }), [search, source, blocking, kind], {
    subscribe: auditService.subscribeGaps,
  });
  const data = q.data;
  // Derived during render: only rows still on screen and not yet requested count as selected.
  const selectedGaps = (data?.items ?? []).filter((g) => !g.requestedAt && selectedKeys.includes(g.id));
  const filtered = search !== '' || source !== 'all' || blocking !== 'all' || kind !== 'all';
  const clear = () => {
    setSearch('');
    setSource('all');
    setBlocking('all');
    setKind('all');
  };

  const doRequest = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await auditService.requestEvidenceMany(confirm, { id: user.id, name: user.name, role: user.role });
      const cases = new Set(confirm.map((g) => g.caseId)).size;
      message.success(
        confirm.length === 1
          ? `Evidence requested from ${confirm[0].ownerName} for ${confirm[0].caseId}. The case is now "Needs information".`
          : `${confirm.length} evidence requests sent across ${cases} cases. Those cases are now "Needs information".`,
      );
      const sent = new Set(confirm.map((g) => g.id));
      setSelectedKeys((keys) => keys.filter((k) => !sent.has(String(k))));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const rows = data?.items ?? [];
    const header = 'Case,Product,Evidence item,Gap,Source expected,Age (days),Owner,Blocking,Requested at';
    const esc = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = rows.map((g) =>
      [g.caseId, g.productName, g.item, g.kind === 'missing' ? 'Missing' : 'No provenance', g.sourceExpected, g.ageDays, g.ownerName, g.blocking ? 'Yes' : 'No', g.requestedAt ?? ''].map(esc).join(','),
    );
    downloadText('evidence-gaps.csv', [header, ...lines].join('\n'));
    message.success(`Exported ${rows.length} gaps`);
  };

  const columns: DataColumn<EvidenceGap>[] = [
    {
      title: 'Evidence item · Case',
      key: 'item',
      priority: 1,
      render: (_: unknown, g: EvidenceGap) => (
        <div className="flex items-start gap-2 min-w-0">
          {g.kind === 'missing' ? (
            <span className="w-2 h-2 rounded-full bg-[#F59E0B] shrink-0 mt-1" />
          ) : (
            <span className="w-2 h-2 rounded-full border border-[#94A3B8] shrink-0 mt-1" />
          )}
          <div className="min-w-0">
            <div className="font-semibold text-[#141416] truncate">{g.item}</div>
            <div className="flex items-baseline gap-1.5 min-w-0 text-[11px]">
              <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <CaseLink id={g.caseId} />
              </span>
              <span className="text-[#64748B] truncate">
                {g.productName} · {g.evidenceCompleteness}% complete · {g.kind === 'missing' ? 'Missing' : 'No provenance'}
              </span>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Source expected',
      dataIndex: 'sourceExpected',
      key: 'source',
      priority: 2,
      width: 150,
      render: (v: string) => <SystemChip name={v} />,
    },
    {
      title: 'Age / Owner',
      key: 'age',
      priority: 2,
      width: 150,
      render: (_: unknown, g: EvidenceGap) => (
        <div className="min-w-0">
          <span className={`font-medium text-[11px] ${g.ageDays >= 14 ? 'text-[#DC2626]' : 'text-[#64748B]'}`}>{g.ageDays}d</span>
          <div className="text-[#475569] truncate">{g.ownerName}</div>
        </div>
      ),
    },
    {
      title: 'Blocking',
      dataIndex: 'blocking',
      key: 'blocking',
      priority: 2,
      width: 90,
      render: (v: boolean) => (v ? <Pill tone="red">Yes</Pill> : <Pill tone="slate">No</Pill>),
    },
    {
      title: 'Actions',
      key: 'actions',
      priority: 1,
      width: 140,
      align: 'right',
      ellipsis: false,
      render: (_: unknown, g: EvidenceGap) =>
        g.requestedAt ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#059669]">
            <CheckCircle2 className="w-3.5 h-3.5" /> Requested
          </span>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirm([g]);
            }}
            className={btnRowSecondary}
          >
            Request evidence
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      {q.initialLoading ? (
        <KpiSkeletonRow count={3} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricCard label="Gaps open" value={data?.summary.open ?? 0} icon={<FileWarning />} context={`${data?.summary.requested ?? 0} requested, awaiting owner`} />
          <MetricCard label="Cases blocked" value={data?.summary.casesBlocked ?? 0} icon={<Lock />} iconTone="red" context="Cannot move to step 2 until evidence arrives" />
          <MetricCard
            label="Oldest gap"
            value={data?.summary.oldestDays ?? 0}
            unit="days"
            icon={<Clock />}
            context={data?.summary.oldestCaseId ? <CaseLink id={data.summary.oldestCaseId} /> : 'None'}
          />
        </div>
      )}

      <Card>
        <CardHeader
          icon={<FileWarning />}
          title="Gaps by case"
          description="Evidence that is missing, or present without provenance, for cases still at step 1. Oldest first; blocking gaps stop the case moving on. Select rows to request several at once."
          right={
            <>
              <button onClick={exportCsv} disabled={!data?.items.length} className={btnSecondary}>
                <Download className="w-3.5 h-3.5" />
                <span>Export</span>
              </button>
              <button onClick={() => setConfirm(selectedGaps)} disabled={!selectedGaps.length} className={btnPrimary}>
                <Send className="w-3.5 h-3.5" />
                <span>Request selected ({selectedGaps.length})</span>
              </button>
            </>
          }
        />
        <div className="pt-4">
          <FilterRow>
            <SearchBox value={search} onChange={setSearch} placeholder="Search case, product, item or owner" label="Search gaps" />
            <FilterPick
              value={blocking}
              onChange={(v) => setBlocking(v as 'all' | 'yes' | 'no')}
              label="Blocking"
              options={[
                { value: 'all', label: 'Blocking and not' },
                { value: 'yes', label: 'Blocking only' },
                { value: 'no', label: 'Not blocking' },
              ]}
            />
            <MoreFilters active={(source !== 'all' ? 1 : 0) + (kind !== 'all' ? 1 : 0)}>
              <FilterPick
                value={source}
                onChange={setSource}
                label="Source expected"
                options={[{ value: 'all', label: 'All sources' }, ...(data?.sources ?? []).map((s) => ({ value: s, label: s }))]}
              />
              <FilterPick
                value={kind}
                onChange={(v) => setKind(v as 'all' | EvidenceGap['kind'])}
                label="Gap type"
                options={[
                  { value: 'all', label: 'All gap types' },
                  { value: 'missing', label: 'Missing evidence' },
                  { value: 'no_provenance', label: 'No provenance' },
                ]}
              />
            </MoreFilters>
            <ClearFilters onClick={clear} disabled={!filtered} />
          </FilterRow>
        </div>
        <div className="pt-3">
          {q.error ? (
            <ErrorState onRetry={q.refetch} compact />
          ) : (
            <DataTable<EvidenceGap>
              rowKey="id"
              tableLayout="fixed"
              initialLoading={q.initialLoading}
              refreshing={q.loading}
              filtered={filtered}
              onClearFilters={clear}
              emptyTitle="No evidence gaps"
              emptyDescription="Every case at step 1 has its evidence with provenance."
              columns={columns}
              dataSource={data?.items ?? []}
              // Light highlight for selected rows (the theme's default selected background is too dark here).
              rowClassName={(g: EvidenceGap) => (selectedGaps.some((s) => s.id === g.id) ? '[&>td]:!bg-[#FFFBEB]' : '')}
              rowSelection={{
                selectedRowKeys: selectedGaps.map((g) => g.id),
                onChange: setSelectedKeys,
                getCheckboxProps: (g: EvidenceGap) => ({ disabled: !!g.requestedAt, 'aria-label': `Select ${g.item} for ${g.caseId}` }),
              }}
              pagination={{ pageSize: 12, showSizeChanger: false, hideOnSinglePage: true }}
            />
          )}
        </div>
      </Card>

      <Modal
        open={!!confirm}
        onCancel={() => setConfirm(null)}
        title={
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-amber-500" />
            <span className="font-bold text-sm">{confirm && confirm.length > 1 ? `Request evidence (${confirm.length})` : 'Request evidence'}</span>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirm(null)} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={doRequest} disabled={busy} className={btnPrimary}>
              <Send className="w-3.5 h-3.5" />
              <span>{busy ? 'Sending…' : confirm && confirm.length > 1 ? `Send ${confirm.length} requests` : 'Send request'}</span>
            </button>
          </div>
        }
      >
        {confirm && confirm.length === 1 && (
          <div className="space-y-3 py-2 text-xs text-[#475569]">
            <p>
              Ask <strong className="text-[#141416]">{confirm[0].ownerName}</strong> to supply this evidence from {confirm[0].sourceExpected}. The case moves to “Needs information” until it arrives.
            </p>
            <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl space-y-1">
              <div className="font-bold text-[#141416]">{confirm[0].item}</div>
              <div>
                Case <strong className="font-mono">{confirm[0].caseId}</strong> ({confirm[0].productName})
              </div>
              <div>
                Open {confirm[0].ageDays} days · {confirm[0].blocking ? <span className="text-[#DC2626] font-semibold">blocking the plan</span> : 'not blocking'}
              </div>
            </div>
          </div>
        )}
        {confirm && confirm.length > 1 && (
          <div className="space-y-3 py-2 text-xs text-[#475569]">
            <p>
              Send {confirm.length} evidence requests to {new Set(confirm.map((g) => g.ownerName)).size} owners across {new Set(confirm.map((g) => g.caseId)).size} cases. Each case moves to “Needs information” until its evidence arrives.
            </p>
            <ul className="m-0 p-3 list-none bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl space-y-1 max-h-56 overflow-y-auto">
              {confirm.map((g) => (
                <li key={g.id} className="flex items-baseline gap-2 min-w-0">
                  <span className="font-mono font-bold text-[#141416] shrink-0">{g.caseId}</span>
                  <span className="truncate">
                    {g.item} · {g.ownerName}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
