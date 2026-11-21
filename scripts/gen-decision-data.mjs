#!/usr/bin/env node
/**
 * Deterministic decision-engine data for Circularity.
 *
 *   node scripts/gen-decision-data.mjs
 *
 * Reads src/data/cases.json and writes src/data/decision/:
 *   channels.json   per case: intake channel, remaining life, harvestable parts
 *   demand.json     lease orders / renewals, sales orders, buyer bids, redeploy requests,
 *                   repair orders, recycler quotes (named demand)
 *   policy.json     economics, route owners / systems and the source catalogue
 *   guardrails.json GR-01 … GR-06 (locked)
 *   rules.json      published business rules (version 1)
 *   history.json    ~160 closed decisions over the last 60 days, decided by the same engine
 *   inbox.json      new returns not yet decided (Dashboard "Run agents" demo)
 *
 * The history is produced by running src/services/decision/engine.ts (loaded with jiti)
 * on synthetic closed cases, so forecasts in history use the same maths as the app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const { createJiti } = require('jiti');
const jiti = createJiti(path.join(root, 'package.json'), { alias: { '@': path.join(root, 'src') } });
const engine = await jiti.import(path.join(root, 'src/services/decision/engine.ts'));

const outDir = path.join(root, 'src/data/decision');
fs.mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------------ rng */
let seed = Number(process.env.SEED ?? 27);
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => Math.floor(lo + rnd() * (hi - lo + 1));
const between = (lo, hi) => lo + rnd() * (hi - lo);
const r10 = (n) => Math.round(n / 10) * 10;
const r5 = (n) => Math.round(n / 5) * 5;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Roughly normal noise with standard deviation `sd` (sum of uniforms). */
const gauss = (sd) => ((rnd() + rnd() + rnd() + rnd() - 2) / 0.5774) * sd;

const AS_OF = '2026-11-20T09:00:00Z';
const TODAY = AS_OF.slice(0, 10);
const ahead = (d) => engine.addDays(TODAY, d);
const ago = (d) => engine.addDays(TODAY, -d);
const SITES = ['Warehouse 1', 'Warehouse 2', 'Repair centre'];
const TENANTS = ['Customer A', 'Customer B', 'Customer C'];
const MARKET_CUSTOMERS = ['Customer D', 'Customer E', 'Customer F', 'Customer G', 'Customer H'];

const cases = JSON.parse(fs.readFileSync(path.join(root, 'src/data/cases.json'), 'utf8'));
const OPEN = (c) => c.stage !== 'approved' && c.stage !== 'handed_off';

