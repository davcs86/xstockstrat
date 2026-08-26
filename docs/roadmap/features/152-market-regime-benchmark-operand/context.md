# Context: market-regime-benchmark-operand  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: Shipped a `source_symbol` operand on `StrategyComponent` so a strategy rule can gate on a benchmark/reference symbol (e.g. "VOO 200d rising") computed on the *benchmark's own* bars and date-joined onto the evaluated symbol's timeline. It went in as v1 (reference-symbol only; true breadth and `screen_symbols` source deferred) but was wired through **all four** component-assembly sites — backtest, live, readiness/opportunities, and GetIndicatorSeries — plus both write paths, per an explicit operator scope-expansion. The first real payoff validation (re-running `dip_buyer_vol_stop` with a VOO-200d gate to confirm the −19% 2024-25 OOS year is suppressed) was **never run** — it needs the live staging engine + backfilled data.

**Why (irrecoverable) — why a benchmark operand at all, not another per-symbol gate**: OOS validation of `dip_buyer_vol_stop` showed a per-symbol rising-200-day gate removed only **1 of 64 entries**, "because each name's own 200-day was still rising while the *market* chopped" (the strategy lost −19.23% / −1.26 Sharpe over the 2024-08→2025-08 OOS year). A per-symbol gate was tried and empirically insufficient — that is the decisive reason the fix is a **cross-symbol** benchmark operand, not another per-symbol indicator.

**Why (irrecoverable rationale)**:
- The field is plain `string`, **not** proto3 `optional`, because presence-tracking would emit `"source_symbol":""` into `definition_json` and shift `_definition_fingerprint` for every pre-existing strategy, breaking @AC-1 byte-identity and invalidating the strategy evidence base. Branch on truthiness for the today-path.
- **Compute-then-align, never align-then-compute**: `align_indicator_points` tail-aligns assuming a contiguous warm-up head, so aligning raw benchmark closes first corrupts rolling windows across gaps. The join is keyed on **trading-day date** (`bar.time.ToDatetime(UTC).date()`), not `time.seconds`, because exact timestamps are brittle to per-symbol intraday differences; both are equally lookahead-safe. Missing date → None → leaf false → hold, no forward-fill, evaluated symbol never reindexed.
- Scope was operator-driven, not spec-driven: two AskUserQuestion gates chose "wire all four sites" (over backtest+live-only) and "plumb formula-warmup into live now" (over builtins-only). Absent these recorded decisions, the extra surface area reads as gold-plating.

**Rejected alternatives**:
- `optional string source_symbol` — lost: presence emits an empty-string key → fingerprint shift → @AC-1 break.
- A per-definition (not per-component) helper — lost: GetIndicatorSeries consumes raw `series_map` while backtest/live flatten to bare+dotted keys; a per-component unit gives all three the identical computation to parity-test.
- Exact `time.seconds` join key — lost: brittle to intraday timestamp drift.
- Client-side normalization in the agent tool — lost: bypassable by the UI/any other ManageStrategy caller → mixed-case persisted → `"voo"`≠`"VOO"` fingerprint split; done server-authoritative in both write paths.

**Scars & gotchas**:
- `eval_dates` must be computed **lazily**, only when a `source_symbol` is present, or you break byte-identity AND list-mock bars that lack a `.time` attribute (unit tests pass plain lists).
- The benchmark (VOO) is shared by every evaluated symbol → it must be fetched **once per run/pass**, not per (symbol, strategy), or you re-fetch N times and emit N duplicate coverage gaps. Backtest loads once before the per-symbol loop (D-1); Opportunities dedups under the feature-141 `_bars_fetch_sem` + `bars_by_symbol`.
- Insufficient benchmark coverage names the **benchmark** in `coverage_gaps` (not the evaluated symbol) and empties `symbols_to_run` → INSUFFICIENT_DATA (@AC-4).

**Permanent deviations**:
- Design said extract the servicer's shared `_declared_formula_warmup`/`_prefetch_formula_warmups` for live reuse → shipped a self-contained `StrategyEvaluator.declared_formula_warmups` for the live path, servicer untouched → because the servicer helper also records feature-086 soft-delete warnings and extracting it would risk backtest byte-identity regression for zero benefit (D-2).
- Design left live warmup semantics implicit → shipped so the **benchmark** component warms via warmup on live, but the **evaluated** symbol still uses its fixed 365-day lookback; the pre-existing guard test `test_the_live_loop_still_uses_its_own_fixed_lookback` was intentionally repurposed (its own docstring authorized it) and the FR-7 divergence note in `docs/warmup.md` updated (D-3).

**Cross-feature signal**: Third+ recurrence of the F-12/RC-1 "agent dict→proto builder silently drops a new field" class — here the descriptor-parity test `test_build_component_covers_every_proto_field` caught it RED before the builder update (the ledger antidote at insights.md:469 worked as designed, D-4). Reinforces the C-10 "forgot the shared consumer" family for *internal compute sites*, not just the agent surface: one `_assemble_component_series` helper behind all four assembly sites + a cross-site parity test.

**Deferred follow-ons**: Named follow-up feature `strategy-builder-source-symbol` (UI strategy-builder editing of `source_symbol`; C-14 override recorded; agent-authored strategies fully functional without it). The join-sparsity threshold is a module constant, not a config key (WatchConfig tuning deliberately deferred). v2 true market-breadth operand and `screen_symbols` source_symbol both deferred out of v1. The post-launch validation re-run of `dip_buyer_vol_stop` with the VOO-200d gate across the three OOS years is still outstanding.

**Ledger entries written**: insights.md (2), fails.md (0) — see the 2026-08-26 entries. (The plain-vs-`optional` fingerprint-stability rule, the descriptor-parity antidote, and the F-12 field-drop class were already recorded at insights.md:2068 / insights.md:469 / fails.md:307.)
**Runtime-invariant recommendations (→ /context-constitution)**: none new (the additive-field-auto-enters-fingerprint rule is already in context-constitution territory + captured by the DUP insight at 2068).
**Scenario promotion (C-16)**: 8 `@AC-*` → `services/xstockstrat-analysis/acceptance/market-regime-benchmark-operand.feature` (new suite).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
