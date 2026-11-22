/**
 * Agent controls (/access/agents): how far agents may go per action type and role (autonomy),
 * the per-agent stop switches and the "Stop all agents" emergency control, and the hard rules.
 * Data: src/data/agentControls.json; agents come from the MCP / orchestration registry (mcpService).
 * Every change is written to the audit log as an access change.
 */
import controlsJson from '@/data/agentControls.json';
import type { UserRole } from '@/models/user.model';
import { delay } from './mock/mockUtils';
import { auditService } from './auditService';
import { mcpService, type RegistryEntry } from './mcpService';

export type AutonomyLevel = 'off' | 'suggest' | 'prepare' | 'act';
export type RiskTier = 'low' | 'medium' | 'high';

export interface AutonomyLevelDef {
  id: AutonomyLevel;
  label: string;
  short: string;
  description: string;
}
export interface ActionTypeDef {
  id: string;
  label: string;
  tier: RiskTier;
  /** The highest level any role may be given for this action type. */
  cap: AutonomyLevel;
  example: string;
}

export const AUTONOMY_ROLES: UserRole[] = ['Planner', 'Approver', 'Engineer', 'Finance', 'Developer', 'Executive', 'Warehouse Manager', 'Admin'];
export const AUTONOMY_LEVELS = controlsJson.levels as AutonomyLevelDef[];
export const ACTION_TYPES = controlsJson.actionTypes as ActionTypeDef[];
export const HARD_RULES: string[] = controlsJson.hardRules;
const LEVEL_ORDER: AutonomyLevel[] = ['off', 'suggest', 'prepare', 'act'];
export const levelRank = (l: AutonomyLevel) => LEVEL_ORDER.indexOf(l);
export const levelLabel = (l: AutonomyLevel) => AUTONOMY_LEVELS.find((x) => x.id === l)?.label ?? l;
/** Levels a cell may take: everything up to the action type's cap. */
export const levelsUpTo = (cap: AutonomyLevel) => AUTONOMY_LEVELS.filter((l) => levelRank(l.id) <= levelRank(cap));

/** actionTypeId → role → level */
export type AutonomyMatrix = Record<string, Record<UserRole, AutonomyLevel>>;
export interface AutonomyState {
  matrix: AutonomyMatrix;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface Actor {
  id: string;
  name: string;
  role: string;
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const defaultLevel = controlsJson.defaultLevel as AutonomyLevel;
let autonomy: AutonomyState = {
  matrix: Object.fromEntries(
    ACTION_TYPES.map((a) => [a.id, Object.fromEntries(AUTONOMY_ROLES.map((r) => [r, levelRank(defaultLevel) <= levelRank(a.cap) ? defaultLevel : a.cap]))]),
  ) as AutonomyMatrix,
  updatedAt: null,
  updatedBy: null,
};

const cloneMatrix = (m: AutonomyMatrix): AutonomyMatrix => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v }])) as AutonomyMatrix;

const snapshot = (): AutonomyState => ({ ...autonomy, matrix: cloneMatrix(autonomy.matrix) });

/** Cells above their action type's cap (the save refuses these; the data check reports them). */
export function autonomyViolations(m: AutonomyMatrix = autonomy.matrix): { action: string; role: UserRole; level: AutonomyLevel; cap: AutonomyLevel }[] {
  return ACTION_TYPES.flatMap((a) =>
    AUTONOMY_ROLES.filter((r) => levelRank(m[a.id]?.[r] ?? 'off') > levelRank(a.cap)).map((r) => ({ action: a.label, role: r, level: m[a.id][r], cap: a.cap })),
  );
}

/* ------------------------------------------------------------------ */
/* Kill switches                                                       */
/* ------------------------------------------------------------------ */

export interface EmergencyStop {
  at: string;
  by: string;
  reason: string;
  /** Agents this stop paused (agents already paused before stay paused on Resume all). */
  pausedIds: string[];
}
let emergency: EmergencyStop | null = null;

