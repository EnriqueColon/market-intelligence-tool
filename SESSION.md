# Session Log

Running record of work sessions, most recent first. Update at the end of every session, alongside
`README.md`, `ROLLBACK.md` and `confluence.md`.

Each entry should let someone who was not present answer three questions: what changed, what state
is it in now, and what is still open.

---

## 2026-08-25 (latest) — the market pulse as a crawl

Requested directly: make the Market Pulse figures rotate the way an exchange ticker does. The strip
under the header was a five-tile grid; it is now a single continuous crawl of the same five FRED
series — label, value, move, sparkline — separated by rules, with the rail fading at both edges so a
figure dissolves rather than being chopped at the container boundary. **No data changed.** Same
series, same `unstable_cache`, same figures, same silent-disappearance behaviour when FRED is
unreachable. This is presentation only.

Two things are measured at runtime rather than hardcoded, and both are the point rather than
polish. **Lap duration comes from the measured width of one sequence**, so the crawl holds a constant
40px/s; with a fixed duration the speed would depend on how much content there is, and a strip that
lost two dead FRED series would visibly speed up — a rendering artefact that would read as the market
moving faster. **Copy count comes from the measured rail width**, because two copies loop seamlessly
only while the sequence is wider than the rail; below that, every lap drags a band of empty track
across the screen. Both are handed to CSS as custom properties, `--pulse-ticker-shift` and
`--pulse-ticker-duration`, and consumed by keyframes in `app/globals.css`.

The reduced-motion case needed explicit handling and is the part most likely to be broken by someone
later. `app/globals.css` already collapses every animation to `0.01ms` with a single iteration for
anyone who has asked their OS to stop motion. For a crawl, the final frame is *one copy already
scrolled off* — so the blanket rule alone would make the strip appear to start blank. A later rule
drops the animation outright, hides the `aria-hidden` duplicate copies that exist only to feed the
loop, and makes the rail scrollable by hand. The crawl also pauses on hover and `:focus-within`,
because reading a figure off moving text is otherwise a race.

Change indicators were deliberately left neutral grey rather than the green and red an exchange
ticker would use. On a real ticker green means "up" and reads as good; here the first series is CRE
delinquency, where up is bad. Colour would assert a valence the data does not carry, and getting it
right would mean inverting the sense per series.

**State now.** Verified against a running dev server rather than inferred from a clean build, which
is this repo's standing rule: 120px of travel in 3 seconds against a 1782px sequence and a 1100px
rail, the lap shifting exactly one copy, hover freezing it, and reduced motion resolving to
`animation-name: none` with one visible copy and a scrollable rail. No console errors. `npm run
build` compiles clean and `npx tsc --noEmit` is unchanged at **74 errors**, none in the two files
touched. Committed as `c135ac2`.

**Still open.** Unchanged from the entry below, none of it touched here. `npx tsc --noEmit` remains
noisy at 74 errors across a dozen files, 14 of them the expected `TS5097` from test imports. `mba`,
`mhn` and `commercialsearch` remain a settled decision rather than drift — kept in `ENTITY_SOURCES`
as inbound-URL allowlisting only, in neither `"all"` nor `ENTITY_DROPDOWN_OPTIONS`, with no plan to
make them selectable. `verify:workbench`, `verify:executive-brief` and `verify:lenses` have still not
been run; they need live FDIC calls or a running server, and nothing they cover has been touched for
two sessions. The national payload still exceeds Next's 2MB data-cache entry limit, so
`buildReportData` logs a cache-write failure and returns a 500 on the first cold national load in
development. `LNREOTH` remains exposed for display only and must never be added into a CRE
denominator. And `main` is still at `e8bf8ad`: everything from the last several sessions — the
corrected CRE definition, the capital-ratio fixes, both department lenses, the allowlist work and now
this — is on `dev` and not in production.

---

## 2026-08-25 — closing the half of the allowlist that failed open

The previous entry recorded, as a finding rather than a fix, that the two layers of the publisher
allowlist disagreed about an unrecognised entity id. `filterByAllowlist` got an empty domain list and
dropped every result. `buildSearchQuery` got the same empty list and returned the bare keyword — a
Google search with no `site:` restriction at all, across the open web. **That gap is now closed in
code.** The pair was safe in practice, but only because the filter ran second and caught everything
the unrestricted query returned, and that is a bad thing to be relying on: the filter looks redundant
from the outside, so a maintainer could remove it on the entirely reasonable grounds that the query is
already scoped to the allowlist, and silently widen an internal research tool to the whole internet.
Nothing in the code said the two were load-bearing together.

`buildSearchQuery` now returns `string | null`, and `null` when the entity resolves to no domains.
The mechanism was chosen from what the call sites actually look like: **there is exactly one**,
`searchIndustryReports` in `app/actions/search-industry-reports.ts`, and it pairs the query with
`filterByAllowlist` on the *same* `entityId` a few lines later. So no caller ever wanted an
unrestricted search — the open-web query was always followed by a filter that discarded all of it,
making it pure waste as well as a hazard. With one call site the cost of the strongest option was
close to zero, and `strict` is on in `tsconfig.json`, so `string | null` is enforced by the type
checker rather than by whoever reads the function next.

It rejects rather than throws, which was the other candidate. An unknown id is not a programming
error: `entityId` crosses a server action boundary, and the `EntityId` union is erased at runtime, so
a stale or hand-crafted client payload can genuinely deliver an id the registry has never heard of.
That is untrusted input to refuse, not an assertion to trip. Throwing would also have been actively
worse here, because `buildSearchQuery` is called *outside* the `try` that wraps the fetch, so the
throw would have escaped the action as an unhandled error rather than a message.

The call site returns its existing `{ ok: false, error }` variant, and the client component already
renders `res.error` in its error line, so **no UI change was needed** — an unknown entity id now
produces a clear message instead of open-web results, and no Google credentials are spent on a search
that was going to be discarded. Note this is reachable only from outside the dropdown, which cannot
emit an unregistered id; through the UI nothing changes.

Four assertions were added to `lib/domain-allowlist.test.ts`, in a `buildSearchQuery` block placed
directly after the `filterByAllowlist` one so both halves of the invariant are read together. Beyond
the `null` case they assert that every dropdown option produces a `site:` clause, which is the
property actually worth protecting. The note in the old `filterByAllowlist` assertion describing the
asymmetry as unfixed was replaced rather than left to go stale, and the same applies to the paragraph
in `confluence.md` that documented the fail-open branch as a known hazard.

**State now.** Twelve suites, **151 assertions**, all passing, up from 147; only the allowlist suite
changed, 14 → 18. `npm run build` compiles clean. `npx tsc --noEmit` reports **74 errors against a
baseline of 73**, and the one added is not a type regression: it is another `TS5097` from importing
`./google-query-builder.ts` with its extension, which is the convention every test file in the repo
follows and which `README.md` already documents as expected and harmless. Excluding that class,
errors are unchanged at 59 and the lists are identical line for line. Avoiding it would have meant
either breaking the test-import convention or fixing pre-existing errors that were deliberately left
alone.

**Still open.** `npx tsc --noEmit` remains noisy, now 74 errors across a dozen files, 14 of them the
expected `TS5097` from test imports. `mba`, `mhn` and `commercialsearch` stay in `ENTITY_SOURCES` but
are in neither `"all"` nor `ENTITY_DROPDOWN_OPTIONS`, so nothing can select them — this is now a
**settled decision rather than drift: they are kept as inbound-URL allowlisting only**, so that a URL
arriving from elsewhere still validates through the resolver while an unqualified search will not
reach them. Reaching them from the UI would mean editing `PRIMARY_V1_ENTITY_IDS`, the dropdown filter
and the exact-list assertion together, and there is no plan to. `verify:workbench`,
`verify:executive-brief` and `verify:lenses` were not run this session; they need live FDIC calls or a
running server and nothing they cover was touched. The national payload still exceeds Next's 2MB
data-cache entry limit, so `buildReportData` logs a cache-write failure and returns a 500 on the first
cold national load in development. `LNREOTH` remains exposed for display only and must never be added
into a CRE denominator.

---

## 2026-08-25 — settling what "all" means, and retiring an entity that no longer exists

The session before this one revived `npm run test:allowlist`, which had aborted at module load since
March, and deliberately left its three failing assertions red because they encoded a product question:
whether `getDomainsForEntity("all")` should mean every approved domain or only the eight
`PRIMARY_V1_ENTITY_IDS`. **That question is now settled — the curated subset is the intent.** So the
shipped behaviour stands and the documentation and the tests were the stale side of the contradiction.

`getDomainsForEntity`'s own doc comment said "For 'all' returns all domains", the opposite of what the
function does. It now says what `"all"` actually means and why: the primary Search Industry Reports
publishers rather than everything allowlisted. That matters more than a comment usually would, because
`"all"` is the default in the entity dropdown and `buildSearchQuery` turns the result into a `site:`
restriction — the list decides what an unqualified search can reach at all.

Three assertions changed. The `"all"` expectation is now `deepStrictEqual` against the nine domains the
eight primary entities carry (CBRE contributes two), spelled out as a literal rather than derived from
`PRIMARY_V1_ENTITY_IDS`, with a companion assertion that `mba.org`, `multihousingnews.com` and
`commercialsearch.com` are absent. Deriving it from the constant would have made the test agree with
any future widening automatically, which is exactly the silence worth preventing: widening `"all"` now
has to be a deliberate edit in two places. Note that the excluded set is **three** entities, not the
two named in the previous entry — `mba` is outside the primaries too, and `mba.org` was what the old
assertion actually tripped on.

