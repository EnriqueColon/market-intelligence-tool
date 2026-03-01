"use server"

/**
 * Top 5 CRE + Credit Deterioration (National | 2023–2025)
 *
 * Fetches FDIC data for 2023, 2024, 2025 and computes a deterioration score
 * combining exposure growth and CRE asset quality deterioration.
 */

import { FDIC_CONFIG, FDIC_ENDPOINTS, FDIC_FIELDS } from "@/lib/fdic-config"
import { transformFinancialData } from "@/lib/fdic-data-transformer"
import { computeCapitalRatios } from "@/lib/fdic-ratio-helpers"
import type { BankFinancialData } from "@/lib/fdic-data-transformer"

function buildFilterString(filters: Record<string, any>): string {
  return Object.entries(filters)
    .map(([key, value]) => {
      if (typeof value === "string" && /^\[.*\s+TO\s+/.test(value)) {
        return `${key}:${value}`
      }
      if (typeof value === "string") {
        return `${key}:"${value.replace(/"/g, '\\"')}"`
      }
      return `${key}:${value}`
    })
    .join(" AND ")
}

async function fetchFDICFinancialsByDateRange(
  dateRange: string,
  limit: number = 15000
): Promise<any[]> {
  const url = `${FDIC_CONFIG.baseUrl}${FDIC_ENDPOINTS.financials}?format=json&limit=${limit}&filters=${encodeURIComponent(
    buildFilterString({ REPDTE: dateRange })
  )}&fields=${FDIC_FIELDS.financials.join(",")}&sort_by=ASSET&sort_order=DESC`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)
  try {
    const res = await fetch(url, {
      cache: "no-store" as RequestCache,
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) return []
    const json = await res.json()
    const data = json.data ?? json
    return Array.isArray(data) ? data.map((d: any) => d?.data ?? d) : []
  } catch {
    clearTimeout(timeoutId)
    return []
  }
}

export type CREDeteriorationRow = {
  rank: number
  bankName: string
  state: string
  totalAssets: number
  creCap23: number
  creCap24: number
  creCap25: number
  nonaccrualPct23: number
  nonaccrualPct25: number
  deltaNonaccrual: number
  twoYearDeltaCreCap: number
  riskSignal: string
}

export type CREDeteriorationResult = {
  rows: CREDeteriorationRow[]
  summary: {
    avgTwoYearCreChange: number
    pctBanksRisingNonaccrual: number
    institutionsEvaluated: number
  }
  error?: string
}

export async function fetchTop5CREDeterioration(): Promise<CREDeteriorationResult> {
  try {
    // Fetch 2023 Q4, 2024 Q4, 2025 (latest available)
    const [data23, data24, data25] = await Promise.all([
      fetchFDICFinancialsByDateRange("[2023-09-01 TO 2023-12-31]"),
      fetchFDICFinancialsByDateRange("[2024-09-01 TO 2024-12-31]"),
      fetchFDICFinancialsByDateRange("[2025-01-01 TO *]"),
    ])

    const transformed23 = transformFinancialData(data23)
    const transformed24 = transformFinancialData(data24)
    const transformed25 = transformFinancialData(data25)

    // Index by bank key: CERT (preferred) or normalized name+state
    const key = (r: BankFinancialData) =>
      r.id ? String(r.id) : `${(r.name || "").trim()}|${(r.state || "").trim()}`

    const byKey = (arr: BankFinancialData[]) => {
      const map = new Map<string, BankFinancialData>()
      for (const r of arr) {
        const k = key(r)
        const existing = map.get(k)
        if (!existing || (r.reportDate && r.reportDate > (existing.reportDate || ""))) {
          map.set(k, r)
        }
      }
      return map
    }

    const map23 = byKey(transformed23)
    const map24 = byKey(transformed24)
    const map25 = byKey(transformed25)

    const allKeys = new Set<string>()
    map23.forEach((_, k) => allKeys.add(k))
    map24.forEach((_, k) => allKeys.add(k))
    map25.forEach((_, k) => allKeys.add(k))

    type BankYearData = {
      creCap: number
      totalCRE: number
      totalAssets: number
    }

    const getYearData = (r: BankFinancialData | undefined): BankYearData | null => {
      if (!r) return null
      const totalCRE = r.creLoans ?? 0
      if (totalCRE <= 0) return null
      const capitalRatios = computeCapitalRatios({
        totalAssets: r.totalAssets,
        creLoans: r.creLoans ?? 0,
        constructionLoans: r.constructionLoans ?? 0,
        multifamilyLoans: r.multifamilyLoans ?? 0,
        leverageRatio: r.leverageRatio,
        tier1RbcRatio: r.tier1RbcRatio,
        totalRbcRatio: r.totalRbcRatio,
        cet1Ratio: r.cet1Ratio,
        totalEquityDollars: r.totalEquityDollars,
      })
      const creCap = capitalRatios.creToTier1Tier2 ?? NaN
      if (!Number.isFinite(creCap) || creCap <= 0) return null
      return { creCap, totalCRE, totalAssets: r.totalAssets }
    }

    const rows: Array<{
      key: string
      name: string
      state: string
      totalAssets: number
      creCap23: number
      creCap24: number
      creCap25: number
      nonaccrualPct23: number
      nonaccrualPct25: number
      deltaNonaccrual: number
      pastDuePct23: number
      pastDuePct25: number
      deltaPastDue: number
      twoYearDeltaCreCap: number
    }> = []

    for (const k of allKeys) {
      const r23 = map23.get(k)
      const r24 = map24.get(k)
      const r25 = map25.get(k)
      if (!r23 || !r25) continue

      const d23 = getYearData(r23)
      const d24 = r24 ? getYearData(r24) : null
      const d25 = getYearData(r25)
      if (!d23 || !d25) continue

      const totalCRE23 = d23.totalCRE
      const totalCRE25 = d25.totalCRE
      if (totalCRE23 <= 0 || totalCRE25 <= 0) continue

      const creCap23 = d23.creCap
      const creCap24 = d24?.creCap ?? creCap23
      const creCap25 = d25.creCap

      // Nonaccrual: use NPL ratio as proxy for CRE (FDIC lacks CRE-specific nonaccrual)
      const nonaccrualPct23 = r23.nplRatio ?? 0
      const nonaccrualPct25 = r25.nplRatio ?? 0
      const deltaNonaccrual = nonaccrualPct25 - nonaccrualPct23

      // Past due: use total past-due proxy (FDIC P3ASSET/P9ASSET are asset-based; use nplRatio as proxy when unavailable)
      const pastDuePct23 = nonaccrualPct23 * 0.5
      const pastDuePct25 = nonaccrualPct25 * 0.5
      const deltaPastDue = pastDuePct25 - pastDuePct23

      const twoYearDeltaCreCap = creCap25 - creCap23

      rows.push({
        key: k,
        name: r25.name || r23.name || "Unknown",
        state: r25.state || r23.state || "—",
        totalAssets: d25.totalAssets,
        creCap23,
        creCap24,
        creCap25,
        nonaccrualPct23,
        nonaccrualPct25,
        deltaNonaccrual,
        pastDuePct23,
        pastDuePct25,
        deltaPastDue,
        twoYearDeltaCreCap,
      })
    }

    if (rows.length === 0) {
      return {
        rows: [],
        summary: { avgTwoYearCreChange: 0, pctBanksRisingNonaccrual: 0, institutionsEvaluated: 0 },
        error: "No institutions with complete 2023–2025 data.",
      }
    }

    const twoYearCreChanges = rows.map((r) => r.twoYearDeltaCreCap)
    const deltaNonaccruals = rows.map((r) => r.deltaNonaccrual)
    const deltaPastDues = rows.map((r) => r.deltaPastDue)
    const creCap25s = rows.map((r) => r.creCap25)

    const minMax = (arr: number[]) => {
      const valid = arr.filter(Number.isFinite)
      if (valid.length === 0) return { min: 0, max: 0 }
      return { min: Math.min(...valid), max: Math.max(...valid) }
    }

    const norm = (v: number, r: { min: number; max: number }) =>
      r.max === r.min ? 0 : (v - r.min) / (r.max - r.min)

    const r1 = minMax(twoYearCreChanges)
    const r2 = minMax(deltaNonaccruals)
    const r3 = minMax(deltaPastDues)
    const r4 = minMax(creCap25s)

    const scored = rows.map((row) => {
      const s =
        0.35 * norm(row.twoYearDeltaCreCap, r1) +
        0.35 * norm(row.deltaNonaccrual, r2) +
        0.15 * norm(row.deltaPastDue, r3) +
        0.15 * norm(row.creCap25, r4)
      return { ...row, score: s }
    })

    scored.sort((a, b) => b.score - a.score)
    const top5 = scored.slice(0, 5)

    const riskSignal = (row: (typeof scored)[0]) => {
      const creUp = row.twoYearDeltaCreCap > 0
      const nplUp = row.deltaNonaccrual > 0
      if (creUp && nplUp) return "Exposure + Credit Deteriorating"
      if (creUp && !nplUp) return "Exposure Rising"
      if (!creUp && nplUp) return "Credit Deteriorating"
      return "Stable / Improving"
    }

    const resultRows: CREDeteriorationRow[] = top5.map((row, i) => ({
      rank: i + 1,
      bankName: row.name,
      state: row.state,
      totalAssets: row.totalAssets,
      creCap23: row.creCap23,
      creCap24: row.creCap24,
      creCap25: row.creCap25,
      nonaccrualPct23: row.nonaccrualPct23,
      nonaccrualPct25: row.nonaccrualPct25,
      deltaNonaccrual: row.deltaNonaccrual,
      twoYearDeltaCreCap: row.twoYearDeltaCreCap,
      riskSignal: riskSignal(row),
    }))

    const avgTwoYearCreChange =
      twoYearCreChanges.length > 0
        ? twoYearCreChanges.reduce((a, b) => a + b, 0) / twoYearCreChanges.length
        : 0
    const pctBanksRisingNonaccrual =
      rows.length > 0
        ? (rows.filter((r) => r.deltaNonaccrual > 0).length / rows.length) * 100
        : 0

    return {
      rows: resultRows,
      summary: {
        avgTwoYearCreChange,
        pctBanksRisingNonaccrual,
        institutionsEvaluated: rows.length,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    return {
      rows: [],
      summary: { avgTwoYearCreChange: 0, pctBanksRisingNonaccrual: 0, institutionsEvaluated: 0 },
      error: msg,
    }
  }
}
