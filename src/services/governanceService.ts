/**
 * Governance: process orchestration (10-step journey, agents, case runs) and access
 * (accounts, identity provider, delegations, access requests).
 * Data: src/data/orchestration.json, src/data/access.json, plus the core case/user stores.
 */
import orchestrationJson from '@/data/orchestration.json';
import accessJson from '@/data/access.json';
import agentControlsJson from '@/data/agentControls.json';
import type { CaseRecord, CaseStageId, UserRecord } from '@/models/domain.model';
import type { UserRole } from '@/models/user.model';
import { caseStore, meta, userStore } from './mock/stores';
import { createCollection, delay, queryList } from './mock/mockUtils';
import { auditService } from './auditService';

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export type SpanKind = 'agent' | 'tool' | 'model' | 'audit' | 'human';
export interface SpanTemplate {
  kind: SpanKind;
  name: string;
  params: string;
}

export interface StageDefinition {
  step: number;
  label: string;
  phase: string;
  description: string;
  performerId: string;
  performerName: string;
  performerKind: AgentKind;
  systems: string[];
  owner: string;
  control: string;
  human: boolean;
  spans: SpanTemplate[];
}

export type AgentKind = 'agent' | 'service' | 'control';
export type AgentStatus = 'active' | 'paused' | 'degraded';

export interface AgentRecord {
  id: string;
  name: string;
  kind: AgentKind;
  description: string;
  steps: number[];
  systems: string[];
  scopes: string[];
  limits: string[];
  status: AgentStatus;
  owner: string;
  version: string;
  model: string | null;
  runsToday: number;
  successRate: number;
  lastRun: string;
}

type RawStage = Omit<StageDefinition, 'performerName' | 'performerKind'>;
const rawStages = orchestrationJson.stages as RawStage[];
const agentStore = createCollection<AgentRecord>(orchestrationJson.agents as AgentRecord[]);

function stageDefinitions(): StageDefinition[] {
  return rawStages.map((s) => {
    const agent = agentStore.get(s.performerId);
    // Journey labels always come from meta.json so every screen uses the same names.
    const label = meta.journey.find((j) => j.id === s.step)?.label ?? s.label;
    return { ...s, label, control: fillThresholds(s.control), performerName: agent?.name ?? s.performerId, performerKind: agent?.kind ?? 'service' };
  });
}

/* ------------------------------------------------------------------ */
/* Approval thresholds: the one source of truth                        */
/* ------------------------------------------------------------------ */

/**
 * The single set of approval value thresholds (net recovery, USD). Edited on /access/delegations;
 * read by /orchestration (step 5 control point, Approval Gate limits).
 *  - autoApproveBelow: Grade A plans below this skip manual approval.
 *  - level2Above: plans above this need a level 2 (second) sign-off.
 *  - delegationLimit: the Approver may sign off up to this value; above it, Executive sign-off.
 *    Stored as the limit of the "Decisions" delegation so the two can never disagree.
 */
export interface ApprovalThresholds {
  autoApproveBelow: number;
  level2Above: number;
  delegationLimit: number;
}
let baseThresholds = { ...(accessJson.approvalThresholds as Omit<ApprovalThresholds, 'delegationLimit'>) };
const thresholdListeners = new Set<() => void>();
export const fmtUsd = (n: number) => `$${n.toLocaleString('en-US')}`;

/**
 * Approval limits beside the value thresholds (edited on /access/delegations, "Approval limits").
 *  - plannerLimit: Planners may approve up to this value; 0 = Planners cannot approve.
 *  - allowSelfApproval: a person may approve a decision they submitted (within their limit).
 *  - maxActionsPerAgentRun / maxItemsPerBulkPlan: caps on agent runs and bulk plans.
 */
export interface ApprovalLimits {
  plannerLimit: number;
  allowSelfApproval: boolean;
  maxActionsPerAgentRun: number;
  maxItemsPerBulkPlan: number;
}
let approvalLimits: ApprovalLimits = { ...(agentControlsJson.approvalLimits as ApprovalLimits) };

/** The value thresholds plus the approval limits (the money keys are unchanged for existing callers). */
export function currentThresholds(): ApprovalThresholds & ApprovalLimits {
  return { ...baseThresholds, delegationLimit: delegationStore.get('decisions')?.limit ?? 0, ...approvalLimits };
}
function fillThresholds(text: string): string {
  const th = currentThresholds();
  return text.replace(/{(autoApproveBelow|level2Above|delegationLimit)}/g, (_, k: keyof ApprovalThresholds) => fmtUsd(th[k]));
}

