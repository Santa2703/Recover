'use client';

import React from 'react';
import { Tabs } from 'antd';
import { ClipboardCheck, ListChecks, ListOrdered, ShieldCheck, Truck } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { commandService, subscribeNav } from '@/services/commandService';
import { metricsService } from '@/services/metricsService';
import { PageActions, PageHeader } from '@/components/ui';
import { formatAsOf } from '@/components/command/commandUtils';
import { useMyWorkTab, type MyWorkTab } from '@/components/command/mywork/myWorkTabs';
import { TasksTab } from '@/components/command/mywork/TasksTab';
import { ApprovalsTab } from '@/components/command/mywork/ApprovalsTab';
import { OutcomesTab } from '@/components/command/mywork/OutcomesTab';
import { HandedOffTab } from '@/components/command/mywork/HandedOffTab';
import { PrioritiseTab } from '@/components/command/mywork/PrioritiseTab';

/** Count on a tab label: same yellow pill as the sidebar's "work waiting on you" badges. */
function CountPill({ count, label }: { count: number; label: string }) {
  if (!count) return null;
  return (
    <span
      aria-label={`${count} ${label}`}
      className="ml-1.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-[#FFD600] px-1.5 text-[10px] font-extrabold text-[#000000] shadow-sm"
    >
      {count}
    </span>
  );
}

/**
 * My work: the one inbox. Tasks, Approvals, Outcomes to confirm, Handed off and Prioritise are tabs
 * (`?tab=`), shown per role. Each tab carries its own filters and Export.
 */
export default function MyWorkPage() {
  const { currentRole, currentTenant, scope } = useAuth();
  const { tab, tabs, setTab } = useMyWorkTab(currentRole);

  // Same counts the sidebar badges show, plus the outcomes still to confirm.
  const { data: counts } = useServiceQuery(() => commandService.navCounts(currentRole, currentTenant, scope), [currentRole, currentTenant, scope.tenant, scope.site], {
    subscribe: subscribeNav,
  });
  const { data: openOutcomes } = useServiceQuery(() => commandService.outcomes({ status: 'open' }, scope), [scope.tenant, scope.site], {
    subscribe: commandService.subscribe,
  });

  const ALL: Record<MyWorkTab, { label: React.ReactNode; icon: React.ReactNode; children: React.ReactNode }> = {
    tasks: {
      label: (
        <>
          Tasks
          <CountPill count={counts?.actions ?? 0} label="open tasks" />
        </>
      ),
      icon: <ListChecks size={16} />,
      children: <TasksTab />,
    },
    approvals: {
      label: (
        <>
          Approvals
          <CountPill count={counts?.approvals ?? 0} label="awaiting approval" />
        </>
      ),
      icon: <ShieldCheck size={16} />,
      children: <ApprovalsTab onShowHandedOff={tabs.includes('handed-off') ? () => setTab('handed-off') : undefined} />,
    },
    outcomes: {
      label: (
        <>
          Outcomes to confirm
          <CountPill count={openOutcomes?.length ?? 0} label="outcomes to confirm" />
        </>
      ),
      icon: <ClipboardCheck size={16} />,
      children: <OutcomesTab />,
    },
    'handed-off': { label: 'Handed off', icon: <Truck size={16} />, children: <HandedOffTab /> },
    prioritise: { label: 'Prioritise', icon: <ListOrdered size={16} />, children: <PrioritiseTab /> },
  };

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <PageHeader
        title="My work"
        description={`Everything waiting on the ${currentRole} role, in one place: open a tab, work the queue, and each case brings you back here.`}
        actions={<PageActions meta={`As of ${formatAsOf(metricsService.meta().asOf)}`} />}
      />
      {/* A role with a single queue (e.g. Warehouse Manager, Finance) gets it without a one-tab bar. */}
      {tabs.length > 1 ? <Tabs activeKey={tab} onChange={setTab} destroyOnHidden items={tabs.map((key) => ({ key, ...ALL[key] }))} /> : ALL[tab].children}
    </div>
  );
}
