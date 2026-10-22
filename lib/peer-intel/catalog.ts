/**
 * Provenance for every figure the peer tracker puts on screen.
 *
 * The same rule the Market Analytics tab works under: every value traces to a
 * named source field, and anything computed rather than reported is marked
 * `derived` and carries its formula. The bank-behaviour equivalent is
 * `BEHAVIOR_FIELD_CATALOG` in `lib/analytics/bank-behavior.ts`; this is the
 * Form D side of the same discipline.
 *
 * Two things make provenance matter more here than for Call Report data.
 * Form D is **self-reported by the issuer and not audited**, so a figure can be
 * stale, rounded or simply wrong, and the filing it came from has to stay one
 * click away. And the form's own vocabulary is misleading in places —
 * `totalOfferingAmount` is a cap the issuer set, not a target it is working
 * towards, and it is frequently the word "Indefinite" rather than a number.
 *
 * Dollar figures are in dollars, as Form D reports them — not thousands, which
 * is how FDIC reports and how the rest of this codebase's analytics read.
 */

export type PeerFieldBasis =
  /** Taken from a single filing, as of that filing's date. */
  | "filing"
  /** Computed across a vehicle's filing trail. */
  | "trail"
  /** Computed across the vehicles in a layer. */
  | "cohort"

export type PeerFieldKind = "reported" | "derived"

export type PeerFieldSpec = {
  /** The property name on `OfferingRecord`, `Raise`, `ManagerRaises` or `PeerCohort`. */
  key: string
  label: string
  /** The Form D XML element, or the formula when derived. */
  source: string
  basis: PeerFieldBasis
  kind: PeerFieldKind
  /** Anything a reader would be misled by without it. */
  caveat?: string
}

function reported(
  key: string,
  element: string,
  label: string,
  basis: PeerFieldBasis,
  caveat?: string
): PeerFieldSpec {
  return { key, label, source: element, basis, kind: "reported", ...(caveat ? { caveat } : {}) }
}

function derived(key: string, formula: string, label: string, basis: PeerFieldBasis, caveat?: string): PeerFieldSpec {
  return { key, label, source: formula, basis, kind: "derived", ...(caveat ? { caveat } : {}) }
}

