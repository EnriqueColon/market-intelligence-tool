# Next version — a tool that four departments can act on

Working plan, agreed 2026-08-24. Tracks the evolution of the tool from a single undifferentiated
dashboard into one that serves underwriting, investor relations / business development,
accounting / finance and senior executives — **additively**. Nothing currently in the tool is
removed; the existing four tabs stay exactly as they are.

Update the status markers as phases land. `SESSION.md` records what actually happened; this file
records what we intend.

---

## The problem this solves

The tool presents data uniformly and leaves interpretation to the reader. That works for someone who
already knows what they are looking for and is expensive for everyone else. Four departments arrive
with four different questions and are handed the same thirty-column table.

Three structural facts, verified in the codebase on 2026-08-24, explain why the tool reads as
informational rather than actionable:

- **It has no idea who you are.** A single shared `APP_PASSWORD`, a cookie compared against
  `COOKIE_SECRET`, and no users table. Every visitor is the same anonymous visitor.
- **It has no memory.** `app/actions/watchlist.ts` writes to `data/watchlist.json` on the filesystem,
  which is read-only and ephemeral on Vercel — so it works locally and **silently does nothing in
  production**. It is only wired into orphaned components.
- **It cannot reach anyone.** `resend` is a dependency; no code imports it.

Together those make the tool a **cold snapshot**. Every visit shows the current state. It cannot say
what changed since you last looked, cannot remember what you care about, and cannot tell you when
something moves. Role-specific dashboards built on that foundation would be four cold snapshots.

## What each department decides

Insight has to attach to a decision or it is just more data.

| Department | Arrives asking | Decides |
| --- | --- | --- |
| Underwriting | Is this credit sound, and what is the downside? | Approve, decline, or price |
| IR / Business Development | Who should I call, and why now? | Where outreach goes |
| Accounting / Finance | What is our exposure, and can I tie it out? | Reporting and reconciliation |
| Senior Executive | What changed, and what needs me? | Where people and capital go |

Underwriting and finance are **depth** users — one institution, verify the number, trust the
provenance. IR/BD and executives are **breadth** users — rank, direction, what moved. Two shapes, not
four.

## Architecture: one data layer, four lenses

**Rejected: four separate dashboards.** It quadruples the surface area, and the same figure rendered
in four places will drift. That is precisely the failure that produced the Reserve Coverage bug,
where one wrong metric appeared in six places simultaneously.

**Chosen: one data and scoring layer with department-shaped entry points**, composed from the same
components. A lens is an additional home view, never a replacement — an executive who wants the
underwriter's table can still reach it.

The unifying primitive is **change over time against a set of things you care about**. It renders
differently per department but is one capability underneath.

This is also what gives "opportunities and potential opportunities" a concrete definition:

- **Opportunities are level-based** — already distressed. High CRE concentration, thin capital,
  deteriorating credit, right now.
- **Potential opportunities are trajectory-based** — not distressed yet, but moving the wrong way.

The second is the more valuable half and nothing in the tool surfaces it today. The data is already
in hand: the screening table fetches eight quarters per institution to draw its sparklines and
otherwise discards the history.

## Identity model

**Department selection, not user accounts.** The user picks a department; the tool shapes itself
accordingly. This avoids user management entirely.

- Stored in a **cookie, not `localStorage`** — deliberately, so `app/page.tsx` can read it
  server-side and render the correct view immediately rather than flashing the wrong one.
- Persistence keyed by department, so **watchlists and flags are shared within a department**.
  Agreed as intended: the team's context survives any individual being away. The trade is that there
  is no private workspace and no attribution unless we add it later.

---

## Phase 0 — Make the ranking real

**Status: done, `1a21230`, 2026-08-24.** No new UI. Everything after this inherits it.

Outcome, measured on live FDIC data: nationally the cohort above 70 went from 1 institution out of
1,215 to 108, the IQR widened from 8.1 to 20.8 points, and the most crowded 10-point band fell from
55% to 25%. Two defects surfaced while measuring — the map's inverted CRE/Capital colouring, and a
Net Income YoY input that could never be computed — both fixed. The tab/export cohort gap was
measured rather than fixed and is carried into Phase 1; see `SESSION.md` for the numbers.

The tool is about to grow surfaces whose entire job is ranking opportunity. The ranking does not
currently work.

1. **Fix score discrimination.** `metricRange` in `app/actions/export-market-analytics-report.ts`
   normalises each input against the cohort's raw minimum and maximum, so a single extreme
   institution stretches the scale and compresses everyone else. Florida Q1 2026 produces a median of
   51.6, an interquartile range of 47.4–56.5 and **nothing above 80** — roughly 4,000 of 4,543
   institutions inside three adjacent bands. Replace with percentile ranking within the cohort.
   - This **changes every existing score**. Keep the prior value visible during the transition.
   - The report narrative's "70+ screening cohort" language must be updated to match the new
     distribution, or it will describe an empty set.
2. **Un-zero the live-tab scores.** `opportunityScore`, `earningsScore` and `vulnerabilityScore` are
   hardcoded to `0` in `market-analytics.tsx`; the real computation exists only on the export path,
   so the institution drawer shows zeros. Extract the scoring into a shared `lib/opportunity-score.ts`
   called by both, which also removes a duplication risk of the kind that caused the Reserve Coverage
   bug.
