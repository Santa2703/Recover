'use client';

import React, { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Collapse, Drawer, Dropdown, Input, Modal, Radio, Select, Slider, Switch, Tabs, message } from 'antd';
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Calculator,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ClipboardCheck,
  FileText,
  Link2,
  ListOrdered,
  MoreHorizontal,
  RotateCcw,
  Send,
  ShieldCheck,
  Shuffle,
  Sliders,
  ThumbsDown,
  Undo2,
  Wrench,
} from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { useAuth } from '@/store/authContext';
import { caseService } from '@/services/caseService';
import { caseContext, decisionService, OVERRIDE_REASONS, usd } from '@/services/decisionService';
import { BASE_SCENARIO, CONDITION_LABEL, isBaseScenario, productService, scenarioDecision, type RouteScenario, type WorkOrder } from '@/services/productService';
import type { OverrideReason, RouteId } from '@/models/decision.model';
import type { UserRole } from '@/models/user.model';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import {
  ChartSkeleton,
  EmptyState,
  ErrorState,
  PageActions,
  PriorityBadge,
  ProgressBar,
  Skeleton,
  StageBadge,
  StatusBadge,
  STAGE_META,
  type PageAction,
} from '@/components/ui';
import { AssetCondition } from '@/components/product/AssetCondition';
import { AgentTrail, CalculationTable, NextBestActionCard, RouteLadder } from '@/components/product/CaseDecision';
import { Card, CardTitle, copyPageLink } from '@/components/product/ui';
import { caseHref, useQueueContext, type QueueContext } from '@/components/product/queueContext';
import { date, dateTime, money } from '@/utils/format';

const WO_STATUS: Record<WorkOrder['status'], { label: string; tone: 'neutral' | 'info' | 'brand' }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  acknowledged: { label: 'Acknowledged', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'brand' },
};

/** Roles that work cases but cannot approve: they send a route to an approver instead. */
const PROPOSER_ROLES: UserRole[] = ['Planner', 'Engineer', 'Warehouse Manager'];

