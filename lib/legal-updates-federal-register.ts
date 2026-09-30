/**
 * Rules and proposed rules for the Regulatory section, taken from the Federal Register.
 *
 * Same correction as `legal-updates-legislation.ts`, applied to the other section that has a
 * published record. A final rule is not something to ask a model about: it has a document number,
 * a citation, an issuing agency and a publication date, and the Federal Register gives all of them
 * away over an open API with no key. Asking instead is how the feed came to contain a "2026 update"
 * linked to a statute enacted in 2020.
 *
 * This does not replace the regulatory prompt, and is not meant to. The Federal Register carries
 * rulemaking only — the FDIC's Financial Institution Letters, OCC bulletins and supervisory
 * guidance never appear in it, and those are a large part of what this section is for. So the
 * record supplies what it has and the model still goes looking for the rest.
 *
 * Unlike govtrack, the Federal Register publishes the agency's own abstract. That is authoritative
 * text rather than an argument, so the relevance gate is allowed to read it — which is the whole
 * reason `recordBearsOnFirmOperations` takes a summary at all.
 */

export type SourcedRule = {
  /** The Federal Register's own identifier, e.g. "2026-10036". Unique per document. */
  documentNumber: string
  title: string
  /** "Rule" or "Proposed Rule", as the Federal Register types it. */
  type: string
  /** Every issuing agency. A joint rule lists all of them, and the tab names them all. */
  agencies: string[]
  publicationDate: string
  url: string
  /** The agency's abstract. Absent on some notices, which is why nothing depends on it. */
  abstract?: string
  effectiveOn?: string
  /** Set on proposed rules. The date that actually matters to a reader who wants to respond. */
  commentsCloseOn?: string
}

/**
 * Phrase searches over the full text, so they are wide on purpose and the gate below decides.
 * Searching "commercial real estate" returns a Farm Service Agency rule on loan delivery because
 * the phrase appears somewhere in it — which is why relevance is never taken from the search.
 */
const SEARCH_TERMS = [
  "commercial real estate",
  "commercial mortgage",
  "real estate lending",
  "appraisal",
  "foreclosure",
  "receivership",
  "loan modification",
  "concentration",
  "allowance for credit losses",
  "capital requirements",
]

/** Rulemaking only. Notices and presidential documents are a different kind of thing. */
const DOCUMENT_TYPES = ["RULE", "PRORULE"]

const FIELDS = [
  "document_number",
  "title",
  "type",
  "publication_date",
  "html_url",
  "agencies",
  "abstract",
  "effective_on",
  "comments_close_on",
]

type FederalRegisterDocument = {
  document_number?: string
  title?: string
  type?: string
  publication_date?: string
  html_url?: string
  agencies?: Array<{ name?: string }>
  abstract?: string
  effective_on?: string | null
  comments_close_on?: string | null
}

export function toSourcedRule(raw: FederalRegisterDocument): SourcedRule | null {
  const documentNumber = raw.document_number?.trim()
  const title = raw.title?.trim()
  const publicationDate = raw.publication_date?.slice(0, 10)
  const url = raw.html_url?.trim()
  if (!documentNumber || !title || !publicationDate || !url) return null

  return {
    documentNumber,
    title,
    type: raw.type?.trim() || "Rule",
    agencies: (raw.agencies ?? [])
      .map((a) => a.name?.trim())
      .filter((n): n is string => Boolean(n)),
    publicationDate,
    url,
    abstract: raw.abstract?.trim() || undefined,
    effectiveOn: raw.effective_on?.slice(0, 10) || undefined,
    commentsCloseOn: raw.comments_close_on?.slice(0, 10) || undefined,
  }
}

/** Titles differing only in punctuation or case are the same rule reached by two searches. */
export function normalizeRuleTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Two rounds, because a rule repeats for two different reasons.
 *
 * It surfaces under several of the searches, which is the same document twice. And a rule is
 * genuinely republished — "Real Estate Lending Escrow Accounts" appeared on 2026-05-19 under the
 * Treasury Department and again on 2026-06-29 under Treasury and the Comptroller of the Currency,
 * two document numbers for one rule. The later publication wins, being the operative one.
 */
export function dedupeRules(rules: SourcedRule[]): SourcedRule[] {
  const keep = (map: Map<string, SourcedRule>, key: string, rule: SourcedRule) => {
    const existing = map.get(key)
    if (!existing || rule.publicationDate > existing.publicationDate) map.set(key, rule)
  }

  const byNumber = new Map<string, SourcedRule>()
  for (const rule of rules) keep(byNumber, rule.documentNumber, rule)

  const byTitle = new Map<string, SourcedRule>()
  for (const rule of byNumber.values()) keep(byTitle, normalizeRuleTitle(rule.title), rule)

  return [...byTitle.values()]
}

