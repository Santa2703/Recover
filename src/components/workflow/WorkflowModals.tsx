'use client';

import React, { useState } from 'react';
import { Modal } from 'antd';
import { AlertTriangle } from 'lucide-react';
import type { CreateWorkflowInput, ValidationIssue, Workflow, WorkflowDetailsPatch, WorkflowType } from '@/services/workflowService';
import { NODE_KINDS, STATUS_STYLE, kindColor } from './nodeRegistry';

const inputCls =
  'w-full px-2.5 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs text-[#141416] focus:outline-none focus:border-[#FFD600]';
const labelCls = 'block text-[#64748B] text-[11px] font-semibold mb-1';
const primaryBtn =
  'px-4 py-2 bg-[#FFD600] hover:bg-[#F2CB00] rounded-xl text-xs font-bold text-black transition-all cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryBtn =
  'px-4 py-2 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-xl text-xs font-semibold text-[#141416] transition-all cursor-pointer';

const SYSTEM_TYPES = ['ERP', 'WMS', 'Lease', 'Recycler', 'CRM', 'OMS', 'MRO', 'EAM', 'TMS', 'File'];
const TRIGGERS = ['Every 5 min', 'Every 15 min', 'Hourly', 'On approval', 'On file arrival', 'Manual'];

export const formatRunTime = (iso: string | null) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function Footer({ onCancel, onOk, okText, busy, disabled }: { onCancel: () => void; onOk: () => void; okText: string; busy?: boolean; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button onClick={onCancel} className={secondaryBtn}>
        Cancel
      </button>
      <button onClick={onOk} disabled={busy || disabled} className={primaryBtn}>
        {busy ? 'Saving…' : okText}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ new workflow

export function NewWorkflowModal({ open, onCancel, onCreate }: { open: boolean; onCancel: () => void; onCreate: (input: CreateWorkflowInput) => Promise<void> }) {
  const blank: CreateWorkflowInput = { name: '', type: 'Ingest', sourceSystemType: 'ERP', sourceSystemName: '', trigger: 'Every 15 min', owner: '', description: '' };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  // Reset the form each time the modal opens (adjusting state during render)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setForm(blank);
  }
  const set = (patch: Partial<CreateWorkflowInput>) => setForm((f) => ({ ...f, ...patch }));
  const valid = form.name.trim() && form.sourceSystemName.trim() && form.owner.trim();

  const submit = async () => {
    setBusy(true);
    try {
      await onCreate({ ...form, name: form.name.trim() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onCancel={onCancel} footer={null} title={<span className="text-sm font-extrabold">New workflow</span>} width={480}>
      <div className="space-y-3 text-xs pt-1">
        <div>
          <label className={labelCls}>Name</label>
          <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ingest · System name" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Type</label>
            <select className={inputCls} value={form.type} onChange={(e) => set({ type: e.target.value as WorkflowType })}>
              <option>Ingest</option>
              <option>Outbound</option>
              <option>Transformation</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Trigger</label>
            <select className={inputCls} value={form.trigger} onChange={(e) => set({ trigger: e.target.value })}>
              {TRIGGERS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>System type</label>
            <select className={inputCls} value={form.sourceSystemType} onChange={(e) => set({ sourceSystemType: e.target.value })}>
              {SYSTEM_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Source system</label>
            <input className={inputCls} value={form.sourceSystemName} onChange={(e) => set({ sourceSystemName: e.target.value })} placeholder="e.g. SAP S/4HANA" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Owner</label>
          <input className={inputCls} value={form.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="Team" />
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <textarea className={`${inputCls} resize-none`} rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        <Footer onCancel={onCancel} onOk={submit} okText="Create workflow" busy={busy} disabled={!valid} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ settings

export function WorkflowSettingsModal({
  workflow,
  open,
  onCancel,
  onSave,
}: {
  workflow: Workflow | undefined;
  open: boolean;
  onCancel: () => void;
  onSave: (patch: WorkflowDetailsPatch) => Promise<void>;
}) {
  const [form, setForm] = useState({ name: '', description: '', owner: '', trigger: '', tags: '' });
  const [busy, setBusy] = useState(false);
  // Load the workflow's current values when the modal opens or the workflow changes
  const [loadedFor, setLoadedFor] = useState<{ open: boolean; workflow: Workflow | undefined }>({ open, workflow });
  if (loadedFor.open !== open || loadedFor.workflow !== workflow) {
    setLoadedFor({ open, workflow });
    if (open && workflow) {
      setForm({ name: workflow.name, description: workflow.description, owner: workflow.owner, trigger: workflow.trigger, tags: workflow.tags.join(', ') });
    }
  }
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    setBusy(true);
    try {
      await onSave({
        name: form.name.trim(),
        description: form.description.trim(),
        owner: form.owner.trim(),
        trigger: form.trigger.trim(),
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onCancel={onCancel} footer={null} title={<span className="text-sm font-extrabold">Workflow settings</span>} width={480}>
      <div className="space-y-3 text-xs pt-1">
        <div>
          <label className={labelCls}>Name</label>
          <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <textarea className={`${inputCls} resize-none`} rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Owner</label>
            <input className={inputCls} value={form.owner} onChange={(e) => set({ owner: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Trigger</label>
            <input className={inputCls} value={form.trigger} onChange={(e) => set({ trigger: e.target.value })} list="wf-triggers" />
            <datalist id="wf-triggers">
              {TRIGGERS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        </div>
        <div>
          <label className={labelCls}>Tags (comma separated)</label>
          <input className={inputCls} value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
        </div>
        <Footer onCancel={onCancel} onOk={submit} okText="Save settings" busy={busy} disabled={!form.name.trim()} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ run history

export function RunHistoryModal({ workflow, open, onClose }: { workflow: Workflow | undefined; open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={<span className="text-sm font-extrabold">Run history{workflow ? ` · ${workflow.code}` : ''}</span>}
      width={640}
    >
      {!workflow || !workflow.runs.length ? (
        <div className="py-8 text-center text-xs text-[#94A3B8]">No runs recorded yet.</div>
      ) : (
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#E2E8F0] text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
              <th className="py-2 pr-3">Run</th>
              <th className="py-2 pr-3">Started</th>
              <th className="py-2 pr-3">Trigger</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3 text-right">Records</th>
              <th className="py-2 text-right">Duration</th>
            </tr>
          </thead>
          <tbody>
            {workflow.runs.map((r) => {
              const st = STATUS_STYLE[r.status];
              return (
                <tr key={r.id} className="border-b border-[#F8FAFC] hover:bg-[#F8FAFC] align-top">
                  <td className="py-2 pr-3 font-mono text-[11px] text-[#141416]">
                    {r.id}
                    {r.nodeResults && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.nodeResults.map((n) => (
                          <span key={n.nodeId} className="inline-flex items-center gap-1 text-[10px] font-sans text-[#64748B]">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STATUS_STYLE[n.status].dot }} />
                            {n.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-[#475569] whitespace-nowrap">{formatRunTime(r.startedAt)}</td>
                  <td className="py-2 pr-3 text-[#475569]">{r.trigger}</td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1 font-bold text-[11px]" style={{ color: st.text }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: st.dot }} />
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{r.records}</td>
                  <td className="py-2 text-right font-mono">{(r.durationMs / 1000).toFixed(1)} s</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ documentation

export function DocumentationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const shortcuts = [
    ['Drag from left panel', 'Add a component (or click it)'],
    ['Drag output → input', 'Connect two nodes'],
    ['Click an edge, then ×', 'Disconnect'],
    ['Shift + drag', 'Box-select several nodes'],
    ['Shift / Ctrl + click', 'Add to selection'],
    ['Delete / Backspace', 'Delete selection and its edges'],
    ['Ctrl + D', 'Duplicate selection'],
    ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / redo'],
  ];
  return (
    <Modal open={open} onCancel={onClose} footer={null} title={<span className="text-sm font-extrabold">Workflow studio documentation</span>} width={640}>
      <div className="space-y-4 text-xs">
        <div>
          <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Node types</div>
          <div className="grid grid-cols-2 gap-1.5">
            {NODE_KINDS.map((k) => {
              const Icon = k.icon;
              const color = kindColor(k.kind);
              return (
                <div key={k.kind} className="flex items-center gap-2 p-2 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}26` }}>
                    <Icon size={12} style={{ color }} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-[11px] text-[#141416]">{k.label}</div>
                    <div className="text-[10px] text-[#64748B] truncate">{k.hint}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Canvas controls</div>
          <div className="divide-y divide-[#F1F5F9]">
            {shortcuts.map(([k, v]) => (
              <div key={k} className="flex justify-between py-1.5">
                <span className="font-mono text-[11px] text-[#141416]">{k}</span>
                <span className="text-[#64748B]">{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Connection rules</div>
          <ul className="list-disc pl-4 space-y-1 text-[#475569]">
            <li>A node cannot connect to itself, and two nodes connect at most once per output.</li>
            <li>Trigger nodes have no inputs; End nodes have no outputs.</li>
            <li>Condition nodes have two labelled outputs, true and false, each with one edge.</li>
            <li>Simulated runs follow the Condition parameter <span className="font-mono">branch</span>; set <span className="font-mono">simulateFailure = true</span> on a node to test failure handling.</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ validation

export function ValidationModal({
  issues,
  open,
  onClose,
  onSelectNode,
}: {
  issues: ValidationIssue[];
  open: boolean;
  onClose: () => void;
  onSelectNode: (id: string) => void;
}) {
  const errors = issues.filter((i) => i.level === 'error').length;
  return (
    <Modal open={open} onCancel={onClose} footer={null} title={<span className="text-sm font-extrabold">Validation results</span>} width={520}>
      <div className="space-y-2 text-xs">
        <div className="text-[#64748B]">
          {errors} error{errors === 1 ? '' : 's'} · {issues.length - errors} warning{issues.length - errors === 1 ? '' : 's'}
          {errors ? '. Fix errors before publishing.' : '. The workflow can be published.'}
        </div>
        {issues.map((i, idx) => (
          <button
            key={idx}
            onClick={() => i.nodeId && onSelectNode(i.nodeId)}
            disabled={!i.nodeId}
            className="w-full text-left flex items-start gap-2 p-2 rounded-xl border border-[#E2E8F0] hover:border-gray-400 disabled:hover:border-[#E2E8F0] cursor-pointer disabled:cursor-default transition-all"
          >
            <AlertTriangle size={14} className={`shrink-0 mt-px ${i.level === 'error' ? 'text-[#DC2626]' : 'text-[#D97706]'}`} />
            <span className="text-[#141416]">{i.message}</span>
            {i.nodeId && <span className="ml-auto text-[10px] font-semibold text-[#64748B] shrink-0">Show</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}
