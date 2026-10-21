import { test } from "node:test"
import assert from "node:assert/strict"
import {
  authorize,
  normalizeCert,
  normalizeScope,
  buildMeta,
  ANALYTICS_API_VERSION,
  describeBytes,
  RESPONSE_BYTE_LIMIT,
  RESPONSE_REFUSE_BYTES,
  RESPONSE_WARN_BYTES,
  responseSizeShare,
  responseSizeVerdict,
} from "./api-contract"

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

test("the refusal threshold sits below the platform ceiling, with headroom", () => {
  // Crossing the ceiling fails the function rather than truncating the body, so
  // the refusal has to come first and leave room for growth between deploys.
  assert.ok(RESPONSE_WARN_BYTES < RESPONSE_REFUSE_BYTES)
  assert.ok(RESPONSE_REFUSE_BYTES < RESPONSE_BYTE_LIMIT)
  assert.ok(RESPONSE_BYTE_LIMIT - RESPONSE_REFUSE_BYTES >= 0.4 * 1024 * 1024, "at least 400 KB of headroom")
})

test("a response is refused above the threshold and sent below it", () => {
  assert.equal(responseSizeVerdict(1024), "ok")
  // The measured national figure when the API shipped: 3.9 MB — close, not refused.
  assert.equal(responseSizeVerdict(3.9 * 1024 * 1024), "near-limit")
  assert.equal(responseSizeVerdict(RESPONSE_WARN_BYTES), "near-limit")
  assert.equal(responseSizeVerdict(RESPONSE_WARN_BYTES - 1), "ok")
  assert.equal(responseSizeVerdict(RESPONSE_REFUSE_BYTES), "too-large")
  assert.equal(responseSizeVerdict(RESPONSE_BYTE_LIMIT), "too-large", "never send at the ceiling itself")
  assert.equal(responseSizeVerdict(10 * 1024 * 1024), "too-large")
})

test("a banded response stays comfortably inside the limit", () => {
  // Bands measured 0.16-0.90 MB each when the signals shipped.
  for (const mb of [0.16, 0.6, 0.9]) {
    assert.equal(responseSizeVerdict(mb * 1024 * 1024), "ok", `${mb} MB`)
  }
})

test("the share of the ceiling is reported as a fraction", () => {
  assert.equal(responseSizeShare(RESPONSE_BYTE_LIMIT), 1)
  assert.equal(Math.round(responseSizeShare(3.9 * 1024 * 1024) * 100), 87)
})

test("sizes read as megabytes or kilobytes, never as raw bytes", () => {
  assert.equal(describeBytes(3.9 * 1024 * 1024), "3.90 MB")
  assert.equal(describeBytes(600 * 1024), "600 KB")
  assert.equal(describeBytes(0), "0 KB")
})
