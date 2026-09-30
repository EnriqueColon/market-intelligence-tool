/**
 * Florida bills for the Legislative Tracker, taken from the legislative record.
 *
 * `legal-updates-legislation.ts` says Florida is not covered because there is no open API for the
 * Florida legislature. That was true of the *free and keyless* options, and it left Florida as the
 * half of the section the model still invented. It turns out `LEGISCAN_API_KEY` has been sitting in
 * the environment since the project was set up, listed as required in a deployment checklist and
 * read by nothing — `confluence.md` recorded that it was unused. It works, and LegiScan indexes
 * Florida completely, so the same correction applies here as applied to federal bills.
 *
 * Two calls per session rather than a search: `getMasterList` returns every bill in a session with
 * its title, official description, status and last action, which is one request instead of a dozen
 * searches, and it cannot miss a bill because a search term did not happen to appear in it. The
 * per-bill call is made only for the handful that survive the gate, because only they need a
 * citation — `state_link`, which points at flsenate.gov.
 */

export type SourcedFloridaBill = {
  /** As Florida prints it: "SB 300", "HB 1423". */
  displayNumber: string
  title: string
  /** Human-readable status: "Passed", "Died in Rules". */
  statusLabel: string
  /** Date of the most recent action, which is what the feed dates the item to. */
  statusDate: string
  /** The flsenate.gov page for the bill, which is what the tab cites. */
  url: string
  /** The legislature's own description. Authoritative text, so the gate may read it. */
  description?: string
  chamber: "senate" | "house"
  sessionName: string
}

/**
 * LegiScan's `status` is an integer with a fixed meaning across every state. `last_action` is
 * richer where it exists ("Died in Rules", "Chapter No. 2026-207") and is preferred; this is the
 * fallback, and the reason nothing depends on the integer alone.
 */
const STATUS_LABELS: Record<number, string> = {
  1: "Introduced",
  2: "Engrossed",
  3: "Enrolled",
  4: "Passed",
  5: "Vetoed",
  6: "Failed",
}

/**
 * LegiScan hands back the legislature's text with HTML entities still in it — "clerk&#39;s office"
 * rendered literally on the tab. Only the handful of entities that actually appear in bill text;
 * this is not a general HTML decoder and does not need to be.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
}

/**
 * LegiScan numbers Florida bills `H0011` and `S0274`; Florida itself writes "HB 11" and "SB 274",
 * and so does flsenate.gov. The conversion matters beyond presentation: the bill-identity guard
 * reads the number back out of the title and looks for it on the cited page, and it is looking for
 * the form the page actually prints.
 */
export function toDisplayNumber(legiscanNumber: string): string | null {
  const m = /^([HS])(\d+)([A-Z]*)$/i.exec(legiscanNumber.trim())
  if (!m) return null
  const chamber = m[1].toUpperCase() === "S" ? "SB" : "HB"
  const number = String(Number(m[2]))
  if (number === "0" || number === "NaN") return null
  // A special-session suffix is part of the number, not decoration: flsenate prints "HB 1F".
  return `${chamber} ${number}${m[3].toUpperCase()}`
}

/**
 * Florida numbers its local bills in the 4000s — bills affecting one county, city or special
 * district. Of the 53 in the 2026 regular session, 48 name a county, city, town, village or
 * authority in the title ("Pace Fire Rescue District, Santa Rosa County"), and none is about
 * commercial real estate.
 *
 * They are excluded because they reach the gate by accident: the boilerplate describing a
 * district's boundaries and taxing powers mentions industrial property, which is enough for a term
 * match and tells a note buyer nothing. Checked against the whole window, excluding them costs no
 * item that would otherwise have qualified.
 */
export function isLocalBill(displayNumber: string): boolean {
  const m = /^[HS]B (\d+)/.exec(displayNumber)
  if (!m) return false
  const n = Number(m[1])
  return n >= 4000 && n <= 4999
}

/**
 * The reviser's bills, titled simply "Florida Statutes". Six of them in the 2026 session, adopting
 * the year's statutes and deleting provisions that "have become inoperative by noncurrent repeal"
 * — which is a term match on `noncurrent` and not a change to anything. They are housekeeping, and
 * a reader who wants them is reading the statutes, not this tab.
 */
