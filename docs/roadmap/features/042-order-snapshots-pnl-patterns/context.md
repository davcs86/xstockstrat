# Context: order-snapshots-pnl-patterns

**Feature**: `docs/roadmap/features/042-order-snapshots-pnl-patterns/feature.md`
**Product Spec**: `docs/roadmap/features/042-order-snapshots-pnl-patterns/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/042-order-snapshots-pnl-patterns/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature assigned directory: `042-order-snapshots-pnl-patterns`
- Affected services identified: trading, portfolio, indicators, ingest, analysis, ledger, insights, proto.
- Key open question flagged: where should `order_snapshots` table live (trading DB vs. analysis DB) — deferred to impl-spec.
- Key open question flagged: async vs. sync pattern analysis on position close — deferred to impl-spec.

## Session 2026-08-19 — sdd-review product-spec (+ scope-preserving spec fixes)

- Review verdict was FAIL (6 blockers). All 6 were fixable WITHOUT reducing scope, so the spec was
  corrected in place and then advanced. Status: draft → spec-ready. **No requirement was dropped.**
- Blockers fixed (all scope-preserving):
  1. Criterion 4 (service name): `xstockstrat-insights` is not a registry service — it was removed
     when the frontends consolidated into `xstockstrat-ui` (feature 045, launched). Renamed to
     `xstockstrat-ui` (insights segment, `/insights`) in FR-5 and Affected Services.
  2. Criterion 7 / C-07 (migrations): added the migration strategy — one numbered pair
     `016_order_snapshots_pnl_patterns.up.sql` + `.down.sql` (next free number after
     `015_backtest_runs_user_id`), down drops both tables, run order noted. Fixed the Timescale
     hypertable PK: `order_snapshots` PK must include the partition column → `PRIMARY KEY (id, event_ts)`.
  3. Criterion 9 / P-03 (open questions): the 2 code-answerable ones were resolved from code
     (`strategy_id` already exists at `trading.proto:47`; pagination → fixed `limit` for v1). The 2
     genuine architectural forks (snapshot DB ownership; sync vs async analysis) are kept as
     explicit **design-owned** open questions deferred to `/sdd-design` — NOT force-resolved (same
     precedent the 127 gate applied: pre-resolving a design fork at product-spec time violates P-03
     and deadlocks the lifecycle). They may not be carried into `/sdd-spec`.
  4. Criterion 10 / C-10(a) (nav integration): FR-5 + Consumer Surface now require the P&L Patterns
     view to register in `PLATFORM_SUBNAV` with a nav-reachability test.
  5. Criterion 11 / C-14 (consumer surface): added the `## Consumer Surface(s)` section (UI = insights
     segment; Agent = none).
  6. C-5 (partial fill): FR-1 requires a partially-filled snapshot but the proto enum + DB `event_type`
     only had 3 values. Reconciled by ADDING `ORDER_PARTIALLY_FILLED` to `SnapshotEventType` and
     `'partially_filled'` to the `order_snapshots.event_type` domain (the scope-PRESERVING fix; the
     alternative — dropping partially-filled from FR-1 — would have reduced scope and was rejected).
- Warnings also addressed in the spec: added the mandatory `*_UNSPECIFIED = 0` sentinels to both new
  enums (`SnapshotEventType`, `FactorType`); added a `## Trading Mode` note asserting mode-agnostic
  (paper==live) capture/analysis. Advisory NOTE left for design: consider capturing `order_type` in
  the snapshot for factor attribution (not added — would be new scope).
- Overlap: CLEAN at product-spec level (no duplicate config key / proto field number / migration NNN).
  Impl-spec (Mode B) watch item: feature `029-signal-performance-attribution` (draft) co-edits
  `analysis.proto` + `trading.proto` and adds `xstockstrat-analysis`/trading schema — re-run the
  Mode B overlap scan against 029 at `/sdd-spec` time to confirm disjoint proto field numbers and
  non-colliding analysis migration NNNs. No hard merge-order row required yet.

## Session 2026-08-19 — sdd-design (Phase 0 + Phase 1 round 1)

