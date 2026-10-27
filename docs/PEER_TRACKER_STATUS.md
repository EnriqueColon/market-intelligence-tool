# Peer & Private Credit Tracker — status and open items

*As of 2026-10-27: **in production as beta** since 2026-10-26, with `peer-intel` in production's
`ENABLED_TABS`. Steps 1–6 are done, with step 7's developments feed, vintage pacing and interim-close
labels; gating is assessed and its reader proven (`verify:peer-gating`) but not built, and the
alerts digest is not started. On `dev` and unreleased: each fund's row expands to its structure,
terms and people, adviser CRDs in the registry (sponsor-stress step 2), and **Form ADV 7.B.(1) in
the drawer (step 3)** — see §3.*

**Resuming:** see the "STOPPED HERE" block at the top of `SESSION.md` for the ordered pick-up list.
The item with an impact outside this repo is §3a: AMO Tracker's whole-scope signals request now has
about 160 KB of room, so it should move to `band=` before that runs out.

The running list of what is still open. Update it at the end of every session alongside
`SESSION.md`, `ROLLBACK.md`, `README.md` and `confluence.md`.

---

## 1. Build order

| Step | Scope | Status |
| --- | --- | --- |
| 1 | Three-layer registry, EDGAR access contract, Form D parsing | **Done** (`203b818`), extended by targeted lookups (`f310c1a`) |
| 2 | Form D ingestion across the registry, raise aggregation, provenance catalog | **Done** (`19e0e24`) |
| 3 | XBRL quarterly series for the registered tier | **Done** (`8cb6fa9`) |
| 4 | Signals and the layer aggregate, cached weekly, cron entries | **Done** (`04bcd92`) |
| 5 | The tab: Raise Environment, Active Raises, New Launches, manager drawer | **Done** (`94d8f24`), reviewed in a preview by the user |
| 6 | Evergreen Liquidity and Portfolio Stress panels | **Done** (`f842f88`) |
| 7 | Developments feed, gating narrative, alerts digest | **Feed done** (`8f3eda9`); gating and digest remain |

Registry today: **26 managers, 65 vehicles, 59 distinct raises**; 25 / 39 / 65 vehicles by layer;
12 registered vehicles (7 non-traded, 5 listed), all national.

Also shipped outside the numbered steps: a **Distribution** panel (`a8855c6`) showing the
broker-dealers each manager pays to sell, with CRD numbers — the answer to "who are the investors?",
which no filing discloses. And **Vintage Pacing** (2026-10-22): each of a manager's funds on the
same axes, months since first sale against cumulative capital raised, with the newest read against
its predecessor at the same month. The firm's own ladder is a card on the tab; any peer with two or
more vintages gets the same chart in its drawer. Built entirely from the Form D trails already in the
cached cohort — no new fetch, no payload change. `lib/peer-intel/vintage.ts`, 13 tests. Vintages are
ordered by first-sale date rather than name, sleeves are omitted and counted, and where the prior
fund's figure at that month falls between two filings the reading says which two.

