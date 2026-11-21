'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button, Drawer, Dropdown, Form, Input, Modal, Select, Tabs, message } from 'antd';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CirclePlay,
  FileCheck2,
  KeyRound,
  MoreHorizontal,
  Pause,
  Play,
  PlugZap,
  RefreshCw,
  Stethoscope,
  Trash2,
  X,
} from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { sourceService, isFileSource, type CanonicalModelRef, type ConnectionTestResult, type Source, type SourceMeta } from '@/services/sourceService';
import { conflictService, eventService } from '@/services/integrationService';
import { EmptyState, ListSkeleton } from '@/components/ui';
import { ConflictResolver } from '@/components/integration/ConflictResolver';
import { ReplayButton } from '@/components/integration/EventDetail';
import { Pill } from '@/components/integration/Pills';
import { CONFLICT_STATUS_PILL, EVENT_STATUS_PILL, SEV_PILL } from '@/components/integration/issueMeta';
import { fmtClock } from '@/components/integration/format';
import { DiagnoseModal } from './DiagnoseModal';
import { RUN_META, SourceStatusPill, SystemMark, fmtDateTime, fmtNum, relTime } from './sourceMeta';

export type SourcePanel = 'overview' | 'sync' | 'conflicts' | 'mappings' | 'settings';
export const SOURCE_PANELS: SourcePanel[] = ['overview', 'sync', 'conflicts', 'mappings', 'settings'];

interface Props {
  /** Source id; null closes the drawer. */
  sourceId: string | null;
  panel: SourcePanel;
  onPanelChange: (p: SourcePanel) => void;
  meta: SourceMeta | undefined;
  onClose: () => void;
  onDeleted: () => void;
}

const H = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => (
  <div className="mb-2 mt-5 flex items-center justify-between gap-2 first:mt-0">
    <h3 className="m-0 text-xs font-extrabold text-[#141416]">{children}</h3>
    {action}
  </div>
);

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 py-1 text-xs">
      <dt className="text-[#64748B]">{k}</dt>
      <dd className="m-0 break-words text-[#141416]">{v}</dd>
    </div>
  );
}

