# Product Spec: sysadmin-db-write-role

**Created**: 2026-09-17
**Re-baselined**: 2026-09-17 (operator pivot — see `context.md` "OPERATOR PIVOT")

> **Approach note.** This spec was re-baselined from the original "add a `sysadmin` role + SYSADMIN
> scope bit inside xstockstrat's ACL" design to a **privilege-separation** design: extract the DB
> tooling out of the prompt-injectable agent entirely. The slug is retained as a broad label; the
> mechanism changed. The prior sysadmin-role/`0x10`-bit/superset/`is_sysadmin`-field approach is
> **superseded**.

---

## Problem Statement

The MCP agent (`xstockstrat-agent`) hosts nine `db_*` tools that run SQL against the shared
TimescaleDB via a co-located `postgres-mcp` process, gated only by the ADMIN scope bit (`0x04`) plus a
`confirm=true` flag on writes. Because that agent is an LLM ingesting untrusted external content
(`extract_email_content`/`extract_website_content`, ingested signals), a **prompt-injection payload
can drive an authenticated admin session to execute arbitrary cross-schema SQL** — the `confirm` gate
is model-satisfiable, so it is not a real control (security-audit finding **H-5**,
`docs/reports/2026-09-16-trading-system-security-audit.md`). A purely in-agent authorization gate
cannot fully close this: a **read-shaped statement can still perform writes via side-effect functions**
(`SELECT dblink_exec('INSERT …')`, `SELECT nextval(…)`, `SELECT pg_terminate_backend(…)`) that any
syntactic classifier structurally cannot detect. The only complete fix is to **remove DB access from
the prompt-injectable surface entirely**.

## User Story

As a platform operator, I want the database tooling **separated out of the AI agent into a standalone
"psql MCP" service that authenticates independently of the xstockstrat login and ACL**, so that a
prompt-injected or otherwise compromised xstockstrat-agent session has **no tool, credential, or
network path to execute any SQL** — while a human operator can still reach the DB tools through their
own out-of-band credential.

## Functional Requirements

FR-1. **All nine `db_*` tools are removed from `xstockstrat-agent`**, and the `postgres-mcp`
co-process is removed from the agent container. The agent no longer connects to `postgres-mcp`. The
agent's advertised MCP tool inventory drops from **49 to 40**, and **every** tool-count/inventory
surface is updated in lockstep (`copilot.ts` `COPILOT_MCP_TOOL_COUNT`, the `test_tools_endpoint.py`
name frozenset, the `tools.py` docstring, `xstockstrat-agent/CLAUDE.md`, `docs/runbooks/mcp-tools.md`).

FR-2. A **standalone "psql MCP" service** hosts the DB tooling (the same `postgres-mcp`-backed
capabilities), reachable at **its own endpoint** — a distinct ingress route/port, **not** under
`/agent` and **not** served by the xstockstrat-agent process.

FR-3. The psql MCP authenticates callers with an **independent credential**, provisioned out-of-band
by a human with server access (the "manual user setup"), with **no dependency on** the xstockstrat
identity service, its JWT, or its access-scope ACL. Because `postgres-mcp` v0.3.0 exposes **no native
endpoint authentication** (CLI is transport/host/port/access-mode only — confirmed against
`postgres-mcp==0.3.0`), the psql MCP places an **auth layer in front of** `postgres-mcp` (which runs
as a localhost-bound co-process behind it). The exact auth mechanism is a `/sdd-design` decision
(leading candidate: a thin auth-proxy MCP reusing the agent's `mcp`-SDK server shape with a static
out-of-band credential).

FR-4. **No prompt-injectable path to SQL.** A prompt-injected `xstockstrat-agent` session has no
`db_*` tool, no `postgres-mcp` co-process, and no credential or network route that reaches the psql
MCP. A valid xstockstrat OAuth/JWT (even admin) presented to the psql MCP is **rejected** — xstockstrat
auth confers no psql access (the independence is verifiable, not incidental).

FR-5. The psql MCP connects to Postgres with a **dedicated, least-privilege DB role**. The existing
DML-only `xstockstrat_agent` grant (SELECT/INSERT/UPDATE/DELETE, **no DDL**) is retained as
defense-in-depth, so DDL remains denied at the grant level regardless of the tool layer (preserves the
feature-169 `@AC-4` DML-ok/DDL-denied guarantee, relocated to the new service).

