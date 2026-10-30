# Staging Smoke-Check Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A staging-only `xstockstrat-smoke` service (feature 280) that runs a catalog of named checks over an mTLS-only HTTPS API, records every attempt as a file on the `smoke-results` branch, and is triggered by a homelab post-deploy step, a DO `POST_DEPLOY` job and an admin-gated agent tool.

**Architecture:** One Python/Starlette service; checks are async modules baked into the image and run in-process; authorization is a SAN allowlist on the mTLS listener; the durable record is per-run JSON written by a stdlib trigger/recorder. Phase 1 = read-only DB and RPC reads; phase 2 = allowlisted watchlist writes behind a kill switch.

**Tech Stack:** Python 3.13/uv, Starlette + uvicorn 0.47.0 (pinned exactly), asyncpg, grpc.aio, httpx, pytest, ruff; Node/vitest (UI BFF); GitHub Actions, DO App Platform, homelab compose; protobuf options.

**Spec:** `docs/roadmap/features/280-smoke-check-runtime/design.md` (approved, authoritative), with `product-spec.md`, `acceptance.feature` (the `@AC-*` ids cited as `Covers:`), `recon.md` (incl. Addendum 2026-10-30) and `context.md` (operator sign-offs, accepted risks, first-deploy proof checklist). On any conflict, `design.md` then `acceptance.feature` win over this plan.

## Global Constraints

