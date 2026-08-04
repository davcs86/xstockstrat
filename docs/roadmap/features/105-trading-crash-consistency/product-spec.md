# Product Spec: trading-crash-consistency

**Created**: 2026-08-04

---

## Problem Statement

A service crash or redeploy can happen at any point in the order/protection lifecycle. Today there is
no systematic test coverage proving the platform converges to a correct state — no duplicate orders,
no missing accounting events — no matter which instant the crash occurs at.

## User Story

As the platform, I want a crash-consistency test suite that injects a restart at every externally
consequential step of the order and protection lifecycle, so that recovery is proven correct rather
than assumed.

## Functional Requirements

FR-1. Insert crash points around every externally consequential step: before intent persistence; after
persistence, before broker submission; after broker acceptance, before response persistence; after fill
reception, before ledger append; after ledger append, before portfolio update; after entry fill, before
stop submission; during stop cancel-and-replace; during emergency flatten.

FR-2. For each crash point, restart the affected service and verify: no duplicate broker orders are
created, no accounting events (ledger entries) are lost or duplicated, and the recovered state matches
what a non-crashed run would have produced.

FR-3. Run against an ephemeral PostgreSQL instance and the feature-103 broker simulator in CI — not
against shared/persistent test infrastructure.

FR-4. Cover crash points spanning `xstockstrat-trading`, `xstockstrat-portfolio`, and
`xstockstrat-ledger` where the consequential step crosses a service boundary.

## Out of Scope

- The idempotent order-intent model that crash recovery relies on — feature 101 (a hard dependency;
  this suite tests that model's crash behavior, it doesn't build it).
- General property-based invariant testing across non-crash sequences — feature 104.

## Affected Services

- `xstockstrat-trading` — primary crash points (intent persistence, broker submission, stop
  cancel-and-replace, emergency flatten).
- `xstockstrat-portfolio` — post-fill portfolio-update crash points.
- `xstockstrat-ledger` — post-fill ledger-append crash points.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — CI test-suite hardening; no end-user-reachable behavior change.

## Proto Contract Changes

- [x] No proto changes required.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No new production schema changes (uses ephemeral test databases provisioned by CI; may add
  test-only fixtures, not production migrations).

## Feature Workflow Notes

Branch to create: `feature/trading-crash-consistency` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

1. Every crash point in FR-1 has a corresponding test that restarts the affected service and asserts
   convergence.
2. No test run produces a duplicate broker order or a missing/duplicated ledger event.
3. The suite runs in CI against ephemeral PostgreSQL + the feature-103 simulator, not shared
   infrastructure.

## Open Questions

- [ ] Hard-depends on feature 101 (idempotent order-intent model) existing first — sequence
  accordingly per the suggested execution order ("Crash-consistency tests" follows "Simulator" and
  "durable intents").
- [ ] Mechanism for injecting a mid-operation "crash" in Go/Python/Node services under test (process
  kill vs. panic/exception injection point) — flag for `/sdd-design`, likely differs per language.
