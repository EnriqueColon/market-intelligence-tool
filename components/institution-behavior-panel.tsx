"use client"

/**
 * Balance-Sheet Actions for one institution, shown in the profile drawer
 * under the eight-quarter trend. What the bank is doing about its CRE book:
 * the seven behaviour signals for the newest quarter, held-for-sale / OREO /
 * modification balances over the quarters on file, the CRE nonaccrual
 * roll-forward as a waterfall and as a table, charge-offs and loan-sale
 * results, and a reading built from those figures.
 *
 * Signals are judged on the bank's own history and absolute floors, never on
 * peers, so this panel reads the same whichever scope the tab is in.
 */

import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { CHART_INK, CHART_SERIES, gridProps, numericTick } from "@/lib/chart-theme"
import { SIGNALS, type RollForwardStep } from "@/lib/analytics/bank-behavior-signals"
import { money, type BehaviorPanelPoint, type InstitutionBehavior, type QuarterSignals } from "@/lib/analytics/bank-behavior-panel"

const shortQ = (label: string) => label.replace(/^Q(\d) 20(\d\d)$/, "Q$1'$2")
const millions = (thousands: number | null | undefined) => (thousands == null ? null : thousands / 1000)
const fmtM = (v: number | null | undefined) => (v == null ? "—" : money(v))
const fmtK = (v: number | null) => (v === null ? "—" : v === 0 ? "0" : v.toLocaleString("en-US"))

const TOOLTIP_STYLE = {
  contentStyle: { fontSize: 11, borderRadius: 6, borderColor: CHART_INK.grid, padding: "6px 8px" },
  labelStyle: { color: CHART_INK.label, fontWeight: 600 },
  cursor: { stroke: CHART_INK.reference, strokeDasharray: "3 3" },
} as const

const ACTION_FIRED = "border-red-200 bg-red-50 text-red-900"
const PRESSURE_FIRED = "border-amber-200 bg-amber-50 text-amber-900"
const QUIET = "border-slate-200 bg-white text-slate-500"
const UNJUDGED = "border-dashed border-slate-300 bg-slate-50 text-slate-400"

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{title}</p>
        {right ? <div className="shrink-0 whitespace-nowrap">{right}</div> : null}
      </div>
      {children}
    </div>
  )
}

function SignalChips({ latest, label }: { latest: InstitutionBehavior["latest"]; label: string }) {
  if (!latest) {
    return <p className="text-xs text-slate-500">Signals need two quarters on file; this institution has one.</p>
  }
  const fired = new Set(latest.fired)
  const unjudged = new Set(latest.unjudged)
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {SIGNALS.map((s) => {
          const tone = unjudged.has(s.key) ? UNJUDGED : fired.has(s.key) ? (s.side === "action" ? ACTION_FIRED : PRESSURE_FIRED) : QUIET
          return (
            <span
              key={s.key}
              title={`${s.meaning}. Fires when: ${s.rule}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${fired.has(s.key) && !unjudged.has(s.key) ? "bg-current" : "bg-transparent ring-1 ring-current"}`} />
              {s.label}
              {unjudged.has(s.key) ? <span className="opacity-70">· not judged</span> : null}
            </span>
          )
        })}
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        {label}: {latest.actionCount} action signal{latest.actionCount === 1 ? "" : "s"}, {latest.pressureCount} pressure. Red is action (the bank is moving loans off its book), amber is pressure
        (it is deferring). Hover a chip for the rule.
      </p>
    </div>
  )
}

