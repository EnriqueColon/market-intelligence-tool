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

**`app/page.tsx` declares `export const dynamic = "force-dynamic"`, and that is load-bearing.**
`isFeatureEnabled()` must run per request, so editing `ENABLED_TABS` in Vercel takes effect without
a redeploy. Nothing else on the page forces dynamic rendering any more: it used to call `cookies()`
to resolve the department, which opted out of static rendering as a side effect, and when the
department was removed on 2026-09-29 the page became statically prerenderable and the flags froze at
build time. Two silent failures follow from that — a variable edit appearing to do nothing, and a
build without the variable shipping a tool with no tabs at all. Do not remove the declaration
without replacing it with something else that forces per-request rendering.

The same list also gates content *inside* a tab. `app/page.tsx` resolves those into a `features`
object passed down to the dashboard, because `isFeatureEnabled()` reads server-only env and
everything below it is a client component. The only entry is now `bank-stress-map`.

**The Executive Brief and Underwriter Workbench are unreachable, by decision.** They are not in
`TAB_DEFS`, so no `ENABLED_TABS` value renders them — a flag is not the mechanism holding them back
and adding one will not help. `enabledTabs` carries four keys only.

The history matters because the question has been settled twice in two days. They began as "lenses"
revealed by choosing Executive / Accounting / Underwriting from a header dropdown that wrote a
cookie, behind a `department-lenses` flag. The department went on 2026-09-29, because it was a
preference and not an identity: one shared password, no accounts, so the cookie only decided which
view you could find while pushing a department value into the cache key of anything that read it.
They became ordinary tabs — and the tabs went on 2026-09-30, on the stated grounds that the tool
should be more informative and actionable rather than grow more places to visit. A destination you
have to decide to enter is one nobody enters, whether the door is a dropdown or a tab.

What remains and what does not: the two components in `components/lenses/`, their server actions,
and their five calculators in `lib/scoring/` are all still present, and the calculators still carry
39 passing unit tests. Nothing calls any of it. The routing that handed an institution from either
view to the Market Analytics drawer is also gone from the dashboard, though `MarketAnalytics` keeps
its optional `focusCert` / `onFocusResolved` props so a future caller need not rebuild it.
`app/api/cron/warm-cache/route.ts` no longer warms either, which it must regain if either is ever
surfaced — each pulls nine quarters for every institution the row cap allows, roughly fifty seconds
cold.

The tab bar derives its column count from the number of enabled tabs, via `TAB_GRID_COLS`. It was
previously hardcoded to `grid-cols-4`, so production — which runs three — rendered an empty fourth
cell. The map is spelled out one class per count because Tailwind only ships classes it can see in
the source; `grid-cols-${n}` compiles to nothing. **Adding a tab means adding its column count**;
the map runs to four, which is every tab that exists.

| Tab | Feature key | What it shows |
| --- | --- | --- |
| News | `news` | Industry Outlook / Key Signals memo (`industry-outlook.tsx`), Industry-Specific News (`public-mentions.tsx`), General Finance News (`investing-business-mentions.tsx`), and an on-demand Article Digest (`article-digest.tsx`) |
| Market Analytics | `market-analytics` | FDIC bank financials with state filter, institution drawer and export (`market-analytics.tsx`); a Visual Analysis chart section (`market-analytics-visuals.tsx`); a Bank Stress Map behind `bank-stress-map`; plus a nested FRED/Census indicator panel (`market-research.tsx`) |
| Market Research | `market-research` | Live publisher-by-publisher research feed with Postgres-backed archive (`market-research-feed.tsx`) and memo generation (`research-memo-modal.tsx`) |
| Legal Landscape | `legal` | Three sections — Regulatory Watch, Legislative Tracker, Enforcement & Litigation (`legal-updates.tsx`) — drawn from the Federal Register, govtrack and LegiScan where a record exists, and from a model with web search where it does not |

Production currently runs `ENABLED_TABS=news,market-analytics,market-research` (plus `legal` where
enabled) — confirm the live value in Vercel rather than trusting this line. Those four are now the
only tabs that exist, so the production bar and the local one no longer differ in composition.

The news feeds merge all three geographies (national, Florida, Miami) into one list. The region
selector was removed in `984a361`; the underlying per-region feeds still exist and are fetched
concurrently, then merged and sorted by access tier and date.

Both news feeds source from Google News RSS queries plus direct publisher RSS (GlobeSt, Bisnow,
Commercial Observer, The Real Deal, CRE Daily, Trepp, Miami Herald for CRE; CNBC, Reuters, Bloomberg
for finance), and fall back to the **GDELT DOC 2.0 API** when RSS yields fewer than 15 items. The two
actions carry near-duplicate fetching logic, so a parsing bug tends to need fixing in both — as
happened with the CDATA regex.

### Legal Landscape: two prompts, one record, and five gates

Federal legislation is **not** model-generated. `lib/legal-updates-legislation.ts` reads it from
govtrack, and the model is only asked to explain bills it is handed. Everything below about prompts
and fabrication applies to Regulatory, Enforcement and Florida legislation; see "why the
Legislative Tracker stopped asking" further down for why that section is different.

`fetch-legal-updates.ts` runs the Regulatory, Legislative and Enforcement prompts concurrently
against OpenAI with web search on. Each section's results pass through age, CRE relevance and
source verification on their own before the three are merged and deduped. A section that fails
returns an empty array rather than throwing, so one bad prompt degrades that section only. One
`new Date()` is taken per run and passed to both the prompts and the filters, so the two cannot
disagree about what "recent" means.

The gates run cheapest first — age and relevance are local string work, source verification costs
an HTTP fetch per item — and they run *inside* the retry rather than after it. Filtering after the
retry means a section can spend its retry on items that a later pass then discards, ending up
empty with nothing left to try.

**Each section has its own freshness window**, in `lib/legal-updates-sections.ts`, which is also
the single source of the section list and its display labels.

| Section | Prompt asks for | Filter allows |
| --- | --- | --- |
| Regulatory Watch | 90 days | 180 days |
| Legislative Tracker | 270 days | 400 days |
| Enforcement & Litigation | 90 days | 180 days |

Legislative is wider because the Florida legislature sits roughly January to March and most
session laws take effect on 1 July. For most of the year a 90-day window asks it about a period
in which the legislature did nothing, and the section went blank. The prompt carries the same
session calendar, so out of session the model reports what the last session enacted and any
interim committee activity rather than finding nothing. Widen the window and leave the prompt
alone and the model will still only look at the current month; the pair is what works.

**Items with no bearing on the firm's operations are dropped**, by
`lib/legal-updates-relevance.ts`. Two questions, because they fail differently: is it on topic, and
is its subject an institution, a rule or a case rather than one person?

The gate reads **title, summary and status — never `whyItMatters`**. It used to read that field
too, and that made it self-defeating. The prompt instructs the model to write `whyItMatters` about
"relevance to distressed CRE debt investing", so every item arrived carrying its own relevance
certificate and the gate passed almost everything. The item that exposed it was
`OCC Enforcement Action: Danny Seibel Prohibited from Banking Activities`, admitted on a
`whyItMatters` reading "can affect how lenders manage their CRE loan portfolios" while its title,
summary and status mentioned nothing of the kind. `summary` is still read, because the prompt asks
it to describe what the document changes — reporting rather than argument — and an enforcement
action is often titled with nothing but an institution's name.

