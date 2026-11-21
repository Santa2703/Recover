'use client';

import React from 'react';
import { Dropdown, MenuProps } from 'antd';
import { useAuth } from '@/store/authContext';

export function TenantSelector() {
  const { currentTenant, setTenant } = useAuth();

  const tenantLabels: Record<string, string> = {
    'Customer A': 'Customer A · Northfield',
    'Customer B': 'Customer B · Midwest Hub',
    'Customer C': 'Customer C · Eastern Fleet',
    'All': 'All Customer Tenants',
  };

  const menuItems: MenuProps['items'] = [
    { key: 'Customer A', label: 'Customer A · Northfield' },
    { key: 'Customer B', label: 'Customer B · Midwest Hub' },
    { key: 'Customer C', label: 'Customer C · Eastern Fleet' },
    { type: 'divider' },
    { key: 'All', label: 'All Customer Tenants' },
  ];

  const handleMenuClick: MenuProps['onClick'] = (e) => {
    setTenant(e.key);
  };

  const displayLabel = tenantLabels[currentTenant] || `${currentTenant} · Northfield`;

  return (
    <Dropdown menu={{ items: menuItems, onClick: handleMenuClick }} trigger={['click']}>
      <button
        type="button"
        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[#E2E8F0] hover:border-[#CBD5E1] rounded-lg text-xs font-medium text-[#334155] hover:text-[#0F172A] transition-all cursor-pointer select-none max-w-[150px] sm:max-w-none"
      >
        <span className="truncate">{displayLabel}</span>
        <span className="text-[11px] text-[#64748B] leading-none">▾</span>
      </button>
    </Dropdown>
  );
}
