# Session Log

Running record of work sessions, most recent first. Update at the end of every session, alongside
`README.md`, `ROLLBACK.md` and `confluence.md`.

Each entry should let someone who was not present answer three questions: what changed, what state
is it in now, and what is still open.

---

## 2026-10-06, late morning (latest) — eight quarters in the drawer: how a bank got here

The Cohort Changes list says *that* a bank is slipping; the user asked whether clicking a bank
could show *how*, as line graphs over the last eight quarters. Discussed first, then built the
recommended shape on `dev` (`24b2947`), fixed its layout (`6d5169d`) after the user's first look on
the preview showed six panels crushed into a narrow dialog, then added a written reading under the
panels (`38b688a`) after the user pasted the kind of breakdown they wanted.

**What changed.** The institution drawer now opens with an **Eight-Quarter Trend** block above
Structural Exposure (single-bank view only): a one-line verdict — *Deteriorating*, *Watch* or
*Stable* — then five small line charts (credit quality: noncurrent and nonaccrual ÷ loans; capital:
leverage, CET1, total risk-based; CRE exposure: CRE and construction ÷ (T1+T2); reserves:
allowance ÷ loans; earnings: ROA and net interest margin), each with the published supervisory
thresholds as dashed reference lines, and a Prompt Corrective Action capital-category strip, one
cell per quarter. The verdict reuses the Cohort Changes signal detector (`watchInstitution`), so
the sentence in the drawer agrees with the list that sent the reader there; *Deteriorating* is
reserved for a capital downgrade or a supervisory crossing corroborated by a second signal, a lone
crossing at a well-capitalised bank being *Watch*. No peer line in this cut.

Data is one FDIC `/financials` call per CERT when the drawer opens, cached per CERT and published
quarter for a week (`institution-trend-v1`), so the screening payload — already near the 2 MB
Data Cache ceiling — is untouched. Shaping is pure in `lib/analytics/institution-trend.ts`
(every value in percent points; missing ratios `null`, never zero, so a CBLR filer's absent
risk-based ratios do not draw a capital collapse); the chart is
`components/institution-trend-panels.tsx`; the action is `getInstitutionTrend` in
`app/actions/market-analytics-watch.ts`. `app/services/cohort-watch.ts` now exports its row
adapter with ROA, NIM and nonaccrual added.

**Verified** against live FDIC data and rendered in a browser via a `/tmp` esbuild harness (the
app itself still cannot be logged into from the tool): Community B&T West Georgia reads
*Deteriorating* — the strip runs Well → Adequate → Under → Adequate → **Critical** and the capital
panel shows leverage falling from 8.8% to 0.16%, three quarters before regulators closed it;
Anchor Bank reads *Stable* with the CBLR leverage-only note; Madison County Community Bank reads
*Watch* on a single construction crossing (111% from 89%). Tests: `test:institution-trend` 10
(runs under `tsx`, since the module uses `@/` imports); institution-change and capital-category
unchanged. Build passes. Recharts 3 draws nothing under `renderToStaticMarkup`, which is why the
harness bundles for the browser rather than rendering on the server.

**The layout fix found an old bug.** The drawer's `DialogContent` asks for `max-w-6xl`, but the
base component's `sm:max-w-lg` is a media-query rule and wins on every desktop viewport, so the
drawer — comparison table, peer chart and all — has been rendering 512px wide, and the trend grid,
sized by *viewport* breakpoints, put three columns into it. `6d5169d` prefixes both dialog widths
with `sm:` so they outrank the base, and sizes the trend grid with Tailwind container queries
(`@container`, `@xl:grid-cols-2`, `@4xl:grid-cols-3`) so it reads the drawer's width: one column at
512px, three 350px columns at the drawer's real ~1100px. Panels are taller, x-axis ticks thin out
(`minTickGap`) and the paired reference labels sit on opposite sides of their lines. Verified at
both widths in the esbuild harness; the user's next look on the preview is the confirmation.

**The analyst reading (`38b688a`).** The user fed the eight-quarter table to a model and got the
breakdown they wanted — problem loans 10–17% for a year; the −6.88% ROA loss took leverage to
0.16%; the CRE-to-capital jump is a collapsed denominator, not lending; the Q3–Q4 2025 improvement
did not hold; the other bank is CBLR and its 3.52% ROA is a one-off or a data issue — and asked for
it under the trend whenever a bank is clicked. Built as `getInstitutionTrendNarrative(cert)` over
`lib/analytics/institution-trend-narrative.ts`. The model sees only the table the panels plot,
plus a precomputed list of which quarters sit on the adverse side of each published screen, and
is asked for at most two paragraphs and 140 words in that style. Its answer is shown only if
**every number in it** is a table figure at some rounding, a quarter or year label, or a count of
twenty or less (`checkNarrative`); otherwise a deterministic reading built from the signals
appears instead, and the block says which it is. Cached per CERT and quarter for a week; it
arrives after the panels and never blocks them.

Three things the live runs taught: the mini model called a 0.7% allowance "comfortably above the
1% screen" and 2.5% "below" it, so the comparisons are now computed in code and handed over as
facts rather than asked for; "soared past 400%" for 425.6% slipped through a trailing-zero rule
that read `400` as the small count `4`, now closed, and the prompt forbids convenient rounding;
and the call defaults to `gpt-4.1` (`OPENAI_TREND_MODEL` overrides) via a new per-call `model`
option on `callOpenAi` — one short, checked, week-cached call per bank is worth the full model.
After those, West Georgia, Anchor Bank and Madison County all read correctly in 2–3 s and
120–140 words. Tests: `test:trend-narrative` 10.

Still open: `7aab24f`, `45d2934`, `24b2947`, `6d5169d` and `38b688a` await the user's review on
the dev preview before going to production. Possible second cut: a dashed peer-median line per
panel from the matched cohort. Unchanged: the "CRE / Assets" label (value is CRE ÷ loans); the
FHFA/FRED Florida selector; `bank-failure-monitor.tsx` and the Executive Brief unreferenced.

---

## 2026-10-06, mid-morning — Cohort Changes: who is slipping, who has gone, and why

Asked how to get the West Georgia story — closed 1 May, FDIC receiver, sold to Anchor Bank, $97M
cost to the insurance fund, capital gone in a quarter — for every bank. Everything in that paragraph
but one phrase turned out to live in three FDIC endpoints (`/failures`, `/history`, `/institutions`)
plus the quarters we already fetch, and two of the building blocks already existed unused:
`lib/scoring/institution-change.ts` (crossings and trajectories, feeding the unreachable Executive
Brief) and `bank-failure-monitor.tsx` (rendered by nothing). Offered three options; the user chose
all of them.

**Built on `dev` (`45d2934`).** A **Cohort Changes** card between the Cohort Summary and the charts,
`components/market-analytics-watch.tsx` over `lib/analytics/cohort-watch.ts` (pure) and
`app/services/cohort-watch.ts` (fetch). *Deteriorating*: headline-quarter filers with a Prompt
Corrective Action capital-category downgrade (`lib/scoring/capital-category.ts`, published
12 CFR 324.403 thresholds, weakest ratio binds, CBLR filers on leverage alone), a threshold
crossing, or a three-quarter adverse trend; ranked, capped at twelve, rows open the drawer.
*Exits*: banks that filed in the quarter before but not for the latest, each with why — failure
record (resolution type, acquirer, deposits/assets at failure, estimated DIF cost), merger with
acquirer from `/history` by `OUT_CERT`, or the `/institutions` inactive record as fallback when
`/history` has not caught up (two Florida banks closed 30 September had no history row a week
later; `/institutions` already said code 240, voluntary closing). The drawer gained a Capital
Category line and a Corporate History block (acquisitions by `ACQ_CERT`).

Verified against live FDIC data: Georgia lists West Georgia's failure exactly as the user quoted it,
plus seven mergers (Synovus into Pinnacle among them) and one late filer; Florida lists FineMark's
merger into Commerce Bank and the two voluntary closings; National runs in 6 s on a 13 KB payload,
253 of ~1,000 capped institutions showing a signal. Anchor Bank's history returns both its
acquisitions. Tests: capital-category 8, structure-events 10, institution-change still 14. Build
passes. **Not seen in a browser** — the tab mounts lazily behind the News tab and the local check
cannot log in without typing the password — so the first look at the card is on the dev preview.

Along the way: `lib/fdic-client.ts` now parenthesises array filters (an OR list followed by an AND
was mis-grouped before; no caller had passed an array); `institution-change.ts` suppresses a
crossing whose two displayed values are identical; the screening row carries `capitalCategory`
(key `market-analytics-screening-v2`); the warm cron warms the watch for National and Florida.

Still open: the "CRE / Assets" label on the Capital Sensitivity Matrix and drawer (value is
CRE ÷ loans); the FHFA/FRED Florida selector; `bank-failure-monitor.tsx` and the Executive Brief
remain unreferenced and could now be deleted. Both 10-06 commits await a look on the dev preview
before going to production.

---

## 2026-10-06, morning — the charts were ranking a bank that no longer exists

Walked through the Market Analytics tab — where every figure comes from and how it is computed —
and then looked hard at one: the CRE-to-Capital Ranking's leader, Community B&T West Georgia at
710.3% CRE/(T1+T2). The figure is arithmetically right (CRE $25.8M against Tier 1 + Tier 2 of
$3.6M, Tier 1 having fallen from $18.5M to $0.47M in a single quarter) but the bank failed on
1 May 2026 (FDIC failure record, Anchor Bank acquirer, $97M estimated cost to the DIF). It was
on the chart because the report path kept each institution's last filing even when that filing
predated the quarter the rest of the page reports — the screening table already refused that, so
the two halves of the tab disagreed about who was in the cohort. FDIC records 370 institutions
going inactive inside the 27-month data window (236 mergers, 9 failures), each a candidate to
linger in the charts and exports on its final filing.

Found a second bug alongside it: `buildExportData` chose "latest" by sorting on
`Date.parse(reportDate)`, and FDIC dates are `YYYYMMDD`, which `Date.parse` cannot read. The
comparator was `NaN`, the sort a no-op, and a shrinking bank was represented by its
largest-asset quarter. The same `NaN` comparison fed the KPI averages.

**Fixed on `dev` (`7aab24f`).** `lib/analytics/headline-filing.ts` holds the rule: an institution
is in the report cohort only if it filed for the headline quarter, represented by that filing;
applied to the rows and to the KPIs, with five tests (`npm run test:headline-filing`). Verified
against live FDIC data: Florida table and report cohorts now match exactly (85 and 85, no
mismatch either way); Georgia drops 141 → 125 and Touchmark National reads 386.8% from the right
quarter instead of 467.7% from an older one. Cache keys bumped so the stale series recompute.
Not in production.

