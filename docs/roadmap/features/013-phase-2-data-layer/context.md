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