/* ------------------------------------------------------------------ policy */
const SOURCES = {
  sale_order: { system: 'ERP sales orders (SAP SD)', method: 'Confirmed sales order price', freshness: 'Live, synced every 15 minutes' },
  buyer_bid: { system: 'Remarketing channel', method: 'Highest open bid that accepts this grade', freshness: 'Bids refreshed hourly' },
  market_estimate: { system: 'Resale price model v1.3', method: 'Median of comparable sales in the last 90 days, adjusted for grade', freshness: 'Market feed last refreshed 3 days ago' },
  commission: { system: 'Remarketing contract', method: 'Agreed commission rate on the sale price', freshness: 'Contract rate, reviewed yearly', approvedBy: 'Remarketing lead' },
  test_certify: { system: 'Repair centre standard costs', method: 'Share of the refurbishment estimate for test, clean and certify', freshness: 'Standard costs, updated quarterly', approvedBy: 'Repair center lead' },
  lease_income: { system: 'Lease contract system', method: 'Monthly fee × term, discounted at the 9 % cost of capital', freshness: 'Live order book', approvedBy: 'Finance' },
  residual_value: { system: 'Residual value model', method: 'Predicted resale scaled by remaining life at end of term, discounted', freshness: 'Model v1.3, back-tested monthly', approvedBy: 'Finance' },
  servicing: { system: 'Lease cost model', method: 'Servicing allowance as a share of replacement value per year', freshness: 'Policy rate', approvedBy: 'Finance' },
  refurbishment: { system: 'Repair centre standard costs', method: 'Full refurbishment estimate for this model and grade', freshness: 'Standard costs, updated quarterly', approvedBy: 'Repair center lead' },
  avoided_purchase: { system: 'ERP purchase requisitions', method: 'What the requesting site would pay for an equivalent unit', freshness: 'Live requisition', approvedBy: 'Asset planner' },
  recommission: { system: 'Repair centre standard costs', method: 'Share of the refurbishment estimate to test and recommission', freshness: 'Standard costs, updated quarterly' },
  freight: { system: 'Logistics rate card', method: 'Site-to-site freight for this product class', freshness: 'Rate card, updated monthly' },
  part_value: { system: 'ERP spare-parts price list', method: 'New part price × 70 % certified used-part factor', freshness: 'Price list, updated weekly', approvedBy: 'Service parts planner' },
  parts_estimate: { system: 'Parts marketplace index', method: 'Certified part price × marketplace price share', freshness: 'Index refreshed weekly' },
  wait_cost_avoided: { system: 'Service level agreements', method: 'Agreed cost of a customer waiting on a backordered part', freshness: 'Policy rate', approvedBy: 'Finance' },
  teardown: { system: 'Repair centre standard costs', method: 'Teardown and part certification as a share of replacement value', freshness: 'Standard costs, updated quarterly' },
  parts_handling: { system: 'Parts sales channel', method: 'Listing, packing and shipping as a share of parts value', freshness: 'Contract rate' },
  carcass_material: { system: 'Recycler portal', method: 'Share of the material value left after teardown', freshness: 'Rate cards, updated weekly' },
  recycler_quote: { system: 'Recycler portal', method: 'Certified recycler rate card per kg', freshness: 'Quote on file, see validity', approvedBy: 'Sustainability lead' },
  material_estimate: { system: 'Metals price index', method: 'Index rate per kg less a no-quote discount', freshness: 'Index refreshed daily' },
  decommission: { system: 'EHS register', method: 'Decommission and hazardous-material handling fee per unit', freshness: 'Policy rate' },
  disposal_fee: { system: 'Certified disposal provider', method: 'Disposal fee per unit, certificate on file', freshness: 'Contract rate', approvedBy: 'Sustainability lead' },
  holding: { system: 'Finance policy', method: 'Holding cost per bay per day × floor-space factor × days', freshness: 'Policy rate (GR-04)', approvedBy: 'Finance' },
};

const policy = {
  version: '2026.11',
  holdingCostPerDay: 12,
  costOfCapital: 0.09,
  lifeUsedPerMonth: 1.25,
  refurbRestoresLife: 25,
  servicingPctPerYear: 0.04,
  fitForUseThreshold: 50,
  certifiedPartFactor: 0.7,
  customerWaitCost: 650,
  refurbSlots: 8,
  transferDays: 2,
  relaseMinLife: 40,
  preferTolerance: 0.15,
  estimateHaircut: 0.92,
  channelCommission: 0.08,
  directCommission: 0.03,
  testCertifyShare: 0.35,
  recommissionShare: 0.4,
  teardownPct: 0.06,
  externalPartsFactor: 0.85,
  marketplacePartsFactor: 0.6,
  partsHandlingPct: 0.05,
  carcassMaterialShare: 0.6,
  materialIndexPerKg: { motor: 1.05, pump: 0.9, control: 1.6, drill: 0.8, batch: 0.7, it: 2.2 },
  materialEstimateFactor: 0.85,
  classes: {
    motor: { weightKg: 420, holdingSpace: 1, freight: 260, disposalFee: 180, decommissionFee: 120 },
    pump: { weightKg: 160, holdingSpace: 0.7, freight: 180, disposalFee: 120, decommissionFee: 80 },
    control: { weightKg: 18, holdingSpace: 0.25, freight: 90, disposalFee: 45, decommissionFee: 35 },
    drill: { weightKg: 2.1, holdingSpace: 0.05, freight: 25, disposalFee: 6, decommissionFee: 3 },
    batch: { weightKg: 2.4, holdingSpace: 0.5, freight: 140, disposalFee: 4, decommissionFee: 2 },
    it: { weightKg: 2.2, holdingSpace: 0.08, freight: 40, disposalFee: 18, decommissionFee: 12 },
  },
  routes: {
    redeploy: { name: 'Internal Redeploy', leadDays: 3, owner: 'Asset planner', executesIn: 'ERP stock transfer' },
    resale: { name: 'Whole-Asset Resale', leadDays: 9, owner: 'Remarketing lead', executesIn: 'Remarketing channel / ERP sales orders' },
    intparts: { name: 'Internal Parts Harvest', leadDays: 5, owner: 'Service parts planner', executesIn: 'Teardown work order + ERP spare parts' },
    relase: { name: 'Secondary Re-lease', leadDays: 7, owner: 'Repair center lead', executesIn: 'Repair work order, then lease contract system' },
    material: { name: 'Material Recovery', leadDays: 6, owner: 'Sustainability lead', executesIn: 'Recycler portal + circularity ledger' },
    extparts: { name: 'External Parts Sale', leadDays: 6, owner: 'Parts sales lead', executesIn: 'Teardown + parts sales channel' },
    exit: { name: 'Responsible Exit', leadDays: 6, owner: 'Sustainability lead', executesIn: 'Certified disposal provider' },
  },
  sources: SOURCES,
};

