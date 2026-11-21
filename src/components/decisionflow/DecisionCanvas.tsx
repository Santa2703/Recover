'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, Controls, MarkerType, Panel, ReactFlow, useReactFlow } from '@xyflow/react';
import type { Connection, Edge, EdgeChange, IsValidConnection, NodeTypes, OnBeforeDelete } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Dropdown, message } from 'antd';
import { ChevronRight, CircleAlert, CircleCheck, Flag, Focus, Maximize2, Scale, TriangleAlert, Wrench } from 'lucide-react';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import type { RouteId } from '@/models/decision.model';
import {
  addOutcome,
  addRule,
  addStep,
  connect,
  connectionError,
  deleteSelection,
  getState,
  liveChecks,
  missingRoutes,
  nodeStatus,
  onNodesChange,
  proposalEdges,
  selectEdge,
  selectNode,
} from '@/services/decisionFlowService';
import type { CheckItem, FlowNode, FlowState } from '@/services/decisionFlowService';
import { checkRule } from '@/services/decisionService';
import type { BusinessRule } from '@/models/decision.model';
import { BandNode, DecisionNode, NODE_W } from './DecisionNode';
import type { DisplayData } from './DecisionNode';
import { NodeInspector } from './NodeInspector';

const nodeTypes: NodeTypes = { df: DecisionNode, band: BandNode };
const DND_MIME = 'application/x-decision-flow';
const CORE_BAND = ['intake', 'condition', 'demand', 'fit', 'valuation', 'gate'];
const NODE_H = 112;
const EDGE_GREY = '#94A3B8';

type PaletteItem = { kind: 'step' } | { kind: 'rule' } | { kind: 'outcome'; route: RouteId };

