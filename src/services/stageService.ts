/**
 * Per-stage detail for the 10-step case journey (meta.journey), shown in the Case page stage panel.
 *
 * Everything is derived deterministically from data the app already holds, so the same case always
 * tells the same story and it moves with the case:
 *  - the case record (stage, dates, grade, predictions, route, demand, proposal);
 *  - assetDetail (evidence items, work orders, journey step) from productService;
 *  - who performs each step and with which systems (src/data/orchestration.json);
 *  - system names and last sync times (src/data/sources.json) for "Retrieved · <system> · <age>";
 *  - the approval thresholds (governanceService.currentThresholds) and site capacity.
 *
 * Every fact says where it came from: retrieved from a system (with freshness), a rule, or a model.
 */
import orchestrationJson from '@/data/orchestration.json';
import sourcesJson from '@/data/sources.json';
import type { CaseRecord } from '@/models/domain.model';
import type { UserRole } from '@/models/user.model';
import type { DispositionRouteId } from '@/models/treatment.model';
import { DISPOSITION_ROUTES } from '@/constants/routes.constants';
import { capacity, meta, userStore } from './mock/stores';
import { delay } from './mock/mockUtils';
import { caseService } from './caseService';
import { assetDetail, CONDITION_LABEL, type AssetDetail } from './productService';
import { currentThresholds } from './governanceService';
import { date, money, relativeTime } from '@/utils/format';

/* ------------------------------------------------------------------ types */

export type StageStatus = 'done' | 'current' | 'not_reached';
/** Where a fact comes from: read from a system, computed by a rule, or predicted by a model. */
export type FactBasis = 'retrieved' | 'rules' | 'model';

export interface StageFact {
  label: string;
  value: string;
  basis: FactBasis;
  /** System name (retrieved), rule name (rules) or model name (model). */
  source: string;
  /** Retrieved facts only: "4 min ago". */
  freshness?: string;
  /** True when the source system's last sync is older than a day. */
  stale?: boolean;
}

export interface StageDocument {
  id: string;
  label: string;
  system: string;
}

/** Case page tab an action opens (the page decides how to show it). */
export type StageActionTarget = 'decision' | 'asset' | 'evidence' | 'execution';

export interface StageAction {
  label: string;
  /** Open a tab of the case page. */
  target?: StageActionTarget;
  /** Or navigate to another page. */
  href?: string;
}

export interface StageUpcoming {
  /** "Plan approval" — the event that starts this stage. */
  startsOn: string;
  /** Planned date (ISO) when it can be estimated from the case due date. */
  expected: string | null;
  /** What the agent / service does. */
  agent: string;
  /** What a person does, if anyone. */
  person: string | null;
  systems: string[];
}

export interface StageDetail {
  caseId: string;
  stageId: number;
  totalStages: number;
  label: string;
  phase: string;
  description: string;
  status: StageStatus;
  /** "Done", "Current", "Waiting on Marcus Vance (Approver)", "Blocked", "Not reached". */
  statusLabel: string;
  blocked: boolean;
  /** ISO time the stage finished (done) or started (current); null when not reached. */
  date: string | null;
  /** Who did it / is doing it. */
  actor: string | null;
  systems: string[];
  control: string;
  /** One-sentence account (what happened, or what will happen when not reached). */
  summary: string;
  facts: StageFact[];
  meaning: string;
  youDo: { text: string; action?: StageAction };
  documents: StageDocument[];
  upcoming: StageUpcoming | null;
  /** Where the case is now (for "RT-1048 is at stage 5. Go to stage 5"). */
  current: { id: number; label: string };
}

/* ------------------------------------------------------------------ reference data */

interface OrchStage {
  step: number;
  label: string;
  phase: string;
  description: string;
  performerId: string;
  systems: string[];
  owner: string;
  control: string;
  human: boolean;
}
const STAGES = orchestrationJson.stages as OrchStage[];
const AGENTS = new Map((orchestrationJson.agents as { id: string; name: string }[]).map((a) => [a.id, a.name]));

