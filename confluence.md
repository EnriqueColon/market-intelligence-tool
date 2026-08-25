# Market Intelligence Tool — Technical Reference

Maintenance handover for developers who did not build this. Describes how the system works *now*.
Keep it current at the end of every session.

One of four maintained documents: `README.md` orients a newcomer and covers setup and workflow, this
file records behaviour in detail, `SESSION.md` records history, and `ROLLBACK.md` records recovery.
Start at the README if you are new to the repository.

Verified against `dev` @ `908d083` / `main` @ `eabf088` on 2026-08-18.

---

## 1. What it is

An internal market intelligence dashboard for commercial real estate and private credit, focused on
distressed opportunities with a national → Florida → Miami emphasis. It aggregates news, generates an
AI-written industry outlook, surfaces bank and CRE market analytics, tracks research reports, and
follows legal/legislative signals.

It is password-gated and used by a small internal audience. **It is in active production use**, which
is why development happens on an isolated `dev` deployment (see `docs/DEV_ENVIRONMENT.md`).

## 2. Runtime and deployment

| | |
| --- | --- |
| Framework | Next.js 15.5.12, App Router |
| Node | 20.x (pinned in `package.json` engines) |
| Host | Vercel |
| Production | `main` → https://market-intelligence-tool-gilt.vercel.app |
| Development | `dev` → Vercel preview, no database, no Blob store |

Every push to `main` deploys to production. Every push to `dev` creates a preview deployment.
Route handlers that need Node APIs declare `export const runtime = "nodejs"`.

### Environment detection — read this before writing any environment-dependent code

**`NODE_ENV` cannot distinguish production from a dev deployment.** Vercel sets
`NODE_ENV="production"` when building previews, so a preview build looks exactly like production to
any `process.env.NODE_ENV === "production"` check. This has caused real bugs.

Use `lib/environment.ts`, which separates two different questions:

- `isProductionDeployment()` — *is this the live deployment?* Reads `VERCEL_ENV`, falling back to
  `NODE_ENV` off-platform.
- `isWiredToProductionData()` — *are this deployment's stores the real ones?* Cannot be inferred,
  because Vercel copies environment variables into Preview by default. Declared through
  `DATA_ENVIRONMENT`, and **defaults to "production" so it fails closed**.
- `assertSafeToMutateProductionData(operation)` — throws `ProductionDataWriteError` when a
  non-production deployment is wired to production data. Call before any irreversible write and map
  the error to a 403.

Covered by `npm run test:environment`.

## 3. Feature areas

Tabs are gated server-side in `app/page.tsx` via `isFeatureEnabled()` (`lib/features.ts`), driven by
the `ENABLED_TABS` comma-separated list. **Outside production every feature is on**, which is how a
tab is developed on `dev` before being exposed in production.

The same list also gates content *inside* a tab. `app/page.tsx` resolves those into a `features`
object passed down to the dashboard, because `isFeatureEnabled()` reads server-only env and
everything below it is a client component. `bank-stress-map` is the current entry.

The tab bar derives its column count from the number of enabled tabs. It was previously hardcoded to
`grid-cols-4`, so production — which runs three — rendered an empty fourth cell.

| Tab | Feature key | What it shows |
| --- | --- | --- |
| News | `news` | Industry Outlook / Key Signals memo (`industry-outlook.tsx`), Industry-Specific News (`public-mentions.tsx`), General Finance News (`investing-business-mentions.tsx`), and an on-demand Article Digest (`article-digest.tsx`) |
| Market Analytics | `market-analytics` | FDIC bank financials with state filter, institution drawer and export (`market-analytics.tsx`); a Visual Analysis chart section (`market-analytics-visuals.tsx`); a Bank Stress Map behind `bank-stress-map`; plus a nested FRED/Census indicator panel (`market-research.tsx`) |
| Market Research | `market-research` | Live publisher-by-publisher research feed with Postgres-backed archive (`market-research-feed.tsx`) and memo generation (`research-memo-modal.tsx`) |
| Legal Landscape | `legal` | Three AI-generated sections — Regulatory Watch, Legislative Tracker, Enforcement & Litigation (`legal-updates.tsx`). Despite the name, no LegiScan data is involved |

Production currently runs `ENABLED_TABS=news,market-analytics,market-research` (plus `legal` where
enabled) — confirm the live value in Vercel rather than trusting this line.

The news feeds merge all three geographies (national, Florida, Miami) into one list. The region
selector was removed in `984a361`; the underlying per-region feeds still exist and are fetched
concurrently, then merged and sorted by access tier and date.

Both news feeds source from Google News RSS queries plus direct publisher RSS (GlobeSt, Bisnow,
Commercial Observer, The Real Deal, CRE Daily, Trepp, Miami Herald for CRE; CNBC, Reuters, Bloomberg
for finance), and fall back to the **GDELT DOC 2.0 API** when RSS yields fewer than 15 items. The two
actions carry near-duplicate fetching logic, so a parsing bug tends to need fixing in both — as
happened with the CDATA regex.

### Search Industry Reports: entities and the domain allowlist

`lib/entity-sources.ts` is the single registry of approved publishers. It backs three things that must
be read together: the entity dropdown (`ENTITY_DROPDOWN_OPTIONS`), the `site:` restriction
`lib/google-query-builder.ts` puts on the Google query, and the allowlist `lib/domain-allowlist.ts`
filters results against. Hostname matching accepts an exact match or a subdomain, and landing domains
are kept separate from asset domains so a PDF must come from an expected host for the page that
offered it.

**`ENTITY_SOURCES` holds eleven entities; `"all"` covers eight of them.** `"all"` means the primary
Search Industry Reports sources — Federal Reserve, FDIC, CBRE, JLL, Cushman & Wakefield, Colliers,
NAIOP, ULI, which is nine domains because CBRE carries two. `mba`, `mhn` and `commercialsearch` are
allowlisted, so a URL from one of them still validates if it reaches the resolver, but they are in
neither `"all"` nor the dropdown and nothing can currently select them. This is intentional curation,
settled 2026-08-25, not an oversight: `"all"` is the default selection, so it decides what an
unqualified search reaches at all. Widening it means editing `PRIMARY_V1_ENTITY_IDS`, the dropdown
filter and the exact-list assertion in `lib/domain-allowlist.test.ts` together.

Note the two layers disagree on an unrecognised entity id. `filterByAllowlist` gets an empty domain
list and drops every result — fail closed. `buildSearchQuery` gets the same empty list and returns the
bare keyword, an **unrestricted** Google search — fail open. The filter is what makes the pair safe, so
do not remove it on the grounds that the query is already scoped.

### Paywall classification

`app/actions/news-access.ts` classifies every article URL **before** a summary is produced, so the
tool never implies it read full content it could not reach. Imported by `fetch-news.ts`,
`fetch-news-summary.ts`, `fetch-public-mentions.ts`, `fetch-investing-news.ts` and
`fetch-open-backfill.ts`.

| Status | Meaning | Effect on output |
| --- | --- | --- |
| `open` | Fetched the page and extracted substantial readable text | Full summary |
| `partial` | Fetched, but extracted only a preview or snippet | Brief uses publicly available information only |
| `paywalled` | Blocked by subscription, login or bot check, or extraction failed | Signal summary only; article content is not summarised |

Classification fetches the HTML with **no cookies and no credentials** and combines several checks:
known paywall domains, login and subscription markers, login-form detection, bot-challenge markers,
and extracted text length. Tuning constants live at the top of the same file —
`ACCESS_TEXT_MIN_CHARS` (1200) is the floor for "open", `ACCESS_TEXT_TINY_CHARS` (200) is the ceiling
below which a page is treated as blocked, and `KNOWN_PAYWALL_DOMAINS` lists publishers that are
paywalled by default (extraction is still attempted).

**This system deliberately does not bypass paywalls** and uses no credentials. It exists to be
transparent about what was actually accessible. Keep that property when changing it. The list view
shows the status per article and the detail view carries a banner for anything not `open`.

## 4. The Industry Outlook / Key Signals pipeline

