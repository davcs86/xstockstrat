# Context: sysadmin-db-write-role  (archived 2026-10-14)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history). The slug and the original number "193" are historical labels: the final design became a psql-MCP split, not a SYSADMIN role. Superseded by feature 214 (`remove-agent-postgres-mcp`).

## Archive Synthesis — 2026-10-14 — /sdd-archiver

**What**: Set out to close security-audit H-5/DT-2 (a prompt-injected admin agent session could run arbitrary SQL through the 9 `db_*` tools). Never specced into steps or built; no PR. It went through three architectures: (1) an in-ACL SYSADMIN scope bit (`0x10`, superset, `is_sysadmin` proto field); (2) a standalone psql-MCP with a public endpoint (transparent low-level `Server` proxy over localhost postgres-mcp, per-operator token-file auth, durable audit, IP allowlist waived as accepted risk); (3) an isolated on-demand `supervisord` container on the feature-084 droplet, internal-only. Each kept `postgres-mcp` and hardened around it. The operator then judged postgres-mcp (crystaldba and pgEdge families) inherently insecure and chose elimination → feature 214.

**Why (irrecoverable rationale)**:
- The decisive reasoning: the capability itself (arbitrary SQL via postgres-mcp) was the risk, so no wrapper could fix it; every layer (token file, audit sink, proxy, droplet on/off) hardened a component the operator ended up distrusting.
- Round 1 of the original design showed a tool-layer gate cannot close "read-shaped" writes (`SELECT dblink_exec('INSERT …')`, `nextval`, `pg_terminate_backend` parse as pure reads) — this forced the first pivot to privilege separation.
- Operators already had a sanctioned out-of-band path (direct `psql` via SSH/doctl/bastion); a platform MCP surface for admin SQL was never load-bearing.
- Why a SYSADMIN role over plain agent read-only: to keep feature 169's FR-2 write capability behind a privilege no consumer can obtain. Round-1 adversary also flagged the last-admin guard keyed on the `admin` role string vs bit-superset (a correctness fork), dropping the `confirm` flag as unnecessary API churn, and keeping `sysadmin` out of the closed proto `Role` enum to avoid the `fails.md` 2026-08-06 C-10(a/d) enum-consumer trap ("no proto/migration" was the design's strength).
- The `confirm` flag was kept, reframed as a NON-security fat-finger net on `execute_sql` (model-satisfiable, so not a security control); the split between "mooted security gate" and "still-valid human safety net" was the adversary's catch.
- The 2026-09-25 topology amendment was treated as an operator-directed change to the approved design, not a re-debate, because it moves strictly toward more isolation; residual risks were written into design.md Open Risks.

**Rejected alternatives** (all moot after demotion, kept as memory):
- In-ACL `sysadmin` role + scope bit — a tool-layer gate inside the injectable agent cannot catch side-effect functions.
- Option B, pgEdge Postgres MCP — attractive native Bearer token-file auth, but `query_database` is read-only-transaction-wrapped, the tool set is NL/RAG (`similarity_search`, `generate_embedding`, `search_knowledgebase`) and it needs an LLM key; fails tool parity and write fit. Its auth model was borrowed, its tool model not.
- Option C, crystaldba behind a generic gateway (oauth2-proxy) — adds a net-new reverse-proxy container after nginx was deliberately removed (feature 045), puts the boundary in third-party config, risks MCP SSE fidelity.
- Nine hand-registered passthrough wrappers — lost to a transparent low-level `Server` proxy (`on_list_tools`/`on_call_tool`), zero vendor drift.
- Single shared static token — no per-actor attribution, all-or-nothing rotation.
- Routing the psql-MCP token through config `GetSecret` (feature-147 pattern) — a config-owned credential would re-introduce the config→identity dependency FR-4 severs; `PSQL_MCP_TOKENS` instead follows the `JWT_SECRET`/`CONFIG_SECRETS_ENCRYPTION_KEY` bootstrap-secret precedent (C-05).
- Public `/psql` DO route with IP allowlist waived — accepted at the Round-2 gate with recorded accepted-risk, then superseded as moot.
- DO internal worker / new App Platform component — App Platform cannot scale a component to zero (`instance_count` min 1; inactivity sleep is request-driven for ingress services); off would mean a spec edit + `doctl apps update` redeploy.
- Same-container `supervisord` program inside the agent — shares localhost/filesystem with the injectable process; boundary would rest on fragile process-user/file-permission isolation.
- Audit to stdout/OTEL only — `OTEL_ENABLED`-gated init errors are swallowed, so the control can silently no-op. Ledger as audit sink — the DML role can write the ledger event store, so the trail would be tamperable.
- Renaming the `xstockstrat_agent` role — deliberately retained; renaming judged zero-security-gain churn across the URI, both `.do` files and the `pg_stat_activity` assertions (C-18).

