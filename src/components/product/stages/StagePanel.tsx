'use client';

import React from 'react';
import Link from 'next/link';
import { Drawer, message } from 'antd';
import { ArrowLeft, ArrowRight, Copy } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import { stageService, type StageActionTarget, type StageDetail, type StageFact } from '@/services/stageService';
import { ErrorState, ListSkeleton, StatusBadge } from '@/components/ui';
import type { Tone } from '@/theme/tokens';
import { date, dateTime } from '@/utils/format';

export interface StagePanelProps {
  caseId: string;
  /** 1-based journey step (meta.journey id), 1–10. */
  stageId: number;
  open: boolean;
  onClose: () => void;
  /** Previous / Next and "Go to stage N" ask the parent to show another stage. */
  onStageChange: (stageId: number) => void;
  /** "What you do now" actions that open a Case page tab (decision, asset, evidence, execution). */
  onAction?: (target: StageActionTarget) => void;
}

const secondaryBtn =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40';
const sectionTitle = 'm-0 mb-2 text-[11px] font-bold uppercase tracking-wider text-[#64748B]';

function statusTone(s: StageDetail): Tone {
  if (s.blocked) return 'danger';
  if (s.status === 'done') return 'success';
  if (s.status === 'current') return s.statusLabel.startsWith('Waiting') ? 'warning' : 'brand';
  return 'neutral';
}

function provenance(f: StageFact): React.ReactNode {
  if (f.basis === 'retrieved') {
    return (
      <>
        Retrieved · {f.source}
        {f.freshness && <> · {f.freshness}</>}
        {f.stale && <span className="font-semibold text-[#B45309]"> · stale</span>}
      </>
    );
  }
  return `${f.basis === 'rules' ? 'Rules' : 'Model'} · ${f.source}`;
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    message.success(`${id} copied`);
  } catch {
    message.error('Clipboard is not available in this browser');
  }
}

/**
 * Right-side panel for one journey stage of a case: status with date and actor, what happened
 * (facts with their source and freshness), what it means, what the signed-in role does now, and
 * the documents. Stages not reached yet show when they start and who does the work.
 */
export function StagePanel({ caseId, stageId, open, onClose, onStageChange, onAction }: StagePanelProps) {
  const { currentRole } = useAuth();
  const q = useServiceQuery(() => (open ? stageService.stageDetail(caseId, stageId, currentRole) : Promise.resolve(undefined)), [open, caseId, stageId, currentRole], {
    subscribe: stageService.subscribe,
  });
  // Keep the last stage on screen while the next one loads (no flash between stages).
  const s = q.data;
  const total = s?.totalStages ?? 10;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={480}
      title={
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
            {s ? `${s.phase} · ` : ''}Stage <span className="font-mono">{stageId}</span> of <span className="font-mono">{total}</span>
          </div>
          <div className="truncate text-sm font-extrabold text-[#141416]">{s?.stageId === stageId ? s.label : ' '}</div>
        </div>
      }
      extra={s && s.stageId === stageId && <StatusBadge tone={statusTone(s)}>{s.status === 'current' && !s.blocked ? 'Current' : s.statusLabel}</StatusBadge>}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button type="button" className={secondaryBtn} disabled={stageId <= 1} onClick={() => onStageChange(stageId - 1)}>
            <ArrowLeft size={14} aria-hidden /> Previous stage
          </button>
          <button type="button" className={secondaryBtn} disabled={stageId >= total} onClick={() => onStageChange(stageId + 1)}>
            Next stage <ArrowRight size={14} aria-hidden />
          </button>
        </div>
      }
    >
      {q.error && !s ? (
        <ErrorState onRetry={q.refetch} compact />
      ) : !s || (q.loading && s.stageId !== stageId) ? (
        <ListSkeleton rows={6} />
      ) : (
        <StageBody s={s} onStageChange={onStageChange} onAction={onAction} onClose={onClose} />
      )}
    </Drawer>
  );
}

