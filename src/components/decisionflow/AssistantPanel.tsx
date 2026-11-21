'use client';

import React, { useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { CircleAlert, CircleCheck, Send, ShieldX, Sparkles, TriangleAlert } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import {
  ASSISTANT_EXAMPLES,
  approveProposal,
  dismissProposal,
  parseRequest,
  sendToAssistant,
  usdSigned,
} from '@/services/decisionFlowService';
import type { ChatMessage, FlowState, Proposal } from '@/services/decisionFlowService';

const PRIMARY = 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FFD600] hover:bg-[#FACC15] text-[#141416] rounded-xl text-xs font-extrabold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
const SECONDARY = 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-xl text-xs font-semibold text-[#141416] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

function ProposalCard({ p, editable }: { p: Proposal; editable: boolean }) {
  const open = p.status === 'open';
  return (
    <div className={`mt-2 rounded-xl border ${open ? 'border-dashed border-[#0284C7]' : 'border-[#E2E8F0]'} bg-white p-3 space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-bold text-[#141416] min-w-0">{p.summary}</div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] shrink-0">{p.kind === 'rule' ? 'Business rule' : 'Process step'}</span>
      </div>
      <ul className="space-y-1">
        {p.checks.map((c) => (
          <li key={c.label} className="flex items-start gap-1.5 text-[11px]">
            {c.ok ? <CircleCheck size={13} className="text-[#059669] shrink-0 mt-px" aria-label="Passes" /> : <TriangleAlert size={13} className="text-[#D97706] shrink-0 mt-px" aria-label="Warning" />}
            <span className="min-w-0">
              <b className="text-[#141416]">{c.label}.</b> <span className="text-[#64748B]">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="text-[11px] p-2 rounded-lg bg-[#F8FAFC] text-[#475569]">
        <b className="text-[#141416]">Impact:</b> {p.impact.note}
        {p.kind === 'rule' && <> Net {usdSigned(p.impact.netDelta)} on the open queue.</>}
      </div>
      {open ? (
        <div className="flex flex-wrap gap-2">
          <button
            className={PRIMARY}
            disabled={!editable}
            title={editable ? '' : 'The draft is submitted; reject it to make changes'}
            onClick={() => {
              const r = approveProposal(p.id);
              if (r.ok) message.success({ content: 'Applied to the draft', key: 'df-ai' });
              else message.warning({ content: r.reason, key: 'df-ai' });
            }}
          >
            Approve
          </button>
          <button className={SECONDARY} onClick={() => dismissProposal(p.id)}>
            Dismiss
          </button>
        </div>
      ) : (
        <div className="text-[11px] font-semibold text-[#64748B]">{p.status === 'approved' ? 'Applied to the draft' : 'Dismissed'}</div>
      )}
    </div>
  );
}

function Bubble({ m, proposal, editable }: { m: ChatMessage; proposal?: Proposal; editable: boolean }) {
  if (m.from === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#141416] text-white text-xs px-3 py-2">{m.text}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${m.guardrailId ? 'bg-[#FEE2E2]' : 'bg-[#FFFBEB]'}`}>
        {m.guardrailId ? <ShieldX size={13} className="text-[#DC2626]" /> : <Sparkles size={13} className="text-amber-500" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-xs rounded-2xl rounded-tl-md px-3 py-2 ${m.guardrailId ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#F8FAFC] text-[#141416]'}`}>{m.text}</div>
        {proposal && <ProposalCard p={proposal} editable={editable} />}
      </div>
    </div>
  );
}

/** Rule-based assistant: plain language → proposal (checks, impact, dashed node) or refusal. */
export function AssistantPanel({ flow }: { flow: FlowState }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();
  const editable = flow.stage === 'editing';
  const preview = text.trim() ? parseRequest(text) : null;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [flow.chat.length]);

  const send = (value = text) => {
    if (!value.trim()) return;
    const r = sendToAssistant(value.trim());
    setText('');
    if (r.kind === 'rule' || r.kind === 'step') {
      setTimeout(() => {
        const node = rf.getNodes().find((n) => (n.data as { proposed?: boolean }).proposed);
        if (node) void rf.fitView({ nodes: [{ id: node.id }], padding: 1.4, maxZoom: 0.9, duration: 300 });
      }, 60);
    }
  };

  const tone = !preview
    ? 'text-[#94A3B8]'
    : preview.kind === 'refused'
      ? 'text-[#B91C1C]'
      : preview.kind === 'unknown'
        ? 'text-[#D97706]'
        : 'text-[#047857]';
  const Icon = !preview ? null : preview.kind === 'refused' ? ShieldX : preview.kind === 'unknown' ? CircleAlert : CircleCheck;

  return (
    <section className="bg-white border border-[#E2E8F0] rounded-2xl shadow-2xs p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-xl bg-[#FFFBEB] border border-[#FEF3C7] flex items-center justify-center shrink-0">
          <Sparkles size={16} className="text-amber-500" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-[#141416]">Assistant</h3>
          <p className="text-xs text-[#64748B]">Describe a rule or a step in plain words. It proposes the change with checks and impact; guardrails stay off limits.</p>
        </div>
      </div>

      <div ref={listRef} className="space-y-3 max-h-[440px] min-h-[120px] overflow-y-auto pr-1" aria-live="polite">
        {!flow.chat.length && <div className="text-xs text-[#94A3B8] py-6 text-center">No messages yet. Try one of the examples below.</div>}
        {flow.chat.map((m) => (
          <Bubble key={m.id} m={m} proposal={m.proposalId ? flow.proposals.find((p) => p.id === m.proposalId) : undefined} editable={editable} />
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ASSISTANT_EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => setText(ex)} className="px-2.5 py-1 rounded-full bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[11px] font-semibold text-[#475569] cursor-pointer text-left">
            {ex}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="space-y-1.5"
      >
        <div className="flex gap-2">
          <label htmlFor="df-assistant-input" className="sr-only">
            Request
          </label>
          <input
            id="df-assistant-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='e.g. "Field returns grade C: never re-lease"'
            className="flex-1 min-w-0 px-3 py-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs focus:border-[#FFD600] focus:outline-none"
            autoComplete="off"
          />
          <button type="submit" className={PRIMARY} disabled={!text.trim()} aria-label="Send">
            <Send size={14} />
          </button>
        </div>
        <div className={`flex items-start gap-1.5 text-[11px] min-h-4 ${tone}`} aria-live="polite">
          {Icon && <Icon size={12} className="shrink-0 mt-px" />}
          <span className="min-w-0">{preview ? `Reads as: ${preview.readBack}` : 'Live read-back appears while you type.'}</span>
        </div>
      </form>
    </section>
  );
}
