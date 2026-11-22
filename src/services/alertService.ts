/**
 * Alerts: one inbox of everything broken or overdue, derived live from the owning services
 * (hand-offs and approvals, workflows, sources, credentials, conflicts) plus the notification
 * feed in src/data/alerts.json. Nothing is copied: each alert is rebuilt from its service on
 * every read, so fixing the cause (rotating a credential, resolving a conflict, sending a
 * hand-off) removes the alert. Only the user's response (acknowledged, assigned to) is kept
 * here, in a store with subscribe, so the header bell and the Alerts page always agree.
 */
import type { AlertRecord, Severity } from '@/models/domain.model';
import type { UserRole } from '@/models/user.model';
import { alertStore, caseStore, meta, userStore } from './mock/stores';
import { createCollection, delay } from './mock/mockUtils';
import { commandService } from './commandService';
import { decisionService } from './decisionService';
import { workflowService } from './workflowService';
import { conflictService } from './integrationService';
import { durationLabel, lastSuccessOf, slaLabel, sourceService } from './sourceService';
import { auditService } from './auditService';

export type AlertType = 'escalation' | 'workflow' | 'source' | 'credential' | 'conflict' | 'notification';

export const ALERT_TYPES: {
  key: AlertType;
  label: string;
  pref: string;
  description: string;
}[] = [
  {
    key: 'escalation',
    label: 'Escalations',
    pref: 'Escalations from the hand-off clock',
    description: 'A hand-off passed its time limit or an approval has waited too long.',
  },
  {
    key: 'workflow',
    label: 'Workflows',
    pref: 'Failing workflows',
    description: 'An integration workflow failed its last run or failed a run in the last 24 hours.',
  },
  {
    key: 'source',
    label: 'Sources',
    pref: 'Stale or unavailable sources',
    description: 'A connected system is failing, has stopped publishing data or is outside its freshness SLA.',
  },
  {
    key: 'credential',
    label: 'Credentials',
    pref: 'Credentials about to expire',
    description: 'A source credential expires within 14 days or has already expired.',
  },
  {
    key: 'conflict',
    label: 'Conflicts',
    pref: 'New conflicts',
    description: 'Two systems disagree on the same field and nobody has resolved it.',
  },
  {
    key: 'notification',
    label: 'Notifications',
    pref: 'Notifications',
    description: 'Platform notices: feed warnings, capacity, model and access changes.',
  },
];

export const ALERT_TYPE_LABEL = Object.fromEntries(ALERT_TYPES.map((t) => [t.key, t.label])) as Record<AlertType, string>;

export interface InboxAlert {
  id: string;
  type: AlertType;
  severity: Severity;
  title: string;
  /** System or area the alert is about. */
  system: string;
  /** Who owns the underlying record. */
  owner: string;
  /** Extra context for the detail line. */
  detail: string;
  /** When the rule fired (ISO). */
  firedAt: string;
  /** Deep link to the record (source drawer, case, workflow, conflict). */
  href: string;
  hrefLabel: string;
  /** Why it fired: the rule and the value that broke it. */
  why: string;
  /** Roles that see it (Admin sees everything). */
  roles: UserRole[];
  /** Tenant of the underlying case, when there is one (Planners only see their tenant). */
  tenant?: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  assignee: string | null;
  /** Case the alert is about, when there is one. */
  caseId?: string;
  /** Owner of the blocked step: the role that receives an escalation, and the person when known. */
  ownerRole: UserRole;
  ownerName: string;
  /** Facts for the drafted escalation message; absent for types that cannot be escalated. */
  escalation?: EscalationFacts;
  /** Last escalation sent from this alert (the alert stays open). */
  escalatedAt?: string;
  escalatedTo?: string;
  escalatedBy?: string;
  escalationCount: number;
}

/** What an escalation says: what is blocked, since when, the impact and what is needed. */
export interface EscalationFacts {
  /** Short name of the blocked step, for the task title. */
  step: string;
  blocked: string;
  /** ISO time the step became blocked. */
  since: string;
  impact: string;
  needed: string;
}

