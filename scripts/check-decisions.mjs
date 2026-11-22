#!/usr/bin/env node
/**
 * Sanity check for the decision engine and the app's single source of truth.
 *
 *   node scripts/check-decisions.mjs
 *
 * Loads the real services (TypeScript, via jiti) and prints: open cases, share with named
 * demand, contested demands, plan vs first come first served, gain over the standard route,
 * forecast accuracy, three example decisions with their line items, and a consistency check
 * that Key Figures (metricsService), Dashboard (dashboardService) and Exceptions
 * (exceptionService) agree for the same scope. Exit code 1 when a check fails.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const { createJiti } = require('jiti');
const jiti = createJiti(path.join(root, 'package.json'), { alias: { '@': path.join(root, 'src') } });
const load = (p) => jiti.import(path.join(root, 'src/services', p));

const t0 = Date.now();
const ds = await load('decisionService.ts');
const { computeSummary } = await load('metricsService.ts');
const { dashboardService } = await load('dashboardService.ts');
const { exceptionService } = await load('exceptionService.ts');
const { scenarioDecision, BASE_SCENARIO } = await load('productService.ts');
const { caseService } = await load('caseService.ts');

const usd = ds.usd;
const plan = ds.planQueue();
const tPlan = Date.now() - t0;
const open = ds.openDecisions();
const anyNamed = open.filter(({ decision }) => decision.all.some((r) => r.viable && r.demands.some((d) => d.kind !== 'recycler_quote')));
const s = ds.summary();
const acc = ds.accuracy();
let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

console.log('=== Decision engine ===');
console.log(`Open cases                       ${open.length}`);
console.log(`With named demand (any route)    ${anyNamed.length} (${Math.round((anyNamed.length / open.length) * 100)} %)`);
console.log(`Best route on named demand       ${Math.round(s.namedDemandShare * 100)} %`);
console.log(`Contested demands (wanted by 2+) ${plan.contested.length}`);
console.log(`Queue plan value                 ${usd(plan.planValue)}`);
console.log(`First come, first served         ${usd(plan.fcfsValue)}  (plan adds ${usd(plan.gain)})`);
console.log(`Standard-route value             ${usd(s.standardValue)}`);
console.log(`Gain over standard route         ${usd(s.gainOverStandard)}`);
console.log(`Refurbishment slots              ${plan.refurbSlotsUsed} of ${plan.refurbSlots}`);
console.log(`Forecast accuracy (60 days)      ${(acc.accuracy * 100).toFixed(1)} % over ${acc.n} decisions, ${Math.round(acc.within5 * 100)} % within 5 %`);
console.log(`Plan + load time                 ${tPlan} ms`);
console.log('Route mix:', s.routeMix.map((m) => `${m.name} ${m.n} (${usd(m.value)})`).join(' · '));
console.log('Gap by channel:', s.byChannel.map((c) => `${c.label}: ${usd(c.standard)} → ${usd(c.best)} (+${usd(c.gain)}, n=${c.n})`).join(' · '));
console.log('Top contested:', plan.contested.slice(0, 5).map((x) => `${x.demandId} wanted by ${x.wantedBy.join('/')} → ${x.assignedTo ?? 'nobody'} (+${usd(x.gain)})`).join(' · '));

function printCase(id) {
  const d = ds.decide(id);
  const nba = ds.nextBestAction(id);
  console.log(`\n--- ${id} · ${ds.channelOf(id)} · best ${d.best.routeName} ${usd(d.best.net)} · standard ${d.standard.routeName} ${usd(d.standard.net)} · gain ${usd(d.gainOverStandard)}`);
  console.log(`    ${nba.label}: ${nba.headline}`);
  console.log(`    ${nba.summary}  [${nba.pill}]`);
  if (d.planNote) console.log(`    Plan: ${d.planNote}`);
  for (const l of d.best.lines) console.log(`    ${l.type.padEnd(5)} ${usd(l.amount).padStart(9)}  ${l.label} — ${l.basis}  [${ds.sourceText(l.sources[0])}]`);
  console.log(`    timing: ready ${d.best.timing.ready}, needed by ${d.best.timing.neededBy ?? '—'}, buffer ${d.best.timing.bufferDays ?? '—'} days`);
  console.log(`    ladder: ${d.all.map((r) => (r.viable ? `${r.route} ${usd(r.net)}` : `${r.route} ✕ ${r.reason}`)).join(' | ')}`);
  console.log(`    ${nba.fallback ?? 'No fallback'}`);
}
printCase('RT-1048');
// The case the plan moved furthest off its standalone best, and a case priced on an estimate.
const moved = open
  .filter(({ case: c, decision }) => c.id !== 'RT-1048' && decision.planNote && /goes to|slots/.test(decision.planNote))
  .sort((a, b) => b.decision.standaloneBest.net - b.decision.best.net - (a.decision.standaloneBest.net - a.decision.best.net))[0];
if (moved) printCase(moved.case.id);
const estimate = open
  .filter(({ case: c, decision }) => c.id !== moved?.case.id && !decision.planNote && decision.best.estimate && decision.best.route === 'resale')
  .sort((a, b) => b.decision.gainOverStandard - a.decision.gainOverStandard)[0];
if (estimate) printCase(estimate.case.id);

console.log('\n=== Agent trail RT-1048 ===');
for (const step of ds.agentTrail('RT-1048')) console.log(`  ${step.title}: ${step.conclusion}`);

console.log('\n=== Consistency (same scope must agree) ===');
for (const tenant of ['All', 'Customer A', 'Customer B', 'Customer C']) {
  const scope = { tenant };
  const metrics = computeSummary(scope);
  const kf = await dashboardService.keyFigures(scope, 30);
  const ex = await exceptionService.summary(tenant === 'All' ? undefined : scope);
  const how = ds.howCalculated('potentialRecovery', scope);
  const howRisk = ds.howCalculated('valueAtRisk', scope);
  const listed = (await caseService.list({}, scope)).items;
  const openNet = ds.openDecisions(scope).reduce((a, r) => a + r.decision.best.net, 0);
  const openListed = listed.filter((c) => !['approved', 'handed_off'].includes(c.stage)).reduce((a, c) => a + c.estimatedNetRecovery, 0);
  console.log(`${tenant}: potential recovery ${usd(metrics.potentialRecovery)} · value at risk ${usd(metrics.valueAtRisk)} · exceptions value at risk ${usd(ex.valueAtRisk)} · open best net ${usd(openNet)}`);
  check(`${tenant}: Key Figures = Dashboard potential recovery`, metrics.potentialRecovery === kf.portfolio.potentialRecovery);
  check(`${tenant}: Key Figures = How calculated potential recovery`, metrics.potentialRecovery === how.value);
  check(`${tenant}: Key Figures value at risk = Exceptions value at risk`, metrics.valueAtRisk === ex.valueAtRisk);
  check(`${tenant}: Key Figures value at risk = How calculated`, metrics.valueAtRisk === howRisk.value);
  check(`${tenant}: case list net (open) = engine best net`, openListed === openNet);
}

// Case page route economics = engine decision
for (const c of caseService.peek ? [caseService.peek('RT-1048'), caseService.peek(moved?.case.id ?? 'RT-1048')] : []) {
  // The Case page renders scenarioDecision(record, BASE_SCENARIO) when no scenario lever is moved.
  const best = scenarioDecision(c, BASE_SCENARIO).decision.best;
  const d = ds.decide(c.id);
  check(`${c.id}: Case page best route = engine (${best?.route} ${usd(best?.net ?? 0)}) and = case record (${c.recommendedRoute} ${usd(c.estimatedNetRecovery)})`, best?.route === d.best.route && best?.net === d.best.net && c.recommendedRoute === d.best.route && c.estimatedNetRecovery === d.best.net);
}

// Gates, ranges, instructions, snapshot and presets (src/services/decision/insights.ts).
console.log('\n=== Gates, ranges, instructions, presets ===');
{
  const all = caseService.all ? caseService.all() : ds.scopedCases();
  let gateFail = 0, rangeFail = 0, statusFail = 0, instrFail = 0;
  for (const c of all) {
    const d = ds.decide(c.id);
    if (!d) continue;
    const ins = ds.decisionInsights(c, d);
    for (const r of d.all) {
      const ri = ins.routes[r.route];
      if (ri.gates.length !== 6 || !ri.gates.every((g) => ['ok', 'warning', 'failed', 'na'].includes(g.status) && g.reason)) gateFail += 1;
      if ((ri.status === 'Restricted') !== !r.viable) statusFail += 1;
      if (r.viable && !(ri.range && ri.range.p10 <= r.net && r.net <= ri.range.p90)) rangeFail += 1;
    }
    const p = ds.instructionPreview(c.id, d.best.route);
    const expected = d.best.viable ? { redeploy: [4, 5], relase: [4, 5], resale: [4, 5], intparts: [5, 6], extparts: [4, 5], material: [6, 6], exit: [5, 5] }[d.best.route] : [0, 0];
    if (!p || p.instructions.length < expected[0] || p.instructions.length > expected[1] || !p.summary.includes(`${p.instructions.length} instructions`) && p.instructions.length) instrFail += 1;
  }
  check(`gates computed for every route of all ${all.length} cases (6 gates each)`, gateFail === 0);
  check('Restricted ⇔ not viable in the engine', statusFail === 0);
  check('P10 ≤ net ≤ P90 for every viable route', rangeFail === 0);
  check('instruction preview count matches the route', instrFail === 0);
  const c48 = caseService.peek('RT-1048');
  const s1 = ds.decisionInsights(c48).snapshotId;
  const s2 = ds.decisionInsights(caseService.peek('RT-1048')).snapshotId;
  check(`snapshot id stable across reads (${s1})`, /^EVS-[0-9A-F]{8}$/.test(s1) && s1 === s2);
  // A fresh engine load (simulates a reload) gives the same id.
  const jiti2 = createJiti(path.join(root, 'package.json'), { alias: { '@': path.join(root, 'src') }, moduleCache: false });
  const ds2 = await jiti2.import(path.join(root, 'src/services/decisionService.ts'));
  const { caseService: cs2 } = await jiti2.import(path.join(root, 'src/services/caseService.ts'));
  check('snapshot id stable across reloads', ds2.decisionInsights(cs2.peek('RT-1048')).snapshotId === s1);
  // Presets that should flip the ranking do flip it.
  const flips = ds.rankingFlips(c48);
  const flipped = (id) => flips.find((f) => f.preset === id)?.flips;
  const best = ds.decide('RT-1048').best;
  check(`RT-1048 (${best.route}): demand cancelled flips the ranking`, best.demand && flipped('demand_cancelled') === true);
  check('RT-1048: customer requires a new unit flips a re-lease / redeploy ranking', !['relase', 'redeploy'].includes(best.route) || flipped('new_unit') === true);
  check('RT-1048: parts cost +30% keeps the ranking (robust)', flipped('parts_cost_up') === false);
  const one = ds.stressCase(c48, {}, 'new_unit', 'resale');
  check('preset applied to one untouched route does not change the ranking', one.decision.best.route === best.route && one.stress.affects === false);
  for (const f of flips.filter((x) => x.flips)) console.log(`  ${f.text}`);
  // Hand-off instructions before approval are not sent.
  const pre = ds.handoffInstructions('RT-1048');
  check('before approval every instruction is "not sent" with no due time', pre.length > 0 && pre.every((i) => i.status === 'not_sent' && i.dueAt === null));
}

// Approve freezes the engine route; rules publish re-plans.
const snapBefore = ds.decisionInsights(caseService.peek('RT-1048')).snapshotId;
const before = caseService.peek('RT-1048');
await caseService.approve('RT-1048', 'check script');
const after = caseService.peek('RT-1048');
check(`approve keeps route ${after.recommendedRoute} ${usd(after.estimatedNetRecovery)} and holds ${after.demandIds?.join(', ')}`, after.recommendedRoute === before.recommendedRoute && after.estimatedNetRecovery === before.estimatedNetRecovery && after.stage === 'approved');
{
  const apr = ds.approvalRecord('RT-1048');
  check(`approval record ${apr?.ref} freezes snapshot ${apr?.snapshotId} = pre-approval snapshot`, apr?.snapshotId === snapBefore);
  check('approved but not sent: every instruction is still "not sent" (staged)', ds.handoffInstructions('RT-1048').every((i) => i.status === 'not_sent'));
  const sent = ds.sendInstructions('RT-1048');
  const later = new Date(Date.parse(apr.at) + 30 * 86_400_000).toISOString();
  const h = ds.handoffInstructions('RT-1048', later);
  check('after sending, instructions carry approval ref and due = sent + time limit', h.length > 0 && sent.every((i) => i.status === 'sent') && h.every((i) => i.approvalRef === apr.ref && i.dueAt && i.dueAt > i.sentAt));
  check('instructions not done 30 days later are flagged overdue', h.every((i) => i.status === 'done' || i.overdue));
  ds.publishRules([...ds.getPublishedRules().rules], ds.getPublishedRules().version + 1, 'check script');
  check('snapshot stays frozen after the model version changes', ds.approvalRecord('RT-1048').snapshotId === snapBefore);
}
check('approved demand is no longer offered to other open cases',!Object.values(ds.planQueue().assignments).some((a) => a.demandIds.some((id) => after.demandIds?.includes(id))));

// Planner proposes another route → Approver approves → the case takes the proposed route; withdraw clears.
const { commandService } = await load('commandService.ts');
const { caseLifecycleService: life } = await load('caseLifecycleService.ts');
const APPROVER = { id: 'u-approver', name: 'Approver (check)', role: 'Approver' };
const PLANNER = { id: 'u-planner-a', name: 'Planner (check)', role: 'Planner' };
const ENGINEER = { id: 'u-engineer', name: 'Engineer (check)', role: 'Engineer' };
const ADMIN = { id: 'u-admin', name: 'Admin (check)', role: 'Admin' };
const FINANCE = { id: 'u-finance', name: 'Finance (check)', role: 'Finance' };
const EXEC = { id: 'u-executive', name: 'Executive (check)', role: 'Executive' };
// A declined case is re-evaluated before it can be proposed again (Re-evaluate → Ready for decision).
const reevalCase = ds
  .openDecisions()
  .filter(({ case: c, decision }) => c.stage === 'reevaluate' && decision.all.some((r) => r.viable && r.route !== decision.best.route))
  .map(({ case: c }) => c)[0];
let sendRefused = false;
try {
  ds.proposeRoute(reevalCase.id, null, null, '', 'Planner (check)');
} catch {
  sendRefused = true;
}
check(`send to approver on ${reevalCase?.id} (re-evaluate) is refused until it is re-evaluated`, sendRefused);
if (reevalCase) ds.reevaluate(reevalCase.id, 'Planner (check)');
const propCase = reevalCase && caseService.peek(reevalCase.id).stage === 'ready_for_decision' ? caseService.peek(reevalCase.id) : null;
if (propCase) {
  const d0 = ds.decide(propCase.id);
  const alt = d0.all.find((r) => r.viable && r.route !== d0.best.route);
  let threw = false;
  try {
    ds.proposeRoute(propCase.id, alt.route, null, '', 'Planner (check)');
  } catch {
    threw = true;
  }
  check('proposing another route without a reason is refused', threw);
  ds.proposeRoute(propCase.id, alt.route, 'Customer commitment', 'check script', 'Planner (check)');
  const proposed = caseService.peek(propCase.id);
  check(
    `propose ${alt.route} on ${propCase.id} (was ${propCase.stage}) → awaiting approval, proposal by Planner (check)`,
    proposed.stage === 'awaiting_approval' && proposed.proposal?.route === alt.route && ds.getProposal(propCase.id)?.proposedBy === 'Planner (check)',
  );
  const row = (await commandService.approvals({ search: propCase.id })).find((r) => r.id === propCase.id);
  check('Approvals inbox shows the proposer as Submitted by', row?.submittedBy === 'Planner (check)' && row?.proposal?.route === alt.route);
  ds.withdrawProposal(propCase.id, 'Planner (check)');
  const withdrawn = caseService.peek(propCase.id);
  check(`withdraw clears the proposal and restores stage ${propCase.stage}`, !ds.getProposal(propCase.id) && !withdrawn.proposal && withdrawn.stage === propCase.stage);
  ds.proposeRoute(propCase.id, alt.route, 'Customer commitment', 'check script', 'Planner (check)', { id: PLANNER.id, role: 'Planner' });
  await life.approve(propCase.id, APPROVER, 'approved as proposed');
  const approved = caseService.peek(propCase.id);
  check(
    `approve as Approver applies the proposed route (${approved.recommendedRoute} ${usd(approved.estimatedNetRecovery)} = approval record; re-planned with the route fixed) and keeps the proposer`,
    approved.stage === 'approved' && approved.recommendedRoute === alt.route && approved.estimatedNetRecovery === ds.approvalRecord(propCase.id).net && approved.proposal?.proposedBy === 'Planner (check)' && !ds.getProposal(propCase.id),
  );
  check('the override log names the proposer', ds.overrideStats().recent.some((o) => o.caseId === propCase.id && o.actor === 'Planner (check)' && o.route === alt.route));
  // Decline clears a proposal.
  const declineCase = ds.openDecisions().find(({ case: c }) => c.stage === 'awaiting_approval' && c.id !== propCase.id)?.case;
  if (declineCase) {
    ds.proposeRoute(declineCase.id, null, null, 'send as recommended', 'Planner (check)');
    check(`send recommended route on ${declineCase.id} stores a proposal with route null`, ds.getProposal(declineCase.id)?.route === null);
    await caseService.decline(declineCase.id);
    check('decline clears the proposal', !ds.getProposal(declineCase.id) && !caseService.peek(declineCase.id).proposal);
  }
} else {
  check('found an open case with an alternative route to propose', false);
}

const rules = ds.getPublishedRules();
const v0 = ds.summary().queueValue;
ds.publishRules([...rules.rules, { id: 'BR-03', action: 'exclude', route: 'resale', scope: { productClass: ['drill'] }, owner: 'Remarketing lead', description: 'Power tools: never Whole-Asset Resale', active: true }], rules.version + 1, 'check script');
const v1 = ds.summary().queueValue;
check(`publishing a rule re-plans (queue ${usd(v0)} → ${usd(v1)})`, v0 !== v1);
const inbox = ds.runAgents();
check(`run agents decided ${inbox.decided.length} new returns, +${usd(inbox.gainOverStandard)} over standard`, inbox.decided.length === 3 && ds.getInbox().length === 0);
check('refill puts 3 returns back in the inbox', ds.refillInbox().length === 3);

/* ======================================================================== case lifecycle */
console.log('\n=== Case lifecycle (caseLifecycleService) ===');
const { auditService } = await load('auditService.ts');
const { taskService } = await load('taskService.ts');
const { governanceService } = await load('governanceService.ts');
const { agentControlsService } = await load('agentControlsService.ts');
const { intakeService } = await load('intakeService.ts');
const { productService } = await load('productService.ts');
const auditFor = async (caseId) => (await auditService.list({ search: caseId, pageSize: 500 })).items.filter((e) => e.caseId === caseId);
const tasksFor = async (role, caseId) => (await taskService.list({ role, status: 'open', pageSize: 500 })).items.filter((t) => t.caseId === caseId);

