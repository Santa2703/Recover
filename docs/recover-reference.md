# Recover reference: what Circularity takes from it

Source: the Artizent "Recover" HTML demo (tool-fleet edition) the team shared on 21 Nov 2026. This file is the
spec for the features we adopt. **Visual style stays Circularity's** (yellow `#FFD600`, local sidebar, fonts,
antd + Tailwind + Recharts, `docs/ui-build-guide.md`). Never copy Recover's ochre palette, dark rail or fonts.

## 1. Decision model

### Routes (ours) and who executes them
| Route id | Name | Executes in | Owner | Lead days |
|---|---|---|---|---|
| redeploy | Internal Redeploy | ERP stock transfer | Asset planner | 3 |
| resale | Whole-Asset Resale | Remarketing channel / ERP sales orders | Remarketing lead | 9 |
| intparts | Internal Parts Harvest | Teardown work order + ERP spare parts | Service parts planner | 5 |
| relase | Secondary Re-lease (refurbish → lease) | Repair work order, then lease contract system | Repair center lead | 7 |
| material | Material Recovery | Recycler portal + circularity ledger | Sustainability lead | 6 |
| extparts | External Parts Sale | Teardown + parts sales channel | Parts sales lead | 6 |
| exit | Responsible Exit | Certified disposal provider | Sustainability lead | 6 |

### Intake channel and the "standard route"
Each case gets an **intake channel**: `lease_end` (Lease / contract end), `field_return` (Field service return /
repair), `trade_in` (Customer trade-in), `excess` (Excess or idle stock). The **standard route** is what that team
would do on its own, without Circularity:
- lease_end: grade A → relase if a lease demand exists, else resale
- field_return: grade A → redeploy if demand, B/C → relase if demand, else material
- trade_in: resale
- excess: resale; grade D/Scrap → material

**Gain over the standard route** = best-route net − standard-route net. It is the headline metric.

### Net value of a route
`net = Σ value lines − Σ cost lines − holding cost/day × lead days`
Each line: `{ type: 'value'|'cost'|'time', label, basis (plain-language formula), amount, sources: [{ system, method, freshness, approvedBy? }] }`.

- **Named demand.** A route is priced against a real demand record when one exists:
  lease orders / renewals (relase), sales orders and buyer bids (resale), internal redeploy requests from a site
  that is short (redeploy), open repair orders needing a part, flag `backordered` (intparts / extparts), recycler
  quote (material). With no demand record, resale falls back to an estimate and is labelled **"Estimate · no buyer yet"**;
  relase / redeploy / intparts are **not viable** without demand ("No open lease order for this model").
- **Timing check.** `ready = lead days + transfer days (2 if the demand site differs)`; viable only if `ready <= needed-by`.
  The miss is the reason text ("RT-xxxx needed by 20 Nov; ready 24 Nov").
- **Lease value** = monthly fee × term discounted at the cost of capital (9 %/yr) + residual value at end of term in
  today's money − servicing during the term.
- **Parts**: each harvestable part has a remaining-life %; a part counts only if ≥ the fit-for-use threshold (50 %)
  and an open repair order needs it; certified used part = 70 % of new part price; + customer-wait cost avoided if backordered.
- Grade rules: relase needs grade B/C and life ≥ 40 %; redeploy needs grade A/B; grade D/Scrap → material/exit/parts only.

### Queue plan (whole queue, not case by case)
Decide all open cases together: **each demand record is used by at most one case** (the one where it adds most,
by regret = loss if denied), and **refurbishment (relase) is limited to N slots** (default 8). Compare with
**first come, first served** (oldest case picks first). Show: plan value, FCFS value, plan adds +$X, demands wanted
twice, and per case "Deciding this case alone would … ; ORD-x goes to RT-y where it adds more".

### Business rules and guardrails
- Rules: `{ id 'BR-01', action: 'exclude'|'prefer'|'require', route, scope: { productClass[], condition[], channel[], site[], lifeMax?, lifeMin? }, owner }`.
  Prefer wins only when the preferred route is viable and within 15 % of the best net.
- Guardrails are locked (changed only by their owner, never by the Studio):
  GR-01 Grade C/D never re-leased without refurbishment · GR-02 Refurbishment always ends in a named lease or sales
  order · GR-03 Parts certified only at or above the fit-for-use threshold · GR-04 Holding cost rate set by Finance ·
  GR-05 Every decision approved by a named owner · GR-06 Exit/material only through a certified provider with a certificate on file.

