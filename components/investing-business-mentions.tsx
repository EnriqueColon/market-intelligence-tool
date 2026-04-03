"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Info } from "lucide-react"
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
  fetchInvestingNews,
  type InvestingNewsResponse,
} from "@/app/actions/fetch-investing-news"
import { summarizeNewsItem, type NewsBrief, type NewsSummaryInput } from "@/app/actions/fetch-news-summary"
import type { PublicMentionItem } from "@/app/actions/fetch-public-mentions"

interface InvestingBusinessMentionsProps {
  level: "national" | "florida" | "miami"
}

const cache = new Map<string, PublicMentionItem[]>()
const inflight = new Map<string, Promise<InvestingNewsResponse["news"]>>()
const CACHE_VERSION = "investing_news:v1"

export function InvestingBusinessMentions({ level }: InvestingBusinessMentionsProps) {
  const [news, setNews] = useState<PublicMentionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | undefined>()
  const [selected, setSelected] = useState<NewsSummaryInput | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | undefined>()
  const [brief, setBrief] = useState<NewsBrief | null>(null)
  const [activeTopic, setActiveTopic] = useState<string>("All")

  const regionLabel = (region?: PublicMentionItem["region"]) => {
    if (region === "miami") return "Miami Metro"
    if (region === "florida") return "Florida"
    return "National"
  }

  const topics = ["All", ...Array.from(new Set(news.map((n) => n.topic).filter(Boolean))).sort()]

  const visibleNews = activeTopic === "All" ? news : news.filter((n) => n.topic === activeTopic)

  useEffect(() => {
    setActiveTopic("All")
  }, [level])

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
        req = fetchInvestingNews(level).then((res) => res.news)
        inflight.set(cacheKey, req)
      }
      try {
        const items = await req
        if (!mounted) return
        if (items.length > 0) cache.set(cacheKey, items)
        setNews(items)
        setNote(items.length === 0 ? "No general finance news (non–real estate) for this region." : undefined)
      } catch (err) {
        if (!mounted) return
        const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
        const message =
          raw === "Failed to fetch" || raw.toLowerCase().includes("failed to fetch")
            ? "Unable to connect. Ensure the dev server is running (npm run dev) and refresh."
            : `Failed to load investing news: ${raw}`
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
          <div className="text-base font-semibold text-slate-800">General Finance News</div>
          <p className="text-sm text-slate-900">
            Non–real estate finance: Fed, rates, earnings, M&A, IPOs, banking, credit & debt markets, fiscal policy, regulation/SEC. Real estate news is in Industry Specific News. US, Florida, Miami (past 7 days).
          </p>
        </div>
        {note && <p className="text-xs text-slate-900">{note}</p>}
      </div>
      {topics.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {topics.map((topic) => (
            <button
              key={topic}
              onClick={() => setActiveTopic(topic)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeTopic === topic
                  ? "bg-[#006D95] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {topic}
              {topic !== "All" && (
                <span className="ml-1 opacity-60">
                  {news.filter((n) => n.topic === topic).length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4" aria-busy={loading}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Topic</TableHead>
              <TableHead>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1 cursor-default">
                        Access <Info className="h-3 w-3 text-slate-400" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px] space-y-1.5 p-3 text-xs">
                      <div className="flex items-start gap-2"><span>🟢</span><span><strong>Open</strong> — Full article text fetched. Brief uses complete content.</span></div>
                      <div className="flex items-start gap-2"><span>🟡</span><span><strong>Partial</strong> — Article loaded but only a preview/snippet was accessible. Some content requires login or subscription.</span></div>
                      <div className="flex items-start gap-2"><span>🔒</span><span><strong>Paywalled</strong> — Full article is behind a paywall. Brief uses headline and public snippet only.</span></div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
              <TableHead>Link</TableHead>
              <TableHead>Brief</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {news.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-sm text-slate-900">
                  No general finance news (non–real estate) in past 7 days.
                </TableCell>
              </TableRow>
            )}
            {[...visibleNews].sort((a, b) => {
              const order = { open: 0, partial: 1, paywalled: 2 } as const
              return (order[a.access_status] ?? 1) - (order[b.access_status] ?? 1)
            }).map((item, index) => (
              <TableRow key={`${item.id}-${item.url || "no-url"}-${item.date || "no-date"}-${index}`}>
                <TableCell className="max-w-[520px]">
                  <HoverCard openDelay={250}>
                    <HoverCardTrigger asChild>
                      <Button variant="link" className="h-auto p-0 text-left whitespace-normal">
                        {item.title}
                      </Button>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-[420px] space-y-2">
                      <div className="text-xs font-semibold text-slate-900 uppercase">Preview</div>
                      <div className="text-sm text-slate-800">{item.snippet || "No preview available."}</div>
                      {item.detection_reason && (
                        <div className="rounded bg-[#006D95]/8 border border-[#006D95]/20 px-2 py-1.5">
                          <span className="text-xs font-semibold text-[#006D95]">Why flagged: </span>
                          <span className="text-xs text-slate-700">{item.detection_reason}</span>
                        </div>
                      )}
                      <div className="text-xs text-slate-900">
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
                  {item.access_status === "paywalled" ? (
                    <span className="text-xs text-slate-400 italic">Paywalled</span>
                  ) : (
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
                  )}
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
            <DialogTitle>Investing business brief</DialogTitle>
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
                <div className="text-sm text-slate-800 leading-relaxed">{brief.executiveSummary}</div>

                {brief.dealSpecifics && Object.values(brief.dealSpecifics).some(Boolean) && (
                  <div className="rounded-lg border border-[#006D95]/20 bg-[#006D95]/5 p-3">
                    <div className="text-xs font-semibold text-[#006D95] uppercase mb-2">Deal Specifics</div>
                    <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      {brief.dealSpecifics.assetType && <div className="text-xs text-slate-700"><span className="font-medium">Asset Type:</span> {brief.dealSpecifics.assetType}</div>}
                      {brief.dealSpecifics.location && <div className="text-xs text-slate-700"><span className="font-medium">Location:</span> {brief.dealSpecifics.location}</div>}
                      {brief.dealSpecifics.loanAmount && <div className="text-xs text-slate-700"><span className="font-medium">Loan Amount:</span> {brief.dealSpecifics.loanAmount}</div>}
                      {brief.dealSpecifics.lender && <div className="text-xs text-slate-700"><span className="font-medium">Lender:</span> {brief.dealSpecifics.lender}</div>}
                      {brief.dealSpecifics.borrower && <div className="text-xs text-slate-700"><span className="font-medium">Borrower:</span> {brief.dealSpecifics.borrower}</div>}
                      {brief.dealSpecifics.dealStatus && <div className="text-xs text-slate-700"><span className="font-medium">Status:</span> {brief.dealSpecifics.dealStatus}</div>}
                    </div>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-900 uppercase">Key bullets</div>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {brief.keyBullets.map((b, idx) => (
                        <li key={`kb-${idx}`}>{b}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-900 uppercase">Why it matters</div>
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
                        <div className="text-xs font-semibold text-slate-900 uppercase">Entities</div>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {brief.entities.map((b, idx) => (
                            <li key={`en-${idx}`}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {brief.redFlags.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-900 uppercase">
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
                  <div className="text-xs font-semibold text-slate-900 uppercase">Follow-ups</div>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {brief.followUps.map((b, idx) => (
                      <li key={`fu-${idx}`}>{b}</li>
                    ))}
                  </ul>
                </div>

                <div className="text-xs text-slate-900">
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
