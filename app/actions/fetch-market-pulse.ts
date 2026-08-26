"use server"

import { unstable_cache } from "next/cache"
import { newsCalendarDayET, NEWS_TAB_REVALIDATE_SECONDS } from "@/lib/news-tab-cache"
import {
  describeChange,
  formatValue,
  parseFredCsv,
  periodLabel,
  selectWindow,
  type FredSeriesSpec,
  type Observation,
} from "@/lib/verified-metrics"

/**
 * The market pulse strip that sits above the tabs.
 *
 * It reuses the parsing and formatting in lib/verified-metrics — the same code
 * that anchors the outlook memo — so a figure shown here and a figure quoted in
 * Key Signals cannot disagree. What it cannot reuse is the memo's output shape:
 * VerifiedMetric is a finished English sentence, and a tile needs the value, the
 * move and the recent history as separate fields.
 *
 * Everything is measured. Nothing on this strip is model-generated.
 */

const FRED_CSV_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv"
const FRED_TIMEOUT_MS = 6_000

/**
 * The tape, in reading order: what CRE credit is doing, what it costs, what
 * credit markets charge for risk, then the property fundamentals underneath.
 *
 * Every id was resolved against the live CSV endpoint before being added, and
 * its frequency read off the returned observations rather than assumed. That is
 * not ceremony: `CABOREA`, named in `lib/fred-constants.ts` as the CRE
 * charge-off series, does not exist and returns an error page. Two things worth
 * knowing for anyone extending this list — FRED publishes no multifamily-only
 * delinquency series (`DRMFRMACBS` and friends are 404), and its US commercial
 * property price index, `COMREPUSQ159N`, stopped updating in April 2025, so the
 * one series a CRE tape most wants is not available.
 *
 * Labels are tape headings. The specs in verified-metrics carry sentence
 * subjects, which are far too long here.
 */
const PULSE_SERIES: Array<FredSeriesSpec & { label: string }> = [
  // ------------------------------------------------------------ CRE credit
  {
    id: "DRCRELEXFACBS",
    label: "CRE Delinquency",
    subject: "The delinquency rate on commercial real estate loans",
    unit: "percent",
    frequency: "quarterly",
    publisher: "Federal Reserve Board",
  },
  {
    id: "CORCREXFACBS",
    label: "CRE Charge-offs",
    subject: "The net charge-off rate on commercial real estate loans",
    unit: "percent",
    frequency: "quarterly",
    publisher: "Federal Reserve Board",
  },
  {
    id: "CREACBM027NBOG",
    label: "CRE Loans Outstanding",
    subject: "Commercial real estate loans outstanding at all U.S. commercial banks",
    unit: "usd-billions",
    frequency: "monthly",
    publisher: "Federal Reserve Board H.8",
  },
  {
    id: "SUBLPDCLCTSNQ",
    // Named for what the figure counts. "CRE Standards" beside "4.40%" reads as
    // a rate; this is the net share of surveyed banks that tightened.
    label: "Banks Tightening CRE",
    subject:
      "The net percentage of domestic banks tightening standards on construction and land development loans",
    unit: "net-percent",
    frequency: "quarterly",
    publisher: "Federal Reserve Board Senior Loan Officer Survey",
  },
  {
    id: "DRSFRMACBS",
    label: "Resi Delinquency",
    subject: "The delinquency rate on single-family residential mortgages at U.S. commercial banks",
    unit: "percent",
    frequency: "quarterly",
    publisher: "Federal Reserve Board",
  },

  // -------------------------------------------------------- Cost of money
  {
    id: "SOFR",
    label: "SOFR",
    subject: "The Secured Overnight Financing Rate",
    unit: "percent",
    frequency: "daily",
    publisher: "Federal Reserve Bank of New York",
  },
  {
    id: "DPRIME",
    label: "Prime Rate",
    subject: "The bank prime loan rate",
    unit: "percent",
    frequency: "daily",
    publisher: "Federal Reserve Board H.15",
  },
  {
    id: "DGS2",
    label: "2Y Treasury",
    subject: "The 2-year Treasury yield",
    unit: "percent",
    frequency: "daily",
    publisher: "U.S. Treasury",
  },
  {
    id: "DGS10",
    label: "10Y Treasury",
    subject: "The 10-year Treasury yield",
    unit: "percent",
    frequency: "daily",
    publisher: "U.S. Treasury",
  },
  {
    id: "T10Y2Y",
    label: "10Y–2Y Spread",
    subject: "The spread between the 10-year and 2-year Treasury yields",
    unit: "percent",
    frequency: "daily",
    publisher: "Federal Reserve Bank of St. Louis",
  },
  {
    id: "DFII10",
    label: "10Y Real Yield",
    subject: "The 10-year Treasury inflation-indexed yield",
    unit: "percent",
    frequency: "daily",
    publisher: "U.S. Treasury",
  },
  {
    id: "MORTGAGE30US",
    label: "30Y Mortgage",
    subject: "The average 30-year fixed mortgage rate",
    unit: "percent",
    frequency: "weekly",
    publisher: "Freddie Mac",
  },

  // ------------------------------------------------- Price of credit risk
  {
    id: "BAMLC0A0CM",
    label: "IG Spread",
    subject: "The ICE BofA U.S. corporate investment-grade option-adjusted spread",
    unit: "percent",
    frequency: "daily",
    publisher: "ICE Data Indices",
  },
  {
    id: "BAMLH0A0HYM2",
    label: "High-Yield Spread",
    subject: "The ICE BofA U.S. high-yield option-adjusted spread",
    unit: "percent",
    frequency: "daily",
    publisher: "ICE Data Indices",
  },

  // ------------------------------------------------- Property fundamentals
  {
    id: "RRVRUSQ156N",
    label: "Rental Vacancy",
    subject: "The national rental vacancy rate",
    unit: "percent",
    frequency: "quarterly",
    publisher: "U.S. Census Bureau",
  },
  {
    id: "HOUST5F",
    label: "Multifamily Starts",
    subject: "Housing starts in buildings with five units or more",
    unit: "units-thousands",
    frequency: "monthly",
    publisher: "U.S. Census Bureau and HUD",
  },
  {
    id: "PERMIT",
    label: "Building Permits",
    subject: "New privately owned housing units authorized by building permit",
    unit: "units-thousands",
    frequency: "monthly",
    publisher: "U.S. Census Bureau and HUD",
  },
  {
    id: "CSUSHPINSA",
    label: "Home Price Index",
    subject: "The S&P CoreLogic Case-Shiller U.S. National Home Price Index",
    unit: "index",
    frequency: "monthly",
    publisher: "S&P Dow Jones Indices",
  },
  {
    id: "PNRESCONS",
    label: "Nonres Construction",
    subject: "Private nonresidential construction spending",
    unit: "usd-millions",
    frequency: "monthly",
    publisher: "U.S. Census Bureau",
  },
]

