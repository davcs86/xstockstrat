# Product Spec: agent-scheduler

**Created**: 2026-05-16

---

## Problem Statement

Phase 1 (agent-mcp-server) requires an operator to manually open Claude.ai each morning to process emails. Phase 2 removes that friction by adding a scheduled runner inside `xstockstrat-agent` that automatically fetches emails, runs the same AI extraction loop, and ingests signals — every trading day at market open, without operator intervention.

## User Story

As a platform operator, I want signal extraction to run automatically each morning before market open so that trading signals from overnight emails are in the system before the first order is placed, without me having to trigger it manually.

## Functional Requirements

FR-1. A scheduler module must be added to `services/xstockstrat-agent/app/scheduler.py` using APScheduler (`AsyncIOScheduler`). It runs alongside the existing MCP server in the same process.

FR-2. A job `morning_signal_scan` must be registered to fire at 09:00 ET (America/New_York), Monday–Friday only (cron: `hour=9, minute=0, day_of_week='mon-fri'`).

FR-3. The job must authenticate with the Gmail API using OAuth 2.0 credentials stored as a `secret.*` config key reference (`secret.agent.gmail.oauth_credentials_json`). The token refresh flow must be handled automatically; expired tokens must be refreshed without operator intervention.

FR-4. The job must fetch all unread emails from the Gmail label configured via environment variable `GMAIL_SIGNAL_LABEL` (default: `trading-signals`). Only emails not already carrying the `agent/processed` label are fetched.

FR-5. For each fetched email the job must construct a message payload containing: sender address, subject, plain-text body, and (for attachment-type sources) attachment content as base64. The source type is determined by matching the sender against the registered sources returned by `list_signal_sources`.

FR-6. The job must invoke the Anthropic SDK (`anthropic.Anthropic().messages.create`) with:
  - Model: `claude-sonnet-4-6` (configurable via `ANTHROPIC_MODEL` env var)
  - Tools: the same tool definitions used by the MCP server (`list_signal_sources`, `ingest_signal`, `emit_alert`, `run_backtest`), loaded from the shared tool registry in `app/tools/`
  - System prompt: loaded from `app/prompts/signal_extraction.md` (shared with Phase 1)
  - `max_tokens`: configurable via `agent.scheduler.max_tokens_per_email` config key (default 4096)
  - Tool use loop: continue until Claude returns `stop_reason = "end_turn"` or tool call limit is reached

FR-7. Tool calls made during the scheduler run must use the same HTTP implementations as the MCP server — no duplication. The shared tool registry (`app/tools/`) must be the single implementation used by both the MCP server (Phase 1) and the scheduler (Phase 2).

FR-8. After Claude finishes processing an email, the job must apply the `agent/processed` Gmail label to that email, preventing reprocessing on subsequent runs.

FR-9. Each scheduler run must emit two ledger events via `POST /webhooks/n8n/append-event` on `xstockstrat-ledger:8057`:
  - `agent.run.started` — payload: `{ job: "morning_signal_scan", email_count: N, started_at: ISO }`
  - `agent.run.completed` — payload: `{ job: "morning_signal_scan", emails_processed: N, tool_calls: [{tool, input_summary}], errors: [...], duration_ms: N }`

FR-10. If Claude returns an error or the Anthropic API is unavailable for a given email, the job must log the error, skip that email (do not apply `agent/processed` label), and continue to the next. A failed run must emit `agent.run.completed` with the error list — it must never crash the scheduler process.

FR-11. The schedule must be configurable: `agent.scheduler.enabled` (bool, default `true`) and `agent.scheduler.cron` (string, default `"0 9 * * 1-5"`) read from the config service via WatchConfig at startup, allowing the schedule to be paused or adjusted without a restart.

FR-12. The Anthropic API key must be read from environment variable `ANTHROPIC_API_KEY` and never logged or included in ledger event payloads.

## Out of Scope

- Processing non-email sources (website scraping is a future extension).
- Multi-label or multi-inbox support — single label, single Gmail account only.
- Retry logic for individual tool call failures within a run (errors are logged and skipped).
- Any UI for viewing run history (the ledger and notify service cover this).
- Changing the MCP server behaviour from Phase 1 — this feature only adds the scheduler.

## Affected Services

- `xstockstrat-agent` — scheduler module added to existing service from Phase 1 (009)
- `xstockstrat-ledger` — receives `agent.run.started` / `agent.run.completed` events (no code changes)
- `xstockstrat-ingest` — receives `ingest_signal` calls (no code changes)
- `xstockstrat-notify` — receives `emit_alert` calls (no code changes)
- `xstockstrat-analysis` — receives `run_backtest` calls (no code changes)

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

New keys (read via WatchConfig on `xstockstrat-agent`):
- `agent.scheduler.enabled` — bool, default `true` — master on/off for scheduled runs
- `agent.scheduler.cron` — string, default `"0 9 * * 1-5"` — APScheduler cron expression
- `agent.scheduler.max_tokens_per_email` — int, default `4096` — Anthropic SDK max_tokens per email

New secret key reference (not stored in config service, resolved from secret store):
- `secret.agent.gmail.oauth_credentials_json` — Gmail OAuth 2.0 credentials JSON blob

## Database Changes

- [x] No schema changes — run history is captured exclusively in the ledger event store

## Feature Workflow Notes

Branch to create: `feature/agent-scheduler` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (config key additions, ledger event schema)
- [x] Platform Lead approval (autonomous scheduled tool use, external API dependency)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. The scheduler starts with the MCP server in the same process; `agent.scheduler.enabled=false` in the config service disables the job without restarting the service.
2. At the scheduled time, the job fetches emails from the configured Gmail label and applies `agent/processed` to each processed email.
3. An email that already carries `agent/processed` is not reprocessed on subsequent runs.
4. Claude's tool calls during a run use the same HTTP implementations as the MCP server (no duplicated logic).
5. `agent.run.started` and `agent.run.completed` ledger events appear in the ledger after each run, with correct email and tool call counts.
6. If the Anthropic API is unavailable for one email, that email is skipped (no `agent/processed` label applied), the error is recorded in `agent.run.completed`, and the next email is processed.
7. The `ANTHROPIC_API_KEY` value does not appear in any log line or ledger event payload.
8. Changing `agent.scheduler.cron` via the config service reschedules the job without a restart.
9. End-to-end: the scheduler runs at 09:00 ET on a trading day, ingests at least one signal from a test email, and the signal is queryable via `QuerySignals` on the ingest service.

## Open Questions

- [ ] Should the scheduler also run a catch-up scan on service startup (in case it was down during the scheduled window), or strictly at the cron time only?
- [ ] Should attachment content be passed to Claude inline (base64 in the message) or written to a temp file and referenced by path?
- [ ] What is the maximum number of emails per run before the job self-limits to prevent runaway Anthropic API costs? (`agent.scheduler.max_emails_per_run` config key?)
