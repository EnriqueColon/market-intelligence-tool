"use client"

import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { FlowEdge, FlowWindowStats, MortgageRecord, PreforeclosureRecord } from "@/lib/participants-intel/types"

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0)
}

function moneyOrUnknown(amount: number | null, known: boolean) {
  if (!known || amount == null) return "Unknown"
  return money(amount)
}

function buildCounterparties(edges: FlowEdge[], selectedFirm: string) {
  const inbound = new Map<string, { volume: number; deals: number }>()
  const outbound = new Map<string, { volume: number; deals: number }>()
  for (const e of edges) {
    if (e.to_party === selectedFirm) {
      const curr = inbound.get(e.from_party) || { volume: 0, deals: 0 }
      curr.volume += e.amount
      curr.deals += 1
      inbound.set(e.from_party, curr)
    }
    if (e.from_party === selectedFirm) {
      const curr = outbound.get(e.to_party) || { volume: 0, deals: 0 }
      curr.volume += e.amount
      curr.deals += 1
      outbound.set(e.to_party, curr)
    }
  }
  return {
    inbound: Array.from(inbound.entries())
      .map(([counterparty, v]) => ({ counterparty, ...v }))
      .sort((a, b) => b.volume - a.volume),
    outbound: Array.from(outbound.entries())
      .map(([counterparty, v]) => ({ counterparty, ...v }))
      .sort((a, b) => b.volume - a.volume),
  }
}

type Props = {
  selectedFirm: string
  rolling: FlowWindowStats[]
  edges: FlowEdge[]
  mortgages: MortgageRecord[]
  preforeclosures: PreforeclosureRecord[]
}

