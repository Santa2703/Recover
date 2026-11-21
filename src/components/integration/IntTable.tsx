'use client';

import React from 'react';
import { Inbox, SearchX } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import { BREAKPOINTS, useMediaQuery } from '@/hooks/useMediaQuery';

export interface IntColumn<T> {
  key: string;
  title: React.ReactNode;
  render: (row: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  /** Extra classes on the cell. */
  className?: string;
  /**
   * 1 = always shown (also the card title row on phones), 2 = from 768px, 3 = from 1280px.
   * Anything hidden must also be reachable from the row's drawer or modal.
   */
  priority?: 1 | 2 | 3;
  /** Takes the remaining width and truncates its content instead of widening the table. */
  grow?: boolean;
}

interface IntTableProps<T> {
  columns: IntColumn<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  initialLoading?: boolean;
  refreshing?: boolean;
  /** Filters active: show "no results" copy and a clear action. */
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyText?: string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  rowClassName?: (row: T) => string;
  skeletonRows?: number;
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;
const VIS = { 1: '', 2: 'hidden md:table-cell', 3: 'hidden xl:table-cell' } as const;

/**
 * Plain table in the Exceptions page style, with skeleton, empty and no-results states.
 * Never scrolls sideways: low-priority columns hide as the screen narrows, one `grow`
 * column absorbs the remaining width, and below 768px rows become stacked cards.
 */
export function IntTable<T>({
  columns,
  rows,
  rowKey,
  initialLoading,
  refreshing,
  filtered,
  onClearFilters,
  emptyText = 'Nothing here yet',
  onRowClick,
  selectedKey,
  rowClassName,
  skeletonRows = 6,
}: IntTableProps<T>) {
  const isTablet = useMediaQuery(BREAKPOINTS.tablet);

  const empty = (
    <div className="flex flex-col items-center gap-2 py-10 text-xs text-[#94A3B8]">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F1F5F9] text-[#64748B]">{filtered ? <SearchX size={16} /> : <Inbox size={16} />}</div>
      <span className="text-center font-semibold text-[#475569]">{filtered ? 'No rows match these filters' : emptyText}</span>
      {filtered && onClearFilters && (
        <button type="button" onClick={onClearFilters} className="cursor-pointer text-xs font-semibold text-[#141416] underline underline-offset-2">
          Clear filters
        </button>
      )}
    </div>
  );

  // Phones: stacked cards. Title row = priority-1 columns; titled others as label/value pairs; untitled (actions) last.
  if (!isTablet) {
    const primary = columns.filter((c) => (c.priority ?? 1) === 1 && c.title !== '');
    const pairs = columns.filter((c) => (c.priority ?? 1) !== 1 && c.title !== '');
    const footer = columns.filter((c) => c.title === '' && c.priority !== 3);
    return (
      <div className={`transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
        {initialLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: Math.min(skeletonRows, 4) }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-[#E2E8F0] p-3">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : rows && rows.length === 0 ? (
          empty
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {rows?.map((row) => {
              const k = rowKey(row);
              return (
                <li
                  key={k}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`min-w-0 rounded-xl border bg-white p-3 text-xs ${selectedKey === k ? 'border-[#FDE68A] bg-[#FFFBEB]' : 'border-[#E2E8F0]'} ${
                    onRowClick ? 'cursor-pointer hover:border-gray-400' : ''
                  } ${rowClassName?.(row) ?? ''}`}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    {primary.map((c) => (
                      <div key={c.key} className="min-w-0 max-w-full">
                        {c.render(row)}
                      </div>
                    ))}
                  </div>
                  {!!pairs.length && (
                    <dl className="m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {pairs.map((c) => (
                        <div key={c.key} className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">{c.title}</dt>
                          <dd className="m-0 min-w-0 text-[#141416]">{c.render(row)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {!!footer.length && (
                    <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                      {footer.map((c) => (
                        <div key={c.key}>{c.render(row)}</div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  const pad = (i: number) => (i === 0 ? 'pl-3 pr-2' : i === columns.length - 1 ? 'pl-2 pr-3' : 'px-2');
  const cellCls = (c: IntColumn<T>, i: number) => `${pad(i)} ${ALIGN[c.align ?? 'left']} ${VIS[c.priority ?? 1]} ${c.grow ? 'w-full max-w-0' : ''}`;

  return (
    <div className={`w-full min-w-0 transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[#F1F5F9] text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
            {columns.map((c, i) => (
              <th key={c.key} className={`whitespace-nowrap py-2 font-bold ${c.grow ? 'overflow-hidden text-ellipsis' : ''} ${cellCls(c, i)}`}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {initialLoading &&
            Array.from({ length: skeletonRows }).map((_, r) => (
              <tr key={`sk-${r}`} className="border-b border-[#F8FAFC]" aria-busy="true">
                {columns.map((c, i) => (
                  <td key={c.key} className={`py-3 ${cellCls(c, i)}`}>
                    <Skeleton className={`h-3.5 ${i === 0 ? 'w-3/4' : 'w-1/2'} ${c.grow ? '' : 'min-w-8'}`} />
                  </td>
                ))}
              </tr>
            ))}
          {!initialLoading && rows && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          )}
          {!initialLoading &&
            rows?.map((row) => {
              const k = rowKey(row);
              const selected = selectedKey === k;
              return (
                <tr
                  key={k}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-[#F8FAFC] transition-colors ${selected ? 'bg-[#FFFBEB]' : 'hover:bg-[#F8FAFC]'} ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(row) ?? ''}`}
                >
                  {columns.map((c, i) => (
                    <td key={c.key} className={`py-2.5 align-middle ${cellCls(c, i)} ${c.className ?? ''}`}>
                      {c.grow ? <div className="min-w-0 overflow-hidden">{c.render(row)}</div> : c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
