# Product Spec: mcp-management-tools

**Created**: 2026-06-01

---

## Problem Statement

The `xstockstrat-agent` MCP server today exposes only read and ingest tools
(`list_signal_sources`, `extract_email_content`, `extract_website_content`, `ingest_signal`,
`emit_alert`, `run_backtest`). An operator working through Claude can list signal sources but
cannot **register, update, or deactivate** them, and has **no tools at all** for managing
strategies or indicator formulas — those require direct gRPC calls, the Config-UI, or hand-built
`grpcurl`. This feature closes that gap by adding admin-scoped management tools so the full
"register → ingest → backtest" loop can be driven from a single Claude/agent session.

## User Story

As a platform operator, I want MCP tools to register and manage signal sources, strategies, and
indicator formulas directly through the agent, so that I can set up and adjust the platform end
to end from a Claude session without dropping to raw gRPC or the Config-UI.

## Functional Requirements

**Group 1 — Source management (wraps existing backend)**

FR-1. Add a `manage_signal_source` MCP tool that wraps `IngestService.ManageSignalSource`
(operations `register` | `update` | `deactivate`). It must accept `slug`, `display_name`,
`source_type`, `config_json`, `active`, and an optional `credentials_ref`, and must surface the
same `config_json` validation errors the ingest service already enforces (e.g. `sender_patterns`
/ `subject_patterns` required for `mediated_simple_email`).

FR-2. `credentials_ref` must only ever be a reference to a `secret.*` config key — the tool must
never accept or echo a raw secret value, and the response must never include `credentials_ref`
(consistent with `list_signal_sources`, which already omits it).

**Group 2 — Formula management (wraps existing backend)**

FR-3. Add a `manage_formula` MCP tool that wraps `IndicatorsService.RegisterFormula` and
`IndicatorsService.GetFormula`, allowing an operator to register a new sandboxed formula (name,
description, source, visibility) and fetch an existing one by id/name.

FR-4. The tool must respect the indicators sandbox contract — it registers/reads formula
definitions only; it does **not** bypass or alter sandbox limits (timeout, memory, no
side-effects).

**Group 3 — Strategy management (requires a backend decision)**

FR-5. Add a `manage_strategy` MCP tool that lets an operator define/update/deactivate a **named
strategy** = a `strategy_id` label plus a reusable `strategy_params` parameter set (`fast_period`,
`slow_period`, `signal_sources`, `signal_weight`, `technical_weight`, `min_conviction`) consumed
by `AnalysisService.RunBacktest`.

FR-6. Because `xstockstrat-analysis` currently holds strategies only **ephemerally** (a named
`strategy_id` + params is supplied per `RunBacktest` call and an in-memory `StrategyScore` map is
kept; there is no persistent strategy store and no `Register/ManageStrategy` RPC), this feature
must choose and document one of:
  - (a) add a persistent strategy registry + `ManageStrategy`/`GetStrategy`/`ListStrategies(params)`
    RPCs to `xstockstrat-analysis` (proto + migration), and have the tool call those; or
  - (b) store named strategy definitions in the config service under a documented key namespace and
    have `run_backtest` resolve `strategy_id` → params from there.
  The choice is an explicit open question for the product/impl review (see Open Questions).

**Group 4 — Cross-cutting (all three tool groups)**

FR-7. All mutating tools must be **admin-scoped**: they require a valid admin API key (validated by
`xstockstrat-identity` `ValidateApiKey`, the same gate `ManageSignalSource` already enforces) and
must propagate the agent's `x-mcp-secret` on outbound calls where downstream enforcement applies.

FR-8. Each tool must return a structured success payload and map backend errors (e.g.
`INVALID_ARGUMENT`, `NOT_FOUND`, auth failures) to clear tool-level errors, following the existing
patterns in `docs/runbooks/mcp-tools.md`.

FR-9. `docs/runbooks/mcp-tools.md` must be extended with a parameter table, return shape, and error
table for each new tool, and the agent's tool count/description updated accordingly.

## Out of Scope

- A general-purpose "delete" for sources/strategies/formulas — management uses
  deactivate/overwrite semantics, never hard deletes (consistent with the registry's
  `active = FALSE` convention).
