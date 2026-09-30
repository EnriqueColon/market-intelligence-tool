/**
 * Does a legal development bear on how this firm operates?
 *
 * Two separate questions, because the answers fail in different ways.
 *
 * **Is it on topic?** Verification made the feed truthful without making it useful. "OCC Releases
 * CRA Performance Evaluations for 23 National Banks" is recent, real and primary-sourced, and tells
 * a note buyer nothing. So does a bill about data centres on federal land. All of that reached the
 * tab.
 *
 * **Is its subject the firm's world at all?** A prohibition order against a named individual is a
 * ruling about one person's employability. It is real, primary-sourced, on a regulator's site, and
 * changes nothing about buying notes or working out loans.
 *
 * Both gates read only what the source *says*, never the model's own case for the item — see
 * `describedBy` below, which is the fix for the defect that let the whole gate be talked past.
 */

/**
 * The model writes `whyItMatters` under instruction to explain the item's "relevance to distressed
 * CRE debt investing". Reading it here asked the model to certify its own item, and it always
 * obliged: "OCC Enforcement Action: Danny Seibel Prohibited from Banking Activities" reached the
 * tab on a `whyItMatters` reading "can affect how lenders manage their CRE loan portfolios", while
 * its title, summary and status mention nothing of the kind. The gate was not too loose so much as
 * self-defeating, and no amount of term tuning would have fixed it.
 *
 * `summary` is kept because the prompt asks it to describe what the document changes, which is
 * reporting rather than argument, and an enforcement action is often titled with nothing but an
 * institution's name.
 */
function describedBy(item: RelevanceCandidate): string {
  return [item.title, item.summary, item.status].filter(Boolean).join(" ")
}

/**
 * Commercial property, the credit secured on it, and what happens to either in distress.
 *
 * Residential and land-use policy came out deliberately. `housing`, `affordable housing`,
 * `eviction`, `landlord`, `tenant`, `property tax`, `zoning` and `land use` admitted HUD
 * homelessness grants and residential tenancy bills — real legislation that does not reach this
 * firm's operations. `multifamily` stays, being an asset class here rather than a housing policy.
 *
 * Every entry is anchored with `\b` or ends in a stem that cannot appear inside an unrelated word.
 * Bare substrings are how `lien` admitted "client", "clients", "resilience" and "salient", and
 * `tenant` admitted "lieutenant" — four false positives in fifteen sample headlines.
 */
const RELEVANT_TERMS = [
  // Commercial property and the loans against it
  "commercial real estate",
  "\\bcre\\b",
  "commercial propert\\w*",
  "commercial mortgage",
  "commercial lease",
  "\\bcmbs\\b",
  "\\bmultifamily\\b",
  "office building",
  "office tower",
  "retail cent(er|re)",
  "industrial propert\\w*",
  "construction loan",
  "acquisition, development",
  "\\badc\\b",
  "real estate lending",
  "real estate loan",
  "mortgage lending",
  "mortgage servic\\w*",
  "loan servicing",
  "special servic\\w*",
  "\\bappraisal\\w*",
  "loan-to-value",
  "\\bltv\\b",
  "concentration limit",
  "concentration risk",
  "risk-based capital",
  "capital requirement",
  "allowance for credit loss",
  // Distress, and what happens to an asset in it
  "foreclos\\w*",
  "receivership",
  "\\breceiver\\b",
  "bankrupt\\w*",
  "chapter 11",
  "\\bworkout\\w*",
  "loan modification",
  "troubled debt",
  "nonaccrual",
  "noncurrent",
  "delinquen\\w*",
  "charge-off",
  "note sale",
  "loan sale",
  "distressed",
  "\\breo\\b",
  "deed in lieu",
  "\\blien\\b",
  "\\bliens\\b",
  "assignment of rents",
  // `default` alone matched "default judgment" and "by default". Qualified, it is the real thing.
  "(loan|payment|monetary|mortgage|borrower) default\\w*",
  "default(ed|ing) (on|loan)",
]

const RELEVANCE_PATTERN = new RegExp(RELEVANT_TERMS.join("|"), "i")

/**
 * Removal-and-prohibition orders under 12 U.S.C. 1818(e) can only be issued against a person, not
 * an institution, so the phrasing is a reliable marker rather than a guess at whether a name is a
 * human. That precision is the point: no attempt is made to classify names, which would misfile
 * institutions named after their founders.
 *
 * These are dropped whatever else they say. A prohibition order can mention a CRE loan portfolio
 * as the setting for the underlying conduct and still be a ruling about one person's career.
 */
const INDIVIDUAL_ACTION_TERMS = [
  "prohibition order",
  "order of prohibition",
  "removal and prohibition",
  "prohibited from (participating|banking|the banking)",
  "barred from (participating|banking|the banking)",
  "personal cease and desist",
  "\\bformer (teller|employee|officer|loan officer|branch manager|cashier)\\b",
]

const INDIVIDUAL_ACTION_PATTERN = new RegExp(INDIVIDUAL_ACTION_TERMS.join("|"), "i")

export type RelevanceCandidate = {
  title?: string
  summary?: string
  whyItMatters?: string
  status?: string
}

/** True for an action against a named individual rather than an institution or a rule. */
export function isIndividualAction(item: RelevanceCandidate): boolean {
  return INDIVIDUAL_ACTION_PATTERN.test(describedBy(item))
}

/** True when the source's own description touches commercial property, credit or distress. */
export function isCreRelevant(item: RelevanceCandidate): boolean {
  return RELEVANCE_PATTERN.test(describedBy(item))
}

/**
 * The single question the feed acts on: would this change how the firm operates?
 *
 * On topic and about an institution, a rule or a case — not about one person's licence.
 */
export function bearsOnFirmOperations(item: RelevanceCandidate): boolean {
  return isCreRelevant(item) && !isIndividualAction(item)
}

export function partitionByRelevance<T extends RelevanceCandidate>(
  items: T[]
): { relevant: T[]; irrelevant: T[] } {
  const relevant: T[] = []
  const irrelevant: T[] = []
  for (const item of items) {
    if (bearsOnFirmOperations(item)) relevant.push(item)
    else irrelevant.push(item)
  }
  return { relevant, irrelevant }
}
