import { NextResponse } from "next/server"
import { fetchPublicMentions } from "@/app/actions/fetch-public-mentions"
import { fetchInvestingNews } from "@/app/actions/fetch-investing-news"
import { summarizeNewsItem } from "@/app/actions/fetch-news-summary"
import type { PublicMentionItem } from "@/app/actions/fetch-public-mentions"

export const runtime = "nodejs"
// 5 minutes — briefs run in limited-concurrency waves
export const maxDuration = 300

type Level = "national" | "florida" | "miami"
const LEVELS: Level[] = ["national", "florida", "miami"]

// Top rows of each table are what users click first. 6 per feed per level,
// deduped across feeds, keeps the nightly run within time and cost budget.
const BRIEFS_PER_FEED = 6
const CONCURRENCY = 5

// Mirror the UI's table sort (open access first, then geo relevance) so we
// warm the rows the user actually sees at the top.
function sortLikeUi(items: PublicMentionItem[], level: Level): PublicMentionItem[] {
  const accessOrder = { open: 0, partial: 1, paywalled: 2 } as const
  const geoScore = (item: PublicMentionItem) => {
    if (level === "florida") return item.region === "florida" || item.region === "miami" ? 0 : 1
    if (level === "miami") return item.region === "miami" ? 0 : item.region === "florida" ? 1 : 2
    return 0
  }
  return [...items].sort((a, b) => {
    const accessDiff = (accessOrder[a.access_status] ?? 1) - (accessOrder[b.access_status] ?? 1)
    if (accessDiff !== 0) return accessDiff
    return geoScore(a) - geoScore(b)
  })
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (cronSecret) {
    const auth = request.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const startedAt = new Date().toISOString()
  const results: Record<string, string> = {}

  // Feeds are already cached by the earlier warm-cache run; these calls are fast.
  const tasks: Array<{ key: string; level: Level; item: PublicMentionItem }> = []
  const seen = new Set<string>()

  for (const level of LEVELS) {
    const [mentions, investing] = await Promise.allSettled([
      fetchPublicMentions(level),
      fetchInvestingNews(level),
    ])
    const feeds: Array<{ name: string; items: PublicMentionItem[] }> = []
    if (mentions.status === "fulfilled") feeds.push({ name: "mentions", items: mentions.value.news })
    if (investing.status === "fulfilled") feeds.push({ name: "investing", items: investing.value.news })

    for (const feed of feeds) {
      const top = sortLikeUi(feed.items, level).slice(0, BRIEFS_PER_FEED)
      for (const item of top) {
        const url = (item.resolved_url || item.url || "").trim()
        const dedupeKey = `${level}:${url || item.title}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        tasks.push({ key: `${feed.name}:${level}:${item.title.slice(0, 60)}`, level, item })
      }
    }
  }

  // Limited-concurrency pool so we don't hammer the OpenAI API.
  // Deadline-aware: briefs cache individually, so if we run out of time the
  // next trigger (deploy hook or daily cron) picks up only the remainder.
  const deadlineMs = Date.now() + 240_000
  let cursor = 0
  async function worker() {
    while (cursor < tasks.length) {
      if (Date.now() > deadlineMs) {
        while (cursor < tasks.length) results[tasks[cursor++].key] = "skipped:deadline"
        return
      }
      const task = tasks[cursor++]
      try {
        const brief = await summarizeNewsItem({
          title: task.item.title,
          url: task.item.resolved_url || task.item.url,
          source: task.item.source,
          date: task.item.date,
          summary: task.item.snippet,
          level: task.level,
        })
        results[task.key] = brief.keyBullets.length ? "ok" : "ok_thin"
      } catch (err) {
        results[task.key] = `error:${err instanceof Error ? err.message : String(err)}`
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker()))

  const failed = Object.values(results).filter((v) => v.startsWith("error")).length
  console.info("cron:warm-briefs", { startedAt, finishedAt: new Date().toISOString(), total: tasks.length, failed })

  return NextResponse.json({
    startedAt,
    finishedAt: new Date().toISOString(),
    total: tasks.length,
    failed,
    results,
    status: failed === 0 ? "all_ok" : `${failed}_failed`,
  })
}