The most complex and most failure-prone part of the system. It generates the memo whose Executive
Summary is displayed as "Key Signals".

**Design constraint that drives everything here: the model must not be trusted with numbers.** It
previously produced confident, entirely invented statistics (see `SESSION.md`). The pipeline is built
so that any figure reaching the reader came from a measured source or a named publisher.

Flow, in `app/services/industry-outlook/getCachedOutlook.ts`:

1. **In parallel:**
   - `retrieveSources.ts` pulls supplemental news (up to 10 sources, with a per-region quota of 3).
     Handles RSS, unwraps CDATA, decodes HTML entities. A bug here silently discarded article
     snippets before they reached the prompt.
   - `verifiedMetrics.ts` fetches measured figures. **Both sources are keyless** — FRED's public CSV
     endpoint and the FDIC public API — which is why no FRED API key is required despite
     `FRED_API_KEY` appearing in older docs.
2. **Prompt construction** injects today's date (stops stale quarter references), the retrieved
   sources, and a `VERIFIED MARKET DATA` block the model may quote verbatim.
3. **Generation** through `lib/openai.ts` (OpenAI **Responses API**) with web search enabled and
   restricted to `SEARCH_ALLOWED_DOMAINS`. Uses the `fast` tier — `gpt-4.1-mini` by default — with a
   90s timeout inside a route whose `maxDuration` is 120s. Domain filtering requires a larger model,
   so `OPENAI_SEARCH_FILTER_MODEL` defaults to `gpt-4.1`; if the filtered call 400s, `lib/openai.ts`
   retries unrestricted.
4. **Post-processing:**
   - `stripInlineCitations` removes citation markup but *preserves publisher domains*, since the
     evidence guard needs attribution to survive.
   - **Evidence guard** (`lib/memo-evidence.ts`) deletes any bullet containing a numeric claim
     without recognized publisher attribution. Deduplication is scoped *within* a section, so summary
     bullets do not delete body bullets.
   - `ensureKeySignalFigures` guarantees at least three figure-bearing summary bullets, backfilling
     from verified metrics when the model underdelivers.
5. **Usability check** — `hasUsableContent()` requires 200+ characters, an "Executive Summary"
   heading, and at least 3 of the 5 expected headings.
6. **Fallback memo** if generation fails, containing the measured figures plus the sentinel phrase
   *"could not complete a full generated outlook"*, which the client detects. Failures **throw inside
   the cache function so they are never cached**, meaning the next request retries rather than
   serving a bad memo all day.

Health is observable in the warm-cache response: `verifiedMetrics`, `verifiedBulletsInserted`,
`keySignalFigures`, `droppedUnsourced`, `droppedDenied`. **A `keySignalFigures` of 0 means the
section is empty of data — treat as a regression.** Last verified: 5.

### Verified metric sources

`lib/verified-metrics.ts` is pure parsing and formatting (unit tested); fetching lives in
`app/services/industry-outlook/verifiedMetrics.ts`.

| Series | Source | Measures |
| --- | --- | --- |
| `DRCRELEXFACBS` | Federal Reserve Board | CRE loan delinquency rate, U.S. commercial banks |
| `CORCREXFACBS` | Federal Reserve Board | CRE net charge-off rate |
| `CREACBM027NBOG` | Federal Reserve H.8 | CRE loans outstanding |
| `DGS10` | U.S. Treasury | 10-year Treasury yield |
| `MORTGAGE30US` | Freddie Mac | 30-year fixed mortgage rate |
| `BAMLH0A0HYM2` | ICE Data Indices | High-yield option-adjusted spread |
| FDIC call reports | FDIC | Florida bank cohort CRE exposure, dollar-weighted |

`lib/fred-constants.ts` once named `CABOREA` for CRE charge-offs. **That is not a real series id** and
returns an error page; `CORCREXFACBS` is correct. Verify any new series id against the live endpoint
before trusting it.

The Market Pulse strip under the header (`components/market-pulse-strip.tsx`) draws five of these
same series through `app/actions/fetch-market-pulse.ts`, so its tiles and the Key Signals text agree
by construction. Values are cached with `unstable_cache`; the strip degrades to nothing rather than
showing a placeholder if FRED is unreachable.

### FDIC screening metrics

Fields are requested in `lib/fdic-config.ts` and turned into `BankFinancialData` in
`lib/fdic-data-transformer.ts`. These are the columns whose FDIC field names invite a wrong reading,
so verify against the live API rather than inferring from the field name:

| Displayed as | Derivation | Median, 2026Q1 |
| --- | --- | --- |
| Reserve Coverage | `LNATRES / LNLSGR` — the allowance over **gross** loans | 1.18% |
| NPL Ratio | `NALNLS / LNLSGR` — nonaccrual over **gross** loans | 0.34% |
| Noncurrent / Loans | `NCLNLSR` as reported | 0.44% |
| Noncurrent / Assets | `NCLNLS / ASSET` — `NCLNLS` is **dollars**, not a percentage | 0.29% |
| Loans / Deposits | `LNLSDEPR` as reported | 79% |
| CRE / (T1+T2) | `computeCreLoans()` over `RBCT1J + RBCT2` | 1–3x |
| CRE / Equity | `computeCreLoans()` over `EQTOT` | — |
| Past Due 30-89 / 90+ | `P3ASSET`, `P9ASSET` over `ASSET` — dollar amounts in thousands, not ratios | 0.28% / 0.00% |
| ROA, ROE, NIM | `ROA`, `ROE`, `NIMR` as reported, in percent units | 1.19% / 11.20% / 3.54% |
| 1-4 Family Residential | `LNRERES`, **not** `LNREDOM` | — |
| CET1 / Leverage / Capital Used | `RBCT1CER`, `RBC1AAJ` as reported; zero means not reported, and shows "—" | 40.6% report no CET1 |
| CRE Mix | `computeCreMix()` — the three parts of `creLoans`, summing to 100% | — |

**Gross, not net, for anything struck against the loan book.** FDIC uses gross loans for every one
of its own loan-quality ratios: `LNATRES / LNLSGR` reproduces its published `LNATRESR` exactly on all
4,258 institutions that report it, and `(P9LNLS + NALNLS) / LNLSGR` reproduces `NCLNLSR` on the same
set. Net loans are gross loans minus the allowance, so using them for reserve coverage puts the
allowance inside its own denominator — up to 2.80 percentage points too high at reserve-heavy card
lenders. `LNLSNET + LNATRES` equals `LNLSGR` on all 4,352 institutions, which is the fallback in
`resolveGrossLoans`.

**`NCLNLS` holds dollars despite sitting beside `NCLNLSR` and being glossed "Noncurrent Loans to
Assets".** It equals `P9LNLS + NALNLS` exactly on all 4,352 institutions; JPMorgan Chase reports
12,861,000, meaning $12.9bn. Reading it as percent points and clamping the result rendered 3,398 of
4,352 institutions — 78% of the industry, and every large bank — as exactly 100.00% noncurrent
against a median true figure of 0.435%. Live until 2026-08-24.

**`LNREDOM` is every real estate loan in domestic offices, not the 1-4 family figure.** It equals
`LNRE` on 4,335 of 4,352 institutions. It was read as residential lending until 2026-08-24,
overstating the industry residential book 2.09x. `LNRERES` is the 1-4 family total, and it splits
into revolving home equity (`LNRELOC`) plus closed-end (`LNREOTH`).

**Run `npm run audit:fdic-columns` after changing any field mapping.** It reconciles every derived
column against a total FDIC publishes independently and fails the process on a mismatch. That is a
different exercise from recomputing a metric from the parts the app already uses, which only
confirms the app's own assumption — a verification script did exactly that and blessed the CRE
double-count it existed to catch. It also flags any requested field the API never populates, which
is how `EQCAP` went unnoticed.

**What counts as CRE is defined in one place, `lib/fdic-cre.ts`, and it is load-bearing.** The 2006
guidance definition is construction and land development (`LNRECONS`) plus multifamily (`LNREMULT`)
plus **non-owner-occupied** non-farm non-residential (`LNRENROT`). Two rules follow:

- **Never add `LNREOTH`.** Despite reading like a separate category, it is already inside the named
  components: `LNRE` equals construction + multifamily + non-residential + 1-4 family + farmland
  exactly on 4,335 of 4,352 institutions. Adding it counts the same loans twice.
- **Never use `LNRENRES` where `LNRENROT` belongs.** `LNRENRES` includes owner-occupied property,
  which the guidance excludes because a business borrowing against its own premises is not a
  concentration exposure. `LNRENROW + LNRENROT` reconstitutes `LNRENRES` on 4,341 of 4,352
  institutions, so the split is dependable; `computeCreLoans` falls back to the undivided figure for
  the rest.

Both errors were live until 2026-08-24 and compounded. Share of institutions above the 300%
supervisory screen, 2026Q1: **63.5% with both errors, 29.0% with the double-count alone, 9.6%
correct.** The 63.5% figure is the tell — a screen meant to isolate concentrated outliers cannot flag
two-thirds of the industry. The double-count alone put 1,498 institutions above the screen that were
nowhere near it, Napoleon State Bank reading 344% against a true 113%.

`npm run test:fdic-cre` pins this. **Sanity-check any change to the CRE definition by the share of
the cohort above 300%**, which should stay near 10%.

**The CRE mix comes from `computeCreMix` in the same module, and shows only those three parts.** It
returns construction, multifamily and non-owner-occupied as percentages of `computeCreLoans`, using
the identical owner-occupied split, so the shares sum to 100% by construction. It is rendered in the
screening table's CRE Mix cell, the profile drawer and the CRE Portfolio Composition chart.

Until 2026-08-24 all three divided by `creLoans` themselves and drew a fourth "Other CRE" band from
`LNREOTH`, which is closed-end 1-4 family residential and is not in that denominator, while using
the undivided `LNRENRES` for the third band and so re-including the owner-occupied property the
definition removes. The bands summed to a **median of 255.8%**, exceeded 100% on 4,129 of the 4,164
institutions holding any CRE, and reached 681,607% at Liberty Savings Bank FSB — a thrift with a
large mortgage book and almost no CRE — against a chart axis that stops at 100.

`LNLSDEPR` is **net loans-to-deposits**, not a reserve, despite the FDIC data dictionary phrasing
that suggests otherwise; it equals `LNLSNET / DEP` to the decimal place on every institution. It was
read as Reserve Coverage until 2026-08-23 and displayed roughly thirty times too large.

**The reporting window is 27 months** (`recentQuartersFilter` in `app/actions/fetch-fdic-data.ts`),
which yields nine quarters. Eight is the real requirement: the year-over-year net income comparison
reads quarters 4–7 against 0–3, and `roaDelta4Q` reads quarter 3. The window was 18 months until
2026-08-24, returning only five quarters, so Net Income YoY was structurally impossible to compute —
permanently null, with its 20% weight in the Earnings Resilience Score silently redistributed across
the other three inputs. Shortening this window again will reintroduce that failure silently, since
the code degrades to null rather than erroring.

**FDIC reports every percent-type field in percent units, and no scale-guessing is needed or safe.**
`ROA`, `ROE` and `NIMR` go through **`normalizeFdicPercent`** in `lib/format/metrics.ts`, which
trusts the reported value and only rejects non-numbers. The four PCA capital ratios go through
**`normalizeCapitalRatioPercent`**, which does the same but additionally maps zero to null — see
"Zero is not a capital ratio" below.

The `normalizePercent` heuristic this replaced guessed at the scale in two directions and was wrong
in both. It divided anything above 100 as though it were basis points: in 2026Q1, 66 of 4,352
institutions reported CET1 above 100% — JPMorgan Chase Bank Dearborn at 506.72% — plus 9 with ROE
above 100% and 1 with ROA above 100%, and all of them rendered near a hundredth of their true value,
so the best-capitalised institutions in the country appeared critically undercapitalised and any
screen on a capital floor selected exactly the wrong banks.

It also multiplied anything at or below 1, assuming a decimal fraction. That half did more damage,
because a bank earning under one percent on assets is the ordinary case rather than an edge case:
**1,441 of 4,352 institutions — a third of the industry — had ROA between 0 and 1 percent and were
shown a hundred times too high**, NBH Bank's 1.00% appearing as 99.98%. 65 institutions had ROE in
that band and 23 had NIM, including State Street at 0.95% shown as 95.29%. The capital-ratio half was
fixed on 2026-08-24; ROA, ROE and NIM were fixed later the same day and `normalizePercent` was
removed so it cannot be reintroduced.

The units were never actually in doubt: FDIC's `ROA` equals `NETINC * n / ASSET5 * 100` on all 4,352
institutions and `ROE` equals `NETINC * n / EQ5 * 100` on all 4,334 that report equity, where `n`
annualizes year-to-date income for the quarter. `npm run audit:fdic-columns` asserts both.

Related: never substitute one capital measure for another across a time series. Falling back to the
leverage ratio for a quarter missing CET1 compares two different things and manufactures a swing —
it produced a fictional "fell from 31.39% to 1.14%" event in the Executive Brief.

`RBCT1J + RBCT2` over `RWAJ` reproduces FDIC's published `RBCRWAJ` exactly, which is the check to run
if the capital figures ever look wrong. `RWA_TO_ASSETS_PROXY` in `lib/fdic-ratio-helpers.ts` remains
only as a fallback for institutions that do not report `RWAJ`; `CapitalRatios.basis` records whether
a row used reported dollars (`"reported"`) or the proxy (`"derived"`).

**Zero is not a capital ratio; it is FDIC declining to compute one.** `cet1Ratio`, `leverageRatio`,
`tier1RbcRatio` and `totalRbcRatio` are typed `number | null` on `BankFinancialData`, and
`normalizeCapitalRatioPercent` returns null for an absent *or zero* value. `riskWeightedAssets` and
`tier1Dollars` are guarded on positivity for the same reason.

| Field | Column | Not reported, 2026Q1 | How FDIC signals it |
| --- | --- | --- | --- |
| `RBCT1CER` | `cet1Ratio` | 1,765 / 4,352 (40.6%) | null |
| `RBC1RWAJ` | `tier1RbcRatio` | 1,765 / 4,352 (40.6%) | null |
| `RBCRWAJ` | `totalRbcRatio` | 1,765 / 4,352 (40.6%) | **literal `0`** |
| `RWAJ` | `riskWeightedAssets` | 1,765 / 4,352 (40.6%) | **literal `0`** (1,748) or null (17) |
| `RBC1AAJ` | `leverageRatio` | 17 / 4,352 (0.4%) | **literal `0`** |

Those 1,765 are Community Bank Leverage Ratio filers, which electing the framework excuses from
risk-weighting; their median leverage ratio is 11.80% and election requires at least 9%. The 17 are
branches of foreign banks, which hold capital at the parent and file no US ratio at all, so they
correctly show "—" everywhere. Only **2** institutions in the country genuinely report total
risk-based capital below 8%, which is the magnitude check: a capital screen that selects 40% of the
industry is measuring a reporting regime, not distress.

Passing the zeros through was live until 2026-08-24. It rendered those institutions at 0.00% in the
CET1, Tier 1 RBC and Total RBC columns, and — the consequential part — defeated
`cet1Ratio ?? leverageRatio`, since `??` only falls through on null. That pinned the Opportunity
Score's capital component, 15% of the score and inverted so that less capital reads as more
distress, at the bottom of the cohort for all of them: **30 of the top-100 most-distressed
institutions were CBLR filers who did not belong there**, and the median institution moved 120 rank
places when it was fixed. CRE-to-capital, the stress map and the workbench were unaffected, because
they read reported Tier 1 and Tier 2 dollars rather than the ratios.

`npm run audit:fdic-columns` prints a "zero versus absent" table for these fields and fails if a
zero total risk-based capital ratio ever lacks a leverage ratio to fall back to.

