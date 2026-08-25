/**
 * Who an institution should be compared against.
 *
 * The screening tab already ranks every institution against the whole scope,
 * which is the right cohort for a screen and the wrong one for underwriting. A
 * $180m single-branch bank in Ocala is not usefully told it sits in the 40th
 * percentile of a set that includes Truist: the comparison is dominated by size
 * and geography rather than by credit.
 *
 * So this narrows on three axes, in decreasing order of how much they matter to
 * an underwriter, and relaxes them one at a time when the narrow cohort is too
 * small to say anything. Which criteria survived is returned alongside the
 * cohort, because "82nd percentile" means something different against nine
 * matched peers than against six hundred unmatched ones.
 */

/** Asset bands, roughly the FFIEC peer-group breaks. Dollars. */
const SIZE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "under $250M", min: 0, max: 250e6 },
  { label: "$250M–$1B", min: 250e6, max: 1e9 },
  { label: "$1B–$3B", min: 1e9, max: 3e9 },
  { label: "$3B–$10B", min: 3e9, max: 10e9 },
  { label: "over $10B", min: 10e9, max: Infinity },
]

/**
 * CRE as a share of total loans. Bands rather than a continuous distance
 * because the question is "does this bank do the same kind of lending", which
 * is categorical: a 5%-CRE consumer lender and a 55%-CRE commercial lender are
 * different businesses, not two points on a scale.
 */
const MIX_BANDS: { label: string; min: number; max: number }[] = [
  { label: "little CRE", min: 0, max: 0.1 },
  { label: "moderate CRE", min: 0.1, max: 0.3 },
  { label: "CRE-significant", min: 0.3, max: 0.5 },
  { label: "CRE-concentrated", min: 0.5, max: Infinity },
]

export function sizeBand(totalAssets: number) {
  return SIZE_BANDS.find((b) => totalAssets >= b.min && totalAssets < b.max) ?? SIZE_BANDS[0]
}

export function creMixBand(creLoans: number, totalLoans: number) {
  const share = totalLoans > 0 ? creLoans / totalLoans : 0
  return MIX_BANDS.find((b) => share >= b.min && share < b.max) ?? MIX_BANDS[0]
}

/** The minimum an assertion about percentile rank should rest on. */
export const MIN_COHORT = 8

export type PeerCandidate = {
  cert: string
  name: string
  state?: string
  totalAssets: number
  creLoans: number
  totalLoans: number
}

export type CohortCriteria = {
  /** Always applied. Size dominates every other comparison. */
  size: boolean
  geography: boolean
  creMix: boolean
}

export type PeerCohort<T extends PeerCandidate> = {
  /** Excludes the subject itself. */
  peers: T[]
  criteria: CohortCriteria
  sizeLabel: string
  mixLabel: string
  stateLabel?: string
  /** Prose describing exactly what the peers have in common with the subject. */
  description: string
  /**
   * Why the cohort is broader than the ideal, or null when nothing was
   * relaxed. Stated rather than left implicit: a percentile against peers
   * matched on all three axes is a different claim from one against peers
   * matched only on size.
   */
  relaxationNote: string | null
}

/**
 * Select peers for `subject` from `universe`, relaxing until the cohort is
 * large enough to rank against.
 *
 * Relaxation order is deliberate. CRE mix goes first because a thin cohort of
 * exactly-matched lenders is less useful than a fuller one of similarly sized
 * local banks. Geography goes second. Size is never dropped — comparing a
 * community bank to a money-centre bank on reserve coverage produces a number
 * that is arithmetically fine and analytically meaningless.
 *
 * If even the size band alone cannot reach `MIN_COHORT`, that cohort is
 * returned as-is rather than widened further, and the caller is expected to say
 * so rather than quoting a percentile off five institutions.
 */
export function selectPeers<T extends PeerCandidate>(
  subject: PeerCandidate,
  universe: T[]
): PeerCohort<T> {
  const size = sizeBand(subject.totalAssets)
  const mix = creMixBand(subject.creLoans, subject.totalLoans)

  const others = universe.filter((c) => c.cert !== subject.cert)
  const inSize = others.filter((c) => {
    const b = sizeBand(c.totalAssets)
    return b.label === size.label
  })
  const inGeography = inSize.filter((c) => c.state === subject.state)
  const inMix = inGeography.filter((c) => creMixBand(c.creLoans, c.totalLoans).label === mix.label)

  const attempts: { peers: T[]; criteria: CohortCriteria }[] = [
    { peers: inMix, criteria: { size: true, geography: true, creMix: true } },
    { peers: inGeography, criteria: { size: true, geography: true, creMix: false } },
    { peers: inSize, criteria: { size: true, geography: false, creMix: false } },
  ]
  const chosen = attempts.find((a) => a.peers.length >= MIN_COHORT) ?? attempts[attempts.length - 1]

  return {
    peers: chosen.peers,
    criteria: chosen.criteria,
    sizeLabel: size.label,
    mixLabel: mix.label,
    stateLabel: subject.state,
    description: describe(chosen.criteria, size.label, mix.label, subject.state),
    relaxationNote: relaxationNote(chosen.criteria, subject.state),
  }
}

function relaxationNote(criteria: CohortCriteria, state: string | undefined): string | null {
  const where = state ? titleCase(state) : "its state"
  if (!criteria.geography) {
    return `Too few institutions this size in ${where} to compare against, so the cohort is national and CRE mix is unmatched.`
  }
  if (!criteria.creMix) {
    return `CRE mix is unmatched — too few institutions this size in ${where} share it.`
  }
  return null
}

function describe(
  criteria: CohortCriteria,
  sizeLabel: string,
  mixLabel: string,
  state: string | undefined
): string {
  const parts = [`institutions with assets ${sizeLabel}`]
  if (criteria.geography && state) parts.push(`in ${titleCase(state)}`)
  if (criteria.creMix) parts.push(`that are also ${mixLabel}`)
  if (!criteria.geography) parts.push("nationally")
  return parts.join(" ")
}

/** FDIC returns state names shouted. Everywhere else in the tool they are not. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join("")
}

/**
 * Where `value` sits in `cohort`, 0–1, by the midrank convention.
 *
 * Shares its definition with `opportunity-score.ts` deliberately: two
 * percentiles shown on the same screen that disagree about how ties are handled
 * is a bug report waiting to happen. Returns null rather than a number when the
 * cohort is too small to support the claim.
 */
export function percentileIn(cohort: number[], value: number): number | null {
  const values = cohort.filter((v) => Number.isFinite(v))
  if (values.length < MIN_COHORT) return null
  let below = 0
  let equal = 0
  for (const v of values) {
    if (v < value) below++
    else if (v === value) equal++
  }
  return (below + equal / 2) / values.length
}

/** Middle value, or null when there is nothing to take a middle of. */
export function medianOf(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const mid = Math.floor(clean.length / 2)
  return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid]
}
