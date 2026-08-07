# Context: watchlist-screen-improvements

**Feature**: `docs/roadmap/features/110-watchlist-screen-improvements/feature.md`
**Product Spec**: `docs/roadmap/features/110-watchlist-screen-improvements/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/110-watchlist-screen-improvements/implementation-spec.md`

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
