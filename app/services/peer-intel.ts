import "server-only"
import {
  buildFtsUrl,
  buildPrimaryDocUrl,
  buildSubmissionsUrl,
  edgarHeaders,
  isExcludedName,
  layerForLocation,
  REQUEST_SPACING_MS,
  retryDelayMs,
  shouldRetry,
  type FtsQuery,
  type PeerLayer,
} from "@/lib/peer-intel/edgar-contract"
import { parseFormD, type OfferingRecord } from "@/lib/peer-intel/form-d"

/**
 * SEC EDGAR fetchers for the peer tracker.
 *
 * Nothing here is cached, by the same reasoning as `app/services/bank-behavior.ts`:
 * raw filing trails are large and uninteresting, and the reductions built on
 * them (raises, signals, the layer aggregate) are what get stored. Caching
 * happens one level up in `app/actions/peer-intel.ts`.
 *
 * Every request is spaced and retried according to
 * `lib/peer-intel/edgar-contract.ts`, which carries the reasoning for both.
 */

/**
 * SEC wants a contact address in the User-Agent. It is not a secret and not an
 * API key — there is no EDGAR key — so it falls back to a mailbox at the
 * deployment rather than failing closed, which would take the whole tab down
 * over an unset variable that grants nothing.
 */
function contact(): string {
  return process.env.SEC_EDGAR_CONTACT?.trim() || "market-intelligence@safeharborcp.com"
}

let nextSlot = 0

/** Serialises every EDGAR call to one per `REQUEST_SPACING_MS`, process-wide. */
async function rateLimited<T>(run: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + REQUEST_SPACING_MS
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now))
  return run()
}

async function getText(url: string): Promise<string> {
  const headers = edgarHeaders(contact())
  for (let attempt = 1; ; attempt++) {
    const res = await rateLimited(() => fetch(url, { headers, cache: "no-store" }))
    if (res.ok) return res.text()
    if (!shouldRetry(res.status, attempt)) {
      throw new Error(`EDGAR ${res.status} for ${url}`)
    }
    await new Promise((r) => setTimeout(r, retryDelayMs(attempt)))
  }
}

async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await getText(url)) as T
}

export type FtsHit = {
  cik: string
  /** The filer name with EDGAR's trailing `(CIK ...)` removed. */
  name: string
  /** `City, ST`, or null when EDGAR reports no business location. */
  location: string | null
  layer: PeerLayer
  form: string
  accession: string
  filedAt: string
}

type FtsResponse = {
  hits?: {
    total?: { value?: number }
    hits?: Array<{
      _source?: {
        ciks?: string[]
        display_names?: string[]
        biz_locations?: string[]
        form?: string
        adsh?: string
        file_date?: string
      }
    }>
  }
}

function toHit(source: NonNullable<NonNullable<FtsResponse["hits"]>["hits"]>[number]["_source"]): FtsHit | null {
  const s = source ?? {}
  const cik = s.ciks?.[0]
  const accession = s.adsh
  if (!cik || !accession) return null
  const location = s.biz_locations?.[0] ?? null
  return {
    cik: String(Number(String(cik).replace(/\D/g, ""))),
    name: (s.display_names?.[0] ?? "").replace(/\s*\(CIK \d+\)\s*$/, "").trim(),
    location,
    layer: layerForLocation(location),
    form: s.form ?? "",
    accession,
    filedAt: (s.file_date ?? "").slice(0, 10),
  }
}

/** One full-text search page. Callers that want more pass `from`. */
export async function searchFilings(query: FtsQuery): Promise<{ total: number; hits: FtsHit[] }> {
  const data = await getJson<FtsResponse>(buildFtsUrl(query))
  const hits = (data.hits?.hits ?? []).map((h) => toHit(h._source)).filter((h): h is FtsHit => h != null)
  return { total: data.hits?.total?.value ?? 0, hits }
}

export type DiscoveredFiler = {
  cik: string
  name: string
  location: string | null
  layer: PeerLayer
  /** The newest Form D or D/A seen for this filer during discovery. */
  latestFiling: { form: string; accession: string; filedAt: string }
  /** Which name patterns surfaced it, for auditing the discovery query set. */
  matchedPatterns: string[]
}

/**
 * Find Form D filers in a state whose fund *names* look like real-estate credit.
 *
 * Form D full-text search matches the entity name and nothing else, because the
 * form carries no narrative — so this is name-pattern discovery, not semantic
 * search, and `isExcludedName` does the work of keeping Opportunity-Zone, CLO,
 * SPAC and venture funds out of the result. See `edgar-contract.ts` for the
 * measurements behind both facts.
 */