Total equity comes from **`EQTOT`**, which equals `ASSET - LIAB` on all 4,352 institutions. `EQCAP`
was requested until 2026-08-24 and is not a field this endpoint serves, so it returned null on every
institution and CRE / Equity silently fell back to Tier 1 capital. `EQ` is bank-only equity excluding
noncontrolling interests and does not close the balance sheet on 93 institutions, so it is not used.

### Opportunity Score

`lib/scoring/opportunity-score.ts`, used by the screening table, the export and the stress map.
Weights are CRE concentration 35%, noncurrent-to-loans 35%, reserve coverage 15%, capital 15%.

Each input is scored by **percentile rank within the cohort in view**, not against fixed thresholds
and not against the cohort's raw min and max. Two consequences follow, and both matter:

- **Scores are relative.** The same institution scores differently under a national screen than a
  state one, and a score reads directly as a ranking — 90 means the top tenth of whatever is on
  screen. Any surface showing a score must therefore say what cohort it ranked against. The screening
  table does this in `scopeCoverageNote`.
- **Correcting a field's scale does not require retuning weights**, since only order matters.

Percentile rank replaced min-max normalisation on 2026-08-24. Min-max let a single extreme
institution stretch the scale and compress everyone else: nationally, one institution out of 1,215
scored 70 or above and 55% of the cohort sat in one 10-point band. The same cohort now puts 108
institutions above 70 with a 20.8-point IQR.

Ties use the midrank convention, because these metrics tie heavily — many institutions report exactly
zero noncurrent loans, and bottoming all of them out would be an artefact of the tie rather than a
real difference. An empty or flat cohort returns the midpoint rather than inventing a spread.

**The capital input is `cet1Ratio ?? leverageRatio`, and it depends on absent ratios being null.**
`??` only falls through on null, so while the transformer coerced a missing CET1 to zero, the 1,765
CBLR filers never reached their leverage ratio and instead tied at the bottom of the capital
distribution — which, inverted, is maximum distress. That was live until 2026-08-24 and put 30
CBLR filers into the top-100 most-distressed list. See "Zero is not a capital ratio" above. The 17
foreign branches that report no US capital ratio at all still fall to the final `?? 0`; they are
anomalous on every other column too, and are visible as "—" throughout.

Run `scripts/verify-score-distribution.mjs [STATE]` after any change to the inputs or weights. If one
10-point band holds most of the cohort, the score has stopped ranking. Bump the cache key version in
`build-report-data.ts` at the same time, or cached entries keep serving the old scores.

**The map's capital input differs and must not be unified.** The table's capital slot holds CET1,
where a *smaller* value means more stress, so it inverts. The map's holds CRE-to-(Tier 1 + Tier 2),
where a *larger* multiple does, so it must not. While the logic existed as three copies the map
inherited the table's inversion and coloured the least concentrated banks as the most stressed.

### Change detection

`lib/scoring/institution-change.ts`. Turns the nine quarters already fetched per institution into
events, which is what separates "this bank is stressed" from "this bank is becoming stressed".

Two kinds, and the distinction carries the meaning:

- **Crossings** — a level was passed that means something outside this tool. Only the 300%
  CRE-to-capital and 100% construction-to-capital figures are supervisory, from the 2006 interagency
  guidance on CRE concentrations; the noncurrent, reserve and capital levels are working conventions.
  `Threshold.supervisory` records which is which, and the interface should not present them as equal.
- **Trajectories** — nothing crossed, but the metric moved adversely for at least three consecutive
  quarters. This is the early-warning half.

**Trajectories need an absolute materiality level, not just a relative one**, and this is the part
that will look like an arbitrary constant later. A relative filter cannot help when a metric starts
near zero: construction lending rising from 2% to 3% of capital is a 50% relative move and worthless,
and a reserve slipping from 2.44% to 2.08% is still amply reserved. Rising metrics therefore carry a
floor and falling metrics a ceiling in `MetricSpec.material`. Removing those reintroduces a flood of
technically-true findings.

Crossings compare only the two most recent quarters, so a threshold crossed earlier surfaces as a
trajectory instead. That is deliberate: with department-level rather than per-user identity there is
no "last seen", so "since last quarter" is the only well-defined answer.

Calibrate with `scripts/verify-change-detection.mjs [STATE]` after changing any threshold, the run
length, or a materiality level. Texas currently gives 4.1% of institutions a supervisory crossing and
19.1% a trajectory. Far above those and it is noise; near zero and the feature is dead.

**Ranking lives here too**, in `rankBySeverity`, `rankByRun` and `groupForBrief`, rather than in the
consuming server action. That placement is deliberate: it keeps the functions pure so verification
scripts import the shipped comparators instead of reimplementing them.

`rankBySeverity` orders crossings by how far past the threshold the institution landed —
`|to − threshold| / threshold` — and **not** by the size of the quarterly step. Ranking by step
promotes institutions whose metric jumped off a near-zero base, which is a reporting artifact far
more often than it is news; a noncurrent ratio moving 0.00% → 4.33% posts an infinite relative move
and would otherwise lead every quarter. `rankByRun` orders trajectories by run length, relative move
breaking ties.

### Lenses

`components/lenses/`. A lens is an additive department-specific view: it renders **above** the tabs
and removes nothing, so every existing tab stays reachable no matter which department is selected.
Anything that replaces a tab is not a lens and does not belong here.

Two exist, of the four planned.

#### Executive Brief

`components/lenses/executive-brief.tsx` over `app/actions/executive-brief.ts`, shown when the
department cookie is `executive`. It renders at most six supervisory crossings, six watch-level
crossings and six trajectories, ranked as above, plus a fourth section covering institutions that
have stopped filing.

It queries at most 10,000 FDIC rows, matching the screening tab so both see the same cohort. At nine
quarters per institution that caps national coverage near 1,138 institutions rather than the full
~4,400, so the action returns `capped` and the card states the limitation rather than implying full
coverage. Pagination would fix it properly and has not been done.

**An institution that did not file for the latest quarter is held out of the three movement
sections**, and counted in `staleCount`. This is load-bearing rather than tidiness. The card is headed
"what moved this quarter" and names a quarter; an institution whose newest call report is a quarter
old still has a most-recent movement, and reporting it there dates that movement forward. Nationally
this affects around 100 of 1,215 institutions. `institutionCount` is therefore the number of
institutions that *did* file, not the number in the response.

That rule is also what makes the profile handoff work, since the screening tab drops the same
institutions — see below.

Those institutions appear instead in **"No longer reporting"**, the last section, as
`nonReporting: NonReportingInstitution[]`. A bank that stops filing has usually merged, been acquired
or failed, so its absence is itself information — the live national list is recognisable 2025 M&A.
The section is capped at six like the others and ordered by **assets descending**: every entry is
equally "not filing", so size is the only thing distinguishing a material absence from an immaterial
one. `quartersStale` counts calendar quarters, and one quarter behind is frequently just a late
filer, which the card says.

It is placed last and styled quieter than a crossing because it is the weaker signal, and its rows
are **deliberately not clickable**. The profile drawer resolves against the Market Analytics cohort,
which is selected on the same latest-quarter rule that put these institutions in this list, so every
one of them would resolve to "not found". Offering a control that cannot work is worse than offering
none.

**Clicking an entry opens the institution profile drawer.** The brief does not own a drawer. It calls
`onSelectInstitution(cert)`, `market-intelligence-dashboard.tsx` stores the CERT as `focusCert` and
switches to the analytics tab, and `MarketAnalytics` resolves it against its own `screeningTable`
once loading finishes. The indirection exists because the drawer's peer-positioning figures are
percentiles against a cohort: a drawer rendered inside the brief would need a second cohort, and the
same institution would then read at two different percentiles depending on where it was opened.

The handoff therefore depends on the two cohorts agreeing, which they do because both query
`fetchFDICFinancials(state, 10000, false)` and both require a row in the newest quarter. **If either
side's cohort rule changes, the handoff starts failing for whatever the two no longer share.** It
fails visibly rather than silently: `onFocusResolved(false)` makes the card explain that the
institution is outside the analytics cohort. Rows are `<button>` elements so the list stays usable by
keyboard; when the analytics tab is disabled, `onSelectInstitution` is omitted and rows render as
plain text rather than as buttons that cannot work.

