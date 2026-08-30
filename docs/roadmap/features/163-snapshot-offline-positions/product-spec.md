# Product Spec: snapshot-offline-positions

**Created**: 2026-08-29

---

## Problem Statement

Ingesting a brokerage statement into an OFFLINE account today can only record fills (`confirm_order`),
so the operator cannot seed the account's starting holdings without inventing synthetic fills — and
any synthetic fill both corrupts realized P&L and risks double-counting once the real
post-statement confirmations are ingested. Operators (via the `xstockstrat-trade-confirm-ingest`
skill) need a way to record a statement's period-end holdings as an **opening baseline** that the
position projection folds from, applying only the confirmations dated after the statement period-end.

## User Story

As an operator ingesting a brokerage statement into an OFFLINE account, I want to record an
effective-dated position snapshot — the statement period-end holdings as signed qty + avg cost per
share per symbol — as an opening baseline (`T0 = as_of`), so that the offline account's position
projection and P&L are seeded from that baseline and only confirmed fills dated after `T0` apply on
top, dissolving double-counting between seeded holdings and subsequently-ingested confirmations while
keeping the ledger append-only.

## Functional Requirements

FR-1. **Snapshot write operation.** Add a `snapshot_positions` operation to the `manage_offline_account`
MCP tool with flat scalar params `account_id`, `as_of` (ISO-8601), `client_snapshot_id` (UUID), and
`positions_json` — a JSON string `[{ "symbol", "qty", "avg_cost_per_share" }, …]` where `qty` is
signed (long +, short −). `positions_json` mirrors the existing `credentials_json` blob-as-string
pattern so one call is atomic. The operation dispatches to a new backend RPC.

FR-2. **Additive backend RPC.** Add `SnapshotOfflinePositions(SnapshotOfflinePositionsRequest)
returns (SnapshotOfflinePositionsResponse)` to `xstockstrat.trading.v1.TradingService` (the service
that already owns the offline fold). Request carries `account_id`, `user_id`, `as_of`
(`google.protobuf.Timestamp`), `client_snapshot_id`, and `repeated PositionBaseline { symbol, qty
(signed double), avg_cost_per_share (double) }`. This is additive → one-service-owner governance path.
Rejected with `FailedPrecondition` for non-OFFLINE (broker/paper) accounts, mirroring `ConfirmOrder`.

FR-3. **Baseline persistence, superseded by `as_of`.** Persist baseline rows in a new
`trading.offline_position_baselines` table keyed so that re-submitting the same `client_snapshot_id`
**replaces that snapshot's rows** (a plain mutable table — the ledger stays append-only). The
**effective** baseline for the projection is the one with the greatest `as_of` per account; earlier
baselines are retained for audit but ignored by the fold. A baseline is **not** modeled as synthetic
orders in `trading.orders` (that would register as closing trades and corrupt realized P&L).

FR-4. **Baseline-seeded fold with `filled_at > T0` filter.** The offline position recompute seeds the
fold from the effective baseline's lots and applies only confirmed orders with `filled_at > as_of`.
Add a seeded variant (`FoldFrom(baseline, fills)`) to `packages/proto/pnl/pnl.go`; the existing
signed average-cost + realized reduce/flip math (`pnl.RealizedDelta`) then handles the seam
correctly — a post-`T0` sell drawing down baseline shares realizes against the **baseline** avg cost,
shorts included. The recompute runs on both a snapshot write and on `ConfirmOrder`, and continues to
emit the existing absolute `account.positions.synced` event so `xstockstrat-portfolio`'s stored
positions update. **Fill-status handling is unaffected** — the fold reads already-confirmed orders
and folds their `filled_qty`/`filled_avg_price` regardless of `ORDER_STATUS_PARTIALLY_FILLED` vs
`ORDER_STATUS_FILLED`. The recompute is **paper-safe** — OFFLINE accounts need no live market
access, so the snapshot/fold is independent of the paper/live (environment-derived) axis and is
fully testable in dev/compose.

