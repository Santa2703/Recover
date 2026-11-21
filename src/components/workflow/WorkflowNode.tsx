'use client';

import React, { createContext, memo, useContext } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { CircleDot, CircleX, Loader2, MinusCircle, TriangleAlert } from 'lucide-react';
import { StatusBadge } from '@/components/ui';
import type { Tone } from '@/theme/tokens';
import type { WfNode } from './useWorkflowEditor';
import { ICON_OVERRIDES, KIND_META, kindColor } from './nodeRegistry';
import { hasInput, hasOutput } from '@/services/workflowService';

/** Canvas view tab: Overview hides node footers; Data flow shows record counts on edges. */
export type CanvasView = 'Overview' | 'Details' | 'Data flow';
export const CanvasViewContext = createContext<CanvasView>('Details');

/*
 * Same card anatomy as the Decision flow nodes (src/components/decisionflow/DecisionNode.tsx) so both
 * Studio modes read the same: 3 px type-coloured left edge, type tag + compact status pill, bold title
 * (2 lines), muted subtitle (2 lines), a chip row at the bottom, hollow output circle on the right.
 */
export const WF_NODE_W = 192;

/** Card tint for kinds that need to stand out (human sign-off, alerts); everything else is white. */
const CARD: Partial<Record<WfNode['type'], { bg: string; border: string }>> = {
  approval: { bg: '#FFF7ED', border: '#FED7AA' },
  notification: { bg: '#FEF2F2', border: '#FECACA' },
};

const STATUS_PILL: Record<string, { tone: Tone; icon: React.ReactNode }> = {
  Success: { tone: 'success', icon: true },
  Running: { tone: 'info', icon: <Loader2 size={10} className="animate-spin" /> },
  Warning: { tone: 'warning', icon: <TriangleAlert size={10} /> },
  Failed: { tone: 'danger', icon: <CircleX size={10} /> },
  Skipped: { tone: 'neutral', icon: <MinusCircle size={10} /> },
  Idle: { tone: 'neutral', icon: <CircleDot size={10} /> },
};

const COMPACT_PILL = 'shrink-0 !gap-0.5 !px-1.5 !py-0 !text-[9.5px] !font-semibold [&>svg]:!h-2.5 [&>svg]:!w-2.5';

const sourceHandle = (color: string): React.CSSProperties => ({ width: 11, height: 11, right: -6, background: '#FFFFFF', border: `2px solid ${color}`, borderRadius: 9999 });
/** Input stays connectable but invisible: the edge's arrowhead marks where lines come in. */
const targetHandle: React.CSSProperties = { width: 10, height: 14, left: -5, background: 'transparent', border: 'none' };

function WorkflowNodeComponent({ data, type, selected }: NodeProps<WfNode>) {
  const view = useContext(CanvasViewContext);
  const meta = KIND_META[type];
  const color = kindColor(type);
  const Icon = (data.icon && ICON_OVERRIDES[data.icon]) || meta.icon;
  const pill = STATUS_PILL[data.status] ?? STATUS_PILL.Idle;
  const card = CARD[type];
  const hasRecords = data.records !== undefined && data.records !== null;

  return (
    <div
      className={`relative pl-3.5 pr-3 pt-2.5 pb-2 transition-shadow ${selected ? 'ring-2 ring-[#FFD600]/70 shadow-md' : 'shadow-xs hover:shadow-md'}`}
      style={{
        width: WF_NODE_W,
        background: card?.bg ?? '#FFFFFF',
        borderRadius: type === 'condition' ? '12px 44px 44px 12px' : 12,
        border: `1px solid ${selected ? '#141416' : card?.border ?? '#E2E8F0'}`,
      }}
    >
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: color, borderRadius: '12px 0 0 12px' }} />
      {hasInput(type) && <Handle type="target" position={Position.Left} style={targetHandle} />}

      {/* Type tag + run status */}
      <div className="flex items-center justify-between gap-1.5">
        <span className="inline-flex min-w-0 items-center gap-1 text-[9.5px] font-bold uppercase" style={{ color }}>
          <Icon size={11} className="shrink-0" aria-hidden />
          <span className="truncate">{meta.label}</span>
        </span>
        <StatusBadge tone={pill.tone} icon={pill.icon} className={COMPACT_PILL}>
          {data.status}
        </StatusBadge>
      </div>

      {/* Title + subtitle */}
      <div className="mt-1 text-[13px] font-extrabold leading-tight text-[#141416] line-clamp-2" title={data.label}>
        {data.label || meta.label}
      </div>
      {data.subtitle && (
        <div className="mt-0.5 text-[11px] leading-snug text-[#64748B] line-clamp-2" title={data.subtitle}>
          {data.subtitle}
        </div>
      )}

      {/* Chip row: system badge and records (hidden in Overview) */}
      {view !== 'Overview' && (data.brand || hasRecords) && (
        <div className="mt-1.5 flex min-w-0 items-center justify-between gap-1.5 text-[10px]">
          {data.brand ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-[#94A3B8]">
              <span className="shrink-0">System</span>
              <span className="rounded-md px-1.5 py-px font-bold" style={{ color: data.brand.color, backgroundColor: `${data.brand.color}1A` }}>
                {data.brand.text}
              </span>
            </span>
          ) : (
            <span />
          )}
          {hasRecords && <span className="shrink-0 rounded-md bg-[#F1F5F9] px-1.5 py-px font-mono font-semibold text-[#475569]">{data.records} records</span>}
        </div>
      )}

      {type === 'condition' ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ ...sourceHandle('#059669'), top: '32%' }} />
          <span className="absolute text-[9px] font-bold text-[#047857] pointer-events-none" style={{ left: 'calc(100% + 8px)', top: 'calc(32% - 15px)' }}>
            true
          </span>
          <Handle id="false" type="source" position={Position.Right} style={{ ...sourceHandle('#DC2626'), top: '72%' }} />
          <span className="absolute text-[9px] font-bold text-[#B91C1C] pointer-events-none" style={{ left: 'calc(100% + 8px)', top: 'calc(72% + 5px)' }}>
            false
          </span>
        </>
      ) : (
        hasOutput(type) && <Handle type="source" position={Position.Right} style={sourceHandle(color)} />
      )}
    </div>
  );
}

export const WorkflowNode = memo(WorkflowNodeComponent);
