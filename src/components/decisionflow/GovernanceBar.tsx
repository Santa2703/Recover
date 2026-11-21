'use client';

import React, { useState } from 'react';
import { Dropdown, Modal, Select, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import { CheckCircle2, Eye, MoreHorizontal, Rocket, Send, ShieldAlert, Undo2, XCircle } from 'lucide-react';
import { StatusBadge } from '@/components/ui';
import type { Tone } from '@/theme/tokens';
import { getPublishedRules, fmtDay } from '@/services/decisionService';
import {
  ACTORS,
  MAKER_CHECKER,
  actorOf,
  approve,
  draftRules,
  isMaker,
  liveChecks,
  publish,
  reject,
  rollback,
  setActor,
  stageLabel,
  startShadow,
  submit,
  usdSigned,
} from '@/services/decisionFlowService';
import type { EditResult, FlowState } from '@/services/decisionFlowService';

const PRIMARY = 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FFD600] hover:bg-[#FACC15] text-[#141416] rounded-xl text-xs font-extrabold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
const SECONDARY = 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-xl text-xs font-semibold text-[#141416] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

function done(r: EditResult, ok: string) {
  if (r.ok) message.success({ content: ok, key: 'df-gov' });
  else message.error({ content: r.reason, key: 'df-gov' });
}

export function GovernanceBar({ flow }: { flow: FlowState }) {
  const [busy, setBusy] = useState<null | 'publish' | 'rollback'>(null);
  const pub = getPublishedRules();
  const stage = flow.stage;
  const maker = isMaker(flow);
  const errors = liveChecks(flow).filter((c) => c.level === 'error').length;
  const tone: Tone = stage === 'review' ? 'warning' : stage === 'approved' || stage === 'shadow' ? 'info' : flow.dirty ? 'brand' : 'success';

  const doPublish = () => {
    const { rules } = draftRules(flow);
    Modal.confirm({
      title: `Publish rules v${pub.version + 1}?`,
      content: `${rules.filter((r) => r.active !== false).length} active rules go live. Every open case is re-planned and the Case pages, Dashboard and Analytics show the new routes.`,
      okText: 'Publish',
      onOk: async () => {
        setBusy('publish');
        const r = await publish();
        setBusy(null);
        done(r, `Rules v${pub.version + 1} published; case decisions updated`);
      },
    });
  };

  const doRollback = () => {
    Modal.confirm({
      title: 'Roll back to the previous version?',
      content: `The rules published before v${pub.version} are restored as v${pub.version + 1}. The current draft is replaced by them.`,
      okText: 'Roll back',
      onOk: async () => {
        setBusy('rollback');
        const r = await rollback();
        setBusy(null);
        done(r, 'Rolled back; case decisions updated');
      },
    });
  };

  const approveBtn = (
    <button className={PRIMARY} disabled={maker} onClick={() => done(approve(), 'Draft approved')}>
      <CheckCircle2 size={14} /> Approve
    </button>
  );

  const moreItems: NonNullable<MenuProps['items']> = [
    ...(stage !== 'editing' ? [{ key: 'reject', label: 'Reject: send back for changes', icon: <XCircle size={14} /> }] : []),
    ...(stage === 'editing' && flow.rollbackDepth
      ? [{ key: 'rollback', label: busy === 'rollback' ? 'Rolling back…' : 'Roll back to previous version', icon: <Undo2 size={14} />, disabled: busy !== null }]
      : []),
  ];

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-2xs p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <StatusBadge tone={tone}>{stageLabel(flow)}</StatusBadge>
          <span className="text-xs text-[#64748B] min-w-0">
            Live: rules v{pub.version}, published {fmtDay(pub.publishedAt.slice(0, 10))} by {pub.publishedBy}
            {flow.makers.length ? ` · draft changes by ${flow.makers.join(', ')}` : ''}
            {flow.approvedBy ? ` · approved by ${flow.approvedBy}` : ''}
          </span>
        </div>
        <label className="flex items-center gap-2 text-xs text-[#64748B]">
          Acting as
          <Select
            size="small"
            value={flow.actorId}
            onChange={(v) => {
              setActor(v);
              message.info({ content: `Acting as ${ACTORS.find((a) => a.id === v)?.name}`, key: 'df-actor' });
            }}
            options={ACTORS.map((a) => ({ value: a.id, label: `${a.name} · ${a.role}` }))}
            style={{ width: 230, maxWidth: '60vw' }}
            aria-label="Acting as"
          />
        </label>
      </div>

      {/* Only the next lifecycle step is a button; the other valid actions sit in the ⋯ menu. */}
      <div className="flex flex-wrap items-center gap-2">
        {stage === 'editing' && (
          <Tooltip title={errors ? `${errors} live check${errors > 1 ? 's' : ''} failing` : !flow.dirty ? 'No changes to submit. Edit the draft first.' : ''}>
            <button className={PRIMARY} disabled={!flow.dirty} onClick={() => done(submit(), 'Submitted for approval')}>
              <Send size={14} /> Submit for approval
            </button>
          </Tooltip>
        )}
        {stage === 'review' && (maker ? <Tooltip title={MAKER_CHECKER}>{approveBtn}</Tooltip> : approveBtn)}
        {stage === 'approved' && (
          <button className={PRIMARY} onClick={() => done(startShadow(), 'Shadow run started')}>
            <Eye size={14} /> Start shadow run
          </button>
        )}
        {stage === 'shadow' && (
          <button className={PRIMARY} disabled={busy !== null} onClick={doPublish}>
            <Rocket size={14} /> {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
        )}
        {moreItems.length > 0 && (
          <Dropdown
            trigger={['click']}
            menu={{
              items: moreItems,
              onClick: ({ key }) => {
                if (key === 'reject') done(reject(`Rejected by ${actorOf(flow).name}`), 'Draft sent back for changes');
                if (key === 'rollback') doRollback();
              },
            }}
          >
            <button className={SECONDARY} aria-label="More lifecycle actions">
              <MoreHorizontal size={14} />
            </button>
          </Dropdown>
        )}
        <span className="text-[11px] text-[#94A3B8]">
          Next: {stage === 'editing' ? 'submit the draft for approval' : stage === 'review' ? 'a checker approves' : stage === 'approved' ? 'shadow-run the draft' : 'publish to every open case'}
        </span>
      </div>

      {stage === 'review' && maker && (
        <div role="status" className="flex items-start gap-2 p-2.5 rounded-xl bg-[#FEE2E2] text-[#B91C1C] text-xs">
          <ShieldAlert size={14} className="shrink-0 mt-px" />
          <span>
            <b>{MAKER_CHECKER}.</b> Switch &ldquo;Acting as&rdquo; to someone who did not edit this draft.
          </span>
        </div>
      )}
      {stage === 'shadow' && flow.shadow && (
        <div role="status" className="p-2.5 rounded-xl bg-[#E0F2FE] text-[#0369A1] text-xs">
          Shadow run since {flow.shadow.at.slice(11, 16)} UTC: draft v{pub.version + 1} runs next to v{pub.version} without changing any case.{' '}
          {flow.shadow.changes} decision{flow.shadow.changes === 1 ? '' : 's'} would change, net {usdSigned(flow.shadow.netDelta)}.
        </div>
      )}
    </div>
  );
}
