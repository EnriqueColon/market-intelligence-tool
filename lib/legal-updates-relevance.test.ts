import assert from "node:assert/strict"
import { test } from "node:test"

import {
  bearsOnFirmOperations,
  isCreRelevant,
  isIndividualAction,
  partitionByRelevance,
} from "./legal-updates-relevance.ts"
import { LEGAL_SECTIONS, SECTION_LABELS, windowFor } from "./legal-updates-sections.ts"

test("keeps an item whose CRE bearing is only in the summary", () => {
  assert.ok(
    isCreRelevant({
      title: "Interagency Statement on Loan Accommodations",
      summary: "Guidance for banks working with borrowers on commercial real estate loans.",
    })
  )
})

// This suite previously asserted the opposite: that an item relevant *only* in `whyItMatters` was
// kept. That was the defect. The prompt tells the model to write that field about "relevance to
// distressed CRE debt investing", so reading it asked the model to certify its own item, and the
// gate passed essentially everything it was shown.
test("an item relevant only in whyItMatters is not kept on the model's own say-so", () => {
  assert.equal(
    isCreRelevant({
      title: "OCC Bulletin 2026-14",
      whyItMatters: "Raises the appraisal threshold for CRE-secured credit.",
    }),
    false
  )
})

test("the item a user reported as noise is rejected", () => {
  // Verbatim from the dev feed, with a whyItMatters of the kind the prompt asks for.
  const item = {
    title: "OCC Enforcement Action: Danny Seibel Prohibited from Banking Activities",
    summary:
      "The OCC issued a prohibition order against Danny Seibel, a former employee of a national bank, barring him from participating in the affairs of any insured depository institution.",
    whyItMatters:
      "Individual accountability actions signal heightened OCC scrutiny of bank operations, which can affect how lenders manage their CRE loan portfolios and workout negotiations.",
    status: "Prohibition Order",
  }
  assert.equal(bearsOnFirmOperations(item), false)
  assert.ok(isIndividualAction(item), "a prohibition order is an action against a person")
})

test("an individual action is dropped even when it does discuss CRE lending", () => {
  // The conduct behind an 8(e) order often involved the CRE book. It is still a ruling about one
  // person's employability, so topic alone must not be enough to carry it.
  const item = {
    title: "FDIC Issues Removal and Prohibition Order",
    summary:
      "The order concerns a former loan officer who falsified appraisals on commercial real estate loans.",
  }
  assert.ok(isCreRelevant(item), "the topic gate sees the CRE lending")
  assert.equal(bearsOnFirmOperations(item), false, "but it is still about one individual")
})

test("an institution-level consent order on CRE concentration is kept", () => {
  // The guard must not take the whole Enforcement section with it.
  assert.ok(
    bearsOnFirmOperations({
      title: "FDIC Announces Consent Order With Community Bank of the Gulf",
      summary:
        "The order requires the bank to reduce its commercial real estate concentration and strengthen credit administration.",
      status: "Consent Order Issued",
    })
  )
})

test("word-boundary anchoring keeps out client, resilience and lieutenant", () => {
  // `lien` as a bare substring admitted all three of the first group; `tenant` admitted the last.
  const noise = [
    "OCC Reports Improvement in Bank Client Satisfaction Survey",
    "FDIC Announces Resilience Exercise for Community Institutions",
    "SEC Charges Investment Adviser With Defrauding Retail Clients",
    "Lieutenant Colonel Sentenced for Procurement Fraud",
  ]
  for (const title of noise) {
    assert.equal(isCreRelevant({ title }), false, title)
  }
  // The words the anchors exist to protect still match.
  assert.ok(isCreRelevant({ title: "Florida bill on lien priority for construction lenders" }))
  assert.ok(isCreRelevant({ summary: "The buyer takes title subject to existing liens." }))
})

test("residential and land-use policy is out of scope", () => {
  const outOfScope = [
    { title: "HUD Awards Grants to Support Homeless Youth Services" },
    { title: "Florida Bill Revises Residential Landlord and Tenant Act", summary: "Changes notice periods for residential evictions." },
    { title: "County Zoning Overhaul Advances", summary: "Rewrites single-family land use categories." },
  ]
  for (const item of outOfScope) {
    assert.equal(bearsOnFirmOperations(item), false, item.title)
  }
  // Multifamily is an asset class here, not housing policy, so it stays in.
  assert.ok(bearsOnFirmOperations({ title: "Fed guidance on multifamily loan workouts" }))
})

test("bare 'default' no longer admits default judgments", () => {
  assert.equal(isCreRelevant({ title: "Court Enters Default Judgment in Trademark Suit" }), false)
  assert.ok(isCreRelevant({ summary: "Guidance on servicing a borrower default." }))
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
