'use client';

import React, { useRef, useState } from 'react';
import { message } from 'antd';
import { ClipboardList, FileUp, ListChecks, RotateCcw, Shuffle } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import { importService, type CanonicalModelRow, type ColumnMapping, type ValidationResult } from '@/services/integrationService';
import { Pill } from '@/components/integration/Pills';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL, SELECT } from '@/components/integration/styles';
import { downloadCsv } from '@/components/integration/format';

const MAX_BYTES = 2 * 1024 * 1024;

export interface FileDraft {
  name: string;
  modelId: string;
  csvText: string;
  fileName: string;
  result: ValidationResult | null;
  /** Clean-up rules the user rejected on the Clean-up step (rule ids). */
  rejectedRules: string[];
}

export const EMPTY_FILE_DRAFT: FileDraft = { name: '', modelId: 'physical_asset', csvText: '', fileName: '', result: null, rejectedRules: [] };

interface Props {
  value: FileDraft;
  onChange: (next: FileDraft) => void;
  models: CanonicalModelRow[] | undefined;
}

/**
 * Add source › File / CSV: the manual-import flow. Load a CSV (paste, upload, drop or sample),
 * check it against a canonical model and adjust the column matches. Nothing is written until the
 * wizard's last step.
 */
export function FileImportStep({ value: v, onChange, models }: Props) {
  const [validating, setValidating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const model = models?.find((m) => m.id === v.modelId);
  const set = (patch: Partial<FileDraft>) => onChange({ ...v, ...patch });

  const loadText = (csvText: string, fileName: string) =>
    set({ csvText, fileName, result: null, name: v.name || fileName.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ') });

  const readFile = (file: File) => {
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return void message.error('Choose a .csv file');
    if (file.size > MAX_BYTES) return void message.error('File is larger than 2 MB. Split it and import in parts.');
    const reader = new FileReader();
    reader.onload = () => {
      loadText(String(reader.result ?? ''), file.name);
      message.success(`Loaded ${file.name}`);
    };
    reader.onerror = () => message.error('Could not read the file');
    reader.readAsText(file);
  };

  const validate = async (mapping?: ColumnMapping) => {
    if (!v.csvText.trim()) return void message.warning('Paste CSV text, upload a file or load the sample first');
    setValidating(true);
    try {
      const result = await importService.validate(v.modelId, v.csvText, mapping);
      onChange({ ...v, result });
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Validation failed');
      onChange({ ...v, result: null });
    } finally {
      setValidating(false);
    }
  };

  const changeMapping = (column: string, field: string) => {
    if (!v.result) return;
    const next: ColumnMapping = { ...v.result.mapping };
    // A canonical field can only be fed by one column.
    if (field) for (const k of Object.keys(next)) if (next[k] === field) next[k] = '';
    next[column] = field;
    void validate(next);
  };

  const downloadRejected = () => {
    const r = v.result;
    if (!r) return;
    const fields = Object.values(r.mapping).filter(Boolean);
    downloadCsv(
      `rejected_${v.fileName || 'import.csv'}`,
      ['row', ...fields, 'errors'],
      r.rows.filter((x) => x.issues.length).map((x) => [x.index, ...fields.map((f) => x.values[f] ?? ''), x.issues.map((i) => (i.field ? `${i.field}: ${i.message}` : i.message)).join('; ')]),
    );
  };

  const lines = v.csvText.split(/\r?\n/).filter((l) => l.trim()).length;
  const r = v.result;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="file-src-name" className={LABEL}>
            Source name
          </label>
          <input id="file-src-name" className={INPUT} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Partner grading file" />
        </div>
        <div>
          <label htmlFor="file-model" className={LABEL}>
            Canonical model
          </label>
          {!models ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <select id="file-model" value={v.modelId} onChange={(e) => set({ modelId: e.target.value, result: null })} className={`${SELECT} w-full`}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (v{m.version ?? m.draft?.version})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {model && (
        <div className="flex flex-wrap gap-1" aria-label="Expected columns">
          {model.fields.map((f) => (
            <span
              key={f.name}
              data-tip={`${f.type}: ${f.description}`}
              className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${f.required ? 'border-[#FDE68A] bg-[#FFFBEB] font-bold text-[#854D0E]' : 'border-[#E2E8F0] bg-white text-[#475569]'}`}
            >
              {f.name}
            </span>
          ))}
          <span className="self-center text-[10px] text-[#94A3B8]">Highlighted columns are required.</span>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) readFile(f);
        }}
        className={`rounded-xl border transition-colors ${dragOver ? 'border-[#FFD600] bg-[#FFFBEB]' : 'border-[#E2E8F0]'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F1F5F9] px-3 py-1.5 text-[11px] text-[#64748B]">
          <span className="min-w-0 truncate font-mono">{v.fileName || 'pasted.csv'}</span>
          <span className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={() => set({ csvText: '', fileName: '', result: null })} disabled={!v.csvText} className={BTN_GHOST}>
              <RotateCcw className="h-3.5 w-3.5" /> Clear
            </button>
            <button type="button" onClick={() => loadText(importService.sampleCsv(v.modelId), `sample_${v.modelId}.csv`)} className={BTN_GHOST}>
              <ClipboardList className="h-3.5 w-3.5" /> Load sample
            </button>
            <button type="button" onClick={() => loadText(importService.messySampleCsv(v.modelId), `messy_${v.modelId}.csv`)} className={BTN_GHOST}>
              <Shuffle className="h-3.5 w-3.5" /> Load messy sample
            </button>
            <button type="button" onClick={() => fileInput.current?.click()} className={BTN_GHOST}>
              <FileUp className="h-3.5 w-3.5" /> Upload .csv
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-label="Upload CSV file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
              }}
            />
          </span>
        </div>
        <textarea
          value={v.csvText}
          onChange={(e) => set({ csvText: e.target.value, result: null })}
          rows={6}
          spellCheck={false}
          aria-label="CSV text"
          placeholder={model ? `${model.fields.map((f) => f.name).join(',')}\n… or drop a .csv file here` : ''}
          className="block w-full resize-y rounded-b-xl border-0 bg-[#F8FAFC] p-3 font-mono text-[11px] leading-relaxed text-[#141416] placeholder-[#94A3B8] focus:bg-white focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-[#64748B]">{lines ? `${lines} lines incl. header` : 'Paste CSV text, upload a file, or load a sample.'}</span>
        <button type="button" onClick={() => validate()} disabled={validating || !v.csvText.trim()} className={r ? BTN_SECONDARY : BTN_PRIMARY}>
          <ListChecks className="h-3.5 w-3.5" />
          <span>{validating ? 'Checking…' : r ? 'Check again' : 'Check file'}</span>
        </button>
      </div>

      {r && (
        <div className="space-y-3 rounded-xl border border-[#E2E8F0] p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-bold text-[#141416]">Column matches</span>
            <Pill tone="low">{r.valid} valid rows</Pill>
            <Pill tone={r.invalid ? 'high' : 'neutral'}>{r.invalid} with errors</Pill>
            {r.unmappedColumns.length > 0 && (
              <Pill tone="medium" dot={false}>
                {r.unmappedColumns.length} columns ignored
              </Pill>
            )}
            {r.invalid > 0 && (
              <button type="button" onClick={downloadRejected} className={`${BTN_GHOST} ml-auto`}>
                Download errors
              </button>
            )}
          </div>
          {r.missingRequired.length > 0 && (
            <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[11px] text-[#B91C1C]">
              Required fields not matched to any column: <span className="font-mono font-bold">{r.missingRequired.join(', ')}</span>. Every row fails until they are matched.
            </div>
          )}
          <div className="grid max-h-[220px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {r.headers.map((h) => {
              const target = r.mapping[h];
              return (
                <div key={h} className={`min-w-0 rounded-xl border p-2 ${target ? 'border-[#E2E8F0] bg-white' : 'border-dashed border-[#CBD5E1] bg-[#F8FAFC]'}`}>
                  <span className="block truncate font-mono text-[11px] font-bold text-[#141416]">{h}</span>
                  <select
                    aria-label={`Canonical field for column ${h}`}
                    value={target}
                    onChange={(e) => changeMapping(h, e.target.value)}
                    className={`${SELECT} mt-1 w-full font-mono`}
                    disabled={validating}
                  >
                    <option value="">Ignore this column</option>
                    {model?.fields.map((x) => (
                      <option key={x.name} value={x.name}>
                        {x.name} ({x.type})
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
