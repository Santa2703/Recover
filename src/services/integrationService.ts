/**
 * Connection Fabric services: event stream, conflict queue, canonical models and manual import.
 * Backed by in-memory collections seeded from src/data/*.json (see mock/mockUtils).
 */
import eventsJson from '@/data/events.json';
import conflictsJson from '@/data/conflicts.json';
import modelsJson from '@/data/canonicalModels.json';
import importsJson from '@/data/imports.json';
import sourcesJson from '@/data/sources.json';
import type { Paged, Severity } from '@/models/domain.model';
import { caseStore, meta } from './mock/stores';
import { createCollection, delay, queryList } from './mock/mockUtils';

/** Source systems, named exactly as on the Source map and Source tables pages. */
export const SOURCE_SYSTEMS = [
  'SAP S/4HANA ERP',
  'Manhattan Active WMS',
  'Salesforce Service Cloud',
  'PTC Windchill PLM',
  'IBM Maximo EAM',
] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export const SOURCE_SHORT: Record<string, string> = {
  'SAP S/4HANA ERP': 'ERP',
  'Manhattan Active WMS': 'WMS',
  'Salesforce Service Cloud': 'CRM',
  'PTC Windchill PLM': 'PLM',
  'IBM Maximo EAM': 'EAM',
};

/** Signed-in actor used for audit entries in the mock. */
const ACTOR = 'Sam Okafor';
/** Mock clock: the dataset's sOf time, advancing in real time since the app loaded. */
const LOADED_AT = Date.now();
export const mockNow = () => Date.parse(meta.asOf) + (Date.now() - LOADED_AT);
const nowIso = () => new Date(mockNow()).toISOString();

// ============================================================ Events

export type EventDirection = 'in' | 'out';
export type EventStatus = 'ok' | 'warn' | 'error';

export interface IntegrationEvent {
  id: string;
  ts: string;
  source: string;
  direction: EventDirection;
  type: string;
  entityType: string;
  entityId: string;
  status: EventStatus;
  latencyMs: number;
  message: string;
  payload: Record<string, unknown>;
}

