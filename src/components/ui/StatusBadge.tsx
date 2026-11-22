import React from 'react';
import { CircleCheck, CircleAlert, TriangleAlert, Info, Circle, CircleDot } from 'lucide-react';
import { statusTone, type Tone } from '@/theme/tokens';
import type { CaseStageId, Priority, Severity } from '@/models/domain.model';

interface StatusBadgeProps {
  tone?: Tone;
  children: React.ReactNode;
  /** Show the tone icon so status is never conveyed by colour alone (default true). */
  icon?: boolean | React.ReactNode;
  className?: string;
}

const TONE_ICON: Record<Tone, React.ReactNode> = {
  success: <CircleCheck size={12} strokeWidth={2.25} />,
  warning: <TriangleAlert size={12} strokeWidth={2.25} />,
  danger: <CircleAlert size={12} strokeWidth={2.25} />,
  info: <Info size={12} strokeWidth={2.25} />,
  neutral: <Circle size={12} strokeWidth={2.25} />,
  brand: <CircleDot size={12} strokeWidth={2.25} />,
};

export function StatusBadge({ tone = 'neutral', children, icon = true, className = '' }: StatusBadgeProps) {
  const t = statusTone[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
      style={{ color: t.fg, backgroundColor: t.bg }}
    >
      {icon === true ? TONE_ICON[tone] : icon || null}
      {children}
    </span>
  );
}

export const SEVERITY_TONE: Record<Severity, Tone> = { high: 'danger', medium: 'warning', low: 'neutral' };
export function SeverityBadge({ severity }: { severity: Severity }) {
  return <StatusBadge tone={SEVERITY_TONE[severity]}>{severity[0].toUpperCase() + severity.slice(1)}</StatusBadge>;
}

export const PRIORITY_TONE: Record<Priority, Tone> = { high: 'danger', medium: 'warning', low: 'neutral' };
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <StatusBadge tone={PRIORITY_TONE[priority]}>{priority[0].toUpperCase() + priority.slice(1)}</StatusBadge>;
}

export const STAGE_META: Record<CaseStageId, { label: string; tone: Tone }> = {
  awaiting_inspection: { label: 'Awaiting inspection', tone: 'warning' },
  needs_information: { label: 'Needs information', tone: 'warning' },
  ready_for_decision: { label: 'Ready for decision', tone: 'info' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'brand' },
  approved: { label: 'Approved', tone: 'success' },
  handed_off: { label: 'Handed off', tone: 'info' },
  reevaluate: { label: 'Re-evaluate', tone: 'warning' },
  no_viable_route: { label: 'No viable route', tone: 'danger' },
};
export function StageBadge({ stage }: { stage: CaseStageId }) {
  const m = STAGE_META[stage];
  return <StatusBadge tone={m.tone}>{m.label}</StatusBadge>;
}
