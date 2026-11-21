'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays } from 'lucide-react';
import { useAuth } from '@/store/authContext';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { dashboardService, formatMoney, STRIP_PERIOD_DAYS, type AttentionItem, type StripFigure } from '@/services/dashboardService';
import { CaseLink, DataTable, ErrorState, HowCalculated, Skeleton, type DataColumn } from '@/components/ui';
import { rememberQueue } from '@/components/product/queueContext';
import { CardLink, SectionCard } from './SectionCard';
import { MyWork } from './MyWork';
import { OperationalPerformance } from './OperationalPerformance';
import { ExplorePlatform, QuickActions } from './ExplorePlatform';
import { InboxPanel } from './InboxPanel';

const DOT: Record<AttentionItem['priority'], string> = { high: '#EF4444', medium: '#F59E0B', low: '#94A3B8' };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function TrendPill({ f }: { f: StripFigure }) {
  const diff = f.now - f.prior;
  const pct = f.prior ? Math.round((diff / f.prior) * 100) : null;
  const flat = diff === 0;
  const good = (diff > 0) === f.upIsGood;
  const cls = flat ? 'bg-[#F1F5F9] text-[#64748B]' : good ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#FEF3C7] text-[#D97706]';
  const Icon = flat ? ArrowRight : diff > 0 ? ArrowUpRight : ArrowDownRight;
  const text = pct !== null ? `${Math.abs(pct)}%` : f.money ? formatMoney(Math.abs(diff)) : String(Math.abs(diff));
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${cls}`}>
      <Icon size={12} strokeWidth={2.5} aria-hidden />
      <span className="sr-only">{flat ? 'Unchanged' : diff > 0 ? 'Up' : 'Down'}</span>
      {text}
    </span>
  );
}

/** Thin dividers that work both in the 2-column (wrapped) and the 5-column layout. */
const DIVIDERS = [
  'border-b lg:border-b-0',
  'border-b border-l lg:border-b-0',
  'border-b lg:border-b-0 lg:border-l',
  'border-b border-l lg:border-b-0',
  'border-l-4 !border-l-[#FFD600]',
];

function KpiStrip({ strip }: { strip?: StripFigure[] }) {
  const { scope } = useAuth();
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-2xs lg:grid-cols-5">
      {(strip ?? Array.from({ length: 5 }, () => undefined)).map((f, i) => {
        const emphasised = i === 4;
        const outer = `group relative block min-w-0 border-[#E2E8F0] ${DIVIDERS[i]} ${emphasised ? 'col-span-2 lg:col-span-1' : ''}`;
        const inner = `h-full p-5 transition-colors ${emphasised ? 'bg-[#FFFBEB] group-hover:bg-[#FEF9C3]' : 'bg-white group-hover:bg-[#F8FAFC]'}`;
        if (!f)
          return (
            <div key={i} className={outer} aria-busy="true">
              <div className={inner}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-3 h-7 w-16" />
                <Skeleton className="mt-2 h-3 w-28" />
              </div>
            </div>
          );
        const shown = f.money ? formatMoney(f.value) : f.value;
        // Whole segment is a link (stretched over it); "How calculated" sits above the link so it stays its own control.
        return (
          <div key={f.id} className={outer}>
            <div className={inner}>
              <div className="flex min-w-0 items-center justify-between gap-1">
                <div className={`truncate text-xs font-semibold ${emphasised ? 'text-[#92400E]' : 'text-[#64748B]'}`}>{f.label}</div>
                {f.kpi && <HowCalculated kpi={f.kpi} scope={scope} variant="icon" label={f.label} className="-my-1 -mr-1" />}
              </div>
              <div className="mt-1.5 font-mono text-[26px] font-black leading-tight tracking-tight text-[#141416]">{shown}</div>
              <div className={`mt-1 text-[11px] ${f.id === 'recovery' ? 'line-clamp-2 font-bold text-[#047857]' : 'truncate font-medium text-[#64748B]'}`} title={f.note}>
                {f.note}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <TrendPill f={f} />
                <span className="text-[11px] text-[#94A3B8]" title={`Received in the last ${STRIP_PERIOD_DAYS} days: ${f.money ? formatMoney(f.now) : f.now}; previous ${STRIP_PERIOD_DAYS} days: ${f.money ? formatMoney(f.prior) : f.prior}`}>
                  vs previous {STRIP_PERIOD_DAYS} days
                </span>
              </div>
            </div>
            <Link href={f.href} aria-label={`${f.label}: ${shown}. ${f.note}`} className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#FFD600]" />
          </div>
        );
      })}
    </div>
  );
}