export function isReviserBill(title: string): boolean {
  const t = title.trim().toLowerCase()
  return t === "florida statutes" || t === "revision of the florida statutes"
}

type MasterListBill = {
  bill_id?: number
  number?: string
  title?: string
  description?: string
  status?: number
  status_date?: string
  last_action?: string
  last_action_date?: string
}

export type FloridaCandidate = {
  billId: number
  displayNumber: string
  title: string
  description?: string
  statusLabel: string
  statusDate: string
  chamber: "senate" | "house"
  sessionName: string
}

/**
 * A master-list row turned into a candidate, or `null` where the row cannot be trusted.
 *
 * The structural exclusions happen here rather than in the relevance gate, because they are facts
 * about what kind of bill this is rather than judgements about its subject.
 */
export function toCandidate(raw: MasterListBill, sessionName: string): FloridaCandidate | null {
  const displayNumber = raw.number ? toDisplayNumber(raw.number) : null
  const title = raw.title ? decodeEntities(raw.title).trim() : undefined
  const statusDate = (raw.last_action_date || raw.status_date)?.slice(0, 10)
  if (!displayNumber || !title || !statusDate || !raw.bill_id) return null
  if (isLocalBill(displayNumber) || isReviserBill(title)) return null

  return {
    billId: raw.bill_id,
    displayNumber,
    title,
    description: raw.description ? decodeEntities(raw.description).trim() || undefined : undefined,
    statusLabel: raw.last_action ? decodeEntities(raw.last_action).trim() : STATUS_LABELS[raw.status ?? 0] || "Introduced",
    statusDate,
    chamber: displayNumber.startsWith("S") ? "senate" : "house",
    sessionName,
  }
}

async function getJson(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MarketIntelligenceTool/1.0)" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

type SessionRow = { session_id?: number; session_name?: string; year_end?: number }

/**
 * Sessions whose final year could still hold an action inside the window.
 *
 * Florida runs a regular session and any number of special ones — eight sessions fall inside a
 * 400-day window — and a bill's last action can postdate the session that produced it, so the
 * filter is deliberately loose at the session level and exact at the bill level.
 */
export function selectSessions(sessions: SessionRow[], sinceYear: number): number[] {
  return sessions
    .filter((s) => typeof s.session_id === "number" && (s.year_end ?? 0) >= sinceYear)
    .map((s) => s.session_id as number)
}

/** The `masterlist` object carries a `session` entry alongside the bills; it is not a bill. */
function billRows(masterlist: unknown): MasterListBill[] {
  if (!masterlist || typeof masterlist !== "object") return []
  return Object.entries(masterlist as Record<string, unknown>)
    .filter(([key]) => key !== "session")
    .map(([, value]) => value as MasterListBill)
}

/**
 * Candidates across every session in the window, already structurally filtered and date-bounded.
 *
 * Separated from the relevance step so that the expensive part — one `getBill` call per survivor —
 * happens only for bills that will actually be shown.
 */
export async function fetchFloridaCandidates(
  apiKey: string,
  now: Date,
  windowDays: number,
  timeoutMs = 20_000
): Promise<FloridaCandidate[]> {
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10)
  const base = `https://api.legiscan.com/?key=${encodeURIComponent(apiKey)}`

  const list = (await getJson(`${base}&op=getSessionList&state=FL`, timeoutMs)) as {
    sessions?: SessionRow[]
  } | null
  const sessionIds = selectSessions(list?.sessions ?? [], Number(since.slice(0, 4)))
  if (sessionIds.length === 0) return []

  const perSession = await Promise.all(
    sessionIds.map(async (id) => {
      const data = (await getJson(`${base}&op=getMasterList&id=${id}`, timeoutMs)) as {
        masterlist?: Record<string, unknown>
      } | null
      const sessionRow = data?.masterlist?.session as { session_name?: string } | undefined
      const sessionName = sessionRow?.session_name?.trim() || "Florida Legislature"
      return billRows(data?.masterlist)
        .map((row) => toCandidate(row, sessionName))
        .filter((c): c is FloridaCandidate => c !== null && c.statusDate >= since)
    })
  )

  return perSession.flat()
}

type BillDetail = {
  state_link?: string
  url?: string
  status?: number
  status_date?: string
  description?: string
}

