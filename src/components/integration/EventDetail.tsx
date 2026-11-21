'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { message } from 'antd';
import { RefreshCw } from 'lucide-react';
import { CaseLink } from '@/components/ui';
import { eventService, type IntegrationEvent } from '@/services/integrationService';
import { DirectionTag, SourceChip } from './Pills';
import { JsonView } from './JsonView';
import { BTN_SECONDARY } from './styles';
import { fmtClock, fmtDateTime, fmtLatency } from './format';
import { sourceHref } from './issueMeta';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">{label}</div>
      <div className="mt-0.5 min-w-0 truncate font-medium text-[#141416]">{children}</div>
    </div>
  );
}

/** Replay button for a failed or warning event (replaying delivers it again and clears the issue). */
export function ReplayButton({ event, onDone }: { event: IntegrationEvent; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  if (event.status === 'ok') return null;
  return (
    <button
      type="button"
      className={BTN_SECONDARY}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await eventService.replay(event.id);
          message.success(`${event.id} replayed and delivered`);
          onDone?.();
        } finally {
          setBusy(false);
        }
      }}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
      <span>Replay</span>
    </button>
  );
}

/** Event fields and payload, as shown in the Issues drawers. */
export function EventDetail({ event: ev }: { event: IntegrationEvent }) {
  return (
    <div className="space-y-4 text-xs">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
        <Field label="Time">
          {fmtDateTime(ev.ts)}:{fmtClock(ev.ts).slice(-2)} UTC
        </Field>
        <Field label="Latency">{fmtLatency(ev.latencyMs)}</Field>
        <Field label="Source">
          <Link href={sourceHref(ev.source)} className="inline-flex max-w-full hover:underline" aria-label={`Open ${ev.source}`}>
            <SourceChip system={ev.source} />
          </Link>
        </Field>
        <Field label="Direction">
          <DirectionTag direction={ev.direction} />
        </Field>
        <Field label="Type">
          <span className="font-mono font-bold">{ev.type}</span>
        </Field>
        <Field label="Entity">{ev.entityType}</Field>
        <Field label="Case">
          <CaseLink id={ev.entityId} label={eventService.caseLabel(ev.entityId)} />
        </Field>
        <Field label="Result">{ev.message}</Field>
      </div>
      <JsonView value={ev.payload} label={`${ev.id}.json`} />
    </div>
  );
}
