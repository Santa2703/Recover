'use client';

import React from 'react';
import type { CanonicalModelRef, Source } from '@/services/sourceService';
import { StatusDot } from './sourceMeta';

interface Props {
  sources: Source[];
  models: CanonicalModelRef[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Systems × canonical models; each cell is the number of mapped fields. */
export function SourceMatrix({ sources, models, selectedId, onSelect }: Props) {
  const counts = sources.map((s) => {
    const c: Record<string, number> = {};
    for (const m of s.fieldMappings) c[m.canonicalModel] = (c[m.canonicalModel] ?? 0) + 1;
    return c;
  });
  const max = Math.max(1, ...counts.flatMap((c) => Object.values(c)));
  const totals = models.map((m) => counts.reduce((n, c) => n + (c[m.id] ?? 0), 0));

  return (
    <div className="max-h-[680px] min-w-0 overflow-y-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-[#F1F5F9]">
            <th className="sticky left-0 bg-white px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[#64748B]">System</th>
            {models.map((m) => (
              <th key={m.id} className="break-words px-1.5 py-2.5 text-center align-bottom text-[10px] font-bold uppercase leading-tight tracking-wider text-[#64748B]">
                {m.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.map((s, i) => {
            const active = s.id === selectedId;
            return (
              <tr key={s.id} className={`border-b border-[#F8FAFC] ${active ? 'bg-[#FFFBEB]' : 'hover:bg-[#F8FAFC]'}`}>
                <th scope="row" className={`sticky left-0 px-3 py-1.5 text-left font-semibold ${active ? 'bg-[#FFFBEB]' : 'bg-white'}`}>
                  <button onClick={() => onSelect(s.id)} className="flex max-w-[180px] cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-xs font-semibold text-[#141416]">
                    <StatusDot status={s.status} />
                    <span className="truncate">{s.name}</span>
                  </button>
                </th>
                {models.map((m) => {
                  const n = counts[i][m.id] ?? 0;
                  const alpha = n ? 0.15 + (n / max) * 0.75 : 0;
                  return (
                    <td key={m.id} className="px-1 py-1 text-center">
                      <button
                        onClick={() => onSelect(s.id)}
                        aria-label={`${s.name}: ${n} fields mapped to ${m.name}`}
                        className="h-7 w-full min-w-9 cursor-pointer rounded-md border border-[#F1F5F9] font-mono text-[11px] font-bold hover:border-gray-400"
                        style={{
                          backgroundColor: n ? `rgba(255, 214, 0, ${alpha})` : '#FFFFFF',
                          color: n ? '#141416' : '#CBD5E1',
                        }}
                      >
                        {n || '–'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-[#E2E8F0]">
            <th className="sticky left-0 bg-white px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-[#64748B]">Total fields</th>
            {totals.map((t, i) => (
              <td key={models[i].id} className="px-1 py-2 text-center font-mono text-[11px] font-black text-[#141416]">
                {t}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
