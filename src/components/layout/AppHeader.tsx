'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Layout } from 'antd';
import { Menu } from 'lucide-react';
import { TenantSelector } from './TenantSelector';
import { RoleSwitcher } from './RoleSwitcher';
import { useAuth, SESSION_USER } from '@/store/authContext';
import { breadcrumbFor } from '@/constants/navigation.constants';

const { Header } = Layout;

export function AppHeader({ onOpenMenu }: { onOpenMenu?: () => void } = {}) {
  const pathname = usePathname() || '/dashboard';
  const { user } = useAuth();

  // Breadcrumb mirrors the sidebar: section name / item name (same labels, same tree).
  const breadcrumbs = breadcrumbFor(pathname);

  return (
    <Header
      style={{
        background: '#FFFFFF',
        borderBottom: '1px solid #E2E8F0',
        padding: '0 16px',
        height: 56,
        lineHeight: '56px',
      }}
      className="flex items-center justify-between gap-3 sticky top-0 z-40 md:!px-6"
    >
      {/* 1. Left: menu button (tablet/phone) + Breadcrumb: Bold Primary / Light Secondary */}
      <div className="flex items-center gap-2 min-w-0 text-sm font-sans select-none">
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation"
            className="w-8 h-8 shrink-0 rounded-lg border border-[#E2E8F0] bg-white text-[#334155] hover:border-[#CBD5E1] flex items-center justify-center cursor-pointer"
          >
            <Menu size={16} />
          </button>
        )}
        <span className="hidden sm:inline font-bold text-[#0F172A] tracking-tight text-[15px] truncate">
          {breadcrumbs.primary}
        </span>
        <span className="hidden sm:inline mx-0.5 text-[#94A3B8] font-light">/</span>
        <span className="text-[#64748B] font-medium text-[14px] truncate">
          {breadcrumbs.secondary}
        </span>
      </div>

      {/* 2. Right Controls: Customer Selector, Role Switcher, Initials Avatar */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <TenantSelector />
        <RoleSwitcher />

        {/* User Initials Avatar Circle */}
        <div
          title={user.name}
          aria-label={`Signed in as ${user.name}`}
          className="hidden sm:flex w-8 h-8 rounded-full bg-[#F1F5F9] text-[#334155] border border-[#E2E8F0] items-center justify-center font-bold text-xs select-none shadow-2xs"
        >
          {SESSION_USER.initials}
        </div>
      </div>
    </Header>
  );
}
