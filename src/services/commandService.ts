/**
 * Command Center work queues that are not covered by the core services:
 * approval context, hand-off instructions, outcomes to confirm, prioritisation
 * scores and inbound shipments. Everything joins back to the shared case store
 * (src/data/cases.json), so counts agree with Key Figures and the case pages.
 */
import approvalsJson from '@/data/commandApprovals.json';
import handoffsJson from '@/data/commandHandoffs.json';
import outcomesJson from '@/data/commandOutcomes.json';
import inboundJson from '@/data/commandInbound.json';
import type { CapacityRecord, CaseRecord, Priority, TaskRecord } from '@/models/domain.model';
import type { UserRole } from '@/models/user.model';
import type { RouteProposal } from '@/models/decision.model';
import { capacity, caseStore, exceptionStore, meta, taskStore, userStore } from './mock/stores';
import { createCollection, delay, queryList, sum } from './mock/mockUtils';
import { scopeCases } from './caseService';
import { decide, handoffInstructions, handoffStage, realisedNetFor } from './decisionService';
import type { HandoffInstruction } from '@/models/decision.model';
import { taskService } from './taskService';
import { exceptionService } from './exceptionService';
import { currentThresholds } from './governanceService';

type Scope = { tenant?: string; site?: string };

const DAY = 864e5;
const asOfDate = () => new Date(meta.asOf);
const daysBetween = (fromIso: string, to: Date = asOfDate()) => Math.max(0, Math.floor((to.getTime() - new Date(fromIso).getTime()) / DAY));

/* ------------------------------------------------------------------ approvals */

export type ApprovalTier = 'Level 1' | 'Level 2' | 'Executive';

interface ApprovalMeta {
  id: string;
  submittedAt: string;
  confidence: number;
  trigger: string;
  note?: string;
}

export interface ApprovalRow {
  case: CaseRecord;
  id: string;
  submittedAt: string;
  submittedBy: string;
  waitingDays: number;
  confidence: number;
  trigger: string;
  tier: ApprovalTier;
  /** Route sent for approval by a Planner / Engineer / Warehouse Manager (decisionService.proposeRoute). */
  proposal: RouteProposal | null;
  /** Net value of the proposed route when it differs from Circularity's (else null). */
  proposedNet: number | null;
}

/**
 * Approval tier from the shared thresholds (edited on Access → Delegations; governanceService).
 * Executive = above the Approver's delegation limit: an Approver cannot sign it off (caseLifecycleService
 * enforces it and offers "Escalate to Executive"); Level 1 / Level 2 are signed off by an Approver.
 */
export const tierFor = (value: number): ApprovalTier => {
  const t = currentThresholds();
  return value > t.delegationLimit ? 'Executive' : value > t.level2Above ? 'Level 2' : 'Level 1';
};

