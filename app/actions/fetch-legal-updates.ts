"use server"

import { unstable_cache } from "next/cache"
import { MAX_ITEM_AGE_DAYS, dedupeByTitle, dropStaleItems } from "@/lib/legal-updates-filter"
import { buildSectionPrompt } from "@/lib/legal-updates-prompts"
import { keepVerifiableItems } from "@/lib/legal-updates-sources"
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

/**
 * A section's worth of items that survived source verification.
 *
 * Retried once when nothing survives, because the model's failure here is erratic rather than
 * steady: it will construct a plausible Federal Reserve press-release URL from the date format on
 * one attempt and cite the real page on the next. Verification always protects the reader, so the
 * only thing at stake is whether the section has anything in it, and one more call is cheap
 * against a feed that regenerates daily.
 */
async function collectSection(section: LegalItem["section"], now: Date) {
  let rejected: Awaited<ReturnType<typeof keepVerifiableItems<LegalItem>>>["rejected"] = []

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await querySection(section, now)
    if (raw.length === 0) continue

    const verified = await keepVerifiableItems(raw)
    rejected = verified.rejected
    if (verified.kept.length > 0) return { kept: verified.kept, rejected }
  }

  return { kept: [] as LegalItem[], rejected }
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

  const collected = await Promise.all(
    (["regulatory", "legislative", "enforcement"] as const).map((s) => collectSection(s, now))
  )

  const deduped = dedupeByTitle(collected.flatMap((c) => c.kept))
  const { kept: allItems, dropped: stale } = dropStaleItems(deduped, now.getTime())
  const rejected = collected.flatMap((c) => c.rejected)

  // An emptied section disappears from the tab entirely, so say why rather than let it look broken.
  for (const section of ["regulatory", "legislative", "enforcement"] as const) {
    if (allItems.some((i) => i.section === section)) continue
    const staleHere = stale.filter((i) => i.section === section).length
    const unverifiedHere = rejected.filter((r) => r.item.section === section).length
    if (staleHere + unverifiedHere === 0) continue
    notes.push(
      `${SECTION_LABELS[section]}: nothing to report. ` +
        (staleHere ? `${staleHere} item${staleHere === 1 ? "" : "s"} older than ${MAX_ITEM_AGE_DAYS} days. ` : "") +
        (unverifiedHere
          ? `${unverifiedHere} item${unverifiedHere === 1 ? "" : "s"} withheld for lacking a verifiable primary source.`
          : "")
    )
  }

  if (deduped.length === 0) {
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
    ["legal-updates-v6", day],
    // 25h so the entry outlives the day and never expires just before the cron.
    { revalidate: 90000 }
  )()
}