const BTN = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-xl text-xs font-semibold text-[#141416] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

function warn(r: { ok: boolean; reason?: string }) {
  if (!r.ok && r.reason) message.warning({ content: r.reason, key: 'df-edit' });
}

/** Focus area on load: the editable part of the flow (gate → rules → decision → approval). */
const FOCUS_IDS = ['gate', 'decision', 'approval'];

export function DecisionCanvas({ flow }: { flow: FlowState }) {
  const rf = useReactFlow<FlowNode, Edge>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editable = flow.stage === 'editing';
  // First view: readable (about 80 %), centred on the guardrail gate, the rule stack and owner approval.
  const [initialFit] = useState(() => ({
    nodes: flow.nodes.filter((n) => ['valuation', 'gate', 'decision', 'approval'].includes(n.id) || n.data.kind === 'rule').map((n) => ({ id: n.id })),
    padding: 0.12,
    maxZoom: 0.8,
  }));

  // ------------------------------------------------------------ derived display nodes and edges
  const display = useMemo(() => {
    const byId = new Map(flow.nodes.map((n) => [n.id, n]));
    const core = CORE_BAND.map((id) => byId.get(id)).filter((n): n is FlowNode => !!n);
    const nodes: FlowNode[] = flow.nodes.map((n) => {
      const status = nodeStatus(n, flow);
      const r = n.data.rule;
      const hit = status === 'Blocked' && r?.route ? checkRule({ ...r, route: r.route } as BusinessRule) : null;
      const data: DisplayData = { ...n.data, status, blockedBy: hit ? `${hit.guardrailId} · owner ${hit.owner}` : undefined };
      return { ...n, data, deletable: !n.data.proposed };
    });
    if (core.length) {
      const xs = core.map((n) => n.position.x);
      const ys = core.map((n) => n.position.y);
      const x = Math.min(...xs) - 28;
      const y = Math.min(...ys) - 44;
      const width = Math.max(...xs) + NODE_W + 28 - x;
      const height = Math.max(...ys) + NODE_H + 24 - y;
      nodes.unshift({
        id: 'band',
        type: 'band',
        position: { x, y },
        width,
        height,
        draggable: false,
        selectable: false,
        focusable: false,
        deletable: false,
        zIndex: -1,
        data: { kind: 'band', title: '', subtitle: '', owner: '', locked: true },
      });
    }
    // Smooth curves in one quiet grey with arrowheads (route colour lives on the outcome cards, not the lines).
    const edges: Edge[] = [...flow.edges, ...proposalEdges(flow)].map((e) => {
      const proposed = !!e.data?.proposed;
      const color = e.selected ? '#141416' : proposed ? '#0284C7' : EDGE_GREY;
      // Lines that run back to a card on the left (gate → rule stack, execute → learning) take a
      // rounded right-angle route instead of a curve that loops across the cards.
      const src = byId.get(e.source);
      const tgt = byId.get(e.target);
      const backward = !!src && !!tgt && tgt.position.x < src.position.x + NODE_W - 24;
      return {
        ...e,
        type: backward ? 'smoothstep' : 'default',
        pathOptions: backward ? { borderRadius: 12, offset: 24 } : undefined,
        selectable: !proposed,
        deletable: !proposed,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        style: { stroke: color, strokeWidth: e.selected ? 2.25 : 1.5, strokeDasharray: proposed ? '6 4' : undefined },
      };
    });
    return { nodes, edges };
  }, [flow]);

  const checks = useMemo(() => liveChecks(flow), [flow]);
  const selected = flow.nodes.find((n) => n.selected);
  const missing = missingRoutes(flow);

  // ------------------------------------------------------------ view helpers
  const focusRules = useCallback(() => {
    const ids = flow.nodes.filter((n) => FOCUS_IDS.includes(n.id) || n.data.kind === 'rule').map((n) => ({ id: n.id }));
    void rf.fitView({ nodes: ids, padding: 0.12, maxZoom: 0.9, duration: 250 });
  }, [flow.nodes, rf]);

  const focusNode = useCallback(
    (id?: string) => {
      if (!id) return;
      selectNode(id);
      void rf.fitView({ nodes: [{ id }], padding: 1.2, maxZoom: 1, duration: 300 });
    },
    [rf],
  );

  const centre = () => {
    const r = wrapperRef.current?.getBoundingClientRect();
    if (!r) return { x: 1700, y: 0 };
    const p = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 3 });
    return { x: p.x - NODE_W / 2 + (Math.random() - 0.5) * 60, y: p.y - NODE_H / 2 };
  };

  // ------------------------------------------------------------ adding
  const add = (item: PaletteItem, at?: { x: number; y: number }) => {
    if (item.kind === 'rule') {
      const r = addRule(at);
      warn(r);
      if (r.ok) message.success({ content: at ? 'Rule added. Connect it between the guardrail gate and the decision.' : 'Rule added before the decision. Choose its route in the inspector.', key: 'df-edit' });
    } else if (item.kind === 'step') {
      const r = addStep(at ?? centre());
      warn(r);
      if (r.ok) message.success({ content: 'Process step added. Drag from its handles to connect it.', key: 'df-edit' });
    } else {
      const r = addOutcome(item.route, at);
      warn(r);
      if (r.ok) message.success({ content: `${DISPOSITION_ROUTES[item.route].name} added`, key: 'df-edit' });
    }
  };

  const onDragStart = (e: React.DragEvent, item: PaletteItem) => {
    e.dataTransfer.setData(DND_MIME, JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    add(JSON.parse(raw) as PaletteItem, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  };

  // ------------------------------------------------------------ editing handlers
  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    for (const c of changes) if (c.type === 'select') selectEdge(c.id, c.selected);
  }, []);

  const onConnect = useCallback((c: Connection) => warn(connect(c)), []);
  const isValidConnection: IsValidConnection = useCallback((c) => !connectionError({ source: c.source, target: c.target }, getState()), []);

  const onBeforeDelete: OnBeforeDelete<FlowNode, Edge> = useCallback(async ({ nodes, edges }) => {
    const selEdges = edges.filter((e) => getState().edges.find((x) => x.id === e.id)?.selected).map((e) => e.id);
    const r = deleteSelection(
      nodes.map((n) => n.id),
      selEdges,
    );
    if (!r.ok) message.warning({ content: r.reason, key: 'df-edit' });
    else message.success({ content: r.reason ?? `Removed ${r.removed} item${r.removed > 1 ? 's' : ''}; neighbours reconnected where needed.`, key: 'df-edit' });
    return false;
  }, []);

  const errors = checks.filter((c) => c.level === 'error').length;
  const warns = checks.filter((c) => c.level === 'warn').length;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-2xs overflow-hidden min-w-0">
      {/* Palette + view controls */}
      <div className="p-3 border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mr-1">Add</span>
          <button className={BTN} disabled={!editable} draggable={editable} onDragStart={(e) => onDragStart(e, { kind: 'step' })} onClick={() => add({ kind: 'step' })} title="Click or drag onto the canvas">
            <Wrench size={13} className="text-[#059669]" /> Process step
          </button>
          <button className={BTN} disabled={!editable} draggable={editable} onDragStart={(e) => onDragStart(e, { kind: 'rule' })} onClick={() => add({ kind: 'rule' })} title="Click to add before the decision, or drag onto the canvas">
            <Scale size={13} className="text-[#8A6D00]" /> Business rule
          </button>
          <Dropdown
            disabled={!editable || !missing.length}
            trigger={['click']}
            menu={{ items: missing.map((r) => ({ key: r, label: DISPOSITION_ROUTES[r].name })), onClick: ({ key }) => add({ kind: 'outcome', route: key as RouteId }) }}
          >
            <button className={BTN} disabled={!editable || !missing.length} title={missing.length ? 'Add a route outcome back to the flow' : 'All 7 routes are on the canvas'}>
              <Flag size={13} className="text-[#64748B]" /> Outcome
            </button>
          </Dropdown>
        </div>
        <div className="flex items-center gap-1.5">
          <button className={BTN} onClick={focusRules} title="Zoom to the guardrail gate, rules and decision">
            <Focus size={13} /> Rules
          </button>
          <button className={BTN} onClick={() => void rf.fitView({ padding: 0.08, duration: 250 })} title="Show the whole flow">
            <Maximize2 size={13} /> Whole flow
          </button>
        </div>
      </div>

      <div ref={wrapperRef} className="relative h-[580px]" onDragOver={onDragOver} onDrop={onDrop}>
        <ReactFlow<FlowNode, Edge>
          nodes={display.nodes}
          edges={display.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onBeforeDelete={onBeforeDelete}
          nodesConnectable={editable}
          deleteKeyCode={['Backspace', 'Delete']}
          minZoom={0.15}
          maxZoom={1.5}
          fitView
          fitViewOptions={initialFit}
          style={{ '--xy-selection-background-color': 'rgba(255, 214, 0, 0.08)', '--xy-selection-border': '1px dashed #FFD600', '--xy-connectionline-stroke': '#059669' } as React.CSSProperties}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1.1} color="#D5DBE3" bgColor="#F8F9FA" />
          <Controls position="bottom-left" showInteractive={false} />
          {selected && (
            <Panel position="top-right">
              <NodeInspector node={selected} status={nodeStatus(selected, flow)} editable={editable} />
            </Panel>
          )}
        </ReactFlow>
      </div>

      {/* Live checks: one line when everything passes, expandable; open by default when something needs attention */}
      <details key={errors || warns ? 'attention' : 'clean'} open={!!(errors || warns)} className="group border-t border-[#E2E8F0] px-4 py-3">
        <summary className="flex flex-wrap items-center justify-between gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2 text-xs">
            <ChevronRight size={14} className="text-[#64748B] transition-transform group-open:rotate-90" aria-hidden />
            {errors || warns ? (
              <span className="font-extrabold text-[#141416]">
                Live checks: {checks.length - errors - warns}/{checks.length} pass
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-extrabold text-[#141416]">
                <CircleCheck size={14} className="text-[#059669]" aria-hidden />
                {checks.length}/{checks.length} checks pass
              </span>
            )}
          </span>
          <span className="text-[11px] text-[#64748B]">
            {errors ? `${errors} failing` : ''}
            {errors && warns ? ' · ' : ''}
            {warns ? `${warns} warning${warns > 1 ? 's' : ''}` : ''}
            {errors || warns ? ' · click a check to select its node' : 'Show checks'}
          </span>
        </summary>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 mt-2">
          {checks.map((c) => (
            <CheckRow key={c.id} c={c} onClick={() => focusNode(c.nodeId)} />
          ))}
        </ul>
      </details>
    </div>
  );
}

const CHECK_ICON = {
  ok: { icon: CircleCheck, color: '#059669', label: 'Passes' },
  warn: { icon: TriangleAlert, color: '#D97706', label: 'Warning' },
  error: { icon: CircleAlert, color: '#DC2626', label: 'Fails' },
};

function CheckRow({ c, onClick }: { c: CheckItem; onClick: () => void }) {
  const m = CHECK_ICON[c.level];
  const Icon = m.icon;
  const body = (
    <>
      <Icon size={14} className="shrink-0 mt-px" style={{ color: m.color }} aria-label={m.label} />
      <span className={`min-w-0 ${c.level === 'ok' ? 'text-[#475569]' : 'text-[#141416] font-semibold'}`}>{c.text}</span>
    </>
  );
  return (
    <li className="min-w-0">
      {c.nodeId ? (
        <button onClick={onClick} className="w-full flex items-start gap-2 text-left text-xs py-1 px-1.5 -mx-1.5 rounded-lg hover:bg-[#F8FAFC] cursor-pointer">
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-2 text-xs py-1">{body}</div>
      )}
    </li>
  );
}
