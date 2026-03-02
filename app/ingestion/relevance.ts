export type RelevanceScore = {
  score: number
  reasons: string[]
  isRelevant: boolean
  hasRE: boolean
  hasCredit: boolean
}

type RelevanceInput = {
  producerId: string
  title: string
  landingUrl: string
  publishedDate?: string
}

const RE_KEYWORDS = [
  "commercial real estate",
  " real estate ",
  " cre ",
  "multifamily",
  "office",
  "industrial",
  "retail",
  "hotel",
  "hospitality",
  "self storage",
  "student housing",
  "data center",
  "life science",
  "apartments",
]

const CREDIT_KEYWORDS = [
  "debt",
  "credit",
  "loan",
  "lending",
  "refinanc",
  "maturity",
  "maturities",
  "distress",
  "default",
  "delinquen",
  "nonaccrual",
  "past due",
  "workout",
  "restructur",
  "special servicing",
  "cmbs",
  "spreads",
  "cap rate",
  "cap rates",
  "liquidity",
  "capital markets",
  "financing",
  "bank exposure",
  "charge-off",
  "charge offs",
  "watchlist",
  "criticized",
  "classified",
]

const NEGATIVE_KEYWORDS = [
  "payments",
  "consumer",
  "crypto",
  "retail sales",
  "education",
  "healthcare policy",
  "climate disclosure",
  "cybersecurity",
  "payment systems",
]

function includesKeyword(haystack: string, keyword: string): boolean {
  return haystack.includes(keyword)
}

export function scoreDistressedCreRelevance(input: RelevanceInput): RelevanceScore {
  const combined = `${input.title} ${input.landingUrl}`.toLowerCase()
  const reasons: string[] = []

  const matchedRe = RE_KEYWORDS.filter((kw) => includesKeyword(combined, kw))
  const matchedCredit = CREDIT_KEYWORDS.filter((kw) => includesKeyword(combined, kw))
  const matchedNeg = NEGATIVE_KEYWORDS.filter((kw) => includesKeyword(combined, kw))

  for (const kw of matchedRe) reasons.push(`re:+${kw}`)
  for (const kw of matchedCredit) reasons.push(`credit:+${kw}`)
  for (const kw of matchedNeg) reasons.push(`neg:-${kw}`)

  const rePoints = Math.min(matchedRe.length * 2, 6)
  const creditPoints = Math.min(matchedCredit.length * 3, 9)
  const negPoints = Math.min(matchedNeg.length * 3, 9)
  const score = rePoints + creditPoints - negPoints

  const hasRE = matchedRe.length > 0
  const hasCredit = matchedCredit.length > 0
  const isRelevant = score >= 6 && hasRE && hasCredit

  return {
    score,
    reasons,
    isRelevant,
    hasRE,
    hasCredit,
  }
}
