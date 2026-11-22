'use client';

import React from 'react';
import { Tabs } from 'antd';
import { SlidersHorizontal, Bot } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { useTabParam } from '@/components/governance/shared';
import { AutonomyTab } from '@/components/governance/AutonomyTab';
import { AgentKillSwitchTab } from '@/components/governance/AgentKillSwitchTab';

const TABS = ['autonomy', 'kill'] as const;

/** Agent controls: how far agents may act per role (autonomy), per-agent stop switches, Stop all agents and the hard rules. */
export default function AgentControlsPage() {
  const [tab, setTab] = useTabParam(TABS, 'autonomy');
  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Agent controls"
        description="How far agents may act for each role, a stop switch for every agent and an emergency stop for all of them. Every change is recorded in the audit log."
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as (typeof TABS)[number])}
        items={[
          { key: 'autonomy', label: 'Autonomy', icon: <SlidersHorizontal size={16} />, children: <AutonomyTab /> },
          { key: 'kill', label: 'Agents & kill switches', icon: <Bot size={16} />, children: <AgentKillSwitchTab /> },
        ]}
      />
    </div>
  );
}