Of the two `watchlist` assertions, the one in `getDomainsForEntity` is deleted outright; `watchlist` is
gone from the `EntityId` union and there is nothing left to test. The one in `filterByAllowlist` is
rewritten rather than deleted, because it was accidentally covering something worth keeping: passing an
id the registry does not know produces an empty allowlist, and the filter drops **everything** rather
than passing results through unfiltered. It now asserts that, with the id cast, and records the
asymmetry that makes it load-bearing — `buildSearchQuery` given the same empty domain list does the
opposite and falls back to an *unrestricted* Google query, so the filter is the only layer that fails
closed. Replaced with a directly-named-entity assertion for the registry lookup path it used to cover.

**State now.** Twelve suites, 147 assertions, all passing, up from 133 across eleven. `npm run build`
compiles clean. `npx tsc --noEmit` went from 75 errors to 73: the two that disappeared were the old
`"watchlist"` literals, which had never been assignable to `EntityId`. The two remaining errors in the
file are the expected `TS5097` from importing with a `.ts` extension.

**Still open.** `npx tsc --noEmit` remains noisy at 73 errors across a dozen files. `mba`, `mhn` and
`commercialsearch` stay in `ENTITY_SOURCES` but are in neither `"all"` nor `ENTITY_DROPDOWN_OPTIONS`,
so nothing can currently select them — they only serve to allowlist a URL that arrives from elsewhere.
Whether they should be reachable or removed is worth an explicit decision rather than another year of
drift. `verify:workbench` and `verify:executive-brief` were not run this session; both hit the live
FDIC API and no FDIC code was touched. The national payload still exceeds Next's 2MB data-cache entry
limit, so `buildReportData` logs a cache-write failure and returns a 500 on the first cold national
load in development. `LNREOTH` remains exposed for display only and must never be added into a CRE
denominator.

---

## 2026-08-25 — a test suite that had never run

Closing out the previous session's work. Everything from 2026-08-24 is committed and pushed, `dev` is
level with `origin/dev`, the build compiles clean, and eleven suites pass 133 assertions between them.
One item on that session's "still open" list turned out to be understated, so it is worth correcting
rather than carrying forward as written.

`npm run test:allowlist` was recorded as failing on an unresolvable extensionless import under
`node --experimental-strip-types`. That much was true, but the consequence was worse than "a suite
fails": the process aborted at module load, so **not one of its thirteen assertions had ever
executed**, and it had been that way since the March "Market Research revamp" that split the domain
API into landing and asset variants. Both `README.md` and `confluence.md` listed it among the
verification commands with no caveat, so the repository looked better covered than it was. The test
file's own header had said `Run: npx tsx …` all along; only the npm script disagreed, and `tsx` was
already a dependency. The script now matches the file, which is a one-line change and the same reason
`verify:workbench` runs under `tsx`.

Running it reveals ten passing assertions that had been providing no signal, and three failures that
are **the test disagreeing with a deliberate change rather than a defect**. `watchlist` was removed
from the `EntityId` union, so the two assertions expecting it to expand to CBRE + JLL are asserting
against an entity that no longer exists. The third expects `getDomainsForEntity("all")` to return
every approved domain, where it now returns only the eight `PRIMARY_V1_ENTITY_IDS`.

Those three were left failing on purpose. `all` returning a curated subset is either the intent —
`PRIMARY_V1_ENTITY_IDS` is an explicit named constant, which reads deliberate — or a regression, and
the function's own doc comment still claims "For 'all' returns all domains", so the code and its
documentation contradict each other. Deciding which is right is a product call about Search Industry
Reports, and quietly rewriting the assertions to match current behaviour would have destroyed the
evidence that the question exists. Nothing in this session's FDIC or lens work touches these files;
they are byte-identical to `main` and last changed in March.

**Still open.** The three allowlist assertions above, pending that decision. `npx tsc --noEmit`
remains noisy at 75 errors across a dozen files, unchanged. The national payload still exceeds Next's
2MB data-cache entry limit, so `buildReportData` logs a cache-write failure and returns a 500 on the
first cold national load in development. `LNREOTH` remains exposed for display only and must never be
added into a CRE denominator.

---

## 2026-08-24 — zero is not a number, and a stacked chart that summed to 255%

Two columns in the screening table were showing a plausible figure that meant something other than
what it said. Both were found the same way as everything else today: by reconciling against what
FDIC publishes, and by asking whether a magnitude is believable before checking any arithmetic.

**Zero versus absent, which is the one that mattered.** FDIC reports `RBCRWAJ` as a literal `0` — and
omits `RBCT1CER` and `RBC1RWAJ` entirely — for institutions on the Community Bank Leverage Ratio
framework, because electing it excuses them from risk-weighting. That is **1,765 of 4,352, 40.6% of
the industry**, not an edge case. Coercing those to zero rendered them at 0.00% total risk-based
capital in the screening table, visually identical to a failed bank. The magnitude check settles it
on its own: only **2** institutions in the country genuinely report total risk-based capital below
8%, so a column showing 1,765 at zero is measuring a reporting regime, not distress. Their median
leverage ratio is 11.80%, and electing CBLR requires at least 9%.

The display was not the damage. The Opportunity Score's capital slot is `cet1Ratio ?? leverageRatio`,
and `??` only falls through on **null** — so a zero never reached the leverage ratio, and every one
of those institutions tied at the bottom of the capital distribution. Capital is 15% of the score and
inverted, less capital meaning more distress, so **30 of the top-100 most-distressed institutions
were CBLR filers that did not belong there**, and fixing it moved the median institution 120 rank
places. That list is the tool's actual work product, which is what makes this the most consequential
bug of the day despite looking like a formatting problem.

Worth being precise about the blast radius, because the instinct is to assume everything moved:
CRE-to-capital, the stress map and the Underwriter Workbench were **unaffected**. They read reported
Tier 1 and Tier 2 dollars rather than the ratios, and `verify:workbench` produces byte-identical
output before and after. Several places had already grown private workarounds — `reported()` in the
workbench, `!== 0` in the drawer — which is the signal that the transformer was lying to its
consumers rather than that its consumers were careless.

The fix is at the boundary: `normalizeCapitalRatioPercent` now maps zero to null, and the four
ratios are typed `number | null` rather than optional numbers, so a consumer has to decide what
absence means instead of silently inheriting a zero. `RWAJ` and `RBCT1J` are guarded on positivity
for the same reason — a zero denominator yields Infinity rather than a caught absence.

**A stacked chart whose bands summed to a median of 255%.** `LNREOTH` is closed-end 1-4 family
residential (`LNRERES − LNRELOC = LNREOTH` exactly everywhere) and was drawn as a fourth "Other CRE"
band divided by `creLoans`, a denominator it is not part of. The third band had a quieter version of
the same fault: it used the undivided `LNRENRES`, re-including the owner-occupied property the CRE
definition deliberately removes. Together the shares exceeded 100% on **4,129 of the 4,164**
institutions holding any CRE, reaching 681,607% at a thrift with a large mortgage book and almost no
CRE — against a chart axis that stops at 100. `computeCreMix` now derives the three parts
`computeCreLoans` actually adds up, so they sum to 100% by construction rather than by hope.

**Verification, since every bug today survived a clean build and passing tests.** Read from the
rendered page over 1,113 institutions: no row shows 0.00% CET1, the 225 CBLR filers show "—" beside
their real leverage ratio and are labelled "Leverage", and every CRE mix sums to 100.0% ± 0.1
rounding. `npm run audit:fdic-columns` passes on the merged state, so the lens work introduced no
reconciliation failure; it gained a check that a zero total risk-based capital ratio always has a
leverage ratio to fall back to (0/1,748), and a table of which capital fields use zero to mean
absent. `verify:workbench` and `verify:lenses` both clean, no console errors.

**Also removed:** a `normalizePercentToDecimal` warning that announced "treating as basis points"
for a rescaling it never performed, firing about thirty times per page load on loans-to-deposits
above 100% — an entirely ordinary figure. A warning that cries wolf on a normal value is the noise a
real signal has to be spotted in.

**Still open.** `npm run test:allowlist` fails on an unresolvable extensionless import of
`lib/entity-sources` from `lib/domain-allowlist.ts` under `node --experimental-strip-types`.
Pre-existing and unrelated; it fails identically at `bec51b8`. `npx tsc --noEmit` remains noisy at 75
errors across a dozen files, unchanged by this work. The national payload still exceeds Next's 2MB
data-cache entry limit, so `buildReportData` logs a cache-write failure and returns a 500 on the
first cold national load in development.

---

## 2026-08-24 — the second lens, and a floor that was measuring the wrong thing

Three pieces of work, in order: surface the institutions the Executive Brief was hiding, build the
Underwriter Workbench, and stop the lenses taking fifty seconds to load.

**The brief now lists institutions that stopped filing.** It already held them out of the movement
sections — an institution whose latest call report predates the as-of quarter would otherwise have a
Q4 crossing dated to Q1 — and stated the count. Counting is not showing. A bank that stops filing has
usually merged, been acquired or failed, and nationally that is 102 of 1,215. They now have their own
section, last and visually quieter than a supervisory crossing, capped at six and ordered largest
first because every one is equally "not filing" and size is all that separates a material absence
from an immaterial one. Rows are deliberately **not** clickable: the profile drawer draws on a cohort
selected by the same latest-quarter rule that put them in this list, so every one would resolve to
"not found". The live output is a list of real 2025 M&A — Discover, Pacific Premier, Independent Bank
of McKinney — which is the point.

**The Underwriter Workbench is the second of the four lenses.** Same contract as the brief: renders
above the tabs when the department cookie is `underwriting`, removes nothing, hands off to the
Market Analytics drawer rather than growing a second cohort. It answers what the screening table
cannot — compared to whom, what is already flagged, and how much room is left.

