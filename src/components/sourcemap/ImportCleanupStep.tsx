'use client';

import React, { useState } from 'react';
import { ArrowRight, Check, Download, X } from 'lucide-react';
import { ROW_ISSUE_LABEL, type CleanupPreview, type CleanupRule, type RowIssueKind } from '@/services/integrationService';
import { Pill } from '@/components/integration/Pills';
import { BTN_GHOST } from '@/components/integration/styles';
import { downloadCsv } from '@/components/integration/format';

interface Props {
  preview: CleanupPreview;
  rejectedRules: string[];
  onToggleRule: (id: string, accept: boolean) => void;
  fileName: string;
}

const SHOWN = 5;

/** Quotes a cell so spaces are visible; the text itself is shown as plain text, never interpreted. */
const Cell = ({ v, tone }: { v: string; tone: 'before' | 'after' }) => (
  <span
    className={`inline-block max-w-full truncate whitespace-pre rounded-md px-1.5 py-px align-middle font-mono text-[11px] ${
      tone === 'before' ? 'bg-[#FEF2F2] text-[#B91C1C] line-through decoration-[#FCA5A5]' : 'bg-[#ECFDF5] text-[#047857]'
    }`}
  >
    {v === '' ? '(empty)' : `"${v}"`}
  </span>
);

