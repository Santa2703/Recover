import React from 'react';
import { WorkbenchLayout } from '@/components/layout/WorkbenchLayout';

export default function WorkbenchRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkbenchLayout>{children}</WorkbenchLayout>;
}
