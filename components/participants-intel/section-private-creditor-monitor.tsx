"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { PrivateLenderRecord, RecentDealRecord } from "@/lib/participants-intel/types"

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

// ─── Borrower breakdown (derived from deals for one lender) ───────────────────

type BorrowerNode = {
  name: string
  deals: number
  totalAmount: number
  sharePct: number
}

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
  for (const r of rows) {
    r.sharePct = total > 0 ? (r.totalAmount / total) * 100 : 0
  }
  return rows
}

// ─── Expandable lender row ────────────────────────────────────────────────────

function LenderRow({
  lender,
  idx,
  deals,
}: {
  lender: PrivateLenderRecord
  idx: number
  deals: RecentDealRecord[]
}) {
  const [open, setOpen] = useState(false)
  const borrowers = useMemo(() => (open ? buildLenderBorrowers(lender.name, deals) : []), [open, lender.name, deals])

  const isUp = lender.percentChange > 0
  const isDown = lender.percentChange < 0
  const shortPct = lender.shortTermPct > 0 ? Math.round(lender.shortTermPct) : null
  const longPct = lender.longTermPct > 0 ? Math.round(lender.longTermPct) : null

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-emerald-50 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <TableCell className="text-slate-400 text-xs w-6">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-emerald-600" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        </TableCell>
        <TableCell className="text-slate-400 text-xs w-8">{idx + 1}</TableCell>
        <TableCell>
          <div className="font-medium text-emerald-700 max-w-[220px] truncate">{lender.name}</div>
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
          ) : (
            <span className="text-slate-400">—</span>
          )}
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
                <p className="text-xs text-slate-500 italic py-1">
                  No borrower transactions found for this lender in the current dataset (last 25 originations).
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-500 mb-3">
                    Borrowers funded by <span className="font-semibold text-slate-700">{lender.name}</span> — based on recent originations feed
                  </p>
                  <div className="space-y-2">
                    {borrowers.map((b) => (
                      <div key={b.name} className="flex items-center gap-3">
                        {/* Borrower name */}
                        <div className="w-48 shrink-0 text-xs font-medium text-slate-700 truncate" title={b.name}>{b.name}</div>
                        {/* Bar */}
                        <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                          <div
                            className="h-full bg-emerald-400/70 rounded transition-all"
                            style={{ width: `${Math.max(b.sharePct, 2)}%` }}
                          />
                        </div>
                        {/* Stats */}
                        <div className="w-16 text-right text-xs tabular-nums text-slate-600 shrink-0">
                          {b.totalAmount > 0 ? compact(b.totalAmount) : "—"}
                        </div>
                        <div className="w-16 text-right text-[11px] tabular-nums text-slate-400 shrink-0">
                          {b.deals} deal{b.deals !== 1 ? "s" : ""}
                        </div>
                        <div className="w-12 text-right text-[11px] tabular-nums text-slate-400 shrink-0">
                          {b.sharePct > 0 ? `${b.sharePct.toFixed(0)}%` : ""}
                        </div>
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

// ─── Borrower entities (derived from all deals) ───────────────────────────────

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
  const borrowers = useMemo(() => buildBorrowerTable(deals), [deals])
  const label = geoLabel(geo)

  return (
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
          Click any lender to expand their borrower breakdown — who they fund, how much, and share of recent activity.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
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
                <TableCell colSpan={8} className="text-slate-500 text-xs">
                  No private creditor data available for {label}.
                </TableCell>
              </TableRow>
            ) : (
              lenders.map((l, idx) => (
                <LenderRow key={l.lenderId} lender={l} idx={idx} deals={deals} />
              ))
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
  )
}
