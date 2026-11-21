'use client';

import React, { useState } from 'react';
import { Copy, Plus, Trash2, X } from 'lucide-react';
import type { NodeRunStatus, WorkflowNodeData, WorkflowNodeKind } from '@/services/workflowService';
import { hasInput, hasOutput } from '@/services/workflowService';
import type { WfNode } from './useWorkflowEditor';
import { KIND_META, NODE_STATUSES, STATUS_STYLE, kindColor } from './nodeRegistry';

const inputCls =
  'w-full px-2.5 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs text-[#141416] focus:outline-none focus:border-[#FFD600] disabled:text-[#94A3B8]';
const labelCls = 'text-[#64748B] text-[11px] font-semibold mb-1';
const secondaryBtn =
  'flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-xl text-xs font-semibold text-[#141416] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

function ListEditor({
  items,
  onChange,
  placeholder,
  locked,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  locked?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setDraft('');
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 && <span className="text-[11px] text-[#94A3B8]">None</span>}
        {items.map((it) => (
          <span
            key={it}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#F1F5F9] border border-[#E2E8F0] rounded-md text-[10px] font-medium font-mono text-[#475569]"
          >
            {it}
            {!locked && (
              <button
                onClick={() => onChange(items.filter((x) => x !== it))}
                className="text-[#94A3B8] hover:text-[#DC2626] cursor-pointer"
                aria-label={`Remove ${it}`}
              >
                <X size={10} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!locked && (
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder={placeholder}
            className={`${inputCls} font-mono`}
          />
          <button onClick={add} className="px-2 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-xl text-[#64748B] cursor-pointer" aria-label="Add">
            <Plus size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  node: WfNode;
  onChange: (patch: Partial<WorkflowNodeData>, field?: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
  readOnly?: boolean;
}

/** Contextual side panel for the selected node; same look as the Workflow details panel. */
export function NodePropertiesPanel({ node, onChange, onDuplicate, onDelete, onClose, readOnly }: Props) {
  const kind = node.type as WorkflowNodeKind;
  const meta = KIND_META[kind];
  const color = kindColor(kind);
  const d = node.data;
  const st = STATUS_STYLE[d.status] ?? STATUS_STYLE.Idle;

  const setConfig = (i: number, patch: Partial<{ key: string; value: string }>) =>
    onChange({ config: d.config.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }, `config-${i}`);

  return (
    <div className="min-w-0 lg:col-span-3 bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-[#141416] tracking-tight m-0">Node properties</h2>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className="px-1.5 rounded-full bg-white border border-[#E2E8F0] text-[9px] leading-[16px] font-bold uppercase tracking-wider"
              style={{ color }}
            >
              {meta.label}
            </span>
            <span className="text-[10px] font-mono text-[#94A3B8]">{node.id}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded-lg text-[#64748B] hover:text-[#141416] transition-colors cursor-pointer"
          title="Back to workflow details"
          aria-label="Close node properties"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3.5 text-xs">
        <div>
          <div className={labelCls}>Name</div>
          <input className={inputCls} value={d.label} disabled={readOnly} onChange={(e) => onChange({ label: e.target.value }, 'label')} />
        </div>
        <div>
          <div className={labelCls}>Subtitle</div>
          <input className={inputCls} value={d.subtitle ?? ''} disabled={readOnly} onChange={(e) => onChange({ subtitle: e.target.value }, 'subtitle')} />
        </div>
        <div>
          <div className={labelCls}>Description</div>
          <textarea
            className={`${inputCls} resize-none`}
            rows={2}
            value={d.description ?? ''}
            disabled={readOnly}
            placeholder="What this step does"
            onChange={(e) => onChange({ description: e.target.value }, 'description')}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#F1F5F9]">
          <div>
            <div className="text-[#64748B] text-[11px] font-semibold mt-2 mb-1">Status</div>
            <select
              className={inputCls}
              value={d.status}
              disabled={readOnly}
              onChange={(e) => onChange({ status: e.target.value as NodeRunStatus })}
              style={{ color: st.text, fontWeight: 700 }}
            >
              {NODE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[#64748B] text-[11px] font-semibold mt-2 mb-1">Records</div>
            <div className="font-mono font-bold text-[#141416] py-1.5">{d.records ?? '—'}</div>
          </div>
        </div>

        <div>
          <div className={labelCls}>Execution condition</div>
          <input
            className={`${inputCls} font-mono`}
            value={d.condition ?? ''}
            disabled={readOnly}
            placeholder={kind === 'condition' ? 'e.g. asset.poNumber != null' : 'Always run'}
            onChange={(e) => onChange({ condition: e.target.value }, 'condition')}
          />
        </div>

        <div className="pt-2 border-t border-[#F1F5F9]">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[#64748B] text-[11px] font-semibold">Parameters</div>
            {!readOnly && (
              <button
                onClick={() => onChange({ config: [...d.config, { key: '', value: '' }] })}
                className="flex items-center gap-1 text-[11px] font-semibold text-[#64748B] hover:text-[#141416] cursor-pointer"
              >
                <Plus size={12} /> Add
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {d.config.length === 0 && <div className="text-[11px] text-[#94A3B8]">No parameters</div>}
            {d.config.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  className={`${inputCls} font-mono`}
                  placeholder="key"
                  value={c.key}
                  disabled={readOnly}
                  onChange={(e) => setConfig(i, { key: e.target.value })}
                />
                <input
                  className={inputCls}
                  placeholder="value"
                  value={c.value}
                  disabled={readOnly}
                  onChange={(e) => setConfig(i, { value: e.target.value })}
                />
                {!readOnly && (
                  <button
                    onClick={() => onChange({ config: d.config.filter((_, idx) => idx !== i) })}
                    className="p-1 text-[#94A3B8] hover:text-[#DC2626] cursor-pointer shrink-0"
                    aria-label="Remove parameter"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-[#F1F5F9] space-y-3">
          <div>
            <div className={labelCls}>Inputs</div>
            {hasInput(kind) ? (
              <ListEditor items={d.inputs} onChange={(inputs) => onChange({ inputs })} placeholder="Add input field" locked={readOnly} />
            ) : (
              <div className="text-[11px] text-[#94A3B8]">Trigger nodes start the workflow and take no inputs.</div>
            )}
          </div>
          <div>
            <div className={labelCls}>Outputs</div>
            {kind === 'condition' ? (
              <ListEditor items={['true', 'false']} onChange={() => {}} placeholder="" locked />
            ) : hasOutput(kind) ? (
              <ListEditor items={d.outputs} onChange={(outputs) => onChange({ outputs })} placeholder="Add output field" locked={readOnly} />
            ) : (
              <div className="text-[11px] text-[#94A3B8]">End nodes finish the run and have no outputs.</div>
            )}
          </div>
        </div>

        {!readOnly && (
          <div className="pt-2 flex items-center gap-2">
            <button onClick={onDuplicate} className={secondaryBtn}>
              <Copy size={13} />
              <span>Duplicate</span>
            </button>
            <button onClick={onDelete} className={`${secondaryBtn} hover:!border-[#DC2626] hover:text-[#DC2626]`}>
              <Trash2 size={13} />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
