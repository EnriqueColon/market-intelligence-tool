import { NextResponse } from "next/server"
import { fetchPublicMentions } from "@/app/actions/fetch-public-mentions"
import { fetchInvestingNews } from "@/app/actions/fetch-investing-news"
import { fetchLegalUpdates } from "@/app/actions/fetch-legal-updates"
import { fetchMarketResearch } from "@/app/actions/fetch-market-research"

export const runtime = "nodejs"
// Allow up to 5 minutes — all warmings run concurrently so wall time is
// dominated by the single slowest call (~48s for industry-outlook).
export const maxDuration = 300

type WarmResult = "ok" | `error:${string}`

function resolveBaseUrl(): string {
  // VERCEL_PROJECT_PRODUCTION_URL is the stable production hostname (no protocol).
  // VERCEL_URL is the per-deployment URL — also usable for self-calls on Vercel.
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    process.env.APP_URL
  if (!host) return "http://localhost:3000"
  if (host.startsWith("http://") || host.startsWith("https://")) return host
  return `https://${host}`
}

async function warmIndustryOutlook(baseUrl: string): Promise<WarmResult> {
  try {
    const res = await fetch(`${baseUrl}/api/industry-outlook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
    return res.ok ? "ok" : `error:${res.status}`
  } catch (err) {
    return `error:${err instanceof Error ? err.message : String(err)}`
  }
}

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
  // Allow through if no secret is configured (local dev / first deploy).
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (cronSecret) {
    const auth = request.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const baseUrl = resolveBaseUrl()
  const results: Record<string, WarmResult> = {}
  const startedAt = new Date().toISOString()

  // Run every warming task concurrently — wall time is bounded by the slowest
  // single task (~48s for industry-outlook) not by the sum.
  await Promise.allSettled([
    warmWithLabel("industryOutlook", () => warmIndustryOutlook(baseUrl), results),
    warmWithLabel("publicMentions:national", () => fetchPublicMentions("national"), results),
    warmWithLabel("publicMentions:florida", () => fetchPublicMentions("florida"), results),
    warmWithLabel("publicMentions:miami", () => fetchPublicMentions("miami"), results),
    warmWithLabel("investingNews:national", () => fetchInvestingNews("national"), results),
    warmWithLabel("investingNews:florida", () => fetchInvestingNews("florida"), results),
    warmWithLabel("investingNews:miami", () => fetchInvestingNews("miami"), results),
    warmWithLabel("marketResearch", () => fetchMarketResearch(), results),
    warmWithLabel("legalUpdates", () => fetchLegalUpdates(), results),
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
