/**
 * Source Map service: connected enterprise systems, their tables and field mappings,
 * the canonical models and decision steps they feed, and the connector catalogue.
 * Backed by an in-memory collection seeded from src/data/sources.json.
 */
import sourcesJson from '@/data/sources.json';
import { createCollection, delay, queryList } from './mock/mockUtils';
import { importService, layerOf, modelService, type ImportRecord, type ValidationResult } from './integrationService';

export type SourceStatus = 'healthy' | 'warning' | 'failed' | 'stale' | 'paused';
export type ActiveStatus = Exclude<SourceStatus, 'paused'>;
export type SourceIssue = 'schema_drift' | 'token_expiring' | 'auth_failed' | 'stale_feed' | null;
export type SyncRunStatus = 'success' | 'partial' | 'failed';

export interface SourceTable {
  name: string;
  label: string;
  rows: number;
}

export interface FieldMapping {
  sourceField: string;
  canonicalModel: string;
  canonicalField: string;
  confidence: number;
}

export interface SyncRun {
  at: string;
  status: SyncRunStatus;
  records: number;
  durationSec: number;
}

export interface Source {
  id: string;
  name: string;
  category: string;
  connectorType: string;
  vendor: string;
  role: string;
  description: string;
  syncMethod: string;
  status: SourceStatus;
  /** Status to return to when a paused source is resumed. */
  pausedFrom?: ActiveStatus;
  issue: SourceIssue;
  statusNote: string | null;
  environment: string;
  authType: string;
  instanceUrl: string;
  connectedBy: string;
  lastSyncAt: string;
  credentialsRotatedAt?: string;
  records30d: number;
  successRate: number;
  failedRecords: number;
  tables: SourceTable[];
  fieldMappings: FieldMapping[];
  syncHistory: SyncRun[];
}

export interface CanonicalModelRef {
  id: string;
  name: string;
  version: string;
  fields: string[];
}

export interface DecisionStep {
  id: string;
  name: string;
  kind: string;
  /** Canonical model ids this step reads. */
  inputs: string[];
}

export interface CatalogueEntry {
  id: string;
  name: string;
  vendor: string;
  category: string;
  connectorType: string;
  role: string;
  syncMethod: string;
  authTypes: string[];
  tables: SourceTable[];
  mappingTemplate: { table: string; sourceField: string; canonicalModel: string; canonicalField: string }[];
}

export interface SourceMeta {
  asOf: string;
  categories: string[];
  canonicalModels: CanonicalModelRef[];
  decisionSteps: DecisionStep[];
  syncIntervals: { label: string; minutes: number }[];
  environments: string[];
  catalogue: CatalogueEntry[];
}

export interface SourceQuery {
  search?: string;
  category?: string;
  status?: SourceStatus | 'all' | 'attention';
}

