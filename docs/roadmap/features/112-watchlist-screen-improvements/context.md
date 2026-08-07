# Context: watchlist-screen-improvements

**Feature**: `docs/roadmap/features/112-watchlist-screen-improvements/feature.md`
**Product Spec**: `docs/roadmap/features/112-watchlist-screen-improvements/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/112-watchlist-screen-improvements/implementation-spec.md`

---

## Session 2026-08-07T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story (screenshot of
  `/insights/watchlists` + three asks: move edit/delete actions into the readiness table, pick a
  strategy inline when adding a symbol, allow renaming a watchlist).
- Read `services/xstockstrat-ui/src/app/insights/watchlists/page.tsx`,
  `src/components/insights/WatchlistDetail.tsx`, `src/components/insights/WatchlistReadiness.tsx`,
  `src/hooks/useWatchlists.ts` — confirmed `useUpdateWatchlist` and `useAddWatchlistSymbols` already
  support `bindings`, so this is scoped as UI-composition only (no proto/BFF/config/DB change).
- Checked `docs/roadmap/ledger/fails.md` / `insights.md` for watchlist traps: the FR-6/"fails-080"
  full-bindings-replace invariant (feature 097) and the "no-fabricated-binding" per-row caption
  lesson (098, pre-097, since superseded by per-symbol bindings) — both already respected by the
  FR-2/FR-4 requirement that a rebind/rename sends the full bindings set, never a partial one.

## Session 2026-08-07T00:10:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: (1) acceptance criteria are qualitative rather than quantitative — tighten into
  concrete e2e assertions at /sdd-spec time; (2) FR-2's "fails-080" label is a code-comment
  convention (`WatchlistDetail.tsx`/`useWatchlists.ts`), not a numbered `fails.md` ledger entry —
  harmless but could mislead a reviewer looking for that entry by number.
- Overlap findings: none (CLEAN). No active concurrent feature touches
  `/insights/watchlists`; note for awareness only — 099-watchlist-live-quotes (status `idea`) is a
  backlog follow-up targeting the same page (adds a LAST-price/CHG% column), not yet active.

## Session 2026-08-07T00:20:00Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ui only; key reuse patterns: existing
  `Select`/`UNBOUND` sentinel pattern, `useAddWatchlistSymbols`'s already-supported `bindings?`
  param, the existing stateful e2e mock — no proto/BFF/fixture changes needed).