And **Structure & terms** and **People** for each fund (2026-10-26, at the user's request). First built as
two drawer sections; the same day, at the user's request, **moved into the Raises table**: clicking a
fund's row opens its structure and terms beside its people. **No row opens on its own** — a first
version pre-expanded the fund clicked on the tab and a single-fund manager's only fund, and the user
asked for expansion to be the reader's click alone. `FundDetail` in
`components/peer-intel/structure-people.tsx`. Built from the parts of Form D the
raise figures do not use — no new fetch, ~31 KB more in the US entry,
cache key `peer-intel-v3`. `parseTerms` in `form-d.ts`, `lib/peer-intel/structure.ts` and
`people.ts`, with 31 new and amended tests; `npm run verify:peer-structure` checks a whole layer
live. What the first run over all 26 managers and 56 vehicles established:

- **Co-issuers:** 8, all untracked, **none double-counted**. A joint filing reports the whole
  offering, so a co-issuer's capital is inside its totals. H.I.G. files with Cayman and Luxembourg
  feeders in euros and sterling — a European channel invisible until now; Safe Harbor Fund 4 and
  Madison Funds V and VII each file with one.
- **Exemptions:** 506(b) 45, 3(c)(7) 33, 3(c)(1) 13, 3(c)(5) 9, 506(c) 5. Five real changes across
  trails, among them **Rialto Credit Opportunities moving from 506(b) to 506(c) in July 2025** — it
  began advertising — and an older Safe Harbor fund going the other way in 2022. H.I.G. adds and
  drops the umbrella 3C code with nothing else moving; that is ignored as a change.
- **Commissions:** reported above zero by 12 of 56. BXSL $80M (est.); Madison VI and V 0.52% and
  0.54% of offering; Safe Harbor Fund 4 $2.0M (est.), 0.67%.
- **People:** 114 people and 39 entities, and **no name at two managers**, so the cross-manager
  links are empty for this registry. Matching is exact by design: Safe Harbor's own filings list both
  Rafael and Ralph Serrano, which may be one person or two, and the tool cannot know.
- **A parser fix along the way:** entity related persons filed with "." or "[none]" as a first name
  were read as ". BH3 Debt Opportunity Fund II GP, LLC". Nothing displayed them until now.

Cache entries written by `warm-cache`: `peers:national` (~250 KB, 43s, 340 SEC requests plus 26 news
feeds), with Florida and Miami-Dade smaller — all far inside the 2 MB per-entry limit, so no chunking
is needed.

---

## 2. Decisions needed from the user

These gate nothing immediately but shape what the tab shows.

- [ ] **The two `adjacent` calls in Miami-Dade.** Integra is multifamily *equity*, not credit; SEGLO
  states no strategy in its filing. Both are currently `adjacent` — keep, promote to `direct`, or
  drop from the registry?
- [ ] **Rialto's Property funds.** Fund IV-Property ($706.0M) and Fund V-Property ($290.1M) are
  deliberately excluded from Rialto's vehicle list as equity rather than debt, so the comparison
  stays like-for-like. Confirm, or include them.
- [x] **The broader private credit tier.** Kept at the user's direction (2026-10-21), marked
  `adjacent` since Blue Owl, Apollo, Ares and HPS are not CRE lenders.

---

## 3. Open on the peer tracker

**Known limits to carry into the UI.** Each must be stated on the panel, not left as a blank or a
zero.

- [x] **Payment-in-kind income is tagged by only 2 of 12 registered vehicles.** Closed 2026-10-21,
  audited: the signal returns `unjudged` with "payment-in-kind income is not tagged by this filer",
  the drawer renders a dashed chip, and the coverage is stated in the sources panel.
- [x] **Portfolio and liquidity are unobservable for every private fund.** Closed 2026-10-21:
  `PRIVATE_FUND_LIMITS` is rendered in the sources panel, the Raise Environment footer says it for a
  layer with no reporting vehicle, and the manager reading distinguishes "not observable" from a
  signal that simply did not fire.
- [x] **Gelt Financial's only Reg D raise closed in 2019.** Closed 2026-10-21 (`eb2b140`), and it
  turned out to be the symptom of a real gap: Open Raises and New Launches both filter to live
  offerings and were the only routes into the drawer, so **eleven of twenty-six tracked managers
  were unreachable** and Gelt appeared nowhere. The new "All tracked managers" roster reaches every
  manager and states its standing — Gelt reads "last raised 6 years ago".
- [x] **32 of 50 national offerings are "Indefinite".** Closed 2026-10-21, audited: Raise
  Environment shows "excludes N uncapped" beside capital sought, the table leaves the subscribed
  share blank rather than computing one, and an invariant asserts no percentage is ever computed
  against an indefinite offering.
- [x] **`isLikelyOpen` is inferred from four quarters of silence.** Closed 2026-10-21, audited: said
  in the provenance catalogue, in the signal's firing rule in the sources panel, and in the roster
  footnote. The roster's standing column shows how long a manager has been quiet, so a reader can
  judge the inference themselves.
- [ ] **The signal thresholds have no backtest**, unlike the bank signals. There is no public record
  of which managers were "right" to be raising, so `PEER_SIGNAL_THRESHOLDS` holds deliberately
  conservative starting values. Worth revisiting once the tab has been read against a few quarters:
  the `dormantQuarters: 12` cutoff and the 40% acceleration share are the two most likely to move.
- [ ] **Net outflow fires on 60% of judged managers nationally**, which is high — but over only five
  judged managers, and it is true. If the registered tier grows, check the rate again.

**A lead worth chasing: Form ADV as a size source for private peers.**

- [x] **Form ADV gives per-fund size for the private managers — path verified and the key in place
  (2026-10-26).** Part 1A Schedule D, Section 7.B.(1) lists each private fund with its gross asset
  value, owner count, audit status and auditor, and ADV is public through IAPD. The 21st's note that
  the retrieval path was unverified is superseded: IAPD's search endpoint returns an adviser's CRD
  as JSON, `reports.adviserinfo.sec.gov/reports/ADV/{CRD}/PDF/{CRD}.pdf` serves the full ADV, and
  `pdftotext` reads the fund rows (Safe Harbor's lists seven funds with GAV from $0 to $186.7M).
  History through 2024 is in the SEC's bulk CSVs (`IA_Schedule_D_7B1`, `ERA_Schedule_D_7B1`). Full
  source notes: `docs/SPONSOR_STRESS_RESEARCH.md`.

  **Step 2 of the sponsor-stress plan is done:** every manager's adviser CRD is in `registry.ts`
  with its basis — 20 recorded, 6 reviewed as having no adviser (Atipana, R&R, Integra, SEGLO,
  Naso, Gelt: small lenders without one), and 5 vehicle-level advisers where a BDC's or REIT's
  differs from its sponsor's (BREIT, BCRED, Apollo Debt Solutions, Ares Strategic Income, HPS
  Corporate Lending). `lib/peer-intel/iapd.ts` with 9 tests; `npm run resolve:peer-crds` proposes
  from IAPD and `npm run verify:peer-crds` checks the registry against it live. Coverage caveat
  stands: the six without an adviser will have no ADV figures, and the panel must say "no ADV on
  file" rather than infer.

- [x] **Step 3: Form ADV 7.B.(1) in the drawer — done 2026-10-27 (`3ec5e2e`, on `dev`).** Each
  fund's gross asset value, owners, minimum, 3(c)(1)/(7), master/feeder, auditor with PCAOB number,
  opinion, whether audited statements reached every investor, custodians, prime brokers,
  administrators and marketers — under its row in the drawer's Raises table, beside the Form D
  figures, with a Form ADV section for the adviser's whole book (funds, gross assets with feeders
  excluded, audit counts, the funds not tracked here). Read offline by `npm run refresh:peer-adv`
  from the IAPD PDFs and committed as `lib/peer-intel/adv-extract.json` (21 advisers, 593 funds);
  the app never fetches a PDF. Funds link to vehicles by the Form D file number the ADV quotes
  (Q22), now read from EDGAR's index onto every raise, with folded name as the fallback; the link
  rate and the reasons for each unlinked vehicle are in the refresh script's report. The six
  managers without an adviser say "no adviser on file"; the advisers of registered vehicles report
  no private funds, correctly, and the section says why. 16 catalogue entries with basis `adv`.
  Not yet reviewed in a preview by the user.

