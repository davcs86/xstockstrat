# Recon: fix-mcp-screener-correctness

**Created**: 2026-08-02
**From**: product-spec.md
**Affected services**: xstockstrat-agent (Python), xstockstrat-analysis (Python)

## Objective
Fix `screen_symbols` (F-4): map `ScreenCriterion.component` so technical kinds work; honor
`min_conviction`; error on an unknown fundamental `metric_name`; compute `coverage_gaps` before
rank truncation; project full gap detail. No proto/migration/config change.

## Codebase Map
- **agent** `app/client.py`:
  - `screen_symbols` builder `:207-270` — builds `ScreenCriterion` but **omits `component`** (`:227-247`); gap projection `{"symbol": g.symbol}` only (`:284`) — drops timeframe/bars_have/bars_need.
  - `manage_strategy` component builder `:300-317` (`kind_map` builtin/formula → `StrategyComponent`) — **reuse as a shared `_build_component` helper**.
- **analysis** `app/services/screener.py`:
  - `screen()` `:80`; rank truncation `:117-123` then `coverage_gaps` computed from the **truncated** `results` `:125-129` (bug — gaps after truncation).
  - `min_conviction` — **never read** (grep: zero refs in screener).
  - fundamental scoring `:200-210`; `_fundamental_value` `:319-327` returns None for unknown metric (silently skipped) — no distinction from "data unavailable".
  - `_FUNDAMENTAL_FIELDS` closed set `:31`; `fund.extra_metrics` open map.
- **analysis** `app/handlers/servicer.py`: `ScreenSymbols` `:1744`; calls `engine.screen(...)` in a `try/except TimeoutError` `:1774-1783` — add a `ValueError → INVALID_ARGUMENT` catch.
- Proto (all exist): `ScreenCriterion.component=4` (`analysis.proto:341`), `CoverageGap` (`:60`, `timeframe=2`, `bars_have=4`, `bars_need=5` int64).
- Tests: analysis `tests/test_screener.py`; agent `tests/test_client.py` screen tests.

## Patterns to REUSE
- `manage_strategy` component builder → extract a module-level `_build_component(dict)` used by BOTH manage_strategy and screen_symbols (DRY).
- int64-as-JSON-string projection (run_backtest `bars_have`/`bars_need`) → same for the gap detail.

## Dependencies
Proto/migration/config: none. Inter-service: none new.

## Risks / Not-found
- Unknown-metric validation needs the fetched fundamentals' `extra_metrics` keys to distinguish a typo (nowhere) from "known name, some symbols missing" — a cross-symbol union check.
- min_conviction as a hard score floor vs. a `passed` flag — AC-2 says "only 0.9 returned" → hard filter. Resolve in grilling.
- coverage_gaps must be computed from the full ranked list BEFORE both min_conviction and rank truncation.

## Recommended Scope
1. agent: `_build_component` shared helper; screen_symbols maps `component` + projects full gap detail.
2. analysis screener: min_conviction floor; gaps-before-truncation; unknown-metric → ValueError.
3. analysis servicer: ValueError → INVALID_ARGUMENT. 4. tests both. 5. docs (mcp-tools.md screen_symbols already corrected in docs-pass; re-verify).
