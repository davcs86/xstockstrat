# Implementation Spec: signal-performance-attribution

**Status**: `pending`
**Created**: 2026-08-31
**Feature**: `docs/roadmap/features/029-signal-performance-attribution/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/signal-performance-attribution`

---

## Execution Summary

029 is **two additive, non-breaking pieces** (per `design.md` § Chosen Approach):

- **(A) A read-side `GetAttribution` RPC in `xstockstrat-analysis`** that aggregates feature 042's
  already-persisted `analysis.pnl_positions` (sealed realized P&L, user-scoped) +
  `analysis.order_snapshots.signals` (per-order `{name,value,source}` conviction capture). No
  producer-side rebuild, no `trading.orders` migration, no `PlaceOrder` weight vector.
- **(B) An additive per-fill `fees` seam**: `broker.BrokerOrder.Fees` (Alpaca/IBKR leave 0) → an
  additive `"fees"` key on the `order.filled`/`order.partially_filled` **Struct** payload (no proto
  change) → a new `portfolio.positions.fees_accum` column (migration **014**) folded in the
  realized-P&L path → an additive `"fees_total"` key on `portfolio.position.closed` (existing
  `realized_pnl` stays **gross**/authoritative) → a new `analysis.pnl_positions.fees_total` column
  (migration **021**) persisted by the 042 consumer → the `GetAttribution` win test `net =
  realized_pnl − fees_total > 0`.

**Ordering rationale**: proto first (1–2) so all downstream typed code compiles; the two additive
migrations next (3–4) so the columns exist before any code writes them; then the fee seam **in event
flow order** — trading emit (5–6) → portfolio fold (7–8) → analysis persist (9–10); then the read
handler (11–12); then the consumer surface UI (13–14); then acceptance promotion (15). The fee-seam
code steps default the fee to 0 everywhere a real source is absent (Alpaca exposes none today —
`design.md` Open Risk), so the seam is correct end-to-end and unit tests prove the subtraction with an
**injected** fee (AC-6/AC-10).

**Consumer surface (C-14)**: the product spec names **UI `/insights`** as the sole surface (Agent
marked "not required"). Steps 13–14 land it — a new `/insights/attribution` page + `PLATFORM_SUBNAV`
registration + nav-reachability test (C-10(a)). No Agent step is required (decision, not omission).

**Two `/sdd-spec` decisions surfaced (C-11 — do not paper over):**

1. **`SourceAttribution.trade_count` / `win_count` are `double`, not int32.** FR-3's exact-tie case
   splits a trade **0.5/0.5** across the tied sources (AC-5), which an int32 count cannot represent;
   AC-1's integer counts (20, 13) are exact doubles. Winner-takes-all trades contribute weight `1.0`.
   `win_rate`/`avg_return`/`total_pnl` are already `double`.
2. **`avg_return` is a percent over an approximate cost basis** (recon "Risks — avg return %"): per
   attributed trade, `net_pnl / cost_basis` where `cost_basis = |earliest order_snapshot price ×
   quantity|` for that position; a trade whose cost basis is 0 (degraded/partial snapshot) is excluded
   from the `avg_return` mean **only** (still counted in `trade_count`). Surfaced in the UI as a v1
   approximation. No `@AC-*` asserts a numeric `avg_return`, so this pin does not change acceptance.

### Scenario Coverage (Constitution C-15)

| `@AC-*` | Covered by step(s) |
|---|---|
| `@AC-1` GetAttribution per-source metrics + reconciles to underlying rows | Step 12 |
| `@AC-2` Insights table renders + sorts by column | Step 14 |
| `@AC-3` No-signal fills → `manual`, excluded | Step 12 |
| `@AC-4` Winner-takes-all highest conviction | Step 12 |
| `@AC-5` Exact-tie 0.5/0.5 split (only V1 fractional case) | Step 12 |
| `@AC-6` Win = realized P&L net of fees > 0 | Step 12 |
| `@AC-7` Filterable by `source_id` within range | Step 12 |
| `@AC-8` Table exports to clipboard as CSV | Step 14 |
| `@AC-9` Newly-registered source appears, no code change | Step 12 |
| `@AC-10` Per-fill fee flows through the plumbing into the net win test | Steps 6, 8, 10, 12 |
| `@AC-11` No fee data ⇒ net == gross (no silent fee) | Steps 8, 12 |

## Step Dependencies

- Step 2 (`proto-gen`) requires Step 1 (`proto`): stubs regenerate from the edited `.proto`.
- Steps 5, 7, 9, 11 (typed Go/Python code touching the new RPC/messages) require Step 2.
- Step 4 (analysis migration 021) — Step 9 (consumer persists `fees_total`) and Step 11
  (`GetAttribution` reads `fees_total` + the `(user_id, closed_at)` index) require the column/index.
- Step 3 (portfolio migration 014) — Step 7 (fold accumulates `fees_accum`) requires the column.
- Step 6 covers Step 5; Step 8 covers Step 7; Step 10 covers Step 9; Step 12 covers Step 11; Step 14
  covers Step 13 (each `test` step is red-before-green for the paired `service` step).
- Step 9 (analysis persist) depends at runtime on Step 7 emitting the `fees_total` payload key, but is
  code-independent (it reads a payload map key; missing ⇒ 0).
- Step 13 (UI) requires Step 2 (typed client method) and Step 11 (handler exists to call).
- Step 15 (acceptance promotion) is last — after every prior step is green.

---

