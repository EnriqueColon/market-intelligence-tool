# Bank Behaviour Expansion — status for review

*As of 2026-10-07, 11:30. Steps 1–3 are in production: `main` and `dev` level at `fe0ad1b` (behavioural head `80743b6`, the data API that AMO Tracker will consume).*

## 1. What we are building, in one paragraph

The Market Analytics tab today measures bank **condition**: CRE concentration, noncurrent loans,
capital, earnings, and the Opportunity / Earnings Resilience / Composite Vulnerability scores built
from them. The expansion adds bank **behaviour**: what each bank is actually *doing* about its bad
CRE loans — moving them to held-for-sale, selling them (at a gain or a loss), charging them off,
foreclosing, or modifying the borrower. A bank under pressure that has not yet acted is a likely
seller of distressed notes or REO in the next one to two quarters; a bank already moving loans to
held-for-sale is a seller now. The purpose is deal sourcing for SHCP: see both before the pool
reaches the market.

Ground rules, all in force: nothing existing on the tab changes (additive only); scores stay
percentile ranks within the selected scope; everything is computed in the weekly cached job over
nine quarters per bank; every figure traces to a Call Report field, and anything derived is
labelled derived.

## 2. Build order and where we are

| Step | Scope | Status |
| --- | --- | --- |
| 1 | Field audit, then ingest the Phase 1 Call Report fields | **Done, committed, pushed** (`c656665`, docs `db373cf`) |
| 2 | Behaviour signals + nonaccrual roll-forward, cached per scope in the weekly job | **Done, committed, pushed** (`4ab576f`) |
| 3 | Balance-Sheet Actions panel in the institution drawer | **Done, committed** (`0d90a59`) — first visible change |
| 4 | Seller Likelihood score, four states (Pre-seller / Active seller / Cleaned up / Stable), backtest against known sellers and failures | Not started |
| 5 | Enforcement actions (FDIC / OCC / Fed), monthly | Not started |
| 6 | Public-bank intent: EDGAR and transcripts | Not started |
| 7 | Weekly alerts digest; Cohort Changes list, table columns, Pressure-vs-Action scatter | Not started |

Steps 1 and 2 are data and computation layers; step 3 is the first visible change — a
Balance-Sheet Actions section in the institution drawer, under the Eight-Quarter Trend. Nothing
else on the tab changes.

## 3. Step 1 — what the audit found

**Every Phase 1 field group is in the FDIC BankFind API we already use.** The FFIEC CDR bulk
file, which the first pass of the audit said would be needed for held-for-sale, is not needed.

| Group | Call Report schedule | BankFind fields | Note |
| --- | --- | --- | --- |
| Loans held for sale | RC 4.a (RCON5369) | `LNLSSALE`; delinquency within it `NALNSALE`, `P3LNSALE`, `P9LNSALE` | Titled "held for **re**sale" in the FDIC catalogue, which is why a search for "held for sale" missed it. Total only; the Call Report has no HFS split by loan type. |
| Net gains/losses on loan sales | RI 5.i | `NETGNSLN` (year-to-date), `NTGLLNQ` (the quarter) | Quarterly figure reported directly; no differencing. |
| Charge-offs and recoveries by CRE category | RI-B Part I | `DR*`/`CR*`/`NT*` × construction, multifamily, nonfarm nonres, non-owner nonfarm; quarter nets `NTRECONQ`, `NTREMULQ`, `NTRENRSQ` | Gross figures are year-to-date; the quarter's own gross is derived by differencing. Owner-occupied is derived as nonfarm less non-owner. |
| OREO by property type | RC-M 3 (RCON2150) | `ORE`, `ORECONS`, `ORERES`, `OREMULT`, `ORENRES`, `OREAG` | |
| Past due and nonaccrual by CRE category | RC-N | `P3*`/`P9*`/`NA*` × the same categories | |
| Modifications to borrowers in financial difficulty | RC-C I M.1; RC-N M.1 | `RSLNLTOT`, `RSCONS`, `RSMULT`, `RSNRES`, `RSCI`, `RSLNREFM`, `RSOTHER`; `P3RSLNLT`, `P9RSLNLT`, `NARSLNLT` | Still titled "restructured" (the pre-2023 TDR label) but it is the live post-2023 series — proven by the tie-out below. |
| Loan servicing | RC-S | `LNSERV` | Low value: RC-S is built for residential and card securitisation and has no CRE whole-loan item. |

**Tie-out to the published Call Report (acceptance check 1).** Using the FFIEC CDR "Call Bulk
Subset of Schedules 2026" file already in your Downloads, five fields were compared with the
filed values for BCB Community Bank (CERT 35541, NJ), Ocean Bank (24156, Miami) and Citizens Bank
Elizabethton (14851, TN), Q1 and Q2 2026: `LNLSSALE` = RCON5369, `ORE` = RCON2150,
`P3RSLNLT` = RCONHK26, `P9RSLNLT` = RCONHK27, `NARSLNLT` = RCONHK28.
**30 comparisons, 0 mismatches.** The check is repeatable: `CDR_SUBSET_DIR=… npm run verify:behavior-fields`.