- Phase 0 Recon: wrote recon.md across 6 services. Architecture converged (codebase-forced) to
  **analysis-centric, ledger-event-driven, no new pool/edge/cycle**: no point-in-time indicator RPC
  exists (compose caller-side; analysis's screener already does it, `screener.py:301-388`); trading
  dials neither indicators nor ingest; `Order` has no `position_id`; portfolio already emits
  `portfolio.position.closed`; analysis has no StreamEvents consumer yet but has the background-loop
  pattern to mirror.
- Phase 1 round 1 (proposer+adversary). Adversary verdict REVISE, no Floor breach. Proposed design:
  analysis grows its first ledger StreamEvents consumer (one broad subscription, in-process dispatch),
  composes snapshots on `order.*` (reusing screener), attributes P&L on `portfolio.position.closed`
  (→ GetPnL → factor buckets), serves `QueryPnLPatterns`; UI /insights view.
- **Bake-in fixes (no user input needed — settled by the debate):**
  - Idempotency (at-least-once redelivery + reconnect replay, portfolio per-call uuid dedup is
    retry-only): add `sequence`/`event_id` to `order_snapshots` + UNIQUE `(order_id, event_type)` (or
    event_id) with `ON CONFLICT DO NOTHING`; persist a stream cursor and resume from `cursor+1` (NOT
    `from_sequence=tip`, which drops events during downtime); make close attribution idempotent.
  - Recompute cost (AC-2): incremental running per-bucket aggregates, not a full rescan of all closed
    positions each close (unbounded + head-of-line-blocks the ordered consumer).
  - Empty-window close must no-op (pre-deploy open closes post-deploy → no open-sentinel snapshots).
  - Keep the SINGLE broad subscription (preserves global sequence order so the exit `order.filled`
    snapshot is written before `portfolio.position.closed` seals); skip analysis's own emitted event
    types to cut self-feedback volume.
  - Nav: register in `NAV_GROUPS` (real source of truth) + legacy `PLATFORM_SUBNAV` + reachability
    spec `GROUPS`; the product-spec's PLATFORM_SUBNAV-only phrasing is stale (fix, don't follow).
  - `pnl_bucket_size` reinterpretation flagged (spec says "bucket width in dollars for grouping"; must
    use as specified or correct the spec + record — not silently redefine); "3 buckets" hardcoded →
    justify as an algorithm constant or make configurable.
