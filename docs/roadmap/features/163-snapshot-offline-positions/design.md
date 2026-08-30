# Design: snapshot-offline-positions

**Created**: 2026-08-30
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-08-30
**Grounded in**: recon.md

---

## Chosen Approach

Record a statement's period-end holdings as an **effective-dated opening baseline** for an OFFLINE
account, stored in a new trading-owned table, and fold the offline position projection from that
baseline plus only confirmed fills dated after the snapshot's `as_of`. The whole capability is
additive over the launched feature-157 offline machinery.

**One producer, three baseline cases.** Extract the recompute-and-emit block currently inlined in
`ConfirmOrder` (`recon.md:50`; `trading.go:934-981`) into a private
`recomputeAndEmitOfflinePositions(ctx, accountID, userID)` on `TradingService`. Both `ConfirmOrder`
and the new `SnapshotOfflinePositions` handler call it, so a snapshot write and a fill confirmation
drive the identical absolute `account.positions.synced` emit — **no new portfolio consumer wiring**
(reuses `ConsumePositionSyncs`). Build order: load the effective baseline (greatest `as_of` per
account) from `trading.offline_position_baselines`; load confirmed offline orders
(`ListConfirmedOfflineOrdersByAccount`, `trading_repo.go:252`, already `filled_at ASC NULLS LAST`);
fold; compute per-symbol provenance; emit. The baseline load is **fail-closed**:

- **rows returned** → baseline branch: `pnl.FoldFrom(baseline, fills)` applying only confirmed orders
  with `filled_at > effective_as_of`;
- **zero rows** → no-baseline branch: `pnl.Fold(offlineFillsFromOrders(all confirmed))` — byte-identical
  to today's feature-157 behavior (`trading.go:944`);
- **query ERROR** → the existing skip-emit path (`trading.go:937-943` semantics): emit nothing. A
  transient DB error must never fold-all-with-double-count nor emit an empty snapshot that
  `DeletePositionsNotInSync` (`portfolio_service.go:940`) would use to wipe the account.

**Per-account serialization (the round-3 blocker, resolved).** `ConfirmOrder` acquires
`s.confirmLock(accountID)` (`trading.go:912-914`) *before* the recompute because request-driven writes
lack the pollers' one-goroutine-per-account serialization, and @AC-10 idempotency depends on a
consistent recompute. The extraction boundary is the **post-lock** body, so `recomputeAndEmitOfflinePositions`
stays **lock-free** (a caller-holds-lock doc comment; grabbing the non-reentrant mutex inside would
deadlock `ConfirmOrder`). The new `SnapshotOfflinePositions` handler MUST wrap
persist-baseline → `recomputeAndEmitOfflinePositions` in `s.confirmLock(accountID)`, or a concurrent
confirm + snapshot on one account races on read→emit and leaves portfolio with a stale absolute
snapshot — the double-count/stale class @AC-10 forbids.

**Symbol-level MIXED provenance (final, membership-keyed — NOT surviving-qty).** Computed per symbol on
the fold output, in trading's emit loop (`trading.go:957-968`) because only trading knows baseline
membership:
- symbol in the effective baseline **and** ≥1 post-T0 confirmed fill → **MIXED**, `as_of` = snapshot
  `as_of`. This holds even when no baseline shares survive — the flatten-then-refill case (baseline
  100, SELL 100, BUY 30 → surviving 30) reports **MIXED** (AC-17);
- symbol in the baseline, no post-T0 fill → **BASELINE**, `as_of` = snapshot;
- symbol with only post-T0 fills, not in the baseline → **ORDERS**, `as_of` unset.

`ConsumePositionSyncs`/`UpsertPositionFromSync` (`portfolio_service.go:935`) persist `source`/`as_of`
to two new `portfolio.positions` columns; **both** read paths surface them — `ListPositions` and
`buildAccountPortfolio`/`ListPortfolios` (`portfolio_service.go:437-444`) — with a parity test (C-10(b)).

**Baseline storage & supersession.** `trading.offline_position_baselines` (`account_id`,
`client_snapshot_id`, `as_of`, `symbol`, `qty NUMERIC(18,8)` signed, `avg_cost_per_share NUMERIC(18,8)`,
`created_at`), UNIQUE `(account_id, client_snapshot_id, symbol)`, plain table (like
`portfolio.offline_account_realized`). Re-submitting the same `client_snapshot_id` = delete-all-then-insert
for that `(account_id, client_snapshot_id)` in one tx (a re-submit that drops a symbol must remove it —
not an `ON CONFLICT` upsert). Effective baseline = greatest `as_of` per account (`EffectiveBaselineByAccount`),
tie-broken `created_at DESC`. A `qty=0` row is dropped **in `EffectiveBaselineByAccount`** (not `FoldFrom`)
so an unfilled zero seed never reaches `result.Positions` as a phantom position (AC-15) and `pnl` stays
domain-free.