- Phase 1 Grilling: 6 rounds (quick mode's 1-round minimum explicitly extended by the user, mid-debate,
  to a 7-round cap once the design reached "pass with warnings" territory rather than a Floor breach;
  converged at round 6, within the extended cap). Each round's proposer/adversary pair found and closed
  a real, progressively narrower bug in the same "un-keyed detail-pane + local state/mutation-flight
  leaks across a watchlist switch" class:
  - R1: sentinel-translation gap (`toApiStrategyId` helper), dropped empty-state, `useEffect`
    reset anti-pattern (→ `key`-based reset), DRY/jscpd risk (→ `BindingRowControls`).
  - R2: per-symbol `pendingSymbols` guard closed only 1 of 4 concurrent write-pairings (→ single
    `writeInFlight` boolean); whole-component `key` cost was flagged as unverified.
  - R3: `key={watchlist.watchlistId}` on the whole `WatchlistDetail` reopens the write-race via
    shared-hook persistence — narrowed to a `WatchlistNameEditor` subcomponent instead; new bug
    found (`addStrategyId` carrying over across switches, a fabricated binding).
  - R4: fixed the `addStrategyId` bug via an `AddSymbolsRow` subcomponent (same key trick); adversary
    found the exact same leak class recurring a second time within the feature and proposed the
    simpler root fix — key the whole `WatchlistDetail` after all, now that recon's own evidence
    (`queryClient.ts:14`'s 5s global `staleTime`) proved the "expensive refetch" objection from R2
    was unfounded.
  - R5: adopted the whole-component `key={selected.watchlistId}` simplification (closes both R3/R4
    leaks in one mechanism); found it reopens a *different*, narrower concurrency race (orphaned
    in-flight mutation on switch-away-and-back) and an unresolved static-strategyId-span-vs-Select
    duplication ambiguity.
  - R6 (final): closed the concurrency race with a `mutationKey`/`useIsMutating` guard on the
    master-list switch buttons (grounded against the real `useInvalidatingMutation.ts` signature —
    additive, backward-compatible), gated additionally on `useWatchlists().isFetching` to close the
    residual refetch-settling window; resolved the span ambiguity (remove it); added the missing
    disabled-state styling; added an explicit `SelectValue` fallback for an unresolved `strategyId`.
- Chosen approach: relocate remove/rebind controls into `WatchlistReadiness.tsx` via a stateless
  `BindingRowControls` subcomponent (both bound/unbound rows); add an inline add-time strategy
  picker; add inline click-to-edit rename; reset all of `WatchlistDetail`'s local state via one
  `key={selected.watchlistId}` on the parent; two-layer concurrency guard (`writeInFlight` boolean
  intra-pane, `mutationKey`+`useIsMutating` cross-instance).
- Rejected: per-symbol `pendingSymbols` Set, `useEffect`-based state reset, per-piece-of-state keyed
  subcomponents (`WatchlistNameEditor`/`AddSymbolsRow` alone), lifting mutation hooks to `page.tsx`,
  per-watchlist `mutationKey` scoping, making `useInvalidatingMutation`'s `onSuccess` globally async
  — each recorded in design.md § Rejected Alternatives with its trade-off.
- Constitution rules touched: C-01, C-10, C-12, C-14, P-01, P-02, P-03, P-04, F-11 (no breach found
  in any round). See design.md § Constitution Rules Touched for how each was honored.
- Open risks carried forward (all non-Floor, explicitly accepted): cross-page `mutationKey` coupling
  with the Screener page's `useAddWatchlistSymbols` call; a brief post-switch disabled-controls
  papercut; the `w-32` Select width is an unmeasured estimate needing verification at `/sdd-spec`
  implementation time; two small `Select`+`UNBOUND` JSX duplicates accepted, not extracted.
- Status: spec-ready → design-approved.
- Ledger: the "un-keyed detail-pane + per-instance local state/mutation-flight leaks across a list
  switch" pattern recurred 3 times across this single feature's debate (R3, R4, R5→R6) before
  converging on "key the whole detail component, verify the remount is cheap via the app's actual
  staleTime, then close any remaining cross-instance mutation race separately" — logging both a
  `fails.md` entry (the recurring trap) and an `insights.md` entry (the converged pattern) below.

## Session 2026-08-07T00:30:00Z — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- recon.md + design.md were both present and consumed directly (Step 1.5) — most `**Codebase
  Evidence**` reused their `path:line` citations as-is; re-read the live files anyway to confirm
  every cited line still matched (all did) and to pull additional detail the design didn't need
  (exact current chip-row/readiness-row line ranges, `button.tsx`/`queryClient.ts` exact lines,
  the full text of the two e2e tests design.md flagged for repointing).
- Step ordering: (1) sentinel/translation + relocate remove/rebind controls (FR-1/FR-2) + its e2e
  repoint, (2) add-time strategy picker (FR-3) + new e2e case, (3) whole-component `key` remount +
  inline rename (FR-4) + new e2e case, (4) two-layer concurrency guard (Layers 1+2) sharing one
  closing e2e step. 9 steps total; no dedicated test step for the sentinel/translation extraction
  alone (no independently observable behavior) — recorded explicitly in `## Step Dependencies`
  rather than left implicit.
- Key codebase findings:
  - **Correction to design.md's own literal text** (Step 8): design.md §5 Layer 2 specifies
    `page.tsx` computing `useWatchlists().isFetching`, but `useWatchlists`'s declared return type
    (`useWatchlists.ts:17-21`) is `{ data, isLoading, error }` — no `isFetching` field, even though
    the function body returns the full `useQuery(...)` result at runtime. `useWatchlists().isFetching`
    as literally written in design.md would be a TypeScript compile error. Step 8 now explicitly
    widens the declared return type to add `isFetching: boolean`; the design's underlying race
    analysis is unaffected, only the return-type annotation was unverified. Caught by re-reading the
    live file rather than trusting the design snippet — same "verify the claim, don't just cite it"
    discipline the ledger already documents repeatedly (2026-07-27, 2026-07-29, 2026-08-02 entries).
  - Confirmed via `grep -rn "binding-\${|symbol-list" services/xstockstrat-ui/e2e/`: only
    `e2e/insights/watchlists.spec.ts` references the doomed chip-row testids — no other spec (e.g.
    `screener.spec.ts`) is affected by the chip-row removal.
  - `INVENTORY.md:23` (`mockWatchlists`/`MockWatchlist`/`MockBinding`) already covers every RPC this
    feature's e2e steps touch — no fixture changes anywhere in the 9 steps (C-12 clean).
  - Not trading-domain-relevant (no `BrokerType`/`TRADING_MODE`/broker/order-type hits) — the
    `reference/step-constraints.md` §A trading-domain table does not apply; only §B (lint gate,
    C-12 test-data reuse) applies to each `service`/`test` step.

## Session 2026-08-07T00:40:00Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 4 warnings, 3 notes (advisory — did not block). Overlap: CLEAN (no active
  feature collides; `096-position-and-order-detail-pages` shares `xstockstrat-ui` but disjoint
  files, no merge risk). No Floor (`F-*`) risk found in any of the 9 steps; every `path:line`
  citation in the spec was independently re-verified against the live files.
