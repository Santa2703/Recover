'use client';

import React from 'react';
import { Bar, BarChart as RBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartColors, seriesColors } from '@/theme/tokens';
import { useEntranceAnimation } from '@/hooks/useReducedMotion';
import { ANIMATION_MS, AXIS_TICK, ChartFrame, ChartLegend, ChartTooltip, GRID_PROPS, defaultFormat, type ValueFormat } from './chartTheme';

export interface StackSeries {
  key: string;
  label: string;
  color?: string;
}

interface StackedBarChartProps<T> {
  data: T[];
  xKey: keyof T & string;
  series: StackSeries[];
  ariaLabel: string;
  valueFormat?: ValueFormat;
  height?: number;
  orientation?: 'vertical' | 'horizontal';
  /** Grouped (side-by-side) instead of stacked. */
  grouped?: boolean;
  animated?: boolean;
  showTooltip?: boolean;
  /** Click on any bar of a category (drill-down); receives that category's row. */
  onBarClick?: (row: T) => void;
}

/** Composition across groups (stacked) or two measures side by side (grouped). */
export function StackedBarChart<T extends object>({
  data,
  xKey,
  series,
  ariaLabel,
  valueFormat = defaultFormat,
  height = 260,
  orientation = 'vertical',
  grouped,
  animated = true,
  showTooltip = true,
  onBarClick,
}: StackedBarChartProps<T>) {
  const entrance = useEntranceAnimation();
  const animate = animated && entrance;
  const horizontal = orientation === 'horizontal';
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? seriesColors[i] }));
  return (
    <div className="flex flex-col gap-2">
      <ChartFrame label={ariaLabel} height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RBarChart
            data={data as Record<string, unknown>[]}
            layout={horizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            barGap={grouped ? 2 : 0}
            barCategoryGap={grouped ? '24%' : '28%'}
          >
            <CartesianGrid {...GRID_PROPS} vertical={horizontal} horizontal={!horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={valueFormat} />
                <YAxis type="category" dataKey={xKey as string} tick={{ ...AXIS_TICK, fill: 'var(--ink-2)', fontSize: 12 }} width={120} axisLine={false} tickLine={false} />
              </>
            ) : (
              <>
                <XAxis dataKey={xKey as string} tick={AXIS_TICK} axisLine={{ stroke: chartColors.grid }} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={valueFormat} />
              </>
            )}
            {showTooltip && <Tooltip cursor={{ fill: 'rgba(24,25,27,0.04)' }} content={<ChartTooltip format={valueFormat} />} isAnimationActive={false} />}
            {colored.map((s, i) => {
              const last = i === colored.length - 1;
              const radius: [number, number, number, number] = grouped || last ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : [0, 0, 0, 0];
              return (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId={grouped ? undefined : 'stack'}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={grouped ? 0 : 1}
                  radius={radius}
                  maxBarSize={grouped ? 22 : 40}
                  isAnimationActive={animate}
                  animationDuration={ANIMATION_MS}
                  animationEasing="ease-out"
                  onClick={onBarClick ? (_, idx) => data[idx] && onBarClick(data[idx]) : undefined}
                  cursor={onBarClick ? 'pointer' : undefined}
                />
              );
            })}
          </RBarChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartLegend items={colored.map((s) => ({ label: s.label, color: s.color! }))} />
    </div>
  );
}