/**
 * The citation, fetched only for bills that survived the gate.
 *
 * `state_link` is the legislature's own page and is what the tab cites; it is also on the
 * legislative allowlist, which LegiScan's own domain is not. A bill without one is dropped rather
 * than cited to LegiScan, because the point of this section is to point at the record itself.
 */
async function attachUrl(
  apiKey: string,
  candidate: FloridaCandidate,
  timeoutMs: number
): Promise<SourcedFloridaBill | null> {
  const data = (await getJson(
    `https://api.legiscan.com/?key=${encodeURIComponent(apiKey)}&op=getBill&id=${candidate.billId}`,
    timeoutMs
  )) as { bill?: BillDetail } | null

  const url = data?.bill?.state_link?.trim()
  if (!url) return null

  return {
    displayNumber: candidate.displayNumber,
    title: candidate.title,
    statusLabel: candidate.statusLabel,
    statusDate: candidate.statusDate,
    url,
    description:
      candidate.description ||
      (data?.bill?.description ? decodeEntities(data.bill.description).trim() : undefined) ||
      undefined,
    chamber: candidate.chamber,
    sessionName: candidate.sessionName,
  }
}

export function selectRelevantFloridaBills(
  candidates: FloridaCandidate[],
  isRelevant: (item: { title?: string; summary?: string }) => boolean,
  limit = 5
): FloridaCandidate[] {
  return candidates
    .filter((c) => isRelevant({ title: c.title, summary: c.description }))
    .sort((a, b) => b.statusDate.localeCompare(a.statusDate))
    .slice(0, limit)
}

/**
 * Relevant Florida bills with a citation, or an empty list.
 *
 * Returns nothing rather than throwing when the key is absent, so a deployment without it shows an
 * empty Florida side and a note, not an error. Over a 400-day window this reduces 1,930 bills with
 * an action to roughly half a dozen.
 */
export async function fetchFloridaBills(
  apiKey: string | undefined,
  now: Date,
  windowDays: number,
  isRelevant: (item: { title?: string; summary?: string }) => boolean,
  limit = 5,
  timeoutMs = 20_000
): Promise<SourcedFloridaBill[]> {
  if (!apiKey?.trim()) return []

  const candidates = await fetchFloridaCandidates(apiKey, now, windowDays, timeoutMs)
  const relevant = selectRelevantFloridaBills(candidates, isRelevant, limit)
  const withUrls = await Promise.all(relevant.map((c) => attachUrl(apiKey, c, timeoutMs)))
  return withUrls.filter((b): b is SourcedFloridaBill => b !== null)
}

/** What the item says before a model has seen it. Everything here is the bill's own. */
export function describeFloridaFromRecord(bill: SourcedFloridaBill): string {
  if (bill.description) return bill.description
  return `${bill.displayNumber}, ${bill.title} (${bill.sessionName}). Status as of ${bill.statusDate}: ${bill.statusLabel}.`
}

/** Asks only for prose, and supplies the facts. Keyed by bill number on the way back. */
export function buildFloridaSummaryPrompt(bills: SourcedFloridaBill[]): string {
  const list = bills
    .map(
      (b) =>
        `- ${b.displayNumber} [${b.sessionName}, status: ${b.statusLabel}, as of ${b.statusDate}]: ${b.title}\n  Official description: ${b.description || "(none published)"}`
    )
    .join("\n")

  return `These are real Florida bills, taken from the legislative record. Their numbers, titles, statuses and dates are already confirmed — do not restate, correct or change them, and do not add bills.

${list}

For each one, write two things for a firm that buys and works out distressed commercial real estate debt in Florida:
- "summary": 2-3 sentences in plain English on what the bill would actually do. Base this on the official description above; do not introduce facts it does not contain.
- "whyItMatters": 1-2 sentences on the consequence for note purchases, workouts, foreclosures or REO. If the honest answer is that the effect is indirect or minimal, say that instead of inflating it.

A bill that died in committee still matters if it signals where the legislature is heading, but say plainly that it did not pass.

Return ONLY valid JSON, keyed by bill number exactly as written above:
{
  "summaries": {
    "${bills[0]?.displayNumber ?? "SB 300"}": { "summary": "...", "whyItMatters": "..." }
  }
}`
}
