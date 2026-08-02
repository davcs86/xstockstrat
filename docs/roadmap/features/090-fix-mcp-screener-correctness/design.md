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
- **min_conviction floor — platform-consistent (adversary (a))**: `r.score` is a min-max **normalized**
  relative-conviction in [0,1] (`_normalize_universe` + `combine_score`), so a *raw* `score >=
  min_conviction` floor is the wrong scale and breaks the screener's FR-4 backtest-parity claim.
  Instead mirror the backtest's own transform: `if request.min_conviction > 0: thr =
  scoring.buy_threshold(request.min_conviction); results = [r for r in results if r.score >= thr]`
  (`buy_threshold = max(0.5 + mc*0.5, 0.55)`). This gives one platform-wide meaning for the field. (The
  AC-2 illustration "0.9/0.3, floor 0.5" is not literally realizable by min-max on 2 symbols; the paired
  test uses a ≥3-symbol universe where the high symbol clears `buy_threshold(mc)` and the low does not.)
- **Unknown metric → error (adversary (b) — residual documented)**: build `known = _FUNDAMENTAL_FIELDS ∪
  (⋃ extra_metrics keys across fetched fundamentals)`. For each fundamental criterion whose
  `metric_name` ∉ `known` **when fundamentals are available**, `raise ValueError(...)`. This catches a
  typo of a closed field (e.g. `pe_ration`). **Residual, documented:** because `extra_metrics` is
  open-ended, a *legitimate* open metric that no scanned symbol happens to carry is indistinguishable
  from a typo and also raises `INVALID_ARGUMENT` — which is honest, since such a criterion can score
  no symbol in this scan. Skipped entirely when fundamentals are unavailable (can't validate).

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
- [ ] An open `extra_metric` name absent from every scanned symbol raises `INVALID_ARGUMENT` (adversary
  (b)) — documented as a degenerate-criterion signal, not a silent skip.
- [ ] The agent `test_client.py` coverage_gaps assertion (`[{"symbol":"TSLA"}]`) breaks and is rewritten
  as the RED-first paired test for the new `{symbol,timeframe,bars_have,bars_need}` projection.
- [ ] `_build_component` inherits `manage_strategy`'s `ValueError` on an unknown `kind` (surfaces as a
  client-side MCP tool error before the gRPC call) and defaults a kind-less component to `builtin`.

## Constitution Rules Touched
- `C-08`/`P-06` — analysis (screener) + agent steps get paired RED-first tests.
- `C-10` — shared `_build_component` (no duplicate mapping) + same-PR docstring/runbook.
- `C-04`/`C-09` — no proto change (all fields exist). `F-01`/`F-06`/`F-07` — none.