const guardrails = [
  { id: 'GR-01', title: 'Grade C/D never re-leased without refurbishment', description: 'Secondary Re-lease always includes a full refurbishment; grade D and scrap are never re-leased.', owner: 'Repair center lead', locked: true },
  { id: 'GR-02', title: 'Refurbishment always ends in a named lease or sales order', description: 'A refurbishment slot is only used against a named lease order or renewal.', owner: 'Finance', locked: true },
  { id: 'GR-03', title: 'Parts certified only at or above the fit-for-use threshold', description: 'Harvested parts count only when their remaining life is at least the fit-for-use threshold (50 %).', owner: 'Service parts planner', locked: true },
  { id: 'GR-04', title: 'Holding cost rate set by Finance', description: 'The holding cost per day is a Finance policy rate and cannot be changed by a business rule.', owner: 'Finance', locked: true },
  { id: 'GR-05', title: 'Every decision approved by a named owner', description: 'No route is executed until a named owner approves it.', owner: 'Head of asset recovery', locked: true },
  { id: 'GR-06', title: 'Exit and material only through a certified provider', description: 'Material Recovery and Responsible Exit use certified providers with a certificate on file.', owner: 'Sustainability lead', locked: true },
];

const rules = {
  version: 1,
  publishedAt: '2026-11-13T10:00:00Z',
  publishedBy: 'Marcus Vance',
  rules: [
    {
      id: 'BR-01',
      action: 'exclude',
      route: 'material',
      scope: { productClass: ['control'], lifeMin: 40 },
      owner: 'Sustainability lead',
      description: 'Control units with remaining life of at least 40 %: never Material Recovery',
      active: true,
    },
    {
      id: 'BR-02',
      action: 'prefer',
      route: 'redeploy',
      scope: { channel: ['field_return'], condition: ['A', 'B'] },
      owner: 'Asset planner',
      description: 'Field service returns, grade A or B: prefer Internal Redeploy',
      active: true,
    },
  ],
};

/* ------------------------------------------------------------------ case context */
const PARTS = {
  motor: [['Stator winding', 3780], ['Rotor and shaft', 2600], ['Bearings (DE / NDE)', 940], ['Terminal box', 710]],
  pump: [['Piston assembly', 1920], ['Swash plate', 1150], ['Valve block', 1280], ['Shaft seal kit', 320]],
  control: [['CPU module', 1630], ['I/O cards', 1030], ['Power supply', 520], ['Comms module', 600]],
  drill: [['Brushless motor', 115], ['Gearbox', 68], ['Battery pack', 88]],
  it: [['Mainboard', 295], ['SSD', 115], ['Display', 165], ['Battery', 66]],
  batch: [['Tool bodies', 63], ['Battery packs', 42], ['Chargers', 21]],
};
const GRADE_LIFE = { A: 96, B: 80, C: 62, D: 34, Scrap: 10 };
const CHANNELS = [['lease_end', 35], ['field_return', 30], ['trade_in', 15], ['excess', 20]];
const pickChannel = () => {
  let r = rnd() * 100;
  for (const [ch, w] of CHANNELS) {
    r -= w;
    if (r <= 0) return ch;
  }
  return 'excess';
};

