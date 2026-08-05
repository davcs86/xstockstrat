# Product Spec: exactly-once-order-intent

**Created**: 2026-08-04
**Rescoped**: 2026-08-04 (feasibility re-check — see context.md; scope reduced to the one real order
caller instead of hypothetical scheduler/agent callers)

---

## Problem Statement

`xstockstrat-trading` runs as a single instance per environment with no HA (`instance_count: 1` in
`.do/app.yaml`), and deploys happen routinely (daily promotion per root CLAUDE.md). A redeploy or crash
between "we asked the broker to place an order" and "we recorded the broker's answer" is a real,
already-possible event today — for the one caller that exists, the human-driven trader UI
(`services/xstockstrat-ui/src/lib/traderBff.ts:28` → `TradingService.PlaceOrder`). A client-side retry
after a dropped response, or an operator double-clicking "Place Order" after a slow response, risks a
duplicate live order. There is no dedup mechanism today.

## User Story

As the trading service, I want a durable, client-order-id-backed record for each order command from
the trader UI, so that retrying or duplicating the same logical place/replace/cancel request never
creates a duplicate live trade, and a client-side timeout is never blindly retried against an unknown
broker outcome.

## Functional Requirements

FR-1. Every `PlaceOrder`/`ReplaceOrder`/`CancelOrder` call carries (or is assigned) a durable intent
record: a platform intent ID, a broker client-order ID deterministically derived from it, a request
hash, lifecycle state, broker account/environment, first/latest broker response, and an uncertainty
flag. Scope is the three commands the trader UI actually issues today — not `close`/`emergency-flatten`
command types with no real caller yet (those are added when a caller exists, likely alongside a
rescoped `030`/`100`).

FR-2. Repeating the same intent (same ID, same request hash — e.g. the UI retries a request whose
response was lost) returns the existing result instead of resubmitting to the broker.

FR-3. Reusing an intent ID with a different request hash is rejected outright.

FR-4. A request timeout on the trading-service side (broker didn't respond in time) transitions the
intent to `UNKNOWN`, never `FAILED` — the broker may have already accepted it. Surface `UNKNOWN`
distinctly in the existing orders view so an operator sees "we don't know yet," not a false "failed."

FR-5. An `UNKNOWN` intent is never retried blind. `102-broker-state-reconciliation` (revived and
rescoped to a lightweight periodic ticker) is the feature that resolves `UNKNOWN` against broker truth
automatically on its next tick; until `102` lands, block a further programmatic retry of the same
logical command and require an operator to check the broker dashboard directly before manually
retrying — a real, if manual, safety gate in the interim.

FR-6. Correctness survives a `xstockstrat-trading` restart and a duplicate delivery of the same
logical command (e.g. the UI resubmitting after a network blip).

## Out of Scope

- `close`/`emergency-flatten` as first-class intent-model command types — added when a real caller
  exists for them (see `030`/rescoped `100`).
- Automated reconciliation of `UNKNOWN` intents against broker truth — that's the demoted `102`; this
  feature only defines the `UNKNOWN` state and blocks blind retries, it doesn't resolve them.
- A dedicated crash-injection CI suite proving this survives every restart point — that's the demoted
  `105`; ordinary unit/integration tests covering the dedup/timeout/restart behavior are in scope here.

## Affected Services

- `xstockstrat-trading` — owns the order-intent record and the idempotent place/replace/cancel
  handlers.
- `xstockstrat-ui` — the `/trader` existing orders view renders the new `UNKNOWN` display state (see
  Consumer Surface(s)).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/trader` existing orders view: an order in the `UNKNOWN` state must
  render distinctly (not silently `working` or `failed`) — a display-state addition to the existing
  orders surface, not a new page.
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- A field or small message addition to the existing order-status response surfacing the `UNKNOWN`
  uncertainty state (exact shape at `/sdd-spec`); needs a `_UNSPECIFIED = 0` sentinel if a new enum.
  Must land on the shared `Order` message (`packages/proto/trading/v1/trading.proto:32-53`) — not a
  narrower response type — so it automatically propagates to every read path that returns `Order`
  (`GetOrder`, `ListOrders`, `StreamOrderUpdates`), not just the call that created the intent.

**Interaction with the existing order-status lifecycle (C-5, trading-domain):** the new `UNKNOWN`
*intent* state is orthogonal to the underlying order's real `OrderStatus`
(`ORDER_STATUS_PARTIALLY_FILLED`/`ORDER_STATUS_FILLED`/etc., `trading.proto:70-79`) — an intent can be
`UNKNOWN` (the platform doesn't know if the broker accepted the command) independent of whatever fill
state that order eventually reaches once broker truth is recovered. `UNKNOWN` describes the platform's
knowledge of *whether the command landed*, not the order's fill progress; once `102`'s reconciliation
resolves an `UNKNOWN` intent against broker truth (or an operator manually checks and confirms), the
underlying order's `OrderStatus` — including any partial fill that occurred while the intent was
`UNKNOWN` — is unaffected by this feature and continues to be read normally. This feature does not
change fill handling in any way.

## Config Key Changes

- [ ] None expected; flag at `/sdd-spec` if a retry-block duration needs to be configurable.

## Database Changes

- New migration `005_order_intents` (up+down pair) in `services/xstockstrat-trading/migrations/` — next
  after the current highest, `004_broker_accounts_credential_status`. One `order_intents` table
  (intent id, client order id, request hash, state, broker account/environment, first/latest broker
  response, uncertainty flag) with a uniqueness constraint on intent id, applied via
  `scripts/db-migrate.sh` in the standard run order. This is additive and does not raise
  `xstockstrat-trading`'s pool-max (see root CLAUDE.md § Connection Pool Budget) — it's one more table
  under the existing pool, not a new connection.

## Feature Workflow Notes

Branch to create: `feature/exactly-once-order-intent` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

1. A duplicate `PlaceOrder`/`ReplaceOrder`/`CancelOrder` call (same intent ID, same request hash) from
   the trader UI cannot create a duplicate live trade.
2. A lost broker response transitions the intent to `UNKNOWN`, never `FAILED`, and a further automated
   retry of that same intent is rejected (not silently resubmitted).
3. Reusing an intent ID with different parameters is rejected.
4. Verified across a `xstockstrat-trading` restart and a duplicate UI-originated request for the same
   logical command.

## Open Questions

- [x] Does the trader UI (`traderBff.ts`) already generate any client-side request identifier today
  that could seed the intent ID, or does this feature introduce the first one? **Resolved by grep:**
  no. `services/xstockstrat-ui/src/lib/traderBff.ts` forwards `PlaceOrderRequest` unmodified (no
  `clientOrderId`/`client_order_id` reference anywhere in `services/xstockstrat-ui/src`), and
  `trading.go:287` passes `req.ClientOrderId` straight to the broker, which today is always the
  proto zero-value (empty string). This feature introduces the platform's first client-side
  idempotency key from scratch — no existing generator to interoperate with or migrate.
- [ ] How is the deterministic client-order-id derived, given Alpaca/IBKR client-order-id length/
  charset limits, and which `BrokerType` values (ALPACA, IBKR — the only two values besides
  `_UNSPECIFIED`, `packages/proto/common/v1/common.proto`) are in scope? **Decide at `/sdd-design`.**
- [ ] Does this feature's behavior differ under `TRADING_MODE=paper` vs `live`? Likely not — a
  `BrokerAccount`'s paper/live-ness is fixed at the deployment/account level
  (`packages/proto/trading/v1/trading.proto:172`, `is_paper`), not chosen per request — but
  `/sdd-design` should state this explicitly rather than leave it silent.
