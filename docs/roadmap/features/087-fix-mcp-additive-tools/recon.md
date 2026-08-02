# Recon: fix-mcp-additive-tools

**Created**: 2026-08-02
**From**: product-spec.md
**Affected services**: xstockstrat-agent (Python) — agent-only, additive, zero backend/proto change

---

## Objective

Surface five already-built backend capabilities the agent can't reach (report F-10): a `test_formula`
dry-run (`ExecuteFormula` inline source), `cancel_backfill` (`CancelBackfill`), `list_strategies`
(`ListStrategyDefinitions`, client fn exists unused), source-health fields on `list_signal_sources`,
and `emit_alert` `context`/`tags`/`correlation_id`. Each is a thin additive MCP tool/projection.

## Codebase Map

- **`xstockstrat-agent`** (Python) — CI coverage ≥40
  - Client: `services/xstockstrat-agent/app/client.py`
    - `list_signal_sources` — `:52-73` (projects slug/display_name/source_type/config_json/has_credentials; **drops health fields**)
    - `emit_alert` — `:114-141` (no context/tags/correlation_id)
    - `list_strategy_definitions` — `:375` (exists, **unused** by any tool)
    - `trigger_backfill` — `:709` (admin pattern via `_admin_metadata()`); `get_backfill_status` — `:771` (read-only, `_metadata()`)
    - No `execute_formula` client fn; no `cancel_backfill` client fn
    - `_metadata()` `:24-27` / `_admin_metadata()` (`x-access-scope:7`) `:30-32`
  - Tools: `services/xstockstrat-agent/app/tools.py` — `register_tools(server)` + `@server.tool()`; 19-tool catalog (post-086) in `tests/test_tools_endpoint.py`
  - Tests: `tests/test_client.py`, `tests/test_tools.py`, `tests/test_tools_endpoint.py`; descriptor-parity template `tests/test_backtest_view.py`

## Patterns to REUSE

- **`cancel_backfill`** → mirror `trigger_backfill` (`client.py:709`) for the admin-scoped call shape (`_admin_metadata()`), returning `MessageToDict(BackfillJob)`.
- **`test_formula`** → mirror `run_backtest`'s ExecuteFormula-adjacent projection; ExecuteFormula inline mode uses `formula_source` (not `formula_id`), `input_data`/`input_params`/`parameters`/`timeout_ms_override` (proto `indicators.proto` ExecuteFormulaRequest 1-8). Read-only → `_metadata()`.
- **`list_strategies`** → wrap the existing `client.list_strategy_definitions` (`client.py:375`); tool returns `{"strategies": [...]}`.
- **health passthrough** → extend the `list_signal_sources` manual projection with health/last_seen_at/last_error/signals_fed (SignalSource fields 8-11).
- **emit_alert fields** → add `context` (dict→`google.protobuf.Struct`), `tags` (repeated string), `correlation_id` (string) to EmitAlertRequest (fields 7-9).
- **Descriptor-parity test** → mirror `test_backtest_view.py`; put it on the `list_signal_sources` projection (RC-1 antidote).

## Dependencies

- Proto/RPC: none new. Uses existing `ExecuteFormula`, `CancelBackfill`, `ListStrategyDefinitions`, `ListSignalSources`, `EmitAlert` RPCs and their existing fields.
- Migration / config: none.
- Inter-service edges: none new (agent already dials indicators/ingest/analysis/notify).

## Risks / Not-found

- `## Not found`: no `execute_formula` / `cancel_backfill` client fn today (must add).
- SignalSource fields the projection still drops after this: `extractor_module` (superseded by the agent's `extractor_tool` derivation) and `active` (the `include_inactive` filter) — these become the parity test's `_INTENTIONALLY_DROPPED` with per-field justification.
- `signals_fed` is int64 — in the manual dict it is a Python int (JSON number); acceptable (not a MessageToDict projection). `health` is an enum → project the enum name; `last_seen_at` timestamp → RFC3339 or None.
- Ledger 2026-08-02 (fails): hand-written projections drop new proto fields — the parity test is the mandated antidote. Same-PR docs (mcp-tools.md) for the 5 new/changed surfaces.

## Recommended Scope

1. client: add `execute_formula`, `cancel_backfill`; extend `list_signal_sources` + `emit_alert` projections/params.
2. tools: register `test_formula`, `cancel_backfill`, `list_strategies`; extend `emit_alert` params; catalog 19→22.
3. tests: client + tool tests for each (RED-first); descriptor-parity over `list_signal_sources`; catalog update.
4. docs: mcp-tools.md sections + tool-count bump (19→22).