/** Alert types that can be escalated to the owner of the blocked step. */
export const ESCALATABLE_TYPES: AlertType[] = ['escalation', 'source', 'credential', 'conflict'];
export const canEscalate = (a: Pick<InboxAlert, 'type' | 'escalation'>) => ESCALATABLE_TYPES.includes(a.type) && !!a.escalation;

export interface AlertScope {
  tenant?: string;
}

/* --------------------------------------------------------------- user responses */

interface AlertResponse {
  id: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  assignee?: string | null;
  escalatedAt?: string;
  escalatedTo?: string;
  escalatedBy?: string;
  escalationCount?: number;
}

const responses = createCollection<AlertResponse>([]);

function respond(id: string, patch: Omit<AlertResponse, 'id'>) {
  if (responses.get(id)) responses.update(id, patch);
  else responses.insert({ id, ...patch });
}

/* --------------------------------------------------------------- preferences */

export type PrefKey = AlertType | 'digest';
export type NotificationPrefs = Record<PrefKey, boolean>;
const DEFAULT_PREFS: NotificationPrefs = {
  escalation: true,
  workflow: true,
  source: true,
  credential: true,
  conflict: false,
  notification: true,
  digest: false,
};
const prefs = createCollection<{ id: string; prefs: NotificationPrefs }>([]);

/* --------------------------------------------------------------- rules */

const DAY = 864e5;
const AS_OF_MS = Date.parse(meta.asOf);
const iso = (ms: number) => new Date(ms).toISOString();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Approvals waiting longer than this are escalated. */
export const APPROVAL_LIMIT_DAYS = 5;
/** Credentials expiring within this window raise an alert. */
export const CREDENTIAL_WINDOW_DAYS = 14;

const SEV_FROM_NOTICE: Record<AlertRecord['severity'], Severity> = {
  danger: 'high',
  warning: 'medium',
  info: 'low',
};
const person = (s: string) => s.split('·')[0].trim();

type Draft = Omit<
  InboxAlert,
  'acknowledged' | 'acknowledgedAt' | 'acknowledgedBy' | 'assignee' | 'escalatedAt' | 'escalatedTo' | 'escalatedBy' | 'escalationCount' | 'ownerName' | 'ownerRole'
> & { ownerRole?: UserRole; ownerName?: string };

const fmtUsd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
/** A connected-by label's person mapped to their role; integration owners outside the user list are Developers. */
function roleOfPerson(name: string): UserRole {
  return userStore.all().find((u) => u.name === name)?.role ?? 'Developer';
}
/** First user with the role (the tenant's user when there is one), for the "to" line. */
function personForRole(role: UserRole, tenant?: string): string | undefined {
  const users = userStore.all().filter((u) => u.role === role);
  return (users.find((u) => tenant && u.tenant === tenant) ?? users[0])?.name;
}

/** Role that owns a hand-off instruction, from its owner label ("Repair centre lead (Engineer)", "Warehouse Manager · Warehouse 1"). */
function ownerRole(owner: string): UserRole {
  if (/engineer/i.test(owner)) return 'Engineer';
  if (/warehouse manager/i.test(owner)) return 'Warehouse Manager';
  if (/^finance/i.test(owner)) return 'Finance';
  return 'Planner';
}

