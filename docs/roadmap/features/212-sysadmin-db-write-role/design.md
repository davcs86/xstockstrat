# Design: sysadmin-db-write-role (privilege-separated psql MCP)

**Created**: 2026-09-17
**Rounds**: 2 (full; termination: approved — open risks accepted)
**Approved by**: user @ 2026-09-17 (design gate)
**Amended**: 2026-09-25 (operator, post-approval) — deployment topology changed from a new DO App
Platform service + public `/psql` route to an **isolated on-demand `supervisord` container on the
feature-084 droplet, internal-only** (`docker start/stop`). Core mechanism (thin auth-proxy + transparent
low-level proxy + per-operator token + audit + DML-only role + agent stripped of the 9 db_* tools) unchanged;
per-operator token + audit retained. See `context.md` for the decision trail.
**Grounded in**: recon.md

---

## Chosen Approach

Extract the entire database-tooling surface out of the prompt-injectable `xstockstrat-agent` MCP into
a **separate isolated `supervisord`-managed container `xstockstrat-psql-mcp`** (NOT a new DO App
Platform service/component), authenticated on its own out-of-band per-operator credential (independent
of the xstockstrat OAuth/JWT + access-scope ACL), **internal-only** and run **on-demand** (`docker
start/stop`) on the **feature-084 droplet topology** — reached out-of-band (SSH/tunnel), never a public
route. This closes security-audit **H-5** at the trust boundary: after this change the injectable agent
has **no `db_*` tool, no `postgres-mcp` co-process, no DB credential, and no credential for the psql
MCP** — there is no path from a prompt-injected agent session to SQL, and while the container is stopped
there is no DB-tool surface at all.

**Service shape (Option A — thin MCP service, chosen over Option C generic gateway).**
`services/xstockstrat-psql-mcp/` is a near-clone of the agent's proven `mcp`-SDK Streamable-HTTP
scaffold (`recon.md` Codebase Map → `services/xstockstrat-agent/app/main.py:63-66,124-128`), with its
OAuth/JWT ASGI gate (`main.py:130-147`) **replaced** by an independent per-operator token check. It
runs two supervisord programs exactly as the agent does today (`recon.md` → `supervisord.conf:5-21`):
`app.main` on its own `http_port`, and `postgres-mcp --unrestricted --transport sse --port …` bound to
localhost. Option C (crystaldba postgres-mcp behind a generic auth gateway) was rejected — it would
re-introduce a reverse-proxy container the platform deliberately removed with nginx (feature 045),
put the security boundary in third-party config, and risk MCP-over-HTTP/SSE fidelity through a
browser-oriented proxy.

**Transparent proxy (zero vendor drift) — mechanism confirmed.** Rather than hand-register nine
wrappers (the current agent pattern, `recon.md` → `tools.py:1955-2077`), the psql MCP uses the `mcp`
SDK **low-level `Server`** with `on_list_tools`/`on_call_tool` constructor handlers (verified against
`/modelcontextprotocol/python-sdk`): `on_list_tools` returns the upstream catalog fetched live from
the localhost `postgres-mcp` (a new `list_tools()` sibling on `postgres_mcp_client`, reusing the exact
per-call SSE `ClientSession` shape at `recon.md` → `postgres_mcp_client.py:26-43`), carrying
postgres-mcp's own `name`/`description`/`inputSchema` — so a postgres-mcp version bump can never leave
the psql MCP advertising a stale set. `on_call_tool` forwards to `postgres_mcp_client.call_tool(name,
args)`. Native tool names (no `db_` prefix). One documented exception: `execute_sql` runs the
relocated `_is_destructive` **fat-finger** `confirm` gate — explicitly a **human safety net, not a
security control** (the security boundary is the endpoint credential + off-injectable-surface; the
confirm gate was correctly dismissed as a *security* control by the audit because it is
model-satisfiable, but it remains a valid write-safety affordance for a human operator).

**Authentication — per-operator token file (independent principal).** A new `app/auth.py` loads a
JSON secret `PSQL_MCP_TOKENS` = `{"operators":[{"id","token","active"}]}` at startup and resolves a
presented `Authorization: Bearer <token>` via an `hmac.compare_digest` loop over active entries →
operator-id or `None` (constant-time per entry). The resolved operator-id is stamped on the ASGI
`scope["state"]` for the audit logger. It **never decodes a JWT and never reads `x-access-scope`**, so
a valid xstockstrat admin JWT can never satisfy it (`recon.md` Existing Business Rules; complies with
fails.md 2026-08-05 — no blanket-scope forwarding). Missing/unknown → 401 fail-closed, no tool-name
leak (the unauthenticated tool-catalog + OAuth `.well-known` routes are omitted). Tokens are generated
`secrets.token_urlsafe(32)` (≥256-bit) and provisioned out-of-band by a new
`scripts/psql-mcp-token.py` (Typer CLI, mirroring `scripts/manage-users.py`) — this is the "manual
user setup." Revocation/rotation = mark `active:false` / replace the entry + redeploy-restart (the map
loads at startup); the **operator runbook states this revocation path and its deploy-cycle RTO
explicitly** as a conscious trade-off (SIGHUP hot-reload deferred, YAGNI).

