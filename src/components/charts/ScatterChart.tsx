'use client';

import React from 'react';
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart as RScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartColors, seriesColors } from '@/theme/tokens';
import { useEntranceAnimation } from '@/hooks/useReducedMotion';
import { ANIMATION_MS, AXIS_TICK, ChartFrame, ChartLegend, GRID_PROPS, defaultFormat, type ValueFormat } from './chartTheme';

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  /** Tooltip title (defaults to the id). */
  label?: string;
}

export interface ScatterSeries {
  key: string;
  label: string;
  color?: string;
  data: ScatterPoint[];
}

interface ScatterChartProps {
  series: ScatterSeries[];
  ariaLabel: string;
  xLabel: string;
  yLabel: string;
  valueFormat?: ValueFormat;
  height?: number;
  /** Dashed y = x line (e.g. "perfect forecast"); the string is its legend label. */
  identityLine?: string;
  onPointClick?: (p: ScatterPoint, series: ScatterSeries) => void;
  animated?: boolean;
}

function ScatterTooltip({
  active,
  payload,
  xLabel,
  yLabel,
  format,
}: {
  active?: boolean;
  payload?: { payload?: ScatterPoint & { series?: string } }[];
  xLabel: string;
  yLabel: string;
  format: ValueFormat;
}) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="min-w-[160px] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-[0_4px_16px_rgba(24,25,27,0.08)]">
      <div className="mb-1 font-medium text-ink">{p.label ?? p.id}</div>
      {p.series && <div className="mb-1 text-ink-2">{p.series}</div>}
      <div className="flex items-center justify-between gap-4">
        <span className="text-ink-2">{xLabel}</span>
        <span className="tabular font-medium text-ink">{format(p.x)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-ink-2">{yLabel}</span>
        <span className="tabular font-medium text-ink">{format(p.y)}</span>
      </div>
    </div>
  );
}

/** Two measures per item on one pair of axes, optional dashed y = x reference. Dots can open the item. */
export function ScatterChart({
  series,
  ariaLabel,
  xLabel,
  yLabel,
  valueFormat = defaultFormat,
  height = 280,
  identityLine,
  onPointClick,
  animated = true,
}: ScatterChartProps) {
  const entrance = useEntranceAnimation();
  const animate = animated && entrance;
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? seriesColors[i] }));
  const values = series.flatMap((s) => s.data.flatMap((p) => [p.x, p.y]));
  const lo = values.length ? Math.min(0, ...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  // "Nice" shared ticks (1, 2 or 5 × 10^n) so both axes read the same scale.
  const raw = (hi - lo) / 5 || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const domain: [number, number] = [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
  const ticks = Array.from({ length: Math.round((domain[1] - domain[0]) / step) + 1 }, (_, i) => domain[0] + i * step);
  const legend = [
    ...colored.map((s) => ({ label: s.label, color: s.color })),
    ...(identityLine ? [{ label: identityLine, color: chartColors.axis, dashed: true }] : []),
  ];

  return (
    <div className="flex flex-col gap-2">
      <ChartFrame label={ariaLabel} height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
            <CartesianGrid {...GRID_PROPS} vertical />
            <XAxis
              type="number"
              dataKey="x"
              name={xLabel}
              domain={domain}
              ticks={ticks}
              tick={AXIS_TICK}
              axisLine={{ stroke: chartColors.grid }}
              tickLine={false}
              tickFormatter={valueFormat}
              label={{ value: xLabel, position: 'insideBottom', offset: -10, fill: 'var(--ink-2)', fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={yLabel}
              domain={domain}
              ticks={ticks}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={valueFormat}
              label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--ink-2)', fontSize: 11, style: { textAnchor: 'middle' } }}
            />
            {identityLine && (
              <ReferenceLine
                segment={[
                  { x: domain[0], y: domain[0] },
                  { x: domain[1], y: domain[1] },
                ]}
                stroke={chartColors.axis}
                strokeDasharray="5 4"
                strokeWidth={1.5}
                ifOverflow="hidden"
              />
            )}
            <Tooltip
              cursor={{ stroke: chartColors.axis, strokeDasharray: '3 3' }}
              content={<ScatterTooltip xLabel={xLabel} yLabel={yLabel} format={valueFormat} />}
              isAnimationActive={false}
            />
            {colored.map((s) => (
              <Scatter
                key={s.key}
                name={s.label}
                data={s.data.map((p) => ({ ...p, series: s.label }))}
                fill={s.color}
                fillOpacity={0.8}
                stroke="var(--surface)"
                strokeWidth={1}
                isAnimationActive={animate}
                animationDuration={ANIMATION_MS}
                animationEasing="ease-out"
                onClick={onPointClick ? (_, i) => s.data[i] && onPointClick(s.data[i], s) : undefined}
                cursor={onPointClick ? 'pointer' : undefined}
              />
            ))}
          </RScatterChart>
        </ResponsiveContainer>
      </ChartFrame>
      {legend.length > 1 && <ChartLegend items={legend} />}
    </div>
  );
}