async function escalations(): Promise<Draft[]> {
  // Hand-off time limits come from the decision engine's instructions (same as the Case page Execution tab).
  const [overdue, approvals] = await Promise.all([decisionService.overdueInstructions(), commandService.approvals()]);
  const out: Draft[] = [];
  for (const i of overdue) {
    const c = caseStore.get(i.caseId);
    const hours = Math.round(i.overdueHours);
    out.push({
      id: `esc-handoff-${i.id}`,
      type: 'escalation',
      severity: i.overdueHours >= 9 ? 'high' : 'medium',
      title: `${i.caseId} · escalated: ${i.module.split('·').pop()?.trim() ?? i.module}`,
      system: i.system,
      owner: i.owner,
      detail: `${i.instruction} · ${i.doc} · passed its ${i.timeLimit} limit by ${hours < 1 ? 'under 1' : hours} working h`,
      firedAt: i.dueAt ?? meta.asOf,
      href: `/product/case/${i.caseId}`,
      hrefLabel: 'Open case',
      why: `${i.system} had ${i.timeLimit} to complete "${i.instruction}" (${i.doc}) after approval ${i.approvalRef}. The owner ${i.status === 'acknowledged' ? 'acknowledged it but has not finished' : 'has not acknowledged it yet'}; it is ${hours < 1 ? 'under 1' : hours} working h past due. Escalations go to the owning role, Approvers and Admins; a full working day (9 h) late is High.`,
      roles: [...new Set<UserRole>([ownerRole(i.owner), 'Approver', 'Admin'])],
      tenant: c?.tenant,
      caseId: i.caseId,
      ownerRole: ownerRole(i.owner),
      ownerName: i.owner,
      escalation: {
        step: `${i.instruction} in ${i.system}`,
        blocked: `${i.caseId}${c ? ` (${c.productName})` : ''}: "${i.instruction}" in ${i.system} (${i.doc}), sent with approval ${i.approvalRef}`,
        since: i.dueAt ?? meta.asOf,
        impact: `${hours < 1 ? 'Under 1' : hours} working h past its ${i.timeLimit} limit${c ? `; ${fmtUsd(c.estimatedNetRecovery)} net recovery waits on this step` : ''}.`,
        needed: `${i.status === 'acknowledged' ? 'Finish' : 'Acknowledge and finish'} the instruction in ${i.system}, or reply with a new completion date.`,
      },
    });
  }
  for (const a of approvals) {
    if (a.waitingDays < APPROVAL_LIMIT_DAYS) continue;
    const value = a.case.estimatedNetRecovery;
    out.push({
      id: `esc-approval-${a.id}`,
      type: 'escalation',
      severity: value >= 1000 ? 'high' : 'medium',
      title: `${a.id} · approval delayed, value at risk`,
      system: `${a.tier} approval`,
      owner: a.submittedBy,
      detail: `${a.case.productName} · ${value < 0 ? '-' : ''}$${Math.abs(Math.round(value)).toLocaleString('en-US')} net recovery waiting ${plural(a.waitingDays, 'day')}`,
      firedAt: iso(Date.parse(a.submittedAt) + APPROVAL_LIMIT_DAYS * DAY),
      href: `/product/case/${a.id}`,
      hrefLabel: 'Open case',
      why: `Approvals escalate after ${APPROVAL_LIMIT_DAYS} days. This one was submitted ${a.submittedAt.slice(0, 10)} and has waited ${plural(a.waitingDays, 'day')}. High when the net recovery is $1,000 or more.`,
      roles: ['Approver', 'Planner', 'Admin'],
      tenant: a.case.tenant,
      caseId: a.id,
      ownerRole: 'Approver',
      ownerName: personForRole('Approver') ?? 'Approver',
      escalation: {
        step: `Decide the ${a.tier} approval`,
        blocked: `Approval of ${a.id} (${a.case.productName}), ${a.tier}`,
        since: iso(Date.parse(a.submittedAt) + APPROVAL_LIMIT_DAYS * DAY),
        impact: `${fmtUsd(value)} net recovery has waited ${plural(a.waitingDays, 'day')} for a decision; the case cannot be handed off until it is approved.`,
        needed: 'Approve, decline or ask for evidence on the case.',
      },
    });
  }
  return out;
}

async function workflows(): Promise<Draft[]> {
  const list = await workflowService.all();
  const out: Draft[] = [];
  for (const w of list) {
    const failing = w.status === 'Failing' || w.lastRunStatus === 'Failed';
    const lastFailed = w.runs.find((r) => r.status === 'Failed');
    const recentFail = lastFailed && AS_OF_MS - Date.parse(`${lastFailed.startedAt}Z`) <= DAY;
    if (!failing && !recentFail) continue;
    const at = lastFailed ? `${lastFailed.startedAt}Z` : w.lastRunAt ? `${w.lastRunAt}Z` : meta.asOf;
    out.push({
      id: `wf-${w.id}`,
      type: 'workflow',
      severity: failing ? 'high' : 'low',
      title: failing ? `${w.name} is failing` : `${w.name} failed a run, then recovered`,
      system: w.sourceSystemName,
      owner: w.owner,
      detail: failing ? `${w.code} · last run failed · ${w.successRate}% success` : `${w.code} · run ${lastFailed?.id ?? ''} failed, later runs succeeded`,
      firedAt: at,
      href: '/integration/studio',
      hrefLabel: 'Open workflow studio',
      why: failing
        ? `${w.name} is marked ${w.status === 'Failing' ? 'Failing' : 'with a failed last run'}. Records from ${w.sourceSystemName} stop flowing until it runs cleanly.`
        : `Run ${lastFailed?.id ?? ''} failed in the last 24 hours. The next runs succeeded, so this is Low; acknowledge it once you have checked the failed records.`,
      roles: ['Developer', 'Admin'],
    });
  }
  return out;
}

