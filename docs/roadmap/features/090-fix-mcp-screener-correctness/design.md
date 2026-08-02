# Design: fix-mcp-screener-correctness

**Created**: 2026-08-02
**Rounds**: 2 (full)
**Grounded in**: recon.md

## Chosen Approach

### 1. agent (`app/client.py`)
- Extract a module-level `_build_component(c: dict) -> StrategyComponent` from the `manage_strategy`
  builder (`:300-317`); `manage_strategy` and `screen_symbols` both call it (DRY, one kind→component
  mapping).
- `screen_symbols` builder: set `component=_build_component(c["component"])` when `c.get("component")`
  is present (technical kinds); leave unset otherwise. So `SCREEN_KIND_TECHNICAL_*` criteria now carry
  the component the server requires.
- Gap projection: `{"symbol", "timeframe", "bars_have", "bars_need"}` — `timeframe` as its enum name,
  `bars_have`/`bars_need` as JSON **strings** (int64 contract, matching run_backtest).

### 2. analysis screener (`app/services/screener.py`) `screen()`
- **Gaps before truncation**: after `results.sort(...)`, compute `coverage_gaps` from the **full**
  sorted list (INSUFFICIENT_DATA rows), THEN apply min_conviction + rank_limit to `results`. So an
  INSUFFICIENT_DATA symbol ranked below the cut still appears in `coverage_gaps` (AC-4).
- **min_conviction floor**: `if request.min_conviction > 0: results = [r for r in results if r.score >=
  request.min_conviction]` (applied after gap computation, before rank truncation). Two symbols
  0.9/0.3 with floor 0.5 → only 0.9 (AC-2).
- **Unknown metric → error**: build `known = _FUNDAMENTAL_FIELDS ∪ (⋃ extra_metrics keys across fetched
  fundamentals)`. For each fundamental criterion whose `metric_name` ∉ `known` **when fundamentals are
  available**, `raise ValueError(f"unknown fundamental metric_name '{name}'")`. Distinguishes a typo
  (nowhere in the universe) from "known name, some symbols missing data" (stays skipped). Skipped when
  fundamentals are unavailable (can't validate — degrade, not error).

### 3. analysis servicer (`app/handlers/servicer.py` `ScreenSymbols`)
- Wrap the `engine.screen(...)` call's `except` to also catch `ValueError` → `context.abort(
  INVALID_ARGUMENT, str(e))` (the unknown-metric path).

### 4. same-PR docs
- `docs/runbooks/mcp-tools.md` `screen_symbols`: the docs-only pass already marked `min_conviction`
  "ignored" and technical kinds "silently skipped" — flip those to the now-correct behavior
  (min_conviction honored; technical criteria scored; unknown metric errors; gap detail projected).

## Rejected Alternatives
- **min_conviction as a `passed` flag (not a filter)** — rejected: AC-2 requires the low-score symbol
  absent from results, i.e. a hard floor.
- **Remove `min_conviction`** (the other AC-2 option) — rejected: it is cheap to honor and useful; a
  one-clause filter beats a breaking proto removal.
- **Validate metric_name against `_FUNDAMENTAL_FIELDS` only** — rejected: would reject legitimate
  open `extra_metrics`; the union-with-fetched-extra-keys check is correct.
- **Compute gaps in the servicer after projection** — rejected: the screener owns the ranked list; fix
  it at the source, before truncation.

## Open Risks
- [ ] A criterion with `min_conviction` set but all symbols INSUFFICIENT_DATA → empty results, gaps
  populated. Intended.
- [ ] Unknown-metric validation is skipped when fundamentals are unavailable (degraded scan) — a typo
  is only caught when the data is present. Acceptable (can't validate against absent data); documented.

## Constitution Rules Touched
- `C-08`/`P-06` — analysis (screener) + agent steps get paired RED-first tests.
- `C-10` — shared `_build_component` (no duplicate mapping) + same-PR docstring/runbook.
- `C-04`/`C-09` — no proto change (all fields exist). `F-01`/`F-06`/`F-07` — none.