export type StageRunStatus = 'completed' | 'running' | 'waiting' | 'queued' | 'failed';

/** Where a case sits in the 10-step journey (0-based index) and the state of that step. */
export function journeyPosition(c: CaseRecord): { index: number; status: Exclude<StageRunStatus, 'completed' | 'queued'> } {
  const n = Number(c.id.replace(/\D/g, '')) || 0;
  const map: Record<CaseStageId, { index: number; status: 'running' | 'waiting' | 'failed' }> = {
    awaiting_inspection: { index: 0, status: 'running' },
    needs_information: { index: 0, status: 'running' },
    reevaluate: { index: 3, status: 'running' },
    no_viable_route: { index: 3, status: 'failed' },
    ready_for_decision: { index: 3, status: 'waiting' },
    awaiting_approval: { index: 4, status: 'waiting' },
    approved: { index: 5, status: 'running' },
    handed_off: { index: 6 + (n % 3), status: 'running' },
  };
  return map[c.stage];
}

export interface CaseOption {
  id: string;
  productName: string;
  stage: CaseStageId;
  tenant: string;
  location: string;
}

export interface RunSpan {
  id: string;
  step: number;
  kind: SpanKind;
  name: string;
  performer: string;
  params: string;
  at: string;
  durationMs: number;
  status: 'ok' | 'running' | 'waiting' | 'failed';
}

export interface RunStage {
  step: number;
  label: string;
  performer: string;
  finalStatus: StageRunStatus;
}

export interface CaseRun {
  runId: string;
  caseRecord: CaseRecord;
  currentIndex: number;
  currentStatus: 'running' | 'waiting' | 'failed';
  startedAt: string;
  stages: RunStage[];
  spans: RunSpan[];
}

const hashNum = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
};

const routeNames = Object.fromEntries(meta.routes.map((r) => [r.id, r.name]));

function fillParams(tpl: string, c: CaseRecord) {
  const vars: Record<string, string> = {
    caseId: c.id,
    assetTag: c.assetTag,
    model: `${c.manufacturer} ${c.model}`,
    tenant: c.tenant,
    bin: c.facts.wmsBinLocation,
    productClass: c.productClass,
    condition: c.condition,
    location: c.location,
    route: routeNames[c.recommendedRoute] ?? c.recommendedRoute,
    serial: c.serialNumber,
  };
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? k);
}

function buildRun(c: CaseRecord): CaseRun {
  const stages = stageDefinitions();
  const pos = journeyPosition(c);
  const start = new Date(`${c.receivedDate}T08:00:00Z`).getTime();
  const end = new Date(meta.asOf).getTime() - 20 * 60 * 1000;
  const stageGap = Math.max(30 * 60 * 1000, (end - start) / (pos.index + 1));
  const spans: RunSpan[] = [];
  stages.forEach((s, i) => {
    if (i > pos.index) return;
    let templates = s.spans;
    const isCurrent = i === pos.index;
    if (isCurrent) {
      if (pos.status === 'waiting') templates = s.spans.slice(0, 1);
      else if (pos.status === 'failed') templates = s.spans.slice(0, 2);
      else templates = s.spans.slice(0, Math.max(1, Math.ceil(s.spans.length / 2)));
    }
    let t = start + i * stageGap;
    templates.forEach((tpl, j) => {
      const h = hashNum(`${c.id}-${s.step}-${j}`);
      const durationMs = tpl.kind === 'human' ? 0 : tpl.kind === 'model' ? 800 + (h % 2400) : tpl.kind === 'audit' ? 40 + (h % 60) : 200 + (h % 1500);
      const last = isCurrent && j === templates.length - 1;
      const performer =
        tpl.kind === 'audit'
          ? 'Audit Ledger Writer'
          : tpl.kind === 'human'
            ? `${userStore.all().find((u) => u.role === 'Approver')?.name ?? 'Approver'} (Approver)`
            : s.performerName;
      spans.push({
        id: `sp-${(h % 0xffffff).toString(16).padStart(6, '0')}`,
        step: s.step,
        kind: tpl.kind,
        name: tpl.name,
        performer,
        params: fillParams(tpl.params, c),
        at: new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        durationMs,
        status: last ? (pos.status === 'running' ? 'running' : pos.status === 'waiting' ? 'waiting' : 'failed') : 'ok',
      });
      t += 1500 + (h % 9000);
    });
  });
  return {
    runId: `run-${c.id.toLowerCase()}`,
    caseRecord: c,
    currentIndex: pos.index,
    currentStatus: pos.status,
    startedAt: new Date(start).toISOString(),
    stages: stages.map((s, i) => ({
      step: s.step,
      label: s.label,
      performer: s.performerName,
      finalStatus: i < pos.index ? 'completed' : i === pos.index ? pos.status : 'queued',
    })),
    spans,
  };
}

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

