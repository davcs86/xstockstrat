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

---

## 2026-05-20 — scope expansion: fill_price = 0 root cause in xstockstrat-trading

**Trigger**: User asked how IBKR handles fill price in `order.filled` events, leading to discovery that `fill_price = 0.0` for all orders across both brokers.

**Root cause confirmed**:
- `BrokerOrder` struct (`broker.go:6–9`) carries only `BrokerOrderID` and `Status` — no `FilledAvgPrice`.
- Alpaca `GetOrder` (`alpaca.go:206`): `AlpacaOrder.FilledAvgPrice string \`json:"filled_avg_price"\`` is present in the response struct (`alpaca.go:79`) but discarded; return is `&BrokerOrder{BrokerOrderID: alpacaResp.ID, Status: alpacaResp.Status}`.
- IBKR `GetOrder` (`ibkr.go:177–187`): inline response struct has only `orderId` and `status`; return is `&BrokerOrder{BrokerOrderID: o.OrderID, Status: o.Status}`.
- `pollFills` (`trading.go:500–502`): sets `order.Status` and `order.UpdatedAt` from broker response, but not `order.FilledAvgPrice`; stale comment at L502 documents this explicitly.
- Both `order.filled` (`trading.go:514`) and `order.partially_filled` (`trading.go:524`) events use `order.FilledAvgPrice`, which is always 0.0.

**User decision**: "yes, add it to the scope" — expand feature 013 to fix the root cause in `xstockstrat-trading` before implementing the portfolio service ledger query.

**Changes to product-spec.md**:
- Problem Statement: added root-cause paragraph
- FR-5: trading service must populate `FilledAvgPrice` in `BrokerOrder` and propagate to `order.filled` payload
- Affected Services: added `xstockstrat-trading`
- AC-8: non-zero `fill_price` in `order.filled` events after trading fix

**Changes to implementation-spec.md**:
- Total Steps: 2 → 5
- Execution Summary: updated to describe both service fixes
- Step Dependencies: updated for 5-step dependency chain
- Step 1 [broker]: extend `BrokerOrder` + update Alpaca `GetOrder` (parse string `filled_avg_price` via `strconv.ParseFloat`) + update IBKR `GetOrder` (add float64 `avgPrice` field to inline struct) — files: broker.go, alpaca.go, ibkr.go
- Step 2 [service]: update `pollFills` to set `order.FilledAvgPrice = brokerOrder.FilledAvgPrice`; remove stale comment at L502 — file: trading.go
- Step 3 [test]: append `TestGetOrder_AlpacaFilledAvgPrice` to alpaca_test.go; create ibkr_test.go with `TestGetOrder_IBKRAvgPrice`
- Old Step 1 → Step 4 (portfolio service GetPnL fix)
- Old Step 2 → Step 5 (portfolio service unit tests)

**Changes to feature.md**:
- Summary updated to mention root-cause
- Reviewers: added `xstockstrat-trading` service owner
- Next Action: updated to `/sdd-execute`

---

## 2026-05-20 — partially-filled-then-canceled orders added to scope

**Trigger**: User observed that partially filled orders that are never fully completed (e.g., buy 100 shares, only 50 fill, then canceled) would be silently dropped from realized P&L under the current spec. User explicitly: "i don't want the partially filled orders that are never fully completed to disappear silently. Include them in the scope."

**Design decision**: Two-pass approach.
- Pass 1: query `order.filled` events → accumulate P&L via `applyFill` closure, collect `filledOrderIDs map[string]bool`.
- Pass 2: query `order.partially_filled` events → collect `latestPartials map[string]orderFillPayload` (overwrite per `order_id` since events arrive in `recorded_at` order, so last = highest cumulative `filled_qty`). After the loop, for each `order_id` in `latestPartials` NOT in `filledOrderIDs`, call `applyFill(fill.FilledQty, fill.FillPrice, fill.Symbol)`.
- Note: Pass 1 complete fills are applied before Pass 2 partial fills, regardless of chronological order. On Alpaca this produces correct results in all cases: Alpaca prohibits simultaneous long and short positions in the same security entirely (any order that would produce an opposite-side position while the other side is open is rejected — confirmed via community forum and GitHub issues; the error is "position intent mismatch"). On IBKR: standard and margin accounts default to netting mode (opposing positions auto-offset) — same guarantee. IBKR Hedged mode (portfolio-margin/institutional, must be explicitly opted into) would break this assumption but is not targeted by the current IBKRConfig integration.

