# Design: remove-agent-postgres-mcp

**Created**: 2026-09-28
**Rounds**: 1 (quick; termination: approved)
**Approved by**: user @ 2026-09-28
**Grounded in**: recon.md

---

## Chosen Approach

A **complete, subtractive removal executed consumer-first and verified by symbol/name-set
disappearance**, landed as one integration PR (sequential execute mode — the change is a single
cohesive removal, not independently shippable slices). No new capability, no replacement
SQL-over-MCP surface — the consumer surface (nine `db_*` Agent MCP tools, C-14) is deliberately
eliminated; the legitimate operator need moves to an out-of-band runbook (FR-4).

**Agent code** (`services/xstockstrat-agent/app/tools.py`): delete the nine `db_*` tool defs +
`@server.tool()` decorators (`recon.md` Codebase Map, `tools.py:2226-2348`), the sole-use
`_is_destructive` helper + its `_DESTRUCTIVE_KEYS`/`_COMMENT_RE`/`_DESTRUCTIVE_RE` constants
(`:259-265`, used only by `db_execute_sql:2282`), and the `postgres_mcp_client` import (`:81`); fix
the docstring count (`:4`, `:61`). Retain `_caller_access_scope` (`:141`, shared). Delete
`app/postgres_mcp_client.py` outright.

**Dependencies** (`pyproject.toml`): drop **three** orphaned deps — `postgres-mcp` (`:18`),
`sqlglot` (`:19`, orphaned by `_is_destructive` removal), and **`httpx2`** (`:17`, used only by
`postgres_mcp_client.py:18,44` — `tools.py` uses the distinct `httpx`, which stays). Regenerate with
`uv lock`; `uv lock --check` gates (root CLAUDE.md). [`httpx2` surfaced round 1 — recon Risks.]

**Container**: delete `[program:postgres-mcp]` from `supervisord.conf:14-21`; `[program:app-main]`
stays. No Dockerfile/entrypoint change (no postgres-mcp ref there — recon).

**Tests (red-before-green, P-06)**: for a removal, RED = the presence-assert failing after the
production/config edit, GREEN = deleting/inverting it to assert absence.
- Delete whole-file: `tests/test_db_tools.py`, `tests/test_postgres_mcp_client.py` (fail at import once the module/deps go).
- Edit: `tests/test_tools_endpoint.py` — remove the nine db_ names from the name-set equality assert (`:66-74`); the asserted count auto-drops 52→43 (the robust guard, fails.md:308).
- Edit: `tests/test_deployment_env_vars.py` — drop the `POSTGRES_MCP_*` assertions and re-derive the direct-backend budget total (`:54,:63`).
- Edit `tests/test_dep_smoke.py` — **delete** `test_sqlglot_importable` (`:10-11`) and `test_httpx2_importable` (`:14-15`) (they fail at collection once the deps leave — cannot be inverted); delete/handle `test_postgres_mcp_binary_on_path` (`:18-21`); keep `test_supervisor_importable` (`:6-7`).
- Invert: `tests/test_supervisord_conf.py` (`:47-69`) to assert **no** `[program:postgres-mcp]`, `[program:app-main]` still present.

**C-16 (delete-and-promote)**: delete the 13-scenario `services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature`
(the capability is gone; the "archiver never deletes" clause is scoped to `/sdd-archiver`, not a
deliberate capability removal with recorded operator sign-off, context.md 2026-09-26). **Promote**
this feature's own absence guarantees (`acceptance.feature` `@AC-1` no db_ tool, `@AC-2` no
co-process/wiring, `@AC-6` no prompt-injected SQL path) into `services/xstockstrat-agent/acceptance/`
tagged `@feature-214` as an **explicit, verified integration step** — provenance lives in the
promoted scenarios + context.md + git history (`@AC-7` reworded round 1 for this consistency).

**Count vs budget — two separate axes (C-10)**: tool-count surfaces (`copilot.ts:21` 52→43 +
lineage comment; agent `CLAUDE.md` count + nine rows, **all** "fifty-two" prose occurrences;
`app/tools.py` docstring; `mcp-tools.md:3,10,45` + db_ sections `:1572-1638`; the name-set test) are
one required-update set; the connection-budget surfaces (root CLAUDE.md pool row + re-derived direct
total; `test_deployment_env_vars.py`) are a second — each verified independently.

