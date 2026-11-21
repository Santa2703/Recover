/**
 * Decision flow (Workflow Studio, "Decision flow" mode): the editable draft of the decision
 * process, its governance state (maker-checker, shadow run, publish, roll back), the
 * AI assistant's proposals and the audit log. See docs/recover-reference.md section 3.
 *
 * The published rules themselves live in decisionService (getPublishedRules / publishRules /
 * rollbackRules). This store keeps everything the Studio needs around them and survives
 * navigation (module state). Components read it with `useDecisionFlow()` and change it only
 * through the functions exported here.
 */
import { useSyncExternalStore } from 'react';
import { applyNodeChanges } from '@xyflow/react';
import type { Connection, Edge, Node, NodeChange } from '@xyflow/react';
import type { BusinessRule, Grade, Guardrail, IntakeChannel, ProductClass, RouteId, RuleAction, RuleScope } from '@/models/decision.model';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import {
  CHANNEL_LABEL,
  ROUTE_IDS,
  checkRule,
  getGuardrails,
  getPolicy,
  getPublishedRules,
  openDecisions,
  planQueue,
  publishRules,
  rollbackRules,
  usd,
} from './decisionService';
import { delay } from './mock/mockUtils';
import flowJson from '@/data/decision/flow.json';

/* ================================================================ types */

export type FlowKind = 'trigger' | 'agent' | 'gate' | 'rule' | 'decision' | 'approval' | 'outcome' | 'step' | 'learning' | 'band';

/** A rule while it is being drafted: the route may still be missing. */
export type DraftRule = Omit<BusinessRule, 'route'> & { route?: RouteId };

export type FlowNodeData = {
  kind: FlowKind;
  title: string;
  subtitle: string;
  owner: string;
  /** Core steps and gates: can move, cannot be edited or deleted. */
  locked: boolean;
  /** Outcome nodes: the route they stand for. */
  route?: RouteId;
  /** Rule nodes. */
  rule?: DraftRule;
  /** Added in the current draft (not yet published). */
  isNew?: boolean;
  /** Dashed preview of an assistant proposal (not part of the draft). */
  proposed?: boolean;
  [key: string]: unknown;
};

export type FlowNode = Node<FlowNodeData, 'df' | 'band'>;

export type NodeStatus = 'Live' | 'Draft' | 'Locked' | 'Fixed' | 'Proposed' | 'Blocked' | 'Inactive';

export type FlowStage = 'editing' | 'review' | 'approved' | 'shadow';

export interface Actor {
  id: string;
  name: string;
  role: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface VersionEntry {
  version: number;
  publishedAt: string;
  publishedBy: string;
  note: string;
  rules: number;
}

export interface CheckItem {
  id: string;
  level: 'ok' | 'warn' | 'error';
  text: string;
  nodeId?: string;
}

export interface ImpactRow {
  caseId: string;
  label: string;
  from: RouteId;
  to: RouteId;
  netPublished: number;
  netDraft: number;
  netDelta: number;
}

export interface Impact {
  changes: ImpactRow[];
  /** Draft plan value − published plan value over all open cases. */
  netDelta: number;
  openCases: number;
}

export interface ShadowRun {
  at: string;
  by: string;
  changes: number;
  netDelta: number;
}

export type ParseResult =
  | { kind: 'rule'; rule: DraftRule & { route: RouteId }; readBack: string }
  | { kind: 'step'; title: string; where: 'before' | 'after'; route: RouteId; readBack: string }
  | { kind: 'refused'; guardrail: Guardrail; reason: string; readBack: string }
  | { kind: 'unknown'; readBack: string };

export interface ProposalCheck {
  ok: boolean;
  label: string;
  detail: string;
}

export interface Proposal {
  id: string;
  nodeId: string;
  kind: 'rule' | 'step';
  summary: string;
  checks: ProposalCheck[];
  impact: { changes: number; netDelta: number; note: string };
  status: 'open' | 'approved' | 'dismissed';
  /** Step proposals: where the step goes. */
  where?: 'before' | 'after';
  route?: RouteId;
}

export interface ChatMessage {
  id: string;
  from: 'user' | 'assistant';
  text: string;
  proposalId?: string;
  /** Refusals: the guardrail that blocked the request. */
  guardrailId?: string;
}

export interface FlowState {
  nodes: FlowNode[];
  edges: Edge[];
  stage: FlowStage;
  /** People who changed the current draft (they cannot approve it). */
  makers: string[];
  dirty: boolean;
  actorId: string;
  approvedBy: string | null;
  shadow: ShadowRun | null;
  proposals: Proposal[];
  chat: ChatMessage[];
  audit: AuditEntry[];
  versions: VersionEntry[];
  /** Publishes in this session that can still be rolled back. */
  rollbackDepth: number;
}

/* ================================================================ labels */

export const ACTION_LABEL: Record<RuleAction, string> = { exclude: 'Never', prefer: 'Prefer', require: 'Only' };

export const PRODUCT_CLASS_LABEL: Record<ProductClass, string> = {
  motor: 'Electric motors',
  pump: 'Hydraulic pumps',
  control: 'Control & PLC',
  drill: 'Power tools',
  it: 'Field electronics',
  batch: 'Tool-fleet batches',
};
export const PRODUCT_CLASSES = Object.keys(PRODUCT_CLASS_LABEL) as ProductClass[];
export const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'Scrap'];
export const CHANNELS: IntakeChannel[] = ['lease_end', 'field_return', 'trade_in', 'excess'];
export const SITES = ['Warehouse 1', 'Warehouse 2', 'Repair centre'];
export { CHANNEL_LABEL, ROUTE_IDS };

const CHANNEL_PLURAL: Record<IntakeChannel, string> = {
  lease_end: 'Lease-end returns',
  field_return: 'Field service returns',
  trade_in: 'Customer trade-ins',
  excess: 'Excess or idle stock',
};

const routeName = (r: RouteId) => DISPOSITION_ROUTES[r].name;
/** "+$1,200" / "−$450" / "$0". */
export const usdSigned = (n: number) => (Math.round(n) === 0 ? '$0' : `${n > 0 ? '+' : '−'}${usd(Math.abs(n))}`);
const orList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

