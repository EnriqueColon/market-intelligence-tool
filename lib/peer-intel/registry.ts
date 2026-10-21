/**
 * The three-layer peer registry.
 *
 * Who counts as a competitor is a judgement, not a query result, so this file
 * is curated and reviewed rather than generated. `scripts/discover-peers.ts`
 * proposes candidates from EDGAR; this file records which of them are actually
 * peers, grouped by **manager** rather than by fund, because a manager files a
 * new CIK for each vintage and the question "how is this competitor raising?"
 * spans all of them.
 *
 * **Why three layers.** Safe Harbor is a lower-middle-market South Florida
 * manager: four vintages, $500M+ invested, deals in the $8.5M–$44M range,
 * buying non-performing CRE loans from banks. Its competition for LP dollars is
 * not Blackstone — several of the mega-managers are counterparties, selling
 * pools rather than bidding against it. So the layers separate the firms that
 * compete for the same deals and the same allocations (Miami-Dade), the ones
 * that compete statewide (Florida), and the broader private credit market the
 * brief also asks about (national), where the large registered vehicles live.
 *
 * **`relevance`** is the honest part. `direct` means there is evidence the
 * vehicle invests in real-estate credit or distressed debt — its Form D
 * industry group and fund type, its legal name, or published reporting.
 * `adjacent` means it is a nearby strategy (real-estate equity, generalist
 * private credit) worth watching but not a like-for-like comparison. Nothing
 * is marked `direct` on a guess.
 *
 * **`kind`** is not curated: `app/services/peer-intel.ts` decides it from what
 * the entity actually files, because it changes when a manager registers a
 * vehicle. The values here are the state at the time of the step 1 audit
 * (2026-10-21) and are re-derived on every run.
 *
 * Every CIK below was resolved against live EDGAR during that audit.
 */

import type { PeerLayer } from "./edgar-contract"

export type VehicleKind = "private" | "registered"

export type PeerVehicle = {
  /** Unpadded CIK, as EDGAR Archives paths use it. */
  cik: string
  name: string
  /**
   * `registered` entities file periodic reports and so have observable
   * quarterly redemption and portfolio figures; `private` ones have Form D and
   * nothing else. Re-derived at fetch time; this is the audited value.
   */
  kind: VehicleKind
}

export type Peer = {
  /** Stable slug; used in cache keys and as the drawer's route value. */
  id: string
  /** The manager, not the fund. */
  manager: string
  layer: PeerLayer
  /** Business location as EDGAR reports it, `City, ST`. */
  location: string
  relevance: "direct" | "adjacent"
  /** Why this manager is in the registry, and where the strategy claim comes from. */
  evidence: string
  aliases: string[]
  website?: string
  vehicles: PeerVehicle[]
  /** Safe Harbor itself, shown alongside the peers rather than hidden. */
  isSelf?: boolean
}

