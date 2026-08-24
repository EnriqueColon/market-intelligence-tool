"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getExecutiveBrief, type BriefEvent, type ExecutiveBrief as Brief } from "@/app/actions/executive-brief"

/**
 * What moved this quarter, at a glance.
 *
 * Additive: this sits above the tabs and replaces nothing. An executive who
 * wants the full screening table scrolls past it and uses the tab as before.
 *
 * Deliberately has no table. The question here is "what needs me", and a
 * thirty-column grid answers a different one.
 */
export function ExecutiveBrief({ scope = "National" }: { scope?: string }) {
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
    brief.trajectories.length === 0

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
      </p>

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
          />
          <EventGroup
            title="Crossed a watch level"
            hint="Passed a conventional threshold this quarter."
            tone="watch"
            events={brief.otherCrossings}
          />
          <EventGroup
            title="Deteriorating"
            hint="Nothing crossed yet, but moving the wrong way consistently."
            tone="trend"
            events={brief.trajectories}
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
}: {
  title: string
  hint: string
  tone: keyof typeof TONE
  events: BriefEvent[]
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
        {events.map((event) => (
          <li
            key={`${event.cert}-${event.metric}-${event.kind}`}
            className={`flex items-start gap-2.5 rounded-md border px-3 py-2 ${border}`}
          >
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${className}`} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">
                {event.name}
                {event.state ? <span className="font-normal text-slate-500"> · {event.state}</span> : null}
              </p>
              <p className="text-xs text-slate-600">{event.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
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

function formatQuarter(repdte: string) {
  if (!/^\d{8}$/.test(repdte)) return repdte
  const year = repdte.slice(0, 4)
  const month = Number(repdte.slice(4, 6))
  const q = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4
  return `Q${q} ${year}`
}
