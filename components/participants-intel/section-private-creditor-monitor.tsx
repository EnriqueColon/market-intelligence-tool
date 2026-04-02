"use client"

import { useMemo } from "react"
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
  if (geo === "florida") return "Florida"
  return "Florida"
}

// ─── Borrower entities (derived from deals) ───────────────────────────────────

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
    .map(([name, v]) => ({
      name,
      loanCount: v.count,
      totalBorrowed: v.total,
      lenders: Array.from(v.lenders),
    }))
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
          Private money lenders ranked by origination volume in {label} over the last 12 months.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Lender</TableHead>
              <TableHead className="text-right">Deals</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              <TableHead className="text-right">Avg Deal</TableHead>
              <TableHead className="text-right">Δ vs Prior</TableHead>
              <TableHead className="text-right">Short / Long</TableHead>
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
                  <TableRow key={l.lenderId} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <TableCell className="text-slate-400 text-xs">{idx + 1}</TableCell>
                    <TableCell>
                      <div className="font-medium text-slate-800 max-w-[220px] truncate">{l.name}</div>
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
                      {shortPct !== null && longPct !== null
                        ? `${shortPct}% / ${longPct}%`
                        : "—"}
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
              <TableHead>Date</TableHead>
              <TableHead>Lender</TableHead>
              <TableHead>Borrower Entity</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
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
              <TableHead>Borrower Entity</TableHead>
              <TableHead className="text-right">Loans</TableHead>
              <TableHead className="text-right">Total Borrowed</TableHead>
              <TableHead>Lenders Used</TableHead>
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