- **Central fork surfaced to the user at the round-1 gate (P-03 — not guessed):** the close event has
  `{user_id, symbol}` only. Option A — portfolio emits an ENRICHED close event adding `trading_mode`
  + `realized_pnl` (both cheap/local at close: mode is in scope at `portfolio_service.go:288`,
  per-position realized P&L = closeQty·(closePrice−avgEntry) is computable there) — correct position
  key + single-source per-position P&L, at the cost of a small portfolio backend change (breaks the
  design's "zero backend changes" selling point). Option B — analysis-only: drop mode from the key
  (paper/live collide — latent bug, masked by paper-only-dev) and recompute per-position P&L in
  analysis from the order fills it already consumes (duplicates portfolio's P&L logic, drift risk).
- Round 1 complete; full mode mandates ≥2 rounds. Awaiting user steer on the fork before round 2.

## Session 2026-08-19 — sdd-design (Phase 1 round 2 + decisions)

- User decision (round-1 gate): ENRICH the close event (Option A over analysis-only). Round 2 proposer
  built it; round-2 adversary (verdict REVISE, no Floor breach) found real correctness bugs:
  1. **Multi-leg P&L**: enriched `realized_pnl = existing.Qty*(FillPrice-AvgEntry)` uses PRE-CLOSE
     qty = only the FINAL exit leg. Partial sells that didn't zero the position (emit
     `position.updated`, no realized_pnl) are lost → attribution undercounts multi-leg exits
     (confirmed vs `GetPnL`'s two-pass sum `portfolio_service.go:499-652`). Ledger add-ikbr shape.
  2. **Incremental aggregation ⊥ quantile bucketing**: data-dependent quantile boundaries can't
     coexist with incremental UPSERT keyed on `value_range_*`; once aggregated the raw samples are
     gone. **Resolution (bake-in): store raw `(symbol,strategy_id,factor_name,factor_type,
     indicator_value,realized_pnl,closed_at,close_event_id)` samples, bucket at QUERY time** — the
     correlation-only-v1 fit; also dissolves the NULL-in-UNIQUE signal-attribution bug (#3).
  3. NULL-in-UNIQUE → signal factors never accumulate (moot under raw-sample store).
  4. **Position identity omits `account_id`** (portfolio account-scoped since feature 125) →
     multi-account collision. Bake-in: add `account_id` to the enriched payload + the position key.
  5. **Replay-phantom**: order_snapshots dedup gates the wrong table; a replayed old order.* after a
     seal manufactures a spurious open row. Bake-in: short-circuit the WHOLE handler on
     already-processed (`sequence <= cursor` or event_id exists) before any pnl_positions mutation;
     advance the cursor in the SAME transaction as the writes; ON CONFLICT on the pnl_positions open.
  6. `pnl_bucket_size` replacement is a functional FR-4 change → correct product-spec's Config Key
     Changes in the same pass (new config key = owner+config-team governance gate).
  7. C-05: declare the new `analysis.snapshot.*`/`analysis.patterns.*` defaults in analysis CLAUDE.md.
  8. C-10(a): register nav in all three (NAV_GROUPS + PLATFORM_SUBNAV + reachability GROUPS).
  9. Enriched payload keys (trading_mode, realized_pnl, account_id) = new producer contract → document
     in portfolio/CLAUDE.md § Ledger Events Emitted + a producer↔consumer parity test (mcp-tools lesson).
  Correctly-handled (not re-raised): C-04 enum sentinels present; C-07 hypertable UNIQUE includes
  the partition col (caveat: `event_ts` must be the ledger's STABLE timestamp, byte-identical on
  redelivery, else ON CONFLICT won't match).
- **User decisions at the round-2 gate:**
  - **P&L source = Option A (Portfolio cumulative), on DURABILITY grounds** (user asked "which
    survives restarts/deploys"): portfolio tracks cumulative realized per position in a DB column
    (portfolio **migration 010**, accumulate on each reducing fill) and emits the running total on
    close; the figure is frozen on the durable ledger event; analysis reads it via its persisted
    cursor — no in-memory dependency, no cross-deploy fill-replay dependency, no P&L duplication.
    Option B (analysis reconstructs from fills) rejected: fragile across the deploy boundary +
    duplicates portfolio's avg-entry/realized accounting.
  - **Run round 3** to validate the substantially-revised design before writing design.md.
- Round 2 complete. Proceeding to round 3 with Option A + all bake-in fixes.

## Session 2026-08-19 — sdd-design (Phase 1 round 3)

- Round 3 proposer locked the corrected mechanics (Option A portfolio cumulative + raw-sample store +
  4 analysis tables + single-txn cursor-gated consumer + query-time bucketing). Round-3 adversary
  verdict REVISE, **no Floor breach** — and it VALIDATED the load-bearing mechanics: global-sequence
  ordering holds (ledger `sequence` is globally monotonic via `nextval('ledger.global_sequence')`,
  ledger CLAUDE.md invariant #4 + `ledgerServiceImpl.test.ts:373-402` — NOT "per stream_key" as the
  stale `ledger.proto:29` comment says); idempotency holds; the seal-after-close ordering is provably
  safe (`seq(order.filled) < seq(position.closed)` because portfolio emits the close only after
  consuming the closing fill).
- **Round-3 bake-in fixes (fold into round 4 / design.md):**
  - [C-10(b), 056 fail] Do NOT compute realized P&L two ways. Compute the cumulative using portfolio's
    EXISTING proven direction-aware `applyFill` algorithm (`portfolio_service.go:519-550`), not a
    parallel long-only formula (which diverges on shorts/flips) + a PARITY TEST
    `realized_accum == GetPnL.realized` for the closed position.
  - [P-03 shorts] The live reduce branch keys on sign-of-fill (`:269`), so a short cover enters the
    "buying more" branch (no realized calc) and the residual short is dropped by pre-existing
    `newQty<=0→ClosePosition` logic; the live fill path can't even open a short (shorts enter via
    `account.positions.synced`). Reusing `applyFill` handles both directions; document the scope.
  - [C-01] `ClosePosition` DELETEs the row (`portfolio_repo.go:66-70`) → on full close the cumulative
    goes into the EMITTED PAYLOAD only, never "persisted on close." And `UpsertPosition`'s
    `ON CONFLICT DO UPDATE` must actually add `realized_accum = positions.realized_accum + $N` + the
    INSERT column (a concrete load-bearing SQL edit for /sdd-spec).
  - [P-03/C-01] `event_ts := LedgerEvent.recorded_at` (immutable server ts — `occurred_at` is
    caller-skewable; consumer `NOW()` breaks redelivery dedup). Ground ordering on the global
    sequence. FIX the stale `ledger.proto:29` "per stream_key" comment in-feature (mcp-tools drift).
  - [should-fix] Compose the snapshot BEFORE opening the DB txn; the txn holds only the writes
    (insert order_snapshots + UPDATE cursor) — no gRPC I/O pinning a PgBouncer slot.
- **Residual risks (accept-with-note, carried as Open Risks):** (a) snapshot completeness has no
  reconciliation backstop — a lower-sequence event committing after a higher one for the SAME position
  can be dropped (narrow; positions self-heal via positions.synced, snapshots don't; degrades
  gracefully under min_sample_count=5); (b) `ClosePosition` is not account-scoped (pre-existing;
  recommend scoping the DELETE to account_id while in the code); (c) `pnl_pattern_samples`/`order_snapshots`
  unbounded — v1 no retention (documented); snapshot retention must be POSITION-LIFECYCLE-keyed, never
  time-keyed (a wall-clock policy would drop a still-open long-held position's snapshots).
- **User chose to RUN ANOTHER ROUND (round 4)** rather than approve at round 3.

## Session 2026-08-19 — sdd-design (Phase 1 round 4 — ACCEPT-WITH-RISKS)

- Round 4 hardened the design (proposer relaunched after the first attempt stopped). Round-4
  adversary verdict **ACCEPT-WITH-RISKS, no Floor breach** — core mechanics hold under code
  verification (the `applyFill` reduce branch `portfolio_service.go:529-548` is a pure function of
  `(qty,costBasis,fillQty,fillPrice)`, extractable behavior-preserving; pure-reduce cost-basis math is
  byte-identical live-path vs GetPnL; portfolio migration 010 / analysis 016 confirmed next-free
  locally; no new inter-service cycle).
- Hardening folded in: shared `realizedDelta` helper extracted from GetPnL's closure (ONE impl, both
  paths — C-10(b)); exact `UpsertPosition` `ON CONFLICT DO UPDATE SET realized_accum = ... + $8` SQL;
  cumulative into the EMITTED PAYLOAD only on full close (row is DELETEd); account-scope the
  `ClosePosition` DELETE in-feature; `event_ts := recorded_at`; global-sequence ordering; fix stale
  `ledger.proto:29` comment; compose BEFORE the txn.
- **Round-4 items for /sdd-spec (design.md Open Risks):**
  1. [C-10(b)/DRY] The existing GetPnL test `computeRealizedPnL` (`portfolio_helpers_test.go:106-166`)
     is a byte-for-byte MIRROR of production `applyFill`, not a pin. The extraction must route BOTH
     production and the mirror through the shared `realizedDelta` (else a 3rd DRY copy), + add a
     CHARACTERIZATION test pinning real GetPnL on golden fills captured BEFORE the refactor.
  2. [C-01/P-03] Enriched full-close payload nil-derefs when `existing == nil` (reachable via a
     redelivered `order.filled` sell after close+DELETE; consume is not idempotent). Guard it (skip
     emit, or emit `realized = finalLegDelta` only).
  3. [C-01] Account-scoping `ClosePosition` needs BOTH the repo signature AND the `:288` call-site
     (`ClosePosition(ctx, userID, symbol, mode)` → add acctID) + confirm no other caller.
  4. [C-07/081] Analysis migration 016 may collide with in-flight feature 029 (also edits analysis
     schema/proto); re-verify NNN + proto field numbers against ALL remote branches at /sdd-spec.
  5. Parity test (`realized_accum == GetPnL.realized`) scope: holds only for the in-scope live
     `order.filled` close path — broker-sync/partial-only closes don't fire it; state the scope.
- **LOAD-BEARING INVARIANT (record in design.md):** the `/insights` P&L Patterns view must NEVER
  present a per-position realized-P&L number a user would reconcile against the trader dashboard —
  else the 056 dual-source (realized_accum vs GetPnL) fail returns in DURABLE form. `realized_accum`
  is attribution-stats-only; GetPnL stays the single user-facing realized figure.
- **Residuals (accept-for-v1):** (a) snapshot completeness = accept+doc + seal-time WARN diagnostic
  (no v1 backfill; v2 reconciliation named as a concrete tracked follow-up, add-ikbr lesson);
  (b) ClosePosition account-scoped in-feature (done, above); (c) no v1 retention, future snapshot
  retention MUST be position-lifecycle-keyed not time-based.

## Session 2026-08-19 — sdd-design (Phase 1 round 5 — FINAL/cap, ACCEPT-WITH-RISKS)

- Round 5 (hard cap) final adversarial pass on the fully-consolidated design. Verdict
  **ACCEPT-WITH-RISKS, no Floor breach** — all cited symbols verified real (F-04 clear), migrations
  010/016 next-free (F-01/C-07), single shared pool + compose-before-txn + no new edge (F-06), all
  tunables in WatchConfig incl. the ex-hardcoded bucket count → `indicator_bucket_count` (F-07 clear).
- **Round-5 refinement (fold into design.md):** tighten the attribution/parity scope to
  **"long, order-fill-originated positions only."** A short opened via `account.positions.synced` and
  covered via a live `order.filled` buy takes the `fill.Qty>0` "buying more" branch (`portfolio_service.go:269-275`),
  so the shared `realizedDelta` helper is never invoked → `realized_accum ≈ 0` while GetPnL computes
  the real figure (the `realized_accum == GetPnL.realized` parity would FAIL on that case, and
  attribution understates for live-fill-closed shorts). Make this a NAMED v1 limitation (add-ikbr
  shape avoided), user-neutralized by the attribution-only invariant. Rejected: accumulating in
  `ConsumePositionSyncs` too — sync snaps to a broker snapshot with no per-leg price, reintroducing
  the 056 dual-source path the design spent 4 rounds eliminating.
- Final residual set (all captured as design.md Open Risks): (1) long/order-fill-originated scope +
  named short understatement; (2) migration-016-vs-029 remote-branch re-scan at /sdd-spec;
  (3) snapshot completeness = accept+WARN diagnostic, v2 reconciliation named follow-up; (4) no v1
  retention → future retention position-lifecycle-keyed; (5) existing==nil close-payload guard;
  (6) real-GetPnL characterization pin + collapse the test mirror; (7) ClosePosition account-scope
  (repo sig + :288 call-site). Load-bearing invariant: insights view never shows a per-position
  realized P&L a user would reconcile vs the trader dashboard.
- 5-round cap reached. Design validated (ACCEPT-WITH-RISKS, no Floor breach) → to the approval gate.

## Session 2026-08-19 — sdd-design COMPLETION (approved)

- User APPROVED at the 5-round cap. design.md written. Status: spec-ready → design-approved.
- Chosen approach: analysis-centric, ledger-event-driven, no new synchronous edge/cycle/pool.
  Portfolio migration 010 (`realized_accum` + shared `realizedDelta` helper + account-scoped
  ClosePosition + enriched close payload). Analysis migration 016 (order_snapshots, pnl_positions,
  pnl_pattern_samples, ledger_stream_cursor) + first StreamEvents consumer (single broad, in-order,
  cursor-gated, compose-before-txn). QueryPnLPatterns buckets raw samples at query time. UI /insights
  P&L Patterns view, nav triple-registered. 7 Open Risks + the no-user-facing-per-position-P&L
  invariant recorded in design.md. Rejected alternatives (8) recorded in design.md.
- Constitution rules touched: C-01/P-03, C-04, C-05, C-07/F-01, C-08/P-06, C-09, C-10/C-10(a)/C-10(b),
  C-14, F-04, F-06, F-07 — all honored; no Floor breach across 5 rounds.
- Next: /sdd-spec order-snapshots-pnl-patterns (re-verify migration 016 vs feature 029 across all
  remote branches first).

### Open Threads (carry to /sdd-spec)
- [ ] Long/order-fill-originated attribution scope + named short understatement → portfolio test step.
- [ ] Migration 016 vs feature 029 remote-branch NNN/proto re-scan → /sdd-spec boot.
- [ ] Snapshot completeness WARN diagnostic + named v2 reconciliation follow-up → consumer step.
- [ ] No v1 retention; future retention position-lifecycle-keyed → analysis CLAUDE.md.
- [ ] existing==nil close-payload guard → portfolio step.
- [ ] Real-GetPnL characterization pin + collapse the test mirror → portfolio test step.
- [ ] ClosePosition account-scope (repo sig + :288 call-site) → portfolio step.

## Session 2026-08-20 — sdd-spec

- Generated implementation-spec.md with **14 steps**. Status `design-approved` → `implementation-ready`.
- Consumed recon.md + design.md as authoritative; the analysis-centric, ledger-event-driven design
  is followed exactly (no order-time trading edges; snapshots + attribution owned by analysis).
- Resolved the two design Open Risks that were routed to /sdd-spec:
  - **Migration numbering (ledger 081):** re-verified across ALL remote branches via
    `git ls-remote` + `git ls-tree`. Highest analysis migration = `015` (→ **016** free); highest
    portfolio migration = `009` (→ **010** free). No remote branch carries analysis `016` or
    portfolio `010`.
  - **Feature 029 collision cleared:** `029-signal-performance-attribution` is `status.md = draft`,
    has **no remote branch**, and its migration adds a `signal_id` column to the **trading** orders
    table (not analysis). Its proto additions (`GetAttribution`/`SourceAttribution`) have distinct
    names and no committed field numbers. → no collision with analysis 016 or our new proto
    messages/RPC.
- Key codebase findings (grep-verified, F-04/C-01):
  - Portfolio: `GetPnL.applyFill` reduce math at `portfolio_service.go:519-550` (`realized += (-closeQty)*(fillPrice-avgEntry)` at :535); live reduce branch `:272-275`; close emit `:289-291` (currently `{user_id, symbol}` only); `UpsertPosition` is 7-arg → `$8` free (`portfolio_repo.go:55-63`); `ClosePosition` DELETE is NOT account-scoped (`:66-70`), single caller `:288`; the byte-for-byte `applyFill` test mirror is `portfolio_helpers_test.go:114-166`.
  - Analysis: already dials indicators/ingest/marketdata/portfolio/ledger (`main.py:28,61,64,109-153`); screener compose to reuse `screener.py:301/333/344`; fundsignal boot-task pattern `fundsignal_loop.run_forever` registered `main.py:153`; config reads `self._cfg.get_int/get_float` (`servicer.py:36,156,316,410`); RPC shape `async def X(self, request, context)`; RPC auto-registered via `add_AnalysisServiceServicer_to_server` (`main.py:73`); C-13 home `tests/conftest.py` exists.
  - Proto: analysis service block `analysis.proto:12`, last RPC `GetIndicatorSeries:46`; enum-with-UNSPECIFIED precedent `:545,565`. Ledger `sequence` comment `ledger.proto:29` is stale ("per stream_key") — fixed to global-sequence in-feature (comment-only).
  - UI: nav is triple-sourced — `NAV_GROUPS` (`navGroups.tsx:41,60-66`, real rendered), legacy `PLATFORM_SUBNAV` (`PlatformHeader.tsx:72-84`), reachability `GROUPS` (`nav-reachability.spec.ts:21,69`); BFF forward one-liner `insightsBff.ts:53`; browser client auto-exposes new RPC (`analysisClient.ts:6`); no P&L-pattern fixture yet (new fixture + INVENTORY row needed).
- Config correction carried from design: the four keys are namespaced to **analysis**
  (`analysis.snapshot.indicator_timeout_ms`/`signal_timeout_ms`, `analysis.patterns.min_sample_count`/`indicator_bucket_count`),
  replacing the product-spec's `trading.snapshot.*` and `analysis.patterns.pnl_bucket_size`.
- Named v2 follow-up recorded for Step 14: **snapshot reconciliation** (rebuild an incomplete
  open→close window from the ledger via `QueryEvents`) — do not leave vague (add-ikbr lesson).

## Session 2026-08-20T06:16:48Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 warnings, several notes (advisory — did not block). Verdict PASS WITH WARNINGS.
- Overlap: no FAIL-level collision. The portfolio migration `010` hard-class collision with 127 is
  ALREADY RESOLVED (127 renumbered to `011`; merge-order.md:182). Remaining is soft disjoint-region
  rebase on `services/xstockstrat-portfolio/internal/service/portfolio_service.go` (042 edits
  ~lines 261-550; 127 edits ~1189-1353) and mechanical `packages/proto/gen/**` regen overlap.
  Analysis migration `016`, the four `analysis.snapshot.*`/`analysis.patterns.*` config keys, and the
  new `analysis.proto`/`ledger.proto` surface are all clean/next-free.
- Warnings resolved in the 2026-08-20 spec-fix pass (see next session block):
  - Step 8: matched `order.cancelled` (British) but trading EMITS `order.canceled` (one `l`,
    verified `trading.go:578,1220,1236,828,1248`; `xstockstrat-trading/CLAUDE.md:117`). As written,
    cancel snapshots would silently never capture (C-01). — [x] FIXED: event string corrected to
    `order.canceled` in the Step 8 instruction + trading emit sites added to Step 8 Codebase Evidence.
    The proto enum value keeps its name `SNAPSHOT_EVENT_TYPE_ORDER_CANCELLED` (our own enum spelling);
    only the matched live ledger string changed.
  - Step 1: `buf breaking --against .git#branch=feature/order-snapshots-pnl-patterns` compared the
    branch against itself. — [x] FIXED: changed to `--against ".git#branch=main-dev"` (the merge base).
  - Step 4: "same trading-mode string form other portfolio payloads use" was loose — no existing
    `portfolio.position.*` payload carries `trading_mode`. — [x] FIXED: pinned to `mode.String()`
    (as `UpsertPosition` writes at `portfolio_repo.go:61`); Step 8 seal reads it back the same way.
  - Step 12: cited Engine items at navGroups.tsx:60-66; actual `items` array is :62-67. — [x] FIXED
    (both cite sites corrected; verified against the file).
  - Step 8: 6-file step (>5, B2 advisory) — [x] no split (the three thin repos + consumer + boot-task
    registration are one cohesive unit; splitting the repos from the consumer that is their only
    caller adds ordering fragility for no benefit). Rationale accepted, spec unchanged.

## Session 2026-08-20T06:16:48Z — spec-fix pass (resolve impl-spec review warnings)

User directed "fix all warnings" after the advisory impl-spec review. Applied the four grounded
corrections directly to implementation-spec.md (pre-execution; step bodies not yet immutable):
- Step 8 `order.cancelled` → `order.canceled` (verified emit sites `trading.go:578,1220,1236,828,1248`).
- Step 1 `buf breaking` base → `main-dev`.
- Step 4 trading-mode string → `mode.String()` (portfolio_repo.go:61).
- Step 12 navGroups Engine items cite → `:62-67` (verified).
The 6-file Step 8 count is left as-is (cohesive unit; not split). No lifecycle change (stays
implementation-ready).

## Session 2026-08-20 — sdd-execute (steps 1–5)

Executed on harness branch `claude/execute-020-042-127-pfa5cw` (single integration PR model).

### Step 1 — proto [done]
- analysis.proto: SnapshotEventType + FactorType enums, SignalEntry/OrderSnapshot/PnLPatternFactor/
  QueryPnLPatternsRequest+Response messages, QueryPnLPatterns RPC. ledger.proto:29 comment fixed to
  "GLOBAL monotonic sequence". buf lint + breaking (against main-dev) pass.

### Step 2 — proto-gen [done]
- buf-gen.sh regenerated Go/Python/TS stubs; diff limited to analysis + the ledger comment line.

### Step 3 — portfolio migration 010 [done]
- 010_positions_realized_accum.{up,down}.sql: ADD/DROP realized_accum NUMERIC NOT NULL DEFAULT 0.
  Offline parity verified. (127 uses 011; both coexist on the branch.)

### Step 4 — portfolio producer [done]
- realizedDelta() package-level helper (the ONE reduce formula); GetPnL applyFill routed through it.
- ConsumeOrderFills: compute delta; full-close emits enriched portfolio.position.closed
  {user_id,symbol,account_id,trading_mode,realized_pnl=priorAccum+delta}; partial passes delta to
  UpsertPosition ($8, accumulates realized_accum). ClosePosition account-scoped (AND account_id=$4).
- New repo GetRealizedAccum (deviation — proto Position has no realized_accum field). Build+lint clean.

### Step 5 — portfolio tests [done]
- computeRealizedPnL mirror collapsed onto realizedDelta (DRY); TestRealizedDelta_Characterization
  (long/short partial+full+oversell+add+empty) + TestRealizedDelta_MatchesGetPnLPath. Full suite
  green, total coverage 55.9% (≥40). End-to-end ConsumeOrderFills/DB assertions deferred (deviation).

**Next:** Step 6 (analysis migration 016), 7 (config keys), 8 (analysis consumer), 9 (consumer test),
10 (QueryPnLPatterns RPC), 11 (RPC test), 12 (UI), 13 (UI e2e), 14 (docs).

## Session 2026-08-20 — sdd-execute (steps 6–9)

### Step 6 — analysis migration 016 [done]
- order_snapshots (hypertable on event_ts, PK+UNIQUE include event_ts), pnl_positions (partial
  unique open index), pnl_pattern_samples (no factor UNIQUE), ledger_stream_cursor. Offline parity ok.

### Step 7 — config keys [done]
- analysis.snapshot.indicator_timeout_ms/signal_timeout_ms (500), analysis.patterns.min_sample_count
  (5), analysis.patterns.indicator_bucket_count (5) in analysis CLAUDE.md + config-governance log.

### Step 8 — analysis ledger consumer [done]
- Three thin asyncpg repos (order_snapshots/pnl_positions/pnl_pattern_samples) + pnl_pattern_consumer.py
  (SnapshotComposer + PnLPatternConsumer): single broad StreamEvents(from_sequence=cursor), replay
  short-circuit, skip analysis.*, order.* → compose-before-txn (timeout→partial, FR-6) + open window +
  atomic cursor advance; portfolio.position.closed → seal + pattern samples per factor; best-effort
  captured/degraded/sealed audit emits. Registered as a boot task in main.py (reuses pool + stubs,
  F-06). Deviation: v1 captures a default indicator set (RSI/ATR), strategy-component resolution is
  the named v2 refinement; position_id synthesized from identity key (Order has no position_id).
- Consumer constructor accepts injected repos (default = real) for unit-testability. ruff clean.

### Step 9 — analysis consumer test [done]
- tests/test_pnl_pattern_consumer.py with in-memory fakes: AC-1 (snapshot w/ indicator+signal),
  AC-2 (seal + samples, incl partial-fill), AC-6 (indicator timeout → empty map + degraded) + teeth
  control, AC-7 (captured + sealed audit), idempotency/ordering short-circuit, self-emission skip.
  7 tests pass; full analysis suite 537 passed, coverage 82%.

**Next:** Step 10 (QueryPnLPatterns RPC), 11 (RPC test), 12 (UI), 13 (UI e2e), 14 (docs).
