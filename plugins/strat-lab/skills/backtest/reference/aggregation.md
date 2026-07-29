# Reference — Phase 3: aggregate the basket

There are **two different "baskets"** and they give different numbers. Know which one the request
means before you aggregate.

## Sequential (multi-symbol call) vs independent (per-symbol)

- **Sequential-capital basket** — pass all symbols to one `run_backtest` call. The engine shares
  and compounds one capital pool across symbols in time order, so a fill on symbol A changes the
  capital available to symbol B. This is the "real" portfolio backtest, but its per-symbol returns
  are entangled and **not** comparable to a per-symbol report.
- **Independent-per-symbol basket** — run **one backtest per symbol**, each on its own full capital
  (default $100k), then combine. This is what parameter-sweep reports almost always mean, because it
  isolates each symbol's response to the parameter. **Default to this** unless the caller asks for
  the portfolio view.

Per-symbol **trade counts** match between the two only when capital is never the binding
constraint; **returns** generally do not. When reproducing a report, use independent runs.

## Combine independent runs

Each single-symbol result gives `total_return` on its own capital `C` (default 100000):

- `symbol_pnl = total_return * C`
- `basket_sum_pnl = Σ symbol_pnl`
- `basket_avg_return% = mean(total_return) * 100`
- `basket_trades = Σ total_trades`

```python
rows = {sym: (d["total_trades"], d["total_return"]) for sym, d in parsed.items()}
tot_pnl = sum(r * 100000 for _, r in rows.values())
avg_ret = sum(r for _, r in rows.values()) / len(rows) * 100
trades  = sum(t for t, _ in rows.values())
```

## Parameter sweeps

For a sweep (e.g. cooldown ∈ {0, 14, 31}), the parameter usually lives on the **strategy
definition**, not on the backtest call — so you must re-write the definition between levels. Obey
the mutation guard (SKILL.md): full-definition update each time, restore the original at the end.
Save each level's per-symbol results to its own JSON so you can build the comparison table without
re-running. Report per-symbol *and* the aggregate; a lumpy per-symbol picture (different best
level per symbol) is itself the finding — do not bury it under the aggregate.