type SourceRow = { id: string; name: string; lastSyncAt?: string };
const SOURCES = new Map((sourcesJson.sources as SourceRow[]).map((s) => [s.id, s]));

const SYS = {
  eam: 'ibm-maximo',
  wms: 'manhattan-wms',
  plm: 'siemens-teamcenter',
  photos: 'sharepoint-docs',
  market: 'machinio',
  auctions: 'ritchie-bros',
  oms: 'ibm-sterling',
  recycling: 'sims-lifecycle',
  carbon: 'persefoni',
  quotes: 'sap-ariba',
} as const;

/** Customer A books in SAP S/4HANA; Customers B and C hold their lease contracts in Oracle ERP Cloud. */
const erpFor = (c: CaseRecord) => (c.tenant === 'Customer A' ? 'sap-s4' : 'oracle-erp');

const sourceName = (id: string) => SOURCES.get(id)?.name ?? id;

/** Generic system labels in orchestration.json → the concrete system for this case. */
function systemLabel(generic: string, c: CaseRecord): string {
  switch (generic) {
    case 'EAM':
      return sourceName(SYS.eam);
    case 'ERP':
      return sourceName(erpFor(c));
    case 'WMS':
      return sourceName(SYS.wms);
    case 'PLM / quality':
      return sourceName(SYS.plm);
    case 'Market data':
      return sourceName(SYS.market);
    case 'Decision Workbench':
      return 'Circularity';
    default:
      return generic;
  }
}

/** Systems that receive the approved plan, by route. */
const ROUTE_SYSTEMS: Record<DispositionRouteId, { id: string | 'erp'; instruction: string }[]> = {
  redeploy: [
    { id: 'erp', instruction: 'Transfer the asset to the receiving site' },
    { id: SYS.eam, instruction: 'Create the refurbishment work order' },
    { id: SYS.wms, instruction: 'Create the pick and transfer task' },
  ],
  relase: [
    { id: 'erp', instruction: 'Open the new lease schedule' },
    { id: SYS.eam, instruction: 'Create the refurbishment work order' },
    { id: SYS.wms, instruction: 'Create the pick and staging task' },
  ],
  resale: [
    { id: SYS.oms, instruction: 'List the certified unit for sale' },
    { id: SYS.eam, instruction: 'Create the refurbishment work order' },
    { id: SYS.wms, instruction: 'Create the pick and staging task' },
    { id: 'erp', instruction: 'Prepare the asset retirement on sale' },
  ],
  intparts: [
    { id: SYS.eam, instruction: 'Create the teardown work order' },
    { id: SYS.wms, instruction: 'Create bins for harvested parts' },
  ],
  extparts: [
    { id: SYS.eam, instruction: 'Create the teardown work order' },
    { id: SYS.oms, instruction: 'List the certified parts' },
    { id: SYS.wms, instruction: 'Create bins for harvested parts' },
  ],
  material: [
    { id: SYS.recycling, instruction: 'Book material recovery collection' },
    { id: SYS.wms, instruction: 'Create the outbound task' },
    { id: 'erp', instruction: 'Retire the asset' },
  ],
  exit: [
    { id: SYS.recycling, instruction: 'Book certified disposal' },
    { id: SYS.wms, instruction: 'Create the outbound task' },
    { id: 'erp', instruction: 'Retire the asset' },
  ],
};

/** Routes the tenant route policy allows for a condition grade. */
const ELIGIBLE: Record<CaseRecord['condition'], DispositionRouteId[]> = {
  A: ['redeploy', 'relase', 'resale', 'intparts', 'extparts', 'material', 'exit'],
  B: ['redeploy', 'relase', 'resale', 'intparts', 'extparts', 'material', 'exit'],
  C: ['redeploy', 'resale', 'intparts', 'extparts', 'material', 'exit'],
  D: ['intparts', 'extparts', 'material', 'exit'],
  Scrap: ['material', 'exit'],
};

