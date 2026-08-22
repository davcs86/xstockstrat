# Recon: manage-strategy-accept-object-rules

**Date**: 2026-08-22
**Services**: `xstockstrat-agent` (only)

---

## Objective

Widen the `manage_strategy` MCP tool's `entry_rule`/`exit_rule` params to accept a JSON **object**
(dict) in addition to the current JSON string, normalizing a dict to a canonical JSON string
(`json.dumps`) inside the agent tool wrapper before the outbound gRPC call. This unblocks MCP clients
whose transport pre-parses JSON-object arguments (e.g. the Claude Code harness), which currently
deliver a rule object as a `dict` that the strict `str` signature rejects. Backend rule
validation/storage (`xstockstrat-analysis`) is unchanged.

## Codebase Map

- Tool wrapper: `services/xstockstrat-agent/app/tools.py`
  - `@server.tool()` — `tools.py:572`; signature `tools.py:573-587`
  - Current annotations: `entry_rule: str | None` (`tools.py:579`), `exit_rule: str | None`
    (`tools.py:580`), `signal_params: dict | None` (`tools.py:581`), `components: list[dict] | None`
    (`tools.py:578`)
  - `definition`/`supplied`/`mask` build: `tools.py:666-680` (`entry_rule` at `:670`, `exit_rule` at
    `:671`); `clear_fields` join `:685-687`; `update_mask` `:689-698`; client call `:710-716`
  - Docstring describing the rule contract: `tools.py:598-622` (ends `:622` "pass this dict
    JSON-encoded, e.g. json.dumps(...), as the entry_rule string.")
  - `import json` **already present**: `tools.py:36` (no new import needed)
- Client: `services/xstockstrat-agent/app/client.py` `manage_strategy` `client.py:673-738`
  - Rule → proto (string field, `""` default): `entry_rule=definition.get("entry_rule", "")`
    (`client.py:707`), `exit_rule=…` (`client.py:708`); built into
    `analysis_pb2.StrategyDefinition(...)` `client.py:703-721`. Proto `StrategyDefinition.entry_rule`
    is a plain `string` (`packages/proto/analysis/v1/analysis.proto`).
- Tests: `services/xstockstrat-agent/tests/`
  - `test_tools.py` `class TestManageStrategyTool` (`:793`) — the pattern for the new test: build
    server via `_make_server()`, patch `client.manage_strategy` with `AsyncMock`, invoke the raw tool
    via `await _tool_fn(server, "manage_strategy")(ctx=_ctx(ADMIN), operation=..., strategy_id=...,
    entry_rule=..., ...)`, assert on `m.call_args.kwargs["definition"]` / `["update_mask"]`. Existing
    cases pass `entry_rule="{}"` (`test_calls_client_with_args` `:796`).
  - `test_strategy_builders.py` — proto-request parity guard
    (`test_manage_strategy_definition_covers_every_proto_field` `:105`); captures the real proto req.
  - `test_client.py` — client-level manage_strategy tests inspecting the proto request.
- Docs: `docs/runbooks/mcp-tools.md` `manage_strategy` param table `:465-480` (entry_rule `:473`,
  exit_rule `:474` — cells read "string … JSON-encoded condition tree").
- Plugin: `plugins/strat-lab/skills/backtest/SKILL.md:55` names the rule fields (partial-merge
  preserved list) and `:59` (`clear_fields`), but does **not** currently instruct json.dumps
  encoding.

## Patterns to REUSE

- **`json.dumps` for dict→string** — the module is already imported (`tools.py:36`); reuse it, add no
  helper and no dependency.
- **The `supplied`→`mask`→`definition` build (`tools.py:666-680`)** — normalize the dict *before* the
  `supplied` map is constructed so the existing `is not None` mask logic and feature-070 partial-merge
  semantics are untouched (a normalized string is still non-`None`; an omitted `None` still drops out).
- **Test pattern `_tool_fn(server, "manage_strategy")(...)` + `AsyncMock` client asserting
  `definition`** (`test_tools.py:793+`) — the new dict-normalization test mirrors
  `test_calls_client_with_args`.

## Dependencies

- Proto/RPC: `AnalysisService.ManageStrategy`; `StrategyDefinition.entry_rule`/`exit_rule` are
  `string`. **No proto change** — the tool serializes the dict to that string.
- Config keys: none. Env vars: none. Migrations: none. New deps: none (`json` is stdlib, already
  imported → no `pyproject.toml`/`uv.lock` change).
- Consumer surface (C-14): the `manage_strategy` MCP tool itself (`xstockstrat-agent`).

## Existing Business Rules (C-16)

- **No existing `@AC-*` scenario** guards the `manage_strategy` input contract or rule encoding in any
  read suite (`services/xstockstrat-agent/acceptance/*.feature`,
  `docs/sdd/business-rules/platform.feature`) — the change has no promoted regression surface. Nothing
  to PRESERVE / EXTEND / CHANGE.
- `xstockstrat-analysis` (rule validation/storage owner, declared unchanged) has no acceptance suite
  yet (`services/xstockstrat-analysis/acceptance/` absent) — no cross-service guarantee to preserve.
- Note: because `manage_strategy` has zero promoted coverage, the design-adversary has no C-16 guard
  here; this feature's own `acceptance.feature` pins the widened contract (dict-normalized-to-string,
  string-unchanged) so it gains a durable guard on promotion.

## Risks / Not-found

- **Ledger trap F-12 (2026-08-02 mcp-tools-alignment):** a same-PR tool change must update the
  docstring **and** `docs/runbooks/mcp-tools.md` **and** the `strat-lab` skill together, or they drift.
  Mitigation: FR-4 + `@AC-5` require all three surfaces updated in this PR.
- **Proto-parity guard (`test_strategy_builders.py:105`)** must still pass — the normalization happens
  before the definition is built, so the proto req still carries a string `entry_rule`; no parity
  change expected, but run that test.
- Not found: no existing dict-vs-string test for the rules (this feature adds it); no strat-lab line
  currently stating json.dumps encoding (this feature adds the object-accepted note).

## Recommended Scope

Single `service` step + paired `test` step in `xstockstrat-agent`:
1. Widen `entry_rule`/`exit_rule` annotations to `str | dict | None`; before building `supplied`,
   `json.dumps` any dict value; update the docstring (`tools.py:598-622`). Paired unit test in
   `test_tools.py` (dict → identical outbound JSON string; string passes through unchanged; omitted
   still dropped).
2. `docs` updates (same PR): `docs/runbooks/mcp-tools.md:473-474` and
   `plugins/strat-lab/skills/backtest/SKILL.md` — state the rule fields accept a JSON string or object.
