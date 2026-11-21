'use client';

import React from 'react';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { chartColors } from '@/theme/tokens';
import { useEntranceAnimation } from '@/hooks/useReducedMotion';

/** Tiny trend line for KPI tiles. No axes; the tile states the metric and period. */
export function Sparkline({ values, color = chartColors.neutral, height = 32, ariaLabel }: { values: number[]; color?: string; height?: number; ariaLabel: string }) {
  const animate = useEntranceAnimation();
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={animate} animationDuration={900} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