const brandOk = { backgroundColor: '#FFD600', color: '#000000', borderColor: '#FFD600', fontWeight: 700 };
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${usd(Math.abs(n))}`;
const smallBtn =
  'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50';

export default function CaseDecisionWorkbenchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const caseId = decodeURIComponent(id);
  const router = useRouter();
  const { isApprover, currentRole, user } = useAuth();
  const meta = caseService.meta();
  const queue = useQueueContext();

  const assetQ = useServiceQuery(() => productService.asset(caseId), [caseId], { subscribe: caseService.subscribe });
  const decisionQ = useServiceQuery(
    async () => {
      const [decision, action, trail, history, proposed] = await Promise.all([
        decisionService.decision(caseId),
        decisionService.nextBestAction(caseId),
        decisionService.agentTrail(caseId),
        decisionService.history({ search: caseId, pageSize: 5 }),
        decisionService.proposedAction(caseId),
      ]);
      return { decision, action, trail, proposed, outcome: history.items.find((h) => h.caseId === caseId) ?? null };
    },
    [caseId],
    { subscribe: decisionService.subscribe },
  );
  const [tab, setTab] = useState('decision');
  const [scenario, setScenario] = useState<RouteScenario>(BASE_SCENARIO);
  const [selectedRoute, setSelectedRoute] = useState<RouteId | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [ovRoute, setOvRoute] = useState<RouteId | null>(null);
  const [ovReason, setOvReason] = useState<OverrideReason | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [propNote, setPropNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [trailOpen, setTrailOpen] = useState(false);
  // The case the user last approved / declined / sent from this page (highlights "Next case").
  const [actedOn, setActedOn] = useState<string | null>(null);

  const record = assetQ.data?.record;
  const detail = assetQ.data?.detail;
  const live = decisionQ.data;
  const scenarioChanged = !isBaseScenario(scenario);
  // Scenario levers re-decide this case with the rest of the queue plan fixed (derived during render).
  const simulated = useMemo(() => (record && scenarioChanged ? scenarioDecision(record, scenario) : null), [record, scenario, scenarioChanged]);

  // Position in the queue the case was opened from (sessionStorage, see queueContext).
  const pos = queue ? queue.ids.indexOf(caseId) : -1;
  const inQueue = !!queue && pos >= 0;
  const prevId = inQueue && pos > 0 ? queue.ids[pos - 1] : null;
  const nextId = inQueue && pos < queue.ids.length - 1 ? queue.ids[pos + 1] : null;

  if (assetQ.initialLoading || decisionQ.initialLoading) return <CaseSkeleton />;
  if ((assetQ.error && !assetQ.data) || (decisionQ.error && !decisionQ.data)) {
    return (
      <Card>
        <ErrorState
          onRetry={() => {
            assetQ.refetch();
            decisionQ.refetch();
          }}
        />
      </Card>
    );
  }
  if (!record || !detail || !live?.decision || !live.action) {
    return (
      <div className="w-full space-y-6 pb-16">
        <BackLink />
        <Card>
          <EmptyState
            title="Case not found"
            description={`There is no returned asset with ID ${caseId}. Case IDs run from RT-1001 to RT-1128.`}
            action={
              <Link href="/product/received" className="text-xs font-semibold text-[#141416] underline">
                Back to Returned assets
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const liveDecision = live.decision;
  const proposal = record.proposal ?? null;
  const proposed = !simulated && live.proposed ? live.proposed : null;
  const decision = simulated?.decision ?? proposed?.decision ?? liveDecision;
  const action = simulated?.action ?? proposed?.action ?? live.action;
  const best = liveDecision.best;
  const closed = record.stage === 'approved' || record.stage === 'handed_off';
  const openProposal = !closed && proposal ? proposal : null;
  const proposedRoute = openProposal?.route ? liveDecision.all.find((r) => r.route === openProposal.route) ?? null : null;
  // What an approval applies: the proposed route when one was proposed, else Circularity's route.
  const target = proposedRoute ?? best;
  const canDecide = record.stage === 'awaiting_approval' && target.viable;
  const canRequest = ['awaiting_inspection', 'awaiting_approval', 'reevaluate'].includes(record.stage);
  const alternatives = liveDecision.all.filter((r) => r.viable && r.route !== best.route);
  const canOverride = !closed && alternatives.length > 0;
  const canPropose = !isApprover && PROPOSER_ROLES.includes(currentRole);
  const selected = decision.all.find((r) => r.route === selectedRoute) ?? decision.best;
  const scenarioLabel = scenarioChanged
    ? [
        scenario.costMultiplier !== 1 && `refurbishment cost ${scenario.costMultiplier.toFixed(1)}x`,
        scenario.marketMultiplier !== 1 && `market prices ${scenario.marketMultiplier.toFixed(1)}x`,
        scenario.noInternalDemand && 'no internal demand',
      ]
        .filter(Boolean)
        .join(', ')
    : null;
  const bestLabel = closed ? 'Approved' : proposed ? 'Proposed' : decision.override ? 'Chosen' : 'Best';
  const resetScenario = () => setScenario(BASE_SCENARIO);
  const acted = actedOn === record.id;

  const showCalculation = (r: RouteId) => {
    setSelectedRoute(r);
    setCalcOpen(true);
  };

  /** Success toast; after a decision it offers the next case of the queue the case was opened from. */
  const toast = (text: string, offerNext: boolean) => {
    if (!offerNext || !nextId) {
      message.success(text);
      return;
    }
    const key = `next-${record.id}`;
    message.success({
      key,
      duration: 6,
      content: (
        <span>
          {text}{' '}
          <button
            type="button"
            onClick={() => {
              message.destroy(key);
              router.push(caseHref(nextId));
            }}
            className="cursor-pointer border-none bg-transparent p-0 font-bold text-[#141416] underline underline-offset-2"
          >
            Next case
          </button>
        </span>
      ),
    });
  };

  const run = async (key: string, fn: () => Promise<unknown>, done: string, offerNext = false) => {
    setBusy(key);
    try {
      await fn();
      toast(done, offerNext);
      if (offerNext) setActedOn(record.id);
      return true;
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Action failed');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    const ok = await run('approve', () => caseService.approve(record.id, note), `${record.id} approved for ${target.routeName}`, true);
    if (ok) {
      setApproveOpen(false);
      setNote('');
    }
  };
  const decline = () =>
    Modal.confirm({
      title: `Decline the plan for ${record.id}?`,
      content: openProposal
        ? `The proposal from ${openProposal.proposedBy} is cleared and the case goes back to re-evaluation.`
        : 'The case goes back to re-evaluation and the recommendation is rebuilt.',
      okText: 'Decline plan',
      okButtonProps: { danger: true },
      onOk: () => run('decline', () => caseService.decline(record.id), `${record.id} sent back for re-evaluation`, true),
    });
  const requestEvidence = () =>
    run('evidence', () => caseService.requestEvidence(record.id), `Evidence requested from ${record.location} for ${record.id}`);
  const openOverride = () => {
    setOvRoute(alternatives.some((r) => r.route === selectedRoute) ? selectedRoute : null);
    setOvReason(null);
    setOverrideOpen(true);
  };
  const submitOverride = async () => {
    if (!ovRoute || !ovReason) return;
    const ok = await run(
      'override',
      () => decisionService.override(record.id, ovRoute, ovReason, user.name),
      `${record.id}: ${DISPOSITION_ROUTES[ovRoute].name} chosen (${ovReason})`,
    );
    if (ok) {
      setOverrideOpen(false);
      setSelectedRoute(null);
    }
  };
  const openSend = () => {
    setPropNote('');
    setSendOpen(true);
  };
  const openPropose = () => {
    setOvRoute(alternatives.some((r) => r.route === selectedRoute) ? selectedRoute : null);
    setOvReason(null);
    setPropNote('');
    setProposeOpen(true);
  };
  const submitSend = async () => {
    const ok = await run(
      'send',
      () => decisionService.proposeRoute(record.id, null, null, propNote, user.name),
      `${record.id} sent to the approver for ${best.routeName}`,
      true,
    );
    if (ok) setSendOpen(false);
  };
  const submitPropose = async () => {
    if (!ovRoute || !ovReason) return;
    const ok = await run(
      'propose',
      () => decisionService.proposeRoute(record.id, ovRoute, ovReason, propNote, user.name),
      `${record.id}: ${DISPOSITION_ROUTES[ovRoute].name} proposed to the approver`,
      true,
    );
    if (ok) {
      setProposeOpen(false);
      setSelectedRoute(null);
    }
  };
  const withdraw = () => run('withdraw', () => decisionService.withdrawProposal(record.id, user.name), `Proposal for ${record.id} withdrawn`);
  const undoOverride = () => run('undo', () => decisionService.clearOverride(record.id), `${record.id} is back on Circularity's route`);
  const recordOutcome = () => run('outcome', () => decisionService.recordOutcome(record.id, user.name), `Outcome recorded for ${record.id}`);

  /* ---------------------------------------------------------------- header actions by role */
  let primary: PageAction | undefined;
  let secondary: PageAction[] = [];
  let metaText: string;
  const dueText = record.dueInDays < 0 ? `${Math.abs(record.dueInDays)}d overdue` : `Due ${date(record.dueDate, true)}`;
  if (isApprover) {
    secondary = [
      ...(canOverride ? [{ key: 'override', label: 'Choose another route', icon: <Shuffle />, onClick: openOverride, disabled: busy !== null }] : []),
      ...(canDecide ? [{ key: 'decline', label: 'Decline', icon: <ThumbsDown />, onClick: decline, disabled: busy !== null }] : []),
    ];
    primary = canDecide
      ? { key: 'approve', label: 'Approve', icon: <CheckCircle />, onClick: () => setApproveOpen(true), disabled: busy !== null }
      : closed
        ? {
            key: 'outcome',
            label: busy === 'outcome' ? 'Recording…' : live.outcome ? 'Record outcome again' : 'Record outcome',
            icon: <ClipboardCheck />,
            onClick: recordOutcome,
            disabled: busy !== null,
          }
        : undefined;
    metaText = dueText;
  } else if (canPropose && !closed) {
    if (openProposal) {
      secondary = [{ key: 'withdraw', label: busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw', icon: <Undo2 />, onClick: withdraw, disabled: busy !== null }];
    } else {
      secondary = alternatives.length ? [{ key: 'propose', label: 'Propose another route', icon: <Shuffle />, onClick: openPropose, disabled: busy !== null }] : [];
      primary = best.viable ? { key: 'send', label: 'Send to approver', icon: <Send />, onClick: openSend, disabled: busy !== null } : undefined;
    }
    metaText = dueText;
  } else {
    metaText = closed ? dueText : `View only as ${currentRole}`;
  }
  // Less frequent actions live in the ⋯ menu so the header stays on one row (primary last, at the right).
  const moreItems = [
    ...(canRequest && (isApprover || canPropose) ? [{ key: 'evidence', label: 'Request evidence', icon: <FileText size={14} />, onClick: requestEvidence, disabled: busy !== null }] : []),
    { key: 'copy', label: 'Copy link', icon: <Link2 size={14} />, onClick: copyPageLink },
  ];

  const missingEvidence = detail.evidence.filter((e) => e.status === 'missing');
  // Execution & Hand-off only exists once the case is approved (derived, so a stale tab falls back).
  const activeTab = tab === 'execution' && !closed ? 'decision' : tab;
  const lifePct = caseContext(record).lifePct;
  const currentStage = meta.journey.find((st) => st.id === detail.journeyStep);

  const proposalText = (p: NonNullable<typeof proposal>) =>
    p.route ? `${DISPOSITION_ROUTES[p.route].name} instead of ${best.routeName} (${p.reason})` : `Circularity's route, ${best.routeName}`;
  const proposalNotice = openProposal && (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-[#075985]">
      <div className="min-w-0 break-words">
        <strong>Proposed by {openProposal.proposedBy}:</strong> {proposalText(openProposal)}
        {openProposal.note ? ` — ${openProposal.note}` : ''}
        {proposedRoute && (
          <span className="text-[#0369A1]">
            {' '}
            · {usd(proposedRoute.net)} ({signed(proposedRoute.net - best.net)} vs recommended)
          </span>
        )}
      </div>
      {isApprover && canDecide && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={decline} disabled={busy !== null} className={smallBtn}>
            <ThumbsDown size={13} aria-hidden /> Decline
          </button>
          <button type="button" onClick={() => setApproveOpen(true)} disabled={busy !== null} className={smallBtn}>
            <CheckCircle size={13} aria-hidden /> Approve {proposedRoute ? DISPOSITION_ROUTES[proposedRoute.route].shortLabel : ''}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full space-y-6 pb-16 font-sans text-[#141416]">
      {/* Stable case header + journey */}
      <Card>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {!inQueue && (
                <>
                  <BackLink />
                  <span className="text-[#CBD5E1]">/</span>
                </>
              )}
              <span className="font-mono text-xs font-bold text-[#0F172A]">{record.id}</span>
              <PriorityBadge priority={record.priority} />
              <StageBadge stage={record.stage} />
              {proposal && (
                <StatusBadge tone="info" icon={<Send size={12} strokeWidth={2.25} />}>
                  {closed ? 'Proposed' : 'Sent for approval'} · by {proposal.proposedBy} · {dateTime(proposal.proposedAt)}
                </StatusBadge>
              )}
            </div>
            <h1 className="m-0 text-2xl font-extrabold leading-tight tracking-tight text-[#141416]">{record.productName}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#64748B]">
              <span>
                Tag <strong className="font-mono text-[#0F172A]">{record.assetTag}</strong>
              </span>
              <span>
                Serial <strong className="font-mono text-[#0F172A]">{record.serialNumber}</strong>
              </span>
              <span>
                <strong className="text-[#0F172A]">{record.location}</strong> · {record.tenant}
              </span>
              <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                {CONDITION_LABEL[record.condition]} · {lifePct} % remaining life
              </span>
            </div>
            {record.decisionNote && (
              <p className="m-0 max-w-2xl break-words text-xs text-[#475569]">
                <strong className="text-[#0F172A]">Decision note:</strong> {record.decisionNote}
              </p>
            )}
          </div>
          {/* Actions keep their natural width on wide screens (the title side truncates/wraps instead). */}
          <div className="flex min-w-0 items-start justify-end gap-2 lg:shrink-0">
            <PageActions primary={primary} secondary={secondary} meta={metaText} />
            <Dropdown trigger={['click']} placement="bottomRight" menu={{ items: moreItems }}>
              <button
                type="button"
                aria-label="More case actions"
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border border-[#E2E8F0] bg-white text-[#141416] shadow-2xs hover:border-gray-400"
              >
                <MoreHorizontal size={15} />
              </button>
            </Dropdown>
          </div>
        </div>

        <div className="mt-4 border-t border-[#F1F5F9] pt-3">
          <button
            type="button"
            onClick={() => setJourneyOpen((o) => !o)}
            aria-expanded={journeyOpen}
            aria-controls="case-journey"
            className="flex cursor-pointer items-center gap-1.5 bg-transparent p-0 text-xs text-[#64748B] hover:text-[#141416]"
          >
            <span>
              Stage {detail.journeyStep} of {meta.journey.length} · <strong className="text-[#0F172A]">{currentStage?.label ?? STAGE_META[record.stage].label}</strong>
            </span>
            <ChevronDown size={14} className={`transition-transform ${journeyOpen ? 'rotate-180' : ''}`} aria-hidden />
            <span className="sr-only">{journeyOpen ? 'Hide' : 'Show'} all stages</span>
          </button>
          {journeyOpen && (
            <div id="case-journey" className="mt-3">
              <ol className="m-0 grid list-none grid-cols-2 gap-1.5 p-0 sm:grid-cols-5 xl:grid-cols-10">
                {meta.journey.map((st) => {
                  const done = st.id < detail.journeyStep;
                  const active = st.id === detail.journeyStep;
                  return (
                    <li
                      key={st.id}
                      title={`${st.id}. ${st.label} (${st.phase})`}
                      aria-current={active ? 'step' : undefined}
                      className={`min-w-0 rounded-lg border p-2 text-center ${
                        active
                          ? 'border-[#EAB308] bg-[#FFD600] font-bold text-black'
                          : done
                            ? 'border-[#CBD5E1] bg-[#F8FAFC] font-semibold text-[#0F172A]'
                            : 'border-[#E2E8F0] bg-white text-[#94A3B8]'
                      }`}
                    >
                      <div className="flex items-start justify-center gap-1 text-[11px] leading-tight">
                        {done ? <Check size={12} className="mt-px shrink-0 text-emerald-600" /> : <span className="font-mono text-[10px]">{st.id}</span>}
                        <span className="line-clamp-2">{st.label}</span>
                      </div>
                      <div className="text-[10px] text-[#64748B]">{active ? 'Current' : done ? 'Done' : 'Pending'}</div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      </Card>

      {inQueue && <QueueBar queue={queue} pos={pos} prevId={prevId} nextId={nextId} highlightNext={acted} />}

      <NextBestActionCard
        action={action}
        decision={decision}
        scenarioLabel={scenarioLabel}
        onResetScenario={resetScenario}
        outcome={live.outcome}
        onUndoOverride={liveDecision.override && !closed && isApprover && !proposed ? undoOverride : undefined}
        undoBusy={busy === 'undo'}
        notice={proposalNotice || undefined}
        onShowCalculation={() => showCalculation(decision.best.route)}
        ladderDescription={`${decision.all.filter((r) => r.viable).length} of ${decision.all.length} viable${scenarioChanged ? ' under the scenario' : ''} · select a route for its calculation`}
        ladder={<RouteLadder decision={decision} selected={calcOpen ? selected.route : null} onSelect={showCalculation} bestLabel={bestLabel} />}
      />

      <Tabs
        activeKey={activeTab}
        onChange={setTab}
        items={[
          { key: 'decision', label: <TabLabel icon={<BrainCircuit size={14} />} text="Alternatives & Decision" /> },
          { key: 'asset', label: <TabLabel icon={<Wrench size={14} />} text="Asset & Condition" /> },
          {
            key: 'evidence',
            label: <TabLabel icon={<ShieldCheck size={14} />} text={`Evidence (${record.evidenceCompleteness}%)`} />,
          },
          ...(closed ? [{ key: 'execution', label: <TabLabel icon={<Send size={14} />} text="Execution & Hand-off" /> }] : []),
        ]}
      />

      {activeTab === 'decision' && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle
              icon={<Sliders />}
              title="Scenario"
              description="Re-decides this case with the rest of the queue fixed. Not saved."
              actions={
                scenarioChanged && (
                  <button type="button" onClick={resetScenario} className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-[#64748B] hover:text-[#141416]">
                    <RotateCcw size={13} /> Reset
                  </button>
                )
              }
            />
            <div className="space-y-5 text-xs">
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="text-[#475569]">Refurbishment cost</span>
                  <span className="font-mono font-bold">{scenario.costMultiplier.toFixed(1)}x</span>
                </div>
                <Slider
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={scenario.costMultiplier}
                  onChange={(v) => setScenario((s) => ({ ...s, costMultiplier: v }))}
                  ariaLabelForHandle="Refurbishment cost multiplier"
                />
                <div className="flex justify-between text-[10px] text-[#64748B]">
                  <span>0.5x</span>
                  <span>Published {money(record.refurbishmentCost)}</span>
                  <span>2.0x</span>
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="text-[#475569]">Secondary market prices</span>
                  <span className="font-mono font-bold">{scenario.marketMultiplier.toFixed(1)}x</span>
                </div>
                <Slider
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={scenario.marketMultiplier}
                  onChange={(v) => setScenario((s) => ({ ...s, marketMultiplier: v }))}
                  ariaLabelForHandle="Secondary market price multiplier"
                />
                <div className="flex justify-between text-[10px] text-[#64748B]">
                  <span>−50%</span>
                  <span>Published 1.0x</span>
                  <span>+100%</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-[#F1F5F9] pt-3">
                <div>
                  <div className="font-semibold text-[#0F172A]">Simulate zero internal demand</div>
                  <div className="text-[10px] text-[#64748B]">Blocks redeploy, re-lease and internal parts</div>
                </div>
                <Switch checked={scenario.noInternalDemand} onChange={(v) => setScenario((s) => ({ ...s, noInternalDemand: v }))} aria-label="Simulate zero internal demand" />
              </div>
            </div>
          </Card>
          <Card>
            <CardTitle
              icon={<ListOrdered />}
              title="Agent trail"
              description="How the 7 agents reached the live decision."
              actions={
                <button
                  type="button"
                  onClick={() => setTrailOpen((o) => !o)}
                  aria-expanded={trailOpen}
                  aria-controls="agent-trail"
                  className="flex cursor-pointer items-center gap-1 bg-transparent p-0 text-xs font-semibold text-[#64748B] hover:text-[#141416]"
                >
                  {trailOpen ? 'Hide' : 'Show'} <ChevronDown size={13} className={`transition-transform ${trailOpen ? 'rotate-180' : ''}`} aria-hidden />
                </button>
              }
            />
            {trailOpen && (
              <div id="agent-trail">
                <AgentTrail steps={live.trail} />
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'asset' && (
        <div className="space-y-6">
          <Card>
            <CardTitle icon={<Wrench />} title="Condition & components" description={`${record.manufacturer} ${record.model} · ${record.category}`} />
            <AssetCondition record={record} detail={detail} />
          </Card>
          <Card>
            <CardTitle icon={<ShieldCheck />} title="Enterprise System Facts" description="From EAM, ERP and WMS records." />
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
              {[
                ['Original acquisition cost', money(record.facts.originalPrice), 'SAP FI'],
                ['In-service age', `${record.facts.ageYears} years`, 'Maximo EAM'],
                ['Last service', date(record.facts.lastServiceDate, true), 'Maximo EAM'],
                ['Warranty', record.facts.warrantyStatus === 'active' ? 'Active coverage' : 'Expired', 'OEM portal'],
                ['WMS bin', record.facts.wmsBinLocation, 'WMS'],
                ['Received', date(record.receivedDate, true), 'WMS'],
                ['Quantity', `${record.quantity}`, 'WMS'],
                ['Case owner', record.owner, 'Circularity'],
              ].map(([k, v, src]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[11px] text-[#64748B]">{k}</dt>
                  <dd className="m-0 truncate font-semibold text-[#0F172A]">
                    {v} <span className="font-normal text-[#94A3B8]">· {src}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      )}

      {activeTab === 'evidence' && (
        <Card>
          <CardTitle
            icon={<ShieldCheck />}
            title="Evidence & Provenance"
            description={missingEvidence.length ? `${missingEvidence.length} item(s) missing: ${missingEvidence.map((e) => e.label.toLowerCase()).join(', ')}` : 'All evidence received'}
            actions={
              canRequest &&
              (isApprover || canPropose) && (
                <button
                  type="button"
                  onClick={requestEvidence}
                  disabled={busy !== null}
                  className="cursor-pointer rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400 disabled:opacity-50"
                >
                  {busy === 'evidence' ? 'Requesting…' : 'Request evidence'}
                </button>
              )
            }
          />
          <div className="mb-4 max-w-md">
            <div className="mb-1 text-[11px] font-semibold text-[#64748B]">Evidence completeness</div>
            <ProgressBar value={record.evidenceCompleteness} tone={record.evidenceCompleteness >= 90 ? 'success' : 'warning'} label="Evidence completeness" showValue />
          </div>
          <Collapse
            size="small"
            items={detail.evidence.map((e) => ({
              key: e.id,
              label: (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#141416]">{e.label}</span>
                  <StatusBadge tone={e.status === 'received' ? 'success' : 'warning'}>{e.status === 'received' ? 'Received' : 'Missing'}</StatusBadge>
                </div>
              ),
              children: (
                <dl className="m-0 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] text-[#64748B]">Source system</dt>
                    <dd className="m-0 font-semibold">{e.source}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#64748B]">Reference</dt>
                    <dd className="m-0 font-mono">{e.reference}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#64748B]">Captured</dt>
                    <dd className="m-0">{e.capturedAt ? date(e.capturedAt, true) : 'Not yet received'}</dd>
                  </div>
                  <div className="sm:col-span-3 text-[#475569]">{e.detail}</div>
                </dl>
              ),
            }))}
          />
        </Card>
      )}

      {activeTab === 'execution' && (
        <Card>
          <CardTitle
            icon={<Send />}
            title="Instructions & Hand-off"
            description={`After approval the work is sent to ${best.executesIn}, where work orders and stock movements are carried out.`}
          />
          {detail.workOrders.length === 0 ? (
            <EmptyState
              compact
              title="No instructions sent yet"
              description={canDecide ? 'Work orders are created once the plan is approved.' : `This case is at "${STAGE_META[record.stage].label}".`}
            />
          ) : (
            <ul className="m-0 list-none divide-y divide-[#F1F5F9] p-0">
              {detail.workOrders.map((wo) => (
                <li key={wo.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-[#0F172A]">
                      {wo.system}: {wo.id}
                    </div>
                    <div className="text-[#64748B]">
                      {wo.title} · due {date(wo.due, true)}
                    </div>
                  </div>
                  <StatusBadge tone={WO_STATUS[wo.status].tone}>{WO_STATUS[wo.status].label}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Drawer
        open={calcOpen}
        onClose={() => setCalcOpen(false)}
        size="min(640px, 100vw)"
        title={
          <span className="inline-flex flex-wrap items-center gap-2 text-sm font-bold">
            <Calculator size={16} className="text-amber-500" aria-hidden />
            Calculation: {selected.routeName}
            {selected.viable && selected.route === decision.best.route && <StatusBadge tone="brand">{bestLabel}</StatusBadge>}
          </span>
        }
      >
        <p className="m-0 mb-3 text-xs text-[#64748B]">Every line with its basis and source{scenarioChanged ? ', under the scenario on screen' : ''}.</p>
        <CalculationTable route={selected} decision={decision} />
      </Drawer>

      <Modal
        title={<span className="text-base font-bold">Approve decision</span>}
        open={approveOpen}
        onCancel={() => setApproveOpen(false)}
        onOk={approve}
        confirmLoading={busy === 'approve'}
        okText={`Approve ${DISPOSITION_ROUTES[target.route].shortLabel}`}
        okButtonProps={{ style: brandOk }}
      >
        <div className="space-y-3 py-2 text-xs text-[#334155]">
          <p className="m-0">
            You are approving <strong>{record.productName}</strong> ({record.id}) for <strong>{target.routeName}</strong> with a forecast net value of{' '}
            <strong className="font-mono text-emerald-700">{usd(target.net)}</strong>.
          </p>
          {openProposal && (
            <p className="m-0 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[#075985]">
              <strong>Proposed by {openProposal.proposedBy}:</strong> {proposalText(openProposal)}
              {openProposal.note ? ` — ${openProposal.note}` : ''}
            </p>
          )}
          {scenarioChanged && <p className="m-0 text-[#92400E]">The scenario on screen is not approved; this approves the live decision.</p>}
          <p className="m-0 text-[#64748B]">The case moves to Approved and the work is sent to {target.executesIn}.</p>
          <label className="block">
            <span className="mb-1 block font-semibold text-[#0F172A]">Approval note (optional, saved on the case)</span>
            <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Inspection verified, internal demand confirmed." />
          </label>
        </div>
      </Modal>

      <Modal
        title={<span className="text-base font-bold">Choose another route</span>}
        open={overrideOpen}
        onCancel={() => setOverrideOpen(false)}
        onOk={submitOverride}
        confirmLoading={busy === 'override'}
        okText="Use this route"
        okButtonProps={{ disabled: !ovRoute || !ovReason, style: ovRoute && ovReason ? brandOk : undefined }}
      >
        <div className="space-y-4 py-2 text-xs text-[#334155]">
          <p className="m-0">
            Circularity recommends <strong>{best.routeName}</strong> at <strong className="font-mono">{usd(best.net)}</strong>. Your choice is logged with your name and reason, and
            used to measure forecast accuracy.
          </p>
          <RoutePicker alternatives={alternatives} bestNet={best.net} value={ovRoute} onChange={setOvRoute} />
          <ReasonSelect value={ovReason} onChange={setOvReason} />
        </div>
      </Modal>

      <Modal
        title={<span className="text-base font-bold">Send to approver</span>}
        open={sendOpen}
        onCancel={() => setSendOpen(false)}
        onOk={submitSend}
        confirmLoading={busy === 'send'}
        okText="Send to approver"
        okButtonProps={{ style: brandOk }}
      >
        <div className="space-y-3 py-2 text-xs text-[#334155]">
          <p className="m-0">
            You are sending <strong>{record.productName}</strong> ({record.id}) for approval on Circularity&apos;s route:
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#0F172A]">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: DISPOSITION_ROUTES[best.route].color }} />
              {best.routeName}
            </span>
            <span className="font-mono font-bold">{usd(best.net)}</span>
          </div>
          <p className="m-0 text-[#64748B]">
            {record.stage === 'awaiting_approval' ? 'The case is already in the Approvals inbox; ' : 'The case moves to Awaiting approval; '}
            the approver sees your name and note. You can withdraw it until it is decided.
          </p>
          <label className="block">
            <span className="mb-1 block font-semibold text-[#0F172A]">Note for the approver (optional)</span>
            <Input.TextArea rows={2} value={propNote} onChange={(e) => setPropNote(e.target.value)} placeholder="e.g. Customer confirmed the renewal by phone." />
          </label>
        </div>
      </Modal>

      <Modal
        title={<span className="text-base font-bold">Propose another route</span>}
        open={proposeOpen}
        onCancel={() => setProposeOpen(false)}
        onOk={submitPropose}
        confirmLoading={busy === 'propose'}
        okText="Send proposal"
        okButtonProps={{ disabled: !ovRoute || !ovReason, style: ovRoute && ovReason ? brandOk : undefined }}
      >
        <div className="space-y-4 py-2 text-xs text-[#334155]">
          <p className="m-0">
            Circularity recommends <strong>{best.routeName}</strong> at <strong className="font-mono">{usd(best.net)}</strong>. Your proposal goes to the approver with your name and
            reason; approving the case applies your route.
          </p>
          <RoutePicker alternatives={alternatives} bestNet={best.net} value={ovRoute} onChange={setOvRoute} />
          <ReasonSelect value={ovReason} onChange={setOvReason} />
          <label className="block">
            <span className="mb-1 block font-semibold text-[#0F172A]">Note for the approver (optional)</span>
            <Input.TextArea rows={2} value={propNote} onChange={(e) => setPropNote(e.target.value)} placeholder="e.g. Customer B asked to buy it outright." />
          </label>
        </div>
      </Modal>
    </div>
  );
}

function RoutePicker({
  alternatives,
  bestNet,
  value,
  onChange,
}: {
  alternatives: { route: RouteId; routeName: string; net: number }[];
  bestNet: number;
  value: RouteId | null;
  onChange: (r: RouteId) => void;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 font-semibold text-[#0F172A]">Route</legend>
      <Radio.Group value={value} onChange={(e) => onChange(e.target.value as RouteId)} className="w-full">
        <div className="flex flex-col gap-1.5">
          {alternatives.map((r) => (
            <Radio key={r.route} value={r.route} className="!m-0 rounded-lg border border-[#E2E8F0] px-3 py-2 !text-xs">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span className="font-semibold text-[#0F172A]">{r.routeName}</span>
                <span className="font-mono">{usd(r.net)}</span>
                <span className="text-[#64748B]">({signed(r.net - bestNet)} vs recommended)</span>
              </span>
            </Radio>
          ))}
        </div>
      </Radio.Group>
    </fieldset>
  );
}

function ReasonSelect({ value, onChange }: { value: OverrideReason | null; onChange: (r: OverrideReason) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block font-semibold text-[#0F172A]">Reason (required)</span>
      <Select<OverrideReason>
        className="w-full"
        placeholder="Select a reason"
        value={value ?? undefined}
        onChange={(v) => onChange(v)}
        options={OVERRIDE_REASONS.map((r) => ({ value: r, label: r }))}
        aria-label="Reason"
      />
    </label>
  );
}

/** Slim bar under the header when the case was opened from a queue: back, position, previous / next. */
function QueueBar({ queue, pos, prevId, nextId, highlightNext }: { queue: QueueContext; pos: number; prevId: string | null; nextId: string | null; highlightNext: boolean }) {
  const link = 'inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-[#141416] no-underline hover:bg-[#F1F5F9] focus-visible:outline-2 focus-visible:outline-[#141416]';
  return (
    <nav aria-label="Queue" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-[#E2E8F0] bg-white px-2 py-1 text-xs shadow-2xs">
      <Link href={queue.href} className={link}>
        <ArrowLeft size={13} aria-hidden /> Back to {queue.name}
      </Link>
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-2 text-[#64748B]" aria-live="polite">
          Case <strong className="font-mono text-[#0F172A]">{pos + 1}</strong> of <span className="font-mono">{queue.ids.length}</span>
        </span>
        {prevId ? (
          <Link href={caseHref(prevId)} className={link} aria-label={`Previous case, ${prevId}`}>
            <ChevronLeft size={13} aria-hidden /> Previous
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[#94A3B8]" aria-disabled="true">
            <ChevronLeft size={13} aria-hidden /> Previous
          </span>
        )}
        {nextId ? (
          <Link
            href={caseHref(nextId)}
            aria-label={`Next case, ${nextId}`}
            className={`${link} ${highlightNext ? 'border border-[#EAB308] bg-[#FFD600] hover:bg-[#FACC15]' : ''}`}
          >
            Next case <ArrowRight size={13} aria-hidden />
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[#94A3B8]">Last case in this queue</span>
        )}
      </div>
    </nav>
  );
}

function BackLink() {
  return (
    <Link href="/product/received" className="flex items-center gap-1 text-xs font-semibold text-[#64748B] transition-colors hover:text-[#0F172A]">
      <ArrowLeft size={13} /> Returned assets
    </Link>
  );
}

function TabLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold">
      {icon}
      {text}
    </span>
  );
}

function CaseSkeleton() {
  return (
    <div className="w-full space-y-6 pb-16" aria-busy="true">
      <Card>
        <Skeleton className="h-3 w-48" />
        <Skeleton className="mt-3 h-7 w-72 max-w-full" />
        <Skeleton className="mt-3 h-3 w-96 max-w-full" />
        <Skeleton className="mt-5 h-3 w-40" />
      </Card>
      <Skeleton className="h-48 rounded-2xl" />
      <Card>
        <ChartSkeleton height={220} />
      </Card>
    </div>
  );
}
