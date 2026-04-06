"use client"

import { useCallback, useState } from "react"
import { fetchResearchFeed, type ResearchReport, type ArchivedReport } from "@/app/actions/fetch-research-feed"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Archive, BookOpen, ExternalLink, RefreshCw } from "lucide-react"

const SESSION_KEY = "market-research-feed:v3"

const TOPIC_COLORS: Record<string, string> = {
  "Distressed/CMBS":   "bg-red-50 text-red-700 border-red-200",
  "Capital Markets":   "bg-purple-50 text-purple-700 border-purple-200",
  "Office":            "bg-slate-100 text-slate-700 border-slate-200",
  "Multifamily":       "bg-blue-50 text-blue-700 border-blue-200",
  "Retail":            "bg-orange-50 text-orange-700 border-orange-200",
  "Industrial":        "bg-yellow-50 text-yellow-700 border-yellow-200",
  "Market Outlook":    "bg-teal-50 text-teal-700 border-teal-200",
  "Florida/Southeast": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Banking/Lending":   "bg-indigo-50 text-indigo-700 border-indigo-200",
  "Investment Sales":  "bg-pink-50 text-pink-700 border-pink-200",
}

function topicClass(topic: string) {
  return TOPIC_COLORS[topic] ?? "bg-slate-100 text-slate-600 border-slate-200"
}

function formatDate(dateStr: string) {
  if (!dateStr) return ""
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
  } catch {
    return dateStr
  }
}

function formatGeneratedAt(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
  } catch {
    return iso
  }
}

