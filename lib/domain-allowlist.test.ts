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
import { getDomainsForEntity, type EntityId } from "./entity-sources.ts"

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

  it("drops everything for an id that is no longer in the registry", () => {
    // Fails closed on an unknown id rather than passing results through unfiltered.
    // Note that buildSearchQuery does the opposite for the same input: an empty
    // domain list there becomes an unrestricted Google query.
    const filtered = filterByAllowlist(items, "watchlist" as EntityId)
    assert.strictEqual(filtered.length, 0)
  })
})

describe("getDomainsForEntity", () => {
  it("returns exactly the eight primary entities for all", () => {
    // Spelled out rather than derived from PRIMARY_V1_ENTITY_IDS, so widening "all"
    // has to be a deliberate edit here too. "all" is the default in the dropdown and
    // becomes a site: restriction, so this list is what an unqualified search covers.
    assert.deepStrictEqual(getDomainsForEntity("all"), [
      "federalreserve.gov",
      "fdic.gov",
      "cbre.com",
      "cbre.us",
      "jll.com",
      "cushmanwakefield.com",
      "colliers.com",
      "naiop.org",
      "uli.org",
    ])
  })
  it("excludes the non-primary entities from all", () => {
    const domains = getDomainsForEntity("all")
    assert.ok(!domains.includes("mba.org"))
    assert.ok(!domains.includes("multihousingnews.com"))
    assert.ok(!domains.includes("commercialsearch.com"))
  })
  it("returns an entity's own domains when it is named directly", () => {
    assert.deepStrictEqual(getDomainsForEntity("mba"), ["mba.org"])
    assert.deepStrictEqual(getDomainsForEntity("cbre"), ["cbre.com", "cbre.us"])
  })
})
