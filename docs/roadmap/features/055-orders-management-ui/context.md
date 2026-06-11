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

### Step 4 — service: Thread ListOrders filters through the repository [done]
- Widened `TradingRepo.ListOrders` to accept symbol/side/orderType/accountID and appended four
  guarded WHERE clauses (symbol/account_id raw; side via sideStr; order_type via typeStr), and
  added the missing `i++` to the strategy_id branch so positional args stay aligned.
- Files modified: `internal/repository/trading_repo.go`, `internal/service/trading.go` (call-site one-liner)
- Deviations: updated the single caller (service/trading.go:387) to pass the new filter args so
  `go build ./...` stays green — see Deviation Log (sequential-mode blocker resolved with user, Option A).

### Step 5 — service: Implement ReplaceOrder + wire ListOrders filters and handler [done]
- `TradingService.ReplaceOrder` modeled on CancelOrder: in-mem→DB lookup (NotFound), FR-8
  fill-state gate (NEW/PARTIALLY_FILLED only → else FailedPrecondition), requires broker_order_id,
  resolveAccount routing (Alpaca+IBKR), broker ReplaceOrder with only-changed fields, local field
  update, UpsertOrder, `order.replaced` ledger event, broadcastOrder. ListOrders now applies the
  four new filters in the in-memory fallback and paginates both branches via a new
  `paginateOrders` helper (page_token = numeric offset; sets PageResponse total_count/next_page_token).
  Handler + gRPC adapter ReplaceOrder added; error codes preserved (connectCodeFromErr + new
  FailedPrecondition case in toGRPCError). `GOWORK=off go build ./...` OK.