- Unresolved ✗ / ⚠ carried into execution:
  - Steps 2, 4, 6, 9: Verification sections state no explicit coverage-threshold assertion (literal
    B2 criterion) — this is the established, repo-wide Playwright-e2e-vs-vitest-unit split (coverage
    gating applies only to the vitest unit layer scoped to `src/lib/**`), not a defect unique to this
    spec — [x] accepted as-is, no action needed.
  - Step 2: viewport citation said `playwright.config.ts` contains "1280×720" — corrected in
    implementation-spec.md to cite the actual source (`playwright.config.ts:127`,
    `...devices['Desktop Chrome']`) instead of implying a literal value in this repo's config —
    [x] fixed (pre-execution spec edit, 2026-08-07).
  - Step 8: the `['watchlist-write']` mutationKey literal repeated 4× across `useWatchlists.ts`/
    `page.tsx`; the file already has a `WATCHLISTS_KEY` shared-constant precedent one line above.
    Fixed by adding an exported `WATCHLIST_WRITE_KEY` constant next to `WATCHLISTS_KEY`, used at all
    four call sites instead of the repeated literal — matches the file's own convention — [x] fixed
    (pre-execution spec edit, 2026-08-07).
- Overlap findings: none.

## Session 2026-08-07T00:45:00Z — pre-execution spec fixes

