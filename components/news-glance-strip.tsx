"use client"

import { useEffect, useState } from "react"
import { fetchPublicMentions } from "@/app/actions/fetch-public-mentions"
import { fetchInvestingNews } from "@/app/actions/fetch-investing-news"
import type { PublicMentionItem } from "@/app/actions/fetch-public-mentions"

interface NewsGlanceStripProps {
  level: "national" | "florida" | "miami"
}

const glanceCache = new Map<string, { industry: PublicMentionItem[]; finance: PublicMentionItem[] }>()

export function NewsGlanceStrip({ level }: NewsGlanceStripProps) {
  const [items, setItems] = useState<{ industry: PublicMentionItem[]; finance: PublicMentionItem[] } | null>(null)

  useEffect(() => {
    const key = `glance:${level}`
    const cached = glanceCache.get(key)
    if (cached) {
      setItems(cached)
      return
    }
    Promise.all([
      fetchPublicMentions(level).then((r) => r.news).catch(() => [] as PublicMentionItem[]),
      fetchInvestingNews(level).then((r) => r.news).catch(() => [] as PublicMentionItem[]),
    ]).then(([industry, finance]) => {
      const result = { industry, finance }
      glanceCache.set(key, result)
      setItems(result)
    })
  }, [level])

  if (!items) return null

  const all = [...items.industry, ...items.finance]
  if (all.length === 0) return null

  const open = all.filter((i) => i.access_status === "open").length
  const paywalled = all.filter((i) => i.access_status === "paywalled").length
  const partial = all.filter((i) => i.access_status === "partial").length

  // Top 3 topics by frequency
  const topicCounts = new Map<string, number>()
  for (const item of all) {
    if (item.topic) topicCounts.set(item.topic, (topicCounts.get(item.topic) ?? 0) + 1)
  }
  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic, count]) => ({ topic, count }))

  const stats = [
    { label: "Total Articles", value: all.length, color: "text-slate-800" },
    { label: "Open Access", value: open, color: "text-emerald-700" },
    { label: "Partial", value: partial, color: "text-amber-600" },
    { label: "Paywalled", value: paywalled, color: "text-slate-400" },
    { label: "CRE / Distress", value: items.industry.length, color: "text-[#006D95]" },
    { label: "General Finance", value: items.finance.length, color: "text-slate-600" },
  ]

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
          This Week
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {stats.map((s) => (
            <div key={s.label} className="flex items-baseline gap-1">
              <span className={`text-lg font-bold tabular-nums leading-none ${s.color}`}>{s.value}</span>
              <span className="text-xs text-slate-500">{s.label}</span>
            </div>
          ))}
        </div>
        {topTopics.length > 0 && (
          <>
            <div className="h-4 w-px bg-slate-200 hidden sm:block" />
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-slate-500">Top topics:</span>
              {topTopics.map(({ topic, count }) => (
                <span
                  key={topic}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                >
                  {topic}
                  <span className="font-semibold text-slate-500">{count}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