**Deploy removal (safer caller-first ordering, adversary round 1)**: the reusable-workflow input is
`required: false` and callers pass by name (not `secrets: inherit`), and the placeholder substitution
is a no-op-safe `.replace()` — verified. So: (1) remove the caller pass-throughs
(`deploy-dev.yml:60`, `deploy-prod.yml:59`) — always valid since the input is optional; (2) remove
the reusable input decl (`deploy.yml:67-71`), env injection (`:96`), substitution step (`:145-147`),
and `secrets:` decl entry (`:14`); (3) strip `POSTGRES_MCP_DATABASE_URI`/`_PORT` env + the `YOUR_*`
placeholder from **both** components (agent + db-migrator) of `.do/app.yaml` and `.do/app.dev.yaml`;
(4) strip `docker-compose.yml:100-102,553-554` (local-only, any time). External repo secrets
`DEV_/PROD_POSTGRES_MCP_AGENT_PASSWORD` → operator out-of-band cleanup note (cannot delete via code).
Incidentally removes a latent feature-169 gap (a prod-recreate would have shipped the literal
`YOUR_PROD_...` placeholder).

**DB tooling**: delete the dead `xstockstrat_agent` role-provisioning block
`scripts/db-migrate.sh:169-204` + its `POSTGRES_MCP_AGENT_PASSWORD` gate — the role was never created
(password never set → `[skip]`), so no live-DB `DROP ROLE` (F-01 N/A — shell block, not applied
migration). Drop the root CLAUDE.md pool-budget row + re-derive the direct total.

**Runbook (FR-4)**: new `docs/runbooks/operator-db-access.md`, macOS/Homebrew-first — the sanctioned
out-of-band admin-SQL path (direct psql / DB client via SSH / doctl / bastion).

## Rejected Alternatives

- **Invert the 13 feature-169 scenarios in place** (keep the file, rewrite each to assert absence) — rejected: produces 13 awkward "does-not-exist" scenarios duplicating this feature's cleaner `@AC-1..@AC-7` (C-18 DRY), and leaves a durable file named for a non-existent capability. Deletion + guaranteed promotion is cleaner; safe *only because* promotion is made an explicit verified step.
- **Leave `sqlglot`/`httpx2` installed** — rejected: both are confirmed sole-use of the removed surface; leaving them is dead deps (C-18 YAGNI/DRY) and contradicts "clean up the orphans you introduced."
- **Atomic single-commit deploy edit** (proposer's framing) — superseded: since the reusable input is `required: false`, the lower-risk caller-first ordering removes callers before the input decl with no broken intermediate.
- **Per-step PRs (default execute mode)** — rejected for this feature: the removal is one cohesive change with tightly coupled cross-file invariants (count mirrors, deploy pipeline); a single integration PR (sequential mode) keeps the tree deployable and reviewable as a unit.

## Open Risks

- [ ] **Promotion of `@feature-214` absence-scenarios must actually land** in `services/xstockstrat-agent/acceptance/` in the integration PR — else a guarantee is silently dropped (C-16). → verified at the C-16 step.
- [ ] **Re-derive the 43 count and the direct-backend budget total against `main-dev` at execute-time** — baselines (52 tools; direct total) may shift if another feature merges first. → first agent-code step + budget step.
- [ ] **External GitHub repo secrets** `DEV_/PROD_POSTGRES_MCP_AGENT_PASSWORD` remain until an operator removes them out-of-band — harmless but noted in the PR/runbook.

## Constitution Rules Touched

- **C-10** — honored: tool-count and connection-budget surfaces treated as two lockstep update sets, each with its own verification.
- **C-11** — honored: this design is the mandatory `/sdd-design quick` grounding before implementation.
- **C-13** — honored: test edits touch Python `tests/`; no new inline fixtures introduced (removal only).
- **C-14** — honored: the Agent `db_*` consumer surface is named and deliberately eliminated (not left stale); operator need re-homed to the FR-4 runbook.
- **C-16** — CHANGE to feature 169's 13 `@AC-*` guarantees; operator sign-off recorded in context.md (2026-09-26); delete-and-promote recorded here.
- **C-18** — honored: pure subtraction; sole-use orphans removed (YAGNI/DRY), shared `_caller_access_scope` retained.
- **P-06** — honored: removal red-before-green defined (presence-assert RED → absence GREEN).
- **F-01** — N/A/honored: no applied `.up.sql` edited; the db-migrate.sh block is a shell provisioning block.
- **F-07** — honored: `POSTGRES_MCP_*` are env vars, not config-service keys; no config hardcoding introduced.

## Business Rules Touched (C-16)

- CHANGE (all 13) `@AC-1..@AC-13` in `services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature` — the whole suite asserts the now-removed db_* tools / postgres-mcp co-process / its deploy env / pool slot. Deleted; signed off by operator @ 2026-09-26 (context.md). Replaced by promoted `@feature-214` `@AC-1/@AC-2/@AC-6` absence guarantees.
- No `platform.feature` scenario and no `xstockstrat-ui` durable rule is affected (UI count covered transitively by the deleted `@AC-9`; its guarantee moves to this feature's `@AC-4`).
