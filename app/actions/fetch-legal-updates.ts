"use server"

import { unstable_cache } from "next/cache"
import { newsCalendarDayET } from "@/lib/news-tab-cache"
import { callOpenAiJson, getOpenAiApiKey } from "@/lib/openai"

export type LegalItem = {
  id: string
  section: "regulatory" | "legislative" | "enforcement"
  title: string
  source: string
  date: string
  jurisdiction: "Federal" | "Florida" | "Multi-State"
  summary: string
  whyItMatters: string
  status?: string
  url?: string
}

export type LegalUpdatesResponse = {
  items: LegalItem[]
  generatedAt: string
  notes: string[]
}

// ── Claude query per section ───────────────────────────────────────────────────

const SECTION_PROMPTS: Record<
  "regulatory" | "legislative" | "enforcement",
  string
> = {
  regulatory: `You are a CRE regulatory intelligence analyst. Use live web search to find the 4-5 most recent regulatory developments (past 90 days) from agencies including OCC, FDIC, Federal Reserve, CFPB, HUD, or Florida OFR that directly affect commercial real estate lending, CRE loan servicing, foreclosure processes, bank CRE concentration limits, or CMBS/securitization rules.

For each item include:
- The exact rule/guidance title
- Issuing agency (source)
- Publication or effective date
- Whether it is Federal or Florida jurisdiction
- A 2-3 sentence plain-English summary of what it changes
- A 1-2 sentence "Why it matters" specifically for a distressed CRE debt investor (note sales, workouts, foreclosures, REO)
- Direct URL to the rule or announcement if available
- Status: Proposed Rule, Final Rule, Guidance, or Notice

Return ONLY valid JSON:
{
  "items": [
    {
      "title": "exact rule or guidance title",
      "source": "agency name",
      "date": "YYYY-MM-DD",
      "jurisdiction": "Federal or Florida",
      "summary": "2-3 sentence plain-English summary",
      "whyItMatters": "1-2 sentences on relevance to distressed CRE debt investing",
      "status": "Proposed Rule | Final Rule | Guidance | Notice",
      "url": "https://..."
    }
  ]
}`,

  legislative: `You are a CRE legislative intelligence analyst. Use live web search to find the 4-5 most recent (past 90 days) Florida state bills or U.S. federal bills with active legislative movement that affect commercial real estate, mortgage lending, foreclosure law, property rights, landlord/tenant regulations, property tax assessments, or CRE-related banking regulations.

Prioritize bills that have passed a committee, received a floor vote, or been signed into law. Skip bills with no movement.

For each item include:
- The official bill title and bill number
- Legislative body (e.g., Florida Senate, U.S. House)
- Most recent action date
- Whether it is Federal or Florida jurisdiction
- A 2-3 sentence plain-English summary of what the bill does
- A 1-2 sentence "Why it matters" for a distressed CRE debt investor
- Direct URL to the bill text or tracker
- Status: e.g., "Passed Senate Committee", "Signed into Law", "Awaiting Floor Vote"

Return ONLY valid JSON:
{
  "items": [
    {
      "title": "full bill title",
      "source": "bill number + legislative body (e.g. SB 1234 — Florida Senate)",
      "date": "YYYY-MM-DD",
      "jurisdiction": "Federal or Florida",
      "summary": "2-3 sentence plain-English summary",
      "whyItMatters": "1-2 sentences on relevance to distressed CRE debt investing",
      "status": "current legislative status",
      "url": "https://..."
    }
  ]
}`,

  enforcement: `You are a CRE enforcement and litigation intelligence analyst. Use live web search to find the 4-5 most recent (past 90 days) high-impact developments in any of these categories:
1. FDIC enforcement actions or consent orders against banks with significant CRE loan exposure
2. OCC enforcement actions related to CRE lending practices
3. Major commercial real estate Chapter 11 bankruptcy filings (assets > $50M)
4. Court-appointed receiverships on large CRE assets in Florida or nationally
5. High-profile lender liability or foreclosure litigation with broad market implications

For each item include:
- Descriptive title (institution name + action type, or property/borrower + filing type)
- Source (FDIC, OCC, court, etc.)
- Date of action or filing
- Whether it is Federal or Florida (or Multi-State)
- A 2-3 sentence summary of what happened and who is involved
- A 1-2 sentence "Why it matters" for a distressed CRE debt investor looking for note sale or acquisition opportunities
- Direct URL to the enforcement action, court filing, or press release if available
- Status: e.g., "Consent Order Issued", "Chapter 11 Filed", "Receivership Appointed", "Settled"

Return ONLY valid JSON:
{
  "items": [
    {
      "title": "descriptive title",
      "source": "FDIC | OCC | U.S. Bankruptcy Court | etc.",
      "date": "YYYY-MM-DD",
      "jurisdiction": "Federal or Florida or Multi-State",
      "summary": "2-3 sentence summary",
      "whyItMatters": "1-2 sentences on relevance to distressed CRE debt investing",
      "status": "action status",
      "url": "https://..."
    }
  ]
}`,
}

