# Implementation Spec: remove-agent-postgres-mcp

**Status**: `complete`
**Created**: 2026-09-28
**Feature**: `docs/roadmap/features/214-remove-agent-postgres-mcp/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/remove-agent-postgres-mcp`

---

## Execution Summary

This is a **complete subtractive removal** of the agent's DB-over-MCP surface, executed **sequential
mode / one integration PR** per `design.md` (the change is one cohesive removal with tightly coupled
cross-file invariants — count mirrors + deploy pipeline — not independently shippable slices). No new
capability and **no replacement SQL-over-MCP surface**; the named **C-14 consumer surface** (the nine
`db_*` Agent MCP tools) is deliberately eliminated, and the legitimate operator need is re-homed to an
out-of-band runbook (Step 12, FR-4) — a decision, not a deferral, so no follow-up feature is named.

Ordering is **consumer-first** (remove the tool surface first, Step 1) then dependencies → container →
deploy wiring → DB tooling → count mirrors → C-16 promotion → runbook. Deploy removal uses the
**caller-first** ordering the adversary validated (the reusable-workflow input is `required: false`
and callers pass by name, so removing `deploy-dev.yml`/`deploy-prod.yml` pass-throughs before the
`deploy.yml` input decl leaves no broken intermediate).

**Removal TDD (P-06)**: for each removal, RED = the existing presence-assert failing after the
production/config edit; GREEN = deleting/inverting it to assert absence. Per `recon.md` + ledger
`fails.md:139` (feature 079), verification gates on **symbols/names ceasing to exist** (name-set
equality, deleted module, failed import) — **never** substring `! grep postgres`, because "postgres"
legitimately survives in the removal record, the new runbook, and git history.

### Scenario Coverage (C-15)

| `@AC` | Covered by step(s) |
|---|---|
| AC-1 (no `db_` tool advertised; count 43) | Step 2 (name-set test), Step 11 (promoted `@feature-214` scenario) |
| AC-2 (no co-process / wiring / SSE path) | Step 4 (dep-smoke), Step 6 (supervisord conf), Step 11 |
| AC-3 (no direct DB conn; budget row + total; dead `db-migrate.sh` block) | Step 8 (budget/`db-migrate.sh` edit), Step 9 (budget asserts) |
| AC-4 (all inventory surfaces agree on 43) | Step 2 (executable name-set guard), Step 9 (budget), Step 10 (prose mirrors) |
| AC-5 (out-of-band runbook; no SQL-MCP anywhere) | Step 12 (runbook), Step 2 (absence guard) |
| AC-6 (prompt-injected agent has no SQL path) | Step 2 (no tool) + Step 6 (no co-process) + Step 7 (no credential in env) + Step 11 (promoted `@AC-6`) |
| AC-7 (169 suite deleted; 214 guarantees promoted) | Step 11 |

### Consumer-surface coverage (C-14)

Named surface = **Agent** `db_*` MCP tools. Landed (as removal) by **Step 1** (tool defs deleted) and
proven by **Step 2** (name-set no longer advertises them). **UI** is touched only as the
`COPILOT_MCP_TOOL_COUNT` count mirror (Step 10) — no user-visible UI change, as the product spec states.

---

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (agent tool removal) — RED: the name-set equality in
  `test_tools_endpoint.py` still lists the nine `db_` names and fails once Step 1 stops registering
  them; GREEN after Step 2 drops those names.
- Step 4 [test] covers Step 3 [service] (dep removal) — RED: `test_dep_smoke.py::test_sqlglot_importable`
  / `test_httpx2_importable` / `test_postgres_mcp_binary_on_path` fail at collection/run once the deps
  leave; GREEN after Step 4 deletes them.
- Step 6 [test] covers Step 5 [service] (supervisord) — RED: `test_supervisord_conf.py`'s four
  `postgres-mcp` asserts fail once the block is gone; GREEN after Step 6 inverts to assert its absence.
- Step 9 [test] covers Step 7 [service] (deploy wiring) **and** Step 8 [service] (budget) — RED: the
  six `POSTGRES_MCP_*` presence asserts + `test_claude_md_has_agent_role_in_budget` +
  `test_claude_md_direct_total_is_nine` fail once Steps 7/8 land; GREEN after Step 9 drops/inverts them.
  Natural numeric order (Steps 7, 8 [service] → Step 9 [test]) matches the dependency — no out-of-order execution required.
- Step 3 (deps) must follow Step 1 (`sqlglot`/`httpx2` are only orphaned once `_is_destructive` and
  `postgres_mcp_client.py` are gone).
- Step 11 (C-16 delete-and-promote) SHOULD run after Steps 1/5/7 so the promoted `@feature-214`
  absence guarantees describe the landed state.
- **Re-derive at execute-time (design.md Open Risks):** confirm the pre-removal tool count is still
  **52** on `main-dev` (→ 43) and the direct-backend total is still **9** (→ 8) before writing the new
  numbers — a sibling feature merging first can shift either baseline.

---

