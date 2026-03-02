"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react"
import {
  fetchInstitutionalResearchFeed,
  fetchResearchSummaryByReportId,
  runResearchIngestionAction,
  summarizeResearchReportById,
  type ResearchFeedRow,
} from "@/app/actions/research-feed"

type DayRange = 7 | 30 | 90

export function InstitutionalResearchFeed() {
  const [producer, setProducer] = useState<string>("all")
  const [assetType, setAssetType] = useState<string>("all")
  const [geography, setGeography] = useState<string>("all")
  const [days, setDays] = useState<DayRange>(30)
  const [rows, setRows] = useState<ResearchFeedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeSummary, setActiveSummary] = useState<any | null>(null)
  const [activeTitle, setActiveTitle] = useState<string>("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetchInstitutionalResearchFeed({
      producer: producer === "all" ? undefined : producer,
      assetType: assetType === "all" ? undefined : assetType,
      geography: geography === "all" ? undefined : geography,
      days,
    })
    if (!res.ok) {
      setRows([])
      setError(res.error)
    } else {
      setRows(res.reports)
    }
    setLoading(false)
  }, [producer, assetType, geography, days])

  useEffect(() => {
    load()
  }, [load])

  const producerOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.producer))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [rows]
  )

  const handleRefreshFeed = useCallback(async () => {
    setRefreshing(true)
    const res = await runResearchIngestionAction()
    if (!res.ok) setError(res.error ?? "Ingestion failed")
    await load()
    setRefreshing(false)
  }, [load])

  const handleSummarize = useCallback(
    async (row: ResearchFeedRow) => {
      const res = await summarizeResearchReportById(row.id)
      if (!res.ok) {
        setError(res.error ?? "Failed to summarize")
        return
      }
      await load()
    },
    [load]
  )

  const handleViewSummary = useCallback(async (row: ResearchFeedRow) => {
    const res = await fetchResearchSummaryByReportId(row.id)
    if (!res.ok) {
      setError(res.error ?? "No summary found")
      return
    }
    setActiveTitle(row.title)
    setActiveSummary(res.summary)
    setDialogOpen(true)
  }, [])

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Latest Institutional Research</h3>
          <p className="text-sm text-slate-600 mt-1">
            Publicly accessible institutional research from Federal Reserve, FDIC, CBRE, JLL, Cushman & Wakefield, Colliers, NAIOP, and ULI.
          </p>
        </div>
        <Button onClick={handleRefreshFeed} disabled={refreshing} className="shrink-0">
          {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh Feed
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <select value={producer} onChange={(e) => setProducer(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="all">All Producers</option>
          {producerOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select value={assetType} onChange={(e) => setAssetType(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="all">All Asset Types</option>
          <option value="Office">Office</option>
          <option value="Multifamily">Multifamily</option>
          <option value="Industrial">Industrial</option>
          <option value="Retail">Retail</option>
          <option value="Capital Markets">Capital Markets</option>
          <option value="Banking">Banking</option>
        </select>
        <select value={geography} onChange={(e) => setGeography(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="all">All Geographies</option>
          <option value="US">US</option>
          <option value="Florida">Florida</option>
          <option value="Miami">Miami</option>
        </select>
        <select value={String(days)} onChange={(e) => setDays(Number(e.target.value) as DayRange)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-sm text-slate-600">Loading research feed…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-600">No reports found for selected filters.</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-border bg-card/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-slate-800">{row.title}</h4>
                  <p className="text-xs text-slate-600 mt-1">
                    {row.producer} • {row.publishedDate ?? "Date unknown"} • {row.documentType.toUpperCase()}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {row.tags?.assetType && <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] text-slate-700">{row.tags.assetType}</span>}
                    {row.tags?.geography && <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] text-slate-700">{row.tags.geography}</span>}
                    <span className={`rounded px-2 py-0.5 text-[10px] ${row.documentType === "pdf" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {row.documentType === "pdf" ? "PDF ✅" : "HTML"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button variant="secondary" size="sm" className="text-xs h-8" asChild>
                    <a href={row.landingUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                      Open Source
                    </a>
                  </Button>
                  {row.documentType === "pdf" && (
                    <Button variant="secondary" size="sm" className="text-xs h-8" asChild>
                      <a href={row.documentUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" />
                        Open PDF
                      </a>
                    </Button>
                  )}
                  {!row.isSummarized ? (
                    <Button size="sm" className="text-xs h-8" onClick={() => handleSummarize(row)}>
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      Summarize
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" className="text-xs h-8" onClick={() => handleViewSummary(row)}>
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      View Summary
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Executive Summary</DialogTitle>
            <DialogDescription>{activeTitle}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto pr-1 text-sm">
            {activeSummary?.executiveSummary && <p className="text-slate-800 whitespace-pre-wrap">{activeSummary.executiveSummary}</p>}
            {Array.isArray(activeSummary?.keyTakeaways) && activeSummary.keyTakeaways.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-600 mb-1.5">Key Takeaways</p>
                <ul className="list-disc pl-5 space-y-1 text-slate-800">
                  {activeSummary.keyTakeaways.map((b: string, idx: number) => <li key={idx}>{b}</li>)}
                </ul>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
