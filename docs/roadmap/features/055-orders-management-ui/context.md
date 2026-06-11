# Context: orders-management-ui

**Feature**: `docs/roadmap/features/055-orders-management-ui/feature.md`
**Product Spec**: `docs/roadmap/features/055-orders-management-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/055-orders-management-ui/implementation-spec.md`

---

## Session 2026-06-10 — backlog capture

- Created feature.md at `idea` status as a backlog entry.

## Session 2026-06-10 — sdd-story

- Upgraded feature.md `idea` → `draft`; wrote product-spec.md and this context log.
- Codebase grounding (not invented — found via grep):
  - `packages/proto/trading/v1/trading.proto` `TradingService` already has `PlaceOrder`,
    `CancelOrder`, `GetOrder`, `ListOrders` (paginated via `PageRequest`/`PageResponse`,
    filters: `status`, `range`, `strategy_id`, `trading_mode`), `StreamOrderUpdates`.
  - **No `ReplaceOrder`/`UpdateOrder` RPC exists** → "edit" requires a new additive RPC.
  - `ListOrdersRequest` lacks symbol/side/order_type filters → additive fields needed.
  - UI has `trader/orders/[id]/page.tsx` (detail) but **no `trader/orders/page.tsx`**
    list/create page.
  - Trading already persists orders (phase4-deviations: dual in-memory+DB) → no migration.
- Decision: keep all proto changes additive (no breaking change, single-owner gate).

## Session 2026-06-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Open questions resolved (user decisions):
  - Replace/edit broker scope → **Alpaca + IBKR** (broker-agnostic proto, route by
    `broker_type`; per-broker replaceable-field matrix deferred to /sdd-spec).
  - Create form order types → **all five** (MARKET/LIMIT/STOP/STOP_LIMIT/TRAILING_STOP).
  - Live updates → **StreamOrderUpdates** (BFF-bridged), not polling.
  - Filters → **server-side**; add additive `account_id` filter field too.
- Trading-domain gaps closed in spec: C-4 (enumerate 5 order types), C-2 (state Alpaca+IBKR
  broker scope), C-5 (explicit PARTIALLY_FILLED vs FILLED handling → new FR-8), C-3
  (paper-safe statement in FR-7).
- Overlap: `002-broker-accounts-ui` (launched) also touches `trading.proto` — coordination
  note only, no live conflict.
- Warnings: none blocking.

## Session 2026-06-11 — sdd-spec

- Generated implementation-spec.md with 11 steps. Status → implementation-ready.
- Key codebase findings (all grep/Read-confirmed, none invented):
  - Proto `ListOrdersRequest` (trading.proto L109–L117) uses field numbers 1–6; next free
    is 7 → add `symbol=7`, `side=8`, `order_type=9`, `account_id=10`. `ReplaceOrder` RPC +
    `ReplaceOrderRequest` added additively; return type is existing `Order`. No breaking change.
  - **No `ReplaceOrder` anywhere today**: not on `broker.Broker` interface (broker.go L40–L55),
    not on the service (trading.go), not in the BFF. Replace requires: (1) a new `Broker`
    interface method implemented by both `alpaca.go` (PATCH /v2/orders/{id}) and `ibkr.go`
    (POST .../order/{orderId} modify) — both have `var _ Broker = ...` conformance asserts;
    (2) a service method modeled on `CancelOrder` (trading.go L329–L369) using `resolveAccount`
    (L159–L180) to route per `broker_type` — covers Alpaca **and** IBKR with no broker switch.
  - Fill-state gate (FR-8): replaceable = `NEW`/`PARTIALLY_FILLED`; terminal = FILLED/CANCELED/
    EXPIRED/REJECTED (proto L65–L74). `broadcastOrder` (trading.go L202–L211) already pushes to
    `StreamOrderUpdates` subscribers — reuse for live replace/cancel reflection.
  - `repo.ListOrders` (trading_repo.go L92–L145) is a dynamic positional-arg WHERE builder;
    `sideStr`/`typeStr` (L239–L259) already map enums→DB strings → additive filter clauses.
    Note: the existing `strategy_id` branch (L124–L127) doesn't `i++`; must fix when appending.
  - UI: **no `trader/orders/page.tsx`** (only `[id]` detail page exists). `OrderForm.tsx`
    supports only 4 types and has no stop-price input → must add TRAILING_STOP + stop_price
    (FR-3). `traderBff.ts` (L34–L77) registers Trading RPCs but **not** `replaceOrder` or
    `streamOrderUpdates`; `streamAlerts` (L102–L108) is the `async *` streaming precedent;
    `AlertStream.tsx` (L20–L39) is the browser AbortController stream-consume precedent.
    Handler map keyed `PREFIX('/trader/api') + requestPath` — `router.service` registration
    is enough, no map edit.
  - Deployment parity already correct: `TRADING_MODE` = paper (compose x-common-env L17 +
    .do/app.dev.yaml L28) / live (.do/app.yaml L28); `TRADING_ENDPOINT` wired for UI in all
    three files. **No new env vars, ports, config keys, or DB migration** (last migration is
    `004_broker_accounts_credential_status`; replace updates an existing row).
