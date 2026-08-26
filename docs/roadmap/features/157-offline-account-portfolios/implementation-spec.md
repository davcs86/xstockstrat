# Implementation Spec: offline-account-portfolios

**Status**: `pending`
**Created**: 2026-08-26
**Feature**: `docs/roadmap/features/157-offline-account-portfolios/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/offline-account-portfolios`

---

## Execution Summary

The build follows the debated design (`design.md`, 4-round approval): offline accounts are a new
`BROKER_TYPE_OFFLINE = 3` enum value living in the **existing** `s.brokers` pool with a nil client,
and an offline-only `ConfirmOrder` RPC recomputes the account's absolute net positions from **all**
its confirmed orders and emits the self-healing `account.positions.synced` event (never
`order.filled`). Order is: **proto** (enum + `Order.filled_at` + `ConfirmOrder` + `Portfolio.realized_pnl`)
→ **proto-gen** (regenerate + enum-consumer/frontend build sweep) → **two migrations** (trading `008`
nullable credentials + `orders.filled_at`; portfolio `012` `offline_account_realized`) → the **shared
`packages/proto/pnl` fold package** (extracted first so both Go services route through one
implementation — the 056 dual-source fix) → **trading service** (register/poller-skip/record/ConfirmOrder/
deregister) → **portfolio service** (realized upsert + read-path parity + deregister purge) → **UI**
(`/trader`) → **agent** (trading client + MCP tool). Every non-frontend `service` step carries a paired
`test` step (C-08/P-06). The shared fold is sequenced early because both trading's `ConfirmOrder` and
portfolio's refactor depend on it.

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` create offline account, broker_type OFFLINE, credential UNSPECIFIED | 8 (trading test) |
| `@AC-2` register with no credentials, credentials_enc NULL | 8 |
| `@AC-3` account selector shows both; card via ListPortfolios | 12 (UI e2e) |
| `@AC-4` record order never contacts broker, empty broker_order_id, NEW filled_qty=0 | 8 |
| `@AC-5` edit confirmation from UI → FILLED; GetOrder returns fields | 8 (gRPC), 12 (UI) |
| `@AC-6` edit confirmation via MCP tool → FILLED; visible from GetOrder | 14 (agent test) |
| `@AC-7` confirmed fill emits `account.positions.synced` (user_id+mode), no `order.filled`; ListPositions↔ListPortfolios parity | 6 (fold), 8 (emit), 10 (parity) |
| `@AC-8` pollers skip offline (no broker client constructed) | 8 |
| `@AC-9` ConfirmOrder rejected FailedPrecondition for broker accounts; unchanged | 8 |
| `@AC-10` re-edit idempotency (10 not 20; avg 191.00) | 6 (fold), 8 |
| `@AC-11` sell-to-close removes position; realized +97.50 | 6, 8, 10 |
| `@AC-12` sell-to-open opens short −5; unrealized reflects | 6, 10 |
| `@AC-13` realized survives full close, shown on card | 10, 12 |
| `@AC-14` broker account P&L unaffected by offline presence | 10 |
| `@AC-15` deregister purges positions + realized; `account.deregistered` emitted; gone from ListBrokerAccounts | 8, 10 |

### Consumer surfaces (C-14)

Both named surfaces earn steps: **UI `/trader`** (steps 11–12 — no new route, so C-10(a) nav
registration is not triggered; the confirm control lands on the existing `orders/[id]` page) and
**Agent MCP** (steps 13–14 — new `TRADING_ENDPOINT` edge + one ownership-scoped tool). Named
follow-ups (not this feature, C-14): `offline-broker-card-realized` (broker-card realized, needs
`GetPnL` account-fix) and an offline crash-recovery resync path.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto`.
- Step 3 & 4 (migrations) require Step 2: the Go code that reads the new columns compiles against
  the regenerated stubs.
- Step 5 (shared `pnl` package) requires Step 2 (uses the regenerated `portfoliov1`/`tradingv1`
  types in its callers) — the package itself is float-math and dependency-free.
- Step 6 [test] covers Step 5 [service] (characterization + cross-service golden-vector parity).
- Step 7 (trading service) requires Steps 1–5: it calls `pnl.Fold`, persists `filled_at`, and uses
  the new proto messages.
- Step 8 [test] covers Step 7 [service].
- Step 9 (portfolio service) requires Steps 1, 4, 5: reads `RealizedPnl` off the sync payload,
  writes `offline_account_realized`, sets `Portfolio.realized_pnl`.
- Step 10 [test] covers Step 9 [service].
- Step 11 (UI) requires Step 2: exhaustive TS enum maps break `tsc` until updated (C-10(a/d)).
- Step 12 [e2e] covers Step 11.
- Step 13 (agent) requires Steps 1–2: imports the regenerated `tradingv1` Python stub.
- Step 14 [test] covers Step 13.
- Step 15 (docs) requires Step 13 (documents the shipped tool) — may land in the same PR as 13.

---

### Step 1 — proto: BROKER_TYPE_OFFLINE, Order.filled_at, ConfirmOrder RPC, Portfolio.realized_pnl

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/common/v1/common.proto` — modify
- `packages/proto/trading/v1/trading.proto` — modify
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking`; `xstockstrat-trading` — order execution correctness; `xstockstrat-portfolio` — P&L calculation accuracy