export const PEERS: readonly Peer[] = [
  // ---------------------------------------------------------------- Miami-Dade
  {
    id: "safe-harbor-capital-partners",
    manager: "Safe Harbor Capital Partners",
    layer: "miami-dade",
    location: "Miami Beach, FL",
    relevance: "direct",
    evidence:
      "The firm itself. Acquires non-performing and sub-performing first mortgages and originates high-yield CRE financing; four fund vintages since 2015.",
    aliases: ["Safe Harbor Equity", "Safe Harbor Equity Distressed Debt Fund", "SHCP", "SHE"],
    website: "https://safeharborcp.com",
    isSelf: true,
    vehicles: [
      { cik: "1637588", name: "Safe Harbor Equity Distressed Debt Fund 1, L.P.", kind: "private" },
      { cik: "1685329", name: "Safe Harbor Equity Distressed Debt Fund 2, L.P.", kind: "private" },
      { cik: "1778808", name: "Safe Harbor Equity Distressed Debt Fund 3, L.P.", kind: "private" },
      { cik: "2017189", name: "Safe Harbor Equity Distressed Debt Fund 4, L.P.", kind: "private" },
    ],
  },
  {
    id: "bayview-asset-management",
    manager: "Bayview Asset Management",
    layer: "miami-dade",
    location: "Coral Gables, FL",
    relevance: "direct",
    evidence:
      "Form D: 'Bayview Commercial Real Estate Credit Fund', industry Pooled Investment Fund / Hedge Fund. A long-standing mortgage-credit and NPL buyer; the closest large peer in the county.",
    aliases: ["Bayview", "Bayview Asset Management LLC", "Bayview Opportunity"],
    vehicles: [
      { cik: "2053256", name: "Bayview Commercial Real Estate Credit Fund Domestic, L.P.", kind: "private" },
      { cik: "2053157", name: "Bayview Commercial Real Estate Credit Fund Domestic (Employee), L.P.", kind: "private" },
      { cik: "1925643", name: "Bayview Opportunity Fund Domestic VII, L.P.", kind: "private" },
      { cik: "1944326", name: "Bayview Opportunity Fund Domestic (Employee) VII, L.P.", kind: "private" },
    ],
  },
  {
    id: "3650-reit",
    manager: "3650 REIT",
    layer: "miami-dade",
    location: "Coconut Grove, FL",
    relevance: "direct",
    evidence: "Form D: '3650 Real Estate Credit Solutions Fund 5', Pooled Investment Fund. CRE bridge and event-driven lender.",
    aliases: ["3650 Capital", "3650 Real Estate Credit Solutions"],
    vehicles: [{ cik: "2033725", name: "3650 Real Estate Credit Solutions Fund 5 LP", kind: "private" }],
  },
  {
    id: "hig-bayside",
    manager: "H.I.G. Capital (Bayside)",
    layer: "miami-dade",
    location: "Miami, FL",
    relevance: "direct",
    evidence: "Form D: 'H.I.G. Bayside Loan Opportunity Fund' series. H.I.G.'s distressed-debt arm; buys loans, larger cheque size than Safe Harbor.",
    aliases: ["H.I.G.", "HIG Capital", "Bayside Capital", "H.I.G. Bayside"],
    vehicles: [
      { cik: "1899762", name: "H.I.G. Bayside Loan Opportunity Fund VII (Europe-US$), L.P.", kind: "private" },
      { cik: "1954463", name: "H.I.G. Bayside Loan Opportunity Fund VIII, L.P.", kind: "private" },
    ],
  },
  {
    id: "omnia",
    manager: "Omnia",
    layer: "miami-dade",
    location: "Aventura, FL",
    relevance: "direct",
    evidence: "Form D: 'Omnia Real Estate Debt Income Fund', Pooled Investment Fund / Hedge Fund. Closest size match to Safe Harbor's current raise.",
    aliases: ["Omnia Real Estate Debt Income Fund"],
    vehicles: [{ cik: "1858491", name: "Omnia Real Estate Debt Income Fund, LLC", kind: "private" }],
  },
  {
    id: "atipana-credit",
    manager: "Atipana Credit",
    layer: "miami-dade",
    location: "Miami, FL",
    relevance: "direct",
    evidence: "Form D: 'Atipana Credit Opportunity Fund I', Pooled Investment Fund / Private Equity Fund. Small credit manager.",
    aliases: ["Atipana"],
    vehicles: [{ cik: "1796170", name: "Atipana Credit Opportunity Fund I, LP", kind: "private" }],
  },
  {
    id: "rr-capital",
    manager: "R&R Capital",
    layer: "miami-dade",
    location: "Miami, FL",
    relevance: "direct",
    evidence:
      "Form D industry group 'Other Real Estate'; the firm describes itself (777 Brickell) as handling distressed residential mortgage assets. Raise not yet begun at the audit.",
    aliases: ["R & R Capital", "R&R Capital Holdings"],
    vehicles: [{ cik: "2131969", name: "R & R Capital Opportunity Fund LLC", kind: "private" }],
  },
  {
    id: "integra",
    manager: "Integra",
    layer: "miami-dade",
    location: "Miami, FL",
    relevance: "adjacent",
    evidence: "Form D industry group 'Other Real Estate' — multifamily equity, not credit. Competes for the same LP wallet, not the same assets.",
    aliases: ["Integra Multifamily"],
    vehicles: [{ cik: "2107754", name: "Integra Multifamily Opportunity Fund LP", kind: "private" }],
  },
  {
    id: "seglo",
    manager: "SEGLO",
    layer: "miami-dade",
    location: "Aventura, FL",
    relevance: "adjacent",
    evidence: "Form D: 'SEGLO Private Credit & Opportunity Fund', industry group 'Investing' with no fund type. Private credit, strategy not stated.",
    aliases: ["SEGLO Private Credit"],
    vehicles: [{ cik: "2081957", name: "SEGLO Private Credit & Opportunity Fund LLC", kind: "private" }],
  },

  // ------------------------------------------------------------------ Florida
  {
    id: "bh3-management",
    manager: "BH3 Management",
    layer: "florida",
    location: "Fort Lauderdale, FL",
    relevance: "direct",
    evidence:
      "Form D: 'BH3 Debt Opportunity Fund' II and III plus offshore, parallel and Harel sleeves. South Florida distressed CRE debt; Fund III filed 2026-10-08, the most recent peer launch found.",
    aliases: ["BH3", "BH3 Debt Opportunity"],
    vehicles: [
      { cik: "1967366", name: "BH3 Debt Opportunity Fund II, L.P.", kind: "private" },
      { cik: "2021809", name: "BH3 Debt Opportunity Fund II-Offshore, L.P.", kind: "private" },
      { cik: "2000027", name: "BH3 Debt Opportunity Fund II-Parallel, L.P.", kind: "private" },
      { cik: "2158615", name: "BH3 Debt Opportunity Fund III L.P.", kind: "private" },
      { cik: "2158616", name: "BH3 Debt Opportunity Fund III-Offshore L.P.", kind: "private" },
      { cik: "2107712", name: "BH3 Harel Debt Opportunity Fund, LP", kind: "private" },
    ],
  },
  {
    id: "silverview-capital",
    manager: "Silverview Capital",
    layer: "florida",
    location: "Tampa, FL",
    relevance: "direct",
    evidence: "Form D: 'Silverview Special Situations Lending Fund II', onshore and offshore. Special-situations lender; the largest Florida peer raise outside Miami-Dade.",
    aliases: ["Silverview", "Silverview Special Situations Lending"],
    vehicles: [
      { cik: "1980247", name: "Silverview Special Situations Lending Onshore Fund II LP", kind: "private" },
      { cik: "1980377", name: "Silverview Special Situations Lending Offshore Fund II LP", kind: "private" },
    ],
  },
  {
    id: "naso",
    manager: "Naso",
    layer: "florida",
    location: "Boca Raton, FL",
    relevance: "direct",
    evidence: "Form D: 'Naso CRE Bridge Loan Fund'. CRE bridge lending — the origination half of Safe Harbor's strategy.",
    aliases: ["Naso CRE", "Naso Capital"],
    vehicles: [{ cik: "1933138", name: "Naso CRE Bridge Loan Fund, L.P", kind: "private" }],
  },
  {
    id: "camden-credit",
    manager: "Camden",
    layer: "florida",
    location: "North Palm Beach, FL",
    relevance: "direct",
    evidence: "Form D: 'Camden Credit Opportunity Fund' series V–VIII, each fully subscribed. Series structure, retail-sized tickets.",
    aliases: ["Camden Credit", "Camden Credit Opportunity Fund"],
    vehicles: [
      { cik: "2012451", name: "Camden Credit Opportunity Fund, LLC Series V", kind: "private" },
      { cik: "2012462", name: "Camden Credit Opportunity Fund, LLC Series VI", kind: "private" },
      { cik: "2012163", name: "Camden Credit Opportunity Fund, LLC Series VII", kind: "private" },
      { cik: "2012162", name: "Camden Credit Opportunity Fund, LLC Series VIII", kind: "private" },
    ],
  },

  // ----------------------------------------------------------------- National
  // CRE credit specifically: these are the listed and non-traded vehicles whose
  // quarterly filings make portfolio and liquidity figures observable at all.
  {
    id: "blackstone",
    manager: "Blackstone",
    layer: "national",
    location: "New York, NY",
    relevance: "direct",
    evidence:
      "BXMT is a CRE debt REIT; BREIT and BCRED are the flagship non-traded vehicles whose redemption activity sets the tone for the whole semi-liquid market.",
    aliases: ["Blackstone Real Estate Debt Strategies", "BREDS", "BXMT", "BCRED", "BREIT"],
    website: "https://www.blackstone.com",
    vehicles: [
      { cik: "1061630", name: "Blackstone Mortgage Trust, Inc. (BXMT)", kind: "registered" },
      { cik: "1662972", name: "Blackstone Real Estate Income Trust, Inc. (BREIT)", kind: "registered" },
      { cik: "1803498", name: "Blackstone Private Credit Fund (BCRED)", kind: "registered" },
      { cik: "1736035", name: "Blackstone Secured Lending Fund (BXSL)", kind: "registered" },
    ],
  },
  {
    id: "starwood",
    manager: "Starwood Capital",
    layer: "national",
    location: "Miami Beach, FL",
    relevance: "direct",
    evidence:
      "STWD is a CRE debt REIT; SREIT is the non-traded vehicle that gated redemptions in 2024, the canonical example of the liquidity signal this tab tracks. Headquarters moved to Miami Beach, but the business is national.",
    aliases: ["Starwood", "Starwood Property Trust", "STWD", "SREIT"],
    website: "https://www.starwoodcapital.com",
    vehicles: [
      { cik: "1465128", name: "Starwood Property Trust, Inc. (STWD)", kind: "registered" },
      { cik: "1711929", name: "Starwood Real Estate Income Trust, Inc. (SREIT)", kind: "registered" },
    ],
  },
  {
    id: "brightspire",
    manager: "BrightSpire Capital",
    layer: "national",
    location: "New York, NY",
    relevance: "direct",
    evidence: "CRE credit REIT focused on debt investments; already on the firm's watchlist.",
    aliases: ["BrightSpire", "BRSP"],
    vehicles: [{ cik: "1717547", name: "BrightSpire Capital, Inc. (BRSP)", kind: "registered" }],
  },
  {
    id: "ladder-capital",
    manager: "Ladder Capital",
    layer: "national",
    location: "New York, NY",
    relevance: "direct",
    evidence: "Internally managed CRE lender and securities holder; on the firm's watchlist under CRE Debt Platforms.",
    aliases: ["Ladder", "LADR"],
    vehicles: [{ cik: "1577670", name: "Ladder Capital Corp (LADR)", kind: "registered" }],
  },

  // The broader private credit market the brief also asks about. Not CRE
  // lenders, but they compete for the same private-credit allocation and their
  // redemption and PIK trends are the clearest read on how that allocation is
  // behaving.
  {
    id: "blue-owl",
    manager: "Blue Owl Capital",
    layer: "national",
    location: "New York, NY",
    relevance: "adjacent",
    evidence:
      "Blue Owl Credit Income Corp is the largest non-traded BDC by redemption volume: $1.18B repurchased across 2025 against $1.97B in the first half of 2026 alone, with PIK income up from $86.1M to $103.6M.",
    aliases: ["Blue Owl", "OBDC", "Blue Owl Credit Income", "OCIC"],
    vehicles: [{ cik: "1812554", name: "Blue Owl Credit Income Corp.", kind: "registered" }],
  },
  {
    id: "apollo",
    manager: "Apollo Global Management",
    layer: "national",
    location: "New York, NY",
    relevance: "adjacent",
    evidence: "Apollo Debt Solutions BDC is a flagship non-traded private credit vehicle; Apollo is on the firm's watchlist.",
    aliases: ["Apollo", "ADS BDC", "Apollo Debt Solutions"],
    website: "https://www.apollo.com",
    vehicles: [{ cik: "1837532", name: "Apollo Debt Solutions BDC", kind: "registered" }],
  },
  {
    id: "ares",
    manager: "Ares Management",
    layer: "national",
    location: "Los Angeles, CA",
    relevance: "adjacent",
    evidence: "Ares Strategic Income Fund is its non-traded credit vehicle; Ares is on the firm's watchlist.",
    aliases: ["Ares", "ASIF", "Ares Strategic Income"],
    website: "https://www.aresmgmt.com",
    vehicles: [{ cik: "1918712", name: "Ares Strategic Income Fund", kind: "registered" }],
  },
  {
    id: "hps",
    manager: "HPS Investment Partners",
    layer: "national",
    location: "New York, NY",
    relevance: "adjacent",
    evidence: "HPS Corporate Lending Fund is among the largest non-traded BDCs; included so the national liquidity read is not drawn from two managers.",
    aliases: ["HPS", "HLEND", "HPS Corporate Lending"],
    vehicles: [{ cik: "1838126", name: "HPS Corporate Lending Fund", kind: "registered" }],
  },
]

