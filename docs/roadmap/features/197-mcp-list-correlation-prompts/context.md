# Context: mcp-list-correlation-prompts

**Feature**: `docs/roadmap/features/197-mcp-list-correlation-prompts/feature.md`
**Product Spec**: `docs/roadmap/features/197-mcp-list-correlation-prompts/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/197-mcp-list-correlation-prompts/implementation-spec.md`

---

## Session 2026-09-19T00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Origin**: harness task "Add prompts and docstrings to the MCP about how to use and correlate
  data between the list positions, list accounts, list opportunities, and list strategies
  responses." User (davcs86) chose, via AskUserQuestion, to (a) **also add the MCP prompts surface**
  (not docs-only) and (b) cover the **4 named tools + position variants**
  (`get_positions_by_account_id`). This new client-facing agent surface therefore routes through the
  SDD pipeline per the root CLAUDE.md Mandatory Entry Point Commandment.
- **Grounded data model** (from `packages/proto/*` + `app/client.py` serializers,
  `preserving_proto_field_name=True`):
  - `account_id` join: `list_accounts[].id` (trading `BrokerAccount.id`, field 1) ⟷
    `get_positions[].account_id` (portfolio `Position.account_id`, field 11); also the
    `get_positions_by_account_id(account_id=…)` filter argument.
  - `strategy_id` join: `list_strategies[].strategy_id` (analysis `StrategyDefinition.strategy_id`,
    field 1) ⟷ `list_opportunities[].strategy_id` (analysis `Opportunity.strategy_id`, field 7).
  - `symbol` join: `get_positions[].symbol` ⟷ `list_opportunities[].symbol`; an opportunity's
    `provenance` array also carries `"position"` when an existing holding seeded the row.
  - **Non-joins**: `Position` has no `strategy_id`; `Opportunity`/`StrategyDefinition` have no
    `account_id`.
- **Known traps captured in product-spec Open Questions** (Ledger reads):
  - fails.md:447 (`agent-mcp-server`) — verify `MCPServer` (mcp 2.0.0) prompt-registration mechanism
    against the installed SDK before /sdd-spec; do not assume a `@server.prompt()` decorator exists.
  - fails.md:308-310 (RC-1 / C-10) — update every describing surface (docstrings +
    `docs/runbooks/mcp-tools.md` + `strat-lab` skill) in the same PR and add an executable parity
    test (mirror `tests/test_backtest_view.py`).
  - fails.md:672-674 — Teardown context-forge unavailability is a blocking gap, not note-and-proceed.
- Reviewer: `xstockstrat-agent` service owner (MCP contract stability + mcp-tools.md parity). No
  proto/config/DB gates (none of those change).

## Session 2026-09-19T00:30Z — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-agent). Key reuse patterns: `@server.prompt()`
  decorator symmetric with `@server.tool()`; file-backed `app/prompts/*.md` body; parity-test guard
  style of `tests/test_backtest_view.py`. **Directly verified against the installed mcp 2.0.0 SDK**
  (fails.md:447 discipline): `@server.prompt()` exists and wraps a `str`-returning fn into
  `GetPromptResult`; `MCPServer(instructions=…)` plumbs to
  `_lowlevel_server.create_initialization_options().instructions`, i.e. it IS emitted in the MCP
  `initialize` result — so it is an auto-surfaced consumer channel, not an assumption.
- Phase 1 Grilling: 2 rounds (quick — user requested the second after a sharp steer). Round 1
  adversary (NEEDS WORK, no Floor breach): the parity test must use **per-tool correct key sets**,
  not all three tokens on all five tools (else it forces fabricated joins — the anti-goal); assert
  non-join sentences; cover the runbook copy; module-relative asset path; Teardown owed. Round-2
  steer from user (davcs86): **the runbook is inaccessible to a wire-connected consumer agent**, so
  it can only be a maintainer parity copy — pushed the design to a three-channel consumer model.
- **Chosen approach**: three consumer channels ranked by auto-reliability — (1) enriched per-tool
  docstrings [primary, auto via tools/list], (2) server `instructions` [auto on `initialize`], (3)
  prompt `list_correlation_guide` [discoverable, explicitly requested] backed by a canonical
  `app/prompts/list_correlation.md`; runbook + CLAUDE.md/module-header are maintainer-only parity;
  one FR-6 parity test binds all surfaces with the correct per-tool key set.
- **Rejected**: runbook as delivery vehicle; prompt-only/docstring-only; dropping the instructions
  channel (offered at gate, user declined); new join RPC/materialized view; codegen single-source;
  lazy prompt read; folding register_prompts into register_tools.
- **Decision (C-14)**: `GET /api/tools` stays tools-only by design — prompts/instructions are
  discoverable via their native MCP methods and enriched docstrings propagate to the catalog for
  free; recorded here as the stated deferral reason (no separate follow-up feature needed).
- Constitution rules touched: C-10, C-14, C-16, C-18, P-03/F-04. Floor breaches: none.
- Status: draft → design-approved. (Note: `/sdd-review product-spec` intentionally not run — the
  root CLAUDE.md Commandment's mandated minimum is story → design-quick → ledger.)

## Session 2026-09-19T01:00Z — sdd-spec + implementation (single cohesive change)

- Wrote implementation-spec.md (7 steps) from the approved design; status draft→implementation-ready→
  in-progress→code-completed.
- Implemented all three consumer channels + parity:
  - `app/prompts/list_correlation.md` — canonical guide (3 joins + 2 non-joins + stitch example).
  - `app/tools.py` `register_prompts(server)` — `@server.prompt("list_correlation_guide")` reading the
    .md at a **module-relative** path; wired into `create_server` (`app/main.py`) after register_tools.
  - `app/main.py` `LIST_CORRELATION_INSTRUCTIONS` passed as `MCPServer(instructions=…)` — SDK-verified
    to appear in the `initialize` result.
  - Enriched the 5 tool docstrings with per-tool CORRECT key sets + non-joins.
  - `tests/test_list_correlation_parity.py` — asserts prompt/instructions/each docstring/runbook with
    the correct per-tool key set (never the union), + a secret-leak guard.
  - Parity/maintainer surfaces: `docs/runbooks/mcp-tools.md` (§ Correlating list responses + header
    note that it is maintainer-only, not a consumer channel), agent `CLAUDE.md`, `tools.py` module
    header. Tool count stays 49 (a prompt is not a tool).
- **Teardown (fails.md:672-674)**: `/context-forge:context-constitution` is **NOT available** in this
  session (only `context-forge:context-scrubber` is listed). Performed **manual reconciliation**:
  updated the now-stale `services/xstockstrat-agent/docs/context-constitution-findings.md` dead-code
  entry (the `app/prompts/` "grep zero / no @server.prompt / no file read" evidence no longer holds
  now that `register_prompts` wires `list_correlation.md`; `signal_extraction.md` itself remains
  orphaned). Verified AGENT-4 (CallerPropagationMiddleware in `register_tools`) stays accurate —
  `register_prompts` is deliberately separate. Both the plugin unavailability and this manual
  reconciliation are recorded in the PR body.
- Validation: `ruff check` + `ruff format --check` clean; `pytest --cov=app --cov-fail-under=40` →
  441 passed, 79.17% coverage; end-to-end SDK probe confirmed instructions in initialize +
  `prompts/list`/`get` + tool count 49.
