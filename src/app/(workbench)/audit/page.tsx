'use client';

import React from 'react';
import { Tabs } from 'antd';
import { ScrollText, FileWarning, ListChecks } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { useTabParam } from '@/components/governance/shared';
import { AuditLogTab } from '@/components/governance/AuditLogTab';
import { EvidenceGapsTab } from '@/components/governance/EvidenceGapsTab';
import { DataChecksTab } from '@/components/governance/DataChecksTab';

const TABS = ['log', 'gaps', 'checks'] as const;

/** Audit log: the hash-chained event log, the evidence still missing for cases at step 1, and the data checks. */
export default function AuditPage() {
  const [tab, setTab] = useTabParam(TABS, 'log');
  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Audit log"
        description="Every record fetch, automated decision and human override, newest first and chained by hash, plus the evidence still missing for cases at step 1 and the checks that every number reconciles."
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as (typeof TABS)[number])}
        items={[
          { key: 'log', label: 'Log', icon: <ScrollText size={16} />, children: <AuditLogTab /> },
          { key: 'gaps', label: 'Evidence gaps', icon: <FileWarning size={16} />, children: <EvidenceGapsTab /> },
          { key: 'checks', label: 'Data checks', icon: <ListChecks size={16} />, children: <DataChecksTab /> },
        ]}
      />
    </div>
  );
}