function sources(): Draft[] {
  const out: Draft[] = [];
  for (const s of sourceService.allNow()) {
    if (s.status === 'paused') continue;
    const lastOk = lastSuccessOf(s);
    const freshMin = Math.max(0, (AS_OF_MS - Date.parse(lastOk)) / 6e4);
    const breached = s.slaMinutes != null && freshMin > s.slaMinutes;
    if (s.status !== 'failed' && s.status !== 'stale' && !breached) continue;
    const owner = person(s.connectedBy);
    const kind = s.status === 'failed' ? 'unavailable' : s.status === 'stale' ? 'feed is stale' : 'outside its freshness SLA';
    out.push({
      id: `src-${s.id}`,
      type: 'source',
      severity: s.status === 'failed' ? 'high' : 'medium',
      title: `${s.name} · ${kind}`,
      system: s.category,
      owner,
      detail: `${s.statusNote ?? `Last data ${durationLabel(freshMin)} ago`} · SLA ${slaLabel(s.slaMinutes).toLowerCase()}`,
      firedAt: s.status === 'failed' ? s.lastSyncAt : iso(Date.parse(lastOk) + (s.slaMinutes ?? 0) * 6e4),
      href: `/integration/map?source=${encodeURIComponent(s.id)}`,
      hrefLabel: 'Open source',
      why: `${s.name} last delivered data ${durationLabel(freshMin)} ago against an SLA of ${slaLabel(s.slaMinutes).toLowerCase()}${
        s.status === 'failed' ? '; its latest syncs failed' : s.status === 'stale' ? '; the provider has published nothing new' : ''
      }. Decisions that read it use the last known values. Failing sources are High, stale or late ones Medium.`,
      roles: ['Developer', 'Admin', 'Planner'],
      ownerRole: roleOfPerson(owner),
      ownerName: owner,
      escalation: {
        step: `${s.name}: ${kind}`,
        blocked: `Data from ${s.name} (${s.category}): ${kind}`,
        since: s.status === 'failed' ? s.lastSyncAt : iso(Date.parse(lastOk) + (s.slaMinutes ?? 0) * 6e4),
        impact: `Last data ${durationLabel(freshMin)} ago against an SLA of ${slaLabel(s.slaMinutes).toLowerCase()}. Decisions that read it use the last known values.`,
        needed: s.status === 'failed' ? 'Restore the connection and run a sync, or tell us when it will be back.' : 'Get the feed publishing again within its SLA, or agree a new SLA.',
      },
    });
  }
  return out;
}

function credentials(): Draft[] {
  const out: Draft[] = [];
  for (const s of sourceService.allNow()) {
    if (!s.credentialExpiresAt) continue;
    const exp = Date.parse(s.credentialExpiresAt);
    const days = Math.ceil((exp - AS_OF_MS) / DAY);
    if (days > CREDENTIAL_WINDOW_DAYS) continue;
    const expired = days <= 0;
    out.push({
      id: `cred-${s.id}`,
      type: 'credential',
      severity: expired ? 'high' : days <= 5 ? 'medium' : 'low',
      title: expired ? `${s.name} · credential expired` : `${s.name} · credential expires in ${plural(days, 'day')}`,
      system: s.category,
      owner: person(s.connectedBy),
      detail: `${s.authType} · ${expired ? 'expired' : 'expires'} ${s.credentialExpiresAt.slice(0, 10)}`,
      firedAt: expired ? s.credentialExpiresAt : iso(Math.max(exp - CREDENTIAL_WINDOW_DAYS * DAY, AS_OF_MS - 6 * DAY)),
      href: `/integration/map?source=${encodeURIComponent(s.id)}`,
      hrefLabel: 'Open source',
      why: `Credentials raise an alert ${CREDENTIAL_WINDOW_DAYS} days before they expire. ${s.name} uses ${s.authType}${
        expired ? ' and the credential has expired, so syncs are rejected' : `, expiring ${s.credentialExpiresAt.slice(0, 10)}`
      }. Rotate it from the source's actions menu. Expired is High, 5 days or less Medium.`,
      roles: ['Developer', 'Admin'],
      ownerRole: roleOfPerson(person(s.connectedBy)),
      ownerName: person(s.connectedBy),
      escalation: {
        step: `Rotate the ${s.name} credential`,
        blocked: `${s.name} syncs (${s.authType} credential)`,
        since: expired ? s.credentialExpiresAt : iso(Math.max(exp - CREDENTIAL_WINDOW_DAYS * DAY, AS_OF_MS - 6 * DAY)),
        impact: expired ? 'The credential has expired, so every sync is rejected.' : `The credential expires ${s.credentialExpiresAt.slice(0, 10)}; syncs stop after that.`,
        needed: 'Rotate the credential from the source actions menu.',
      },
    });
  }
  return out;
}

