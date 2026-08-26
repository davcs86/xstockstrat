# Context: backtest-next-bar-fill  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: Shipped an opt-in `FillModel` enum on the analysis backtest engine that shifts fills from bar `i`'s close to bar `i+1`'s open, defaulting byte-for-byte to legacy same-bar-close (`UNSPECIFIED=0`). It landed in PR #1004 *alongside* feature 150 (sizing), which merged its proto/migration first, so 151 kept the reserved higher field/migration split (`request fill_model=9`, `result=20`, `summary=18`, migration 018). The mechanism is deferred execution through one shared `_apply_fill` state machine over both per-symbol simulators — deliberately *not* a price swap.

**Why (irrecoverable rationale)**: A price-only resolver (read `bars[i+1].open`, execute in place on bar `i`) was the obvious cheap fix but is look-ahead: it stamps bar `i`'s equity from bar `i+1` data and corrupts `daily_equity`↔`diags` semantics even though array lengths still match. Deferred execution — a pending fill set on bar `i`, applied at the top of iteration `i+1` — is the only way to get next-bar fills without look-ahead.

**Rejected alternatives**:
- Price-only resolver — lost: look-ahead, corrupts equity/diag semantics.
- Suppress the `n-2→n-1` entry — lost: legacy records that single-bar round-trip, so suppressing the next-bar analog breaks cross-mode trade-count comparability (the feature's whole point); only the truly unfillable absolute-last-bar (`n-1`) signal drops.
- Signal-to-signal cooldown as default — lost: fill-to-fill matches actual transaction dates (wash-sale/min-hold); byte-identical in legacy mode.
- In-place `diags.action` mutation inside `_apply_fill` — lost: reopens the clobber-ordering hazard; return-the-upgrade / loop-writes-once makes single-writer syntactic.
- Stamp signal-bar conviction on the fill row — lost: invasive, redefines conviction on fill rows and risks the backtest/live conviction contract, for a display-only gain.

**Scars & gotchas**:
- The load-bearing invariant: the loop stays the *sole* writer of `diags[...].action` and sole appender to `daily_equity`; `_apply_fill` **returns** the ENTER/EXIT upgrade (or `None`) and never touches `diags`. Any change that mutates the diag in place reopens the clobber hazard, can leave a phantom ENTER on an unapplied last-bar pending, and breaks the `daily_equity[j]`↔`diags[j]` 1:1 assert (feature 071) at `servicer.py:3291`.
- `_apply_fill` must run *above* the SMA warm-up `continue` branches or a deferral is silently skipped (practically unreachable — warm-up is a strict prefix — but coded as an invariant).
- Config zero-trap is **intentional, not a bug**: `analysis.backtest.default_fill_model` via `get_int` can't distinguish "absent" from a configured `0`, and that's safe *only because* both resolve to `UNSPECIFIED→legacy`.
- The effective model is resolved once at `RunBacktest` entry and the **effective** value (never the raw request field) is persisted/echoed, so a banked run's model always equals what actually routed the sim.

**Permanent deviations**: None. Shipped matches the approved design; the one design-vs-spec gap (design cited AC IDs the story lacked) was reconciled before execute.

**Cross-feature signal**: Features 150 (sizing) and 151 (fill) modify the *same* functions (`servicer.py`, `backtest_runs.py`, `backtest_view.py`). The `merge-order.md` 150↔151 row was the single guard against a silent `BacktestResult` field collision, because bytes persist verbatim and `buf breaking` only runs per-branch. The proto field split is order-independent; the migration NNN is order-sensitive (golang-migrate won't backfill a lower version) — whichever landed second renumbered. They shipped in one PR, so the manual same-function reconciliation burden materialized as predicted.

**Deferred follow-ons**: **Portfolio simulator does not honor next-bar fill (v1 limitation).** `_simulate_portfolio` (feature 150) still fills intents at close; a portfolio × next-bar run honors next-bar in the per-symbol cells but same-bar in the portfolio curve. A future story wanting true next-bar portfolio curves must extend `_simulate_portfolio`.

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-08-26 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: ANALYSIS-* — the backtest engine's `daily_equity[j]` ↔ `diags[j]` 1:1 alignment (asserted `servicer.py:3291`) plus the "loop is the sole writer of `diags.action` / sole appender to `daily_equity`" rule; and `_simulate_portfolio` fills intents at close regardless of `fill_model` (only the per-symbol serial simulators honor next-bar — a portfolio × next-bar run is intentionally mixed-mode).
**Scenario promotion (C-16)**: 10 `@AC-*` (AC-1..AC-10) → `services/xstockstrat-analysis/acceptance/backtest-next-bar-fill.feature`, 1 (AC-11) → `services/xstockstrat-ui/acceptance/backtest-next-bar-fill.feature` (both new suites).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
