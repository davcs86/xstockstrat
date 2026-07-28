# Reference — Phase 4: verify before trusting

A backtest from a strategy you just created, edited, or restored is unverified. Prove it reproduces
a known-good reference before you report its numbers as fact.

## The oracle / credibility gate

An **oracle** is a set of known-good outputs for the same strategy + symbols: a prior report's
table, or a run captured before you changed anything. The gate passes when the new run matches the
oracle **to the digit** on:

- `total_trades`, `total_return`, `max_drawdown`, `win_rate`, `profit_factor`
- the full trade blotter (entry/exit dates, prices, pnl) for at least one symbol
- a couple of **per-bar indicator checkpoints** — e.g. on the known entry bar, `z` and `er` equal
  the oracle's values to ~1e-9. This is what proves a reconstructed indicator formula is faithful,
  not just approximately right.

Match → trustworthy in direction and magnitude. Mismatch → a finding to investigate and report, not
something to round away.

## Reconstructing an indicator formula (when you must)

If you had to rebuild a custom formula (e.g. after a definition was wiped), **validate the math
offline first** against the oracle's per-bar values before writing it live: pull the real `close`
series from a known-good result file and compute candidate formulas in `python3` until they
reproduce the oracle exactly. Two details that bit us and are worth checking explicitly:

- **Std ddof.** A rolling z-score uses sample std (`ddof=1`, pandas `.rolling(n).std()` default),
  not population std. The wrong ddof matches nowhere.
- **Non-finite output.** Formula output must convert `NaN` (warm-up) and `inf` (divide-by-zero) to
  `None`; raw `NaN`/`inf` are not valid JSON and the backend rejects the formula
  (`NO_TRADE_REASON_FORMULA_ERROR`).
- **Param types.** Component params can round-trip as floats (`period` → `20.0`); cast to `int`
  inside the formula or pandas `.rolling(20.0)` / `.shift(10.0)` raises.

## The one benign source of drift

Backtests use a **rolling window that ends "today,"** so re-running the same strategy on a later
calendar day shifts the window start. If everything matches the oracle except one symbol whose
first trade sits near the indicator warm-up boundary, that lone difference is the window advancing
(fewer warm-up bars → a boundary entry fires a few days later), **not** a formula error. Confirm by
checking that indicator values still match exactly on every bar where they are defined, and that the
divergence is confined to the boundary trade. Say so explicitly in the report.
