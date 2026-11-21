// Deterministic mock-data generator for Circularity. Usage: node gen-data.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('outDir required');
fs.mkdirSync(out, { recursive: true });

let seed = 20261120;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => Math.floor(lo + rnd() * (hi - lo + 1));
const round = (n, s = 10) => Math.round(n / s) * s;

const AS_OF = '2026-11-20T09:00:00Z';
const asOf = new Date(AS_OF);
const daysAgo = (d) => new Date(asOf.getTime() - d * 864e5).toISOString().slice(0, 10);
const daysAhead = (d) => new Date(asOf.getTime() + d * 864e5).toISOString().slice(0, 10);

const TENANTS = ['Customer A', 'Customer B', 'Customer C'];
const SITES = ['Warehouse 1', 'Warehouse 2', 'Repair centre'];

const CLASSES = {
  motor: { label: 'Industrial motor', pre: 'MTR', pnew: 11800, mfr: ['Voltara', 'Kestrel Drives', 'Halden Electric'], models: ['V4 75kW', 'KD-55', 'HX-90'], routes: ['redeploy', 'resale', 'relase', 'intparts'], w: 20 },
  pump: { label: 'Hydraulic pump', pre: 'PMP', pnew: 6400, mfr: ['Halden Hydraulics', 'Norvik Fluid', 'Aquaterra'], models: ['PMP-200', 'NF-40', 'AQ-12'], routes: ['redeploy', 'resale', 'intparts', 'material'], w: 18 },
  control: { label: 'Control unit', pre: 'CTL', pnew: 4300, mfr: ['Orbis Control', 'Kestrel Automation', 'Tessen Logic'], models: ['OC-7 PLC', 'KA-300', 'TL-9'], routes: ['redeploy', 'resale', 'extparts', 'material'], w: 17 },
  drill: { label: 'Power tool', pre: 'DRL', pnew: 340, mfr: ['Tessen Tools', 'Norvik Power', 'Brava'], models: ['TT-18V', 'NP-Drive', 'BR-X2'], routes: ['resale', 'intparts', 'material', 'exit'], w: 19 },
  batch: { label: 'Tool-fleet batch', pre: 'BAT', pnew: 150, mfr: ['Brava', 'Tessen Tools'], models: ['Fleet lot 24', 'Fleet lot 40'], routes: ['resale', 'material', 'exit'], w: 11 },
  it: { label: 'IT electronics', pre: 'ITE', pnew: 820, mfr: ['Lumeo Devices', 'Corvid Computing', 'Nimbus'], models: ['C14 laptop', 'LD Pro 13', 'NB-Edge'], routes: ['redeploy', 'resale', 'extparts', 'material'], w: 15 },
};
const classKeys = Object.keys(CLASSES);
const weightedClass = () => {
  const total = classKeys.reduce((s, k) => s + CLASSES[k].w, 0);
  let r = rnd() * total;
  for (const k of classKeys) { r -= CLASSES[k].w; if (r <= 0) return k; }
  return 'motor';
};

// Stage distribution (sums to 100)
const STAGES = [
  ['awaiting_inspection', 19],
  ['needs_information', 13],
  ['awaiting_approval', 32],
  ['approved', 5],
  ['handed_off', 24],
  ['reevaluate', 6],
  ['no_viable_route', 1],
];
const weightedStage = () => {
  let r = rnd() * 100;
  for (const [s, w] of STAGES) { r -= w; if (r <= 0) return s; }
  return 'awaiting_approval';
};

