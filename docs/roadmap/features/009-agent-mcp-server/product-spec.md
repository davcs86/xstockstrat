# Product Spec: agent-mcp-server

**Created**: 2026-05-16

---

## Problem Statement

The platform has fully implemented webhook endpoints for signal ingestion, alerting, and backtesting, but no client-side orchestration layer exists to drive them from unstructured inputs like emails or analyst notes. Operators have no way to leverage AI reasoning over incoming signals without building bespoke tooling. Phase 1 delivers a manually-triggered MCP server that bridges Claude.ai to the platform's webhook endpoints, with zero scheduling infrastructure and human review of every action before it takes effect.

## User Story

As a platform operator, I want to connect Claude.ai to the platform's MCP server so that I can manually instruct Claude to read my emails and ingest structured trading signals, with full visibility into every tool call before it is executed.

## Functional Requirements

FR-1. A new Python service `xstockstrat-agent` must be created at `services/xstockstrat-agent/`, following the same project layout as `xstockstrat-ingest` (pyproject.toml, `app/` package, `Dockerfile`). It runs on port 9000 and has no gRPC server — it is an MCP server only.

FR-2. The MCP server must expose the following tools, each delegating via HTTP to the corresponding existing webhook endpoint:

| Tool | HTTP target | Notes |
|---|---|---|
| `list_signal_sources` | `GET`-equivalent call to ingest's `ListSignalSources` RPC via Connect-RPC HTTP | Returns slug, display_name, source_type for all active sources |
| `ingest_signal` | `POST /webhooks/ingest-signal` on `xstockstrat-ingest:8055` | Full ExternalSignal fields; source slug validated by ingest (FR-3 of 008) |
| `emit_alert` | `POST /webhooks/emit-alert` on `xstockstrat-notify:8059` | severity, category, title, body, source_service, target_user_id |
| `run_backtest` | `POST /webhooks/run-backtest` on `xstockstrat-analysis:8056` | strategy_id, symbols, initial_capital |

FR-3. A shared system prompt file must be maintained at `services/xstockstrat-agent/app/prompts/signal_extraction.md`. It must encode:
  - How to identify a trading signal in freeform text
  - Source slug lookup instructions (always call `list_signal_sources` first)
  - Conviction scoring guidance (0.0–1.0 scale, what factors increase/decrease it)
  - Mapping of the five source types to expected input formats
  - When to call `emit_alert` vs. silently skip a non-actionable email

FR-4. The MCP server must be configurable via environment variables for all downstream service endpoints (`INGEST_HTTP_URL`, `NOTIFY_HTTP_URL`, `ANALYSIS_HTTP_URL`) so it works identically in local Docker Compose and on DigitalOcean.

FR-5. The MCP server must support stdio transport (for Claude.ai desktop MCP integration) and SSE transport (for remote MCP connections). Transport is selected via the `MCP_TRANSPORT` environment variable (`stdio` | `sse`, default `stdio`). When running in SSE mode, the server listens on port 9000 and is exposed externally via `xstockstrat-nginx` at the path `/agent/sse` — operators connect using the nginx URL, not the raw port.

FR-5a. The SSE endpoint (`/agent/sse`) must require a valid API key in the `Authorization: Bearer <key>` header. The agent service validates the key against the identity service's `ValidateApiKey` RPC before accepting the SSE connection. Missing or invalid keys must return HTTP 401.

FR-6. All downstream HTTP calls must include the `x-webhook-secret` header using the value from the `N8N_WEBHOOK_SECRET` environment variable. This also makes the MCP server the first caller to enforce the webhook secret that is documented but currently unimplemented across all services. (Note: the webhook secret enforcement on the service side is a separate security feature and is not in scope here — the MCP server sends the header regardless.)

FR-7. A `docker-compose.yml` override or service entry must allow running `xstockstrat-agent` locally alongside the existing stack.

