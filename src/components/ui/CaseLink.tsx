'use client';

import React from 'react';
import Link from 'next/link';
import { clearQueue, rememberQueue, type QueueContext } from '@/components/product/queueContext';

/**
 * Monospace case/asset id linking to the case workspace. Pass `queue` when the link sits in a
 * work queue so the Case page offers "Back to <queue>" and Previous / Next; without it the
 * remembered queue is cleared.
 */
export function CaseLink({ id, label, queue }: { id: string; label?: string; queue?: QueueContext }) {
  return (
    <Link
      href={`/product/case/${id}`}
      onClick={() => (queue ? rememberQueue(queue.name, queue.href, queue.ids) : clearQueue())}
      className="group inline-flex min-w-0 items-baseline gap-1.5 text-ink no-underline"
    >
      <span className="font-mono text-xs font-medium underline-offset-2 group-hover:underline">{id}</span>
      {label && <span className="truncate text-xs text-ink-2">{label}</span>}
    </Link>
  );
}