const USERS = [
  { id: 'u-planner-a', name: 'Priya Raman', role: 'Planner', tenant: 'Customer A', site: 'Warehouse 1', email: 'planner.a@northfield.example' },
  { id: 'u-planner-b', name: 'Tomás Herrera', role: 'Planner', tenant: 'Customer B', site: 'Warehouse 2', email: 'planner.b@northfield.example' },
  { id: 'u-planner-c', name: 'Aiko Tanaka', role: 'Planner', tenant: 'Customer C', site: 'Warehouse 1', email: 'planner.c@northfield.example' },
  { id: 'u-approver', name: 'Marcus Vance', role: 'Approver', tenant: 'All', site: 'Head office', email: 'approver@northfield.example' },
  { id: 'u-engineer', name: 'Dev Kapoor', role: 'Engineer', tenant: 'All', site: 'Repair centre', email: 'engineer@northfield.example' },
  { id: 'u-finance', name: 'Elena Rostova', role: 'Finance', tenant: 'All', site: 'Head office', email: 'finance@northfield.example' },
  { id: 'u-developer', name: 'Sam Okafor', role: 'Developer', tenant: 'All', site: 'Head office', email: 'developer@northfield.example' },
  { id: 'u-executive', name: 'Helen Brandt', role: 'Executive', tenant: 'All', site: 'Head office', email: 'executive@northfield.example' },
  { id: 'u-wm-1', name: 'Luis Ortega', role: 'Warehouse Manager', tenant: 'All', site: 'Warehouse 1', email: 'warehouse1@northfield.example' },
  { id: 'u-wm-2', name: 'Grace Mensah', role: 'Warehouse Manager', tenant: 'All', site: 'Warehouse 2', email: 'warehouse2@northfield.example' },
  { id: 'u-admin', name: 'Jordan Ellis', role: 'Admin', tenant: 'All', site: 'Head office', email: 'admin@northfield.example' },
];
const plannerFor = (tenant) => USERS.find((u) => u.role === 'Planner' && u.tenant === tenant);

const RISK_BY_STAGE = {
  awaiting_inspection: 'missing_evidence',
  needs_information: 'missing_evidence',
  awaiting_approval: null, // set by age
  reevaluate: 'condition_deterioration',
  no_viable_route: 'no_viable_route',
};