### Step 1 — service: Remove the nine `db_*` tools and their orphans from `app/tools.py`; delete `postgres_mcp_client.py`

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/postgres_mcp_client.py` — delete

**Reviewers**: xstockstrat-agent — MCP tool contract + six-surface tool-count parity, no DB/secret path in tool output; Security — H-5/DT-2 closure (no `db_` tool, no SSE client left in agent code)

**Codebase Evidence**:
- The nine `db_*` tool defs, each under `@server.tool()`, live in one block: section comment
  `services/xstockstrat-agent/app/tools.py:2226` (`# db_* tools — postgres-mcp co-process, admin-scoped, feature 169`),
  defs `db_list_schemas:2230`, `db_list_objects:2241`, `db_get_object_details:2252`, `db_execute_sql:2267`,
  `db_explain_query:2297`, `db_get_top_queries:2308`, `db_analyze_workload_indexes:2319`,
  `db_analyze_query_indexes:2329`, `db_analyze_db_health:2340`; the block ends immediately before
  `def register_prompts(server: MCPServer)` (~:2354). Confirmed via `grep -n "async def db_" tools.py`
  and `sed -n '2224,2230p;2350,2360p'`.
- Sole-use orphans: `_is_destructive` def `:265` with constants `_DESTRUCTIVE_KEYS:259`, `_COMMENT_RE:261`,
  `_DESTRUCTIVE_RE:262` (+ the `# _DESTRUCTIVE_KEYS values verified...` comment `:256`) — used **only** by
  `db_execute_sql` (`if _is_destructive(sql) and not confirm:` `:2282`). `sqlglot` imports `:76-77`
  (`import sqlglot` / `import sqlglot.errors`) — used only inside `_is_destructive`.
- Import to trim: `from app import backtest_view, client, postgres_mcp_client` `:81` → drop
  `postgres_mcp_client` (leave `backtest_view`, `client` — both still used).
- Docstring count: `Fifty-two tools:` `:4`; the nine `db_*` rows `:45-53`; reaffirmation
  `the tool count stays fifty-two.` `:61`.
- **RETAIN** `_caller_access_scope` `:141` — shared by many non-db tools (recon Codebase Map).
- Whole-file delete target: `postgres_mcp_client.py` — `call_tool:30`, `_postgres_mcp_url:25`, sole env
  read `os.environ["POSTGRES_MCP_PORT"]:26`, `import httpx2:18`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `app/tools.py`, delete the entire `db_*` tool block: the section comment at `:2226` through the
   end of `db_analyze_db_health` (~:2351), i.e. up to (not including) `def register_prompts`. Re-confirm
   the exact end line at execute-time (`grep -n "async def db_\|def register_prompts" app/tools.py`).
2. Delete the sole-use helper `_is_destructive` (`:265`) and its constants `_DESTRUCTIVE_KEYS`,
   `_COMMENT_RE`, `_DESTRUCTIVE_RE` (`:259-262`) plus the `:256` explanatory comment.
3. Delete the `sqlglot` imports (`:76-77`).
4. Change the import at `:81` to `from app import backtest_view, client` (drop `postgres_mcp_client`).
5. Fix the module docstring: `Fifty-two tools:` → `Forty-three tools:` (`:4`) after re-deriving the
   baseline; delete the nine `db_*` docstring rows (`:45-53`); update the reaffirmation `:61` to the
   new count.
6. Do **not** touch `_caller_access_scope` (`:141`).
7. Delete `app/postgres_mcp_client.py` entirely (`git rm`).

**Verification**:
- `grep -n "db_list_schemas\|db_list_objects\|db_get_object_details\|db_execute_sql\|db_explain_query\|db_get_top_queries\|db_analyze_workload_indexes\|db_analyze_query_indexes\|db_analyze_db_health\|_is_destructive\|postgres_mcp_client\|import sqlglot" services/xstockstrat-agent/app/tools.py` → **no output** (all nine tools, the helper, the client import, and the sqlglot import gone from tools.py).
- `test ! -e services/xstockstrat-agent/app/postgres_mcp_client.py` → exits 0.
- `grep -n "_caller_access_scope" services/xstockstrat-agent/app/tools.py` → still present (regression guard).
- Lint: `cd services/xstockstrat-agent && ruff check . && ruff format --check .`

---

### Step 2 — test: Drop the nine `db_` names from the tool name-set; delete the two db-only test files

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify
- `services/xstockstrat-agent/tests/test_db_tools.py` — delete
- `services/xstockstrat-agent/tests/test_postgres_mcp_client.py` — delete

**Reviewers**: xstockstrat-agent — six-surface tool-count parity (name-set is the executable guard); Security — H-5 (no `db_` tool discoverable via `tools/list`)

**Codebase Evidence**:
- `test_tools_endpoint.py` asserts a full **name-set equality** `assert names == { ... }` at `:23`
  (`test_list_tools_returns_all_registered_tools`), with the nine db names at `:66-74`. This is the
  robust descriptor/name-set guard the ledger recommends (`fails.md:308`, `:139`); removing the nine
  names auto-drops the asserted count 52→43 — **do not add a separate count check** (recon Patterns to REUSE).
