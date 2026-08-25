/**
 * Screenshots the department lenses and dumps their rendered text.
 *
 * Exists because every data-accuracy bug this tool has shipped passed both a
 * clean build and its unit tests, and was caught by reading rendered output.
 * Building is not verifying. Run this against a local dev server after touching
 * a lens, and read the numbers rather than skimming for a stack trace.
 *
 * Reads the password out of `.env.local` inside this process so it never passes
 * through a shell environment, a command line, or a process list.
 *
 *   npm run dev
 *   npm run verify:lenses              # both lenses
 *   SKIP_BRIEF=1 npm run verify:lenses # workbench only; the brief is slow cold
 *
 * Text goes to stdout, screenshots to /tmp/lens-shots.
 */

import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const BASE = process.env.BASE ?? "http://localhost:3000"
const OUT = "/tmp/lens-shots"
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

console.log("Signing in…")
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
await page.waitForTimeout(4000)
await page.locator('input[type="password"]').pressSequentially(password, { delay: 30 })
await page.locator('button[type="submit"]:not([disabled])').waitFor({ timeout: 30000 })
await page.click('button[type="submit"]')
await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 60000 })
console.log("Signed in.")

async function loadLens(department, cardHeading) {
  await page.evaluate(
    (d) => {
      document.cookie = `department=${d}; path=/; max-age=31536000`
    },
    department
  )
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })

  // The lens fetches nine quarters of FDIC data on a cold cache, which takes
  // the better part of a minute. Poll for real content rather than a skeleton.
  const card = page.locator("div").filter({ hasText: cardHeading }).last()
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText()
    if (text.includes(cardHeading)) {
      const stillLoading = await page.locator(".animate-pulse").count()
      if (!stillLoading) break
    }
    await page.waitForTimeout(2000)
  }
  return card
}

function section(title, body) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}\n${body}`)
}

// ---------------------------------------------------------------- Executive
if (!process.env.SKIP_BRIEF) {
  console.log("\nLoading Executive Brief (cold cache, be patient)…")
  await loadLens("executive", "What moved this quarter")
  await page.waitForTimeout(1500)
  const briefCard = page
    .locator("div.p-6")
    .filter({ hasText: "What moved this quarter" })
    .last()
  section("EXECUTIVE BRIEF", await briefCard.innerText())
  await briefCard.screenshot({ path: `${OUT}/01-executive-brief.png` })
}

// --------------------------------------------------------------- Workbench
console.log("\nLoading Underwriter Workbench…")
await loadLens("underwriting", "Underwriter workbench")
await page.waitForTimeout(1500)
const wbCard = page.locator("div.p-6").filter({ hasText: "Underwriter workbench" }).last()
section("WORKBENCH — EMPTY STATE", await wbCard.innerText())
await wbCard.screenshot({ path: `${OUT}/02-workbench-empty.png` })

async function pick(name) {
  const search = page.getByPlaceholder(/Search by institution name/)
  await search.fill("")
  await search.pressSequentially(name, { delay: 25 })
  await page.waitForTimeout(700)
  const option = page.locator("ul.absolute button").filter({ hasText: name }).first()
  if ((await option.count()) === 0) {
    console.log(`\n!! no exact dropdown match for "${name}"`)
    const opts = await page.locator("ul.absolute button").allInnerTexts()
    console.log("   options were:", JSON.stringify(opts))
    return false
  }
  await option.click()
  await page.waitForTimeout(900)
  return true
}

// OCEAN BANK is a risk-based filer with the thinnest CRE cushion in Florida;
// BANKPLUS is a large CBLR filer, exercising the leverage path.
for (const [i, name] of [["03", "OCEAN BANK"], ["04", "BANKPLUS"]]) {
  if (await pick(name)) {
    const card = page.locator("div.p-6").filter({ hasText: "Underwriter workbench" }).last()
    section(`WORKBENCH — ${name}`, await card.innerText())
    await card.screenshot({ path: `${OUT}/${i}-workbench-${name.toLowerCase().replace(/ /g, "-")}.png` })
  }
}

section("CONSOLE ERRORS", errors.length ? errors.join("\n") : "(none)")
console.log(`\nScreenshots in ${OUT}`)
await browser.close()
