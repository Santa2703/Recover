'use client';

import { useEffect, useState } from 'react';

/** true when the user has asked the OS for reduced motion */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * Charts animate when they first mount (every navigation remounts the page via
 * app/(workbench)/template.tsx), but not when the user changes filters afterwards.
 * Returns true during the entrance window only, and never for reduced-motion users.
 */
export function useEntranceAnimation(windowMs = 1200): boolean {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setActive(false), windowMs);
    return () => clearTimeout(t);
  }, [windowMs]);
  return active && !reduced;
}
