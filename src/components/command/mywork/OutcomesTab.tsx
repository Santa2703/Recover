'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { message } from 'antd';
import { CheckCircle2, ClipboardCheck, Landmark, Receipt, TrendingUp } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { commandService, type OutcomeRow, type OutcomeStatus } from '@/services/commandService';
import { DataTable, ErrorState, KpiSkeletonRow, MetricCard, StatusBadge, type DataColumn } from '@/components/ui';
import type { Tone } from '@/theme/tokens';
import { CommandFilters, CommandSelect, RoutePill, SectionCard } from '@/components/command/CommandUi';
import { downloadCsv, fmtMoney, fmtUsd } from '@/components/command/commandUtils';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import { TabToolbar } from './TabToolbar';

type StatusFilter = OutcomeStatus | 'open' | 'all';
const STATUS_META: Record<OutcomeStatus, { label: string; tone: Tone }> = {
  pending_invoice: { label: 'Pending Invoice', tone: 'warning' },
  confirmed: { label: 'Confirmed Receipt', tone: 'info' },
  reconciled: { label: 'Audited & Closed', tone: 'success' },
};

/** My work › Outcomes to confirm: reported outcomes to confirm and reconcile against the ledger. */
export function OutcomesTab() {
  const { scope } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [busy, setBusy] = useState<string | null>(null);

  const q = useServiceQuery(() => commandService.outcomes({ search, status }, scope), [search, status, scope.tenant, scope.site], { subscribe: commandService.subscribe });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const kpis = useMemo(() => {
    const predicted = rows.reduce((s, r) => s + r.predicted, 0);
    const actual = rows.reduce((s, r) => s + r.actual, 0);
    return { predicted, actual, variance: actual - predicted, pendingInvoice: rows.filter((r) => r.status === 'pending_invoice').length };
  }, [rows]);

  const filtered = !!search || status !== 'open';
  const clear = () => {
    setSearch('');
    setStatus('open');
  };

  const advance = async (r: OutcomeRow) => {
    setBusy(r.id);
    try {
      if (r.status === 'pending_invoice') {
        await commandService.confirmReceipt(r.id);
        message.success(`Receipt confirmed for ${r.id}. It is ready to reconcile.`);
      } else {
        await commandService.reconcile(r.id);
        message.success(`${r.id} reconciled with the ledger and closed.`);
      }
    } catch {
      message.error('That did not work. Nothing was changed.');
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () =>
    downloadCsv(
      'outcomes-to-confirm.csv',
      ['Case ID', 'Asset', 'Route', 'Predicted', 'Realised actual', 'Variance', 'Evidence', 'ERP reference', 'Reported', 'Status'],
      rows.map((r) => [r.id, r.case.productName, DISPOSITION_ROUTES[r.case.recommendedRoute]?.name, r.predicted, r.actual, r.variance, r.evidenceDoc, r.erpRef, r.reportedAt, STATUS_META[r.status].label]),
    );

  const columns: DataColumn<OutcomeRow>[] = [
    {
      title: 'Case ID',
      key: 'id',
      priority: 1,
      ellipsis: false,
      render: (_, r) => (
        <Link href={`/product/case/${r.id}`} className="whitespace-nowrap font-mono font-bold text-[#0F172A] hover:underline">
          {r.id}
        </Link>
      ),
    },
    { title: 'Asset Name', key: 'asset', priority: 2, render: (_, r) => <span className="text-xs font-semibold text-[#0F172A]">{r.case.productName}</span> },
    { title: 'Disposition Route', key: 'route', priority: 3, render: (_, r) => <RoutePill route={r.case.recommendedRoute} /> },
    { title: 'Predicted', key: 'predicted', priority: 3, align: 'right', ellipsis: false, render: (_, r) => <span className="font-mono text-xs text-[#64748B]">{fmtUsd(r.predicted)}</span> },
    { title: 'Realized Actual', key: 'actual', priority: 2, align: 'right', ellipsis: false, render: (_, r) => <span className="font-mono text-xs font-bold text-[#0F172A]">{fmtUsd(r.actual)}</span> },
    {
      title: 'Variance',
      key: 'variance',
      priority: 1,
      align: 'right',
      ellipsis: false,
      render: (_, r) => (
        <span className={`font-mono text-xs font-bold ${r.variance === 0 ? 'text-[#64748B]' : r.variance > 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
          {r.variance > 0 ? '+' : ''}
          {fmtUsd(r.variance)}
        </span>
      ),
    },
    {
      title: 'Evidence & ERP Reference',
      key: 'evidence',
      priority: 3,
      render: (_, r) => (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1 text-xs font-medium text-[#0F172A]">
            <Receipt size={13} className="shrink-0 text-[#64748B]" />
            <span className="line-clamp-2 break-words">{r.evidenceDoc}</span>
          </div>
          <div className="font-mono text-[10px] text-[#64748B]">{r.erpRef}</div>
        </div>
      ),
    },
    { title: 'Audit Status', key: 'status', priority: 2, ellipsis: false, render: (_, r) => <StatusBadge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</StatusBadge> },
    {
      title: 'Action',
      key: 'action',
      priority: 1,
      align: 'right',
      ellipsis: false,
      render: (_, r) =>
        r.status === 'reconciled' ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-[#059669]">
            <CheckCircle2 size={14} /> Audited
          </span>
        ) : (
          <button
            type="button"
            disabled={busy === r.id}
            onClick={() => advance(r)}
            className="cursor-pointer whitespace-nowrap rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400 disabled:opacity-60"
          >
            {busy === r.id ? 'Saving…' : r.status === 'confirmed' ? 'Reconcile' : 'Confirm receipt'}
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <TabToolbar
        description={
          <>
            Closed-loop reconciliation: compare predicted recovery with the value actually realised, then close each outcome against the ledger. The monthly trend is on{' '}
            <Link href="/command" className="font-semibold text-[#141416] underline underline-offset-2">
              Key figures
            </Link>
            .
          </>
        }
        onExport={exportCsv}
        canExport={!!rows.length}
      />

      {q.initialLoading ? (
        <KpiSkeletonRow />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Outcomes Listed" value={rows.length} unit="cases" icon={<ClipboardCheck />} context={`${kpis.pendingInvoice} awaiting final invoices`} />
          <MetricCard label="Predicted Recovery" value={fmtMoney(kpis.predicted)} icon={<Landmark />} iconTone="slate" context="What the model expected" />
          <MetricCard label="Total Realized Recovery" value={fmtMoney(kpis.actual)} icon={<TrendingUp />} iconTone="green" context="Reported by the executing systems" />
          <MetricCard
            label="Variance vs Predicted"
            value={`${kpis.variance >= 0 ? '+' : ''}${fmtMoney(kpis.variance)}`}
            icon={<Receipt />}
            iconTone={kpis.variance >= 0 ? 'green' : 'red'}
            context={kpis.predicted ? `${((kpis.actual / kpis.predicted) * 100).toFixed(1)}% of predicted` : '—'}
          />
        </div>
      )}

      <CommandFilters search={search} onSearch={setSearch} placeholder="Search by Case ID, asset, evidence or ERP reference..." onClear={clear} canClear={filtered}>
        <CommandSelect<StatusFilter>
          label="Audit status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'To confirm' },
            { value: 'pending_invoice', label: 'Pending invoice' },
            { value: 'confirmed', label: 'Confirmed receipt' },
            { value: 'reconciled', label: 'Audited & closed' },
            { value: 'all', label: 'All statuses' },
          ]}
        />
      </CommandFilters>

      <SectionCard
        title="Realized Ledger Reconciliation"
        description="Confirm the receipt when the invoice or transfer evidence arrives, then reconcile."
        icon={<Receipt />}
      >
        {q.error && !q.data ? (
          <ErrorState onRetry={q.refetch} />
        ) : (
          <DataTable<OutcomeRow>
            rowKey="id"
            columns={columns.map((c) => ({ ...c, ellipsis: false }))}
            dataSource={rows}
            initialLoading={q.initialLoading}
            refreshing={q.loading && !q.initialLoading}
            filtered={filtered}
            onClearFilters={clear}
            emptyTitle="No outcomes to confirm"
            emptyDescription="Every reported outcome in your scope has been reconciled."
            pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
          />
        )}
      </SectionCard>
    </div>
  );
}