#### Underwriter Workbench

`components/lenses/underwriter-workbench.tsx` over `app/actions/underwriter-workbench.ts`, shown when
the department cookie is `underwriting`. Institution-first: search for one, and get a peer cohort,
threshold flags and a CRE downside scenario. It hands off to the profile drawer for trends by the
same `onSelectInstitution` route as the brief, and for the same reason.

The action returns the **whole scope's latest quarter in one cached payload** and the analysis runs in
the browser (`analyseInstitution` in `lib/scoring/workbench-analysis.ts`). The peer cohort is a
property of the population so a per-institution request could not compute it anyway, and working
through a list of names is the actual use, which a round trip per name would spoil. It is O(universe)
per selection — fine at ~1,113, not fine at 4,400.

**Peer cohort** (`lib/scoring/peer-cohort.ts`). Matched on size band, then geography, then CRE mix,
relaxing **CRE mix first and geography second** when the cohort is thinner than `MIN_COHORT` (8).
**Size is never relaxed** — comparing a community bank to a money-centre bank on reserve coverage is
arithmetically fine and analytically meaningless. Which criteria survived is returned as `criteria`
and printed on the card, because a percentile against nine matched peers is a different claim from
one against six hundred unmatched ones. Below 8 peers `percentileIn` returns null and the card says
so rather than quoting a number. Percentiles use the same midrank convention as the Opportunity
Score, deliberately: two percentiles on one screen that disagree about ties is a bug report waiting
to happen. Reserve coverage is inverted at render so that a higher number always reads as the worse
position.

**Threshold flags.** Read from `METRIC_SPECS` in `lib/scoring/institution-change.ts` — the same table
the brief crosses institutions against — so the two lenses cannot drift apart. The distinction from
the brief is state versus event: the brief reports a level *crossed this quarter*, this reports a
level the institution *is past now*, whenever it got there. An institution over 300% for two years
generates no crossing and still needs flagging. `capitalRatio` is deliberately excluded, because it
reads CET1, which CBLR filers do not report; capital is covered by the scenario instead.

**CRE downside** (`lib/scoring/cre-downside.ts`). A mark on the CRE book applied as a straight
deduction from capital with the denominator held constant, reporting the resulting ratio at 5/10/20/30%
and the break-even mark that reaches each floor. No tax benefit and no RWA relief on charge-off; both
omissions make it more severe than reality, which is the right direction for a screen. Two facts
govern the implementation:

- **A little under a third of institutions report no risk-weighted assets**, having elected the
  Community Bank Leverage Ratio framework, and **FDIC returns zero for their `RWAJ` and `RBCRWAJ`, not
  null.** A `!= null` guard passes that zero into a denominator. Every capital test here is a
  positivity test. The `0.75 × assets` proxy in `fdic-ratio-helpers.ts` is refused outright for this
  purpose: it would put a fabricated denominator under a number quoted to a credit committee. Such
  institutions are measured on Tier 1 leverage, with average assets backed out of the published
  `RBC1AAJ` rather than taken from period-end `ASSET`, so the base case equals FDIC's figure by
  construction. Foreign bank branches report zero for *both* regimes and correctly get no scenario.
- **The floors on the two regimes have to mean the same thing.** The headline is PCA
  *adequately capitalised* on each measure — **8% total risk-based capital, 4% Tier 1 leverage**
  (12 CFR 324.403). Using the 9% CBLR level instead made every leverage filer in Florida appear to
  have the thinnest cushion in the state; 9% is where a bank loses its reporting *election*, not its
  capital adequacy, and CBLR banks deliberately run just above it while risk-based banks sit seven
  points clear of 8%. The CBLR trigger is still reported as `floors[1]`, separately and labelled, and
  marked on intermediate rows of the table because it usually bites first.

`(RBCT1J + RBCT2) / RWAJ` reproduces FDIC's published `RBCRWAJ` to full float precision, which is
what licenses building on the reported dollars. `npm run verify:workbench` asserts exactly that over
live data and exits non-zero on any drift.

## 4a. Charts

All Recharts instances share `lib/chart-theme.tsx` — palette, axis, grid, tooltip. Colours are
literals rather than `var(--chart-N)` because Recharts writes SVG fills directly and the headless
Playwright pass that renders the PDF cannot resolve CSS variables.

The four analytics charts live once, in `components/charts/analytics/`, and are rendered by both the
on-screen Visual Analysis section and the PDF report view. Keeping a single copy is the point: they
were previously inline in `market-analytics-report-view.tsx` and reachable only by downloading the
report.

`market-analytics-visuals.tsx` deliberately calls `buildReportData` — the same server action the PDF
uses — rather than reading the dashboard's `screeningTable`. Both now carry real scores, but the two
cohorts differ: the table takes a single capped page while `buildReportData` paginates fully, so
nationally they rank against different populations. `buildReportData` is cached for six hours under a
versioned key, which removed most of that loading delay; national payloads may exceed the 2MB
data-cache entry limit, in which case Next skips the write and only smaller scopes benefit.

`singleLineTick` exists because Recharts wraps long category labels onto a second line that overlaps
the row beneath, which makes a twenty-row ranking unreadable.

**CRE Portfolio Composition stacks three bands, not four**, on a 0–100 axis: construction,
multifamily and non-owner-occupied, from `computeCreMix`. A stacked chart is a claim that the parts
make up a whole, so its bands must come from the same derivation as the total — see the CRE mix note
in section 3. `buildExposureMix` drops institutions with no CRE rather than drawing a row of zeroes,
and needs `ownerOccupiedLoans` and `nonOwnerOccupiedLoans` on the row to split non-residential the
way `computeCreLoans` does; without them the mix silently falls back to the undivided figure and
stops summing to 100%.

## 4b. Bank stress map

`components/market-analytics/heatmap/BankStressHeatMap.tsx`, MapLibre GL, fed by `/api/map/states`,
`/api/map/metros` and `/api/map/banks` over `app/actions/map-data.ts`. Gated by `bank-stress-map`.

**FDIC report dates must be `YYYYMMDD`.** A hyphenated `2025-09-30` is not rejected — it is accepted
and matches zero rows. This silently emptied every map endpoint for as long as the feature existed,
and it presents as missing data rather than as an error.

**The current quarter is never published.** Call reports lag by roughly two quarters. When no quarter
is requested, `map-data.ts` walks back through candidates until one returns rows; an explicitly
selected quarter is used as given, so nothing is misattributed to a period the user did not pick.

**The colour scale must tolerate a flat metric.** High-stress share is near zero in almost every
state at the default threshold. When quantile cuts collapse onto one value, cuts that cannot separate
anything are dropped, and a genuinely flat metric returns a neutral fill and sets `hasVariation`
false. Without that the old `<` comparison chain fell through to the most severe colour and painted
the entire country red.

MapLibre throws synchronously when it cannot get a WebGL context, which will unmount the whole tab
unless caught — construction is wrapped and falls back to a message panel.

Layer event handlers are bound once in the init effect. Registering them inside the layer-building
callbacks, which re-run on every data or colour change, accumulates duplicates.

Basemap is OpenFreeMap Positron (`tiles.openfreemap.org`), keyless and desaturated so the choropleth
carries the colour. The former `demotiles.maplibre.org` style has no state boundaries or place names.

## 5. Caching and scheduled work

Generated content is expensive, so nearly everything is cached for a day.

