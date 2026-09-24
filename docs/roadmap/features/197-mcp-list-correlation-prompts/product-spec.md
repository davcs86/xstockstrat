# Product Spec: mcp-list-correlation-prompts

**Created**: 2026-09-19

---

## Problem Statement

An AI agent connected to `xstockstrat-agent` over MCP can call `list_accounts`, `get_positions`,
`get_positions_by_account_id`, `list_opportunities`, and `list_strategies`, but nothing in the
surface tells it **how the responses relate**. The join keys (`account_id`, `strategy_id`,
`symbol`) and the deliberate non-joins (positions carry no `strategy_id`; opportunities/strategies
carry no `account_id`) are implicit in the protos and invisible to the client, so a model must guess
how to stitch "what I hold" (positions) to "which account" (accounts), "what is recommended"
(opportunities) and "which strategy produced it" (strategies) — leading to fabricated joins.

## User Story

As an AI agent operating the xstockstrat MCP, I want the list/read tools to document how their
responses correlate — and a dedicated correlation-guide prompt I can fetch — so that I can join
accounts, positions, opportunities, and strategies on the correct keys without guessing or
inventing fields.

## Functional Requirements

FR-1. The docstrings of `list_accounts`, `get_positions`, `get_positions_by_account_id`,
`list_opportunities`, and `list_strategies` each state the correlation key(s) that link their
response to the sibling tools' responses, and the relevant non-joins, using the real serialized
field names.

FR-2. The agent advertises an MCP **`prompts` capability**: `prompts/list` returns at least one
prompt whose name identifies it as the list-correlation guide, with a human-readable description.

FR-3. `prompts/get` for that prompt returns message content that documents the three join keys
(`account_id`: `list_accounts[].id` ⟷ `get_positions[].account_id`; `strategy_id`:
`list_strategies[].strategy_id` ⟷ `list_opportunities[].strategy_id`; `symbol`:
`get_positions[].symbol` ⟷ `list_opportunities[].symbol`) and the non-joins (positions carry no
`strategy_id`; opportunities/strategies carry no `account_id`).

FR-4. `docs/runbooks/mcp-tools.md` gains a "Correlating list responses" section whose join-key
statements match the docstrings and the prompt content (C-10 parity across all describing surfaces),
and the `strat-lab` skill is left consistent (no contradicting join guidance).

FR-5. The correlation prompt content is **static guidance only** — it contains no user data, no
account/position/strategy values, and no secrets — and the `prompts/*` requests traverse the same
OAuth-gated Streamable HTTP transport as `tools/*` (no new unauthenticated surface).

FR-6. An executable test pins the new behavior: the prompt is registered and returned by
`prompts/list`/`prompts/get`, and its content (and the enriched docstrings) name the three join
keys — mirroring the descriptor-parity discipline of `tests/test_backtest_view.py` so the doc
cannot silently drift from the tools it describes (Ledger RC-1).

## Out of Scope

- Any new **join/correlation RPC** or server-side materialized view that returns pre-joined rows —
  this feature documents existing responses, it does not compute joins.
- Adding `strategy_id` to the portfolio `Position` proto, or `account_id` to the analysis
  `Opportunity` proto — the non-joins are documented, not removed.
- MCP **resources** capability, or prompts for any tools other than the five named list/read tools.
- Changes to the tool **count** (49) — a prompt is not a tool; no tool is added or removed.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — the MCP server whose tool docstrings are enriched and which gains the
  `prompts/list` + `prompts/get` capability. **Only** this service changes (plus repo docs).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` MCP surface: enriched docstrings on `list_accounts`,
  `get_positions`, `get_positions_by_account_id`, `list_opportunities`, `list_strategies`
  (changed tool descriptions, no changed args/return shape), **and** a new MCP `prompts` surface
  (`prompts/list` + `prompts/get`) exposing the list-correlation guide prompt.
- [ ] **UI** — none.
- [ ] **None** — n/a (this is an Agent-surface change).

## Proto Contract Changes

- [x] No proto changes required — join keys already exist on the current protos (`Position.account_id`,
  `BrokerAccount.id`, `Opportunity.strategy_id`/`symbol`, `StrategyDefinition.strategy_id`); this
  feature documents them.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes.

## Feature Workflow Notes

Branch to create: `feature/mcp-list-correlation-prompts` (branch from `main-dev`).
_Harness note: this session is assigned `claude/mcp-list-correlation-prompts-…`; per the root
CLAUDE.md the harness branch is based on and PR'd into `main-dev`, standing in for the feature
branch here._
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — `xstockstrat-agent` owner (MCP contract + `mcp-tools.md` parity).
  No proto/config/schema change, so no proto-reviewer/DBA gate applies.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap — SDD-verify the SDK before spec (Ledger fails.md:447, `agent-mcp-server`).**
  Feature 009 assumed the lowlevel `mcp.server.Server` supported a `.tool()` decorator; only
  `FastMCP` did, and it surfaced only at unit-test time. Before `/sdd-spec` commits to a
  registration mechanism, confirm how `mcp.server.mcpserver.MCPServer` (mcp 2.0.0) registers
  prompts (`@server.prompt()` decorator vs. a lower-level `prompts/list`+`prompts/get` handler
  pair) against the **installed** SDK, not from assumption.
- [ ] **Known trap — all-surfaces parity + parity test (Ledger fails.md:308-310, RC-1 / C-10).**
  The agent's docstrings, `docs/runbooks/mcp-tools.md`, and the `strat-lab` skill drift silently
  because they are hand-written prose with no executable link to the code. This feature must update
  every describing surface in the same PR and add the FR-6 parity test.
- [ ] **Known trap — Teardown is not note-and-proceed (Ledger fails.md:672-674).** If the change
  touches any context file (`CLAUDE.md`, context-constitution) and the context-forge plugin is
  unavailable, the manual reconciliation is owed and recorded — plugin absence is not grounds to
  skip the gate.