*Compared to whom* is a peer cohort matched on size band, then geography, then CRE mix, relaxing mix
first and geography second when too thin, and never relaxing size. Which criteria survived is printed
on the card, and below eight peers no percentile is shown at all.

*What is already flagged* reads its levels from the same `METRIC_SPECS` the brief uses, so the two
lenses cannot disagree about the same bank. The brief reports crossings; an institution over 300% for
two years generates none and still needs flagging.

*How much room is left* is a mark on the CRE book against capital.

**The bug worth remembering is in that last one, and only rendered output showed it.** A little
under a third of institutions report no risk-weighted assets, having elected the community bank
leverage framework — and **FDIC returns zero for their `RWAJ` and `RBCRWAJ`, not null**, so a `!= null`
guard passes a zero into a denominator. That part was handled from the start. What was not: leverage
filers were measured against the 9% CBLR level while risk-based filers were measured against 8% total
risk-based capital, and every one of the eight thinnest cushions in Florida came back a CBLR filer.
That is an artifact of the two floors meaning different things. 9% is where a bank loses its
*reporting election*, not its capital adequacy, and CBLR banks deliberately sit just above it, while
risk-based banks sit seven points clear of 8%. The headline is now PCA adequately-capitalised on each
measure — 8% total risk-based, 4% Tier 1 leverage, the genuinely matched pair from 12 CFR 324.403 —
and the CBLR trigger is still shown, separately and labelled. Afterwards the distributions overlap:
risk-based median 19.8%, leverage 26.1%.

**Verification.** `npm run verify:workbench` runs the shipped pipeline end to end over live FDIC data
— transformer, row mapping, analysis — and fails if any base ratio drifts from FDIC's published
`RBCRWAJ` or `RBC1AAJ`. It reimplements nothing, which is why the row mapping sits in
`lib/scoring/workbench-analysis.ts` rather than in the server action. It reports break-evens split by
regime, which is the line that would have caught the floor bug unaided; a pooled median hid it.
Florida reconciles clean on all 83 institutions, and Ocean Bank's 7.2% break-even was confirmed by
hand against the raw fields. `npm run verify:lenses` screenshots both lenses and dumps their rendered
text, because all three data bugs found today survived a clean build and passing unit tests.

**Cold loads.** Both lenses pull nine quarters for every institution the row cap allows, about fifty
seconds. The existing post-deploy warm-cache route was extended with two entries rather than a new
mechanism, and the Action's curl timeout raised to 280s to stay inside the route's 300s
`maxDuration`. Cache windows went from 6 hours to **23**, not 24: the daily cron runs at 05:00 UTC, so
a 6-hour window warmed the cache at one in the morning and let it expire before anyone arrived, and
`unstable_cache` does not refresh a still-fresh entry — at exactly 24 the cron would find it valid,
return early, and leave it to lapse in front of a user. Only `National` is warmed, because that is
the only scope either lens is mounted with.

**State.** Three commits on `dev`: `94a663c`, `be75853`, `bfded4f`. `npm run build` is clean and every
scoring suite passes. Both lenses were checked in a browser, not only built.

**Still open.** The national coverage gap is unchanged and now affects the workbench too: the FDIC
row cap means both lenses see the largest ~1,113 institutions, so an underwriter cannot look up a
small local bank. Both cards say so on their face; the real fix is pagination. The workbench is
mounted at `National` only and has no scope selector — adding one means adding those scopes to the
warm list or quietly restoring the cold load. `analyseInstitution` runs over the whole universe per
selection, which is fine at 1,113 and would not be at 4,400. And `lib/scoring/quarter.ts` now holds
quarter arithmetic that predates it in three other files; they were not migrated.

---

## 2026-08-24 — five more columns were reading the wrong FDIC field

Three data defects were found earlier today by hand, each in a column nobody had reason to doubt. The
obvious question was how many others were like that, so every derived column in
`transformFinancialData` was audited against the live FDIC API. **Five were wrong.**

**The method, because it is the part worth reusing.** Recomputing a metric from the same parts the
app already uses and comparing the two confirms the app's own assumption rather than testing it — an
earlier verification script did exactly that and validated the CRE double-count it was written to
catch. Every check here instead reconciles a column against a total FDIC publishes independently:
`NCLNLS == P9LNLS + NALNLS` proves NCLNLS holds dollars; `LNREDOM == LNRE` proves LNREDOM is not the
residential figure; `ROA == NETINC * 4 / ASSET5 * 100` proves ROA is already in percent units. A wrong
assumption about what a field *means* shows up as a mismatch, which is exactly what recomputation
cannot do.

**What was wrong, worst first.**

1. **ROA, ROE and NIM went through `normalizePercent`**, whose second branch multiplied anything at
   or below 1 on the assumption it was a decimal fraction. A bank earning under one percent on assets
   is the ordinary case, not an edge case: **1,441 of 4,352 institutions, a third of the industry,
   were shown a hundred times too high** — NBH Bank's 1.00% ROA as 99.98%. The same function's other
   branch divided the 9 institutions with ROE above 100% and the 1 with ROA above 100%. This is the
   same helper whose capital-ratio misuse was fixed earlier today; the fix then was to route capital
   ratios around it. It should have been to delete it, which is what happened now.
2. **`noncurrent_to_assets_ratio` read `NCLNLS` as percent points.** It is dollars — equal to
   `P9LNLS + NALNLS` exactly on all 4,352 institutions, with JPMorgan Chase reporting 12,861,000,
   meaning $12.9bn. Dividing by 100 and clamping to 100% rendered **3,398 institutions — 78% of the
   industry, and every large bank — as exactly 100.00% noncurrent**, against a median true figure of
   0.435%. A column reading 100.00% on most of the table is the kind of thing that should be caught
   by looking, and was not.
3. **`residentialLoans` read `LNREDOM`**, which is every real estate loan in domestic offices and
   equals `LNRE` on 4,335 of 4,352 institutions. The industry residential book was overstated 2.09x.
   The 1-4 family field is `LNRERES`.
4. **`totalEquityDollars` read `EQCAP`**, which this endpoint does not serve. It was undefined on
   every institution, so CRE / Equity silently fell back to Tier 1 capital and nothing looked broken.
   Now `EQTOT`, which equals `ASSET - LIAB` on all 4,352.
5. **Reserve coverage and the NPL ratio were struck against net loans.** FDIC uses gross for its own
   versions — `LNATRES / LNLSGR` reproduces its published `LNATRESR` exactly — and net loans are gross
   minus the allowance, so reserve coverage had the allowance inside its own denominator, up to
   2.80pp too high. The NPL ratio was overstated on 3,555 institutions, by more than 0.10pp on 57.

**What was checked and found correct**, so it does not need doing again: CRE loans and concentration,
the construction / multifamily / owner-occupied splits, unused commitments (`UCCOMRE` is a subset of
`UCLN` on every institution), total and gross loans, nonaccrual dollars, both past-due buckets
(`P3ASSET` and `P9ASSET` are dollar amounts and are correctly measured against assets),
`noncurrent_to_loans_ratio`, loans-to-deposits, the efficiency ratio, net income, and the four
regulatory capital ratios.

**One defect was found and deliberately not fixed here.** `LNREOTH` is closed-end 1-4 family
residential — `LNRERES - LNRELOC = LNREOTH` exactly on all 4,352 institutions — but it is displayed
as an "other CRE" slice divided by `creLoans` in `lib/analytics-chart-data.ts`,
`components/market-analytics.tsx` and `components/institution-profile-drawer.tsx`. It is not CRE and
is not in that denominator, so the CRE mix chart carries a slice that does not belong to it. The
transformer and the glossary now say plainly what the field is; the display fix belongs in files a
concurrent worker was editing and was left alone rather than risk a conflict.

**State.** Committed as `30bb802` on `dev`. `npm run build` is clean and every suite passes except
`test:allowlist`, which fails on `main` too: `lib/domain-allowlist.ts` imports `./entity-sources`
without a `.ts` extension, which the strip-types loader cannot resolve. Verified end to end by
running the real transformer over all 4,352 institutions: median ROA 1.19%, ROE 11.20%, NIM 3.54%,
CET1 11.77%, reserve coverage 1.18%, loans-to-deposits 79% — all where industry knowledge says they
should be — and industry totals of $26.4tn assets against $2.64tn equity, matching FDIC's published
aggregates. Nothing is pinned at 100% any more and equity is present on 4,335 of 4,352 rows.

**Still open.** The "other CRE" display defect above. `creConcentration` is CRE over *net* loans
while every loan-quality ratio now uses gross; the inconsistency is about 1% relative and was left
alone rather than silently shift a number the whole tool reads, but the two should agree eventually.
`test:allowlist` has been red for longer than this session and nobody owns it. And
`npm run audit:fdic-columns` is not wired into CI, so it only runs when someone remembers.

---

## 2026-08-24 — the brief became clickable, and admitted what it was hiding

Asked that an executive be able to click an institution in "what moved this quarter" and see its
statistics. The entries are now buttons that switch to the Market Analytics tab and open the profile
drawer already built there.

**Why the handoff rather than a second drawer.** The drawer's peer-positioning percentiles are
cohort-relative, so a drawer rendered inside the brief would need its own cohort, and the moment
there are two cohorts the same institution reads at two different percentiles. Handing the CERT to
the tab keeps the statistics and the cohort computed in exactly one place. The dashboard routes
`focusCert` down and the tab resolves it once its data has loaded, so clicking while the tab is
still fetching works rather than silently doing nothing.

