'use client';

import React, { useMemo, useState } from 'react';
import { Input } from 'antd';
import { ChevronDown, ChevronRight, Search, Table2 } from 'lucide-react';
import type { Source } from '@/services/sourceService';
import { ListSkeleton } from '@/components/ui';
import { StatusDot, SystemMark, fmtNum } from './sourceMeta';

interface Props {
  sources: Source[] | undefined;
  categories: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}

export function SystemsTree({ sources, categories, selectedId, onSelect, loading }: Props) {
  const [tab, setTab] = useState<'systems' | 'tables'>('systems');
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const term = q.trim().toLowerCase();

  const groups = useMemo(() => {
    const rows = (sources ?? []).filter((s) => !term || `${s.name} ${s.vendor} ${s.connectorType}`.toLowerCase().includes(term));
    return categories
      .map((c) => ({ category: c, items: rows.filter((s) => s.category === c) }))
      .filter((g) => g.items.length);
  }, [sources, categories, term]);

  const tables = useMemo(
    () =>
      (sources ?? [])
        .flatMap((s) => s.tables.map((t) => ({ ...t, source: s })))
        .filter((t) => !term || `${t.name} ${t.label} ${t.source.name}`.toLowerCase().includes(term))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [sources, term],
  );

  const tableCount = (sources ?? []).reduce((n, s) => n + s.tables.length, 0);

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-[#E2E8F0] bg-white shadow-2xs max-xl:max-h-[440px] xl:max-h-[760px]">
      <div className="flex gap-4 border-b border-[#F1F5F9] px-4 pt-3" role="tablist">
        {(
          [
            ['systems', 'Systems', sources?.length ?? 0],
            ['tables', 'Tables', tableCount],
          ] as const
        ).map(([key, label, n]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px flex cursor-pointer items-center gap-1.5 border-0 border-b-2 bg-transparent px-0 pb-2.5 text-xs font-bold ${
              tab === key ? 'border-[#FFD600] text-[#141416]' : 'border-transparent text-[#64748B] hover:text-[#141416]'
            }`}
          >
            {label}
            <span className="rounded-full bg-[#F1F5F9] px-1.5 py-px font-mono text-[10px] font-semibold text-[#475569]">{n}</span>
          </button>
        ))}
      </div>
      <div className="p-3 pb-2">
        <Input
          allowClear
          size="small"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tab === 'systems' ? 'Search systems' : 'Search tables'}
          prefix={<Search size={13} className="text-[#94A3B8]" />}
          aria-label={tab === 'systems' ? 'Search systems' : 'Search tables'}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="p-2">
            <ListSkeleton rows={6} />
          </div>
        ) : tab === 'systems' ? (
          groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-[#94A3B8]">No systems match.</p>
          ) : (
            groups.map((g) => {
              const open = !collapsed[g.category];
              return (
                <div key={g.category} className="mb-1">
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [g.category]: open }))}
                    aria-expanded={open}
                    className="flex w-full cursor-pointer items-center gap-1 rounded-lg border-0 bg-transparent px-1.5 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-[#64748B] hover:bg-[#F8FAFC]"
                  >
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    {g.category}
                    <span className="ml-auto font-mono text-[10px] font-semibold text-[#94A3B8]">{g.items.length}</span>
                  </button>
                  {open &&
                    g.items.map((s) => {
                      const active = s.id === selectedId;
                      return (
                        <button
                          key={s.id}
                          onClick={() => onSelect(s.id)}
                          aria-current={active}
                          className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs ${
                            active ? 'border-[#FDE68A] bg-[#FFFBEB] font-bold text-[#141416]' : 'border-transparent bg-transparent text-[#334155] hover:bg-[#F8FAFC]'
                          }`}
                        >
                          <StatusDot status={s.status} />
                          <SystemMark name={s.name} size={18} />
                          <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        </button>
                      );
                    })}
                </div>
              );
            })
          )
        ) : tables.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[#94A3B8]">No tables match.</p>
        ) : (
          tables.map((t) => (
            <button
              key={`${t.source.id}:${t.name}`}
              onClick={() => onSelect(t.source.id)}
              className={`flex w-full cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5 text-left text-xs ${
                t.source.id === selectedId ? 'border-[#FDE68A] bg-[#FFFBEB]' : 'border-transparent bg-transparent hover:bg-[#F8FAFC]'
              }`}
            >
              <Table2 size={13} className="mt-0.5 shrink-0 text-[#94A3B8]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11px] font-semibold text-[#141416]">{t.name}</span>
                <span className="block truncate text-[11px] text-[#94A3B8]">
                  {t.source.name} · {fmtNum(t.rows)} rows
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