const START_TRIGGER: Record<number, string> = {
  1: 'goods receipt',
  2: 'the evidence gate passing',
  3: 'alternatives being built',
  4: 'outcomes being predicted',
  5: 'the plan being optimised',
  6: 'plan approval',
  7: 'the systems acknowledging the instruction',
  8: 'the work order starting',
  9: 'certification',
  10: 'the outcome posting in ERP',
};

/** Days after the case due date (the approval deadline) a later stage is planned to start. */
const PLAN_OFFSET: Record<number, number> = { 5: 0, 6: 0, 7: 1, 8: 3, 9: 10, 10: 30 };

const WHAT_AGENT_DOES: Record<number, string> = {
  1: 'Collects the asset record, service history, contract and bin location',
  2: 'Links every eligible route for the grade and tenant policy',
  3: 'Scores resale price, refurbishment cost, failure risk and carbon per route',
  4: 'Chooses the route with the best net recovery within site capacity',
  5: 'Prepares the decision packet and checks the approval limit',
  6: 'Sends the approved plan to each system through the MCP write gate',
  7: 'Creates the work order and the warehouse pick task',
  8: 'Tracks repair, test and certification',
  9: 'Collects actual costs and realised value',
  10: 'Compares actual against predicted value and feeds the variance back to the models',
};

const RISK_LABEL = Object.fromEntries(meta.riskReasons.map((r) => [r.id, r.label.toLowerCase()]));

/* ------------------------------------------------------------------ helpers */

const caseNo = (c: CaseRecord) => Number(c.id.replace(/\D/g, '')) || 0;
const DAY = 86_400_000;
const addDaysIso = (iso: string, days: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * DAY).toISOString();

function retrieved(label: string, value: string, sourceId: string): StageFact {
  const s = SOURCES.get(sourceId);
  const at = s?.lastSyncAt;
  return {
    label,
    value,
    basis: 'retrieved',
    source: s?.name ?? sourceId,
    freshness: at ? relativeTime(at, meta.asOf) : undefined,
    stale: at ? Date.parse(meta.asOf) - Date.parse(at) > DAY : false,
  };
}
const rule = (label: string, value: string, source: string): StageFact => ({ label, value, basis: 'rules', source });
const model = (label: string, value: string, source: string): StageFact => ({ label, value, basis: 'model', source });

function person(role: UserRole, c: CaseRecord): string {
  if (role === 'Planner') return `${c.owner} (Planner)`;
  const users = userStore.all().filter((u) => u.role === role);
  const u = (role === 'Warehouse Manager' && users.find((x) => x.site === c.location)) || users[0];
  return u ? `${u.name} (${role})` : role;
}

/** When each reached stage finished: spread evenly from goods receipt to the as-of time. */
function stageTimes(c: CaseRecord, step: number): (i: number) => string {
  const start = Date.parse(`${c.receivedDate}T08:00:00Z`);
  const end = Date.parse(meta.asOf) - 20 * 60_000;
  const span = Math.max(0, end - start);
  return (i: number) => new Date(start + Math.round(((i - 0.5) / Math.max(1, step)) * span / 60_000) * 60_000).toISOString();
}

function approvalLevel(c: CaseRecord): string {
  const th = currentThresholds();
  const net = c.estimatedNetRecovery;
  if (c.condition === 'A' && net < th.autoApproveBelow) return `Auto-approve (Grade A below ${money(th.autoApproveBelow)})`;
  if (net > th.delegationLimit) return `Executive sign-off (above ${money(th.delegationLimit)})`;
  if (net > th.level2Above) return `Level 2 sign-off (above ${money(th.level2Above)})`;
  return `Approver sign-off (up to ${money(th.delegationLimit)})`;
}

const isPlanner = (r: UserRole) => r === 'Planner' || r === 'Admin';
const isApprover = (r: UserRole) => r === 'Approver' || r === 'Admin';
const nothing = (who: string) => ({ text: `Nothing for you. ${who}` });

/* ------------------------------------------------------------------ per-stage content */

interface Content {
  summary: string;
  facts: StageFact[];
  meaning: string;
  youDo: StageDetail['youDo'];
  documents: StageDocument[];
  waitingOn?: string;
  blocked?: boolean;
  actor?: string;
}

