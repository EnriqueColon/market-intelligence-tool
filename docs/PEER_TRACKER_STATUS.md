# Peer & Private Credit Tracker — status and open items

*As of 2026-10-21, session stopped here. `dev` pushed and level at `a379757`; `main` unchanged
at `fe0ad1b`, so none of this is in production. Steps 1–6 are done and step 7's developments feed with them; gating is
assessed but withheld, and the alerts digest is not started. The user has reviewed the tab in a
preview and confirmed it looks correct. It stays invisible in production until they add `peer-intel`
to `ENABLED_TABS`, which they are doing deliberately once the expansion is finished.*

**Resuming:** see the "STOPPED HERE" block at the top of `SESSION.md` for the ordered pick-up list
and the one item with an impact outside this repo — the signals endpoint now returns 413 for a
whole-scope national request, so AMO Tracker must switch to `band=` before `main` takes that change.

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
which no filing discloses.

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

- [ ] **Form ADV may give per-fund size for the private managers**, which the tab currently treats as
  unavailable. Part 1A Schedule D, Section 7.B.(1) requires a registered investment adviser to list
  **each private fund it manages together with that fund's gross asset value**, and ADV filings are
  public through IAPD. If that holds for these peers it closes a real gap: fund size is presently
  derived only from Form D's `totalAmountSold`, which is cumulative subscriptions rather than assets,
  and says nothing at all once a fund stops amending.

  Two things to establish before relying on it. **The retrieval path is unverified** — the two SEC
  endpoints tried on 2026-10-21 returned a 403 and a redirect, so while the filing requirement is not
  in doubt, how to read it programmatically is. The SEC publishes ADV bulk data, and IAPD serves
  individual advisers; one of those is the way in. And **coverage depends on registration**: an
  adviser below the threshold, or exempt, files no ADV or only a shortened one, so a small
  Miami-Dade manager may be absent where Rialto and Bayview are present.

  Noted after a question about whether the panels' empty states were legal facts or reporting facts —
  which turned out to be the right question, and produced this.

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
  **Schedule TO is the source to move to.** Two things to confirm first: whether the other six
  non-traded vehicles use tender offers the same way — BREIT and SREIT are REITs and may run share
  repurchase *plans* rather than tenders — and how consistent the Rule 13e-4(c)(4) wording is across
  sponsors.

- [ ] **The alerts digest** is the other half of step 7 and is not started.
- [ ] **A NAV plausibility guard exists only for NAV.** `looksLikeNav` rejects a net asset value that
  never moves, after HPS was found tagging exactly 1000.00 across six filings. Every other concept
  is trusted as tagged. Worth a sweep if a figure ever looks wrong.
- [ ] **Display grouping of sleeves under their parent fund.** A raise spread across four CIKs is
  counted once, but the registry holds no parent link — grouping for display is step 5 UI work, and
  would need either a `partOf` field or name-prefix matching.
- [ ] **A read-only `/api/peers/v1`** mirroring `/api/analytics/v1`, once the shapes settle.
- [ ] **`peer-intel` to be added to `ENABLED_TABS` on Vercel** when the expansion is finished — the
  user is doing this deliberately at the end (2026-10-21), so the tab stays invisible in production
  until then. Previews show it regardless.
- [x] **The tab has been reviewed in a browser.** The user confirmed the preview looks correct
  (2026-10-21): five-tab bar, drawer width, layer switch and loading states all fine.

---

## 3a. Carries an impact outside this repo

- [ ] **AMO Tracker must switch to `band=` on `/api/analytics/v1/behavior-signals`.** The three
  Seller Likelihood fields added in `9b8777b` took the whole-scope national response from 3.90 MB to
  4.02 MB, past the 4 MB refusal threshold added in `cc087df`, so that request now returns a **413**
  naming the bands. The bands partition the scope, so their union is the whole cohort. AMO is
  deployed against **production**, which does not yet carry either commit — pushing `dev` is safe,
  **merging to `main` is what breaks it**. Either brief AMO first or hold the merge.

