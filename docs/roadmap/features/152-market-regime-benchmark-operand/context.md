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
