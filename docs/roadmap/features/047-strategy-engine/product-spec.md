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

FR-3. A definition must declare **entry** and **exit** rules as a **structured JSON condition
tree** — a nested object of condition nodes. Inner nodes use `"op": "AND"` / `"op": "OR"`;
leaf nodes reference a component `ref_name` or numeric literal with a supported function:
`crosses_above`, `crosses_below`, `>`, `<`, `>=`, `<=` (e.g. `{"op": "AND", "conditions":
[{"lhs": "sma_fast", "fn": "crosses_above", "rhs": "sma_slow"}, {"lhs": "rsi14", "op": "<",
"rhs": 70}]}`). The tree is evaluated deterministically bar-by-bar with **no look-ahead**.
JSON condition tree chosen over a string grammar (harder to validate/transform at write time and
in the UI) and over a sandboxed formula (overkill for boolean conditions).

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
SMA logic. `RunBacktestRequest` supports two modes: (a) reference by `strategy_id` (definition
resolved from DB); (b) inline `StrategyDefinition` passed directly (for one-off runs without
saving). Both fields are additive; if both are supplied, the inline definition takes precedence.
The existing metrics (`total_return`, `sharpe_ratio`, `max_drawdown`, `win_rate`, `profit_factor`,
trades) are unchanged in shape.

FR-8. Backward compatibility: a `RunBacktest` call that supplies only the legacy
`strategy_params` (`fast_period`/`slow_period`, signal-weighting) and no stored/inline definition
must continue to behave exactly as today (SMA crossover), so existing callers and the
`run_backtest` MCP tool / `integration-test.sh` keep working.

FR-9. New/updated RPCs on `AnalysisService`: `ManageStrategy` (register | update | deactivate),
`GetStrategy`, and `ListStrategyDefinitions` returning stored strategy **definitions**. The
existing `ListStrategies` RPC (which returns in-memory `StrategyScore`s) is **unchanged** to
preserve backward compatibility. All new RPCs are additive/non-breaking at the proto level.

### Group 3 — Admin-scoped MCP management tools

FR-10. Add a `manage_strategy` MCP tool to `xstockstrat-agent` wrapping `ManageStrategy` /
`GetStrategy` / `ListStrategies`, so an operator (via Claude) can define/update/deactivate and
inspect strategies.

FR-11. Add a `manage_formula` MCP tool wrapping `IndicatorsService.RegisterFormula` /
`GetFormula` / `ListFormulas` so operators can author and discover the custom-formula components
that strategies reference. `ListFormulas` is delivered by feature `003-formula-management-ui` —
consume it as an existing RPC; do not redefine it in this feature.

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
- `xstockstrat-analysis` — strategy persistence, `ManageStrategy`/`GetStrategy`/`ListStrategyDefinitions`, the shared evaluator, `RunBacktest` rework
- `xstockstrat-indicators` — formula components via `ExecuteFormula`/`GetFormula`/`ListFormulas` (RPC delivered by feature 003; no source changes to this service)
- `xstockstrat-ingest` — unchanged; `QuerySignals` consumed for signal-weighting, `ManageSignalSource` wrapped by the MCP tool
- `xstockstrat-agent` — new MCP tools (`manage_strategy`, `manage_formula`, `manage_signal_source`)
- `xstockstrat-identity` — unchanged; reused for admin API key validation

_(Proto stubs in `packages/proto` are updated as part of this feature — see Proto Contract Changes below.)_

## Proto Contract Changes

New messages/RPCs in `analysis/v1/analysis.proto` (all additive/non-breaking):
- `StrategyDefinition { string strategy_id; string display_name; repeated StrategyComponent components; string entry_rule; string exit_rule; google.protobuf.Struct signal_params; bool active; }` — `entry_rule`/`exit_rule` are JSON-encoded condition trees (see FR-3)
- `StrategyComponent { string ref_name; ComponentKind kind; string indicator; string formula_id; map<string,double> params; }` (`ComponentKind` enum: `COMPONENT_KIND_UNSPECIFIED`, `BUILTIN_INDICATOR`, `CUSTOM_FORMULA`)
- `ManageStrategy(ManageStrategyRequest) returns (StrategyDefinition)` (operation: register|update|deactivate)
- `GetStrategy(GetStrategyRequest) returns (StrategyDefinition)`
- `ListStrategyDefinitions(ListStrategyDefinitionsRequest) returns (ListStrategyDefinitionsResponse)` — returns stored definitions; existing `ListStrategies` (returns `StrategyScore`s) is **unchanged**
- `RunBacktestRequest` gains two additive fields: `string strategy_id` (resolve from DB) and `StrategyDefinition inline_definition` (one-off run; inline takes precedence if both supplied)

`indicators/v1/indicators.proto` — no changes from this feature; `ListFormulas` is delivered by feature `003-formula-management-ui` and consumed (not redefined) here.

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
5. The evaluator is a standalone Python function or class in `xstockstrat-analysis` with a
   documented entry-point signature accepting a `StrategyDefinition`, a list of OHLCV bars, and
   active signals, and returning per-bar entry/exit decisions; it contains no backtest-only
   imports, parameters, or side-effects — verified by feature 048 being able to call it directly
   with no changes to its signature or module path.
6. Existing read/ingest/backtest tools and `integration-test.sh` still pass.

## Open Questions

- [x] **Rule representation:** RESOLVED — structured JSON condition tree (see FR-3). Chosen over
  a string grammar (harder to validate/transform at write time and in the UI) and over a
  sandboxed formula (overkill for boolean conditions). The tree is machine-validatable at write
  time (FR-5) and UI-renderable for a future visual builder.
- [x] **Where the evaluator lives:** RESOLVED — a standalone Python module (function or class)
  inside `xstockstrat-analysis`. Feature 048 imports and calls it directly from within the same
  service. A dedicated RPC is not needed as long as 048 lives in or delegates to
  `xstockstrat-analysis`; that constraint is documented in 048's product spec.
- [x] **Backtest strategy reference shape:** RESOLVED — both fields are supported: `strategy_id`
  (resolve definition from DB) and `inline_definition` (one-off run, not saved). Inline takes
  precedence if both are supplied. See FR-7 and updated Proto Contract Changes.
- [x] **`ListStrategies` reconciliation:** RESOLVED — add `ListStrategyDefinitions` as a new RPC
  returning stored definitions (see FR-9). The existing `ListStrategies` RPC (returning
  `StrategyScore`s) is unchanged to preserve backward compatibility.
- [x] **Signals as a rule term:** RESOLVED — deferred. Signals remain a separate
  conviction-weighting layer (FR-4) outside the entry/exit rule grammar for this feature. The
  evaluator's component interface must be designed so a future signal term can be added without a
  breaking change (planned for feature 048 or a dedicated follow-up). Reason: exposing a rule term
  requires the evaluator to perform gRPC I/O per component (breaking the uniform stateless-series
  model), introduces look-ahead enforcement complexity, and adds grammar scope creep before
  feature 048 defines its live-signal query contract.
- [x] **`ListFormulas` RPC:** RESOLVED — feature `003-formula-management-ui` already adds
  `ListFormulas` to `indicators/v1/indicators.proto`. This feature consumes it; do not redefine.
  See FR-11 and updated Proto Contract Changes.
- [x] **`xstockstrat-agent` reviewer-registry gap:** RESOLVED — `xstockstrat-agent` is listed in
  the Reviewers table in `feature.md` (added by /sdd-story). A separate docs PR will add it to
  `docs/runbooks/reviewer-registry.md` Service Owners table; not a blocker for this feature.
