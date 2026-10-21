# Peer & Private Credit Tracker — status and open items

*As of 2026-10-21. `dev` at `8f3eda9`, pushed through `0d63e33`; `main` unchanged at `fe0ad1b`. Steps 1–5 are committed.
The tab exists but **has not rendered in a browser yet** — the standing rule is to verify on a
Vercel deployment rather than a local dev server, and `dev` is unpushed by choice. Production is
unaffected: `peer-intel` is absent from `ENABLED_TABS`.*

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
| 5 | The tab: Raise Environment, Active Raises, New Launches, manager drawer | **Built** (`94d8f24`), not yet seen in a browser |
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

**Deferred by design.**

- [ ] **Gating is still not shown as a figure.** Whether repurchase requests exceeded what was
  actually paid lives in a filing's narrative, not any tagged value. Both liquidity panels say so.
  The developments feed now surfaces it as *news* — the WSJ reported two Blue Owl funds seeing
  requests above 5% — which proves it is real and currently only visible that way. Extracting it
  from 10-Q text, figure-checked against the XBRL repurchase figure, is the remaining step 7 work.
- [ ] **The alerts digest** is the other half of step 7 and is not started.
- [ ] **A NAV plausibility guard exists only for NAV.** `looksLikeNav` rejects a net asset value that
  never moves, after HPS was found tagging exactly 1000.00 across six filings. Every other concept
  is trusted as tagged. Worth a sweep if a figure ever looks wrong.
- [ ] **Display grouping of sleeves under their parent fund.** A raise spread across four CIKs is
  counted once, but the registry holds no parent link — grouping for display is step 5 UI work, and
  would need either a `partOf` field or name-prefix matching.
- [ ] **A read-only `/api/peers/v1`** mirroring `/api/analytics/v1`, once the shapes settle.
- [ ] **`peer-intel` must be added to `ENABLED_TABS` on Vercel** before the tab renders in
  production. Outside production every feature is on, so a preview shows it without the change.
- [ ] **The tab has not been seen in a browser.** The current preview is
  `https://market-intelligence-tool-5g4cjxdxb.vercel.app` (`2258a34`, built 16:41 UTC). It sits
  behind Vercel Deployment Protection — `/` redirects to `vercel.com/sso-api` — so only a signed-in
  team member can open it and it cannot be checked from a script. **Still needs the user's eyes** on
  the five-tab bar, the drawer width, the layer switch and the loading state. `eb2b140` (the manager
  roster) is newer than that preview and needs another push.

---

## 4. Carried from earlier work

Not part of this expansion, still open.

- [ ] **Rotate `ANALYTICS_API_KEY`** on Vercel and the droplet — it was generated in chat on
  2026-10-07. Blocked on knowing whether AMO Tracker was ever wired up to the data API.
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

- [x] ~~`dev` is ahead of `origin/dev`.~~ Pushed 2026-10-21 through `2258a34`. `eb2b140` is newer
  and unpushed. Production remains untouched at `fe0ad1b`.
- [ ] **A credential was embedded in plaintext in the `origin` URL** in `.git/config` until
  2026-10-21. If it was a token rather than a bare username it should be treated as exposed and
  revoked. It was masked rather than read, so which it was is unknown.
- [ ] **`gh`'s active account is now `EnriqueColon`** (changed globally on 2026-10-21 so the push
  would authenticate). `RSronin09` is the commit author but has no push access to the repository.
  Switching back with `gh auth switch --user RSronin09` makes pushes 403 again.
- [ ] **A stale local `credential.helper = osxkeychain`** remains in this repo alongside the global
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