- `test_db_tools.py` header: "Unit tests for db_* handlers and the _is_destructive FR-11 gate" (AC-5/6/7/12/13
  of feature 169) — whole-file dead once the tools/helper leave.
- `test_postgres_mcp_client.py`: `import httpx2` + `from app.postgres_mcp_client import _postgres_mcp_url, call_tool`
  — fails at import once Step 1 deletes the module; whole-file delete.
- `copilot.ts` lineage comment names this test as the authoritative source of truth
  (`services/xstockstrat-ui/src/lib/copilot.ts:16-18`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-4, AC-6`

**Instructions**:
1. In `test_tools_endpoint.py`, delete the nine `db_` entries (`:66-74`) from the `names == { ... }` set
   at `:23`. Leave the rest of the set intact. Re-derive that the resulting set has 43 members against
   `main-dev` at execute-time.
2. `git rm services/xstockstrat-agent/tests/test_db_tools.py`.
3. `git rm services/xstockstrat-agent/tests/test_postgres_mcp_client.py`.

**Verification**:
- `cd services/xstockstrat-agent && pytest tests/test_tools_endpoint.py -q` → passes; the name-set has
  no `db_` member (`grep -c "db_" tests/test_tools_endpoint.py` → 0).
- `test ! -e services/xstockstrat-agent/tests/test_db_tools.py && test ! -e services/xstockstrat-agent/tests/test_postgres_mcp_client.py` → exits 0.
- Full suite + coverage + lint: `cd services/xstockstrat-agent && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40` → passes (agent CI threshold 40%).

---

### Step 3 — service: Drop `postgres-mcp`, `sqlglot`, `httpx2` from `pyproject.toml` and relock

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/pyproject.toml` — modify
- `services/xstockstrat-agent/uv.lock` — modify (regenerated)

**Reviewers**: xstockstrat-agent — dependency hygiene; Security — no arbitrary-SQL dependency remains

**Codebase Evidence**:
- `pyproject.toml`: `"httpx2",` `:17`, `"postgres-mcp",` `:18`, `"sqlglot>=25.0.0,<26",` `:19`.
- **Keep** `"httpx>=0.27.0",` `:7` — a distinct package still used by `tools.py` (recon: `httpx` ≠ `httpx2`).
- `uv.lock` carries `postgres-mcp 0.3.0` (`:1398,1410-1412`) + editable-pkg deps (`:2501,2528`) — regenerated by `uv lock`, not hand-edited.
- Root `CLAUDE.md` uv rule: after any `pyproject.toml` dep change, run `uv lock` and commit `uv.lock`; the `python-lint` job runs `uv lock --check`.

**TDD**: `N/A (dependency manifest — proven by Step 4's dep-smoke test and uv lock --check)`

**Covers**: —

**Instructions**:
1. Delete lines `:17` (`"httpx2",`), `:18` (`"postgres-mcp",`), `:19` (`"sqlglot>=25.0.0,<26",`) from
   `pyproject.toml`. Leave `"httpx>=0.27.0",` (`:7`) untouched.
2. From `services/xstockstrat-agent`, run `uv lock` to regenerate `uv.lock`. Commit the updated lock.

**Verification**:
- `cd services/xstockstrat-agent && uv lock --check` → passes (lock in sync with manifest).
- `grep -n "postgres-mcp\|sqlglot\|httpx2" services/xstockstrat-agent/pyproject.toml` → no output.
- `grep -n "\"httpx>=0.27.0\"" services/xstockstrat-agent/pyproject.toml` → still present.

---

### Step 4 — test: Delete the `sqlglot` / `httpx2` / `postgres-mcp` binary smoke assertions

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_dep_smoke.py` — modify

**Reviewers**: xstockstrat-agent — dependency smoke suite integrity

**Codebase Evidence**:
- `test_dep_smoke.py` (whole file, 21 lines) has four tests: `test_supervisor_importable` (`:6-7`,
  **KEEP**), `test_sqlglot_importable` (`:10-11`), `test_httpx2_importable` (`:14-15`), and
  `test_postgres_mcp_binary_on_path` (`:18-21`, `shutil.which("postgres-mcp")`).
- The three postgres-era tests **cannot be inverted** — `test_sqlglot_importable`/`test_httpx2_importable`
  fail at collection (bare `import`) once the deps leave; they must be **deleted** (recon Risks; design).

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. Delete `test_sqlglot_importable` (`:10-11`), `test_httpx2_importable` (`:14-15`), and
   `test_postgres_mcp_binary_on_path` (`:18-21`) from `test_dep_smoke.py`.
2. Keep `test_supervisor_importable` (`:6-7`) and the `import shutil` line only if still referenced
   — after deleting `test_postgres_mcp_binary_on_path`, `shutil` is unused, so remove `import shutil`
   too (ruff will flag F401). Update the module docstring "all four new runtime dependencies" to match.

**Verification**:
- `cd services/xstockstrat-agent && pytest tests/test_dep_smoke.py -q` → passes; only
  `test_supervisor_importable` runs (`grep -c "def test_" tests/test_dep_smoke.py` → 1).
- `grep -n "sqlglot\|httpx2\|postgres-mcp" services/xstockstrat-agent/tests/test_dep_smoke.py` → no output.
- Lint: `cd services/xstockstrat-agent && ruff check tests/test_dep_smoke.py`
- Service-wide coverage gate holds after the removal: `cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40` → passes (agent CI threshold 40%).

---

### Step 5 — service: Delete the `[program:postgres-mcp]` co-process block from `supervisord.conf`

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/supervisord.conf` — modify

**Reviewers**: Platform Lead — container process topology; Security — no co-process reachable in the agent container

**Codebase Evidence**:
- `supervisord.conf`: `[program:postgres-mcp]` `:14`, command
  `postgres-mcp --unrestricted --transport sse --port %(ENV_POSTGRES_MCP_PORT)s` `:15` — block spans `:14-21`.
- `[program:app-main]` (`:5-12`, `command=python -m app.main`) **STAYS**.
- Container entry (recon / product-spec Open Q1): `Dockerfile` → `scripts/docker-entrypoint.sh` →
  `supervisord -c /app/supervisord.conf`; `Dockerfile`/entrypoint carry **no** postgres-mcp ref (no edit needed there).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Delete the `[program:postgres-mcp]` section (`:14-21`) from `supervisord.conf`, including its
   `command`, `autorestart`, and any bind/env directives. Leave `[program:app-main]` and the
   `[supervisord]` header intact.

**Verification**:
- `grep -n "program:postgres-mcp\|postgres-mcp" services/xstockstrat-agent/supervisord.conf` → no output.
- `grep -n "program:app-main" services/xstockstrat-agent/supervisord.conf` → still present.
- Proven by Step 6 (`test_supervisord_conf.py`).

---

### Step 6 — test: Invert `test_supervisord_conf.py` to assert the co-process block is absent

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_supervisord_conf.py` — modify

**Reviewers**: xstockstrat-agent — container-config regression guard; Security — no postgres-mcp process declared

**Codebase Evidence**:
- Tests to KEEP: `test_conf_file_exists` (`:27`), `test_supervisord_nodaemon` (`:31`),
  `test_app_main_declared` (`:38`), `test_app_main_autorestart` (`:43`).
- Tests to remove/invert (all assert postgres-mcp presence): `test_postgres_mcp_declared` (`:47-52`,
  `assert _load().has_section("program:postgres-mcp")`), `test_postgres_mcp_autorestart` (`:54-55`),
  `test_postgres_mcp_no_external_bind` (`:58-62`), `test_postgres_mcp_unrestricted` (`:66-69`).

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. Delete `test_postgres_mcp_autorestart`, `test_postgres_mcp_no_external_bind`, and
   `test_postgres_mcp_unrestricted` (they assert attributes of a now-nonexistent section).
2. Replace `test_postgres_mcp_declared` with an **inverted** assertion, e.g.
   `def test_no_postgres_mcp_section(): assert not _load().has_section("program:postgres-mcp")`
   with a docstring citing `@AC-2 @feature-214`.
3. Keep the four `app-main` / file-exists / nodaemon tests. Update the module docstring (currently
   references AC-1/AC-3 postgres-mcp) to reflect the removal.

**TDD note**: the inverted assertion is RED against the pre-Step-5 tree (the section still exists) and
GREEN after Step 5 — sequence Step 5 before Step 6.

**Verification**:
- `cd services/xstockstrat-agent && pytest tests/test_supervisord_conf.py -q` → passes.
- `grep -n "has_section(\"program:postgres-mcp\")" services/xstockstrat-agent/tests/test_supervisord_conf.py`
  → only the inverted `not ...` assertion.
- Lint: `cd services/xstockstrat-agent && ruff check tests/test_supervisord_conf.py`
- Service-wide coverage gate holds: `cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40` → passes (agent CI threshold 40%).

---

### Step 7 — service: Strip all `POSTGRES_MCP_*` deploy wiring (compose, app specs, workflows)

**Status**: `done`
**Service**: `xstockstrat-agent` (deployment config)
**Files**:
- `docker-compose.yml` — modify
- `.do/app.yaml` — modify
- `.do/app.dev.yaml` — modify
- `.github/workflows/deploy-dev.yml` — modify
- `.github/workflows/deploy-prod.yml` — modify
- `.github/workflows/deploy.yml` — modify

**Reviewers**: Platform Lead — deployment config + service-registry consistency; Security — no DB credential injected into the agent env; xstockstrat-agent — agent-component env

**Codebase Evidence** (all confirmed via `grep -n "POSTGRES_MCP" <file>`):
- `docker-compose.yml`: agent block `POSTGRES_MCP_AGENT_PASSWORD: "${POSTGRES_MCP_AGENT_PASSWORD:-}"` `:102`
  (+ feature-169 explanatory comment `:100-101`); db-migrator block `POSTGRES_MCP_DATABASE_URI` `:553`,
  `POSTGRES_MCP_PORT: "9001"` `:554`.
- `.do/app.yaml`: agent component comment `:306-307`, `POSTGRES_MCP_AGENT_PASSWORD` `:308-311`,
  `POSTGRES_MCP_DATABASE_URI` `:312-314`, `POSTGRES_MCP_PORT` `:315-316`; db-migrator job comment `:540`,
  `POSTGRES_MCP_AGENT_PASSWORD` (`YOUR_PROD_...` placeholder) `:541-544`.
- `.do/app.dev.yaml`: agent comment `:303-304`, `POSTGRES_MCP_AGENT_PASSWORD` `:305-308`,
  `POSTGRES_MCP_DATABASE_URI` `:309-311`, `POSTGRES_MCP_PORT` `:312`; db-migrator job `:542-546`
  (`YOUR_DEV_...` placeholder).
- `deploy-dev.yml:60`: `POSTGRES_MCP_AGENT_PASSWORD: ${{ secrets.DEV_POSTGRES_MCP_AGENT_PASSWORD }}` (caller pass-through).
- `deploy-prod.yml:59`: `POSTGRES_MCP_AGENT_PASSWORD: ${{ secrets.PROD_POSTGRES_MCP_AGENT_PASSWORD }}` (caller pass-through).
- `deploy.yml`: reusable-workflow `secrets:` input decl `POSTGRES_MCP_AGENT_PASSWORD:` (`required: false`)
  `:67-72`; env injection into the substitute step `:96`; Python `.replace()` substitution `:145-147`
  (`YOUR_DEV_/YOUR_PROD_POSTGRES_MCP_AGENT_PASSWORD`). The input is `required: false` and callers pass by
  name, so caller-first removal has no broken intermediate (design.md, adversary round 1).

**TDD**: `red-green required` (verified by Step 9's static-file assertions + grep)

**Covers**: —

**Instructions** (caller-first ordering):
1. `deploy-dev.yml`: delete `:60`. `deploy-prod.yml`: delete `:59`.
2. `deploy.yml`: delete the `POSTGRES_MCP_AGENT_PASSWORD:` secrets input decl block (`:67-72`), the env
   injection line (`:96`), and the two `content.replace('YOUR_*_POSTGRES_MCP_AGENT_PASSWORD', ...)`
   substitution lines + the `pg_mcp_password = ...` line (`:145-147`).
3. `.do/app.yaml` + `.do/app.dev.yaml`: delete the `POSTGRES_MCP_DATABASE_URI`, `POSTGRES_MCP_PORT`, and
   `POSTGRES_MCP_AGENT_PASSWORD` env entries (with their comments and `YOUR_*` placeholders) from **both**
   components each — the agent component **and** the db-migrator job.
4. `docker-compose.yml`: delete the agent-block `POSTGRES_MCP_AGENT_PASSWORD` line + its feature-169
   comment (`:100-102`) and the db-migrator-block `POSTGRES_MCP_DATABASE_URI`/`POSTGRES_MCP_PORT`
   (`:553-554`).
5. Add a one-line note to the PR body (and cross-ref the Step 12 runbook): the external GitHub repo
   secrets `DEV_/PROD_POSTGRES_MCP_AGENT_PASSWORD` remain until an operator deletes them out-of-band
   (harmless; cannot be removed via code — design.md Open Risks).

**Verification**:
- `grep -rn "POSTGRES_MCP" docker-compose.yml .do/app.yaml .do/app.dev.yaml .github/workflows/deploy.yml .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml` → **no output**.
- `python3 -c "import yaml; yaml.safe_load(open('.do/app.yaml')); yaml.safe_load(open('.do/app.dev.yaml'))"` → parses cleanly (no dangling keys).
- Proven by Step 9 (`test_deployment_env_vars.py`).

---

### Step 8 — service: Delete the dead `xstockstrat_agent` role-provisioning block and the pool-budget row

**Status**: `done`
**Service**: `xstockstrat-agent` (DB tooling + root governance)
**Files**:
- `scripts/db-migrate.sh` — modify
- `CLAUDE.md` (root) — modify

**Reviewers**: Platform Lead — connection-budget + service-registry consistency (shell-block deletion reviewed under the platform-lead deployment gate, per product spec); Security — dead DB-role provisioning removed

**Codebase Evidence**:
- `scripts/db-migrate.sh` — the `xstockstrat_agent role provisioning (feature 169)` block spans the
  comment header `:169` through the closing `fi` + trailing `echo ""` (~:169-205): gate
  `if [ "${COMMAND}" = "up" ] && [ -n "${POSTGRES_MCP_AGENT_PASSWORD:-}" ]; then` `:178`,
  `CREATE ROLE xstockstrat_agent` `:186`, grants `:191-199`, `[skip]` else-branch `:203`. Dead:
  the password env was never set in live envs, so the `[skip]` path always ran → **no live-DB role exists to drop** (F-01 N/A — shell block, not an applied `.up.sql`).
- Root `CLAUDE.md`: budget row `| xstockstrat-agent (postgres-mcp) | Python | direct \`:25060\` | 1 | ...(feature 169) |` `:238`;
  `| **Direct backend total** | | | **9** | ... |` `:239`.
- `test_deployment_env_vars.py:59-64` pins the direct total (`9` → `8`) and `:51-56` the agent role row.

**TDD**: `N/A (infra script + governance doc — budget change covered by the paired test Step 9; the db-migrate.sh block deletion is a shell edit verified by grep)`

**Covers**: —

**Instructions**:
1. In `scripts/db-migrate.sh`, delete the whole `xstockstrat_agent` provisioning block: the
   `# ── xstockstrat_agent role provisioning (feature 169) ──` comment header (`:169`) and its preceding
   blank-line/`echo ""` separator down through the closing `fi` and its trailing `echo ""` (~:205).
   Re-confirm exact boundaries at execute-time (`grep -n "xstockstrat_agent role provisioning\|\[skip\] xstockstrat_agent" scripts/db-migrate.sh`).
2. In root `CLAUDE.md`, delete the `xstockstrat-agent (postgres-mcp)` budget row (`:238`) and change the
   **Direct backend total** from `9` to `8` (`:239`), after re-deriving the total against `main-dev`.
   Also scan the surrounding pool-budget prose for any "9 direct" / "~14" effective-usage figure that
   references the removed slot and re-derive it consistently (the "~9 direct + ≤5 pool = ~14" line
   becomes "~8 direct + ≤5 pool = ~13").

**Verification**:
- `grep -n "xstockstrat_agent\|POSTGRES_MCP_AGENT_PASSWORD" scripts/db-migrate.sh` → no output.
- `bash -n scripts/db-migrate.sh` → parses (no syntax error from an unbalanced `if/fi`).
- `grep -n "xstockstrat-agent (postgres-mcp)" CLAUDE.md` → no output; the `Direct backend total` row shows `8`.
- Proven by Step 9 budget asserts.

---

### Step 9 — test: Drop the `POSTGRES_MCP_*` presence asserts and invert the budget asserts

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_deployment_env_vars.py` — modify

**Reviewers**: Platform Lead — connection-budget correctness; xstockstrat-agent — deploy-env regression guard; Security — no DB credential in deploy env

**Codebase Evidence**:
- Six `POSTGRES_MCP_*` presence asserts (`assert "POSTGRES_MCP_DATABASE_URI"/"POSTGRES_MCP_PORT" in _read(...)`)
  across `docker-compose.yml`/`.do/app.dev.yaml`/`.do/app.yaml` at `:22-48`.
- `test_claude_md_has_agent_role_in_budget` (`:51-56`): `assert "xstockstrat_agent" in content` (root CLAUDE.md budget) — must invert.
- `test_claude_md_direct_total_is_nine` (`:59-64`): asserts the direct-backend total is `9` — must become `8`.

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4`

**Instructions**:
1. Delete the six `POSTGRES_MCP_*` presence tests (`:22-48`).
2. Invert `test_claude_md_has_agent_role_in_budget` → assert the `xstockstrat-agent (postgres-mcp)`
   budget **row** is absent (assert the `xstockstrat-agent (postgres-mcp)` row string is **not** in the
   budget table; note the plain service name `xstockstrat-agent` still appears elsewhere in CLAUDE.md,
   so match the row/`postgres-mcp` phrasing, not bare `xstockstrat_agent`). Tag `@AC-3 @feature-214`.
3. Rename/retarget `test_claude_md_direct_total_is_nine` → assert the direct-backend total is **8**
   (re-derive against `main-dev` at execute-time). Update the docstrings (AC-4/AC-10/AC-11 → AC-3/AC-4).

**TDD note**: this test covers **both** Step 7 (deploy wiring) and Step 8 (budget). Both inverted
asserts are RED against the pre-Steps-7/8 tree and GREEN after — the natural numeric order (Steps 7
and 8 [service] before Step 9 [test]) now matches the dependency, so no out-of-order execution is
required.

**Verification**:
- `cd services/xstockstrat-agent && pytest tests/test_deployment_env_vars.py -q` → passes.
- `grep -n "POSTGRES_MCP" services/xstockstrat-agent/tests/test_deployment_env_vars.py` → no output.
- Lint: `cd services/xstockstrat-agent && ruff check tests/test_deployment_env_vars.py`
- Service-wide coverage gate holds: `cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40` → passes (agent CI threshold 40%).

---

### Step 10 — docs: Reconcile the tool-count mirrors (copilot.ts, agent CLAUDE.md, mcp-tools.md)

**Status**: `done`
**Service**: `docs` / `xstockstrat-ui` count mirror
**Files**:
- `services/xstockstrat-ui/src/lib/copilot.ts` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none (per step-category matrix: `docs`). Advisory owners for the parity concern:
xstockstrat-ui (COPILOT count mirror) and xstockstrat-agent (docstring/runbook parity).

**Codebase Evidence**:
- `copilot.ts`: `export const COPILOT_MCP_TOOL_COUNT = 52;` `:21`, with a lineage comment `:18-19`
  (`24 → 32 → 35 → 40 → 49, feature 169; → 51 feature 204; → 52 feature 205`) naming
  `test_tools_endpoint.py::test_list_tools_returns_all_registered_tools` as the source of truth.
- `services/xstockstrat-agent/CLAUDE.md`: `fifty-two tools` `:43`, `the tool count stays fifty-two` `:49`;
  the nine `db_*` catalog rows `:93-101` (incl. `db_get_top_queries` at `:98`).
- `docs/runbooks/mcp-tools.md`: `fifty-two tools` `:3`, `:10`, `:45`; the `## Database Tools (Admin-only)`
  section `:1570` running through `### db_analyze_db_health` `:1698` to EOF (`:1708`) — no `## ` section
  follows, so the whole block is removed.
- Ledger `fails.md:308` (mcp-tools-alignment): a same-PR tool change must update **every** surface that
  describes it in that PR — this step is that reconciliation.

**TDD**: `N/A (docs / prose count mirrors — the executable guard is the Step 2 name-set test)`

**Covers**: `AC-4`

**Instructions**:
1. `copilot.ts:21`: `52` → `43` (re-derived). Append `→ 43 feature 214 (db_* removed)` to the lineage comment (`:18-19`).
2. `services/xstockstrat-agent/CLAUDE.md`: change every `fifty-two` occurrence to the new count word
   (`:43`, `:49`) — grep the whole file for `fifty-two`/`52` to catch prose beyond those two lines
   (recon Risks) — and delete the nine `db_*` catalog rows (`:93-101`), including any "Database
   Tools"/postgres-mcp subheading introducing them.
3. `docs/runbooks/mcp-tools.md`: change `fifty-two` at `:3`, `:10`, `:45` to the new count; delete the
   entire `## Database Tools (Admin-only)` section (`:1570`-EOF). Verify no other db_ reference survives
   in the tool tables.

**Verification**:
- `grep -rn "COPILOT_MCP_TOOL_COUNT = 52\|COPILOT_MCP_TOOL_COUNT = 5[0-9]" services/xstockstrat-ui/src/lib/copilot.ts` → shows `43`.
- `grep -in "fifty-two\|db_list_schemas\|db_execute_sql\|db_analyze_db_health\|Database Tools" services/xstockstrat-agent/CLAUDE.md docs/runbooks/mcp-tools.md` → no output.
- `cd services/xstockstrat-ui && pnpm run lint` → passes (copilot.ts edit).

---

### Step 11 — test: C-16 delete-and-promote — remove feature 169's suite, promote the `@feature-214` absence guarantees

**Status**: `done`
**Service**: `xstockstrat-agent` (durable business-rule suite)
**Files**:
- `services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature` — delete
- `services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature` — create

**Reviewers**: xstockstrat-agent — durable business-rule suite; Security — H-5 closure guarantees promoted, not left asserting a deleted surface

**Codebase Evidence**:
- `services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature` exists (feature 169, 13 scenarios
  `@AC-1..@AC-13`) — recon **Existing Business Rules** lists all 13 as **CHANGE**; operator sign-off
  recorded in `context.md` (2026-09-26). Every scenario asserts the now-removed db_* tools / co-process
  / deploy env / pool slot.
- This feature's own `acceptance.feature` carries the replacement absence guarantees: `@AC-1` (no db_
  tool advertised), `@AC-2` (no co-process/wiring), `@AC-6` (no prompt-injected SQL path), plus `@AC-7`
  (this promotion step).
