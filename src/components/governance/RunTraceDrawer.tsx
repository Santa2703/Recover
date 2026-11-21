'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Drawer } from 'antd';
import { Pause, Play, FastForward, RotateCcw, Activity, ListTree } from 'lucide-react';
import type { CaseRun, RunSpan, StageRunStatus, SpanKind } from '@/services/governanceService';
import { DataTable, CaseLink, StageBadge, Skeleton, ErrorState, ProgressBar, type DataColumn } from '@/components/ui';
import { Pill, RUN_STATUS, btnPrimary, btnSecondary, fmtTime, type PillTone } from './shared';

const KIND_TONE: Record<SpanKind, PillTone> = { agent: 'yellow', tool: 'blue', model: 'slate', audit: 'green', human: 'dark' };
const SPAN_STATUS: Record<RunSpan['status'], { label: string; tone: PillTone }> = {
  ok: { label: 'OK', tone: 'green' },
  running: { label: 'Running', tone: 'blue' },
  waiting: { label: 'Waiting', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
};
const STEP_MS = 900;
const duration = (r: RunSpan) => (r.kind === 'human' ? '—' : `${r.durationMs} ms`);

/**
 * The run trace for one case: replay / pause / skip to now, the 10 steps as the replay reaches them,
 * every span newest first, and a nested drawer with a span's parameters.
 */
export function RunTraceDrawer({
  open,
  onClose,
  run,
  caseId,
  initialLoading,
  refreshing,
  error,
  onRetry,
}: {
  open: boolean;
  onClose: () => void;
  run: CaseRun | undefined;
  caseId: string;
  initialLoading: boolean;
  refreshing: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [span, setSpan] = useState<RunSpan | null>(null);
  const total = run?.spans.length ?? 0;

  // Playback state belongs to one run; switching case falls back to "now" (cursor null = live).
  const [play, setPlay] = useState<{ runId?: string; cursor: number | null; playing: boolean }>({ cursor: null, playing: false });
  const own = play.runId !== undefined && play.runId === run?.runId;
  const cursor = own ? play.cursor : null;
  const playing = open && own && play.playing;

  // Playback timer, cleared on pause, close, case change and unmount.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setPlay((p) => {
        const next = (p.cursor ?? 0) + 1;
        return next >= total ? { ...p, cursor: null, playing: false } : { ...p, cursor: next };
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [playing, total]);

  const shown = cursor === null ? total : Math.min(cursor, total);
  const isLive = cursor === null;
  const visible = useMemo(() => (run ? run.spans.slice(0, shown) : []), [run, shown]);
  const latest = visible[visible.length - 1];
  const rows = useMemo(() => [...visible].reverse(), [visible]);

  const stageStatus = (step: number, finalStatus: StageRunStatus): StageRunStatus => {
    if (!run) return 'queued';
    if (isLive) return finalStatus;
    const all = run.spans.filter((s) => s.step === step).length;
    const vis = visible.filter((s) => s.step === step).length;
    if (all === 0 || vis === 0) return 'queued';
    if (vis < all) return 'running';
    return finalStatus;
  };

  const replay = () => setPlay({ runId: run?.runId, cursor: 0, playing: true });
  const skipToNow = () => setPlay({ runId: run?.runId, cursor: null, playing: false });
  /** One control: Replay from the start when live, otherwise pause / play from where it stopped. */
  const playPause = () => {
    if (isLive) replay();
    else setPlay((p) => ({ ...p, playing: !p.playing }));
  };

  const columns: DataColumn<RunSpan>[] = [
    {
      title: 'Span · Call',
      key: 'call',
      priority: 1,
      render: (_: unknown, r: RunSpan) => (
        <div className="min-w-0">
          <div className="font-mono text-[11px] font-bold text-[#141416] truncate">{r.name}</div>
          <div className="font-mono text-[10px] text-[#94A3B8] truncate">
            {r.id} · {r.performer}
          </div>
        </div>
      ),
    },
    {
      title: 'Step / Kind',
      key: 'kind',
      priority: 2,
      width: 110,
      render: (_: unknown, r: RunSpan) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-[#64748B]">{r.step}</span>
          <Pill tone={KIND_TONE[r.kind]} dot={false}>
            {r.kind}
          </Pill>
        </span>
      ),
    },
    {
      title: 'Time / Duration',
      dataIndex: 'at',
      key: 'at',
      priority: 2,
      width: 130,
      render: (v: string, r: RunSpan) => (
        <div className="font-mono text-[11px] text-[#64748B]">
          <div className="truncate">{fmtTime(v)}</div>
          <div className="text-[10px] text-[#94A3B8]">{duration(r)}</div>
        </div>
      ),
    },
    { title: 'Status', dataIndex: 'status', key: 'status', priority: 1, width: 96, render: (v: RunSpan['status']) => <Pill tone={SPAN_STATUS[v].tone}>{SPAN_STATUS[v].label}</Pill> },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={760}
      rootClassName="[&_.ant-drawer-content-wrapper]:max-w-[100vw]"
      title={
        <div className="flex items-center gap-2 min-w-0">
          <ListTree className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="font-bold text-sm truncate">Run trace · {caseId}</span>
        </div>
      }
    >
      <div className="space-y-5 text-xs">
        {/* Playback bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            {initialLoading || !run ? (
              <Skeleton className="h-4 w-64 max-w-full" />
            ) : (
              <>
                <CaseLink id={run.caseRecord.id} label={run.caseRecord.productName} />
                <StageBadge stage={run.caseRecord.stage} />
                <span className="font-mono text-[11px] text-[#94A3B8]">{run.runId}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#64748B] mr-1">
              <Activity className={`w-3.5 h-3.5 ${playing ? 'text-[#0284C7] animate-pulse' : 'text-[#94A3B8]'}`} />
              {isLive ? 'Live · now' : playing ? `Replaying ${shown} / ${total}` : `Paused at ${shown} / ${total}`}
            </span>
            <button onClick={skipToNow} disabled={isLive || !run} className={btnSecondary}>
              <FastForward className="w-3.5 h-3.5" />
              <span>Skip to now</span>
            </button>
            <button onClick={playPause} disabled={!run || total === 0} className={btnPrimary}>
              {isLive ? <RotateCcw className="w-3.5 h-3.5" /> : playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isLive ? 'Replay' : playing ? 'Pause' : 'Play'}</span>
            </button>
          </div>
          {!isLive && (
            <div className="w-full">
              <ProgressBar value={shown} max={total || 1} tone="ink" label="Replay progress" />
            </div>
          )}
        </div>

        {/* Step strip: follows the replay */}
        {initialLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : error || !run ? (
          <ErrorState title={`Case ${caseId} has no run`} onRetry={onRetry} compact />
        ) : (
          <ol className={`m-0 p-0 list-none grid grid-cols-2 sm:grid-cols-5 gap-2 transition-opacity ${refreshing ? 'opacity-60' : ''}`} aria-label="Steps in this run">
            {run.stages.map((s) => {
              const st = stageStatus(s.step, s.finalStatus);
              const active = (latest?.step === s.step && !isLive) || (isLive && s.step === run.currentIndex + 1);
              return (
                <li key={s.step} className={`min-w-0 rounded-xl border p-2 ${active ? 'border-[#FFD600] bg-[#FFFDF5]' : 'border-[#E2E8F0] bg-white'}`}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        st === 'completed' ? 'bg-[#141416] text-white' : st === 'queued' ? 'bg-[#F1F5F9] text-[#64748B]' : 'bg-[#FFD600] text-[#141416]'
                      }`}
                    >
                      {s.step}
                    </span>
                    <span className="text-[11px] font-bold text-[#141416] truncate">{s.label}</span>
                  </div>
                  <div className="mt-1.5">
                    <Pill tone={RUN_STATUS[st].tone}>{RUN_STATUS[st].label}</Pill>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Trace */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Spans, newest first</div>
            <span className="px-2.5 py-0.5 rounded-full bg-[#FEF08A] text-[#854D0E] font-extrabold text-[11px]">{visible.length} spans</span>
          </div>
          <DataTable<RunSpan>
            rowKey="id"
            tableLayout="fixed"
            initialLoading={initialLoading}
            refreshing={refreshing}
            columns={columns}
            dataSource={rows}
            onRowClick={setSpan}
            pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
            emptyTitle="No spans yet"
            emptyDescription="Press Replay to watch the run from the start."
            rowClassName={(r) => (r.id === latest?.id && !isLive ? 'bg-[#FFFDF5]' : '')}
          />
        </div>
      </div>

      <Drawer
        open={!!span}
        onClose={() => setSpan(null)}
        size={460}
        rootClassName="[&_.ant-drawer-content-wrapper]:max-w-[100vw]"
        title={
          span && (
            <div className="flex items-center gap-2 min-w-0">
              <ListTree className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="font-mono font-bold text-sm truncate">{span.id}</span>
              <Pill tone={SPAN_STATUS[span.status].tone}>{SPAN_STATUS[span.status].label}</Pill>
            </div>
          )
        }
      >
        {span && (
          <div className="space-y-4 text-xs text-[#475569]">
            <div className="font-mono text-sm font-extrabold text-[#141416] break-all">{span.name}</div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 m-0">
              <dt className="text-[#94A3B8]">Step</dt>
              <dd className="m-0 font-semibold text-[#141416]">
                {span.step}. {run?.stages.find((s) => s.step === span.step)?.label}
              </dd>
              <dt className="text-[#94A3B8]">Kind</dt>
              <dd className="m-0">
                <Pill tone={KIND_TONE[span.kind]} dot={false}>
                  {span.kind}
                </Pill>
              </dd>
              <dt className="text-[#94A3B8]">Performer</dt>
              <dd className="m-0 font-semibold text-[#141416]">{span.performer}</dd>
              <dt className="text-[#94A3B8]">Time (UTC)</dt>
              <dd className="m-0 font-mono">{fmtTime(span.at)}</dd>
              <dt className="text-[#94A3B8]">Duration</dt>
              <dd className="m-0 font-mono">{duration(span)}</dd>
            </dl>
            <div>
              <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5">Parameters</div>
              <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl font-mono text-[11px] text-[#141416] break-all whitespace-pre-wrap">{span.params}</div>
            </div>
          </div>
        )}
      </Drawer>
    </Drawer>
  );
}