function makeContext(c, override = {}) {
  const lifePct = override.lifePct ?? clamp(Math.round(GRADE_LIFE[c.condition] - c.facts.ageYears * 3 + (rnd() - 0.5) * 10), 3, 100);
  const parts = PARTS[c.productClass].map(([name, price]) => ({
    name,
    newPrice: r10(price * c.quantity),
    lifePct: clamp(Math.round(lifePct + (rnd() - 0.5) * 40), 2, 100),
  }));
  return { intakeChannel: override.intakeChannel ?? pickChannel(), lifePct, parts };
}

const channels = {};
for (const c of cases) channels[c.id] = makeContext(c, c.id === 'RT-1048' ? { intakeChannel: 'lease_end', lifePct: 68 } : {});

/* ------------------------------------------------------------------ demand */
const LEASE_CLASSES = new Set(['motor', 'pump', 'control', 'it', 'batch']);
const counters = { LO: 2200, SO: 5100, BID: 7300, RR: 3400, RO: 8800, RQ: 610 };
const nextId = (pre) => `${pre}-${++counters[pre]}`;

function leaseFor(c, opts = {}) {
  return {
    id: opts.id ?? nextId('LO'),
    kind: opts.kind ?? (rnd() < 0.35 ? 'lease_renewal' : 'lease_order'),
    customer: opts.customer ?? pick([...TENANTS, ...MARKET_CUSTOMERS]),
    site: opts.site ?? (rnd() < 0.6 ? c.location : pick(SITES)),
    productClass: c.productClass,
    model: c.model,
    neededBy: ahead(opts.neededIn ?? int(6, 34)),
    createdAt: ago(int(1, 20)),
    system: 'Lease contract system',
    monthlyFee: opts.monthlyFee ?? r5(engine.assetValue(c) * between(0.015, 0.03)),
    termMonths: opts.termMonths ?? pick([12, 24, 24, 36]),
    minGrade: opts.minGrade ?? (rnd() < 0.5 ? 'C' : 'B'),
  };
}
function salesFor(c) {
  const bid = rnd() < 0.55;
  const base = {
    customer: pick(MARKET_CUSTOMERS),
    site: rnd() < 0.5 ? c.location : pick(SITES),
    productClass: c.productClass,
    model: c.model,
    createdAt: ago(int(1, 15)),
  };
  if (bid) {
    const validIn = int(7, 26);
    return { id: nextId('BID'), kind: 'buyer_bid', ...base, neededBy: ahead(validIn), system: 'Remarketing channel', price: r10(c.predictedResale * between(0.88, 1.08)), minGrade: pick(['A', 'B', 'B', 'C']), validTo: ahead(validIn) };
  }
  return { id: nextId('SO'), kind: 'sales_order', ...base, neededBy: ahead(int(8, 30)), system: 'ERP sales orders (SAP SD)', price: r10(c.predictedResale * between(0.97, 1.15)) };
}
function redeployFor(c, opts = {}) {
  const site = opts.site ?? pick(SITES.filter((s) => s !== c.location).concat([c.location]));
  return {
    id: nextId('RR'),
    kind: 'redeploy_request',
    customer: `${site} operations`,
    site,
    productClass: c.productClass,
    model: c.model,
    neededBy: ahead(opts.neededIn ?? int(4, 28)),
    createdAt: ago(int(1, 12)),
    system: 'ERP purchase requisitions',
    avoidedCost: r10(engine.assetValue(c) * between(0.48, 0.66)),
    minGrade: 'B',
  };
}
function repairFor(c, part, network) {
  return {
    id: nextId('RO'),
    kind: 'repair_order',
    customer: network === 'internal' ? pick(TENANTS) : pick(MARKET_CUSTOMERS),
    site: network === 'internal' ? pick(SITES) : pick(SITES),
    productClass: c.productClass,
    model: rnd() < 0.85 ? c.model : null,
    neededBy: ahead(int(5, 30)),
    createdAt: ago(int(1, 20)),
    system: network === 'internal' ? 'Field service (EAM work orders)' : 'Parts sales channel',
    part: part.name,
    backordered: rnd() < 0.4,
    network,
  };
}

