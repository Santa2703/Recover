'use client';

import React, { useMemo, useState } from 'react';
import { Modal, message } from 'antd';
import { ArrowRight, Check, ChevronDown, ChevronUp, FileText, Sparkles, Trash2, X } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { ListSkeleton } from '@/components/ui';
import { columnNoteKey, linkService, type ColumnDescriptionDraft, type ColumnRef, type LinkSuggestion, type TableLink } from '@/services/integrationService';
import { IntTable, type IntColumn } from './IntTable';
import { Pill } from './Pills';
import { BTN_GHOST, BTN_ROW, BTN_SECONDARY } from './styles';

const confTone = (v: number) => (v >= 90 ? 'text-[#15803D]' : v >= 60 ? 'text-[#D97706]' : 'text-[#DC2626]');

function Ref({ r, strong }: { r: ColumnRef; strong?: boolean }) {
  return (
    <span className="block min-w-0">
      <span className={`block truncate font-mono text-xs ${strong ? 'font-bold text-[#141416]' : 'font-semibold text-[#2563EB]'}`}>
        {r.table}.{r.column}
      </span>
      <span className="block truncate text-[11px] text-[#64748B]">{r.source}</span>
    </span>
  );
}

type LinkRow = TableLink & { state: 'published' | 'draft' | 'removed' };

/**
 * Data model › Links for one entity: foreign keys between the source tables that feed it, link
 * suggestions with evidence (Accept puts them in the draft, Reject dismisses), and drafted
 * descriptions for columns that have none. Everything lands in the one Data model draft.
 */
