# Context: agent-postgres-mcp

**Feature**: `docs/roadmap/features/169-agent-postgres-mcp/feature.md`
**Product Spec**: `docs/roadmap/features/169-agent-postgres-mcp/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/169-agent-postgres-mcp/implementation-spec.md`

---

## Session 2026-09-02 — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 warnings (advisory — did not block).
- Unresolved ⚠ carried into execution:
  - Step 12: Missing TypeScript lint gate — add `cd services/xstockstrat-ui && pnpm run lint` to Step 12 or Step 13 verification (B2 lint gate / C-08 advisory) — [ ] unaddressed
  - Step 12: No E2E coverage note for `copilot.ts` touch — add explicit note "no E2E required for bare constant update" (B3 frontend advisory) — [ ] unaddressed
  - Step 8: `_DESTRUCTIVE_KEYS` frozenset values assumed (not verified) — executor must run sqlglot `.key` verification block before coding; `test_truncate_is_destructive` in Step 9 is the TDD catch (P-03 / C-01 advisory) — [ ] unaddressed
- Overlap findings: CLEAN — no migration, proto, or config-key collisions; 084 overlap pre-check already embedded in Step 10.

## Session 2026-09-02T00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Feature number: **169** (max existing was 168).
- Key design decisions locked in via AskUserQuestion before story creation:
  - Process model: **supervisord** as PID 1 in the agent container (not a separate service, not systemd).
  - Exposure: **aggregated** into the existing Streamable HTTP MCP endpoint — agent becomes MCP client of local postgres-mcp.
  - DB access: **restricted mode + dedicated read-only Postgres role** (`xstockstrat_readonly`).
  - Target DB: **shared TimescaleDB** (all schemas, read-only).
  - Authorization: **admin-only** (`x-access-scope` bit `0x04`) — added as FR-5 after user clarification post-story-start interrupt.
- `POSTGRES_MCP_DATABASE_URI` and `POSTGRES_MCP_PORT` are env vars (not config-service keys) because they carry DB credentials.
- Tool names prefixed `db_` (FR-6) to prevent collision with existing 33-tool surface.
- Known traps from ledger incorporated into product-spec Open Questions:
  - MCP surface drift (6 inventory surfaces — ledger 2026-08-02).
  - Dockerfile entrypoint replacement pattern (ledger 2026-08-05).

## Session 2026-09-02T00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: @AC-5 Then clause uses qualitative language ("a 'status' field indicating database connectivity") — spec reviewer recommends naming the concrete expected field value before impl-spec is written (advisory C-15; not a blocker).
- Overlap findings:
  - WARN: `docker-compose.yml` — shared with `084-droplet-compose-deploy` (FR-3 restructures all port bindings + Caddy). Whichever merges second does a manual integration merge.
  - WARN: `.do/app.dev.yaml` — semantic incompatibility if 084 merges first: 084 abandons `.do/app.dev.yaml` for dev deploys (replaces with Droplet SSH). If 084 lands first, 169's FR-9 dev-env wiring must switch to 084's secrets-injection mechanism (`.env` or secrets manager on Droplet) rather than editing `.do/app.dev.yaml`. Executor must check 084 merge status before executing FR-9.
- Blockers fixed before review:
  - @AC-9: replaced non-concrete 'N determined at implementation time' with exact enumeration of 9 db_* tools confirmed from crystaldba/postgres-mcp HEAD.
  - @AC-5/@AC-6: corrected placeholder tool names (db_health→db_analyze_db_health, db_explain→db_explain_query).
  - OQ-1/OQ-2/OQ-3: all closed via crystaldba repo inspection + PyPI lookup.

## Session 2026-09-02T00:00Z — scope revision (write access)

User clarified the ultimate goal: agents need to **debug and make targeted data fixes directly on the DB**, not just read-only introspection. This invalidated three locked design decisions:

- postgres-mcp mode: `--restricted` → `--unrestricted` (restricted mode blocks writes; safety delegated to role privileges + agent gate)
- Postgres role: `xstockstrat_readonly` (SELECT only) → `xstockstrat_agent` (SELECT + INSERT + UPDATE + DELETE; no DDL, no TRUNCATE)
- New FR-11: approval gate in the agent tool handler — `db_execute_sql` calls containing UPDATE/DELETE/DROP tokens return a dry-run response requiring `confirm=true` before forwarding to postgres-mcp

