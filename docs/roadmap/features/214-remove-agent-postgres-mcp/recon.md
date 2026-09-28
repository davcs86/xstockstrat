# Recon: remove-agent-postgres-mcp

**Created**: 2026-09-27
**From**: product-spec.md
**Affected services**: xstockstrat-agent (primary), xstockstrat-ui (tool-count mirror); deploy/docs surfaces

---

## Objective

Remove **all** postgres-mcp from `xstockstrat-agent` — the nine `db_*` tools, the postgres-mcp
co-process, the `POSTGRES_MCP_*` wiring, the `postgres-mcp` (and orphaned `sqlglot`) dependency, and
the dead `xstockstrat_agent` role provisioning — with **no replacement SQL-over-MCP surface**. Closes
security-audit **H-5 / DT-2** by elimination: a prompt-injected/compromised agent session is left with
no tool, co-process, credential, or network path to execute SQL. Admin SQL moves to a sanctioned
out-of-band runbook procedure (FR-4). Supersedes demoted feature 212.

## Codebase Map

- **`xstockstrat-agent`** (Python 3.13, MCP server, port 9000)
  - Tools module (single, no duplicates): `services/xstockstrat-agent/app/tools.py`
    - Module docstring "Fifty-two tools": `:4`; reaffirmation `:61`
    - Nine `db_*` tools, each `@server.tool()`: section comment `:2226`; defs at `:2230` (db_list_schemas),
      `:2241` (db_list_objects), `:2252` (db_get_object_details), `:2267` (db_execute_sql), `:2297`
      (db_explain_query), `:2308` (db_get_top_queries), `:2319` (db_analyze_workload_indexes), `:2329`
      (db_analyze_query_indexes), `:2340` (db_analyze_db_health)
    - db-only orphans-on-removal: `_is_destructive` def `:265` (+ constants `_DESTRUCTIVE_KEYS:259`,
      `_COMMENT_RE:261`, `_DESTRUCTIVE_RE:262`), used ONLY by `db_execute_sql:2282`; `sqlglot` imports `:76-77`
    - Import to drop: `from app import backtest_view, client, postgres_mcp_client` `:81`
    - **Do NOT delete** `_caller_access_scope` (`:141`) — shared by many non-db tools
  - Co-process SSE client (whole-file delete): `services/xstockstrat-agent/app/postgres_mcp_client.py`
    (`call_tool:30`, `_postgres_mcp_url:25`, sole env read `POSTGRES_MCP_PORT:26`)
  - Supervisord: `services/xstockstrat-agent/supervisord.conf` — `[program:postgres-mcp]` `:14-21`
    (cmd `:15`); `[program:app-main]` `:5-12` STAYS
  - Deps: `pyproject.toml:18` (`postgres-mcp`), `:19` (`sqlglot`, orphaned); `uv.lock:1398,1410-1412`
    (postgres-mcp 0.3.0), editable-pkg dep `:2501,2528`
  - Dockerfile/entrypoint: `Dockerfile` has NO postgres-mcp ref; shared `scripts/docker-entrypoint.sh`
    + `scripts/wait-for-deps.sh` clean (no agent-local scripts dir)
  - Docs: `services/xstockstrat-agent/CLAUDE.md:43,49` ("fifty-two"), db_* rows `:93-101`
- **`xstockstrat-ui`** (Next.js) — count mirror only: `src/lib/copilot.ts:21` (`COPILOT_MCP_TOOL_COUNT = 52`),
  consumed by `src/components/copilot/CopilotRail.tsx:10,203`. No other `db_*`/postgres refs (grep-clean).

## Patterns to REUSE

- **Tool-count verification** → reuse the existing **full name-set equality** assert
  `tests/test_tools_endpoint.py:22-77` (`names == {...}`, db names `:66-74`). It is a descriptor/name-set
  guard, not a substring assert — deleting the nine names auto-drops the asserted count to 43. This is
  exactly the robust guard the ledger (fails.md:308) recommends; do not add a new count check.
- **Removal-verification style** → gate on **symbols/tools that cease to exist** (name absent from the
  `tools/list` name-set; module/functions deleted), NOT substring-absence greps for "postgres" — the
  word legitimately survives in the removal record, `operator-db-access.md`, and history (ledger fails.md:139).
- **Out-of-band DB access runbook** → new `docs/runbooks/operator-db-access.md`, macOS/Homebrew-first
  per root CLAUDE.md bash-doc rule (FR-4). No existing runbook covers direct psql; a new file is the home.

## Existing Business Rules (preserve / extend)

Constitution **C-16**. The entire per-service suite `services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature`
(13 scenarios, feature 169) is a **CHANGE** — operator sign-off recorded in context.md (2026-09-26):

