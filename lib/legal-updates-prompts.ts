/**
 * Prompts for the Legal Landscape sections.
 *
 * These live outside the server action so `scripts/verify-legal-freshness.ts` can run them against
 * the live API. Editing them without running that script is how the tab ends up full of history.
 */

export type LegalSection = "regulatory" | "legislative" | "enforcement"

/** The window the prompts ask for. The feed's own filter is deliberately wider — see the filter. */
export const FRESHNESS_WINDOW_DAYS = 90

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function monthAndYear(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
}

/**
 * Without this the model dates "recent" from its own training cutoff. Asked for the last 90 days
 * it has searched `after:2024-03-01` and returned rules from 2006, 2015 and 2019 — which is the
 * whole of the staleness this tab suffered until 2026-09-29.
 *
 * Naming the months matters as much as naming the date. Given the date alone the model issues one
 * broad query and reports finding nothing; told to search agency newsrooms by month, it returns
 * genuinely current items. Both halves were measured, and neither is decoration.
 */
export function buildFreshnessPreamble(now: Date): string {
  const nowMs = now.getTime()
  const cutoff = isoDay(nowMs - FRESHNESS_WINDOW_DAYS * 86400000)
  const thisMonth = monthAndYear(nowMs)
  const lastMonth = monthAndYear(nowMs - 30 * 86400000)

  return `Today's date is ${isoDay(nowMs)}. Your training data ends well before today, so you do not know what is recent — only the web search tool does. Never answer from memory: every item must come from a search you ran just now.

Do not make one broad query. Search the sources directly, naming a month, and run several searches before answering — for example "OCC news releases ${thisMonth}", "FDIC press releases ${lastMonth}", "Florida OFR ${thisMonth}". If a search returns nothing recent, try the previous month before giving up.

Every item must be dated on or after ${cutoff}. Omit anything older rather than padding the list to length; four genuinely recent items are worth more than ten that are not.`
}

const SECTION_BODIES: Record<LegalSection, string> = {
  regulatory: `You are a CRE regulatory intelligence analyst. Find the 4-5 most recent regulatory developments from agencies including OCC, FDIC, Federal Reserve, CFPB, HUD, or Florida OFR that directly affect commercial real estate lending, CRE loan servicing, foreclosure processes, bank CRE concentration limits, or CMBS/securitization rules.

Each item must be a distinct development. Interagency rules are issued jointly by several agencies and are still one item — list every issuer in a single "source" rather than repeating the rule once per agency.

Prefer a proposal still open for comment, or a rule with an effective date ahead of it, over one long settled.

For each item include:
- The exact rule/guidance title
- Issuing agency (source)
- Publication or effective date, as the most recent action on the item — never the date of an earlier version
- Whether it is Federal or Florida jurisdiction
- A 2-3 sentence plain-English summary of what it changes
- A 1-2 sentence "Why it matters" specifically for a distressed CRE debt investor (note sales, workouts, foreclosures, REO)
- Direct URL to the rule or announcement if available
- Status: Proposed Rule, Final Rule, Guidance, or Notice

Return ONLY valid JSON:
{
  "items": [
    {
      "title": "exact rule or guidance title",
      "source": "agency name",
      "date": "YYYY-MM-DD",
      "jurisdiction": "Federal or Florida",
      "summary": "2-3 sentence plain-English summary",
      "whyItMatters": "1-2 sentences on relevance to distressed CRE debt investing",
      "status": "Proposed Rule | Final Rule | Guidance | Notice",
      "url": "https://..."
    }
  ]
}`,

  legislative: `You are a CRE legislative intelligence analyst. Find the 4-5 most recent Florida state bills or U.S. federal bills with active legislative movement that affect commercial real estate, mortgage lending, foreclosure law, property rights, landlord/tenant regulations, property tax assessments, or CRE-related banking regulations.

Prioritize bills that have passed a committee, received a floor vote, or been signed into law. Skip bills with no movement.

For each item include:
- The official bill title and bill number
- Legislative body (e.g., Florida Senate, U.S. House)
- Most recent action date — the latest action on the bill, not its introduction date
- Whether it is Federal or Florida jurisdiction
- A 2-3 sentence plain-English summary of what the bill does
- A 1-2 sentence "Why it matters" for a distressed CRE debt investor
- Direct URL to the bill text or tracker
- Status: e.g., "Passed Senate Committee", "Signed into Law", "Awaiting Floor Vote"

Return ONLY valid JSON:
{
  "items": [
    {
      "title": "full bill title",
      "source": "bill number + legislative body (e.g. SB 1234 — Florida Senate)",
      "date": "YYYY-MM-DD",
      "jurisdiction": "Federal or Florida",
      "summary": "2-3 sentence plain-English summary",
      "whyItMatters": "1-2 sentences on relevance to distressed CRE debt investing",
      "status": "current legislative status",
      "url": "https://..."
    }
  ]
}`,

  enforcement: `You are a CRE enforcement and litigation intelligence analyst. Find the 4-5 most recent high-impact developments in any of these categories:
1. FDIC enforcement actions or consent orders against banks with significant CRE loan exposure
2. OCC enforcement actions related to CRE lending practices
3. Major commercial real estate Chapter 11 bankruptcy filings (assets > $50M)
4. Court-appointed receiverships on large CRE assets in Florida or nationally
5. High-profile lender liability or foreclosure litigation with broad market implications

Report the most recent action in a matter, not the matter's origin.

For each item include:
- Descriptive title (institution name + action type, or property/borrower + filing type)
- Source (FDIC, OCC, court, etc.)
- Date of that action or filing
- Whether it is Federal or Florida (or Multi-State)
- A 2-3 sentence summary of what happened and who is involved
- A 1-2 sentence "Why it matters" for a distressed CRE debt investor looking for note sale or acquisition opportunities
- Direct URL to the enforcement action, court filing, or press release if available
- Status: e.g., "Consent Order Issued", "Chapter 11 Filed", "Receivership Appointed", "Settled"

Return ONLY valid JSON:
{
  "items": [
    {
      "title": "descriptive title",
      "source": "FDIC | OCC | U.S. Bankruptcy Court | etc.",
      "date": "YYYY-MM-DD",
      "jurisdiction": "Federal or Florida or Multi-State",
      "summary": "2-3 sentence summary",
      "whyItMatters": "1-2 sentences on relevance to distressed CRE debt investing",
      "status": "action status",
      "url": "https://..."
    }
  ]
}`,
}

export function buildSectionPrompt(section: LegalSection, now: Date = new Date()): string {
  return `${buildFreshnessPreamble(now)}\n\n${SECTION_BODIES[section]}`
}
