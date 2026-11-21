'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Form, Input, Modal, Radio, Select, Steps, message } from 'antd';
import { ArrowRight, CircleCheck, CircleAlert, FileSpreadsheet, Loader2, Search, Circle } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { modelService } from '@/services/integrationService';
import { sourceService, type CatalogueEntry, type ConnectionTestResult, type Source, type SourceMeta } from '@/services/sourceService';
import { EMPTY_FILE_DRAFT, FileImportStep, type FileDraft } from './FileImportStep';
import { SystemMark, fmtNum } from './sourceMeta';

interface Props {
  open: boolean;
  /** Open straight on the File / CSV step (/integration/map?add=file, the old Manual import URL). */
  startWithFile?: boolean;
  /** Canonical model preselected on the File step (?model= from the old Manual import links). */
  fileModel?: string | null;
  meta: SourceMeta | undefined;
  onClose: () => void;
  /** "View source" on the Done step: open the new source's drawer. */
  onView: (source: Source) => void;
}

interface AuthValues {
  name: string;
  environment: string;
  authType: string;
  instanceUrl: string;
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
  account?: string;
  privateKey?: string;
}

type StepKey = 'system' | 'auth' | 'scope' | 'test' | 'file' | 'review' | 'done';
const CONNECTOR_FLOW: StepKey[] = ['system', 'auth', 'scope', 'test', 'review', 'done'];
const FILE_FLOW: StepKey[] = ['system', 'file', 'review', 'done'];
const STEP_TITLE: Record<StepKey, string> = {
  system: 'System',
  auth: 'Authentication',
  scope: 'Scope',
  test: 'Test',
  file: 'File',
  review: 'Review mappings',
  done: 'Done',
};

/** File / CSV is not a connector: it runs the manual-import flow and registers the file as a source. */
const FILE_ENTRY: CatalogueEntry = {
  id: 'file-csv',
  name: 'File / CSV upload',
  vendor: 'Manual upload',
  category: 'Files',
  connectorType: 'CSV',
  role: 'Load a CSV into a canonical model when a system has no connector',
  syncMethod: 'Manual upload',
  authTypes: [],
  tables: [],
  mappingTemplate: [],
};

const TEST_STEPS = ['Resolve host', 'Authenticate', 'Read schema', 'Sample 100 records'];
const label = (t: string) => <span className="text-xs font-semibold">{t}</span>;
const BTN = '!rounded-xl !text-xs !font-semibold';
const BTN_YELLOW = '!rounded-xl !border-[#FFD600] !bg-[#FFD600] !text-xs !font-extrabold !text-[#141416] hover:!bg-[#FACC15] disabled:!opacity-50';

interface ReviewRule {
  key: string;
  sourceField: string;
  target: string;
  note: string;
}