**Wiring it up exposed a defect in the brief.** The first institution clicked could not be opened,
and the reason was not the plumbing: the brief reported each institution's most recent movement
regardless of *when* it happened. American Bank National Association's last call report was Q4 2025,
so its construction-to-capital crossing was real but a quarter old — and it was listed under a
heading reading "Q1 2026". 102 of the 1,215 institutions were in that position. Institutions that
did not file for the latest quarter are now excluded, and the count is stated in the header instead
of being folded in silently, because "nothing moved" and "we did not look" read identically to an
executive.

Fixing the labelling fixed the handoff as a side effect: the brief and the screening tab now agree
on the same 1,113 institutions, verified by matching counts in the running app.

**State.** Committed as `bb78bd8` on `dev`. Verified end to end in a browser — clicking the first
entry opens the drawer showing CRE/Capital of 3.34x for American Bank of Commerce, matching the 334%
the brief itself claims. The brief cache key moved to `executive-brief-v3`; the old entry would have
served the mislabelled list for six hours otherwise.

**Still open.** The row cap still bounds the brief to the largest ~1,100 institutions, so a smaller
bank that moved is invisible; the header says so, and Phase 1's cached data layer is where that gets
fixed rather than papered over. An institution that stops filing is arguably itself a signal, and it
is now dropped rather than surfaced — a "no longer reporting" section would be the honest place for
it. The column audit called for below was done in the session above.

---

## 2026-08-24 — CRE was overstated across the whole tool

Asked whether the Executive Brief was showing accurate data, so ten of its claims were checked
against the FDIC API by hand. Eight matched to the decimal — every noncurrent-loan figure and every
construction-to-capital figure. The two that did not were both CRE-to-capital, and chasing them found
the largest data defect the tool has had.

**Two compounding errors in what counts as CRE.** The numerator summed construction, multifamily,
non-residential *and* `LNREOTH`. That last field reads like a separate category and is not: FDIC's
`LNRE` total equals construction + multifamily + non-residential + 1-4 family + farmland exactly on
4,335 of 4,352 institutions, so adding `LNREOTH` counted the same loans twice. Separately, the
non-residential figure used was `LNRENRES`, which includes owner-occupied property that the 2006
guidance explicitly excludes — a business borrowing against its own premises is not a concentration
exposure.

**The scale of it.** Share of institutions above the 300% supervisory screen in 2026Q1: **63.5% as
shipped, 29.0% once the double-count is removed, 9.6% correct.** The 63.5% figure is what should have
given it away, and is worth remembering as a smell test — a screen designed to isolate concentrated
outliers cannot be flagging two-thirds of the banking system. The double-count alone put 1,498
institutions above the screen that were not close to it; Napoleon State Bank read 344% against a true
113%. On the brief itself, United Texas Bank (really 240%) and Capital Community Bank (really 283%)
were both presented as having crossed 300%.

This reached everything downstream: the Opportunity Score, the stress map, the screening table and
the export all consume `creLoans`.

**The definition now lives in `lib/fdic-cre.ts`**, a module with no imports so it can be tested
directly, with five tests including a regression fixture built from United Texas Bank's real figures.
`lib/fdic-config.ts` now requests `LNRENROW` and `LNRENROT`, and carries a comment warning against
adding `LNREOTH` back. The three live-data verification scripts were updated to the same definition,
and the `def-term` entries users can click now state what is included and why `LNREOTH` is not.

**Why this took a browser to find.** The build passed, the unit tests passed, and the live-data
verification script passed — because the script reimplemented CRE the same wrong way the app did.
That is the lesson worth carrying: a verification that shares an assumption with the thing it checks
confirms the assumption rather than testing it. Reconciling against a *published total* from the
source, as opposed to recomputing from parts, is what actually caught it.

**Still open.** Nothing else was audited against FDIC by hand. Noncurrent, construction and reserve
figures all reconciled exactly, but the remaining derived columns have not had the same treatment,
and the same "field that sounds additive" trap could exist elsewhere. Worth a systematic pass:
for each composite metric, check that the published FDIC total reconciles without the components
being added.

---

## 2026-08-24 — the Executive Brief

First of the four lenses in `docs/NEXT_VERSION_PLAN.md`, committed as `1162934` on `dev`. This is the
first session where Phase 1 becomes visible: the change engine built last session had no view, and
now it has one.

**What it is.** A card above the tabs, shown when the department selector is set to Executive,
listing at most six supervisory crossings, six watch-level crossings and six deteriorating
institutions. It replaces nothing — every tab remains exactly where it was, and an executive who
wants the screening table scrolls past. That constraint was deliberate: the request was to build on
what exists, not to take anything away.

There is no table in it, and that is the point. The screening table already answers "show me the
cohort" well. It answers "what needs me this quarter" badly, because that question wants six rows,
not eleven hundred.

**Ranking was the part worth thinking about.** The obvious approach — rank by the size of the
quarterly movement — turned out to be wrong, and live data is what showed it. An institution whose
noncurrent ratio goes from 0.00% to 4.33% posts an infinite relative move and would top the list
every quarter, but a metric leaping off a zero base is nearly always a reporting artifact rather than
news. Crossings therefore rank by how far *past* the threshold the institution landed, which is both
unitless and meaningful: 31% past the 300% CRE screen is a bigger finding than grazing it by 2%.
Trajectories rank by run length, since a longer adverse run is the stronger signal.

Those comparators live in `lib/scoring/institution-change.ts`, not in the server action, specifically
so `scripts/verify-executive-brief.mjs` exercises the shipped code. A verification script that tests
a copy of the logic verifies nothing.

**The national coverage gap is now stated on the card's face.** Nationally the brief sees ~1,138
institutions rather than all ~4,400, because nine quarters per institution exhausts the 10,000-row
FDIC cap. Rather than let "304 of 1,138 institutions" imply national coverage, the card says it
covers the largest institutions and that a smaller one that moved will not appear. This is the same
gap already labelled on the national screening tab; it is honest, not fixed.

**Deleted `app/actions/watchlist.ts`**, flagged as a landmine last session. Nothing imported it, but
it would have overwritten the curated 45-firm reference file with a flat array of strings, destroying
the aliases and categories. The live loader is `app/lib/watchlist.ts` and is read-only.

### Looking at it on screen found a real bug in a core metric

Worth recording as an argument for actually rendering things: the brief was correct in build output,
correct in unit tests, and correct against live data in the verification script. Opening it in a
browser showed **"MIZUHO BANK USA — capital ratio fell below the 8% adequately-capitalised floor, at
1.14% from 31.39%"**, which is not a plausible thing for a functioning bank to do.

It was not the brief's bug. `normalizePercent` in `lib/format/metrics.ts` treats any percentage above
100 as basis points and divides by 100. That is reasonable for ROA and NIM, and **wrong for
regulatory capital ratios**, which routinely exceed 100% at trust and wholesale banks whose
risk-weighted assets are tiny relative to capital. Mizuho's real CET1 is 113.99%.

This was not confined to one bank or to the brief. In 2026Q1, **66 of 4,352 institutions** report
CET1 above 100%, and every one was rendered at roughly a hundredth of its true value throughout
Market Analytics — JPMorgan Chase Bank Dearborn at 506.72% displayed as 5.07%. The failure inverts
meaning rather than blurring it: the best-capitalised institutions in the country appeared to be the
worst, and any screen on a capital floor selected precisely the wrong banks.

Capital ratios now use `normalizeCapitalRatioPercent`, which trusts FDIC's percent units. It also
refuses to scale values at or below 1 upward, which `normalizePercent` does — that direction is the
more dangerous one, since it would render a genuinely failing bank at 0.85% as a comfortable 85%.
ROA, NIM and ROE are untouched. Four tests pin the behaviour, including the JPMorgan figure.

A second, smaller artifact came from my own code: `toObservation` fell back to the leverage ratio
when CET1 was absent for a quarter, which silently compares two different measures across a series
and manufactures a swing. It now uses CET1 only, and treats an exact zero in capital or reserve
coverage as "not reported" rather than as fact.

**Verification.** 30 unit tests pass across the three suites, including new coverage for the capital
ratio normalisation, the ranking, and sentence agreement. `npm run build` is clean.
`npm run verify:executive-brief` gives 304 of 1,138 institutions moving (26.7%) across 365 events.
The brief was confirmed on screen after the fixes, with the false Mizuho alert gone.

**Still open.**

- **Cold load is about 50 seconds.** Cached it is under a second, and the cache lasts six hours, but
  the first viewer in each window waits on a skeleton. The existing post-deploy warm-cache action
  could prime it; it does not yet.
- The FDIC row cap still wants pagination rather than labelling.
- Three lenses remain: Underwriter Workbench, Origination Targeting, Exposure & Reporting.
- Worth checking whether anything else screens on capital ratios in a way the old normalisation
  distorted — the export path and any capital-based filter are the places to look.

Note `executive-brief-v2` is a six-hour cache key. **Bump it when change-detection thresholds, the
ranking or the observation mapping move**, or the brief keeps reporting events under the old rules
until the window expires. Locally, clearing `.next/cache` is not enough — the dev server also holds
it in memory and needs a restart.

---

## 2026-08-24 — a department, and a memory of what changed

Phase 1 of `docs/NEXT_VERSION_PLAN.md`, committed as `703bed6` on `dev`. Two capabilities the tool
has never had. **Neither is surfaced in a view yet** — that is Phase 2, and someone reading this
expecting visible change will not find any beyond the department selector in the header.

