'use client';

import React from 'react';
import { message } from 'antd';
import { CircleAlert, Lock, Trash2, X } from 'lucide-react';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import type { RouteId, RuleAction, RuleScope } from '@/models/decision.model';
import { checkRule, getPolicy } from '@/services/decisionService';
import type { BusinessRule } from '@/models/decision.model';
import {
  ACTION_LABEL,
  CHANNELS,
  CHANNEL_LABEL,
  GRADES,
  PRODUCT_CLASSES,
  PRODUCT_CLASS_LABEL,
  ROUTE_IDS,
  SITES,
  deleteSelection,
  readBackRule,
  renameStep,
  selectNode,
  updateRule,
} from '@/services/decisionFlowService';
import type { EditResult, FlowNode, NodeStatus } from '@/services/decisionFlowService';
import { KIND_STYLE, NodeStatusPill } from './DecisionNode';

const INPUT = 'w-full px-2.5 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs focus:border-[#FFD600] focus:outline-none disabled:opacity-60';
const LABEL = 'block text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-1';

function report(r: EditResult) {
  if (!r.ok) message.warning({ content: r.reason, key: 'df-edit' });
}

function Checks<T extends string>({ label, options, value, render, onChange, disabled }: { label: string; options: readonly T[]; value?: T[]; render: (v: T) => string; onChange: (v: T[] | undefined) => void; disabled: boolean }) {
  const set = new Set(value ?? []);
  return (
    <fieldset>
      <legend className={LABEL}>{label}</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {options.map((o) => (
          <label key={o} className="inline-flex items-center gap-1.5 text-xs text-[#141416] cursor-pointer">
            <input
              type="checkbox"
              className="accent-[#141416]"
              checked={set.has(o)}
              disabled={disabled}
              onChange={(e) => {
                const next = new Set(set);
                if (e.target.checked) next.add(o);
                else next.delete(o);
                onChange(next.size ? options.filter((x) => next.has(x)) : undefined);
              }}
            />
            {render(o)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface Props {
  node: FlowNode;
  status: NodeStatus;
  editable: boolean;
}

/** Floating inspector for the selected node. Rule nodes are editable; locked nodes explain why not. */
export function NodeInspector({ node, status, editable }: Props) {
  const d = node.data;
  const k = KIND_STYLE[d.kind as keyof typeof KIND_STYLE];
  const rule = d.rule;
  const canEdit = editable && !d.locked;

  const patchScope = (p: Partial<RuleScope>) => {
    if (!rule) return;
    const scope: RuleScope = { ...rule.scope, ...p };
    (Object.keys(scope) as (keyof RuleScope)[]).forEach((key) => scope[key] === undefined && delete scope[key]);
    report(updateRule(node.id, { scope }));
  };

  const remove = () => {
    const r = deleteSelection([node.id], []);
    if (!r.ok) message.warning({ content: r.reason, key: 'df-edit' });
    else message.success({ content: `${rule?.id ?? d.title} removed`, key: 'df-edit' });
  };

  const hit = rule?.route ? checkRule({ ...rule, route: rule.route } as BusinessRule) : null;

  return (
    <div className="nodrag nopan nowheel w-72 max-w-[calc(100vw-4rem)] max-h-[480px] overflow-y-auto bg-white border border-[#E2E8F0] rounded-2xl shadow-lg p-4 space-y-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: k.text }}>
            {k.label}
          </div>
          <div className="text-sm font-extrabold text-[#141416] truncate">{rule ? rule.id : d.title}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <NodeStatusPill status={status} />
          <button onClick={() => selectNode(null)} className="p-1 rounded-lg text-[#64748B] hover:text-[#141416] hover:bg-[#F1F5F9] cursor-pointer" aria-label="Close inspector">
            <X size={14} />
          </button>
        </div>
      </div>

      {d.locked && (
        <div className="flex gap-2 p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[#475569]">
          <Lock size={14} className="shrink-0 mt-px" />
          <span>
            {status === 'Locked' ? 'Locked' : 'Fixed'} step owned by <b>{d.owner}</b>. It can be moved on the canvas but not edited or deleted from the Studio.
          </span>
        </div>
      )}

      {d.proposed && <div className="p-2.5 rounded-xl bg-[#E0F2FE] text-[#0369A1]">Proposed by the assistant. Approve or dismiss it in the assistant panel.</div>}

      {!d.locked && !editable && !d.proposed && <div className="p-2.5 rounded-xl bg-[#FEF3C7] text-[#92400E]">The draft is submitted. Reject it to make changes.</div>}

      {rule && !d.proposed && (
        <>
          {hit && (
            <div role="alert" className="flex gap-2 p-2.5 rounded-xl bg-[#FEE2E2] text-[#B91C1C]">
              <CircleAlert size={14} className="shrink-0 mt-px" />
              <span>
                <b>Blocked by {hit.guardrailId}</b> (owner {hit.owner}): {hit.message}
              </span>
            </div>
          )}
          <div>
            <span className={LABEL}>Action</span>
            <div className="grid grid-cols-3 gap-1 bg-[#F1F5F9] p-1 rounded-xl" role="radiogroup" aria-label="Action">
              {(['exclude', 'prefer', 'require'] as RuleAction[]).map((a) => (
                <button
                  key={a}
                  role="radio"
                  aria-checked={rule.action === a}
                  disabled={!canEdit}
                  onClick={() => report(updateRule(node.id, { action: a }))}
                  className={`py-1 rounded-lg text-xs cursor-pointer disabled:cursor-not-allowed ${rule.action === a ? 'bg-white font-bold text-[#141416] shadow-2xs' : 'font-semibold text-[#64748B]'}`}
                >
                  {ACTION_LABEL[a]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor={`route-${node.id}`}>
              Route
            </label>
            <select
              id={`route-${node.id}`}
              className={INPUT}
              disabled={!canEdit}
              value={rule.route ?? ''}
              onChange={(e) => {
                const route = (e.target.value || undefined) as RouteId | undefined;
                report(updateRule(node.id, { route, owner: route ? getPolicy().routes[route].owner : rule.owner }));
              }}
            >
              <option value="">Choose a route…</option>
              {ROUTE_IDS.map((r) => (
                <option key={r} value={r}>
                  {DISPOSITION_ROUTES[r].name}
                </option>
              ))}
            </select>
          </div>
          <Checks label="Product class" options={PRODUCT_CLASSES} value={rule.scope.productClass} render={(v) => PRODUCT_CLASS_LABEL[v]} onChange={(v) => patchScope({ productClass: v })} disabled={!canEdit} />
          <Checks label="Grade" options={GRADES} value={rule.scope.condition} render={(v) => v} onChange={(v) => patchScope({ condition: v })} disabled={!canEdit} />
          <Checks label="Intake channel" options={CHANNELS} value={rule.scope.channel} render={(v) => CHANNEL_LABEL[v]} onChange={(v) => patchScope({ channel: v })} disabled={!canEdit} />
          <Checks label="Site" options={SITES} value={rule.scope.site} render={(v) => v} onChange={(v) => patchScope({ site: v })} disabled={!canEdit} />
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['lifeMax', 'Life under %'],
                ['lifeMin', 'Life at least %'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="min-w-0">
                <label className={LABEL} htmlFor={`${key}-${node.id}`}>
                  {label}
                </label>
                <input
                  id={`${key}-${node.id}`}
                  type="number"
                  min={0}
                  max={100}
                  placeholder="Any"
                  className={INPUT}
                  disabled={!canEdit}
                  value={rule.scope[key] ?? ''}
                  onChange={(e) => patchScope({ [key]: e.target.value === '' ? undefined : Math.max(0, Math.min(100, Number(e.target.value))) })}
                />
              </div>
            ))}
          </div>
          <div className="p-2.5 rounded-xl bg-[#FFFBEB] border border-[#FEF3C7]">
            <div className={LABEL}>Reads as</div>
            <div className="text-xs font-semibold text-[#141416]">{readBackRule(rule)}</div>
            <div className="mt-1 text-[11px] text-[#64748B]">Owner {rule.owner}</div>
          </div>
        </>
      )}

      {d.kind === 'step' && !d.locked && !d.proposed && (
        <div>
          <label className={LABEL} htmlFor={`title-${node.id}`}>
            Step name
          </label>
          <input id={`title-${node.id}`} className={INPUT} value={d.title} disabled={!canEdit} onChange={(e) => report(renameStep(node.id, e.target.value))} />
        </div>
      )}

      {!rule && !d.proposed && (
        <dl className="space-y-1.5">
          <div>
            <dt className="text-[#94A3B8]">What it does</dt>
            <dd className="text-[#141416]">{d.subtitle}</dd>
          </div>
          <div>
            <dt className="text-[#94A3B8]">Owner</dt>
            <dd className="text-[#141416]">{d.owner}</dd>
          </div>
        </dl>
      )}

      {!d.locked && !d.proposed && (
        <button
          onClick={remove}
          disabled={!canEdit}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-white border border-[#E2E8F0] hover:border-[#DC2626] hover:text-[#B91C1C] rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 size={13} /> Delete {d.kind === 'rule' ? 'rule' : d.kind === 'outcome' ? 'outcome' : 'step'}
        </button>
      )}
    </div>
  );
}
