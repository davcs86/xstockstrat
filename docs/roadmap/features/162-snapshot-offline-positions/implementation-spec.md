# Implementation Spec: snapshot-offline-positions

**Status**: `pending`
**Created**: 2026-08-30
**Feature**: `docs/roadmap/features/162-snapshot-offline-positions/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/snapshot-offline-positions`

---

## Execution Summary

The capability is additive over the launched feature-157 offline machinery. Build bottom-up so each
layer's consumer has something to bind to: (1) the proto contract (new RPC + messages, additive
`Position` provenance fields) and its regenerated stubs first; (2) the shared `pnl` fold engine gains
an additive `FoldFrom` sibling; (3) both migrations (trading baseline table, portfolio provenance
columns) before any code that persists into them; (4) the trading producer — baseline repo, the
`SnapshotOfflinePositions` RPC, the extracted seeded recompute, symbol-level provenance, the audit
event, and the deregister purge; (5) the portfolio consumer surfaces `source`/`as_of` on **both**
read paths; (6) the agent `snapshot_positions` operation (the C-14 consumer surface); (7) docs.

**Merge-order (design.md Open Risks):** only the portfolio **migration** (Step 6) is order-critical —
it must land no later than the trading emit change (Step 8), so the additive `source`/`as_of` payload
keys have columns to persist into. The portfolio **consumer** (Step 10) may follow Step 8, since an
`account.positions.synced` payload whose `source`/`as_of` keys are not yet parsed defaults safely to
`source=0` (`POSITION_SOURCE_UNSPECIFIED`) / null `as_of` — additive, no data loss. Steps are ordered
accordingly (see `## Step Dependencies`).

**Consumer surface (C-14):** the product spec names **Agent** only (UI is out of scope, optional
follow-up — not a deferred-required surface, so no UI step). The Agent surface is Step 12.

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| AC-1 (snapshot seeds BASELINE) | 9 (producer), 13 (agent e2e) |
| AC-2 (post-T0 buy → MIXED) | 4 (engine), 9 |
| AC-3 (pre-T0 fill subsumed) | 4 (engine), 9 |
| AC-4 (post-T0 sell realizes vs baseline, MIXED) | 4 (engine), 9 |
| AC-5 (later snapshot supersedes) | 9 |
| AC-6 (re-submit same client_snapshot_id replaces) | 9 (repo replace via 7) |
| AC-7 (malformed row rejected, valid commits) | 9 |
| AC-8 (zero-qty flattens) | 9 |
| AC-9 (broker/paper rejected FailedPrecondition) | 9 |
| AC-10 (audit ledger event) | 9 |
| AC-11 (list_positions provenance BASELINE vs ORDERS) | 11 |
| AC-12 (provenance parity across read paths) | 11 |
| AC-13 (MIXED symbol) | 9 |
| AC-14 (realized reseat 600.00 → 0.00) | 9 |
| AC-15 (zero-qty commits, no phantom) | 9 |
| AC-16 (warn on unconfirmed NEW order) | 9 |
| AC-17 (flatten-refill → MIXED, no baseline shares survive) | 4 (engine), 9 |
| AC-18 (deregister purges baseline rows) | 9 |

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the new `.proto`.
- Steps 3–14 require Step 2: all code compiles against the regenerated stubs.
- Step 4 (pnl test) covers Step 3 (pnl impl) — red-before-green.
- Step 8 (trading RPC/producer) requires Step 3 (`FoldFrom`), Step 5 (trading migration), Step 7
  (baseline repo).
- Step 8 requires Step 6 (portfolio migration) to have landed first (merge-order) so the emitted
  `source`/`as_of` keys have columns to persist into.
- Step 9 (trading test) covers Step 7 + Step 8 — red-before-green.
- Step 10 (portfolio consumer) requires Step 6 (portfolio migration). Step 11 covers Step 10.
- Step 12 (agent) requires Step 2 (regenerated Python stubs carry the new RPC). Step 13 covers Step 12.
- Step 14 (docs) after Step 8 + Step 12 (documents the shipped behavior).

---

