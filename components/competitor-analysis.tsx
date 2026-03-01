"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import {
  fetchAomFirmGraph,
  fetchAomFirmInsights,
  fetchAomSummary,
  searchAom,
  type AomFirmGraph,
  type AomFirmInsights,
  type AomSummary,
  type AomEventRow,
} from "@/app/actions/fetch-aom-data"
import { ParticipantLookup } from "@/components/participant-lookup"
import { FirmProfilePanel } from "@/components/firm-profile-panel"
import { ParticipantExecutiveSnapshot } from "@/components/participant-executive-snapshot"
import type { FirmProfile } from "@/app/actions/participant-lookup"

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

function formatNumber(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return numberFormatter.format(value)
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function buildLinePath(values: number[], width: number, height: number, maxY: number) {
  const n = values.length
  if (n === 0) return ""
  const innerW = Math.max(1, width - 2)
  const innerH = Math.max(1, height - 2)
  const dx = n > 1 ? innerW / (n - 1) : 0
  const denom = maxY > 0 ? maxY : 1
  let d = ""
  for (let i = 0; i < n; i += 1) {
    const x = 1 + i * dx
    const v = values[i] ?? 0
    const y = 1 + innerH - (clamp(v, 0, denom) / denom) * innerH
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`
  }
  return d
}

function MiniFirmMonthlyChart(props: {
  months: Array<{ month: string; inbound: number; outbound: number }>
}) {
  const width = 240
  const height = 90
  const inbound = props.months.map((m) => m.inbound ?? 0)
  const outbound = props.months.map((m) => m.outbound ?? 0)
  const maxY = Math.max(0, ...inbound, ...outbound)

  const inboundPath = buildLinePath(inbound, width, height, maxY)
  const outboundPath = buildLinePath(outbound, width, height, maxY)

  const left = props.months[0]?.month
  const right = props.months[props.months.length - 1]?.month
  const lastIn = inbound.length ? inbound[inbound.length - 1] : 0
  const lastOut = outbound.length ? outbound[outbound.length - 1] : 0

  const n = props.months.length
  const monthNum = (m?: string) => {
    const mm = (m || "").split("-")[1]
    return mm && /^\d{2}$/.test(mm) ? mm : (m || "").slice(-2)
  }
  const tickIdx = (() => {
    if (n <= 1) return []
    if (n <= 6) return Array.from({ length: n }, (_, i) => i)
    const out: number[] = [0]
    const step = n <= 18 ? 3 : 6
    for (let i = step; i < n - 1; i += step) out.push(i)
    out.push(n - 1)
    return Array.from(new Set(out))
  })()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
        <span className="truncate">{left && right ? `${left} → ${right}` : "Monthly trend"}</span>
        <span className="tabular-nums">
          In {formatNumber(lastIn)} • Out {formatNumber(lastOut)}
        </span>
      </div>
      <div className="flex items-center gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-blue-500" /> <span className="text-slate-800">Blue</span> = Inbound
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-orange-500" /> <span className="text-slate-800">Orange</span> = Outbound
        </span>
      </div>
      {props.months.length < 2 ? (
        <div className="text-xs text-slate-600">Not enough monthly points to chart.</div>
      ) : (
        <svg width={width} height={height + 18} className="block overflow-visible">
          <rect x="0" y="0" width={width} height={height} rx="8" className="fill-muted/30 stroke-border" />
          {maxY > 0 ? (
            <>
              <path d={inboundPath} fill="none" stroke="rgb(59 130 246)" strokeWidth="2" />
              <path d={outboundPath} fill="none" stroke="rgb(249 115 22)" strokeWidth="2" />
            </>
          ) : (
            <text x={width / 2} y={height / 2} textAnchor="middle" className="fill-muted-foreground text-xs">
              No monthly volume
            </text>
          )}

          {/* X-axis month numbers */}
          {tickIdx.map((i) => {
            const x = 1 + (n > 1 ? ((width - 2) / (n - 1)) * i : 0)
            const label = monthNum(props.months[i]?.month)
            return (
              <g key={`tick-${i}`}>
                <line x1={x} x2={x} y1={height - 6} y2={height - 2} stroke="rgb(148 163 184)" strokeWidth="1" />
                <text
                  x={x}
                  y={height + 12}
                  textAnchor="middle"
                  fontSize="10"
                  fill="rgb(100 116 139)"
                >
                  {label}
                </text>
              </g>
            )
          })}
        </svg>
      )}
      <div className="flex items-center justify-between gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-blue-500" /> Inbound (→ assignee)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-orange-500" /> Outbound (assignor →)
        </span>
      </div>
    </div>
  )
}

export function CompetitorAnalysis() {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<AomSummary | undefined>()

  const [insightsLoading, setInsightsLoading] = useState(true)
  const [insights, setInsights] = useState<AomFirmInsights | undefined>()
  const [scope, setScope] = useState<"all" | "watchlist">("all")
  const [monthsBack, setMonthsBack] = useState(24)
  const [excludeMajorBanks, setExcludeMajorBanks] = useState(true)

  const [selectedFirm, setSelectedFirm] = useState<string>("")
  const [counterpartyLoading, setCounterpartyLoading] = useState(false)
  const [counterpartyData, setCounterpartyData] = useState<AomFirmGraph | undefined>()
  const [minEdgeCount, setMinEdgeCount] = useState(3)

  const [query, setQuery] = useState("")
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchRows, setSearchRows] = useState<AomEventRow[]>([])
  const [searchNotes, setSearchNotes] = useState<string[]>([])

  const [lookupProfile, setLookupProfile] = useState<FirmProfile | undefined>()
  const drilldownSectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const data = await fetchAomSummary({ limitParties: 15, months: 24 })
        if (!data || typeof data !== "object" || typeof (data as any).totalEvents !== "number") {
          throw new Error("AOM summary returned an invalid response.")
        }
        if (!mounted) return
        setSummary(data)
      } catch (err) {
        if (!mounted) return
        const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
        const hint =
          raw === "Failed to fetch" || String(raw).toLowerCase().includes("failed to fetch")
            ? "Unable to connect. Ensure the dev server is running (npm run dev) and refresh."
            : "If you just changed files, restart dev server and refresh."
        setSummary({
          totalEvents: 0,
          docTypeCounts: [],
          topAssignors: [],
          topAssignees: [],
          monthlyCounts: [],
          notes: [`Failed to load AOM data: ${raw}`, hint],
        })
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const hasData = (summary?.totalEvents ?? 0) > 0

  const monthly = useMemo(() => summary?.monthlyCounts ?? [], [summary])
  const firms = useMemo(() => insights?.firms ?? [], [insights])

  useEffect(() => {
    let mounted = true
    async function loadInsights() {
      setInsightsLoading(true)
      try {
        const data = await fetchAomFirmInsights({
          scope,
          months: monthsBack,
          limitFirms: 25,
          unmatchedLimit: 25,
          excludeMajorBanks,
        })
        if (!data || typeof data !== "object" || !Array.isArray((data as any).firms)) {
          throw new Error("Firm rollups returned an invalid response.")
        }
        if (!mounted) return
        setInsights(data)
      } catch (err) {
        if (!mounted) return
        const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
        const hint =
          raw === "Failed to fetch" || String(raw).toLowerCase().includes("failed to fetch")
            ? "Ensure the dev server is running (npm run dev) and refresh."
            : ""
        setInsights({
          scope,
          totalEventsScanned: 0,
          months: [],
          firms: [],
          unmatched: [],
          notes: [`Failed to load firm rollups: ${raw}`, hint].filter(Boolean),
        })
      } finally {
        if (mounted) setInsightsLoading(false)
      }
    }
    loadInsights()
    return () => {
      mounted = false
    }
  }, [scope, monthsBack, excludeMajorBanks])

  useEffect(() => {
    let mounted = true
    async function loadCounterparties() {
      const firm = (selectedFirm || "").trim()
      if (!firm) {
        setCounterpartyData(undefined)
        return
      }
      setCounterpartyLoading(true)
      try {
        const data = await fetchAomFirmGraph({
          scope,
          monthsBack,
          focalFirm: firm,
          depth: 1,
          minEdgeCount,
          maxNodes: 60,
          maxEdges: 250,
        })
        if (!data || typeof data !== "object" || !Array.isArray((data as any).nodes)) {
          throw new Error("Firm counterparties returned an invalid response.")
        }
        if (!mounted) return
        setCounterpartyData(data)
      } catch (err) {
        if (!mounted) return
        const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
        const hint =
          raw === "Failed to fetch" || String(raw).toLowerCase().includes("failed to fetch")
            ? "Ensure the dev server is running (npm run dev) and refresh."
            : ""
        setCounterpartyData({
          scope,
          monthsBack,
          focalFirm: firm,
          depth: 1,
          minEdgeCount,
          nodes: [],
          links: [],
          outbound: [],
          inbound: [],
          notes: [`Failed to load firm counterparties: ${raw}`, hint].filter(Boolean),
        })
      } finally {
        if (mounted) setCounterpartyLoading(false)
      }
    }
    loadCounterparties()
    return () => {
      mounted = false
    }
  }, [selectedFirm, scope, monthsBack, minEdgeCount])

  async function runSearch() {
    const trimmed = query.trim()
    if (!trimmed) {
      setSearchRows([])
      setSearchNotes(["Enter a party name to search."])
      return
    }
    setSearchLoading(true)
    try {
      const res = await searchAom({ query: trimmed, limit: 75 })
      setSearchRows(res.rows)
      setSearchNotes(res.notes)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
      setSearchRows([])
      setSearchNotes([`Search failed: ${message}`])
    } finally {
      setSearchLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <ParticipantExecutiveSnapshot />

      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Market Participants & Activity (AOM)</h3>
            <p className="text-sm text-slate-600">
              Miami-Dade Assignment of Mortgage events (AOM). Use party flows to benchmark active servicers/lenders.
            </p>
          </div>
          <p className="text-xs text-slate-600">Source: Miami-Dade Clerk (AOM exports) • Local `data/aom.sqlite`</p>
        </div>

        {summary?.notes?.length ? (
          <div className="mt-3 rounded-md border border-border px-3 py-2">
            <p className="text-xs font-semibold text-slate-600 uppercase">Notes</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
              {summary.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Card className="p-3">
            <p className="text-xs text-slate-600">Total Events</p>
            <p className="text-sm font-semibold text-slate-800">{loading ? "…" : formatNumber(summary?.totalEvents)}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-slate-600">Date Range</p>
            <p className="text-sm font-semibold text-slate-800">
              {loading ? "…" : summary?.dateMin && summary?.dateMax ? `${summary.dateMin} → ${summary.dateMax}` : "—"}
            </p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-slate-600">Months Loaded</p>
            <p className="text-sm font-semibold text-slate-800">{loading ? "…" : formatNumber(monthly.length)}</p>
          </Card>
        </div>
      </Card>

      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-800">Firm Rollups (Entity-Resolved)</h4>
            <p className="text-xs text-slate-600">
              Canonical firms + aliases roll up AOM parties into one view (inbound/outbound/net + monthly trend).
              Use &quot;Exclude major banks&quot; to focus on possible competitors.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeMajorBanks}
                onChange={(e) => setExcludeMajorBanks(e.target.checked)}
                className="rounded border-border"
              />
              Exclude major banks
            </label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "all" | "watchlist")}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-800"
            >
              <option value="all">All parties</option>
              <option value="watchlist">Watchlist only</option>
            </select>
            <select
              value={monthsBack}
              onChange={(e) => setMonthsBack(Number(e.target.value))}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-800"
            >
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
              <option value={24}>Last 24 months</option>
              <option value={36}>Last 36 months</option>
              <option value={48}>Last 48 months</option>
            </select>
            <p className="text-xs text-slate-600">
              Scanned: {insightsLoading ? "…" : formatNumber(insights?.totalEventsScanned)}
            </p>
          </div>
        </div>

        {insights?.notes?.length ? (
          <div className="mt-3 text-xs text-slate-600">{insights.notes.join(" ")}</div>
        ) : null}

        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Firm</TableHead>
                <TableHead>Inbound</TableHead>
                <TableHead>Outbound</TableHead>
                <TableHead>Net</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>30d</TableHead>
                <TableHead>90d</TableHead>
                <TableHead>Trend</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead>Top Counterparties</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {firms.map((f) => (
                <TableRow
                  key={f.firm}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelectedFirm(f.firm)
                  }}
                  title="Click to view relationship map"
                >
                  <TableCell className="max-w-[260px] truncate">
                    <div className="flex items-center gap-2 flex-wrap">
                      <HoverCard openDelay={150} closeDelay={50}>
                        <HoverCardTrigger asChild>
                          <span className="underline-offset-2 hover:underline" title="Hover to preview inbound/outbound trend">
                            {f.firm}
                          </span>
                        </HoverCardTrigger>
                      <HoverCardContent className="w-[290px] p-3">
                        <div className="text-xs font-semibold text-slate-800 mb-2">Monthly Inbound vs Outbound</div>
                        <MiniFirmMonthlyChart months={f.monthly ?? []} />
                        <div className="mt-2 text-[11px] text-slate-600">
                          Tip: click row to load the relationship map.
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                    {f.role && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {f.role}
                      </Badge>
                    )}
                    </div>
                  </TableCell>
                  <TableCell>{formatNumber(f.inbound)}</TableCell>
                  <TableCell>{formatNumber(f.outbound)}</TableCell>
                  <TableCell className={f.net > 0 ? "text-emerald-600" : f.net < 0 ? "text-rose-600" : ""}>
                    {f.net > 0 ? "+" : ""}
                    {formatNumber(f.net)}
                  </TableCell>
                  <TableCell>{formatNumber(f.total)}</TableCell>
                  <TableCell title={`30d: net ${f.net_30d ?? "—"}, total ${f.total_30d ?? "—"}`}>
                    {formatNumber(f.total_30d)}
                  </TableCell>
                  <TableCell title={`90d: net ${f.net_90d ?? "—"}, total ${f.total_90d ?? "—"}`}>
                    {formatNumber(f.total_90d)}
                  </TableCell>
                  <TableCell>
                    {f.trend_30d && f.trend_90d ? (
                      <span className="text-xs" title={`30d: ${f.trend_30d}, 90d: ${f.trend_90d}`}>
                        {f.trend_30d === "up" && "↗"}
                        {f.trend_30d === "down" && "↘"}
                        {f.trend_30d === "flat" && "→"}
                        <span className="text-slate-600 ml-0.5">
                          {f.trend_90d === "up" && "↗"}
                          {f.trend_90d === "down" && "↘"}
                          {f.trend_90d === "flat" && "→"}
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{f.lastEventDate || "—"}</TableCell>
                  <TableCell className="max-w-[340px] truncate text-xs text-slate-600">
                    {f.topCounterparties
                      .slice(0, 3)
                      .map((c) => `${c.name} (${formatNumber(c.count)})`)
                      .join(", ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
              {firms.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-slate-600">
                    {insightsLoading ? "Loading firm rollups…" : "No rollups in this scope."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div ref={drilldownSectionRef} className="w-full">
        <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-800">Firm Counterparty Drilldown</h4>
            <p className="text-xs text-slate-600">
              A clearer view of relationships: top inbound/outbound counterparties and direct assignor → assignee flows involving the selected firm.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedFirm}
              onChange={(e) => setSelectedFirm(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-800"
            >
              <option value="">Select a firm…</option>
              {lookupProfile && !firms.some((f) => f.firm === lookupProfile.canonicalName) && (
                <option value={lookupProfile.canonicalName}>{lookupProfile.canonicalName}</option>
              )}
              {firms.map((f) => (
                <option key={f.firm} value={f.firm}>
                  {f.firm}
                </option>
              ))}
            </select>
            <select
              value={minEdgeCount}
              onChange={(e) => setMinEdgeCount(Number(e.target.value))}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-800"
              title="Hide weaker counterparties/flows"
            >
              <option value={1}>Min flow 1</option>
              <option value={2}>Min flow 2</option>
              <option value={3}>Min flow 3</option>
              <option value={5}>Min flow 5</option>
              <option value={10}>Min flow 10</option>
            </select>
            <button
              onClick={() => setSelectedFirm("")}
              className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-slate-800"
              disabled={!selectedFirm}
            >
              Clear
            </button>
          </div>
        </div>

        {counterpartyData?.notes?.length ? (
          <div className="mt-3 text-xs text-slate-600">{counterpartyData.notes.join(" ")}</div>
        ) : null}

        {!selectedFirm ? (
          <div className="mt-4 text-sm text-slate-600">Pick a firm (or click one in the rollup table).</div>
        ) : (
          <div className="mt-4 grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2 rounded-md border border-border p-3">
              <p className="text-xs text-slate-600 mb-2">
                {counterpartyLoading
                  ? "Loading…"
                  : `Direct flows involving ${selectedFirm}: ${counterpartyData?.links.length ?? 0}`}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Assignor</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Events</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const g = counterpartyData
                    if (!g?.nodes?.length || !g?.links?.length) return []
                    const edges = g.links
                      .map((l) => ({
                        assignor: g.nodes[l.source]?.name ?? String(l.source),
                        assignee: g.nodes[l.target]?.name ?? String(l.target),
                        count: l.value,
                      }))
                      .filter((e) => e.assignor === selectedFirm || e.assignee === selectedFirm)
                      .sort((a, b) => b.count - a.count)
                      .slice(0, 50)
                    return edges
                  })().map((e, idx) => (
                    <TableRow key={`${e.assignor}→${e.assignee}-${idx}`}>
                      <TableCell className="max-w-[340px] truncate">{e.assignor}</TableCell>
                      <TableCell className="max-w-[340px] truncate">{e.assignee}</TableCell>
                      <TableCell>{formatNumber(e.count)}</TableCell>
                    </TableRow>
                  ))}
                  {(!counterpartyData?.links?.length || counterpartyData.links.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-slate-600">
                        {counterpartyLoading ? "Loading…" : "No direct flows for the current filters."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <p className="mt-2 text-[11px] text-slate-600">
                Direction: assignor → assignee. This table only includes flows where the selected firm is either the assignor or assignee.
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-md border border-border p-3">
                <p className="text-xs font-semibold text-slate-600 uppercase">Outbound counterparties (assignor →)</p>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  {(counterpartyData?.outbound ?? []).slice(0, 12).map((x) => (
                    <div key={x.counterparty} className="flex items-center justify-between gap-2">
                      <span className="truncate">{x.counterparty}</span>
                      <span className="tabular-nums">{formatNumber(x.count)}</span>
                    </div>
                  ))}
                  {(counterpartyData?.outbound ?? []).length === 0 && <div>{counterpartyLoading ? "Loading…" : "—"}</div>}
                </div>
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="text-xs font-semibold text-slate-600 uppercase">Inbound counterparties (→ assignee)</p>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  {(counterpartyData?.inbound ?? []).slice(0, 12).map((x) => (
                    <div key={x.counterparty} className="flex items-center justify-between gap-2">
                      <span className="truncate">{x.counterparty}</span>
                      <span className="tabular-nums">{formatNumber(x.count)}</span>
                    </div>
                  ))}
                  {(counterpartyData?.inbound ?? []).length === 0 && <div>{counterpartyLoading ? "Loading…" : "—"}</div>}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6 border-slate-200/80 bg-slate-50/30">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Top Assignors</h4>
              <p className="text-xs text-slate-600">Most frequent “from” parties (assignor).</p>
            </div>
            <p className="text-xs text-slate-600">Metric: count</p>
          </div>
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assignor</TableHead>
                  <TableHead>Events</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(summary?.topAssignors ?? []).map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="max-w-[420px] truncate">{row.name}</TableCell>
                    <TableCell>{formatNumber(row.count)}</TableCell>
                  </TableRow>
                ))}
                {!hasData && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-slate-600">
                      No AOM data loaded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card className="p-6 border-slate-200/80 bg-slate-50/30">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Top Assignees</h4>
              <p className="text-xs text-slate-600">Most frequent “to” parties (assignee).</p>
            </div>
            <p className="text-xs text-slate-600">Metric: count</p>
          </div>
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Events</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(summary?.topAssignees ?? []).map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="max-w-[420px] truncate">{row.name}</TableCell>
                    <TableCell>{formatNumber(row.count)}</TableCell>
                  </TableRow>
                ))}
                {!hasData && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-slate-600">
                      No AOM data loaded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-800">Party Search</h4>
            <p className="text-xs text-slate-600">
              Search assignments where a party appears as assignor or assignee.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch()
              }}
              placeholder="e.g., Lakeview Loan Servicing"
              className="w-72 rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-800"
            />
            <button
              onClick={runSearch}
              className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-slate-800"
              disabled={searchLoading}
            >
              {searchLoading ? "Searching…" : "Search"}
            </button>
          </div>
        </div>

        {searchNotes.length ? (
          <div className="mt-3 text-xs text-slate-600">{searchNotes.join(" ")}</div>
        ) : null}

        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Doc Type</TableHead>
                <TableHead>Assignor</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>CFN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {searchRows.map((r, idx) => (
                <TableRow key={`${r.cfn_master_id || "cfn"}-${r.event_date || "d"}-${idx}`}>
                  <TableCell>{r.event_date || "—"}</TableCell>
                  <TableCell className="max-w-[220px] truncate">{r.doc_type || "—"}</TableCell>
                  <TableCell className="max-w-[260px] truncate">{r.first_party || "—"}</TableCell>
                  <TableCell className="max-w-[260px] truncate">{r.second_party || "—"}</TableCell>
                  <TableCell>{r.cfn_master_id || "—"}</TableCell>
                </TableRow>
              ))}
              {searchRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-slate-600">
                    {searchLoading ? "Searching…" : "No results."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <ParticipantLookup onProfileLoaded={setLookupProfile} />
      {lookupProfile && (
        <FirmProfilePanel
          profile={lookupProfile}
          onViewFlows={(name) => {
            setSelectedFirm(name)
            drilldownSectionRef.current?.scrollIntoView({ behavior: "smooth" })
          }}
          onDismiss={() => setLookupProfile(undefined)}
        />
      )}
    </div>
  )
}