### Learning
Override = choose another route + required reason (Customer commitment / Known condition issue not in data /
Regulatory or contract hold / Market knowledge), logged. **Record outcome** = realised value vs forecast, written to
decision history; analytics use it (forecast accuracy, overrides).

## 2. UI patterns to adopt (in Circularity's style)

- **Next best action card** on the Case page: label "Next best action" (or "Approved action"), one-sentence action
  ("Refurbish, then lease to Brightline Mechanical on renewal LO-2231"), `net · +$X over the <channel> standard route
  (<route>, $Y) · executes in <system>`, pill "Against named demand" or "Estimate · no buyer yet";
  numbered dated steps (Approve today → Refurbish ready 8 Nov → Ship → Lease starts 20 Nov);
  **Proof** list (✓ / !) for Demand, Condition, Timing, Capacity and cost, Price, each with its source line;
  "If this falls through: <runner-up>, $Z".
- **Route ladder**: one row per route, diverging bar around a zero line, tags **Best**, **<channel> default**,
  **Named demand** / **Estimate**, reason text for non-viable routes; click a row → its calculation below.
- **Calculation table**: grouped Value / Cost / Time lines, each with basis and a source sub-list
  (`System · method · freshness · approved by X`), footer `Value − cost − holding = net`.
- **How calculated** on every KPI: popover/drawer with the formula in plain words and the rows behind the number.
- **Inbox → Run agents → result** on the Dashboard: compact panel "3 new returns received, not yet decided";
  Run animates 7 agent step chips per item (Intake, Condition, Demand, Fit for use, Valuation, Decision, Follow-through);
  then a result bar "Decided 3 new returns · +$X over the standard route · Review".
- **Gap by intake channel**: two-tone bar per channel (standard route vs best route) with "+$X".
- **Drill-down**: any chart bar/point opens the decisions behind it (summary KPIs + table → one decision).
- **Forecast accuracy by who decided**: 2×2 (Circularity's route / owner override × within 5 % / missed by > 5 %).
- **Forecast vs realised scatter** with a dashed perfect-forecast line; each dot opens that decision.
- **Portfolio What-if**: sliders (resale price index, refurbishment cost index, lease demand, customer-wait cost,
  fit-for-use threshold, holding cost/day, refurbishment slots) → queue value scenario vs today vs standard route,
  decisions that change (table), route mix today → scenario.

## 3. Workflow Studio: "Decision flow" mode

Fixed template: Intake (trigger) → Condition and life agent → Demand discovery agent → Fit-for-use agent →
Valuation agent → **Guardrail gate** → business rule nodes → **Decision** → **Owner approval** → 7 route outcome nodes →
Execute in owning system → Learning. Core steps and gates sit in a band labelled "Core prediction and agents · fixed".

- **Node card**: top row = type tag with icon ("Core agent", "Guardrail gate", "Business rule", "Owner approval",
  "Outcome", "Process step") + status pill (Live / Draft / Locked / Fixed / Proposed / Blocked / Inactive);
  title; one-line subtitle; "Owner <role>" line; output handle on the right. Type shown by a coloured left edge.
- Locked/fixed nodes can move but not be edited or deleted. Deleting a middle step reconnects its neighbours.
- **Inspector** for rule nodes: action (Never/Prefer/Only), route, scope checkboxes (product class, grade, channel,
  site), life under / at least %, plain-language read-back ("Field service returns, grade C: never Secondary Re-lease").
- **Live checks** under the canvas (✓ ! ✕, click selects the node): every step connected; every outcome passes the
  guardrail gate; every outcome passes owner approval; rule has a route; rule breaks a guardrail (blocked);
  rule inactive (not between gate and decision); two rules conflict; route removed from the flow.
- **Simulated impact**: draft rules vs published rules on open cases: decisions that change, net value difference,
  table of changed cases (published route → draft route, net change).
- **Governance**: Published vN → edit → Draft vN+1 → Submit for approval → approve by a **different** person
  ("Maker-checker: you made these changes and cannot approve them") → Shadow run → Publish (rules go live for case
  decisions) → Roll back to previous version. "Acting as" selector with 3 demo people. Audit log of every action.
- **AI assistant panel** (rule-based parser, no LLM required): user types "Field returns grade C: never re-lease" or
  "Add a safety inspection step before Whole-Asset Resale"; live read-back while typing; on send → a proposal card
  (checks: fits the process, passes guardrails, conflicts, models unchanged; impact) and a dashed proposed node on the
  canvas; Approve applies it to the draft, Dismiss removes it. Requests that touch a guardrail are refused with the
  guardrail id and owner.