**Department, not user identity.** There are no accounts, only a shared password, so a department is
all the tool can know and all it needs to know. The cookie is deliberately *not* httpOnly and is read
server-side in `app/page.tsx`, which had to become `async`; that is what makes the first paint
correct rather than flashing the wrong view and swapping it. `parseDepartment` returns null for an
unrecognised value rather than defaulting to one, because "not chosen" is a real state. Anything
stored against a department is shared by everyone in it, which was agreed as intended.

**The change engine is the more substantial half.** The tool only ever showed the current quarter, so
it could say an institution *is* stressed but not that it is *becoming* stressed — while already
fetching nine quarters per institution to draw the sparklines and throwing the history away. It now
separates **crossings**, where a level meaning something outside this tool has been passed, from
**trajectories**, where nothing has been crossed but a metric has moved the wrong way for several
consecutive quarters. The second is the early-warning half and is what the original brief meant by
"potential opportunities".

Thresholds are labelled by origin rather than presented as uniform: only the 300% CRE-to-capital and
100% construction figures are supervisory, from the 2006 interagency guidance. The rest are working
conventions and the code says so.

**Calibrating against live data changed the design.** A first pass produced findings like
"construction to capital has risen for 3 consecutive quarters, from 2% to 3%" and "noncurrent has
risen from 0.00% to 0.08%" — true and worthless. A relative-movement filter cannot help when a metric
starts near zero. Trajectories now also require an absolute materiality level: a floor for rising
metrics, a ceiling for falling ones, since a reserve slipping from 2.44% to 2.08% is still amply
reserved. That cut Florida from 30.8% of institutions to 22%, and every remaining sample was a real
signal. Texas gives 4.1% supervisory crossings and 19.1% trajectories.

**One planning assumption was wrong.** `data/watchlist.json` is not an empty user watchlist to
migrate to Postgres — it is curated reference data: 45 named distressed-credit firms with aliases and
categories, used to match news and counterparties. It belongs in the repository as a file. Tracking
FDIC institutions by CERT is a different concept, and that is what the new `department_watchlist`
table holds.

**State now.** Builds clean. Nine unit tests cover the change engine, plus the seven on scoring.
`scripts/verify-change-detection.mjs [STATE]` recalibrates against a live cohort and should be run
after touching any threshold.

**Still open.**

- **`app/actions/watchlist.ts` is a landmine.** It is orphaned, but if anything ever called it, it
  would overwrite the curated 45-firm reference file with a flat array of strings and destroy the
  aliases and categories. It should be deleted; nothing imports it.
- **Crossings only compare the two most recent quarters**, so a threshold crossed two quarters ago is
  reported as a trajectory rather than a crossing. That is the correct semantic given there is no
  per-user "last seen" — with department-level identity, "since last quarter" is the only well-defined
  answer — but it is a real limitation to remember.
- `department_watchlist` has no UI yet, and no environment currently has `POSTGRES_URL` on `dev`, so
  it degrades to `ok: false` there by design and has not been exercised against a real database.
- The national cohort gap from Phase 0 is unchanged and still belongs to the cached data layer.
- Phases 2 and 3 untouched.

## 2026-08-24 (earlier) — the Opportunity Score now actually ranks

Start of a larger piece of work. The brief was to make the tool useful to four groups —
underwriting, investor relations / business development, accounting / finance, and senior executives
— additively, without removing anything. That plan is written up in `docs/NEXT_VERSION_PLAN.md`;
this session delivered Phase 0 of it, which is entirely foundational and adds no new screens.

**Why foundations first.** Three of the four planned surfaces exist to rank opportunity, and the
ranking did not work. Nationally, exactly one institution out of 1,215 scored 70 or above and 55% of
the cohort sat inside a single 10-point band. `metricRange` normalised each input against the
cohort's raw minimum and maximum, so one extreme institution stretched the scale and flattened
everyone else. Building an opportunities view on that would have produced a ranked list that wasn't
ranked.

Percentile rank replaces min-max. It is immune to outliers and spreads the cohort by construction.
The same national cohort now puts 108 institutions above 70, widens the IQR from 8.1 to 20.8 points
and cuts the most crowded band to 25%. Weights are untouched — they were never the problem.
Verified on live FDIC data for both Florida and national scope via
`scripts/verify-score-distribution.mjs`, which was kept for reuse.

**Consolidating three copies of the scoring logic exposed a real bug.** The map's capital input is
CRE-to-capital, where a higher multiple means more stress, but it had inherited the screening table's
inversion, which is correct only for CET1. Colouring the map by CRE/Capital was therefore showing the
*least* concentrated banks as the most stressed, and "top banks" listed the safest ones. The same
function also rebuilt the entire cohort's earnings ranges once per bank, making it quadratic; that is
hoisted out.

**Two further defects surfaced while measuring rather than reading.** Net Income YoY could never be
calculated: it compares quarters 4–7 against 0–3, but the 18-month query window returns only five
quarters, so the field was permanently null and its 20% weight in the Earnings Resilience Score
silently redistributed. The window is now 27 months, giving nine. Separately, the live tab passed
literal zeros for all three scores, so the institution drawer displayed zeros; it now scores from the
shared module.

**State now.** Committed as `1a21230` on `dev`. Build passes; seven unit tests cover the scorer,
including the outlier case that caused the original compression. The only TypeScript error in the
touched files is the pre-existing `ScreeningRow` / `InstitutionProfileRow` mismatch on the compare
handler, which predates this work.

**Still open.**

- **The tab and the export rank against different cohorts.** Measured against the live API: the tab's
  capped page covers the largest ~1,100 institutions nationally, all above roughly $1.07bn in assets,
  while the export covers all ~4,450. Community banks below $1bn — the CRE-concentrated cohort the
  tool exists to find — are invisible on the national screen. This matters more now that scores are
  relative, because a national score means "percentile among banks over $1bn". Full pagination is not
  a fix by itself: ~40k rows takes about 20 seconds and exceeds the 2MB data-cache ceiling. Deferred
  by agreement to Phase 1, which builds the cached data layer; for now the table states its cohort
  rather than implying a complete screen.
- `buildReportData` is cached, but a national payload may exceed the 2MB entry limit, in which case
  Next skips the write. Not yet measured which scopes actually land.
- Phases 1 through 3 of `docs/NEXT_VERSION_PLAN.md` are untouched. Identity is settled as a
  department selector rather than user accounts, with watchlists shared within a department.
- A `phase0-wip` stash remains from a `git stash pop` that hit a conflict on the binary SQLite WAL.
  Its contents are fully present in the working tree and now committed, so it is redundant and can be
  dropped.

## 2026-08-24 (later) — five stale documents removed

Writing the README surfaced ten top-level markdown files, most unmaintained. Five were deleted after
checking each one for content not captured elsewhere, rather than on age alone.

**Why they had to go: they were not merely stale, they were wrong.** Both
`APP_TABS_AND_DATA_SOURCES.md` and `TOOL_OVERVIEW_SIMPLE.md` described **Perplexity** as the outlook
engine — two migrations out of date — and documented a Competitor Analysis tab and a header region
selector that no longer exist. `TOOL_OVERVIEW_SIMPLE.md` even carried a verbatim LLM prompt that no
longer resembles the pipeline. `DEPLOYMENT_CHECKLIST.md` listed `LEGISCAN_API_KEY` as required, which
no code reads, while omitting `APP_PASSWORD` and `COOKIE_SECRET` — following it would produce a
deployment nobody can log into. A wrong document is worse than none, because it is trusted.

`CBRE_FILTERS_REPORT.md` was a session artifact, complete with commentary about which tools were
unavailable that day, and had already drifted from the code it documented: it recorded the property
type value as `industrial` where `lib/cbre-options.ts` defines `industrial-and-logistics`. The dialog
it describes is reachable only from `market-research-reports.tsx`, itself orphaned.

**One file was not stale and its content was migrated first.** `NEWS_ACCESS_STATUS.md` documented the
paywall classification in `app/actions/news-access.ts` — live code, imported by five actions, with
its documented constants (`ACCESS_TEXT_MIN_CHARS` 1200, `ACCESS_TEXT_TINY_CHARS` 200) unchanged.
`confluence.md` mentioned "access tier" only in passing. It now has a "Paywall classification"
subsection under §3 covering the three status values, the heuristics, the tuning constants and the
explicit no-bypass, no-credentials policy, which is worth stating deliberately rather than losing.
The `.next` cache-corruption tip from `APP_TABS_AND_DATA_SOURCES.md` moved to the README's
maintenance notes.

`EXEC_SUMMARY_WITH_KEYWORDS.md` was **kept**. It records the keyword criteria behind the news
searches, which is a business decision rather than an implementation detail, and it was not part of
the removal request. It is a snapshot, so the README notes that `app/actions/` wins if the two
disagree. It is a candidate for folding into `confluence.md` later.

Nothing referenced the deleted files except the three maintained documents, all of which were
updated. Git history retains them.

---

## 2026-08-24 — a README, and a fourth maintained document

The repository had no root `README.md`. Someone cloning it met ten top-level markdown files, most of
them unmaintained, with no entry point saying what the tool is or how to run it.

`README.md` now covers what the tool is and does, the stack, external connectivity, local setup,
repository layout, the development workflow, and maintenance notes. It is deliberately **orientation,
not a second technical reference** — depth stays in `confluence.md` and the README links to it, so
the two cannot drift into disagreeing.

The connectivity section is the part worth keeping accurate. It lists every external service with its
auth model and its failure behaviour, which makes visible something that is otherwise folklore: most
of the data sources are keyless — FDIC, FRED, GDELT, Google News RSS, OpenFreeMap — which is why the
tool runs on a preview deployment with almost no configuration. Only `APP_PASSWORD` and
`COOKIE_SECRET` are needed for a working local instance, plus `OPENAI_API_KEY` for AI features.

