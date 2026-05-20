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

Fix the one real correctness gap left by the Phase 2 skip: `GetPnL` in `xstockstrat-portfolio` always returns `realized_pnl = 0` because the ledger is never queried for closed-position events. Unrealized P&L is correct. The `SourceRegistry` pattern (for multi-provider marketdata) is a separate extensibility concern, not a correctness bug.

---

## Specific Gap (from code audit 2026-05-19, revised 2026-05-20)

### xstockstrat-portfolio (`services/xstockstrat-portfolio/`)

| Gap | Location | Detail |
|---|---|---|
| `realized_pnl` always 0 | `internal/service/portfolio_service.go:255–270` | `GetPnL` computes unrealized correctly via `GetLatestQuote` but never sets `RealizedPnl`. Proto field exists (`portfolio/v1/portfolio.proto:60`). Requires querying ledger for paired `order.filled` events (entry + exit) to compute realized gain/loss. |

### xstockstrat-marketdata — assessed and dismissed

| Item | Verdict |
|---|---|
| `StreamBars` polling stub (`client.go:164`) | **Not a problem** — no service calls `StreamBars`; all consumers (`analysis`, `trading`) use `GetBars` (request/response). 60s lag is irrelevant for a position/swing trading platform. |
| `StreamQuotes` polling stub (`client.go:198`) | **Not a problem** — same reason; no callers. |
| No `SourceRegistry` pattern | **Out of scope here** — extensibility concern for a future add-data-source feature, not a correctness bug. |

---

## Why This Is Still Worth Fixing

`realized_pnl` is structurally wrong (always 0) — the insights dashboard and trader UI show incorrect total P&L for any closed position. No error is surfaced; it silently understates performance for profitable trades and overstates it for losers.

---

## Dependencies

None — this is a standalone data layer fix. Does not block or depend on any active feature.

## Next Action

Run `/sdd-story phase-2-data-layer` to generate the product spec, then `/sdd-spec` for the implementation spec.
