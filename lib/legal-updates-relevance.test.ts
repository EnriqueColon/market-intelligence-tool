import assert from "node:assert/strict"
import { test } from "node:test"

import { isCreRelevant, partitionByRelevance } from "./legal-updates-relevance.ts"
import { LEGAL_SECTIONS, SECTION_LABELS, windowFor } from "./legal-updates-sections.ts"

test("keeps an item whose CRE bearing is only in the summary", () => {
  assert.ok(
    isCreRelevant({
      title: "Interagency Statement on Loan Accommodations",
      summary: "Guidance for banks working with borrowers on commercial real estate loans.",
    })
  )
})

test("keeps an item whose CRE bearing is only in whyItMatters", () => {
  assert.ok(
    isCreRelevant({
      title: "OCC Bulletin 2026-14",
      whyItMatters: "Raises the appraisal threshold for CRE-secured credit.",
    })
  )
})

test("drops a consumer-banking item with no CRE bearing anywhere", () => {
  assert.equal(
    isCreRelevant({
      title: "CFPB Finalizes Overdraft Fee Rule",
      summary: "Caps overdraft fees charged on consumer deposit accounts.",
      whyItMatters: "Affects retail fee income at large banks.",
    }),
    false
  )
})

test("drops an individual prohibition order that never mentions lending", () => {
  assert.equal(
    isCreRelevant({
      title: "FDIC Issues Prohibition Order Against Former Teller",
      summary: "Order follows misappropriation of customer funds at a branch.",
    }),
    false
  )
})

test("partition returns both halves and loses nothing", () => {
  const items = [
    { title: "Florida bill on foreclosure procedure" },
    { title: "CFPB overdraft fee rule" },
    { title: "Fed guidance on multifamily loan workouts" },
  ]
  const { relevant, irrelevant } = partitionByRelevance(items)
  assert.equal(relevant.length, 2)
  assert.equal(irrelevant.length, 1)
  assert.equal(relevant.length + irrelevant.length, items.length)
})

test("legislative gets a wider window than the other two", () => {
  // A state legislature is out of session most of the year. A 180-day window emptied the section
  // between sessions even though the session's own laws were still the current law.
  const legislative = windowFor("legislative")
  assert.ok(legislative.promptDays > windowFor("regulatory").promptDays)
  assert.ok(legislative.filterDays >= 365, "must span a full annual session cycle")
})

test("every section has a window and a label", () => {
  for (const section of LEGAL_SECTIONS) {
    const { promptDays, filterDays } = windowFor(section)
    assert.ok(promptDays > 0)
    assert.ok(filterDays >= promptDays, "the filter must not be tighter than what the prompt asked for")
    assert.ok(SECTION_LABELS[section].length > 0)
  }
})
