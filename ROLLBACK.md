# Rollback Reference

Every commit that has reached production or `dev`, with the procedures for reverting. Update at the
end of every session, alongside `README.md`, `SESSION.md` and `confluence.md`.

## Current state

| Branch | Commit | Environment | URL |
| --- | --- | --- | --- |
| `main` | `f72fbb4` | Production | https://market-intelligence-tool-gilt.vercel.app |
| `dev` | `24b2947` | Preview (no database, no Blob) | build-specific `…vercel.app` preview URL |

This table names the newest commit on each branch that **changes behaviour**; documentation-only
commits sit on top of it and are deliberately not tracked here, because amending one rotates its
SHA and the table then reads as stale when nothing has moved. Confirm with
`git log --format='%h|%ci|%s'` rather than trusting the previous entry — this has drifted twice.

**`dev` is three behavioural commits ahead of `main` as of 2026-10-06: `7aab24f`**, which keeps
failed and merged banks out of the Market Analytics charts and exports and reads each bank's
headline-quarter filing rather than its largest-asset one, **`45d2934`**, the Cohort Changes
card (deteriorating institutions, exits with FDIC structure records, capital categories in the
drawer), **and `24b2947`**, the eight-quarter trend panels at the top of the institution drawer.
None is in production. Before them,
**`main` and `dev` were level at `7f24131` as of 14:35 on 2026-10-05.** Production fast-forwarded
`4d1cf60` → `7f24131`, taking `0aaf1b2` (the load-timing diagnostic route) and `f72fbb4` (the News
tab's data rendered into the page on the server). `4d1cf60` / `b2b08e9` is the production state
before them and the rollback target if the page misbehaves. Before that, **`main` and `dev` were
level at `2425d4c` as of 13:20.** The afternoon's five
behavioural commits went to production in one fast-forward (`75959a2` → `2425d4c`): `a01d2a5`,
which admits the OCC's and FDIC's monthly enforcement roundups as single items and rewords the
Legislative Tracker header; `da82d42`, which gives Federal Register cards their record facts and a
summary of the rule's own text; `a313d11`, which does the same for Florida bills (record from
`getBill`, staff analysis as the text) and reads the enforcement roundup pages instead of recalling
them; `671a877`, which tells the Legislative Tracker to say when the Florida session has ended
and what each dead bill's record signals; and `b2b08e9`, which gives federal bill cards their
record, text, report and CRS summary from GPO bulk data. They are a set and revert cleanly in
reverse order; `a36ff81` (the Node 24 pin) is the last production state before them and builds.
Earlier the same day, `main` fast-forwarded from `9faaf35` to `4ca86dc`,
taking everything from 09-29 to 10-05 in one release: the per-section windows and the always-rendered
sections, the computed exposure counts, the removal of the department model and of the two lens
tabs, the matched peer cohort in the institution drawer, then the week's Legal Landscape work — the
relevance gate, the bill-identity guard, federal bills from govtrack, Florida bills from LegiScan,
rulemaking from the Federal Register, bill status tracking — and the Node 24 pin without which none
of it could have been deployed.

The newest commit changing application behaviour is **`b2b08e9`**, on both branches. The previous
production state was `9faaf35`, and it is **no longer a clean rollback target**: it carries the
Node 20 pin and Vercel will refuse to build it. See the `a36ff81` row below.

Two things in this release are seeing a database for the first time in production.
`bill_status_history` creates itself on first use and reports nothing on first sighting, so the
Legislative Tracker will show no movement on day one by design; movement appears once a tracked
bill's status changes between runs. If it never appears, check `POSTGRES_URL` before suspecting the
logic. And the first Legal Landscape load after the deploy is slow on purpose — it pays govtrack's
cold start once — and then cached for the day.

This table had drifted before this session: it named `8844bea` as production when `main` was
actually at `996efa9`, and listed three commits as dev-only that had already shipped. Verify with
`git merge-base --is-ancestor <sha> main` rather than trusting the previous entry.

A SHA here can never name the commit that writes it, so the true head is usually one documentation
commit further on. Only behavioural commits matter as rollback targets; the newest that changes
application behaviour is **`7b4e2b9`**, which keeps visited tab panels mounted.

**`e8bf8ad` is the last production build with the wrong numbers.** Rolling back past `7d74797`
restores CRE concentration that double-counts `LNREOTH` and includes owner-occupied property, and
capital ratios that divide anything above 100% by 100. Prefer rolling forward with a fix over
reverting to it; if you must revert for an unrelated reason, know that the displayed ratios go wrong
again with it.

Rolling back does **not** expose the department lenses. They are gated on `department-lenses` in
`ENABLED_TABS`, which no production build has ever had set, so their visibility is a Vercel setting
and not a property of any commit here.

Production deploys automatically on every push to `main`. `dev` deploys as a Vercel preview on every
push. Crons run only against production, and the post-deploy warm-cache GitHub Action triggers only
on `main`.

## How to roll back production

Vercel keeps every previous build, so the fastest route does not involve git at all.

**Option 1 — instant, via Vercel (preferred for an outage).** Vercel dashboard → **Deployments** →
find the last known-good Production row → `...` → **Promote to Production** (or **Rollback**). Takes
effect in seconds and needs no rebuild. Note that this does **not** change git, so `main` still holds
the bad commit and the next push will redeploy it. Follow up with option 2 or 3.

**Option 2 — revert the commit (preferred for a real fix).** Keeps history honest and auditable:

```bash
git checkout main
git revert <bad-sha>          # or: git revert --no-commit <oldest>..<newest>
git push origin main
```

**Option 3 — reset to a known-good commit.** Discards history; only when a revert is impractical:

```bash
git checkout main
git reset --hard <good-sha>
git push --force-with-lease origin main
```

Force-pushing `main` is destructive and rewrites shared history. Prefer option 2.

