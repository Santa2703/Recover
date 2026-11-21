/**
 * MCP & Tools mock service: tool catalog, agent registry, playground runs,
 * permission matrix, call log / write gate, external MCP servers and proposals.
 */
import toolsJson from '@/data/mcpTools.json';
import agentsJson from '@/data/mcpAgents.json';
import callsJson from '@/data/mcpCalls.json';
import permsJson from '@/data/mcpPermissions.json';
import serversJson from '@/data/mcpServers.json';
import proposalsJson from '@/data/mcpProposals.json';
import type { Paged } from '@/models/domain.model';
import { caseStore, meta } from './mock/stores';
import { createCollection, delay, queryList } from './mock/mockUtils';
import { governanceService, type AgentRecord } from './governanceService';

// ---------------------------------------------------------------- types

export type ToolScope = 'read_only' | 'write_gated' | 'compute';
export type RiskLevel = 'low' | 'medium' | 'high';
export type JsonSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema & { description?: string; enum?: string[]; default?: unknown }>;
  items?: JsonSchema;
  [k: string]: unknown;
};

export interface McpTool {
  id: string;
  name: string;
  server: string;
  description: string;
  scope: ToolScope;
  risk: RiskLevel;
  approvalRequired: boolean;
  enabled: boolean;
  authorizedRoles: string[];
  lastUsed: string;
  avgLatencyMs: number;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  sampleInput: Record<string, unknown>;
  sampleOutput: Record<string, unknown>;
}

export interface McpToolRow extends McpTool {
  calls24h: number;
}

export type AgentStatus = 'active' | 'suspended';
export interface McpAgent {
  id: string;
  name: string;
  description: string;
  journeySteps: number[];
  allowedTools: string[];
  scopes: ToolScope[];
  limits: { callsPerHour: number; writesPerDay: number; maxConcurrent: number; timeoutSec: number };
  status: AgentStatus;
  statusReason?: string;
  owner: string;
  lastRun: string;
  runs24h: number;
  successRate: number;
}

export type CallResult = 'success' | 'error' | 'held' | 'rejected' | 'denied';
export type GateStatus = 'not_required' | 'pending' | 'approved' | 'rejected';
export interface McpCall {
  id: string;
  ts: string;
  agentId: string;
  toolId: string;
  tenant: string;
  caseId: string | null;
  result: CallResult;
  gate: GateStatus;
  latencyMs: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote?: string | null;
  source?: 'agent' | 'playground';
}
export interface McpCallRow extends McpCall {
  agentName: string;
  toolName: string;
  server: string;
  productName?: string;
}

export type PermLevel = 'none' | 'read' | 'write_gated';
export interface McpPermission {
  id: string;
  tenant: string;
  agentId: string;
  toolId: string;
  level: PermLevel;
}
export interface PermChange {
  tenant: string;
  agentId: string;
  toolId: string;
  from: PermLevel;
  to: PermLevel;
}