// ── OpenAI fetch ───────────────────────────────────────────────────────────────

async function querySection(
  section: "regulatory" | "legislative" | "enforcement"
): Promise<LegalItem[]> {
  try {
    const parsed = await callOpenAiJson({
      system:
        "Return ONLY valid JSON. Use your web search tool. Do not fabricate items — only include real, verifiable developments.",
      user: SECTION_PROMPTS[section],
      tier: "fast",
      temperature: 0.1,
      maxTokens: 1800,
      webSearch: true,
    })
    if (!parsed) return []

    const rawItems = Array.isArray(parsed?.items) ? parsed.items : []

    return rawItems
      .filter(
        (item: Record<string, unknown>) =>
          item && typeof item.title === "string" && item.title.trim()
      )
      .map((item: Record<string, unknown>, idx: number) => ({
        id: `${section}-${idx}-${String(item.title).slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`,
        section,
        title: String(item.title).trim(),
        source: typeof item.source === "string" ? item.source.trim() : "",
        date: typeof item.date === "string" ? item.date.trim() : "",
        jurisdiction: (["Federal", "Florida", "Multi-State"].includes(
          String(item.jurisdiction)
        )
          ? item.jurisdiction
          : "Federal") as LegalItem["jurisdiction"],
        summary: typeof item.summary === "string" ? item.summary.trim() : "",
        whyItMatters:
          typeof item.whyItMatters === "string"
            ? item.whyItMatters.trim()
            : "",
        status: typeof item.status === "string" ? item.status.trim() : undefined,
        url: typeof item.url === "string" ? item.url.trim() : undefined,
      }))
  } catch {
    return []
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

async function fetchLegalUpdatesImpl(): Promise<LegalUpdatesResponse> {
  const notes: string[] = []

  if (!getOpenAiApiKey()) {
    return {
      items: [],
      generatedAt: new Date().toISOString(),
      notes: ["Missing OPENAI_API_KEY — legal intelligence feed unavailable."],
    }
  }

  // Run all three section queries in parallel
  const [regulatory, legislative, enforcement] = await Promise.all([
    querySection("regulatory"),
    querySection("legislative"),
    querySection("enforcement"),
  ])

  const allItems = [...regulatory, ...legislative, ...enforcement]

  if (allItems.length === 0) {
    notes.push("No legal intelligence items returned. Check OpenAI API key and quota.")
  }

  return {
    items: allItems,
    generatedAt: new Date().toISOString(),
    notes,
  }
}

export async function fetchLegalUpdates(): Promise<LegalUpdatesResponse> {
  const day = newsCalendarDayET()
  return unstable_cache(
    async () => fetchLegalUpdatesImpl(),
    ["legal-updates-v2", day],
    // 25h so the entry outlives the day and never expires just before the cron.
    { revalidate: 90000 }
  )()
}
