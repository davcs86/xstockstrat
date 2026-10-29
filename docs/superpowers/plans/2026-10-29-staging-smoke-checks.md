# Staging Smoke-Check Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A staging-only `xstockstrat-smoke` service that runs a catalog of named, read-only checks (DB reads + read-only RPCs to every backend), plus the writers that commit run records to a `smoke-results` branch and the triggers (homelab post-deploy, DO `POST_DEPLOY` job, Claude agent tool).

**Architecture:** One Python/Starlette service per the approved design; checks are Python modules baked into its image; the service keeps only a bounded in-memory run buffer, and the durable record is JSON files on `smoke-results` written by the caller (`scripts/smoke/run_and_record.py`). "Read-only" is enforced by refusing any RPC whose protobuf method lacks `idempotency_level = NO_SIDE_EFFECTS`.

**Tech Stack:** Python 3.13/uv, Starlette+uvicorn, grpc.aio with the platform mTLS helpers, asyncpg (read-only role), pytest (`asyncio_mode=auto`), protobuf option annotations, GitHub Actions, DO App Platform, homelab compose.

**Spec:** `docs/superpowers/specs/2026-10-29-staging-smoke-checks-design.md` (approved). Project B (SDD integration) is a separate plan.

## Global Constraints

- Phase 1 checks are read-only: no mutating RPC, no DB write. Not in production, ever; the service is absent from `.do/app.yaml` and from production homelab renders.
- No public listener. HTTP stays on the tailnet (homelab) or DO private networking; no app-layer TLS in v1.
- Auth: header `x-smoke-key`, constant-time compare, key from the encrypted config secret `smoke` / `api.key` via `GetSecret` (`x-internal-caller: smoke`, `peerSan: xstockstrat-smoke`).
- Run-once key is `(check_id, check_hash, env)`; `check_hash` = sha256 of the check module source. Outcomes: `PASS|FAIL|ERROR|TIMEOUT`; only `PASS` clears pending.
- Result files: `smoke-results/<env>/<UTC>-<run_id>.json` on branch `smoke-results`, one file per run, never edited.
- Python: `uv lock` after any `pyproject.toml` change and commit `uv.lock`; ruff line length 100; coverage gate 40 (`uv run pytest --cov=app --cov-fail-under=40`).
- `.sh` files: `#!/usr/bin/env bash`, bash 3.2-compatible. Comments state constraints only, ≤2 lines.
- Cross-service grants, the new service, HTTP exception, DB role and config keys need the approvals in `docs/runbooks/approval-flow.md`.

## Plan-time calls (grounded in the repo; veto any)

1. RPC identity: checks call RPCs as one configured smoke user (`smoke.rpc.user_id`, non-secret config key). Ingest, indicators, analysis, portfolio, notify and identity reject a missing `x-user-id`, and `system` is honoured only for analysis's fundamentals producer.
2. DB: direct `:25060`, pool max 1 (direct total 8→9), reads inside `readonly=True` transactions with `SET LOCAL statement_timeout` (precedent: `services/xstockstrat-analysis/app/repositories/read_budget.py`).
3. The read-only role is DBA-provisioned (no role-creation mechanism exists; features 169/208 never created one): a SQL file + runbook, not a migration.
4. Only pure-read RPCs are annotated. Read-looking RPCs with side effects stay unannotated and are refused: `marketdata.GetFundamentals`, `GetFundamentalsMulti`, `GetLatestQuote`, `GetLatestPrice`, `analysis.ListOpportunities`, `EvaluateReadiness`, `GetWatchlistReadiness`, `config.GetSecret`.
5. The DO `POST_DEPLOY` job always exits 0 (a failed job would fail the deployment; verify in Task 10); the verdict lives in the results branch.
6. Homelab: `xstockstrat-smoke` is a compose `profiles: [smoke]` service activated for staging only, with its port published for the tailnet. The tailnet ACL allowing `tag:ci` to that port lives in the external homelab-edge repo and is a prerequisite.
7. The agent tool registers only when `SMOKE_ENDPOINT` is set and is excluded from the 45-tool parity surfaces.
8. Cut from phase 1: an on-demand GitHub workflow (it would duplicate the tailnet-join steps of `deploy-homelab.yml`). On-demand runs go through the agent tool or `run_and_record.py` from a tailnet host.

