/**
 * Derivations behind the Market Analytics charts.
 *
 * These live outside the components because two places render the same charts:
 * the on-screen Market Analytics tab and the print view that Playwright turns
 * into the downloadable PDF. Sharing the maths is what keeps the screen and the
 * PDF from disagreeing, which is the failure mode that produced the duplicated
 * and now-deleted capital-analytics-viz component.
 *
 * The shape below is deliberately structural rather than an import of ReportRow,
 * because the dashboard's ScreeningRow and the report's ReportRow are built by
 * different pipelines and only overlap on these fields.
 */

export type AnalyticsChartRow = {
  id: string
  name: string
  totalAssets: number
  opportunityScore: number
  vulnerabilityScore: number
  creConcentration?: number
  creLoans?: number
  constructionLoans?: number
  multifamilyLoans?: number
  nonResidentialLoans?: number
  otherRealEstateLoans?: number
  capitalRatios?: {
    creToTier1Tier2: number | null
    coverage: { hasTier1Tier2: boolean }
  }
}

export type CreToCapitalBar = {
  id: string
  name: string
  value: number
  rank: number
}

export type ExposureMixBar = {
  name: string
  construction: number
  multifamily: number
  nonResidential: number
  otherCre: number
}

export type CapitalScatterPoint = {
  name: string
  creToAssets: number
  creToCap: number
  totalAssets: number
  bubbleSize: number
  vulnerabilityScore: number
}

export type CapitalScatter = {
  points: CapitalScatterPoint[]
  medianCreToAssets: number
  medianCreToCap: number
}

/**
 * Top 20 by capital-adjusted CRE concentration.
 *
 * Falls back to CRE/assets when an institution reports no usable Tier 1 + Tier 2
 * figure, so thin-capital-data banks still rank rather than vanishing.
 */
export function buildCreToCapitalRanking(rows: AnalyticsChartRow[]): CreToCapitalBar[] {
  return rows
    .map((r) => {
      const creToCap = r.capitalRatios?.creToTier1Tier2
      const hasCap = r.capitalRatios?.coverage.hasTier1Tier2
      const value = hasCap && creToCap != null && creToCap > 0 ? creToCap * 100 : (r.creConcentration ?? 0)
      return { id: r.id, name: r.name, value }
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 20)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

/** CRE mix, as percentages of each institution's own CRE book, for the 15 most capital-exposed. */
export function buildExposureMix(rows: AnalyticsChartRow[]): ExposureMixBar[] {
  const ranked = rows
    .filter((r) => r.capitalRatios?.creToTier1Tier2 != null && r.capitalRatios!.creToTier1Tier2! > 0)
    .sort((a, b) => (b.capitalRatios!.creToTier1Tier2 ?? 0) - (a.capitalRatios!.creToTier1Tier2 ?? 0))
    .slice(0, 15)

  return ranked.map((r) => {
    const cre = r.creLoans ?? 0
    const pct = (part: number | undefined) => (cre > 0 ? ((part ?? 0) / cre) * 100 : 0)
    return {
      name: r.name,
      construction: pct(r.constructionLoans),
      multifamily: pct(r.multifamilyLoans),
      nonResidential: pct(r.nonResidentialLoans),
      otherCre: pct(r.otherRealEstateLoans),
    }
  })
}

/**
 * CRE/assets against CRE/capital, with medians for the quadrant lines.
 *
 * Bubble radius is scaled on log10 of total assets: a linear scale would let the
 * largest bank swamp the plot, since assets span several orders of magnitude.
 */
export function buildCapitalScatter(rows: AnalyticsChartRow[]): CapitalScatter {
  const withBoth = rows.filter((r) => {
    const creToAssets = r.creConcentration ?? 0
    const creToCap = r.capitalRatios?.creToTier1Tier2
    const hasCap = r.capitalRatios?.coverage.hasTier1Tier2
    return creToAssets > 0 && hasCap && creToCap != null && creToCap > 0
  })

  const creToAssetsArr = withBoth.map((r) => r.creConcentration ?? 0)
  const creToCapArr = withBoth.map((r) => (r.capitalRatios!.creToTier1Tier2 ?? 0) * 100)
  const medianCreToAssets =
    creToAssetsArr.length > 0 ? [...creToAssetsArr].sort((a, b) => a - b)[Math.floor(creToAssetsArr.length / 2)] : 0
  const medianCreToCap =
    creToCapArr.length > 0 ? [...creToCapArr].sort((a, b) => a - b)[Math.floor(creToCapArr.length / 2)] : 0

  const assetsArr = withBoth.map((r) => r.totalAssets).filter((a) => a > 0)
  const minAssets = assetsArr.length > 0 ? Math.min(...assetsArr) : 1
  const maxAssets = withBoth.length > 0 ? Math.max(...withBoth.map((r) => r.totalAssets), 1) : 1
  const logMin = Math.log10(Math.max(1, minAssets))
  const logMax = Math.log10(Math.max(1, maxAssets))

  return {
    points: withBoth.map((r) => ({
      name: r.name,
      creToAssets: r.creConcentration ?? 0,
      creToCap: (r.capitalRatios?.creToTier1Tier2 ?? 0) * 100,
      totalAssets: r.totalAssets,
      bubbleSize: ((Math.log10(Math.max(1, r.totalAssets)) - logMin) / (logMax - logMin || 1)) * 12 + 4,
      vulnerabilityScore: r.vulnerabilityScore ?? 0,
    })),
    medianCreToAssets,
    medianCreToCap,
  }
}