export type AccountStatus = 'active' | 'suspended';
export interface AccountRecord extends UserRecord {
  status: AccountStatus;
  lastSignIn: string | null;
  mfa: boolean;
}

const accountMeta = accessJson.accountMeta as Record<string, { status: AccountStatus; lastSignIn: string; mfa: boolean }>;
const accountStore = createCollection<AccountRecord>(
  userStore.all().map((u) => ({ ...u, ...(accountMeta[u.id] ?? { status: 'active', lastSignIn: null, mfa: false }) })),
);

export interface IdpConnection {
  provider: string;
  domain: string;
  protocol: string;
  lastSync: string;
  status: 'connected' | 'syncing' | 'error';
  interval: string;
  lastResult: string;
}
let idp: IdpConnection = { ...(accessJson.idp as IdpConnection) };
const idpListeners = new Set<() => void>();
const emitIdp = () => idpListeners.forEach((l) => l());

export interface GroupMapping {
  id: string;
  group: string;
  objectId: string;
  role: UserRole;
  tenant: string;
  site: string;
}
const mappingStore = createCollection<GroupMapping>(accessJson.groupMappings as GroupMapping[]);

export interface IdpUser {
  id: string;
  name: string;
  email: string;
  group: string;
  department: string;
  idpStatus: 'active' | 'disabled';
}
const idpUserStore = createCollection<IdpUser>(accessJson.idpUsers as IdpUser[]);

export type MatchStatus = 'matched' | 'role_mismatch' | 'not_provisioned' | 'disabled_in_idp' | 'unmapped_group';
export interface IdpUserRow extends IdpUser {
  match: MatchStatus;
  accountId: string | null;
  accountRole: UserRole | null;
  mappedRole: UserRole | null;
}

/**
 * One person in the directory: a Circularity account, its IdP user, or both, matched by email.
 * Each person appears once, so the Users table can show account and IdP match side by side.
 */
export interface DirectoryRow {
  id: string;
  name: string;
  email: string;
  account: AccountRecord | null;
  idpUser: IdpUserRow | null;
  /** IdP match status; `no_idp` when the account has no IdP user. */
  match: MatchStatus | 'no_idp';
}

export interface DelegationSetting {
  id: 'decisions' | 'mcp' | 'tenant';
  label: string;
  description: string;
  enabled: boolean;
  scope: string;
  limit: number;
  limitLabel: string;
}
const delegationStore = createCollection<DelegationSetting>(accessJson.delegationSettings as DelegationSetting[]);

export interface CoverRecord {
  id: string;
  approverId: string;
  delegateId: string;
  from: string;
  to: string;
  scope: string;
  reason: string;
}
const coverStore = createCollection<CoverRecord>(accessJson.covers as CoverRecord[]);

export interface ChangeLogEntry {
  id: string;
  at: string;
  actor: string;
  change: string;
}
const changeLogStore = createCollection<ChangeLogEntry>(accessJson.changeLog as ChangeLogEntry[]);

export type RequestType = 'tenant' | 'mcp';
export type RequestStatus = 'pending' | 'approved' | 'declined';
export interface AccessRequest {
  id: string;
  type: RequestType;
  requesterId: string;
  target: string;
  detail: string;
  justification: string;
  requestedAt: string;
  status: RequestStatus;
  risk: 'low' | 'medium' | 'high';
  decidedBy?: string;
  decidedAt?: string;
  comment?: string;
  /** Tenant requests made from the header: how long the grant lasts once approved. */
  duration?: TenantGrantDuration;
  /** Set when a time-boxed tenant request is approved; null = no expiry (session or standing grant). */
  expiresAt?: string | null;
}
export type TenantGrantDuration = 'session' | '7d' | '30d';
export const GRANT_DURATION_LABEL: Record<TenantGrantDuration, string> = { session: 'This session', '7d': '7 days', '30d': '30 days' };
const GRANT_DAYS: Record<TenantGrantDuration, number | null> = { session: null, '7d': 7, '30d': 30 };
const requestStore = createCollection<AccessRequest>(accessJson.requests as AccessRequest[]);
export interface AccessRequestRow extends AccessRequest {
  requesterName: string;
  requesterRole: string;
}