- Everything is commits on `claude/smoke-test-deployment-0f1z5j` (PR #1359 into `main-dev`); push after each task so CI runs on every head. No other branch, no step PRs.
- Python: 3.13, uv; run `uv lock` after any `pyproject.toml` change and commit `uv.lock`; ruff line length 100; `uv run pytest --cov=app --cov-fail-under=40`. Copy per-service patterns (ingest `app/mtls.py`, `app/config/watcher.py`, `tests/conftest.py`), do not import across services.
- Listener: HTTPS with `CERT_REQUIRED`, SAN allowlist `{xstockstrat-agent, xstockstrat-smoke-trigger}`, port `9110`; no shared key, no `GetSecret`; uvicorn pinned `==0.47.0` and the SAN protocol class passed explicitly.
- Env names (frozen): service `DATABASE_URL`, `SMOKE_ENV` ∈ {`homelab-staging`, `do-dev`}, `SMOKE_GIT_SHA` (baked at build; build fails without it), `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT`; callers `SMOKE_ENDPOINT` (`host:port`, HTTPS mTLS), `SMOKE_RESULTS_PAT` (DO job only), `SMOKE_BIND_ADDR` (GitHub variable, staging). No `MTLS_SCOPE`, no `SMOKE_API_KEY`.
- Run files: `smoke-results/<env>/<UTC>-<run_id>.json`, schema `schema/run-file.v1.json` (`additionalProperties: true`); `check_hash = sha256(CHECKS_API_VERSION ‖ the check's own source)`; pending key `(check_id, check_hash, env)`; only `PASS` clears it.
- Exit codes: strict mode exits 1 on a red result or a recorder failure; record-only mode always exits 0 and logs `SMOKE_RECORD_FAILED` / `SMOKE_RUN_LOST`; the watchdog exits 70 in strict mode and writes an ERROR run file and exits 0 in record-only mode.
- Config keys: `smoke.rpc.user_id` (migration `035`), `smoke.writes.enabled` (phase 2, `036`); config migration numbers are max+1 and must not precede feature 264's `034`.
- Staging-only: `.do/app.yaml` and the production homelab render are untouched/byte-identical; smoke is a staging overlay `deploy/homelab/compose.smoke.yml`; every overlay-dependent step is gated on staging AND the overlay file existing.
- `.sh` files: `#!/usr/bin/env bash`, bash 3.2-compatible. Comments state constraints only, ≤2 lines. Docs-only references in a new `CLAUDE.md` must point at existing files (`scripts/check-context-map.sh`).
- External actions that are NOT yours to take (record them, do not attempt): creating the PAT/secrets, homelab-edge changes (tailnet ACL, gate script, `smoke_ro` role), DBA role creation, tailnet/DO provisioning, approvals.

## Sandbox limits (verify what you can; mark the rest)

This sandbox has python/uv/node/openssl/git and local Postgres binaries are unverified, but **no Docker, protoc or buf**. Tasks say which ACs are proven here and which are deploy-time only (see the checklist in `context.md`). A step that needs a missing tool must be written, unit-tested as far as possible, and recorded in the ledger as `UNVERIFIED-HERE: <tool>`; it must not be skipped silently.

## Review Focus

- A non-allowlisted platform leaf, a missing certificate and a wrong-SAN server must each fail closed, with tests using real TLS and openssl-minted certs (not mocks).
- A check that blocks the event loop or times out must never leave the one-run lock held or a fixture behind; a lost run must leave its checks pending.
- A missing/invalid prerequisite (DB role, `smoke.rpc.user_id`, config) must degrade to per-check ERROR without making the container exit, while a missing `MTLS_*`/SAN hook must exit before binding.
- Production surfaces must be provably unchanged: production homelab render byte-identical, no smoke in `.do/app.yaml`, no unused smoke key material or env in production beyond the accepted shared-`SERVICES` leaf.
- Evidence and logs must never contain secrets, raw rows or PEMs; a placeholder rename/substitution must be proven by running the substitution, not by grep.

---

### Task 1 (S0): Contracts doc and run-file schema

**Files:** Create `services/xstockstrat-smoke/CLAUDE.md`, `services/xstockstrat-smoke/schema/run-file.v1.json`; Modify `docs/roadmap/features/merge-order.md` (one row: 280 merges after 264).

**Interfaces:** Produces the frozen contracts the later tasks and Project B consume: HTTP API (`GET /checks` → `{deployed_sha, checks:[{id,feature,part,timeout_s,check_hash}], load_errors:[{module,error}]}`; `POST /runs {checks:[id…]}` → 202 `{run_id}` / 409 `{"error":"run_in_progress","retry_after_s":N}` + `Retry-After`; `GET /runs/{id}` → `{status, records:[…], file:{path, body}}` or 404); check API (`@check(id, feature, part, timeout_s=30)` over `async def run(ctx)`; `ctx.db.fetch/fetchval`, `ctx.rpc.call(full_method:str, request)`, `ctx.evidence(key, scalar)`; `CheckFailure(msg)`; `CHECKS_API_VERSION = 1`); run-file fields `run_id, check_id, check_hash, feature, part, env, deployed_sha, outcome, started_at, duration_ms, trigger, triggered_by, rpcs_invoked, evidence`; env names, SAN names, exit codes and defaults (`RUN_LOCK_HOLD_S=900`, `LOOP_STALL_S=30`, evidence cap 4096) — all as in Global Constraints.

- [ ] **Step 1:** Write the CLAUDE.md sections (Role, Contracts, Env, Constants & defaults, Running Tests, Fixture ownership `smoke-` prefix) linking only existing docs; write the JSON Schema.
- [ ] **Step 2:** `bash scripts/check-context-map.sh` passes; `python3 -c "import json; json.load(open('services/xstockstrat-smoke/schema/run-file.v1.json'))"` passes; markdownlint config rules respected (`.markdownlint*`).
- [ ] **Step 3:** Commit `docs(smoke): freeze smoke-check contracts and run-file schema` and push.

### Task 2 (S1): Service core with CI registration

**Files:** Create `services/xstockstrat-smoke/{pyproject.toml,uv.lock,Dockerfile}`, `app/{__init__,main,mtls,tls_server,catalog,check_api,runner,policy,rpc,dbro,evidence,watchdog}.py` and the top-level check package `checks/`, `app/config/{__init__,watcher}.py`, `checks/example/pass_trivial.py`, `tests/{__init__,conftest}.py` and `tests/test_*.py`, `tools/lint_checks.py`; Modify `.github/workflows/ci.yml` (paths filter `:52-63`, python-lint matrix/`if` `:303-318`, python-test matrix/`if` `:350-373` with `coverage_threshold: 40`, and the Postgres install condition `:405-407`).

**Interfaces:**
- `tls_server.ALLOWED_SANS: frozenset[str]`; `tls_server.SanProtocol(H11Protocol)` overriding `connection_made`/`connection_lost`, `PEER_SAN: dict[tuple[str,int], str|None]`; `build_ssl_context(cert_pem:str,key_pem:str,ca_pem:str) -> ssl.SSLContext` (writes 0600 temp files, loads, unlinks); `san_gate(app) -> ASGIApp` returning 403 for a SAN outside the allowlist; `main.build_app(*, runner, catalog, deployed_sha) -> Starlette`.
- `catalog.load_catalog(package: str = "checks") -> Catalog(checks: dict[str, Check], load_errors: list[LoadError])` walking recursively, `Check(id, feature, part, timeout_s, run, check_hash)`.
- `runner.Runner(*, rpc_factory, db, env, deployed_sha, hold_s=RUN_LOCK_HOLD_S)` with `async start(ids: list[str], *, triggered_by: str) -> str` (raises `RunInProgress(retry_after_s)`) and `get(run_id) -> dict | None`; buffer keeps the last 50 runs.
- `policy.decide(full_method: str, *, descriptors, benign=BENIGN_READS, writes=None) -> Decision(allowed: bool, reason: str)`; `BENIGN_READS: dict[str, BenignRead]` empty in production code (test-only entry via a fixture); `BenignRead(side_effect: str, guard)`.
- `rpc.Rpc(*, user_id, trace_id, endpoints, channel_factory, policy)` with `async call(full_method, request, *, timeout=10.0)` and `.invoked: list[str]`; headers `x-user-id`, `x-access-scope` (admin bit never set), `x-trace-id`; refusal raises `MutatingRpcRefused(reason)` before a channel opens; `config.GetSecret` always refused.
- `dbro.ReadOnlyDb` lazy pool (`min_size=0`), `fetch`/`fetchval` only inside a read-only transaction with `SET LOCAL statement_timeout`; startup `assert_read_only_role()` that records a degraded reason instead of exiting.
- `watchdog.start(heartbeat, *, mode)`; `evidence.sanitize(dict) -> dict` (flat scalars, key + value-pattern redaction, strings truncated, ≤4096 bytes).

- [ ] **Step 1:** Write failing tests first (real TLS with openssl-minted CA/leaves via a `conftest` fixture, reproducing the round-3 spike): `test_agent_leaf_gets_200`, `test_trigger_leaf_gets_200` (AC-1), `test_no_client_cert_connection_fails_and_nothing_runs` (AC-3), `test_trading_leaf_gets_403_and_nothing_runs` (AC-25), `test_wrong_san_server_rejected_by_pinned_client` (AC-33), `test_refuses_to_start_without_mtls_material_naming_var` (AC-4), `test_tmpdir_empty_after_startup` (AC-40), `test_san_hook_not_installed_is_fatal` (AC-45), `test_load_error_listed_not_dropped` (AC-2), `test_ast_lint_rejects_blocking_call` (AC-42); runner: `test_outcomes_pass_fail_timeout` (AC-5), `test_second_run_409_with_retry_after` (AC-6), `test_hold_timeout_releases_lock` (AC-36), `test_lost_run_404` (AC-35 service half), `test_watchdog_exits_70_strict_and_error_file_record_only` (AC-39), `test_evidence_redaction_and_cap` (AC-7); DB (throwaway local Postgres, copy analysis `tests/conftest.py` `local_pg`, fails under `CI=true` instead of skipping): `test_select_passes_update_errors_sqlstate_25006` (AC-8), `test_statement_timeout_57014` (AC-29), `test_non_readonly_role_degrades_to_check_error_and_still_binds` (AC-41); policy/rpc with synthesized descriptors (`AddSerializedFile`): `test_annotated_read_allowed_and_audited_with_headers` (AC-9), `test_mutating_and_unannotated_refused_before_channel` (AC-10), `test_rpcs_invoked_in_call_order` (AC-31), `test_missing_user_id_errors_rpc_checks_not_db_checks` (AC-24), `test_benign_entry_refused_when_smoke_user_owns_broker_account` (AC-38, test-only entry).
- [ ] **Step 2:** `cd services/xstockstrat-smoke && uv sync --extra dev && uv run pytest -x` → FAIL (modules missing).
- [ ] **Step 3:** Implement to the signatures above. Pass `http=SanProtocol` explicitly (not `uvicorn[standard]` autodetect); boot order: verify `SMOKE_GIT_SHA` and MTLS PEMs → build SSL context (unlink temp files) → config snapshot (90 s, `client_id` prefix `smoke-`) → start watchdog → serve; the Dockerfile has `ARG SMOKE_GIT_SHA` + `RUN test -n "$SMOKE_GIT_SHA"` + `ENV SMOKE_GIT_SHA=$SMOKE_GIT_SHA`. `checks/example/pass_trivial.py` is the one example check; check modules live in the top-level package `checks/` (module names like `checks.broken.bad_syntax`, AC-2), the check API (`@check`, `CheckFailure`, `CheckContext`, `CHECKS_API_VERSION`) lives in `app/check_api.py`, and `app/__init__.py` stays empty so `python -m app.trigger` runs with the stdlib only. Pin `grpcio`/`protobuf` to at least the minimum of `packages/proto/gen/python` (cross-check every Python `uv.lock`, ledger `fails.md:388`).
- [ ] **Step 4:** `uv run pytest --cov=app --cov-fail-under=40`, `uv run ruff check . && uv run ruff format --check .`, `uv lock --check`; also run `scripts/check-duplication.sh` and handle the DRY guard for the intentional per-service copies per its config.
- [ ] **Step 5:** Commit `feat(smoke): service core with mTLS listener, runner and read policy` and push; confirm CI ran the new Python lint/test jobs on that head.

Covers: AC-1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 24, 25, 29, 31, 33, 35, 36, 38, 39, 40, 41, 42, 45.

### Task 3 (S2): Trigger, recorder and pending computation

**Files:** Create `services/xstockstrat-smoke/app/trigger/{__init__,__main__,client,pending,record}.py` (stdlib only), `tests/test_trigger_*.py`.

**Interfaces:** (run files are PER RUN with a `records[]` array — see `schema/run-file.v1.json`; the reader flattens `records[]` and attaches the run's `env`) `pending.pending(catalog: list[dict], recorded: list[dict], env: str) -> list[str]` where `recorded` are flattened records; `record.record_path(env: str, started_at: str, run_id: str) -> str`; `record.write_run_file(out_dir, body: dict) -> Path` validating against `schema/run-file.v1.json` (jsonschema as a dev dependency only); `record.push_with_retry(repo_dir, paths, *, attempts=5)` (orphan `smoke-results` created on first push, fetch + rebase retry, never force); CLI `python -m app.trigger --mode strict|record-only --endpoint host:port --env LABEL [--checks id,id] [--out DIR] [--git-remote URL]` using `ssl.SSLContext(check_hostname=True)` with the httpx-style name pin `xstockstrat-smoke` implemented with stdlib `http.client` + `server_hostname`; on 409 retry with `Retry-After` capped at `RUN_LOCK_HOLD_S`.

- [ ] **Step 1:** Failing tests with a local bare repo and two clones: `test_run_file_path_and_fields` (AC-11), `test_pending_excludes_pass_same_hash_env` (AC-12), `test_fail_then_pass_both_retained` (AC-30), `test_edited_check_pending_again` (AC-32), `test_concurrent_pushes_each_once_linear_history` (AC-13), `test_triggered_by_recorded` (AC-34), `test_strict_exit_1_on_red_and_on_push_failure` / `test_record_only_exit_0_logs_failure` (AC-44), `test_lost_run_logs_SMOKE_RUN_LOST_and_commits_nothing` (AC-35 caller half), `test_cert_name_mismatch_rejected` (AC-33 client half).
- [ ] **Step 2–4:** Run → FAIL; implement; run pytest/ruff/`uv lock --check` again.
- [ ] **Step 5:** Commit `feat(smoke): trigger client, recorder and pending computation`; push.

Covers: AC-11, 12, 13, 30, 32, 34, 35, 44.

### Task 4 (S3): Config migration 035

**Files:** Create `services/xstockstrat-config/migrations/<max+1>_smoke_rpc_user_id.{up,down}.sql` (expected `035`); Modify `docs/patterns/config-governance.md` (registered-keys log, newest first after `:111`).

**Interfaces:** Seeds namespace `smoke`, key `smoke.rpc.user_id`, `string`, default `''`, one row each for `staging` and `production`, global (`user_id` NULL), `ON CONFLICT … DO NOTHING` (copy `033_ledger_stream_resolve_timeout.up.sql:8-17`); down deletes both rows.

- [ ] **Step 1:** Check feature 264's `034` status (`ls services/xstockstrat-config/migrations`, `git fetch origin main-dev`); if `034` is absent, still number `035` but record the merge-order gate in the ledger (no environment may apply `035` before `034`).
- [ ] **Step 2:** Add a replay test or run `scripts/migration-rerun.sh` if Postgres is available; otherwise `UNVERIFIED-HERE: postgres for replay` and rely on CI.
- [ ] **Step 3:** Commit `feat(config): seed smoke.rpc.user_id`; push.

Covers: AC-24 (runtime), C-07.

### Task 5 (S4): Certs, compose, docker-build, DO dev, root docs

**Files:** Modify `scripts/gen-dev-certs.sh` (`SERVICES` `:28-31`, literal 12 at `:11,87`), `scripts/mtls-dev-env.sh` (pair list `:31-34`, `:46`), `scripts/mtls-provision.sh` (`:6,104`), `.github/workflows/deploy.yml` (literals `:71,89,103,165`; mint the trigger leaf from the CA it holds into a separate dir using a new shared `scripts/mint-smoke-trigger-leaf.sh` (bash 3.2, reused by Task 8); substitute `YOUR_DEV_SMOKE_TRIGGER_MTLS_{CERT,KEY}` and `YOUR_DEV_SMOKE_RESULTS_PAT` before the per-service loop; extend the leftover-placeholder check at `:193`; declare `SMOKE_RESULTS_PAT` under `workflow_call.secrets`), `.github/workflows/deploy-dev.yml` (pass it), `.github/workflows/docker-build.yml` (14th matrix entry with `build-args: SMOKE_GIT_SHA=${{ github.sha }}`), `docker-compose.yml` (smoke block, only `:-` defaults), `.do/app.dev.yaml` (component `internal_ports: [9110]`, no `http_port`, mTLS envs with `type: SECRET` key; `jobs:` gains a `POST_DEPLOY` job using the smoke image, `python -m app.trigger --mode record-only`, its own trigger-leaf envs and the PAT env), root `CLAUDE.md` (Service Registry, Inter-Service Dependencies, Connection Pool Budget direct total 8 → 9, Key File Paths, `SMOKE_ENDPOINT` amendment), `docs/patterns/ci-overview.md`, `docs/patterns/docker-build.md`, `docs/patterns/inter-service-mtls.md:82`, `docs/runbooks/inter-service-mtls-rollout.md:34,64`, `docs/runbooks/smoke-checks.md`, `docs/runbooks/smoke-db-role.md` (+ `services/xstockstrat-smoke/db/smoke_readonly_role.sql`); Create `tests/test_wiring_*.py` (pyyaml structure tests).

**Interfaces:** `smoke` leaf exists in `SERVICES`; the trigger leaf is never in `SERVICES`; `.do/app.yaml` contains no smoke component; the DO job envs carry no `YOUR_*` leftover after the substitution.

- [ ] **Step 1:** Failing tests: spec structure (`test_do_dev_smoke_internal_only_no_ingress`, AC-18; `test_do_prod_spec_has_no_smoke`, AC-17 clause; `test_post_deploy_job_record_only_and_envs`, AC-15 structure) and a script test that runs the `deploy.yml` placeholder substitution over `.do/app.dev.yaml` with throwaway certs and asserts no `YOUR_DEV_` leftovers and that `…_SMOKE_TRIGGER…` was not clobbered by the `…_SMOKE` replacement.
- [ ] **Step 2–4:** Implement, then run `./scripts/gen-dev-certs.sh` in a temp `CERTS_DIR` and verify 13 service leaves; `docker compose config -q` is `UNVERIFIED-HERE: docker` (CI runs it).
- [ ] **Step 5:** Commit `feat(smoke): platform wiring for local, DO dev and certs`; push.

Covers: AC-15 (structure), AC-17 (DO half), AC-18, C-10, F-06.

### Task 6 (S5a): UI BFF non-POST 405 guard

**Files:** Modify `services/xstockstrat-ui/src/lib/bffShared.ts` (`createDispatch`, `:118-130`); Create `services/xstockstrat-ui/src/lib/__tests__/bffShared.test.ts` (vitest).

**Interfaces:** `dispatchConnect(req)` returns `new Response(null, {status: 405, headers: {Allow: 'POST'}})` for any method other than `POST`, before the handler lookup.

- [ ] **Step 1:** Failing vitest: `GET` to `/trader/api/…`, `/insights/api/…`, `/config-ui/api/…` returns 405 with `Allow: POST` and calls no handler; `POST` still dispatches (AC-37).
- [ ] **Step 2–4:** `cd services/xstockstrat-ui && pnpm install --frozen-lockfile && pnpm vitest run src/lib/__tests__/bffShared.test.ts` FAIL → implement → PASS; run the UI lint/typecheck commands from its `CLAUDE.md`.
- [ ] **Step 5:** Commit `fix(ui): reject non-POST requests at the Connect BFF`; push. Record `UNVERIFIED-HERE` if pnpm cannot install offline.

Covers: AC-37, FR-11.

### Task 7 (S5b): Proto annotations, buf policy, real-stub test

**Files:** Modify `packages/proto/<svc>/v1/<svc>.proto` for the pure-read RPCs listed in `recon.md` § RPC classification (add `option idempotency_level = NO_SIDE_EFFECTS;`), `packages/proto/buf.yaml` (add `breaking: {use: [FILE], except: [RPC_SAME_IDEMPOTENCY_LEVEL]}`), regenerated `packages/proto/gen/**`; Create `services/xstockstrat-smoke/tests/test_real_stubs.py`.

**Interfaces:** every annotated method resolves to `NO_SIDE_EFFECTS` from the real `_pb2` descriptors; `AppendEvent`, `GetFundamentals`, `config.GetSecret` and every READ-SIDE-EFFECT/privileged RPC stay unannotated; no field, enum or number changes.

- [ ] **Step 1:** Failing test importing the real stubs (AC-43).
- [ ] **Step 2:** Annotate; run `./scripts/buf-gen.sh` (needs the codegen toolchain: `docs/runbooks/codegen-toolchain-host-setup.md`). **If buf/protoc/Docker are unavailable here, stop this task after writing the annotations, `buf.yaml` and the test, record `UNVERIFIED-HERE: codegen host` and leave stub regeneration and the proto-freshness/lint/breaking CI proof to a codegen host — do not hand-edit generated stubs.**
- [ ] **Step 3:** With stubs regenerated: `buf lint`, `buf breaking`, smoke `uv run pytest`, and re-run the grpcio-vs-`uv.lock` cross-check for every Python service.
- [ ] **Step 4:** Commit annotations, `buf.yaml` and stubs separately; push.

Covers: AC-43, FR-12.

### Task 8 (S6): Homelab staging overlay, render checks, deploy steps

**Files:** Create `deploy/homelab/compose.smoke.yml`, `deploy/homelab/testdata/` fixtures; Modify `.github/workflows/deploy-homelab.yml` (digest resolver `:86-98` target-aware; smoke step between `gate status` `:239` and "Leave the tailnet" `:241`; shipped-file step; separate `record` job), `scripts/homelab-render-check.sh:13`, `scripts/homelab-render.test.sh` (`:31-35,51,75,79` + new mutations), `scripts/homelab-release-env.sh` (`SMOKE_BIND_ADDR` only for staging, added to the `owned` regex at `:34`), `deploy/homelab/render-assert.jq` (`smoke` class, `smoke-in-production`, read-only DSN user `xstockstrat_staging_smoke_ro`, port 5432, `DB_PGBOUNCER` unset, pool `"1"`, healthcheck `start_period` ≥ the config wait, restart/logging, port 9110 bound to `$bind`, per-target port list, kept out of the direct-pool sum).

**Interfaces:** production renders from `compose.yml` alone (13 services, ports 3000 and 9000); staging renders `compose.yml` + `compose.smoke.yml` (14 services, 9110 bound to `SMOKE_BIND_ADDR`); the shipped staging file is `docker compose -f compose.yml -f compose.smoke.yml config --no-interpolate --format json | jq 'del(.name,.networks)'` and still has 14 `${IMAGE_` references; overlay steps run only when `staging && [ -f deploy/homelab/compose.smoke.yml ]`; `record` job: `needs: deploy`, `if: always() && <smoke-ran output>`, `permissions: contents: write`, no tailnet/SSH secrets; deploy job stays `contents: read`; trigger leaf minted from `MTLS_CA` inside the smoke step (re-exported there) by the shared `scripts/mint-smoke-trigger-leaf.sh` that Task 5 creates.

- [ ] **Step 1:** Failing tests: a Docker-free `render-assert.jq` run over fixture JSON for production and staging (`test_prod_render_has_no_smoke`, `test_staging_render_has_smoke_ro_dsn_pool_1`, `test_smoke_port_bound_to_bind_addr_not_wildcard`), workflow-structure tests (`test_no_smoke_step_for_production` AC-14, `test_smoke_step_strict_exit_1_on_red` AC-26 structure, `test_overlay_steps_gated_on_file_existence` AC-47, `test_record_job_permissions` AC-48, `test_shipped_file_has_no_name_or_networks_and_14_image_refs` AC-46 using fixture JSON).
- [ ] **Step 2–4:** Implement; run `bash scripts/homelab-render.test.sh` only if Docker exists, else the fixture-based tests plus `UNVERIFIED-HERE: docker compose`; keep `compose.yml` byte-identical (assert with `git diff --exit-code deploy/homelab/compose.yml`).
- [ ] **Step 5:** Commit `feat(smoke): homelab staging overlay, render assertions and trigger steps`; push.

Covers: AC-14, 17, 26, 46, 47, 48.

### Task 9 (S7): Agent `smoke_checks` tool

**Files:** Modify `services/xstockstrat-agent/app/tools.py` (inside `register_tools` `:362`), `services/xstockstrat-agent/CLAUDE.md` (tool table + env + uncounted note), `docs/runbooks/mcp-tools.md` (new "Staging-only tools" section with `### \`smoke_checks\``), `docker-compose.yml`, `.do/app.dev.yaml` and `deploy/homelab/compose.smoke.yml` (agent `SMOKE_ENDPOINT` for staging only), `docs/roadmap/features/…/acceptance` promotion is NOT done here; Create `services/xstockstrat-agent/app/smoke_client.py` (httpx with an `ssl.SSLContext` loading the agent's leaf, `sni_hostname='xstockstrat-smoke'`, temp files unlinked), `tests/test_smoke_tool.py`.

**Interfaces:** `smoke_checks(action: Literal["list","run","get_run"], checks: list[str] | None = None, run_id: str | None = None) -> dict`; registered only when `os.environ.get("SMOKE_ENDPOINT")` is truthy at `register_tools` time; `_require_admin` before any HTTP; the six tool-count surfaces stay at 45.

- [ ] **Step 1:** Failing tests: `test_absent_when_endpoint_unset_and_count_45` (AC-16, `monkeypatch.delenv`), `test_present_when_set`, `test_non_admin_permission_error_before_http`, `test_run_posts_ids_and_returns_run_id`, `test_name_pinning_rejects_wrong_san_server` (AC-33 agent half), `test_agent_validates_run_file_against_schema_copy` plus `test_schema_copy_matches_smoke_schema`.
- [ ] **Step 2–4:** FAIL → implement → `uv run pytest --cov=app --cov-fail-under=40`, ruff, `uv lock --check`.
- [ ] **Step 5:** Commit `feat(agent): staging-only smoke_checks tool`; push.

Covers: AC-16, @AC-9 @feature-183.

### Task 10 (S8): Phase 2 — scoped writes

**Files:** Modify `services/xstockstrat-smoke/app/{policy,rpc,runner,check_api}.py`; Create `app/fixtures.py`, `checks/_reference/watchlist_roundtrip.py`, `services/xstockstrat-config/migrations/<max+1>_smoke_writes_enabled.{up,down}.sql`, `tests/test_write_*.py`; Modify `docs/patterns/config-governance.md`, `services/xstockstrat-smoke/CLAUDE.md`, `docs/runbooks/smoke-user.md` (create).

**Interfaces:** `policy.decide(..., writes=WritePolicy(enabled: bool, env: str, allowlist=SCOPED_WRITES))` allows an unannotated RPC only if allowlisted ∧ `enabled` ∧ `env in {"homelab-staging","do-dev"}`; `SCOPED_WRITES` = portfolio `CreateWatchlist`, `UpdateWatchlist`, `AddWatchlistSymbols`, `RemoveWatchlistSymbols`, `DeleteWatchlist` with a request predicate "no `strategy_id` bindings"; `ctx.fixture(hint) -> "smoke-<run_id>-<hint>"`, `ctx.on_cleanup(async_fn)` (own deadline; grace ≥ Σ deadlines; cleanup runs after PASS/FAIL/ERROR/TIMEOUT), `CheckSpec.janitor`; records gain `writes_performed`, `cleanup` (add `schema/run-file.v2.json` with `schema_version: 2`; never edit v1; the trigger validates by `schema_version`); `PRIVILEGED` denylist is a test oracle only.

- [ ] **Step 1:** Failing tests: `test_allowlisted_write_allowed_under_every_guard_and_audited` (AC-19), `test_write_refused_when_flag_off` (AC-20), `test_write_refused_outside_staging_label` (AC-27), `test_privileged_rpc_refused_even_when_enabled` (AC-28), `test_cleanup_runs_after_timeout` (AC-21), `test_failed_cleanup_is_error_and_keeps_original_evidence` (AC-22), `test_janitor_sweeps_leftovers_before_body` (AC-23), `test_privileged_rpcs_never_in_allowlist`.
- [ ] **Step 2–4:** FAIL → implement → pytest/ruff; the portfolio-owner allowlist approval is recorded in `context.md` as pending/granted (not yours to grant).
- [ ] **Step 5:** Commit `feat(smoke): phase-2 scoped writes behind a kill switch`; push.

Covers: AC-19, 20, 21, 22, 23, 27, 28.

### Task 11: Runbooks, teardown audit and handoff

**Files:** Modify `docs/runbooks/smoke-checks.md`, `docs/runbooks/smoke-db-role.md`, `docs/runbooks/smoke-user.md`, `docs/runbooks/CLAUDE.md` (index rows), root `CLAUDE.md` Context Guide row, `docs/roadmap/features/280-smoke-check-runtime/context.md` (deviations, `UNVERIFIED-HERE` list, first-deploy proof status).

- [ ] **Step 1:** Run `/context-forge:context-constitution refresh` scoped to the touched context files; if the plugin is unavailable, re-read each touched context file against the code and record both facts in the PR body (root `CLAUDE.md` Teardown).
- [ ] **Step 2:** `bash scripts/check-context-map.sh`, `python3 scripts/ledger-guard.py --own-slug smoke-check-runtime --base origin/main-dev --head HEAD`.
- [ ] **Step 3:** Update PR #1359's description with the slice summary, the external-prerequisite checklist and the `UNVERIFIED-HERE` items; do not merge.

## Not in this plan

Project B (check authoring in `/sdd-execute`, part-splitting and gating); platform-wide/privileged writes; system and admin identities; an on-demand GitHub workflow; soft-cleanup write classes (formulas, strategies, offline accounts); enabling any BENIGN_READS entry; any homelab-edge, tailnet, DBA or secret provisioning.