export interface AgentControlRow extends RegistryEntry {
  /** Scopes in words (service scopes, or MCP tool scopes). */
  scopeList: string[];
  /** One plain-English sentence. */
  limitText: string;
  /** Write-gated calls prepared and waiting for a person. */
  prepared: number;
  /** Paused by the current emergency stop. */
  stoppedByEmergency: boolean;
}

const TOOL_SCOPE_LABEL: Record<string, string> = { read_only: 'Read only', compute: 'Compute', write_gated: 'Write (gated)' };
const LIMITS = controlsJson.agentLimits as Record<string, string>;

function limitSentence(e: RegistryEntry): string {
  const fixed = LIMITS[e.id] ?? (e.orchId ? LIMITS[e.orchId] : undefined) ?? (e.mcpId ? LIMITS[e.mcpId] : undefined);
  if (fixed) return fixed;
  if (e.limits.length) return `${e.limits.join('. ')}.`.replace(/\.\./g, '.');
  if (e.mcpLimits) return e.mcpLimits.writesPerDay ? `At most ${e.mcpLimits.writesPerDay} gated writes a day.` : 'Read-only.';
  return 'No extra limits beyond the person it acts for.';
}

async function agents(): Promise<RegistryEntry[]> {
  return (await mcpService.listRegistry({ kind: 'agent' })).filter((e) => e.kind === 'agent');
}

function auditControl(actor: Actor, entity: string, action: string, payload: string) {
  auditService.record({
    caseId: null,
    tenant: null,
    entity,
    action,
    actionType: 'access',
    actorType: 'user',
    actorId: actor.id,
    actorName: `${actor.name} (${actor.role})`,
    source: 'Decision Workbench',
    sourceRef: 'Agent controls',
    payloadSummary: payload,
    journeyStep: null,
  });
}

/** Pause / resume one registry entry; MCP-only entries get their own audit line (orchestration ones are audited by governanceService). */
async function setOne(e: RegistryEntry, paused: boolean, reason: string, actor: Actor) {
  await mcpService.setRegistryStatus(e, paused, reason, actor);
  if (!e.orchId) auditControl(actor, `Agent · ${e.name}`, `Agent ${paused ? 'stopped' : 'resumed'}: ${e.name}`, paused ? `Reason: ${reason}` : reason);
}

