import { test } from "node:test"
import assert from "node:assert/strict"
import {
  detectChanges,
  groupForBrief,
  rankByRun,
  rankBySeverity,
  type InstitutionChange,
  type QuarterObservation,
} from "./institution-change.ts"

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
  assert.match(crossing.description, /fell below 1% of loans/)
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
  assert.match(trend.description, /rising for 3 consecutive quarters/)
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

const crossing = (over: number, from: number): InstitutionChange => ({
  kind: "crossing",
  metric: "creToCapital",
  metricLabel: "CRE to capital",
  description: "",
  from,
  to: 3 * over,
  quarters: 1,
  supervisory: true,
  threshold: 3,
})

test("ranks a crossing that landed further past the level first", () => {
  const grazed = crossing(1.02, 2.9)
  const clear = crossing(1.4, 2.9)
  assert.deepEqual([grazed, clear].sort(rankBySeverity), [clear, grazed])
})

test("does not let a jump from near-zero outrank a larger breach", () => {
  // A leap from a near-zero base is usually a reporting artifact, so severity
  // must depend on where the institution landed, not the size of the step.
  const fromNearZero = crossing(1.05, 0.01)
  const deeperBreach = crossing(1.5, 2.9)
  assert.deepEqual([fromNearZero, deeperBreach].sort(rankBySeverity), [
    deeperBreach,
    fromNearZero,
  ])
})

test("groupForBrief separates the three kinds and caps each section", () => {
  const events: InstitutionChange[] = [
    ...Array.from({ length: 4 }, () => crossing(1.2, 2.9)),
    { ...crossing(1.2, 2.9), supervisory: false },
    { kind: "trajectory", metric: "creToCapital", metricLabel: "CRE to capital", description: "", from: 1, to: 2, quarters: 5 },
  ]

  const groups = groupForBrief(events, 2)
  assert.equal(groups.supervisoryCrossings.length, 2, "supervisory section is capped")
  assert.equal(groups.otherCrossings.length, 1)
  assert.equal(groups.trajectories.length, 1)
})

test("reads threshold crossings as sentences that agree grammatically", () => {
  const plural = detectChanges([
    q("20250930", { noncurrentRatio: 0.015 }),
    q("20251231", { noncurrentRatio: 0.031 }),
  ])
  // "rose above the 2% of loans" and "Noncurrent loans has risen" both read wrong.
  assert.match(plural[0].description, /Noncurrent loans rose above 2% of loans, at 3\.10%/)

  const trend = detectChanges([
    q("20250331", { noncurrentRatio: 0.011 }),
    q("20250630", { noncurrentRatio: 0.02 }),
    q("20250930", { noncurrentRatio: 0.03 }),
    q("20251231", { noncurrentRatio: 0.041 }),
  ]).find((c) => c.kind === "trajectory")
  assert.ok(trend)
  assert.match(trend.description, /^Noncurrent loans: rising for 3 consecutive quarters/)
})

test("ranks a longer adverse run ahead of a shorter one", () => {
  const short = { kind: "trajectory" as const, metric: "creToCapital" as const, metricLabel: "", description: "", from: 1, to: 3, quarters: 3 }
  const long = { ...short, to: 1.5, quarters: 7 }
  assert.deepEqual([short, long].sort(rankByRun), [long, short])
})