- Files modified: `internal/service/trading.go`, `internal/handler/trading.go`
- Deviations: handler preserves NotFound/FailedPrecondition codes (vs CancelOrder's CodeInternal);
  pagination uses the proto's token model (no offset field). See Deviation Log.

### Step 6 — test: trading replace, filters, and fill-state coverage [done]
- Added TestReplaceOrder_Alpaca (PATCH /v2/orders/{id}, only-changed fields, parsed response),
  TestReplaceOrder_IBKR (modify POST .../order/{id}, signed Authorization, second-broker path),
  TestReplaceableStateGate (FR-8: NEW/PARTIALLY_FILLED allowed, FILLED/terminal rejected),
  TestListOrdersInMemoryFilters (each dimension narrows + composes), and TestPaginateOrders
  (exercises the real service paginateOrders helper). All pass; total coverage 48.3% (≥40%);
  golangci-lint 0 issues.
- Files modified: `internal/broker/{alpaca_test.go,ibkr_test.go}`,
  `internal/service/trading_helpers_test.go`, `internal/repository/trading_repo.go` (lint fix)
- Deviations: dropped a dead `i++` in trading_repo.go (Step 4 code) flagged by the Step 6 lint
  gate — see Deviation Log.

### Step 7 — service: Register replaceOrder + streamOrderUpdates in the trader BFF [done]
- Added `replaceOrder` (mirrors cancelOrder; injects verified session userId so a client cannot
  replace another user's order) and `streamOrderUpdates` async generator (mirrors streamAlerts;
  forwards backendHeaders + ctx.signal) to the TradingService block in traderBff.ts. No handlerMap
  change needed (router.service registration is auto-picked up). `pnpm run lint` clean; `tsc
  --noEmit` clean (client exposes both methods from the regenerated stubs).
- Files modified: `services/xstockstrat-ui/src/lib/traderBff.ts`
- Deviations: none

### Step 8 — service: Browser hooks for replace, cancel, filtered list, live updates [done]
- Extended useOrders with an optional OrderFilters object (symbol/side/orderType/accountId +
  status/range/pageSize/pageToken) forwarded to listOrders and added to the queryKey. Created
  useReplaceOrder + useCancelOrder (mutations mirroring usePlaceOrder, invalidating ['orders'] and
  ['order', id]) and useOrderUpdates (AbortController stream consumer merging pushed Order updates
  keyed by orderId, mirroring AlertStream). `pnpm run lint` + `tsc --noEmit` clean.
- Files modified: `src/hooks/useOrders.ts`; created `useReplaceOrder.ts`, `useCancelOrder.ts`, `useOrderUpdates.ts`
- Deviations: OrderFilters also carries status+range (existing request fields) so Step 9's FR-2
  filters are unblocked — see Deviation Log.

### Step 9 — service: trader/orders page with edit, cancel, live feed [done]
- Extended OrderForm with the 5th order type (trailing_stop) + a stop-price input
  (shown/required for stop/stop_limit/trailing_stop). Created OrderFilters (symbol/side/type/
  status/date-range, server-side), OrdersTable (paginated, per-row Edit/Cancel disabled on
  terminal status, two-step cancel confirm, merges useOrderUpdates live feed), EditOrderDialog
  (Sheet → useReplaceOrder; partial-fill note), and the AppShell-wrapped trader/orders page
  composing OrderForm + filters + table, scoped to selectedAccountId + environment mode (FR-7).
  `pnpm lint` + `tsc --noEmit` + `pnpm build` all pass (/trader/orders built).
- Files modified/created: OrderForm.tsx (mod); OrderFilters.tsx, OrdersTable.tsx,
  EditOrderDialog.tsx, app/trader/orders/page.tsx (new); + backend trading_repo.go & trading.go
  (range filtering — user-approved Option A).
- Deviations: wired created_at range filtering into the Go repo+service so the FR-2 date-range UI
  works server-side (sequential-mode blocker → user chose Option A). See Deviation Log.

### Step 10 — test: xstockstrat-ui E2E for the orders page [done]
- Added e2e/trader/orders.spec.ts (mocks ListBrokerAccounts/ListOrders/CancelOrder/ReplaceOrder
  via page.route; fails StreamOrderUpdates fast so the live hook stops). Covers list render, all-5
  order types + per-type price fields, Edit enabled(NEW/PARTIALLY_FILLED)/disabled(FILLED),
  Cancel two-step confirm→CancelOrder, PENDING_APPROVAL surfaced, filter→re-issued ListOrders.
  Firefox run: 4/6 passed; the 2 failures were `page.goto` 10s cold-compile timeouts (documented
  pnpm-dev flake; CI uses a production build that avoids it). chromium browser rev mismatched
  Playwright 1.59.1. `tsc` + `lint` clean; Step 9 `pnpm build` compiles /trader/orders.
- Files created: `services/xstockstrat-ui/e2e/trader/orders.spec.ts`
- Deviations: e2e verified via behavioral pass + CI-equivalent fallback — see Deviation Log.

### Step 11 — docs: Record ReplaceOrder RPC + per-broker replaceable-field matrix [done]
- Added an `order.replaced` row to the trading CLAUDE.md "Ledger Events Emitted" table, an
  "Order Replace (ReplaceOrder)" section (broker-agnostic routing, NEW/PARTIALLY_FILLED gate,
  netting-mode note) + the per-broker field matrix (Alpaca qty/limit_price/stop_price/time_in_force
  vs IBKR quantity/price/auxPrice/tif). Updated approval-flow.md to note the /trader/orders page
  surfaces PENDING_APPROVAL and that replace is rejected server-side (FailedPrecondition) until a
  broker order exists. Corrected the doc to match the actual UI (terminal-only Edit/Cancel disable).
- Files modified: `services/xstockstrat-trading/CLAUDE.md`, `docs/runbooks/approval-flow.md`
- Deviations: reworded the PENDING_APPROVAL doc line to reflect actual behavior (Step 9 disables
  Edit/Cancel only for terminal states; replace on PENDING_APPROVAL is server-rejected, not UI-disabled).

## Session 2026-06-11 — sdd-execute (sequential) — feature 055 code-completed
**Steps this session**: 1–11 (all)
**Progress**: 11 done / 11 total
**Stopped at**: all complete — feature 055 at code-completed. Per user's "one feature at a time"
choice, stopping before 056/057 for review.
**Next**: review/merge the 055 stacked PRs (#668–#678), then run /sdd-execute for 056.
