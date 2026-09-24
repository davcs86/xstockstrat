# Recon: mcp-list-correlation-prompts

**Created**: 2026-09-19
**From**: product-spec.md
**Affected services**: xstockstrat-agent (+ repo docs)

---

## Objective

Teach an AI MCP client to correlate the responses of `list_accounts`, `get_positions`,
`get_positions_by_account_id`, `list_opportunities`, and `list_strategies` — via enriched tool
docstrings and a new MCP `prompts/list` + `prompts/get` capability serving a static correlation
guide. Documents the `account_id`/`strategy_id`/`symbol` joins and the two non-joins; changes no
tool arg or return shape and no proto/config/DB.

## Codebase Map

- **`xstockstrat-agent`** (Python 3.13, mcp SDK v2 `MCPServer`)
  - Entry point / server construction: `services/xstockstrat-agent/app/main.py:63` (`create_server` →
    `register_tools(server)`); Streamable HTTP + OAuth gate in `build_http_app`
    (`app/main.py:75`), MCP dispatch `handle_mcp` (`app/main.py:173`) → `session_manager.handle_request`
    (`app/main.py:195`), which serves `tools/*` **and** `prompts/*` alike, behind `_authorized`
    (`app/main.py:130`).
  - Tool registration: `app/tools.py:276` (`def register_tools(server: MCPServer)`); every tool is a
    `@server.tool()`-decorated inner fn.
  - Target tool docstrings (the five to enrich):
    - `list_accounts` — `app/tools.py:1892` (returns `{"accounts": [...]}`, each `BrokerAccount`
      dict via `_account_to_dict` `app/client.py:1889`, `preserving_proto_field_name=True` → key `id`).
    - `get_positions` — `app/tools.py:1911` (returns `{"positions":[...], "next_page_token"}`; each
      `Position` dict → key `account_id`, `symbol`).
    - `get_positions_by_account_id` — `app/tools.py:1927` (same shape, single-account filter).
    - `list_opportunities` — `app/tools.py:1213` (each `Opportunity` → `symbol`, `strategy_id`,
      `provenance[]` incl. `"position"`).
    - `list_strategies` — `app/tools.py:1199` (returns `{"strategies":[<definition>...]}`, each
      `StrategyDefinition` → `strategy_id`).
  - Client serializers: `list_positions` `app/client.py:2069`; `list_broker_accounts`
    `app/client.py:2184`; `list_opportunities` `app/client.py:802`; `list_strategy_definitions`
    `app/client.py:925`.
  - Orphaned prompt asset (precedent for a file-backed prompt body): `app/prompts/signal_extraction.md`
    (present, **not** wired to any code — grep for `signal_extraction` in `app/**.py` → 0 hits);
    `app/prompts/__init__.py` is empty.
  - Tool catalog metadata route (tools only, no prompts): `list_tools_metadata` `app/main.py:100`.

- **Proto join keys** (already exist — nothing to change):
  - `trading.v1.BrokerAccount.id = 1` (`packages/proto/trading/v1/trading.proto`).
  - `portfolio.v1.Position.account_id = 11`, `.symbol = 1` (`packages/proto/portfolio/v1/portfolio.proto`).
  - `analysis.v1.Opportunity.symbol = 1`, `.strategy_id = 7`, `.provenance = 11`
    (`packages/proto/analysis/v1/...`).
  - `analysis.v1.StrategyDefinition.strategy_id = 1` (same file).

## Patterns to REUSE

- **Prompt registration** → reuse the SDK's `@server.prompt(name=…, description=…)` decorator,
  symmetric with the existing `@server.tool()` pattern in `register_tools` (`app/tools.py:276`).
  **Verified against the installed mcp 2.0.0 SDK** (not assumed — defuses fails.md:447): `MCPServer`
  exposes `prompt`/`add_prompt`/`list_prompts`/`get_prompt`; a `str`-returning decorated fn is wrapped
  into `GetPromptResult(messages=[PromptMessage(role='user', content=TextContent(text=…))])`, served
  as `prompts/list` + `prompts/get` through the same session manager (already OAuth-gated).