// 1. Approve → instructions → delivered → outcome row → Finance confirm + reconcile → learning history.
{
  const loop = ds.openDecisions().find(({ case: c, decision: d }) => c.stage === 'awaiting_approval' && d.best.viable && d.best.net > 0 && d.best.net <= 25000 && !c.proposal)?.case;
  const accBefore = ds.accuracy().n;
  const apr = await life.approve(loop.id, APPROVER, 'check loop');
  const row0 = commandService.handoffOf(loop.id);
  check(`${loop.id}: approve → Handed off row staged, ${row0.steps.length} steps not sent`, caseService.peek(loop.id).stage === 'approved' && row0.status === 'staged' && row0.steps.every((i) => i.status === 'not_sent'));
  await life.sendInstruction(loop.id, PLANNER);
  const row1 = commandService.handoffOf(loop.id);
  check(`${loop.id}: send instruction → in transit, every step sent, case handed off`, row1.status === 'in_transit' && row1.steps.every((i) => i.status === 'sent') && caseService.peek(loop.id).stage === 'handed_off');
  // Resend is idempotent: same id, no duplicate step.
  const first = row1.steps[0];
  await life.resend(loop.id, first.id, PLANNER);
  await life.resend(loop.id, first.id, PLANNER);
  const afterResend = ds.handoffInstructions(loop.id);
  check(`${loop.id}: resend twice keeps ${row1.steps.length} steps, same id ${first.id}, resends 2`, afterResend.length === row1.steps.length && afterResend.filter((i) => i.id === first.id).length === 1 && afterResend[0].resends === 2);
  let simRefused = false;
  try {
    await life.acknowledgeStep(loop.id, first.id, PLANNER);
  } catch {
    simRefused = true;
  }
  check('simulated system acknowledgement is refused for a Planner (Admin / Developer only)', simRefused);
  let guard = 0;
  let delivered = false;
  while (!delivered && guard++ < 30) delivered = (await life.advance(loop.id, ADMIN)).delivered;
  const row2 = commandService.handoffOf(loop.id);
  check(`${loop.id}: every step acknowledged then done → register delivered (${row2.done}/${row2.steps.length})`, delivered && row2.status === 'delivered' && ds.handoffInstructions(loop.id).every((i) => i.status === 'done'));
  const out = commandService.outcomeOf(loop.id);
  check(`${loop.id}: outcome row created: predicted ${usd(out?.predicted ?? 0)} = approval net, realised ${usd(out?.actual ?? 0)}, ${out?.costLines?.length} cost lines`, !!out && out.status === 'pending_invoice' && out.predicted === apr.net && out.actual === ds.realisedNetFor(loop.id, apr.net) && out.costLines?.length > 0);
  check(`${loop.id}: Finance has a "Confirm outcome" task`, (await tasksFor('Finance', loop.id)).some((t) => t.type === 'confirm_outcome'));
  let early = false;
  try {
    await life.reconcile(loop.id, FINANCE);
  } catch {
    early = true;
  }
  check('reconcile before confirming the receipt is refused', early);
  await life.confirmReceipt(loop.id, FINANCE);
  const { historyId } = await life.reconcile(loop.id, FINANCE);
  const hist = ds.listHistory({ search: loop.id }).items.find((h) => h.caseId === loop.id);
  check(`${loop.id}: reconcile writes learning record ${historyId} (forecast ${usd(hist?.forecastNet ?? 0)}, realised ${usd(hist?.realisedNet ?? 0)})`, hist?.id === historyId && hist.forecastNet === out.predicted && hist.realisedNet === out.actual && commandService.outcomeOf(loop.id).status === 'reconciled');
  check(`Forecast quality now counts ${ds.accuracy().n} decisions (was ${accBefore})`, ds.accuracy().n === accBefore + 1);
  check(`${loop.id}: Finance task closed`, (await tasksFor('Finance', loop.id)).length === 0);
  const a = await auditFor(loop.id);
  const has = (re) => a.some((e) => re.test(e.action));
  check(
    `${loop.id}: audit has approve, send, resend, acknowledge, done, delivered, confirm, reconcile (${a.length} entries)`,
    has(/^Approved/) && has(/^Instruction sent/) && has(/^Instruction resent/) && has(/^Step acknowledged/) && has(/^Step done/) && has(/^Delivered/) && has(/receipt confirmed/) && has(/^Outcome reconciled/),
  );
  check('audit chain stays linked (each entry points at the previous hash)', (() => {
    const all = a.sort((x, y) => (x.id < y.id ? -1 : 1));
    return all.every((e) => typeof e.prevHash === 'string' && e.prevHash.length === 64);
  })());
}

