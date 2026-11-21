'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Handle,
  Position,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Database, GitBranch, Maximize, Minimize2, Scan, ZoomIn, ZoomOut, Scale } from 'lucide-react';
import type { CanonicalModelRef, DecisionStep, Source } from '@/services/sourceService';
import { STATUS_META, StatusDot, SystemMark } from './sourceMeta';

type SystemData = { kind: 'system'; source: Source; dim: boolean; active: boolean; selected: boolean };
type ModelData = { kind: 'model'; model: CanonicalModelRef; fields: number; dim: boolean; active: boolean };
type StepData = { kind: 'step'; step: DecisionStep; dim: boolean; active: boolean };
type SystemNode = Node<SystemData, 'system'>;
type ModelNode = Node<ModelData, 'model'>;
type StepNode = Node<StepData, 'step'>;
type GraphNode = SystemNode | ModelNode | StepNode;

const handleStyle: React.CSSProperties = { opacity: 0, width: 6, height: 6, minWidth: 0, minHeight: 0, border: 0 };

function shell(dim: boolean, active: boolean, selected = false) {
  return `rounded-xl border bg-white px-2.5 py-1.5 shadow-2xs transition-opacity ${
    selected ? 'border-[#FFD600] ring-2 ring-[#FEF08A]' : active ? 'border-[#141416]' : 'border-[#E2E8F0] hover:border-gray-400'
  } ${dim ? 'opacity-25' : 'opacity-100'}`;
}

