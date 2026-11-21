'use client';

import React from 'react';
import { Pagination, Table } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { TableSkeleton } from './Skeleton';
import { EmptyState, NoResultsState } from './States';
import { BREAKPOINTS, useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * Column priority decides what stays visible as the screen narrows, so tables never scroll sideways:
 *  1 = essential (always shown, also used for the mobile card title row)
 *  2 = shown from 768px (md) up
 *  3 = shown from 1200px (xl) up
 * Anything hidden must also be reachable from the row's detail drawer / expanded row.
 */
export type DataColumn<T> = ColumnType<T> & { priority?: 1 | 2 | 3 };

interface DataTableProps<T> extends Omit<TableProps<T>, 'loading' | 'columns'> {
  columns: DataColumn<T>[];
  /** First load: render a skeleton instead of the table. */
  initialLoading?: boolean;
  /** Refetch in progress: keep rows, dim the table. */
  refreshing?: boolean;
  /** Filters are active (changes the empty state copy). */
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Row click (used by the mobile card layout as well). */
  onRowClick?: (record: T) => void;
}

const RESPONSIVE: Record<2 | 3, ColumnType<unknown>['responsive']> = { 2: ['md'], 3: ['xl'] };

function cellValue<T>(col: DataColumn<T>, record: T, index: number): React.ReactNode {
  const di = col.dataIndex as keyof T | undefined;
  const raw = di !== undefined ? (record as Record<string, unknown>)[di as string] : undefined;
  if (col.render) return col.render(raw, record, index) as React.ReactNode;
  return raw as React.ReactNode;
}

/**
 * antd Table with the app's states: skeleton on first load, dimmed refresh,
 * "no results" vs "empty" states, priority-based column hiding (never a sideways
 * scroll) and a stacked card layout below 768px.
 */
export function DataTable<T extends object>({
  columns,
  initialLoading,
  refreshing,
  filtered,
  onClearFilters,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  onRowClick,
  dataSource,
  rowKey,
  pagination,
  onRow,
  ...rest
}: DataTableProps<T>) {
  const isTablet = useMediaQuery(BREAKPOINTS.tablet);
  if (initialLoading) return <TableSkeleton columns={Math.min(6, columns.length)} />;

  const empty = filtered ? <NoResultsState onClear={onClearFilters} compact /> : <EmptyState title={emptyTitle} description={emptyDescription} compact />;
  const rows = (dataSource ?? []) as readonly T[];
  const keyOf = (r: T, i: number) =>
    typeof rowKey === 'function' ? String(rowKey(r)) : rowKey ? String((r as Record<string, unknown>)[rowKey as string]) : String(i);

  // Phones: stacked cards. Title row = priority-1 columns; the rest as label/value pairs.
  if (!isTablet) {
    const primary = columns.filter((c) => (c.priority ?? 1) === 1);
    const secondary = columns.filter((c) => (c.priority ?? 1) !== 1 && c.title);
    const pageSize = pagination && typeof pagination === 'object' ? pagination.pageSize ?? 10 : rows.length || 1;
    const current = pagination && typeof pagination === 'object' ? pagination.current ?? 1 : 1;
    // Server-side paging (total > rows we hold): the rows are already the current page, so don't slice them again.
    const serverPaged = !!pagination && typeof pagination === 'object' && (pagination.total ?? 0) > rows.length;
    const visible = pagination === false || serverPaged ? rows : rows.slice((current - 1) * pageSize, current * pageSize);
    const totalRows = pagination && typeof pagination === 'object' ? pagination.total ?? rows.length : rows.length;
    return (
      <div className={`transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
        {!rows.length ? (
          empty
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {visible.map((r, i) => (
              <li
                key={keyOf(r, i)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`rounded-xl border border-[#E2E8F0] bg-white p-3 text-xs ${onRowClick ? 'cursor-pointer hover:border-gray-400' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {primary.map((c, ci) => (
                    <div key={String(c.key ?? ci)} className="min-w-0">
                      {cellValue(c, r, i)}
                    </div>
                  ))}
                </div>
                {!!secondary.length && (
                  <dl className="m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {secondary.map((c, ci) => (
                      <div key={String(c.key ?? ci)} className="min-w-0">
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">{c.title as React.ReactNode}</dt>
                        <dd className="m-0 truncate text-[#141416]">{cellValue(c, r, i)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
        {pagination && typeof pagination === 'object' && totalRows > pageSize && (
          <div className="mt-3 flex justify-center">
            <Pagination size="small" simple {...pagination} total={pagination.total ?? rows.length} />
          </div>
        )}
      </div>
    );
  }

  const antColumns = columns.map((c) => {
    const { priority, ...col } = c;
    return { ellipsis: col.ellipsis ?? true, ...col, responsive: priority === 2 || priority === 3 ? RESPONSIVE[priority] : col.responsive } as ColumnType<T>;
  });

  return (
    <div className={`transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
      {/* No explicit tableLayout: with ellipsis columns antd switches to a fixed layout, so long text
          truncates instead of widening the table. Pass tableLayout to override per table. */}
      <Table<T>
        size="middle"
        columns={antColumns}
        dataSource={dataSource}
        rowKey={rowKey}
        pagination={pagination}
        onRow={onRowClick ? (r, i) => ({ ...onRow?.(r, i), onClick: () => onRowClick(r), className: 'cursor-pointer' }) : onRow}
        locale={{ emptyText: empty }}
        {...rest}
      />
    </div>
  );
}
