# Recon: snapshot-offline-positions

**Created**: 2026-08-29
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-agent, xstockstrat-ledger, packages/proto (incl. `packages/proto/pnl`)

---

## Objective

Record a brokerage statement's period-end holdings (signed qty + avg cost per share per symbol) as
an effective-dated **opening baseline** (`T0 = as_of`) for an OFFLINE account, so the offline
position projection folds from that baseline plus only confirmed fills dated after `T0` — dissolving
the double-count between seeded holdings and later-ingested confirmations while keeping the ledger
append-only. Additive-only: a new `SnapshotOfflinePositions` RPC, a baseline table, a seeded fold
variant, additive `Position` provenance fields, a new ledger audit event, and a new agent tool op.

## Codebase Map

- **`xstockstrat-trading`** (Go) — owns the offline fold
  - Offline confirm/recompute: `ConfirmOrder` at `services/xstockstrat-trading/internal/service/trading.go:886`
  - Fills source (already `ORDER BY filled_at ASC NULLS LAST`): `ListConfirmedOfflineOrdersByAccount` at `services/xstockstrat-trading/internal/repository/trading_repo.go:252`
  - Sign application (unsigned qty + `side` → signed): `offlineFillsFromOrders` at `trading.go:869-879`
  - Absolute-snapshot emit: `emitLedgerEvent("account.positions.synced", "account:{id}", …)` at `trading.go:974-980`; helper `emitLedgerEvent` at `trading.go:3400-3413`
  - Offline-only gate precedent: `ConfirmOrder` rejects broker accounts with `FailedPrecondition`
  - Last migration: `008_offline_accounts.up.sql` (`services/xstockstrat-trading/migrations/`) — adds `filled_at TIMESTAMPTZ` (the T0 anchor; NULL for NEW/historical); orders table `001_orders_hypertable.up.sql` (`side CHECK IN ('buy','sell')`, unsigned `qty`/`filled_qty`, `account_id` via `003`)
- **`xstockstrat-portfolio`** (Go) — stores what trading emits
  - Consumes the sync event: `ConsumePositionSyncs` / `UpsertPosition` at `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:57-63`; offline realized `UpsertOfflineRealized`/`GetOfflineRealized` at `portfolio_repo.go:408,420`
  - Read paths (both must carry provenance — C-10(b)): `ListPositions` and `buildAccountPortfolio` in `services/xstockstrat-portfolio/internal/service/portfolio_service.go` (enrich at `:437-444`)
  - Last migration: `012_offline_account_realized.up.sql` (plain table precedent for the baseline table)
- **`xstockstrat-agent`** (Python) — MCP consumer surface
  - Tool: `manage_offline_account` at `services/xstockstrat-agent/app/tools.py:1468-1546` (flat scalars, `operation` dispatch ladder; six ops today incl. `confirm_order`, `list_positions`)
  - JSON-blob-as-string precedent: `credentials_json` (`app/client.py:1638`, proto `trading.proto:249`)
  - Client fan-out: `app/client.py` (`confirm_offline_order:1685`, `list_account_positions:1742`)
- **`xstockstrat-ledger`** (Node) — append-only store
  - `event_type` is a **free-form string** (`packages/proto/ledger/v1/ledger.proto:22,34`) — no enum
  - Append-only enforced by DB triggers: `deny_mutation` in `migrations/001_ledger_events_hypertable.up.sql:47-60`
  - `idempotency_key` = **return-the-original**, not overwrite: `ledgerServiceImpl.ts:69-111`
- **`packages/proto/pnl`** (Go, hand-written) — the shared fold engine
  - `Fold(fills []Fill) FoldResult` at `packages/proto/pnl/pnl.go:55` (empty accumulator, signed avg-cost; same-dir accumulates, opposite realizes+flips)
  - `RealizedDelta` at `pnl.go:17-28`; `Lot.CostBasis` is signed **total** (`pnl.go:38-41`); avg derived on emit (`trading.go:955`)
  - No `FoldFrom` / seed parameter exists today (net-new)
