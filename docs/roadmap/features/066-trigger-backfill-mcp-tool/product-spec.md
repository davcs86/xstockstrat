# Product Spec: trigger-backfill-mcp-tool

**Created**: 2026-07-20

---

## Problem Statement

Backfilling historical OHLCV bars can only be triggered from the browser UI (feature 057) or by
`grpcurl` against ingest's private gRPC port. AI agents driving the platform through the MCP server
(e.g. running backtests via `run_backtest`) hit `INSUFFICIENT_DATA` / short-coverage results and
have no way to fill the gap themselves — staging currently ends at 2024-12-30, and the agent can
only report the problem instead of fixing it.

## User Story

As an AI agent operator, I want a `trigger_backfill` MCP tool on `xstockstrat-agent` that invokes
the existing `TriggerBackfill` RPC on `xstockstrat-ingest` (symbols, timeframe, optional date
range, overwrite flag), plus a way to check backfill job status, so that agents can backfill
missing OHLCV history and immediately re-run backtests without needing the browser UI or
private-network `grpcurl` access.

## Functional Requirements

FR-1. A new MCP tool on `xstockstrat-agent` triggers a backfill via ingest `TriggerBackfill`:
      `symbols` (list, required), `timeframe` (default `1d`), optional `start`/`end` date range,
      `overwrite` (default `false`), `fill_mode` (default gaps-only is NOT assumed — server
      default `FILL_MODE_FULL` applies when omitted). Returns `{job_id, status}`.
FR-2. The request must populate `timeframe_enum` (canonical enum) alongside the canonical `"1d"`
      string form; the deprecated `TriggerBackfillRequest.timeframe` string field must not be the
      only carrier (mirrors the 053 `"1Day"`-vs-`"1d"` mismatch fix).
FR-3. Agents can check job progress: given a `job_id`, return the `BackfillJob` fields
      (`status`, `bars_processed`, `bars_total`, `chunks_completed`/`chunks_total`,
      `failed_symbols`, `error`); without a `job_id`, list recent jobs (optional
      `status_filter`, `symbol` filter) via `ListBackfillJobs`.
FR-4. Authorization follows the established split: the trigger path is a **write/management** op —
      it sends `x-mcp-secret` and forwards the hardcoded admin `x-access-scope` (same pattern as
      `manage_strategy`/`manage_formula`); status/list reads send `x-mcp-secret` only (same as
      `screen_symbols`).
FR-5. Tool docs registered everywhere the MCP tool surface is described: `docs/runbooks/mcp-tools.md`
      (parameter/return/error tables) and `services/xstockstrat-agent/CLAUDE.md` tool table, with
      the tool-count wording ("eleven tools") updated. (Analog of ledger C-10(a): a new tool must be
      registered on the shared discovery surfaces, not just implemented.)
FR-6. Errors surface faithfully: ingest `INVALID_ARGUMENT` (bad timeframe/range) and `NOT_FOUND`
      (unknown `job_id`) propagate as tool errors with the backend message, consistent with the
      existing tools' error tables.

## Out of Scope

- `CancelBackfill` and `DeleteBackfilledData` — destructive/interruptive ops stay UI-only, where
  feature 057's double-confirmation guardrails (FR-5) live.
- Any change to ingest/marketdata backfill semantics, chunking, or the `BackfillBars` pipeline.
- New proto messages or RPCs — the ingest surface is reused as-is.
- Watchlist-driven symbol resolution (explicit symbol lists only, like `screen_symbols`).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — new MCP tool(s) + gRPC client calls to ingest backfill RPCs

## Proto Contract Changes

- [x] No proto changes required (reuses `TriggerBackfill`, `GetBackfillStatus`,
      `ListBackfillJobs` on `xstockstrat.ingest.v1.IngestService`)

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/trigger-backfill-mcp-tool` (branch from `main-dev`)
_Session note: work is being carried on the harness-assigned branch
`claude/custom-indicators-strategies-g38b18` (PR #769) — see context.md._
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking change, single service)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

1. Calling the trigger tool with `symbols=["AAPL"]`, `timeframe="1d"`, a date range returns a
   `job_id` and a `BACKFILL_STATUS_QUEUED`/`RUNNING` status from ingest.
2. Polling with that `job_id` returns live `bars_processed`/`bars_total` and terminal
   `COMPLETED`/`PARTIAL`/`FAILED` states, including `failed_symbols` when partial.
3. Calling without `job_id` lists recent jobs, filterable by status name and symbol.
4. The trigger call carries admin `x-access-scope` + `x-mcp-secret`; status/list carry only
   `x-mcp-secret` (verified in unit tests via captured metadata, mirroring existing tool tests).
5. `docs/runbooks/mcp-tools.md` and agent `CLAUDE.md` document the new tool(s); tool counts updated.
6. Agent test suite passes (`uv run pytest`, coverage ≥ 40%); ruff clean.

## Open Questions

- [ ] Tool shape: one `trigger_backfill` tool plus a separate `get_backfill_status` read tool
      (matches the write/read scope split cleanly), or a single tool with an `operation`
      parameter (`trigger`/`status`/`list`) like the `manage_*` family? To be settled in
      `/sdd-design quick`.
- [ ] Should `fill_mode` be exposed (`full`/`gaps_only`) or pinned to server default? Exposing it
      lets agents avoid re-fetching existing bars (cheaper Alpaca usage).
- [ ] Reviewer registry has no `xstockstrat-agent` Service Owners row — add one (registry update is
      docs-only, out of this feature's code scope but flagged).
