# Context: order-snapshots-pnl-patterns  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: Shipped an analysis-owned, ledger-event-driven order-snapshot + P&L-factor-attribution capability with **zero new synchronous inter-service edges**. Analysis grew its *first* `StreamEvents` consumer (single broad subscription, cursor-gated, compose-before-txn) that composes indicator/signal snapshots on `order.*` and seals P&L attribution on an *enriched* `portfolio.position.closed`. Portfolio contributed migration 010 (`realized_accum` + a shared `realizedDelta` helper) so per-position realized P&L has a single authoritative source. Factor bucketing is done at **query time** over a raw-sample store, not incrementally.

**Why (irrecoverable rationale)**: The architecture was *codebase-forced*, not chosen from taste — recon established there is no point-in-time indicator RPC, `Order` has no `position_id`, trading dials neither indicators nor ingest, and a closed position is observable *only* via the ledger event. Every plausible alternative created a new edge, a cycle, or a second P&L computation; the 5-round debate spent most of its energy killing correctness bugs, not comparing approaches.

**Rejected alternatives**:
- Compose the snapshot in trading at order-time — lost: trading dials neither indicators nor ingest (2 new edges), no `position_id`, reimplements the screener in Go, risks a trading↔analysis cycle.
- Synchronous portfolio→analysis trigger on close — lost: a new reverse edge inside the fill loop (cycle/blocking, the "083 trap"); async via the existing `portfolio.position.closed` is cheaper.
- Poll for newly-closed positions — lost: no "list recently closed" RPC exists; close is observable only via the ledger event.
- Analysis reconstructs realized P&L from the fill stream (Option B) — lost on **durability**: fragile across the deploy boundary (needs full fill replay) + duplicates portfolio's avg-entry accounting. User chose Option A after asking "which survives restarts/deploys?".
- Incremental per-bucket aggregation (running sums) — lost: incompatible with data-dependent quantile boundaries and destroys raw samples; also dissolved a NULL-in-UNIQUE signal-factor bug.
- Enriched close carrying only the *final-leg* realized_pnl — lost: undercounts multi-leg exits; replaced by portfolio-cumulative `realized_accum`.
- Accumulate realized in `ConsumePositionSyncs` (to also cover shorts) — lost: broker sync has no per-leg price → reintroduces the 056 dual-source P&L path.
- Time-based Timescale retention on `order_snapshots` — lost: a wall-clock policy drops a still-open long-held position's entry snapshots; retention must be **position-lifecycle-keyed**.

**Scars & gotchas**:
- **Event-string spelling near-miss**: impl-spec Step 8 matched `order.cancelled` (British) but trading *emits* `order.canceled` (American, one `l`) — as written, cancel snapshots would have silently never captured, and no test flags it. Caught only by grep-verifying the actual emit sites. The proto enum intentionally keeps `SNAPSHOT_EVENT_TYPE_ORDER_CANCELLED` while the matched live string is `order.canceled` — a deliberate name/string divergence a future reader could misread as a typo.
- `buf breaking` in Step 1 originally compared the feature branch against *itself*; corrected to `main-dev` (the real merge base) — a self-comparison silently passes any breaking change.
- `event_ts := recorded_at` (the immutable ledger server ts) is **load-bearing** for redelivery dedup: `occurred_at` is caller-skewable and consumer `NOW()` differs on replay, so ON-CONFLICT would silently stop matching and manufacture phantom rows.
- The pre-existing GetPnL test `computeRealizedPnL` was a byte-for-byte *mirror* of production `applyFill`, not a pin — the extraction had to route both production AND the mirror through the shared helper (else a 3rd DRY copy) and add a real-GetPnL characterization pin on golden fills captured *before* the refactor.

**Permanent deviations**:
- design §2 said the consumer resolves snapshot indicators "from the order's `strategy_id`" → shipped a fixed default indicator set (RSI/ATR) → strategy-component resolution was deferred as the named v2 refinement. Without this note the default set reads as a bug.
- design implied reading the cumulative off the position row → shipped a new `GetRealizedAccum` repo method → proto `Position` has no `realized_accum` field to carry it.
- `position_id` is **synthesized from the identity key** (user/account/symbol/mode), not a real order-carried id → `Order` has no `position_id`; multi-cycle disambiguation is a named v2 follow-up.
- Portfolio Step 5 **deferred** end-to-end `ConsumeOrderFills` DB assertions (offline), shipping only unit/characterization/parity tests.

**Load-bearing invariant to preserve**: the `/insights` P&L Patterns view must **never** present a per-position realized-P&L number a user would reconcile against the trader dashboard. `realized_accum` is attribution-stats-only; `GetPnL` remains the single user-facing realized figure. Violating this returns the 056 dual-source fail in *durable* form.

**Cross-feature signal**: This is analysis's **first** ledger `StreamEvents` consumer and establishes the reusable event-driven-analytics consumer template (single broad subscription for global-sequence ordering + persisted cursor resumed from `cursor+1` not tip + single-txn cursor advance + compose-before-txn). Future ledger-event consumers should mirror it. Separately, the account-scoping fix chain — feature 125 scoped only the *read* path; this feature found and fixed the unscoped `ClosePosition` **DELETE** write-path twin — is a recurring pattern: an account-scoping retrofit touching only reads leaves the write path a latent multi-account corruption bug.

**Deferred follow-ons**: v2 snapshot reconciliation (rebuild an incomplete open→close window from the ledger via `QueryEvents` at seal time; v1 accepts a possibly-incomplete window and only WARNs on low snapshot count); v2 strategy-driven indicator resolution (vs the default RSI/ATR set); v2 multi-cycle `position_id` disambiguation; short-cover attribution (live-fill-closed shorts understate `realized_accum` — they take the "buying more" branch, never invoking `realizedDelta`); **no v1 retention** on `order_snapshots`/`pnl_pattern_samples` — any future retention MUST be position-lifecycle-keyed, never time-based.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-26 entries. (The core design triad — query-time bucketing, shared realizedDelta helper + attribution-only invariant, enrich-existing-event over new reverse edge — was already recorded at insights.md 2026-08-19.)
**Runtime-invariant recommendations (→ /context-constitution)**: none new (ledger global-monotonic sequence already at ledger CLAUDE.md invariant #4; `order.canceled` spelling already at trading CLAUDE.md).
**Scenario promotion (C-16)**: 5 `@AC-*` → `services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`, 2 → `services/xstockstrat-ui/acceptance/order-snapshots-pnl-patterns.feature` (both new suites).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
