"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, Search, ShieldCheck } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  getWorkbenchUniverse,
  type WorkbenchRow,
  type WorkbenchUniverse,
} from "@/app/actions/underwriter-workbench"
import { analyseInstitution, type WorkbenchAnalysis } from "@/lib/scoring/workbench-analysis"
import { formatQuarter } from "@/lib/scoring/quarter"

/**
 * One institution, underwritten.
 *
 * Additive, like the Executive Brief: it sits above the tabs and takes nothing
 * away. It answers the three questions the screening table cannot — compared to
 * whom, what is already flagged, and how much room is left — and hands off to
 * the Market Analytics profile drawer for everything else, because that view
 * owns the eight-quarter trends and the cohort its percentiles are measured
 * against.
 *
 * The whole scope is fetched once and the analysis runs in the browser, so
 * switching institutions is immediate. Working through a list of names is the
 * actual use, and a round trip per name would make that unpleasant.
 */
export function UnderwriterWorkbench({
  scope = "National",
  onSelectInstitution,
  notFoundCert,
}: {
  scope?: string
  /** Hands an institution to the tab that owns the profile drawer. */
  onSelectInstitution?: (cert: string, name: string) => void
  /** Set when a handed-over institution was not in the tab's cohort. */
  notFoundCert?: string | null
}) {
  const [universe, setUniverse] = useState<WorkbenchUniverse | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [selectedCert, setSelectedCert] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setSelectedCert(null)
    getWorkbenchUniverse(scope)
      .then((result) => {
        if (active) setUniverse(result)
      })
      .catch(() => {
        if (active) setUniverse(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [scope])

  const rows = universe?.rows ?? []

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return rows
      .filter((r) => r.name.toLowerCase().includes(q) || r.cert === q)
      .slice(0, 8)
  }, [rows, query])

  const subject = useMemo(
    () => rows.find((r) => r.cert === selectedCert) ?? null,
    [rows, selectedCert]
  )

  const analysis = useMemo(
    () => (subject ? analyseInstitution(subject, rows) : null),
    [subject, rows]
  )

  if (loading) return <WorkbenchSkeleton />
  if (!universe || universe.error) {
    return (
      <Card className="p-6 surface-primary">
        <h3 className="text-base font-semibold text-slate-800">Underwriter workbench</h3>
        <p className="mt-2 text-sm text-slate-600">
          {universe?.error ?? "Could not load institutions. The FDIC API may be unavailable."}
        </p>
      </Card>
    )
  }

  return (
    <Card className="p-6 surface-primary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-800">Underwriter workbench</h3>
        <p className="text-xs text-slate-600">
          {rows.length.toLocaleString()} institutions
          {universe.asOfQuarter ? ` · ${formatQuarter(universe.asOfQuarter)}` : ""}
        </p>
      </div>

      <p className="mt-1 mb-4 text-xs text-slate-600">
        Pick an institution to see it against a matched peer cohort, the supervisory levels it
        currently sits near, and how large a loss on its CRE book it absorbs before reaching its
        capital floor.
        {universe.capped
          ? " This covers the largest institutions rather than every one, so a smaller institution may not be searchable here."
          : ""}
      </p>

      {notFoundCert ? (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
          That institution is not in the Market Analytics cohort, so its profile cannot be opened
          from here.
        </p>
      ) : null}

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by institution name or FDIC certificate number"
          aria-label="Search for an institution to underwrite"
          className="pl-9"
        />
        {matches.length > 0 && subject?.name.toLowerCase() !== query.trim().toLowerCase() ? (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
            {matches.map((row) => (
              <li key={row.cert}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCert(row.cert)
                    setQuery(row.name)
                  }}
                  className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
                >
                  <span className="truncate font-medium text-slate-800">{row.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {[row.city, row.state].filter(Boolean).join(", ")} · {money(row.totalAssets)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {analysis ? (
        <Analysis analysis={analysis} onSelectInstitution={onSelectInstitution} />
      ) : (
        <p className="mt-6 text-sm text-slate-600">
          No institution selected. Search above to begin.
        </p>
      )}
    </Card>
  )
}

function Analysis({
  analysis,
  onSelectInstitution,
}: {
  analysis: WorkbenchAnalysis
  onSelectInstitution?: (cert: string, name: string) => void
}) {
  const { subject, cohort, comparisons, flags, downside, cohortIsRankable } = analysis
  const place = [subject.city, subject.state && titleCase(subject.state)].filter(Boolean).join(", ")

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">{subject.name}</h4>
          <p className="text-xs text-slate-500">
            {place} · {money(subject.totalAssets)} in assets · CERT {subject.cert}
          </p>
        </div>
        {onSelectInstitution ? (
          <button
            type="button"
            onClick={() => onSelectInstitution(subject.cert, subject.name)}
            className="inline-flex items-center gap-1 rounded-md border border-[#006D95]/30 px-2.5 py-1.5 text-xs font-medium text-[#006D95] transition-colors hover:bg-[#006D95]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#006D95]"
          >
            Full statistics and trends
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <Flags flags={flags} />

      <section>
        <h5 className="text-sm font-semibold text-slate-800">Against its peers</h5>
        <p className="mt-0.5 text-xs text-slate-500">
          {cohort.peers.length.toLocaleString()} peers — {cohort.description}.
          {cohort.relaxationNote && cohort.peers.length > 0 ? ` ${cohort.relaxationNote}` : ""}
        </p>
        {cohortIsRankable ? (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="py-1.5 text-left font-medium">Metric</th>
                <th className="py-1.5 text-right font-medium">This bank</th>
                <th className="py-1.5 text-right font-medium">Peer median</th>
                <th className="py-1.5 text-right font-medium">Percentile</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((c) => (
                <tr key={c.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 text-slate-700">{c.label}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums text-slate-800">
                    {c.value == null ? "—" : c.format(c.value)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">
                    {c.peerMedian == null ? "—" : c.format(c.peerMedian)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {c.percentile == null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <PercentileBadge percentile={c.percentile} adverse={c.adverse} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-600">
            Too few comparable institutions to rank against. A percentile off a handful of peers
            would look precise and mean nothing, so none is shown.
          </p>
        )}
        <p className="mt-1.5 text-xs text-slate-500">
          Percentiles are within this cohort only, and read so that a higher number is the worse
          position on every row.
        </p>
      </section>

      <Downside downside={downside} />
    </div>
  )
}

function Flags({ flags }: { flags: WorkbenchAnalysis["flags"] }) {
  if (flags.length === 0) {
    return (
      <section>
        <h5 className="text-sm font-semibold text-slate-800">Threshold flags</h5>
        <p className="mt-2 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm text-slate-700">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          Not at or near any supervisory or watch level on the metrics tracked here.
        </p>
      </section>
    )
  }

  return (
    <section>
      <h5 className="text-sm font-semibold text-slate-800">Threshold flags</h5>
      <p className="mt-0.5 text-xs text-slate-500">
        Where it stands now, not what changed this quarter. An institution that has been over a
        level for two years generates no movement and still needs flagging.
      </p>
      <ul className="mt-2 space-y-1.5">
        {flags.map((flag) => {
          const urgent = flag.status === "past" && flag.supervisory
          const border = urgent
            ? "border-red-200 bg-red-50/40"
            : flag.status === "past"
              ? "border-amber-200 bg-amber-50/40"
              : "border-slate-200 bg-slate-50/60"
          return (
            <li
              key={`${flag.metric}-${flag.threshold}`}
              className={`flex items-start gap-2.5 rounded-md border px-3 py-2 ${border}`}
            >
              <AlertTriangle
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  urgent ? "text-red-600" : flag.status === "past" ? "text-amber-600" : "text-slate-400"
                }`}
                aria-hidden="true"
              />
              <p className="text-sm text-slate-700">
                <span className="font-medium text-slate-800">{flag.metricLabel}</span> at{" "}
                {flag.format(flag.value)} — {flag.status === "past" ? "past" : "approaching"}{" "}
                {flag.thresholdLabel}
                {flag.supervisory ? "" : ", a working convention rather than a supervisory level"}.
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Downside({ downside }: { downside: WorkbenchAnalysis["downside"] }) {
  if (!downside) {
    return (
      <section>
        <h5 className="text-sm font-semibold text-slate-800">CRE downside</h5>
        <p className="mt-2 text-sm text-slate-600">
          Not shown. This institution reports neither a usable risk-based capital position nor a
          leverage ratio, or has no CRE book to mark. Estimating one from total assets would put a
          made-up denominator under a number worth quoting, so nothing is shown instead.
        </p>
      </section>
    )
  }

  const { ratioLabel, baseRatio, floors, marks, creLoans, regime } = downside
  const primary = floors[0]

  return (
    <section>
      <h5 className="text-sm font-semibold text-slate-800">CRE downside</h5>
      <p className="mt-0.5 text-xs text-slate-500">
        {ratioLabel} is {baseRatio.toFixed(2)}% today, against {article(primary.value)}{" "}
        {primary.value}% floor.{" "}
        {regime === "leverage"
          ? "This institution files under the community-bank leverage framework and reports no risk-weighted assets, so it is measured on leverage."
          : "Measured on risk-weighted assets, as reported."}{" "}
        A mark is applied as a straight deduction from capital with the denominator held constant,
        and no tax benefit is assumed — both make this more severe than reality.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {floors.map((f) => (
          <div key={f.value} className="rounded-md border border-slate-200 bg-white px-3 py-2.5">
            <p className="text-xs text-slate-500">{f.label}</p>
            {f.alreadyBelow ? (
              <p className="mt-0.5 text-sm font-semibold text-red-700">Already below</p>
            ) : f.breakEvenMark == null ? (
              <p className="mt-0.5 text-sm font-semibold text-slate-700">
                Not reachable
                <span className="ml-1 font-normal text-slate-500">
                  — a total loss on the CRE book would not take it there
                </span>
              </p>
            ) : (
              <p className="mt-0.5 text-sm font-semibold text-slate-800">
                {(f.breakEvenMark * 100).toFixed(1)}% mark
                <span className="ml-1 font-normal text-slate-500">
                  = {money(f.breakEvenMark * creLoans)} of loss
                </span>
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">{f.consequence}</p>
          </div>
        ))}
      </div>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500">
            <th className="py-1.5 text-left font-medium">Mark on CRE</th>
            <th className="py-1.5 text-right font-medium">Loss</th>
            <th className="py-1.5 text-right font-medium">{ratioLabel}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100">
            <td className="py-1.5 text-slate-700">None</td>
            <td className="py-1.5 text-right tabular-nums text-slate-500">—</td>
            <td className="py-1.5 text-right font-medium tabular-nums text-slate-800">
              {baseRatio.toFixed(2)}%
            </td>
          </tr>
          {marks.map((m) => {
            // The nearest level this mark breaches, which for a leverage filer
            // is usually the CBLR election rather than the PCA floor. Marking
            // only the PCA floor would let a row that costs the institution its
            // reporting election render as unremarkable.
            const breached = floors.filter((f) => m.ratio < f.value).sort((a, b) => a.value - b.value)[0]
            return (
              <tr key={m.mark} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5 text-slate-700">{(m.mark * 100).toFixed(0)}%</td>
                <td className="py-1.5 text-right tabular-nums text-slate-500">
                  {money(m.lossDollars)}
                </td>
                <td
                  className={`py-1.5 text-right font-medium tabular-nums ${
                    m.belowFloor ? "text-red-700" : breached ? "text-amber-700" : "text-slate-800"
                  }`}
                >
                  {m.ratio.toFixed(2)}%
                  {breached ? (
                    <span className="ml-1 text-xs font-normal">
                      {m.belowFloor ? "below floor" : `below ${breached.value}%`}
                    </span>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-xs text-slate-500">
        CRE book of {money(creLoans)}, on the 2006 interagency definition — construction,
        multifamily and non-owner-occupied non-residential.
      </p>
    </section>
  )
}

/**
 * Percentile shown so that high always reads as worse.
 *
 * Reserve coverage is the one metric where a low raw value is the bad outcome,
 * so its percentile is inverted here rather than in the data. Leaving it
 * uninverted would put "8th percentile" next to the thinnest reserve on the
 * screen and read as reassuring.
 */
function PercentileBadge({
  percentile,
  adverse,
}: {
  percentile: number
  adverse: "rising" | "falling"
}) {
  const worseness = adverse === "rising" ? percentile : 1 - percentile
  const tone =
    worseness >= 0.9
      ? "bg-red-100 text-red-800"
      : worseness >= 0.75
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-700"
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>
      {ordinal(Math.round(worseness * 100))}
    </span>
  )
}

/**
 * "an 8% floor", "a 4% floor".
 *
 * Only 8 and 11 matter among the levels used here, but spelling the rule out is
 * cheaper than remembering to revisit it when a threshold moves.
 */
function article(n: number): string {
  const leading = String(n)[0]
  const isEleven = n >= 11 && n < 12
  return leading === "8" || isEleven ? "an" : "a"
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"
  return `${n}${suffix}`
}

function money(dollars: number): string {
  if (!Number.isFinite(dollars)) return "—"
  if (Math.abs(dollars) >= 1e9) return `$${(dollars / 1e9).toFixed(1)}B`
  if (Math.abs(dollars) >= 1e6) return `$${Math.round(dollars / 1e6)}M`
  return `$${Math.round(dollars / 1e3)}K`
}

/** FDIC returns state names shouted; nothing else in the tool does. */
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

function WorkbenchSkeleton() {
  return (
    <Card className="p-6 surface-primary">
      <Skeleton className="h-5 w-52" />
      <Skeleton className="mt-3 h-3 w-full max-w-xl" />
      <Skeleton className="mt-4 h-9 w-full" />
      <div className="mt-6 space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </Card>
  )
}
