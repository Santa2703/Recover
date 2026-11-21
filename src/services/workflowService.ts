/**
 * Workflow Studio service.
 *
 * Workflows are held as a rendering-independent JSON model:
 *   { id, name, status, ..., nodes: [{ id, type, position, data }], edges: [{ id, source, target, sourceHandle?, label? }] }
 * The canvas (React Flow) maps this model to its own node/edge objects; nothing here depends on the UI.
 */
import seed from '@/data/workflows.json';
import { createCollection, delay, queryList } from './mock/mockUtils';

// ---------------------------------------------------------------- model types

export type WorkflowNodeKind =
  | 'trigger'
  | 'dataSource'
  | 'mcpTool'
  | 'agent'
  | 'condition'
  | 'validation'
  | 'approval'
  | 'action'
  | 'notification'
  | 'end';

export type NodeRunStatus = 'Idle' | 'Running' | 'Success' | 'Warning' | 'Failed' | 'Skipped';

export interface KeyValue {
  key: string;
  value: string;
}

/** `type` (not interface) so it satisfies React Flow's Record<string, unknown> node-data constraint. */
export type WorkflowNodeData = {
  label: string;
  subtitle?: string;
  description?: string;
  status: NodeRunStatus;
  records?: number;
  /** Optional lucide icon override (name from the node icon registry). */
  icon?: string;
  /** Source-system badge for data source nodes (letters + brand colour), as in the source palette. */
  brand?: { text: string; color: string };
  config: KeyValue[];
  inputs: string[];
  outputs: string[];
  /** Execution condition, e.g. `records.count > 0`. Empty = always run. */
  condition?: string;
};