**Actions against individuals are dropped whatever else they say.** Removal-and-prohibition orders
under 12 U.S.C. 1818(e) can only be issued against a person, so the phrasing identifies them
without any attempt to classify names — which would misfile institutions named after their
founders. The conduct behind such an order often involved the CRE book, and it is still a ruling
about one person's employability, so topic alone must not carry it.

**A regulator's monthly roundup is admitted as one item, on its own.** The OCC and FDIC announce
most enforcement actions only this way — "OCC Enforcement Actions for July 2026", "FDIC Makes
Public August Enforcement Actions" — one page per month listing every order, and there is no
per-action release behind it to cite instead. Judged as an ordinary item a roundup fails both
questions above for reasons unrelated to its contents: its title names a month rather than a
subject, and its summary almost always mentions that month's prohibition order. Live, that dropped
every roundup the model found and correctly cited, and the section had nothing from either
regulator. `isEnforcementDigest` recognises the form — a month name together with "enforcement
actions", in the title only — and `bearsOnFirmOperations` passes it before asking anything else.
The Enforcement prompt tells the model to report each roundup as one item under the regulator's own
title, summarise the page as a whole, and name no individual. A single action the model has pulled
out of a roundup ("OCC Enforcement Action Against United Texas Bank") is not a roundup and is
judged on its own terms, so a BSA/AML order is still off topic and a prohibition order is still
about a person. The asymmetry is deliberate: the page is the section's own subject, and what it
contains that month is for the reader to see there rather than for a term list to guess at.

**A roundup's page is read, not recalled.** The model finds the page and cites it; it does not read
it, and its summary of a page it had not read was what the model remembered of it at search time —
"highlights the OCC's commitment to maintaining integrity in the banking sector". Once source
verification has confirmed the page exists, `readEnforcementPages` fetches it, `htmlToText`
(`lib/legal-updates-pages.ts`) keeps the `<main>` region with each list item on its own line, and
the model is asked — `buildDigestDetailPrompt` — to say what the page lists and nothing else: a
summary with counts and the institutions named, one `details` bullet per action against an
institution (type of order, institution, city and state, the deficiency), and a "why it matters"
that is allowed to say there is nothing here for a note buyer. Individuals are counted and never
named, inside the list as outside it. The FDIC's releases give counts by type of order and link to
a separate list rather than naming institutions; the prompt tells the model to report the counts
and point at the list rather than guess. The OCC's pages run to a few hundred words; the cap is
3,000. Live, the OCC's July page yielded six institutional lines — one cease-and-desist and four
terminations of earlier orders, which is the kind of thing a lender's workout team wants to know
about a counterparty bank — and September's yielded the honest "two prohibition orders against
former employees; nothing here bearing on note purchases". A page that cannot be read leaves the
item as the model wrote it.

**Every term is anchored.** Bare substrings are not a style preference here: `lien` matched
"client", "clients", "resilience" and "salient", and `tenant` matched "lieutenant" — four false
positives in fifteen sample .gov headlines. `default` is qualified (`loan default`, `payment
default`) because alone it matched "default judgment" and "by default".

**Residential and land-use policy is out of scope by decision**, not oversight. `housing`,
`affordable housing`, `eviction`, `landlord`, `tenant`, `property tax`, `zoning` and `land use`
admitted HUD homelessness grants and residential tenancy bills, which crowded out commercial
items. `multifamily` stays, being an asset class here rather than housing policy. If someone wants
commercial landlord-tenant coverage back, add the commercial-qualified forms rather than the bare
words.

### Legal Landscape: the one thing that outlives a day

Everything else in this tab is a cache keyed to the calendar day with a 25-hour life. It is
regenerated each morning by the cron, and **there is no table for legal items** — so yesterday's
feed does not exist anywhere. That is a deliberate design for a news feed and it made the
"Legislative Tracker" a misnomer: it could report that H.R. 7730 was at "Passed House & Senate" and
was structurally unable to report that it had been in committee the week before, which is the only
thing in the section a reader cannot get by opening the bill.

`bill_status_history` is the minimum that fixes it: one row per bill, holding the status last seen
and the one before it. Deliberately **not** a full action history — govtrack publishes that, and a
second copy of a public record is a synchronisation problem in exchange for nothing.

`lib/legal-updates-movement.ts` holds the comparison and `app/actions/bill-status-tracking.ts`
holds the storage, split so the part with the logic can be tested without a database.

Three behaviours that are decisions rather than accidents:

- **A first sighting reports no movement**, not "new". The table starts empty, so the first run
  after a deployment would otherwise flag every bill, and a bill introduced eight months ago is not
  news. "First seen by this tool" is a fact about the tool, not the legislation.
- **A transition keeps showing until the bill moves again**, rather than only on the day it
  happened. Someone who checks weekly should not have to have been watching on the right morning.
- **Re-running cannot consume a movement.** The feed regenerates on a cron and again on demand; if
  the second pass reported nothing, whether a reader saw a move would depend on which request they
  happened to make. `diffStatus` is idempotent and `npm run test:legal-movement` asserts it.

Keyed on chamber, number and jurisdiction through `billKey`. Not the title, which gets reworded
between runs, and not the item's `id`, which embeds its position in the list — either would make
the same bill look unseen tomorrow and report a move that never happened. `SB 110` and `S. 110` are
different bills and cannot share a key. The congress is left out, so a bill reintroduced next
congress is treated as the same one; that is the lesser error against re-flagging everything each
January.

Tracking runs on the **deduped** set, so the status recorded is the one the tab actually showed.
Recording earlier would store bills that a later gate discarded, and the next run would report a
move from a status no reader ever saw.

**With no database it degrades to silence**, which is the dev preview's normal state — the section
then behaves as it did before, showing each bill's stage without saying whether it moved. Any error
returns no movements rather than failing the feed. There is no
`assertSafeToMutateProductionData` call here on purpose: `lib/environment.ts` reserves that guard
for irreversible writes and states that an upsert into a tracking table is recoverable.

**Untested against a real database.** The comparison logic is covered by unit tests; the Postgres
around it is verified only by types and by failing closed. There is no local Postgres and the
production credentials were deliberately left alone, so the first real exercise of this table will
be its first deployment to an environment that has one.

### Legal Landscape: what is taken from a record, and what is still asked for

The other two sections ask a model what happened and then check the answer. That works because a
regulator's page either exists or does not. For legislation it did not work at all, and the failure
was invisible for as long as the section existed.

**Source verification was a no-op for this section.** `checkSourceUrl` asks whether a URL loads.
congress.gov sits behind Cloudflare and returns **403**, which the guard deliberately reads as "the
host refused us, not that the page is absent" — right for a press release, and it meant no
congress.gov URL was ever checked. Probed directly, `senate-bill/999999`, `401st-congress/senate-bill/1`
and the literal path `senate-bill/not-a-bill` all returned `ok`. flsenate.gov and govinfo.gov serve
soft 404s with HTTP 200, so gibberish passed there too.