**Codebase Evidence**:
- `packages/proto/common/v1/common.proto:68-72` — `enum BrokerType { BROKER_TYPE_UNSPECIFIED=0; BROKER_TYPE_ALPACA=1; BROKER_TYPE_IBKR=2; }` → `3` is the next free value.
- `packages/proto/trading/v1/trading.proto:32-55` — `Order` uses fields 1–21 (`intent_state = 21`) → `filled_at = 22` free (verified context.md).
- `packages/proto/trading/v1/trading.proto:10-30` — `service TradingService` RPC list; `:123-125` — `GetOrderRequest { string order_id = 1; }` (pattern for the new request).
- `packages/proto/portfolio/v1/portfolio.proto:38-50` — `Portfolio` uses fields 1–11 (`account_id = 11`) → `realized_pnl = 12` free (verified context.md).
- Governance: root `CLAUDE.md` §Proto Contract Governance (enum needs `_UNSPECIFIED=0` — already present; additive only).

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. In `common.proto`, append to `BrokerType`: `BROKER_TYPE_OFFLINE = 3;` with a comment (a manually-tracked account with no broker credentials/client). Do **not** renumber existing values (C-04, deprecate-don't-delete).
2. In `trading.proto` `Order`, add `google.protobuf.Timestamp filled_at = 22;` after `intent_state = 21` (a comment: the confirmed/observed fill time; broker fills use the broker's timestamp, offline confirmations the operator-supplied time). `google/protobuf/timestamp.proto` is already imported (`trading.proto:7`).
3. In `trading.proto`, add the RPC to `TradingService`: `rpc ConfirmOrder(ConfirmOrderRequest) returns (Order);` with a comment stating it is **offline-only** (writes the fill fields a broker would report; rejects broker accounts with `FailedPrecondition`).
4. Add the request message:
   ```proto
   // ConfirmOrder writes the fill a broker would otherwise report onto an OFFLINE order.
   // status is server-derived from filled_qty vs qty (never client-supplied). Rejected with
   // FailedPrecondition for broker (Alpaca/IBKR) accounts (FR-8/@AC-9).
   message ConfirmOrderRequest {
     string order_id = 1;
     double filled_qty = 2;
     double filled_avg_price = 3;
     google.protobuf.Timestamp filled_at = 4; // optional; server defaults to now when unset
     string user_id = 5;                       // caller identity (ownership guard)
   }
   ```
5. In `portfolio.proto` `Portfolio`, add `optional double realized_pnl = 12;` — **`optional`** for proto3 explicit presence so an offline account's genuine `$0` realized is distinguishable from a broker account's unset (round-4 fix d; insights.md 2026-07-24 optional-scalar rule).
6. `RegisterBrokerAccountRequest.credentials_json` (`trading.proto:229`) needs **no** proto change — it is already a plain `string`; "optional for offline" is server behavior (Step 7), not a wire change.

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against ".git#branch=main-dev"
```
Both pass (all additions are additive — new enum value, new fields, new RPC/message).

---

### Step 2 — proto-gen: regenerate stubs + enum-consumer / frontend build sweep

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; do not hand-edit — regenerated output)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking` (inherited from Step 1); `xstockstrat-trading`; `xstockstrat-portfolio`

**Codebase Evidence**:
- `scripts/buf-gen.sh` — the codegen entrypoint (root `CLAUDE.md` §Generating Proto Stubs; generates TS/Python/Go and compiles the TS package).
- Exhaustive TS enum consumers of `BrokerType` to sweep: `services/xstockstrat-ui/src/lib/brokers.ts:4` (`brokerLabel`, hardcoded Alpaca/IBKR) and `services/xstockstrat-ui/src/components/trader/{accountShared.tsx:459-460, AccountsModule.tsx:33-34,119-121}` (recon.md Codebase Map) — appending an enum value can break an exhaustive `Record<BrokerType,…>`/`switch` at `tsc` (fails.md 2026-07-21 fix-custom-formula-allnone). Those are **updated in Step 11**; this step only proves the build breakage surfaces (or that no exhaustive map exists yet).

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root (regenerates Go, Python, TS stubs and compiles `gen/ts/dist/`).
2. Confirm the only diff under `packages/proto/gen/` is the additive enum value / new fields / new RPC & message (no unrelated churn) — the `proto-freshness` CI gate enforces an empty diff after regen.
3. Grep the TS tree for exhaustive `BrokerType` consumers so Step 11 has the full list:
   `grep -rn "BrokerType" services/xstockstrat-ui/src` — record every `Record<`/`switch`/equality site.

**Verification**:
```
./scripts/buf-gen.sh && git diff --stat packages/proto/gen/ | tail -5
# then: cd services/xstockstrat-ui && pnpm build   # expect tsc to FAIL on any exhaustive BrokerType map — that failure is the C-10(a/d) signal Step 11 resolves; a clean build means no exhaustive map exists
```

---

### Step 3 — migration: trading 008 — nullable credentials_enc + orders.filled_at

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/migrations/008_offline_accounts.up.sql` — create
- `services/xstockstrat-trading/migrations/008_offline_accounts.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, index correctness; `xstockstrat-trading` — order execution correctness

**Codebase Evidence**:
- `ls services/xstockstrat-trading/migrations/` → last is `007_broker_accounts_halt_source.{up,down}.sql` → next is **`008`** (C-07; verified free on origin per context.md).
- `services/xstockstrat-trading/migrations/002_broker_accounts.up.sql:8` — `credentials_enc BYTEA NOT NULL` (must relax to nullable for offline accounts).
- `services/xstockstrat-trading/migrations/001_orders_hypertable.up.sql:15-19` — `filled_qty`/`filled_avg_price` exist; **no `filled_at` column** → add it (nullable).

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. `008_offline_accounts.up.sql`:
   - `ALTER TABLE trading.broker_accounts ALTER COLUMN credentials_enc DROP NOT NULL;`
   - `ALTER TABLE trading.orders ADD COLUMN IF NOT EXISTS filled_at TIMESTAMPTZ;` (nullable — a NEW/unconfirmed offline order and every historical order has NULL).
2. `008_offline_accounts.down.sql` reverses by inspection:
   - `ALTER TABLE trading.orders DROP COLUMN IF EXISTS filled_at;`
   - `ALTER TABLE trading.broker_accounts ALTER COLUMN credentials_enc SET NOT NULL;` (safe only because down is a dev/rollback path; note that rolling back with an offline account present would fail — acceptable, matches the platform's forward-only convention F-01).
3. Never edit an applied migration (F-01) — this is a new numbered pair only.

**Verification** (offline, no DB — per spec-template § Migration step verification):
```
ls services/xstockstrat-trading/migrations/008_offline_accounts.up.sql services/xstockstrat-trading/migrations/008_offline_accounts.down.sql
# read both: confirm every ALTER/ADD in .up has an inverse in .down
```

---

### Step 4 — migration: portfolio 012 — offline_account_realized

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/012_offline_account_realized.up.sql` — create
- `services/xstockstrat-portfolio/migrations/012_offline_account_realized.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, index correctness; `xstockstrat-portfolio` — P&L calculation accuracy

**Codebase Evidence**:
- Portfolio migrations last is `011_watchlist_system_managed_source` (recon.md Codebase Map) → next is **`012`** (C-07; verified free per context.md).
- Design § Realized P&L display: account-grain table (`account_id` PK), **not** per-position `realized_accum` (which `DeletePositionsNotInSync` deletes on close — round-3 finding, portfolio_service.go:930).

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. `012_offline_account_realized.up.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS portfolio.offline_account_realized (
     account_id   TEXT PRIMARY KEY,
     user_id      TEXT NOT NULL,
     trading_mode TEXT NOT NULL,
     realized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
     updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```
   (`account_id` PK — realized is account-grain, survives the position-row wipe on close.)
2. `012_offline_account_realized.down.sql`: `DROP TABLE IF EXISTS portfolio.offline_account_realized;`

**Verification** (offline, no DB):
```
ls services/xstockstrat-portfolio/migrations/012_offline_account_realized.up.sql services/xstockstrat-portfolio/migrations/012_offline_account_realized.down.sql
# read both: CREATE TABLE ↔ DROP TABLE inverse confirmed
```

---

### Step 5 — service: shared packages/proto/pnl fold + refactor portfolio onto it

**Status**: `pending`
**Service**: `packages/proto` (consumed by `xstockstrat-trading` + `xstockstrat-portfolio`)
**Files**:
- `packages/proto/pnl/pnl.go` — create (package `pnl`, module path `github.com/xstockstrat/contracts/pnl`)
- `packages/proto/CLAUDE.md` — modify (one-line governance carve-out)
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (route `applyFill`/`realizedDelta` through `pnl`)

**Reviewers**: Proto Reviewer — package hosting in the contracts module (governance carve-out); `xstockstrat-portfolio` — P&L calculation accuracy, concurrent write safety; `xstockstrat-trading` — order execution correctness

**Codebase Evidence**:
- `services/xstockstrat-trading/go.mod:10,41` and `services/xstockstrat-portfolio/go.mod:10,41` — both `require github.com/xstockstrat/contracts v0.0.0` + `replace github.com/xstockstrat/contracts => ../../packages/proto`; `packages/proto/go.mod` = `module github.com/xstockstrat/contracts` → a sibling `packages/proto/pnl/` resolves as `github.com/xstockstrat/contracts/pnl` under `GOWORK=off` with **zero** new go.mod/replace/CI wiring (verified this session).
- Existing fold to extract: `services/xstockstrat-portfolio/internal/service/portfolio_service.go:519-530` (`realizedDelta`) and the `applyFill` closure `:551-578` inside `GetPnL` (signed average-cost + flip-through-zero + remainder). Doc comment at `:515-518` already declares this the "ONE realized-P&L reduce implementation (C-10(b))".
- `proto-freshness` CI diffs only `packages/proto/gen/` (root `CLAUDE.md` version-bump table) — a sibling `pnl/` dir is untouched by it.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `packages/proto/pnl/pnl.go`, package `pnl`, **dependency-free (float math only — no proto/DB imports)**. Expose:
   - `func RealizedDelta(accQty, accCost, fillQty, fillPrice float64) float64` — moved verbatim from `portfolio_service.go:519-530`.
   - `type Fill struct { Qty, Price float64; Symbol string }` and `type FoldResult struct { Positions map[string]Lot; Realized float64 }` (`Lot{ Qty, CostBasis float64 }`).
   - `func Fold(fills []Fill) FoldResult` — the signed average-cost fold generalized from the `applyFill` closure (`:551-578`): per-symbol accumulate same-direction, else realize via `RealizedDelta`, flip through zero with the remainder branch, drop lots at `|qty| < 1e-9`. Fills are applied **in the order given** (caller sorts economically — Step 7 sorts `filled_at ASC, created_at ASC`). Net-negative (short) lots are retained (no oversell guard — shorts are in scope, @AC-12).
2. Refactor portfolio: replace the local `realizedDelta` (`:519`) and the `applyFill` closure body (`:551-578`) so both call `pnl.RealizedDelta` / `pnl.Fold` — **no second fold implementation left in the tree** (the 056 dual-source trap; fails.md 2026-07-01). Keep `GetPnL`'s external behavior identical (this is a pure extraction).
3. Append one line to `packages/proto/CLAUDE.md`: note the module hosts a small hand-written, non-generated `pnl` helper package (float-math P&L fold shared by trading + portfolio), and that its tests live in the consuming service test modules because no CI job runs `go test` inside `packages/proto/`. (context-scrubber teardown target.)
4. Header propagation: N/A — `pnl` makes no gRPC calls; the portfolio refactor adds no new outbound call.

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading   && GOWORK=off go build ./...   # confirms pnl resolves from the second consumer too
```
(Coverage/tests are the paired Step 6.)

---

### Step 6 — test: pnl characterization + cross-service golden-vector parity

**Status**: `pending`
**Service**: `xstockstrat-portfolio` (+ a golden vector duplicated in `xstockstrat-trading`)
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go` (or the existing `*_test.go` home) — modify: characterization + golden vectors
- `services/xstockstrat-trading/internal/service/*_test.go` — modify: the same golden vectors run through `pnl.Fold` from trading's module

**Reviewers**: `xstockstrat-portfolio` — P&L calculation accuracy; `xstockstrat-trading` — order execution correctness

**Codebase Evidence**:
- The refactor target `GetPnL`/`applyFill` (`portfolio_service.go:532-578`) — a **characterization test pins portfolio's current realized outputs green before the swap** (design § shared fold), so the extraction is proven behavior-preserving.
- Go coverage note: `internal/service` is in the CI-**excluded** coverpkg set (spec-template threshold table) — the golden-vector test still runs and asserts behavior (red-green); it is the C-08 pairing for Step 5.

**TDD**: `red-green required`

**Covers**: `AC-7, AC-10, AC-11, AC-12`

**Instructions**:
1. **Characterization** (portfolio): before Step 5's swap, capture `GetPnL`'s realized for a fixed fill sequence (BUY 10@190.25, SELL 10@200.00 → realized 97.50; a BUY/SELL/BUY re-average case; a sell-to-open short case) and assert it stays identical after routing through `pnl`. RED is proven by temporarily pointing the assertion at a deliberately wrong expected value per P-06 (`/sdd-execute` captures the failing run).
2. **Golden vectors** (shared): define a table of `[]pnl.Fill` → expected `(positions, realized)` covering: idempotent re-edit (BUY10@190.25 then the *replaced* BUY10@191.00 fold yields qty 10, avg 191.00 — @AC-10), sell-to-close (net 0, realized +97.50 — @AC-11), sell-to-open short (−5@250 → lot qty −5, avg 250 — @AC-12), partial reduce. Run the **identical** vector table from **both** the portfolio test module and a trading test module (the cross-service parity proof — no CI job runs tests inside `packages/proto/`, design round-4a).
3. C-13: the fill/lot literals have a single consumer per module → inline is compliant (state this); do not create a `testdata` home speculatively.

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading   && GOWORK=off go test ./internal/service/... -race -count=1 -run 'Fold|Pnl|Realized'
```

---

### Step 7 — service: trading offline account + poller skips + record + ConfirmOrder + deregister

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify (register, poller/resolve skips, PlaceOrder record branch, ConfirmOrder, deregister emit, per-account confirm lock)
- `services/xstockstrat-trading/internal/handler/trading.go` — modify (ConfirmOrder handler + adapter method)
- `services/xstockstrat-trading/internal/repository/trading_repo.go` — modify (`filled_at` in `UpsertOrder`/`GetOrder`/`ListOrders`/`scanOrder`; new confirmed-offline-orders query)
- `services/xstockstrat-trading/internal/repository/account_repo.go` — modify (offline insert with NULL credentials; OFFLINE mapping)

**Reviewers**: `xstockstrat-trading` — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Broker pool + all `s.brokers` sites to guard (design "enumerates every s.brokers site"): `LoadBrokerPool` (`trading.go:205`, builds pool from DB `:225`), `resolveAccount` sole-account fallback (`:269`, `:281-286`), `pollFills` (`:1136`, ranges `:1138-1143`), `reconcileTick` (`:1393`, ranges `:1394-1399`), `syncPositions` (`:1731`, ranges `:1736-1741`), `checkCredentialHealth` (`:2062`, ranges `:2063-2068`), `flattenAndHalt` (`:2175`, `s.brokers[bracket.AccountID]` `:2176-2177`), `LoadInflightOrders` (`:247`, uses `ListSubmittedOrders` — broker-id-gated), bracket watchdog `checkBracketProtection` (`:2281`). Existing `brokerType` discriminant already read: `commonv1.BrokerType(accountEntry.brokerType) == ..._ALPACA` (`trading.go:610`), so `brokerPoolEntry.brokerType` is the guard field.
- `RegisterBrokerAccount` (`:1885`) — instantiates broker `:1913-1915`/`:1959-1961`; `instantiateBrokerLocked` (`:2413`); `validateAndRecordCredential` (`:1992`). `UpdateBrokerAccountCredentials` (`:1926`). `DeregisterBrokerAccountSvc` (`:2391`, deletes from pool `:2402-2404`).
- `PlaceOrder` (`:323`) — the record path; keeps the feature-101 `client_order_id` dedup. `resolveAccount` (`:269`) is where the offline early-branch precedes broker routing.
- `emitLedgerEvent` (`:3044`) and the `account.positions.synced` emit shape (`:1813-1818`: keys `account_id`, `user_id`, `trading_mode`, `positions[]` with `symbol`/`qty`/`avg_cost`/`current_price`/…). `environmentIsPaper` (`:1983`) derives the mode (offline has no `client.IsPaper()`).
- Repo: `TradingRepo.UpsertOrder` (`trading_repo.go:48`, upserts incl. `broker_type` `:79`), `GetOrder` (`:104`, SELECT already lists `user_id`, `broker_type` `:106-109` — the order-sourced ConfirmOrder guard; SELECT does **not** yet list `filled_at`), `ListOrders` (`:121`, accepts `accountID`), `ListSubmittedOrders` (`:218`), `scanOrder` (used by all three). `account_repo.go` `CreateBrokerAccount` (`:70`, column list `:79` includes `credentials_enc`), `pgAccountRepo` `ListBrokerAccounts` (`:88`); `recordToProtoAccount` (`trading.go:2324`) maps a record → proto.
- Config: no new keys (F-07 honored) — offline is simply excluded from the existing pollers.

**TDD**: `red-green required`

**Covers**: — (behavior verified in Step 8)

**Instructions**:
1. **Poller/lookup skips.** At each `s.brokers` site above, `continue`/skip when `entry.brokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE)` so a nil client is never dereferenced. Enumerate **every** site (design forbids "any other path" hand-waving): `pollFills`, `reconcileTick`, `syncPositions`, `checkCredentialHealth`, bracket watchdog, and `resolveAccount`'s sole-account fallback (`:281-286` must not return an offline entry as the implicit account for a broker-routed order). Document the naturally-guarded ones (`LoadInflightOrders`/`ListSubmittedOrders` need a `broker_order_id`; brackets never exist for offline) but add the explicit type guard anyway.
2. **Register offline.** In `RegisterBrokerAccount`, branch on `req.BrokerType == BROKER_TYPE_OFFLINE`: skip `json.Valid`/`EncryptCredentials`/`instantiateBrokerLocked`/`validateAndRecordCredential`; persist the account with `credentials_enc = NULL` (Step 3 made the column nullable) via `CreateBrokerAccount`; store the pool entry `{client: nil, brokerType: OFFLINE, userID}`. `recordToProtoAccount`/`ListBrokerAccounts` map OFFLINE with `CredentialStatus_CREDENTIAL_STATUS_UNSPECIFIED` (@AC-1). `UpdateBrokerAccountCredentials` rejects OFFLINE (`FailedPrecondition` — no credentials to update).
3. **Record path.** In `PlaceOrder`, add an early offline branch (before `resolveAccount`'s broker routing): keep the `client_order_id` dedup; **deliberately skip** broker submit, `ComputePositionSize`, brackets, and the halt/trading-state gates (manual bookkeeping, no broker touched — document each skip). Persist a `NEW` order (`filled_qty = 0`, empty `broker_order_id`, `account_id` = offline account) via `UpsertOrder` (@AC-4).
4. **ConfirmOrder RPC (correctness core).** New service method + handler (`internal/handler/trading.go` `TradingHandler.ConfirmOrder` connect wrapper + `grpcTradingAdapter.ConfirmOrder`, mirroring the existing `ReplaceOrder` at `handler/trading.go:56,135`). In the service method:
   - Load the order via `GetOrder` (selects `broker_type`, `user_id`). Reject `codes.FailedPrecondition` if `broker_type != OFFLINE` (message: confirmation applies only to offline accounts) or `user_id != req.UserId` (@AC-9). This is the order-sourced guard — no broker call.
   - Derive `status` from `filled_qty` vs `qty` server-side (0 → NEW; `0 < filled < qty` → PARTIALLY_FILLED; `>= qty` → FILLED) — never client-supplied. Persist `filled_qty`/`filled_avg_price`/`filled_at` (default now when unset) via `UpsertOrder`.
   - Wrap persist→recompute→emit in a **per-account lock** (new `map[string]*sync.Mutex` guarded by a mutex, or a keyed lock) — request-driven confirm lacks the poller's one-goroutine-per-account serialization and would otherwise lost-update on concurrent edits.
   - **Recompute** the account's absolute net positions: query all this account's confirmed offline orders (new repo method `ListConfirmedOfflineOrdersByAccount` — filter `account_id = $1 AND status IN (PARTIALLY_FILLED, FILLED) AND filled_qty > 0`, `ORDER BY filled_at ASC, created_at ASC`; model on `ListOrders` at `trading_repo.go:121`). Build `[]pnl.Fill` (signed: BUY `+filled_qty`, SELL `-filled_qty`, at `filled_avg_price`) and call `pnl.Fold`.
   - **Emit `account.positions.synced` only** (never `order.filled` — the invariant that keeps portfolio's `ConsumeOrderFills`/GetPnL from double-folding; design round-3 disjointness proof). Payload mirrors `:1813-1818`: `account_id`, `user_id` (the add-ikbr trap — must be present), `trading_mode` (environment-derived via `environmentIsPaper`, asserted equal to the record/query mode), `positions[]` (`symbol`/`qty`/`avg_cost` from the fold; offline positions carry no broker mark-to-market so `current_price` etc. stay 0 → portfolio enriches from mid-quotes). Add a **nil-able `realized_pnl` JSON pointer** carrying `pnl.Fold`'s cumulative account realized (Step 9 consumes it; broker syncs never set it). Run the emit on the inbound request ctx (C-03 propagation).
   - **Safety:** a failed recompute query emits nothing (an empty snapshot would make `DeletePositionsNotInSync` wipe the account); only a *successful* empty fold emits `positions: []`.
5. **Deregister.** In `DeregisterBrokerAccountSvc`, for an OFFLINE account emit a dedicated **`account.deregistered`** ledger event (payload `{account_id, user_id}`) so portfolio can purge positions + realized (Step 9); keep the existing pool `delete` (`:2402-2404`) (@AC-15). (Broker accounts keep their existing deregister behavior — the new event is emitted for offline; emitting it for broker too is harmless but out of scope.)
6. **Repo `filled_at`.** Add `filled_at` to `UpsertOrder`'s column list (`trading_repo.go:48-79`), the `GetOrder`/`ListOrders`/`ListSubmittedOrders` SELECTs (`:106-109`, `:134-137`), and `scanOrder` (nullable → proto `Timestamp`).
7. Trading-domain constraints (step-constraints §A): offline record/confirm **touch no broker**, so `TRADING_MODE` gating is N/A for the broker-submit path (documented skip in inst. 3); `OrderType`/fill-state (`PARTIALLY_FILLED` + `FILLED`) are both handled by the server-derived status in inst. 4 (test both in Step 8). Header propagation: the ConfirmOrder emit reuses `emitLedgerEvent`, which runs on the request ctx (Go interceptor propagates `x-user-id`/`x-trace-id`, `docs/patterns/header-propagation.md`) — no new outbound per-request cross-service call is added.

**Verification**: covered by Step 8 (`go build` + tests + lint). Structural: `grep -n "BROKER_TYPE_OFFLINE" services/xstockstrat-trading/internal/service/trading.go` shows a guard at every enumerated `s.brokers` site.

---

### Step 8 — test: trading offline register / record / ConfirmOrder / poller-skip / deregister

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/*_test.go` — modify/create
- `services/xstockstrat-trading/internal/testdata/` — create only if a domain literal gains a second consumer (C-13)

**Reviewers**: `xstockstrat-trading` — order execution correctness, fill detection, paper-only dev invariant

**Codebase Evidence**:
- `internal/service` is in the CI-excluded coverpkg set (spec-template threshold table) → "New logic is in an excluded package — no coverage threshold applies; behavioral tests are sufficient. A test step is still required." The `pnl`-fold behavior it exercises is measured via Step 6.
- Existing repo-level test precedents: `trading_repo_test.go:20,56,98` (intent LATERAL join tests) show the DB-backed test pattern; the service uses a concrete `*repository.TradingRepo` (not an interface), so pure/service-level assertions avoid a live DB where possible (mirror portfolio's `parseBracketUpdatePayload` unit-test precedent).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-4, AC-5, AC-7, AC-8, AC-9, AC-10, AC-11, AC-15`

**Instructions**:
1. **Register/list** (@AC-1/@AC-2): registering OFFLINE succeeds with empty `credentials_json`, stores `credentials_enc = NULL`, and `ListBrokerAccounts` returns it with `broker_type = OFFLINE`, `credential_status = UNSPECIFIED`, `is_active = true`.
2. **Record** (@AC-4): `PlaceOrder` against an offline account persists a `NEW` order, `filled_qty = 0`, empty `broker_order_id`, and makes **no** broker `SubmitOrder` call (assert against a fake/nil broker — a broker call would panic/be recorded).
3. **ConfirmOrder happy path** (@AC-5): confirm `filled_qty = qty` → status FILLED; `GetOrder` returns `filled_qty`/`filled_avg_price`/`filled_at`. Add a **partial-fill** case (`0 < filled_qty < qty` → PARTIALLY_FILLED) per step-constraints §A fill-state completeness.
4. **Emit invariant** (@AC-7): a confirm emits `account.positions.synced` carrying `user_id` and the environment `trading_mode`, and emits **no** `order.filled` (assert the emitted event-type set; the disjointness guard).
5. **Idempotent re-edit** (@AC-10): confirming, then re-confirming the same order with a different `filled_avg_price`, yields a single fold whose position stays 10 shares (recompute-from-all-orders, not incremental).
6. **Sell-to-close** (@AC-11): record+confirm a SELL closing the position → the recompute nets to 0 and the emitted `realized_pnl` pointer carries +97.50.
7. **Poller skip** (@AC-8): with an offline + an Alpaca account both active, one `pollFills`/`syncPositions`/`checkCredentialHealth` cycle constructs a broker client only for the Alpaca account; the offline account is skipped (assert no nil-deref / no broker call for it).
8. **ConfirmOrder rejects broker** (@AC-9): calling ConfirmOrder for an Alpaca order returns `FailedPrecondition` and leaves its status/fill fields unchanged.
9. **Deregister** (@AC-15): deregistering an offline account emits `account.deregistered` for that `account_id` and it no longer appears in `ListBrokerAccounts`.
10. C-13: state whether any order/account literal gains a second consumer; keep single-consumer literals inline.

**Verification**:
```
cd services/xstockstrat-trading && GOWORK=off go test ./... -race -count=1
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
# service pkg is coverage-excluded; run the standard coverage command to confirm the suite still meets ≥40% on measured pkgs:
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```

---

### Step 9 — service: portfolio realized upsert + read-path parity + deregister purge

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (`positionSyncPayload += RealizedPnl *float64`; realized upsert in `processPositionSync`; `account.deregistered` consumer; realized read in `buildAccountPortfolio` + `GetPortfolio`)
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify (`UpsertOfflineRealized`/`GetOfflineRealized`/`DeleteOfflineRealized`)
- `services/xstockstrat-portfolio/internal/service/*` — wire the new consumer into the boot goroutines (mirror `ConsumePositionSyncs` registration)

**Reviewers**: `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `positionSyncPayload` struct (`portfolio_service.go:862-883`) — add `RealizedPnl *float64 json:"realized_pnl"` (nil for broker syncs; set for offline — disjoint by construction).
- `processPositionSync` (`:891-933`): upserts each position in the loop `:916-929`, then `DeletePositionsNotInSync` `:930`. The realized upsert lands **outside** the positions loop, **after** `DeletePositionsNotInSync`, **gated `sync.RealizedPnl != nil`** (round-4 fix 1 — so a flat/full-close recompute still records realized, and broker syncs never touch the table).
- `ConsumePositionSyncs` (`:887-888`) via `consumeEventStream` — the registration pattern for the new `account.deregistered` consumer (`ConsumeAccountDeregistrations` → `processAccountDeregistered`).
- **Dual read paths (C-10(b) parity target):** `buildAccountPortfolio` (`:1036-1071`, serves `ListPortfolios`) and `GetPortfolio` (`:459-478`, a **separate** build path) — realized must be read account-grain and set on `Portfolio.realized_pnl` in **both** (round-4 fix f). `enrichPositions` (`:331`, mid-quote fallback) already runs on both paths, so offline valuation (incl. short unrealized via signed qty) lands on `ListPositions`, `GetPortfolio`, and `ListPortfolios` with no offline-only branch.
- `Portfolio.realized_pnl` is `optional double = 12` (Step 1) — set it only for offline accounts (presence distinguishes offline-$0 from broker-unset); the UI Stat (Step 11) is additionally gated on account type == OFFLINE.

**TDD**: `red-green required`

**Covers**: — (behavior verified in Step 10)

**Instructions**:
1. Extend `positionSyncPayload` with `RealizedPnl *float64` (`:862-883`).
2. In `processPositionSync`, after `DeletePositionsNotInSync` (`:930`), if `sync.RealizedPnl != nil` call `repo.UpsertOfflineRealized(ctx, sync.AccountID, userID, sync.TradingMode, *sync.RealizedPnl)`. Do **not** touch the table when the pointer is nil (broker sync path unchanged — @AC-14 disjointness).
3. Add repo methods on `PortfolioRepo`: `UpsertOfflineRealized` (`INSERT … ON CONFLICT (account_id) DO UPDATE SET realized_pnl=EXCLUDED.realized_pnl, user_id=…, trading_mode=…, updated_at=NOW()`), `GetOfflineRealized(accountID) (float64, bool, error)`, `DeleteOfflineRealized(accountID)`.
4. Add `ConsumeAccountDeregistrations` (subscribe `account.deregistered` via `consumeEventStream`) → `processAccountDeregistered`: parse `{account_id, user_id}`, then purge — delete the account's positions (reuse `DeletePositionsNotInSync(ctx, accountID, userID, []string{})` with an empty present-set, which deletes all rows for the account) and `DeleteOfflineRealized(accountID)` (@AC-15). Register it in the same boot block that starts `ConsumePositionSyncs`.
5. In **both** `buildAccountPortfolio` (`:1054-1071`) and `GetPortfolio` (`:471-477`), read `GetOfflineRealized(accountID)` and, when present, set `portfolio.RealizedPnl = proto.Float64(v)` (proto3 `optional` setter). Leave it unset for broker accounts (no row) — the parity assertion in Step 10 pins both paths equal.
6. Header propagation: no new outbound per-request cross-service call is added (the new consumer reads the ledger stream the service already consumes; repo calls are local DB). N/A.

**Verification**: covered by Step 10.

---

### Step 10 — test: portfolio realized upsert, read-path parity, deregister purge, disjointness

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency

**Codebase Evidence**:
- Parity target functions `buildAccountPortfolio` (`:1036`) vs `GetPortfolio` (`:459`) — the C-10(b) parity assertion (a value with an authoritative source surfaced by every read path). `processPositionSync` (`:891`) realized-gate is the unit under test.
- `internal/service` coverage-excluded (as Step 8) — behavioral tests suffice; a `test` step is still required (C-08).

**TDD**: `red-green required`

**Covers**: `AC-7, AC-11, AC-12, AC-13, AC-14`

**Instructions**:
1. **Realized upsert gate**: a `positionSyncPayload` with `RealizedPnl` set writes `offline_account_realized`; the same payload with a **nil** pointer (a broker sync) leaves the table untouched (@AC-14 disjointness).
2. **Realized after full close** (@AC-13): a recompute payload with `positions: []` + `RealizedPnl = 97.50` still records 97.50 (upsert is outside the positions loop / after delete).
3. **Read-path parity** (@AC-7/C-10(b)): for one offline account, assert `buildAccountPortfolio` (via `ListPortfolios`) and `GetPortfolio` return the **same** `RealizedPnl` presence+value, and the same position `market_value`/`unrealized_pnl` (both routed through `enrichPositions`).
4. **Short valuation** (@AC-12): a −5 position enriched from a mid-quote yields `unrealized_pnl = (entry − price) * |qty|` with the correct short sign via the signed-qty formula.
5. **Deregister purge** (@AC-15): an `account.deregistered` event removes the account's positions and its `offline_account_realized` row.
6. C-13: single-consumer literals inline (state the verdict); shared position/payload literals move to a fixture only on a second consumer.

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off go test ./... -race -count=1
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
```

---

### Step 11 — service: UI /trader — offline account creation, confirm control, realized Stat, enum sweep

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/brokers.ts` — modify (`brokerLabel` OFFLINE)
- `services/xstockstrat-ui/src/components/trader/accountShared.tsx` — modify (`AddAccountForm` OFFLINE option, hide credential fields)
- `services/xstockstrat-ui/src/components/trader/AccountsModule.tsx` — modify (broker filter includes OFFLINE)
- `services/xstockstrat-ui/src/hooks/useConfirmOrder.ts` — create (copy `useReplaceOrder.ts`)
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify (`ConfirmOrder` handler + dispatch)
- `services/xstockstrat-ui/src/lib/browserClients/tradingClient.ts` — modify (expose `confirmOrder`)
- `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx` — modify (confirm control on offline orders)
- `services/xstockstrat-ui/src/components/trader/PortfolioPanel.tsx` — modify (Realized P&L Stat, gated account type == OFFLINE)

**Reviewers**: `xstockstrat-ui` — Trading UI correctness, Connect-RPC call safety, no secret values rendered

**Codebase Evidence** (recon.md Codebase Map, pre-confirmed `path:line`):
- `brokerLabel` `src/lib/brokers.ts:4` (hardcoded Alpaca/IBKR — exhaustive over `BrokerType`).
- `AddAccountForm` `accountShared.tsx:353`; broker `<Select>` `:459-460` (`value="1"`/`"2"`); `registerBrokerAccount` `:415`; `buildCredentialsJson` `:45`; `credentialSchema` `:61`. `AccountsModule.tsx:20` broker filter `:33-34,:119-121`.
- Mutation template `useReplaceOrder.ts:9` → `useInvalidatingMutation.ts:17`; BFF `replaceOrder` handler with session-user injection `traderBff.ts:45`, dispatch `:173`; browser client `browserClients/tradingClient.ts:5-6`.
- Order detail `orders/[id]/page.tsx:41` (`isWorking` gate `:34`, filled fields `:162-169`, `EditOrderDialog` `:206`).
- Portfolio card `PortfolioPanel.tsx:11` (matches `portfolio.accountId` `:102`); account selector `AccountSelector.tsx:18`; `AccountContext.tsx:27` `fetchAccounts` `:32`. Nav already registered: `PLATFORM_SUBNAV.trader` `PlatformHeader.tsx:73-77` (no new route → C-10(a) not triggered).

**TDD**: `red-green required` (paired with the Step 12 Playwright suite — UI has no coverage threshold; e2e is the gate)

**Covers**: — (verified in Step 12)

**Instructions**:
1. `brokerLabel` learns `BROKER_TYPE_OFFLINE` → "Offline" (resolves the Step-2 `tsc` break if `brokerLabel` is exhaustive). Sweep every exhaustive `Record<BrokerType,…>`/`switch` found in Step 2 and add the OFFLINE arm (C-10(a/d); fails.md 2026-07-21).
2. `AddAccountForm`: add an "Offline" option (`value="3"`) to the broker `<Select>` (`:459-460`); when OFFLINE is selected, **hide the credential fields** and skip `buildCredentialsJson`/`credentialSchema` validation so `registerBrokerAccount` is called with empty `credentials_json`. `AccountsModule` broker filter includes OFFLINE.
3. `useConfirmOrder.ts`: copy `useReplaceOrder.ts:9` (via `useInvalidatingMutation`) → calls the BFF `ConfirmOrder`, invalidates the order + portfolio queries on success.
4. `traderBff.ts`: add a `ConfirmOrder` handler copying `replaceOrder`'s **session-user injection** (`:45`) — inject `x-user-id` from the session, never trust a request field — and wire it into the dispatch (`:173`). Expose `confirmOrder` on `browserClients/tradingClient.ts`.
5. `orders/[id]/page.tsx`: add a confirm control (set `filled_qty`/`filled_avg_price`/`filled_at`) beside the existing "Edit order" action, shown **only** for offline-account orders (gate on the order's `broker_type == OFFLINE`). No new route.
6. `PortfolioPanel.tsx`: render a "Realized P&L" `Stat` from `portfolio.realizedPnl`, **gated on the account being OFFLINE** (primary guard against a fake $0 on broker cards — the proto `optional` presence is the secondary signal). @AC-13.
7. C-12/test-data: any new UI test domain object (an offline account) extends `e2e/fixtures/accounts.ts` + an `INVENTORY.md` row using proto field `id` (the `accountId`-vs-`id` mock trap, fails.md 2026-08-05) — handled in Step 12; no inline literals.

**Verification**:
```
cd services/xstockstrat-ui && pnpm build   # tsc clean — every exhaustive BrokerType map updated
cd services/xstockstrat-ui && pnpm run lint
```
(behavioral e2e in Step 12)

---

### Step 12 — test: UI Playwright — offline account, selector, confirm edit, realized card

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/offline-accounts.spec.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/accounts.ts` — modify (offline account fixture)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog row)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (offline register / ConfirmOrder / ListPortfolios-with-realized handlers)

**Reviewers**: `xstockstrat-ui` — Trading UI correctness

**Codebase Evidence** (recon.md):
- Fixtures `e2e/fixtures/accounts.ts:15`; mock trading handlers `e2e/mock-backend.ts:232-246`; `INVENTORY.md:15`. Auth helpers `e2e/helpers/auth.ts` (`addAuthCookie` — never re-implement JWT signing, discovery-checklist item j).
- Mock trap: fixtures use proto field `id`, diffed against the proto not a sibling mock (fails.md 2026-08-05 align-frontend-e2e-bff-mocks); an echo-back mock field tests nothing (insights.md 2026-07-27) — make ConfirmOrder's returned status genuinely derived, not echoed.

**TDD**: `red-green required`

**Covers**: `AC-3, AC-5, AC-13`

**Instructions**:
1. Add an offline `BrokerAccount` fixture to `accounts.ts` (proto `id`, `brokerType: 3`, `isActive: true`) + an `INVENTORY.md` row.
2. Mock-backend handlers: offline `RegisterBrokerAccount` (accepts empty `credentials_json`), `ConfirmOrder` (returns the order with **server-derived** status FILLED when `filledQty == qty`, not an echo), `ListPortfolios` returning `realizedPnl` for the offline account.
3. Spec `offline-accounts.spec.ts`:
   - @AC-3: the `/trader` account selector lists both an Alpaca and an offline account; selecting the offline account shows its portfolio card via `ListPortfolios`.
   - @AC-5: confirming an offline order's fill in the UI (`filled_qty`/`filled_avg_price`/`filled_at`) flips it to FILLED and the detail page shows the fill fields.
   - @AC-13: the offline account's portfolio card shows Realized P&L even with no open positions.
4. C-12: import all domain data from `e2e/fixtures/` and auth from `e2e/helpers/auth.ts`; scenario one-off overrides via `{ ...fixture, override }` spreads stay inline.

**Verification**:
```
cd services/xstockstrat-ui && pnpm test:e2e -- offline-accounts
grep -n "from '../fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/trader/offline-accounts.spec.ts   # confirm fixture + auth imports
```

---

### Step 13 — service: agent — TRADING_ENDPOINT, trading gRPC client, offline MCP tool

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify (`TRADING_ENDPOINT` + trading gRPC wrappers)
- `services/xstockstrat-agent/app/tools.py` — modify (new tool + docstring tool count)
- `services/xstockstrat-agent/CLAUDE.md` — modify (`TRADING_ENDPOINT` env + tool table + count)
- `docker-compose.yml` — modify (agent `TRADING_ENDPOINT`)
- `.do/app.yaml` — modify (agent `TRADING_ENDPOINT`)
- `.do/app.dev.yaml` — modify (agent `TRADING_ENDPOINT`)

**Reviewers**: `xstockstrat-agent` — MCP tool contract stability, `docs/runbooks/mcp-tools.md` parity, tool-count sync across all six inventory surfaces, admin scope forwarding, no secrets in tool output

**Codebase Evidence** (recon.md Codebase Map, pre-confirmed):
- Agent has **no trading client today**. Endpoint consts `app/client.py:19-25` (`TRADING_ENDPOINT` absent — verified: `grep TRADING_ENDPOINT app/client.py` empty); per-call channel pattern `grpc.aio.insecure_channel(PORTFOLIO_ENDPOINT)` `:293,311`; `_metadata` `:58`; watchlist wrappers `:386,409,453`.
- Tool registration `register_tools` `app/tools.py:208`; ownership-scoped model `manage_watchlist` `:1287`; header helpers `_caller_user_id` `:114`, `_caller_access_scope` `:102`.
- **Six tool-count surfaces (28 → 29)**: docstring `app/tools.py:4`; `@server.tool()` decorators (runtime registry); agent `CLAUDE.md:36` + table `:39-68`; `docs/runbooks/mcp-tools.md:3,37` + per-tool block `:78-132` (Step 15); name-set test `tests/test_tools_endpoint.py:23-52`; `GET /api/tools` `app/main.py:251` (auto). Env surfaces missing `TRADING_ENDPOINT`: agent `CLAUDE.md:159-174`; `docker-compose.yml:520-537`; `.do/app.yaml:252`; `.do/app.dev.yaml:254`.
- Env-var convention: `TRADING_ENDPOINT=xstockstrat-trading:50051` (root `CLAUDE.md` §Environment Variable Naming — `<SERVICE>_ENDPOINT`, gRPC host:port; the UI already sets it).

**TDD**: `red-green required`

**Covers**: — (verified in Step 14)

**Instructions**:
1. `client.py`: add `TRADING_ENDPOINT = os.environ.get("TRADING_ENDPOINT", "xstockstrat-trading:50051")` (after `:25`). Add async wrappers copying the portfolio per-call-channel pattern (`:293-311`) and forwarding `_metadata` (C-03 `x-user-id`): `register_broker_account`, `place_order`, `confirm_order`, `get_order`, `list_orders`, `list_positions`/`list_portfolios` (read for reconciliation) — using the regenerated `tradingv1` Python stub.
2. `tools.py`: add one ownership-scoped tool (copy `manage_watchlist` `:1287`, forwarding `x-user-id` via `_metadata`, never trusting a request field) covering **create offline account / record order / confirm order**, plus a **read** of the offline account's orders/positions (supports the monthly statement-reconciliation task — a Claude task correcting drift via order edits; no set-positions path). Server-derived status only.
3. Update **all six** tool-count surfaces 28 → 29: docstring (`:4`), the new `@server.tool()` decorator, `CLAUDE.md:36` + table row, the name-set test (Step 14), `GET /api/tools` (auto). The `mcp-tools.md` per-tool block is Step 15.
4. Add `TRADING_ENDPOINT` to the agent block of `docker-compose.yml` (`:520-537`), `.do/app.yaml` (`:252`, `value: ${xstockstrat-trading.PRIVATE_URL}`-style per the file's existing `_ENDPOINT` entries), `.do/app.dev.yaml` (`:254`), and the agent `CLAUDE.md` env list (`:159-174`) — confirmed absent from all four.
5. Header propagation (step-constraints §B): this adds a **new outbound gRPC edge (agent → trading)**; the wrapper forwards `x-user-id`/`x-access-scope`/`x-trace-id` via `_metadata` (Python per-method metadata, `docs/patterns/header-propagation.md`), copying the watchlist wrappers' `_metadata` usage.

**Verification**: covered by Step 14 (pytest + ruff). Env parity:
```
grep -n "TRADING_ENDPOINT" docker-compose.yml .do/app.yaml .do/app.dev.yaml services/xstockstrat-agent/app/client.py services/xstockstrat-agent/CLAUDE.md
```

---

### Step 14 — test: agent — offline tool + confirm + tool-count name-set

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_*.py` — modify/create (new tool behavior)
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify (name-set 28 → 29)

**Reviewers**: `xstockstrat-agent` — MCP tool contract stability, tool-count sync

**Codebase Evidence**:
- Name-set test `tests/test_tools_endpoint.py:23-52` (the built-in reachability proof — insights.md 2026-07-20; the descriptor-parity guard family — insights.md 2026-08-02 `test_backtest_view.py`). Coverage threshold 40% (`cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40` — spec-template table; agent uses the Python 40% gate).

**TDD**: `red-green required`

**Covers**: `AC-6`

**Instructions**:
1. @AC-6: calling the confirm path with `filled_qty = qty` and `filled_avg_price` returns the updated order with status FILLED, and the change is visible via the `get_order` wrapper over gRPC (mock the trading stub — assert the request the wrapper builds carries `x-user-id` and the fill fields, and the returned status is server-derived, not echoed — insights.md 2026-08-02).
2. Update the name-set test to expect **29** tools including the new tool name.
3. Consider a descriptor-parity assertion over the new dict→proto request builder (`ConfirmOrderRequest` field set == descriptor minus an explicit unset set) to prevent silent field drift (insights.md 2026-08-02 — the durable antidote to MCP-surface drift).
4. C-13: Python fixtures from `tests/conftest.py` if a domain literal gains a second consumer; single-consumer literals inline.

**Verification**:
```
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 15 — docs: mcp-tools.md per-tool block + named follow-ups

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify (header count 28 → 29 + a per-tool block for the new tool)
- `docs/roadmap/features/157-offline-account-portfolios/context.md` — modify (record the two named C-14 follow-ups)

**Reviewers**: none

**Codebase Evidence**:
- `mcp-tools.md:3,37` (header count) + per-tool block format `:78-132` (recon.md). The operational-runbook surface is the fifth/sixth tool-count surface (insights.md 2026-07-20 — the runbook makes a capability findable).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Bump the `mcp-tools.md` header tool count to 29 and add a per-tool block (parameters, return shape, error cases — mirror the existing `:78-132` format) for the offline-account tool. State the server-derived status and the offline-only ConfirmOrder guard.
2. Record in `context.md` the two named follow-up features (C-14): `offline-broker-card-realized` (broker-card realized, needs the `GetPnL` account-blindness fix) and an offline crash-recovery resync path (offline self-heal is confirm-triggered only). These are **named** follow-ups, never a vague "later" (fails.md 2026-08-05 add-ikbr).
3. Context-scrubber teardown: this feature changed context files and behavior docs — run `/context-scrubber scan` scoped to the touched docs before the integration PR (root `CLAUDE.md` Teardown), or note in the PR body if the plugin is unavailable.

**Verification**:
```
grep -n "29" docs/runbooks/mcp-tools.md   # header count updated
grep -c "offline" docs/runbooks/mcp-tools.md   # per-tool block present
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
