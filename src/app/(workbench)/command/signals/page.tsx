'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { message } from 'antd';
import { Truck, TriangleAlert, Warehouse } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { commandService, type CapacityImpact, type InboundRow } from '@/services/commandService';
import { metricsService } from '@/services/metricsService';
import { alertService } from '@/services/alertService';
import { DataTable, ErrorState, KpiSkeletonRow, ListSkeleton, MetricCard, PageActions, PageHeader, ProgressBar, StatusBadge, type DataColumn } from '@/components/ui';
import { SectionCard } from '@/components/command/CommandUi';
import { formatAsOf } from '@/components/command/commandUtils';
import type { Tone } from '@/theme/tokens';

const IMPACT: Record<CapacityImpact, { label: string; tone: Tone }> = {
  normal: { label: 'Within Limits', tone: 'success' },
  tight: { label: 'Nearing Capacity', tone: 'warning' },
  alert: { label: 'Capacity Alert', tone: 'danger' },
};
const ALERT_TONE: Record<'danger' | 'warning' | 'info', Tone> = { danger: 'danger', warning: 'warning', info: 'info' };

const pct = (used: number, cap: number) => (cap ? Math.round((used / cap) * 100) : 0);
/** Dock utilisation from which an ASN shows its capacity chip. */
const DOCK_ALERT_PCT = 90;
const toneFor = (p: number): Tone => (p >= 100 ? 'danger' : p >= 85 ? 'warning' : 'success');

function arrival(iso: string) {
  const d = new Date(iso);
  const asOf = new Date(metricsService.meta().asOf);
  const days = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())) / 864e5);
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`} ${time}`;
}