function BalancesPanel({ points }: { points: BehaviorPanelPoint[] }) {
  const data = points.map((p) => ({
    label: p.label,
    hfs: millions(p.heldForSale),
    oreo: millions(p.oreoCre),
    mods: millions(p.modificationsCre),
  }))
  const latest = points[points.length - 1]
  const series = [
    { key: "hfs", name: "Held for sale (all loans)", has: points.some((p) => p.heldForSale != null) },
    { key: "oreo", name: "CRE OREO", has: points.some((p) => p.oreoCre != null) },
    { key: "mods", name: "CRE modifications", has: points.some((p) => p.modificationsCre != null) },
  ].filter((s) => s.has)
  return (
    <Panel
      title="Held for sale, OREO, modifications"
      right={
        <p className="text-[11px] tabular-nums text-slate-500">
          {fmtM(latest?.heldForSale)} · {fmtM(latest?.oreoCre)} · {fmtM(latest?.modificationsCre)}
        </p>
      }
    >
      {series.length === 0 ? (
        <p className="mt-6 text-center text-xs text-slate-500">Not reported</p>
      ) : (
        <ResponsiveContainer width="100%" height={150} debounce={0}>
          <LineChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -14 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="label" tick={{ ...numericTick, fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={14} tickFormatter={shortQ} />
            <YAxis tickCount={4} tick={numericTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v.toFixed(v >= 100 ? 0 : 1)}`} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(value, name) => [typeof value === "number" ? money(value * 1000) : "—", String(name)]} />
            {series.map((s, i) => (
              <Line key={s.key} type="linear" dataKey={s.key} name={s.name} stroke={CHART_SERIES[i]} strokeWidth={i === 0 ? 2 : 1.5} dot={{ r: 2, strokeWidth: 0, fill: CHART_SERIES[i] }} activeDot={{ r: 3.5 }} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      <p className="mt-1 text-[10px] text-slate-500">$ millions. {series.map((s) => s.name).join(" · ")} — a rise in held-for-sale is the clearest sign a sale is coming.</p>
    </Panel>
  )
}

function RollForwardPanel({ steps }: { steps: RollForwardStep[] }) {
  const data = steps.map((s) => ({
    label: s.label,
    chargeOffs: millions(s.chargeOffs),
    oreo: millions(s.oreoTransferProxy),
    unexplained: millions(s.unexplainedExit),
    nonaccrual: millions(s.currentNonaccrual),
  }))
  const any = steps.some((s) => s.unexplainedExit !== null || s.chargeOffs !== null)
  return (
    <Panel title="CRE nonaccrual: where it went">
      {!any ? (
        <p className="mt-6 text-center text-xs text-slate-500">Not reported</p>
      ) : (
        <ResponsiveContainer width="100%" height={150} debounce={0}>
          <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -14 }} stackOffset="sign">
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="label" tick={{ ...numericTick, fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={14} tickFormatter={shortQ} />
            <YAxis tickCount={4} tick={numericTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}`} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(value, name) => [typeof value === "number" ? money(value * 1000) : "—", String(name)]} />
            <ReferenceLine y={0} stroke={CHART_INK.reference} />
            <Bar dataKey="chargeOffs" name="Charged off" stackId="out" fill={CHART_SERIES[2]} isAnimationActive={false} />
            <Bar dataKey="oreo" name="To OREO (proxy)" stackId="out" fill={CHART_SERIES[3]} isAnimationActive={false} />
            <Bar dataKey="unexplained" name="Unexplained exit (derived)" stackId="out" fill="#dc2626" fillOpacity={0.75} isAnimationActive={false} />
            <Line type="linear" dataKey="nonaccrual" name="CRE nonaccrual, end of quarter" stroke={CHART_SERIES[0]} strokeWidth={2} dot={{ r: 2, strokeWidth: 0, fill: CHART_SERIES[0] }} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
      <p className="mt-1 text-[10px] text-slate-500">
        $ millions. Bars are the quarter&apos;s outflows from CRE nonaccrual; the red bar is what charge-offs and foreclosure do not explain. Below zero means nonaccruals grew by more than the prior 90-day past-dues predicted.
      </p>
    </Panel>
  )
}

function FlowsPanel({ points }: { points: BehaviorPanelPoint[] }) {
  const data = points.map((p) => ({ label: p.label, nco: millions(p.netChargeOffsCreQ), sales: millions(p.loanSaleGainQ) }))
  const any = points.some((p) => p.netChargeOffsCreQ != null || p.loanSaleGainQ != null)
  const latest = points[points.length - 1]
  return (
    <Panel
      title="CRE net charge-offs and loan-sale results"
      right={
        <p className="text-[11px] tabular-nums text-slate-500">
          {fmtM(latest?.netChargeOffsCreQ)} · {fmtM(latest?.loanSaleGainQ)}
        </p>
      }
    >
      {!any ? (
        <p className="mt-6 text-center text-xs text-slate-500">Not reported</p>
      ) : (
        <ResponsiveContainer width="100%" height={150} debounce={0}>
          <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -14 }} barGap={1}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="label" tick={{ ...numericTick, fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={14} tickFormatter={shortQ} />
            <YAxis tickCount={4} tick={numericTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}`} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(value, name) => [typeof value === "number" ? money(value * 1000) : "—", String(name)]} />
            <ReferenceLine y={0} stroke={CHART_INK.reference} />
            <Bar dataKey="nco" name="CRE net charge-offs, quarter" fill={CHART_SERIES[0]} isAnimationActive={false} />
            <Bar dataKey="sales" name="Net gain (loss) on loan sales, quarter" fill="#d97706" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
      <p className="mt-1 text-[10px] text-slate-500">$ millions. Charge-offs are the reported quarter nets (RI-B); a loss on loan sales (RI 5.i) is a discount trade.</p>
    </Panel>
  )
}

function SignalStrip({ byQuarter }: { byQuarter: QuarterSignals[] }) {
  if (byQuarter.length === 0) return null
  return (
    <Panel title="Signals by quarter">
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr>
              <th className="w-28 text-left font-normal text-slate-500"></th>
              {byQuarter.map((q) => (
                <th key={q.quarter} className="px-0.5 text-center font-normal tabular-nums text-slate-500">
                  {shortQ(q.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SIGNALS.map((s) => (
              <tr key={s.key}>
                <td className="truncate pr-1 text-slate-600" title={s.rule}>
                  {s.label}
                </td>
                {byQuarter.map((q) => {
                  const fired = q.fired.includes(s.key)
                  const unjudged = q.unjudged.includes(s.key)
                  return (
                    <td key={q.quarter} className="px-0.5 py-0.5 text-center" title={unjudged ? "Not judged: an input is not reported" : fired ? "Fired" : "Did not fire"}>
                      <span
                        className={`mx-auto block h-2.5 w-2.5 rounded-sm ${
                          unjudged ? "bg-slate-100" : fired ? (s.side === "action" ? "bg-red-500" : "bg-amber-400") : "bg-slate-200"
                        }`}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[10px] text-slate-500">Filled is fired; light grey is not judged because an input was not reported that quarter.</p>
    </Panel>
  )
}

function RollForwardTable({ steps, byCategory }: { steps: RollForwardStep[]; byCategory: InstitutionBehavior["latestByCategory"] }) {
  if (steps.length === 0) return null
  return (
    <Panel title="CRE nonaccrual roll-forward, $ thousands">
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead className="text-slate-500">
            <tr className="[&>th]:px-1 [&>th]:py-0.5 [&>th]:text-right [&>th]:font-normal">
              <th className="!text-left">Quarter</th>
              <th>Prior nonaccrual</th>
              <th>+ Prior 90+ PD</th>
              <th>− Current</th>
              <th>− Charged off</th>
              <th>− To OREO</th>
              <th>= Unexplained</th>
              <th>% of CRE</th>
            </tr>
          </thead>
          <tbody className="text-slate-700">
            {steps.map((s) => (
              <tr key={s.quarter} className="border-t border-slate-100 [&>td]:px-1 [&>td]:py-0.5 [&>td]:text-right">
                <td className="!text-left">{s.label}</td>
                <td>{fmtK(s.priorNonaccrual)}</td>
                <td>{fmtK(s.newNonaccrualProxy)}</td>
                <td>{fmtK(s.currentNonaccrual)}</td>
                <td>{fmtK(s.chargeOffs)}</td>
                <td>{fmtK(s.oreoTransferProxy)}</td>
                <td className={s.unexplainedExit !== null && s.unexplainedExit > 0 ? "font-semibold text-red-700" : ""}>{fmtK(s.unexplainedExit)}</td>
                <td>{s.unexplainedExitPctOfCre === null ? "—" : `${s.unexplainedExitPctOfCre.toFixed(2)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[10px] text-slate-500">
        Latest quarter by category — {byCategory.map((c) => `${c.label}: ${c.step?.unexplainedExit === null || c.step === null ? "—" : fmtK(c.step.unexplainedExit)}`).join(" · ")}.
        Derived: new nonaccrual is proxied by the prior quarter&apos;s 90+ past due, transfers to OREO by the rise in the OREO balance, and quarterly charge-offs by differencing the year-to-date figure. Cures and payoffs land in the residual too.
      </p>
    </Panel>
  )
}

export function InstitutionBehaviorPanel({ behavior }: { behavior: InstitutionBehavior }) {
  const latestLabel = behavior.points[behavior.points.length - 1]?.label ?? "Latest quarter"
  return (
    <div className="@container space-y-2">
      <SignalChips latest={behavior.latest} label={latestLabel} />
      <div className="grid gap-2 @xl:grid-cols-2">
        <BalancesPanel points={behavior.points} />
        <RollForwardPanel steps={behavior.rollForward} />
        <FlowsPanel points={behavior.points} />
        <SignalStrip byQuarter={behavior.signalsByQuarter} />
      </div>
      <RollForwardTable steps={behavior.rollForward} byCategory={behavior.latestByCategory} />
      <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Actions reading</p>
          <p className="text-[10px] text-slate-500">Built from the figures above; no model</p>
        </div>
        <div className="mt-1.5 space-y-2 text-sm leading-relaxed text-slate-700">
          {behavior.reading.text
            .split(/\n{2,}/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        Last {behavior.points.length} quarter{behavior.points.length === 1 ? "" : "s"} of Call Report behaviour fields (RC 4.a, RI 5.i, RI-B, RC-M 3, RC-N, RC-C M.1), newest at right. Signals compare each quarter with the bank&apos;s own history and
        published floors, not with peers. Enforcement actions and public filings are not yet part of this panel.
      </p>
    </div>
  )
}

export function InstitutionBehaviorSkeleton() {
  return (
    <div className="@container space-y-2" aria-busy="true" aria-label="Loading balance-sheet actions">
      <div className="h-7 animate-pulse rounded-md bg-slate-100" />
      <div className="grid gap-2 @xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[192px] animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-md bg-slate-100" />
    </div>
  )
}
