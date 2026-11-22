"use client";

import React from "react";
import { Popover, Select } from "antd";
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  Info,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import {
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type {
  CaseDecision,
  Confidence,
  DecisionInsights,
  GateResult,
  HandoffInstruction,
  InstructionPreview,
  PresetFlip,
  PresetId,
  RouteId,
  RouteStatus,
  ValueRange,
} from "@/models/decision.model";
import {
  compactRange,
  PRESETS,
  RANGE_FORMULA,
  usd,
} from "@/services/decisionService";
import { DISPOSITION_ROUTES } from "@/constants/routes.constants";
import { DataTable, StatusBadge, type DataColumn } from "@/components/ui";
import {
  AXIS_TICK,
  ChartFrame,
  GRID_PROPS,
} from "@/components/charts/chartTheme";
import { chartColors } from "@/theme/tokens";
import { useEntranceAnimation } from "@/hooks/useReducedMotion";
import type { Tone } from "@/theme/tokens";
import { dateTime } from "@/utils/format";

/**
 * Decision insight blocks for the Case page: eligibility gates, route status, confidence,
 * P10–P90 range explanation, instruction preview / hand-off table, why-not, net-vs-cycle
 * chart, compare top 3 and the edge-case preset bar. Every number comes from
 * decisionService (decision/insights.ts); nothing here computes economics.
 */

export const STATUS_TONE: Record<RouteStatus, Tone> = {
  Eligible: "success",
  Conditional: "warning",
  Restricted: "danger",
};
const CONF_TONE: Record<Confidence, Tone> = {
  High: "success",
  Medium: "warning",
  Low: "danger",
};
const linkBtn =
  "inline-flex shrink-0 cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs font-semibold text-[#141416] underline-offset-2 hover:underline";

export function RouteStatusBadge({
  status,
  reason,
}: {
  status: RouteStatus;
  reason?: string | null;
}) {
  return (
    <span
      data-tip={reason ?? undefined}
      tabIndex={reason ? 0 : undefined}
      className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-[#141416]"
    >
      <StatusBadge tone={STATUS_TONE[status]} icon={false}>
        {status}
      </StatusBadge>
    </span>
  );
}

export function ConfidenceBadge({
  confidence,
  reason,
}: {
  confidence: Confidence;
  reason: string;
}) {
  return (
    <span
      data-tip={reason}
      tabIndex={0}
      className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-[#141416]"
    >
      <StatusBadge tone={CONF_TONE[confidence]}>
        {confidence} confidence
      </StatusBadge>
    </span>
  );
}

/* ------------------------------------------------------------------ gates */

const GATE_ICON: Record<GateResult["status"], React.ReactNode> = {
  ok: <CircleCheck size={13} className="shrink-0 text-[#059669]" aria-hidden />,
  warning: (
    <TriangleAlert size={13} className="shrink-0 text-[#D97706]" aria-hidden />
  ),
  failed: (
    <CircleAlert size={13} className="shrink-0 text-[#DC2626]" aria-hidden />
  ),
  na: <CircleMinus size={13} className="shrink-0 text-[#94A3B8]" aria-hidden />,
};
const GATE_WORD: Record<GateResult["status"], string> = {
  ok: "OK",
  warning: "Warning",
  failed: "Failed",
  na: "Not checked",
};

const GATE_RANK: Record<GateResult["status"], number> = {
  failed: 0,
  warning: 1,
  na: 2,
  ok: 3,
};

/**
 * Eligibility gates. All passed: one line "All 6 checks passed" (hover for the list, click to
 * expand). Otherwise the warning / failed gates come first as chips, then the passed ones.
 */
export function GateChips({
  gates,
  label = "Eligibility gates",
}: {
  gates: GateResult[];
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const passed = gates.filter((g) => g.status === "ok").length;
  const allOk = passed === gates.length;
  const sorted = [...gates].sort(
    (a, b) => GATE_RANK[a.status] - GATE_RANK[b.status],
  );
  if (allOk && !open) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 className="m-0 text-[11px] font-bold uppercase tracking-wider text-[#475569]">
          {label}
        </h3>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          data-tip={gates.map((g) => `${g.name}: ${g.reason}`).join(" · ")}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#047857] hover:border-gray-400"
        >
          <CircleCheck
            size={13}
            className="shrink-0 text-[#059669]"
            aria-hidden
          />
          All {gates.length} checks passed
        </button>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <h3 className="m-0 mb-1.5 flex flex-wrap items-baseline gap-x-1 text-[11px] font-bold uppercase tracking-wider text-[#475569]">
        {label}{" "}
        <span className="font-mono font-semibold normal-case tracking-normal text-[#64748B]">
          · {passed} of {gates.length} OK
        </span>
        {allOk && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded
            className="ml-1 cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold normal-case tracking-normal text-[#64748B] hover:text-[#141416]"
          >
            Collapse
          </button>
        )}
      </h3>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {sorted.map((g) => (
          <li key={g.id}>
            <span
              tabIndex={0}
              data-tip={`${g.name}: ${GATE_WORD[g.status]}. ${g.reason}`}
              aria-label={`${g.name}: ${GATE_WORD[g.status]}. ${g.reason}`}
              className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#334155] focus-visible:outline-2 focus-visible:outline-[#141416]"
            >
              {GATE_ICON[g.status]}
              {g.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Full gate list (Approve modal, approval record). */
export function GateList({ gates }: { gates: GateResult[] }) {
  return (
    <ul className="m-0 list-none space-y-1 p-0">
      {gates.map((g) => (
        <li key={g.id} className="flex min-w-0 gap-2 text-xs">
          <span className="mt-px">{GATE_ICON[g.status]}</span>
          <span className="min-w-0 break-words text-[#334155]">
            <strong className="text-[#0F172A]">{g.name}</strong> ·{" "}
            {GATE_WORD[g.status]} · {g.reason}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ range */

/** "P10–P90 $8,500–$11,900" with a "How the range is calculated" popover. */
export function RangeLine({
  range,
  className = "",
}: {
  range: ValueRange;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] text-[#475569] ${className}`}
    >
      <span>
        P10–P90{" "}
        <span className="font-mono font-semibold text-[#0F172A]">
          {usd(range.p10)}–{usd(range.p90)}
        </span>
      </span>
      <RangeHow range={range} />
    </span>
  );
}

export function RangeHow({ range }: { range: ValueRange }) {
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      content={
        <div className="w-[min(340px,calc(100vw-48px))] text-xs text-[#141416]">
          <div className="text-sm font-extrabold">
            How the range is calculated
          </div>
          <p className="m-0 mt-1.5 leading-relaxed text-[#475569]">
            {RANGE_FORMULA}
          </p>
          {range.drivers.length > 0 && (
            <>
              <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                What drives the spread
              </div>
              <ul className="m-0 mt-1 list-none divide-y divide-[#F1F5F9] p-0">
                {range.drivers.map((d) => (
                  <li
                    key={d.label}
                    className="flex items-center justify-between gap-3 py-1.5"
                  >
                    <span className="min-w-0 truncate">{d.label}</span>
                    <span className="shrink-0 font-mono text-[#475569]">
                      ±{Math.round(d.volatility * 100)} % ·{" "}
                      {Math.round(d.share * 100)} % of spread
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      }
    >
      <button
        type="button"
        aria-label="How the range is calculated"
        className="inline-flex cursor-pointer items-center border-none bg-transparent p-0 text-[#64748B] hover:text-[#141416]"
      >
        <Info size={13} aria-hidden />
      </button>
    </Popover>
  );
}

export { compactRange };

/* ------------------------------------------------------------------ instructions */

const HANDOFF_TONE: Record<
  HandoffInstruction["status"],
  { label: string; tone: Tone }
> = {
  not_sent: { label: "Not sent · sent only after approval", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  acknowledged: { label: "Acknowledged", tone: "brand" },
  done: { label: "Done", tone: "success" },
};

type Row =
  | HandoffInstruction
  | (InstructionPreview["instructions"][number] & { status?: undefined });

/** Instruction preview (before approval) or hand-off table (after approval, with due time and overdue). */
export function InstructionTable({
  rows,
  showDue,
  renderAction,
}: {
  rows: Row[];
  showDue?: boolean;
  /** Per-step actions after approval (simulated system events, Resend). */
  renderAction?: (row: HandoffInstruction) => React.ReactNode;
}) {
  const columns: DataColumn<Row>[] = [
    {
      key: "system",
      title: "Target system",
      priority: 1,
      width: "22%",
      render: (_, r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-[#0F172A]">
            {r.system}
          </div>
          <div className="truncate text-[11px] text-[#64748B]">{r.module}</div>
        </div>
      ),
    },
    {
      key: "instruction",
      title: "Instruction",
      priority: 1,
      render: (_, r) => (
        <div className="min-w-0">
          <div className="line-clamp-2 font-semibold text-[#0F172A]">
            {r.instruction}
          </div>
          <div className="line-clamp-2 text-[11px] text-[#64748B]">
            {r.detail}
          </div>
        </div>
      ),
    },
    {
      key: "doc",
      title: "Document ref",
      priority: 2,
      width: "14%",
      render: (_, r) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[#0F172A]">{r.doc}</div>
          {r.docNew && r.status === undefined && (
            <div className="text-[11px] text-[#64748B]">to be created</div>
          )}
          {r.docNew && r.status !== undefined && r.status !== "not_sent" && (
            <div className="text-[11px] text-[#64748B]">created</div>
          )}
        </div>
      ),
    },
    {
      key: "owner",
      title: "Owner",
      priority: 3,
      width: "18%",
      render: (_, r) => (
        <span className="line-clamp-2 text-[#334155]">{r.owner}</span>
      ),
    },
    {
      key: "limit",
      title: "Time limit",
      priority: 2,
      width: "11%",
      render: (_, r) => (
        <span className="whitespace-nowrap font-mono text-[#334155]">
          {r.timeLimit}
        </span>
      ),
    },
    {
      key: "status",
      title: showDue ? "Status · due" : "Status",
      priority: 1,
      width: showDue ? "19%" : "17%",
      render: (_, r) => {
        const s = r.status ?? "not_sent";
        const h = r.status !== undefined ? (r as HandoffInstruction) : null;
        return (
          <div className="min-w-0 space-y-0.5">
            {h?.overdue ? (
              <StatusBadge tone="danger">
                Overdue {h.overdueHours} working h
              </StatusBadge>
            ) : (
              <span className="inline-flex max-w-full">
                <StatusBadge
                  tone={HANDOFF_TONE[s].tone}
                  icon={s !== "not_sent"}
                  className="!whitespace-normal"
                >
                  {HANDOFF_TONE[s].label}
                </StatusBadge>
              </span>
            )}
            {showDue && h?.dueAt && (
              <div className="font-mono text-[11px] text-[#64748B]">
                due {dateTime(h.dueAt)}
              </div>
            )}
            {!!h?.resends && (
              <div className="text-[11px] text-[#64748B]">
                Resent {h.resends}× · last{" "}
                <span className="font-mono">{dateTime(h.lastSentAt ?? "")}</span>
              </div>
            )}
          </div>
        );
      },
    },
    ...(renderAction
      ? [
          {
            key: "action",
            title: "Action",
            priority: 1 as const,
            align: "right" as const,
            width: "17%",
            render: (_: unknown, r: Row) =>
              r.status !== undefined ? renderAction(r as HandoffInstruction) : null,
          },
        ]
      : []),
  ];
  return (
    <DataTable<Row>
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={rows}
      pagination={false}
      emptyTitle="No instructions"
    />
  );
}

/* ------------------------------------------------------------------ why not + chart + compare */

export function WhyNotPanel({ insights }: { insights: DecisionInsights }) {
  const w = insights.whyNot;
  if (!w)
    return (
      <p className="m-0 text-xs text-[#64748B]">
        There is no other eligible route to compare with.
      </p>
    );
  return (
    <div className="space-y-2 text-xs">
      <p className="m-0 text-[#334155]">{w.summary}</p>
      <ul className="m-0 list-none space-y-1 p-0">
        {w.constraints.map((k) => (
          <li key={k.label} className="flex min-w-0 gap-2">
            {k.favoursBest ? (
              <CircleCheck
                size={14}
                className="mt-px shrink-0 text-[#059669]"
                aria-label="Favours the recommendation"
              />
            ) : (
              <CircleMinus
                size={14}
                className="mt-px shrink-0 text-[#94A3B8]"
                aria-label="Does not favour the recommendation"
              />
            )}
            <span className="min-w-0 break-words text-[#334155]">
              <strong className="text-[#0F172A]">{k.label}.</strong> {k.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const kUsd = (v: number) => {
  const a = Math.abs(v);
  const s =
    a >= 1000
      ? `$${(a / 1000).toFixed(a >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`
      : `$${Math.round(a)}`;
  return v < 0 ? `−${s}` : s;
};

interface Pt {
  route: RouteId;
  name: string;
  x: number;
  y: number;
  range: string;
  status: RouteStatus;
}

function PointTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: Pt }[];
}) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="min-w-[170px] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-[0_4px_16px_rgba(24,25,27,0.08)]">
      <div className="mb-1 font-medium text-ink">{p.name}</div>
      <div className="flex justify-between gap-4">
        <span className="text-ink-2">Net</span>
        <span className="tabular font-medium text-ink">{usd(p.y)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-ink-2">P10–P90</span>
        <span className="tabular font-medium text-ink">{p.range}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-ink-2">Cycle time</span>
        <span className="tabular font-medium text-ink">{p.x} days</span>
      </div>
      <div className="mt-1 text-ink-2">{p.status}</div>
    </div>
  );
}

/**
 * Net value vs cycle time of every eligible (viable) route. The recommendation (yellow diamond),
 * runner-up and third are labelled on the chart; other eligible routes are muted grey dots.
 */
export function RouteValueChart({
  decision,
  insights,
}: {
  decision: CaseDecision;
  insights: DecisionInsights;
}) {
  const animate = useEntranceAnimation();
  const viable = decision.all.filter((r) => r.viable);
  const others = viable
    .filter((r) => r.route !== decision.best.route)
    .sort((a, b) => b.net - a.net);
  const labelled = new Map<RouteId, string>([
    [decision.best.route, "recommended"],
    ...others
      .slice(0, 2)
      .map(
        (r, i) =>
          [r.route, i === 0 ? "runner-up" : "third"] as [RouteId, string],
      ),
  ]);
  const pts: (Pt & { tag: string | null; short: string })[] = viable.map(
    (r) => {
      const i = insights.routes[r.route];
      const tag = labelled.get(r.route) ?? null;
      return {
        route: r.route,
        name: r.routeName,
        x: i.cycleDays,
        y: r.net,
        range: i.range ? compactRange(i.range) : "—",
        status: i.status,
        tag,
        short: tag ? DISPOSITION_ROUTES[r.route].shortLabel : "",
      };
    },
  );
  if (pts.length < 2)
    return (
      <p className="m-0 text-xs text-[#64748B]">
        Only one eligible route, nothing to compare.
      </p>
    );
  const xs = pts.map((p) => p.x);
  const label = `Net value against cycle time for ${pts.length} eligible routes. ${pts.map((p) => `${p.name}${p.tag ? ` (${p.tag})` : ""}: ${usd(p.y)}, ${p.x} days`).join("; ")}.`;
  return (
    <div className="flex flex-col gap-1.5">
      <ChartFrame label={label} height={220}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 16, bottom: 16, left: 4 }}>
            <CartesianGrid {...GRID_PROPS} vertical />
            <XAxis
              type="number"
              dataKey="x"
              name="Cycle time"
              domain={[Math.max(0, Math.min(...xs) - 2), Math.max(...xs) + 3]}
              allowDecimals={false}
              tick={AXIS_TICK}
              axisLine={{ stroke: chartColors.grid }}
              tickLine={false}
              label={{
                value: "Cycle time (days)",
                position: "insideBottom",
                offset: -10,
                fill: "var(--ink-2)",
                fontSize: 11,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="Net"
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={kUsd}
            />
            <ZAxis type="number" dataKey="z" range={[64, 64]} />
            <Tooltip
              cursor={{ stroke: chartColors.axis, strokeDasharray: "3 3" }}
              content={<PointTip />}
              isAnimationActive={false}
            />
            {pts.map((p) => {
              const isBest = p.route === decision.best.route;
              return (
                <Scatter
                  key={p.route}
                  name={p.name}
                  data={[{ ...p, z: 1 }]}
                  fill={isBest ? "#FFD600" : p.tag ? "#475569" : "#CBD5E1"}
                  stroke={isBest ? "#141416" : p.tag ? "#475569" : "#94A3B8"}
                  strokeWidth={isBest ? 1.5 : 0.75}
                  shape={isBest ? "diamond" : "circle"}
                  isAnimationActive={animate}
                >
                  {p.tag && (
                    <LabelList
                      dataKey="short"
                      position="right"
                      offset={8}
                      style={{
                        fontSize: 11,
                        fontWeight: isBest ? 700 : 500,
                        fill: "#334155",
                      }}
                    />
                  )}
                </Scatter>
              );
            })}
          </ScatterChart>
        </ResponsiveContainer>
      </ChartFrame>
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#64748B]">
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rotate-45 border border-[#141416] bg-[#FFD600]"
          />{" "}
          Recommended
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#475569]" />{" "}
          Runner-up and third
        </span>
        {pts.length > 3 && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full bg-[#CBD5E1]"
            />{" "}
            Other eligible routes (hover for names)
          </span>
        )}
      </p>
    </div>
  );
}

/** Side-by-side of the top 3 eligible routes: net, range, cycle time, gate status. */
export function CompareTop3({
  decision,
  insights,
}: {
  decision: CaseDecision;
  insights: DecisionInsights;
}) {
  const top = decision.all.filter((r) => r.viable).slice(0, 3);
  if (!top.length)
    return <p className="m-0 text-xs text-[#64748B]">No eligible route.</p>;
  const rows: {
    label: string;
    cell: (r: (typeof top)[number]) => React.ReactNode;
    numeric?: boolean;
  }[] = [
    {
      label: "Net",
      numeric: true,
      cell: (r) => <span className="font-extrabold">{usd(r.net)}</span>,
    },
    {
      label: "P10–P90",
      numeric: true,
      cell: (r) =>
        insights.routes[r.route].range
          ? compactRange(insights.routes[r.route].range as ValueRange)
          : "—",
    },
    {
      label: "Cycle time",
      numeric: true,
      cell: (r) => `${insights.routes[r.route].cycleDays} days`,
    },
    {
      label: "Gates",
      cell: (r) => (
        <RouteStatusBadge
          status={insights.routes[r.route].status}
          reason={insights.routes[r.route].statusReason}
        />
      ),
    },
    {
      label: "Demand",
      cell: (r) => (
        <span className="line-clamp-2">
          {r.demand
            ? r.demand.id
            : r.route === "exit"
              ? "Not needed"
              : "Forecast"}
        </span>
      ),
    },
  ];
  return (
    <table className="w-full table-fixed border-collapse text-xs">
      <caption className="sr-only">
        Top {top.length} eligible routes side by side
      </caption>
      <thead>
        <tr className="border-b border-[#E2E8F0]">
          <th
            scope="col"
            className="w-24 pb-2 text-left text-[11px] font-bold uppercase tracking-wider text-[#64748B]"
          >
            <span className="sr-only">Measure</span>
          </th>
          {top.map((r) => (
            <th
              key={r.route}
              scope="col"
              className="pb-2 pl-2 text-right align-bottom"
            >
              <span className="inline-flex max-w-full items-center justify-end gap-1.5 text-[11px] font-bold text-[#0F172A]">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
                  style={{ backgroundColor: DISPOSITION_ROUTES[r.route].color }}
                />
                <span className="truncate">
                  {DISPOSITION_ROUTES[r.route].shortLabel}
                </span>
              </span>
              {r.route === decision.best.route && (
                <div className="text-[10px] font-semibold text-[#64748B]">
                  recommended
                </div>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-[#F1F5F9]">
            <th
              scope="row"
              className="py-1.5 text-left font-semibold text-[#475569]"
            >
              {row.label}
            </th>
            {top.map((r) => (
              <td
                key={r.route}
                className={`py-1.5 pl-2 text-right ${row.numeric ? "font-mono" : ""}`}
              >
                {row.cell(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ presets */

export function PresetBar({
  preset,
  applyTo,
  routes,
  onPreset,
  onApplyTo,
  onReset,
  flips,
  activeNote,
}: {
  preset: PresetId | null;
  applyTo: "all" | RouteId;
  routes: { route: RouteId; routeName: string }[];
  onPreset: (p: PresetId | null) => void;
  onApplyTo: (a: "all" | RouteId) => void;
  onReset: () => void;
  flips: PresetFlip[];
  /** Result of the active preset ("Ranking flips: …" or "doesn't change the ranking"). */
  activeNote: React.ReactNode;
}) {
  const flipping = flips.filter((f) => f.flips);
  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-[#0F172A]">
          Edge cases{" "}
          {flipping.length > 0 && (
            <span className="font-normal text-[#64748B]">
              · &quot;Flips&quot; = changes the recommended route
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[#475569]">
            Apply to
            <Select<string>
              size="small"
              value={applyTo}
              onChange={(v) => onApplyTo(v as "all" | RouteId)}
              className="w-44"
              aria-label="Apply the edge case to"
              options={[
                { value: "all", label: "All routes" },
                ...routes.map((r) => ({
                  value: r.route,
                  label: `Only ${r.routeName}`,
                })),
              ]}
            />
          </label>
          {preset && (
            <button type="button" onClick={onReset} className={linkBtn}>
              <RotateCcw size={13} aria-hidden /> Reset
            </button>
          )}
        </div>
      </div>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Edge-case presets"
      >
        {PRESETS.map((p) => {
          const on = preset === p.id;
          const flip = flips.find((f) => f.preset === p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => onPreset(on ? null : p.id)}
              data-tip={`${p.description}${flip?.flips ? ` ${flip.text}` : ""}`}
              className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold shadow-2xs ${
                on
                  ? "border-[#141416] bg-[#141416] text-white"
                  : "border-[#E2E8F0] bg-white text-[#141416] hover:border-gray-400"
              }`}
            >
              {p.label}
              {flip?.flips && (
                <span
                  className={`rounded px-1 py-px text-[10px] font-bold uppercase tracking-wide ${on ? "bg-[#FFD600] text-[#141416]" : "bg-[#FEF3C7] text-[#92400E]"}`}
                >
                  Flips
                </span>
              )}
            </button>
          );
        })}
      </div>
      {activeNote}
      <div className="rounded-lg bg-[#F8FAFC] px-3 py-2 text-[#475569]">
        {flipping.length ? (
          <>
            <strong className="text-[#0F172A]">Ranking flips if:</strong>{" "}
            {flipping.map((f, i) => (
              <span key={f.preset}>
                {i > 0 && "; "}
                {f.label.charAt(0).toLowerCase() + f.label.slice(1)} (→{" "}
                {f.toName ?? "no viable route"}
                {f.toNet !== null ? `, ${usd(f.toNet)}` : ""})
              </span>
            ))}
            .
          </>
        ) : (
          <>
            <strong className="text-[#0F172A]">Robust:</strong> none of the{" "}
            {flips.length} edge cases changes the recommended route.
          </>
        )}
      </div>
    </div>
  );
}
