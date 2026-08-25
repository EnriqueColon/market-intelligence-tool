/**
 * The definition of "CRE" used everywhere in this tool.
 *
 * Kept in its own module with no imports so it can be unit-tested directly.
 * Getting this wrong is not a cosmetic error: CRE-to-capital is the metric the
 * 300% supervisory screen is measured against, so an inflated numerator moves
 * institutions across a regulatory threshold that they are nowhere near.
 */

export type CreComponents = {
  /** FDIC LNRECONS — construction and land development. */
  constructionLoans: number
  /** FDIC LNREMULT — multifamily. */
  multifamilyLoans: number
  /** FDIC LNRENRES — all non-farm non-residential, owner- and non-owner-occupied. */
  nonResidentialLoans: number
  /** FDIC LNRENROW — the owner-occupied half of LNRENRES. */
  ownerOccupiedLoans: number
  /** FDIC LNRENROT — the non-owner-occupied half of LNRENRES. */
  nonOwnerOccupiedLoans: number
}

/**
 * Follows the 2006 Interagency Guidance on CRE Concentrations: construction and
 * land development, plus multifamily, plus non-owner-occupied non-farm
 * non-residential.
 *
 * Two things this must never do, both of which were live until 2026-08-24 and
 * together reported 63.5% of the American banking system as above the 300%
 * screen — a figure that should be closer to 10%:
 *
 * 1. **Never add LNREOTH.** It is already inside the named components. FDIC's
 *    LNRE (total real estate) equals construction + multifamily +
 *    non-residential + 1-4 family + farmland exactly on 4,335 of 4,352
 *    institutions, so adding LNREOTH counts the same loans a second time. On
 *    its own it pushed 1,498 institutions above the 300% screen that were not
 *    close to it; Napoleon State Bank showed 344% against a true 113%.
 * 2. **Never include owner-occupied commercial property.** A business borrowing
 *    against its own premises is not a CRE concentration exposure, and the
 *    guidance excludes it.
 *
 * Falls back to the undivided `nonResidentialLoans` when the owner-occupied
 * split does not reconcile, which happens for about a dozen institutions.
 * Overstating those few is safer than dropping their commercial exposure.
 */
/**
 * The non-residential figure that counts toward CRE.
 *
 * Shared by the total and the mix so that the parts always sum to the whole.
 * Computing them separately is how a composition chart ends up with bands that
 * do not add to 100%.
 */
function creNonResidential(c: CreComponents): number {
  const splitReconciles =
    c.nonResidentialLoans > 0 &&
    Math.abs(c.ownerOccupiedLoans + c.nonOwnerOccupiedLoans - c.nonResidentialLoans) <= 1

  return splitReconciles ? c.nonOwnerOccupiedLoans : c.nonResidentialLoans
}

export function computeCreLoans(c: CreComponents): number {
  return c.constructionLoans + c.multifamilyLoans + creNonResidential(c)
}

/** Each part of the CRE book as a percentage of it. Sums to 100. */
export type CreMix = {
  construction: number
  multifamily: number
  nonResidential: number
}

/**
 * What an institution's CRE book is made of, or null when it holds no CRE.
 *
 * Only the three components of `computeCreLoans`, because a share is only
 * meaningful against a denominator it belongs to. Two things previously drawn
 * as bands of this chart were not:
 *
 * 1. **LNREOTH, labelled "Other CRE".** It is closed-end 1-4 family
 *    residential — `LNRERES - LNRELOC = LNREOTH` exactly on all 4,352
 *    institutions — so it is not CRE and is not in the denominator.
 * 2. **The undivided LNRENRES.** `computeCreLoans` deliberately excludes
 *    owner-occupied property, so dividing the owner- and non-owner-occupied
 *    total by it counts premises lending the definition just removed.
 *
 * Together these made the stacked bands sum to a median of 255.8%, and to more
 * than 100% on 4,129 of the 4,164 institutions holding any CRE. Thrifts were
 * worst: Liberty Savings Bank FSB, with a large mortgage book and little CRE,
 * summed to 681,607%.
 */
export function computeCreMix(c: CreComponents): CreMix | null {
  const total = computeCreLoans(c)
  if (!(total > 0)) return null

  const share = (part: number) => (part / total) * 100
  return {
    construction: share(c.constructionLoans),
    multifamily: share(c.multifamilyLoans),
    nonResidential: share(creNonResidential(c)),
  }
}