**What the fields show on real banks.** Community B&T West Georgia went $0 → $57M held-for-sale
over the three quarters before it failed. BCB Community Bank parked $35M in HFS in Q2 2024 with a
$4.8M loan-sale loss, and $10.8M again in Q2 2026 with a $2.6M loss; its commercial OREO dropped
$20M → $5M in one quarter (foreclose, then sell); its modified loans ran $114M → $1.5M as it
cleaned up. Ocean Bank went $0 → $60M of modified loans in Q2 2026.

**Coverage decision, settled by measurement.** The spec asked for all ~4,300 banks rather than the
screening table's largest ~1,100, because small banks are the likeliest sellers. The full national
nine-quarter pull is **40,318 rows, 31 MB, 4,630 institutions in 12.8 seconds** (Florida: 93
institutions in 1.3 s). Full coverage costs nothing meaningful in the cron. What it does constrain
is storage — Vercel's Data Cache allows 2 MB per entry on every plan — which is why the computed
signals are stored in asset-band chunks (section 4).

### What step 1 built

- `FDIC_FIELDS.behavior` (`lib/fdic-config.ts`): a *separate* field list, not additions to the
  shared `financials` list whose cached reduction is already 1.26 MB against the 2 MB ceiling.
  Each field carries its schedule and line in a comment.
- `lib/analytics/bank-behavior.ts`: `BEHAVIOR_FIELD_CATALOG`, the provenance table — one entry per
  output value naming the BankFind field or the derivation formula, the schedule, the basis
  (balance / year-to-date / quarter) and whether it is reported or derived. A typed quarter per
  bank (`null` means not reported, never zero; a null input makes a derived sum null), the
  year-to-date → quarter differencing with Q1 reset and null across gaps, and nine-quarter history
  assembly.
- `app/services/bank-behavior.ts`: one-bank history (one request) and full-coverage cohort pull
  (one request per quarter, three at a time). Uncached by design — raw histories are 31 MB; the
  reductions built on them are what get cached.
- `npm run test:bank-behavior` (9 tests) and `npm run verify:behavior-fields`.

## 4. Step 2 — signals and the roll-forward

**Design decision that shapes everything here.** The spec's acceptance check says *Florida and
national scopes must produce the same signals for the same bank; only scores may differ by
cohort*. So every signal fires on absolute floors and the bank's own history — never on where it
sits among peers. Percentiles within the scope are still computed and attached as context (and as
inputs for the Seller Likelihood score in step 4), but they cannot change a flag.

**The seven signals**, with starting thresholds (gathered in one place, `SIGNAL_THRESHOLDS`, for
the backtest to tune):

| Signal | Side | Fires when |
| --- | --- | --- |
| HFS transfer | action | Held-for-sale rose ≥ 0.25% of gross loans in the quarter **and** is ≥ 1.5× the bank's own high of the prior four quarters (so a mortgage pipeline that always runs HFS does not fire every quarter) |
| Realized sale | action | Loan-sale gains/losses non-zero, and either a loss, or the bank sold in at most one of the prior four quarters (routine mortgage sellers do not fire) |
| CRE charge-off spike | action | Quarterly CRE net charge-offs ≥ 0.5% of CRE loans, or ≥ 0.1% and 3× the bank's own trailing average |
| Unexplained nonaccrual exit | action | CRE nonaccrual fell and the roll-forward residual is ≥ 25% of prior nonaccrual and ≥ 0.1% of CRE loans |
| Foreclosure route | action | CRE OREO rose ≥ 0.05% of CRE loans while CRE nonaccrual fell |
| Modification build | pressure | CRE modifications rose ≥ 0.1% of CRE loans while CRE past-dues were flat or falling |
| CRE runoff | action | CRE loans down > 2% in the quarter **and** > 5% over four quarters, after adding back charge-offs (a sustained shrink, not one payoff) |

**The nonaccrual roll-forward**, per CRE category and in total, every quarter:

> unexplained exit = prior nonaccrual + new nonaccrual − current nonaccrual − charge-offs − transfers to OREO

New nonaccrual is not reported, so the prior quarter's 90+ past due stands in; transfers to OREO
are not reported, so the increase in the OREO balance stands in. Both are named as proxies and
the residual is a flag, not a dollar estimate (cures and payoffs land in it too).

**Verified against live data** (2026-10-07, Q2 2026 filings):

- Known cases fire: BCB Community Bank Q2 2026 → HFS transfer + realized sale; Ocean Bank Q2 2026
  → modification build. Citizens Bank Elizabethton (a routine mortgage seller) fires nothing,
  which is correct.
- Scope independence: all 90 Florida banks × 7 signals judged identically in the Florida and
  national cohorts — 0 differences.
- National compute: 4,603 institutions judged (4,309 current at Q2 2026) in under a second after
  a 7.5 s pull.
- Firing rates nationally: HFS transfer 1.6%, realized sale 2.7%, charge-off spike 2.7%,
  unexplained exit 8.6%, foreclosure route 3.2%, modification build 8.2%, CRE runoff 12.6%.
  166 banks carry two or more action signals (Florida: Amerant, Banesco USA, BayFirst).