### Step 1 — proto: new SnapshotOfflinePositions RPC + additive Position provenance fields

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/trading/v1/trading.proto` — modify
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes, `buf lint`/`buf breaking`; xstockstrat-trading owner — RPC contract; xstockstrat-portfolio owner — `Position` shape

**Codebase Evidence**:
- `service TradingService` at `packages/proto/trading/v1/trading.proto:10`; last RPC `GetTradingEnvironment` at `:34`; `ConfirmOrderRequest` at `:139` (`order_id`, `filled_qty`, `filled_avg_price`, `filled_at` Timestamp `= 4`, `user_id = 5`); `credentials_json` blob-as-string precedent at `:249`.
- `message Position` at `packages/proto/portfolio/v1/portfolio.proto:56`; `avg_entry_price = 3` (`:59`); highest field numbers `stop_order_id = 20` (`:93`), `take_profit_order_id = 21` (`:94`) → **22 and 23 are free** (confirmed by overlap scan, context.md 2026-08-29). `enum PositionSide` at `:108` is the enum-with-zero-sentinel precedent.
- `google.protobuf.Timestamp` already imported/used in `trading.proto` (`ConfirmOrderRequest.filled_at`).

**TDD**: `N/A (proto)`

**Covers**: `—`

**Instructions**:
1. In `trading.proto`, add to `service TradingService` (after `GetTradingEnvironment`, `:34`):
   `rpc SnapshotOfflinePositions (SnapshotOfflinePositionsRequest) returns (SnapshotOfflinePositionsResponse);`
2. Add the messages (place near `ConfirmOrderRequest`):
   ```proto
   message PositionBaseline {
     string symbol = 1;
     double qty = 2;                  // signed: long +, short −
     double avg_cost_per_share = 3;
   }
   message SnapshotOfflinePositionsRequest {
     string account_id = 1;
     string user_id = 2;              // caller identity (ownership + reconciliation payload)
     google.protobuf.Timestamp as_of = 3;   // T0
     string client_snapshot_id = 4;   // idempotency / replace key (UUID)
     repeated PositionBaseline positions = 5;
   }
   message RejectedBaselineRow {
     int32 row_index = 1;
     string reason = 2;
   }
   message SnapshotOfflinePositionsResponse {
     string account_id = 1;
     int32 committed_count = 2;
     repeated RejectedBaselineRow rejected = 3;
     repeated string warnings = 4;    // e.g. unconfirmed NEW-order advisory (design.md § Snapshot-over-NEW)
   }
   ```
3. In `portfolio.proto`, add the enum (top-level, mirroring `PositionSide` at `:108`) with a zero
   sentinel (C-04):
   ```proto
   enum PositionSource {
     POSITION_SOURCE_UNSPECIFIED = 0;
     ORDERS = 1;
     BASELINE = 2;
     MIXED = 3;
   }
   ```
4. Add the two additive fields to `message Position` (after `= 21`):
   `google.protobuf.Timestamp as_of = 22;` and `PositionSource source = 23;` — additive only, no
   renames/removals/type changes. Confirm `google.protobuf.Timestamp` is imported in
   `portfolio.proto` (add `import "google/protobuf/timestamp.proto";` if absent — grep first).

**Verification**:
```
cd packages/proto && buf lint . && buf breaking . --against '../../.git#branch=main-dev,subdir=packages/proto'
```
Both pass (lint clean; breaking reports nothing — all additive). Confirm `Position` field numbers
22/23 are unique via `grep -nE "= 2[0-9];" portfolio/v1/portfolio.proto`.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; never hand-edited)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes, `buf lint`/`buf breaking`; xstockstrat-trading owner — RPC contract; xstockstrat-portfolio owner — `Position` shape (inherited from Step 1)

**Codebase Evidence**:
- Codegen entry point `scripts/buf-gen.sh` (root CLAUDE.md § Generating Proto Stubs); CI `proto-freshness` job runs `bash ./scripts/buf-gen.sh` then fails on a non-empty `git diff` of `gen/` (`.github/workflows/ci.yml:178,183`).

**TDD**: `N/A (proto-gen)`

**Covers**: `—`

**Instructions**:
1. From repo root run `./scripts/buf-gen.sh` (generates Go, Python, TS stubs and compiles the TS package).
2. Stage the full `packages/proto/gen/` diff — do not edit generated files by hand.

**Verification**:
```
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Exit 0 after staging (no *further* drift once committed) — mirrors the `proto-freshness` gate.
Confirm `SnapshotOfflinePositions` appears in `gen/go/trading/v1/` and `gen/python/gen/trading/v1/`
service stubs, and `PositionSource` in the portfolio stubs (via `grep -rl`, not by reading gen).

---

### Step 3 — service: additive FoldFrom(baseline, fills) sibling in the shared pnl engine

**Status**: `pending`
**Service**: `packages/proto` (`pnl/` — the hand-written, non-generated Go helper)
**Files**:
- `packages/proto/pnl/pnl.go` — modify

**Reviewers**: xstockstrat-trading owner — realized-P&L fold correctness; xstockstrat-portfolio owner — P&L calculation accuracy (both services consume `pnl`)

**Codebase Evidence**:
- `func Fold(fills []Fill) FoldResult` at `packages/proto/pnl/pnl.go:55`; empty accumulator init at `:56`; the per-fill loop body at `:59-90`; `RealizedDelta` at `:17-28`; `Lot{Qty, CostBasis}` where `CostBasis` is signed total (`qty × avg_entry`) at `:38-41`; module is dependency-free float-math (`:10-12`).
- Insights 2026-07-08 (recon.md:49): prefer an additive **sibling** over widening a shared return contract.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. Extract the current `Fold` loop body (`:59-90`) into an unexported
   `foldInto(accs map[string]Lot, fills []Fill) FoldResult` that folds `fills` **onto the given
   `accs`** (seeded accumulator) and returns `FoldResult{Positions: accs, Realized: realized}`.
