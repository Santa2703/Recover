/**
 * Plain-language explanations of a decision for the UI: next best action card and the
 * 7-step agent trail. Pure functions of (case, decision, engine context).
 */
import type { CaseRecord } from '@/models/domain.model';
import type {
  ActionStep,
  AgentStep,
  CaseDecision,
  Demand,
  LineSource,
  NextBestAction,
  ProofItem,
  RouteValue,
} from '@/models/decision.model';
import { addDays, CHANNEL_LABEL, CHANNEL_SHORT, fmtDay, usd, type EngineContext } from './engine';

/** "System · method · freshness · approved by X". */
export function sourceText(s: LineSource | undefined): string {
  if (!s) return '';
  return [s.reference ? `${s.system} (${s.reference})` : s.system, s.method, s.freshness, s.approvedBy ? `approved by ${s.approvedBy}` : null].filter(Boolean).join(' · ');
}

/** "3 days spare", "1 day spare", "2 days late" (never "-2 days spare"). */
function spareText(days: number): string {
  const n = Math.abs(days);
  return `${n} ${n === 1 ? 'day' : 'days'} ${days < 0 ? 'late' : 'spare'}`;
}

const DEMAND_LABEL: Record<Demand['kind'], string> = {
  lease_order: 'lease order',
  lease_renewal: 'lease renewal',
  sales_order: 'sales order',
  buyer_bid: 'buyer bid',
  redeploy_request: 'redeploy request',
  repair_order: 'repair order',
  recycler_quote: 'recycler quote',
};

/** "lease renewal LO-2231 from Customer D". */
export function demandText(d: Demand): string {
  return `${DEMAND_LABEL[d.kind]} ${d.id} from ${d.customer}`;
}

function headline(v: RouteValue, c: CaseRecord): string {
  const d = v.demand;
  if (!v.viable) return 'No viable route yet: hold and re-evaluate';
  switch (v.route) {
    case 'relase':
      return d ? `Refurbish, then lease to ${d.customer} on ${d.kind === 'lease_renewal' ? 'renewal' : 'order'} ${d.id}` : 'Refurbish, then re-lease';
    case 'resale':
      if (!d) return `List on the remarketing channel; expected sale price about ${usd(v.gross)} before costs`;
      return d.kind === 'buyer_bid' ? `Sell to ${d.customer} on bid ${d.id}` : `Sell to ${d.customer} on sales order ${d.id}`;
    case 'redeploy':
      return d ? `Transfer to ${d.site} for redeploy request ${d.id}` : 'Redeploy to another site';
    case 'intparts':
      return `Harvest ${v.demands.length} part${v.demands.length === 1 ? '' : 's'} for ${v.demands.map((x) => x.id).join(', ')}`;
    case 'extparts': {
      const n = v.lines.filter((l) => l.kind === 'part_value' || l.kind === 'parts_estimate').length;
      return d ? `Harvest and sell ${n} certified parts, starting with ${d.customer} (${d.id})` : `Harvest and list ${n} certified parts on the parts marketplace`;
    }
    case 'material':
      return d ? `Recycle with ${d.customer} on quote ${d.id}` : `Recycle ${c.quantity > 1 ? 'the lot' : 'the asset'} at the index rate (no quote on file)`;
    case 'exit':
      return 'Responsible exit through the certified disposal provider';
  }
}

function steps(v: RouteValue, ctx: EngineContext): ActionStep[] {
  const today = ctx.asOf.slice(0, 10);
  const t = v.timing;
  const done = addDays(today, t.leadDays);
  const arrive = t.ready;
  const need = t.neededBy ?? arrive;
  const d = v.demand;
  const approve: ActionStep = { title: 'Approve', when: today, detail: `${v.owner} approves the decision (GR-05)` };
  const ship = (what: string): ActionStep[] => (t.transfer && d ? [{ title: 'Ship', when: arrive, detail: `${what} to ${d.site} (${t.transferDays} transfer days)` }] : []);
  switch (v.route) {
    case 'relase':
      return [approve, { title: 'Refurbish', when: done, detail: 'Repair work order, full refurbishment to lease standard' }, ...ship('Refurbished asset'), { title: 'Lease starts', when: need, detail: d ? `${d.customer}, ${d.id}` : 'New lease contract' }];
    case 'resale':
      return [approve, { title: 'Test and certify', when: done, detail: 'Test, clean and certify for sale' }, ...ship('Certified asset'), { title: d ? 'Deliver to buyer' : 'Sale expected', when: d ? need : arrive, detail: d ? `${d.customer}, ${d.id}` : 'Listed on the remarketing channel' }];
    case 'redeploy':
      return [approve, { title: 'Recommission', when: done, detail: 'Test and recommission' }, ...ship('Asset'), { title: 'In service', when: need, detail: d ? `${d.site}, request ${d.id}` : 'Receiving site' }];
    case 'intparts':
      return [approve, { title: 'Teardown', when: done, detail: 'Teardown work order; parts certified at or above the fit-for-use threshold (GR-03)' }, { title: 'Parts issued', when: arrive, detail: v.demands.map((x) => x.id).join(', ') }, { title: 'Carcass recycled', when: addDays(arrive, 2), detail: 'Remaining carcass to the certified recycler' }];
    case 'extparts':
      return [approve, { title: 'Teardown', when: done, detail: 'Teardown and certify parts' }, { title: 'Parts shipped', when: arrive, detail: v.demands.length ? v.demands.map((x) => `${x.id} (${x.customer})`).join(', ') : 'Listed on the parts marketplace' }];
    case 'material':
      return [approve, { title: 'Decommission', when: addDays(today, Math.max(1, t.leadDays - 2)), detail: 'Decommission and hazardous-material handling' }, { title: 'Collected', when: done, detail: d ? `${d.customer} (${d.id})` : 'Certified recycler' }, { title: 'Certificate filed', when: addDays(done, 2), detail: 'Recycling certificate in the circularity ledger (GR-06)' }];
    case 'exit':
      return [approve, { title: 'Collected', when: done, detail: 'Certified disposal provider' }, { title: 'Certificate filed', when: addDays(done, 2), detail: 'Disposal certificate on file (GR-06)' }];
  }
}

