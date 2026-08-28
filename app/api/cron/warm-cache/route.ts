import { NextResponse } from "next/server"
import {
  getCachedIndustryOutlook,
  getLastEvidenceGuardReport,
} from "@/app/services/industry-outlook/getCachedOutlook"
import { fetchPublicMentions } from "@/app/actions/fetch-public-mentions"
import { fetchInvestingNews } from "@/app/actions/fetch-investing-news"
import { fetchLegalUpdates } from "@/app/actions/fetch-legal-updates"
import { fetchMarketResearch } from "@/app/actions/fetch-market-research"
import { fetchResearchFeed } from "@/app/actions/fetch-research-feed"
import { fetchKpiData } from "@/app/actions/fetch-kpi-data"
import { fetchMarketInsights } from "@/app/actions/fetch-insights"
import { fetchPriceIndexData, fetchTransactionVolumeData } from "@/app/actions/fetch-cre-data"
import { getExecutiveBrief } from "@/app/actions/executive-brief"
import { getWorkbenchUniverse } from "@/app/actions/underwriter-workbench"
import { isFeatureEnabled } from "@/lib/features"

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

    // Department lenses. Each pulls nine quarters for every institution the
    // FDIC row cap allows, which is roughly fifty seconds cold — long enough
    // that the first person to pick a department after a deploy would otherwise
    // sit in front of a skeleton. Both are cached for six hours, so warming
    // once per deploy plus the daily cron covers the working day.
    //
    // Only "National" is warmed because that is the only scope either lens is
    // mounted with. If a scope selector is added, every scope it can produce
    // has to be added here or the tool quietly regains a fifty-second cold load.
    //
    // Skipped entirely where the lenses are not reachable, which is production
    // while they are still being built. Warming them there would spend a couple
    // of minutes of FDIC calls per deploy filling a cache nothing can read.
    ...(isFeatureEnabled("department-lenses")
      ? [
          warmWithLabel("executiveBrief:national", () => getExecutiveBrief("National"), results),
          warmWithLabel("workbench:national", () => getWorkbenchUniverse("National"), results),
        ]
      : []),
  ])

  const failed = Object.entries(results).filter(([, v]) => v !== "ok")
  // Null when the outlook was served from cache, i.e. the guard did not re-run.
  const evidenceGuard = getLastEvidenceGuardReport()
  console.info("cron:warm-cache", { startedAt, finishedAt: new Date().toISOString(), results })
  if (evidenceGuard) console.info("cron:warm-cache:evidence-guard", JSON.stringify(evidenceGuard))

  return NextResponse.json({
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    evidenceGuard,
    status: failed.length === 0 ? "all_ok" : `${failed.length}_failed`,
  })
}
