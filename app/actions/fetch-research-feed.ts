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

export type ResearchFeedResponse = {
  reports: ResearchReport[]
  generatedAt: string
  notes: string[]
}

function asStringArray(value: unknown, max = 6): string[] {
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

function normalizeReport(raw: unknown, idx: number): ResearchReport | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>

  const title = typeof r.title === "string" ? r.title.trim() : ""
  const publisher = typeof r.publisher === "string" ? r.publisher.trim() : "Unknown"
  const url = typeof r.url === "string" ? r.url.trim() : ""
  const summary = typeof r.summary === "string" ? r.summary.trim() : ""
  const topic = typeof r.topic === "string" ? r.topic.trim() : "Market Research"
  const publishedDate = typeof r.publishedDate === "string" ? r.publishedDate.trim() : ""
  const keyFindings = asStringArray(r.keyFindings, 5)

  if (!title) return null

  return {
    id: `report-${idx}-${title.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`,
    title,
    publisher,
    publishedDate,
    topic,
    summary,
    keyFindings,
    url,
  }
}

export async function fetchResearchFeed(): Promise<ResearchFeedResponse> {
  const notes: string[] = []
  const API_KEY = process.env.PERPLEXITY_API_KEY?.trim()

  if (!API_KEY) {
    return { reports: [], generatedAt: new Date().toISOString(), notes: ["Missing PERPLEXITY_API_KEY"] }
  }

  const prompt = `You are a commercial real estate research analyst. Use your live web search to find the most recent research reports, market outlooks, and data publications from the following firms and organizations:

PUBLISHERS TO SEARCH:
- CBRE (cbre.com/insights)
- JLL (jll.com/trends-and-insights)
- Cushman & Wakefield (cushmanwakefield.com/insights)
- Colliers (colliers.com/insights)
- Trepp (trepp.com/research)
- Mortgage Bankers Association / MBA (mba.org/commercial)
- Moody's Analytics CRE
- Fitch Ratings (CRE/CMBS)
- MSCI Real Assets
- Marcus & Millichap (marcusmillichap.com/research)
- NAIOP (naiop.org/research)
- Urban Land Institute / ULI (uli.org/research)
- CoStar (costar.com/resources)
- Newmark (nmrk.com/research)

FOCUS AREAS (prioritize in this order):
1. Distressed CRE debt, special servicing, loan workouts, note sales
2. CMBS delinquency rates, maturity walls, refinancing stress
3. Capital markets conditions, lending standards, private credit
4. Regional bank CRE exposure and stress
5. Florida and Miami commercial real estate market conditions
6. Office, multifamily, retail, industrial market outlooks
7. Investment sales volume, cap rates, pricing trends

Find 12-16 recent publications (past 90 days preferred). For each report return:
- Exact title
- Publisher name (use the short name: CBRE, JLL, Trepp, etc.)
- Published date (YYYY-MM-DD format or approximate month/year)
- Topic category (one of: Distressed/CMBS, Capital Markets, Office, Multifamily, Retail, Industrial, Market Outlook, Florida/Southeast, Banking/Lending, Investment Sales)
- 2-3 sentence summary of the key findings
- 3-5 specific data points or key findings as bullet items (include numbers, percentages, dollar amounts where available)
- Direct URL to the report or report page

Return ONLY valid JSON:
{
  "reports": [
    {
      "title": "...",
      "publisher": "...",
      "publishedDate": "YYYY-MM-DD",
      "topic": "...",
      "summary": "...",
      "keyFindings": ["...", "...", "..."],
      "url": "https://..."
    }
  ]
}`

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content: "Return ONLY valid JSON. Use live web search to find real, current research publications. Do not fabricate reports.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 3000,
      }),
      cache: "no-store",
    })

    if (!res.ok) {
      notes.push(`Perplexity error: ${res.status}`)
      return { reports: [], generatedAt: new Date().toISOString(), notes }
    }

    const data = await res.json()
    const content: string = data?.choices?.[0]?.message?.content || ""

    const match = content.match(/\{[\s\S]*\}/)
    if (!match) {
      notes.push("No JSON found in response")
      return { reports: [], generatedAt: new Date().toISOString(), notes }
    }

    const parsed = JSON.parse(match[0])
    const rawReports = Array.isArray(parsed?.reports) ? parsed.reports : []

    const reports: ResearchReport[] = rawReports
      .map((r: unknown, i: number) => normalizeReport(r, i))
      .filter((r): r is ResearchReport => r !== null)

    return {
      reports,
      generatedAt: new Date().toISOString(),
      notes,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    notes.push(`Feed generation failed: ${message}`)
    return { reports: [], generatedAt: new Date().toISOString(), notes }
  }
}