FR-6. The shared DB **connection-pool budget is preserved**: `postgres-mcp` keeps its single direct
connection; the budget table row is **re-labeled** to the new service, not added (direct-backend total
unchanged).

FR-7. **Per-operator authentication + durable attribution.** The psql MCP resolves each caller to a
**distinct operator identity** via a per-operator token provisioned out-of-band (a token file /
`PSQL_MCP_TOKENS` secret; not routed through the config service), and records **every** DB tool call
(statement/args + resolved operator-id + source IP + timestamp) to a **durable, tamper-evident audit
trail** that the DML role cannot mutate. Audit emission is a **hard startup precondition** — never
silently disabled (e.g. not gated on `OTEL_ENABLED`). Revocation/rotation of one operator's token does
not affect others.

FR-8. **Public-endpoint compensating controls** (the operator accepted a public `/psql` endpoint and
**declined** a trusted-IP allowlist, so these controls are the boundary — see Open Questions): the
endpoint (a) **fails closed** on missing/invalid/unknown token (401, no tool-name leak, and **without**
consulting the xstockstrat identity service or ACL); (b) enforces **rate-limiting** with a stricter
**failed-authentication lockout** (429); (c) is **TLS-terminated** at the ingress edge; and (d) **never
writes the bearer token** to any access/application/SDK log.

## Out of Scope

- The `extract_*` SSRF / prompt-injection **ingress** — a related follow-on tracked in the security
  audit report's Medium backlog; note only, not built here.
- **Broadening** the DB role's grants (DDL, superuser) — the psql MCP keeps the DML-only role; any
  grant-level change is a separate defense-in-depth follow-on.
- Sandbox OS-isolation (C-3 / DT-1) and inter-service mTLS (DT-3) — separate design tickets.
- Adding new DB capabilities/tools beyond the nine that exist today — this is a **relocation**, not an
  expansion, of the DB tool surface.

## Affected Services

Exact service names from CLAUDE.md Service Registry, plus one new service:
- `xstockstrat-agent` — **removes** all nine `db_*` tools, the `postgres-mcp` co-process (supervisord
  entry), the `POSTGRES_MCP_*` env/DB wiring, and updates every tool-count surface. Net capability
  reduction on the injectable surface.
- **NEW — `xstockstrat-psql-mcp`** (name TBD in design) — the standalone psql MCP service: an auth
  layer fronting a localhost `postgres-mcp` co-process, own endpoint, own credential, own DB
  connection. (A new Service Registry row + inter-service/deployment wiring.)
- `xstockstrat-ui` — `src/lib/copilot.ts` `COPILOT_MCP_TOOL_COUNT` mirror (49 → 40); no user-facing
  UI view (the psql MCP is operator tooling, not a UI segment).
- Deployment/infra — `docker-compose.yml`, the agent `Dockerfile` (+ a new Dockerfile/process model
  for the psql MCP), `.do/app.yaml` and `.do/app.dev.yaml` (new component + ingress `prefix` rule),
  and the `scripts/db-migrate.sh` DB-role provisioning (retained/re-labeled).

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — no new user-facing view. (`copilot.ts` tool count is an internal mirror, not a rendered
  surface.)
- [x] **Agent** — `xstockstrat-agent` MCP: the nine `db_*` tools are **removed** from the end-user
  agent surface (a deliberate consumer-surface **reduction**, called out here so it is not read as a
  regression). No `db_*` capability remains reachable through the xstockstrat login.
- [ ] **None**

**New operator surface (not an end-user consumer):** the standalone **psql MCP** endpoint — reached
by a human operator with the out-of-band credential (FR-3), deliberately outside the xstockstrat
consumer/login path. It is the relocated home of the DB tooling, governed by its own auth, not the
xstockstrat ACL.

## Proto Contract Changes

- [x] **No proto changes required.** No RPC/message/enum is added or modified. (The superseded design's
  additive `User` field and the SYSADMIN scope bit are **not** part of this direction.)

## Config Key Changes

