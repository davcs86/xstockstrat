# Feature: premarket-aftermarket-session-toggle

**Development Branch**: `feature/premarket-aftermarket-session-toggle`
**Created**: 2026-05-24
**Last Updated**: 2026-08-29
**Archived**: 2026-09-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-24 | `idea` | /sdd-execute (014 step 4) | Backlogged during trader-chart-panel execution |
| 2026-08-29 | `idea` → `demoted/canceled` | product-review | **Premise obsolete on two independent counts.** (1) A pre-market/regular/after-hours session toggle only has meaning for **intraday** bars, but feature **143 (`daily-bars-only`, launched)** made `GetBars`/`BackfillBars` reject every non-`1d` timeframe — the 10m/30m/1h intraday bars this feature toggles no longer exist in the platform, and no trading-path consumer evaluates sub-daily bars. (2) It targets the `ChartPanel` in `xstockstrat-trader`, a service **removed by feature 045 (`ui-consolidation-nextjs`)**. Same call already made for the analogous intraday feature 025 (`realtime-tick-streaming` → demoted/canceled). If intraday support is ever revived, this would be re-created fresh under a new NNN, not resurrected. |
| 2026-09-01 | `demoted/canceled` (unchanged) | /sdd-archiver | Archived — no artifacts to prune (never progressed past `idea`); no context.md or spec files exist. |

---

## Cancellation Rationale

This feature was never developed beyond the `idea` backlog stub (no product-spec, design, or code).
It is canceled — not deferred — because the platform deliberately moved to **daily-only** market
data (feature 143) and consolidated the frontend off `xstockstrat-trader` (feature 045). A session
toggle is inherently an intraday concept; on a daily/swing platform there is no intraday session to
select. See the Status History row above.

---

## Summary

Add pre-market and after-hours session filtering to the `ChartPanel` component in `xstockstrat-trader`. When an intraday timeframe (10m, 30m, 1h) is selected, show a toggle to switch between pre-market (4:00–9:30 AM ET), regular (9:30 AM–4:00 PM ET), and after-hours (4:00–8:00 PM ET) sessions.

## Blocker

`GetBarsRequest` in `packages/proto/marketdata/v1/marketdata.proto` has no `extended_hours` / `session` field. The backend Alpaca client (`internal/alpaca/client.go`) passes the timeframe string through verbatim with no session parameter. This feature requires:

1. A proto change — add `string session = 5;` (or `bool extended_hours = 5;`) to `GetBarsRequest`.
2. Backend propagation — `marketdata_service.go` passes the field to `alpaca_client.go`; Alpaca v2 bars endpoint supports `feed=sip` for extended hours data.
3. Frontend wiring — `ChartPanel` passes `?session=pre|regular|post` to `/api/chart`; route handler forwards it to `GetBars`.

## Next Action

**None — canceled.** See Cancellation Rationale above. The `**Blocker**` section below is retained
only as a historical record of what implementation would have required; it is not a to-do.
