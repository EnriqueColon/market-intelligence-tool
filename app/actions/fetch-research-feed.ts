"use server"

export type ResearchReport = {
  id: string
  title: string
  publisher: string
  publishedDate: string
  topic: string
  summary: string
  keyFindings: string[]
  url: string
}

export type ArchivedReport = ResearchReport & { fetchedAt: string }

export type ResearchFeedResponse = {
  reports: ResearchReport[]        // fresh from Perplexity this session
  archive: ArchivedReport[]        // previously stored, not in fresh batch
  generatedAt: string
  notes: string[]
}

// One entry per publisher — each gets its own dedicated Perplexity search
// so no single firm dominates the results.
const PUBLISHERS = [
  { name: "Trepp",                site: "trepp.com",                focus: "CMBS delinquency, special servicing, loan maturities, distressed CRE debt" },
  { name: "CBRE",                 site: "cbre.com/insights",        focus: "CRE market outlook, cap rates, investment sales, office/multifamily/industrial" },
  { name: "JLL",                  site: "jll.com/trends-and-insights", focus: "CRE market conditions, capital markets, leasing activity, investment volumes" },
  { name: "Cushman & Wakefield",  site: "cushmanwakefield.com",     focus: "MarketBeat reports, CRE outlook, office/retail/industrial market stats" },
  { name: "Colliers",             site: "colliers.com",             focus: "CRE research, market reports, capital markets, property type outlooks" },
  { name: "Marcus & Millichap",   site: "marcusmillichap.com/research", focus: "investment sales, cap rates, multifamily, net lease, private capital" },
  { name: "MBA",                  site: "mba.org",                  focus: "commercial mortgage originations, delinquency rates, CMBS, bank CRE lending" },
  { name: "Moody's Analytics",    site: "moodysanalytics.com",      focus: "CRE price indices, distress signals, CMBS ratings, bank exposure" },
  { name: "Newmark",              site: "nmrk.com/research",        focus: "capital markets, debt/equity advisory, CRE investment trends" },
  { name: "Avison Young",         site: "avisonyoung.com",          focus: "CRE market reports, office/industrial/multifamily outlooks" },
  { name: "CoStar",               site: "costar.com",               focus: "CRE vacancy rates, pricing, transaction volume, market analytics" },
  { name: "NAIOP",                site: "naiop.org/research",       focus: "industrial, office, mixed-use development, CRE industry conditions" },
  { name: "Green Street",         site: "greenstreet.com",          focus: "REIT valuations, commercial property prices, cap rates, sector outlooks" },
  { name: "Walker & Dunlop",      site: "walkerdunlop.com",         focus: "multifamily lending, CRE debt markets, agency/CMBS originations" },
]

const TOPICS = [
  "Distressed/CMBS",
  "Capital Markets",
  "Office",
  "Multifamily",
  "Retail",
  "Industrial",
  "Market Outlook",
  "Florida/Southeast",
  "Banking/Lending",
  "Investment Sales",
]

function asStringArray(value: unknown, max = 5): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const cleaned = item.replace(/^\s*[-•]\s*/g, "").trim()
    if (!cleaned) continue
    out.push(cleaned)
    if (out.length >= max) break
  }
  return out
}

function normalizeReport(
  raw: unknown,
  publisherName: string,
  idx: number
): ResearchReport | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>

  const title = typeof r.title === "string" ? r.title.trim() : ""
  const publisher =
    typeof r.publisher === "string" && r.publisher.trim()
      ? r.publisher.trim()
      : publisherName
  const url = typeof r.url === "string" ? r.url.trim() : ""
  const summary = typeof r.summary === "string" ? r.summary.trim() : ""
  const topic =
    typeof r.topic === "string" && TOPICS.includes(r.topic.trim())
      ? r.topic.trim()
      : "Market Outlook"
  const publishedDate =
    typeof r.publishedDate === "string" ? r.publishedDate.trim() : ""
  const keyFindings = asStringArray(r.keyFindings, 5)

  if (!title) return null

  return {
    id: `${publisherName.toLowerCase().replace(/\s+/g, "-")}-${idx}-${title.slice(0, 16).replace(/\s+/g, "-").toLowerCase()}`,
    title,
    publisher,
    publishedDate,
    topic,
    summary,
    keyFindings,
    url,
  }
}