const demand = [];
const open = cases.filter(OPEN);

// Hero case RT-1048 (Voltara V4 75kW, grade B, lease end): a lease renewal it shares with another V4.
demand.push(
  leaseFor(cases.find((c) => c.id === 'RT-1048'), { id: 'LO-2231', kind: 'lease_renewal', customer: 'Customer D', site: 'Warehouse 1', neededIn: 14, monthlyFee: 295, termMonths: 24, minGrade: 'C' }),
);

/** True when the model already has open demand of this group; most such cases get no extra record. */
const crowded = (kinds, model) => demand.some((d) => kinds.includes(d.kind) && d.model === model) && rnd() < 0.6;
for (const c of open) {
  const cc = channels[c.id];
  const good = c.condition !== 'D' && c.condition !== 'Scrap';
  if (good && LEASE_CLASSES.has(c.productClass) && cc.lifePct >= 40 && rnd() < 0.24 && !crowded(['lease_order', 'lease_renewal'], c.model)) {
    // Some lease starts are tight: only an asset already at the lease site is ready in time.
    demand.push(leaseFor(c, rnd() < 0.4 ? { site: c.location, neededIn: int(7, 8) } : {}));
  }
  if ((c.condition === 'A' || c.condition === 'B') && rnd() < 0.15 && !crowded(['redeploy_request'], c.model)) demand.push(redeployFor(c));
  if (good && rnd() < 0.22 && !crowded(['sales_order', 'buyer_bid'], c.model)) demand.push(salesFor(c));
  const fit = c.productClass === 'drill' ? [] : cc.parts.filter((p) => p.lifePct >= 50);
  if (fit.length && rnd() < 0.3) demand.push(repairFor(c, pick(fit), 'internal'));
  if (fit.length && rnd() < 0.12) demand.push(repairFor(c, pick(fit), 'external'));
}

// Recycler rate cards: one or two certified quotes per class, plus one uncertified quote (GR-06 skips it).
const RECYCLERS = ['Recycler North (certified)', 'Recycler South (certified)'];
for (const cls of Object.keys(PARTS)) {
  const n = cls === 'drill' || cls === 'batch' ? 1 : 2;
  for (let i = 0; i < n; i++) {
    demand.push({
      id: nextId('RQ'),
      kind: 'recycler_quote',
      customer: RECYCLERS[i],
      site: SITES[i],
      productClass: cls,
      model: null,
      neededBy: ahead(30),
      createdAt: ago(int(2, 20)),
      system: 'Recycler portal',
      ratePerKg: +(policy.materialIndexPerKg[cls] * between(0.98, 1.12)).toFixed(2),
      certified: true,
      certificateRef: `CERT-${cls.toUpperCase()}-${int(1000, 9999)}`,
      validTo: ahead(int(20, 45)),
    });
  }
}
demand.push({ id: nextId('RQ'), kind: 'recycler_quote', customer: 'Scrap broker (uncertified)', site: 'Warehouse 2', productClass: 'motor', model: null, neededBy: ahead(30), createdAt: ago(3), system: 'Recycler portal', ratePerKg: 1.4, certified: false, certificateRef: 'none', validTo: ahead(30) });