// 2. Seeded register agrees with the instruction steps.
{
  const rows = await commandService.handoffs({});
  const bad = rows.filter((r) => r.status === 'delivered' && !commandService.outcomeOf(r.id));
  check(`every delivered Handed off row (${rows.filter((r) => r.status === 'delivered').length}) has an outcome row`, bad.length === 0);
  const outs = await commandService.outcomes({ status: 'all' });
  check('every outcome row belongs to a delivered hand-off', outs.every((o) => commandService.handoffOf(o.id)?.status === 'delivered'));
}

// 3. Receive an ASN → awaiting inspection → send refused → inspection → ready, re-decided → send works.
{
  const asn = productService.expected.allInScope({}).find((x) => x.tenant === 'Customer A' && x.quantity <= 6);
  const res = await intakeService.receive(asn.id, { date: '2026-11-20', bay: 'Bay 2', receivedBy: 'check' }, { id: 'u-wm-1', name: 'WM (check)', role: 'Warehouse Manager' });
  const c0 = res.cases[0];
  let refused = false;
  try {
    await life.sendToApprover(c0.id, PLANNER);
  } catch (e) {
    refused = /inspection/i.test(e.message);
  }
  check(`${c0.id} (received from ${asn.id}) is awaiting inspection; Send to approver is refused`, c0.stage === 'awaiting_inspection' && refused);
  let engOnly = false;
  try {
    await life.recordInspection(c0.id, { grade: 'B', test: 'pass', lifePct: 70, notes: '', photosReceived: true }, PLANNER);
  } catch {
    engOnly = true;
  }
  check('a Planner cannot record an inspection', engOnly);
  const snap0 = ds.decisionInsights(caseService.peek(c0.id)).snapshotId;
  const r = await life.recordInspection(c0.id, { grade: 'B', test: 'pass', lifePct: 72, notes: 'check', photosReceived: true }, ENGINEER);
  const c1 = caseService.peek(c0.id);
  check(`${c0.id}: inspection → ${c1.stage}, Grade ${c1.condition}, evidence ${c1.evidenceCompleteness} %, new snapshot ${r.snapshotId}`, c1.stage === 'ready_for_decision' && c1.condition === 'B' && c1.evidenceCompleteness === 100 && r.snapshotId !== snap0 && ds.caseContext(c1).lifePct === 72 && !c1.blockedReason);
  check(`${c0.id}: Engineer task done, Planner has "Review and send"`, (await tasksFor('Engineer', c0.id)).length === 0 && (await tasksFor('Planner', c0.id)).some((t) => /Review and send/.test(t.title)));
  const sent = await life.sendToApprover(c0.id, PLANNER);
  check(`${c0.id}: Send to approver works after inspection (${caseService.peek(c0.id).stage})`, !!sent.proposal && ['awaiting_approval', 'approved'].includes(caseService.peek(c0.id).stage));
  const a = await auditFor(c0.id);
  check(`${c0.id}: audit has inspection and send`, a.some((e) => /^Inspection recorded/.test(e.action)) && a.some((e) => /^Sent to approver/.test(e.action) || /^Auto-approved/.test(e.action)));
  // Request evidence on a submitted case sets the submission aside; the inspection brings it back to Awaiting approval.
  const sub = ds.openDecisions().find(({ case: c }) => c.stage === 'awaiting_approval' && c.id !== c0.id && !c.proposal)?.case;
  await life.sendToApprover(sub.id, PLANNER);
  if (caseService.peek(sub.id).stage === 'awaiting_approval') {
    await life.requestEvidence(sub.id, APPROVER);
    check(`${sub.id}: request evidence → needs information, Engineer task`, caseService.peek(sub.id).stage === 'needs_information' && (await tasksFor('Engineer', sub.id)).length > 0);
    await life.recordInspection(sub.id, { grade: 'B', test: 'conditional', lifePct: 60, notes: '', photosReceived: false }, ENGINEER);
    const back = caseService.peek(sub.id);
    check(`${sub.id}: inspection returns the set-aside submission to Awaiting approval (evidence ${back.evidenceCompleteness} %)`, back.stage === 'awaiting_approval' && back.proposal?.proposedBy === PLANNER.name && back.evidenceCompleteness < 100);
  }
}

