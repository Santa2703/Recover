'use client';

import React from 'react';
import Link from 'next/link';
import { Drawer, Switch, message } from 'antd';
import { Wrench, Play, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { mcpService } from '@/services/mcpService';
import { CaseLink, ListSkeleton } from '@/components/ui';
import { Btn, FactGrid, JsonBlock, ResultPill, RiskPill, ScopeTag, SectionLabel, TitleWithIcon, fmtMs, relTime } from './mcpUi';

export function ToolDetailDrawer({ toolId, onClose, onTest }: { toolId: string | null; onClose: () => void; onTest: (toolId: string) => void }) {
  const [toggling, setToggling] = React.useState(false);
  const { data, initialLoading } = useServiceQuery(() => (toolId ? mcpService.toolDetail(toolId) : Promise.resolve(null)), [toolId], {
    subscribe: mcpService.subscribeTools,
  });
  const detail = toolId && data?.tool.id === toolId ? data : null;
  const tool = detail?.tool;

  const toggle = async (enabled: boolean) => {
    if (!tool) return;
    setToggling(true);
    try {
      await mcpService.setToolEnabled(tool.id, enabled);
      message.success(`${tool.name} ${enabled ? 'enabled' : 'disabled'}`);
    } finally {
      setToggling(false);
    }
  };

  return (
    <Drawer
      open={!!toolId}
      onClose={onClose}
      size={600}
      destroyOnHidden
      title={
        tool ? (
          <TitleWithIcon icon={<Wrench />} title={<span className="font-mono">{tool.name}</span>} sub={`${tool.server} · MCP tool`} />
        ) : (
          'Tool'
        )
      }
      footer={
        tool && (
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#141416]">
              <Switch size="small" checked={tool.enabled} loading={toggling} onChange={toggle} aria-label="Enable tool" />
              {tool.enabled ? 'Enabled for agents' : 'Disabled'}
            </label>
            <Btn variant="primary" icon={<Play className="w-3.5 h-3.5" />} onClick={() => onTest(tool.id)}>
              Test in playground
            </Btn>
          </div>
        )
      }
    >
      {initialLoading || !detail || !tool ? (
        <ListSkeleton rows={6} />
      ) : (
        <div className="space-y-5 text-xs">
          <p className="m-0 text-xs leading-relaxed text-[#475569]">{tool.description}</p>

          <FactGrid
            items={[
              { label: 'Safety scope', value: <ScopeTag scope={tool.scope} /> },
              { label: 'Risk classification', value: <RiskPill risk={tool.risk} /> },
              {
                label: 'Approval required',
                value: tool.approvalRequired ? (
                  <span className="inline-flex items-center gap-1 text-[#D97706]">
                    <ShieldAlert className="w-3.5 h-3.5" /> Yes, write gate
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[#059669]">
                    <ShieldCheck className="w-3.5 h-3.5" /> No
                  </span>
                ),
              },
              { label: 'Avg latency', value: <span className="font-mono">{fmtMs(tool.avgLatencyMs)}</span> },
              {
                label: 'Used by agents',
                value: (
                  <span>
                    {detail.agents.length ? detail.agents.map((a) => a.name).join(', ') : 'None'}
                    <Link href="/mcp/agents?tab=permissions" className="ml-1.5 text-[11px] font-semibold text-[#0284C7] hover:underline">
                      Permissions per agent and tenant
                    </Link>
                  </span>
                ),
              },
            ]}
          />

          <div>
            <SectionLabel>Input schema</SectionLabel>
            <JsonBlock value={tool.inputSchema} maxHeight={220} />
          </div>
          <div>
            <SectionLabel>Output schema</SectionLabel>
            <JsonBlock value={tool.outputSchema} maxHeight={200} />
          </div>

          <div>
            <SectionLabel>Recent executions</SectionLabel>
            {detail.recent.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#E2E8F0] p-4 text-center text-[#94A3B8]">No executions recorded yet.</div>
            ) : (
              <div className="divide-y divide-[#F1F5F9] overflow-hidden rounded-xl border border-[#E2E8F0]">
                {detail.recent.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-[#F8FAFC]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#141416] truncate">{c.agentName}</span>
                        <span className="text-[11px] text-[#94A3B8]">{c.tenant}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#64748B]">
                        <span>{relTime(c.ts)}</span>
                        {c.caseId && <CaseLink id={c.caseId} />}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[11px] text-[#64748B]">{fmtMs(c.latencyMs)}</span>
                      <ResultPill result={c.result} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