- **CHANGE** `@AC-1 @FR-1 @FR-10` "Both processes start and stay alive under supervisord" — dual-process contract removed
- **CHANGE** `@AC-2 @FR-1` "Supervisord restarts a crashed co-process" — co-process removed
- **CHANGE** `@AC-3 @FR-2` "postgres-mcp not reachable outside the container" — co-process removed
- **CHANGE** `@AC-4 @FR-3` "postgres-mcp connects as xstockstrat_agent, DDL rejected" — role/connection removed
- **CHANGE** `@AC-5 @FR-4 @FR-6` "Admin invokes a db_ tool" — inverted (no db_ tools remain)
- **CHANGE** `@AC-6 @FR-5` "Non-admin rejected for any db_ tool" — inverted (tool gone)
- **CHANGE** `@AC-7 @FR-5` "Unauthenticated cannot discover/invoke db_ tools" — inverted (none to hide)
- **CHANGE** `@AC-8 @FR-6` "All postgres-mcp tools re-exposed with db_ prefix" — prefix contract removed
- **CHANGE** `@AC-9 @FR-7` "Six tool-inventory surfaces in sync" — **the tool-count guarantee**; asserts a
  STALE total 42 / `COPILOT_MCP_TOOL_COUNT=42`, but live baseline is 52 → re-derive to 43 across all six surfaces
- **CHANGE** `@AC-10 @FR-8` "postgres-mcp respects the pool budget" — frees the direct slot; drop the root CLAUDE.md budget row
- **CHANGE** `@AC-11 @FR-9` "POSTGRES_MCP_DATABASE_URI injected in all deploy envs" — inverted (must be absent)
- **CHANGE** `@AC-12 @FR-11` "Destructive DML blocked without confirmation" — tool removed
- **CHANGE** `@AC-13 @FR-11` "Destructive DML executes after confirmation" — tool removed

Disposition: the capability is gone, so the 13 scenarios are **removed** (the durable suite is deleted); 214's own
`acceptance.feature` (@AC-1..@AC-7, absence assertions) becomes the promoted replacement at launch. No `platform.feature`
scenario and no `xstockstrat-ui` durable rule is touched (the UI count is covered transitively by @AC-9).

## Dependencies

- Proto/RPC: none.
- Migration: none (the `db-migrate.sh` block is a shell provisioning block, not a numbered migration; F-01 N/A).
- Config keys: none (`POSTGRES_MCP_*` are env vars, not config-service keys — `postgres_mcp_client.py:10`).
- Inter-service edges: none removed (agent→backends unaffected; the co-process was local-only).
- Env vars removed: `POSTGRES_MCP_PORT`, `POSTGRES_MCP_DATABASE_URI`, `POSTGRES_MCP_AGENT_PASSWORD`.
  **Full `POSTGRES_MCP_AGENT_PASSWORD` deploy pipeline** (ledger fails.md:1095 trap — traced):
  - `.github/workflows/deploy.yml`: reusable `secrets:` decl `:14`, `POSTGRES_MCP_AGENT_PASSWORD` input `:67-71`,
    env injection `:96`, **Python substitution step** `:145-147` (replaces `YOUR_DEV/PROD_POSTGRES_MCP_AGENT_PASSWORD`
    placeholders in the app-spec content)
  - `.github/workflows/deploy-dev.yml:60` / `deploy-prod.yml:59`: caller pass-through of `DEV_/PROD_` secret variants
  - `.do/app.yaml:306-315,540-544` + `.do/app.dev.yaml:303-312,542-546`: `POSTGRES_MCP_DATABASE_URI`/`POSTGRES_MCP_PORT`
    env + the `YOUR_*` placeholder in TWO components each (agent + db-migrator job)
  - `docker-compose.yml:100-102,553-554`: agent-block `POSTGRES_MCP_*`
  - GitHub repo secrets `DEV_/PROD_POSTGRES_MCP_AGENT_PASSWORD`: external → operator out-of-band cleanup note (cannot delete via code)

## Risks / Not-found

- **Spec under-enumeration corrected in recon (2 more test files):** `tests/test_supervisord_conf.py:47-69`
  (asserts `[program:postgres-mcp]` section) and `tests/test_dep_smoke.py:18-21`
  (`shutil.which("postgres-mcp")`) also assert postgres-mcp — beyond the four in the spec. Full test surface
  = 6 files: delete `test_db_tools.py` + `test_postgres_mcp_client.py`; edit `test_tools_endpoint.py`,
  `test_deployment_env_vars.py`, `test_supervisord_conf.py`, `test_dep_smoke.py`.
