# xstockstrat-smoke — CLAUDE.md

Contract freeze for feature 280 (`smoke-check-runtime`). Everything below is a **contract
(implemented in later tasks)**; no service code exists yet. Design and rationale:
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

Authorization is a client-certificate SAN allowlist `{xstockstrat-agent, xstockstrat-smoke-trigger}`;
a platform leaf outside it gets 403 and nothing runs, a missing certificate fails the handshake.
Clients pin the server name `xstockstrat-smoke`. There is no shared API key and no `GetSecret` use.

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
```

Callers: `SMOKE_ENDPOINT` (`host:port`, HTTPS mTLS), `SMOKE_RESULTS_PAT` (DO job only),
`SMOKE_BIND_ADDR` (GitHub variable, staging). There is no `MTLS_SCOPE` and no `SMOKE_API_KEY`.
Mesh cert contract: `docs/patterns/inter-service-mtls.md`.

## Contracts

### HTTP API

- `GET /checks` returns `{deployed_sha, checks:[{id,feature,part,timeout_s,check_hash}], load_errors:[{module,error}]}`.
- `POST /runs {checks:[id, ...]}` returns 202 `{run_id}`, or 409 `{"error":"run_in_progress","retry_after_s":N}` with a `Retry-After` header.
- `GET /runs/{id}` returns `{status, records:[...], file:{path, body}}`, or 404 for an unknown or lost run.

### Check API

- `@check(id, feature, part, timeout_s=30)` over `async def run(ctx)`; `CHECKS_API_VERSION = 1`.
- `ctx.db.fetch` / `ctx.db.fetchval` (read-only transaction), `ctx.rpc.call(full_method: str, request)`, `ctx.evidence(key, scalar)`.
- `CheckFailure(msg)` marks a `FAIL`.
- `check_hash = sha256(CHECKS_API_VERSION || the check's own source)`.

### Run-file schema

One immutable file per check result at `smoke-results/<env>/<UTC>-<run_id>.json` on the orphan
`smoke-results` branch, validated by `schema/run-file.v1.json` (`additionalProperties: true`).
Fields: `schema_version, run_id, check_id, check_hash, feature, part, env, deployed_sha, outcome,
started_at, duration_ms, trigger, triggered_by, rpcs_invoked, evidence`. A check is pending for key
`(check_id, check_hash, env)` until a `PASS` is recorded.

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

## Fixture ownership

Fixtures created by phase-2 write checks are named with the `smoke-` prefix (`smoke-<run_id>`), which
is the smoke user's ownership marker (C-10c). Cleanup and the pre-check janitor touch only that prefix.

## Running Tests

```bash
uv sync --extra dev
uv run pytest --cov=app --cov-fail-under=40
```
