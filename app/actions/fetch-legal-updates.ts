"use server"

import { unstable_cache } from "next/cache"
import { MAX_ITEM_AGE_DAYS, dedupeByTitle, dropStaleItems } from "@/lib/legal-updates-filter"
import { buildSectionPrompt } from "@/lib/legal-updates-prompts"
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

const SECTION_LABELS: Record<LegalItem["section"], string> = {
  regulatory: "Regulatory Watch",
  legislative: "Legislative Tracker",
  enforcement: "Enforcement & Litigation",
}

// ── OpenAI fetch ───────────────────────────────────────────────────────────────

async function querySection(
  section: "regulatory" | "legislative" | "enforcement",
  now: Date
): Promise<LegalItem[]> {
  try {
    const parsed = await callOpenAiJson({
      system:
        "Return ONLY valid JSON. Use your web search tool. Do not fabricate items — only include real, verifiable developments.",
      user: buildSectionPrompt(section, now),
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

  // One clock for the prompts and the filter, so they cannot disagree about what "recent" means.
  const now = new Date()

  // Run all three section queries in parallel
  const [regulatory, legislative, enforcement] = await Promise.all([
    querySection("regulatory", now),
    querySection("legislative", now),
    querySection("enforcement", now),
  ])

  const deduped = dedupeByTitle([...regulatory, ...legislative, ...enforcement])
  const { kept: allItems, dropped } = dropStaleItems(deduped, now.getTime())

  // An emptied section disappears from the tab entirely, so say why rather than let it look broken.
  for (const section of ["regulatory", "legislative", "enforcement"] as const) {
    const droppedHere = dropped.filter((i) => i.section === section).length
    if (droppedHere === 0) continue
    if (allItems.some((i) => i.section === section)) continue
    notes.push(
      `${SECTION_LABELS[section]}: no developments in the last ${MAX_ITEM_AGE_DAYS} days. ` +
        `${droppedHere} older item${droppedHere === 1 ? " was" : "s were"} withheld.`
    )
  }

  if (allItems.length === 0 && dropped.length === 0) {
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
    ["legal-updates-v5", day],
    // 25h so the entry outlives the day and never expires just before the cron.
    { revalidate: 90000 }
  )()
}