- Cache entries: 0.16–0.90 MB per asset band against the 2 MB ceiling (4.02 MB if unchunked).

**Two problems the first run exposed, both fixed and confirmed on the second:**

1. Storage. A summary was 1.2 KB per bank, and the smallest-bank chunk was 2.3 MB — over the
   ceiling. Fixed by storing fired/unjudged signal *keys* instead of seven objects and by moving
   to seven asset bands (<$100M, $100–250M, $250–500M, $500M–1B, $1–3B, $3–10B, >$10B).
2. CRE runoff fired on 26.5% of banks with a one-quarter rule. Requiring a sustained four-quarter
   shrink as well brought it to 12.6%.

**Where it lives:** `lib/analytics/bank-behavior-signals.ts` (+ 17
unit tests, passing), `app/actions/bank-behavior-signals.ts` (cache key `behavior-signals-v1` +
scope + band + quarter, a week, one FDIC pull shared across the bands on a cold cache),
`app/api/cron/warm-cache/route.ts` (warms National and Florida), five RC-C CRE balance fields
added to `FDIC_FIELDS.behavior` as denominators, `scripts/verify-behavior-signals.ts`.

## 4a. Step 3 — the drawer panel

Open any bank from the screening table or Cohort Changes; the new section sits under the
Eight-Quarter Trend. Top to bottom: the seven signal chips for the newest quarter (red = action
fired, amber = pressure fired, outline = quiet, dashed = not judged; the rule is on hover); a
held-for-sale / CRE OREO / CRE modifications chart; the CRE nonaccrual roll-forward as a stacked
waterfall with the nonaccrual balance over it; CRE net charge-offs and loan-sale results; a
signals-by-quarter grid; the roll-forward table in thousands with the latest quarter split by
category; and an **Actions reading**. Copy Snapshot includes the signals and the reading.

The reading is built from the figures on the panel, not by a model, so every number in it is one
you can see in the table above it. Where the roll-forward shows a residual but the exit chip did
not fire, it says why ("23% of the prior balance, under the 25% at which the exit signal fires").

One FDIC call per bank, cached a week per CERT and quarter, about 7.5 KB. The panel needs no
cohort because signals are judged on the bank's own history, so it reads the same in Florida and
national scope.

Not in it yet: the event timeline (enforcement actions, EDGAR, transcripts), which depends on steps
5–6; the footer says so.

**Next:** step 4 — Seller Likelihood score, the four states, and the backtest.

## 5. Decisions made along the way

- FFIEC CDR bulk ingestion dropped: not needed once `LNLSSALE` was found.
- Modification fields accepted on the strength of the exact RC-N tie-out, despite the old title.
- CRE definition for the new rates is the tab's existing one (`computeCreLoans`: construction +
  multifamily + non-owner-occupied nonfarm), so a rate here and a ratio elsewhere agree. The one
  exception is the charge-off rate, whose reported quarter nets cover the whole nonfarm line, so
  its denominator includes owner-occupied nonfarm; this is written down in the code.
- Signals are scope-independent by construction; cohort-relative judgement is reserved for the
  score.
- Full national coverage, stored in asset-band chunks — the same shape the pending
  Tioga-Franklin dropdown fix needs, so one design serves both.

## 6. Open items and risks

- Thresholds are the spec's starting proposals. The backtest (step 4) against known 2023–2026
  sellers and failures is what validates them; expect tuning.
- HFS and realized-sale signals cannot distinguish CRE from residential sales (the Call Report
  does not split them). The own-history rules suppress routine mortgage activity, but a mortgage
  lender's unusual quarter can still fire.
- Unexplained-exit residuals include cures and payoffs; 8.6% of banks firing is plausible for a
  flag but will need the backtest to judge.
- The two-cohort table question (screening table shows the largest 1,116; charts and dropdown
  cover 4,313) is still your decision; the chunked cache built here is the mechanism that would
  fix it.
- Carried from before: first production look at Cohort Changes and the drawer with cold caches;
  the "CRE / Assets" label.

## 7. How to verify any of this yourself

```bash
npm run test:bank-behavior              # 9 tests: catalogue, nulls, YTD→quarter, histories
npm run test:bank-behavior-signals      # 17 tests: roll-forward, each firing rule, scope independence, bands
npm run test:bank-behavior-panel        # 11 tests: the drawer panel's points, roll-forward and reading
npm run verify:behavior-fields          # live values for sample banks; CDR_SUBSET_DIR=… ties to the filed Call Report
COHORT=1 SCOPE=National npm run verify:behavior-fields   # times the full-coverage pull
npm run verify:behavior-signals         # known cases, Florida-vs-national, band sizes, firing rates
```

## 8. Git state

- `main` (production) and `dev`: level at `fe0ad1b` since 11:30 on 2026-10-07. Step 1 `c656665`, step 2 `4ab576f`, step 3 `0d90a59`, then `80743b6` (Market Analytics data API, `/api/analytics/v1/*`, so AMO Tracker renders this tab's data in its own layout — see `confluence.md` → "Market Analytics data API"), plus documentation commits.
- Production state before this work: `8afac5b`.