async function conflicts(): Promise<Draft[]> {
  const list = await conflictService.list({ status: 'unresolved' });
  return list.map((c) => {
    const systems = c.values.map((v) => v.system);
    const owner = sourceService.allNow().find((s) => s.name === systems[0]);
    const ownerName = owner ? person(owner.connectedBy) : 'Integration team';
    const isCase = !!caseStore.get(c.entityId);
    return {
      id: `cfl-${c.id}`,
      type: 'conflict' as const,
      severity: c.severity,
      title: `${c.id} · ${c.field.replace(/_/g, ' ')} differs${c.status === 'escalated' ? ' (escalated)' : ''}`,
      system: systems.join(' and '),
      owner: owner ? person(owner.connectedBy) : 'Integration team',
      detail: `${c.entityType} · ${c.entityId} ${c.entityLabel}`,
      firedAt: c.detectedAt,
      href: `/integration/map?source=${encodeURIComponent(systems[0])}&panel=conflicts`,
      hrefLabel: 'Open conflict',
      why: `${systems.join(' and ')} report different ${c.field} values (${c.values.map((v) => `${v.system}: ${v.value}`).join('; ')}). Decisions on ${c.entityId} use the trusted system until someone resolves it.`,
      roles: ['Developer', 'Admin', 'Planner'],
      tenant: caseStore.get(c.entityId)?.tenant,
      caseId: isCase ? c.entityId : undefined,
      ownerRole: owner ? roleOfPerson(ownerName) : 'Developer',
      ownerName,
      escalation: {
        step: `Resolve the ${c.field.replace(/_/g, ' ')} conflict${isCase ? '' : ` on ${c.entityId}`}`,
        blocked: `${c.field.replace(/_/g, ' ')} on ${c.entityType} ${c.entityId}: ${systems.join(' and ')} disagree (${c.values.map((v) => `${v.system}: ${v.value}`).join('; ')})`,
        since: c.detectedAt,
        impact: `Decisions on ${c.entityId} use the trusted system's value until someone resolves it.`,
        needed: 'Confirm which value is right and resolve the conflict.',
      },
    };
  });
}

function notifications(): Draft[] {
  return alertStore.all().map((a) => ({
    id: `ntf-${a.id}`,
    type: 'notification' as const,
    severity: SEV_FROM_NOTICE[a.severity],
    title: a.title,
    system: a.source,
    owner: a.source,
    detail: a.body,
    firedAt: a.createdAt,
    href: a.link,
    hrefLabel: 'Open',
    why: `Notification from ${a.source}: ${a.body}`,
    roles: a.roles,
    ownerRole: 'Admin' as UserRole,
    ownerName: a.source,
  }));
}

const visibleTo = (role: UserRole, scope: AlertScope) => (a: Pick<InboxAlert, 'roles' | 'tenant'>) =>
  (role === 'Admin' || a.roles.includes(role)) && (!scope.tenant || !a.tenant || a.tenant === scope.tenant);

const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

