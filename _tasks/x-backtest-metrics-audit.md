# Backtest metrics & execution-model probe — READ-ONLY audit

**Scope:** `services/xstockstrat-analysis` backtest engine. Pins the fill model, sizing/concurrency,
and annualization metric to source so return magnitudes can be interpreted before any Part B sweep is
acted on. **No code was applied.** All citations are `services/xstockstrat-analysis/…:line`.

**Engine location.** RPC `RunBacktest` — `packages/proto/analysis/v1/analysis.proto:13`; result message
`BacktestResult` (`total_return`, `annualized_return`, `sharpe_ratio`, `max_drawdown`, `win_rate`,
`total_trades`, `profit_factor`) — `analysis.proto:84-107`. Handler:
`app/handlers/servicer.py:381` (`RunBacktest`). Per-symbol simulators: `_backtest_symbol_evaluated`
(composed StrategyDefinition path — used by `dip_buyer_vol_stop` and all Part B strategies) at
`app/handlers/servicer.py:1077`; `_backtest_symbol` (default SMA-crossover path) at `:842`. Metric
core: `_compute_metrics` at `:3614`.

---

## Q1 — Fill model

**Same-bar close, ± slippage. There is no next-bar-open fill anywhere** (grep for
`next_open`/`open[`/`i+1`/`shift(` in the handler returns nothing; both simulators set
`price = bar.close`).

Composed-strategy path (`_backtest_symbol_evaluated`):
- Bar price is the **current bar's close**: `price = bar.close` — `servicer.py:1172`.
- **Entry** fills at same-bar close × (1 + slippage): `fill_price = price * (1 + slippage)` —
  `servicer.py:1187`. The entry decision `decisions[i]` is evaluated on bar `i`'s own indicator series
  (`evaluator.evaluate_with_series(...)`, `:1109`), then filled at that same bar's close.
- **Exit** (any exit, including the `vts crosses_below 0` stop) fills at same-bar close ×
  (1 − slippage): `fill_price = price * (1 - slippage)` — `servicer.py:1205`. The stop is not a
  separate price path: `vts crosses_below 0` simply makes `decision.exit` true on bar `i`
  (`:1198`) and the position is closed at bar `i`'s close.
- **Forced close** of any position still open on the last bar: `last_bar.close * (1 - slippage)` —
  `servicer.py:1236-1237`.

Default SMA path is identical: `price = bar.close` (`:964`), entry `price * (1 + slippage)`
(`:1003`), exit `price * (1 - slippage)` (`:1016`), forced close `last_bar.close * (1 - slippage)`
(`:1050`).

