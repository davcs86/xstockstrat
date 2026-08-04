# Product Spec: trading-safety-dashboard-slos

**Created**: 2026-08-04

---

## Problem Statement

Once the P0 safety controls (kill switch, idempotency, reconciliation, protection, market-data gate)
exist, an operator still has no single place to see whether they are actually working — an unprotected
position, a stuck `UNKNOWN` order intent, or a growing reconciliation mismatch can go unnoticed without
a dedicated view and defined SLOs.

## User Story

As a platform operator, I want a dedicated Trading Safety dashboard with defined SLOs, so I can see at
a glance whether every live-capital safety control is currently healthy and act before a breach becomes
an incident.

## Functional Requirements

FR-1. Surface: unprotected-position count and age (feature 030/100); order-intent state distribution,
especially `UNKNOWN` count (feature 101); reconciliation mismatches and age (feature 102); broker RPC
latency and failure rate; order rejection rate by reason (feature 106 and others); time from fill to
confirmed protection (feature 030); duplicate-event suppression count (feature 101); current halt
state and trigger (feature 100); market-data freshness (feature 106); account exposure vs. every
configured limit (features 023/107).

FR-2. Define and display SLOs: no live position unprotected beyond the defined protection window; no
unresolved `UNKNOWN` order command beyond the reconciliation interval; no stale market data used for an
entry decision; reconciliation completes within its defined period; critical trading alerts delivered
and acknowledged within a defined period.

FR-3. Each metric is backed by real instrumentation emitted by its owning feature (100–107) — this
feature does not invent new measurement logic, it visualizes and thresholds what those features already
emit.

## Out of Scope

- Building the underlying instrumentation/metrics themselves where a P0 feature does not yet emit them
  — flag as a blocking dependency rather than duplicating that feature's telemetry here.
- Alert *delivery* mechanics (owned by `xstockstrat-notify`); this feature only displays
  delivery/ack-time SLO compliance.

## Affected Services

- `xstockstrat-ui` — new dashboard page.
- `xstockstrat-notify` — alert delivery/ack-time data source.
- `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` — metric sources (read-only
  consumption of RPCs/telemetry those services already expose per features 100–107).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/insights` (or `/trader`, TBD at `/sdd-design`): a new
  "Trading Safety" dashboard page, registered in `PLATFORM_SUBNAV` per **C-10(a)** and covered by a
  nav-reachability test (**Known trap**, see Open Questions).
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- Likely none beyond what features 100–107 already expose; this feature is a UI consumer. Any gap
  discovered (a metric with no existing RPC) becomes an explicit dependency on the owning feature,
  flagged at `/sdd-design`, not invented here.

## Config Key Changes

- SLO threshold values must be config-driven, e.g. `trading.slo.max_unprotected_seconds`,
  `trading.slo.max_unknown_intent_seconds`, `trading.slo.reconciliation_period_seconds` — exact keys
  finalized at `/sdd-spec` (likely shared with/aliased to the same keys features 100/030/102 already
  define — check for duplication before introducing new ones, per the DRY guard rail).

## Database Changes

- [ ] No schema changes expected — dashboard reads existing state via RPC; confirm at `/sdd-design`.

## Feature Workflow Notes

Branch to create: `feature/trading-safety-dashboard-slos` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

1. Every metric in FR-1 is displayed and backed by a real RPC/telemetry source (no placeholder/mock
   data in the shipped dashboard).
2. Every SLO in FR-2 has a visible pass/breach indicator.
3. The dashboard page is reachable from the shared platform nav.

## Open Questions

- [ ] **Known trap (ledger `fails.md` 2026-07-01, 060-screener-engine):** a new UI page shipped without
  a `PLATFORM_SUBNAV` entry is unreachable — register it and add a nav-reachability test.
- [ ] Hard-depends on features 100–107 already emitting the underlying instrumentation — this is
  correctly last in the P0 suggested execution order ("Instrumented P0 controls"); confirm which
  metrics are actually available before scoping the first implementation slice.
- [ ] `/insights` vs `/trader` placement — flag for `/sdd-design`.
