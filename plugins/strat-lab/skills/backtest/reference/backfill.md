# Reference — Phase 1: ensure data coverage (backfill)

A backtest never errors for missing history — it just runs on whatever bars exist, so a symbol that
was never backfilled produces a short window, fewer trades, or an empty result that looks like a
strategy problem but is actually a data problem. Rule out the data cause **before** interpreting any
backtest.

## Steps

1. **Check coverage.** Call `get_backfill_status` for the symbols (and the strategy's data needs).
   Treat "no coverage" / a start date later than your intended window as a gap.
2. **Trigger if needed.** For any symbol with a gap, call `trigger_backfill`. Backfill is
   asynchronous — it returns before data is ready.
3. **Wait by polling, not sleeping.** Re-check `get_backfill_status` until it reports complete. Do
   not block on a fixed sleep; poll the status and proceed when it flips to done. If a backfill
   stalls, surface it rather than backtesting on partial data.
4. **Only then backtest.** Enter Phase 2 once coverage spans (at least) the window you care about,
   plus the indicator warm-up (e.g. a 20-bar z-score needs ≥20 prior bars before its first valid
   value — a short backfill silently pushes the first signal later; see `verification.md` on the
   warm-up boundary).

## When to skip

Skip Phase 1 only when the caller explicitly guarantees the symbols are already covered (e.g. you
just ran another backtest on the same names this session). When in doubt, a `get_backfill_status`
check is cheap; a wrong conclusion from missing data is not.
