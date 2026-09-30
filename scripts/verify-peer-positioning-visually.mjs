/**
 * Opens the institution drawer and reads the Peer Positioning block back.
 *
 * The matched-cohort change is exactly the kind that passes a build, passes unit tests, passes a
 * live-data script, and still renders wrongly — a null percentile formatted as "0th", a cohort
 * sentence that does not correspond to the numbers above it. Every data-accuracy bug this tool has
 * shipped survived the first three checks. So this one reads the rendered text.
 *
 * Uses Playwright directly rather than the editor's browser tool, which cannot reach localhost in
 * this environment.
 *
 * Reads the password out of `.env.local` inside this process so it never passes through a shell
 * environment, a command line, or a process list.
 *
 *   npm start -- --port 3100
 *   BASE=http://localhost:3100 npm run verify:peer-positioning
 *
 * Text goes to stdout, screenshots to /tmp/peer-shots.
 */

import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const BASE = process.env.BASE ?? "http://localhost:3000"
const OUT = "/tmp/peer-shots"
mkdirSync(OUT, { recursive: true })

const env = readFileSync(".env.local", "utf8")
const password = env.match(/^APP_PASSWORD=(.*)$/m)?.[1]?.trim()
if (!password) throw new Error("APP_PASSWORD not found in .env.local")

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const page = await context.newPage()

const errors = []
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text())
})
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
// A script that 404s is served the HTML error page, which then fails to parse as JavaScript and
// surfaces only as "Unexpected token '<'" with no indication of what was missing. Naming the
// request turns that into something diagnosable.
page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()} — ${r.failure()?.errorText}`))
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`)
})

console.log("Signing in…")
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
await page.waitForTimeout(3000)
await page.locator('input[type="password"]').pressSequentially(password, { delay: 20 })
await page.locator('button[type="submit"]:not([disabled])').waitFor({ timeout: 30000 })
await page.click('button[type="submit"]')
await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 60000 })

console.log("Opening Market Analytics…")
await page.getByRole("tab", { name: "Market Analytics" }).click()

// The screening table fetches nine quarters on a cold cache. Poll for real rows rather than a
// skeleton, and fail loudly rather than clicking into an empty table.
const deadline = Date.now() + 180000
let rowCount = 0
while (Date.now() < deadline) {
  rowCount = await page.locator("tbody tr.cursor-pointer").count()
  if (rowCount > 0 && (await page.locator(".animate-pulse").count()) === 0) break
  await page.waitForTimeout(2000)
}
if (rowCount === 0) throw new Error("No institution rows appeared; cannot open the drawer.")
console.log(`${rowCount} institutions in the table.`)

async function inspect(index, label) {
  await page.locator("tbody tr.cursor-pointer").nth(index).click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ timeout: 30000 })
  await page.waitForTimeout(1200)

  // Headings are uppercased by CSS, and `innerText` returns the transformed text, so this has to
  // be case-insensitive. It silently "found nothing" on the first run for exactly that reason.
  const text = await dialog.innerText()
  const start = text.search(/peer positioning/i)
  if (start === -1) throw new Error(`${label}: no Peer Positioning section rendered at all`)

  // The cohort line and the four metric rows sit apart in the compare layout, so report the
  // peer-relevant lines rather than a fixed slice.
  const relevant = text
    .split("\n")
    .filter((l) =>
      /peer|cohort|percentile|comparable|CRE \/ Assets|NPL Ratio|Net Income|NIM|matched/i.test(l)
    )
    .join("\n")

  console.log(`\n${"=".repeat(72)}\n${label}\n${"=".repeat(72)}\n${relevant}`)
  await dialog.screenshot({ path: `${OUT}/${index}-${label.replace(/\W+/g, "-")}.png`, fullPage: false })

  // Failure modes that would survive the build, the unit tests and the live-data script.
  if (/\b0th percentile\b/i.test(relevant) && /fewer than/i.test(relevant)) {
    throw new Error(`${label}: a withheld percentile rendered as "0th" instead of "—"`)
  }
  if (/percentile/i.test(relevant) && !/(comparable institution|peers? —|matched peers)/i.test(relevant)) {
    throw new Error(`${label}: percentiles rendered with no cohort stated`)
  }
  if (/\bNaN\b|undefined/i.test(relevant)) {
    throw new Error(`${label}: a missing figure leaked into the rendered output`)
  }

  await page.keyboard.press("Escape")
  await page.waitForTimeout(600)
}

// First row is the largest institution in the scope, last is among the smallest — the two ends
// where the cohort behaves differently.
await inspect(0, "largest in scope")
await inspect(rowCount - 1, "smallest in scope")

if (errors.length) {
  console.log(`\n${errors.length} console error(s):`)
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`)
}

console.log(`\nScreenshots in ${OUT}`)
await browser.close()
