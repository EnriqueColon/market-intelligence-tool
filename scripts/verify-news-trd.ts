/**
 * The Real Deal subscriber source against the live API.
 *
 *   npm run verify:news-trd
 *
 * Runs the two queries the daily build runs, ranks the posts exactly as the action does, and
 * prints each request's status and count, the exclusion counts, and the five picks with their
 * score and every rule that produced it. Fails if any request was refused — a 403 here means
 * Cloudflare no longer accepts the user agent — or if fewer than five posts qualified, which
 * would mean the week's window or the taxonomy ids have moved.
 *
 * Run from a laptop. It says nothing about Vercel's egress; that is read from the warm-cache
 * cron's `subscriber_sources: trd` log line after a deploy.
 */

import { selectTrdTop } from "../lib/news/trd"
import { fetchTrdPosts } from "../app/services/trd"

async function main() {
  const now = new Date()
  const t = Date.now()
  const result = await fetchTrdPosts(now)
  console.log(`since ${result.since}, ${result.posts.length} distinct posts in ${Date.now() - t} ms\n`)
  let failed = false
  for (const r of result.requests) {
    console.log(`  ${r.name.padEnd(18)} status ${String(r.status ?? "none").padEnd(5)} ${String(r.count).padStart(3)} posts ${String(r.ms).padStart(5)} ms${r.error ? `  FAILED ${r.error}` : ""}`)
    if (r.error) failed = true
  }

  const sel = selectTrdTop(result.posts, { now })
  console.log(`\ncandidates ${sel.candidates}, excluded ${JSON.stringify(sel.excluded)}\n`)
  sel.picks.forEach((p, i) => {
    console.log(`${i + 1}. [${p.score}] ${p.title}`)
    console.log(`   ${p.date}  ${p.topic}  ${p.region}  ${p.storyType}  sectors=${p.sectors.join(",")}  markets=${p.markets.join(",")}`)
    console.log(`   ${p.url}`)
    for (const r of p.reasons) console.log(`   - ${r}`)
    if (p.snippet) console.log(`   "${p.snippet.slice(0, 160)}${p.snippet.length > 160 ? "…" : ""}"`)
  })

  if (failed) {
    console.error("\nFAILED: a request was refused")
    process.exit(1)
  }
  if (sel.picks.length < 5) {
    console.error(`\nFAILED: only ${sel.picks.length} posts qualified`)
    process.exit(1)
  }
  console.log("\nOK")
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err)
  process.exit(1)
})
