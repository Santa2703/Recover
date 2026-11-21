import React from 'react';
import Link from 'next/link';

interface SectionCardProps {
  title: React.ReactNode;
  /** Lucide icon shown in amber before the title. */
  icon?: React.ReactNode;
  /** Right side of the header: a count pill, a link, a toggle. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Body padding off (lists that run edge to edge). */
  flush?: boolean;
}

/** White rounded card with one border, a compact header and p-5 body (local style). */
export function SectionCard({ title, icon, actions, children, className = '', flush }: SectionCardProps) {
  return (
    <section className={`flex min-w-0 flex-col rounded-2xl border border-[#E2E8F0] bg-white shadow-2xs ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F1F5F9] px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          {icon && <span className="flex shrink-0 text-amber-500 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
          <h2 className="m-0 truncate text-sm font-extrabold text-[#141416]">{title}</h2>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={`min-w-0 flex-1 ${flush ? '' : 'p-5'}`}>{children}</div>
    </section>
  );
}

/** Small "View all →" style link used in card headers. */
export function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="whitespace-nowrap text-xs font-semibold text-[#64748B] no-underline hover:text-[#141416]">
      {children} →
    </Link>
  );
}
