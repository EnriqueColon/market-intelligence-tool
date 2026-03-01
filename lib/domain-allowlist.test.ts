/**
 * Unit tests for domain allowlist filter logic.
 * Run: npx tsx lib/domain-allowlist.test.ts
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import {
  extractHostname,
  isHostnameAllowed,
  filterByAllowlist,
} from "./domain-allowlist.ts"
import { getDomainsForEntity } from "./entity-sources.ts"

describe("extractHostname", () => {
  it("extracts hostname from https URL", () => {
    assert.strictEqual(
      extractHostname("https://www.cbre.com/insights/reports/outlook"),
      "www.cbre.com"
    )
  })
  it("extracts hostname from URL with port", () => {
    assert.strictEqual(
      extractHostname("https://cbre.com:443/path"),
      "cbre.com"
    )
  })
  it("returns lowercase", () => {
    assert.strictEqual(
      extractHostname("https://WWW.CBRE.COM/path"),
      "www.cbre.com"
    )
  })
  it("returns empty for invalid URL", () => {
    assert.strictEqual(extractHostname("not-a-url"), "")
  })
})

describe("isHostnameAllowed", () => {
  const cbreDomains = ["cbre.com", "cbre.us"]

  it("allows exact match", () => {
    assert.strictEqual(isHostnameAllowed("cbre.com", cbreDomains), true)
    assert.strictEqual(isHostnameAllowed("cbre.us", cbreDomains), true)
  })
  it("allows subdomains", () => {
    assert.strictEqual(isHostnameAllowed("www.cbre.com", cbreDomains), true)
    assert.strictEqual(isHostnameAllowed("us.cbre.com", cbreDomains), true)
    assert.strictEqual(isHostnameAllowed("www.us.cbre.com", cbreDomains), true)
    assert.strictEqual(isHostnameAllowed("www.cbre.us", cbreDomains), true)
    assert.strictEqual(isHostnameAllowed("research.cbre.com", cbreDomains), true)
  })
  it("rejects non-matching domains", () => {
    assert.strictEqual(isHostnameAllowed("evil.com", cbreDomains), false)
    assert.strictEqual(isHostnameAllowed("cbre.com.evil.com", cbreDomains), false)
    assert.strictEqual(isHostnameAllowed("evil-cbre.com", cbreDomains), false)
    assert.strictEqual(isHostnameAllowed("jll.com", cbreDomains), false)
  })
  it("rejects empty hostname", () => {
    assert.strictEqual(isHostnameAllowed("", cbreDomains), false)
  })
})

describe("filterByAllowlist", () => {
  const items = [
    { url: "https://www.cbre.com/report", title: "CBRE" },
    { url: "https://www.jll.com/report", title: "JLL" },
    { url: "https://evil.com/fake-cbre", title: "Evil" },
    { url: "https://us.cbre.com/outlook", title: "CBRE US" },
  ]

  it("filters for single entity (cbre)", () => {
    const filtered = filterByAllowlist(items, "cbre")
    assert.strictEqual(filtered.length, 2)
    assert.ok(filtered.some((r) => r.title === "CBRE"))
    assert.ok(filtered.some((r) => r.title === "CBRE US"))
    assert.ok(!filtered.some((r) => r.title === "JLL"))
    assert.ok(!filtered.some((r) => r.title === "Evil"))
  })

  it("filters for all entities", () => {
    const filtered = filterByAllowlist(items, "all")
    assert.strictEqual(filtered.length, 3) // CBRE, JLL, CBRE US - not Evil
    assert.ok(!filtered.some((r) => r.title === "Evil"))
  })

  it("filters for watchlist (cbre + jll)", () => {
    const filtered = filterByAllowlist(items, "watchlist")
    assert.strictEqual(filtered.length, 3)
    assert.ok(!filtered.some((r) => r.title === "Evil"))
  })
})

describe("getDomainsForEntity", () => {
  it("returns all domains for all", () => {
    const domains = getDomainsForEntity("all")
    assert.ok(domains.includes("cbre.com"))
    assert.ok(domains.includes("jll.com"))
    assert.ok(domains.includes("mba.org"))
  })
  it("returns cbre + jll for watchlist", () => {
    const domains = getDomainsForEntity("watchlist")
    assert.ok(domains.includes("cbre.com"))
    assert.ok(domains.includes("jll.com"))
    assert.ok(!domains.includes("mba.org"))
  })
})