- [ ] **Step 4: continuation-vehicle detection** — from Form D issuer names (Continuation,
  CV, Annex, Extension) and the ADV's master/feeder links, flagged on the manager, never scored.
  Next in the sponsor-stress plan, user-paced.

- [ ] **Step 5: ADV history 2011–2024** from the SEC's bulk CSVs (`IA_Schedule_D_7B1` is in the
  scratchpad; FilingID→CRD needs `IA_ADV_Base_A`), so a fund's gross asset value becomes a series —
  Safe Harbor's Fund 3 fell from $155.6M (2024) to $84.1M (2026), which is the kind of move the
  series would show for a peer.

**Deferred by design.**

- [ ] **Gating — buildable at full coverage from Schedule TO, which supersedes the 10-Q approach.**
  **Correction, 2026-10-21:** this item previously said no filing discloses requests received. That
  was wrong, and the error was repeated in the liquidity panel's copy. A non-traded fund runs its
  repurchase programme as an **issuer tender offer**, and Rule 13e-4(c)(4) obliges it to file a
  Schedule TO **final amendment reporting the results**. BCRED's, filed 2026-08-04, states:
  *191,782,834 shares validly tendered, 93,100,272 accepted on a pro rata basis representing 5% of
  shares outstanding, $2,201,821,426 of net asset value, at $23.65 per share.* That is requests,
  fulfilment (48.5%), proration and the cap in one filing of under 5,000 characters, in a format
  prescribed by rule rather than left to each sponsor's prose.

  The mistake was method, not data: the 10-Q was searched, found to carry only what was bought, and
  the conclusion drawn that the figure did not exist — instead of asking **which form would be
  obliged to carry it**. BCRED alone has 59 Schedule TO filings, so there is a long per-quarter
  history per fund.

  `lib/peer-intel/gating.ts` and its 15 tests still work against the 10-Q and stay for now, but
  **Schedule TO is the source to move to** for the five BDCs. The two confirmation questions were
  answered on 2026-10-21 against live EDGAR — see the item below.

