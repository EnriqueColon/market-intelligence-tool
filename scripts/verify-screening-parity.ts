/**
 * Proves the server-side screening reduction produces the same numbers the
 * browser produced, before the tab is switched over to it.
 *
 * The old path is reimplemented here from `components/market-analytics.tsx` as
 * it stood, deliberately duplicated rather than imported: importing the new
 * module for both sides would prove nothing. Every rendered field is compared
 * per institution, and any drift fails the process.
 *
 *   npm run verify:screening-parity            # national
 *   STATE=Florida npm run verify:screening-parity
 */
import { computeCapitalRatios } from "../lib/fdic-ratio-helpers"
import { transformFinancialData, type BankFinancialData } from "../lib/fdic-data-transformer"
import { FDIC_FIELDS, FDIC_ENDPOINTS, FDIC_CONFIG } from "../lib/fdic-config"
import {
  computeOpportunityDistributions,
  computeOpportunityScore,
} from "../lib/scoring/opportunity-score"
import { computeEarningsRanges, computeEarningsScore } from "../lib/scoring/earnings-score"
import { computeVulnerabilityScore } from "../lib/scoring/vulnerability-score"
import { buildScreeningPayload } from "../lib/analytics/screening"

const STATE = process.env.STATE
const LIMIT = 10000

function normalizeReportDate(dateStr: string | undefined): string {
  if (!dateStr) return ""
  if (/^\d{8}$/.test(dateStr)) return dateStr
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[1] + m[2] + m[3]
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
}

async function fetchLive(): Promise<BankFinancialData[]> {
  const d = new Date()
  d.setMonth(d.getMonth() - 27)
  const filters: string[] = [`REPDTE:[${d.toISOString().slice(0, 7)}-01 TO *]`]
  if (STATE) filters.push(`STNAME:"${STATE.toUpperCase()}"`)

  const params = new URLSearchParams({
    format: "json",
    limit: String(LIMIT),
    filters: filters.join(" AND "),
    fields: FDIC_FIELDS.financials.join(","),
    sort_by: "ASSET",
    sort_order: "DESC",
  })
  const res = await fetch(`${FDIC_CONFIG.baseUrl}${FDIC_ENDPOINTS.financials}?${params}`)
  if (!res.ok) throw new Error(`FDIC ${res.status}`)
  const json = await res.json()
  return transformFinancialData(json.data.map((r: any) => r?.data ?? r))
}

