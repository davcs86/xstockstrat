# Recon: market-regime-benchmark-operand

**Created**: 2026-08-24
**From**: product-spec.md
**Affected services**: `packages/proto`, `xstockstrat-analysis`, `xstockstrat-agent` (+ `strat-lab` plugin skill)

---

## Objective

Add an optional `source_symbol` to a strategy component so the indicator/formula is computed on a
fixed reference symbol's bars (e.g. VOO), then its **output series** is aligned onto the evaluated
symbol's bar timeline and referenced in entry/exit rules like any other component. Enables
cross-symbol "market regime" gates (buy dips only when VOO's 200-day is rising). v1 covers
benchmark/reference-symbol only; true universe breadth is deferred to v2.

## Codebase Map

- **`packages/proto`**
  - `message StrategyComponent` — `packages/proto/analysis/v1/analysis.proto:300`; fields
    `ref_name=1, kind=2, indicator=3, formula_id=4, params=5`. **Next free tag = 6.**
  - `ComponentKind` enum — `analysis.proto:294`. Container `StrategyDefinition.components` —
    `analysis.proto:308` (`repeated StrategyComponent components = 3;`; def next free field 13).
  - `CoverageGap` / `BACKTEST_STATUS_*` — near `analysis.proto:40-210`.

- **`xstockstrat-analysis`** (Python, gRPC 50056)
  - Backtest entry: `RunBacktest` — `app/handlers/servicer.py:525`.
  - Per-symbol evaluated engine: `_backtest_symbol_evaluated` — `servicer.py:1336`.
  - Bar load + warmup prefix: `_resolve_prefixed_bars` — `servicer.py:1059`
    (prefix start = `range.start - prefix_days*86400`, `:1078`; returns
    `bars[available-required_prefix:], trade_start_idx`, `:1097`).
  - Paged marketdata fetch: `_fetch_bars_paged` — `servicer.py:1003` → `self._marketdata.GetBars(...)`
    (`:1026`, `timeframe="1d"`, `TIMEFRAME_1DAY`, `range`, `page_size=_BAR_PAGE_SIZE`).
  - Warmup sizing: `warmup.py` — `required_prefix_bars` (`:118`), `builtin_lookback_bars` (`:71`),
    `prefix_calendar_days` (`:166`, `ceil(prefix_bars/(252/365))+10` slack).
  - Series assembly + operand resolution: `app/services/evaluator.py:148-154`
    (`component_series[comp.ref_name] = primary` positional list 1:1 with bars; dotted multi-output);
    eval loop `evaluator.py:162`; `_eval_condition` (`:483`), `_resolve_term` (`:531`,
    `s[i] if i<len(s) else None`); crossovers read `i-1` (`:515-524`); `_INDICATOR_SERIES` (`:58`).
  - Compute path: `_compute_component(comp, closes)` — `evaluator.py:220` (builtin →
    `ComputeIndicator(values=closes, params=...)` + `align_indicator_points` `:300`; formula →
    `ExecuteFormula(input_data={"close": closes})`). `closes = [b.close for b in bars]` (`:142,205`).
  - Coverage/INSUFFICIENT_DATA: `_InsufficientData(symbol, available, required_prefix, gap_range)`
    raised `servicer.py:1090`; caught → `CoverageGap(symbol=ins.symbol, ...)` `servicer.py:747-766`;
    status gate `servicer.py:905-906`; attach `:909-910`.
  - Live eval: `app/engine/live_loop.py:450 _eval_pair` → single fixed
    `GetBars(range=_recent_range())` (365d, `:443/:451-457`) → `evaluator.evaluate(definition, bars, None)`
    (`:466`). **No warmup-prefix on the live path.**
  - Fingerprint: `_definition_fingerprint(definition_json)` — `servicer.py:3994` hashes
    `definition_json` minus `_FINGERPRINT_EXCLUDED_KEYS={"display_name","active","live_enabled"}`
    (`:3991`).

- **`xstockstrat-agent`** (Python, MCP)
  - `manage_strategy` dict→proto request builder (must carry the new field) + `run_backtest` +
    `set_strategy_live` — in `app/client.py` / `app/tools.py` (to be pinned at spec time; Ledger F-12
    flags these hand-written builders as the drop-a-new-field trap).
  - `strat-lab` plugin `backtest` skill: `plugins/strat-lab/` — must update in the same PR per root
    CLAUDE.md.

## Patterns to REUSE

- **Benchmark bar loading** → mirror `_resolve_prefixed_bars` (`servicer.py:1059`) rather than a new
  fetch path; it already fetches window+warmup and raises `_InsufficientData(symbol, ...)`. Dedup loads
  across components sharing a `source_symbol`.
- **Coverage-gap emission for the benchmark** → reuse the `_InsufficientData` → `CoverageGap(symbol=…)`
  path (`servicer.py:1090`, `:747-766`) so the **benchmark** symbol lands in `coverage_gaps` with no new
  status plumbing.
- **Component compute** → reuse `_compute_component` (`evaluator.py:220`) unchanged, feeding it the
  benchmark's `closes` instead of the evaluated symbol's. Compute-then-align (never align-then-compute).
- **Series model** → keep the positional `component_series[ref_name]` list 1:1 with the **evaluated**
  bars (`evaluator.py:148`). The benchmark's output is realigned into that same positional shape; a gap
  becomes a sentinel that `_resolve_term` already renders as `None` → condition false (`:534-535`).
- **Fingerprint** → `source_symbol` inside a component's `definition_json` **auto-enters**
  `_definition_fingerprint` (`servicer.py:3994`) — only confirm the write-path persists it into
  `definition_json`; no new fingerprint wiring.
- **Real `Bar` proto fixtures** in tests (Ledger 2026-08-06): the marketdata bar timestamp field is
  `bar.time`, not `bar.timestamp`; use real `marketdata_pb2.Bar` instances, not `MagicMock`.

## Existing Business Rules (preserve / extend)

- No existing acceptance suite for `xstockstrat-analysis` yet (`services/xstockstrat-analysis/acceptance/`
  absent) — this feature is **net-new behavior**.
- `docs/sdd/business-rules/platform.feature` holds only `@AC-8` (feature-147 secret absence) — unrelated;
  PRESERVE (untouched).
- Implicit platform guarantee to PRESERVE (reviewer-registry focus for analysis): **backtest
  reproducibility / no look-ahead / scoring determinism**. The alignment design must not regress it —
  captured as this feature's own `@AC-1` (byte-identical for empty `source_symbol`) and `@AC-2`/`@AC-5`
  (no-lookahead, warmed-from-before-start).

## Dependencies

- Proto/RPC: additive `string source_symbol = 6;` on `StrategyComponent` (`analysis.proto:300`).
  Non-breaking; `buf lint` + `buf breaking` must pass. Regenerate go/python/ts stubs.
- Migration: **none** (strategy definition stored as `definition_json`; new field rides in the blob).
- Config keys: **none**.
- Inter-service edges: `xstockstrat-analysis → xstockstrat-marketdata GetBars` already exists; the
  benchmark fetch reuses it (an extra symbol, same RPC). No new edge.
- New env vars / ports: **none**.

## Risks / Not-found

- **Alignment correctness is the whole risk.** Left-join benchmark **output** onto the evaluated
  symbol's timestamp index; gap → hold/false; never forward-fill; never reindex the evaluated symbol to
  the benchmark; no look-ahead (benchmark value at t uses only benchmark data ≤ t). Compute on the
  benchmark's own contiguous series first, then align (align-then-compute corrupts rolling windows).
- **Live path divergence.** `live_loop.py` uses a single fixed 365-day fetch with no warmup-prefix. The
  benchmark load+align must be added there too (operator chose to wire live). A benchmark lacking live
  history must degrade to gap→hold/false, never crash the loop. `_LOOKBACK_DAYS=365` may be too short to
  warm a 200-day benchmark component on the live path — needs a warmup-aware benchmark fetch or a widened
  benchmark window. **Open design question for the grilling.**
- **Ledger F-12 / RC-1:** the agent's hand-written dict→proto builders silently drop new proto fields;
  `manage_strategy`/`run_backtest` builder + a parity test + the `strat-lab` skill must all be updated in
  the same PR.
- `manage_strategy` write-path normalization (uppercase, empty→unset) location not yet pinned — spec-time
  discovery in `xstockstrat-agent`.

## Recommended Scope

1. Proto: add `source_symbol = 6` to `StrategyComponent`; regenerate stubs. (proto + proto-gen)
2. Analysis backtest engine: benchmark loader (dedup per symbol, window+warmup) + compute-then-align +
   gap→None + benchmark coverage-gap routing. (service + test)
3. Analysis live evaluator: same benchmark load+align in `_eval_pair`, warmup-aware benchmark window,
   safe degrade. (service + test)
4. Agent write-path: `manage_strategy` accepts/normalizes `source_symbol`, carries it through the
   dict→proto builder, parity test; `run_backtest` unaffected but covered. (service + test)
5. `strat-lab` skill update + docs/context-scrubber. (docs)
