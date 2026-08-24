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
export function computeCreLoans(c: CreComponents): number {
  const splitReconciles =
    c.nonResidentialLoans > 0 &&
    Math.abs(c.ownerOccupiedLoans + c.nonOwnerOccupiedLoans - c.nonResidentialLoans) <= 1

  const nonResidential = splitReconciles ? c.nonOwnerOccupiedLoans : c.nonResidentialLoans
  return c.constructionLoans + c.multifamilyLoans + nonResidential
}
