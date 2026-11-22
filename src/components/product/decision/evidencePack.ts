/**
 * Evidence pack for a case decision: case, route, net, P10–P90, gates, approval ref, evidence
 * snapshot id, evidence items and calculation lines with their sources. Exported as CSV or
 * opened as a printable page (Print / Save as PDF). Pure builders + two browser actions.
 */
import type {
  ApprovalRecord,
  CaseDecision,
  DecisionInsights,
  InstructionPreview,
} from "@/models/decision.model";
import type { CaseRecord } from "@/models/domain.model";
import { sourceText, usd } from "@/services/decisionService";

export interface PackEvidenceItem {
  label: string;
  source: string;
  status: string;
  reference: string;
  capturedAt: string | null;
}

export interface PackRow {
  section: string;
  item: string;
  value: string;
  source: string;
}

const GATE_WORD = {
  ok: "OK",
  warning: "Warning",
  failed: "Failed",
  na: "Not checked",
} as const;

export function evidencePackRows(
  c: CaseRecord,
  d: CaseDecision,
  ins: DecisionInsights,
  approval: ApprovalRecord | null,
  evidence: PackEvidenceItem[],
  preview: InstructionPreview | null,
): PackRow[] {
  const b = d.best;
  const r = ins.routes[b.route];
  const rows: PackRow[] = [
    {
      section: "Case",
      item: "Case",
      value: `${c.id} · ${c.productName}`,
      source: "Circularity",
    },
    {
      section: "Case",
      item: "Asset",
      value: `${c.manufacturer} ${c.model} · tag ${c.assetTag} · serial ${c.serialNumber}`,
      source: "IBM Maximo EAM",
    },
    {
      section: "Case",
      item: "Site and tenant",
      value: `${c.location} · ${c.tenant}`,
      source: "Manhattan Active WMS",
    },
    {
      section: "Case",
      item: "Condition",
      value: `Grade ${c.condition} · evidence ${c.evidenceCompleteness} % complete`,
      source: "Inspection",
    },
    {
      section: "Decision",
      item: approval ? "Approved route" : "Recommended route",
      value: b.routeName,
      source: `Decision engine ${ins.modelVersion}`,
    },
    {
      section: "Decision",
      item: "Net value",
      value: usd(b.net),
      source: "Value − cost − holding",
    },
    {
      section: "Decision",
      item: "P10–P90",
      value: r.range ? `${usd(r.range.p10)} – ${usd(r.range.p90)}` : "—",
      source: "Line volatility model",
    },
    {
      section: "Decision",
      item: "Status",
      value: `${r.status}${r.statusReason ? `: ${r.statusReason}` : ""}`,
      source: "Eligibility gates",
    },
    {
      section: "Decision",
      item: "Confidence",
      value: ins.confidenceReason,
      source: "Decision engine",
    },
    {
      section: "Decision",
      item: "Cycle time",
      value: `${r.cycleDays} days`,
      source: "Route lead + transfer + settle days",
    },
    {
      section: "Decision",
      item: "Standard route",
      value: `${d.standard.routeName} · ${usd(d.standard.net)}`,
      source: "Intake channel default",
    },
    ...(ins.whyNot
      ? [
          {
            section: "Decision",
            item: `Why not ${ins.whyNot.routeName}`,
            value: ins.whyNot.summary,
            source: "Decision engine",
          },
        ]
      : []),
    {
      section: "Snapshot",
      item: "Evidence snapshot",
      value: approval?.snapshotId ?? ins.snapshotId,
      source: approval ? "Frozen at approval" : "Live (freezes at approval)",
    },
    {
      section: "Snapshot",
      item: "Model version",
      value: approval?.modelVersion ?? ins.modelVersion,
      source: "Policy and published rules",
    },
    {
      section: "Approval",
      item: "Approval reference",
      value: approval
        ? `${approval.ref} · ${approval.actor} · ${approval.at.slice(0, 16).replace("T", " ")} UTC`
        : "Not approved yet",
      source: "Circularity (GR-05)",
    },
    ...r.gates.map((g) => ({
      section: "Gates",
      item: g.name,
      value: `${GATE_WORD[g.status]} · ${g.reason}`,
      source: "Eligibility gates",
    })),
    ...evidence.map((e) => ({
      section: "Evidence",
      item: e.label,
      value: `${e.status} · ${e.reference}${e.capturedAt ? ` · captured ${e.capturedAt}` : ""}`,
      source: e.source,
    })),
    ...b.lines.map((l) => ({
      section: "Calculation",
      item: l.label,
      value: `${l.type === "value" ? "+" : "−"}${usd(l.amount)} · ${l.basis}`,
      source: sourceText(l.sources[0]),
    })),
    ...(preview?.instructions ?? []).map((i) => ({
      section: "Instructions",
      item: `${i.system} · ${i.instruction}`,
      value: `${i.doc} · ${i.owner} · ${i.timeLimit}`,
      source: i.module,
    })),
  ];
  return rows;
}

const csvCell = (s: string) =>
  /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

export function evidencePackCsv(rows: PackRow[]): string {
  return [
    "Section,Item,Value,Source",
    ...rows.map((r) =>
      [r.section, r.item, r.value, r.source].map(csvCell).join(","),
    ),
  ].join("\n");
}

export function downloadEvidencePack(caseId: string, rows: PackRow[]): void {
  const blob = new Blob([`﻿${evidencePackCsv(rows)}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `evidence-pack-${caseId}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Opens the pack as a printable page in a new tab. Returns false when the browser blocked it. */
export function printEvidencePack(caseId: string, rows: PackRow[]): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  const sections = [...new Set(rows.map((r) => r.section))];
  const body = sections
    .map(
      (s) =>
        `<h2>${esc(s)}</h2><table><tbody>${rows
          .filter((r) => r.section === s)
          .map(
            (r) =>
              `<tr><th>${esc(r.item)}</th><td>${esc(r.value)}</td><td class="src">${esc(r.source)}</td></tr>`,
          )
          .join("")}</tbody></table>`,
    )
    .join("");
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Evidence pack ${esc(caseId)}</title><style>body{font:12px/1.45 system-ui,sans-serif;color:#141416;margin:24px}h1{font-size:18px;margin:0 0 4px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748B;margin:18px 0 6px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #E2E8F0;padding:4px 6px;text-align:left;vertical-align:top}th{width:24%}td.src{width:26%;color:#64748B}p{color:#64748B;margin:0}</style></head><body><h1>Evidence pack · ${esc(caseId)}</h1><p>Generated by Circularity. Numbers come from the decision engine; the snapshot id identifies the evidence they rest on.</p>${body}<script>window.onload=function(){window.print()}</script></body></html>`,
  );
  w.document.close();
  return true;
}
