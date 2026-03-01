#!/usr/bin/env npx tsx
/**
 * CBRE browser automation script.
 * Opens a visible browser, navigates to CBRE Insights, and applies selected filters.
 * Run: npx tsx scripts/cbre-automate.ts [--propertyType=office] [--region=americas] [--country=united-states] [--market=miami] [--topic=intelligent-investment] [--tab=market-reports|insights]
 *
 * Requires: npx playwright install chromium
 */

import { chromium } from "playwright"

const CBRE_BASE = "https://www.cbre.com"

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

type CbreAutomateParams = {
  tab: "market-reports" | "insights"
  propertyType: string
  region: string
  country: string
  market: string
  topic: string
}

function parseArgs(): CbreAutomateParams {
  const args = process.argv.slice(2)
  const params: CbreAutomateParams = {
    tab: "market-reports",
    propertyType: "",
    region: "",
    country: "",
    market: "",
    topic: "",
  }
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, val] = arg.slice(2).split("=")
      if (key && val) {
        const k = key as keyof CbreAutomateParams
        if (k in params) params[k] = val
      }
    }
  }
  return params
}

function buildUrl(params: CbreAutomateParams): string {
  const hash = params.tab === "market-reports" ? "#market-reports" : "#insights"
  const search = new URLSearchParams()
  if (params.propertyType && params.propertyType !== "all")
    search.set("propertyType", params.propertyType)
  if (params.region) search.set("region", params.region)
  if (params.country) search.set("country", params.country)
  if (params.market) search.set("market", params.market)
  if (params.topic && params.tab === "insights") search.set("topic", params.topic)
  const qs = search.toString()
  return `${CBRE_BASE}/insights${qs ? `?${qs}` : ""}${hash}`
}

async function tryApplyFilters(
  page: import("playwright").Page,
  params: CbreAutomateParams
): Promise<void> {
  const selectors = [
    // Native select elements
    { key: "propertyType", label: "Property Type", name: "property" },
    { key: "region", label: "Region", name: "region" },
    { key: "country", label: "Country", name: "country" },
    { key: "market", label: "Market", name: "market" },
    { key: "topic", label: "Topic", name: "topic" },
  ] as const

  for (const { key, label, name } of selectors) {
    const value = params[key]
    if (!value) continue

    try {
      // Try native select by label
      const select = page.getByLabel(label, { exact: false })
      if ((await select.count()) > 0) {
        await select.first().selectOption({ value })
        console.log(`Set ${label} to ${value}`)
        await sleep(300)
        continue
      }

      // Try select by name
      const selectByName = page.locator(`select[name*="${name}" i]`)
      if ((await selectByName.count()) > 0) {
        await selectByName.first().selectOption({ value })
        console.log(`Set ${label} (by name) to ${value}`)
        await sleep(300)
        continue
      }

      // Try combobox/button that opens dropdown
      const combobox = page.getByRole("combobox", { name: new RegExp(label, "i") })
      if ((await combobox.count()) > 0) {
        await combobox.first().click()
        await sleep(400)
        const option = page.getByRole("option", { name: new RegExp(value.replace(/-/g, " "), "i") })
        if ((await option.count()) > 0) {
          await option.first().click()
          console.log(`Set ${label} (combobox) to ${value}`)
        }
        await sleep(300)
      }
    } catch (e) {
      console.warn(`Could not set ${label}:`, (e as Error).message)
    }
  }
}

async function main() {
  const params = parseArgs()
  const url = buildUrl(params)
  console.log("Opening CBRE:", url)

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  })

  const context = await browser.newContext({
    viewport: null,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })

  const page = await context.newPage()
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 })

  // Wait for filters to appear (CBRE may load them dynamically)
  await sleep(3000)

  await tryApplyFilters(page, params)

  console.log("CBRE opened. Browser will stay open. Close it when done.")
  // Keep browser open - user can close manually
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