- Building new extractor implementations or new indicator built-ins.
- Scheduling/automation of these management actions (belongs to the agent-scheduler feature).
- Any change to how `RunBacktest` simulates trades — this feature only manages the inputs.
- Editing signal-source **weights** (`analysis.signals.source_weights`) — owned by
  feature 007 (signal-source-weighting).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — new MCP tools (`manage_signal_source`, `manage_formula`, `manage_strategy`); admin-scope checks
- `xstockstrat-ingest` — no change expected; `ManageSignalSource` already exists and is wrapped
- `xstockstrat-indicators` — no change expected; `RegisterFormula`/`GetFormula` already exist and are wrapped
- `xstockstrat-analysis` — depends on FR-6 decision: either new strategy-registry RPCs (+ migration) or unchanged (config-backed option)
- `xstockstrat-identity` — no change; reused for admin API key validation
- `packages/proto` — only if FR-6 option (a) is chosen (new analysis strategy RPCs)

## Proto Contract Changes

- [ ] No proto changes required — **if** strategy management uses the config-backed option (FR-6b)
- OR (FR-6a): new RPCs/messages in `analysis/v1/analysis.proto`:
  `ManageStrategy(ManageStrategyRequest) returns (StrategyDefinition)`,
  `GetStrategy(GetStrategyRequest) returns (StrategyDefinition)`, and a `StrategyDefinition`
  message (`strategy_id`, `display_name`, `google.protobuf.Struct strategy_params`, `active`).
  All additive/non-breaking. (Optionally a `ListFormulas` RPC in `indicators/v1` if formula
  discovery is wanted — currently only `GetFormula`/`RegisterFormula` exist.)

## Config Key Changes

- [ ] No new config keys — if FR-6a (RPC-backed strategy registry) is chosen
- OR (FR-6b): a documented namespace such as `analysis.strategies.<strategy_id>` (JSON params)
  read by `run_backtest`/`RunBacktest`

## Database Changes

- [ ] No schema changes — if FR-6b (config-backed) is chosen
- OR (FR-6a): a new `analysis.strategies` table (migration `NNN_strategies.up.sql` /
  `.down.sql`) storing `strategy_id` (PK), `display_name`, `params_json` (JSONB), `active`,
  `created_at` — DBA review required.

## Feature Workflow Notes

Branch to create: `feature/mcp-management-tools` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change) — applies to the agent tools and any additive analysis RPC
- [ ] 2 service owners + platform lead (breaking proto change) — not expected; all proto changes here are additive
- [ ] DBA review + service owner (schema migration) — only if FR-6a (`analysis.strategies` table) is chosen

## Acceptance Criteria

1. `manage_signal_source` can register, update, and deactivate a source via the agent; invalid
   `config_json` (e.g. missing `sender_patterns` for `mediated_simple_email`) is rejected with a
   clear error; `credentials_ref`/secret values are never echoed back.
2. `manage_formula` can register a new sandboxed formula and fetch an existing one by id/name.
3. `manage_strategy` can define/update/deactivate a named strategy, and a subsequent
   `run_backtest` referencing that `strategy_id` uses the stored params (via the FR-6 mechanism).
4. All three mutating tools reject calls lacking a valid admin API key and propagate
   `x-mcp-secret` to downstream services.
5. `docs/runbooks/mcp-tools.md` documents each new tool (params, return, errors); the agent
   reports the new tools via its tool list.
6. Existing read/ingest tools are unaffected (no regression in `list_signal_sources`,
   `ingest_signal`, `run_backtest`, etc.).

## Open Questions

- [ ] **FR-6 strategy storage:** RPC-backed persistent registry in `xstockstrat-analysis`
  (proto + migration) vs config-backed strategy definitions (`analysis.strategies.*`)? This is
  the main architectural decision and affects whether proto/DB changes are in scope.
- [ ] Should strategy management also persist the symbol universe and backtest `range`, or only
  `strategy_params` (keeping symbols/range per-run)?
- [ ] Do we add `ListFormulas` to `indicators` for discovery, or is `GetFormula` by id enough for
  the management tool?
- [ ] Admin-scope source of truth: confirm the agent should mint/forward an admin API key for
  these tools vs requiring the operator to supply one per session.
- [ ] Should `xstockstrat-agent` be added to the reviewer-registry Service Owners table as part of
  this feature (registry gap)?
