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
import type { CapacityRecord, CaseRecord, Priority } from '@/models/domain.model';
import type { UserRole } from '@/models/user.model';
import type { RouteProposal } from '@/models/decision.model';
import { capacity, caseStore, exceptionStore, meta, taskStore } from './mock/stores';
import { createCollection, delay, queryList, sum } from './mock/mockUtils';
import { scopeCases } from './caseService';
import { decide } from './decisionService';
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

/** Approval tier from the shared thresholds (edited on Access → Delegations; governanceService). */
export const tierFor = (value: number): ApprovalTier => {
  const t = currentThresholds();
  return value > t.delegationLimit ? 'Executive' : value >= t.level2Above ? 'Level 2' : 'Level 1';
};

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
}

export interface OutcomeRow extends OutcomeRecord {
  case: CaseRecord;
  variance: number;
}

const outcomeStore = createCollection<OutcomeRecord>(outcomesJson as OutcomeRecord[]);

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

function completeTasks(caseId: string, type: 'approve' | 'confirm_outcome', status: 'done' | 'waiting' = 'done') {
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

  async approve(id: string, note: string): Promise<void> {
    await delay(350);
    caseStore.update(id, { stage: 'approved', riskReason: null, valueAtRisk: 0 });
    if (approvalStore.get(id)) approvalStore.update(id, { note });
    if (!handoffStore.get(id)) {
      const c = caseStore.get(id);
      const target = new Date(asOfDate().getTime() + 5 * DAY).toISOString().slice(0, 10);
      handoffStore.insert({ id, instructionId: null, system: 'SAP S/4 PM', destination: c ? `${c.location} dispatch` : 'Dispatch', carrier: null, trackingRef: null, sentAt: null, targetDate: target, status: 'staged' });
    }
    completeTasks(id, 'approve');
  },

  async decline(id: string, note: string): Promise<void> {
    await delay(350);
    caseStore.update(id, { stage: 'reevaluate' });
    if (approvalStore.get(id)) approvalStore.update(id, { note });
    completeTasks(id, 'approve');
  },

  async requestEvidence(id: string): Promise<void> {
    await delay(300);
    caseStore.update(id, { stage: 'needs_information' });
    completeTasks(id, 'approve', 'waiting');
  },

  /* Handed off: instructions sent to executing systems for approved cases. */
  async handoffs(q: { search?: string; status?: HandoffStatus | 'all' } = {}, scope: Scope = {}): Promise<HandoffRow[]> {
    await delay();
    const today = meta.asOf.slice(0, 10);
    const rows: HandoffRow[] = scopeCases(caseStore.all(), scope)
      .filter((c) => c.stage === 'approved' || c.stage === 'handed_off')
      .map((c) => {
        const h: HandoffRecord = handoffStore.get(c.id) ?? {
          id: c.id,
          instructionId: null,
          system: 'SAP S/4 PM',
          destination: `${c.location} dispatch`,
          carrier: null,
          trackingRef: null,
          sentAt: null,
          targetDate: c.dueDate,
          status: 'staged',
        };
        return { ...h, case: c, overdue: h.status !== 'delivered' && h.targetDate < today };
      });
    return queryList(rows, {
      search: q.search,
      searchFields: ['id', 'destination', 'system', 'trackingRef', 'instructionId', (r) => r.case.productName],
      filters: { status: q.status },
      sortBy: (r) => (r.overdue ? 0 : 1) * 1e10 + new Date(r.targetDate).getTime() / 1e3,
      sortDir: 'asc',
    }).items;
  },

  /** Sends the hand-off instruction for a staged (approved) case. */
  async sendInstruction(id: string): Promise<void> {
    await delay(350);
    const nextNo = 8800 + handoffStore.all().filter((h) => h.instructionId).length + 100;
    const patch = { instructionId: `INS-${nextNo}`, carrier: 'Internal fleet', trackingRef: `TRK-${nextNo}0`, sentAt: meta.asOf, status: 'in_transit' as const };
    if (handoffStore.get(id)) handoffStore.update(id, patch);
    caseStore.update(id, { stage: 'handed_off' });
  },

  /* Outcomes to confirm: realised value reported back for handed-off cases. */
  async outcomes(q: { search?: string; status?: OutcomeStatus | 'open' | 'all' } = {}, scope: Scope = {}): Promise<OutcomeRow[]> {
    await delay();
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

  /** Records that the invoice / receipt evidence has arrived. */
  async confirmReceipt(id: string): Promise<void> {
    await delay(250);
    outcomeStore.update(id, { status: 'confirmed' });
  },

  /** Closes the outcome against the ledger and completes the Finance task. */
  async reconcile(id: string): Promise<void> {
    await delay(300);
    outcomeStore.update(id, { status: 'reconciled' });
    completeTasks(id, 'confirm_outcome');
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
};

export const subscribeNav = combine(commandService.subscribe, exceptionStore.subscribe);
