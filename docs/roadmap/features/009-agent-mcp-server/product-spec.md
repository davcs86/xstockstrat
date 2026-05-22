# Product Spec: agent-mcp-server

**Created**: 2026-05-16

---

## Problem Statement

The platform has fully implemented webhook endpoints for signal ingestion, alerting, and backtesting, but no client-side orchestration layer exists to drive them from unstructured inputs like newsletter emails. Operators have no way to leverage AI reasoning over incoming signals without building bespoke tooling. Phase 1 delivers a manually-triggered MCP server that bridges Claude.ai to the platform's webhook endpoints. Claude uses the Gmail MCP server to read emails, the agent MCP server to extract their content and ingest structured signals, with full visibility into every tool call before it takes effect.

## User Story

As a platform operator, I want to connect Claude.ai to the platform's MCP server so that I can manually instruct Claude to read my newsletter emails and ingest structured trading signals, with full visibility into every tool call before it is executed.

## Functional Requirements

FR-1. A new Python service `xstockstrat-agent` must be created at `services/xstockstrat-agent/`, following the same project layout as `xstockstrat-ingest` (pyproject.toml, `app/` package, `Dockerfile`). It runs on port 9000 and has no gRPC server — it is an MCP server only.

FR-2. The MCP server must expose the following tools:

| Tool | Implementation | Notes |
|---|---|---|
| `list_signal_sources` | Connect-RPC HTTP call to ingest's `ListSignalSources` RPC on port 8055 | Accepts optional `source_type` filter (e.g. `["simple_email","email_attachment","linked_email"]`). Returns slug, display_name, source_type, and full `config_json` per source. Claude uses the patterns in `config_json` (sender_patterns, subject_patterns, url_patterns, etc.) to build Gmail MCP queries. |
| `extract_email_content` | Implemented directly in the agent service | Accepts `source_slug`, `body_text`, `body_html` (optional), `attachments_b64` (optional list of base64-encoded bytes), `urls` (optional list of strings). Looks up the source's `source_type` and `credentials_ref` from the signal source registry, resolves credentials from the config service if present, performs content extraction (decrypt password-protected PDFs, fetch gated URLs, etc.), and returns `{ raw_text: str }`. Claude reads this raw text and identifies signals — the tool does not parse or structure signals. Credentials are never exposed to Claude. |
| `ingest_signal` | `POST /webhooks/ingest-signal` on `xstockstrat-ingest:8055` | Full ExternalSignal fields; source slug validated by ingest (FR-3 of feature 008). Claude calls this once per signal it identified in the raw text. |
| `emit_alert` | `POST /webhooks/emit-alert` on `xstockstrat-notify:8059` | severity, category, title, body, source_service, target_user_id |
| `run_backtest` | `POST /webhooks/run-backtest` on `xstockstrat-analysis:8056` | strategy_id, symbols, initial_capital |

FR-3. A shared system prompt file must be maintained at `services/xstockstrat-agent/app/prompts/signal_extraction.md`. It must encode:
  - The standard email ingestion flow:
    1. Call `list_signal_sources` filtered to email source types to get the registered sources and their matching patterns.
    2. Use the returned `config_json` patterns (sender_patterns, subject_patterns) to query Gmail via the Gmail MCP server and retrieve matching emails.
    3. For each matching email, call `extract_email_content` with the source slug and the email content (body, attachments, or URLs as appropriate for the source type). The tool handles all credential and decryption logic internally.
    4. Read the returned raw text and identify trading signals using judgment — do not infer signals that are not clearly present.
    5. For each identified signal, call `ingest_signal` with the structured fields extracted from the raw text.
  - How to identify a trading signal in freeform text (tickers, direction, conviction indicators)
  - Conviction scoring guidance (0.0–1.0 scale, what factors increase/decrease it)
  - When to call `emit_alert` vs. silently skip a non-actionable email
  - How to handle emails that match a source pattern but contain no actionable signals

FR-4. The MCP server must be configurable via environment variables for all downstream service endpoints so it works identically in local Docker Compose and on DigitalOcean.

FR-5. The MCP server must support stdio transport (for Claude.ai desktop MCP integration) and SSE transport (for remote MCP connections). Transport is selected via the `MCP_TRANSPORT` environment variable (`stdio` | `sse`, default `stdio`). When running in SSE mode, the server listens on port 9000 and is exposed externally via `xstockstrat-nginx` at the path `/agent/sse` — operators connect using the nginx URL, not the raw port.

FR-5a. The SSE endpoint (`/agent/sse`) must require a valid API key in the `Authorization: Bearer <key>` header. The agent service validates the key against the identity service's `ValidateApiKey` RPC before accepting the SSE connection. Missing or invalid keys must return HTTP 401.

FR-6. All downstream HTTP calls from the agent must include the `x-mcp-secret` header using the value from the `MCP_AGENT_SECRET` environment variable.

FR-9. The webhook handlers in `xstockstrat-ingest`, `xstockstrat-notify`, and `xstockstrat-analysis` must enforce the `x-mcp-secret` header. When `MCP_AGENT_SECRET` is set in the receiving service's environment, any request to a `/webhooks/*` path that omits the header or presents a mismatched value must be rejected with HTTP 401. When `MCP_AGENT_SECRET` is empty the check is skipped (allows gradual rollout). The same `MCP_AGENT_SECRET` value must be configured in both the agent and all three receiving services.

FR-10. A tool reference doc must be created at `docs/runbooks/mcp-tools.md`. It must document all five MCP tools (`list_signal_sources`, `extract_email_content`, `ingest_signal`, `emit_alert`, `run_backtest`) with: purpose, all parameters (name, type, required/optional, description), return shape, and error cases. It must also cover the two transport modes (stdio vs SSE), the `MCP_AGENT_SECRET` enforcement behaviour, credential opacity for `extract_email_content`, and link to `claude_mcp_config.json` for connection setup.

