import { test } from "node:test"
import assert from "node:assert/strict"
import {
  creMixBand,
  medianOf,
  MIN_COHORT,
  percentileIn,
  selectPeers,
  sizeBand,
  type PeerCandidate,
} from "./peer-cohort.ts"

const bank = (over: Partial<PeerCandidate> & { cert: string }): PeerCandidate => ({
  name: `BANK ${over.cert}`,
  state: "FLORIDA",
  totalAssets: 500e6,
  creLoans: 200e6,
  totalLoans: 400e6,
  ...over,
})

test("size bands split on the conventional breaks", () => {
  assert.equal(sizeBand(100e6).label, "under $250M")
  assert.equal(sizeBand(250e6).label, "$250M–$1B")
  assert.equal(sizeBand(2e9).label, "$1B–$3B")
  assert.equal(sizeBand(50e9).label, "over $10B")
})

test("CRE mix bands describe the kind of lending, not the amount", () => {
  assert.equal(creMixBand(5, 100).label, "little CRE")
  assert.equal(creMixBand(25, 100).label, "moderate CRE")
  assert.equal(creMixBand(40, 100).label, "CRE-significant")
  assert.equal(creMixBand(60, 100).label, "CRE-concentrated")
  // A bank with no loans at all must land somewhere rather than divide by zero.
  assert.equal(creMixBand(0, 0).label, "little CRE")
})

test("all three criteria hold when the matched cohort is large enough", () => {
  const universe = Array.from({ length: 12 }, (_, i) => bank({ cert: `p${i}` }))
  const cohort = selectPeers(bank({ cert: "subject" }), universe)
  assert.equal(cohort.peers.length, 12)
  assert.deepEqual(cohort.criteria, { size: true, geography: true, creMix: true })
  assert.match(cohort.description, /\$250M–\$1B/)
  assert.match(cohort.description, /Florida/)
  // Nothing was relaxed, so there is nothing to explain away.
  assert.equal(cohort.relaxationNote, null)
})

test("CRE mix is dropped first when the matched cohort is too thin", () => {
  // Two same-mix peers, ten same-state peers of a different mix.
  const universe = [
    ...Array.from({ length: 2 }, (_, i) => bank({ cert: `same${i}` })),
    ...Array.from({ length: 10 }, (_, i) =>
      bank({ cert: `diff${i}`, creLoans: 20e6, totalLoans: 400e6 })
    ),
  ]
  const cohort = selectPeers(bank({ cert: "subject" }), universe)
  assert.equal(cohort.criteria.creMix, false)
  assert.equal(cohort.criteria.geography, true)
  assert.equal(cohort.peers.length, 12)
  assert.equal(cohort.relaxationNote, "CRE mix is unmatched — too few institutions this size in Florida share it.")
})

test("geography is dropped only after CRE mix", () => {
  const universe = [
    bank({ cert: "fl1" }),
    ...Array.from({ length: 10 }, (_, i) => bank({ cert: `ga${i}`, state: "GEORGIA" })),
  ]
  const cohort = selectPeers(bank({ cert: "subject" }), universe)
  assert.deepEqual(cohort.criteria, { size: true, geography: false, creMix: false })
  assert.equal(cohort.peers.length, 11)
  assert.match(cohort.description, /nationally/)
  // One sentence covering both relaxations rather than two that read as if the
  // second were an afterthought.
  assert.match(cohort.relaxationNote!, /^Too few institutions this size in Florida/)
  assert.match(cohort.relaxationNote!, /CRE mix is unmatched\.$/)
})

test("size is never relaxed, even when that leaves too few peers", () => {
  // A lone large bank surrounded by small ones must not be compared to them.
  const universe = Array.from({ length: 40 }, (_, i) => bank({ cert: `small${i}`, totalAssets: 50e6 }))
  const cohort = selectPeers(bank({ cert: "subject", totalAssets: 20e9 }), universe)
  assert.equal(cohort.peers.length, 0)
  assert.equal(cohort.criteria.size, true)
})

test("the subject never appears in its own cohort", () => {
  const universe = [bank({ cert: "subject" }), ...Array.from({ length: 9 }, (_, i) => bank({ cert: `p${i}` }))]
  const cohort = selectPeers(bank({ cert: "subject" }), universe)
  assert.equal(cohort.peers.length, 9)
  assert.ok(!cohort.peers.some((p) => p.cert === "subject"))
})

test("percentileIn declines to rank against too small a cohort", () => {
  const tooFew = Array.from({ length: MIN_COHORT - 1 }, (_, i) => i)
  assert.equal(percentileIn(tooFew, 3), null)
  const enough = Array.from({ length: MIN_COHORT }, (_, i) => i)
  assert.notEqual(percentileIn(enough, 3), null)
})

test("percentileIn uses the midrank convention, matching the opportunity score", () => {
  const cohort = [0, 0, 0, 0, 1, 2, 3, 4]
  // Four zeros share the bottom half of the band they span: (0 + 4/2)/8.
  assert.equal(percentileIn(cohort, 0), 0.25)
  assert.equal(percentileIn(cohort, 4), 0.9375)
})

test("medianOf handles both parities and an empty cohort", () => {
  assert.equal(medianOf([3, 1, 2]), 2)
  assert.equal(medianOf([4, 1, 3, 2]), 2.5)
  assert.equal(medianOf([]), null)
  assert.equal(medianOf([Number.NaN]), null)
})
