# Implementation Spec: stop-loss-bracket-orders

**Status**: `pending`
**Created**: 2026-08-06
**Feature**: `docs/roadmap/features/030-stop-loss-bracket-orders/feature.md`
**Total Steps**: 23
**Feature Branch**: `feature/stop-loss-bracket-orders`

---

## Execution Summary

Per `design.md`'s Chosen Approach: `xstockstrat-trading` gains a persisted, per-order bracket state
machine (`NONE→SUBMITTING→PENDING_VERIFY→ACTIVE→CANCELING→CANCELED/SUBMITTING(resize)`, with
`FAILED→flatten→halt`) living entirely in a new `trading.order_brackets` table plus a per-account
persisted halt gate on `trading.broker_accounts` (migration 1) — never a bare in-process map, per the
`credential_status` precedent. The broker layer gets bracket-submission support (2): Alpaca attaches
bracket parameters atomically at entry `SubmitOrder` (4-5); IBKR submits the stop/take-profit legs as a
follow-up 2-order array call using `isSingleGroup`+`parentId`/`cOID` (6-7) — **this corrects
`design.md`'s assumed client-set `OCAGroup` string mechanism**, which IBKR's real Client Portal Web API
does not support (see Step 6's evidence; confirmed via web research since neither this repo nor
`recon.md` had IBKR's real OCA schema). The state machine core (8-9), protection-window watchdog +
flatten + halt (10-11), and leg cancellation + CRITICAL alert (12-13) build on that broker layer. Config
keys land in `xstockstrat-config` (15) at migration `013` — `011`/`012` are already claimed by features
100 and 023 per their own (already-written) implementation specs, confirmed by direct citation, not
assumption. Portfolio's `stop_order_id`/`take_profit_order_id` are additive, display-only proto fields
(17-18) populated asynchronously via a new ledger event trading emits at each bracket ACTIVE/cleared
transition (19-20), preserving portfolio's "all state sourced from ledger events" invariant per
`design.md`'s Rejected Alternatives (no synchronous portfolio RPC). The UI step (22-23) extends the
existing feature-096 position-detail sidebar — no new component, no proto change beyond the two new
`Position` fields.

**Trading.proto is unchanged.** `design.md`'s Open Risk "trading.proto bracket/OCA field shape is not
yet resolved" is resolved here by **not** exposing bracket state on the gRPC-facing `Order`/
`PlaceOrderRequest` messages at all: `bracket_stop_price`, the leg order IDs, and the state machine
status live only in the new internal `trading.order_brackets` table (Go struct +
`BracketRepository`), read by both PlaceOrder's immediate-fill path and the `pollFills` poller via a
DB lookup keyed by `order_id` — never a proto field. This also resolves the "poller-based hook site
can't access the in-process computed stop-price" risk `design.md` flagged: the bracket row is created
(with `bracket_stop_price` and, if configured, `bracket_take_profit_price`) at `PlaceOrder` time,
*before* the broker call, regardless of whether the entry fills synchronously or is later detected by
`pollFills`.

**Hard external dependency, per `recon.md`'s own sequencing blocker.** Feature 023
(`position-sizing-engine`) is `implementation-ready` (not yet executed) as of this writing; its
`implementation-spec.md` gives 030 real, citable evidence for `PlaceOrder`'s planned post-023
statement order — used throughout Steps 8/10/12 in place of current `trading.go` line numbers where
023 rewrites that region. Features 100 (`account-trading-halt-and-kill-switch`) and 101
(`exactly-once-order-intent`) are also `implementation-ready` and independently rewrite the same
`PlaceOrder`/`resolveAccount`/`ReplaceOrder`/`CancelOrder` bodies. **Every trading-service step in this
spec must be rebased against whichever of 100/101/023 have already landed on `trading.go` at execute
time** — re-verify every cited line number via grep before editing, per `insights.md`'s
2026-08-05 "citations go stale between spec-generation and execute" entry and the identical rebase
language already used in 023's own Step 8 and in `merge-order.md`'s 023↔100/101 rows. This spec does
not duplicate those features' own changes (maintenance-mode check, order-intent dedup, sizing gate) —
it only describes 030's own insertion points relative to them.

**Config migration numbering.** `011_platform_trading_state` is claimed by feature 100's
`implementation-spec.md` Step 1 (confirmed by direct read); `012_trading_risk_sizing` is claimed by
feature 023's `implementation-spec.md` Step 1 (confirmed by direct read, superseding `recon.md`'s
stale `011` guess, which predates both). This spec claims `013` — the next unclaimed number among all
currently-specced features, confirmed against `docs/roadmap/features/merge-order.md`'s recorded 011/012
assignments. Re-verify at execute time per C-07 in case a newer feature has since claimed `013`.

## Step Dependencies

- Step 2 (repository) must land before Steps 9/11/13 (state machine, watchdog/halt, cancellation), which call its new methods.
- Steps 4-5 (Alpaca broker layer) and Steps 7-8 (IBKR broker layer) must both land before Step 9 (state machine core dispatches to both).
- Step 9 must land before Step 10 (its paired test), Step 11 (watchdog reads `order_brackets` Step 9 writes), and Step 13 (leg cancellation reads the same rows).
- Step 11 must land before Step 12 (its paired test) and Step 13 (`ReplaceOrder`'s halt gate and `CancelOrder`'s leg-aware cancellation both build on `isAccountHalted`/`submitOrder`).
- Step 18 (proto) must land before Step 19 (portfolio service reads the generated Go fields) — `buf-gen` is folded into Step 18's own verification, not a separate step.
- Step 20 depends on Step 9/11 (trading must emit the new `order.bracket_updated` ledger event those steps introduce) — see Step 20's Codebase Evidence.
- **External, cross-feature**: Steps 9, 11, 13 depend on feature 023's `PlaceOrder` rewrite landing first (per `docs/roadmap/features/023-position-sizing-engine/implementation-spec.md` Step 8) for the `stopPrice`/`currentPrice` values `ComputePositionSize` computes. If 023 has not yet merged when this feature executes, these three steps are blocked — do not fabricate a placeholder `ComputePositionSize` call.
- Step 23 (UI) has no hard backend ordering dependency for compilation (it reads pre-existing-shape fields once Step 18/19 land), but should land after Step 18 so the fields actually populate in a real environment.
- Not part of this spec, named per Constitution C-14: none — both consumer surfaces (CRITICAL alert via the existing `AlertStream.tsx`; bracket IDs on the position-detail view) are covered by Steps 13-14 and 23 respectively; no surface is deferred.

---

### Step 1 — migration: `xstockstrat-trading` halt columns + `order_brackets` table

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/migrations/005_broker_accounts_halted.up.sql` — create
- `services/xstockstrat-trading/migrations/005_broker_accounts_halted.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present; `xstockstrat-trading` owner — broker API safety, position limit enforcement