async function derive(): Promise<InboxAlert[]> {
  const [esc, wf, cfl] = await Promise.all([escalations(), workflows(), conflicts()]);
  const drafts = [...esc, ...wf, ...sources(), ...credentials(), ...cfl, ...notifications()];
  return drafts.map((d) => {
    const r = responses.get(d.id);
    const notice = d.type === 'notification' ? alertStore.get(d.id.slice(4)) : undefined;
    const acknowledged = !!r?.acknowledgedAt || !!notice?.read;
    return {
      ...d,
      ownerRole: d.ownerRole ?? 'Admin',
      ownerName: d.ownerName ?? d.owner,
      acknowledged,
      acknowledgedAt: r?.acknowledgedAt,
      acknowledgedBy: r?.acknowledgedBy,
      assignee: r?.assignee ?? null,
      escalatedAt: r?.escalatedAt,
      escalatedTo: r?.escalatedTo,
      escalatedBy: r?.escalatedBy,
      escalationCount: r?.escalationCount ?? 0,
    };
  });
}

/** Newest first within severity. */
const byUrgency = (a: InboxAlert, b: InboxAlert) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.firedAt.localeCompare(a.firedAt);

function combine(...subs: ((l: () => void) => () => void)[]) {
  return (l: () => void) => {
    const offs = subs.map((s) => s(l));
    return () => offs.forEach((o) => o());
  };
}