Two findings from the walkthrough are **still open**, deliberately left alone: the Capital
Sensitivity Matrix x-axis, its tooltip and the drawer percentiles are labelled "CRE / Assets" but
plot `creConcentration`, which is CRE ÷ loans (the glossary defines the two as distinct); and the
FHFA/FRED block's Florida selector fetches Miami-Dade data but always renders the national
series (`market-research.tsx` L245).

Trap: `npx tsx` scripts that import `@/app/actions/*` must be plain `.ts` with an async `main()`
— top-level `await` fails under the CJS output and `.mts` cannot see the CJS named exports.
`tsx` also cannot create its IPC pipe inside the sandbox; run it with full permissions.

---

## 2026-10-05, 14:35 — the load fix is in production

Bugbot reviewed the branch changes and found nothing. `main` fast-forwarded `4d1cf60` → `7f24131`,
so `0aaf1b2` (the `/api/cron/measure-load` diagnostic) and `f72fbb4` (the News tab's data arriving
in the page) are now live, and `main` and `dev` are level. Checked before the push: `main` had no
commits `dev` lacked, and nothing in the diff was rewritten with CRLF line endings. The only type
error in a changed file (`components/industry-outlook.tsx:132`) dates from March, and builds skip
type errors anyway (`ignoreBuildErrors`).

The Market Analytics visuals check planned here was done on 2026-10-06; see the entry above.

Also still open: measure the before and after on the real production deployment
(`/api/cron/measure-load` with the cron bearer, plus a timed load of the page), which should show
the News tab with no skeletons on a warm day. If the page gets slower or renders wrong, revert
`f72fbb4` alone. Steps 3 and 4 below are still not started.

Trap: pushing from an agent shell fails with "could not read Password", because the GitHub CLI's
active account is `RSronin09` and the remote belongs to `EnriqueColon`. Pass
`gh auth token --user EnriqueColon` as the credential for that one push rather than switching
accounts.

---

## 2026-10-05, later afternoon — why every open of the tool was slow

Asked why the whole tool takes so long to load, every time, for everyone — not just the first
visitor of the day. The architecture map said: the page is an empty shell, every box fetches its
own data after the JavaScript loads, nearly all of it through day-keyed `unstable_cache`. Two
theories: the overnight warm cron failing (would be slow mornings only) or structural delivery
cost (slow always). The user's answer — slow every time — pointed at the second.

**Measured before changing anything** (`0aaf1b2`, `/api/cron/measure-load`, behind the cron
bearer, not scheduled: runs every dashboard action twice and reports payload size). On a fresh
local production build every action regenerated once — Outlook 26 s, each Public Mentions feed
12 s, Legal 12 s, Research 13 s, screening 5 s — and then returned in 0 ms on every later call.
Payloads are tiny, 5–112 KB against the Data Cache's 2 MB entry limit, so the "cache silently
failing" theory is dead. On production, an unauthenticated hit to a function (401 after boot)
measured the cold start at 1.7 s and warm at 0.27 s. So on a warm day the lag was entirely
delivery: wake the function for the page, download ~600 KB of script, eight calls back, each
waking the function again to read a cache that answers instantly.

**The News tab now arrives in the page** (`f72fbb4`, on `dev`). `app/services/initial-news-data.ts`
reads the pulse strip, the Industry Outlook and the six news feeds on the server while the page
renders, each raced against a 2.5 s budget: a warm cache goes into the HTML, a cold one is left to
the component's existing client fetch, and abandoned reads are kept alive with `after()` so a cold
render still fills the cache. The four News components take the data as initial state and skip
their mount fetch when they have it; nothing about a miss changed. Locally, production build with
preview flags: warm page 20 ms with the strip, the outlook and 76 headlines in the HTML and zero
skeletons; cold page 2.6 s with the strip and placeholders; 87 ms once the reads landed. HTML is
~520 KB uncompressed now that the data travels in it. One harness trap found on the way: a local
`next start` reports "production" with no `ENABLED_TABS` and renders no tabs at all; run it with
`VERCEL_ENV=preview` to see them.

Not yet measured on Vercel itself: the dev preview hostname is not derivable from here and the
Vercel MCP needs a browser login, so the before/after on the real deployment is the next thing to
do once the preview URL is to hand. Steps 3 and 4 of the plan — cache the uncached pieces (pulse
strip in the warm cron, legal exposure counts folded into the feed, the analytics quarter probe off
the critical path) and serve stale-while-revalidating instead of expiring at midnight — are not
started.

---

## 2026-10-05, afternoon — the enforcement section was dropping its own subject

Shipped the morning's work to production first: `main` fast-forwarded `9faaf35` → `4ca86dc`, the
first release since 09-29. `ROLLBACK.md` now records that `9faaf35` will no longer build (Node 20
pin) and needs `a36ff81` cherry-picked before it can be a target.

**Released at 13:20**: everything below went to production in one fast-forward, `75959a2` →
`2425d4c`, after review on the preview. `main` and `dev` are level. The five behavioural commits
(`a01d2a5`, `da82d42`, `a313d11`, `671a877`, `b2b08e9`) are a set that reverts cleanly in reverse
order; `a36ff81` is the production state before them. First Legal Landscape load after the deploy
pays govtrack's cold start and now also GPO's, the Federal Register's and flsenate.gov's fetches,
then is cached for the day under `legal-updates-v14`.

Then the two items left open last week, both on `dev` as `a01d2a5`, not yet in production.

**Monthly enforcement roundups now render.** The description carried forward from 09-30 — "dropped
as individual actions" — turned out to be half the story. Three live runs: the model found and
correctly cited the OCC's July and June pages and the FDIC's August page, and every one failed the
*topic* gate too, because a roundup's title names a month rather than a subject. The individual
gate caught about half of them on top of that. Either way the section had nothing from either
regulator while a bank receivership rendered beside the gap. `isEnforcementDigest` recognises the
form (a month name with "enforcement actions", title only) and `bearsOnFirmOperations` admits it
before asking anything else; the Enforcement prompt now tells the model to report a roundup as one
item under the regulator's own title, summarise the page as a whole and name no individual. Three
runs after the change: September and July OCC roundups and the FDIC August roundup all render,
verified against the real pages. A single action the model pulls out of a roundup is still judged
as the action it is. Cache key bumped to `v10`.

The third post-change run returned five fabrications ("XYZ Mall", "ABC Office Tower") and the
source guard dropped all five, which is that guard doing its job and nothing to do with this
change. Worth knowing when reading the preview: the section can be empty on a bad run, then
retried once.

**The Legislative Tracker header** no longer promises "active movement" over bills that died in
March; it says "this session". One line in `components/legal-updates.tsx`.

**Rule cards now show the record and summarise the rule, not its abstract** (`da82d42`, on `dev`).
Asked how we knew the escrow-rule summary was true, the honest answer was: the facts are the
Federal Register's, the prose is the model paraphrasing a 70-word agency abstract, and the tool had
never read the rule. The same API call that gives the title gives the action line, citation, CFR
parts amended, docket, RIN, page count and the official PDF, all of which were being discarded; the
card now lists them under the source line, untouched by any model. And every document has a
plain-text version, so `selectRuleText` takes its explanatory sections — "Description of the Final
Rule", "Overview of the Proposal", Introduction, Background, not the administrative boilerplate or
the regulatory text — capped at 6,000 words, and the model is given that to condense into a summary
and up to five `details`, with the list discarded for any rule whose text was not fetched. The
contents-list and restarting-numeral traps in the Federal Register's plain text were found by
testing against seven live documents, 8k to 116k words; both are handled and tested. Live on the
escrow rule: eight record facts, 6,016 words selected, five details, every spot-checked point
traced to the text, 9k input tokens. Cache key `v11`.

Also found on the way: the escrow rule had been rendering under its *correction's* date and text.
`C1-2026-10036` is a one-page typo fix with no abstract; the later-date-wins dedupe had let it
beat the rule it corrects. Corrections now yield to their original, which carries "Corrected
2026-06-29" with a link.

**The same treatment for Florida bills and the enforcement roundups** (`a313d11`, on `dev`). Asked
whether the rule cards' change had reached the other sections — it had not — and then asked to do
the two that were within reach.

Florida: the `getBill` call that had been made for the flsenate link alone also returns sponsors,
the full action history, every roll call, the companion bill, each text version and the staff
analyses. The card's record line now lists primary sponsors, filing date, companion, last roll call
with tally, latest text and latest analysis, the last two linked. The roll call is what most often
changes the reading of a dead bill — HB 759 "Died in Rules" after passing the House 114–0. The
staff analysis, Florida's nonpartisan committee account of what a bill does, is fetched (PDF, via
`pdf-parse`, already a dependency; parser passed in so the module stays import-free) and handed to
the model for `details`. Live: two of five bills have one — the three that died unheard never got a
committee stop — and theirs came back with fiscal figures and committee tallies traceable to the
document. 9.4k input tokens for all five.

Enforcement: the roundup items the model finds are now *read*. After source verification,
`readEnforcementPages` fetches each roundup page, `htmlToText` keeps the main region one list item
per line, and the model is asked to report what the page lists — one bullet per institutional
action, individuals counted and never named, and a "why it matters" permitted to say there is
nothing here. That closes the open item below about generic "why it matters": the OCC's September
page now reads "two prohibition orders against former employees; nothing here bearing on note
purchases", and July's lists the cease-and-desist and four terminations by institution. The FDIC's
releases give counts and link to a separate list; the model reports the counts and points at it.

Cache key `v12`. 86 `tsc` errors before and after, all pre-existing; `next build` passes.

**The Tracker now says the session is over, and what the dead bills signal** (`671a877`, on `dev`).
Asked what "Died in Judiciary" meant, and then whether a dead bill was any use to a reader: it is
the clerk's phrase for a bill still in that committee when the session ended on 13 March, and all
five Florida bills on the section are in that state, which the five cards did not convey. Asked
for a note saying filing for 2027 usually opens in the autumn, and a "possible intent" section
below the bills. Both come from the record, no model. `describeFloridaSessionState` writes the
note when every Florida bill is dead — session year from the items' dates, so it reads "2026 has
ended … filing for the 2027 session usually opens in the autumn" without a hard-coded year — and
it travels as a new `sectionContext` field, kept apart from `sectionNotes` because it frames a
section that has items. `describeIntent` writes one sentence per dead bill from its last roll
call, where it died and its companion, and the component lists them once below the cards under
"Possible intent", labelled as signals with no legal effect. Live, the five lines split exactly as
the record does: HB 759 passed the House 114–0 then died in Senate Rules, HB 1423 cleared a
subcommittee 14–3 then died in Judiciary, and HB 1227, SB 300 and SB 956 were filed and never
heard. Nothing is said about why; the record does not know. Both blocks vanish on their own when a
live bill enters the list. LegiScan has no 2027 session yet — newest is "2026 Sixth Special
Session" — so this is what the Florida half will show until filing opens. Cache key `v13`; three
new tests; `next build` passes.

