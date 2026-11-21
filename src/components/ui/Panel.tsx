import React from 'react';

interface PanelProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Optional icon tile shown before the title (local card style). */
  icon?: React.ReactNode;
  /** Right side of the header: a toggle, a count pill, a link. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Remove body padding (for edge-to-edge tables). */
  flush?: boolean;
  className?: string;
  id?: string;
}

/** White rounded card used for every page section, matching the local pages. */
export function Panel({ title, description, icon, actions, children, flush, className = '', id }: PanelProps) {
  return (
    <section id={id} className={`min-w-0 rounded-2xl border border-[#E2E8F0] bg-white shadow-2xs ${className}`}>
      {(title || actions) && (
        <div className="flex flex-col justify-between gap-2 border-b border-[#F1F5F9] px-5 pb-3.5 pt-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-start gap-2.5">
            {icon && (
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#FEF3C7] bg-[#FFFBEB] text-amber-500 [&>svg]:h-4 [&>svg]:w-4">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {title && <h2 className="m-0 text-sm font-extrabold text-[#141416]">{title}</h2>}
              {description && <p className="m-0 mt-0.5 text-xs text-[#64748B]">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}
