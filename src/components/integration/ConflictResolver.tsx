'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { message } from 'antd';
import { CheckCircle, History, ShieldAlert } from 'lucide-react';
import { CaseLink } from '@/components/ui';
import { conflictService, hoursSince, type Conflict } from '@/services/integrationService';
import { SourceChip } from './Pills';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from './styles';
import { fmtAge, fmtDateTime } from './format';
import { QUICK_REASONS, isOpenConflict, sourceHref } from './issueMeta';

interface Props {
  conflict: Conflict;
  /** Source whose drawer this is shown in: its value gets no "open source" link. */
  currentSource?: string;
  /** Called after a resolve, escalate or reopen succeeds. */
  onDone?: () => void;
  /** Show the history timeline (hidden in the compact source drawer). */
  showHistory?: boolean;
}

/**
 * Resolve / escalate / reopen one conflict. Used by the Issues queue drawer and by the
 * Conflicts tab of a source's drawer, so both resolve the same way.
 * Mount with key={conflict.id} so the form resets per conflict.
 */
export function ConflictResolver({ conflict: c, currentSource, onDone, showHistory = true }: Props) {
  const open = isOpenConflict(c);
  const [winner, setWinner] = useState(c.values[0]?.system ?? '');
  const [reason, setReason] = useState('');
  const [escalating, setEscalating] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      message.success(ok);
      onDone?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const resolve = () => {
    if (!winner || !reason.trim()) {
      message.warning('Pick the winning value and give a reason');
      return;
    }
    void run(() => conflictService.resolve(c.id, winner, reason.trim()), `${c.id} resolved: ${winner} value kept`);
  };

  return (
    <div className="space-y-4 text-xs text-[#475569]">
      <p className="m-0 leading-relaxed">
        <CaseLink id={c.entityId} label={c.entityLabel} /> · {c.entityType}: systems disagree on <span className="font-mono font-bold text-[#141416]">{c.field}</span>. Detected{' '}
        {fmtAge(hoursSince(c.detectedAt))} ago.
      </p>

      <div>
        <div className={LABEL}>{open ? 'Pick the value that wins' : 'Values by system'}</div>
        <div role={open ? 'radiogroup' : undefined} aria-label="Winning value" className="space-y-1.5">
          {c.values.map((v) => {
            const on = open ? winner === v.system : c.resolution?.system === v.system;
            const body = (
              <>
                <span className="flex min-w-0 items-center gap-2">
                  {open && (
                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${on ? 'border-[#141416]' : 'border-[#94A3B8]'}`}>
                      {on && <span className="h-1.5 w-1.5 rounded-full bg-[#141416]" />}
                    </span>
                  )}
                  <SourceChip system={v.system} />
                </span>
                <span className="min-w-0 shrink text-right">
                  <span className="block truncate font-mono text-xs font-bold text-[#141416]">{v.value}</span>
                  <span className="block text-[10px] text-[#94A3B8]">seen {fmtDateTime(v.observedAt)}</span>
                </span>
              </>
            );
            return (
              <div key={v.system}>
                {open ? (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setWinner(v.system)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-all ${
                      on ? 'border-[#FFD600] bg-[#FFFBEB]' : 'border-[#E2E8F0] bg-white hover:border-gray-400'
                    }`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${on ? 'border-[#D1FAE5] bg-[#ECFDF5]' : 'border-[#E2E8F0]'}`}>{body}</div>
                )}
                {v.system !== currentSource && (
                  <Link href={sourceHref(v.system)} className="mt-0.5 inline-block text-[11px] font-semibold text-[#0284C7] hover:underline">
                    Open {v.system}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {open ? (
        escalating ? (
          <div>
            <label htmlFor={`esc-${c.id}`} className={LABEL}>
              Note to the data owner
            </label>
            <textarea id={`esc-${c.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} placeholder="What do you need from them?" />
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button type="button" className={BTN_GHOST} onClick={() => setEscalating(false)}>
                Cancel
              </button>
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => run(() => conflictService.escalate(c.id, note.trim()), `${c.id} escalated to the data owner`)}>
                <ShieldAlert className="h-3.5 w-3.5" /> Escalate
              </button>
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor={`reason-${c.id}`} className={LABEL}>
              Reason (recorded in history)
            </label>
            <textarea id={`reason-${c.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} placeholder="Why does this value win?" />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className="cursor-pointer rounded-full border-0 bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#475569] hover:bg-[#E2E8F0]">
                  {r}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className={BTN_SECONDARY}
                disabled={c.status === 'escalated' || busy}
                data-tip={c.status === 'escalated' ? 'Already escalated to the data owner' : undefined}
                onClick={() => {
                  setNote('');
                  setEscalating(true);
                }}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                {c.status === 'escalated' ? 'Escalated' : 'Escalate'}
              </button>
              <button type="button" className={BTN_PRIMARY} disabled={busy || !winner || !reason.trim()} onClick={resolve}>
                <CheckCircle className="h-3.5 w-3.5" />
                {winner ? `Resolve: keep ${winner}` : 'Resolve'}
              </button>
            </div>
            <p className="m-0 mt-2 text-[11px] text-[#94A3B8]">Resolving writes the winning value to the canonical store and back to the other systems.</p>
          </div>
        )
      ) : (
        <div className="space-y-2">
          {c.resolution && (
            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <span className="font-bold text-[#141416]">{c.resolution.system}</span> value kept by {c.resolution.by}: {c.resolution.reason}
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => run(() => conflictService.reopen(c.id), `${c.id} reopened`)}>
              Reopen
            </button>
          </div>
        </div>
      )}

      {showHistory && (
        <div>
          <div className={`${LABEL} flex items-center gap-1.5`}>
            <History className="h-3.5 w-3.5" /> History
          </div>
          <ol className="m-0 list-none space-y-0 p-0">
            {[...c.history].reverse().map((h, i) => (
              <li key={i} className="relative border-l border-[#E2E8F0] pb-3 pl-4 last:pb-0">
                <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#F59E0B]" />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-bold text-[#141416]">{h.action}</span>
                  <span className="text-[11px] text-[#64748B]">{h.actor}</span>
                  <span className="text-[11px] text-[#94A3B8]">{fmtDateTime(h.at)}</span>
                </div>
                <div className="mt-0.5 text-[#475569]">{h.note}</div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
