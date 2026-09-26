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
agent's advertised MCP tool inventory drops from **52 to 43** (52 is the current post-merge baseline), and **every** tool-count/inventory
surface is updated in lockstep (`copilot.ts` `COPILOT_MCP_TOOL_COUNT`, the `test_tools_endpoint.py`
name frozenset, the `tools.py` docstring, `xstockstrat-agent/CLAUDE.md`, `docs/runbooks/mcp-tools.md`).

FR-2. The DB tooling is hosted by a **psql MCP running as an isolated `supervisord`-managed container**
(its own process group + `postgres-mcp` co-process + isolated environment), **not** a new DO App
Platform service/component and **not** served by the xstockstrat-agent process. It is deployed on the
**droplet + Caddy topology (feature 084)** as a `docker`/compose unit the operator brings **up on
demand** (`docker start`) for DB administration and **stops** (`docker stop`) otherwise — so its attack
surface does not exist while it is stopped (ephemeral privileged access). It is **internal-only**: no
public ingress route; an operator reaches it out-of-band (SSH / port-forward tunnel to the droplet, or
`docker`-network-local from the droplet host). **Hard dependency: feature 084** provides the droplet
deployment substrate; 193 cannot deploy without it (merge-order `084 → 193`).

FR-3. The psql MCP authenticates callers with an **independent credential**, provisioned out-of-band
by a human with server access (the "manual user setup"), with **no dependency on** the xstockstrat
identity service, its JWT, or its access-scope ACL. Because `postgres-mcp` v0.3.0 exposes **no native
endpoint authentication** (CLI is transport/host/port/access-mode only — confirmed against
`postgres-mcp==0.3.0`), the psql MCP places an **auth layer in front of** `postgres-mcp` (which runs
as a localhost-bound co-process behind it). The exact auth mechanism is a `/sdd-design` decision
(leading candidate: a thin auth-proxy MCP reusing the agent's `mcp`-SDK server shape with a static
out-of-band credential).

FR-4. **No prompt-injectable path to SQL.** A prompt-injected `xstockstrat-agent` session has no
`db_*` tool, no `postgres-mcp` co-process, and **no psql-MCP credential**. The psql MCP has **no public
route** (internal-only, FR-2); while the operator has it running it shares the droplet's docker network
(a route exists) but the agent cannot authenticate — the per-operator credential it does not hold is
the boundary — and **while it is stopped there is no reachable DB tooling at all**. A valid xstockstrat
OAuth/JWT (even admin) presented to the psql MCP is **rejected** — xstockstrat auth confers no psql
access (the independence is verifiable, not incidental).

FR-5. The psql MCP connects to Postgres with a **dedicated, least-privilege DB role**. The existing
DML-only `xstockstrat_agent` grant (SELECT/INSERT/UPDATE/DELETE, **no DDL**) is retained as
defense-in-depth, so DDL remains denied at the grant level regardless of the tool layer (preserves the
feature-169 `@AC-4` DML-ok/DDL-denied guarantee, relocated to the new service).

FR-6. The shared DB **connection-pool budget is preserved**: `postgres-mcp` holds its single direct
connection **only while the psql MCP is running** (0 when stopped, per FR-9); the budget table row is
**re-labeled** from `xstockstrat-agent (postgres-mcp)` to the psql MCP, not added (direct-backend total
unchanged, and lower on average given the ephemeral lifecycle).

FR-7. **Per-operator authentication + durable attribution.** The psql MCP resolves each caller to a
**distinct operator identity** via a per-operator token provisioned out-of-band (a token file /
`PSQL_MCP_TOKENS` secret; not routed through the config service), and records **every** DB tool call
(statement/args + resolved operator-id + source IP + timestamp) to a **durable, tamper-evident audit
trail** that the DML role cannot mutate. Audit emission is a **hard startup precondition** — never
silently disabled (e.g. not gated on `OTEL_ENABLED`). Revocation/rotation of one operator's token does
not affect others.