**Consequence for interpretation:** filling at the *same* close that generated the signal is a mild
look-ahead / frictionless-fill assumption (you cannot both observe a bar's close and transact at it).
Commission/slippage defaults are small (`analysis.backtest.default_commission_pct` 0.001,
`default_slippage_pct` 0.0005), so realized fills are close to raw closes. This inflates returns
relative to a next-bar-open model but does so **consistently across every banked run**, so it does not
by itself explain the +193% outlier — Q2 does.

---

## Q2 — Sizing & concurrency  *(this is the mechanism behind +193%)*

**Sizing.** 95% of *current running equity* per position, single position per symbol at a time:
`shares = (equity * 0.95) / fill_price` — `servicer.py:1188` (SMA path identical at `:1004`). The
`position == 0.0` gate (`:1181`) forbids pyramiding within a symbol; a `cost <= equity` guard
(`:1190`) prevents over-commit.

**Concurrency — there is none across symbols, and the per-symbol P&Ls are NOT summed. They are
serially compounded (a parlay).** This is the load-bearing finding:

1. `RunBacktest` seeds one running scalar `equity = initial_capital` (100k) and a curve with a single
   seed point: `daily_equity = [equity]` — `servicer.py:501-503`.
2. It iterates symbols **sequentially** in a `for symbol in request.symbols` loop — `servicer.py:522`.
3. Each symbol is backtested starting from **the previous symbol's ending equity**, not from 100k:
   `_backtest_symbol_evaluated(..., initial_equity=equity, ...)` where `equity` is rebound to the
   simulator's return value each iteration — `servicer.py:525-529`, and the simulator opens with
   `equity = initial_equity` (`:1144`).
4. Each symbol's per-bar curve is **concatenated end-to-end** onto the aggregate:
   `daily_equity.extend(daily_eq)` — `servicer.py:571`.
5. Aggregate `total_return` is taken from the **final** concatenated equity value vs the original 100k:
   `total_return = (equity[-1] - initial_equity) / initial_equity` — `servicer.py:3630`, computed by
   the aggregate call `_compute_metrics(daily_equity, all_trades, initial_equity)` at
   `servicer.py:623`.

Because step 3 rolls the entire accumulated equity into the next symbol, the aggregate return is a
**multiplicative chain over all 33 symbols**:

```
total_return = Π (1 + rᵢ) − 1     for i = 1..N symbols   (not  Σ wᵢ·rᵢ)
```

Order of `request.symbols` matters, capital is never split across symbols, and nothing is ever held
concurrently. This is a 33-leg parlay, not a diversified portfolio. Even modest average per-symbol
gains compound to a very large aggregate — e.g. 33 legs at a ~3.3% mean geometric gain give
`1.033^33 − 1 ≈ +193%`. **That is the mechanism producing the implausible +193% for
`dip_buyer_vol_stop`.** The per-symbol PF and drawdown deltas the operator saw are trustworthy
(computed on single-symbol cells, see below); the *absolute aggregate return figure is an artifact of
serial compounding and must not be read as a portfolio return.**

**Which path produces `total_return`:** exclusively the aggregate `_compute_metrics` call at
`servicer.py:623`, fed the concatenated `daily_equity`.

**Per-symbol evidence cells are separate and correct.** For each symbol the engine also computes a
standalone cell from that symbol's own curve seeded at its own starting equity:
`cell_m = _compute_metrics(daily_eq, trades, daily_eq[0])` — `servicer.py:558`. These single-symbol
cells (`sharpe_ratio`, `max_drawdown`, `win_rate`, `total_return`, `trading_days`) are what feed the
feature-065 derived grade — **not** the parlayed aggregate. So relative per-strategy comparison on
PF/DD is sound; only the headline aggregate return is distorted.

---

## Q3 — Annualization

**Verbatim formula** (`servicer.py:3630-3632`):

```python
total_return = (equity[-1] - initial_equity) / initial_equity
n_days = len(daily_equity) - 1
annualized_return = (1 + total_return) ** (252.0 / max(n_days, 1)) - 1 if n_days > 0 else 0.0
```

**Diagnosis — the formula itself is a correct geometric annualization; the bug is the `n_days` input.**
`n_days` is derived from the length of `daily_equity`, but for the aggregate call `daily_equity` is the
**concatenation of all 33 per-symbol curves** (Q2 step 4). So instead of ≈252 (one year of trading
bars) it is ≈ `N × window_bars ≈ 33 × 252 ≈ 8300`. The exponent `252 / n_days` is therefore ~33×
too small, under-scaling the annualized figure by the same factor. This is **not** a flat divisor, a
geometric-vs-arithmetic error, or a daily-formula-on-a-cumulative — it is the right formula fed a
period count that counts symbols × days instead of days.

**Confirmed against the three observed pairs** (solving `(1+total)^x − 1 = annualized` for the
exponent `x = 252/n_days`, hence `n_days`):

| total_return | reported annualized | implied exponent `x` | implied `n_days` |
|---|---|---|---|
| −0.0650 | −0.00207 | 0.03083 | ≈ 8173 |
| +0.2152 | +0.00603 | 0.03084 | ≈ 8172 |
| −0.2126 | −0.00735 | 0.03086 | ≈ 8166 |

The implied `n_days` is **constant at ≈8170** across all three (≈ 33 × 248), and `8170 / 252 ≈ 32.4`.
The exponent is constant (confirming a single geometric formula, not a variable divisor); the
*apparent* ratio annualized/total is non-constant only because the geometric map is non-linear. This
nails the cause: `n_days` = length of the concatenated multi-symbol curve, ~33× the true window.

**Sharpe — NOT the same bug; do not "fix" it.** `sharpe_ratio = (mean_r / std_r) * math.sqrt(252)` —
`servicer.py:3636`, with `returns = np.diff(equity) / equity[:-1]` (`:3627`). The periodization factor
is a **flat `sqrt(252)`** (correct daily→annual vol scaling) and does **not** depend on `n_days`, so it
carries none of the ≈30× scaling error. The observed sign divergence from `total_return` on one run is
an **arithmetic-vs-geometric** effect: `mean_r` is the arithmetic mean of per-bar returns pooled across
all 33 symbols, which can be positive while the compounded `total_return` is negative (volatility drag),
or vice versa. It is a real interpretability caveat but not a periodization defect, and changing
`sqrt(252)` would perturb a banked comparability metric for no correctness gain. **Excluded from the
proposed patch.**

---

## Proposed minimal diff — annualization only (DO NOT APPLY here)

Scope the fix to the **aggregate** call site only. The per-symbol cell calls at `servicer.py:558` pass a
single-symbol curve whose length ≈ the true window trading days, so they are already correct and must
stay untouched (they feed the grades). Annualize the aggregate over the run's **real calendar span**,
which is independent of how many symbols were concatenated.

```diff
--- a/services/xstockstrat-analysis/app/handlers/servicer.py
+++ b/services/xstockstrat-analysis/app/handlers/servicer.py
@@ def _compute_metrics(daily_equity: list[float], trades: list, initial_equity: float) -> dict:
-def _compute_metrics(daily_equity: list[float], trades: list, initial_equity: float) -> dict:
+def _compute_metrics(
+    daily_equity: list[float],
+    trades: list,
+    initial_equity: float,
+    period_years: float | None = None,
+) -> dict:
     """Compute backtest performance metrics from daily equity curve and trade list."""
     if len(daily_equity) < 2:
         return {
@@
     total_return = (equity[-1] - initial_equity) / initial_equity
-    n_days = len(daily_equity) - 1
-    annualized_return = (1 + total_return) ** (252.0 / max(n_days, 1)) - 1 if n_days > 0 else 0.0
+    if period_years is not None and period_years > 0:
+        # Annualize over the run's real calendar span, NOT the equity-curve length.
+        # RunBacktest threads one running equity serially through each symbol and
+        # concatenates the per-symbol curves, so len(daily_equity)-1 ≈ N_symbols ×
+        # window_days — ~33× too large, which under-scaled the old 252/n_days exponent
+        # by the same factor. Per-symbol cell calls omit period_years and keep the
+        # single-symbol curve-length behaviour (which is correct for one symbol).
+        annualized_return = (1 + total_return) ** (1.0 / period_years) - 1
+    else:
+        n_days = len(daily_equity) - 1
+        annualized_return = (
+            (1 + total_return) ** (252.0 / max(n_days, 1)) - 1 if n_days > 0 else 0.0
+        )
```

```diff
@@ async def RunBacktest(self, request, context):
-        # Compute aggregate metrics
-        metrics = _compute_metrics(daily_equity, all_trades, initial_equity)
+        # Compute aggregate metrics. Annualize over the real window span (request.range is
+        # already defaulted above), not the concatenated multi-symbol curve length.
+        _span_seconds = request.range.end.seconds - request.range.start.seconds
+        _period_years = (_span_seconds / 86_400.0) / 365.25 if _span_seconds > 0 else None
+        metrics = _compute_metrics(daily_equity, all_trades, initial_equity, _period_years)
```

`request.range.start/end` are guaranteed populated by the defaulting block at `servicer.py:490-498`,
so `_span_seconds > 0` holds for every reachable call.

### Proposed unit test (new — `tests/test_compute_metrics_annualization.py`)

```python
import math
from app.handlers.servicer import _compute_metrics


def test_annualized_matches_total_over_one_year():
    # (total_return -> pre-fix annualized) pairs observed in staging, ~30x under-scaled:
    #   -0.0650 -> -0.00207,  +0.2152 -> +0.00603,  -0.2126 -> -0.00735
    # Over a ~1-year window annualized must ≈ total_return.
    for total in (-0.0650, 0.2152, -0.2126):
        curve = [100_000.0, 100_000.0 * (1 + total)]
        m = _compute_metrics(curve, [], curve[0], period_years=1.0)
        assert math.isclose(m["annualized_return"], total, rel_tol=1e-9, abs_tol=1e-9)


def test_annualized_scales_geometrically_sub_year():
    total = 0.2152
    curve = [100_000.0, 100_000.0 * (1 + total)]
    m = _compute_metrics(curve, [], curve[0], period_years=0.5)
    # +21.52% over 6 months -> (1.2152)^2 - 1 ≈ +47.7%
    assert math.isclose(m["annualized_return"], (1 + total) ** 2 - 1, rel_tol=1e-9)


def test_default_path_unchanged_for_single_symbol_cell():
    # No period_years -> legacy curve-length behaviour (per-symbol cells rely on this).
    curve = [100_000.0] + [100_000.0 * (1 + 0.001 * i) for i in range(1, 253)]
    m = _compute_metrics(curve, [], curve[0])
    assert m["annualized_return"] != 0.0  # exercises the fallback branch
```

---

## DO NOT AUTO-APPLY — notes for whoever lands this

- **Forward-only fix.** The patch corrects `annualized_return` for *future* runs only. Historical
  `analysis.backtest_runs.annualized_return` rows (written at `servicer.py:1562`) and any persisted
  `BacktestResult` bytes keep the ~30× under-scaled value until the affected runs are re-executed or a
  one-off backfill recomputes the column from stored `total_return` + each run's window span.
- **Grade impact: none from this metric.** The feature-065 derived grade blends only
  `sharpe_ratio`, `max_drawdown`, `win_rate` (`_score_from_metrics`, `servicer.py:3307-3333`) taken
  from the **per-symbol cells** — `annualized_return` is not a grade input, and the cell computations
  are deliberately left untouched by this diff. So this annualization fix is **grade-neutral**; no
  derived-grade recompute is required for correctness. (Recompute grades only if a separate change to
  the cell metrics or the sizing/execution model is made — which this audit explicitly does **not**
  propose.)
- **Out of scope by instruction.** The serial-compounding aggregate (`total_return` parlay, Q2) and
  the same-bar-close fill (Q1) are left exactly as-is: changing sizing/fill/execution semantics would
  retroactively break comparability of every banked backtest. Those are documented here as
  interpretation caveats, not defects to patch in this pass.
- **Interpretation rule for Part B (and any return-magnitude decision):** absolute aggregate returns
  are a 33-leg serial parlay and are only meaningful once the sizing model is intentionally redesigned;
  rank strategies on **profit-factor and max-drawdown deltas** (per-symbol-cell derived), not on
  headline `total_return`/`annualized_return`.