/** Plain-language read-back: "Field service returns, grade C: never Secondary Re-lease". */
export function readBackRule(rule: Pick<DraftRule, 'action' | 'route' | 'scope'>): string {
  const s = rule.scope;
  const parts: string[] = [];
  if (s.channel?.length) parts.push(orList(s.channel.map((c) => CHANNEL_PLURAL[c])));
  if (s.productClass?.length) parts.push(orList(s.productClass.map((c) => PRODUCT_CLASS_LABEL[c])));
  if (s.condition?.length) {
    const grades = s.condition.filter((g) => g !== 'Scrap');
    const g = [grades.length ? `grade ${orList(grades)}` : '', s.condition.includes('Scrap') ? 'scrap' : ''].filter(Boolean);
    parts.push(g.join(' or '));
  }
  if (s.site?.length) parts.push(`at ${orList(s.site)}`);
  if (s.lifeMax !== undefined) parts.push(`remaining life under ${s.lifeMax} %`);
  if (s.lifeMin !== undefined) parts.push(`remaining life of at least ${s.lifeMin} %`);
  let scope = parts.join(', ');
  if (!scope) scope = 'All assets';
  scope = scope[0].toUpperCase() + scope.slice(1);
  const verb = rule.action === 'exclude' ? 'never' : rule.action === 'prefer' ? 'prefer' : 'only';
  const route = rule.route ? routeName(rule.route) : '(choose a route)';
  return `${scope}: ${verb} ${route}${rule.action === 'require' ? ' when viable' : ''}`;
}

/* ================================================================ template */

interface TemplateNode {
  id: string;
  kind: FlowKind;
  title: string;
  subtitle: string;
  owner: string;
  x: number;
  y: number;
}

const seed = flowJson as unknown as { template: TemplateNode[]; actors: Actor[]; versions: VersionEntry[]; audit: AuditEntry[] };
export const ACTORS: Actor[] = seed.actors;

/*
 * Layout (Recover-style, two-dimensional): core agents run along the top in the fixed band;
 * business rules stack vertically under the guardrail gate; decision → owner approval sit on
 * the rule row; the 7 outcomes form one column; execute and learning stack to their right.
 */
const OUTCOME_X = 2080;
const RULE_X = 1100;
const RULE_Y0 = 170;
const RULE_STEP = 140;
const outcomeY = (i: number) => 310 + (i - 3) * 128;

function outcomeNode(route: RouteId, pos?: { x: number; y: number }, isNew = false): FlowNode {
  const p = getPolicy().routes[route];
  return {
    id: `out-${route}`,
    type: 'df',
    position: pos ?? { x: OUTCOME_X, y: outcomeY(ROUTE_IDS.indexOf(route)) },
    data: { kind: 'outcome', title: routeName(route), subtitle: `Executes in ${p.executesIn}`, owner: p.owner, locked: false, route, isNew },
  };
}

function ruleNode(rule: DraftRule, pos: { x: number; y: number }, extra: Partial<FlowNodeData> = {}): FlowNode {
  return {
    id: `rule-${rule.id}`,
    type: 'df',
    position: pos,
    data: { kind: 'rule', title: rule.id, subtitle: '', owner: rule.owner, locked: false, rule, ...extra },
  };
}

const edge = (source: string, target: string, extra: Partial<Edge> = {}): Edge => ({ id: `e-${source}-${target}`, source, target, ...extra });

/** Rule nodes for a rule set, chained gate → rules → decision. */
function ruleChain(rules: BusinessRule[]): { nodes: FlowNode[]; edges: Edge[] } {
  const nodes = rules.map((r, i) => ruleNode({ ...r, scope: { ...r.scope } }, { x: RULE_X, y: RULE_Y0 + i * RULE_STEP }));
  const ids = ['gate', ...nodes.map((n) => n.id), 'decision'];
  return { nodes, edges: ids.slice(1).map((t, i) => edge(ids[i], t)) };
}

function buildTemplate(rules: BusinessRule[]): { nodes: FlowNode[]; edges: Edge[] } {
  const core: FlowNode[] = seed.template.map((t) => ({
    id: t.id,
    type: 'df',
    position: { x: t.x, y: t.y },
    data: { kind: t.kind, title: t.title, subtitle: t.subtitle, owner: t.owner, locked: true },
  }));
  const chain = ruleChain(rules);
  const outcomes = ROUTE_IDS.map((r) => outcomeNode(r));
  const coreIds = ['intake', 'condition', 'demand', 'fit', 'valuation', 'gate'];
  const edges: Edge[] = [
    ...coreIds.slice(1).map((t, i) => edge(coreIds[i], t)),
    ...chain.edges,
    edge('decision', 'approval'),
    ...outcomes.map((o) => edge('approval', o.id)),
    ...outcomes.map((o) => edge(o.id, 'execute')),
    edge('execute', 'learning'),
  ];
  return { nodes: [...core, ...chain.nodes, ...outcomes], edges };
}

/* ================================================================ store */

const initial = buildTemplate(getPublishedRules().rules);
let state: FlowState = {
  nodes: initial.nodes,
  edges: initial.edges,
  stage: 'editing',
  makers: [],
  dirty: false,
  actorId: ACTORS[0].id,
  approvedBy: null,
  shadow: null,
  proposals: [],
  chat: [],
  audit: [...seed.audit],
  versions: [...seed.versions],
  rollbackDepth: 0,
};

const listeners = new Set<() => void>();
function set(patch: Partial<FlowState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getState = () => state;

/** Current Studio state (draft graph, governance, chat, audit). */
export function useDecisionFlow(): FlowState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export const actorOf = (s: FlowState = state) => ACTORS.find((a) => a.id === s.actorId) ?? ACTORS[0];

let seq = 100;
const nextId = (p: string) => `${p}-${++seq}`;

function audit(action: string, detail: string, coalesceKey?: string): AuditEntry[] {
  const actor = actorOf().name;
  const at = new Date().toISOString();
  const last = state.audit[0];
  if (coalesceKey && last && last.actor === actor && last.action === action && last.id.endsWith(`:${coalesceKey}`) && Date.now() - Date.parse(last.at) < 120_000) {
    return [{ ...last, at, detail }, ...state.audit.slice(1)];
  }
  const n = state.audit.length + 1;
  return [{ id: `AU-${String(n).padStart(3, '0')}${coalesceKey ? `:${coalesceKey}` : ''}`, at, actor, action, detail }, ...state.audit];
}

export type EditResult = { ok: true } | { ok: false; reason: string };

const LOCKED_REASON: Record<Exclude<FlowStage, 'editing'>, string> = {
  review: 'The draft is awaiting approval. Reject it to make more changes.',
  approved: 'The draft is approved. Reject it to make more changes.',
  shadow: 'The draft is in a shadow run. Reject it to make more changes.',
};

function canEdit(): EditResult {
  return state.stage === 'editing' ? { ok: true } : { ok: false, reason: LOCKED_REASON[state.stage] };
}

/** Applies a draft edit: marks the draft dirty and records the actor as a maker. */
function edit(patch: Partial<FlowState>, action: string, detail: string, coalesceKey?: string) {
  const me = actorOf().name;
  set({
    ...patch,
    dirty: true,
    makers: state.makers.includes(me) ? state.makers : [...state.makers, me],
    audit: audit(action, detail, coalesceKey),
  });
}

/* ================================================================ graph helpers */

const realNodes = (s: FlowState = state) => s.nodes.filter((n) => !n.data.proposed && n.type !== 'band');
const realEdges = (s: FlowState = state) => s.edges.filter((e) => !e.data?.proposed);

function reach(from: string, edges: Edge[], dir: 'fwd' | 'bwd', skip?: string): Set<string> {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of edges) {
      const a = dir === 'fwd' ? e.source : e.target;
      const b = dir === 'fwd' ? e.target : e.source;
      if (a !== id || b === skip || seen.has(b)) continue;
      seen.add(b);
      stack.push(b);
    }
  }
  return seen;
}

