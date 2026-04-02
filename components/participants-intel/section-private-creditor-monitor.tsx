"use client"

import { useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { PrivateLenderRecord, RecentDealRecord } from "@/lib/participants-intel/types"

function compact(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n)
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

function pctFmt(n: number) {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(1)}%`
}

function geoLabel(geo: string) {
  if (geo === "miami") return "Miami-Dade, FL"
  return "Florida"
}

// ─── Tooltip header ───────────────────────────────────────────────────────────

function Th({ children, tip, className }: { children: React.ReactNode; tip?: string; className?: string }) {
  return (
    <TableHead className={className}>
      {tip ? (
        <span className="inline-flex items-center gap-1 group relative cursor-default">
          {children}
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-slate-200 text-slate-500 text-[9px] font-bold leading-none shrink-0">?</span>
          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-slate-800 text-white text-[11px] leading-snug px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg whitespace-normal text-center">
            {tip}
          </span>
        </span>
      ) : children}
    </TableHead>
  )
}

// ─── Borrower nodes for spider ────────────────────────────────────────────────

type BorrowerNode = {
  name: string
  deals: number
  totalAmount: number
}

function buildLenderBorrowers(lenderName: string, deals: RecentDealRecord[]): BorrowerNode[] {
  const map = new Map<string, BorrowerNode>()
  for (const d of deals) {
    if (d.lender !== lenderName) continue
    const name = d.borrower?.trim()
    if (!name || name === "Unknown") continue
    const curr = map.get(name) ?? { name, deals: 0, totalAmount: 0 }
    curr.deals += 1
    curr.totalAmount += d.amount ?? 0
    map.set(name, curr)
  }
  return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 14)
}

// ─── Lender spider modal ──────────────────────────────────────────────────────

function LenderSpiderModal({
  lender,
  deals,
  onClose,
}: {
  lender: PrivateLenderRecord
  deals: RecentDealRecord[]
  onClose: () => void
}) {
  const borrowers = useMemo(() => buildLenderBorrowers(lender.name, deals), [lender.name, deals])
  const maxAmount = Math.max(...borrowers.map((b) => b.totalAmount), 1)
  const maxDeals = Math.max(...borrowers.map((b) => b.deals), 1)
  const totalDeployed = borrowers.reduce((s, b) => s + b.totalAmount, 0)
  const totalDeals = borrowers.reduce((s, b) => s + b.deals, 0)

  const W = 580; const H = 540; const cx = W / 2; const cy = H / 2
  const outerR = 195; const centerR = 48

  // Color per borrower — cycle through a warm palette
  const PALETTE = ["#10b981", "#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#a78bfa", "#fb923c", "#34d399"]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-3 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="text-lg font-bold text-slate-800">{lender.name}</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {totalDeals} loan{totalDeals !== 1 ? "s" : ""} · {borrowers.length} unique borrower{borrowers.length !== 1 ? "s" : ""}
              {totalDeployed > 0 ? ` · ${compact(totalDeployed)} deployed` : ""}
            </p>
          </div>
          <button onClick={onClose} className="ml-4 text-slate-400 hover:text-slate-700 text-2xl leading-none font-light">×</button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {borrowers.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-12">No borrower transaction data found for this lender in the current dataset.</p>
          ) : (
            <>
              <p className="text-xs text-slate-400 text-center mb-1">Node size ∝ deal count · spoke width ∝ total amount deployed</p>

              {/* Spider SVG */}
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 420 }}>
                {/* Grid rings */}
                {[0.33, 0.66, 1].map((r) => (
                  <circle key={r} cx={cx} cy={cy} r={outerR * r} fill="none" stroke="#e2e8f0" strokeWidth={1} strokeDasharray="5 4" />
                ))}

                {borrowers.map((b, i) => {
                  const angle = (i * 2 * Math.PI) / borrowers.length - Math.PI / 2
                  const nx = cx + outerR * Math.cos(angle)
                  const ny = cy + outerR * Math.sin(angle)
                  const nodeR = Math.max(14, Math.min(32, 14 + (b.deals / maxDeals) * 18))
                  const lineW = Math.max(1.5, Math.min(8, 1.5 + (b.totalAmount / maxAmount) * 6.5))
                  const labelDist = outerR + nodeR + 14
                  const lx = cx + labelDist * Math.cos(angle)
                  const ly = cy + labelDist * Math.sin(angle)
                  const cosA = Math.cos(angle)
                  const anchor = cosA > 0.15 ? "start" : cosA < -0.15 ? "end" : "middle"
                  const shortName = b.name.length > 20 ? b.name.slice(0, 18) + "…" : b.name
                  const color = PALETTE[i % PALETTE.length]

                  return (
                    <g key={b.name}>
                      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={lineW} strokeOpacity={0.4} strokeLinecap="round" />
                      <circle cx={nx} cy={ny} r={nodeR} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={2} />
                      <circle cx={nx} cy={ny} r={nodeR + 8} fill="transparent" />
                      <text x={nx} y={ny - 4} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight="700" fill={color} style={{ pointerEvents: "none" }}>{b.deals}</text>
                      {b.totalAmount > 0 && (
                        <text x={nx} y={ny + 7} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill={color} style={{ pointerEvents: "none" }}>{compact(b.totalAmount)}</text>
                      )}
                      <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize={10} fill="#475569" style={{ pointerEvents: "none" }}>{shortName}</text>
                    </g>
                  )
                })}

                {/* Center node — green for private creditor */}
                <circle cx={cx} cy={cy} r={centerR} fill="#10b981" fillOpacity={0.12} stroke="#10b981" strokeWidth={2.5} />
                <text x={cx} y={cy - 9} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight="700" fill="#059669">
                  {lender.name.length > 14 ? lender.name.slice(0, 13) + "…" : lender.name}
                </text>
                <text x={cx} y={cy + 9} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#10b981">
                  {totalDeals} loan{totalDeals !== 1 ? "s" : ""}
                </text>
              </svg>

              {/* Borrower breakdown table */}
              <h4 className="text-sm font-semibold text-slate-700 mb-2 mt-2">Borrower Breakdown</h4>
              <div className="rounded border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left py-2 px-3 font-semibold text-slate-600">Borrower Entity</th>
                      <th className="text-right py-2 px-3 font-semibold text-slate-600">Loans</th>
                      <th className="text-right py-2 px-3 font-semibold text-slate-600">Total Deployed</th>
                      <th className="text-right py-2 px-3 font-semibold text-slate-600">Avg Loan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {borrowers.map((b, idx) => (
                      <tr key={b.name} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                        <td className="py-2 px-3 font-medium text-slate-800 max-w-[240px] truncate">{b.name}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-700">{b.deals}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-600">{b.totalAmount > 0 ? money(b.totalAmount) : "—"}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-500">
                          {b.deals > 0 && b.totalAmount > 0 ? compact(b.totalAmount / b.deals) : "—"}
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

// ─── Borrower table (derived from all deals) ──────────────────────────────────

type BorrowerRow = {
  name: string
  loanCount: number
  totalBorrowed: number
  lenders: string[]
}

function buildBorrowerTable(deals: RecentDealRecord[]): BorrowerRow[] {
  const map = new Map<string, { total: number; count: number; lenders: Set<string> }>()
  for (const d of deals) {
    const name = d.borrower?.trim()
    if (!name || name === "Unknown") continue
    const curr = map.get(name) ?? { total: 0, count: 0, lenders: new Set() }
    curr.count += 1
    if (d.amount) curr.total += d.amount
    if (d.lender && d.lender !== "Unknown") curr.lenders.add(d.lender)
    map.set(name, curr)
  }
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, loanCount: v.count, totalBorrowed: v.total, lenders: Array.from(v.lenders) }))
    .sort((a, b) => b.loanCount - a.loanCount)
    .slice(0, 15)
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  lenders: PrivateLenderRecord[]
  deals: RecentDealRecord[]
  geo: string
}

export function SectionPrivateCreditorMonitor({ lenders, deals, geo }: Props) {
  const [selectedLender, setSelectedLender] = useState<PrivateLenderRecord | null>(null)
  const borrowers = useMemo(() => buildBorrowerTable(deals), [deals])
  const label = geoLabel(geo)

  return (
    <>
      {selectedLender && (
        <LenderSpiderModal lender={selectedLender} deals={deals} onClose={() => setSelectedLender(null)} />
      )}

      <Card className="p-6 border-slate-200/80 bg-slate-50/30 space-y-8">
        {/* Header */}
        <div>
          <h3 className="text-base font-semibold text-slate-800">Private Creditor Monitor</h3>
          <p className="text-xs text-slate-500 mt-1">
            Active private lending activity in {label} — originations, deal flow, and borrower entities.
          </p>
        </div>

        {/* Panel A — Active Private Creditors */}
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-1">Active Private Creditors</h4>
          <p className="text-xs text-slate-500 mb-3">
            Click any lender to open the borrower spider graph showing where they deploy capital.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Lender</TableHead>
                <Th tip="Number of mortgage originations recorded in this period." className="text-right">Deals</Th>
                <Th tip="Total dollar volume of loans originated in the last 12 months." className="text-right">Volume</Th>
                <Th tip="Average individual loan size — total volume divided by deal count." className="text-right">Avg Deal</Th>
                <Th tip="Percent change in deal volume compared to the prior equivalent period. Green = growing, red = shrinking." className="text-right">Δ vs Prior</Th>
                <Th tip="Share of loans by term length. Short-term = under 3 years (bridge/hard money). Long-term = 3 years or more." className="text-right">Short / Long</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lenders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-slate-500 text-xs">
                    No private creditor data available for {label}.
                  </TableCell>
                </TableRow>
              ) : (
                lenders.map((l, idx) => {
                  const isUp = l.percentChange > 0
                  const isDown = l.percentChange < 0
                  const shortPct = l.shortTermPct > 0 ? Math.round(l.shortTermPct) : null
                  const longPct = l.longTermPct > 0 ? Math.round(l.longTermPct) : null
                  return (
                    <TableRow
                      key={l.lenderId}
                      className="cursor-pointer hover:bg-emerald-50 transition-colors"
                      onClick={() => setSelectedLender(l)}
                    >
                      <TableCell className="text-slate-400 text-xs">{idx + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium text-emerald-700 max-w-[220px] truncate">{l.name}</div>
                        {l.lenderType && <div className="text-[10px] text-slate-400 mt-0.5">{l.lenderType}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.count}</TableCell>
                      <TableCell className="text-right text-slate-600 tabular-nums">{l.volume > 0 ? compact(l.volume) : "—"}</TableCell>
                      <TableCell className="text-right text-slate-500 tabular-nums">{l.avgDealSize > 0 ? compact(l.avgDealSize) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.percentChange !== 0 ? (
                          <span className={`font-semibold text-sm ${isUp ? "text-emerald-600" : isDown ? "text-rose-600" : "text-slate-400"}`}>
                            {pctFmt(l.percentChange)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-slate-500 text-xs tabular-nums">
                        {shortPct !== null && longPct !== null ? `${shortPct}% / ${longPct}%` : "—"}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Panel B — Recent Originations */}
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-1">Recent Originations</h4>
          <p className="text-xs text-slate-500 mb-3">
            Latest private credit mortgage originations in {label}, sorted by recording date.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <Th tip="Date the mortgage was recorded with the county clerk.">Date</Th>
                <TableHead>Lender</TableHead>
                <Th tip="The borrowing entity — typically an LLC or operating company taking the loan.">Borrower Entity</Th>
                <Th tip="Loan amount as recorded on the mortgage document." className="text-right">Amount</Th>
                <Th tip="City and county where the collateral property is located.">Location</Th>
                <Th tip="Open = loan still active. Closed = satisfaction of mortgage recorded, loan paid off.">Status</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-slate-500 text-xs">
                    No recent origination data available for {label}.
                  </TableCell>
                </TableRow>
              ) : (
                deals.map((d, idx) => (
                  <TableRow key={d.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <TableCell className="text-slate-600 tabular-nums text-sm whitespace-nowrap">{d.date || "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium text-slate-800 max-w-[160px] truncate text-sm">{d.lender}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-slate-700 max-w-[180px] truncate text-sm">{d.borrower}</div>
                      {d.propertyType && <div className="text-[10px] text-slate-400 mt-0.5">{d.propertyType}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600 text-sm">
                      {d.amount && d.amount > 0 ? compact(d.amount) : "—"}
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm max-w-[160px] truncate">
                      {d.city ? `${d.city}${d.county ? `, ${d.county}` : ""}` : d.county || "—"}
                    </TableCell>
                    <TableCell>
                      {d.loanStatus ? (
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                          d.loanStatus === "open"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-slate-100 text-slate-500 border border-slate-200"
                        }`}>
                          {d.loanStatus}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Panel C — Borrower Entities */}
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-1">Borrower Entities</h4>
          <p className="text-xs text-slate-500 mb-3">
            Entities taking private credit loans in {label}, derived from recent originations.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <Th tip="Legal entity name of the borrower as recorded on the mortgage document.">Borrower Entity</Th>
                <Th tip="Total number of private credit loans taken by this entity in the current dataset." className="text-right">Loans</Th>
                <Th tip="Sum of all loan amounts for this borrower across the current dataset." className="text-right">Total Borrowed</Th>
                <Th tip="Private creditors this entity has borrowed from. Multiple lenders may indicate a sophisticated borrower or portfolio operator.">Lenders Used</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {borrowers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-slate-500 text-xs">
                    No borrower entity data available for {label}.
                  </TableCell>
                </TableRow>
              ) : (
                borrowers.map((b, idx) => (
                  <TableRow key={b.name} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <TableCell className="font-medium text-slate-800 max-w-[220px] truncate">{b.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.loanCount}</TableCell>
                    <TableCell className="text-right text-slate-600 tabular-nums">
                      {b.totalBorrowed > 0 ? compact(b.totalBorrowed) : "—"}
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm max-w-[260px] truncate">
                      {b.lenders.length > 0 ? b.lenders.slice(0, 3).join(", ") + (b.lenders.length > 3 ? ` +${b.lenders.length - 3}` : "") : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
  )
}