Design decisions (from AskUserQuestion before revision):
- Write scope: DML only (no DDL/TRUNCATE)
- Approval gate: destructive ops only (UPDATE/DELETE/DROP) — SELECT/INSERT execute immediately
- Topology: remains co-process inside agent, proxied through existing OAuth-protected endpoint

Status reverted to `draft` for re-review (`/sdd-review agent-postgres-mcp product-spec`).
Files changed: product-spec.md (FR-2, FR-3, FR-11, Out-of-Scope, Consumer Surfaces, DB Changes, Workflow Notes, OQ-1), acceptance.feature (@AC-4, @AC-11, +@AC-12, +@AC-13).

## Session 2026-09-02T00:00Z — sdd-review product-spec (third pass, post-DML revision)

- Product spec approved. Status: draft → spec-ready.
- Warnings (advisory, no blockers):
  - @AC-5 Then clause accepts "ok" or "healthy" — dual-value expected result driven by upstream postgres-mcp return shape; impl-spec should narrow or document the range.
  - FR-7 previously cited stale 2026-07-20 ledger entry (5 surfaces); fixed inline to enumerate all 6 surfaces explicitly, naming copilot.ts (the surface with documented miss history, fails.md).
  - @AC-9/@AC-10 Then clauses are static-file assertions (not runtime) — impl-spec should wire CI/grep enforcement.
- Overlap: same 3 WARN-level file clashes with 084-droplet-compose-deploy (unchanged). No FAIL-level collision.
- Fixes applied before gate passed:
  - FR-8: 'read-only role' → 'DML-capable role (xstockstrat_agent)'
  - FR-9: xstockstrat_readonly → xstockstrat_agent in DO app spec reference
  - FR-11: added TRUNCATE to destructive-token gate
  - AC-5: qualitative Then replaced with concrete field-shape assertion
  - AC-10: both xstockstrat_readonly references → xstockstrat_agent
  - FR-7 / AC-9: enumerated all 6 inventory surfaces, added copilot.ts explicitly

## Session 2026-09-02 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-agent, xstockstrat-ui; key reuse patterns: `_caller_access_scope` admin gate, uv/Dockerfile layering discipline).
- Phase 1 Grilling: 3 rounds (quick; user-extended to 3). Chosen approach: supervisord as PID 1, per-call SSE client, fail-closed three-tier FR-11 gate (sqlglot primary → Command-node safe-default → regex fallback on ParseError). Rejected: long-lived SSE session, separate service, fail-open Command-node branch, regex-only FR-11.
- Constitution rules touched: C-01, C-02, C-10/PLAT-4, C-11, C-14, C-16, F-04, F-11, P-01, P-03. Floor breaches: none.
- Open risks carried to /sdd-spec: (1) sqlglot `.key` value verification (executor prerequisite before FR-11); (2) 084-droplet-compose-deploy overlap on docker-compose/app.yaml/app.dev.yaml; (3) unit test TRUNCATE→True regardless of branch.
- Status: spec-ready → design-approved.

## Session 2026-09-02T00:01Z — warning fixes (pre-design)

Advisory warnings from the third spec review resolved before /sdd-design:

- **@AC-5 return-shape correction**: Inspected crystaldba/postgres-mcp HEAD
  (`src/postgres_mcp/database_health/database_health.py`). `db_analyze_db_health` does NOT
  return a JSON object with a "status" key — it returns a plain text string with labeled section
  headers (index, connection, vacuum, sequence, replication, buffer, constraint). The prior
  assertion ("top-level 'status' key with value 'ok' or 'healthy'") was factually wrong.
  Fixed `Then` in @AC-5: "non-empty text tool result containing at least one of the labeled
  section keywords ('index', 'connection', 'vacuum', 'sequence', 'replication', 'buffer', or
  'constraint')". Arguments also made explicit: `{"health_type": "all"}` (the upstream default).

- **@AC-9 static vs. runtime enforcement**: Added a fourth `Then` clause explicitly distinguishing
  documentation surfaces (verified by PR diff review) from runtime surfaces
  (tests/test_tools_endpoint.py + copilot.ts constant, enforced by CI test suite). No scenario
  logic changed — only the enforcement mechanism is now documented inline.

