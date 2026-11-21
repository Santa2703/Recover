'use client';

import React, { useState } from 'react';
import { Drawer } from 'antd';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { DecisionHistoryRecord } from '@/models/decision.model';
import { CHANNEL_LABEL } from '@/services/decisionService';
import { drillSummary, hasCase, isWithin5, routeName, routeShort } from '@/services/portfolioAnalyticsService';
import { CaseLink, DataTable, StatusBadge, type DataColumn } from '@/components/ui';
import { fmtMoney, fmtPct, fmtSignedMoney, fmtSignedPct } from './AnalyticsControls';

/** Signed money for values that may be negative ("−$120"). */
const money = (n: number) => (n < 0 ? `−${fmtMoney(-n)}` : fmtMoney(n));
const errPct = (h: DecisionHistoryRecord) => (h.realisedNet - h.forecastNet) / Math.max(1, Math.abs(h.forecastNet));

export interface DrillTarget {
  /** Drawer title, e.g. "Owner override · missed by more than 5 %". */
  title: string;
  /** One line under the title. */
  description?: string;
  records: DecisionHistoryRecord[];
  /** Open this decision directly (e.g. a scatter dot). */
  focusId?: string | null;
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
      <div className="truncate text-[11px] font-semibold text-[#64748B]">{label}</div>
      <div className={`mt-0.5 font-mono text-base font-black ${tone === 'pos' ? 'text-[#047857]' : tone === 'neg' ? 'text-[#B91C1C]' : 'text-[#141416]'}`}>{value}</div>
    </div>
  );
}

function DecisionDetail({ h }: { h: DecisionHistoryRecord }) {
  const within = isWithin5(h);
  const rows: [string, React.ReactNode][] = [
    [
      'Case',
      hasCase(h.caseId) ? (
        <CaseLink key="c" id={h.caseId} label={h.snapshot.productName} />
      ) : (
        <span key="c">
          <span className="font-mono">{h.caseId}</span> {h.snapshot.productName} <span className="font-normal text-[#94A3B8]">(archived)</span>
        </span>
      ),
    ],
    ['Intake channel', CHANNEL_LABEL[h.channel]],
    ['Route executed', routeName(h.route)],
    ['Circularity recommended', routeName(h.recommendedRoute)],
    ['Standard route', `${routeName(h.standardRoute)} · ${money(h.standardNet)}`],
    ['Gain over standard (realised)', fmtSignedMoney(h.realisedGain)],
    ['Decided by', h.decidedBy === 'owner' ? `Owner override · ${h.actor}` : `Circularity's route · approved by ${h.actor}`],
    ['Override reason', h.overrideReason ?? 'None (Circularity’s route was kept)'],
    ['Grade · remaining life', `${h.snapshot.condition} · ${h.snapshot.lifePct} %`],
    ['Tenant · site', `${h.snapshot.tenant} · ${h.snapshot.site}`],
    ['Closed', `${h.closedAt}${h.closedDaysAgo ? ` (${h.closedDaysAgo} days ago)` : ' (today)'}`],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Forecast net" value={money(h.forecastNet)} />
        <Stat label="Realised net" value={money(h.realisedNet)} />
        <Stat label="Error" value={fmtSignedPct(errPct(h))} tone={within ? undefined : 'neg'} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={within ? 'success' : 'warning'}>{within ? 'Within 5 % of forecast' : 'Missed forecast by more than 5 %'}</StatusBadge>
        <StatusBadge tone={h.overridden ? 'info' : 'neutral'}>{h.overridden ? 'Owner override' : 'Circularity’s route'}</StatusBadge>
      </div>
      <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-3 text-xs sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">{k}</dt>
            <dd className="m-0 mt-0.5 break-words font-semibold text-[#141416]">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DrillBody({ target }: { target: DrillTarget }) {
  const [selectedId, setSelectedId] = useState<string | null>(target.focusId ?? null);
  const selected = selectedId ? target.records.find((r) => r.id === selectedId) : undefined;
  const s = drillSummary(target.records);

  if (selected) {
    return (
      <div className="space-y-4">
        {target.records.length > 1 && (
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] hover:border-gray-400"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All {target.records.length} decisions
          </button>
        )}
        <h3 className="m-0 font-mono text-sm font-extrabold text-[#141416]">{selected.id}</h3>
        <DecisionDetail h={selected} />
      </div>
    );
  }

  const columns: DataColumn<DecisionHistoryRecord>[] = [
    {
      title: 'Decision',
      key: 'decision',
      priority: 1,
      render: (_, h) => (
        <div className="min-w-0">
          <span className="font-mono text-xs font-bold text-[#141416]">{h.id}</span>
          <div className="truncate text-[11px] text-[#94A3B8]">
            {h.caseId} · {h.snapshot.productName}
          </div>
        </div>
      ),
    },
    {
      title: 'Route',
      key: 'route',
      priority: 2,
      render: (_, h) => (
        <span className="flex min-w-0 items-center gap-1 text-xs">
          {h.overridden && (
            <>
              <span className="truncate text-[#94A3B8]" title={routeName(h.recommendedRoute)}>
                {routeShort(h.recommendedRoute)}
              </span>
              <ArrowRight className="h-3 w-3 shrink-0 text-[#94A3B8]" />
            </>
          )}
          <span className="truncate font-semibold text-[#141416]" title={routeName(h.route)}>
            {routeShort(h.route)}
          </span>
        </span>
      ),
    },
    {
      title: 'Realised',
      key: 'realised',
      priority: 1,
      align: 'right',
      render: (_, h) => (
        <div className="text-right">
          <span className="font-mono text-xs font-bold text-[#141416]">{money(h.realisedNet)}</span>
          <div className={`font-mono text-[11px] ${isWithin5(h) ? 'text-[#94A3B8]' : 'text-[#B91C1C]'}`}>
            {fmtSignedPct(errPct(h))} vs {money(h.forecastNet)}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Decisions" value={s.n} />
        <Stat label="Realised net" value={money(s.realised)} />
        <Stat label="Gain over standard" value={fmtSignedMoney(s.gainOverStandard)} tone={s.gainOverStandard >= 0 ? 'pos' : 'neg'} />
        <Stat label="Forecast accuracy" value={fmtPct(s.accuracy, 1)} />
      </div>
      <p className="m-0 text-xs text-[#64748B]">Open a decision to see its forecast, realised value, standard route and any override reason.</p>
      <DataTable<DecisionHistoryRecord>
        columns={columns}
        dataSource={target.records}
        rowKey="id"
        pagination={target.records.length > 8 ? { pageSize: 8, size: 'small', showSizeChanger: false } : false}
        onRowClick={(h) => setSelectedId(h.id)}
        emptyTitle="No decisions here"
      />
    </div>
  );
}

/** Drawer with the decisions behind a chart bar / point / cell: summary KPIs, table, then one decision. */
export function DecisionDrillDown({ target, onClose }: { target: DrillTarget | null; onClose: () => void }) {
  return (
    <Drawer
      open={!!target}
      onClose={onClose}
      size={560}
      destroyOnHidden
      styles={{ wrapper: { maxWidth: '100vw' } }}
      title={
        target && (
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-[#141416]">{target.title}</div>
            {target.description && <div className="truncate text-xs font-normal text-[#64748B]">{target.description}</div>}
          </div>
        )
      }
    >
      {target && <DrillBody key={`${target.title}:${target.focusId ?? ''}`} target={target} />}
    </Drawer>
  );
}
