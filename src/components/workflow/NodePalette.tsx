'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { DND_MIME, NODE_KINDS, kindColor } from './nodeRegistry';
import type { PaletteTemplate } from './nodeRegistry';

interface SourceSystem {
  short: string;
  name: string;
  badge: string;
  color: string;
}

const SOURCE_CATEGORIES: { id: string; label: string; short: string; systems: SourceSystem[] }[] = [
  {
    id: 'crm',
    label: 'CRM (Salesforce, Dynamics)',
    short: 'CRM',
    systems: [
      { short: 'CRM', name: 'Salesforce Sales Cloud', badge: 'SF', color: '#0284C7' },
      { short: 'CRM', name: 'Microsoft Dynamics 365', badge: 'D', color: '#1E40AF' },
    ],
  },
  {
    id: 'erp',
    label: 'ERP (SAP, Oracle)',
    short: 'ERP',
    systems: [
      { short: 'ERP', name: 'SAP S/4HANA', badge: 'S4', color: '#0284C7' },
      { short: 'ERP', name: 'Oracle Lease and Finance Management', badge: 'O', color: '#DC2626' },
    ],
  },
  { id: 'oms', label: 'OMS and returns', short: 'OMS', systems: [{ short: 'OMS', name: 'Manhattan Active Omni', badge: 'MA', color: '#1E40AF' }] },
  { id: 'mro', label: 'MRO and workshop', short: 'MRO', systems: [{ short: 'MRO', name: 'IFS Maintenix', badge: 'IF', color: '#8B5CF6' }] },
  {
    id: 'eam',
    label: 'EAM, service and quality',
    short: 'EAM',
    systems: [
      { short: 'EAM', name: 'IBM Maximo', badge: 'MX', color: '#0284C7' },
      { short: 'EAM', name: 'ServiceNow Field Service', badge: 'SN', color: '#059669' },
    ],
  },
  { id: 'wms', label: 'WMS', short: 'WMS', systems: [{ short: 'WMS', name: 'Manhattan Active Warehouse Management', badge: 'MA', color: '#1E40AF' }] },
  { id: 'tms', label: 'TMS', short: 'TMS', systems: [{ short: 'TMS', name: 'Oracle Transportation Management', badge: 'O', color: '#DC2626' }] },
  {
    id: 'file',
    label: 'File (SFTP, storage)',
    short: 'File',
    systems: [
      { short: 'File', name: 'Sims Lifecycle Services SFTP', badge: 'SL', color: '#059669' },
      { short: 'File', name: 'Azure Blob storage', badge: 'AZ', color: '#0284C7' },
    ],
  },
];

const sourceTemplate = (s: SourceSystem): PaletteTemplate => ({
  kind: 'dataSource',
  data: { label: s.short, subtitle: s.name, brand: { text: s.badge, color: s.color } },
});

interface Props {
  onAdd: (t: PaletteTemplate) => void;
  disabled?: boolean;
}

/** Left panel: draggable node types and source systems. Click an item to add it at the canvas centre. */
export function NodePalette({ onAdd, disabled }: Props) {
  const [query, setQuery] = useState('');
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({ crm: true });
  const q = query.trim().toLowerCase();

  const onDragStart = (e: React.DragEvent, t: PaletteTemplate) => {
    e.dataTransfer.setData(DND_MIME, JSON.stringify(t));
    e.dataTransfer.effectAllowed = 'move';
  };

  const kinds = NODE_KINDS.filter((k) => !q || k.label.toLowerCase().includes(q) || k.hint.toLowerCase().includes(q));
  const categories = SOURCE_CATEGORIES.map((c) => ({
    ...c,
    systems: c.systems.filter((s) => !q || c.label.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)),
  })).filter((c) => !q || c.systems.length);

  return (
    <div className="min-w-0 xl:col-span-3 bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-4">
      {/* Search components */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search components"
          className="w-full pl-9 pr-3 py-2 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl text-xs font-medium focus:outline-none focus:border-black"
        />
      </div>

      {kinds.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">COMPONENTS</div>
          <div className="grid grid-cols-2 gap-1.5">
            {kinds.map((k) => {
              const t: PaletteTemplate = { kind: k.kind };
              const Icon = k.icon;
              const color = kindColor(k.kind);
              return (
                <div
                  key={k.kind}
                  role="button"
                  tabIndex={0}
                  draggable={!disabled}
                  onDragStart={(e) => onDragStart(e, t)}
                  onClick={() => !disabled && onAdd(t)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !disabled && onAdd(t)}
                  title={`${k.hint}. Drag onto the canvas or click to add.`}
                  className="p-2 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl flex items-center gap-2 cursor-grab active:cursor-grabbing hover:border-gray-400 transition-all min-w-0"
                >
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}26` }}>
                    <Icon size={12} style={{ color }} />
                  </div>
                  <div className="font-bold text-[11px] text-[#141416] truncate">{k.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">SOURCES</div>

        <div className="space-y-1 text-xs">
          {categories.map((cat) => {
            const open = Boolean(q) || expandedSources[cat.id];
            return (
              <div key={cat.id}>
                <button
                  onClick={() => setExpandedSources((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                  className={`w-full flex items-center justify-between ${open ? 'py-1.5 font-semibold' : 'py-2 font-medium'} px-2 rounded-lg hover:bg-[#F8F9FA] text-[#141416] transition-colors cursor-pointer`}
                >
                  <div className="flex items-center gap-1.5">
                    {open ? <ChevronDown size={14} className="text-[#64748B]" /> : <ChevronRight size={14} className="text-[#94A3B8]" />}
                    <span>{cat.label}</span>
                  </div>
                </button>

                {open && (
                  <div className="space-y-1">
                    {cat.systems.map((s) => {
                      const t = sourceTemplate(s);
                      return (
                        <div
                          key={s.name}
                          role="button"
                          tabIndex={0}
                          draggable={!disabled}
                          onDragStart={(e) => onDragStart(e, t)}
                          onClick={() => !disabled && onAdd(t)}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !disabled && onAdd(t)}
                          title={`${s.name}. Drag onto the canvas or click to add.`}
                          className="ml-5 mt-1 p-2 bg-[#F8F9FA] border border-[#E2E8F0] rounded-xl flex items-center justify-between cursor-grab active:cursor-grabbing hover:border-gray-400 transition-all"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${s.color}26` }}>
                              <span className="text-[10px] font-bold" style={{ color: s.color }}>
                                {s.badge}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-[11px] text-[#141416]">{s.short}</div>
                              <div className="text-[10px] text-[#64748B] truncate">{s.name}</div>
                            </div>
                          </div>
                          <span className="w-2 h-2 rounded-full bg-[#10B981] shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {q && !categories.length && !kinds.length && (
            <div className="py-6 text-center text-[11px] text-[#94A3B8]">No components match “{query}”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
