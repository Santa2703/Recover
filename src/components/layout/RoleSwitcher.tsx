'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Dropdown, MenuProps } from 'antd';
import { useAuth } from '@/store/authContext';
import { UserRole } from '@/models/user.model';
import { USER_ROLES } from '@/constants/roles.constants';

export function RoleSwitcher() {
  const { currentRole, setRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const menuItems: MenuProps['items'] = (Object.keys(USER_ROLES) as UserRole[]).map((key) => {
    const info = USER_ROLES[key];
    return {
      key,
      label: (
        <div className="flex flex-col py-0.5">
          <span className="font-semibold text-xs text-[#1E293B]">{info.label}</span>
          <span className="text-[10px] text-[#64748B]">{info.desc}</span>
        </div>
      ),
    };
  });

  // Switching role takes you to that role's landing page (its sidebar differs too).
  const handleMenuClick: MenuProps['onClick'] = (e) => {
    const role = e.key as UserRole;
    setRole(role);
    const landing = USER_ROLES[role]?.landingPath;
    if (landing && landing !== pathname) router.push(landing);
  };

  const roleLabel = USER_ROLES[currentRole]?.label || currentRole;

  return (
    <Dropdown menu={{ items: menuItems, onClick: handleMenuClick }} trigger={['click']}>
      <button
        type="button"
        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[#E2E8F0] hover:border-[#CBD5E1] rounded-lg text-xs font-medium text-[#334155] hover:text-[#0F172A] transition-all cursor-pointer select-none"
      >
        <span>{roleLabel}</span>
        <span className="text-[11px] text-[#64748B] leading-none">▾</span>
      </button>
    </Dropdown>
  );
}