**What that rendered.** On 2026-09-30 the tab showed four bills: `S. 1234` "Commercial Real Estate
Credit Enhancement Act", `H.R. 5678` "Commercial Property Foreclosure Reform Act", `S. 2345` and
`S. 3456`. Every number is a real bill and not one of those titles is — S. 1234 is the SSI Savings
Penalty Elimination Act, H.R. 5678 is the No Pay for Disarray Act. A second run reproduced all
four, so this is systematic rather than a bad sample. Plausible sequential numbers with invented
titles is what the model does when asked to recall legislation.

**A bill is a matter of record, so it is no longer asked for.** `lib/legal-updates-legislation.ts`
reads federal bills from govtrack — number, title, status label, last-action date, sponsor, link —
and the model is handed those facts and asked only for prose. It is never asked for an identity, so
it has no opportunity to invent one. govtrack rather than `api.congress.gov` because the official
API returns 403 without a key and this has to work with no new secret provisioned; govtrack was
already on the legislative allowlist.

**Florida is on the record too**, through `lib/legal-updates-florida.ts` and LegiScan. That key had
been in the environment since the project was set up, listed as required in a deployment checklist
and read by nothing — an earlier revision of this document recorded that it was unused. It is the
reason Florida stayed the half of the section that invented numbers long after the federal half
stopped.

Two calls per session rather than a search: `getMasterList` returns every bill in a session with
title, official description, status and last action, so nothing is missed because a search term did
not happen to appear in it, and `getBill` is called only for the handful that survive the gate,
to get the `state_link` that points at flsenate.gov. LegiScan's own domain is deliberately not
allowlisted; the citation has to be the legislature's page.

**A Florida bill's card shows the record, then the staff analysis, then the model** — the same
three layers as a Federal Register rule, from the same `getBill` call that had been used for the
link alone. The record line lists the primary sponsors ("Rep. David Smith (R, HD-038)"; a committee
sponsor by its name — co-sponsors are left out, Florida bills carry a dozen), the filing date, the
companion bill in the other chamber, the last roll call with its tally, the latest text version
and the latest staff analysis, the last two linked to flsenate.gov. The roll call is the fact that
most often changes the reading of a dead bill: HB 759 "Died in Rules", and passed the House 114–0
first. `describeFloridaRecord` builds the line and nothing in it has been through a model.

The staff analysis is what the model is given to summarise, where there is one. Florida's
nonpartisan committee staff write one at each committee stop — effect of the bill, present
situation, fiscal impact, the committee's vote — and it is the legislature's own plain-English
account, so it stands to a one-sentence official description as a rule's "Description of the Final
Rule" stands to its abstract. LegiScan files them under `supplements` with the type mislabelled
"Veto Letter"; `selectLatestAnalysis` goes by the title "Analysis" and the `/Analyses/` path. They
are PDFs, so `fetchFloridaAnalysisText` takes a parser as an argument — `lib/legal-updates-pdf.ts`
wraps `pdf-parse`, which is already a dependency, and the Florida module stays import-free for the
test runner. The House's PDFs repeat a navigation line on every page and open with a storage name;
`cleanAnalysisText` drops both and keeps everything else, the analysis already being the distilled
form. Capped at 5,000 words. A bill that never reached a committee has no analysis — three of the
five live bills, all of which died unheard — and its card carries no `details`, by design: the list
is discarded for any bill whose analysis was not read, so a details block means it was.

