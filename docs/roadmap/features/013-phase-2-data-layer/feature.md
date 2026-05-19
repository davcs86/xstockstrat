# Feature: phase-2-data-layer

**Lifecycle Status**: `idea`
**Development Branch**: `feature/phase-2-data-layer`
**Created**: 2026-05-19
**Last Updated**: 2026-05-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-19 | `idea` | backlog | Surfaced as sleeper risk — Phase 2 skipped while Phases 3–6 completed |

---

## Artifacts

- [Product Spec](product-spec.md) — _not yet written — run `/sdd-story phase-2-data-layer`_
- [Implementation Spec](implementation-spec.md) — _not yet generated_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Complete the Phase 2 data layer: replace the polling stubs in `xstockstrat-marketdata` with real Alpaca WebSocket streaming, introduce the `SourceRegistry` pattern to enable additional data providers without code changes, and implement realized P&L computation in `xstockstrat-portfolio`. Phases 3–6 are already live and depend on these services — they currently work but degrade silently when the stubs fall short (60s bar lag, no true real-time quotes, incorrect P&L on closed positions).

---

## Specific Gaps (from code audit 2026-05-19)

### xstockstrat-marketdata (`services/xstockstrat-marketdata/`)

| Gap | Location | Detail |
|---|---|---|
| WebSocket streaming stub | `internal/alpaca/client.go:164` | `StreamBars` polls Alpaca REST every 60 s. Comment: "For production, replace with Alpaca WebSocket (`wss://stream.data.alpaca.markets/v2/{feed}`)." |
| Quote streaming stub | `internal/alpaca/client.go:198` | `StreamQuotes` polls REST every 5 s. Comment: "For production, replace with Alpaca WebSocket." |
| No SourceRegistry | `internal/service/marketdata_service.go` | Roadmap §Phase 2A requires `sourceRegistry.Register("alpaca", ...)` dispatch pattern; all RPCs hard-code `s.alpaca.*`. Adding Polygon/Tiingo requires code changes instead of registration. |

### xstockstrat-portfolio (`services/xstockstrat-portfolio/`)

| Gap | Location | Detail |
|---|---|---|
| `realized_pnl` always 0 | `internal/service/portfolio_service.go:255–270` | `GetPnL` computes unrealized correctly (via `GetLatestQuote`) but never sets `RealizedPnl`. Proto field exists (`portfolio/v1/portfolio.proto:60`). Requires querying ledger for closed-position events (`order.filled` pairs). |

---

## Why This Is a Sleeper Risk

- Phases 3–6 (indicators, analysis, trading, UIs) are live and call `GetLatestQuote` and `GetBars` from marketdata, and call `GetPnL` from portfolio.
- **Unrealized P&L is functionally correct** only while the `quotes` hypertable has fresh rows — which happens only if `StreamQuotes` was started at service boot for the right symbols.
- **Realized P&L is structurally wrong** (always 0). The insights dashboard and trader UI will show incorrect total P&L for any closed position.
- **The 60-second bar lag** means any strategy scoring in analysis that depends on near-real-time bars is working on stale data in production.
- None of these failures are loud — there are no panics or gRPC errors, only quietly wrong numbers.

---

## Dependencies

None — this is a standalone data layer fix. Does not block or depend on any active feature.

## Next Action

Run `/sdd-story phase-2-data-layer` to generate the product spec, then `/sdd-spec` for the implementation spec.