export function SectionFirmDrilldown({ selectedFirm, rolling, edges, mortgages, preforeclosures }: Props) {
  if (!selectedFirm) {
    return (
      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <h3 className="text-base font-semibold text-slate-800">3) Firm Drilldown</h3>
        <p className="text-sm text-slate-600 mt-2">Select a firm from the Market Flow table to load full drilldown.</p>
      </Card>
    )
  }

  const row = rolling.find((r) => r.firm === selectedFirm)
  const cp = buildCounterparties(edges, selectedFirm)
  const totalInbound90 = rolling.reduce((s, r) => s + r.inbound90d, 0)
  const marketShare = row && totalInbound90 > 0 ? (row.inbound90d / totalInbound90) * 100 : 0
  const recent = edges
    .filter((e) => e.from_party === selectedFirm || e.to_party === selectedFirm)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 25)
  const linkedMortgageCount = mortgages.filter(
    (m) => m.lender.toLowerCase().includes(selectedFirm.toLowerCase()) || m.borrower.toLowerCase().includes(selectedFirm.toLowerCase())
  ).length
  const linkedPreforeclosureCount = preforeclosures.filter(
    (p) =>
      p.plaintiff.toLowerCase().includes(selectedFirm.toLowerCase()) ||
      p.defendant.toLowerCase().includes(selectedFirm.toLowerCase()) ||
      (p.lender || "").toLowerCase().includes(selectedFirm.toLowerCase())
  ).length
  const geographicCounts = new Map<string, number>()
  const propertyTypes = new Map<string, number>()
  for (const e of recent) {
    if (e.geography) geographicCounts.set(e.geography, (geographicCounts.get(e.geography) || 0) + 1)
    if (e.propertyType) propertyTypes.set(e.propertyType, (propertyTypes.get(e.propertyType) || 0) + 1)
  }
  const topGeos = Array.from(geographicCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const topTypes = Array.from(propertyTypes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <h3 className="text-base font-semibold text-slate-800">3) Firm Drilldown — {selectedFirm}</h3>
      <p className="text-xs text-slate-600 mt-1">
        Type: {row?.participantType.replaceAll("_", " ") || "unknown"} • Role: {row?.inferredRole || "unknown"} • First seen: {row?.firstSeenDate || "—"} • Last seen: {row?.lastSeenDate || "—"}
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded border border-slate-200 bg-white p-3 text-sm">Inbound 30d: <strong>{row && row.valueCoveragePct30d > 0 ? money(row.inbound30d) : "Unknown"}</strong></div>
        <div className="rounded border border-slate-200 bg-white p-3 text-sm">Outbound 30d: <strong>{row && row.valueCoveragePct30d > 0 ? money(row.outbound30d) : "Unknown"}</strong></div>
        <div className="rounded border border-slate-200 bg-white p-3 text-sm">Net Position (30d): <strong>{row && row.valueCoveragePct30d > 0 ? money(row.net30d) : "Unknown"}</strong></div>
        <div className="rounded border border-slate-200 bg-white p-3 text-sm">Total Txns (90d): <strong>{row?.assignments90d || 0}</strong></div>
        <div className="rounded border border-slate-200 bg-white p-3 text-sm">Market Share (Inbound 90d): <strong>{marketShare.toFixed(1)}%</strong></div>
        <div className="rounded border border-slate-200 bg-white p-3 text-sm">Value Coverage (30d): <strong>{row?.valueCoveragePct30d.toFixed(1) || "0.0"}%</strong></div>
        <div className="rounded border border-slate-200 bg-white p-3 text-sm">Linked Mortgages: <strong>{linkedMortgageCount}</strong></div>
        <div className="rounded border border-slate-200 bg-white p-3 text-sm">Linked Preforeclosures: <strong>{linkedPreforeclosureCount}</strong></div>
        <div className="rounded border border-slate-200 bg-white p-3 text-sm">Top Geography: <strong>{topGeos.map(([g]) => g).join(", ") || "—"}</strong></div>
        <div className="rounded border border-slate-200 bg-white p-3 text-sm">Property Mix: <strong>{topTypes.map(([t]) => t).join(", ") || "—"}</strong></div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Inbound Counterparties (Assignor)</h4>
          <Table>
            <TableHeader><TableRow><TableHead>Counterparty</TableHead><TableHead>Volume</TableHead><TableHead># Deals</TableHead></TableRow></TableHeader>
            <TableBody>
              {cp.inbound.slice(0, 15).map((r) => (
                <TableRow key={r.counterparty}><TableCell>{r.counterparty}</TableCell><TableCell>{money(r.volume)}</TableCell><TableCell>{r.deals}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Outbound Counterparties (Assignee)</h4>
          <Table>
            <TableHeader><TableRow><TableHead>Counterparty</TableHead><TableHead>Volume</TableHead><TableHead># Deals</TableHead></TableRow></TableHeader>
            <TableBody>
              {cp.outbound.slice(0, 15).map((r) => (
                <TableRow key={r.counterparty}><TableCell>{r.counterparty}</TableCell><TableCell>{money(r.volume)}</TableCell><TableCell>{r.deals}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-semibold text-slate-800 mb-2">Relationship Graph (Simple)</h4>
        <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-700">
          <div className="font-semibold mb-1">{selectedFirm}</div>
          <div className="grid gap-1 md:grid-cols-2">
            <div>Inbound nodes: {cp.inbound.slice(0, 8).map((x) => x.counterparty).join(", ") || "—"}</div>
            <div>Outbound nodes: {cp.outbound.slice(0, 8).map((x) => x.counterparty).join(", ") || "—"}</div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-semibold text-slate-800 mb-2">Recent Transactions</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Assignor</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead>Loan Amount</TableHead>
              <TableHead>Property</TableHead>
                <TableHead>Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((e, idx) => (
              <TableRow key={`${e.date}-${idx}`}>
                <TableCell>{e.date}</TableCell>
                <TableCell className="max-w-[220px] truncate">{e.rawAssignor}</TableCell>
                <TableCell className="max-w-[220px] truncate">{e.rawAssignee}</TableCell>
                <TableCell>{moneyOrUnknown(e.amount, e.amountKnown)}</TableCell>
                <TableCell className="max-w-[260px] truncate">{e.property || "—"}</TableCell>
                <TableCell className="text-xs uppercase">{e.propertyType || "unknown"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}