function StageBody({
  s,
  onStageChange,
  onAction,
  onClose,
}: {
  s: StageDetail;
  onStageChange: (id: number) => void;
  onAction?: (t: StageActionTarget) => void;
  onClose: () => void;
}) {
  const reached = s.status !== 'not_reached';
  const action = s.youDo.action;
  const when = s.date ? (s.status === 'done' ? `${date(s.date)}` : `since ${dateTime(s.date)}`) : null;

  return (
    <div className="space-y-6 text-xs text-[#141416]">
      {/* Status, date, actor, systems */}
      <div className="space-y-2">
        <p className="m-0 text-[#475569]">
          {reached ? (
            <>
              <strong className="text-[#141416]">{s.statusLabel}</strong>
              {when && <span className="font-mono"> · {when}</span>}
              {s.actor && <> · by {s.actor}</>}
            </>
          ) : (
            <>
              <strong className="text-[#141416]">Not reached</strong> · starts on {s.upcoming?.startsOn.toLowerCase()}
            </>
          )}
        </p>
        {s.systems.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Systems used at this stage">
            {s.systems.map((sys) => (
              <li key={sys} className="rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-[11px] font-medium text-[#475569]">
                {sys}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* What happened / what will happen */}
      <section>
        <h3 className={sectionTitle}>{reached ? 'What happened' : 'What will happen'}</h3>
        <p className="m-0 mb-2 leading-relaxed text-[#141416]">{s.summary}</p>
        {reached ? (
          s.facts.length > 0 && (
            <dl className="m-0 divide-y divide-[#F1F5F9]">
              {s.facts.map((f) => (
                <div key={`${f.label}-${f.value}`} className="flex items-start justify-between gap-3 py-2">
                  <dt className="max-w-[45%] text-[#64748B]">{f.label}</dt>
                  <dd className="m-0 min-w-0 text-right">
                    <div className="break-words font-mono font-semibold text-[#141416]">{f.value}</div>
                    <div className="text-[11px] text-[#94A3B8]">{provenance(f)}</div>
                  </dd>
                </div>
              ))}
            </dl>
          )
        ) : (
          s.upcoming && (
            <dl className="m-0 divide-y divide-[#F1F5F9]">
              {(
                [
                  ['Starts on', s.upcoming.startsOn],
                  ['Planned', s.upcoming.expected ? date(s.upcoming.expected, true) : null],
                  ['The agent', s.upcoming.agent],
                  ['A person', s.upcoming.person],
                  ['Systems', s.upcoming.systems.join(', ')],
                ] as [string, string | null][]
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 py-2">
                    <dt className="shrink-0 text-[#64748B]">{k}</dt>
                    <dd className={`m-0 min-w-0 text-right font-semibold text-[#141416] ${k === 'Planned' ? 'font-mono' : ''}`}>{v}</dd>
                  </div>
                ))}
            </dl>
          )
        )}
      </section>

      {s.documents.length > 0 && (
        <section>
          <h3 className={sectionTitle}>Documents</h3>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {s.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#F1F5F9] px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="font-mono font-bold text-[#141416]">{d.id}</div>
                  <div className="truncate text-[11px] text-[#64748B]">
                    {d.label} · {d.system}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyId(d.id)}
                  aria-label={`Copy ${d.id}`}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2 py-1 text-[11px] font-semibold text-[#475569] hover:border-gray-400"
                >
                  <Copy size={12} aria-hidden /> Copy
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className={sectionTitle}>What it means</h3>
        <p className="m-0 leading-relaxed text-[#141416]">{s.meaning}</p>
      </section>

      <section>
        <h3 className={sectionTitle}>{reached ? 'What you do now' : 'What happens next'}</h3>
        <p className="m-0 leading-relaxed text-[#141416]">{s.youDo.text}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {action?.target && onAction && (
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => {
                onAction(action.target!);
                onClose();
              }}
            >
              {action.label} <ArrowRight size={14} aria-hidden />
            </button>
          )}
          {action?.href && (
            <Link href={action.href} className={`${secondaryBtn} no-underline`}>
              {action.label} <ArrowRight size={14} aria-hidden />
            </Link>
          )}
          {!reached && (
            <button type="button" className={secondaryBtn} onClick={() => onStageChange(s.current.id)}>
              {`Go to stage ${s.current.id}: ${s.current.label}`}
            </button>
          )}
        </div>
      </section>

      {s.control && <p className="m-0 border-t border-[#F1F5F9] pt-3 text-[11px] text-[#64748B]">Control: {s.control}</p>}
    </div>
  );
}

export default StagePanel;