Noticed, not touched: `app/api/research/summarize-report/route.ts` calls `pdf-parse` through its
v1 default export, which v2 (installed) does not have — `tsc` flags it and the route's fast path
cannot be working. Separate concern, separate fix.

**Federal bill cards, the last thin ones, now show the record and the bill** (`b2b08e9`, on `dev`).
Asked whether the three federal bills could carry more than number, title, status and sponsor. The
open item below this entry had said no: no text route without a key. That was true of the APIs —
congress.gov's answers 403 and govinfo's 401 — and not of GPO's bulk data, which is open and
turned out to carry more than LegiScan does for Florida: the record (`BILLSTATUS`), every text
version (`BILLS`), the committee report (`CRPT`), and the Congressional Research Service's summary
of the bill inside the record, which is the federal counterpart of the Florida staff analysis.
`lib/legal-updates-govinfo.ts` reads all four by bill number; govtrack is left to do what it did,
find the bills. The record line now says how a bill passed as well as that it did — H.R. 7730
"House 2026-09-16 (voice vote, under suspension); Senate 2026-09-28 (unanimous consent)" — and
links the report, the text and the CRS summary. The model is handed whichever of the three exist,
named, and asked for details from them alone. Live on the three bills showing: H.R. 7730 had all
three (92-word CRS summary, 2,346 words of report, 390 of text); S. 5477 and H.R. 9670 had only
their text, which is the usual state of a bill that has not moved; every spot-checked figure — the
$7.5M and $2.75M limits, new IRC §6874, the $250,000 exemption, the effective-date clause — traces
to the document. S. 5477 turns out to be an Internal Revenue Code amendment, which its title does
not say and its card now does. The first version of the XML reader listed "Judiciary Committee;
Markup By; Referred To" as three committees and lost every text version, because the record nests
`<item>` inside `<item>` and a non-greedy match closes at the inner one; a depth-counting block
matcher replaced it and the test fixture keeps the nesting. The card's label over the details is
now a field, `detailsSource`, so Florida reads "From the staff analysis" and roundups "From the
page" rather than everything reading "From the rule text". The govtrack-only prompt is gone;
the record-aware one supersedes it. 16 new tests; cache key `v14`; `next build` passes.

Open: CourtListener still answers anonymously and is still unused. Federal bills have no "possible
intent" line yet; the record would support one (manner of passage, cosponsor count) if wanted.

---

## 2026-10-05, morning — the dev build would not start

The push of `fe1cee1` to `dev` on 09-30 never built: Vercel refused it before cloning finished,
because `engines.node` was `20.x` and Node 20 has been retired. The pin dated from the start of the
project. `main` carried the same one, so the production deploy that would have followed the review
would have failed identically — a useful thing to have discovered on the preview.

One line changed, to `24.x`. No code moved: local development had been on Node 24 for some time,
and every build and every test run of the previous week had been under it. Pushed as `a36ff81`.

Everything from 09-30 was reviewed on the preview and merged to production the same afternoon;
see the entry above.

---

## 2026-09-30 — the Legislative Tracker was inventing its bills

#### Addendum, same day — the sources we were not actually using

Prompted by a list of federal and Florida legal data sources, with a question about whether we were
looking into them. We were not. The app fetched exactly one legal API, govtrack, which was not on
the list. Everything on it — `federalregister.gov`, `govinfo.gov`, `regulations.gov`,
`courtlistener.com`, `flsenate.gov`, `flrules.org` — was at most *allowlisted*: named in the prompt
so the model may cite the domain, with a check that the URL loads. Never queried.

Each one was probed rather than assumed. Federal Register, eCFR and CourtListener answer with no key
at all; `api.congress.gov`, `api.govinfo.gov` and Open States all refuse without one; the govinfo
bulk-data paths 500. Two findings were worth acting on.

**`LEGISCAN_API_KEY` had been in `.env.local` since the project was set up and was read by nothing.**
A deployment checklist listed it as required. `confluence.md` said it was unused and could be
deleted from Vercel. Meanwhile Florida was the half of the Legislative Tracker that still asked a
model to recall bill numbers, which is what produced `CS/HB 1353` and `HB 793`. The key worked on
the first try. Florida bills now come from the record like the federal ones, with real statuses that
feed the movement tracking built earlier today.

**The Federal Register has an open API and the regulatory section was not using it.** Rulemaking is
now taken from it directly. It is a supplement rather than a replacement, because the Federal
Register carries rulemaking only and FDIC Financial Institution Letters, OCC bulletins and
supervisory guidance — a large part of that section — never appear in it.

The interesting problem was not plumbing. The relevance gate, tuned against items a model returns
when asked about CRE, behaves differently when pointed at everything a legislature published: it
kept 32 of 1,930 Florida bills, and most of them were fire-district and county bills whose official
descriptions mention liens. So the terms are split by how selective they are, a heading is read on
all of them and a body only on the core ones, and residential subjects are excluded by title — which
implements a decision taken this morning but only half applied, since five of the fifteen
near-misses were housing bills that got in on "multifamily" in the body.

This was first shipped as a second, stricter gate for record items only, on a base-rate argument.
It lasted a few hours: the first look at the tab found a Federal Reserve stablecoin proposal
admitted through the model path on "capital requirements" in its body, which is the same failure.
There is now one gate. The same look found a Farm Credit Administration rule that got in on
genuine terms and regulates nobody this firm deals with, so the Federal Register search is now
restricted to the financial regulators. And it found three plain defects: every Florida bill
rendering as its raw description with no "why it matters" (the model drops the `summaries` wrapper
half the time and that read as no answer), `&#39;` printed literally from LegiScan text, and a real
OCC rule summarised as "No agency abstract was published" because its republication carries none
and the original does.

Decided and kept as they are: bills that died still show, since a bill that died signals where the
legislature is heading; and Florida bills qualifying on one core term in a long description are
accepted, because no rule separates the grab-bag preemption bill from "Alternative Judicial Sales
Procedures" without losing the second.

Two structural exclusions were verified rather than assumed: Florida numbers local bills in the
4000s (48 of 53 name a county or district), and the reviser's bills are titled exactly "Florida
Statutes". Neither set contains anything CRE-relevant by title, so excluding them costs no item.

**A reliability bug in yesterday's work turned up while probing.** govtrack answered its first
request after an idle period in 28 seconds and the rest in a quarter of one. Production makes one
cold request a day off the cron, so twelve parallel searches were racing a 15-second timeout the
first of them was always going to lose — which empties the section. It failed safely and silently,
which is the worse combination, because an empty Legislative Tracker reads as a quiet fortnight.
Retrying does not help; the cold start is now paid once, on purpose, before the searches fan out.

**What is not verified.** The Florida and Federal Register paths ran live and are in the verify
script's output, so those are exercised. The `bill_status_history` writes from earlier today are
still unexercised — there is no local database, and no production credential was touched. Movement
will first be tested by its first deployment to an environment that has one.

Left open deliberately: the enforcement section still renders empty, because the only items it
returns are monthly digests and those are dropped as actions against individuals. Under the strict
posture chosen this morning that is arguably correct, but it throws away a page that also contains
institutional consent orders. It needs a decision rather than a patch.

Also noted, not acted on: this repository's line endings are mostly **CRLF** — 161 `.ts` files
against 33 — while the session rule warns about four specific files as though they were the
exception. New files in `lib/` should be CRLF to match their neighbours, and the rule's list is out
of date.




#### Addendum, same day — the tracker now tracks

A question during review: how long do we collect for, and how long do we track for? The first
answer was in the code — a rolling 180-day window for regulatory and enforcement, 400 days for
legislation. The second was **nothing at all**, which nobody had noticed.

There is no table for legal items and never was. The whole feed is a cache keyed to the calendar
day with a 25-hour life, regenerated each morning by the cron, with the previous day orphaned and
never read again. So the "Legislative Tracker" was a daily snapshot wearing the word tracker: it
could say a bill was at "Passed House & Senate" and was structurally incapable of saying it had
been in committee the week before — which is the one thing in that section a reader cannot get by
opening the bill themselves.

`bill_status_history` now holds one row per bill: the status last seen and the one before it.
Deliberately not a full action history, because govtrack publishes that already and a second copy
of a public record is a synchronisation problem bought for nothing. This only became possible this
morning, incidentally: before federal bills came from the record they had no trustworthy status to
compare against.

Three decisions, all of which are about not overclaiming. A first sighting reports **no** movement
rather than "new", because the table starts empty and the first run after deployment would
otherwise flag every bill — and a bill introduced eight months ago is not news. A transition keeps
showing until the bill moves again, so someone who checks weekly need not have been watching on
the right morning. And re-running cannot consume a movement: the feed regenerates on a cron and
again on demand, so if the second pass reported nothing then whether a reader saw a move would
depend on which request they happened to make. `diffStatus` is idempotent and tested for exactly
that.

Keyed on chamber, number and jurisdiction, never on the title or the item id — titles get reworded
between runs and the id embeds list position, so either would make the same bill look unseen
tomorrow and report a move that never happened.

**What is not verified.** The Postgres path is exercised by no test and no local run. There is no
local database, and I left the production credentials alone rather than pointing anything at real
data to try it. The comparison logic has eight tests; the storage around it rests on types and on
failing closed — any error returns no movements rather than taking the feed down, and with no
database at all the section reads exactly as it did before. The dev preview has no database, so
**this feature cannot be reviewed there**; its first real exercise will be its first deployment to
an environment that has one.

The 400-day legislative window was left as it is, by decision. A bill whose last action is older
than that drops off even while still being law, which is a known cost to revisit once tracking has
produced some history to look at.

#### Addendum, same day — one host list had a hole in it

`content.govdelivery.com` was listed as an authoritative source for `regulatory` but not for
`enforcement`. The FDIC publishes its monthly enforcement decisions there rather than on
`fdic.gov`, so those bulletins were rejected as `unlisted` — and in the logs that rejection is
indistinguishable from throwing out a fabricated URL, which is why it sat there unnoticed. Now
listed for both.

