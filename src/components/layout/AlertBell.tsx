'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Popover } from 'antd';
import { Bell } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import { alertService } from '@/services/alertService';
import { SeverityBadge } from '@/components/ui';

/**
 * Header bell: open alerts for the current role and tenant (same list as /command/alerts).
 * Badge is red when any open alert is High. Opens the 5 newest with a link to the Alerts page.
 */
export function AlertBell() {
  const { currentRole, scope } = useAuth();
  const [open, setOpen] = useState(false);
  const q = useServiceQuery(() => alertService.inbox(currentRole, scope), [currentRole, scope.tenant], { subscribe: alertService.subscribe });
  const openAlerts = (q.data ?? []).filter((a) => !a.acknowledged);
  const count = openAlerts.length;
  const high = openAlerts.filter((a) => a.severity === 'high').length;
  const newest = [...openAlerts].sort((a, b) => b.firedAt.localeCompare(a.firedAt)).slice(0, 5);
  const label = q.data ? `Alerts: ${count} open${high ? `, ${high} high severity` : ''}` : 'Alerts';

  const content = (
    <div className="w-[320px] max-w-[calc(100vw-32px)] text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-[#F1F5F9] pb-2">
        <span className="font-extrabold text-[#141416]">Alerts</span>
        <span className="text-[11px] text-[#64748B]">
          {count} open{high ? ` · ${high} high` : ''}
        </span>
      </div>
      {newest.length === 0 ? (
        <p className="m-0 py-4 text-center text-[#64748B]">No open alerts. Everything is within its limits.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-[#F1F5F9] p-0">
          {newest.map((a) => (
            <li key={a.id}>
              <Link href={a.href} onClick={() => setOpen(false)} className="flex items-start gap-2 py-2 no-underline hover:bg-[#F8FAFC]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[#141416]">{a.title}</span>
                  <span className="block truncate text-[11px] text-[#64748B]">{a.system}</span>
                </span>
                <SeverityBadge severity={a.severity} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href="/command/alerts" onClick={() => setOpen(false)} className="mt-1 block border-t border-[#F1F5F9] pt-2 text-center font-semibold text-[#141416] no-underline hover:underline">
        View all alerts
      </Link>
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomRight" open={open} onOpenChange={setOpen} arrow={false}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#334155] hover:border-[#CBD5E1]"
      >
        <Bell size={16} />
        {count > 0 && (
          <span
            aria-hidden="true"
            className={`absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-extrabold leading-none shadow-sm ${
              high ? 'bg-[#DC2626] text-white' : 'bg-[#FFD600] text-black'
            }`}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
    </Popover>
  );
}
