"use client"

/**
 * Eight-quarter trend panels for one institution, shown at the top of the
 * profile drawer. Five small line charts share an x-axis of quarters; each
 * carries the published supervisory thresholds as dashed reference lines so
 * the reader sees distance-to-threshold, not just direction. A capital
 * category strip runs underneath, one cell per quarter.
 *
 * Series with no values in any quarter are omitted from their panel rather
 * than drawn flat at zero, which is what a CBLR filer's risk-based ratios
 * would otherwise look like.
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { CHART_INK, CHART_SERIES, gridProps, numericTick } from "@/lib/chart-theme"
import type { InstitutionTrend, TrendPoint, TrendVerdict } from "@/lib/analytics/institution-trend"
import type { CapitalCategory } from "@/lib/scoring/capital-category"

type SeriesKey = Exclude<keyof TrendPoint, "quarter" | "label" | "capital">

type Series = { key: SeriesKey; name: string }
type Reference = { value: number; label: string; tone?: "warn" | "limit"; labelPosition?: "insideTopRight" | "insideBottomRight" }

type PanelSpec = {
  title: string
  series: Series[]
  references: Reference[]
  /** Lower is worse for capital and earnings; higher is worse for the rest. */
  worseWhen: "higher" | "lower"
  /** Axis unit suffix. */
  unit?: string
  /** Where the y-axis starts; capital and credit panels anchor at zero so a fall reads as a fall. */
  floorAtZero?: boolean
}

const PANELS: PanelSpec[] = [
  {
    title: "Credit quality",
    series: [
      { key: "noncurrentPct", name: "Noncurrent ÷ loans" },
      { key: "nplPct", name: "Nonaccrual ÷ loans" },
    ],
    references: [
      { value: 2, label: "2%", tone: "warn", labelPosition: "insideBottomRight" },
      { value: 5, label: "5%", tone: "limit" },
    ],
    worseWhen: "higher",
    unit: "%",
    floorAtZero: true,
  },
  {
    title: "Capital",
    series: [
      { key: "leveragePct", name: "Leverage ratio" },
      { key: "cet1Pct", name: "CET1 ratio" },
      { key: "totalRbcPct", name: "Total RBC ratio" },
    ],
    references: [
      { value: 5, label: "5% leverage, well", tone: "warn" },
      { value: 4, label: "4% adequate", tone: "limit", labelPosition: "insideBottomRight" },
    ],
    worseWhen: "lower",
    unit: "%",
    floorAtZero: true,
  },
  {
    title: "CRE exposure",
    series: [
      { key: "creToCapitalPct", name: "CRE ÷ (T1+T2)" },
      { key: "constructionToCapitalPct", name: "Construction ÷ (T1+T2)" },
    ],
    references: [
      { value: 300, label: "300% CRE screen", tone: "limit" },
      { value: 100, label: "100% construction screen", tone: "warn", labelPosition: "insideBottomRight" },
    ],
    worseWhen: "higher",
    unit: "%",
    floorAtZero: true,
  },
  {
    title: "Reserves",
    series: [{ key: "reservePct", name: "Allowance ÷ loans" }],
    references: [{ value: 1, label: "1%", tone: "warn" }],
    worseWhen: "lower",
    unit: "%",
    floorAtZero: true,
  },
  {
    title: "Earnings",
    series: [
      { key: "roaPct", name: "ROA" },
      { key: "nimPct", name: "Net interest margin" },
    ],
    references: [{ value: 0, label: "0% ROA", tone: "limit" }],
    worseWhen: "lower",
    unit: "%",
  },
]

const CAPITAL_FILL: Record<CapitalCategory, string> = {
  well: "bg-emerald-500",
  adequate: "bg-amber-400",
  under: "bg-orange-500",
  significant: "bg-red-500",
  critical: "bg-red-800",
}

const CAPITAL_SHORT: Record<CapitalCategory, string> = {
  well: "Well",
  adequate: "Adequate",
  under: "Under",
  significant: "Significant",
  critical: "Critical",
}

const VERDICT_TONE: Record<TrendVerdict["tone"], string> = {
  deteriorating: "border-red-200 bg-red-50 text-red-900",
  watch: "border-amber-200 bg-amber-50 text-amber-900",
  stable: "border-emerald-200 bg-emerald-50 text-emerald-900",
  insufficient: "border-slate-200 bg-slate-50 text-slate-700",
}

const REFERENCE_STROKE = { warn: "#d97706", limit: "#dc2626" } as const

const fmt = (value: number | null | undefined, unit = "%") =>
  value == null ? "—" : `${Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2)}${unit}`