**Scars & gotchas**:
- Tool-count drift: spec said 49→40; after merging `main-dev` (46 commits, features 200–206) the baseline was 52, target 43. The six count surfaces: `copilot.ts:21`, the `test_tools_endpoint.py` frozenset, the `tools.py` docstring, agent `CLAUDE.md`, `mcp-tools.md`, the stale feature-169 `.feature`. The earlier "42" in feature-169 `@AC-9` was already stale. Lesson: merge first, re-derive counts, then re-review.
- crystaldba `postgres-mcp` v0.3.0 has NO authentication flag (CLI is only `--access-mode`, `--transport {stdio,sse,streamable-http}`, host/port); isolation is network binding only, the agent's SSE client to it was unauthenticated localhost — this forced the "auth layer in front" requirement.
- Review catches before approval: the adversary found the C-16 disposition omitted 6 of 13 launched feature-169 scenarios (`@AC-1/2/3/8/10/11`); "drop `@AC-12/13`" conflated the mooted security gate with a still-valid fat-finger net; `test_deployment_env_vars.py` would have gone vacuously green. FR-4's "no network route" clause became false twice (public endpoint, then shared docker network) and was reworded to "the credential it does not hold is the boundary". The first product-spec review failed on missing C-15 coverage for FR-5/6 and six open `- [ ]` questions. The spec-reviewer's "stale 193" flag at `merge-order.md:68` was the launched `193-fix-blend-queue-fundamentals-universe` (NNN collision), not this feature; the `084 → 193` row was later annotated void. Pool budget: the row would have been re-labeled not added; direct-backend total stays 9, frozen by `test_deployment_env_vars.py:64`.
- Facts only in the dropped SYSADMIN recon: exactly 2 roles→bitmap derive sites; a superset leaves every `& 0x04` check admitting sysadmin unchanged; the bitmap is mirrored in config `authz.ts` `ADMIN_SCOPE` and the Python servicers' `_has_admin_scope`. (The recon dossier branch was deleted after import, so commit `dea933d` may be unreachable.)

**Permanent deviations**: none — nothing shipped. Standing record: the design's 52→43 plan and its premise that DML role `xstockstrat_agent` "exists" were overtaken; 214 removes the tools and the dead provisioning block; the role was never created (gated on `POSTGRES_MCP_AGENT_PASSWORD`, never set).

**Operator sign-off (C-16)**: the operator authorised changing/relocating the launched feature-169 scenarios `@AC-12/13`, `@AC-9`, `@AC-5`, `@AC-8`, `@AC-6/7` with disposition "superseded-by-193" (supersede, not bare delete) — moot, but the recorded convention.

**Cross-feature signal**: the 193/212 → 214 arc (with 208 demoted) shows a "harden and separate" feature can be killed by a later "eliminate" decision (`insights.md` 2026-09-27). Renumbers: 193→212 (collision with launched 193) and 211→214 (collision with 211-edgar). The design leaned on `fails.md` 2026-08-05 (no blanket `x-access-scope` forwarding) and complied.

**Deferred follow-ons**: feature 214 carries the removal and operator runbook. The `extract_*` SSRF/prompt-injection ingress remains a Medium audit item (separate). Open Risks accepted but never resolved (matter only if a separate privileged DB tool resurfaces): the running container shares the droplet docker network so the agent has a route (the token is the boundary); a forgotten running container is a standing surface (idle-timeout auto-stop or healthcheck alert suggested); the rate-limiter source-IP key is unreliable behind SSH/tunnel/docker-network without trusted `X-Forwarded-For`; the audit sink was never concretely chosen (append-only table under a non-DML role vs guaranteed log stream); token revocation is `docker restart` with no in-flight session kill (SIGHUP hot-reload deferred as YAGNI).

**Failure post-mortem (demoted)**: root cause — the design framed the problem as "where to put the SQL tool safely" and never questioned whether the platform should expose an arbitrary-SQL server at all. Early signals: the adversary's round-1 read-shaped-write residual and the library's lack of auth. Platform feasibility (scale-to-zero) and dependency existence (the DB role; the 084 droplet topology, only `spec-ready`) were checked after design approval; one grep of `db-migrate.sh` would have shown the role was never provisioned.

**Ledger entries written**: insights.md (0 — existing 2026-09-27 entry covers the arc), fails.md (1) — see the 2026-10-14 entry.
**Runtime-invariant recommendations (→ /context-constitution)**: none (the token/audit invariants were never built).
**Pruned artifacts**: product-spec.md, recon.md, design.md (no implementation-spec existed) — last present at 09ec8d9a.
