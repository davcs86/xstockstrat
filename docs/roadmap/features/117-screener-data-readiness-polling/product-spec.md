# Product Spec: screener-data-readiness-polling

**Created**: 2026-08-08

---

## Problem Statement

Screener scans are on-demand and not persisted (feature 060 FR-9). When a criterion — fundamental
or technical — can't be evaluated because its underlying data isn't available yet, the just-shipped
fix (companion PR #902, `docs/reports/2026-08-08-screener-fundamental-criteria-silently-inert.md`)
correctly reports `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA` and renders a distinguishing badge
("Fundamentals pending" vs "Insufficient data") instead of a misleading OK/passed result. But the
user still has to notice the badge and manually click "Run scan" again later to find out whether
the data has since become available — there's no way to learn that "it's ready now" without
babysitting the tab.

## User Story

As a Screener user, when a criterion (fundamental OR technical indicator/formula) can't be
evaluated because its underlying data isn't available yet, I want the page to keep checking in the
background and update the affected rows live once the data resolves, so I don't have to manually
re-run the same scan over and over to find out.

## Functional Requirements

FR-1. While any result in the current scan is `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA` (either
cause — fundamentals-pending or bars-insufficient/indicator), the Screener page automatically
re-checks in the background on an interval, without the user clicking "Run scan" again.

FR-2. When a re-check resolves a previously-pending row (its status flips to `OK`, or its
`passed`/`score`/`criterion_scores` change), the results table updates in place and the row's
badge changes accordingly — the existing "Fundamentals pending" / "Insufficient data" distinction
from PR #902 stays intact and drives which rows are being watched.

FR-3. Scope covers **both** causes of `INSUFFICIENT_DATA` uniformly: fundamentals unavailable
(`SCREEN_KIND_FUNDAMENTAL`, no `gap`) and bars-insufficient for a technical criterion
(`SCREEN_KIND_TECHNICAL_INDICATOR` or `SCREEN_KIND_TECHNICAL_FORMULA`, has a `gap`) — both are
read-through caches server-side (marketdata `GetFundamentalsMulti` and `GetBars` each fetch-and-
cache on a miss; see `docs/context-constitution.md` PLAT-* / `services/xstockstrat-marketdata/CLAUDE.md`
"live-fallback→cache→reread"), so both can resolve on a later attempt without any user action
server-side.

FR-4. Auto-checking stops once every previously-pending row has resolved (mirrors the existing
`useBackfills.ts` terminal-state polling pattern — `refetchInterval` returns `false`/`null` once
nothing is left to watch), or once a bounded max-attempts/max-duration cap is hit, whichever comes
first — this must never poll indefinitely.

FR-5. Auto-checking must not run when the Screener tab/page isn't the active view (or, at minimum,
must be cheap enough in the worst case that it can't meaningfully threaten the shared FMP daily
request cap (`marketdata.fmp.daily_request_cap`, 250/day) or the Alpaca REST rate limiter
(`marketdata.backfill.rate_limit_rps`) even if left running) — see Open Questions for the exact
mechanism (client visibility gating vs. a hard low-frequency interval vs. a narrower recheck
surface).

FR-6. The user can see that auto-checking is in progress (not just that a badge exists) and can
stop it manually if they don't want to wait.

FR-7. No new persistence of scan state across page loads/sessions — this stays consistent with the
existing stateless-scan design (feature 060 FR-9). "Notified" here means the open tab updates live
while auto-checking runs; it does not mean a durable, resumable-after-navigation, or cross-device
notification (that would be a materially larger feature — new backend state, a way to match
"now available" back to a specific pending scan, and a delivery channel; see the companion
report's "Not in scope" section for why that wasn't built ad hoc off the bug fix).

## Out of Scope

- Persisting screener scans server-side, or notifying a user who has navigated away from the page
  or closed the tab (push notification / `xstockstrat-notify` integration). If this is wanted
  later, it is a distinct, larger feature (durable scan state + a "now available" detector +
  delivery channel) and should get its own `/sdd-story`.
- Any change to how `GetFundamentalsMulti`/`GetBars` themselves resolve data (their read-through
  cache behavior is already correct and is what makes this feature possible at all).
- Actively *triggering* a bars backfill from the Screener on behalf of the user — that's the
  existing `/insights/backfills` page / `trigger_backfill` MCP tool; this feature only re-checks
  whether data has *already* become available (backfilled by something else, or self-healed via
  the on-miss live fetch), it doesn't request new backfills.

## Affected Services

- `xstockstrat-ui` — Screener page (`src/app/insights/screener/page.tsx`), and the
  `useScreenSymbols` hook (`src/hooks/useScreenSymbols.ts`), which is currently a one-shot
  `useMutation` with no polling — the FR-1/FR-4 auto-recheck behavior lives here (client-poll
  design), or is added to a new/adapted hook if design decides otherwise.
