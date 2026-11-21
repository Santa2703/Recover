'use client';

import React, { useState } from 'react';
import { Tabs } from 'antd';
import { Plug, PlugZap, Wrench, CircleAlert, FilePlus2, Inbox } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { mcpService } from '@/services/mcpService';
import { MetricCard, PageActions, PageHeader } from '@/components/ui';
import { useUrlState } from '@/components/mcp/mcpUi';
import { ServersPanel } from '@/components/mcp/ServersPanel';
import { ProposalsPanel } from '@/components/mcp/ProposalsPanel';

type ServersTab = 'servers' | 'requests';

export default function McpServersPage() {
  // ?tab=requests deep link (old /mcp/proposals redirects here).
  const [url, setUrl] = useUrlState();
  const tab: ServersTab = url.get('tab') === 'requests' ? 'requests' : 'servers';
  const setTab = (t: ServersTab) => setUrl({ tab: t === 'servers' ? null : t });

  const [expanded, setExpanded] = useState<React.Key[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);

  const servers = useServiceQuery(() => mcpService.listServers(), [], { subscribe: mcpService.subscribeServers });
  const counts = useServiceQuery(() => mcpService.proposalCounts(), [], { subscribe: mcpService.subscribeProposals });
  const list = servers.data ?? [];
  const connected = list.filter((s) => s.status !== 'disconnected');
  const toolsExposed = connected.reduce((n, s) => n + s.tools.length, 0);
  const attention = list.filter((s) => s.status !== 'connected').length;
  const pending = counts.data?.pending;

  /** An approved request was connected: show the new server, expanded, on the Servers tab. */
  const showServer = (id: string) => {
    setExpanded((e) => (e.includes(id) ? e : [...e, id]));
    setTab('servers');
  };

  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Servers"
        description="Enterprise MCP servers this workbench connects to as a client, and requests to add new ones. A server's tools are offered to agents only while it is connected and the tool is granted."
        actions={
          tab === 'servers' ? (
            <PageActions
              secondary={[{ key: 'propose', label: 'Propose server', icon: <FilePlus2 />, onClick: () => {
                    setTab('requests');
                    setProposeOpen(true);
                  },
                },
              ]}
              primary={{ key: 'connect', label: 'Connect server', icon: <Plug />, onClick: () => setConnectOpen(true) }}
            />
          ) : (
            <PageActions primary={{ key: 'propose', label: 'Propose server', icon: <FilePlus2 />, onClick: () => setProposeOpen(true) }} />
          )
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard label="Connected servers" icon={<PlugZap />} iconTone="green" loading={!servers.data} value={servers.data ? `${connected.length} of ${list.length}` : ''} context="Including degraded" />
        <MetricCard label="Tools exposed" icon={<Wrench />} loading={!servers.data} value={toolsExposed} context="From connected servers" />
        <MetricCard label="Need attention" icon={<CircleAlert />} iconTone="red" loading={!servers.data} value={attention} context="Degraded or disconnected" />
        <button type="button" onClick={() => setTab('requests')} className="block w-full min-w-0 cursor-pointer rounded-2xl text-left">
          <MetricCard label="Requests to review" icon={<Inbox />} loading={!counts.data} value={pending ?? ''} context="Server proposals pending" />
        </button>
      </div>

      <section className="rounded-2xl border border-[#E2E8F0] bg-white px-5 pb-5 pt-2 shadow-2xs" aria-label="MCP servers">
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as ServersTab)}
          items={[
            {
              key: 'servers',
              label: 'Servers',
              children: <ServersPanel expanded={expanded} onExpandedChange={setExpanded} connectOpen={connectOpen} onConnectOpenChange={setConnectOpen} />,
            },
            {
              key: 'requests',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Requests
                  {!!pending && <span className="rounded-full bg-[#FFD600] px-1.5 text-[10px] font-extrabold text-[#141416]">{pending}</span>}
                </span>
              ),
              children: <ProposalsPanel proposeOpen={proposeOpen} onProposeOpenChange={setProposeOpen} onConnected={showServer} />,
            },
          ]}
        />
      </section>
    </div>
  );
}