This fix is real but **not demonstrated**. The live run after it cited `occ.gov` and `fdic.gov`
and produced no GovDelivery URL at all, so nothing was admitted that would have been rejected
before. It removes a rejection that will happen the next time the model does cite the host.

That same run surfaced something to decide separately: the two enforcement items were both monthly
digests ("OCC Enforcement Actions for September 2026"), and both were dropped as actions against
an individual, because a digest lists prohibition orders among everything else. Under the strict
posture chosen this morning that is arguably right — a digest is not a specific institutional
action — but the effect is that the enforcement section rendered empty. Worth a look before
deciding it is correct.

---



Found by reviewing `dev` before merging, not by a test. The reported symptom was mild — the Legal
Landscape tab had "too wide of a pull for things we do not really use", with an OCC prohibition
order against a named individual given as the example. Following that led somewhere worse.

### The reported problem: a gate that asked the model to grade itself

`isCreRelevant` read four fields, one of which was `whyItMatters` — and the prompt instructs the
model to write that field about "relevance to distressed CRE debt investing". So every item arrived
carrying its own relevance certificate. The flagged item passed on that field alone, on the phrase
"can affect how lenders manage their CRE loan portfolios", while its title, summary and status said
nothing of the kind. The gate was not too loose; it was self-defeating, and no amount of term
tuning would have touched it. It now reads title, summary and status — what the source describes,
never what the model argues.

Three smaller things came with it. 1818(e) prohibition orders are dropped as rulings about one
person's employability, whatever the underlying conduct involved. Every term is anchored, because
bare `lien` matched "client", "clients", "resilience" and "salient" and `tenant` matched
"lieutenant" — four false positives in fifteen sample headlines. And residential and land-use
policy is out of scope by decision, which was the user's call between three options.

### The real problem: four fabricated bills, and a guard that had never worked

Tightening the gate meant re-running the live check to confirm no section went blank. Four
legislative items survived: `S. 1234`, `H.R. 5678`, `S. 2345`, `S. 3456`. Those numbers looked like
placeholders, so I checked them against the record.

| The tab said | The bill actually is |
| --- | --- |
| S. 1234 — Commercial Real Estate Credit Enhancement Act | SSI Savings Penalty Elimination Act |
| H.R. 5678 — Commercial Property Foreclosure Reform Act | No Pay for Disarray Act |
| S. 2345 — Commercial Mortgage Lending Transparency Act | Short on Competition Act |
| S. 3456 — Distressed Commercial Property Acquisition Act | Law Enforcement Officer and Firefighter Recreation Pass Act |

Real numbers, entirely unrelated real titles. A second run reproduced all four, so it is systematic:
plausible sequential numbers with invented titles is what the model does when asked to recall
legislation it cannot find.

They passed because **source verification had never functioned for this section**, and nothing
about it was visible in the code. `checkSourceUrl` asks whether a URL loads and treats 403 as "the
host refused us, not that the page is absent" — correct for a rate-limiting regulator, and
congress.gov is behind Cloudflare and 403s everything. Probed directly, `senate-bill/999999`,
`401st-congress/senate-bill/1` and the literal path `senate-bill/not-a-bill` all returned `ok`.
flsenate.gov and govinfo.gov serve soft 404s with HTTP 200. The guard looked like it was working
for as long as it had existed.

### The fix, in two steps

**A guard on identity rather than reachability** (`lib/legal-updates-bills.ts`). A bill has a
chamber, a number and a congress, all matters of record, so the claim can be checked against the
record. Federal via govtrack, which needs no key and was already on the allowlist; Florida via the
cited page, which must both not announce a missing bill and actually print the number claimed —
something a soft 404 cannot do. Titles are compared by overlap of significant words rather than
equality, because a genuine citation often gives the short title where the record gives the
official one, while all four fabrications shared zero words. An item that cannot be checked is
dropped, since failing open is what produced this.

That made the feed honest and left the section empty. So, second:

**Stop asking.** `lib/legal-updates-legislation.ts` reads federal bills from the record — number,
title, status, date, sponsor, link — and hands them to the model, which is asked only for prose. It
is never asked for an identity, so it cannot invent one. This reverses the order the other two
sections use, and it is the right order wherever the fact is already published; the model is left
doing the part it is actually good at.

Relevance is judged on the authoritative title alone. The cost is known and accepted: H.R. 10375
modernises the SBA 504 programme, which is commercial real estate lending, and no title of it says
so. Letting a model judge instead is how invented items got in.

Deduplication runs twice, because a bill repeats for two reasons — it surfaces under several of the
twelve searches, and the chambers move companion bills under one title. The Bankruptcy Threshold
Adjustment Act arrived as H.R. 7730 and again as S. 3977 "of 2026". Three rows for one piece of
legislation is the padding this feed is supposed to have stopped.

Live result: four items, all fabricated, became three real federal bills plus real Florida bills,
none failing the identity check. The Florida half of the guard earned itself in the same run,
dropping items that cited `CS/HB 1353` and `HB 793` as bills that do not exist.

### Worth remembering

The reported bug was cosmetic and the real one was that the tab was quotable and wrong. It had
passed a clean build, the full test suite, and a live-data script that checked freshness and source
reachability without ever asking whether an item was the thing it claimed to be. Two sessions
running, the defect that mattered was found by looking at output rather than by a green check.

Also: I damaged two files by normalising line endings twice in one script, turning a 3-line change
into a 73-line rewrite before spotting it in `git diff --numstat`. The repository rule names four
CRLF files; roughly 190 tracked TypeScript files are CRLF, so the rule understates it badly.

**Still open.** Unchanged: enforcement items are not matched by named institution to an FDIC cert;
`institution_watchlist` has a reader and no writer; 77 pre-existing typecheck errors that the build
ignores. New: `content.govdelivery.com` is allowed for regulatory but not enforcement, so genuine
FDIC enforcement bulletins are being rejected as unlisted — visible in every live run and not yet
fixed. "Medical Bankruptcy Fairness Act" passes the title gate on `bankrupt` while being consumer
bankruptcy; the prompt is told to say when an effect is marginal, which is the mitigation rather
than a fix. `govinfo.gov` remains unverifiable for legislation, so items citing it will be dropped.
And nothing here has reached production: `main` is still at `9faaf35`, so the live tool is still
showing scope-wide percentiles, a 180-day legislative window and the fabricated bills.

---

## 2026-09-30 — the drawer's percentiles start meaning something

Two fixes taken from a production-issues list, only one of which was code. The legal feed's single
180-day window was already fixed on `dev`, so that one shipped by merging. The other was live and
unfixed: **the institution profile drawer ranked each bank against every institution in the
selected scope.**

That number looked fine, which is the whole problem. A percentile against the whole scope is
dominated by size — a $180m single-branch bank measured against a set containing Truist is mostly
being told how small it is — and nothing on screen said what the comparison was.
`lib/scoring/peer-cohort.ts` had existed since Phase 1 to pick a defensible cohort and had never
been wired to anything.

### How wrong the old number was

Worth recording because "misleading" could mean two points or eighty. On live call reports the
CRE/Assets percentile moves for **every institution that can be ranked at all**: Texas 346 of 352,
Georgia 108 of 112, Florida 78 of 78. Mean shift for banks under $1bn is 26.6 points in Texas
against 23.2 for larger ones, and the largest single shift is 86 points. A bank that read as
median read as top-decile once compared with banks like itself.

The direction is the confirmation that matters. Small institutions move *more* than large ones,
which is what must happen if size was the axis the old comparison was dominated by. If the change
were cosmetic the smallest banks would be the least affected. `npm run verify:peer-cohort` asserts
that relationship rather than leaving it as an argument.

### Four call sites, now one implementation

The drawer list, the copied snapshot, the comparison chart and the comparison table each
re-derived the cohort inline from the `cohort` prop — four chances to disagree. They now share
`PEER_METRICS`, `percentileAmong` and `resolvePeers`.

Three consequences are carried in the interface instead of smoothed over. The cohort is stated
wherever a percentile appears, **including the copied snapshot**, because that text ends up in
credit memos and a percentile without its cohort is not a fact. Fewer than eight peers renders as
an em dash rather than a number resting on four institutions — and since that mostly affects the
*largest* banks under a single-state scope, the note says to switch the scope to United States,
which does give them a cohort. And in compare mode each institution is ranked against its own
peers, so the caption says the bars are not a shared scale, or a taller bar would read as "larger".

### Two guards in the library, for failures that render rather than throw

Wiring the drawer to a state-scoped universe exposed both.

**Geography is only relaxable when dropping it admits more institutions**, tested structurally as
`inGeography.length < inSize.length`. A single-state universe — what the scope selector produces
for any state — would otherwise return a cohort describing itself as *national* while containing
only that state's banks. Deliberately not a parameter the caller declares: a caller that gets the
declaration wrong produces a confidently mislabelled percentile, which is the failure being
prevented.

**An institution with absent loan figures is not matched on lending mix.** `creMixBand` never
throws, so missing figures land in "little CRE" — correct for a band lookup, wrong for cohort
matching, because the bank would be filed with genuine consumer lenders and `criteria.creMix`
would report a match that was never tested. `mixIsKnown` is the guard.

### The bug that only rendered output could catch

The drawer showed **"2th percentile"** and **"23th percentile"**. The old code appended a bare
"th". That survived a clean build, 199 passing unit tests, and a live-data script that checked the
numbers but never their formatting — the exact failure mode this repository keeps meeting. It was
caught by `npm run verify:peer-positioning`, which opens the drawer in a real browser and reads the
text back.

That script exists because **the editor's browser tool still cannot reach `localhost`** — five
sessions running. Playwright works fine, so the repo's own visual-verification pattern was the way
through. This is the first session in four with actual rendered confirmation of a change, and it
found a defect immediately, which is the argument for doing it every time.

Verified: 199 unit tests across 15 suites (5 new), typecheck at 77 errors before and after with
none in a touched file, build clean, `verify:peer-cohort` passing on Florida, Georgia and Texas,
and the drawer read back in a browser.

**Still open.** Unchanged: enforcement items are not matched by named institution to an FDIC cert;
the legal applicability hit rate is 1–2 items per run; `institution_watchlist` has a reader and no
writer. New: the Playwright run logs `net::ERR_ABORTED` on RSC prefetches and one
`Unexpected token '<'`, which appear to be artefacts of the script pressing Escape mid-navigation
rather than a product defect — worth confirming rather than assuming. The 77 pre-existing
typecheck errors are unchanged and the build ignores them, so types are not currently protecting
production. `peer-cohort`'s other consumers are the two unreachable views, so this is now the only
live caller.

---

## 2026-09-30 — the two lenses leave the tab bar