export interface Actor {
  id: string;
  name: string;
  role: string;
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const userName = (id: string) => accountStore.get(id)?.name ?? userStore.get(id)?.name ?? id;

/** Delegation and threshold changes: kept in the change log and written to the audit log as access changes. */
function logChange(actor: Actor, change: string) {
  changeLogStore.insert({ id: `cl-${Date.now()}-${Math.round(Math.random() * 1e4)}`, at: nowIso(), actor: actor.name, change });
  auditAccess(actor, 'Delegations', change, change, 'Decision Workbench', 'Delegations');
}

function auditAccess(actor: Actor, entity: string, action: string, payload: string, source = 'Identity provider', sourceRef = 'Access & governance') {
  auditService.record({
    caseId: null,
    tenant: null,
    entity,
    action,
    actionType: 'access',
    actorType: 'user',
    actorId: actor.id,
    actorName: `${actor.name} (${actor.role})`,
    source,
    sourceRef,
    payloadSummary: payload,
    journeyStep: null,
  });
}

function idpRows(): IdpUserRow[] {
  return idpUserStore.all().map((u) => {
    const account = accountStore.all().find((a) => a.email.toLowerCase() === u.email.toLowerCase());
    const mapping = mappingStore.all().find((m) => m.group === u.group);
    let match: MatchStatus = 'matched';
    if (u.idpStatus === 'disabled') match = 'disabled_in_idp';
    else if (!mapping) match = 'unmapped_group';
    else if (!account) match = 'not_provisioned';
    else if (account.role !== mapping.role) match = 'role_mismatch';
    return { ...u, match, accountId: account?.id ?? null, accountRole: account?.role ?? null, mappedRole: mapping?.role ?? null };
  });
}

function idpResultLine() {
  const rows = idpRows();
  const np = rows.filter((r) => r.match === 'not_provisioned').length;
  const mm = rows.filter((r) => r.match === 'role_mismatch').length;
  return `${rows.length} users read, ${np} not provisioned, ${mm} role mismatch${mm === 1 ? '' : 'es'}`;
}

/* ------------------------------------------------------------------ */

export const governanceService = {
  /* --- Orchestration --- */
  async listStages(): Promise<StageDefinition[]> {
    await delay(180);
    return stageDefinitions();
  },

  async caseOptions(): Promise<CaseOption[]> {
    await delay(150);
    return caseStore
      .all()
      .map((c) => ({ id: c.id, productName: c.productName, stage: c.stage, tenant: c.tenant, location: c.location }))
      .sort((a, b) => a.id.localeCompare(b.id));
  },

  async getRun(caseId: string): Promise<CaseRun | undefined> {
    await delay();
    const c = caseStore.get(caseId);
    return c ? buildRun(c) : undefined;
  },

  subscribeAgents: agentStore.subscribe,
  async listAgents(q: { search?: string; kind?: AgentKind | 'all'; status?: AgentStatus | 'all'; step?: number | 'all' } = {}): Promise<AgentRecord[]> {
    await delay();
    return queryList(agentStore.all(), {
      search: q.search,
      searchFields: ['name', 'description', 'owner', (a) => a.systems.join(' '), (a) => a.scopes.join(' ')],
      filters: { kind: q.kind, status: q.status },
      predicate: q.step && q.step !== 'all' ? (a) => a.steps.includes(Number(q.step)) : undefined,
      sortBy: (a) => Math.min(...a.steps) * 100 + a.steps.length,
      sortDir: 'asc',
    }).items.map((a) => ({ ...a, limits: a.limits.map(fillThresholds) }));
  },
  async setAgentStatus(id: string, status: AgentStatus, actor: Actor): Promise<AgentRecord> {
    await delay(300);
    const updated = agentStore.update(id, { status });
    auditAccess(actor, `Agent · ${updated.name}`, `Agent ${status === 'paused' ? 'paused' : 'resumed'}: ${updated.name}`, `Status set to ${status}`, 'Decision Workbench', 'Agents & services');
    return updated;
  },

  /* --- Accounts --- */
  subscribeAccounts: accountStore.subscribe,
  async listAccounts(q: { search?: string; role?: UserRole | 'all' } = {}): Promise<AccountRecord[]> {
    await delay();
    return queryList(accountStore.all(), {
      search: q.search,
      searchFields: ['name', 'email', 'tenant', 'site', 'role'],
      filters: { role: q.role },
      sortBy: 'name',
      sortDir: 'asc',
    }).items;
  },
  async updateAccount(id: string, patch: Pick<AccountRecord, 'role' | 'tenant' | 'site'> & { status?: AccountStatus }, actor: Actor): Promise<AccountRecord> {
    await delay(350);
    const before = accountStore.get(id);
    if (!before) throw new Error(`Account ${id} not found`);
    const updated = accountStore.update(id, patch);
    const changes = (['role', 'tenant', 'site', 'status'] as const)
      .filter((k) => patch[k] !== undefined && before[k] !== updated[k])
      .map((k) => `${k} ${before[k]} → ${updated[k]}`);
    if (changes.length) auditAccess(actor, `User · ${updated.name}`, `Account updated: ${updated.name}`, changes.join('; '));
    return updated;
  },
  /** Accounts and IdP users merged by email, one row per person, sorted by name. */
  async listDirectory(q: { search?: string; role?: UserRole | 'all'; match?: MatchStatus | 'no_idp' | 'issues' | 'all' } = {}): Promise<DirectoryRow[]> {
    await delay();
    const idp = idpRows();
    const accounts = accountStore.all();
    const rows: DirectoryRow[] = accounts.map((a) => {
      const u = idp.find((r) => r.email.toLowerCase() === a.email.toLowerCase()) ?? null;
      return { id: a.id, name: a.name, email: a.email, account: a, idpUser: u, match: u ? u.match : 'no_idp' };
    });
    idp
      .filter((u) => !accounts.some((a) => a.email.toLowerCase() === u.email.toLowerCase()))
      .forEach((u) => rows.push({ id: u.id, name: u.name, email: u.email, account: null, idpUser: u, match: u.match }));
    const s = q.search?.trim().toLowerCase();
    return rows
      .filter((r) => !q.role || q.role === 'all' || r.account?.role === q.role)
      .filter((r) => !q.match || q.match === 'all' || (q.match === 'issues' ? r.match !== 'matched' && r.match !== 'no_idp' : r.match === q.match))
      .filter(
        (r) =>
          !s ||
          [r.name, r.email, r.account?.tenant, r.account?.site, r.account?.role, r.idpUser?.group, r.idpUser?.department]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(s),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  accessOptions: () => ({ tenants: ['All', ...meta.tenants], sites: [...meta.sites, 'Head office'] }),

  /* --- Identity provider --- */
  subscribeIdentity(listener: () => void) {
    idpListeners.add(listener);
    const offs = [mappingStore.subscribe(listener), idpUserStore.subscribe(listener), accountStore.subscribe(listener)];
    return () => {
      idpListeners.delete(listener);
      offs.forEach((o) => o());
    };
  },
  async getIdentity(): Promise<{ idp: IdpConnection; mappings: GroupMapping[]; users: IdpUserRow[] }> {
    await delay();
    return { idp: { ...idp }, mappings: mappingStore.all(), users: idpRows() };
  },
  async syncIdp(actor: Actor): Promise<IdpConnection> {
    idp = { ...idp, status: 'syncing' };
    emitIdp();
    await delay(1400);
    idp = { ...idp, status: 'connected', lastSync: nowIso(), lastResult: idpResultLine() };
    emitIdp();
    auditAccess(actor, `IdP · ${idp.domain}`, 'Identity provider sync completed', idp.lastResult, 'Identity provider', `${idp.provider} · SCIM`);
    return idp;
  },
  async updateMapping(id: string, patch: Partial<Omit<GroupMapping, 'id'>>, actor: Actor): Promise<GroupMapping> {
    await delay(250);
    const before = mappingStore.get(id);
    const updated = mappingStore.update(id, patch);
    auditAccess(actor, `IdP group · ${updated.group}`, 'Group mapping changed', `${before?.role}/${before?.tenant}/${before?.site} → ${updated.role}/${updated.tenant}/${updated.site}`);
    return updated;
  },
  async addMapping(m: Omit<GroupMapping, 'id' | 'objectId'>, actor: Actor): Promise<GroupMapping> {
    await delay(250);
    const h = hashNum(m.group).toString(16).padStart(8, '0');
    const created = mappingStore.insert({ ...m, id: `gm-${Date.now()}`, objectId: `${h.slice(0, 4)}…${h.slice(-4)}` });
    auditAccess(actor, `IdP group · ${m.group}`, 'Group mapping added', `${m.group} → ${m.role} (${m.tenant}, ${m.site})`);
    return created;
  },
  async removeMapping(id: string, actor: Actor): Promise<void> {
    await delay(250);
    const m = mappingStore.get(id);
    mappingStore.remove(id);
    if (m) auditAccess(actor, `IdP group · ${m.group}`, 'Group mapping removed', `${m.group} no longer maps to ${m.role}`);
  },
  /** Fixes an IdP user: provisions an account, applies the mapped role, or suspends a disabled user. */
  async resolveIdpUser(idpUserId: string, actor: Actor): Promise<string> {
    await delay(350);
    const row = idpRows().find((r) => r.id === idpUserId);
    if (!row) throw new Error('User not found');
    const mapping = mappingStore.all().find((m) => m.group === row.group);
    if (row.match === 'not_provisioned' && mapping) {
      accountStore.insert({ id: `u-idp-${row.id}`, name: row.name, email: row.email, role: mapping.role, tenant: mapping.tenant, site: mapping.site, status: 'active', lastSignIn: null, mfa: true });
      auditAccess(actor, `User · ${row.name}`, 'Account provisioned from IdP', `${mapping.role}, ${mapping.tenant}, ${mapping.site}`);
      return `${row.name} provisioned as ${mapping.role}`;
    }
    if (row.match === 'role_mismatch' && mapping && row.accountId) {
      const before = accountStore.get(row.accountId);
      accountStore.update(row.accountId, { role: mapping.role, tenant: mapping.tenant, site: mapping.site });
      auditAccess(actor, `User · ${row.name}`, 'Role aligned to IdP group', `${before?.role} → ${mapping.role}`);
      return `${row.name} now has the ${mapping.role} role`;
    }
    if (row.match === 'disabled_in_idp' && row.accountId) {
      accountStore.update(row.accountId, { status: 'suspended' });
      auditAccess(actor, `User · ${row.name}`, 'Account suspended (disabled in IdP)', row.email);
      return `${row.name} suspended`;
    }
    return 'Nothing to change';
  },

  /* --- Approval thresholds --- */
  subscribeThresholds(listener: () => void) {
    thresholdListeners.add(listener);
    const off = delegationStore.subscribe(listener);
    return () => {
      thresholdListeners.delete(listener);
      off();
    };
  },
  async getApprovalThresholds(): Promise<ApprovalThresholds> {
    await delay(120);
    return currentThresholds();
  },
  async updateApprovalThresholds(patch: Partial<ApprovalThresholds>, actor: Actor): Promise<ApprovalThresholds> {
    await delay(250);
    const before = currentThresholds();
    const next = { ...before, ...patch };
    if (!(next.autoApproveBelow >= 0 && next.autoApproveBelow <= next.level2Above && next.level2Above <= next.delegationLimit)) {
      throw new Error(`Thresholds must rise: auto-approve (${fmtUsd(next.autoApproveBelow)}) ≤ level 2 (${fmtUsd(next.level2Above)}) ≤ delegation limit (${fmtUsd(next.delegationLimit)})`);
    }
    const labels: Record<keyof ApprovalThresholds, string> = { autoApproveBelow: 'Auto-approval threshold', level2Above: 'Level 2 sign-off threshold', delegationLimit: 'Approver delegation limit' };
    (Object.keys(labels) as (keyof ApprovalThresholds)[]).forEach((k) => {
      if (next[k] === before[k]) return;
      logChange(actor, `${labels[k]} changed from ${fmtUsd(before[k])} to ${fmtUsd(next[k])}`);
    });
    baseThresholds = { autoApproveBelow: next.autoApproveBelow, level2Above: next.level2Above };
    if (next.delegationLimit !== before.delegationLimit) delegationStore.update('decisions', { limit: next.delegationLimit });
    thresholdListeners.forEach((l) => l());
    agentStore.update('approval-gate', {}); // re-render agent lists that show the thresholds
    return currentThresholds();
  },

  /* --- Approval limits (Planner limit, self-approval, agent run and bulk plan caps) --- */
  async getApprovalLimits(): Promise<ApprovalLimits & { approverLimit: number }> {
    await delay(120);
    return { ...approvalLimits, approverLimit: currentThresholds().delegationLimit };
  },
  async updateApprovalLimits(patch: Partial<ApprovalLimits>, actor: Actor): Promise<ApprovalLimits> {
    await delay(250);
    const before = approvalLimits;
    const next = { ...before, ...patch };
    const approverLimit = currentThresholds().delegationLimit;
    if (!(next.plannerLimit >= 0)) throw new Error('The Planner approval limit cannot be negative');
    if (next.plannerLimit > approverLimit) throw new Error(`The Planner limit (${fmtUsd(next.plannerLimit)}) cannot exceed the Approver delegation limit (${fmtUsd(approverLimit)})`);
    if (!(Number.isInteger(next.maxActionsPerAgentRun) && next.maxActionsPerAgentRun >= 1)) throw new Error('Max actions per agent run must be at least 1');
    if (!(Number.isInteger(next.maxItemsPerBulkPlan) && next.maxItemsPerBulkPlan >= 1)) throw new Error('Max items per bulk plan must be at least 1');
    const changes: string[] = [];
    if (next.plannerLimit !== before.plannerLimit)
      changes.push(`Planner approval limit changed from ${fmtUsd(before.plannerLimit)} to ${fmtUsd(next.plannerLimit)}${next.plannerLimit === 0 ? ' (Planners cannot approve)' : ''}`);
    if (next.allowSelfApproval !== before.allowSelfApproval)
      changes.push(`Approving a decision you submitted ${next.allowSelfApproval ? 'allowed (within the person’s limit)' : 'no longer allowed'}`);
    if (next.maxActionsPerAgentRun !== before.maxActionsPerAgentRun) changes.push(`Max actions per agent run changed from ${before.maxActionsPerAgentRun} to ${next.maxActionsPerAgentRun}`);
    if (next.maxItemsPerBulkPlan !== before.maxItemsPerBulkPlan) changes.push(`Max items per bulk plan changed from ${before.maxItemsPerBulkPlan} to ${next.maxItemsPerBulkPlan}`);
    approvalLimits = next;
    changes.forEach((c) => logChange(actor, c));
    if (changes.length) thresholdListeners.forEach((l) => l());
    return { ...approvalLimits };
  },

  /* --- Delegations --- */
  subscribeDelegations(listener: () => void) {
    const offs = [delegationStore.subscribe(listener), coverStore.subscribe(listener), changeLogStore.subscribe(listener)];
    return () => offs.forEach((o) => o());
  },
  async getDelegations(): Promise<{ settings: DelegationSetting[]; covers: (CoverRecord & { approverName: string; delegateName: string; state: 'active' | 'scheduled' | 'expired' })[]; log: ChangeLogEntry[] }> {
    await delay();
    const today = meta.asOf.slice(0, 10);
    return {
      settings: delegationStore.all(),
      covers: coverStore
        .all()
        .map((c) => ({
          ...c,
          approverName: userName(c.approverId),
          delegateName: userName(c.delegateId),
          state: (c.to < today ? 'expired' : c.from > today ? 'scheduled' : 'active') as 'active' | 'scheduled' | 'expired',
        }))
        .sort((a, b) => (a.from < b.from ? 1 : -1)),
      log: [...changeLogStore.all()].sort((a, b) => (a.at < b.at ? 1 : -1)),
    };
  },
  async updateDelegation(id: DelegationSetting['id'], patch: Partial<Pick<DelegationSetting, 'enabled' | 'scope' | 'limit'>>, actor: Actor): Promise<DelegationSetting> {
    await delay(250);
    const before = delegationStore.get(id);
    if (!before) throw new Error('Delegation not found');
    const updated = delegationStore.update(id, patch);
    const parts: string[] = [];
    if (patch.enabled !== undefined && patch.enabled !== before.enabled) parts.push(`${updated.label} delegation turned ${updated.enabled ? 'on' : 'off'}`);
    if (patch.scope !== undefined && patch.scope !== before.scope) parts.push(`${updated.label} scope changed from ${before.scope} to ${updated.scope}`);
    if (patch.limit !== undefined && patch.limit !== before.limit) parts.push(`${updated.label}: ${updated.limitLabel.toLowerCase()} changed from ${before.limit.toLocaleString('en-US')} to ${updated.limit.toLocaleString('en-US')}`);
    parts.forEach((p) => logChange(actor, p));
    return updated;
  },
  async createCover(c: Omit<CoverRecord, 'id'>, actor: Actor): Promise<CoverRecord> {
    await delay(300);
    const created = coverStore.insert({ ...c, id: `cv-${Date.now()}` });
    logChange(actor, `Out-of-office cover created: ${userName(c.approverId)} to ${userName(c.delegateId)}, ${fmtDate(c.from)} – ${fmtDate(c.to)} (${c.scope})`);
    return created;
  },
  async deleteCover(id: string, actor: Actor): Promise<void> {
    await delay(250);
    const c = coverStore.get(id);
    coverStore.remove(id);
    if (c) logChange(actor, `Out-of-office cover deleted: ${userName(c.approverId)} to ${userName(c.delegateId)}, ${fmtDate(c.from)} – ${fmtDate(c.to)}`);
  },
  delegateCandidates: () => accountStore.all().filter((a) => a.status === 'active'),

  /* --- Access requests --- */
  subscribeRequests: requestStore.subscribe,
  async listRequests(q: { search?: string; type?: RequestType | 'all'; status?: RequestStatus | 'all' } = {}): Promise<{ items: AccessRequestRow[]; counts: Record<RequestStatus, number> }> {
    await delay();
    const rows: AccessRequestRow[] = requestStore.all().map((r) => ({
      ...r,
      requesterName: userName(r.requesterId),
      requesterRole: accountStore.get(r.requesterId)?.role ?? '',
    }));
    // Counts follow the type filter, so a tenant-only queue does not count MCP proposals.
    const counts = { pending: 0, approved: 0, declined: 0 } as Record<RequestStatus, number>;
    rows.filter((r) => !q.type || q.type === 'all' || r.type === q.type).forEach((r) => (counts[r.status] += 1));
    const items = queryList(rows, {
      search: q.search,
      searchFields: ['id', 'target', 'detail', 'justification', 'requesterName'],
      filters: { type: q.type, status: q.status },
      sortBy: (r) => `${r.status === 'pending' ? 1 : 0}${r.requestedAt}`,
      sortDir: 'desc',
    }).items;
    return { items, counts };
  },
  async decideRequest(id: string, decision: 'approved' | 'declined', comment: string, actor: Actor): Promise<AccessRequest> {
    await delay(350);
    const decidedAt = nowIso();
    const before = requestStore.get(id);
    const days = before?.type === 'tenant' && before.duration ? GRANT_DAYS[before.duration] : null;
    const expiresAt = decision === 'approved' && days ? new Date(Date.parse(decidedAt) + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
    const updated = requestStore.update(id, { status: decision, comment, decidedBy: actor.name, decidedAt, ...(before?.duration ? { expiresAt } : {}) });
    auditAccess(
      actor,
      updated.type === 'mcp' ? `MCP · ${updated.target}` : `Tenant · ${updated.target}`,
      `${updated.type === 'mcp' ? 'MCP server proposal' : 'Tenant access request'} ${decision}: ${updated.target}`,
      `${updated.id} for ${userName(updated.requesterId)}${updated.duration && decision === 'approved' ? ` · ${GRANT_DURATION_LABEL[updated.duration]}${updated.expiresAt ? ` (until ${updated.expiresAt.slice(0, 10)})` : ''}` : ''}${comment ? `. Comment: ${comment}` : ''}`,
      updated.type === 'mcp' ? 'MCP gateway' : 'Identity provider',
      updated.id,
    );
    return updated;
  },
  /* --- Tenant access (header tenant selector) --- */
  requestsVersion: () => requestStore.version(),
  /** Tenant requests raised by one user, newest first (synchronous; for the request modal and the selector). */
  tenantRequestsFor(userId: string): AccessRequest[] {
    return requestStore
      .all()
      .filter((r) => r.type === 'tenant' && r.requesterId === userId)
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  },
  /** Tenants granted to a user by approved requests that have not expired at `nowMs`. */
  activeTenantGrants(userId: string, nowMs: number): AccessRequest[] {
    return requestStore
      .all()
      .filter((r) => r.type === 'tenant' && r.requesterId === userId && r.status === 'approved' && (!r.expiresAt || Date.parse(r.expiresAt) > nowMs));
  },
  /** Raises a pending tenant access request (shows in the Tenant access queue) and audits it. */
  async requestTenantAccess(input: { tenant: string; reason: string; duration: TenantGrantDuration; site?: string }, actor: Actor): Promise<AccessRequest> {
    await delay(300);
    const reason = input.reason.trim();
    if (!reason) throw new Error('Add a reason for the request');
    if (requestStore.all().some((r) => r.type === 'tenant' && r.requesterId === actor.id && r.target === input.tenant && r.status === 'pending')) {
      throw new Error(`You already have a pending request for ${input.tenant}`);
    }
    const maxNo = Math.max(2000, ...requestStore.all().filter((r) => r.id.startsWith('AR-')).map((r) => Number(r.id.slice(3)) || 0));
    const created = requestStore.insert({
      id: `AR-${maxNo + 1}`,
      type: 'tenant',
      requesterId: actor.id,
      target: input.tenant,
      detail: `Read and write on cases${input.site ? `, ${input.site}` : ''} · ${GRANT_DURATION_LABEL[input.duration]}`,
      justification: reason,
      requestedAt: nowIso(),
      status: 'pending',
      risk: input.duration === '30d' ? 'medium' : 'low',
      duration: input.duration,
      expiresAt: null,
    });
    auditAccess(actor, `Tenant · ${input.tenant}`, `Tenant access requested: ${input.tenant}`, `${created.id} by ${userName(actor.id)} · ${GRANT_DURATION_LABEL[input.duration]}. Reason: ${reason}`, 'Decision Workbench', created.id);
    return created;
  },
};