**Deployment + reachability — isolated on-demand container on the droplet, internal-only (operator
decision, superseding the earlier public-endpoint plan).** The psql MCP is **NOT a new DO App Platform
service/component**. It is an **isolated `supervisord`-managed container** (its own process group +
`postgres-mcp` co-process + isolated environment) deployed on the **feature-084 droplet + Caddy
topology**, run **on demand** via `docker start`/`docker stop`: the operator brings it up only for a
DB-admin session and stops it afterward (FR-2/FR-9), so there is **no idle attack surface**. It is
**internal-only** — no public ingress route; the operator reaches it out-of-band (SSH / port-forward
tunnel to the droplet). This supersedes the interim "new DO component + public `/psql` route + waived
IP-allowlist" plan: DO App Platform cannot scale a component to zero (`instance_count` min = 1) and its
inactivity-sleep is request-driven for ingress services, so it offers no operator on/off for a
no-ingress worker — the droplet's `docker start/stop` does. The **access controls** (each an FR +
acceptance scenario) are: per-operator ≥256-bit tokens (no shared secret); constant-time resolution;
fail-closed 401 with no tool-name leak and no identity-service consult; an **in-process fixed-window
rate limiter** (failed-auth→429 lockout) as defense-in-depth; the `Authorization` header **never
written to any log**; and a **durable, tamper-evident per-statement audit trail**. The primary boundary
is **no public route + operator/host access + the per-operator token + ephemeral on/off**; TLS is the
operator's SSH/tunnel transport, not a public ingress edge. DML-only DB role caps blast radius (no DDL);
`postgres-mcp` stays localhost-bound inside the container. **Hard dependency: feature 084** (merge-order
`084 → 193`) — 193's deployment/lifecycle lives in the droplet compose, not `.do/app*.yaml`.