- **Server:** `unstable_cache` keyed by a version string plus the current Eastern-time day.
  **Bumping the version string is how you force regeneration in production** — the standard tool
  after fixing prompt or pipeline behaviour.

  | Key | Contents |
  | --- | --- |
  | `industry-outlook-shared-v12` | The generated memo |
  | `industry-outlook-verified-metrics-v1` | Fetched FRED/FDIC figures |
  | `market-analytics-report-data-v2` + scope | Full screening cohort with scores, for the PDF and Visual Analysis |
  | `executive-brief-v4` + scope | Ranked change events and non-reporting institutions for the Executive Brief |
  | `underwriter-workbench-v1` + scope | Latest-quarter rows for the whole scope, for the Underwriter Workbench |

  `market-analytics-report-data` is keyed by scope rather than by day and revalidates every six
  hours, since FDIC publishes quarterly. **Bump its version whenever the scoring changes**, or cached
  entries keep serving scores computed under the old method — v2 marks the move to percentile rank.
  The two lens caches follow the same rule on a **23-hour** window. **Bump `executive-brief`'s version
  whenever a change-detection threshold, the trajectory run length, a ranking function, the
  observation mapping or the cohort rule moves**, or the brief keeps reporting events under the old
  rules until the window expires — v2 marks the capital-ratio fix, v3 excluding institutions that did
  not file, v4 the non-reporting section. **Bump `underwriter-workbench`'s version whenever the row
  shape or the quarter rule changes**, or clients keep deserialising the old shape.

  **23 hours rather than 24 is deliberate and should not be rounded up.** The daily cron runs at
  05:00 UTC and both lenses cost the better part of a minute cold, so the entry has to be *expired*
  when the cron arrives. `unstable_cache` does not refresh a still-fresh entry, so at exactly 24 hours
  the warm run would find it valid, return early, and leave it to lapse in front of a user later that
  day. The residual case is a mid-afternoon deploy, which resets the clock and shifts expiry into the
  next working day; there is no fix for that within a plain TTL.
  Locally, deleting `.next/cache` does not clear it — the dev server holds it in memory too, so
  restart the server as well.
  A national payload can exceed the 2MB entry limit, in which case Next logs a warning, skips the
  write and only smaller scopes are cached.

- **Client:** `sessionStorage`, with its own version constants — `industry-outlook:v8`,
  `public_mentions:v4`, `investing_news:v2`. Bump these when the shape of cached data changes, or
  returning users get stale structures. There is also a same-day in-memory singleton for the memo.
- **Postgres:** `research_search_cache`, `research_feed_cache`, `research_summaries` persist across
  deployments.

Revalidate windows are ~25 hours so each day's content is a true daily snapshot.

### Cron jobs (`vercel.json`)

| Path | Schedule (UTC) |
| --- | --- |
| `/api/cron/warm-cache` | `0 5 * * *` |
| `/api/cron/warm-briefs` | `15 5 * * *` |

**Crons run only against production deployments**, so a preview never runs them — a dev deployment
starts cold and its first page load is slow. Warm it manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$URL/api/cron/warm-cache"
```

`.github/workflows/warm-cache.yml` warms production after every deploy: triggers on push to `main`
only, sleeps 120s for the build, then calls both endpoints with `CRON_SECRET`. **This workflow's
`CRON_SECRET` secret in GitHub must match Vercel's value** — a mismatch has broken warming before,
and the symptom is a slow tool rather than an error.

`warm-cache` includes both department lenses (`executiveBrief:national`, `workbench:national`). All
tasks run concurrently, so wall time is the slowest single one, but that is now a lens rather than an
OpenAI call: the workflow's curl timeout is 280s against the route's 300s `maxDuration`. **Only
`National` is warmed, because that is the only scope either lens is mounted with** — adding a scope
selector without adding its scopes here quietly restores a fifty-second cold load. Note that
`warm-briefs` is unrelated: it pre-generates *news article* summaries, not the Executive Brief.

`/api/cron` is exempt from the auth middleware and protected by bearer token instead.

## 6. Persistence

**Postgres** (Neon, via Vercel Marketplace; gated by `POSTGRES_URL` and `isDbEnabled()` in
`lib/db.ts`):

| Table | Written by |
| --- | --- |
| `research_reports` | `app/ingestion/storage/upsert-report.ts`, deleted by `delete-report` / `delete-test-reports` |
| `research_summaries` | `summarize-report`, `research-feed.ts`, `summarize-found-report.ts` |
| `research_search_cache` | `search-industry-reports.ts` |
| `research_feed_cache` | `api/research/feed-reports` (auto-creates itself) |
| `department_watchlist` | `app/actions/department-watchlist.ts` (auto-creates itself) |

`department_watchlist` holds FDIC institutions a department is tracking, keyed `(department, cert)`.
It is **not** related to `data/watchlist.json`, which is curated reference data — 45 named
distressed-credit firms with aliases and categories, loaded by `app/lib/watchlist.ts` and used to
match news and counterparties. That file belongs in the repository; this table is user state.

Note that `app/actions/watchlist.ts` is orphaned **and dangerous**: it writes a flat array of strings
to `data/watchlist.json` and would destroy the curated schema if ever called. Nothing imports it. It
should be deleted rather than reused.

Its functions return `ok: false` with a reason rather than an empty success when Postgres is absent.
That is deliberate: the previous filesystem watchlist wrote to a path that is read-only on Vercel, so
it worked locally and silently did nothing in production. An empty success would repeat that failure
in mirror image, and the interface needs to be able to say persistence is unavailable.

Those four are the whole Postgres surface. `industry_outlook_cache` and the `firm` / `firm_alias` /
`firm_entity` tables are **SQLite, not Postgres** — see the local-files section below.

Tables are created by `POST /api/admin/init-db` (header `x-admin-init-token`). Note this route sits
*behind* the password gate, so it needs the auth cookie as well as the token.

**When `POSTGRES_URL` is absent** the app degrades rather than failing: `isDbEnabled()` returns false,
caching becomes a no-op, and search and summarization still run but do not persist. That is exactly
how `dev` and local development run.

**Vercel Blob** holds uploaded report PDFs, served through a proxy route (`api/research/report-file`)
because the store is private. All eight call sites check for the token at request time and return a
clean JSON error, so a missing token degrades rather than crashing. **Nothing deletes blobs** — only
`put`.

**Local SQLite and JSON files.** Vercel's filesystem is read-only apart from `/tmp` and is not
durable across deployments, so **all of these are effectively local-development-only**. Do not add
runtime writes to them.

| Path | Purpose | Written by |
| --- | --- | --- |
| `data/aom.sqlite` | Miami-Dade AOM mortgage events | `scripts/import_aom_to_sqlite.py` |
| `data/competitor_surveillance.sqlite` | Competitor events | `app/ingestion/competitor_surveillance/` |
| `data/participant_intel.sqlite` | `firm`, `firm_alias`, `firm_entity` lookup | `lib/participant-intel.ts`, `participant-lookup.ts` |
| `data/ingestion.sqlite` | FFIEC / Census ingested data | `app/ingestion/` |
| `data/industry_outlook_cache.sqlite` / `.json` | Legacy outlook cache | `fetch-industry-outlook.ts` (dead path) |
| `data/watchlist.json`, `watchlist-aliases.json` | Curated 45-firm reference list | `app/lib/watchlist.ts` (read-only) |

## 7. Auth

`middleware.ts` gates everything except `/login`, `/api/auth`, `/api/cron`, `/_next` and `/favicon`.
It compares an `auth_token` cookie against `COOKIE_SECRET`; `/api/auth` sets that cookie after
checking `APP_PASSWORD`. **If `COOKIE_SECRET` is missing the comparison always fails and every
request redirects to `/login` in a loop** — the classic symptom of an unconfigured environment.

The session is meant to be effectively permanent, so nobody re-types the password during normal use:

- `lib/auth.ts` holds the single definition of the cookie name, options and lifetime. Both the
  middleware and `/api/auth` use it, so the two can never drift apart.
- The cookie lives for **one year** (`AUTH_COOKIE_MAX_AGE`). Browsers clamp persistent cookies to
  400 days, so a longer value would be silently truncated.
- Middleware **re-issues the cookie on every authenticated page view**, sliding the expiry forward.
  Anyone who opens the tool at least once a year is never asked to log in again. API responses are
  deliberately skipped so data fetches do not carry a `Set-Cookie` header.
- Requesting `/login` while already authenticated redirects to the app instead of showing the form.
- The `?from=` redirect target is passed through `safeRedirectPath()`, which rejects anything that
  is not a same-site path (`//host` and `/\host` parse as absolute URLs and are dropped).

