/**
 * Audit & provenance: the hash-chained fetch / decision log (src/data/audit.json)
 * and the evidence gaps derived from cases still collecting evidence.
 */
import auditJson from '@/data/audit.json';
import type { CaseRecord, Paged } from '@/models/domain.model';
import { caseStore, meta, userStore } from './mock/stores';
import { createCollection, delay, queryList, type SortDir } from './mock/mockUtils';
import { caseService } from './caseService';

export type AuditActionType = 'fetch' | 'decision' | 'approval' | 'override' | 'write' | 'evidence' | 'access';
export type AuditActorType = 'user' | 'agent' | 'service' | 'system';

export interface AuditEntry {
  id: string;
  timestamp: string;
  caseId: string | null;
  tenant: string | null;
  entity: string;
  action: string;
  actionType: AuditActionType;
  actorType: AuditActorType;
  actorId: string;
  actorName: string;
  source: string;
  sourceRef: string;
  payloadSummary: string;
  journeyStep: number | null;
  hash: string;
  prevHash: string;
}

export const AUDIT_ACTION_LABEL: Record<AuditActionType, string> = {
  fetch: 'Record fetch',
  decision: 'Automated decision',
  approval: 'Approval',
  override: 'Human override',
  write: 'System write',
  evidence: 'Evidence',
  access: 'Access change',
};

const auditStore = createCollection<AuditEntry>(auditJson as AuditEntry[]);

