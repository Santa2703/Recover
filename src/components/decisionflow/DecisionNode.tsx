'use client';

import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Bot, Flag, GitBranch, GraduationCap, Inbox, Lock, Pin, Scale, ShieldCheck, Sparkles, UserCheck, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { StatusBadge } from '@/components/ui';
import type { Tone } from '@/theme/tokens';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import type { FlowKind, FlowNode, NodeStatus } from '@/services/decisionFlowService';
import { ACTION_LABEL } from '@/services/decisionFlowService';

export const NODE_W = 192;

interface KindStyle {
  label: string;
  icon: LucideIcon;
  /** Left edge colour. */
  edge: string;
  /** Type tag text colour. */
  text: string;
  /** Card background: tinted for gates, rules and approval so the type reads at a glance. */
  card: string;
  /** Card border (a shade darker than the tint). */
  border: string;
}

const CORE: Omit<KindStyle, 'label' | 'icon'> = { edge: '#64748B', text: '#475569', card: '#FFFFFF', border: '#E2E8F0' };

export const KIND_STYLE: Record<Exclude<FlowKind, 'band'>, KindStyle> = {
  trigger: { label: 'Core · intake', icon: Inbox, ...CORE },
  agent: { label: 'Core agent', icon: Bot, ...CORE },
  gate: { label: 'Guardrail gate', icon: ShieldCheck, edge: '#DC2626', text: '#B91C1C', card: '#FEF2F2', border: '#FECACA' },
  rule: { label: 'Business rule', icon: Scale, edge: '#FFD600', text: '#8A6D00', card: '#FFFBEB', border: '#FDE68A' },
  decision: { label: 'Core decision', icon: GitBranch, ...CORE },
  approval: { label: 'Approval', icon: UserCheck, edge: '#D97706', text: '#B45309', card: '#FFF7ED', border: '#FED7AA' },
  outcome: { label: 'Outcome', icon: Flag, edge: '#141416', text: '#475569', card: '#FFFFFF', border: '#E2E8F0' },
  step: { label: 'Process step', icon: Wrench, edge: '#059669', text: '#047857', card: '#FFFFFF', border: '#E2E8F0' },
  learning: { label: 'Core · learning', icon: GraduationCap, ...CORE },
};

export const STATUS_TONE: Record<NodeStatus, { tone: Tone; icon?: React.ReactNode }> = {
  Live: { tone: 'success' },
  Draft: { tone: 'brand' },
  Locked: { tone: 'neutral', icon: <Lock size={11} strokeWidth={2.25} /> },
  Fixed: { tone: 'neutral', icon: <Pin size={11} strokeWidth={2.25} /> },
  Proposed: { tone: 'info', icon: <Sparkles size={11} strokeWidth={2.25} /> },
  Blocked: { tone: 'danger' },
  Inactive: { tone: 'warning' },
};

/** `compact` is the small pill used on canvas cards so the type tag keeps its full label. */
export function NodeStatusPill({ status, compact = false }: { status: NodeStatus; compact?: boolean }) {
  const s = STATUS_TONE[status];
  return (
    <StatusBadge
      tone={s.tone}
      icon={s.icon ?? true}
      className={compact ? 'shrink-0 !gap-0.5 !px-1.5 !py-0 !text-[9.5px] !font-semibold [&>svg]:!h-2.5 [&>svg]:!w-2.5' : ''}
    >
      {status}
    </StatusBadge>
  );
}

export function edgeColorOf(n: FlowNode): string {
  if (n.data.kind === 'outcome' && n.data.route) return DISPOSITION_ROUTES[n.data.route].color;
  return KIND_STYLE[n.data.kind as Exclude<FlowKind, 'band'>]?.edge ?? '#64748B';
}

export type DisplayData = FlowNode['data'] & { status: NodeStatus; blockedBy?: string };