function analyse(s: FlowState) {
  const nodes = realNodes(s);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = realEdges(s).filter((e) => ids.has(e.source) && ids.has(e.target));
  const fromGate = reach('gate', edges, 'fwd');
  const toDecision = reach('decision', edges, 'bwd');
  const fromApproval = reach('approval', edges, 'fwd');
  const onRulePath = (id: string) => ids.has('gate') && ids.has('decision') && fromGate.has(id) && toDecision.has(id);
  return { nodes, edges, onRulePath, fromApproval };
}

/** Draft rules as the engine will see them, plus routes no longer reachable in the flow. */
export function draftRules(s: FlowState = state): { rules: BusinessRule[]; blocked: RouteId[]; blockedRules: string[] } {
  const a = analyse(s);
  const rules: BusinessRule[] = [];
  const blockedRules: string[] = [];
  for (const n of a.nodes) {
    const r = n.data.rule;
    if (n.data.kind !== 'rule' || !r || !r.route) continue;
    const rule: BusinessRule = { ...r, route: r.route, active: a.onRulePath(n.id), description: readBackRule(r) };
    if (checkRule(rule)) blockedRules.push(rule.id);
    else rules.push(rule);
  }
  const present = new Set(a.nodes.filter((n) => n.data.kind === 'outcome' && n.data.route && a.fromApproval.has(n.id)).map((n) => n.data.route!));
  return { rules, blocked: ROUTE_IDS.filter((r) => !present.has(r)), blockedRules };
}

const ruleKey = (r: BusinessRule) => JSON.stringify([r.id, r.action, r.route, r.scope, r.active !== false]);

/** Status pill for a node card. */
export function nodeStatus(n: FlowNode, s: FlowState = state): NodeStatus {
  const d = n.data;
  if (d.proposed) return 'Proposed';
  if (d.kind === 'gate' || d.kind === 'approval') return 'Locked';
  if (d.locked) return 'Fixed';
  const a = analyse(s);
  if (d.kind === 'rule') {
    const r = d.rule;
    if (r?.route && checkRule({ ...r, route: r.route } as BusinessRule)) return 'Blocked';
    if (!a.onRulePath(n.id)) return 'Inactive';
    const pub = getPublishedRules().rules.find((p) => p.id === r?.id);
    if (!pub || !r?.route) return 'Draft';
    return ruleKey(pub) === ruleKey({ ...r, route: r.route, active: true } as BusinessRule) ? 'Live' : 'Draft';
  }
  if (d.kind === 'outcome' && !a.fromApproval.has(n.id)) return 'Inactive';
  return d.isNew ? 'Draft' : 'Live';
}

/* ================================================================ live checks */

function scopesOverlap(a: RuleScope, b: RuleScope): boolean {
  const disjoint = <T>(x?: T[], y?: T[]) => !!x?.length && !!y?.length && !x.some((v) => y.includes(v));
  if (disjoint(a.productClass, b.productClass) || disjoint(a.condition, b.condition) || disjoint(a.channel, b.channel) || disjoint(a.site, b.site)) return false;
  const lo = Math.max(a.lifeMin ?? 0, b.lifeMin ?? 0);
  const hi = Math.min(a.lifeMax ?? 101, b.lifeMax ?? 101);
  return lo < hi;
}

/** Plain-language conflict between two rules, or null. */
export function ruleConflict(a: Pick<DraftRule, 'id' | 'action' | 'route' | 'scope'>, b: Pick<DraftRule, 'id' | 'action' | 'route' | 'scope'>): string | null {
  if (!a.route || !b.route || !scopesOverlap(a.scope, b.scope)) return null;
  if (a.route === b.route && (a.action === 'exclude') !== (b.action === 'exclude')) {
    return `${a.id} and ${b.id} conflict: one rules out ${routeName(a.route)}, the other asks for it on the same cases.`;
  }
  if (a.route !== b.route && a.action === 'require' && b.action === 'require') {
    return `${a.id} and ${b.id} conflict: both say "only", for different routes (${routeName(a.route)} and ${routeName(b.route)}).`;
  }
  if (a.route !== b.route && a.action === 'prefer' && b.action === 'prefer') {
    return `${a.id} and ${b.id} both prefer a different route on the same cases; the first one wins.`;
  }
  return null;
}