**Between sessions the Tracker says so, and says what the dead bills signal.** Florida's regular
session runs sixty days in the spring and filing for the next one opens in the autumn, so for
roughly half of every year every Florida bill the Tracker can show is one that lapsed in March —
"Died in Judiciary" is the clerk's phrase for a bill still sitting in that committee when the
session ended. Shown as five cards with a status, they read as five live bills. Two things are
added, both from the record and neither through a model. `describeFloridaSessionState` returns a
line for the top of the section when *every* Florida bill on it is dead (`isDeadStatus`: "Died in
…", "Withdrawn from consideration", "Failed", "Vetoed"): the session has ended, none of these has
effect, filing for next year's session usually opens in the autumn. It travels as
`sectionContext.legislative`, distinct from `sectionNotes` because it frames a section that has
items rather than explaining one that has none, and `legal-updates.tsx` renders it above the cards.
And `describeIntent` writes one sentence per dead bill on how far it got — the last roll call with
its tally, where it died, the companion — rendered once below the cards as a "Possible intent"
block, framed as signals with no legal effect. The lines are procedural on purpose: HB 759 "Passed
the House 114–0 on 2026-02-25, then died in Rules; a bill that clears one chamber is commonly
refiled" is a different thing from SB 300 "Filed 2025-10-28; died in Judiciary without a hearing or
a vote", and the record states which. It says nothing about *why* a bill stopped, because the
record does not know. A live bill carries no intent line; its status is the story. Both disappear
on their own once a bill with a live status enters the list, which is what the autumn filing will do.

Bill numbers are converted on the way in. LegiScan writes `H0011`, Florida writes "HB 11", and so
does flsenate.gov — which matters beyond presentation, because the identity guard reads the number
back out of the rendered title and looks for it on the cited page in the form the page prints.

**Rulemaking is on the record, as a supplement.** `lib/legal-updates-federal-register.ts` reads
rules and proposed rules from the Federal Register API, which needs no key. This does not replace
the regulatory prompt and is not meant to: the Federal Register carries rulemaking only, and the
FDIC's Financial Institution Letters, OCC bulletins and supervisory guidance — a large part of what
that section is for — never appear in it. So the record supplies what it has and the model still
goes looking for the rest. Deduplication is by document number and then by title, because a rule is
genuinely republished: "Real Estate Lending Escrow Accounts" appeared on 2026-05-19 and again on
2026-06-29, two document numbers for one rule. **The second was a correction**, and a correction
yields to its original. `C1-2026-10036` is a one-page notice fixing a typographical error, with no
abstract and 197 words of text; letting the later date win put a real OCC rule up under the
correction's date with the correction's text as the thing to read. The record says which documents
are corrections (`correction_of`), so the original wins outright and carries "Corrected 2026-06-29"
with a link. A correction that arrives alone — its original outside the search window — has its
original fetched by number.

#### A rule's card shows the record, then the text, then the model

Three layers, each weaker than the one above it, and the card says which is which.

**The record's facts** are listed under the source line exactly as the Federal Register states
them: the agency's action line ("Final rule"), the citation (91 FR 29340), the CFR parts amended
("12 CFR Parts 34 and 160"), docket, RIN, page count, correction date and the official govinfo PDF.
`describeRuleRecord` builds the list and nothing in it has been through a model; it cannot be wrong
in the way prose can. The same API call that returns the title returns all of it, so this costs
nothing.

**The rule's own explanatory text** is what the model is given to summarise, in place of the
abstract. Every Federal Register document has a plain-text version (`raw_text_url`), and
`selectRuleText` takes the parts of it that explain the rule: the sections headed "Description of
the Final Rule", "Overview of the Proposal", "Section-by-Section …" or "Changes to …" first, then
Introduction and Background, then anything else that is not procedure — the Paperwork Reduction
Act, Regulatory Flexibility Act and Administrative Law sections every rule carries are left out, as
is the regulatory text from "List of Subjects" on. Capped at 6,000 words, which is nine thousand
tokens and a fraction of a cent per rule. The Federal Register's text has a table of contents that
repeats every heading and sub-sections whose Roman numerals restart ("1. BMA transactions" nested
three deep prints as "I. BMA transactions"); `splitRuleSections` takes the body to begin at the
first heading already seen and accepts a body heading only when its numeral is the next expected.
Measuring the gap between headings did not work — the contents list carries lettered sub-entries
that run to paragraphs. Tested against seven live documents from 8 to 116 thousand words.

**The model's prose** is a summary, a "why it matters", and — only where the text was fetched — a
list of up to five `details`: who the rule covers, what it requires or permits, the thresholds,
amounts and dates, and what the agency said to the comments it received. The prompt tells it to
return an empty list where no text is given and never to fill it from memory, and the action
discards the list anyway for any rule whose text it did not have, so a `details` block on a card
means the model read the document. It is still the model's reading: the spot checks on the escrow
rule traced every point to the text, but the card labels the list "From the rule text" and puts
the PDF one click away for a reason.

**For legislation the model is a fallback, not a supplement.** Both jurisdictions now have a record,
so asking as well would put one bill on the page twice under two spellings of its title —
`dedupeByTitle` compares normalised text and does not match "SB 300 – Alternative Judicial Sales
Procedures" against "SB 300: Alternative Judicial Sales". The prompt still runs when the records
return nothing at all, and the identity guard still stands behind it.

#### Where a term sits decides how much it counts

The relevance terms are split by **how selective they are**, not by what they mean. A core term
names this world wherever it appears — nothing writes "commercial mortgage" about something else.
An incidental term appears in a sentence about something else at least as often as not: a bill on
court procedure mentions liens, a stablecoin proposal mentions capital requirements, a staff-review
rule is titled "Performance Appraisal".

Where the term appears then decides, because length is what makes a term unreliable. A heading —
the title, and the status, which is equally short and equally the publisher's choice — is a few
words chosen to say what the thing is about, so `bankrupt` in a title is almost always the subject:
"Bankruptcy Threshold Adjustment Act" is real and it matters here. A two-hundred-word body mentions
liens on its way past. **A heading is read on all the terms; a body only on the core ones.** This
is `isCreRelevant`, and `bearsOnFirmOperations` is that plus the individual-action exclusion.

This began, for a few hours, as a second and stricter gate applied to record-sourced items only.
The argument was base rate: a model asked for recent CRE developments returns a list that is mostly
CRE, so a term anywhere in its answer is good evidence, whereas a sweep of 1,930 Florida bills
contains about six that matter and there an incidental term in a body is noise — gating on any term
anywhere kept 32 of them, mostly fire-district and county bills whose descriptions mention liens.
Then the model path admitted a Federal Reserve stablecoin proposal on "capital requirements" in its
body, which is the same failure at a different base rate. One rule is simpler to reason about, and
there is no longer an argument for two.

A body can be read at all only where it is the publisher's own text. For record-sourced items that
is the Federal Register's agency abstract or LegiScan's official description; for model-sourced
items it is the model's `summary`, which the prompt asks it to write as reporting rather than
argument. Neither is `whyItMatters` — see `describedBy` and the defect it was written to fix.

**Federal Register rulemaking is restricted by issuer as well as by subject.** A Farm Credit
Administration rule on troubled-debt classification arrived on real terms, and the FCA regulates
farm lenders no one here will hold a note from. Nothing about the subject can say that; who issued
the rule is a fact the record states outright, so the search names the regulators of the
institutions this firm deals with — OCC, FDIC, the Federal Reserve, CFPB, FHFA, HUD, Treasury and
NCUA — and nothing else comes back. Treasury is listed because the OCC's rules are frequently filed
under both; FinCEN is not, its rulemaking being anti-money-laundering.

Residential subjects are now excluded **by title**, which implements a decision already taken but
only half applied. Dropping the residential terms from the relevance list stopped those items being
admitted on their own subject, but not through a body mentioning something commercial in passing:
five of fifteen otherwise-qualifying Florida bills were housing bills that reached the gate on
"multifamily" or "construction loan" somewhere in their description, "Affordable Housing Property
Tax Exemptions" among them. Title only, deliberately — a commercial foreclosure bill may well
mention homestead exemptions in its text, and what puts an item out of scope is being *about*
housing.

One term had to be excluded as a phrase rather than qualified. `appraisal` is a real signal, and the
Office of Personnel Management titles its staff-review rules "Performance Appraisal for the General
Schedule". `performance appraisal` is therefore an excluded subject, which is narrower than
rewriting the term.

#### Two structural exclusions, verified rather than asserted

Both are facts about what kind of bill something is, so they sit in `legal-updates-florida.ts`
rather than in the relevance gate.

Florida numbers its **local bills** in the 4000s — bills affecting one county, city or special
district. Of the 53 in the 2026 regular session, 48 name a county, city, town, village or authority
in the title. They reach the gate by accident, because the boilerplate describing a district's
boundaries and taxing powers mentions assessments constituting a lien against industrial property,
which is a core term meaning exactly what it says. The relevance gate cannot catch these and there
is a test saying so; the numbering is what excludes them.

The **reviser's bills** are titled exactly "Florida Statutes" — six of them in the 2026 session,
adopting the year's statutes and deleting provisions that "have become inoperative by noncurrent
repeal", which is a term match and not a change to anything.

Checked across the whole window, neither set contains a single bill that is CRE-relevant by title,
so excluding them costs no item that would otherwise have qualified.

Relevance for federal bills is still judged on the **authoritative title and nothing else**, govtrack
publishing no abstract, and the cost is known: H.R. 10375 modernises the SBA 504 programme, which is
commercial real estate lending, and no title of it says so. The alternative is letting the model
judge, which is how invented items got in.

**Deduplication runs twice**, because a bill repeats for two reasons. It surfaces under several of
the twelve searches; and the chambers move companion bills under one title, so the Bankruptcy
Threshold Adjustment Act arrived as H.R. 7730 and again as S. 3977 "of 2026". The copy with the
later action wins, being the one that has moved.

**`lib/legal-updates-bills.ts` is still the guard**, and now checks identity rather than
reachability. Federal bills are looked up and the record's title compared with the item's; Florida
has no open API, so the cited page must both not announce a missing bill and actually print the
number claimed, which a soft 404 cannot do. Comparison is overlap of significant words, not
equality — a genuine citation often gives the short title where the record gives the official one,
whereas all four fabrications shared zero words. An item that **cannot** be checked is dropped, not
shown: failing open is what produced this.

For federal items the guard should now always pass, since their identity came from the record. It
is kept because it is the invariant, and it is what would catch a regression in the sourcing path.
It earns itself on Florida in ordinary runs — one live run dropped items citing `CS/HB 1353` and
`HB 793` as bills that do not exist.

#### govtrack is slow on its first request of the day, and that has to be waited out

Measured: the first request after a period of idleness took **28 seconds**, and every request after
it took a quarter of one. Production makes exactly one cold request a day, because the feed is
generated by a daily cron, so the original arrangement raced twelve parallel searches against a
15-second timeout that the first of them was always going to lose — and losing them all empties the
section. The failure was safe (`keepVerifiedBills` drops what it cannot check) and invisible, which
is the worse combination: an empty Legislative Tracker reads as a quiet fortnight.

Retrying does not fix it. Four attempts at 20 seconds failed in a row before one allowed 60 seconds
succeeded in 28. So `fetchFederalBills` now makes one cheap throwaway request first and waits up to
35 seconds for it, and the searches that follow are warm. `verifyBill` gets 30 seconds and one
retry, the retry being for a transient failure rather than a cold start, which no number of short
retries will outlast.

This is worth remembering for any other unofficial free API this feed comes to depend on. A
timeout tuned to how fast a service answers when you are testing it is tuned to the wrong number.

The legislative prompt is therefore **Florida-only**, and tells the model the number will be
checked against the page, so a guessed number costs the slot and gains nothing.

If summarisation fails, items still render from `describeFromRecord`: number, title, status and
sponsor, all quotable. A real bill with a thin description beats no bill, and beats an invented one
by considerably more.

**The prompts must state today's date, and must name the months to search.** They live in
`lib/legal-updates-prompts.ts` for that reason. The model has no clock: asked for "the past 90
days" it measures from its own training cutoff, and the live API can be observed searching
`after:2024-03-01` and returning interagency guidance from 2006, 2015 and 2023. This is what made
the tab useless until 2026-09-29, and nothing about it is visible in the code — the prompt reads
perfectly well.

Supplying the date is necessary and not sufficient. Given the date alone the model issues one broad
query, finds nothing it will vouch for, and returns an empty list. It also needs telling to search
named sources by month ("OCC news releases September 2026"), at which point results land in the
current quarter. Both halves were measured; neither is decoration.

**An item renders only if its URL is a listed primary source and that URL loads.**
`lib/legal-updates-sources.ts` holds the per-section host lists and the check. This is the gate
that matters, because the model fabricates freely here: it has produced a bill numbered `S. 1234`
copied from the prompt's own formatting example, a "2026 update" linked to a statute enacted in
2020, and consent orders against banks that do not exist, each with a URL built from the real URL
pattern. `federalreserve.gov/newsevents/pressreleases/2026-press20260924a.htm` is the exact shape
of a genuine Fed release and is not one.

Both halves of the check are load-bearing. Requiring only that the URL resolves admits trade press
and law-firm briefings, which resolve perfectly well while being someone's summary rather than the
document. Requiring only a listed host admits constructed URLs on the right domain.

`occ.treas.gov` is a live OCC host and is listed. `occ.ustreas.gov` is not and does not resolve;
the model has produced both, which is precisely why the resolution check exists alongside the list.

`content.govdelivery.com` is listed for both `regulatory` and `enforcement`. The FDIC announces
Financial Institution Letters and its monthly enforcement decisions through GovDelivery rather than
on `fdic.gov`, so a host list that omits it rejects the issuing body's own page as `unlisted`. It was
listed for `regulatory` from the start and missing from `enforcement`, which is the kind of gap the
per-section lists make easy to introduce and hard to notice: the rejection looks identical to the
rejection of a fabricated URL.

The prompts name the permitted domains, and must keep doing so — left to itself the model cites
the commentary it found the item through, and the guard then discards a real development for want
of a link. Naming them took provenance from 38% to 100% in testing.

**Sections retry once when nothing survives verification.** The failure is erratic rather than
steady: a fabricated URL on one attempt and the real page on the next. Verification always protects
the reader, so the retry only decides whether a section has anything in it.

Run `npm run verify:legal-freshness` after any prompt or source-list edit. It calls the live API
for all three sections and fails if the tab would render empty, if the guard leaks an unverified
item, if over half the items cite a non-existent URL, or if over 40% fall outside their section's
filter window. Expect to run it more than once — the output is probabilistic, and early runs of
this work swung between 0 and 8 items. Three consecutive runs after the per-section windows landed
gave 6–9 items rendering, all verified, with Legislative populated every time.

The three surviving sets are merged and passed through `dedupeByTitle` in
`lib/legal-updates-filter.ts`, which also holds `dropStaleItems`. Both are load-bearing, and both
exist because of one user report on 2026-09-29 where Regulatory Watch showed five copies of a 2019
rule under a 90-day heading.

**Dedupe is keyed on the normalized title, not the URL.** Without it an interagency rule comes back
once per issuing agency. Each agency mirrors a joint rule at its own domain, so URL-keyed dedupe
keeps the copies; the official title is verbatim across all of them. Normalization lowercases,
decodes `&amp;`, strips non-alphanumerics and collapses whitespace. First occurrence wins, and since
regulatory items are concatenated first, a development appearing in two sections is kept under the
earlier one. Deduping is global rather than per-section deliberately — the same consent order can
legitimately be both a regulatory and an enforcement item.

**Staleness is bounded on one side only.** Each section's filter window is twice its prompt window,
because the model dates items imprecisely and a bill signed at the close of a Florida session stays
relevant well past the date it was asked about. `MAX_ITEM_AGE_DAYS` (180) remains the default for
callers that do not name a section. Future dates are **kept**: an effective date or a scheduled floor vote is the
"what is coming" the tab exists to show, which is the opposite of the news feeds, where
`isWithinLastDays` rejects anything future-dated. Do not unify the two.

An item whose date will not parse is kept rather than withheld, since it cannot be shown to be
stale. That makes the parser's strictness a safety property: it accepts `YYYY-MM-DD` and formats
naming a specific day, and **refuses vaguer prose**. Bare `Date.parse` pulls a year out of prose and
pins it to January 1, so "Fall 2026" becomes 2026-01-01 — early enough to withhold a live item.

**All three sections always render, and an empty one explains itself in place.** Until 2026-09-29
the tab rendered only sections that had items, so an emptied Legislative Tracker left no trace
beyond a note at the top of the page, which read as an error rather than an answer. The action now
returns `sectionNotes` keyed by section alongside the feed-wide `notes`, and `legal-updates.tsx`
renders the matching note inside the section's own dashed placeholder. Keep the three apart: `notes`
is for feed-wide faults such as a missing API key, `sectionNotes` is for an ordinary quiet section,
and `sectionContext` is a line above a section that *has* items but needs framing before they are
read — today only the Legislative Tracker between Florida sessions, see above.

The placeholder distinguishes two cases that previously looked identical — the feed found nothing,
or the reader's own jurisdiction filter hid what it found. When the feed found nothing it names
what was set aside and why: too old, off-topic, or without a verifiable primary source.

### Legal Landscape: who a rule applies to, counted rather than claimed

Regulatory cards carry the number of institutions the rule's own scope test selects, resolved
against FDIC call reports. The model reports what the document says about **its own coverage** —
the asset band or concentration threshold in its "Applicability" or "Scope" section — and
`lib/legal-applicability.ts` answers it. The model is never asked which institutions are affected;
it has no view of this data and would invent names, which is the same failure as the fabricated
citations, without a link to expose it.

**Two fields are both called CRE concentration and they are not interchangeable.** This is the
one thing to know before editing anything here:

| Field | Measures | Range |
| --- | --- | --- |
| `ScreeningRow.creConcentration` | CRE over **total loans** | 0–100 by construction |
| `ScreeningRow.capitalRatios.creToTier1Tier2` | CRE over **Tier 1 + Tier 2 capital** | a multiple, so `3` is 300% |

Supervisory thresholds — the 2006 interagency guidance and every rule citing it — are measured
against the second. A "300% of capital" test resolved against the first matches nothing, on every
institution, with no error raised: a confident zero that reads as a rule affecting no one. The
prompt field is therefore `minCreToCapitalPct`, named for its units, and it is resolved against
`creToTier1Tier2 * 100` in one place. On live Florida data CRE over loans peaks around 72% while
CRE over capital peaks around 528%.

**Regulatory only, for a conceptual reason.** A foreclosure statute applies to properties and
lienholders, not to banks by size; a consent order applies to the institution it names. Asked of
those sections the model reached for `appliesToAllInstitutions` on Florida bills, resolving to
every institution in the state — a large number carrying no information. Enforcement's actionable
join is the named institution matched to an FDIC cert, which is a different mechanism and is not
built.

**The join is in `resolveLegalApplicability`, deliberately outside the feed's cache.** Department
must not enter a cache key, the feed is keyed to the calendar day while screening is keyed to the
published FDIC quarter, and the feed is one payload shared by every visitor. A consequence worth
keeping: the exposure line arrives after the cards are already readable, so an FDIC outage costs
that line and nothing else.

**The universe is Florida because it is complete.** `getScreeningPayload("national")` fetches at
most `TAB_ROW_CAP` rows across nine quarters, covering roughly the largest thousand of ~4,350
institutions — a denominator biased towards large banks that the reader could not see. Filtered to
Florida the cap is never approached: about 85 institutions from under 900 rows. `capped` is
returned rather than assumed, so raising the cap surfaces instead of skewing counts.

Institutions whose capital inputs FDIC omits are **excluded** from a concentration test rather
than counted, so the figure reads as "at least this many". A rule covering every institution
renders no fraction: "85 of 85" is true and uninformative, and presenting it as a computed finding
would make the real counts less credible.

Thresholds from the model are validated, never clamped — a clamped threshold silently answers a
different question than the rule asked. An inverted asset band is rejected outright as a misread.
An item with no stated scope produces no test at all, which is distinct from an empty test: an
empty test matches everyone.

Run `npm run verify:legal-applicability` after any change here. It applies the supervisory limbs
to live Florida call reports and fails if they return implausible counts, which is what catches
the unit trap; `npm run test:legal-applicability` covers the same ground in isolation.

Note the synthesized `id` appends an array index, so duplicates carry distinct React keys and the UI
will never collapse them for you. The prompts also state that interagency rules are one item and
that `date` must be the most recent action, but treat prompt wording as a hint; the programmatic
passes are what hold. `npm run test:legal-filter` covers both, built from the reported payload.

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

**Both layers fail closed on an unrecognised entity id, independently.** `filterByAllowlist` gets an
empty domain list and drops every result. `buildSearchQuery` gets the same empty list and returns
`null` rather than a query, because a domain-less query would be a bare keyword — an unrestricted
Google search across the open web. `searchIndustryReports` treats that `null` as a rejected request
and returns `{ ok: false, error }`, which the UI renders in its existing error line; no search is
issued and no credentials are spent. Neither half may be relaxed on the grounds that the other one
catches it, and `lib/domain-allowlist.test.ts` asserts both in adjacent blocks.

An unrecognised id is untrusted input rather than a programming error: `entityId` crosses a server
action boundary, where the `EntityId` union is erased at runtime, so a stale or hand-crafted client
payload can deliver an id the registry has never heard of. That is why this rejects rather than
throws.

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

The Market Pulse strip under the header (`components/market-pulse-strip.tsx`) draws **nineteen**
series through `app/actions/fetch-market-pulse.ts`, reusing the same parsing and formatting, so a
figure on the tape and a figure in Key Signals cannot disagree. Values are cached with
`unstable_cache` under `market-pulse-v2`, keyed by ET calendar day; the strip degrades to nothing
rather than showing a placeholder if FRED is unreachable, and a single series that fails is simply
absent from the tape rather than fatal.

The tape reads in four groups: CRE credit, the cost of money, the price of credit risk, and property
fundamentals. **Every id was resolved against the live CSV endpoint and its frequency read off the
returned observations before being added.** Two dead ends are recorded above `PULSE_SERIES` so the
search is not repeated: FRED publishes no multifamily-only delinquency series, and `COMREPUSQ159N`,
its US commercial property price index, stopped updating in April 2025 — the series a CRE tape most
wants is not available.

`SeriesUnit` carries six variants, and `net-percent` exists for accuracy rather than presentation.
The lending-standards series (`SUBLPDCLCTSNQ`) is a *net percentage of surveyed banks* sitting near
zero, so the other two treatments both misreport it: basis points would render a move from 2.0 to
4.4 as "up 240 bps", dressing a survey up as a rate, and a proportional change would divide by a
base that is routinely zero or negative. It therefore prints like a percent and moves in percentage
points. `usd-millions` (Census construction spending), `units-thousands` (starts and permits) and
`index` (Case-Shiller) are mechanical by comparison.

`describeChange` is exported from `lib/verified-metrics.ts` and is the single place that routes a
unit to its wording. It used to be private, with `fetch-market-pulse.ts` holding a duplicate; that
was survivable with two units and would not have been with six — the tape would have mis-worded the
new series while the memo read them correctly. **Add a unit in one place.**

It renders as an exchange-style crawl rather than a static row, and two of its numbers are measured
at runtime instead of fixed. **Lap duration** is derived from the width of one sequence of items, so
the crawl holds a constant `CRAWL_PX_PER_SECOND`; a fixed duration would tie speed to how much
content there is, and a strip that lost two dead FRED series would visibly speed up. **Copy count**
is derived from the rail width, because two copies loop seamlessly only while the sequence is wider
than the rail — below that, each lap drags a band of empty track across the screen. The component
hands both to CSS as `--pulse-ticker-shift` (`100% / copies`, the distance of one lap) and
`--pulse-ticker-duration`; the keyframes in `app/globals.css` consume them. Duplicate copies carry
`aria-hidden`, so the figures are announced once.

The crawl pauses on hover and on `:focus-within`. Reduced motion is handled explicitly and must stay
that way: the blanket `prefers-reduced-motion` rule in `app/globals.css` collapses every animation to
its final frame, which for a crawl is one copy already scrolled off, so the strip would appear to
start blank. The later rule therefore drops the animation outright, hides the `aria-hidden`
duplicates and makes the rail scrollable by hand.

### Peer Positioning in the institution drawer

`components/institution-profile-drawer.tsx`. Percentiles are measured against a **matched peer
cohort**, not against everything in the selected scope. The scope-wide version was the shipped
behaviour until 2026-09-30 and it read as meaningful while saying very little: a $180m
single-branch bank ranked against a set containing Truist is mostly being told about its own size.
Measured on live call reports, switching to matched peers moves the CRE/Assets percentile for
**every** institution that can be ranked — in Texas 346 of 352, by 26.6 points on average for banks
under $1bn against 23.2 for larger ones, with a largest single shift of 86 points. The old figure
was not slightly off.

Four places render these percentiles — the drawer's own list, the copied snapshot, the comparison
chart and the comparison table — and each previously re-derived the cohort inline. They now share
`PEER_METRICS`, `percentileAmong` and `resolvePeers`, so they cannot drift apart.

Three consequences are carried in the interface rather than hidden:

- **The cohort is stated wherever a percentile appears**, including in the copied snapshot, because
  that text ends up in credit memos and a percentile without its cohort is not a fact. The basis
  differs per institution, so no single caption could describe it.
- **Fewer than `MIN_COHORT` (8) peers renders "—"**, not a number resting on four institutions.
  This fires most often for the *largest* institutions under a single-state scope, where there are
  no eight in-state banks of comparable size, so the note says to switch the scope to United States
  — which does give them a cohort. Verified: in Georgia every institution over $1bn falls into this
  case.
- **In compare mode each institution is ranked against its own peers**, so bars are not a shared
  scale of institutions. Stated in the caption, because otherwise a taller bar reads as "larger".

Two rendering details worth keeping. Percentiles use `percentileIn`'s midrank convention, shared
with the Opportunity Score so two percentiles on one screen cannot disagree about ties. And
`ordinal()` exists because the previous code appended a bare "th" and rendered "2th percentile" and
"23th percentile" — which survived a clean build, 199 passing unit tests and a passing live-data
script, and was caught only by `npm run verify:peer-positioning` reading the drawer.

### FDIC screening metrics

Fields are requested in `lib/fdic-config.ts` and turned into `BankFinancialData` in
`lib/fdic-data-transformer.ts`.

**Where the tab's numbers are computed.** `lib/analytics/screening.ts` collapses the multi-quarter
FDIC rows into one scored row per institution — latest quarter, four-quarter trend, the
trailing-twelve-month figures, the capital ratios, then the cohort-relative scores — and
`app/actions/market-analytics-screening.ts` caches the result. The browser renders it and computes
nothing. An institution that did not file for the quarter the tab is headed with is dropped rather
than shown with a stale figure under a current date, which is why the KPI institution count can
exceed the row count.

The row that reaches the browser carries **only fields something renders**. The capital *dollar*
inputs (`RBCT1J`, `RBCT2`, `RWAJ`, equity) exist solely to produce `capitalRatios` and stay on the
server, as do the `CapitalRatios` internals and three of the five values each trend quarter used to
hold. That is not tidying: it is what keeps the cached entry under Next's 2MB limit. See section 5.

These are the columns whose FDIC field names invite a wrong reading, so verify against the live API
rather than inferring from the field name:

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

> **Unreachable since 2026-09-30.** Nothing renders either of the two views below. The description
> of how they behave is still accurate — the code is unchanged and still typechecks — but no user
> can reach it, and no environment variable will change that. Read this section as a record of what
> the code does, not of what the tool shows. The reasoning is under "The tab bar and feature flags"
> above; the short version is that the analysis is wanted and the extra destination is not.
>
> Their calculators in `lib/scoring/` are still under test and still described below, which is the
> part worth preserving. Anything reading this to revive the views should put the analysis inside
> the institution profile drawer rather than restoring a tab.

`components/lenses/`. These began as additive department-specific views, rendering **above** the
tabs so every existing tab stayed reachable whichever department was selected. The department
mechanism was removed on 2026-09-29 and the tab entries the following day.

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

The dashboard no longer supplies `onSelectInstitution`, `notFoundCert`, `focusCert` or
`onFocusResolved` to anything, since the only two callers are unreachable. `MarketAnalytics` still
accepts the last two as optional props, so the receiving half of the handoff is intact; the sending
half would have to be rebuilt.

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

**Peer cohort** (`lib/scoring/peer-cohort.ts`). Used by the institution profile drawer in Market
Analytics — see "Peer Positioning" under that tab — and formerly by the Underwriter Workbench.
Matched on size band, then geography, then CRE mix, relaxing **CRE mix first and geography second**
when the cohort is thinner than `MIN_COHORT` (8).

Two guards exist because both failures render a confident, wrong number rather than an error.
**Geography is only relaxable when dropping it actually admits more institutions**, tested
structurally as `inGeography.length < inSize.length` rather than by asking the caller to declare
its universe. A single-state universe — which is what the Market Analytics scope selector produces
for any state — would otherwise produce a cohort describing itself as national while containing
only that state's banks. And **an institution whose loan figures are absent is not matched on
lending mix**: `creMixBand` never throws, so missing figures land in "little CRE", and
`mixIsKnown` is what stops that default being reported as a criterion that was tested.
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
  | `market-analytics-screening-v1` + scope | Reduced, scored rows for the Market Analytics **tab** |
  | `market-analytics-visuals-v1` + scope | Derived chart series for the Visual Analysis panel |
  | `executive-brief-v4` + scope | Ranked change events and non-reporting institutions for the Executive Brief. **Never populated** — the view is unreachable and the cron no longer warms it |
  | `underwriter-workbench-v1` + scope | Latest-quarter rows for the whole scope, for the Underwriter Workbench. **Never populated**, as above |
  | `legal-updates-v13` | Legal Landscape items: deduped, freshness-filtered, relevant to the firm's operations, source-verified, and — for legislation — checked against the bill record. Exposure counts are **not** in here, see `resolveLegalApplicability`. Bumped to `v13` when Florida items gained `intent` and the response gained `sectionContext`; `v12` when Florida bills gained record facts and staff-analysis details and enforcement roundups began to be read from their pages; `v11` when Federal Register items gained `record` facts and `details` from the full text (item shape changed); `v10` when monthly enforcement roundups began to be admitted; `v9` when Florida bills and Federal Register rulemaking began coming from records; `v7` entries hold the fabricated bills, and the Data Cache survives deploys |

  `market-analytics-report-data` is keyed by scope rather than by day and revalidates every six
  hours, since FDIC publishes quarterly. **Bump its version whenever the scoring changes**, or cached
  entries keep serving scores computed under the old method — v2 marks the move to percentile rank.
  The two lens caches follow the same rule on a **23-hour** window. **Bump `executive-brief`'s version
  whenever a change-detection threshold, the trajectory run length, a ranking function, the
  observation mapping or the cohort rule moves**, or the brief keeps reporting events under the old
  rules until the window expires — v2 marks the capital-ratio fix, v3 excluding institutions that did
  not file, v4 the non-reporting section.   **Bump `underwriter-workbench`'s version whenever the row
  shape or the quarter rule changes**, or clients keep deserialising the old shape.

  `market-analytics-screening` is the tab's own payload, keyed to the published quarter (see
  below). **Bump its version whenever the scoring, the transported row shape or the quarter rule
  changes.** It is warmed for `national` and `Florida`, the two scopes `PAGE_LEVEL_TO_REGION`
  produces; choosing another state from the dropdown pays one cold fetch and is then cached
  for that scope as well.

  **This one has a size ceiling, and it is the reason the row is trimmed.** Next refuses any
  entry where `JSON.stringify(entry).length` exceeds 2MB and logs `Failed to set Next.js data
  cache`, silently falling back to recomputing on every request. The reduced national payload
  is 1.26MB. It is not 2.26MB — which is what one row per institution costs unreduced — because
  `lib/analytics/screening.ts` carries only fields something renders. Before adding a field,
  note that `npm run verify:screening-parity` prints the payload size, and that closing the
  national coverage gap to all ~4,450 institutions projects to about 5.5MB, which would need a
  different store rather than further trimming.

  `market-analytics-visuals` is the same story on the other half of the tab, keyed the same way.
  **Bump its version whenever a chart derivation changes.** The panel charts the
  full ~4,600-institution cohort, so it is built from `buildReportData` and paginating that costs
  about 22 seconds — which is precisely why it has to cache. It did not before: `ReportData` is
  **5.46MB**, well over the ceiling, so Next refused the write and the 22 seconds ran on every
  mount. Deriving the four series server-side brings it to **0.59MB**. Only the scatter scales
  with the cohort; the histogram is ten bins and the two bar charts are twenty and fifteen rows.
  `npm run verify:visuals-payload` asserts it still fits and that rounding moved no plotted value.

  **The failure mode here is silent.** An oversized entry is not an error — Next logs
  `Failed to set Next.js data cache` and carries on recomputing, so the only symptom is a slow
  page. Both Market Analytics caches are one careless field away from that, which is what the two
  verify scripts exist to catch.

