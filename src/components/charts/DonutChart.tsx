'use client';

import React from 'react';
import { Cell, Pie, PieChart as RPieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { seriesColors } from '@/theme/tokens';
import { useEntranceAnimation } from '@/hooks/useReducedMotion';
import { ANIMATION_MS, ChartFrame, ChartTooltip, defaultFormat, type ValueFormat } from './chartTheme';

export interface SliceDatum {
  label: string;
  value: number;
  color?: string;
  id?: string;
}

interface DonutChartProps {
  data: SliceDatum[];
  ariaLabel: string;
  centerValue?: React.ReactNode;
  centerLabel?: string;
  valueFormat?: ValueFormat;
  size?: number;
  /** 0 = pie. */
  innerRatio?: number;
  animated?: boolean;
  showTooltip?: boolean;
  /** Legend with value + share; always shown for >= 2 slices. */
  legend?: 'right' | 'bottom' | 'none';
  onSliceClick?: (d: SliceDatum) => void;
}

/**
 * Composition of a total with few categories (<= 6). For precise comparison use a bar chart.
 * Colours come from the validated categorical order, assigned by position, never cycled.
 */
export function DonutChart({
  data,
  ariaLabel,
  centerValue,
  centerLabel,
  valueFormat = defaultFormat,
  size = 168,
  innerRatio = 0.68,
  animated = true,
  showTooltip = true,
  legend = 'right',
  onSliceClick,
}: DonutChartProps) {
  const entrance = useEntranceAnimation();
  const animate = animated && entrance;
  const total = data.reduce((s, d) => s + d.value, 0);
  const colored = data.map((d, i) => ({ ...d, color: d.color ?? seriesColors[i] ?? seriesColors[seriesColors.length - 1] }));
  const outer = size / 2;

  return (
    <div className={`flex gap-5 ${legend === 'bottom' ? 'flex-col items-center' : 'flex-col items-center sm:flex-row sm:items-center'}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ChartFrame label={ariaLabel} height={size}>
          <ResponsiveContainer width="100%" height="100%">
            <RPieChart>
              {showTooltip && <Tooltip content={<ChartTooltip format={valueFormat} />} isAnimationActive={false} />}
              <Pie
                data={colored.filter((d) => d.value > 0)}
                dataKey="value"
                nameKey="label"
                innerRadius={outer * innerRatio}
                outerRadius={outer - 2}
                paddingAngle={innerRatio > 0 ? 1.5 : 0}
                stroke="var(--surface)"
                strokeWidth={2}
                startAngle={90}
                endAngle={-270}
                isAnimationActive={animate}
                animationDuration={ANIMATION_MS + 100}
                animationEasing="ease-out"
                onClick={onSliceClick ? (d: unknown) => onSliceClick(d as SliceDatum) : undefined}
                cursor={onSliceClick ? 'pointer' : undefined}
              >
                {colored
                  .filter((d) => d.value > 0)
                  .map((d) => (
                    <Cell key={d.id ?? d.label} fill={d.color} />
                  ))}
              </Pie>
            </RPieChart>
          </ResponsiveContainer>
        </ChartFrame>
        {innerRatio > 0 && (centerValue !== undefined || centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="tabular text-[22px] font-semibold leading-7 text-ink">{centerValue ?? valueFormat(total)}</span>
            {centerLabel && <span className="text-[11px] text-ink-2">{centerLabel}</span>}
          </div>
        )}
      </div>
      {legend !== 'none' && (
        <ul className="m-0 w-full min-w-0 flex-1 list-none space-y-1.5 p-0">
          {colored.map((d) => (
            <li key={d.id ?? d.label}>
              <button
                type="button"
                disabled={!onSliceClick}
                onClick={() => onSliceClick?.(d)}
                className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs enabled:cursor-pointer enabled:hover:bg-surface-2 disabled:cursor-default"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} />
                <span className="min-w-0 flex-1 truncate text-ink-2">{d.label}</span>
                <span className="tabular font-medium text-ink">{valueFormat(d.value)}</span>
                <span className="tabular w-10 text-right text-ink-3">{total ? Math.round((d.value / total) * 100) : 0}%</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pie: same component without the hole. Use only for 2–4 slices. */
export function PieChart(props: Omit<DonutChartProps, 'innerRatio' | 'centerValue' | 'centerLabel'>) {
  return <DonutChart {...props} innerRatio={0} />;
}