export function liveChecks(s: FlowState = state): CheckItem[] {
  const a = analyse(s);
  const out: CheckItem[] = [];
  const byId = new Map(a.nodes.map((n) => [n.id, n]));
  const name = (n: FlowNode) => (n.data.kind === 'rule' ? n.data.rule?.id ?? n.data.title : n.data.title);

  // Every step connected.
  const loose = a.nodes.filter((n) => {
    const hasIn = a.edges.some((e) => e.target === n.id);
    const hasOut = a.edges.some((e) => e.source === n.id);
    return (n.data.kind !== 'trigger' && !hasIn) || (n.data.kind !== 'learning' && !hasOut);
  });
  if (loose.length) loose.forEach((n) => out.push({ id: `loose-${n.id}`, level: 'error', text: `${name(n)} is not connected on both sides.`, nodeId: n.id }));
  else out.push({ id: 'connected', level: 'ok', text: 'Every step is connected.' });

  // Every outcome passes the guardrail gate and owner approval.
  const outcomes = a.nodes.filter((n) => n.data.kind === 'outcome');
  for (const [gateId, label] of [['gate', 'the guardrail gate'], ['approval', 'owner approval']] as const) {
    const bypass = reach('intake', a.edges, 'fwd', gateId);
    const leaks = outcomes.filter((o) => bypass.has(o.id));
    if (leaks.length) leaks.forEach((o) => out.push({ id: `bypass-${gateId}-${o.id}`, level: 'error', text: `${o.data.title} can be reached without passing ${label}.`, nodeId: o.id }));
    else out.push({ id: `pass-${gateId}`, level: 'ok', text: `Every outcome passes ${label}.` });
  }

  // Rules.
  const rules = a.nodes.filter((n) => n.data.kind === 'rule' && n.data.rule);
  for (const n of rules) {
    const r = n.data.rule!;
    if (!r.route) {
      out.push({ id: `noroute-${n.id}`, level: 'error', text: `${r.id} has no route yet.`, nodeId: n.id });
      continue;
    }
    const hit = checkRule({ ...r, route: r.route } as BusinessRule);
    if (hit) out.push({ id: `gr-${n.id}`, level: 'error', text: `${r.id} breaks ${hit.guardrailId} (owner ${hit.owner}): ${hit.message}`, nodeId: n.id });
    else if (!a.onRulePath(n.id)) out.push({ id: `inactive-${n.id}`, level: 'warn', text: `${r.id} is inactive: it is not between the guardrail gate and the decision.`, nodeId: n.id });
  }
  if (rules.length && rules.every((n) => n.data.rule?.route)) out.push({ id: 'routes', level: 'ok', text: 'Every rule has a route.' });
  const active = rules.filter((n) => a.onRulePath(n.id));
  let conflicts = 0;
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const c = ruleConflict(active[i].data.rule!, active[j].data.rule!);
      if (c) {
        conflicts += 1;
        out.push({ id: `conflict-${active[i].id}-${active[j].id}`, level: 'warn', text: c, nodeId: active[j].id });
      }
    }
  }
  if (!conflicts) out.push({ id: 'noconflict', level: 'ok', text: 'No two rules conflict.' });

  // Routes removed from the flow.
  const { blocked } = draftRules(s);
  blocked.forEach((r) => {
    const n = byId.get(`out-${r}`);
    out.push({ id: `removed-${r}`, level: 'error', text: `${routeName(r)} is removed from the flow: no case can be routed there. Add the outcome back after owner approval.`, nodeId: n?.id });
  });
  if (!blocked.length) out.push({ id: 'allroutes', level: 'ok', text: 'All 7 routes are in the flow.' });

  const order = { error: 0, warn: 1, ok: 2 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

/* ================================================================ simulated impact */

const impactMemo = new Map<string, Impact>();

/** Draft rules vs published rules on the open queue: decisions that change and the net value difference. */
export function simulate(rules: BusinessRule[], blocked: RouteId[] = []): Impact {
  const pubRules = getPublishedRules();
  const key = JSON.stringify([pubRules.version, pubRules.rules, rules, blocked]);
  const hit = impactMemo.get(key);
  if (hit) return hit;
  const pub = planQueue();
  const draft = planQueue(undefined, undefined, rules, blocked.length ? blocked : undefined);
  const labels = new Map(openDecisions().map((o) => [o.case.id, o.case.productName]));
  const changes: ImpactRow[] = [];
  for (const [id, p] of Object.entries(pub.decisions)) {
    const d = draft.decisions[id];
    if (!d) continue;
    const delta = d.best.net - p.best.net;
    if (d.best.route === p.best.route) continue;
    changes.push({ caseId: id, label: labels.get(id) ?? '', from: p.best.route, to: d.best.route, netPublished: p.best.net, netDraft: d.best.net, netDelta: delta });
  }
  changes.sort((x, y) => Math.abs(y.netDelta) - Math.abs(x.netDelta));
  const res: Impact = { changes, netDelta: draft.planValue - pub.planValue, openCases: Object.keys(pub.decisions).length };
  impactMemo.set(key, res);
  if (impactMemo.size > 24) impactMemo.delete(impactMemo.keys().next().value!);
  return res;
}

export async function loadImpact(rules: BusinessRule[], blocked: RouteId[]): Promise<Impact> {
  await delay(260);
  return simulate(rules, blocked);
}

/* ================================================================ editing */


export function onNodesChange(changes: NodeChange<FlowNode>[]) {
  const relevant = changes.filter((c) => !('id' in c) || c.id !== 'band');
  if (!relevant.length) return;
  set({ nodes: applyNodeChanges(relevant, state.nodes) });
}

export function selectNode(id: string | null) {
  set({ nodes: state.nodes.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })), edges: state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)) });
}

export function selectEdge(id: string, selected: boolean) {
  set({ edges: state.edges.map((e) => (e.id === id ? { ...e, selected } : e)) });
}

/** Why a connection is not allowed, or null. */
export function connectionError(c: Pick<Connection, 'source' | 'target'>, s: FlowState = state): string | null {
  if (!c.source || !c.target) return 'Connect an output to an input.';
  if (c.source === c.target) return 'A step cannot connect to itself.';
  const src = s.nodes.find((n) => n.id === c.source);
  const tgt = s.nodes.find((n) => n.id === c.target);
  if (!src || !tgt || src.data.proposed || tgt.data.proposed) return 'Approve the proposal before connecting it.';
  if (tgt.data.kind === 'trigger') return 'Intake starts the flow; nothing connects into it.';
  if (src.data.kind === 'learning') return 'Learning ends the flow.';
  if (s.edges.some((e) => e.source === c.source && e.target === c.target)) return 'These steps are already connected.';
  return null;
}

export function connect(c: Connection): EditResult {
  const ok = canEdit();
  if (!ok.ok) return ok;
  const err = connectionError(c);
  if (err) return { ok: false, reason: err };
  const src = state.nodes.find((n) => n.id === c.source)!;
  const tgt = state.nodes.find((n) => n.id === c.target)!;
  edit({ edges: [...state.edges, edge(c.source, c.target)] }, 'Connected', `${src.data.title} → ${tgt.data.title}`);
  return { ok: true };
}

/**
 * Deletes nodes and edges. Locked nodes are kept; deleting a middle rule or process step
 * reconnects its neighbours. Connections between two locked steps are fixed.
 */