export async function discoverFilers(options: {
  locationCodes: string
  patterns: readonly string[]
  startdt: string
  enddt: string
}): Promise<DiscoveredFiler[]> {
  const byCik = new Map<string, DiscoveredFiler>()
  for (const pattern of options.patterns) {
    let page: { total: number; hits: FtsHit[] }
    try {
      page = await searchFilings({
        q: `"${pattern}"`,
        forms: ["D"],
        locationCodes: options.locationCodes,
        startdt: options.startdt,
        enddt: options.enddt,
      })
    } catch (error) {
      // A pattern that fails after its retries is skipped rather than failing
      // the whole discovery run: the other patterns still produce a usable list.
      console.warn(`peer discovery: pattern "${pattern}" failed`, error)
      continue
    }
    for (const hit of page.hits) {
      if (!hit.name || isExcludedName(hit.name)) continue
      const existing = byCik.get(hit.cik)
      if (!existing) {
        byCik.set(hit.cik, {
          cik: hit.cik,
          name: hit.name,
          location: hit.location,
          layer: hit.layer,
          latestFiling: { form: hit.form, accession: hit.accession, filedAt: hit.filedAt },
          matchedPatterns: [pattern],
        })
        continue
      }
      if (!existing.matchedPatterns.includes(pattern)) existing.matchedPatterns.push(pattern)
      if (hit.filedAt > existing.latestFiling.filedAt) {
        existing.latestFiling = { form: hit.form, accession: hit.accession, filedAt: hit.filedAt }
      }
    }
  }
  return [...byCik.values()].sort((a, b) => (a.latestFiling.filedAt < b.latestFiling.filedAt ? 1 : -1))
}

export type FilingRef = { form: string; accession: string; filedAt: string }

export type FilerProfile = {
  cik: string
  name: string
  location: string | null
  layer: PeerLayer
  /** Every Form D / D/A, newest first. */
  formD: FilingRef[]
  /** Periodic reports that mean the entity reports financials in XBRL. */
  periodic: FilingRef[]
  /**
   * `registered` when the entity files periodic reports (10-Q/10-K/N-CSR/N-CEN),
   * which is what makes quarterly redemption and portfolio figures observable.
   * `private` when it only files Form D — the fundraising view is all there is.
   */
  kind: "registered" | "private"
}

type SubmissionsResponse = {
  name?: string
  addresses?: { business?: { city?: string; stateOrCountry?: string } }
  filings?: { recent?: { form?: string[]; accessionNumber?: string[]; filingDate?: string[] } }
}

const PERIODIC_FORMS = ["10-Q", "10-K", "N-CSR", "N-CSRS", "N-CEN", "N-2"]

/**
 * Everything the tracker needs to know about one filer, from one request.
 *
 * The `kind` decision is made here rather than curated, because it is a fact
 * about what the entity files and it changes when a fund registers a vehicle.
 */
export async function fetchFilerProfile(cik: string): Promise<FilerProfile> {
  const data = await getJson<SubmissionsResponse>(buildSubmissionsUrl(cik))
  const recent = data.filings?.recent
  const forms = recent?.form ?? []
  const accessions = recent?.accessionNumber ?? []
  const dates = recent?.filingDate ?? []

  const formD: FilingRef[] = []
  const periodic: FilingRef[] = []
  for (let i = 0; i < forms.length; i++) {
    const ref = { form: forms[i], accession: accessions[i] ?? "", filedAt: (dates[i] ?? "").slice(0, 10) }
    if (!ref.accession) continue
    if (ref.form === "D" || ref.form === "D/A") formD.push(ref)
    else if (PERIODIC_FORMS.includes(ref.form)) periodic.push(ref)
  }

  const city = data.addresses?.business?.city
  const state = data.addresses?.business?.stateOrCountry
  const location = city && state ? `${city}, ${state}` : null

  return {
    cik: String(Number(cik.replace(/\D/g, ""))),
    name: data.name ?? "",
    location,
    layer: layerForLocation(location),
    formD,
    periodic,
    kind: periodic.length ? "registered" : "private",
  }
}

/**
 * The offering record behind one Form D filing.
 *
 * One request per filing — there is no bulk form of this, because the figures
 * live in the filing's own XML rather than in any index.
 */
export async function fetchOffering(
  cik: string,
  filing: FilingRef,
  location?: string | null
): Promise<OfferingRecord> {
  const xml = await getText(buildPrimaryDocUrl(cik, filing.accession))
  return parseFormD(xml, {
    cik,
    accession: filing.accession,
    formType: filing.form,
    filedAt: filing.filedAt,
    location: location ?? null,
  })
}

/** Every Form D offering record for one filer, oldest first. */
export async function fetchOfferingHistory(profile: FilerProfile): Promise<OfferingRecord[]> {
  const records: OfferingRecord[] = []
  for (const filing of [...profile.formD].reverse()) {
    try {
      records.push(await fetchOffering(profile.cik, filing, profile.location))
    } catch (error) {
      // A single unreadable filing should not lose the rest of the trail; the
      // raise is still computable from the filings that did parse.
      console.warn(`peer intel: ${profile.cik} ${filing.accession} unreadable`, error)
    }
  }
  return records
}
