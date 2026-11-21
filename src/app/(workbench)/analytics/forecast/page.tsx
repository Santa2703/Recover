'use client';

import React from 'react';
import { Tabs } from 'antd';
import { Download } from 'lucide-react';
import { PageActions, PageHeader } from '@/components/ui';
import { useTabExporter, useTabParam } from '@/components/analytics/useTabParam';
import { AccuracyTab } from '@/components/analytics/forecast/AccuracyTab';
import { OverridesTab } from '@/components/analytics/forecast/OverridesTab';
import { ModelsTab } from '@/components/analytics/forecast/ModelsTab';

const TABS = ['accuracy', 'overrides', 'models'] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABEL: Record<TabKey, string> = { accuracy: 'Accuracy', overrides: 'Overrides', models: 'Models' };
const EXPORT_LABEL: Record<TabKey, string> = { accuracy: 'Export decisions', overrides: 'Export override log', models: 'Export model registry' };

/** Forecast quality: how good the forecasts were, where owners overrode them, and which model versions produced them. */
export default function ForecastQualityPage() {
  const [tab, setTab] = useTabParam<TabKey>(TABS, 'accuracy');
  const [exporter, registerExport] = useTabExporter();

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      <PageHeader
        title="Forecast quality"
        description="How closely forecast net matched realised net, where route owners overrode Circularity and how that turned out, and which model versions are behind the forecasts."
        actions={
          <PageActions
            secondary={[{ key: 'export', label: EXPORT_LABEL[tab], icon: <Download />, onClick: () => exporter?.(), disabled: !exporter }]}
            meta={tab === 'models' ? undefined : 'Decisions closed in the last 60 days'}
          />
        }
      />

      <Tabs
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden
        items={[
          { key: 'accuracy', label: TAB_LABEL.accuracy, children: <AccuracyTab registerExport={registerExport} onShowOverrides={() => setTab('overrides')} /> },
          { key: 'overrides', label: TAB_LABEL.overrides, children: <OverridesTab registerExport={registerExport} /> },
          { key: 'models', label: TAB_LABEL.models, children: <ModelsTab registerExport={registerExport} /> },
        ]}
      />
    </div>
  );
}
