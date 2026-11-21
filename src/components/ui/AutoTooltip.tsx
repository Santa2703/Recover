'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * App-wide tooltip for truncated text. Any element cut off with an ellipsis (`truncate`, `line-clamp-*`,
 * antd table ellipsis cells) shows its full text on hover or keyboard focus, so columns and cards can stay
 * narrow. Elements can also opt in explicitly with `data-tip="…"`. Mounted once in WorkbenchLayout.
 *
 * It only appears when the text is actually cut off, and it replaces the browser's own `title` tooltip
 * on those elements (the title is restored on leave), so there is never a double tooltip.
 */
const CANDIDATE = '[data-tip], .truncate, [class*="line-clamp-"], .ant-table-cell-ellipsis, .ant-table-cell-content, .ant-typography-ellipsis';
const SHOW_DELAY = 300;

interface TipState {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

function isCutOff(el: Element): boolean {
  const h = el as HTMLElement;
  return h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1;
}

/** Innermost candidate whose text is cut off (walks up a few levels: a cell may clip, not its child span). */
function findTarget(start: Element | null): HTMLElement | null {
  let el = start?.closest(CANDIDATE) ?? null;
  for (let i = 0; el && i < 4; i++) {
    if ((el as HTMLElement).dataset.tip || isCutOff(el)) return el as HTMLElement;
    el = el.parentElement?.closest(CANDIDATE) ?? null;
  }
  return null;
}

export function AutoTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const current = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const restoreTitle = (el: HTMLElement) => {
      const t = el.getAttribute('data-at-title');
      if (t !== null) {
        el.setAttribute('title', t);
        el.removeAttribute('data-at-title');
      }
      el.removeAttribute('aria-describedby');
    };

    const hide = () => {
      if (timer.current) clearTimeout(timer.current);
      if (current.current) restoreTitle(current.current);
      current.current = null;
      setTip(null);
    };

    const show = (target: EventTarget | null) => {
      const el = findTarget(target as Element | null);
      if (el === current.current) return;
      hide();
      if (!el || el.closest('input, textarea, [contenteditable="true"]')) return;
      const text = (el.dataset.tip || el.getAttribute('title') || el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      // Take over the native title so the browser doesn't show a second, delayed tooltip.
      const title = el.getAttribute('title');
      if (title !== null) {
        el.setAttribute('data-at-title', title);
        el.removeAttribute('title');
      }
      current.current = el;
      timer.current = setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 56;
        el.setAttribute('aria-describedby', 'auto-tooltip');
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
      }, SHOW_DELAY);
    };

    const onOver = (e: MouseEvent) => show(e.target);
    const onOut = (e: MouseEvent) => {
      const el = current.current;
      if (el && !(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) hide();
    };
    const onFocus = (e: FocusEvent) => show(e.target);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', onKey);
    return () => {
      hide();
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('mousedown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!tip || typeof document === 'undefined') return null;
  const maxW = 320;
  const left = Math.min(Math.max(tip.x, 16 + maxW / 2), window.innerWidth - 16 - maxW / 2);
  return createPortal(
    <div
      id="auto-tooltip"
      role="tooltip"
      className="pointer-events-none fixed z-[2000] rounded-lg bg-[#141416] px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg"
      style={{
        left,
        top: tip.y,
        maxWidth: maxW,
        width: 'max-content',
        transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`,
        overflowWrap: 'anywhere',
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
