'use client';

import { useSyncExternalStore } from 'react';

/**
 * Queue context for the Case page: when a queue (My work, Approvals, Returned assets, …)
 * opens a case it remembers its name, its URL and the case ids in the order shown, in
 * sessionStorage (`circ-queue`). The Case page reads it to show "Back to <queue>",
 * "Case 3 of 21" and Previous / Next. Opening a case from anywhere else clears it.
 */
export interface QueueContext {
  name: string;
  href: string;
  ids: string[];
}

const KEY = 'circ-queue';
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: QueueContext | null } = { raw: null, value: null };

function read(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function snapshot(): QueueContext | null {
  const raw = read();
  if (raw === cache.raw) return cache.value;
  let value: QueueContext | null = null;
  try {
    const v = raw ? (JSON.parse(raw) as QueueContext) : null;
    value = v && typeof v.name === 'string' && typeof v.href === 'string' && Array.isArray(v.ids) ? v : null;
  } catch {
    value = null;
  }
  cache = { raw, value };
  return value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const notify = () => listeners.forEach((l) => l());

/** Remembers the queue a case is opened from. Ids are de-duplicated, order kept. */
export function rememberQueue(name: string, href: string, ids: string[]): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ name, href, ids: [...new Set(ids)] }));
  } catch {
    /* storage blocked: the case page simply shows no queue bar */
  }
  notify();
}

/** Forgets the queue (a case opened from outside a queue shows no queue bar). */
export function clearQueue(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  notify();
}

/** The remembered queue (null on the server and when none is stored). */
export function useQueueContext(): QueueContext | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

export const caseHref = (id: string) => `/product/case/${encodeURIComponent(id)}`;
