"use client"

import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ExecutiveAlert, PreforeclosureRecord } from "@/lib/participants-intel/types"

function money(n?: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0)
}

type Props = {
  preforeclosures: PreforeclosureRecord[]
  alerts: ExecutiveAlert[]
}

export function SectionLegalSignals({ preforeclosures, alerts }: Props) {
  const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const d90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const lenderStats = new Map<string, { c30: number; c90: number }>()

  for (const p of preforeclosures) {
    const lender = (p.lender || p.plaintiff || "").trim() || "Unknown Lender"
    const d = p.auctionDate || ""
    const curr = lenderStats.get(lender) || { c30: 0, c90: 0 }
    if (d >= d90) curr.c90 += 1
    if (d >= d30) curr.c30 += 1
    lenderStats.set(lender, curr)
  }

  const lenderRows = Array.from(lenderStats.entries())
    .map(([lender, s]) => ({
      lender,
      c30: s.c30,
      c90: s.c90,
      trend: s.c30 > s.c90 / 3 ? "up" : s.c30 < s.c90 / 3 ? "down" : "flat",
    }))
    .sort((a, b) => b.c30 - a.c30)

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <h3 className="text-base font-semibold text-slate-800">5) Legal / Credit Activity Signals</h3>

      <div className="mt-4">
        <h4 className="text-sm font-semibold text-slate-800 mb-2">Preforeclosure Table</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Defendant</TableHead>
              <TableHead>Plaintiff (Lender)</TableHead>
              <TableHead>Auction Date</TableHead>
              <TableHead>Loan Amount</TableHead>
              <TableHead>Property</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preforeclosures.slice(0, 25).map((p) => (
              <TableRow key={p.id}>
                <TableCell className="max-w-[200px] truncate">{p.defendant || "—"}</TableCell>
                <TableCell className="max-w-[200px] truncate">{p.plaintiff || p.lender || "—"}</TableCell>
                <TableCell>{p.auctionDate || "—"}</TableCell>
                <TableCell>{money(p.loanAmount)}</TableCell>
                <TableCell className="max-w-[260px] truncate">{p.property || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Lender Distress Overlay</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lender</TableHead>
                <TableHead>Preforeclosures (30d)</TableHead>
                <TableHead>Preforeclosures (90d)</TableHead>
                <TableHead>Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lenderRows.slice(0, 15).map((l) => (
                <TableRow key={l.lender}>
                  <TableCell>{l.lender}</TableCell>
                  <TableCell>{l.c30}</TableCell>
                  <TableCell>{l.c90}</TableCell>
                  <TableCell className={l.trend === "up" ? "text-rose-700" : l.trend === "down" ? "text-emerald-700" : ""}>{l.trend}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Linked Distress Alerts</h4>
          <div className="space-y-2">
            {alerts.filter((a) => a.type.includes("preforeclosure") || a.type === "repeat_lender" || a.type === "repeat_borrower").length === 0 ? (
              <p className="text-sm text-slate-600">No active legal/credit alerts.</p>
            ) : (
              alerts
                .filter((a) => a.type.includes("preforeclosure") || a.type === "repeat_lender" || a.type === "repeat_borrower")
                .map((a, i) => (
                  <div key={`${a.type}-${i}`} className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {a.message}
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