- [ ] **Gating coverage is 7 of 7, from two sources, not five of seven.** Checked 2026-10-21 against
  live EDGAR; scripts in this session's scratchpad, worth promoting to `verify:peer-gating` if the
  feature is built.

  **Question 1 — do all seven run tender offers? No, and the split is clean.** Every Schedule TO
  each of the seven has ever filed was counted, from the full submissions history:

  | Vehicle | Schedule TO filings | Reading |
  | --- | --- | --- |
  | BCRED | `SC TO-I` 22, `SC TO-I/A` 37 | Quarterly issuer tender, 2021→ |
  | Blue Owl OCIC | `SC TO-I` 21, `SC TO-I/A` 26 | Quarterly issuer tender, 2021→ |
  | Apollo ADS | `SC TO-I` 18, `SC TO-I/A` 17 | Quarterly issuer tender, 2022→ |
  | HPS HLEND | `SC TO-I` 18, `SC TO-I/A` 17 | Quarterly issuer tender, 2022→ |
  | Ares ASIF | `SC TO-I` 12, `SC TO-I/A` 17 | Quarterly issuer tender, 2023→ |
  | **BREIT** | **none, ever** (688 filings on record) | Share repurchase **plan** |
  | **SREIT** | `SC TO-T` 1, `SC TO-T/A` 4 — **not its own** | Share repurchase **plan** |

  **SREIT's Schedule TOs are somebody else's bid.** `SC TO-T` is the *third-party* form. The cover
  page names Starwood Real Estate Income Trust as "Subject Company (Issuer)" and **Cox Capital and
  Saba Capital as the Offeror** — a hostile mini-tender run March–April 2026, nothing to do with
  SREIT's own redemption programme. Treating `SC TO` presence as evidence of an issuer tender would
  have read an activist's bid as the fund's own gating. **Filter on `SC TO-I`, never `SC TO`.**

  **But both REITs disclose it anyway, in the 10-Q, and BREIT's is the best disclosure of all
  seven.** BREIT states the cap used *and* the fulfilment rate, monthly, in MD&A and again in the
  repurchase-table footnote — Q3 2023: *"the Company fulfilled repurchases equal to 2.0%, 2.0% and
  1.0% of NAV, or 34%, 43% and 29% of repurchase requests, respectively."* That is **both of
  Stanger's two metrics, monthly, per vehicle.** In an unprorated period the sentence instead reads
  *"we fulfilled $2.1 billion of repurchases requested, which represents all repurchase requests
  received"* (Q2 2026) — so dollars-and-all rather than a percentage, and the extractor must handle
  both shapes.

  SREIT discloses a **monthly** fulfilment percentage in the footnotes to the Item 2(c) table, but
  only in months it prorated: *"approximately 37% of each stockholder's April repurchase request was
  satisfied"*, then 3% in May, 4% in June, 4% in July, 4% in August 2024. Its Q2 2026 10-Q carries
  no such footnote, which on this pattern means nothing was prorated — **but absence-means-full is
  an inference, not a statement, and must be labelled as one on the panel.** SREIT never uses the
  phrase "we fulfilled", so BREIT's and SREIT's extractors cannot share a pattern.

  **Question 2 — how consistent is the Rule 13e-4(c)(4) wording across the five BDCs? Consistent in
  structure, and there is one trap in it.** All five give, as absolute share counts, the shares
  validly tendered and the shares accepted, both in a short numbered list in a filing under ~5,200
  characters. Four of five cite 13e-4(c)(4) explicitly; Blue Owl does not.

  **The trap: "representing X%" means two different things.** It is accepted-over-tendered for two
  sponsors and accepted-over-outstanding — i.e. the cap, not the fulfilment rate — for three:

  | Vehicle | Tendered | Accepted | Computed accepted/tendered | What the filing's "representing X%" refers to |
  | --- | --- | --- | --- | --- |
  | BCRED | 191,782,834 | 93,100,272 | **48.5%** | 5% of shares outstanding — the **cap** |
  | Blue Owl OCIC | 395,428,504 | 105,249,082 | **26.6%** | 26.6% of validly tendered — the **fulfilment rate** |
  | Apollo ADS | 101,541,297 | 30,224,152 | **29.8%** | 5% of shares outstanding — the **cap** |
  | Ares ASIF | 50,400,325 | 19,264,139 | **38.2%** | 38.2% of validly tendered — the **fulfilment rate** |
  | HPS HLEND | 66,718,586 | 25,076,907 | **37.6%** | 5% of shares outstanding — the **cap** |

  Reading that percentage as one field would report Apollo's fulfilment as 5% when it was 29.8%, and
  in the direction that makes gating look far worse than it was. **Never parse the percentage;
  compute fulfilment from the two share counts, which all five give.** Blue Owl's multi-class
  tendered figure must be summed across Class S, D and I first, as the existing 10-Q module already
  does for its repurchase rows. Ares adds odd-lot priority for holders of fewer than 100 shares,
  which perturbs strict proration slightly and should be noted rather than modelled.

  **The weighted five-BDC fulfilment rate is 33.9%** — 272,914,552 accepted of 805,871,546 tendered
  — against **Stanger's 38% sector figure**. Third independent corroboration of their published
  numbers, and the second-closest. Not quarter-aligned, though: these five offers expired 8 June,
  15 June, 30 June and 18 September 2026, so any aggregate must key on the expiry or valuation date
  rather than assuming a common quarter.

  **One more trap, which cost time here: the newest `SC TO-I/A` is usually not the final amendment.**
  BCRED's newest, filed 2026-09-03, is a Rule 13e-4(c)**(1)** amendment filing a written
  communication, and carries no figures at all. Nor can the final amendment be told from the cover
  page: the checkbox label *"Check the following box if the filing is a final amendment reporting
  the results of the tender offer"* is present in **every** Schedule TO whether ticked or not, and
  stripping tags discards the tick. Blue Owl's ticked box survives as `&#9746;`, BCRED's does not
  survive at all. **Select the final amendment by the presence of the result figures themselves** —
  self-validating, since the figures are what is wanted — or secondarily by a 13e-4(c)(4) citation,
  which four of five carry. BCRED's quarterly finals are 2026-08-04, 2026-05-01 and 2026-02-02.