### Why the Market Analytics caches are keyed to a quarter

  Call report data changes four times a year. Both heavy caches used to expire on a 23-hour timer,
  so the tool re-paginated 31MB and recomputed 22 seconds of work about ninety times a quarter to
  reach an identical answer.

  Both keys now carry the **published quarter**, from `getLatestFdicQuarter` in
  `app/actions/fdic-latest-quarter.ts` — one row, 266 bytes, roughly 0.45s, itself cached for six
  hours. The expensive work is keyed to the data rather than to the clock: a new quarter changes
  the key and causes exactly one recompute, and the rest of the quarter is served from cache. The
  probe is the only component left that has to notice the world changing.

  The timers remain, stretched to **seven days**, purely to pick up amended call reports. Banks
  refile and FDIC restates prior quarters; keying on the quarter alone would never see those.

  When the probe fails it returns a **date-derived quarter** rather than a sentinel, so every
  caller during an FDIC outage agrees on one key and shares an entry instead of each paying the
  recompute. It looks back 100 days, since naming a quarter FDIC has not published would key
  everything to an empty result.

  **The probe is load-bearing and fails invisibly** — a wrong answer serves stale figures for up
  to a week, an unstable one makes every visitor miss the cache. `npm run verify:latest-quarter`
  is the guard, and it already caught one such failure: FDIC nests each row under `data`,
  `fetchFDICData` flattens it, and reading the nested shape returned `undefined` and fell through
  to the fallback without an error.

