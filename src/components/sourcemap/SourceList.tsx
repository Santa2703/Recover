'use client';

import React from 'react';
import { Tag, Tooltip } from 'antd';
import { DataTable, type DataColumn } from '@/components/ui';
import type { Source } from '@/services/sourceService';
import { STATUS_ORDER, SourceStatusPill, relTime } from './sourceMeta';

interface Props {
  sources: Source[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}

/** The original Source Map table (same information), data-driven, sortable and without sideways scroll. */
export function SourceList({ sources, selectedId, onSelect, loading }: Props) {
  const columns: DataColumn<Source>[] = [
    {
      title: 'Enterprise System',
      dataIndex: 'name',
      key: 'name',
      priority: 1,
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (v: string, s) => (
        <div className="min-w-0">
          <div className="truncate text-xs font-bold text-[#141416]">{v}</div>
          <Tag className="!mt-0.5 font-mono text-[10px] font-semibold">{s.connectorType}</Tag>
        </div>
      ),
    },
    {
      title: 'Primary Data Responsibility',
      dataIndex: 'role',
      key: 'role',
      priority: 3,
      ellipsis: { showTitle: false },
      sorter: (a, b) => a.role.localeCompare(b.role),
      render: (v: string) => (
        <Tooltip title={v}>
          <span className="text-xs text-[#334155]">{v}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Sync Method',
      dataIndex: 'syncMethod',
      key: 'syncMethod',
      priority: 3,
      sorter: (a, b) => a.syncMethod.localeCompare(b.syncMethod),
      render: (v: string) => <span className="font-mono text-xs text-[#64748B]">{v}</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      priority: 1,
      ellipsis: false,
      sorter: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
      render: (_: unknown, s) => <SourceStatusPill status={s.status} />,
    },
    {
      title: 'Last Activity',
      dataIndex: 'lastSyncAt',
      key: 'lastSyncAt',
      priority: 2,
      sorter: (a, b) => Date.parse(a.lastSyncAt) - Date.parse(b.lastSyncAt),
      render: (_: unknown, s) => (
        <span className="font-mono text-xs text-[#475569]" title={s.statusNote || undefined}>
          {relTime(s.lastSyncAt)}
          {s.statusNote && <span className="text-[#94A3B8]"> ({s.statusNote})</span>}
        </span>
      ),
    },
  ];

  return (
    <div className="min-w-0 p-3">
      <DataTable<Source>
        rowKey="id"
        columns={columns}
        dataSource={sources}
        initialLoading={loading}
        pagination={false}
        onRowClick={(s) => onSelect(s.id)}
        rowClassName={(s) => (s.id === selectedId ? '[&>td]:!bg-[#FFFBEB]' : '')}
      />
    </div>
  );
}