FR-8. A `claude_mcp_config.json` example file must be included at `services/xstockstrat-agent/claude_mcp_config.json` showing the exact configuration snippet an operator pastes into Claude.ai or the Claude desktop app to connect to the MCP server.

## Out of Scope

- Scheduling or automated triggering (belongs in agent-scheduler, Phase 2).
- Email fetching or Gmail API integration (the operator pastes email content into Claude.ai manually in Phase 1).
- Persistent run logging or audit trail beyond what the ledger already captures via each downstream service.
- Any new gRPC proto changes — all calls go via existing HTTP webhook endpoints.
- Implementing the webhook secret check on the service side (separate security feature).

## Affected Services

- `xstockstrat-agent` — **new service** (Python, MCP server only, port 9000)
- `xstockstrat-nginx` — new upstream block and `/agent/sse` location block added
- `xstockstrat-identity` — called via `ValidateApiKey` RPC for SSE auth (no source changes required)
- `xstockstrat-ingest` — called via HTTP (no code changes required)
- `xstockstrat-notify` — called via HTTP (no code changes required)
- `xstockstrat-analysis` — called via HTTP (no code changes required)

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

No new config service keys. All configuration is via environment variables on the new service:

| Variable | Description |
|---|---|
| `INGEST_HTTP_URL` | Base URL for xstockstrat-ingest HTTP (default `http://xstockstrat-ingest:8055`) |
| `NOTIFY_HTTP_URL` | Base URL for xstockstrat-notify HTTP (default `http://xstockstrat-notify:8059`) |
| `ANALYSIS_HTTP_URL` | Base URL for xstockstrat-analysis HTTP (default `http://xstockstrat-analysis:8056`) |
| `IDENTITY_ENDPOINT` | gRPC address for identity service (default `xstockstrat-identity:50058`) |
| `N8N_WEBHOOK_SECRET` | Shared secret sent as `x-webhook-secret` header on all downstream calls |
| `MCP_TRANSPORT` | `stdio` or `sse` (default `stdio`) |
| `MCP_SSE_PORT` | Port for SSE transport listener (default `9000`) |

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/agent-mcp-server` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (new service addition, nginx routing change)
- [x] Platform Lead approval (new service, new port assignment, DO app spec addition)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. `xstockstrat-agent` starts successfully alongside the existing Docker Compose stack with no errors.
2. `list_signal_sources` returns the active sources registered in the ingest DB.
3. `ingest_signal` called with a valid source slug and required fields creates a row in `ingest.newsletter_signals` and returns a signal_id.
4. `ingest_signal` called with an unknown source slug returns a tool error (propagated from ingest's `INVALID_ARGUMENT`).
5. `emit_alert` successfully emits an alert visible in xstockstrat-notify.
6. `run_backtest` triggers a backtest and returns results.
7. All downstream calls include the `x-webhook-secret` header when `N8N_WEBHOOK_SECRET` is set.
8. The MCP server is connectable from Claude.ai using the config in `claude_mcp_config.json`.
9. An operator can paste an email body into Claude.ai, Claude calls `list_signal_sources` then `ingest_signal`, and the signal appears in the ingest DB — end to end.
10. The SSE endpoint at `/agent/sse` (via nginx port 80) returns HTTP 401 when the `Authorization` header is absent or the API key is invalid.
11. The SSE endpoint accepts a valid admin API key and establishes an SSE connection successfully.
12. `xstockstrat-agent` starts successfully on DigitalOcean dev app alongside the existing stack.

## Open Questions

- [x] Should `xstockstrat-agent` be added to the DigitalOcean app spec? **RESOLVED**: Yes — added to both `.do/app.dev.yaml` and `.do/app.yaml`.
- [x] Should the SSE transport be exposed via nginx or directly on port 9000? **RESOLVED**: Via nginx at `/agent/sse`. API key auth (validated via identity service `ValidateApiKey`) required on the SSE endpoint.