### The 23-hour windows on the department lenses

  **23 rather than 24 is deliberate and should not be rounded up.** The daily cron runs at
  05:00 UTC and both lenses cost the better part of a minute cold, so the entry has to be *expired*
  when the cron arrives. `unstable_cache` does not refresh a still-fresh entry, so at exactly 24 hours
  the warm run would find it valid, return early, and leave it to lapse in front of a user later that
  day. The residual case is a mid-afternoon deploy, which resets the clock and shifts expiry into the
  next working day; there is no fix for that within a plain TTL. The Market Analytics caches avoid
  the whole problem by keying on the quarter instead.
  Locally, deleting `.next/cache` does not clear it — the dev server holds it in memory too, so
  restart the server as well.

### Tab panels stay mounted once visited

  Radix unmounts inactive `TabsContent` by default. Leaving Market Analytics and returning therefore
  destroyed the panel and refired every effect in it — the screening payload, the chart series and
  the map data all refetched, and the region filter, sort order and selected institution reset. The
  server caches made that fast but never free, and it read as the page reloading.

  `market-intelligence-dashboard.tsx` tracks which tabs have been opened and passes `forceMount` to
  those. Mounting **on first visit rather than up front** is deliberate: force-mounting everything
  immediately would fire all four tabs' fetches on page load.

  Two consequences that are easy to trip over.

  **`forceMount` stops Radix hiding the panel.** Radix derives `hidden` from its own `present` flag,
  which `forceMount` forces true, so a force-mounted panel is not hidden and every visited tab would
  render stacked. `TAB_CONTENT_CLASS` therefore carries `data-[state=inactive]:hidden` — Radix does
  still set `data-state`, which is what that hooks onto. **Any new `TabsContent` needs that class.**

  **Hiding is `display: none`, which collapses a canvas to 0x0.** MapLibre caches canvas dimensions
  and does not observe its container, so the bank stress map came back blank after a tab switch. A
  `ResizeObserver` in `BankStressHeatMap` calls `map.resize()` when the container regains size; a
  window resize listener would never fire, because the window is not what changed. Anything else
  drawing into a canvas inside a tab needs the same treatment.

  `npm run verify:tab-persistence` checks all three failure modes in a real browser.