**Changes to product-spec.md**:
- FR-2 rewritten: two-pass algorithm; last-per-order deduplication of `order.partially_filled`; partial fills for non-completed orders are included
- AC-4 (multiple orders): unchanged; added AC-5 for partially-filled-then-canceled orders
- AC-8 (formerly AC-7): updated to mention 6 test cases including `TestRealizedPnL_PartiallyFilledCanceled`

**Changes to implementation-spec.md**:
- Step 4 Codebase Evidence: `orderFillPayload` needs `OrderID string \`json:"order_id"\`` and `FilledQty float64 \`json:"filled_qty"\``; updated two-event-type evidence bullet
- Step 4 Instructions: added section A (two new struct fields); replaced single-loop algorithm with `applyFill` closure + Pass 1 (`order.filled`) + Pass 2 (`order.partially_filled`) + post-loop application
- Step 5 Instructions: helper signature `computeRealizedPnL(completeFills, partialFills []orderFillPayload) float64`; added test 7 `TestRealizedPnL_PartiallyFilledCanceled` (partial buy 50@50 never completed + complete sell 50@70 → realized 1000.0); updated verification to "six new test cases"

---

## Session 2026-05-21T00:00:00Z — sdd-execute

**Steps this session**: [1]
**Progress**: 1 done / 5 total
**Stopped at**: Step 1 (PR created, awaiting merge)
**Next**: /sdd-execute phase-2-data-layer next (step-5 PR + integration PR)

### Step 1 — broker: extend BrokerOrder struct and update both GetOrder implementations [done]
- Added `FilledAvgPrice float64` to `BrokerOrder` in broker.go. Updated Alpaca `GetOrder` to parse `filled_avg_price` string via `strconv.ParseFloat`; updated IBKR `GetOrder` to add `avgPrice float64` to inline response struct and propagate to return value.
- Files modified: `services/xstockstrat-trading/internal/broker/broker.go`, `services/xstockstrat-trading/internal/broker/alpaca.go`, `services/xstockstrat-trading/internal/broker/ibkr.go`
- Deviations: none

### Step 2 — service: propagate FilledAvgPrice in pollFills [done]
- Replaced stale comment at trading.go:502 with `order.FilledAvgPrice = brokerOrder.FilledAvgPrice`. The `order.filled` event at L514 now emits the actual fill price from the broker instead of always 0.0.
- Files modified: `services/xstockstrat-trading/internal/service/trading.go`
- Deviations: none

### Step 5 — test: unit tests for GetPnL realized P&L computation [done]
- Added `computeRealizedPnL` helper and 6 tests to portfolio_helpers_test.go. All pass: NoFills, ClosedLong, ClosedShort, MultipleOrders, MixedOpenAndClosed, PartiallyFilledCanceled. Full suite with -race clean.
- Files modified: `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go`
- Deviations: none

### Step 4 — service: fix GetPnL to compute realized P&L from ledger order.filled events [done]
- Added `"math"` import and `OrderID`/`FilledQty` fields to `orderFillPayload`. Replaced `GetPnL` stub body with two-pass `QueryEvents` algorithm: Pass 1 accumulates `order.filled` events into a signed avg-cost-basis accumulator and tracks `filledOrderIDs`; Pass 2 accumulates `order.partially_filled` keeping last per order ID, applying only those not seen in Pass 1. Returns `RealizedPnl`, `UnrealizedPnl`, and `TotalPnl`. Added `fillAccumulator` type. Build clean.
- Files modified: `services/xstockstrat-portfolio/internal/service/portfolio_service.go`
- Deviations: none

### Step 3 — test: unit tests for broker fill price parsing [done]
- Appended `TestGetOrder_AlpacaFilledAvgPrice` to alpaca_test.go (asserts string "75.50" parses to float64 75.50). Created ibkr_test.go with `TestGetOrder_IBKRAvgPrice` (asserts float64 avgPrice 82.25 propagates correctly). Both new tests pass; full suite with -race also clean.
- Files modified: `services/xstockstrat-trading/internal/broker/alpaca_test.go`, `services/xstockstrat-trading/internal/broker/ibkr_test.go`
- Deviations: none

## Session 2026-05-22 (CI: feature status automation)

- Promotion PR #290 merged to main
- Feature promoted and committed: 1ff20d531e007cc519788dc50af97b4317cfc381
- Status updated: `code-completed` → `launched`
- Launched date: 2026-05-22