/* ------------------------------------------------------------------ inbox (new returns, not yet decided) */
const CLASS_DEF = {
  motor: { label: 'Industrial motor', pre: 'MTR', pnew: 11800, mfr: ['Voltara', 'Kestrel Drives', 'Halden Electric'], models: ['V4 75kW', 'KD-55', 'HX-90'] },
  pump: { label: 'Hydraulic pump', pre: 'PMP', pnew: 6400, mfr: ['Halden Hydraulics', 'Norvik Fluid', 'Aquaterra'], models: ['PMP-200', 'NF-40', 'AQ-12'] },
  control: { label: 'Control unit', pre: 'CTL', pnew: 4300, mfr: ['Orbis Control', 'Kestrel Automation', 'Tessen Logic'], models: ['OC-7 PLC', 'KA-300', 'TL-9'] },
  drill: { label: 'Power tool', pre: 'DRL', pnew: 340, mfr: ['Tessen Tools', 'Norvik Power', 'Brava'], models: ['TT-18V', 'NP-Drive', 'BR-X2'] },
  batch: { label: 'Tool-fleet batch', pre: 'BAT', pnew: 150, mfr: ['Brava', 'Tessen Tools'], models: ['Fleet lot 24', 'Fleet lot 40'] },
  it: { label: 'IT electronics', pre: 'ITE', pnew: 820, mfr: ['Lumeo Devices', 'Corvid Computing', 'Nimbus'], models: ['C14 laptop', 'LD Pro 13', 'NB-Edge'] },
};
const PLANNERS = { 'Customer A': ['Priya Raman', 'u-planner-a'], 'Customer B': ['Tomás Herrera', 'u-planner-b'], 'Customer C': ['Aiko Tanaka', 'u-planner-c'] };
const COND_F = { A: 0.62, B: 0.5, C: 0.36, D: 0.2, Scrap: 0.04 };

/** Builds a full CaseRecord-shaped synthetic case. */
function synthCase(id, i, opts) {
  const cls = opts.cls;
  const d = CLASS_DEF[cls];
  const condition = opts.condition;
  const condF = COND_F[condition];
  const qty = cls === 'batch' ? int(20, 40) : 1;
  const base = d.pnew * qty;
  const resale = r10(base * condF * (0.8 + rnd() * 0.4));
  const refurb = r10(base * (0.04 + (1 - condF) * 0.18));
  const ageYears = +(1 + rnd() * 6).toFixed(1);
  const mfr = opts.manufacturer ?? pick(d.mfr);
  const model = opts.model ?? pick(d.models);
  const tenant = opts.tenant ?? TENANTS[i % 3];
  const site = opts.site ?? pick(SITES);
  const dueIn = opts.dueIn ?? int(4, 14);
  return {
    id,
    assetTag: `${d.pre}-${String(5000 + i * 7).padStart(5, '0')}`,
    serialNumber: `${mfr.slice(0, 2).toUpperCase()}${int(100000, 999999)}`,
    productClass: cls,
    productName: `${mfr} ${model}`,
    category: d.label,
    manufacturer: mfr,
    model,
    quantity: qty,
    location: site,
    tenant,
    owner: PLANNERS[tenant][0],
    ownerId: PLANNERS[tenant][1],
    receivedDate: opts.receivedDate ?? TODAY,
    dueDate: ahead(dueIn),
    dueInDays: dueIn,
    condition,
    residualLifeMonths: Math.max(0, Math.round((1 - ageYears / 10) * 60 * condF * 2)),
    stage: opts.stage ?? 'awaiting_approval',
    recommendedRoute: 'resale',
    estimatedNetRecovery: Math.max(40, resale - refurb),
    predictedResale: resale,
    refurbishmentCost: refurb,
    valueAtRisk: 0,
    riskReason: null,
    carbonAvoidedKg: r5((base / 40) * condF),
    priority: dueIn < 6 ? 'medium' : 'low',
    evidenceCompleteness: int(88, 100),
    blockedReason: null,
    facts: { originalPrice: base, ageYears, lastServiceDate: ago(int(60, 500)), warrantyStatus: ageYears < 3 ? 'active' : 'expired', wmsBinLocation: `${site === 'Repair centre' ? 'RC' : site === 'Warehouse 1' ? 'W1' : 'W2'}-${pick(['A', 'B', 'C', 'D'])}${int(1, 24)}-${int(1, 6)}` },
    predictions: { secondaryMarketPrice: resale, refurbishmentCost: refurb, resaleDemandScore: +(0.35 + rnd() * 0.6).toFixed(2), failureRiskScore: +(0.05 + (1 - condF) * 0.5).toFixed(2) },
  };
}

