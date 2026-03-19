"use client"

import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ExecutiveAlert, FlowWindowStats } from "@/lib/participants-intel/types"
import { detectNewEntrants, detectTopMovers } from "@/lib/participants-intel/aggregation"

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0)
}

function moneyOrUnknown(n: number, coveragePct: number) {
  if (coveragePct <= 0) return "Unknown"
  return money(n)
}

type Props = {
  rolling: FlowWindowStats[]
  alerts: ExecutiveAlert[]
}

export function SectionExecutiveSnapshot({ rolling, alerts }: Props) {
  const movers = detectTopMovers(rolling)
    .filter((r) => r.valueCoveragePct30d > 0 || r.commerciallyRelevantAssignments30d > 0)
    .slice(0, 10)
  const entrants = detectNewEntrants(rolling).slice(0, 10)
  const inboundLeaders = [...rolling].sort((a, b) => b.inbound30d - a.inbound30d).slice(0, 5)
  const outboundLeaders = [...rolling].sort((a, b) => b.outbound30d - a.outbound30d).slice(0, 5)
  const netBuyers = [...rolling].sort((a, b) => b.net30d - a.net30d).slice(0, 5)

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <h3 className="text-base font-semibold text-slate-800">2) Executive Snapshot</h3>
      <p className="text-xs text-slate-600 mt-1">Leadership summary emphasizing high-value movers, institutional entrants, and distress-linked signals.</p>

      <div className="mt-4 grid gap-6 xl:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">High-Value Movers (30d)</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Firm</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>30d Assignments</TableHead>
                <TableHead>% Change vs Prior 30d</TableHead>
                <TableHead>Value Coverage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movers.map((m) => (
                <TableRow key={m.firm}>
                  <TableCell>{m.firm}</TableCell>
                  <TableCell className="text-[11px] uppercase">{m.participantType.replaceAll("_", " ")}</TableCell>
                  <TableCell>{m.assignments30d}</TableCell>
                  <TableCell>{m.pctChange30dVsPrior30d.toFixed(1)}%</TableCell>
                  <TableCell>{m.valueCoveragePct30d.toFixed(0)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">New Institutional Entrants</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Firm</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>30d Assignments</TableHead>
                <TableHead>90d Assignments</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entrants.map((e) => (
                <TableRow key={e.firm}>
                  <TableCell>{e.firm}</TableCell>
                  <TableCell className="text-[11px] uppercase">{e.participantType.replaceAll("_", " ")}</TableCell>
                  <TableCell>{e.assignments30d}</TableCell>
                  <TableCell>{e.assignments90d}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Inbound Leaders</h4>
          <ul className="space-y-1 text-sm text-slate-700">
            {inboundLeaders.map((x) => <li key={x.firm}>{x.firm}: {moneyOrUnknown(x.inbound30d, x.valueCoveragePct30d)}</li>)}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Outbound Leaders</h4>
          <ul className="space-y-1 text-sm text-slate-700">
            {outboundLeaders.map((x) => <li key={x.firm}>{x.firm}: {moneyOrUnknown(x.outbound30d, x.valueCoveragePct30d)}</li>)}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Net Buyers</h4>
          <ul className="space-y-1 text-sm text-slate-700">
            {netBuyers.map((x) => <li key={x.firm}>{x.firm}: {moneyOrUnknown(x.net30d, x.valueCoveragePct30d)}</li>)}
          </ul>
        </div>
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-semibold text-slate-800 mb-2">Signals & Alerts</h4>
        <div className="space-y-2">
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-600">No active alerts.</p>
          ) : alerts.map((a, i) => (
            <div
              key={`${a.type}-${i}`}
              className={`rounded border px-3 py-2 text-sm ${
                a.severity === "high"
                  ? "border-rose-300 bg-rose-50 text-rose-800"
                  : a.severity === "medium"
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              <span className="font-semibold uppercase text-[11px] mr-2">{a.label || a.type.replaceAll("_", " ")}</span>
              {a.message}
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

