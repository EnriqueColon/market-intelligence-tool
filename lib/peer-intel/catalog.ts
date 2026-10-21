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
 * Form D covers the raise and nothing else. A private fund discloses no
 * portfolio, no performance, no redemption activity and no valuations at any
 * point in its life — those exist only for vehicles that file periodic reports,
 * and in this registry every one of those is in the national layer.
 */
export const PRIVATE_FUND_LIMITS: readonly string[] = [
  "Portfolio composition and credit quality are not reported on Form D.",
  "Performance, IRR and valuations are not reported on Form D.",
  "Redemption and liquidity activity are not reported on Form D; a drawdown fund has none to report.",
  "Amount sold is cumulative and self-reported, and is only as current as the latest amendment.",
]