- Reviewers snapshot (3 distinct): Proto Reviewer, `xstockstrat-trading`, `xstockstrat-ui` —
  unchanged from the spec-ready snapshot.

## Next action

`/sdd-execute orders-management-ui` (or `/sdd-execute orders-management-ui all`).

## Session 2026-06-11 — sdd-review impl-spec (Mode B, advisory)

- Ran `/sdd-review orders-management-ui impl-spec`. **PASS** — no FAIL findings across all 11
  steps. Per-step: codebase evidence populated w/ line numbers, exact paths, runnable
  verification, proto step has buf lint+breaking + stated field numbers (7–10), backend
  steps (3,4,5) paired with test step 6 (Go ≥40% + golangci-lint), UI step 9 paired with
  E2E step 10, header propagation addressed (Step 7 backendHeaders). Trading-domain per-step
  all satisfied (5 order types, both broker paths tested, fill-state partial+full, paper-safe).
- Cross-feature overlap (B4): ⚠ WARN — 055 and 056 both modify
  `services/xstockstrat-ui/src/lib/traderBff.ts`. No FAIL-level overlap (proto files disjoint:
  trading vs portfolio; no migration/config collisions).
- Merge order recorded in `merge-order.md`: **056 (open-positions-ui) waits for 055** — 055
  merges first, 056 rebases the traderBff.ts conflict. Soft/rebase dependency.
- Mode B makes no lifecycle change; status stays `implementation-ready`.

## Session 2026-06-11 — sdd-execute (sequential mode)

Running `/sdd-execute "055, 056, 057" sequential`. User chose "one feature at a time":
authorized SDD branch model (feature/* + feature-steps/*), execute 055 only this session,
then stop for review before 056/057. Codegen toolchain installed on host (buf 1.70.0,
protoc-gen-go@v1.36.11, protoc-gen-go-grpc@v1.6.2, protoc-gen-connect-go@v1.19.2,
grpcio-tools==1.80.0 — pinned to CI proto-freshness versions) since buf/protoc absent on PATH.

### Step 1 — proto: Add ReplaceOrder RPC and additive ListOrdersRequest filters [done]
- Added `rpc ReplaceOrder(ReplaceOrderRequest) returns (Order)` to TradingService, four
  additive `ListOrdersRequest` filter fields (symbol=7, side=8, order_type=9, account_id=10),
  and the `ReplaceOrderRequest` message. All additive — `buf lint` + `buf breaking` (against
  feature/orders-management-ui baseline) both pass.
- Files modified: `packages/proto/trading/v1/trading.proto`
- Deviations: none

### Step 2 — proto-gen: Regenerate Go / Python / TS stubs [done]
- Ran `./scripts/buf-gen.sh` (after `pnpm --filter @xstockstrat/proto install` to provide the
  TS protoc plugins). Regenerated Go (trading.pb.go, trading_grpc.pb.go, tradingv1connect),
  Python (trading_pb2.py, trading_pb2_grpc.py), and TS (trading.ts/_pb.ts/_connect.ts + dist)
  stubs. `ReplaceOrder` + `symbol`/`side`/`orderType`/`accountId` filters present in all three
  languages; git diff scoped to trading/v1 only (mirrors CI proto-freshness stale-stub check).
- Files modified: regenerated stubs under `packages/proto/gen/{go,python,ts}/trading/v1/`
- Deviations: none (codegen toolchain installed on host per sequential-mode fallback; see session header)

### Step 3 — service: Add ReplaceOrder to broker interface + Alpaca/IBKR adapters [done]
- Added `ReplaceOrder(ctx, brokerOrderID, OrderRequest) (*BrokerOrder, error)` to the `Broker`
  interface. Alpaca impl: `PATCH /v2/orders/{id}` with omit-when-zero qty/limit_price/stop_price
  and omit-when-empty time_in_force (mirrors SubmitOrder). IBKR impl: modify `POST
  /iserver/account/{acct}/order/{id}` with quantity/price/auxPrice/tif set only when changed,
  signed Authorization (mirrors SubmitOrder/CancelOrder); netting-mode caveat documented in-code.
  `var _ Broker = ...` assertions confirm both adapters conform. `GOWORK=off go build ./...` OK.
- Files modified: `services/xstockstrat-trading/internal/broker/{broker.go,alpaca.go,ibkr.go}`
- Deviations: none
