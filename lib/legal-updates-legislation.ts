/**
 * Federal bills for the Legislative Tracker, taken from the legislative record.
 *
 * The other two sections ask a model what happened and then check the answer. For legislation that
 * order was the wrong way round, and `legal-updates-bills.ts` records what it cost: asked for
 * recent CRE bills, the model returned four plausible sequential numbers with invented titles, and
 * did it again on a second run. Catching that leaves the section empty, which is honest but not
 * the tool.
 *
 * A bill is a matter of record, so there is no reason to ask. govtrack publishes the record openly,
 * and here it supplies the number, the title, the status and the date of the last action. The model
 * is left with the one job it is actually good at — explaining what a real bill means for this firm
 * — and has no opportunity to invent an identity, because it is never asked for one.
 *
 * Florida is not covered. There is no open API for the Florida legislature, so those items are
 * still discovered and then verified against the cited page; see `verifyBill`.
 */

export type SourcedBill = {
  /** As the record prints it: "H.R. 7730". */
  displayNumber: string
  title: string
  /** Human-readable status from the record: "Passed House & Senate (President next)". */
  statusLabel: string
  /** Date of the most recent action, which is what the feed dates the item to. */
  statusDate: string
  url: string
  sponsor?: string
}

/**
 * govtrack's `q` is a full-text search over the bill, not the title, so these are wide on purpose:
 * they exist to surface candidates, and the title gate below is what decides. Searching
 * "commercial real estate" returns the Agricultural Act because the phrase appears somewhere in
 * it — which is why relevance is never taken from the search.
 */
const SEARCH_QUERIES = [
  "commercial real estate",
  "commercial mortgage",
  "foreclosure",
  "receivership",
  "distressed debt",
  "loan modification",
  "real estate lending",
  "bankruptcy",
  "appraisal",
  "commercial property",
  "note sale",
  "loan-to-value",
]

/** The 1st Congress convened in 1789 and each runs two years. */
function currentCongress(now: Date): number {
  return Math.floor((now.getFullYear() - 1789) / 2) + 1
}

type GovTrackBill = {
  display_number?: string
  title_without_number?: string
  title?: string
  current_status_label?: string
  current_status_date?: string
  link?: string
  sponsor?: { name?: string }
}

export function toSourcedBill(raw: GovTrackBill): SourcedBill | null {
  const displayNumber = raw.display_number?.trim()
  const title = (raw.title_without_number || raw.title)?.trim()
  const statusDate = raw.current_status_date?.slice(0, 10)
  if (!displayNumber || !title || !statusDate || !raw.link) return null
  return {
    displayNumber,
    title,
    statusLabel: raw.current_status_label?.trim() || "In committee",
    statusDate,
    url: raw.link,
    sponsor: raw.sponsor?.name?.trim() || undefined,
  }
}

/**
 * Relevance is judged on the authoritative title and nothing else.
 *
 * This is stricter than it could be and the cost is known: H.R. 10375 modernises the SBA 504
 * programme, which is commercial real estate lending, and nothing in any of its titles says so.
 * The alternative is asking a model to judge, which is how invented items got in. A real bill
 * missed is recoverable; a fabricated one quoted in a credit memo is not.
 *
 * The test is passed in rather than imported so that this module owns no policy: the feed already
 * has one gate deciding what bears on the firm, and a second copy here could disagree with it.
 */
export function selectRelevantBills(
  bills: SourcedBill[],
  isRelevant: (title: string) => boolean,
  limit = 5
): SourcedBill[] {
  return bills
    .filter((b) => isRelevant(b.title))
    .sort((a, b) => b.statusDate.localeCompare(a.statusDate))
    .slice(0, limit)
}

/**
 * Titles differing only in their session year are the same legislation reintroduced, and a
 * companion bill carries the same title in the other chamber. Both read as duplicates on the page.
 */