function SystemNodeView({ data }: NodeProps<SystemNode>) {
  const s = data.source;
  return (
    <div className={`${shell(data.dim, data.active, data.selected)} w-[200px] cursor-pointer`} title={`${s.name} · ${STATUS_META[s.status].label}`}>
      <Handle type="source" position={Position.Right} style={handleStyle} isConnectable={false} />
      <div className="flex items-center gap-2">
        <SystemMark name={s.name} size={20} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-bold leading-tight text-[#141416]">{s.name}</div>
          <div className="truncate text-[10px] leading-tight text-[#94A3B8]">
            {s.tables.length} tables · {s.fieldMappings.length} rules
          </div>
        </div>
        <StatusDot status={s.status} />
      </div>
    </div>
  );
}

function ModelNodeView({ data }: NodeProps<ModelNode>) {
  return (
    <div className={`${shell(data.dim, data.active)} w-[200px] cursor-pointer`}>
      <Handle type="target" position={Position.Left} style={handleStyle} isConnectable={false} />
      <Handle type="source" position={Position.Right} style={handleStyle} isConnectable={false} />
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#FEF3C7] bg-[#FFFBEB] text-amber-500">
          <Database size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-bold leading-tight text-[#141416]">{data.model.name}</div>
          <div className="truncate text-[10px] leading-tight text-[#94A3B8]">
            Canonical model {data.model.version} · {data.fields} mapping rules
          </div>
        </div>
      </div>
    </div>
  );
}

function StepNodeView({ data }: NodeProps<StepNode>) {
  const isDecision = data.step.kind !== 'Model';
  return (
    <div className={`${shell(data.dim, data.active)} w-[180px] cursor-pointer`}>
      <Handle type="target" position={Position.Left} style={handleStyle} isConnectable={false} />
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]">
          {isDecision ? <Scale size={13} /> : <GitBranch size={13} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-bold leading-tight text-[#141416]">{data.step.name}</div>
          <div className="truncate text-[10px] leading-tight text-[#94A3B8]">{data.step.kind}</div>
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { system: SystemNodeView, model: ModelNodeView, step: StepNodeView };

interface GraphProps {
  sources: Source[];
  models: CanonicalModelRef[];
  steps: DecisionStep[];
  selectedId: string | null;
  showFieldLinks: boolean;
  onSelectSystem: (id: string) => void;
}

const ROW = 52;
const sysId = (id: string) => `sys:${id}`;

interface RawEdge {
  id: string;
  source: string;
  target: string;
  fields?: number;
  status?: Source['status'];
}

function buildGraph(sources: Source[], models: CanonicalModelRef[], steps: DecisionStep[]) {
  const height = Math.max(sources.length * ROW, models.length * 76, steps.length * 76);
  const modelGap = height / Math.max(1, models.length);
  const stepGap = height / Math.max(1, steps.length);
  const raw: RawEdge[] = [];
  const fieldsPerModel: Record<string, number> = {};
  for (const s of sources) {
    const counts: Record<string, number> = {};
    for (const m of s.fieldMappings) counts[m.canonicalModel] = (counts[m.canonicalModel] ?? 0) + 1;
    for (const [mid, n] of Object.entries(counts)) {
      fieldsPerModel[mid] = (fieldsPerModel[mid] ?? 0) + n;
      raw.push({ id: `${sysId(s.id)}->m:${mid}`, source: sysId(s.id), target: `m:${mid}`, fields: n, status: s.status });
    }
  }
  for (const st of steps) for (const mid of st.inputs) raw.push({ id: `m:${mid}->s:${st.id}`, source: `m:${mid}`, target: `s:${st.id}` });

  const sysOffset = (height - sources.length * ROW) / 2;
  const positions: Record<string, { x: number; y: number }> = {};
  sources.forEach((s, i) => (positions[sysId(s.id)] = { x: 0, y: sysOffset + i * ROW }));
  models.forEach((m, i) => (positions[`m:${m.id}`] = { x: 330, y: i * modelGap + modelGap / 2 - 22 }));
  steps.forEach((st, i) => (positions[`s:${st.id}`] = { x: 640, y: i * stepGap + stepGap / 2 - 20 }));
  return { raw, positions, fieldsPerModel };
}

/** Directed walk: everything upstream of the focus plus everything downstream of it. */
function tracePaths(focus: string, raw: RawEdge[]) {
  const nodes = new Set<string>([focus]);
  const edges = new Set<string>();
  const walk = (start: string, dir: 'down' | 'up') => {
    const queue = [start];
    const seen = new Set<string>([start]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of raw) {
        const from = dir === 'down' ? e.source : e.target;
        const to = dir === 'down' ? e.target : e.source;
        if (from !== cur) continue;
        edges.add(e.id);
        nodes.add(to);
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
  };
  walk(focus, 'down');
  walk(focus, 'up');
  return { nodes, edges };
}

function GraphInner({ sources, models, steps, selectedId, showFieldLinks, onSelectSystem }: GraphProps) {
  const [focus, setFocus] = useState<string | null>(selectedId ? sysId(selectedId) : null);
  const [expanded, setExpanded] = useState(false);
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();

  // Re-focus when the selected system changes (adjusting state during render, not in an effect)
  const [prevSelected, setPrevSelected] = useState(selectedId);
  if (prevSelected !== selectedId) {
    setPrevSelected(selectedId);
    setFocus(selectedId ? sysId(selectedId) : null);
  }

  const { raw, positions, fieldsPerModel } = useMemo(() => buildGraph(sources, models, steps), [sources, models, steps]);
  const trace = useMemo(() => (focus && positions[focus] ? tracePaths(focus, raw) : null), [focus, raw, positions]);

  const nodes: GraphNode[] = useMemo(() => {
    const isDim = (id: string) => !!trace && !trace.nodes.has(id);
    const isActive = (id: string) => !!trace && id === focus;
    return [
      ...sources.map<SystemNode>((s) => ({
        id: sysId(s.id),
        type: 'system',
        position: positions[sysId(s.id)],
        data: { kind: 'system', source: s, dim: isDim(sysId(s.id)), active: isActive(sysId(s.id)), selected: s.id === selectedId },
      })),
      ...models.map<ModelNode>((m) => ({
        id: `m:${m.id}`,
        type: 'model',
        position: positions[`m:${m.id}`],
        data: { kind: 'model', model: m, fields: fieldsPerModel[m.id] ?? 0, dim: isDim(`m:${m.id}`), active: isActive(`m:${m.id}`) },
      })),
      ...steps.map<StepNode>((st) => ({
        id: `s:${st.id}`,
        type: 'step',
        position: positions[`s:${st.id}`],
        data: { kind: 'step', step: st, dim: isDim(`s:${st.id}`), active: isActive(`s:${st.id}`) },
      })),
    ];
  }, [sources, models, steps, positions, fieldsPerModel, trace, focus, selectedId]);

  const edges: Edge[] = useMemo(
    () =>
      raw.map((e) => {
        const on = trace?.edges.has(e.id);
        const meta = e.status ? STATUS_META[e.status] : null;
        const color = meta && e.status !== 'healthy' ? meta.edge : on ? '#141416' : '#CBD5E1';
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'default',
          animated: !!on,
          focusable: false,
          selectable: false,
          label: showFieldLinks && e.fields ? `${e.fields}` : undefined,
          labelStyle: { fontSize: 10, fontWeight: 700, fill: '#475569', fontFamily: 'var(--font-mono, monospace)' },
          labelBgStyle: { fill: '#FFFFFF', stroke: '#E2E8F0' },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          style: {
            stroke: color,
            strokeWidth: on ? 2 : 1.25,
            opacity: trace && !on ? 0.12 : 1,
            strokeDasharray: e.status === 'paused' || e.status === 'warning' ? '5 4' : undefined,
          },
          zIndex: on ? 1 : 0,
        };
      }),
    [raw, trace, showFieldLinks],
  );

  const nodeKey = useMemo(() => sources.map((s) => s.id).join(','), [sources]);
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.08, duration: 250 }), 60);
    return () => clearTimeout(t);
  }, [nodeKey, expanded, fitView]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: GraphNode) => {
      setFocus(node.id);
      if (node.type === 'system') onSelectSystem(node.data.source.id);
    },
    [onSelectSystem],
  );

  const btn =
    'flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#475569] hover:border-gray-400 hover:text-[#141416]';

  const view = (
    <div
      className={
        expanded
          ? 'fixed inset-0 z-[1100] flex flex-col bg-white p-4'
          : 'flex h-[560px] min-w-0 flex-col md:h-[680px] lg:h-[760px]'
      }
      role={expanded ? 'dialog' : undefined}
      aria-label={expanded ? 'Source map, expanded' : undefined}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[#F1F5F9] px-3 py-2.5">
        <div className="flex items-center gap-1">
          <button className={btn} onClick={() => zoomOut({ duration: 150 })} aria-label="Zoom out">
            <ZoomOut size={14} />
          </button>
          <span className="w-11 text-center font-mono text-[11px] font-semibold text-[#475569]">{Math.round(zoom * 100)}%</span>
          <button className={btn} onClick={() => zoomIn({ duration: 150 })} aria-label="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button className={btn} onClick={() => fitView({ padding: 0.08, duration: 250 })} aria-label="Fit to view">
            <Scan size={14} />
          </button>
        </div>
        <p className="order-last m-0 min-w-0 basis-full text-[11px] leading-snug text-[#64748B]">
          {sources.length} systems → {models.length} canonical models → {steps.length} decision steps. Select a node to trace its paths.
        </p>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto flex h-7 cursor-pointer items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-2.5 text-xs font-semibold text-[#141416] hover:border-gray-400"
        >
          {expanded ? <Minimize2 size={13} /> : <Maximize size={13} />}
          {expanded ? 'Exit full screen' : 'Expand map'}
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <ReactFlow<GraphNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={() => setFocus(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          zoomOnDoubleClick={false}
          minZoom={0.2}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: 0.08 }}
        >
          <Background gap={18} size={1} color="#E2E8F0" />
        </ReactFlow>
        <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-[#E2E8F0] bg-white/95 px-2 py-1 text-[10px] font-semibold text-[#64748B]">
          {(['healthy', 'warning', 'stale', 'failed'] as const).map((st) => (
            <span key={st} className="flex items-center gap-1">
              <span
                className="inline-block h-0.5 w-4"
                style={{ backgroundColor: st === 'healthy' ? '#CBD5E1' : STATUS_META[st].edge }}
              />
              {STATUS_META[st].label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  if (!expanded) return view;
  // Render the expanded map on <body> so no ancestor's overflow or transform can clip it.
  return (
    <>
      <div className="flex h-[560px] items-center justify-center text-xs text-[#94A3B8] md:h-[680px] lg:h-[760px]">Map is open in full screen. Press Esc to close.</div>
      {createPortal(view, document.body)}
    </>
  );
}

export function SourceGraph(props: GraphProps) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
