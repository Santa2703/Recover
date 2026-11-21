'use client';

import { useSyncExternalStore } from 'react';

/** Layout breakpoints used by the shell (content width, not just viewport). */
export const BREAKPOINTS = {
  /** Sidebar fully expanded from here up. */
  wide: '(min-width: 1280px)',
  /** Sidebar shown as an icon rail from here up; below it becomes a slide-out drawer. */
  desktop: '(min-width: 1024px)',
  /** Tables switch from cards to rows from here up. */
  tablet: '(min-width: 768px)',
} as const;

/**
 * Subscribes to a CSS media query. Returns `fallback` during server render so markup
 * matches the first client render, then the real value.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}
