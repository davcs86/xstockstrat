# Context: snapshot-offline-positions  (archived 2026-09-01)
**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-01 — /sdd-archiver

**What**: Added `SnapshotOfflinePositions` RPC to `TradingService` and `snapshot_positions` operation
to the agent's `manage_offline_account` tool. Records an effective-dated position baseline
(`trading.offline_position_baselines` plain mutable table) — signed qty + avg cost per symbol per
account, keyed by `(account_id, client_snapshot_id)`. The position fold (`pnl.FoldFrom`) seeds from
this baseline and only ingests confirmed orders with `filled_at > asOf`, dissolving the double-count
between seeded holdings and later-ingested confirmations. Provenance (`source`/`as_of`) columns added
to `portfolio.positions` (migration 013) and surfaced on both `ListPositions` and `ListPortfolios`
read paths via the shared `positionColumns` constant. Deregister purge (`DeleteBaselinesByAccount`)
runs synchronously before the `account.deregistered` ledger event.

**Why (irrecoverable rationale)**:
- The position fold engine (`pnl.Fold`) is NOT safe for offline accounts — it is incremental and
  non-idempotent. The correct model is absolute recompute + emit the snapshot event
  (`account.positions.synced`) on every edit, mirroring feature-157's pattern. The baseline table
  stores the effective-dated opening state; the fold reads only confirmed orders after it.
- The baseline table uses DELETE+INSERT-in-tx (not `ON CONFLICT DO UPDATE`) in `UpsertBaselineSnapshot`
  because `ON CONFLICT` updates only matching rows and leaves stale rows from a prior snapshot silently
  present (replacing the whole set requires explicit delete-first).
- `SnapshotOfflinePositions` must hold `s.confirmLock(accountID)` around persist+recompute+emit
  because `ConfirmOrder` already holds this non-reentrant mutex. The extracted lock-free helper
  `recomputeAndEmitOfflinePositions` is documented with `// caller must hold s.confirmLock(accountID)`.
  An internal acquire inside the helper would deadlock `ConfirmOrder`.
- `HasUnconfirmedOfflineOrders` is account-level (not per-symbol) because `filled_at` is unknown for
  NEW orders — the warning "you have unconfirmed orders" is only meaningful at the account grain.
- Portfolio read-path parity (C-10(b)): the shared `positionColumns` constant at
  `portfolio_repo.go:285` drives BOTH `ListPositions` (`:117`) and `ListPositionsByAccount` (`:498`
  behind `buildAccountPortfolio`/`ListPortfolios`). One edit to this constant + a parity test pin
  closed the gap for both paths simultaneously.
- `non-empty user_id` on the `account.positions.baseline_set` audit event is mandatory — the
  add-ikbr-account-support trap (`account.positions.synced` shipped missing `user_id` in feature-157)
  was explicitly flagged and guarded before execute.
- Deregister purge runs synchronously BEFORE the `account.deregistered` emit and fails the RPC on
  error — it must not run after the emit (the event signals deregistration is complete).
- `FoldFrom(nil, fills) == Fold(fills)` by construction — the no-baseline branch is a correctness
  invariant verified by a parity sub-test.

**Rejected alternatives**:
- Synthetic fill orders for baseline: rejected because a synthetic sell registers as a closing trade
  and corrupts realized P&L (`RealizedDelta` accumulator).
- Ledger idempotency_key for replace-semantics: rejected because the ledger returns the original row
  on re-submit (not overwrite) — replace requires a mutable table.
- Lock-inside-producer (`recomputeAndEmitOfflinePositions` acquiring the mutex internally): rejected
  because `confirmLock` is non-reentrant — would deadlock `ConfirmOrder`.
- Lot-lineage provenance: rejected in favor of symbol-level `PositionSource` (MIXED/BASELINE/ORDERS).
- Carry-forward realized P&L on re-snapshot: rejected in favor of statement-sealed reset
  (`UpsertOfflineRealized` replace-not-accumulate). AC-14 asserts the 600→0.00 transition.

**Scars & gotchas**:
- `SnapshotOfflinePositions` is offline-only gated (AC-9); calling it on a LIVE account returns
  `FailedPrecondition`.
- Migration 009 (trading) and 013 (portfolio) were verified via cross-remote-branch max-NNN scan
  (`git ls-remote --heads` + `git ls-tree`) — local `ls` alone is insufficient (fails.md 2026-07-29/081).
- `positionSyncPayload` (`portfolio_service.go:826-851`) and `processPositionSync` (`:925-952`) must
  always receive and persist `source`/`as_of` from the position event; these fields are now part of
  the wire format.
- `xstockstrat-ledger/acceptance/` directory did not exist before this feature's scenario promotion —
  it was created by the archiver's scenario write.

**Permanent deviations**:
- `xstockstrat-trade-confirm-ingest` skill (session/marketplace-managed, not in-repo) was not updated
  as a follow-up outside this PR's reach (P-03 noted in context.md Step 14).

**Cross-feature signal**:
- TRADING-1 candidate: `confirmLock(accountID)` is non-reentrant; extracted post-lock producers must
  be lock-free with a `// caller must hold` doc comment.
- PORTFOLIO-1 candidate: `positionColumns` is the C-10(b) parity enforcement point for all position
  read paths; any new position column must be added to this constant + a parity test.
- C-18 candidate (reconciliation payload user_id): every emitter of `account.positions.*` family
  events must set a non-empty `user_id` before the first emit.

**Deferred follow-ons**:
- `xstockstrat-trade-confirm-ingest` skill update (marketplace-managed, outside repo).
- UI display of `source`/`as_of` provenance on position rows (deferred as optional in product spec).

**Ledger entries written**: insights.md (4), fails.md (3) — see the 2026-09-01 entries for 163-snapshot-offline-positions.

**Runtime-invariant recommendations (→ /context-constitution)**:
- TRADING-1: `confirmLock(accountID)` is non-reentrant; extracted producers are always lock-free,
  callers hold the lock.
- PORTFOLIO-1: `positionColumns` constant is the C-10(b) enforcement point; add new columns there.
- C-18: every `account.positions.*` reconciliation event must carry a non-empty `user_id`.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at
commit preceding the archive branch `claude/archive-batch-2026-09-01`.
