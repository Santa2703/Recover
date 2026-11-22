'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { message } from 'antd';
import { AlertTriangle, Check, CheckCircle2, Inbox, Loader2, X } from 'lucide-react';
import type { AgentStep, AgentStepId, InboxItem, RunAgentsResult } from '@/models/decision.model';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useAuth } from '@/store/authContext';
import { CHANNEL_LABEL, decisionService } from '@/services/decisionService';
import { caseLifecycleService } from '@/services/caseLifecycleService';
import { agentControlsService } from '@/services/agentControlsService';
import { formatKpiValue } from '@/components/ui';

const STEPS: { id: AgentStepId; label: string }[] = [
  { id: 'intake', label: 'Intake' },
  { id: 'condition', label: 'Condition' },
  { id: 'demand', label: 'Demand' },
  { id: 'fit', label: 'Fit for use' },
  { id: 'valuation', label: 'Valuation' },
  { id: 'decision', label: 'Decision' },
  { id: 'follow', label: 'Follow-through' },
];
const STEP_MS = 170;
/** Each item starts two steps after the previous one, so the agents visibly work through the queue. */
const STAGGER = 2;

const money = (n: number) => formatKpiValue(n, 'usd');
const signed = (n: number) => `${n < 0 ? '' : '+'}${money(n)}`;
const received = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

interface Run {
  items: InboxItem[];
  result?: RunAgentsResult;
}