function RuleCard({ rule, accepted, onToggle }: { rule: CleanupRule; accepted: boolean; onToggle: (accept: boolean) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? rule.changes : rule.changes.slice(0, SHOWN);
  return (
    <li className={`rounded-xl border px-3 py-2.5 ${accepted ? 'border-[#E2E8F0] bg-white' : 'border-dashed border-[#CBD5E1] bg-[#F8FAFC]'}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-[#141416]">{rule.label}</span>
            <Pill tone={accepted ? 'info' : 'neutral'} dot={false}>
              <span className="font-mono">{rule.changes.length}</span> {rule.changes.length === 1 ? 'change' : 'changes'}
            </Pill>
          </div>
          <p className="m-0 mt-0.5 text-[11px] text-[#64748B]">{rule.description}</p>
        </div>
        <div className="inline-flex shrink-0 overflow-hidden rounded-xl border border-[#E2E8F0]" role="group" aria-label={`${rule.label}: accept or reject`}>
          <button
            type="button"
            aria-pressed={accepted}
            onClick={() => onToggle(true)}
            className={`inline-flex cursor-pointer items-center gap-1 border-0 px-2.5 py-1 text-[11px] font-bold ${accepted ? 'bg-[#141416] text-white' : 'bg-white text-[#475569] hover:bg-[#F8FAFC]'}`}
          >
            <Check size={12} /> Accept
          </button>
          <button
            type="button"
            aria-pressed={!accepted}
            onClick={() => onToggle(false)}
            className={`inline-flex cursor-pointer items-center gap-1 border-0 border-l border-[#E2E8F0] px-2.5 py-1 text-[11px] font-bold ${!accepted ? 'bg-[#141416] text-white' : 'bg-white text-[#475569] hover:bg-[#F8FAFC]'}`}
          >
            <X size={12} /> Reject
          </button>
        </div>
      </div>
      <ul className={`m-0 mt-2 list-none space-y-1 p-0 ${accepted ? '' : 'opacity-60'}`} aria-label={`${rule.label} changes`}>
        {shown.map((c) => (
          <li key={`${c.row}-${c.column}-${c.before}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-[11px] sm:grid-cols-[auto_minmax(0,140px)_minmax(0,1fr)]">
            <span className="font-mono text-[#94A3B8]">Row {c.row}</span>
            <span className="hidden truncate font-mono text-[#64748B] sm:block">{c.column}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              <Cell v={c.before} tone="before" />
              <ArrowRight size={11} className="shrink-0 text-[#94A3B8]" />
              <Cell v={c.after} tone="after" />
            </span>
          </li>
        ))}
      </ul>
      {rule.changes.length > SHOWN && (
        <button type="button" className={`${BTN_GHOST} !px-0`} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${rule.changes.length}`}
        </button>
      )}
    </li>
  );
}

/**
 * Add source › File / CSV › Clean-up: proposed normalisations as a before → after diff with a count
 * and Accept / Reject per rule, then the rows that will be rejected and why. Only valid rows are
 * committed; a rejected row is never loaded partly. Cell text is data and is shown as plain text.
 */
export function ImportCleanupStep({ preview, rejectedRules, onToggleRule, fileName }: Props) {
  const r = preview.result;
  const rejected = r.rows.filter((x) => x.issues.length);
  const kinds = new Map<RowIssueKind, number>();
  for (const row of rejected) for (const k of new Set(row.issues.map((i) => i.kind ?? 'invalid'))) kinds.set(k, (kinds.get(k) ?? 0) + 1);
  const accepted = preview.rules.filter((x) => !rejectedRules.includes(x.id));

  const downloadRejected = () => {
    const fields = Object.values(r.mapping).filter(Boolean);
    downloadCsv(
      `rejected_${fileName || 'import.csv'}`,
      ['row', ...fields, 'reasons'],
      rejected.map((x) => [x.index, ...fields.map((f) => x.values[f] ?? ''), x.issues.map((i) => (i.field ? `${i.field}: ${i.message}` : i.message)).join('; ')]),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-bold text-[#141416]">After clean-up</span>
        <Pill tone="low">
          <span className="font-mono">{r.valid}</span> rows will load
        </Pill>
        <Pill tone={rejected.length ? 'high' : 'neutral'}>
          <span className="font-mono">{rejected.length}</span> rejected
        </Pill>
        <span className="text-[11px] text-[#64748B]">
          {accepted.length} of {preview.rules.length} rules accepted
        </span>
      </div>

      <section aria-labelledby="cleanup-rules">
        <h3 id="cleanup-rules" className="m-0 mb-2 text-xs font-extrabold text-[#141416]">
          Proposed clean-up
        </h3>
        {preview.rules.length === 0 ? (
          <p className="m-0 rounded-xl border border-[#E2E8F0] px-3 py-2 text-xs text-[#64748B]">Nothing to clean: grades, dates, units and spacing already follow the model.</p>
        ) : (
          <ul className="m-0 max-h-[300px] list-none space-y-2 overflow-y-auto p-0 pr-1">
            {preview.rules.map((rule) => (
              <RuleCard key={rule.id} rule={rule} accepted={!rejectedRules.includes(rule.id)} onToggle={(a) => onToggleRule(rule.id, a)} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cleanup-rejected">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 id="cleanup-rejected" className="m-0 text-xs font-extrabold text-[#141416]">
            Rejected rows <span className="font-mono font-bold text-[#64748B]">({rejected.length})</span>
          </h3>
          {[...kinds].map(([k, n]) => (
            <Pill key={k} tone="neutral" dot={false}>
              {ROW_ISSUE_LABEL[k]} <span className="font-mono">{n}</span>
            </Pill>
          ))}
          {rejected.length > 0 && (
            <button type="button" onClick={downloadRejected} className={`${BTN_GHOST} ml-auto`}>
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          )}
        </div>
        {rejected.length === 0 ? (
          <p className="m-0 text-xs text-[#64748B]">Every row passes the checks.</p>
        ) : (
          <ul className="m-0 max-h-[200px] list-none divide-y divide-[#F1F5F9] overflow-y-auto rounded-xl border border-[#E2E8F0] p-0">
            {rejected.map((row) => (
              <li key={row.index} className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 px-3 py-1.5 text-[11px]">
                <span className="font-mono text-[#94A3B8]">Row {row.index}</span>
                <span className="min-w-0 space-y-0.5">
                  {row.issues.map((i, n) => (
                    <span key={n} className="block min-w-0 truncate text-[#334155]">
                      <span className="font-bold text-[#B91C1C]">{ROW_ISSUE_LABEL[i.kind ?? 'invalid']}</span>
                      {i.field ? <span className="font-mono text-[#64748B]"> · {i.field}</span> : null}: {i.message}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 mt-2 text-[11px] text-[#64748B]">
          Only the <span className="font-mono font-bold text-[#141416]">{r.valid}</span> valid rows are loaded. Rejected rows are never loaded in part; fix them in the file and import it again.
        </p>
      </section>
    </div>
  );
}