function TrendPanel({ spec, points }: { spec: PanelSpec; points: TrendPoint[] }) {
  const series = spec.series.filter((s) => points.some((p) => p[s.key] != null))
  if (series.length === 0) {
    return (
      <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{spec.title}</p>
        <p className="mt-6 text-center text-xs text-slate-500">Not reported</p>
      </div>
    )
  }

  const values = points.flatMap((p) => series.map((s) => p[s.key]).filter((v): v is number => v != null))
  // Anchor at zero when nothing is negative so a fall reads as a fall;
  // otherwise let recharts choose round ticks. Reference lines extend the
  // domain themselves (`ifOverflow="extendDomain"`).
  const floor: number | "auto" = spec.floorAtZero && Math.min(...values) >= 0 ? 0 : "auto"

  const latest = points[points.length - 1]

  return (
    <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{spec.title}</p>
        <p className="text-[11px] tabular-nums text-slate-500">
          {series.map((s, i) => (
            <span key={s.key} className="ml-2 first:ml-0">
              <span className="inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: CHART_SERIES[i] }} />{" "}
              {fmt(latest?.[s.key], spec.unit)}
            </span>
          ))}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={150} debounce={0}>
        <LineChart data={points} margin={{ top: 10, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ ...numericTick, fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            minTickGap={14}
            tickFormatter={(label: string) => label.replace(/^Q(\d) 20(\d\d)$/, "Q$1'$2")}
          />
          <YAxis
            domain={[floor, "auto"]}
            tickCount={4}
            tick={numericTick}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))}
          />
          <Tooltip
            cursor={{ stroke: CHART_INK.reference, strokeDasharray: "3 3" }}
            contentStyle={{ fontSize: 11, borderRadius: 6, borderColor: CHART_INK.grid, padding: "6px 8px" }}
            labelStyle={{ color: CHART_INK.label, fontWeight: 600 }}
            formatter={(value, name) => [fmt(typeof value === "number" ? value : null, spec.unit), String(name)]}
          />
          {spec.references.map((ref) => (
            <ReferenceLine
              key={ref.label}
              y={ref.value}
              stroke={REFERENCE_STROKE[ref.tone ?? "warn"]}
              strokeDasharray="4 3"
              strokeOpacity={0.7}
              ifOverflow="extendDomain"
              label={{
                value: ref.label,
                position: ref.labelPosition ?? "insideTopRight",
                fontSize: 9,
                fill: REFERENCE_STROKE[ref.tone ?? "warn"],
              }}
            />
          ))}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.name}
              stroke={CHART_SERIES[i]}
              strokeWidth={i === 0 ? 2 : 1.5}
              dot={{ r: 2, strokeWidth: 0, fill: CHART_SERIES[i] }}
              activeDot={{ r: 3.5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-[10px] text-slate-500">
        {series.map((s) => s.name).join(" · ")}
        {" — "}
        {spec.worseWhen === "higher" ? "rising is worse" : "falling is worse"}
      </p>
    </div>
  )
}

function CapitalStrip({ points }: { points: TrendPoint[] }) {
  return (
    <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Capital category by quarter</p>
      <div className="mt-1.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(0, 1fr))` }}>
        {points.map((p) => (
          <div key={p.quarter} className="min-w-0 text-center" title={p.capital?.label ?? "Not reported"}>
            <div className={`h-2.5 rounded-sm ${p.capital ? CAPITAL_FILL[p.capital.category] : "bg-slate-200"}`} />
            <p className="mt-1 truncate text-[10px] tabular-nums text-slate-500">{p.label.replace(/^Q(\d) 20(\d\d)$/, "Q$1'$2")}</p>
            <p className="truncate text-[10px] text-slate-600">{p.capital ? CAPITAL_SHORT[p.capital.category] : "—"}</p>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-slate-500">
        Prompt Corrective Action category from the weakest reported ratio each quarter (12 CFR 324.403).
      </p>
    </div>
  )
}

export type TrendReading = { text: string; source: "model" | "fallback"; note?: string }

/**
 * The analyst reading under the panels. `undefined` while loading, `null`
 * when nothing could be produced. Figures in a model reading have been checked
 * against the table before it reaches here (see institution-trend-narrative).
 */
function AnalystReading({ reading }: { reading: TrendReading | null | undefined }) {
  if (reading === null) return null
  return (
    <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Analyst reading</p>
        {reading && (
          <p className="text-[10px] text-slate-500" title={reading.note}>
            {reading.source === "model" ? "Generated from the eight quarters above; every figure checked against them" : "From the signals above"}
          </p>
        )}
      </div>
      {reading === undefined ? (
        <div className="mt-2 space-y-1.5" aria-busy="true" aria-label="Loading reading">
          <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-11/12 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-slate-100" />
        </div>
      ) : (
        <div className="mt-1.5 space-y-2 text-sm leading-relaxed text-slate-700">
          {reading.text
            .split(/\n{2,}/)
            .map((para) => para.trim())
            .filter(Boolean)
            .map((para, i) => (
              <p key={i}>{para}</p>
            ))}
        </div>
      )}
    </div>
  )
}

export function InstitutionTrendPanels({
  trend,
  reading,
}: {
  trend: InstitutionTrend
  /** Omit to render no reading block; `undefined` shows the loading state. */
  reading?: TrendReading | null
}) {
  const { points, verdict, leverageOnly } = trend
  return (
    <div className="@container space-y-2">
      <div className={`rounded-md border px-3 py-2 ${VERDICT_TONE[verdict.tone]}`}>
        <p className="text-sm">
          <span className="font-semibold">{verdict.heading}.</span> {verdict.text}
        </p>
      </div>
      <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-3">
        {PANELS.map((spec) => (
          <TrendPanel key={spec.title} spec={spec} points={points} />
        ))}
        <CapitalStrip points={points} />
      </div>
      <AnalystReading reading={reading} />
      <p className="text-[11px] text-slate-500">
        Last {points.length} quarter{points.length === 1 ? "" : "s"} of Call Report data for this institution, newest at right.
        {leverageOnly
          ? " This bank files under the Community Bank Leverage Ratio, so it reports no risk-based capital ratios; the capital panel shows leverage only."
          : ""}{" "}
        Dashed lines are the published supervisory thresholds, not peer medians.
      </p>
    </div>
  )
}

export function InstitutionTrendSkeleton() {
  return (
    <div className="@container space-y-2" aria-busy="true" aria-label="Loading trend">
      <div className="h-9 animate-pulse rounded-md bg-slate-100" />
      <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[192px] animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    </div>
  )
}
