/**
 * Runs the three Legal Landscape prompts against the live OpenAI API and reports how much of what
 * comes back is actually recent.
 *
 *   npm run verify:legal-freshness
 *
 * Exists because the failure it guards is invisible from the code: the model does not know today's
 * date, so a prompt asking for "the past 90 days" quietly returns rules from 2006. Run this after
 * touching `lib/legal-updates-prompts.ts`, and expect to run it more than once — the output is
 * probabilistic, and one good sample proves less than it looks.
 */

import { readFileSync } from "node:fs"

import {
  FRESHNESS_WINDOW_DAYS,
  buildSectionPrompt,
  type LegalSection,
} from "../lib/legal-updates-prompts"
import { dedupeByTitle, dropStaleItems } from "../lib/legal-updates-filter"

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OPENAI_FAST_MODEL || "gpt-4.1-mini"
const SECTIONS: LegalSection[] = ["regulatory", "legislative", "enforcement"]

/** Below this share of in-window items the prompts are not doing their job. */
const MIN_FRESH_RATIO = 0.6

if (!API_KEY) {
  console.error("OPENAI_API_KEY missing from .env.local")
  process.exit(1)
}

type Item = { title?: string; date?: string; source?: string }

async function querySection(section: LegalSection, now: Date) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_output_tokens: 1800,
      instructions:
        "Return ONLY valid JSON. Use your web search tool. Do not fabricate items — only include real, verifiable developments.",
      input: buildSectionPrompt(section, now),
      temperature: 0.1,
      tools: [{ type: "web_search" }],
    }),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)

  const data = (await res.json()) as any
  const searches = (data.output || []).filter((o: any) => o.type === "web_search_call")
  // output_text is a convenience field and is often absent; lib/openai.ts has the same fallback.
  const text: string =
    data.output_text ||
    (data.output || [])
      .filter((o: any) => o.type === "message")
      .flatMap((o: any) => o.content || [])
      .map((c: any) => c.text || "")
      .join("")

  let items: Item[] = []
  try {
    items = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}").items ?? []
  } catch {
    /* reported as zero items below */
  }

  return {
    items,
    searchCount: searches.length,
    queries: searches.flatMap((s: any) => s.action?.queries ?? [s.action?.query]).filter(Boolean),
  }
}

async function main() {
  const now = new Date()
  const cutoff = new Date(now.getTime() - FRESHNESS_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
  console.log(`model=${MODEL}  today=${now.toISOString().slice(0, 10)}  cutoff=${cutoff}\n`)

  const results = await Promise.all(
    SECTIONS.map(async (section) => {
      try {
        return { section, ...(await querySection(section, now)) }
      } catch (err) {
        return { section, items: [] as Item[], searchCount: 0, queries: [], error: String(err) }
      }
    })
  )

  let total = 0
  let fresh = 0

  for (const r of results) {
    console.log(`── ${r.section} ──  ${r.searchCount} search(es), ${r.items.length} item(s)`)
    if ((r as any).error) console.log(`   ERROR: ${(r as any).error}`)
    for (const q of r.queries) console.log(`   searched: "${String(q).slice(0, 96)}"`)
    for (const it of r.items) {
      const ok = (it.date ?? "") >= cutoff
      total += 1
      if (ok) fresh += 1
      console.log(`   [${ok ? "FRESH" : "STALE"}] ${it.date ?? "(no date)"}  ${String(it.title).slice(0, 60)}`)
    }
    console.log()
  }

  // What the tab would actually render, filter included.
  const all = results.flatMap((r) => r.items.map((i) => ({ ...i, title: i.title ?? "" })))
  const rendered = dropStaleItems(dedupeByTitle(all), now.getTime()).kept
  const ratio = total ? fresh / total : 0

  console.log(`${fresh}/${total} within ${FRESHNESS_WINDOW_DAYS} days (${(ratio * 100).toFixed(0)}%)`)
  console.log(`${rendered.length} item(s) would render after dedupe and the staleness filter`)

  if (rendered.length === 0) {
    console.error("\nFAIL: the tab would be empty.")
    process.exit(1)
  }
  if (ratio < MIN_FRESH_RATIO) {
    console.error(`\nFAIL: only ${(ratio * 100).toFixed(0)}% in-window, below the ${MIN_FRESH_RATIO * 100}% floor.`)
    process.exit(1)
  }
  console.log("\nPASS")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