**Codebase Evidence**:
- Last migration on disk: `004_broker_accounts_credential_status.{up,down}.sql` (confirmed via `ls services/xstockstrat-trading/migrations/`) → next is `005`.
- Filename pre-assigned and locked by `docs/roadmap/features/merge-order.md`'s `exactly-once-order-intent ↔ stop-loss-bracket-orders` row: "030's approved `design.md` already claims `005_broker_accounts_halted`" — `006_order_intents` (feature 101) and `007_broker_accounts_halt_source` (feature 102) are reserved by other already-specced features, so this migration must be self-contained in `005` even though it also creates `order_brackets` (not just the halt columns the filename literally names) — see Execution Summary.
- Column precedent to mirror exactly: `services/xstockstrat-trading/migrations/004_broker_accounts_credential_status.up.sql` (`ALTER TABLE trading.broker_accounts ADD COLUMN IF NOT EXISTS ...`).
- `trading.broker_accounts` schema (PK `id TEXT`): `services/xstockstrat-trading/migrations/002_broker_accounts.up.sql:1-11`.
- `trading.orders` schema — composite PK `(order_id, created_at)` on a `create_hypertable` partition (`services/xstockstrat-trading/migrations/001_orders_hypertable.up.sql:5-27`) — **no FK target exists** for `order_id` alone, so `order_brackets.order_id` is a plain indexed `UUID` column, not a foreign key (matches the platform's existing avoidance of cross-hypertable FKs; no other migration in this service uses one).
- `design.md` § Chosen Approach ("Halt.") — `halted`/`halted_at`/`halt_reason` columns, `credential_status` dual-write precedent (`validateAndRecordCredential`, `trading.go:1065-1093`).
- `design.md` § Chosen Approach ("Protection window.") — the watchdog scans `order_brackets` for `protection_deadline < now()`; state values are the six named states (`NONE, SUBMITTING, PENDING_VERIFY, ACTIVE, CANCELING, CANCELED, FAILED` — 7 distinct, `NONE` plus the 6 named in `design.md`'s transition diagram).

**TDD**: `N/A (migration — no code path executes this file directly; correctness proven by CI's real apply/rollback and by Step 3's repository build)`

**Instructions**:
1. Create `005_broker_accounts_halted.up.sql`:
   ```sql
   -- Migration: 005_broker_accounts_halted.sql
   -- Service: xstockstrat-trading
   -- Feature 030 (stop-loss-bracket-orders): persisted per-account automated halt gate
   -- (mirrors credential_status's persisted-column + boot-hydrate precedent, migration 004)
   -- plus the persisted bracket state machine table. Filename pre-assigned by
   -- docs/roadmap/features/merge-order.md; 006/007 are reserved for features 101/102.
   ALTER TABLE trading.broker_accounts
       ADD COLUMN IF NOT EXISTS halted     BOOLEAN     NOT NULL DEFAULT FALSE,
       ADD COLUMN IF NOT EXISTS halted_at  TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS halt_reason TEXT;

   CREATE TABLE IF NOT EXISTS trading.order_brackets (
       id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       order_id                   UUID        NOT NULL,
       account_id                 TEXT        NOT NULL,
       broker_type                SMALLINT    NOT NULL,
       status                     SMALLINT    NOT NULL DEFAULT 0, -- 0=NONE 1=SUBMITTING 2=PENDING_VERIFY 3=ACTIVE 4=CANCELING 5=CANCELED 6=FAILED
       bracket_stop_price         NUMERIC(18,8) NOT NULL,
       bracket_take_profit_price  NUMERIC(18,8),
       stop_leg_order_id          TEXT,
       take_profit_leg_order_id   TEXT,
       protection_deadline        TIMESTAMPTZ NOT NULL,
       fail_reason                TEXT,
       created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE INDEX IF NOT EXISTS order_brackets_order_id_idx ON trading.order_brackets (order_id);
   -- Watchdog scan target: only non-ACTIVE, non-terminal rows can be "unprotected".
   CREATE INDEX IF NOT EXISTS order_brackets_protection_watch_idx
       ON trading.order_brackets (protection_deadline)
       WHERE status IN (0, 1, 2, 4);
   ```
2. Create `005_broker_accounts_halted.down.sql`:
   ```sql
   DROP TABLE IF EXISTS trading.order_brackets;
   ALTER TABLE trading.broker_accounts
       DROP COLUMN IF EXISTS halted,
       DROP COLUMN IF EXISTS halted_at,
       DROP COLUMN IF EXISTS halt_reason;
   ```

**Verification**:
```bash
ls services/xstockstrat-trading/migrations/005_broker_accounts_halted.up.sql services/xstockstrat-trading/migrations/005_broker_accounts_halted.down.sql
```
Read both files: confirm the `.down.sql` drops exactly what the `.up.sql` creates/adds (3 columns + 1 table), in reverse dependency order (table before columns is fine — no FK).

---

### Step 2 — service: `BracketRepository` + `AccountRepository` halt methods

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/bracket_repo.go` — create
- `services/xstockstrat-trading/internal/repository/account_repo.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety

**Codebase Evidence**:
- Interface + pool-reuse precedent to mirror exactly: `AccountRepository` (`services/xstockstrat-trading/internal/repository/account_repo.go:35-45`), constructed via `repository.NewAccountRepo(repo.Pool())` in `services/xstockstrat-trading/cmd/server/main.go:83` — reuses `TradingRepo`'s existing pool, no new `DB_POOL_MAX` (**F-06**: no new pool).
- `UpdateCredentialStatus`'s exact dual-write SQL shape to mirror for halt: `account_repo.go:139-146` (`UPDATE trading.broker_accounts SET ... WHERE id = $1`).
- `scanBrokerAccount`/`BrokerAccountRecord` (`account_repo.go:17-32,154-166`) — add `Halted bool`, `HaltedAt *time.Time`, `HaltReason string` fields and extend every `SELECT`/`scanBrokerAccount` call site (`ListBrokerAccounts`, `GetBrokerAccount`, `ListActiveBrokerAccounts` — `account_repo.go:74-125`) so all three read paths stay in parity (**C-10(b)**, matching the already-solved `positionColumns` precedent portfolio uses).
- `TradingRepo.Pool()` accessor confirmed: `services/xstockstrat-trading/internal/repository/trading_repo.go` (grep `func.*Pool()` — cited by trading's own `CLAUDE.md`: "Single shared `pgxpool` — `AccountRepo` reuses `TradingRepo.Pool()`").

**TDD**: `N/A (repository is excluded from the CI Go coverage COVERPKGS computation — see Step 5's spec-template citation — and no repository-layer test exists anywhere in this service today; behavior is proven transitively by Step 9/11's service-layer tests against a fake `BracketRepository`/`AccountRepository`, and structurally by `go build`)`

**Instructions**:
1. In `account_repo.go`: add `Halted bool`, `HaltedAt *time.Time`, `HaltReason string` to `BrokerAccountRecord`; add to `AccountRepository` interface:
   ```go
   // UpdateHaltStatus persists an automated per-account halt (feature 030). Mirrors
   // UpdateCredentialStatus's shape — best-effort from the caller's perspective; the
   // caller (isAccountHalted's dual-write) does not roll back its in-memory state on
   // a persistence failure (fail-safe: stay halted, retry the write later).
   UpdateHaltStatus(ctx context.Context, id string, halted bool, reason string, haltedAt *time.Time) error
   ```
   Implement `pgAccountRepo.UpdateHaltStatus`:
   ```go
   func (r *pgAccountRepo) UpdateHaltStatus(ctx context.Context, id string, halted bool, reason string, haltedAt *time.Time) error {
       _, err := r.pool.Exec(ctx, `
           UPDATE trading.broker_accounts
           SET halted = $2, halt_reason = $3, halted_at = $4
           WHERE id = $1
       `, id, halted, reason, haltedAt)
       return err
   }
   ```
   Extend the three `SELECT ... FROM trading.broker_accounts` queries (`ListBrokerAccounts`, `GetBrokerAccount`, `ListActiveBrokerAccounts`) and `scanBrokerAccount` to also select/scan `halted, halted_at, halt_reason`.
2. Create `bracket_repo.go` (package `repository`), mirroring `AccountRepository`'s interface + pool-backed-struct shape:
   ```go
   type OrderBracketRecord struct {
       ID                     string
       OrderID                string
       AccountID              string
       BrokerType             int32
       Status                 int32 // BracketStatus: matches the SMALLINT encoding in migration 005
       BracketStopPrice       float64
       BracketTakeProfitPrice *float64
       StopLegOrderID         string
       TakeProfitLegOrderID   string
       ProtectionDeadline     time.Time
       FailReason             string
       CreatedAt, UpdatedAt   time.Time
   }

   type BracketRepository interface {
       CreateBracket(ctx context.Context, rec *OrderBracketRecord) error
       GetBracketByOrderID(ctx context.Context, orderID string) (*OrderBracketRecord, error)
       UpdateBracketStatus(ctx context.Context, id string, status int32, stopLegID, takeProfitLegID, failReason string) error
       // ReArmProtection updates protection_deadline (called at every transition that
       // leaves ACTIVE — design.md's "re-armed... not just the initial one").
       ReArmProtection(ctx context.Context, id string, deadline time.Time) error
       // ListExpiredProtection finds non-ACTIVE, non-terminal brackets past their deadline
       // (the watchdog's scan target — order_brackets_protection_watch_idx backs this).
       ListExpiredProtection(ctx context.Context, now time.Time) ([]*OrderBracketRecord, error)
   }

   type pgBracketRepo struct { pool *pgxpool.Pool }

   func NewBracketRepo(pool *pgxpool.Pool) BracketRepository { return &pgBracketRepo{pool: pool} }
   ```
   Implement each method with straightforward parameterized SQL against `trading.order_brackets`
   (`INSERT`/`SELECT`/`UPDATE ... WHERE id = $1` / `SELECT ... WHERE status IN (0,1,2,4) AND protection_deadline < $1`), following `account_repo.go`'s exact style (named struct literal on `Exec`/`QueryRow`, `pgx.ErrNoRows` mapped to `nil, nil` in `GetBracketByOrderID` for "no bracket exists yet").
3. In `cmd/server/main.go`, add `bracketRepo := repository.NewBracketRepo(repo.Pool())` immediately after the existing `accountRepo := repository.NewAccountRepo(repo.Pool())` (`main.go:83`), and thread it into `service.NewTradingService(...)` (extends Step 2's constructor signature — coordinate with Step 8, which is what actually consumes it).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 3 — test: repository build/lint proof

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/bracket_repo.go` — no new file (verification-only step)

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- No repository-layer test exists anywhere in this service (`ls services/xstockstrat-trading/internal/repository/*_test.go` → no matches) — `UpdateCredentialStatus`, `CreateBrokerAccount`, and every other existing repo method are also untested at this layer; Step 2's new methods follow that same, pre-existing precedent rather than inventing a new DB-test harness speculatively (Constitution **C-13**'s "materializes lazily" — a fixture/test home is never built ahead of demand).
- `internal/repository` is excluded from the Go coverage `COVERPKGS` computation (`reference/spec-template.md`'s verification command: `grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)'`) — no coverage percentage gates this package.

**TDD**: `N/A (paired verification step — no new test file; see Codebase Evidence for why no DB-test harness is introduced)`

**Instructions**: None (this step is the explicit, named acknowledgment of Step 2's test-pairing decision, per Constitution **C-08** — the real functional proof for `BracketRepository`/the new `AccountRepository` methods comes from Step 9's and Step 11's service-layer tests, which exercise them through a hand-rolled fake implementing the same interfaces, exactly as `portfolio`/`marketdata`/`accountRepo` are already faked in this service's existing tests).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go vet ./internal/repository/...
```

---

### Step 4 — service: `broker.Broker` interface + `OrderRequest`/`BrokerOrder` bracket fields

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/broker.go` — modify

**Reviewers**: `xstockstrat-trading` owner — broker API safety

**Codebase Evidence**:
- `Broker` interface: `services/xstockstrat-trading/internal/broker/broker.go:57-76`; `OrderRequest`: `:79-97`; `BrokerOrder`: `:15-20`.
- `design.md` § Chosen Approach ("Broker split.") — Alpaca attaches bracket parameters atomically at entry `SubmitOrder`; IBKR submits two follow-up orders sharing a group after fill confirmation. This step adds the fields/method both brokers need; Steps 5 and 7 implement them per-broker.
- The two brokers' bracket mechanics are genuinely different shapes (Alpaca: extra fields on the *same* `SubmitOrder` call; IBKR: a *separate* 2-order call after the entry is placed) — a single `SubmitOrder(ctx, req)` signature cannot express IBKR's array-of-2 submission, so a new interface method is required rather than overloading `OrderRequest` alone.

**TDD**: `N/A (interface/type declaration only — no behavior; Steps 5-8 add the behavior this enables)`

**Instructions**:
1. Add to `OrderRequest` (after `ClientOrderID`):
   ```go
   // BracketStopPrice / BracketTakeProfitPrice, when non-zero, request a bracket order
   // (Alpaca-native atomic attach at submit time; feature 030). Distinct from StopPrice,
   // which carries a STOP/STOP_LIMIT entry's own real broker-trigger price.
   BracketStopPrice       float64
   BracketTakeProfitPrice float64
   ```
2. Add to `BrokerOrder`:
   ```go
   // StopLegOrderID / TakeProfitLegOrderID are populated when the broker returned bracket
   // child order IDs on the same submit response (Alpaca only; empty otherwise).
   StopLegOrderID       string
   TakeProfitLegOrderID string
   ```
3. Add to the `Broker` interface (after `ReplaceOrder`):
   ```go
   // SubmitBracketLegs submits a stop-loss + optional take-profit as a linked pair
   // referencing an already-placed parent order (feature 030). Only meaningful for
   // brokers that cannot attach a bracket atomically at entry submission (IBKR);
   // Alpaca's implementation returns an error and is never called for Alpaca accounts —
   // its bracket attaches via OrderRequest.BracketStopPrice/BracketTakeProfitPrice on
   // the original SubmitOrder instead.
   SubmitBracketLegs(ctx context.Context, parentBrokerOrderID, parentClientOrderID string, legs BracketLegsRequest) (*BracketLegsResponse, error)
   ```
4. Add the new types:
   ```go
   // BracketLegsRequest carries the stop-loss + optional take-profit leg parameters for
   // a broker that submits bracket children as a follow-up call (feature 030).
   type BracketLegsRequest struct {
       Symbol             string
       Side               string // opposite of the entry side — "sell" to close a long, "buy" to close a short
       Qty                float64
       StopPrice          float64 // required
       TakeProfitPrice    float64 // 0 = no take-profit leg
       TimeInForce        string
   }

   // BracketLegsResponse carries the broker-assigned IDs for the submitted legs.
   type BracketLegsResponse struct {
       StopLegOrderID       string
       TakeProfitLegOrderID string // empty when TakeProfitPrice was 0
   }
   ```

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Trading-domain constraint (broker coverage): this step declares the shared surface both brokers implement; Steps 5 and 7 implement Alpaca and IBKR respectively — neither broker is left unhandled.

---

### Step 5 — service: Alpaca native bracket submission

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/alpaca.go` — modify

**Reviewers**: `xstockstrat-trading` owner — broker API safety, paper-only dev invariant

**Codebase Evidence**:
- `SubmitOrder`'s existing request-building shape to extend: `alpaca.go:95-127` (anonymous struct + conditional field population, e.g. `if req.StopPrice != 0 { alpacaReq.StopPrice = ... }` at `:118-120`).
- Alpaca's real bracket order JSON shape (`order_class: "bracket"`, nested `stop_loss`/`take_profit` objects) is well-established Alpaca API surface, distinct from the plain top-level `stop_price` field this client already sends for STOP/STOP_LIMIT entries (`alpaca.go:103`) — the two must not collide (mirrors `fails.md` 2026-08-05's "convenient-but-wrong field" trap `recon.md` already flagged for this feature).
- Response parsing precedent (existing `FilledQty`/`FilledAvgPrice` string→float parse): `alpaca.go:166-174`. Alpaca's bracket response nests child orders under a `legs` array in the same order object.

**TDD**: `red-green required`

**Instructions**:
1. In `SubmitOrder`, when `req.BracketStopPrice != 0`, add to the request struct:
   ```go
   OrderClass string `json:"order_class,omitempty"`
   StopLoss   *struct {
       StopPrice string `json:"stop_price"`
   } `json:"stop_loss,omitempty"`
   TakeProfit *struct {
       LimitPrice string `json:"limit_price"`
   } `json:"take_profit,omitempty"`
   ```
   populated as:
   ```go
   if req.BracketStopPrice != 0 {
       alpacaReq.OrderClass = "bracket"
       alpacaReq.StopLoss = &struct{ StopPrice string `json:"stop_price"` }{
           StopPrice: strconv.FormatFloat(req.BracketStopPrice, 'f', -1, 64),
       }
       if req.BracketTakeProfitPrice != 0 {
           alpacaReq.TakeProfit = &struct{ LimitPrice string `json:"limit_price"` }{
               LimitPrice: strconv.FormatFloat(req.BracketTakeProfitPrice, 'f', -1, 64),
           }
       }
   }
   ```
   (Use named local types rather than anonymous inline struct-literal field types if Go syntax requires — mirror whichever compiles cleanly against the existing anonymous-struct pattern in this file.)
2. Extend `AlpacaOrder` to capture child legs:
   ```go
   Legs []struct {
       ID   string `json:"id"`
       Type string `json:"type"` // "stop", "limit"
   } `json:"legs"`
   ```
3. After parsing `alpacaResp`, populate `BrokerOrder.StopLegOrderID`/`TakeProfitLegOrderID` from `alpacaResp.Legs` by matching `Type == "stop"` / `"limit"` respectively (both the `SubmitOrder` return in this function).
4. Implement `SubmitBracketLegs` as an explicit unsupported no-op (Alpaca's bracket attaches at entry, not as a follow-up):
   ```go
   func (c *Client) SubmitBracketLegs(ctx context.Context, parentBrokerOrderID, parentClientOrderID string, legs BracketLegsRequest) (*BracketLegsResponse, error) {
       return nil, fmt.Errorf("alpaca: bracket legs attach atomically at order submission; SubmitBracketLegs is not supported")
   }
   ```
5. Add `var _ Broker = (*Client)(nil)` is already present (`alpaca.go:439`) — no change needed, but the new interface method must compile against it (proves the signature match).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Trading-domain constraint (order type coverage): bracket attach is independent of the 5 `OrderType`
values — brackets only ever originate from an auto-sized MARKET/LIMIT entry per product-spec's
Out-of-Scope note; this step does not change type-dispatch, only the request payload when
`BracketStopPrice != 0`.

---

### Step 6 — test: Alpaca bracket submission unit test

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/alpaca_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Exact test harness to reuse: `makeTestServer` (`alpaca_test.go:16-22`), `TestSubmitOrder_Paper` (`alpaca_test.go:24+`) — `httptest.NewServer` + a handler asserting the decoded request body.

**TDD**: `red-green required` — fails against pre-Step-5 `alpaca.go` (no `order_class`/`stop_loss`/`take_profit` fields exist to assert on; `SubmitBracketLegs` does not exist to call).

**Instructions**: Add `TestSubmitOrder_BracketAttachesAtomically` using `makeTestServer`: submit an
`OrderRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Qty: 10, BracketStopPrice: 178.0,
BracketTakeProfitPrice: 210.0}`; assert the decoded request body has `order_class == "bracket"`,
`stop_loss.stop_price == "178"`, `take_profit.limit_price == "210"`; have the mock server respond with
a `legs` array (`[{"id":"leg-stop-1","type":"stop"},{"id":"leg-tp-1","type":"limit"}]`); assert the
returned `*BrokerOrder.StopLegOrderID == "leg-stop-1"` and `TakeProfitLegOrderID == "leg-tp-1"`. Add a
second case with `BracketTakeProfitPrice: 0` asserting `take_profit` is omitted from the request JSON
(`omitempty`) and the response has no `legs`. Add `TestSubmitBracketLegs_AlpacaUnsupported` asserting
the method returns a non-nil error.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/broker/... -race -run 'TestSubmitOrder_BracketAttachesAtomically|TestSubmitBracketLegs_AlpacaUnsupported' -v
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 7 — service: IBKR bracket-leg submission (`SubmitBracketLegs`) + `cOID` fix

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/ibkr.go` — modify

**Reviewers**: `xstockstrat-trading` owner — broker API safety

**Codebase Evidence — corrects `design.md`'s assumed mechanism.** `design.md` § Chosen Approach
("Broker split.") states IBKR submits "two follow-up orders sharing an `OCAGroup` string" and names
this exact unresolved risk: "IBKR's exact `ocaGroup`/`ocaType`/`parentId` JSON key names are
unverified against IBKR's real Client Portal Web API — `/sdd-spec` must verify against IBKR's actual
API reference, not fabricate the shape." `recon.md` confirmed no such fields exist anywhere in this
repo. Verified here via IBKR's own published API documentation (interactivebrokers.com blocks direct
fetch with HTTP 403; corroborated via web search summaries of "How to Code an OCA Order in the Web
API" and "How to Code a Bracket Order in the Web API," IBKR Quant Blog, plus a third-party generated
API client's `OrderRequest` field reference — `c_oid`/`parent_id` fields, cross-confirmed across
independent sources):
- The IBKR Client Portal Web API has **no client-settable OCA group name field**. Grouping is done by
  submitting the linked orders **together, in one `POST /iserver/account/{accountId}/orders` call**,
  as a JSON array under `"orders"`, with **`isSingleGroup: true`** set on each order in the group. The
  server assigns the OCA group ID itself (retrievable afterward via
  `GET /iserver/account/order/status/{orderId}` as `oca_group_id`), not the caller.
  This is why `SubmitBracketLegs` must submit stop-loss and take-profit **in a single request**
  (an array of 2 order objects), not as two sequential `SubmitOrder`-style calls — the current
  `Broker.SubmitOrder(ctx, req)` shape (one order per call) cannot express this, which is exactly why
  Step 4 added a dedicated interface method instead of reusing `SubmitOrder` for the legs.
- Parent/child linkage for a bracket order uses **`parentId`** on the child, set to the parent (entry)
  order's own **`cOID`** (customer order ID) — an arbitrary client-chosen string set on the *parent*
  order at its own submission time.
- **Confirmed gap in this codebase**: `SubmitOrder` (`ibkr.go:116-169`) never sends a `cOID` field in
  its request body (`body := map[string]interface{}{"conid":..., "orderType":..., "side":...,
  "quantity":..., "tif":..., "ticker":...}`, `ibkr.go:122-129`) — so today there is no customer order ID
  for a future bracket child to reference via `parentId`. This step must add one.
- Existing IBKR field-mapping precedent to reuse for the legs: `orderTypeToIBKR` (`ibkr.go:64-78`,
  `"stop"→"STP"`, `"limit"→"LMT"`), `auxPrice` for a STP trigger price (`ibkr.go:133-135`, already used
  for `req.StopPrice`), `price` for a LMT limit price (`ibkr.go:130-132`, already used for
  `req.LimitPrice`).
- Auth/signing precedent to reuse verbatim: `c.signRequest(http.MethodPost, endpoint)` (`ibkr.go:148`).
- IBKR conid resolution precedent to reuse: `resolveConid` (`ibkr.go:83-113`).

**TDD**: `red-green required`

**Instructions**:
1. In `SubmitOrder`, add `"cOID": req.ClientOrderID` to the request `body` map (`ibkr.go:122-129`) when
   `req.ClientOrderID != ""` — the entry order now carries a customer order ID a bracket child can
   reference. Existing behavior (no `cOID`) is preserved when the caller leaves it empty.
2. Implement `SubmitBracketLegs`:
   ```go
   func (c *IBKRClient) SubmitBracketLegs(ctx context.Context, parentBrokerOrderID, parentClientOrderID string, legs BracketLegsRequest) (*BracketLegsResponse, error) {
       conid, err := c.resolveConid(ctx, legs.Symbol)
       if err != nil {
           return nil, fmt.Errorf("ibkr SubmitBracketLegs: %w", err)
       }
       orders := []map[string]interface{}{
           {
               "conid": conid, "orderType": "STP", "side": strings.ToUpper(legs.Side),
               "quantity": legs.Qty, "tif": strings.ToUpper(legs.TimeInForce), "ticker": legs.Symbol,
               "auxPrice": legs.StopPrice, "parentId": parentClientOrderID, "isSingleGroup": true,
           },
       }
       if legs.TakeProfitPrice != 0 {
           orders = append(orders, map[string]interface{}{
               "conid": conid, "orderType": "LMT", "side": strings.ToUpper(legs.Side),
               "quantity": legs.Qty, "tif": strings.ToUpper(legs.TimeInForce), "ticker": legs.Symbol,
               "price": legs.TakeProfitPrice, "parentId": parentClientOrderID, "isSingleGroup": true,
           })
       }
       payload, err := json.Marshal(map[string]interface{}{"orders": orders})
       if err != nil {
           return nil, fmt.Errorf("ibkr SubmitBracketLegs: marshal: %w", err)
       }
       endpoint := fmt.Sprintf("%s/iserver/account/%s/orders", c.baseURL, c.ibkrAccountID)
       httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
       if err != nil {
           return nil, fmt.Errorf("ibkr SubmitBracketLegs: build request: %w", err)
       }
       httpReq.Header.Set("Content-Type", "application/json")
       httpReq.Header.Set("Authorization", c.signRequest(http.MethodPost, endpoint))
       resp, err := c.httpClient.Do(httpReq)
       if err != nil {
           return nil, fmt.Errorf("ibkr SubmitBracketLegs: http: %w", err)
       }
       defer resp.Body.Close() //nolint:errcheck
       respBody, _ := io.ReadAll(resp.Body)
       if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
           return nil, fmt.Errorf("ibkr SubmitBracketLegs: status %d: %s", resp.StatusCode, respBody)
       }
       var replies []struct {
           OrderID string `json:"order_id"`
       }
       if err := json.Unmarshal(respBody, &replies); err != nil || len(replies) == 0 {
           return nil, fmt.Errorf("ibkr SubmitBracketLegs: parse response: %w", err)
       }
       out := &BracketLegsResponse{StopLegOrderID: replies[0].OrderID}
       if len(replies) > 1 {
           out.TakeProfitLegOrderID = replies[1].OrderID
       }
       return out, nil
   }
   ```

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Trading-domain constraint (broker coverage): this step is IBKR-only; Alpaca's `SubmitBracketLegs` (Step
5) is the explicit unsupported branch — both `BrokerType` values are accounted for.

---

### Step 8 — test: IBKR bracket-leg submission unit test

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/ibkr_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Test harness precedent: `TestSubmitOrder_IBKRResolvesConid` (`ibkr_test.go:14+`) — `httptest.NewServer` with a `switch r.URL.Path` mux, asserting decoded request bodies per path.

**TDD**: `red-green required` — fails against pre-Step-7 `ibkr.go` (`SubmitBracketLegs` does not exist).

**Instructions**: Add `TestSubmitBracketLegs_SubmitsSingleGroupArray`: mock
`/iserver/secdef/search` (conid resolution, existing pattern) and
`/iserver/account/U1234567/orders`; assert the decoded POST body's `"orders"` array has exactly 2
entries when `TakeProfitPrice != 0`, each with `isSingleGroup: true`, `parentId` equal to the
`parentClientOrderID` argument, the first with `orderType: "STP"` + `auxPrice` equal to `StopPrice`,
the second with `orderType: "LMT"` + `price` equal to `TakeProfitPrice`; have the mock respond with
`[{"order_id":"ibkr-stop-1"},{"order_id":"ibkr-tp-1"}]`; assert the returned
`*BracketLegsResponse.StopLegOrderID == "ibkr-stop-1"` and `TakeProfitLegOrderID == "ibkr-tp-1"`. Add a
second case with `TakeProfitPrice: 0` asserting the array has exactly 1 entry. Add
`TestSubmitOrder_IBKRSendsCOID` asserting the entry-order `SubmitOrder` request body includes
`"cOID"` equal to `req.ClientOrderID` when set, and omits it when empty (existing `TestSubmitOrder_*`
cases must keep passing unchanged, since they never set `ClientOrderID`).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/broker/... -race -run 'TestSubmitBracketLegs_SubmitsSingleGroupArray|TestSubmitOrder_IBKRSendsCOID' -v
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 9 — service: bracket state machine core (`order_brackets` creation + fill-confirmed hooks)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, position limit enforcement

**Codebase Evidence**:
- **Insertion points are relative to feature 023's planned `PlaceOrder` rewrite**, not current
  `trading.go` line numbers (per this spec's Execution Summary and `design.md`'s Open Risk) —
  `docs/roadmap/features/023-position-sizing-engine/implementation-spec.md` Step 8's numbered statement
  order: after **023's Step 7** (`s.ComputePositionSize(ctx, req, equity, confidence)` returns
  `sizedQty, dollarRisk, stopPrice, err`; `req.Qty = sizedQty` mutated in place), and after **023's
  Steps 9-10** (order construction, `orderID := uuid.New().String()`, `s.orders[orderID] = order`,
  `s.repo.UpsertOrder(...)`) — insert bracket-row creation **after** order construction, once `orderID`
  exists, but only when 023's `needSizing` was true for this call (product-spec's Out-of-Scope: brackets
  apply only to auto-sized orders in V1). **Bracket submission only ever applies to a MARKET or LIMIT
  entry order** — the only two `OrderType`s 023's plan populates `order.StopPrice` for informationally;
  STOP/STOP_LIMIT/TRAILING_STOP entries and override-mode (explicit-qty) orders are out of scope (per
  product-spec's Out-of-Scope note and `design.md`'s "informational only" framing).
- **`ComputePositionSize`'s planned return signature does not expose the resolved current price**
  (`023/implementation-spec.md` Step 6: `func (s *TradingService) ComputePositionSize(ctx, req,
  equity, confidence float64) (qty, dollarRisk, stopPrice float64, err error)`) — but this step's
  take-profit formula (FR-2, `product-spec.md:18`) needs an entry-price proxy. 023's own Step 6
  Codebase Evidence already resolves this internally ("Current price: `(ask+bid)/2` when both > 0...")
  as a local variable that is simply never returned. **If 023 has landed exactly as specced by the time
  this step executes**, widen `ComputePositionSize`'s return signature to also return `currentPrice
  float64` (a minimal, additive 4th return value — re-verify the real signature via grep before editing,
  since 023 may have changed by then per the rebase note in this spec's Execution Summary) and update
  its single call site (023's Step 7 insertion) to capture it. When `req.OrderType ==
  ORDER_TYPE_LIMIT`, prefer `req.LimitPrice` over the fetched current price as the entry-price proxy
  (a closer estimate of the actual fill price).
- Fill-confirmed hook sites, current code (pre-023/100/101 — **re-verify against the landed tree**):
  `PlaceOrder`'s immediate-fill branch, `trading.go:363-370` (`order.FilledQty = brokerOrder.FilledQty`
  after `SubmitOrder` returns); `pollFills`'s `ORDER_STATUS_FILLED` branch, `trading.go:730-741`, and
  `ORDER_STATUS_PARTIALLY_FILLED` branch, `trading.go:742-748`.
- Config-read idiom to reuse: `s.cfgW.GetBool("trading.risk.max_position_pct", ...)`-style calls at
  `trading.go:1292` → for this feature: `s.cfgW.GetBool("trading.risk.bracket_orders_enabled", true)`,
  `s.cfgW.GetFloat("trading.risk.take_profit_rr_multiple", 2.0)`,
  `s.cfgW.GetInt("trading.risk.max_unprotected_seconds", 30)` (keys seeded in Step 16). **30 seconds
  confirmed by the user 2026-08-06** (see context.md) — the P0 safety review's own example was 5
  seconds, but this spec's judgment that 5s is too tight for IBKR's conid-resolution + 2-call
  submission path was accepted; this is no longer a provisional placeholder.
- `BrokerType` dispatch precedent: `commonv1.BrokerType(accountEntry.brokerType)` already resolved on
  the constructed `order` (023's unchanged order-construction block; current `trading.go:301`).
- `broker.OrderRequest`/`Broker` extensions from Steps 4-7.

**TDD**: `red-green required`

**Instructions**:
1. Add `bracketRepo repository.BracketRepository` field to `TradingService` (Step 2's constructor
   wiring) alongside `accountRepo`.
2. Add `func (s *TradingService) maybeSubmitBracket(ctx context.Context, order *tradingv1.Order, accountEntry brokerPoolEntry, stopPrice float64, entryPriceProxy float64)`:
   - No-op if `stopPrice <= 0` or `!s.cfgW.GetBool("trading.risk.bracket_orders_enabled", true)`.
   - Compute `takeProfitPrice` per FR-2 when `rr := s.cfgW.GetFloat("trading.risk.take_profit_rr_multiple", 2.0); rr > 0`:
     direction-aware off `order.Side` (BUY: `entryPriceProxy + (entryPriceProxy - stopPrice) * rr`;
     SELL: `entryPriceProxy - (stopPrice - entryPriceProxy) * rr`), else `0` (no take-profit leg).
   - `deadline := time.Now().Add(time.Duration(s.cfgW.GetInt("trading.risk.max_unprotected_seconds", 30)) * time.Second)`.
   - `bracketRepo.CreateBracket(ctx, &repository.OrderBracketRecord{OrderID: order.OrderId, AccountID: order.AccountId, BrokerType: int32(order.BrokerType), Status: 1 /* SUBMITTING */, BracketStopPrice: stopPrice, BracketTakeProfitPrice: &takeProfitPrice, ProtectionDeadline: deadline})` — errors are logged (`slog.Warn`), not fatal to the entry order (the entry already filled; a bracket-row-create failure is itself a bracket-submission failure and must reach Step 13's CRITICAL alert path, not silently abort).
   - Dispatch by `accountEntry.brokerType`:
     - `ALPACA`: bracket already attached atomically if the *original* entry `SubmitOrder` call carried `BracketStopPrice`/`BracketTakeProfitPrice` (see Instruction 3 below) — this function, for Alpaca, only needs to record the leg IDs `SubmitOrder` already returned on `brokerOrder.StopLegOrderID`/`TakeProfitLegOrderID` and transition the row straight to `ACTIVE` (2 → 3) via `UpdateBracketStatus`.
     - `IBKR`: call `accountEntry.client.SubmitBracketLegs(ctx, order.BrokerOrderId, order.ClientOrderId, broker.BracketLegsRequest{Symbol: order.Symbol, Side: oppositeSide(order.Side), Qty: order.FilledQty, StopPrice: stopPrice, TakeProfitPrice: takeProfitPrice, TimeInForce: "day"})`; on success, `UpdateBracketStatus(..., status: 3 /* ACTIVE */, stopLegID, takeProfitLegID, "")`; on error, `UpdateBracketStatus(..., status: 6 /* FAILED */, "", "", err.Error())` and call Step 13's CRITICAL alert helper.
   - Add a small `oppositeSide(s tradingv1.OrderSide) string` helper (`BUY→"sell"`, `SELL→"buy"`) — the bracket must close, not extend, the position.
3. In the entry `SubmitOrder` call itself (023's unchanged broker-submission statement, current
   `trading.go:337-342`, `buildBrokerRequest(req)`): when `needSizing` (023's local var) and
   `accountEntry.brokerType == ALPACA` and `stopPrice > 0` and bracket orders are enabled, set
   `brokerReq.BracketStopPrice`/`BracketTakeProfitPrice` on the request built by
   `buildBrokerRequest` before calling `accountEntry.client.SubmitOrder(ctx, brokerReq)` — this is
   Alpaca's atomic path (per `design.md`: "strictly safer than post-fill submission — no fill→stop
   gap"). For IBKR, do **not** set these fields (its `SubmitOrder` ignores them structurally — no
   `order_class` field exists in `ibkr.go`'s request shape); IBKR's legs go through
   `maybeSubmitBracket`'s `SubmitBracketLegs` follow-up call after the entry fill is confirmed.
4. Call `s.maybeSubmitBracket(...)` from **both** hook sites:
   - `PlaceOrder`'s immediate-fill branch: after `order.FilledQty = brokerOrder.FilledQty` (current
     `trading.go:366`), when `order.FilledQty > 0`.
   - `pollFills`'s `ORDER_STATUS_FILLED` **and** `ORDER_STATUS_PARTIALLY_FILLED` branches (current
     `trading.go:730-748`): look up the existing bracket row first via
     `bracketRepo.GetBracketByOrderID(ctx, order.OrderId)` — `nil` (no row) means this order was never
     auto-sized (no bracket applies, matches Instruction 2's `stopPrice <= 0` no-op); a non-nil row in
     `ACTIVE` status on a new `PARTIALLY_FILLED` event is the **resize** case (Instruction 5).
5. **Partial-fill resize** (product-spec's OQ-3 / `design.md`'s "explicitly resized on each subsequent
   partial-fill delta"): when `pollFills` observes a new `PARTIALLY_FILLED` (or `FILLED` following a
   prior `PARTIALLY_FILLED`) for an order whose bracket is already `ACTIVE` (IBKR only — Alpaca's
   native bracket resizes itself, per `design.md`, and this service only ever reads it back via
   `GetOrder`, never re-submits it), transition the row to `CANCELING` (4), call
   `accountEntry.client.CancelOrder` on both existing leg IDs (best-effort, log failures), then
   transition to `SUBMITTING` (1) and re-call `SubmitBracketLegs` with `Qty: order.FilledQty` (the new
   cumulative filled quantity) via the same dispatch as Instruction 2, **re-arming**
   `protection_deadline` (`bracketRepo.ReArmProtection`) at this transition — not just at the initial
   `NONE→SUBMITTING` arm (`design.md`: "re-armed... at every transition that leaves ACTIVE").
6. Emit the new `order.bracket_updated` ledger event (consumed by Step 19's portfolio changes) whenever
   a bracket reaches `ACTIVE` or transitions away from it to a terminal/cleared state, via the existing
   `s.emitLedgerEvent` helper (`trading.go:1426`), payload: `{"user_id": order.UserId, "account_id":
   order.AccountId, "symbol": order.Symbol, "trading_mode": order.TradingMode.String(),
   "stop_order_id": <stopLegID or "">, "take_profit_order_id": <takeProfitLegID or "">}` — an empty
   string for either ID means "cleared" (portfolio's consumer, Step 19, treats empty as null-out).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Trading-domain constraints:
- **Broker coverage**: both `ALPACA` (atomic attach) and `IBKR` (follow-up `SubmitBracketLegs`) are
  handled by Instruction 2's dispatch.
- **Trading mode gate**: unaffected — bracket submission runs after `mode := s.resolveTradingMode(...)`
  is already resolved (023's unchanged statement); paper vs. live routing is unchanged by this step.
- **Order type coverage**: MARKET/LIMIT auto-sized entries only, per product-spec's Out-of-Scope note
  (explicitly stated in Codebase Evidence above) — STOP/STOP_LIMIT/TRAILING_STOP and override-mode
  orders are unaffected.
- **Fill state completeness**: both `FILLED` (Instruction 4) and `PARTIALLY_FILLED` (Instructions 4-5,
  including the resize case) are handled.

---

### Step 10 — test: bracket state machine unit tests

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_bracket_test.go` — create

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Hand-rolled fake pattern to reuse (023's own precedent for faking a gRPC-client-shaped dependency —
  `internal/service` tests already fake `portfolio`/`marketdata`): `023/implementation-spec.md` Step 7
  (`fakePortfolioClient`/`fakeMarketDataClient` embedding the real client interface, overriding only
  the methods used). This step follows the same technique for `broker.Broker` and
  `repository.BracketRepository`: `&fakeBroker{}` implementing all 9 `Broker` methods (panics on
  unused ones), `&fakeBracketRepo{}` implementing `BracketRepository` with an in-memory map.
- `design.md`'s Open Risk on test scope: "The state machine's happy path, config toggles,
  window-expiry→flatten→halt, resize re-arm, and CRITICAL alert emission are unit-testable now via a
  hand-rolled mock of `broker.Broker`... True broker nondeterminism... cannot be deterministically
  reproduced without feature 103 and is an accepted, named test gap." This step covers the
  unit-testable half; Step 12's tests cover the rest of that same list.

**TDD**: `red-green required` — fails against pre-Step-9 `trading.go` (`maybeSubmitBracket` does not
exist).

**Instructions**: In `trading_bracket_test.go` (package `service`), add:
1. `TestMaybeSubmitBracket_AlpacaAtomicRecordsLegs` — `BrokerType: ALPACA`, a fake broker whose
   `SubmitOrder` response already carries `StopLegOrderID`/`TakeProfitLegOrderID`; assert the created
   bracket row transitions straight to `ACTIVE` (3) with both leg IDs recorded, and `SubmitBracketLegs`
   is never called (fake panics if called, proving Alpaca's atomic path is exercised).
2. `TestMaybeSubmitBracket_IBKRSubmitsFollowUpLegs` — `BrokerType: IBKR`, fake `SubmitBracketLegs`
   returns `{StopLegOrderID: "s1", TakeProfitLegOrderID: "t1"}`; assert `ACTIVE` with both IDs.
3. `TestMaybeSubmitBracket_TakeProfitRRMultiple` — table-driven over BUY/SELL × `rr=2.0`/`rr=0`
   (disabled), asserting the computed take-profit price formula (FR-2) and that `rr=0` submits no
   take-profit leg (`TakeProfitPrice: 0` on the `BracketLegsRequest`/Alpaca request).
4. `TestMaybeSubmitBracket_BracketOrdersDisabled` — `trading.risk.bracket_orders_enabled=false` → no
   bracket row created, no broker call.
5. `TestMaybeSubmitBracket_NoStopPrice` — `stopPrice=0` (order wasn't auto-sized) → no-op.
6. `TestMaybeSubmitBracket_IBKRFailureTransitionsFailedAndAlerts` — fake `SubmitBracketLegs` returns an
   error; assert bracket row transitions to `FAILED` (6) with `fail_reason` set, and the fake `notify`
   client's `EmitAlert` was called with `Severity: ALERT_SEVERITY_CRITICAL` (Step 13 wiring — write this
   test now against Step 13's not-yet-written helper via a small stub the two steps share, or defer this
   specific assertion to Step 13's own test if sequencing makes that cleaner; either placement is
   acceptable as long as one test asserts it).
7. `TestPollFills_PartialFillResizesActiveBracket` — an `ACTIVE` IBKR bracket, a new `PARTIALLY_FILLED`
   event with a larger `FilledQty`; assert `CancelOrder` called on both prior leg IDs, then
   `SubmitBracketLegs` called again with the new `Qty`, and `protection_deadline` advanced
   (`ReArmProtection` called) — this is the multi-item/ordering-sensitive case `insights.md`'s
   2026-07-27 entry warns about (item 1 vs. item N must behave identically): include a **second**
   partial-fill event in the same test asserting the resize repeats correctly, not just once.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -run 'TestMaybeSubmitBracket|TestPollFills_PartialFillResizesActiveBracket' -v
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in `internal/service`, excluded from the CI Go coverage `COVERPKGS` computation (Step 3's
citation) — the functional test run above is the required proof.

---

### Step 11 — service: protection-window watchdog + flatten + persisted halt gate

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, position limit enforcement

**Codebase Evidence**:
- `design.md` § Chosen Approach ("Protection window.", "Flatten reuses `PlaceOrder`'s own safety
  machinery", "Halt.") — the authoritative mechanics for this step, already adversarially reviewed
  across 5 design rounds (see `docs/roadmap/features/030-stop-loss-bracket-orders/context.md` 2026-08-06
  session for the specific fixes each round produced — in particular round 5's corrected dual-write
  ordering, which this step must follow exactly, not the round-4 version).
- `PlaceOrder`'s approval-decision seam to split (current code, **re-verify against 023/100/101's
  landed tree**): `trading.go:276-277` (`requiresApproval := ...`) through the broker-submission block
  (`trading.go:279-384`) — extract into `submitOrder(ctx context.Context, req
  *tradingv1.PlaceOrderRequest, accountEntry brokerPoolEntry, mode commonv1.TradingMode, orderID
  string, requiresApproval bool) (*tradingv1.Order, error)` preserving the existing
  `requiresApproval` early-return branch (`trading.go:320-328`, unconditional `order.created` emit +
  approval-path early return) and the broker-submission branch (`trading.go:330-384`) verbatim —
  `PlaceOrder` itself becomes a thin wrapper computing `requiresApproval` and calling `submitOrder`.
- `checkCredentialHealth`'s bounded-scan pattern to mirror for the watchdog:
  `checkCredentialHealth` (`trading.go:1135-1154`, `context.WithTimeout` + a semaphore-bounded
  `sync.WaitGroup` fan-out) — this feature's watchdog needs the analogous shape:
  `context.WithTimeout(ctx, 2*time.Second)` for the `ListExpiredProtection` scan itself (mirrors
  `checkPortfolioRisk`'s `trading.go:1297` budget), then one `go s.flattenAndHalt(...)` goroutine **per**
  expired row, guarded by a `flattenInFlight map[string]bool` (keyed by bracket/order ID) + mutex so a
  slow flatten never blocks the next tick's scan or other accounts' flattens (`design.md`: "one
  account's slow flatten... never blocks fill detection or the protection check for every other
  account").
- Retry-loop budget to reuse for flatten: `trading.order.max_retries` / `trading.order.retry_delay_ms`
  (already-consumed keys per `services/xstockstrat-trading/CLAUDE.md`'s Config Keys table) — `design.md`
  states the flatten retry loop is "bounded ~21.5s worst case with default retry config."
  `ClientOrderID` for the flatten is minted **once per protection-gap-expiry episode** (not per retry),
  per `design.md`'s "preserving the platform's broker-side dedup contract."
- `validateAndRecordCredential`'s exact dual-write ordering to mirror for the halt (round-5-corrected,
  per Codebase Evidence above): `trading.go:1065-1093` — set the in-memory value **first**, release the
  mutex, **then** issue the bounded DB write; on DB-write failure, do **not** roll back the in-memory
  value (fail-safe: the halt itself is never undone by a persistence hiccup — this differs from
  `validateAndRecordCredential`'s own rollback-on-failure, which is intentional per `design.md`'s
  explicit "not rolling back keeps the fail-safe direction" — do not copy that one detail).
- `LoadBrokerPool`'s boot-hydration precedent for the halt map: `trading.go:143-158` (`s.credStatus[rec.ID]
  = rec.CredentialStatus` inside the account-loading loop) — add `s.halted[rec.ID] = rec.Halted`
  (Step 2's new `BrokerAccountRecord.Halted` field) in the same loop.
- `EmitAlert` CRITICAL reuse for the halt page-the-operator step: `emitApprovalAlert`/`emitFillAlert`
  shape (`trading.go:1441-1468`) — Step 13 owns the actual bracket-failure alert; this step's halt
  transition reuses the identical `EmitAlert` call shape for its own "account halted" CRITICAL alert
  (distinct category, e.g. `"halt"`).

**TDD**: `red-green required`

**Instructions**:
1. Add `halted map[string]bool` + `haltedMu sync.Mutex` fields to `TradingService` (mirrors
   `credStatus`/`credStatusMu`); hydrate in `LoadBrokerPool` per Codebase Evidence.
2. Add `func (s *TradingService) isAccountHalted(accountID string) bool` (read under `haltedMu`).
3. Add `func (s *TradingService) haltAccount(ctx context.Context, accountID, reason string)`:
   set `s.halted[accountID] = true` under `haltedMu`, release, then
   `s.accountRepo.UpdateHaltStatus(context.Background(), accountID, true, reason, &now)` with a bounded
   timeout (mirror `validateAndRecordCredential`'s 5s budget) — log a warning on failure, do not roll
   back the in-memory flag. Fire a CRITICAL `EmitAlert` (category `"halt"`) in the same call.
4. Extract `submitOrder` per Codebase Evidence's Instruction; `PlaceOrder` becomes:
   ```go
   func (s *TradingService) PlaceOrder(ctx context.Context, req *tradingv1.PlaceOrderRequest) (*tradingv1.Order, error) {
       // ... unchanged maintenance-mode check, trailing-stop validation, resolveAccount ...
       if s.isAccountHalted(accountEntry-derived-account-id) {
           return nil, grpcstatus.Errorf(codes.FailedPrecondition, "account is halted: %s", s.haltReason(accountID))
       }
       // ... unchanged checkPortfolioRisk, mode resolution, approval-threshold computation ...
       return s.submitOrder(ctx, req, accountEntry, mode, orderID, requiresApproval)
   }
   ```
   (Insert the halt check immediately after the account-halted account ID is known — i.e., after
   `resolveAccount`, mirroring `design.md`'s "gates on `isAccountHalted` right after the existing
   maintenance-mode check" — the exact statement position relative to 023/100/101's landed rewrite must
   be re-verified at execute time, per this spec's Execution Summary rebase note.)
5. Add the identical `isAccountHalted` gate to `ReplaceOrder`, returning the same
   `FailedPrecondition` — **no reduce-only carve-out** (`design.md`'s explicit rejection: "no such
   precedent exists anywhere in this service"). Do **not** gate `CancelOrder` (`design.md`: "the
   operator's sole remaining manual de-risk tool").
6. Add `func (s *TradingService) flattenAndHalt(ctx context.Context, bracket *repository.OrderBracketRecord)`:
   resolve the account/broker for `bracket.AccountID`; build a flatten `PlaceOrderRequest` (opposite
   side of the original entry, `OrderType: MARKET`, full remaining position quantity — read the
   position quantity via `s.portfolio.GetPosition` bounded by the existing 2s risk-check timeout
   pattern); mint `ClientOrderID` once; retry `s.submitOrder(ctx, flattenReq, accountEntry, mode,
   newOrderID, false /* requiresApproval hardcoded false */)` up to `trading.order.max_retries` times
   with `trading.order.retry_delay_ms` between attempts, reusing the **same** `ClientOrderID` on every
   attempt; on success, mark the bracket row `CANCELED` (5); on exhausted retries, call
   `s.haltAccount(ctx, bracket.AccountID, fmt.Sprintf("flatten failed after protection window expiry: order %s", bracket.OrderID))`.
7. Add `func (s *TradingService) StartBracketProtectionWatchdog(ctx context.Context)`: a ticker
   (reuse `StartFillPoller`'s ticker-with-live-reloaded-interval shape, `trading.go:629-650`, tied to
   the same `trading.fill_poller.interval_ms` tick — no new config key for the watchdog's own cadence,
   piggybacking on the existing fill-poll tick per `design.md`: "each `StartFillPoller` tick"); each
   tick, `context.WithTimeout(ctx, 2*time.Second)` bounded call to
   `s.bracketRepo.ListExpiredProtection(scanCtx, time.Now())`; for each row, check+set
   `flattenInFlight[bracket.ID]` under its own mutex (skip if already in flight), then
   `go s.flattenAndHalt(context.Background(), bracket)` (detached — must outlive the bounded scan
   context), clearing the `flattenInFlight` entry in a `defer` inside the goroutine.
8. Wire `go svc.StartBracketProtectionWatchdog(ctx)` into `cmd/server/main.go` alongside the existing
   `go svc.StartFillPoller(ctx)` (`main.go:106`).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Trading-domain constraint (trading mode gate): the flatten order is submitted through the same
`submitOrder`/`buildBrokerRequest`/`resolveTradingMode` path as any other order — paper vs. live
routing is unaffected, so a flatten in paper mode never reaches a live broker and vice versa.

---

### Step 12 — test: watchdog / flatten / halt unit tests

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_bracket_test.go` — modify (created in Step 10)

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Same hand-rolled-fake technique as Step 10; additionally fakes `AccountRepository.UpdateHaltStatus`
  and `PortfolioServiceClient.GetPosition` (already faked for 023's tests per that feature's own
  `fakePortfolioClient` — extend it here or add a sibling fake, whichever avoids duplicating the
  embed-and-override pattern per the DRY guard rail).

**TDD**: `red-green required`

**Instructions**: Add:
1. `TestIsAccountHalted_GateBlocksPlaceOrderAndReplaceOrder` — a halted account; assert both `PlaceOrder`
   and `ReplaceOrder` return `FailedPrecondition`, and `CancelOrder` does **not** check the halt flag at
   all (call it on a halted account and assert it proceeds to the broker-cancel call).
2. `TestFlattenAndHalt_SucceedsOnFirstRetry` — fake broker succeeds; assert the bracket transitions to
   `CANCELED`, `haltAccount` is never called, and exactly one `ClientOrderID` was used.
3. `TestFlattenAndHalt_ExhaustsRetriesThenHalts` — fake broker fails every attempt; assert
   `max_retries` attempts occurred, all sharing the **same** `ClientOrderID` (the dedup-contract
   assertion `design.md` calls out), and `haltAccount` was called with a reason mentioning the order ID.
4. `TestHaltAccount_SetsInMemoryBeforeReleasingMutexThenWritesDB` — a fake `AccountRepository` whose
   `UpdateHaltStatus` blocks until signaled; assert `isAccountHalted` already returns `true`
   **before** the fake DB write is unblocked (proves the mutex is released before the DB round-trip,
   not held across it — the round-5-corrected ordering).
5. `TestHaltAccount_DBWriteFailureDoesNotRollBack` — fake `UpdateHaltStatus` returns an error; assert
   `isAccountHalted` still returns `true` afterward (fail-safe, no rollback).
6. `TestStartBracketProtectionWatchdog_OneSlowFlattenDoesNotBlockOthers` — two expired brackets on
   different accounts, one fake flatten blocking on a channel; assert the second account's flatten
   still completes (proves the per-row goroutine + `flattenInFlight` dedup, not a serial scan).
7. `TestLoadBrokerPool_HydratesHaltedFromDB` — a fake `AccountRepository.ListActiveBrokerAccounts`
   returning a record with `Halted: true`; assert `isAccountHalted` returns `true` immediately after
   `LoadBrokerPool` runs, with **no** prior `haltAccount` call (proves boot hydration, not a fresh
   redeploy silently un-halting the account — the exact regression `insights.md`'s 2026-08-06 030 entry
   records catching across 2 design rounds).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -run 'TestIsAccountHalted|TestFlattenAndHalt|TestHaltAccount|TestStartBracketProtectionWatchdog|TestLoadBrokerPool_HydratesHalted' -v
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 13 — service: bracket-leg cancellation on signal-driven close + CRITICAL alert

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety

**Codebase Evidence**:
- `CancelOrder`'s current body to extend (**re-verify against 100/101's landed tree** — both may also
  touch `CancelOrder`): `trading.go:387-427` — cancels the *entry* order at the broker if
  `order.BrokerOrderId != ""`. This step adds: if `bracketRepo.GetBracketByOrderID(ctx, req.OrderId)`
  returns a non-nil, `ACTIVE` bracket, best-effort-cancel both leg order IDs at the broker (log
  failures, do not block the close — `design.md`/product-spec's OQ-2: "best-effort preferred to avoid
  close-path latency") and transition the row to `CANCELED`.
- **The close-vs-stop race** (OQ-2's core concern): a position can close two ways — (a) an explicit
  `CancelOrder` before either bracket leg fills (this step), or (b) a bracket leg itself fills
  (detected by `pollFills`, Step 9). Both paths must be idempotent against each other: `CancelOrder`
  cancelling an already-filled leg is a broker no-op (Alpaca returns 422 for an already-filled order,
  already tolerated by the existing `CancelOrder` broker-cancel branch's "Continue with internal
  cancellation" comment, `trading.go:409-413`); `pollFills` detecting a leg fill on an already-CANCELED
  bracket row is a no-op guarded by the `GetBracketByOrderID` status check Step 9 Instruction 4 already
  performs.
- CRITICAL alert reuse: `emitApprovalAlert`/`emitFillAlert` (`trading.go:1441-1468`), extended with a
  new `emitBracketFailureAlert(ctx, order *tradingv1.Order, reason string)` following the identical
  `EmitAlert` call shape — `Severity: notifyv1.AlertSeverity_ALERT_SEVERITY_CRITICAL`, `Category:
  "bracket"`, `Title`/`Body` naming the position (symbol + side + qty) and the intended stop price per
  FR-6 ("log the position ID and intended stop price — the human must be notified immediately").
- `notify.proto`'s `ALERT_SEVERITY_CRITICAL = 4` (`packages/proto/notify/v1/notify.proto:47`) and the
  server's non-empty `title`/`body` validation (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:30-103`,
  per `recon.md`) — this step's alert body must never be empty (it always includes the order ID at
  minimum).

**TDD**: `red-green required`

**Instructions**:
1. Add `emitBracketFailureAlert` per Codebase Evidence; call it from Step 9's `maybeSubmitBracket`
   `FAILED` transition and from Step 2's `CreateBracket` error path (bracket row creation itself
   failing is also a bracket-submission failure per FR-6's literal wording — "If bracket order
   submission fails after the entry fill").
2. Extend `CancelOrder` per Codebase Evidence: after the existing entry-order broker-cancel block
   (`trading.go:404-414`), look up the bracket row and best-effort-cancel both legs.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 14 — test: leg cancellation + CRITICAL alert unit tests

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_bracket_test.go` — modify (created in Step 10)

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**: same fake-broker/fake-repo technique as Steps 10/12; extends the fake `notify`
client already used elsewhere in this package's tests to assert on `EmitAlert` call arguments.

**TDD**: `red-green required` — the failure-path assertions (`emitBracketFailureAlert` firing) fail
against pre-Step-13 code (the alert is never emitted on a bracket-creation or IBKR-submission
failure — this closes the gap Step 10 Instruction 6 deferred here).

**Instructions**: Add:
1. `TestCancelOrder_CancelsActiveBracketLegs` — an `ACTIVE` bracket with 2 leg IDs; assert
   `CancelOrder` (broker) called for both leg IDs, and the bracket row transitions to `CANCELED`.
2. `TestCancelOrder_NoBracketIsNoop` — no bracket row for the order → `CancelOrder` behaves exactly as
   before this feature (regression guard — the existing `TestReplaceableStateGate`-adjacent behavior
   must be unaffected for non-bracket orders).
3. `TestMaybeSubmitBracket_FailurePathEmitsCriticalAlert` — (completes Step 10 Instruction 6) fake
   `SubmitBracketLegs` errors; assert `EmitAlert` called with `Severity: ALERT_SEVERITY_CRITICAL`,
   non-empty `Title`/`Body`, and the body contains the order's symbol.
4. `TestCreateBracket_FailureEmitsCriticalAlert` — fake `BracketRepository.CreateBracket` returns an
   error; assert the same CRITICAL alert fires even though no broker call was ever attempted.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -run 'TestCancelOrder_CancelsActiveBracketLegs|TestCancelOrder_NoBracketIsNoop|TestMaybeSubmitBracket_FailurePathEmitsCriticalAlert|TestCreateBracket_FailureEmitsCriticalAlert' -v
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in `internal/service`, excluded from Go coverage `COVERPKGS` (Step 3's citation) — the
functional test run above (Steps 10, 12, 14 combined) is the required proof for this feature's entire
`internal/service` surface.

---

### Step 15 — docs: update `xstockstrat-trading/CLAUDE.md`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- "Config Keys Consumed" table location and row format: `services/xstockstrat-trading/CLAUDE.md`
  (existing `trading.risk.max_position_pct` row).
- "Ledger Events Emitted" table location and row format (same file) — add `order.bracket_updated`.
- "Database" section already documents the `trading.orders` hypertable and `trading.broker_accounts`
  table — extend with `trading.order_brackets`.

**TDD**: `N/A (docs)`

**Instructions**:
1. Add three rows to "Config Keys Consumed": `trading.risk.bracket_orders_enabled` (bool, `true` dev/staging — **`false` in production** per Step 16's seed, see below), `trading.risk.take_profit_rr_multiple` (float, `2.0`, "Reward-to-risk multiple for the take-profit leg; `0` disables it"), `trading.risk.max_unprotected_seconds` (int, `30`, "Provisional default — see Step 9's Codebase Evidence; bounds how long an auto-sized position may remain without a confirmed bracket before an automatic flatten+halt").
2. Add a row to "Ledger Events Emitted": `order.bracket_updated | order:{order_id} | Bracket leg order IDs assigned/cleared (feature 030)`.
3. Add a short paragraph near the top (mirroring the existing "Paper vs live" style) documenting the
   bracket state machine, the per-account halt gate (`PlaceOrder`/`ReplaceOrder` blocked, `CancelOrder`
   never gated), and the production-flag deviation (Step 16).
4. Add `trading.order_brackets` to the "Database" section's table list, one line, mirroring the existing
   `trading.broker_accounts` description.

**Verification**:
```bash
grep -n "bracket_orders_enabled\|take_profit_rr_multiple\|max_unprotected_seconds\|order.bracket_updated\|order_brackets" services/xstockstrat-trading/CLAUDE.md
```
Confirm all five strings appear.

---

### Step 16 — migration: `xstockstrat-config` seed `trading.risk.bracket*`/`max_unprotected_seconds`

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/013_trading_risk_bracket.up.sql` — create
- `services/xstockstrat-config/migrations/013_trading_risk_bracket.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present; `xstockstrat-config` owner — config
key naming, environment/trading_mode scoping

**Codebase Evidence**:
- Last migration on disk: `010_config_audit_insert_trigger.{up,down}.sql` → naive next would be `011`,
  but `011_platform_trading_state` is claimed by feature 100's `implementation-spec.md` Step 1 (direct
  read: `docs/roadmap/features/100-account-trading-halt-and-kill-switch/implementation-spec.md:108-110`)
  and `012_trading_risk_sizing` is claimed by feature 023's `implementation-spec.md` Step 1 (direct
  read: `docs/roadmap/features/023-position-sizing-engine/implementation-spec.md:57-58`) — this
  supersedes `recon.md`'s stale `011` guess, which predates both of those specs. `013` is the next
  unclaimed number confirmed against `docs/roadmap/features/merge-order.md`'s recorded assignments.
  **Re-verify against the live `migrations/` directory at execute time per C-07** in case a newer
  feature has since claimed `013`.
- Seed-pattern template (per-env `dev`+`production`, `trading_mode='all'`, `ON CONFLICT ... DO
  NOTHING`): `services/xstockstrat-config/migrations/008_analysis_fundsignal_keys.up.sql:1-30`.
- Unique constraint the `ON CONFLICT` targets: `services/xstockstrat-config/migrations/002_config_environment.up.sql:20-21`.
- **Production deviation from the product spec's literal default** (`design.md` § Rejected
  Alternatives, "Ship the production `bracket_orders_enabled` flag defaulting `true`" — rejected): seed
  `bracket_orders_enabled = true` for `dev`, **`false` for `production`**, pending feature 103
  (broker-failure-simulator) or a documented manual paper-trading verification per
  `docs/runbooks/config-rollout.md`. This is a deliberate, named override of `product-spec.md`'s FR-7
  literal default ("default: true in prod"), not a silent contradiction — recorded here and in
  `context.md`.

**TDD**: `N/A (migration — no code path executes this file directly)`

**Instructions**:
1. Create `013_trading_risk_bracket.up.sql`:
   ```sql
   -- Migration: 013_trading_risk_bracket.sql
   -- Service: xstockstrat-config
   -- Feature 030 (stop-loss-bracket-orders). NOTE: numbered 013 — 011 is
   -- feature 100 (platform_trading_state), 012 is feature 023 (trading_risk_sizing).
   -- bracket_orders_enabled seeds FALSE in production (not the product spec's literal
   -- `true` default) pending feature 103 or a documented manual paper verification —
   -- see design.md § Rejected Alternatives.
   INSERT INTO config.config_values
     (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
   VALUES
     ('trading', 'risk.bracket_orders_enabled', 'bool', 'true', 'Master gate for automatic stop-loss/take-profit bracket orders on auto-sized entries', 'true', 'xstockstrat-trading', 'dev', 'all'),
     ('trading', 'risk.bracket_orders_enabled', 'bool', 'false', 'Master gate for automatic stop-loss/take-profit bracket orders on auto-sized entries — FALSE pending feature 103 or a documented manual verification', 'false', 'xstockstrat-trading', 'production', 'all'),

     ('trading', 'risk.take_profit_rr_multiple', 'float', '2.0', 'Reward-to-risk multiple for the take-profit leg; 0 disables the take-profit leg', '2.0', 'xstockstrat-trading', 'dev', 'all'),
     ('trading', 'risk.take_profit_rr_multiple', 'float', '2.0', 'Reward-to-risk multiple for the take-profit leg; 0 disables the take-profit leg', '2.0', 'xstockstrat-trading', 'production', 'all'),

     ('trading', 'risk.max_unprotected_seconds', 'int', '30', 'Provisional default — max seconds an auto-sized position may remain without a confirmed bracket before automatic flatten+halt', '30', 'xstockstrat-trading', 'dev', 'all'),
     ('trading', 'risk.max_unprotected_seconds', 'int', '30', 'Provisional default — max seconds an auto-sized position may remain without a confirmed bracket before automatic flatten+halt', '30', 'xstockstrat-trading', 'production', 'all')
   ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
   ```
2. Create `013_trading_risk_bracket.down.sql`:
   ```sql
   DELETE FROM config.config_values
   WHERE namespace = 'trading'
     AND key IN ('risk.bracket_orders_enabled', 'risk.take_profit_rr_multiple', 'risk.max_unprotected_seconds');
   ```

**Verification**:
```bash
ls services/xstockstrat-config/migrations/013_trading_risk_bracket.up.sql services/xstockstrat-config/migrations/013_trading_risk_bracket.down.sql
```
Read both files: confirm every `INSERT` (6 rows) is reversible by the single `DELETE ... key IN (...)`,
and that `trading.risk.max_position_pct`/`trading.risk.max_risk_per_trade_pct`/`atr_multiplier`/
`max_concentration_pct`/`sizing_enabled` (023's keys) never appear in either file.

---

### Step 17 — docs: register the new keys in the Per-Feature Registered Keys log

**Status**: `pending`
**Service**: `docs/patterns/`
**Files**:
- `docs/patterns/config-governance.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Log location and "newest first" convention: `docs/patterns/config-governance.md:35-37`.
- Existing entry format to mirror: the feature-097 entry immediately below the heading (narrative
  paragraph + a `| Key | Type | Default | Description |` table).

**TDD**: `N/A (docs)`

**Instructions**: Insert immediately below the `## Per-Feature Registered Keys` heading (above the
existing newest entry):
```markdown
### feature 030 — stop-loss-bracket-orders (`xstockstrat-trading`)

Automatic stop-loss/take-profit bracket orders for auto-sized entries (feature 023). Alpaca attaches
brackets atomically at entry submission; IBKR submits the legs as a follow-up linked pair after fill
confirmation. `bracket_orders_enabled` seeds `false` in production pending feature 103 or a documented
manual paper verification — see `030/design.md` § Rejected Alternatives.

| Key | Type | Default | Description |
|---|---|---|---|
| `trading.risk.bracket_orders_enabled` | bool | `true` dev / **`false` production** | Master gate for bracket submission |
| `trading.risk.take_profit_rr_multiple` | float | `2.0` | Reward-to-risk multiple for the take-profit leg; `0` disables it |
| `trading.risk.max_unprotected_seconds` | int | `30` (provisional) | Max seconds an auto-sized position may go without a confirmed bracket before automatic flatten+halt |
```

**Verification**:
```bash
grep -n "feature 030 — stop-loss-bracket-orders" docs/patterns/config-governance.md
```

---

### Step 18 — proto: `Position` gains `stop_order_id`/`take_profit_order_id`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/portfolio/v1/portfolio.proto` — modify
- `packages/proto/gen/go/portfolio/v1/` — modify (regenerated)
- `packages/proto/gen/python/portfolio/v1/` — modify (regenerated)
- `packages/proto/gen/ts/portfolio/v1/` — modify (regenerated)

**Reviewers**: Proto Reviewer — field number uniqueness, `buf lint`/`buf breaking` pass;
`xstockstrat-portfolio` owner — field consumed correctly

**Codebase Evidence**:
- Current highest field on `Position` is `exit_rule = 19` (`packages/proto/portfolio/v1/portfolio.proto:75`) — confirmed no other in-flight feature claims 20/21 (`recon.md`'s field-number check; no `merge-order.md` row names `portfolio.proto` field collisions for this range).
- `product-spec.md`'s Proto Contract Changes section (additive, non-breaking) and its reconciliation
  note: the existing `stop_price` (field 14, feature 083, ledger-derived, in-memory-only estimate) and
  the new `stop_order_id`/`take_profit_order_id` (persisted, broker-confirmed) are **deliberately
  distinct** — `design.md`'s Rejected Alternatives confirms trading's own `order_brackets` table is
  the safety-critical source of truth; portfolio's copy is display-only.

**TDD**: `N/A (proto — additive fields, no runtime behavior in this repo until Step 20 reads them)`

**Instructions**:
1. In `packages/proto/portfolio/v1/portfolio.proto`, inside `message Position` (after `string
   exit_rule = 19;`), add:
   ```protobuf
   // stop_order_id / take_profit_order_id are the broker-confirmed bracket leg order IDs
   // (feature 030), populated asynchronously via the trading service's order.bracket_updated
   // ledger event. Distinct from stop_price (field 14) above, which is a ledger-derived,
   // in-memory estimate — these two fields are deliberately not unified (see
   // docs/roadmap/features/030-stop-loss-bracket-orders/product-spec.md's reconciliation note).
   // Empty = no active bracket for this position.
   string stop_order_id = 20;
   string take_profit_order_id = 21;
   ```
2. From repo root: `./scripts/buf-gen.sh`.
3. `git add` the modified `.proto` file and every regenerated file under
   `packages/proto/gen/{go,python,ts}/portfolio/v1/`.

**Verification**:
```bash
cd packages/proto && buf lint .
buf breaking . --against "../../.git#branch=feature/stop-loss-bracket-orders,subdir=packages/proto"
cd ../..
./scripts/buf-gen.sh
git diff --stat packages/proto/gen/
```

---

### Step 19 — migration: `xstockstrat-portfolio` `stop_order_id`/`take_profit_order_id` columns

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/009_bracket_order_ids.up.sql` — create
- `services/xstockstrat-portfolio/migrations/009_bracket_order_ids.down.sql` — create

**Reviewers**: DBA — migration NNN numbering; `xstockstrat-portfolio` owner — position snapshot
consistency

**Codebase Evidence**:
- Last migration on disk: `008_watchlist_symbol_strategy.{up,down}.sql` → next is `009` — no
  `merge-order.md` row claims this number for portfolio.
- `portfolio.positions` table (target for the `ALTER TABLE`) confirmed via `positionColumns`'s column
  list (`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:225`) and prior migration
  precedent for additive nullable columns: `services/xstockstrat-portfolio/migrations/005_positions_broker_valuation.up.sql`, `006_positions_day_pnl.up.sql` (both `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... NUMERIC ... DEFAULT 0`-style; this feature's columns are nullable `TEXT`, matching product-spec's "nullable; additive migration").

**TDD**: `N/A (migration)`

**Instructions**:
1. Create `009_bracket_order_ids.up.sql`:
   ```sql
   -- Migration: 009_bracket_order_ids.sql
   -- Service: xstockstrat-portfolio
   -- Feature 030: display-only bracket leg order IDs, populated asynchronously from
   -- trading's order.bracket_updated ledger event.
   ALTER TABLE portfolio.positions
       ADD COLUMN IF NOT EXISTS stop_order_id        TEXT,
       ADD COLUMN IF NOT EXISTS take_profit_order_id  TEXT;
   ```
2. Create `009_bracket_order_ids.down.sql`:
   ```sql
   ALTER TABLE portfolio.positions
       DROP COLUMN IF EXISTS stop_order_id,
       DROP COLUMN IF EXISTS take_profit_order_id;
   ```

**Verification**:
```bash
ls services/xstockstrat-portfolio/migrations/009_bracket_order_ids.up.sql services/xstockstrat-portfolio/migrations/009_bracket_order_ids.down.sql
```

---

### Step 20 — service: `positionColumns`/`scanPositionRow` + `ConsumeBracketUpdates` consumer

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `positionColumns`/`scanPositionRow` — the single shared column list already proven to back
  `GetPosition`, `ListPositions`, and `ListPositionsByAccount` uniformly (`design.md`'s **C-10**
  citation, confirmed structurally sound): `portfolio_repo.go:195-225` (`scanPositionRow`), `:225`
  (`positionColumns` const, used at `:63,115,378,385`).
- Ledger-consumption precedent to mirror exactly (DB-persisted, not the in-memory-only `stopStore`
  pattern — product-spec explicitly wants persisted columns): `ConsumePositionSyncs`/
  `processPositionSync` (`portfolio_service.go:850-898`), which calls
  `s.repo.UpsertPositionFromSync(...)` from a live `StreamEvents` subscription via the shared
  `consumeEventStream` helper (`portfolio_service.go:156-173`).
- New event this consumer subscribes to: `order.bracket_updated`, emitted by Step 9's trading changes
  — payload shape `{"user_id", "account_id", "symbol", "trading_mode", "stop_order_id",
  "take_profit_order_id"}` (Step 9 Instruction 6). An empty string for either ID means "cleared" (the
  bracket was canceled) — this consumer must null out the corresponding column, not skip the update.
- `UpsertPositionFromSync`'s upsert-by-`(user_id, symbol, trading_mode, account_id)` targeting to
  mirror for the new repo method: `portfolio_repo.go:247` signature.

**TDD**: `red-green required`

**Instructions**:
1. In `portfolio_repo.go`: extend `positionColumns` to include `stop_order_id, take_profit_order_id`;
   extend `scanPositionRow` to scan them into `Position.StopOrderId`/`TakeProfitOrderId` (nullable
   `sql.NullString`→`""` when NULL, matching this file's existing null-handling idiom for other
   nullable columns — grep the existing `sql.NullString`/`COALESCE` usage in this file and follow it).
   Add:
   ```go
   func (r *PortfolioRepo) UpdatePositionBracket(ctx context.Context, userID, symbol, tradingMode, accountID, stopOrderID, takeProfitOrderID string) error {
       _, err := r.pool.Exec(ctx, `
           UPDATE portfolio.positions
           SET stop_order_id = NULLIF($5, ''), take_profit_order_id = NULLIF($6, '')
           WHERE user_id = $1 AND symbol = $2 AND trading_mode = $3 AND account_id = $4
       `, userID, symbol, tradingMode, accountID, stopOrderID, takeProfitOrderID)
       return err
   }
   ```
2. In `portfolio_service.go`: add `bracketUpdatePayload` struct (mirrors `orderFillPayload`/
   `positionSyncPayload`'s shape) and:
   ```go
   func (s *PortfolioService) ConsumeBracketUpdates(ctx context.Context) {
       s.consumeEventStream(ctx, "bracket update", "order.bracket_updated", s.processBracketUpdate)
   }

   func (s *PortfolioService) processBracketUpdate(ctx context.Context, event *ledgerv1.LedgerEvent) {
       // parse payload (mirror processPositionSync's MarshalJSON/Unmarshal shape), then:
       if err := s.repo.UpdatePositionBracket(ctx, upd.UserID, upd.Symbol, upd.TradingMode, upd.AccountID, upd.StopOrderID, upd.TakeProfitOrderID); err != nil {
           slog.Warn("update position bracket failed", "symbol", upd.Symbol, "error", err)
       }
   }
   ```
3. Wire `go svc.ConsumeBracketUpdates(ctx)` into `cmd/server/main.go` alongside the existing
   `go svc.ConsumeOrderFills(ctx)` / `go svc.ConsumePositionSyncs(ctx)` calls (grep for their call sites
   and add the new goroutine in the same block).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./...
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 21 — test: portfolio bracket-consumer + repo tests

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_bracket_test.go` — create

**Reviewers**: `xstockstrat-portfolio` owner

**Codebase Evidence**:
- Existing pure-function test pattern for a `process*` handler (avoids needing a live ledger stream):
  grep this service's existing tests for `processOrderFill`/`processPositionSync` coverage (if present)
  or, if none exists, follow the same technique 023/030's trading-side tests use — call
  `processBracketUpdate` directly with a hand-constructed `*ledgerv1.LedgerEvent{Payload: <structpb>}`
  against a `PortfolioService{repo: <fake-or-real-in-memory>}`. Since `PortfolioService.repo` is a
  concrete `*repository.PortfolioRepo` (not an interface) — mirroring `xstockstrat-trading`'s identical
  concrete-`*TradingRepo` limitation (Step 3's citation) — this test proves the JSON-parsing/field-
  mapping logic (`processBracketUpdate`'s payload → `UpdatePositionBracket` call arguments) via a thin
  seam, not a live DB; DB-level correctness is proven by Step 19's migration + real deploy, matching
  this spec's Step 3 precedent for the identical concrete-repo constraint.

**TDD**: `red-green required` — fails against pre-Step-20 code (`processBracketUpdate` does not exist).

**Instructions**: Add `TestProcessBracketUpdate_ParsesPayloadAndClearsEmptyIDs` (or the closest
achievable seam given the concrete-repo constraint above — if `processBracketUpdate` cannot be
isolated from `r.pool.Exec` without an interface, extract the **payload-parsing** portion into a pure
helper `parseBracketUpdatePayload(*structpb.Struct) (bracketUpdatePayload, error)` and unit-test that
directly, mirroring `enrichPositionRisk`'s existing pure-helper-extraction pattern
(`portfolio_service.go:349`) — state explicitly which approach was taken and why in this step's
Deviation Log entry if it differs from the literal test name above). Assert: a payload with both IDs
set parses correctly; a payload with `stop_order_id: ""` is distinguishable from one where the field is
absent (both should map to "clear"); trading-mode string mapping matches `processOrderFill`'s existing
`"TRADING_MODE_LIVE"` convention (`portfolio_service.go:246-249`).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/... -race -run TestProcessBracketUpdate -v
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
`internal/service` is excluded from Go coverage `COVERPKGS` (same exclusion regex as trading) — this
functional test run is the required proof.

---

### Step 22 — docs: update `xstockstrat-portfolio/CLAUDE.md`

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- "Ledger Events Consumed" table location/format: `services/xstockstrat-portfolio/CLAUDE.md` (existing
  `order.filled`/`account.positions.synced` rows).
- "Database" section already documents `portfolio.positions`' existing broker-valuation/day-P&L
  columns from migrations 005/006 — extend with migration 009's two columns.

**TDD**: `N/A (docs)`

**Instructions**:
1. Add a row to "Ledger Events Consumed": `order.bracket_updated | ConsumeBracketUpdates (live stream) | Upsert stop_order_id/take_profit_order_id from trading's bracket state machine (feature 030); empty string clears`.
2. Extend the `portfolio.positions` bullet in "Database" to mention `stop_order_id`/
   `take_profit_order_id` (migration `009`), noting they are display-only and distinct from the
   existing ledger-derived, in-memory `stop_price`/`risk_at_stop` (feature 083).

**Verification**:
```bash
grep -n "order.bracket_updated\|stop_order_id" services/xstockstrat-portfolio/CLAUDE.md
```

---

### Step 23 — service + test: position-detail sidebar + e2e coverage

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/e2e/fixtures/positions.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify (`/sdd-review` impl-spec
  confirmed via `find services/xstockstrat-ui/e2e/trader -iname "*position*"`, 2026-08-06: this is
  the dedicated single-Position detail-page spec — `test.describe('Single Position page', ...)` —
  that exercises the `getPosition` mock and `page.tsx` sidebar this step modifies.
  `positions.spec.ts` is the disjoint **list**-page spec — `'Positions — Exposure risk'` — and is not
  the correct target)

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, config mutation safety (N/A here — no
config mutation), no secret values rendered

**Codebase Evidence — Consumer surface (Constitution C-14, product-spec.md `## Consumer Surface(s)`
item 2)**:
- Insertion point: the existing "Risk & exit" sidebar `Card` (`page.tsx:409-447`), which already
  renders `position.stopPrice`/`position.riskAtStop`/`position.exitRule` via the `Row` helper
  (`page.tsx:429-444`) — add two more `Row`s for `stopOrderId`/`takeProfitOrderId` immediately after
  the existing "Exit rule" row (`page.tsx:432-434`), rendering the em-dash fallback pattern already
  used throughout this block (`position.exitRule || '—'`) when the field is empty.
- **C-13 fixture reuse (second consumer)**: `POSITION_AAPL`/`POSITION_MSFT`
  (`e2e/fixtures/positions.ts:15-48`) already back both the `listPositions` mock (Exposure list) and
  the `getPosition` mock (this Position page) — a second consumer already exists for this fixture, so
  the new `stopOrderId`/`takeProfitOrderId` fields must be added to the fixture objects themselves
  (never a new inline literal in the spec file), plus a note in `INVENTORY.md` (existing catalog
  convention, per `recon.md`'s citation).
- Shape source comment at the top of `positions.ts` (`:6-9`) already states "Shape source:
  `xstockstrat.portfolio.v1.Position`" — update it to note the two new fields once Step 18/20 land.

**TDD**: `red-green required`

**Instructions**:
1. In `page.tsx`'s "Risk & exit" `CardContent` `dl`, after the existing `Row label="Exit rule"`
   block (`page.tsx:432-434`), add:
   ```tsx
   <Row label="Stop order" valueClass="font-mono text-xs">
     {position.stopOrderId || '—'}
   </Row>
   <Row label="Take-profit order" valueClass="font-mono text-xs">
     {position.takeProfitOrderId || '—'}
   </Row>
   ```
2. In `e2e/fixtures/positions.ts`: add `stopOrderId: 'bracket-stop-aapl-1', takeProfitOrderId:
   'bracket-tp-aapl-1'` to `POSITION_AAPL` (alongside its existing feature-083 risk fields); leave
   `POSITION_MSFT` without the fields (it already exercises the "no risk metadata" fallback path per
   its doc comment — extending this to the em-dash bracket-ID fallback too is a natural, zero-cost
   reuse of that existing intent).
3. Update `INVENTORY.md`'s `POSITION_AAPL`/`POSITION_MSFT` catalog row(s) to note the two new fields.
4. In `e2e/trader/position-detail.spec.ts`, add an assertion that the AAPL detail page renders
   `bracket-stop-aapl-1` and `bracket-tp-aapl-1` under "Risk & exit", and that the MSFT detail page
   renders the em-dash fallback for both.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e e2e/trader/position-detail.spec.ts
```
Test-data inventory (C-12): fixtures reused per Codebase Evidence above (`grep -n "POSITION_AAPL"
services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` confirms the import, not an inline
literal); `INVENTORY.md` updated in this same step per Instruction 3.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