A correction to yesterday. Asked to remove "the dropdown that says executive, accounting,
underwriting and the functionality that comes with it", I removed that — and then made the two
views it led to into tabs, because with the dropdown gone they had no way in and something had to
be decided. That was further than the request went, and the follow-up was explicit: *"I do not want
to make major changes to the actual tool — before making changes, make sure you understand what it
is I am trying to accomplish."*

So the tab bar is back to the four it has always had. The two views are **unreachable rather than
disabled**, which is a stronger claim and was worth verifying rather than assuming: I served the
page with `executive-brief` and `underwriter-workbench` both present in `ENABLED_TABS` and neither
label rendered. No flag brings them back, because they are no longer in `TAB_DEFS`.

### The reason, which is more useful than the change

Two mechanisms were tried for reaching these views and both were rejected — a department dropdown,
then a tab. The objection was never the analysis. It is that **a destination you have to decide to
enter is one nobody enters.** Stated as an aim: the tool should get more informative and more
actionable, not acquire more places to go. That reading is now recorded at the top of `TAB_DEFS`,
in the Lenses section of `confluence.md` and in Phase 2 of `docs/NEXT_VERSION_PLAN.md`, because
this is the second time it has been settled and the third attempt should find the answer already
written down.

### What was removed beyond the two tab entries

Only things with no remaining caller. The dashboard's focus-institution routing —
`handleSelectInstitution`, `focusCert`, `focusMissedCert`, `handleFocusResolved` — existed solely
to hand an institution from either view to the Market Analytics drawer, and both senders are gone.
`MarketAnalytics` keeps `focusCert` and `onFocusResolved` as optional props, so the *receiving* half
of that handoff is intact and a future caller need not rebuild it. The two cron cache warms went
too: they would spend a couple of minutes of FDIC calls per deploy filling a cache nothing can read.
`TAB_GRID_COLS` drops back to four entries. `verify:lenses` would now fail with advice that cannot
work — "add its key to `ENABLED_TABS`" — so its message says no flag will help.

### What was kept, deliberately

The two components, their two server actions, and five calculators in `lib/scoring/`:
`institution-change` (which institutions crossed a supervisory or watch level, and which are
deteriorating without crossing anything — the only trend-over-time analysis in the codebase),
`cre-downside` (how large a CRE loss an institution absorbs before reaching its capital floor),
`peer-cohort` (a defensible peer group rather than the whole scope), `workbench-analysis` and
`quarter`. **39 passing unit tests**, and they are the reason keeping this is not the orphan
anti-pattern the department watchlist was: a pure function under test is a library, not an
unreachable write path that can silently drift.

Two of them encode things that would be expensive to rediscover. `cre-downside` knows that CBLR
filers report **zero** rather than null for risk-weighted assets — 24 of 86 in Florida — so a
`!= null` guard puts a zero in a denominator, and it refuses the `0.75 × assets` proxy used
elsewhere on the grounds that a fabricated denominator should not sit under a number quoted to a
credit committee. That is the same species of trap as the CRE-units problem caught yesterday.

Verified: 194 unit tests pass across all 15 suites, up from the 48 counted yesterday because this
is the first session to run every suite rather than the ones nearby. Typecheck shows 77 errors both
before and after the change, all pre-existing and none in a touched file. Build clean, `/` still
renders dynamically, bundle down from 66.6 kB to 58.6 kB.

**Still open.** Unchanged: enforcement items are not matched by named institution to an FDIC cert;
the legal applicability hit rate is 1–2 items per run; `institution_watchlist` has a reader and no
writer. Still no browser confirmation — the Cursor browser tool cannot reach `localhost` here, so
the tab bar was verified by reading the served payload over curl. New: the institution profile
drawer shows a percentile measured against **the entire selected scope**, which for a small bank
means a comparison dominated by size — `peer-cohort.ts` exists to fix exactly that and is not wired
to it. That is the most obvious next improvement and it needs no new tab. Also worth noting: there
is no aggregate `npm test`, only 15 separate scripts, which is why suites have been missed before.
**All of this is on `dev`.**

---

## 2026-09-29 — the department is gone; two lenses become two tabs

"I don't like the department card approach. Let's go with something else." The decision taken was
to remove **the mechanism as a whole** — the header dropdown, the cookie, and the per-department
watchlist — and replace the storage half with one shared watchlist that has no department
dimension.

Removing it was the right call for a reason worth writing down. The department was a **preference
wearing the costume of an identity.** A non-httpOnly cookie anyone can edit from the browser
console is fine while it only decides which view you see; it had started deciding **which
watchlist you write to**, and that is a claim about who you are. The tool has one shared password
and no accounts, so there is exactly one team, and modelling several was inventing a distinction
the deployment does not have.

Two findings made the removal far less risky than it looked, and both were checked rather than
assumed. `department_watchlist` **has no writer anywhere in the codebase** — no interface ever
added to it, so it is expected empty; and `department-lenses` is **off in production**, so the
entire department layer was dark to production users. Nothing live was being taken away.

### What replaced it

The Executive Brief and Underwriter Workbench are now **ordinary tabs**, keyed `executive-brief`
and `underwriter-workbench` and gated independently, so one can be switched on without paying for
the other's cache warm. They lost nothing in the move: the two views only ever rendered above the
tab bar, and a tab is how everyone reaches them without first guessing which department they are.

Storage became `institution_watchlist`, keyed on `cert` alone. `ensureTable` carries any surviving
rows over, collapsing the composite key by earliest entry per cert. **The old table is not
dropped.** It is expected to be empty, but "expected" is not grounds for an irreversible statement
running off a cache-warming request; drop it by hand after looking.

### The regression this nearly shipped with

Removing the department made `app/page.tsx` **statically prerendered**, and that froze the feature
flags into the build. Nothing announced it. The page had been dynamic only as a *side effect* of
calling `cookies()` to read the department, and taking the cookie away took the dynamic rendering
with it — the build output flipped from `ƒ /` to `○ /`, one character, in a line nobody reads.

Two silent failures follow. Editing `ENABLED_TABS` in Vercel would appear to do nothing, which
`README.md` documents as the supported way to switch a tab on; and a build without the variable
ships **a tool with no tabs at all**. It was caught because the tab-render check returned HTTP 200
with every flag `false` despite the variable being set, and that mismatch was the only evidence.
`app/page.tsx` now declares `export const dynamic = "force-dynamic"` with the reasoning next to it,
because the next person to look will find no visible reason for the line.

`scripts/verify-lenses-visually.mjs` was quietly broken too — it set a department cookie to reach
each view. It clicks the tab now, and says so explicitly when the tab is absent, since the likely
cause is `ENABLED_TABS` rather than a broken view.

Verified: six tabs render with `grid-cols-6` and the flags resolve at **runtime**; 48 unit tests
pass; the applicability script still selects 13 of 85 Florida institutions on the 300% limb.
`TAB_GRID_COLS` is spelled out one class per count because Tailwind cannot see `grid-cols-${n}`,
so adding a tab means adding its column count.

**Still open.** Unchanged from the entry below: enforcement items are not yet matched by **named
institution** to an FDIC cert, which is where the distressed-seller signal lives and which doubles
as a fabrication check; the applicability hit rate is low and honestly so, 1–2 items per run. Still
no browser confirmation for the fourth session running — the Cursor browser tool cannot reach
`localhost` here, so the tab layout is verified by reading the rendered payload over curl, not by
eye. New and open: `institution_watchlist` has **a reader but still no writer**, so the watchlist
overlap on legal cards will read zero until something can add to it — the department model's
orphaned-capability problem survives its removal, in smaller form. `department_watchlist` is still
present in Postgres and should be dropped by hand. **All of this is on `dev`.**

---

## 2026-09-29 — the legal tab counts who a rule hits

Asked directly: "this is simply providing information, and telling us why it matters — how can we
make this tab actionable?" The observation was structural rather than cosmetic. Each card's last
field is literally called `whyItMatters` and is generated prose: it asserts importance without
demonstrating any.

The reframe that shaped everything below: **actionability cannot come from better writing.** The
tempting move is a "recommended action" field filled by the model, and it is the same fabrication
failure this feed went through this morning — worse, in fact, because an invented "this affects
your Florida banks" has nothing to click and check. So the tab now joins legal items to data we
already hold.

Cards carry the affected institutions, counted from FDIC call reports. The model reports what the
rule says about **its own scope** — an asset band, a concentration threshold, read off the rule's
"Applicability" section — and we resolve it. It is never asked which institutions are affected,
only what the document it cited says about who it covers, which is a question it can actually
answer from the page in front of it.

### The unit trap this nearly died on

`ScreeningRow` carries two things both called CRE concentration:

- `creConcentration` is CRE over **total loans**, and cannot exceed 100.
- `capitalRatios.creToTier1Tier2` is CRE over **Tier 1 + Tier 2 capital**, expressed as a multiple.

Every supervisory threshold — the 2006 interagency guidance and everything citing it since — is
measured against the second. Resolve a "300% of capital" rule against the first and it matches
**nothing, on every institution, forever**: no type error, no exception, no empty state, just a
confident zero that reads as a rule which happens to affect no one. The field is therefore named
`minCreToCapitalPct` for its units, and `npm run verify:legal-applicability` exists to fail if the
supervisory limbs return implausible counts against live data. On live Florida reports CRE over
loans peaks at 72% while CRE over capital peaks at 528%, which is the distinction made visible.

### Regulatory only, and that is conceptual

Asked of all three sections it produced nothing usable, for a reason wording could not fix. A
foreclosure statute applies to properties and lienholders, not to banks by size; a consent order
applies to the one institution it names. Asked anyway, the model reached for
`appliesToAllInstitutions` on Florida bills, which resolved to every institution in the state — a
large number carrying no information. So the instruction moved into the regulatory prompt alone.
Enforcement's actionable join is the **named institution**, matched to an FDIC cert, which is a
different mechanism and is not built.

One near-repeat caught before it shipped: the first draft put `"minCreToCapitalPct": 300` in the
prompt's JSON example. This feed has already returned a bill numbered `S. 1234` copied verbatim
from the prompt's own formatting example, so a literal threshold sitting in the template was the
same trap set again. It is now a placeholder sentence that cannot be mistaken for data.

### Where the join lives, and why not in the feed

Outside `fetchLegalUpdates`, in `resolveLegalApplicability`, for three reasons. Department must not
enter a cache key — a standing instruction in `docs/NEXT_VERSION_PLAN.md`, and the watchlist
overlap is per department. The two caches expire on different clocks: the feed is keyed to the
calendar day, screening to the published FDIC quarter. And the feed is one payload shared by every
visitor, while this is not. It also means an FDIC outage costs the exposure line and nothing else.

