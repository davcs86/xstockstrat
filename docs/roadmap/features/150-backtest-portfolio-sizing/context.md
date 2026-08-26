# Context: backtest-portfolio-sizing  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: Shipped an opt-in, versioned portfolio sizing model in `xstockstrat-analysis`'s backtest engine, selected by `RunBacktestRequest.sizing_mode` (default `UNSPECIFIED` → the legacy serial-compounding path, untouched). Portfolio mode runs one shared cash pool over a union calendar with concurrent positions, feeding a single portfolio equity curve into the *existing* `_compute_metrics`, so aggregate return/drawdown/sharpe are order-independent — fixing the old serial-equity-threading + per-symbol-curve-concatenation "parlay" aggregate (the metrics-audit finding #2 that spawned this feature). All 13 steps landed in PR #1004.

**Why (irrecoverable rationale)**: The fix was deliberately gated behind an enum default rather than replacing the aggregation, because `BacktestResult` bytes are persisted **verbatim** (feature 068) and the feature-065 derived grade is banked per run — silently changing the default path would retroactively mis-render/re-grade every historically banked backtest and destroy cross-run comparability. Opt-in + explicit operator approval before any behavior code was the whole point; the operator halted the pipeline after design-approval specifically to bless the redesign first.

**Why (mechanism choice)**: Portfolio intent is returned **additively** as a 5th tuple element from the existing simulators — computed from expressions they *already* evaluate before the position/capital gate — precisely to avoid a second `GetBars` pass. A double-pass would trip feature 141's `analysis.opportunity.max_concurrent_bars_fetches` TimescaleDB-OOM cap and open a divergence window between fetches. The per-symbol loop, evidence cells, and derived grade run byte-for-byte in both modes *for free* because cell metrics are relative to each symbol's own `daily_eq[0]` — scale-invariant and order-independent.

**Rejected alternatives**:
- Reconstruct execution from the `BarDiagnostic.action` stream — lost: that stream is *realized* execution gated by per-symbol equity/cooldown, not signal intent; a capital-skipped entry has no action to replay, so it structurally under-trades exactly when the shared pool is contended.
- Parallel double-pass `_symbol_signal_pass` — lost: 2× marketdata fetch (feature-141 OOM hazard) + inter-fetch divergence.
- Live-equity sizing (`weight × current_equity`) — lost: compounds and reintroduces the exact path/order sensitivity the feature removes; a fixed fraction of *initial* capital is order-independent.
- Request-override fields for weight/max_concurrent — lost: speculative scope; config is the sole source.
- Graded-conviction capital prioritization — lost: `evaluate_with_series` conviction is binary and SMA only enters at `combined==1.0`, so no graded key exists without a heavier trace pass; v1 tiebreak is deterministic-but-arbitrary symbol-ASC.

**Scars & gotchas**:
- **Look-ahead RED needs a mid-series-gap fixture, not ragged start/end dates** — forward-fill must use on-or-before-today closes only; a ragged-calendar fixture passes green while the most dangerous look-ahead bug ships.
- **Golden-compare false-fail**: once the legacy path stamps `sizing_mode=SIZING_MODE_LEGACY` (field 17), a naive full-message compare against a pre-feature golden false-fails. Fixed by a `_canonical_pre150` helper that clears the 3 additive fields (17/18/19) before comparing.
- **Tuple-arity ripple**: adding a 5th intent element to both simulators broke every existing test that unpacked the 4-tuple. Mitigated by returning a 5th `[]` in mocks and slicing `[:4]` in the `_run_evaluated`/`TestTradeStartIndex._run` helpers; 267 pre-existing tests re-verified green.
- **Descriptor-parity guard fails-closed**: `test_backtest_view.py`'s parity guard reds on any new `BacktestResult` field until `backtest_view.py` explicitly classifies each (kept/dropped) — the C-10 built-in red that forces the agent surface to account for all 3 new fields.
- Config zero-trap is intentional here: a configured `0` weight/max_concurrent disables the portfolio, so `get_float`/`get_int` falling back to the default on `0` is the desired guard, not a bug.

**Permanent deviations**: none of substance — shipped matched the approved design. One process deviation: executed on the harness branch `claude/xstockstrat-metrics-sweep-m070rf` (all steps in PR #1004) rather than a fresh `feature/` branch, per the binding session-branch constraint (C-06).

**Cross-feature signal**: The 150↔151 `merge-order.md` row is a genuine SPOF: it is the only thing preventing a silent `BacktestResult`/`RunBacktestRequest`/migration field collision, because bytes persist verbatim and `buf breaking` is per-branch. Numbers (req.8, result 17/18/19, summary 17, migration 017) were re-derived from the merged tree at spec time; 151's reserved slots (req 9, result 20, summary 18, migration 018) stayed free. Pattern: any two features concurrently touching the same additive proto message + same source functions need a manual-merge flag for whoever lands second. Aligned with feature 067 (proto enum ↔ UI exhaustive `Record` map must land the new key in the same PR), 068 (verbatim-persisted result bytes), 065 (derived grade), 141 (fetch-cap OOM) — a recurring "backtest result is a persisted, multi-consumer contract" cluster.

**Deferred follow-ons**: Stale-close drawdown understatement (forward-filling a halted/missing symbol holds equity flat then jumps, understating `max_drawdown` mid-gap — v1 chose legacy-realized parity over drawdown fidelity on gappy cohorts). Symbol-ASC systematic bias under scarce same-bar capital (documented honestly, not neutral). `BarDiagnostic.equity` (field 15) stays per-symbol in portfolio mode; portfolio contribution lives only in `portfolio_equity_curve`. Graded-conviction prioritization revisitable only once an engine with non-binary conviction exists.

**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-08-26 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: ANALYSIS-* — in portfolio sizing mode, `_simulate_portfolio` forward-fills marks-to-market using **on-or-before-today closes only** (provably past-only, terminal bar freezes price, never synthesizes a sell); the symbol-ASC same-bar capital tiebreak is **deterministic-but-arbitrary**; `BarDiagnostic.equity` (field 15) **stays per-symbol** while portfolio contribution lives only in `portfolio_equity_curve`. Also reinforce feature-068: the legacy `SIZING_MODE_UNSPECIFIED` path must stay byte-for-byte identical (`BacktestResult` bytes persist verbatim and are re-graded on read).
**Scenario promotion (C-16)**: 7 `@AC-*` → `services/xstockstrat-analysis/acceptance/backtest-portfolio-sizing.feature` (new suite).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