export function deleteSelection(nodeIds: string[], edgeIds: string[]): { ok: boolean; reason?: string; removed: number } {
  const ok = canEdit();
  if (!ok.ok) return { ok: false, reason: ok.reason, removed: 0 };
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const lockedHit = nodeIds.map((id) => byId.get(id)).filter((n): n is FlowNode => !!n && (n.data.locked || n.type === 'band'));
  const del = new Set(nodeIds.filter((id) => byId.get(id) && !byId.get(id)!.data.locked && byId.get(id)!.type !== 'band'));
  const lockedEdge = (e: Edge) => byId.get(e.source)?.data.locked && byId.get(e.target)?.data.locked;
  const delEdges = new Set(edgeIds.filter((id) => {
    const e = state.edges.find((x) => x.id === id);
    return e && !lockedEdge(e);
  }));
  const fixedEdges = edgeIds.length - delEdges.size;
  if (!del.size && !delEdges.size) {
    const reason = lockedHit.length
      ? `${lockedHit[0].data.title} is ${lockedHit[0].data.kind === 'gate' || lockedHit[0].data.kind === 'approval' ? 'locked' : 'fixed'} (owner ${lockedHit[0].data.owner}). It can move but cannot be deleted.`
      : fixedEdges
        ? 'Connections between core steps are fixed.'
        : 'Nothing to delete.';
    return { ok: false, reason, removed: 0 };
  }
  let edges = state.edges.filter((e) => !delEdges.has(e.id));
  // Reconnect neighbours of deleted middle steps (rules and process steps).
  for (const id of del) {
    const n = byId.get(id)!;
    const ins = edges.filter((e) => e.target === id && !del.has(e.source)).map((e) => e.source);
    const outs = edges.filter((e) => e.source === id && !del.has(e.target)).map((e) => e.target);
    edges = edges.filter((e) => e.source !== id && e.target !== id);
    if (n.data.kind === 'rule' || n.data.kind === 'step') {
      for (const s of ins) for (const t of outs) if (!edges.some((e) => e.source === s && e.target === t)) edges.push(edge(s, t));
    }
  }
  const names = [...del].map((id) => {
    const n = byId.get(id)!;
    return n.data.kind === 'rule' ? `${n.data.rule?.id} (${readBackRule(n.data.rule!)})` : n.data.title;
  });
  const proposals = state.proposals.map((p) => (del.has(p.nodeId) && p.status === 'open' ? { ...p, status: 'dismissed' as const } : p));
  edit(
    { nodes: state.nodes.filter((n) => !del.has(n.id)), edges, proposals },
    del.size ? 'Removed' : 'Disconnected',
    del.size ? `Removed ${names.join('; ')}${[...del].some((id) => ['rule', 'step'].includes(byId.get(id)!.data.kind)) ? ' and reconnected its neighbours' : ''}.` : `Removed ${delEdges.size} connection${delEdges.size > 1 ? 's' : ''}.`,
  );
  return { ok: true, removed: del.size + delEdges.size, reason: lockedHit.length ? `${lockedHit.map((n) => n.data.title).join(', ')} kept (locked).` : undefined };
}

function nextRuleId(): string {
  const used = [...state.nodes.map((n) => n.data.rule?.id), ...getPublishedRules().rules.map((r) => r.id)].filter(Boolean) as string[];
  const max = used.reduce((m, id) => Math.max(m, Number(id.replace(/\D/g, '')) || 0), 0);
  return `BR-${String(max + 1).padStart(2, '0')}`;
}

/** The edge into the decision from the rule lane (where new rules are chained in). */
function decisionInEdge(s: FlowState = state): Edge | undefined {
  const a = analyse(s);
  return a.edges.find((e) => e.target === 'decision' && (e.source === 'gate' || a.onRulePath(e.source)));
}

function freeRuleSlot(): { x: number; y: number } {
  // Next slot at the bottom of the rule stack under the guardrail gate.
  const ys = state.nodes.filter((n) => n.data.kind === 'rule').map((n) => n.position.y);
  return { x: RULE_X, y: ys.length ? Math.max(...ys) + RULE_STEP : RULE_Y0 };
}

/** Adds a business rule chained in front of the decision (or at a drop position, unconnected). */
export function addRule(at?: { x: number; y: number }): EditResult & { nodeId?: string } {
  const ok = canEdit();
  if (!ok.ok) return ok;
  const id = nextRuleId();
  const rule: DraftRule = { id, action: 'exclude', scope: {}, owner: actorOf().role, description: '', active: true };
  const node = { ...ruleNode(rule, at ?? freeRuleSlot(), { isNew: true }), selected: true };
  let edges = state.edges;
  const into = at ? undefined : decisionInEdge();
  if (into) edges = [...edges.filter((e) => e.id !== into.id), edge(into.source, node.id), edge(node.id, 'decision')];
  edit({ nodes: [...state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node], edges }, 'Added rule', `${id} added${into ? ' before the decision' : ''}; choose its route.`);
  return { ok: true, nodeId: node.id };
}

export function addStep(at: { x: number; y: number }, title = 'Process step'): EditResult & { nodeId?: string } {
  const ok = canEdit();
  if (!ok.ok) return ok;
  const id = nextId('step');
  const node: FlowNode = { id, type: 'df', position: at, selected: true, data: { kind: 'step', title, subtitle: 'Connect it between two steps', owner: actorOf().role, locked: false, isNew: true } };
  edit({ nodes: [...state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node] }, 'Added step', `${title} added (not yet connected).`);
  return { ok: true, nodeId: id };
}

/** Routes with no outcome node on the canvas. */
export const missingRoutes = (s: FlowState = state) => ROUTE_IDS.filter((r) => !s.nodes.some((n) => n.data.kind === 'outcome' && n.data.route === r && !n.data.proposed));

export function addOutcome(route: RouteId, at?: { x: number; y: number }): EditResult {
  const ok = canEdit();
  if (!ok.ok) return ok;
  if (!missingRoutes().includes(route)) return { ok: false, reason: `${routeName(route)} is already in the flow.` };
  const node = outcomeNode(route, at, true);
  const edges = at ? state.edges : [...state.edges, edge('approval', node.id), edge(node.id, 'execute')];
  edit({ nodes: [...state.nodes, node], edges }, 'Added outcome', `${routeName(route)} added${at ? '' : ' after owner approval'}.`);
  return { ok: true };
}

export function updateRule(nodeId: string, patch: Partial<DraftRule>): EditResult {
  const ok = canEdit();
  if (!ok.ok) return ok;
  const n = state.nodes.find((x) => x.id === nodeId);
  if (!n?.data.rule) return { ok: false, reason: 'Not a rule.' };
  const rule: DraftRule = { ...n.data.rule, ...patch };
  rule.description = readBackRule(rule);
  edit({ nodes: state.nodes.map((x) => (x.id === nodeId ? { ...x, data: { ...x.data, rule } } : x)) }, 'Edited rule', `${rule.id}: ${rule.description}`, rule.id);
  return { ok: true };
}

export function renameStep(nodeId: string, title: string): EditResult {
  const ok = canEdit();
  if (!ok.ok) return ok;
  edit({ nodes: state.nodes.map((x) => (x.id === nodeId ? { ...x, data: { ...x.data, title } } : x)) }, 'Renamed step', title, nodeId);
  return { ok: true };
}

export function setActor(id: string) {
  set({ actorId: id });
}

/* ================================================================ governance */

export function publishedVersion(): number {
  return getPublishedRules().version;
}

export function stageLabel(s: FlowState = state): string {
  const v = publishedVersion();
  if (s.stage === 'review') return `Awaiting approval · v${v + 1}`;
  if (s.stage === 'approved') return `Approved · v${v + 1}`;
  if (s.stage === 'shadow') return `In shadow · v${v + 1}`;
  return s.dirty ? `Draft v${v + 1}` : `Published v${v}`;
}

export function submit(): EditResult {
  if (state.stage !== 'editing') return { ok: false, reason: 'The draft is already submitted.' };
  if (!state.dirty) return { ok: false, reason: 'Nothing to submit: the draft equals the published version.' };
  const errors = liveChecks().filter((c) => c.level === 'error');
  if (errors.length) return { ok: false, reason: `Fix ${errors.length} failing check${errors.length > 1 ? 's' : ''} first: ${errors[0].text}` };
  const { rules } = draftRules();
  set({ stage: 'review', approvedBy: null, audit: audit('Submitted', `Submitted draft v${publishedVersion() + 1} for approval (${rules.filter((r) => r.active !== false).length} active rules; made by ${state.makers.join(', ') || actorOf().name}).`) });
  return { ok: true };
}