- C-16: "`/sdd-archiver` never deletes" is scoped to the archiver, not a deliberate capability removal
  with recorded operator sign-off (design.md).

**TDD**: `red-green required` (the promoted suite is the durable guarantee; it must parse and assert absence)

**Covers**: `AC-7, AC-1, AC-2, AC-6`

**Instructions**:
1. `git rm services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature` (the capability is gone;
   sign-off in `context.md` 2026-09-26).
2. Create `services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature` containing this
   feature's absence guarantees, each tagged `@feature-214` plus its `@AC-*`: the `@AC-1` "advertises no
   db_ tool" (count 43), `@AC-2` "no co-process / no POSTGRES_MCP_* wiring / no SSE path", and `@AC-6`
   "prompt-injected session has no db_ tool, no co-process, no DB credential, no reachable SQL endpoint"
   scenarios from `docs/roadmap/features/214-remove-agent-postgres-mcp/acceptance.feature`. Carry the
   removal provenance in a leading comment (feature 214 supersedes 169's agent-postgres-mcp suite).
3. Confirm no other durable suite (`services/*/acceptance/*.feature`, `docs/sdd/business-rules/platform.feature`)
   still asserts a `db_` tool or postgres-mcp co-process exists.

**Verification**:
- `test ! -e services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature` → exits 0.
- `test -e services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature` → exits 0, and it
  contains `@feature-214`, `@AC-1`, `@AC-2`, `@AC-6`.
- `grep -rln "db_execute_sql\|program:postgres-mcp\|db_ tool" services/*/acceptance/ docs/sdd/business-rules/platform.feature` → only the new `remove-agent-postgres-mcp.feature` (asserting absence), nothing asserting existence.

---

### Step 12 — docs: Add the out-of-band operator DB-access runbook (FR-4)

**Status**: `done`
**Service**: `docs`
**Files**:
- `docs/runbooks/operator-db-access.md` — create
- `docs/runbooks/CLAUDE.md` — modify (index row)

**Reviewers**: none (per step-category matrix: `docs`). Advisory: Security (sanctioned admin-SQL path), Platform Lead.

**Codebase Evidence**:
- **Not found** — no existing runbook documents direct `psql`/DB-client access (recon Patterns to REUSE:
  "No existing runbook covers direct psql; a new file is the home"). Created from scratch.
- `docs/runbooks/CLAUDE.md` is the runbook index (table of `File | Purpose | Key trigger`) — add a row.
- Root `CLAUDE.md` bash-doc rule: macOS/Homebrew-first (`brew install`), no bare `pip`, BSD+GNU-safe flags.
- The managed DB is DigitalOcean PostgreSQL on `:25060` (direct) / `:25061` (PgBouncer) — root CLAUDE.md
  Connection Pool Budget; access via `doctl`/SSH/bastion as a DB owner.

**TDD**: `N/A (docs)`

**Covers**: `AC-5`

**Instructions**:
1. Create `docs/runbooks/operator-db-access.md` documenting the sanctioned out-of-band admin-SQL path:
   connecting a direct `psql` / DB client to the managed DO PostgreSQL as a DB owner via SSH / `doctl` /
   bastion; macOS/Homebrew-first install (`brew install libpq` / `brew install postgresql@16` for `psql`),
   with a Linux parenthetical. State explicitly that **no MCP server exposes any SQL-executing tool** and
   that this runbook is the replacement for the removed agent `db_*` tooling (feature 214, closes H-5).
   Include the out-of-band note that operators should delete the now-unused GitHub repo secrets
   `DEV_/PROD_POSTGRES_MCP_AGENT_PASSWORD` (Step 7 cross-ref).
2. Add an index row to `docs/runbooks/CLAUDE.md`: `operator-db-access.md | Sanctioned out-of-band admin/DB SQL access (direct psql via SSH/doctl/bastion) — no SQL-over-MCP surface exists | Operator needs to run admin SQL`.

**Verification**:
- `test -e docs/runbooks/operator-db-access.md` → exits 0; contains the direct-`psql`/SSH/`doctl` procedure and a "no SQL-over-MCP" statement.
- `grep -n "operator-db-access.md" docs/runbooks/CLAUDE.md` → present.
- `grep -nE "^\s*pip |grep -P" docs/runbooks/operator-db-access.md` → no output (macOS bash-doc rule: no bare `pip`, no GNU-only `grep -P`).

---

## Deviation Log

### DEV-1 (Steps 3–4) — `httpx2` is transitive via `mcp`, not a sole-use orphan
- **Expected (design/recon/adversary)**: `httpx2` (pyproject `:17`) was a direct dep used *only* by
  `app/postgres_mcp_client.py`; removing it would uninstall it and make `test_httpx2_importable` fail
  at collection (delete-not-invert).
- **Actual**: `uv tree --invert` shows `httpx2 v2.12.0 → mcp v2.0.0 → xstockstrat-agent` — `httpx2` is a
  **transitive dependency of the `mcp` SDK** (`mcp>=2.0.0`). It stays installed and in `uv.lock` after
  removal, and `test_httpx2_importable` kept **passing**. No agent code imports `httpx2` directly
  (grep of `app/` clean, `postgres_mcp_client.py` deleted).
- **Disposition**: action unchanged and correct — removing the *redundant direct declaration* is proper
  hygiene (we don't import it directly; `mcp` provides it), and `test_httpx2_importable` was deleted with
  the other postgres-era smoke tests since `httpx2` is no longer our declared/direct dep. Only the
  design's rationale was wrong; `uv lock --check` passes. Ledger `fails.md` entry corrected accordingly.

### DEV-2 (teardown) — obsolete `xstockstrat_agent` role section removed from `docs/patterns/database.md`
- **Trigger**: the post-execution teardown context-drift scan (root CLAUDE.md rule) found
  `docs/patterns/database.md` § "Application-Level Postgres Roles" → `### xstockstrat_agent` still
  documenting the removed DML role + its `POSTGRES_MCP_DATABASE_URI` deploy secret and the FR-11 gate.
- **Not in any step's `**Files**`** — the spec's docs steps named root/agent CLAUDE.md + mcp-tools.md,
  not database.md. Surfaced only by the teardown grep.
- **Disposition**: removed the whole `## Application-Level Postgres Roles` section (xstockstrat_agent was
  its only role, and it was never created). database.md is now clean of postgres-mcp/xstockstrat_agent.
  Recorded here as a teardown-mandated out-of-scope reconciliation (root CLAUDE.md teardown clause takes
  precedence over step-scope for grounded doc drift).
- **Teardown note**: the `context-forge:context-constitution` skill is not available in this session, so
  the teardown was done **manually** — re-grepping every touched context/pattern doc (root CLAUDE.md,
  agent CLAUDE.md, mcp-tools.md, runbook index, database.md) against the code; all reconciled, no
  residual stale references.