The universe is **Florida**, which is a correctness decision rather than a scope decision.
`getScreeningPayload("national")` fetches at most `TAB_ROW_CAP` rows across nine quarters, so
nationally it covers roughly the largest thousand of ~4,350 institutions — a denominator biased to
large banks in a way the reader could not see. Filtered to Florida the cap is never approached: 85
institutions from 876 rows, complete. Institutions missing the capital inputs (6 of 85) are
excluded from a concentration test rather than counted, so the number reads as "at least this
many", which is the honest direction to be wrong in.

Verified live: the 300% limb selects 13 of 85 Florida institutions — Ocean Bank, U S Century Bank,
International Finance Bank. 39 unit tests across the three legal modules. Build clean.

**Still open.** The hit rate is low and honestly so: 1–2 items per run state a usable scope test,
because most developments state no quantitative scope and the field is omitted rather than guessed.
That is correct behaviour but it means the feature is quiet, and the obvious complement is the one
not built — matching the institution **named** in an enforcement action to an FDIC cert, which is
where the distressed-seller signal actually lives and which doubles as a fabrication check, since
"Sunset Bank" would simply fail to match. Still no browser confirmation, for the third session
running: the Cursor browser tool cannot reach `localhost` here, so the exposure block is verified
by build, unit tests and live data, not by eye. **All of this is on `dev`.**

Also worth recording: the repo rule claims four files carry CRLF line endings. **About 190 tracked
TypeScript files do** — CRLF is the majority convention here, not the exception. The caution the
rule teaches is right and it caught a real 1,757-line diff this morning, but anyone trusting the
specific list of four will mangle a file and not know why.

---

## 2026-09-29 — making the legal feed useful, not merely truthful

Follow-on to the same day's work, on `dev` only. The source-verification guard shipped earlier had
left the Legal Landscape tab honest but thin, and it exposed three things the earlier fixes had
papered over. All four were asked for together.

**One 90-day window was being applied to three sections that do not move at the same speed.** The
Florida legislature sits roughly January to March and most session laws take effect on 1 July, so
for most of the year a 90-day window asks the Legislative Tracker about a period in which the
legislature did nothing. It went blank, correctly, and read as a bug. Windows are now per section
in `lib/legal-updates-sections.ts`: Legislative asks for 270 days and filters at 400, spanning a
full annual session cycle; Regulatory and Enforcement stay at 90/180 because agencies publish
year-round. The prompt also now tells the model about the session calendar, so out of session it
reports what the last session enacted rather than finding nothing.

**Nothing checked that an item had anything to do with commercial real estate.** The guard proved
a URL was real; it could not tell a CRE appraisal threshold from an overdraft fee rule.
`lib/legal-updates-relevance.ts` drops items with no CRE bearing, reading title, summary, why-it-
matters and status together. The bar is deliberately low — the prompt states the requirement and
does the real work, and this is the backstop, on the same reasoning as the dedupe: prompt
instructions alone have not held in this repo. Worth being straight about the evidence, though:
across 24 live items it dropped **zero**. The unit tests show it discriminates; production has not
yet given it anything to catch.

**The host allowlist was too narrow to let good items through.** Widened with `regulations.gov`,
NCUA, FHFA and Treasury for Regulatory; the Florida legislature and governor's office for
Legislative; FinCEN, NCUA and CourtListener for Enforcement. This is the lever to reach for when a
section looks thin — not the guard.

**An empty section vanished instead of saying anything.** The tab rendered only sections that had
items, so the previous deploy's empty Legislative Tracker left no trace beyond a note at the top
of the page that read like an error. All three sections now always render, and an empty one
carries its own explanation in place, distinguishing the two cases that were previously
indistinguishable: the feed found nothing, or the reader's own jurisdiction filter hid what it
found. The note names what was set aside and why — too old, off-topic, unverifiable — so a thin
section is legible as an answer.

Filtering also moved inside `collectSection`, which matters for the retry: previously the retry
gave up as soon as verification passed, then a later global pass could still discard the item for
age, and the section would end up empty with a retry already spent. Cheapest checks run first —
date and topic are local, source verification costs a fetch each.

Verified live three times: 6–9 items, 0 stale, 0 off-topic, 0–2 fabricated URLs caught by the
guard, Legislative populated on every run with March and June session bills that the old 90-day
window could not have seen. `npm run test:legal-filter` and the new `npm run test:legal-relevance`
pass, 24 cases. Build and typecheck clean. Cache key bumped to `legal-updates-v7`.

**Still open.** Not confirmed in a browser — the Cursor browser tool cannot reach `localhost` in
this environment, so the empty-state rendering is verified by build and by reading, not by eye.
This is the second session running where the tab has shipped without a visual check, and the
regression it caused last time was purely visual. **This is on `dev` and has not been merged to
`main`.** The relevance filter is unexercised in practice, as above. And the January question from
this morning still stands, now sharper: if the Legislative Tracker is thin *during* session, the
prompt is wrong, not the windows.

---

## 2026-09-29 (earlier) — a legal feed that did not know what year it was

Reported by email from a user: an item on the Legal Landscape tab "appears to repeat 5 times". It
did. Regulatory Watch showed the HVCRE final rule as five separate cards with identical summaries.

The model had returned it once per issuing agency — the joint rule reads "Federal Reserve, FDIC,
OCC" on the first card and just "FDIC" on the second — and `fetch-legal-updates.ts` concatenated its
three section results and returned them untouched. It was **the only AI-backed feed in the repo
without a dedupe pass**; `fetch-research-feed.ts`, `fetch-news.ts` and `fetch-public-mentions.ts` all
have one. Nothing downstream caught it either, because the synthesized `id` appends an array index,
so the five copies carried distinct React keys and rendered happily.

Deduping now happens on the merged list, keyed on the normalized title. **Not on the URL**, which
was the tempting choice and the wrong one: each agency mirrors a joint rule at its own domain, so
four of the five copies had distinct URLs and would have survived. The official title is verbatim
across all of them. The logic went to `lib/legal-updates-filter.ts` rather than staying in the
action, because the action is `"use server"` and imports `next/cache`, which makes it impossible to
exercise from a test — and an unverified dedupe is how this class of bug gets shipped twice.

The prompt now also states that an interagency rule is a single item, but that is belt-and-braces.
The repo's own history says prompt instructions alone have not prevented this kind of thing; the
programmatic guard is what holds.

### The second defect, in the same screenshot

The repeated rule was dated **2019-11-19** against a prompt asking for the past 90 days, so the
feed was also about seven years stale — something dedupe does nothing about. This was raised as a
product call rather than fixed silently, because filtering can empty a section and an empty
Regulatory Watch may read worse than an old one. The answer settled it: the point of the tab is to
know what is moving now, so stale content is not a lesser evil, it is the failure.

Stale items are now withheld. Three decisions inside that are not obvious:

- **The window is 180 days, not the prompt's 90.** The model dates items imprecisely, and a bill
  signed at the close of a Florida legislative session is still live well past 90 days. The filter
  exists to catch content that is not of this era at all, not to police the prompt.
- **Future dates are kept.** The news feeds reject anything future-dated; here an effective date or
  a scheduled floor vote is exactly the "what is coming" the section is for. Only the past is
  bounded, and the two must not be unified later on the grounds that they look alike.
- **An unparseable date is kept, which makes the parser's strictness a safety property.** `Date.parse`
  pulls a year out of prose and pins it to January 1, so "Fall 2026" becomes 2026-01-01 — nine
  months early, and early enough to withhold a live item once we are past mid-2026. Found by a test
  that expected "sometime in 2019" to be unparseable and got 2019-01-01 back. The parser now takes
  `YYYY-MM-DD` and formats naming a specific day, and refuses the rest.

When the filter empties a section the feed says so, because sections with no items are not rendered
at all and an emptied Regulatory Watch would otherwise just disappear.

Cache key bumped to `legal-updates-v4`. Without that the fix would be invisible — Vercel's Data
Cache survives deploys, so production would keep serving today's already-duplicated entry until
midnight ET.

Verified by `npm run test:legal-filter`, 17 cases built from the exact five-card payload the user
saw, including an explicit assertion that URL-keyed dedupe would have kept four of them. Build and
typecheck clean.

### The filter emptied the tab, which was the correct answer to the wrong question

Deployed, and Legal Landscape rendered nothing at all: three notes saying 1, 3 and 3 older items
had been withheld, and "No items match the selected filters." Every item the feed produced was
stale. The filter was right; the feed was in far worse shape than the duplicate report suggested.

**The model does not know what day it is.** Asked for "the past 90 days" it measures from its own
training cutoff. Calling the live API with the production prompt shows it plainly — it searched
`after:2024-03-01` and returned interagency guidance dated 2006, 2015 and 2023. The 2019 rule in
the original report was not a fluke, it was this. And nothing in the code hints at it: the prompt
reads exactly like a request for recent material.

Worth recording how the diagnosis went, because guessing would have produced a worse fix. A sanity
query proved the search index has content from this month, which ruled out the tool being broken
and pointed at the prompt. Then four variants against the live API:

| Variant | Result |
| --- | --- |
| Production prompt | 4 items, dated 2006–2023 |
| + today's date | `{"items":[]}` — one broad query, nothing it would vouch for |
| + search named sources by month | **5 items, all inside 90 days** |
| Same, on full `gpt-4.1` | 1 of 5 fresh — the larger model was *worse* here |

So the date is necessary and not sufficient; the model also has to be told to search agency
newsrooms by name and month. Both halves are now in the prompt and both were measured. A forced
`tool_choice: {type: "web_search"}` was tried and discarded — it sends the entire prompt as the
search query.

Prompts moved to `lib/legal-updates-prompts.ts` so `npm run verify:legal-freshness` can run them
for real. That script is worth more than any unit test here, since the failure is invisible in the
source. Three consecutive runs: 82–83% of items inside the window, 11–12 rendering, against zero
before. It fails the process if the tab would be empty or under 60% is in-window.

One harness lesson: an early run showed every variant returning nothing, which looked like a dead
API. The diagnostic was reading `data.output_text`, which the Responses API often omits —
`lib/openai.ts` has a fallback for exactly this and the throwaway script did not. Nearly chased a
non-existent bug.

### "Is this bringing in actual legislation?" — no, it was inventing it

Asked that directly, and checking rather than assuming was the whole value of the question. Ran the
three prompts and fetched every URL they cited. Regulatory resolved 4 of 4. Legislative and
Enforcement resolved 1 of 7 between them.

What the Legislative Tracker actually returned:

