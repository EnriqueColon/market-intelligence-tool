# Market Intelligence — orientation

Read this first. It exists so a session does not spend its first thousand tokens rediscovering the
project. Nothing here duplicates the code; it points at what to read and names the traps.

## What this is

A Next app on Vercel, in active use by **Safe Harbor Capital Partners** — a Miami Beach manager that
buys non-performing and sub-performing first mortgages from banks and originates high-yield CRE
financing. Four fund vintages, $500M+ invested, deals of $8.5M–$44M. Lower-middle-market, which
matters: its competitors are regional note buyers and bridge lenders, **not** Blackstone or KKR.

Five tabs, gated server-side by the `ENABLED_TABS` environment variable:

| Tab | Serves | Source |
| --- | --- | --- |
| News | deal sourcing | RSS, GDELT, Google News |
| Market Analytics | deal sourcing — which banks are under CRE stress | FDIC BankFind Call Reports |
| Market Research | deal sourcing | uploaded reports, LLM summaries |
| Legal Landscape | deal sourcing | Federal Register, LegiScan, GPO |
| **Peers (beta)** | **capital raising** — what competing managers are doing | SEC EDGAR |

Peers is the newest and is **absent from production `ENABLED_TABS` by the user's choice** until its
expansion is finished.

## Read in this order

1. **`SESSION.md`, the "STOPPED HERE" block at the top.** Current state, the questions the next
   conversation should start from, and the ordered pick-up list. It is ~90 lines; the remaining 3,600
   are a reverse-chronological history you should read only when you need the reasoning behind
   something specific.
2. **`docs/PEER_TRACKER_STATUS.md`** — the Peers expansion: build order, open items, and §3b, the
   build-versus-buy assessment against Preqin and Stanger.
3. **`docs/BANK_BEHAVIOR_EXPANSION_STATUS.md`** — the Market Analytics behaviour work, steps 1–4
   done, §6 covering the Seller Likelihood backtest.
4. **`ROLLBACK.md`** — what is on each branch and how to revert it. The current-state table at the
   top has drifted twice; confirm with `git log` rather than trusting it.
5. **`confluence.md` §10, Known fragility** — read before touching FDIC, EDGAR or the caches. Every
   entry is a trap that has already cost time.

`README.md` covers setup and repository layout.

## Things that will bite

- **Verify on a Vercel deployment, never a local dev server.** Standing instruction from the user.
  Previews sit behind Vercel Deployment Protection, so only the user can open one — you can confirm a
  build, not what it looks like.
- **`SESSION.md`, `ROLLBACK.md` and `confluence.md` are CRLF.** Writing them as LF produces a
  whole-file diff that buries the actual change. Preserve each file's own endings.
- **SEC EDGAR silently ignores unknown query parameters.** Full-text search takes `q`, not `keys`;
  the location filter is `locationCodes`, plural. A wrong name is dropped and the request succeeds
  with the filter absent. Go through `lib/peer-intel/edgar-contract.ts`.
- **`/api/analytics/v1/behavior-signals` returns 413 for a whole-scope national request** — the
  response is 4.02 MB against a 4.5 MB platform ceiling. **AMO Tracker consumes this endpoint and is
  deployed against production, which does not yet carry the change.** Pushing `dev` is safe; merging
  to `main` is what breaks it. Brief AMO to use `band=` first.
- **Assignment of Mortgage (AOM) work does not belong in this tool.** It lives in AMO Tracker
  (`EnriqueColon/amo-dashboard`, a separate app). The old AOM / Market Participants code and the
  `competitor_surveillance` framework were removed on 2026-10-26 at the user's instruction; do not
  reintroduce AOM sources, panels or data. Ask before touching the AMO droplet.

## Conventions worth matching

Pure logic goes in `lib/` with a `.test.ts` beside it, run through `tsx --test`. Services in
`app/services/` fetch and are uncached; actions in `app/actions/` add `unstable_cache` and are thin.
Readings shown to users are built deterministically from the figures on the panel, never written by a
model. A figure that is not reported renders as "not reported", never as zero. Every value traces to
a named source field or carries its formula — see `lib/peer-intel/catalog.ts`.

`npm run test:*` for units, `npm run verify:*` for live checks against FDIC and SEC. `npm run
backtest:seller` runs the Seller Likelihood score against banks that actually failed.

Update `SESSION.md`, `ROLLBACK.md`, `README.md` and `confluence.md` at the end of every session, plus
the relevant `docs/*_STATUS.md`.
