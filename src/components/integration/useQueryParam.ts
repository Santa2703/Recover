'use client';

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

/**
 * Reads a query-string value on the client without useSearchParams (no Suspense needed).
 * Returns null during server render and hydration, then the value from window.location.
 * Re-renders when the URL changes through `setQueryParams` or the browser's back/forward.
 */
export function useQueryParam(name: string): string | null {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => '',
  );
  return new URLSearchParams(search).get(name);
}

/**
 * Updates query parameters in place (history.replaceState, no navigation) and notifies every
 * `useQueryParam` reader. `null` or '' removes a parameter.
 */
export function setQueryParams(patch: Record<string, string | null | undefined>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === '') url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(window.history.state, '', url);
  listeners.forEach((l) => l());
}