- **Orphaned dependencies (scope decision → resolved in design):** removing `db_execute_sql` orphans
  `_is_destructive` + `sqlglot` (`pyproject.toml:19`); removing `postgres_mcp_client.py` orphans
  **`httpx2`** (`pyproject.toml:17`, used only by `postgres_mcp_client.py:18,44` + its test — `tools.py`
  uses `httpx` at a different line, which STAYS). Clean removal drops **all three** (`postgres-mcp`,
  `sqlglot`, `httpx2`); requires `uv lock` regen + `uv lock --check` (root CLAUDE.md gate). [Added round 1 adversary — httpx2 missed by initial discovery.]
- **`test_dep_smoke.py` has THREE postgres-era assertions**, not one: `test_sqlglot_importable:10-11`
  and `test_httpx2_importable:14-15` must be **deleted** (they fail at collection once the deps leave —
  cannot be inverted), `test_postgres_mcp_binary_on_path:18-21` deleted/inverted; `test_supervisor_importable:6-7`
  STAYS. [Added round 1 adversary.]
- **Two update axes, kept separate (C-10):** tool-count (`@AC-4`/`@AC-9`: copilot.ts, tools.py docstring,
  agent CLAUDE.md rows+count, mcp-tools.md, test_tools_endpoint name-set) vs connection-budget
  (`@AC-3`/`@AC-10`: root CLAUDE.md pool row + direct total, test_deployment_env_vars.py). Verify **all**
  "fifty-two" occurrences in agent CLAUDE.md (prose carries it more than the `:43,:49` sites cited above).
- **Negative confirmations (deploy trace complete, fails.md:1095):** `scripts/do-inject-prod-secrets.py`,
  `.github/workflows/prod-up.yml`, `docs/setup/digitalocean.md`, `docs/*/infra-cost-reduction.md` carry
  **no** postgres-mcp reference (verified round 1). Incidental cleanup: `.do/app.yaml`'s
  `YOUR_PROD_POSTGRES_MCP_AGENT_PASSWORD` placeholder was never wired into `do-inject-prod-secrets.py`
  (a latent feature-169 gap) — 214's removal cleans it up.
- **`xstockstrat_agent` role provisioning** `scripts/db-migrate.sh:169-204` (CREATE ROLE `:186`, grants `:191-199`,
  `POSTGRES_MCP_AGENT_PASSWORD` gate `:178`): dead block — the role was never created (password never set → `[skip]`
  path). Delete the provisioning shell block; no live-DB `DROP ROLE` needed (feature 208 demoted for this reason).
- **`docs/runbooks/mcp-tools.md`**: "fifty-two tools" `:3,10,45` + nine db_* reference sections `:1572-1638` → update.
- **Test count coupling:** `test_deployment_env_vars.py:63` pins direct-backend-total `9` + `:54` `xstockstrat_agent`
  in root CLAUDE.md — both invert; re-derive the budget total when dropping the row.
- Not found: no direct DB pool/connection in agent `app/` (only the co-process used the role); no duplicate/orphaned
  tools module or second registration path (fails.md:446 cleared).

## Recommended Scope

Advisory step boundaries for `/sdd-spec` (not binding):
1. **Agent code:** delete the nine `db_*` tools + `_is_destructive`/constants + `postgres_mcp_client` import in
   `tools.py`; delete `postgres_mcp_client.py`; fix docstring count → 43.
2. **Agent deps:** drop `postgres-mcp` + `sqlglot` from `pyproject.toml`; `uv lock`; `uv lock --check`.
3. **Agent container:** delete `[program:postgres-mcp]` from `supervisord.conf`.
4. **Agent tests (paired, red-before-green):** delete 2 whole-file tests; edit the 4 asserting-presence tests
   (name-set, deployment-env, supervisord-conf, dep-smoke) to assert absence.
5. **C-16 suite:** delete `acceptance/agent-postgres-mcp.feature` (13 CHANGE scenarios); 214's `acceptance.feature`
   is the promoted replacement.
6. **Count mirrors (C-10):** `copilot.ts` 52→43, agent `CLAUDE.md` (count + rows), `docs/runbooks/mcp-tools.md`.
7. **Deploy wiring:** strip `POSTGRES_MCP_*` from `docker-compose.yml`, both `.do/app*.yaml` (both components),
   and the three `deploy*.yml` (secrets decl + input + injection + substitution + placeholder templates).
8. **DB tooling:** delete the dead `xstockstrat_agent` provisioning block in `db-migrate.sh`; drop the root
   CLAUDE.md pool-budget row + re-derive the direct total.
9. **Runbook (FR-4):** add `docs/runbooks/operator-db-access.md` (macOS/Homebrew-first).