function proof(c: CaseRecord, dec: CaseDecision, ctx: EngineContext, slotsUsed: number | null): ProofItem[] {
  const v = dec.best;
  const cc = ctx.contextFor(c);
  const d = v.demand;
  const firstValue = v.lines.find((l) => l.type === 'value');
  const items: ProofItem[] = [];
  items.push(
    d
      ? { ok: true, heading: 'Demand', body: `Priced against ${demandText(d)}${d.model ? ` for a ${d.model}` : ''}.`, source: `${d.system} · ${d.id} · created ${fmtDay(d.createdAt)}` }
      : { ok: v.route === 'exit', heading: 'Demand', body: v.route === 'exit' ? 'No demand needed for a responsible exit.' : 'No buyer named yet; priced on a market estimate.', source: sourceText(firstValue?.sources[0]) },
  );
  const evidenceOk = c.evidenceCompleteness >= 80;
  items.push({
    ok: evidenceOk && v.viable,
    heading: 'Condition',
    body: `Grade ${c.condition}, ${cc.lifePct} % remaining life; evidence ${c.evidenceCompleteness} % complete${evidenceOk ? '' : ' (inspection still open)'}.`,
    source: `EAM inspection · grade and remaining-life model · ${c.stage === 'awaiting_inspection' ? 'inspection not yet recorded' : `recorded ${fmtDay(c.receivedDate)}`}`,
  });
  const t = v.timing;
  items.push({
    ok: t.bufferDays === null || t.bufferDays >= 0,
    heading: 'Timing',
    body:
      t.neededBy && d
        ? `Ready ${fmtDay(t.ready)}${t.transfer ? ` at ${d.site} after ${t.transferDays} transfer days` : ''}; needed by ${fmtDay(t.neededBy)} (${spareText(t.bufferDays ?? 0)}).`
        : `Ready ${fmtDay(t.ready)} (${t.leadDays} days lead time).`,
    source: `Route lead time · ${v.routeName} ${t.leadDays} days · policy ${ctx.policy.version}`,
  });
  const costs = v.lines.filter((l) => l.type === 'cost');
  const capacityText = v.usesSlot && slotsUsed !== null ? `Uses 1 of ${ctx.policy.refurbSlots} refurbishment slots (${slotsUsed} planned in the queue). ` : '';
  items.push({
    ok: true,
    heading: 'Capacity and cost',
    body: `${capacityText}Costs ${usd(v.cost)} (${costs.map((l) => l.label.toLowerCase()).join(', ') || 'none'}) plus ${usd(v.holding)} holding.`,
    source: sourceText((costs[0] ?? v.lines.find((l) => l.kind === 'holding'))?.sources[0]),
  });
  items.push({
    ok: !v.estimate,
    heading: 'Price',
    body: firstValue ? `${firstValue.label}: ${usd(firstValue.amount)} (${firstValue.basis}).` : `No income; net ${usd(v.net)}.`,
    source: sourceText(firstValue?.sources[0] ?? v.lines[0]?.sources[0]),
  });
  return items.map((p) => ({ ...p, body: p.body.replace(/\s+/g, ' ').trim() }));
}

/**
 * Next best action card for a case.
 * @param approved true when the case is already approved / handed off ("Approved action").
 * @param slotsUsed refurbishment slots used by the plan (for the capacity proof line).
 */