/** The reduction exactly as the browser did it, before this change. */
function legacyScreeningTable(financials: BankFinancialData[]) {
  const regionFinancials = STATE
    ? financials.filter((i) => i.state && i.state.toUpperCase() === STATE.toUpperCase())
    : financials

  const lastQuarterDates = Array.from(
    new Set(regionFinancials.map((i) => i.reportDate).filter(Boolean))
  )
    .sort((a, b) => normalizeReportDate(b).localeCompare(normalizeReportDate(a)))
    .slice(0, 8)
  const lastQuarterDatesDisplay = lastQuarterDates.slice(0, 4)

  const filtered = regionFinancials.filter((item) => {
    if (lastQuarterDates.length > 0 && item.reportDate && !lastQuarterDates.includes(item.reportDate)) return false
    return true
  })

  const grouped = new Map<string, BankFinancialData[]>()
  filtered.forEach((item) => {
    if (!grouped.has(item.id)) grouped.set(item.id, [])
    grouped.get(item.id)!.push(item)
  })

  const mostRecentNorm = normalizeReportDate(lastQuarterDates[0])
  const rows: any[] = []
  grouped.forEach((items) => {
    const sorted = [...items].sort((a, b) =>
      normalizeReportDate(b.reportDate).localeCompare(normalizeReportDate(a.reportDate))
    )
    const byDateNorm = new Map(sorted.map((e) => [normalizeReportDate(e.reportDate), e]))
    const latest = mostRecentNorm && byDateNorm.has(mostRecentNorm) ? byDateNorm.get(mostRecentNorm)! : sorted[0]
    if (mostRecentNorm && !byDateNorm.has(mostRecentNorm)) return

    const trend = lastQuarterDatesDisplay.filter(Boolean).map((date) => {
      const entry = byDateNorm.get(normalizeReportDate(date))
      return { reportDate: date, creConcentration: entry?.creConcentration, nplRatio: entry?.nplRatio }
    })
    const capitalRatios = computeCapitalRatios({
      totalAssets: latest.totalAssets,
      creLoans: latest.creLoans ?? 0,
      constructionLoans: latest.constructionLoans ?? 0,
      multifamilyLoans: latest.multifamilyLoans ?? 0,
      leverageRatio: latest.leverageRatio,
      tier1RbcRatio: latest.tier1RbcRatio,
      totalRbcRatio: latest.totalRbcRatio,
      cet1Ratio: latest.cet1Ratio,
      totalEquityDollars: latest.totalEquityDollars,
      tier1Dollars: latest.tier1Dollars,
      tier2Dollars: latest.tier2Dollars,
      riskWeightedAssets: latest.riskWeightedAssets,
    })

    const q3 = lastQuarterDates[3]
    const roaLatest = latest.roa != null ? latest.roa : null
    const roaDelta4Q =
      lastQuarterDates.length >= 4 && roaLatest != null && byDateNorm.get(normalizeReportDate(q3))?.roa != null
        ? roaLatest - (byDateNorm.get(normalizeReportDate(q3))!.roa ?? 0)
        : null
    const nimLatest = latest.netInterestMargin != null ? latest.netInterestMargin : null
    const nimDelta4Q =
      lastQuarterDates.length >= 4 &&
      nimLatest != null &&
      byDateNorm.get(normalizeReportDate(q3))?.netInterestMargin != null
        ? nimLatest - (byDateNorm.get(normalizeReportDate(q3))!.netInterestMargin ?? 0)
        : null

    const niCurrent4 = lastQuarterDates.slice(0, 4).map((d) => byDateNorm.get(normalizeReportDate(d))?.netIncome)
    const hasAll4 = niCurrent4.length === 4 && niCurrent4.every((v) => v != null && Number.isFinite(v))
    const netIncomeTTM = hasAll4 ? (niCurrent4.reduce((s, v) => s! + v!, 0) as number) : null
    const niPrior4 = lastQuarterDates.slice(4, 8).map((d) => byDateNorm.get(normalizeReportDate(d))?.netIncome)
    const hasAll8 = niPrior4.length === 4 && niPrior4.every((v) => v != null && Number.isFinite(v))
    const netIncomeTTMPrior = hasAll8 ? (niPrior4.reduce((s, v) => s! + v!, 0) as number) : null
    const netIncomeYoYPct =
      netIncomeTTM != null && netIncomeTTMPrior != null && Math.abs(netIncomeTTMPrior) !== 0
        ? ((netIncomeTTM - netIncomeTTMPrior) / Math.abs(netIncomeTTMPrior)) * 100
        : null
    const creLoansLatest = latest.creLoans ?? 0
    const earningsBufferPct =
      netIncomeTTM != null && creLoansLatest > 0 ? (netIncomeTTM / creLoansLatest) * 100 : null

    rows.push({
      ...latest,
      trend,
      capitalRatios,
      roaLatest: roaLatest ?? undefined,
      roaDelta4Q: roaDelta4Q ?? undefined,
      netIncomeTTM: netIncomeTTM ?? undefined,
      netIncomeYoYPct: netIncomeYoYPct ?? undefined,
      nimLatest: nimLatest ?? undefined,
      nimDelta4Q: nimDelta4Q ?? undefined,
      earningsBufferPct: earningsBufferPct ?? undefined,
    })
  })

  const opportunityInputs = rows.map((r) => ({
    creConcentration: r.creConcentration,
    noncurrentToLoansRatio: r.noncurrent_to_loans_ratio,
    loanLossReserve: r.loanLossReserve,
    cet1Ratio: r.cet1Ratio,
    leverageRatio: r.leverageRatio,
  }))
  const distributions = computeOpportunityDistributions(opportunityInputs)
  const earningsInputs = rows.map((r) => ({
    earningsBufferPct: r.earningsBufferPct ?? null,
    roaLatest: r.roaLatest ?? null,
    roaDelta4Q: r.roaDelta4Q ?? null,
    netIncomeYoYPct: r.netIncomeYoYPct ?? null,
  }))
  const earningsRanges = computeEarningsRanges(earningsInputs)

  return rows.map((row, i) => {
    const opportunityScore = computeOpportunityScore(opportunityInputs[i], distributions)
    const earningsScore = computeEarningsScore(earningsInputs[i], earningsRanges)
    return {
      ...row,
      opportunityScore,
      earningsScore,
      vulnerabilityScore: computeVulnerabilityScore(opportunityScore, earningsScore),
    }
  })
}

