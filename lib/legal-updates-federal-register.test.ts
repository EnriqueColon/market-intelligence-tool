import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildRuleSummaryPrompt,
  dedupeRules,
  describeAgencies,
  describeRuleFromRecord,
  normalizeRuleTitle,
  selectRelevantRules,
  toSourcedRule,
  type SourcedRule,
} from "./legal-updates-federal-register.ts"
import { bearsOnFirmOperations } from "./legal-updates-relevance.ts"

/** The predicate the action passes in, so these tests exercise the real policy. */
const isRelevant = bearsOnFirmOperations

const rule = (over: Partial<SourcedRule> = {}): SourcedRule => ({
  documentNumber: "2026-10036",
  title: "Real Estate Lending Escrow Accounts",
  type: "Rule",
  agencies: ["Treasury Department", "Comptroller of the Currency"],
  publicationDate: "2026-06-29",
  url: "https://www.federalregister.gov/documents/2026/06/29/2026-10036/real-estate-lending-escrow-accounts",
  abstract: "The OCC is issuing a final rule to codify longstanding powers of national banks.",
  // Spelled out so the fixture has the same keys as a parsed record, which `deepEqual` compares.
  effectiveOn: undefined,
  commentsCloseOn: undefined,
  ...over,
})

test("a record entry becomes a sourced rule", () => {
  // Shape taken from a live Federal Register response.
  const sourced = toSourcedRule({
    document_number: "2026-10036",
    title: "Real Estate Lending Escrow Accounts",
    type: "Rule",
    publication_date: "2026-06-29",
    html_url:
      "https://www.federalregister.gov/documents/2026/06/29/2026-10036/real-estate-lending-escrow-accounts",
    agencies: [{ name: "Treasury Department" }, { name: "Comptroller of the Currency" }],
    abstract: "The OCC is issuing a final rule to codify longstanding powers of national banks.",
    effective_on: "2026-07-29",
    comments_close_on: null,
  })
  assert.deepEqual(sourced, { ...rule(), effectiveOn: "2026-07-29" })
})

test("an entry missing anything that identifies the document is discarded", () => {
  const base = {
    document_number: "2026-1",
    title: "A Rule",
    publication_date: "2026-01-01",
    html_url: "https://www.federalregister.gov/documents/2026/01/01/2026-1/a-rule",
  }
  assert.equal(toSourcedRule({ ...base, document_number: undefined }), null)
  assert.equal(toSourcedRule({ ...base, title: undefined }), null)
  assert.equal(toSourcedRule({ ...base, publication_date: undefined }), null)
  assert.equal(toSourcedRule({ ...base, html_url: undefined }), null)
})

test("a null comment deadline does not become the string 'null'", () => {
  // The API sends JSON null rather than omitting the field, and `"null".slice(0, 10)` is truthy.
  const sourced = toSourcedRule({
    document_number: "2026-2",
    title: "A Rule",
    publication_date: "2026-01-01",
    html_url: "https://www.federalregister.gov/x",
    comments_close_on: null,
    effective_on: null,
  })
  assert.equal(sourced?.commentsCloseOn, undefined)
  assert.equal(sourced?.effectiveOn, undefined)
})

test("one rule republished under two document numbers appears once, at the later date", () => {
  // Live case: "Real Estate Lending Escrow Accounts" was published on 2026-05-19 under the
  // Treasury Department and again on 2026-06-29 under Treasury and the Comptroller.
  const deduped = dedupeRules([
    rule({ documentNumber: "2026-10036", publicationDate: "2026-05-19", agencies: ["Treasury Department"] }),
    rule({ documentNumber: "2026-13000", publicationDate: "2026-06-29" }),
  ])
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].publicationDate, "2026-06-29")
})

test("the abstract survives deduplication even when the later record lacks one", () => {
  // Live defect: the 2026-06-29 republication of the escrow rule carried no abstract, and the tab
  // summarised a real OCC rule as "No agency abstract was published for this rule".
  const deduped = dedupeRules([
    rule({ documentNumber: "2026-10036", publicationDate: "2026-05-19", abstract: "The OCC is issuing a final rule." }),
    rule({ documentNumber: "2026-13000", publicationDate: "2026-06-29", abstract: undefined }),
  ])
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].documentNumber, "2026-13000")
  assert.equal(deduped[0].abstract, "The OCC is issuing a final rule.")
})