Two things still end a session: pressing **Log out** (`DELETE /api/auth`, which expires the cookie),
and **rotating `COOKIE_SECRET`**, which invalidates every outstanding cookie at once. Rotate that
variable only when you intend to sign everyone out.

### Department, and why there is no user identity

There are no accounts. One shared `APP_PASSWORD` means the tool cannot know *who* you are, only which
department you said you belong to — a `department` cookie defined in `lib/department.ts`, set by the
header selector and read server-side in `app/page.tsx`.

Three consequences worth holding onto:

- **The cookie is not httpOnly**, unlike `auth_token`. It has to be, because the client writes it and
  the server reads it during render. Do not copy `AUTH_COOKIE_OPTIONS` for it.
- **`app/page.tsx` is `async`** solely so it can call `cookies()`. Reading the preference in an effect
  instead would render the wrong view and then swap it.
- **Anything keyed by department is shared** by everyone in that department, including watchlists.
  There is no private workspace and no attribution. This was an explicit product decision, not an
  oversight: a team's context should survive any one person being away.

`parseDepartment` returns null for an unrecognised value rather than defaulting to one, since "not
chosen" is a real state and guessing would put someone in the wrong view without telling them.
Middleware ignores this cookie entirely; it only ever reads and re-issues `auth_token`.

Because the department is a stated preference rather than an authenticated claim, **it must never be
used to gate access to anything**. Anyone can set the cookie from the console. It selects which lens
renders, nothing more; `auth_token` remains the only access control.

Additional token-protected endpoints, each authenticated by header:

| Endpoint | Header |
| --- | --- |
| `/api/admin/init-db` | `x-admin-init-token` |
| `/api/ingestion/run` | `x-ingestion-token` |
| `/api/research/upload`, `delete-report`, `delete-test-reports` | `x-admin-upload-token` |
| `/api/cron/*` | `Authorization: Bearer $CRON_SECRET` |

Vercel **Deployment Protection** is enabled for previews, so the `dev` URL additionally requires a
Vercel login and cannot be shared with people outside the account without a bypass token.

## 8. Environment variables

Every variable referenced in code. Scope matters: `POSTGRES_URL` and `BLOB_READ_WRITE_TOKEN` must be
**Production-only**, or a dev deployment writes to real data.

| Variable | Consequence if missing |
| --- | --- |
| `OPENAI_API_KEY` | All AI features fail: outlook, briefs, summaries, legal feed |
| `APP_PASSWORD` | Nobody can log in |
| `COOKIE_SECRET` | Infinite redirect loop to `/login` |
| `CRON_SECRET` | **Security-relevant: the cron routes only check a bearer token when this is set, so if it is unset they are publicly callable.** A mismatch between GitHub and Vercel instead returns 401 and the tool becomes slow |
| `POSTGRES_URL` | Research persistence off; features degrade (intended on dev) |
| `BLOB_READ_WRITE_TOKEN` | Report uploads and PDF serving fail (intended on dev) |
| `DATA_ENVIRONMENT` | Assumed to be production data; destructive routes refuse on non-production |
| `ENABLED_TABS` | **No tabs render in production.** Ignored outside production |
| `GOOGLE_API_KEY`, `GOOGLE_CSE_ID` | Market Research search unavailable |
| `GOOGLE_CSE_API_KEY` | Separate key, used only by CBRE ingestion (`app/ingestion/sources/cbre-cse.ts`) |
| `ADMIN_INIT_TOKEN` | Cannot initialize database tables |
| `ADMIN_UPLOAD_TOKEN` | Cannot upload or delete reports |
| `INGESTION_TOKEN` | Ingestion endpoint unavailable |
| `ELEMENTIX_API_KEY` | Participants-intel API returns null (feeds orphaned UI — see §10) |
| `CENSUS_API_KEY`, `FFIEC_USER_ID`, `FFIEC_TOKEN` | Corresponding analytics sections report `configured: false` |
| `NEXT_PUBLIC_FDIC_API_KEY`, `FDIC_API_URL`, `FDIC_API_KEY` | All optional; anonymous FDIC access works today. Read by `lib/fdic-client.ts`, the single hardened path to the API (fallback host, timeout, 4xx short-circuit) shared by the analytics actions and the map |
| `FRED_API_KEY` | **Not needed by the outlook**, which uses FRED's keyless CSV endpoint. Still read by `fetch-kpi-data.ts` and `fetch-cre-data.ts`, whose FRED paths return null without it (KPI then falls back to an AI-written narrative) |
| `APP_URL`, `NEXT_PUBLIC_APP_URL` | Fallback base URL for server-side PDF rendering |
| `OPENAI_FAST_MODEL`, `OPENAI_SMART_MODEL`, `OPENAI_SUMMARY_MODEL`, `OPENAI_SUMMARY_PDF_MODEL`, `OPENAI_SEARCH_FILTER_MODEL` | Model overrides; defaults apply if unset |
| `CBRE_COVEO_SEARCH_URL` | Legacy CBRE ingestion |
| `MI_PDF_EXTRACTOR_*` | Test-mode switches for the PDF extractor |
| `NEXT_PUBLIC_NONCURRENT_DEBUG` | Optional debug flag |
| `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_REGION`, `NODE_ENV` | Platform-provided |

Historical note: the project migrated OpenAI → Perplexity → Claude → OpenAI. `ANTHROPIC_API_KEY`,
`PERPLEXITY_API_KEY`, `RESEND_API_KEY`, `NEWS_*` and `NEWS_SEND_TOKEN` may linger in Vercel or
`.env.local` but are **no longer read by any code**. `lib/claude.ts` no longer exists; comments
elsewhere still mention Claude and are stale.

`LEGISCAN_API_KEY` **is not read anywhere in the code**, despite having been listed as required in
the old `DEPLOYMENT_CHECKLIST.md` (deleted 2026-08-24). The Legal tab is entirely OpenAI-generated,
not LegiScan-sourced. It can be removed from Vercel. That checklist also omitted `APP_PASSWORD`,
`COOKIE_SECRET`, `BLOB_READ_WRITE_TOKEN` and `DATA_ENVIRONMENT`, which is why this table replaced it.

## 9. Build and tests

```bash
npm run build              # next build
npm run dev                # local, reads .env.local
npm run test:environment   # environment detection (9 tests)
npm run test:memo-evidence # evidence guard
npm run test:verified-metrics
npm run test:allowlist            # hostname matching and what "all" covers (14 tests)
npm run test:metrics
npm run test:opportunity-score
npm run test:institution-change    # change detection and brief ranking (14 tests)
npm run test:fdic-cre              # the CRE definition and its two traps
npm run test:quarter               # FDIC report-date arithmetic
npm run test:peer-cohort           # workbench cohort selection and relaxation
npm run test:cre-downside          # the capital scenario, both regimes
```

`test:allowlist` runs under `tsx` rather than Node's type stripping, because `lib/domain-allowlist.ts`
imports `./entity-sources` without an extension and type stripping cannot resolve that. Keep the npm
script and the file header in agreement: until 2026-08-25 the script used type stripping, so the suite
aborted at module load and none of its assertions had run since March. **A suite that cannot run is
worse than one that fails**, because it reports nothing while looking maintained — worth a glance at
the pass count, not just the exit code, after touching any runner.

Its expectation for `"all"` is a `deepStrictEqual` against the nine primary domains, written out rather
than derived from `PRIMARY_V1_ENTITY_IDS`, so widening that set breaks the test on purpose (see §3).

Scripts that hit the live FDIC API rather than asserting, and exist to be read:

```bash
npm run verify:executive-brief [STATE]                      # brief volume and what leads each section
npm run verify:workbench [STATE]                            # workbench, and reconciliation against FDIC
node --experimental-strip-types scripts/verify-change-detection.mjs [STATE]
node --experimental-strip-types scripts/verify-score-distribution.mjs
```

