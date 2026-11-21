'use client';

import React, { useState } from 'react';
import { Drawer } from 'antd';
import { ChevronRight, GitCompareArrows } from 'lucide-react';
import type { DecisionScope, DecisionSummary, IntakeChannel } from '@/models/decision.model';
import { openDecisions } from '@/services/decisionService';
import { StackedBarChart } from '@/components/charts';
import { CaseLink, ChartSkeleton, formatKpiValue } from '@/components/ui';
import { chartColors } from '@/theme/tokens';
import { SectionCard } from '@/components/dashboard/SectionCard';

const SHORT: Record<IntakeChannel, string> = { lease_end: 'Lease end', field_return: 'Field return', trade_in: 'Trade-in', excess: 'Excess stock' };
const money = (n: number) => formatKpiValue(n, 'usd');
const signed = (n: number) => `${n > 0 ? '+' : ''}${money(n)}`;
const TOP_CASES = 10;

/** Cases behind one channel's gap, biggest gain first (derived during render from the plan). */
function ChannelCases({ channel, scope }: { channel: IntakeChannel; scope: DecisionScope }) {
  const rows = openDecisions(scope)
    .filter((r) => r.decision.channel === channel)
    .sort((a, b) => b.decision.gainOverStandard - a.decision.gainOverStandard);
  if (!rows.length) return <p className="m-0 text-xs text-[#64748B]">No open decisions from this channel in scope.</p>;
  return (
    <div className="space-y-2 text-xs">
      <p className="m-0 text-[#64748B]">
        {rows.length} open {rows.length === 1 ? 'decision' : 'decisions'}. Top {Math.min(TOP_CASES, rows.length)} by gain over the standard route:
      </p>
      <ul className="m-0 list-none divide-y divide-[#F1F5F9] p-0">
        {rows.slice(0, TOP_CASES).map(({ case: c, decision: d }) => (
          <li key={c.id} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <CaseLink id={c.id} label={c.productName} />
              <div className="mt-0.5 truncate text-[11px] text-[#64748B]">
                {d.best.route === d.standardRoute
                  ? `Same as the standard route: ${d.best.routeName} ${money(d.best.net)}`
                  : `Standard ${d.standard.routeName} ${money(d.standard.net)} → ${d.best.routeName} ${money(d.best.net)}`}
              </div>
            </div>
            <span className={`shrink-0 font-mono font-bold ${d.gainOverStandard > 0 ? 'text-[#047857]' : 'text-[#64748B]'}`}>{signed(d.gainOverStandard)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Standard route vs best route per intake channel, with the cases behind each gap in a drawer. */
export function ChannelGapPanel({ data, scope, className = '' }: { data?: DecisionSummary; scope: DecisionScope; className?: string }) {
  const [channel, setChannel] = useState<IntakeChannel | null>(null);
  const channels = data?.byChannel.filter((c) => c.n > 0) ?? [];
  const selected = data?.byChannel.find((c) => c.channel === channel);
  return (
    <SectionCard className={className} title="Gap by intake channel" icon={<GitCompareArrows />}>
      {!data ? (
        <ChartSkeleton height={220} />
      ) : !channels.length ? (
        <div className="py-6 text-center text-xs text-[#64748B]">No open decisions in this scope.</div>
      ) : (
        <div className="space-y-4">
          <StackedBarChart
            grouped
            data={channels.map((c) => ({ channel: SHORT[c.channel], standard: c.standard, best: c.best }))}
            xKey="channel"
            series={[
              { key: 'standard', label: 'Standard route', color: chartColors.neutralSoft },
              { key: 'best', label: 'Best route (queue plan)', color: chartColors.actual },
            ]}
            valueFormat={money}
            height={200}
            ariaLabel={`Net value of open decisions per intake channel: standard route versus best route. ${channels.map((c) => `${c.label} ${signed(c.gain)}`).join('; ')}.`}
          />
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
            {channels.map((c) => (
              <li key={c.channel} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setChannel(c.channel)}
                  className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-left hover:border-gray-400"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-[#141416]">{c.label}</span>
                    <span className="block text-[11px] text-[#64748B]">
                      {c.n} {c.n === 1 ? 'decision' : 'decisions'}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className={`font-mono text-xs font-bold ${c.gain > 0 ? 'text-[#047857]' : 'text-[#64748B]'}`}>{signed(c.gain)}</span>
                    <ChevronRight size={14} className="text-[#94A3B8] group-hover:text-[#141416]" aria-hidden />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="m-0 text-[11px] text-[#64748B]">
            Standard route: what the intake team would do on its own. Best route: Circularity&apos;s queue plan. Select a channel to see the cases behind its gap.
          </p>
        </div>
      )}
      <Drawer
        open={!!channel}
        onClose={() => setChannel(null)}
        title={<span className="text-sm font-bold">{selected ? `${selected.label} · ${signed(selected.gain)} over the standard route` : "Channel"}</span>}
        size={460}
        destroyOnHidden
      >
        {channel && <ChannelCases channel={channel} scope={scope} />}
      </Drawer>
    </SectionCard>
  );
}
