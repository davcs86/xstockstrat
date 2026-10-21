# Product Spec: fix-ui-trader-feedback

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-ui-trader-feedback-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Observed.** (paths under `services/xstockstrat-ui/src/` unless noted)

- **D-11.** `hooks/useOrderUpdates.ts:25-27` swallows any stream error and never reconnects;
  `components/trader/OrdersTable.tsx:66` prefers the streamed record (`liveUpdates[o.orderId] ?? o`) over a
  fresher poll, so a stale NEW/PARTIALLY_FILLED masks FILLED/CANCELED. `components/trader/AlertStream.tsx:44-46`
  has the same silent stop.
- **D-17.** `environmentMode ?? 'paper'` in `app/trader/page.tsx:19`, `orders/page.tsx:16`, `positions/page.tsx:48`,
  `positions/[symbol]/page.tsx:110`, `portfolio/page.tsx:27`; `context/AccountContext.tsx:61-62` leaves the mode
  unknown on failure; `components/trader/OrderForm.tsx:139` then sends `PAPER`.
- **D-45.** `app/trader/positions/[symbol]/page.tsx:1149-1158` sends `strategyIdRef` without `strategyId`; analysis
  fingerprints only when `strategy_id == strategy_id_ref` (`services/xstockstrat-analysis/app/handlers/servicer.py:865-870`)
  and keys history/grade on `request.strategy_id`. The reference runner sends both
  (`app/insights/strategies/[id]/page.tsx:101-103`).
- **D-64.** No error feedback on `app/insights/opportunities/page.tsx:155-156` (Snooze/Dismiss/Take),
  `app/insights/signal-sources/page.tsx:254-263` (`handleToggle`), `app/trader/portfolio/page.tsx:108-113`
  (`onExportEvents`); no global mutation `onError` in `lib/queryClient.ts:11-17`.

**Expected.** For the **trader** (`/trader`) and the **insights analyst** (`/insights`): dropped streams are
visible and reconnect, and the newer record (by `updatedAt`) wins; the UI never asserts PAPER while the mode is
unknown; symbol-page runs earn evidence and appear in history; each failed action shows an error.

## Functional Requirements

- **FR-1 (D-11, freshness).** The orders table shows, per order, the record with the strictly newer `updatedAt`
  between the streamed update and the latest poll. On an equal or older polled `updatedAt` the streamed record
  is kept.
- **FR-2 (D-11, stream recovery).** When the `StreamOrderUpdates` or alert stream errors, the page shows a
  "live updates disconnected" indicator and re-subscribes with backoff. The indicator clears once a new stream
  is open, and status changes made at the broker after reconnect appear without a page reload.
- **FR-3 (D-17).** While the trading environment is unknown (`GetTradingEnvironment` failed or pending), the UI
  does not label the account or order entry as Paper, and `PlaceOrder` carries `TRADING_MODE_UNSPECIFIED`.
  The server then resolves the mode (`resolveTradingMode`, `services/xstockstrat-trading/internal/service/trading.go:3573-3582`,
  verified 2026-10-21). Blocking order entry was the rejected alternative: it adds a dead state, while the
  server already owns the derivation.
- **FR-4 (D-45).** A backtest run from `/trader/positions/[symbol]` with a selected strategy sends both
  `strategyId` and `strategyIdRef` set to that strategy, so the run is fingerprinted and listed in that
  strategy's history and grade, the same as the reference runner.
- **FR-5 (D-64).** A failed Snooze/Dismiss/Take on `/insights/opportunities`, a failed source toggle on
  `/insights/signal-sources`, and a failed ledger export on `/trader/portfolio` each show a user-visible error.
  No unhandled promise rejection occurs. A global mutation `onError` fallback in `lib/queryClient.ts` covers
  mutations that have no per-call handler.

## Consumer Surface(s)

- **`/trader` (trader).** `/trader/orders` and the dashboard: fresher terminal status wins, and a
  disconnected-stream indicator appears with auto-reconnect (FR-1, FR-2). The alert stream gets the same
  treatment (FR-2). Dashboard, orders, positions, `positions/[symbol]` and portfolio: no Paper label while the
  mode is unknown, and order entry sends UNSPECIFIED (FR-3). `positions/[symbol]`: backtest runs now land in
  the strategy history (FR-4). `portfolio`: error shown when export fails (FR-5).
- **`/insights` (insights analyst).** `opportunities` and `signal-sources`: error shown when an action fails
  (FR-5). `strategies/[id]`: history now includes symbol-page runs (FR-4).
- No new routes, so no nav registration change.

## Trading-Domain Notes

- **Paper vs live (C-3).** The fix behaves the same in production (live) and staging (paper). FR-3 removes a
  client-side PAPER assertion and defers to the server's environment-derived mode. Testing on dev (staging =
  paper) is paper-safe.
- **Brokers / order types (C-2/C-4).** All `BrokerType` values (ALPACA, IBKR) and all order types are
  unaffected. Only the client's `tradingMode` field and the UI rendering change.

## Reproduction Steps

1. D-11: open `/trader/orders`, restart trading, fill/cancel the order at the broker — stale status persists.
2. D-17: fail `GetTradingEnvironment`; submit an order — request carries `PAPER`.
3. D-45: backtest from `/trader/positions/AAPL?strategy=<id>`; it is absent from `/insights/strategies/<id>` history.
4. D-64: force each of the three calls to fail; nothing is shown.

## Root Cause Hypothesis

Fire-and-forget stream hook with no freshness rule (D-11); a display default leaking into requests (D-17); a
half-copied request shape (D-45); per-call `onError` omitted with no global fallback (D-64).

## Affected Services

- xstockstrat-ui (fix site for all four)
- xstockstrat-analysis (D-45 evidence/history semantics; see Open Questions NC-D — change only if a phantom-row write is confirmed)
- xstockstrat-trading (read-only: `TRADING_MODE_UNSPECIFIED` is derived server-side by `resolveTradingMode`;
  confirmed 2026-10-21, no change)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev. D-11 needs a Playwright e2e (per the surveyor's trade-off note).

## Open Questions

- [ ] **NC-D.** Does today's symbol-page run (with `strategyIdRef` but no `strategyId`) write a phantom
  history/grade row in analysis keyed on an empty or other `strategy_id`? If yes, analysis gets a change
  (and possibly a cleanup) in this feature. If no, analysis stays untouched and FR-4 is UI-only. Resolve in
  `/sdd-design` recon.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- The missing unpriced guard on `/trader/portfolio` and `positions/[symbol]` (feature-gap I-15)
