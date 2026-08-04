# Product Spec: exactly-once-order-intent

**Created**: 2026-08-04

---

## Problem Statement

The platform cannot guarantee exactly-once network delivery to the broker (Alpaca/IBKR) — a request
can time out after the broker already accepted it, and a retry on that timeout risks a duplicate live
order. Before unattended live trading is safe, every consequential order command (place, replace,
cancel, close, emergency flatten) must be modeled so that a *logical* order intent executes at most
once, independent of how many times the underlying RPC is retried.

## User Story

As the trading service, I want a durable order-intent record with a platform-generated intent ID, a
deterministically-derived broker client-order ID, and an explicit `UNKNOWN` uncertainty state, so that
repeating, retrying, or racing the same logical command never creates a duplicate live trade.

## Functional Requirements

FR-1. Every place/replace/cancel/close/emergency-flatten command is modeled as a durable order-intent
record: platform-generated immutable intent ID, broker client-order ID deterministically derived from
that intent ID, a request hash, current lifecycle state, broker account + environment (paper/live),
first and latest broker responses, retry count, and an uncertainty flag.

FR-2. Repeating the same intent ID with the same request hash returns the existing result rather than
re-submitting to the broker.

FR-3. Reusing an intent ID with a *different* request hash is rejected (never silently executed as a
different order under the same ID).

FR-4. A request timeout transitions the intent to `UNKNOWN` — never `FAILED` — because the broker may
have already accepted it.

FR-5. An `UNKNOWN` intent is reconciled against the broker (feature 102) before any retry is attempted;
retries never fire blind against an `UNKNOWN` outcome.

FR-6. Broker actions that are not safely idempotent at the broker's own API (e.g. a bare "submit new
order" call with no client-order-id dedup guarantee) are never retried without first confirming via
reconciliation that the original attempt did not land.

FR-7. Place, replace, cancel, close, and emergency-flatten all route through the same intent model —
no command type gets a bespoke, unmodeled retry path.

FR-8. Correctness is preserved across `xstockstrat-trading` restarts and duplicate deliveries of the
same logical command via the queue or an RPC retry.

## Out of Scope

- The reconciliation engine itself that resolves an `UNKNOWN` intent against broker truth — that is
  feature 102; this feature defines the intent record and the states it can be reconciled into.
- The broker-failure fault-injection harness used to test this exhaustively — that is feature 103.

## Affected Services

- `xstockstrat-trading` — owns the order-intent record, deterministic client-order-id derivation, and
  the idempotent place/replace/cancel/close/flatten command handlers.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/trader`: an order that is in the `UNKNOWN`/reconciling
  intent state must render distinctly (not silently shown as `working` or `failed`) in the existing
  orders view — a display-state addition to the existing orders surface, not a new page.
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- New message(s) on `TradingService` for the order-intent lifecycle state (exact shape TBD at
  `/sdd-spec`); a new enum value or field to surface the `UNKNOWN` uncertainty state on existing
  order-status responses. New enum values need a `_UNSPECIFIED = 0` sentinel per root CLAUDE.md.

## Config Key Changes

- [ ] No new config keys expected, pending `/sdd-design` (a reconciliation-retry backoff interval may
  warrant one — flag at `/sdd-spec`).

## Database Changes

- New migration in `services/xstockstrat-trading/migrations/`: an `order_intents` table (intent id,
  client order id, request hash, state, broker account/environment, first/latest broker response,
  retry count, uncertainty flag) with a uniqueness constraint on intent id.

## Feature Workflow Notes

Branch to create: `feature/exactly-once-order-intent` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

1. A duplicate `PlaceOrder` request (same intent ID, same request hash) cannot create a duplicate live
   trade.
2. A lost broker response (client-side timeout) transitions the intent to `UNKNOWN`, never `FAILED`,
   and does not trigger a blind retry.
3. Reusing an intent ID with different parameters is rejected.
4. All five command types (place, replace, cancel, close, emergency flatten) go through the same
   intent model.
5. Verified across a service restart and a duplicate queue/RPC delivery of the same logical command.

## Open Questions

- [ ] How is the deterministic client-order-id derived (hash of intent ID vs. intent ID itself,
  given Alpaca/IBKR client-order-id length/charset limits)? Flag for `/sdd-design`.
- [ ] Reconciliation (feature 102) is a hard dependency for FR-5/FR-6 — sequence this feature's design
  to define the `UNKNOWN`-state contract feature 102 reconciles against, per the suggested execution
  order (idempotency before reconciliation).
