/**
 * Case lifecycle: every action that moves a returned-asset case from receipt to learning, with
 * its policy checks and its audit entry. Pages call this service; the stores it writes are the
 * same ones every screen reads (case store, decision state, tasks, hand-off and outcome rows).
 *
 *   receive (intakeService) → Awaiting inspection
 *   Record inspection (Engineer / Admin) → Ready for decision (or back to Awaiting approval when a
 *     submission was set aside by a request for evidence)
 *   Send to approver / Propose another route (Planner …) → Awaiting approval, or auto-approved
 *     within policy (net below the auto-approve threshold, Grade A, every gate OK)
 *   Approve (within the approver's limit; above it → Escalate to Executive) → Approved
 *   Decline (reason required) → Re-evaluate → Re-evaluate (Planner) → Ready for decision
 *   Send instruction → Handed off; steps acknowledged / done by the executing systems (simulated
 *     system events, Admin / Developer); Resend for an unacknowledged or overdue step
 *   All steps done → Delivered: an Outcomes-to-confirm row is created for Finance
 *   Confirm receipt → Reconcile (Finance) → decision history (Forecast quality / learning)
 *
 * Run agents (Dashboard) prepares decisions for the Planner (Ready for decision + a "Review and
 * send" task); it is refused while the agents are stopped and processes at most the
 * "max items per bulk plan" limit.
 */
import type { CaseRecord, InspectionResult, TaskRecord } from '@/models/domain.model';
import type { ApprovalRecord, HandoffInstruction, OverrideReason, RouteId, RouteProposal, RunAgentsResult } from '@/models/decision.model';
import type { UserRole } from '@/models/user.model';
import { caseStore, meta, taskStore, userStore } from './mock/stores';
import { delay } from './mock/mockUtils';
import {
  acknowledgeInstruction,
  approvalRecord,
  caseContext,
  completeInstruction,
  decide,
  decisionInsights,
  getDecline,
  getEscalation,
  handoffInstructions,
  noteApprover,
  noteDecline,
  override as overrideRoute,
  proposeRoute,
  realisedNetFor,
  recordOutcome,
  reevaluate as reevaluateCase,
  resendInstruction,
  runAgents as runAgentsEngine,
  sendBlockReason,
  sendInstructions,
  usd,
  withdrawProposal,
  type ReevaluationResult,
} from './decisionService';
import { decisionState, notifyDecisions, registerContext, simNow, type EscalationRecord } from './decision/runtime';
import { completeTasks, createOutcome, noteApproval, recordDispatch, setOutcomeStatus, stageHandoff, tierFor, type ApprovalTier, commandService } from './commandService';
import { currentThresholds } from './governanceService';
import { auditService, type AuditActionType, type AuditActorType } from './auditService';
import { agentControlsService } from './agentControlsService';
import { assetDetail } from './productService';

/** Who acts: the signed-in role's account (id, role) and the display name. */
export interface Actor {
  id: string;
  name: string;
  role: UserRole | string;
}

/** The approver name on an auto-approval (approval record, audit, Approvals history). */
export const AUTO_APPROVER = 'Circularity (auto, within policy)';

const label = (a: Actor) => `${a.name} (${a.role})`;
const usdK = (n: number) => (n >= 1000 && n % 1000 === 0 ? `$${n / 1000}k` : usd(n));
const today = () => simNow().slice(0, 10);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

function mustCase(id: string): CaseRecord {
  const c = caseStore.get(id);
  if (!c) throw new Error(`Case ${id} not found`);
  return c;
}

function requireRole(actor: Actor, roles: string[], what: string) {
  if (!roles.includes(actor.role)) throw new Error(`${actor.role} cannot ${what}. ${roles.join(' or ')} can.`);
}

/* ------------------------------------------------------------------ audit + tasks */

function audit(
  c: CaseRecord,
  action: string,
  actionType: AuditActionType,
  actor: Actor | { type: AuditActorType; id: string; name: string },
  payload: string,
  opts: { source?: string; sourceRef?: string; journeyStep?: number | null } = {},
) {
  const isPerson = !('type' in actor);
  return auditService.record({
    caseId: c.id,
    tenant: c.tenant,
    entity: `${c.id} · ${c.productName}`,
    action,
    actionType,
    actorType: isPerson ? 'user' : actor.type,
    actorId: actor.id,
    actorName: isPerson ? label(actor) : actor.name,
    source: opts.source ?? 'Decision Workbench',
    sourceRef: opts.sourceRef ?? c.id,
    payloadSummary: payload,
    journeyStep: opts.journeyStep ?? null,
  });
}

function nextTaskId(): string {
  const seq = Math.max(0, ...taskStore.all().map((t) => Number(t.id.replace(/\D/g, '')) || 0)) + 1;
  return `TSK-${String(seq).padStart(4, '0')}`;
}