**Seeded fold engine (additive sibling).** Extract the current `Fold` loop body (`pnl.go:59-90`) into
`foldInto(accs, fills) FoldResult`; `Fold(fills)` becomes `foldInto(empty, fills)` (behavior preserved);
`FoldFrom(baseline, fills)` copies the seed into `accs` then calls `foldInto`, so `FoldFrom(nil, fills)
== Fold(fills)` by construction. Seed `Lot.CostBasis` is signed total (`qty × avg_cost_per_share`,
matching `pnl.go:38-41`). The existing reduce/flip `RealizedDelta` (`pnl.go:17`) then realizes correctly
across the seam — a post-T0 sell drawing down baseline shares realizes against the baseline avg cost;
shorts fold identically to a confirmed sell-to-open.

**Realized = statement-sealed reset.** A later/replacement snapshot reseats account-grain realized to
`FoldFrom(newBaseline, fills WHERE filled_at > new_as_of).Realized` via the existing replace-not-accumulate
`UpsertOfflineRealized` (`portfolio_service.go:948-952`, gated `sync.RealizedPnl != nil`) — prior accrued
realized is sealed into the closed statement period, not carried forward. The shared emit always sets
`realized_pnl` (non-nil, including `0.0`), so a full-reset recompute observably transitions realized
(e.g. 600.00 → 0.00, AC-14).

**Audit event.** A new free-form ledger `event_type` string `account.positions.baseline_set`
(stream key `account:{account_id}`), append-latest (fresh event per submission; the mutable baseline
table is the replace source of truth — the ledger's `idempotency_key` is return-the-original and cannot
express "replace"). Both the audit emit and the triggered `account.positions.synced` run on the inbound
request ctx (C-03), mirroring `ConfirmOrder` (`trading.go:973`), and must carry a validated **non-empty**
`user_id` (else portfolio falls back to `"default"`, `portfolio_service.go:922` — the add-ikbr trap).

**Deregister purge.** Synchronous `DeleteBaselinesByAccount` in the OFFLINE branch of the deregister
handler, **FAIL the RPC on error**, **before** the `account.deregistered` emit (retry-safe: `GetBrokerAccount`
has no `is_active` filter, both ops idempotent). Preserves the platform @AC-15 full-purge guarantee.

**Consumer surface (C-14).** Agent MCP tool `manage_offline_account`: new `snapshot_positions` operation
(flat scalars + `positions_json` blob mirroring `credentials_json`, `client.py:1638`; `operation`
dispatch ladder + `_caller_user_id` gate, `tools.py:1508-1542`), and the `list_positions` operation's
response gains `as_of`/`source`. The response surfaces `rejected` (per-row) and `warnings`. Documented
across the five agent doc surfaces + the `xstockstrat-trade-confirm-ingest` skill (insights 2026-07-20).

**Proto.** New `SnapshotOfflinePositions` RPC + `SnapshotOfflinePositionsRequest`/`Response`/
`PositionBaseline`/`RejectedBaselineRow` on `TradingService`; Response has both `repeated RejectedBaselineRow
rejected` AND `repeated string warnings` (the latter an explicit addition beyond FR-5); additive
`Position.as_of` (22) + `Position.source` (23) + `PositionSource{POSITION_SOURCE_UNSPECIFIED=0, ORDERS=1,
BASELINE=2, MIXED=3}` (message tops at 21; enum-over-string + zero sentinel, C-04). All additive →
`buf breaking` green, one-owner + Proto Reviewer path.

