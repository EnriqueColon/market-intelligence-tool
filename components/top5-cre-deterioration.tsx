"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DefTerm } from "@/components/def-term"
import { fetchTop5CREDeterioration, type CREDeteriorationRow } from "@/app/actions/cre-deterioration"
import { formatMoney, formatMultiple, formatDeltaPercentPoints } from "@/lib/format/metrics"

function formatCreCap(value: number): string {
  return formatMultiple(value)
}

function formatTwoYearDelta(value: number): string {
  const sign = value >= 0 ? "+" : ""
  return sign + value.toFixed(2) + "x"
}

export function Top5CREDeterioration() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{
    rows: CREDeteriorationRow[]
    summary: { avgTwoYearCreChange: number; pctBanksRisingNonaccrual: number; institutionsEvaluated: number }
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    fetchTop5CREDeterioration()
      .then((res) => {
        if (!mounted) return
        if (res.error) {
          setError(res.error)
          setData(null)
        } else {
          setData({ rows: res.rows, summary: res.summary })
          setError(null)
        }
      })
      .catch((err) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Failed to load")
        setData(null)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  if (loading) {
    return (
      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <h3 className="text-base font-semibold text-slate-800 mb-1">
          Top 5 CRE + Credit Deterioration (National | 2023–2025)
        </h3>
        <p className="text-sm text-slate-600 mt-4">Loading FDIC data…</p>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <h3 className="text-base font-semibold text-slate-800 mb-1">
          Top 5 CRE + Credit Deterioration (National | 2023–2025)
        </h3>
        <p className="text-sm text-destructive mt-4">{error}</p>
      </Card>
    )
  }

  if (!data || data.rows.length === 0) {
    return (
      <Card className="p-6 border-slate-200/80 bg-slate-50/30">
        <h3 className="text-base font-semibold text-slate-800 mb-1">
          Top 5 CRE + Credit Deterioration (National | 2023–2025)
        </h3>
        <p className="text-sm text-slate-600 mt-4">No institutions with complete 2023–2025 data.</p>
      </Card>
    )
  }

  const { rows, summary } = data

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">
          Top 5 CRE + Credit Deterioration (National | 2023–2025)
        </h3>
        <p className="text-xs text-slate-600 mb-4">
          All institutions nationwide with complete 2023, 2024, 2025 data.
        </p>

        {/* Optional summary row */}
        <div className="mb-4 grid gap-3 grid-cols-1 sm:grid-cols-3">
          <Card className="p-3 bg-white border-slate-200">
            <p className="text-xs font-medium text-slate-600">
              <DefTerm term="Avg 2-Year Δ CRE/Cap">Avg 2-Year Δ CRE/Cap</DefTerm>
            </p>
            <p className="text-lg font-semibold text-slate-800">
              {formatTwoYearDelta(summary.avgTwoYearCreChange)}
            </p>
          </Card>
          <Card className="p-3 bg-white border-slate-200">
            <p className="text-xs font-medium text-slate-600">
              <DefTerm term="% Banks Rising Nonaccrual">% Banks Rising Nonaccrual</DefTerm>
            </p>
            <p className="text-lg font-semibold text-slate-800">
              {summary.pctBanksRisingNonaccrual.toFixed(1)}%
            </p>
          </Card>
          <Card className="p-3 bg-white border-slate-200">
            <p className="text-xs font-medium text-slate-600">
              <DefTerm term="Institutions Evaluated">Institutions Evaluated</DefTerm>
            </p>
            <p className="text-lg font-semibold text-slate-800">
              {summary.institutionsEvaluated.toLocaleString()}
            </p>
          </Card>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><DefTerm term="Rank">Rank</DefTerm></TableHead>
              <TableHead><DefTerm term="Bank Name">Bank Name</DefTerm></TableHead>
              <TableHead><DefTerm term="State">State</DefTerm></TableHead>
              <TableHead><DefTerm term="Total Assets">Total Assets</DefTerm></TableHead>
              <TableHead><DefTerm term="CRE/Cap 2023">CRE/Cap 2023</DefTerm></TableHead>
              <TableHead><DefTerm term="CRE/Cap 2024">CRE/Cap 2024</DefTerm></TableHead>
              <TableHead><DefTerm term="CRE/Cap 2025">CRE/Cap 2025</DefTerm></TableHead>
              <TableHead><DefTerm term="Nonaccrual % 2023">Nonaccrual % 2023</DefTerm></TableHead>
              <TableHead><DefTerm term="Nonaccrual % 2025">Nonaccrual % 2025</DefTerm></TableHead>
              <TableHead><DefTerm term="Δ Nonaccrual">Δ Nonaccrual</DefTerm></TableHead>
              <TableHead><DefTerm term="2-Year Δ CRE/Cap">2-Year Δ CRE/Cap</DefTerm></TableHead>
              <TableHead><DefTerm term="Risk Signal">Risk Signal</DefTerm></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.bankName}-${row.state}-${row.rank}`}>
                <TableCell className="font-medium">{row.rank}</TableCell>
                <TableCell>{row.bankName}</TableCell>
                <TableCell>{row.state}</TableCell>
                <TableCell>{formatMoney(row.totalAssets)}</TableCell>
                <TableCell>{formatCreCap(row.creCap23)}</TableCell>
                <TableCell>{formatCreCap(row.creCap24)}</TableCell>
                <TableCell>{formatCreCap(row.creCap25)}</TableCell>
                <TableCell>{row.nonaccrualPct23.toFixed(2)}%</TableCell>
                <TableCell>{row.nonaccrualPct25.toFixed(2)}%</TableCell>
                <TableCell>{formatDeltaPercentPoints(row.deltaNonaccrual, 2)}</TableCell>
                <TableCell>{formatTwoYearDelta(row.twoYearDeltaCreCap)}</TableCell>
                <TableCell>
                  <span
                    className={
                      row.riskSignal === "Exposure + Credit Deteriorating"
                        ? "text-destructive font-medium"
                        : row.riskSignal === "Exposure Rising" || row.riskSignal === "Credit Deteriorating"
                          ? "text-amber-600"
                          : "text-slate-600"
                    }
                  >
                    {row.riskSignal}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <p className="mt-4 text-xs text-slate-500">
          Ranking based on combined exposure growth and CRE asset quality deterioration, computed across
          all institutions nationwide.
        </p>
      </div>
    </Card>
  )
}
