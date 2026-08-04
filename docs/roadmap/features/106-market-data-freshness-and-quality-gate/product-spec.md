# Product Spec: market-data-freshness-and-quality-gate

**Created**: 2026-08-04

---

## Problem Statement

Nothing today stops an automated order from being sized or placed against stale, missing, or
implausible market data. A quote age exceeding a reasonable threshold, a missing bid/ask, an
abnormal spread, or a stale required volatility input can silently corrupt a position-sizing decision
or authorize a bad entry.

## User Story

As the platform, I want a pre-trade market-data quality gate that rejects exposure-increasing orders
on stale or low-quality data — while still allowing emergency risk-reducing closes — so that a bad
quote can never authorize a new live position.

## Functional Requirements

FR-1. Reject exposure-increasing orders when: quote age exceeds a configured threshold; bid or ask is
missing; spread exceeds a symbol- or asset-class-specific limit; price differs excessively from the
latest bar or an independent reference; market session status is uncertain; a split or other
corporate action may have invalidated cached prices; the data-source timestamp moves backward; a
required volatility input (e.g. for ATR-based sizing) is stale.

FR-2. Distinguish entering exposure from reducing it: stale/low-quality data blocks *new* positions but
must not block an emergency close (feature 100's `EMERGENCY_FLATTEN`).

FR-3. Persist the exact market-data snapshot used for each risk decision (quote, timestamp, spread,
session status) so a rejected or accepted order's basis is reconstructable after the fact.

FR-4. Feed a "stale market data" signal into feature 100's automatic halt triggers when staleness
becomes account-wide (e.g. the marketdata feed itself is down) rather than symbol-specific.

## Out of Scope

- The position-sizing engine's own numeric formulas (feature 023) — this feature is a pass/fail gate
  consumed by that engine and by `xstockstrat-trading`'s order path, not a sizing calculation.
- The broader halt state machine — feature 100.

## Affected Services

- `xstockstrat-marketdata` — source of quote age, bid/ask, spread, session status, corporate-action
  signals.
- `xstockstrat-trading` — consumes the gate immediately before order submission (alongside the
  feature-023 position-sizing engine and feature-100 halt gate).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — existing order-rejection messaging in `xstockstrat-ui` `/trader` gains new market-data
  rejection reason codes (e.g. "stale quote", "spread too wide") — a display addition to the existing
  rejection surface, not a new page.
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- New rejection reason enum values on the existing order-rejection response (exact enum TBD at
  `/sdd-spec`, coordinated with feature 100's rejection-reason surface) — new values need a
  `_UNSPECIFIED = 0` sentinel already present on that enum if it exists, per root CLAUDE.md.

## Config Key Changes

- Thresholds must be config-driven: e.g. `marketdata.quality.max_quote_age_seconds`,
  `marketdata.quality.max_spread_bps`, `marketdata.quality.max_price_divergence_pct` — exact keys and
  per-asset-class scoping finalized at `/sdd-spec`.

## Database Changes

- New migration in `services/xstockstrat-trading/migrations/` (or `xstockstrat-marketdata`, TBD at
  `/sdd-design`) to persist the market-data snapshot per risk decision.

## Feature Workflow Notes

Branch to create: `feature/market-data-freshness-and-quality-gate` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

1. A stale quote cannot authorize a new position.
2. An emergency close is never blocked by the market-data gate.
3. Every risk decision's market-data snapshot is persisted and queryable.
4. Each rejection reason (age, missing bid/ask, spread, divergence, session, corporate action,
   backward timestamp, stale volatility input) is independently testable and surfaced with a distinct
   reason code.

## Open Questions

- [ ] Per-symbol vs. per-asset-class threshold scoping — does this need a new config-key dimension
  beyond the existing `<service>.<category>.<key>` convention (e.g. an asset-class suffix)? Flag for
  `/sdd-design`.
- [ ] Which service persists the market-data snapshot — trading (co-located with the risk decision) or
  marketdata (co-located with the quote)? Flag for `/sdd-design`.