**Audit trail — durable, not best-effort.** Every `call_tool` (and specifically `execute_sql`) emits a
structured record (statement/args + resolved operator-id + source IP + timestamp) to a **durable sink
that the DML role cannot mutate**, and audit emission is a **hard startup precondition** — not gated on
`OTEL_ENABLED` (whose init errors are deliberately swallowed, root `CLAUDE.md` § Observability, so an
OTEL-only trail could silently no-op). The concrete sink (a dedicated append-only stream/table under a
role the psql MCP's DML role cannot write, vs. a guaranteed structured-log stream) is finalized at
`/sdd-spec`; the design constraint fixed here is *durable + tamper-evident + attributed + non-optional*.

**DB role + pool budget.** Keep the existing DML-only `xstockstrat_agent` role (SELECT/INSERT/UPDATE/
DELETE, **no DDL**) provisioned by `scripts/db-migrate.sh:178-200` (`recon.md` Dependencies) — DDL
stays denied at the grant level regardless of the tool layer. The role name is retained (renaming is
zero-security-gain churn across the URI + both `.do` files + `pg_stat_activity` assertions — recorded
trade-off, C-18). The connection-pool budget row is **re-labeled** to `xstockstrat-psql-mcp`, not added
— one direct connection, direct-backend total stays 9 (`recon.md` → root `CLAUDE.md:238`;
`test_deployment_env_vars.py:59-65`).

**Consumer-surface reach (C-14).** This is a consumer-surface **reduction** on the agent (the nine
`db_*` tools leave the end-user agent MCP) plus a new **operator** surface (the psql MCP endpoint,
deliberately outside the xstockstrat login). No UI segment; `xstockstrat-ui`'s only touch is the
`COPILOT_MCP_TOOL_COUNT` mirror (52→43 on the current post-merge baseline).

**Agent removal + tool-count → 43 (52-tool baseline − 9; re-derive at execute-time).** Delete the `db_*` block + `_is_destructive` + the
`postgres_mcp_client` import (`tools.py:1951-2077`), delete `app/postgres_mcp_client.py`, drop the
`[program:postgres-mcp]` supervisord entry, drop `postgres-mcp` from the agent `pyproject.toml` +
`uv.lock`, strip `POSTGRES_MCP_*` from the agent's compose/`.do` blocks. Update all six count surfaces
to the post-removal count — 43 on the current 52-baseline (`recon.md` → `copilot.ts:21`;
`test_tools_endpoint.py:64-72`; `tools.py:4,45-53`; `CLAUDE.md:43,88-96`; `mcp-tools.md:3,37`; the
sixth is discharged by deleting the stale `agent-postgres-mcp.feature`). Re-derive the exact number at
execute-time (it moves as sibling features merge).

## Rejected Alternatives

- **In-ACL `sysadmin` role + SYSADMIN scope bit `0x10`** (the original spec) — rejected: a tool-layer
  authz gate inside the injectable agent cannot close read-shaped side-effect writes
  (`SELECT dblink_exec('INSERT …')`, `nextval`, `pg_terminate_backend`); operator pivoted to privilege
  separation (`context.md`).
- **Option C — crystaldba postgres-mcp behind a generic auth gateway** (oauth2-proxy sidecar) —
  rejected: net-new reverse-proxy container post-nginx-removal, boundary in third-party config,
  MCP-over-HTTP/SSE fidelity risk; more infra for less control.
- **Option B — pgEdge Postgres MCP (native Bearer auth)** — rejected despite its attractive native
  token-file auth: its flagship `query_database` runs read-only-transaction-wrapped (blocks
  INSERT/UPDATE/DELETE/DDL), its tool set is NL/RAG-oriented (`similarity_search`, `generate_embedding`,
  `search_knowledgebase`), and it needs an LLM/embedding dependency — fails tool-parity + write-fit
  (`recon.md` Candidate Architectures). Its *auth model* (token file) was borrowed; its tool model was not.
- **Nine hand-registered passthrough wrappers** — rejected in favor of the transparent low-level-Server
  proxy: the wrappers duplicate a surface postgres-mcp already defines and drift on a vendor bump; the
  proxy is less code and zero-drift.
- **Single shared static token** — rejected for a per-operator token file: a shared secret has no
  per-actor attribution and coarse (rotate-for-all) revocation (insights 2026-08-02; operator decision).
- **New DO App Platform service/component + public `/psql` ingress route** — the interim plan;
  **rejected (operator)** in favor of the isolated on-demand droplet container. A public route is a
  larger standing surface and DO gives no operator on/off (no scale-to-zero for a component).
- **DO App Platform internal `worker` (no ingress)** — rejected: still no operator on/off
  (`instance_count` min = 1; inactivity-sleep is request-driven for ingress services), so "off" would
  mean a spec-edit + `doctl apps update` redeploy — not the true `docker start/stop` the operator wants.
- **Same-container-as-agent supervisord program** — rejected: co-locating the privileged process in the
  injectable agent's container shares its localhost + filesystem, making FR-4 hinge on fragile
  process-user/file-perm isolation; a separate isolated container keeps the boundary structural.
- **Trusted-IP allowlist / TLS-at-public-edge** — moot: there is no public route to restrict (internal-only).
- **Audit to stdout/OTEL only** — rejected: `OTEL_ENABLED`-gated with swallowed init errors → a control
  that can silently no-op. Replaced by a durable, non-optional, tamper-evident sink.
- **Ledger as the audit sink** — rejected: the DML role can write the ledger's event store →
  self-referential/tamperable, and it would re-couple the deliberately-independent service to platform infra.

## Open Risks

- [ ] **Same-droplet docker-network reachability while running — accepted risk.** While the operator
  has the container up, it shares the droplet's docker network, so the agent container has a network
  route to it; the per-operator token (which the agent does not hold) is the boundary, and the ephemeral
  on/off (FR-9) removes even the route when stopped. Mitigated by FR-7/FR-8 (per-operator token,
  fail-closed 401, rate-limit, durable audit, no-token-in-logs) + DML-only role + on/off. — accepted;
  controls implemented per FR-7/FR-8/FR-9.
- [ ] **On/off operational discipline.** The surface is safe *because* the operator stops the container;
  a forgotten running instance is a standing surface. — consider an idle-timeout auto-stop or a healthcheck
  that alerts on a long-running psql MCP; capture in the operator runbook. Target: runbook + `/sdd-spec`.
- [ ] **Rate-limiter topology.** In-process fixed-window state is correct for a single container instance;
  the source-IP key must read the real client IP given the SSH/tunnel + droplet docker network path
  (trusted `X-Forwarded-For` only if a proxy fronts it), else it mis-keys. — pin the observed client IP +
  the single-instance assumption at `/sdd-spec`.
- [ ] **Durable audit sink choice.** The concrete tamper-evident sink (dedicated append-only table/stream
  under a non-DML role vs. a guaranteed log stream) is finalized at `/sdd-spec`; must be non-optional at
  startup. — target: the psql MCP service step.
- [ ] **Token revocation RTO.** Revocation is edit-entry + container restart (`docker restart`); no
  in-flight session kill. Runbook must state the path + RTO (fast on the droplet — a restart, not a
  full App Platform redeploy). — target: the operator-runbook step.
- [ ] **Hard dependency on feature 084 (droplet + Caddy topology).** 193's deployment/lifecycle lives in
  the droplet compose, not `.do/app*.yaml`; 193 cannot deploy until 084 lands. `/sdd-spec` must ground
  the psql-MCP compose block against 084's landed topology. — **merge-order `084 → 193`** (hard), plus
  `187 → 193` (rebase-only `tools.py`); add the `merge-order.md` entry at `/sdd-spec`.

## Constitution Rules Touched

- `C-05` — honored: no `WatchConfig` key; `PSQL_MCP_TOKENS` is a deployment-time **bootstrap secret**
  (env/secret), deliberately **not** routed through `xstockstrat-config`'s `GetSecret` (feature-147
  pattern) because a config-owned credential would re-introduce the config→identity dependency FR-4
  severs; follows the `JWT_SECRET`/`CONFIG_SECRETS_ENCRYPTION_KEY` precedent. Rationale recorded here.
