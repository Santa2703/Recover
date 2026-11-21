'use client';

import React from 'react';
import { Calculator, ChevronDown, CircleAlert, CircleCheck, Undo2, RotateCcw } from 'lucide-react';
import type { AgentStep, CaseDecision, DecisionHistoryRecord, NextBestAction, RouteId, RouteValue, ValueLine } from '@/models/decision.model';
import { CHANNEL_SHORT, fmtDay, sourceText, usd } from '@/services/decisionService';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import { StatusBadge } from '@/components/ui';
import type { Tone } from '@/theme/tokens';

/**
 * Decision building blocks for the Case page: next best action card, route ladder,
 * calculation table and agent trail. All numbers come from the decision engine
 * (decisionService) through the page; nothing is computed from literals here.
 */

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${usd(Math.abs(n))}`;

const PILL_TONE: Record<NextBestAction['pill'], Tone> = {
  'Against named demand': 'success',
  'Estimate · no buyer yet': 'warning',
  'No viable route': 'danger',
};

function RouteDot({ route }: { route: RouteId }) {
  return <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10" style={{ backgroundColor: DISPOSITION_ROUTES[route].color }} />;
}

function Banner({ tone, children, action }: { tone: 'info' | 'warning' | 'success' | 'neutral'; children: React.ReactNode; action?: React.ReactNode }) {
  const cls = {
    info: 'border-sky-200 bg-sky-50 text-[#075985]',
    warning: 'border-amber-200 bg-white text-[#92400E]',
    success: 'border-emerald-200 bg-emerald-50 text-[#065F46]',
    neutral: 'border-[#E2E8F0] bg-white text-[#334155]',
  }[tone];
  return (
    <div role="status" className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${cls}`}>
      <div className="min-w-0 break-words">{children}</div>
      {action}
    </div>
  );
}

const linkBtn = 'inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-semibold text-[#141416] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50';

/* ------------------------------------------------------------------ next best action */

const PROOF_PREVIEW = 4;

