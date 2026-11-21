'use client';

import React, { useState } from 'react';
import { Tabs } from 'antd';
import { Users, KeyRound } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { useTabParam } from '@/components/governance/shared';
import { UsersTab, type MatchFilter } from '@/components/governance/UsersTab';
import { IdentityTab } from '@/components/governance/IdentityTab';

const TABS = ['users', 'identity'] as const;

/** Users & identity: everyone with access (account + IdP match, once each) and the identity provider set-up. */
export default function UsersIdentityPage() {
  const [tab, setTab] = useTabParam(TABS, 'users');
  // "Users to review" on the Identity tab opens Users pre-filtered; the key resets the tab's filters.
  const [usersView, setUsersView] = useState<{ n: number; match: MatchFilter }>({ n: 0, match: 'all' });

  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Users & identity"
        description="Who can use Circularity: their role, tenant scope and facility, matched to the corporate identity provider. IdP groups map to roles; mismatches are fixed here."
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as (typeof TABS)[number])}
        items={[
          { key: 'users', label: 'Users', icon: <Users size={16} />, children: <UsersTab key={usersView.n} initialMatch={usersView.match} /> },
          {
            key: 'identity',
            label: 'Identity provider',
            icon: <KeyRound size={16} />,
            children: (
              <IdentityTab
                onShowIssues={() => {
                  setUsersView((v) => ({ n: v.n + 1, match: 'issues' }));
                  setTab('users');
                }}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
