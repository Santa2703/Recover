'use client';

import React, { useState } from 'react';
import { Select, message } from 'antd';
import { SlidersHorizontal, Save, Undo2 } from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import {
  agentControlsService,
  ACTION_TYPES,
  AUTONOMY_LEVELS,
  AUTONOMY_ROLES,
  levelLabel,
  levelsUpTo,
  type ActionTypeDef,
  type AutonomyLevel,
  type AutonomyMatrix,
  type RiskTier,
} from '@/services/agentControlsService';
import type { UserRole } from '@/models/user.model';
import { ListSkeleton, ErrorState } from '@/components/ui';
import { Card } from './Filters';
import { CardHeader, Pill, ReadOnlyNotice, RoleGate, btnPrimary, btnSecondary, fmtDateTime, type PillTone } from './shared';

const TIER: Record<RiskTier, { label: string; tone: PillTone }> = {
  low: { label: 'Low risk', tone: 'green' },
  medium: { label: 'Medium risk', tone: 'amber' },
  high: { label: 'High risk', tone: 'red' },
};
const SHORT: Record<AutonomyLevel, string> = Object.fromEntries(AUTONOMY_LEVELS.map((l) => [l.id, l.short])) as Record<AutonomyLevel, string>;
const ROLE_SHORT: Partial<Record<UserRole, string>> = { 'Warehouse Manager': 'Warehouse Mgr' };

/** Agent autonomy: role × action type, each cell capped by the action's risk tier. One draft, saved together. */
export function AutonomyTab() {
  const { user, isAdmin } = useAuth();
  const actor = { id: user.id, name: user.name, role: user.role };
  const q = useServiceQuery(() => agentControlsService.getAutonomy(), [], { subscribe: agentControlsService.subscribe });
  const [draft, setDraft] = useState<AutonomyMatrix | null>(null);
  const [saving, setSaving] = useState(false);

  if (q.error) return <ErrorState onRetry={q.refetch} />;
  const saved = q.data?.matrix;
  const matrix = draft ?? saved;
  const changed = (a: string, r: UserRole) => !!draft && !!saved && draft[a][r] !== saved[a][r];
  const changes = saved && draft ? ACTION_TYPES.reduce((n, a) => n + AUTONOMY_ROLES.filter((r) => changed(a.id, r)).length, 0) : 0;

  const setCell = (a: string, r: UserRole, level: AutonomyLevel) => {
    if (!matrix) return;
    const next = Object.fromEntries(Object.entries(matrix).map(([k, v]) => [k, { ...v }])) as AutonomyMatrix;
    next[a][r] = level;
    setDraft(next);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await agentControlsService.saveAutonomy(draft, actor);
      setDraft(null);
      message.success(`Agent autonomy saved: ${res.changed} ${res.changed === 1 ? 'change' : 'changes'} written to the audit log`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const cell = (a: ActionTypeDef, r: UserRole) => (
    <div className={`rounded-lg ${changed(a.id, r) ? 'ring-2 ring-[#FFD600]' : ''}`}>
      <Select
        size="small"
        value={matrix![a.id][r]}
        disabled={!isAdmin || saving}
        onChange={(v) => setCell(a.id, r, v)}
        options={levelsUpTo(a.cap).map((l) => ({ value: l.id, label: l.label }))}
        labelRender={(o) => SHORT[o.value as AutonomyLevel] ?? o.label}
        popupMatchSelectWidth={false}
        className="w-full [&_.ant-select-selection-item]:!text-xs"
        aria-label={`${r}: ${a.label}`}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {!isAdmin && <ReadOnlyNotice>Read-only. Only Admins can change agent autonomy.</ReadOnlyNotice>}
      <Card>
        <CardHeader
          icon={<SlidersHorizontal />}
          title="Agent autonomy"
          description="How far the agent may go for each role and action type, capped by the action's risk tier. Reads, drafts and what-ifs are always allowed."
          right={
            <>
              {changes > 0 && <span className="text-[11px] font-semibold text-[#64748B]">{changes} unsaved {changes === 1 ? 'change' : 'changes'}</span>}
              <button onClick={() => setDraft(null)} disabled={!changes || saving} className={btnSecondary}>
                <Undo2 className="w-3.5 h-3.5" /> Discard
              </button>
              <RoleGate allowed={isAdmin}>
                <button onClick={save} disabled={!isAdmin || !changes || saving} className={btnPrimary}>
                  <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
                </button>
              </RoleGate>
            </>
          }
        />
        <div className="pt-4">
          {q.initialLoading || !matrix ? (
            <ListSkeleton rows={7} />
          ) : (
            <>
              {/* Wide screens: the full grid. */}
              <table className="hidden xl:table w-full table-fixed text-xs">
                <thead>
                  <tr className="border-b border-[#F1F5F9] text-[11px] font-bold text-[#64748B] uppercase tracking-wider align-bottom">
                    <th className="py-2 px-2 text-left w-[21%]">Action type</th>
                    <th className="py-2 px-2 text-left w-[8%]">Cap</th>
                    {AUTONOMY_ROLES.map((r) => (
                      <th key={r} className="py-2 px-1 text-left font-bold">
                        <span className="block truncate" data-tip={r}>
                          {ROLE_SHORT[r] ?? r}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ACTION_TYPES.map((a) => (
                    <tr key={a.id} className="border-b border-[#F8FAFC] hover:bg-[#F8FAFC] transition-colors">
                      <td className="py-2 px-2 align-top">
                        <div className="font-semibold text-[#141416] line-clamp-2">{a.label}</div>
                        <div className="mt-1">
                          <Pill tone={TIER[a.tier].tone}>{TIER[a.tier].label}</Pill>
                        </div>
                      </td>
                      <td className="py-2 px-2 align-top text-[11px] font-bold text-[#475569]">{levelLabel(a.cap)}</td>
                      {AUTONOMY_ROLES.map((r) => (
                        <td key={r} className="py-2 px-1 align-top">
                          {cell(a, r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Narrower screens: one block per action type, roles wrap. */}
              <div className="xl:hidden divide-y divide-[#F1F5F9]">
                {ACTION_TYPES.map((a) => (
                  <div key={a.id} className="py-3 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-extrabold text-[#141416] min-w-0">{a.label}</span>
                      <Pill tone={TIER[a.tier].tone}>{TIER[a.tier].label}</Pill>
                      <span className="text-[11px] text-[#64748B]">Cap: {levelLabel(a.cap)}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {AUTONOMY_ROLES.map((r) => (
                        <div key={r} className="min-w-0">
                          <span className="block text-[10px] font-semibold text-[#64748B] mb-0.5 truncate">{r}</span>
                          {cell(a, r)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <dl className="mt-4 pt-3 border-t border-[#F1F5F9] grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-[#64748B]">
                {AUTONOMY_LEVELS.map((l) => (
                  <div key={l.id} className="flex gap-1.5 min-w-0">
                    <dt className="font-bold text-[#141416] shrink-0">{l.label}:</dt>
                    <dd className="m-0 min-w-0">
                      {l.description}
                      {l.id === 'act' ? ' Low-risk actions only.' : ''}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 mb-0 text-[11px] text-[#94A3B8]">
                A cell can never go above its action&apos;s cap. Every save is a change by a named person and goes to the audit log
                {q.data?.updatedAt ? ` (last saved by ${q.data.updatedBy}, ${fmtDateTime(q.data.updatedAt)})` : ''}.
              </p>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
