# Context Log: phase-2-data-layer

Append-only session log. Never edit past entries.

---

## 2026-05-19 — Backlog entry created

**Session trigger**: User requested feature recommendation; code audit surfaced Phase 2 as a sleeper risk.

**Key findings from audit**:
- `services/xstockstrat-marketdata/internal/alpaca/client.go:164` — `StreamBars` is a polling stub (60s REST poll). Comment explicitly marks it as non-production.
- `services/xstockstrat-marketdata/internal/alpaca/client.go:198` — `StreamQuotes` is a polling stub (5s REST poll).
- No `SourceRegistry` pattern exists in `internal/service/marketdata_service.go` — all RPCs hard-code `s.alpaca.*`.
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go:255–270` — `GetPnL.RealizedPnl` always returns 0. `UnrealizedPnl` is computed correctly via `GetLatestQuote`.
- Proto field `portfolio/v1/portfolio.proto:60` confirms `realized_pnl` is specified.

**Status**: `idea` — no product spec yet.

---

## 2026-05-20 — Scope revision: streaming gaps dismissed

**Trigger**: User questioned whether WebSocket streaming is needed for a non-day-trading platform.

**Follow-up audit findings**:
- `grep -rn "StreamBars\|StreamQuotes\|SubscribeBars\|SubscribeQuotes"` across `xstockstrat-trading`, `xstockstrat-analysis`, `xstockstrat-indicators` — **zero callers**. No service calls the streaming RPCs.
- All consumers (`analysis/app/handlers/servicer.py:197`, `trading`) use `GetBars` (request/response over REST). Polling stubs are irrelevant.
- `SourceRegistry` is an extensibility concern for future multi-provider support, not a correctness bug.

**Revised scope**: Only gap worth fixing is `GetPnL.realized_pnl = 0` in `portfolio_service.go:255–270`. feature.md updated accordingly.
