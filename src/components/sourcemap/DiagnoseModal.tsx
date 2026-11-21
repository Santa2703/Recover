'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, message } from 'antd';
import { CircleCheck, CircleAlert, GitCompareArrows, Radio, TriangleAlert, Wrench, Stethoscope } from 'lucide-react';
import { sourceService, type Diagnosis, type FixAction, type Source } from '@/services/sourceService';
import { Skeleton } from '@/components/ui';

const CHECK_ICON = {
  pass: <CircleCheck size={16} className="text-[#059669]" />,
  warn: <TriangleAlert size={16} className="text-[#D97706]" />,
  fail: <CircleAlert size={16} className="text-[#DC2626]" />,
};
const CHECK_LABEL = { pass: 'Pass', warn: 'Warning', fail: 'Fail' };

async function runFix(action: FixAction, id: string) {
  switch (action) {
    case 'rotate':
      await sourceService.rotateCredentials(id);
      return sourceService.syncNow(id).then(() => 'Credentials rotated and a sync completed');
    case 'reconnect':
      await sourceService.reconnect(id);
      return 'Reconnected';
    case 'accept_schema':
      await sourceService.acceptSchema(id);
      return 'New schema accepted; mappings re-validated';
    case 'sync':
      await sourceService.syncNow(id);
      return 'Sync completed';
    case 'resume':
      await sourceService.setPaused(id, false);
      return 'Source resumed';
    default:
      return '';
  }
}

const RELATED = 'inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs font-semibold text-[#0284C7] hover:underline';

interface Props {
  source: Source;
  open: boolean;
  onClose: () => void;
  /** Switch the source drawer to a related tab. */
  onShow?: (panel: 'conflicts' | 'sync') => void;
}

export function DiagnoseModal({ source, open, onClose, onShow }: Props) {
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      setResult(await sourceService.diagnose(source.id));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [source.id]);

  useEffect(() => {
    // Starts the async diagnosis when the modal opens; run() sets its own loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void run();
  }, [open, run]);

  const applyFix = async () => {
    if (!result?.fix?.action) return;
    setFixing(true);
    try {
      const msg = await runFix(result.fix.action, source.id);
      message.success(`${source.name}: ${msg}`);
      await run();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setFixing(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <span className="flex items-center gap-2 text-sm font-extrabold">
          <Stethoscope size={16} className="text-amber-500" /> Diagnose {source.name}
        </span>
      }
      footer={[
        <Button key="rerun" onClick={run} loading={running}>
          Run again
        </Button>,
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
      ]}
      width={560}
    >
      <div className="space-y-2 pt-1">
        {(['auth', 'reachability', 'schema', 'freshness'] as const).map((key, i) => {
          const c = result?.checks.find((x) => x.key === key);
          const label = ['Authentication', 'Reachability', 'Schema drift', 'Freshness'][i];
          return (
            <div key={key} className="flex items-start gap-3 rounded-xl border border-[#E2E8F0] px-3 py-2.5">
              <div className="mt-0.5">{c ? CHECK_ICON[c.status] : <Skeleton className="h-4 w-4 rounded-full" />}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#141416]">{label}</span>
                  {c && <span className="text-[11px] font-semibold text-[#64748B]">{CHECK_LABEL[c.status]}</span>}
                </div>
                {c ? <p className="m-0 mt-0.5 text-xs text-[#64748B]">{c.detail}</p> : <Skeleton className="mt-1.5 h-3 w-3/4" />}
              </div>
            </div>
          );
        })}
        {result && (
          <div className={`rounded-xl border px-3 py-2.5 ${result.fix ? 'border-[#FEF3C7] bg-[#FFFBEB]' : 'border-[#D1FAE5] bg-[#ECFDF5]'}`}>
            <div className="text-xs font-bold text-[#141416]">{result.summary}</div>
            {result.fix && (
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="m-0 flex items-start gap-1.5 text-xs text-[#475569]">
                  <Wrench size={13} className="mt-0.5 shrink-0 text-amber-500" />
                  <span>
                    <span className="font-semibold">Suggested fix: </span>
                    {result.fix.text}
                  </span>
                </p>
                {result.fix.action && (
                  <Button size="small" onClick={applyFix} loading={fixing} className="shrink-0 !rounded-xl !text-xs !font-semibold">
                    {result.fix.actionLabel}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {result && onShow && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1 text-xs">
            <span className="text-[#64748B]">Related to {source.name}:</span>
            <button type="button" onClick={() => onShow('conflicts')} className={RELATED}>
              <GitCompareArrows size={13} /> Conflicts
            </button>
            <button type="button" onClick={() => onShow('sync')} className={RELATED}>
              <Radio size={13} /> Sync &amp; events
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