const N = 128;
const cases = [];
for (let i = 0; i < N; i++) {
  const cls = weightedClass();
  const c = CLASSES[cls];
  const tenant = TENANTS[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2];
  const site = pick(SITES);
  const stage = weightedStage();
  const ageYears = +(1 + rnd() * 7).toFixed(1);
  const conditionPool = stage === 'no_viable_route' ? ['D', 'Scrap'] : ['A', 'B', 'B', 'C', 'C', 'D'];
  const condition = pick(conditionPool);
  const condF = { A: 0.62, B: 0.5, C: 0.36, D: 0.2, Scrap: 0.04 }[condition];
  const qty = cls === 'batch' ? int(20, 40) : 1;
  const base = c.pnew * qty;
  const resale = round(base * condF * (0.8 + rnd() * 0.4));
  const refurb = round(base * (0.04 + (1 - condF) * 0.18));
  const net = Math.max(stage === 'no_viable_route' ? 0 : 40, resale - refurb);
  const route = stage === 'no_viable_route' ? 'exit' : pick(c.routes);
  const receivedAgo = stage === 'handed_off' ? int(20, 60) : stage === 'approved' ? int(10, 30) : int(1, 24);
  const dueIn = int(-3, 18);
  let riskReason = RISK_BY_STAGE[stage] ?? null;
  if (stage === 'awaiting_approval') riskReason = receivedAgo > 9 ? 'delayed_approval' : (rnd() < 0.18 ? 'market_price_decline' : null);
  if (!riskReason && (stage === 'awaiting_inspection' || stage === 'reevaluate') && site === 'Warehouse 1' && rnd() < 0.5) riskReason = 'capacity_constraint';
  if (!riskReason && stage === 'handed_off' && rnd() < 0.1) riskReason = 'capacity_constraint';
  const valueAtRisk = riskReason ? round(net * (riskReason === 'missing_evidence' ? 0.35 : riskReason === 'delayed_approval' ? 0.12 : riskReason === 'market_price_decline' ? 0.18 : riskReason === 'capacity_constraint' ? 0.22 : riskReason === 'condition_deterioration' ? 0.25 : 1)) : 0;
  const evidence = stage === 'awaiting_inspection' ? int(30, 60) : stage === 'needs_information' ? int(55, 80) : int(86, 100);
  const id = `RT-${1001 + i}`;
  const mfr = pick(c.mfr);
  const model = pick(c.models);
  const priority = valueAtRisk > 2000 || dueIn < 2 ? 'high' : dueIn < 6 ? 'medium' : 'low';
  cases.push({
    id,
    assetTag: `${c.pre}-${String(4000 + i * 7).padStart(5, '0')}`,
    serialNumber: `${mfr.slice(0, 2).toUpperCase()}${int(100000, 999999)}`,
    productClass: cls,
    productName: `${mfr} ${model}`,
    category: c.label,
    manufacturer: mfr,
    model,
    quantity: qty,
    location: site,
    tenant,
    owner: plannerFor(tenant).name,
    ownerId: plannerFor(tenant).id,
    receivedDate: daysAgo(receivedAgo),
    dueDate: daysAhead(dueIn),
    dueInDays: dueIn,
    condition,
    residualLifeMonths: Math.max(0, Math.round((1 - ageYears / 10) * 60 * condF * 2)),
    stage,
    recommendedRoute: route,
    estimatedNetRecovery: net,
    predictedResale: resale,
    refurbishmentCost: refurb,
    valueAtRisk,
    riskReason,
    carbonAvoidedKg: round(base / 40 * condF * (route === 'exit' ? 0.1 : 1), 5),
    priority,
    evidenceCompleteness: evidence,
    blockedReason: stage === 'no_viable_route' ? 'Every route fails the economics gate at current condition' : stage === 'awaiting_inspection' ? 'Condition grade missing: inspection not yet recorded' : stage === 'needs_information' ? 'Remaining-life evidence missing from EAM' : null,
    facts: {
      originalPrice: base,
      ageYears,
      lastServiceDate: daysAgo(int(60, 600)),
      warrantyStatus: ageYears < 3 ? 'active' : 'expired',
      wmsBinLocation: `${site === 'Repair centre' ? 'RC' : site === 'Warehouse 1' ? 'W1' : 'W2'}-${pick(['A', 'B', 'C', 'D'])}${int(1, 24)}-${int(1, 6)}`,
    },
    predictions: {
      secondaryMarketPrice: resale,
      refurbishmentCost: refurb,
      resaleDemandScore: +(0.35 + rnd() * 0.6).toFixed(2),
      failureRiskScore: +(0.05 + (1 - condF) * 0.5).toFixed(2),
    },
  });
}

// Make sure hero case RT-1048 exists with a sensible shape
const hero = cases.find((c) => c.id === 'RT-1048');
Object.assign(hero, { productClass: 'motor', productName: 'Voltara V4 75kW', category: 'Industrial motor', manufacturer: 'Voltara', model: 'V4 75kW', quantity: 1, stage: 'awaiting_approval', recommendedRoute: 'redeploy', tenant: 'Customer A', owner: 'Priya Raman', ownerId: 'u-planner-a', location: 'Warehouse 1', condition: 'B', estimatedNetRecovery: 6240, predictedResale: 7420, refurbishmentCost: 1180, valueAtRisk: 0, riskReason: null, evidenceCompleteness: 96, priority: 'high', dueInDays: 3, dueDate: daysAhead(3), blockedReason: null });

