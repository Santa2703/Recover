'use client';

import React, { useMemo, useState } from 'react';
import { Drawer, Modal, Tabs, message } from 'antd';
import { AlertTriangle, ArrowRight, Boxes, CheckCircle, Database, FileCode, GitBranch, Pencil, Play, Plus, RotateCcw, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import { DataTable, MetricCard, PageActions, PageHeader, Panel, Skeleton, type DataColumn } from '@/components/ui';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { SOURCE_SYSTEMS, modelService, type CanonicalModelRow, type ModelStatus, type SourceMapping } from '@/services/integrationService';
import { tableService, type MappingRule, type TransformTestResult } from '@/services/tableService';
import { IntTable, type IntColumn } from '@/components/integration/IntTable';
import { SearchField } from '@/components/integration/Filters';
import { Pill, type PillTone } from '@/components/integration/Pills';
import { BTN_GHOST, BTN_SECONDARY, INPUT, LABEL, SELECT } from '@/components/integration/styles';
import { fmtDateTime } from '@/components/integration/format';
import { sourceHref } from '@/components/integration/issueMeta';
import { setQueryParams, useQueryParam } from '@/components/integration/useQueryParam';
import Link from 'next/link';

type Tab = 'fields' | 'mappings' | 'versions';
const ALL = 'all';

const STATUS_PILL: Record<ModelStatus, { tone: PillTone; label: string }> = {
  published: { tone: 'low', label: 'Published' },
  draft_pending: { tone: 'medium', label: 'In draft' },
  draft_only: { tone: 'info', label: 'New, in draft' },
};
const RULE_PILL: Record<MappingRule['status'], PillTone> = { Mapped: 'low', 'Pending Review': 'medium', 'Schema Drift Warning': 'high' };
const TRANSFORMS = ['NONE', 'TRIM()', 'UPPERCASE()', 'TITLE_CASE()', 'TRIM_LEADING_ZEROS()', 'TO_INT()', 'TO_DECIMAL()', 'TO_DATE()', 'TO_TIMESTAMP(YYYYMMDD)', 'FX_TO_EUR()', 'LOOKUP_PLANT_TO_WAREHOUSE()', 'MAP_COND_CODE_TO_GRADE()'];

type MappingDraft = Omit<SourceMapping, 'id'> & { id?: string; modelId: string };

const confTone = (v: number) => (v >= 95 ? 'text-[#15803D]' : v >= 75 ? 'text-[#D97706]' : 'text-[#DC2626]');

/**
 * Data model: canonical entities (fields, versions) and every mapping rule that feeds them, with
 * one draft for all changes and one Publish. URL: ?model=<entity id | all>&tab=fields|mappings|versions&source=<system>.
 */
export default function DataModelPage() {
  const modelParam = useQueryParam('model');
  const tabParam = useQueryParam('tab');
  const sourceParam = useQueryParam('source');

  const [entitySearch, setEntitySearch] = useState('');
  const [ruleSearch, setRuleSearch] = useState('');
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MappingDraft | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TransformTestResult | null>(null);

  const all = useServiceQuery(() => modelService.list(), [], { subscribe: modelService.subscribe });
  const summary = useServiceQuery(() => tableService.summary(), [], { subscribe: tableService.subscribe });
  const options = useServiceQuery(() => tableService.filterOptions(), [], { subscribe: tableService.subscribe });

  const models = useMemo(() => all.data ?? [], [all.data]);
  const term = entitySearch.trim().toLowerCase();
  const shownModels = term ? models.filter((m) => `${m.name} ${m.id} ${m.fields.map((f) => f.name).join(' ')}`.toLowerCase().includes(term)) : models;

  // A ?source= link (from a source's drawer) lands on all entities' mappings for that source.
  const fallbackModel = sourceParam || tabParam === 'mappings' ? ALL : (models[0]?.id ?? null);
  const selectedId = modelParam === ALL || models.some((m) => m.id === modelParam) ? modelParam : fallbackModel;
  const model = models.find((m) => m.id === selectedId);
  const isAll = selectedId === ALL;
  const tab: Tab = isAll ? 'mappings' : tabParam === 'mappings' || tabParam === 'versions' ? tabParam : 'fields';
  const source = sourceParam ?? ALL;

  const rules = useServiceQuery(
    () => tableService.listMappings({ search: ruleSearch, source, entity: isAll ? ALL : (selectedId ?? ALL) }),
    [ruleSearch, source, isAll, selectedId],
    { subscribe: tableService.subscribe },
  );
  const openRule = rules.data?.items.find((r) => r.id === openRuleId) ?? null;

  const drafts = models.filter((m) => m.draft);
  const s = summary.data;

  const selectModel = (id: string) => setQueryParams({ model: id, tab: id === ALL ? 'mappings' : tab === 'fields' || tab === 'versions' ? tab : 'mappings' });
  // Keep the selected entity in the URL: "?tab=mappings" alone means "all entities' mappings".
  const setTab = (t: string) => setQueryParams({ model: selectedId, tab: t === 'fields' ? null : t });
  const setSource = (v: string) => setQueryParams({ source: v === ALL ? null : v });
  const ruleFiltered = !!ruleSearch || source !== ALL;
  const clearRuleFilters = () => {
    setRuleSearch('');
    setSource(ALL);
  };

  /** The stored mapping behind a rule row (keeps fields the table view does not show, e.g. its source map group). */
  const mappingOf = (r: MappingRule): MappingDraft | null => {
    const m = models.find((x) => x.id === r.canonicalEntity);
    const x = m?.mappings.find((y) => y.id === r.id);
    return m && x ? { ...x, modelId: m.id } : null;
  };

  const saveMapping = async () => {
    if (!editing) return;
    if (!editing.sourceField.trim() || !editing.canonicalField) return void message.warning('Source field and canonical field are required');
    setBusy(true);
    try {
      const { modelId, ...rest } = editing;
      await modelService.saveMapping(modelId, { ...rest, sourceField: rest.sourceField.trim(), transform: rest.transform.trim() || 'NONE' });
      message.success(`${editing.id ? 'Mapping updated' : 'Mapping added'} in the draft`);
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  const removeMapping = (r: MappingRule) => {
    Modal.confirm({
      title: 'Remove this mapping?',
      content: `${r.sourceSystem} ${r.sourceField} will no longer feed ${r.canonicalEntity}.${r.canonicalField}. The change goes into the draft.`,
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: async () => {
        await modelService.removeMapping(r.canonicalEntity, r.id);
        setOpenRuleId(null);
        message.success('Mapping removed in the draft');
      },
    });
  };

  const publish = async () => {
    setBusy(true);
    try {
      const ids = await modelService.publishAll(publishNote.trim() || undefined);
      const v = await tableService.publish();
      message.success(`Data model v${v} published: ${ids.length} ${ids.length === 1 ? 'entity' : 'entities'} updated`);
      setPublishOpen(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    Modal.confirm({
      title: `Discard draft v${s?.draftVersion ?? ''}?`,
      content: 'Mapping changes made in the draft are reverted and the live version stays as it is. Entities that were never published keep their first draft.',
      okText: 'Discard draft',
      onOk: async () => {
        const n = await modelService.discardAll();
        message.info(n ? `Draft discarded for ${n} ${n === 1 ? 'entity' : 'entities'}` : 'Nothing to discard');
      },
    });
  };

  const testTransforms = async () => {
    setTesting(true);
    try {
      setTestResult(await tableService.testTransforms());
    } finally {
      setTesting(false);
    }
  };

  const fieldColumns: IntColumn<CanonicalModelRow['fields'][number]>[] = [
    { key: 'name', title: 'Field', render: (f) => <span className="font-mono font-bold text-[#2563EB]">{f.name}</span> },
    { key: 'type', title: 'Type', priority: 2, render: (f) => <span className="whitespace-nowrap font-mono text-[11px] text-[#64748B]">{f.type}</span> },
    {
      key: 'req',
      title: 'Required',
      render: (f) =>
        f.required ? (
          <Pill tone="brand" dot={false}>
            Required
          </Pill>
        ) : (
          <span className="text-[11px] text-[#94A3B8]">Optional</span>
        ),
    },
    { key: 'desc', title: 'Description', priority: 2, grow: true, render: (f) => <span className="block truncate text-[#475569]">{f.description}</span> },
  ];

  const ruleColumns: DataColumn<MappingRule>[] = [
    {
      title: 'Source field',
      key: 'source',
      priority: 1,
      render: (_: unknown, r) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-bold text-[#141416]">{r.sourceField}</div>
          <div className="truncate text-[11px] text-[#64748B]">{r.sourceSystem}</div>
        </div>
      ),
    },
    {
      title: 'Canonical field',
      key: 'canonical',
      priority: 1,
      render: (_: unknown, r) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-bold text-[#2563EB]">{r.canonicalField}</div>
          <div className="truncate font-mono text-[11px] text-[#64748B]">{r.canonicalEntity}</div>
        </div>
      ),
    },
    {
      title: 'Transform',
      dataIndex: 'transformation',
      key: 'tx',
      priority: 3,
      render: (v: string) => <span className="inline-block max-w-full truncate rounded-md border border-[#E2E8F0] bg-[#F1F5F9] px-2 py-0.5 align-middle font-mono text-[11px] text-[#1E293B]">{v}</span>,
    },
    { title: 'Confidence', dataIndex: 'confidence', key: 'conf', priority: 2, align: 'right', render: (v: number) => <span className={`font-mono text-[11px] font-extrabold ${confTone(v)}`}>{v}%</span> },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      priority: 1,
      ellipsis: false,
      render: (v: MappingRule['status']) => (
        <Pill tone={RULE_PILL[v]} dot={false}>
          {v === 'Schema Drift Warning' ? 'Schema drift' : v}
        </Pill>
      ),
    },
  ];

  const sourceOptions = [...new Set([...(options.data?.sourceSystems ?? []), ...(source !== ALL ? [source] : [])])];
  const unmappedRequired = model ? model.fields.filter((f) => f.required && !model.mappings.some((m) => m.canonicalField === f.name)) : [];

  const mappingsTab = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={ruleSearch} onChange={setRuleSearch} placeholder="Search source or canonical field" label="Search mapping rules" />
        <select aria-label="Source system" value={source} onChange={(e) => setSource(e.target.value)} className={SELECT}>
          <option value={ALL}>All sources</option>
          {sourceOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {model && (
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() =>
              setEditing({ modelId: model.id, source: source !== ALL ? source : SOURCE_SYSTEMS[0], sourceField: '', canonicalField: model.fields[0]?.name ?? '', transform: 'NONE', confidence: 90 })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add mapping</span>
          </button>
        )}
        <button type="button" onClick={clearRuleFilters} disabled={!ruleFiltered} className={`${BTN_GHOST} ml-auto`}>
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Clear filters</span>
        </button>
      </div>
      {source !== ALL && (
        <p className="m-0 text-[11px] text-[#64748B]">
          Showing rules from <span className="font-semibold text-[#141416]">{source}</span>.{' '}
          <Link href={sourceHref(source, 'mappings')} className="font-semibold text-[#0284C7] hover:underline">
            Open the source
          </Link>
        </p>
      )}
      <DataTable<MappingRule>
        rowKey="id"
        columns={ruleColumns}
        dataSource={rules.data?.items ?? []}
        initialLoading={rules.initialLoading}
        refreshing={rules.loading && !rules.initialLoading}
        filtered={ruleFiltered}
        onClearFilters={clearRuleFilters}
        pagination={rules.data && rules.data.total > 25 ? { pageSize: 25, showSizeChanger: false } : false}
        onRowClick={(r) => setOpenRuleId(r.id)}
        emptyTitle="No mapping rules yet. Add one to start the draft."
      />
      {model && unmappedRequired.length > 0 && (
        <div className="rounded-xl border border-[#FEF3C7] bg-[#FFFBEB] px-3 py-2 text-[11px] text-[#854D0E]">
          Required fields with no source: <span className="font-mono font-bold">{unmappedRequired.map((f) => f.name).join(', ')}</span>. These are filled by a file source or derived in the
          pipeline.
        </div>
      )}
    </div>
  );

  const versionsTab = model && (
    <ol className="m-0 list-none p-0">
      {model.versions.map((v) => (
        <li key={v.version} className="relative border-l border-[#E2E8F0] pb-4 pl-4 last:pb-0">
          <span
            className={`absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white ${v.status === 'draft' ? 'bg-[#F59E0B]' : v.status === 'published' ? 'bg-[#059669]' : 'bg-[#94A3B8]'}`}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono font-extrabold text-[#141416]">v{v.version}</span>
            <Pill tone={v.status === 'draft' ? 'medium' : v.status === 'published' ? 'low' : 'neutral'} dot={false}>
              {v.status === 'draft' ? 'Draft' : v.status === 'published' ? 'Live' : 'Superseded'}
            </Pill>
            <span className="text-[11px] text-[#64748B]">{v.author}</span>
            <span className="text-[11px] text-[#94A3B8]">{v.publishedAt ? fmtDateTime(v.publishedAt) : 'not published'}</span>
          </div>
          <div className="mt-0.5 text-xs text-[#475569]">{v.note}</div>
        </li>
      ))}
      {model.versions.length === 0 && <li className="text-xs text-[#94A3B8]">No versions yet.</li>}
    </ol>
  );

  const editModel = editing ? models.find((m) => m.id === editing.modelId) : undefined;

  return (
    <div className="w-full min-w-0 space-y-6 pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Data model"
        description="The canonical entities every source maps into, and the mapping rules that feed them. Changes go into one draft; publish it to make them live for ingestion."
        actions={
          <PageActions
            secondary={[{ key: 'test', label: testing ? 'Testing…' : 'Test transforms', icon: <Play />, onClick: testTransforms, disabled: testing }]}
            primary={{
              key: 'publish',
              label: drafts.length ? `Publish draft v${s?.draftVersion ?? ''}` : 'Nothing to publish',
              icon: <Upload />,
              onClick: () => {
                setPublishNote('');
                setPublishOpen(true);
              },
              disabled: !drafts.length || busy,
            }}
          />
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Canonical entities"
          value={models.length}
          context={`${models.filter((m) => m.version).length} published · ${drafts.length} in draft`}
          icon={<Boxes />}
          loading={all.initialLoading}
        />
        <MetricCard
          label="Mapping rules"
          value={s?.activeRules ?? 0}
          context={s ? `Across ${s.connectors} sources` : undefined}
          icon={<Database />}
          iconTone="slate"
          loading={!s}
        />
        <MetricCard label="Average confidence" value={s ? `${s.averageConfidence}%` : '-'} context="AI-assisted semantic matches" icon={<CheckCircle />} iconTone="green" loading={!s} />
        <MetricCard
          label="Schema drift"
          value={s?.driftWarnings ?? 0}
          unit={s?.driftWarnings === 1 ? 'rule' : 'rules'}
          context={s ? (s.driftSources.length ? s.driftSources.join(', ') : 'No drift detected') : undefined}
          icon={<AlertTriangle />}
          iconTone={s?.driftWarnings ? 'amber' : 'green'}
          loading={!s}
        />
      </div>

      {drafts.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-[#FEF3C7] bg-[#FFFBEB] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 flex min-w-0 items-start gap-2 text-xs text-[#854D0E]">
            <GitBranch className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-bold">Draft v{s?.draftVersion}</span> changes {drafts.length} {drafts.length === 1 ? 'entity' : 'entities'}: {drafts.map((m) => m.name).join(', ')}. Ingestion keeps
              using the live versions until you publish.
            </span>
          </p>
          {drafts.some((m) => m.version) && (
            <button type="button" className={`${BTN_GHOST} shrink-0`} onClick={discard}>
              Discard draft
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Panel title="Entities" icon={<Boxes />} flush>
          <div className="border-b border-[#F1F5F9] p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={entitySearch}
                onChange={(e) => setEntitySearch(e.target.value)}
                placeholder="Search entity or field"
                aria-label="Search entities"
                className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] py-1.5 pl-9 pr-3 text-xs placeholder-[#94A3B8] focus:border-[#FFD600] focus:bg-white focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-[320px] overflow-y-auto p-2 lg:max-h-[680px]">
            {all.initialLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-1.5 px-2 py-2.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            ) : (
              <>
                <EntityButton on={isAll} onClick={() => selectModel(ALL)} title="All entities" meta={`${s?.activeRules ?? 0} mapping rules · ${s?.connectors ?? 0} sources`} />
                {shownModels.map((m) => (
                  <EntityButton
                    key={m.id}
                    on={m.id === selectedId}
                    onClick={() => selectModel(m.id)}
                    title={m.name}
                    pill={
                      m.status !== 'published' ? (
                        <Pill tone={STATUS_PILL[m.status].tone} dot={false}>
                          {STATUS_PILL[m.status].label}
                        </Pill>
                      ) : undefined
                    }
                    meta={
                      <>
                        <span className="font-mono font-bold text-[#475569]">v{m.version ?? m.draft?.version}</span>
                        {m.draft && m.version && <span className="font-mono text-[#D97706]"> → v{m.draft.version}</span>} · {m.fieldCount} fields · {m.mappings.length} rules
                      </>
                    }
                  />
                ))}
                {shownModels.length === 0 && <div className="py-6 text-center text-xs text-[#94A3B8]">No entity matches “{entitySearch}”.</div>}
              </>
            )}
          </div>
        </Panel>

        <section className="min-w-0 rounded-2xl border border-[#E2E8F0] bg-white shadow-2xs">
          {all.initialLoading ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              <div className="flex min-w-0 items-start gap-2.5 border-b border-[#F1F5F9] px-5 pb-4 pt-5">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#FEF3C7] bg-[#FFFBEB] text-amber-500">
                  <FileCode className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 text-sm font-extrabold text-[#141416]">{model ? model.name : 'All entities'}</h2>
                    {model && <span className="font-mono text-[11px] font-bold text-[#475569]">{model.id}</span>}
                    {model && (
                      <Pill tone={STATUS_PILL[model.status].tone} dot={false}>
                        {STATUS_PILL[model.status].label}
                      </Pill>
                    )}
                  </div>
                  <p className="m-0 mt-0.5 text-xs text-[#64748B]">{model ? model.description : 'Every mapping rule, from every source into every canonical entity.'}</p>
                  {model && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#64748B]">
                      <span>
                        Live: <span className="font-mono font-bold text-[#141416]">{model.version ? `v${model.version}` : 'not published'}</span>
                      </span>
                      {model.draft && (
                        <span>
                          In draft: <span className="font-mono font-bold text-[#D97706]">v{model.draft.version}</span>, “{model.draft.note}”
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="px-5 pb-5">
                <Tabs
                  activeKey={tab}
                  onChange={setTab}
                  items={[
                    ...(model ? [{ key: 'fields', label: `Fields (${model.fieldCount})`, children: <IntTable columns={fieldColumns} rows={model.fields} rowKey={(f) => f.name} /> }] : []),
                    { key: 'mappings', label: `Mappings${rules.data ? ` (${rules.data.total})` : ''}`, children: mappingsTab },
                    ...(model ? [{ key: 'versions', label: `Versions (${model.versions.length})`, children: versionsTab }] : []),
                  ]}
                />
              </div>
            </>
          )}
        </section>
      </div>

      {/* Rule detail */}
      <Drawer
        open={!!openRule}
        onClose={() => setOpenRuleId(null)}
        size="min(480px, 100vw)"
        title={
          openRule && (
            <span className="font-mono text-sm font-extrabold text-[#141416]">
              {openRule.sourceField} → {openRule.canonicalField}
            </span>
          )
        }
        footer={
          openRule && (
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={BTN_GHOST} onClick={() => removeMapping(openRule)}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
              <button
                type="button"
                className={BTN_SECONDARY}
                onClick={() => {
                  const m = mappingOf(openRule);
                  if (m) setEditing(m);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            </div>
          )
        }
      >
        {openRule && (
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={RULE_PILL[openRule.status]} dot={false}>
                {openRule.status}
              </Pill>
              <span className="text-[#64748B]">
                Confidence <span className={`font-mono font-extrabold ${confTone(openRule.confidence)}`}>{openRule.confidence}%</span>
              </span>
              <span className="text-[#64748B]">{openRule.isRequired ? 'Required field' : 'Optional field'}</span>
            </div>
            <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                ['Source system', openRule.sourceSystem],
                ['Source table', openRule.sourceTable],
                ['Raw type', openRule.sourceType],
                ['Canonical entity', openRule.canonicalEntity],
                ['Target type', openRule.canonicalType],
                ['Transformation', openRule.transformation],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">{k}</dt>
                  <dd className="m-0 mt-0.5 break-words font-mono text-[#141416]">{v}</dd>
                </div>
              ))}
            </dl>
            {openRule.sampleValue && (
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Sample</div>
                <div className="flex flex-wrap items-center gap-2 font-mono">
                  <span className="break-all">&quot;{openRule.sampleValue}&quot;</span>
                  <ArrowRight size={13} className="text-[#94A3B8]" />
                  <span className="break-all font-bold text-[#2563EB]">&quot;{openRule.transformedSample}&quot;</span>
                </div>
              </div>
            )}
            <Link href={sourceHref(openRule.sourceSystem, 'mappings')} className="inline-block font-semibold text-[#0284C7] hover:underline">
              Open {openRule.sourceSystem}
            </Link>
          </div>
        )}
      </Drawer>

      {/* Mapping editor */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-bold">{editing?.id ? `Edit mapping ${editing.id}` : `Add mapping to ${editModel?.name ?? ''}`}</span>
          </div>
        }
        open={!!editing}
        onOk={saveMapping}
        onCancel={() => setEditing(null)}
        okText={editing?.id ? 'Save to draft' : 'Add to draft'}
        confirmLoading={busy}
        okButtonProps={{ style: { backgroundColor: '#FFD600', color: '#141416', fontWeight: 'bold' } }}
      >
        {editing && editModel && (
          <div className="grid grid-cols-1 gap-3 py-2 text-xs sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="map-source">
                Source system
              </label>
              <select id="map-source" className={`${SELECT} w-full`} value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })}>
                {[...new Set<string>([...SOURCE_SYSTEMS, ...(options.data?.sourceSystems ?? [])])].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="map-sf">
                Source field
              </label>
              <input id="map-sf" className={`${INPUT} font-mono`} value={editing.sourceField} placeholder="TABLE.FIELD" onChange={(e) => setEditing({ ...editing, sourceField: e.target.value })} />
            </div>
            <div>
              <label className={LABEL} htmlFor="map-cf">
                Canonical field
              </label>
              <select id="map-cf" className={`${SELECT} w-full font-mono`} value={editing.canonicalField} onChange={(e) => setEditing({ ...editing, canonicalField: e.target.value })}>
                {editModel.fields.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} ({f.type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="map-tx">
                Transform
              </label>
              <input id="map-tx" list="map-transforms" className={`${INPUT} font-mono`} value={editing.transform} onChange={(e) => setEditing({ ...editing, transform: e.target.value })} />
              <datalist id="map-transforms">
                {TRANSFORMS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor="map-conf">
                Confidence: <span className="font-mono text-[#141416]">{editing.confidence}%</span>
              </label>
              <input
                id="map-conf"
                type="range"
                min={0}
                max={100}
                value={editing.confidence}
                onChange={(e) => setEditing({ ...editing, confidence: Number(e.target.value) })}
                className="w-full accent-[#FFD600]"
              />
            </div>
            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 text-[11px] text-[#64748B] sm:col-span-2">
              Saved into draft <span className="font-mono font-bold text-[#141416]">v{s?.draftVersion}</span>. Ingestion keeps using the live version of {editModel.name} until you publish.
            </div>
          </div>
        )}
      </Modal>

      {/* Publish */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-bold">Publish draft v{s?.draftVersion}</span>
          </div>
        }
        open={publishOpen}
        onOk={publish}
        onCancel={() => setPublishOpen(false)}
        okText="Publish"
        confirmLoading={busy}
        okButtonProps={{ style: { backgroundColor: '#FFD600', color: '#141416', fontWeight: 'bold' } }}
      >
        <div className="space-y-3 py-2 text-xs text-[#475569]">
          <p className="m-0">New events and imports use the published versions straight away. These entities change:</p>
          <ul className="m-0 space-y-1 pl-4">
            {drafts.map((m) => (
              <li key={m.id}>
                <span className="font-semibold text-[#141416]">{m.name}</span>{' '}
                <span className="font-mono">
                  {m.version ? `v${m.version} → ` : ''}v{m.draft?.version}
                </span>{' '}
                · {m.mappings.length} rules, {m.fieldCount} fields
              </li>
            ))}
          </ul>
          <div>
            <label htmlFor="pub-note" className={LABEL}>
              Release note
            </label>
            <textarea id="pub-note" rows={3} className={INPUT} value={publishNote} onChange={(e) => setPublishNote(e.target.value)} placeholder="What changed and why" />
          </div>
        </div>
      </Modal>

      {/* Transform test */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-500" />
            <span className="text-sm font-bold text-[#141416]">Ingestion transformation preview</span>
          </div>
        }
        open={!!testResult}
        onCancel={() => setTestResult(null)}
        footer={null}
        width={700}
      >
        {testResult && (
          <div className="space-y-4 pt-3 text-xs">
            <div className="rounded-xl border border-[#86EFAC] bg-[#DCFCE7] p-3 font-medium text-[#15803D]">
              Transform validated on {testResult.records.toLocaleString('en-GB')} staging records. {testResult.truncationErrors} truncation errors, {testResult.typeMatch}% type match.
            </div>
            <div className="space-y-2 overflow-hidden rounded-xl bg-[#141416] p-4 font-mono text-[11px] text-white">
              <div className="text-[#94A3B8]">{`// Sample (${testResult.sourceLabel} → canonical)`}</div>
              <pre className="m-0 whitespace-pre-wrap break-all text-white">
                <span className="text-[#FFD600]">&quot;source&quot;</span>: {JSON.stringify(testResult.source, null, 2)}
              </pre>
              <div className="text-[#94A3B8]">{`// Canonical target entity (${testResult.targetEntity})`}</div>
              <pre className="m-0 whitespace-pre-wrap break-all text-white">
                <span className="text-[#38BDF8]">&quot;canonical_asset&quot;</span>: {JSON.stringify(testResult.canonical_asset, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function EntityButton({ on, onClick, title, pill, meta }: { on: boolean; onClick: () => void; title: string; pill?: React.ReactNode; meta: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on}
      className={`mb-1 block w-full cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-all ${on ? 'border-[#FEF3C7] bg-[#FFFDF5] shadow-2xs' : 'border-transparent bg-transparent hover:bg-[#F8FAFC]'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-extrabold text-[#141416]">{title}</span>
        {pill}
      </div>
      <div className="mt-1 truncate text-[11px] text-[#64748B]">{meta}</div>
    </button>
  );
}
