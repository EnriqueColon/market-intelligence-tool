import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildFloridaSummaryPrompt,
  decodeEntities,
  describeFloridaFromRecord,
  isLocalBill,
  isReviserBill,
  selectRelevantFloridaBills,
  selectSessions,
  toCandidate,
  toDisplayNumber,
  type FloridaCandidate,
  type SourcedFloridaBill,
} from "./legal-updates-florida.ts"
import { recordBearsOnFirmOperations } from "./legal-updates-relevance.ts"

/** The predicate the action passes in, so these tests exercise the real policy. */
const isRelevant = recordBearsOnFirmOperations

const candidate = (over: Partial<FloridaCandidate> = {}): FloridaCandidate => ({
  billId: 1888888,
  displayNumber: "SB 300",
  title: "Alternative Judicial Sales Procedures",
  description: "Revising procedures for judicial sales in foreclosure actions.",
  statusLabel: "Died in Rules",
  statusDate: "2026-03-13",
  chamber: "senate",
  sessionName: "2026 Regular Session",
  ...over,
})

const sourced = (over: Partial<SourcedFloridaBill> = {}): SourcedFloridaBill => ({
  displayNumber: "SB 300",
  title: "Alternative Judicial Sales Procedures",
  statusLabel: "Died in Rules",
  statusDate: "2026-03-13",
  url: "https://www.flsenate.gov/Session/Bill/2026/300",
  description: "Revising procedures for judicial sales in foreclosure actions.",
  chamber: "senate",
  sessionName: "2026 Regular Session",
  ...over,
})

test("HTML entities in the legislature's text are decoded, not rendered", () => {
  // Live defect: HB 759 rendered "clerk&#39;s office" on the tab.
  assert.equal(decodeEntities("clerk&#39;s office &amp; fees"), "clerk's office & fees")
  assert.equal(decodeEntities("&quot;Florida Statutes&quot; &lt;2026&gt;"), '"Florida Statutes" <2026>')
  assert.equal(decodeEntities("&#x27;quoted&#x27;"), "'quoted'")
  // Something that only looks like an entity is left alone rather than eaten.
  assert.equal(decodeEntities("AT&T &unknown; stays"), "AT&T &unknown; stays")
})

test("a master-list row's text arrives decoded", () => {
  const c = toCandidate(
    {
      bill_id: 1,
      number: "H0759",
      title: "Court Fees",
      description: "Increases service charges clerk of circuit court charges for clerk&#39;s office",
      last_action: "Died in Rules &amp; Calendar",
      last_action_date: "2026-03-13",
    },
    "2026 Regular Session"
  )
  assert.equal(c?.description, "Increases service charges clerk of circuit court charges for clerk's office")
  assert.equal(c?.statusLabel, "Died in Rules & Calendar")
})

test("LegiScan's number becomes the form Florida prints", () => {
  // This is not cosmetic: the bill-identity guard reads the number back out of the rendered title
  // and looks for it on the cited flsenate.gov page, which prints "HB 11", not "H0011".
  assert.equal(toDisplayNumber("H0011"), "HB 11")
  assert.equal(toDisplayNumber("S0274"), "SB 274")
  assert.equal(toDisplayNumber("H1423"), "HB 1423")
  assert.equal(toDisplayNumber("s0956"), "SB 956")
})

test("a special-session suffix is kept, being part of the number", () => {
  // flsenate prints "HB 1F" for the first bill of a special session.
  assert.equal(toDisplayNumber("H0001F"), "HB 1F")
})

test("a number that is not a Florida bill number is refused", () => {
  assert.equal(toDisplayNumber("HR 1234"), null)
  assert.equal(toDisplayNumber(""), null)
  assert.equal(toDisplayNumber("H0000"), null)
})

test("Florida's local bills are recognised by their numbering", () => {
  // Bills in the 4000s affect one county, city or district. Of the 53 in the 2026 regular session,
  // 48 name one in the title and none is about commercial real estate.
  assert.equal(isLocalBill("HB 4051"), true)
  assert.equal(isLocalBill("HB 4999"), true)
  assert.equal(isLocalBill("SB 4000"), true)
  assert.equal(isLocalBill("HB 3999"), false)
  assert.equal(isLocalBill("HB 5000"), false)
  assert.equal(isLocalBill("SB 300"), false)
})

test("the reviser's bills are recognised by their title", () => {
  // Six of them in the 2026 session, all titled exactly this, all housekeeping. They reach the
  // relevance gate on "provisions which have become inoperative by noncurrent repeal".
  assert.equal(isReviserBill("Florida Statutes"), true)
  assert.equal(isReviserBill("  florida statutes  "), true)
  assert.equal(isReviserBill("Revision of the Florida Statutes"), true)
  // A bill that merely amends the statutes is not a reviser's bill.
  assert.equal(isReviserBill("Florida Statutes of Limitation for Foreclosure"), false)
})