## 3b. Build versus buy, and what to borrow — FOR DISCUSSION

Raised 2026-10-21 and **deliberately not acted on**. The user wants to discuss the approach before
any of it is built. This section holds what was established so the conversation does not start from
scratch.

### Commercial products already cover three of the five asks, better than this tool

| The brief's ask | Who does it | Verdict |
| --- | --- | --- |
| Fundraising, fund sizes, progress | Preqin, PitchBook | Better nationally |
| New fund launches | Preqin "funds in market" | Better |
| Evergreen liquidity and gating | **Stanger** | **Much** better |
| Portfolio performance | Preqin (IRR/TVPI from LP disclosures) | Better |
| Other developments | With Intelligence, PEI titles | Comparable |

**Stanger publishes the gating figure this tool established cannot be derived from filings.** Their
Q2 2026 data: non-listed BDCs raised $2.0B, the lowest quarter since Q4 2020 and down 82% year on
year; **repurchase requests equalled 12.4% of NAV, a Stanger record, and sponsors met 38% of them**.
They also carry per-fund detail — BCRED's Q1 2026 requests were ~7.9% of NAV and it **raised its
repurchase limit from 5% to 7%** to meet them.

They have it because **sponsors tell them**. That is a data-acquisition advantage, not a software
one, and no amount of engineering closes it.

**Our figures corroborate theirs**, which is worth knowing: step 6 measured the non-traded tier at
−$4.45B net in Q2 2026 against Stanger's ~−$3.8B sector-wide. Different vehicle sets — they cover
all public non-listed BDCs, we cover seven — so the same direction and magnitude from two
independent methods.

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
repurchases-over-portfolio, but neither is derivable without requests received. **Cap changes are
derivable** — a sponsor raising its repurchase limit is a gating signal that does appear in filings,
and would partially rescue the withheld gating work. They also keep non-listed BDCs, non-traded
REITs and DSTs separate, where this tool has a single `non-traded` bucket that mixes BDCs with
REITs and makes the aggregate less meaningful.

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

- ~~**Requests received.**~~ **Struck 2026-10-21 — it can be.** Rule 13e-4(c)(4) obliges a Schedule
  TO final amendment to report tender results: shares tendered, shares accepted, and whether
  acceptance was pro rata. See §3's gating item. This also narrows the build-versus-buy case:
  Stanger's advantage on this metric is **aggregation and cadence, not access**.
- **LP identities.** No filing discloses them — but the legitimate route exists and is how Preqin
  builds its commitments data: public pension and endowment disclosures, from the LP side. Public
  record, real work.

### Proposed order, if the discussion lands on building

1. **Vintage-over-vintage pacing** — proven above, free, the clearest win. About half a day.
2. **Cap-change detection** — in filings, and partially rescues the withheld gating work.
3. **Split the `non-traded` bucket** into BDC and REIT so the aggregate means something.
4. **Label Form D/A amendments as interim closes** — wording, an hour.

And the standing alternative: **subscribe to Stanger for the evergreen piece and delete our worse
version**, keeping it only as the free corroboration it has already proven to be.

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
- [ ] **The AOM export questions** from 2026-10-07 are still with the user.
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
- [ ] **`app/ingestion/competitor_surveillance/connectors/sec_edgar.ts` is broken** — it passes
  `keys=`, which EDGAR silently ignores, so it pulls the whole Form D firehose and filters
  client-side. Superseded by `lib/peer-intel/`, not deleted; removing it is a separate decision.
- [ ] **The SQLite `competitor_surveillance` framework and the AOM material are dead weight.** They
  read `process.cwd()` and cannot run on Vercel, and nothing in the tab reaches them: 606 tracked
  files, of which 572 are unpacked Apple Numbers internals under `data/aom-csv/.tmp-numbers/`, plus
  a tracked 4.4 MB `data/aom.sqlite`. The user chose on 2026-10-21 to leave all of it in place.
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