- `C-08`/`P-06` — honored: every code-bearing step is test-paired (the new service's auth gate,
  transparent proxy, rate-limiter, audit, and the agent-removal count surfaces all get RED-first tests).
- `C-10` — honored: the tool-count is a duplicated value across six surfaces; all updated in lockstep to
  the post-removal count (43 on the current 52-baseline) with the frozenset/`copilot.ts` CI checks proving parity.
- `C-14` — honored: the consumer-surface reduction (agent loses `db_*`) and the new operator surface are
  both named; no stale backing service.
- `C-15`/`C-16` — honored: FRs gain covering `@AC-*`; the 13 launched feature-169 scenarios are fully
  dispositioned (below), with the operator sign-off (context.md) cited for changes/deletions.
- `C-18` — honored: transparent proxy over nine wrappers (DRY/less code), per-operator tokens over a
  shared secret (maintainability/accountability), durable audit over best-effort (the security quality
  wins over the simpler stdout), role-name-retention trade-off recorded.
- `F-01` — honored: no `.up.sql` edited (DML role is shell provisioning, not a numbered migration).
- `F-06` — honored: one direct connection re-labeled, not added; direct-backend total stays 9.
- `F-07` — honored: no config value hardcoded in source; the bootstrap secret is env-injected (per C-05 above).
- `F-02`/`F-03` — honored: all changes land via PRs onto `feature/sysadmin-db-write-role` → `main-dev`.

## Business Rules Touched (C-16)

Feature-169 `services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature` — the whole file is
retired; the 8 relocated scenarios move to a new `services/xstockstrat-psql-mcp/acceptance/psql-mcp.feature`
carrying **both** `@feature-169` (provenance) and `@feature-193` tags. Operator sign-off for the
changes/deletions is recorded in `context.md`.
- RELOCATE `@AC-1`/`@AC-2` "postgres-mcp runs/restarts under supervisord" — now under the psql MCP.
- RELOCATE (preserve) `@AC-3` "postgres-mcp not reachable outside the container" — localhost bind retained.
- RELOCATE (preserve) `@AC-4` "DML ok / DDL denied at the grant" — same DML-only role on the psql MCP.
- RELOCATE (preserve) `@AC-10` "pool budget = 1 direct conn" — row re-labeled.
- RELOCATE + re-author (inverted) `@AC-11` "`POSTGRES_MCP_DATABASE_URI` present" — now asserted in the
  psql-mcp deploy blocks **and absent from the agent block**.
- RELOCATE + re-frame `@AC-12`/`@AC-13` "destructive DML confirm gate" — kept as a **non-security
  fat-finger** net on the psql MCP `execute_sql`, distinct from the mooted injection gate.
- SUPERSEDE (delete, guarantee preserved on the new surface) `@AC-6`/`@AC-7` "non-admin / unauth denied
  a `db_` tool" — replaced in substance by this feature's `@AC-6`/`@AC-7` (JWT confers no psql access;
  uncredentialed caller fail-closed, no name leak). Recorded as *superseded-by-193*, not bare delete.
- DELETE `@AC-5` "admin invokes a `db_` tool through the agent" — no `db_` tool on the agent; replaced by
  this feature's `@AC-5` (own-credential path). Sign-off cited.
- DELETE `@AC-8` "postgres-mcp tools re-exposed with the `db_` prefix on the agent" — contradicted by
  design (native names, no prefix, off the agent). Sign-off cited; a 193 scenario asserts native names.
- DELETE `@AC-9` "six inventory surfaces = 42, `db_` prefix" — superseded by this feature's `@AC-1`/`@AC-2`
  (count 43 on the current 52-baseline, no `db_`). Sign-off cited.
No proto `Role`-enum or scope-bit change (the superseded design's; `scopes.py:39-54` untouched).
