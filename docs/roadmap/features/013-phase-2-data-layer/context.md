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

**Revised scope**: Only gap worth fixing is `GetPnL.realized_pnl = 0` in `portfolio_service.go:255–270`. SourceRegistry dismissed as extensibility-only. feature.md updated accordingly.

---

## 2026-05-20 — Origin of StreamBars/StreamQuotes clarified

**Trigger**: User asked what the RPCs were originally designed for.

**Finding**: Roadmap Phase 5C (`implementation-roadmap.md:442`) explicitly specified a "Chart panel: `StreamBars` / `GetBars` OHLCV candlestick chart" in `xstockstrat-trader`. `StreamQuotes` was intended to feed live bid/ask price to the order entry form. Neither was built — `phase5-deviations.md` documents other trader changes (Connect-RPC refactor, SSE alert polling) but silently drops the chart panel.

**Implication**: The streaming RPCs are not dead code — they are waiting for a trader chart panel feature. When that feature is built, the choice between true WebSocket streaming vs. polling `GetBars` should be revisited based on the required bar timeframe (1D bars need no streaming; 1m bars might justify it).

---

## 2026-05-20 — fill.Mode verification + partial fill event-type correction

**Trigger**: User asked to verify whether fill.Mode distinguishes partial fills.

**Finding**: `fill.Mode` confirmed as trading mode only (`json:"trading_mode"`, values `"TRADING_MODE_PAPER"` / `"TRADING_MODE_LIVE"` — `portfolio_service.go:112`). Not related to partial fills.

**Critical discovery**: Two distinct ledger event types exist (`trading.go:511–526`):
- `order.filled` — fires **once** when order is fully filled; payload key `qty` = total order qty
- `order.partially_filled` — fires during Alpaca polling as order fills incrementally; payload key `filled_qty` = cumulative partial qty

The existing portfolio subscriber (`portfolio_service.go:88`) already filters on `order.filled` only. `GetPnL` must do the same. `order.partially_filled` events are observability-only and excluded from P&L computation.

**Spec corrections**:
- FR-2: corrected "multiple `order.filled` events for one order" (wrong) to "one `order.filled` per completed order; `order.partially_filled` excluded"
- AC-4: corrected "partial fills" to "multiple independent completed orders"
- Impl-spec evidence: added two-event-type finding at Step 1
- Test renamed: `TestRealizedPnL_PartialFills` → `TestRealizedPnL_MultipleOrders` (tests multiple independent orders, not partial fills)

---

## 2026-05-20 — spec amendments: short-selling support + partial fill clarification

**Trigger**: User clarified two out-of-scope decisions after impl-spec review.

**Changes to product-spec.md**:
- FR-2 updated: partial fills processed as independent events per ledger order, no pre-aggregation
- FR-4 added: short-selling P&L supported read-only (observe ledger events, no order creation)
- Out of Scope: "Short-selling P&L" replaced with "Short order creation" (read-only is now in scope)
- AC-2 added for closed short positions; AC-4 added for partial fill equivalence
- Open questions: partial fill question marked resolved

**Changes to implementation-spec.md**:
- Step 1: algorithm updated to signed accumulator (unified long/short); `math.Abs` import check added; position reversal handled (excess fill qty opens opposite-direction position)
- Step 1: evidence extended to confirm `fill.Mode` (Go field name, L112) and all three `PnLResponse` fields (L376–378) — closes both ✗ failures from /sdd-review impl-spec
- Step 2: tests renamed; `TestRealizedPnL_ClosedShort` and `TestRealizedPnL_PartialFills` added; total test count = 5

---

## 2026-05-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: Feature `wire-fe-auth` (012, code-completed) also modifies `xstockstrat-portfolio` and `xstockstrat-ledger` — merge 012 first.
- Overlap findings: no FAIL-level conflicts; two ⚠ WARN on shared services with wire-fe-auth.

---

## 2026-05-20 — sdd-story: product spec generated

- Created product-spec.md and rewrote feature.md (status: idea → draft) from inline story.
- Scope confirmed: realized_pnl fix only. SourceRegistry already done; streaming stubs out of scope.
- Three open questions flagged in product-spec.md for /sdd-spec codebase audit: ledger event schema, existing ledger client wiring in portfolio, partial fill modeling.

---

## 2026-05-20 — SourceRegistry implemented (scope expansion — skipped SDD flow)

**Trigger**: User asked to fix the SourceRegistry gap in 013. Implementation was done directly without going through `/sdd-story` → `/sdd-spec` → `/sdd-execute` first. **Deviation from SDD process** — noted here for audit trail.

**Files changed**:
- `services/xstockstrat-marketdata/internal/source/source.go` — new file; `DataSourceClient` interface + `Registry` (Register/Get with "alpaca" default)
- `services/xstockstrat-marketdata/internal/source/source_test.go` — new file; 5 tests covering Register, Get, default, unknown, multi-provider, duplicate panic
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — replaced `alpaca *alpaca.Client` field with `registry *source.Registry`; all `s.alpaca.*` calls replaced with `s.registry.Get("")`
- `services/xstockstrat-marketdata/cmd/server/main.go` — creates `source.NewRegistry()`, registers alpaca client, passes registry to service constructor

**All 14 tests pass** (`source`, `alpaca`, `config` packages). Build clean.

**Remaining in 013**: `realized_pnl` always 0 in `xstockstrat-portfolio` — still pending `/sdd-story`.

---

## Session 2026-05-20T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 2 steps. Status → implementation-ready.
- Key codebase findings:
  - Bug confirmed at `services/xstockstrat-portfolio/internal/service/portfolio_service.go:254–272` — `GetPnL` returns `RealizedPnl = 0` (zero value); unrealized is computed correctly.
  - Ledger client already dialed in `NewPortfolioService` at L47 with `middleware.UnaryClientInterceptor` — header propagation is automatic; no new gRPC connection required.
  - `QueryEvents` unary RPC available on existing `s.ledger` client (`ledger_grpc.pb.go:36`). Filters `event_type + source_service`; user filtering must be done in-memory by comparing `payload.user_id` to `req.UserId`.
  - `order.filled` stream_key is `order:{order_id}` (not per-user); user_id is only in the event payload (`orderFillPayload` struct already defined at portfolio_service.go:107–114).
  - Last migration file: `003_positions_account_id` — no new migration needed (no schema changes).
  - `fillAccumulator` struct (new) and `computeRealizedPnL` test helper are the only new symbols; all imports are already present.