- **File-backed prompt body** → reuse the `app/prompts/*.md` convention (the orphaned
  `signal_extraction.md` shows the intended home); load the correlation guide from a new
  `app/prompts/list_correlation.md` read at registration, so the guide has a single source that the
  parity test and the runbook section both reference.
- **Descriptor/parity contract test** → reuse the guard style of
  `services/xstockstrat-agent/tests/test_backtest_view.py::test_summary_key_set_covers_every_proto_field`
  (insights.md:440-443, C-10) and the existing projection-parity tests
  (`tests/test_position_parity.py`, `test_opportunity_projection.py`) — a test that fails if the
  prompt body or any of the five docstrings drops a join key.
- **Runbook parity** → extend `docs/runbooks/mcp-tools.md` (§ `## Usage Patterns`, currently
  `docs/runbooks/mcp-tools.md:1379`) with a "Correlating list responses" subsection.

## Existing Business Rules (preserve / extend)

- **PRESERVE** the opportunity/account/position tool behaviors in
  `services/xstockstrat-agent/acceptance/opportunity-live-market-enrichment.feature`,
  `opportunity-compute-robustness.feature`, and `agent-broker-account-tools.feature` — this feature
  changes **no** tool arg or return shape, only descriptions + a new prompts surface, so every
  existing `@AC-*` stays green.
- No existing acceptance scenario documents join-key correlation across these tools, and
  `docs/sdd/business-rules/platform.feature` imposes no constraint on tool descriptions/prompts — so
  this is net-new acceptance (`acceptance.feature` `@AC-1..8`), nothing to EXTEND/CHANGE.

## Dependencies

- Proto/RPC: none (join keys already on current protos; no new field).
- Migration: none.
- Config keys: none.
- Inter-service edges: none new (the five tools' existing gRPC reads are unchanged).
- New env vars / ports: none.

## Risks / Not-found

- **fails.md:447 (`agent-mcp-server`)** — assuming a decorator the SDK lacks. **Mitigated**: the
  `@server.prompt()` mechanism and `GetPromptResult` wrapping were verified by running the installed
  SDK (see Patterns to REUSE), not assumed.
- **fails.md:308-310 / insights.md:440-443 (RC-1 / C-10)** — hand-written tool docs drift from code.
  **Mitigated by scope**: FR-4 updates every describing surface in the same PR (5 docstrings +
  runbook; strat-lab carries no join guidance to reconcile — it mentions `list_strategies` only for
  ownership scoping, `plugins/strat-lab/skills/backtest/SKILL.md:21,24`), and FR-6 adds the parity
  test. Residual risk: the join text is prose, so the parity test can pin the presence of the three
  key names but not full semantic fidelity — acceptable for a doc-only guide.
- **fails.md:672-674 (Teardown)** — if `CLAUDE.md`/context-constitution is touched and context-forge
  is unavailable, the manual reconciliation is owed, not skippable. The agent `CLAUDE.md` "MCP Tools"
  table + the `tools.py` module-header inventory may need a one-line note that a prompts surface now
  exists (tool **count** unchanged at 49 — a prompt is not a tool).
- **Not found**: no existing MCP `prompts` or `resources` registration anywhere in the repo (grep for
  `.prompt(`/`list_prompts`/`get_prompt` → 0 code hits) — this is the first prompts surface.

## Recommended Scope

Advisory step boundaries for `/sdd-spec`:
1. Add `app/prompts/list_correlation.md` (the guide body) + a `register_prompts(server)` (or fold into
   `register_tools`) that registers it via `@server.prompt()`; wire into `create_server`.
2. Enrich the five tool docstrings with the join/non-join guidance (identical key names).
3. Add the parity test (prompt registered + returned; prompt body and all five docstrings name
   `account_id`, `strategy_id`, `symbol`).
4. Add the "Correlating list responses" section to `docs/runbooks/mcp-tools.md`; add a one-line
   prompts-surface note to `services/xstockstrat-agent/CLAUDE.md` + the `tools.py` module header.
5. Teardown: context-constitution/CLAUDE.md refresh for touched files.
