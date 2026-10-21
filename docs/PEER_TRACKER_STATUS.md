# Peer & Private Credit Tracker — status and open items

*As of 2026-10-21. `dev` at `ee56247` (pushed through `f9a7540`); `main` unchanged at `fe0ad1b`. Steps 1–5 are committed.
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
| 6 | Evergreen Liquidity and Portfolio Stress panels | Not started |
| 7 | Developments feed, gating narrative, alerts digest | Not started |

Registry today: **26 managers, 65 vehicles, 59 distinct raises**; 25 / 39 / 65 vehicles by layer;
12 registered vehicles (7 non-traded, 5 listed), all national.

Cache entries written by `warm-cache`: `peers:national` (~144 KB, 73s, 340 requests),
`peers:florida` (~110 KB), `peers:miami` (~81 KB) — all far inside the 2 MB per-entry limit, so no
chunking is needed.

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

- [ ] **Payment-in-kind income is tagged by only 2 of 12 registered vehicles.** The PIK-build stress
  signal works for those two and must read "not reported" elsewhere — never inferred.
- [ ] **Portfolio and liquidity are unobservable for every private fund**, which is every Miami-Dade
  and Florida peer. `PRIVATE_FUND_LIMITS` in `lib/peer-intel/catalog.ts` holds the wording.
- [ ] **Gelt Financial's only Reg D raise closed in 2019** at $1.8M; it lends from its own balance
  sheet. The panel should show that raise as long closed rather than as a dormant competitor.
- [ ] **32 of 50 national offerings are "Indefinite"**, so "capital sought" covers only the
  remainder and must always show the excluded count beside it.
- [ ] **`isLikelyOpen` is inferred from four quarters of silence**, because Form D has no closed
  flag. A fund that closed the day after its last amendment reads as open for a year.
- [ ] **The signal thresholds have no backtest**, unlike the bank signals. There is no public record
  of which managers were "right" to be raising, so `PEER_SIGNAL_THRESHOLDS` holds deliberately
  conservative starting values. Worth revisiting once the tab has been read against a few quarters:
  the `dormantQuarters: 12` cutoff and the 40% acceleration share are the two most likely to move.
- [ ] **Net outflow fires on 60% of judged managers nationally**, which is high — but over only five
  judged managers, and it is true. If the registered tier grows, check the rate again.

**Deferred by design.**

- [ ] **Display grouping of sleeves under their parent fund.** A raise spread across four CIKs is
  counted once, but the registry holds no parent link — grouping for display is step 5 UI work, and
  would need either a `partOf` field or name-prefix matching.
- [ ] **A read-only `/api/peers/v1`** mirroring `/api/analytics/v1`, once the shapes settle.
- [ ] **`peer-intel` must be added to `ENABLED_TABS` on Vercel** before the tab renders in
  production. Outside production every feature is on, so a preview shows it without the change.
- [ ] **The tab has not been seen in a browser.** A preview of `f9a7540` built successfully at
  `https://market-intelligence-tool-mpfavtlub.vercel.app`, but it sits behind Vercel Deployment
  Protection — both `/` and `/login` redirect to `vercel.com/sso-api`, so only a signed-in Vercel
  team member can open it, and it cannot be checked from a script. **The user needs to look at it**
  and confirm layout, the drawer width, the layer switch and the loading states. Note `ee56247` (the
  provenance panel and filing links) is not in that preview and needs another push.

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

- [ ] **`dev` is ahead of `origin/dev` by several commits** and the user has chosen not to push for
  now. Production is untouched at `fe0ad1b`.
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
- [ ] **`.gitignore` has `next-env.d.ts.env.local` concatenated onto one line**, so `next-env.d.ts`
  is not actually ignored. `.env*.local` on the next line still covers the env files.

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