export const MAKER_CHECKER = 'Maker-checker: you made these changes and cannot approve them';

export function isMaker(s: FlowState = state): boolean {
  return s.makers.includes(actorOf(s).name);
}

export function approve(): EditResult {
  if (state.stage !== 'review') return { ok: false, reason: 'Only a submitted draft can be approved.' };
  if (isMaker()) {
    set({ audit: audit('Approval blocked', `${MAKER_CHECKER}.`) });
    return { ok: false, reason: MAKER_CHECKER };
  }
  set({ stage: 'approved', approvedBy: actorOf().name, audit: audit('Approved', `Approved draft v${publishedVersion() + 1} made by ${state.makers.join(', ')}.`) });
  return { ok: true };
}

export function reject(reason = 'Sent back for changes'): EditResult {
  if (state.stage === 'editing') return { ok: false, reason: 'Nothing to reject.' };
  set({ stage: 'editing', approvedBy: null, shadow: null, audit: audit('Rejected', `${reason}; draft v${publishedVersion() + 1} is editable again.`) });
  return { ok: true };
}

export function startShadow(): EditResult {
  if (state.stage !== 'approved') return { ok: false, reason: 'Approve the draft before the shadow run.' };
  const { rules, blocked } = draftRules();
  const imp = simulate(rules, blocked);
  const shadow: ShadowRun = { at: new Date().toISOString(), by: actorOf().name, changes: imp.changes.length, netDelta: imp.netDelta };
  set({
    stage: 'shadow',
    shadow,
    audit: audit('Shadow run', `Draft v${publishedVersion() + 1} runs next to v${publishedVersion()} on ${imp.openCases} open cases: ${imp.changes.length} decisions would change, net ${imp.netDelta >= 0 ? '+' : '−'}${usd(Math.abs(imp.netDelta))}.`),
  });
  return { ok: true };
}

export async function publish(): Promise<EditResult> {
  if (state.stage !== 'shadow') return { ok: false, reason: 'Run the draft in shadow before publishing.' };
  const { rules, blockedRules } = draftRules();
  if (blockedRules.length) return { ok: false, reason: `${blockedRules.join(', ')} break a guardrail.` };
  const version = publishedVersion() + 1;
  await delay(350);
  try {
    publishRules(rules, version, actorOf().name);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  const entry: VersionEntry = {
    version,
    publishedAt: new Date().toISOString(),
    publishedBy: actorOf().name,
    note: state.shadow ? `${state.shadow.changes} decisions changed in shadow, net ${state.shadow.netDelta >= 0 ? '+' : '−'}${usd(Math.abs(state.shadow.netDelta))}` : 'Published',
    rules: rules.length,
  };
  set({
    stage: 'editing',
    dirty: false,
    makers: [],
    approvedBy: null,
    shadow: null,
    nodes: state.nodes.map((n) => (n.data.isNew ? { ...n, data: { ...n.data, isNew: false } } : n)),
    versions: [entry, ...state.versions],
    rollbackDepth: state.rollbackDepth + 1,
    audit: audit('Published', `Rules v${version} published (${rules.map((r) => r.id).join(', ') || 'no rules'}). Case decisions re-planned across the app.`),
  });
  return { ok: true };
}

export async function rollback(): Promise<EditResult> {
  if (!state.rollbackDepth) return { ok: false, reason: 'No earlier version to roll back to.' };
  await delay(350);
  let rs;
  try {
    rs = rollbackRules(actorOf().name);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  // Rebuild the rule lane from the restored rules; process steps and outcomes stay.
  const keep = state.nodes.filter((n) => n.data.kind !== 'rule' && !n.data.proposed);
  const keepIds = new Set(keep.map((n) => n.id));
  const chain = ruleChain(rs.rules);
  const edges = [...state.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target) && !(e.source === 'gate' && e.target === 'decision')), ...chain.edges];
  const prev = state.versions[1];
  set({
    nodes: [...keep, ...chain.nodes],
    edges,
    stage: 'editing',
    dirty: false,
    makers: [],
    approvedBy: null,
    shadow: null,
    proposals: state.proposals.map((p) => (p.status === 'open' ? { ...p, status: 'dismissed' } : p)),
    versions: [{ version: rs.version, publishedAt: rs.publishedAt, publishedBy: rs.publishedBy, note: `Roll back to the rules of v${prev?.version ?? rs.version - 2}`, rules: rs.rules.length }, ...state.versions],
    rollbackDepth: state.rollbackDepth - 1,
    audit: audit('Rolled back', `Rules restored to v${prev?.version ?? '?'} and published as v${rs.version}. Case decisions re-planned.`),
  });
  return { ok: true };
}

/* ================================================================ assistant (rule-based parser) */

const ROUTE_WORDS: [RegExp, RouteId][] = [
  [/\b(re-?lease|relase|secondary re-?lease|refurbish(?:ment)?(?: and| then)? lease)\b/, 'relase'],
  [/\b(internal parts|parts harvest|harvest(?:ing)? parts|harvest)\b/, 'intparts'],
  [/\b(external parts|parts sale|sell parts)\b/, 'extparts'],
  [/\b(redeploy(?:ment)?|internal redeploy)\b/, 'redeploy'],
  [/\b(whole-asset resale|resale|resell|sell)\b/, 'resale'],
  [/\b(material recovery|material|recycl\w*)\b/, 'material'],
  [/\b(responsible exit|exit|dispos\w*)\b/, 'exit'],
];
const CLASS_WORDS: [RegExp, ProductClass][] = [
  [/\bmotors?\b/, 'motor'],
  [/\bpumps?\b/, 'pump'],
  [/\b(control(?: units?)?|plcs?)\b/, 'control'],
  [/\b(drills?|power tools?)\b/, 'drill'],
  [/\b(batch(?:es)?|tool-fleet)\b/, 'batch'],
  [/\b(electronics|it equipment)\b/, 'it'],
];
const CHANNEL_WORDS: [RegExp, IntakeChannel][] = [
  [/\b(lease[- ]?end|contract end|end of lease)\b/, 'lease_end'],
  [/\b(field(?: service)? returns?|field service|repairs? returns?)\b/, 'field_return'],
  [/\b(trade[- ]?ins?)\b/, 'trade_in'],
  [/\b(excess|idle stock|idle)\b/, 'excess'],
];

