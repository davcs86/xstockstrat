# Product Spec: broker-failure-simulator

**Created**: 2026-08-04

---

## Problem Statement

None of the live-capital safety features (idempotency, reconciliation, kill switch, crash-consistency,
state-machine invariants) can be credibly verified against the real Alpaca/IBKR APIs, which do not
offer a way to deterministically reproduce timeouts, duplicate fills, partial fills, or cancel/replace
races on demand. Without a programmable broker double, every safety test is either untestable or
depends on chance.

## User Story

As a test author, I want a programmable, scriptable broker adapter that reproduces specific broker
failure modes on command, so that I can write deterministic integration tests proving the platform's
safety behavior under each failure mode.

## Functional Requirements

FR-1. Implement a broker adapter (conforming to `xstockstrat-trading`'s existing broker-client
interface) usable in place of the real Alpaca/IBKR client in integration tests.

FR-2. Reproduce, on command: connection refused; deadline exceeded before broker acceptance; deadline
exceeded after broker acceptance; duplicate fill events; out-of-order order updates; partial fills;
cancel rejected because a fill won the race; replace accepted while the old order remains temporarily
visible; market closed; insufficient buying power; price-band rejection; rate limiting; authentication
expiry; malformed or missing broker response fields.

FR-3. Support deterministic scripted sequences (e.g.: accept → drop response → partial fill 40% →
service restart → remaining fill 60% → duplicate final fill event) so a test can assert the exact final
order/position/ledger/portfolio state.

FR-4. The simulator is test-only — it must not be reachable or selectable in a deployed environment
(paper or live); wiring is via test configuration/dependency injection only.

## Out of Scope

- The tests that consume this simulator (state-machine invariants — feature 104; crash-consistency —
  feature 105); this feature only builds the simulator itself.
- Any change to the real Alpaca/IBKR broker-client implementations beyond the shared interface they
  and the simulator both satisfy.

## Affected Services

- `xstockstrat-trading` — test-only broker-adapter implementation and script-driven fault injection.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — test infrastructure only, never reachable from a deployed environment; consumed by
  the test suites of features 104/105/109.

## Proto Contract Changes

- [x] No proto changes required (implements the existing internal broker-client interface; does not
  change any `.proto` contract).

## Config Key Changes

- [x] No new config keys — selection of the simulator vs. the real broker client is test wiring, not a
  runtime-configurable value (must never be selectable via `xstockstrat-config` in a deployed env).

## Database Changes

- [x] No schema changes.

## Feature Workflow Notes

Branch to create: `feature/broker-failure-simulator` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

1. The simulator implements every failure mode listed in FR-2 and each is independently triggerable.
2. A scripted multi-step sequence (accept → drop → partial fill → restart → remaining fill → duplicate
   event) runs deterministically and repeatably.
3. The simulator cannot be selected in a paper or live deployed environment (verified by a test
   asserting the production/dev broker-client factory never returns it).

## Open Questions

- [ ] Should the simulator live under `services/xstockstrat-trading/internal/testutil/` (Go, same
  language as the broker-client interface) or a separate test-support package? Flag for `/sdd-design`
  — check the existing broker-client interface location first.