function RunList({ runs }: { runs: Source['syncHistory'] }) {
  if (!runs.length) return <p className="m-0 text-xs text-[#94A3B8]">No sync runs yet.</p>;
  return (
    <div className="divide-y divide-[#F1F5F9]">
      {runs.map((r, i) => (
        <div key={`${r.at}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 py-1.5 text-xs">
          <span className="truncate font-mono text-[#475569]">{fmtDateTime(r.at)}</span>
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: RUN_META[r.status].fg, backgroundColor: RUN_META[r.status].bg }}>
            {RUN_META[r.status].label}
          </span>
          <span className="w-[78px] text-right font-mono text-[#141416]">{fmtNum(r.records)}</span>
          <span className="w-9 text-right font-mono text-[#94A3B8]">{r.durationSec}s</span>
        </div>
      ))}
    </div>
  );
}

const ENV_TONE: Record<string, string> = { Production: 'bg-[#ECFDF5] text-[#047857]', Staging: 'bg-[#E0F2FE] text-[#0284C7]', Sandbox: 'bg-[#F1F5F9] text-[#475569]' };
const LINK = 'text-xs font-semibold text-[#0284C7] hover:underline';
const BTN = '!rounded-xl !text-xs !font-semibold';
const BTN_YELLOW = '!rounded-xl !border-[#FFD600] !bg-[#FFD600] !text-xs !font-extrabold !text-[#141416] hover:!bg-[#FACC15]';

function confidenceTone(c: number) {
  if (c >= 0.9) return 'bg-[#ECFDF5] text-[#047857]';
  if (c >= 0.75) return 'bg-[#FEF3C7] text-[#D97706]';
  return 'bg-[#FEE2E2] text-[#B91C1C]';
}

/** Schema drift: the source reports it, or a mapped field lost confidence. */
const driftText = (n: number) => (n ? `${n} mapped ${n === 1 ? 'field' : 'fields'} changed type or format.` : 'Mapped fields changed type or format.');

export const hasSchemaDrift =(s: Source) => s.issue === 'schema_drift' || s.fieldMappings.some((m) => m.confidence < 0.75);

function SettingsForm({ source, meta }: { source: Source; meta: SourceMeta | undefined }) {
  const [form] = Form.useForm<{ syncMethod: string; environment: string }>();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const file = isFileSource(source);
  const save = async (values: { syncMethod: string; environment: string }) => {
    setSaving(true);
    try {
      await sourceService.updateSettings(source.id, values);
      message.success(`${source.name} settings saved`);
      setDirty(false);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Form
      form={form}
      layout="vertical"
      size="middle"
      initialValues={{ syncMethod: source.syncMethod, environment: source.environment }}
      onValuesChange={() => setDirty(true)}
      onFinish={save}
      requiredMark={false}
    >
      {!file && (
        <Form.Item name="syncMethod" label={<span className="text-xs font-semibold">Sync interval</span>} rules={[{ required: true }]}>
          <Select options={(meta?.syncIntervals ?? []).map((s) => ({ value: s.label, label: s.label }))} />
        </Form.Item>
      )}
      <Form.Item name="environment" label={<span className="text-xs font-semibold">Environment</span>} rules={[{ required: true }]}>
        <Select options={(meta?.environments ?? []).map((e) => ({ value: e, label: e }))} />
      </Form.Item>
      <div className="flex gap-2">
        <Button htmlType="submit" loading={saving} disabled={!dirty} className={`${BTN_YELLOW} disabled:!opacity-50`}>
          Save settings
        </Button>
        <Button
          disabled={!dirty}
          onClick={() => {
            form.resetFields();
            setDirty(false);
          }}
          className={BTN}
        >
          Reset
        </Button>
      </div>
    </Form>
  );
}

function nextRun(source: Source, meta: SourceMeta | undefined) {
  if (source.status === 'paused') return 'Paused';
  if (isFileSource(source)) return 'When a new file is uploaded';
  if (/real-time|streaming/i.test(source.syncMethod)) return 'Continuous';
  const mins = meta?.syncIntervals.find((s) => s.label === source.syncMethod)?.minutes ?? 60;
  const next = Date.parse(source.lastSyncAt) + mins * 60000;
  return fmtDateTime(new Date(next).toISOString());
}

/** Events of one source, newest first, with Replay on failed / warning ones. */
function SourceEvents({ source }: { source: Source }) {
  const q = useServiceQuery(() => eventService.list({ source: source.name, pageSize: 8 }), [source.name], { subscribe: eventService.subscribe });
  const more = `/integration/issues?tab=events&source=${encodeURIComponent(source.name)}`;
  return (
    <>
      <H
        action={
          q.data && q.data.total > 0 ? (
            <Link href={more} className={LINK}>
              All {q.data.total} in the event log
            </Link>
          ) : undefined
        }
      >
        Recent events
      </H>
      {q.initialLoading ? (
        <ListSkeleton rows={4} />
      ) : !q.data?.items.length ? (
        <p className="m-0 text-xs text-[#94A3B8]">No events from this source yet.</p>
      ) : (
        <div className="divide-y divide-[#F1F5F9]">
          {q.data.items.map((e) => (
            <div key={e.id} className="flex items-center gap-2 py-1.5 text-xs">
              <span className="w-[62px] shrink-0 font-mono text-[11px] text-[#475569]">{fmtClock(e.ts)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11px] font-semibold text-[#141416]">{e.type}</span>
                <span className="block truncate text-[11px] text-[#94A3B8]">{e.message}</span>
              </span>
              <Pill tone={EVENT_STATUS_PILL[e.status].tone}>{EVENT_STATUS_PILL[e.status].label}</Pill>
              <ReplayButton event={e} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Unresolved conflicts that involve this source, each resolvable in place. */
function SourceConflicts({ source }: { source: Source }) {
  const q = useServiceQuery(() => conflictService.list({ system: source.name, status: 'unresolved' }), [source.name], { subscribe: conflictService.subscribe });
  const [openId, setOpenId] = useState<string | null>(null);
  if (q.initialLoading) return <ListSkeleton rows={4} />;
  if (!q.data?.length)
    return <EmptyState compact title="No open conflicts" description={`${source.name} agrees with every other system on the fields it shares.`} />;
  return (
    <div className="space-y-2">
      <p className="m-0 text-xs text-[#64748B]">
        Fields where {source.name} disagrees with another system. Pick the value that wins; it is written back to the other systems.
      </p>
      {q.data.map((c) => {
        const open = openId === c.id;
        return (
          <div key={c.id} className={`rounded-xl border ${open ? 'border-[#FDE68A]' : 'border-[#E2E8F0]'}`}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : c.id)}
              aria-expanded={open}
              className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-[#141416]">
                  <span className="font-mono">{c.field}</span> on {c.entityId}
                </span>
                <span className="block truncate text-[11px] text-[#94A3B8]">
                  <span className="font-mono">{c.id}</span> · {c.values.map((v) => v.system).join(' vs ')}
                </span>
              </span>
              <Pill tone={SEV_PILL[c.severity].tone}>{SEV_PILL[c.severity].label}</Pill>
              {c.status === 'escalated' && (
                <Pill tone={CONFLICT_STATUS_PILL.escalated.tone} dot={false}>
                  {CONFLICT_STATUS_PILL.escalated.label}
                </Pill>
              )}
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-[#0284C7]">
                {open ? 'Close' : 'Resolve'} {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            </button>
            {open && (
              <div className="border-t border-[#F1F5F9] px-3 py-3">
                <ConflictResolver key={c.id} conflict={c} currentSource={source.name} showHistory={false} onDone={() => setOpenId(null)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Right-side drawer for one source: Overview, Sync & events, Conflicts, Mappings, Settings. */
export function SourceDrawer({ sourceId, panel, onPanelChange, meta, onClose, onDeleted }: Props) {
  const detail = useServiceQuery(() => sourceService.get(sourceId), [sourceId], { subscribe: sourceService.subscribe });
  const s = detail.data && (detail.data.id === sourceId || detail.data.name === sourceId) ? detail.data : null;
  const conflicts = useServiceQuery(
    () => (s ? conflictService.list({ system: s.name, status: 'unresolved' }) : Promise.resolve([])),
    [s?.name],
    { subscribe: conflictService.subscribe },
  );

  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [test, setTest] = useState<{ id: string; result: ConnectionTestResult } | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const open = !!sourceId;
  const loading = open && !s && (detail.loading || detail.data === undefined);

  const body = () => {
    if (loading) return <ListSkeleton rows={8} />;
    if (!s) return <EmptyState title="Source not found" description="It may have been removed. Pick another source from the list." compact />;

    const modelName = (id: string) => meta?.canonicalModels.find((m: CanonicalModelRef) => m.id === id)?.name ?? id;
    const paused = s.status === 'paused';
    const file = isFileSource(s);
    const drift = hasSchemaDrift(s);
    const testResult = test?.id === s.id ? test.result : null;
    const openConflicts = conflicts.data?.length ?? 0;

    const doTest = async () => {
      setTesting(true);
      try {
        const result = await sourceService.testConnection(s.id);
        setTest({ id: s.id, result });
        if (result.ok) message.success(`${s.name}: connection OK`);
        else message.error(`${s.name}: connection test failed`);
      } catch (e) {
        message.error((e as Error).message);
      } finally {
        setTesting(false);
      }
    };

    const doSync = async () => {
      setSyncing(true);
      const key = `sync-${s.id}`;
      message.loading({ content: `Syncing ${s.name}…`, key, duration: 0 });
      try {
        const { run } = await sourceService.syncNow(s.id);
        if (run.status === 'failed') message.error({ content: `${s.name}: sync failed. Run Diagnose for details.`, key });
        else if (run.status === 'partial') message.warning({ content: `${s.name}: partial sync, ${fmtNum(run.records)} records (schema drift)`, key });
        else message.success({ content: `${s.name}: synced ${fmtNum(run.records)} records`, key });
      } catch (e) {
        message.error({ content: (e as Error).message, key });
      } finally {
        setSyncing(false);
      }
    };

    const acceptSchema = async () => {
      setAccepting(true);
      try {
        await sourceService.acceptSchema(s.id);
        message.success(`${s.name}: new schema accepted; mappings re-validated`);
      } catch (e) {
        message.error((e as Error).message);
      } finally {
        setAccepting(false);
      }
    };

    const tabs = [
      {
        key: 'overview',
        label: 'Overview',
        children: (
          <div>
            <p className="m-0 text-xs leading-relaxed text-[#475569]">{s.description}</p>
            {s.statusNote && !drift && (
              <div className="mt-3 rounded-xl border border-[#FEF3C7] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
                <span className="font-bold">Attention: </span>
                {s.statusNote}
              </div>
            )}
            {drift && (
              <div className="mt-3 flex flex-col gap-2 rounded-xl border border-[#FEF3C7] bg-[#FFFBEB] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <p className="m-0 text-xs text-[#92400E]">
                  <span className="font-bold">Schema changed. </span>
                  {driftText(s.fieldMappings.filter((m) => m.confidence < 0.75).length)} Accept the new schema to re-validate the mappings.
                </p>
                <Button size="small" onClick={acceptSchema} loading={accepting} icon={<FileCheck2 size={13} />} className={`shrink-0 ${BTN}`}>
                  Accept new schema
                </Button>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => setDiagOpen(true)} icon={<Stethoscope size={14} />} className={BTN}>
                Diagnose
              </Button>
              <Button onClick={doTest} loading={testing} icon={<CirclePlay size={14} />} className={BTN}>
                Test connection
              </Button>
            </div>
            {testResult && (
              <div
                className={`mt-3 flex items-start gap-2 rounded-xl border px-2.5 py-2 text-xs ${
                  testResult.ok ? 'border-[#D1FAE5] bg-[#ECFDF5] text-[#065F46]' : 'border-[#FEE2E2] bg-[#FEF2F2] text-[#991B1B]'
                }`}
                role="status"
              >
                {testResult.ok ? <CircleCheck size={14} className="mt-0.5 shrink-0" /> : <CircleAlert size={14} className="mt-0.5 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{testResult.ok ? 'Test passed. ' : 'Test failed. '}</span>
                  {testResult.message}
                </span>
                <button onClick={() => setTest(null)} aria-label="Dismiss" className="cursor-pointer border-0 bg-transparent p-0 text-current">
                  <X size={13} />
                </button>
              </div>
            )}
            <H>Connection</H>
            <dl className="m-0">
              <Row k="Last sync" v={`${relTime(s.lastSyncAt)} · ${fmtDateTime(s.lastSyncAt)}`} />
              <Row k="Instance URL" v={<span className="font-mono text-[11px]">{s.instanceUrl}</span>} />
              <Row k="Environment" v={<span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ENV_TONE[s.environment] ?? ENV_TONE.Sandbox}`}>{s.environment}</span>} />
              <Row k="Auth type" v={s.authType} />
              <Row k="Connected by" v={s.connectedBy} />
              <Row k="Records (30 d)" v={<span className="font-mono">{fmtNum(s.records30d)} · {s.successRate}% clean</span>} />
              {s.credentialsRotatedAt && <Row k="Credentials" v={`Rotated ${relTime(s.credentialsRotatedAt)}`} />}
            </dl>
            <H>{file ? 'Files' : `Tables (${s.tables.length})`}</H>
            <div className="divide-y divide-[#F1F5F9]">
              {s.tables.map((t) => (
                <div key={t.name} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[11px] font-semibold text-[#141416]">{t.name}</span>
                    <span className="block truncate text-[11px] text-[#94A3B8]">{t.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[#475569]">{fmtNum(t.rows)} rows</span>
                </div>
              ))}
            </div>
          </div>
        ),
      },
      {
        key: 'sync',
        label: 'Sync & events',
        children: (
          <div>
            <dl className="m-0">
              <Row k="Schedule" v={<span className="font-mono">{s.syncMethod}</span>} />
              <Row k="Last sync" v={`${relTime(s.lastSyncAt)} · ${fmtDateTime(s.lastSyncAt)}`} />
              <Row k="Next run" v={nextRun(s, meta)} />
            </dl>
            {!file && (
              <>
                <Button onClick={doSync} loading={syncing} disabled={paused} icon={<RefreshCw size={14} />} className={`mt-2 ${BTN}`}>
                  Run sync now
                </Button>
                {paused && <p className="m-0 mt-1.5 text-[11px] text-[#94A3B8]">Resume the source to run a sync.</p>}
              </>
            )}
            <H>Sync runs</H>
            <RunList runs={s.syncHistory.slice(0, 6)} />
            <SourceEvents source={s} />
          </div>
        ),
      },
      {
        key: 'conflicts',
        label: `Conflicts${openConflicts ? ` (${openConflicts})` : ''}`,
        children: <SourceConflicts source={s} />,
      },
      {
        key: 'mappings',
        label: `Mappings (${s.fieldMappings.length})`,
        children: (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-xs text-[#64748B]">How {s.name} fields land in the canonical model.</p>
              <Link href={`/integration/model?tab=mappings&source=${encodeURIComponent(s.name)}`} className={LINK}>
                Edit in Data model
              </Link>
            </div>
            {!s.fieldMappings.length ? (
              <p className="m-0 text-xs text-[#94A3B8]">No mapping rules yet.</p>
            ) : (
              <div className="divide-y divide-[#F1F5F9]">
                {s.fieldMappings.map((m) => (
                  <div key={`${m.sourceField}-${m.canonicalField}`} className="py-1.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-[#141416]">{m.sourceField}</span>
                      <ArrowRight size={12} className="shrink-0 text-[#94A3B8]" />
                      <span className="min-w-0 truncate font-mono text-[11px] text-[#141416]">{m.canonicalField}</span>
                      <span className={`ml-auto shrink-0 rounded-full px-1.5 py-px font-mono text-[10px] font-bold ${confidenceTone(m.confidence)}`}>
                        {Math.round(m.confidence * 100)}%
                      </span>
                    </div>
                    <div className="text-[11px] text-[#94A3B8]">{modelName(m.canonicalModel)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ),
      },
      { key: 'settings', label: 'Settings', children: <SettingsForm key={`${s.id}-${s.syncMethod}-${s.environment}`} source={s} meta={meta} /> },
    ];

    return (
      <>
        <Tabs size="small" tabBarGutter={16} activeKey={panel} onChange={(k) => onPanelChange(k as SourcePanel)} items={tabs} className="[&_.ant-tabs-tab]:!text-xs" />
        <DiagnoseModal
          source={s}
          open={diagOpen}
          onClose={() => setDiagOpen(false)}
          onShow={(p) => {
            setDiagOpen(false);
            onPanelChange(p);
          }}
        />
      </>
    );
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      message.success(ok);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const onMenu = ({ key }: { key: string }) => {
    if (!s) return;
    const paused = s.status === 'paused';
    if (key === 'sync') act(() => sourceService.syncNow(s.id), `${s.name}: sync complete`);
    else if (key === 'reconnect') act(() => sourceService.reconnect(s.id), `${s.name} reconnected`);
    else if (key === 'rotate')
      Modal.confirm({
        title: `Rotate credentials for ${s.name}?`,
        content: `New ${s.authType} credentials are issued and the old ones are revoked immediately. Scheduled syncs keep running.`,
        okText: 'Rotate credentials',
        onOk: () => act(() => sourceService.rotateCredentials(s.id), `${s.name}: credentials rotated`),
      });
    else if (key === 'pause') act(() => sourceService.setPaused(s.id, !paused), paused ? `${s.name} resumed` : `${s.name} paused`);
    else if (key === 'delete') {
      setDeleteText('');
      setDeleteOpen(true);
    }
  };

  const confirmDelete = async () => {
    if (!s) return;
    setDeleting(true);
    try {
      await sourceService.remove(s.id);
      message.success(`${s.name} removed`);
      setDeleteOpen(false);
      onDeleted();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const file = s ? isFileSource(s) : false;

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        size="min(600px, 100vw)"
        destroyOnHidden
        title={
          s ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <SystemMark name={s.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-extrabold leading-tight text-[#141416]">{s.name}</span>
                  <SourceStatusPill status={s.status} />
                </div>
                <p className="m-0 mt-0.5 truncate text-[11px] font-normal text-[#64748B]">
                  {[...new Set([s.category, s.connectorType, s.vendor])].join(' · ')}
                </p>
              </div>
            </div>
          ) : (
            <span className="text-sm font-extrabold">Source</span>
          )
        }
        extra={
          s ? (
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                onClick: onMenu,
                items: [
                  ...(file
                    ? []
                    : [
                        { key: 'sync', label: 'Sync now', icon: <RefreshCw size={14} />, disabled: s.status === 'paused' },
                        { key: 'reconnect', label: 'Reconnect', icon: <PlugZap size={14} /> },
                        { key: 'rotate', label: 'Rotate credentials', icon: <KeyRound size={14} /> },
                      ]),
                  { key: 'pause', label: s.status === 'paused' ? 'Resume' : 'Pause', icon: s.status === 'paused' ? <Play size={14} /> : <Pause size={14} /> },
                  { type: 'divider' as const },
                  { key: 'delete', label: 'Delete source', icon: <Trash2 size={14} />, danger: true },
                ],
              }}
            >
              <Button aria-label="More source actions" icon={<MoreHorizontal size={16} />} className="!rounded-xl" />
            </Dropdown>
          ) : null
        }
      >
        {open && body()}
      </Drawer>

      {s && (
        <Modal
          open={deleteOpen}
          onCancel={() => setDeleteOpen(false)}
          title={<span className="text-sm font-extrabold">Delete {s.name}?</span>}
          okText="Delete source"
          okButtonProps={{ danger: true, disabled: deleteText.trim() !== s.name, loading: deleting }}
          onOk={confirmDelete}
        >
          <p className="text-xs text-[#475569]">
            This removes the connection, its {s.tables.length} tables and {s.fieldMappings.length} mapping rules (as a draft change in the Data model). Canonical records already ingested are kept. Type{' '}
            <span className="font-mono font-bold text-[#141416]">{s.name}</span> to confirm.
          </p>
          <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder={s.name} aria-label="Type the source name to confirm" />
        </Modal>
      )}
    </>
  );
}
