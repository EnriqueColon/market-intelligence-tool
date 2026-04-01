"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { FlowEdge, LenderAnalyticsRecord } from "@/lib/participants-intel/types"

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

function compact(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n)
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

// ─── Colors ───────────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<PartyCategory, string> = {
  bank: "#f59e0b",
  servicer: "#3b82f6",
  gse: "#8b5cf6",
  private_creditor: "#10b981",
  unknown: "#64748b",
}

const CATEGORY_LABEL: Record<PartyCategory, string> = {
  bank: "Bank",
  servicer: "Servicer",
  gse: "GSE / Agency",
  private_creditor: "Private Creditor",
  unknown: "Unknown",
}

// ─── Assignor Detail Panel ────────────────────────────────────────────────────

type AssignorNode = {
  name: string
  deals: number
  volume: number
  category: PartyCategory
}

function AssignorDetailPanel({
  assignor,
  category,
  allEdges,
  onBack,
}: {
  assignor: string
  category: PartyCategory
  allEdges: CategorizedEdge[]
  onBack: () => void
}) {
  // All outbound edges from this assignor (FL-wide, noise excluded)
  const outbound = allEdges.filter((e) => e.from_party === assignor && e.flowCategory !== "noise")

  // Stats
  const totalDeals = outbound.length
  const totalVolume = outbound.reduce((s, e) => s + (e.amount ?? 0), 0)
  const knownVolume = outbound.filter((e) => e.amountKnown && (e.amount ?? 0) > 0)
  const avgDealSize = knownVolume.length > 0 ? knownVolume.reduce((s, e) => s + (e.amount ?? 0), 0) / knownVolume.length : 0

  // Date range
  const dates = outbound.map((e) => e.date).filter(Boolean).sort()
  const firstSeen = dates[0] ?? "—"
  const lastSeen = dates[dates.length - 1] ?? "—"

  // Buyer breakdown (who they sell to)
  const buyerMap = new Map<string, { deals: number; volume: number; category: PartyCategory }>()
  for (const e of outbound) {
    const curr = buyerMap.get(e.to_party) ?? { deals: 0, volume: 0, category: e.toCategory }
    curr.deals += 1
    curr.volume += e.amount ?? 0
    buyerMap.set(e.to_party, curr)
  }
  const buyers = Array.from(buyerMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 10)

  // Concentration signal
  const topBuyerShare = buyers.length > 0 ? buyers[0].deals / Math.max(totalDeals, 1) : 0
  const concentrationLabel =
    topBuyerShare >= 0.8
      ? "Highly concentrated — selling primarily to one buyer"
      : topBuyerShare >= 0.5
      ? "Moderately concentrated — one dominant buyer"
      : buyers.length >= 5
      ? "Diversified — spreading deals across multiple buyers"
      : "Active — selling to multiple buyers"

  // Recent transactions
  const recent = [...outbound]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12)

  const color = CATEGORY_COLOR[category]

  return (
    <div className="flex flex-col gap-5">
      {/* Back nav */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to spider view
        </button>
      </div>

      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: color + "20", border: `2px solid ${color}` }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="5" stroke={color} strokeWidth="2"/>
            <path d="M9 4V2M9 16v-2M4 9H2M16 9h-2" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <h4 className="text-base font-bold text-slate-800">{assignor}</h4>
          <span
            className="inline-block text-xs font-medium px-2 py-0.5 rounded-full mt-1"
            style={{ background: color + "20", color }}
          >
            {CATEGORY_LABEL[category]}
          </span>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total FL AOMs", value: totalDeals.toLocaleString() },
          { label: "Total Volume", value: totalVolume > 0 ? compact(totalVolume) : "—" },
          { label: "Avg Deal Size", value: avgDealSize > 0 ? compact(avgDealSize) : "—" },
          { label: "Unique Buyers", value: buyers.length.toLocaleString() },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
            <p className="text-[11px] text-slate-500 uppercase tracking-wide">{kpi.label}</p>
            <p className="text-lg font-bold text-slate-800 mt-0.5">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Activity window + signal */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <rect x="1" y="2" width="11" height="10" rx="1.5" stroke="#94a3b8" strokeWidth="1.2"/>
            <path d="M4 1v2M9 1v2M1 5h11" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <span>Activity: <strong className="text-slate-700">{firstSeen}</strong> → <strong className="text-slate-700">{lastSeen}</strong></span>
        </div>
        <div
          className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 border"
          style={{ background: color + "10", borderColor: color + "30", color }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="6.5" cy="6.5" r="5.5" stroke={color} strokeWidth="1.2"/>
            <path d="M6.5 4v3l2 1.5" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <span className="font-medium">{concentrationLabel}</span>
        </div>
      </div>

      {/* Buyers table */}
      <div>
        <h5 className="text-sm font-semibold text-slate-700 mb-2">
          Who They Sell To — FL Buyer Breakdown
        </h5>
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-600">Buyer (Assignee)</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-600">Type</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-slate-600">AOMs</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-slate-600">% of Deals</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-slate-600">Volume</th>
              </tr>
            </thead>
            <tbody>
              {buyers.map((b, idx) => {
                const pct = totalDeals > 0 ? Math.round((b.deals / totalDeals) * 100) : 0
                const bColor = CATEGORY_COLOR[b.category]
                return (
                  <tr key={b.name} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="py-2 px-3 font-medium text-slate-800 max-w-[180px] truncate">{b.name}</td>
                    <td className="py-2 px-3">
                      <span
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{ background: bColor + "22", color: bColor }}
                      >
                        {CATEGORY_LABEL[b.category]}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-slate-700 font-medium">{b.deals}</td>
                    <td className="py-2 px-3 text-right text-slate-500">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                        </div>
                        <span className="text-xs w-8 text-right">{pct}%</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right text-slate-500">{b.volume > 0 ? compact(b.volume) : "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent transactions */}
      <div>
        <h5 className="text-sm font-semibold text-slate-700 mb-2">Recent FL Transactions</h5>
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-600">Date</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-600">Buyer</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-600">Geography</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-slate-600">Loan Amount</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-xs text-slate-400">No recent transactions found.</td>
                </tr>
              ) : (
                recent.map((e, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="py-2 px-3 text-xs text-slate-500">{e.date}</td>
                    <td className="py-2 px-3 max-w-[180px] truncate text-slate-800">{e.rawAssignee}</td>
                    <td className="py-2 px-3 text-xs text-slate-500 max-w-[130px] truncate">{e.geography || "—"}</td>
                    <td className="py-2 px-3 text-right text-sm font-medium text-slate-700">
                      {e.amountKnown && e.amount != null && e.amount > 0 ? money(e.amount) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Spider modal ─────────────────────────────────────────────────────────────

function SpiderModal({
  firm,
  categorized,
  onClose,
}: {
  firm: string
  categorized: CategorizedEdge[]
  onClose: () => void
}) {
  const [selectedAssignor, setSelectedAssignor] = useState<AssignorNode | null>(null)

  const inbound = categorized.filter((e) => e.to_party === firm && e.flowCategory !== "noise")

  const assignorMap = new Map<string, AssignorNode>()
  for (const e of inbound) {
    const curr = assignorMap.get(e.from_party) ?? { name: e.from_party, deals: 0, volume: 0, category: e.fromCategory }
    curr.deals += 1
    curr.volume += e.amount ?? 0
    assignorMap.set(e.from_party, curr)
  }

  const assignors: AssignorNode[] = Array.from(assignorMap.values())
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 14)

  const maxDeals = Math.max(...assignors.map((a) => a.deals), 1)
  const totalDeals = assignors.reduce((s, a) => s + a.deals, 0)
  const totalVolume = assignors.reduce((s, a) => s + a.volume, 0)

  const W = 560
  const H = 560
  const cx = W / 2
  const cy = H / 2
  const outerR = 200
  const centerR = 46

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-800">
              {selectedAssignor ? `${assignors.find(a => a.name === selectedAssignor.name)?.name ?? selectedAssignor.name}` : firm}
            </h3>
            {!selectedAssignor && (
              <p className="text-sm text-slate-500 mt-0.5">
                {totalDeals} inbound AOM{totalDeals !== 1 ? "s" : ""} · {assignors.length} unique assignors
                {totalVolume > 0 ? ` · ${compact(totalVolume)} total` : ""}
              </p>
            )}
            {selectedAssignor && (
              <p className="text-sm text-slate-500 mt-0.5">Assignor Intelligence — click ← to return to spider view</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-slate-400 hover:text-slate-700 text-2xl leading-none font-light"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          {selectedAssignor ? (
            // ── Assignor detail drill-down ──
            <AssignorDetailPanel
              assignor={selectedAssignor.name}
              category={selectedAssignor.category}
              allEdges={categorized}
              onBack={() => setSelectedAssignor(null)}
            />
          ) : assignors.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-12">No inbound AOM data found for this firm.</p>
          ) : (
            <>
              {/* Click-hint */}
              <p className="text-xs text-slate-400 text-center mb-2 italic">
                Click any assignor node or row to drill into their full intelligence profile ↓
              </p>

              {/* Spider SVG */}
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 440 }}>
                {/* Decorative web rings */}
                {[0.33, 0.66, 1].map((r) => (
                  <circle
                    key={r}
                    cx={cx}
                    cy={cy}
                    r={outerR * r}
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth={1}
                    strokeDasharray="5 4"
                  />
                ))}

                {assignors.map((a, i) => {
                  const angle = (i * 2 * Math.PI) / assignors.length - Math.PI / 2
                  const nx = cx + outerR * Math.cos(angle)
                  const ny = cy + outerR * Math.sin(angle)
                  const nodeR = Math.max(16, Math.min(34, 16 + (a.deals / maxDeals) * 18))
                  const color = CATEGORY_COLOR[a.category]
                  const lineW = Math.max(1.5, Math.min(7, 1.5 + (a.deals / maxDeals) * 5.5))

                  // Label placement
                  const labelDist = outerR + nodeR + 16
                  const lx = cx + labelDist * Math.cos(angle)
                  const ly = cy + labelDist * Math.sin(angle)
                  const cosA = Math.cos(angle)
                  const anchor = cosA > 0.15 ? "start" : cosA < -0.15 ? "end" : "middle"
                  const shortName = a.name.length > 18 ? a.name.slice(0, 16) + "…" : a.name

                  return (
                    <g
                      key={a.name}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedAssignor(a)}
                    >
                      {/* Spoke */}
                      <line
                        x1={cx} y1={cy}
                        x2={nx} y2={ny}
                        stroke={color}
                        strokeWidth={lineW}
                        strokeOpacity={0.35}
                        strokeLinecap="round"
                      />
                      {/* Outer node — hover ring */}
                      <circle cx={nx} cy={ny} r={nodeR + 5} fill={color} fillOpacity={0.06} />
                      {/* Outer node */}
                      <circle cx={nx} cy={ny} r={nodeR} fill={color} fillOpacity={0.13} stroke={color} strokeWidth={2} />
                      {/* Deal count label inside node */}
                      <text
                        x={nx} y={ny}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={11}
                        fontWeight="700"
                        fill={color}
                      >
                        {a.deals}
                      </text>
                      {/* Firm name label outside */}
                      <text
                        x={lx} y={ly}
                        textAnchor={anchor}
                        dominantBaseline="middle"
                        fontSize={10}
                        fill="#475569"
                      >
                        {shortName}
                      </text>
                    </g>
                  )
                })}

                {/* Center node */}
                <circle cx={cx} cy={cy} r={centerR} fill="#1e40af" fillOpacity={0.1} stroke="#1e40af" strokeWidth={2.5} />
                <text
                  x={cx} y={cy - 9}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={10}
                  fontWeight="700"
                  fill="#1e40af"
                >
                  {firm.length > 14 ? firm.slice(0, 13) + "…" : firm}
                </text>
                <text
                  x={cx} y={cy + 9}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="#3b82f6"
                >
                  {totalDeals} AOMs in
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

              {/* Assignor breakdown table — clickable */}
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Assignor Breakdown</h4>
              <div className="rounded border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left py-2 px-3 font-semibold text-slate-600">Assignor (Seller)</th>
                      <th className="text-left py-2 px-3 font-semibold text-slate-600">Type</th>
                      <th className="text-right py-2 px-3 font-semibold text-slate-600">AOMs</th>
                      <th className="text-right py-2 px-3 font-semibold text-slate-600">Volume</th>
                      <th className="text-right py-2 px-3 font-semibold text-slate-600"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignors.map((a, idx) => (
                      <tr
                        key={a.name}
                        className={`cursor-pointer transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"} hover:bg-blue-50`}
                        onClick={() => setSelectedAssignor(a)}
                      >
                        <td className="py-2 px-3 font-medium text-blue-700 max-w-[240px] truncate">{a.name}</td>
                        <td className="py-2 px-3">
                          <span
                            className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                            style={{
                              background: CATEGORY_COLOR[a.category] + "22",
                              color: CATEGORY_COLOR[a.category],
                            }}
                          >
                            {a.category.replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-slate-700">{a.deals}</td>
                        <td className="py-2 px-3 text-right text-slate-500">{a.volume > 0 ? compact(a.volume) : "—"}</td>
                        <td className="py-2 px-3 text-right text-slate-400 text-xs">
                          View →
                        </td>
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
}

export function SectionCompetitorAOM({ edges, lenders }: Props) {
  const [selectedFirm, setSelectedFirm] = useState<string | null>(null)

  const lenderTypeMap = new Map<string, string>()
  for (const l of lenders) {
    if (l.lenderType) lenderTypeMap.set(l.lender.toLowerCase().trim(), l.lenderType)
  }

  const categorized = categorizeEdges(edges, lenderTypeMap)

  // Competitor Rankings
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
  const competitors = Array.from(competitorInbound.entries())
    .map(([name, v]) => ({ name, ...v }))
    .filter((c) => c.deals >= 2)
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 15)

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
  const bankSignals = Array.from(bankSellers.entries())
    .map(([name, v]) => ({ name, volume: v.volume, deals: v.deals, uniqueBuyers: v.uniqueBuyers.size }))
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 10)

  // Clean AOM Flow
  const cleanEdges = categorized
    .filter((e) => e.flowCategory !== "noise")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)

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

  return (
    <>
      {selectedFirm && (
        <SpiderModal
          firm={selectedFirm}
          categorized={categorized}
          onClose={() => setSelectedFirm(null)}
        />
      )}

      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <h3 className="text-base font-semibold text-slate-800">Competitor AOM Intelligence</h3>
        <p className="text-xs text-slate-600 mt-1">
          Florida AOM activity filtered to private creditor flows. Noise removed: {noiseCount.toLocaleString()} bank↔bank / servicer transfers excluded.{" "}
          <span className="font-medium text-slate-700">{cleanCount.toLocaleString()} signal records shown.</span>
        </p>

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          {/* Competitor Rankings */}
          <div>
            <h4 className="text-sm font-semibold text-slate-800 mb-1">Competitor Rankings — Top FL AOM Buyers</h4>
            <p className="text-xs text-slate-500 mb-3">
              Click any firm to see a spider graph of which lenders are assigning loans to them.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Firm</TableHead>
                  <TableHead className="text-right">AOM Count</TableHead>
                  <TableHead className="text-right">Total Volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {competitors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-slate-500 text-xs">No private creditor activity detected.</TableCell>
                  </TableRow>
                ) : (
                  competitors.map((c) => (
                    <TableRow
                      key={c.name}
                      className="cursor-pointer hover:bg-blue-50 transition-colors"
                      onClick={() => setSelectedFirm(c.name)}
                    >
                      <TableCell className="font-medium text-blue-700 hover:underline">{c.name}</TableCell>
                      <TableCell className="text-right">{c.deals}</TableCell>
                      <TableCell className="text-right">{c.volume > 0 ? compact(c.volume) : "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Bank Sell-Off Signals */}
          <div>
            <h4 className="text-sm font-semibold text-slate-800 mb-1">Bank Sell-Off Signals</h4>
            <p className="text-xs text-slate-500 mb-3">
              Banks actively assigning FL loans to private creditors — potential outreach targets.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bank / Originator</TableHead>
                  <TableHead className="text-right">Deals to Private</TableHead>
                  <TableHead className="text-right">Unique Buyers</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bankSignals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-slate-500 text-xs">No bank sell-off signals detected.</TableCell>
                  </TableRow>
                ) : (
                  bankSignals.map((b) => (
                    <TableRow key={b.name}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell className="text-right">{b.deals}</TableCell>
                      <TableCell className="text-right">{b.uniqueBuyers}</TableCell>
                      <TableCell className="text-right">{b.volume > 0 ? compact(b.volume) : "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Clean AOM Flow */}
        <div className="mt-6">
          <h4 className="text-sm font-semibold text-slate-800 mb-1">Recent AOM Flow — Noise Removed</h4>
          <p className="text-xs text-slate-500 mb-3">
            Most recent FL assignments involving private creditors. Bank↔bank and servicer↔servicer transfers hidden.
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
                  <TableRow>
                    <TableCell colSpan={6} className="text-slate-500 text-xs">No clean AOM flow data available.</TableCell>
                  </TableRow>
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
                        {e.amountKnown && e.amount != null && e.amount > 0 ? money(e.amount) : "—"}
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