export function MarketResearchFeed() {
  const [reports, setReports] = useState<ResearchReport[]>([])
  const [archive, setArchive] = useState<ArchivedReport[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [activeTopic, setActiveTopic] = useState("All")
  const [activePublisher, setActivePublisher] = useState("All")
  const [hasFetched, setHasFetched] = useState(false)
  const [showArchive, setShowArchive] = useState(false)

  const load = useCallback(async (force = false) => {
    if (!force) {
      try {
        const cached = sessionStorage.getItem(SESSION_KEY)
        if (cached) {
          const parsed = JSON.parse(cached)
          setReports(parsed.reports ?? [])
          setArchive(parsed.archive ?? [])
          setGeneratedAt(parsed.generatedAt ?? null)
          setHasFetched(true)
          return
        }
      } catch { /* ignore */ }
    }

    setLoading(true)
    setError(false)
    try {
      const result = await fetchResearchFeed()
      setReports(result.reports)
      setArchive(result.archive)
      setGeneratedAt(result.generatedAt)
      setHasFetched(true)
      setActiveTopic("All")
      setActivePublisher("All")
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          reports: result.reports,
          archive: result.archive,
          generatedAt: result.generatedAt,
        }))
      } catch { /* ignore */ }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const topics = ["All", ...Array.from(new Set(reports.map((r) => r.topic).filter(Boolean))).sort()]
  const publishers = ["All", ...Array.from(new Set(reports.map((r) => r.publisher).filter(Boolean))).sort()]

  const visible = reports.filter((r) => {
    if (activeTopic !== "All" && r.topic !== activeTopic) return false
    if (activePublisher !== "All" && r.publisher !== activePublisher) return false
    return true
  })

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-[#006D95]" />
          <div>
            <h3 className="text-base font-semibold text-slate-800">Market Research</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Latest research from Trepp, CBRE, JLL, Cushman, Colliers, Marcus & Millichap, MBA, Moody&apos;s, Green Street, Newmark, Walker & Dunlop and more.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => load(hasFetched)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {hasFetched ? "Refresh" : "Load Research"}
          </Button>
          {generatedAt && (
            <span className="text-xs text-slate-400">Updated {formatGeneratedAt(generatedAt)}</span>
          )}
        </div>
      </div>

      {/* Not yet loaded */}
      {!hasFetched && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">Click <strong>Load Research</strong> to fetch the latest publications.</p>
          <p className="text-xs text-slate-400 mt-1">Runs a dedicated search for each of 14 publishers — Trepp, CBRE, JLL, Cushman, Colliers, Marcus & Millichap, MBA, Moody&apos;s, Green Street, Newmark, Walker & Dunlop, CoStar, NAIOP, Avison Young.</p>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Unable to load research feed. Check your Perplexity API key and try again.
        </div>
      )}

      {/* Results */}
      {!loading && hasFetched && !error && (
        <>
          {/* Filter chips */}
          {reports.length > 0 && (
            <div className="space-y-2 mb-5">
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-slate-500 self-center mr-1">Topic:</span>
                {topics.map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTopic(t)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                      activeTopic === t
                        ? "bg-[#006D95] text-white border-[#006D95]"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {t}
                    {t !== "All" && (
                      <span className="ml-1 opacity-60">{reports.filter((r) => r.topic === t).length}</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-slate-500 self-center mr-1">Source:</span>
                {publishers.map((p) => (
                  <button
                    key={p}
                    onClick={() => setActivePublisher(p)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                      activePublisher === p
                        ? "bg-slate-700 text-white border-slate-700"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Cards grid */}
          {visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              No reports match the selected filters.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((report) => (
                <div
                  key={report.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3 hover:border-slate-300 hover:shadow-sm transition-all"
                >
                  {/* Publisher + date row */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#006D95]">{report.publisher}</span>
                    {report.publishedDate && (
                      <span className="text-xs text-slate-400">{formatDate(report.publishedDate)}</span>
                    )}
                  </div>

                  {/* Topic badge */}
                  <span className={`self-start rounded-full border px-2 py-0.5 text-xs font-medium ${topicClass(report.topic)}`}>
                    {report.topic}
                  </span>

                  {/* Title */}
                  <p className="text-sm font-semibold text-slate-800 leading-snug">{report.title}</p>

                  {/* Summary */}
                  {report.summary && (
                    <p className="text-xs text-slate-600 leading-relaxed">{report.summary}</p>
                  )}

                  {/* Key findings */}
                  {report.keyFindings.length > 0 && (
                    <ul className="space-y-1">
                      {report.keyFindings.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700">
                          <span className="mt-1.5 flex-shrink-0 h-1 w-1 rounded-full bg-[#006D95]" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Link */}
                  {report.url && (
                    <div className="mt-auto pt-1">
                      <a
                        href={report.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#006D95] hover:text-[#005a7a] font-medium"
                      >
                        View report <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {reports.length > 0 && (
            <p className="mt-4 text-xs text-slate-400 text-right">
              {visible.length} of {reports.length} reports shown
            </p>
          )}

          {/* Archive section */}
          {archive.length > 0 && (
            <div className="mt-8">
              <button
                onClick={() => setShowArchive((v) => !v)}
                className="flex items-center gap-2 w-full text-left group"
              >
                <div className="flex-1 h-px bg-slate-200" />
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 group-hover:text-slate-700 transition-colors whitespace-nowrap px-2">
                  <Archive className="h-3.5 w-3.5" />
                  Archive — {archive.length} older report{archive.length !== 1 ? "s" : ""}
                  <span className="text-slate-400">{showArchive ? "▲" : "▼"}</span>
                </div>
                <div className="flex-1 h-px bg-slate-200" />
              </button>

              {showArchive && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {archive.map((report) => (
                    <div
                      key={report.id}
                      className="rounded-lg border border-slate-100 bg-slate-50 p-4 flex flex-col gap-3 opacity-80 hover:opacity-100 hover:border-slate-200 transition-all"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-500">{report.publisher}</span>
                        {report.publishedDate && (
                          <span className="text-xs text-slate-400">{formatDate(report.publishedDate)}</span>
                        )}
                      </div>
                      <span className={`self-start rounded-full border px-2 py-0.5 text-xs font-medium ${topicClass(report.topic)}`}>
                        {report.topic}
                      </span>
                      <p className="text-sm font-semibold text-slate-700 leading-snug">{report.title}</p>
                      {report.summary && (
                        <p className="text-xs text-slate-500 leading-relaxed">{report.summary}</p>
                      )}
                      {report.keyFindings.length > 0 && (
                        <ul className="space-y-1">
                          {report.keyFindings.map((f, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                              <span className="mt-1.5 flex-shrink-0 h-1 w-1 rounded-full bg-slate-400" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-auto pt-1 flex items-center justify-between">
                        {report.url && (
                          <a
                            href={report.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-[#006D95] font-medium"
                          >
                            View report <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <span className="text-xs text-slate-400 ml-auto">
                          Fetched {formatDate(report.fetchedAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
