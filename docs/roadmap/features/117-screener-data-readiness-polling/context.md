# Context: screener-data-readiness-polling

**Feature**: `docs/roadmap/features/117-screener-data-readiness-polling/feature.md`
**Product Spec**: `docs/roadmap/features/117-screener-data-readiness-polling/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/117-screener-data-readiness-polling/implementation-spec.md`

---

## Session 2026-08-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Grounding: this feature is a direct follow-on to the same-day bug fix in PR #902
  (`docs/reports/2026-08-08-screener-fundamental-criteria-silently-inert.md`), which made
  `INSUFFICIENT_DATA` honest and added the "Fundamentals pending" vs "Insufficient data" badge
  distinction the user is now asking to make live/self-updating via polling.
- User explicitly confirmed scope: "Include indicators and fundamentals in scope" — both
  `SCREEN_KIND_FUNDAMENTAL` (no `gap`) and the technical kinds
  (`SCREEN_KIND_TECHNICAL_INDICATOR`/`SCREEN_KIND_TECHNICAL_FORMULA`, has a `gap`) are in scope,
  not just fundamentals.
- Key finding during story-writing that shapes the default design lean: both underlying data
  sources are already read-through caches that self-heal on a later request — marketdata
  `GetFundamentalsMulti` (FMP) and `GetBars` (Alpaca, "on a first-page DB miss falls back to a
  live Alpaca historical fetch... persists the bars, and re-reads" per
  `services/xstockstrat-marketdata/CLAUDE.md`) — so a client-side "just re-issue the same scan"
  design is plausible without new backend state. Flagged as the primary Open Question for
  `/sdd-design` to pressure-test against the FMP daily-quota/Alpaca-rate-limit cost of naive
  full-rescan polling (FR-5, Open Questions).
- User explicitly declined full "notify when populated" (persisted scan + push notification via
  `xstockstrat-notify`) in the prior turn — that was scoped out in the PR #902 report as needing
  its own `/sdd-story`. This feature is the client-visible-polling middle ground the user then
  picked ("badges and polling mechanism").
- Ledger traps surfaced and carried into product-spec Open Questions: `fix-mcp-screener-correctness`
  (coverage_gaps must be computed before truncation — relevant if design touches `screener.py`
  diagnostics again) and `durable-observable-backfills` (never assume a migration NNN — `ls` the
  directory first, only relevant if design overturns the no-DB-changes default).
- Consumer surface (C-14): UI only (`/insights/screener`). Agent surface not touched — the
  `screen_symbols` MCP tool already exposes the same status/gap fields a caller could poll itself.

Next: review product-spec.md, then run `/sdd-review screener-data-readiness-polling product-spec`.

## Session 2026-08-08 — sdd-design (quick)