function stageContent(stepId: number, c: CaseRecord, d: AssetDetail, status: StageStatus, role: UserRole): Content {
  const n = caseNo(c);
  const erp = erpFor(c);
  const route = DISPOSITION_ROUTES[c.recommendedRoute];
  const current = status === 'current';
  const done = status === 'done';
  const received = d.evidence.filter((e) => e.status === 'received');
  const missing = d.evidence.filter((e) => e.status === 'missing');
  const daysHeld = Math.max(0, Math.round((Date.parse(meta.asOf) - Date.parse(`${c.receivedDate}T00:00:00Z`)) / DAY));
  const planId = `DP-2026-${1000 + n}`;
  const certId = `QMS-${2800 + n}`;

  switch (stepId) {
    case 1: {
      const facts: StageFact[] = [
        retrieved('Goods receipt', `${date(c.receivedDate, true)} · ${c.location}`, SYS.wms),
        retrieved('Bin location', c.facts.wmsBinLocation, SYS.wms),
        retrieved('Last service', date(c.facts.lastServiceDate, true), SYS.eam),
        retrieved('Age and warranty', `${c.facts.ageYears} years · warranty ${c.facts.warrantyStatus}`, erp),
        rule('Evidence', `${received.length} of ${d.evidence.length} items · ${c.evidenceCompleteness}%`, 'Evidence completeness gate (70% minimum)'),
      ];
      const documents = received.map((e) => ({ id: e.reference, label: e.label, system: e.source }));
      if (c.stage === 'awaiting_inspection' && current) {
        return {
          summary: `Received at ${c.location} on ${date(c.receivedDate, true)}; the unit waits for inspection and grading before routes can be built.`,
          facts,
          meaning: `Until it is inspected no route can be priced, and the unit carries holding cost (${daysHeld} days since receipt).`,
          youDo:
            role === 'Engineer' || role === 'Warehouse Manager' || role === 'Admin'
              ? { text: `Inspect and grade the unit at ${c.location} (bin ${c.facts.wmsBinLocation}); the result unlocks routing.`, action: { label: 'Open asset & condition', target: 'asset' } }
              : nothing(`Waiting on inspection by ${person('Engineer', c)}.`),
          documents,
          waitingOn: person('Engineer', c),
        };
      }
      if (missing.length && current) {
        const names = missing.map((e) => e.label.toLowerCase()).join(', ');
        const systems = [...new Set(missing.map((e) => e.source))].join(', ');
        return {
          summary: `${received.length} of ${d.evidence.length} evidence items are in; waiting on ${names}.`,
          facts,
          meaning: `Without the ${missing[0].label.toLowerCase()} the unit cannot be routed; it carries holding cost (${daysHeld} days since receipt) until the evidence arrives.`,
          youDo: isPlanner(role) || isApprover(role)
            ? { text: `Request the missing ${names} from ${systems}.`, action: { label: 'Open evidence', target: 'evidence' } }
            : role === 'Engineer' && missing.some((e) => e.id === 'photos' || e.id === 'test')
              ? { text: 'Upload the missing inspection photos or test report.', action: { label: 'Open evidence', target: 'evidence' } }
              : nothing(`Waiting on ${c.owner} (Planner) to get the missing evidence.`),
          documents,
          waitingOn: `${systems}`,
        };
      }
      return {
        summary: `Received at ${c.location} on ${date(c.receivedDate, true)}; ${received.length} of ${d.evidence.length} evidence items collected from ${new Set(received.map((e) => e.source)).size} systems.`,
        facts,
        meaning: `Evidence is ${c.evidenceCompleteness}% complete, above the 70% gate, so routes can be built and priced. From receipt the unit carries holding cost until a route moves it.`,
        youDo: { text: `Nothing required. The result is recorded: ${received.length} of ${d.evidence.length} evidence items.` },
        documents,
      };
    }

    case 2: {
      const eligible = ELIGIBLE[c.condition].includes(c.recommendedRoute) ? ELIGIBLE[c.condition] : [...ELIGIBLE[c.condition], c.recommendedRoute];
      const withheld = (Object.keys(DISPOSITION_ROUTES) as DispositionRouteId[]).filter((r) => !eligible.includes(r));
      const facts: StageFact[] = [
        retrieved('Condition grade', CONDITION_LABEL[c.condition], SYS.photos),
        model('Residual life', `${c.residualLifeMonths} months`, 'Remaining-life model'),
        rule('Eligible routes', `${eligible.length} of 7`, `Tenant route policy · ${c.tenant}`),
        rule('Routes', eligible.map((r) => DISPOSITION_ROUTES[r].shortLabel).join(', '), 'Tenant route policy'),
      ];
      const blocked = c.stage === 'no_viable_route' && current;
      return {
        summary: blocked
          ? `Routes were linked for grade ${c.condition}, but none clears the economics gate.`
          : `${eligible.length} routes linked for a ${CONDITION_LABEL[c.condition].toLowerCase()} unit under ${c.tenant}'s route policy.`,
        facts,
        meaning: blocked
          ? `No route returns more than it costs${c.blockedReason ? `: ${c.blockedReason}` : ''}. The unit keeps carrying holding cost until someone decides.`
          : `Grade ${c.condition} and ${c.residualLifeMonths} months of residual life leave ${eligible.length} routes eligible${withheld.length ? `; ${withheld.map((r) => DISPOSITION_ROUTES[r].shortLabel).join(', ')} withheld for this grade` : ''}.`,
        youDo: blocked
          ? isPlanner(role) || isApprover(role)
            ? { text: 'Review the alternatives and choose responsible exit or hold for re-evaluation.', action: { label: 'Review alternatives', target: 'decision' } }
            : nothing(`Waiting on ${c.owner} (Planner) to decide.`)
          : { text: done ? 'Nothing required. Tracked by the agent.' : 'Nothing for you. Built by the agent.' },
        documents: [],
        blocked,
      };
    }

    case 3: {
      const net = c.predictedResale - c.refurbishmentCost;
      return {
        summary: `Resale, refurbishment cost, failure risk and carbon scored for each eligible route.`,
        facts: [
          model('Predicted resale', money(c.predictedResale), 'Prediction model'),
          model('Refurbishment cost', money(c.refurbishmentCost), 'Refurbishment cost model'),
          model('Failure risk', `${Math.round(c.predictions.failureRiskScore * 100)}%`, 'Failure-risk model'),
          retrieved('Resale demand', `${Math.round(c.predictions.resaleDemandScore * 100)} of 100`, SYS.market),
          retrieved('Auction comparables', `${c.category} prices`, SYS.auctions),
          rule('Carbon avoided', `${c.carbonAvoidedKg.toLocaleString('en-US')} kg CO2e`, 'Carbon factors · Persefoni'),
        ],
        meaning: `Resale of ${money(c.predictedResale)} less ${money(c.refurbishmentCost)} refurbishment leaves about ${money(net)} before logistics; the ${Math.round(c.predictions.failureRiskScore * 100)}% failure risk is priced into the resale estimate.`,
        youDo: { text: 'Nothing for you. Scored by the prediction service from approved model versions.' },
        documents: [],
      };
    }

    case 4: {
      const cap = capacity.find((x) => x.site === c.location);
      const reeval = c.stage === 'reevaluate' && current;
      const documents = (c.demandIds ?? []).map((id) => ({ id, label: 'Demand reserved', system: id.startsWith('SO-') ? sourceName(SYS.oms) : sourceName(erp) }));
      return {
        summary: reeval
          ? `The plan is being re-optimised${c.riskReason ? ` after ${RISK_LABEL[c.riskReason] ?? 'a change'}` : ''}.`
          : `${route.name} chosen for the best net recovery within site capacity.`,
        facts: [
          model('Route', route.name, 'Plan optimiser'),
          model('Net recovery', money(c.estimatedNetRecovery), 'Plan optimiser'),
          rule('Demand', c.demandIds?.length ? c.demandIds.join(', ') : 'None needed', 'Queue plan'),
          model('Value at risk', money(c.valueAtRisk), 'Risk model'),
          ...(cap ? [retrieved(cap.label, `${cap.used} of ${cap.capacity} ${cap.unit}`, SYS.wms)] : []),
        ],
        meaning: reeval
          ? 'The previous route may change; nothing goes to approval until the new plan clears the economics gate.'
          : `${route.shortLabel} returns ${money(c.estimatedNetRecovery)} net${c.demandIds?.length ? `, using demand ${c.demandIds[0]}` : ''}; it clears the economics gate (net above zero).`,
        youDo: reeval
          ? isPlanner(role)
            ? { text: 'Check the re-evaluated alternatives, then send the plan for approval.', action: { label: 'Review alternatives', target: 'decision' } }
            : nothing(`Waiting on ${c.owner} (Planner).`)
          : { text: 'Nothing for you. Optimised by the agent.' },
        documents,
      };
    }

    case 5: {
      const p = c.proposal;
      const instr = ROUTE_SYSTEMS[c.recommendedRoute];
      const systems = instr.map((s) => sourceName(s.id === 'erp' ? erp : s.id));
      const facts: StageFact[] = [
        model('Route', `${route.name} · ${money(c.estimatedNetRecovery)}`, 'Prediction model'),
        rule('Approval needed', approvalLevel(c), 'Approval policy'),
      ];
      if (p) {
        facts.push({
          label: 'Sent for approval',
          value: `${p.route ? DISPOSITION_ROUTES[p.route].shortLabel : 'Recommended route'} · by ${p.proposedBy}`,
          basis: 'retrieved',
          source: 'Circularity',
          freshness: relativeTime(p.proposedAt, meta.asOf),
        });
        if (p.snapshotId) facts.push(rule('Evidence snapshot', p.snapshotId, 'Gate engine'));
      }
      if (c.decisionNote) facts.push({ label: 'Decision note', value: c.decisionNote, basis: 'retrieved', source: 'Circularity' });
      const documents = [{ id: planId, label: 'Decision packet', system: 'Circularity' }, ...(p?.snapshotId ? [{ id: p.snapshotId, label: 'Evidence snapshot', system: 'Circularity' }] : [])];
      const approver = person('Approver', c);
      if (current) {
        return {
          summary: `The decision packet is ready; the plan waits for sign-off by ${approver}.`,
          facts,
          meaning: `Approval sends ${instr.length} instructions to ${systems.join(', ')} and commits up to ${money(c.refurbishmentCost)} of spend. Nothing reaches an operational system before it.`,
          youDo: isApprover(role)
            ? { text: 'Approve, edit or decline the plan. Approving sends the instructions.', action: { label: 'Review the plan', target: 'decision' } }
            : !p && (role === 'Planner' || role === 'Engineer' || role === 'Warehouse Manager')
              ? { text: `Nothing required. If you disagree with ${route.shortLabel}, propose another route from the decision card.`, action: { label: 'Open the decision', target: 'decision' } }
              : nothing(`Waiting on ${approver}.`),
          documents,
          waitingOn: approver,
        };
      }
      return {
        summary: `${route.name} approved${p ? ` (sent by ${p.proposedBy})` : ''}.`,
        facts,
        meaning: `The approved plan ${planId} is the only authority the dispatcher accepts; it carries ${money(c.estimatedNetRecovery)} expected net.`,
        youDo: { text: 'Nothing required. The approval is recorded in the audit log.' },
        documents,
        actor: approver,
      };
    }

    case 6: {
      const instr = ROUTE_SYSTEMS[c.recommendedRoute];
      return {
        summary: `${instr.length} instructions for plan ${planId} sent through the MCP write gate.`,
        facts: instr.map((s) => retrieved(sourceName(s.id === 'erp' ? erp : s.id), s.instruction, s.id === 'erp' ? erp : s.id)),
        meaning: 'Each system acknowledges before work is created; a refused instruction raises an exception instead of retrying silently.',
        youDo: { text: 'Nothing for you. Sent by the dispatcher under the approved plan.' },
        documents: instr.map((s, i) => ({ id: `INS-${n}-${i + 1}`, label: s.instruction, system: sourceName(s.id === 'erp' ? erp : s.id) })),
      };
    }

    case 7: {
      const wos = d.workOrders;
      const pick = wos.find((w) => w.system === 'WMS');
      return {
        summary: wos.length ? `${wos.length} work items created: ${wos.map((w) => w.id).join(', ')}.` : 'Work order and pick task created.',
        facts: wos.map((w) => retrieved(w.title, `${w.id} · ${w.status.replace('_', ' ')} · due ${date(w.due)}`, w.system === 'WMS' ? SYS.wms : SYS.eam)),
        meaning: `The unit leaves bin ${c.facts.wmsBinLocation} when the pick task runs; until then it holds space at ${c.location}.`,
        youDo:
          (role === 'Warehouse Manager' || role === 'Admin') && pick && current
            ? { text: `Pick task ${pick.id} is queued at your site; confirm it in ${sourceName(SYS.wms)}.`, action: { label: 'Open execution & hand-off', target: 'execution' } }
            : { text: 'Nothing for you. Tracked by the agent.' },
        documents: wos.map((w) => ({ id: w.id, label: w.title, system: w.system })),
      };
    }

    case 8: {
      return {
        summary: `Repair, test and certification tracked for ${route.shortLabel.toLowerCase()}.`,
        facts: [
          model('Repair estimate', money(c.refurbishmentCost), 'Refurbishment cost model'),
          rule('Certificate', `${certId} required before release`, 'Quality certificate rule'),
          model('Certified life', `${c.residualLifeMonths} months`, 'Remaining-life model'),
        ],
        meaning: `The unit cannot be released to ${route.shortLabel.toLowerCase()} without certificate ${certId}; repair spend above ${money(c.refurbishmentCost)} needs a new approval.`,
        youDo:
          (role === 'Engineer' || role === 'Admin') && current
            ? { text: 'Record the test result and certificate when the bench work is done.', action: { label: 'Open asset & condition', target: 'asset' } }
            : { text: 'Nothing for you. Tracked by the certification tracker.' },
        documents: [{ id: certId, label: 'Quality certificate', system: 'Test bench' }],
      };
    }

    case 9: {
      const channel = ROUTE_SYSTEMS[c.recommendedRoute][0];
      return {
        summary: 'Actual costs and realised value collected from the systems that executed the route.',
        facts: [
          model('Expected net', money(c.estimatedNetRecovery), 'Plan optimiser'),
          retrieved('Executing system', sourceName(channel.id === 'erp' ? erp : channel.id), channel.id === 'erp' ? erp : channel.id),
          rule('Outcome document', 'Must match a posted ERP document', 'Outcome rule'),
        ],
        meaning: 'The case closes only when the realised value is matched to a posted ERP document.',
        youDo:
          (role === 'Finance' || role === 'Admin') && current
            ? { text: 'Confirm the outcome once the ERP document posts.', action: { label: 'Open execution & hand-off', target: 'execution' } }
            : { text: 'Nothing for you. Collected by the outcome agent.' },
        documents: [],
      };
    }

    default: {
      return {
        summary: 'Actual value compared with the prediction; the variance feeds back into the models.',
        facts: [model('Predicted net', money(c.estimatedNetRecovery), 'Prediction model'), rule('Close', 'Finance close sign-off', 'Reconciliation rule')],
        meaning: 'A large variance flags the model version for review in the model registry.',
        youDo: role === 'Finance' && current ? { text: 'Sign off the reconciliation at period close.', action: { label: 'Open analytics', href: '/analytics' } } : { text: 'Nothing for you. Reconciled by the service.' },
        documents: [],
      };
    }
  }
}

