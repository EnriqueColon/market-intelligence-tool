"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  fetchPublicMentions,
  type PublicMentionItem,
} from "@/app/actions/fetch-public-mentions"
import { summarizeNewsItem, type NewsBrief, type NewsSummaryInput } from "@/app/actions/fetch-news-summary"

interface PublicMentionsProps {
  level: "national" | "florida" | "miami"
}

const cache = new Map<string, PublicMentionItem[]>()
const inflight = new Map<string, Promise<PublicMentionItem[]>>()
const CACHE_VERSION = "public_mentions:v3"

export function PublicMentions({ level }: PublicMentionsProps) {
  const [news, setNews] = useState<PublicMentionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | undefined>()
  const [selected, setSelected] = useState<NewsSummaryInput | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | undefined>()
  const [brief, setBrief] = useState<NewsBrief | null>(null)

  const regionLabel = (region?: PublicMentionItem["region"]) => {
    if (region === "miami") return "Miami Metro"
    if (region === "florida") return "Florida"
    return "National"
  }

  useEffect(() => {
    let mounted = true
    async function loadData() {
      const cacheKey = `${level}:${CACHE_VERSION}`
      const cached = cache.get(cacheKey)
      if (cached) {
        setNews(cached)
        setNote(undefined)
        setLoading(false)
        return
      }
      setLoading(true)
      let req = inflight.get(cacheKey)
      if (!req) {
        req = fetchPublicMentions(level).then((res) => res.news)
        inflight.set(cacheKey, req)
      }
      try {
        const items = await req
        if (!mounted) return
        if (items.length > 0) cache.set(cacheKey, items)
        setNews(items)
        setNote(items.length === 0 ? "No public mentions returned for this region." : undefined)
      } catch (err) {
        if (!mounted) return
        const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
        const message =
          raw === "Failed to fetch" || raw.toLowerCase().includes("failed to fetch")
            ? "Unable to connect. Ensure the dev server is running (npm run dev) and refresh."
            : `Failed to load public mentions: ${raw}`
        setNews([])
        setNote(message)
      } finally {
        inflight.delete(cacheKey)
        if (mounted) setLoading(false)
      }
    }
    loadData()
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
  }, [summaryOpen, selected, level])

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-slate-800">Industry Specific News</div>
          <p className="text-sm text-slate-600">
            Region-aware mentions of distressed CRE debt activity (past 7 days).
          </p>
        </div>
        {note && <p className="text-xs text-slate-600">{note}</p>}
      </div>
      <div className="mt-4" aria-busy={loading}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Topic</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Link</TableHead>
              <TableHead>Brief</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {news.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-slate-600">
                  No qualifying mentions in past 7 days.
                </TableCell>
              </TableRow>
            )}
            {news.map((item, index) => (
              <TableRow key={`${item.id}-${item.url || "no-url"}-${item.date || "no-date"}-${index}`}>
                <TableCell className="max-w-[520px]">
                  <HoverCard openDelay={250}>
                    <HoverCardTrigger asChild>
                      <Button variant="link" className="h-auto p-0 text-left whitespace-normal">
                        {item.title}
                      </Button>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-[420px] space-y-2">
                      <div className="text-xs font-semibold text-slate-600 uppercase">Preview</div>
                      <div className="text-sm text-slate-800">{item.snippet || "No preview available."}</div>
                      <div className="text-xs text-slate-600">
                        {item.source || "—"}
                        {item.date ? ` • ${item.date}` : ""}
                        {item.url ? (
                          <>
                            {" "}
                            •{" "}
                            <a className="text-primary underline" href={item.url} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          </>
                        ) : null}
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                </TableCell>
                <TableCell>{item.source || "—"}</TableCell>
                <TableCell>{item.date || "—"}</TableCell>
                <TableCell>{regionLabel(item.region)}</TableCell>
                <TableCell>{item.topic}</TableCell>
                <TableCell>
                  {item.access_status === "open" ? "🟢 open" : item.access_status === "partial" ? "🟡 partial" : "🔒 paywalled"}
                </TableCell>
                <TableCell>
                  {item.url ? (
                    <a className="text-primary underline" href={item.resolved_url || item.url} target="_blank" rel="noreferrer">
                      View
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSelected({
                        title: item.title,
                        url: item.resolved_url || item.url,
                        source: item.source,
                        date: item.date,
                        summary: item.snippet,
                      })
                      setSummaryOpen(true)
                    }}
                  >
                    Brief
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

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
            <DialogTitle>Public mention brief</DialogTitle>
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
                <div className="text-sm text-slate-800">{brief.executiveSummary}</div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-600 uppercase">Key bullets</div>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {brief.keyBullets.map((b, idx) => (
                        <li key={`kb-${idx}`}>{b}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-600 uppercase">Why it matters</div>
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
                        <div className="text-xs font-semibold text-slate-600 uppercase">Entities</div>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {brief.entities.map((b, idx) => (
                            <li key={`en-${idx}`}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {brief.redFlags.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-600 uppercase">
                          Red flags / gaps
                        </div>
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
                  <div className="text-xs font-semibold text-slate-600 uppercase">Follow-ups</div>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {brief.followUps.map((b, idx) => (
                      <li key={`fu-${idx}`}>{b}</li>
                    ))}
                  </ul>
                </div>

                <div className="text-xs text-slate-600">
                  Confidence: <span className="font-medium text-slate-800">{brief.confidence}/100</span>
                  {brief.notes?.length ? <span className="ml-2">• {brief.notes.join(" ")}</span> : null}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
