'use client';

import React from 'react';
import { CartesianGrid, Line, LineChart as RLineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartColors } from '@/theme/tokens';
import { useEntranceAnimation } from '@/hooks/useReducedMotion';
import { ANIMATION_MS, AXIS_TICK, ChartFrame, ChartLegend, ChartTooltip, GRID_PROPS, defaultFormat, type ValueFormat } from './chartTheme';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
}

interface LineChartProps<T> {
  data: T[];
  xKey: keyof T & string;
  series: LineSeries[];
  ariaLabel: string;
  valueFormat?: ValueFormat;
  height?: number;
  /** Fix the y-domain, e.g. [0.8, 1.05] for a yield. Single axis only. */
  yDomain?: [number | 'auto', number | 'auto'];
  showTooltip?: boolean;
  animated?: boolean;
  showLegend?: boolean;
}

/** Trends over time. One y-axis; two measures of different scale belong in two charts. */
export function LineChart<T extends object>({
  data,
  xKey,
  series,
  ariaLabel,
  valueFormat = defaultFormat,
  height = 240,
  yDomain,
  showTooltip = true,
  animated = true,
  showLegend,
}: LineChartProps<T>) {
  const entrance = useEntranceAnimation();
  const animate = animated && entrance;
  const legend = showLegend ?? series.length > 1;
  return (
    <div className="flex flex-col gap-2">
      <ChartFrame label={ariaLabel} height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RLineChart data={data as Record<string, unknown>[]} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey={xKey as string} tick={AXIS_TICK} axisLine={{ stroke: chartColors.grid }} tickLine={false} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={valueFormat} domain={yDomain ?? ['auto', 'auto']} />
            {showTooltip && (
              <Tooltip
                cursor={{ stroke: chartColors.axis, strokeDasharray: '3 3' }}
                content={<ChartTooltip format={valueFormat} />}
                isAnimationActive={false}
              />
            )}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
                isAnimationActive={animate}
                animationDuration={ANIMATION_MS + 200}
                animationEasing="ease-out"
              />
            ))}
          </RLineChart>
        </ResponsiveContainer>
      </ChartFrame>
      {legend && <ChartLegend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))} />}
    </div>
  );
}
