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
