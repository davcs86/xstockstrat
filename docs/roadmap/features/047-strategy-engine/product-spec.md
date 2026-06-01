# Product Spec: strategy-engine

**Created**: 2026-06-01
**Revamped**: 2026-06-01 (from `mcp-management-tools`)

---

## Problem Statement

Today a "strategy" is not a real entity. `xstockstrat-analysis.RunBacktest` runs a single
**hardwired SMA-crossover** engine (two SMAs computed via `ComputeIndicator("SMA")`), tunable only
through `strategy_params` (`fast_period`/`slow_period` + signal-weighting). `strategy_id` is a
free-form label and strategies live only **in-memory** for the life of the analysis process. As a
result you cannot define a strategy that uses a different indicator, **multiple** indicators, or a
**custom formula**; strategies cannot be saved, listed, or reused; and there is no single strategy
definition that both a backtest and a future live engine can share. This feature makes Strategy a
first-class, persisted, **composable** entity and routes backtests through a shared evaluator.

## User Story

As a platform operator, I want to define a named strategy that combines multiple indicators and/or
custom formulas with explicit entry/exit rules, save it, and run it in a backtest, so that I can
build and validate real strategies (not just a fixed SMA crossover) and reuse the exact same
definition later for live alerting.

## Functional Requirements

### Group 1 — Persisted, composable Strategy model

FR-1. `xstockstrat-analysis` must persist strategies in a new `analysis.strategies` table:
`strategy_id` (TEXT PK, lowercase/underscore), `display_name`, `definition_json` (JSONB),
`active` (BOOL DEFAULT TRUE), `created_at`, `updated_at`. Strategies are deactivated, never
hard-deleted (mirrors the signal-source registry convention).