export function ModelLinksTab({ entity, entityName }: { entity: string; entityName: string }) {
  const q = useServiceQuery(() => linkService.links(entity), [entity], { subscribe: linkService.subscribe });
  const [suggestions, setSuggestions] = useState<LinkSuggestion[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [describeOpen, setDescribeOpen] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const d = q.data;

  const rows: LinkRow[] = useMemo(
    () => (d ? [...d.links.map((l) => ({ ...l, state: d.draftIds.includes(l.id) ? ('draft' as const) : ('published' as const) })), ...d.removed.map((l) => ({ ...l, state: 'removed' as const }))] : []),
    [d],
  );
  const undescribed = d ? linkService.describeDrafts(entity) : [];

  const suggest = async () => {
    setSuggesting(true);
    try {
      const list = await linkService.suggest(entity);
      setSuggestions(list);
      if (!list.length) message.info('No new links found in the sample values');
    } finally {
      setSuggesting(false);
    }
  };

  const accept = async (sg: LinkSuggestion) => {
    setBusyKey(sg.key);
    try {
      await linkService.addLink(entity, { from: sg.from, to: sg.to, confidence: sg.confidence, evidence: sg.evidence });
      setSuggestions((s) => s?.filter((x) => x.key !== sg.key) ?? null);
      message.success(`Link ${sg.from.table}.${sg.from.column} → ${sg.to.table}.${sg.to.column} added to the draft`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  };

  const reject = (sg: LinkSuggestion) => {
    linkService.dismiss(entity, sg.key);
    setSuggestions((s) => s?.filter((x) => x.key !== sg.key) ?? null);
  };

  const remove = (l: LinkRow) =>
    Modal.confirm({
      title: 'Remove this link?',
      content: `${l.from.table}.${l.from.column} will no longer join ${l.to.table}.${l.to.column}. The change goes into the draft.`,
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: async () => {
        await linkService.removeLink(entity, l.id);
        message.success('Link removed in the draft');
      },
    });

  const columns: IntColumn<LinkRow>[] = [
    { key: 'from', title: 'From', render: (l) => <Ref r={l.from} strong /> },
    { key: 'arrow', title: '', className: 'w-6', render: () => <ArrowRight size={13} className="text-[#94A3B8]" /> },
    { key: 'to', title: 'To (key)', render: (l) => <Ref r={l.to} /> },
    { key: 'evidence', title: 'Evidence', priority: 3, grow: true, render: (l) => <span className="block truncate text-[11px] text-[#475569]">{l.evidence}</span> },
    { key: 'conf', title: 'Confidence', priority: 2, align: 'right', render: (l) => <span className={`font-mono text-[11px] font-extrabold ${confTone(l.confidence)}`}>{l.confidence}%</span> },
    {
      key: 'state',
      title: 'Status',
      render: (l) =>
        l.state === 'draft' ? (
          <Pill tone="medium" dot={false}>
            In draft
          </Pill>
        ) : l.state === 'removed' ? (
          <Pill tone="high" dot={false}>
            Removed in draft
          </Pill>
        ) : (
          <Pill tone="low" dot={false}>
            Published
          </Pill>
        ),
    },
    {
      key: 'act',
      title: '',
      align: 'right',
      render: (l) =>
        l.state === 'removed' ? null : (
          <button
            type="button"
            className={`${BTN_ROW} inline-flex items-center gap-1 whitespace-nowrap`}
            onClick={() => remove(l)}
            aria-label={`Remove link ${l.from.table}.${l.from.column} to ${l.to.table}.${l.to.column}`}
          >
            <Trash2 size={11} /> Remove
          </button>
        ),
    },
  ];

  if (q.initialLoading || !d) return <ListSkeleton rows={4} />;
  if (!d.tables.length)
    return <p className="m-0 py-6 text-center text-xs text-[#94A3B8]">No source tables are catalogued for {entityName} yet, so there are no links to show or suggest.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 min-w-0 flex-1 text-xs text-[#64748B]">
          How the {d.tables.length} source tables feeding {entityName} join: from-table.field → key of the to-table. Changes go into the draft.
        </p>
        <button type="button" className={BTN_SECONDARY} onClick={suggest} disabled={suggesting}>
          <Sparkles className="h-3.5 w-3.5" />
          <span>{suggesting ? 'Checking sample values…' : 'Suggest links'}</span>
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={() => setDescribeOpen(true)} disabled={!undescribed.length}>
          <FileText className="h-3.5 w-3.5" />
          <span>Describe{undescribed.length ? ` (${undescribed.length})` : ''}</span>
        </button>
      </div>

      {suggestions && suggestions.length > 0 && (
        <div className="rounded-xl border border-[#FEF3C7] bg-[#FFFDF5] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-[#141416]">Suggested links ({suggestions.length})</span>
            <span className="text-[11px] text-[#64748B]">Confidence = 40% name match + 60% sample values found in the key</span>
          </div>
          <ul className="m-0 list-none space-y-2 p-0">
            {suggestions.map((sg) => (
              <li key={sg.key} className="flex flex-col gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 sm:flex-row sm:items-center">
                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                  <Ref r={sg.from} strong />
                  <ArrowRight size={13} className="text-[#94A3B8]" />
                  <Ref r={sg.to} />
                  <span className="col-span-3 truncate text-[11px] text-[#475569]">{sg.evidence}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`font-mono text-xs font-extrabold ${confTone(sg.confidence)}`}>{sg.confidence}%</span>
                  <button type="button" className={BTN_ROW} disabled={busyKey === sg.key} onClick={() => accept(sg)} aria-label={`Accept link ${sg.from.table}.${sg.from.column}`}>
                    <Check size={11} className="inline align-[-1px]" /> Accept
                  </button>
                  <button type="button" className={BTN_ROW} disabled={busyKey === sg.key} onClick={() => reject(sg)} aria-label={`Reject link ${sg.from.table}.${sg.from.column}`}>
                    <X size={11} className="inline align-[-1px]" /> Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <IntTable<LinkRow>
        columns={columns}
        rows={rows}
        rowKey={(l) => `${l.state}-${l.id}`}
        rowClassName={(l) => (l.state === 'removed' ? 'opacity-60 line-through' : '')}
        emptyText="No links yet. Suggest links to find the foreign keys in the sample values."
      />

      <div className="rounded-xl border border-[#E2E8F0]">
        <button
          type="button"
          onClick={() => setShowTables((v) => !v)}
          aria-expanded={showTables}
          className="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent px-3 py-2 text-left text-xs font-bold text-[#141416]"
        >
          <span>
            Tables and columns <span className="font-mono font-semibold text-[#64748B]">({d.tables.reduce((n, t) => n + t.columns.length, 0)} columns)</span>
          </span>
          {showTables ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showTables && (
          <div className="grid grid-cols-1 gap-3 border-t border-[#F1F5F9] p-3 md:grid-cols-2">
            {d.tables.map((t) => (
              <div key={`${t.source}-${t.table}`} className="min-w-0">
                <div className="truncate text-xs font-bold text-[#141416]">
                  <span className="font-mono">{t.table}</span> <span className="font-normal text-[#64748B]">· {t.label}</span>
                </div>
                <div className="truncate text-[11px] text-[#94A3B8]">{t.source}</div>
                <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                  {t.columns.map((c) => {
                    const nk = columnNoteKey(t.source, t.table, c.name);
                    const note = d.notes[nk];
                    const text = c.description || note;
                    return (
                      <li key={c.name} className="flex min-w-0 items-center gap-1.5 text-[11px]">
                        <span className="shrink-0 font-mono font-semibold text-[#141416]">{c.name}</span>
                        {c.key && (
                          <Pill tone="brand" dot={false}>
                            Key
                          </Pill>
                        )}
                        <span className={`min-w-0 truncate ${text ? 'text-[#475569]' : 'italic text-[#94A3B8]'}`}>{text || 'No description'}</span>
                        {note && d.draftNoteKeys.includes(nk) && (
                          <Pill tone="medium" dot={false}>
                            In draft
                          </Pill>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <DescribeModal open={describeOpen} entity={entity} drafts={undescribed} onClose={() => setDescribeOpen(false)} />
    </div>
  );
}

function DescribeModal({ open, entity, drafts, onClose }: { open: boolean; entity: string; drafts: ColumnDescriptionDraft[]; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={680}
      title={
        <span className="flex items-center gap-2 text-sm font-bold">
          <FileText size={16} className="text-amber-500" /> Describe columns
        </span>
      }
    >
      {open && <DescribeForm entity={entity} drafts={drafts} onClose={onClose} />}
    </Modal>
  );
}

function DescribeForm({ entity, drafts, onClose }: { entity: string; drafts: ColumnDescriptionDraft[]; onClose: () => void }) {
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(drafts.map((x) => [x.noteKey, x.draft])));
  const [skip, setSkip] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const kept = drafts.filter((x) => !skip.includes(x.noteKey) && text[x.noteKey]?.trim());

  const save = async () => {
    setSaving(true);
    try {
      const n = await linkService.saveDescriptions(
        entity,
        kept.map((x) => ({ noteKey: x.noteKey, text: text[x.noteKey] })),
      );
      message.success(`${n} column ${n === 1 ? 'description' : 'descriptions'} added to the draft`);
      onClose();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 pt-2 text-xs">
      <p className="m-0 text-[#64748B]">Drafted from known source-system fields, the column name, type and a sample value. Edit any of them, skip the ones you do not want, then add them to the draft.</p>
      <ul className="m-0 max-h-[420px] list-none space-y-2 overflow-y-auto p-0 pr-1">
        {drafts.map((x) => {
          const skipped = skip.includes(x.noteKey);
          const id = `desc-${x.noteKey.replace(/[^a-zA-Z0-9]/g, '-')}`;
          return (
            <li key={x.noteKey} className={`rounded-xl border px-3 py-2 ${skipped ? 'border-dashed border-[#CBD5E1] bg-[#F8FAFC] opacity-70' : 'border-[#E2E8F0]'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={id} className="min-w-0 flex-1 truncate font-mono text-[11px] font-bold text-[#141416]">
                  {x.table}.{x.column} <span className="font-sans font-normal text-[#94A3B8]">· {x.source} · {x.type}</span>
                </label>
                <span className="text-[10px] text-[#94A3B8]">{x.basis}</span>
                <button type="button" className={BTN_GHOST} onClick={() => setSkip((s) => (skipped ? s.filter((k) => k !== x.noteKey) : [...s, x.noteKey]))}>
                  {skipped ? 'Use' : 'Skip'}
                </button>
              </div>
              <input
                id={id}
                disabled={skipped}
                maxLength={300}
                value={text[x.noteKey] ?? ''}
                onChange={(e) => setText((t) => ({ ...t, [x.noteKey]: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-xs text-[#141416] focus:border-[#FFD600] focus:bg-white focus:outline-none disabled:opacity-60"
              />
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !kept.length}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#FFD600] px-3.5 py-1.5 text-xs font-extrabold text-[#141416] hover:bg-[#FACC15] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : `Add ${kept.length} to draft`}
        </button>
      </div>
    </div>
  );
}
