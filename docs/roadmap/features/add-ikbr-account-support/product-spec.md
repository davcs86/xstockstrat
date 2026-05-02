# Product Spec: add-ikbr-account-support

**Created**: 2026-05-02

---

## Problem Statement

`xstockstrat-trading` is hard-wired to Alpaca's broker REST API with no abstraction layer. There is no `BrokerType` field in the proto contract, no config key to select a broker at runtime, and no code path for any other execution venue. Adding Interactive Brokers (IBKR) as an alternative order-execution venue requires introducing a broker interface, an IBKR client implementation, and the necessary proto/config plumbing to select between brokers without redeploying services.

## User Story

As a platform operator, I want to route order execution to either Alpaca or IBKR by changing a config key, so that I can use an IBKR account for trade execution with dev using the IBKR paper account and production using the IBKR live account — mirroring the existing Alpaca paper/live pattern.

---

## Functional Requirements

**Broker interface and abstraction (xstockstrat-trading)**

FR-1. Extract a `Broker` interface from the current `broker.Client` struct in `services/xstockstrat-trading/internal/broker/`. The interface must expose at minimum: `SubmitOrder`, `CancelOrder`, and `GetOrder` with signatures compatible with the current Alpaca implementation. Both the Alpaca client and the new IBKR client must satisfy this interface.

FR-2. Create `services/xstockstrat-trading/internal/broker/ibkr.go` implementing the `Broker` interface against the IBKR API surface (see OQ-1). The IBKR client must produce an equivalent order-response struct so that `TradingService` logic is broker-agnostic.

FR-3. `TradingService` must hold the active broker as the `Broker` interface type, not the concrete `*alpaca.Client` type. All call sites (`PlaceOrder`, `CancelOrder`, `pollFills`) must use the interface.

FR-4. The active broker is selected at startup from the config key `trading.broker.active`. Hot-swapping mid-run is explicitly out of scope.

**Proto contract changes**

FR-5. Add a `BrokerType` enum to `packages/proto/common/v1/common.proto`:
```
BROKER_TYPE_UNSPECIFIED = 0
BROKER_TYPE_ALPACA      = 1
BROKER_TYPE_IBKR        = 2
```

FR-6. Add `broker_type` (type `xstockstrat.common.v1.BrokerType`) as a new optional field on the `Order` message in `packages/proto/trading/v1/trading.proto` at field number 19. Populated by `xstockstrat-trading` at order creation time based on the active broker.

FR-7. Update the comment on `broker_order_id` (field 18) from Alpaca-specific language to: "Broker-assigned order ID. Interpretation is broker-specific; populated after broker submission."

FR-8. Both proto changes (FR-5, FR-6) are additive and must pass `buf lint` and `buf breaking --against '.git#branch=main'`. No v2 migration required.

**Config key changes**

FR-9. New config key `trading.broker.active` (string, default: `"alpaca"`) controls which broker is instantiated at startup. Valid values: `"alpaca"` or `"ibkr"`. The service must log fatal and refuse to start on unrecognised values.

FR-10. New env vars for IBKR credentials (sourced from environment, never config service — consistent with `ALPACA_*` pattern): `IBKR_BASE_URL`, `IBKR_ACCOUNT_ID`, `IBKR_PAPER` (bool, default: `true`).

**Environment and deployment invariants**

FR-11. Dev environment: `IBKR_PAPER=true` → IBKR paper/simulated account. Prod environment: `IBKR_PAPER=false` → IBKR live account. Mirrors `ALPACA_PAPER` behaviour exactly.

FR-12. Existing `ALPACA_PAPER`, `ALPACA_BASE_URL`, and `ALPACA_*` env vars are unchanged and continue to govern the Alpaca client path.

FR-13. `xstockstrat-trading` must include `broker_type` in all ledger event payloads that carry broker context: `order.submitted`, `order.broker_submitted`, `order.broker_rejected`, `order.filled`.

**Order status normalization**

FR-14. The IBKR client must map IBKR native order status strings to the existing `OrderStatus` proto enum. No new `OrderStatus` values are introduced.

**Fill polling**

FR-15. The existing `StartFillPoller`/`pollFills` mechanism uses `GetOrder` on the broker. Since `GetOrder` will be on the interface after FR-1, fill polling works for both brokers without additional changes.

---

## Out of Scope

- **IBKR market data**: `xstockstrat-marketdata` is not modified. Alpaca remains the sole market data provider. Adding IBKR market data is a separate future feature.
- **Runtime broker hot-swap**: Changing `trading.broker.active` requires a service restart.
- **Multi-broker simultaneous routing**: Splitting orders across brokers or per-strategy routing is deferred.
- **IBKR portfolio sync**: Syncing IBKR account positions into `xstockstrat-portfolio` is out of scope.
- **IBKR-specific order types**: New `OrderType` enum values are deferred.
- **xstockstrat-trader UI changes**: `broker_type` is available on the `Order` proto; UI surfacing is a follow-up.
- **Breaking proto changes**: This feature is entirely additive on the proto side.

---

## Affected Services

Exact service names from root `CLAUDE.md` Service Registry:

- `xstockstrat-trading` (Go, gRPC 50051 / HTTP 8051) — primary: broker interface extraction, IBKR client, config/env changes, proto field population
- `xstockstrat-ledger` (Node.js, gRPC 50057 / HTTP 8057) — no code changes; event payloads gain `broker_type` field stored opaquely; no schema migration
- `xstockstrat-config` (Node.js, gRPC 50060 / HTTP 8060) — new config key `trading.broker.active` must be seeded for dev and production environments
- `xstockstrat-trader` (Next.js, HTTP 3000) — proto stub regeneration only (new `BrokerType` enum + `broker_type` field on `Order`)
- `xstockstrat-insights` (Next.js, HTTP 3001) — proto stub regeneration only

Services with **no changes**: `xstockstrat-marketdata`, `xstockstrat-portfolio`, `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config-ui`.

---

## Proto Contract Changes

Both changes are **non-breaking** (additive only). Files in `packages/proto/`.

**1. New `BrokerType` enum — `common/v1/common.proto`**

Add after the existing `Environment` enum:
```protobuf
// BrokerType identifies the execution venue for an order.
enum BrokerType {
  BROKER_TYPE_UNSPECIFIED = 0;
  BROKER_TYPE_ALPACA      = 1;
  BROKER_TYPE_IBKR        = 2;
}
```

**2. New `broker_type` field — `trading/v1/trading.proto`**

Add to the `Order` message at field 19:
```protobuf
xstockstrat.common.v1.BrokerType broker_type = 19;
```

**3. Comment update on `broker_order_id` (field 18)** — non-breaking; no field number or type change.

---

## Config Key Changes

New key to register in `xstockstrat-config`:

| Key | Type | Default | Scope | Description |
|---|---|---|---|---|
| `trading.broker.active` | string | `"alpaca"` | `all` | Active broker for order execution. Valid: `"alpaca"`, `"ibkr"`. Read at startup only. |

New env vars for `xstockstrat-trading` (secrets, not in config service):

| Variable | Required when | Default |
|---|---|---|
| `IBKR_BASE_URL` | `trading.broker.active=ibkr` | — |
| `IBKR_ACCOUNT_ID` | `trading.broker.active=ibkr` | — |
| `IBKR_PAPER` | always present | `true` |

---

## Database Changes

- [ ] No schema changes required.

The existing `trading.orders` hypertable schema accommodates this feature (`broker_order_id TEXT` is broker-agnostic). A `broker_type` column can be added in a follow-up if needed.

---

## Feature Workflow Notes

Branch to create: `feature/add-ikbr-account-support` (branch from `main-dev`)

Approval gates required (per `docs/runbooks/feature-workflow.md`):
- [x] **1 service owner approval** — required (non-breaking proto: new enum + new field)
- [ ] 2 service owners + platform lead — NOT required (no breaking changes)
- [ ] DBA review + service owner — NOT required (no schema migrations)
- [x] **Config team** — required for new `trading.broker.active` key

CI requirements: `buf lint` + `buf breaking --against '.git#branch=origin/main'` must pass. Regenerate stubs via `./scripts/buf-gen.sh` and commit `packages/proto/gen/`.

Deployment sequence:
1. Merge to `main-dev` → dev deploys with `trading.broker.active=alpaca` (default, no behaviour change)
2. Seed `trading.broker.active=alpaca` in dev config service; validate Alpaca paper path (regression)
3. Set `trading.broker.active=ibkr`, `IBKR_PAPER=true` on dev to test IBKR paper path
4. Merge `main-dev` → `main` for production deploy with `IBKR_PAPER=false`

---

## Acceptance Criteria

1. All existing Alpaca paper/live order flows work unchanged after the feature merges — `trading.broker.active` defaults to `"alpaca"`.
2. When `trading.broker.active=ibkr` and the service restarts, orders route to IBKR. `Order.broker_type` in all gRPC responses is `BROKER_TYPE_IBKR`.
3. `Order.broker_type` is `BROKER_TYPE_ALPACA` for all orders when `trading.broker.active=alpaca`.
4. Ledger events `order.submitted`, `order.broker_submitted`, `order.broker_rejected`, `order.filled` include `broker_type` in their payload.
5. `buf lint` and `buf breaking` pass in CI.
6. Generated stubs in `packages/proto/gen/go/`, `gen/python/`, `gen/ts/` are regenerated and committed.
7. Service refuses to start (fatal log, non-zero exit) if `trading.broker.active` is an unrecognised value.
8. All existing `xstockstrat-trading` tests pass. New unit tests cover IBKR order status mapping.
9. Dev environment: `IBKR_PAPER=true` in `.do/app.dev.yaml`; continues operating in paper mode.

---

## Open Questions

- [ ] **OQ-1**: Which IBKR API surface? Client Portal Gateway (CPG, local HTTP proxy + browser auth) vs. IBKR Web API (newer, OAuth-based)? This determines `ibkr.go` auth model and `IBKR_*` env var design. Must resolve before implementation.
- [ ] **OQ-2**: IBKR paper account availability confirmed for dev testing?
- [ ] **OQ-3**: Do existing `OrderType` enum values (`MARKET`, `LIMIT`, `STOP`, `STOP_LIMIT`, `TRAILING_STOP`) map cleanly to IBKR order types, or should unsupported types return an error?
