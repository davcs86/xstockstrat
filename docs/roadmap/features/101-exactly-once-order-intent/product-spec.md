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

## Config Key Changes

- [ ] None expected; flag at `/sdd-spec` if a retry-block duration needs to be configurable.

## Database Changes

- New, small migration in `services/xstockstrat-trading/migrations/`: one `order_intents` table
  (intent id, client order id, request hash, state, broker account/environment, first/latest broker
  response, uncertainty flag) with a uniqueness constraint on intent id. This is additive and does not
  raise `xstockstrat-trading`'s pool-max (see root CLAUDE.md § Connection Pool Budget) — it's one more
  table under the existing pool, not a new connection.

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

- [ ] Does the trader UI (`traderBff.ts`) already generate any client-side request identifier today
  that could seed the intent ID, or does this feature introduce the first one? Check before designing.
- [ ] How is the deterministic client-order-id derived, given Alpaca/IBKR client-order-id length/
  charset limits? Flag for `/sdd-design`.
