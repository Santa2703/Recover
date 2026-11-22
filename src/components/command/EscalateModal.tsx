'use client';

import React, { useState } from 'react';
import { Modal, Select, message } from 'antd';
import { Megaphone, TriangleAlert } from 'lucide-react';
import { useAuth, SESSION_USER } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import type { UserRole } from '@/models/user.model';
import { alertService, canEscalate, type InboxAlert } from '@/services/alertService';

/** Roles that can receive an escalation (Executives get no tasks). */
const RECIPIENT_ROLES: UserRole[] = ['Planner', 'Approver', 'Engineer', 'Finance', 'Developer', 'Warehouse Manager', 'Admin'];

const fmtUtc = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

const BTN_SECONDARY =
  'inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-xl border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50';
const FIELD =
  'block w-full resize-y rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs text-[#141416] placeholder-[#94A3B8] focus:border-[#FFD600] focus:bg-white focus:outline-none';
const LABEL = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#64748B]';

interface ModalProps {
  /** The alert to escalate; null keeps the modal closed. */
  alert: InboxAlert | null;
  onClose: () => void;
  /** Called after the escalation was sent (task id and recipient label). */
  onSent?: (result: { taskId: string; to: string }) => void;
}

/**
 * Escalate an alert to the owner of the blocked step. Pre-fills a drafted message (what is blocked,
 * since when, impact, what is needed) and the owner as recipient; the user can edit both and add a
 * note. Sending creates a My work › Tasks item for the recipient role, writes an audit entry and marks
 * the alert "Escalated to <owner>" (it stays open). A second escalation asks first.
 */
export function EscalateModal({ alert, onClose, onSent }: ModalProps) {
  return (
    <Modal
      open={!!alert}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={560}
      title={
        <span className="flex items-center gap-2 text-sm font-bold">
          <Megaphone size={16} className="text-amber-500" /> Escalate
        </span>
      }
    >
      {alert && <EscalateForm key={`${alert.id}-${alert.escalationCount}`} alert={alert} onClose={onClose} onSent={onSent} />}
    </Modal>
  );
}

function EscalateForm({ alert, onClose, onSent }: { alert: InboxAlert; onClose: () => void; onSent?: ModalProps['onSent'] }) {
  const { currentRole, user } = useAuth();
  const [toRole, setToRole] = useState<UserRole>(alert.ownerRole);
  const [text, setText] = useState(() => alertService.escalationMessage(alert));
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const again = !!alert.escalatedAt;
  const toLabel = toRole === alert.ownerRole ? alertService.ownerLabel(alert) : alertService.roleLabel(toRole, alert.tenant);

  const send = async () => {
    setSending(true);
    try {
      const res = await alertService.escalate(alert, {
        message: text,
        note,
        toRole,
        by: { id: user.id, name: SESSION_USER.name, role: currentRole },
        again,
      });
      message.success(`Escalated to ${res.to}. Task ${res.taskId} is in their My work.`);
      onSent?.(res);
      onClose();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3 pt-2 text-xs">
      <p className="m-0 font-semibold text-[#141416]">{alert.title}</p>
      {again && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-[#FEF3C7] bg-[#FFFBEB] px-3 py-2 text-[#854D0E]">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            Already escalated to <span className="font-bold">{alert.escalatedTo}</span> at <span className="font-mono">{fmtUtc(alert.escalatedAt!)}</span>
            {alert.escalatedBy ? ` by ${alert.escalatedBy}` : ''}. Escalate again? Sending creates another task.
          </span>
        </div>
      )}
      <div>
        <label htmlFor="esc-to" className={LABEL}>
          To
        </label>
        <Select<UserRole>
          id="esc-to"
          className="w-full"
          value={toRole}
          onChange={setToRole}
          options={RECIPIENT_ROLES.map((r) => ({
            value: r,
            label: r === alert.ownerRole ? `${alertService.ownerLabel(alert)} · owner of the blocked step` : alertService.roleLabel(r, alert.tenant),
          }))}
        />
        <p className="m-0 mt-1 text-[11px] text-[#64748B]">The task goes to My work › Tasks for the {toRole} role.</p>
      </div>
      <div>
        <label htmlFor="esc-msg" className={LABEL}>
          Message
        </label>
        <textarea id="esc-msg" rows={6} className={FIELD} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div>
        <label htmlFor="esc-note" className={LABEL}>
          Note (optional)
        </label>
        <textarea id="esc-note" rows={2} className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the owner should know" />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={sending}>
          Cancel
        </button>
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#FFD600] px-3.5 py-1.5 text-xs font-extrabold text-[#141416] hover:bg-[#FACC15] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Megaphone size={13} />
          {sending ? 'Sending…' : again ? `Escalate again to ${toLabel}` : `Send to ${toLabel}`}
        </button>
      </div>
    </div>
  );
}

interface ButtonProps {
  /** Escalate this alert. */
  alert?: InboxAlert;
  /** Or: escalate the open escalatable alerts about this case (hidden when there are none). */
  caseId?: string;
  /** "Escalate" by default. */
  label?: string;
  className?: string;
  onSent?: ModalProps['onSent'];
}

/**
 * Drop-in Escalate button + modal. Pass `alert` (Alerts page) or `caseId` (Case page): with a case
 * it finds the case's open hand-off / approval / conflict alerts and escalates the most urgent one;
 * it renders nothing when the case has nothing to escalate.
 */
export function EscalateButton({ alert, caseId, label = 'Escalate', className, onSent }: ButtonProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useServiceQuery(() => (alert || !caseId ? Promise.resolve([]) : alertService.escalatableForCase(caseId)), [caseId, !!alert], {
    subscribe: alertService.subscribe,
  });
  const candidates = alert ? (canEscalate(alert) ? [alert] : []) : (q.data ?? []);
  const target = candidates[0];
  const current = candidates.find((a) => a.id === openId) ?? null;
  if (!target) return null;
  return (
    <>
      <button
        type="button"
        className={className ?? BTN_SECONDARY}
        onClick={() => setOpenId(target.id)}
        aria-label={`${label}: ${target.title}`}
        data-tip={target.escalatedAt ? `Escalated to ${target.escalatedTo}` : undefined}
      >
        <Megaphone size={13} /> {label}
        {target.escalatedAt ? <span className="font-normal text-[#64748B]">(sent)</span> : null}
      </button>
      <EscalateModal alert={current} onClose={() => setOpenId(null)} onSent={onSent} />
    </>
  );
}
