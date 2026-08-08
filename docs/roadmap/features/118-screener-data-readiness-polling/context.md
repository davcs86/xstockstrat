# Context: screener-data-readiness-polling

**Feature**: `docs/roadmap/features/118-screener-data-readiness-polling/feature.md`
**Product Spec**: `docs/roadmap/features/118-screener-data-readiness-polling/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/118-screener-data-readiness-polling/implementation-spec.md`

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

## Session 2026-08-08 — sdd-review impl-spec (advisory)

- Result: 0 blockers, 2 warnings, 1 note (advisory — did not block). No `F-*` Floor risk found.
  Overlap scan: clean (no shared file/config-key/proto-field/migration collision with any other
  in-flight feature; only other `implementation-ready`/`in-progress` feature,
  `096-position-and-order-detail-pages`, touches a fully disjoint file set).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 3: `e2e/fixtures/INVENTORY.md` lists "Screener results" under "Not yet centralized"
    (C-12) — [x] resolved: added `e2e/fixtures/screenResults.ts` (3 single-arg factories) + an
    `INVENTORY.md` Files entry to Step 3 directly, rather than leaving it for `/sdd-execute` to
    discover.
  - Step 3 Tests 2/5/8: a genuine timing race — `page.clock` virtualizes page timers only, not how
    fast a mocked `page.route` handler resolves in real Node time, and the immediate first poll
    (Execution Summary decision #2) isn't gated by any page timer at all — [x] resolved: reworked
    `mockScreenSequence` (and the new `mockScreenInitialThenErroring` for Test 8) to delay every
    response after the first by 150ms real time, giving Playwright's assertions a deterministic
    window to observe the transient "checking" state before it flips.
  - Step 3 Verification: test-count prose was wrong ("8 new tests" / "9 pre-existing") — [x]
    resolved: corrected to 7 new tests (§2–§8; §0–§1 are fixture/helper setup) and 10 pre-existing
    (confirmed by the reviewer's own grep).
- This spec-reviewer subagent's Step 1/Step 2 bug-hunt (explicitly asked to look for "any remaining
  bug like the one already caught") re-traced the `poll.error` fix above line-by-line and found no
  further logic errors — independent confirmation, not just self-report.
- All three findings above were fixed directly in `implementation-spec.md` rather than left as
  `[ ] unaddressed` for `/sdd-execute` to pick up — a deliberate deviation from this skill's default
  "advisory only, record and move on" flow (recorded per P-03): none of the three needed a design
  decision or user input, all were mechanical corrections to an as-yet-unexecuted plan, so fixing
  them immediately was strictly better than shipping a known-wrong spec forward. No code has been
  written yet — implementation-spec.md is still pre-execution.

Next: `/sdd-execute screener-data-readiness-polling` (or `next`/a step number).

## Session 2026-08-08 — sdd-execute boot (sequential mode) — branch deviation

**Deviation from Constitution C-06 ("branch from `main-dev`, never `main`"), recorded per P-03
before any code write:** `/sdd-execute`'s boot sequence checks out `main-dev` to fetch the
authoritative spec files, which reverted the working tree to `main-dev`'s committed state — and
confirmed by direct observation that `main-dev` does **not** yet have PR #902's changes
(`screener.py`'s `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA`/`gap` fix, `page.tsx`'s "Fundamentals
pending" badge). This feature's entire recon.md/design.md/implementation-spec.md were written
assuming that state already exists (they cite `page.tsx:509-522`, the `gap`-presence contract,
etc.) — building `feature/screener-data-readiness-polling` from vanilla `main-dev` would either
fail Phase 1 discovery (symbols not found → blocked) or require silently re-doing #902's
already-tested fix inline, duplicating work.

**Resolution**: `feature/screener-data-readiness-polling` was branched from
`claude/screener-criteria-filtering-7ydsuz` (PR #902's branch) instead of `main-dev`. This is the
same real-world situation `docs/roadmap/features/merge-order.md`'s Blocking Dependencies table
exists to track (a feature stacked on another unmerged feature) — recorded there as a new row
(`screener-data-readiness-polling` → PR #902) even though #902 has no `docs/roadmap/features/`
entry of its own (it's a Track C bug-fix report, not a numbered feature). **118's own integration
PR to `main-dev` must not be created/merged before PR #902 merges** — when #902 merges first (as
expected, since it's already fully tested and PR-reviewed-ready), `feature/screener-data-readiness-polling`'s
history naturally becomes a superset that rebases/merges cleanly; the ordering constraint is
purely "don't merge 118 first," not a code conflict.

Next: TOOLING SETUP → Step 1.

## Session 2026-08-08 — sdd-execute re-spec gate (§5.3)

**Second discovery from the same `main-dev` merge**: beyond the branch-origin issue above, merging
`origin/main-dev` into `feature/screener-data-readiness-polling` surfaced a genuine **feature-number
collision** — `docs/roadmap/features/117-screener-fundamental-metric-selector/` already exists on
`main-dev`, `code-completed`, built and merged by a different session on 2026-08-07/08 entirely
independently of this one. Both `/sdd-story` runs computed `max(existing NNN)+1` at a time when
neither could see the other's in-flight work.

- **Renumbered**: this feature `117` → `118` (`git mv docs/roadmap/features/117-screener-data-readiness-polling
  docs/roadmap/features/118-screener-data-readiness-polling`), per the Feature Numbering collision
  rule (root `CLAUDE.md` — the not-yet-executed feature renumbers, not the `code-completed` one).
  Fixed every internal self-reference (`feature.md`/`context.md`/`implementation-spec.md` path
  strings, and "feature 117"/"117's" prose in implementation-spec.md's code-comment instructions —
  those comments get typed literally into `page.tsx`/`useScreenSymbols.ts`/`screener.spec.ts`, so a
  wrong feature number there would ship into the codebase). Added a `merge-order.md` Blocking
  Dependencies row recording the collision and its resolution.
- **Real file-overlap, not just a number clash**: `117-screener-fundamental-metric-selector`
  converts the Screener page's Fundamental-kind metric-name field from free-text `<Input>` to a
  `<Select>` dropdown (`FUNDAMENTAL_METRICS` catalog) — a change entirely inside the criterion-row
  rendering block of `page.tsx`, textually disjoint from anything this feature's Steps 2/3 touch
  (state management, the results derivation, the results-table/banner JSX). The merge (`git merge -X
  ours origin/main-dev`) applied cleanly with **no conflict markers** — verified directly (grepped
  for `<<<<<<<`/`=======`/`>>>>>>>` across the three affected files, zero hits) and confirmed both
  sides' changes are present in the merged file (the `FUNDAMENTAL_METRICS` Select block AND this
  session's `pendingFundamentals`/badge logic both read back correctly).
- **Re-spec performed (conditional — evidence only)**: their edit shifted every `page.tsx` line
  number below the insertion point. Re-verified every `path:line` citation in
  `implementation-spec.md` Steps 1-3 by direct `grep -n` against the current (post-merge) file —
  not computed/estimated — and corrected the stale ones (`TOP_N` `58-60`→`62-64`, `runScan()`
  `110-142`→`114-146`, the results/`pendingFundamentals` derivation `144-154`→`148-158`, the pending
  banner `438-446`→`451-459`, the results-table badge JSX `508-525`→`521-539`, the
  `save-as-watchlist` button `403-411`→`416-424`, the `comparatorGlyph`/`newCriterion` helper block
  `62-76`→`66-80`, the `lastRun` state block `86-88`→`90-92`, the outer results fragment
  `378-448`→`391-461`). **No step's `**Instructions**` logic changed** — every code snippet in the
  spec is unaffected by their edit (different region of the file); only the citations pointing at
  *where* to make each edit needed correcting. `tsc --noEmit` on the current merged tree is clean.
- `ls services/xstockstrat-ui/e2e/fixtures/` and `INVENTORY.md` were also re-checked post-merge:
  `main-dev` independently touched `INVENTORY.md`/`mock-backend.ts`/`configKeys.ts` for unrelated
  config-ui work (`config-ui-value-not-updating-defect` report) — no collision with this feature's
  planned `screenResults.ts` addition (new file, untouched by either).
- Committed as `respec(screener-data-readiness-polling): align steps with post-merge page.tsx +
  renumber 117->118` directly on `feature/screener-data-readiness-polling` (the sanctioned
  pre-step-loop exception to step-body immutability, per sequential-mode §5.3).

Tooling setup (steps 1-3, all `xstockstrat-ui`): node22 ✓ v22.22.2 · pnpm ✓ 9.15.0 · tsc ✓
(`node_modules` present) · Playwright Chromium ✓ (`/opt/pw-browsers/chromium`, requires
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`+`CI=true` env override for the pinned-vs-installed browser
build mismatch — already discovered and used successfully earlier this session; matches the
`watchlist-management` ledger trap in `fails.md`).

Next: Step 1.

### Step 1 — service: add the poll-capable sibling hook to `useScreenSymbols.ts` [done]
- Per the TDD gate's cross-step pairing (Step 3's test covers Steps 1+2), wrote Step 3's fixture
  file (`e2e/fixtures/screenResults.ts`) and full test additions to `screener.spec.ts` *first*,
  ran the suite against the pre-Step-1/2 tree, and captured **RED**: 6/7 new tests failed on the
  missing `screener-checking`/`stop-polling`/`screener-polling-gave-up` testids (the right reason
  — behavior not yet implemented); the 7th ("zero rows never starts checking") correctly passed
  trivially (it only asserts absence, already true pre-implementation) — this is the expected,
  non-vacuous RED baseline, not a gap in the test.
- Implemented `useScreenSymbolsPoll` + `POLL_INTERVAL_MS`/`MAX_POLL_ATTEMPTS` exactly per the
  spec's Instructions (also exported the two previously-private `ScreenSymbolsInput`/
  `ScreenSymbolsResult` type aliases for Step 2 to import). `tsc --noEmit` and `pnpm run lint`
  both clean.
- Files modified: `services/xstockstrat-ui/src/hooks/useScreenSymbols.ts`.
- Deviations: none.
- Green not yet re-run (Step 2 must land first — `useScreenSymbolsPoll` is unused until then).

### Step 2 — service: wire background polling into the Screener page [done]
- Discovery re-verified every `**Codebase Evidence**` citation directly against the current
  `page.tsx` (551 lines) — all matched exactly, no drift since the re-spec.
- Implemented per Instructions §1-9: `useEffect` import, `useScreenSymbols` import broadened,
  `mergeResultsBySymbol` helper, the five new `useState` declarations, the `pendingRows`/
  `pendingFundamentals` derivation move+broaden, the `poll`/`useEffect` pair, `runScan()`'s
  scan-generation-guard rewrite, and the checking/stop/gave-up JSX block. `tsc --noEmit` and
  `pnpm run lint` both clean.
- **TDD gate (red→green, paired with Step 3 per Step Dependencies)**: RED was captured before
  Step 1 (see that entry — 6/7 new tests failed on missing testids). With Step 1+2 both landed,
  ran the full Step 3 suite (not yet committed) against the real implementation:
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium pnpm exec playwright test
  e2e/insights/screener.spec.ts --workers=1` → **20/20 passed** (13 pre-existing + 7 new feature-118
  tests) after two fixes made during this gate (see Deviation Log entry "Step 2" for full detail):
  1. `page.tsx`'s poll-merge `useEffect` keyed on `[poll.data, poll.error]` (as literally specced)
     froze `pollAttempts` at 1 forever once TanStack's structural sharing started reusing the same
     `data` reference across identical-valued retries (the *normal* case: a still-pending row is
     byte-identical on every retry until it resolves) — the UI would silently stay on "Checking…
     attempt 1 of 5" forever instead of ever reaching "Gave up," even though polling had actually
     stopped internally at the cap. Fixed by keying on `[poll.dataUpdatedAt, poll.errorUpdatedAt]`
     instead. Logged to `docs/roadmap/ledger/fails.md` (generalizable TanStack Query gotcha).
  2. The not-yet-committed `screener.spec.ts` cap-exhaustion tests advanced `page.clock` in a tight
     loop with no real-time wait between iterations, but each mocked poll response is deliberately
     delayed 150ms in *real* Node time (page.clock only virtualizes the page's own timers). Added
     real `page.waitForTimeout(300)` calls between fast-forwards so each attempt's real-time route
     delay actually resolves before the next virtual-time jump — otherwise attempts undercounted by
     one and the cap was never reached within the loop's 4 iterations.
  - Isolated debug runs (ad hoc, deleted before commit) also confirmed two OTHER red failures seen
    mid-investigation (the pre-existing "runs a scan…" test and the "Technical indicator…" test)
    were sandbox cold-compile/HMR-compile-race flakes specific to this constrained environment, not
    regressions from this step's diff — both pass reliably once the dev server has had time to
    settle after a fresh navigation, and both passed cleanly on the final full run.
- Files modified: `services/xstockstrat-ui/src/app/insights/screener/page.tsx`,
  `services/xstockstrat-ui/e2e/insights/screener.spec.ts` (fix #2 above, ahead of Step 3's formal
  commit — Step 3 will re-verify and commit this file with the fix already in place).
- Deviations: see Deviation Log entry "Step 2" above (full detail).
