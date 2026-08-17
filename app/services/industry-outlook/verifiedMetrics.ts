import { unstable_cache } from "next/cache"
import { fetchFDICFinancials } from "@/app/actions/fetch-fdic-data"
import { newsCalendarDayET, NEWS_TAB_REVALIDATE_SECONDS } from "@/lib/news-tab-cache"
import {
  buildFdicMetric,
  buildFredMetric,
  fdicQuarterLabel,
  FRED_VERIFIED_SERIES,
  parseFredCsv,
  selectWindow,
  type FdicCohort,
  type FredSeriesSpec,
  type VerifiedMetric,
} from "@/lib/verified-metrics"

/**
 * Collects the measured figures the outlook memo is anchored on.
 *
 * Both sources are deliberately keyless: FRED's public CSV endpoint needs no
 * API key (unlike the FRED_API_KEY paths elsewhere in the app, which are dead
 * without a key that is not configured), and the FDIC API accepts anonymous
 * requests. This has to keep working in production without new credentials.
 *
 * Nothing here is allowed to take the memo down. Every fetch is individually
 * time-boxed and a failed source is simply absent from the result.
 */

const FRED_CSV_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv"
const FRED_TIMEOUT_MS = 6_000
const FDIC_TIMEOUT_MS = 9_000

/** Three years of history: enough for a year-over-year read on a quarterly series. */
function observationStart(): string {
  const start = new Date()
  start.setFullYear(start.getFullYear() - 3)
  return start.toISOString().slice(0, 10)
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { accept: "text/csv,*/*" },
      // Series update on a publication schedule, so an hour-old copy is current.
      next: { revalidate: 3600 },
    })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchFredMetric(spec: FredSeriesSpec): Promise<VerifiedMetric | null> {
  try {
    const url = `${FRED_CSV_BASE}?id=${encodeURIComponent(spec.id)}&cosd=${observationStart()}`
    const res = await fetchWithTimeout(url, FRED_TIMEOUT_MS)
    if (!res.ok) {
      console.warn(`verified-metrics: FRED ${spec.id} returned ${res.status}`)
      return null
    }
    const window = selectWindow(parseFredCsv(await res.text()))
    if (!window) {
      console.warn(`verified-metrics: FRED ${spec.id} returned no usable observations`)
      return null
    }
    return buildFredMetric(spec, window)
  } catch (err) {
    console.warn(`verified-metrics: FRED ${spec.id} failed:`, err)
    return null
  }
}

/**
 * Aggregates the Florida bank cohort from its most recent call reports.
 *
 * The FDIC query spans several quarters, so rows are first narrowed to the
 * latest reporting period — mixing periods would silently blend a stale quarter
 * into the average. Ratios are dollar-weighted rather than averaged across
 * institutions: an unweighted mean lets a small bank move the cohort as much as
 * a large one, which misstates the exposure the memo is describing.
 */
function aggregateFloridaCohort(
  banks: Awaited<ReturnType<typeof fetchFDICFinancials>>["data"]
): FdicCohort | null {
  const dates = banks.map((b) => b.reportDate).filter((d): d is string => Boolean(d))
  if (dates.length === 0) return null
  const latest = dates.reduce((a, b) => (a > b ? a : b))

  const rows = banks.filter((b) => b.reportDate === latest && b.totalLoans > 0)
  if (rows.length === 0) return null

  const totalLoans = rows.reduce((sum, b) => sum + b.totalLoans, 0)
  const creLoans = rows.reduce((sum, b) => sum + b.creLoans, 0)
  // noncurrent_to_loans_ratio is stored as a decimal (0.008 = 0.8%).
  const noncurrentDollars = rows.reduce(
    (sum, b) => sum + (b.noncurrent_to_loans_ratio || 0) * b.totalLoans,
    0
  )
  if (totalLoans <= 0) return null

  return {
    scope: "Florida",
    institutions: rows.length,
    creLoans,
    creConcentration: (creLoans / totalLoans) * 100,
    noncurrentRatio: (noncurrentDollars / totalLoans) * 100,
    asOf: fdicQuarterLabel(latest),
  }
}

async function fetchFloridaMetric(): Promise<VerifiedMetric | null> {
  try {
    const result = await Promise.race([
      // fetchAll stays false: one request, versus the paginated call the
      // Market Analytics export makes, which can run for minutes.
      fetchFDICFinancials("Florida", 500, false),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("FDIC request timed out")), FDIC_TIMEOUT_MS)
      ),
    ])
    if (result.error || result.data.length === 0) {
      console.warn(`verified-metrics: FDIC Florida unavailable: ${result.error || "no rows"}`)
      return null
    }
    const cohort = aggregateFloridaCohort(result.data)
    return cohort ? buildFdicMetric(cohort) : null
  } catch (err) {
    console.warn("verified-metrics: FDIC Florida failed:", err)
    return null
  }
}

async function collectVerifiedMetrics(): Promise<VerifiedMetric[]> {
  const results = await Promise.all([
    ...FRED_VERIFIED_SERIES.map((spec) => fetchFredMetric(spec)),
    fetchFloridaMetric(),
  ])
  const metrics = results.filter((m): m is VerifiedMetric => m !== null)
  console.info(
    `verified-metrics: resolved ${metrics.length}/${FRED_VERIFIED_SERIES.length + 1} sources`,
    metrics.map((m) => `${m.id}=${m.value}@${m.asOf}`).join(" ")
  )
  return metrics
}

/**
 * The measured figures for today, cached alongside the memo that uses them.
 *
 * An empty result throws inside the cached function so a bad fetch window is
 * never cached for the rest of the day; the caller treats absence as "generate
 * without measured data" rather than as an error.
 */
export async function getVerifiedMetrics(): Promise<VerifiedMetric[]> {
  const cached = unstable_cache(
    async () => {
      const metrics = await collectVerifiedMetrics()
      if (metrics.length === 0) throw new Error("No verified metrics available")
      return metrics
    },
    ["industry-outlook-verified-metrics-v1", newsCalendarDayET()],
    { revalidate: NEWS_TAB_REVALIDATE_SECONDS }
  )

  try {
    return await cached()
  } catch (err) {
    console.error("verified-metrics: unavailable for this run:", err)
    return []
  }
}