// ---------- Exceptions: grouped from case risk ----------
const REASON_LABEL = {
  missing_evidence: 'Missing evidence',
  condition_deterioration: 'Condition deterioration',
  delayed_approval: 'Delayed approval',
  market_price_decline: 'Market price decline',
  capacity_constraint: 'Capacity constraint',
  no_viable_route: 'No viable route',
};
const OWNER_BY_REASON = {
  missing_evidence: 'u-engineer',
  condition_deterioration: 'u-engineer',
  delayed_approval: 'u-approver',
  market_price_decline: 'u-planner-a',
  capacity_constraint: null, // warehouse manager of the site
  no_viable_route: 'u-planner-a',
};
const exceptions = [];
let exN = 101;
for (const site of SITES) {
  for (const reason of Object.keys(REASON_LABEL)) {
    const items = cases.filter((c) => c.location === site && c.riskReason === reason);
    if (!items.length) continue;
    items.sort((a, b) => b.valueAtRisk - a.valueAtRisk);
    const value = items.reduce((s, c) => s + c.valueAtRisk, 0);
    const owner = OWNER_BY_REASON[reason] ?? (site === 'Warehouse 2' ? 'u-wm-2' : 'u-wm-1');
    const severity = value > 8000 ? 'high' : value > 2500 ? 'medium' : 'low';
    exceptions.push({
      id: `EX-${exN++}`,
      type: reason,
      title: reason === 'capacity_constraint' ? `${site} bottleneck` : `Value at risk: ${REASON_LABEL[reason].toLowerCase()}`,
      warehouse: site,
      caseIds: items.map((c) => c.id),
      itemsCount: items.length,
      topCaseId: items[0].id,
      valueAtRisk: value,
      severity,
      status: rnd() < 0.25 ? 'notified' : 'open',
      ownerId: owner,
      openedAt: daysAgo(int(1, 12)),
      lastNotifiedAt: null,
    });
  }
}
// Integration and data-quality exceptions (not tied to case value)
exceptions.push(
  { id: `EX-${exN++}`, type: 'integration_failure', title: 'EAM condition feed stale (> 26h)', warehouse: 'Warehouse 1', caseIds: cases.filter((c) => c.location === 'Warehouse 1' && c.stage === 'awaiting_inspection').slice(0, 4).map((c) => c.id), itemsCount: 4, topCaseId: cases.find((c) => c.location === 'Warehouse 1' && c.stage === 'awaiting_inspection').id, valueAtRisk: 0, severity: 'medium', status: 'open', ownerId: 'u-developer', openedAt: daysAgo(1), lastNotifiedAt: null },
  { id: `EX-${exN++}`, type: 'data_quality', title: 'Duplicate serial numbers across ERP and WMS', warehouse: 'Warehouse 2', caseIds: cases.filter((c) => c.location === 'Warehouse 2').slice(0, 2).map((c) => c.id), itemsCount: 2, topCaseId: cases.find((c) => c.location === 'Warehouse 2').id, valueAtRisk: 0, severity: 'low', status: 'open', ownerId: 'u-developer', openedAt: daysAgo(3), lastNotifiedAt: null },
);
for (const e of exceptions) for (const id of e.caseIds) { const c = cases.find((x) => x.id === id); if (c && !c.exceptionId) c.exceptionId = e.id; }

// ---------- Tasks: assigned work derived from cases ----------
const tasks = [];
let tN = 1;
const addTask = (t) => tasks.push({ id: `TSK-${String(tN++).padStart(4, '0')}`, status: 'todo', ...t });
for (const c of cases) {
  const due = c.dueDate;
  if (c.stage === 'needs_information') addTask({ type: 'request_evidence', title: `Request remaining-life evidence for ${c.id}`, caseId: c.id, assigneeId: c.ownerId, role: 'Planner', dueDate: due, priority: c.priority, status: rnd() < 0.3 ? 'waiting' : 'todo' });
  if (c.stage === 'awaiting_inspection') addTask({ type: 'inspect', title: `Inspect and grade ${c.productName}`, caseId: c.id, assigneeId: 'u-engineer', role: 'Engineer', dueDate: due, priority: c.priority, status: rnd() < 0.25 ? 'in_progress' : 'todo' });
  if (c.stage === 'awaiting_approval') addTask({ type: 'approve', title: `Approve ${c.recommendedRoute} for ${c.id}`, caseId: c.id, assigneeId: 'u-approver', role: 'Approver', dueDate: due, priority: c.priority });
  if (c.stage === 'reevaluate') addTask({ type: 'prepare_decision', title: `Re-evaluate routes for ${c.id}`, caseId: c.id, assigneeId: c.ownerId, role: 'Planner', dueDate: due, priority: c.priority, status: 'in_progress' });
  if (c.stage === 'handed_off' && rnd() < 0.35) addTask({ type: 'confirm_outcome', title: `Confirm outcome for ${c.id}`, caseId: c.id, assigneeId: 'u-finance', role: 'Finance', dueDate: due, priority: 'medium' });
  if (c.stage === 'approved') addTask({ type: 'acknowledge', title: `Acknowledge hand-off for ${c.id}`, caseId: c.id, assigneeId: c.location === 'Warehouse 2' ? 'u-wm-2' : 'u-wm-1', role: 'Warehouse Manager', dueDate: due, priority: 'low' });
}
// a few completed tasks for "Completed" tab
for (const c of cases.filter((x) => x.stage === 'handed_off').slice(0, 8)) addTask({ type: 'prepare_decision', title: `Submit decision for ${c.id}`, caseId: c.id, assigneeId: c.ownerId, role: 'Planner', dueDate: daysAgo(int(5, 20)), priority: 'medium', status: 'done' });

