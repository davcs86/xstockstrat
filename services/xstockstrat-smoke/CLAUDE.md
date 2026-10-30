# xstockstrat-smoke — CLAUDE.md

Contract freeze for feature 280 (`smoke-check-runtime`). The service core (listener, catalog,
runner, read policy) landed in slice S1; the trigger/recorder lands in S2. Design and rationale:
`docs/roadmap/features/280-smoke-check-runtime/design.md`.

## Role

Staging-only Python service that runs a catalog of named post-deploy smoke checks baked into its
image and returns per-check outcomes. Checks read the platform through a read-only database role and
read-only RPCs as a dedicated non-admin smoke user. It is never deployed to production.

## Language

Python 3.13 (asyncio, Starlette on uvicorn, pinned `uvicorn==0.47.0`)

## Docker Build Pattern

Python pattern — follows the ingest Dockerfile pattern (see `docs/patterns/docker-build.md`), plus
`ARG SMOKE_GIT_SHA` with a build-time `RUN test -n "$SMOKE_GIT_SHA"` and `ENV SMOKE_GIT_SHA=$SMOKE_GIT_SHA`,
so an image built without the SHA fails to build.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| HTTPS (mutual TLS) | `9110` | Smoke API; not published in production |

The listener is TLS with `CERT_REQUIRED` against the platform CA, built from the service's own `MTLS_*` PEMs.
Authorization is a client-certificate SAN allowlist `{xstockstrat-agent, xstockstrat-smoke-trigger}`;
a platform leaf outside it gets 403 and nothing runs, a missing certificate fails the handshake.
Clients pin the server name `xstockstrat-smoke`. There is no shared API key and no `GetSecret` use.

The SAN hook is a subclass of uvicorn's internal `H11Protocol` (overriding `connection_made`), passed
**explicitly** to uvicorn: `http='auto'` (e.g. with `uvicorn[standard]`) would pick another protocol and
bypass it. A startup self-check exits before binding if the hook is not installed. Because the hook
depends on an internal class, uvicorn is pinned to exactly `==0.47.0`; an upgrade must pass the
hook-bypass test first.

## Dependencies

| Service | Via | Purpose |
|---|---|---|
| xstockstrat-config | gRPC (`WatchConfig`) | Config snapshot at startup (90 s wait) |
| Any backend | gRPC (read-only, allowlisted) | Check RPCs as the smoke user |

## Database

Direct connection (`:25060`) as a dedicated read-only role (`xstockstrat_<env>_smoke_ro`), pool max 1.
Startup asserts not-superuser, no write privilege and `default_transaction_read_only=on`; failure
degrades to per-check `ERROR` rather than exiting.

## Config Keys Consumed

| Key | Type | Default | Notes |
|---|---|---|---|
| `smoke.rpc.user_id` | string | `''` | Smoke user for every RPC; empty yields `ERROR`, never `PASS` |
| `smoke.writes.enabled` | bool | `false` | Phase 2 only |

## Environment Variables

```text
DATABASE_URL=                  # read-only role DSN
SMOKE_ENV=homelab-staging      # homelab-staging | do-dev
SMOKE_GIT_SHA=                 # baked at build; build fails without it
MTLS_CERT= MTLS_KEY= MTLS_CA_CERT=   # PEM strings; refuse to start if absent
CONFIG_ENDPOINT=xstockstrat-config:50060
<SERVICE>_ENDPOINT=            # e.g. LEDGER_ENDPOINT; an RPC to a service without one is ERROR
```

`SMOKE_ENV` also selects the watchdog mode: `homelab-staging` is strict, `do-dev` is record-only.

Callers: `SMOKE_ENDPOINT` (`host:port`, HTTPS mTLS), `SMOKE_RESULTS_PAT` (DO job only),
`SMOKE_BIND_ADDR` (GitHub variable, staging). There is no `MTLS_SCOPE` and no `SMOKE_API_KEY`.
Mesh cert contract: `docs/patterns/inter-service-mtls.md`.