2. Rewrite `Fold(fills)` to `return foldInto(make(map[string]Lot), fills)` — behavior byte-identical.
3. Add the additive sibling:
   ```go
   // FoldFrom seeds the accumulator from baseline lots, then applies fills. FoldFrom(nil, fills)
   // is exactly Fold(fills). Seed CostBasis is signed total (qty × avg_cost_per_share).
   func FoldFrom(baseline map[string]Lot, fills []Fill) FoldResult {
       accs := make(map[string]Lot, len(baseline))
       for sym, lot := range baseline { accs[sym] = lot }
       return foldInto(accs, fills)
   }
   ```
   The existing reduce/flip `RealizedDelta` math (`:17-28`, `:66-83`) then realizes correctly across
   the seam — a post-T0 sell drawing down a seeded lot realizes against the baseline avg cost; a
   seeded short lot folds identically to a confirmed sell-to-open (design.md § Seeded fold engine).
   `pnl` stays domain-free: no `qty=0` dropping here (that lives in the caller's baseline loader).

**Verification**: lint via the paired test step (Step 4). Compile: `cd packages/proto && GOWORK=off go build ./pnl/`.

---

### Step 4 — test: pnl FoldFrom parity, seam-realized, shorts, oversell/flip

**Status**: `pending`
**Service**: `packages/proto` (tests hosted in the consuming trading service module)
**Files**:
- `services/xstockstrat-trading/internal/service/pnl_fold_test.go` — modify

**Reviewers**: xstockstrat-trading owner — realized-P&L fold correctness

**Codebase Evidence**:
- Existing pnl golden-vector tests live in `services/xstockstrat-trading/internal/service/pnl_fold_test.go` (and a sibling in portfolio) — the CLAUDE.md carve-out: pnl tests live in the **consuming service** test modules because no CI job runs `go test` in `packages/proto/` (`packages/proto/CLAUDE.md` § Non-generated helper carve-out).
- Test-data (C-13): baseline `map[string]pnl.Lot` and `[]pnl.Fill` literals are single-consumer scenario one-offs local to this test file — inline is compliant; no fixture home exists for `pnl` and none should be created.

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-4, AC-17`

**Instructions**:
1. Add table-driven cases asserting (written RED against the pre-Step-3 tree — `FoldFrom` does not
   yet exist, so the file will not compile → red):
   - **Parity**: `FoldFrom(nil, fills)` deep-equals `Fold(fills)` for a representative fill set.
   - **Seed-only**: `FoldFrom({AAPL: {Qty:100, CostBasis:15000}}, nil)` → AAPL Lot{100, 15000}, Realized 0 (AC-1 engine level).
   - **Post-T0 buy on seed (AC-2)**: seed AAPL 100@150, fill +50@160 → Qty 150, avg 153.33 (CostBasis 23000), Realized 0.
   - **Post-T0 sell draws down seed, realizes vs baseline (AC-4)**: seed AAPL 100@150, fill −30@170 → Qty 70, CostBasis 10500 (avg 150), Realized `600.00` (`(30)*(170−150)`).
   - **Seeded short round-trip (AC-1 LYFT)**: `FoldFrom({LYFT:{Qty:-378, CostBasis:-4725}}, nil)` → avg 12.50; a post-T0 buy-to-cover realizes against −12.50 basis correctly.
   - **Flatten-then-refill (AC-17 engine)**: seed AAPL 100@150, fill −100@165 then +30@170 → Qty 30, avg 170, Realized `1500.00`.
2. Confirm each case fails before Step 3 and passes after (`/sdd-execute` captures the red/green).

**Verification**:
```
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off go test ./internal/service/ -run 'FoldFrom|Fold' -race -count=1
```
All new cases pass. Note: `pnl` is an external module to this service, so these cases exercise it but
do not count toward the service's 40% coverpkg total — the parity/seam correctness they pin is the
point, not the coverage number (a `test` step is required regardless per C-08). **The `≥ 40%`
coverage gate for this feature's trading-service code is asserted in Step 9** (the paired
producer-level test), not here — this step deliberately runs no coverage threshold because `pnl` is
coverpkg-excluded.

---

### Step 5 — migration: trading.offline_position_baselines (009)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/migrations/009_offline_position_baselines.up.sql` — create
- `services/xstockstrat-trading/migrations/009_offline_position_baselines.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, index correctness; xstockstrat-trading owner — schema ownership

**Codebase Evidence**:
- Last trading migration is `008_offline_accounts` (local `ls`), confirmed **max across all remote branches** = `008` via cross-remote-branch scan (fails.md 2026-07-29/081 numbering trap) → next is **`009`**. No collision on any branch.
- Plain-table precedent (real multi-column unique key, point-lookup, not a hypertable): `portfolio.offline_account_realized` (`012_offline_account_realized`) and `ledger.idempotency_keys` (`002_…`) — recon.md:52. Trading schema is `trading` (services/xstockstrat-trading/CLAUDE.md § Database).

**TDD**: `N/A (migration)`

**Covers**: `—`

**Instructions**:
1. `.up.sql` — create a **plain** table (not `create_hypertable`):
   ```sql
   CREATE TABLE IF NOT EXISTS trading.offline_position_baselines (
     account_id          TEXT           NOT NULL,
     client_snapshot_id  TEXT           NOT NULL,
     as_of               TIMESTAMPTZ    NOT NULL,
     symbol              TEXT           NOT NULL,
     qty                 NUMERIC(18,8)  NOT NULL,   -- signed: long +, short −
     avg_cost_per_share  NUMERIC(18,8)  NOT NULL,
     created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
     PRIMARY KEY (account_id, client_snapshot_id, symbol)
   );
   CREATE INDEX IF NOT EXISTS idx_offline_position_baselines_account_asof
     ON trading.offline_position_baselines (account_id, as_of DESC, created_at DESC);
   ```
   The composite PK gives the `(account_id, client_snapshot_id, symbol)` uniqueness (FR-3 replace key);
   the index serves the greatest-`as_of`-per-account effective-baseline lookup (tie-break `created_at DESC`).
2. `.down.sql` — `DROP TABLE IF EXISTS trading.offline_position_baselines;` (drops the index with it).

**Verification** (offline, no DB):
```
ls services/xstockstrat-trading/migrations/009_offline_position_baselines.up.sql services/xstockstrat-trading/migrations/009_offline_position_baselines.down.sql
```
Then read both: the `.down.sql` `DROP TABLE` reverses the `.up.sql` `CREATE TABLE` (index dropped by
the table drop). No applied migration edited (F-01).

---

### Step 6 — migration: portfolio.positions source + as_of columns (013)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/013_positions_provenance.up.sql` — create
- `services/xstockstrat-portfolio/migrations/013_positions_provenance.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair; xstockstrat-portfolio owner — schema ownership

**Codebase Evidence**:
- Last portfolio migration is `012_offline_account_realized` (local `ls`), confirmed **max across all remote branches** = `012` via cross-remote-branch scan → next is **`013`** (design.md Open Risk resolved: "recon shows 012 last → likely 013", now grounded). No collision on any branch.
- Target table `portfolio.positions` (services/xstockstrat-portfolio/CLAUDE.md § Database); existing additive-column precedent: migrations `005` (broker valuation cols) / `006` (day_pnl cols) / `009` (bracket ids) all `ALTER TABLE portfolio.positions ADD COLUMN`.

**TDD**: `N/A (migration)`

**Covers**: `—`

**Instructions**:
1. `.up.sql`:
   ```sql
   ALTER TABLE portfolio.positions ADD COLUMN IF NOT EXISTS source    INTEGER     NOT NULL DEFAULT 0;  -- PositionSource enum (0=UNSPECIFIED)
   ALTER TABLE portfolio.positions ADD COLUMN IF NOT EXISTS as_of     TIMESTAMPTZ;                     -- NULL for ORDERS-only positions
   ```
   Store `source` as the enum's integer value (default `0` = `POSITION_SOURCE_UNSPECIFIED`, so
   pre-existing rows read back as unspecified until the next sync overwrites them); `as_of` nullable
   because ORDERS-only positions carry no snapshot time (design.md § Symbol-level MIXED).
2. `.down.sql`:
   ```sql
   ALTER TABLE portfolio.positions DROP COLUMN IF EXISTS as_of;
   ALTER TABLE portfolio.positions DROP COLUMN IF EXISTS source;
   ```

**Verification** (offline, no DB):
```
ls services/xstockstrat-portfolio/migrations/013_positions_provenance.up.sql services/xstockstrat-portfolio/migrations/013_positions_provenance.down.sql
```
Then read both: each `ADD COLUMN` in `.up` has a matching `DROP COLUMN` in `.down`. No applied
migration edited (F-01).

---

### Step 7 — service: trading baseline repository (persist / effective / delete)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/offline_baseline_repo.go` — create

**Reviewers**: xstockstrat-trading owner — position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `type TradingRepo` at `services/xstockstrat-trading/internal/repository/trading_repo.go:26`; `NewTradingRepo` at `:32`; shared `pgxpool` accessor `Pool()` at `:42`; repo query style (`r.db.Query(ctx, ...)`) at `ListConfirmedOfflineOrdersByAccount` (`:252-278`). New methods hang off `*TradingRepo` (same struct, same `r.db` pool — no second pool; F-06 budget unchanged, trading is one pooled `pgxpool`).
- Table + PK `(account_id, client_snapshot_id, symbol)` from Step 5.

**TDD**: `red-green required` (covered by Step 9)

**Covers**: `—`

**Instructions**:
1. Add methods on `*TradingRepo` in the new file (package `repository`):
   - `type BaselineRow struct { Symbol string; Qty float64; AvgCostPerShare float64 }`
   - `UpsertBaselineSnapshot(ctx, accountID, clientSnapshotID string, asOf time.Time, rows []BaselineRow) error` —
     **replace-not-upsert in one tx** (design.md § Baseline storage): `BEGIN`;
     `DELETE FROM trading.offline_position_baselines WHERE account_id=$1 AND client_snapshot_id=$2`;
     then insert each row; `COMMIT`. A re-submit that drops a symbol must remove it — do **not** use
     `ON CONFLICT` (that would leave a dropped symbol behind). AC-6.
   - `EffectiveBaselineByAccount(ctx, accountID string) (asOf time.Time, lots map[string]pnl.Lot, ok bool, err error)` —
     select the rows of the **greatest `as_of` per account** (tie-break `created_at DESC`), e.g.
     `... WHERE account_id=$1 AND as_of = (SELECT max(as_of) ...)` ordered so a single `client_snapshot_id`
     wins; **drop `qty=0` rows here** (a zero seed flattens a symbol and must never reach `result.Positions`
     as a phantom — AC-8/AC-15; keeps `pnl` domain-free). Build `pnl.Lot{Qty: qty, CostBasis: qty*avgCost}`.
     `ok=false` when no baseline rows exist (→ caller's no-baseline branch).
   - `DeleteBaselinesByAccount(ctx, accountID string) error` — `DELETE FROM ... WHERE account_id=$1` (FR-8 purge).
2. Import the shared `pnl` package (`github.com/xstockstrat/contracts/pnl`) for the `Lot` return type.

**Verification**: `cd services/xstockstrat-trading && GOWORK=off go build ./internal/repository/`; behavioral coverage via Step 9. Lint in Step 9's paired verification.

---

### Step 8 — service: SnapshotOfflinePositions RPC, seeded recompute, provenance, audit event, deregister purge

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/internal/handler/trading.go` — modify

**Reviewers**: xstockstrat-trading owner — order/position correctness, offline-only invariant, concurrent write safety

**Codebase Evidence**:
- `ConfirmOrder` at `services/xstockstrat-trading/internal/service/trading.go:886`; offline-only gate (order-sourced `FailedPrecondition`) at `:903-904`; per-account `confirmLock` acquired at `:912-914`, helper at `:842-857`; the recompute-and-emit block to extract at `:934-980` (`ListConfirmedOfflineOrdersByAccount` `:936`, fail-closed skip-emit on query error `:937-943`, `pnl.Fold(offlineFillsFromOrders(...))` `:944`, `posEntries` build `:951-969`, `emitLedgerEvent("account.positions.synced", ...)` `:974-980` carrying `account_id`/`user_id`/`trading_mode`/`positions`/`realized_pnl`).
- `offlineFillsFromOrders` at `:869-879` (unsigned qty + `side` → signed `pnl.Fill`).
- `emitLedgerEvent` helper (recon.md:24, `trading.go:3400-3413`); free-form event_type string (ledger has no enum — `packages/proto/ledger/v1/ledger.proto:22,34`).
- Deregister site `DeregisterBrokerAccountSvc` at `:2736`; OFFLINE branch at `:2758`; `account.deregistered` emit at `:2759-2762` — the purge must run **before** this emit (design.md § Deregister purge).
- Handler twin: Connect handler `TradingHandler.ConfirmOrder` at `services/xstockstrat-trading/internal/handler/trading.go:69` (sets `req.Msg.UserId = extractUserID(ctx)` at `:75`); gRPC adapter `grpcTradingAdapter.ConfirmOrder` at `:158-164`; adapter struct at `:129`; server registration `tradingv1.RegisterTradingServiceServer` at `cmd/server/main.go:143`.
- `ListConfirmedOfflineOrdersByAccount` status filter (`partially_filled`/`filled`, `filled_qty > 0`) at `trading_repo.go:252-264` — NEW orders are already excluded from the fold (design.md § Snapshot-over-NEW).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. **Extract** the recompute-and-emit block (`:934-980`) into a private, **lock-free**
   `recomputeAndEmitOfflinePositions(ctx context.Context, accountID, userID string) error` on
   `*TradingService`, with a `// caller must hold s.confirmLock(accountID)` doc comment (grabbing the
   non-reentrant mutex inside would deadlock `ConfirmOrder`, which already holds it — design.md
   round-3 blocker; rejected alt "producer acquires lock internally"). Preserve the fail-closed
   query-error → skip-emit semantics (`:937-943`) exactly.
2. Inside the extracted producer, replace the unconditional `pnl.Fold(...)` with the fail-closed
   three-branch build (design.md § One producer, three baseline cases):
   - load `asOf, seedLots, hasBaseline, err := s.repo.EffectiveBaselineByAccount(ctx, accountID)`; on
     `err` → skip emit (same as the confirmed-orders query error path).
   - load confirmed orders (`ListConfirmedOfflineOrdersByAccount`); on err → skip emit.
   - **baseline branch** (`hasBaseline`): `fills := offlineFillsFromOrders(filter(confirmed, filled_at > asOf))`;
     `result := pnl.FoldFrom(seedLots, fills)`. Apply the `filled_at > asOf` filter **only** in this
     branch (confirmed orders always have `filled_at` set; NEW/historical are excluded by the status
     filter — design.md, AC-3).
   - **no-baseline branch**: `result := pnl.Fold(offlineFillsFromOrders(confirmed))` — byte-identical to
     today's feature-157 behavior.
   - Compute **symbol-level provenance** (design.md § Symbol-level MIXED, membership-keyed): let
     `baselineSymbols` = keys of `seedLots`; `postT0Symbols` = symbols of the filtered fills. Per
     emitted position symbol: in baseline **and** has a post-T0 fill → `MIXED` (`as_of=asOf`); in
     baseline, no post-T0 fill → `BASELINE` (`as_of=asOf`); only post-T0 fills → `ORDERS` (`as_of` unset).
     Add `source` (enum int) and `as_of` to each `posEntries` map (extends `:957-968`).
3. `ConfirmOrder` now calls `recomputeAndEmitOfflinePositions(ctx, order.AccountId, order.UserId)`
   (still inside the lock it already holds at `:912-914`) in place of the inlined block.
4. Add `SnapshotOfflinePositions(ctx, req *tradingv1.SnapshotOfflinePositionsRequest) (*tradingv1.SnapshotOfflinePositionsResponse, error)` on `*TradingService`:
   - **Offline-only gate**: load the account (`s.accountRepo.GetBrokerAccount`, as the deregister path
     does at `:2737`); if `BrokerType != BROKER_TYPE_OFFLINE` → `FailedPrecondition` naming
     "snapshots apply to OFFLINE accounts only" (mirrors `ConfirmOrder` `:903-904`; AC-9). Validate
     `req.UserId` non-empty (add-ikbr trap — else the emit falls back to `"default"`, portfolio_service.go:922).
   - **Per-row validation** (fault-tolerant, FR-5/AC-7): for each `req.Positions[i]`, reject
     (`RejectedBaselineRow{RowIndex:i, Reason:...}`) on empty symbol, non-finite qty/cost, or
     `avg_cost_per_share < 0` (reason names the negative avg_cost_per_share). Valid rows → `[]BaselineRow`.
     `qty == 0` is **valid** (flatten — commits, dropped later in `EffectiveBaselineByAccount`, AC-8/AC-15).
   - **Serialize** persist→recompute→emit under `s.confirmLock(req.AccountId)` (design.md open risk;
     @AC-10). Inside the lock: `s.repo.UpsertBaselineSnapshot(ctx, accountID, clientSnapshotID, asOf, rows)`;
     emit the audit event (step 5 below); `recomputeAndEmitOfflinePositions(ctx, accountID, req.UserId)`.
   - **Warnings** (design.md § Snapshot-over-NEW / AC-16): if any unconfirmed NEW offline order exists
     for the account at snapshot time (query the orders table for `status='new'` for this account —
     reuse/extend an existing repo read; if none exists, add a small `HasUnconfirmedOfflineOrders`
     count method), append one `warnings` entry naming the NEW order/symbol. NEW orders are already
     excluded from the fold by the status filter — warn only, never reject.
   - Return `SnapshotOfflinePositionsResponse{AccountId, CommittedCount: len(rows), Rejected, Warnings}`.
5. **Audit event** (FR-6/AC-10): emit a new free-form event_type constant
   `account.positions.baseline_set`, stream key `fmt.Sprintf("account:%s", accountID)`, on the inbound
   request ctx (C-03), append-latest (fresh event per submission — the mutable table is the replace
   source of truth). Payload carries `account_id`, `user_id` (validated non-empty), `client_snapshot_id`,
   `as_of`, and the committed baseline rows (reconciliation-payload completeness — add-ikbr trap).
6. **Deregister purge** (FR-8/AC-18): in `DeregisterBrokerAccountSvc`, inside the OFFLINE branch
   (`:2758`) **before** the `account.deregistered` emit (`:2759`), call
   `if err := s.repo.DeleteBaselinesByAccount(ctx, accountID); err != nil { return <Internal> }` —
   **fail the RPC on error** (retry-safe: `GetBrokerAccount` has no `is_active` filter, both ops idempotent).
7. **Handler twin** (`internal/handler/trading.go`): add `TradingHandler.SnapshotOfflinePositions`
   (Connect handler) that sets `req.Msg.UserId = extractUserID(ctx)` from trusted metadata (mirroring
   `ConfirmOrder` `:75`) and calls `h.svc.SnapshotOfflinePositions`, preserving the service's gRPC
   status code via `connect.NewError(connectCodeFromErr(err), err)`; and
   `grpcTradingAdapter.SnapshotOfflinePositions` (mirroring `:158-164`).

**Verification**: covered by Step 9 (build + tests + lint):
```
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "recomputeAndEmitOfflinePositions\|s.confirmLock\|extractUserID(ctx)\|DeleteBaselinesByAccount\|account.positions.baseline_set" internal/service/trading.go internal/handler/trading.go
```
Confirm the extracted producer is called under-lock in both `ConfirmOrder` and the snapshot handler,
the deregister purge precedes the `account.deregistered` emit, and no new outbound cross-service gRPC
call is introduced (the audit + synced emits reuse the existing `emitLedgerEvent` on the inbound ctx —
header propagation already satisfied; no C-03 new-call surface).

---

### Step 9 — test: trading snapshot producer, gate, provenance, realized reset, warnings, deregister, concurrency

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify

**Reviewers**: xstockstrat-trading owner — order/position correctness, concurrent write safety

**Codebase Evidence**:
- Existing offline-behavior tests live in `services/xstockstrat-trading/internal/service/trading_offline_test.go` (ConfirmOrder/offline fold + `account.positions.synced` assertions) — grep-confirmed home.
- Producer-level intent (design.md § producer-level seam test; fails.md "demonstration ≠ producer contract" family): drive `recomputeAndEmitOfflinePositions` / `SnapshotOfflinePositions`, not just `pnl.FoldFrom`.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18`

**Instructions** (each written RED against the pre-Step-7/8 tree):
1. **AC-1** snapshot seeds baseline: snapshot AAPL 100@150, LYFT −378@12.50; the emitted
   `account.positions.synced` payload carries AAPL qty 100 avg 150 `source=BASELINE`/`as_of=T0` and
   LYFT −378 avg 12.50 `source=BASELINE`.
2. **AC-2/AC-13** post-T0 buy → AAPL 150 avg 153.33 `source=MIXED`/`as_of=T0`.
3. **AC-3** confirmed BUY dated ≤ T0 subsumed → AAPL stays 100 avg 150.
4. **AC-4** post-T0 SELL 30@170 → AAPL 70 avg 150, emitted `realized_pnl` 600.00, `source=MIXED`.
5. **AC-5** later snapshot supersedes → AAPL 80 avg 155 `source=BASELINE`/`as_of=new`.
6. **AC-6** re-submit same `client_snapshot_id` replaces (single AAPL row qty 120 avg 151, never stacks) — drives the repo replace-in-tx.
7. **AC-7** malformed row (`avg_cost_per_share=-10`) → response `rejected` has one entry `row_index 1`, reason names the negative avg_cost_per_share; AAPL commits; emitted positions include AAPL, exclude MSFT.
8. **AC-8/AC-15** `qty=0` row commits (response `rejected` empty, both rows committed) but emits **no** TSLA position (dropped in `EffectiveBaselineByAccount`).
9. **AC-9** snapshot on a broker (non-OFFLINE) account → `FailedPrecondition` naming OFFLINE-only.
10. **AC-10** snapshot emits `account.positions.baseline_set` on stream `account:acc-1` carrying `account_id`, `user_id`, `client_snapshot_id`, `as_of`.
11. **AC-14** realized statement-sealed reset: after AC-4's 600.00, a later full-close-ish snapshot (AAPL 70@150, as_of after the sell) → emitted `realized_pnl` transitions to 0.00 (`FoldFrom(newBaseline, fills WHERE filled_at > new_as_of)` = no post-T0 fills → Realized 0).
12. **AC-17** flatten-then-refill (baseline 100, SELL 100, BUY 30 post-T0) → AAPL 30 avg 170, `source=MIXED`.
13. **AC-16** snapshot with an unconfirmed NEW MSFT order present → response `warnings` has one entry naming the NEW MSFT order; `rejected` empty; AAPL commits; MSFT excluded from the emitted fold.
14. **AC-18** deregister an OFFLINE account with a baseline → `DeleteBaselinesByAccount` called (no rows remain) **before** `account.deregistered` emitted.
15. **@AC-10 concurrency** (design.md): a concurrent `ConfirmOrder` + `SnapshotOfflinePositions` on one account serialize via `s.confirmLock` — no interleaved/stale absolute snapshot (assert final emitted snapshot is consistent).

**Verification**:
```
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod && \
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && \
go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && \
go tool cover -func=coverage.out | grep "^total:"
```
Confirm ≥ 40%. New producer/handler/repo logic lands in CI-**excluded** packages
(`service/`, `handler/`, `repository/`) — the 40% coverpkg total is unaffected by it; these paired
tests exercise the behavior directly (integration-level verification is sufficient per the
spec-template excluded-package note). Test-data (C-13): order/baseline literals are single-consumer
scenario one-offs local to `trading_offline_test.go` — inline compliant, no fixture home for trading exists.

---

### Step 10 — service: portfolio persists + surfaces source/as_of on both read paths

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify

**Reviewers**: xstockstrat-portfolio owner — position snapshot consistency, read-path parity (C-10(b))

**Codebase Evidence**:
- `positionSyncPayload` struct at `services/xstockstrat-portfolio/internal/service/portfolio_service.go:826-851`; inner position entry has `symbol`/`qty`/`avg_cost` (`:832-834`) and top-level `RealizedPnl *float64` (`:850`); `processPositionSync` upsert loop at `:925-942` (`UpsertPositionFromSync` call `:935`), realized gate at `:948-952`.
- `UpsertPositionFromSync` at `portfolio_repo.go:307-317` — this is the sync-path upsert the `account.positions.synced` provenance keys actually flow through; its `INSERT INTO portfolio.positions ... ON CONFLICT` is at `:309-313`. (Do **not** edit `UpsertPosition` at `:57-115` / INSERT `:59` — that is the separate per-fill `order.filled` path from feature 042, which the snapshot provenance never reaches.) `PositionValuation` struct at `:290`; the shared `positionColumns` SELECT constant at `:285` (drives **both** `ListPositions` `:117` and `ListPositionsByAccount` `:498` — the two read paths behind `ListPositions` and `buildAccountPortfolio`/`ListPortfolios`).
- Read paths: service `ListPositions` at `portfolio_service.go:500`; `buildAccountPortfolio` at `:1056` (calls the account-scoped repo read); `ListPortfolios` at `:1104`. Both must carry provenance (C-10(b), AC-12).

**TDD**: `red-green required` (covered by Step 11)

**Covers**: `—`

**Instructions**:
1. Extend `positionSyncPayload`'s inner position entry (`:832-834`) with `Source int` (`json:"source"`)
   and `AsOf string` (`json:"as_of"`, RFC3339 or empty) — matching the keys trading now emits (Step 8.2).
2. Extend `PositionValuation` (or add params to `UpsertPositionFromSync`) to carry `source int` and a
   nullable `as_of` timestamp; write them to the new `portfolio.positions.source`/`as_of` columns in
   the `UpsertPositionFromSync` `INSERT ... ON CONFLICT` upsert (`portfolio_repo.go:307-317`, INSERT
   at `:309-313` — include the two new columns in the insert column list and the `ON CONFLICT ... SET`
   clause, so a re-sync overwrites provenance). Do not touch the `order.filled`-path `UpsertPosition`
   (`:57-115`).
3. In `processPositionSync` (`:925-942`), parse `p.Source`/`p.AsOf` and pass them through
   `UpsertPositionFromSync`. Legacy events without the keys default to `source=0`
   (`POSITION_SOURCE_UNSPECIFIED`) / null `as_of` (safe, additive).
4. Add `source, COALESCE(as_of ...)` to the shared `positionColumns` constant (`:285`) and the
   corresponding `scanPosition` mapping so **both** read paths populate `Position.source`/`Position.as_of`
   — single edit covers `ListPositions` and `ListPositionsByAccount`/`buildAccountPortfolio` (the
   C-10(b) parity guarantee — recon.md fails 2026-07-01). Map the integer to `portfoliov1.PositionSource`
   and the timestamp to `*timestamppb.Timestamp` (null → unset).

**Verification**: covered by Step 11 (build + parity test + lint).

---

### Step 11 — test: portfolio provenance persistence + read-path parity

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_offline_test.go` — modify

**Reviewers**: xstockstrat-portfolio owner — position snapshot consistency, read-path parity

**Codebase Evidence**:
- Existing offline sync/portfolio tests live in `services/xstockstrat-portfolio/internal/service/portfolio_offline_test.go` (grep-confirmed home); pnl golden vectors in `pnl_fold_test.go`.

**TDD**: `red-green required`

**Covers**: `AC-11, AC-12`

**Instructions** (written RED against the pre-Step-10 tree):
1. **AC-11**: after a `account.positions.synced` event carrying AAPL `source=BASELINE`/`as_of=T0` and
   NVDA `source=ORDERS`, `ListPositions` returns AAPL `source=BASELINE` (`as_of=T0`) and NVDA
   `source=ORDERS` (`as_of` unset).
2. **AC-12** parity: read the same AAPL position through `ListPositions` **and** the portfolio-card
   path (`buildAccountPortfolio`/`ListPortfolios`); assert both report the same `source=BASELINE` and
   the same `as_of` (the shared `positionColumns` constant makes this hold — the test pins it so a
   future divergent edit is caught, mirroring the 2026-07-01/056 regression this rule exists for).

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod && \
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && \
go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && \
go tool cover -func=coverage.out | grep "^total:"
```
Confirm ≥ 40%. New logic is in the CI-excluded `service/`/`repository/` packages — the coverpkg total
is unaffected; the parity test is the load-bearing verification. Test-data (C-13): sync-payload
literals are single-consumer scenario one-offs inline in the test — compliant.

---

### Step 12 — service: agent snapshot_positions operation + list_positions provenance

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, `docs/runbooks/mcp-tools.md` parity, propagation

**Codebase Evidence**:
- `manage_offline_account` tool at `services/xstockstrat-agent/app/tools.py:1468`; the `operation` dispatch ladder + `_caller_user_id(ctx, ...)` gate at `:1508-1542`; error mapping at `:1543-1546`.
- `credentials_json` blob-as-string precedent at `client.py:1638`; offline client methods `confirm_offline_order` at `:1685-1713` (builds `ConfirmOrderRequest`, dials `TRADING_ENDPOINT`, `metadata=_metadata(("x-user-id", user_id))`), `list_account_positions` at `:1742-1754` (calls `PortfolioService.ListPositions`, returns `MessageToDict(p, preserving_proto_field_name=True)` per position — so the new `as_of`/`source` fields ride through automatically once the proto carries them).
- The agent forwards the full propagation trio via one `CallerPropagationMiddleware` (services/xstockstrat-agent/CLAUDE.md § Role) — no per-tool header plumbing; the new client call reuses the same ephemeral-channel + `_metadata` pattern, so C-03 is satisfied by the existing mechanism.

**TDD**: `red-green required` (covered by Step 13)

**Covers**: `—`

**Instructions**:
1. Add `client.snapshot_offline_positions(user_id, account_id, as_of_iso, client_snapshot_id, positions_json) -> dict`
   in `client.py` mirroring `confirm_offline_order` (`:1685`): parse `positions_json` (a JSON string
   `[{"symbol","qty","avg_cost_per_share"}, …]`, the `credentials_json` blob-as-string pattern) into
   `PositionBaseline` messages; build `SnapshotOfflinePositionsRequest(account_id, user_id, as_of
   (Timestamp from ISO), client_snapshot_id, positions=[...])`; dial `TRADING_ENDPOINT`,
   `stub.SnapshotOfflinePositions(req, metadata=_metadata(("x-user-id", user_id)))`; return
   `{"account_id", "committed_count", "rejected": [...], "warnings": [...]}` via `MessageToDict`.
   Raise a `ValueError` on unparseable `positions_json`.
2. Add flat scalar params to `manage_offline_account` (`:1468-1482`): `as_of: str = ""`,
   `client_snapshot_id: str = ""`, `positions_json: str = ""`.
3. Add the dispatch branch (before the unknown-operation raise at `:1539`):
   ```python
   if operation == "snapshot_positions":
       if not account_id or not positions_json:
           raise ValueError("snapshot_positions requires account_id and positions_json")
       nonce = client_snapshot_id or f"agent-{uuid.uuid4()}"
       return await client.snapshot_offline_positions(
           user_id, account_id, as_of or None, nonce, positions_json
       )
   ```
   Update the docstring (`:1489-1507`) with the new `snapshot_positions` operation and the
   `list_positions` provenance note, and the unknown-operation message (`:1540-1541`) to include it.
4. `list_positions` provenance requires **no client change** — `list_account_positions`'s
   `MessageToDict` already serializes every proto field, so `source`/`as_of` appear automatically
   once Steps 1/10 land. Note this explicitly (an absence-of-change claim to verify, not assume).

**Verification**: covered by Step 13 (build + tests + lint):
```
cd services/xstockstrat-agent && ruff check . && ruff format --check .
grep -n "snapshot_positions\|snapshot_offline_positions\|positions_json" app/tools.py app/client.py
```

---

### Step 13 — test: agent snapshot_positions dispatch + provenance passthrough

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify (or the offline-tool test module if one exists — grep `manage_offline_account` under `tests/` and extend the file that owns it)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability

**Codebase Evidence**:
- Agent suite runs in CI at threshold 40 (`pytest --cov=app --cov-fail-under=40`; services/xstockstrat-agent/CLAUDE.md § Running Tests). Existing tool tests: `services/xstockstrat-agent/tests/test_tools_endpoint.py` (grep `manage_offline_account` there first to find the exact owning module).

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions** (written RED against the pre-Step-12 tree):
1. Assert `manage_offline_account(operation="snapshot_positions", ...)` with a valid
   `positions_json` calls `client.snapshot_offline_positions` with the parsed baseline and the
   caller's `user_id`, and returns the `{account_id, committed_count, rejected, warnings}` shape
   (mock the client method — mirror the existing offline-op tests' mocking style).
2. Assert the guard: missing `account_id`/`positions_json` raises `ValueError`; unparseable
   `positions_json` raises.
3. Assert `list_positions` passes through `source`/`as_of` when the mocked
   `PortfolioService.ListPositions` returns a `Position` carrying them (provenance passthrough — AC-1
   surface at the agent).

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
```
Threshold passes. Test-data (C-13): baseline/position literals are single-consumer scenario one-offs
inline in the test module — compliant; no new fixture home.

---

### Step 14 — docs: MCP tool reference, agent + trading + portfolio CLAUDE.md

**Status**: `pending`
**Service**: `docs/` + service CLAUDE.md files
**Files**:
- `docs/runbooks/mcp-tools.md` — modify (`manage_offline_account` section, `:1087`)
- `services/xstockstrat-agent/CLAUDE.md` — modify (`manage_offline_account` MCP Tools row)
- `services/xstockstrat-trading/CLAUDE.md` — modify (Ledger Events Emitted table + Database section)
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (Database — `portfolio.positions` provenance columns; Ledger Events Consumed note)

**Reviewers**: none

**Codebase Evidence**:
- `mcp-tools.md` `manage_offline_account` section at `docs/runbooks/mcp-tools.md:1087`; the tool-count line "thirty tools" at `:3` and `:37`.
- Trading Ledger Events Emitted table + Database section in `services/xstockstrat-trading/CLAUDE.md` (both present, per the file read).
- Portfolio Database section lists `portfolio.positions` columns per migration in `services/xstockstrat-portfolio/CLAUDE.md`.

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. `mcp-tools.md`: document the new `snapshot_positions` operation on `manage_offline_account`
   (params `account_id`, `as_of`, `client_snapshot_id`, `positions_json`; response
   `committed_count`/`rejected`/`warnings`) and the `list_positions` `source`/`as_of` provenance.
   **Tool count is unchanged — "thirty tools" stays** (this adds an *operation* to an existing tool,
   not a new tool; do not edit `:3`/`:37`). Verify that absence claim by confirming no new
   `server.tool`/registration was added in Step 12.
2. `services/xstockstrat-agent/CLAUDE.md`: extend the `manage_offline_account` row to mention the
   snapshot/baseline operation.
3. `services/xstockstrat-trading/CLAUDE.md`: add a **Ledger Events Emitted** row
   `account.positions.baseline_set | account:{account_id} | Offline position baseline recorded
   (feature 162)`; add `trading.offline_position_baselines` to the **Database** section (plain table,
   effective = greatest `as_of` per account, migration `009`).
4. `services/xstockstrat-portfolio/CLAUDE.md`: note the `portfolio.positions.source`/`as_of` provenance
   columns (migration `013`) and that `account.positions.synced` now carries per-position `source`/`as_of`.
5. **Out-of-repo surface note (P-03):** the `xstockstrat-trade-confirm-ingest` skill named in the
   product spec's Consumer Surface is **session/marketplace-managed, not a file in this repo**
   (`find` under the repo returns nothing; only `plugins/strat-lab/` is in-tree, and the root
   CLAUDE.md strat-lab rule lists `run_backtest`/`manage_strategy`/`trigger_backfill`/`set_strategy_live`
   — **not** `manage_offline_account`, so no in-repo strat-lab skill edit is due). Record in
   `context.md` that updating that external skill is a follow-up outside this PR's reach, so the
   in-repo doc surfaces (this step) are the complete repo-side C-14 documentation.

**Verification**:
```
grep -n "snapshot_positions\|account.positions.baseline_set\|offline_position_baselines" docs/runbooks/mcp-tools.md services/xstockstrat-trading/CLAUDE.md services/xstockstrat-agent/CLAUDE.md
grep -n "thirty tools" docs/runbooks/mcp-tools.md   # confirm still present, count unchanged
```
Run `/context-scrubber scan` scoped to the touched CLAUDE.md/docs (Teardown rule) and fix grounded findings.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