- **`packages/proto` contracts**
  - `TradingService` + `ConfirmOrder`: `packages/proto/trading/v1/trading.proto:10,25`; `Order.side/qty/filled_at`
  - `Position` (fields top out at 21): `packages/proto/portfolio/v1/portfolio.proto:56-95`; `PositionSide` enum `:108`

## Patterns to REUSE

- **Offline fold** → reuse `packages/proto/pnl` `Fold`/`RealizedDelta` (`pnl.go:17,55`) via a new additive **sibling** `FoldFrom(baseline, fills)` (insights 2026-07-08: prefer an additive sibling over widening a shared return contract). The seeded accumulator lets the existing reduce/flip realized math handle the seam unchanged.
- **Absolute-snapshot recompute + emit** → reuse the existing `ConfirmOrder` → `pnl.Fold` → `emitLedgerEvent("account.positions.synced")` path (`trading.go:936-980`); a snapshot write triggers the same recompute so portfolio updates with no new consumer wiring.
- **JSON-blob-through-flat-tool** → reuse the `credentials_json` pattern for `positions_json` (`client.py:1638`, `trading.proto:249`).
- **Plain (non-hypertable) idempotency/account table** → reuse the shape of `portfolio.offline_account_realized` (`012_…`) and `ledger.idempotency_keys` (`002_…`) for `trading.offline_position_baselines` (real multi-column unique key, point-lookup).
- **New agent tool op** → reuse the `operation` dispatch ladder + `_caller_user_id` gate in `manage_offline_account` (`tools.py:1508-1542`); five doc surfaces per insights 2026-07-20 (module docstring/count, agent CLAUDE.md, `mcp-tools.md`, runbooks index, the `xstockstrat-trade-confirm-ingest` skill).
- **Offline-only RPC gate** → mirror `ConfirmOrder`'s `FailedPrecondition` broker-account rejection for the new RPC.

## Existing Business Rules (preserve / extend)