function StepChip({ label, state, step }: { label: string; state: 'pending' | 'active' | 'done'; step?: AgentStep }) {
  const warn = state === 'done' && step?.status === 'warning';
  const cls =
    state === 'pending'
      ? 'border-[#E2E8F0] bg-white text-[#94A3B8]'
      : state === 'active'
        ? 'border-[#FDE047] bg-[#FFFBEB] text-[#92400E]'
        : warn
          ? 'border-[#FEF3C7] bg-[#FEF3C7] text-[#D97706]'
          : 'border-[#D1FAE5] bg-[#ECFDF5] text-[#047857]';
  return (
    <li
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors ${cls}`}
      title={state === 'done' ? step?.conclusion : undefined}
    >
      {state === 'active' ? (
        <Loader2 size={10} className="animate-spin" aria-hidden />
      ) : state === 'done' ? (
        warn ? <AlertTriangle size={10} aria-hidden /> : <Check size={10} strokeWidth={3} aria-hidden />
      ) : null}
      {label}
      <span className="sr-only">{state === 'done' ? (warn ? ', done with a warning' : ', done') : state === 'active' ? ', running' : ', waiting'}</span>
    </li>
  );
}

/** Dashboard inbox: new returns not yet decided → Run agents → decided, with the gain over the standard route. */
export function InboxPanel() {
  const reduced = useReducedMotion();
  const { scope, user, currentRole } = useAuth();
  const inbox = useServiceQuery(() => decisionService.inbox(scope), [scope.tenant, scope.site], { subscribe: decisionService.subscribe });
  // Kill switch: Run agents is refused while the agents are stopped (Access › Agent controls).
  const blockQ = useServiceQuery(() => caseLifecycleService.runAgentsBlock(), [], { subscribe: agentControlsService.subscribe });
  const blocked = blockQ.data ?? null;
  const [run, setRun] = useState<Run | null>(null);
  const [tick, setTick] = useState(0);
  const [refilling, setRefilling] = useState(false);

  const total = run ? (run.items.length - 1) * STAGGER + STEPS.length : 0;
  const animating = !!run && !reduced && tick < total;

  useEffect(() => {
    if (!animating) return;
    const t = setInterval(() => setTick((x) => x + 1), STEP_MS);
    return () => clearInterval(t);
  }, [animating]);

  const start = () => {
    const items = inbox.data ?? [];
    if (!items.length) return;
    setTick(0);
    setRun({ items });
    caseLifecycleService
      .runAgents(scope, { id: user.id, name: user.name, role: currentRole })
      .then((result) => setRun((r) => (r ? { ...r, items: r.items.filter((it) => result.decided.some((d) => d.caseId === it.case.id)), result } : r)))
      .catch((e: unknown) => {
        setRun(null);
        message.error(e instanceof Error ? e.message : 'The agents could not run. Try again.');
      });
  };

  const refill = () => {
    setRefilling(true);
    decisionService
      .refillInbox(scope)
      .then(() => setRun(null))
      .finally(() => setRefilling(false));
  };

  const items = inbox.data ?? [];

  // Result: once the agents have finished (and the animation, unless reduced motion).
  if (run?.result && !animating) {
    const r = run.result;
    const n = r.decided.length;
    const first = r.decided[0]?.caseId;
    return (
      <section aria-live="polite" className="flex flex-col gap-3 rounded-2xl border border-[#D1FAE5] bg-[#F0FDF4] px-5 py-3.5 shadow-2xs md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#059669]" aria-hidden />
          <div className="min-w-0 text-xs">
            <div className="font-extrabold text-[#141416]">
              Prepared {n} {n === 1 ? 'decision' : 'decisions'} for the Planner ·{' '}
              <span className="text-[#047857]">{signed(r.gainOverStandard)} over the standard route</span> · <span className="font-mono">{money(r.net)}</span> net
            </div>
            <p className="m-0 mt-0.5 text-[11px] text-[#475569]">
              Each waits in the Planner&apos;s My work › Tasks as &quot;Review and send&quot;; nothing goes to the approver until the Planner sends it.
              {r.remaining ? ` ${r.remaining} more stay in the inbox (max items per bulk plan).` : ''}
            </p>
            <ul className="m-0 mt-1 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-[11px] text-[#475569]">
              {r.decided.map((d) => (
                <li key={d.caseId} className="min-w-0">
                  <Link href={`/product/case/${d.caseId}`} className="font-mono font-semibold text-[#141416] underline-offset-2 hover:underline">
                    {d.caseId}
                  </Link>{' '}
                  → {d.decision.best.routeName}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-end md:self-auto">
          <Link
            href={first ? '/command/actions' : '/product/received'}
            className="inline-flex items-center rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] no-underline hover:border-gray-400"
          >
            Open Planner tasks
          </Link>
          <button
            type="button"
            onClick={() => setRun(null)}
            aria-label="Dismiss result"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-[#64748B] hover:bg-white hover:text-[#141416]"
          >
            <X size={15} />
          </button>
        </div>
      </section>
    );
  }

  const running = !!run;
  const shown = running ? run.items : items;

  // Nothing waiting: one quiet line to bring in demo returns.
  if (!shown.length) {
    if (inbox.initialLoading) return null;
    return (
      <div className="-mt-3 flex flex-wrap items-center justify-end gap-x-2 text-[11px] text-[#94A3B8]">
        <span>No new returns waiting for a decision.</span>
        <button type="button" onClick={refill} disabled={refilling} className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-[#64748B] underline decoration-dotted underline-offset-2 hover:text-[#141416] disabled:opacity-50">
          Simulate 3 new returns
        </button>
      </div>
    );
  }

  const stateOf = (itemIndex: number, stepIndex: number): 'pending' | 'active' | 'done' => {
    if (reduced) return run?.result ? 'done' : 'pending';
    const at = itemIndex * STAGGER + stepIndex;
    return tick > at ? 'done' : tick === at ? 'active' : 'pending';
  };

  return (
    <section aria-label="New returns" aria-busy={running} className="rounded-2xl border border-[#E2E8F0] bg-white shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#FEF3C7] bg-[#FFFBEB] text-amber-500">
            <Inbox size={16} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-extrabold text-[#141416]">
              {shown.length} new {shown.length === 1 ? 'return' : 'returns'} received, not yet decided
            </h2>
            <p className="m-0 text-[11px] text-[#64748B]">
              {running
                ? 'Agents are grading, finding demand and valuing every route…'
                : blocked
                  ? blocked
                  : 'Run the agents to grade each return, find demand, value every route and prepare a decision for the Planner.'}
            </p>
          </div>
        </div>
        {/* A disabled button fires no hover events, so the reason hangs on a focusable wrapper. */}
        <span className="inline-flex shrink-0" tabIndex={blocked ? 0 : undefined} data-tip={blocked ?? undefined}>
          <button
            type="button"
            onClick={start}
            disabled={running || !!blocked || blockQ.initialLoading}
            className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border-none bg-[#FFD600] px-3.5 text-xs font-extrabold text-[#141416] hover:bg-[#FACC15] disabled:opacity-70 ${running ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed'}`}
          >
            {running && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {running ? 'Running agents' : blocked ? 'Agents stopped' : 'Run agents'}
          </button>
        </span>
      </div>
      <ul className="m-0 list-none divide-y divide-[#F1F5F9] border-t border-[#F1F5F9] p-0">
        {shown.map((it, i) => {
          const trail = run?.result?.decided.find((d) => d.caseId === it.case.id)?.trail;
          return (
            <li key={it.case.id} className="flex flex-col gap-1.5 px-5 py-2 lg:flex-row lg:items-center lg:gap-4">
              <div className="flex min-w-0 flex-1 items-baseline gap-2 text-xs">
                <span className="shrink-0 font-mono font-bold text-[#141416]">{it.case.id}</span>
                <span className="min-w-0 truncate text-[#141416]" title={it.case.productName}>
                  {it.case.productName}
                </span>
                <span className="hidden shrink-0 text-[#64748B] sm:inline">· {CHANNEL_LABEL[it.context.intakeChannel]}</span>
                <span className="shrink-0 text-[#94A3B8]">· {received(it.case.receivedDate)}</span>
              </div>
              {running && (
                <ol className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label={`Agent steps for ${it.case.id}`}>
                  {STEPS.map((s, si) => (
                    <StepChip key={s.id} label={s.label} state={stateOf(i, si)} step={trail?.find((t) => t.id === s.id)} />
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
