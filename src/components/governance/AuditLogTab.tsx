'use client';

import React, { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Drawer, Tag, message } from 'antd';
import { Download, ScrollText, Copy, ExternalLink, Link2 } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { auditService, shortHash, AUDIT_ACTION_LABEL, type AuditActionType, type AuditEntry } from '@/services/auditService';
import { DataTable, CaseLink, ErrorState, type DataColumn } from '@/components/ui';
import { Pill, SystemChip, fmtDateTime, downloadText, btnPrimary, type PillTone } from './shared';
import { Card, SearchBox, FilterPick, MoreFilters, ClearFilters, FilterRow } from './Filters';
import { CommentThread } from '@/components/common/CommentThread';

const ACTION_TONE: Record<AuditActionType, PillTone> = {
  fetch: 'slate',
  decision: 'blue',
  approval: 'dark',
  override: 'amber',
  write: 'yellow',
  evidence: 'green',
  access: 'red',
};
const PAGE_SIZE = 10;

/** ?type=access (or any action type) preselects the action-type filter, e.g. from Delegations. */
const noopSubscribe = () => () => {};
const readTypeParam = (): AuditActionType | null => {
  const v = new URLSearchParams(window.location.search).get('type');
  return v && v in AUDIT_ACTION_LABEL ? (v as AuditActionType) : null;
};