### What a deployment does and does not clear

  **Vercel's Data Cache persists across deployments.** It is isolated per project and per
  environment — preview and production keep separate caches — but shipping does not empty it, and
  it is not populated at build time either. Entries go when their TTL lapses, on an explicit
  `revalidateTag`/`revalidatePath` or manual purge, or under LRU pressure once the project hits its
  storage limit.

  Two consequences worth knowing. A deploy does **not** reintroduce a cold-start penalty, so the
  warm-cache cron is insurance against TTL lapse and LRU eviction rather than against shipping. And
  because TTLs are not reconciled between deployments, **changing a `revalidate` value does not
  retune entries that already exist** — they keep the window they were written with. Change the key,
  or purge, if a window change has to take effect immediately.

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
| `institution_watchlist` | `app/actions/institution-watchlist.ts` (auto-creates itself) |
| `bill_status_history` | `app/actions/bill-status-tracking.ts` (auto-creates itself) |

`institution_watchlist` holds FDIC institutions the team is tracking, keyed on `cert` alone. One
shared list: the tool has a single shared password and no accounts, so there is exactly one team.

It replaced `department_watchlist`, which keyed the same rows `(department, cert)` from a cookie
value. That was removed on 2026-09-29 for three reasons — the cookie was a preference rather than an
identity, so anyone could change which list they wrote to from the browser console; it forced the
department into the cache key of every reader; and **nothing in the interface ever wrote to the
table**, so it was an orphaned capability of the same kind the department model was introduced to
replace. `ensureTable` carries any surviving rows across, collapsing the composite key by taking the
earliest entry per `cert`. **The old table is deliberately not dropped** — it is expected to be
empty, but "expected" is not grounds for an irreversible statement running off a cache-warming
request. Drop it by hand once you have looked.

