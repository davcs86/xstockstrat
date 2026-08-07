# Disabled/Non-Live Strategies Usable Across the Site — 2026-08-07

**Status: fixed in this report's companion PR** (`claude/disabled-strategies-usability-8bx1wg`).
GitHub Issues are disabled on this repo, so this report is the audit trail per
`docs/runbooks/bug-triage.md` Track C (SEV-3 UI defect + a SEV-2 backend correctness defect it
uncovered).

## Report

User-reported via screenshots: the Decide-page "Why this fired" strategy picker and the
Discover → Watchlists per-symbol strategy binding picker both listed every registered strategy —
including non-live (`live_enabled=false`) strategies and throwaway test entries
("Hdhdbx", "Fvbj", "Fhdjfjd") — mixed in unlabeled with real, live-trading strategies. Selecting
one of these lets a user "trade against" or track readiness on a strategy the operator has
explicitly disabled.

## Root cause

`StrategyDefinition` carries two independent flags: `active` (soft-delete) and `live_enabled`
(actually eligible to trade live — `packages/proto/analysis/v1/analysis.proto`). The shared
frontend hook `useStrategyDefinitions()` (`services/xstockstrat-ui/src/hooks/useStrategyDefinitions.ts`)
only ever filters on `active` (via `ListStrategyDefinitions`' `include_inactive`); the two picker
components consumed its raw list.

While tracing the read path, a related **SEV-2 backend defect** surfaced: the opportunities-queue
compute path (`ListOpportunities` → `_compute_opportunities` → `_load_strategy_definition` in
`services/xstockstrat-analysis/app/handlers/servicer.py`) loads a watchlist-bound strategy via
`StrategiesRepository.get_by_id`, which applies **no** `active`/`live_enabled` filter at all — so
a watchlist binding pointing at a deactivated or live-disabled strategy still produced a real
readiness/opportunity row on the Decide queue. The actual live-trading loop
(`app/engine/live_loop.py`) was independently verified to correctly filter
`WHERE live_enabled = TRUE AND active = TRUE` — order execution/alerting was never affected — but
the read-only opportunities surface that drives human trade decisions was.

## Fix

- `SignalReadiness.tsx` (Decide-page picker) and `WatchlistDetail.tsx` (Watchlists picker): filter
  the strategy list to `liveEnabled` strategies only before rendering `SelectItem`s. The
  Watchlists picker additionally keeps an already-bound-but-now-non-live strategy visible
  (labeled "(non-live)") so an existing binding doesn't appear to silently vanish.
- `servicer.py`'s `_load_strategy_definition`: treat a strategy row with `active=false` or
  `live_enabled=false` the same as "missing" (returns `None`), so `_compute_opportunities` traces
  it to 0/0 rather than fabricating readiness — mirroring the live loop's own gate.

## Tests added

- `services/xstockstrat-analysis/tests/test_analysis_servicer.py`:
  `test_watchlist_binding_to_disabled_strategy_traces_to_zero`,
  `test_watchlist_binding_to_deactivated_strategy_traces_to_zero` (RED-verified against the
  pre-fix code).
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` and `signal-detail.spec.ts`: new specs
  asserting the fixture's non-live "Inactive Strategy" is never a selectable option.

## Not in scope

- The strategy catalog/management views (`insights/strategies` page, `LiveStrategiesPanel`,
  `insights` dashboard list) intentionally continue to show all active strategies with an
  Active/Paused/Off badge — that's the correct admin/management surface, not a trading picker.
- The junk-named test strategies ("Hdhdbx", "Fvbj", "Fhdjfjd") visible in the reporter's
  screenshots are pre-existing data, not a code defect; cleaning up test data in a live
  environment is an operational task, not part of this fix.