export function NextBestActionCard({
  action,
  decision,
  scenarioLabel,
  onResetScenario,
  outcome,
  onUndoOverride,
  undoBusy,
  ladder,
  ladderDescription,
  onShowCalculation,
  notice,
}: {
  action: NextBestAction;
  decision: CaseDecision;
  /** Short description of the active scenario, or null when showing the live decision. */
  scenarioLabel: string | null;
  onResetScenario: () => void;
  outcome: DecisionHistoryRecord | null;
  /** Shown when the decision is an owner override and the user may undo it. */
  onUndoOverride?: () => void;
  undoBusy?: boolean;
  /** The route ladder, shown beside the summary (≥1280px) or right under the headline. */
  ladder?: React.ReactNode;
  ladderDescription?: string;
  /** Opens the calculation of the chosen route ("How this is calculated"). */
  onShowCalculation?: () => void;
  /** Extra banner (e.g. a route proposal waiting for the approver). */
  notice?: React.ReactNode;
}) {
  const [allProof, setAllProof] = React.useState(false);
  const best = decision.best;
  const std = decision.standard;
  const channel = CHANNEL_SHORT[decision.channel];
  const proposed = action.label === 'Proposed action';
  const versus =
    std.route === best.route ? `Matches the ${channel} standard route` : `${signed(decision.gainOverStandard)} over the ${channel} standard route (${std.routeName}, ${usd(std.net)})`;
  const outcomeDelta = outcome ? (outcome.realisedNet - outcome.forecastNet) / Math.max(1, Math.abs(outcome.forecastNet)) : 0;
  const proofShown = allProof ? action.proof : action.proof.slice(0, PROOF_PREVIEW);
  const proofHidden = action.proof.length - PROOF_PREVIEW;

  return (
    <section aria-labelledby="nba-title" className="min-w-0 space-y-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-[#FFD600] px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-black">{action.label}</span>
            <StatusBadge tone={PILL_TONE[action.pill]}>{action.pill}</StatusBadge>
            {decision.override && !proposed && <StatusBadge tone="info">Owner override</StatusBadge>}
          </div>
          <h2 id="nba-title" className="m-0 break-words text-lg font-extrabold leading-snug text-[#141416]">
            {action.headline}
          </h2>
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#475569]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#0F172A]">
              <RouteDot route={best.route} />
              {best.routeName}
            </span>
            <span aria-hidden className="text-[#CBD5E1]">·</span>
            <span className={decision.gainOverStandard > 0 ? 'font-semibold text-[#047857]' : decision.gainOverStandard < 0 ? 'font-semibold text-[#B91C1C]' : ''}>{versus}</span>
            <span aria-hidden className="text-[#CBD5E1]">·</span>
            <span>executes in {best.executesIn}</span>
          </p>
        </div>
        <div className="shrink-0 md:text-right">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">Net value</div>
          <div className="font-mono text-2xl font-black text-[#141416]">{best.viable ? usd(action.net) : '—'}</div>
        </div>
      </div>

      {(scenarioLabel || (decision.override && !proposed) || action.planNote || outcome || notice) && (
        <div className="space-y-2">
          {notice}
          {scenarioLabel && (
            <Banner
              tone="warning"
              action={
                <button type="button" onClick={onResetScenario} className={linkBtn}>
                  <RotateCcw size={13} /> Reset
                </button>
              }
            >
              <strong>Scenario, not saved:</strong> {scenarioLabel}. Approval uses the live decision.
            </Banner>
          )}
          {decision.override && !proposed && (
            <Banner
              tone="neutral"
              action={
                onUndoOverride && (
                  <button type="button" onClick={onUndoOverride} disabled={undoBusy} className={linkBtn}>
                    <Undo2 size={13} /> {undoBusy ? 'Undoing…' : "Back to Circularity's route"}
                  </button>
                )
              }
            >
              <strong>{decision.override.actor}</strong> chose {best.routeName} instead of {DISPOSITION_ROUTES[decision.override.fromRoute].name}: {decision.override.reason}.
            </Banner>
          )}
          {action.planNote && (
            <Banner tone="info">
              <strong>Queue plan:</strong> {action.planNote}
            </Banner>
          )}
          {outcome && (
            <Banner tone="success">
              <strong>Outcome recorded:</strong> realised {usd(outcome.realisedNet)} vs forecast {usd(outcome.forecastNet)} ({outcomeDelta >= 0 ? '+' : '−'}
              {Math.abs(outcomeDelta * 100).toFixed(1)} %) · {outcome.id} by {outcome.actor}
            </Banner>
          )}
        </div>
      )}

      {/* ≥1280px: summary (steps + proof) left, route ladder right. Narrower: the ladder comes first, right under the headline. */}
      <div className="grid grid-cols-1 gap-5 border-t border-amber-200/70 pt-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {best.viable && (
          <div className="order-last min-w-0 space-y-4 xl:order-none">
            <div>
              <h3 className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#475569]">Steps</h3>
              <ol className="m-0 list-none space-y-1 p-0">
                {action.steps.map((s, i) => (
                  <li key={`${s.title}-${i}`} className="flex min-w-0 items-center gap-2 text-xs">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#141416] font-mono text-[10px] font-bold text-white">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <strong className="text-[#0F172A]">{s.title}</strong> <span className="text-[#64748B]">· {s.detail}</span>
                    </span>
                    <time dateTime={s.when} className="shrink-0 font-mono text-[11px] text-[#475569]">
                      {i === 0 && action.label !== 'Approved action' ? 'Today' : fmtDay(s.when)}
                    </time>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#475569]">Proof</h3>
              <ul id="nba-proof" className="m-0 list-none space-y-1 p-0">
                {proofShown.map((p) => (
                  <li key={p.heading} className="flex min-w-0 gap-2 text-xs">
                    {p.ok ? (
                      <CircleCheck size={14} className="mt-px shrink-0 text-[#059669]" aria-label="Checked" />
                    ) : (
                      <CircleAlert size={14} className="mt-px shrink-0 text-[#D97706]" aria-label="Needs attention" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={allProof ? 'break-words text-[#334155]' : 'truncate text-[#334155]'}>
                        <strong className="text-[#0F172A]">{p.heading}.</strong> {p.body}
                      </div>
                      {allProof && p.source && <div className="break-words text-[11px] text-[#64748B]">{p.source}</div>}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                {(proofHidden > 0 || action.proof.some((p) => p.source)) && (
                  <button type="button" onClick={() => setAllProof((o) => !o)} aria-expanded={allProof} aria-controls="nba-proof" className={linkBtn}>
                    {allProof ? 'Show less' : `Show all proof${proofHidden > 0 ? ` (${action.proof.length})` : ' and sources'}`}
                    <ChevronDown size={13} className={`transition-transform ${allProof ? 'rotate-180' : ''}`} aria-hidden />
                  </button>
                )}
                {onShowCalculation && (
                  <button type="button" onClick={onShowCalculation} className={linkBtn}>
                    <Calculator size={13} aria-hidden /> How this is calculated
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {ladder && (
          <div className={`min-w-0 ${best.viable ? '' : 'xl:col-span-2'}`}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="m-0 text-[11px] font-bold uppercase tracking-wider text-[#475569]">Route ladder</h3>
              {ladderDescription && <span className="text-[11px] text-[#64748B]">{ladderDescription}</span>}
            </div>
            {ladder}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ route ladder */

function DivergingBar({ value, min, max, highlight, label }: { value: number; min: number; max: number; highlight: boolean; label: string }) {
  const span = max - min || 1;
  const zero = ((0 - min) / span) * 100;
  const end = ((value - min) / span) * 100;
  const left = Math.min(zero, end);
  const width = Math.abs(end - zero);
  return (
    <div role="img" aria-label={label} className="relative h-3 w-full">
      <span aria-hidden className="absolute inset-y-[-3px] w-px bg-[#94A3B8]" style={{ left: `${zero}%` }} />
      {width > 0 && (
        <span
          aria-hidden
          className={`absolute inset-y-0 rounded-sm ${value < 0 ? 'bg-[#DC2626]' : highlight ? 'border border-[#A16207] bg-[#FFD600]' : 'bg-[#141416]'}`}
          style={{ left: `${left}%`, width: `${Math.max(width, 0.8)}%` }}
        />
      )}
    </div>
  );
}

export function RouteLadder({ decision, selected, onSelect, bestLabel }: { decision: CaseDecision; selected: RouteId | null; onSelect: (r: RouteId) => void; bestLabel: string }) {
  const viable = decision.all.filter((r) => r.viable);
  const nets = viable.map((r) => r.net);
  const max = Math.max(0, ...nets);
  const min = Math.min(0, ...nets);
  const channel = CHANNEL_SHORT[decision.channel];

  return (
    <ul className="@container m-0 list-none space-y-0.5 p-0" aria-label="Routes ranked by net value">
      {decision.all.map((r) => {
        const isBest = r.viable && r.route === decision.best.route;
        const isSel = r.route === selected;
        return (
          <li key={r.route}>
            <button
              type="button"
              aria-pressed={isSel}
              onClick={() => onSelect(r.route)}
              className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2 text-left transition-colors @2xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_5.5rem] ${
                isSel ? 'border-[#FDE68A] bg-white' : 'border-transparent hover:bg-white/70'
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <RouteDot route={r.route} />
                  <span className={`text-xs font-bold ${r.viable ? 'text-[#0F172A]' : 'text-[#64748B]'}`}>{r.routeName}</span>
                  {isBest && <StatusBadge tone="brand">{bestLabel}</StatusBadge>}
                  {decision.override?.fromRoute === r.route && <StatusBadge tone="neutral">Circularity&apos;s pick</StatusBadge>}
                  {r.route === decision.standardRoute && <StatusBadge tone="neutral" icon={false}>{channel} default</StatusBadge>}
                  {r.viable && r.committed && <StatusBadge tone="success">Named demand</StatusBadge>}
                  {r.viable && r.estimate && <StatusBadge tone="warning">Estimate</StatusBadge>}
                </div>
                {!r.viable && r.reason && <div className="mt-0.5 break-words text-[11px] text-[#64748B]">{r.reason}</div>}
              </div>
              {/* Narrow: the bar gets its own line; non-viable rows skip it (their reason and "—" say it). */}
              <div className={`order-last col-span-2 min-w-0 @2xl:order-none @2xl:col-span-1 ${r.viable ? '' : 'hidden @2xl:block'}`}>
                {r.viable && <DivergingBar value={r.net} min={min} max={max} highlight={isBest} label={`${r.routeName}: net ${usd(r.net)}`} />}
              </div>
              <div className={`text-right font-mono text-xs font-extrabold ${!r.viable ? 'text-[#94A3B8]' : r.net < 0 ? 'text-[#B91C1C]' : 'text-[#0F172A]'}`}>
                {r.viable ? usd(r.net) : <span aria-label="Not viable">—</span>}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ calculation */

const GROUPS: { type: ValueLine['type']; label: string }[] = [
  { type: 'value', label: 'Value' },
  { type: 'cost', label: 'Cost' },
  { type: 'time', label: 'Time' },
];

export function CalculationTable({ route, decision }: { route: RouteValue; decision: CaseDecision }) {
  const std = decision.standard;
  const channel = CHANNEL_SHORT[decision.channel];
  const t = route.timing;
  const delta = route.net - std.net;
  return (
    <div className="min-w-0 space-y-3">
      <p className="m-0 text-xs text-[#64748B]">
        Owner <strong className="text-[#0F172A]">{route.owner}</strong> · executes in {route.executesIn} · {t.leadDays} days lead
        {t.transfer ? ` + ${t.transferDays} transfer days` : ''} · ready {fmtDay(t.ready)}
        {t.neededBy ? ` · needed by ${fmtDay(t.neededBy)}` : ''}
      </p>
      {!route.viable && route.reason && (
        <Banner tone="warning">
          <strong>Not viable:</strong> {route.reason}
        </Banner>
      )}
      {route.lines.length > 0 && (
        <table className="w-full table-fixed border-collapse text-xs">
          <caption className="sr-only">Calculation for {route.routeName}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Line, basis and source</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          {GROUPS.map((g) => {
            const lines = route.lines.filter((l) => l.type === g.type);
            if (!lines.length) return null;
            const total = lines.reduce((s, l) => s + l.amount, 0);
            return (
              <tbody key={g.type}>
                <tr className="border-b border-[#E2E8F0]">
                  <th scope="rowgroup" className="pb-1 pt-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    {g.label}
                  </th>
                  <td className="w-24 pb-1 pt-3 text-right font-mono text-[11px] font-bold text-[#64748B]">
                    {g.type === 'value' ? '+' : '−'}
                    {usd(total)}
                  </td>
                </tr>
                {lines.map((l, i) => (
                  <tr key={`${l.kind}-${i}`} className="border-b border-[#F1F5F9] align-top">
                    <td className="min-w-0 py-2 pr-3">
                      <div className="break-words font-semibold text-[#0F172A]">{l.label}</div>
                      <div className="break-words text-[#475569]">{l.basis}</div>
                      {l.sources.map((s, j) => (
                        <div key={j} className="break-words text-[11px] text-[#64748B]">
                          {sourceText(s)}
                        </div>
                      ))}
                    </td>
                    <td className={`py-2 text-right font-mono font-semibold ${l.type === 'value' ? 'text-[#0F172A]' : 'text-[#B91C1C]'}`}>
                      {l.type === 'value' ? '+' : '−'}
                      {usd(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
          <tfoot>
            <tr>
              <td className="pt-3 text-[#475569]">
                <div className="font-semibold text-[#0F172A]">Value − cost − holding = net</div>
                <div className="font-mono text-[11px]">
                  {usd(route.gross)} − {usd(route.cost)} − {usd(route.holding)}
                </div>
              </td>
              <td className="pt-3 text-right align-top font-mono text-sm font-black text-[#141416]">{route.viable ? usd(route.net) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <p className="m-0 rounded-lg bg-[#F8FAFC] px-3 py-2 text-xs text-[#475569]">
        {route.route === decision.standardRoute
          ? `This is the ${channel} standard route: what the intake team would do without Circularity.`
          : route.viable && std.viable
            ? `${signed(delta)} compared with the ${channel} standard route (${std.routeName}, ${usd(std.net)}).`
            : `The ${channel} standard route is ${std.routeName}${std.viable ? ` at ${usd(std.net)}` : ' (not viable for this case)'}.`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ agent trail */

export function AgentTrail({ steps }: { steps: AgentStep[] }) {
  return (
    <ol className="m-0 list-none space-y-3 p-0">
      {steps.map((s, i) => (
        <li key={s.id} className="flex min-w-0 gap-2.5 text-xs">
          <span
            className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
              s.status === 'done' ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#FEF3C7] text-[#92400E]'
            }`}
          >
            {i + 1}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-[#0F172A]">{s.title}</span>
              {s.status === 'warning' && <StatusBadge tone="warning">Check</StatusBadge>}
            </div>
            <p className="m-0 break-words text-[#475569]">{s.conclusion}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