function findGuardrailTouch(t: string): { id: string; reason: string } | null {
  if (/\bholding cost\b|\bcost rate\b|\bcost of capital\b/.test(t)) return { id: 'GR-04', reason: 'The holding cost rate is a Finance policy rate.' };
  if (/(skip|without|remove|bypass|no)\s+(the\s+)?(owner\s+)?approv|auto[- ]?approv/.test(t)) return { id: 'GR-05', reason: 'Every decision is approved by a named owner.' };
  if (/uncertified|without (a )?certificate|non-?certified/.test(t)) return { id: 'GR-06', reason: 'Exit and material go only through a certified provider.' };
  if (/fit[- ]for[- ]use|threshold/.test(t)) return { id: 'GR-03', reason: 'The fit-for-use threshold for certified parts is fixed.' };
  if (/refurbish\w*.*without .*(lease|order)/.test(t)) return { id: 'GR-02', reason: 'Refurbishment always ends in a named lease or sales order.' };
  if (/without refurbish/.test(t)) return { id: 'GR-01', reason: 'Re-lease always includes a full refurbishment.' };
  if (/\b(guardrail|gr-0\d)\b/.test(t)) {
    const m = t.match(/gr-0(\d)/);
    return { id: m ? `GR-0${m[1]}` : 'GR-05', reason: 'Guardrails are changed only by their owner.' };
  }
  return null;
}

const refuse = (id: string, reason: string, readBack: string): ParseResult => {
  const g = getGuardrails().find((x) => x.id === id) ?? getGuardrails()[0];
  return { kind: 'refused', guardrail: g, reason, readBack };
};

