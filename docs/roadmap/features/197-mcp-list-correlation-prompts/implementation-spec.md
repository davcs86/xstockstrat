# Implementation Spec: mcp-list-correlation-prompts

**Created**: 2026-09-19
**From**: design.md (approved 2 rounds quick), recon.md
**Affected service**: xstockstrat-agent (+ repo docs)

All steps land together as one cohesive change on the assigned `claude/*` branch (harness stand-in
for `feature/mcp-list-correlation-prompts`), one PR into `main-dev`. No proto/config/DB.

---

## Step 1 — Canonical prompt body `app/prompts/list_correlation.md` `@AC-5`

Create `services/xstockstrat-agent/app/prompts/list_correlation.md` — the single canonical
correlation graph: the three join equations with exact field paths, both non-joins, and a short
"positions → accounts → opportunities → strategies" stitch example. Static text only; no user data,
no secrets (FR-5, `@AC-7`).
- `account_id`: `list_accounts[].id` ⟷ `get_positions[].account_id` (also the
  `get_positions_by_account_id` filter arg).
- `strategy_id`: `list_strategies[].strategy_id` ⟷ `list_opportunities[].strategy_id`.
- `symbol`: `get_positions[].symbol` ⟷ `list_opportunities[].symbol` (opportunity `provenance`
  carries `"position"` when a holding seeded the row).
- Non-joins: `get_positions` rows carry no `strategy_id`; `list_opportunities`/`list_strategies`
  rows carry no `account_id`.

## Step 2 — `register_prompts(server)` + wire into `create_server` `@AC-4` `@AC-5`

In `services/xstockstrat-agent/app/tools.py`, add `def register_prompts(server: MCPServer) -> None:`
(separate from `register_tools` at `app/tools.py:276` — no `CallerPropagationMiddleware`). It reads
the Step-1 file at a **module-relative** path
(`pathlib.Path(__file__).parent / "prompts" / "list_correlation.md"`, never CWD-relative) once and
registers one `@server.prompt(name="list_correlation_guide", title=…, description=…)` returning the
body as `str`. Verified SDK contract: the `str` is wrapped into
`GetPromptResult(messages=[PromptMessage(role='user', content=TextContent(text=…))])`.
Wire in `app/main.py:63-66` `create_server`: `register_tools(server); register_prompts(server)`.

## Step 3 — Server `instructions` cross-tool summary `@AC-5` (instructions channel)

In `app/main.py` `create_server`, pass `instructions=<compact summary>` to
`MCPServer("xstockstrat-agent", instructions=…)`. ~4 lines naming all three join keys + both
non-joins + a pointer to the `list_correlation_guide` prompt. Verified: `instructions` is emitted in
the `initialize` result (`_lowlevel_server.create_initialization_options().instructions`). Keep the
summary as a module-level constant so the parity test can import/assert it (or assert via
`create_server().instructions`).

## Step 4 — Enrich the five tool docstrings (per-tool correct key sets) `@AC-1` `@AC-2` `@AC-3`

Append one `Correlation:` line to each (correct keys + relevant non-join only — never the union):
- `list_accounts` (`app/tools.py:1892`) → key `id` ⟷ `get_positions[].account_id` /
  `get_positions_by_account_id`; no `symbol`/`strategy_id`.
- `get_positions` (`:1911`) → `account_id` ⟷ `list_accounts[].id`; `symbol` ⟷
  `list_opportunities[].symbol`; no `strategy_id`.
- `get_positions_by_account_id` (`:1927`) → same line as `get_positions`.
- `list_opportunities` (`:1213`) → `symbol` ⟷ `get_positions[].symbol`; `strategy_id` ⟷
  `list_strategies[].strategy_id`; no `account_id`.
- `list_strategies` (`:1199`) → `strategy_id` ⟷ `list_opportunities[].strategy_id`; no `account_id`;
  no position references a `strategy_id`.

## Step 5 — FR-6 parity test `@AC-8` `@AC-6`

New `tests/test_list_correlation_parity.py` (mirrors `test_backtest_view.py` discipline). A shared
per-tool expected-key-set map (the correctness fix — NOT all three on all five). Asserts:
- (a) `create_server().list_prompts()` includes `list_correlation_guide` w/ non-empty description;
  `get_prompt(...)` text contains all three keys, both non-join sentences, and all three field-path
  pairings.
- (b) each of the five tools' `list_tools()` description contains exactly its correct keys + its
  non-join phrase (and NOT a key it must not claim, e.g. `list_accounts` desc must not assert a
  `strategy_id` join).
- (c) `create_server().instructions` is non-empty and names all three keys + both non-joins.
- (d) `docs/runbooks/mcp-tools.md` contains a "Correlating list responses" section naming all three
  keys + both non-joins.

## Step 6 — Maintainer parity surfaces `@AC-6`

- `docs/runbooks/mcp-tools.md`: add a "Correlating list responses" subsection under `## Usage
  Patterns` (`:1379`) + a one-line note in the header that a `prompts` capability now exists (tool
  count unchanged at 49). Explicitly a maintainer copy, not a consumer channel.
- `services/xstockstrat-agent/CLAUDE.md` "MCP Tools" section + the `tools.py` module header: one-line
  note that the agent now also exposes an MCP `prompts` surface (`list_correlation_guide`) and a
  server `instructions` correlation summary; tool count stays 49 (a prompt is not a tool).

## Step 7 — Validate + Teardown

- `uv run ruff check app tests && uv run ruff format --check app tests`
- `uv run pytest -q` (esp. the new parity test + `test_tools_endpoint.py` — tool set stays 49).
- Teardown (fails.md:672-674): run `/context-forge:context-constitution refresh` scoped to the
  touched `CLAUDE.md`; if the plugin is unavailable, perform manual reconciliation and record BOTH
  the unavailability and the manual reconciliation in the PR body — not a bare note.
