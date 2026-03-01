"use server"

import { transformFinancialData } from "@/lib/fdic-data-transformer"
import { FDIC_CONFIG, FDIC_ENDPOINTS, FDIC_FIELDS } from "@/lib/fdic-config"
import { computeStressScores, type MapMetric } from "@/lib/map-stress-utils"
import type { BankFinancialData } from "@/lib/fdic-data-transformer"

const FDIC_BASE = FDIC_CONFIG.baseUrl

/** Defensive parse: convert strings, commas, null to number. Reject NaN. */
function parseNum(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const cleaned = v.replace(/,/g, "").trim()
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Compute quantile from sorted array (0-indexed) */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(Math.floor(p * sorted.length), sorted.length - 1)
  return sorted[i]
}

/** Debug stats for a series of values */
function computeDebugStats(
  values: number[],
  metricName: string
): {
  metricName: string
  countTotal: number
  countValid: number
  min: number
  p10: number
  p50: number
  p90: number
  max: number
  suggestedDomain: [number, number]
} {
  const valid = values.filter((v) => Number.isFinite(v)) as number[]
  const sorted = [...valid].sort((a, b) => a - b)
  const countValid = valid.length
  const min = countValid ? sorted[0] : 0
  const max = countValid ? sorted[sorted.length - 1] : 0
  const p97 = quantile(sorted, 0.97)
  const upperBound = p97 === max ? max : p97
  return {
    metricName,
    countTotal: values.length,
    countValid,
    min,
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    max,
    suggestedDomain: [min, upperBound],
  }
}

function buildFilterString(filters: Record<string, string>): string {
  return Object.entries(filters)
    .map(([k, v]) => `${k}:"${String(v).replace(/"/g, '\\"')}"`)
    .join(" AND ")
}

async function fetchFDICFinancialsForQuarter(
  quarter: string,
  state?: string
): Promise<BankFinancialData[]> {
  const [year, q] = quarter.split("-")
  // FDIC uses quarter-end dates: Q1=03-31, Q2=06-30, Q3=09-30, Q4=12-31
  const day = q === "Q2" || q === "Q3" ? "30" : "31"
  const month = q === "Q1" ? "03" : q === "Q2" ? "06" : q === "Q3" ? "09" : "12"
  const repdte = `${year}-${month}-${day}`
  const filters: Record<string, string> = { REPDTE: repdte }
  if (state) filters.STNAME = state.toUpperCase()

  const params = new URLSearchParams({
    format: "json",
    limit: "5000",
    filters: buildFilterString(filters),
    fields: FDIC_FIELDS.financials.join(","),
    sort_by: "ASSET",
    sort_order: "DESC",
  })

  const res = await fetch(
    `${FDIC_BASE}${FDIC_ENDPOINTS.financials}?${params}`,
    { cache: "no-store" }
  )
  if (!res.ok) return []
  const json = await res.json()
  const data = (json.data || []).map((item: any) => item?.data ?? item)
  return transformFinancialData(data)
}

async function fetchLocations(state?: string, limit = 5000): Promise<
  Array<{
    CERT: string
    NAME: string
    STALP: string
    STNAME: string
    CITY: string
    CBSA_NO: string
    CBSA: string
    LATITUDE: number
    LONGITUDE: number
    MAINOFF: number
  }>
> {
  const filters: Record<string, string> = {}
  if (state) {
    const code =
      state.length === 2 ? state : STATE_NAME_TO_CODE[state] || state
    filters.STALP = code.toUpperCase()
  }

  const params = new URLSearchParams({
    format: "json",
    limit: String(limit),
    fields:
      "CERT,NAME,STALP,STNAME,CITY,CBSA_NO,CBSA,LATITUDE,LONGITUDE,MAINOFF",
    sort_by: "CERT",
    sort_order: "ASC",
  })
  if (Object.keys(filters).length > 0) {
    params.set("filters", buildFilterString(filters))
  }

  const res = await fetch(
    `${FDIC_BASE}${FDIC_ENDPOINTS.locations}?${params}`,
    { cache: "no-store" }
  )
  if (!res.ok) return []
  const json = await res.json()
  const data = (json.data || []).map((item: any) => item?.data ?? item)
  return data.filter(
    (d: any) =>
      d.LATITUDE != null &&
      d.LONGITUDE != null &&
      Number.isFinite(d.LATITUDE) &&
      Number.isFinite(d.LONGITUDE)
  )
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  "District of Columbia": "DC",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "Puerto Rico": "PR",
}

/** Normalize FDIC state (uppercase) to title case for GeoJSON matching */
function normalizeStateName(fdicState: string): string {
  const upper = fdicState?.trim().toUpperCase() || ""
  const key = Object.keys(STATE_NAME_TO_CODE).find(
    (k) => k.toUpperCase() === upper
  )
  return key ?? fdicState
}