### Step 1 — proto: additive `GetAttribution` RPC + request/response/`SourceAttribution` messages

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes, `buf lint`/`buf breaking` pass against dev trunk; xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `AnalysisService` RPC list ends at `analysis.proto:49` (`rpc QueryPnLPatterns(...) returns (QueryPnLPatternsResponse);`); service block closes at `:50`. New RPC appends after `:49`.
- Existing feature-042 messages `SignalEntry` (`analysis.proto:705-709`, `{string name=1; double value=2; string source=3}`) and `OrderSnapshot` (`:712-724`) are the reuse shape the design cites; `QueryPnLPatternsResponse` is the last message, closing at `:746`. New messages append after `:746`.
- `Opportunity` is at `analysis.proto:542-555` — **untouched** by this step → confirmed no field-number collision with features 095/110 (grep for `GetAttribution`/`SourceAttribution` across `packages/proto/`, `services/`, `docs/roadmap/features/` returned **no** matches outside 029).
- Imports already present: `google/protobuf/timestamp.proto` (`:7`), so `google.protobuf.Timestamp` needs no new import.

**TDD**: `N/A (proto)`

**Covers**: `—`

**Instructions**:
1. In the `AnalysisService` block, after `analysis.proto:49`, append:
   ```proto
   // Per-source trading-performance attribution over closed positions (feature 029). Read-only;
   // aggregates 042's analysis.pnl_positions + order_snapshots.signals. Owner-scoped via x-user-id.
   rpc GetAttribution(GetAttributionRequest) returns (GetAttributionResponse);
   ```
2. After the last message (`QueryPnLPatternsResponse`, ending `:746`), append the three new messages:
   ```proto
   // ── Signal-performance attribution (feature 029) ───────────────────────────────
   message GetAttributionRequest {
     google.protobuf.Timestamp start = 1;
     google.protobuf.Timestamp end = 2;
     string source_id = 3;  // optional filter — the signal_sources.slug; empty = all sources (open registry, C-04: string not enum)
   }
   // Per-source metrics. trade_count/win_count are DOUBLE (not int32): FR-3's exact-tie case
   // contributes 0.5 to each tied source (AC-5); winner-takes-all contributes 1.0. total_pnl is
   // NET of fees (realized_pnl − fees_total). avg_return is a percent over an approximate cost basis.
   message SourceAttribution {
     string source_id = 1;      // signal_sources.slug (the snapshot's signal source)
     string source_name = 2;    // resolved via ingest ListSignalSources; falls back to the slug
     double trade_count = 3;
     double win_count = 4;
     double win_rate = 5;       // win_count / trade_count
     double avg_return = 6;     // mean per-trade net_pnl / cost_basis (percent, v1 approximation)
     double total_pnl = 7;      // net of fees
   }
   message GetAttributionResponse {
     repeated SourceAttribution attributions = 1;
   }
   ```
3. Do **not** add, renumber, or retype any existing field (additive-only, C-09). The fee seam adds **no** proto field (Struct payload keys) — nothing else changes here.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against '.git#branch=main-dev,subdir=packages/proto'
```
Both must pass (breaking = green: additive RPC + new messages only).

---

### Step 2 — proto-gen: regenerate stubs (Go, Python, TS)

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; never hand-edited)

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes, `buf lint`/`buf breaking` pass against dev trunk; xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias
(inherited from Step 1 per the reviewer-registry `proto-gen` rule)

**Codebase Evidence**:
- `./scripts/buf-gen.sh` is the codegen entry point (root CLAUDE.md § Generating Proto Stubs); it emits Go/Python/TS stubs and compiles the TS package. CI's `proto-freshness` job enforces an empty `git diff packages/proto/gen/` afterward.
- Browser TS client `services/xstockstrat-ui/src/lib/browserClients/analysisClient.ts` is `createClient(AnalysisService, transport)` — it exposes `getAttribution` automatically once the regenerated `AnalysisService` carries the new method (no per-method edit needed).

**TDD**: `N/A (proto-gen)`

**Covers**: `—`

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Stage the full regenerated tree under `packages/proto/gen/` (Go, Python, TS + compiled `gen/ts/dist/`). Do not edit any generated file by hand.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Exit 0 after staging confirms the checked-in stubs match a fresh generation (the `proto-freshness` gate).

---

### Step 3 — migration: portfolio `014_positions_fees_accum` (fee accumulator column)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/014_positions_fees_accum.up.sql` — create
- `services/xstockstrat-portfolio/migrations/014_positions_fees_accum.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, index correctness; xstockstrat-portfolio — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `ls services/xstockstrat-portfolio/migrations/ | sort` — last file is `013_positions_provenance.{up,down}.sql` → **next free NNN is `014`** (confirmed no `014_*` exists).
- Mirror target: `010_positions_realized_accum.up.sql` — `ALTER TABLE portfolio.positions ADD COLUMN IF NOT EXISTS realized_accum NUMERIC NOT NULL DEFAULT 0;` and its `.down.sql` `DROP COLUMN IF EXISTS realized_accum;`. `fees_accum` is the exact parallel column.

**TDD**: `N/A (migration)`

**Covers**: `—`

**Instructions**:
1. `.up.sql` (header comment mirroring 010, then):
   ```sql
   ALTER TABLE portfolio.positions
     ADD COLUMN IF NOT EXISTS fees_accum NUMERIC NOT NULL DEFAULT 0;
   ```
2. `.down.sql`:
   ```sql
   ALTER TABLE portfolio.positions
     DROP COLUMN IF EXISTS fees_accum;
   ```
3. `NOT NULL DEFAULT 0` makes it backfill-free (existing rows read fee-free ⇒ net == gross, AC-11).

**Verification** (offline — no DB; per spec-template § Migration step verification):
```bash
ls services/xstockstrat-portfolio/migrations/014_positions_fees_accum.up.sql \
   services/xstockstrat-portfolio/migrations/014_positions_fees_accum.down.sql
