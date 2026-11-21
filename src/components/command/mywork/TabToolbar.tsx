'use client';

import React from 'react';
import { Download } from 'lucide-react';
import { PageActions } from '@/components/ui';

/** Top row of a My work tab: what the queue is for, and its own actions (Export CSV). */
export function TabToolbar({ description, onExport, canExport }: { description: React.ReactNode; onExport: () => void; canExport: boolean }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="m-0 min-w-0 max-w-2xl text-xs leading-relaxed text-[#6B7280]">{description}</p>
      <div className="shrink-0">
        <PageActions secondary={[{ key: 'export', label: 'Export CSV', icon: <Download />, onClick: onExport, disabled: !canExport }]} />
      </div>
    </div>
  );
}