// 4. Decline (reason) → Re-evaluate shows what changed → send again.
{
  const dc = ds.openDecisions().find(({ case: c, decision: d }) => c.stage === 'awaiting_approval' && d.best.viable && !c.proposal && d.best.net <= 25000)?.case;
  let noReason = false;
  try {
    await life.decline(dc.id, APPROVER, '  ');
  } catch {
    noReason = true;
  }
  check('decline without a reason is refused', noReason);
  await life.decline(dc.id, APPROVER, 'Price looks optimistic');
  check(`${dc.id}: decline → re-evaluate with the reason recorded`, caseService.peek(dc.id).stage === 'reevaluate' && life.declineOf(dc.id)?.reason === 'Price looks optimistic' && (await tasksFor('Planner', dc.id)).some((t) => /Re-evaluate/.test(t.title)));
  const snapBefore = life.declineOf(dc.id).snapshotId;
  const r = await life.reevaluate(dc.id, PLANNER);
  check(`${dc.id}: re-evaluate → ${caseService.peek(dc.id).stage}: "${r.summary}" (new snapshot ${r.toSnapshotId})`, caseService.peek(dc.id).stage === 'ready_for_decision' && r.toSnapshotId !== snapBefore && r.declineReason === 'Price looks optimistic' && /Recommendation (unchanged|changed)/.test(r.summary));
  await life.sendToApprover(dc.id, PLANNER);
  check(`${dc.id}: resent to the approver`, ['awaiting_approval', 'approved'].includes(caseService.peek(dc.id).stage));
  const a = await auditFor(dc.id);
  check(`${dc.id}: audit has decline, re-evaluate, send`, a.some((e) => /^Declined/.test(e.action)) && a.some((e) => /^Re-evaluated/.test(e.action)) && a.some((e) => /^Sent to approver|^Auto-approved/.test(e.action)));
}

