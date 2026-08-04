# Context: position-sizing-engine

**Feature**: `docs/roadmap/features/023-position-sizing-engine/feature.md`
**Product Spec**: `docs/roadmap/features/023-position-sizing-engine/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/023-position-sizing-engine/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 023.
- No proto or schema changes in V1. Internal function in trading service.
- Key design decision: explicit-quantity orders bypass sizing (backward compatibility with agent tool calls).
- Two open questions deferred to /sdd-spec: ATR source (marketdata vs. indicators), and whether to expose ComputePositionSize as a gRPC RPC in V1.
- Platform Lead added as reviewer given cross-service dependency (trading → portfolio → marketdata/indicators).

## Session 2026-08-04T00:00:00Z — sdd-story (priority amendment)

- An external live-capital safety risk review recommended this feature be promoted to `P0` and
  accelerated to the top of the roadmap: "Every order should be server-sized. Do not accept a
  client-provided quantity as authoritative for automated strategies." Priority annotation added to
  `feature.md`; no lifecycle status change (still `draft`, pending `/sdd-review`).
- The review calls for controls beyond the current FR-1..FR-8 scope. Recorded here as **additional
  requirements to fold in at the next `/sdd-design`/`/sdd-spec` pass** — not silently added to the
  Functional Requirements above, since several are genuine design forks (behavior #1, "don't guess"):
  - Maximum gross and net exposure limits (account-wide, not just per-position concentration).
  - Per-symbol and correlated-sector concentration limits (current FR-3 is single-position only).
  - Buying-power and available-cash validation before sizing (not currently checked).
  - Minimum stop distance and maximum tolerated stop distance (current spec has no bounds on ATR-
    derived stop distance).
  - Rejection of zero, negative, NaN, stale, or implausible prices feeding the sizing formula.
  - Separate limits for paper and live environments (current spec applies one set of config keys to
    both — `docs/runbooks/feature-workflow.md` already hardcodes paper/live at the infra level via
    `TRADING_MODE`, but the risk *limits themselves* are not yet environment-scoped).
  - Lower limits for newly-enabled strategies (a strategy-age/maturity dimension, not present today).
  - A persisted `RiskDecision` record for every automated live order (inputs, applicable limits,
    result, reason codes) — the current spec only requires INFO-level logging (FR-7), not a queryable
    persisted decision record.
  - Concurrency safety: concurrent orders must not each individually pass checks and collectively
    exceed a limit (current spec has no stated concurrency invariant).
  - Fail-closed behavior when portfolio, price, or configuration data is unavailable (not stated
    today).
  - Risk rejection must occur **before** any broker API call (implicit in the current design via
    `ComputePositionSize` running pre-submission, but not stated as an explicit invariant/AC).
  - This feature now also gates on the new **feature 106 (market-data-freshness-and-quality-gate)**
    and enforces alongside the new **feature 100 (account-trading-halt-and-kill-switch)** at the same
    trading-service order-path enforcement point — sequence these together at `/sdd-design`.
- New backlog features created from the same review: 100–109 (see
  `docs/roadmap/features/100-account-trading-halt-and-kill-switch/` through
  `109-live-trading-game-day/`). This feature and 030 remain the two existing drafts the review said
  to accelerate rather than duplicate.

## Session 2026-08-04T01:00:00Z — feasibility re-check (fold-in from demoted 106)

- A feasibility re-check demoted `106-market-data-freshness-and-quality-gate` (see its context.md) as
  disproportionate to build as a standalone service/proto surface right now. Its cheap, genuinely
  valuable core survives as a recommendation for **this** feature's own implementation: when 023 builds
  its real sizing engine, `ComputePositionSize` (or its replacement) should reject on a missing, zero,
  negative, NaN, or stale price **as part of its own input validation** — reusing the live quote/equity
  read that `checkPortfolioRisk` (`services/xstockstrat-trading/internal/service/trading.go:1288`)
  already performs — rather than standing up a separate market-data-quality service. Note also that
  `checkPortfolioRisk` is currently **deliberately fail-open** ("portfolio unavailability must not halt
  trading," `trading.go:1288` comment) — 023's design should explicitly decide whether the new sizing
  engine keeps that fail-open stance or flips to fail-closed per the review's recommendation; either is
  defensible, but the current behavior is a considered prior choice, not an oversight, and reversing it
  has a real cost on this single-instance-no-HA topology (a portfolio-service blip would then block all
  new orders).