- [x] **Spot-check over history: the wording holds, and it showed four more things.** Done
  2026-10-22 with `npm run verify:peer-gating -- --depth 6 --quarters 4`, now a standing command.
  Thirty results filings read — six per BDC, back to Q1 2025 — plus four 10-Qs per REIT. Every
  check passes. The one-quarter observation of 2026-10-21 was right as far as it went; it had seen
  only the bad quarters.

  **Fully-met quarters carry no accepted count, in three different shapes.** When requests fit under
  the cap, no sponsor states how many shares it accepted, because the answer is all of them. BCRED
  and Apollo say *"accepted for purchase 100% of the Shares … validly tendered"*; Blue Owl says
  *"purchased all validly tendered … Shares"*; **HPS says nothing about acceptance at all**, only
  that it paid *"the net asset value … of the total amount of Shares tendered"*. A reader that demands
  a number finds only prorated quarters — which is what happened on the first run, and why it is a
  trap: the resulting series would show a fund gating in every quarter it appears. The rule that
  holds across all five: an accepted count means prorated; no count and no "pro rata" anywhere in
  the results means everything tendered was bought.

  **With that fixed, the history is the gating story itself.** Shares tendered, by expiry, with the
  rate computed from the counts (all five sponsors' own stated rates, where stated, agree to the
  first decimal):

  | Vehicle | Q1 25 | Q2 25 | Q3 25 | Q4 25 | Q1 26 | Q2 26 | Q3 26 |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | BCRED | 23.0M · all | 43.6M · all | 31.8M · all | 85.0M · all | 133.7M · all | **191.8M · 48.5%** | — |
  | Blue Owl OCIC | 21.3M · all | 49.2M · all | 33.8M · all | 108.2M · all | **463.8M · 22.8%** | **395.4M · 26.6%** | — |
  | Apollo ADS | 5.3M · all | 8.4M · all | 16.3M · all | 28.2M · all | **66.9M · 45.2%** | **101.5M · 29.8%** | — |
  | Ares ASIF | — | — | — | 21.6M · all | **45.3M · 43.1%** | **56.9M · 34.7%** | **50.4M · 38.2%** |
  | HPS HLEND | 8.3M · all | 7.4M · all | 7.0M · all | 18.9M · all | **45.6M · 54.0%** | **66.7M · 37.6%** | — |

  Every one of the five met every request through 2025. **Four crossed into proration in Q1 2026 and
  BCRED in Q2** — Apollo's requests rose nineteen-fold in five quarters, BCRED's eight-fold. That is
  the sector turn Stanger reports as a Q2 2026 record, read directly from the filings and a quarter
  earlier for four of five. Expiry dates differ by sponsor (BCRED early in the quarter, Blue Owl the
  last day, HPS and Apollo mid-way), so the columns above are by the quarter the offer expired in.

  **Ares files two results amendments for the same offer**, a month apart and differing in the last
  digits — June 18 2026 on 2026-06-26 and again 2026-07-28; March 20 on 03-27 and 04-17 — a results
  filing and then a corrected one. Keyed on filing date that is two quarters; **key on expiry and
  keep the later filing.** The `representing X%` denominator is consistent within every sponsor over
  the window, and the figures survived every filing-agent template change (Blue Owl used five).

  **BREIT's figure is year-to-date, and the 2025 wording differs.** *"we fulfilled $4.9 billion of
  repurchases requested, including all repurchase requests received for the nine months ended"* —
  "including", where 2026 says "which represents". Three, six and nine-month figures, so a quarterly
  series must difference consecutive 10-Qs and take the 10-K for Q4.

  **SREIT has been closed to ordinary holders since April 2026, and a percentage-keyed reader calls
  that "nothing to report".** Its plan was amended on 2026-04-29 so that *"no repurchase requests
  will be accepted except"* those on death or qualifying disability and accounts under $5,000, up to
  $5.0M a month; it repurchased $4.8M, $2.3M and $2.5M in April–June. No fulfilment percentage
  appears because ordinary holders get nothing. The 10-Q also states, as a standing sentence, that
  requests have exceeded the plan's limits since October 2022. So SREIT needs a fourth shape,
  `plan-restricted`, checked *before* the per-month footnotes — the Q1 2026 10-Q carries both, the
  amendment and the January–March proration percentages. The most gated vehicle of the seven was the
  one the first reader scored as having no gating at all.

- [ ] **The alerts digest** is the other half of step 7 and is not started.
- [ ] **A NAV plausibility guard exists only for NAV.** `looksLikeNav` rejects a net asset value that
  never moves, after HPS was found tagging exactly 1000.00 across six filings. Every other concept
  is trusted as tagged. Worth a sweep if a figure ever looks wrong.
- [ ] **Display grouping of sleeves under their parent fund.** A raise spread across four CIKs is
  counted once, but the registry holds no parent link — grouping for display is step 5 UI work, and
  would need either a `partOf` field or name-prefix matching.
