# Reference — Phase 2: handle the oversized backtest output

`run_backtest` returns full day-by-day diagnostics (OHLCV + computed indicators + per-bar decision
for every bar of every symbol). For a single liquid symbol over ~2 years this is ~6k–10k lines /
~200k–290k characters — reliably **over the tool-output token limit**. The harness saves the payload
to a file and hands you the path instead of the content. **Never read that file raw** (it will blow
your context the same way); extract only what you need with `python3`.

## The JSON shape (what to pull)

Top level of each result file:
- `status` — `BACKTEST_STATUS_OK`, `..._INSUFFICIENT_DATA`, etc.
- `total_trades`, `total_return`, `max_drawdown`, `win_rate`, `sharpe_ratio`, `profit_factor`
- `trades[]` — each `{symbol, side, qty, entry_price, exit_price, pnl, entry_time, exit_time}`
- `warnings[]` — run-level strings you must report, never drop (e.g. the seed-span and sector
  warnings in SKILL.md, or `fundamentals fetch failed for <SYM> — rerun`, see below).
- `diagnostics[]` — per symbol: `{symbol, bars[], bars_total, warmup_bars, no_trade_reason,
  fundamentals_gap}`;
  each bar `{timestamp, close, indicators:{...}, action, ...}`. Indicator keys (e.g. `z`, `er`) are
  **omitted on warm-up/undefined bars** — absent, not null. `no_trade_reason` explains a 0-trade run
  (`NO_TRADE_REASON_ENTRY_NEVER_TRUE` = signal never fired; often a broken/edited strategy —
  see the mutation guard in SKILL.md).
  - `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` = the strategy requires fundamentals (a fundamental
    operand, or a custom formula declaring `fundamental_inputs`) and the symbol had no usable filing
    in the range, so it was **refused, not evaluated**. The symbol gets no trades, empty `bars` and
    no evidence cell, and a run with one refused symbol is `BACKTEST_STATUS_INSUFFICIENT_DATA`.
    Check `fundamentals_gap`: `FUNDAMENTALS_GAP_ETF` (an ETF), `_NOT_ETF` (e.g. a non-SEC filer or an
    un-backfilled symbol) or `_UNSPECIFIED` (label unknown). It is never a no-signal result.
  - A fundamentals **outage** is different: the symbol gets no reason 5, no evidence cell, and a
    `warnings` entry `fundamentals fetch failed for <SYM> — rerun`. Rerun it; do not read it as a
    no-signal.
  - `NO_TRADE_REASON_EVALUATION_FAILED` = the symbol was **not evaluated** (an upstream RPC error or
    an unexpected exception); read its `backtest symbol <SYM> not evaluated: <CODE>` warning. It is
    never a no-signal result. `UNAVAILABLE`, `DEADLINE_EXCEEDED` or `RESOURCE_EXHAUSTED` → rerun
    later; `PERMISSION_DENIED`, `NOT_FOUND` or a Python exception name → report it. Never backfill:
    the run is `INSUFFICIENT_DATA` with empty `coverage_gaps` when nothing traded.
  - `NO_TRADE_REASON_FORMULA_ERROR` = a formula failed: a contract error (e.g. raw `NaN`/`inf`
    output), or a formula indicators refuses to run for the strategy owner. The owner-unreadable
    case reads the same for admin and owner callers and adds the same `not evaluated: <CODE>`
    warning with `PERMISSION_DENIED` (admin caller) or `NOT_FOUND` (owner) — report it.
- `DEADLINE_EXCEEDED` `backtest exceeded Ns deadline` and
  `FAILED_PRECONDITION` `backtest bar series incomplete: …` are RPC errors, not result fields:
  there is no result file to parse. Unlike the fundamentals-outage `warnings` entry above,
  `backtest bar series incomplete` is not fixed by a rerun — report it.

## Extract-summary recipe

Run one small script over the saved file(s); print only scalars, never bar arrays:

```python
import json, glob, os
from collections import Counter
# newest N result files (one per single-symbol run in this batch):
for f in sorted(glob.glob("<tool-results-dir>/*run_backtest*.txt"), key=os.path.getmtime)[-N:]:
    d = json.load(open(f))
    sym = d["diagnostics"][0]["symbol"]
    per = Counter(t["symbol"] for t in d.get("trades", []))
    print(sym, d["status"], d["total_trades"],
          round(d["total_return"], 6), round(d["max_drawdown"], 6),
          round(d["win_rate"], 6), dict(per))
```

Tips:
- Map files to symbols by reading `diagnostics[0].symbol` inside each file, not by guessing from
  call order — parallel calls finish out of order.
- To sanity-check an indicator, index bars by date: `by = {b["timestamp"][:10]: b for b in bars}`
  then `by["2024-12-17"]["indicators"].get("z")` (use `.get`, since the key may be absent on
  warm-up bars).
- If you must inspect the whole file (rare), delegate to a subagent with the harness's verbatim
  "read in ~1250-line chunks and return only the findings" instruction, so the raw content stays
  out of your context.