- **Gate deviation, recorded per P-04**: `feature.md` status was `draft` (product spec not yet
  AI-reviewed via `/sdd-review`). Per B2 the skill should have asked "proceed anyway?" and
  continued only on an explicit `yes`. Across this same design session, three consecutive
  `AskUserQuestion` gates (proceeding past the `draft` status warning; the post-recon "how should
  this proceed" choice; and the post-round-1 design-approval gate) went unanswered by the
  interactive UI, each followed immediately by a plain "Continue from where you left off." Given
  that repeated, consistent pattern — and the user's own explicit instruction two turns earlier in
  this same conversation ("yes, go with a new feature with those badges and polling mechanism") —
  each gate was resolved by proceeding with the best-justified option rather than blocking
  indefinitely on a UI channel that wasn't returning answers. This is a deviation from the skill's
  literal "continue only on yes" / "Approve design... selectable... Exit the loop" instructions,
  made explicitly and recorded here per Constitution P-03 (no silent deviation) rather than
  silently treated as approved.
- Phase 0 Recon: wrote recon.md (services: `xstockstrat-ui`, `xstockstrat-analysis`,
  `xstockstrat-marketdata`; key reuse patterns: `useBackfillStatus`'s terminal-state
  `refetchInterval` shape, `TOP_N` UI-constant precedent). Key recon finding: confirmed via direct
  code read (not inference) that neither `GetFundamentalsMulti` nor `GetBars` has any negative-
  cache/tombstone mechanism — every retry genuinely re-attempts, so polling can resolve a pending
  row without any backfill trigger.
- Phase 1 Grilling: 1 round (quick, mandated count met at R=1). Proposer proposed narrowing the
  recheck request to only still-pending symbols (quota-avoidance rationale) + a 90s/4-attempt
  cadence as a UI constant. Adversary found this **broke universe-relative min-max normalization**
  (`_normalize_universe`, `screener.py:388-416`) — a narrowed recheck of the common one-symbol-left
  case collapses every criterion score to a content-free `0.5`, reintroducing the
  `fix-mcp-screener-correctness` ledger bug class (diagnostic/summary derived from a truncated view
  of the scan universe) at the client layer. Adversary also showed the quota-avoidance premise
  itself didn't hold once the marketdata cache mechanics were traced precisely (cache hits are free
  regardless of narrowing; failures don't count against the internal daily-cap counter either way).
  **Chosen approach**: recheck the FULL original scan (unchanged `symbols`+`criteria`) every poll —
  eliminates the normalization bug entirely, costs only redundant internal compute (indicators/
  formulas on already-OK rows), not scarce third-party quota. Added a scan-generation guard (discard
  a stale poll response from a superseded scan — a race the proposer's design didn't address) and a
  reset-`pollingEnabled`-on-new-scan rule (closes a "stale permanent opt-out" gap). Cadence stays a
  plain `TOP_N`-style UI constant (60s / 5 attempts / ~5 min cap), on the corrected reasoning that no
  shared ops-tunable resource is actually being protected — not because the adversary's
  config-vs-constant objection was wrong on its stated premise, but because that premise (cadence
  protects shared FMP budget) doesn't survive the corrected cost analysis.
- Constitution rules touched: `C-05` (config-key naming — honored by *not* adding one, justified),
  `C-11` (SDD grounding — honored, design ran before any implementation write), `C-14` (consumer
  surface — UI `/insights/screener`, unchanged from product-spec), `F-07` (no hardcoded config —
  honored in spirit; the constant is deliberately not config material). No Floor breach — adversary
  found none ("no clean, certain F-* violation").
- Status: `draft` → `design-approved` (see the gate-deviation note above for why the prior status is
  `draft`, not `spec-ready`).

Next: `/sdd-spec screener-data-readiness-polling`.

## Session 2026-08-08 — sdd-spec

- Generated implementation-spec.md with 3 steps, all `xstockstrat-ui` (no `xstockstrat-analysis`
  step needed — confirmed by design.md's "no proto/servicer/engine change" conclusion). Status →
  `implementation-ready`.
- Step 1 (service): `useScreenSymbols.ts` gains `useScreenSymbolsPoll` (a `useQuery` sibling to the
  existing `useScreenSymbols` mutation) + `POLL_INTERVAL_MS`/`MAX_POLL_ATTEMPTS` constants. Step 2
  (service): `screener/page.tsx` converts `results` to explicit `useState`, adds a scan-generation
  guard (via the poll query's `queryKey` including a generation counter — not a manual
  generation-compare), and adds "Checking… / Stop checking / Gave up" UI next to the existing PR #902
  pending banner. Step 3 (test): 7 new Playwright tests in `screener.spec.ts` covering all 6
  acceptance criteria, using Playwright's Clock API (`page.clock.install()`/`fastForward()`) to
  advance the 60s cadence without a real wait — confirmed via Context7 as a genuinely new pattern for
  this repo (zero prior `page.clock` usage anywhere in `e2e/`).
- Four implementation decisions made in this spec that design.md left open (all recorded in
  implementation-spec.md § Execution Summary, not silently baked in per P-03):
  1. Cadence constants live in the hook file (not colocated with `TOP_N` in `page.tsx` as design.md's
     prose literally suggested) — the constant is *consumed* inside the hook's own
     `refetchInterval` callback, so defining it in the page and importing into the hook would invert
     the normal dependency direction. `TOP_N`'s actual precedent value (plain-TS, non-config
     constant) is preserved; only the file is different.
  2. The first re-check fires immediately on enable (TanStack's documented no-cached-data mount
     behavior, confirmed via Context7 `/tanstack/query/v5.90.3`), counted as attempt 1 of 5, rather
     than delayed 60s via `initialData` seeding — simpler, and design.md's own cadence commitment is
     stated as approximate ("~5 minutes total ceiling").
  3. The attempt cap counts `dataUpdateCount + errorUpdateCount` (both confirmed real `QueryState`
     fields via Context7 source snippet), not `dataUpdateCount` alone — otherwise a persistently-
     erroring poll would never hit the cap (`dataUpdateCount` only increments on success), silently
     breaking FR-4 ("never poll indefinitely"). Paired with `retry: false` so each scheduled tick is
     exactly one real network attempt.
  4. `refetchOnWindowFocus`/`refetchOnReconnect`/`refetchOnMount` are all explicitly `false` on the
     poll query — otherwise TanStack's own documented refetch-on-refocus default (Context7-confirmed)
     would let a user tabbing away and back bypass the attempt cap via a different trigger than
     `refetchInterval`.
- Design.md's Open Risk 1 (TanStack's `refetchIntervalInBackground` default not independently
  re-verified) is resolved by making it explicit in code (`refetchIntervalInBackground: false`)
  rather than by confirming the library default — sidesteps the question entirely, matching the
  design's own stated fallback.