// ---------- Alerts ----------
const alerts = [
  { id: 'AL-001', severity: 'danger', title: 'EAM condition feed stale for 26 hours', body: 'Inspection grades from EAM have not refreshed; 4 cases in Warehouse 1 cannot be routed.', source: 'Connection Fabric', link: '/integration/map', createdAt: '2026-11-20T07:40:00Z', read: false, roles: ['Developer', 'Admin', 'Planner', 'Warehouse Manager'] },
  { id: 'AL-002', severity: 'warning', title: 'Market feed is stale, resale prices carry a warning', body: 'The Machinio price feed last updated 3 days ago. Resale predictions use the last known prices.', source: 'Market intelligence', link: '/command/signals', createdAt: '2026-11-20T06:15:00Z', read: false, roles: ['Planner', 'Approver', 'Finance', 'Executive', 'Admin'] },
  { id: 'AL-003', severity: 'warning', title: 'Warehouse 1 inspection queue above capacity', body: 'Inspection backlog is 118% of configured weekly capacity.', source: 'Capacity', link: '/command/signals', createdAt: '2026-11-19T16:20:00Z', read: false, roles: ['Warehouse Manager', 'Executive', 'Admin', 'Engineer'] },
  { id: 'AL-004', severity: 'info', title: 'Model v1.3 promoted to production', body: 'Resale price model v1.3 replaced v1.2 after back-testing (bias −0.5%).', source: 'Analytics', link: '/analytics/forecast?tab=models', createdAt: '2026-11-18T10:00:00Z', read: true, roles: ['Finance', 'Executive', 'Admin', 'Developer', 'Planner'] },
  { id: 'AL-005', severity: 'danger', title: 'Workflow "ERP purchase sync" failed 3 runs', body: 'Authentication to SAP S/4 expired. Rotate the credential to resume.', source: 'Workflow studio', link: '/integration/studio', createdAt: '2026-11-20T05:02:00Z', read: false, roles: ['Developer', 'Admin'] },
  { id: 'AL-006', severity: 'info', title: 'Delegation updated', body: 'Admin delegated tenant access requests to the Approver.', source: 'Access', link: '/access/delegations', createdAt: '2026-11-17T12:30:00Z', read: true, roles: ['Approver', 'Admin'] },
];

