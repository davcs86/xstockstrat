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

**Expected.** Dropped streams are visible and reconnect, and the newer record (by `updatedAt`) wins; the UI never
asserts PAPER while the mode is unknown; symbol-page runs earn evidence and appear in history; each failed action
shows an error.

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
- xstockstrat-analysis (D-45 evidence/history semantics; open question NC-D — change only if a phantom-row write is confirmed)
- xstockstrat-trading (read-only: confirm `TRADING_MODE_UNSPECIFIED` is derived server-side, for D-17)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev. D-11 needs a Playwright e2e (per the surveyor's trade-off note).

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- The missing unpriced guard on `/trader/portfolio` and `positions/[symbol]` (feature-gap I-15)
