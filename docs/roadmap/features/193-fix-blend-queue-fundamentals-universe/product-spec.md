# Product Spec: fix-blend-queue-fundamentals-universe

**Type**: bug (Track C) · **Severity**: SEV-3 · **Config-only**: no

## Source

Full root-cause analysis, staging evidence (11 blend-attributed rows, 6 with no `fundamentals`
provenance; BRK.B/RDDT `ENTER` rows), and the three-caller leak inventory are in the defect report:
`docs/reports/2026-09-18-opportunity-queue-ignores-fundamentals-universe-defect.md`. This spec is the
Track C wrapper; the report is the authoritative analysis.

## Problem

Feature 168's universe substitution exists only in `live_loop._run_cycle` (`app/engine/live_loop.py`).
Two other callers of the shared `resolve_universe` have no blend branch:
`_compute_opportunities` (`app/handlers/servicer.py`) and `entry_backfill.run_once`
(`app/engine/entry_backfill.py`). The queue therefore attributes the blend to off-universe symbols,
compounded by `signal_eligible: true` pulling the platform-wide cross-user signal pool. The live
evaluation loop is correct, so no automated order/alert mis-fired (advisory-surface defect).

## Affected service(s)

- `xstockstrat-analysis` only (`live_loop.py`, `servicer.py`, `entry_backfill.py`).

## Chosen approach — A (hoist), operator-approved

`resolve_universe(..., *, blend_id, fundamentals_universe)` applies the blend restriction; all three
callers pass the kwargs when the blend is active. `resolve_fundamentals_universe(...)` extracted to a
shared module-level function (the single seam). See `context.md` for the A-vs-B decision.

## Out of scope / verified-not-a-leak

- The feature-180 readiness materializer (`_materialize_readiness_for_owner`) warms only
  **watchlist-bound** `(symbol, strategy)` pairs (user intent), not auto-attribution — verified not a
  leak site (the report flagged it "unverified").

## Governance gates

- Proto: none. Config: none. DB: none. Reviewer: xstockstrat-analysis owner.

## Acceptance

See `acceptance.feature` (queue + entry-backfill regression scenarios, C-15) — the coverage gap that
let this ship (feature 168's scenarios were all loop-scoped).
