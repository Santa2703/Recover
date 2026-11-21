'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import type { Connection, Edge, EdgeTypes, IsValidConnection, NodeTypes, OnConnectEnd } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { message } from 'antd';
import { Map as MapIcon, Maximize2, Redo, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { checkConnection } from '@/services/workflowService';
import type { WorkflowNodeKind } from '@/services/workflowService';
import type { WfNode, WorkflowEditor } from './useWorkflowEditor';
import { CanvasViewContext, WorkflowNode } from './WorkflowNode';
import type { CanvasView } from './WorkflowNode';
import { EdgeActionsContext, WorkflowEdge } from './WorkflowEdge';
import type { WorkflowEdgeData } from './WorkflowEdge';
import { DND_MIME, NODE_KINDS, STATUS_STYLE, kindColor } from './nodeRegistry';
import type { PaletteTemplate } from './nodeRegistry';

const nodeTypes: NodeTypes = Object.fromEntries(NODE_KINDS.map((m) => [m.kind, WorkflowNode]));
const edgeTypes: EdgeTypes = { workflow: WorkflowEdge };

const NODE_W = 192;
const NODE_H = 110;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;

export interface CanvasApi {
  addAtCenter: (t: PaletteTemplate) => void;
  fitView: () => void;
}

/** Layered left-to-right layout by longest path from the start nodes. */
function computeLayout(nodes: WfNode[], edges: Edge[]) {
  const layer: Record<string, number> = {};
  const indeg: Record<string, number> = {};
  nodes.forEach((n) => (indeg[n.id] = 0));
  edges.forEach((e) => (indeg[e.target] = (indeg[e.target] ?? 0) + 1));
  const queue = nodes.filter((n) => !indeg[n.id]).map((n) => n.id);
  queue.forEach((id) => (layer[id] = 0));
  const remaining = { ...indeg };
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edges.filter((x) => x.source === id)) {
      layer[e.target] = Math.max(layer[e.target] ?? 0, (layer[id] ?? 0) + 1);
      remaining[e.target] -= 1;
      if (remaining[e.target] === 0) queue.push(e.target);
    }
  }
  // Nodes inside a loop keep a layer after their furthest known parent.
  nodes.forEach((n) => (layer[n.id] = layer[n.id] ?? 0));
  const byLayer: Record<number, WfNode[]> = {};
  nodes.forEach((n) => (byLayer[layer[n.id]] = [...(byLayer[layer[n.id]] ?? []), n]));
  const pos: Record<string, { x: number; y: number }> = {};
  Object.entries(byLayer).forEach(([l, list]) => {
    const sorted = [...list].sort((a, b) => {
      const branch = (n: WfNode) => edges.find((e) => e.target === n.id)?.sourceHandle === 'false' ? 1 : 0;
      return branch(a) - branch(b) || a.position.y - b.position.y;
    });
    sorted.forEach((n, i) => (pos[n.id] = { x: Number(l) * 256, y: (i - (sorted.length - 1) / 2) * 150 }));
  });
  return pos;
}

interface Props {
  editor: WorkflowEditor;
  view: CanvasView;
  onViewChange: (v: CanvasView) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Changes when a different workflow is loaded; triggers fit-to-screen. */
  loadKey: string;
  apiRef: React.MutableRefObject<CanvasApi | null>;
  readOnly?: boolean;
}