/**
 * Managers worth tracking that produced no resolvable EDGAR entity in the step 1
 * audit, kept here rather than in `PEERS` so nothing in the tab claims to show
 * data it does not have.
 *
 * Gelt Financial (Boca Raton) buys non-performing loans of $100K–$5M and is a
 * close strategy match, but appears to fund on balance sheet rather than through
 * a Reg D offering — no Form D was found. Rialto Capital and Madison Realty
 * Capital are on the firm's watchlist and are real competitors, but their
 * current vehicles did not surface under the discovery name patterns; they need
 * a targeted lookup before being added.
 */
export const UNRESOLVED_WATCH: readonly string[] = [
  "Gelt Financial",
  "Rialto Capital Management",
  "Madison Realty Capital",
  "Bridge Investment Group",
  "Pretium Partners",
]

export function peersForLayer(layer: PeerLayer): Peer[] {
  return PEERS.filter((p) => p.layer === layer)
}

/**
 * The peers a layer should show.
 *
 * A layer is cumulative upward: the Miami-Dade view shows the local managers,
 * the Florida view adds the rest of the state, and the national view shows
 * everything — because a Miami manager is still a competitor nationally, and
 * hiding it there would misstate the market.
 */
export function peersInScope(layer: PeerLayer): Peer[] {
  if (layer === "miami-dade") return peersForLayer("miami-dade")
  if (layer === "florida") return [...peersForLayer("miami-dade"), ...peersForLayer("florida")]
  return [...PEERS]
}

export function peerById(id: string): Peer | undefined {
  return PEERS.find((p) => p.id === id)
}

export function selfPeer(): Peer | undefined {
  return PEERS.find((p) => p.isSelf)
}

/** Every vehicle in a layer, flattened, with its manager attached. */
export function vehiclesInScope(layer: PeerLayer): Array<PeerVehicle & { peerId: string; manager: string }> {
  return peersInScope(layer).flatMap((p) =>
    p.vehicles.map((v) => ({ ...v, peerId: p.id, manager: p.manager }))
  )
}

export function registeredVehiclesInScope(layer: PeerLayer): Array<PeerVehicle & { peerId: string; manager: string }> {
  return vehiclesInScope(layer).filter((v) => v.kind === "registered")
}