- **EXTEND** `@AC-7 @FR-6 @feature-157` "A confirmed offline fill updates positions via the shared absolute-sync path" (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`) — add a baseline-anchored fold alongside; the `account.positions.synced`-only path, the no-`order.filled` invariant, and `ListPositions`↔`ListPortfolios` parity (now incl. additive `as_of`/`source`) must be preserved.
- **PRESERVE** `@AC-10 @FR-6 @feature-157` "Re-editing a confirmed offline fill does not double-count the position" (portfolio suite) — fold-from-baseline must stay an idempotent absolute recompute; a baseline must not double-count on re-edit.
- **EXTEND** `@AC-11 @FR-6 @feature-157` "A sell-to-close offline confirmation removes the position" (portfolio suite) — adds baseline-as-cost-basis realized-P&L case; the existing confirmed-BUY→SELL realization must not regress. (If the no-baseline realized computation changes, it becomes a CHANGE needing sign-off.)
- **PRESERVE** `@AC-12 @FR-6 @feature-157` "A sell-to-open offline confirmation opens a short position" (portfolio suite) — short handling must not regress; baseline-seeded shorts are a design question, defaulted PRESERVE (not confirmed EXTEND).
- **PRESERVE** `@AC-14 @FR-6 @feature-157` "A broker account's P&L is unaffected by the presence of an offline account" (portfolio suite) — the new baseline table + `as_of`/`source` fields must not leak into broker figures (isolation invariant).
- **PRESERVE** `@AC-4 @FR-3 @feature-157` "Recording an offline order never contacts a broker" (trading suite) — the recorded orders are the fold's inputs; recording path stays broker-free.
- **PRESERVE** `@AC-5 @FR-4 @feature-157` "Editing an offline order confirmation marks it filled" (trading suite) — the confirmed-fill mechanism (incl. `filled_at`, compared against `as_of`) must not regress.
- **PRESERVE** `@AC-9 @FR-8 @feature-157` "Order-confirmation edits are rejected for broker accounts" (trading suite) — offline-only gate must not regress; new `SnapshotOfflinePositions` RPC should mirror it as its own **new** guarantee (authored in this feature's `acceptance.feature`, AC-9).
- **PRESERVE** `@AC-6 @FR-5 @feature-157` "Editing an offline order confirmation via the MCP agent tool" (`services/xstockstrat-agent/acceptance/offline-account-portfolios.feature`) — the existing confirm op must not regress as `snapshot_positions` is added alongside.
- **EXTEND** `@AC-15 @FR-1 @feature-157` "Deregistering an offline account purges its positions and realized P&L" (`docs/sdd/business-rules/platform.feature`) — **deregister must also purge `trading.offline_position_baselines` rows**, or the full-purge guarantee regresses. New requirement not in the current spec — see Risks.
- xstockstrat-ledger → no existing acceptance suite yet (new audit event has no `@AC-*` to regress).

## Dependencies

- Proto/RPC: new `SnapshotOfflinePositions` RPC + `SnapshotOfflinePositionsRequest`/`Response`/`PositionBaseline`/`RejectedBaselineRow` on `TradingService` (fresh number space); additive `Position.as_of` (22) + `Position.source` (23, enum `PositionSource{UNSPECIFIED=0,ORDERS=1,BASELINE=2}`) — both free (message tops at 21). All additive → `buf breaking` green, 1-owner + Proto Reviewer path.
- Migration: next number **`009`** for `services/xstockstrat-trading/migrations/` (tips at `008_offline_accounts`) — verified free by overlap scan.
- Config keys: none.
- Inter-service edges: agent → `TradingService.SnapshotOfflinePositions` (new); trading → ledger `AppendEvent` (existing helper); trading → portfolio via the existing `account.positions.synced` event (unchanged shape + additive provenance).
- New env vars / ports: none.

## Risks / Not-found

- **Deregistration purge (new, loud — @AC-15):** the baseline table is durable per-account; unless deregister purges it, an orphan baseline survives — a silent regression of the platform full-purge guarantee. **Must be in scope** (new FR/AC). Locate the offline deregister/purge site in trading + portfolio during /sdd-spec.
- **Realized-P&L basis across the seam (@AC-11):** folding realized against a baseline `avg_cost_per_share` is a genuinely new accounting case. Verify the seeded `pnl.RealizedDelta` reduce/flip math produces the correct figure and does **not** change the no-baseline path (else CHANGE + sign-off). *(fails.md "demonstration ≠ producer contract" family — exercise the producer.)*
- **Baseline-seeded shorts (@AC-12):** spec must state whether a baseline row may carry a short opening position (signed qty says yes; confirm the fold treats a seeded short lot identically to a confirmed sell-to-open).
- **`filled_at` NULL / `> T0` predicate:** confirmed orders always have `filled_at` set (confirm defaults to now); NEW/historical are NULL and excluded by the status filter — confirm `filled_at > as_of` is well-defined for every folded row, and that the no-baseline scenario is unaffected.
- **fails.md 2026-08-05 (add-ikbr):** `account.positions.synced` shipped missing `user_id` → reconciliation bug. Audit-event + synced payload must carry every reconciler field before launch.
- **fails.md 2026-07-01 (056 → C-10(b)):** `as_of`/`source` must be surfaced by both read paths with a parity test (AC-12).
- Design forks deferred from product spec: snapshot-over-NEW-orders (warn vs reject), audit-event idempotency (append-latest vs content-hash) — resolve in grilling.

## Recommended Scope

Advisory step boundaries (input to grilling + /sdd-spec):
1. **Proto** — new RPC + messages on `TradingService`; additive `Position.as_of`/`source` + `PositionSource` enum; `buf-gen`.
2. **Migration `009`** — `trading.offline_position_baselines` (+ `.down.sql`).
3. **pnl** — additive `FoldFrom(baseline, fills)` sibling + unit tests (seam realized, shorts, oversell).
4. **trading service** — `SnapshotOfflinePositions` handler (per-row validation, offline-only gate, persist baseline, trigger recompute + emit audit event); seed the `ConfirmOrder` recompute from the effective baseline with the `filled_at > as_of` filter; **deregister purge of baseline rows**.
5. **portfolio** — surface `as_of`/`source` on both read paths (parity test).
6. **agent** — `snapshot_positions` op + `positions_json`; provenance in `list_positions`; five doc surfaces.
7. **acceptance promotion** — this feature's `@AC-*` into the durable suites at launch (C-16 write side).
