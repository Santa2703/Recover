'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Drawer, Layout } from 'antd';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { AuthProvider } from '@/store/authContext';
import { BREAKPOINTS, useMediaQuery } from '@/hooks/useMediaQuery';
import { AutoTooltip } from '@/components/ui/AutoTooltip';

const { Content } = Layout;

export function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // >= 1024px: docked sidebar (icon rail below 1280px). < 1024px: slide-out drawer from the header menu button.
  const isDesktop = useMediaQuery(BREAKPOINTS.desktop);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer after navigating (adjusting state during render on route change)
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    if (drawerOpen) setDrawerOpen(false);
  }

  return (
    <AuthProvider>
      <Layout className="h-screen w-screen overflow-hidden flex flex-row">
        {isDesktop && <AppSidebar />}
        {!isDesktop && (
          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            placement="left"
            size={260}
            closable={false}
            styles={{ body: { padding: 0, backgroundColor: '#0C0D0E' } }}
          >
            <AppSidebar variant="drawer" />
          </Drawer>
        )}
        <Layout className="h-screen flex flex-col flex-1 overflow-hidden min-w-0 bg-[#F8F9FA]">
          <AppHeader onOpenMenu={isDesktop ? undefined : () => setDrawerOpen(true)} />
          <Content className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain no-scrollbar p-4 md:p-6 lg:px-8 min-w-0">
            <div className="w-full max-w-[1560px] mx-auto min-w-0">
              {children}
            </div>
          </Content>
        </Layout>
      </Layout>
      {/* Full text on hover/focus for anything cut off with an ellipsis, app-wide. */}
      <AutoTooltip />
    </AuthProvider>
  );
}