`verify:workbench` is the one that asserts: it exits non-zero when a scenario's base capital ratio
drifts from FDIC's published `RBCRWAJ` or `RBC1AAJ`. It runs the **shipped** pipeline — transformer,
row mapping, analysis — rather than a copy, which is why `toWorkbenchRows` lives in the analysis
module rather than in the server action. It runs under `tsx` rather than Node's type stripping,
because it needs the `@/` path alias; it is a `.ts` file wrapped in a `main()` rather than a `.mts`
with top-level await, since the package is CommonJS and Node's named-export detection cannot see
through esbuild's export wrapper when an ES module imports that output.

**Rendered output is not covered by any of the above, and every data-accuracy bug found so far
survived a clean build and passing unit tests.** After touching a lens:

```bash
npm run dev
npm run verify:lenses              # screenshots both lenses, dumps their text
SKIP_BRIEF=1 npm run verify:lenses # workbench only; the brief is slow on a cold cache
```

It reads `APP_PASSWORD` from `.env.local` inside the Node process, so the password never reaches a
shell environment or a process list. Screenshots land in `/tmp/lens-shots`. Read the numbers.

Tests use Node's built-in runner with `--experimental-strip-types`, which requires importing local
modules **with the `.ts` extension** — `import { x } from "./y.ts"`. TypeScript flags this as an
error, which is expected and harmless.

There is no aggregate `npm test`; each suite runs individually. `scripts/pdf_extraction.test.js`
exists outside these scripts.

`next.config.mjs` sets **`typescript.ignoreBuildErrors: true`**, plus `images.unoptimized: true` and
`serverExternalPackages: ["better-sqlite3"]`. The repo has pre-existing type errors
across roughly a dozen files, so `npx tsc --noEmit` is noisy and the build does not gate on it. When
changing code, check that *your* files are clean rather than expecting a clean overall run.

## 10. Known fragility

- **`NODE_ENV` as a production check.** Fixed in `lib/features.ts`,
  `app/actions/search-industry-reports.ts` and `app/actions/summarize-found-report.ts`, but other
  `NODE_ENV === "production"` checks remain (for example in `app/actions/fetch-report-summaries.ts`).
  They currently fail safe — degrading to empty rather than erroring — but audit before relying on
  them.
- **AI output is probabilistic.** Prompt changes must be verified by running generation, ideally more
  than once. Historically, prompt instructions alone did not prevent fabricated figures; the
  programmatic guard did.
- **Cache keys hide fixes.** After changing generation behaviour, bump the cache version or
  production will serve yesterday's output.
- **A lot of orphaned UI.** None of these are mounted from `app/page.tsx` or the dashboard:
  `market-participants-intel.tsx` and `components/participants-intel/*` (the tab was removed in
  `259fa20`), `national-view.tsx`, `florida-view.tsx`, `miami-view.tsx`, `market-research-library.tsx`,
  `market-research-reports.tsx`, `competitor-analysis.tsx`. Confirm reachability before investing
  effort in any of them. Note the admin upload library is in this list, so the Blob upload path has
  no live UI even though its API routes work.
- **The daily cron still warms caches for orphaned features** — KPI, insights, price index and
  transaction volume are warmed by `warm-cache` but only consumed by unmounted views. That is
  needless OpenAI and FRED usage every morning.
- **Hardcoded figures, but not user-facing.** `fetch-market-research.ts` contains static Miami
  office/industrial metrics labelled "2025 YTD" (around L708–835). Verified 2026-08-21:
  `fetchMiamiIndustrialReport()` has **no callers**, so none of it reaches a user. Delete it rather
  than refresh it; the hazard is a future session wiring it up without noticing the dates. The
  hardcoded `CENSUS_YEAR = 2022` is separate and does run, but the Miami ACS metrics it produces are
  written to `section.miamiDade`, which the UI never reads.
- The `P3ASSET`/`P9ASSET` past-due columns are correct despite comments suggesting they are ratios;
  the fields really are dollar amounts in thousands. Fix the comments, not the code.
- **The live tab and the export rank against different cohorts.** The tab takes a single capped page
  of 10,000 rows sorted by assets descending, while the export paginates everything. Nationally that
  is the largest ~1,100 institutions against all ~4,450, so counts and averages differ between the
  two — and because scores are percentile ranks, a national score on the tab means "percentile among
  banks over roughly $1bn", not among all banks. The table states this in `scopeCoverageNote` rather
  than implying a complete screen. Full pagination is not a fix on its own: ~40k national rows takes
  around 20 seconds and exceeds the 2MB data-cache ceiling. A cached server-side data layer is the
  real answer and is Phase 1 of `docs/NEXT_VERSION_PLAN.md`.
- **Scores are cohort-relative, so any new surface must state its cohort.** A bare score is not
  meaningful on its own. This is a permanent property of percentile ranking, not a defect.
- **The same row cap now limits the Underwriter Workbench's search.** Both lenses see the largest
  ~1,113 institutions nationally, so an underwriter cannot look up a small local bank at all — the
  name simply does not appear. Both cards say so, and it is the same pagination problem as above.
- **`RWAJ` and `RBCRWAJ` are zero, not null, for CBLR filers** — roughly a third of institutions. A
  `!= null` guard passes the zero into a denominator and yields an infinite ratio rather than an
  error. Test positivity. `computeCapitalRatios` and `computeDownside` both do; anything new reading
  those fields must too.
- **Regulatory levels are not interchangeable.** The 9% CBLR figure is a *reporting election*
  trigger, the 8%/4% PCA figures are *capital adequacy* categories, and the 300% CRE figure is a
  *supervisory screening* criterion. Comparing one regime's institutions against a level of a
  different kind produces a ranking that measures the regime rather than the risk — this has already
  happened once, in the workbench scenario. Check what a level actually means before ranking on it.
- **The screening table renders up to 30 columns** — 16 always, plus 4 capital and 7 earnings behind
  the Columns popover — with no frozen first column, so scrolling right loses the institution name.
- **Dead code:** `app/actions/fetch-industry-outlook.ts` (superseded by `getCachedOutlook.ts`, still
  writes local SQLite/JSON), `app/actions/fetch-public-mention-summary.ts` (no importers), and
  `fetchMiamiIndustrialReport()` (no callers).
- **Two OpenAI integration styles** coexist: the Responses API via `lib/openai.ts`, and direct Chat
  Completions in `generate-research-memo.ts` (hardcoded `gpt-4o`), `lib/report-summarizer.ts`,
  `lib/report/interpretation.ts` and `generate-analyst-narrative.ts`. Only the first honours the
  shared timeout and citation-stripping logic.
- **The post-deploy workflow can report a false failure.** Its curl caps at 120s while the
  warm-cache route allows 300s, so a slow warm shows as a CI failure even though the route completes.
- **`app/api/cbre-automate/route.ts`** intentionally returns 501 on Vercel; it spawns a local
  process.
- **Playwright** is used by `app/api/report/market-analytics-pdf/route.ts`, which makes that route
  heavier and slower than the rest.
- **Free-tier ceilings.** Vercel Blob on Hobby pools usage across *all* stores: 1 GB, 10,000 reads,
  2,000 writes/listings per month. Exceeding it revokes Blob access for 30 days rather than billing,
  which would take the production report library offline. Neon Free allows 0.5 GB and 100 CU-hours
  per project, and suspends compute after five minutes idle.
- **Several Postgres variables in Vercel are flagged "Needs Attention"** and have not been
  investigated. May affect the live research library.

## 11. Runbook

**Force the outlook to regenerate in production** — bump the version in the cache key in
`getCachedOutlook.ts` (currently `industry-outlook-shared-v12`), push to `main`, then confirm via the
post-deploy warm-cache log that `keySignalFigures` is non-zero.

**Diagnose "the tool is slow"** — almost always cold caches. Check the latest
`Warm Cache After Deploy` run in GitHub Actions; a 401 means `CRON_SECRET` drifted between GitHub and
Vercel.

**Check what a deployment is wired to** — `GET /api/research/blob-health` with the auth cookie
returns `vercelEnv`, `nodeEnv` and a masked Blob token. Identical masked tokens across two
deployments mean they share a store.

**Ship dev work** — `git checkout main && git merge dev && git push origin main`. Never push feature
work straight to `main`.

**Roll back** — see `ROLLBACK.md`.