export function ConnectWizard({ open, startWithFile, fileModel, meta, onClose, onView }: Props) {
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState('all');
  const [q, setQ] = useState('');
  const [entry, setEntry] = useState<CatalogueEntry | null>(null);
  const [auth, setAuth] = useState<AuthValues | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [file, setFile] = useState<FileDraft>(EMPTY_FILE_DRAFT);
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState(0);
  const [test, setTest] = useState<ConnectionTestResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ source: Source; summary: string } | null>(null);
  const [form] = Form.useForm<AuthValues>();
  const authType = Form.useWatch('authType', form);
  const models = useServiceQuery(() => modelService.list(), [], { subscribe: modelService.subscribe });

  // Reset the wizard each time it opens (state adjusted during render; the antd form instance in an effect)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep(startWithFile ? 1 : 0);
      setCategory('all');
      setQ('');
      setEntry(startWithFile ? FILE_ENTRY : null);
      setAuth(null);
      setTables([]);
      setSkipped([]);
      setFile({ ...EMPTY_FILE_DRAFT, modelId: fileModel || EMPTY_FILE_DRAFT.modelId });
      setTest(null);
      setTestProgress(0);
      setCreated(null);
    }
  }
  useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  const isFile = entry?.id === FILE_ENTRY.id;
  const flow = isFile ? FILE_FLOW : CONNECTOR_FLOW;
  const cur = flow[step];

  const catalogue = useMemo(() => {
    const term = q.trim().toLowerCase();
    return [FILE_ENTRY, ...(meta?.catalogue ?? [])].filter(
      (c) => (category === 'all' || c.category === category) && (!term || `${c.name} ${c.vendor} ${c.role} csv file`.toLowerCase().includes(term)),
    );
  }, [meta, category, q]);

  const pick = (c: CatalogueEntry) => {
    setEntry(c);
    setSkipped([]);
    if (c.id === FILE_ENTRY.id) return;
    setTables(c.tables.map((t) => t.name));
    form.setFieldsValue({ name: c.name, authType: c.authTypes[0], environment: 'Production', instanceUrl: '' });
  };

  // Suggested rules shown on the review step.
  const modelName = (id: string) => meta?.canonicalModels.find((m) => m.id === id)?.name ?? id;
  const reviewRules: ReviewRule[] = !entry
    ? []
    : isFile
      ? (file.result?.headers ?? [])
          .filter((h) => file.result?.mapping[h])
          .map((h) => ({ key: h, sourceField: h, target: `${file.modelId}.${file.result!.mapping[h]}`, note: 'Matched on the File step' }))
      : entry.mappingTemplate
          .filter((m) => tables.includes(m.table))
          .map((m) => ({ key: m.sourceField, sourceField: m.sourceField, target: m.canonicalField, note: modelName(m.canonicalModel) }));
  const keptRules = reviewRules.filter((r) => !skipped.includes(r.key));

  const runTest = async () => {
    if (!auth) return;
    setTesting(true);
    setTest(null);
    setTestProgress(0);
    const ticker = setInterval(() => setTestProgress((p) => Math.min(TEST_STEPS.length - 1, p + 1)), 300);
    try {
      const result = await sourceService.testNewConnection({ instanceUrl: auth.instanceUrl, authType: auth.authType });
      setTestProgress(result.ok ? TEST_STEPS.length : 0);
      setTest(result);
    } finally {
      clearInterval(ticker);
      setTesting(false);
    }
  };

  const connect = async () => {
    if (!entry) return;
    setCreating(true);
    try {
      if (isFile) {
        if (!file.result) return;
        const { source, import: rec } = await sourceService.createFromFile({
          name: file.name,
          environment: 'Production',
          modelId: file.modelId,
          fileName: file.fileName || 'pasted.csv',
          result: file.result,
          rules: keptRules.map((r) => ({ sourceField: r.sourceField, canonicalField: file.result!.mapping[r.key] })),
        });
        setCreated({
          source,
          summary: `${rec.committed} of ${rec.rows} rows were written to ${modelName(file.modelId)}${rec.rejected ? ` (${rec.rejected} rejected)` : ''}. ${source.fieldMappings.length} mapping rules were added to the Data model draft.`,
        });
      } else {
        if (!auth) return;
        const source = await sourceService.create({
          catalogueId: entry.id,
          name: auth.name,
          environment: auth.environment,
          authType: auth.authType,
          instanceUrl: auth.instanceUrl,
          tables,
          skipFields: skipped,
        });
        setCreated({
          source,
          summary: `First sync pulled ${fmtNum(source.records30d)} records from ${source.tables.length} tables. ${source.fieldMappings.length} mapping rules were added to the Data model draft.`,
        });
      }
      setStep(flow.indexOf('done'));
      message.success(`${isFile ? file.name.trim() : auth?.name} connected`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const next = async () => {
    if (cur === 'system') {
      if (!entry) return message.warning('Choose a system to connect');
      setStep(1);
    } else if (cur === 'auth') {
      try {
        const v = await form.validateFields();
        setAuth(v);
        setTest(null);
        setStep(step + 1);
      } catch {
        /* field errors are shown inline */
      }
    } else if (cur === 'scope') {
      if (!tables.length) return message.warning('Choose at least one table');
      setTest(null);
      setStep(step + 1);
      // Entering the test step runs the connection test straight away
      void runTest();
    } else if (cur === 'test') {
      if (test?.ok) setStep(step + 1);
    } else if (cur === 'file') {
      if (!file.name.trim()) return message.warning('Give the source a name');
      if (!file.result) return message.warning('Check the file first');
      if (!file.result.valid) return message.warning('The file has no valid rows yet');
      setStep(step + 1);
    } else if (cur === 'review') {
      await connect();
    }
  };

  const nextDisabled =
    (cur === 'system' && !entry) || (cur === 'test' && !test?.ok) || (cur === 'file' && (!file.result?.valid || !file.name.trim())) || (cur === 'review' && !keptRules.length);

  const footer =
    cur === 'done'
      ? [
          <Button
            key="done"
            onClick={() => {
              onClose();
              if (created) onView(created.source);
            }}
            className={BTN_YELLOW}
          >
            View source
          </Button>,
        ]
      : [
          <Button key="cancel" onClick={onClose} className={BTN}>
            Cancel
          </Button>,
          step > 0 && (
            <Button key="back" onClick={() => setStep(step - 1)} disabled={testing || creating} className={BTN}>
              Back
            </Button>
          ),
          cur === 'test' && test && !test.ok && (
            <Button key="retry" onClick={runTest} loading={testing} className={BTN}>
              Test again
            </Button>
          ),
          <Button key="next" onClick={next} loading={creating} disabled={nextDisabled} className={BTN_YELLOW}>
            {cur === 'review' ? (isFile ? 'Import and connect' : 'Connect source') : 'Next'}
          </Button>,
        ].filter(Boolean);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={<span className="text-sm font-extrabold">Add source{entry && step > 0 ? ` · ${entry.name}` : ''}</span>}
      width={760}
      footer={footer}
      mask={{ closable: false }}
      destroyOnHidden
    >
      <Steps size="small" current={step} className="!mb-4 !mt-2" items={flow.map((k) => ({ title: STEP_TITLE[k] }))} />

      {/* System */}
      <div className={cur === 'system' ? '' : 'hidden'}>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <Input
            allowClear
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search connectors"
            prefix={<Search size={14} className="text-[#94A3B8]" />}
            aria-label="Search connectors"
            className="sm:max-w-[240px]"
          />
          <div className="flex flex-wrap gap-1.5">
            {['all', ...(meta?.categories ?? [])].map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  category === c ? 'border-[#141416] bg-[#141416] text-white' : 'border-[#E2E8F0] bg-white text-[#475569] hover:border-gray-400'
                }`}
              >
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
        </div>
        <div className="grid max-h-[340px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {catalogue.map((c) => {
            const active = entry?.id === c.id;
            return (
              <button
                key={c.id}
                onClick={() => pick(c)}
                aria-pressed={active}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-left ${
                  active ? 'border-[#FFD600] bg-[#FFFBEB] ring-2 ring-[#FEF08A]' : 'border-[#E2E8F0] bg-white hover:border-gray-400'
                }`}
              >
                {c.id === FILE_ENTRY.id ? (
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]">
                    <FileSpreadsheet size={15} />
                  </span>
                ) : (
                  <SystemMark name={c.name} size={28} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-[#141416]">{c.name}</span>
                  <span className="block truncate text-[11px] text-[#64748B]">{c.role}</span>
                  <span className="mt-1 inline-block rounded-full bg-[#F1F5F9] px-1.5 py-px text-[10px] font-semibold text-[#475569]">{c.category}</span>
                </span>
              </button>
            );
          })}
          {!catalogue.length && <p className="col-span-full py-6 text-center text-xs text-[#94A3B8]">No connectors match.</p>}
        </div>
      </div>

      {/* File (File / CSV only): the manual-import flow */}
      {isFile && cur === 'file' && <FileImportStep value={file} onChange={setFile} models={models.data} />}

      {/* Authentication */}
      <div className={cur === 'auth' ? '' : 'hidden'}>
        <Form form={form} layout="vertical" requiredMark={false} preserve>
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Form.Item name="name" label={label('Source name')} rules={[{ required: true, whitespace: true, message: 'Give the source a name' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="environment" label={label('Environment')} rules={[{ required: true }]}>
              <Select options={(meta?.environments ?? []).map((e) => ({ value: e, label: e }))} />
            </Form.Item>
          </div>
          <Form.Item name="authType" label={label('Authentication method')} rules={[{ required: true }]}>
            <Radio.Group optionType="button" options={(entry?.authTypes ?? []).map((a) => ({ value: a, label: a }))} />
          </Form.Item>
          <Form.Item
            name="instanceUrl"
            label={label(authType === 'API key' ? 'Base URL' : 'Instance URL')}
            rules={[
              { required: true, message: 'Enter the instance URL' },
              { pattern: /^(https|sftp):\/\/[^\s/]+\.[^\s]+$/i, message: 'Use a full https:// or sftp:// address' },
            ]}
          >
            <Input placeholder="https://instance.example.com/api" />
          </Form.Item>
          {authType === 'OAuth 2.0' && (
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <Form.Item name="clientId" label={label('Client ID')} rules={[{ required: true, message: 'Enter the client ID' }, { min: 6, message: 'Client ID looks too short' }]}>
                <Input autoComplete="off" />
              </Form.Item>
              <Form.Item name="clientSecret" label={label('Client secret')} rules={[{ required: true, message: 'Enter the client secret' }, { min: 12, message: 'At least 12 characters' }]}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </div>
          )}
          {authType === 'API key' && (
            <Form.Item name="apiKey" label={label('API key')} rules={[{ required: true, message: 'Enter the API key' }, { min: 16, message: 'API keys are at least 16 characters' }]}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
          {authType === 'Service account' && (
            <>
              <Form.Item name="account" label={label('Service account')} rules={[{ required: true, message: 'Enter the service account' }, { min: 3, message: 'Too short' }]}>
                <Input placeholder="svc-circularity@northfield.example" autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="privateKey"
                label={label('Private key or key file contents')}
                rules={[
                  { required: true, message: 'Paste the private key' },
                  { validator: (_, v: string) => (!v || v.trim().length >= 32 ? Promise.resolve() : Promise.reject(new Error('The key looks incomplete'))) },
                ]}
              >
                <Input.TextArea rows={3} className="font-mono !text-[11px]" placeholder="-----BEGIN PRIVATE KEY-----" />
              </Form.Item>
            </>
          )}
          <p className="m-0 text-[11px] text-[#94A3B8]">Credentials are stored in the vault and never shown again.</p>
        </Form>
      </div>

      {/* Scope */}
      <div className={cur === 'scope' ? '' : 'hidden'}>
        {entry && !isFile && (
          <>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-bold text-[#141416]">Tables to sync</span>
              <span className="flex gap-2">
                <button className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-[#0284C7]" onClick={() => setTables(entry.tables.map((t) => t.name))}>
                  Select all
                </button>
                <button className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-[#64748B]" onClick={() => setTables([])}>
                  Clear
                </button>
              </span>
            </div>
            <Checkbox.Group value={tables} onChange={(v) => setTables(v as string[])} className="!flex !w-full !flex-col !gap-1.5">
              {entry.tables.map((t) => (
                <label key={t.name} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[#E2E8F0] px-3 py-2 hover:border-gray-400">
                  <Checkbox value={t.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] font-semibold text-[#141416]">{t.name}</span>
                    <span className="block truncate text-[11px] text-[#94A3B8]">{t.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-[#475569]">~{fmtNum(t.rows)} rows</span>
                </label>
              ))}
            </Checkbox.Group>
            <p className="m-0 mt-2 text-xs text-[#64748B]">
              {tables.length} of {entry.tables.length} tables selected · {reviewRules.length} suggested mapping rules to review next.
            </p>
          </>
        )}
      </div>

      {/* Test */}
      <div className={cur === 'test' ? '' : 'hidden'}>
        <div className="space-y-1.5">
          {TEST_STEPS.map((t, i) => {
            const done = testProgress > i;
            const failedHere = test && !test.ok && i === 0;
            const runningHere = testing && testProgress === i;
            return (
              <div key={t} className="flex items-center gap-2.5 rounded-xl border border-[#E2E8F0] px-3 py-2 text-xs">
                {failedHere ? (
                  <CircleAlert size={15} className="text-[#DC2626]" />
                ) : done ? (
                  <CircleCheck size={15} className="text-[#059669]" />
                ) : runningHere ? (
                  <Loader2 size={15} className="animate-spin text-amber-500" />
                ) : (
                  <Circle size={15} className="text-[#CBD5E1]" />
                )}
                <span className="font-semibold text-[#141416]">{t}</span>
              </div>
            );
          })}
        </div>
        {test && (
          <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${test.ok ? 'border-[#D1FAE5] bg-[#ECFDF5] text-[#065F46]' : 'border-[#FEE2E2] bg-[#FEF2F2] text-[#991B1B]'}`}>
            <span className="font-bold">{test.ok ? 'Connection test passed. ' : 'Connection test failed. '}</span>
            {test.message}
          </div>
        )}
      </div>

      {/* Review mappings */}
      {cur === 'review' && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-[#141416]">
              Suggested mapping rules · {keptRules.length} of {reviewRules.length} kept
            </span>
            <span className="text-[#64748B]">They go into the Data model as a draft; publish it there to make them live.</span>
          </div>
          {isFile && file.result && (
            <p className="m-0 mb-2 text-xs text-[#64748B]">
              {file.result.valid} valid rows will be written to {modelName(file.modelId)}
              {file.result.invalid ? `; ${file.result.invalid} rows with errors are skipped` : ''}.
            </p>
          )}
          <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
            {reviewRules.map((r) => {
              const kept = !skipped.includes(r.key);
              return (
                <label
                  key={r.key}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 ${kept ? 'border-[#E2E8F0]' : 'border-dashed border-[#CBD5E1] bg-[#F8FAFC] opacity-70'}`}
                >
                  <Checkbox checked={kept} onChange={(e) => setSkipped((s) => (e.target.checked ? s.filter((x) => x !== r.key) : [...s, r.key]))} />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-[#141416]">{r.sourceField}</span>
                    <ArrowRight size={12} className="shrink-0 text-[#94A3B8]" />
                    <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-[#2563EB]">{r.target}</span>
                  </span>
                  <span className="hidden shrink-0 text-[11px] text-[#94A3B8] sm:inline">{r.note}</span>
                </label>
              );
            })}
            {!reviewRules.length && <p className="py-4 text-center text-xs text-[#94A3B8]">No suggested rules. Go back and match at least one column or table.</p>}
          </div>
        </div>
      )}

      {/* Done */}
      {cur === 'done' && created && (
        <div className="flex flex-col items-center py-6 text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#ECFDF5] text-[#047857]">
            <CircleCheck size={22} />
          </span>
          <div className="text-sm font-extrabold text-[#141416]">{created.source.name} is connected</div>
          <p className="m-0 mt-1 max-w-md text-xs text-[#64748B]">{created.summary}</p>
        </div>
      )}
    </Modal>
  );
}
