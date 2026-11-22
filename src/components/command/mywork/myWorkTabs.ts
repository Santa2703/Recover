'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { canSeeNav } from '@/constants/navigation.constants';
import type { UserRole } from '@/models/user.model';

/** My work (/command/actions): one inbox, one tab per former Command Center queue. */
export const MY_WORK_TABS = ['tasks', 'approvals', 'outcomes', 'handed-off', 'prioritise'] as const;
export type MyWorkTab = (typeof MY_WORK_TABS)[number];

export const MY_WORK_PATH = '/command/actions';

/** The tab's permission key in NAV_ACCESS (`command` item): the key its old sidebar entry had. */
const TAB_NAV_KEY: Record<MyWorkTab, string> = {
  tasks: 'actions',
  approvals: 'approvals',
  outcomes: 'outcomes',
  'handed-off': 'handed-off',
  prioritise: 'prioritise',
};

/**
 * Tabs `role` sees, in order. A role with none (e.g. Developer reaching the URL) still gets Tasks,
 * and so does a role that has been sent an escalation (`withTasks`; added last, so the landing tab stays).
 */
export function visibleTabs(role: UserRole, withTasks = false): MyWorkTab[] {
  const tabs = MY_WORK_TABS.filter((t) => canSeeNav(role, 'command', TAB_NAV_KEY[t]));
  if (withTasks && tabs.length && !tabs.includes('tasks')) return [...tabs, 'tasks'];
  return tabs.length ? tabs : ['tasks'];
}

/** Link to a My work tab; Tasks is the default and keeps the URL clean. */
export const myWorkHref = (tab: MyWorkTab) => (tab === 'tasks' ? MY_WORK_PATH : `${MY_WORK_PATH}?tab=${tab}`);

/* `?tab=` lives in the URL only: read with useSyncExternalStore, written with history.replaceState. */
const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('popstate', onChange);
  };
};
const readTab = () => new URLSearchParams(window.location.search).get('tab');

/**
 * Active My work tab for `role`: the `?tab=` value when the role can see it, otherwise the
 * first tab the role sees (Finance lands on Outcomes). Tasks is omitted from the URL.
 */
export function useMyWorkTab(role: UserRole, withTasks = false): { tab: MyWorkTab; tabs: MyWorkTab[]; setTab: (k: string) => void } {
  const raw = useSyncExternalStore(subscribe, readTab, () => null);
  const tabs = visibleTabs(role, withTasks);
  const tab = tabs.includes(raw as MyWorkTab) ? (raw as MyWorkTab) : tabs[0];

  const landing = tabs[0];
  const setTab = useCallback((k: string) => {
    if (!(MY_WORK_TABS as readonly string[]).includes(k)) return;
    try {
      const url = new URL(window.location.href);
      // The landing tab keeps the URL clean (Tasks for most roles); others go in ?tab=.
      if (k === landing) url.searchParams.delete('tab');
      else url.searchParams.set('tab', k);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  }, [landing]);

  return { tab, tabs, setTab };
}
