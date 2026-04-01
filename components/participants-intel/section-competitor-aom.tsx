"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CompetitorRanking, FlowEdge, LenderAnalyticsRecord } from "@/lib/participants-intel/types"

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

function compact(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n)
}

function pctFmt(n: number) {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(1)}%`
}

// ─── Party classifier ────────────────────────────────────────────────────────

type PartyCategory = "private_creditor" | "bank" | "servicer" | "gse" | "unknown"

const GSE_RE = /fannie mae|freddie mac|fhlmc|fnma|ginnie mae|hud\b|federal home loan|department of housing|veteran|va loan/i
const SERVICER_RE = /nationstar|mr\.? cooper|ocwen|shellpoint|select portfolio|phh |sps \b|carrington|rushmore|specialized loan|loancare|dovenmuehle|cenlar|new penn|lsf\d|home point|roundpoint|planet home|fay servicing|freedom mortgage serv|bsi financial|flagstar serv|provident funding/i
const BANK_RE = /wells fargo|jpmorgan|chase bank|bank of america|citibank|\bus bank\b|\bu\.s\. bank\b|goldman sachs|deutsche bank|hsbc|barclays|morgan stanley|truist|regions bank|suntrust|td bank\b|pnc bank|fifth third|citizens bank|bank na\b|national bank|national association|wilmington trust|wilmington na|wsfs bank|computershare|u\.s\. bank national/i
const PRIVATE_RE = /kiavi|rcn capital|corevest|roc capital|builders capital|alto capital|lendingone|visio|renovo|lend|hard money|bridge fund|debt fund|private fund|private credit|mortgage fund|reit\b|real estate fund|asset.*fund|equity fund|cre.*fund|distress|opportunity fund/i

function classifyParty(name: string, lenderTypeMap: Map<string, string>): PartyCategory {
  const n = name.toLowerCase().trim()
  const lt = lenderTypeMap.get(n)
  if (lt === "Private Money") return "private_creditor"
  if (lt === "Bank" || lt === "Credit Union" || lt === "Thrift") return "bank"
  if (lt === "Servicer") return "servicer"
  if (GSE_RE.test(n)) return "gse"
  if (SERVICER_RE.test(n)) return "servicer"
  if (BANK_RE.test(n)) return "bank"
  if (PRIVATE_RE.test(n)) return "private_creditor"
  return "unknown"
}

type FlowCategory = "bank_to_private" | "private_to_bank" | "private_to_private" | "noise" | "other"

type CategorizedEdge = FlowEdge & {
  fromCategory: PartyCategory
  toCategory: PartyCategory
  flowCategory: FlowCategory
}

function categorizeEdges(edges: FlowEdge[], lenderTypeMap: Map<string, string>): CategorizedEdge[] {
  return edges.map((e) => {
    const fromCategory = classifyParty(e.from_party, lenderTypeMap)
    const toCategory = classifyParty(e.to_party, lenderTypeMap)
    const fromNoise = fromCategory === "bank" || fromCategory === "servicer" || fromCategory === "gse"
    const toNoise = toCategory === "bank" || toCategory === "servicer" || toCategory === "gse"
    let flowCategory: FlowCategory
    if (fromNoise && toNoise) flowCategory = "noise"
    else if (fromNoise) flowCategory = "bank_to_private"
    else if (toNoise) flowCategory = "private_to_bank"
    else if (!fromNoise && !toNoise) flowCategory = "private_to_private"
    else flowCategory = "other"
    return { ...e, fromCategory, toCategory, flowCategory }
  })
}

// ─── Category colors ──────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<PartyCategory, string> = {
  bank: "#f59e0b",
  servicer: "#3b82f6",
  gse: "#8b5cf6",
  private_creditor: "#10b981",
  unknown: "#64748b",
}

type AssignorNode = {
  name: string
  deals: number
  volume: number
  category: PartyCategory
}

// ─── County extraction ────────────────────────────────────────────────────────

function extractCounty(geo: string): string | null {
  // geo format: "City, County Name, State"
  const parts = geo.split(", ")
  return parts.length >= 2 ? parts[1] : null
}

// ─── Velocity Cards ───────────────────────────────────────────────────────────

function VelocityCards({ rankings }: { rankings: CompetitorRanking[] }) {
  const top = rankings.slice(0, 5)
  if (top.length === 0) return null

  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-800 mb-1">Competitor Velocity</h4>
      <p className="text-xs text-slate-500 mb-3">
        Period-over-period deal activity for the top FL private credit buyers. Green = accelerating, red = slowing.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {top.map((r) => {
          const isUp = r.percentChange > 0
          const isFlat = r.percentChange === 0
          const changeColor = isUp ? "text-emerald-600" : isFlat ? "text-slate-400" : "text-rose-600"
          const changeBg = isUp ? "bg-emerald-50 border-emerald-200" : isFlat ? "bg-slate-50 border-slate-200" : "bg-rose-50 border-rose-200"
          const arrow = isUp ? "▲" : isFlat ? "→" : "▼"

          return (
            <div key={r.name} className={`rounded-xl border p-4 ${changeBg}`}>
              <div className="text-xs font-medium text-slate-600 truncate mb-2" title={r.name}>
                {r.name.length > 20 ? r.name.slice(0, 18) + "…" : r.name}
              </div>
              <div className="text-2xl font-bold text-slate-800 tabular-nums">{r.count}</div>
              <div className="text-xs text-slate-500 mt-0.5">deals this period</div>
              <div className={`text-sm font-semibold mt-2 ${changeColor}`}>
                {arrow} {pctFmt(r.percentChange)} vs prior
              </div>
              {r.volume > 0 && (
                <div className="text-xs text-slate-500 mt-1">{compact(r.volume)} volume</div>
              )}
              {r.avgDealSize > 0 && (
                <div className="text-xs text-slate-400 mt-0.5">~{compact(r.avgDealSize)} avg deal</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Market Share Bar ─────────────────────────────────────────────────────────

function MarketShareBar({ rankings }: { rankings: CompetitorRanking[] }) {
  const withVolume = rankings.filter((r) => r.volume > 0).slice(0, 10)
  if (withVolume.length === 0) return null

  const total = withVolume.reduce((s, r) => s + r.volume, 0)
  const BAR_COLORS = ["#1e40af", "#0891b2", "#0d9488", "#059669", "#65a30d", "#ca8a04", "#dc2626", "#9333ea", "#db2777", "#f97316"]

  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-800 mb-1">FL AOM Market Share by Volume</h4>
      <p className="text-xs text-slate-500 mb-3">
        Share of total recorded FL assignment volume among the top private credit buyers.
      </p>

      {/* Stacked bar */}
      <div className="flex h-6 rounded-full overflow-hidden mb-4 gap-0.5">
        {withVolume.map((r, i) => {
          const pct = (r.volume / total) * 100
          return (
            <div
              key={r.name}
              title={`${r.name}: ${compact(r.volume)} (${pct.toFixed(1)}%)`}
              className="h-full transition-all"
              style={{ width: `${pct}%`, background: BAR_COLORS[i % BAR_COLORS.length], minWidth: pct > 1 ? 4 : 0 }}
            />
          )
        })}
      </div>

      {/* Legend rows */}
      <div className="space-y-1.5">
        {withVolume.map((r, i) => {
          const pct = (r.volume / total) * 100
          return (
            <div key={r.name} className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: BAR_COLORS[i % BAR_COLORS.length] }} />
              <span className="text-xs text-slate-700 w-48 truncate shrink-0" title={r.name}>{r.name}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
              </div>
              <span className="text-xs text-slate-500 w-12 text-right shrink-0 tabular-nums">{pct.toFixed(1)}%</span>
              <span className="text-xs text-slate-400 w-16 text-right shrink-0">{compact(r.volume)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Geographic Concentration ─────────────────────────────────────────────────

function GeoPanel({ categorized }: { categorized: CategorizedEdge[] }) {
  const signal = categorized.filter((e) => e.flowCategory !== "noise" && e.geography)
  const countyMap = new Map<string, number>()
  for (const e of signal) {
    const county = extractCounty(e.geography!)
    if (county) countyMap.set(county, (countyMap.get(county) ?? 0) + 1)
  }
  const counties = Array.from(countyMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  if (counties.length === 0) return null
  const maxCount = counties[0].count

  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-800 mb-1">Geographic Concentration</h4>
      <p className="text-xs text-slate-500 mb-3">
        Top FL counties by private credit AOM deal count. Shows where competitor activity is concentrated.
      </p>
      <div className="space-y-2">
        {counties.map((c) => {
          const pct = Math.round((c.count / maxCount) * 100)
          return (
            <div key={c.name} className="flex items-center gap-3">
              <div className="w-40 shrink-0 text-xs text-slate-700 truncate" title={c.name}>{c.name}</div>
              <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-xs text-slate-500 w-12 text-right tabular-nums shrink-0">{c.count} deals</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Assignor detail panel ────────────────────────────────────────────────────

function AssignorDetailPanel({
  node,
  edges,
  allEdges,
  firm,
  onBack,
}: {
  node: AssignorNode
  edges: CategorizedEdge[]
  allEdges: CategorizedEdge[]
  firm: string
  onBack: () => void
}) {
  const color = CATEGORY_COLOR[node.category]

  const dates = edges.map((e) => e.date).filter(Boolean).sort()
  const firstDate = dates[0] ?? "—"
  const lastDate = dates[dates.length - 1] ?? "—"

  const knownAmounts = edges
    .filter((e) => e.amountKnown && e.amount != null && (e.amount as number) > 0)
    .map((e) => e.amount as number)
  const avgDeal = knownAmounts.length > 0 ? knownAmounts.reduce((s, v) => s + v, 0) / knownAmounts.length : null

  const buyerMap = new Map<string, { deals: number; volume: number }>()
  for (const e of allEdges) {
    if (e.from_party !== node.name || e.flowCategory === "noise") continue
    const curr = buyerMap.get(e.to_party) ?? { deals: 0, volume: 0 }
    curr.deals += 1
    curr.volume += e.amount ?? 0
    buyerMap.set(e.to_party, curr)
  }
  const buyers = Array.from(buyerMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 8)
  const maxBuyerDeals = Math.max(...buyers.map((b) => b.deals), 1)

  const recent = [...edges].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)

  const totalOutflow = allEdges.filter((e) => e.from_party === node.name && e.flowCategory !== "noise").length
  const concentration = totalOutflow > 0 ? Math.round((node.deals / totalOutflow) * 100) : null

  const shortFirm = firm.length > 16 ? firm.slice(0, 14) + "…" : firm

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100 shrink-0">
        <button onClick={onBack} className="text-slate-400 hover:text-slate-700 flex items-center gap-1 text-sm">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to spider
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <span className="text-sm font-semibold text-slate-800 truncate">{node.name}</span>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: color + "22", color }}>
          {node.category.replace("_", " ")}
        </span>
      </div>

      <div className="p-5 overflow-y-auto flex-1 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: `AOMs → ${shortFirm}`, value: node.deals },
            { label: "All-buyer outflow", value: totalOutflow || node.deals },
            { label: "Avg deal size", value: avgDeal != null ? compact(avgDeal) : "—" },
            { label: "Concentration", value: concentration != null ? `${concentration}%` : "—" },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-slate-50 rounded-lg p-3">
              <div className="text-xs text-slate-500 leading-tight">{kpi.label}</div>
              <div className="text-lg font-bold text-slate-800 mt-1">{kpi.value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          <span><span className="font-medium text-slate-600">Activity window: </span>{firstDate} → {lastDate}</span>
          {concentration != null && concentration >= 50 && (
            <span className="text-amber-600 font-medium">⚠ {concentration}% of outflow goes to {shortFirm} — high dependency signal</span>
          )}
        </div>

        {buyers.length > 0 && (
          <div>
            <h5 className="text-sm font-semibold text-slate-700 mb-2">Buyer distribution (all firms)</h5>
            <div className="space-y-1.5">
              {buyers.map((b) => {
                const barPct = Math.round((b.deals / maxBuyerDeals) * 100)
                const isSelected = b.name === firm
                return (
                  <div key={b.name} className="flex items-center gap-2">
                    <div className="w-40 truncate text-xs shrink-0" title={b.name}>
                      {isSelected ? <span className="text-blue-700 font-semibold">{b.name}</span> : <span className="text-slate-700">{b.name}</span>}
                    </div>
                    <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: isSelected ? "#1e40af" : color, opacity: isSelected ? 1 : 0.55 }} />
                    </div>
                    <div className="text-xs text-slate-500 w-14 text-right shrink-0 tabular-nums">{b.deals} AOM{b.deals !== 1 ? "s" : ""}</div>
                    <div className="text-xs text-slate-400 w-14 text-right shrink-0">{b.volume > 0 ? compact(b.volume) : ""}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div>
            <h5 className="text-sm font-semibold text-slate-700 mb-2">Recent FL transactions → {firm.length > 24 ? firm.slice(0, 22) + "…" : firm}</h5>
            <div className="rounded border border-slate-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left py-1.5 px-3 font-semibold text-slate-600">Date</th>
                    <th className="text-right py-1.5 px-3 font-semibold text-slate-600">Loan Amount</th>
                    <th className="text-left py-1.5 px-3 font-semibold text-slate-600">Geography</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                      <td className="py-1.5 px-3 text-slate-600">{e.date}</td>
                      <td className="py-1.5 px-3 text-right text-slate-700">
                        {e.amountKnown && e.amount != null && (e.amount as number) > 0 ? money(e.amount as number) : "—"}
                      </td>
                      <td className="py-1.5 px-3 text-slate-500 max-w-[160px] truncate">{e.geography || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Spider modal ─────────────────────────────────────────────────────────────

function SpiderModal({ firm, categorized, onClose }: { firm: string; categorized: CategorizedEdge[]; onClose: () => void }) {
  const [selectedAssignor, setSelectedAssignor] = useState<AssignorNode | null>(null)

  const inbound = categorized.filter((e) => e.to_party === firm && e.flowCategory !== "noise")

  const assignorMap = new Map<string, AssignorNode>()
  for (const e of inbound) {
    const curr = assignorMap.get(e.from_party) ?? { name: e.from_party, deals: 0, volume: 0, category: e.fromCategory }
    curr.deals += 1
    curr.volume += e.amount ?? 0
    assignorMap.set(e.from_party, curr)
  }

  const assignors: AssignorNode[] = Array.from(assignorMap.values()).sort((a, b) => b.deals - a.deals).slice(0, 14)
  const maxDeals = Math.max(...assignors.map((a) => a.deals), 1)
  const totalDeals = assignors.reduce((s, a) => s + a.deals, 0)
  const totalVolume = assignors.reduce((s, a) => s + a.volume, 0)

  const W = 560; const H = 520; const cx = W / 2; const cy = H / 2; const outerR = 190; const centerR = 46

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-6 pb-3 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="text-lg font-bold text-slate-800">{firm}</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {selectedAssignor
                ? "Assignor intelligence — " + selectedAssignor.name
                : `${totalDeals} inbound AOM${totalDeals !== 1 ? "s" : ""} · ${assignors.length} unique assignors${totalVolume > 0 ? ` · ${compact(totalVolume)} total` : ""}`}
            </p>
          </div>
          <button onClick={onClose} className="ml-4 text-slate-400 hover:text-slate-700 text-2xl leading-none font-light">×</button>
        </div>

        {selectedAssignor ? (
          <div className="flex-1 overflow-hidden">
            <AssignorDetailPanel
              node={selectedAssignor}
              edges={inbound.filter((e) => e.from_party === selectedAssignor.name)}
              allEdges={categorized}
              firm={firm}
              onBack={() => setSelectedAssignor(null)}
            />
          </div>
        ) : (
          <div className="p-6 overflow-y-auto flex-1">
            {assignors.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-12">No inbound AOM data found for this firm.</p>
            ) : (
              <>
                <p className="text-xs text-slate-400 text-center mb-1">Click any assignor node or row to drill into their intelligence profile</p>
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 420 }}>
                  {[0.33, 0.66, 1].map((r) => (
                    <circle key={r} cx={cx} cy={cy} r={outerR * r} fill="none" stroke="#e2e8f0" strokeWidth={1} strokeDasharray="5 4" />
                  ))}
                  {assignors.map((a, i) => {
                    const angle = (i * 2 * Math.PI) / assignors.length - Math.PI / 2
                    const nx = cx + outerR * Math.cos(angle); const ny = cy + outerR * Math.sin(angle)
                    const nodeR = Math.max(16, Math.min(34, 16 + (a.deals / maxDeals) * 18))
                    const color = CATEGORY_COLOR[a.category]
                    const lineW = Math.max(1.5, Math.min(7, 1.5 + (a.deals / maxDeals) * 5.5))
                    const labelDist = outerR + nodeR + 16
                    const lx = cx + labelDist * Math.cos(angle); const ly = cy + labelDist * Math.sin(angle)
                    const cosA = Math.cos(angle)
                    const anchor = cosA > 0.15 ? "start" : cosA < -0.15 ? "end" : "middle"
                    const shortName = a.name.length > 18 ? a.name.slice(0, 16) + "…" : a.name
                    return (
                      <g key={a.name} className="cursor-pointer" onClick={() => setSelectedAssignor(a)}>
                        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={lineW} strokeOpacity={0.35} strokeLinecap="round" />
                        <circle cx={nx} cy={ny} r={nodeR} fill={color} fillOpacity={0.13} stroke={color} strokeWidth={2} />
                        <circle cx={nx} cy={ny} r={nodeR + 8} fill="transparent" />
                        <text x={nx} y={ny} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight="700" fill={color} style={{ pointerEvents: "none" }}>{a.deals}</text>
                        <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize={10} fill="#475569" style={{ pointerEvents: "none" }}>{shortName}</text>
                      </g>
                    )
                  })}
                  <circle cx={cx} cy={cy} r={centerR} fill="#1e40af" fillOpacity={0.1} stroke="#1e40af" strokeWidth={2.5} />
                  <text x={cx} y={cy - 9} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight="700" fill="#1e40af">{firm.length > 14 ? firm.slice(0, 13) + "…" : firm}</text>
                  <text x={cx} y={cy + 9} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#3b82f6">{totalDeals} AOMs in</text>
                </svg>

                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 mb-4 text-xs text-slate-500">
                  {(Object.entries(CATEGORY_COLOR) as [PartyCategory, string][]).map(([cat, color]) => (
                    <span key={cat} className="flex items-center gap-1">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                      {cat.replace("_", " ")}
                    </span>
                  ))}
                  <span className="ml-auto text-slate-400 italic">Node size ∝ deal count · click to drill in</span>
                </div>

                <h4 className="text-sm font-semibold text-slate-700 mb-2">Assignor Breakdown</h4>
                <div className="rounded border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left py-2 px-3 font-semibold text-slate-600">Assignor (Seller)</th>
                        <th className="text-left py-2 px-3 font-semibold text-slate-600">Type</th>
                        <th className="text-right py-2 px-3 font-semibold text-slate-600">AOMs</th>
                        <th className="text-right py-2 px-3 font-semibold text-slate-600">Volume</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignors.map((a, idx) => (
                        <tr key={a.name} className={`cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`} onClick={() => setSelectedAssignor(a)}>
                          <td className="py-2 px-3 font-medium text-blue-700 hover:underline max-w-[240px] truncate">{a.name}</td>
                          <td className="py-2 px-3">
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: CATEGORY_COLOR[a.category] + "22", color: CATEGORY_COLOR[a.category] }}>
                              {a.category.replace("_", " ")}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700">{a.deals}</td>
                          <td className="py-2 px-3 text-right text-slate-500">{a.volume > 0 ? compact(a.volume) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Bank Spider Modal (outbound: bank → private credit buyers) ───────────────

function BankSpiderModal({
  bank,
  categorized,
  onClose,
}: {
  bank: string
  categorized: CategorizedEdge[]
  onClose: () => void
}) {
  // Outbound: edges FROM this bank TO private creditors
  const outbound = categorized.filter(
    (e) => e.from_party === bank && e.flowCategory === "bank_to_private"
  )

  const buyerMap = new Map<string, AssignorNode>()
  for (const e of outbound) {
    const curr = buyerMap.get(e.to_party) ?? { name: e.to_party, deals: 0, volume: 0, category: e.toCategory }
    curr.deals += 1
    curr.volume += e.amount ?? 0
    buyerMap.set(e.to_party, curr)
  }

  const buyers: AssignorNode[] = Array.from(buyerMap.values())
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 14)

  const maxDeals = Math.max(...buyers.map((b) => b.deals), 1)
  const totalDeals = buyers.reduce((s, b) => s + b.deals, 0)
  const totalVolume = buyers.reduce((s, b) => s + b.volume, 0)

  const W = 560; const H = 520; const cx = W / 2; const cy = H / 2
  const outerR = 190; const centerR = 46

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-3 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="text-lg font-bold text-slate-800">{bank}</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {totalDeals} AOM{totalDeals !== 1 ? "s" : ""} sold to private creditors · {buyers.length} unique buyers
              {totalVolume > 0 ? ` · ${compact(totalVolume)} total` : ""}
            </p>
          </div>
          <button onClick={onClose} className="ml-4 text-slate-400 hover:text-slate-700 text-2xl leading-none font-light">×</button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {buyers.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-12">No outbound AOM data found for this bank.</p>
          ) : (
            <>
              <p className="text-xs text-slate-400 text-center mb-1">
                Each node represents a private credit buyer receiving loans from this bank. Node size ∝ deal count.
              </p>

              {/* Spider SVG */}
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 420 }}>
                {[0.33, 0.66, 1].map((r) => (
                  <circle key={r} cx={cx} cy={cy} r={outerR * r} fill="none" stroke="#e2e8f0" strokeWidth={1} strokeDasharray="5 4" />
                ))}

                {buyers.map((b, i) => {
                  const angle = (i * 2 * Math.PI) / buyers.length - Math.PI / 2
                  const nx = cx + outerR * Math.cos(angle)
                  const ny = cy + outerR * Math.sin(angle)
                  const nodeR = Math.max(16, Math.min(34, 16 + (b.deals / maxDeals) * 18))
                  const color = CATEGORY_COLOR[b.category]
                  const lineW = Math.max(1.5, Math.min(7, 1.5 + (b.deals / maxDeals) * 5.5))
                  const labelDist = outerR + nodeR + 16
                  const lx = cx + labelDist * Math.cos(angle)
                  const ly = cy + labelDist * Math.sin(angle)
                  const cosA = Math.cos(angle)
                  const anchor = cosA > 0.15 ? "start" : cosA < -0.15 ? "end" : "middle"
                  const shortName = b.name.length > 18 ? b.name.slice(0, 16) + "…" : b.name

                  return (
                    <g key={b.name}>
                      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={lineW} strokeOpacity={0.35} strokeLinecap="round" />
                      <circle cx={nx} cy={ny} r={nodeR} fill={color} fillOpacity={0.13} stroke={color} strokeWidth={2} />
                      <text x={nx} y={ny} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight="700" fill={color} style={{ pointerEvents: "none" }}>
                        {b.deals}
                      </text>
                      <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize={10} fill="#475569" style={{ pointerEvents: "none" }}>
                        {shortName}
                      </text>
                    </g>
                  )
                })}

                {/* Center node — amber for bank */}
                <circle cx={cx} cy={cy} r={centerR} fill="#f59e0b" fillOpacity={0.1} stroke="#f59e0b" strokeWidth={2.5} />
                <text x={cx} y={cy - 9} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight="700" fill="#b45309">
                  {bank.length > 14 ? bank.slice(0, 13) + "…" : bank}
                </text>
                <text x={cx} y={cy + 9} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#d97706">
                  {totalDeals} AOMs out
                </text>
              </svg>

              {/* Legend */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 mb-4 text-xs text-slate-500">
                {(Object.entries(CATEGORY_COLOR) as [PartyCategory, string][]).map(([cat, color]) => (
                  <span key={cat} className="flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                    {cat.replace("_", " ")}
                  </span>
                ))}
                <span className="ml-auto text-slate-400 italic">Node size ∝ deal count</span>
              </div>

              {/* Buyer breakdown table */}
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Private Credit Buyer Breakdown</h4>
              <div className="rounded border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left py-2 px-3 font-semibold text-slate-600">Buyer (Private Creditor)</th>
                      <th className="text-left py-2 px-3 font-semibold text-slate-600">Type</th>
                      <th className="text-right py-2 px-3 font-semibold text-slate-600">AOMs Received</th>
                      <th className="text-right py-2 px-3 font-semibold text-slate-600">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buyers.map((b, idx) => (
                      <tr key={b.name} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                        <td className="py-2 px-3 font-medium text-slate-800 max-w-[240px] truncate">{b.name}</td>
                        <td className="py-2 px-3">
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: CATEGORY_COLOR[b.category] + "22", color: CATEGORY_COLOR[b.category] }}>
                            {b.category.replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-slate-700">{b.deals}</td>
                        <td className="py-2 px-3 text-right text-slate-500">{b.volume > 0 ? compact(b.volume) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main section ─────────────────────────────────────────────────────────────

type Props = {
  edges: FlowEdge[]
  lenders: LenderAnalyticsRecord[]
  rankings: CompetitorRanking[]
}

export function SectionCompetitorAOM({ edges, lenders, rankings }: Props) {
  const [selectedFirm, setSelectedFirm] = useState<string | null>(null)
  const [selectedBank, setSelectedBank] = useState<string | null>(null)

  const lenderTypeMap = new Map<string, string>()
  for (const l of lenders) {
    if (l.lenderType) lenderTypeMap.set(l.lender.toLowerCase().trim(), l.lenderType)
  }

  const categorized = categorizeEdges(edges, lenderTypeMap)

  // Build ranking lookup by name for volume enrichment
  const rankingByName = new Map<string, CompetitorRanking>()
  for (const r of rankings) rankingByName.set(r.name.toLowerCase().trim(), r)

  // Competitor Rankings — merge edge deal counts with ranking volume/metadata
  const competitorInbound = new Map<string, { volume: number; deals: number }>()
  for (const e of categorized) {
    if (e.flowCategory === "noise") continue
    if (e.toCategory === "private_creditor" || e.toCategory === "unknown") {
      const curr = competitorInbound.get(e.to_party) ?? { volume: 0, deals: 0 }
      curr.volume += e.amount ?? 0
      curr.deals += 1
      competitorInbound.set(e.to_party, curr)
    }
  }

  // Merge: prefer ranking volume (authoritative from Elementix) over edge-summed volume
  const competitors = Array.from(competitorInbound.entries())
    .map(([name, v]) => {
      const rk = rankingByName.get(name.toLowerCase().trim())
      return {
        name,
        deals: v.deals,
        volume: rk?.volume ?? v.volume,
        volumePrev: rk?.volumePrev ?? 0,
        percentChange: rk?.percentChange ?? 0,
        avgDealSize: rk?.avgDealSize ?? 0,
        category: rk?.category,
        buyerType: rk?.buyerType,
      }
    })
    .filter((c) => c.deals >= 2)
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 15)

  // Also include ranking-only entries not captured in edges
  for (const r of rankings) {
    const alreadyIn = competitors.some((c) => c.name.toLowerCase() === r.name.toLowerCase())
    if (!alreadyIn && r.count >= 2) {
      competitors.push({
        name: r.name,
        deals: r.count,
        volume: r.volume,
        volumePrev: r.volumePrev,
        percentChange: r.percentChange,
        avgDealSize: r.avgDealSize,
        category: r.category,
        buyerType: r.buyerType,
      })
    }
  }
  competitors.sort((a, b) => b.deals - a.deals)

  // Bank Sell-Off Signals
  const bankSellers = new Map<string, { volume: number; deals: number; uniqueBuyers: Set<string> }>()
  for (const e of categorized) {
    if (e.flowCategory !== "bank_to_private") continue
    const curr = bankSellers.get(e.from_party) ?? { volume: 0, deals: 0, uniqueBuyers: new Set<string>() }
    curr.volume += e.amount ?? 0
    curr.deals += 1
    curr.uniqueBuyers.add(e.to_party)
    bankSellers.set(e.from_party, curr)
  }

  // Compute avg deal size for bank sellers from edges
  const bankAvgDeals = new Map<string, number>()
  for (const e of categorized) {
    if (e.flowCategory !== "bank_to_private" || !e.amountKnown || !e.amount) continue
    bankAvgDeals.set(e.from_party, (bankAvgDeals.get(e.from_party) ?? 0) + 1)
  }

  const bankSignals = Array.from(bankSellers.entries())
    .map(([name, v]) => ({
      name,
      volume: v.volume,
      deals: v.deals,
      uniqueBuyers: v.uniqueBuyers.size,
      avgDeal: v.deals > 0 && v.volume > 0 ? v.volume / v.deals : 0,
    }))
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 10)

  const noiseCount = categorized.filter((e) => e.flowCategory === "noise").length
  const cleanCount = categorized.filter((e) => e.flowCategory !== "noise").length

  const flowCategoryLabel: Record<FlowCategory, string> = {
    bank_to_private: "Bank → Private",
    private_to_bank: "Private → Bank",
    private_to_private: "Private → Private",
    noise: "Institutional",
    other: "Mixed",
  }

  const flowBadgeClass: Record<FlowCategory, string> = {
    bank_to_private: "bg-amber-100 text-amber-800",
    private_to_bank: "bg-blue-100 text-blue-800",
    private_to_private: "bg-emerald-100 text-emerald-800",
    noise: "bg-slate-100 text-slate-500",
    other: "bg-purple-100 text-purple-800",
  }

  const cleanEdges = categorized
    .filter((e) => e.flowCategory !== "noise")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)

  return (
    <>
      {selectedFirm && (
        <SpiderModal firm={selectedFirm} categorized={categorized} onClose={() => setSelectedFirm(null)} />
      )}
      {selectedBank && (
        <BankSpiderModal bank={selectedBank} categorized={categorized} onClose={() => setSelectedBank(null)} />
      )}

      <Card className="p-6 border-slate-200/80 bg-slate-50/30 space-y-8">
        {/* Header */}
        <div>
          <h3 className="text-base font-semibold text-slate-800">Competitor AOM Intelligence</h3>
          <p className="text-xs text-slate-500 mt-1">
            Florida private credit assignment activity. {noiseCount.toLocaleString()} institutional transfers filtered out —{" "}
            <span className="font-medium text-slate-700">{cleanCount.toLocaleString()} signal records.</span>
          </p>
        </div>

        {/* A — Velocity Cards */}
        {rankings.length > 0 && <VelocityCards rankings={rankings} />}

        {/* B — Competitor Rankings table + C — Market Share side by side on large screens */}
        <div className="grid gap-8 xl:grid-cols-2">
          {/* Competitor Rankings table */}
          <div>
            <h4 className="text-sm font-semibold text-slate-800 mb-1">Competitor Rankings — Top FL AOM Buyers</h4>
            <p className="text-xs text-slate-500 mb-3">
              Click any firm to open the spider graph → click an assignor node to drill into their profile.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Firm</TableHead>
                  <TableHead className="text-right">AOMs</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Avg Deal</TableHead>
                  <TableHead className="text-right">Δ vs Prior</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {competitors.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-slate-500 text-xs">No private creditor activity detected.</TableCell></TableRow>
                ) : (
                  competitors.map((c) => {
                    const isUp = c.percentChange > 0
                    const isDown = c.percentChange < 0
                    return (
                      <TableRow key={c.name} className="cursor-pointer hover:bg-blue-50 transition-colors" onClick={() => setSelectedFirm(c.name)}>
                        <TableCell>
                          <div className="font-medium text-blue-700 max-w-[180px] truncate">{c.name}</div>
                          {c.category && (
                            <div className="text-[10px] text-slate-400 mt-0.5">{c.category}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.deals}</TableCell>
                        <TableCell className="text-right text-slate-600 tabular-nums">{c.volume > 0 ? compact(c.volume) : "—"}</TableCell>
                        <TableCell className="text-right text-slate-500 tabular-nums">{c.avgDealSize > 0 ? compact(c.avgDealSize) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.percentChange !== 0 ? (
                            <span className={`font-semibold ${isUp ? "text-emerald-600" : isDown ? "text-rose-600" : "text-slate-400"}`}>
                              {pctFmt(c.percentChange)}
                            </span>
                          ) : <span className="text-slate-400">—</span>}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Market Share Bar */}
          {rankings.length > 0 && (
            <div>
              <MarketShareBar rankings={rankings} />
            </div>
          )}
        </div>

        {/* D — Bank Sell-Off Signals */}
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-1">Bank Sell-Off Signals</h4>
          <p className="text-xs text-slate-500 mb-3">
            Banks assigning FL loans to private creditors — ranked by deal count. Click any bank to see a spider graph of which private creditors they are selling to.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bank / Originator</TableHead>
                <TableHead className="text-right">Deals to Private</TableHead>
                <TableHead className="text-right">Unique Buyers</TableHead>
                <TableHead className="text-right">Avg Deal</TableHead>
                <TableHead className="text-right">Volume</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankSignals.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-slate-500 text-xs">No bank sell-off signals detected.</TableCell></TableRow>
              ) : (
                bankSignals.map((b) => (
                  <TableRow
                    key={b.name}
                    className="cursor-pointer hover:bg-amber-50 transition-colors"
                    onClick={() => setSelectedBank(b.name)}
                  >
                    <TableCell className="font-medium text-amber-700">{b.name}</TableCell>
                    <TableCell className="text-right">{b.deals}</TableCell>
                    <TableCell className="text-right">{b.uniqueBuyers}</TableCell>
                    <TableCell className="text-right text-slate-500">{b.avgDeal > 0 ? compact(b.avgDeal) : "—"}</TableCell>
                    <TableCell className="text-right text-slate-500">{b.volume > 0 ? compact(b.volume) : "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* E — Geographic Concentration */}
        <GeoPanel categorized={categorized} />

        {/* Recent AOM Flow */}
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-1">Recent AOM Flow — Noise Removed</h4>
          <p className="text-xs text-slate-500 mb-3">
            Most recent FL assignments involving private creditors. Bank↔bank and servicer transfers hidden.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Assignor (Seller)</TableHead>
                  <TableHead>Assignee (Buyer)</TableHead>
                  <TableHead>Flow Type</TableHead>
                  <TableHead className="text-right">Loan Amount</TableHead>
                  <TableHead>Geography</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cleanEdges.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-slate-500 text-xs">No clean AOM flow data available.</TableCell></TableRow>
                ) : (
                  cleanEdges.map((e, idx) => (
                    <TableRow key={`${e.date}-${idx}`}>
                      <TableCell className="text-xs">{e.date}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-sm">{e.rawAssignor}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-sm font-medium">{e.rawAssignee}</TableCell>
                      <TableCell>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${flowBadgeClass[e.flowCategory]}`}>
                          {flowCategoryLabel[e.flowCategory]}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {e.amountKnown && e.amount != null && (e.amount as number) > 0 ? money(e.amount as number) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 max-w-[140px] truncate">{e.geography || "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>
    </>
  )
}
