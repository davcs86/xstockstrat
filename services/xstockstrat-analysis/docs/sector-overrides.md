# Per-sector component-param overrides (`sector_param_overrides`, feature 217)

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move). `StrategyDefinition.sector_param_overrides` resolution (`app/services/sector_params.py`).

`StrategyDefinition.sector_param_overrides` (field 15, rides `definition_json`, maskable) overrides
`components[component_ref].params[param_name]` by the evaluated symbol's sector
(`app/services/sector_params.py`). It is a **param** override only — rule `rhs` thresholds are not
sector-addressable.

- **Backtest (PIT)**: one batched `marketdata.GetSectorHistory` per run (header trio propagated);
  each bar resolves its sector as-of `bar.time` (`valid_from` inclusive, `valid_to` exclusive).
  A component is computed once per **distinct** resolved param set over the full window and
  stitched per bar (`StrategyEvaluator._assemble_sector_resolved`) — correct warm-up across a
  mid-window reclassification; no overrides → one compute, byte-identical. Warm-up prefix sizes for
  the hungriest sector variant (`warmup.required_prefix_bars`).
- **Live surfaces** (readiness, opportunities, materializer, live loop): the current sector via
  `GetCurrentSector` (10-min per-process cache in the servicer) → `apply_sector`. Strategies
  without overrides issue no sector RPC.
- **Fail-safe**: unclassified bar/symbol or a marketdata failure → `default_value` (never a
  carry-forward). Backtest `warnings` carry a sector-unavailable notice and the **seed-span**
  notice when a bar resolved against an epoch-seed row (the signed-off pre-go-live look-ahead).
- Write validation (`_validate_definition`): component must exist and not be a fundamental operand;
  no duplicate `(component_ref, param_name)`; `by_sector` sectors unique and not UNSPECIFIED; finite.
  A changed override changes the definition fingerprint (clears the derived grade).