export const PEER_FIELD_CATALOG: readonly PeerFieldSpec[] = [
  // ---------------------------------------------------- straight from a filing
  reported("entityName", "entityName", "Fund legal name", "filing"),
  reported("jurisdiction", "jurisdictionOfInc", "Jurisdiction of organisation", "filing"),
  reported(
    "offeringAmount",
    "totalOfferingAmount",
    "Offering amount",
    "filing",
    'A cap the issuer set, not a target it is working towards, and routinely the literal string "Indefinite" for open-ended vehicles. Treated as the value "indefinite", against which no percentage is computed.'
  ),
  reported(
    "totalSold",
    "totalAmountSold",
    "Amount sold",
    "filing",
    "Cumulative since the offering opened, not a period figure. Self-reported and unaudited."
  ),
  reported("remaining", "totalRemaining", "Amount remaining", "filing", 'Also "Indefinite" where the offering is.'),
  reported(
    "investorCount",
    "totalNumberAlreadyInvested",
    "Investors",
    "filing",
    "Counts investors in this vehicle only. A fund raising through several sleeves reports each separately, so a manager-level sum is not a count of distinct LPs."
  ),
  reported("minimumInvestment", "minimumInvestmentAccepted", "Minimum investment accepted", "filing"),
  reported(
    "dateOfFirstSale",
    "dateOfFirstSale",
    "Date of first sale",
    "filing",
    'Absent while the issuer has selected "yet to occur", which is normal for a filing made before the first close.'
  ),
  reported("industryGroup", "industryGroupType", "Industry group", "filing"),
  reported(
    "fundType",
    "investmentFundType",
    "Fund type",
    "filing",
    "The issuer's own classification. Useful as a discriminator — it is what identifies a venture fund whose name suggests otherwise — but it is a self-selected label, not a verified strategy."
  ),
  reported("formType", "form type on the filing index", "Filing type (D or D/A)", "filing"),
  reported("filedAt", "filing date on the filing index", "Filed", "filing"),

  // ------------------------------------------------- computed across the trail
  derived(
    "target",
    "offeringAmount of the newest filing in the trail",
    "Current offering amount",
    "trail",
    "An amendment may raise or lower it; `targetHigh` records the largest ever stated."
  ),
  derived("sold", "totalSold of the newest filing in the trail", "Raised to date", "trail"),
  derived(
    "progress",
    "sold / target, null when target is indefinite or either side is missing",
    "Share of offering sold",
    "trail",
    "Never computed against an indefinite offering amount."
  ),
  derived(
    "averageTicket",
    "sold / investorCount of the newest filing",
    "Average commitment",
    "trail",
    "A mean, so a single anchor investor pulls it well above the typical cheque."
  ),
  derived(
    "soldLastYear",
    "sold (newest) − sold (the latest filing at least nine months earlier)",
    "Raised in the last twelve months",
    "trail",
    "Null when no filing sits far enough back to measure against, rather than a zero that would read as a stalled raise."
  ),
  derived(
    "investorsLastYear",
    "investorCount (newest) − investorCount (same prior filing as soldLastYear)",
    "Investors added in the last twelve months",
    "trail"
  ),
  derived(
    "targetCut",
    "any filing in the trail states a larger offeringAmount than the newest",
    "Offering amount reduced",
    "trail",
    "A reduction is a deliberate act by the issuer and is not otherwise announced; it is the strongest single read on a raise going badly."
  ),
  derived("targetHigh", "max numeric offeringAmount across the trail, when reduced since", "Previous offering amount", "trail"),
  derived(
    "quartersSinceFiling",
    "whole quarters between the newest filing and the as-of date",
    "Quarters since last filing",
    "trail"
  ),
  derived(
    "isLikelyOpen",
    "quartersSinceFiling < 4",
    "Raise still open",
    "trail",
    "Inferred, not reported: Form D carries no closed flag, and the annual amendment is mandatory while an offering is open, so four quarters of silence means it is not. A fund that closed the day after its last amendment reads as open for a year."
  ),
  derived(
    "isNewLaunch",
    "dateOfFirstSale, or the first filing date when absent, falls inside the window",
    "New launch",
    "trail"
  ),

  // ------------------------------------------------- vintage pacing, per manager
  derived(
    "vintageOrdinal",
    "rank of the fund by dateOfFirstSale (or first filing) among the manager's fund-role vehicles",
    "Vintage",
    "trail",
    "Derived from dates, never read from the name — a manager's \"Fund VI\" may be its fourth filer, and its \"Fund 1\" may be the newest. Sleeves are left out, because the registry holds no link to their parent fund."
  ),
  derived(
    "monthsIn",
    "whole months from dateOfFirstSale (or first filing) to the newest filing that reports totalSold",
    "Months in market",
    "trail",
    "A filing dated before the first sale reads as month 0."
  ),
  derived(
    "pace",
    "sold (newest vintage) ÷ sold (prior vintage at the same month, read from a filing at that month or a straight line between the two filings either side of it)",
    "Pace against the prior vintage",
    "trail",
    "Trails are sparse, so the prior's figure is usually interpolated; the panel says which two filings it sits between. Null when the prior's trail does not reach that month — nothing is extrapolated."
  ),

  // --------------------------------------------- computed across a manager/layer
  derived(
    "totalRaised",
    "sum of sold across every vehicle, sleeves included",
    "Capital raised",
    "cohort",
    "Sleeves are included because that is where part of a raise's capital is reported. It is capital raised across all vintages in the registry, not assets under management."
  ),
  derived(
    "totalSought",
    "sum of numeric target across fund-role vehicles only",
    "Capital sought",
    "cohort",
    "Excludes vehicles with an indefinite offering amount; `indefiniteTargets` counts them, so the figure is never read as the whole market's ask."
  ),
  derived(
    "activeRaiseCount",
    "count of fund-role vehicles where isLikelyOpen",
    "Raises open",
    "cohort",
    "Counts raises, not filers: a fund spread across an onshore LP and three sleeves counts once."
  ),
  derived("newLaunchCount", "count of fund-role vehicles where isNewLaunch", "Launches in the window", "cohort"),
  derived("targetCutCount", "count of fund-role vehicles where targetCut", "Offering amounts reduced", "cohort"),
  derived(
    "managersRaising",
    "count of managers with at least one open fund-role raise",
    "Managers in market",
    "cohort"
  ),
]

const BY_KEY = new Map(PEER_FIELD_CATALOG.map((spec) => [spec.key, spec]))

export function peerFieldSpec(key: string): PeerFieldSpec | undefined {
  return BY_KEY.get(key)
}

/** Every derived figure's formula, for the "how this is computed" disclosure. */
export function derivedFields(): PeerFieldSpec[] {
  return PEER_FIELD_CATALOG.filter((spec) => spec.kind === "derived")
}

/**
 * What the tracker cannot see, stated once so every panel can say it rather
 * than render an empty chart.
 *
 * **Two different reasons are deliberately kept apart here**, because they read
 * very differently to anyone deciding how much weight to give a blank.
 *
 * Most of these are *reporting* limits: the figures exist, the fund computes
 * them, its auditors check them and its investors receive them — they are
 * simply not public, because Regulation D carries no public reporting
 * obligation and the detailed data larger advisers file on Form PF is held
 * confidentially by the SEC. Saying a private fund "has no" portfolio or
 * performance would be wrong; it has both and does not publish them.
 *
 * Only the redemption line is *structural*: a drawdown fund's partnership
 * agreement grants no redemption right, so there is genuinely no programme to
 * report. Even there the limit is narrower than it first appears, since
 * secondaries and GP-led continuation vehicles move interests without any
 * filing recording it.
 */
export const PRIVATE_FUND_LIMITS: readonly string[] = [
  "Portfolio composition and credit quality are not public. The fund knows them and its auditors see them — Regulation D simply carries no public reporting obligation.",
  "Performance, IRR and valuations are not public. A private fund strikes a net asset value quarterly and reports it to its own investors, not to anyone else.",
  "Larger advisers do file detailed portfolio and leverage data with the SEC on Form PF. The SEC holds it confidentially rather than publishing it, so it cannot be read here.",
  "A drawdown fund has no redemption programme — its partnership agreement grants no redemption right, which is structural rather than a disclosure choice. That is not the same as its investors having no exit: interests change hands through secondary sales and GP-led continuation vehicles, and no filing records either.",
  "Amount sold is cumulative and self-reported, and is only as current as the latest amendment.",
]