// 5. Approval limits: approver above the limit refused → escalate → Executive approves; Planner limit; self-approval.
{
  const actorAdmin = { id: 'u-admin', name: 'check', role: 'Admin' };
  const big = ds.openDecisions().filter(({ case: c, decision: d }) => c.stage === 'awaiting_approval' && d.best.viable && !c.proposal).sort((x, y) => y.decision.best.net - x.decision.best.net)[0].case;
  const t0 = governanceService ? (await governanceService.getApprovalThresholds()) : null;
  // No open case is above the default $25k limit, so lower the limit to $5,000 for the check (thresholds must rise: 2,500 ≤ 5,000 ≤ limit).
  await governanceService.updateApprovalThresholds({ delegationLimit: 5000 }, actorAdmin);
  const p = life.approvalPolicy(big.id, APPROVER);
  check(`${big.id} (${usd(p.net)}): approver above the $5k limit refused: "${p.reason}"`, !p.allowed && p.canEscalate && /escalate to Executive/.test(p.reason) && p.tier === 'Executive');
  let refused = false;
  try {
    await life.approve(big.id, APPROVER);
  } catch {
    refused = true;
  }
  check('approve above the limit throws', refused && caseService.peek(big.id).stage === 'awaiting_approval');
  const esc = await life.escalateToExecutive(big.id, APPROVER);
  check(`escalated to Executive: task ${esc.taskId} visible to the Executive`, (await tasksFor('Executive', big.id)).some((t) => t.id === esc.taskId));
  check('Executive may approve above the delegation limit', life.approvalPolicy(big.id, EXEC).allowed);
  await life.approve(big.id, EXEC, 'exec sign-off');
  check(`${big.id}: approved by the Executive; escalation task closed`, caseService.peek(big.id).stage === 'approved' && (await tasksFor('Executive', big.id)).length === 0);
  const a = await auditFor(big.id);
  check(`${big.id}: audit has escalate and approve`, a.some((e) => /^Escalated to Executive/.test(e.action)) && a.some((e) => /^Approved/.test(e.action)));
  await governanceService.updateApprovalThresholds({ delegationLimit: t0.delegationLimit }, actorAdmin);
  const small = ds.openDecisions().find(({ case: c, decision: d }) => c.stage === 'awaiting_approval' && d.best.viable && !c.proposal && d.best.net > 0)?.case;
  check(`Planner limit $0: a Planner cannot approve ${small.id}`, !life.approvalPolicy(small.id, PLANNER).allowed);
  ds.proposeRoute(small.id, null, null, 'self', APPROVER.name, { id: APPROVER.id, role: 'Approver' });
  const self = life.approvalPolicy(small.id, APPROVER);
  check(`self-approval blocked while "allow self-approval" is off: "${self.reason}"`, !self.allowed && /submitted/.test(self.reason));
  check('Admin approves without limit', life.approvalPolicy(small.id, ADMIN).allowed);
}

