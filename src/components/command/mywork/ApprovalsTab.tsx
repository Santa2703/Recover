'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, message, Modal, Tooltip } from 'antd';
import { CheckCircle, Clock, DollarSign, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { commandService, type ApprovalRow, type ApprovalTier } from '@/services/commandService';
import { DataTable, ErrorState, KpiSkeletonRow, MetricCard, StatusBadge, type DataColumn } from '@/components/ui';
import { CommandFilters, CommandSelect, RoutePill, SectionCard } from '@/components/command/CommandUi';
import { downloadCsv, fmtMoney, fmtUsd, formatDay } from '@/components/command/commandUtils';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import { rememberQueue } from '@/components/product/queueContext';
import { myWorkHref } from './myWorkTabs';
import { TabToolbar } from './TabToolbar';

/** Route the approver signs off: the proposed route when a planner proposed another one. */
const signedRoute = (r: ApprovalRow) => r.proposal?.route ?? r.case.recommendedRoute;
const signedNet = (r: ApprovalRow) => r.proposedNet ?? r.case.estimatedNetRecovery;

type TierFilter = ApprovalTier | 'all';

/**
 * My work › Approvals: cases awaiting sign-off. `onShowHandedOff` switches to the Handed off tab
 * (offered in the toast after an approval).
 */
export function ApprovalsTab({ onShowHandedOff }: { onShowHandedOff?: () => void }) {
  const router = useRouter();
  const { scope, isApprover, currentRole } = useAuth();
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');
  const [page, setPage] = useState(1);
  const [signing, setSigning] = useState<ApprovalRow | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'decline' | 'evidence'>(null);

  const q = useServiceQuery(() => commandService.approvals({ search, tier }, scope), [search, tier, scope.tenant, scope.site], {
    subscribe: commandService.subscribe,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  // The Case page offers Back to Approvals and Previous / Next over the rows shown (oldest first).
  const fromQueue = () => rememberQueue('Approvals inbox', myWorkHref('approvals'), rows.map((r) => r.id));

  const kpis = useMemo(() => {
    const value = rows.reduce((s, r) => s + r.case.estimatedNetRecovery, 0);
    const high = rows.filter((r) => r.tier !== 'Level 1');
    const wait = rows.length ? rows.reduce((s, r) => s + r.waitingDays, 0) / rows.length : 0;
    const oldest = rows.reduce((m, r) => Math.max(m, r.waitingDays), 0);
    return { value, high, wait, oldest };
  }, [rows]);

  const filtered = !!search || tier !== 'all';
  const clear = () => {
    setSearch('');
    setTier('all');
    setPage(1);
  };

  const close = () => {
    setSigning(null);
    setComment('');
  };

  const act = async (kind: 'approve' | 'decline' | 'evidence') => {
    if (!signing) return;
    const c = signing;
    setBusy(kind);
    try {
      if (kind === 'approve') {
        await commandService.approve(c.id, comment.trim());
        // The toast is rendered outside the app tree, so it switches tabs through a callback instead of a <Link>.
        const key = `approved-${c.id}`;
        message.success({
          key,
          duration: 6,
          content: (
            <span>
              {c.id} approved for {DISPOSITION_ROUTES[signedRoute(c)]?.name}.{' '}
              <button
                type="button"
                onClick={() => {
                  message.destroy(key);
                  if (onShowHandedOff) onShowHandedOff();
                  else router.push(myWorkHref('handed-off'));
                }}
                className="cursor-pointer border-none bg-transparent p-0 font-bold text-[#141416] underline underline-offset-2"
              >
                View in Handed off
              </button>
            </span>
          ),
        });
      } else if (kind === 'decline') {
        await commandService.decline(c.id, comment.trim());
        message.success(`${c.id} declined and sent back for re-evaluation.`);
      } else {
        await commandService.requestEvidence(c.id);
        message.success(`Evidence requested for ${c.id}. The planner has been asked for more information.`);
      }
      close();
    } catch {
      message.error('That did not work. Nothing was changed.');
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () =>
    downloadCsv(
      'approvals-inbox.csv',
      ['Case ID', 'Equipment', 'Asset tag', 'Proposed treatment', 'Authority tier', 'Trigger reason', 'AI confidence %', 'Net recovery', 'Submitted by', 'Submitted at'],
      rows.map((r) => [r.id, r.case.productName, r.case.assetTag, DISPOSITION_ROUTES[r.case.recommendedRoute]?.name, r.tier, r.trigger, r.confidence, r.case.estimatedNetRecovery, r.submittedBy, r.submittedAt]),
    );

  // Sign off is only shown to roles that can approve; everyone else gets "View".
  const signButton = (r: ApprovalRow) =>
    isApprover ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSigning(r);
        }}
        className="cursor-pointer whitespace-nowrap rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#141416] shadow-2xs transition-all hover:border-gray-400"
      >
        Sign off
      </button>
    ) : null;

  const columns: DataColumn<ApprovalRow>[] = [
    {
      title: 'Case ID',
      key: 'id',
      priority: 1,
      ellipsis: false,
      render: (_, r) => (
        <div className="flex flex-col items-start gap-1">
          <Link
            href={`/product/case/${r.id}`}
            onClick={(e) => {
              e.stopPropagation();
              fromQueue();
            }}
            className="whitespace-nowrap font-mono font-bold text-[#141416] hover:underline"
          >
            {r.id}
          </Link>
          {r.proposal && (
            <StatusBadge tone="info" icon={false}>
              Proposed
            </StatusBadge>
          )}
        </div>
      ),
    },
    {
      title: 'Equipment / SKU',
      key: 'asset',
      priority: 2,
      render: (_, r) => (
        <div className="min-w-0">
          <div className="line-clamp-2 break-words font-semibold text-[#141416]">{r.case.productName}</div>
          <div className="line-clamp-2 break-words font-mono text-[11px] text-[#64748B]">{r.case.assetTag}</div>
        </div>
      ),
    },
    {
      title: 'Proposed Treatment',
      key: 'route',
      priority: 2,
      render: (_, r) => (
        <div className="min-w-0">
          <RoutePill route={signedRoute(r)} />
          {r.proposal?.route && (
            <div className="mt-0.5 line-clamp-2 break-words text-[11px] text-[#64748B]">
              Circularity: {DISPOSITION_ROUTES[r.case.recommendedRoute]?.name} · {r.proposal.reason}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Trigger Reason',
      key: 'trigger',
      priority: 3,
      render: (_, r) => (
        <Tooltip title={r.trigger}>
          <span className="text-[#334155]">{r.trigger}</span>
        </Tooltip>
      ),
    },
    { title: 'AI Confidence', key: 'conf', priority: 3, align: 'right', render: (_, r) => <span className="font-mono text-xs font-bold text-emerald-700">{r.confidence}%</span> },
    {
      title: 'Net Recovery',
      key: 'value',
      priority: 1,
      align: 'right',
      ellipsis: false,
      render: (_, r) => <span className={`font-mono text-xs font-bold ${signedNet(r) < 0 ? 'text-[#B91C1C]' : 'text-emerald-700'}`}>{fmtUsd(signedNet(r))}</span>,
    },
    {
      title: 'Submitted By',
      key: 'by',
      priority: 3,
      render: (_, r) => (
        <div className="min-w-0">
          <div className="line-clamp-2 break-words font-medium text-[#141416]">{r.submittedBy}</div>
          <div className="text-[11px] text-[#94A3B8]">
            {formatDay(r.submittedAt)} · {r.waitingDays}d waiting
          </div>
        </div>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      priority: 1,
      align: 'right',
      ellipsis: false,
      render: (_, r) => (
        <div className="flex items-center justify-end gap-1.5">
          {signButton(r)}
          <Link
            href={`/product/case/${r.id}`}
            onClick={(e) => {
              e.stopPropagation();
              fromQueue();
            }}
            className="whitespace-nowrap rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] shadow-2xs transition-all hover:border-gray-400"
          >
            View
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <TabToolbar
        description="Decisions exceeding financial thresholds or triggering policy variance checks that need an approver's sign-off."
        onExport={exportCsv}
        canExport={!!rows.length}
      />

      {!isApprover && (
        <div role="note" className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5 text-xs text-[#475569]">
          You are viewing as <strong className="text-[#141416]">{currentRole}</strong>. Only the Approver and Admin roles can sign off; open a case to see its decision.
        </div>
      )}

      {q.initialLoading ? (
        <KpiSkeletonRow count={2} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MetricCard label="High-Value (≥$5k)" value={kpis.high.length} unit="cases" icon={<DollarSign />} iconTone="blue" context="Level 2 & Executive tier" />
          <MetricCard label="Avg. Time Waiting" value={`${kpis.wait.toFixed(1)} days`} icon={<Clock />} context={`Oldest waiting ${kpis.oldest} days`} />
        </div>
      )}

      <CommandFilters
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search by Case ID, Asset, Trigger, or Planner..."
        onClear={clear}
        canClear={filtered}
      >
        <CommandSelect<TierFilter>
          label="Authority tier"
          value={tier}
          onChange={(v) => {
            setTier(v);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'All Authority Tiers' },
            { value: 'Level 1', label: 'Level 1 (<$5k)' },
            { value: 'Level 2', label: 'Level 2 ($5k–$25k)' },
            { value: 'Executive', label: 'Executive (>$25k)' },
          ]}
        />
      </CommandFilters>

      <SectionCard
        title={q.initialLoading ? 'Awaiting approval' : `Awaiting approval (${rows.length})`}
        description={`Oldest first${q.initialLoading ? '' : ` · ${fmtMoney(kpis.value)} net recovery`}. ${isApprover ? 'Sign off to approve, decline or ask for more evidence.' : 'Open a case to see its decision.'}`}
        icon={<ShieldCheck />}
      >
        {q.error && !q.data ? (
          <ErrorState onRetry={q.refetch} />
        ) : (
          <DataTable<ApprovalRow>
            rowKey="id"
            onRowClick={(r) => {
              if (isApprover) return setSigning(r);
              fromQueue();
              router.push(`/product/case/${r.id}`);
            }}
            columns={columns.map((c) => ({ ...c, ellipsis: false }))}
            dataSource={rows}
            initialLoading={q.initialLoading}
            refreshing={q.loading && !q.initialLoading}
            filtered={filtered}
            onClearFilters={clear}
            emptyTitle="Nothing awaiting approval"
            emptyDescription="Every decision in your scope has been signed off."
            pagination={{ current: page, pageSize: 10, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          />
        )}
      </SectionCard>

      <Modal
        title={
          <div className="flex items-center gap-2 text-[#0F172A]">
            <CheckCircle size={18} className="text-amber-500" />
            <span className="text-base font-bold">Sign off: {signing?.id}</span>
          </div>
        }
        open={!!signing}
        onCancel={close}
        footer={[
          <Button key="evidence" onClick={() => act('evidence')} loading={busy === 'evidence'} disabled={!!busy && busy !== 'evidence'}>
            Request evidence
          </Button>,
          // A disabled button fires no mouse events, so the tooltip hangs on a wrapper.
          <Tooltip key="decline" title={comment.trim() ? undefined : 'Add an approver rationale to decline'}>
            <span className="ml-2 inline-flex">
              <Button danger onClick={() => act('decline')} loading={busy === 'decline'} disabled={!comment.trim() || (!!busy && busy !== 'decline')}>
                Decline
              </Button>
            </span>
          </Tooltip>,
          <Button
            key="approve"
            onClick={() => act('approve')}
            loading={busy === 'approve'}
            disabled={!!busy && busy !== 'approve'}
            style={{ backgroundColor: '#FFD600', color: '#141416', borderColor: '#FFD600', fontWeight: 700 }}
          >
            Confirm & Authorize
          </Button>,
        ]}
      >
        {signing && (
          <div className="space-y-3 py-2 text-xs text-[#334155]">
            <p className="m-0">
              Authorizing <strong>{signing.case.productName}</strong> ({signing.case.assetTag}) for <strong>{DISPOSITION_ROUTES[signedRoute(signing)]?.name}</strong> with
              projected net recovery of <strong className="font-mono text-emerald-700">{fmtUsd(signedNet(signing))}</strong>.
            </p>
            {signing.proposal && (
              <div role="note" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[#075985]">
                <strong>Proposed by {signing.proposal.proposedBy}:</strong>{' '}
                {signing.proposal.route
                  ? `${DISPOSITION_ROUTES[signing.proposal.route]?.name} instead of Circularity's ${DISPOSITION_ROUTES[signing.case.recommendedRoute]?.name} (${signing.proposal.reason})`
                  : `Circularity's recommended route, ${DISPOSITION_ROUTES[signing.case.recommendedRoute]?.name}`}
                {signing.proposal.note ? ` · ${signing.proposal.note}` : ''}
              </div>
            )}
            <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 sm:grid-cols-2">
              {(
                [
                  ['Authority tier', signing.tier],
                  ['AI confidence', `${signing.confidence}%`],
                  ['Trigger', signing.trigger],
                  ['Submitted', `${signing.submittedBy}, ${formatDay(signing.submittedAt, true)}`],
                  ['Evidence', `${signing.case.evidenceCompleteness}% complete`],
                  ['Site', `${signing.case.location} · ${signing.case.tenant}`],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">{k}</dt>
                  <dd className="m-0 break-words">{v}</dd>
                </div>
              ))}
            </dl>
            <div>
              <label htmlFor="sign-rationale" className="mb-1 block font-semibold text-[#0F172A]">
                Approver rationale
              </label>
              <Input.TextArea
                id="sign-rationale"
                rows={2}
                placeholder="Approved per diagnostic testing standards and local spare part demand."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
