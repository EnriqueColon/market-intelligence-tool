"use client"

import { Card } from "@/components/ui/card"
import { ExternalLink, Newspaper } from "lucide-react"
import { useEffect, useState } from "react"
import { fetchNewsHeadlines } from "@/app/actions/fetch-news"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { summarizeNewsItem, type NewsBrief, type NewsSummaryInput } from "@/app/actions/fetch-news-summary"

interface NewsHeadlinesProps {
  level: "national" | "florida" | "miami"
}

interface NewsItem {
  title: string
  url: string
  resolved_url?: string
  source: string
  date: string
  summary: string
  access_status?: "open" | "partial" | "paywalled"
  detection_reason?: string
  extracted_text_length_chars?: number
  summarization_mode?: "full_summary" | "intelligence_brief" | "paywall_signal"
  confidence_label?: "High" | "Medium" | "Low"
}

const newsCache = new Map<string, NewsItem[]>()
const inflightRequests = new Map<string, Promise<NewsItem[]>>()
const NEWS_CACHE_VERSION = "v22-local-us-gate-fix"

export function NewsHeadlines({ level }: NewsHeadlinesProps) {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | undefined>()
  const [selected, setSelected] = useState<NewsSummaryInput | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | undefined>()
  const [brief, setBrief] = useState<NewsBrief | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadNews() {
      const cacheKey = `${level}:${NEWS_CACHE_VERSION}`
      const cached = newsCache.get(cacheKey)
      if (cached) {
        setNews(cached)
        setNote(undefined)
        setLoading(false)
        return
      }

      setLoading(true)
      let request = inflightRequests.get(cacheKey)

      if (!request) {
        request = fetchNewsHeadlines(level)
        inflightRequests.set(cacheKey, request)
      }

      try {
        const headlines = await request
        // Cache only non-empty results to avoid "sticking" an empty session cache.
        if (headlines.length > 0) newsCache.set(cacheKey, headlines)
        if (mounted) setNews(headlines)
        if (mounted && headlines.length === 0) {
          setNote("No headlines returned. Check network access (RSS/GDELT).")
        } else if (mounted) {
          setNote(undefined)
        }
      } catch {
        // Avoid unhandled promise rejections bubbling into Next dev overlay.
        if (mounted) setNews([])
        if (mounted) setNote("Failed to load headlines (network or API issue).")
      } finally {
        inflightRequests.delete(cacheKey)
        if (mounted) {
          setLoading(false)
        }
      }
    }

    loadNews()
    return () => {
      mounted = false
    }
  }, [level])

  useEffect(() => {
    let mounted = true
    async function loadSummary() {
      if (!summaryOpen || !selected) return
      setSummaryLoading(true)
      setSummaryError(undefined)
      setBrief(null)
      try {
        const result = await summarizeNewsItem({ ...selected, level })
        if (!mounted) return
        setBrief(result)
      } catch (err) {
        if (!mounted) return
        const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
        setSummaryError(message)
      } finally {
        if (mounted) setSummaryLoading(false)
      }
    }
    loadSummary()
    return () => {
      mounted = false
    }
  }, [summaryOpen, selected])

  const levelLabels = {
    national: "U.S. Commercial Real Estate",
    florida: "Florida Commercial Real Estate",
    miami: "Miami Metro Commercial Real Estate",
  }

  return (
    <Card className="p-6 bg-card/50 backdrop-blur border-border/50">
      <div className="flex items-center gap-2 mb-4">
        <Newspaper className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Latest News: {levelLabels[level]}</h2>
        <span className="text-xs text-muted-foreground ml-auto">Past 7 Days</span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
          {news.length === 0 ? (
            <div className="text-sm text-muted-foreground">No headlines available right now.</div>
          ) : null}
          {news.map((item, index) => (
            <div
              key={index}
              className="block rounded-lg p-3 transition-colors hover:bg-accent/50"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <HoverCard openDelay={250}>
                    <HoverCardTrigger asChild>
                      <Button
                        variant="link"
                        className="h-auto p-0 text-left whitespace-normal font-medium text-foreground hover:text-primary"
                        onClick={() => {
                          setSelected({
                            title: item.title,
                            url: item.resolved_url || item.url,
                            source: item.source,
                            date: item.date,
                            summary: item.summary,
                          })
                          setSummaryOpen(true)
                        }}
                      >
                        <span className="line-clamp-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="mr-2">
                                {item.access_status === "open"
                                  ? "🟢"
                                  : item.access_status === "partial"
                                    ? "🟡"
                                    : "🔒"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent sideOffset={6}>
                              {item.access_status === "open"
                                ? "Open access (full summary)"
                                : item.access_status === "partial"
                                  ? "Partial access — brief uses publicly available info only"
                                  : "Paywalled/blocked — signal summary only"}
                            </TooltipContent>
                          </Tooltip>
                          {item.title}
                        </span>
                      </Button>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-[420px] space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground uppercase">Quick preview</div>
                      <div className="text-sm text-foreground">{item.summary || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.source} • {item.date} •{" "}
                        <a
                          className="text-primary underline"
                          href={item.resolved_url || item.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{item.summary}</p>
                  {item.access_status && item.access_status !== "open" ? (
                    <p className="text-xs text-muted-foreground">
                      Summary based on publicly available info only.{" "}
                      <a
                        className="text-primary underline"
                        href={item.resolved_url || item.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </a>
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{item.source}</span>
                    <span>•</span>
                    <span>{item.date}</span>
                  </div>
                </div>
                <a
                  href={item.resolved_url || item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 flex-shrink-0 text-muted-foreground hover:text-primary"
                  title="Open article"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={summaryOpen}
        onOpenChange={(open) => {
          setSummaryOpen(open)
          if (!open) {
            setBrief(null)
            setSummaryError(undefined)
            setSummaryLoading(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>News summary</DialogTitle>
            <DialogDescription>
              {selected?.source ? `${selected.source}` : "Unknown source"}
              {selected?.date ? ` • ${selected.date}` : ""}
              {selected?.url ? (
                <>
                  {" "}
                  •{" "}
                  <a className="text-primary underline" href={selected.url} target="_blank" rel="noreferrer">
                    Open article
                  </a>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {selected?.title ? <div className="text-sm font-semibold">{selected.title}</div> : null}

            {summaryLoading && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-10/12" />
                <Skeleton className="h-20 w-full" />
              </div>
            )}

            {!summaryLoading && summaryError && (
              <div className="text-sm text-destructive">Failed to generate summary: {summaryError}</div>
            )}

            {!summaryLoading && brief && (
              <div className="space-y-4">
                {brief.banner ? (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
                    <span>{brief.banner}</span>
                    {brief.url ? (
                      <>
                        {" "}
                        <a className="text-primary underline" href={brief.url} target="_blank" rel="noreferrer">
                          Open article
                        </a>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      Status:{" "}
                      <span className="font-medium text-foreground">
                        {brief.access_status === "open"
                          ? "🟢 open"
                          : brief.access_status === "partial"
                            ? "🟡 partial"
                            : "🔒 paywalled"}
                      </span>
                    </span>
                    <span>•</span>
                    <span>Mode: {brief.summarization_mode}</span>
                    <span>•</span>
                    <span>Confidence: {brief.confidence}/100</span>
                  </div>
                  <div className="mt-1">
                    HTTP: {brief.http_status || "—"} • HTML chars: {brief.content_length_chars} • Extracted chars:{" "}
                    {brief.extracted_text_length_chars} • Reason: {brief.detection_reason}
                  </div>
                </div>

                <div className="text-sm text-foreground">{brief.executiveSummary}</div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase">Key bullets</div>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {brief.keyBullets.map((b, idx) => (
                        <li key={`kb-${idx}`}>{b}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase">Why it matters</div>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {brief.whyItMatters.map((b, idx) => (
                        <li key={`wm-${idx}`}>{b}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {(brief.entities.length > 0 || brief.redFlags.length > 0) && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {brief.entities.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Entities</div>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {brief.entities.map((b, idx) => (
                            <li key={`en-${idx}`}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {brief.redFlags.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Red flags / gaps</div>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {brief.redFlags.map((b, idx) => (
                            <li key={`rf-${idx}`}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Follow-ups</div>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {brief.followUps.map((b, idx) => (
                      <li key={`fu-${idx}`}>{b}</li>
                    ))}
                  </ul>
                </div>

                {brief.relatedOpenSources?.length ? (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase">Related open sources</div>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {brief.relatedOpenSources.map((x, idx) => (
                        <li key={`rel-${idx}`}>
                          <a className="text-primary underline" href={x.url} target="_blank" rel="noreferrer">
                            {x.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {brief.notes?.length ? (
                  <div className="text-xs text-muted-foreground">Notes: {brief.notes.join(" ")}</div>
                ) : null}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