/* ------------------------------------------------------------------ service */

/** Builds one stage's detail. Pure and deterministic for a given case, stage and role. */
export function buildStageDetail(c: CaseRecord, stageId: number, role: UserRole = 'Planner'): StageDetail {
  const d = assetDetail(c);
  const step = d.journeyStep;
  const j = meta.journey.find((x) => x.id === stageId) ?? meta.journey[0];
  const def = STAGES.find((s) => s.step === j.id);
  const status: StageStatus = j.id < step ? 'done' : j.id === step ? 'current' : 'not_reached';
  const systems = [...new Set((def?.systems ?? []).map((s) => systemLabel(s, c)))];
  const agentName = AGENTS.get(def?.performerId ?? '') ?? 'Circularity';
  const at = stageTimes(c, step);
  const currentJ = meta.journey.find((x) => x.id === step) ?? meta.journey[0];
  const base = {
    caseId: c.id,
    stageId: j.id,
    totalStages: meta.journey.length,
    label: j.label,
    phase: j.phase,
    description: def?.description ?? '',
    systems,
    control: (def?.control ?? '').replace(/{(autoApproveBelow|level2Above|delegationLimit)}/g, (_, k: 'autoApproveBelow' | 'level2Above' | 'delegationLimit') => money(currentThresholds()[k])),
    current: { id: currentJ.id, label: currentJ.label },
  };

  if (status === 'not_reached') {
    const offset = PLAN_OFFSET[j.id];
    const ownerRole = def?.owner as UserRole | undefined;
    const human = j.id === 5 ? person('Approver', c) : j.id >= 9 ? `${person('Finance', c)} confirms where required` : j.id === 8 ? `${person('Engineer', c)} records the certificate` : j.id === 7 ? `${person('Warehouse Manager', c)} runs the pick task` : null;
    const expected = offset !== undefined ? addDaysIso(c.dueDate, offset) : null;
    return {
      ...base,
      status,
      statusLabel: 'Not reached',
      blocked: false,
      date: null,
      actor: null,
      summary: `${WHAT_AGENT_DOES[j.id]}.`,
      facts: [],
      meaning: `Starts on ${START_TRIGGER[j.id]}${expected ? `, planned around ${date(expected, true)}` : ''}.${human ? ` ${human}.` : ''}`,
      youDo: { text: `Nothing yet. ${c.id} is at stage ${currentJ.id}, ${currentJ.label.toLowerCase()}.` },
      documents: [],
      upcoming: {
        startsOn: START_TRIGGER[j.id].replace(/^the /, '').replace(/^\w/, (x) => x.toUpperCase()),
        expected,
        agent: `${agentName}: ${WHAT_AGENT_DOES[j.id].charAt(0).toLowerCase()}${WHAT_AGENT_DOES[j.id].slice(1)}`,
        person: human ?? (ownerRole && def?.human ? person(ownerRole, c) : null),
        systems,
      },
    };
  }

  const content = stageContent(j.id, c, d, status, role);
  const isDone = status === 'done';
  const statusLabel = content.blocked ? 'Blocked' : isDone ? 'Done' : content.waitingOn ? `Waiting on ${content.waitingOn}` : 'Current';
  return {
    ...base,
    status,
    statusLabel,
    blocked: !!content.blocked,
    // Done: when it finished; current: when it started.
    date: isDone ? at(j.id) : j.id > 1 ? at(j.id - 1) : `${c.receivedDate}T08:00:00Z`,
    actor: content.actor ?? agentName,
    summary: content.summary,
    facts: content.facts,
    meaning: content.meaning,
    youDo: content.youDo,
    documents: content.documents,
    upcoming: null,
  };
}

export const stageService = {
  subscribe: caseService.subscribe,

  /** Stage detail for a case (1-based stageId into meta.journey); undefined when the case is unknown. */
  async stageDetail(caseId: string, stageId: number, role: UserRole = 'Planner'): Promise<StageDetail | undefined> {
    await delay(120);
    const c = caseService.peek(caseId);
    return c ? buildStageDetail(c, stageId, role) : undefined;
  },

  /** The case's current journey step (1-based), e.g. to open the panel on the current stage. */
  currentStage(caseId: string): number | undefined {
    const c = caseService.peek(caseId);
    return c ? assetDetail(c).journeyStep : undefined;
  },
};