- **"Homeownership Promise Act — S. 1234."** That bill number is copied verbatim from the prompt's
  own formatting example, `e.g. SB 1234 — Florida Senate`. The prompt was feeding it the answer.
- **"Live Local Act 2026 Update — HB 1389"**, dated exactly the 90-day cutoff, linked to Florida
  Statute 714.09 — "Status of receiver as lien creditor", enacted 2020, unrelated.
- **A Federal Reserve rate decision**, filed as legislation, cited to a loan broker's blog.
- **"Ratepayer Protection Act — H.R. 10322"**, whose URL 404s.

Enforcement was worse: consent orders against "Sunset Bank" and "Liberty Bank", Chapter 11 by
"Downtown Plaza Mall", every URL assembled from a pattern and none of them real. For a
distressed-debt reader those are not low-quality items, they are actionable-looking fiction.

**A correction to what I reported earlier today.** The 82–83% "in-window" figure measured only
whether the date *string* fell inside the window, and the clustering of items on exactly
`2026-07-01` — the cutoff — was the model back-stamping old law to satisfy the instruction. The
prompt fix was real and Regulatory Watch genuinely improved, but that number said much less about
quality than I implied.

So an item now renders only if its URL is a listed primary source **and** that URL loads. Both
halves are needed, which took a couple of passes to get right:

- Checking only that the link resolves admits trade press and law-firm briefings. They resolve
  perfectly well, which makes them indistinguishable from a real citation to a link check.
- Checking only the host admits URLs constructed on the right domain. The recurring one is
  `federalreserve.gov/newsevents/pressreleases/2026-press20260924a.htm`, the exact shape of a
  genuine Fed release.
- Naming the permitted domains **in the prompt** took provenance from 38% to 100%. Without it the
  model cites the commentary it found the item through, and the guard then discards a real
  development for want of a link.

Two false starts worth recording. Domain-restricted search via `searchAllowedDomains` looked like
the obvious answer and is not: it forces `gpt-4.1`, which returned one item for legislative and
none for enforcement. And the first pass at anti-fabrication wording stacked up so many
permissions to return nothing that recall collapsed to zero items across all three sections — the
model took the exemption rather than the work. It now has to search before it may report nothing.

Sections retry once when nothing survives verification, because the failure is erratic rather than
steady: a fabricated URL on one attempt, the real page on the next. Four consecutive runs after
that: 2–8 items rendering, all verified, never empty.

The verify script grew two better gates in the process. It now asserts the guard does not leak and
that fabrication stays under half, rather than scoring the model's raw output — and it measures
age against the filter's 180-day window rather than the prompt's 90, since an OCC order from four
months ago is a real development that renders, and failing it only measured the gap between two
numbers I had chosen myself.

**Still open.** Not confirmed in a browser after deploy. Legislative and Enforcement will now
sometimes be empty with a note, which is the honest answer while Florida is out of session but is
worth watching — if Legislative is still empty in January the prompt, not the guard, is wrong.
`gpt-4.1-mini` remains the model; it beat `gpt-4.1` on both freshness and recall here, which is
worth remembering before anyone "upgrades" it.

Also: the `ROLLBACK.md` current-state table was stale again on arrival — it named `8844bea` for
production when `main` was actually at `996efa9`, with the tab-persistence fix already shipped.
Corrected, but it has now drifted twice in three sessions, so the table carries an instruction to
verify with `git merge-base` rather than trust the previous entry.

---

## 2026-09-10 — tab switches were reloading everything

Reported as the page reloading its data on every tab or page change, which it was, for a reason
unrelated to the server-side caching worked on the day before.

Radix unmounts inactive tab panels. Leaving Market Analytics and coming back destroyed the panel and
refired every data effect in it: the screening payload, the chart series and the map data all
refetched, and the region filter, sort order and selected institution reset. The server caches made
that cheap but never free, and no amount of server-side work would have fixed it — the request was
being made again each time by design.

Panels are now force-mounted once visited. **On first visit, not up front** — force-mounting
everything immediately would fire all four tabs' fetches on page load, trading a repeated cost for a
worse initial one.

Two things came with that which were not obvious from the outside:

- **`forceMount` makes Radix stop hiding the panel.** It derives `hidden` from its own `present`
  flag, which `forceMount` forces true. Without a `data-[state=inactive]:hidden` class on the panel,
  every visited tab renders stacked on the others. Caught by reading the Radix source before
  shipping rather than by seeing it break.
- **That hiding is `display: none`, which collapses the map container to 0x0.** MapLibre caches
  canvas dimensions and does not observe its container, so the map returned blank. A ResizeObserver
  now calls `resize()` when the container regains size.

Verified in a real browser by `verify:tab-persistence`, which covers all three failure modes: zero
server actions on a tab round trip, exactly one visible top-level panel, and a map canvas that still
has dimensions. Measured 1,010 rows still rendered on return, zero server actions, canvas 974x420.

**A trap worth knowing for local testing.** `npm start` sets `NODE_ENV=production`, which makes
`isFeatureEnabled` fail closed, so a local production server renders **no tabs at all** unless
`ENABLED_TABS` is passed explicitly. That cost a debugging cycle: sign-in succeeded and the header
and Market Pulse rendered, so it looked like a selector problem rather than a configuration one.

**Still open.** A full page reload still refetches, which is inherent — the server caches make it
fast, but nothing survives a reload except the three research components that use `sessionStorage`.
The screening payload is 1.26MB and the chart series 0.59MB, which is why they were not added to
`sessionStorage`: ~1.9MB risks the quota and could evict the caches that are already there. Also
carried forward: the CSV and PDF exports still pay the full ~22s pagination, and no other tab has
been audited for the daily-refetch or oversized-cache patterns.

---

## 2026-09-09 — the other half of the Market Analytics slowness

The tab was still slow after yesterday's fix, and the cause was a second, larger instance of the
same pattern sitting on the same page.

The **Visual Analysis panel** mounted eagerly and called `buildReportData`, which paginates the
entire national cohort out of FDIC — five sequential requests, 31MB raw, **21.6s measured** for
4,607 institutions. It was nominally cached and never actually cached: the `ReportData` it produces
is **5.46MB** against Next's 2MB entry ceiling, so Next refused the write and the full 21.6s ran
again on every mount. The docstring on `buildReportData` had anticipated exactly this — "a national
payload may exceed the 2MB data-cache entry limit, in which case Next skips the write" — but nobody
had put a number to it, so it read as a caveat rather than a live bug.

**Why yesterday's work did not cover it.** The field inventory established that the charts fetch
independently of the screening table. That was read as reassurance — trimming the table could not
break the charts — when it also meant the charts kept their own uncached path, unmeasured.

The panel only ever used four derived series, and three are tiny: ten histogram bins, twenty ranking
bars, fifteen mix bars. Only the scatter scales with the cohort, at six numbers per institution.
Deriving them on the server gives **0.59MB**, 9.2x smaller with 1.41MB of headroom, so it caches and
the cron warms it. The derivations are not reimplemented — `lib/analytics/visuals.ts` calls the same
builders the PDF path calls, because screen and PDF disagreeing is what produced the deleted
capital-analytics-viz component. Fetching is also deferred until the panel nears the viewport, since
it sits below the table and was making everything above it wait.

Verified by `npm run verify:visuals-payload`, which asserts the payload clears the ceiling and that
rounding moved no plotted value: 22,087 comparisons nationally, 572 for Florida.

**The lesson worth carrying.** An oversized cache entry is not an error. Next logs `Failed to set
Next.js data cache` and silently recomputes, so the only symptom is a slow page — which is how this
survived a fix aimed squarely at it. Both Market Analytics caches are one careless field away from
the same state, which is what the two verify scripts now guard.

### Then: caching to the publication schedule rather than to a clock

Prompted by the observation that these are quarterly reports, so why re-fetch daily. That was right,
and the numbers were worse than they looked: both heavy caches expired every 23 hours, so the tool
re-paginated 31MB and recomputed 22 seconds of work about **ninety times a quarter** to arrive at an
identical answer.

Both cache keys now carry the quarter FDIC has actually published, from a probe costing one row, 266
bytes and 0.45s, itself cached for six hours. The expensive work is keyed to the data instead of to
a timer: a new quarter changes the key and triggers exactly one recompute. The timers stay, stretched
to a week, only to catch amended call reports — banks refile and FDIC restates prior quarters, over
weeks rather than hours.

**A correction to something stated earlier in this session.** Vercel's Data Cache persists across
deployments; it is isolated per environment but shipping does not empty it. The advice given here
that a fresh deploy means an unavoidable cold start was wrong. It also means changing a `revalidate`
value does not retune entries that already exist — they keep the window they were written with — so
a window change only takes effect on a new key or after a purge.

The probe is load-bearing and fails silently, which it promptly demonstrated: FDIC nests each row
under `data`, `fetchFDICData` flattens it, and the first implementation read the nested shape, got
`undefined`, and fell through to the date-derived fallback with no error at all. The tool would have
looked perfectly healthy while keyed to a quarter FDIC never confirmed. `verify:latest-quarter` now
guards it.

**Still open.** The CSV and PDF export paths still pay the full ~22s pagination, which is acceptable
because they are user-initiated downloads, but it is the same uncacheable 5.46MB payload underneath.
No other tab has been audited for this pattern. The national coverage gap on the screening table is
also unchanged: the table still shows the largest ~1,100 of ~4,450 institutions, while the charts
above it now cover all ~4,600 — a discrepancy worth being aware of when reading the two together.
Nothing on `dev` has reached production yet.

---

## 2026-09-08 — why Market Analytics was slow, and what fixed it

The tab took several seconds on **every** visit, not just a cold one, and the cause was structural
rather than incidental. It fetched about 10,000 raw FDIC rows per load — nine or ten quarters of
history for roughly 1,100 institutions — shipped 10.8MB across the server-action boundary, and
collapsed it to one row per institution in a `useMemo`. None of that was cached, and correctly so:
`lib/fdic-client.ts` skips the Next data cache above 5,000 rows because a response that size exceeds
the 2MB entry limit. So every visitor paid the full ~5.8s FDIC round trip, measured and repeatable.

**Caching alone would not have fixed it, which is the part worth remembering.** Reduced to one row
per institution the payload is still 2.26MB, over the ceiling. Rounding the numbers barely helped —
2.26MB to 2.00MB — because the bulk is repeated field *names*, not digits. What got it under the
line was dropping the fields nothing renders: the capital dollar inputs that exist only to produce
`capitalRatios`, the `CapitalRatios` internals the table and drawer never read, and three of the
five values in each trend quarter. That lands at **1.26MB**, so the entry caches, and the daily cron
now pays the FDIC cost once instead of every visitor paying it every time. The browser also stops
reducing and scoring 10,000 rows on each render.

