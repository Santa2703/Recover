'use client';

import React from 'react';
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartColors } from '@/theme/tokens';
import { useEntranceAnimation } from '@/hooks/useReducedMotion';
import { ANIMATION_MS, AXIS_TICK, ChartFrame, ChartTooltip, GRID_PROPS, defaultFormat, type ValueFormat } from './chartTheme';

export interface BarDatum {
  label: string;
  value: number;
  /** Override colour (e.g. a status bar). Defaults to neutral, highlight in brand. */
  color?: string;
  id?: string;
}

interface BarChartProps {
  data: BarDatum[];
  /** Accessible summary of what the chart shows. */
  ariaLabel: string;
  /** 'horizontal' = bars run left→right (use for long category labels). */
  orientation?: 'vertical' | 'horizontal';
  /** Label (or id) of the bar to emphasise in the brand accent. */
  highlight?: string;
  valueFormat?: ValueFormat;
  height?: number;
  /** Print the value at the end of each bar (selective labelling: fine for <= 8 bars). */
  showValueLabels?: boolean;
  showTooltip?: boolean;
  animated?: boolean;
  seriesName?: string;
  onBarClick?: (d: BarDatum) => void;
  /** Width reserved for category labels in horizontal mode. */
  labelWidth?: number;
}

export function BarChart({
  data,
  ariaLabel,
  orientation = 'vertical',
  highlight,
  valueFormat = defaultFormat,
  height = 240,
  showValueLabels = true,
  showTooltip = true,
  animated = true,
  seriesName = 'Value',
  onBarClick,
  labelWidth = 140,
}: BarChartProps) {
  const entrance = useEntranceAnimation();
  const animate = animated && entrance;
  const horizontal = orientation === 'horizontal';
  const colorFor = (d: BarDatum) =>
    d.color ?? (highlight && (d.label === highlight || d.id === highlight) ? chartColors.highlight : chartColors.neutral);

  return (
    <ChartFrame label={ariaLabel} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          margin={horizontal ? { top: 4, right: showValueLabels ? 56 : 12, bottom: 4, left: 0 } : { top: showValueLabels ? 20 : 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap={horizontal ? 6 : '22%'}
        >
          {horizontal ? (
            <>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="label" tick={{ ...AXIS_TICK, fill: 'var(--ink-2)', fontSize: 12 }} width={labelWidth} axisLine={false} tickLine={false} />
            </>
          ) : (
            <>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: chartColors.grid }} tickLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={valueFormat} />
            </>
          )}
          {showTooltip && (
            <Tooltip
              cursor={{ fill: 'rgba(24,25,27,0.04)' }}
              content={<ChartTooltip format={valueFormat} />}
              isAnimationActive={false}
            />
          )}
          <Bar
            // Remount when the entrance window ends: if the entrance animation was cut short (busy main
            // thread), recharts would otherwise never show the value labels.
            key={animate ? 'entrance' : 'static'}
            dataKey="value"
            name={seriesName}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={horizontal ? 18 : 44}
            isAnimationActive={animate}
            animationDuration={ANIMATION_MS}
            animationEasing="ease-out"
            onClick={onBarClick ? (_, i) => onBarClick(data[i]) : undefined}
            cursor={onBarClick ? 'pointer' : undefined}
          >
            {data.map((d) => (
              <Cell key={d.id ?? d.label} fill={colorFor(d)} />
            ))}
            {showValueLabels && (
              <LabelList
                dataKey="value"
                position={horizontal ? 'right' : 'top'}
                formatter={(v: unknown) => valueFormat(Number(v))}
                style={{ fill: 'var(--ink)', fontSize: 11, fontWeight: 500 }}
              />
            )}
          </Bar>
        </RBarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Horizontal bar chart: categorical comparisons with long labels. */
export function HorizontalBarChart(props: Omit<BarChartProps, 'orientation'>) {
  return <BarChart {...props} orientation="horizontal" height={props.height ?? Math.max(120, props.data.length * 34 + 16)} />;
}