- `xstockstrat-analysis` — **conditional**, only if design decides re-checking should hit a
  narrower server-side recheck path (e.g. a request scoped to just the previously-pending
  symbols/criteria) rather than resending the full original `ScreenSymbols` request every poll.
  Not a certain affected service until design resolves the Open Question below.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/insights` segment: Screener page (`/insights/screener`) — the
  existing pending badges (PR #902) gain live auto-updating behavior, plus a visible
  "checking…"/"stop" affordance (FR-6).
- [ ] **Agent** — not in scope. The `screen_symbols` MCP tool already returns the same
  `status`/`gap` fields an agent caller could poll itself if it chose to; no new tool or
  parameter is needed for this feature.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required — **default assumption, pending design.** The simplest design
  re-issues the existing `ScreenSymbols` RPC (same request) on an interval; if design instead
  proposes a narrower "recheck just these pending rows" RPC to reduce redundant compute/quota use
  (Open Question below), this section will need a new/changed RPC.

## Config Key Changes

- [ ] No new config keys — **open question, not yet decided**, see below. A poll interval/max-
  attempts constant could be a UI-only display constant (like the existing `TOP_N` constant in
  `screener/page.tsx`, Floor F-07 unaffected) if it's purely a client cadence with no
  quota/backend-load implication design decides is significant, or a real `analysis.screener.*` /
  `xstockstrat.ui.*`-style config key if the team wants it centrally tunable because it affects
  shared external-API budgets (FMP, Alpaca).

## Database Changes

- [ ] No schema changes — no server-side persistence is planned per FR-7/Out of Scope. If design
  overturns FR-7, revisit this section — and per the `durable-observable-backfills` ledger trap
  (`docs/roadmap/ledger/fails.md`), always `ls` each affected service's `migrations/` directory
  before writing any migration number into a later spec; don't assume the next number.

## Feature Workflow Notes

Branch to create: `feature/screener-data-readiness-polling` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, UI-only in the default/no-proto-change design)
- [ ] 2 service owners + platform lead (breaking proto change) — only if design introduces one
- [ ] DBA review + service owner (schema migration) — only if design overturns FR-7

## Acceptance Criteria

1. Running a scan whose results include at least one `INSUFFICIENT_DATA` row (either cause) starts
   automatic background re-checking; a scan with zero `INSUFFICIENT_DATA` rows never polls.
2. When the underlying data becomes available (verified in a test via a mocked backend that flips
   a previously-`INSUFFICIENT_DATA` symbol to `OK` on a later call), the affected row's badge,
   score, and passed state update without the user clicking "Run scan" again.
3. Auto-checking terminates on its own once every pending row resolves, and also terminates at a
   defined max-attempts/max-duration cap even if some rows never resolve (no infinite polling).
4. The user has a visible way to know checking is active and a way to stop it early.
5. A scan mixing fundamentals-pending and bars-insufficient rows resolves both kinds correctly and
   independently (a row of one kind resolving doesn't affect the other kind's pending state).
6. No regression to the existing PR #902 badge/banner behavior or the stateless-scan contract
   (closing the tab or navigating away and back starts a fresh scan with no memory of the
   previous pending state).

## Open Questions

- [ ] **Client-poll-only vs. a narrower server-side recheck.** Simplest design: the client
  re-issues the exact same `ScreenSymbols` request (all symbols + all criteria) on an interval —
  zero backend changes, but re-scores every already-resolved row too on every poll, which is
  wasted compute and (worse) re-spends FMP/Alpaca budget on symbols that already succeeded.
  Alternative: a narrower request/RPC that only re-checks the still-pending
  `(symbol, criterion)` pairs. Design should weigh implementation cost against the shared external
  API budgets this could threaten (FMP `marketdata.fmp.daily_request_cap`, 250/day, shared across
  *all* fundamentals consumers on the platform, not just Screener) — see FR-5.
- [ ] **Poll cadence and max-attempts/max-duration.** Needs concrete numbers. `useBackfills.ts`
  polls every 4s for an actively-running job; that cadence is far too aggressive for repeatedly
  hitting FMP/Alpaca budgets and should not be reused as-is — design should propose real values
  (likely tens of seconds to minutes, with backoff) and justify them against the quota math.
- [ ] **Config-governed cadence vs. UI constant.** Tied to the above — if the numbers matter for
  shared quota protection, should they be an `analysis.*`/`xstockstrat.ui.*` config key
  (adjustable without a redeploy, but per root `CLAUDE.md` config governance a *new* key needs
  owner + config team approval) or a plain UI constant like `TOP_N`?
- [ ] **"Stop polling" UX** (FR-6) — a dismiss button per pending row, a single page-level "stop
  checking" action, or both?
- [ ] **Known trap** (`docs/roadmap/ledger/fails.md`, `fix-mcp-screener-correctness`): if design
  ends up touching `coverage_gaps` or any other full-result-set diagnostic in `screener.py`, it
  must be computed from the full ranked list *before* `min_conviction`/`rank_limit` truncation,
  not after — that exact mistake already happened once in this file's history.