export type ServerStatus = 'connected' | 'degraded' | 'disconnected';
export interface McpServerTool {
  name: string;
  description: string;
  scope: ToolScope;
}
export interface McpServer {
  id: string;
  name: string;
  vendor: string;
  status: ServerStatus;
  endpoint: string;
  transport: string;
  authType: string;
  health: number;
  latencyMs: number;
  lastActivity: string;
  connectedAt: string | null;
  tools: McpServerTool[];
}
export interface ConnectServerInput {
  name: string;
  vendor: string;
  endpoint: string;
  transport: string;
  authType: string;
}
export interface ConnectionTest {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export type ProposalStatus = 'pending' | 'approved' | 'declined';
export interface McpProposal {
  id: string;
  name: string;
  targetSystem: string;
  proposer: string;
  team: string;
  endpoint: string;
  authType: string;
  dataClassification: string;
  scopes: ToolScope[];
  tools: string[];
  purpose: string;
  status: ProposalStatus;
  submittedAt: string;
  decision: { by: string; at: string; comment: string } | null;
  /** Set once an approved proposal has been connected as an MCP server. */
  connectedServerId?: string;
}
export type NewProposalInput = Omit<McpProposal, 'id' | 'status' | 'submittedAt' | 'decision' | 'proposer' | 'connectedServerId'>;

/**
 * One registry row for an AI agent, service or human control point. Merges the MCP agent
 * registry (tool-calling agents with tenant grants) with the orchestration "Agents & services"
 * list (who performs each journey step). Records with the same id or name are merged into one row.
 */
export type RegistryKind = 'agent' | 'service' | 'control';
export type RegistryStatus = 'active' | 'degraded' | 'paused';
export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  kind: RegistryKind;
  status: RegistryStatus;
  statusReason?: string;
  steps: number[];
  owner: string;
  lastRun: string;
  runs24h: number;
  /** 0–100 */
  successRate: number;
  /** MCP agent id when the entry calls MCP tools (has tool grants). */
  mcpId?: string;
  /** Orchestration agent id when the entry performs journey steps. */
  orchId?: string;
  /** MCP tools declared in the agent manifest. */
  tools: string[];
  toolScopes: ToolScope[];
  /** Systems read (orchestration). */
  systems: string[];
  /** Service scopes such as eam.assets:read (orchestration). */
  scopes: string[];
  limits: string[];
  mcpLimits?: McpAgent['limits'];
  version?: string;
  model?: string | null;
}
export interface RegistryQuery {
  search?: string;
  kind?: RegistryKind | 'all';
  status?: RegistryStatus | 'all';
  step?: number | 'all';
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function mergeRegistry(mcp: McpAgent[], orch: AgentRecord[]): RegistryEntry[] {
  const calls = callStore.all();
  const fromMcp = (a: McpAgent): RegistryEntry => ({
    id: a.id,
    name: a.name,
    description: a.description,
    kind: 'agent',
    status: a.status === 'suspended' ? 'paused' : 'active',
    statusReason: a.statusReason,
    steps: a.journeySteps,
    owner: a.owner,
    lastRun: a.lastRun,
    runs24h: Math.max(a.runs24h, calls.filter((c) => c.agentId === a.id && in24h(c.ts)).length),
    successRate: Math.round(a.successRate * 1000) / 10,
    mcpId: a.id,
    tools: a.allowedTools,
    toolScopes: a.scopes,
    systems: [],
    scopes: [],
    limits: [],
    mcpLimits: a.limits,
  });
  const rows = mcp.map(fromMcp);
  for (const o of orch) {
    const match = rows.find((r) => r.id === o.id || normName(r.name) === normName(o.name));
    if (match) {
      // Same agent in both lists: keep one row; the stricter status wins.
      match.orchId = o.id;
      match.kind = o.kind;
      match.systems = o.systems;
      match.scopes = o.scopes;
      match.limits = o.limits;
      match.version = o.version;
      match.model = o.model;
      match.steps = [...new Set([...match.steps, ...o.steps])].sort((a, b) => a - b);
      match.runs24h = Math.max(match.runs24h, o.runsToday);
      if (o.status !== 'active' && match.status === 'active') match.status = o.status;
      continue;
    }
    rows.push({
      id: o.id,
      name: o.name,
      description: o.description,
      kind: o.kind,
      status: o.status,
      steps: o.steps,
      owner: o.owner,
      lastRun: o.lastRun,
      runs24h: o.runsToday,
      successRate: o.successRate,
      orchId: o.id,
      tools: [],
      toolScopes: [],
      systems: o.systems,
      scopes: o.scopes,
      limits: o.limits,
      version: o.version,
      model: o.model,
    });
  }
  return rows.sort((a, b) => Math.min(...a.steps) * 100 + a.steps.length - (Math.min(...b.steps) * 100 + b.steps.length) || a.name.localeCompare(b.name));
}

export type RunStatus = 'success' | 'error' | 'held' | 'denied';
export interface PlaygroundRun {
  id: string;
  ts: string;
  toolId: string;
  agentId: string;
  tenant: string;
  input: Record<string, unknown>;
  status: RunStatus;
  latencyMs: number;
  output: Record<string, unknown> | null;
  message: string;
  callId: string | null;
}

// ---------------------------------------------------------------- stores & clock

const toolStore = createCollection<McpTool>(toolsJson as unknown as McpTool[]);
const agentStore = createCollection<McpAgent>(agentsJson as unknown as McpAgent[]);
const callStore = createCollection<McpCall>(callsJson as unknown as McpCall[]);
const permStore = createCollection<McpPermission>(permsJson as unknown as McpPermission[]);
const serverStore = createCollection<McpServer>(serversJson as unknown as McpServer[]);
const proposalStore = createCollection<McpProposal>(proposalsJson as unknown as McpProposal[]);
const runStore = createCollection<PlaygroundRun>([]);

const AS_OF = new Date(meta.asOf).getTime();
const LOADED_AT = Date.now();
/** Mock clock: starts at the dataset "as of" time and advances in real time. */
export const mcpNow = () => AS_OF + (Date.now() - LOADED_AT);
const nowIso = () => new Date(mcpNow()).toISOString();

/** The signed-in reviewer used for approvals in this mock. */
export const CURRENT_USER = { name: 'Jordan Ellis', role: 'Admin' };
/** The developer who files proposals in this mock. */
export const CURRENT_DEVELOPER = { name: 'Sam Okafor', role: 'Developer', team: 'Platform engineering' };

export const TENANTS: string[] = meta.tenants;
export const TOOL_SERVERS = ['SAP ERP', 'Manhattan WMS', 'Maximo EAM', 'Salesforce', 'Machinio market', 'Internal solvers'];
export const JOURNEY_STEPS: { id: number; label: string }[] = meta.journey.map((j) => ({ id: j.id, label: j.label }));

const combine =
  (...subs: ((l: () => void) => () => void)[]) =>
  (listener: () => void) => {
    const offs = subs.map((s) => s(listener));
    return () => offs.forEach((o) => o());
  };

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`;
const DAY = 864e5;
const in24h = (iso: string) => mcpNow() - new Date(iso).getTime() <= DAY;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

const toCallRow = (c: McpCall): McpCallRow => {
  const tool = toolStore.get(c.toolId);
  return {
    ...c,
    agentName: agentStore.get(c.agentId)?.name ?? c.agentId,
    toolName: tool?.name ?? c.toolId,
    server: tool?.server ?? '—',
    productName: c.caseId ? caseStore.get(c.caseId)?.productName : undefined,
  };
};

/** Copy the sample output, swapping case ids and nudging numbers so runs look live. */
function simulateOutput(tool: McpTool, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tool.sampleOutput)) {
    if (typeof v === 'number' && v > 10 && !/year|life|months/i.test(k)) out[k] = Math.round(v * rand(0.9, 1.1));
    else out[k] = v;
  }
  if (typeof input.caseId === 'string') out.caseId = input.caseId;
  return out;
}

// ---------------------------------------------------------------- validation

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  value?: Record<string, unknown>;
}

/** Parse the JSON text and check it against the tool's input schema (required, types, enums). */
export function validateToolInput(tool: McpTool, text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['Input must be a JSON object'] };
  }
  const value = parsed as Record<string, unknown>;
  const errors: string[] = [];
  for (const req of tool.inputSchema.required ?? []) {
    if (value[req] === undefined || value[req] === null || value[req] === '') errors.push(`Missing required field "${req}"`);
  }
  const props = tool.inputSchema.properties ?? {};
  for (const [k, v] of Object.entries(value)) {
    const p = props[k];
    if (!p) {
      errors.push(`Unknown field "${k}"`);
      continue;
    }
    const t = p.type;
    const actual = Array.isArray(v) ? 'array' : typeof v;
    if (t === 'integer' ? !Number.isInteger(v) : t && t !== actual) errors.push(`"${k}" must be ${t}`);
    else if (p.enum && !p.enum.includes(String(v))) errors.push(`"${k}" must be one of ${p.enum.join(', ')}`);
    else if (typeof p.pattern === 'string' && typeof v === 'string' && !new RegExp(p.pattern).test(v)) errors.push(`"${k}" does not match ${p.pattern}`);
    else if (typeof p.minimum === 'number' && typeof v === 'number' && v < p.minimum) errors.push(`"${k}" must be ≥ ${p.minimum}`);
  }
  return { ok: errors.length === 0, errors, value };
}

// ---------------------------------------------------------------- service

export interface ToolQuery {
  search?: string;
  scope?: ToolScope | 'all';
  server?: string;
  enabled?: 'all' | 'enabled' | 'disabled';
}
export interface CallQuery {
  search?: string;
  agentId?: string;
  toolId?: string;
  tenant?: string;
  result?: CallResult | 'all';
  gate?: GateStatus | 'all';
  page?: number;
  pageSize?: number;
}

export const mcpService = {
  subscribeTools: combine(toolStore.subscribe, callStore.subscribe),
  subscribeAgents: combine(agentStore.subscribe, callStore.subscribe),
  subscribeCalls: combine(callStore.subscribe, toolStore.subscribe, agentStore.subscribe),
  subscribePerms: permStore.subscribe,
  subscribeRuns: runStore.subscribe,
  subscribeServers: serverStore.subscribe,
  subscribeProposals: combine(proposalStore.subscribe, serverStore.subscribe),

  // ---- tools
  async listTools(q: ToolQuery = {}): Promise<Paged<McpToolRow>> {
    await delay();
    const calls = callStore.all();
    const rows: McpToolRow[] = toolStore.all().map((t) => ({ ...t, calls24h: calls.filter((c) => c.toolId === t.id && in24h(c.ts)).length }));
    return queryList(rows, {
      search: q.search,
      searchFields: ['name', 'description', 'server'],
      filters: { scope: q.scope, server: q.server },
      predicate: q.enabled && q.enabled !== 'all' ? (r) => r.enabled === (q.enabled === 'enabled') : undefined,
    });
  },

  /** All tools, unfiltered, for pickers. */
  async allTools(): Promise<McpTool[]> {
    await delay(150);
    return toolStore.all();
  },

  async toolDetail(id: string): Promise<{ tool: McpTool; recent: McpCallRow[]; agents: McpAgent[] } | null> {
    await delay(200);
    const tool = toolStore.get(id);
    if (!tool) return null;
    const recent = callStore
      .all()
      .filter((c) => c.toolId === id)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .slice(0, 8)
      .map(toCallRow);
    return { tool, recent, agents: agentStore.all().filter((a) => a.allowedTools.includes(id)) };
  },

  async setToolEnabled(id: string, enabled: boolean): Promise<McpTool> {
    await delay(250);
    return toolStore.update(id, { enabled });
  },

  async toolSummary() {
    await delay(180);
    const tools = toolStore.all();
    const calls = callStore.all();
    return {
      total: tools.length,
      enabled: tools.filter((t) => t.enabled).length,
      writeGated: tools.filter((t) => t.scope === 'write_gated').length,
      servers: new Set(tools.map((t) => t.server)).size,
      calls24h: calls.filter((c) => in24h(c.ts)).length,
      held: calls.filter((c) => c.gate === 'pending').length,
    };
  },

  // ---- agents
  async listAgents(q: { search?: string; status?: AgentStatus | 'all'; step?: number | 'all' } = {}): Promise<McpAgent[]> {
    await delay();
    const calls = callStore.all();
    const rows = agentStore.all().map((a) => ({ ...a, runs24h: Math.max(a.runs24h, calls.filter((c) => c.agentId === a.id && in24h(c.ts)).length) }));
    return queryList(rows, {
      search: q.search,
      searchFields: ['name', 'description', 'owner', (a) => a.allowedTools.join(' ')],
      filters: { status: q.status },
      predicate: q.step && q.step !== 'all' ? (a) => a.journeySteps.includes(q.step as number) : undefined,
    }).items;
  },

  async allAgents(): Promise<McpAgent[]> {
    await delay(150);
    return agentStore.all();
  },

  async agentDetail(id: string): Promise<{ agent: McpAgent; tools: McpTool[]; recent: McpCallRow[]; grants: McpPermission[] } | null> {
    await delay(200);
    const agent = agentStore.get(id);
    if (!agent) return null;
    return {
      agent,
      tools: agent.allowedTools.map((t) => toolStore.get(t)).filter((t): t is McpTool => !!t),
      recent: callStore
        .all()
        .filter((c) => c.agentId === id)
        .sort((a, b) => (a.ts < b.ts ? 1 : -1))
        .slice(0, 8)
        .map(toCallRow),
      grants: permStore.all().filter((p) => p.agentId === id),
    };
  },

  async setAgentStatus(id: string, status: AgentStatus, reason?: string): Promise<McpAgent> {
    await delay(300);
    return agentStore.update(id, {
      status,
      statusReason: status === 'suspended' ? reason || `Paused by ${CURRENT_USER.name}` : undefined,
    });
  },

  // ---- unified registry (MCP agents + orchestration agents & services)
  subscribeRegistry: combine(agentStore.subscribe, callStore.subscribe, governanceService.subscribeAgents),

  async listRegistry(q: RegistryQuery = {}): Promise<RegistryEntry[]> {
    const [, orch] = await Promise.all([delay(), governanceService.listAgents()]);
    return queryList(mergeRegistry(agentStore.all(), orch), {
      search: q.search,
      searchFields: ['name', 'description', 'owner', (r) => r.tools.join(' '), (r) => r.systems.join(' '), (r) => r.scopes.join(' ')],
      filters: { kind: q.kind, status: q.status },
      predicate: q.step && q.step !== 'all' ? (r) => r.steps.includes(Number(q.step)) : undefined,
    }).items;
  },

  /** Pause or resume a registry entry in every list it comes from. */
  async setRegistryStatus(entry: RegistryEntry, paused: boolean, reason: string, actor: { id: string; name: string; role: string }): Promise<void> {
    if (entry.mcpId) await mcpService.setAgentStatus(entry.mcpId, paused ? 'suspended' : 'active', reason);
    if (entry.orchId) await governanceService.setAgentStatus(entry.orchId, paused ? 'paused' : 'active', actor);
  },

  // ---- playground
  async runTool(req: { toolId: string; agentId: string; tenant: string; input: Record<string, unknown> }): Promise<PlaygroundRun> {
    const tool = toolStore.get(req.toolId);
    const agent = agentStore.get(req.agentId);
    if (!tool || !agent) throw new Error('Unknown tool or agent');
    const latencyMs = Math.round(tool.avgLatencyMs * rand(0.6, 1.4));
    await delay(Math.min(latencyMs, 1600));

    const grant = permStore.get(`${req.tenant}|${agent.id}|${tool.id}`)?.level ?? 'none';
    let denied: string | null = null;
    if (!tool.enabled) denied = `${tool.name} is disabled in the tool catalog`;
    else if (agent.status === 'suspended') denied = `${agent.name} is paused`;
    else if (!agent.allowedTools.includes(tool.id)) denied = `${tool.name} is not declared in ${agent.name}'s manifest`;
    else if (grant === 'none') denied = `${agent.name} has no grant on ${tool.name} for ${req.tenant}`;
    else if (tool.scope === 'write_gated' && grant !== 'write_gated') denied = `Read-only grant: ${agent.name} cannot write via ${tool.name} for ${req.tenant}`;

