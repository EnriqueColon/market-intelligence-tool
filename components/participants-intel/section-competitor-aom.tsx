"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CompetitorAssignorRow, CompetitorRanking, PrivateLenderRecord } from "@/lib/participants-intel/types"

function compact(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n)
}

function pctFmt(n: number) {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(1)}%`
}

// ─── Momentum badge ───────────────────────────────────────────────────────────

function MomentumBadge({ pct }: { pct: number }) {
  if (pct >= 15) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      ↑ Accelerating
    </span>
  )
  if (pct > 0) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
      ↗ Growing
    </span>
  )
  if (pct === 0) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
      → Stable
    </span>
  )
  if (pct > -15) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
      ↘ Declining
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
      ↓ Contracting
    </span>
  )
}

// ─── Competitor sourcing expandable row ───────────────────────────────────────

function CompetitorRow({ row }: { row: CompetitorAssignorRow }) {
  const [open, setOpen] = useState(false)
  const total = row.totalAOMs
  const maxDeals = Math.max(...row.assignors.map((a) => a.deals), 1)

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-blue-50/60 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <TableCell className="w-6">
          {open
            ? <ChevronDown className="h-3.5 w-3.5 text-blue-600" />
            : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        </TableCell>
        <TableCell>
          <div className="font-semibold text-blue-800 max-w-[240px] truncate">{row.competitorName}</div>
        </TableCell>
        <TableCell className="text-right tabular-nums font-medium text-slate-700">{row.totalAOMs}</TableCell>
        <TableCell className="text-right tabular-nums text-slate-600">{row.totalAmount > 0 ? compact(row.totalAmount) : "—"}</TableCell>
        <TableCell className="text-right">
          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-medium tabular-nums">
            {row.assignors.length} source{row.assignors.length !== 1 ? "s" : ""}
          </span>
        </TableCell>
      </TableRow>

      {open && (
        <TableRow className="bg-blue-50/30 hover:bg-blue-50/30">
          <TableCell colSpan={5} className="py-0 px-0">
            <div className="px-10 py-4 border-t border-blue-100">
              <p className="text-[11px] text-slate-500 mb-3">
                Institutions assigning paper to <span className="font-semibold text-slate-700">{row.competitorName}</span>
                {row.totalAmount > 0 ? ` — ${compact(row.totalAmount)} total received` : ""}
              </p>
              <div className="space-y-2">
                {row.assignors.map((a) => {
                  const barPct = (a.deals / maxDeals) * 100
                  const sharePct = total > 0 ? (a.deals / total) * 100 : 0
                  return (
                    <div key={a.name} className="flex items-center gap-3">
                      <div className="w-52 shrink-0 text-xs font-medium text-slate-700 truncate" title={a.name}>{a.name}</div>
                      <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                        <div className="h-full bg-blue-400/50 rounded transition-all" style={{ width: `${Math.max(barPct, 2)}%` }} />
                      </div>
                      <div className="w-14 text-right text-xs tabular-nums text-slate-700 shrink-0 font-medium">
                        {a.deals} AOM{a.deals !== 1 ? "s" : ""}
                      </div>
                      <div className="w-16 text-right text-xs tabular-nums text-slate-500 shrink-0">
                        {a.amount > 0 ? compact(a.amount) : "—"}
                      </div>
                      <div className="w-10 text-right text-[11px] tabular-nums text-slate-400 shrink-0">
                        {sharePct > 0 ? `${sharePct.toFixed(0)}%` : ""}
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-slate-400 mt-3 italic">
                Institutions appearing here and not in Safe Harbor&apos;s deal flow represent direct sourcing gaps.
              </p>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ─── Main section ─────────────────────────────────────────────────────────────

type Props = {
  rankings: CompetitorRanking[]
  competitorAssignors: CompetitorAssignorRow[]
  privateLenders: PrivateLenderRecord[]
}

export function SectionCompetitorAOM({ rankings, competitorAssignors, privateLenders }: Props) {
  // Build private lender name set for cross-reference badge
  const privateLenderNames = new Set(privateLenders.map((l) => l.name.toLowerCase().trim()))

  const competitors = [...rankings].sort((a, b) => a.rank - b.rank)

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30 space-y-8">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-slate-800">Competitor AOM Intelligence</h3>
        <p className="text-xs text-slate-500 mt-1">
          Assignment-of-mortgage activity — competitor momentum and sourcing intelligence.
        </p>
      </div>

      {/* ── Competitor Rankings ── */}
      <div>
        <h4 className="text-sm font-semibold text-slate-800 mb-1">Competitor Rankings — FL AOM Buyers</h4>
        <p className="text-xs text-slate-500 mb-3">
          Firms most actively acquiring AOMs. Momentum reflects change vs prior period. Green badge = this competitor also appears as an active private creditor originator.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Firm</TableHead>
              <TableHead className="text-right">AOMs</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              <TableHead className="text-right">Avg Deal</TableHead>
              <TableHead className="text-right">Δ vs Prior</TableHead>
              <TableHead>Momentum</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {competitors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-slate-500 text-xs">No competitor rankings available — verify ELEMENTIX_API_KEY is set.</TableCell>
              </TableRow>
            ) : (
              competitors.map((c) => {
                const isPrivateLender = privateLenderNames.has(c.name.toLowerCase().trim())
                const isUp = c.percentChange > 0
                const isDown = c.percentChange < 0
                return (
                  <TableRow key={c.name} className="hover:bg-slate-50 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-800 max-w-[200px] truncate">{c.name}</span>
                        {isPrivateLender && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                            Private Lender
                          </span>
                        )}
                      </div>
                      {c.category && <div className="text-[10px] text-slate-400 mt-0.5">{c.category}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                    <TableCell className="text-right text-slate-600 tabular-nums">{c.volume > 0 ? compact(c.volume) : "—"}</TableCell>
                    <TableCell className="text-right text-slate-500 tabular-nums">{c.avgDealSize > 0 ? compact(c.avgDealSize) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.percentChange !== 0 ? (
                        <span className={`font-semibold ${isUp ? "text-emerald-600" : isDown ? "text-rose-600" : "text-slate-400"}`}>
                          {pctFmt(c.percentChange)}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell>
                      <MomentumBadge pct={c.percentChange} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Competitor Sourcing Intelligence ── */}
      <div>
        <h4 className="text-sm font-semibold text-slate-800 mb-1">Competitor Sourcing Intelligence</h4>
        <p className="text-xs text-slate-500 mb-3">
          Where competitors are getting their AOMs from — expand any firm to see the institutions feeding their pipeline.
          <span className="block mt-1 text-slate-400 italic">
            If an institution appears here and not in Safe Harbor&apos;s deal flow, that is a direct sourcing gap to close.
          </span>
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Competitor</TableHead>
              <TableHead className="text-right">AOMs Received</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              <TableHead className="text-right">Sources</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {competitorAssignors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-slate-500 text-xs py-4">
                  No sourcing data available — data will populate once competitor AOM records are loaded.
                </TableCell>
              </TableRow>
            ) : (
              competitorAssignors.map((c) => <CompetitorRow key={c.competitorName} row={c} />)
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
