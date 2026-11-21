'use client';

import React from 'react';
import Link from 'next/link';
import { Drawer } from 'antd';
import { Bell, CheckCircle2, ExternalLink, Package, RotateCcw, UserPlus } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import { EXCEPTION_TYPE_LABEL, exceptionService, type ExceptionRow } from '@/services/exceptionService';
import { ListSkeleton } from '@/components/ui';
import { rememberQueue } from '@/components/product/queueContext';
import { fmtUsd, formatDay } from './commandUtils';

export type ExceptionDrawerAction = 'notify' | 'assign' | 'resolve' | 'reopen';

const BTN = 'inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] shadow-2xs transition-all hover:border-gray-400';

/** Exception detail: the facts hidden from narrow tables (items, age, top item), every affected case, and the row actions. */
export function ExceptionDrawer({
  row,
  onClose,
  onAction,
}: {
  row: ExceptionRow | null;
  onClose: () => void;
  /** Opens the page's Notify / Assign / Resolve dialogs (same service calls as the row menu). */
  onAction?: (a: ExceptionDrawerAction, row: ExceptionRow) => void;
}) {
  const resolved = row?.status === 'resolved';
  const id = row?.id ?? null;
  const { scope } = useAuth();
  // affectedItems is not scoped, so keep only the cases the scoped row counted (same tenant/site).
  const { data: items, loading } = useServiceQuery(
    () =>
      id
        ? exceptionService.affectedItems(id).then((list) => list.filter((c) => (!scope.tenant || c.tenant === scope.tenant) && (!scope.site || c.location === scope.site)))
        : Promise.resolve([]),
    [id, scope.tenant, scope.site],
  );

  const facts: [string, React.ReactNode][] = row
    ? [
        ['Warehouse', row.warehouse],
        ['Type', EXCEPTION_TYPE_LABEL[row.type]],
        ['Owner', row.ownerName],
        ['Status', row.status[0].toUpperCase() + row.status.slice(1)],
        ['Items', `${row.itemsCount} ${row.itemsCount === 1 ? 'item' : 'items'}`],
        ['Value at risk', <span key="v" className="font-mono font-bold">{fmtUsd(row.valueAtRisk)}</span>],
        ['Opened', `${formatDay(row.openedAt, true)} (${row.ageDays}d)`],
        ['Top item', row.topCase ? `${row.topCase.id} ${row.topCase.productName}` : row.topCaseId],
        ['Last notified', row.lastNotifiedAt ? formatDay(row.lastNotifiedAt, true) : 'Not yet'],
      ]
    : [];

  return (
    <Drawer
      open={!!row}
      onClose={onClose}
      size="min(520px, 100vw)"
      destroyOnHidden
      footer={
        row && onAction ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {resolved ? (
              <button type="button" className={BTN} onClick={() => onAction('reopen', row)}>
                <RotateCcw className="h-3.5 w-3.5" /> Reopen
              </button>
            ) : (
              <>
                <button type="button" className={BTN} onClick={() => onAction('assign', row)}>
                  <UserPlus className="h-3.5 w-3.5" /> Assign
                </button>
                <button type="button" className={BTN} onClick={() => onAction('resolve', row)}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                </button>
                <button
                  type="button"
                  onClick={() => onAction('notify', row)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border-none bg-[#FFD600] px-3 py-1.5 text-xs font-extrabold text-[#141416] transition-colors hover:bg-[#FACC15]"
                >
                  <Bell className="h-3.5 w-3.5" /> Notify owner
                </button>
              </>
            )}
          </div>
        ) : undefined
      }
      title={
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-bold">{row?.title ?? 'Exception'}</span>
        </div>
      }
    >
      {row && (
        <div className="flex flex-col gap-5 text-xs">
          <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">{k}</dt>
                <dd className="m-0 break-words text-[#141416]">{v}</dd>
              </div>
            ))}
          </dl>

          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">Affected items</div>
            {loading ? (
              <ListSkeleton rows={4} />
            ) : (
              <ul className="m-0 list-none divide-y divide-[#F1F5F9] overflow-hidden rounded-xl border border-[#E2E8F0] p-0">
                {(items ?? []).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 p-2.5">
                    <div className="min-w-0">
                      <Link
                        href={`/product/case/${c.id}`}
                        onClick={() => rememberQueue(`Exceptions · ${row.id}`, '/command/exceptions', (items ?? []).map((x) => x.id))}
                        className="flex items-center gap-1 font-mono font-bold text-[#141416] hover:underline"
                      >
                        {c.id}
                        <ExternalLink className="h-3 w-3 text-[#94A3B8]" />
                      </Link>
                      <div className="truncate text-[11px] text-[#64748B]">
                        {c.productName} · {c.location}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono font-bold text-[#141416]">{fmtUsd(c.valueAtRisk)}</div>
                      <div className="text-[10px] text-[#94A3B8]">at risk</div>
                    </div>
                  </li>
                ))}
                {!items?.length && <li className="p-3 text-center text-[#94A3B8]">No linked cases.</li>}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