// Fields the table or the drawer renders. Anything here that drifts is a
// user-visible regression.
const COMPARED = [
  "name", "city", "state", "reportDate", "totalAssets", "totalLoans", "creLoans",
  "creConcentration", "nonaccrualLoans", "nplRatio", "noncurrent_to_loans_ratio",
  "noncurrent_to_assets_ratio", "pastDue3090", "pastDue90Plus", "loanLossReserve",
  "loansToDeposits", "cet1Ratio", "leverageRatio", "totalUnusedCommitments",
  "creUnusedCommitments", "constructionLoans", "multifamilyLoans", "nonResidentialLoans",
  "ownerOccupiedLoans", "nonOwnerOccupiedLoans", "roaLatest", "roaDelta4Q", "netIncomeTTM",
  "netIncomeYoYPct", "nimLatest", "nimDelta4Q", "earningsBufferPct",
  "opportunityScore", "earningsScore", "vulnerabilityScore",
] as const

const RATIOS = [
  "creToTier1Tier2", "creToEquity", "constructionToTier1Tier2", "multifamilyToTier1Tier2",
] as const

/** Rounded to six significant figures on the way out, so compare at that. */
const same = (a: unknown, b: unknown) => {
  const an = a == null ? null : a
  const bn = b == null ? null : b
  if (an === null && bn === null) return true
  if (typeof an === "number" && typeof bn === "number") {
    if (!Number.isFinite(an) || !Number.isFinite(bn)) return an === bn
    return Number(an.toPrecision(6)) === Number(bn.toPrecision(6))
  }
  return an === bn
}

async function main() {
  const financials = await fetchLive()
  console.log(`scope: ${STATE ?? "National"} — ${financials.length} raw rows`)

  const legacy = legacyScreeningTable(financials)
  const next = buildScreeningPayload(financials, STATE)

  let failures = 0
  const fail = (msg: string) => {
    if (failures < 15) console.log(`  MISMATCH ${msg}`)
    failures++
  }

  if (legacy.length !== next.rows.length) {
    fail(`row count: legacy ${legacy.length} vs new ${next.rows.length}`)
  }

  const nextById = new Map(next.rows.map((r) => [r.id, r]))
  for (const old of legacy) {
    const now = nextById.get(old.id)
    if (!now) {
      fail(`institution ${old.id} (${old.name}) missing from new payload`)
      continue
    }
    for (const key of COMPARED) {
      if (!same((old as any)[key], (now as any)[key])) {
        fail(`${old.name} [${old.id}] ${key}: ${(old as any)[key]} -> ${(now as any)[key]}`)
      }
    }
    for (const key of RATIOS) {
      if (!same(old.capitalRatios?.[key], now.capitalRatios?.[key])) {
        fail(`${old.name} [${old.id}] capitalRatios.${key}: ${old.capitalRatios?.[key]} -> ${now.capitalRatios?.[key]}`)
      }
    }
    const oldTrend = old.trend ?? []
    const newTrend = now.trend ?? []
    if (oldTrend.length !== newTrend.length) {
      fail(`${old.name} trend length ${oldTrend.length} -> ${newTrend.length}`)
    } else {
      for (let i = 0; i < oldTrend.length; i++) {
        for (const key of ["reportDate", "creConcentration", "nplRatio"] as const) {
          if (!same((oldTrend[i] as any)[key], (newTrend[i] as any)[key])) {
            fail(`${old.name} trend[${i}].${key}: ${(oldTrend[i] as any)[key]} -> ${(newTrend[i] as any)[key]}`)
          }
        }
      }
    }
  }

  const compared = legacy.length * (COMPARED.length + RATIOS.length + 12)
  console.log(`institutions: ${legacy.length}`)
  console.log(`comparisons : ~${compared.toLocaleString()}`)
  console.log(`kpis        : screened=${next.kpis.institutionsScreened} avgNpl=${next.kpis.avgNplRatio.toFixed(6)} avgCre=${next.kpis.avgCreConcentration.toFixed(4)}`)
  console.log(`payload     : ${(Buffer.byteLength(JSON.stringify(next)) / 1048576).toFixed(2)} MB`)

  if (failures > 0) {
    console.log(`\nFAIL: ${failures} mismatch(es)`)
    process.exit(1)
  }
  console.log("\nPASS: server reduction matches the previous browser reduction on every rendered field")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
