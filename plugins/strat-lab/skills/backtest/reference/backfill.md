# Reference — Phase 1: ensure data coverage (backfill)

A backtest never errors for missing history — it just runs on whatever bars exist, so a symbol that
was never backfilled produces a short window, fewer trades, or an empty result that looks like a
strategy problem but is actually a data problem. Rule out the data cause **before** interpreting any
backtest.

## Steps

1. **Check coverage.** Call `get_backfill_status` for the symbols (and the strategy's data needs).
   Treat "no coverage" / a start date later than your intended window as a gap.
2. **Trigger if needed.** For any symbol with a gap, call `trigger_backfill`. Backfill is
   asynchronous — it returns before data is ready. `data_kind` selects what to fetch: `"bars"`
   (daily OHLCV, the default) or `"fundamentals"` (point-in-time fundamentals filings history —
   feature 198). A strategy that uses a `fundamental` operand (see `strategy-build.md`) needs its
   symbols backfilled with `data_kind="fundamentals"` in addition to bars; fundamentals backfill is
   timeframe-independent (omit/ignore `timeframe`).
3. **Wait by polling, not sleeping.** Re-check `get_backfill_status` until it reports complete. Do
   not block on a fixed sleep; poll the status and proceed when it flips to done. If a backfill
   stalls, surface it rather than backtesting on partial data. Polling is the default and always
   works; a `callback_url` (below) is the alternative when you have a listener.
4. **Only then backtest.** Enter Phase 2 once coverage spans (at least) the window you care about,
   plus the indicator warm-up (e.g. a 20-bar z-score needs ≥20 prior bars before its first valid
   value — a short backfill silently pushes the first signal later; see `verification.md` on the
   warm-up boundary).

## Optional: `callback_url` instead of polling

`trigger_backfill` accepts an optional `callback_url`. Pass it only when you have a webhook listener
you can wait on; without one, omit it and poll.

- **Rule.** The URL must be `https` and its origin must be on the platform's allowlist. The
  allowlist is empty by default, so expect a rejection unless the operator has allowlisted that
  origin. Example shape — `https://webhooks.example.net/hooks/<name>`.
- **It is validated before the job is queued.** Two immediate errors both mean **no job was
  created** — retry without `callback_url` and fall back to polling `get_backfill_status`:
  - `INVALID_ARGUMENT` (`callback_url rejected` plus a reason such as `scheme` or
    `origin_not_allowed`) — the URL breaks the rule; the same URL will be rejected again.
  - `UNAVAILABLE` saying `callback_url could not be validated; no job was created` — the validation
    was unreachable. This is not the "outcome unknown" case; nothing was queued.
- **When accepted.** The job's terminal event is POSTed to the URL as JSON, once per job and
  possibly more than once on retry (the `Idempotency-Key` header is the same each time). You can
  wait for it instead of polling; polling stays valid, and is the fallback if nothing arrives.
- **Read the status, not the event name.** The body is
  `{"event_name", "payload": {"source_service", "environment", "occurred_at", "data"}}` and `data`
  holds `job_id`, `status`, `data_kind`, `symbols`, `bars_processed`, `failed_symbols`, `started_at`,
  `completed_at`. The event named `ingest.backfill.completed` covers both `COMPLETED` and `PARTIAL`
  — check `data.status` before backtesting.
- **No error text in the body.** For a `FAILED` or `PARTIAL` job, call `get_backfill_status` with
  the `job_id` to read the error.

## When to skip

Skip Phase 1 only when the caller explicitly guarantees the symbols are already covered (e.g. you
just ran another backtest on the same names this session). When in doubt, a `get_backfill_status`
check is cheap; a wrong conclusion from missing data is not.

Backfill is also the wrong fix when a symbol was **not evaluated** (feature 275). Discriminate on
the result before triggering anything:

- **Backfill never** — an `INSUFFICIENT_DATA` run with empty `coverage_gaps` and
  `NO_TRADE_REASON_EVALUATION_FAILED` or `NO_TRADE_REASON_FORMULA_ERROR` rows. Only a symbol named in
  `coverage_gaps` is a backfill case.
- **Rerun later** — a `backtest symbol <SYM> not evaluated: <CODE>` warning whose code is
  `UNAVAILABLE`, `DEADLINE_EXCEEDED` or `RESOURCE_EXHAUSTED` (transient upstream failure).
- **Report** — the same warning with `PERMISSION_DENIED`, `NOT_FOUND` or a Python exception name
  (e.g. `ValueError`); a rerun or a backfill will not change it.
