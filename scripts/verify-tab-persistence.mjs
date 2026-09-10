/**
 * Verifies that switching tabs does not refetch data.
 *
 * Radix unmounts inactive tab panels by default, so leaving Market Analytics
 * and returning used to destroy its state and refire every data effect — the
 * screening payload, the chart series and the map all reloaded, and the region
 * filter, sort order and selected institution reset. Visited panels now stay
 * mounted, which is easy to regress by dropping `forceMount` or the
 * `data-[state=inactive]:hidden` class that has to accompany it.
 *
 * Three things are checked, because the fix can fail in three different ways:
 *   1. no server actions fire when returning to a tab (the actual goal);
 *   2. exactly one top-level panel is visible at a time — `forceMount` makes
 *      Radix stop setting `hidden`, so without the class every visited tab
 *      would render stacked on top of the others;
 *   3. the map still renders after a round trip, since hiding its container
 *      with `display: none` collapses it to 0x0 and MapLibre caches dimensions.
 *
 * Needs the app running, with tabs switched on. `npm start` sets
 * NODE_ENV=production, which makes the feature flags fail closed, so
 * ENABLED_TABS has to be passed explicitly or the dashboard renders no tabs:
 *
 *   npm run build
 *   ENABLED_TABS="news,market-analytics,market-research,legal,bank-stress-map" \
 *     npm start -- --port 3100
 *   BASE_URL=http://localhost:3100 node scripts/verify-tab-persistence.mjs
 */
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3100"

function appPassword() {
  if (process.env.APP_PASSWORD) return process.env.APP_PASSWORD
  const line = readFileSync(".env.local", "utf8")
    .split("\n")
    .find((l) => l.startsWith("APP_PASSWORD="))
  if (!line) throw new Error("APP_PASSWORD not found in environment or .env.local")
  return line.slice("APP_PASSWORD=".length).trim().replace(/^["']|["']$/g, "")
}

let failures = 0
const fail = (msg) => {
  console.log(`  FAIL ${msg}`)
  failures++
}
const ok = (msg) => console.log(`  ok   ${msg}`)

/** Server actions are POSTs carrying a next-action header. */
function trackServerActions(page) {
  const calls = []
  page.on("request", (req) => {
    if (req.method() !== "POST") return
    if (req.headers()["next-action"]) calls.push(req.url())
  })
  return calls
}

/**
 * Visible panels belonging to the *top-level* tab bar only.
 *
 * Market Research nests its own Tabs (URL / Upload / Paste), so a bare
 * `[role="tabpanel"]` query counts those too and the one-visible-panel
 * assertion stops meaning anything. Walking up from the first tablist to its
 * parent and taking only its direct panel children scopes this correctly.
 */
async function visiblePanels(page) {
  return page.evaluate(() => {
    const list = document.querySelector('[role="tablist"]')
    if (!list?.parentElement) return []
    return Array.from(list.parentElement.children)
      .filter((el) => el.getAttribute("role") === "tabpanel")
      .filter((el) => !el.hasAttribute("hidden") && getComputedStyle(el).display !== "none")
      .map((el) => el.getAttribute("id") || "(unnamed)")
  })
}

/** The top-level tab bar, so nested Market Research tabs are never clicked. */
const topTab = (page, name) =>
  page.locator('[role="tablist"]').first().locator('[role="tab"]', { hasText: name })

/** Rows in the analytics panel specifically, not any table anywhere on the page. */
const analyticsRows = (page) =>
  page
    .locator('[role="tabpanel"]')
    .filter({ hasText: "Target Screening List" })
    .first()
    .locator("table tbody tr")

async function waitForRows(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await analyticsRows(page).count()) > 0) return
    await page.waitForTimeout(1000)
  }
  throw new Error(`no screening rows after ${timeoutMs}ms`)
}