const usdK = (n: number) => (n >= 1000 && n % 1000 === 0 ? `$${n / 1000}k` : n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`);

/** Tier filter labels with the live thresholds, e.g. "Level 2 ($5k–$25k)". */
export function tierLabels(): Record<ApprovalTier, string> {
  const t = currentThresholds();
  return {
    'Level 1': `Level 1 (up to ${usdK(t.level2Above)})`,
    'Level 2': `Level 2 (${usdK(t.level2Above)}–${usdK(t.delegationLimit)})`,
    Executive: `Executive (above ${usdK(t.delegationLimit)})`,
  };
}

const approvalStore = createCollection<ApprovalMeta>(approvalsJson as ApprovalMeta[]);

/* ------------------------------------------------------------------ hand-offs */

export type HandoffStatus = 'staged' | 'in_transit' | 'refurbishing' | 'delivered';

interface HandoffRecord {
  id: string;
  instructionId: string | null;
  system: string;
  destination: string;
  carrier: string | null;
  trackingRef: string | null;
  sentAt: string | null;
  targetDate: string;
  status: HandoffStatus;
}

export interface HandoffRow extends HandoffRecord {
  case: CaseRecord;
  overdue: boolean;
  /** The instruction steps behind the row (decisionService.handoffInstructions, same as the Case page). */
  steps: HandoffInstruction[];
  done: number;
  /** First step that is not done yet (null when delivered or nothing sent). */
  next: HandoffInstruction | null;
}

const handoffStore = createCollection<HandoffRecord>(handoffsJson as HandoffRecord[]);

/* ------------------------------------------------------------------- outcomes */

export type OutcomeStatus = 'pending_invoice' | 'confirmed' | 'reconciled';

interface OutcomeRecord {
  id: string;
  predicted: number;
  actual: number;
  evidenceDoc: string;
  erpRef: string;
  reportedAt: string;
  status: OutcomeStatus;
  /** Cost lines of the approved route (created in this session from the decision). */
  costLines?: { label: string; amount: number }[];
  /** Approval reference and evidence snapshot the outcome closes. */
  approvalRef?: string;
  snapshotId?: string;
  /** Decision history record written when the outcome was reconciled (learning). */
  historyId?: string;
}

export interface OutcomeRow extends OutcomeRecord {
  case: CaseRecord;
  variance: number;
}

const outcomeStore = createCollection<OutcomeRecord>(outcomesJson as OutcomeRecord[]);

/** Settlement document by route (what the executing system reports the realised value on). */
const EVIDENCE_DOC: Record<string, string> = {
  redeploy: 'Internal transfer confirmation',
  relase: 'Lease schedule activation',
  resale: 'Remarketing settlement statement',
  intparts: 'Parts goods receipt',
  extparts: 'Parts marketplace settlement',
  material: 'Certified recycler weight slip',
  exit: 'Certificate of destruction',
};

/*
 * Seeded consistency: a case delivered before this session without an outcome row closed its outcome
 * earlier (reconciled), so "delivered ⇔ outcome row exists" holds for every case.
 */
let seededClosed = false;
/** The reconciled outcome a seeded delivered case would have; null when it has none. Pure: writes nothing. */
function seededOutcomeFor(id: string): OutcomeRecord | null {
  const h = (handoffsJson as HandoffRecord[]).find((x) => x.id === id);
  if (!h || h.status !== 'delivered') return null;
  const c = caseStore.get(h.id);
  if (!c) return null;
  const predicted = c.estimatedNetRecovery;
  return {
    id: h.id,
    predicted,
    actual: realisedNetFor(h.id, predicted),
    evidenceDoc: EVIDENCE_DOC[c.recommendedRoute] ?? 'Settlement statement',
    erpRef: `SAP-FI-${1400 + (Number(h.id.replace(/\D/g, '')) % 600)}`,
    reportedAt: h.targetDate,
    status: 'reconciled',
  };
}
/** Writes the seeded rows into the store. Only from async calls and actions, never during a render. */
function ensureSeededOutcomes() {
  if (seededClosed) return;
  seededClosed = true;
  for (const h of handoffsJson as HandoffRecord[]) {
    if (outcomeStore.get(h.id)) continue;
    const row = seededOutcomeFor(h.id);
    if (row) outcomeStore.insert(row);
  }
}

/* ------------------------------------------------------------------- priority */

export interface PriorityRow {
  case: CaseRecord;
  id: string;
  score: number;
  driver: string;
  decayPerDay: number;
}

const PRIORITY_POINTS: Record<Priority, number> = { high: 15, medium: 8, low: 0 };
const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** "Due today", "Due in 3 days", "2 days overdue". */
export const dueText = (days: number) => (days < 0 ? `${plural(-days, 'day')} overdue` : days === 0 ? 'Due today' : `Due in ${plural(days, 'day')}`);

function scoreCases(cases: CaseRecord[]): PriorityRow[] {
  const maxRisk = Math.max(1, ...cases.map((c) => c.valueAtRisk));
  const maxValue = Math.max(1, ...cases.map((c) => c.estimatedNetRecovery));
  return cases.map((c) => {
    const parts = [
      { pts: Math.max(0, 1 - c.dueInDays / 30) * 40, why: dueText(c.dueInDays) },
      { pts: (c.valueAtRisk / maxRisk) * 25, why: `${fmtUsd(c.valueAtRisk)} at risk${c.riskReason ? ` (${meta.riskReasons.find((r) => r.id === c.riskReason)?.label.toLowerCase()})` : ''}` },
      { pts: (c.estimatedNetRecovery / maxValue) * 20, why: `${fmtUsd(c.estimatedNetRecovery)} predicted net recovery` },
      { pts: PRIORITY_POINTS[c.priority], why: `${c.priority[0].toUpperCase()}${c.priority.slice(1)} priority case` },
    ];
    const top = [...parts].sort((a, b) => b.pts - a.pts)[0];
    return {
      case: c,
      id: c.id,
      score: Math.min(100, Math.round(sum(parts.map((p) => p.pts)))),
      driver: c.blockedReason ? `${top.why} · ${c.blockedReason}` : top.why,
      decayPerDay: Math.round(c.valueAtRisk / Math.max(1, c.dueInDays)),
    };
  });
}

/* -------------------------------------------------------------------- inbound */

interface InboundRecord {
  id: string;
  carrier: string;
  origin: string;
  arrivalAt: string;
  units: number;
  productClass: string;
  capacityId: string;
  status: 'expected' | 'bay_confirmed';
}

export type CapacityImpact = 'normal' | 'tight' | 'alert';

export interface InboundRow extends InboundRecord {
  bay: CapacityRecord;
  impact: CapacityImpact;
}

const inboundStore = createCollection<InboundRecord>(inboundJson as InboundRecord[]);

/* -------------------------------------------------------------------- helpers */

/** Completes (or parks) the open tasks of a type for a case. */
export function completeTasks(caseId: string, type: TaskRecord['type'], status: 'done' | 'waiting' = 'done') {
  taskStore
    .all()
    .filter((t) => t.caseId === caseId && t.type === type && t.status !== 'done')
    .forEach((t) => taskStore.update(t.id, { status }));
}

const combine =
  (...subs: ((l: () => void) => () => void)[]) =>
  (l: () => void) => {
    const offs = subs.map((s) => s(l));
    return () => offs.forEach((o) => o());
  };

function handoffRow(c: CaseRecord): HandoffRow {
  const steps = handoffInstructions(c.id);
  const status = handoffStage(steps);
  const base: HandoffRecord = handoffStore.get(c.id) ?? {
    id: c.id,
    instructionId: null,
    system: steps[0]?.system ?? 'SAP S/4 PM',
    destination: `${c.location} dispatch`,
    carrier: null,
    trackingRef: null,
    sentAt: null,
    targetDate: c.dueDate,
    status: 'staged',
  };
  const lastDue = steps.reduce<string | null>((m, i) => (i.dueAt && (!m || i.dueAt > m) ? i.dueAt : m), null);
  const sent = steps.find((i) => i.sentAt)?.sentAt ?? null;
  return {
    ...base,
    status,
    sentAt: sent ?? (status === 'staged' ? null : base.sentAt),
    targetDate: lastDue ? lastDue.slice(0, 10) : base.targetDate,
    case: c,
    overdue: steps.some((i) => i.overdue),
    steps,
    done: steps.filter((i) => i.status === 'done').length,
    next: steps.find((i) => i.status !== 'done' && i.status !== 'not_sent') ?? null,
  };
}

/* ------------------------------------------------------------------ lifecycle writes (caseLifecycleService) */

/** Approval meta: note on the approval (Approvals inbox). */
export function noteApproval(id: string, note: string) {
  if (approvalStore.get(id)) approvalStore.update(id, { note });
}

/** Makes sure an approved case has its Handed off row (staged until the instruction is sent). */
export function stageHandoff(id: string) {
  if (handoffStore.get(id)) return;
  const c = caseStore.get(id);
  const steps = handoffInstructions(id);
  const target = new Date(asOfDate().getTime() + 5 * DAY).toISOString().slice(0, 10);
  handoffStore.insert({ id, instructionId: null, system: steps[0]?.system ?? 'SAP S/4 PM', destination: c ? `${c.location} dispatch` : 'Dispatch', carrier: null, trackingRef: null, sentAt: null, targetDate: target, status: 'staged' });
}

/** Dispatch reference on the Handed off row when the instructions are sent (same id when sent again). */
export function recordDispatch(id: string, sentAt: string): { instructionId: string; trackingRef: string } {
  stageHandoff(id);
  const h = handoffStore.get(id);
  if (h?.instructionId && h.trackingRef) return { instructionId: h.instructionId, trackingRef: h.trackingRef };
  const nextNo = 8800 + handoffStore.all().filter((x) => x.instructionId).length + 100;
  const patch = { instructionId: `INS-${nextNo}`, carrier: 'Internal fleet', trackingRef: `TRK-${nextNo}0`, sentAt, status: 'in_transit' as const };
  handoffStore.update(id, patch);
  return { instructionId: patch.instructionId, trackingRef: patch.trackingRef };
}

/** Creates the Outcomes-to-confirm row when a case is delivered (idempotent: one row per case). */
export function createOutcome(input: { id: string; predicted: number; actual: number; route: string; reportedAt: string; costLines: { label: string; amount: number }[]; approvalRef: string; snapshotId: string }): OutcomeRecord {
  ensureSeededOutcomes();
  const hit = outcomeStore.get(input.id);
  if (hit) return hit;
  return outcomeStore.insert({
    id: input.id,
    predicted: input.predicted,
    actual: input.actual,
    evidenceDoc: EVIDENCE_DOC[input.route] ?? 'Settlement statement',
    erpRef: `SAP-FI-${1400 + (Number(input.id.replace(/\D/g, '')) % 600)}`,
    reportedAt: input.reportedAt,
    status: 'pending_invoice',
    costLines: input.costLines,
    approvalRef: input.approvalRef,
    snapshotId: input.snapshotId,
  });
}

export function setOutcomeStatus(id: string, status: OutcomeStatus, patch: Partial<OutcomeRecord> = {}) {
  ensureSeededOutcomes();
  if (!outcomeStore.get(id)) throw new Error(`${id} has no outcome to confirm`);
  outcomeStore.update(id, { ...patch, status });
}

export const commandService = {
  subscribe: combine(caseStore.subscribe, approvalStore.subscribe, handoffStore.subscribe, outcomeStore.subscribe, inboundStore.subscribe, taskStore.subscribe),

  /** The data's "as of" time (ISO). */
  asOf: () => meta.asOf,

  /* Approvals inbox: every case awaiting approval in scope. */
  async approvals(q: { search?: string; tier?: ApprovalTier | 'all' } = {}, scope: Scope = {}): Promise<ApprovalRow[]> {
    await delay();
    const rows: ApprovalRow[] = scopeCases(caseStore.all(), scope)
      .filter((c) => c.stage === 'awaiting_approval')
      .map((c) => {
        const m = approvalStore.get(c.id);
        // A proposal on a case already in the inbox keeps its place (oldest first); the proposer shows as Submitted by.
        const submittedAt = m?.submittedAt ?? c.proposal?.proposedAt ?? meta.asOf;
        return {
          case: c,
          id: c.id,
          submittedAt,
          submittedBy: c.proposal?.proposedBy ?? c.owner,
          waitingDays: daysBetween(submittedAt),
          confidence: m?.confidence ?? 80,
          trigger: m?.trigger ?? 'Tenant policy: every disposition needs human sign-off',
          tier: tierFor(c.estimatedNetRecovery),
          proposal: c.proposal ?? null,
          proposedNet: c.proposal?.route ? (decide(c.id)?.all.find((r) => r.route === c.proposal?.route)?.net ?? null) : null,
        };
      });
    return queryList(rows, {
      search: q.search,
      searchFields: ['id', 'trigger', 'submittedBy', (r) => r.case.productName, (r) => r.case.assetTag],
      filters: { tier: q.tier },
      sortBy: (r) => r.submittedAt,
      sortDir: 'asc',
    }).items;
  },

  /*
   * Handed off: approved cases and their hand-off. The status comes from the instruction steps
   * (decisionService.handoffInstructions, the same steps as the Case page Execution tab):
   * nothing sent → staged; sent → in transit; some done → in execution; all done → delivered.
   */
  async handoffs(q: { search?: string; status?: HandoffStatus | 'all' } = {}, scope: Scope = {}): Promise<HandoffRow[]> {
    await delay();
    const rows: HandoffRow[] = scopeCases(caseStore.all(), scope)
      .filter((c) => c.stage === 'approved' || c.stage === 'handed_off')
      .map((c) => handoffRow(c));
    return queryList(rows, {
      search: q.search,
      searchFields: ['id', 'destination', 'system', 'trackingRef', 'instructionId', (r) => r.case.productName],
      filters: { status: q.status },
      sortBy: (r) => (r.overdue ? 0 : 1) * 1e10 + new Date(r.targetDate).getTime() / 1e3,
      sortDir: 'asc',
    }).items;
  },

  /* Outcomes to confirm: realised value reported back for handed-off cases. */
  async outcomes(q: { search?: string; status?: OutcomeStatus | 'open' | 'all' } = {}, scope: Scope = {}): Promise<OutcomeRow[]> {
    await delay();
    ensureSeededOutcomes();
    const inScope = new Set(scopeCases(caseStore.all(), scope).map((c) => c.id));
    const rows: OutcomeRow[] = outcomeStore
      .all()
      .filter((o) => inScope.has(o.id))
      .map((o) => ({ ...o, case: caseStore.get(o.id)!, variance: o.actual - o.predicted }))
      .filter((o) => !!o.case);
    return queryList(rows, {
      search: q.search,
      searchFields: ['id', 'evidenceDoc', 'erpRef', (r) => r.case.productName],
      filters: { status: q.status === 'open' ? undefined : q.status },
      predicate: q.status === 'open' ? (r) => r.status !== 'reconciled' : undefined,
      sortBy: 'reportedAt',
      sortDir: 'asc',
    }).items;
  },

  /** The outcome row of a case (synchronous; null when none was reported). */
  outcomeOf(id: string): OutcomeRow | null {
    // Called while rendering: read only (the seeded row is derived, not inserted, so no subscriber fires mid-render).
    const o = outcomeStore.get(id) ?? (seededClosed ? undefined : seededOutcomeFor(id) ?? undefined);
    const c = caseStore.get(id);
    return o && c ? { ...o, case: c, variance: o.actual - o.predicted } : null;
  },

  /** The Handed off row of one approved / handed-off case (synchronous). */
  handoffOf(id: string): HandoffRow | null {
    const c = caseStore.get(id);
    return c && (c.stage === 'approved' || c.stage === 'handed_off') ? handoffRow(c) : null;
  },

  /* Actions to prioritise: open cases ranked by urgency, value at risk and recovery. */
  async prioritise(q: { search?: string; route?: string } = {}, scope: Scope = {}): Promise<PriorityRow[]> {
    await delay();
    const open = scopeCases(caseStore.all(), scope).filter((c) => c.stage !== 'approved' && c.stage !== 'handed_off');
    return queryList(scoreCases(open), {
      search: q.search,
      searchFields: ['id', 'driver', (r) => r.case.productName, (r) => r.case.assetTag],
      predicate: q.route && q.route !== 'all' ? (r) => r.case.recommendedRoute === q.route : undefined,
      sortBy: 'score',
      sortDir: 'desc',
    }).items;
  },

  /* Signals and capacity: inbound shipments against configured capacity. */
  async inbound(): Promise<InboundRow[]> {
    await delay(220);
    return inboundStore
      .all()
      .map((r) => {
        const bay = capacity.find((c) => c.id === r.capacityId) ?? capacity[0];
        const load = (bay.used + r.units) / bay.capacity;
        const impact: CapacityImpact = load > 1 ? 'alert' : load >= 0.85 ? 'tight' : 'normal';
        return { ...r, bay, impact };
      })
      .sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt));
  },

  async confirmBay(id: string): Promise<void> {
    await delay(250);
    inboundStore.update(id, { status: 'bay_confirmed' });
  },

  /** Badge counts for the Command Center sub-navigation. */
  async navCounts(role: UserRole, tenant: string | undefined, scope: Scope): Promise<{ exceptions: number; actions: number; approvals: number }> {
    const exceptions = await exceptionService.list({ status: 'unresolved', scope });
    return {
      exceptions: exceptions.total,
      actions: taskService.openCount(role, tenant),
      approvals: scopeCases(caseStore.all(), scope).filter((c) => c.stage === 'awaiting_approval').length,
    };
  },

  /**
   * Adds a My work › Tasks item for a role (escalations and other hand-written tasks). The task
   * shows for that role (and Admin) with a link to `href`, or to the case when `caseId` is set.
   * The assignee defaults to the first user with the role (the case tenant's Planner for Planners).
   */
  async addTask(input: {
    title: string;
    role: UserRole;
    type?: TaskRecord['type'];
    caseId?: string | null;
    assigneeId?: string;
    priority?: Priority;
    /** YYYY-MM-DD; defaults to the data's "as of" day. */
    dueDate?: string;
    href?: string;
    hrefLabel?: string;
    subject?: string;
    note?: string;
    createdBy?: string;
  }): Promise<TaskRecord> {
    await delay(200);
    const caseId = input.caseId ?? '';
    const tenant = caseId ? caseStore.get(caseId)?.tenant : undefined;
    const users = userStore.all().filter((u) => u.role === input.role);
    const assignee = input.assigneeId ?? (users.find((u) => !tenant || u.tenant === tenant || u.tenant === 'All') ?? users[0])?.id ?? '';
    const seq = Math.max(0, ...taskStore.all().map((t) => Number(t.id.replace(/\D/g, '')) || 0)) + 1;
    return taskStore.insert({
      id: `TSK-${String(seq).padStart(4, '0')}`,
      type: input.type ?? 'escalation',
      title: input.title,
      caseId,
      assigneeId: assignee,
      role: input.role,
      dueDate: input.dueDate ?? meta.asOf.slice(0, 10),
      priority: input.priority ?? 'high',
      status: 'todo',
      ...(input.href ? { href: input.href, hrefLabel: input.hrefLabel ?? 'Open' } : {}),
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      createdAt: new Date().toISOString(),
    });
  },
};

export const subscribeNav = combine(commandService.subscribe, exceptionStore.subscribe);
