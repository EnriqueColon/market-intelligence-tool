import "server-only"
import {
  buildCompanyConceptUrl,
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
import {
  registeredVehiclesInScope,
  vehiclesInScope,
  type VehicleQuotation,
} from "@/lib/peer-intel/registry"
import {
  netFlow,
  parseConceptFacts,
  PEER_METRICS,
  toQuarters,
  type QuarterPoint,
} from "@/lib/peer-intel/xbrl"

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

export type CohortOfferings = {
  /** Offering records per vehicle CIK, oldest filing first. */
  byCik: Map<string, OfferingRecord[]>
  /**
   * Vehicles that genuinely could not be read, with the reason. A Reg D fund
   * must have a Form D, so an entry here means a fetch failed or the registry
   * holds the wrong CIK — either way it needs looking at.
   */
  failures: Array<{ cik: string; manager: string; reason: string }>
  /**
   * Registered vehicles with no Form D. **Expected, not a failure**: a listed
   * REIT or non-traded BDC raises through a registered offering rather than
   * Regulation D. Their fundraising is share issuance in the periodic reports
   * step 3 reads. Kept separate so a panel does not report nine problems where
   * there are none.
   */
  noFormD: Array<{ cik: string; manager: string }>
  /** Requests issued, for the cron's budget — see `maxDuration` on warm-cache. */
  requests: number
}

/**
 * Every Form D offering record for every vehicle in a layer.
 *
 * This is the one expensive call in the tracker. Each vehicle needs one
 * submissions request plus one per Form D filing, because the offering figures
 * live in each filing's own XML and there is no bulk form of them. For the
 * national layer that is roughly 65 vehicles and 250-350 requests; at the
 * rate-limit spacing in `edgar-contract.ts` it runs in about a minute, which
 * fits inside warm-cache's 300-second ceiling with room to spare.
 *
 * A vehicle that fails is recorded in `failures` and omitted from `byCik`, so
 * the aggregation skips it rather than reading it as a manager who raised
 * nothing. The caller decides whether a partial cohort is worth caching.
 */
export async function fetchCohortOfferings(layer: PeerLayer): Promise<CohortOfferings> {
  const byCik = new Map<string, OfferingRecord[]>()
  const failures: CohortOfferings["failures"] = []
  const noFormD: CohortOfferings["noFormD"] = []
  let requests = 0

  for (const vehicle of vehiclesInScope(layer)) {
    try {
      const profile = await fetchFilerProfile(vehicle.cik)
      requests++
      if (!profile.formD.length) {
        // A registered vehicle without a Form D is raising through a
        // registered offering, which is normal; a private one without a Form D
        // should not exist.
        if (vehicle.kind === "registered" || profile.kind === "registered") {
          noFormD.push({ cik: vehicle.cik, manager: vehicle.manager })
        } else {
          failures.push({ cik: vehicle.cik, manager: vehicle.manager, reason: "no Form D filings" })
        }
        continue
      }
      const records = await fetchOfferingHistory(profile)
      requests += profile.formD.length
      if (!records.length) {
        failures.push({ cik: vehicle.cik, manager: vehicle.manager, reason: "no readable Form D" })
        continue
      }
      byCik.set(vehicle.cik, records)
    } catch (error) {
      failures.push({
        cik: vehicle.cik,
        manager: vehicle.manager,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { byCik, failures, noFormD, requests }
}

export type VehicleMetrics = {
  cik: string
  manager: string
  vehicleName: string
  /** Quarterly series per metric key; a metric the filer does not tag is absent. */
  series: Record<string, QuarterPoint[]>
  /** Which concept answered for each metric, for the provenance disclosure. */
  resolvedConcepts: Record<string, string>
  /** Metric keys the filer tags under no candidate concept. */
  missingMetrics: string[]
  /**
   * Whether the vehicle's shares trade, carried through because it decides what
   * the flows mean.
   */
  quoted?: VehicleQuotation
  /**
   * Capital in less capital out, per quarter. Empty when either side is
   * missing, **and empty for a listed vehicle**: there, issuance and
   * repurchases are an equity raise and a buyback rather than subscriptions and
   * redemptions, so a net figure would read as investor demand when it is a
   * capital-markets decision.
   */
  netFlow: QuarterPoint[]
}

/**
 * The quarterly series for one registered vehicle.
 *
 * One request per metric, not one for the whole entity: `companyfacts` returns
 * every concept a filer has ever tagged, which for Blue Owl is 570 KB against
 * 4.9 KB for a single concept — 117x the payload for data we discard. The
 * `frames` API would be fewer requests still but cannot read these filers at
 * all; `edgar-contract.ts` carries that measurement.
 *
 * A 404 on a concept means the filer does not tag it, which is ordinary and
 * common — coverage across the tier runs from 12/12 for share issuance down to
 * 2/12 for payment-in-kind income. It is recorded in `missingMetrics` rather
 * than thrown, so a panel can say the figure is not reported instead of showing
 * a zero.
 */
export async function fetchVehicleMetrics(vehicle: {
  cik: string
  manager: string
  name: string
  quoted?: VehicleQuotation
}): Promise<VehicleMetrics> {
  const series: Record<string, QuarterPoint[]> = {}
  const resolvedConcepts: Record<string, string> = {}
  const missingMetrics: string[] = []

  for (const metric of PEER_METRICS) {
    let resolved = false
    for (const [taxonomy, concept] of metric.candidates) {
      let json: unknown
      try {
        json = await getJson<unknown>(buildCompanyConceptUrl(vehicle.cik, taxonomy, concept))
      } catch {
        // A 404 is the normal answer for a concept this filer does not tag;
        // getText only throws after exhausting retries on transient statuses.
        continue
      }
      const parsed = parseConceptFacts(json)
      if (!parsed?.facts.length) continue
      series[metric.key] = toQuarters(metric.basis, parsed.facts)
      resolvedConcepts[metric.key] = `${taxonomy}:${concept} (${parsed.unit})`
      resolved = true
      break
    }
    if (!resolved) missingMetrics.push(metric.key)
  }

  return {
    cik: vehicle.cik,
    manager: vehicle.manager,
    vehicleName: vehicle.name,
    series,
    resolvedConcepts,
    missingMetrics,
    ...(vehicle.quoted ? { quoted: vehicle.quoted } : {}),
    netFlow:
      vehicle.quoted === "non-traded" && series.subscriptions && series.repurchases
        ? netFlow(series.subscriptions, series.repurchases)
        : [],
  }
}

export type RegisteredTier = {
  vehicles: VehicleMetrics[]
  failures: Array<{ cik: string; manager: string; reason: string }>
  requests: number
}

/**
 * Every registered vehicle in a layer.
 *
 * Only the registered tier is fetched, because a private fund files no periodic
 * report and has none of this to give. In this registry that tier is entirely
 * national, so the Miami-Dade and Florida layers return nothing here — which is
 * the fact the coverage footers have to state rather than leave as an empty
 * chart.
 */
export async function fetchRegisteredTier(layer: PeerLayer): Promise<RegisteredTier> {
  const vehicles: VehicleMetrics[] = []
  const failures: RegisteredTier["failures"] = []
  let requests = 0

  for (const vehicle of registeredVehiclesInScope(layer)) {
    try {
      const metrics = await fetchVehicleMetrics(vehicle)
      requests += PEER_METRICS.length
      vehicles.push(metrics)
    } catch (error) {
      failures.push({
        cik: vehicle.cik,
        manager: vehicle.manager,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { vehicles, failures, requests }
}
