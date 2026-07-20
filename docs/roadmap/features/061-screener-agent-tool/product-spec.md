# Product Spec: screener-agent-tool

**Created**: 2026-06-26
**Priority Bucket**: P2 — Optional thin follow-up (4 of 6); depends on 060

---

## Problem Statement

`xstockstrat-agent` exposes 10 MCP tools (incl. `run_backtest`) but none can run a screen. The
screener should be callable by the AI agent so it can surface ranked candidates conversationally.

## User Story

As an **AI agent operator**, I want a `screen_symbols` MCP tool, so that the agent can scan a universe
and return ranked candidates.

## Functional Requirements

FR-1. Add a `screen_symbols` tool in `services/xstockstrat-agent/app/tools.py` (`@server.tool()`),
delegating to a new `client.screen_symbols(...)` in `app/client.py`.

FR-2. `client.screen_symbols` opens a fresh `grpc.aio.insecure_channel(ANALYSIS_ENDPOINT)` (default
`xstockstrat-analysis:50056`), uses `AnalysisServiceStub`, builds `ScreenSymbolsRequest`, attaches
`metadata=_metadata()` (`x-mcp-secret`), and returns the ranked results — **exactly the
per-call-channel pattern of `run_backtest`** (no pooling).

FR-3. **Read-only / non-admin** — uses `_metadata()` only and attaches **no** admin `x-access-scope`
header. (Admin-scoped calls in `app/client.py` add `("x-access-scope", "7")` inline on top of
`_metadata()`; a scan triggers no writes, so that admin scope is omitted — there is no
`_admin_metadata()` helper to call.)

## Out of Scope

- Watchlist CRUD via the agent.
- Persisting screens.
- Any analysis-side change (consumes the Feature 060 contract as-is).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — new MCP tool.
- `xstockstrat-analysis` — consumed (unchanged).

## Proto Contract Changes

- [x] No proto changes required (pure consumer of Feature 060's `ScreenSymbols`).

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes.

## Feature Workflow Notes

Branch to create: `feature/screener-agent-tool` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-agent`)
- [ ] No proto / migration / config gates

**Depends on** 060 (the `ScreenSymbols` contract).

## Acceptance Criteria

1. `screen_symbols` appears in the MCP tool list and, given a symbol list + criteria, returns ranked
   results matching a direct gRPC `ScreenSymbols` call.
2. The call carries `x-mcp-secret` and no admin headers; no other tool's behavior changes.

## Resolved Decisions

- [x] **OQ-061-a — explicit symbol list only** (resolved): the tool accepts an explicit symbol list and
  does **not** resolve a `watchlist_id` via a portfolio call, matching feature 060's resolved decision
  OQ-060-a (`ScreenSymbols` takes explicit symbols; a `watchlist_id` convenience path is a deferred
  additive follow-up). Universe resolution stays at the UI/agent caller layer.

## Open Questions

- [ ] None — all resolved (see Resolved Decisions).