/** Small non-cryptographic digest so new entries extend the chain in the browser. */
function digest(input: string): string {
  let out = '';
  let h1 = 0x811c9dc5;
  for (let round = 0; round < 8; round += 1) {
    for (let i = 0; i < input.length; i += 1) {
      h1 ^= input.charCodeAt(i) + round;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    out += h1.toString(16).padStart(8, '0');
  }
  return out;
}

export interface AuditQuery {
  search?: string;
  source?: string;
  actionType?: AuditActionType | 'all';
  actor?: string;
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
}

export interface AuditFacets {
  sources: string[];
  actors: { id: string; name: string }[];
  total: number;
}

const searchFields: (keyof AuditEntry)[] = ['id', 'entity', 'action', 'actorName', 'source', 'sourceRef', 'payloadSummary', 'hash'];

function filtered(q: AuditQuery) {
  return queryList(auditStore.all(), {
    search: q.search,
    searchFields,
    filters: { source: q.source, actionType: q.actionType, actorId: q.actor },
    sortBy: 'timestamp',
    sortDir: q.sortDir ?? 'desc',
    page: q.page,
    pageSize: q.pageSize,
  });
}

export const shortHash = (h: string) => `0x${h.slice(0, 4)}…${h.slice(-4)}`;

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* ------------------------------------------------------------------ */
/* Evidence gaps                                                       */
/* ------------------------------------------------------------------ */

export interface EvidenceGap {
  id: string;
  caseId: string;
  productName: string;
  tenant: string;
  location: string;
  item: string;
  kind: 'missing' | 'no_provenance';
  sourceExpected: string;
  ageDays: number;
  ownerId: string;
  ownerName: string;
  blocking: boolean;
  requestedAt: string | null;
  evidenceCompleteness: number;
}

const GAP_STAGES = new Set(['awaiting_inspection', 'needs_information']);
const requested = new Map<string, string>();
const requestListeners = new Set<() => void>();

const ageFrom = (iso: string) => Math.max(0, Math.round((new Date(meta.asOf).getTime() - new Date(iso).getTime()) / 864e5));

function gapsForCase(c: CaseRecord): EvidenceGap[] {
  const num = Number(c.id.slice(3));
  const base = {
    caseId: c.id,
    productName: c.productName,
    tenant: c.tenant,
    location: c.location,
    ageDays: ageFrom(c.receivedDate),
    evidenceCompleteness: c.evidenceCompleteness,
  };
  const ownerName = (id: string) => userStore.get(id)?.name ?? 'Unassigned';
  const out: Omit<EvidenceGap, 'requestedAt'>[] = [];
  const remainingLife = (c.blockedReason ?? '').toLowerCase().includes('remaining-life');
  if (remainingLife) {
    out.push({ ...base, id: `${c.id}-rl`, item: 'Remaining-life estimate', kind: 'missing', sourceExpected: 'EAM', ownerId: c.ownerId, ownerName: ownerName(c.ownerId), blocking: true });
    if (c.evidenceCompleteness < 70) {
      out.push({ ...base, id: `${c.id}-sh`, item: 'Service history record', kind: 'no_provenance', sourceExpected: 'EAM', ownerId: c.ownerId, ownerName: ownerName(c.ownerId), blocking: false });
    }
  } else {
    out.push({ ...base, id: `${c.id}-cg`, item: 'Condition grade (inspection report)', kind: 'missing', sourceExpected: 'Test bench', ownerId: 'u-engineer', ownerName: ownerName('u-engineer'), blocking: true });
    if (c.evidenceCompleteness < 45) {
      out.push({ ...base, id: `${c.id}-tt`, item: 'Test-bench telemetry', kind: 'missing', sourceExpected: 'Test bench', ownerId: 'u-engineer', ownerName: ownerName('u-engineer'), blocking: false });
    }
  }
  if (num % 3 === 0) {
    out.push({ ...base, id: `${c.id}-bom`, item: 'Bill of materials', kind: 'no_provenance', sourceExpected: 'PLM / quality', ownerId: 'u-developer', ownerName: ownerName('u-developer'), blocking: false });
  }
  if (num % 4 === 1) {
    out.push({ ...base, id: `${c.id}-bin`, item: 'Bin location scan', kind: 'no_provenance', sourceExpected: 'WMS', ownerId: c.location === 'Warehouse 2' ? 'u-wm-2' : 'u-wm-1', ownerName: ownerName(c.location === 'Warehouse 2' ? 'u-wm-2' : 'u-wm-1'), blocking: false });
  }
  // A case in "Needs information" already has its blocking evidence requested (that is what moved it
  // there), so those gaps count as requested even before anyone presses "Request" in this session.
  const alreadyRequested = c.stage === 'needs_information' ? `${c.receivedDate}T12:00:00Z` : null;
  return out.map((g) => ({ ...g, requestedAt: requested.get(g.id) ?? (g.blocking ? alreadyRequested : null) }));
}

type GapActor = { id: string; name: string; role: string };

export interface GapQuery {
  search?: string;
  source?: string;
  blocking?: 'all' | 'yes' | 'no';
  kind?: 'all' | EvidenceGap['kind'];
}

export interface GapSummary {
  open: number;
  casesBlocked: number;
  oldestDays: number;
  oldestCaseId: string | null;
  requested: number;
}

function allGaps(): EvidenceGap[] {
  return caseStore
    .all()
    .filter((c) => GAP_STAGES.has(c.stage))
    .flatMap(gapsForCase);
}

/* ------------------------------------------------------------------ */

export const auditService = {
  subscribe: auditStore.subscribe,

  async list(q: AuditQuery = {}): Promise<Paged<AuditEntry>> {
    await delay();
    return filtered(q);
  },

  async facets(): Promise<AuditFacets> {
    await delay(120);
    const rows = auditStore.all();
    const actors = new Map<string, string>();
    rows.forEach((r) => actors.set(r.actorId, r.actorName));
    return {
      sources: Array.from(new Set(rows.map((r) => r.source))).sort(),
      actors: Array.from(actors, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      total: rows.length,
    };
  },

  async get(id: string): Promise<AuditEntry | undefined> {
    await delay(120);
    return auditStore.get(id);
  },

  /** Appends a new chained entry (used by governance actions and evidence requests). */
  record(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'hash' | 'prevHash'>): AuditEntry {
    const latest = [...auditStore.all()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
    const prevHash = latest?.hash ?? '0'.repeat(64);
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const maxId = Math.max(...auditStore.all().map((r) => Number(r.id.replace('AUD-', ''))), 24000);
    const hash = digest(prevHash + JSON.stringify({ timestamp, ...entry }));
    return auditStore.insert({ ...entry, id: `AUD-${maxId + 1}`, timestamp, hash, prevHash });
  },

  /** CSV of every entry matching the current filters (not just the visible page). */
  async exportCsv(q: AuditQuery = {}): Promise<string> {
    await delay(200);
    const rows = filtered({ ...q, page: undefined, pageSize: undefined }).items;
    const header = ['Id', 'Timestamp (UTC)', 'Asset / Entity', 'Action Performed', 'Action type', 'Actor / User', 'Source system', 'Source reference', 'Payload summary', 'Journey step', 'Provenance hash', 'Previous hash'];
    const lines = rows.map((r) =>
      [r.id, r.timestamp, r.entity, r.action, AUDIT_ACTION_LABEL[r.actionType], r.actorName, r.source, r.sourceRef, r.payloadSummary, r.journeyStep ?? '', r.hash, r.prevHash].map(csvCell).join(','),
    );
    return [header.join(','), ...lines].join('\n');
  },

  /* Evidence gaps */
  subscribeGaps(listener: () => void) {
    requestListeners.add(listener);
    const off = caseStore.subscribe(listener);
    return () => {
      requestListeners.delete(listener);
      off();
    };
  },

  async listGaps(q: GapQuery = {}): Promise<{ items: EvidenceGap[]; summary: GapSummary; sources: string[] }> {
    await delay();
    const gaps = allGaps();
    const items = queryList(gaps, {
      search: q.search,
      searchFields: ['caseId', 'productName', 'item', 'ownerName', 'sourceExpected'],
      filters: { sourceExpected: q.source, kind: q.kind },
      predicate: q.blocking && q.blocking !== 'all' ? (g) => g.blocking === (q.blocking === 'yes') : undefined,
      sortBy: (g) => g.ageDays * 10 + (g.blocking ? 1 : 0),
      sortDir: 'desc',
    }).items;
    const oldest = gaps.reduce<EvidenceGap | null>((m, g) => (!m || g.ageDays > m.ageDays ? g : m), null);
    return {
      items,
      sources: Array.from(new Set(gaps.map((g) => g.sourceExpected))).sort(),
      summary: {
        open: gaps.length,
        casesBlocked: new Set(gaps.filter((g) => g.blocking).map((g) => g.caseId)).size,
        oldestDays: oldest?.ageDays ?? 0,
        oldestCaseId: oldest?.caseId ?? null,
        requested: gaps.filter((g) => g.requestedAt).length,
      },
    };
  },

  /** Requests the evidence: moves the case to "needs information" and logs it. */
  async requestEvidence(gap: EvidenceGap, actor: GapActor): Promise<void> {
    await auditService.requestEvidenceMany([gap], actor);
  },

  /** Bulk request: each case moves to "needs information" once; one audit entry per gap. */
  async requestEvidenceMany(gaps: EvidenceGap[], actor: GapActor): Promise<number> {
    const caseIds = Array.from(new Set(gaps.map((g) => g.caseId))).filter((id) => caseStore.get(id)?.stage !== 'needs_information');
    await Promise.all(caseIds.map((id) => caseService.requestEvidence(id)));
    if (!caseIds.length) await delay(250);
    const at = new Date().toISOString();
    gaps.forEach((gap) => {
      requested.set(gap.id, at);
      auditService.record({
        caseId: gap.caseId,
        tenant: gap.tenant,
        entity: `${gap.caseId} · ${gap.productName}`,
        action: `Evidence requested: ${gap.item.toLowerCase()}`,
        actionType: 'evidence',
        actorType: 'user',
        actorId: actor.id,
        actorName: `${actor.name} (${actor.role})`,
        source: gap.sourceExpected,
        sourceRef: 'Evidence request',
        payloadSummary: `Requested from ${gap.ownerName}; ${gap.blocking ? 'blocking' : 'not blocking'} the plan`,
        journeyStep: 1,
      });
    });
    requestListeners.forEach((l) => l());
    return gaps.length;
  },
};
