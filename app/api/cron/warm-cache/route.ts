import { NextResponse } from "next/server"
import { getCachedIndustryOutlook } from "@/app/services/industry-outlook/getCachedOutlook"
import { fetchPublicMentions } from "@/app/actions/fetch-public-mentions"
import { fetchInvestingNews } from "@/app/actions/fetch-investing-news"
import { fetchLegalUpdates } from "@/app/actions/fetch-legal-updates"
import { fetchMarketResearch } from "@/app/actions/fetch-market-research"
import { fetchResearchFeed } from "@/app/actions/fetch-research-feed"
import { fetchKpiData } from "@/app/actions/fetch-kpi-data"
import { fetchMarketInsights } from "@/app/actions/fetch-insights"
import { fetchPriceIndexData, fetchTransactionVolumeData } from "@/app/actions/fetch-cre-data"

export const runtime = "nodejs"
// 5 minutes — all tasks run concurrently so wall time is the slowest single task
export const maxDuration = 300

type WarmResult = "ok" | `error:${string}`

async function warmWithLabel<T>(
  label: string,
  fn: () => Promise<T>,
  results: Record<string, WarmResult>
): Promise<void> {
  try {
    await fn()
    results[label] = "ok"
  } catch (err) {
    results[label] = `error:${err instanceof Error ? err.message : String(err)}`
  }
}

export async function GET(request: Request) {
  // Vercel sends: Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (cronSecret) {
    const auth = request.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const results: Record<string, WarmResult> = {}
  const startedAt = new Date().toISOString()

  await Promise.allSettled([
    // News tab — Industry Outlook (Key Signals)
    warmWithLabel("industryOutlook", () => getCachedIndustryOutlook(), results),

    // News tab — CRE Public Mentions
    warmWithLabel("publicMentions:national", () => fetchPublicMentions("national"), results),
    warmWithLabel("publicMentions:florida", () => fetchPublicMentions("florida"), results),
    warmWithLabel("publicMentions:miami", () => fetchPublicMentions("miami"), results),

    // News tab — Investing & Finance News
    warmWithLabel("investingNews:national", () => fetchInvestingNews("national"), results),
    warmWithLabel("investingNews:florida", () => fetchInvestingNews("florida"), results),
    warmWithLabel("investingNews:miami", () => fetchInvestingNews("miami"), results),

    // Market Research tab
    warmWithLabel("marketResearch", () => fetchMarketResearch(), results),
    warmWithLabel("researchFeed", () => fetchResearchFeed(), results),

    // Legal tab
    warmWithLabel("legalUpdates", () => fetchLegalUpdates(), results),

    // Dashboard tab — KPIs, AI insights, charts (per region)
    warmWithLabel("kpiData:national", () => fetchKpiData("national"), results),
    warmWithLabel("kpiData:florida", () => fetchKpiData("florida"), results),
    warmWithLabel("kpiData:miami", () => fetchKpiData("miami"), results),
    warmWithLabel("insights:national", () => fetchMarketInsights("national"), results),
    warmWithLabel("insights:florida", () => fetchMarketInsights("florida"), results),
    warmWithLabel("insights:miami", () => fetchMarketInsights("miami"), results),
    warmWithLabel("priceIndex:national", () => fetchPriceIndexData("national"), results),
    warmWithLabel("priceIndex:florida", () => fetchPriceIndexData("florida"), results),
    warmWithLabel("priceIndex:miami", () => fetchPriceIndexData("miami"), results),
    warmWithLabel("txVolume:national", () => fetchTransactionVolumeData("national"), results),
    warmWithLabel("txVolume:florida", () => fetchTransactionVolumeData("florida"), results),
    warmWithLabel("txVolume:miami", () => fetchTransactionVolumeData("miami"), results),
  ])

  const failed = Object.entries(results).filter(([, v]) => v !== "ok")
  console.info("cron:warm-cache", { startedAt, finishedAt: new Date().toISOString(), results })

  return NextResponse.json({
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    status: failed.length === 0 ? "all_ok" : `${failed.length}_failed`,
  })
}
