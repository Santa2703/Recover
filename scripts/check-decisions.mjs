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

// Approve freezes the engine route; rules publish re-plans.
const before = caseService.peek('RT-1048');
await caseService.approve('RT-1048', 'check script');
const after = caseService.peek('RT-1048');
check(`approve keeps route ${after.recommendedRoute} ${usd(after.estimatedNetRecovery)} and holds ${after.demandIds?.join(', ')}`, after.recommendedRoute === before.recommendedRoute && after.estimatedNetRecovery === before.estimatedNetRecovery && after.stage === 'approved');
check('approved demand is no longer offered to other open cases', !Object.values(ds.planQueue().assignments).some((a) => a.demandIds.some((id) => after.demandIds?.includes(id))));

// Planner proposes another route → Approver approves → the case takes the proposed route; withdraw clears.
const { commandService } = await load('commandService.ts');
const propCase = ds
  .openDecisions()
  .filter(({ case: c, decision }) => c.stage !== 'awaiting_approval' && decision.all.some((r) => r.viable && r.route !== decision.best.route))
  .map(({ case: c }) => c)[0];
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
  ds.proposeRoute(propCase.id, alt.route, 'Customer commitment', 'check script', 'Planner (check)');
  await commandService.approve(propCase.id, 'approved as proposed');
  const approved = caseService.peek(propCase.id);
  check(
    `approve as Approver applies the proposed route (${approved.recommendedRoute} ${usd(approved.estimatedNetRecovery)}) and keeps the proposer`,
    approved.stage === 'approved' && approved.recommendedRoute === alt.route && approved.estimatedNetRecovery === alt.net && approved.proposal?.proposedBy === 'Planner (check)' && !ds.getProposal(propCase.id),
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

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