/** One action per row (the row itself opens it too). Row buttons are outline: the page's one yellow action is "Run agents". */
function actionFor(item: AttentionItem): { label: string; href: string } {
  const caseHref = `/product/case/${item.id}`;
  if (item.stage === 'awaiting_approval') return { label: 'View approval', href: '/command/actions?tab=approvals' };
  if (item.stage === 'approved') return { label: 'Open case', href: caseHref };
  if (item.exceptionId) return { label: 'View exception', href: '/command/exceptions' };
  return { label: 'Open case', href: caseHref };
}

const BTN_SECONDARY = 'inline-flex items-center whitespace-nowrap rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] no-underline hover:border-gray-400';

function AttentionTable({ items, loading, total }: { items: AttentionItem[]; loading: boolean; total: number }) {
  const router = useRouter();
  // Cases opened from this list get Back to Dashboard and Previous / Next on the Case page.
  const queue = { name: 'Dashboard', href: '/dashboard', ids: items.map((i) => i.id) };
  const open = (href: string) => {
    if (href.startsWith('/product/case/')) rememberQueue(queue.name, queue.href, queue.ids);
  };
  const columns: DataColumn<AttentionItem>[] = [
    {
      title: 'Asset / Case',
      key: 'case',
      priority: 1,
      ellipsis: false,
      render: (_, r) => (
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: DOT[r.priority] }} title={`${r.priority} priority`} />
          <div className="min-w-0">
            <span className="font-bold [&_span]:font-bold" onClick={(e) => e.stopPropagation()}>
              <CaseLink id={r.id} queue={queue} />
            </span>
            <div className="max-w-[180px] truncate text-[11px] text-[#64748B]">{r.productName}</div>
          </div>
        </div>
      ),
    },
    {
      title: 'Issue',
      key: 'issue',
      priority: 2,
      ellipsis: false,
      render: (_, r) => <span className="line-clamp-2 break-words text-xs text-[#141416]" title={r.issue}>{r.issue}</span>,
    },
    {
      title: 'Impact',
      key: 'impact',
      priority: 1,
      align: 'right',
      ellipsis: false,
      render: (_, r) => (
        <div className="whitespace-nowrap text-right">
          <div className="font-mono text-xs font-bold text-[#141416]">{formatMoney(r.impact)}</div>
          <div className="text-[10px] text-[#94A3B8]">{r.impactKind}</div>
        </div>
      ),
    },
    {
      title: 'Due',
      key: 'due',
      priority: 2,
      ellipsis: false,
      render: (_, r) => {
        const urgent = r.dueInDays <= 2;
        return (
          <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${urgent ? 'font-bold text-[#DC2626]' : 'text-[#64748B]'}`}>
            {urgent && <CalendarDays size={13} aria-hidden />}
            {r.dueInDays < 0 ? `${shortDate(r.dueDate)} (late)` : shortDate(r.dueDate)}
          </span>
        );
      },
    },
    {
      title: 'Action',
      key: 'action',
      priority: 1,
      align: 'right',
      ellipsis: false,
      render: (_, r) => {
        const a = actionFor(r);
        return (
          <Link
            href={a.href}
            onClick={(e) => {
              e.stopPropagation();
              open(a.href);
            }}
            className="inline-flex no-underline"
          >
            <span className={BTN_SECONDARY}>{a.label}</span>
          </Link>
        );
      },
    },
  ];
  return (
    <SectionCard
      title="Needs Your Attention"
      flush
      actions={
        <>
          {total > 0 && <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[10px] font-bold text-[#B91C1C]">{total} items</span>}
          <CardLink href="/command/exceptions">View all</CardLink>
        </>
      }
    >
      <div className="px-2 py-1 md:px-1">
        <DataTable<AttentionItem>
          columns={columns}
          dataSource={items}
          rowKey="id"
          onRowClick={(r) => {
            open(actionFor(r).href);
            router.push(actionFor(r).href);
          }}
          initialLoading={loading}
          pagination={false}
          emptyTitle="Nothing needs your attention"
          emptyDescription="No cases at risk, waiting for approval or due in the next 2 days."
        />
      </div>
    </SectionCard>
  );
}

export function BusinessView() {
  const { scope } = useAuth();
  const q = useServiceQuery(() => dashboardService.today(scope), [scope.tenant, scope.site], { subscribe: dashboardService.subscribe });
  const d = q.data;
  if (q.error && !d) return <ErrorState onRetry={q.refetch} />;

  return (
    <div className="space-y-6">
      <InboxPanel />
      <KpiStrip strip={d?.strip} />

      {/* 60/40 split from 1024px so the layout stays the same across browsers whose usable width differs
          (Edge's sidebar/zoom often leaves < 1280px). Below 1024px the columns stack. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-6 lg:col-span-7">
          <AttentionTable items={d?.attention ?? []} loading={q.initialLoading || !d} total={d?.attentionTotal ?? 0} />
          <MyWork />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6 md:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
          <OperationalPerformance />
          <QuickActions />
        </div>
      </div>

      <ExplorePlatform />
    </div>
  );
}
