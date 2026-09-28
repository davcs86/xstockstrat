# Context: remove-agent-postgres-mcp

**Feature**: `docs/roadmap/features/214-remove-agent-postgres-mcp/feature.md`
**Product Spec**: `docs/roadmap/features/214-remove-agent-postgres-mcp/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/214-remove-agent-postgres-mcp/implementation-spec.md`

---

## Session 2026-09-26 — sdd-story (supersedes demoted feature 212 / formerly 193)

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from operator
  directive: **"remove all postgres MCP, they are inherently insecure."**
- **Supersedes feature 212 (`sysadmin-db-write-role`, demoted; originally numbered 193).** 212's
  chosen design privilege-separated the DB tooling into a standalone `xstockstrat-psql-mcp` that was
  itself a transparent proxy over postgres-mcp. The operator judged postgres-mcp (crystaldba **and**
  pgEdge families) inherently insecure, so hardening a wrapper around it is rejected — the surface is
  **eliminated**. This closes H-5 / DT-2 by removal rather than separation.
- **Scope = pure removal**, drawn from the "extract-out" half of 212's design minus the "build a new
  home" half:
  - Remove the 9 `db_*` tools + postgres-mcp co-process from `xstockstrat-agent`; tool count 52 → 43.
  - Remove `postgres-mcp` from `pyproject.toml`/`uv.lock`; remove `POSTGRES_MCP_*` wiring and the
    co-process from the container / docker-compose / `.do/app*.yaml`.
  - Remove the agent's direct DB connection + its connection-pool budget row in root CLAUDE.md.
  - **No replacement SQL-over-MCP surface.** Out-of-band `psql` via SSH/doctl/bastion, documented in
    a runbook (FR-4).
- **C-16 CHANGE sign-off (P-05):** removal **changes** feature 169's 13 promoted `agent-postgres-mcp`
  business-rule scenarios. Operator's 2026-09-26 directive is the recorded sign-off; the 13 scenarios
  are removed/inverted in the same PR.
- **Feature 208 demoted (2026-09-27):** originally 208 was to drop/revoke the orphaned
  `xstockstrat_agent` role. But that role was only **conditionally** provisioned by
  `scripts/db-migrate.sh:169-203` (feature 169), gated on `POSTGRES_MCP_AGENT_PASSWORD` — a password
  never set in the live environments, so the `[skip]` path always ran and the role was **never
  created**. There is no live-DB role to drop, so 208 is unnecessary and demoted. This feature (214)
  absorbs the only real cleanup: **deleting the dead provisioning block** (and its
  `POSTGRES_MCP_AGENT_PASSWORD` gate) from `db-migrate.sh` as part of removing all postgres-mcp wiring
  (FR-3). No `214 → 208` ordering remains.
- **No 084 dependency** — the demoted 212's on-demand droplet container is gone; this is a removal
  with no new service and no deployment substrate need.
- Baseline facts to re-derive at recon/execute: `copilot.ts` `COPILOT_MCP_TOOL_COUNT` (was 52),
  `app/tools.py` docstring ("Fifty-two tools"), the 9 `db_*` names, `postgres-mcp==0.3.0` in `uv.lock`,
  and the `agent-postgres-mcp.feature` 13-scenario count. Open forks in product-spec § Open Questions.