FR-5. **Per-row validation / fault-tolerant batch.** Validate each baseline row independently: one
malformed row (bad symbol, non-numeric qty/cost, negative `avg_cost_per_share`) is rejected and
reported in `SnapshotOfflinePositionsResponse.rejected [{ row_index, reason }]`; the remaining valid
rows commit. `qty = 0` explicitly **flattens** that symbol in the baseline. Shorts are first-class
(signed `qty`).

FR-6. **Audit ledger event.** Emit a new free-form `event_type` string (e.g.
`account.positions.baseline_set`) to the ledger for audit, stream key `account:{account_id}`,
payload carrying `account_id`, `user_id`, `client_snapshot_id`, `as_of`, and the committed baseline
rows. (No proto enum exists — ledger `event_type` is a string; this is a new constant + a
CLAUDE.md "Ledger Events Emitted" table row, documented on the emitting service.)

FR-7. **Reconciliation provenance on reads.** Add additive `as_of` (`google.protobuf.Timestamp`) and
a `source` discriminator (`ORDERS` / `BASELINE` / `MIXED`) to the `Position` message so a reader can
tell a baseline-seeded position from an orders-only one. Symbol-level `MIXED`: a baseline-seeded
symbol with ≥1 post-T0 fill is `MIXED` (with the snapshot `as_of`), regardless of whether baseline
shares survive. The value must be surfaced by **every** portfolio read path that exposes positions
(`ListPositions` and `buildAccountPortfolio`/`ListPortfolios`), not just one — see Known Trap below.

FR-8. **Deregister purges the baseline.** Deregistering an OFFLINE account also purges its
`trading.offline_position_baselines` rows (synchronous, in the trading deregister handler, failing
the RPC on error, before the `account.deregistered` event) — preserving the platform full-purge
guarantee (`@AC-15 @feature-157`) that a deregistered account leaves no residual position / realized
/ baseline state.

## Out of Scope

- **Broker/paper accounts.** The broker/paper fold path (`portfolio` `GetPnL` / `processOrderFill`
  over `order.filled` ledger events) does **not** get baselines — real brokers report their own
  positions. This feature touches only the OFFLINE fold that runs in `xstockstrat-trading`.
- **UI display of provenance.** Rendering `as_of`/`source` in the trader UI Positions table is not
  required for the capability to be usable through the agent; the proto fields are additive and a
  later feature may surface them. (See Open Questions — this is an optional, not a deferred-required, surface.)
- **Basis confidence scoring.** Flagging lower-confidence basis (e.g. Webull statements that give
  only market value, not cost basis) is handled skill-side, not in the proto contract.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — new `snapshot_positions` operation on `manage_offline_account` (consumer surface).
- `xstockstrat-trading` — new `SnapshotOfflinePositions` RPC, baseline table + migration, baseline-seeded
  fold in `ConfirmOrder`'s recompute, audit ledger event.
- `packages/proto` — new RPC + request/response + `PositionBaseline` message; additive `Position` fields;
  the shared `pnl.Fold` engine (`packages/proto/pnl/pnl.go`) gains a seeded variant.
- `xstockstrat-portfolio` — consumes the (unchanged-shape) `account.positions.synced` recompute; surfaces the
  new `as_of`/`source` `Position` fields on every read path (C-10(b) parity).
- `xstockstrat-ledger` — receives the new free-form audit `event_type` (append-only invariant unchanged).

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — not required for usability (see Out of Scope / Open Questions; additive `Position`
  fields are available for a later trader-Positions-table follow-up).
- [x] **Agent** — `xstockstrat-agent` MCP tool `manage_offline_account`: new `snapshot_positions`
  operation (new params `as_of`, `client_snapshot_id`, `positions_json`) and the `list_positions`
  operation's response gains `as_of`/`source` provenance. Documented in `docs/runbooks/mcp-tools.md`
  and the `xstockstrat-trade-confirm-ingest` skill (the concrete consumer that emits the call).
- [ ] **None**

## Proto Contract Changes

- New RPC `SnapshotOfflinePositions` on `xstockstrat.trading.v1.TradingService`.
- New messages `SnapshotOfflinePositionsRequest` (`account_id`, `user_id`, `as_of` Timestamp,
  `client_snapshot_id`, `repeated PositionBaseline`), `SnapshotOfflinePositionsResponse`
  (committed summary + `repeated RejectedBaselineRow { row_index, reason }` + `repeated string
  warnings` — the `warnings` list carries the snapshot-over-NEW advisory, an explicit addition
  beyond the per-row `rejected` list), and `PositionBaseline` (`symbol`, `qty` signed double,
  `avg_cost_per_share` double).