- User asked to fix the impl-spec review's warnings before starting execution. Fixed the two
  genuinely actionable items directly in `implementation-spec.md` (Step 2's evidence citation, Step
  8's constant extraction — both closed above). Editing the spec now is within F-09's bounds (the
  rule bars editing a step's body *during execution*; the feature is still `implementation-ready`,
  execution has not started).
- Did **not** "fix" the 4 coverage-threshold warnings (Steps 2/4/6/9) — these were already flagged
  by the reviewer itself as advisory-only, consistent with this repo's established convention that
  coverage gating applies only to the vitest unit layer (`src/lib/**`), not Playwright e2e specs
  (root `CLAUDE.md`, `services/xstockstrat-ui/CLAUDE.md` § Testing). Adding a fabricated numeric
  coverage threshold to an e2e step's Verification would contradict that established convention
  rather than fix a real gap — left as-is and noted here rather than silently ignored (P-03).

## Session 2026-08-07T00:50:00Z — sdd-execute boot (sequential)

- `/sdd-execute watchlist-screen-improvements sequential` — BOOT Step B3 found this feature's
  artifacts on neither `origin/feature/watchlist-screen-improvements` (branch doesn't exist on
  origin) nor `origin/main-dev` (files not present there — this feature hasn't merged) — both the
  skill's normal authoritative-source paths. Root cause: this session's harness instructions require
  developing and pushing only to the assigned `claude/watchlist-screen-improvements-9qf5vq` branch
  ("NEVER push to a different branch without explicit permission"), so every artifact since
  `/sdd-story` lives there instead of on a `feature/<slug>` branch.
- Resolution (not escalated to the user — dictated by the harness's own, unambiguous constraint, and
  consistent with root `CLAUDE.md` § Harness Default Branch, which already establishes `claude/*`
  branches base on and PR into `main-dev`): treat `claude/watchlist-screen-improvements-9qf5vq` as
  the effective `<dev-branch>` for this feature's execution. Updated `feature.md`'s `**Development
  Branch**` field to record this explicitly, with rationale, rather than leaving the stale
  `feature/watchlist-screen-improvements` value silently wrong (P-03). Verified the branch is fully
  in sync with its origin remote (`77af7ab` both locally and on `origin/claude/...`) before treating
  local files as authoritative for B3's purposes.
- No `feature/watchlist-screen-improvements` branch will be created this session — sequential mode's
  BRANCH SYNC / step commits target `claude/watchlist-screen-improvements-9qf5vq` directly, and its
  eventual integration PR targets `main-dev` (identical target to what sequential mode would have
  used from a conventional `feature/<slug>` branch).

## Session 2026-08-07T00:55:00Z — sdd-execute re-spec gate (5.3)

- Merged `origin/main-dev` (`d92960b`) into `claude/watchlist-screen-improvements-9qf5vq`
  (`-X ours` on conflict, per branch-sync convention). Pulled in substantial unrelated main-dev
  activity (features 023, 030, 100–102, 111×2) since this branch was cut this morning.
- **Numbering collision found and resolved**: the merge revealed `docs/roadmap/features/
  110-wire-signal-confidence-to-position-sizing/` already landed on `main-dev` (status `draft`,
  never touched by this session) — the same `NNN` as this feature. Per
  `docs/runbooks/feature-workflow.md` § Feature Numbering collision resolution: the feature not yet
  integrated into `main-dev` renumbers. `git mv 110-watchlist-screen-improvements
  112-watchlist-screen-improvements` (111 was unavailable — already double-booked on `main-dev` by
  two unrelated features, `111-fix-mcp-target-user-authz`/`111-ingest-signal-dedup`, also not
  touched by this session). Updated the moved dir's own `**Feature**`/`**Product
  Spec**`/`**Implementation Spec**` path lines in `context.md`/`implementation-spec.md` and the
  `feature.md` status history per the runbook's instructions. No `CHANGELOG.md`/`merge-order.md`
  citation existed to update (this feature was never referenced there). No branch rename needed
  (branches key off the slug, unchanged).
- **Target-file drift check**: the merge touched `services/xstockstrat-ui/src/components/insights/
  WatchlistDetail.tsx` (16 lines, from unrelated main-dev work) — one of this feature's Step 1/3/5/7
  target files. Re-validating this feature's Codebase Evidence against the post-merge file next,
  before the up-front confirm (§5.4), per the re-spec gate's mandate.
- **Semantic drift found (not just line-shift)**: an unrelated same-day defect fix on `main-dev`
  ("disabled strategies usable", `docs/reports/2026-08-07-disabled-strategies-usable.md`) split
  `WatchlistDetail.tsx`'s flat `strategies` list (`defs?.definitions ?? []`, cited throughout
  design.md/recon.md/the original implementation-spec) into `allStrategies`/`liveStrategies`/a new
  `strategyOptions(boundStrategyId)` helper — the chip row's `SelectContent` (Step 1's own deletion
  target) already consumes `strategyOptions(b.strategyId)` with a `(non-live)` label suffix, none of
  which existed at spec-generation time. This meaningfully affects Step 1's `BindingRowControls` (the
  rebind Select) and Step 3's add-time picker, not just citation line numbers.
- Also found: `watchlists.spec.ts`'s "readiness rollup" test citation `:108-132` shifted to
  `:125-149` (a new e2e test — "excludes non-live strategies" — was inserted above it, itself
  targeting the doomed `binding-AAPL` chip-row testid Step 1 deletes, so Step 2 must repoint it too);
  `screener/page.tsx`'s `useAddWatchlistSymbols` call citation `:68` shifted to `:82` (unrelated
  screener changes above it, same merge).
- No re-spec directive was given (bare `watchlist-screen-improvements` token, no parenthetical) —
  per §5.3, raised as a blocker via `AskUserQuestion` rather than silently editing. User chose
  **"Re-spec now"** (Option A, the protocol's preferred default).
- **Re-spec applied** to `implementation-spec.md` Steps 1, 2, 3, 5, 7, 8 (immutable-spec exception
  per §5.3/F-09 — this is the sole sanctioned pre-loop edit):
  - Step 1: `BindingRowControls` now takes the **full** `strategies` (`allStrategies`) and replicates
    `strategyOptions`'s live-filter-plus-keep-bound-visible logic + the `(non-live)` label suffix
    inline, rather than assuming a flat list; `StrategyDef`'s local type alias gains `liveEnabled:
    boolean`; all `WatchlistDetail.tsx` line citations shifted +11 (chip-row block `:126-165` →
    `:138-177`, `setBinding` `:86-96` → `:97-107`, remove-call `:140-142` → `:151-153`, empty-state
    `:128` → `:139`, `<WatchlistReadiness>` call `:180` → `:192`, add-row `:167-178` → `:179-190`);
    added an explicit instruction to delete the now-dead `strategyOptions` function (`:64-70`) while
    keeping `allStrategies`/`liveStrategies` (`:58-63`, Step 3 still needs `liveStrategies`).
  - Step 2: Test 4 citation `:108-132` → `:125-149`; added instruction 4 to repoint the newly-found
    "excludes non-live strategies" test's `binding-AAPL` reference to `readiness-row-AAPL`; updated
    the "5 tests" verification note to "6".
  - Step 3: `strategies` citation replaced with `liveStrategies` (`:63`) — a new binding is never
    pre-bound to a non-live strategy, matching the merge's own stated rule ("only live-enabled
    strategies are offered for a NEW binding"); `handleAddSymbol`/add-row/`symbolInput`-state
    citations shifted +11 to `:83-93`/`:179-190`/`:72`.
  - Step 5: header `<h2>` `:102` → `:113`; `setBinding` pattern `:86-96` → `:97-107`; rename-state
    placement `:61` → `:72`; header-block replace range `:100-107` → `:111-118`; unchanged-header
    range `:108-123` → `:119-134`. `updateWatchlist` hook citation (`:57`) and `page.tsx:143`
    unaffected (above the shift point / different untouched file).
  - Step 7: the stale `WatchlistDetail.tsx:180` citation for the `<WatchlistReadiness>` call
    (a line that will shift *again* once Step 1 lands) replaced with an explicit "locate fresh via
    Phase 1 discovery" note rather than a number guaranteed stale by the time Step 7 executes.
  - Step 8: `screener/page.tsx:68` → `:82`.
  - Steps 4, 6, 9: no changes needed — their insertion anchors ("after the per-symbol strategy
    binding test") remained accurate; that test's own start line (`:59`) was unaffected by the
    insertion, which landed below it.
- No changes needed to `WatchlistReadiness.tsx`, `useWatchlists.ts`, `useInvalidatingMutation.ts`,
  the watchlists `page.tsx`, `watchlistMock.ts`, `button.tsx`, `queryClient.ts`, or `INVENTORY.md`'s
  watchlist rows — confirmed untouched by the merge (verified via `git diff` against each, not
  assumed).
