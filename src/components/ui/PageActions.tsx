'use client';

import React from 'react';
import { Dropdown } from 'antd';
import { MoreHorizontal } from 'lucide-react';

export interface PageAction {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

interface PageActionsProps {
  /** The one dominant (yellow) action of the page. Always visible. */
  primary?: PageAction;
  /** Secondary actions (Share, Refresh…). Inline from 768px; collapse into "⋯" below. */
  secondary?: PageAction[];
  /** Small status text, e.g. "Updated 09:00". Hidden below 768px. */
  meta?: React.ReactNode;
}

/**
 * Page header actions in the local style. Wraps instead of overflowing and folds
 * secondary actions into a "⋯" menu on narrow screens, so headers never scroll sideways.
 */
export function PageActions({ primary, secondary = [], meta }: PageActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {meta && <span className="hidden text-[11px] font-medium text-[#64748B] md:inline">{meta}</span>}
      {secondary.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={a.onClick}
          disabled={a.disabled}
          className="hidden items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] shadow-2xs transition-all hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50 md:inline-flex cursor-pointer"
        >
          {a.icon && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{a.icon}</span>}
          {a.label}
        </button>
      ))}
      {!!secondary.length && (
        <Dropdown
          trigger={['click']}
          menu={{ items: secondary.map((a) => ({ key: a.key, label: a.label, icon: a.icon, disabled: a.disabled, onClick: a.onClick })) }}
        >
          <button
            type="button"
            aria-label="More actions"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[#E2E8F0] bg-white text-[#141416] shadow-2xs hover:border-gray-400 md:hidden cursor-pointer"
          >
            <MoreHorizontal size={15} />
          </button>
        </Dropdown>
      )}
      {primary && (
        <button
          type="button"
          onClick={primary.onClick}
          disabled={primary.disabled}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#FFD600] px-3.5 py-1.5 text-xs font-extrabold text-[#141416] shadow-2xs transition-all hover:bg-[#FACC15] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {primary.icon && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{primary.icon}</span>}
          {primary.label}
        </button>
      )}
    </div>
  );
}