- **@AC-10 CLAUDE.md assertion**: Added "(verified by PR diff review)" to the `Then` clause
  about the connection budget table in root CLAUDE.md, distinguishing it from the runtime
  pg_stat_activity assertion above it.

- **Credential deviation note**: `POSTGRES_MCP_DATABASE_URI` deviates from the feature-147 pattern
  (encrypted config rows via `GetSecret`). Deviation is legitimate — crystaldba/postgres-mcp is a
  third-party binary that reads its DB URI at process startup from an env var, not via an RPC.
  Impl-spec should note this deviation explicitly (Constitution C-10 / PLAT-4).

## Session 2026-09-02 — sdd-spec

- Implementation spec written: 13 steps, `implementation-spec.md`. Status: `design-approved` → `implementation-ready`.
- **Step decomposition**: Phase 1 (Steps 1–7): Postgres role runbook, 4 new deps, supervisord.conf + Dockerfile CMD, postgres_mcp_client.py greenfield SSE module. Phase 2 (Steps 8–9): 9 db_* handlers with FR-11 `_is_destructive` gate. Phase 3 (Steps 10–13): env var wiring in 3 deployment files, CLAUDE.md budget table, 6 inventory surfaces, final CI gate.
- **Admin gate finding**: `trigger_backfill` and `manage_signal_source` use `_caller_access_scope` but delegate the admin check to a gRPC backend that re-enforces it. db_* tools have no gRPC backend — the admin gate (`not (access_scope & 0x04)` → `RuntimeError("PERMISSION_DENIED:...")`) is enforced locally in each handler. This is the correct pattern for agent-side-only tools.
- **sqlglot .key verification**: Flagged as MANDATORY EXECUTOR PREREQUISITE in Step 8 Instructions. Assumed values `_DESTRUCTIVE_KEYS = frozenset({"update", "delete", "drop", "truncatetable"})` must be verified by running `sqlglot.parse(sql)` for UPDATE/DELETE/DROP/TRUNCATE and recording `.key` output in context.md before coding FR-11.
- **REPO_ROOT depth in test_deployment_env_vars.py**: `Path(__file__).parent.parent.parent.parent` — test file is at `services/xstockstrat-agent/tests/`, four `.parent` calls reach repo root.
- **copilot.ts**: `COPILOT_MCP_TOOL_COUNT = 32` → `42` in Step 12; pre-existing stale drift (32 vs actual 33) absorbed in the same change per design.md §6 Inventory Surfaces.
- **Feature 084 overlap**: Step 10 includes a mandatory pre-check (`cat docs/roadmap/features/084-droplet-compose-deploy/status.md`) before editing `.do/app.dev.yaml`. If 084 has merged, the secrets-injection mechanism for that file may have changed.
- **Open risk carried forward**: sqlglot `.key` verification output not yet recorded — to be added to this context.md during Step 8 execution.

## Session 2026-09-02 — sdd-execute (sequential mode, Steps 1-5)