- [x] **No new config keys.** `postgres-mcp` is env-configured by deployment-time binding
  (`POSTGRES_MCP_DATABASE_URI`, transport/port), consistent with the existing pattern; the psql MCP's
  own credential is an out-of-band secret/env, not a `WatchConfig` key. Any secret handling follows the
  existing env/secret-var convention (design decides).

## Database Changes

- [x] **No schema migration.** The DML-only `xstockstrat_agent` role provisioning
  (`scripts/db-migrate.sh`) is retained/re-labeled to the new service; no new numbered migration and no
  table/column change.

## Feature Workflow Notes

Branch: `feature/sysadmin-db-write-role` (branch from `main-dev`) — retained.
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (no proto change, no migration, no new config key)
- [x] **New service** → platform lead sign-off (a new Service Registry entry + deployment component)
- [x] **Security review** (privilege-separation / trust-boundary focus, per reviewer-registry) — the
  independence of the psql MCP's auth from the xstockstrat ACL and the "no injectable path to SQL"
  invariant must be scrutinized.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

Each carries a **provisional decision** (checked) so the spec is complete enough to gate; every one is
an explicit **input to full `/sdd-design`**, which may overturn it with recorded rationale.

- [x] **psql MCP auth mechanism** — *Provisional:* a **thin auth-proxy MCP** reusing the agent's
  `mcp`-SDK Streamable-HTTP server shape, authenticating with a **static out-of-band credential**
  (bearer token / API key from a secret/env var), forwarding to a localhost `postgres-mcp` co-process.
  Forced by the grounded fact that `postgres-mcp` v0.3.0 has no native endpoint auth. Design may
  instead choose a reverse-proxy/gateway auth, or DB-credential passthrough — but "expose postgres-mcp
  directly with no auth" is ruled out by FR-3.
- [x] **New service vs. sidecar-in-agent-image** — *Provisional:* a **separate service/DO component**
  with its own ingress route (matches "separate authenticated endpoint" and keeps it off the agent
  process). Design confirms the exact topology (own container/image, own `http_port`, ingress prefix).
- [x] **DB role** — *Provisional:* **keep the existing DML-only `xstockstrat_agent` role** (DDL denied
  at grant level). Design may introduce a distinctly-named role but must not broaden grants (Out of
  Scope).
- [x] **`postgres-mcp` access-mode** — *Provisional:* keep **`--unrestricted`** (the psql MCP is the
  legitimate write path); the security boundary is the fronting auth + being off the injectable
  surface, not the vendor restriction flag. Design may reconsider.
- [x] **Feature-169 acceptance reconciliation (C-16)** — the launched `agent-postgres-mcp.feature`
  scenarios largely **CHANGE/relocate**: the `db_*` tools leave the agent; the client-side
  `confirm`-gate scenarios `@AC-12`/`@AC-13` are **removed** (the model-satisfiable gate is gone); the
  DML/DDL boundary `@AC-4` is **preserved but relocated** to the psql MCP; and **`@AC-9` (asserts the
  agent tool count `42` and the `db_` prefix contract) is CHANGED** — the count drops (to `40` on the
  current 49-baseline) and the `db_` prefix leaves the agent surface entirely. Operator has signed off
  on the pivot (`context.md`); design records the exact preserve/change/remove disposition per `@AC-*`
  ID and the promotion reconciliation.
- [x] **`confirm` flag fate** — *Resolved (design):* **kept as a NON-security fat-finger net** on the
  relocated `execute_sql` (a human write-safety affordance, distinct from the mooted model-satisfiable
  security gate). The security model is endpoint auth + off-injectable-surface.
- [x] **Trusted-IP allowlist on `/psql`** — *Resolved (operator, design gate):* **WAIVED.** The operator
  accepted a public arbitrary-origin `/psql` endpoint with the per-operator token as the sole
  internet-facing boundary, mitigated by the FR-8 compensating controls (rate-limiting + failed-auth
  lockout + TLS + no-token-in-logs) and the FR-7 durable audit + DML-only role. An allowlist remains an
  available future hardening. (Recorded accepted-risk — `context.md`, `design.md` Open Risks.)
- [x] **Design constraint (not a question) — fails.md 2026-08-05 scope-creep near-miss:** the psql
  MCP's auth MUST NOT reuse or forward a blanket xstockstrat admin `x-access-scope`; it authenticates
  its own principal independently. Carried as a hard constraint into design + review.