function getAvailableQuarters(): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 0; i < 8; i++) {
    const d = new Date(now)
    d.setMonth(d.getMonth() - i * 3)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const q = m <= 3 ? "Q1" : m <= 6 ? "Q2" : m <= 9 ? "Q3" : "Q4"
    out.push(`${y}-${q}`)
  }
  return [...new Set(out)]
}

/** Metric-specific high-stress check. CRE/Capital uses raw multiple (e.g. 4.0x); others use stress score 0–100. */
function isHighStress(
  b: { stressScore: number; creToCapital?: number },
  metric: MapMetric,
  threshold: number
): boolean {
  if (metric === "creCapital" && b.creToCapital != null) {
    const rawMultiple = b.creToCapital / 100
    return rawMultiple >= threshold
  }
  return (parseNum(b.stressScore) ?? 0) >= threshold
}

export async function getMapStatesData(
  quarter?: string,
  metric: MapMetric = "composite",
  threshold = 70,
  debug = false
) {
  const quarters = getAvailableQuarters()
  const q = quarter || quarters[0]
  const banks = await fetchFDICFinancialsForQuarter(q)
  const withStress = computeStressScores(banks, metric)

  const byState = new Map<
    string,
    {
      state: string
      stateCode: string
      bankCount: number
      highStressCount: number
      stressAvg: number
      stressP90: number
      highStressShare: number
      topBanks: Array<{ name: string; stressScore: number }>
    }
  >()

  for (const b of withStress) {
    const state = normalizeStateName(b.state || "Unknown")
    const code =
      STATE_NAME_TO_CODE[state] || state.slice(0, 2).toUpperCase()
    let agg = byState.get(state)
    if (!agg) {
      agg = {
        state,
        stateCode: code,
        bankCount: 0,
        highStressCount: 0,
        stressAvg: 0,
        stressP90: 0,
        highStressShare: 0,
        topBanks: [],
      }
      byState.set(state, agg)
    }
    agg.bankCount++
    if (isHighStress(b, metric, threshold)) agg.highStressCount++
    const score = parseNum(b.stressScore) ?? 0
    agg.stressAvg += score
    agg.topBanks.push({ name: b.name, stressScore: score })
  }

  for (const agg of byState.values()) {
    agg.stressAvg =
      agg.bankCount > 0 ? agg.stressAvg / agg.bankCount : 0
    agg.highStressShare =
      agg.bankCount > 0 ? agg.highStressCount / agg.bankCount : 0
    agg.topBanks = agg.topBanks
      .sort((a, b) => b.stressScore - a.stressScore)
      .slice(0, 5)
    const scores = withStress
      .filter((b) => normalizeStateName(b.state || "Unknown") === agg.state)
      .map((b) => parseNum(b.stressScore) ?? 0)
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b)
    agg.stressP90 =
      scores.length > 0
        ? scores[Math.min(Math.floor(scores.length * 0.9), scores.length - 1)]
        : 0
  }

  const states = Array.from(byState.values()).map((s) => ({
    ...s,
    bankCount: Number(s.bankCount),
    highStressCount: Number(s.highStressCount),
    stressAvg: Number(s.stressAvg),
    stressP90: Number(s.stressP90),
    highStressShare: Number(s.highStressShare),
    topBanks: s.topBanks.map((t) => ({
      name: t.name,
      stressScore: Number(t.stressScore),
    })),
  }))

  const result: {
    quarter: string
    quarters: string[]
    states: typeof states
    debug?: ReturnType<typeof computeDebugStats>
  } = {
    quarter: q,
    quarters: quarters,
    states,
  }

  if (debug) {
    const metricValues = states.flatMap((s) => [
      s.stressAvg,
      s.stressP90,
      s.highStressShare,
    ])
    result.debug = computeDebugStats(
      metricValues.filter((v) => Number.isFinite(v)),
      metric
    )
  }

  return result
}