```
Then read both: the `.up` `ADD COLUMN fees_accum` is reversed by the `.down` `DROP COLUMN fees_accum` (inverse by inspection). No `014_*` collision existed before this step.

---

### Step 4 — migration: analysis `021_pnl_positions_fees_total` (fee column + range index)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/021_pnl_positions_fees_total.up.sql` — create
- `services/xstockstrat-analysis/migrations/021_pnl_positions_fees_total.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, index correctness; xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `ls services/xstockstrat-analysis/migrations/ | sort` — last file is `020_job_schedule.{up,down}.sql` → **next free NNN is `021`** (confirmed no `021_*` exists).
- Target table `analysis.pnl_positions` defined in `016_order_snapshots_pnl_patterns.up.sql:36-53` — columns `user_id`, `symbol`, `closed_at`, `realized_pnl`; no `fees_total`, no `(user_id, closed_at)` index (only `uidx_pnl_positions_open` on the open-window key). `realized_pnl` stays gross/unchanged.
- `GetAttribution` (Step 11) queries "closed positions for a user in `[start,end]`" → the `(user_id, closed_at)` index serves it.

**TDD**: `N/A (migration)`

**Covers**: `—`

**Instructions**:
1. `.up.sql`:
   ```sql
   ALTER TABLE analysis.pnl_positions
     ADD COLUMN IF NOT EXISTS fees_total NUMERIC NOT NULL DEFAULT 0;
   CREATE INDEX IF NOT EXISTS idx_pnl_positions_user_closed
     ON analysis.pnl_positions (user_id, closed_at);
   ```
2. `.down.sql` (reverse order):
   ```sql
   DROP INDEX IF EXISTS analysis.idx_pnl_positions_user_closed;
   ALTER TABLE analysis.pnl_positions
     DROP COLUMN IF EXISTS fees_total;
   ```
3. `NOT NULL DEFAULT 0`: legacy closes with no `fees_total` payload key read 0 ⇒ net == gross (AC-11).

**Verification** (offline — no DB):
```bash
ls services/xstockstrat-analysis/migrations/021_pnl_positions_fees_total.up.sql \
   services/xstockstrat-analysis/migrations/021_pnl_positions_fees_total.down.sql
```
Then read both: the `.up` `ADD COLUMN fees_total` + `CREATE INDEX idx_pnl_positions_user_closed` are each reversed by a matching `DROP` in `.down` (inverse by inspection). No `021_*` collision existed before this step.

---

### Step 5 — service: trading — `Fees` on `BrokerOrder` + additive `"fees"` key on the fill events

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/broker.go` — modify (add `Fees` field)
- `services/xstockstrat-trading/internal/service/trading.go` — modify (stamp `"fees"` on the two fill emits)

**Reviewers**: xstockstrat-trading — order execution correctness, broker API safety, fill detection, paper-only dev invariant