FR-7. A `docker-compose.yml` override or service entry must allow running `xstockstrat-agent` locally alongside the existing stack.

FR-8. A `claude_mcp_config.json` example file must be included at `services/xstockstrat-agent/claude_mcp_config.json` showing the exact configuration snippet an operator pastes into Claude.ai or the Claude desktop app to connect to the MCP server.

## Out of Scope

- Scheduling or automated triggering (belongs in agent-scheduler, Phase 2).
- Persistent run logging or audit trail beyond what the ledger already captures via each downstream service.
- Any new gRPC proto changes — all calls go via existing HTTP webhook endpoints.
- Signal extraction logic — `extract_email_content` returns raw text only; Claude is responsible for identifying and structuring signals from that text.
- Supporting non-email source types (simple_website, authenticated_website) in `extract_email_content` — Phase 1 covers email source types only.

## Affected Services

- `xstockstrat-agent` — **new service** (Python, MCP server only, port 9000)
- `xstockstrat-nginx` — new upstream block and `/agent/sse` location block added
- `xstockstrat-identity` — called via `ValidateApiKey` RPC for SSE auth (no source changes required)
- `xstockstrat-ingest` — called via HTTP for `list_signal_sources` and `ingest_signal`; **code changes required** — add `x-mcp-secret` middleware to webhook handlers (FR-9)
- `xstockstrat-notify` — called via HTTP; **code changes required** — add `x-mcp-secret` check to webhook router (FR-9)
- `xstockstrat-analysis` — called via HTTP; **code changes required** — add `x-mcp-secret` middleware to webhook handlers (FR-9)

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

No new config service keys. All configuration is via environment variables on the new service:

| Variable | Description |
|---|---|
| `INGEST_HTTP_ENDPOINT` | Base URL for xstockstrat-ingest HTTP Connect-RPC + webhooks (default `http://xstockstrat-ingest:8055`) |
| `NOTIFY_HTTP_ENDPOINT` | Base URL for xstockstrat-notify HTTP webhooks (default `http://xstockstrat-notify:8059`) |
| `ANALYSIS_HTTP_ENDPOINT` | Base URL for xstockstrat-analysis HTTP webhooks (default `http://xstockstrat-analysis:8056`) |
| `IDENTITY_ENDPOINT` | gRPC address for identity service (default `xstockstrat-identity:50058`) |
| `MCP_AGENT_SECRET` | Shared secret sent as `x-mcp-secret` header on all downstream calls (optional; header omitted when empty) |
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
2. `list_signal_sources` with no filter returns all active sources including full `config_json`. With a source_type filter it returns only sources matching those types.
3. `extract_email_content` called with a valid slug and email body returns `{ raw_text: str }` with no credentials or internal config values exposed in the response.
4. `extract_email_content` called with a slug whose source has a `credentials_ref` resolves the credential from the config service and uses it during extraction without exposing it in the tool response.
5. `extract_email_content` called with an unknown slug returns a tool error.
6. `ingest_signal` called with a valid source slug and required fields creates a row in `ingest.newsletter_signals` and returns a signal_id.
7. `ingest_signal` called with an unknown source slug returns a tool error (propagated from ingest's `INVALID_ARGUMENT`).
8. `emit_alert` successfully emits an alert visible in xstockstrat-notify.
9. `run_backtest` triggers a backtest and returns results.
10. All downstream calls from the agent include the `x-mcp-secret` header when `MCP_AGENT_SECRET` is set.
11. Requests to `/webhooks/*` endpoints on ingest, notify, and analysis without a valid `x-mcp-secret` header return HTTP 401 when `MCP_AGENT_SECRET` is configured on the receiving service.
12. `docs/runbooks/mcp-tools.md` exists and contains a parameter table for each of the five MCP tools, a return shape section, and an error cases section.
13. The MCP server is connectable from Claude.ai using the config in `claude_mcp_config.json`.
14. End-to-end flow: Claude calls `list_signal_sources`, uses the returned patterns to find matching emails via Gmail MCP, calls `extract_email_content` per email, identifies signals from the raw text, calls `ingest_signal` per signal — and the signal appears in the ingest DB.
15. The SSE endpoint at `/agent/sse` (via nginx port 80) returns HTTP 401 when the `Authorization` header is absent or the API key is invalid.
16. The SSE endpoint accepts a valid admin API key and establishes an SSE connection successfully.
17. `xstockstrat-agent` starts successfully on DigitalOcean dev app alongside the existing stack.

## Open Questions

- [x] Should `xstockstrat-agent` be added to the DigitalOcean app spec? **RESOLVED**: Yes — added to both `.do/app.dev.yaml` and `.do/app.yaml`.
- [x] Should the SSE transport be exposed via nginx or directly on port 9000? **RESOLVED**: Via nginx at `/agent/sse`. API key auth (validated via identity service `ValidateApiKey`) required on the SSE endpoint.
- [x] Should `list_signal_sources` expose full `config_json` to Claude? **RESOLVED**: Yes — full `config_json` is returned for flexibility. Claude uses the patterns to build Gmail MCP queries.
- [x] Should credentials/passwords be passed by Claude to `extract_email_content`? **RESOLVED**: No — the agent service resolves credentials internally using the source's `credentials_ref` from the signal source registry. Claude never sees credential values.
- [x] Should `extract_email_content` return structured signals or raw text? **RESOLVED**: Raw text only. Signal identification and structuring is Claude's responsibility; the tool handles content extraction only (decrypt, fetch, deprotect).