**Snapshot-over-NEW = warn+report.** NEW orders are already excluded from the fold by the confirmed-status
filter; the handler warns (in `warnings`) when **any** unconfirmed NEW offline order exists for the account
at snapshot time (a NEW order's future `filled_at` is unknowable, so warn on the superset), naming the AC-3
footgun. Per-row validation is fault-tolerant: one malformed row → `rejected`, the rest commit.

## Rejected Alternatives

- **Synthetic-orders baseline** (seed `trading.orders` rows) — rejected: registers as closing trades and corrupts realized P&L (FR-3).
- **Lot-lineage provenance** (per-lot baseline-vs-order origin tags through the fold) — rejected: overbuilds the shared `pnl` engine both services depend on; symbol-level `source`+`as_of` satisfies FR-7 with two additive fields.
- **Provenance computed on portfolio read** — rejected: portfolio has no visibility into trading's baseline table (separate schemas, no cross-service query) and no T0; the two read paths would drift (C-10(b)).
- **Carry-forward (accumulating) realized across snapshots** — rejected: contradicts the statement-sealed reset and the replace-not-accumulate `UpsertOfflineRealized` contract; reintroduces the double-count the baseline exists to dissolve.
- **`FoldFrom`/producer acquires the confirm-lock internally** — rejected: `ConfirmOrder` already holds the same non-reentrant mutex, so an internal acquire deadlocks; caller-holds-lock keeps `ConfirmOrder` untouched.
- **Zero-qty flatten dropped inside `FoldFrom`** — rejected: keeps `pnl` domain-free; the drop lives in `EffectiveBaselineByAccount` so `baselineSymbols` membership stays correct.

## Open Risks

- [ ] **Per-account lock on the snapshot handler** — the handler must wrap persist-baseline + `recomputeAndEmitOfflinePositions` in `s.confirmLock(accountID)`; the extracted producer stays lock-free (caller-holds-lock doc comment). To be addressed at the trading-service step; @AC-10 concurrency test.
- [ ] **Deregister purge site** — not yet `path:line`; ground the trading OFFLINE deregister branch at /sdd-spec and confirm it precedes the `account.deregistered` emit.
- [ ] **Portfolio migration number** — recon shows `012` last (→ likely `013`); must be verified with a **cross-remote-branch** `max(NNN)` scan at /sdd-spec (fails.md 2026-07-29/081 numbering trap), not a local `ls`.
- [ ] **Non-empty `user_id` on the shared emit** — the snapshot handler must pass a validated non-empty `req.UserId`; pin it so `account.positions.synced` never carries `user_id=""` (add-ikbr fallback trap).
- [ ] **Merge-order** — land the portfolio migration + consumer no later than the trading emit change, so the additive `source`/`as_of` payload keys have columns to persist into.

## Constitution Rules Touched

- `C-01` — honored by: all design claims cite `recon.md`/`path:line`; the two deferred groundings (deregister site, portfolio migration NNN) are explicitly listed as /sdd-spec evidence tasks, not invented.
- `C-03` — honored by: the new RPC's audit + recompute emits run on the inbound request ctx (mirrors `trading.go:973`).
- `C-04` — honored by: `PositionSource` is an enum with `POSITION_SOURCE_UNSPECIFIED=0`; the ledger `event_type` stays a free-form string per the established generic-store contract.
- `C-07` / `F-01` — honored by: two **new** additive migrations (trading `009`, portfolio next-free); no applied migration edited.
- `C-08` / `P-06` — honored by: every service step is paired with a test step; RED-first producer-level seam test, fail-closed error→skip test, `Fold==FoldFrom(nil)` parity, realized-seam/flip/short tests, AC-14 realized transition, AC-12 parity.
- `C-10(b)` — honored by: `as_of`/`source` surfaced on both `ListPositions` and `buildAccountPortfolio` with a parity test (AC-12).
- `C-14` — honored by: the Agent `snapshot_positions`/`list_positions` surface is named and stepped (§Consumer surface); UI display is optional, not a deferred-required surface.
- `C-15` — honored by: AC-13..17 added; every FR retains ≥1 covering scenario.
- `C-16` — see Business Rules Touched.
- `F-04` — honored by: no invented paths; `recomputeAndEmitOfflinePositions`/`EffectiveBaselineByAccount`/`FoldFrom` are named as net-new extraction/additions, deregister site + migration number deferred to grounded /sdd-spec search.
- `F-06` — honored by: the baseline table lives in trading's existing (PgBouncer-pooled) schema; no new direct DB pool or service.
- `F-07` — honored by: no config keys; `trading_mode` is environment-derived, not hardcoded.
- `P-03` — honored by: the mixed-lot, realized-reset, warn-vs-reject, and MIXED-semantic forks were escalated to the user gate, not silently guessed.

## Business Rules Touched (C-16)

- PRESERVE `@AC-7 @feature-157` "confirmed offline fill updates positions via the shared absolute-sync path" (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`) — not regressed by: the no-baseline branch folds all confirmed orders byte-identically and emits `account.positions.synced` only (never `order.filled`); provenance/`as_of` ride additively.
- PRESERVE `@AC-10 @feature-157` "re-editing a confirmed offline fill does not double-count" (portfolio suite) — not regressed by: the snapshot handler holds `s.confirmLock(accountID)` around persist+recompute+emit (the round-3 blocker's fix), keeping the absolute recompute serialized per account; @AC-10 concurrency test added.
- EXTEND `@AC-11 @feature-157` "sell-to-close offline confirmation removes the position" (portfolio suite) — new case added: realized computed against a **baseline** avg cost across the seam (AC-4/AC-14); the no-baseline confirmed-BUY→SELL realization is unchanged (byte-identical branch).
- PRESERVE `@AC-12 @feature-157` "sell-to-open opens a short" (portfolio suite) — not regressed by: a baseline-seeded short lot folds identically to a confirmed sell-to-open (AC-1's LYFT −378 round-trips).
- PRESERVE `@AC-14 @feature-157` "broker account P&L unaffected by an offline account" (portfolio suite) — not regressed by: the baseline table + `as_of`/`source` are offline-only; broker figures never read them.
- PRESERVE `@AC-4/@AC-5/@AC-6/@AC-9 @feature-157` (trading/agent suites) — not regressed by: recording stays broker-free; `ConfirmOrder`'s confirmed-fill mechanism + offline-only gate are untouched; the new RPC mirrors the `FailedPrecondition` gate (AC-9) as its own new guarantee; the existing MCP confirm op is unchanged as `snapshot_positions` is added alongside.
- EXTEND `@AC-15 @feature-157` "deregister purges positions + realized P&L" (`docs/sdd/business-rules/platform.feature`) — new case added: deregister also purges `trading.offline_position_baselines` rows (synchronous, fail-the-RPC); promoted as an extension of the platform scenario at launch.