**After any rollback**, warm the caches, because a rolled-back deployment starts cold and the
generated content is cached per day:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://market-intelligence-tool-gilt.vercel.app/api/cron/warm-cache"
```

If the rollback crosses a cache-key version bump (see `confluence.md`), stale content may persist
until the key changes again or the window expires.

## How to roll back dev

Nothing on `dev` affects users, so just move the branch:

```bash
git checkout dev
git reset --hard <good-sha>
git push --force-with-lease origin dev
```

## Known-good checkpoints

| Commit | Date | Why it is a safe target |
| --- | --- | --- |
| `b2b08e9` | 2026-10-05 | Last production state before the News tab's data was rendered into the page (`f72fbb4`). Builds on Node 24. Revert `f72fbb4` alone in preference to rolling back here; it is self-contained. |
| `8ef34d3` | 2026-09-30 | First `dev` commit at which the Legal Landscape tab cannot render a bill that is not the bill it names. Everything before this can. |
| `e45845f` | 2026-09-30 | Last `dev` commit before the drawer's percentiles changed meaning. The only reason to come back here is reconciling a figure someone exported under the scope-wide comparison. |
| `f40b8df` | 2026-09-30 | Last `dev` commit with the two views reachable, as tabs. Only useful if you intend to restore them as tabs, which has been rejected; prefer surfacing the analysis inside the institution drawer. |
| `6789d45` | 2026-09-29 | Last `dev` commit **with** the department model, if the removal needs undoing without losing the Legal Landscape exposure counts. Reverting `f40b8df` is preferable to rolling back here, since the two are independent. |
| `a36ff81` | 2026-10-05 | **Current production.** The first commit Vercel will build at all, Node 20 having been retired; everything below it in this table needs `a36ff81` cherry-picked on top before it can be deployed again. |
| `9faaf35` | 2026-09-29 | Production from 09-29 to 10-05. The Legal Landscape source-verification guard, before the per-section windows and the always-rendered sections. **Will not build as-is** — carries the Node 20 pin. If the 10-05 legal work turns out badly, roll back here *with* `a36ff81` cherry-picked, and the tab stays truthful but goes quiet out of session. |
| `e5414c3` | 2026-09-29 | Newest behavioural commit. The Legal Landscape feed deduped, freshness-filtered, date-aware and source-verified; nothing outside that tab is touched, so it is a safe target for unrelated work. |
| `8625c7c` | 2026-09-29 | **Known-bad: publishes fabricated legislation and enforcement actions.** Dates are current but citations are invented — consent orders against banks that do not exist. Do not roll back to this point; go to `e5414c3`. |
| `10fd202` | 2026-09-29 | **Known-bad: renders an empty Legal Landscape tab.** The staleness filter without the prompt fix, so every item the model returns is withheld. Do not roll back to this point; go to `8625c7c` or past `2384143`. |
| `996efa9` | 2026-09-10 | All Market Analytics performance work plus tab persistence, with no figure changes anywhere in that range. **Known-bad for the Legal Landscape tab**: this is the build that renders an interagency rule once per issuing agency and serves a 2019 rule under a 90-day heading, reported by a user on 09-29. Prefer rolling forward to `10fd202`. |
| `d3f7973` | 2026-08-28 | Newest behavioural commit, and the head of both branches' behaviour as of 09-08. Drops the Accounting & Finance department; see the `dev` table below. |
| `4a4f3de` | 2026-08-25 | Prior behavioural commit, in production since 09-08. Makes `buildSearchQuery` fail closed, so both layers of the publisher allowlist now refuse an unrecognised entity id independently. Safe to roll *to*; **rolling back past it is a safety regression rather than a lost feature** — the query builder returns to emitting a bare keyword with no `site:` restriction for any unknown entity id, leaving the result filter as the single layer standing between the tool and the open web. Not reachable from the dropdown in either direction, so no normal user journey differs. A revert has to take the `null` check in `searchIndustryReports` and the four `buildSearchQuery` assertions with it, or the build fails to typecheck. Prefer fixing forward. |
| `397a03e` | 2026-08-24 | Prior behavioural commit on `dev`. Stops reading a reported zero as a capital ratio, and stops drawing 1-4 family residential as a slice of the CRE book. **Opportunity Scores and their ranking change at this commit and are correct afterwards** — 30 of the top-100 most-distressed institutions were Community Bank Leverage Ratio filers scored as though they held no capital, and the median institution moves 120 rank places. Rolling back past it returns 1,765 of 4,352 institutions to showing 0.00% total risk-based capital, indistinguishable from a failed bank, and returns the CRE Portfolio Composition chart to stacked bands summing to a median 255% on a 0–100 axis. Prefer fixing forward. CRE-to-capital, the stress map and the workbench are untouched either way; they read reported capital dollars rather than the ratios. Note the four capital ratios became `number \| null` here, so a rollback also reverts a type change several files depend on. Run `npm run audit:fdic-columns` after any change in this area. |
| `bfded4f` | 2026-08-24 | Warms both department lenses from the post-deploy `warm-cache` route and lengthens their cache windows from 6 hours to 23. Purely a latency change — no figure moves — so it is safe in both directions. If you roll back past it, expect the first person to select a department after a deploy to wait about fifty seconds, and note that the GitHub Action's curl timeout reverts to 120s, which is shorter than the route now takes. |
| `be75853` | 2026-08-24 | Adds the Underwriter Workbench lens. Renders only when the department selector is set to Underwriting and replaces no existing view, so rolling it back removes a card and changes nothing else — no shared metric, cohort or export is touched. Worth knowing before reinstating any earlier version of it: the CRE downside scenario measures leverage filers against the **4% PCA adequately-capitalised** level, not the 9% CBLR trigger. An earlier iteration used 9% and made every community-bank-leverage filer appear to have the thinnest capital cushion in the state, which was an artifact of comparing an election trigger to a capital floor. Run `npm run verify:workbench` after any change here; it fails on a mismatch against FDIC's published `RBCRWAJ` and `RBC1AAJ`. |
| `94a663c` | 2026-08-24 | Adds a "no longer reporting" section to the Executive Brief, listing the institutions it already excluded from the movement sections and previously only counted — 102 of 1,215 nationally. Additive within a card that only Executive sees; rolling back returns those institutions to being a number in the header. No movement figure changes. |
| `30bb802` | 2026-08-24 | Corrects five Market Analytics columns. Corrects five Market Analytics columns that were reading the wrong FDIC field or the wrong units. **Most of the screening table changes at this commit and is correct afterwards**, so rolling back past it restores numbers that are wrong by two orders of magnitude in places: ROA, ROE and NIM revert to being shown a hundred times too high on 1,441 of 4,352 institutions; Noncurrent / Assets reverts to reading exactly 100.00% on 3,398 of them; the residential loan figure reverts to 2.09x its true value; CRE / Equity reverts to silently using Tier 1 capital; and reserve coverage and the NPL ratio revert to a net-loan denominator. Prefer fixing forward. Run `npm run audit:fdic-columns` after any change in this area — it fails the process on a mismatch against FDIC's published totals. |
| `bb78bd8` | 2026-08-24 | Prior behavioural commit. Makes Executive Brief entries open the institution profile drawer, and stops the brief listing institutions that did not file for the quarter it is headed with — 102 of 1,215 nationally, whose movements were real but a quarter old. **The brief's contents change at this commit**: it now covers the same 1,113 institutions as the screening tab. Rolling back past it restores crossings dated forward a quarter, so prefer fixing forward. Bumps the brief cache key to `executive-brief-v3`; a rollback should bump it again or the corrected list will be served under the old rules. |
| `dcc064e` | 2026-08-24 | Corrects what counts as CRE: drops the `LNREOTH` double-count and excludes owner-occupied property, taking the share of institutions above the 300% supervisory screen from 63.5% to 9.6%. **Every CRE concentration figure, Opportunity Score, map colour and export value changes at this commit and is correct afterwards.** Rolling back past it restores a headline metric that is wrong by a wide margin, so prefer fixing forward. |
| `36dd5c1` | 2026-08-24 | Stops rescaling regulatory capital ratios above 100%, which had been rendering 66 of 4,352 institutions at roughly a hundredth of their true capital. **Rolling back past this restores a wrong number in the main screening table**, not merely a missing feature: the best-capitalised banks appear critically undercapitalised. Capital figures change for those 66 institutions at this commit and are correct afterwards. |
| `1162934` | 2026-08-24 | Adds the Executive Brief, which renders only when the department selector is set to Executive and replaces no existing view — so rolling it back removes a card and changes nothing else. Also deletes the orphaned `app/actions/watchlist.ts`; **if you roll back past this, delete that file again rather than leaving it callable**, since it would overwrite the curated `data/watchlist.json`. Not visually confirmed in a browser: build, unit tests and live-data output all pass, so any defect should be layout-only. |
| `703bed6` | 2026-08-24 | Adds the department selector, the department watchlist table and the change-detection engine. Low risk to roll back: the only user-visible addition is the header selector, and nothing else yet reads what it produces. Creates `department_watchlist` on first use, which a rollback leaves behind harmlessly. |
| `1a21230` | 2026-08-24 | Newest behavioural commit on `dev`. Opportunity Score ranks by percentile rather than min-max, verified on live FDIC data for Florida and national scope; fixes the map's inverted CRE/Capital colouring and the permanently-null Net Income YoY. **Every score changes at this commit** — rolling back past it restores rankings where 55% of the national cohort sits in one 10-point band. |
| `7286e71` | 2026-08-23 | Last commit before the scoring rework, so scores here are the compressed min-max ones. Reserve Coverage and CRE/(T1+T2) verified figure-by-figure against the live FDIC API. Prefer this over `bb5e5f8`, which renders a Reserve Coverage roughly 30x too large. |
| `bb5e5f8` | 2026-08-23 | Builds clean; charts, pulse strip and map verified against a running server. Roll back to `016d162` to remove the visual layer entirely. **Serves a wrong Reserve Coverage** — avoid unless isolating the visual layer. |
| `e8bf8ad` | 2026-08-21 | Production from 08-21 to 09-08. Documentation only on top of `74807d8`, so identical in behaviour. **The last production build with the wrong CRE and capital figures** — see "Current state". |
| `74807d8` | 2026-08-21 | Last behavioural commit. Sessions last a year and renew on use. |
| `eabf088` | 2026-08-17 | Last commit before the isolated dev environment and the year-long session reached production. Roll back here to restore the seven-day login expiry. |
| `2191ff3` | 2026-08-17 | Last commit before the verified-metrics pipeline. Key Signals carried **no** figures but nothing fabricated. |
| `cf9e8a2` | 2026-08-17 | Before the fabricated-statistics work began. Known to serve invented figures — avoid unless isolating that work. |
| `33c3615` | 2026-07-07 | End of the OpenAI migration, stable for ~6 weeks. Predates all UI removals. |
| `37e1b8e` | 2026-05-18 | Post-deploy cache warming introduced. Pre-Claude, pre-OpenAI (Perplexity era). |

## Recovering the deleted branch

`claude/angry-mirzakhani` was deleted this session. Its tip was:

```
a7cb78424eaaed6d9e6e9129a682a493698fdb91   2026-04-02   Add Private Creditor Monitor with lender spider graph and tooltip headers.
```

GitHub keeps unreachable commits for a period, so `git fetch origin a7cb784` may still retrieve it.
It was deleted as superseded, not as a mistake — see `SESSION.md` for why merging it would regress
the Market Participants tab.

---

## Dev branch commits

Everything in this table from `a36ff81` down reached production on 2026-10-05 in the fast-forward
to `4ca86dc`. It is kept as the record of what each commit does and what reverting it costs.

| Commit | Date | Summary |
| --- | --- | --- |
| `24b2947` | 10-06 | **On `dev` only.** Eight-Quarter Trend block at the top of the institution drawer: verdict line (Deteriorating / Watch / Stable from the Cohort Changes detector), five line panels with supervisory thresholds as reference lines, PCA capital-category strip. One FDIC call per CERT on open, cached `institution-trend-v1` + CERT + quarter. Exports `toInput` from `app/services/cohort-watch.ts` with ROA/NIM/nonaccrual added. **Revertable in isolation** — a new block, a new action, a new lib; nothing existing changes meaning. |
| `45d2934` | 10-06 | **On `dev` only.** Cohort Changes card between the Cohort Summary and the charts: Deteriorating (capital-category downgrades at PCA thresholds, threshold crossings, multi-quarter trends; rows open the drawer) and Exits (who stopped filing and why, from FDIC `/failures`, `/history` and `/institutions`). Drawer gains Capital Category and Corporate History. Screening row gains `capitalCategory` (key → `market-analytics-screening-v2`); FDIC client parenthesises array filters; rounding-artefact crossings suppressed in `institution-change.ts`; warm cron warms the watch. **Revertable in isolation** — a new card and two drawer blocks; reverting restores the previous tab exactly, though the screening key stays bumped. |
| `7aab24f` | 10-06 | **On `dev` only.** The report cohort (Visual Analysis charts, ZIP/PDF exports, analyst narrative) keeps an institution only if it filed for the headline quarter and represents it by that filing (`lib/analytics/headline-filing.ts`), the rule the screening table already applied. Removes failed and absorbed banks — Community B&T West Georgia, failed 1 May 2026, had led the CRE-to-Capital ranking at 710% on its final Q1 filing — and fixes a `Date.parse(YYYYMMDD)` → `NaN` sort that represented shrinking banks by their largest-asset quarter (Touchmark National 467.7% → 386.8%). Also feeds the KPI averages. Cache keys `market-analytics-report-data-v3`, `market-analytics-visuals-v2`. **Safe to revert in isolation**; reverting restores the stale cohort, nothing else. |
| `f72fbb4` | 10-05 | In production since 10-05 14:35. The page reads the pulse strip, Industry Outlook and six news feeds from the caches on the server (`app/services/initial-news-data.ts`, 2.5 s budget per read, abandoned reads kept alive with `after()`) and the News components take them as initial state, skipping their mount fetch. Cold caches fall back to the old client fetch. **Safe to revert in isolation**: every prop is optional and absent ones restore the previous behaviour exactly. If the page itself becomes slow, suspect this first and check `/api/cron/measure-load`. |
| `0aaf1b2` | 10-05 | In production since 10-05 14:35. Adds `/api/cron/measure-load`, a diagnostic that times each dashboard action twice and reports payload size. Behind the cron bearer; not scheduled; no effect on any page. |
| `b2b08e9` | 10-05 | In production since 10-05 13:20. Federal bill cards list the record (sponsor, cosponsors, committees, how each chamber passed it, last action, identical bill, report, text, CRS summary) from GPO's keyless bulk data in `lib/legal-updates-govinfo.ts`, and the model summarises the CRS summary, committee report and bill text into `details`, labelled with what was read (`LegalItem.detailsSource`, which also relabels Florida and roundup details). Removes the govtrack-only prompt from `lib/legal-updates-legislation.ts`. Cache key `v14`. Revert cost: federal cards back to four facts and no details; Florida and roundup details labelled "From the rule text" again. `npm run test:legal-govinfo`. |
| `671a877` | 10-05 | In production since 10-05 13:20. Between Florida sessions, when every Florida bill on the Legislative Tracker is dead, a line above the cards says the session has ended, none has effect, and filing for next year opens in the autumn (`sectionContext.legislative`); a "Possible intent" block below the cards gives one record-derived sentence per dead bill on how far it got (`LegalItem.intent`, from `describeIntent`). Both self-clear once a live bill appears. Cache key `v13`. **Safe to revert in isolation**: the fields are optional and absent ones render nothing. `npm run test:legal-florida`. |
| `a313d11` | 10-05 | In production since 10-05 13:20. Florida bill cards list the record (primary sponsors, filed, companion, last roll call, latest text, latest staff analysis) and the model summarises the staff analysis — a PDF read with `pdf-parse` through `lib/legal-updates-pdf.ts` — into `details`. Enforcement roundup pages are fetched after verification and the model reports what they list, one bullet per institutional action. Cache key `v12`. Revert cost: Florida cards back to a one-line description; roundup summaries back to the model's recollection of the page. |
| `da82d42` | 10-05 | In production since 10-05 13:20. Federal Register cards list the record's own facts (action, citation, CFR parts, docket, RIN, pages, correction, PDF) and the model summarises the rule's explanatory text — selected by section, capped at 6,000 words — into a summary and up to five `details`, instead of paraphrasing the abstract. Corrections (`C1-…`) yield to the document they correct. Cache key `v11`. Revert cost: thinner cards; the escrow rule goes back to rendering under its correction's date. |
| `a01d2a5` | 10-05 | In production since 10-05 13:20. Admits a regulator's monthly enforcement roundup ("OCC Enforcement Actions for July 2026") as one item, bypassing the topic and individual-action gates that had dropped every one of them; tells the Enforcement prompt to report roundups whole and name no individual; cache key `v10`. Also rewords the Legislative Tracker header from "with active movement" to "this session". Revert cost: the Enforcement section loses everything from the OCC and FDIC again. |
| `a36ff81` | 10-05 | Pins Node **24.x** in `engines`; Vercel has retired 20 and refused to build `fe1cee1`. **Do not revert past this** — any commit with the `20.x` pin will fail to build on Vercel, which also means `main` as it stands today cannot be redeployed from a fresh build. If production must be rolled back to a pre-10-05 commit, cherry-pick this one onto it first. |
| `a91bfe1` | 09-30 | **One relevance gate** — a heading read on every term, a body only on the core ones — replacing the two-gate arrangement `05b51f3` introduced a few hours earlier, after the model path admitted a stablecoin proposal on "capital requirements" in its body. Also restricts Federal Register rulemaking to the financial regulators (OCC, FDIC, Fed, CFPB, FHFA, HUD, Treasury, NCUA), which is what removed a Farm Credit Administration rule. **Reverting readmits both** and nothing else; safe in isolation. `npm run test:legal-relevance`, `npm run verify:legal-freshness`. |
| `c22b06a` | 09-30 | Three rendering fixes in the record-sourced items: the model's `summaries` wrapper is optional on the way back (its absence had every Florida bill rendering as raw description with no "why it matters"), LegiScan HTML entities are decoded, and a deduped Federal Register rule inherits the abstract from whichever copy has one. **Safe to revert in isolation**, at the cost of those three defects reappearing. `npm run test:legal-florida`, `npm run test:legal-fedreg`. |
| `05b51f3` | 09-30 | Takes **Florida bills from LegiScan and federal rulemaking from the Federal Register**, extending the govtrack correction to the last two places the feed asked a model for published facts. Also splits the relevance terms by how selective they are and adds a stricter gate for record-sourced items, because the old gate kept 32 of 1,930 Florida bills. And fixes a live reliability bug: govtrack's first request of the day takes ~28s against a 15s timeout, so the cold start is now paid once before the searches fan out. **Reverting loses real Florida bills and returns that half of the section to model recall**, where the identity guard drops it and the section goes half-empty rather than wrong. Cache key `v8` → `v9`; any revert must bump it again or the Data Cache serves whichever item shape was written last. **`LEGISCAN_API_KEY` is now load-bearing** — it was previously documented as safe to delete, and it is not. `npm run test:legal-florida`, `npm run test:legal-fedreg`, `npm run test:legal-relevance`, `npm run verify:legal-freshness`. |
| `4e92b49` | 09-30 | Adds `content.govdelivery.com` to the **enforcement** host list, where the FDIC publishes its monthly enforcement decisions; it was already listed for regulatory. One line of data, no logic. **Reverting silently reinstates the rejection** — a real FDIC bulletin comes back as `unlisted`, which reads in the logs exactly like a fabricated URL. Nothing verifies this either way: the live run after it happened to cite `occ.gov` and `fdic.gov`, so no GovDelivery item was admitted or rejected. |
| `c248b3d` | 09-30 | Adds `bill_status_history` so the Legislative Tracker reports what **changed** about a bill, not just its current stage. The table auto-creates on first use. **Safe to revert in isolation** — the feed degrades to exactly its previous behaviour, since the movement field is optional and absent movements render nothing. The table can be left in place after a revert; nothing else reads it. Note this is the least verified commit of the day: the comparison logic has tests, but the Postgres path has never run, here or anywhere. If movement never appears in production, check `POSTGRES_URL` is set before suspecting the logic. `npm run test:legal-movement`. |
| `c992ace` | 09-30 | Takes **federal legislation from the congressional record** instead of from the model. `lib/legal-updates-legislation.ts` reads bills from govtrack and the model only writes prose for bills it is handed, so it is never asked for an identity it could invent. Also dedupes companion bills across chambers, and narrows the legislative prompt to Florida only. **Reverting returns the Legislative Tracker to model-recalled bills** — which, with `8ef34d3` still in place, means the guard drops them and the section goes empty rather than wrong. Reverting both together restores the fabricated bills. `npm run test:legal-legislation` and `npm run verify:legal-freshness`. |
| `8ef34d3` | 09-30 | Two Legal Landscape fixes. The relevance gate stops reading `whyItMatters`, a field the prompt tells the model to write about CRE relevance — so items no longer certify themselves; it also drops 1818(e) actions against individuals, anchors every term (bare `lien` matched "client" and "resilience"), and puts residential and land-use policy out of scope. Second and more important, `lib/legal-updates-bills.ts` checks that a cited bill **is the bill claimed**, because `checkSourceUrl` never verified anything on congress.gov: the host 403s everything and the guard reads 403 as "refused us, not absent". **This is the commit that stops fabricated legislation rendering** — do not revert it without reverting `c992ace` too, or the section keeps model-recalled bills with no identity check. Cache key `legal-updates-v7` → `v8`; any revert must bump it again or the Data Cache serves whichever shape was written last. `npm run test:legal-bills`, `npm run test:legal-relevance`. |
| `3bec6d7` | 09-30 | Ranks the institution profile drawer's Peer Positioning percentiles against a **matched peer cohort** instead of the whole selected scope. **This changes numbers users have already quoted**: every institution that can be ranked moves, by 26.6 percentile points on average for banks under $1bn in Texas and up to 86 points. Reverting restores figures dominated by asset size — defensible only if someone is reconciling against an old export, and `verify:peer-cohort` will fail on the reverted code because the percentiles stop moving. Also in here: the ordinal fix (the old code rendered "2th percentile"), and two guards in `lib/scoring/peer-cohort.ts` — a single-state universe can no longer describe its cohort as national, and an institution with absent loan figures is no longer matched on lending mix. `npm run test:peer-cohort`, `npm run verify:peer-cohort` against live FDIC, and `npm run verify:peer-positioning` which reads the rendered drawer in a browser. |
| `e45845f` | 09-30 | Takes the Executive Brief and Underwriter Workbench out of `TAB_DEFS`, so the tab bar is the four it has always been and **no `ENABLED_TABS` value reaches either view**. Reverting restores two tabs that have now been rejected twice — read the Lenses section of `confluence.md` and Phase 2 of `docs/NEXT_VERSION_PLAN.md` before doing so. Nothing was deleted: both components, both server actions and the five `lib/scoring/` calculators remain, with 39 passing tests. Also removed, because they had no caller left, the dashboard's focus-institution routing and the two cron cache warms — a revert must restore the warms or the first visitor after a deploy waits roughly fifty seconds. Safe: production never rendered either view. |
| `f40b8df` | 09-29 | Removes the department model whole: the header dropdown, the cookie, `lib/department.ts`, and `department_watchlist`. Executive Brief and Underwriter Workbench become ordinary tabs behind `executive-brief` and `underwriter-workbench`, gated independently. Storage becomes `institution_watchlist`, keyed on `cert` alone, carrying over any surviving rows; **the old table is not dropped**, so a revert still finds its data. Low risk to revert because nothing live was using it — `department_watchlist` had no writer anywhere in the codebase and `department-lenses` was off in production. **The load-bearing line is `export const dynamic = "force-dynamic"` in `app/page.tsx`.** The page was dynamic only as a side effect of calling `cookies()`; without that declaration it prerenders statically and `ENABLED_TABS` freezes into the build, so editing the variable in Vercel silently does nothing and a build without it ships no tabs at all. If you revert this commit, the `cookies()` call comes back and covers it again — but do not remove the declaration on its own. Adding a tab also means adding its count to `TAB_GRID_COLS`; Tailwind cannot see `grid-cols-${n}`. |
| `6789d45` | 09-29 | Legal Landscape cards carry the institutions a rule actually hits, counted from FDIC call reports. **Read `lib/legal-applicability.ts` before touching any concentration test.** `ScreeningRow.creConcentration` is CRE over total loans and cannot exceed 100; `capitalRatios.creToTier1Tier2` is CRE over Tier 1 + Tier 2 capital, which is what the supervisory thresholds mean. Resolving a 300%-of-capital rule against the first matches nothing on every institution with no error — a confident zero that reads as a rule affecting no one. Safe to revert whole; the cards lose the exposure block and go back to ending at generated prose. **Do not move the join into `fetchLegalUpdates`** — the watchlist would enter a cache key (it was the department before `f40b8df`, it is the shared watchlist now), and the feed's daily cache and screening's quarter-keyed cache expire on different clocks. The Florida universe is a correctness choice, not a scope one: the national payload is capped at 10,000 rows and biased to large banks. `npm run test:legal-applicability` and `npm run verify:legal-applicability`, the latter against live FDIC data. |
| `5e6d9da` | 09-29 | Legal Landscape: per-section freshness windows, a CRE relevance gate, wider host lists, and sections that render even when empty. **This is the commit that makes an empty section visible rather than absent** — all three now always render with an in-place explanation, so a reverted tab will look like it did when the emptied Legislative Tracker simply disappeared and read as a bug. Safe to revert as a whole; the cost is Legislative going blank for the nine months Florida is out of session, because the windows in `lib/legal-updates-sections.ts` are what let it reach back to the last session. **Do not revert the windows alone and leave the prompt's session guidance** — the pair is what produces items between April and December. The relevance gate in `lib/legal-updates-relevance.ts` is the least load-bearing piece and dropped nothing across 24 live items; revert that in isolation if it starts discarding good material. Bump the cache key on any revert; `legal-updates-v7` is current. `npm run test:legal-filter`, `npm run test:legal-relevance`, and `npm run verify:legal-freshness` more than once. |
| `e5414c3` | 09-29 | fix(legal): an item renders only if its URL is a listed primary source in `lib/legal-updates-sources.ts` **and** that URL loads. **Do not revert this and leave the tab live.** Without it the feed publishes invented consent orders against named banks and bill numbers copied from the prompt's own example — actionable-looking fiction for a distressed-debt reader, which is worse than an empty tab. If the sections look thin, widen the host lists or the window; do not remove the check. Keep both halves: link-checking alone admits trade press, host-checking alone admits URLs constructed on the right domain. Keep the domain list in the prompt too — removing it dropped provenance from 100% to 38%. `npm run verify:legal-freshness`, several times. |
| `8625c7c` | 09-29 | fix(legal): the section prompts state today's date and instruct month-named searches, moving to `lib/legal-updates-prompts.ts`. **Do not revert this while `10fd202` stands** — the filter plus the old prompts is the combination that rendered an empty tab, because the model dates "recent" from its training cutoff and returns material from 2006 onward. If the tab needs reverting, revert both or neither. Prompt edits here are unverifiable by reading: run `npm run verify:legal-freshness`, more than once. Bump the cache key on any change. |
| `10fd202` | 09-29 | fix(legal): the Legal Landscape feed withholds items dated more than `MAX_ITEM_AGE_DAYS` (180) in the past, and renames the module to `lib/legal-updates-filter.ts`. **This one can change what a user sees to nothing**: if the model returns no recent developments, a section empties and is not rendered, with a note in its place explaining why. Tune `MAX_ITEM_AGE_DAYS` before reverting — a wider window is almost always the right answer over no filter, since without it the tab serves a 2019 rule under a 90-day heading. Two behaviours a revert or rewrite must preserve: **future dates are kept**, because an effective date or scheduled vote is the point of the tab, unlike the news feeds which reject them; and **an unparseable date is kept**, which is why the parser refuses prose rather than letting `Date.parse` pin "Fall 2026" to January. Bump the cache key on any revert. `npm run test:legal-filter`. |
| `2384143` | 09-29 | fix(legal): the Legal Landscape feed dedupes its merged items by normalized title, so an interagency rule stops rendering once per issuing agency. **No item's content changes** — this only removes repeats, so the visible effect is a shorter Regulatory Watch list. Safe to revert in isolation; the cost is the five-copy bug returning. Two things to know if you do. **Reverting must bump `legal-updates-v3` to v4**, or the cache serves whichever shape was written last. And if you keep the dedupe but change the key to the URL, the bug comes straight back: agencies mirror joint rules at their own domains, so the copies are URL-distinct and title-identical. `npm run test:legal-filter` asserts exactly that. Superseded in part by `10fd202`, which renames the module; revert the two together. |

The three commits below shipped to production on 09-09 and 09-10 and are retained here for their
rollback notes; see the production table for the current head.

| Commit | Date | Summary |
| --- | --- | --- |
| `7b4e2b9` | 09-10 | fix(tabs): visited tab panels stay mounted, so tab switches no longer refetch. **No figures change**; this is mount behaviour only. Two coupled pieces — reverting `forceMount` alone is safe, but **leaving `forceMount` while removing `data-[state=inactive]:hidden` renders every visited tab stacked on the others**, because Radix stops setting `hidden` when force-mounted. The `ResizeObserver` in `BankStressHeatMap` is harmless either way and worth keeping: without it a hidden map container collapses to 0x0 and returns blank. `npm run verify:tab-persistence` reproduces all three failure modes in a browser. |
| `8a32b06` | 09-09 | perf(market-analytics): both heavy caches keyed to the published FDIC quarter, timers stretched 23h → 7d. **No displayed figure changes** — this only alters when work is recomputed. Rolling back returns to a daily 31MB re-pagination, which is wasteful but harmless. Note that reverting the `revalidate` value alone will **not** retune cache entries already written: Vercel does not reconcile TTLs between deployments, so existing entries keep their 7-day window until the key changes or the cache is purged. `npm run verify:latest-quarter` confirms the probe underneath. |
| `e2c1a73` | 09-09 | perf(market-analytics): Visual Analysis charts derived server-side and deferred until near the viewport. **No plotted value changes** — `npm run verify:visuals-payload` compares every series against the unrounded builders, 22,087 comparisons nationally. Rolling back restores a panel that paginates 31MB out of FDIC and burns ~21.6s on every mount, because its 5.46MB payload is over the 2MB cache ceiling and Next refuses to store it. The PDF path is untouched either way: it calls the same builders through `useAnalyticsChartData`. If you roll back, drop `visuals:national` and `visuals:florida` from the warm-cache route. |

## Production commits

| Commit | Date | Summary |
| --- | --- | --- |
| `996efa9` | 09-10 | Production head. Documentation on top of `7b4e2b9`, so identical in behaviour. |
| `27ef6f1` | 09-08 | Documentation on top of `02e45ae`, so identical in behaviour. |
| `02e45ae` | 09-08 | perf(market-analytics): move the screening reduction and scoring to the server and cache it. **No displayed figure changes** — `npm run verify:screening-parity` compares every rendered field per institution against the previous browser reduction, 51,510 comparisons nationally, all matching. Rolling back restores a tab that fetches 10.8MB and ~5.8s from FDIC on every single visit, so prefer fixing forward. If you roll back, also drop `screening:national` and `screening:florida` from the warm-cache route or it will warm a cache nothing reads. The cached entry is 1.26MB against a 2MB ceiling; adding fields to the transported row is what would break it, silently, by making Next refuse the write. |
| `41f01b0` | 09-08 | fix(fdic): base URLs now carry the path prefix, so the fallback host resolves instead of 404ing, and the primary no longer pays a 301 on every call. **Behaviour-preserving in the normal case** — the old primary worked, it just redirected. What changes is the failure case: previously a primary outage returned empty data, because `fetchFDICData` short-circuits on 4xx and the fallback 404d. Reverting reinstates that. `npm run verify:fdic-hosts` covers all eight endpoints on both hosts. Note a rollback must take `FDIC_ENDPOINTS` with it: the base and the endpoint prefix changed together and are only correct as a pair. |

**`7d74797` is the last production build before the Market Analytics rewrite.** Roll back there to
restore the tab that fetched 10.8MB and ~5.8s from FDIC on every visit. The displayed figures are
identical either side of `02e45ae`, verified field by field, so this is a performance rollback and
not a correctness one.

## Historical dev branch commits

**All of these shipped to production on 2026-09-08**, when `main` fast-forwarded from `e8bf8ad` to
`7d74797`. The section is kept as written rather than merged into the production table above, because
the per-commit rollback notes are the useful part and they do not change by being deployed. Nothing
currently sits on `dev` ahead of `main`.

The department lenses among these entries are deployed but unreachable: `department-lenses` is not in
production's `ENABLED_TABS`, and `isFeatureEnabled` returns false there for anything unlisted.

| Commit | Date | Summary |
| --- | --- | --- |
| `8e594c4` | 08-28 | docs: amend the plan for three departments rather than four. Documentation only. |
| `d3f7973` | 08-28 | fix: drop the Accounting & Finance department, which had no lens behind it. `DEPARTMENTS` goes from four entries to three. Confined to `lib/department.ts`; nothing else referenced it. Reverting restores a selector option that leads nowhere — a chosen department with no lens renders the dashboard unchanged, so it reads as the tool ignoring the choice. Any `department=finance` cookie written before this commit already reads as no choice. |
| `3417025` | 08-28 | feat: gate the department layer so the lenses can ship without being reachable. Adds the `department-lenses` key; the selector and both lenses render only where it is on, which is everywhere except production. **This is the commit that made merging to `main` safe** — reverting it on `main` exposes two unfinished lenses to production users immediately, with no environment change required. Nothing else depends on it, and the preview is unaffected either way since every feature is on outside production. |
| `56cfbd0` | 08-25 | feat: widen the market pulse tape to nineteen real-estate series. Fourteen new FRED series, four new `SeriesUnit` variants, and `describeChange` exported so the tape and the outlook memo share one unit-to-wording map. **A revert must take `lib/verified-metrics.ts` with it** — reverting only `fetch-market-pulse.ts` leaves specs referencing units the formatter no longer has, and `formatValue`'s switch stops being exhaustive, which is a type error rather than a runtime one. The cache key moved to `market-pulse-v2`; reverting without moving it back serves the nineteen-series payload to five-series code for the rest of the ET day. Nothing outside the strip reads these units, and no FDIC or lens figure is affected. |
| `c135ac2` | 08-25 | feat: run the market pulse as a crawl, at a speed its content cannot change. Presentation only — the same five FRED series, the same figures, the same cache. Reverting restores the five-tile grid and costs nothing but the animation. The parts worth keeping if it is ever rewritten are the two measured values: lap duration from sequence width, so crawl speed does not drift with how many series survived, and copy count from rail width, without which a short strip drags a gap across the screen each lap. The `prefers-reduced-motion` override in `app/globals.css` is load-bearing and must go with it — the blanket reduce rule would otherwise freeze the crawl on its final frame, which looks like an empty strip. |
| `4a4f3de` | 08-25 | fix: make the query builder fail closed, so both halves of the allowlist do. `buildSearchQuery` returns `string \| null` instead of `string`, and `null` where it used to return the bare keyword for an entity with no domains. **Reverting reopens an unrestricted open-web Google search** on any entity id the registry does not recognise, and reintroduces the trap that the result filter is then the only thing keeping the tool inside the allowlist. Unreachable through the dropdown either way, so nothing a user sees changes in normal use. A revert must also drop the `null` check in `searchIndustryReports` and the four `buildSearchQuery` assertions, or the suite fails and the type no longer compiles. Prefer fixing forward. |
| `4011754` | 08-25 | docs: record the curated "all", and the layer that fails closed around it. Documentation only. |
| `da7c023` | 08-25 | test: settle "all" as the curated primary sources, and say so where it is decided. A doc comment and three assertions; no runtime behaviour changes, so reverting changes nothing a user sees. It does restore a comment claiming `"all"` returns every approved domain, which is false, and returns the suite to 10 pass / 3 fail. Revert only alongside a decision to widen `"all"` — the `deepStrictEqual` on the nine primary domains is deliberately the thing that breaks first if someone does. |
| `81a751b` | 08-25 | docs: record a suite that had never run, and the question its failures encode. Documentation only. |
| `01544d8` | 08-25 | fix: run the allowlist suite with a loader that can resolve its imports. Script-only; no application code. Safe to revert, at the cost of returning the suite to aborting before its first assertion — thirteen assertions that report nothing while looking maintained. As of `da7c023` all fourteen pass, so reverting hides real coverage rather than known failures. |
| `fcf79ae` | 08-24 | docs: record the zero-versus-absent trap and the chart that summed to 255% |
| `397a03e` | 08-24 | fix: read absent capital ratios as absent, and stop drawing residential as CRE |
| `bec51b8` | 08-24 | docs: record the workbench lens and the regulatory-level trap it exposed |
| `08b7127` | 08-24 | chore: register the peer-cohort and CRE-downside test suites |
| `bfded4f` | 08-24 | perf: warm the department lens caches after deploy |
| `be75853` | 08-24 | feat: add the Underwriter Workbench lens |
| `94a663c` | 08-24 | feat: list the institutions that stopped filing in the Executive Brief |
| `b210202` | 08-24 | docs: record the column audit and the two habits that found it |
| `30bb802` | 08-24 | fix: correct five Market Analytics columns misread from FDIC fields |
| `c7e0264` | 08-24 | docs: list the clickable-brief docs commit in the rollback reference |
| `22e7a2e` | 08-24 | docs: record the clickable brief and the stale-quarter trap it exposed |
| `bb78bd8` | 08-24 | feat: open the institution profile from the Executive Brief |
| `cd7f258` | 08-24 | docs: list the CRE definition fix in the rollback reference |
| `dcc064e` | 08-24 | fix: correct the CRE definition behind the 300% supervisory screen |
| `bcb2572` | 08-24 | docs: list the capital ratio fix in the rollback reference |
| `36dd5c1` | 08-24 | fix: stop rescaling capital ratios above 100% |
| `6b5e487` | 08-24 | docs: list the Executive Brief docs commit in the rollback reference |
| `5de965e` | 08-24 | docs: record the Executive Brief and the ranking choice behind it |
| `1162934` | 08-24 | feat: add the Executive Brief lens |
| `3a320b2` | 08-24 | docs: list the Phase 1 docs commit in the rollback reference |
| `cfa6995` | 08-24 | docs: record Phase 1 and the calibration that shaped it |
| `703bed6` | 08-24 | feat: give the tool a department and a memory of what changed |
| `706b895` | 08-24 | docs: list the scoring docs commit in the rollback reference |
| `0d6169b` | 08-24 | docs: record the scoring rework and the cohort gap it exposed |
| `1a21230` | 08-24 | fix: rank institutions by percentile so the Opportunity Score discriminates |
| `eb3d684` | 08-24 | docs: list the document cleanup commit in the rollback reference |
| `b87506a` | 08-24 | docs: delete five superseded top-level documents |
| `ac9a4ac` | 08-24 | docs: list the README commit in the rollback reference |
| `2b3cbd6` | 08-24 | docs: add a README and make it the fourth maintained document |
| `75c10ae` | 08-24 | docs: explain the one-commit lag in the current state table |
| `1a5c06a` | 08-24 | docs: list the fragility docs commit in the rollback reference |
| `d439a95` | 08-24 | docs: correct the dev head and record newly verified fragilities |
| `dcfa28d` | 08-23 | docs: list the metric correction docs commit in the rollback reference |
| `c74c8e2` | 08-23 | docs: record the reserve coverage and capital corrections |
| `7286e71` | 08-23 | fix: report the real reserve coverage and capital base |
| `9636101` | 08-23 | docs: list the visual layer docs commit in the rollback reference |
| `58b748d` | 08-23 | docs: record the visual layer and the map faults it uncovered |
| `bb5e5f8` | 08-23 | feat: put the analytics visuals on screen and revive the bank stress map |
| `016d162` | 08-21 | docs: list the dev docs commit in the rollback reference |
| `5bb9074` | 08-21 | docs: record verified Market Analytics data faults and correct the reference |

Plus the immediately following commit, which only adds this row — its SHA cannot be written into the
commit that contains it.

Only `bb5e5f8` and `7286e71` change behaviour; the rest are documentation.

`bb5e5f8` ships the on-screen charts, the Market Pulse strip and the interface changes. It does
**not** ship the bank stress map, which stays dark in production until `bank-stress-map` is added to
`ENABLED_TABS`; that makes the map a separate, reversible decision from the rest of the work.

`7286e71` corrects Reserve Coverage and CRE / (T1+T2). **Do not merge `bb5e5f8` to `main` without
it** — on its own it puts a Reserve Coverage roughly 30x too large in front of users, in the KPI
tile, the screening table, the drawer and the PDF.

---

## Production commits

Complete history of `main`, newest first. 187 commits, first on 2026-03-01.

### 2026-09 — the data-accuracy and visual work reaches production

| Commit | Date | Summary |
| --- | --- | --- |
| `7d74797` | 09-08 | Fast-forward of 55 commits from `dev`, listed individually under "Dev branch commits" above. Ships the corrected CRE definition, the corrected capital ratios, the Market Analytics column and scoring corrections, and Market Pulse. The department lenses and the bank stress map ship dark behind `ENABLED_TABS`. |

### 2026-08 — sessions, dev environment, data accuracy and UI cleanup

| Commit | Date | Summary |
| --- | --- | --- |
| `e8bf8ad` | 08-21 | docs: record the year-long session and the dev-to-main merge |
| `74807d8` | 08-21 | feat: keep users signed in instead of expiring the session weekly |
| `43fb6dd` | 08-18 | docs: correct the technical reference against a full codebase inventory |
| `6263857` | 08-18 | docs: add session, rollback and technical reference records |
| `908d083` | 08-18 | fix: let a database-less dev deployment degrade instead of refusing |
| `27a00b8` | 08-18 | docs: record free-tier constraints for the dev environment stores |
| `255828f` | 08-17 | chore: add isolated dev environment on a long-lived dev branch |
| `eabf088` | 08-17 | feat: anchor Key Signals on measured market data |
| `2191ff3` | 08-17 | fix: keep content farms out of the outlook memo's sources, not just its figures |
| `25b6dfb` | 08-17 | fix: enforce sourced figures in the outlook memo instead of asking for them |
| `4b09072` | 08-17 | fix: decode named HTML entities in feed headlines |
| `586f52f` | 08-17 | fix: recover feed headlines lost to a broken CDATA regex |
| `dc31c78` | 08-17 | fix: stop Key Signals from stating unsourced figures |
| `cf9e8a2` | 08-17 | feat: remove unused Send News Email button |
| `984a361` | 08-17 | feat: remove region dropdown and admin token field |

### 2026-07 — OpenAI migration

| Commit | Date | Summary |
| --- | --- | --- |
| `33c3615` | 07-07 | fix: make all AI-backed feeds true daily snapshots (25h cache windows) |
| `1fa8f62` | 07-07 | fix: strip OpenAI inline web-search citations from output text |
| `e38ea2a` | 07-07 | fix: default to gpt-4.1-mini — gpt-5-mini requires OpenAI org verification (API 404) |
| `d1cf69c` | 07-07 | feat: migrate AI features from Claude to OpenAI (Responses API with web search) |

### 2026-06 — Claude era

| Commit | Date | Summary |
| --- | --- | --- |
| `26597da` | 06-11 | fix: enforce one bullet per key point in Key Signals / Industry Outlook |
| `29a5e6d` | 06-10 | feat: pre-generate and cache article briefs so they load instantly |
| `7397b0f` | 06-10 | feat: migrate AI features from Perplexity to Claude; reconstruct paywalled briefs |

### 2026-05 — caching and cron infrastructure

| Commit | Date | Summary |
| --- | --- | --- |
| `37e1b8e` | 05-18 | feat: auto warm cache after every deployment via GitHub Action |
| `2d68495` | 05-18 | fix: stop discarding valid Perplexity output due to strict section heading check |
| `deb241d` | 05-11 | fix: eliminate middleware bypass bug in industry outlook cache warm-up |
| `f9c0bdc` | 05-08 | feat: add persistent cache to Market Research and Legal tabs |
| `dc6abe7` | 05-08 | fix: run cache warm-up at midnight ET (covers EDT + EST) |
| `432918d` | 05-08 | fix: exclude /api/cron from auth middleware |
| `e9a3ac0` | 05-08 | feat: add daily cache warm-up cron job at 4am ET |
| `e266a24` | 05-08 | fix: prevent Vercel timeout on industry-outlook route |

### 2026-04 — auth, Legal tab, research feed, participants rework

| Commit | Date | Summary |
| --- | --- | --- |
| `0be9487` | 04-30 | Cache today's news data; remove Industry Reports from Market Research |
| `4ce6c48` | 04-29 | Add Log out button to dashboard header (clears auth cookie) |
| `b6b03d9` | 04-29 | Improve News/Market Research UX: speed, Key Signals, curated reports |
| `8ab6911` | 04-29 | Add password protection (middleware, login, /api/auth) |
| `259fa20` | 04-23 | Remove Market Participants tab — replaced by AMO Dashboard |
| `6dbb808` | 04-06 | Rebuild Legal Landscape tab with AI-powered intelligence feed |
| `8da90c8` | 04-06 | Add investment memo generation from selected research reports |
| `8a005af` | 04-06 | Add 1-year rolling archive to Market Research feed |
| `ca0327d` | 04-06 | Remove PDF report library from Market Research tab |
| `71bd8b6` | 04-06 | Fix research feed publisher diversity: parallel per-publisher queries |
| `53c04ca` | 04-06 | Add live Market Research feed powered by Perplexity |
| `8a99c6a` | 04-03 | Sort Florida/Miami articles to top when geo level is FL or Miami |
| `10deb6c` | 04-03 | Address executive feedback: access legend, FL coverage, finance diversity, deep briefs |
| `ba28153` | 04-03 | Remove Key Sources section from Industry Outlook |
| `42987db` | 04-03 | Fix outlook column layout and remove glance strip |
| `c81bfe8` | 04-03 | Improve News tab UX: topic filters, outlook layout, glance strip, detection reason |
| `54b9c72` | 04-03 | Downgrade Industry Outlook to sonar model; don't cache error fallbacks |
| `a9e2603` | 04-03 | Migrate all AI calls to Perplexity sonar-pro; drop OpenAI from news/outlook |
| `c79e14c` | 04-03 | Improve Industry Outlook depth and sort news by access status |
| `07cbe24` | 04-03 | Fix news tab: industry outlook timeout, paywall handling, text color |
| `a0a430d` | 04-02 | Fix entity search: multi-source API search + fully API-driven profile component |
| `fdb28df` | 04-02 | Add Entity Intelligence Search and fix column header tooltips |
| `dd12787` | 04-02 | Add detailed hover tooltips to all table column headers |
| `2530466` | 04-02 | Refactor Market Participants tab — momentum badges, Active Borrower Signals, **remove spider graph** |
| `59d6ab3` | 04-02 | Flip Bank Selloff to Competitor Sourcing Intelligence |
| `e6c6d37` | 04-02 | Exclude residential/consumer mortgage originators from Bank Selloff panel |
| `ce1ae56` | 04-02 | Filter competitor-to-competitor flows from Bank Selloff Intelligence |
| `c53155c` | 04-02 | Add Bank Selloff Intelligence — competitor-filtered AOM sourcing panel |
| `0e04fc5` | 04-02 | Replace spider graph with expandable inline borrower breakdown |
| `7f2ae4f` | 04-02 | Add lender spider graph and tooltip headers to Private Creditor Monitor |
| `8d0926b` | 04-02 | Add Private Creditor Monitor — Miami/FL activity intelligence |
| `37f60cc` | 04-01 | Trigger fresh build after fixing ELEMENTIX_API_KEY env var |
| `edd7ca1` | 04-01 | Trigger fresh Vercel build to pick up ELEMENTIX_API_KEY env var |
| `eb98d54` | 04-01 | Fix volume/avgDealSize/percentChange and remove SQLite from participants-intel |
| `ea3fde2` | 04-01 | Strip competitor AOM tab to two spider-graph-backed tables only |
| `f2a5380` | 04-01 | Add outbound spider graph to Bank Sell-Off Signals table |
| `d2bc25b` | 04-01 | Fix volume, add executive competitor intelligence panels |
| `0ba5cf3` | 04-01 | Strip Market Participants tab down to Competitor AOM Intelligence only |
| `2b2fceb` | 04-01 | Add weekly AOM trend sparklines and assignor drill-down intelligence panel |

### 2026-03 — foundation

| Commit | Date | Summary |
| --- | --- | --- |
| `ca41990` | 03-31 | Add Elementix live AOM data, competitor spider graph with assignor drill-down |
| `c93b8dc` | 03-18 | Upgrade participants intelligence with value recovery and signal quality |
| `e93bf85` | 03-18 | Fix participants zero volumes and improve readability contrast |
| `5b0a08f` | 03-18 | Rebuild market participants tab into modular intelligence system |
| `fee10cb` | 03-12 | Cache industry outlook once per session |
| `352310c` | 03-11 | Harden FDIC fetch reliability for market analytics |
| `36f9d72` | 03-06 | Switch institution profile to popup modal |
| `126f6c1` | 03-06 | Improve industry outlook source rendering and section parsing cleanup |
| `1e4aabf` | 03-06 | Tighten outlook formatting and clean source URL output |
| `261266c` | 03-06 | Switch industry outlook endpoint to regular-prompt generation mode |
| `4a8bd0e` | 03-06 | Increase industry outlook generation time budget to reduce fallback hits |
| `2001352` | 03-06 | Enforce bounded runtime for industry outlook generation |
| `15c9e56` | 03-06 | Prevent industry outlook endpoint from failing to empty state |
| `b0e4893` | 03-06 | Add resilient fallback memo for industry outlook generation |
| `2bbf479` | 03-05 | Ground industry outlook generation with validation and source context |
| `51a4eaf` | 03-05 | Strengthen industry outlook prompt for data-rich output |
| `58c0d50` | 03-05 | Switch industry outlook generation to OpenAI |
| `652a54b` | 03-05 | Remove bulk test-report delete control from market research UI |
| `e0fedb7` | 03-04 | Add fast pdf-parse fallback for private PDF summarization |
| `79ce113` | 03-04 | Improve OCR fallback resilience for difficult private PDFs |
| `0031de2` | 03-04 | Harden report summarization against Vercel function timeouts |
| `9b09368` | 03-04 | Add OCR-capable OpenAI file fallback for report summarization |
| `abda608` | 03-04 | Add in-table summary popup workflow for research reports |
| `3e87054` | 03-04 | Switch report summarization pipeline to OpenAI |
| `15aa323` | 03-04 | Fix summarization for private Blob-backed report documents |
| `854b470` | 03-04 | Add report summarization API and in-library summarize actions |
| `ff234ec` | 03-04 | Fix library visibility defaults after producer inference updates |
| `493f5dd` | 03-04 | Infer producer identity for manual uploads from document signals |
| `e5f163c` | 03-04 | Add per-report delete action in Market Research library |
| `0d92b8d` | 03-04 | Extract upload metadata from PDF content and add test-report cleanup |
| `c3d4a7c` | 03-04 | Serve private Blob PDFs through a secure report proxy route |
| `7971b1b` | 03-04 | Align Blob uploads with private store access mode |
| `4fa4faf` | 03-04 | Add Blob transfer-path diagnostics for manual uploads |
| `249fda5` | 03-04 | Increase Blob upload timeout for manual PDF library |
| `f5710f3` | 03-04 | Add Blob token preflight check for admin uploads |
| `941f5c8` | 03-04 | Improve Blob upload handshake diagnostics and fail-fast behavior |
| `3ca6115` | 03-04 | Fix upload diagnostics runtime reference error |
| `16ebd69` | 03-04 | Add detailed per-file upload stage diagnostics |
| `f23e776` | 03-04 | Switch Market Research uploads to direct Blob handle-upload flow |
| `d039e87` | 03-03 | Allow blob token issuance even on auth mismatch |
| `e08e0ae` | 03-03 | Harden blob token auth fallback for upload handshake |
| `b798258` | 03-03 | Add upload timeouts and progress status messaging |
| `8d453dd` | 03-03 | Add blob runtime health check endpoint |
| `9f99ace` | 03-03 | Stabilize blob upload flow and explicit report registration |
| `427d0c9` | 03-03 | Fix blob upload auth using client payload token |
| `916e9b0` | 03-03 | Fix blob upload token handshake for admin uploads |
| `041774b` | 03-03 | Switch research uploads to direct-to-blob flow |
| `d369d5c` | 03-03 | Handle non-JSON API responses in market research upload flow |
| `d30c0e2` | 03-03 | Add Market Research manual upload + Vercel Blob library UI |
| `2bce843` | 03-03 | Reset Market Research tab to clean scaffold for v2 rebuild |
| `841d2b0` | 03-02 | Improve sitemap fetch headers + diagnostics |
| `51e333a` | 03-02 | CBRE ingestion via sitemaps (Option 1) |
| `889f77a` | 03-02 | Improve CBRE Coveo 403 diagnostics |
| `e80865c` | 03-02 | Add CBRE Coveo ingestion + debug logging |
| `3235862` | 03-02 | CBRE ingestion via Coveo search (Path B) |
| `93652c6` | 03-02 | Add bounded debug logging for research ingestion |
| `27c40cf` | 03-02 | Add distressed CRE relevance gate + per-producer quota to research ingestion |
| `6355e4d` | 03-02 | Add node runtime + maxDuration + ingestion timeout safeguards |
| `f85707d` | 03-02 | Market Research revamp: DB + ingestion foundation |
| `f56d0df` | 03-01 | Add server-side tab feature flags and dashboard component |
| `b3d70f9` | 03-01 | chore: upgrade next to 15.2.6 (security patch) |
| `b392961` | 03-01 | Initial commit - Vercel deployment hardening baseline (no secrets) |
| `7bac66e` | 03-01 | Initial commit - Vercel deployment hardening baseline |