export default function SignalsAndCapacityPage() {
  const { currentRole } = useAuth();
  const [confirming, setConfirming] = useState<string | null>(null);

  const cap = useServiceQuery(() => metricsService.capacity(), []);
  const inbound = useServiceQuery(() => commandService.inbound(), [], { subscribe: commandService.subscribe });
  const alerts = useServiceQuery(() => alertService.list(currentRole), [currentRole], { subscribe: alertService.subscribe });

  const capRows = useMemo(() => cap.data ?? [], [cap.data]);
  const asns = useMemo(() => inbound.data ?? [], [inbound.data]);
  const signals = useMemo(() => alerts.data ?? [], [alerts.data]);

  const kpis = useMemo(() => {
    const pending = asns.filter((a) => a.status === 'expected');
    return {
      pendingUnits: pending.reduce((s, a) => s + a.units, 0),
      pending,
      unread: signals.filter((a) => !a.read).length,
    };
  }, [asns, signals]);

  const confirmBay = async (r: InboundRow) => {
    setConfirming(r.id);
    try {
      await commandService.confirmBay(r.id);
      message.success(`Bay reserved for ${r.id}: ${r.bay.label}.`);
    } catch {
      message.error('The reservation failed. Nothing was changed.');
    } finally {
      setConfirming(null);
    }
  };

  const markRead = async (id: string) => {
    try {
      await alertService.markRead(id);
    } catch {
      message.error('Could not update the signal.');
    }
  };

  const columns: DataColumn<InboundRow>[] = [
    { title: 'ASN ID', key: 'id', priority: 1, ellipsis: false, render: (_, r) => <span className="font-mono text-xs font-bold text-[#0F172A]">{r.id}</span> },
    {
      title: 'Carrier & Vehicle Ref',
      key: 'carrier',
      priority: 2,
      render: (_, r) => (
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#0F172A]">
          <Truck size={14} className="shrink-0 text-[#64748B]" />
          <span className="line-clamp-2 break-words">{r.carrier}</span>
        </div>
      ),
    },
    { title: 'Origin Site', key: 'origin', priority: 3, render: (_, r) => <span className="text-xs text-[#334155]">{r.origin}</span> },
    { title: 'Est. Arrival Window', key: 'arrival', priority: 2, render: (_, r) => <span className="font-mono text-xs font-medium text-[#0F172A]">{arrival(r.arrivalAt)}</span> },
    {
      title: 'Units / Class',
      key: 'units',
      priority: 3,
      render: (_, r) => (
        <div className="min-w-0">
          <span className="font-mono text-xs font-bold text-[#0F172A]">{r.units} units</span>
          <div className="line-clamp-2 break-words text-[10px] text-[#64748B]">{r.productClass}</div>
        </div>
      ),
    },
    {
      title: 'Allocated Staging Bay',
      key: 'bay',
      priority: 2,
      render: (_, r) => (
        <div className="min-w-0">
          <div className="line-clamp-2 break-words text-xs font-semibold text-[#0F172A]">{r.bay.label}</div>
          <div className="text-[10px] text-[#64748B]">
            {r.bay.used}/{r.bay.capacity} {r.bay.unit} used
          </div>
        </div>
      ),
    },
    {
      title: 'Capacity Impact',
      key: 'impact',
      priority: 1,
      ellipsis: false,
      // The chip only shows when the dock is already at 90 % or more; otherwise a quiet projection.
      render: (_, r) =>
        pct(r.bay.used, r.bay.capacity) >= DOCK_ALERT_PCT && r.impact !== 'normal' ? (
          <StatusBadge tone={IMPACT[r.impact].tone}>{IMPACT[r.impact].label}</StatusBadge>
        ) : (
          <span className="whitespace-nowrap text-[11px] text-[#64748B]">{pct(r.bay.used + r.units, r.bay.capacity)}% after arrival</span>
        ),
    },
    {
      title: 'Action',
      key: 'action',
      priority: 1,
      align: 'right',
      ellipsis: false,
      render: (_, r) =>
        r.status === 'bay_confirmed' ? (
          <span className="whitespace-nowrap text-xs font-semibold text-[#059669]">Bay confirmed</span>
        ) : (
          <button
            type="button"
            onClick={() => confirmBay(r)}
            disabled={confirming === r.id}
            className="cursor-pointer whitespace-nowrap rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400 disabled:opacity-60"
          >
            {confirming === r.id ? 'Confirming…' : 'Confirm bay'}
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-6 pb-16">
      <PageHeader
        title="Signals & capacity"
        description="Operational balance between inspection, repair and dock capacity, the signals that need attention, and upcoming inbound shipments."
        actions={<PageActions meta={`As of ${formatAsOf(metricsService.meta().asOf)}`} />}
      />

      {/* Utilisation and unread counts are on the bars and the list below; the waiting shipments are the one figure they don't show. */}
      {inbound.initialLoading ? (
        <KpiSkeletonRow count={1} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Inbound Carrier ASNs" value={kpis.pending.length} unit={`shipments (${kpis.pendingUnits} units)`} icon={<Truck />} iconTone="blue" context="Bay not yet confirmed" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Capacity by Resource" description="Configured planning capacity versus current load." icon={<Warehouse />}>
          {cap.initialLoading ? (
            <ListSkeleton rows={4} />
          ) : cap.error ? (
            <ErrorState onRetry={cap.refetch} compact />
          ) : (
            <ul className="m-0 list-none space-y-4 p-0">
              {capRows.map((c) => {
                const p = pct(c.used, c.capacity);
                return (
                  <li key={c.id} className="min-w-0 space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 line-clamp-2 break-words font-bold text-[#0F172A]">{c.label}</span>
                      <span className="shrink-0 font-mono font-bold" style={{ color: p >= 100 ? '#DC2626' : p >= 85 ? '#D97706' : '#059669' }}>
                        {p}%
                      </span>
                    </div>
                    <ProgressBar value={c.used} max={c.capacity} tone={toneFor(p)} label={`${c.label} utilisation`} />
                    <div className="flex justify-between font-mono text-[11px] text-[#64748B]">
                      <span>{c.used} used</span>
                      <span>
                        {c.capacity} {c.unit}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Signals"
          description={alerts.initialLoading ? 'Alerts for your role, newest first.' : `${kpis.unread} unread of ${signals.length}. Alerts for the ${currentRole} role, newest first.`}
          icon={<TriangleAlert />}
        >
          {alerts.initialLoading ? (
            <ListSkeleton rows={4} />
          ) : alerts.error ? (
            <ErrorState onRetry={alerts.refetch} compact />
          ) : !signals.length ? (
            <p className="m-0 py-6 text-center text-xs text-[#94A3B8]">No signals for the {currentRole} role.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-[#F1F5F9] p-0">
              {signals.map((a) => (
                <li key={a.id} className={`flex items-start gap-3 py-2.5 text-xs ${a.read ? 'opacity-70' : ''}`}>
                  <StatusBadge tone={ALERT_TONE[a.severity]} className="mt-0.5 shrink-0">
                    {a.severity === 'danger' ? 'Critical' : a.severity === 'warning' ? 'Warning' : 'Info'}
                  </StatusBadge>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[#141416]">{a.title}</div>
                    <div className="mt-0.5 text-[#64748B]">{a.body}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                      <span className="text-[#94A3B8]">{a.source}</span>
                      <Link href={a.link} className="font-semibold text-[#141416] hover:underline">
                        Open
                      </Link>
                      {!a.read && (
                        <button type="button" onClick={() => markRead(a.id)} className="cursor-pointer font-semibold text-[#64748B] hover:text-[#141416]">
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Inbound Advance Shipping Notices (ASNs)" description="Confirm a bay before the shipment arrives." icon={<Truck />}>
        {inbound.error && !inbound.data ? (
          <ErrorState onRetry={inbound.refetch} />
        ) : (
          <DataTable<InboundRow>
            rowKey="id"
            columns={columns.map((c) => ({ ...c, ellipsis: false }))}
            dataSource={asns}
            initialLoading={inbound.initialLoading}
            refreshing={inbound.loading && !inbound.initialLoading}
            emptyTitle="No inbound shipments"
            pagination={false}
          />
        )}
      </SectionCard>
    </div>
  );
}