export function WorkflowCanvas({ editor, view, onViewChange, expanded, onToggleExpanded, loadKey, apiRef, readOnly }: Props) {
  const rf = useReactFlow<WfNode, Edge>();
  const { zoom } = useViewport();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [showMinimap, setShowMinimap] = useState(false);
  const { nodes, edges } = editor;

  const fit = useCallback(() => {
    void rf.fitView({ padding: 0.15, maxZoom: 1, duration: 250 });
  }, [rf]);

  // Initial view for a newly loaded workflow: readable zoom (72–100%), centred when it fits, else left-aligned.
  useEffect(() => {
    const t = setTimeout(() => {
      const el = wrapperRef.current;
      const ns = rf.getNodes();
      if (!el || !ns.length) return;
      const b = rf.getNodesBounds(ns);
      const pad = 40;
      const W = el.clientWidth;
      const H = el.clientHeight;
      const fitZoom = Math.min((W - 2 * pad) / Math.max(b.width, 1), (H - 2 * pad) / Math.max(b.height, 1));
      const z = Math.min(1, Math.max(0.72, fitZoom));
      const x = b.width * z <= W - 2 * pad ? (W - b.width * z) / 2 - b.x * z : pad - b.x * z;
      const y = (H - b.height * z) / 2 - b.y * z;
      void rf.setViewport({ x, y, zoom: z });
    }, 80);
    return () => clearTimeout(t);
  }, [loadKey, rf]);

  const addAt = useCallback(
    (t: PaletteTemplate, flowPos: { x: number; y: number }) => {
      editor.addNode(t.kind, { x: flowPos.x - NODE_W / 2, y: flowPos.y - NODE_H / 2 }, t.data);
    },
    [editor],
  );

  useEffect(() => {
    apiRef.current = {
      fitView: fit,
      addAtCenter: (t) => {
        const r = wrapperRef.current?.getBoundingClientRect();
        if (!r) return;
        const jitter = (Math.random() - 0.5) * 60;
        addAt(t, rf.screenToFlowPosition({ x: r.left + r.width / 2 + jitter, y: r.top + r.height / 2 + jitter }));
      },
    };
  }, [apiRef, addAt, fit, rf]);

  // ------------------------------------------------------------ connections
  const isValidConnection: IsValidConnection = useCallback(
    (c) => !checkConnection(c, nodes.map((n) => ({ id: n.id, type: n.type as WorkflowNodeKind })), edges),
    [nodes, edges],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const reason = checkConnection(c, nodes.map((n) => ({ id: n.id, type: n.type as WorkflowNodeKind })), edges);
      if (reason) message.warning({ content: reason, key: 'wf-connection' });
      else editor.connect(c);
    },
    [nodes, edges, editor],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (_event, state) => {
      if (state.isValid !== false || !state.fromHandle || !state.toHandle) return;
      const from = state.fromHandle;
      const to = state.toHandle;
      if (from.type === to.type) {
        message.warning({ content: from.type === 'source' ? 'Connect an output to an input.' : 'Connect an input to an output.', key: 'wf-connection' });
        return;
      }
      const c = from.type === 'source'
        ? { source: from.nodeId, sourceHandle: from.id ?? null, target: to.nodeId, targetHandle: to.id ?? null }
        : { source: to.nodeId, sourceHandle: to.id ?? null, target: from.nodeId, targetHandle: from.id ?? null };
      const reason = checkConnection(c, nodes.map((n) => ({ id: n.id, type: n.type as WorkflowNodeKind })), edges);
      if (reason) message.warning({ content: reason, key: 'wf-connection' });
    },
    [nodes, edges],
  );

  // ------------------------------------------------------------ drag & drop
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(DND_MIME);
      if (!raw || readOnly) return;
      e.preventDefault();
      try {
        addAt(JSON.parse(raw) as PaletteTemplate, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      } catch {
        message.error('Could not add that component.');
      }
    },
    [addAt, rf, readOnly],
  );

  // ------------------------------------------------------------ keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        editor.undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        editor.redo();
      } else if (k === 'd') {
        e.preventDefault();
        const ids = editor.duplicate();
        if (ids.length) message.success({ content: `Duplicated ${ids.length} node${ids.length > 1 ? 's' : ''}`, key: 'wf-dup' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  // ------------------------------------------------------------ toolbar actions
  const zoomBy = (delta: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((zoom + delta) * 10) / 10));
    void rf.zoomTo(next, { duration: 150 });
  };

  const autoLayout = () => {
    if (!nodes.length) {
      message.info('Add nodes to lay out');
      return;
    }
    editor.setPositions(computeLayout(nodes, edges));
    message.success(`Auto-layout aligned ${nodes.length} nodes`);
    setTimeout(fit, 60);
  };

  // ------------------------------------------------------------ edge styling (derived, not stored)
  const styledEdges = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return edges.map((e) => {
      const src = byId.get(e.source);
      const tgt = byId.get(e.target);
      const st = src?.data.status ?? 'Idle';
      // Records that reached the target (falls back to what the source emitted).
      const flow = tgt?.data.records ?? src?.data.records;
      // Quiet grey lines like the Decision flow; colour only when the status means something.
      const color = st === 'Running' || st === 'Failed' || st === 'Warning' ? STATUS_STYLE[st].edge : '#94A3B8';
      const data: WorkflowEdgeData = {
        color,
        running: st === 'Running',
        flowLabel: view === 'Data flow' && flow != null ? `${flow} rec` : undefined,
      };
      return { ...e, type: 'workflow', data, markerEnd: { type: MarkerType.ArrowClosed, color: e.selected ? '#141416' : color, width: 16, height: 16 } };
    });
  }, [nodes, edges, view]);

  const edgeActions = useMemo(() => ({ removeEdge: (id: string) => editor.deleteEdges([id]) }), [editor]);

  const btn = 'p-1 hover:bg-white rounded-lg transition-colors cursor-pointer text-[#64748B] hover:text-[#141416]';

  return (
    <>
      {/* Top Toolbar */}
      <div className="p-3 border-b border-[#E2E8F0] flex items-center justify-between gap-3 bg-white flex-wrap">
        {/* Zoom & Layout controls */}
        <div className="flex items-center gap-1.5 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl p-1 text-xs">
          <button onClick={() => zoomBy(-0.1)} className={btn} title="Zoom Out">
            <ZoomOut size={14} />
          </button>
          <span className="px-1.5 font-bold text-xs text-[#141416] select-none min-w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => zoomBy(0.1)} className={btn} title="Zoom In">
            <ZoomIn size={14} />
          </button>
          <div className="h-4 w-px bg-[#E2E8F0] mx-0.5" />
          <button onClick={fit} className={btn} title="Fit to Screen">
            <Maximize2 size={13} />
          </button>
          <button
            onClick={editor.undo}
            disabled={!editor.canUndo}
            className={`${btn} disabled:opacity-40 disabled:cursor-not-allowed`}
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={editor.redo}
            disabled={!editor.canRedo}
            className={`${btn} disabled:opacity-40 disabled:cursor-not-allowed`}
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo size={13} />
          </button>
          <button
            onClick={autoLayout}
            className="px-2 py-0.5 bg-white border border-[#E2E8F0] rounded-lg font-semibold text-[11px] text-[#141416] hover:bg-gray-50 transition-colors cursor-pointer shadow-2xs"
          >
            Auto layout
          </button>
          <button
            onClick={() => setShowMinimap((v) => !v)}
            className={`${btn} ${showMinimap ? 'bg-white text-[#141416]' : ''}`}
            title={showMinimap ? 'Hide minimap' : 'Show minimap'}
            aria-pressed={showMinimap}
          >
            <MapIcon size={13} />
          </button>
        </div>

        {/* Center View Pills & Expand Canvas */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl p-1 text-xs">
            {(['Overview', 'Details', 'Data flow'] as CanvasView[]).map((tab) => (
              <button
                key={tab}
                onClick={() => onViewChange(tab)}
                className={`px-3 py-1 rounded-lg text-xs transition-all cursor-pointer ${
                  view === tab ? 'bg-white font-bold text-[#141416] border border-[#FFD600] shadow-2xs' : 'font-semibold text-[#64748B] hover:text-[#141416]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <button
            onClick={onToggleExpanded}
            className="px-3 py-1.5 bg-[#F8F9FA] hover:bg-white border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#141416] transition-all cursor-pointer shadow-2xs"
          >
            {expanded ? 'Normal canvas' : 'Expand canvas'}
          </button>
        </div>
      </div>

      {/* Canvas Area with Dot Grid Pattern & Live Nodes */}
      <div ref={wrapperRef} className="relative select-none" style={{ height: expanded ? 640 : 540 }}>
        <CanvasViewContext.Provider value={view}>
          <EdgeActionsContext.Provider value={edgeActions}>
            <ReactFlow<WfNode, Edge>
              nodes={nodes}
              edges={styledEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={editor.onNodesChange}
              onEdgesChange={editor.onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              onDragOver={onDragOver}
              onDrop={onDrop}
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
              multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              defaultViewport={{ x: 40, y: 80, zoom: 0.72 }}
              style={
                {
                  '--xy-controls-button-background-color': '#FFFFFF',
                  '--xy-controls-button-background-color-hover': '#F8F9FA',
                  '--xy-controls-button-color': '#64748B',
                  '--xy-controls-button-color-hover': '#141416',
                  '--xy-controls-button-border-color': '#E2E8F0',
                  '--xy-controls-box-shadow': '0 1px 2px rgba(15, 23, 42, 0.05)',
                  '--xy-selection-background-color': 'rgba(255, 214, 0, 0.08)',
                  '--xy-selection-border': '1px dashed #FFD600',
                  '--xy-connectionline-stroke': '#10B981',
                  '--xy-connectionline-stroke-width': 2,
                } as React.CSSProperties
              }
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1.1} color="#D5DBE3" bgColor="#F8F9FA" />
              <Controls
                position="bottom-left"
                showInteractive={false}
                className="rounded-xl overflow-hidden border border-[#E2E8F0]"
                fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
              />
              {showMinimap && (
                <MiniMap
                  position="bottom-right"
                  pannable
                  zoomable
                  nodeColor={(n) => kindColor(n.type as WorkflowNodeKind)}
                  nodeBorderRadius={6}
                  bgColor="#FFFFFF"
                  maskColor="rgba(241, 245, 249, 0.75)"
                  className="rounded-xl overflow-hidden border border-[#E2E8F0] shadow-2xs"
                  style={{ width: 160, height: 104 }}
                />
              )}
              {!nodes.length && (
                <Panel position="top-center">
                  <div className="mt-24 px-4 py-3 bg-white border border-dashed border-[#CBD5E1] rounded-xl text-xs text-[#64748B] text-center">
                    <div className="font-bold text-[#141416]">Empty canvas</div>
                    Drag a component from the left panel to start building.
                  </div>
                </Panel>
              )}
            </ReactFlow>
          </EdgeActionsContext.Provider>
        </CanvasViewContext.Provider>
      </div>
    </>
  );
}
