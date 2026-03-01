"use client"

import { useEffect, useState } from "react"

export type InterpretationResult = {
  headline: string
  bullets: string[]
  paragraph: string
}

type ReportInterpretationBlockProps = {
  vizType: string
  scope: string
  asOfQuarter: string
  stats: Record<string, unknown>
  /** When false, does not fetch (e.g. not in report mode) */
  enabled?: boolean
}

export function ReportInterpretationBlock({
  vizType,
  scope,
  asOfQuarter,
  stats,
  enabled = true,
}: ReportInterpretationBlockProps) {
  const [result, setResult] = useState<InterpretationResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !vizType || !scope) return
    setLoading(true)
    fetch("/api/report/interpretation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vizType, scope, asOfQuarter, stats }),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Failed")))
      .then((data) => setResult(data))
      .catch(() => setResult(null))
      .finally(() => setLoading(false))
  }, [enabled, vizType, scope, asOfQuarter, JSON.stringify(stats)])

  if (!enabled) return null
  if (loading) return <p className="text-sm text-slate-500 mt-4 italic">Generating interpretation…</p>
  if (!result) return null

  return (
    <div className="mt-6 pt-4 border-t border-slate-200" style={{ fontFamily: "Georgia, serif" }}>
      <h5 className="text-sm font-bold text-slate-800 mb-2" style={{ fontSize: "11pt" }}>
        {result.headline}
      </h5>
      <ul className="list-disc list-inside text-slate-700 space-y-1 mb-3" style={{ fontSize: "11pt" }}>
        {result.bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
      <p className="text-slate-700 leading-relaxed" style={{ fontSize: "11pt" }}>
        {result.paragraph}
      </p>
    </div>
  )
}