3. **Reconcile the tab and the export.** The tab caps at 5,000 rows sorted by assets descending while
   the export paginates the full set, so the same scope yields different counts and averages — and
   the institutions dropped are the small ones, where concentrated CRE risk actually lives.
4. **Cache `buildReportData`** with `unstable_cache`, following the pattern used by nearly every
   other action. Also removes the ~11s Visual Analysis load on National scope.

## Phase 1 — Memory and change

**Status: done, `703bed6`, 2026-08-24.** Capability only; none of it is surfaced in a view yet,
which is Phase 2.

One assumption in the original plan was wrong. `data/watchlist.json` is not an empty user watchlist
to migrate — it is curated reference data, 45 named distressed-credit firms with aliases and
categories, used to match news and counterparties. It belongs in the repository as a file. Tracking
FDIC institutions by CERT is a different thing and is what went into Postgres.

`app/actions/watchlist.ts` was a landmine: orphaned, but if anything had called it, it would have
overwritten that curated file with a flat array of strings and destroyed the aliases and categories.
It has been deleted. The live loader is `app/lib/watchlist.ts`, which is read-only.

Thresholds in the change engine were calibrated against live cohorts, not chosen by eye. Texas gives
4.1% of institutions a supervisory crossing and 19.1% a trajectory. Calibration is also what showed
that a relative movement filter is not enough — a metric starting near zero makes any increase look
enormous — so trajectories now require an absolute materiality floor as well.

1. **Department selector** in the header beside the scope selector; cookie-persisted and
   server-readable.
2. **Quarter-over-quarter deltas** per institution — score, CRE concentration, credit quality,
   reserves, capital. FDIC data is immutable once published, so it caches cleanly per quarter.
3. **Watchlist to Postgres**, keyed by department, replacing the filesystem version. Degrade through
   the existing `isDbEnabled()` pattern so local development still runs without a database.
4. **The change engine**, producing two distinct classes:
   - **Crossings** — passed a threshold that means something externally, e.g. CRE concentration above
     the 300% regulatory guidance level.
   - **Trajectories** — third or fourth consecutive quarter of deterioration with nothing crossed
     yet. This is the early-warning half.

## Phase 2 — The four lenses

**Status: Executive Brief complete; three remaining.** Built from existing components. The current
tabs are untouched.

- **Executive Brief** — **done.** `components/lenses/executive-brief.tsx` over
  `app/actions/executive-brief.ts`. Renders above the tabs when the selected department is
  Executive, and replaces nothing: every tab stays reachable. Three ranked sections — supervisory
  crossings, watch-level crossings, deterioration — capped at six each, because a brief that needs
  scrolling is not a brief. Deliberately no thirty-column table.

  Ranking is the part that took the thought. Crossings rank by how far past the level the
  institution landed, not by the size of the quarterly step: ranking by step puts an institution
  that jumped from near-zero at the top, and that is nearly always a reporting artifact. The
  comparators live in `lib/scoring/institution-change.ts` (`rankBySeverity`, `rankByRun`,
  `groupForBrief`) so `scripts/verify-executive-brief.mjs` exercises the shipped code rather than a
  copy of it.

  Nationally this sees ~1,113 institutions, not all ~4,400 — nine quarters against a 10,000-row FDIC
  cap, less the ~100 that did not file for the latest quarter and are excluded rather than having a
  stale movement dated forward. The brief says so on its face rather than implying full coverage.
  Fixing it properly needs pagination, which is still open.

  Entries are clickable and open the institution profile drawer owned by the Market Analytics tab,
  via a `focusCert` handed down through the dashboard. The lens does not render its own drawer: the
  drawer's figures are percentiles against a cohort, and a second cohort would make one institution
  read at two different percentiles. This is the pattern the remaining three lenses should follow —
  hand off to the view that already owns the detail. It works because both sides select the same
  cohort, so a change to either side's cohort rule breaks it; the failure is surfaced in the card
  rather than swallowed.
- **Underwriter Workbench** — institution-first; the drawer already carries peer comparison and
  eight-quarter trends. Adds a defined peer cohort (size band, geography, CRE mix), threshold flags,
  and a downside scenario on CRE marks.
- **Origination Targeting** — a ranked call list with the reason attached. Revives the orphaned AOM
  assignment-of-mortgage data (`fetch-aom-data.ts`, `competitor-analysis.tsx`), currently
  SQLite-backed and unreachable in production. Who is selling loans to whom is the only genuine
  relationship intelligence in the codebase.
- **Exposure & Reporting** — aggregation with provenance. The export path already paginates fully and
  the appendix already carries definitions; the addition is field-level traceability, which
  `lib/noncurrent-debug.ts` already proves is possible per institution.

## Phase 3 — Actionable

**Status: not started.**

- Flags and notes per institution per department.
- A scheduled digest to a per-department distribution address — Resend is already a dependency and
  the cron infrastructure already exists, so this is smaller than it sounds.
- Per-lens export.

---

## Risks to hold onto

**Do not put department into a cache key.** Keying caches by department multiplies every entry by
four. Cache the data; shape it in the component.

**Re-scoring changes rankings people may already have opinions about.** Keep the previous score
visible through the transition rather than silently swapping it.

**Postgres is absent on `dev` by design.** Every new persistence path must degrade rather than fail,
following `isDbEnabled()`.

**Nothing is removed.** The instruction was explicit: this builds on what exists. Any change that
takes a capability away is out of scope, however tempting.