## Review Focus

- A check module that fails to import must surface as an `ERROR` catalog entry, never vanish or crash `GET /checks`.
- A check that hangs must record `TIMEOUT` and let the run continue to the next check.
- Two concurrent `POST /runs` must yield one run and a `409`, never two interleaved runs.
- A writer push race, or a first run before `smoke-results` exists, must end with the file committed exactly once.
- Missing key, missing `smoke.rpc.user_id` or an unannotated RPC must produce `ERROR`/refusal, never a `PASS`; evidence containing secret-like keys must be redacted and size-bounded.

---

### Task 0: SDD grounding and approvals (gate; no code)

- [ ] Run `/sdd-story smoke-check-runtime`, then `/sdd-design smoke-check-runtime quick`, with the approved design doc as input; record the design-phase ledger touch (Constitution C-11). Nothing below starts before this.
- [ ] Open the approval requests: platform lead (new service + HTTP exception), DBA (read-only role), config team (`smoke.*` keys), owners of every target service (cross-service reads), homelab-edge owner (tailnet ACL for `tag:ci` → smoke port).
- [ ] Create the fine-grained PAT (single repo, `Contents` only, machine account, expiry set) and store it as the GitHub/DO secret `SMOKE_RESULTS_PAT`.

### Task 1: Service skeleton with authenticated `GET /checks`

**Files:**
- Create: `services/xstockstrat-smoke/{pyproject.toml,uv.lock,Dockerfile,CLAUDE.md}`, `app/{__init__,main,auth,mtls}.py`, `tests/{__init__,conftest}.py`, `tests/test_auth.py`
- Template: `services/xstockstrat-ingest` (pyproject, Dockerfile, `app/mtls.py`, `tests/conftest.py` gen-path shim); `services/xstockstrat-agent/app/main.py:91-246` (Starlette + uvicorn)

**Interfaces:**
- Produces: `app.main.build_app(*, api_key: str, catalog_provider: Callable[[], dict]) -> Starlette`; `app.auth.require_key(request, api_key) -> None` (raises `HTTPException(401)`); `GET /checks` → `{"deployed_sha": str, "checks": [...], "load_errors": [...]}`.

