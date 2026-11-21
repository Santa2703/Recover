'use client';

import React from 'react';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider } from 'antd';
import { antdThemeTokens } from '@/theme/antdTheme';

// The app calls antd's static `message` / `Modal.confirm` (see docs/ui-build-guide.md). Without a
// holder they render outside the ConfigProvider and antd logs "Static function can not consume
// context" (Next dev shows it as "1 Issue"). holderRender wraps them in the same theme.
ConfigProvider.config({
  holderRender: (children) => <ConfigProvider theme={antdThemeTokens}>{children}</ConfigProvider>,
});

export function AntdProvider({ children }: { children: React.ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider theme={antdThemeTokens}>
        {children}
      </ConfigProvider>
    </AntdRegistry>
  );
}