/** Reads a plain-language request into a rule, a process step or a refusal. */
export function parseRequest(input: string): ParseResult {
  const t = ` ${input.toLowerCase().replace(/[’']/g, "'")} `;
  if (!input.trim()) return { kind: 'unknown', readBack: 'Type a rule like "Field returns grade C: never re-lease" or a step like "Add a safety inspection step before Whole-Asset Resale".' };

  const gr = findGuardrailTouch(t);
  if (gr) return refuse(gr.id, gr.reason, `Touches ${gr.id}: guardrails cannot be changed from the Studio.`);

  const route = ROUTE_WORDS.find(([re]) => re.test(t.replace(/\bstep\b.*?\b(before|after)\b/, ' ')))?.[1];

  // Process step: "add a <name> step before|after <route>".
  const step = t.match(/\badd (?:an? |the )?(.+?) step (before|after) (.+)/);
  if (step) {
    const r = ROUTE_WORDS.find(([re]) => re.test(` ${step[3]} `))?.[1];
    const title = step[1].trim().replace(/^\w/, (c) => c.toUpperCase());
    if (!r) return { kind: 'unknown', readBack: `Add "${title}" ${step[2]} … which route? Name one, e.g. Whole-Asset Resale.` };
    return { kind: 'step', title, where: step[2] as 'before' | 'after', route: r, readBack: `Add a "${title}" step ${step[2]} ${routeName(r)}.` };
  }

  const action: RuleAction | undefined = /\b(never|don't|do not|exclude|no longer|not)\b/.test(t)
    ? 'exclude'
    : /\b(prefer|favou?r|prioriti[sz]e)\b/.test(t)
      ? 'prefer'
      : /\b(only|always|require|must)\b/.test(t)
        ? 'require'
        : undefined;

  const scope: RuleScope = {};
  const ch = CHANNEL_WORDS.filter(([re]) => re.test(t)).map(([, c]) => c);
  if (ch.length) scope.channel = ch;
  const cls = CLASS_WORDS.filter(([re]) => re.test(t)).map(([, c]) => c);
  if (cls.length) scope.productClass = cls;
  const grades = new Set<Grade>();
  const gm = t.match(/\bgrades?\s+([a-d](?:\s*(?:,|\/|or|and|&)\s*[a-d])*)\b/);
  if (gm) gm[1].split(/[^a-d]+/).filter(Boolean).forEach((g) => grades.add(g.toUpperCase() as Grade));
  if (/\bscrap\b/.test(t)) grades.add('Scrap');
  if (grades.size) scope.condition = GRADES.filter((g) => grades.has(g));
  const sites = SITES.filter((s) => t.includes(s.toLowerCase()) || (s === 'Repair centre' && t.includes('repair center')));
  if (sites.length) scope.site = sites;
  const lmax = t.match(/\blife (?:is )?(?:under|below|less than|<)\s*(\d{1,3})/);
  if (lmax) scope.lifeMax = Math.min(100, Number(lmax[1]));
  const lmin = t.match(/\blife (?:is )?(?:of )?(?:at least|over|above|more than|>=?)\s*(\d{1,3})/);
  if (lmin) scope.lifeMin = Math.min(100, Number(lmin[1]));

  const missing = [!action && 'an action (never / prefer / only)', !route && 'a route'].filter(Boolean) as string[];
  if (missing.length) {
    const partial = action || route ? `So far: ${action ? ACTION_LABEL[action].toLowerCase() : '…'} ${route ? routeName(route) : '…'}. ` : '';
    return { kind: 'unknown', readBack: `${partial}Still needed: ${missing.join(' and ')}.` };
  }
  const rule: DraftRule & { route: RouteId } = { id: nextRuleId(), action: action!, route: route!, scope, owner: getPolicy().routes[route!].owner, description: '', active: true };
  rule.description = readBackRule(rule);
  const hit = checkRule(rule as BusinessRule);
  if (hit) return refuse(hit.guardrailId, hit.message, `${rule.description} — breaks ${hit.guardrailId}.`);
  return { kind: 'rule', rule, readBack: rule.description };
}

export const ASSISTANT_EXAMPLES = [
  'Field returns grade C: never re-lease',
  'Add a safety inspection step before Whole-Asset Resale',
  'Prefer resale for trade-ins grade A',
  'Skip owner approval for grade A redeploy',
];

function chat(...msgs: Omit<ChatMessage, 'id'>[]): ChatMessage[] {
  return [...state.chat, ...msgs.map((m) => ({ ...m, id: nextId('msg') }))];
}

/** Sends a request to the assistant: refusal, question, or a proposal with a dashed node on the canvas. */
export function sendToAssistant(text: string): ParseResult {
  const p = parseRequest(text);
  const user = { from: 'user' as const, text };
  if (p.kind === 'unknown') {
    set({ chat: chat(user, { from: 'assistant', text: `I could not turn that into a change yet. ${p.readBack}` }) });
    return p;
  }
  if (p.kind === 'refused') {
    set({
      chat: chat(user, {
        from: 'assistant',
        guardrailId: p.guardrail.id,
        text: `I can't do that: it touches ${p.guardrail.id} "${p.guardrail.title}", owned by ${p.guardrail.owner}. ${p.reason} Guardrails are changed only by their owner, never from the Studio.`,
      }),
      audit: audit('Assistant refused', `"${text}" touches ${p.guardrail.id} (owner ${p.guardrail.owner}).`),
    });
    return p;
  }
  // Dismiss earlier open proposals (one dashed node at a time).
  const open = state.proposals.filter((x) => x.status === 'open');
  const nodes = state.nodes.filter((n) => !open.some((o) => o.nodeId === n.id));
  const proposals = state.proposals.map((x) => (x.status === 'open' ? { ...x, status: 'dismissed' as const } : x));
  const pid = nextId('prop');
  const { rules: curRules, blocked } = draftRules();

  if (p.kind === 'rule') {
    const nodeId = `rule-${p.rule.id}`;
    const node: FlowNode = ruleNode(p.rule, freeRuleSlot(), { proposed: true, isNew: true });
    const others = realNodes().filter((n) => n.data.kind === 'rule' && n.data.rule && analyse(state).onRulePath(n.id));
    const conflicts = others.map((n) => ruleConflict(p.rule, n.data.rule!)).filter(Boolean) as string[];
    const slot = decisionInEdge();
    const imp = simulate([...curRules, { ...p.rule, description: p.rule.description }], blocked);
    const base = simulate(curRules, blocked);
    const changes = imp.changes.filter((c) => !base.changes.some((b) => b.caseId === c.caseId && b.to === c.to)).length;
    const proposal: Proposal = {
      id: pid,
      nodeId,
      kind: 'rule',
      summary: p.rule.description,
      checks: [
        { ok: !!slot, label: 'Fits the process', detail: slot ? 'Goes between the guardrail gate and the decision.' : 'No path from the guardrail gate to the decision to place it on.' },
        { ok: true, label: 'Passes guardrails', detail: 'GR-01 … GR-06 all hold.' },
        { ok: !conflicts.length, label: conflicts.length ? 'Conflicts' : 'No conflicts', detail: conflicts.length ? conflicts.join(' ') : 'No overlap with an opposite rule.' },
        { ok: true, label: 'Models unchanged', detail: 'Core agents and their prediction models stay as they are.' },
      ],
      impact: { changes, netDelta: imp.netDelta - base.netDelta, note: `${changes} open decision${changes === 1 ? '' : 's'} would change compared with the current draft.` },
      status: 'open',
    };
    set({
      nodes: [...nodes, node],
      proposals: [...proposals, proposal],
      chat: chat(user, { from: 'assistant', text: `Proposal: ${p.rule.description}. Shown dashed on the canvas.`, proposalId: pid }),
    });
    return p;
  }

  // Process step before / after a route outcome.
  const out = realNodes().find((n) => n.data.kind === 'outcome' && n.data.route === p.route);
  const nodeId = nextId('step');
  // Steps sit in the gap between owner approval and the outcome column, or just right of the outcome.
  const pos = out ? (p.where === 'before' ? { x: out.position.x - 240, y: out.position.y } : { x: out.position.x + 140, y: out.position.y - 64 }) : { x: OUTCOME_X, y: -200 };
  const node: FlowNode = { id: nodeId, type: 'df', position: pos, data: { kind: 'step', title: p.title, subtitle: `${p.where === 'before' ? 'Before' : 'After'} ${routeName(p.route)}`, owner: getPolicy().routes[p.route].owner, locked: false, proposed: true, isNew: true } };
  const proposal: Proposal = {
    id: pid,
    nodeId,
    kind: 'step',
    summary: p.readBack,
    where: p.where,
    route: p.route,
    checks: [
      { ok: !!out, label: 'Fits the process', detail: out ? `Goes ${p.where} ${routeName(p.route)}, after owner approval.` : `${routeName(p.route)} is not in the flow.` },
      { ok: true, label: 'Passes guardrails', detail: 'Owner approval and the guardrail gate stay in front of every outcome.' },
      { ok: true, label: 'No conflicts', detail: 'A process step adds work; it does not change which route is chosen.' },
      { ok: true, label: 'Models unchanged', detail: 'Core agents and their prediction models stay as they are.' },
    ],
    impact: { changes: 0, netDelta: 0, note: 'No route decision changes: the step runs after the route is chosen.' },
    status: 'open',
  };
  set({ nodes: [...nodes, node], proposals: [...proposals, proposal], chat: chat(user, { from: 'assistant', text: `Proposal: ${p.readBack} Shown dashed on the canvas.`, proposalId: pid }) });
  return p;
}

/** Dashed preview edges for open proposals (derived, not stored). */
export function proposalEdges(s: FlowState = state): Edge[] {
  const out: Edge[] = [];
  for (const p of s.proposals) {
    if (p.status !== 'open') continue;
    if (p.kind === 'rule') {
      const into = decisionInEdge(s);
      if (into) out.push(edge(into.source, p.nodeId, { data: { proposed: true } }), edge(p.nodeId, 'decision', { data: { proposed: true } }));
    } else if (p.route) {
      const target = `out-${p.route}`;
      const ref = p.where === 'before' ? s.edges.find((e) => e.target === target) : s.edges.find((e) => e.source === target);
      if (ref) out.push(edge(ref.source, p.nodeId, { data: { proposed: true } }), edge(p.nodeId, ref.target, { data: { proposed: true } }));
    }
  }
  return out;
}

export function approveProposal(id: string): EditResult {
  const ok = canEdit();
  if (!ok.ok) return ok;
  const p = state.proposals.find((x) => x.id === id && x.status === 'open');
  if (!p) return { ok: false, reason: 'This proposal is no longer open.' };
  if (!p.checks[0].ok) return { ok: false, reason: p.checks[0].detail };
  const preview = proposalEdges({ ...state, proposals: [p] });
  const [a, b] = preview;
  let edges = state.edges;
  if (a && b) edges = [...edges.filter((e) => !(e.source === a.source && e.target === b.target)), edge(a.source, a.target), edge(b.source, b.target)];
  const nodes = state.nodes.map((n) => (n.id === p.nodeId ? { ...n, data: { ...n.data, proposed: false } } : n));
  const chatMsgs = chat({ from: 'assistant', text: `Applied to the draft: ${p.summary}` });
  edit({ nodes, edges, proposals: state.proposals.map((x) => (x.id === id ? { ...x, status: 'approved' } : x)), chat: chatMsgs }, 'Applied proposal', `Assistant proposal applied: ${p.summary}`);
  return { ok: true };
}

export function dismissProposal(id: string) {
  const p = state.proposals.find((x) => x.id === id);
  if (!p || p.status !== 'open') return;
  set({ nodes: state.nodes.filter((n) => n.id !== p.nodeId), proposals: state.proposals.map((x) => (x.id === id ? { ...x, status: 'dismissed' } : x)), chat: chat({ from: 'assistant', text: `Dismissed: ${p.summary}` }) });
}

/* ================================================================ async loader */

export const decisionFlowService = {
  subscribe,
  async load(): Promise<FlowState> {
    await delay(260);
    return state;
  },
};