export const alertService = {
  /** Refetch when any alert source or a response changes. */
  subscribe: combine(alertStore.subscribe, responses.subscribe, commandService.subscribe, workflowService.subscribe, conflictService.subscribe, sourceService.subscribe),

  /** Every alert the role can see in its tenant scope, open and acknowledged, most urgent first. */
  async inbox(role: UserRole, scope: AlertScope = {}): Promise<InboxAlert[]> {
    const all = await derive();
    return all.filter(visibleTo(role, scope)).sort(byUrgency);
  },

  /** Open (unacknowledged) alerts for the role: the header bell and the sidebar badge. */
  async openCount(role: UserRole, scope: AlertScope = {}): Promise<number> {
    return (await alertService.inbox(role, scope)).filter((a) => !a.acknowledged).length;
  },

  async acknowledge(id: string, by: string): Promise<void> {
    await delay(150);
    if (id.startsWith('ntf-') && alertStore.get(id.slice(4))) alertStore.update(id.slice(4), { read: true });
    respond(id, {
      acknowledgedAt: new Date().toISOString(),
      acknowledgedBy: by,
    });
  },

  async reopen(id: string): Promise<void> {
    await delay(120);
    if (id.startsWith('ntf-') && alertStore.get(id.slice(4))) alertStore.update(id.slice(4), { read: false });
    respond(id, { acknowledgedAt: undefined, acknowledgedBy: undefined });
  },

  async assign(id: string, assignee: string): Promise<void> {
    await delay(180);
    respond(id, { assignee });
  },

  /** Drafted escalation text: what is blocked, since when, the impact and what is needed. Plain text. */
  escalationMessage(a: InboxAlert): string {
    const f = a.escalation;
    if (!f) return '';
    return [`Blocked: ${f.blocked}.`, `Since: ${f.since.slice(0, 16).replace('T', ' ')} UTC.`, `Impact: ${f.impact}`, `Needed: ${f.needed}`].join('\n');
  },

  /** Recipient label for the owner of the blocked step: "Dev Kapoor (Engineer)", "Repair centre lead (Engineer)". */
  ownerLabel: (a: Pick<InboxAlert, 'ownerName' | 'ownerRole' | 'tenant'>) => {
    const n = a.ownerName;
    if (!n || n === a.ownerRole) return `${personForRole(a.ownerRole, a.tenant) ?? a.ownerRole} (${a.ownerRole})`;
    if (n.includes(`(${a.ownerRole})`) || n.startsWith(a.ownerRole)) return n;
    return `${n} (${a.ownerRole})`;
  },

  /** Recipient label when the escalation goes to another role than the owner. */
  roleLabel: (role: UserRole, tenant?: string) => `${personForRole(role, tenant) ?? role} (${role})`,

  /** Open alerts about one case that can be escalated (for an Escalate button on the Case page). */
  async escalatableForCase(caseId: string, role: UserRole = 'Admin'): Promise<InboxAlert[]> {
    const all = await alertService.inbox(role);
    return all.filter((a) => a.caseId === caseId && !a.acknowledged && canEscalate(a));
  },

  /**
   * Sends an escalation: a My work › Tasks item for the owner role (linked to the case or source),
   * an audit entry, and "Escalated to <owner>" on the alert, which stays open. An alert that was
   * already escalated needs `again: true` (the UI asks first), so a double click cannot send twice.
   */
  async escalate(
    a: InboxAlert,
    input: { message: string; note?: string; toRole?: UserRole; by: { id: string; name: string; role: UserRole }; again?: boolean },
  ): Promise<{ taskId: string; to: string }> {
    if (!canEscalate(a)) throw new Error('This alert cannot be escalated');
    const prev = responses.get(a.id);
    if (prev?.escalatedAt && !input.again) throw new Error(`Already escalated to ${prev.escalatedTo} at ${prev.escalatedAt.slice(0, 16).replace('T', ' ')} UTC`);
    const message = input.message.trim();
    if (!message) throw new Error('The escalation message is empty');
    const toRole = input.toRole ?? a.ownerRole;
    const to = toRole === a.ownerRole ? alertService.ownerLabel(a) : alertService.roleLabel(toRole, a.tenant);
    const note = input.note?.trim();
    const body = [message, note ? `Note from ${input.by.name}: ${note}` : ''].filter(Boolean).join('\n');
    const caseLink = a.href.startsWith('/product/case/');
    const task = await commandService.addTask({
      title: `Escalation: ${a.escalation!.step}${a.caseId ? ` for ${a.caseId}` : ''}`,
      role: toRole,
      type: 'escalation',
      caseId: a.caseId ?? null,
      priority: a.severity,
      ...(caseLink ? {} : { href: a.href, hrefLabel: a.hrefLabel }),
      subject: a.system,
      note: body,
      createdBy: `${input.by.name} (${input.by.role})`,
    });
    auditService.record({
      caseId: a.caseId ?? null,
      tenant: a.tenant ?? null,
      entity: a.caseId ? `${a.caseId} · ${a.system}` : a.system,
      action: `Escalated to ${to}: ${a.title}`,
      actionType: 'write',
      actorType: 'user',
      actorId: input.by.id,
      actorName: `${input.by.name} (${input.by.role})`,
      source: 'Alerts',
      sourceRef: `${a.id} → ${task.id}`,
      payloadSummary: body.replace(/\n/g, ' '),
      journeyStep: null,
    });
    respond(a.id, {
      escalatedAt: new Date().toISOString(),
      escalatedTo: to,
      escalatedBy: input.by.name,
      escalationCount: (prev?.escalationCount ?? 0) + 1,
    });
    return { taskId: task.id, to };
  },

  /* Notification feed (Signals page). */
  async list(role: UserRole): Promise<AlertRecord[]> {
    await delay(180);
    return alertStore
      .all()
      .filter((a) => role === 'Admin' || a.roles.includes(role))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async markRead(id: string): Promise<void> {
    await delay(120);
    alertStore.update(id, { read: true });
  },

  async markAllRead(role: UserRole): Promise<void> {
    await delay(200);
    alertStore
      .all()
      .filter((a) => role === 'Admin' || a.roles.includes(role))
      .forEach((a) => !a.read && alertStore.update(a.id, { read: true }));
  },

  unreadCount: (role: UserRole) =>
    alertStore
      .all()
      .filter((a) => role === 'Admin' || a.roles.includes(role))
      .filter((a) => !a.read).length,

  /* Personal notification preferences (Settings › Profile). */
  /** Stable reference until changed, so it can back useSyncExternalStore. */
  preferences: (userId: string): NotificationPrefs => prefs.get(userId)?.prefs ?? DEFAULT_PREFS,
  async setPreference(userId: string, key: PrefKey, on: boolean): Promise<NotificationPrefs> {
    await delay(120);
    const next = { ...alertService.preferences(userId), [key]: on };
    if (prefs.get(userId)) prefs.update(userId, { prefs: next });
    else prefs.insert({ id: userId, prefs: next });
    return next;
  },
  subscribePreferences: (l: () => void) => prefs.subscribe(l),
};
