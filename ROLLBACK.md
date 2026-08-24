# Rollback Reference

Every commit that has reached production or `dev`, with the procedures for reverting. Update at the
end of every session, alongside `README.md`, `SESSION.md` and `confluence.md`.

## Current state

| Branch | Commit | Environment | URL |
| --- | --- | --- | --- |
| `main` | `e8bf8ad` | Production | https://market-intelligence-tool-gilt.vercel.app |
| `dev` | `1a21230` | Preview (no database, no Blob) | build-specific `…vercel.app` preview URL |

A SHA here can never name the commit that writes it, so the true head is usually one documentation
commit further on. Only behavioural commits matter as rollback targets; on `dev` the newest is
**`1a21230`**.

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
| `1a21230` | 2026-08-24 | Newest behavioural commit on `dev`. Opportunity Score ranks by percentile rather than min-max, verified on live FDIC data for Florida and national scope; fixes the map's inverted CRE/Capital colouring and the permanently-null Net Income YoY. **Every score changes at this commit** — rolling back past it restores rankings where 55% of the national cohort sits in one 10-point band. |
| `7286e71` | 2026-08-23 | Last commit before the scoring rework, so scores here are the compressed min-max ones. Reserve Coverage and CRE/(T1+T2) verified figure-by-figure against the live FDIC API. Prefer this over `bb5e5f8`, which renders a Reserve Coverage roughly 30x too large. |
| `bb5e5f8` | 2026-08-23 | Builds clean; charts, pulse strip and map verified against a running server. Roll back to `016d162` to remove the visual layer entirely. **Serves a wrong Reserve Coverage** — avoid unless isolating the visual layer. |
| `e8bf8ad` | 2026-08-21 | Current production. Documentation only on top of `74807d8`, so identical in behaviour. |
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

Not in production. Merge to `main` to ship.

`main` sits at `e8bf8ad`. Everything above it on `dev` is listed here.

| Commit | Date | Summary |
| --- | --- | --- |
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

Complete history of `main`, newest first. 132 commits, first on 2026-03-01.

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