export interface SourceSummary {
  connected: number;
  total: number;
  paused: number;
  tables: number;
  fieldMappings: number;
  attention: number;
  failed: number;
  healthPct: number;
  healthTrend: number[];
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type FixAction = 'rotate' | 'reconnect' | 'accept_schema' | 'sync' | 'resume' | null;

export interface DiagnosisCheck {
  key: 'auth' | 'reachability' | 'schema' | 'freshness';
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface Diagnosis {
  checks: DiagnosisCheck[];
  summary: string;
  fix: { text: string; action: FixAction; actionLabel?: string } | null;
}

/** Add source › File / CSV: a source with no connector, fed by the manual-import flow. */
export interface NewFileSourceInput {
  name: string;
  environment: string;
  modelId: string;
  fileName: string;
  result: ValidationResult;
  /** Column header -> canonical field, as reviewed in the wizard. */
  rules: { sourceField: string; canonicalField: string }[];
}

export const FILE_CONNECTOR = 'CSV';
export const isFileSource = (s: Pick<Source, 'connectorType'>) => s.connectorType === FILE_CONNECTOR;

export interface NewSourceInput {
  catalogueId: string;
  name: string;
  environment: string;
  authType: string;
  instanceUrl: string;
  tables: string[];
  /** Suggested mapping rules (source fields) the user left out on the wizard's review step. */
  skipFields?: string[];
}

type SourcesJson = SourceMeta & { healthTrend: number[]; sources: Source[] };
const data = sourcesJson as unknown as SourcesJson;

const store = createCollection<Source>(data.sources);
const ACTOR = 'Sam Okafor · Integration admin';

/**
 * Mock clock: starts at the dataset's "as of" time and advances in real time,
 * so a sync run now shows as "just now" next to the seeded history.
 */
const AS_OF_MS = Date.parse(data.asOf);
const loadedAt = Date.now();
export const clockNow = () => AS_OF_MS + (Date.now() - loadedAt);
const nowIso = () => new Date(clockNow()).toISOString();

const ATTENTION: SourceStatus[] = ['warning', 'failed', 'stale'];
export const needsAttention = (s: Pick<Source, 'status'>) => ATTENTION.includes(s.status);

const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

function typicalBatch(s: Source) {
  const ok = s.syncHistory.filter((r) => r.records > 0);
  if (!ok.length) return 200;
  return Math.round(ok.reduce((n, r) => n + r.records, 0) / ok.length);
}

/** Integration health: share of successful runs in the last 5 runs of every active source (partial = half). */
function healthOf(sources: Source[]) {
  const runs = sources.filter((s) => s.status !== 'paused').flatMap((s) => s.syncHistory.slice(0, 5));
  if (!runs.length) return 100;
  const score = runs.reduce((n, r) => n + (r.status === 'success' ? 1 : r.status === 'partial' ? 0.5 : 0), 0);
  return Math.round((score / runs.length) * 1000) / 10;
}

function addRun(s: Source, run: SyncRun): Pick<Source, 'syncHistory' | 'records30d' | 'failedRecords' | 'successRate'> {
  const failedAdd = run.status === 'partial' ? Math.round(run.records * 0.08) : 0;
  const records30d = s.records30d + run.records;
  const failedRecords = s.failedRecords + failedAdd;
  return {
    syncHistory: [run, ...s.syncHistory].slice(0, 12),
    records30d,
    failedRecords,
    successRate: Math.round((1 - failedRecords / Math.max(1, records30d)) * 1000) / 10,
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/**
 * A source's field mappings are its mapping rules in the canonical model store, so the Source map,
 * Canonical models and Source tables pages always count the same rules.
 */
function withRules(s: Source): Source {
  return {
    ...s,
    fieldMappings: modelService.rulesForSource(s.name).map((r) => ({
      sourceField: r.sourceField,
      canonicalModel: layerOf(r),
      canonicalField: r.canonicalField,
      confidence: r.confidence / 100,
    })),
  };
}
const allSources = () => store.all().map(withRules);

function requireSource(id: string) {
  const s = store.get(id);
  if (!s) throw new Error('This source no longer exists');
  return withRules(s);
}

/** Refetch when sources or their mapping rules change. */
function subscribeAll(listener: () => void) {
  const a = store.subscribe(listener);
  const b = modelService.subscribe(listener);
  return () => {
    a();
    b();
  };
}

export const sourceService = {
  subscribe: subscribeAll,

  async meta(): Promise<SourceMeta> {
    await delay(120);
    const { asOf, categories, canonicalModels, decisionSteps, syncIntervals, environments, catalogue } = data;
    return { asOf, categories, canonicalModels, decisionSteps, syncIntervals, environments, catalogue };
  },

  async list(q: SourceQuery = {}): Promise<Source[]> {
    await delay(180);
    return queryList(allSources(), {
      search: q.search,
      searchFields: [
        'name',
        'vendor',
        'category',
        'connectorType',
        'role',
        (s) => s.tables.map((t) => `${t.name} ${t.label}`).join(' '),
        (s) => s.fieldMappings.map((m) => `${m.sourceField} ${m.canonicalField}`).join(' '),
      ],
      filters: { category: q.category, status: q.status === 'attention' ? undefined : q.status },
      predicate: q.status === 'attention' ? needsAttention : undefined,
      sortBy: (s) => `${String(data.categories.indexOf(s.category)).padStart(2, '0')} ${s.name.toLowerCase()}`,
      sortDir: 'asc',
    }).items;
  },

  /** By id, or by exact name (links from events and conflicts carry the system name). */
  async get(id: string | null): Promise<Source | null> {
    await delay(100);
    const s = id ? (store.get(id) ?? store.all().find((x) => x.name === id)) : undefined;
    return s ? withRules(s) : null;
  },

  async summary(): Promise<SourceSummary> {
    await delay(150);
    const all = allSources();
    const health = healthOf(all);
    return {
      connected: all.filter((s) => s.status !== 'paused').length,
      total: all.length,
      paused: all.filter((s) => s.status === 'paused').length,
      tables: all.reduce((n, s) => n + s.tables.length, 0),
      fieldMappings: all.reduce((n, s) => n + s.fieldMappings.length, 0),
      attention: all.filter(needsAttention).length,
      failed: all.filter((s) => s.status === 'failed').length,
      healthPct: health,
      healthTrend: [...data.healthTrend.slice(1), health],
    };
  },

  /** Runs one sync. Failed sources record a failed run; stale feeds recover; schema drift gives a partial run. */
  async syncNow(id: string): Promise<{ source: Source; run: SyncRun }> {
    await delay(randInt(280, 520));
    const s = requireSource(id);
    if (s.status === 'paused') throw new Error(`${s.name} is paused. Resume it to sync.`);
    if (isFileSource(s)) throw new Error(`${s.name} is a file source. Upload a new file to refresh it.`);
    const batch = typicalBatch(s);
    let run: SyncRun;
    if (s.issue === 'auth_failed') {
      run = { at: nowIso(), status: 'failed', records: 0, durationSec: 30 };
      const source = store.update(id, addRun(s, run));
      return { source, run };
    }
    const partial = s.issue === 'schema_drift';
    run = { at: nowIso(), status: partial ? 'partial' : 'success', records: Math.round(batch * (0.85 + Math.random() * 0.3)), durationSec: randInt(4, 48) };
    const recovered = s.issue === 'stale_feed';
    const source = store.update(id, {
      ...addRun(s, run),
      lastSyncAt: run.at,
      ...(recovered ? { status: 'healthy' as const, issue: null, statusNote: null } : {}),
    });
    return { source, run };
  },

  /** Syncs every active source in turn; paused sources are skipped. */
  async syncAll(onProgress?: (done: number, total: number, name: string) => void) {
    const ids = store
      .all()
      .filter((s) => s.status !== 'paused' && !isFileSource(s))
      .map((s) => s.id);
    const result = { synced: 0, failed: 0, partial: 0, skipped: store.all().length - ids.length, records: 0 };
    for (let i = 0; i < ids.length; i++) {
      const name = store.get(ids[i])?.name ?? ids[i];
      onProgress?.(i, ids.length, name);
      try {
        const { run } = await sourceService.syncNow(ids[i]);
        result.records += run.records;
        if (run.status === 'failed') result.failed += 1;
        else if (run.status === 'partial') result.partial += 1;
        else result.synced += 1;
      } catch {
        result.failed += 1;
      }
    }
    onProgress?.(ids.length, ids.length, '');
    return result;
  },

  async testConnection(id: string): Promise<ConnectionTestResult> {
    await delay(randInt(700, 1100));
    const s = requireSource(id);
    if (s.status === 'paused') return { ok: false, latencyMs: 0, message: 'Source is paused. Resume it before testing.' };
    if (s.issue === 'auth_failed')
      return { ok: false, latencyMs: randInt(900, 1400), message: `Authentication rejected by ${new URL(s.instanceUrl).host} (401). The service account key was revoked or has expired.` };
    const latencyMs = randInt(80, 420);
    if (s.issue === 'stale_feed') return { ok: true, latencyMs, message: `Connected in ${latencyMs} ms, but the provider has published no new data since the last sync.` };
    if (s.issue === 'token_expiring') return { ok: true, latencyMs, message: `Connected in ${latencyMs} ms. The OAuth refresh token expires in 3 days.` };
    return { ok: true, latencyMs, message: `Connected in ${latencyMs} ms. Authentication, read access and schema look good.` };
  },

  async diagnose(id: string): Promise<Diagnosis> {
    await delay(randInt(900, 1300));
    const s = requireSource(id);
    const host = (() => {
      try {
        return new URL(s.instanceUrl).host;
      } catch {
        return s.instanceUrl;
      }
    })();
    const ageH = (clockNow() - Date.parse(s.lastSyncAt)) / 3600e3;
    const drifted = s.fieldMappings.filter((m) => m.confidence < 0.75);
    const checks: DiagnosisCheck[] = [
      s.issue === 'auth_failed'
        ? { key: 'auth', label: 'Authentication', status: 'fail', detail: `${s.authType} credentials rejected (401 Unauthorized).` }
        : s.issue === 'token_expiring'
          ? { key: 'auth', label: 'Authentication', status: 'warn', detail: 'Token valid, but it expires in 3 days.' }
          : { key: 'auth', label: 'Authentication', status: 'pass', detail: `${s.authType} credentials accepted.` },
      { key: 'reachability', label: 'Reachability', status: 'pass', detail: `${host} reachable, TLS valid, ${randInt(60, 380)} ms round trip.` },
      drifted.length || s.issue === 'schema_drift'
        ? { key: 'schema', label: 'Schema drift', status: 'warn', detail: `${drifted.map((m) => m.sourceField).join(', ') || 'A mapped field'} changed type or format since the last mapping review.` }
        : { key: 'schema', label: 'Schema drift', status: 'pass', detail: `All ${s.fieldMappings.length} mapped fields match the expected schema.` },
      s.status === 'paused'
        ? { key: 'freshness', label: 'Freshness', status: 'warn', detail: 'Source is paused; no syncs are scheduled.' }
        : s.issue === 'stale_feed'
          ? { key: 'freshness', label: 'Freshness', status: 'fail', detail: `No new data for ${Math.round(ageH)} h; expected at least daily.` }
          : s.issue === 'auth_failed'
            ? { key: 'freshness', label: 'Freshness', status: 'fail', detail: `Last successful sync ${Math.round(ageH)} h ago; the last runs failed.` }
            : { key: 'freshness', label: 'Freshness', status: 'pass', detail: `Last sync ${ageH < 1 ? `${Math.max(1, Math.round(ageH * 60))} min` : `${Math.round(ageH)} h`} ago, within schedule (${s.syncMethod}).` },
    ];
    const failing = checks.filter((c) => c.status !== 'pass');
    let fix: Diagnosis['fix'] = null;
    if (s.status === 'paused') fix = { text: 'Resume the source so scheduled syncs run again.', action: 'resume', actionLabel: 'Resume source' };
    else if (s.issue === 'auth_failed') fix = { text: 'Rotate the service account credentials, then run a sync to backfill the missed files.', action: 'rotate', actionLabel: 'Rotate credentials' };
    else if (s.issue === 'token_expiring') fix = { text: 'Rotate the OAuth credentials now to avoid an outage when the token expires.', action: 'rotate', actionLabel: 'Rotate credentials' };
    else if (s.issue === 'schema_drift' || drifted.length)
      fix = { text: 'Review the changed fields and accept the new schema. Mappings are re-validated and confidence is restored.', action: 'accept_schema', actionLabel: 'Accept new schema' };
    else if (s.issue === 'stale_feed') fix = { text: 'Run a sync now to pull the latest data from the provider.', action: 'sync', actionLabel: 'Sync now' };
    return {
      checks,
      summary: failing.length ? `${failing.length} of ${checks.length} checks need attention.` : 'All checks passed. No action needed.',
      fix,
    };
  },

  async reconnect(id: string): Promise<Source> {
    await delay(600);
    const s = requireSource(id);
    const fixes = s.issue === 'auth_failed' || s.issue === 'stale_feed';
    const paused = s.status === 'paused';
    const healed = fixes ? { issue: null, statusNote: null, ...(paused ? { pausedFrom: 'healthy' as const } : { status: 'healthy' as const }) } : {};
    store.update(id, { ...healed, connectedBy: ACTOR });
    if (paused) return requireSource(id);
    return (await sourceService.syncNow(id)).source;
  },

  async rotateCredentials(id: string): Promise<Source> {
    await delay(500);
    const s = requireSource(id);
    const fixes = s.issue === 'auth_failed' || s.issue === 'token_expiring';
    return store.update(id, {
      credentialsRotatedAt: nowIso(),
      ...(fixes ? { issue: null, statusNote: null, ...(s.status === 'paused' ? { pausedFrom: 'healthy' as const } : { status: 'healthy' as const }) } : {}),
    });
  },

  async acceptSchema(id: string): Promise<Source> {
    await delay(450);
    const s = requireSource(id);
    modelService.acceptSourceSchema(s.name);
    return store.update(id, {
      ...(s.issue === 'schema_drift' ? { issue: null, statusNote: null, ...(s.status === 'paused' ? { pausedFrom: 'healthy' as const } : { status: 'healthy' as const }) } : {}),
    });
  },

  async setPaused(id: string, paused: boolean): Promise<Source> {
    await delay(300);
    const s = requireSource(id);
    if (paused) {
      if (s.status === 'paused') return s;
      return store.update(id, { status: 'paused', pausedFrom: s.status as ActiveStatus });
    }
    if (s.status !== 'paused') return s;
    return store.update(id, { status: s.pausedFrom ?? 'healthy', pausedFrom: undefined });
  },

  async updateSettings(id: string, patch: { syncMethod: string; environment: string }): Promise<Source> {
    await delay(350);
    requireSource(id);
    return store.update(id, patch);
  },

  async remove(id: string): Promise<void> {
    await delay(350);
    const s = requireSource(id);
    store.remove(id);
    modelService.removeSourceRules(s.name);
  },

  /** Wizard step 4: simulated pre-flight test before the source is created. */
  async testNewConnection(input: Pick<NewSourceInput, 'instanceUrl' | 'authType'>): Promise<ConnectionTestResult> {
    await delay(randInt(900, 1400));
    if (/invalid|fail/i.test(input.instanceUrl)) return { ok: false, latencyMs: 0, message: 'Host could not be resolved. Check the instance URL.' };
    const latencyMs = randInt(90, 360);
    return { ok: true, latencyMs, message: `Authenticated with ${input.authType} and read the schema in ${latencyMs} ms.` };
  },

  /** File / CSV source: commits the valid rows (manual import), adds the reviewed mapping rules and registers the source. */
  async createFromFile(input: NewFileSourceInput): Promise<{ source: Source; import: ImportRecord }> {
    await delay(300);
    const name = input.name.trim();
    if (!name) throw new Error('Give the source a name');
    if (store.all().some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error(`A source named "${name}" already exists`);
    const rec = await importService.commit(input.modelId, input.fileName, input.result, name);
    let id = slug(name);
    while (store.get(id)) id = `${id}-${randInt(2, 99)}`;
    const at = nowIso();
    const source: Source = {
      id,
      name,
      category: 'Files',
      connectorType: FILE_CONNECTOR,
      vendor: 'Manual upload',
      role: `${input.modelId.replace(/_/g, ' ')} records loaded from CSV`,
      description: `CSV file loaded through manual import into ${input.modelId}. Rows are validated against the canonical model before they are written.`,
      syncMethod: 'Manual upload',
      status: 'healthy',
      issue: null,
      statusNote: null,
      environment: input.environment,
      authType: 'File upload',
      instanceUrl: `upload://${rec.fileName}`,
      connectedBy: ACTOR,
      lastSyncAt: at,
      records30d: rec.committed,
      successRate: Math.round((rec.committed / Math.max(1, rec.rows)) * 1000) / 10,
      failedRecords: rec.rejected,
      tables: [{ name: rec.fileName, label: `Uploaded CSV → ${input.modelId}`, rows: rec.rows }],
      fieldMappings: [],
      syncHistory: [{ at, status: rec.rejected ? 'partial' : 'success', records: rec.committed, durationSec: 2 }],
    };
    modelService.addRulesToModel(
      name,
      input.modelId,
      input.rules.map((r) => ({ ...r, confidence: 95 })),
    );
    return { source: withRules(store.insert(source)), import: rec };
  },

  async create(input: NewSourceInput): Promise<Source> {
    await delay(500);
    const entry = data.catalogue.find((c) => c.id === input.catalogueId);
    if (!entry) throw new Error('Unknown connector');
    const name = input.name.trim() || entry.name;
    if (store.all().some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error(`A source named "${name}" already exists`);
    let id = slug(name);
    while (store.get(id)) id = `${id}-${randInt(2, 99)}`;
    const tables = entry.tables.filter((t) => input.tables.includes(t.name));
    const at = nowIso();
    const records = tables.reduce((n, t) => n + Math.round(t.rows * 0.05), 0);
    const source: Source = {
      id,
      name,
      category: entry.category,
      connectorType: entry.connectorType,
      vendor: entry.vendor,
      role: entry.role,
      description: `${entry.role} from ${entry.vendor}. Connected through the ${entry.name} connector.`,
      syncMethod: entry.syncMethod,
      status: 'healthy',
      issue: null,
      statusNote: null,
      environment: input.environment,
      authType: input.authType,
      instanceUrl: input.instanceUrl,
      connectedBy: ACTOR,
      lastSyncAt: at,
      records30d: records,
      successRate: 100,
      failedRecords: 0,
      tables,
      fieldMappings: [],
      syncHistory: [{ at, status: 'success', records, durationSec: randInt(12, 40) }],
    };
    modelService.addSourceRules(
      name,
      entry.mappingTemplate
        .filter((m) => input.tables.includes(m.table) && !input.skipFields?.includes(m.sourceField))
        .map((m) => ({ sourceField: m.sourceField, layer: m.canonicalModel, canonicalField: m.canonicalField, confidence: 88 })),
    );
    return withRules(store.insert(source));
  },
};