/** Audit log → Log tab: every audited event, filterable, with a drawer for source, payload and hash chain. */
export function AuditLogTab() {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('all');
  const urlType = useSyncExternalStore(noopSubscribe, readTypeParam, () => null);
  const [pickedType, setActionType] = useState<AuditActionType | 'all' | null>(null);
  const actionType: AuditActionType | 'all' = pickedType ?? urlType ?? 'all';
  const [actor, setActor] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = { search, source, actionType, actor };
  const listQ = useServiceQuery(() => auditService.list({ ...query, page, pageSize: PAGE_SIZE }), [search, source, actionType, actor, page], {
    subscribe: auditService.subscribe,
  });
  const facetsQ = useServiceQuery(() => auditService.facets(), [], { subscribe: auditService.subscribe });

  const filtered = search !== '' || source !== 'all' || actionType !== 'all' || actor !== 'all';
  const setFilter = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  const clear = () => {
    setSearch('');
    setSource('all');
    setActionType('all');
    setActor('all');
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await auditService.exportCsv(query);
      const rows = csv.split('\n').length - 1;
      downloadText(`audit-provenance-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      message.success(`Exported ${rows} entries to CSV`);
    } finally {
      setExporting(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('Hash copied');
    } catch {
      message.error('Clipboard is not available in this browser');
    }
  };

  const columns: DataColumn<AuditEntry>[] = [
    {
      title: 'Asset / Entity · Action Performed',
      dataIndex: 'entity',
      key: 'entity',
      priority: 1,
      render: (v: string, r: AuditEntry) => {
        const [id, ...rest] = v.split(' · ');
        const sub = r.caseId ? rest.join(' · ') : id;
        return (
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5 min-w-0">
              {r.caseId ? (
                <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <CaseLink id={r.caseId} />
                </span>
              ) : (
                <span className="font-bold text-xs text-[#141414] shrink-0">{rest.join(' · ') || id}</span>
              )}
              {sub && <span className="text-[11px] text-[#64748B] truncate">{sub}</span>}
            </div>
            <div className="text-xs text-gray-800 truncate" title={r.action}>
              {r.action}
            </div>
          </div>
        );
      },
    },
    {
      title: 'Type',
      dataIndex: 'actionType',
      key: 'type',
      priority: 2,
      width: 130,
      render: (_: unknown, r: AuditEntry) => (
        <div className="min-w-0">
          <Pill tone={ACTION_TONE[r.actionType]} dot={false}>
            {AUDIT_ACTION_LABEL[r.actionType]}
          </Pill>
          <div className="text-[10px] text-[#94A3B8] truncate mt-0.5">{r.source}</div>
        </div>
      ),
    },
    {
      title: 'Timestamp / Actor',
      dataIndex: 'timestamp',
      key: 'timestamp',
      priority: 2,
      width: 190,
      render: (v: string, r: AuditEntry) => (
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-gray-500 truncate">{v.replace('T', ' ').replace('Z', ' UTC')}</div>
          <div className="text-xs text-gray-600 truncate">{r.actorName}</div>
        </div>
      ),
    },
    {
      title: 'Provenance Hash',
      dataIndex: 'hash',
      key: 'hash',
      priority: 3,
      width: 120,
      render: (v: string) => <Tag className="font-mono text-[10px] !m-0">{shortHash(v)}</Tag>,
    },
  ];

  const facets = facetsQ.data;
  const moreActive = (source !== 'all' ? 1 : 0) + (actor !== 'all' ? 1 : 0);

  return (
    <div className="space-y-6">
      <Card>
        <div>
          <FilterRow>
            <SearchBox value={search} onChange={setFilter(setSearch)} placeholder="Search case, action, actor, reference or hash" label="Search audit log" />
            <FilterPick
              value={actionType}
              onChange={(v) => setFilter(setActionType)(v as AuditActionType | 'all')}
              label="Action type"
              options={[{ value: 'all', label: 'All action types' }, ...(Object.keys(AUDIT_ACTION_LABEL) as AuditActionType[]).map((k) => ({ value: k, label: AUDIT_ACTION_LABEL[k] }))]}
            />
            <MoreFilters active={moreActive}>
              <FilterPick
                value={source}
                onChange={setFilter(setSource)}
                label="Source system"
                options={[{ value: 'all', label: 'All sources' }, ...(facets?.sources ?? []).map((s) => ({ value: s, label: s }))]}
              />
              <FilterPick
                value={actor}
                onChange={setFilter(setActor)}
                label="Actor"
                options={[{ value: 'all', label: 'All actors' }, ...(facets?.actors ?? []).map((a) => ({ value: a.id, label: a.name }))]}
              />
            </MoreFilters>
            <ClearFilters onClick={clear} disabled={!filtered} />
            <div className="ml-auto flex items-center gap-3">
              {facets && <span className="hidden md:inline text-[11px] text-[#94A3B8]">{facets.total} entries · {facets.sources.length} source systems</span>}
              <button onClick={exportCsv} disabled={exporting} className={btnPrimary}>
                <Download className="w-3.5 h-3.5" />
                <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
              </button>
            </div>
          </FilterRow>
        </div>
        <div className="pt-3">
          {listQ.error ? (
            <ErrorState onRetry={listQ.refetch} compact />
          ) : (
            <DataTable<AuditEntry>
              rowKey="id"
              tableLayout="fixed"
              initialLoading={listQ.initialLoading}
              refreshing={listQ.loading}
              filtered={filtered}
              onClearFilters={clear}
              columns={columns}
              dataSource={listQ.data?.items ?? []}
              onRowClick={setSelected}
              pagination={{
                current: listQ.data?.page ?? page,
                pageSize: PAGE_SIZE,
                total: listQ.data?.total ?? 0,
                onChange: setPage,
                showSizeChanger: false,
                showTotal: (t, [a, b]) => `${a}–${b} of ${t}`,
              }}
            />
          )}
        </div>
      </Card>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        size={500}
        title={
          selected && (
            <div className="flex items-center gap-2">
              <ScrollText className="w-4 h-4 text-amber-500" />
              <span className="font-bold text-sm">{selected.id}</span>
              <Pill tone={ACTION_TONE[selected.actionType]} dot={false}>
                {AUDIT_ACTION_LABEL[selected.actionType]}
              </Pill>
            </div>
          )
        }
      >
        {selected && (
          <div className="space-y-4 text-xs text-[#475569]">
            <div>
              <div className="text-sm font-extrabold text-[#141416]">{selected.action}</div>
              <div className="text-[11px] text-[#64748B] font-mono mt-0.5">{fmtDateTime(selected.timestamp)}</div>
            </div>
            <dl className="grid grid-cols-[120px_1fr] gap-y-2">
              <dt className="text-[#94A3B8]">Actor</dt>
              <dd className="m-0 font-semibold text-[#141416]">
                {selected.actorName} <span className="font-normal text-[#94A3B8]">({selected.actorType})</span>
              </dd>
              <dt className="text-[#94A3B8]">Source system</dt>
              <dd className="m-0">
                <SystemChip name={selected.source} />
              </dd>
              <dt className="text-[#94A3B8]">Source reference</dt>
              <dd className="m-0 font-mono text-[11px] break-all">{selected.sourceRef}</dd>
              <dt className="text-[#94A3B8]">Entity</dt>
              <dd className="m-0">{selected.entity}</dd>
              {selected.journeyStep && (
                <>
                  <dt className="text-[#94A3B8]">Journey step</dt>
                  <dd className="m-0">
                    <Link href={`/orchestration${selected.caseId ? `?case=${selected.caseId}` : ''}`} className="text-[#141416] font-semibold hover:underline">
                      Step {selected.journeyStep}
                    </Link>
                  </dd>
                </>
              )}
            </dl>
            <div>
              <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Payload summary</div>
              <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#141416]">{selected.payloadSummary}</div>
            </div>
            {selected.caseId && (
              <div>
                <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Related case</div>
                <div className="flex items-center justify-between p-3 border border-[#E2E8F0] rounded-xl">
                  <CaseLink id={selected.caseId} label={selected.entity.split(' · ').slice(1).join(' · ')} />
                  <div className="flex items-center gap-2 shrink-0">
                    <Link href={`/orchestration?case=${selected.caseId}&trace=1`} className="text-[11px] font-semibold text-[#64748B] hover:text-[#141416]">
                      Run trace
                    </Link>
                    <Link href={`/product/case/${selected.caseId}`} className="text-[#94A3B8] hover:text-[#141416]" aria-label="Open case">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            )}
            <div>
              <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" /> Hash chain
              </div>
              <div className="space-y-2">
                {(
                  [
                    ['Provenance hash', selected.hash],
                    ['Previous entry', selected.prevHash],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-[#64748B]">{k}</span>
                      <button onClick={() => copy(v)} className="text-[#94A3B8] hover:text-[#141416] cursor-pointer" aria-label={`Copy ${k}`}>
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="font-mono text-[10px] text-[#141416] break-all mt-1">{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <CommentThread key={selected.id} kind="audit" id={selected.id} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
