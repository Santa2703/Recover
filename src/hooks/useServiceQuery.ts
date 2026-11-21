'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ServiceQueryState<T> {
  data: T | undefined;
  loading: boolean;
  /** true only for the very first load (show skeletons); later refetches keep old data visible */
  initialLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

interface Settled<T> {
  key: string;
  data: T | undefined;
  error: Error | null;
}

/**
 * Loads data from an async service function.
 * Re-runs when `deps` change; keeps the previous data on screen while refetching
 * (so filters don't flash skeletons). Pass `subscribe` to refetch on store changes.
 *
 * Loading is derived (the last settled request key differs from the current one),
 * so no state is set synchronously inside the effect.
 */
export function useServiceQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  options: { subscribe?: (listener: () => void) => () => void } = {},
): ServiceQueryState<T> {
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState<Settled<T>>({ key: '', data: undefined, error: null });
  const key = JSON.stringify([deps, tick]);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;
    fetcherRef
      .current()
      .then((result) => {
        if (!cancelled) setSettled({ key, data: result, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setSettled((s) => ({ key, data: s.data, error: err instanceof Error ? err : new Error(String(err)) }));
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const { subscribe } = options;
  useEffect(() => {
    if (!subscribe) return;
    return subscribe(() => setTick((t) => t + 1));
  }, [subscribe]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const loading = settled.key !== key;

  return { data: settled.data, loading, initialLoading: loading && settled.data === undefined, error: settled.error, refetch };
}
