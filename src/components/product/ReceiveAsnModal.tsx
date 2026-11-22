'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Modal, message } from 'antd';
import { CheckCircle2, CircleDashed, PackageCheck } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { intakeService, type ReceiptPreview } from '@/services/intakeService';
import { caseService } from '@/services/caseService';
import { STAGE_META } from '@/components/ui';
import { btnPrimary, btnSecondary } from '@/components/governance/shared';
import { money } from '@/utils/format';

/** Roles that can post a goods receipt (Warehouse Managers only at their own site). */
export const RECEIVE_ROLES = ['Warehouse Manager', 'Planner', 'Admin'] as const;

export function useCanReceive() {
  const { currentRole, currentSite } = useAuth();
  return (site: string) =>
    (RECEIVE_ROLES as readonly string[]).includes(currentRole) && (currentRole !== 'Warehouse Manager' || site === currentSite);
}

const fieldLabel = 'mb-1 block text-[11px] font-bold text-[#64748B]';
const range = (ids: string[]) => (ids.length > 1 ? `${ids[0]} – ${ids[ids.length - 1]}` : ids[0]);

/**
 * Confirm-and-receive for one shipping notice: records the goods receipt (date, bay, received by)
 * and shows exactly which cases will be created before anything is posted.
 */
export function ReceiveAsnModal({ asnId, onClose }: { asnId: string; onClose: () => void }) {
  // Read once when the modal opens; the ids shown are the ids that will be created.
  const [preview] = useState<ReceiptPreview | undefined>(() => intakeService.preview(asnId));
  if (!preview) return null;
  return <ReceiveForm preview={preview} onClose={onClose} />;
}

function ReceiveForm({ preview, onClose }: { preview: ReceiptPreview; onClose: () => void }) {
  const router = useRouter();
  const { user, currentRole } = useAuth();
  const { asn } = preview;
  const [date, setDate] = useState(() => caseService.meta().asOf.slice(0, 10));
  const [bay, setBay] = useState(preview.defaultBay);
  const [receivedBy, setReceivedBy] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const invalid = !date || !bay.trim() || !receivedBy.trim();
  const n = preview.caseIds.length;

  const submit = async () => {
    setTried(true);
    if (invalid) return;
    setBusy(true);
    try {
      const res = await intakeService.receive(asn.id, { date, bay, receivedBy }, { id: user.id, name: user.name, role: currentRole });
      const first = res.cases[0]?.id;
      const key = `received-${asn.id}`;
      // The toast renders outside the app tree, so it navigates with a callback rather than a <Link>.
      message.success({
        key,
        duration: 8,
        content: (
          <span>
            {asn.id} received · {res.cases.length} {res.cases.length === 1 ? 'case' : 'cases'} created ({range(res.cases.map((c) => c.id))}).{' '}
            {first && (
              <button
                type="button"
                onClick={() => {
                  message.destroy(key);
                  router.push(`/product/case/${first}`);
                }}
                className="cursor-pointer border-none bg-transparent p-0 font-bold text-[#141416] underline underline-offset-2"
              >
                Open case
              </button>
            )}
          </span>
        ),
      });
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not post the goods receipt');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title={
        <span className="flex items-center gap-2 text-sm font-bold">
          <PackageCheck className="h-4 w-4 text-amber-500" aria-hidden />
          Receive <span className="font-mono">{asn.id}</span>
        </span>
      }
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy} className={btnPrimary}>
            {busy ? 'Posting receipt…' : `Receive and create ${n} ${n === 1 ? 'case' : 'cases'}`}
          </button>
        </div>
      }
    >
      <div className="space-y-4 py-2 text-xs text-[#475569]">
        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
          <div className="font-bold text-[#141416]">{asn.equipment}</div>
          <div>
            <span className="font-mono">{asn.quantity}</span> {asn.productClass === 'batch' ? (asn.quantity === 1 ? 'lot' : 'lots') : 'units'} · {asn.tenant} · to {asn.site} ·{' '}
            <span className="font-mono">{money(asn.estimatedValue)}</span> est.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block min-w-0">
            <span className={fieldLabel}>Receipt date</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} status={tried && !date ? 'error' : undefined} />
          </label>
          <label className="block min-w-0">
            <span className={fieldLabel}>Bay</span>
            <Input value={bay} onChange={(e) => setBay(e.target.value)} status={tried && !bay.trim() ? 'error' : undefined} />
          </label>
          <label className="block min-w-0">
            <span className={fieldLabel}>Received by</span>
            <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} status={tried && !receivedBy.trim() ? 'error' : undefined} />
          </label>
        </div>
        {tried && invalid && <p className="text-[11px] font-semibold text-[#B91C1C]">Fill in the receipt date, bay and who received the goods.</p>}

        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">What will be created</div>
          <ul className="m-0 list-disc space-y-1 pl-4">
            <li>
              <strong className="text-[#141416]">
                {n} returned-asset {n === 1 ? 'case' : 'cases'}
              </strong>{' '}
              <span className="font-mono">{range(preview.caseIds)}</span>
              {preview.unitsPerCase > 1 && (
                <>
                  , <span className="font-mono">{preview.unitsPerCase}</span> units each
                </>
              )}
              , stage {STAGE_META.awaiting_inspection.label.toLowerCase()}
            </li>
            <li>
              A goods receipt in WMS at <span className="font-mono">{bay || '—'}</span>, and {n === 1 ? 'an inspection task' : `${n} inspection tasks`} for Engineering
            </li>
            <li>
              <span className="font-mono">{asn.id}</span> is closed and leaves Expected returns
            </li>
          </ul>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-1 text-[11px] font-bold text-[#64748B]">Evidence on file at receipt</div>
            <ul className="m-0 list-none space-y-1 p-0">
              {preview.evidenceReceived.map((e) => (
                <li key={e} className="flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="shrink-0 text-[#059669]" aria-hidden />
                  {e}
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[11px] font-bold text-[#64748B]">Still needed (inspection and test)</div>
            <ul className="m-0 list-none space-y-1 p-0">
              {preview.evidenceMissing.map((e) => (
                <li key={e} className="flex items-center gap-1.5">
                  <CircleDashed size={12} className="shrink-0 text-[#D97706]" aria-hidden />
                  {e}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="m-0 text-[11px] text-[#64748B]">The grade is provisional until inspection. Each case waits in Awaiting inspection with a provisional, low-confidence route that firms up once photos and test results arrive.</p>
      </div>
    </Modal>
  );
}