test("a master-list row becomes a candidate", () => {
  // Shape taken from a live LegiScan getMasterList response.
  assert.deepEqual(
    toCandidate(
      {
        bill_id: 1888888,
        number: "S0300",
        title: "Alternative Judicial Sales Procedures",
        description: "Revising procedures for judicial sales in foreclosure actions.",
        status: 6,
        status_date: "2026-03-13",
        last_action: "Died in Rules",
        last_action_date: "2026-03-13",
      },
      "2026 Regular Session"
    ),
    candidate()
  )
})

test("the richer last action is preferred to the status integer", () => {
  // "Died in Rules" says more than "Failed", and the integer is only a fallback.
  const withAction = toCandidate(
    { bill_id: 1, number: "S0300", title: "A Bill", status: 6, last_action: "Died in Rules", last_action_date: "2026-03-13" },
    "2026 Regular Session"
  )
  assert.equal(withAction?.statusLabel, "Died in Rules")

  const withoutAction = toCandidate(
    { bill_id: 1, number: "S0300", title: "A Bill", status: 4, status_date: "2026-07-01" },
    "2026 Regular Session"
  )
  assert.equal(withoutAction?.statusLabel, "Passed")
})

test("local and reviser bills are refused at the row, not left to the relevance gate", () => {
  // They are facts about what kind of bill this is, rather than judgements about its subject.
  assert.equal(
    toCandidate(
      { bill_id: 1, number: "H4051", title: "Pace Fire Rescue District, Santa Rosa County", last_action_date: "2026-07-01" },
      "2026 Regular Session"
    ),
    null
  )
  assert.equal(
    toCandidate({ bill_id: 2, number: "S0102", title: "Florida Statutes", last_action_date: "2026-03-31" }, "2026 Regular Session"),
    null
  )
})

test("a row with nothing to date it is discarded", () => {
  assert.equal(toCandidate({ bill_id: 1, number: "S0300", title: "A Bill" }, "2026 Regular Session"), null)
  assert.equal(toCandidate({ number: "S0300", title: "A Bill", last_action_date: "2026-01-01" }, "2026 Regular Session"), null)
})

test("every session that could still hold an action in the window is searched", () => {
  // Florida runs a regular session and any number of special ones; eight fall inside 400 days.
  const sessions = [
    { session_id: 2266, session_name: "2026 Sixth Special Session", year_end: 2026 },
    { session_id: 2220, session_name: "2026 Regular Session", year_end: 2026 },
    { session_id: 2135, session_name: "2025 Regular Session", year_end: 2025 },
    { session_id: 1950, session_name: "2022 Regular Session", year_end: 2022 },
    { session_name: "no id", year_end: 2026 },
  ]
  assert.deepEqual(selectSessions(sessions, 2025), [2266, 2220, 2135])
})

test("a housing bill does not qualify on a commercial term buried in its description", () => {
  // Live case. Five of fifteen otherwise-qualifying Florida bills were housing bills that reached
  // the gate on "multifamily" or "construction loan" somewhere in the official description, and
  // residential policy was ruled out of scope.
  const kept = selectRelevantFloridaBills(
    [
      candidate(),
      candidate({
        billId: 2,
        displayNumber: "SB 1350",
        title: "Affordable Housing Property Tax Exemptions",
        description: "Providing an exemption for multifamily projects meeting certain criteria.",
      }),
    ],
    isRelevant
  )
  assert.deepEqual(
    kept.map((c) => c.displayNumber),
    ["SB 300"]
  )
})

test("the most recent bills come first, and the limit is respected", () => {
  const kept = selectRelevantFloridaBills(
    [
      candidate({ displayNumber: "SB 1", statusDate: "2026-01-01" }),
      candidate({ displayNumber: "SB 2", statusDate: "2026-09-01" }),
      candidate({ displayNumber: "SB 3", statusDate: "2026-05-01" }),
    ],
    isRelevant,
    2
  )
  assert.deepEqual(
    kept.map((c) => c.displayNumber),
    ["SB 2", "SB 3"]
  )
})

test("an item reads from the record alone when the model is not asked or fails", () => {
  assert.match(describeFloridaFromRecord(sourced()), /^Revising procedures for judicial sales/)
  const bare = sourced({ description: undefined })
  assert.match(describeFloridaFromRecord(bare), /SB 300, Alternative Judicial Sales Procedures/)
  assert.match(describeFloridaFromRecord(bare), /Status as of 2026-03-13: Died in Rules/)
})

test("the summary prompt supplies the facts and asks the model not to touch them", () => {
  const prompt = buildFloridaSummaryPrompt([sourced()])
  assert.match(prompt, /SB 300/)
  assert.match(prompt, /do not restate, correct or change them/)
  assert.match(prompt, /Official description: Revising procedures/)
  assert.doesNotMatch(prompt, /\bsearch\b/i)
})

test("the prompt requires a bill that died to be described as having died", () => {
  // Most of what survives the gate over a full window is legislation that failed, and a summary
  // that reads as though it were law would be the most damaging thing this section could print.
  assert.match(buildFloridaSummaryPrompt([sourced()]), /say plainly that it did not pass/)
})