- [ ] **A read-only `/api/peers/v1`** mirroring `/api/analytics/v1`, once the shapes settle.
- [ ] **`peer-intel` to be added to `ENABLED_TABS` on Vercel** — the user decided on 2026-10-26 to
  ship the current state as beta rather than wait for the expansion to finish. The code is merged to
  production; the variable is the user's to set. Previews show the tab regardless.
- [x] **The tab has been reviewed in a browser.** The user confirmed the preview looks correct
  (2026-10-21): five-tab bar, drawer width, layer switch and loading states all fine.

---

## 3a. Carries an impact outside this repo

- [ ] **AMO Tracker should still switch to `band=` on `/api/analytics/v1/behavior-signals`** — no
  longer urgent, but the margin is thin. Its whole-scope national request measured **4,318,145
  bytes (4.12 MB) on 2026-10-26**, past the original 4 MB refusal, which would have broken its FDIC
  page on merge. To ship Peers without that, the refusal was raised to 4,480,000 bytes — the highest
  value safe whether Vercel's "4.5 MB" means decimal or binary — leaving AMO about 160 KB of room.
  The response grows as FDIC data arrives (3.90 → 4.02 → 4.12 MB), so this is a bridge.
  `npm run measure:signals-response` reports the live figure.

## 3b. Build versus buy, and what to borrow — FOR DISCUSSION

Raised 2026-10-21 and **deliberately not acted on**. The user wants to discuss the approach before
any of it is built. This section holds what was established so the conversation does not start from
scratch.

### Commercial products already cover three of the five asks, better than this tool

| The brief's ask | Who does it | Verdict |
| --- | --- | --- |
| Fundraising, fund sizes, progress | Preqin, PitchBook | Better nationally |
| New fund launches | Preqin "funds in market" | Better |
| Evergreen liquidity and gating | **Stanger** | Better on breadth and cadence — **but no longer on access or granularity**, see §3 |
| Portfolio performance | Preqin (IRR/TVPI from LP disclosures) | Better |
| Other developments | With Intelligence, PEI titles | Comparable |

**Stanger publishes the gating figure this tool established cannot be derived from filings.** Their
Q2 2026 data: non-listed BDCs raised $2.0B, the lowest quarter since Q4 2020 and down 82% year on
year; **repurchase requests equalled 12.4% of NAV, a Stanger record, and sponsors met 38% of them**.
They also carry per-fund detail — BCRED's Q1 2026 requests were ~7.9% of NAV and it **raised its
repurchase limit from 5% to 7%** to meet them.

It was first assumed they have it because **sponsors tell them**, which would be a data-acquisition
advantage no engineering closes. **That is now known to be wrong on the requests figure**: every
sponsor is obliged to publish it, and the 2026-10-21 checks in §3 found it for all seven vehicles.
What Stanger actually has is **breadth and cadence** — all public non-listed BDCs plus REITs and
DSTs, assembled quarterly — and that is a labour advantage, which engineering does close.

**Our figures corroborate theirs, now twice over.** Step 6 measured the non-traded tier at −$4.45B
net in Q2 2026 against Stanger's ~−$3.8B sector-wide. And the five BDC final amendments give a
weighted fulfilment rate of **33.9%** against their **38%** sector figure (§3). Different vehicle
sets — they cover all public non-listed BDCs, we cover seven — so the same direction and magnitude
from two independent methods, on two separate metrics.

### Where this tool genuinely wins, and should stay

- **The Miami-Dade and Florida layers.** Preqin and PitchBook are thin on sub-$500M regional
  managers. Discovery surfaced Omnia, Atipana, R&R Capital, Naso and SEGLO, almost certainly absent
  from any vendor database. Preqin does carry a Safe Harbor profile, so the firm itself is covered —
  it is the local peer *set* that is not.
- **Provenance.** Every figure links to the filing it came from; vendor data cannot be clicked
  through to a source.
- **Integration with the FDIC bank analytics**, which no vendor combines, and no annual cost.

### The scope line on "reverse engineering"

Agreed in conversation: studying a vendor's **published methodology and output** to understand what
they measure and why is ordinary competitive analysis and is in scope. **Scraping their databases or
decompiling their applications is not** — that is their copyrighted compilation and their terms of
service. Everything below is derived from public filings or from publicly published methodology.

### Framings worth borrowing

**From Stanger.** Requests as a share of NAV and a fulfilment rate are better metrics than
repurchases-over-portfolio. This previously read "neither is derivable without requests received";
**both are derivable, for all seven vehicles** — confirmed 2026-10-21, see §3. The fulfilment rate
comes from the two share counts in each BDC's Schedule TO final amendment and from BREIT's and
SREIT's 10-Q prose; requests-as-a-share-of-NAV is stated outright by BREIT and Blue Owl and follows
for the rest from requests against the cap. **Cap changes are derivable** too — a sponsor raising
its repurchase limit is a gating signal that does appear in filings.

