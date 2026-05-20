# Feature: phase-2-data-layer

**Lifecycle Status**: `idea`
**Development Branch**: `feature/phase-2-data-layer`
**Created**: 2026-05-19
**Last Updated**: 2026-05-20

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

Two gaps from the Phase 2 skip: (1) `GetPnL` in `xstockstrat-portfolio` always returns `realized_pnl = 0` because the ledger is never queried for closed-position events; (2) `xstockstrat-marketdata` has no `SourceRegistry` — all RPCs hard-code the Alpaca client, making additional data providers (Polygon, Tiingo) require code changes instead of registration. The `SourceRegistry` pattern was implemented directly in this session (see context.md); the `realized_pnl` fix is pending.

---

## Specific Gap (from code audit 2026-05-19, revised 2026-05-20)

### xstockstrat-portfolio (`services/xstockstrat-portfolio/`)

| Gap | Location | Detail |
|---|---|---|
| `realized_pnl` always 0 | `internal/service/portfolio_service.go:255–270` | `GetPnL` computes unrealized correctly via `GetLatestQuote` but never sets `RealizedPnl`. Proto field exists (`portfolio/v1/portfolio.proto:60`). Requires querying ledger for paired `order.filled` events (entry + exit) to compute realized gain/loss. |

### xstockstrat-marketdata — SourceRegistry implemented 2026-05-20

| Item | Status |
|---|---|
| `StreamBars` polling stub (`client.go:164`) | **Not a problem** — no callers; 60s lag irrelevant for swing trading. |
| `StreamQuotes` polling stub (`client.go:198`) | **Not a problem** — no callers. |
| No `SourceRegistry` pattern | **Implemented** — `internal/source/source.go` added; `marketdata_service.go` + `main.go` updated. See context.md 2026-05-20 entry. |

---

## Why This Is Still Worth Fixing

`realized_pnl` is structurally wrong (always 0) — the insights dashboard and trader UI show incorrect total P&L for any closed position. No error is surfaced; it silently understates performance for profitable trades and overstates it for losers.

---

## Dependencies

None — this is a standalone data layer fix. Does not block or depend on any active feature.

## Next Action

Run `/sdd-story phase-2-data-layer` to generate the product spec covering the remaining `realized_pnl` gap (SourceRegistry is already done).