- **Ledger:** the generalizable lesson ("when a fronted dependency is inherently insecure, eliminate
  the surface rather than build/maintain a hardened wrapper — attack-surface minimization / YAGNI over
  privilege-separation scaffolding") is appended to `docs/roadmap/ledger/insights.md`.

## Session 2026-09-27 — renumbered 211 → 214 (NNN collision)

- **This feature was created as 211** in the security-audit session but its PR was stranded: the
  Phase D backlog PR (#1185) merged only its first commit (207–210), so this feature's commit never
  reached `main-dev`. In the interim, other sessions merged `211-edgar-fundamentals-enrichment` to
  `main-dev`/`main` (now `implementation-ready` and promoted), taking the number **211**.
- Per `docs/runbooks/feature-workflow.md` § Feature Numbering, the racing loser renumbers to the next
  free NNN. Global `max(existing NNN)` across all origin branches was **213**, so this feature moved to
  **214**. Slug (`remove-agent-postgres-mcp`) and content are unchanged; every self/cross reference was
  repointed (211 → 214; the superseded separation feature 193 → its imported/demoted number 212).
- Lesson recorded (see `fails.md` entry this date): compute the next NNN as `max` across **all origin
  branches**, not just the local working tree — an in-flight sibling on another branch can claim the
  number before your PR merges.

## Session 2026-09-27 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria pass: **PASS WITH WARNINGS** (0 blockers). Every code-checkable claim verified accurate
  (52→43 tool count, nine `db_*` tools, `postgres-mcp` dep, dead `db-migrate.sh` block @ lines 169-204,
  pool-budget row, 13-scenario C-16 suite, FR→@AC coverage).
- **Warnings addressed before advancing** (per operator standing rule "always address advisory-review
  warnings before moving forward"):
  - Open Question 1 (exact `POSTGRES_MCP_*` wiring + launch mechanism) — RESOLVED: env vars
    `POSTGRES_MCP_PORT` / `POSTGRES_MCP_DATABASE_URI` / `POSTGRES_MCP_AGENT_PASSWORD`; co-process
    launched by supervisord `[program:postgres-mcp]` in `services/xstockstrat-agent/supervisord.conf`
    (entry `scripts/docker-entrypoint.sh` → `supervisord -c /app/supervisord.conf`).
  - Open Question 2 (FR-4 runbook home) — RESOLVED: new `docs/runbooks/operator-db-access.md`.
  - Open Question 3 (`db_*` blast radius) — RESOLVED: no external consumer (no `plugins/strat-lab/`,
    no other skill, no UI beyond the count mirror). Scope contained to `xstockstrat-agent` + docs.
  - **Blast-radius scan surfaced 6 under-enumerated removal sites** now folded into the spec:
    `app/postgres_mcp_client.py` (whole-file + its `app/tools.py` import), `supervisord.conf`
    `[program:postgres-mcp]` block, `.github/workflows/deploy.yml`/`deploy-dev.yml`/`deploy-prod.yml`
    (`POSTGRES_MCP_AGENT_PASSWORD` secret injection — a dangling ref here would break deploys), and
    tests `test_db_tools.py` / `test_postgres_mcp_client.py` / `test_deployment_env_vars.py`.
  - Minor NOTE fixed: `db-migrate.sh` block is lines 169-204 (was "~169-203").
- Overlap findings: WARN-only, all file-class soft/rebase — no FAIL (no config key / proto field /
  migration NNN). merge-order.md already carries the 214 row. Manual reconcile with 084
  (docker-compose.yml / .do/app*.yaml / pool-budget table) if both approach merge; second-lander rebases.
- Next Action set to `/sdd-design ... quick` (lifecycle: spec-ready → design-approved via /sdd-design,
  which the SDD entry point makes mandatory before /sdd-spec; the review skill's boilerplate "/sdd-spec"
  next-action text predates the inserted design phase).

## Session 2026-09-28 — sdd-design (quick)

- Phase 0 Recon: wrote recon.md (services: xstockstrat-agent, xstockstrat-ui + deploy/docs). Key reuse:
  existing full name-set equality assert in test_tools_endpoint.py as the sole count guard; removal
  verification gates on symbols ceasing to exist, not substring greps (ledger fails.md:139).
- Phase 1 Grilling: 1 round (quick). Chosen approach: complete subtractive removal, consumer-first,
  one integration PR (sequential), delete-and-promote for C-16. Rejected: invert-13-scenarios in place
  (C-18 DRY); leave sqlglot/httpx2 (dead deps); per-step PRs (change is one cohesive removal).
- **Adversary caught, all folded in before approval** (per operator "address advisory warnings first"):
  (1) `httpx2` is a THIRD orphaned dep (pyproject.toml:17) — added to the 3-dep drop; (2) test_dep_smoke.py
  has 3 postgres-era assertions (sqlglot/httpx2 import tests must be DELETED, not inverted); (3) tool-count
  vs connection-budget are two axes; (4) @AC-7 provenance clause was inconsistent with full deletion —
  reworded acceptance.feature for delete-and-promote. Deploy atomicity risk disproven (named pass-through,
  required:false input, no-op-safe .replace()) → safer caller-first ordering adopted.
- Constitution rules touched: C-10, C-11, C-13, C-14, C-16, C-18, P-06, F-01(N/A), F-07. Floor breaches: none.
- C-16: all 13 agent-postgres-mcp.feature scenarios CHANGE (operator sign-off 2026-09-26); suite deleted,
  @feature-214 absence guarantees promoted as an explicit verified step.
- Status: spec-ready → design-approved.

## Session 2026-09-28 — sdd-spec

- Generated implementation-spec.md with **12 steps**. Status → implementation-ready. All edit sites
  re-confirmed against the working tree (recon.md line numbers held; a few refined below).
- Key codebase findings (confirmed via grep/read this session):
  - **Tool-count baseline still 52**: `copilot.ts:21` (`COPILOT_MCP_TOOL_COUNT = 52`, lineage comment
    `:18-19`), `tools.py:4` ("Fifty-two tools"), name-set equality in `test_tools_endpoint.py:23` with
    db names `:66-74` (no separate count assert — dropping the 9 names auto-derives 43).
  - **`db_*` block** `tools.py:2226`(section comment)`-2351`(end of `db_analyze_db_health`, before
    `def register_prompts`); orphans `_is_destructive:265` + consts `:259-262`, `sqlglot` imports `:76-77`,
    `postgres_mcp_client` in import `:81`. Retain `_caller_access_scope:141`.
  - **Three orphaned deps** in `pyproject.toml`: `httpx2:17`, `postgres-mcp:18`, `sqlglot:19` — keep
    `httpx:7` (distinct pkg, used by tools.py). `httpx2` used only by `postgres_mcp_client.py:18`.
  - **6 test files**: whole-file delete `test_db_tools.py` + `test_postgres_mcp_client.py`; edit
    `test_tools_endpoint.py` (name-set), `test_dep_smoke.py` (delete sqlglot/httpx2/binary tests; keep
    supervisor; drop now-unused `import shutil`), `test_supervisord_conf.py` (invert 4 postgres-mcp
    tests → 1 absence assert), `test_deployment_env_vars.py` (drop 6 POSTGRES_MCP presence asserts;
    invert budget: agent role absent, direct total 9→8).
  - **`deploy.yml` correction**: the `POSTGRES_MCP_AGENT_PASSWORD` secrets **input decl is at :67-72**
    (`required: false`), not :14 (:14 is the `secrets:` block header). Env injection :96, Python
    substitution :145-147. Callers: `deploy-dev.yml:60`, `deploy-prod.yml:59`.
  - **db-migrate.sh block** `:169`(header)`-~205`(closing `fi`+`echo`), gate `:178`, `CREATE ROLE :186`,
    grants `:191-199`, `[skip]` else `:203`. Root CLAUDE.md budget row `:238`, direct total `:239` (9→8).
  - **mcp-tools.md**: "fifty-two" `:3,:10,:45`; `## Database Tools (Admin-only)` section `:1570`→EOF
    (`:1708`, no `## ` follows `### db_analyze_db_health:1698` — whole block removed).
  - **C-16**: `acceptance/agent-postgres-mcp.feature` present (delete); promote a new
    `acceptance/remove-agent-postgres-mcp.feature` (@feature-214, @AC-1/@AC-2/@AC-6).
- **Removal-verification discipline applied** (ledger fails.md:139, feature 079): every step's
  `**Verification**` gates on names/symbols ceasing to exist (name-set equality, deleted file, failed
  import, `bash -n`), never a substring `! grep postgres` — "postgres" legitimately survives in the new
  runbook, the removal record, and git history.

## Open Threads

- [ ] Promotion of @feature-214 absence-scenarios into services/xstockstrat-agent/acceptance/ MUST land in the integration PR (C-16) — target: **Step 11**.
- [ ] Re-derive 43 tool count + direct-backend budget total (9→8) against main-dev at execute-time — target: **Steps 1/2 (count), Steps 8/9 (budget)**.
- [ ] External repo secrets DEV_/PROD_POSTGRES_MCP_AGENT_PASSWORD need operator out-of-band removal (harmless if left) — noted in **Step 7** instructions + **Step 12** runbook.

## Session 2026-09-28 — sdd-review impl-spec (advisory)

- Result: 0 failures, 4 warnings (advisory — did not block). No Floor breach. Criteria PASS WITH
  WARNINGS; overlap WARN-only (file-path soft/rebase, no migration/proto/config FAIL; merge-order 214
  row already accurate).
- **All 4 warnings RESOLVED in the spec before execution** (operator standing rule: address advisory
  warnings before moving forward):
  - [x] Steps 4, 6 (test-only) omitted an explicit `--cov-fail-under` gate → added the service-wide
    `pytest --cov=app --cov-fail-under=40` gate to each.
  - [x] Step 8 (test) covered Step 9 (budget service edit) but was numbered before it (numeric-order
    execution would assert total==8 while CLAUDE.md still said 9) → **swapped Steps 8↔9** so both
    service edits (7 deploy, 8 budget) precede the covering test (9). Updated Step Dependencies,
    Scenario Coverage (AC-3/AC-4/AC-6), Step 7 "proven by", and the new Step 9 coverage gate.
  - [x] Trivial line-count notes (test_dep_smoke "21 lines") — immaterial; execute-time re-confirm greps already handle exact boundaries.
- Overlap findings: WARN-only — soft/rebase overlaps with 084 (compose/app-specs/deploy workflows,
  no impl-spec yet) and 217 (tools.py/mcp-tools.md/agent CLAUDE.md, disjoint regions). Second-lander
  rebases; merge-order.md needs no change.
- Nothing carried into execution as `[ ] unaddressed`.

## Session 2026-09-28 — sdd-execute (sequential)

- Re-spec gate: merged main-dev (0 behind — already up to date); validated all 12 steps' evidence
  against the live codebase — zero drift, no re-spec needed, directive "none".
- Tooling setup (steps 1-12): python3.11+uv0.8.17 ✓ · ruff0.15.8 ✓ · agent .venv provisioned via
  `uv sync --extra dev` (pytest9.0.3, 460 tests collected) ⬇ · node22.22 ✓ · pnpm9.15.9 ✓ · UI deps
  installed ⬇ · bash5.2 ✓. No database started (offline migration/verification rule).
- Executing under the operator's standing "all the way to code + PRs" authorization (covers the
  sequential mode-entry + up-front confirm); informational checkpoints at surface boundaries; genuine
  blockers via AskUserQuestion.

### Step 1 — Remove nine db_* tools + orphans; delete postgres_mcp_client.py [done]
- Removed the 9 db_* tool defs, `_is_destructive` + constants, `sqlglot` imports, and the
  `postgres_mcp_client` import from `app/tools.py` (2422→2244 lines); deleted `app/postgres_mcp_client.py`;
  docstring count 52→43. ruff auto-fixed the now-unused `re`-adjacent import + reformatted.
- Files modified: `app/tools.py` (del `app/postgres_mcp_client.py`)
- TDD: RED = test_db_tools/test_postgres_mcp_client ImportError at collection after removal; verified.
- Deviations: none

### Step 2 — Drop 9 db_ names from name-set; delete 2 db-only test files [done]
- Removed the 9 db_ entries from test_tools_endpoint.py name-set; deleted test_db_tools.py +
  test_postgres_mcp_client.py. Name-set test GREEN (5 passed); full agent suite 442 passed, cov 79.56%.
- Files modified: `tests/test_tools_endpoint.py` (del `tests/test_db_tools.py`, `tests/test_postgres_mcp_client.py`)
- TDD: RED captured (ImportError at collection) after Step 1; GREEN after this step.
- Deviations: the two test-file deletions were committed under Step 1 (staged via `git rm` before the
  Step 1 commit) — granularity-only; squash-merge collapses it. No behavior impact.

### Step 3 — Drop postgres-mcp/sqlglot/httpx2 from pyproject + relock [done]
- Removed the three direct deps from pyproject.toml; `uv lock` pruned postgres-mcp's transitive deps
  (typer, tzdata, urllib3, yarl). `uv lock --check` passes; `httpx` (distinct) retained.
- Files modified: `pyproject.toml`, `uv.lock`
- Deviations: **httpx2 is transitive via `mcp`, not a sole-use orphan** (see Step 4 + Deviation Log).
  Removing the direct declaration is still correct (no agent code imports httpx2 directly), but it stays
  installed via `mcp>=2.0.0` and remains in uv.lock — it does NOT uninstall as the design assumed.

### Step 4 — Delete sqlglot/httpx2/postgres-mcp-binary smoke asserts [done]
- Rewrote test_dep_smoke.py to keep only `test_supervisor_importable`; removed the 3 postgres-era
  tests + the now-unused `import shutil`. GREEN (1 passed), ruff clean.
- Files modified: `tests/test_dep_smoke.py`
- TDD: RED = test_sqlglot_importable (ModuleNotFoundError) + test_postgres_mcp_binary_on_path
  (AssertionError) after Step 3; captured. test_httpx2_importable did NOT go red (httpx2 transitive via
  mcp) — deleted anyway since httpx2 is no longer our declared/direct dep. See Deviation Log.
- Deviations: httpx2 transitive-dep correction (Deviation Log + ledger corrected).

### Step 5 — Delete [program:postgres-mcp] block from supervisord.conf [done]
- Removed the co-process program block (lines 13-21); [program:app-main] retained. File ends clean at 12 lines.
- Files modified: `supervisord.conf`
- TDD: RED = 4 postgres-mcp tests fail (NoSectionError) after removal; captured.
- Deviations: none

### Step 6 — Invert test_supervisord_conf.py to assert the block is absent [done]
- Deleted the 3 postgres-mcp attribute tests; inverted test_postgres_mcp_declared → test_no_postgres_mcp_section
  (@AC-2 @feature-214); updated docstring. GREEN (5 passed), ruff clean.
- Files modified: `tests/test_supervisord_conf.py`
- TDD: RED captured after Step 5; GREEN after this step.
- Deviations: none

### Step 7 — Strip all POSTGRES_MCP_* deploy wiring (caller-first) [done]
- deploy-dev.yml/deploy-prod.yml caller pass-throughs removed first; then deploy.yml input decl +
  env injection + 3 substitution lines; then both components of .do/app.yaml + .do/app.dev.yaml +
  docker-compose.yml. All 6 files: POSTGRES_MCP absent; all YAML parses; OTEL/other secrets intact.
- Files modified: `.github/workflows/deploy.yml`, `deploy-dev.yml`, `deploy-prod.yml`, `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`
- TDD: verified by Step 9. Deviations: none. Note: external repo secrets DEV_/PROD_POSTGRES_MCP_AGENT_PASSWORD need operator out-of-band deletion (harmless).

### Step 8 — Delete dead xstockstrat_agent provisioning block + pool-budget row [done]
- Removed the db-migrate.sh provisioning block (bash -n OK, no residual refs); deleted the
  `xstockstrat-agent (postgres-mcp)` budget row + re-derived Direct total 9→8 and effective usage ~14→~13.
- Files modified: `scripts/db-migrate.sh`, `CLAUDE.md` (root)
- TDD: N/A (shell/doc) — budget covered by Step 9. Deviations: none.

### Step 9 — Invert deployment-env + budget asserts [done]
- Rewrote test_deployment_env_vars.py: assert no POSTGRES_MCP in the 3 deploy files, no
  postgres-mcp budget row / xstockstrat_agent role, Direct total = 8. GREEN (3 passed), ruff clean.
- Files modified: `tests/test_deployment_env_vars.py`
- TDD: RED = 8 old asserts failed after Steps 7/8; GREEN after inversion. Deviations: none.

### Step 10 — Reconcile tool-count mirrors (copilot.ts, agent CLAUDE.md, mcp-tools.md) [done]
- copilot.ts COPILOT_MCP_TOOL_COUNT 52→43 + lineage comment (→ 43 feature 214); agent CLAUDE.md
  count words 52→43 + 9 db_ catalog rows deleted; mcp-tools.md counts 52→43 + `## Database Tools`
  section removed (1708→1569 lines). UI lint exit 0 (only pre-existing warnings in unrelated pages).
- Files modified: `services/xstockstrat-ui/src/lib/copilot.ts`, `services/xstockstrat-agent/CLAUDE.md`, `docs/runbooks/mcp-tools.md`
- TDD: N/A (docs/mirror; executable guard is Step 2 name-set). Deviations: none.

### Step 11 — C-16 delete-and-promote the acceptance suite [done]
- Deleted feature 169's agent-postgres-mcp.feature (13 scenarios, capability gone; operator sign-off
  2026-09-26); created acceptance/remove-agent-postgres-mcp.feature with @feature-214 @AC-1/@AC-2/@AC-6
  absence guarantees + provenance header. Only db_ reference across all durable suites is this absence suite.
- Files modified: `acceptance/remove-agent-postgres-mcp.feature` (del `acceptance/agent-postgres-mcp.feature`)
- Resolves Open Thread: @feature-214 promotion landed. TDD: red-green (durable suite asserts absence). Deviations: none.

### Step 12 — Out-of-band operator DB-access runbook (FR-4) [done]
- Created docs/runbooks/operator-db-access.md (macOS/Homebrew-first; direct psql via doctl/SSH/bastion;
  explicit "no SQL-over-MCP surface" statement; GitHub-secret cleanup note). Added docs/runbooks/CLAUDE.md index row.
- Files modified: `docs/runbooks/operator-db-access.md` (new), `docs/runbooks/CLAUDE.md`
- TDD: N/A (docs). Deviations: none.

## Session 2026-09-28 — sdd-execute (sequential) — COMPLETE
**Steps this session**: 1–12 (all)
**Progress**: 12 done / 12 total
**Stopped at**: all complete → code-completed
**Next**: finalize integration PR #1199 + CI watch

## Session 2026-09-28 — teardown (manual context-constitution reconciliation)
- `context-forge:context-constitution` skill unavailable → performed the teardown **manually**:
  re-grepped every touched context/pattern doc against the code.
  - root CLAUDE.md, agent CLAUDE.md, mcp-tools.md, docs/runbooks/CLAUDE.md: clean (no stale
    postgres-mcp/db_/52; forty-three consistent across the 3 count surfaces).
  - **Found + fixed drift**: docs/patterns/database.md § "Application-Level Postgres Roles" still
    documented the removed xstockstrat_agent role + POSTGRES_MCP_DATABASE_URI deploy secret → whole
    section removed (DEV-2). database.md now clean.
  - Repo-wide POSTGRES_MCP residue: only absence-asserting tests/feature, the operator runbook cleanup
    note, and historical feature-169/208/212 records (correct to leave).
- H-5 closure verified: no db_ tool defs / postgres_mcp_client / sqlglot import in agent app; no
  POSTGRES_MCP wiring in any deploy file; no SQL-over-MCP surface anywhere.