export interface WorkflowNodeModel {
  id: string;
  type: WorkflowNodeKind;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdgeModel {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}

export type WorkflowStatus = 'Published' | 'Draft' | 'Failing';
export type WorkflowType = 'Ingest' | 'Outbound' | 'Transformation';

export interface WorkflowRun {
  id: string;
  trigger: string;
  startedAt: string;
  durationMs: number;
  status: 'Success' | 'Failed';
  records: number;
  nodeResults?: { nodeId: string; label: string; status: NodeRunStatus; records?: number }[];
}

export interface Workflow {
  id: string;
  code: string;
  version: string;
  name: string;
  type: WorkflowType;
  sourceSystemType: string;
  sourceSystemName: string;
  sourceIconColor: string;
  trigger: string;
  status: WorkflowStatus;
  active: boolean;
  lastRunStatus: 'Success' | 'Failed' | 'Never';
  lastRunTime: string;
  lastRunAt: string | null;
  nextRun: string;
  successRate: number;
  avgDurationSec: number;
  owner: string;
  description: string;
  tags: string[];
  hasUnpublishedChanges: boolean;
  updatedAt: string;
  nodes: WorkflowNodeModel[];
  edges: WorkflowEdgeModel[];
  runs: WorkflowRun[];
}

export interface WorkflowGraph {
  nodes: WorkflowNodeModel[];
  edges: WorkflowEdgeModel[];
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
  nodeId?: string;
}

// ---------------------------------------------------------------- store

const normalizeNode = (n: WorkflowNodeModel): WorkflowNodeModel => ({
  ...n,
  data: {
    ...n.data,
    status: n.data.status ?? 'Idle',
    config: n.data.config ?? [],
    inputs: n.data.inputs ?? [],
    outputs: n.data.outputs ?? [],
  },
});

const store = createCollection<Workflow>(
  (seed as unknown as Workflow[]).map((w) => ({ ...w, nodes: w.nodes.map(normalizeNode) })),
);

const nowIso = () => {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const nextCode = () => {
  const max = store.all().reduce((m, w) => Math.max(m, Number(w.code.replace(/\D/g, '')) || 0), 100);
  return `WF-${max + 1}`;
};

const bumpVersion = (v: string) => {
  const m = /^v(\d+)\.(\d+)$/.exec(v);
  return m ? `v${m[1]}.${Number(m[2]) + 1}` : 'v1.0';
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------- rules (pure)

export const NODE_KIND_LABEL: Record<WorkflowNodeKind, string> = {
  trigger: 'Trigger',
  dataSource: 'Data source',
  mcpTool: 'MCP tool',
  agent: 'Agent',
  condition: 'Condition',
  validation: 'Validation',
  approval: 'Approval',
  action: 'Action',
  notification: 'Notification',
  end: 'End',
};

export const hasInput = (kind: WorkflowNodeKind) => kind !== 'trigger';
export const hasOutput = (kind: WorkflowNodeKind) => kind !== 'end';

export interface ConnectionAttempt {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Returns a human-readable reason when the connection is not allowed, otherwise null. */
export function checkConnection(
  c: ConnectionAttempt,
  nodes: Pick<WorkflowNodeModel, 'id' | 'type'>[],
  edges: Pick<WorkflowEdgeModel, 'source' | 'target' | 'sourceHandle'>[],
): string | null {
  if (!c.source || !c.target) return 'Connect an output to an input.';
  if (c.source === c.target) return 'A node cannot connect to itself.';
  const src = nodes.find((n) => n.id === c.source);
  const tgt = nodes.find((n) => n.id === c.target);
  if (!src || !tgt) return 'Both ends must be nodes on the canvas.';
  if (!hasOutput(src.type)) return 'End nodes have no outputs.';
  if (!hasInput(tgt.type)) return 'Trigger nodes have no inputs.';
  if (src.type === 'condition' && c.sourceHandle !== 'true' && c.sourceHandle !== 'false') {
    return 'Condition outputs must use the true or false branch.';
  }
  const sameHandle = (a?: string | null, b?: string | null) => (a ?? null) === (b ?? null);
  if (edges.some((e) => e.source === c.source && e.target === c.target && sameHandle(e.sourceHandle, c.sourceHandle))) {
    return 'These nodes are already connected.';
  }
  if (src.type === 'condition' && edges.some((e) => e.source === c.source && e.sourceHandle === c.sourceHandle)) {
    return `The ${c.sourceHandle} branch is already connected. Remove that edge first.`;
  }
  return null;
}

/** Graph-level checks used by Validate and Publish. */
export function validateGraph(graph: WorkflowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { nodes, edges } = graph;
  if (!nodes.length) return [{ level: 'error', message: 'The workflow has no nodes.' }];

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, WorkflowEdgeModel[]>();
  for (const e of edges) {
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
  }

  const roots = nodes.filter((n) => !incoming.get(n.id));
  if (!roots.some((n) => n.type === 'trigger' || n.type === 'dataSource')) {
    issues.push({ level: 'error', message: 'Add a Trigger or Data source node to start the workflow.' });
  }
  for (const n of nodes) {
    const label = n.data.label || NODE_KIND_LABEL[n.type];
    if (!n.data.label.trim()) issues.push({ level: 'error', message: `A ${NODE_KIND_LABEL[n.type]} node has no name.`, nodeId: n.id });
    if (hasInput(n.type) && !incoming.get(n.id) && n.type !== 'dataSource') {
      issues.push({ level: 'error', message: `"${label}" has no incoming connection.`, nodeId: n.id });
    }
    const outs = outgoing.get(n.id) ?? [];
    if (n.type === 'condition') {
      for (const branch of ['true', 'false']) {
        if (!outs.some((e) => e.sourceHandle === branch)) {
          issues.push({ level: 'warning', message: `"${label}" has no ${branch} branch.`, nodeId: n.id });
        }
      }
      if (!n.data.condition?.trim()) issues.push({ level: 'warning', message: `"${label}" has no execution condition.`, nodeId: n.id });
    } else if (hasOutput(n.type) && !outs.length && n.type !== 'notification') {
      issues.push({ level: 'warning', message: `"${label}" output is not connected.`, nodeId: n.id });
    }
    const keys = n.data.config.map((c) => c.key.trim()).filter(Boolean);
    if (new Set(keys).size !== keys.length) issues.push({ level: 'error', message: `"${label}" has duplicate parameter keys.`, nodeId: n.id });
  }
  if (!nodes.some((n) => n.type === 'end')) issues.push({ level: 'warning', message: 'No End node: the run finishes at the last node.' });

  // Cycle detection (Kahn).
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  edges.forEach((e) => indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1));
  const queue = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  let seen = 0;
  while (queue.length) {
    const id = queue.shift()!;
    seen += 1;
    for (const e of outgoing.get(id) ?? []) {
      indeg.set(e.target, (indeg.get(e.target) ?? 1) - 1);
      if (indeg.get(e.target) === 0) queue.push(e.target);
    }
  }
  if (seen < nodes.length) issues.push({ level: 'error', message: 'The workflow contains a loop. Remove an edge to break it.' });
  return issues;
}

// ---------------------------------------------------------------- service

export interface WorkflowListQuery {
  search?: string;
  type?: string;
  system?: string;
  status?: string;
  sort?: 'recent' | 'success' | 'alpha';
}

export interface CreateWorkflowInput {
  name: string;
  type: WorkflowType;
  sourceSystemType: string;
  sourceSystemName: string;
  trigger: string;
  owner: string;
  description: string;
}

export type WorkflowDetailsPatch = Partial<
  Pick<Workflow, 'name' | 'description' | 'owner' | 'trigger' | 'tags' | 'type' | 'sourceSystemName' | 'sourceSystemType'>
>;

export const SOURCE_COLORS: Record<string, string> = {
  ERP: '#0284C7',
  WMS: '#1E40AF',
  Lease: '#DC2626',
  Recycler: '#059669',
  CRM: '#0284C7',
  OMS: '#D97706',
  MRO: '#8B5CF6',
  EAM: '#0284C7',
  TMS: '#DC2626',
  File: '#64748B',
};

export const workflowService = {
  subscribe: store.subscribe,

  async list(q: WorkflowListQuery = {}): Promise<Workflow[]> {
    await delay();
    const sortBy =
      q.sort === 'success' ? (w: Workflow) => w.successRate : q.sort === 'alpha' ? (w: Workflow) => w.name.toLowerCase() : (w: Workflow) => w.lastRunAt ?? '';
    return queryList(store.all(), {
      search: q.search,
      searchFields: ['name', 'code', 'owner', 'sourceSystemName', 'sourceSystemType', 'description'],
      filters: { type: q.type },
      predicate: (w) => {
        if (q.system && q.system !== 'all' && w.sourceSystemName !== q.system) return false;
        if (q.status === 'Paused') return !w.active;
        if (q.status && q.status !== 'all' && w.status !== q.status) return false;
        return true;
      },
      sortBy,
      sortDir: q.sort === 'alpha' ? 'asc' : 'desc',
    }).items;
  },

  /** Every workflow, unfiltered (KPIs, filter options). */
  async all(): Promise<Workflow[]> {
    await delay(120);
    return store.all();
  },

  async get(id: string): Promise<Workflow> {
    await delay(150);
    const wf = store.get(id);
    if (!wf) throw new Error(`Workflow ${id} not found`);
    return wf;
  },

  /** Save graph and/or details. Editing a published workflow leaves unpublished changes. */
  async save(id: string, patch: Partial<WorkflowGraph> & WorkflowDetailsPatch): Promise<Workflow> {
    await delay(300);
    const graphChanged = Boolean(patch.nodes || patch.edges);
    return store.update(id, (cur) => ({
      ...clone(patch),
      sourceIconColor: patch.sourceSystemType ? SOURCE_COLORS[patch.sourceSystemType] ?? cur.sourceIconColor : cur.sourceIconColor,
      hasUnpublishedChanges: cur.hasUnpublishedChanges || (graphChanged && cur.status !== 'Draft'),
      updatedAt: nowIso(),
    }));
  },

  async create(input: CreateWorkflowInput): Promise<Workflow> {
    await delay(300);
    const code = nextCode();
    const wf: Workflow = {
      id: code,
      code,
      version: 'v0.1',
      ...input,
      sourceIconColor: SOURCE_COLORS[input.sourceSystemType] ?? '#64748B',
      status: 'Draft',
      active: true,
      lastRunStatus: 'Never',
      lastRunTime: 'Never',
      lastRunAt: null,
      nextRun: input.trigger,
      successRate: 0,
      avgDurationSec: 0,
      tags: [input.type, input.sourceSystemType],
      hasUnpublishedChanges: false,
      updatedAt: nowIso(),
      nodes: [
        { id: 'n1', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Trigger', subtitle: input.trigger, status: 'Idle', config: [], inputs: [], outputs: ['event'] } },
        { id: 'n2', type: 'end', position: { x: 512, y: 0 }, data: { label: 'Complete', subtitle: 'Run finished', status: 'Idle', config: [], inputs: ['result'], outputs: [] } },
      ],
      edges: [{ id: 'e1-2', source: 'n1', target: 'n2' }],
      runs: [],
    };
    return store.insert(wf);
  },

  async duplicate(id: string): Promise<Workflow> {
    await delay(300);
    const src = store.get(id);
    if (!src) throw new Error(`Workflow ${id} not found`);
    const code = nextCode();
    return store.insert({
      ...clone(src),
      id: code,
      code,
      version: 'v0.1',
      name: `${src.name} (copy)`,
      status: 'Draft',
      lastRunStatus: 'Never',
      lastRunTime: 'Never',
      lastRunAt: null,
      successRate: 0,
      hasUnpublishedChanges: false,
      updatedAt: nowIso(),
      nodes: clone(src.nodes).map((n) => ({ ...n, data: { ...n.data, status: 'Idle' as const, records: undefined } })),
      runs: [],
    });
  },

  async remove(id: string): Promise<void> {
    await delay(250);
    store.remove(id);
  },

  async publish(id: string): Promise<Workflow> {
    await delay(400);
    const wf = store.get(id);
    if (!wf) throw new Error(`Workflow ${id} not found`);
    const errors = validateGraph(wf).filter((i) => i.level === 'error');
    if (errors.length) throw new Error(`Cannot publish: ${errors[0].message}`);
    return store.update(id, {
      status: wf.status === 'Failing' && !wf.hasUnpublishedChanges ? 'Failing' : 'Published',
      version: wf.status === 'Draft' && wf.version === 'v0.1' ? 'v1.0' : bumpVersion(wf.version),
      hasUnpublishedChanges: false,
      updatedAt: nowIso(),
    });
  },

  async toggleActive(id: string): Promise<Workflow> {
    await delay(250);
    return store.update(id, (cur) => ({ active: !cur.active }));
  },

  /**
   * Simulated run. Walks the graph from its start nodes in dependency order, reporting each node's status
   * (Running → Success / Failed / Skipped) through `onNodeStatus`. Condition nodes follow one branch
   * (parameter `branch` = true|false, default true). A node with parameter `simulateFailure` = true fails.
   */
  async run(
    id: string,
    opts: { onNodeStatus?: (nodeId: string, status: NodeRunStatus, records?: number) => void; stepMs?: number } = {},
  ): Promise<WorkflowRun> {
    const wf = store.get(id);
    if (!wf) throw new Error(`Workflow ${id} not found`);
    if (!wf.active) throw new Error('This workflow is paused. Resume it to run.');
    const errors = validateGraph(wf).filter((i) => i.level === 'error');
    if (errors.length) throw new Error(`Cannot run: ${errors[0].message}`);

    const started = Date.now();
    const startedAt = nowIso();
    const { nodes, edges } = wf;
    const status = new Map<string, NodeRunStatus>();
    const records = new Map<string, number>();
    const incoming = new Map<string, WorkflowEdgeModel[]>();
    edges.forEach((e) => incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]));
    nodes.forEach((n) => opts.onNodeStatus?.(n.id, 'Idle'));
    await delay(200);

    // Topological order.
    const indeg = new Map(nodes.map((n) => [n.id, incoming.get(n.id)?.length ?? 0]));
    const order: string[] = [];
    const queue = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
    while (queue.length) {
      const nid = queue.shift()!;
      order.push(nid);
      edges.filter((e) => e.source === nid).forEach((e) => {
        indeg.set(e.target, (indeg.get(e.target) ?? 1) - 1);
        if (indeg.get(e.target) === 0) queue.push(e.target);
      });
    }

    const param = (n: WorkflowNodeModel, key: string) => n.data.config.find((c) => c.key === key)?.value?.trim().toLowerCase();
    let failed = false;
    for (const nid of order) {
      const node = nodes.find((n) => n.id === nid)!;
      const ins = incoming.get(nid) ?? [];
      // A node runs when it is a start node or at least one active edge feeds it.
      const activeIn = ins.filter((e) => {
        if (status.get(e.source) !== 'Success') return false;
        const src = nodes.find((n) => n.id === e.source)!;
        if (src.type !== 'condition') return true;
        const branch = param(src, 'branch') === 'false' ? 'false' : 'true';
        return e.sourceHandle === branch;
      });
      if (ins.length && !activeIn.length) {
        status.set(nid, 'Skipped');
        opts.onNodeStatus?.(nid, 'Skipped');
        continue;
      }
      opts.onNodeStatus?.(nid, 'Running');
      await delay(opts.stepMs ?? 550);
      const inRecords = Math.max(0, ...activeIn.map((e) => records.get(e.source) ?? 0));
      let out = inRecords;
      if (node.type === 'dataSource') out = Math.max(1, (node.data.records ?? 200) + Math.round(Math.random() * 20 - 8));
      if (node.type === 'validation') out = Math.max(0, inRecords - Math.round(Math.random() * 2));
      if (activeIn.some((e) => e.label === 'invalid')) out = Math.round(Math.random() * 2);
      const fails = param(node, 'simulateFailure') === 'true';
      const st: NodeRunStatus = fails ? 'Failed' : 'Success';
      if (fails) failed = true;
      status.set(nid, st);
      if (node.type !== 'trigger' && node.type !== 'end' && !fails) records.set(nid, out);
      else records.set(nid, inRecords);
      opts.onNodeStatus?.(nid, st, node.type !== 'trigger' && node.type !== 'end' && !fails ? out : undefined);
    }

    const durationMs = Date.now() - started;
    const total = Math.max(0, ...nodes.filter((n) => n.type !== 'notification').map((n) => records.get(n.id) ?? 0));
    const run: WorkflowRun = {
      id: `RUN-${wf.code.replace('WF-', '')}-${String(wf.runs.length + 1).padStart(4, '0')}-${started.toString(36).slice(-4)}`,
      trigger: 'Manual',
      startedAt,
      durationMs,
      status: failed ? 'Failed' : 'Success',
      records: total,
      nodeResults: nodes.map((n) => ({ nodeId: n.id, label: n.data.label, status: status.get(n.id) ?? 'Skipped', records: records.get(n.id) })),
    };

    store.update(id, (cur) => {
      const runs = [run, ...cur.runs].slice(0, 25);
      const ok = runs.filter((r) => r.status === 'Success').length;
      return {
        nodes: cur.nodes.map((n) => {
          const s = status.get(n.id);
          if (!s) return n;
          const r = s === 'Success' && n.type !== 'trigger' && n.type !== 'end' ? records.get(n.id) : n.data.records;
          return { ...n, data: { ...n.data, status: s, records: s === 'Skipped' ? n.data.records : r } };
        }),
        runs,
        lastRunStatus: run.status,
        lastRunAt: startedAt,
        lastRunTime: 'Just now',
        successRate: Math.round((ok / runs.length) * 100),
        avgDurationSec: Math.max(1, Math.round(runs.reduce((s, r) => s + r.durationMs, 0) / runs.length / 1000)),
        status: cur.status === 'Draft' ? 'Draft' : failed ? 'Failing' : cur.status === 'Failing' ? 'Published' : cur.status,
      };
    });
    return run;
  },
};
