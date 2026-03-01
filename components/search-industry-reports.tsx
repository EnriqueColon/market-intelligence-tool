"use client"

import { useState, useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ExternalLink, Loader2, Search, Sparkles, Bookmark } from "lucide-react"
import { ENTITY_DROPDOWN_OPTIONS, type EntityId } from "@/lib/entity-sources"
import {
  searchIndustryReports,
  type SearchResult,
} from "@/app/actions/search-industry-reports"
import {
  summarizeFoundReport,
} from "@/app/actions/summarize-found-report"
import {
  getSummariesForUrls,
  type ReportSummaryEntry,
} from "@/app/actions/fetch-report-summaries"

type ResultStatus = "idle" | "searching" | "summarizing" | "done" | "failed"

function SearchResultRow({
  result,
  entityId,
  summaryCache,
  onSummaryReady,
  saved,
  onSave,
}: {
  result: SearchResult
  entityId: EntityId
  summaryCache: ReportSummaryEntry | null
  onSummaryReady: (url: string, summary: ReportSummaryEntry) => void
  saved: boolean
  onSave: (result: SearchResult) => void
}) {
  const [status, setStatus] = useState<ResultStatus>(summaryCache ? "done" : "idle")
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ReportSummaryEntry | null>(summaryCache)
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleSummarize = useCallback(async () => {
    if (summary) {
      setDialogOpen(true)
      return
    }
    setStatus("summarizing")
    setError(null)
    const res = await summarizeFoundReport(result.url, result.title, entityId)
    if (res.ok) {
      setSummary(res.summary)
      setStatus("done")
      onSummaryReady(result.url, res.summary)
      setDialogOpen(true)
    } else {
      setStatus("failed")
      setError(res.error)
    }
  }, [result.url, result.title, entityId, summary, onSummaryReady])

  const handleViewSummary = useCallback(() => {
    if (summary) setDialogOpen(true)
  }, [summary])

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-slate-800">{result.title}</h4>
          <p className="text-xs text-slate-600 mt-1 line-clamp-2">{result.snippet}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-slate-600">
              {result.domain}
            </span>
            {result.inferredDate && (
              <span className="text-[10px] text-slate-600">{result.inferredDate}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" className="text-xs h-8" asChild>
              <a href={result.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Open
              </a>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="text-xs h-8"
              onClick={handleSummarize}
              disabled={status === "summarizing"}
            >
              {status === "summarizing" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : summary ? (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1 text-primary" />
                  Summarized ✅
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  Summarize
                </>
              )}
            </Button>
            <Button
              variant={saved ? "default" : "secondary"}
              size="sm"
              className="text-xs h-8"
              onClick={() => onSave(result)}
            >
              <Bookmark className={`h-3.5 w-3.5 mr-1 ${saved ? "fill-current" : ""}`} />
              {saved ? "Saved" : "Save"}
            </Button>
          </div>
          {status === "failed" && error && (
            <p className="text-[10px] text-destructive max-w-[200px] text-right">{error}</p>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Report summary</DialogTitle>
            <DialogDescription>
              {result.domain}
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline ml-1"
              >
                Open report
              </a>
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="text-sm font-semibold">{result.title}</div>
            {summary && (summary.summary || summary.bullets.length > 0) ? (
              <div className="space-y-4">
                {summary.summary && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 uppercase mb-1.5">
                      Executive summary
                    </div>
                    <p className="text-sm text-slate-800">{summary.summary}</p>
                  </div>
                )}
                {summary.bullets.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 uppercase mb-1.5">
                      Key points
                    </div>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
                      {summary.bullets.map((b, idx) => (
                        <li key={idx}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.lastFetched && (
                  <div className="text-xs text-slate-600">
                    Last updated: {new Date(summary.lastFetched).toLocaleDateString()}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-600">No summary available.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function SearchIndustryReports() {
  const [entityId, setEntityId] = useState<EntityId>("all")
  const [query, setQuery] = useState("")
  const [preferPdf, setPreferPdf] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [status, setStatus] = useState<"idle" | "searching" | "done" | "failed">("idle")
  const [error, setError] = useState<string | null>(null)
  const [summaryCache, setSummaryCache] = useState<Record<string, ReportSummaryEntry>>({})
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set())

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed) {
      setError("Please enter a search term.")
      return
    }
    setError(null)
    setStatus("searching")
    const res = await searchIndustryReports(entityId, trimmed, preferPdf)
    if (res.ok) {
      setResults(res.results)
      setStatus("done")
      const urls = res.results.map((r) => r.url)
      const summaries = await getSummariesForUrls(urls)
      setSummaryCache(summaries)
    } else {
      setResults([])
      setStatus("failed")
      setError(res.error)
    }
  }, [entityId, query, preferPdf])

  const handleSummaryReady = useCallback((url: string, summary: ReportSummaryEntry) => {
    setSummaryCache((prev) => ({ ...prev, [url]: summary }))
  }, [])

  const handleSave = useCallback((result: SearchResult) => {
    setSavedUrls((prev) => new Set(prev).add(result.url))
  }, [])

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-800">Search Industry Reports</h3>
        <p className="text-sm text-slate-600 mt-1">
          Search approved sources (CBRE, JLL, MBA, MHN, CommercialSearch) via Google. Results are strictly filtered to allowed domains. Summarize on demand; summaries are cached.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">Source</label>
          <select
            value={entityId}
            onChange={(e) => setEntityId(e.target.value as EntityId)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-800 min-w-[200px]"
          >
            {ENTITY_DROPDOWN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label className="text-xs font-medium text-slate-600">Keywords</label>
          <Input
            placeholder="e.g. multifamily outlook 2026"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="prefer-pdf"
            checked={preferPdf}
            onCheckedChange={(v) => setPreferPdf(Boolean(v))}
          />
          <label htmlFor="prefer-pdf" className="text-xs font-medium text-slate-600 cursor-pointer">
            Prefer PDFs
          </label>
        </div>
        <Button
          onClick={handleSearch}
          disabled={status === "searching"}
          className="shrink-0"
        >
          {status === "searching" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Search className="h-4 w-4 mr-2" />
          )}
          Search
        </Button>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {status === "done" && results.length === 0 && !error && (
        <div className="mt-4 rounded-md border border-border px-3 py-4 text-sm text-slate-600">
          No results found. Try different keywords or a broader source.
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-medium text-slate-600">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
          {results.map((result) => (
            <SearchResultRow
              key={result.id}
              result={result}
              entityId={entityId}
              summaryCache={summaryCache[result.url] ?? null}
              onSummaryReady={handleSummaryReady}
              saved={savedUrls.has(result.url)}
              onSave={handleSave}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