test("a later record with its own abstract keeps it", () => {
  const deduped = dedupeRules([
    rule({ documentNumber: "a", publicationDate: "2026-05-19", abstract: "Old wording." }),
    rule({ documentNumber: "b", publicationDate: "2026-06-29", abstract: "Corrected wording." }),
  ])
  assert.equal(deduped[0].abstract, "Corrected wording.")
})

test("the prompt forbids the model from writing about a missing abstract", () => {
  assert.match(buildRuleSummaryPrompt([rule({ abstract: undefined })]), /never mention that an abstract is missing/)
})

test("the same document reached by two searches appears once", () => {
  assert.equal(dedupeRules([rule(), rule(), rule()]).length, 1)
})

test("titles differing only in punctuation are one rule", () => {
  assert.equal(
    normalizeRuleTitle("Real Estate Lending: Escrow Accounts"),
    normalizeRuleTitle("Real Estate Lending — Escrow Accounts")
  )
})

test("relevance is judged on the title and the agency's own abstract", () => {
  const kept = selectRelevantRules(
    [
      rule(),
      // Live false positive: the search for "commercial real estate" returns this because the
      // phrase appears somewhere in the document. Neither its title nor its abstract is about it.
      rule({
        documentNumber: "2026-18164",
        title: "Driving Efficiency in Farm Loan Delivery",
        agencies: ["Farm Service Agency"],
        abstract:
          "The Farm Service Agency is amending the Farm Loan Program regulations to permanently implement changes.",
      }),
    ],
    isRelevant
  )
  assert.deepEqual(
    kept.map((r) => r.documentNumber),
    ["2026-10036"]
  )
})

test("an Office of Personnel Management staff-review rule is not an appraisal rule", () => {
  // Live false positive, and the reason "performance appraisal" is an excluded subject: the term
  // `appraisal` is real but this is about federal employees' annual reviews.
  const kept = selectRelevantRules(
    [
      rule({
        documentNumber: "2026-14000",
        title: "Performance Appraisal for General Schedule and Prevailing Rate Employees",
        agencies: ["Personnel Management Office"],
        abstract: "OPM is revising its regulations on performance appraisal systems.",
      }),
    ],
    isRelevant
  )
  assert.deepEqual(kept, [])
})

test("the most recent rules come first, and the limit is respected", () => {
  const kept = selectRelevantRules(
    [
      rule({ documentNumber: "a", publicationDate: "2026-01-01" }),
      rule({ documentNumber: "b", publicationDate: "2026-09-01" }),
      rule({ documentNumber: "c", publicationDate: "2026-05-01" }),
    ],
    isRelevant,
    2
  )
  assert.deepEqual(
    kept.map((r) => r.publicationDate),
    ["2026-09-01", "2026-05-01"]
  )
})

test("the specific agency is named rather than the parent department", () => {
  // "Treasury Department, Comptroller of the Currency" is one issuer described twice.
  assert.equal(describeAgencies(rule()), "Comptroller of the Currency")
  assert.equal(describeAgencies(rule({ agencies: [] })), "Federal Register")
})

test("an item reads from the record alone when the model is not asked or fails", () => {
  // The agency's abstract is the description when there is one.
  assert.match(describeRuleFromRecord(rule()), /^The OCC is issuing a final rule/)
})

test("a rule with no abstract still describes itself, with the date that matters", () => {
  const proposed = rule({
    abstract: undefined,
    type: "Proposed Rule",
    commentsCloseOn: "2026-08-31",
  })
  const described = describeRuleFromRecord(proposed)
  assert.match(described, /Proposed Rule issued by Comptroller of the Currency/)
  // A comment deadline is the actionable date on a proposed rule, so it wins over the effective one.
  assert.match(described, /Comments close 2026-08-31/)
})

test("the summary prompt supplies the facts and asks the model not to touch them", () => {
  const prompt = buildRuleSummaryPrompt([rule()])
  assert.match(prompt, /2026-10036/)
  assert.match(prompt, /do not restate, correct or change them/)
  assert.match(prompt, /Agency abstract: The OCC is issuing/)
  // There is nothing to look up, so nothing should send the model to the web.
  assert.doesNotMatch(prompt, /\bsearch\b/i)
})

test("the prompt tells the model not to go beyond the abstract it was given", () => {
  // Otherwise a thin abstract invites the model to fill the gap from memory, which is the whole
  // failure this module exists to avoid.
  assert.match(buildRuleSummaryPrompt([rule()]), /do not introduce facts it does not contain/)
})
