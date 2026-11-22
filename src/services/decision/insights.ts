/**
 * Decision insights: eligibility gates, P10–P90 value ranges, confidence, "why not the
 * runner-up", evidence snapshot ids, enterprise instruction sets per route and the Case
 * page edge-case presets.
 *
 * Pure and deterministic functions of (case, decision, engine context), like engine.ts and
 * explain.ts, so the app and scripts/check-decisions.mjs compute the same numbers. No
 * Math.random, no clock reads (callers pass times in).
 */
import type { CaseRecord } from "@/models/domain.model";
import type {
  CaseDecision,
  Confidence,
  DecisionInsights,
  DecisionParams,
  Demand,
  GateResult,
  GateStatus,
  Instruction,
  InstructionPreview,
  LineKind,
  PresetId,
  RouteId,
  RouteInsight,
  RouteStatus,
  RouteValue,
  ScenarioPreset,
  ValueRange,
  WhyNot,
} from "@/models/decision.model";
import {
  fmtDay,
  hashOf,
  ROUTE_IDS,
  usd,
  type EngineContext,
  type RouteParams,
} from "./engine";

/* ================================================================ gates */

export const GATE_NAMES: Record<GateResult["id"], string> = {
  condition: "Condition & life",
  intervention: "Post-intervention",
  policy: "Policy & certification",
  demand: "Demand fit",
  economics: "Economics",
  sustainability: "Sustainability",
};

const GATE_ORDER: GateResult["id"][] = [
  "condition",
  "intervention",
  "policy",
  "demand",
  "economics",
  "sustainability",
];

/** Which gate a non-viable reason from the engine belongs to. */
function failedGate(reason: string): GateResult["id"] {
  if (
    /Certified life|Critical part|refurbishment slots|fit-for-use/i.test(reason)
  )
    return "intervention";
  if (/requires a new unit|cancelled/i.test(reason)) return "demand";
  if (/grade|Remaining life/i.test(reason)) return "condition";
  if (/Business rule|removed from the decision flow|GR-0/i.test(reason))
    return "policy";
  return "demand";
}

const gate = (
  id: GateResult["id"],
  status: GateStatus,
  reason: string,
): GateResult => ({ id, name: GATE_NAMES[id], status, reason });

const spare = (n: number) =>
  `${Math.abs(n)} ${Math.abs(n) === 1 ? "day" : "days"} spare`;

/** Higher-circularity routes keep the asset (or its parts) in use. */
const KEEPS_IN_USE: RouteId[] = ["redeploy", "relase", "resale"];

/**
 * The six gates for one route of a case. A non-viable route fails the gate its engine reason
 * belongs to; gates after it are 'na' (not checked). Uses the same thresholds as the engine.
 */
