import React from 'react';
import { Server, Shuffle, Wrench } from 'lucide-react';
import type { McpCallRow } from '@/services/mcpService';
import { ago } from '@/services/dashboardService';

const RESULT: Record<McpCallRow['result'], { label: string; color: string }> = {
  success: { label: 'Completed successfully', color: '#10B981' },
  held: { label: 'Held for approval', color: '#F59E0B' },
  error: { label: 'Failed', color: '#EF4444' },
  denied: { label: 'Denied by policy', color: '#EF4444' },
  rejected: { label: 'Rejected by reviewer', color: '#94A3B8' },
};

function ServerIcon({ server }: { server: string }) {
  if (/solver/i.test(server)) return <Wrench size={14} className="text-gray-600" />;
  if (/ERP|WMS|EAM/.test(server)) return <Server size={14} className="text-gray-600" />;
  return <Shuffle size={14} className="text-gray-600" />;
}

/** Recent agent tool calls (agent, tool, result, time), in the original Agent Activity look. */
export function AgentActivityList({ calls }: { calls: McpCallRow[] }) {
  return (
    <ul className="m-0 list-none divide-y divide-[#F3F4F6] p-0">
      {calls.map((c) => {
        const r = RESULT[c.result];
        return (
          <li key={c.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="flex min-w-0 items-center gap-3">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E5E7EB] bg-[#F9FAFB]">
                <ServerIcon server={c.server} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-[#111827]">{c.agentName}</div>
                <div className="mt-0.5 truncate text-[11px] text-[#6B7280]">
                  {c.toolName} · {c.server}
                  {c.caseId ? ` · ${c.caseId}` : ''}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: r.color }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.color }} />
                  <span>{r.label}</span>
                </div>
              </div>
            </div>
            <div className="shrink-0 text-right text-[11px] font-medium text-[#9CA3AF]">{ago(c.ts)}</div>
          </li>
        );
      })}
    </ul>
  );
}
