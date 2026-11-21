'use client';

import React, { createContext, memo, useContext } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';

export type WorkflowEdgeData = {
  color: string;
  running?: boolean;
  /** Extra label shown in the Data flow view (record count). */
  flowLabel?: string;
};

/** Lets the edge's remove button reach the editor without threading callbacks through edge data. */
export const EdgeActionsContext = createContext<{ removeEdge: (id: string) => void }>({ removeEdge: () => {} });

function WorkflowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const { removeEdge } = useContext(EdgeActionsContext);
  const d = (data ?? {}) as Partial<WorkflowEdgeData>;
  const color = d.color ?? '#94A3B8';
  // Smooth curves going forward (same as the Decision flow canvas); a line that runs back to a card
  // on the left takes a rounded right-angle route so it doesn't loop across the cards.
  const backward = targetX < sourceX - 24;
  const [path, labelX, labelY] = backward
    ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12, offset: 24 })
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const text = [typeof label === 'string' ? label : null, d.flowLabel].filter(Boolean).join(' · ');

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? '#141416' : color,
          strokeWidth: selected ? 2.25 : 1.5,
          strokeDasharray: d.running ? '6 4' : undefined,
          animation: d.running ? 'dashdraw 0.6s linear infinite' : undefined,
        }}
      />
      {(text || selected) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex items-center gap-1"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
          >
            {text && (
              <span className="px-1.5 py-px bg-white border border-[#E2E8F0] rounded-md text-[9px] font-semibold text-[#475569] font-mono shadow-2xs">
                {text}
              </span>
            )}
            {selected && (
              <button
                onClick={() => removeEdge(id)}
                className="w-4 h-4 rounded-full bg-white border border-[#E2E8F0] hover:border-[#DC2626] text-[#64748B] hover:text-[#DC2626] flex items-center justify-center cursor-pointer shadow-2xs"
                title="Disconnect"
                aria-label="Disconnect"
              >
                <X size={10} />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const WorkflowEdge = memo(WorkflowEdgeComponent);