export type PulseTile = {
  id: string
  label: string
  value: string
  asOf: string
  /** Sequential move, already worded ("up 12 bps"), or null when it rounds to nothing. */
  change: string | null
  direction: "up" | "down" | "flat"
  /** Recent history, downsampled for a sparkline. */
  spark: number[]
  publisher: string
}

/** Three years of history, matching what the outlook memo reads. */
function observationStart(): string {
  const start = new Date()
  start.setFullYear(start.getFullYear() - 3)
  return start.toISOString().slice(0, 10)
}

/**
 * Thins a series to at most `max` points for the sparkline.
 *
 * The last observation is always kept: it is the value printed beside the
 * sparkline, and dropping it would leave the line ending somewhere other than
 * the number it is supposed to illustrate.
 */
function downsample(rows: Observation[], max = 24): number[] {
  if (rows.length <= max) return rows.map((r) => r.value)
  const step = (rows.length - 1) / (max - 1)
  const out: number[] = []
  for (let i = 0; i < max; i++) out.push(rows[Math.round(i * step)].value)
  out[out.length - 1] = rows[rows.length - 1].value
  return out
}

async function fetchTile(spec: (typeof PULSE_SERIES)[number]): Promise<PulseTile | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FRED_TIMEOUT_MS)
  try {
    const url = `${FRED_CSV_BASE}?id=${encodeURIComponent(spec.id)}&cosd=${observationStart()}`
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "text/csv,*/*" },
      next: { revalidate: 3600 },
    })
    if (!res.ok) {
      console.warn(`market-pulse: FRED ${spec.id} returned ${res.status}`)
      return null
    }

    const rows = parseFredCsv(await res.text())
    const window = selectWindow(rows)
    if (!window) return null

    const { latest, prior } = window
    const change = prior ? describeChange(latest.value, prior.value, spec.unit) : null

    return {
      id: spec.id,
      label: spec.label,
      value: formatValue(latest.value, spec.unit),
      asOf: periodLabel(latest.date, spec.frequency),
      change,
      direction: !prior || latest.value === prior.value ? "flat" : latest.value > prior.value ? "up" : "down",
      spark: downsample(rows),
      publisher: spec.publisher,
    }
  } catch (err) {
    console.warn(`market-pulse: FRED ${spec.id} failed:`, err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Tiles for today. A source that fails is simply absent rather than fatal, and
 * an entirely empty result throws inside the cache so a bad fetch window is not
 * held for the rest of the day.
 */
export async function fetchMarketPulse(): Promise<PulseTile[]> {
  const cached = unstable_cache(
    async () => {
      const results = await Promise.all(PULSE_SERIES.map(fetchTile))
      const tiles = results.filter((t): t is PulseTile => t !== null)
      if (tiles.length === 0) throw new Error("No pulse series available")
      return tiles
    },
    ["market-pulse-v2", newsCalendarDayET()],
    { revalidate: NEWS_TAB_REVALIDATE_SECONDS }
  )

  try {
    return await cached()
  } catch (err) {
    console.error("market-pulse: unavailable for this run:", err)
    return []
  }
}