export const agentControlsService = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    const off = mcpService.subscribeRegistry(listener);
    return () => {
      listeners.delete(listener);
      off();
    };
  },

  /* --- Autonomy --- */
  async getAutonomy(): Promise<AutonomyState> {
    await delay(150);
    return snapshot();
  },
  peekAutonomy: () => snapshot(),
  /** Saves the whole grid. Refuses any cell above its cap; writes one audit entry listing the changed cells. */
  async saveAutonomy(next: AutonomyMatrix, actor: Actor): Promise<{ state: AutonomyState; changed: number }> {
    await delay(300);
    const bad = autonomyViolations(next);
    if (bad.length) throw new Error(`${bad[0].role} · ${bad[0].action}: ${levelLabel(bad[0].level)} is above the cap (${levelLabel(bad[0].cap)})`);
    const changes: string[] = [];
    ACTION_TYPES.forEach((a) =>
      AUTONOMY_ROLES.forEach((r) => {
        const from = autonomy.matrix[a.id][r];
        const to = next[a.id]?.[r] ?? from;
        if (from !== to) changes.push(`${r} · ${a.label}: ${levelLabel(from)} → ${levelLabel(to)}`);
      }),
    );
    if (!changes.length) return { state: snapshot(), changed: 0 };
    autonomy = { matrix: cloneMatrix(next), updatedAt: nowIso(), updatedBy: actor.name };
    auditControl(actor, 'Agent autonomy', `Agent autonomy changed (${changes.length} ${changes.length === 1 ? 'cell' : 'cells'})`, changes.join('; '));
    emit();
    return { state: snapshot(), changed: changes.length };
  },

  /* --- Agents & kill switches --- */
  async listAgents(): Promise<{ rows: AgentControlRow[]; emergency: EmergencyStop | null }> {
    const list = await agents();
    const prepared = mcpService.preparedByAgent();
    // An emergency stop ends once every agent it paused has been resumed.
    if (emergency && !list.some((e) => emergency!.pausedIds.includes(e.id) && e.status === 'paused')) emergency = null;
    const rows = list.map((e) => ({
      ...e,
      scopeList: e.scopes.length ? e.scopes : e.toolScopes.map((s) => TOOL_SCOPE_LABEL[s] ?? s),
      limitText: limitSentence(e),
      prepared: e.mcpId ? prepared[e.mcpId] ?? 0 : 0,
      stoppedByEmergency: !!emergency && emergency.pausedIds.includes(e.id) && e.status === 'paused',
    }));
    return { rows, emergency: emergency ? { ...emergency } : null };
  },

  async setAgentRunning(entry: RegistryEntry, running: boolean, reason: string, actor: Actor): Promise<void> {
    if (!running && !reason.trim()) throw new Error('Give a reason for stopping the agent');
    await setOne(entry, !running, running ? `Resumed by ${actor.name}` : reason.trim(), actor);
    emit();
  },

  /** Emergency stop: pauses every running agent and remembers which ones, so Resume all restores only those. */
  async stopAll(reason: string, actor: Actor): Promise<number> {
    if (!reason.trim()) throw new Error('Give a reason for the emergency stop');
    const running = (await agents()).filter((e) => e.status !== 'paused');
    const why = `Emergency stop: ${reason.trim()}`;
    for (const e of running) await mcpService.setRegistryStatus(e, true, why, actor);
    const ids = [...new Set([...(emergency?.pausedIds ?? []), ...running.map((e) => e.id)])];
    emergency = { at: nowIso(), by: actor.name, reason: reason.trim(), pausedIds: ids };
    auditControl(actor, 'Agents · emergency stop', `Stop all agents: ${running.length} paused`, `${reason.trim()}. Paused: ${running.map((e) => e.name).join(', ') || 'none'}`);
    emit();
    return running.length;
  },

  /**
   * Why the Dashboard "Run agents" cannot run now, or null: an emergency stop is active, or an agent
   * the run needs (Evidence Agent, Plan Optimiser) is stopped.
   */
  async runAgentsBlock(): Promise<string | null> {
    const list = await agents();
    const stop = emergency;
    if (stop && list.some((e) => stop.pausedIds.includes(e.id) && e.status === 'paused')) {
      return `Agents are stopped: emergency stop by ${stop.by} (${stop.reason}). Resume them on Access › Agent controls.`;
    }
    const needed = list.filter((e) => (e.orchId === 'evidence-agent' || e.orchId === 'plan-optimiser') && e.status === 'paused');
    if (needed.length) {
      return `${needed.map((e) => e.name).join(' and ')} ${needed.length === 1 ? 'is' : 'are'} stopped${needed[0].statusReason ? ` (${needed[0].statusReason})` : ''}. Resume on Access › Agent controls.`;
    }
    return null;
  },

  /** Resumes the agents the emergency stop paused; agents paused before it stay paused. */
  async resumeAll(actor: Actor): Promise<number> {
    const stop = emergency;
    if (!stop) return 0;
    const toResume = (await agents()).filter((e) => stop.pausedIds.includes(e.id) && e.status === 'paused');
    for (const e of toResume) await mcpService.setRegistryStatus(e, false, `Resumed by ${actor.name}`, actor);
    emergency = null;
    auditControl(actor, 'Agents · emergency stop', `Resume all agents: ${toResume.length} resumed`, `Resumed: ${toResume.map((e) => e.name).join(', ') || 'none'}`);
    emit();
    return toResume.length;
  },
};