// ---------- Monthly history (12 months to Oct 2026) ----------
const months = ['Nov 25', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26'];
const history = months.map((m, i) => {
  const predicted = round(150000 + Math.sin(i / 1.7) * 40000 + i * 6000, 1000);
  const yieldPct = +(0.9 + i * 0.006 + (rnd() - 0.5) * 0.03).toFixed(3);
  const actual = round(predicted * yieldPct, 1000);
  const decisions = int(95, 135);
  return {
    month: m,
    predictedRecovery: predicted,
    actualRecovery: actual,
    recoveryYield: yieldPct,
    decisionsClosed: decisions,
    avoidedSpend: round(actual * 0.71, 1000),
    co2AvoidedT: +(actual / 9300).toFixed(1),
    cycleTimeDays: +(26 - i * 0.45 + (rnd() - 0.5) * 2).toFixed(1),
    routeMix: { redeploy: int(22, 30), resale: int(20, 28), intparts: int(12, 18), relase: int(8, 13), material: int(8, 12), extparts: int(6, 10), exit: int(3, 6) },
  };
});

// ---------- Capacity ----------
const capacity = [
  { id: 'cap-insp-w1', label: 'Inspection bays · Warehouse 1', site: 'Warehouse 1', used: cases.filter((c) => c.location === 'Warehouse 1' && c.stage === 'awaiting_inspection').length + 7, capacity: 12, unit: 'assets / week' },
  { id: 'cap-insp-w2', label: 'Inspection bays · Warehouse 2', site: 'Warehouse 2', used: cases.filter((c) => c.location === 'Warehouse 2' && c.stage === 'awaiting_inspection').length + 4, capacity: 12, unit: 'assets / week' },
  { id: 'cap-repair', label: 'Repair benches · Repair centre', site: 'Repair centre', used: 9, capacity: 10, unit: 'jobs / week' },
  { id: 'cap-dock', label: 'Staging dock · Warehouse 2', site: 'Warehouse 2', used: 14, capacity: 20, unit: 'pallets / day' },
];

const meta = {
  asOf: AS_OF,
  organisation: 'Northfield Industrial Leasing',
  environment: 'Production',
  tenants: TENANTS,
  sites: SITES,
  routes: [
    { id: 'redeploy', name: 'Redeploy', description: 'Transfer to another internal site or operating line' },
    { id: 'resale', name: 'Resale', description: 'Sell the certified whole asset on secondary markets' },
    { id: 'intparts', name: 'Internal parts', description: 'Harvest components for the internal service fleet' },
    { id: 'relase', name: 'Re-lease', description: 'Refurbish and place into a new customer lease' },
    { id: 'material', name: 'Material recovery', description: 'Closed-loop recycling of metals and polymers' },
    { id: 'extparts', name: 'External parts', description: 'Sell certified parts to third-party repair networks' },
    { id: 'exit', name: 'Responsible exit', description: 'Certified environmental disposal' },
  ],
  stages: [
    { id: 'awaiting_inspection', label: 'Awaiting inspection' },
    { id: 'needs_information', label: 'Needs information' },
    { id: 'awaiting_approval', label: 'Awaiting approval' },
    { id: 'approved', label: 'Approved · handing off' },
    { id: 'handed_off', label: 'Handed off · awaiting outcome' },
    { id: 'reevaluate', label: 'Re-evaluate' },
    { id: 'no_viable_route', label: 'No viable route' },
  ],
  riskReasons: Object.entries(REASON_LABEL).map(([id, label]) => ({ id, label })),
  journey: [
    { id: 1, label: 'Supply evidence', phase: 'Evidence' },
    { id: 2, label: 'Build alternatives', phase: 'Evaluate' },
    { id: 3, label: 'Predict outcomes', phase: 'Evaluate' },
    { id: 4, label: 'Optimise plan', phase: 'Decide' },
    { id: 5, label: 'Plan approval', phase: 'Approve' },
    { id: 6, label: 'Send instruction', phase: 'Execute' },
    { id: 7, label: 'Create execution work', phase: 'Execute' },
    { id: 8, label: 'Repair & certify', phase: 'Execute' },
    { id: 9, label: 'Action & return outcome', phase: 'Reconcile' },
    { id: 10, label: 'Reconcile & learn', phase: 'Learn' },
  ],
};

const write = (f, d) => fs.writeFileSync(path.join(out, f), JSON.stringify(d, null, 2) + '\n');
write('meta.json', meta);
write('cases.json', cases);
write('exceptions.json', exceptions);
write('tasks.json', tasks);
write('alerts.json', alerts);
write('users.json', USERS);
write('history.json', history);
write('capacity.json', capacity);

const stageCount = Object.fromEntries(STAGES.map(([s]) => [s, cases.filter((c) => c.stage === s).length]));
console.log({ cases: cases.length, stageCount, exceptions: exceptions.length, exValue: exceptions.reduce((s, e) => s + e.valueAtRisk, 0), tasks: tasks.length });
