'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

/** Back/forward changes the query string without remounting the page. */
const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
};
const readSearch = () => window.location.search;

/**
 * One query-string value as state: read from the URL (no useSearchParams, so no Suspense
 * boundary) and written back with history.replaceState. Only this parameter is touched,
 * so several of these (e.g. ?tab= plus filters) never drop each other. The fallback is left
 * out of the URL.
 */
export function useUrlParam(name: string, fallback: string, accept: (v: string) => boolean = () => true): [string, (v: string) => void] {
  const search = useSyncExternalStore(subscribe, readSearch, () => '');
  const [picked, setPicked] = useState<string | null>(null);
  const fromUrl = new URLSearchParams(search).get(name);
  const value = picked ?? (fromUrl !== null && accept(fromUrl) ? fromUrl : fallback);

  const set = useCallback(
    (v: string) => {
      setPicked(v);
      try {
        const url = new URL(window.location.href);
        if (v === fallback || v === '') url.searchParams.delete(name);
        else url.searchParams.set(name, v);
        window.history.replaceState(window.history.state, '', url.toString());
      } catch {
        /* ignore */
      }
    },
    [name, fallback],
  );

  return [value, set];
}

/** Deep-linkable antd Tabs state (`?tab=`); unknown values fall back to the first tab. */
export function useTabParam<K extends string>(keys: readonly K[], fallback: K): [K, (k: string) => void] {
  const accept = useCallback((v: string) => keys.includes(v as K), [keys]);
  const [tab, set] = useUrlParam('tab', fallback, accept);
  const setTab = useCallback((k: string) => accept(k) && set(k), [accept, set]);
  return [tab as K, setTab];
}

/** Lets the active tab hand its CSV export to the page-level Export button. */
export type Exporter = (() => void) | null;
export type RegisterExport = (fn: Exporter) => void;

/** Holds the active tab's exporter; tabs register it with `register` from an effect. */
export function useTabExporter(): [Exporter, RegisterExport] {
  const [exporter, setExporter] = useState<Exporter>(null);
  // Wrap in an updater so React stores the function instead of calling it.
  const register = useCallback<RegisterExport>((fn) => setExporter(() => fn), []);
  return [exporter, register];
}