export async function getMapMetrosData(
  state: string,
  quarter?: string,
  metric: MapMetric = "composite",
  threshold = 70,
  debug = false
) {
  const quarters = getAvailableQuarters()
  const q = quarter || quarters[0]
  const banks = await fetchFDICFinancialsForQuarter(q, state)
  const locations = await fetchLocations(state, 3000)

  const certToLoc = new Map<string, (typeof locations)[0]>()
  for (const loc of locations) {
    if (!certToLoc.has(loc.CERT) || loc.MAINOFF === 1) {
      certToLoc.set(loc.CERT, loc)
    }
  }

  const withStress = computeStressScores(banks, metric)

  const byCbsa = new Map<
    string,
    {
      cbsaNo: string
      cbsaName: string
      lat: number
      lon: number
      bankCount: number
      highStressCount: number
      stressAvg: number
      stressP90: number
      highStressShare: number
      topBanks: Array<{ name: string; stressScore: number }>
    }
  >()

  for (const b of withStress) {
    const loc = certToLoc.get(b.id)
    const cbsaNo = String(loc?.CBSA_NO ?? "0").trim() || "0"
    const cbsaName = loc?.CBSA || "Non-Metro"
    const lat = parseNum(loc?.LATITUDE) ?? 0
    const lon = parseNum(loc?.LONGITUDE) ?? 0

    let agg = byCbsa.get(cbsaNo)
    if (!agg) {
      agg = {
        cbsaNo,
        cbsaName,
        lat,
        lon,
        bankCount: 0,
        highStressCount: 0,
        stressAvg: 0,
        stressP90: 0,
        highStressShare: 0,
        topBanks: [],
      }
      byCbsa.set(cbsaNo, agg)
    }
    agg.bankCount++
    if (isHighStress(b, metric, threshold)) agg.highStressCount++
    const score = parseNum(b.stressScore) ?? 0
    agg.stressAvg += score
    agg.topBanks.push({ name: b.name, stressScore: score })
  }

  for (const agg of byCbsa.values()) {
    agg.stressAvg = agg.bankCount > 0 ? agg.stressAvg / agg.bankCount : 0
    agg.highStressShare =
      agg.bankCount > 0 ? agg.highStressCount / agg.bankCount : 0
    agg.topBanks = agg.topBanks
      .sort((a, b) => b.stressScore - a.stressScore)
      .slice(0, 5)
    const scores = withStress
      .filter((b) => {
        const l = certToLoc.get(b.id)
        return (l?.CBSA_NO || "0") === agg.cbsaNo
      })
      .map((b) => parseNum(b.stressScore) ?? 0)
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b)
    agg.stressP90 =
      scores.length > 0
        ? scores[Math.min(Math.floor(scores.length * 0.9), scores.length - 1)]
        : 0
  }

  const metros = Array.from(byCbsa.values())
    .filter((m) => m.cbsaNo !== "0" && m.lat && m.lon)
    .map((m) => ({
      ...m,
      bankCount: Number(m.bankCount),
      highStressCount: Number(m.highStressCount),
      stressAvg: Number(m.stressAvg),
      stressP90: Number(m.stressP90),
      highStressShare: Number(m.highStressShare),
      topBanks: m.topBanks.map((t) => ({
        name: t.name,
        stressScore: Number(t.stressScore),
      })),
    }))

  const result: {
    quarter: string
    state: string
    metros: typeof metros
    debug?: ReturnType<typeof computeDebugStats>
  } = {
    quarter: q,
    state,
    metros,
  }

  if (debug) {
    const colorValues = metros.flatMap((m) => [
      m.highStressShare,
      m.stressP90,
      m.stressAvg,
    ])
    result.debug = computeDebugStats(
      colorValues.filter((v) => Number.isFinite(v)),
      metric
    )
  }

  return result
}

export async function getMapBanksData(
  bbox: { west: number; south: number; east: number; north: number },
  state?: string,
  quarter?: string,
  metric: MapMetric = "composite"
) {
  const quarters = getAvailableQuarters()
  const q = quarter || quarters[0]
  const banks = await fetchFDICFinancialsForQuarter(q, state)
  const locations = await fetchLocations(state, 5000)

  const certToLoc = new Map<string, (typeof locations)[0]>()
  for (const loc of locations) {
    if (!certToLoc.has(loc.CERT) || loc.MAINOFF === 1) {
      certToLoc.set(loc.CERT, loc)
    }
  }

  const withStress = computeStressScores(banks, metric)

  const inBbox = withStress
    .map((b) => {
      const loc = certToLoc.get(b.id)
      if (!loc || loc.LATITUDE == null || loc.LONGITUDE == null) return null
      const lat = Number(loc.LATITUDE)
      const lon = Number(loc.LONGITUDE)
      if (
        lon >= bbox.west &&
        lon <= bbox.east &&
        lat >= bbox.south &&
        lat <= bbox.north
      ) {
        return {
          id: b.id,
          name: b.name,
          stressScore: b.stressScore,
          creToCapital: b.creToCapital,
          nplRatio: b.nplRatio,
          loanLossReserve: b.loanLossReserve,
          noncurrent_to_loans_ratio: b.noncurrent_to_loans_ratio,
          noncurrent_to_assets_ratio: b.noncurrent_to_assets_ratio,
          lat,
          lon,
        }
      }
      return null
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .slice(0, 500)

  return { quarter: q, banks: inBbox }
}
