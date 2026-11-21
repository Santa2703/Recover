'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Paperclip, Sparkles } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { BusinessView } from '@/components/dashboard/BusinessView';
import { TechnicalView } from '@/components/dashboard/TechnicalView';
import { useDashboardMode, useMinuteClock, type DashboardMode } from '@/components/dashboard/useDashboardPrefs';

/** Sends a question to the page that answers it (case id, approvals, issues, figures, integrations). */
function routeFor(text: string): string {
  const t = text.trim().toLowerCase();
  const caseId = t.match(/rt-?\d{4}/);
  if (caseId) return `/product/case/${caseId[0].toUpperCase().replace(/^RT-?/, 'RT-')}`;
  if (/approv/.test(t)) return '/command/actions?tab=approvals';
  if (/exception|issue|investigat|risk|problem/.test(t)) return '/command/exceptions';
  if (/evidence|inspect/.test(t)) return '/product/received?stage=needs_information';
  if (/integration|workflow|sync|agent|mcp|source|feed/.test(t)) return '/integration/map?tab=health';
  if (/recover|opportunit|figure|kpi|performance|value|operational/.test(t)) return '/command';
  return '/product/received';
}

/** "Fri, 20 Nov 2026 · 4:08 PM" */
function formatNow(d: Date): string {
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${weekday}, ${date} · ${time}`;
}

export default function CircularityDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [mode, setMode] = useDashboardMode();
  const [prompt, setPrompt] = useState('');
  const now = useMinuteClock();

  const firstName = user.name.split(' ')[0] ?? '';
  const hour = now?.getHours() ?? 9;
  const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${firstName ? `, ${firstName}` : ''}.`;

  const ask = (text: string) => {
    if (!text.trim()) return;
    router.push(routeFor(text));
  };

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      {/* Greeting row */}
      <div className="flex flex-col justify-between gap-4 pt-1 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="text-xs font-medium text-[#64748B]">{now ? formatNow(now) : ' '}</div>
          <h1 className="m-0 mt-1 text-[28px] font-extrabold leading-tight tracking-tight text-[#141416]">{greeting}</h1>
          <p className="m-0 mt-1 text-xs font-medium text-[#64748B]">Here&apos;s what&apos;s happening across your operations.</p>
        </div>
        <div className="flex shrink-0 items-center self-start rounded-full bg-[#EAECEE] p-1 text-xs font-semibold" role="group" aria-label="Dashboard view">
          {(['Business', 'Technical'] as DashboardMode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`cursor-pointer rounded-full px-3.5 py-1 transition-all ${mode === m ? 'bg-[#141416] text-white shadow-sm' : 'text-[#64748B] hover:text-[#141416]'}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Ask Circularity: one slim line */}
      <form
        className="flex min-w-0 items-center rounded-full border border-[#E2E8F0] bg-white py-1.5 pl-4 pr-1.5 shadow-2xs transition-all focus-within:border-[#FFD600]"
        onSubmit={(e) => {
          e.preventDefault();
          ask(prompt);
        }}
      >
        <Sparkles size={16} className="mr-2.5 shrink-0 text-[#F59E0B]" aria-hidden />
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask Circularity anything…"
          aria-label="Ask Circularity"
          className="min-w-0 flex-1 border-none bg-transparent text-xs font-medium text-[#1F2937] outline-none placeholder:text-[#9CA3AF]"
        />
        <button
          type="button"
          onClick={() => router.push('/integration/map?add=file')}
          aria-label="Attach a file to import"
          title="Attach a file to import"
          className="ml-2 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#64748B] transition-colors hover:bg-[#F1F5F9] hover:text-[#141416]"
        >
          <Paperclip size={15} />
        </button>
        <button
          type="submit"
          aria-label="Send"
          disabled={!prompt.trim()}
          className="ml-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#FFD600] text-[#141416] transition-colors hover:bg-[#FACC15] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowUp size={15} strokeWidth={2.5} />
        </button>
      </form>

      {mode === 'Business' ? <BusinessView /> : <TechnicalView />}
    </div>
  );
}