They also keep non-listed BDCs, non-traded REITs and DSTs separate, where this tool has a single
`non-traded` bucket that mixes BDCs with REITs and makes the aggregate less meaningful. **The
gating work has now made that split structural rather than cosmetic:** the five BDCs are read from
Schedule TO and the two REITs from 10-Q prose, on different periodicities — quarterly against
monthly — so the two kinds cannot share an extractor, a cadence or a column.

**From Preqin.** "Funds in market" with *interim closes* — our Form D/A amendments **are** interim
closes and are simply not labelled as such. Target versus hard cap as distinct fields, where Form D
gives one number and we collapse the distinction. And vintage-over-vintage pacing, below.

### The one idea already proven, from data we fetch today

Safe Harbor's own vintage ladder, pulled 2026-10-21 from the Form D trails already in the tool:

| Fund | Target | Raised | Months in | % of target |
| --- | --- | --- | --- | --- |
| Fund 1 | $20.0M | $10.3M | — | 52% |
| Fund 2 | $50.0M | $24.3M | 71 | 49% |
| Fund 3 | $100.0M | $61.7M | 40 | 62% |
| **Fund 4** | **$300.0M** | **$64.2M** | **28** | **21%** |

**Fund 4 is raising at roughly Fund 3's dollar pace — slightly ahead, $64.2M at month 28 against
$61.7M at month 40 — against a target that tripled.** That is the story behind the $500M → $300M
cut, and it suggests $300M is still ambitious at this trajectory. No vendor would surface it,
because none carries this vintage detail.

**Caveat for the panel:** each fund has only one to five filings, and Fund 2 has two points 71
months apart. The curve shows direction, not a smooth trajectory, and any panel must say so.

### Cannot be derived, at any effort

- ~~**Requests received.**~~ **Struck 2026-10-21 — it can be, for all seven vehicles.** Rule
  13e-4(c)(4) obliges a Schedule TO final amendment to report tender results: shares tendered,
  shares accepted, and whether acceptance was pro rata. That covers the five BDCs. The two REITs
  file no issuer tender at all, but disclose requests and fulfilment in 10-Q prose, BREIT monthly
  and with the cap used alongside. See §3's gating coverage item. This narrows the build-versus-buy
  case further than first thought: Stanger's advantage on this metric is **aggregation and cadence
  across a wider vehicle set, not access, and not granularity** — BREIT's own monthly disclosure is
  finer than Stanger's quarterly sector figure.
- **LP identities.** No filing discloses them — but the legitimate route exists and is how Preqin
  builds its commitments data: public pension and endowment disclosures, from the LP side. Public
  record, real work.

### Proposed order, if the discussion lands on building

Revised 2026-10-21 after the gating checks, which moved gating from "partially rescuable" to
"buildable at full coverage" and made the bucket split a precondition rather than a nicety.

1. ~~**Vintage-over-vintage pacing**~~ — **Done 2026-10-22**, see §1. The one thing on this list
   that needed no new data.
2. **Split the `non-traded` bucket** into BDC and REIT. Promoted from third: the two kinds are read
   from different forms on different periodicities, so gating cannot be built until they are apart.
3. **Gating on Schedule TO for the five BDCs**, computing fulfilment from the share counts and never
   from the "representing X%" phrase. The traps are enumerated in §3.
4. **Gating on 10-Q prose for BREIT and SREIT**, separately, handling both the prorated and the
   fully-met wordings, and labelling SREIT's silent months as an inference.
5. **Cap-change detection** — in filings, and a genuine Stanger framing. No longer a consolation
   prize for gating, so it drops below it.
6. ~~**Label Form D/A amendments as interim closes**~~ — **Done 2026-10-22.** The drawer's filing
   trail and the vintage chart's tooltip now read each amendment against the one before it: a rise
   in amount sold is an interim close with its delta, no rise is the annual re-file, a fall is a
   restatement, and an offering change is said beside it. `classifyFilings` in
   `lib/peer-intel/panel.ts`, catalogued as `closeKind` with the bundling caveat.

The standing alternative — **subscribe to Stanger for the evergreen piece and delete our worse
version** — is weaker than it was. Their edge is now known to be breadth and cadence rather than
access, our figures have corroborated theirs on two separate metrics, and BREIT's monthly
disclosure is finer than anything they publish. Still worth pricing, but no longer the obvious
answer on this ask.

### One caveat on the market picture

Most of what the search returned was vendor marketing. The reported **S&P acquisition of With
Intelligence** rests on a single secondary source. Confirm coverage and pricing with vendors directly
before committing to anything.

## 4. Carried from earlier work

Not part of this expansion, still open.

- [x] **Rotate `ANALYTICS_API_KEY`.** The user is handling this directly (2026-10-21).
- [ ] **Refuse the whole-scope national behaviour-signals response** once it nears Vercel's 4.5 MB
  ceiling; it was 3.9 MB at the last measurement.
- [ ] **Bank Behaviour step 4** — Seller Likelihood score, the four states, and the backtest against
  known 2023–2026 sellers and failures that validates the step 2 thresholds.