const INBOX_PLAN = [
  { cls: 'motor', condition: 'B', model: 'HX-90', manufacturer: 'Halden Electric', channel: 'lease_end', demand: 'lease' },
  { cls: 'control', condition: 'C', model: 'OC-7 PLC', manufacturer: 'Orbis Control', channel: 'field_return', demand: 'parts' },
  { cls: 'pump', condition: 'A', model: 'PMP-200', manufacturer: 'Halden Hydraulics', channel: 'excess', demand: 'redeploy' },
  { cls: 'it', condition: 'B', model: 'LD Pro 13', manufacturer: 'Lumeo Devices', channel: 'trade_in', demand: 'sales' },
  { cls: 'motor', condition: 'D', model: 'KD-55', manufacturer: 'Kestrel Drives', channel: 'field_return', demand: 'parts' },
  { cls: 'batch', condition: 'B', model: 'Fleet lot 40', manufacturer: 'Brava', channel: 'lease_end', demand: 'lease' },
  { cls: 'pump', condition: 'C', model: 'NF-40', manufacturer: 'Norvik Fluid', channel: 'trade_in', demand: 'sales' },
  { cls: 'control', condition: 'A', model: 'KA-300', manufacturer: 'Kestrel Automation', channel: 'field_return', demand: 'redeploy' },
  { cls: 'drill', condition: 'C', model: 'NP-Drive', manufacturer: 'Norvik Power', channel: 'excess', demand: 'none' },
];
const inbox = INBOX_PLAN.map((plan, i) => {
  const c = synthCase(`RT-${1129 + i}`, 129 + i, plan);
  const context = makeContext(c, { intakeChannel: plan.channel, lifePct: plan.condition === 'D' ? 30 : undefined });
  if (plan.demand === 'parts') context.parts = context.parts.map((p, k) => (k < 2 ? { ...p, lifePct: Math.max(p.lifePct, 62 + k * 9) } : p));
  channels[c.id] = context;
  if (plan.demand === 'lease') demand.push(leaseFor(c, { neededIn: int(14, 24), minGrade: 'C', site: c.location }));
  if (plan.demand === 'redeploy') demand.push(redeployFor(c, { neededIn: int(8, 20) }));
  if (plan.demand === 'sales') demand.push({ ...salesFor(c), neededBy: ahead(20) });
  if (plan.demand === 'parts') {
    const ro = repairFor(c, context.parts[0], 'internal');
    demand.push({ ...ro, backordered: true, neededBy: ahead(18) });
  }
  return { case: c, context };
});
// Bids generated above must still be valid when the sale is ready.
for (const d of demand) if (d.kind === 'buyer_bid' && d.validTo < d.neededBy) d.validTo = d.neededBy;

/* ------------------------------------------------------------------ engine context */
const ctxFor = (dem, chan) => ({
  asOf: AS_OF,
  policy,
  demands: dem,
  contextFor: (c) => chan[c.id],
  rules: rules.rules,
});

const ctx = ctxFor(demand, channels);
const plan = engine.planQueue(open, ctx, {});
const decisions = Object.values(plan.decisions);
const named = decisions.filter((d) => d.all.some((r) => r.viable && r.committed && r.demands.some((x) => x.kind !== 'recycler_quote')));