FR-2. A strategy **definition** must support **one or more components**, each being either:
  - a **built-in indicator** — one of the engine's supported set (`SMA, EMA, RSI, MACD, BB, ATR,
    VWAP, STOCH`, per `services/xstockstrat-indicators/app/services/indicators_engine.py`) with its
    params (e.g. `{period: 20}`); or
  - a **custom formula** — referenced by `formula_id` and executed via
    `IndicatorsService.ExecuteFormula` in the indicators sandbox.
  Each component has a unique `ref_name` (e.g. `sma_fast`, `rsi14`, `my_composite`) used by the rules.

FR-3. A definition must declare **entry** and **exit** rules expressed over component `ref_name`s
(and optional newsletter-signal score), e.g. `sma_fast crosses_above sma_slow AND rsi14 < 70` for
entry and `sma_fast crosses_below sma_slow` for exit. The exact rule representation (constrained
expression grammar vs structured condition tree) is an Open Question — but it must be evaluable
deterministically bar-by-bar with **no look-ahead**.

FR-4. A definition must carry the existing signal-weighting parameters as optional fields:
`signal_sources`, `signal_weight`, `technical_weight`, `min_conviction` — preserving current
behavior so an SMA-crossover-equivalent strategy can be expressed in the new model.

FR-5. Strategy definitions must be **validated at write time**: referenced built-in indicators must
be supported, referenced `formula_id`s must exist (`GetFormula`), every `ref_name` used in a rule
must be defined as a component, and rules must parse. Invalid definitions are rejected with a clear
error.

### Group 2 — Shared evaluator + backtest integration

FR-6. A single **strategy evaluator** must compute, for a given strategy definition and a window of
OHLCV bars (+ active signals), the component series and the resulting entry/exit decisions per bar.
This evaluator is the one source of truth for strategy behavior and must be reusable by both the
backtest (this feature) and the live runtime (feature 048) so the two can never diverge.

FR-7. `RunBacktest` must run a **stored strategy** through the evaluator instead of the hardwired
SMA logic. `RunBacktestRequest` must let the caller reference a saved strategy (e.g. by
`strategy_id`) and/or pass an inline definition; the resolved definition drives the simulation. The
existing metrics (`total_return`, `sharpe_ratio`, `max_drawdown`, `win_rate`, `profit_factor`,
trades) are unchanged in shape.

FR-8. Backward compatibility: a `RunBacktest` call that supplies only the legacy
`strategy_params` (`fast_period`/`slow_period`, signal-weighting) and no stored/inline definition
must continue to behave exactly as today (SMA crossover), so existing callers and the
`run_backtest` MCP tool / `integration-test.sh` keep working.

FR-9. New/updated RPCs on `AnalysisService`: `ManageStrategy` (register | update | deactivate),
`GetStrategy`, and `ListStrategies` returning stored **definitions** (the current `ListStrategies`
returns in-memory `StrategyScore`s — reconcile or add a definitions-returning variant). All
additive/non-breaking at the proto level.

### Group 3 — Admin-scoped MCP management tools

FR-10. Add a `manage_strategy` MCP tool to `xstockstrat-agent` wrapping `ManageStrategy` /
`GetStrategy` / `ListStrategies`, so an operator (via Claude) can define/update/deactivate and
inspect strategies.

FR-11. Add a `manage_formula` MCP tool wrapping `IndicatorsService.RegisterFormula` / `GetFormula`
so operators can author the custom-formula components that strategies reference. (Consider a
`ListFormulas` RPC for discovery — Open Question.)

FR-12. Add a `manage_signal_source` MCP tool wrapping the existing
`IngestService.ManageSignalSource` (register | update | deactivate), surfacing its existing
`config_json` validation and never echoing `credentials_ref` / secret values.

FR-13. All three management tools are **admin-scoped**: they require a valid admin API key
(validated via `xstockstrat-identity.ValidateApiKey`, the gate `ManageSignalSource` already uses)
and must propagate `x-mcp-secret` to downstream services. Backend errors map to clear tool errors,
following `docs/runbooks/mcp-tools.md` conventions.

FR-14. `docs/runbooks/mcp-tools.md` and `docs/runbooks/indicator-builder.md` must be updated:
document the new tools (params/return/errors) and the strategy-definition model, and update the
agent's advertised tool count.

## Out of Scope

- **The continuous live→alert runtime** — owned by feature `048-live-strategy-alert-engine`. This
  feature only delivers the model, persistence, evaluator, backtest integration, and management
  tools that 048 builds on.
- Order placement / execution from a strategy (trading is downstream; this feature alerts/backtests
  only — and even alerting lives in 048).
- Position sizing (feature 023), stop-loss/bracket orders (feature 030), walk-forward validation
  (feature 032 — though it should reuse this evaluator), and the performance dashboard (feature 031).
- Editing signal-source **weights** (`analysis.signals.source_weights`) — owned by feature 007.
- New built-in indicators or new extractor implementations.
- A visual strategy builder UI (possible follow-up in config-ui/insights).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — strategy persistence, `ManageStrategy`/`GetStrategy`/`ListStrategies`, the shared evaluator, `RunBacktest` rework
- `xstockstrat-indicators` — formula components via `ExecuteFormula`/`GetFormula`; possibly a new `ListFormulas` RPC
- `xstockstrat-ingest` — unchanged; `QuerySignals` consumed for signal-weighting, `ManageSignalSource` wrapped by the MCP tool
- `xstockstrat-agent` — new MCP tools (`manage_strategy`, `manage_formula`, `manage_signal_source`)
- `xstockstrat-identity` — unchanged; reused for admin API key validation
- `packages/proto` — new analysis RPCs/messages (strategy definition + management); optional indicators `ListFormulas`

## Proto Contract Changes

New messages/RPCs in `analysis/v1/analysis.proto` (all additive/non-breaking):
- `StrategyDefinition { string strategy_id; string display_name; repeated StrategyComponent components; string entry_rule; string exit_rule; google.protobuf.Struct signal_params; bool active; }`
- `StrategyComponent { string ref_name; ComponentKind kind; string indicator; string formula_id; map<string,double> params; }` (`ComponentKind` enum: `COMPONENT_KIND_UNSPECIFIED`, `BUILTIN_INDICATOR`, `CUSTOM_FORMULA`)
- `ManageStrategy(ManageStrategyRequest) returns (StrategyDefinition)` (operation: register|update|deactivate)
- `GetStrategy(GetStrategyRequest) returns (StrategyDefinition)`
- `ListStrategies` — return stored definitions (reconcile with existing `StrategyScore`-returning RPC)
- `RunBacktestRequest` gains a way to reference a stored strategy / inline `StrategyDefinition` (additive field)
- Optional `indicators/v1`: `ListFormulas(ListFormulasRequest) returns (ListFormulasResponse)`

> Prefer enums for closed sets (`ComponentKind`, operation verb) per root CLAUDE.md proto governance; every enum gets a `_UNSPECIFIED = 0` sentinel.

## Config Key Changes

- [ ] No new platform config keys expected. (Strategies are persisted in their own table, not in
  config.) Existing `analysis.backtest.*`, `analysis.scoring.*`, `analysis.signals.source_weights`
  continue to apply.

## Database Changes

New migration in `services/xstockstrat-analysis/migrations/` (`NNN_strategies.up.sql` +
`.down.sql`): `analysis.strategies` table per FR-1. DBA review required (NNN numbering, up+down
pair, indexes on `active`). Not a hypertable (low-cardinality definition store).

## Feature Workflow Notes

Branch to create: `feature/strategy-engine` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval — additive proto + analysis/agent service changes
- [ ] DBA review + service owner — `analysis.strategies` migration
- [ ] 2 owners + platform lead — only if any change turns out breaking (not expected; all additive)

## Acceptance Criteria

1. An operator can register a strategy whose definition has ≥2 components (e.g. an SMA pair + an RSI
   filter, or a custom formula) with entry/exit rules; invalid definitions (unknown indicator,
   missing `formula_id`, undefined `ref_name`, unparseable rule) are rejected with clear errors.
2. `RunBacktest` referencing that saved strategy runs it through the shared evaluator and returns
   metrics; results are deterministic and look-ahead-free.
3. A legacy `RunBacktest` call (only `strategy_params`, no definition) produces the **same** result
   as today (SMA-crossover backward compatibility verified against current behavior).
4. `manage_strategy`, `manage_formula`, `manage_signal_source` MCP tools work end to end, are
   admin-scoped (reject without a valid admin key), and propagate `x-mcp-secret`.
5. The evaluator is structured as a reusable unit that feature 048 can call for live evaluation
   (no backtest-only assumptions baked in).
6. Existing read/ingest/backtest tools and `integration-test.sh` still pass.

## Open Questions

- [ ] **Rule representation:** constrained expression grammar (e.g. a small parser supporting
  `crosses_above/below`, comparisons, `AND/OR`) vs a structured JSON condition tree vs reusing a
  sandboxed formula as the rule. Trade-off: expressiveness vs validation/safety vs UI-ability.
- [ ] **Where the evaluator lives** so both backtest and the live engine (048) share it: a Python
  module inside `xstockstrat-analysis`, a shared library, or a dedicated RPC. Affects 048's design.
- [ ] **Backtest strategy reference shape:** stored `strategy_id` only, inline `StrategyDefinition`
  only, or both (one-off vs saved)?
- [ ] **`ListStrategies` reconciliation:** the current RPC returns in-memory `StrategyScore`s; do we
  repurpose it to return definitions, add `ListStrategyDefinitions`, or keep both?
- [ ] **Signals as a rule term:** expose the combined newsletter-signal score as a referenceable
  term in entry/exit rules, or keep it as the existing separate weighting only?
- [ ] Add a `ListFormulas` RPC to `indicators` for formula discovery in `manage_formula`?
- [ ] Should `xstockstrat-agent` be added to the reviewer-registry Service Owners table (gap)?
