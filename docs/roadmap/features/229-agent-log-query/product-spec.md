# Product Spec: agent-log-query

**Created**: 2026-10-16

---

## Problem Statement

Diagnosing a staging or production incident today needs out-of-band access (`doctl apps logs`, SSH to
a host) — none of it reachable from the Claude.ai conversation already connected to the agent MCP
server. No service ships logs anywhere: OTel exports traces only, so Grafana Cloud Loki holds no app
or database logs despite `docs/setup/grafana-cloud.md` saying otherwise.

## User Story

As an operator holding the `log_reader` role, I want Claude.ai — through the existing xstockstrat
agent MCP connector — to read the recent logs of the xstockstrat app services and the database host
for the environment that agent serves, so I can diagnose staging and production issues from a Claude
conversation without SSH or the DO console.

## Functional Requirements

FR-1. **Collection.** App-service container stdout/stderr and database-host logs (Postgres/TimescaleDB
server log and pgBackRest log; native install on a home LXC/VM) are shipped host-side by a collector
(Grafana Alloy) to Grafana Cloud Loki, with no change to any service's logging code. Every stream
carries the labels `environment` (`production` | `staging`), `service`, and `host`.

FR-2. **Redaction at ingest.** The collector drops or masks credential material before it leaves the
host: `Authorization`/Bearer values, JWTs, OAuth `code`/`state`/`code_verifier`/`txn`, Postgres
connection-string passwords, and PEM private-key blocks. Redacted values never reach Loki.

FR-3. **`query_logs` MCP tool.** A new read-only tool on `xstockstrat-agent` returns log lines from
Loki filtered by: `service` (closed enum: the 12 app services plus `postgres` and `pgbackrest`), an
optional `level` (closed enum), an optional literal `contains` substring, and a time window
(`since`/`until`, or a relative window). The caller never supplies raw LogQL; the agent builds the
query, escaping `contains` as a literal.

FR-4. **Environment isolation.** The agent always adds `environment=<its own APPLICATION_ENV>` to the
query. A staging agent can never return production lines, and the reverse; no tool argument
overrides this.

FR-5. **Dedicated permission.** A new role `log_reader` is added (additive proto `Role` enum value,
identity string mapping, agent and UI `rolesToAccessScope` parity, new `x-access-scope` bit `0x10`).
`query_logs` requires bit `0x10`. `admin` does **not** imply it; an admin grants it explicitly through
the existing `manage_user` roles flow.

FR-6. **Bounded output.** Line count, response bytes, and maximum time span are capped by config keys
(below). When a cap truncates the result, the response says so (`truncated: true` plus which cap).

FR-7. **Loki credential.** The Loki read-only access token is an `is_secret` config row, resolved
server-side and never present in tool output, error messages, or the unauthenticated
`GET /api/tools` catalog.

FR-8. **Audit.** Every `query_logs` call — allowed or denied — appends a ledger event recording the
caller `user_id`, environment, the filter arguments, the returned line count, and the outcome. Log
content is not copied into the ledger.

FR-9. **Failure isolation.** If Loki is unreachable, slow, or returns an error, `query_logs` fails
with a clear, credential-free error within a bounded timeout; every other agent tool is unaffected.

## Out of Scope

- Raw LogQL, metrics, or trace queries; live tail/streaming.
- Write or delete operations on logs or Loki.
- Logs of hosts outside the app services and database host (edge droplet, Proxmox, OpenClaw, LLM host).
- A UI page for logs (operators already have Grafana); the consumer surface is the agent tool only.
- Changing any service's logger or log format (the mixed slog/winston/`logging` formats are handled
  by collector-side parsing).
- Making logs available to the in-app copilot unless it already relays agent tools (see Open Questions).

## Affected Services

- `xstockstrat-agent` — new `query_logs` tool, Loki HTTP client, `scopes.py` bit `0x10`, audit append, config keys.
- `xstockstrat-identity` — `log_reader` in `ROLE_ENUM_TO_STRING`/`ROLE_STRING_TO_ENUM` so it survives JWT minting.
- `xstockstrat-ui` — `rolesToAccessScope` parity (`src/lib/auth.ts`) and the role options offered in user management.
- `xstockstrat-config` — new `agent.logs.*` keys including one `is_secret` row; `GetSecret` allow-list if the agent is not already an allowed caller.
- `xstockstrat-ledger` — receives the new audit event type (no service change expected; confirm at recon).
- `packages/proto` — `Role` enum value `ROLE_LOG_READER`.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — only the existing user-management role picker gains `log_reader`; no new page.
- [x] **Agent** — `xstockstrat-agent` MCP tool: `query_logs` (new tool). Reached from Claude.ai via the
  existing `/agent` connector (public route already allow-listed on the edge).
- [ ] **None**

## Proto Contract Changes

- `packages/proto/identity/v1/identity.proto` — `enum Role`: add `ROLE_LOG_READER` with the next
  free number. Additive, non-breaking.

## Config Key Changes

All `agent.logs.*`, scoped per environment (global, `user_id` NULL). Defaults are proposed and to be
confirmed in design:

- `agent.logs.loki_url` — Grafana Cloud Loki query base URL.
- `agent.logs.loki_user` — Grafana Cloud Loki instance/user id.
- `agent.logs.loki_token` — **`is_secret=true`**; read-only Loki access token.
- `agent.logs.max_lines` — proposed default `500`.
- `agent.logs.max_bytes` — proposed default `262144`.
- `agent.logs.max_range_hours` — proposed default `24`.
- `agent.logs.timeout_ms` — proposed default `10000`.

## Database Changes

- [x] No schema changes. `identity.users.roles` is `TEXT[]` without a CHECK constraint; to be confirmed at recon.

## Feature Workflow Notes

Branch to create: `feature/agent-log-query` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Topology during migration.** Which environment runs on the home app VM (Docker) and which still
  runs on DO App Platform? An environment on App Platform has no host for Alloy; it needs DO log
  forwarding or stays out of scope until migrated.
- [ ] **Collector ownership.** No repo defines the home app VM / DB host today (`homelab-edge` manages
  only the edge droplet; this repo has no host IaC; feature 084 is spec-only). Which repo owns the
  Alloy config and its deployment?
- [ ] **Loki retention** in Grafana Cloud (plan limit vs desired days).
- [ ] **Defaults** for the `agent.logs.*` caps above.
- [ ] **Copilot reach.** Does the in-app copilot relay agent tools under the user's own scope? If so,
  `query_logs` is reachable from the UI for `log_reader` users — confirm that is acceptable.
- [ ] **Defense in depth.** Is ingest-time redaction sufficient, or should the tool also re-apply the
  redaction patterns before returning lines?
- [ ] **Known trap (ledger `fails.md`, 2026-08-05 live-strategy-alert-engine):** forward the elevated
  bit only after the entry point has authenticated it; `0x10` must be derived from verified claims, never a header.
- [ ] **Known trap (ledger `fails.md` tool-count entries):** sync all six tool-count surfaces (45 → 46),
  including `COPILOT_MCP_TOOL_COUNT` in `services/xstockstrat-ui/src/lib/copilot.ts`.
- [ ] **Known trap (feature 183 context):** identity silently drops unknown role enums; the agent must
  validate role strings, and the identity mapping must ship before any grant.
- [ ] **Known trap (ledger, agent-mcp-server):** verify the exact Loki HTTP API (`/loki/api/v1/query_range`,
  auth scheme, limits) during recon, not at execute.
- [ ] **Doc drift:** `docs/setup/grafana-cloud.md:3` claims logs are exported via OTLP; code exports traces only. Fix in this feature's docs step.
