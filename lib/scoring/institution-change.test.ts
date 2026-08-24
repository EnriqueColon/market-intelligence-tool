import { test } from "node:test"
import assert from "node:assert/strict"
import { detectChanges, type QuarterObservation } from "./institution-change.ts"

const q = (quarter: string, fields: Partial<QuarterObservation>): QuarterObservation => ({
  quarter,
  ...fields,
})

test("flags the 300% CRE-to-capital supervisory screen when it is crossed", () => {
  const changes = detectChanges([
    q("20250930", { creToCapital: 2.8 }),
    q("20251231", { creToCapital: 3.1 }),
  ])
  const crossing = changes.find((c) => c.kind === "crossing")
  assert.ok(crossing, "expected a crossing")
  assert.equal(crossing.metric, "creToCapital")
  assert.equal(crossing.supervisory, true)
  assert.match(crossing.description, /rose above the 300% supervisory screen/)
})

test("does not flag a threshold that was already breached and stayed breached", () => {
  const changes = detectChanges([
    q("20250930", { creToCapital: 3.4 }),
    q("20251231", { creToCapital: 3.6 }),
  ])
  assert.equal(changes.filter((c) => c.kind === "crossing").length, 0)
})

test("treats a falling metric as crossing when it drops below the level", () => {
  const changes = detectChanges([
    q("20250930", { reserveCoverage: 0.012 }),
    q("20251231", { reserveCoverage: 0.008 }),
  ])
  const crossing = changes.find((c) => c.kind === "crossing")
  assert.ok(crossing)
  assert.match(crossing.description, /fell below the 1% of loans/)
})

test("reports a trajectory after three consecutive adverse quarters", () => {
  const changes = detectChanges([
    q("20250331", { noncurrentRatio: 0.004 }),
    q("20250630", { noncurrentRatio: 0.006 }),
    q("20250930", { noncurrentRatio: 0.009 }),
    q("20251231", { noncurrentRatio: 0.013 }),
  ])
  const trend = changes.find((c) => c.kind === "trajectory")
  assert.ok(trend, "expected a trajectory")
  assert.equal(trend.quarters, 3)
  assert.match(trend.description, /risen for 3 consecutive quarters/)
})

test("does not report a trajectory when the run is broken", () => {
  const changes = detectChanges([
    q("20250331", { noncurrentRatio: 0.004 }),
    q("20250630", { noncurrentRatio: 0.009 }),
    q("20250930", { noncurrentRatio: 0.007 }), // improved, breaking the run
    q("20251231", { noncurrentRatio: 0.013 }),
  ])
  assert.equal(changes.filter((c) => c.kind === "trajectory").length, 0)
})

test("ignores movements too small to be meaningful", () => {
  // Four quarters of drift well under 1% of the value should not read as a trend.
  const changes = detectChanges([
    q("20250331", { noncurrentRatio: 0.010 }),
    q("20250630", { noncurrentRatio: 0.010001 }),
    q("20250930", { noncurrentRatio: 0.010002 }),
    q("20251231", { noncurrentRatio: 0.010003 }),
  ])
  assert.equal(changes.length, 0)
})

test("orders supervisory crossings ahead of trajectories", () => {
  const changes = detectChanges([
    q("20250331", { creToCapital: 2.5, noncurrentRatio: 0.004 }),
    q("20250630", { creToCapital: 2.7, noncurrentRatio: 0.006 }),
    q("20250930", { creToCapital: 2.9, noncurrentRatio: 0.009 }),
    q("20251231", { creToCapital: 3.2, noncurrentRatio: 0.013 }),
  ])
  assert.equal(changes[0].kind, "crossing")
  assert.equal(changes[0].supervisory, true)
  assert.ok(changes.some((c) => c.kind === "trajectory"))
})

test("handles unordered input and missing metrics without inventing zeros", () => {
  const changes = detectChanges([
    q("20251231", { creToCapital: 3.2 }),
    q("20250930", {}), // no data this quarter
    q("20250630", { creToCapital: 2.5 }),
  ])
  // The gap is skipped rather than read as zero, which would fake a huge swing.
  assert.ok(changes.every((c) => Number.isFinite(c.from) && Number.isFinite(c.to)))
  assert.ok(changes.every((c) => c.from !== 0))
})

test("returns nothing for a single quarter", () => {
  assert.deepEqual(detectChanges([q("20251231", { creToCapital: 5 })]), [])
})