The only reader today is `app/actions/resolve-legal-applicability.ts`, which intersects it with the
institutions a legal development covers. There is still no interface for adding to it, so
`addToWatchlist` and `removeFromWatchlist` are wired but unreachable.

It is **not** related to `data/watchlist.json`, which is curated reference data — 45 named
distressed-credit firms with aliases and categories, loaded by `app/lib/watchlist.ts` and used to
match news and counterparties. That file belongs in the repository; this table is team state.

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
| `LEGISCAN_API_KEY` | Legislative Tracker shows federal bills only; a feed note says so. Federal bills come from govtrack and the Federal Register, which need no key |
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

`LEGISCAN_API_KEY` **is now read**, by `lib/legal-updates-florida.ts`, and is what supplies the
Florida half of the Legislative Tracker. For most of the project's life it was not: it was listed as
required in the old `DEPLOYMENT_CHECKLIST.md` (deleted 2026-08-24), an earlier revision of this
document said it could be removed from Vercel, and meanwhile Florida bills were being recalled by a
model and invented. **Do not remove it.** Without it the Legislative Tracker shows federal bills
only, and says so in a feed note rather than degrading quietly. That checklist also omitted
`APP_PASSWORD`, `COOKIE_SECRET`, `BLOB_READ_WRITE_TOKEN` and `DATA_ENVIRONMENT`, which is why this
table replaced it.

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
