"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { CompetitorRanking, PrivateLenderRecord, RecentDealRecord } from "@/lib/participants-intel/types"

function compact(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n)
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
  if (!tip) return <TableHead className={className}>{children}</TableHead>
  return (
    <TableHead className={className}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 cursor-default select-none">
            {children}
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-slate-200 text-slate-500 text-[9px] font-bold leading-none shrink-0">?</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-center leading-snug text-[11px]">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TableHead>
  )
}

// ─── Borrower breakdown for lender expand ─────────────────────────────────────

type BorrowerNode = { name: string; deals: number; totalAmount: number; sharePct: number }

function buildLenderBorrowers(lenderName: string, deals: RecentDealRecord[]): BorrowerNode[] {
  const map = new Map<string, { deals: number; totalAmount: number }>()
  for (const d of deals) {
    if (d.lender !== lenderName) continue
    const name = d.borrower?.trim()
    if (!name || name === "Unknown") continue
    const curr = map.get(name) ?? { deals: 0, totalAmount: 0 }
    curr.deals += 1
    curr.totalAmount += d.amount ?? 0
    map.set(name, curr)
  }
  const rows = Array.from(map.entries())
    .map(([name, v]) => ({ name, deals: v.deals, totalAmount: v.totalAmount, sharePct: 0 }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
  const total = rows.reduce((s, r) => s + r.totalAmount, 0)
  for (const r of rows) r.sharePct = total > 0 ? (r.totalAmount / total) * 100 : 0
  return rows
}

// ─── Expandable lender row ────────────────────────────────────────────────────

function LenderRow({
  lender,
  idx,
  deals,
  aomRank,
}: {
  lender: PrivateLenderRecord
  idx: number
  deals: RecentDealRecord[]
  aomRank: number | null
}) {
  const [open, setOpen] = useState(false)
  const borrowers = useMemo(() => (open ? buildLenderBorrowers(lender.name, deals) : []), [open, lender.name, deals])

  const isUp = lender.percentChange > 0
  const isDown = lender.percentChange < 0
  const shortPct = lender.shortTermPct > 0 ? Math.round(lender.shortTermPct) : null
  const longPct = lender.longTermPct > 0 ? Math.round(lender.longTermPct) : null

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-emerald-50 transition-colors" onClick={() => setOpen((o) => !o)}>
        <TableCell className="w-6">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-emerald-600" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        </TableCell>
        <TableCell className="text-slate-400 text-xs w-8">{idx + 1}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-emerald-700 max-w-[200px] truncate">{lender.name}</span>
            {aomRank !== null && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                AOM Buyer · #{aomRank}
              </span>
            )}
          </div>
          {lender.lenderType && <div className="text-[10px] text-slate-400 mt-0.5">{lender.lenderType}</div>}
        </TableCell>
        <TableCell className="text-right tabular-nums">{lender.count}</TableCell>
        <TableCell className="text-right text-slate-600 tabular-nums">{lender.volume > 0 ? compact(lender.volume) : "—"}</TableCell>
        <TableCell className="text-right text-slate-500 tabular-nums">{lender.avgDealSize > 0 ? compact(lender.avgDealSize) : "—"}</TableCell>
        <TableCell className="text-right tabular-nums">
          {lender.percentChange !== 0 ? (
            <span className={`font-semibold text-sm ${isUp ? "text-emerald-600" : isDown ? "text-rose-600" : "text-slate-400"}`}>
              {pctFmt(lender.percentChange)}
            </span>
          ) : <span className="text-slate-400">—</span>}
        </TableCell>
        <TableCell className="text-right text-slate-500 text-xs tabular-nums">
          {shortPct !== null && longPct !== null ? `${shortPct}% / ${longPct}%` : "—"}
        </TableCell>
      </TableRow>

      {open && (
        <TableRow className="bg-emerald-50/60 hover:bg-emerald-50/60">
          <TableCell colSpan={8} className="py-0 px-0">
            <div className="px-10 py-4 border-t border-emerald-100">
              {borrowers.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-1">No borrower transactions found in the current dataset.</p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-500 mb-3">
                    Borrowers funded by <span className="font-semibold text-slate-700">{lender.name}</span>
                  </p>
                  <div className="space-y-2">
                    {borrowers.map((b) => (
                      <div key={b.name} className="flex items-center gap-3">
                        <div className="w-48 shrink-0 text-xs font-medium text-slate-700 truncate" title={b.name}>{b.name}</div>
                        <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                          <div className="h-full bg-emerald-400/70 rounded" style={{ width: `${Math.max(b.sharePct, 2)}%` }} />
                        </div>
                        <div className="w-16 text-right text-xs tabular-nums text-slate-600 shrink-0">{b.totalAmount > 0 ? compact(b.totalAmount) : "—"}</div>
                        <div className="w-16 text-right text-[11px] tabular-nums text-slate-400 shrink-0">{b.deals} deal{b.deals !== 1 ? "s" : ""}</div>
                        <div className="w-12 text-right text-[11px] tabular-nums text-slate-400 shrink-0">{b.sharePct > 0 ? `${b.sharePct.toFixed(0)}%` : ""}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ─── Active Borrower Signals ──────────────────────────────────────────────────

type BorrowerSignal = {
  name: string
  loanCount: number
  totalBorrowed: number
  lenders: string[]
  signal: "multi-lender" | "repeat" | "active"
}

function buildBorrowerSignals(deals: RecentDealRecord[]): BorrowerSignal[] {
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
    .filter(([, v]) => v.count >= 2 || v.lenders.size >= 2)
    .map(([name, v]) => {
      const lenders = Array.from(v.lenders)
      const signal: BorrowerSignal["signal"] =
        v.lenders.size >= 2 ? "multi-lender" : v.count >= 3 ? "repeat" : "active"
      return { name, loanCount: v.count, totalBorrowed: v.total, lenders, signal }
    })
    .sort((a, b) => b.loanCount - a.loanCount || b.lenders.length - a.lenders.length)
    .slice(0, 15)
}

const SIGNAL_STYLE: Record<BorrowerSignal["signal"], { label: string; className: string }> = {
  "multi-lender": { label: "Multi-Lender", className: "bg-rose-50 text-rose-700 border-rose-200" },
  repeat:         { label: "Repeat Borrower", className: "bg-amber-50 text-amber-700 border-amber-200" },
  active:         { label: "Active", className: "bg-slate-100 text-slate-600 border-slate-200" },
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  lenders: PrivateLenderRecord[]
  deals: RecentDealRecord[]
  rankings: CompetitorRanking[]
  geo: string
}

export function SectionPrivateCreditorMonitor({ lenders, deals, rankings, geo }: Props) {
  const borrowerSignals = useMemo(() => buildBorrowerSignals(deals), [deals])
  const label = geoLabel(geo)

  // Build a normalized rankings lookup for cross-referencing (name → rank)
  const rankingsByName = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rankings) map.set(r.name.toLowerCase().trim(), r.rank)
    return map
  }, [rankings])

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30 space-y-8">
      <div>
        <h3 className="text-base font-semibold text-slate-800">Private Creditor Monitor</h3>
        <p className="text-xs text-slate-500 mt-1">
          Active private lending activity in {label} — originations, deal flow, and borrower signals.
        </p>
      </div>

      {/* Panel A — Active Private Creditors */}
      <div>
        <h4 className="text-sm font-semibold text-slate-800 mb-1">Active Private Creditors</h4>
        <p className="text-xs text-slate-500 mb-3">
          Click any lender to see their borrower breakdown. Blue badge = this lender is also an active AOM buyer in the competitor rankings.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <Th tip="Rank by total origination volume over the last 12 months. #1 is the most active private creditor in this geography." className="w-8">#</Th>
              <Th tip="The private credit institution or hard-money lender originating the mortgage. These are non-bank, non-agency lenders operating outside GSE (Fannie/Freddie) guidelines — typically providing bridge, construction, or direct CRE debt.">Lender</Th>
              <Th tip="Number of mortgage originations recorded in this period." className="text-right">Deals</Th>
              <Th tip="Total dollar volume of loans originated in the last 12 months." className="text-right">Volume</Th>
              <Th tip="Average individual loan size — total volume divided by deal count." className="text-right">Avg Deal</Th>
              <Th tip="Percent change in deal volume compared to the prior equivalent period." className="text-right">Δ vs Prior</Th>
              <Th tip="Short-term = under 3 years (bridge/hard money). Long-term = 3 years or more." className="text-right">Short / Long</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lenders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-slate-500 text-xs">No private creditor data available for {label}.</TableCell>
              </TableRow>
            ) : (
              lenders.map((l, idx) => {
                const aomRank = rankingsByName.get(l.name.toLowerCase().trim()) ?? null
                return <LenderRow key={l.lenderId} lender={l} idx={idx} deals={deals} aomRank={aomRank} />
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Panel B — Recent Originations */}
      <div>
        <h4 className="text-sm font-semibold text-slate-800 mb-1">Recent Originations</h4>
        <p className="text-xs text-slate-500 mb-3">Latest private credit mortgage originations in {label}, sorted by recording date.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <Th tip="Date the mortgage was recorded with the county clerk. Recording date is when the lien becomes public record — origination may have occurred days or weeks earlier.">Date</Th>
              <Th tip="The private credit firm that originated this loan. Non-bank, non-agency lenders providing bridge, hard money, or direct private credit outside conventional GSE programs.">Lender</Th>
              <Th tip="The borrowing entity — typically an LLC or operating company holding the collateral property. Entity structure (LLC, trust, corp) is visible in the deed record.">Borrower Entity</Th>
              <Th tip="Loan amount as recorded on the mortgage document." className="text-right">Amount</Th>
              <Th tip="City and county where the collateral property is located.">Location</Th>
              <Th tip="Open = loan still active. Closed = satisfaction of mortgage recorded.">Status</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deals.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-slate-500 text-xs">No recent origination data available for {label}.</TableCell></TableRow>
            ) : (
              deals.map((d, idx) => (
                <TableRow key={d.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                  <TableCell className="text-slate-600 tabular-nums text-sm whitespace-nowrap">{d.date || "—"}</TableCell>
                  <TableCell><div className="font-medium text-slate-800 max-w-[160px] truncate text-sm">{d.lender}</div></TableCell>
                  <TableCell>
                    <div className="text-slate-700 max-w-[180px] truncate text-sm">{d.borrower}</div>
                    {d.propertyType && <div className="text-[10px] text-slate-400 mt-0.5">{d.propertyType}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600 text-sm">{d.amount && d.amount > 0 ? compact(d.amount) : "—"}</TableCell>
                  <TableCell className="text-slate-500 text-sm max-w-[160px] truncate">
                    {d.city ? `${d.city}${d.county ? `, ${d.county}` : ""}` : d.county || "—"}
                  </TableCell>
                  <TableCell>
                    {d.loanStatus ? (
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${d.loanStatus === "open" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"}`}>
                        {d.loanStatus}
                      </span>
                    ) : <span className="text-slate-400 text-xs">—</span>}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Panel C — Active Borrower Signals */}
      <div>
        <h4 className="text-sm font-semibold text-slate-800 mb-1">Active Borrower Signals</h4>
        <p className="text-xs text-slate-500 mb-3">
          Entities with 2+ loans or borrowing from multiple lenders — potential distress or high-activity signals relevant to Safe Harbor&apos;s sourcing strategy.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <Th tip="Legal entity name as recorded on the mortgage document.">Borrower Entity</Th>
              <Th tip="Total private credit loans in the current dataset." className="text-right">Loans</Th>
              <Th tip="Sum of all loan amounts for this borrower." className="text-right">Total Borrowed</Th>
              <Th tip="Private creditors this entity has borrowed from. Multiple lenders may indicate an overleveraged operator." >Lenders</Th>
              <Th tip="Multi-Lender = borrowing from 2+ different lenders (overlap/distress signal). Repeat = 3+ loans from same lender.">Signal</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {borrowerSignals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-slate-500 text-xs">No high-activity borrower signals detected in the current dataset.</TableCell>
              </TableRow>
            ) : (
              borrowerSignals.map((b, idx) => {
                const style = SIGNAL_STYLE[b.signal]
                return (
                  <TableRow key={b.name} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <TableCell className="font-medium text-slate-800 max-w-[220px] truncate">{b.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.loanCount}</TableCell>
                    <TableCell className="text-right text-slate-600 tabular-nums">{b.totalBorrowed > 0 ? compact(b.totalBorrowed) : "—"}</TableCell>
                    <TableCell className="text-slate-500 text-sm max-w-[260px] truncate">
                      {b.lenders.length > 0 ? b.lenders.slice(0, 3).join(", ") + (b.lenders.length > 3 ? ` +${b.lenders.length - 3}` : "") : "—"}
                    </TableCell>
                    <TableCell>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${style.className}`}>
                        {style.label}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