- Additive fields on `xstockstrat.portfolio.v1.Position`: `as_of` (Timestamp) and a `source`
  discriminator enum `PositionSource { POSITION_SOURCE_UNSPECIFIED=0, ORDERS=1, BASELINE=2, MIXED=3 }`
  (enum-over-string, zero sentinel; `MIXED` = a baseline-seeded symbol that also has ≥1 post-T0 fill —
  see FR-7 / design.md § Symbol-level MIXED).
- All additive — no field removals/renames/type changes. `buf breaking` stays green.

## Config Key Changes

- [x] No new config keys

## Database Changes

- New migration in `services/xstockstrat-trading/migrations/` (next NNN after `008_offline_accounts`):
  `trading.offline_position_baselines` — columns `account_id`, `client_snapshot_id`, `as_of`,
  `symbol`, `qty` (signed `NUMERIC(18,8)`), `avg_cost_per_share` (`NUMERIC(18,8)`), `created_at`.
  Uniqueness on `(account_id, client_snapshot_id, symbol)` so re-submitting a snapshot id replaces
  its rows. Plain table (not a hypertable) — it needs a real multi-column unique key and is
  small/point-lookup, like `ledger.idempotency_keys` and `portfolio.offline_account_realized`.
- `.up.sql` + `.down.sql` pair. No edit to any applied migration.

## Feature Workflow Notes

Branch to create: `feature/snapshot-offline-positions` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking/additive proto change — `xstockstrat-trading` owner + Proto Reviewer)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, additive only
- [x] DBA review + service owner (schema migration — `trading.offline_position_baselines`)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

### Bound constraints (not open — enforced by FRs; retained as build-time reminders)

> **Reconciliation-payload completeness** (fails.md 2026-08-05, add-ikbr-account-support): the
> `account.positions.synced` payload once shipped missing `user_id` and surfaced weeks later as a
> production "positions out of sync" reconciliation bug. This feature both consumes and (for the
> audit event) produces a reconciliation payload — every field a reconciler needs (`user_id`,
> `account_id`, `as_of`, `client_snapshot_id`) must be present before launch, not deferred.
> **Bound by FR-6.**
>
> **Read-path parity** (fails.md 2026-07-01, 056-open-positions-ui → C-10(b)): `as_of`/`source`
> must be surfaced by both `ListPositions` and `buildAccountPortfolio`/`ListPortfolios` with a
> parity test, or the Positions table and portfolio card silently disagree. **Bound by FR-7 / AC-12.**

### Resolved by /sdd-design (see design.md; 3-round debate, user-approved 2026-08-30)

All prior forks are decided — recorded here for traceability:

- **Snapshot over unconfirmed (`NEW`) orders** → **warn + report** (additive `warnings` field; NEW
  excluded by the confirmed-status fold filter). Covered by AC-16.
- **Audit-event idempotency** → **append-latest** (fresh event per submission; the mutable baseline
  table is the replace source of truth).
- **Post-`T0` oversell / long→short flip realized** → the seeded `pnl.FoldFrom` + unchanged
  `RealizedDelta` reduce/flip math handles the seam; pinned by RED-first seam tests + the
  `Fold(fills)==FoldFrom(nil,fills)` parity test and a **producer-level** seam test (design.md).
- **`filled_at` NULL handling** → the `filled_at > as_of` filter runs only in the baseline branch;
  confirmed orders always have `filled_at` set, NEW/historical are excluded by the status filter.
- **Mixed-lot provenance** (raised in debate) → **symbol-level `MIXED=3`** (AC-13/AC-17).
- **Realized on re-snapshot** (raised in debate) → **statement-sealed reset** (AC-14).
- **Per-account serialization** (raised in debate) → the snapshot handler holds `s.confirmLock(accountID)`
  around persist+recompute+emit (preserves `@AC-10` idempotency).