**Codebase Evidence**:
- `broker.BrokerOrder` struct at `broker.go:15-29` (`BrokerOrderID`, `Status`, `FilledQty`, `FilledAvgPrice`, …) — the normalized order every broker returns; add `Fees float64` here.
- Alpaca's parsed order `AlpacaOrder` at `alpaca.go:76-97` carries **no** fee/commission JSON field → the Alpaca adapter leaves `BrokerOrder.Fees` at its zero value (honest 0; `design.md` Open Risk: US equities commission-free, SEC/TAF fees are Account-Activities-only, not per-fill). IBKR adapter likewise has no per-fill fee → also 0.
- The **only** `order.filled` / `order.partially_filled` emit sites are in the fill poller `pollFills`: `trading.go:1712-1717` (`order.filled`, payload `{order_id, symbol, qty, fill_price, user_id, trading_mode, account_id}`) and `trading.go:1728-1733` (`order.partially_filled`, payload `{order_id, symbol, filled_qty, fill_price, user_id, trading_mode, account_id}`). Grep for `"order.filled"`/`"order.partially_filled"` across `trading.go` confirms these are the sole emit sites.
- `brokerOrder` (a `*broker.BrokerOrder`) is in scope at both emit sites (`trading.go:1690` `order.FilledQty == brokerOrder.FilledQty`; `:1696-1697` assign `order.FilledAvgPrice/FilledQty` from it) → `brokerOrder.Fees` is available to stamp.
- Note (grounded correction to `design.md`'s `:731-732` reference): the submit-time path (`trading.go:719-766`) captures `brokerOrder.FilledQty/FilledAvgPrice` onto the order but emits **no** `order.filled` there (it emits `order.broker_submitted` at `:763`); the immediate fill's `order.filled` is emitted later by `pollFills`. So the fee stamp lands only at `:1712`/`:1728`, where the event is actually emitted.
- The event payload becomes a `google.protobuf.Struct` at emit (`emitLedgerEvent`, `trading.go:3607`) — an additive map key is schemaless, **no proto change** (C-09; `ledger/v1/ledger.proto:27`).

**TDD**: `red-green required`

**Covers**: `—` (paired test Step 6 covers `@AC-10`)

**Instructions**:
1. `broker.go`: add to `BrokerOrder` (after `FilledAvgPrice`, `:19`):
   ```go
   Fees float64 // cumulative broker fees for the order; 0 when the broker exposes none (Alpaca/IBKR today)
   ```
2. `trading.go:1712-1717` (`order.filled` payload map): add key `"fees": brokerOrder.Fees`.
3. `trading.go:1728-1733` (`order.partially_filled` payload map): add key `"fees": brokerOrder.Fees`.
4. Do **not** change the existing keys, the emit path, or any order-execution branch. **Fill-state completeness (step-constraints §A)**: both `FILLED` and `PARTIALLY_FILLED` emit paths are handled here. **Broker coverage**: both Alpaca and IBKR leave `Fees=0` (no per-fill fee source) — a named follow-up will source Alpaca regulatory fees from the Activities API (`design.md` Open Risk); note this inline. **C-3 (paper/live)**: no execution path changes — mode-agnostic, paper-testable.

**Verification**: covered by Step 6 (lint + coverage + behavioral assertions).

---

### Step 6 — test: trading fill events carry the additive `fees` key

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_helpers_test.go` — modify (add fee-stamp cases), or a new `trading_fees_test.go` — create

**Reviewers**: xstockstrat-trading — order execution correctness, broker API safety, fill detection, paper-only dev invariant

**Codebase Evidence**:
- Existing service test homes: `services/xstockstrat-trading/internal/service/*_test.go` (e.g. `trading_helpers_test.go`, `trading_sync_test.go`). Broker-struct tests live in `internal/broker/*_test.go`.
- The payload builder for the two emits is the inline `map[string]interface{}` at `trading.go:1712`/`:1728`; assert the built payload includes `"fees"` with the `brokerOrder.Fees` value. Single-consumer domain literal (a fee amount) — inline is C-13-compliant (state so; no second consumer, no `internal/testdata/` home needed).

**TDD**: `red-green required`

**Covers**: `@AC-10`

**Instructions**:
1. Write a test (RED before Step 5) asserting that when a poll cycle transitions an order to `FILLED` with `brokerOrder.Fees = 1.20`, the emitted `order.filled` payload contains `fees == 1.20` **and** the unchanged `fill_price`/`qty`/`user_id`/`account_id`/`trading_mode` keys (AC-10's "unchanged gross" leg at the trading edge). Add a partial-fill case: `PARTIALLY_FILLED` emits `fees` on `order.partially_filled` too.
2. Assert the Alpaca-path default: a `BrokerOrder` parsed from an `AlpacaOrder` with no fee JSON yields `Fees == 0` (the honest 0-default).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Confirm ≥ 40%. The fee-stamp logic lives in `internal/service/` (a coverage-excluded package) — note "new logic is in an excluded package; the behavioral assertions above are the gate" and keep the test.

---

### Step 7 — service: portfolio — fold per-fill `fees` into `fees_accum`; emit `fees_total` on close

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (`orderFillPayload` + fold + close emit)
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify (`UpsertPosition` fee delta + `GetFeesAccum`)

**Reviewers**: xstockstrat-portfolio — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `orderFillPayload` struct at `portfolio_service.go:217-231` (`UserID`, `Symbol`, `Qty`, `FillPrice`, `Mode`, `AccountId`, `StopPrice`, …) — parses the `order.filled`/`order.partially_filled` payload. Add a `Fees float64 \`json:"fees"\`` field (reads the additive key from Step 5; absent ⇒ 0).
- Realized-P&L fold at `portfolio_service.go:288-321`: `delta = pnl.RealizedDelta(...)` (`:292`); full close at `newQty <= 0` (`:295-307`) reads `GetRealizedAccum` (`:300`) and emits `portfolio.position.closed` with `{user_id, symbol, account_id, trading_mode, realized_pnl}` (`:304-307`); the non-close branch calls `UpsertPosition(..., delta)` (`:309`).
- `UpsertPosition` at `portfolio_repo.go:57-65` accumulates `realized_accum = portfolio.positions.realized_accum + $8` (the `realizedDelta` arg). `GetRealizedAccum` at `portfolio_repo.go:70-85` reads `COALESCE(realized_accum, 0)`. `fees_accum` mirrors both exactly.
- Producer contract (portfolio CLAUDE.md § Ledger Events Emitted): `realized_pnl` stays **gross** and its keys unchanged — `fees_total` is **added** (C-16 PRESERVE, C-10(b) parity intact).

**TDD**: `red-green required`

**Covers**: `—` (paired test Step 8 covers `@AC-10`, `@AC-11`)

**Instructions**:
1. `orderFillPayload` (`:217-231`): add `Fees float64 \`json:"fees"\``.
2. `portfolio_repo.go`: extend `UpsertPosition` with a `feesDelta float64` parameter and add `fees_accum=portfolio.positions.fees_accum + $N` to the `ON CONFLICT DO UPDATE` set (and `fees_accum` = the fill's fee in the INSERT column list) — the exact parallel of `realized_accum`. Add `GetFeesAccum(ctx, userID, symbol, mode, accountID)` mirroring `GetRealizedAccum` (`SELECT COALESCE(fees_accum, 0) …`).
3. `portfolio_service.go`: pass `fill.Fees` as the new `feesDelta` arg at the `UpsertPosition` call (`:309`). At the full-close branch (`:295-307`): read `priorFees, _ := s.repo.GetFeesAccum(...)` (parallel to `GetRealizedAccum` at `:300`), compute `feesTotal := priorFees + fill.Fees`, and add `"fees_total": feesTotal` to the `portfolio.position.closed` payload map (`:304-307`). **Leave the existing `realized_pnl` key gross and unchanged.**
4. This uses the existing pgxpool (no new pool — budget stays 2, F-06). No new outbound gRPC call → no header-propagation obligation triggered.

**Verification**: covered by Step 8.

---

### Step 8 — test: portfolio fee fold + `fees_total` emit; no-fee ⇒ gross

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go` — modify, or new `portfolio_fees_test.go` — create
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go` — modify (pgxmock `UpsertPosition`/`GetFeesAccum`)

**Reviewers**: xstockstrat-portfolio — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Existing fold tests: `services/xstockstrat-portfolio/internal/service/pnl_fold_test.go` (realized-delta fold cases) and `portfolio_helpers_test.go`. Repo tests use pgxmock (`portfolio_repo_test.go`, per the `queryRower` seam at `portfolio_repo.go:22-33`).
- AC-10 concrete: a `$1.20` fee on a fill that fully closes a position with gross realized `$1.00` → `portfolio.position.closed` carries `fees_total == 1.20` and `realized_pnl == 1.00` (unchanged gross).

**TDD**: `red-green required`

**Covers**: `@AC-10`, `@AC-11`

**Instructions**:
1. RED-first test: drive `processOrderFill` with an opening fill (fee `$X`) then a closing fill (fee `$1.20`) that zeroes qty on a position whose gross realized is `$1.00`; assert the emitted `portfolio.position.closed` payload has `fees_total == priorFeesAccum + 1.20` and `realized_pnl == 1.00` unchanged (AC-10). Assert the fold path via the `pnl.RealizedDelta` gross figure is untouched.
2. AC-11 case: a close whose fills carried **no** `fees` key (`fees_total` accumulates to `0`) emits `fees_total == 0`, so a downstream net == gross.
3. Repo test: `UpsertPosition` with a fee delta issues the `fees_accum = fees_accum + $N` upsert; `GetFeesAccum` returns `COALESCE(fees_accum,0)` (0 on `ErrNoRows`). Single-consumer literals — inline is C-13-compliant (state so).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Confirm ≥ 40%. Fold/emit logic is in the coverage-excluded `internal/service`/`internal/repository` packages — note "new logic is in excluded packages; the behavioral + pgxmock assertions are the gate" and keep the test.

---

### Step 9 — service: analysis — 042 consumer persists `fees_total` on seal

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py` — modify (`_handle_close_event`)
- `services/xstockstrat-analysis/app/repositories/pnl_positions.py` — modify (`seal` writes `fees_total`)

**Reviewers**: xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_handle_close_event` at `pnl_pattern_consumer.py:256-283`: parses `realized_pnl = _num(payload.get("realized_pnl"))` (`:261`) and calls `self._positions.seal(conn, ..., realized_pnl=realized_pnl, close_event_id=...)` (`:267-276`). Add a parallel `fees_total = _num(payload.get("fees_total"))` (absent ⇒ `_num(None)` = `0.0`, the AC-11 default) and pass it into `seal`.
- `PnLPositionsRepository.seal` at `pnl_positions.py:46-76`: `UPDATE analysis.pnl_positions SET closed_at=$5, realized_pnl=$6, close_event_id=$7 …`. Add `fees_total=$8` to the SET and a `fees_total` parameter; `realized_pnl` stays gross/unchanged.
- Reuses the shared asyncpg pool (no new pool — budget stays 2, F-06).

**TDD**: `red-green required`

**Covers**: `—` (paired test Step 10 covers `@AC-10`)

**Instructions**:
1. `pnl_positions.py` `seal(...)`: add keyword param `fees_total: float`, add `fees_total=$8` to the `SET` clause, and pass it as the 8th bind arg (renumber the existing `close_event_id=$7` binds accordingly — it becomes `$8`→shift: keep `closed_at=$5, realized_pnl=$6, close_event_id=$7, fees_total=$8` and append the arg). Keep the `RETURNING position_id, strategy_id, symbol` and the `WHERE … closed_at IS NULL` dedup untouched.
2. `pnl_pattern_consumer.py` `_handle_close_event`: after `:261`, add `fees_total = _num(payload.get("fees_total"))`; pass `fees_total=fees_total` in the `self._positions.seal(...)` call at `:267-276`.
3. Do not touch `_build_samples` / `pnl_pattern_samples` (feature 042 PRESERVE); `realized_pnl` stays gross.

**Verification**: covered by Step 10.

---

### Step 10 — test: analysis consumer persists `fees_total` (default 0 when absent)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py` — modify

**Reviewers**: xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py` already exercises `_handle_close_event` with injected fake repos (`PnLPatternConsumer.__init__` accepts `positions=` fakes, `pnl_pattern_consumer.py:127-139`) — the same seam captures the `fees_total` arg passed to `seal`.

**TDD**: `red-green required`

**Covers**: `@AC-10`

**Instructions**:
1. RED-first: feed a `portfolio.position.closed` event whose payload carries `realized_pnl=1.00` and `fees_total=1.20`; assert the fake `positions.seal` is called with `realized_pnl=1.00` **and** `fees_total=1.20` (AC-10 persistence leg).
2. AC-11 default: a close payload with **no** `fees_total` key seals with `fees_total == 0.0`.
3. Domain literals inline — single consumer, C-13-compliant (state so; no `tests/conftest.py` home needed).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
```
Confirm the suite passes and coverage ≥ 40%.

---

### Step 11 — service: analysis — `GetAttribution` handler + attribution reads

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (`GetAttribution` handler)
- `services/xstockstrat-analysis/app/repositories/pnl_positions.py` — modify (closed-in-range read)
- `services/xstockstrat-analysis/app/repositories/order_snapshots.py` — modify (attribution inputs read)

**Reviewers**: xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `QueryPnLPatterns` handler at `servicer.py:2817-2854` is the read-only, DB-only precedent to mirror (buckets at query time, `if self._pnl_samples_repo is None: return empty`).
- Owner scoping: `AnalysisServicer._caller_user_id(context)` at `servicer.py:439-449` — resolves the caller from the `x-user-id` header (feature 133; anti-IDOR fail 131). Use it, never a request body id.
- Ingest stub already wired: `self._ingest` (`servicer.py:346`); the existing `ListSignalSources` call pattern is `_drain_source_weights` at `servicer.py:3598-3611` (`await self._ingest.ListSignalSources(ingest_pb2.ListSignalSourcesRequest(include_inactive=True), metadata=propagation_meta)` → `{src.slug: …}`). `SignalSource` fields are `slug=1`, `display_name=2` (`ingest.proto:143-146`). Reuse for slug→display_name (unknown slug ⇒ fall back to the slug, satisfying AC-9 auto-appearance).
- **Header propagation (step-constraints §B)**: the new outbound `ListSignalSources` call must forward `x-user-id`/`x-access-scope`/`x-trace-id` — build `propagation_meta` from `context.invocation_metadata()` exactly as `servicer.py:517-522`/`:553-556` do, and pass `metadata=propagation_meta` (reuses the existing per-method Python propagation pattern; `docs/patterns/header-propagation.md`).
- Source data: `analysis.pnl_positions` (`user_id`, `symbol`, `closed_at`, `realized_pnl`, new `fees_total`) and `analysis.order_snapshots.signals` JSONB `[{name,value,source}]` (written at `pnl_pattern_consumer.py:113-116`, `:206-223`). `OrderSnapshotsRepository.list_for_position` at `order_snapshots.py:63-70` returns `indicators, signals` per position — add a sibling read that also returns the earliest `price, quantity` for the cost-basis denominator (do **not** alter `list_for_position`, which feature 042's `_build_samples` depends on — C-16 PRESERVE).
- Config-read precedent (if any tunable is needed): `self._cfg.get_int(...)` (`servicer.py:2836`). None required for this handler.

**TDD**: `red-green required`

**Covers**: `—` (paired test Step 12 covers `@AC-1,3,4,5,6,7,9,10,11`)

**Instructions**:
1. `pnl_positions.py`: add `list_closed_for_attribution(self, *, user_id, start, end, source_id=None)` → returns rows `{position_id, symbol, realized_pnl, fees_total, closed_at}` for `user_id=$1 AND closed_at BETWEEN $2 AND $3 AND closed_at IS NOT NULL` (uses the migration-021 `(user_id, closed_at)` index). The optional `source_id` is applied in the handler after attribution (a slug lives in the snapshot signals, not on `pnl_positions`), not in SQL.
2. `order_snapshots.py`: add `attribution_inputs_for_position(self, position_id)` → returns the position's snapshot rows ordered by `event_ts ASC` with `signals`, `price`, `quantity` (SELECT adds `price, quantity` to the existing `list_for_position` shape; new method, existing one unchanged).
3. `servicer.py`: add a pure helper `attribute_trade(signals) -> dict[str, float]` implementing **winner-takes-all** (the source of the max-`value` signal across the position's snapshots gets weight `1.0`) with the **exact-tie** rule (all sources sharing the top value split equally — a two-way tie ⇒ `0.5` each; AC-4/AC-5). A position whose unioned snapshots carry **no** signals returns `{}` → the trade is `manual`, excluded from per-source metrics (AC-3).
4. Add `async def GetAttribution(self, request, context)`:
   - `caller = self._caller_user_id(context)`; empty caller owns nothing → return empty response.
   - If the `pnl_positions`/`order_snapshots` repos are `None` (no-DB test path), return `GetAttributionResponse()` (mirror `QueryPnLPatterns:2824`).
   - `start = request.start.ToDatetime() if request.HasField("start") else None`; same for `end`.
   - Read closed positions in range; for each, read its attribution inputs, compute `weights = attribute_trade(signals)`; `net = realized_pnl - fees_total`; `win = net > 0` (FR-4/AC-6); `cost_basis = abs(earliest price × quantity)`; per source `s`, accumulate `trade_count += w`, `win_count += w if win`, `total_pnl += w * net`, and (when `cost_basis > 0`) a weighted `return_pct = net / cost_basis` into a mean accumulator.
   - Apply the optional `request.source_id` filter (AC-7): drop sources not equal to it before building rows (a `manual`/no-signal trade is already excluded).
   - Resolve `source_name` per surviving slug via `ListSignalSources` (best-effort, `propagation_meta`; unknown slug ⇒ the slug itself — AC-9).
   - Emit one `SourceAttribution{source_id=slug, source_name, trade_count, win_count, win_rate=win_count/trade_count (0-guarded), avg_return=mean return_pct, total_pnl}` per source.
5. Read-only; reuses the shared asyncpg pool + existing ingest stub (no new pool, no new edge — F-06).

**Verification**: covered by Step 12.

---

### Step 12 — test: analysis `GetAttribution` aggregation, tie split, net-of-fees, filter, auto-source

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_get_attribution.py` — create

**Reviewers**: xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Sibling read-handler test precedent: `services/xstockstrat-analysis/tests/test_query_pnl_patterns.py` and `test_analysis_servicer.py` (fake-repo/`make_servicer()` seam; `_caller_user_id` reads `context.invocation_metadata()` at `servicer.py:439-449`, so a fake context sets `x-user-id`).
- The pure `attribute_trade` helper (Step 11) is directly unit-testable for AC-4/AC-5 without DB.

**TDD**: `red-green required`

**Covers**: `@AC-1`, `@AC-3`, `@AC-4`, `@AC-5`, `@AC-6`, `@AC-7`, `@AC-9`, `@AC-10`, `@AC-11`

**Instructions** (RED before Step 11 — assert new behavior):
1. **AC-1**: 20 closed positions attributed to `form4`, 13 with `net > 0`; `GetAttribution(start,end)` returns a `form4` row with `trade_count==20`, `win_count==13`, `win_rate==0.65`, and a net `total_pnl`; assert the row's gross+fees reconcile to the underlying `pnl_positions.realized_pnl`/`fees_total` sums (C-10(b) parity check, `design.md` Open Risk).
2. **AC-4**: `attribute_trade({form4:0.7, news:0.3})` → `{form4:1.0}` (no `news`).
3. **AC-5**: `attribute_trade({form4:0.5, news:0.5})` → `{form4:0.5, news:0.5}`; assert the equal split appears in the aggregated rows (why `trade_count`/`win_count` are `double`).
4. **AC-3**: 20 `form4` positions + 5 with no signals → the 5 are `manual`/excluded; `form4.trade_count==20`, no `manual` row in per-source metrics.
5. **AC-6**: a position gross `$12` / fees `$15` → `net==-3` counted a **loss**; a second gross `$50` / fees `$10` → `net==40` a **win**.
6. **AC-10**: a position with `realized_pnl=1.00`, `fees_total=1.20` → `net==-0.20`, counted a loss.
7. **AC-11**: a position with `fees_total=0` → `net==realized_pnl`; win/loss identical to gross-only.
8. **AC-7**: `GetAttribution(start,end,source_id="form4")` returns only the `form4` row, no `news`.
9. **AC-9**: a brand-new slug `insider8k` (registered after ship, present in snapshot signals, resolvable — or unknown — via `ListSignalSources`) appears with `trade_count==3` and no handler code change.
10. Owner-scoping: a query with a different `x-user-id` sees none of the caller's rows (anti-IDOR, fail 131).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
```
Confirm the suite passes and coverage ≥ 40%.

---

### Step 13 — service: UI — `/insights/attribution` page, BFF+hook, nav registration, fixture

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify (register `getAttribution`)
- `services/xstockstrat-ui/src/hooks/useSignalAttribution.ts` — create
- `services/xstockstrat-ui/src/app/insights/attribution/page.tsx` — create
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify (`PLATFORM_SUBNAV.insights`)
- `services/xstockstrat-ui/e2e/fixtures/attribution.ts` — create (`SourceAttribution` fixture)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog row)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (`getAttribution` handler)

**Reviewers**: xstockstrat-ui — analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- BFF registration precedent: `insightsBff.ts:59` `queryPnLPatterns: forward((req, opts) => analysisClient.queryPnLPatterns(req, opts))` inside `router.service(AnalysisService, {...})` — add `getAttribution` the same way (`forward` applies `backendHeaders`, forwarding `x-user-id` so the handler resolves the owner).
- Browser client `src/lib/browserClients/analysisClient.ts` is `createClient(AnalysisService, transport)` (baseUrl `/insights/api`) — exposes `getAttribution` automatically post-Step 2 (no edit).
- Hook precedent: `src/hooks/usePnLPatterns.ts` (`useQuery` → `analysisClient.queryPnLPatterns`). Model `useSignalAttribution({start, end, sourceId})` on it.
- Page precedent: `src/app/insights/pnl-patterns/page.tsx` (client component, `AppShell`, `Card`, `Input`, `data-testid`s). Sortable primitive: `src/components/ui/data-table.tsx` (`DataTable<TData,TValue>` with `ColumnDef`, `getSortedRowModel`, sortable headers) — the FR-6 sortable table.
- Nav precedent: `PlatformHeader.tsx:72` `PLATFORM_SUBNAV`; `insights` array at `:79-84` lists Opportunities/Strategies/Formulas/**P&L Patterns** (`:82`)/Screener/Watchlists — add `{ label: 'Attribution', href: '/insights/attribution' }` (the same direct-sibling pattern feature 042's P&L Patterns uses; C-10(a) reachability).
- Fixture/inventory precedent: `e2e/fixtures/pnlPatterns.ts` (`PNL_PATTERNS_AAPL`) + its `INVENTORY.md` "P&L patterns (feature 042)" row; `e2e/mock-backend.ts` `queryPnLPatterns` handler. Mirror for `SourceAttribution`. Auth helper: `e2e/helpers/auth.ts` `addAuthCookie` (canonical; never re-implement JWT signing).
- Design-role tokens + canonical state primitives only (C-17): reuse `Skeleton`/`EmptyState`/`CardNotice` as the pnl-patterns/opportunities pages do; label P&L "net of fees (broker regulatory fees pending)" (`design.md` Consumer surface).

**TDD**: `red-green required`

**Covers**: `—` (paired e2e Step 14 covers `@AC-2`, `@AC-8`, and nav reachability)

**Instructions**:
1. `insightsBff.ts`: inside the `AnalysisService` router block (next to `:59`), add `getAttribution: forward((req, opts) => analysisClient.getAttribution(req, opts))`.
2. `useSignalAttribution.ts`: `useQuery(['signal-attribution', start, end, sourceId], () => analysisClient.getAttribution({ start, end, sourceId }))` (Timestamps built the protobuf-es `{seconds: bigint}` way — see the UI constitution note). Model on `usePnLPatterns.ts`.
3. `attribution/page.tsx` (client component in `AppShell`): a date-range control (two date inputs → request `start`/`end`), a `source_id` filter `Input`, and a `DataTable` with columns **source name, trades, win rate, avg return %, total P&L** (sortable headers, FR-6). Add a "Copy to clipboard" button that serializes the displayed rows to CSV with header `source name,trades,win rate,avg return %,total P&L` and one data line per source (FR-7/AC-8) via `navigator.clipboard.writeText`. `data-testid`s for the page root, table, and copy button. Empty/loading/error via the canonical primitives (C-17).
4. `PlatformHeader.tsx`: add the `Attribution` subnav entry to `PLATFORM_SUBNAV.insights`.
5. `e2e/fixtures/attribution.ts`: export `SOURCE_ATTRIBUTION` (e.g. rows `form4` and `news` with distinct trade/win/return/pnl values so the spec proves which field the UI reads) shaped as `xstockstrat.analysis.v1.GetAttributionResponse`. Add the catalog row to `INVENTORY.md` under "Canonical fixtures" (Constitution C-12/C-13).
6. `e2e/mock-backend.ts`: add a `getAttribution` handler returning `SOURCE_ATTRIBUTION`.

**Verification**: covered by Step 14.

---

### Step 14 — test: UI e2e — attribution table renders, sorts, exports CSV, is nav-reachable

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/attribution.spec.ts` — create

**Reviewers**: xstockstrat-ui — analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- E2E precedent: `e2e/insights/pnl-patterns.spec.ts` (`addAuthCookie(page)`, `page.goto('/insights/...')`, `getByTestId`/`getByRole` assertions against the mock-backed fixture). Nav-reachability precedent: the insights specs navigate via the shared shell; the C-10(a) "060/058 fail" the design cites is a subnav link that renders but never routes — assert the `Attribution` `PLATFORM_SUBNAV` link is present and clicking it lands on the page.
- CSV clipboard: Playwright can read `navigator.clipboard` after `context.grantPermissions(['clipboard-read','clipboard-write'])` (standard chromium e2e pattern).

**TDD**: `red-green required`

**Covers**: `@AC-2`, `@AC-8`

**Instructions** (RED before Step 13):
1. **AC-2**: `addAuthCookie`, goto `/insights/attribution`; assert the table shows columns **source name, trades, win rate, avg return %, total P&L** with the `form4`/`news` fixture rows; click the "win rate" header and assert rows reorder by win rate descending.
2. **AC-8**: grant clipboard permissions, click "Copy to clipboard", read the clipboard, assert the first line is exactly `source name,trades,win rate,avg return %,total P&L` and there is one data line per displayed source.
3. **Nav reachability (C-10(a))**: from an insights page, assert the `Attribution` entry exists in the shared `PLATFORM_SUBNAV` and that clicking it navigates to `/insights/attribution` (guards the 060/058 "link renders but never routes" failure).
4. Import the fixture from `e2e/fixtures/attribution.ts` and auth from `e2e/helpers/auth.ts` (C-12 — no inline domain literals; assert imports).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e -- attribution
```
The suite has no coverage threshold (Playwright e2e); confirm the new spec passes and `INVENTORY.md` was updated in Step 13 (`grep -n "SOURCE_ATTRIBUTION" e2e/fixtures/INVENTORY.md`).

---

### Step 15 — docs: acceptance promotion + net-of-fees limitation note

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `services/xstockstrat-analysis/acceptance/` — add/extend a durable per-service business-rule suite entry for 029 (promotion at launch, C-16)
- `docs/roadmap/features/029-signal-performance-attribution/context.md` — append the launch note

**Reviewers**: none

**Codebase Evidence**:
- Feature 042's durable suite is `services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature` (recon "Existing Business Rules") — the same home the 029 `@AC-*` scenarios promote into at launch (C-15 → C-16). 042's suite is **PRESERVE**, unchanged.
- `design.md` Open Risk: Alpaca-sourced `fees` is 0 until a named Activities-API follow-up; record the limitation and the follow-up.

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. On launch, promote the `029` `@AC-*` scenarios into the analysis durable business-rule suite (per C-16), leaving 042's `order-snapshots-pnl-patterns.feature` untouched (PRESERVE).
2. Record in `context.md`: the two `/sdd-spec` decisions (double counts; approximate cost-basis `avg_return`), the Alpaca-fee-0 limitation + named follow-up (Activities-API per-fill regulatory-fee sourcing), and the C-10(b) parity check.

**Verification**: `ls services/xstockstrat-analysis/acceptance/` shows the promoted 029 entry; `grep -n "029\|net of fees\|Activities" docs/roadmap/features/029-signal-performance-attribution/context.md` shows the note. (Docs-only; no code gate.)

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