- [ ] **Step 1:** Write `tests/test_auth.py`: `test_checks_without_key_is_401`, `test_checks_with_wrong_key_is_401`, `test_checks_with_key_is_200` (Starlette `TestClient`, header `x-smoke-key`), and `test_compare_is_constant_time` (patch `hmac.compare_digest`, assert it is called).
- [ ] **Step 2:** `cd services/xstockstrat-smoke && uv sync --extra dev && uv run pytest tests/test_auth.py -v` → FAIL (module missing).
- [ ] **Step 3:** Implement the skeleton to the signatures above; `main()` binds `0.0.0.0:${HTTP_PORT:-9100}`, calls `init_telemetry()` first, and exits non-zero if `MTLS_*` env is missing (copy ingest's fail-closed `mtls.py`). Dockerfile copies ingest's pattern and adds `ARG GIT_SHA` / `ENV SMOKE_GIT_SHA=$GIT_SHA`.
- [ ] **Step 4:** Re-run: PASS. Run `uv lock` and `uv run ruff check . && uv run ruff format --check .`.
- [ ] **Step 5:** Commit `feat(smoke): service skeleton with key-authenticated /checks`.

### Task 2: Check model and catalog loader

**Files:** Create `app/checks.py`, `checks/__init__.py`, `checks/_example/pass_trivial.py`; Test `tests/test_catalog.py`

**Interfaces:**
- Produces: `Outcome(StrEnum)` = PASS|FAIL|ERROR|TIMEOUT; `@dataclass(frozen=True) Check(id: str, feature: str, part: str, timeout_s: float, run: Callable[[CheckContext], Awaitable[None]], check_hash: str)`; `CheckFailure(Exception)` with `.evidence: dict`; `load_catalog(root: Path) -> Catalog` where `Catalog.checks: dict[str, Check]` and `Catalog.load_errors: list[LoadError(module, error)]`. A check module exports `CHECK = CheckSpec(id, feature, part, timeout_s)` and `async def run(ctx)`.

- [ ] **Step 1:** Tests: `test_loads_valid_check_with_sha256_of_source`; `test_duplicate_ids_are_load_errors`; `test_syntax_error_module_becomes_load_error_not_crash` (Review Focus 1); `test_hash_changes_when_source_changes`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement via `importlib` over `checks/**/*.py`; hash is `hashlib.sha256(source_bytes)`; wire `/checks` to `load_catalog`. **Step 4:** PASS. **Step 5:** Commit.

### Task 3: Read-only RPC enforcement and proto annotations

**Files:**
- Modify: `packages/proto/*/v1/*.proto` (add `option idempotency_level = NO_SIDE_EFFECTS;` to each pure-read RPC; leave the Plan-time-call-4 list unannotated), regenerate via `./scripts/buf-gen.sh`
- Create: `services/xstockstrat-smoke/app/rpc.py`; Test `tests/test_read_only_rpc.py`

**Interfaces:**
- Produces: `class MutatingRpcRefused(Exception)`; `class ReadOnlyRpc` with `__init__(self, *, user_id: str, endpoints: Mapping[str, str])` and `async call(self, full_method: str, request: Message, *, timeout: float = 10.0) -> Message`; `.invoked: list[str]` (audit trail). `full_method` is `"xstockstrat.ledger.v1.LedgerService/QueryEvents"`; headers sent: `x-user-id`, `x-trace-id`, `x-access-scope` (non-admin).

- [ ] **Step 1:** Tests against the generated descriptors: `test_ledger_query_events_is_allowed`, `test_ledger_append_event_is_refused`, `test_config_get_secret_is_refused`, `test_marketdata_get_fundamentals_is_refused`, `test_unknown_method_is_refused`, `test_refused_call_never_opens_a_channel` (assert the channel factory mock not called), `test_invoked_lists_called_methods`.
- [ ] **Step 2:** Run → FAIL (no annotations). **Step 3:** Annotate protos; resolve the method via the default descriptor pool and compare `GetOptions().idempotency_level`; reuse the ingest `mtls.secure_channel` helper with `target_override` per target service. If the Python runtime does not expose the option, stop and raise it (design fallback: convention + audit).
- [ ] **Step 4:** `./scripts/buf-gen.sh` must leave an empty `git diff packages/proto/gen/` beyond the annotation; `buf lint` and `buf breaking` pass. Tests PASS. **Step 5:** Commit protos + generated stubs + wrapper in separate commits.

### Task 4: Read-only DB access

**Files:** Create `app/db.py`, `db/smoke_readonly_role.sql`, `docs/runbooks/smoke-db-role.md`; Test `tests/test_db.py`

**Interfaces:** Produces `class ReadOnlyDb` with `async sql(self, query: str, *args, timeout_ms: int = 5000) -> list[dict]`; opens `connection.transaction(readonly=True)` and issues `SET LOCAL statement_timeout`. Reads `SMOKE_DATABASE_URL`; pool max from `DB_POOL_MAX` (default 1).

- [ ] **Step 1:** Tests with a fake asyncpg connection: `test_sql_runs_in_readonly_transaction`, `test_sets_local_statement_timeout`, `test_write_statement_error_is_propagated_as_check_error`. Optional integration test against the compose TimescaleDB, skipped without `SMOKE_DATABASE_URL`.
- [ ] **Step 2–4:** Fail → implement → pass. `smoke_readonly_role.sql` is idempotent (`CREATE ROLE ... LOGIN` guarded, `GRANT USAGE` on each schema from `docs/patterns/database.md`, `GRANT SELECT ON ALL TABLES`, `ALTER DEFAULT PRIVILEGES`); the runbook documents the manual DBA step per environment and the direct-pool budget change.
- [ ] **Step 5:** Commit.

### Task 5: Runner and `/runs` API

**Files:** Create `app/runner.py`, `app/redact.py`; Modify `app/main.py`; Test `tests/test_runner.py`

**Interfaces:**
- Consumes: Tasks 2–4. Produces: `class RunInProgress(Exception)`; `class Runner` with `async start(self, check_ids: list[str], trigger: str) -> str` and `get(self, run_id: str) -> dict | None`; record fields exactly as the design (`run_id, check_id, check_hash, feature, part, env, deployed_sha, outcome, started_at, duration_ms, trigger, rpcs_invoked, evidence`); `redact.bound(evidence: dict, *, max_bytes: int = 4096) -> dict`. Endpoints `POST /runs` (202 `{run_id}`; 409 when busy; 404 body listing unknown ids) and `GET /runs/{id}`; buffer keeps the last 50 runs.
- `CheckContext` exposes `ctx.sql`, `ctx.rpc`, `ctx.note(key, value)`.

- [ ] **Step 1:** Tests: `test_pass_fail_error_timeout_outcomes` (a check raising `CheckFailure` → FAIL with evidence; raising other → ERROR; sleeping past `timeout_s` → TIMEOUT and the next check still runs); `test_second_start_while_running_raises_run_in_progress`; `test_post_runs_busy_is_409`; `test_unknown_check_id_is_404`; `test_evidence_redacts_secret_like_keys_and_is_size_bounded`; `test_refused_rpc_is_error_not_pass`; `test_buffer_evicts_oldest_beyond_50`; `test_missing_user_id_config_makes_rpc_checks_error`.
- [ ] **Step 2–4:** Fail → implement (single `asyncio.Lock`, `asyncio.wait_for` per check) → pass. **Step 5:** Commit.

### Task 6: Startup wiring, config key and secret grant

**Files:**
- Create: `app/config/{__init__,watcher}.py` (copy of ingest's pattern, namespace `smoke`), `services/xstockstrat-config/migrations/034_smoke_keys.{up,down}.sql`
- Modify: `app/main.py`; `services/xstockstrat-config/src/grpc/authz.ts` (add to `SECRET_CALLER_ALLOWLIST`: `{callerID:'smoke', namespace:'smoke', keys:['api.key'], peerSan:'xstockstrat-smoke'}`); `services/xstockstrat-config/src/__tests__/secretCallerAuthz.test.ts`; `docs/patterns/config-governance.md` (Per-Feature Registered Keys, newest first)
- Test: `tests/test_startup.py`

**Interfaces:** Produces `async def load_runtime_settings(watcher, get_secret) -> Settings(api_key: str, rpc_user_id: str)`; service exits non-zero when `api.key` is empty. Migration seeds secret row `smoke`/`api.key` (`is_secret=TRUE`, copy `017_config_secrets_and_scoping.up.sql:110-121`) and non-secret `smoke.rpc.user_id` (string, default `''`) for `staging` and `production`.

- [ ] **Step 1:** Python test `test_startup_fails_closed_without_api_key`, `test_rpc_user_id_empty_is_allowed_but_flagged`; Node test `smoke caller with matching SAN may GetSecret smoke/api.key` and `smoke caller with another SAN is denied`, `smoke caller cannot read other namespaces`.
- [ ] **Step 2–4:** Fail → implement → pass (`pnpm --filter xstockstrat-config test`; `uv run pytest`). Migration down deletes the rows. **Step 5:** Commit config-service change and smoke change separately.

### Task 7: Result writer and pending computation

**Files:** Create `scripts/smoke/run_and_record.py` (stdlib only), `scripts/smoke/tests/test_run_and_record.py`

**Interfaces:** CLI `run_and_record.py --endpoint URL --env staging [--checks id,id] [--strict]`, key from `SMOKE_API_KEY`, git remote/credentials from the environment (`GITHUB_TOKEN` or `SMOKE_RESULTS_PAT`). Functions: `pending(catalog: list[dict], recorded: list[dict], env: str) -> list[str]`; `record_path(env: str, started_at: str, run_id: str) -> str`; `push_with_retry(repo_dir, files, attempts=5)`. Exit 0 unless `--strict` and any outcome ≠ PASS.

- [ ] **Step 1:** Tests with a temporary local bare repo as remote: `test_pending_excludes_pass_for_same_check_hash_env`; `test_edited_check_hash_is_pending_again`; `test_fail_does_not_clear_pending`; `test_first_run_creates_orphan_smoke_results_branch`; `test_push_race_rebases_and_commits_once` (second clone pushes first); `test_default_exit_is_0_on_red_and_strict_is_1`; `test_never_logs_key_or_token`.
- [ ] **Step 2–4:** Fail → implement (fetch branch, read `smoke-results/<env>/*.json`, `POST /runs`, poll `GET /runs/{id}`, write files, commit, push) → pass. **Step 5:** Commit.

### Task 8: Register the service locally and in CI

**Files:** Modify `scripts/gen-dev-certs.sh:28-31`, `scripts/mtls-dev-env.sh:31-34`, `docker-compose.yml` (new block copied from the agent block `:546-592`, env `SMOKE_DATABASE_URL`, `*_ENDPOINT` for all ten backends, `SMOKE_MTLS_CERT/KEY`), `.github/workflows/ci.yml` (paths-filter `:52-63`, `python-lint` `:303-318`, `python-test` `:350-373` with `coverage_threshold: 40`), `.github/workflows/docker-build.yml` (matrix `:30-56`; add `build-args: GIT_SHA=${{ github.sha }}` for the smoke entry), root `CLAUDE.md` (Service Registry, Connection Pool Budget direct total 8→9, Key File Paths), `docs/patterns/ci-overview.md:15-16`, `docs/patterns/docker-build.md`, `.github/dependabot.yml`

- [ ] **Step 1:** Add a CI-facing check: `docker compose config -q` and `./scripts/gen-dev-certs.sh` produce `certs/xstockstrat-smoke/`. **Step 2:** Run before edits → no cert dir (FAIL). **Step 3:** Make the edits. **Step 4:** Re-run: PASS; `docker compose build xstockstrat-smoke` and start it; `GET /checks` with the key returns the example check. **Step 5:** Commit.

### Task 9: Homelab staging-only service

**Files:** Modify `deploy/homelab/compose.yml` (service with `profiles: ["smoke"]`, `IMAGE_SMOKE`, `SMOKE_MTLS_*` required, published port `9100`), `deploy/homelab/render-assert.jq` (`:5-8` classify smoke as `direct`; `:28` allow; staging must render exactly the smoke service, production must not; `:46` ports assertion becomes `agent=9000, ui=3000` plus `smoke=9100` for staging only), `scripts/homelab-render.test.sh` (counts at `:75`/`:79`: 13 production, 14 staging; add mutation cases `smoke-in-production`, `smoke-port-in-production`), `scripts/homelab-release-env.sh` (staging sets `COMPOSE_PROFILES=smoke` and `IMAGE_SMOKE`), `.github/workflows/deploy-homelab.yml` (digest-pin `IMAGE_SMOKE` for staging)

- [ ] **Step 1:** Extend `homelab-render.test.sh` first; run `bash scripts/homelab-render.test.sh` → FAIL. **Step 2–4:** Implement → PASS for both environments and every mutation. **Step 5:** Commit.

### Task 10: DO dev component, `POST_DEPLOY` job and secrets

**Files:** Modify `.do/app.dev.yaml` (component copied from the ingest block `:230`, `internal_ports: [9100]`, MTLS placeholders `YOUR_DEV_MTLS_CERT_SMOKE` / `YOUR_DEV_MTLS_KEY_SMOKE`; `jobs:` gains `smoke-record`, `kind: POST_DEPLOY`, `dockerfile_path: scripts/smoke/Dockerfile.post-deploy`, env `SMOKE_ENDPOINT=http://${xstockstrat-smoke.PRIVATE_DOMAIN}:9100`, `SMOKE_API_KEY` and `SMOKE_RESULTS_PAT` as `type: SECRET`); Create `scripts/smoke/Dockerfile.post-deploy` (python slim + git, runs `run_and_record.py --env staging`); Modify `.github/workflows/deploy.yml:14-75,105-203` and `deploy-dev.yml` (declare and pass `SMOKE_API_KEY`, `SMOKE_RESULTS_PAT`, substitute their placeholders); `.do/app.yaml` is **not** touched.

- [ ] **Step 1:** Add a lint check in `scripts/` or CI (`yq`/python) asserting `.do/app.yaml` contains no `xstockstrat-smoke`, no `smoke-record`, and `.do/app.dev.yaml` smoke component has no `http_port`/ingress route. Run → FAIL on dev. **Step 2–4:** Implement → PASS. **Step 5:** Verify (DO docs or a dev deploy) that a non-zero POST_DEPLOY exit fails the deployment and that private-domain reachability works from a job; adjust this task if not. Commit.

### Task 11: Homelab post-deploy trigger

**Files:** Modify `.github/workflows/deploy-homelab.yml` (new step after the `gate status` step at `:239`, before "Leave the tailnet" `:241`; condition `inputs.environment == 'staging'`; env `SMOKE_ENDPOINT=http://${VM_IP}:9100`, `SMOKE_API_KEY`; runs `scripts/smoke/run_and_record.py --env staging --strict` with `GITHUB_TOKEN` + `permissions: contents: write`; step failure marks the deployment check red but does not roll back); extend `scripts/workflow-tests` or add a workflow lint test asserting the step exists only for staging.

- [ ] **Step 1:** Write the workflow-structure test (parse YAML: step present, ordered between the two anchors, staging-guarded). **Step 2:** FAIL. **Step 3–4:** Implement → PASS. **Step 5:** Commit.

### Task 12: Agent tool

**Files:** Modify `services/xstockstrat-agent/app/tools.py` (new `smoke_checks(action: Literal["list","run","get_run"], ...)`, admin-gated via `_caller_access_scope(...) & 0x04`, registered only when `SMOKE_ENDPOINT` is set; HTTP via `httpx` with `x-smoke-key`), `services/xstockstrat-agent/CLAUDE.md` (MCP Tools table + env vars), `docs/runbooks/mcp-tools.md` (`### \`smoke_checks\`` section), `.do/app.dev.yaml` and `deploy/homelab/compose.yml` (agent env `SMOKE_ENDPOINT`, `SMOKE_API_KEY` for staging only); Test `services/xstockstrat-agent/tests/test_smoke_tool.py`

- [ ] **Step 1:** Tests: `test_tool_absent_when_smoke_endpoint_unset` (the 45-tool catalog and its parity tests unchanged), `test_tool_present_when_set`, `test_non_admin_is_permission_error`, `test_run_posts_ids_and_returns_run_id`, `test_key_header_sent_and_never_logged`. Keep `test_tools_endpoint.py` `_TOOL_COUNT = 45`.
- [ ] **Step 2–4:** Fail → implement → pass (`uv run pytest --cov=app --cov-fail-under=40`). The tool returns run records; committing them to `smoke-results` is the session's job, documented in the runbook section. **Step 5:** Commit.

### Task 13: Docs, governance and teardown

**Files:** Create `docs/runbooks/smoke-checks.md` (contract, catalog authoring rules for Project B, triggers, how to read `smoke-results`, PAT rotation, `smoke-results` ruleset), fill `services/xstockstrat-smoke/CLAUDE.md` (Role, Docker Build Pattern, Ports, Dependencies, Database, Config Keys Consumed, Environment Variables, Running Tests); Modify `docs/runbooks/CLAUDE.md` index, `docs/runbooks/inter-service-mtls-rollout.md:81-83`, `docs/patterns/header-propagation.md` (smoke caller identity note), root `CLAUDE.md` Context Guide row.

- [ ] **Step 1:** `scripts/check-context-map.sh` and the markdown/DRY checks pass. **Step 2:** Run `/context-forge:context-constitution refresh` scoped to the touched context files; if the plugin is unavailable, re-read each touched context file against the code and record both facts in the PR body. **Step 3:** Commit; open the integration PR to `main-dev`.

## Not in this plan

Project B (check authoring in `/sdd-execute`, part-splitting and gating); mutating-RPC phase; an on-demand GitHub workflow; identity-issued tokens; GitHub App token for the writer.