export function gatesFor(
  c: CaseRecord,
  rv: RouteValue,
  dec: CaseDecision,
  ctx: EngineContext,
): GateResult[] {
  const cc = ctx.contextFor(c);
  const pol = ctx.policy;
  if (!rv.viable) {
    const reason = rv.reason ?? "Not viable";
    const at = failedGate(reason);
    const idx = GATE_ORDER.indexOf(at);
    return GATE_ORDER.map((id, i) =>
      id === at
        ? gate(id, "failed", reason)
        : i < idx
          ? gate(id, "ok", "Passed before the route was withheld")
          : gate(id, "na", `Not checked: withheld at ${GATE_NAMES[at]}`),
    );
  }
  const d = rv.demand;
  const out: GateResult[] = [];

  /* Condition & life */
  if (rv.route === "material" || rv.route === "exit")
    out.push(
      gate(
        "condition",
        "ok",
        `Any grade accepted; asset is grade ${c.condition}`,
      ),
    );
  else if (c.evidenceCompleteness < 60)
    out.push(
      gate(
        "condition",
        "warning",
        `Evidence only ${c.evidenceCompleteness} % complete; grade ${c.condition} not yet confirmed by inspection`,
      ),
    );
  else if (rv.route === "relase" && cc.lifePct < pol.relaseMinLife + 10)
    out.push(
      gate(
        "condition",
        "warning",
        `Life ${cc.lifePct} % is close to the ${pol.relaseMinLife} % re-lease minimum`,
      ),
    );
  else
    out.push(
      gate(
        "condition",
        "ok",
        `Grade ${c.condition}, ${cc.lifePct} % remaining life meets the ${rv.routeName} threshold`,
      ),
    );

  /* Post-intervention */
  switch (rv.route) {
    case "relase": {
      const term = d && "termMonths" in d ? d.termMonths : 0;
      const after = Math.min(100, cc.lifePct + pol.refurbRestoresLife);
      const end = Math.round(after - pol.lifeUsedPerMonth * term);
      out.push(
        end < 10
          ? gate(
              "intervention",
              "warning",
              `Certified life barely covers the ${term}-month term (${Math.max(0, end)} % left at end)`,
            )
          : gate(
              "intervention",
              "ok",
              `Refurbishment restores ${after} % life; ${end} % left after the ${term}-month term`,
            ),
      );
      break;
    }
    case "redeploy":
      out.push(
        gate(
          "intervention",
          "ok",
          "Test and recommission returns the asset to service standard",
        ),
      );
      break;
    case "resale":
      out.push(
        gate(
          "intervention",
          "ok",
          `Test, clean and certify before sale (grade ${c.condition})`,
        ),
      );
      break;
    case "intparts":
    case "extparts": {
      const fit = cc.parts.filter(
        (p) => p.lifePct >= pol.fitForUseThreshold,
      ).length;
      out.push(
        gate(
          "intervention",
          "ok",
          `${fit} of ${cc.parts.length} parts at or above the ${pol.fitForUseThreshold} % fit-for-use threshold (GR-03)`,
        ),
      );
      break;
    }
    default:
      out.push(
        gate("intervention", "ok", "No intervention needed before collection"),
      );
  }

  /* Policy & certification */
  const rules = dec.rulesApplied.length
    ? ` (rules checked: ${dec.rulesApplied.join(", ")})`
    : "";
  if (rv.route === "material") {
    out.push(
      d && d.kind === "recycler_quote"
        ? gate(
            "policy",
            "ok",
            `Certified recycler ${d.customer}, certificate ${d.certificateRef} (GR-06)`,
          )
        : gate(
            "policy",
            "warning",
            "No certified recycler quote on file; a certificate is needed before collection (GR-06)",
          ),
    );
  } else if (rv.route === "exit")
    out.push(
      gate(
        "policy",
        "ok",
        "Certified disposal provider with certificate on file (GR-06)",
      ),
    );
  else if (rv.route === "relase")
    out.push(
      gate(
        "policy",
        "ok",
        `Refurbishment ends in a named lease ${d?.id ?? ""} (GR-02)${rules}`.replace(
          /\s+\(/,
          " (",
        ),
      ),
    );
  else
    out.push(
      gate(
        "policy",
        "ok",
        `No business rule or guardrail withholds this route${rules}`,
      ),
    );

  /* Demand fit */
  const t = rv.timing;
  if (rv.route === "exit")
    out.push(gate("demand", "ok", "No demand needed for a responsible exit"));
  else if (rv.route === "material" && !d)
    out.push(
      gate(
        "demand",
        "warning",
        "No recycler quote; priced at the index rate. Verify before committing",
      ),
    );
  else if (rv.estimate || !d)
    out.push(
      gate(
        "demand",
        "warning",
        "Demand is a forecast; verify before committing",
      ),
    );
  else if (t.bufferDays !== null && t.bufferDays <= 1)
    out.push(
      gate(
        "demand",
        "warning",
        `${d.id} needed by ${fmtDay(t.neededBy ?? t.ready)}; ready ${fmtDay(t.ready)}, only ${spare(t.bufferDays)}`,
      ),
    );
  else
    out.push(
      gate(
        "demand",
        "ok",
        `Confirmed ${demandWord(d)} ${d.id} from ${d.customer}${t.bufferDays !== null ? `, ${spare(t.bufferDays)}` : ""}`,
      ),
    );

  /* Economics */
  out.push(
    rv.net > 0
      ? gate(
          "economics",
          "ok",
          `Net ${usd(rv.net)}: value ${usd(rv.gross)} − cost ${usd(rv.cost)} − holding ${usd(rv.holding)}`,
        )
      : gate(
          "economics",
          "warning",
          `Net cost ${usd(-rv.net)}; use only when no route recovers value`,
        ),
  );

  /* Sustainability */
  const higher = dec.all.some(
    (r) => r.viable && KEEPS_IN_USE.includes(r.route),
  );
  if (KEEPS_IN_USE.includes(rv.route))
    out.push(gate("sustainability", "ok", "Keeps the whole asset in use"));
  else if (rv.route === "intparts" || rv.route === "extparts")
    out.push(
      gate(
        "sustainability",
        "ok",
        "Returns certified parts to service; carcass recycled",
      ),
    );
  else if (rv.route === "material")
    out.push(
      gate(
        "sustainability",
        higher ? "warning" : "ok",
        higher
          ? "A route that keeps the asset in use is eligible"
          : "Certified material recovery",
      ),
    );
  else
    out.push(
      gate(
        "sustainability",
        "warning",
        "Lowest circularity: disposal with certificate",
      ),
    );
  return out;
}

function demandWord(d: Demand): string {
  return {
    lease_order: "lease order",
    lease_renewal: "lease renewal",
    sales_order: "sales order",
    buyer_bid: "buyer bid",
    redeploy_request: "redeploy request",
    repair_order: "repair order",
    recycler_quote: "recycler quote",
  }[d.kind];
}

/** Gates that make a passing route Conditional when they warn (economics and sustainability only inform). */
const CONDITIONAL_GATES: GateResult["id"][] = [
  "demand",
  "condition",
  "intervention",
  "policy",
];

/** Eligible / Conditional / Restricted with the reason. Restricted ⇔ not viable in the engine. */
export function statusOf(gates: GateResult[]): {
  status: RouteStatus;
  reason: string | null;
} {
  const failed = gates.find((g) => g.status === "failed");
  if (failed) return { status: "Restricted", reason: failed.reason };
  for (const id of CONDITIONAL_GATES) {
    const g = gates.find((x) => x.id === id && x.status === "warning");
    if (g) return { status: "Conditional", reason: g.reason };
  }
  return { status: "Eligible", reason: null };
}

/* ================================================================ value range */

/** One-sigma relative uncertainty of each line kind (price volatility, cost overrun). */
export const LINE_VOLATILITY: Record<LineKind, number> = {
  sale_order: 0.04,
  buyer_bid: 0.08,
  market_estimate: 0.18,
  commission: 0.05,
  test_certify: 0.12,
  lease_income: 0.05,
  residual_value: 0.22,
  servicing: 0.12,
  refurbishment: 0.15,
  avoided_purchase: 0.06,
  recommission: 0.12,
  freight: 0.08,
  part_value: 0.1,
  parts_estimate: 0.22,
  wait_cost_avoided: 0.15,
  teardown: 0.12,
  parts_handling: 0.1,
  carcass_material: 0.2,
  recycler_quote: 0.06,
  material_estimate: 0.15,
  decommission: 0.08,
  disposal_fee: 0.03,
  holding: 0.1,
};

/** Condition-driven line kinds: their spread grows as the grade drops. */
const CONDITION_KINDS: LineKind[] = [
  "refurbishment",
  "test_certify",
  "recommission",
  "teardown",
  "servicing",
  "residual_value",
  "part_value",
];
export const GRADE_SPREAD: Record<CaseRecord["condition"], number> = {
  A: 0.8,
  B: 1,
  C: 1.25,
  D: 1.5,
  Scrap: 1.7,
};
/** z of the 10th / 90th percentile of a normal distribution. */
const Z90 = 1.2816;

/**
 * P10–P90 net range of a route: each line's amount × its volatility (scaled by grade for
 * condition-driven lines and by missing evidence), combined as independent errors
 * (σ = √Σ(amount × vol)²). Estimates are skewed down (downside 1.15σ, upside 0.85σ).
 * P10 is rounded down and P90 up to $10, so P10 ≤ net ≤ P90 always holds.
 */
export function rangeFor(c: CaseRecord, rv: RouteValue): ValueRange | null {
  if (!rv.viable) return null;
  const evidence = 1 + Math.max(0, 80 - c.evidenceCompleteness) / 100;
  const parts = rv.lines.map((l) => {
    const vol =
      LINE_VOLATILITY[l.kind] *
      (CONDITION_KINDS.includes(l.kind) ? GRADE_SPREAD[c.condition] : 1) *
      evidence;
    return { label: l.label, volatility: vol, v: (l.amount * vol) ** 2 };
  });
  const total = parts.reduce((s, p) => s + p.v, 0);
  const sigma = Math.sqrt(total);
  const down = rv.estimate ? 1.15 : 1;
  const up = rv.estimate ? 0.85 : 1;
  return {
    p10: Math.floor((rv.net - Z90 * sigma * down) / 10) * 10 || 0,
    p90: Math.ceil((rv.net + Z90 * sigma * up) / 10) * 10 || 0,
    drivers: parts
      .filter((p) => p.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((p) => ({
        label: p.label,
        volatility: Math.round(p.volatility * 100) / 100,
        share: total ? p.v / total : 0,
      })),
  };
}

/** "$8.1k–$10.4k" (compact range for ladder rows). */
export function compactRange(r: { p10: number; p90: number }): string {
  const k = (n: number) => {
    const a = Math.abs(n);
    const s =
      a >= 1000
        ? `$${(a / 1000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`
        : `$${Math.round(a)}`;
    return n < 0 ? `−${s}` : s;
  };
  return r.p10 < 0 || r.p90 < 0
    ? `${k(r.p10)} to ${k(r.p90)}`
    : `${k(r.p10)}–${k(r.p90)}`;
}

/** Plain-language formula of the range (shown in the "How the range is calculated" popover). */
export const RANGE_FORMULA =
  "Each value and cost line has a volatility: firm prices (sales orders, recycler quotes) 4–6 %, bids 8 %, market estimates 18–22 %, refurbishment 15 %, residual value 22 %. Condition-driven lines are scaled by grade (A 0.8× … D 1.5×) and every line by missing evidence below 80 %. The errors are combined as independent (σ = √Σ(amount × volatility)²); P10 = net − 1.28σ and P90 = net + 1.28σ, skewed down for estimates. 8 in 10 outcomes should land inside the range.";

/* ================================================================ confidence + why not */

function confidenceOf(
  c: CaseRecord,
  best: RouteValue,
  ins: RouteInsight,
  runner: { rv: RouteValue; ins: RouteInsight } | null,
): { confidence: Confidence; reason: string } {
  if (!best.viable || !ins.range)
    return { confidence: "Low", reason: "No viable route yet" };
  const notes: string[] = [];
  let score = 100;
  if (best.estimate) {
    score -= 30;
    notes.push("priced on a forecast, not a named order");
  }
  if (ins.status === "Conditional") {
    score -= 20;
    if (!best.estimate) notes.push(ins.statusReason ?? "a gate needs checking");
  }
  const width =
    (ins.range.p90 - ins.range.p10) / Math.max(Math.abs(best.net), 1);
  score -= Math.min(30, width * 60);
  if (width > 0.35)
    notes.push(`wide range (${Math.round(width * 100)} % of net)`);
  if (c.evidenceCompleteness < 80) {
    score -= 15;
    notes.push(`evidence ${c.evidenceCompleteness} % complete`);
  }
  if (runner?.ins.range && runner.ins.range.p90 > ins.range.p10) {
    score -= 15;
    notes.push(`${runner.rv.routeName} could still come out ahead`);
  }
  const confidence: Confidence =
    score >= 70 ? "High" : score >= 45 ? "Medium" : "Low";
  const reason = notes.length
    ? `${confidence}: ${notes.join("; ")}.`
    : `${confidence}: named demand, all gates pass and the range stays clear of the runner-up.`;
  return {
    confidence,
    reason: reason.charAt(0).toUpperCase() + reason.slice(1),
  };
}

function whyNotOf(
  best: RouteValue,
  bi: RouteInsight,
  runner: RouteValue | null,
  ri: RouteInsight | null,
): WhyNot | null {
  if (!runner || !ri || !best.viable) return null;
  const gap = best.net - runner.net;
  const pct =
    Math.abs(best.net) > 0
      ? Math.round((gap / Math.abs(best.net)) * 100)
      : null;
  const dCycle = runner.timing.cycleDays - best.timing.cycleDays;
  const cons: WhyNot["constraints"] = [];
  cons.push({
    label: "Value gap",
    detail:
      gap >= 0
        ? `${usd(gap)} less net (${usd(runner.net)} vs ${usd(best.net)}${pct !== null ? `, ${pct} % lower` : ""})`
        : `${usd(-gap)} more net, but held back by the rules or the queue plan`,
    favoursBest: gap > 0,
  });
  const dayWord = (n: number) =>
    `${Math.abs(n)} ${Math.abs(n) === 1 ? "day" : "days"}`;
  cons.push({
    label: "Cycle time",
    detail:
      dCycle === 0
        ? `Same cycle time (${best.timing.cycleDays} days)`
        : `${runner.timing.cycleDays} days vs ${best.timing.cycleDays} days (${dayWord(dCycle)} ${dCycle > 0 ? "slower" : "faster"})`,
    favoursBest: dCycle > 0,
  });
  cons.push({
    label: "Gate status",
    detail:
      ri.status === bi.status
        ? `Both ${ri.status.toLowerCase()}`
        : `${ri.status}${ri.statusReason ? `: ${ri.statusReason}` : ""}`,
    favoursBest: rankStatus(bi.status) < rankStatus(ri.status),
  });
  const firm = (r: RouteValue) => !r.estimate && !!r.demand;
  const certain = (r: RouteValue) =>
    r.route === "exit"
      ? "no demand needed"
      : firm(r) && r.demand
        ? `confirmed ${r.demand.id}`
        : "forecast demand";
  cons.push({
    label: "Demand certainty",
    detail: `${certain(runner)} vs ${certain(best)}`,
    favoursBest: firm(best) && !firm(runner),
  });
  if (bi.range && ri.range) {
    const overlap = ri.range.p90 > bi.range.p10;
    cons.push({
      label: "Range overlap",
      detail: overlap
        ? `Ranges overlap: runner-up P90 ${usd(ri.range.p90)} is above the recommendation's P10 ${usd(bi.range.p10)}`
        : `No overlap: runner-up P90 ${usd(ri.range.p90)} stays below P10 ${usd(bi.range.p10)}`,
      favoursBest: !overlap,
    });
  }
  const main = cons
    .filter((x) => x.favoursBest && x.label !== "Range overlap")
    .map((x) => x.label.toLowerCase());
  const summary =
    gap >= 0
      ? `${runner.routeName} trails by ${usd(gap)}${main.length > 1 ? `; it also loses on ${main.filter((m) => m !== "value gap").join(" and ")}` : ""}.`
      : `${runner.routeName} nets ${usd(-gap)} more, but a rule, override or the queue plan puts ${best.routeName} first.`;
  return {
    route: runner.route,
    routeName: runner.routeName,
    summary,
    constraints: cons,
  };
}

const rankStatus = (s: RouteStatus) =>
  s === "Eligible" ? 0 : s === "Conditional" ? 1 : 2;

/* ================================================================ snapshot */

/** "EVS-1A2B3C4D": hash of case id, the evidence the decision rests on and the model version. */
export function snapshotIdFor(
  c: CaseRecord,
  dec: CaseDecision,
  ctx: EngineContext,
  modelVersion: string,
): string {
  const cc = ctx.contextFor(c);
  const b = dec.best;
  const evidence = [
    c.id,
    modelVersion,
    c.condition,
    cc.lifePct,
    c.evidenceCompleteness,
    b.route,
    b.net,
    b.demands.map((d) => d.id).join("+"),
    b.lines
      .map((l) => `${l.kind}:${l.amount}:${l.sources[0]?.reference ?? ""}`)
      .join(","),
    dec.rulesApplied.join("+"),
    // Each re-decision on new evidence (inspection recorded, re-evaluated) is a new snapshot.
    ...(c.evaluationRound ? [`round ${c.evaluationRound}`] : []),
  ].join("|");
  const a = hashOf(evidence).toString(16).padStart(8, "0");
  return `EVS-${a.toUpperCase()}`;
}

/* ================================================================ insights */

/**
 * Gates, status, range and cycle time for every route, plus confidence, why-not and the
 * evidence snapshot of the recommendation.
 */
export function insightsFor(
  c: CaseRecord,
  dec: CaseDecision,
  ctx: EngineContext,
  modelVersion: string,
): DecisionInsights {
  const routes = {} as Record<RouteId, RouteInsight>;
  for (const rv of dec.all) {
    const gates = gatesFor(c, rv, dec, ctx);
    const st = statusOf(gates);
    routes[rv.route] = {
      route: rv.route,
      status: st.status,
      statusReason: st.reason,
      gates,
      range: rangeFor(c, rv),
      cycleDays: rv.timing.cycleDays,
    };
  }
  for (const r of ROUTE_IDS)
    if (!routes[r])
      routes[r] = {
        route: r,
        status: "Restricted",
        statusReason: "Not evaluated",
        gates: [],
        range: null,
        cycleDays: 0,
      };
  const best = dec.best;
  const runner =
    dec.all.find((r) => r.viable && r.route !== best.route) ?? null;
  const { confidence, reason } = confidenceOf(
    c,
    best,
    routes[best.route],
    runner ? { rv: runner, ins: routes[runner.route] } : null,
  );
  return {
    caseId: c.id,
    routes,
    best: best.route,
    confidence,
    confidenceReason: reason,
    whyNot: whyNotOf(
      best,
      routes[best.route],
      runner,
      runner ? routes[runner.route] : null,
    ),
    snapshotId: snapshotIdFor(c, dec, ctx, modelVersion),
    modelVersion,
  };
}

/* ================================================================ instructions */

const WORKDAY_H = 9;

/** "4 working h", "1 working day", "2 working days". */
export function timeLimitText(h: number): string {
  if (h < WORKDAY_H) return `${h} working h`;
  const d = Math.round(h / WORKDAY_H);
  return `${d} working ${d === 1 ? "day" : "days"}`;
}

const caseNo = (id: string) => Number(id.replace(/\D/g, "")) || 0;
const siteCode = (site: string) =>
  site === "Warehouse 1" ? "W1" : site === "Warehouse 2" ? "W2" : "RC";

const SYS = {
  oms: "IBM Sterling OMS",
  eam: "IBM Maximo EAM",
  wms: "Manhattan Active WMS",
  erp: "SAP S/4HANA ERP",
  lease: "Oracle ERP Cloud",
  recommerce: "Optoro",
  market: "Machinio",
  recycler: "Sims Lifecycle Services",
} as const;

/**
 * The enterprise instructions approval sends for a route, in execution order. Systems are the
 * connected sources in src/data/sources.json; transport is booked as a freight order in SAP
 * S/4HANA (TM). Document numbers continue the case's existing work-order numbering.
 */
export function instructionsFor(c: CaseRecord, rv: RouteValue): Instruction[] {
  if (!rv.viable) return [];
  const n = caseNo(c.id);
  const d = rv.demand;
  const t = rv.timing;
  const asset = `${c.id} · ${c.model}`;
  const wo = `WO-2026-${8800 + n}`;
  const to = `TO-${siteCode(c.location)}-${4400 + n}`;
  const fo = `FO-${7100 + n}`;
  const fi = `FI-${47000 + n}`;
  const list: Omit<Instruction, "id" | "timeLimit">[] = [];
  const add = (
    system: string,
    module: string,
    instruction: string,
    detail: string,
    doc: string,
    docNew: boolean,
    owner: string,
    timeLimitHours: number,
  ) =>
    list.push({
      system,
      module,
      instruction,
      detail,
      doc,
      docNew,
      owner,
      timeLimitHours,
    });
  const costs = (kinds: string) => `Post actual ${kinds} costs against ${c.id}`;
  const transport = (to2: string, why: string) =>
    add(
      SYS.erp,
      "ERP · freight order (TM)",
      "Book transport",
      `${c.location} → ${to2} · ${why}`,
      fo,
      true,
      "Transport planner",
      4,
    );
  const wmsMove = (dest: string) =>
    add(
      SYS.wms,
      "WMS · transfer",
      "Warehouse move and outbound",
      `Pick ${asset} from bin ${c.facts.wmsBinLocation} at ${c.location} → ${dest}`,
      to,
      true,
      `Warehouse Manager · ${c.location}`,
      2,
    );

  switch (rv.route) {
    case "redeploy": {
      const site = d?.site ?? c.location;
      add(
        SYS.oms,
        "OMS · order allocation",
        `Allocate to redeploy request ${d?.id ?? ""}`.trim(),
        `${asset} to ${d?.customer ?? site}; cancel the planned purchase`,
        d?.id ?? "—",
        false,
        "Customer operations · order desk",
        4,
      );
      add(
        SYS.eam,
        "EAM · work order",
        "Test and recommission",
        `Functional test and safety check at ${c.location} before release`,
        wo,
        true,
        "Repair centre lead (Engineer)",
        4,
      );
      if (t.transfer) transport(site, `${t.transferDays} transfer days`);
      wmsMove(
        t.transfer ? "outbound staging" : `in-service location at ${site}`,
      );
      add(
        SYS.erp,
        "ERP · finance",
        "Post costs and transfer the asset",
        `${costs(`recommission${t.transfer ? " and freight" : ""}`)}; move the asset to the ${site} cost centre`,
        fi,
        true,
        "Finance",
        18,
      );
      break;
    }
    case "resale": {
      if (d && d.kind === "sales_order")
        add(
          SYS.oms,
          "OMS · sales order",
          `Allocate to sales order ${d.id}`,
          `${asset} to ${d.customer} at ${usd(d.price)}`,
          d.id,
          false,
          "Customer operations · order desk",
          4,
        );
      else if (d && d.kind === "buyer_bid")
        add(
          SYS.market,
          "Market · bid acceptance",
          `Accept buyer bid ${d.id}`,
          `${usd(d.price)} from ${d.customer}, valid to ${fmtDay(d.validTo)}`,
          d.id,
          false,
          "Remarketing lead",
          4,
        );
      else
        add(
          SYS.recommerce,
          "Recommerce · listing",
          "List for sale",
          `${c.model}, grade ${c.condition}, about ${usd(rv.gross)} before costs`,
          `LST-${5200 + n}`,
          true,
          "Remarketing lead",
          9,
        );
      add(
        SYS.eam,
        "EAM · work order",
        "Test, clean and certify",
        `Certify ${asset} for sale at ${c.location}`,
        wo,
        true,
        "Repair centre lead (Engineer)",
        4,
      );
      if (d) transport(d.site, `deliver to ${d.customer}`);
      wmsMove(d ? "outbound staging" : "resale holding bay");
      add(
        SYS.erp,
        "ERP · finance",
        "Post sale and actual costs",
        `Post revenue and ${costs("test, commission" + (d ? " and freight" : "")).replace("Post actual ", "")}`,
        fi,
        true,
        "Finance",
        18,
      );
      break;
    }
    case "relase": {
      const lease = d && "termMonths" in d ? d : null;
      add(
        SYS.lease,
        "ERP · lease contract",
        `Lease contract on ${d?.kind === "lease_renewal" ? "renewal" : "order"} ${d?.id ?? ""}`.trim(),
        lease
          ? `${lease.customer}: ${usd(lease.monthlyFee)}/month × ${lease.termMonths} months from ${fmtDay(t.neededBy ?? t.ready)}`
          : "New lease contract",
        d?.id ?? "—",
        false,
        "Lease administration",
        9,
      );
      add(
        SYS.eam,
        "EAM · work order",
        "Refurbish to lease standard",
        `Full refurbishment of ${asset} at the repair centre (${usd(c.refurbishmentCost)} standard cost)`,
        wo,
        true,
        "Repair centre lead (Engineer)",
        4,
      );
      if (t.transfer && d) transport(d.site, `${t.transferDays} transfer days`);
      wmsMove(t.transfer ? "outbound staging" : "lease dispatch bay");
      add(
        SYS.erp,
        "ERP · finance",
        "Post costs and start lease billing",
        `${costs("refurbishment" + (t.transfer ? " and freight" : ""))}; start billing on ${d?.id ?? "the lease"}`,
        fi,
        true,
        "Finance",
        18,
      );
      break;
    }
    case "intparts": {
      const ros = rv.demands.map((x) => x.id);
      add(
        SYS.eam,
        "EAM · work order",
        "Teardown and certify parts",
        `Harvest ${ros.length} part${ros.length === 1 ? "" : "s"} from ${asset}; certify at or above the fit-for-use threshold (GR-03)`,
        wo,
        true,
        "Repair centre lead (Engineer)",
        4,
      );
      add(
        SYS.erp,
        "ERP · spare parts",
        "Receive parts and issue to repair orders",
        `Goods receipt of certified parts; issue to ${ros.join(", ")}`,
        ros.join(", "),
        false,
        "Service parts planner",
        4,
      );
      if (t.transfer)
        transport(
          rv.demands.find((x) => x.site !== c.location)?.site ?? c.location,
          "parts to the repair site",
        );
      wmsMove("service parts stores");
      add(
        SYS.recycler,
        "Recycler · collection",
        "Collect the carcass",
        `Carcass of ${asset} to certified recycling`,
        `RC-${6100 + n}`,
        true,
        "Sustainability lead",
        9,
      );
      add(
        SYS.erp,
        "ERP · finance",
        "Post actual costs",
        `${costs("teardown")}; credit parts to spare-parts stock`,
        fi,
        true,
        "Finance",
        18,
      );
      break;
    }
    case "extparts": {
      add(
        SYS.eam,
        "EAM · work order",
        "Teardown and certify parts",
        `Harvest and certify parts from ${asset} (GR-03)`,
        wo,
        true,
        "Repair centre lead (Engineer)",
        4,
      );
      if (rv.demands.length)
        add(
          SYS.oms,
          "OMS · parts sales orders",
          "Create parts sales orders",
          rv.demands.map((x) => `${x.id} (${x.customer})`).join(", "),
          rv.demands.map((x) => x.id).join(", "),
          false,
          "Parts sales lead",
          4,
        );
      else
        add(
          SYS.market,
          "Market · parts listing",
          "List certified parts",
          `List harvested parts from ${asset} on the parts marketplace`,
          `LST-${5200 + n}`,
          true,
          "Parts sales lead",
          9,
        );
      if (rv.demands.length)
        transport(rv.demands[0].site, "ship parts to buyers");
      wmsMove("parts dispatch");
      add(
        SYS.erp,
        "ERP · finance",
        "Post sale and actual costs",
        `Post parts revenue and ${costs("teardown, handling").replace("Post actual ", "")}`,
        fi,
        true,
        "Finance",
        18,
      );
      break;
    }
    case "material": {
      add(
        SYS.recycler,
        "Recycler · collection order",
        d
          ? `Collection order on quote ${d.id}`
          : "Request a certified quote and collection",
        d
          ? `${d.customer} collects ${asset}`
          : `No quote on file; request one before collection (GR-06)`,
        d?.id ?? `RQ-REQ-${n}`,
        !d,
        "Sustainability lead",
        9,
      );
      add(
        SYS.eam,
        "EAM · work order",
        "Decommission",
        "Decommission and hazardous-material handling before collection",
        wo,
        true,
        "Repair centre lead (Engineer)",
        4,
      );
      transport(d?.site ?? "recycler yard", "recycler collection");
      wmsMove("outbound collection bay");
      add(
        SYS.recycler,
        "Recycler · certificate",
        "File recycling certificate",
        "Certificate of recycling in the circularity ledger (GR-06)",
        `CERT-${3300 + n}`,
        true,
        "Sustainability lead",
        45,
      );
      add(
        SYS.erp,
        "ERP · finance",
        "Post proceeds and retire the asset",
        `Post recycler proceeds and decommission cost; retire ${c.id} from the asset register`,
        fi,
        true,
        "Finance",
        18,
      );
      break;
    }
    case "exit": {
      add(
        SYS.recycler,
        "Disposal · vendor order",
        "Certified disposal order",
        `${asset} to the certified disposal provider`,
        `DSP-${2900 + n}`,
        true,
        "Sustainability lead",
        9,
      );
      transport("disposal provider", "collection");
      wmsMove("outbound collection bay");
      add(
        SYS.recycler,
        "Disposal · certificate",
        "File disposal certificate",
        "Certificate of destruction on file (GR-06)",
        `CERT-${3300 + n}`,
        true,
        "Sustainability lead",
        45,
      );
      add(
        SYS.erp,
        "ERP · finance",
        "Post disposal fee and retire the asset",
        `Post the disposal fee; retire ${c.id} from the asset register`,
        fi,
        true,
        "Finance",
        18,
      );
      break;
    }
  }
  return list.map((x, i) => ({
    ...x,
    id: `${c.id}-I${i + 1}`,
    timeLimit: timeLimitText(x.timeLimitHours),
  }));
}

/** Instruction preview with the one-line summary shown before approval. */
export function previewFor(c: CaseRecord, rv: RouteValue): InstructionPreview {
  const instructions = instructionsFor(c, rv);
  const systems = [...new Set(instructions.map((i) => i.system))];
  const spend = rv.viable ? rv.cost : 0;
  const sys =
    systems.length > 1
      ? `${systems.slice(0, -1).join(", ")} and ${systems[systems.length - 1]}`
      : (systems[0] ?? "no system");
  return {
    caseId: c.id,
    route: rv.route,
    routeName: rv.routeName,
    instructions,
    systems,
    spend,
    summary: instructions.length
      ? `Approval sends ${instructions.length} instructions to ${sys} and commits up to ${usd(spend)} of spend.`
      : "No instructions: the route is not viable.",
  };
}

/* ================================================================ working hours */

/** Working hours are Mon–Fri 08:00–17:00 UTC. Returns the ISO time `hours` working hours after `iso`. */
export function addWorkingHours(iso: string, hours: number): string {
  let t = Date.parse(iso);
  let left = hours * 3_600_000;
  for (let guard = 0; guard < 400 && left > 0; guard++) {
    const d = new Date(t);
    const day = d.getUTCDay();
    const start = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      8,
    );
    const end = start + 9 * 3_600_000;
    if (day === 0 || day === 6 || t >= end) {
      t = start + 86_400_000; // next day 08:00
      continue;
    }
    if (t < start) t = start;
    const take = Math.min(left, end - t);
    t += take;
    left -= take;
  }
  return new Date(t).toISOString();
}

/** Working hours between two ISO times (0 when b ≤ a). */
export function workingHoursBetween(a: string, b: string): number {
  let t = Date.parse(a);
  const stop = Date.parse(b);
  let ms = 0;
  for (let guard = 0; guard < 400 && t < stop; guard++) {
    const d = new Date(t);
    const day = d.getUTCDay();
    const start = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      8,
    );
    const end = start + 9 * 3_600_000;
    if (day === 0 || day === 6 || t >= end) {
      t = start + 86_400_000;
      continue;
    }
    if (t < start) t = start;
    const until = Math.min(end, stop);
    if (until > t) ms += until - t;
    t = end;
  }
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/* ================================================================ presets */

export const PRESETS: ScenarioPreset[] = [
  {
    id: "demand_cancelled",
    label: "Demand cancelled",
    description: "The named order or request behind the route is cancelled.",
  },
  {
    id: "parts_cost_up",
    label: "Parts cost +30%",
    description:
      "Refurbishment, test, recommission and teardown cost 30 % more.",
  },
  {
    id: "resale_down",
    label: "Resale price −20%",
    description:
      "Market-priced value (estimates, residual value, parts and material) is 20 % lower. Confirmed order prices stay.",
  },
  {
    id: "cert_short",
    label: "Certification shorter than demand",
    description:
      "Certified life after refurbishment does not cover the lease or service term.",
  },
  {
    id: "part_unavailable",
    label: "Critical part unavailable",
    description: "A part needed to refurbish or recommission is on backorder.",
  },
  {
    id: "new_unit",
    label: "Customer requires a new unit",
    description:
      "The customer behind the demand will not accept a used or refurbished unit.",
  },
];

const PRESET_ROUTES: Partial<
  Record<PresetId, { routes: RouteId[]; reason: string }>
> = {
  cert_short: {
    routes: ["relase", "redeploy"],
    reason:
      "Certified life after refurbishment is shorter than the demand term",
  },
  part_unavailable: {
    routes: ["relase", "redeploy"],
    reason: "Critical part unavailable; refurbishment cannot finish",
  },
  new_unit: {
    routes: ["redeploy", "relase"],
    reason: "Customer requires a new unit",
  },
};

/** Engine levers for a preset applied to every route ('all') or one route. */
export interface PresetStress {
  params?: Partial<DecisionParams>;
  routeParams?: RouteParams;
  restricted?: Partial<Record<RouteId, string>>;
  /** Demand ids treated as cancelled. */
  cancelled?: string[];
  /** False when the preset does not touch the chosen route. */
  affects: boolean;
}

/**
 * Translates a preset into engine levers. `base` are the scenario slider levers already on
 * screen (multiplied, not replaced). `dec` is the decision the preset is applied to (its
 * named demands are the ones "Demand cancelled" removes).
 */
export function presetStress(
  preset: PresetId,
  applyTo: "all" | RouteId,
  dec: CaseDecision,
  base: Partial<DecisionParams> = {},
): PresetStress {
  const routes: RouteId[] = applyTo === "all" ? ROUTE_IDS : [applyTo];
  const scale = (
    key: "refurbCostIndex" | "resalePriceIndex",
    f: number,
  ): PresetStress => {
    const v = Math.round((base[key] ?? 1) * f * 100) / 100;
    if (applyTo === "all") return { params: { [key]: v }, affects: true };
    return { routeParams: { [applyTo]: { [key]: v } }, affects: true };
  };
  switch (preset) {
    case "demand_cancelled": {
      const ids = [
        ...new Set(
          dec.all
            .filter((r) => routes.includes(r.route))
            .flatMap((r) =>
              r.demands
                .filter((x) => x.kind !== "recycler_quote")
                .map((x) => x.id),
            ),
        ),
      ];
      return { cancelled: ids, affects: ids.length > 0 };
    }
    case "parts_cost_up":
      return scale("refurbCostIndex", 1.3);
    case "resale_down":
      return scale("resalePriceIndex", 0.8);
    default: {
      const spec = PRESET_ROUTES[preset];
      if (!spec) return { affects: false };
      const hit = spec.routes.filter((r) => routes.includes(r));
      return {
        restricted: Object.fromEntries(hit.map((r) => [r, spec.reason])),
        affects: hit.length > 0,
      };
    }
  }
}
