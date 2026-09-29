"use server"

import { unstable_cache } from "next/cache"
import { dedupeByTitle, dropStaleItems } from "@/lib/legal-updates-filter"
import { buildSectionPrompt } from "@/lib/legal-updates-prompts"
import { partitionByRelevance } from "@/lib/legal-updates-relevance"
import {
  LEGAL_SECTIONS,
  SECTION_LABELS,
  type LegalSection,
  windowFor,
} from "@/lib/legal-updates-sections"
import { keepVerifiableItems } from "@/lib/legal-updates-sources"
import { newsCalendarDayET } from "@/lib/news-tab-cache"
import { callOpenAiJson, getOpenAiApiKey } from "@/lib/openai"

export type LegalItem = {
  id: string
  section: LegalSection
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
  /** Feed-wide problems: a missing key, a dead API. Rendered at the top of the tab. */
  notes: string[]
  /**
   * Why a section has nothing in it, keyed by section. Held apart from `notes` so the tab can say
   * it in place — a section with no items is not rendered, so a note at the top was the only sign
   * anything had happened, and it read like an error rather than an answer.
   */
  sectionNotes: Partial<Record<LegalSection, string>>
}

// ── OpenAI fetch ───────────────────────────────────────────────────────────────

async function querySection(section: LegalSection, now: Date): Promise<LegalItem[]> {
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
type SectionResult = {
  section: LegalSection
  kept: LegalItem[]
  /** Counts behind an empty section, so it can explain itself rather than simply vanishing. */
  discarded: { stale: number; unverified: number; offTopic: number }
}

async function collectSection(section: LegalSection, now: Date): Promise<SectionResult> {
  const discarded = { stale: 0, unverified: 0, offTopic: 0 }
  const { filterDays } = windowFor(section)

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await querySection(section, now)
    if (raw.length === 0) continue

    // Cheapest checks first: date and topic are local, source verification costs a fetch each.
    const dated = dropStaleItems(raw, now.getTime(), filterDays)
    const topical = partitionByRelevance(dated.kept)
    const verified = await keepVerifiableItems(topical.relevant)

    discarded.stale += dated.dropped.length
    discarded.offTopic += topical.irrelevant.length
    discarded.unverified += verified.rejected.length

    if (verified.kept.length > 0) return { section, kept: verified.kept, discarded }
  }

  return { section, kept: [], discarded }
}

/** Reads as an answer rather than an error, because most of the time it is one. */
function describeEmptySection(result: SectionResult): string | undefined {
  const { stale, unverified, offTopic } = result.discarded
  const { filterDays } = windowFor(result.section)

  if (stale + unverified + offTopic === 0) {
    return `No qualifying developments in the last ${filterDays} days.`
  }

  const reasons: string[] = []
  if (stale) reasons.push(`${stale} older than ${filterDays} days`)
  if (offTopic) reasons.push(`${offTopic} without a clear bearing on commercial real estate`)
  if (unverified) reasons.push(`${unverified} without a verifiable primary source`)

  return `Nothing to report. Candidates were set aside: ${reasons.join("; ")}.`
}

// ── Main export ────────────────────────────────────────────────────────────────

async function fetchLegalUpdatesImpl(): Promise<LegalUpdatesResponse> {
  const notes: string[] = []

  if (!getOpenAiApiKey()) {
    return {
      items: [],
      generatedAt: new Date().toISOString(),
      notes: ["Missing OPENAI_API_KEY — legal intelligence feed unavailable."],
      sectionNotes: {},
    }
  }

  // One clock for the prompts and the filter, so they cannot disagree about what "recent" means.
  const now = new Date()

  const collected = await Promise.all(LEGAL_SECTIONS.map((s) => collectSection(s, now)))

  // Dedupe last and across sections, so one development cannot occupy two of them.
  const allItems = dedupeByTitle(collected.flatMap((c) => c.kept))

  const sectionNotes: Partial<Record<LegalSection, string>> = {}
  for (const result of collected) {
    if (allItems.some((i) => i.section === result.section)) continue
    sectionNotes[result.section] = describeEmptySection(result)
  }

  if (allItems.length === 0 && collected.every((c) => c.discarded.stale + c.discarded.unverified + c.discarded.offTopic === 0)) {
    notes.push("No legal intelligence items returned. Check OpenAI API key and quota.")
  }

  return {
    items: allItems,
    generatedAt: new Date().toISOString(),
    notes,
    sectionNotes,
  }
}

export async function fetchLegalUpdates(): Promise<LegalUpdatesResponse> {
  const day = newsCalendarDayET()
  return unstable_cache(
    async () => fetchLegalUpdatesImpl(),
    ["legal-updates-v7", day],
    // 25h so the entry outlives the day and never expires just before the cron.
    { revalidate: 90000 }
  )()
}