/** Output: hollow circle on the right edge (drag from here to connect). */
const sourceHandle = (color: string): React.CSSProperties => ({ width: 11, height: 11, right: -6, background: '#FFFFFF', border: `2px solid ${color}`, borderRadius: 9999 });
/** Input: invisible but still a drop target; the edge's own arrowhead marks where lines come in. */
const targetHandle: React.CSSProperties = { width: 10, height: 14, left: -5, background: 'transparent', border: 'none' };

/** "BR-03 · never re-lease" (scope goes in the subtitle). */
function ruleTitle(rule: NonNullable<DisplayData['rule']>): string {
  const route = rule.route ? DISPOSITION_ROUTES[rule.route].shortLabel.toLowerCase() : 'choose a route';
  return `${rule.id} · ${ACTION_LABEL[rule.action].toLowerCase()} ${route}`;
}

function DecisionNodeComponent({ data, selected }: NodeProps<FlowNode>) {
  const d = data as DisplayData;
  const kind = d.kind as Exclude<FlowKind, 'band'>;
  const k = KIND_STYLE[kind];
  const Icon = k.icon;
  const edge = kind === 'outcome' && d.route ? DISPOSITION_ROUTES[d.route].color : k.edge;
  const rule = d.rule;
  const title = kind === 'rule' && rule ? ruleTitle(rule) : d.title;
  const subtitle = kind === 'rule' && rule ? (d.blockedBy ? `Blocked by ${d.blockedBy}` : (rule.description || '').split(':')[0] || 'All assets') : d.subtitle;
  const border = selected ? '#141416' : d.proposed ? '#0284C7' : k.border;
  // The decision point gets a rounded right side, like a pointer to the routes.
  const radius = kind === 'decision' ? '12px 44px 44px 12px' : '12px';

  return (
    <div
      className={`relative pl-3.5 pr-3 pt-2.5 pb-2 transition-shadow ${selected ? 'ring-2 ring-[#FFD600]/70 shadow-md' : 'shadow-xs hover:shadow-md'}`}
      style={{
        width: NODE_W,
        minHeight: 104,
        background: k.card,
        borderRadius: radius,
        border: `1px ${d.proposed ? 'dashed' : 'solid'} ${border}`,
        opacity: d.status === 'Inactive' ? 0.75 : 1,
      }}
    >
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: edge, opacity: d.proposed ? 0.5 : 1, borderRadius: '12px 0 0 12px' }} />
      {kind !== 'trigger' && <Handle type="target" position={Position.Left} style={targetHandle} />}

      <div className="flex items-center justify-between gap-1.5">
        <span className="inline-flex min-w-0 items-center gap-1 text-[9.5px] font-bold uppercase tracking-normal" style={{ color: k.text }}>
          <Icon size={11} className="shrink-0" aria-hidden />
          <span className="truncate">{k.label}</span>
        </span>
        <NodeStatusPill status={d.status} compact />
      </div>
      <div className="mt-1 text-[13px] font-extrabold leading-tight text-[#141416] line-clamp-2" title={title}>
        {title}
      </div>
      <div className={`mt-0.5 text-[11px] leading-snug line-clamp-2 ${d.blockedBy ? 'text-[#B91C1C] font-semibold' : 'text-[#64748B]'}`} title={subtitle}>
        {subtitle}
      </div>
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10px] text-[#94A3B8]">
        <span className="shrink-0">Owner</span>
        <span className="truncate rounded-md bg-[#F1F5F9] px-1.5 py-px font-semibold text-[#475569]" title={d.owner}>
          {d.owner}
        </span>
      </div>

      {kind !== 'learning' && <Handle type="source" position={Position.Right} style={sourceHandle(edge === '#FFD600' ? '#C9A800' : edge === '#141416' ? '#64748B' : edge)} />}
    </div>
  );
}

export const DecisionNode = memo(DecisionNodeComponent);

function BandNodeComponent({ width, height }: NodeProps<FlowNode>) {
  return (
    <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F1F5F9]/60 pointer-events-none" style={{ width, height }}>
      <span className="absolute left-4 top-2.5 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">Core prediction and agents · fixed</span>
    </div>
  );
}

export const BandNode = memo(BandNodeComponent);