/* ------------------------------------------------------------------ history */
const HIST_CLASSES = [['motor', 20], ['pump', 18], ['control', 17], ['drill', 19], ['batch', 11], ['it', 15]];
const pickClass = () => {
  let r = rnd() * 100;
  for (const [k, w] of HIST_CLASSES) {
    r -= w;
    if (r <= 0) return k;
  }
  return 'motor';
};
const REASONS = ['Customer commitment', 'Known condition issue not in data', 'Regulatory or contract hold', 'Market knowledge'];
const OWNERS = ['Priya Raman', 'Tomás Herrera', 'Aiko Tanaka', 'Marcus Vance'];
const history = [];
for (let i = 0; i < 160; i++) {
  const id = `RT-${String(841 + i).padStart(4, '0')}`;
  const closedDaysAgo = int(0, 59);
  const c = synthCase(id, i, { cls: pickClass(), condition: pick(['A', 'B', 'B', 'C', 'C', 'D', 'Scrap']), stage: 'handed_off', receivedDate: ago(closedDaysAgo + int(5, 20)) });
  const cc = makeContext(c);
  // Each closed case is valued against its own demand at the time (no contention in history).
  const hist = [];
  const good = c.condition !== 'D' && c.condition !== 'Scrap';
  if (good && LEASE_CLASSES.has(c.productClass) && cc.lifePct >= 40 && rnd() < 0.3) hist.push(leaseFor(c, { site: c.location, neededIn: int(12, 30) }));
  if ((c.condition === 'A' || c.condition === 'B') && rnd() < 0.25) hist.push(redeployFor(c, { neededIn: int(8, 25) }));
  if (good && rnd() < 0.35) hist.push({ ...salesFor(c), neededBy: ahead(25) });
  const fit = cc.parts.filter((p) => p.lifePct >= 50);
  if (fit.length && rnd() < 0.3) hist.push({ ...repairFor(c, pick(fit), 'internal'), neededBy: ahead(20) });
  for (const d of hist) if (d.kind === 'buyer_bid') d.validTo = d.neededBy;
  const hctx = ctxFor([...hist, ...demand.filter((d) => d.kind === 'recycler_quote')], { [id]: cc });
  const dec = engine.decideCase(c, hctx);
  const overridden = !!dec.runnerUp && rnd() < 0.13;
  const chosen = overridden ? dec.runnerUp : dec.best;
  const forecastNet = chosen.net;
  const noise = clamp(gauss(overridden ? 0.12 : 0.08), -0.3, 0.3);
  const realisedNet = Math.round(forecastNet * (1 + noise));
  const standardNet = dec.standard.net;
  history.push({
    id: `DH-${String(4001 + i)}`,
    caseId: id,
    snapshot: { productClass: c.productClass, productName: c.productName, model: c.model, condition: c.condition, lifePct: cc.lifePct, tenant: c.tenant, site: c.location, quantity: c.quantity },
    channel: cc.intakeChannel,
    route: chosen.route,
    recommendedRoute: dec.best.route,
    standardRoute: dec.standardRoute,
    forecastNet,
    realisedNet,
    standardNet,
    gain: forecastNet - standardNet,
    realisedGain: realisedNet - standardNet,
    namedDemand: chosen.committed && chosen.demands.some((x) => x.kind !== 'recycler_quote'),
    overridden,
    overrideReason: overridden ? pick(REASONS) : null,
    decidedBy: overridden ? 'owner' : 'circularity',
    actor: overridden ? pick(OWNERS) : 'Circularity',
    hoursToComplete: overridden ? int(20, 110) : int(4, 60),
    closedDaysAgo,
    closedAt: ago(closedDaysAgo),
  });
}
history.sort((a, b) => a.closedDaysAgo - b.closedDaysAgo || a.id.localeCompare(b.id));

/* ------------------------------------------------------------------ write */
const write = (f, d) => fs.writeFileSync(path.join(outDir, f), JSON.stringify(d, null, 2) + '\n');
write('channels.json', channels);
write('demand.json', demand);
write('policy.json', policy);
write('guardrails.json', guardrails);
write('rules.json', rules);
write('history.json', history);
write('inbox.json', inbox);

/* ------------------------------------------------------------------ report */
const sumAbs = (xs) => xs.reduce((s, x) => s + Math.abs(x), 0);
const acc = 1 - sumAbs(history.map((h) => h.realisedNet - h.forecastNet)) / sumAbs(history.map((h) => h.forecastNet));
const byKind = demand.reduce((m, d) => ((m[d.kind] = (m[d.kind] ?? 0) + 1), m), {});
console.log({
  openCases: open.length,
  demand: demand.length,
  byKind,
  namedDemandShare: +(named.length / open.length).toFixed(3),
  contested: plan.contested.length,
  planValue: plan.planValue,
  fcfsValue: plan.fcfsValue,
  planGain: plan.gain,
  standardValue: plan.standardValue,
  slots: `${plan.refurbSlotsUsed}/${plan.refurbSlots}`,
  history: history.length,
  forecastAccuracy: +acc.toFixed(4),
  inbox: inbox.length,
});