    const ts = nowIso();
    const caseId = typeof req.input.caseId === 'string' && caseStore.get(req.input.caseId) ? req.input.caseId : null;
    let status: RunStatus;
    let output: Record<string, unknown> | null = null;
    let message: string;
    let call: McpCall;
    const base = {
      id: newId('call'),
      ts,
      agentId: agent.id,
      toolId: tool.id,
      tenant: req.tenant,
      caseId,
      input: req.input,
      decidedBy: null,
      decidedAt: null,
      source: 'playground' as const,
    };

    if (denied) {
      status = 'denied';
      message = `Denied: ${denied}`;
      call = { ...base, result: 'denied', gate: 'not_required', latencyMs: Math.round(latencyMs * 0.1), output: null, error: message };
    } else if (tool.scope === 'write_gated') {
      status = 'held';
      message = 'Held at write gate: needs approval';
      call = { ...base, result: 'held', gate: 'pending', latencyMs, output: null, error: null };
    } else if (Math.random() < 0.05) {
      status = 'error';
      message = `Upstream error from ${tool.server}: timeout after ${agent.limits.timeoutSec}s`;
      call = { ...base, result: 'error', gate: 'not_required', latencyMs, output: null, error: message };
    } else {
      status = 'success';
      output = simulateOutput(tool, req.input);
      message = `200 OK from ${tool.server}`;
      call = { ...base, result: 'success', gate: 'not_required', latencyMs, output, error: null };
    }
    callStore.insert(call);
    if (!denied) {
      toolStore.update(tool.id, { lastUsed: ts });
      agentStore.update(agent.id, { lastRun: ts });
    }
    return runStore.insert({
      id: newId('run'),
      ts,
      toolId: tool.id,
      agentId: agent.id,
      tenant: req.tenant,
      input: req.input,
      status,
      latencyMs: call.latencyMs,
      output,
      message,
      callId: call.id,
    });
  },

  async listRuns(): Promise<PlaygroundRun[]> {
    await delay(120);
    return runStore.all();
  },

  async clearRuns(): Promise<void> {
    await delay(150);
    runStore.all().forEach((r) => runStore.remove(r.id));
  },

  // ---- calls & write gate
  async listCalls(q: CallQuery = {}): Promise<Paged<McpCallRow>> {
    await delay();
    return queryList(callStore.all().map(toCallRow), {
      search: q.search,
      searchFields: ['id', 'caseId', 'agentName', 'toolName', 'productName', 'tenant'],
      filters: { agentId: q.agentId, toolId: q.toolId, tenant: q.tenant, result: q.result, gate: q.gate },
      sortBy: 'ts',
      sortDir: 'desc',
      page: q.page,
      pageSize: q.pageSize,
    });
  },

  async callSummary() {
    await delay(180);
    const calls = callStore.all();
    const day = calls.filter((c) => in24h(c.ts));
    const failed = day.filter((c) => c.result === 'error' || c.result === 'denied').length;
    const completed = day.filter((c) => c.result !== 'held');
    return {
      calls24h: day.length,
      held: calls.filter((c) => c.gate === 'pending').length,
      errorRate: day.length ? failed / day.length : 0,
      errors24h: failed,
      avgLatencyMs: completed.length ? Math.round(completed.reduce((s, c) => s + c.latencyMs, 0) / completed.length) : 0,
    };
  },

  async decideCall(id: string, decision: 'approved' | 'rejected', note?: string): Promise<McpCall> {
    await delay(350);
    const call = callStore.get(id);
    if (!call || call.gate !== 'pending') throw new Error('This call is no longer waiting at the gate');
    const tool = toolStore.get(call.toolId);
    return callStore.update(id, {
      gate: decision,
      result: decision === 'approved' ? 'success' : 'rejected',
      output: decision === 'approved' && tool ? simulateOutput(tool, call.input) : null,
      error: decision === 'rejected' ? `Rejected at write gate${note ? `: ${note}` : ''}` : null,
      decidedBy: CURRENT_USER.name,
      decidedAt: nowIso(),
      decisionNote: note || null,
    });
  },

  // ---- permissions
  async getPermissions(): Promise<McpPermission[]> {
    await delay();
    return permStore.all();
  },

  async savePermissions(changes: PermChange[]): Promise<number> {
    await delay(450);
    for (const ch of changes) {
      const id = `${ch.tenant}|${ch.agentId}|${ch.toolId}`;
      const existing = permStore.get(id);
      if (ch.to === 'none') {
        if (existing) permStore.remove(id);
      } else if (existing) permStore.update(id, { level: ch.to });
      else permStore.insert({ id, tenant: ch.tenant, agentId: ch.agentId, toolId: ch.toolId, level: ch.to });
    }
    return changes.length;
  },

  // ---- external MCP servers (as client)
  async listServers(): Promise<McpServer[]> {
    await delay();
    return serverStore.all();
  },

  async connectServer(input: ConnectServerInput): Promise<McpServer> {
    await delay(900);
    if (serverStore.all().some((s) => s.endpoint === input.endpoint.trim())) throw new Error('A server with this endpoint is already registered');
    const ts = nowIso();
    return serverStore.insert({
      id: newId('srv'),
      name: input.name.trim(),
      vendor: input.vendor.trim(),
      endpoint: input.endpoint.trim(),
      transport: input.transport,
      authType: input.authType,
      status: 'connected',
      health: 100,
      latencyMs: Math.round(rand(180, 520)),
      lastActivity: ts,
      connectedAt: ts,
      tools: [
        { name: 'list_resources', description: 'List resources the server exposes to this client', scope: 'read_only' },
        { name: 'search', description: `Search ${input.vendor.trim()} records`, scope: 'read_only' },
        { name: 'get_record', description: 'Read a single record by id', scope: 'read_only' },
      ],
    });
  },

  async disconnectServer(id: string): Promise<McpServer> {
    await delay(400);
    return serverStore.update(id, { status: 'disconnected', health: 0, latencyMs: 0, connectedAt: null });
  },

  async reconnectServer(id: string): Promise<McpServer> {
    await delay(900);
    const ts = nowIso();
    return serverStore.update(id, { status: 'connected', health: 100, latencyMs: Math.round(rand(200, 600)), connectedAt: ts, lastActivity: ts });
  },

  async testConnection(id: string): Promise<ConnectionTest> {
    const server = serverStore.get(id);
    if (!server) throw new Error('Unknown server');
    await delay(Math.min(1500, Math.max(400, server.latencyMs)));
    if (server.status === 'disconnected') return { ok: false, latencyMs: 0, message: `${server.name} is disconnected. Reconnect it first.` };
    const latencyMs = Math.round(server.latencyMs * rand(0.8, 1.25));
    const ts = nowIso();
    if (server.status === 'degraded') {
      serverStore.update(id, { latencyMs, lastActivity: ts });
      return { ok: true, latencyMs, message: `Handshake OK but slow (${latencyMs} ms). ${server.tools.length} tools listed.` };
    }
    serverStore.update(id, { latencyMs, lastActivity: ts, health: Math.min(100, +(server.health + 0.1).toFixed(1)) });
    return { ok: true, latencyMs, message: `initialize + tools/list OK in ${latencyMs} ms. ${server.tools.length} tools listed.` };
  },

  // ---- proposals
  async listProposals(q: { status?: ProposalStatus | 'all'; search?: string } = {}): Promise<McpProposal[]> {
    await delay();
    // An approved proposal whose endpoint is already registered counts as connected.
    const servers = serverStore.all();
    const rows = proposalStore.all().map((p) =>
      p.connectedServerId || p.status !== 'approved' ? p : { ...p, connectedServerId: servers.find((s) => s.endpoint === p.endpoint)?.id },
    );
    return queryList(rows, {
      search: q.search,
      searchFields: ['name', 'targetSystem', 'proposer', 'purpose', 'id'],
      filters: { status: q.status },
      sortBy: 'submittedAt',
      sortDir: 'desc',
    }).items;
  },

  async proposalCounts(): Promise<Record<ProposalStatus | 'all', number>> {
    await delay(120);
    const all = proposalStore.all();
    return {
      all: all.length,
      pending: all.filter((p) => p.status === 'pending').length,
      approved: all.filter((p) => p.status === 'approved').length,
      declined: all.filter((p) => p.status === 'declined').length,
    };
  },

  async createProposal(input: NewProposalInput): Promise<McpProposal> {
    await delay(500);
    const n = Math.max(0, ...proposalStore.all().map((p) => Number(p.id.replace(/\D/g, '')) || 0)) + 1;
    return proposalStore.insert({
      ...input,
      id: `prop-${String(n).padStart(3, '0')}`,
      proposer: CURRENT_DEVELOPER.name,
      status: 'pending',
      submittedAt: nowIso(),
      decision: null,
    });
  },

  async decideProposal(id: string, status: 'approved' | 'declined', comment: string): Promise<McpProposal> {
    await delay(400);
    return proposalStore.update(id, { status, decision: { by: CURRENT_USER.name, at: nowIso(), comment } });
  },

  /** Connects an approved proposal: adds it to the MCP servers list with the tools it proposed. */
  async connectProposal(id: string): Promise<McpServer> {
    await delay(800);
    const p = proposalStore.get(id);
    if (!p) throw new Error('Unknown proposal');
    if (p.status !== 'approved') throw new Error('Only approved proposals can be connected');
    const existing = serverStore.all().find((s) => s.id === p.connectedServerId || s.endpoint === p.endpoint);
    if (existing) {
      proposalStore.update(id, { connectedServerId: existing.id });
      throw new Error(`${existing.name} is already in the MCP servers list`);
    }
    const scope: ToolScope = p.scopes.includes('write_gated') ? 'write_gated' : (p.scopes[0] ?? 'read_only');
    const ts = nowIso();
    const server = serverStore.insert({
      id: newId('srv'),
      name: p.name,
      vendor: p.targetSystem,
      endpoint: p.endpoint,
      transport: 'Streamable HTTP',
      authType: p.authType,
      status: 'connected',
      health: 100,
      latencyMs: Math.round(rand(180, 520)),
      lastActivity: ts,
      connectedAt: ts,
      tools: p.tools.map((t) => ({ name: t, description: `Proposed in ${p.id}: ${p.purpose.slice(0, 80)}${p.purpose.length > 80 ? '…' : ''}`, scope })),
    });
    proposalStore.update(id, { connectedServerId: server.id });
    return server;
  },
};
