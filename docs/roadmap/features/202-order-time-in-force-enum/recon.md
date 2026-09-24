# Recon: order-time-in-force-enum

**Created**: 2026-09-24
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-ui, packages/proto

---

## Objective

Convert `Order.time_in_force` from a free-form `string` to a closed `TimeInForce` proto enum with
per-broker validation, so that unsupported or malformed TIF values are rejected at the platform edge
(`InvalidArgument`) instead of failing opaquely at the broker boundary.

## Codebase Map

- **`packages/proto` (trading contract)**
  - `Order.time_in_force = 12` (string): `packages/proto/trading/v1/trading.proto:58`
  - `PlaceOrderRequest.time_in_force = 7` (string): `packages/proto/trading/v1/trading.proto:108`
  - `ReplaceOrderRequest.time_in_force = 5` (string): `packages/proto/trading/v1/trading.proto:188`
  - Existing enum pattern to mirror: `OrderType` enum at `packages/proto/trading/v1/trading.proto:81-88`
  - Common `BrokerType` enum: `packages/proto/common/v1/common.proto:68-75` (UNSPECIFIED=0, ALPACA=1, IBKR=2, OFFLINE=3)

- **`xstockstrat-trading`** (Go)
  - Alpaca adapter TIF pass-through: `services/xstockstrat-trading/internal/broker/alpaca.go:109,125,253-254`
    - Accepted wire values: `"day"`, `"gtc"`, `"opg"`, `"cls"`, `"ioc"`, `"fok"`
  - IBKR adapter TIF handling: `services/xstockstrat-trading/internal/broker/ibkr.go:130,189,196,271-272`
    - `orderTypeToIBKR()` enum→wire pattern at `:68-79` (TIF should mirror this)
    - IBKR uppercases only
  - Broker interface: `services/xstockstrat-trading/internal/broker/broker.go:85,109`
    - `OrderRequest.TimeInForce string`, `BracketLegsRequest.TimeInForce`
  - Service handler: `services/xstockstrat-trading/internal/service/trading.go`
    - `buildBrokerRequest` defaults TIF to `"day"`: `:3367-3370`
    - PlaceOrder persists: `:576`
    - ReplaceOrder: `:1347,1372-1373`
    - Hardcoded `"day"` in flatten/bracket: `:2594,3182,3224`
  - Repository: `services/xstockstrat-trading/internal/repository/trading_repo.go`
    - DB insert/scan raw string: `:84,342`
    - `typeStr()`/`parseType()` pattern for OrderType: `:378-391,442-455` (TIF should mirror)
  - DB schema: `services/xstockstrat-trading/migrations/001_orders_hypertable.up.sql:21` — `time_in_force TEXT` nullable
  - Last migration: `009`; next available: `010`

- **`xstockstrat-ui`** (Next.js — `/trader` segment)
  - Place Order form: `services/xstockstrat-ui/src/components/trader/OrderForm.tsx:94-119`
    - Does NOT send TIF today; local `OrderType` union + exhaustive `ORDER_TYPE_LABEL`/`ORDER_TYPE_ENUM` Records at `:22,24,32` (F-C-10 trap site for the new enum)
  - Replace Order dialog: `services/xstockstrat-ui/src/components/trader/EditOrderDialog.tsx:25,41,106-110`
    - Free-text `<Input>` for TIF (needs conversion to enum select)
  - Order detail page: `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx:170` — raw string display
  - Shared rendering: `services/xstockstrat-ui/src/components/trader/orderShared.tsx:7,20,66`
    - `STATUS_VARIANT`, `TYPE_LABEL` (string-keyed), `INTENT_STATE_RENDER` (exhaustive on IntentState)
  - Order filters: `services/xstockstrat-ui/src/components/trader/OrderFilters.tsx:24-42` — manually listed arrays
  - BFF passthrough: `services/xstockstrat-ui/src/lib/traderBff.ts:32,42`
  - Browser gRPC client: `services/xstockstrat-ui/src/lib/browserClients/tradingClient.ts`
  - Transport: `services/xstockstrat-ui/src/lib/browserClients/transport.ts:57` — no custom enum serialization
  - Server-side transport: `services/xstockstrat-ui/src/lib/connectClients.ts:26-28` — no custom enum config
  - Mutation hooks: `services/xstockstrat-ui/src/hooks/usePlaceOrder.ts:6-8`, `useReplaceOrder.ts:6-8`
  - E2E fixtures: `services/xstockstrat-ui/e2e/fixtures/orders.ts:28,47,71` — string TIF values (`'day'`, `'gtc'`)
  - E2E specs: `order-form.spec.ts`, `order-ticket.spec.ts`, `orders.spec.ts`, `order-parity.spec.ts` — all use hardcoded string TIF

