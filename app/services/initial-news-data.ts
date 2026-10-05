import "server-only"
import { after } from "next/server"
import { fetchInvestingNews } from "@/app/actions/fetch-investing-news"
import { fetchMarketPulse, type PulseTile } from "@/app/actions/fetch-market-pulse"
import { fetchPublicMentions, type PublicMentionItem } from "@/app/actions/fetch-public-mentions"
import { getCachedIndustryOutlook } from "@/app/services/industry-outlook/getCachedOutlook"

/**
 * The News tab's data, read on the server so the page arrives with it.
 *
 * Until this existed the page was an empty shell and every box on the News tab fetched its own
 * data after the JavaScript had loaded: wake the function, send the shell, download 600 KB of
 * script, then eight calls back, each waking the function again and reading the same caches this
 * reads. On a warm day — which is every day after the 05:00 cron — all eight were cache hits that
 * cost nothing to compute and several seconds to deliver, because they were delivered one network
 * hop too late. Measured 2026-10-05: every News action returns in under a millisecond from a warm
 * cache; a production function wakes in 1.7 s.
 *
 * Each read here races a short budget. A warm cache answers in milliseconds and the data goes into
 * the page; a cold one is abandoned at the budget and the component fetches as it always did, so
 * the worst case is exactly today's behaviour and the page is never held for regeneration. The
 * abandoned read is kept alive past the response with `after()` — without it Vercel may freeze
 * the function once the page is sent, and the half-finished regeneration with it — so a cold day
 * fills the cache from the page render; the component's own fetch, arriving a second later, then
 * either hits it or regenerates in parallel. Either way the double work is paid at most once per
 * feed per day. Measured locally: cold page 2.6 s with the strip and placeholders, full page 87 ms
 * once the reads had landed.
 */

export type NewsLevel = "national" | "florida" | "miami"
const LEVELS: NewsLevel[] = ["national", "florida", "miami"]

export type InitialNewsData = {
  pulse?: PulseTile[]
  outlook?: string
  /** All three levels or nothing: a partial set would have the component fetch everything again. */
  publicMentions?: Record<NewsLevel, PublicMentionItem[]>
  investingNews?: Record<NewsLevel, PublicMentionItem[]>
}

/** How long the page will wait for a cache to answer. Generous for a hit, far short of a miss. */
export const INITIAL_READ_BUDGET_MS = 2_500

async function within<T>(promise: Promise<T>, budgetMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), budgetMs)
  })
  try {
    return await Promise.race([promise.catch(() => undefined), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function readLevels(
  fetchLevel: (level: NewsLevel) => Promise<{ news: PublicMentionItem[] }>,
  budgetMs: number
): Promise<Record<NewsLevel, PublicMentionItem[]> | undefined> {
  const results = await Promise.all(LEVELS.map((level) => within(fetchLevel(level), budgetMs)))
  if (results.some((r) => r === undefined)) return undefined
  return Object.fromEntries(LEVELS.map((level, i) => [level, results[i]!.news])) as Record<NewsLevel, PublicMentionItem[]>
}

export async function readInitialNewsData(budgetMs = INITIAL_READ_BUDGET_MS): Promise<InitialNewsData> {
  const pulseRead = fetchMarketPulse()
  const outlookRead = getCachedIndustryOutlook()
  const mentionReads = LEVELS.map((level) => fetchPublicMentions(level))
  const investingReads = LEVELS.map((level) => fetchInvestingNews(level))
  const all = [pulseRead, outlookRead, ...mentionReads, ...investingReads]

  // Whatever the budget abandons finishes after the response rather than being frozen with it.
  after(() => Promise.allSettled(all))

  const [pulse, outlook, publicMentions, investingNews] = await Promise.all([
    within(pulseRead, budgetMs),
    within(outlookRead, budgetMs),
    readLevels((level) => mentionReads[LEVELS.indexOf(level)], budgetMs),
    readLevels((level) => investingReads[LEVELS.indexOf(level)], budgetMs),
  ])
  return {
    pulse: pulse && pulse.length > 0 ? pulse : undefined,
    outlook: outlook && outlook.trim().length > 0 ? outlook : undefined,
    publicMentions,
    investingNews,
  }
}
