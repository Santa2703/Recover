'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react';
import type {
  NodeRunStatus,
  WorkflowGraph,
  WorkflowNodeData,
  WorkflowNodeKind,
} from '@/services/workflowService';
import { KIND_META } from './nodeRegistry';

export type WfNode = Node<WorkflowNodeData, WorkflowNodeKind>;
export type WfEdge = Edge;

interface Snapshot {
  nodes: WfNode[];
  edges: WfEdge[];
}

interface HistoryState {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
}

interface CommitOptions {
  /** false: change is not undoable (selection, measurement, run status). */
  history?: boolean;
  /** Consecutive commits with the same key merge into one undo step. */
  key?: string;
  /** Merge window in ms for `key` (default: unlimited). */
  window?: number;
  markDirty?: boolean;
}

const HISTORY_LIMIT = 60;
const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const toFlow = (graph: WorkflowGraph): Snapshot => ({
  nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, position: { ...n.position }, data: { ...n.data } })),
  edges: graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    label: e.label,
    type: 'workflow',
  })),
});

export const toModel = (s: Snapshot): WorkflowGraph => ({
  nodes: s.nodes.map((n) => ({
    id: n.id,
    type: n.type as WorkflowNodeKind,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    data: n.data,
  })),
  edges: s.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    ...(typeof e.label === 'string' && e.label ? { label: e.label } : {}),
  })),
});

/**
 * Canvas editing state with an undo/redo history stack. The present snapshot is React Flow nodes/edges;
 * `toModel()` converts back to the rendering-independent workflow JSON.
 */
