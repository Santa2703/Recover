'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type DashboardMode = 'Business' | 'Technical';

const KEY = 'circ-dashboard-mode';
const EVENT = 'circ-dashboard-mode';

/** In-memory copy so the toggle still works when storage is blocked. */
let memory: DashboardMode = 'Business';

function readMode(): DashboardMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'Technical' || v === 'Business' ? v : memory;
  } catch {
    return memory;
  }
}

function subscribeMode(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** Business / Technical view, remembered in localStorage (falls back to Business). */
export function useDashboardMode(): [DashboardMode, (m: DashboardMode) => void] {
  const mode = useSyncExternalStore(subscribeMode, readMode, () => 'Business' as const);
  const setMode = useCallback((m: DashboardMode) => {
    memory = m;
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* storage unavailable: the choice lasts for this view only */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [mode, setMode];
}

function subscribeClock(onChange: () => void) {
  const id = window.setInterval(onChange, 10000);
  return () => window.clearInterval(id);
}
const minuteNow = () => Math.floor(Date.now() / 60000);

/** Current minute on the client (null during server render), refreshed every 10 s. */
export function useMinuteClock(): Date | null {
  const minute = useSyncExternalStore(subscribeClock, minuteNow, () => null);
  return minute === null ? null : new Date(minute * 60000);
}
