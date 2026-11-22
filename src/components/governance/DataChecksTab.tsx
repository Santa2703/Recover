'use client';

import React, { useState } from 'react';
import { Popover, message } from 'antd';
import { CheckCircle2, XCircle, Clock, ListChecks, Play, Info } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { dataChecksService, type DataCheckResult } from '@/services/dataChecksService';
import { DataTable, MetricCard, ErrorState, type DataColumn } from '@/components/ui';
import { Card } from './Filters';
import { CardHeader, Pill, btnPrimary, btnRowSecondary, fmtDateTime, type PillTone } from './shared';

const OWNER_TONE: Record<DataCheckResult['owner'], PillTone> = { Platform: 'slate', Finance: 'blue', 'Decision Services': 'amber' };

/** Data checks: recomputes the reconciliations behind every page and shows pass / fail. */
export function DataChecksTab() {
  const q = useServiceQuery(() => dataChecksService.latest(), [], { subscribe: dataChecksService.subscribe });
  const [running, setRunning] = useState(false);
  const run = q.data;

  const rerun = async () => {
    setRunning(true);
    try {
      const r = await dataChecksService.rerun();
      if (r.failing) message.warning(`${r.failing} of ${r.results.length} checks failing`);
      else message.success(`All ${r.results.length} checks pass`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Data checks could not run');
    } finally {
      setRunning(false);
    }
  };

  const columns: DataColumn<DataCheckResult>[] = [
    {
      title: 'Check',
      key: 'name',
      priority: 1,
      render: (_: unknown, r: DataCheckResult) => <div className="font-semibold text-[#141416] line-clamp-2">{r.name}</div>,
    },
    {
      title: 'What is checked',
      key: 'measured',
      priority: 2,
      render: (_: unknown, r: DataCheckResult) => (
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-[#475569] line-clamp-2">{r.measured}</div>
          {!r.pass && r.failures.length > 0 && <div className="text-[10px] text-[#B91C1C] truncate">{r.failures.join(', ')}</div>}
        </div>
      ),
    },
    {
      title: 'Last result',
      key: 'pass',
      priority: 1,
      width: 110,
      render: (_: unknown, r: DataCheckResult) => <Pill tone={r.pass ? 'green' : 'red'}>{r.pass ? 'Pass' : 'Fail'}</Pill>,
    },
    { title: 'Owner', key: 'owner', priority: 3, width: 150, render: (_: unknown, r: DataCheckResult) => <Pill tone={OWNER_TONE[r.owner]} dot={false}>{r.owner}</Pill> },
    {
      title: '',
      key: 'explain',
      priority: 1,
      width: 96,
      align: 'right',
      ellipsis: false,
      render: (_: unknown, r: DataCheckResult) => (
        <Popover
          trigger="click"
          placement="left"
          title={<span className="text-xs font-extrabold">{r.name}</span>}
          content={
            <div className="max-w-[320px] text-xs text-[#475569] space-y-2">
              <p className="m-0">{r.explain}</p>
              <p className="m-0 font-mono text-[11px] text-[#141416]">{r.measured}</p>
              {!r.pass && r.failures.length > 0 && <p className="m-0 text-[#B91C1C]">Failing: {r.failures.join(', ')}</p>}
              <p className="m-0 text-[10px] text-[#94A3B8]">Owner: {r.owner}</p>
            </div>
          }
        >
          <button className={`${btnRowSecondary} inline-flex items-center gap-1`} aria-label={`Explain ${r.name}`}>
            <Info className="w-3 h-3" /> Explain
          </button>
        </Popover>
      ),
    },
  ];

  if (q.error) return <ErrorState onRetry={q.refetch} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard label="Checks passing" value={run?.passing ?? 0} unit={run ? `of ${run.results.length}` : undefined} icon={<CheckCircle2 />} iconTone="green" loading={q.initialLoading} />
        <MetricCard
          label="Checks failing"
          value={run?.failing ?? 0}
          context={run?.failing ? 'Real disagreements in the data; see the failing rows' : 'Every number reconciles'}
          icon={<XCircle />}
          iconTone={run?.failing ? 'red' : 'slate'}
          loading={q.initialLoading}
        />
        <MetricCard
          label="Last run"
          value={run ? fmtDateTime(run.ranAt).replace(' UTC', '') : '—'}
          context={run ? `UTC · took ${run.durationMs.toLocaleString('en-US')} ms` : undefined}
          icon={<Clock />}
          iconTone="slate"
          loading={q.initialLoading}
        />
      </div>
      <Card>
        <CardHeader
          icon={<ListChecks />}
          title="Checks"
          description="One data model feeds every page, so numbers must reconcile everywhere. Each check recomputes from the live data; run them again at any time."
          right={
            <button onClick={rerun} disabled={running || q.initialLoading} className={btnPrimary}>
              <Play className="w-3.5 h-3.5" />
              {running ? 'Running…' : 'Run data checks'}
            </button>
          }
        />
        <div className="pt-3">
          <DataTable<DataCheckResult>
            rowKey="id"
            tableLayout="fixed"
            initialLoading={q.initialLoading}
            refreshing={q.loading || running}
            columns={columns}
            dataSource={run ? [...run.results].sort((a, b) => Number(a.pass) - Number(b.pass)) : []}
            pagination={false}
            emptyTitle="No checks"
          />
        </div>
      </Card>
    </div>
  );
}
