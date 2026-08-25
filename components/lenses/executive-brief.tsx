"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatQuarter } from "@/lib/scoring/quarter"
import {
  getExecutiveBrief,
  type BriefEvent,
  type ExecutiveBrief as Brief,
  type NonReportingInstitution,
} from "@/app/actions/executive-brief"

/**
 * What moved this quarter, at a glance.
 *
 * Additive: this sits above the tabs and replaces nothing. An executive who
 * wants the full screening table scrolls past it and uses the tab as before.
 *
 * Deliberately has no table. The question here is "what needs me", and a
 * thirty-column grid answers a different one.
 */
export function ExecutiveBrief({
  scope = "National",
  onSelectInstitution,
  notFoundCert,
}: {
  scope?: string
  /**
   * Hands an institution to the Market Analytics tab, which owns the profile
   * drawer and the cohort its percentiles are measured against. Omitted when
   * that tab is disabled, in which case rows are not clickable.
   */
  onSelectInstitution?: (cert: string, name: string) => void
  /** Set when a handed-over institution was not in the tab's cohort. */
  notFoundCert?: string | null
}) {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getExecutiveBrief(scope)
      .then((result) => {
        if (active) setBrief(result)
      })
      .catch(() => {
        if (active) setBrief(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [scope])

  if (loading) return <BriefSkeleton />
  if (!brief || brief.error) {
    return (
      <Card className="p-6 surface-primary">
        <SectionTitle>What moved this quarter</SectionTitle>
        <p className="text-sm text-slate-600 mt-2">
          {brief?.error ?? "Could not load the brief. The FDIC API may be unavailable."}
        </p>
      </Card>
    )
  }

  const nothingMoved =
    brief.supervisoryCrossings.length === 0 &&
    brief.otherCrossings.length === 0 &&
    brief.trajectories.length === 0 &&
    brief.nonReporting.length === 0

  return (
    <Card className="p-6 surface-primary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionTitle>What moved this quarter</SectionTitle>
        <p className="text-xs text-slate-600">
          {brief.movedCount.toLocaleString()} of {brief.institutionCount.toLocaleString()} institutions
          {brief.asOfQuarter ? ` · ${formatQuarter(brief.asOfQuarter)}` : ""}
        </p>
      </div>

      <p className="text-xs text-slate-600 mt-1 mb-4">
        Movements against the prior quarter, and metrics deteriorating for three or more consecutive
        quarters. Supervisory levels come from the 2006 interagency guidance on CRE concentrations;
        the others are working conventions.
        {brief.capped
          ? ` This covers the largest ${brief.institutionCount.toLocaleString()} institutions rather than every one, so a smaller institution that moved will not appear here.`
          : ""}
        {brief.staleCount > 0
          ? ` A further ${brief.staleCount.toLocaleString()} did not file for this quarter; they are listed separately below rather than having an older movement dated forward.`
          : ""}
        {onSelectInstitution ? " Select any institution to open its full statistics." : ""}
      </p>

      {notFoundCert ? (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
          That institution is not in the Market Analytics cohort, so its profile cannot be opened
          from here. This happens when it falls below the row cap that view is subject to.
        </p>
      ) : null}

      {nothingMoved ? (
        <p className="text-sm text-slate-600">
          No institution in this scope crossed a threshold or sustained a multi-quarter decline. That
          is a real finding, not a missing one.
        </p>
      ) : (
        <div className="space-y-5">
          <EventGroup
            title="Crossed a supervisory level"
            hint="Passed a level regulators screen on. Most urgent."
            tone="urgent"
            events={brief.supervisoryCrossings}
            onSelect={onSelectInstitution}
          />
          <EventGroup
            title="Crossed a watch level"
            hint="Passed a conventional threshold this quarter."
            tone="watch"
            events={brief.otherCrossings}
            onSelect={onSelectInstitution}
          />
          <EventGroup
            title="Deteriorating"
            hint="Nothing crossed yet, but moving the wrong way consistently."
            tone="trend"
            events={brief.trajectories}
            onSelect={onSelectInstitution}
          />
          {/*
            Last, and visually quieter than the three above it. An institution
            that stopped filing is a weaker signal than a supervisory crossing —
            usually a merger rather than a problem — so it should not be the
            first thing read.
          */}
          <NonReportingGroup
            institutions={brief.nonReporting}
            total={brief.staleCount}
            asOfQuarter={brief.asOfQuarter}
          />
        </div>
      )}
    </Card>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-slate-800">{children}</h3>
}

const TONE = {
  urgent: { Icon: AlertTriangle, className: "text-red-600", border: "border-red-200 bg-red-50/40" },
  watch: { Icon: ArrowRight, className: "text-amber-600", border: "border-amber-200 bg-amber-50/40" },
  trend: { Icon: TrendingDown, className: "text-slate-500", border: "border-slate-200 bg-slate-50/60" },
} as const

function EventGroup({
  title,
  hint,
  tone,
  events,
  onSelect,
}: {
  title: string
  hint: string
  tone: keyof typeof TONE
  events: BriefEvent[]
  onSelect?: (cert: string, name: string) => void
}) {
  if (events.length === 0) return null
  const { Icon, className, border } = TONE[tone]

  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <span className="text-xs text-slate-500">{hint}</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {events.map((event) => {
          const place = [event.city, event.state].filter(Boolean).join(", ")
          const body = (
            <>
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${className}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  {event.name}
                  {place ? <span className="font-normal text-slate-500">{` · ${place}`}</span> : null}
                </p>
                <p className="text-xs text-slate-600">{event.description}</p>
              </div>
            </>
          )

          return (
            <li key={`${event.cert}-${event.metric}-${event.kind}`}>
              {onSelect ? (
                // A real button rather than a click handler on the row, so it is
                // reachable by keyboard and announced as actionable.
                <button
                  type="button"
                  onClick={() => onSelect(event.cert, event.name)}
                  aria-label={`Open statistics for ${event.name}${place ? `, ${place}` : ""}`}
                  className={`flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#006D95] focus-visible:ring-offset-1 ${border}`}
                >
                  {body}
                </button>
              ) : (
                <div className={`flex items-start gap-2.5 rounded-md border px-3 py-2 ${border}`}>
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Institutions that did not file for the as-of quarter.
 *
 * Not clickable, unlike the movement sections. The profile drawer draws on the
 * Market Analytics cohort, which is selected on the same latest-quarter rule
 * that put these institutions here — so every one of them would resolve to "not
 * found". Offering a control that cannot work is worse than offering none.
 */
function NonReportingGroup({
  institutions,
  total,
  asOfQuarter,
}: {
  institutions: NonReportingInstitution[]
  total: number
  asOfQuarter: string | null
}) {
  if (institutions.length === 0) return null
  const hidden = total - institutions.length

  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold text-slate-800">No longer reporting</h4>
        <span className="text-xs text-slate-500">
          Filed nothing for {asOfQuarter ? formatQuarter(asOfQuarter) : "this quarter"}. Largest
          first.
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Usually a merger or an acquisition rather than a failure, and one quarter behind is often
        just a late filing. Worth checking, not worth alarm.
      </p>
      <ul className="mt-2 space-y-1.5">
        {institutions.map((inst) => {
          const place = [inst.city, inst.state].filter(Boolean).join(", ")
          return (
            <li
              key={inst.cert}
              className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-2"
            >
              <Minus className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  {inst.name}
                  {place ? <span className="font-normal text-slate-500">{` · ${place}`}</span> : null}
                </p>
                <p className="text-xs text-slate-600">
                  {inst.quartersStale === 1
                    ? "One quarter behind"
                    : `${inst.quartersStale} quarters behind`}
                  {inst.lastQuarter ? ` · last filed ${formatQuarter(inst.lastQuarter)}` : ""}
                  {inst.totalAssets > 0 ? ` · ${formatAssets(inst.totalAssets)} in assets then` : ""}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
      {hidden > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          And {hidden.toLocaleString()} smaller {hidden === 1 ? "institution" : "institutions"}.
        </p>
      ) : null}
    </section>
  )
}

/** Dollars in, one significant scale out. Assets here are context, not a figure to reconcile. */
function formatAssets(dollars: number) {
  if (dollars >= 1e9) return `$${(dollars / 1e9).toFixed(1)}B`
  if (dollars >= 1e6) return `$${Math.round(dollars / 1e6)}M`
  return `$${Math.round(dollars / 1e3)}K`
}

function BriefSkeleton() {
  return (
    <Card className="p-6 surface-primary">
      <Skeleton className="h-5 w-56" />
      <Skeleton className="h-3 w-full max-w-xl mt-3" />
      <div className="mt-5 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </Card>
  )
}
