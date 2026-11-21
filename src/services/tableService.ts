/**
 * Canonical field mappings (Integration > Tables): source-system fields mapped onto
 * canonical circularity entities, plus the draft/published mapping version.
 */
import data from '@/data/integrationTables.json';
import { delay, queryList } from './mock/mockUtils';
import { allMappingRules, allModels, modelService } from './integrationService';

export type MappingStatus = 'Mapped' | 'Schema Drift Warning' | 'Pending Review';

export interface MappingRule {
  id: string;
  sourceSystem: string;
  sourceTable: string;
  sourceField: string;
  sourceType: string;
  canonicalEntity: string;
  canonicalField: string;
  canonicalType: string;
  transformation: string;
  isRequired: boolean;
  confidence: number;
  status: MappingStatus;
  sampleValue: string;
  transformedSample: string;
}

export interface MappingSummary {
  activeRules: number;
  connectors: number;
  averageConfidence: number;
  canonicalTarget: string;
  canonicalEntities: number;
  draftVersion: string;
  publishedVersion: string;
  driftWarnings: number;
  /** Source systems with at least one drift warning. */
  driftSources: string[];
}

export interface TransformTestResult {
  records: number;
  truncationErrors: number;
  typeMatch: number;
  sourceLabel: string;
  targetEntity: string;
  source: Record<string, string>;
  canonical_asset: Record<string, string>;
}

export interface MappingQuery {
  search?: string;
  source?: string;
  entity?: string;
}

/** Rich detail (types, samples) for the rules the dataset documents; matched onto the shared rules. */
const details = data.mappings as MappingRule[];
let versions = { draft: data.summary.draftVersion, published: data.summary.publishedVersion };
const versionListeners = new Set<() => void>();

const bump = (v: string) => {
  const [maj, min] = v.split('.').map(Number);
  return `${maj}.${(min ?? 0) + 1}`;
};

function ruleStatus(confidence: number): MappingStatus {
  if (confidence < 75) return 'Schema Drift Warning';
  if (confidence < 90) return 'Pending Review';
  return 'Mapped';
}

/**
 * Rows are the mapping rules from the canonical model store (one source of truth shared with the
 * Source map and Canonical models pages), enriched with documented types and samples where known.
 */
function rows(): MappingRule[] {
  const fieldIndex = new Map(allModels().flatMap((m) => m.fields.map((f) => [`${m.id}|${f.name}`, f] as const)));
  return allMappingRules().map((r) => {
    const doc = details.find((d) => d.sourceSystem === r.source && d.canonicalEntity === r.modelId && d.canonicalField === r.canonicalField);
    const field = fieldIndex.get(`${r.modelId}|${r.canonicalField}`);
    const dot = r.sourceField.indexOf('.');
    return {
      id: r.id,
      sourceSystem: r.source,
      sourceTable: doc?.sourceTable ?? (dot > 0 ? r.sourceField.slice(0, dot) : '–'),
      sourceField: r.sourceField,
      sourceType: doc?.sourceType ?? '–',
      canonicalEntity: r.modelId,
      canonicalField: r.canonicalField,
      canonicalType: doc?.canonicalType ?? field?.type ?? '–',
      transformation: r.transform,
      isRequired: doc?.isRequired ?? field?.required ?? false,
      confidence: r.confidence,
      status: ruleStatus(r.confidence),
      sampleValue: doc?.sampleValue ?? '',
      transformedSample: doc?.transformedSample ?? '',
    };
  });
}

export const tableService = {
  subscribe(listener: () => void) {
    const off = modelService.subscribe(listener);
    versionListeners.add(listener);
    return () => {
      off();
      versionListeners.delete(listener);
    };
  },

  async listMappings(q: MappingQuery = {}) {
    await delay();
    return queryList(rows(), {
      search: q.search,
      searchFields: ['sourceField', 'canonicalField', 'transformation'],
      filters: { sourceSystem: q.source, canonicalEntity: q.entity },
    });
  },

  async summary(): Promise<MappingSummary> {
    await delay();
    const all = rows();
    const drift = all.filter((m) => m.status === 'Schema Drift Warning');
    return {
      activeRules: all.length,
      connectors: new Set(all.map((m) => m.sourceSystem)).size,
      averageConfidence: all.length ? Math.round((all.reduce((n, m) => n + m.confidence, 0) / all.length) * 10) / 10 : 0,
      canonicalTarget: data.summary.canonicalTarget,
      canonicalEntities: allModels().length,
      draftVersion: versions.draft,
      publishedVersion: versions.published,
      driftWarnings: drift.length,
      driftSources: [...new Set(drift.map((m) => m.sourceSystem))],
    };
  },

  async filterOptions() {
    await delay(120);
    const all = rows();
    return { sourceSystems: [...new Set(all.map((m) => m.sourceSystem))], canonicalEntities: allModels().map((m) => m.id) };
  },

  async testTransforms(): Promise<TransformTestResult> {
    await delay(600);
    return data.testRun;
  },

  /** Publishes the draft mapping version and opens the next draft. */
  async publish(): Promise<string> {
    await delay(400);
    const published = versions.draft;
    versions = { published, draft: bump(published) };
    versionListeners.forEach((l) => l());
    return published;
  },
};