## Patterns to REUSE

- `TimeInForce` enum shape → reuse `OrderType` enum at `packages/proto/trading/v1/trading.proto:81-88` (same `_UNSPECIFIED = 0` sentinel, same naming: `TIME_IN_FORCE_DAY`, etc.)
- Enum↔wire broker mapping → reuse `orderTypeToIBKR()` switch at `services/xstockstrat-trading/internal/broker/ibkr.go:68-79`
- Enum↔DB string mapping → reuse `typeStr()`/`parseType()` pattern at `services/xstockstrat-trading/internal/repository/trading_repo.go:378-391,442-455`
- UI exhaustive enum rendering → reuse `Record<ProtoEnum, EnumRender>` + `EnumBadge` canonical pattern at `services/xstockstrat-ui/src/lib/opportunityShared.tsx:28-70`
- UI enum select dropdown → reuse `OrderType` label/enum/option pattern at `OrderForm.tsx:22-32`, `OrderFilters.tsx:24-42`

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @feature-052` "A market order is placed via Alpaca when trading enabled" (`services/xstockstrat-trading/acceptance/place-order.feature`) — PlaceOrder + Alpaca; TIF threading must not break the place→fill flow
- **PRESERVE** `@AC-2 @feature-052` "A limit order is placed via IBKR when trading enabled" (`services/xstockstrat-trading/acceptance/place-order.feature`) — PlaceOrder + IBKR; same
- **PRESERVE** `@AC-3 @feature-052` "PlaceOrder rejects when trading state is DISABLED" (`services/xstockstrat-trading/acceptance/place-order.feature`) — edge validation; TIF validation must run AFTER trading-state check (or alongside, never overriding it)
- **PRESERVE** `@AC-4 @feature-052` "PlaceOrder records to offline ledger when broker is OFFLINE" (`services/xstockstrat-trading/acceptance/place-order.feature`) — offline orders still have TIF; enum must support OFFLINE path
- **PRESERVE** `@AC-5 @feature-075` "Confidence-based auto-sizing adjusts quantity" (`services/xstockstrat-trading/acceptance/place-order.feature`) — auto-sizing is orthogonal to TIF but shares PlaceOrder handler
- **PRESERVE** `@AC-10 @feature-095` "usePlaceOrder mutation submits and invalidates" (`services/xstockstrat-ui/acceptance/order-form.feature`) — the mutation hook is where TIF will thread through; must not break the existing submit→invalidate cycle
- **PRESERVE** `@AC-11 @feature-095` "OrderForm validates quantity" (`services/xstockstrat-ui/acceptance/order-form.feature`) — existing validation; TIF adds a new validated field alongside
- **PRESERVE** `@AC-12 @feature-095` "OrderForm shows enrichment fields as read-only" (`services/xstockstrat-ui/acceptance/order-form.feature`) — enrichment fields (margin, buying power) must stay read-only; TIF is editable, distinct from these
- **PRESERVE** remaining 6 trading/UI rules related to order lifecycle (ReplaceOrder, cancel, bracket, fill detection) — no CHANGE or EXTEND needed; TIF is a new field that threads through existing flows without altering them
- No existing ReplaceOrder `@AC-*` scenarios exist in any durable suite (gap — feature 202's own `@AC-5` covers Replace Order TIF, but there is no baseline to regress against)

## Dependencies

- Proto/RPC: `TimeInForce` enum (new); `Order.time_in_force = 12`, `PlaceOrderRequest.time_in_force = 7`, `ReplaceOrderRequest.time_in_force = 5` — field strategy (in-place vs additive) is an open design fork
- Migration: next number `010` for `services/xstockstrat-trading/migrations/` — only if a backfill/normalization migration is warranted (design decides)
- Config keys: none
- Inter-service edges: none (TIF stays within the trading service + UI consumer boundary; no other service reads `Order.time_in_force`)
- New env vars / ports: none

## Risks / Not-found

- **No TIF validation/allowlist exists anywhere today** — neither an enum, a constants file, nor a config-driven set. The wire values are documented only in Alpaca adapter comments and scattered IBKR hardcodes. The per-broker support matrix must be constructed from scratch.
- **No per-broker TIF support matrix** — IBKR's supported TIF subset is unclear (uppercases only, but which variants?). Design must decide: hardcoded per-broker constant map vs config-driven.
- **Field strategy fork (product-spec Open Question):** changing field 12 in-place is wire-breaking (2 owners + platform lead approval); adding a new field + deprecating the string is additive (1 owner). Neither path is inherently wrong — design must weigh the tradeoff (simpler proto vs migration complexity).
- **Hardcoded `"day"` defaults** in `trading.go:2594,3182,3224` (flatten, bracket-legs) — these must map to `TIME_IN_FORCE_DAY` when the string→enum conversion happens. Risk: if missed, these paths silently send the zero-value.
- **F-C-10 trap (fails.md:81-83):** Proto enum changes break exhaustive TS `Record<Enum,…>`/switch — `OrderForm.tsx:22-32` `ORDER_TYPE_LABEL`/`ORDER_TYPE_ENUM` are the live trap sites. The new `TimeInForce` label/render maps must be complete in the same PR, verified by `pnpm --filter xstockstrat-ui build`.
- **Connect-JSON encoding (fails.md:677-679):** UI must send enum as NAME-strings (`"TIME_IN_FORCE_GTC"`), not numeric. Transport at `transport.ts:57` and `connectClients.ts:26-28` have no custom enum config — default behavior handles this correctly for `@connectrpc/connect`, but explicit verification needed.
- **Node stringEnums (fails.md:1577-1579):** ts-proto `stringEnums=true` delivers string constants and camelCase field names. The new `TimeInForce` enum will follow this convention — consumer code must index by string name, not numeric.
- **DB column stays `TEXT`** — the repository `typeStr()`/`parseType()` pattern works for `OrderType` but no equivalent `tifStr()`/`parseTif()` exists. Unmapped legacy strings (`"good_till_cancel"`, etc.) must read back as `TIME_IN_FORCE_UNSPECIFIED` per FR-4.

## Recommended Scope

1. **Proto + codegen** — define `TimeInForce` enum, wire into `Order`/`PlaceOrderRequest`/`ReplaceOrderRequest` (field strategy decided at design), run `buf-gen.sh`
2. **Trading service** — enum↔wire broker mapping (Alpaca/IBKR adapters), enum↔DB string mapping (repository), per-broker support-matrix validation, `UNSPECIFIED` default handling, update hardcoded `"day"` sites
3. **UI /trader** — `OrderForm` TIF select dropdown, `EditOrderDialog` enum select, order detail/list enum rendering, exhaustive label/render maps, BFF passthrough verified, E2E fixture + spec updates
4. **Tests** — service unit tests (enum mapping, validation rejection, legacy read-back), E2E (Place Order with TIF, Replace Order TIF, order display)