export function buildNextBestAction(c: CaseRecord, dec: CaseDecision, ctx: EngineContext, approved: boolean, slotsUsed: number | null): NextBestAction {
  const v = dec.best;
  const std = dec.standard;
  const gain = dec.gainOverStandard;
  const versus =
    std.route === v.route
      ? `matches the ${CHANNEL_SHORT[dec.channel]} standard route`
      : `${gain >= 0 ? '+' : '−'}${usd(Math.abs(gain))} over the ${CHANNEL_SHORT[dec.channel]} standard route (${std.routeName}, ${usd(std.net)})`;
  return {
    caseId: c.id,
    label: approved ? 'Approved action' : 'Next best action',
    headline: headline(v, c),
    summary: `${usd(v.net)} · ${versus} · executes in ${v.executesIn}`,
    net: v.net,
    gainOverStandard: gain,
    steps: v.viable ? steps(v, ctx) : [],
    proof: proof(c, dec, ctx, slotsUsed),
    fallback: dec.runnerUp ? `If this falls through: ${dec.runnerUp.routeName}, ${usd(dec.runnerUp.net)}` : null,
    pill: !v.viable ? 'No viable route' : v.committed ? 'Against named demand' : 'Estimate · no buyer yet',
    planNote: dec.planNote,
  };
}

/** The 7 agent steps (Intake … Follow-through) with plain-language conclusions. */
export function buildAgentTrail(c: CaseRecord, dec: CaseDecision, ctx: EngineContext): AgentStep[] {
  const cc = ctx.contextFor(c);
  const v = dec.best;
  const fit = cc.parts.filter((p) => p.lifePct >= ctx.policy.fitForUseThreshold);
  const named = new Map<string, Demand>();
  for (const r of dec.all) for (const d of r.demands) if (d.kind !== 'recycler_quote') named.set(d.id, d);
  const blocked = dec.all.filter((r) => !r.viable);
  const viable = dec.all.filter((r) => r.viable);
  const namedList = [...named.values()];
  return [
    {
      id: 'intake',
      title: 'Intake',
      status: 'done',
      conclusion: `${CHANNEL_LABEL[cc.intakeChannel]}: ${c.productName}${c.quantity > 1 ? ` (${c.quantity} units)` : ''} for ${c.tenant}, received ${fmtDay(c.receivedDate)} at ${c.location}.`,
    },
    {
      id: 'condition',
      title: 'Condition and life',
      status: c.evidenceCompleteness >= 80 ? 'done' : 'warning',
      conclusion: `Grade ${c.condition}, ${cc.lifePct} % remaining life; ${fit.length} of ${cc.parts.length} parts at or above the ${ctx.policy.fitForUseThreshold} % fit-for-use threshold${c.evidenceCompleteness >= 80 ? '' : `; evidence only ${c.evidenceCompleteness} % complete`}.`,
    },
    {
      id: 'demand',
      title: 'Demand discovery',
      status: namedList.length ? 'done' : 'warning',
      conclusion: namedList.length
        ? `Found ${namedList.length} named demand record${namedList.length === 1 ? '' : 's'}: ${namedList.slice(0, 3).map(demandText).join('; ')}${namedList.length > 3 ? '; …' : ''}.`
        : 'No named demand for this model; resale and parts are priced on market estimates.',
    },
    {
      id: 'fit',
      title: 'Fit for use',
      status: viable.length > 1 ? 'done' : 'warning',
      conclusion: `${viable.length} of ${dec.all.length} routes viable.${blocked[0] ? ` ${blocked[0].routeName}: ${blocked[0].reason}.` : ''}`,
    },
    {
      id: 'valuation',
      title: 'Valuation',
      status: 'done',
      conclusion: `Best ${v.routeName} ${usd(v.net)}${dec.runnerUp ? `; runner-up ${dec.runnerUp.routeName} ${usd(dec.runnerUp.net)}` : ''}; ${CHANNEL_SHORT[dec.channel]} standard route ${dec.standard.routeName} ${usd(dec.standard.net)}.`,
    },
    {
      id: 'decision',
      title: 'Decision',
      status: v.viable ? 'done' : 'warning',
      conclusion: `${dec.override ? `Owner override to ${v.routeName} (${dec.override.reason}).` : `Recommend ${v.routeName} (${dec.gainOverStandard >= 0 ? '+' : '−'}${usd(Math.abs(dec.gainOverStandard))} over the standard route).`}${dec.rulesApplied.length ? ` Rules applied: ${dec.rulesApplied.join(', ')}.` : ''}${dec.planNote ? ` ${dec.planNote}` : ''}`,
    },
    {
      id: 'follow',
      title: 'Follow-through',
      status: 'done',
      conclusion: `Approval by ${v.owner}; executes in ${v.executesIn}; ready ${fmtDay(v.timing.ready)}.`,
    },
  ];
}