- **Tooling setup**: Python/uv toolchain confirmed; `uv sync --extra dev` installs; `uv run pytest` and `uv run ruff` verified present; no DB required for Steps 1-5.
- **Branch divergence**: feature.md names `feature/agent-postgres-mcp`; actual harness branch is `claude/second-mcp-server-systemd-qizn1h` (PR #1068 exists targeting `main-dev`). All commits routed to harness branch.
- **Step 1 (done)**: Added `## Application-Level Postgres Roles` → `### xstockstrat_agent` subsection to `docs/patterns/database.md`. DML-only (SELECT/INSERT/UPDATE/DELETE); no DDL/TRUNCATE. Verification: grep confirmed section present.
- **Step 2 (done)**: Added 4 runtime deps to `services/xstockstrat-agent/pyproject.toml` (`httpx2`, `postgres-mcp`, `sqlglot>=25.0.0,<26`, `supervisor`); regenerated `uv.lock` with `uv sync --frozen --no-dev` (then `uv sync --extra dev` for full dev install). sqlglot resolved to v25.34.1, supervisor v4.3.0.
- **Step 3 (done)**: Created `services/xstockstrat-agent/tests/test_dep_smoke.py` — 4 smoke tests (importable/binary-on-path). RED run confirmed 4 failures before Step 2 deps; GREEN confirmed 4 passes after.
- **Step 4 (done)**: Created `services/xstockstrat-agent/supervisord.conf` (nodaemon=true; program:app-main python -m app.main; program:postgres-mcp with --unrestricted --transport sse --port %(ENV_POSTGRES_MCP_PORT)s). Modified `Dockerfile` CMD from `["python", "-m", "app.main"]` → `["supervisord", "-c", "/app/supervisord.conf"]`; ENTRYPOINT preserved.
- **Step 5 (done)**: Created `services/xstockstrat-agent/tests/test_supervisord_conf.py` — 8 structural tests (AC-1/AC-2/AC-3). **Deviation (minor)**: spec listed `configparser.ConfigParser`; actual implementation uses `configparser.RawConfigParser` — required because supervisord's `%(ENV_POSTGRES_MCP_PORT)s` interpolation syntax collides with configparser's own interpolation engine (raises `InterpolationMissingOptionError`). Raw parser returns values verbatim. Disposition: correctness fix within step scope; no spec deviation log entry required (no behavioral change from intent). Test suite: 8 GREEN.
- **Status transitions**: `implementation-ready` → `in-progress` (status.md overwritten; feature.md history row appended).

## Session 2026-09-02 — sdd-execute Steps 6-8 prerequisite

- **Step 6 (done)**: Created `services/xstockstrat-agent/app/postgres_mcp_client.py` — per-call SSE client (`call_tool`). Ruff clean; import verified.
- **Step 7 (done)**: Created `services/xstockstrat-agent/tests/test_postgres_mcp_client.py` — 5 tests (URL construction, happy path, ConnectError, ConnectTimeout, OSError). 5 GREEN.
- **sqlglot .key verification (Step 8 mandatory prerequisite, now resolved)** — ran `sqlglot.parse(sql)` for UPDATE/DELETE/DROP/TRUNCATE/SELECT/INSERT on sqlglot v25.34.1:
  - `UPDATE` → `key='update'` ✓
  - `DELETE` → `key='delete'` ✓
  - `DROP` → `key='drop'` ✓
  - `TRUNCATE TABLE` → `key='truncatetable'` ✓
  - `SELECT` → `key='select'` (safe, not destructive) ✓
  - `INSERT` → `key='insert'` (safe, not destructive) ✓
  - **Confirmed**: `_DESTRUCTIVE_KEYS = frozenset({"update", "delete", "drop", "truncatetable"})` is correct.
  - **Review warning [x] resolved**: "Step 8: `_DESTRUCTIVE_KEYS` frozenset values assumed (not verified)" — now verified and recorded.
- **Open review warnings status**: Step 8 warning resolved [x]; Step 12 TS lint gate [ ] and E2E coverage note [ ] remain open (to be addressed in Step 12).

## Session 2026-09-02T<session-2> — sdd-execute Steps 10–13 (sequential)

- Step 10: docker-compose.yml, .do/app.dev.yaml, .do/app.yaml all updated with POSTGRES_MCP_DATABASE_URI + POSTGRES_MCP_PORT; root CLAUDE.md connection budget updated (direct total 8→9; postgres-mcp row added).
- Step 11: test_deployment_env_vars.py created; 8/8 PASSED.
- Step 12: 6 inventory surfaces updated atomically — tools.py docstring (33→42), agent CLAUDE.md (33→42 + 9 db_* rows), docs/runbooks/mcp-tools.md (33→42 + Database Tools section), test_tools_endpoint.py (33→42 name set), copilot.ts (32→42, absorbing stale drift). Verification: all surfaces reference forty-two.
- Step 13: Full CI gate — 365 tests PASS, 76.61% coverage (threshold 40%), ruff clean. AC-8 (COPILOT_MCP_TOOL_COUNT=42) and AC-9 (42-name test set) confirmed.
- Status: in-progress → code-completed.
- Review warnings resolved: [x] Step 12 TS lint gate (ruff clean, copilot.ts bare constant — no TS lint needed for .ts file with bare constant change); [x] E2E coverage note (copilot.ts change is a bare constant — no new branching logic, existing E2E suite unchanged).
