"use client";

import React, { use, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Checkbox,
  Collapse,
  Drawer,
  Dropdown,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Slider,
  Switch,
  Tabs,
  message,
} from "antd";
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Calculator,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  Bookmark,
  ClipboardCheck,
  Columns3,
  Cpu,
  Megaphone,
  MessageSquare,
  Microscope,
  RefreshCw,
  Trash2,
  FileDown,
  FileText,
  Printer,
  ScrollText,
  Link2,
  ListOrdered,
  MoreHorizontal,
  RotateCcw,
  Scale,
  Send,
  ShieldCheck,
  Shuffle,
  Sliders,
  ThumbsDown,
  Undo2,
  Wrench,
} from "lucide-react";
import { useServiceQuery } from "@/hooks/useServiceQuery";
import { useAuth } from "@/store/authContext";
import { caseService } from "@/services/caseService";
import {
  approvalRecord,
  caseContext,
  decisionInsights,
  decisionService,
  getReevaluation,
  handoffInstructions,
  handoffStage,
  instructionPreview,
  OVERRIDE_REASONS,
  PRESETS,
  rankingFlips,
  stressCase,
  usd,
  type CaseLevers,
} from "@/services/decisionService";
import {
  BASE_SCENARIO,
  CONDITION_LABEL,
  INTERNAL_ROUTES,
  isBaseScenario,
  productService,
  scenarioDecision,
  type RouteScenario,
} from "@/services/productService";
import type {
  OverrideReason,
  PresetId,
  RouteId,
} from "@/models/decision.model";
import type { UserRole } from "@/models/user.model";
import type { HandoffInstruction } from "@/models/decision.model";
import type { InspectionResult } from "@/models/domain.model";
import {
  AUTO_APPROVER,
  caseLifecycleService,
  type Actor,
} from "@/services/caseLifecycleService";
import { scenarioService } from "@/services/scenarioService";
import { StagePanel } from "@/components/product/stages/StagePanel";
import {
  CommentThread,
  useCommentCount,
} from "@/components/common/CommentThread";
import { EscalateButton } from "@/components/command/EscalateModal";
import { SimilarAssets } from "@/components/product/SimilarAssets";
import { DISPOSITION_ROUTES } from "@/constants/routes.constants";
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
} from "@/components/ui";
import { AssetCondition } from "@/components/product/AssetCondition";
import {
  AgentTrail,
  CalculationTable,
  NextBestActionCard,
  RouteLadder,
} from "@/components/product/CaseDecision";
import {
  CompareTop3,
  GateList,
  InstructionTable,
  PresetBar,
  RouteValueChart,
  WhyNotPanel,
} from "@/components/product/decision/DecisionInsights";
import {
  downloadEvidencePack,
  evidencePackRows,
  printEvidencePack,
} from "@/components/product/decision/evidencePack";
import { Card, CardTitle, copyPageLink } from "@/components/product/ui";
import {
  caseHref,
  useQueueContext,
  type QueueContext,
} from "@/components/product/queueContext";
import { date, dateTime, money } from "@/utils/format";

/** Roles that work cases but cannot approve: they send a route to an approver instead. */
const PROPOSER_ROLES: UserRole[] = ["Planner", "Engineer", "Warehouse Manager"];
/** Roles that sign off (each within its own limit, see caseLifecycleService.approvalPolicy). */
const SIGNER_ROLES: UserRole[] = ["Approver", "Admin", "Executive"];
/** Roles that send the hand-off instructions of an approved case. */
const SENDER_ROLES: UserRole[] = ["Planner", "Approver", "Admin", "Warehouse Manager"];
/** Roles that may play the executing systems' events in this demo. */
const SIMULATOR_ROLES: UserRole[] = ["Admin", "Developer"];
const RESENDER_ROLES: UserRole[] = ["Planner", "Approver", "Admin", "Developer", "Warehouse Manager"];
const INSPECTOR_ROLES: UserRole[] = ["Engineer", "Admin"];
const REEVALUATOR_ROLES: UserRole[] = ["Planner", "Admin"];
const OUTCOME_LABEL = { pending_invoice: "pending invoice", confirmed: "receipt confirmed", reconciled: "reconciled" } as const;

const PRESET_LABEL = Object.fromEntries(
  PRESETS.map((p) => [p.id, p.label]),
) as Record<PresetId, string>;

const brandOk = {
  backgroundColor: "#FFD600",
  color: "#000000",
  borderColor: "#FFD600",
  fontWeight: 700,
};
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
const smallBtn =
  "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50";

export default function CaseDecisionWorkbenchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const caseId = decodeURIComponent(id);
  const router = useRouter();
  const { currentRole, user, scope } = useAuth();
  const actor: Actor = { id: user.id, name: user.name, role: currentRole };
  // Signs off (within its limit) and sees the approver's actions: Approver, Admin, Executive.
  const isApprover = SIGNER_ROLES.includes(currentRole);
  const meta = caseService.meta();
  const queue = useQueueContext();

  const assetQ = useServiceQuery(() => productService.asset(caseId), [caseId], {
    subscribe: caseService.subscribe,
  });
  const decisionQ = useServiceQuery(
    async () => {
      const [decision, action, trail, history, proposed] = await Promise.all([
        decisionService.decision(caseId),
        decisionService.nextBestAction(caseId),
        decisionService.agentTrail(caseId),
        decisionService.history({ search: caseId, pageSize: 5 }),
        decisionService.proposedAction(caseId),
      ]);
      return {
        decision,
        action,
        trail,
        proposed,
        outcome: history.items.find((h) => h.caseId === caseId) ?? null,
      };
    },
    [caseId],
    { subscribe: decisionService.subscribe },
  );
  const [tab, setTab] = useState("decision");
  const [scenario, setScenario] = useState<RouteScenario>(BASE_SCENARIO);
  const [selectedRoute, setSelectedRoute] = useState<RouteId | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [ovRoute, setOvRoute] = useState<RouteId | null>(null);
  const [ovReason, setOvReason] = useState<OverrideReason | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [propNote, setPropNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [trailOpen, setTrailOpen] = useState(false);
  // The case the user last approved / declined / sent from this page (highlights "Next case").
  const [actedOn, setActedOn] = useState<string | null>(null);
  // Edge-case preset on top of the scenario levers (session only, never saved).
  const [preset, setPreset] = useState<PresetId | null>(null);
  const [applyTo, setApplyTo] = useState<"all" | RouteId>("all");
  const [previewOpen, setPreviewOpen] = useState<boolean | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  const [stagePanel, setStagePanel] = useState<number | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [insp, setInsp] = useState<{ grade: InspectionResult["grade"]; test: InspectionResult["test"]; lifePct: number | null; notes: string; photos: boolean }>({ grade: "B", test: "pass", lifePct: null, notes: "", photos: true });
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState("");
  const commentCount = useCommentCount("case", caseId);
  const savedAll = useSyncExternalStore(scenarioService.subscribe, scenarioService.all, scenarioService.all);
  const saved = useMemo(() => savedAll.filter((x) => x.caseId === caseId), [savedAll, caseId]);

  const record = assetQ.data?.record;
  const detail = assetQ.data?.detail;
  const live = decisionQ.data;
  const scenarioChanged = !isBaseScenario(scenario) || preset !== null;
  const levers: CaseLevers = useMemo(
    () =>
      isBaseScenario(scenario)
        ? {}
        : {
            params: {
              refurbCostIndex: scenario.costMultiplier,
              resalePriceIndex: scenario.marketMultiplier,
            },
            blocked: scenario.noInternalDemand ? INTERNAL_ROUTES : undefined,
          },
    [scenario],
  );
  // Scenario levers and presets re-decide this case with the rest of the queue plan fixed (derived during render).
  const simulated = useMemo(() => {
    if (!record || !scenarioChanged) return null;
    return preset
      ? stressCase(record, levers, preset, applyTo)
      : scenarioDecision(record, scenario);
  }, [record, scenario, scenarioChanged, preset, applyTo, levers]);
  // Which presets flip the ranking under the current levers (recomputed when the case or levers change).
  const flips = useMemo(
    () => (record ? rankingFlips(record, levers) : []),
    [record, levers],
  );

  // Position in the queue the case was opened from (sessionStorage, see queueContext).
  const pos = queue ? queue.ids.indexOf(caseId) : -1;
  const inQueue = !!queue && pos >= 0;
  const prevId = inQueue && pos > 0 ? queue.ids[pos - 1] : null;
  const nextId =
    inQueue && pos < queue.ids.length - 1 ? queue.ids[pos + 1] : null;

  if (assetQ.initialLoading || decisionQ.initialLoading)
    return <CaseSkeleton />;
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
              <Link
                href="/product/received"
                className="text-xs font-semibold text-[#141416] underline"
              >
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
  const closed = record.stage === "approved" || record.stage === "handed_off";
  const openProposal = !closed && proposal ? proposal : null;
  const proposedRoute = openProposal?.route
    ? (liveDecision.all.find((r) => r.route === openProposal.route) ?? null)
    : null;
  // What an approval applies: the proposed route when one was proposed, else Circularity's route.
  const target = proposedRoute ?? best;
  const canDecide = record.stage === "awaiting_approval" && target.viable;
  // Approval limits (caseLifecycleService.approvalPolicy): Approver up to the delegation limit, then escalate.
  const policy = caseLifecycleService.approvalPolicy(record.id, actor);
  const escalation = caseLifecycleService.escalation(record.id);
  const plannerCanApprove = currentRole === "Planner" && policy.allowed;
  const needsInspection = record.stage === "awaiting_inspection" || record.stage === "needs_information";
  const canInspect = needsInspection && INSPECTOR_ROLES.includes(currentRole);
  const sendBlock = caseLifecycleService.sendBlockReason(record.id);
  const canReevaluate = ["reevaluate", "ready_for_decision", "no_viable_route"].includes(record.stage) && REEVALUATOR_ROLES.includes(currentRole);
  const declined = caseLifecycleService.declineOf(record.id);
  const reevaluation = getReevaluation(record.id);
  const autoCheck = !closed && record.stage !== "awaiting_approval" ? caseLifecycleService.autoApprovePolicy(record.id) : null;
  const canRequest = [
    "awaiting_inspection",
    "awaiting_approval",
    "reevaluate",
  ].includes(record.stage);
  const alternatives = liveDecision.all.filter(
    (r) => r.viable && r.route !== best.route,
  );
  const canOverride = !closed && alternatives.length > 0;
  // Admin has every case action: the Planner's (send, propose, withdraw, re-evaluate) and the signer's.
  const isAdmin = currentRole === "Admin";
  const canPropose = (!isApprover && PROPOSER_ROLES.includes(currentRole)) || isAdmin;
  const selected =
    decision.all.find((r) => r.route === selectedRoute) ?? decision.best;
  const scenarioLabel = scenarioChanged
    ? [
        scenario.costMultiplier !== 1 &&
          `refurbishment cost ${scenario.costMultiplier.toFixed(1)}x`,
        scenario.marketMultiplier !== 1 &&
          `market prices ${scenario.marketMultiplier.toFixed(1)}x`,
        scenario.noInternalDemand && "no internal demand",
        preset &&
          `${PRESET_LABEL[preset].toLowerCase()}${applyTo === "all" ? "" : ` (only ${DISPOSITION_ROUTES[applyTo].name})`}`,
      ]
        .filter(Boolean)
        .join(", ")
    : null;
  const bestLabel = closed
    ? "Approved"
    : proposed
      ? "Proposed"
      : decision.override
        ? "Chosen"
        : "Best";
  const resetScenario = () => {
    setScenario(BASE_SCENARIO);
    setPreset(null);
  };
  const acted = actedOn === record.id;

  // Gates, ranges, confidence and snapshot (decision/insights.ts), for the live decision and the one on screen.
  const liveInsights = decisionInsights(record, liveDecision);
  const insights =
    decision === liveDecision
      ? liveInsights
      : decisionInsights(record, decision);
  const approval = closed ? approvalRecord(record.id) : null;
  const snapshot = approval
    ? { id: approval.snapshotId, frozen: true }
    : liveInsights
      ? { id: liveInsights.snapshotId, frozen: false }
      : null;
  const targetInsight = liveInsights?.routes[target.route] ?? null;
  const bestRange = liveInsights?.routes[best.route].range ?? null;
  // What approval sends (open cases) / what it sent, with due times (approved cases).
  const preview =
    !closed && target.viable
      ? instructionPreview(record.id, target.route)
      : undefined;
  const handoff = closed ? handoffInstructions(record.id) : [];
  const handoffState = closed ? handoffStage(handoff) : null;
  const outcomeRow = closed ? caseLifecycleService.outcomeOf(record.id) : null;
  const autoApproved = approval?.actor === AUTO_APPROVER;
  // Journey step: delivered = 9 (Action & return outcome), reconciled = 10 (Reconcile & learn).
  const journeyStep = outcomeRow?.status === "reconciled" ? 10 : handoffState === "delivered" ? 9 : detail.journeyStep;
  // Collapsed by default so the tabs stay near the fold; the summary line is always visible and the Approve modal lists every instruction.
  const showPreview = previewOpen ?? false;
  const presetFlip =
    preset && simulated
      ? simulated.decision.best.route !== liveDecision.best.route ||
        !simulated.decision.best.viable
      : false;
  const presetNoop =
    !!preset &&
    (simulated as { stress?: { affects: boolean } | null } | null)?.stress
      ?.affects === false;
  const openPack = () => setPackOpen(true);
  const packRows = () =>
    liveInsights
      ? evidencePackRows(
          record,
          liveDecision,
          liveInsights,
          approval,
          detail.evidence.map((e) => ({
            label: e.label,
            source: e.source,
            status: e.status === "received" ? "Received" : "Missing",
            reference: e.reference,
            capturedAt: e.capturedAt,
          })),
          preview ?? (closed ? (instructionPreview(record.id) ?? null) : null),
        )
      : [];

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
          {text}{" "}
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

  const run = async (
    key: string,
    fn: () => Promise<unknown>,
    done: string,
    offerNext = false,
  ) => {
    setBusy(key);
    try {
      await fn();
      toast(done, offerNext);
      if (offerNext) setActedOn(record.id);
      return true;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    const ok = await run(
      "approve",
      () => caseLifecycleService.approve(record.id, actor, note),
      `${record.id} approved for ${target.routeName}`,
      true,
    );
    if (ok) {
      setApproveOpen(false);
      setNote("");
    }
  };
  const approveDirect = () =>
    Modal.confirm({
      title: `Approve ${record.id} directly?`,
      content: `You submit and approve ${best.routeName} (${usd(best.net)}) in one step, with no separate submitter. Admin has no approval limit; the audit log records "Approved directly by Admin (no separate submitter)".`,
      okText: "Approve directly",
      okButtonProps: { style: brandOk },
      onOk: () =>
        run(
          "approve-direct",
          () => caseLifecycleService.approveDirectly(record.id, actor),
          `${record.id} approved directly for ${best.routeName}`,
          true,
        ),
    });
  const escalate = () =>
    run(
      "escalate",
      () => caseLifecycleService.escalateToExecutive(record.id, actor),
      `${record.id} escalated to the Executive for sign-off (${usd(policy.net)} is above your ${usd(policy.limit ?? 0)} limit)`,
    );
  const decline = () => {
    setDeclineReason("");
    setDeclineOpen(true);
  };
  const submitDecline = async () => {
    const ok = await run(
      "decline",
      () => caseLifecycleService.decline(record.id, actor, declineReason),
      `${record.id} sent back to the Planner for re-evaluation`,
      true,
    );
    if (ok) setDeclineOpen(false);
  };
  const requestEvidence = () =>
    run(
      "evidence",
      () => caseLifecycleService.requestEvidence(record.id, actor),
      `Evidence requested for ${record.id}: the Engineer has a task to record the inspection result`,
    );
  const openInspect = () => {
    const g = record.condition;
    setInsp({ grade: g === "A" || g === "B" || g === "C" || g === "D" ? g : "D", test: "pass", lifePct: caseContext(record).lifePct, notes: "", photos: true });
    setInspectOpen(true);
  };
  const submitInspection = async () => {
    if (insp.lifePct === null) return;
    setBusy("inspect");
    try {
      const r = await caseLifecycleService.recordInspection(
        record.id,
        { grade: insp.grade, test: insp.test, lifePct: insp.lifePct, notes: insp.notes, photosReceived: insp.photos },
        actor,
      );
      message.success({
        duration: 6,
        content: `Inspection recorded for ${record.id}: evidence ${r.evidenceCompleteness} %, new snapshot ${r.snapshotId}. ${r.summary} Now ${STAGE_META[r.stage].label.toLowerCase()}.`,
      });
      setInspectOpen(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };
  const reevaluate = async () => {
    setBusy("reevaluate");
    try {
      const r = await caseLifecycleService.reevaluate(record.id, actor);
      message.success({ duration: 6, content: `${record.id} re-evaluated. ${r.summary}` });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };
  const openOverride = () => {
    setOvRoute(
      alternatives.some((r) => r.route === selectedRoute)
        ? selectedRoute
        : null,
    );
    setOvReason(null);
    setOverrideOpen(true);
  };
  const submitOverride = async () => {
    if (!ovRoute || !ovReason) return;
    const ok = await run(
      "override",
      () => caseLifecycleService.override(record.id, ovRoute, ovReason, actor),
      `${record.id}: ${DISPOSITION_ROUTES[ovRoute].name} chosen (${ovReason})`,
    );
    if (ok) {
      setOverrideOpen(false);
      setSelectedRoute(null);
    }
  };
  const openSend = () => {
    setPropNote("");
    setSendOpen(true);
  };
  const openPropose = () => {
    setOvRoute(
      alternatives.some((r) => r.route === selectedRoute)
        ? selectedRoute
        : null,
    );
    setOvReason(null);
    setPropNote("");
    setProposeOpen(true);
  };
  const submitSend = async () => {
    setBusy("send");
    try {
      const r = await caseLifecycleService.sendToApprover(record.id, actor, { note: propNote });
      if (r.autoApproved) {
        message.success({
          duration: 8,
          content: `${record.id} auto-approved within policy by Circularity: ${usd(r.autoApproved.net)} is below the ${usd(autoCheck?.threshold ?? 0)} threshold, Grade A, every gate OK (${r.autoApproved.ref}).`,
        });
      } else toast(`${record.id} sent to the approver for ${best.routeName}`, true);
      setActedOn(record.id);
      setSendOpen(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };
  const submitPropose = async () => {
    if (!ovRoute || !ovReason) return;
    const ok = await run(
      "propose",
      () => caseLifecycleService.sendToApprover(record.id, actor, { route: ovRoute, reason: ovReason, note: propNote }),
      `${record.id}: ${DISPOSITION_ROUTES[ovRoute].name} proposed to the approver`,
      true,
    );
    if (ok) {
      setProposeOpen(false);
      setSelectedRoute(null);
    }
  };
  const withdraw = () =>
    run(
      "withdraw",
      () => caseLifecycleService.withdraw(record.id, actor),
      `Submission for ${record.id} withdrawn`,
    );
  const undoOverride = () =>
    run(
      "undo",
      () => decisionService.clearOverride(record.id),
      `${record.id} is back on Circularity's route`,
    );
  const sendInstruction = () =>
    run(
      "instruct",
      async () => {
        await caseLifecycleService.sendInstruction(record.id, actor);
        setTab("execution");
      },
      `Hand-off instructions for ${record.id} sent to the executing systems`,
    );
  const stepAck = (i: HandoffInstruction) =>
    run(
      `step-${i.id}`,
      () => caseLifecycleService.acknowledgeStep(record.id, i.id, actor),
      `Simulated: ${i.system} acknowledged "${i.instruction}"`,
    );
  const stepDone = (i: HandoffInstruction) =>
    run(
      `step-${i.id}`,
      async () => {
        const r = await caseLifecycleService.completeStep(record.id, i.id, actor);
        if (r.delivered) message.info(`${record.id} delivered: the outcome is in Finance's Outcomes to confirm.`, 6);
      },
      `Simulated: ${i.system} reported "${i.instruction}" done`,
    );
  const stepResend = (i: HandoffInstruction) =>
    run(
      `step-${i.id}`,
      () => caseLifecycleService.resend(record.id, i.id, actor),
      `${i.doc} resent to ${i.system} (same instruction, no duplicate)`,
    );
  const confirmOutcome = () => router.push(`/command/actions?tab=outcomes&case=${record.id}`);
  const trackHandoff = () => setTab("execution");
  const saveScenario = () => {
    const d = simulated?.decision ?? liveDecision;
    try {
      scenarioService.save({
        caseId: record.id,
        name: scenarioName,
        scenario,
        preset,
        applyTo,
        routeName: d.best.routeName,
        net: d.best.net,
        savedBy: `${user.name} (${currentRole})`,
      });
      message.success(`Scenario "${scenarioName.trim()}" saved for this session`);
      setSaveOpen(false);
      setScenarioName("");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not save");
    }
  };

  /* ---------------------------------------------------------------- header actions by role */
  let primary: PageAction | undefined;
  let secondary: PageAction[] = [];
  let metaText: React.ReactNode;
  // Due state as a pill with context: overdue hand-off instructions first, then the case due date.
  const lateSteps = handoff.filter((i) => i.overdue);
  const lateDays = Math.abs(record.dueInDays);
  const notDone = handoff.filter((i) => i.status !== "done").length;
  const duePill = (tone: "danger" | "warning", text: string, tip: string) => (
    <span
      tabIndex={0}
      data-tip={tip}
      className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-[#141416]"
    >
      <StatusBadge tone={tone}>{text}</StatusBadge>
    </span>
  );
  const dueText: React.ReactNode = lateSteps.length
    ? duePill(
        "danger",
        `Hand-off ${Math.max(...lateSteps.map((i) => i.overdueHours)) >= 9 ? `${Math.round(Math.max(...lateSteps.map((i) => i.overdueHours)) / 9)}d` : `${Math.ceil(Math.max(...lateSteps.map((i) => i.overdueHours)))}h`} overdue`,
        lateSteps
          .map(
            (i) =>
              `${i.system}: ${i.instruction}, due ${dateTime(i.dueAt ?? "")}`,
          )
          .join(" · "),
      )
    : record.dueInDays < 0
      ? closed
        ? duePill(
            "warning",
            notDone
              ? `Hand-off ${lateDays}d overdue`
              : `Closed ${lateDays}d after due`,
            `Case due ${date(record.dueDate, true)}. ${handoff.length - notDone} of ${handoff.length} hand-off instructions done; none past its own time limit.`,
          )
        : duePill(
            "warning",
            `Decision ${lateDays}d overdue`,
            `Case due ${date(record.dueDate, true)}; ${record.stage === "awaiting_approval" ? "waiting for approval" : "decision still open"}.`,
          )
      : `Due ${date(record.dueDate, true)}`;
  const isFinance = currentRole === "Finance";
  const outcomeOpen = !!outcomeRow && outcomeRow.status !== "reconciled";
  // After approval: send the instructions, then track them; Finance confirms the reported outcome.
  const closedPrimary = (): PageAction | undefined => {
    if (isFinance || (currentRole === "Admin" && outcomeOpen)) {
      if (outcomeOpen) return { key: "confirm-outcome", label: "Confirm outcome", icon: <ClipboardCheck />, onClick: confirmOutcome };
    }
    if (record.stage === "approved" && SENDER_ROLES.includes(currentRole)) {
      return { key: "instruct", label: busy === "instruct" ? "Sending…" : "Send instruction", icon: <Send />, onClick: sendInstruction, disabled: busy !== null };
    }
    // Delivered and waiting on Finance: say who acts next instead of offering a button that does nothing new.
    if (outcomeOpen) {
      return {
        key: "waiting-finance",
        label: "Waiting on Finance",
        icon: <ClipboardCheck />,
        onClick: trackHandoff,
        disabled: true,
        tip: "Delivered. Finance confirms the actual outcome next (My work › Outcomes to confirm).",
      };
    }
    if (outcomeRow?.status === "reconciled") return undefined;
    return { key: "track", label: "Track hand-off", icon: <Send />, onClick: trackHandoff };
  };
  if (closed) {
    primary = closedPrimary();
    metaText = dueText;
  } else if (canInspect) {
    primary = { key: "inspect", label: "Record inspection result", icon: <Microscope />, onClick: openInspect, disabled: busy !== null };
    metaText = dueText;
  } else if (isApprover && record.stage === "awaiting_approval") {
    secondary = [
      ...(isAdmin && openProposal
        ? [
            {
              key: "withdraw",
              label: busy === "withdraw" ? "Withdrawing…" : "Withdraw",
              icon: <Undo2 />,
              onClick: withdraw,
              disabled: busy !== null,
            },
          ]
        : []),
      ...(canOverride
        ? [
            {
              key: "override",
              label: "Choose another route",
              icon: <Shuffle />,
              onClick: openOverride,
              disabled: busy !== null,
            },
          ]
        : []),
      ...(canDecide
        ? [
            {
              key: "decline",
              label: "Decline",
              icon: <ThumbsDown />,
              onClick: decline,
              disabled: busy !== null,
            },
          ]
        : []),
    ];
    primary = canDecide
      ? policy.canEscalate
        ? {
            key: "escalate",
            label: busy === "escalate" ? "Escalating…" : "Escalate to Executive",
            icon: <Megaphone />,
            onClick: escalate,
            disabled: busy !== null,
          }
        : {
            key: "approve",
            label: "Approve",
            icon: <CheckCircle />,
            onClick: () => setApproveOpen(true),
            disabled: busy !== null || !policy.allowed,
            tip: policy.allowed ? undefined : escalation ? `${policy.reason}. Escalated to the Executive by ${escalation.by}.` : (policy.reason ?? undefined),
          }
      : undefined;
    metaText = dueText;
  } else if (canPropose) {
    if (openProposal) {
      secondary = [
        {
          key: "withdraw",
          label: busy === "withdraw" ? "Withdrawing…" : "Withdraw",
          icon: <Undo2 />,
          onClick: withdraw,
          disabled: busy !== null,
        },
      ];
      if (plannerCanApprove) primary = { key: "approve", label: "Approve", icon: <CheckCircle />, onClick: () => setApproveOpen(true), disabled: busy !== null };
    } else if (record.stage === "reevaluate" || record.stage === "no_viable_route") {
      primary = canReevaluate
        ? { key: "reevaluate", label: busy === "reevaluate" ? "Re-evaluating…" : "Re-evaluate", icon: <RefreshCw />, onClick: reevaluate, disabled: busy !== null }
        : undefined;
    } else {
      secondary = alternatives.length
        ? [
            {
              key: "propose",
              label: "Propose another route",
              icon: <Shuffle />,
              onClick: openPropose,
              disabled: busy !== null || !!sendBlock,
              tip: sendBlock ?? undefined,
            },
          ]
        : [];
      if (isAdmin && best.viable)
        secondary.push({
          key: "approve-direct",
          label: busy === "approve-direct" ? "Approving…" : "Approve directly",
          icon: <CheckCircle />,
          onClick: approveDirect,
          disabled: busy !== null || !!sendBlock,
          tip: sendBlock ?? undefined,
        });
      primary = best.viable
        ? {
            key: "send",
            label: "Send to approver",
            icon: <Send />,
            onClick: openSend,
            disabled: busy !== null || !!sendBlock,
            tip: sendBlock ?? undefined,
          }
        : undefined;
    }
    metaText = dueText;
  } else if (isApprover) {
    // Approver / Executive on a case nobody has sent yet: the Planner works it first.
    metaText = dueText;
  } else {
    metaText = `View only as ${currentRole}`;
  }
  // Less frequent actions live in the ⋯ menu so the header stays on one row (primary last, at the right).
  const moreItems = [
    ...(isAdmin && canOverride && record.stage !== "awaiting_approval" && !needsInspection
      ? [
          {
            key: "override",
            label: "Choose another route",
            icon: <Shuffle size={14} />,
            onClick: openOverride,
            disabled: busy !== null,
          },
        ]
      : []),
    ...(canReevaluate && record.stage === "ready_for_decision"
      ? [
          {
            key: "reevaluate",
            label: "Re-evaluate",
            icon: <RefreshCw size={14} />,
            onClick: reevaluate,
            disabled: busy !== null,
          },
        ]
      : []),
    ...(canRequest && (isApprover || canPropose)
      ? [
          {
            key: "evidence",
            label: "Request evidence",
            icon: <FileText size={14} />,
            onClick: requestEvidence,
            disabled: busy !== null,
          },
        ]
      : []),
    ...(liveInsights
      ? [
          {
            key: "pack",
            label: "Evidence pack",
            icon: <FileDown size={14} />,
            onClick: openPack,
          },
        ]
      : []),
    {
      key: "copy",
      label: "Copy link",
      icon: <Link2 size={14} />,
      onClick: copyPageLink,
    },
  ];

  const missingEvidence = detail.evidence.filter((e) => e.status === "missing");
  // Execution & Hand-off only exists once the case is approved (derived, so a stale tab falls back).
  const activeTab = tab === "execution" && !closed ? "decision" : tab;
  const lifePct = caseContext(record).lifePct;
  const currentStage = meta.journey.find((st) => st.id === journeyStep);

  const proposalText = (p: NonNullable<typeof proposal>) =>
    p.route
      ? `${DISPOSITION_ROUTES[p.route].name} instead of ${best.routeName} (${p.reason})`
      : `Circularity's route, ${best.routeName}`;
  const lifecycleNotice =
    !closed && record.stage === "reevaluate" && declined ? (
      <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-[#92400E]">
        <strong>Declined by {declined.actor}:</strong> {declined.reason}{" "}
        <span className="text-[#B45309]">
          ({declined.routeName} {usd(declined.net)}). Re-evaluate to rebuild the routes on a new evidence snapshot.
        </span>
      </div>
    ) : !closed && reevaluation && record.stage !== "awaiting_approval" ? (
      <div role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-[#075985]">
        <strong>Re-evaluated by {reevaluation.actor}:</strong> {reevaluation.summary}
        {reevaluation.declineReason ? ` Declined because: ${reevaluation.declineReason}.` : ""}{" "}
        <span className="font-mono">{reevaluation.fromSnapshotId} → {reevaluation.toSnapshotId}</span>
      </div>
    ) : !closed && escalation ? (
      <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-[#92400E]">
        <strong>Escalated to the {escalation.to}</strong> by {escalation.by}: {usd(escalation.net)} is above the {usd(escalation.limit)} Approver limit; waiting for Executive sign-off.
      </div>
    ) : null;
  const proposalNotice = openProposal && (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-[#075985]"
    >
      <div className="min-w-0 break-words">
        <strong>Proposed by {openProposal.proposedBy}:</strong>{" "}
        {proposalText(openProposal)}
        {openProposal.note ? ` — ${openProposal.note}` : ""}
        {proposedRoute && (
          <span className="text-[#0369A1]">
            {" "}
            · {usd(proposedRoute.net)} ({signed(proposedRoute.net - best.net)}{" "}
            vs recommended)
          </span>
        )}
      </div>
      {isApprover && canDecide && policy.allowed && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={decline}
            disabled={busy !== null}
            className={smallBtn}
          >
            <ThumbsDown size={13} aria-hidden /> Decline
          </button>
          <button
            type="button"
            onClick={() => setApproveOpen(true)}
            disabled={busy !== null}
            className={smallBtn}
          >
            <CheckCircle size={13} aria-hidden /> Approve{" "}
            {proposedRoute
              ? DISPOSITION_ROUTES[proposedRoute.route].shortLabel
              : ""}
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
              <span className="font-mono text-xs font-bold text-[#0F172A]">
                {record.id}
              </span>
              <PriorityBadge priority={record.priority} />
              <StageBadge stage={record.stage} />
              {proposal && !autoApproved && (
                <StatusBadge
                  tone="info"
                  icon={<Send size={12} strokeWidth={2.25} />}
                >
                  {closed ? "Proposed" : "Sent for approval"} · by{" "}
                  {proposal.proposedBy} · {dateTime(proposal.proposedAt)}
                </StatusBadge>
              )}
              {autoApproved && (
                <span tabIndex={0} data-tip={`Approved automatically by Circularity within policy (${approval?.ref}): below the auto-approve threshold, Grade A, every gate OK.`} className="inline-flex rounded-full">
                  <StatusBadge tone="info">Auto-approved within policy</StatusBadge>
                </span>
              )}
              {handoffState === "delivered" && (
                <StatusBadge tone="success">
                  Delivered{outcomeRow ? ` · outcome ${OUTCOME_LABEL[outcomeRow.status]}` : ""}
                </StatusBadge>
              )}
              {!closed && escalation && <StatusBadge tone="warning">Escalated to Executive</StatusBadge>}
            </div>
            <h1 className="m-0 text-2xl font-extrabold leading-tight tracking-tight text-[#141416]">
              {record.productName}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#64748B]">
              <span>
                Tag{" "}
                <strong className="font-mono text-[#0F172A]">
                  {record.assetTag}
                </strong>
              </span>
              <span>
                Serial{" "}
                <strong className="font-mono text-[#0F172A]">
                  {record.serialNumber}
                </strong>
              </span>
              <span>
                <strong className="text-[#0F172A]">{record.location}</strong> ·{" "}
                {record.tenant}
              </span>
              <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                {CONDITION_LABEL[record.condition]} · {lifePct} % remaining life
              </span>
            </div>
            {record.decisionNote && (
              <p className="m-0 max-w-2xl break-words text-xs text-[#475569]">
                <strong className="text-[#0F172A]">Decision note:</strong>{" "}
                {record.decisionNote}
              </p>
            )}
          </div>
          {/* Actions keep their natural width on wide screens (the title side truncates/wraps instead). */}
          <div className="flex min-w-0 items-start justify-end gap-2 lg:shrink-0">
            <PageActions
              primary={primary}
              secondary={secondary}
              meta={metaText}
            />
            <EscalateButton caseId={record.id} />
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              menu={{ items: moreItems }}
            >
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
          <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
            <button
              type="button"
              onClick={() => setStagePanel(journeyStep)}
              aria-haspopup="dialog"
              className="cursor-pointer bg-transparent p-0 text-xs text-[#64748B] underline decoration-dotted underline-offset-2 hover:text-[#141416]"
            >
              Stage {journeyStep} of {meta.journey.length} ·{" "}
              <strong className="text-[#0F172A]">
                {currentStage?.label ?? STAGE_META[record.stage].label}
              </strong>
            </button>
            <button
              type="button"
              onClick={() => setJourneyOpen((o) => !o)}
              aria-expanded={journeyOpen}
              aria-controls="case-journey"
              aria-label={`${journeyOpen ? "Hide" : "Show"} all stages`}
              className="inline-flex cursor-pointer items-center rounded bg-transparent p-0.5 text-[#64748B] hover:text-[#141416]"
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${journeyOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
          </div>
          {journeyOpen && (
            <div id="case-journey" className="mt-3">
              <ol className="m-0 grid list-none grid-cols-2 gap-1.5 p-0 sm:grid-cols-5 lg:grid-cols-10">
                {meta.journey.map((st) => {
                  const done = st.id < journeyStep;
                  const active = st.id === journeyStep;
                  return (
                    <li key={st.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setStagePanel(st.id)}
                        aria-current={active ? "step" : undefined}
                        aria-label={`Stage ${st.id}, ${st.label} (${st.phase}), ${active ? "current" : done ? "done" : "pending"}. Open details`}
                        className={`w-full min-w-0 cursor-pointer rounded-lg border p-2 text-center hover:border-gray-400 ${
                          active
                            ? "border-[#EAB308] bg-[#FFD600] font-bold text-black"
                            : done
                              ? "border-[#CBD5E1] bg-[#F8FAFC] font-semibold text-[#0F172A]"
                              : "border-[#E2E8F0] bg-white text-[#94A3B8]"
                        }`}
                      >
                        <span className="flex items-start justify-center gap-1 text-[11px] leading-tight">
                          {done ? (
                            <Check
                              size={12}
                              className="mt-px shrink-0 text-emerald-600"
                            />
                          ) : (
                            <span className="font-mono text-[10px]">{st.id}</span>
                          )}
                          <span className="line-clamp-2">{st.label}</span>
                        </span>
                        <span className="block text-[10px] text-[#64748B]">
                          {active ? "Current" : done ? "Done" : "Pending"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      </Card>

      {inQueue && (
        <QueueBar
          queue={queue}
          pos={pos}
          prevId={prevId}
          nextId={nextId}
          highlightNext={acted}
        />
      )}

      <NextBestActionCard
        action={action}
        decision={decision}
        scenarioLabel={scenarioLabel}
        onResetScenario={resetScenario}
        outcome={live.outcome}
        onUndoOverride={
          liveDecision.override && !closed && isApprover && !proposed
            ? undoOverride
            : undefined
        }
        undoBusy={busy === "undo"}
        notice={
          proposalNotice || lifecycleNotice ? (
            <div className="space-y-2">
              {lifecycleNotice}
              {proposalNotice}
            </div>
          ) : undefined
        }
        onShowCalculation={() => showCalculation(decision.best.route)}
        ladderDescription={`${decision.all.filter((r) => r.viable).length} of ${decision.all.length} viable${scenarioChanged ? " under the scenario" : ""} · select a route for its calculation`}
        ladder={
          <RouteLadder
            decision={decision}
            selected={calcOpen ? selected.route : null}
            onSelect={showCalculation}
            bestLabel={bestLabel}
            insights={insights}
          />
        }
        insights={insights}
        snapshot={snapshot}
      />

      {preview && preview.instructions.length > 0 && (
        <section
          aria-labelledby="preview-title"
          className="min-w-0 rounded-2xl border border-[#E2E8F0] bg-white px-5 py-3 shadow-2xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2 text-xs">
              <ScrollText
                size={15}
                className="mt-px shrink-0 text-amber-500"
                aria-hidden
              />
              <p
                id="preview-title"
                className="m-0 min-w-0 break-words text-[#334155]"
              >
                <strong className="text-[#0F172A]">
                  {target === best
                    ? "Instruction preview"
                    : `Instruction preview · ${target.routeName}`}
                  :
                </strong>{" "}
                {preview.summary}{" "}
                <span className="text-[#64748B]">
                  Nothing is sent before approval.
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPreviewOpen(!showPreview)}
              aria-expanded={showPreview}
              aria-controls="instruction-preview"
              className={smallBtn}
            >
              {showPreview
                ? "Hide"
                : `Show ${preview.instructions.length} instructions`}
              <ChevronDown
                size={13}
                className={`transition-transform ${showPreview ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
          </div>
          {showPreview && (
            <div id="instruction-preview" className="mt-3">
              <InstructionTable rows={preview.instructions} />
            </div>
          )}
        </section>
      )}

      <Tabs
        activeKey={activeTab}
        onChange={setTab}
        items={[
          {
            key: "decision",
            label: (
              <TabLabel
                icon={<BrainCircuit size={14} />}
                text="Alternatives & Decision"
              />
            ),
          },
          {
            key: "asset",
            label: (
              <TabLabel icon={<Wrench size={14} />} text="Asset & Condition" />
            ),
          },
          {
            key: "evidence",
            label: (
              <TabLabel
                icon={<ShieldCheck size={14} />}
                text={`Evidence (${record.evidenceCompleteness}%)`}
              />
            ),
          },
          ...(closed
            ? [
                {
                  key: "execution",
                  label: (
                    <TabLabel
                      icon={<Send size={14} />}
                      text="Execution & Hand-off"
                    />
                  ),
                },
              ]
            : []),
          {
            key: "comments",
            label: (
              <TabLabel
                icon={<MessageSquare size={14} />}
                text={`Comments (${commentCount})`}
              />
            ),
          },
        ]}
      />

      {activeTab === "comments" && (
        <Card>
          <CommentThread kind="case" id={record.id} />
        </Card>
      )}

      {activeTab === "decision" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            {liveInsights && insights ? (
              <Card>
                <CardTitle
                  icon={<Scale />}
                  title={
                    insights.whyNot
                      ? `Why not ${insights.whyNot.routeName}?`
                      : "Why this route"
                  }
                  description={`Net value against cycle time for every eligible route${scenarioChanged ? " under the scenario" : ""}. Cycle time runs from approval to value realised.`}
                />
                <div className="space-y-4">
                  <WhyNotPanel insights={insights} />
                  <RouteValueChart decision={decision} insights={insights} />
                </div>
              </Card>
            ) : (
              <div />
            )}
            <div className="min-w-0 space-y-6">
              {liveInsights && insights && (
                <Card>
                  <CardTitle
                    icon={<Columns3 />}
                    title="Compare top 3"
                    description="The three highest eligible routes side by side. Hover a status for its reason."
                  />
                  <CompareTop3 decision={decision} insights={insights} />
                </Card>
              )}
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
                      {trailOpen ? "Hide" : "Show"}{" "}
                      <ChevronDown
                        size={13}
                        className={`transition-transform ${trailOpen ? "rotate-180" : ""}`}
                        aria-hidden
                      />
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
          </div>
          <Card>
            <CardTitle
              icon={<Sliders />}
              title="Scenario"
              description="Re-decides this case with the rest of the queue fixed. Saved scenarios stay for this session and never change the decision."
              actions={
                scenarioChanged && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setScenarioName("");
                        setSaveOpen(true);
                      }}
                      className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-[#64748B] hover:text-[#141416]"
                    >
                      <Bookmark size={13} /> Save scenario
                    </button>
                    <button
                      type="button"
                      onClick={resetScenario}
                      className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-[#64748B] hover:text-[#141416]"
                    >
                      <RotateCcw size={13} /> Reset
                    </button>
                  </div>
                )
              }
            />
            <div className="grid grid-cols-1 gap-6 text-xs lg:grid-cols-2">
              <div className="min-w-0 space-y-5">
                <div>
                  <div className="mb-1 flex justify-between">
                    <span className="text-[#475569]">Refurbishment cost</span>
                    <span className="font-mono font-bold">
                      {scenario.costMultiplier.toFixed(1)}x
                    </span>
                  </div>
                  <Slider
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={scenario.costMultiplier}
                    onChange={(v) =>
                      setScenario((s) => ({ ...s, costMultiplier: v }))
                    }
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
                    <span className="text-[#475569]">
                      Secondary market prices
                    </span>
                    <span className="font-mono font-bold">
                      {scenario.marketMultiplier.toFixed(1)}x
                    </span>
                  </div>
                  <Slider
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={scenario.marketMultiplier}
                    onChange={(v) =>
                      setScenario((s) => ({ ...s, marketMultiplier: v }))
                    }
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
                    <div className="font-semibold text-[#0F172A]">
                      Simulate zero internal demand
                    </div>
                    <div className="text-[10px] text-[#64748B]">
                      Blocks redeploy, re-lease and internal parts
                    </div>
                  </div>
                  <Switch
                    checked={scenario.noInternalDemand}
                    onChange={(v) =>
                      setScenario((s) => ({ ...s, noInternalDemand: v }))
                    }
                    aria-label="Simulate zero internal demand"
                  />
                </div>
              </div>
              <div className="min-w-0 border-t border-[#F1F5F9] pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <PresetBar
                  preset={preset}
                  applyTo={applyTo}
                  routes={liveDecision.all
                    .filter((r) => r.viable)
                    .map((r) => ({ route: r.route, routeName: r.routeName }))}
                  onPreset={setPreset}
                  onApplyTo={setApplyTo}
                  onReset={() => setPreset(null)}
                  flips={flips}
                  activeNote={
                    preset &&
                    simulated && (
                      <p
                        role="status"
                        className={`m-0 rounded-lg border px-3 py-2 ${presetFlip ? "border-amber-200 bg-amber-50 text-[#92400E]" : "border-[#E2E8F0] bg-white text-[#334155]"}`}
                      >
                        {presetNoop ? (
                          <>
                            <strong>{PRESET_LABEL[preset]}</strong> does not
                            touch{" "}
                            {applyTo === "all"
                              ? "any route of this case"
                              : DISPOSITION_ROUTES[applyTo].name}
                            ; the ranking is unchanged.
                          </>
                        ) : presetFlip ? (
                          <>
                            <strong>Ranking flips:</strong>{" "}
                            {PRESET_LABEL[preset].toLowerCase()} moves the
                            recommendation from {liveDecision.best.routeName} to{" "}
                            {simulated.decision.best.viable
                              ? `${simulated.decision.best.routeName} (${usd(simulated.decision.best.net)})`
                              : "no viable route"}
                            .
                          </>
                        ) : (
                          <>
                            <strong>{PRESET_LABEL[preset]}:</strong>{" "}
                            {simulated.decision.best.routeName} stays first at{" "}
                            {usd(simulated.decision.best.net)} (
                            {signed(
                              simulated.decision.best.net -
                                liveDecision.best.net,
                            )}
                            ).
                          </>
                        )}
                      </p>
                    )
                  }
                />
              </div>
            </div>
            {saved.length > 0 && (
              <div className="mt-4 border-t border-[#F1F5F9] pt-3 text-xs">
                <div className="mb-2 font-semibold text-[#0F172A]">
                  Saved scenarios ({saved.length})
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {saved.map((sv) => (
                    <li key={sv.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E2E8F0] px-3 py-1.5">
                      <span className="min-w-0 truncate">
                        <strong className="text-[#0F172A]">{sv.name}</strong>{" "}
                        <span className="text-[#64748B]">
                          · {sv.routeName} <span className="font-mono">{usd(sv.net)}</span> · cost {sv.scenario.costMultiplier.toFixed(1)}x · prices {sv.scenario.marketMultiplier.toFixed(1)}x
                          {sv.scenario.noInternalDemand ? " · no internal demand" : ""}
                          {sv.preset ? ` · ${PRESET_LABEL[sv.preset].toLowerCase()}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setScenario(sv.scenario);
                            setPreset(sv.preset);
                            setApplyTo(sv.applyTo);
                          }}
                          className={smallBtn}
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          onClick={() => scenarioService.remove(sv.id)}
                          aria-label={`Delete scenario ${sv.name}`}
                          className={smallBtn}
                        >
                          <Trash2 size={12} aria-hidden />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === "asset" && (
        <div className="space-y-6">
          <Card>
            <CardTitle
              icon={<Wrench />}
              title="Condition & components"
              description={`${record.manufacturer} ${record.model} · ${record.category}`}
            />
            <AssetCondition record={record} detail={detail} />
            {record.inspection && (
              <p className="m-0 mt-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs text-[#334155]">
                <strong className="text-[#0F172A]">Inspection:</strong> Grade {record.inspection.grade} · test {record.inspection.test} · {record.inspection.lifePct} % remaining life · photos {record.inspection.photosReceived ? "received" : "not received"} · {record.inspection.by}, {dateTime(record.inspection.at)}
                {record.inspection.notes ? ` · ${record.inspection.notes}` : ""}
              </p>
            )}
          </Card>
          <SimilarAssets caseId={record.id} scope={scope} />
          <Card>
            <CardTitle
              icon={<ShieldCheck />}
              title="Enterprise System Facts"
              description="From EAM, ERP and WMS records."
            />
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {[
                [
                  "Original acquisition cost",
                  money(record.facts.originalPrice),
                  "SAP FI",
                ],
                [
                  "In-service age",
                  `${record.facts.ageYears} years`,
                  "Maximo EAM",
                ],
                [
                  "Last service",
                  date(record.facts.lastServiceDate, true),
                  "Maximo EAM",
                ],
                [
                  "Warranty",
                  record.facts.warrantyStatus === "active"
                    ? "Active coverage"
                    : "Expired",
                  "OEM portal",
                ],
                ["WMS bin", record.facts.wmsBinLocation, "WMS"],
                ["Received", date(record.receivedDate, true), "WMS"],
                ["Quantity", `${record.quantity}`, "WMS"],
                ["Case owner", record.owner, "Circularity"],
              ].map(([k, v, src]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[11px] text-[#64748B]">{k}</dt>
                  <dd className="m-0 truncate font-semibold text-[#0F172A]">
                    {v}{" "}
                    <span className="font-normal text-[#94A3B8]">· {src}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      )}

      {activeTab === "evidence" && (
        <Card>
          <CardTitle
            icon={<ShieldCheck />}
            title="Evidence & Provenance"
            description={
              missingEvidence.length
                ? `${missingEvidence.length} item(s) missing: ${missingEvidence.map((e) => e.label.toLowerCase()).join(", ")}`
                : "All evidence received"
            }
            actions={
              canInspect ? (
                <button
                  type="button"
                  onClick={openInspect}
                  disabled={busy !== null}
                  className="cursor-pointer rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400 disabled:opacity-50"
                >
                  Record inspection result
                </button>
              ) : canRequest &&
              (isApprover || canPropose) && (
                <button
                  type="button"
                  onClick={requestEvidence}
                  disabled={busy !== null}
                  className="cursor-pointer rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] shadow-2xs hover:border-gray-400 disabled:opacity-50"
                >
                  {busy === "evidence" ? "Requesting…" : "Request evidence"}
                </button>
              )
            }
          />
          <div className="mb-4 max-w-md">
            <div className="mb-1 text-[11px] font-semibold text-[#64748B]">
              Evidence completeness
            </div>
            <ProgressBar
              value={record.evidenceCompleteness}
              tone={record.evidenceCompleteness >= 90 ? "success" : "warning"}
              label="Evidence completeness"
              showValue
            />
          </div>
          <Collapse
            size="small"
            items={detail.evidence.map((e) => ({
              key: e.id,
              label: (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#141416]">
                    {e.label}
                  </span>
                  <StatusBadge
                    tone={e.status === "received" ? "success" : "warning"}
                  >
                    {e.status === "received" ? "Received" : "Missing"}
                  </StatusBadge>
                </div>
              ),
              children: (
                <dl className="m-0 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] text-[#64748B]">
                      Source system
                    </dt>
                    <dd className="m-0 font-semibold">{e.source}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#64748B]">Reference</dt>
                    <dd className="m-0 font-mono">{e.reference}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#64748B]">Captured</dt>
                    <dd className="m-0">
                      {e.capturedAt
                        ? date(e.capturedAt, true)
                        : "Not yet received"}
                    </dd>
                  </div>
                  <div className="sm:col-span-3 text-[#475569]">{e.detail}</div>
                </dl>
              ),
            }))}
          />
        </Card>
      )}

      {activeTab === "execution" && (
        <Card>
          <CardTitle
            icon={<Send />}
            title="Instructions & Hand-off"
            description={`After approval the work is sent to ${best.executesIn}, where work orders and stock movements are carried out.`}
          />
          {approval && (
            <dl className="m-0 mb-4 grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0">
                <dt className="text-[11px] text-[#64748B]">Approval</dt>
                <dd className="m-0 truncate font-semibold text-[#0F172A]">
                  <span className="font-mono">{approval.ref}</span> ·{" "}
                  {approval.actor}
                </dd>
                <dd className="m-0 font-mono text-[11px] text-[#64748B]">
                  {dateTime(approval.at)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-[#64748B]">Approved route</dt>
                <dd className="m-0 truncate font-semibold text-[#0F172A]">
                  {approval.routeName}
                </dd>
                <dd className="m-0 font-mono text-[11px] text-[#64748B]">
                  {usd(approval.net)}
                  {approval.p10 !== null && approval.p90 !== null
                    ? ` · P10–P90 ${usd(approval.p10)}–${usd(approval.p90)}`
                    : ""}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-[#64748B]">
                  Gates and confidence
                </dt>
                <dd className="m-0 truncate font-semibold text-[#0F172A]">
                  {approval.status} · {approval.confidence} confidence
                </dd>
                <dd className="m-0 text-[11px] text-[#64748B]">
                  {approval.gates.filter((g) => g.status === "ok").length} of{" "}
                  {approval.gates.length} gates OK
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-[#64748B]">
                  Evidence snapshot (frozen)
                </dt>
                <dd className="m-0 truncate font-mono font-semibold text-[#0F172A]">
                  {approval.snapshotId}
                </dd>
                <dd className="m-0 text-[11px] text-[#64748B]">
                  Model {approval.modelVersion}
                </dd>
              </div>
            </dl>
          )}
          {handoffState === "staged" && handoff.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#334155]">
              <span>
                Approved; the {handoff.length} instructions are staged and go out when someone sends them.
              </span>
              {SENDER_ROLES.includes(currentRole) && (
                <button type="button" onClick={sendInstruction} disabled={busy !== null} className={smallBtn}>
                  <Send size={13} aria-hidden /> {busy === "instruct" ? "Sending…" : "Send instruction"}
                </button>
              )}
            </div>
          )}
          {handoffState && handoffState !== "staged" && handoffState !== "delivered" && SIMULATOR_ROLES.includes(currentRole) && (
            <p role="note" className="m-0 mb-3 flex items-start gap-1.5 rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 text-xs text-[#475569]">
              <Cpu size={14} className="mt-px shrink-0 text-[#64748B]" aria-hidden />
              <span>
                <strong className="text-[#0F172A]">Demo: you play the executing systems.</strong> In production SAP PM, the WMS and partners report acknowledgements and completions. Use Simulate on each step; when the last step is done the case is delivered and its outcome goes to Finance.
              </span>
            </p>
          )}
          {handoffState === "delivered" && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-[#065F46]">
              <span>
                <strong>Delivered.</strong>{" "}
                {outcomeRow
                  ? `Outcome reported: predicted ${usd(outcomeRow.predicted)}, realised ${usd(outcomeRow.actual)} · Finance: ${OUTCOME_LABEL[outcomeRow.status]}${outcomeRow.historyId ? ` · learning record ${outcomeRow.historyId}` : ""}.`
                  : "Every step is done."}
              </span>
              {outcomeOpen && (
                <Link href={`/command/actions?tab=outcomes&case=${record.id}`} className={smallBtn}>
                  <ClipboardCheck size={13} aria-hidden /> Outcomes to confirm
                </Link>
              )}
            </div>
          )}
          {handoff.length === 0 ? (
            <EmptyState
              compact
              title="No instructions sent yet"
              description={`This case is at "${STAGE_META[record.stage].label}".`}
            />
          ) : (
            <>
              <p className="m-0 mb-2 text-xs text-[#64748B]">
                {handoff.filter((i) => i.status === "done").length} of{" "}
                {handoff.length} done
                {handoff.some((i) => i.overdue) ? (
                  <strong className="text-[#B91C1C]">
                    {" "}
                    · {handoff.filter((i) => i.overdue).length} overdue,
                    escalates to the Approver
                  </strong>
                ) : (
                  " · none overdue"
                )}
                . Each instruction is due its time limit in working hours after
                approval.
              </p>
              <InstructionTable
                rows={handoff}
                showDue
                renderAction={(i) => {
                  const b = busy === `step-${i.id}`;
                  const canSim = SIMULATOR_ROLES.includes(currentRole);
                  const canResend = RESENDER_ROLES.includes(currentRole) && (i.status === "sent" || (i.overdue && i.status !== "done"));
                  if (!canSim && !canResend) return null;
                  return (
                    <div className="flex flex-col items-end gap-1">
                      {canSim && i.status === "sent" && (
                        <button type="button" onClick={() => stepAck(i)} disabled={busy !== null} className={smallBtn} data-tip={`Demo: plays the acknowledgement ${i.system} would send`}>
                          <Cpu size={12} aria-hidden /> {b ? "Saving…" : "Simulate system acknowledgement"}
                        </button>
                      )}
                      {canSim && i.status === "acknowledged" && (
                        <button type="button" onClick={() => stepDone(i)} disabled={busy !== null} className={smallBtn} data-tip={`Demo: plays ${i.system} reporting the step done`}>
                          <Cpu size={12} aria-hidden /> {b ? "Saving…" : "Simulate step done"}
                        </button>
                      )}
                      {canResend && (
                        <button type="button" onClick={() => stepResend(i)} disabled={busy !== null} className={smallBtn} data-tip={`Sends ${i.doc} to ${i.system} again: same instruction, no duplicate`}>
                          <RefreshCw size={12} aria-hidden /> Resend instruction
                        </button>
                      )}
                    </div>
                  );
                }}
              />
            </>
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
            {selected.viable && selected.route === decision.best.route && (
              <StatusBadge tone="brand">{bestLabel}</StatusBadge>
            )}
          </span>
        }
      >
        <p className="m-0 mb-3 text-xs text-[#64748B]">
          Every line with its basis and source
          {scenarioChanged ? ", under the scenario on screen" : ""}.
        </p>
        <CalculationTable route={selected} decision={decision} />
      </Drawer>

      <Modal
        title={<span className="text-base font-bold">Approve decision</span>}
        open={approveOpen}
        onCancel={() => setApproveOpen(false)}
        onOk={approve}
        confirmLoading={busy === "approve"}
        okText={`Approve ${DISPOSITION_ROUTES[target.route].shortLabel}`}
        okButtonProps={{ style: policy.allowed ? brandOk : undefined, disabled: !policy.allowed }}
      >
        <div className="space-y-3 py-2 text-xs text-[#334155]">
          <p className="m-0">
            You are approving <strong>{record.productName}</strong> ({record.id}
            ) for <strong>{target.routeName}</strong> with a forecast net value
            of{" "}
            <strong className="font-mono text-emerald-700">
              {usd(target.net)}
            </strong>
            .
          </p>
          {policy.sameSubmitter && isAdmin && (
            <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[#92400E]">
              Admin override: same person submitted and approved. The audit log says so.
            </p>
          )}
          <p className="m-0 text-[#475569]">
            {policy.tier} ·{" "}
            {policy.limit === null
              ? `${currentRole}: no approval limit`
              : `within your ${usd(policy.limit)} limit`}
            .
          </p>
          {openProposal && (
            <p className="m-0 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[#075985]">
              <strong>Proposed by {openProposal.proposedBy}:</strong>{" "}
              {proposalText(openProposal)}
              {openProposal.note ? ` — ${openProposal.note}` : ""}
            </p>
          )}
          {scenarioChanged && (
            <p className="m-0 text-[#92400E]">
              The scenario on screen is not approved; this approves the live
              decision.
            </p>
          )}
          {targetInsight && (
            <div className="space-y-1 rounded-lg border border-[#E2E8F0] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-[#0F172A]">
                  {targetInsight.status}
                  {targetInsight.range
                    ? ` · P10–P90 ${usd(targetInsight.range.p10)}–${usd(targetInsight.range.p90)}`
                    : ""}
                </strong>
                {liveInsights && target === best && (
                  <span className="text-[#475569]">
                    {liveInsights.confidence} confidence
                  </span>
                )}
              </div>
              {targetInsight.statusReason && (
                <p className="m-0 text-[#92400E]">
                  {targetInsight.statusReason}
                </p>
              )}
              <GateList gates={targetInsight.gates} />
            </div>
          )}
          {preview && (
            <div className="space-y-1.5">
              <p className="m-0 font-semibold text-[#0F172A]">
                {preview.summary}
              </p>
              <ol className="m-0 list-decimal space-y-0.5 pl-5 text-[#334155]">
                {preview.instructions.map((i) => (
                  <li key={i.id} className="break-words">
                    <strong>{i.system}</strong>: {i.instruction} ·{" "}
                    <span className="font-mono">{i.doc}</span> · {i.owner} ·{" "}
                    <span className="font-mono">{i.timeLimit}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {snapshot && target === best && (
            <p className="m-0 text-[#64748B]">
              Evidence snapshot{" "}
              <span className="font-mono font-semibold text-[#0F172A]">
                {snapshot.id}
              </span>{" "}
              ({liveInsights?.modelVersion}) is frozen with this approval.
            </p>
          )}
          <label className="block">
            <span className="mb-1 block font-semibold text-[#0F172A]">
              Approval note (optional, saved on the case)
            </span>
            <Input.TextArea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Inspection verified, internal demand confirmed."
            />
          </label>
        </div>
      </Modal>

      <Modal
        title={<span className="text-base font-bold">Evidence pack</span>}
        open={packOpen}
        onCancel={() => setPackOpen(false)}
        footer={[
          <button
            key="print"
            type="button"
            onClick={() => {
              if (!printEvidencePack(record.id, packRows()))
                message.error(
                  "The browser blocked the print window. Allow pop-ups for this site and try again.",
                );
            }}
            className="mr-2 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] hover:border-gray-400"
          >
            <Printer size={14} aria-hidden /> Print or save as PDF
          </button>,
          <button
            key="csv"
            type="button"
            onClick={() => {
              downloadEvidencePack(record.id, packRows());
              message.success(`Evidence pack for ${record.id} downloaded`);
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#141416] hover:border-gray-400"
          >
            <FileDown size={14} aria-hidden /> Download CSV
          </button>,
        ]}
      >
        <div className="space-y-2 py-2 text-xs text-[#334155]">
          <p className="m-0">
            Everything this decision rests on, in one file: case,{" "}
            {approval ? "approved" : "recommended"} route{" "}
            <strong>{best.routeName}</strong> at{" "}
            <strong className="font-mono">{usd(best.net)}</strong>
            {bestRange && (
              <>
                {" "}
                (P10–P90{" "}
                <span className="font-mono">
                  {usd(bestRange.p10)}–{usd(bestRange.p90)}
                </span>
                )
              </>
            )}
            , the six gates,{" "}
            {approval ? (
              <>
                approval <span className="font-mono">{approval.ref}</span>
              </>
            ) : (
              "the approval reference once approved"
            )}
            , evidence snapshot{" "}
            <span className="font-mono font-semibold">{snapshot?.id}</span>,{" "}
            {detail.evidence.length} evidence items with their source systems
            and every calculation line with its source.
          </p>
          <p className="m-0 text-[#64748B]">
            The snapshot id changes only when the evidence or the model version
            changes, and freezes at approval.
          </p>
        </div>
      </Modal>

      <Modal
        title={
          <span className="text-base font-bold">Choose another route</span>
        }
        open={overrideOpen}
        onCancel={() => setOverrideOpen(false)}
        onOk={submitOverride}
        confirmLoading={busy === "override"}
        okText="Use this route"
        okButtonProps={{
          disabled: !ovRoute || !ovReason,
          style: ovRoute && ovReason ? brandOk : undefined,
        }}
      >
        <div className="space-y-4 py-2 text-xs text-[#334155]">
          <p className="m-0">
            Circularity recommends <strong>{best.routeName}</strong> at{" "}
            <strong className="font-mono">{usd(best.net)}</strong>. Your choice
            is logged with your name and reason, and used to measure forecast
            accuracy.
          </p>
          <RoutePicker
            alternatives={alternatives}
            bestNet={best.net}
            value={ovRoute}
            onChange={setOvRoute}
          />
          <ReasonSelect value={ovReason} onChange={setOvReason} />
        </div>
      </Modal>

      <Modal
        title={<span className="text-base font-bold">Send to approver</span>}
        open={sendOpen}
        onCancel={() => setSendOpen(false)}
        onOk={submitSend}
        confirmLoading={busy === "send"}
        okText={autoCheck?.eligible ? "Send (auto-approve)" : "Send to approver"}
        okButtonProps={{ style: brandOk }}
      >
        <div className="space-y-3 py-2 text-xs text-[#334155]">
          <p className="m-0">
            You are sending <strong>{record.productName}</strong> ({record.id})
            for approval on Circularity&apos;s route:
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#0F172A]">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-sm"
                style={{
                  backgroundColor: DISPOSITION_ROUTES[best.route].color,
                }}
              />
              {best.routeName}
            </span>
            <span className="font-mono font-bold">{usd(best.net)}</span>
          </div>
          {autoCheck?.eligible ? (
            <p className="m-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[#065F46]">
              <strong>Within auto-approve policy:</strong> net below{" "}
              {usd(autoCheck.threshold)}, Grade A and every gate OK. Circularity
              approves it automatically when you send it, and the audit log
              records the approval as &quot;{AUTO_APPROVER}&quot;.
            </p>
          ) : (
            <p className="m-0 text-[#64748B]">
              {record.stage === "awaiting_approval"
                ? "The case is already in the Approvals inbox; "
                : "The case moves to Awaiting approval; "}
              the approver sees your name and note. You can withdraw it until it
              is decided.
              {autoCheck && autoCheck.reasons.length > 0
                ? ` Not auto-approved: ${autoCheck.reasons.join(", ")}.`
                : ""}
            </p>
          )}
          <label className="block">
            <span className="mb-1 block font-semibold text-[#0F172A]">
              Note for the approver (optional)
            </span>
            <Input.TextArea
              rows={2}
              value={propNote}
              onChange={(e) => setPropNote(e.target.value)}
              placeholder="e.g. Customer confirmed the renewal by phone."
            />
          </label>
        </div>
      </Modal>

      <Modal
        title={<span className="text-base font-bold">Decline the plan for {record.id}</span>}
        open={declineOpen}
        onCancel={() => setDeclineOpen(false)}
        onOk={submitDecline}
        confirmLoading={busy === "decline"}
        okText="Decline plan"
        okButtonProps={{ danger: true, disabled: !declineReason.trim() }}
      >
        <div className="space-y-3 py-2 text-xs text-[#334155]">
          <p className="m-0">
            {openProposal
              ? `The submission from ${openProposal.proposedBy} is cleared and the case goes back to the Planner for re-evaluation.`
              : "The case goes back to the Planner, who re-evaluates it on a new evidence snapshot and sees what changed."}
          </p>
          <label className="block">
            <span className="mb-1 block font-semibold text-[#0F172A]">Reason (required, shown to the Planner and in the audit log)</span>
            <Input.TextArea
              rows={3}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="e.g. Re-lease customer has not signed; check the resale price again."
            />
          </label>
        </div>
      </Modal>

      <Modal
        title={<span className="text-base font-bold">Record inspection result</span>}
        open={inspectOpen}
        onCancel={() => setInspectOpen(false)}
        onOk={submitInspection}
        confirmLoading={busy === "inspect"}
        okText="Record result"
        okButtonProps={{ style: insp.lifePct !== null ? brandOk : undefined, disabled: insp.lifePct === null }}
      >
        <div className="space-y-4 py-2 text-xs text-[#334155]">
          <p className="m-0">
            {record.productName} ({record.id}) · {record.location} · bin{" "}
            <span className="font-mono">{record.facts.wmsBinLocation}</span>. The result fills the missing evidence, re-runs the decision on a new evidence snapshot and moves the case on{stashedText(caseLifecycleService.stashedProposal(record.id))}.
          </p>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1.5 font-semibold text-[#0F172A]">Condition grade</legend>
            <Radio.Group value={insp.grade} onChange={(e) => setInsp((x) => ({ ...x, grade: e.target.value }))} optionType="button" options={["A", "B", "C", "D"].map((g) => ({ value: g, label: `Grade ${g}` }))} />
          </fieldset>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1.5 font-semibold text-[#0F172A]">Functional test result</legend>
            <Radio.Group
              value={insp.test}
              onChange={(e) => setInsp((x) => ({ ...x, test: e.target.value }))}
              optionType="button"
              options={[
                { value: "pass", label: "Pass" },
                { value: "conditional", label: "Conditional" },
                { value: "fail", label: "Fail" },
              ]}
            />
          </fieldset>
          <label className="block">
            <span className="mb-1 block font-semibold text-[#0F172A]">Remaining-life estimate (% of design life)</span>
            <InputNumber
              min={1}
              max={100}
              value={insp.lifePct}
              onChange={(v) => setInsp((x) => ({ ...x, lifePct: typeof v === "number" ? v : null }))}
              suffix="%"
              aria-label="Remaining-life estimate"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold text-[#0F172A]">Notes (optional)</span>
            <Input.TextArea rows={2} value={insp.notes} onChange={(e) => setInsp((x) => ({ ...x, notes: e.target.value }))} placeholder="e.g. Bearing noise within limits; cosmetic scratches on the housing." />
          </label>
          <Checkbox checked={insp.photos} onChange={(e) => setInsp((x) => ({ ...x, photos: e.target.checked }))}>
            Inspection photos received
          </Checkbox>
        </div>
      </Modal>

      <Modal
        title={<span className="text-base font-bold">Save scenario</span>}
        open={saveOpen}
        onCancel={() => setSaveOpen(false)}
        onOk={saveScenario}
        okText="Save"
        okButtonProps={{ style: scenarioName.trim() ? brandOk : undefined, disabled: !scenarioName.trim() }}
      >
        <div className="space-y-3 py-2 text-xs text-[#334155]">
          <p className="m-0">
            Saves the levers on screen{scenarioLabel ? ` (${scenarioLabel})` : ""} for this case, for this session. Applying it later only changes what you see; the decision stays as it is.
          </p>
          <label className="block">
            <span className="mb-1 block font-semibold text-[#0F172A]">Name</span>
            <Input value={scenarioName} maxLength={60} onChange={(e) => setScenarioName(e.target.value)} onPressEnter={() => scenarioName.trim() && saveScenario()} placeholder="e.g. Weak resale market" />
          </label>
        </div>
      </Modal>

      <StagePanel
        caseId={record.id}
        stageId={stagePanel ?? journeyStep}
        open={stagePanel !== null}
        onClose={() => setStagePanel(null)}
        onStageChange={setStagePanel}
        onAction={(t) => {
          setStagePanel(null);
          setTab(t);
        }}
      />

      <Modal
        title={
          <span className="text-base font-bold">Propose another route</span>
        }
        open={proposeOpen}
        onCancel={() => setProposeOpen(false)}
        onOk={submitPropose}
        confirmLoading={busy === "propose"}
        okText="Send proposal"
        okButtonProps={{
          disabled: !ovRoute || !ovReason,
          style: ovRoute && ovReason ? brandOk : undefined,
        }}
      >
        <div className="space-y-4 py-2 text-xs text-[#334155]">
          <p className="m-0">
            Circularity recommends <strong>{best.routeName}</strong> at{" "}
            <strong className="font-mono">{usd(best.net)}</strong>. Your
            proposal goes to the approver with your name and reason; approving
            the case applies your route.
          </p>
          <RoutePicker
            alternatives={alternatives}
            bestNet={best.net}
            value={ovRoute}
            onChange={setOvRoute}
          />
          <ReasonSelect value={ovReason} onChange={setOvReason} />
          <label className="block">
            <span className="mb-1 block font-semibold text-[#0F172A]">
              Note for the approver (optional)
            </span>
            <Input.TextArea
              rows={2}
              value={propNote}
              onChange={(e) => setPropNote(e.target.value)}
              placeholder="e.g. Customer B asked to buy it outright."
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}

/** " (back to Awaiting approval: Santa's submission was set aside)" when a request for evidence parked a submission. */
function stashedText(p: { proposedBy: string } | null): string {
  return p ? `; back to Awaiting approval with the submission from ${p.proposedBy} that was set aside` : "; to Ready for decision for the Planner";
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
      <Radio.Group
        value={value}
        onChange={(e) => onChange(e.target.value as RouteId)}
        className="w-full"
      >
        <div className="flex flex-col gap-1.5">
          {alternatives.map((r) => (
            <Radio
              key={r.route}
              value={r.route}
              className="!m-0 rounded-lg border border-[#E2E8F0] px-3 py-2 !text-xs"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span className="font-semibold text-[#0F172A]">
                  {r.routeName}
                </span>
                <span className="font-mono">{usd(r.net)}</span>
                <span className="text-[#64748B]">
                  ({signed(r.net - bestNet)} vs recommended)
                </span>
              </span>
            </Radio>
          ))}
        </div>
      </Radio.Group>
    </fieldset>
  );
}

function ReasonSelect({
  value,
  onChange,
}: {
  value: OverrideReason | null;
  onChange: (r: OverrideReason) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-semibold text-[#0F172A]">
        Reason (required)
      </span>
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
function QueueBar({
  queue,
  pos,
  prevId,
  nextId,
  highlightNext,
}: {
  queue: QueueContext;
  pos: number;
  prevId: string | null;
  nextId: string | null;
  highlightNext: boolean;
}) {
  const link =
    "inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-[#141416] no-underline hover:bg-[#F1F5F9] focus-visible:outline-2 focus-visible:outline-[#141416]";
  return (
    <nav
      aria-label="Queue"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-[#E2E8F0] bg-white px-2 py-1 text-xs shadow-2xs"
    >
      <Link href={queue.href} className={link}>
        <ArrowLeft size={13} aria-hidden /> Back to {queue.name}
      </Link>
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-2 text-[#64748B]" aria-live="polite">
          Case <strong className="font-mono text-[#0F172A]">{pos + 1}</strong>{" "}
          of <span className="font-mono">{queue.ids.length}</span>
        </span>
        {prevId ? (
          <Link
            href={caseHref(prevId)}
            className={link}
            aria-label={`Previous case, ${prevId}`}
          >
            <ChevronLeft size={13} aria-hidden /> Previous
          </Link>
        ) : (
          <span
            className="inline-flex items-center gap-1 px-2 py-1 text-[#94A3B8]"
            aria-disabled="true"
          >
            <ChevronLeft size={13} aria-hidden /> Previous
          </span>
        )}
        {nextId ? (
          <Link
            href={caseHref(nextId)}
            aria-label={`Next case, ${nextId}`}
            className={`${link} ${highlightNext ? "border border-[#EAB308] bg-[#FFD600] hover:bg-[#FACC15]" : ""}`}
          >
            Next case <ArrowRight size={13} aria-hidden />
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[#94A3B8]">
            Last case in this queue
          </span>
        )}
      </div>
    </nav>
  );
}

function BackLink() {
  return (
    <Link
      href="/product/received"
      className="flex items-center gap-1 text-xs font-semibold text-[#64748B] transition-colors hover:text-[#0F172A]"
    >
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