FR-8. **Access controls.** The psql MCP (a) **fails closed** on missing/invalid/unknown token (401, no
tool-name leak, and **without** consulting the xstockstrat identity service or ACL); (b) applies
**rate-limiting** with a stricter **failed-authentication lockout** (429) as defense-in-depth on the
token check; and (c) **never writes the bearer token** to any access/application/SDK log. Because the
endpoint is **internal-only + ephemeral** (FR-2), the primary boundary is the absence of a public route
plus operator/host access; the per-operator token (FR-7) is the authenticator among operators who have
that access, and TLS is provided by the operator's SSH/port-forward transport rather than a public
ingress edge.

FR-9. **Ephemeral on-demand lifecycle.** The psql MCP is **not always-on**: it is started by the
operator only for a DB-admin session and stopped afterward, via `docker start`/`docker stop` on the
droplet (feature 084). When stopped, the `postgres-mcp` co-process is not running and holds no DB
connection, so there is no reachable DB-tool surface and no idle attack surface.

## Out of Scope

- The `extract_*` SSRF / prompt-injection **ingress** — a related follow-on tracked in the security
  audit report's Medium backlog; note only, not built here.
- **Broadening** the DB role's grants (DDL, superuser) — the psql MCP keeps the DML-only role; any
  grant-level change is a separate defense-in-depth follow-on.
- Sandbox OS-isolation (C-3 / DT-1) and inter-service mTLS (DT-3) — separate design tickets.
- Adding new DB capabilities/tools beyond the nine that exist today — this is a **relocation**, not an
  expansion, of the DB tool surface.

## Affected Services

Exact service names from CLAUDE.md Service Registry, plus one new isolated container (not a new DO
App Platform service/component):
- `xstockstrat-agent` — **removes** all nine `db_*` tools, the `postgres-mcp` co-process (supervisord
  entry), the `POSTGRES_MCP_*` env/DB wiring, and updates every tool-count surface. Net capability
  reduction on the injectable surface.
- **NEW — `xstockstrat-psql-mcp`** (name TBD in design) — an **isolated `supervisord`-managed
  container** (auth-proxy MCP + its own localhost `postgres-mcp` co-process + own credential + own DB
  connection), **internal-only**, run **on-demand** (`docker start/stop`) on the **feature-084 droplet
  topology**. Not a DO App Platform service/component and not a public ingress route; a Service Registry
  row records it as operator-only tooling with its ephemeral/internal nature noted.
- `xstockstrat-ui` — `src/lib/copilot.ts` `COPILOT_MCP_TOOL_COUNT` mirror (52 → 43); no user-facing
  UI view (the psql MCP is operator tooling, not a UI segment).
- Deployment/infra — **`docker-compose.yml`** (a new `xstockstrat-psql-mcp` service block + removal of
  `POSTGRES_MCP_*` from the agent block), a **new Dockerfile/process model** for the psql MCP, the
  **feature-084 droplet/compose deployment** it slots into (its up/down lifecycle lives there; **not**
  `.do/app.yaml`/`.do/app.dev.yaml` — no new App Platform component or ingress rule), and the
  `scripts/db-migrate.sh` DB-role provisioning (retained/re-labeled). **Hard dependency on feature 084.**

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — no new user-facing view. (`copilot.ts` tool count is an internal mirror, not a rendered
  surface.)
- [x] **Agent** — `xstockstrat-agent` MCP: the nine `db_*` tools are **removed** from the end-user
  agent surface (a deliberate consumer-surface **reduction**, called out here so it is not read as a
  regression). No `db_*` capability remains reachable through the xstockstrat login.
- [ ] **None**

**New operator surface (not an end-user consumer):** the **internal-only, on-demand psql MCP** — an
isolated container the operator starts on the droplet and reaches out-of-band (SSH/tunnel) with the
per-operator credential (FR-3/FR-7), deliberately outside the xstockstrat consumer/login path and with
no public route (FR-2/FR-4). It is the relocated home of the DB tooling, governed by its own auth, not
the xstockstrat ACL, and present only while the operator has it running (FR-9).

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
- [x] **New deployable + cross-feature dependency** → platform lead sign-off (a new isolated
  `supervisord` container + Service Registry entry, and a hard dependency on feature 084's droplet
  topology — merge-order `084 → 193`)