async function main() {
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

  try {
    console.log(`\n1. signing in at ${BASE_URL}`)
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" })
    const field = page.locator('input[type="password"]')
    await field.waitFor({ timeout: 30000 })
    await field.fill(appPassword())
    // The button is disabled until the field has a value, so it can only be
    // waited on after filling — and waiting is still necessary, because before
    // hydration the click is silently dropped.
    await page.locator('button[type="submit"]:not([disabled])').waitFor({ timeout: 30000 })
    await page.locator('button[type="submit"]').click()
    try {
      await page.waitForSelector('[role="tablist"]', { timeout: 60000 })
    } catch {
      // Without this the failure is just a selector timeout, which says nothing
      // about whether sign-in failed, the redirect stalled, or every tab is
      // gated off — three very different problems.
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300)
      await page.screenshot({ path: "/tmp/tab-persistence-failure.png" })
      throw new Error(
        `never reached the dashboard.\n  url: ${page.url()}\n  page text: ${body}\n` +
          `  screenshot: /tmp/tab-persistence-failure.png`
      )
    }
    ok("signed in")

    const tabs = await page
      .locator('[role="tablist"]')
      .first()
      .locator('[role="tab"]')
      .allInnerTexts()
    console.log(`   top-level tabs: ${tabs.map((t) => t.trim()).join(" | ")}`)

    console.log("\n2. opening Market Analytics and letting it settle")
    await topTab(page, /Market Analytics/i).click()
    // Wait on real content rather than a timer, so the comparison below is
    // against a genuinely settled tab.
    await waitForRows(page, 180000)
    await page.waitForTimeout(3000)
    ok(`analytics loaded with ${await analyticsRows(page).count()} table rows`)

    let panels = await visiblePanels(page)
    if (panels.length !== 1) fail(`expected 1 visible panel, saw ${panels.length}: ${panels.join(", ")}`)
    else ok("exactly one panel visible")

    // Scroll the charts into view so the deferred visuals panel actually
    // fetches; otherwise the round trip below proves nothing about it.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
    await page.waitForTimeout(8000)

    console.log("\n3. switching away and back, counting server actions")
    const calls = trackServerActions(page)

    const otherTab = page.locator('[role="tablist"]').first().locator('[role="tab"]').first()
    const otherName = (await otherTab.innerText()).trim()
    await otherTab.click()
    await page.waitForTimeout(2500)

    panels = await visiblePanels(page)
    if (panels.length !== 1) fail(`after switching to ${otherName}: ${panels.length} panels visible`)
    else ok(`switched to ${otherName}, still one panel visible`)

    await topTab(page, /Market Analytics/i).click()
    await page.waitForTimeout(5000)

    // The table must be there immediately — no skeleton, no refetch.
    const rows = await analyticsRows(page).count()
    if (rows === 0) fail("returned to analytics and the table was empty — state was lost")
    else ok(`returned to analytics with ${rows} table rows still rendered`)

    if (calls.length > 0) {
      fail(`${calls.length} server action(s) fired on the round trip — data was refetched`)
    } else {
      ok("zero server actions fired on the round trip")
    }

    panels = await visiblePanels(page)
    if (panels.length !== 1) fail(`back on analytics: ${panels.length} panels visible: ${panels.join(", ")}`)
    else ok("exactly one panel visible after returning")

    console.log("\n4. map survived the round trip")
    const canvas = page.locator("canvas.maplibregl-canvas").first()
    if ((await canvas.count()) === 0) {
      console.log("  skip  no map on the page (feature flag off)")
    } else {
      const box = await canvas.boundingBox()
      if (!box || box.width < 200 || box.height < 100) {
        fail(`map canvas collapsed to ${box?.width}x${box?.height} — resize on reveal is not working`)
      } else {
        ok(`map canvas is ${Math.round(box.width)}x${Math.round(box.height)}`)
      }
      await canvas.screenshot({ path: "/tmp/tab-persistence-map.png" })
      console.log("  screenshot: /tmp/tab-persistence-map.png")
    }

    await page.screenshot({ path: "/tmp/tab-persistence-page.png" })
    console.log("  screenshot: /tmp/tab-persistence-page.png")
  } finally {
    await browser.close()
  }

  if (failures > 0) {
    console.log(`\nFAIL: ${failures} problem(s)`)
    process.exit(1)
  }
  console.log("\nPASS: tab switches preserve state and fire no refetches")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
