import { test } from "node:test"
import assert from "node:assert/strict"
import { authorize, normalizeCert, normalizeScope, buildMeta, ANALYTICS_API_VERSION } from "./api-contract"

test("authorize: an unset key closes the API rather than opening it", () => {
  assert.equal(authorize("Bearer anything", undefined), "unconfigured")
  assert.equal(authorize("Bearer anything", "   "), "unconfigured")
})

test("authorize: exact bearer match only", () => {
  assert.equal(authorize("Bearer s3cret", "s3cret"), "ok")
  assert.equal(authorize("bearer s3cret", "s3cret"), "ok")
  assert.equal(authorize("Bearer s3cret ", "s3cret"), "ok")
  assert.equal(authorize("Bearer s3cre", "s3cret"), "unauthorized")
  assert.equal(authorize("Bearer s3cretX", "s3cret"), "unauthorized")
  assert.equal(authorize("s3cret", "s3cret"), "ok")
  assert.equal(authorize(null, "s3cret"), "unauthorized")
  assert.equal(authorize("Bearer ", "s3cret"), "unauthorized")
})

test("normalizeScope maps onto the exact strings the tab uses as cache keys", () => {
  assert.equal(normalizeScope(null), "National")
  assert.equal(normalizeScope(""), "National")
  assert.equal(normalizeScope("national"), "National")
  assert.equal(normalizeScope("US"), "National")
  assert.equal(normalizeScope("FL"), "Florida")
  assert.equal(normalizeScope("fl"), "Florida")
  assert.equal(normalizeScope("florida"), "Florida")
  assert.equal(normalizeScope(" New  York "), "New York")
  assert.equal(normalizeScope("NY"), "New York")
  assert.equal(normalizeScope("Narnia"), null)
  assert.equal(normalizeScope("F"), null)
})

test("normalizeCert accepts FDIC certificate numbers only", () => {
  assert.equal(normalizeCert("35541"), "35541")
  assert.equal(normalizeCert("0035541"), "35541")
  assert.equal(normalizeCert(" 4433 "), "4433")
  assert.equal(normalizeCert("35541; drop"), null)
  assert.equal(normalizeCert("12345678"), null)
  assert.equal(normalizeCert(""), null)
})

test("buildMeta carries version, quarter and the scope string verbatim", () => {
  const m = buildMeta("20260630", "Florida")
  assert.equal(m.apiVersion, ANALYTICS_API_VERSION)
  assert.equal(m.quarter, "20260630")
  assert.equal(m.scope, "Florida")
  assert.ok(!Number.isNaN(Date.parse(m.servedAt)))
  assert.equal("scope" in buildMeta("20260630"), false)
})