- [ ] **Bank Behaviour steps 5–7** — enforcement actions (FDIC / OCC / Fed, monthly); public-bank
  intent from EDGAR and transcripts; weekly alerts digest plus the Cohort Changes third list, the
  screening-table columns and the Pressure-vs-Action scatter.
- [ ] **The screening-table two-cohort decision** — the table shows 1,116 institutions and the
  charts 4,313; the fix was discussed and the decision is still pending.
- [ ] **A cold-cache production look** at Cohort Changes and the institution drawer.
- [ ] **The "CRE / Assets" label.**
- [x] ~~The AOM export questions~~ — **moot 2026-10-26.** The AOM code and data were removed from
  this tool; assignment-of-mortgage work belongs to AMO Tracker.
- [x] ~~The cron scope-casing mismatch.~~ **Struck 2026-10-21, not a bug:** the tab deliberately
  sends `"national"` for screening and `"National"` for visuals, watch and behaviour, and
  `app/api/cron/warm-cache/route.ts` matches both exactly.

---

## 5. Housekeeping and risks found along the way

- [x] ~~`dev` is ahead of `origin/dev`.~~ Fully pushed 2026-10-21 at `a379757`. Production remains
  untouched at `fe0ad1b`; nothing has been merged to `main`.
- [x] **A credential was embedded in plaintext in the `origin` URL** until 2026-10-21, when it was
  removed. The user has decided not to pursue it, on the basis that the repository's data is public
  (2026-10-21). Recorded rather than re-argued, with one distinction noted for whoever reads this
  later: the exposure risk of a GitHub token is write access to the repository, which is independent
  of whether its contents are public. It was masked rather than read, so whether it was a token or a
  bare username is unknown.
- [x] **`gh`'s active account is now `EnriqueColon`** (changed globally on 2026-10-21 so the push
  would authenticate). `RSronin09` is the commit author but has no push access to the repository.
  Switching back with `gh auth switch --user RSronin09` makes pushes 403 again.
- [x] **A stale local `credential.helper = osxkeychain`** remains in this repo alongside the global
  `gh` helper. Harmless, but it is what would resurface a password prompt if `gh` ever fails.
- [x] ~~The broken `competitor_surveillance/connectors/sec_edgar.ts`~~ — **removed 2026-10-26**
  with the framework. Its `keys=` lesson lives on in `lib/peer-intel/edgar-contract.ts`.
- [x] ~~The SQLite `competitor_surveillance` framework and the AOM material are dead weight~~ —
  **removed 2026-10-26** at the user's instruction ("we do not need to bring in Assignments of
  Mortgages into this tool"). 647 tracked files: the AOM / Market Participants cluster (17 code
  files, the `/api/participants-intel` route), the framework (13 files plus its UI, action and seed
  script), two AOM-only Python scripts, two AOM docs, and the data — `data/aom.sqlite`,
  `aom-csv/` (572 of them Apple Numbers internals), `aom-source/`, `participant_intel.sqlite`,
  `competitor_surveillance.sqlite`, `major-banks-exclude.json`. Nothing outside the set imported
  any of it; build passes and typecheck fell from 91 errors to 63 with none new. Git history keeps
  all of it.
- [ ] **Left orphaned by that removal, deliberately not touched:** `better-sqlite3` and
  `@types/better-sqlite3` are now imported nowhere (removing them changes `package-lock.json`);
  `app/actions/fetch-watchlist.ts` lost its only importer; and `ELEMENTIX_API_KEY` is now read by
  nothing, so it can come off Vercel. Each is the user's call.
- [x] **`.gitignore` had two entries concatenated onto one line.** Split 2026-10-21 (`eb2b140`). No
  env file was ever exposed — `.env*.local` on the following line always covered them.
- [ ] **`next-env.d.ts` is tracked**, so the ignore rule above takes effect only once it is
  untracked: `git rm --cached next-env.d.ts`. Next regenerates it on every build, so this is safe,
  but it changes what is in the repo and is left as the user's call.

---

## 6. How to verify any of this

```bash
npm run test:peer-intel-edgar      # EDGAR contract: q= not keys=, locationCodes, retry, layers
npm run test:peer-intel-formd      # Form D: entities, "Indefinite", the Safe Harbor Fund 4 trail
npm run test:peer-intel-registry   # registry: unique CIKs, cumulative layers, quotation, evidence
npm run test:peer-intel-cohort     # aggregation: sleeve counting, coverage, self positioning
npm run test:peer-intel-xbrl       # XBRL: dedup, YTD differencing, reported-wins, net flow

npm run discover:peers                            # propose peer candidates by location and name
npm run lookup:peer -- "Rialto"                   # find one named manager's vehicles
npm run verify:peer-registry                      # live: all 65 vehicles resolve; Fund 4 ties out
npm run verify:peer-raises -- --layer national     # live: every trail, plus the invariants
npm run verify:peer-metrics                       # live: Blue Owl's series against hand-read figures
```