export function normalizeBillTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bof \d{4}\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Two rounds, because a bill repeats for two different reasons.
 *
 * It surfaces under several of the twelve searches, which is the same bill twice. And the House and
 * Senate move companion bills with identical titles, which is one piece of legislation in two
 * chambers — "Bankruptcy Threshold Adjustment Act" arrived as both H.R. 7730 and S. 3977. Showing
 * both is the padding this feed is supposed to have stopped doing, so the one with the later action
 * wins: it is the copy that has actually moved.
 */
export function dedupeBills(bills: SourcedBill[]): SourcedBill[] {
  const keep = (map: Map<string, SourcedBill>, key: string, bill: SourcedBill) => {
    const existing = map.get(key)
    if (!existing || bill.statusDate > existing.statusDate) map.set(key, bill)
  }

  const byNumber = new Map<string, SourcedBill>()
  for (const bill of bills) keep(byNumber, bill.displayNumber, bill)

  const byTitle = new Map<string, SourcedBill>()
  for (const bill of byNumber.values()) keep(byTitle, normalizeBillTitle(bill.title), bill)

  return [...byTitle.values()]
}

async function searchBills(
  query: string,
  congress: number,
  since: string,
  timeoutMs: number
): Promise<SourcedBill[]> {
  const url =
    `https://www.govtrack.us/api/v2/bill?congress=${congress}` +
    `&q=${encodeURIComponent(query)}&current_status_date__gte=${since}` +
    `&order_by=-current_status_date&limit=25`
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MarketIntelligenceTool/1.0)" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
    if (!res.ok) return []
    const data = (await res.json()) as { objects?: GovTrackBill[] }
    return (data.objects ?? []).map(toSourcedBill).filter((b): b is SourcedBill => b !== null)
  } catch {
    return []
  }
}

/**
 * One query failing is not the section failing — these are twelve independent searches over the
 * same record, so a timeout on one costs some recall and nothing else.
 */
export async function fetchFederalBills(
  now: Date,
  windowDays: number,
  isRelevant: (title: string) => boolean,
  limit = 5,
  timeoutMs = 15_000
): Promise<SourcedBill[]> {
  const congress = currentCongress(now)
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10)
  const batches = await Promise.all(
    SEARCH_QUERIES.map((q) => searchBills(q, congress, since, timeoutMs))
  )
  return selectRelevantBills(dedupeBills(batches.flat()), isRelevant, limit)
}

/**
 * What the item says before a model has seen it.
 *
 * Written from the record alone so that a failed or skipped summarisation step degrades to a
 * thinner item rather than no item. Everything here is quotable: it is the bill's own number,
 * title, status and sponsor.
 */
export function describeFromRecord(bill: SourcedBill): string {
  const sponsor = bill.sponsor ? ` Sponsored by ${bill.sponsor}.` : ""
  return `${bill.displayNumber}, ${bill.title}. Status as of ${bill.statusDate}: ${bill.statusLabel}.${sponsor}`
}

/**
 * Asks only for prose, and supplies the facts.
 *
 * The bills are given rather than searched for, so there is nothing to look up and no reason to
 * reach for the web. Keyed by bill number on the way back so a reordered or partial answer still
 * lands on the right bill.
 */
export function buildBillSummaryPrompt(bills: SourcedBill[]): string {
  const list = bills
    .map((b) => `- ${b.displayNumber}: ${b.title} (status: ${b.statusLabel}, as of ${b.statusDate})`)
    .join("\n")

  return `These are real federal bills, taken from the legislative record. Their numbers, titles, statuses and dates are already confirmed — do not restate, correct or change them, and do not add bills.

${list}

For each one, write two things for a firm that buys and works out distressed commercial real estate debt:
- "summary": 2-3 sentences in plain English on what the bill would actually do.
- "whyItMatters": 1-2 sentences on the consequence for note purchases, workouts, foreclosures or REO. If the honest answer is that the effect is indirect or minimal, say that instead of inflating it.

Where a bill's effect on commercial real estate is incidental, say so plainly. An item that explains why it is marginal is more useful than one that pretends otherwise.

Return ONLY valid JSON, keyed by bill number exactly as written above:
{
  "summaries": {
    "${bills[0]?.displayNumber ?? "H.R. 1234"}": { "summary": "...", "whyItMatters": "..." }
  }
}`
}