/** Adds a task unless the case already has an open one of the same type for the role. */
function addTask(c: CaseRecord, input: { type: TaskRecord['type']; role: UserRole; title: string; dueDays?: number; priority?: TaskRecord['priority']; href?: string; hrefLabel?: string; note?: string; createdBy?: string }): TaskRecord {
  const open = taskStore.all().find((t) => t.caseId === c.id && t.type === input.type && t.role === input.role && t.status !== 'done');
  if (open) return open.title === input.title ? open : taskStore.update(open.id, { title: input.title, ...(input.note ? { note: input.note } : {}) });
  const users = userStore.all().filter((u) => u.role === input.role);
  const assignee = (input.role === 'Planner' ? users.find((u) => u.tenant === c.tenant) : undefined) ?? users[0];
  return taskStore.insert({
    id: nextTaskId(),
    type: input.type,
    title: input.title,
    caseId: c.id,
    assigneeId: assignee?.id ?? '',
    role: input.role,
    dueDate: addDays(today(), input.dueDays ?? 2),
    priority: input.priority ?? c.priority,
    status: 'todo',
    ...(input.href ? { href: input.href, hrefLabel: input.hrefLabel ?? 'Open' } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    createdAt: new Date().toISOString(),
  });
}

const snapshotOf = (c: CaseRecord) => decisionInsights(c)?.snapshotId ?? '';

/* ------------------------------------------------------------------ approval policy */

export interface ApprovalPolicy {
  /** The actor may approve this case now. */
  allowed: boolean;
  /** Why not (null when allowed). */
  reason: string | null;
  /** The approver is above their limit and may escalate to the Executive (not escalated yet). */
  canEscalate: boolean;
  escalation: EscalationRecord | null;
  tier: ApprovalTier;
  /** Net value the approval signs off (the proposed route when one was proposed). */
  net: number;
  /** The actor's approval limit (null = no limit). */
  limit: number | null;
  /**
   * The approver also submitted the decision. Only Admin may then approve while self-approval is
   * off (Admin override, stated in the audit entry); everyone else needs a second person.
   */
  sameSubmitter: boolean;
}

/** Net value an approval would sign off: the proposed route when one was proposed, else Circularity's. */
export function approvalNet(c: CaseRecord): number {
  const d = decide(c.id);
  if (!d) return c.estimatedNetRecovery;
  const prop = c.proposal?.route ? d.all.find((r) => r.route === c.proposal?.route && r.viable) : null;
  return (prop ?? d.best).net;
}

/**
 * Can `actor` approve the case? Admin and Executive: no limit. Approver: up to the delegation limit
 * (above it: escalate to Executive). Planner: only below the Planner limit (0 = never). A person
 * may not approve a decision they submitted unless self-approval is allowed. Other roles cannot approve.
 */
export function approvalPolicy(caseId: string, actor: Pick<Actor, 'id' | 'role'>): ApprovalPolicy {
  const c = caseStore.get(caseId);
  const t = currentThresholds();
  const escalation = getEscalation(caseId);
  const none = (reason: string, extra: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({ allowed: false, reason, canEscalate: false, escalation, tier: 'Level 1', net: 0, limit: null, sameSubmitter: false, ...extra });
  if (!c) return none(`Case ${caseId} not found`);
  const net = approvalNet(c);
  const tier = tierFor(net);
  const base = { tier, net };
  if (c.stage !== 'awaiting_approval') return none(`${caseId} is not awaiting approval (${c.stage.replace(/_/g, ' ')})`, base);
  const d = decide(caseId);
  const target = c.proposal?.route ? d?.all.find((r) => r.route === c.proposal?.route) : d?.best;
  if (!target?.viable) return none('The route to approve is not viable', base);
  let limit: number | null;
  if (actor.role === 'Admin' || actor.role === 'Executive') limit = null;
  else if (actor.role === 'Approver') limit = t.delegationLimit;
  else if (actor.role === 'Planner') limit = t.plannerLimit;
  else return none(`${actor.role} cannot approve decisions`, base);
  const sameSubmitter = !!c.proposal?.proposedById && c.proposal.proposedById === actor.id;
  if (sameSubmitter && !t.allowSelfApproval && actor.role !== 'Admin') {
    return none('You submitted this decision; a second person must approve it (self-approval is off)', { ...base, limit });
  }
  if (actor.role === 'Approver' && limit !== null && net > limit) {
    return none(`Above your ${usdK(limit)} limit — escalate to Executive`, { ...base, limit, canEscalate: !escalation });
  }
  if (actor.role === 'Planner' && limit !== null && !(limit > net)) {
    return none(limit === 0 ? 'Planners cannot approve (Planner limit is $0)' : `Above your Planner limit of ${usdK(limit)}`, { ...base, limit });
  }
  return { allowed: true, reason: null, canEscalate: false, escalation, tier, net, limit, sameSubmitter };
}

export interface AutoApprovePolicy {
  eligible: boolean;
  /** What failed (empty when eligible), in plain words. */
  reasons: string[];
  threshold: number;
}

/** Auto-approval within policy: Circularity's route, net below the threshold, Grade A, every gate OK. */
export function autoApprovePolicy(caseId: string, route: RouteId | null = null): AutoApprovePolicy {
  const c = caseStore.get(caseId);
  const t = currentThresholds();
  const reasons: string[] = [];
  const d = c ? decide(caseId) : undefined;
  if (!c || !d) return { eligible: false, reasons: ['Case not found'], threshold: t.autoApproveBelow };
  if (route && route !== d.best.route) reasons.push('another route than Circularity’s was proposed');
  if (!d.best.viable) reasons.push('no viable route');
  if (!(d.best.net < t.autoApproveBelow)) reasons.push(`net ${usd(d.best.net)} is not below ${usd(t.autoApproveBelow)}`);
  if (c.condition !== 'A') reasons.push(`Grade ${c.condition}, not A`);
  const gates = decisionInsights(c, d)?.routes[d.best.route]?.gates ?? [];
  const notOk = gates.filter((g) => g.status !== 'ok' && g.status !== 'na');
  if (!gates.length || notOk.length) reasons.push(`${notOk.length} of ${gates.length} gates not OK`);
  return { eligible: reasons.length === 0, reasons, threshold: t.autoApproveBelow };
}

/* ------------------------------------------------------------------ helpers shared by the actions */

function finishApproval(c: CaseRecord, approver: string, note?: string): ApprovalRecord {
  noteApprover(c.id, approver);
  caseStore.update(c.id, { stage: 'approved', riskReason: null, valueAtRisk: 0, ...(note?.trim() ? { decisionNote: note.trim() } : {}) });
  if (note?.trim()) noteApproval(c.id, note.trim());
  stageHandoff(c.id);
  completeTasks(c.id, 'approve');
  completeTasks(c.id, 'escalation');
  const apr = approvalRecord(c.id);
  if (!apr) throw new Error(`${c.id} could not be approved`);
  return apr;
}

function autoApprove(c: CaseRecord): ApprovalRecord {
  const before = decide(c.id);
  const gates = before ? (decisionInsights(c, before)?.routes[before.best.route]?.gates ?? []) : [];
  const apr = finishApproval(c, AUTO_APPROVER);
  const t = currentThresholds();
  audit(
    mustCase(c.id),
    `Auto-approved within policy: ${apr.routeName}`,
    'approval',
    { type: 'agent', id: 'approval-gate', name: AUTO_APPROVER },
    `${usd(apr.net)} below the ${usd(t.autoApproveBelow)} auto-approve threshold · Grade A · ${gates.length} of ${gates.length} gates OK · ${apr.ref} · snapshot ${apr.snapshotId}`,
    { source: 'Approval Gate', sourceRef: apr.ref, journeyStep: 5 },
  );
  return apr;
}

function stashedOrNull(id: string): RouteProposal | null {
  return decisionState.stashedProposals.get(id) ?? null;
}

/* ------------------------------------------------------------------ the actions */

export interface SendResult {
  proposal: RouteProposal;
  /** Set when the case was approved automatically within policy. */
  autoApproved: ApprovalRecord | null;
}

export interface InspectionInput {
  grade: InspectionResult['grade'];
  test: InspectionResult['test'];
  lifePct: number;
  notes: string;
  photosReceived: boolean;
}

export interface InspectionOutcome {
  stage: CaseRecord['stage'];
  fromRoute: string;
  fromNet: number;
  toRoute: string;
  toNet: number;
  snapshotId: string;
  summary: string;
  evidenceCompleteness: number;
}

export const caseLifecycleService = {
  subscribe: commandService.subscribe,

  approvalPolicy,
  autoApprovePolicy,

  /** Planner / Engineer / Warehouse Manager sends the case (Circularity's route or another one) to the approver. */
  async sendToApprover(caseId: string, actor: Actor, input: { route?: RouteId | null; reason?: OverrideReason | null; note?: string } = {}): Promise<SendResult> {
    await delay(300);
    const c = mustCase(caseId);
    const route = input.route ?? null;
    const prop = proposeRoute(caseId, route, input.reason ?? null, input.note ?? '', actor.name, { id: actor.id, role: actor.role });
    decisionState.stashedProposals.delete(caseId);
    completeTasks(caseId, 'prepare_decision');
    const after = mustCase(caseId);
    const d = decide(caseId);
    const target = prop.route ? d?.all.find((r) => r.route === prop.route) : d?.best;
    audit(
      after,
      prop.route ? `Route proposed to the approver: ${target?.routeName}` : `Sent to approver: ${target?.routeName}`,
      'decision',
      actor,
      `${target?.routeName} ${usd(target?.net ?? 0)}${prop.reason ? ` · reason: ${prop.reason}` : ''}${prop.note ? ` · note: ${prop.note}` : ''} · snapshot ${prop.snapshotId ?? ''}${c.stage !== 'awaiting_approval' ? ` · from ${c.stage.replace(/_/g, ' ')}` : ''}`,
      { journeyStep: 5 },
    );
    const auto = !prop.route ? autoApprovePolicy(caseId) : null;
    if (auto?.eligible) return { proposal: prop, autoApproved: autoApprove(after) };
    addTask(after, { type: 'approve', role: 'Approver', title: `Approve ${target?.routeName ?? 'the plan'} for ${caseId}`, priority: after.priority });
    return { proposal: prop, autoApproved: null };
  },

  async withdraw(caseId: string, actor: Actor): Promise<void> {
    await delay(200);
    const c = mustCase(caseId);
    const prop = c.proposal;
    withdrawProposal(caseId, actor.name);
    completeTasks(caseId, 'approve');
    audit(mustCase(caseId), 'Submission withdrawn', 'decision', actor, `Withdrawn before approval${prop?.route ? ` (proposed ${prop.route})` : ''}; back to ${mustCase(caseId).stage.replace(/_/g, ' ')}`, { journeyStep: 5 });
  },

  /** Approver / Admin chooses another route on an open case (logged with the reason). */
  async override(caseId: string, route: RouteId, reason: OverrideReason, actor: Actor) {
    await delay(300);
    const before = decide(caseId);
    const d = overrideRoute(caseId, route, reason, actor.name);
    audit(mustCase(caseId), `Route overridden: ${d.best.routeName}`, 'override', actor, `${before?.best.routeName} ${usd(before?.best.net ?? 0)} → ${d.best.routeName} ${usd(d.best.net)} · reason: ${reason} · snapshot ${snapshotOf(mustCase(caseId))}`, { journeyStep: 4 });
    return d;
  },

  /** Approve within the actor's limit (refused otherwise, with the reason). */
  async approve(caseId: string, actor: Actor, note = ''): Promise<ApprovalRecord> {
    await delay(350);
    const p = approvalPolicy(caseId, actor);
    if (!p.allowed) throw new Error(p.reason ?? 'You cannot approve this case');
    const c = mustCase(caseId);
    const proposer = c.proposal?.proposedBy;
    const override = p.sameSubmitter && !currentThresholds().allowSelfApproval;
    const apr = finishApproval(c, label(actor), note);
    audit(
      mustCase(caseId),
      override ? `Approved: ${apr.routeName} (Admin override: same person submitted and approved)` : `Approved: ${apr.routeName}`,
      'approval',
      actor,
      `${apr.routeName} ${usd(apr.net)} · ${p.tier}${p.limit !== null ? ` (limit ${usd(p.limit)})` : ''} · ${apr.ref} · snapshot ${apr.snapshotId}${proposer ? ` · submitted by ${proposer}` : ''}${note.trim() ? ` · note: ${note.trim()}` : ''}`,
      { sourceRef: apr.ref, journeyStep: 5 },
    );
    return apr;
  },

  /**
   * Admin only: submit and approve in one step on a case nobody has sent (Ready for decision, or
   * Awaiting approval without a submission). Admin has no limit; with self-approval off this is an
   * Admin override and the audit entry says so ("Approved directly by Admin (no separate submitter)").
   */
  async approveDirectly(caseId: string, actor: Actor, note = ''): Promise<ApprovalRecord> {
    await delay(350);
    requireRole(actor, ['Admin'], 'approve directly');
    const c = mustCase(caseId);
    if (c.proposal) throw new Error(`${caseId} was already submitted by ${c.proposal.proposedBy}; approve it instead`);
    const block = sendBlockReason(c);
    if (block) throw new Error(block);
    const prop = proposeRoute(caseId, null, null, note || 'Approved directly by Admin', actor.name, { id: actor.id, role: actor.role });
    decisionState.stashedProposals.delete(caseId);
    completeTasks(caseId, 'prepare_decision');
    const apr = finishApproval(mustCase(caseId), label(actor), note);
    audit(
      mustCase(caseId),
      `Approved directly by Admin (no separate submitter): ${apr.routeName}`,
      'approval',
      actor,
      `Submitted and approved by ${label(actor)} in one step${currentThresholds().allowSelfApproval ? '' : ' · Admin override: self-approval is off, Admin has no limit'} · ${apr.routeName} ${usd(apr.net)} · ${apr.ref} · snapshot ${prop.snapshotId ?? apr.snapshotId}${note.trim() ? ` · note: ${note.trim()}` : ''}`,
      { sourceRef: apr.ref, journeyStep: 5 },
    );
    return apr;
  },

  /** Approver above their limit: hands the sign-off to the Executive (task + audit). */
  async escalateToExecutive(caseId: string, actor: Actor, note = ''): Promise<EscalationRecord> {
    await delay(250);
    const p = approvalPolicy(caseId, actor);
    if (p.escalation) return p.escalation;
    if (!p.canEscalate) throw new Error(p.allowed ? 'This case is within your limit; approve it instead' : (p.reason ?? 'Nothing to escalate'));
    const c = mustCase(caseId);
    const task = addTask(c, {
      type: 'escalation',
      role: 'Executive',
      title: `Executive sign-off for ${caseId}: ${usd(p.net)} above the ${usdK(p.limit ?? 0)} delegation limit`,
      priority: 'high',
      dueDays: 1,
      note: note.trim() || `${label(actor)} cannot approve above ${usd(p.limit ?? 0)}. Review and approve or decline on the case page.`,
      createdBy: label(actor),
    });
    const rec: EscalationRecord = { caseId, to: 'Executive', by: label(actor), at: simNow(), net: p.net, limit: p.limit ?? 0, taskId: task.id };
    decisionState.escalations.set(caseId, rec);
    notifyDecisions();
    audit(c, 'Escalated to Executive for sign-off', 'approval', actor, `${usd(p.net)} above the Approver limit ${usd(p.limit ?? 0)} · task ${task.id} for the Executive (Admin sees it too) · snapshot ${snapshotOf(c)}`, { sourceRef: task.id, journeyStep: 5 });
    return rec;
  },

  /** Decline with a reason: the case goes back for re-evaluation and the Planner gets a task. */
  async decline(caseId: string, actor: Actor, reason: string): Promise<void> {
    await delay(350);
    if (!reason.trim()) throw new Error('Give a reason for declining');
    const c = mustCase(caseId);
    if (c.stage !== 'awaiting_approval') throw new Error(`${caseId} is not awaiting approval`);
    if (!['Approver', 'Admin', 'Executive'].includes(actor.role) && !approvalPolicy(caseId, actor).allowed) throw new Error(`${actor.role} cannot decline decisions`);
    const rec = noteDecline(caseId, reason, label(actor));
    caseStore.update(caseId, { stage: 'reevaluate', decisionNote: `Declined: ${reason.trim()}` });
    noteApproval(caseId, reason.trim());
    completeTasks(caseId, 'approve');
    completeTasks(caseId, 'escalation');
    decisionState.escalations.delete(caseId);
    const after = mustCase(caseId);
    addTask(after, { type: 'prepare_decision', role: 'Planner', title: `Re-evaluate ${caseId} (declined)`, note: `Declined by ${label(actor)}: ${reason.trim()}`, createdBy: label(actor) });
    audit(after, `Declined: ${rec.routeName}`, 'approval', actor, `${rec.routeName} ${usd(rec.net)} · reason: ${rec.reason} · snapshot ${rec.snapshotId} · sent back for re-evaluation`, { journeyStep: 5 });
  },

  /** Ask for more evidence: the case waits for the Engineer's inspection result; a submission is set aside. */
  async requestEvidence(caseId: string, actor: Actor, note = ''): Promise<void> {
    await delay(300);
    const c = mustCase(caseId);
    if (!['awaiting_inspection', 'awaiting_approval', 'reevaluate', 'ready_for_decision'].includes(c.stage)) throw new Error(`${caseId} is ${c.stage.replace(/_/g, ' ')}; evidence can no longer be requested`);
    if (c.proposal) decisionState.stashedProposals.set(caseId, c.proposal);
    if (c.stage !== 'needs_information') caseStore.update(caseId, { stage: 'needs_information' });
    completeTasks(caseId, 'approve', 'waiting');
    const after = mustCase(caseId);
    addTask(after, { type: 'inspect', role: 'Engineer', title: `Record inspection result for ${caseId}`, note: note || `Evidence requested by ${label(actor)}`, createdBy: label(actor) });
    audit(after, 'Evidence requested', 'evidence', actor, `Inspection result, photos and test report requested from ${after.location}${c.proposal ? ` · submission by ${c.proposal.proposedBy} set aside until the inspection is recorded` : ''}${note ? ` · ${note}` : ''}`, { journeyStep: 1 });
  },

  /**
   * Engineer records the inspection: fills the missing evidence (test report, hazardous-materials
   * check, photos when received, remaining life), sets grade and condition, re-runs the decision on a
   * new evidence snapshot and moves the case on (Awaiting approval when a submission was set aside,
   * else Ready for decision).
   */
  async recordInspection(caseId: string, input: InspectionInput, actor: Actor): Promise<InspectionOutcome> {
    await delay(350);
    requireRole(actor, ['Engineer', 'Admin'], 'record an inspection result');
    const c = mustCase(caseId);
    if (c.stage !== 'awaiting_inspection' && c.stage !== 'needs_information') throw new Error(`${caseId} is ${c.stage.replace(/_/g, ' ')}; the inspection is already recorded`);
    if (!['A', 'B', 'C', 'D'].includes(input.grade)) throw new Error('Choose a grade');
    if (!['pass', 'fail', 'conditional'].includes(input.test)) throw new Error('Choose the test result');
    if (!(Number.isFinite(input.lifePct) && input.lifePct >= 1 && input.lifePct <= 100)) throw new Error('Remaining life must be between 1 and 100 %');
    const before = decide(caseId);
    const inspection: InspectionResult = { grade: input.grade, test: input.test, lifePct: Math.round(input.lifePct), notes: input.notes.trim(), photosReceived: input.photosReceived, by: label(actor), at: simNow() };
    registerContext(caseId, { ...caseContext(c), lifePct: inspection.lifePct });
    const patch: Partial<CaseRecord> = {
      inspection,
      condition: input.grade,
      residualLifeMonths: Math.max(1, Math.round((inspection.lifePct / 100) * 60)),
      blockedReason: null,
      riskReason: input.test === 'fail' ? 'condition_deterioration' : c.riskReason === 'missing_evidence' || c.riskReason === 'condition_deterioration' ? null : c.riskReason,
      evaluationRound: (c.evaluationRound ?? 0) + 1,
    };
    const items = assetDetail({ ...c, ...patch }).evidence;
    patch.evidenceCompleteness = Math.round((items.filter((e) => e.status === 'received').length / items.length) * 100);
    const stash = stashedOrNull(caseId);
    if (stash) {
      decisionState.proposals.set(caseId, stash);
      decisionState.stashedProposals.delete(caseId);
      patch.stage = 'awaiting_approval';
    } else {
      patch.stage = 'ready_for_decision';
    }
    caseStore.update(caseId, patch);
    let after = mustCase(caseId);
    const d = decide(caseId);
    if (d && !d.best.viable && after.stage === 'ready_for_decision') {
      caseStore.update(caseId, { stage: 'no_viable_route' });
      after = mustCase(caseId);
    }
    const snapshotId = snapshotOf(after);
    completeTasks(caseId, 'inspect');
    completeTasks(caseId, 'request_evidence');
    if (after.stage === 'ready_for_decision') addTask(after, { type: 'prepare_decision', role: 'Planner', title: `Review and send ${caseId}`, note: `Inspection recorded by ${label(actor)}: Grade ${input.grade}, test ${input.test}`, createdBy: label(actor) });
    else if (after.stage === 'awaiting_approval') addTask(after, { type: 'approve', role: 'Approver', title: `Approve ${d?.best.routeName ?? 'the plan'} for ${caseId}` });
    const changed = before && d && before.best.route !== d.best.route;
    const summary = !d
      ? 'Decision unavailable'
      : changed
        ? `Recommendation changed from ${before?.best.routeName} (${usd(before?.best.net ?? 0)}) to ${d.best.routeName} (${usd(d.best.net)}).`
        : `Recommendation: ${d.best.routeName} at ${usd(d.best.net)}${before ? ` (was ${usd(before.best.net)})` : ''}.`;
    audit(
      after,
      `Inspection recorded: Grade ${input.grade}, test ${input.test}`,
      'evidence',
      actor,
      `Remaining life ${inspection.lifePct} % · photos ${input.photosReceived ? 'received' : 'not received'} · evidence ${after.evidenceCompleteness} % · ${summary} · new snapshot ${snapshotId} · stage ${after.stage.replace(/_/g, ' ')}${inspection.notes ? ` · notes: ${inspection.notes}` : ''}`,
      { source: 'Test bench', sourceRef: `TST-${caseId.replace(/\D/g, '')}`, journeyStep: 1 },
    );
    return {
      stage: after.stage,
      fromRoute: before?.best.routeName ?? '',
      fromNet: before?.best.net ?? 0,
      toRoute: d?.best.routeName ?? '',
      toNet: d?.best.net ?? 0,
      snapshotId,
      summary,
      evidenceCompleteness: after.evidenceCompleteness,
    };
  },

  /** Planner re-runs route building and ranking on a new evidence snapshot and sees what changed. */
  async reevaluate(caseId: string, actor: Actor): Promise<ReevaluationResult> {
    await delay(450);
    requireRole(actor, ['Planner', 'Admin'], 're-evaluate a decision');
    const r = reevaluateCase(caseId, label(actor));
    completeTasks(caseId, 'prepare_decision');
    const after = mustCase(caseId);
    if (after.stage === 'ready_for_decision') addTask(after, { type: 'prepare_decision', role: 'Planner', title: `Review and send ${caseId}`, note: r.summary });
    audit(after, r.changed ? 'Re-evaluated: recommendation changed' : 'Re-evaluated: recommendation unchanged', 'decision', actor, `${r.summary}${r.declineReason ? ` · declined because: ${r.declineReason}` : ''} · snapshot ${r.fromSnapshotId} → ${r.toSnapshotId}`, { journeyStep: 4 });
    return r;
  },

  /** Sends the hand-off instructions of an approved case to the executing systems. */
  async sendInstruction(caseId: string, actor: Actor): Promise<HandoffInstruction[]> {
    await delay(350);
    const c = mustCase(caseId);
    if (c.stage !== 'approved') throw new Error(c.stage === 'handed_off' ? `${caseId} was already handed off` : `${caseId} is not approved yet`);
    const steps = sendInstructions(caseId);
    const ref = recordDispatch(caseId, steps[0]?.sentAt ?? simNow());
    caseStore.update(caseId, { stage: 'handed_off' });
    const apr = approvalRecord(caseId);
    audit(
      mustCase(caseId),
      `Instruction sent: ${steps.length} steps`,
      'write',
      actor,
      `${[...new Set(steps.map((i) => i.system))].join(', ')} · ${ref.instructionId} · ${apr?.routeName} ${usd(apr?.net ?? 0)} · ${apr?.ref} · snapshot ${apr?.snapshotId}`,
      { source: 'Instruction Dispatcher', sourceRef: ref.instructionId, journeyStep: 6 },
    );
    return steps;
  },

  /** Simulated system event: the executing system acknowledges a sent step (Admin / Developer). */
  async acknowledgeStep(caseId: string, instructionId: string, actor: Actor): Promise<HandoffInstruction> {
    await delay(200);
    requireRole(actor, ['Admin', 'Developer'], 'simulate a system acknowledgement');
    const i = acknowledgeInstruction(caseId, instructionId);
    audit(mustCase(caseId), `Step acknowledged: ${i.instruction}`, 'write', { type: 'system', id: 'sim-system', name: `${i.system} (simulated)` }, `Simulated system acknowledgement triggered by ${label(actor)} · ${i.id} · ${i.doc} · ${i.approvalRef}`, { source: i.system, sourceRef: i.doc, journeyStep: 7 });
    return i;
  },

  /** Simulated system event: the executing system reports an acknowledged step done; the last one delivers the case. */
  async completeStep(caseId: string, instructionId: string, actor: Actor): Promise<{ step: HandoffInstruction; delivered: boolean }> {
    await delay(200);
    requireRole(actor, ['Admin', 'Developer'], 'simulate a system completion');
    const i = completeInstruction(caseId, instructionId);
    const c = mustCase(caseId);
    audit(c, `Step done: ${i.instruction}`, 'write', { type: 'system', id: 'sim-system', name: `${i.system} (simulated)` }, `Simulated completion triggered by ${label(actor)} · ${i.id} · ${i.doc} · ${i.approvalRef}`, { source: i.system, sourceRef: i.doc, journeyStep: 8 });
    const delivered = handoffInstructions(caseId).every((x) => x.status === 'done');
    if (delivered) onDelivered(c);
    return { step: i, delivered };
  },

  /** Moves the first open step on by one system event (acknowledge, then done). */
  async advance(caseId: string, actor: Actor): Promise<{ step: HandoffInstruction; delivered: boolean; event: 'acknowledged' | 'done' }> {
    const next = handoffInstructions(caseId).find((i) => i.status === 'sent' || i.status === 'acknowledged');
    if (!next) throw new Error(`${caseId} has no sent step to move on`);
    if (next.status === 'sent') return { step: await caseLifecycleService.acknowledgeStep(caseId, next.id, actor), delivered: false, event: 'acknowledged' };
    return { ...(await caseLifecycleService.completeStep(caseId, next.id, actor)), event: 'done' };
  },

  /** Resends a sent-but-unacknowledged or overdue step (same instruction id; never a duplicate). */
  async resend(caseId: string, instructionId: string, actor: Actor): Promise<HandoffInstruction> {
    await delay(250);
    requireRole(actor, ['Planner', 'Approver', 'Admin', 'Developer', 'Warehouse Manager'], 'resend an instruction');
    const i = resendInstruction(caseId, instructionId);
    audit(mustCase(caseId), `Instruction resent: ${i.instruction}`, 'write', actor, `Same instruction ${i.id} (${i.doc}) sent again to ${i.system}, resend ${i.resends}${i.overdue ? ` · ${i.overdueHours} working h overdue` : ''} · ${i.approvalRef}`, { source: 'Instruction Dispatcher', sourceRef: i.doc, journeyStep: 6 });
    return i;
  },

  /** Finance: the invoice / receipt evidence has arrived. */
  async confirmReceipt(caseId: string, actor: Actor): Promise<void> {
    await delay(250);
    requireRole(actor, ['Finance', 'Admin'], 'confirm an outcome');
    const o = commandService.outcomeOf(caseId);
    if (!o) throw new Error(`${caseId} has no outcome to confirm`);
    if (o.status !== 'pending_invoice') throw new Error(`${caseId} is already ${o.status === 'confirmed' ? 'confirmed' : 'reconciled'}`);
    setOutcomeStatus(caseId, 'confirmed');
    audit(o.case, 'Outcome receipt confirmed', 'evidence', actor, `${o.evidenceDoc} · ${o.erpRef} · realised ${usd(o.actual)} vs predicted ${usd(o.predicted)}${o.approvalRef ? ` · ${o.approvalRef}` : ''}`, { source: 'SAP FI', sourceRef: o.erpRef, journeyStep: 9 });
  },

  /** Finance closes the outcome against the ledger; the decision history (learning) records it. */
  async reconcile(caseId: string, actor: Actor): Promise<{ historyId: string }> {
    await delay(300);
    requireRole(actor, ['Finance', 'Admin'], 'reconcile an outcome');
    const o = commandService.outcomeOf(caseId);
    if (!o) throw new Error(`${caseId} has no outcome to reconcile`);
    if (o.status !== 'confirmed') throw new Error(o.status === 'reconciled' ? `${caseId} is already reconciled` : 'Confirm the receipt first');
    const h = recordOutcome(caseId, label(actor), { forecastNet: o.predicted, realisedNet: o.actual });
    setOutcomeStatus(caseId, 'reconciled', { historyId: h.id });
    completeTasks(caseId, 'confirm_outcome');
    audit(o.case, 'Outcome reconciled', 'write', actor, `Forecast ${usd(o.predicted)} · realised ${usd(o.actual)} (${o.actual - o.predicted >= 0 ? '+' : '−'}${usd(Math.abs(o.actual - o.predicted))}) · ${o.erpRef} · learning record ${h.id}${o.snapshotId ? ` · snapshot ${o.snapshotId}` : ''}`, { source: 'Reconciliation & Learning', sourceRef: h.id, journeyStep: 10 });
    return { historyId: h.id };
  },

  /** Why Run agents is not available now (agents stopped), or null. */
  runAgentsBlock: () => agentControlsService.runAgentsBlock(),

  /**
   * Dashboard Run agents: prepares decisions for the Planner (never straight to the approver),
   * refused while the agents are stopped, at most the "max items per bulk plan" limit.
   */
  async runAgents(scope: { tenant?: string; site?: string } | undefined, actor: Actor): Promise<RunAgentsResult> {
    const block = await agentControlsService.runAgentsBlock();
    if (block) throw new Error(block);
    const limit = currentThresholds().maxItemsPerBulkPlan;
    await delay(600);
    const result = runAgentsEngine(scope, limit);
    for (const d of result.decided) {
      const c = mustCase(d.caseId);
      addTask(c, { type: 'prepare_decision', role: 'Planner', title: `Review and send ${c.id}`, note: `Prepared by the agents: ${d.decision.best.routeName} ${usd(d.decision.best.net)}` });
      audit(c, `Decision prepared by agents: ${d.decision.best.routeName}`, 'decision', { type: 'agent', id: 'plan-optimiser', name: 'Plan Optimiser' }, `${d.decision.best.routeName} ${usd(d.decision.best.net)} (+${usd(d.decision.gainOverStandard)} over the standard route) · run by ${label(actor)} · waits for the Planner · snapshot ${snapshotOf(c)}`, { source: 'Plan Optimiser', journeyStep: 4 });
    }
    return result;
  },

  /* Synchronous reads for render-time derivation. */
  declineOf: getDecline,
  escalation: getEscalation,
  sendBlockReason: (caseId: string) => {
    const c = caseStore.get(caseId);
    return c ? sendBlockReason(c) : null;
  },
  outcomeOf: (caseId: string) => commandService.outcomeOf(caseId),
  stashedProposal: stashedOrNull,
  meta: () => meta,
};

/** All steps done: the case is delivered and the outcome is reported for Finance to confirm. */
function onDelivered(c: CaseRecord) {
  if (commandService.outcomeOf(c.id)) return;
  const apr = approvalRecord(c.id);
  const d = decide(c.id);
  const predicted = apr?.net ?? d?.best.net ?? c.estimatedNetRecovery;
  const actual = realisedNetFor(c.id, predicted);
  const route = d?.all.find((r) => r.route === (apr?.route ?? d.best.route)) ?? d?.best;
  const costLines = (route?.lines ?? []).filter((l) => l.type === 'cost').map((l) => ({ label: l.label, amount: Math.round(l.amount) }));
  createOutcome({ id: c.id, predicted, actual, route: apr?.route ?? c.recommendedRoute, reportedAt: today(), costLines, approvalRef: apr?.ref ?? '', snapshotId: apr?.snapshotId ?? '' });
  addTask(c, { type: 'confirm_outcome', role: 'Finance', title: `Confirm outcome for ${c.id}`, href: `/command/actions?tab=outcomes&case=${c.id}`, hrefLabel: 'Confirm outcome', priority: 'medium', dueDays: 3 });
  audit(
    c,
    'Delivered: outcome reported',
    'write',
    { type: 'agent', id: 'outcome-collector', name: 'Outcome Collector' },
    `Every hand-off step done · predicted ${usd(predicted)} · realised ${usd(actual)} · ${costLines.length} cost lines · ${apr?.ref ?? ''} · waits for Finance to confirm`,
    { source: 'Outcome Collector', sourceRef: apr?.ref ?? c.id, journeyStep: 9 },
  );
}