Writing it surfaced five unmaintained top-level documents, which were then deleted — see the entry
below.

`.cursor/rules/session-docs.mdc` was updated from three files to four, with a question attached to
each so the four do not collapse into the same summary repeated: README asks *what is this and how do
I work on it*, confluence *how does it behave now*, SESSION *what changed and why*, ROLLBACK *what do
I go back to*. The rule notes that most sessions should not need to touch the README. The CRLF trap
and `data/README-aom-import.md` were added to the branch-discipline section, since both cost time
this week.

Every path cited in the README was checked to exist, and the claims were taken from `confluence.md`
rather than written from memory.

### Still open

Unchanged from the entry below — the Opportunity Score's poor discrimination, the tab-versus-export
divergence, zeroed live-tab scores, the 30-column table, and the missing cache on `buildReportData`.
Nothing has shipped to production; `main` is still at `e8bf8ad` and still serves the wrong Reserve
Coverage.

---

## 2026-08-23 (later) — two wrong numbers corrected

A question about what else could be optimised. Reviewing the tool for that turned up the two data
faults recorded on 2026-08-21 as still open; both were fixed and verified rather than catalogued
again. The tool had been showing a materially wrong number in a prominent place.

### Reserve Coverage was the loans-to-deposits ratio

`LNLSDEPR` was requested as "Loan Loss Reserve / Total Loans" and rendered as **Reserve Coverage**.
It is the **net loans-to-deposits ratio**. Re-verified against the live API before touching anything:
for JPMorgan, Bank of America and Citibank the field matched `LNLSNET / DEP` to the decimal place,
while true reserve coverage (`LNATRES / LNLSNET`) was 1.72%, 1.10% and 2.47%.

The tool was therefore telling a reader that the average institution held an **82.4%** cushion
against loan losses when the real figure is **1.3%** — off by a factor of roughly thirty and, worse,
carrying the opposite meaning. It appeared in the Cohort Summary KPI, the screening table, the
institution drawer, the map tooltip, the PDF report and its appendix, and it was quoted into the
AI-written narrative.

- `lib/fdic-config.ts` now requests `LNATRES`; the `LNLSDEPR` comment is corrected.
- `loanLossReserve` in `lib/fdic-data-transformer.ts` is now `LNATRES / LNLSNET`. The field name
  always described the right thing — the source was wrong — so every display site became correct
  without being touched.
- `loansToDeposits` is new, carrying `LNLSDEPR` under its real name, surfaced in the institution
  drawer so a legitimate liquidity metric was not simply deleted.
- `lib/noncurrent-debug.ts` computed the same ratio from the same wrong field and is corrected too;
  the drawer prefers that snapshot over the row, so leaving it would have reintroduced the bug in the
  one place built to audit it.

**The score did not need retuning.** `metricRange` normalises against the cohort's own min and max,
so a ~30× change of scale is absorbed automatically, and `invert` stays correct because a thin
allowance still means more distress. Every consumer was checked for hardcoded thresholds; there are
none.

### CRE / (T1+T2) was understated

Capital was inferred as `RBCRWAJ × (0.75 × assets)` with Tier 2 never populated. `RBCT1J + RBCT2`
over `RWAJ` reproduces FDIC's published `RBCRWAJ` to twelve decimal places, so the reported fields
are now used directly and the 0.75 proxy is a fallback only. `CapitalRatios.basis` records which was
used. Tier 2 is tested for presence rather than positivity, since it is legitimately zero at many
small banks and testing `> 0` would have quietly sent them back to the proxy.

### Verified end to end

Against Florida Q1 2026, comparing what the browser rendered with figures computed straight from the
FDIC API:

| Institution | Reserve, shown / FDIC | CRE/(T1+T2), shown / FDIC |
| --- | --- | --- |
| SouthState | 1.2% / 1.19% | 5.19x / 519.0% |
| BankUnited | 0.9% / 0.87% | 4.37x / 437.2% |
| EverBank | 0.8% / 0.82% | 3.31x / 331.0% |
| City NB of Florida | 1.1% / 1.11% | 4.24x / 423.9% |
| Raymond James | — | 3.87x / 386.8% |

