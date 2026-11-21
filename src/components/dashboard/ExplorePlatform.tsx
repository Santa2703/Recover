'use client';

import React from 'react';
import Link from 'next/link';
import { BrainCircuit, ChevronRight, LayoutDashboard, Link as LinkIcon, Monitor, Network, PlayCircle, ShieldCheck, Zap } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import type { UserRole } from '@/models/user.model';
import { canOpen, type ModuleId } from './roleAccess';
import { SectionCard } from './SectionCard';

interface QuickAction {
  key: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  roles?: UserRole[];
  module: ModuleId;
}

const QUICK_ACTIONS: QuickAction[] = [
  { key: 'decision', label: 'Create a decision', href: '/product/received', icon: <BrainCircuit size={16} />, module: 'intelligence', roles: ['Planner', 'Engineer', 'Approver', 'Admin'] },
  { key: 'studio', label: 'Open Workflow Studio', href: '/integration/studio', icon: <PlayCircle size={16} />, module: 'integrations' },
  { key: 'source', label: 'Connect a source', href: '/integration/map', icon: <LinkIcon size={16} />, module: 'integrations' },
  { key: 'checks', label: 'Run data checks', href: '/audit?tab=gaps', icon: <ShieldCheck size={16} />, module: 'governance' },
  { key: 'command', label: 'Open Command Center', href: '/command', icon: <Monitor size={16} />, module: 'operations' },
];

/** Vertical list of role-filtered shortcuts. */
export function QuickActions() {
  const { currentRole } = useAuth();
  const items = QUICK_ACTIONS.filter((a) => canOpen(currentRole, a.module) && (!a.roles || a.roles.includes(currentRole)));
  return (
    <SectionCard title="Quick Actions" icon={<Zap />} flush>
      <ul className="m-0 list-none divide-y divide-[#F1F5F9] p-0">
        {items.map((a) => (
          <li key={a.key}>
            <Link href={a.href} className="group block text-inherit no-underline">
              <span className="flex items-center gap-3 px-5 py-3 transition-colors group-hover:bg-[#F8FAFC]">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#FEF3C7] bg-[#FFFBEB] text-[#D97706]">{a.icon}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#141416]">{a.label}</span>
                <ChevronRight size={16} className="shrink-0 text-[#94A3B8] group-hover:text-[#141416]" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

const MODULES: { id: ModuleId; title: string; icon: React.ReactNode; links: { label: string; href: string }[] }[] = [
  {
    id: 'operations',
    title: 'Operations',
    icon: <LayoutDashboard size={15} />,
    links: [
      { label: 'Command Center', href: '/command' },
      { label: 'My work', href: '/command/actions' },
      { label: 'Exceptions', href: '/command/exceptions' },
      { label: 'Data Checks', href: '/audit?tab=gaps' },
    ],
  },
  {
    id: 'intelligence',
    title: 'Intelligence',
    icon: <BrainCircuit size={15} />,
    links: [
      { label: 'Decision Workbench', href: '/product/received' },
      { label: 'Expected Returns', href: '/product/expected' },
      { label: 'Pool Optimizer', href: '/product/pools' },
      { label: 'Analytics', href: '/analytics' },
    ],
  },
  {
    id: 'integrations',
    title: 'Integrations',
    icon: <Network size={15} />,
    links: [
      { label: 'Connection Fabric', href: '/integration/map' },
      { label: 'MCP & Tools', href: '/mcp' },
      { label: 'Process Orchestration', href: '/orchestration' },
    ],
  },
  {
    id: 'governance',
    title: 'Governance',
    icon: <ShieldCheck size={15} />,
    links: [
      { label: 'Audit & Provenance', href: '/audit' },
      { label: 'Access & Governance', href: '/access' },
      { label: 'Settings', href: '/settings' },
    ],
  },
];

/** Quiet footer band of module links the role can open (replaces the old Modules card grid). */
export function ExplorePlatform() {
  const { currentRole } = useAuth();
  const modules = MODULES.filter((m) => canOpen(currentRole, m.id));
  return (
    <section className="border-t border-[#E2E8F0] pt-6" aria-labelledby="explore-title">
      <h2 id="explore-title" className="m-0 mb-4 text-[11px] font-bold uppercase tracking-[1.2px] text-[#94A3B8]">
        Explore the Platform
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {modules.map((m) => (
          <div key={m.id} className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold text-[#141416]">
              <span className="text-[#64748B]">{m.icon}</span>
              {m.title}
            </div>
            <p className="m-0 mt-1.5 text-[11px] leading-relaxed text-[#64748B]">
              {m.links.map((l, i) => (
                <React.Fragment key={l.href}>
                  {i > 0 && <span className="mx-1.5 text-[#CBD5E1]">·</span>}
                  <Link href={l.href} className="text-[#64748B] no-underline hover:text-[#141416]">
                    {l.label}
                  </Link>
                </React.Fragment>
              ))}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