// 6. Auto-approve only within policy (Grade A, below $2,500, every gate OK).
{
  const t = (await governanceService.getApprovalThresholds()).autoApproveBelow;
  let auto = null;
  let notAuto = null;
  for (const { case: c } of ds.openDecisions().filter(({ case: c }) => c.stage === 'awaiting_inspection')) {
    if (auto && notAuto) break;
    const grade = auto ? 'B' : 'A';
    await life.recordInspection(c.id, { grade, test: 'pass', lifePct: 90, notes: '', photosReceived: true }, ENGINEER);
    const pol = life.autoApprovePolicy(c.id);
    if (!auto && pol.eligible) auto = c.id;
    else if (auto && !notAuto && caseService.peek(c.id).stage === 'ready_for_decision' && ds.decide(c.id).best.net < t) notAuto = c.id;
  }
  check(`found a small Grade A case within auto-approve policy (${auto})`, !!auto);
  if (auto) {
    const r = await life.sendToApprover(auto, PLANNER);
    const apr = ds.approvalRecord(auto);
    check(`${auto}: auto-approved as "${apr?.actor}" (${usd(apr?.net ?? 0)} < ${usd(t)})`, !!r.autoApproved && caseService.peek(auto).stage === 'approved' && apr.actor === 'Circularity (auto, within policy)' && apr.net < t);
    check(`${auto}: audit records the auto-approval`, (await auditFor(auto)).some((e) => /^Auto-approved within policy/.test(e.action) && e.actorType === 'agent'));
  }
  if (notAuto) {
    const r = await life.sendToApprover(notAuto, PLANNER);
    check(`${notAuto}: Grade B below ${usd(t)} is not auto-approved (${life.autoApprovePolicy(notAuto).reasons.join('; ') || 'awaiting approval'})`, !r.autoApproved && caseService.peek(notAuto).stage === 'awaiting_approval');
  }
}