- [x] **Security review** (privilege-separation / trust-boundary focus, per reviewer-registry) — the
  independence of the psql MCP's auth from the xstockstrat ACL and the "no injectable path to SQL"
  invariant must be scrutinized.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

Each carries a **provisional decision** (checked) so the spec is complete enough to gate; every one is
an explicit **input to full `/sdd-design`**, which may overturn it with recorded rationale.

- [x] **psql MCP auth mechanism** — *Resolved (design):* a **thin auth-proxy MCP** reusing the agent's
  `mcp`-SDK server shape with a **transparent low-level-`Server` proxy** over a localhost `postgres-mcp`
  co-process, authenticating callers against a **per-operator token file** (`PSQL_MCP_TOKENS`) that
  resolves to an operator identity (FR-7). No dependency on the xstockstrat identity service / JWT / ACL.
- [x] **Deployment topology** — *Resolved (operator, design gate):* **NOT a new DO App Platform
  service/component.** An **isolated `supervisord`-managed container** on the **feature-084 droplet**,
  **internal-only** (no public ingress), run **on-demand via `docker start/stop`** (FR-2/FR-9). Rationale
  captured below; hard dependency on 084.
- [x] **Reachability + on/off (why droplet, not App Platform)** — *Resolved:* DO App Platform cannot
  scale a component to zero (`instance_count` min = 1) and its "Scale-to-Zero / Inactivity Sleep" is
  request-driven for ingress services — neither gives an operator-controlled on/off for a no-ingress
  worker (only a spec-edit + `doctl apps update` redeploy would). The droplet's `docker start/stop`
  gives true ephemeral on/off, so the psql MCP targets the 084 droplet topology, internal-only. The
  earlier "public `/psql` endpoint + trusted-IP-allowlist" question is therefore **moot** (no public
  route at all).
- [x] **DB role** — *Provisional:* **keep the existing DML-only `xstockstrat_agent` role** (DDL denied
  at grant level). Design may introduce a distinctly-named role but must not broaden grants (Out of
  Scope).
- [x] **`postgres-mcp` access-mode** — *Provisional:* keep **`--unrestricted`** (the psql MCP is the
  legitimate write path); the security boundary is the fronting auth + being off the injectable
  surface, not the vendor restriction flag. Design may reconsider.
- [x] **Feature-169 acceptance reconciliation (C-16)** — the launched `agent-postgres-mcp.feature`
  scenarios largely **CHANGE/relocate**: the `db_*` tools leave the agent; the client-side
  `confirm`-gate scenarios `@AC-12`/`@AC-13` are **removed** (the model-satisfiable gate is gone); the
  DML/DDL boundary `@AC-4` is **preserved but relocated** to the psql MCP; and the count/prefix
  guarantees are **CHANGED** — `@AC-9` (agent tool count `42`) drops to `43` on the current 52-baseline,
  and `@AC-8` (the `db_` prefix contract) is removed as the `db_` prefix leaves the agent surface
  entirely. (design.md carries the exact per-`@AC-*` disposition.) Operator has signed off
  on the pivot (`context.md`); design records the exact preserve/change/remove disposition per `@AC-*`
  ID and the promotion reconciliation.
- [x] **`confirm` flag fate** — *Resolved (design):* **kept as a NON-security fat-finger net** on the
  relocated `execute_sql` (a human write-safety affordance, distinct from the mooted model-satisfiable
  security gate). The security model is endpoint auth + off-injectable-surface.
- [x] **Trusted-IP allowlist on `/psql`** — *Superseded (operator, later gate):* **moot.** The interim
  "public `/psql` endpoint, allowlist waived" decision was itself replaced by the **internal-only,
  on-demand droplet container** (FR-2/FR-9) — there is **no public route** to restrict. The boundary is
  now no-public-route + operator/host access + the per-operator token (FR-7) + ephemeral on/off, not an
  internet-facing IP allowlist. (See `context.md`, `design.md` Open Risks.)
- [x] **Design constraint (not a question) — fails.md 2026-08-05 scope-creep near-miss:** the psql
  MCP's auth MUST NOT reuse or forward a blanket xstockstrat admin `x-access-scope`; it authenticates
  its own principal independently. Carried as a hard constraint into design + review.
