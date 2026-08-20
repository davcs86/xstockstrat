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