Checked on all four surfaces: screening table, Cohort Summary KPI (1.3%), institution drawer
(including Loans / Deposits at 88.1% against FDIC's 88.05%) and the `/report/market-analytics` route
that the PDF renders from. No page errors.

### State

`dev` is at `dcfa28d`; the fix itself is `7286e71`. Nothing has shipped — `main` remains at `e8bf8ad`
and still serves the wrong Reserve Coverage. **`bb5e5f8` must not be merged to `main` without
`7286e71`**, or the visual layer ships the wrong number to production more prominently than before.

### A trap worth knowing about

Four of the edited files (`map-stress-utils.ts`, `cre-deterioration.ts`,
`export-market-analytics-report.ts`, `noncurrent-debug.ts`) are stored with **CRLF** line endings.
Editing them through a Python script in text mode silently rewrote every line, turning a 22-line
change into a 2,000-line diff that buried the actual edit. The endings were restored and folded back
into the commit before pushing, but the repo has mixed endings and there is no `.gitattributes` to
normalise them, so the next session will hit this too. Check `git show --stat` before pushing;
whole-file rewrites in files you barely touched are the tell.

### Still open

- **The Opportunity Score barely discriminates.** For Florida the median is 51.6 with an interquartile
  range of 47.4–56.5 and nothing at all above 80. `metricRange` uses raw min and max, so one outlier
  stretches the scale and compresses everyone else; percentile ranking would separate the cohort far
  better. Worth revisiting now that a corrected input feeds it.
- **The tab and the export still disagree.** The live tab caps at 5,000 rows sorted by assets
  descending while the export paginates the full set, so counts and averages differ for the same
  scope, and small banks — the ones with concentrated CRE — are the ones dropped.
- **Live-tab scores are still hardcoded to zero**, so the drawer shows zeros.
- **The screening table renders up to 30 columns with no frozen first column**, so scrolling right
  loses the institution name.
- **`buildReportData` has no `unstable_cache`**, unlike nearly every other action, which is why
  Visual Analysis takes about eleven seconds on National scope.

---

## 2026-08-23

A request for "a visual component" and a more modern interface. Both were addressed, and pursuing
the second uncovered that the bank stress map had never worked at all.

### The charts existed, but only inside the PDF

**Trigger.** Someone asked for visuals. The tool already had four charts — they were only reachable
by downloading the report.

`components/market-analytics-report-view.tsx` held the histogram, the CRE-to-capital ranking, the
capital sensitivity scatter and the portfolio composition bars as inline Recharts markup, rendered
by the headless Playwright pass that produces the PDF. Nothing on screen used them. The Market
Analytics tab was tables and prose.

- **`components/charts/analytics/`** (new) — the four charts extracted as components, plus
  `use-analytics-chart-data.ts`, with the derivation logic in `lib/analytics-chart-data.ts`. The
  report page and the new on-screen section render the same components, so the two cannot drift.
- **`components/market-analytics-visuals.tsx`** (new) — the "Visual Analysis" section, above the
  screening table, following the selected scope.
- It calls `buildReportData`, the same server action the PDF uses, rather than reading the
  dashboard's `screeningTable`. That table carries zeroed opportunity scores, so charts drawn from
  it would have been quietly wrong. The cost is a few seconds' load, covered by skeletons.
- **`lib/chart-theme.tsx`** (new) — one palette, axis, grid and tooltip definition, applied to the
  four charts, the peer chart in the profile drawer and the Market Research sparklines. Colours are
  literals rather than CSS variables because Recharts writes SVG fills that the PDF renderer cannot
  resolve.
- `singleLineTick` in that file exists because Recharts wraps long category labels by default; on
  the twenty-row ranking the second line collided with the row beneath and the names were
  unreadable.

### Market Pulse strip

`app/actions/fetch-market-pulse.ts` and `components/market-pulse-strip.tsx` add five tiles under the
header — CRE delinquency, CRE charge-offs, the 10-year, the 30-year mortgage and the high-yield
spread — each with a value, a direction and a sparkline, drawn from the same FRED series the News
tab already cites. Verified on a running server: the strip read 1.56%, 0.17%, 4.69%, 6.65% and
2.75%, matching the Key Signals text below it.

### Interface

Tabular numerals across tables and KPI tiles; an elevation scale (`surface-supporting`,
`surface-primary`, `surface-raised`) so panels read as a hierarchy; entrance motion on tab content,
disabled under `prefers-reduced-motion`; skeletons in place of "Loading…" text.

The tab bar was hardcoded to `grid-cols-4` while the number of tabs is driven by `ENABLED_TABS`. In
production, where three are enabled, it rendered an empty fourth cell. It is now derived.

Removed as superseded: `capital-analytics-viz.tsx`, `executive-report-preview.tsx` and the unused
shadcn `components/ui/chart.tsx` scaffold.

### The map had never worked

`app/actions/map-data.ts` filtered FDIC call reports on `REPDTE:"2025-09-30"`. The API only matches
`"20250930"`. The hyphenated form is not rejected — it is accepted and matches nothing, so all three
map endpoints returned empty successful responses and the failure looked like absent data. Confirmed
directly against the API: `20250930` returns 4,452 institutions, `2025-09-30` returns none.

Fixing the format was not enough. The quarter list started at the current quarter, which is never
published — in August 2026 the most recent quarter with data is Q1. The default now walks back
through candidate quarters until one returns rows, which absorbs the varying publication lag; an
explicitly chosen quarter is still honoured exactly, since substituting a different period under
someone who picked one would misattribute the figures.

Three more faults surfaced once data reached the screen:

- **The whole country was painted red.** With high-stress share near zero in almost every state, all
  four quantile cuts landed on the same number and the chain of `<` comparisons fell through to the
  final branch — maximum alarm on the calmest possible data. Cuts that cannot separate anything are
  now dropped, a flat metric resolves to a neutral fill and reports itself as flat, and the default
  colouring is average stress, which actually varies.
- **A missing WebGL context took down the tab.** MapLibre throws synchronously from its constructor,
  and the error propagated out of the effect and unmounted all of Market Analytics. Now guarded,
  with a fallback panel.
- **Handlers accumulated and went stale.** Layer click handlers were registered inside callbacks
  that re-run whenever data or the colour scale changes, so one click eventually fired several
  times. Separately the zoom handler was bound once and captured the first render forever, so after
  changing state, quarter or metric, panning kept refetching the original selection. Handlers are
  now bound once and the viewport is published as state.

Also swapped the basemap. It was MapLibre's demo style: country outlines, no state boundaries, no
place names, which is unusable for a US state map. Now OpenFreeMap Positron — no API key, and
deliberately desaturated so the choropleth carries the colour.

`lib/fdic-client.ts` (new) holds the hardened FDIC fetch — fallback host, API key, timeout, 4xx
short-circuit — that previously sat private inside `app/actions/fetch-fdic-data.ts`. The map used
bare `fetch` and had none of it. Both now share the one implementation.

**Verified on a running server rather than by reading code.** All three endpoints return data
(56 states, 17 Florida metros, 79 banks in a Florida bounding box, all at Q1 2026). A scripted
browser pass through the real UI confirmed the pulse strip values, eight chart surfaces on the
Market Analytics tab, no console errors, and the map drawing a genuine choropleth with a real
quantile legend.

The map is behind the `bank-stress-map` flag, so it is live on the dev preview and off in
production until someone has used it there.

Commit: `bb5e5f8`, on `dev` and not yet merged.

**Open.** The map has only been exercised through a scripted browser and software WebGL; it wants a
real look on the preview, particularly the metro and bank drill-downs, before `bank-stress-map` is
added to production's `ENABLED_TABS`. Visual Analysis takes a few seconds to appear on the National
scope because `buildReportData` re-fetches the full FDIC set per scope change; caching it is the
obvious next step if that proves annoying.

---

## 2026-08-21

One change, plus the decision to finally ship the dev-environment work that had been sitting on
`dev` since 2026-08-18.

### Stay signed in (shipped to production)

**Trigger.** Users were being asked for the password again roughly once a week.

**Cause.** `/api/auth` issued the `auth_token` cookie with a seven-day `maxAge` and nothing ever
renewed it. Regular daily use made no difference: the clock started at login and ran out on
schedule. Nobody had noticed it was a fixed expiry rather than an idle timeout.

What was done:

- **`lib/auth.ts`** (new) — the single definition of the cookie name, its options and its lifetime.
  Previously `middleware.ts` and `app/api/auth/route.ts` each hardcoded the name and the flags, so
  changing one without the other was a silent way to break the gate.
- **One-year lifetime** (`AUTH_COOKIE_MAX_AGE`). Not longer, because browsers clamp persistent
  cookies to 400 days and would truncate anything past that without telling anyone.
- **Sliding expiry** — the middleware re-issues the cookie on every authenticated page view, so the
  expiry keeps moving forward and someone who opens the tool at least once a year is never asked
  again. API responses are deliberately excluded so ordinary data fetches carry no `Set-Cookie`.
- **`/login` while signed in** now redirects into the app instead of presenting the form again.
- **`?from=` is validated** through `safeRedirectPath()` in both the middleware and the login page.
  It previously accepted `//evil.com`, which the URL parser reads as an absolute address, so a
  crafted login link could have bounced someone off-site immediately after they authenticated. Not
  known to have been exploited; found while touching the redirect.

**Verified against a local dev server**, not just by reading the code: login issued a cookie
expiring Aug 2027; a page view twelve seconds later moved the expiry forward by exactly twelve
seconds, which is the sliding renewal working; a wrong password still returned 401 with no cookie;
an API call returned no `Set-Cookie`; `/login` with a valid cookie redirected to `/`;
`?from=//evil.com` redirected to `/` rather than off-site; and Log out still cleared the cookie and
sent the browser back to the login screen.

**Existing sessions were not disrupted.** Anyone still holding a seven-day cookie has it silently
upgraded to the one-year one on their next page view.

Commit: `74807d8`.

### Merging `dev` into production

Shipping the above meant shipping the five commits that had accumulated on `dev`: the isolated dev
environment, the database-less degradation fix, and the documentation set.

This was checked rather than assumed. Every one of those changes is keyed on
`isProductionDeployment()`, which returns true on production, so all of them are no-ops there:
`lib/features.ts` still reads `ENABLED_TABS`, `search-industry-reports.ts` still insists on a
database, and `assertSafeToMutateProductionData()` returns immediately on the first line without
blocking a legitimate delete. The only behavioural change reaching users is the auth cookie.

### Market Analytics investigation — no code changes

The afternoon was spent understanding the Market Analytics tab before touching it, ahead of scoping
work for the client (Safe Harbor Capital Partners, a private credit manager buying distressed CRE
debt). A full audit of the tab was run, and its riskiest claims were then checked against the **live
FDIC API** rather than accepted. That verification is the valuable part of this session, because it
overturned two of the audit's conclusions and confirmed a real bug.

**`LNLSDEPR` is not what the app thinks it is — a client-facing number is wrong.** It is labelled
`Loan Loss Reserve / Total Loans` in `lib/fdic-config.ts` (L60), transformed into `loanLossReserve`,
and displayed as **Reserve Coverage** in the screening table and **Avg Reserve Coverage** in the
Cohort Summary. For Seacoast National (CERT 131, Q1 2026) it returns `74.98932`, which matches
`LNLSNET / DEP` to four decimals: it is the **net loans-to-deposits ratio**. Actual reserve coverage
is `LNATRES / LNLSNET` = **1.41%**, so the tab overstates it by roughly 53×. The two metrics also
mean close to opposite things — high reserve coverage is a well-provisioned bank, high
loans-to-deposits is a loan-heavy illiquid one — and the export's Opportunity Score weights this
field at 15% *inverted*, so that score is contaminated and arguably sign-flipped. `LNATRES` is
available from the API and is not currently requested.

**The `CRE / (T1+T2)` column understates concentration.** `lib/fdic-ratio-helpers.ts` derives capital
from `RBCRWAJ × (0.75 × assets)`, using a constant `RWA_TO_ASSETS_PROXY` in place of real
risk-weighted assets, and never populates Tier 2 at all (L85). For Seacoast the proxy overstates RWA
by 12.4%, which overstates capital, which understates the ratio: **394.1% displayed versus 443.0%
actual**. The error runs in the worst direction for this client, since it under-flags exactly the
concentrated banks they are hunting. The real fields exist and reconcile exactly —
`(RBCT1J + RBCT2) / RWAJ` reproduces FDIC's published `RBCRWAJ` of 15.1242%.

**Two audit findings were disproved, both in our favour.** The `P3ASSET`/`P9ASSET` past-due columns
are computed **correctly**; `P3ASSET` returns 28,187 against 21.1B in assets, so it is plainly a
dollar amount in thousands and the transformer's treatment is right — only the config comment is
wrong. And the hardcoded CoStar Miami figures are **not displayed anywhere**, so nobody is
underwriting off stale numbers (see the correction to `confluence.md`).

Also confirmed: `opportunityScore`, `earningsScore` and `vulnerabilityScore` are hardcoded to `0` in
the live tab (`market-analytics.tsx` L427–429) while the full scoring logic exists in the export
path, so the institution drawer displays zeros. The live cohort is 5,000 rows sorted by assets
descending, which biases it hard toward the largest banks — wrong for a client that buys from Florida
community banks. And there is **no LTV anywhere**, which is not fixable here: FDIC call reports carry
no loan-level or collateral data, so LTV needs an external source (CoStar/Reonomy/Trepp are paid;
Miami-Dade county records are public) or has to stay a post-screen diligence step.

**Nothing was committed and no code was written.** Four options were put to the user for where to
start; the decision was deferred to Monday 2026-08-24.

### Current status

- **Production** — `main` at `e8bf8ad`. Users stay signed in for a year of continuous use.
- **Dev** — `dev` at `e8bf8ad`, level with `main` for the first time since 2026-08-17.
- **Market Analytics work is scoped but not started.** No branch, no commits.

### Open items

Carried forward from the previous session, all still open:

- **`Needs Attention` flags** on several Postgres environment variables in Vercel, never
  investigated. May affect the live research library. Still the highest-value loose end.
- **The dev URL used for verification is build-specific** and changes every push; the stable branch
  alias is still unrecorded.
- **`.env.local` still holds the production `BLOB_READ_WRITE_TOKEN`**, so local development writes
  to the production Blob store.
- **Pre-existing uncommitted changes**, deliberately left alone: `data/competitor_surveillance.sqlite*`,
  `data/README-aom-import.md`, `scripts/import_aom_to_sqlite.py`, `.claude/`, `.DS_Store`.
- **Phase two is unscoped.**
- The four items surfaced by the codebase inventory (see the previous entry) remain unaddressed.

New this session:

- **Reserve Coverage shows the wrong metric in production**, verified against the live API. This is
  the highest-priority fix in Market Analytics: it is client-facing, wrong by ~53×, and misleading in
  direction. Fix is `LNATRES / LNLSNET` with `LNATRES` added to the requested fields.
- **`CRE / (T1+T2)` understates concentration** because capital is derived from a `0.75 × assets`
  proxy. Fix is to request `RBCT1J`, `RBCT2` and `RWAJ` and use them directly.
- **Live-tab scores are hardcoded to 0** while the export computes them. Fix after the two above,
  since the score consumes the broken reserve field.
- **The live cohort is large-bank biased** (5,000 rows sorted by assets), so Florida community banks
  are largely absent from the default view.
- **The 100%/300% supervisory CRE test is not implemented.** Both ratio prongs are computable from
  fields already available; the 50%-growth prong needs the FDIC date window widened past its current
  18 months. Note the guidance excludes owner-occupied CRE, which the app's CRE sum includes, so
  today's figure is a close proxy rather than the regulatory ratio.
- **No LTV, and none obtainable from FDIC.** Needs an external data source or a documented decision
  to treat it as post-screen diligence.
- **`EQCAP` is requested but returns nothing**, so `CRE / Equity` silently falls back to Tier 1
  capital rather than equity.
- **`COOKIE_SECRET` is now the only lever that signs everyone out**, and doing so is silent — there
  is no notice to users and no staged rollout. Rotate it only deliberately.
- **The password is still shared and compared with `!==`**, so it is neither per-user nor
  constant-time. A year-long session raises the value of a leaked cookie, though the cookie is
  `httpOnly`, `secure` and `sameSite=lax`. Per-user accounts remain the real fix if the audience
  ever grows beyond a trusted group.

---

## 2026-08-17 → 2026-08-18

Two distinct pieces of work: fixing fabricated statistics in the live tool (shipped to production),
then building an isolated dev environment so future work stops happening directly on production.

### Part 1 — Key Signals accuracy (shipped to production)

**Trigger.** The tool was serving invented statistics. The reported example: *"In Florida,
foreclosure filings have increased by 18% year-over-year, with Miami-Dade County averaging 180–220
new lis pendens filings per week in Q1 2026."* No such figure existed in any source.

Root cause was structural, not a one-off. The model was asked for data-rich prose with no mechanism
requiring the numbers to come from anywhere, so it supplied plausible ones.

What was done, in the order it was done:

1. **Prompt hardening** — forbade unsourced figures, required attribution, injected today's date to
   stop stale quarter references. Insufficient on its own; the model still produced figures.
2. **Programmatic evidence guard** (`lib/memo-evidence.ts`) — deletes any bullet carrying a numeric
   claim without a recognized publisher attribution. Enforcement rather than instruction.
3. **Source denylist** — content farms (`real-estate-tycoon.org`, `noticeregistry.com` and similar)
   excluded from retrieval, not merely from citation.
4. **Verified metrics pipeline** (`lib/verified-metrics.ts`,
   `app/services/industry-outlook/verifiedMetrics.ts`) — real measured figures injected into the
   prompt as ground truth the model may quote verbatim. Sources: FRED's public CSV endpoint and the
   FDIC API, both of which work **without an API key**, which is why no new credential was needed.
   Covers CRE delinquency, net charge-offs, CRE loan balances, the 10-year Treasury, the 30-year
   mortgage rate, high-yield spreads, and the Florida bank cohort's CRE exposure.
5. **Data floor** (`ensureKeySignalFigures`) — guarantees at least three figure-bearing bullets in
   the Executive Summary, backfilled from verified metrics when the model underdelivers. This
   required relaxing an earlier rule that had banned *all* figures from the summary; that rule was
   accurate but left the section saying nothing.
6. **Feed headline recovery** — a double-escaped CDATA regex was silently discarding titles, which
   surfaced as rows of "Untitled" from Bloomberg and others. Fixed across all `fetch-*` actions and
   in `retrieveSources.ts`, where it had also been discarding article snippets before they reached
   the prompt. Named HTML entities are now decoded too.
7. **UI removals** at user request — the region dropdown (national/Florida/metro), the admin token
   field, and the Send News Email button. News feeds now merge all three regions instead of being
   filtered to one.

**Verified in production** via the post-deploy warm-cache run: Key Signals went from **zero**
figure-bearing bullets to **five**, `droppedUnsourced: 0`, `droppedDenied: 0`, total memo bullets
22 → 30.

Commits: `984a361`, `cf9e8a2`, `dc31c78`, `586f52f`, `4b09072`, `25b6dfb`, `2191ff3`, `eabf088`.

### Part 2 — Isolated dev environment (on `dev`, not yet merged)

**Trigger.** Production is in active use, so phase-two work needed somewhere to run that cannot
damage it.

The naive approach — a branch that deploys as a Vercel preview — would have been actively dangerous
here, for a reason worth remembering: **Vercel sets `NODE_ENV=production` on preview builds**, and
every environment check in this codebase read `NODE_ENV`. A preview was therefore
indistinguishable from production. Two concrete consequences, both real rather than theoretical:

- `lib/features.ts` would have shown **zero tabs**, since `ENABLED_TABS` is unset in Preview and the
  fallback returns false for everything.
- The delete routes would have run against production data believing they were production.

And separately, Vercel copies environment variables into Preview by default, so the preview was in
fact wired to the production Postgres and Blob store.

What was built:

- **`lib/environment.ts`** — reads `VERCEL_ENV`, and separates two questions the codebase had
  conflated: *which deployment is this* versus *is its data the real data*. The second cannot be
  inferred, so it is declared via `DATA_ENVIRONMENT` and defaults to "production" to fail closed.
- **Guards on the two irreversible routes** — `delete-report` and `delete-test-reports` refuse and
  return 403 when a non-production deployment is wired to production data. Their admin token was no
  protection, since Preview inherits it by the same default that shared the database.
- **`lib/features.ts`** — keyed on deployment, so previews enable every tab. This is also the
  mechanism for developing a tab before exposing it in production.
- **Database-less degradation** — `search-industry-reports.ts` and `summarize-found-report.ts`
  hard-refused with *"Database is required in production"* when no database was configured and
  `NODE_ENV` was production, which is exactly the dev environment's situation. They now run against
  Google and OpenAI and skip persistence instead.
- **9 unit tests** (`lib/environment.test.ts`, `npm run test:environment`).
- **`docs/DEV_ENVIRONMENT.md`** — setup and day-to-day workflow.

**Vercel configuration completed** (dashboard work, not in code): the Neon Postgres connection and
the Blob store connection were both changed from all environments to **Production only** — done
through *Storage → Projects → Update Project Connection*, because integration-managed variables have
no per-variable Edit option. `DATA_ENVIRONMENT=isolated` added to Preview.

**Verified from outside** against the redeployed preview:

```json
{"vercelEnv":"preview","nodeEnv":"production",
 "hasBlobReadWriteToken":false,"blobTokenMasked":null}
```

`vercelEnv: preview` sitting next to `nodeEnv: production` is the trap that was defused, and no Blob
token means there is no path from dev to production files.

Commits: `255828f`, `27a00b8`, `908d083`.

### Also done

**Deleted the `claude/angry-mirzakhani` branch** (tip `a7cb784`, 2026-04-02) after review. It was
not unfinished work; it had been superseded. Its own description was "Private Creditor Monitor with
lender spider graph and tooltip headers", and all three had since landed or been reversed on `main`:
the monitor was rewritten (349 lines today versus its 412), tooltips arrived in `dd12787`, and the
spider graph was **deliberately removed** in `2530466`. Merging it would have reinstated a chart
that had been dropped on purpose and reverted the Competitor AOM section to a four-month-old
version. It was 63 commits stale and conflicted in five files.

### Current status

- **Production** — `main` at `eabf088`, serving at https://market-intelligence-tool-gilt.vercel.app.
  Unaffected by all Part 2 work; nothing from `dev` has been merged.
- **Dev** — `dev` at `908d083`, deploying as a Vercel preview with no database and no Blob store.
  Isolation verified. Behind Vercel's own login wall (Deployment Protection is on), so it is not
  publicly reachable.
- Branches are now just `main` and `dev`.

### Open items

- **`Needs Attention` flags** on several Postgres environment variables in Vercel were noticed and
  never investigated. These may affect the **live** research library, not just dev. Highest-value
  loose end.
- **The dev URL used for verification is build-specific** (`…-1n4xmsdov.vercel.app`) and changes
  every push. The stable branch alias has not been recorded here yet.
- **`.env.local` still holds the production `BLOB_READ_WRITE_TOKEN`**, so local development writes
  to the production Blob store. Unchanged from before this session, but now the only remaining path
  from a dev context to production data.
- **Pre-existing uncommitted changes** in the working tree, deliberately left alone:
  `data/competitor_surveillance.sqlite*`, `data/README-aom-import.md`,
  `scripts/import_aom_to_sqlite.py`, `.claude/`, `.DS_Store`.
- **Phase two is unscoped.** No decision yet on what to build first.

### Surfaced by the codebase inventory, not yet acted on

A full architecture inventory was run to write `confluence.md`. It turned up four things worth
scheduling, none of them urgent:

- **`CRON_SECRET` gates the cron routes only when it is set.** If it were ever unset in Vercel, both
  warm endpoints would be publicly callable. Worth confirming it is present in Production.
- **Hardcoded figures presented as current data** — `fetch-market-research.ts` carries static Miami
  office/industrial metrics labelled "2025 YTD" and a hardcoded `CENSUS_YEAR = 2022`. The same class
  of problem as the fabricated Key Signals figures, just stale rather than invented.
- **Substantial orphaned UI** — the participants-intel components, `national-view`, `florida-view`,
  `miami-view`, `market-research-library`, `market-research-reports` and `competitor-analysis` are not
  mounted anywhere. Notably this means the Blob upload library has no live UI.
- **The daily cron warms caches for those orphaned features** (KPI, insights, price index,
  transaction volume), spending OpenAI and FRED calls every morning on views nobody can reach.
