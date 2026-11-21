'use client';

import React from 'react';
import { Activity, Cpu } from 'lucide-react';
import type { CaseRecord } from '@/models/domain.model';
import type { AssetDetail } from '@/services/productService';
import { LineChart } from '@/components/charts';
import { ProgressBar, StatusBadge } from '@/components/ui';
import { chartColors } from '@/theme/tokens';
import { money, num } from '@/utils/format';

const scoreTone = (score: number) => (score > 75 ? 'success' : score > 50 ? 'warning' : 'danger');

/** Health trend, component wear and model predictions for one asset. Used in the case workspace and the intelligence drawer. */
export function AssetCondition({ record, detail, compact }: { record: CaseRecord; detail: AssetDetail; compact?: boolean }) {
  const { signals, telemetry, components } = detail;
  return (
    <div className={`grid grid-cols-1 gap-6 ${compact ? '' : 'xl:grid-cols-2'}`}>
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 flex items-center gap-1.5 text-xs font-extrabold text-[#141416]">
            <Activity className="h-3.5 w-3.5 text-amber-500" /> Health index, last 12 months
          </h3>
          <span className="text-[11px] text-[#64748B]">
            {num(signals.operatingHours)} operating hrs · {record.facts.ageYears} yrs in service
          </span>
        </div>
        <LineChart
          data={telemetry}
          xKey="month"
          series={[
            { key: 'health', label: record.id, color: chartColors.actual },
            { key: 'fleet', label: `${record.category} median`, color: chartColors.predicted, dashed: true },
          ]}
          yDomain={[0, 100]}
          height={compact ? 180 : 220}
          ariaLabel={`Health index of ${record.id} over 12 months, ending at ${signals.conditionScore} of 100`}
        />
        <dl className="m-0 mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="mb-1 text-[11px] font-semibold text-[#64748B]">Predicted failure risk</dt>
            <dd className="m-0">
              <ProgressBar
                value={record.predictions.failureRiskScore * 100}
                tone={record.predictions.failureRiskScore > 0.5 ? 'danger' : record.predictions.failureRiskScore > 0.25 ? 'warning' : 'success'}
                label="Predicted failure risk"
                showValue
              />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="mb-1 text-[11px] font-semibold text-[#64748B]">Resale demand</dt>
            <dd className="m-0">
              <ProgressBar value={record.predictions.resaleDemandScore * 100} tone="ink" label="Resale demand score" showValue />
            </dd>
          </div>
        </dl>
      </div>

      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 flex items-center gap-1.5 text-xs font-extrabold text-[#141416]">
            <Cpu className="h-3.5 w-3.5 text-amber-500" /> Components (bill of materials)
          </h3>
          <StatusBadge tone={scoreTone(signals.conditionScore)}>Condition {signals.conditionScore}/100</StatusBadge>
        </div>
        <ul className="m-0 list-none divide-y divide-[#F1F5F9] p-0">
          {components.map((c) => (
            <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 text-xs">
              <div className="min-w-0">
                <div className="truncate font-semibold text-[#141416]">{c.name}</div>
                <div className="mt-1 max-w-56">
                  <ProgressBar value={c.wear} tone={c.wear > 70 ? 'danger' : c.wear > 45 ? 'warning' : 'success'} label={`${c.name} wear`} showValue />
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono font-bold text-[#141416]">{money(c.value)}</div>
                <div className="text-[11px] text-[#64748B]">{c.harvestable ? 'Harvestable' : 'Worn'}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-2 text-[11px] text-[#94A3B8]">Bar shows wear; value is the part&apos;s harvest value at current wear.</p>
      </div>
    </div>
  );
}