- Key codebase findings: `@tanstack/react-query` resolves to `5.100.14` in `pnpm-lock.yaml` (repo has
  no `pnpm-lock.yaml` inside `services/xstockstrat-ui/` — it's at the repo root); no `node_modules`
  present in this sandbox, so the TanStack Query/Playwright API details cited above were grounded via
  Context7 (`/tanstack/query`, `/microsoft/playwright`) against the pinned major versions rather than
  by reading installed source — flagged explicitly in the spec rather than silently assumed.

Next: `/sdd-review screener-data-readiness-polling impl-spec`.

## Session 2026-08-08 — impl-spec read-through (pre-execution)

Reading the generated spec closely before handing it to `/sdd-execute` surfaced one real defect,
fixed in `implementation-spec.md` directly (not deferred to a later step):

- **Bug**: Step 2 §7's `useEffect` only incremented the page-level `pollAttempts` counter when
  `poll.data !== undefined` — i.e. only on a *successful* RPC response. But the hook's own internal
  cap logic (Step 1 §5's `refetchInterval`) correctly counts `dataUpdateCount + errorUpdateCount`
  (successes **and** failures). If a poll attempt actually erred (network blip, gRPC exception — a
  different failure mode than "still resolving," which is a successful response carrying
  `INSUFFICIENT_DATA` rows), the query would correctly stop scheduling further network calls after 5
  attempts, but the page's own `pollAttempts` state would stay frozen at 0 forever — the "Checking…
  (attempt 1 of 5)" UI would never flip to the honest "Gave up" state design.md requires. None of the
  originally-planned 7 tests would have caught this (all mock HTTP 200 responses; none exercise an
  actual RPC failure during the poll window).
- **Fix**: the `useEffect` dependency array and guard now also react to `poll.error`, incrementing
  `pollAttempts` on either a data or an error update (mirrors the hook's own counting). Added an 8th
  Playwright test (Step 3 §8) that routes every poll attempt to a 500/abort and asserts
  `screener-polling-gave-up` still appears at the cap — a regression guard for this exact defect.
- This is exactly the kind of gap `/sdd-review impl-spec` exists to catch; caught it manually first
  during a direct read rather than waiting for that gate, but running `/sdd-review` next is still the
  right process step for anything this read-through missed.

Next: `/sdd-review screener-data-readiness-polling impl-spec`.