export function useWorkflowEditor() {
  const [h, setH] = useState<HistoryState>({ past: [], present: { nodes: [], edges: [] }, future: [] });
  const [dirty, setDirty] = useState(false);
  const presentRef = useRef(h.present);
  useLayoutEffect(() => {
    presentRef.current = h.present;
  });

  const lastKey = useRef<{ key: string; t: number } | null>(null);
  const tick = useRef(0);
  const tickScheduled = useRef(false);
  const dragSession = useRef(0);

  /** Key that is identical for all calls in the same task (e.g. node + edge removal from one Delete press). */
  const sameTickKey = (name: string) => {
    if (!tickScheduled.current) {
      tickScheduled.current = true;
      setTimeout(() => {
        tickScheduled.current = false;
        tick.current += 1;
      }, 0);
    }
    return `${name}#${tick.current}`;
  };

  const commit = useCallback((fn: (s: Snapshot) => Snapshot, opts: CommitOptions = {}) => {
    const { history = true, key, window = Infinity, markDirty = true } = opts;
    let push = history;
    if (history) {
      const now = Date.now();
      if (key && lastKey.current && lastKey.current.key === key && now - lastKey.current.t < window) push = false;
      lastKey.current = key ? { key, t: now } : null;
    }
    setH((prev) => {
      const next = fn(prev.present);
      if (next === prev.present) return prev;
      if (push) return { past: [...prev.past, prev.present].slice(-HISTORY_LIMIT), present: next, future: [] };
      return { past: prev.past, present: next, future: history ? [] : prev.future };
    });
    if (markDirty && history) setDirty(true);
  }, []);

  const load = useCallback((graph: WorkflowGraph) => {
    lastKey.current = null;
    setH({ past: [], present: toFlow(graph), future: [] });
    setDirty(false);
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<WfNode>[]) => {
      const structural = changes.some((c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace');
      const drag = changes.find((c) => c.type === 'position');
      if (structural) {
        commit((s) => ({ ...s, nodes: applyNodeChanges(changes, s.nodes) }), { key: sameTickKey('remove') });
      } else if (drag && drag.type === 'position') {
        commit((s) => ({ ...s, nodes: applyNodeChanges(changes, s.nodes) }), { key: `drag#${dragSession.current}` });
        if (!drag.dragging) dragSession.current += 1;
      } else {
        commit((s) => ({ ...s, nodes: applyNodeChanges(changes, s.nodes) }), { history: false });
      }
    },
    [commit],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<WfEdge>[]) => {
      const structural = changes.some((c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace');
      commit(
        (s) => ({ ...s, edges: applyEdgeChanges(changes, s.edges) }),
        structural ? { key: sameTickKey('remove') } : { history: false },
      );
    },
    [commit],
  );

  const connect = useCallback(
    (c: Connection) => {
      const branch = c.sourceHandle === 'true' || c.sourceHandle === 'false' ? c.sourceHandle : undefined;
      commit((s) => ({
        ...s,
        edges: [
          ...s.edges,
          {
            id: uid('e'),
            source: c.source,
            target: c.target,
            sourceHandle: c.sourceHandle ?? null,
            targetHandle: c.targetHandle ?? null,
            label: branch,
            type: 'workflow',
          },
        ],
      }));
    },
    [commit],
  );

  const undo = useCallback(() => {
    lastKey.current = null;
    setH((prev) =>
      prev.past.length
        ? { past: prev.past.slice(0, -1), present: prev.past[prev.past.length - 1], future: [prev.present, ...prev.future] }
        : prev,
    );
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    lastKey.current = null;
    setH((prev) =>
      prev.future.length ? { past: [...prev.past, prev.present], present: prev.future[0], future: prev.future.slice(1) } : prev,
    );
    setDirty(true);
  }, []);

  const addNode = useCallback(
    (kind: WorkflowNodeKind, position: { x: number; y: number }, data?: Partial<WorkflowNodeData>) => {
      const meta = KIND_META[kind];
      const id = uid('n');
      const node: WfNode = {
        id,
        type: kind,
        position,
        selected: true,
        data: {
          ...meta.defaults,
          config: meta.defaults.config.map((c) => ({ ...c })),
          inputs: [...meta.defaults.inputs],
          outputs: [...meta.defaults.outputs],
          status: 'Idle',
          ...data,
        },
      };
      commit((s) => ({
        nodes: [...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node],
        edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
      }));
      return id;
    },
    [commit],
  );

  const updateNodeData = useCallback(
    (id: string, patch: Partial<WorkflowNodeData>, key?: string) => {
      commit(
        (s) => ({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) }),
        key ? { key: `${id}:${key}`, window: 1000 } : {},
      );
    },
    [commit],
  );

  const deleteNodes = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      commit((s) => ({
        nodes: s.nodes.filter((n) => !set.has(n.id)),
        edges: s.edges.filter((e) => !set.has(e.source) && !set.has(e.target)),
      }));
    },
    [commit],
  );

  const deleteEdges = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      commit((s) => ({ ...s, edges: s.edges.filter((e) => !set.has(e.id)) }));
    },
    [commit],
  );

  /** Duplicates the given nodes (default: selection) and the edges between them. Returns the new ids. */
  const duplicate = useCallback(
    (ids?: string[]) => {
      const src = presentRef.current;
      const set = new Set(ids ?? src.nodes.filter((n) => n.selected).map((n) => n.id));
      if (!set.size) return [];
      const idMap = new Map<string, string>();
      set.forEach((id) => idMap.set(id, uid('n')));
      const copies: WfNode[] = src.nodes
        .filter((n) => set.has(n.id))
        .map((n) => ({
          id: idMap.get(n.id)!,
          type: n.type,
          position: { x: n.position.x + 40, y: n.position.y + 40 },
          selected: true,
          data: {
            ...n.data,
            label: `${n.data.label} copy`,
            status: 'Idle' as const,
            records: undefined,
            config: n.data.config.map((c) => ({ ...c })),
            inputs: [...n.data.inputs],
            outputs: [...n.data.outputs],
          },
        }));
      const edgeCopies: WfEdge[] = src.edges
        .filter((e) => set.has(e.source) && set.has(e.target))
        .map((e) => ({ ...e, id: uid('e'), source: idMap.get(e.source)!, target: idMap.get(e.target)!, selected: false }));
      commit((s) => ({
        nodes: [...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...copies],
        edges: [...s.edges, ...edgeCopies],
      }));
      return copies.map((c) => c.id);
    },
    [commit],
  );

  const selectOnly = useCallback(
    (id: string | null) => {
      commit(
        (s) => ({
          nodes: s.nodes.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })),
          edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
        }),
        { history: false },
      );
    },
    [commit],
  );

  const setPositions = useCallback(
    (positions: Record<string, { x: number; y: number }>) => {
      commit((s) => ({ ...s, nodes: s.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)) }));
    },
    [commit],
  );

  /** Run progress: not undoable and does not make the draft dirty. */
  const setNodeStatus = useCallback(
    (id: string, status: NodeRunStatus, records?: number) => {
      commit(
        (s) => ({
          ...s,
          nodes: s.nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, status, ...(records !== undefined ? { records } : {}) } } : n,
          ),
        }),
        { history: false, markDirty: false },
      );
    },
    [commit],
  );

  const markSaved = useCallback(() => setDirty(false), []);
  const getModel = useCallback(() => toModel(presentRef.current), []);

  return useMemo(
    () => ({
      nodes: h.present.nodes,
      edges: h.present.edges,
      dirty,
      canUndo: h.past.length > 0,
      canRedo: h.future.length > 0,
      load,
      onNodesChange,
      onEdgesChange,
      connect,
      undo,
      redo,
      addNode,
      updateNodeData,
      deleteNodes,
      deleteEdges,
      duplicate,
      selectOnly,
      setPositions,
      setNodeStatus,
      markSaved,
      getModel,
    }),
    [h, dirty, load, onNodesChange, onEdgesChange, connect, undo, redo, addNode, updateNodeData, deleteNodes, deleteEdges, duplicate, selectOnly, setPositions, setNodeStatus, markSaved, getModel],
  );
}

export type WorkflowEditor = ReturnType<typeof useWorkflowEditor>;