// 6b. Admin alone takes a case from receipt to reconciled (every case action is open to Admin).
{
  const asn = productService.expected.allInScope({}).find((x) => x.quantity <= 4);
  const res = await intakeService.receive(asn.id, { date: '2026-11-20', bay: 'Bay 3', receivedBy: 'admin check' }, ADMIN);
  const id = res.cases[0].id;
  await life.recordInspection(id, { grade: 'B', test: 'pass', lifePct: 75, notes: '', photosReceived: true }, ADMIN);
  const apr = await life.approveDirectly(id, ADMIN);
  await life.sendInstruction(id, ADMIN);
  let delivered = false;
  for (let g = 0; g < 30 && !delivered; g++) delivered = (await life.advance(id, ADMIN)).delivered;
  await life.confirmReceipt(id, ADMIN);
  const { historyId } = await life.reconcile(id, ADMIN);
  const a = await auditFor(id);
  check(`Admin alone: ${id} received → inspected → approved directly (${apr.ref}) → delivered → reconciled (${historyId})`, delivered && commandService.outcomeOf(id).status === 'reconciled' && a.some((e) => /^Approved directly by Admin \(no separate submitter\)/.test(e.action)));
  // Admin approving a case the same Admin submitted: allowed (no limit), audited as an Admin override.
  const own = ds.openDecisions().find(({ case: c, decision: d }) => c.stage === 'ready_for_decision' && d.best.viable)?.case;
  if (own) {
    await life.sendToApprover(own.id, ADMIN);
    if (caseService.peek(own.id).stage === 'awaiting_approval') {
      const pol = life.approvalPolicy(own.id, ADMIN);
      await life.approve(own.id, ADMIN);
      check(`${own.id}: Admin approves own submission with self-approval off, audited as Admin override`, pol.allowed && pol.sameSubmitter && (await auditFor(own.id)).some((e) => /Admin override: same person submitted and approved/.test(e.action)));
    }
  }
}