Verified by `npm run verify:screening-parity`, which reimplements the old browser reduction and
compares every rendered field per institution against the new module — 51,510 comparisons
nationally, plus Florida and Texas, all matching. Scores, KPIs, trends and capital ratios are
unchanged. The 2MB limit was read out of Next's source rather than assumed.

**A separate latent bug surfaced while measuring.** The FDIC base URL was the bare host while every
endpoint carried an `/api/` prefix, so the configured fallback resolved to
`api.fdic.gov/banks/api/financials` — a 404. `fetchFDICData` treats 4xx as unrecoverable and stops
instead of trying the next host, so the documented two-host protection would have turned a primary
outage into empty data. It had never worked. The prefix now lives in the base, `api.fdic.gov` is
primary because the old host 301s to it, and `npm run verify:fdic-hosts` checks all eight endpoints
on both. Worth knowing: that redirect means the fallback is an *alias*, not a second independent
host, so it will not survive an api.fdic.gov outage.

**Shipped to production** the same day, `main` at `27ef6f1`. The tab was checked in a browser before
the merge. Nothing about the department lenses changed: they remain gated on `department-lenses` in
`ENABLED_TABS`, which production has never had set.

**Still open.** The national coverage gap is untouched: the tab still shows the largest ~1,100 of
~4,450 institutions, and closing it projects to about 5.5MB of cache entry, which needs a different
store rather than more trimming. The first visit after any deploy still pays the ~6s FDIC fetch
unless the warm-cache cron reaches it first.

---

## 2026-09-08 — the corrections finally reach production

**`main` moved for the first time since 2026-08-21**, from `e8bf8ad` to `7d74797`, carrying 55
commits. The decision recorded on 08-28 not to merge was reversed once the question was separated
properly: the accuracy fixes and the department lenses were only ever coupled by being on the same
branch, and the gate built on 08-28 is what let them be uncoupled without rewriting history.

What reached users:

- **The corrected CRE definition.** Production had been double-counting `LNREOTH` and including
  owner-occupied non-residential property, which inflates the very ratio the 300% supervisory screen
  is measured against. This is the most consequential of the three.
- **The corrected capital ratios.** A bank reporting 113.99% had been displaying as 1.14%, because
  the `normalizePercent` basis-point heuristic treated any value above 100 as needing division.
  Strongly capitalised institutions had been rendering as failing ones.
- **Market Analytics** — real Opportunity, Earnings and Vulnerability scores in place of columns of
  zeros, on percentile ranking rather than min-max, plus the audited FDIC columns.
- **Market Pulse**, which did not exist in production at all: 21 FRED series on a continuous crawl.

What did not, and deliberately: the three department lenses. Their code is deployed but unreachable,
because `isFeatureEnabled` fails closed in production and `department-lenses` is absent from
`ENABLED_TABS`. The bank stress map stays dark for the same reason under its own key — worth knowing,
since it is otherwise easy to assume the visual work shipped whole.

Verified before merging: all twelve test suites, a clean production build, and a direct assertion
that the flag resolves false under production's exact `ENABLED_TABS` *and* when the variable is
unset, so the failure mode is hidden rather than visible. Verified after: the Production deployment
for `7d74797` registered `success` and the live alias serves 200. **Not** verified: the live
dashboard was not opened, so the gate's behaviour in production rests on the flag assertion plus the
end-to-end browser check done on 08-28, not on looking at the deployed page. Worth closing next time
someone signs in.

The gate itself is unchanged and still `3417025`; turning the lenses on remains a Vercel setting
rather than a deploy.

**Accounting & Finance has been removed as a department** (`d3f7973`). It was the one group whose
lens was never started, so listing it in `DEPARTMENTS` offered a choice that resolved to nothing.
`DEPARTMENTS` is now `underwriting`, `origination`, `executive`. Nothing else in the codebase
referenced it, so the removal is confined to `lib/department.ts`; a cookie still holding `"finance"`
fails `parseDepartment` and reads as no choice, which is the honest outcome rather than an empty
view. `docs/NEXT_VERSION_PLAN.md` is amended rather than rewritten — the dropped row is struck
through so the record of what was considered survives.

Verified by type check and build only, not by rendering: the change removes one entry from a const
array that feeds a `.map()` and a membership test, with no branch that could behave differently, and
both consumers were exercised by the gate verification minutes earlier.

---

## 2026-08-28 — shipping the fixes without shipping the lenses

`dev` had reached **50 commits ahead of `main`** without a single one reaching production, and the
review of what they contained is what changed the decision. The department lenses are not finished
and should not go live. But the same 50 commits carry the corrected CRE definition, the capital-ratio
fix, five misread Market Analytics columns, the CBLR zero-versus-absent trap and the percentile
scoring rework — and `origin/main` was verified to have **none** of them: `lib/fdic-cre.ts` does not
exist there and `normalizeCapitalRatioPercent` appears zero times in its copy of
`lib/format/metrics.ts`. So holding the merge to protect unfinished work meant continuing to serve
overstated CRE concentration and capital ratios divided by 100 to people using the tool.

The dependency only runs one way. The lenses need the corrected FDIC maths; nothing else needs the
lenses. **So the lenses ship dark instead of being held back**, behind a `department-lenses` feature
key. It gates the selector and both lens renders, and because `isFeatureEnabled` returns true outside
production, the preview is unaffected and remains the place to keep building them. Turning them on
later is a Vercel environment change, not a deploy.

The flag resolves to **one** value in the dashboard — `features.departmentLenses ? initialDepartment
: null` — rather than being tested at each of the three render sites. That is deliberate: the
department cookie is written by the client and outlives the flag, so a browser that picked a
department on the preview would otherwise carry a lens into production through a stale cookie. The
post-deploy warm skips the two lens caches on the same flag, where it would otherwise spend a couple
of minutes of FDIC calls per deploy filling a cache nothing can read.

**Verified by rendering, in both modes.** With `VERCEL_ENV=production` and a `department` cookie
already set to `executive` and then `underwriting`: no selector, no brief, no workbench, tabs and the
Market Pulse tape unaffected, no page errors. In dev mode with the same cookies: selector present and
the correct lens for each. Two traps worth recording. Running two `next dev` servers at once to
compare modes side by side **does not work** — they share one `.next` directory and destroy each
other's build artifacts, which surfaces as a 500 on `/api/auth` and reads exactly like a wrong
password. And a lens needs the better part of a minute cold, so a check that samples the DOM after
three seconds reports a skeleton as an absent lens.

**State now.** Twelve suites, 155 assertions, all passing. `npm run build` clean, `npx tsc --noEmit`
unchanged at 74. Gate committed as `3417025`.

**Still open.** As below. The merge described here was declined on the day and then carried out on
09-08 — see the entry above. `department-lenses` is deliberately absent from production's
`ENABLED_TABS` and should stay absent until the lenses are ready. Origination Targeting is still to
build; Exposure & Reporting no longer applies, since the department it served has been removed.

---

## 2026-08-25 — nineteen series on the tape, and a survey that is not a rate

Asked directly: bring in other data relevant to real estate. Thirty-five candidate FRED ids were
resolved against the live CSV endpoint before anything was written, with each one's frequency read
off the observations it returned rather than assumed. **Fourteen were added, taking the tape from
five series to nineteen**, grouped so a reader gets a coherent sweep: CRE credit (delinquency,
charge-offs, $3.12T outstanding, banks tightening, resi delinquency), the cost of money (SOFR, prime,
2Y, 10Y, 10Y–2Y, real yield, 30Y mortgage), the price of credit risk (IG and high-yield spreads), and
property fundamentals (rental vacancy, multifamily starts, permits, Case-Shiller, nonresidential
construction).

**Two things could not be had, and both are recorded above `PULSE_SERIES` so nobody repeats the
search.** FRED publishes no multifamily-only delinquency series — every plausible id 404s, and that
is the figure a CRE tape would most like after price. And `COMREPUSQ159N`, its US commercial property
price index, last published an observation in **April 2025**; it is sixteen months stale and reports
a percent change rather than a level, so a CRE price index is simply not available from this source.

Four units were added to `SeriesUnit`, and one of them is an accuracy fix rather than formatting.
`SUBLPDCLCTSNQ` is a **net percentage of surveyed banks** tightening construction and land
development standards, and it sits near zero — it moved from 2.0 to 4.4 this quarter. Through the
existing `percent` path that would have printed **"up 240 bps"**, which states a survey result as if
it were a price; through the level path it would divide by a base that is routinely zero or negative.
So `net-percent` prints like a percent and moves in percentage points. The other three —
`usd-millions` for Census construction spending, `units-thousands` for starts and permits, `index`
for Case-Shiller — are mechanical.

Wiring that up surfaced a latent duplication worth naming. `fetch-market-pulse.ts` carried **its own
copy** of the unit-to-wording routing that `verified-metrics.ts` kept private. With two units the two
copies agreed and the duplication was invisible; with six they would not have, and the new series
would have been mis-worded on the tape while reading correctly in the outlook memo — the exact class
of silent divergence this strip was built to prevent, since its whole point is that a figure here and
a figure in Key Signals cannot disagree. `describeChange` is now exported and both call it.

Three labels changed after reading the rendered output rather than the code. "CRE Standards" beside
"4.40%" reads as an interest rate, and is now "Banks Tightening CRE"; "Home Prices" beside a bare
"335.1" does not say the figure is an index; "CRE Loans O/S" was needless jargon.

Crawl speed went from 40px/s to 90px/s in the same commit, because nineteen series make a 6,800px
sequence and a lap had stretched to **two minutes fifty-one seconds** — long enough that waiting for
one particular figure is not viable. Worth internalising: **adding series makes this tape slower, not
busier**, which is the opposite of the intuition, so the speed constant needs revisiting whenever the
list grows.

**State now.** All nineteen verified against a running server by reading the rendered figures, not
by trusting the build: every value matches what the endpoint returned during the probe, every tile
carries a sparkline and an as-of, and there are no console errors. Twelve suites, **155 assertions**,
up from 151. `npm run build` compiles clean; `npx tsc --noEmit` unchanged at **74**. Committed as
`56cfbd0`.

**Still open.** Unchanged from the entry below. One addition worth watching: the tape now issues
nineteen concurrent FRED fetches on a cold cache rather than five. Each has a six-second timeout and
a failed series is simply absent rather than fatal, so throttling degrades the tape quietly instead
of breaking it — but if series start disappearing intermittently, that burst is the first place to
look.

---

## 2026-08-25 — the market pulse as a crawl

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