export interface EventQuery {
  search?: string;
  source?: string;
  direction?: EventDirection | 'all';
  status?: EventStatus | 'all';
  issuesOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface EventSummary {
  total: number;
  lastMinute: number;
  errors: number;
  warnings: number;
  p95LatencyMs: number;
  latestTs: string | null;
}

const eventStore = createCollection<IntegrationEvent>(eventsJson as IntegrationEvent[]);
let eventSeq = Math.max(...eventStore.all().map((e) => Number(e.id.replace(/\D/g, '')) || 0));

const WARN_MSG = ['Field coerced to canonical type', 'Late arrival (out of order by 3 min)', 'Optional field missing: residual_life_months', 'Duplicate suppressed by idempotency key'];
const ERR_MSG = ['Schema validation failed: revision_code format', 'Unknown plant code 1090', 'Target system timeout after 30s', 'Referenced asset not found in canonical store'];
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export const eventService = {
  subscribe: eventStore.subscribe,

  async list(q: EventQuery = {}): Promise<Paged<IntegrationEvent>> {
    await delay(160);
    return queryList(eventStore.all(), {
      search: q.search,
      searchFields: ['id', 'type', 'entityId', 'entityType', 'source', 'message'],
      filters: { source: q.source, direction: q.direction, status: q.status },
      predicate: q.issuesOnly ? (e) => e.status !== 'ok' : undefined,
      sortBy: 'ts',
      sortDir: 'desc',
      page: q.page,
      pageSize: q.pageSize,
    });
  },

  async summary(): Promise<EventSummary> {
    await delay(120);
    const all = eventStore.all();
    const latest = all.reduce<string | null>((m, e) => (!m || e.ts > m ? e.ts : m), null);
    const latestMs = latest ? Date.parse(latest) : 0;
    return {
      total: all.length,
      lastMinute: all.filter((e) => latestMs - Date.parse(e.ts) <= 60_000).length,
      errors: all.filter((e) => e.status === 'error').length,
      warnings: all.filter((e) => e.status === 'warn').length,
      p95LatencyMs: percentile(all.map((e) => e.latencyMs), 95),
      latestTs: latest,
    };
  },

  async get(id: string): Promise<IntegrationEvent | undefined> {
    await delay(80);
    return eventStore.get(id);
  },

  /** Simulates the live feed: appends 1-3 new events after the latest one. */
  async simulateTick(): Promise<IntegrationEvent[]> {
    const all = eventStore.all();
    const latest = all.reduce((m, e) => (e.ts > m ? e.ts : m), meta.asOf);
    let ts = Date.parse(latest);
    const cases = caseStore.all();
    const created: IntegrationEvent[] = [];
    const count = randInt(1, 3);
    for (let i = 0; i < count; i++) {
      const template = pick(all);
      const c = pick(cases);
      const r = Math.random();
      const status: EventStatus = r < 0.08 ? 'error' : r < 0.2 ? 'warn' : 'ok';
      const latencyMs = status === 'error' ? randInt(1800, 30000) : status === 'warn' ? randInt(600, 2400) : randInt(40, 520);
      ts += randInt(1, 4) * 1000;
      eventSeq += 1;
      const id = `EVT-${eventSeq}`;
      const ev: IntegrationEvent = {
        ...template,
        id,
        ts: new Date(ts).toISOString(),
        entityId: c.id,
        status,
        latencyMs,
        message: status === 'error' ? pick(ERR_MSG) : status === 'warn' ? pick(WARN_MSG) : 'Delivered',
        payload: { ...template.payload, event_id: id, case_id: c.id, received_at: new Date(ts).toISOString() },
      };
      eventStore.insert(ev);
      created.push(ev);
    }
    return created;
  },

  async replay(id: string): Promise<IntegrationEvent> {
    await delay(400);
    return eventStore.update(id, { status: 'ok', message: `Replayed by ${ACTOR}`, latencyMs: randInt(60, 400) });
  },

  caseLabel: (id: string) => caseStore.get(id)?.productName,
};

// ============================================================ Conflicts

export type ConflictStatus = 'open' | 'escalated' | 'resolved' | 'auto_resolved';

export interface ConflictValue {
  system: string;
  value: string;
  observedAt: string;
}

export interface ConflictHistoryEntry {
  at: string;
  actor: string;
  action: string;
  note: string;
}

export interface Conflict {
  id: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  field: string;
  values: ConflictValue[];
  detectedAt: string;
  severity: Severity;
  status: ConflictStatus;
  resolution: { system: string; value: string; reason: string; by: string; at: string } | null;
  history: ConflictHistoryEntry[];
}

export interface ConflictQuery {
  search?: string;
  status?: ConflictStatus | 'all' | 'unresolved';
  severity?: Severity | 'all';
  system?: string;
}

export interface ConflictSummary {
  open: number;
  escalated: number;
  highOpen: number;
  autoResolvedPct: number;
  autoResolved: number;
  total: number;
  oldestOpenHours: number | null;
  oldestOpenId: string | null;
}

const conflictStore = createCollection<Conflict>(conflictsJson as Conflict[]);
const SEV_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const isUnresolved = (c: Conflict) => c.status === 'open' || c.status === 'escalated';
export const hoursSince = (iso: string) => Math.max(0, (mockNow() - Date.parse(iso)) / 3600e3);

export const conflictService = {
  subscribe: conflictStore.subscribe,

  async list(q: ConflictQuery = {}): Promise<Conflict[]> {
    await delay();
    return queryList(conflictStore.all(), {
      search: q.search,
      searchFields: ['id', 'entityId', 'entityLabel', 'entityType', 'field', (c) => c.values.map((v) => `${v.system} ${v.value}`).join(' ')],
      filters: { severity: q.severity, status: q.status === 'unresolved' ? undefined : q.status },
      predicate: (c) =>
        (q.status !== 'unresolved' || isUnresolved(c)) && (!q.system || q.system === 'all' || c.values.some((v) => v.system === q.system)),
      sortBy: (c) => (isUnresolved(c) ? 1e12 : 0) + SEV_RANK[c.severity] * 1e10 + hoursSince(c.detectedAt),
      sortDir: 'desc',
    }).items;
  },

  async summary(): Promise<ConflictSummary> {
    await delay(150);
    const all = conflictStore.all();
    const open = all.filter(isUnresolved);
    const auto = all.filter((c) => c.status === 'auto_resolved').length;
    const closed = all.filter((c) => !isUnresolved(c)).length;
    const oldest = open.reduce<Conflict | null>((m, c) => (!m || c.detectedAt < m.detectedAt ? c : m), null);
    return {
      open: open.length,
      escalated: open.filter((c) => c.status === 'escalated').length,
      highOpen: open.filter((c) => c.severity === 'high').length,
      autoResolved: auto,
      total: all.length,
      autoResolvedPct: closed ? Math.round((auto / closed) * 100) : 0,
      oldestOpenHours: oldest ? Math.round(hoursSince(oldest.detectedAt)) : null,
      oldestOpenId: oldest?.id ?? null,
    };
  },

  async resolve(id: string, system: string, reason: string): Promise<Conflict> {
    await delay(320);
    return conflictStore.update(id, (c) => {
      const v = c.values.find((x) => x.system === system);
      if (!v) throw new Error(`No value from ${system}`);
      const at = nowIso();
      return {
        status: 'resolved',
        resolution: { system, value: v.value, reason, by: ACTOR, at },
        history: [...c.history, { at, actor: ACTOR, action: 'Resolved', note: `${system} value "${v.value}" kept. ${reason}` }],
      };
    });
  },

  async escalate(id: string, note: string): Promise<Conflict> {
    await delay(260);
    return conflictStore.update(id, (c) => ({
      status: 'escalated',
      history: [...c.history, { at: nowIso(), actor: ACTOR, action: 'Escalated', note: note || 'Escalated to data owner' }],
    }));
  },

  async reopen(id: string): Promise<Conflict> {
    await delay(260);
    return conflictStore.update(id, (c) => ({
      status: 'open',
      resolution: null,
      history: [...c.history, { at: nowIso(), actor: ACTOR, action: 'Reopened', note: 'Resolution withdrawn' }],
    }));
  },

  openCount: () => conflictStore.all().filter(isUnresolved).length,
};

// ============================================================ Canonical models

export interface CanonicalField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface SourceMapping {
  id: string;
  source: string;
  sourceField: string;
  canonicalField: string;
  transform: string;
  confidence: number;
  /** Source map group (asset, condition, demand…) when it differs from the entity's default group. */
  layer?: string;
}

/**
 * Mapping rules are the single source of truth for every mapping count in Connection Fabric:
 * the Source map, Canonical models and Source tables pages all read them from the model store below.
 */
export interface MappingRuleRef extends SourceMapping {
  modelId: string;
}

/** Source map group for each canonical entity. */
export const ENTITY_LAYER: Record<string, string> = {
  product: 'asset',
  product_revision: 'asset',
  part: 'asset',
  bom: 'asset',
  physical_asset: 'asset',
  inventory: 'asset',
  asset_condition: 'condition',
  market_observation: 'demand',
  maintenance_event: 'intervention',
  work_order: 'intervention',
  disposition: 'route',
  lifecycle_outcome: 'outcome',
  emission_factor: 'outcome',
};
/** Canonical entity a Source map group lands in when a connector maps into it. */
const LAYER_ENTITY: Record<string, string> = {
  asset: 'physical_asset',
  condition: 'asset_condition',
  demand: 'market_observation',
  intervention: 'work_order',
  route: 'disposition',
  decision: 'disposition',
  outcome: 'lifecycle_outcome',
};
export const layerOf = (r: MappingRuleRef) => r.layer ?? ENTITY_LAYER[r.modelId] ?? 'asset';

export interface ModelVersion {
  version: string;
  status: 'draft' | 'published' | 'superseded';
  publishedAt: string | null;
  author: string;
  note: string;
}

export interface CanonicalModel {
  id: string;
  name: string;
  description: string;
  /** Current published version, null if never published. */
  version: string | null;
  draft: {
    version: string;
    note: string;
    author: string;
    createdAt: string;
    /** Mappings as they were when the draft was opened; restored on discard. */
    baseMappings?: SourceMapping[];
  } | null;
  fields: CanonicalField[];
  mappings: SourceMapping[];
  versions: ModelVersion[];
}

export type ModelStatus = 'published' | 'draft_pending' | 'draft_only';

export interface CanonicalModelRow extends CanonicalModel {
  status: ModelStatus;
  fieldCount: number;
  sources: string[];
}

/**
 * Seed: the canonical models' own mappings plus every connector field mapping from the Source map
 * dataset that is not already listed, so all three pages count the same rules.
 */
function seedModels(): CanonicalModel[] {
  const models = (modelsJson as CanonicalModel[]).map((m) => ({ ...m, mappings: [...m.mappings] }));
  let seq = Math.max(...models.flatMap((m) => m.mappings.map((x) => Number(x.id.replace(/\D/g, '')) || 0)));
  const seen = new Set(models.flatMap((m) => m.mappings.map((x) => `${x.source}|${x.sourceField}`)));
  type SeedSource = { name: string; fieldMappings: { sourceField: string; canonicalModel: string; canonicalField: string; confidence: number }[] };
  for (const s of (sourcesJson as unknown as { sources: SeedSource[] }).sources) {
    for (const fm of s.fieldMappings) {
      if (seen.has(`${s.name}|${fm.sourceField}`)) continue;
      seen.add(`${s.name}|${fm.sourceField}`);
      const entity = LAYER_ENTITY[fm.canonicalModel] ?? 'physical_asset';
      const model = models.find((m) => m.id === entity);
      if (!model) continue;
      model.mappings.push({
        id: `MAP-${String(++seq).padStart(3, '0')}`,
        source: s.name,
        sourceField: fm.sourceField,
        canonicalField: fm.canonicalField,
        transform: 'NONE',
        confidence: Math.round(fm.confidence * 100),
        ...(ENTITY_LAYER[entity] !== fm.canonicalModel ? { layer: fm.canonicalModel } : {}),
      });
    }
  }
  return models;
}

const modelStore = createCollection<CanonicalModel>(seedModels());
let mappingSeq = Math.max(...modelStore.all().flatMap((m) => m.mappings.map((x) => Number(x.id.replace(/\D/g, '')) || 0)));

/** Current canonical models (synchronous; shared with the Source tables service). */
export const allModels = () => modelStore.all();

/** All mapping rules, flattened with their canonical entity id. */
export function allMappingRules(): MappingRuleRef[] {
  return modelStore.all().flatMap((m) => m.mappings.map((x) => ({ ...x, modelId: m.id })));
}

const bumpMinor = (v: string | null) => {
  if (!v) return '0.1';
  const [maj, min] = v.split('.').map(Number);
  return `${maj}.${(min || 0) + 1}`;
};

const toModelRow = (m: CanonicalModel): CanonicalModelRow => ({
  ...m,
  status: m.draft ? (m.version ? 'draft_pending' : 'draft_only') : 'published',
  fieldCount: m.fields.length,
  sources: [...new Set(m.mappings.map((x) => x.source))],
});

/** Edits always land on a draft; open one if the model has none. */
function withDraft(m: CanonicalModel, note: string): Pick<CanonicalModel, 'draft' | 'versions'> {
  if (m.draft) return { draft: m.draft, versions: m.versions };
  const draft = { version: bumpMinor(m.version), note, author: ACTOR, createdAt: nowIso(), baseMappings: m.mappings };
  return { draft, versions: [{ version: draft.version, status: 'draft', publishedAt: null, author: ACTOR, note }, ...m.versions] };
}

export const modelService = {
  subscribe: modelStore.subscribe,

  async list(search = ''): Promise<CanonicalModelRow[]> {
    await delay(200);
    const rows = modelStore.all().map(toModelRow);
    return queryList(rows, { search, searchFields: ['name', 'id', 'description', (m) => m.fields.map((f) => f.name).join(' ')] }).items;
  },

  async get(id: string): Promise<CanonicalModelRow | undefined> {
    await delay(140);
    const m = modelStore.get(id);
    return m ? toModelRow(m) : undefined;
  },

  async publishDraft(id: string, note?: string): Promise<CanonicalModel> {
    await delay(380);
    return modelStore.update(id, (m) => {
      if (!m.draft) throw new Error('No draft to publish');
      const at = nowIso();
      const v = m.draft.version;
      return {
        version: v,
        draft: null,
        versions: m.versions.map((x) =>
          x.version === v
            ? { ...x, status: 'published' as const, publishedAt: at, note: note || x.note }
            : x.status === 'published'
              ? { ...x, status: 'superseded' as const }
              : x,
        ),
      };
    });
  },

  async discardDraft(id: string): Promise<CanonicalModel> {
    await delay(260);
    return modelStore.update(id, (m) => {
      if (!m.draft) throw new Error('No draft to discard');
      if (!m.version) throw new Error('This model has never been published; its draft cannot be discarded');
      return {
        draft: null,
        mappings: m.draft.baseMappings ?? m.mappings,
        versions: m.versions.filter((x) => x.version !== m.draft!.version),
      };
    });
  },

  async saveMapping(modelId: string, input: Omit<SourceMapping, 'id'> & { id?: string }): Promise<CanonicalModel> {
    await delay(300);
    return modelStore.update(modelId, (m) => {
      const isNew = !input.id;
      const mapping: SourceMapping = { ...input, id: input.id ?? `MAP-${String(++mappingSeq).padStart(3, '0')}` };
      const mappings = isNew ? [...m.mappings, mapping] : m.mappings.map((x) => (x.id === mapping.id ? mapping : x));
      const note = `${isNew ? 'Added' : 'Edited'} mapping ${mapping.source} ${mapping.sourceField} → ${mapping.canonicalField}`;
      return { mappings, ...withDraft(m, note) };
    });
  },

  async removeMapping(modelId: string, mappingId: string): Promise<CanonicalModel> {
    await delay(260);
    return modelStore.update(modelId, (m) => {
      const x = m.mappings.find((y) => y.id === mappingId);
      return { mappings: m.mappings.filter((y) => y.id !== mappingId), ...withDraft(m, `Removed mapping ${x?.sourceField ?? mappingId}`) };
    });
  },

  /** Mapping rules fed by one source system (synchronous; used by the Source map service). */
  rulesForSource(source: string): MappingRuleRef[] {
    return allMappingRules().filter((r) => r.source === source);
  },

  /** A new connector's suggested mappings land in a draft of each entity they touch. */
  addSourceRules(source: string, rules: { sourceField: string; layer: string; canonicalField: string; confidence: number }[]) {
    const byEntity = new Map<string, typeof rules>();
    for (const r of rules) {
      const entity = LAYER_ENTITY[r.layer] ?? 'physical_asset';
      byEntity.set(entity, [...(byEntity.get(entity) ?? []), r]);
    }
    for (const [entity, list] of byEntity) {
      if (!modelStore.get(entity)) continue;
      modelStore.update(entity, (m) => ({
        mappings: [
          ...m.mappings,
          ...list.map((r) => ({
            id: `MAP-${String(++mappingSeq).padStart(3, '0')}`,
            source,
            sourceField: r.sourceField,
            canonicalField: r.canonicalField,
            transform: 'NONE',
            confidence: r.confidence,
            ...(ENTITY_LAYER[entity] !== r.layer ? { layer: r.layer } : {}),
          })),
        ],
        ...withDraft(m, `Added ${list.length} mapping${list.length === 1 ? '' : 's'} from new source ${source}`),
      }));
    }
  },

  /** A file (CSV) source maps straight into the entity it was imported into; the rules land in that entity's draft. */
  addRulesToModel(source: string, modelId: string, rules: { sourceField: string; canonicalField: string; confidence: number }[]) {
    if (!rules.length || !modelStore.get(modelId)) return;
    modelStore.update(modelId, (m) => ({
      mappings: [
        ...m.mappings,
        ...rules.map((r) => ({
          id: `MAP-${String(++mappingSeq).padStart(3, '0')}`,
          source,
          sourceField: r.sourceField,
          canonicalField: r.canonicalField,
          transform: 'NONE',
          confidence: r.confidence,
        })),
      ],
      ...withDraft(m, `Added ${rules.length} mapping${rules.length === 1 ? '' : 's'} from file source ${source}`),
    }));
  },

  /** The one Publish action: every entity with a draft goes live together. Returns the published entity ids. */
  async publishAll(note?: string): Promise<string[]> {
    await delay(420);
    const ids = modelStore
      .all()
      .filter((m) => m.draft)
      .map((m) => m.id);
    if (!ids.length) throw new Error('There is no draft to publish');
    const at = nowIso();
    for (const id of ids) {
      modelStore.update(id, (m) => {
        const v = m.draft!.version;
        return {
          version: v,
          draft: null,
          versions: m.versions.map((x) =>
            x.version === v
              ? { ...x, status: 'published' as const, publishedAt: at, note: note || x.note }
              : x.status === 'published'
                ? { ...x, status: 'superseded' as const }
                : x,
          ),
        };
      });
    }
    return ids;
  },

  /** Discards the draft: entities that were published before revert; never-published entities keep their first draft. */
  async discardAll(): Promise<number> {
    await delay(300);
    const ids = modelStore
      .all()
      .filter((m) => m.draft && m.version)
      .map((m) => m.id);
    for (const id of ids) {
      modelStore.update(id, (m) => ({
        draft: null,
        mappings: m.draft!.baseMappings ?? m.mappings,
        versions: m.versions.filter((x) => x.version !== m.draft!.version),
      }));
    }
    return ids.length;
  },

  /** Removing a source removes its mapping rules (in a draft of each entity). */
  removeSourceRules(source: string) {
    for (const m of modelStore.all()) {
      if (!m.mappings.some((x) => x.source === source)) continue;
      modelStore.update(m.id, (cur) => ({ mappings: cur.mappings.filter((x) => x.source !== source), ...withDraft(cur, `Removed mappings from deleted source ${source}`) }));
    }
  },

  /** Accepting a drifted schema re-validates the source's low-confidence rules. */
  acceptSourceSchema(source: string) {
    for (const m of modelStore.all()) {
      if (!m.mappings.some((x) => x.source === source && x.confidence < 75)) continue;
      modelStore.update(m.id, (cur) => ({ mappings: cur.mappings.map((x) => (x.source === source && x.confidence < 75 ? { ...x, confidence: 93 } : x)) }));
    }
  },
};

// ============================================================ Manual import

export interface ImportRecord {
  id: string;
  modelId: string;
  fileName: string;
  rows: number;
  committed: number;
  rejected: number;
  by: string;
  at: string;
  status: 'committed' | 'partial';
  records: Record<string, string>[];
  /** File source the rows were loaded through (Add source › File / CSV). */
  source?: string;
}

export interface ImportHistoryRow extends ImportRecord {
  modelName: string;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** column header -> canonical field name ('' = ignore) */
export type ColumnMapping = Record<string, string>;

export interface RowIssue {
  column: string;
  field: string;
  message: string;
}

export interface ValidatedRow {
  index: number;
  values: Record<string, string>;
  issues: RowIssue[];
}

export interface ValidationResult {
  headers: string[];
  mapping: ColumnMapping;
  rows: ValidatedRow[];
  valid: number;
  invalid: number;
  missingRequired: string[];
  unmappedColumns: string[];
}

const importStore = createCollection<ImportRecord>(importsJson as ImportRecord[]);
let importSeq = Math.max(...importStore.all().map((x) => Number(x.id.replace(/\D/g, '')) || 0));

/** RFC4180-ish CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): ParsedCsv {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    out.push(row);
  }
  const nonEmpty = out.filter((r) => r.some((c) => c.trim() !== ''));
  const [headers = [], ...rows] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Guess a canonical field for each column: exact name, then a mapped source field name. */
export function suggestMapping(model: CanonicalModel, headers: string[]): ColumnMapping {
  const used = new Set<string>();
  const mapping: ColumnMapping = {};
  for (const h of headers) {
    const n = norm(h);
    let f = model.fields.find((x) => norm(x.name) === n && !used.has(x.name));
    if (!f) {
      const viaSource = model.mappings.find((x) => norm(x.sourceField.split('.').pop() ?? '') === n);
      f = viaSource ? model.fields.find((x) => x.name === viaSource.canonicalField && !used.has(x.name)) : undefined;
    }
    mapping[h] = f ? f.name : '';
    if (f) used.add(f.name);
  }
  return mapping;
}

function checkValue(field: CanonicalField, raw: string): string | null {
  const v = raw.trim();
  if (!v) return field.required ? 'Required value is empty' : null;
  const t = field.type;
  if (t === 'integer' && !/^-?\d+$/.test(v)) return `"${v}" is not a whole number`;
  if (t === 'decimal' && !/^-?\d+(\.\d+)?$/.test(v)) return `"${v}" is not a number`;
  if (t === 'boolean' && !/^(true|false|yes|no|1|0)$/i.test(v)) return `"${v}" is not true/false`;
  if (t === 'date' && (!/^\d{4}-\d{2}-\d{2}/.test(v) || Number.isNaN(Date.parse(v)))) return `"${v}" is not a date (YYYY-MM-DD)`;
  if (t === 'ref(case)') {
    if (!/^RT-\d{4}$/.test(v)) return `"${v}" is not a case id (RT-xxxx)`;
    if (!caseStore.get(v)) return `Case ${v} does not exist`;
  }
  const en = /^enum\((.*)\)$/.exec(t);
  if (en) {
    const allowed = en[1].split('|');
    if (!allowed.includes(v)) return `"${v}" is not one of ${allowed.join(', ')}`;
  }
  return null;
}

const SAMPLE_VALUES: Record<string, (i: number) => string> = {
  case_id: (i) => `RT-${1001 + ((i * 7) % 128)}`,
  serial_number: (i) => `SN${884210 + i * 13}`,
  asset_tag: (i) => `CTL-0${4100 + i}`,
  product_code: (i) => ['OC-7-PLC', 'NB-EDGE', 'KA-300', 'HX-AXIAL'][i % 4],
  site: (i) => ['Warehouse 1', 'Warehouse 2', 'Repair centre'][i % 3],
  tenant: (i) => ['Customer A', 'Customer B', 'Customer C'][i % 3],
  grade: (i) => ['A', 'B', 'C', 'B', 'D'][i % 5],
  condition_grade: (i) => ['A', 'B', 'C'][i % 3],
  route: (i) => ['redeploy', 'resale', 'intparts', 'recycle'][i % 4],
  channel: (i) => ['eBay Business', 'Broker: Relectra', 'Machinio'][i % 3],
  bin_location: (i) => `Q-${(i % 9) + 1}-${(i % 4) + 1}`,
  inspector: (i) => ['Dev Kapoor', 'Luis Ortega'][i % 2],
  approved_by: () => 'Marcus Vance',
  product_class: (i) => ['motor', 'pump', 'control'][i % 3],
};

function sampleFor(field: CanonicalField, i: number): string {
  if (SAMPLE_VALUES[field.name]) return SAMPLE_VALUES[field.name](i);
  const en = /^enum\((.*)\)$/.exec(field.type);
  if (en) return en[1].split('|')[i % en[1].split('|').length];
  switch (field.type) {
    case 'integer':
      return String(1 + ((i * 5) % 30));
    case 'decimal':
      return (120 + i * 37.5).toFixed(2);
    case 'boolean':
      return i % 2 ? 'true' : 'false';
    case 'date':
      return `2026-11-${String(1 + (i % 19)).padStart(2, '0')}`;
    case 'ref(case)':
      return `RT-${1001 + i}`;
    default:
      return `${field.name.replace(/_/g, '-').toUpperCase()}-${100 + i}`;
  }
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const importService = {
  subscribe: importStore.subscribe,

  async history(): Promise<ImportHistoryRow[]> {
    await delay(200);
    return [...importStore.all()]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map((x) => ({ ...x, modelName: modelStore.get(x.modelId)?.name ?? x.modelId }));
  },

  /** A sample file for the model with 8 good rows and 2 deliberately bad ones. */
  sampleCsv(modelId: string): string {
    const m = modelStore.get(modelId);
    if (!m) return '';
    const headers = m.fields.map((f) => f.name);
    const rows: string[][] = [];
    for (let i = 0; i < 10; i++) rows.push(m.fields.map((f) => sampleFor(f, i)));
    // Row 4: required value missing. Row 8: wrong type in the first typed field.
    const req = m.fields.findIndex((f) => f.required && f.type === 'string');
    rows[3][req >= 0 ? req : 0] = '';
    const typed = m.fields.findIndex((f) => f.type !== 'string');
    if (typed >= 0) rows[7][typed] = m.fields[typed].type === 'ref(case)' ? 'RT-9999' : 'n/a';
    return [headers.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
  },

  async validate(modelId: string, csvText: string, mapping?: ColumnMapping): Promise<ValidationResult> {
    await delay(350);
    const m = modelStore.get(modelId);
    if (!m) throw new Error('Unknown canonical model');
    const { headers, rows } = parseCsv(csvText);
    if (!headers.length) throw new Error('No header row found');
    const map = mapping ?? suggestMapping(m, headers);
    const mappedFields = new Set(Object.values(map).filter(Boolean));
    const missingRequired = m.fields.filter((f) => f.required && !mappedFields.has(f.name)).map((f) => f.name);
    const validated: ValidatedRow[] = rows.map((r, idx) => {
      const values: Record<string, string> = {};
      const issues: RowIssue[] = [];
      if (r.length !== headers.length) issues.push({ column: '', field: '', message: `Expected ${headers.length} columns, found ${r.length}` });
      headers.forEach((h, ci) => {
        const fname = map[h];
        if (!fname) return;
        const field = m.fields.find((f) => f.name === fname);
        const raw = r[ci] ?? '';
        values[fname] = raw.trim();
        if (field) {
          const err = checkValue(field, raw);
          if (err) issues.push({ column: h, field: fname, message: err });
        }
      });
      for (const f of missingRequired) issues.push({ column: '', field: f, message: `Required field ${f} is not mapped` });
      return { index: idx + 1, values, issues };
    });
    const invalid = validated.filter((r) => r.issues.length).length;
    return {
      headers,
      mapping: map,
      rows: validated,
      valid: validated.length - invalid,
      invalid,
      missingRequired,
      unmappedColumns: headers.filter((h) => !map[h]),
    };
  },

  async commit(modelId: string, fileName: string, result: ValidationResult, source?: string): Promise<ImportRecord> {
    await delay(500);
    const records = result.rows.filter((r) => !r.issues.length).map((r) => r.values);
    if (!records.length) throw new Error('There are no valid rows to commit');
    importSeq += 1;
    const rec: ImportRecord = {
      id: `IMP-${String(importSeq).padStart(4, '0')}`,
      modelId,
      fileName: fileName || 'pasted.csv',
      rows: result.rows.length,
      committed: records.length,
      rejected: result.invalid,
      by: ACTOR,
      at: nowIso(),
      status: result.invalid ? 'partial' : 'committed',
      records,
      ...(source ? { source } : {}),
    };
    return importStore.insert(rec);
  },
};
