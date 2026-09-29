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
import { MAX_ITEM_AGE_DAYS, dedupeByTitle, dropStaleItems, isStale } from "../lib/legal-updates-filter"
import { checkSourceUrl } from "../lib/legal-updates-sources"

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OPENAI_FAST_MODEL || "gpt-4.1-mini"
const SECTIONS: LegalSection[] = ["regulatory", "legislative", "enforcement"]

/**
 * Share of items so old the feed's own filter withholds them. Measured against the filter's
 * window, not the prompt's: an OCC order from four months ago is a real development that renders,
 * and scoring it as a failure only measures the gap between the two windows.
 */
const MAX_WITHHELD_RATIO = 0.4

/**
 * Share of raw items citing a URL that does not exist. The model builds these from real URL
 * patterns — `federalreserve.gov/newsevents/pressreleases/2026-press20260924a.htm` is the shape of
 * a genuine Fed release and is not one. Some of this is expected and the guard removes it; a lot
 * of it means the prompt has stopped working. Citing trade press instead is *not* counted here:
 * it is filtered too, but it is a real page and a different problem.
 */
const MAX_FABRICATED_RATIO = 0.5

if (!API_KEY) {
  console.error("OPENAI_API_KEY missing from .env.local")
  process.exit(1)
}

type Item = { title?: string; date?: string; source?: string; url?: string }

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
        // Mirrors collectSection in the action: one retry when nothing survives verification.
        let last = await querySection(section, now)
        for (let attempt = 0; attempt < 1; attempt++) {
          const verdicts = await Promise.all(last.items.map((i) => checkSourceUrl(i.url, section)))
          if (verdicts.some((v) => v === "ok")) break
          last = await querySection(section, now)
        }
        return { section, ...last }
      } catch (err) {
        return { section, items: [] as Item[], searchCount: 0, queries: [], error: String(err) }
      }
    })
  )

  let total = 0
  let fresh = 0
  let withheld = 0
  let sourced = 0
  let fabricated = 0

  for (const r of results) {
    console.log(`── ${r.section} ──  ${r.searchCount} search(es), ${r.items.length} item(s)`)
    if ((r as any).error) console.log(`   ERROR: ${(r as any).error}`)
    for (const q of r.queries) console.log(`   searched: "${String(q).slice(0, 96)}"`)

    const verdicts = await Promise.all(r.items.map((it) => checkSourceUrl(it.url, r.section)))
    r.items.forEach((it, i) => {
      const inWindow = (it.date ?? "") >= cutoff
      total += 1
      if (inWindow) fresh += 1
      if (isStale(it.date, now.getTime())) withheld += 1
      if (verdicts[i] === "ok") sourced += 1
      if (verdicts[i] === "dead") fabricated += 1
      console.log(
        `   [${inWindow ? "FRESH" : "STALE"}|${verdicts[i].toUpperCase().padEnd(7)}] ` +
          `${it.date ?? "(no date)"}  ${String(it.title).slice(0, 52)}`
      )
      if (verdicts[i] !== "ok") console.log(`             ${it.url ?? "(no url)"}`)
    })
    console.log()
  }

  // What the tab would actually render, all three gates included.
  const all = results.flatMap((r) =>
    r.items.map((i) => ({ ...i, title: i.title ?? "", section: r.section }))
  )
  const surviving = dropStaleItems(dedupeByTitle(all), now.getTime()).kept
  const verified = await Promise.all(surviving.map((i) => checkSourceUrl(i.url, i.section)))
  const rendered = surviving.filter((_, i) => verified[i] === "ok")

  const withheldRatio = total ? withheld / total : 0
  const fabricatedRatio = total ? fabricated / total : 0

  console.log(`${fresh}/${total} within the prompt's ${FRESHNESS_WINDOW_DAYS} days`)
  console.log(`${withheld}/${total} older than the filter's ${MAX_ITEM_AGE_DAYS} days (${(withheldRatio * 100).toFixed(0)}%)`)
  console.log(`${sourced}/${total} backed by a primary source that loads`)
  console.log(`${fabricated}/${total} cite a URL that does not exist (${(fabricatedRatio * 100).toFixed(0)}%)`)
  console.log(`${rendered.length} item(s) would render`)

  // The contract is not that the model behaves — it does not — but that nothing unverifiable
  // reaches the tab, and that something real still does.
  const leaked = (await Promise.all(rendered.map((i) => checkSourceUrl(i.url, i.section)))).filter(
    (v) => v !== "ok"
  ).length
  if (leaked > 0) {
    console.error(`\nFAIL: ${leaked} item(s) would render without a verifiable source. The guard is leaking.`)
    process.exit(1)
  }
  if (rendered.length === 0) {
    console.error(
      total === 0
        ? "\nFAIL: every section came back empty. The prompts are too strict, not the sources too thin."
        : "\nFAIL: nothing survived verification, so the tab would be empty."
    )
    process.exit(1)
  }
  if (fabricatedRatio > MAX_FABRICATED_RATIO) {
    console.error(
      `\nFAIL: ${(fabricatedRatio * 100).toFixed(0)}% of items cite a URL that does not exist, ` +
        `over the ${MAX_FABRICATED_RATIO * 100}% ceiling. The guard is holding, but the prompt has slipped.`
    )
    process.exit(1)
  }
  if (withheldRatio > MAX_WITHHELD_RATIO) {
    console.error(
      `\nFAIL: ${(withheldRatio * 100).toFixed(0)}% of items are older than the filter's window, ` +
        `over the ${MAX_WITHHELD_RATIO * 100}% ceiling. The prompts have drifted back towards history.`
    )
    process.exit(1)
  }
  console.log("\nPASS")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
