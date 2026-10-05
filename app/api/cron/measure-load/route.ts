import { NextResponse } from "next/server"
import { getCachedIndustryOutlook } from "@/app/services/industry-outlook/getCachedOutlook"
import { fetchPublicMentions } from "@/app/actions/fetch-public-mentions"
import { fetchInvestingNews } from "@/app/actions/fetch-investing-news"
import { fetchLegalUpdates } from "@/app/actions/fetch-legal-updates"
import { resolveLegalApplicability } from "@/app/actions/resolve-legal-applicability"
import { fetchMarketPulse } from "@/app/actions/fetch-market-pulse"
import { fetchMarketResearch } from "@/app/actions/fetch-market-research"
import { fetchResearchFeed } from "@/app/actions/fetch-research-feed"
import { getScreeningPayload } from "@/app/actions/market-analytics-screening"
import { getAnalyticsVisuals } from "@/app/actions/market-analytics-visuals"

export const runtime = "nodejs"
export const maxDuration = 300

/**
 * Where the seconds go.
 *
 * Diagnostic, not a cron: it times every server action the dashboard calls when a tab mounts,
 * exactly as the components call them, and reports what came back. Each is run twice in a row.
 * A cache hit costs about the same both times and is quick; a miss is slow the first time and
 * quick the second, and the gap is what regeneration costs. A pair that is slow *both* times is
 * the one to look at — either it is not cached at all, or its payload exceeds the 2 MB entry limit
 * that Vercel's Data Cache enforces silently, in which case it regenerates on every visit and
 * nothing logs the fact. `bytes` is reported against that limit for exactly this reason.
 *
 * Lives under /api/cron so the middleware's cookie gate does not apply and the CRON_SECRET bearer
 * check does — the same arrangement as warm-cache. Pass ?only=a,b,c to measure a subset.
 */

type Timing = {
  ms: [number, number]
  bytes: number
  overCacheLimit: boolean
  ok: boolean
  error?: string
  note?: string
}

const CACHE_ENTRY_LIMIT = 2 * 1024 * 1024

async function time<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> {
  const start = performance.now()
  try {
    const value = await fn()
    return { ms: Math.round(performance.now() - start), value }
  } catch (err) {
    return { ms: Math.round(performance.now() - start), error: err instanceof Error ? err.message : String(err) }
  }
}

async function measure<T>(fn: () => Promise<T>, note?: string): Promise<Timing> {
  const first = await time(fn)
  const second = await time(fn)
  const sample = second.value ?? first.value
  const bytes = sample === undefined ? 0 : Buffer.byteLength(JSON.stringify(sample))
  return {
    ms: [first.ms, second.ms],
    bytes,
    overCacheLimit: bytes > CACHE_ENTRY_LIMIT,
    ok: !first.error && !second.error,
    error: first.error ?? second.error,
    note,
  }
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (cronSecret) {
    const auth = request.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const only = new URL(request.url).searchParams.get("only")?.split(",").map((s) => s.trim()).filter(Boolean)
  const wanted = (label: string) => !only || only.includes(label)

  // In the order and grouping the dashboard mounts them. Groups run sequentially so that one
  // measurement does not share the function's CPU and network with another; within a group the
  // calls are what a single component fires at once.
  const plan: Array<[string, () => Promise<unknown>, string?]> = [
    ["pulse", () => fetchMarketPulse(), "every tab; not in warm-cache"],
    ["outlook", () => getCachedIndustryOutlook(), "News tab"],
    ["publicMentions:national", () => fetchPublicMentions("national"), "News tab"],
    ["publicMentions:florida", () => fetchPublicMentions("florida"), "News tab"],
    ["publicMentions:miami", () => fetchPublicMentions("miami"), "News tab"],
    ["investingNews:national", () => fetchInvestingNews("national"), "News tab"],
    ["investingNews:florida", () => fetchInvestingNews("florida"), "News tab"],
    ["investingNews:miami", () => fetchInvestingNews("miami"), "News tab"],
    ["researchFeed", () => fetchResearchFeed(), "Market Research tab"],
    ["marketResearch", () => fetchMarketResearch(), "Analytics tab, FHFA/FRED block"],
    ["screening:florida", () => getScreeningPayload("Florida"), "Analytics tab default; also under legal applicability"],
    ["visuals:florida", () => getAnalyticsVisuals("Florida"), "Analytics tab, below the fold"],
    ["legal", () => fetchLegalUpdates(), "Legal tab, first trip"],
  ]

  const startedAt = new Date().toISOString()
  const wall = performance.now()
  const results: Record<string, Timing> = {}

  for (const [label, fn, note] of plan) {
    if (!wanted(label)) continue
    results[label] = await measure(fn, note)
  }

  // The Legal tab's second trip depends on the first's payload, as it does in the component.
  if (wanted("legal:applicability")) {
    const feed = await fetchLegalUpdates().catch(() => undefined)
    const requests = (feed?.items ?? [])
      .filter((item) => item.applicability)
      .map((item) => ({ id: item.id, applicability: item.applicability }))
    results["legal:applicability"] = requests.length
      ? await measure(() => resolveLegalApplicability(requests as never), `Legal tab, second trip; ${requests.length} items; not cached`)
      : { ms: [0, 0], bytes: 0, overCacheLimit: false, ok: true, note: "no items carry applicability today" }
  }

  return NextResponse.json({
    startedAt,
    wallMs: Math.round(performance.now() - wall),
    region: process.env.VERCEL_REGION ?? "local",
    cacheEntryLimitBytes: CACHE_ENTRY_LIMIT,
    results,
  })
}