/**
 * Relevance is judged on the title and the agency's abstract, and the test is passed in.
 *
 * Same reasoning as `selectRelevantBills`: this module owns no policy, so the feed's one gate
 * cannot be contradicted by a second copy of it living here.
 */
export function selectRelevantRules(
  rules: SourcedRule[],
  isRelevant: (item: { title?: string; summary?: string }) => boolean,
  limit = 5
): SourcedRule[] {
  return rules
    .filter((r) => isRelevant({ title: r.title, summary: r.abstract }))
    .sort((a, b) => b.publicationDate.localeCompare(a.publicationDate))
    .slice(0, limit)
}

function searchUrl(term: string, since: string): string {
  const params = new URLSearchParams({
    per_page: "100",
    order: "newest",
    "conditions[publication_date][gte]": since,
    // Quoted, so this is a phrase search rather than a bag of words.
    "conditions[term]": `"${term}"`,
  })
  for (const type of DOCUMENT_TYPES) params.append("conditions[type][]", type)
  for (const field of FIELDS) params.append("fields[]", field)
  return `https://www.federalregister.gov/api/v1/documents.json?${params.toString()}`
}

async function searchRules(term: string, since: string, timeoutMs: number): Promise<SourcedRule[]> {
  try {
    const res = await fetch(searchUrl(term, since), {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MarketIntelligenceTool/1.0)" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
    if (!res.ok) return []
    const data = (await res.json()) as { results?: FederalRegisterDocument[] }
    return (data.results ?? []).map(toSourcedRule).filter((r): r is SourcedRule => r !== null)
  } catch {
    return []
  }
}

/**
 * One term failing is not the section failing — these are independent searches over the same
 * record, so a timeout on one costs some recall and nothing else.
 */
export async function fetchFederalRules(
  now: Date,
  windowDays: number,
  isRelevant: (item: { title?: string; summary?: string }) => boolean,
  limit = 5,
  timeoutMs = 20_000
): Promise<SourcedRule[]> {
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10)
  const batches = await Promise.all(SEARCH_TERMS.map((t) => searchRules(t, since, timeoutMs)))
  return selectRelevantRules(dedupeRules(batches.flat()), isRelevant, limit)
}

/** The agencies as a reader would name them, with the parent department dropped when redundant. */
export function describeAgencies(rule: SourcedRule): string {
  if (rule.agencies.length === 0) return "Federal Register"
  // "Treasury Department, Comptroller of the Currency" is one issuer described twice; the specific
  // half is the informative one.
  return rule.agencies[rule.agencies.length - 1]
}

/**
 * What the item says before a model has seen it.
 *
 * Written from the record alone so that a failed or skipped summarisation step degrades to a
 * thinner item rather than no item. Everything here is the document's own.
 */
export function describeRuleFromRecord(rule: SourcedRule): string {
  if (rule.abstract) return rule.abstract
  const deadline = rule.commentsCloseOn
    ? ` Comments close ${rule.commentsCloseOn}.`
    : rule.effectiveOn
      ? ` Effective ${rule.effectiveOn}.`
      : ""
  return `${rule.type} issued by ${describeAgencies(rule)}, published ${rule.publicationDate}.${deadline}`
}

/**
 * Asks only for prose, and supplies the facts.
 *
 * The rules are given rather than searched for, so there is nothing to look up and no reason to
 * reach for the web. Keyed by document number on the way back so a reordered or partial answer
 * still lands on the right rule.
 */
export function buildRuleSummaryPrompt(rules: SourcedRule[]): string {
  const list = rules
    .map(
      (r) =>
        `- ${r.documentNumber} [${r.type}, ${describeAgencies(r)}, published ${r.publicationDate}]: ${r.title}\n  Agency abstract: ${r.abstract || "(none published)"}`
    )
    .join("\n")

  return `These are real documents from the Federal Register. Their numbers, titles, agencies, types and dates are already confirmed — do not restate, correct or change them, and do not add documents.

${list}

For each one, write two things for a firm that buys and works out distressed commercial real estate debt:
- "summary": 2-3 sentences in plain English on what the rule actually changes. Base this on the agency abstract above; do not introduce facts it does not contain.
- "whyItMatters": 1-2 sentences on the consequence for note purchases, workouts, foreclosures or REO. If the honest answer is that the effect is indirect or minimal, say that instead of inflating it.

Where a rule's effect on commercial real estate is incidental, say so plainly. An item that explains why it is marginal is more useful than one that pretends otherwise.

Return ONLY valid JSON, keyed by document number exactly as written above:
{
  "summaries": {
    "${rules[0]?.documentNumber ?? "2026-10036"}": { "summary": "...", "whyItMatters": "..." }
  }
}`
}