async function queryPublisher(
  apiKey: string,
  publisher: { name: string; site: string; focus: string }
): Promise<ResearchReport[]> {
  const prompt = `You are a CRE market intelligence analyst. Use your live web search to find the 1-2 most recent research reports, market outlooks, or data publications from ${publisher.name} (${publisher.site}).

Focus on: ${publisher.focus}

Prioritize publications from the past 90 days. Return only real, verifiable publications — do not fabricate.

Return ONLY valid JSON:
{
  "reports": [
    {
      "title": "exact report title",
      "publisher": "${publisher.name}",
      "publishedDate": "YYYY-MM-DD or YYYY-MM",
      "topic": "one of: Distressed/CMBS | Capital Markets | Office | Multifamily | Retail | Industrial | Market Outlook | Florida/Southeast | Banking/Lending | Investment Sales",
      "summary": "2-3 sentences describing the key findings",
      "keyFindings": ["specific data point 1", "specific data point 2", "specific data point 3"],
      "url": "https://direct-link-to-report"
    }
  ]
}`

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "Return ONLY valid JSON. Use live web search. Do not fabricate publications.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 1200,
      }),
      cache: "no-store",
    })

    if (!res.ok) return []

    const data = await res.json()
    const content: string = data?.choices?.[0]?.message?.content || ""
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return []

    const parsed = JSON.parse(match[0])
    const rawReports = Array.isArray(parsed?.reports) ? parsed.reports : []

    return rawReports
      .map((r: unknown, i: number) => normalizeReport(r, publisher.name, i))
      .filter((r): r is ResearchReport => r !== null)
  } catch {
    return []
  }
}

// Run publisher queries with controlled concurrency
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = []
  let idx = 0

  const worker = async () => {
    while (idx < tasks.length) {
      const i = idx++
      results[i] = await tasks[i]()
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000"

async function saveToArchive(reports: ResearchReport[]): Promise<void> {
  try {
    await fetch(`${BASE_URL}/api/research/feed-reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reports }),
      cache: "no-store",
    })
  } catch {
    // Non-critical — fresh results still show even if archive save fails
  }
}

async function loadArchive(): Promise<ArchivedReport[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/research/feed-reports`, {
      cache: "no-store",
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data?.reports) ? data.reports : []
  } catch {
    return []
  }
}

export async function fetchResearchFeed(): Promise<ResearchFeedResponse> {
  const notes: string[] = []
  const API_KEY = process.env.PERPLEXITY_API_KEY?.trim()

  if (!API_KEY) {
    return {
      reports: [],
      archive: [],
      generatedAt: new Date().toISOString(),
      notes: ["Missing PERPLEXITY_API_KEY"],
    }
  }

  // Run one query per publisher, 5 at a time to stay within rate limits
  const tasks = PUBLISHERS.map((pub) => () => queryPublisher(API_KEY, pub))
  const results = await runWithConcurrency(tasks, 5)
  const allReports = results.flat()

  // Deduplicate fresh results by title (case-insensitive)
  const seen = new Set<string>()
  const deduped: ResearchReport[] = []
  for (const r of allReports) {
    const key = r.title.toLowerCase().trim()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(r)
  }

  // Sort: Florida/Southeast first, then Distressed/CMBS, Capital Markets, Banking
  const topicPriority: Record<string, number> = {
    "Florida/Southeast": 0,
    "Distressed/CMBS":   1,
    "Capital Markets":   2,
    "Banking/Lending":   3,
  }
  deduped.sort((a, b) => (topicPriority[a.topic] ?? 9) - (topicPriority[b.topic] ?? 9))

  if (deduped.length === 0) {
    notes.push("No reports returned from any publisher.")
  }

  // Persist fresh results and load archive in parallel
  const [, archiveRaw] = await Promise.all([
    saveToArchive(deduped),
    loadArchive(),
  ])

  // Archive = stored reports NOT in the current fresh batch
  const freshKeys = new Set(deduped.map((r) => r.title.toLowerCase().trim()))
  const archive: ArchivedReport[] = archiveRaw.filter(
    (r) => !freshKeys.has(r.title.toLowerCase().trim())
  )

  return {
    reports: deduped,
    archive,
    generatedAt: new Date().toISOString(),
    notes,
  }
}