## Contracts

### HTTP API

- `GET /checks` returns `{deployed_sha, checks:[{id,feature,part,timeout_s,check_hash}], load_errors:[{module,error}]}`.
- `POST /runs {checks:[id, ...]}` returns 202 `{run_id}`. An unknown check id returns 404 listing the unknown ids; an empty list returns 400; a run already in progress returns 409 `{"error":"run_in_progress","retry_after_s":N}` with a `Retry-After` header, where `N` is at most `RUN_LOCK_HOLD_S`.
- `GET /runs/{id}` returns `{status, records:[...], file:{path, body}}` or 404 for an unknown or lost run. `status` is `running` or `done`. Each `records[]` item is exactly one record of the run file (see below), in execution order. `file.path` is the run-file path and `file.body` is the complete run-file body; both are present once `status` is `done`.

### Check API

- `@check(id, feature, part, timeout_s=30)` over `async def run(ctx)`; `CHECKS_API_VERSION = 1`.
- `ctx.db.fetch` / `ctx.db.fetchval` (read-only transaction), `ctx.rpc.call(full_method: str, request)`, `ctx.evidence(key, scalar)`.
- `CheckFailure(msg)` marks a `FAIL`.
- `check_hash` is the lowercase hex sha256 (64 chars) over the UTF-8 bytes of `f"{CHECKS_API_VERSION}\n"` followed by the check function's own source text (`inspect.getsource`).

### Run-file schema

One immutable file **per run** (not per check): `smoke-results/<env>/<UTC>-<run_id>.json` on the orphan
`smoke-results` branch, validated by `schema/run-file.v1.json` (`additionalProperties: true`).
`<UTC>` is the run start time formatted `%Y%m%dT%H%M%SZ`, so lexicographic filename order equals time
order within an environment.

- Run-level fields: `schema_version` (const 1), `run_id`, `env` (`homelab-staging` | `do-dev`), `deployed_sha`, `started_at`, `trigger`, `triggered_by` (peer SAN), `records`.
- `records` holds one record per check executed in the run, with `check_id, check_hash, feature, part, outcome` (`PASS|FAIL|ERROR|TIMEOUT`), `started_at`, `duration_ms`, `rpcs_invoked` (call order), `evidence` (flat scalars).

A check is pending for key `(check_id, check_hash, env)` until a record with outcome `PASS` exists in any
run file of that env; failed attempts stay in their files.

### SAN allowlist and exit codes

- SAN allowlist: `xstockstrat-agent`, `xstockstrat-smoke-trigger`.
- Strict mode (homelab): exit 1 on a red result or recorder failure; the watchdog exits 70.
- Record-only mode (DO): always exit 0, logging `SMOKE_RECORD_FAILED` / `SMOKE_RUN_LOST`; the watchdog writes an `ERROR` run file and exits 0.

### Constants

| Name | Value | Meaning |
|---|---|---|
| `RUN_LOCK_HOLD_S` | `900` | Upper bound on one run-lock hold |
| `LOOP_STALL_S` | `30` | Event-loop stall before the watchdog acts |
| Evidence cap | `4096` bytes | Flat scalar dict; long strings truncated, secrets redacted |
| `DB_STATEMENT_TIMEOUT_MS` | `5000` | `SET LOCAL statement_timeout` on every check query |

## Fixture ownership

Fixtures created by phase-2 write checks are named with the `smoke-` prefix (`smoke-<run_id>`), which
is the smoke user's ownership marker (C-10c). Cleanup and the pre-check janitor touch only that prefix.

## Running Tests

DB tests start a throwaway PostgreSQL from local binaries and fail instead of skipping under `CI=true`.

```bash
uv sync --extra dev
uv run pytest --cov=app --cov-fail-under=40
python -m tools.lint_checks checks   # blocking-call / escape-hatch lint over check modules
```
