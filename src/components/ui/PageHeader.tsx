import React from 'react';

interface PageHeaderProps {
  title: React.ReactNode;
  /** One short sentence stating the page's purpose. */
  description?: React.ReactNode;
  /** Small chip(s) next to the title. */
  badge?: React.ReactNode;
  /** Right-aligned actions. Keep a single primary (yellow) action. */
  actions?: React.ReactNode;
  /** Secondary metadata under the actions, e.g. "Last refreshed …". */
  meta?: React.ReactNode;
}

/** Page title block, matching the existing local pages (Exceptions, Command Center). */
export function PageHeader({ title, description, badge, actions, meta }: PageHeaderProps) {
  return (
    // Title and actions sit side by side from 1024px; below that they stack so the title is never squeezed.
    <div className="flex flex-col justify-between gap-4 pt-1 lg:flex-row lg:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="m-0 text-2xl font-extrabold leading-tight tracking-tight text-[#141416]">{title}</h1>
          {badge}
        </div>
        {description && <p className="m-0 mt-1 max-w-2xl text-xs font-normal leading-relaxed text-[#6B7280]">{description}</p>}
      </div>
      {(actions || meta) && (
        <div className="flex shrink-0 flex-col items-start gap-1.5 pt-1 lg:items-end">
          {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
          {meta && <div className="text-[11px] font-medium text-[#64748B]">{meta}</div>}
        </div>
      )}
    </div>
  );
}
