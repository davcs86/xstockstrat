# Feature: premarket-aftermarket-session-toggle

**Lifecycle Status**: `idea`
**Development Branch**: `feature/premarket-aftermarket-session-toggle`
**Created**: 2026-05-24
**Last Updated**: 2026-05-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-24 | `idea` | /sdd-execute (014 step 4) | Backlogged during trader-chart-panel execution |

---

## Summary

Add pre-market and after-hours session filtering to the `ChartPanel` component in `xstockstrat-trader`. When an intraday timeframe (10m, 30m, 1h) is selected, show a toggle to switch between pre-market (4:00–9:30 AM ET), regular (9:30 AM–4:00 PM ET), and after-hours (4:00–8:00 PM ET) sessions.

## Blocker

`GetBarsRequest` in `packages/proto/marketdata/v1/marketdata.proto` has no `extended_hours` / `session` field. The backend Alpaca client (`internal/alpaca/client.go`) passes the timeframe string through verbatim with no session parameter. This feature requires:

1. A proto change — add `string session = 5;` (or `bool extended_hours = 5;`) to `GetBarsRequest`.
2. Backend propagation — `marketdata_service.go` passes the field to `alpaca_client.go`; Alpaca v2 bars endpoint supports `feed=sip` for extended hours data.
3. Frontend wiring — `ChartPanel` passes `?session=pre|regular|post` to `/api/chart`; route handler forwards it to `GetBars`.

## Next Action

Run `/sdd-story premarket-aftermarket-session-toggle` with the above context to generate a full product spec when ready to implement.
