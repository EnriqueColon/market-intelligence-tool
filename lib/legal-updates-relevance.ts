/**
 * Does a legal development actually bear on distressed CRE debt?
 *
 * Verification made the feed truthful without making it useful. "OCC Releases CRA Performance
 * Evaluations for 23 National Banks" is recent, real and primary-sourced, and tells a note buyer
 * nothing; so does a prohibition order against an individual teller, or a bill about data centres
 * on federal land. All of those reached the tab.
 *
 * The bar here is deliberately low. It removes items with no visible connection to commercial
 * property, credit or distress, and nothing finer — judging importance is the reader's job, and a
 * tighter rule would start discarding real developments whose summaries happen to be terse.
 */

const RELEVANT_TERMS = [
  // Commercial property and the loans against it
  "commercial real estate",
  "\\bcre\\b",
  "commercial propert",
  "commercial mortgage",
  "cmbs",
  "multifamily",
  "office building",
  "retail center",
  "industrial propert",
  "construction loan",
  "acquisition, development",
  "\\badc\\b",
  "real estate lending",
  "real estate loan",
  "mortgage lending",
  "loan servicing",
  "special servic",
  "appraisal",
  "loan-to-value",
  "\\bltv\\b",
  "concentration limit",
  "capital requirement",
  "risk-based capital",
  "allowance for credit loss",
  // Distress, and what happens to an asset in it
  "foreclos",
  "receivership",
  "receiver",
  "bankrupt",
  "chapter 11",
  "workout",
  "loan modification",
  "troubled debt",
  "nonaccrual",
  "noncurrent",
  "delinquen",
  "default",
  "charge-off",
  "note sale",
  "loan sale",
  "distressed",
  "\\breo\\b",
  "deed in lieu",
  "lien",
  "assignment of rents",
  "eviction",
  "landlord",
  "tenant",
  "property tax",
  "zoning",
  "land use",
  "affordable housing",
  "\\bhousing\\b",
]

const RELEVANCE_PATTERN = new RegExp(RELEVANT_TERMS.join("|"), "i")

export type RelevanceCandidate = {
  title?: string
  summary?: string
  whyItMatters?: string
  status?: string
}

/**
 * Reads the whole item rather than the title alone. An enforcement action is often titled only
 * with the institution's name, and its bearing on CRE appears in the summary.
 */
export function isCreRelevant(item: RelevanceCandidate): boolean {
  const text = [item.title, item.summary, item.whyItMatters, item.status]
    .filter(Boolean)
    .join(" ")
  return RELEVANCE_PATTERN.test(text)
}

export function partitionByRelevance<T extends RelevanceCandidate>(
  items: T[]
): { relevant: T[]; irrelevant: T[] } {
  const relevant: T[] = []
  const irrelevant: T[] = []
  for (const item of items) {
    if (isCreRelevant(item)) relevant.push(item)
    else irrelevant.push(item)
  }
  return { relevant, irrelevant }
}
