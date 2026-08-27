# Context Log: fix-backtest-annualized-return  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; `product-spec.md` pruned (recoverable via git history). This bug fix had no recon/design/impl-spec files.

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: Multi-symbol `RunBacktest` was reporting `annualized_return` ~30× too small because `_compute_metrics` derived its annualization period from `len(daily_equity)`, and for the *aggregate* call `daily_equity` is the **concatenation of all N per-symbol curves** — so `n_days ≈ N_symbols × window_days` (≈33×248≈8170) instead of ~252, shrinking the `252/n_days` exponent ~33×. The fix added an optional `period_years` param derived from the request's wall-clock `range` span; per-symbol evidence-cell calls were left untouched, making the change grade-neutral and forward-only. Shipped as finding #1 of a 3-finding metrics-sweep audit; #2 and #3 were spun out as separate features (150, 151).

**Why (irrecoverable rationale)**: The root cause was confirmed *empirically before the code fix* — back-solving three observed `total→annualized` pairs to a **constant** `n_days≈8170` proved the bug was array-length, not a formula error. The fix is deliberately scoped to the aggregate call *because* `annualized_return` is not a grade input — the feature-065 grade reads only sharpe / max-drawdown / win-rate from per-symbol evidence cells (`servicer.py:3307-3333`), so touching only the aggregate path cannot move any grade. This is why "grade-neutral" was assertable without re-running grade tests.

**Rejected alternatives**:
- Fixing the serial-parlay `total_return` aggregation (audit finding #2) in the same change — deferred because altering it **breaks banked-backtest comparability** with historical runs.
- Backfilling historical `annualized_return` rows — rejected as forward-only; historical rows left wrong-but-stable rather than mass-rewritten.

**Scars & gotchas**:
- The design phase was skipped (Track C bug, quick depth downgraded to skip) because the audit `_tasks/x-backtest-metrics-audit.md` already grounded the root cause — so the only surviving root-cause narrative outside code is this context.md + the retained defect report; there is no recon/design.
- The legacy `252/n_days` path was **kept as the default** (new `period_years` is opt-in), so the concatenation bug still lurks for any *future* caller that passes a multi-symbol concatenated curve without also passing `period_years`. The trap was patched at one call site, not removed.

**Permanent deviations**: none — no design.md existed; shipped matches the triage plan.

**Cross-feature signal**: This is 1 of 3 findings from a single metrics-sweep audit (`_tasks/x-backtest-metrics-audit.md`); siblings #2 (serial-parlay sizing → feature 150) and #3 (same-bar-close fill → feature 151) were spun out. A future agent touching analysis backtest math should read that audit rather than treat these as unrelated.

**Deferred follow-ons**: finding #2 (serial-parlay `total_return`) and #3 (same-bar-close fill) shipped as features 150/151 respectively.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-26 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: weak ANALYSIS-* (borderline, derivable) — backtest strategy GRADE is computed only from sharpe/max-drawdown/win-rate on per-symbol evidence cells (`servicer.py:3307-3333`); `annualized_return` and other aggregate-curve metrics are NOT grade inputs (this is what lets aggregate-metric fixes claim grade-neutrality).
**Scenario promotion (C-16)**: 3 `@AC-*` → `services/xstockstrat-analysis/acceptance/fix-backtest-annualized-return.feature` (new suite).
**Pruned artifacts**: product-spec.md — last present at 996210e4. (Defect report retained at `docs/reports/2026-08-23-backtest-annualized-return-underscaled-defect.md`; this context.md + acceptance.feature retained.)