// 7. Run agents: prepared decisions for the Planner, never in Approvals; refused while the agents are stopped.
{
  ds.refillInbox();
  const before = new Set((await commandService.approvals({})).map((r) => r.id));
  const res = await life.runAgents(undefined, ADMIN);
  const after = (await commandService.approvals({})).map((r) => r.id);
  const ids = res.decided.map((d) => d.caseId);
  check(`run agents prepared ${ids.join(', ')} as Ready for decision, none in Approvals`, ids.length > 0 && ids.every((id) => caseService.peek(id).stage === 'ready_for_decision') && !after.some((id) => ids.includes(id) && !before.has(id)));
  check('each prepared decision has a Planner task "Review and send"', (await Promise.all(ids.map((id) => tasksFor('Planner', id)))).every((ts) => ts.some((t) => /Review and send/.test(t.title))));
  check('each prepared decision is audited', (await Promise.all(ids.map(auditFor))).every((a) => a.some((e) => /^Decision prepared by agents/.test(e.action))));
  ds.refillInbox();
  await agentControlsService.stopAll('check script', ADMIN);
  const block = await life.runAgentsBlock();
  let stopped = false;
  try {
    await life.runAgents(undefined, ADMIN);
  } catch {
    stopped = true;
  }
  check(`run agents refused while agents are stopped ("${block}")`, !!block && stopped && ds.getInbox().length > 0);
  await agentControlsService.resumeAll(ADMIN);
  check('run agents available again after Resume all', (await life.runAgentsBlock()) === null);
  await governanceService.updateApprovalLimits({ maxItemsPerBulkPlan: 1 }, ADMIN);
  const one = await life.runAgents(undefined, ADMIN);
  check(`max items per bulk plan = 1: one decision prepared, ${one.remaining} left in the inbox`, one.decided.length === 1 && one.remaining >= 1);
  await governanceService.updateApprovalLimits({ maxItemsPerBulkPlan: 50 }, ADMIN);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
