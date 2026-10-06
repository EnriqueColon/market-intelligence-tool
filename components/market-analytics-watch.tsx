"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getCohortWatch } from "@/app/actions/market-analytics-watch"
import type { CohortExit, CohortWatch } from "@/lib/analytics/cohort-watch"
import type { CapitalCategory } from "@/lib/scoring/capital-category"
import { formatMoney } from "@/lib/fdic-structure-events"
import { getErrorMessage } from "@/lib/error-utils"

/**
 * What changed in the cohort: who is deteriorating, and who has left.
 *
 * Sits between the Cohort Summary and the charts because it answers the
 * question those two cannot. The summary and the table describe the headline
 * quarter; this describes the movement into it and the departures from it.
 * Both lists come from the same FDIC quarters the table already uses, plus the
 * FDIC's structure records for the exits — see `lib/analytics/cohort-watch.ts`.
 *
 * Rows in the Deteriorating list open the institution drawer when the tab
 * supplies `onSelectInstitution`; every one of them is a headline-quarter
 * filer and therefore in the screening table, so the handoff cannot miss.
 * Exits are not clickable: the institution is no longer in any cohort.
 */
export function MarketAnalyticsWatch({
  scope,
  asOfQuarter,
  onSelectInstitution,
}: {
  scope: string
  asOfQuarter: string
  onSelectInstitution?: (cert: string) => void
}) {
  const [data, setData] = useState<CohortWatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getCohortWatch(scope)
      .then((result) => {
        if (!active) return
        if (result.ok) setData(result.watch)
        else setError(result.error)
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [scope])

  return (
    <Card className="p-6 surface-primary">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-800">Cohort Changes</h3>
        <p className="mt-1 text-xs text-slate-600">
          Institutions in {scope} whose position worsened into {asOfQuarter}, and institutions that left the cohort
          since the quarter before. From FDIC call reports and the FDIC&apos;s structure and failure records.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-700">Cohort changes unavailable: {error}</p>
      )}

      {loading && !error && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ListSkeleton rows={5} />
          <ListSkeleton rows={4} />
        </div>
      )}

      {!loading && !error && data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <DeterioratingList data={data} onSelectInstitution={onSelectInstitution} />
          <ExitsList data={data} />
        </div>
      )}
    </Card>
  )
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-2 h-2.5 w-64" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-48" />
            <Skeleton className="mt-1.5 h-2.5 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Panel({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[#006D95]">{title}</h4>
      <p className="mt-0.5 mb-3 text-xs text-slate-500">{caption}</p>
      {children}
    </div>
  )
}

const CAPITAL_TONE: Record<CapitalCategory, string> = {
  well: "bg-emerald-50 text-emerald-800 border-emerald-200",
  adequate: "bg-amber-50 text-amber-800 border-amber-200",
  under: "bg-orange-50 text-orange-800 border-orange-200",
  significant: "bg-red-50 text-red-800 border-red-200",
  critical: "bg-red-100 text-red-900 border-red-300",
}

function placeOf(item: { city?: string; state?: string }): string {
  return [item.city, item.state].filter(Boolean).join(", ")
}

function DeterioratingList({
  data,
  onSelectInstitution,
}: {
  data: CohortWatch
  onSelectInstitution?: (cert: string) => void
}) {
  const shown = data.deteriorating.length
  const caption =
    data.deterioratingCount === 0
      ? `None of the ${data.institutionCount} institutions crossed a threshold, slipped a capital category or moved the wrong way for three quarters running.`
      : `${data.deterioratingCount} of ${data.institutionCount} institutions show at least one adverse signal${
          data.deterioratingCount > shown ? `; the ${shown} most urgent are listed` : ""
        }. Capital categories are the regulators' Prompt Corrective Action bands.${
          data.capped ? " The FDIC row cap bound this query, so it covers the largest institutions only." : ""
        }`

  return (
    <Panel title="Deteriorating" caption={caption}>
      {data.deteriorating.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing to report for this quarter.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.deteriorating.map((item) => {
            const content = (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-slate-800">{item.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">{formatMoney(item.totalAssets)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span>{placeOf(item)}</span>
                  {item.capital && (
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${CAPITAL_TONE[item.capital.category]}`}
                      title={item.capital.binding}
                    >
                      {item.capital.label}
                    </span>
                  )}
                </div>
                <ul className="mt-1.5 space-y-1">
                  {item.signals.map((s, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-700">
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          s.kind === "capital" || s.supervisory ? "bg-red-500" : s.kind === "crossing" ? "bg-amber-500" : "bg-slate-400"
                        }`}
                        aria-hidden
                      />
                      <span>{s.description}</span>
                    </li>
                  ))}
                </ul>
              </>
            )
            return (
              <li key={item.cert} className="py-3 first:pt-0 last:pb-0">
                {onSelectInstitution ? (
                  <button
                    type="button"
                    onClick={() => onSelectInstitution(item.cert)}
                    className="w-full rounded-md text-left transition-colors hover:bg-slate-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[#006D95]/40"
                  >
                    {content}
                  </button>
                ) : (
                  content
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Red: capital-category downgrade or a supervisory threshold (300% CRE to capital, 100% construction to
        capital). Amber: a working threshold. Grey: three or more consecutive adverse quarters.
      </p>
    </Panel>
  )
}

const EXIT_LABEL: Record<CohortExit["kind"], string> = {
  failure: "Failed",
  merger: "Merged",
  closing: "Closed voluntarily",
  other: "Structure event",
  unknown: "Stopped filing",
}

const EXIT_TONE: Record<CohortExit["kind"], string> = {
  failure: "bg-red-50 text-red-800 border-red-200",
  merger: "bg-sky-50 text-sky-800 border-sky-200",
  closing: "bg-violet-50 text-violet-800 border-violet-200",
  other: "bg-slate-50 text-slate-700 border-slate-200",
  unknown: "bg-slate-50 text-slate-600 border-slate-200",
}

function ExitsList({ data }: { data: CohortWatch }) {
  const shown = data.exits.length
  const caption =
    data.exitsCount === 0
      ? `Every institution that filed in the quarter before also filed for ${data.asOfQuarter ? "the latest quarter" : "this quarter"}.`
      : `${data.exitsCount} institution${data.exitsCount === 1 ? "" : "s"} filed in the quarter before but not for the latest${
          data.exitsCount > shown ? `; the ${shown} largest are listed` : ""
        }.${data.exitsOlder > 0 ? ` A further ${data.exitsOlder} stopped filing earlier and are not listed.` : ""} The acquirer now holds the loan book and the branches.`

  return (
    <Panel title="Exits" caption={caption}>
      {data.exits.length === 0 ? (
        <p className="text-sm text-slate-600">No departures this quarter.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.exits.map((exit) => (
            <li key={exit.cert} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-800">{exit.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">{formatMoney(exit.totalAssets)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span>{placeOf(exit)}</span>
                <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${EXIT_TONE[exit.kind]}`}>
                  {EXIT_LABEL[exit.kind]}
                </span>
                {exit.acquirer && <span>→ {exit.acquirer}</span>}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-700">{exit.description}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
