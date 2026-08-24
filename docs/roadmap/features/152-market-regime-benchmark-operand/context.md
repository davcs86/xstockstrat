# Context: market-regime-benchmark-operand

**Feature**: `docs/roadmap/features/152-market-regime-benchmark-operand/feature.md`
**Product Spec**: `docs/roadmap/features/152-market-regime-benchmark-operand/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/152-market-regime-benchmark-operand/implementation-spec.md`

---

## Session 2026-08-24 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the
  user-supplied SDD (`Market-Regime / Benchmark Operand for Strategy Rules`).
- Allocated NNN=152 (max existing 151 + 1).
- Scope decision recorded: **v1 = benchmark/reference-symbol operand only**; v2 true breadth deferred;
  `screen_symbols` source_symbol deferred.
- Consumer surface (C-14): **Agent** (`manage_strategy` / `run_backtest` / `set_strategy_live`); UI
  strategy-builder editing deferred to a named follow-up.
- Ledger traps folded into Open Questions: F-12/RC-1 (agent dict→proto builders drop new fields +
  strat-lab skill drift) and the `bar.time`/real-`Bar`-fixture trap (2026-08-06 backtest-debug-info).
- **Live-eval decision — RESOLVED 2026-08-24 (operator via AskUserQuestion): WIRE LIVE-EVAL TOO.**
  The benchmark load+align path is implemented in `live_loop.py` as well as the backtest engine.
  `set_strategy_live` is not a hard reject; live must load+align the benchmark safely (gap→hold/false
  on missing live-window history). Alerting-behavior changes touching `xstockstrat-notify` still need
  sign-off. FR-6 and AC-7 updated accordingly.

## Discovery digest (codebase-discovery, 2026-08-24) — analysis engine touchpoints

- Proto message is **`StrategyComponent`** (not `Component`), `packages/proto/analysis/v1/analysis.proto:300`;
  fields `ref_name=1, kind=2, indicator=3, formula_id=4, params=5`; **next free tag = 6**. Container
  `StrategyDefinition.components` (`analysis.proto:308`, next free def field 13). `ComponentKind` at :294.
- Backtest bar-load + warmup prefix: `servicer.py:1336 _backtest_symbol_evaluated` → `servicer.py:1059
  _resolve_prefixed_bars` (prefix start = `range.start - prefix_days*86400`, :1078; returns
  `bars[available-required_prefix:], trade_start_idx`, :1097). Paged fetch `servicer.py:1003
  _fetch_bars_paged` → `self._marketdata.GetBars(...)`. Window math `warmup.py:166 prefix_calendar_days`.
- Operand resolver / series[t] model: `evaluator.py:148-154` builds `component_series[ref_name]` (positional
  list, 1:1 with bars) + dotted multi-output; loop `evaluator.py:162`; `_eval_condition` (:483),
  `_resolve_term` (:531, `s[i] if i<len(s) else None`); crossovers read `i-1` (:515-524).
- Compute path: `evaluator.py:220 _compute_component(comp, closes)` — the ONLY spot a component becomes a
  series, from `closes = [b.close for b in bars]` of the evaluated symbol only (no symbol identity carried).
  builtin → `ComputeIndicator(values=closes, params=...)` + `align_indicator_points` (:300); formula →
  `ExecuteFormula(input_data={"close": closes})`.
- Coverage/INSUFFICIENT_DATA: `_InsufficientData(symbol, available, required_prefix, gap_range)` raised at
  `servicer.py:1090`; caught → `CoverageGap(symbol=ins.symbol, ...)` `servicer.py:747-766`; status gate
  `servicer.py:905-906`; attach `:909-910`.
- Live eval: `live_loop.py:450 _eval_pair` → single fixed `GetBars(range=_recent_range())` (365d, :443/:451-457)
  → `self._evaluator.evaluate(definition, bars, None)` (:466). **No warmup-prefix on live path.**
- Fingerprint: `servicer.py:3994 _definition_fingerprint(definition_json)` hashes `definition_json` minus
  `_FINGERPRINT_EXCLUDED_KEYS={"display_name","active","live_enabled"}` (:3991). A `source_symbol` inside a
  component's JSON **automatically enters the fingerprint** — no separate wiring needed, just confirm the
  write-path persists it into `definition_json`.
- **Nothing exists today** for per-component symbol override or cross-symbol alignment — must be built in
  `_compute_component`/the evaluate path plus a benchmark-bar loader mirroring `_resolve_prefixed_bars`.

## Session 2026-08-24 — sdd-design

- Phase 0 Recon: wrote recon.md (services: packages/proto, xstockstrat-analysis, xstockstrat-agent;
  reuse patterns: `_resolve_prefixed_bars`+`_InsufficientData`→CoverageGap, `_compute_component`,
  positional `component_series`, `_definition_fingerprint` auto-enter).
- Phase 1 Grilling: 2 rounds (full). R1 adversary = NEEDS-WORK (8 objections, no Floor breach). All
  resolved in the converged R2 design.
- **Chosen approach:** plain `string source_symbol = 6` (NOT optional — presence would break @AC-1
  fingerprint byte-identity); one shared `_assemble_component_series(comp, closes, eval_dates,
  benchmark_bars)` helper behind ALL FOUR StrategyComponent assembly sites; compute-on-benchmark's-own-
  closes then date-keyed left-join (`bar.time.ToDatetime(UTC).date()`), gap→None→hold, no forward-fill,
  no lookahead, no reindex of the evaluated symbol; benchmark preload per distinct source_symbol at each
  site's fetch layer (backtest `_resolve_prefixed_bars`→CoverageGap(benchmark); live warmup-sized;
  opportunities deduped once/pass under `_bars_fetch_sem`; GetIndicatorSeries aligns onto `request.times`);
  server-authoritative normalization in both write paths; agent builder+parity-test+strat-lab same PR.
- **Operator decisions (AskUserQuestion, recorded):**
  1. Live-eval: **WIRE LIVE-EVAL TOO** (not backtest-only reject).
  2. C-10 scope: **WIRE ALL FOUR SITES NOW** (backtest, live, readiness/opportunities, GetIndicatorSeries)
     with a cross-site parity test — not backtest+live-only-safe-hold.
  3. Live formula warmup: **PLUMB FORMULA-WARMUP INTO LIVE NOW** — extract
     `_declared_formula_warmup`/`_prefetch_formula_warmups` (servicer.py:1721-1766) so
     `warmup.required_prefix_bars` sizes a custom-formula benchmark on the live path too.
- **C-14 override (recorded):** UI strategy-builder editing of source_symbol deferred to a NAMED
  follow-up feature `strategy-builder-source-symbol`; agent-authored strategies fully functional now.
- Constitution rules touched: C-01, C-08/P-06, C-09, C-10, C-14, C-15, F-04, F-07. Floor breaches: none.
- Status: draft → design-approved.

### Open Threads (carry into /sdd-spec + execution)
- OT-1: pin exact `_backtest_symbol`→`evaluate_with_series` call line for benchmark threading (assumed
  servicer.py:1371). Target: proto/evaluator/backtest steps.
- OT-2: extract live formula-warmup helpers without changing backtest behavior (guard: byte-identity
  regression). Target: live step.
- OT-3: assert Opportunities benchmark fetch dedups to 1/pass. Target: readiness/opportunities step.
- OT-4: join-sparsity threshold is a code constant (config-key tuning deferred).
