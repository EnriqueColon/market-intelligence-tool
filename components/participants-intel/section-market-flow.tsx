"use client"

import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts"
import type { FlowWindowStats, MonthlyFlowPoint, PairAggregate } from "@/lib/participants-intel/types"

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0)
}

type Props = {
  rolling: FlowWindowStats[]
  topPairs: PairAggregate[]
  monthly: MonthlyFlowPoint[]
  onSelectFirm: (name: string) => void
}

export function SectionMarketFlow({ rolling, topPairs, monthly, onSelectFirm }: Props) {
  const sorted = [...rolling].sort((a, b) => b.net30d - a.net30d)
  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <h3 className="text-base font-semibold text-slate-800">1) Market Participants & Activity (AOM Flow)</h3>
      <p className="text-xs text-slate-600 mt-1">Dynamic rollups from assignment-level flow edges (normalized assignor/assignee).</p>

      <div className="mt-4">
        <h4 className="text-sm font-semibold text-slate-800 mb-2">Core Table (Firm Rollup)</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Firm Name</TableHead>
              <TableHead>Inbound Volume (30d)</TableHead>
              <TableHead>Outbound Volume (30d)</TableHead>
              <TableHead>Net Flow</TableHead>
              <TableHead># Assignments (30d)</TableHead>
              <TableHead># Assignments (90d)</TableHead>
              <TableHead>% Change (30d vs prior 30d)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.slice(0, 25).map((r) => (
              <TableRow key={r.firm} className="cursor-pointer" onClick={() => onSelectFirm(r.firm)}>
                <TableCell className="font-medium">{r.firm}</TableCell>
                <TableCell>{money(r.inbound30d)}</TableCell>
                <TableCell>{money(r.outbound30d)}</TableCell>
                <TableCell className={r.net30d >= 0 ? "text-emerald-700" : "text-rose-700"}>{money(r.net30d)}</TableCell>
                <TableCell>{r.assignments30d}</TableCell>
                <TableCell>{r.assignments90d}</TableCell>
                <TableCell>{r.pctChange30dVsPrior30d.toFixed(1)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Top Assignor → Assignee Pairs</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assignor</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Total Volume</TableHead>
                <TableHead># Transactions</TableHead>
                <TableHead>Last Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topPairs.slice(0, 10).map((p) => (
                <TableRow key={`${p.assignor}-${p.assignee}`}>
                  <TableCell className="max-w-[180px] truncate">{p.assignor}</TableCell>
                  <TableCell className="max-w-[180px] truncate">{p.assignee}</TableCell>
                  <TableCell>{money(p.totalVolume)}</TableCell>
                  <TableCell>{p.transactions}</TableCell>
                  <TableCell>{p.lastActivityDate || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Monthly Trend Chart</h4>
          <div className="h-[300px] rounded border border-slate-200 bg-white p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v: number) => money(v)} />
                <Legend />
                <Bar dataKey="inbound" fill="#0ea5e9" name="Inbound" />
                <Bar dataKey="outbound" fill="#f59e0b" name="Outbound" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Card>
  )
}

