# Product Spec: broker-state-reconciliation

**Created**: 2026-08-04

---

## Problem Statement

Nothing today continuously verifies that `xstockstrat-trading`/`xstockstrat-portfolio`'s view of open
orders, positions, cash, protective orders, and fills actually matches the broker. A manual order
placed directly through the broker's own dashboard, a missed webhook/poll, or a partial-fill
mis-accounting can silently drift the platform's state away from reality — exactly the condition an
automated strategy must never trade on top of.

## User Story

As the platform, I want continuous reconciliation between broker truth and platform state, classified
by severity, so that benign drift self-heals, unsafe drift halts exposure-increasing trading (via
feature 100), and no correction is ever applied silently.

## Functional Requirements

FR-1. Continuously reconcile, per broker account: open orders, positions and quantities, average entry
prices, buying power and cash, protective orders, recent fills/executions, and account trading status.

FR-2. Classify each mismatch into one of: benign propagation delay, recoverable platform lag, unknown
broker order (exists at broker, not in platform), missing broker order (exists in platform, not at
broker), quantity discrepancy, unprotected position, or impossible state requiring halt.

FR-3. Self-heal classifications recoverable without risk (propagation delay, platform lag) —
automatically, without operator action.

FR-4. For unsafe discrepancies (unprotected position, quantity mismatch beyond tolerance, impossible
state), trigger `HALTED` (feature 100) for exposure-increasing trading — reconciliation never resolves
an unsafe mismatch by itself continuing to trade through it.

FR-5. Never silently overwrite platform state to match the broker without recording the correction (an
audited event: what changed, from what, to what, and which reconciliation pass made the change).

FR-6. Expose reconciliation age (time since last successful pass) and current status per account —
minimally, as a status field consumed by feature 100's gate and feature 108's dashboard (this feature
does not itself build the full dashboard — see Consumer Surface).

FR-7. Alert (via `xstockstrat-notify`) when a discrepancy remains unresolved beyond a defined
service-level objective.

FR-8. An `UNKNOWN` order intent (feature 101) is resolved against broker truth through this same
reconciliation pass, not a separate mechanism.

## Out of Scope

- The full operator dashboard visualizing reconciliation history/trends — feature 108 owns the
  dashboard; this feature only emits the status/age signal it consumes.
- The exact halt state machine and manual-override semantics — feature 100.

## Affected Services

- `xstockstrat-trading` — reconciliation of orders, protective orders, account trading status; feeds
  the feature-100 halt gate.
- `xstockstrat-portfolio` — reconciliation of positions, average entry prices, cash/buying power.
- `xstockstrat-notify` — SLO-breach alerting.
- `xstockstrat-ui` — minimal reconciliation status/age indicator on the existing `/trader` account
  view.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/trader`: a minimal reconciliation status/age indicator added
  to the existing account/positions view. The richer trend dashboard is deliberately deferred to the
  named follow-up **feature 108 (trading-safety-dashboard-slos)** — not a vague "later".
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- New RPC(s) to report reconciliation status/age and unresolved-discrepancy records (exact shape TBD
  at `/sdd-spec`); a new `DiscrepancyClass` enum with `_UNSPECIFIED = 0` sentinel.

## Config Key Changes

- Reconciliation cadence and SLO thresholds must be config-driven, not hardcoded, e.g.
  `trading.reconciliation.interval_seconds`, `trading.reconciliation.unresolved_slo_seconds` — exact
  keys finalized at `/sdd-spec`.

## Database Changes

- New migration(s) in `services/xstockstrat-trading/migrations/` and/or
  `services/xstockstrat-portfolio/migrations/` for a reconciliation-run log and a discrepancy-record
  table (exact split decided at `/sdd-design` based on which service owns which compared entity).

## Feature Workflow Notes

Branch to create: `feature/broker-state-reconciliation` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

1. Injecting an order directly through the broker's own dashboard is detected by the platform, and
   imported or quarantined according to policy, preventing conflicting automation.
2. Self-healable discrepancies resolve automatically without operator action.
3. Unsafe discrepancies halt exposure-increasing trading (via feature 100) rather than continuing to
   trade through them.
4. Every automatic correction is recorded — what changed, from what, to what, which pass.
5. Reconciliation age and status are queryable per account.
6. An unresolved discrepancy beyond the configured SLO produces an alert.

## Open Questions

- [ ] Does `xstockstrat-trading` or `xstockstrat-portfolio` own the reconciliation loop, given
  positions live in portfolio but orders/protective-orders live in trading? Flag for `/sdd-design` —
  likely needs a cross-service read; check the dependency-graph direction first per ledger `insights.md`
  2026-07-31 (083) before adding a new synchronous edge.
- [ ] This feature is a hard dependency for feature 101's `UNKNOWN`-intent resolution (FR-5/FR-6 there)
  — confirm the intent-record contract at design time so both features agree on it.
