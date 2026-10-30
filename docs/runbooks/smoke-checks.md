# Staging smoke checks

`xstockstrat-smoke` runs a catalog of named post-deploy checks on **staging only** (homelab staging and DO dev); it is
absent from `.do/app.yaml` and the production homelab render. Contract and constants → `services/xstockstrat-smoke/CLAUDE.md`.
Feature record → `docs/roadmap/features/280-smoke-check-runtime/`.

## Triggers

| Trigger | Mode | Where |
|---|---|---|
| DO dev `smoke-record` `POST_DEPLOY` job | record-only (exit 0 always) | `.do/app.dev.yaml` |
| Homelab staging deploy step, then the `record` job | strict (exit 1 on red or lost run) | `deploy-homelab.yml` (staging only; overlay `deploy/homelab/compose.smoke.yml`) |
| Staging agent `smoke_checks` tool (ADMIN) | on demand: `list`, `run`, `get_run` | `docs/runbooks/mcp-tools.md` § Staging-only tools |

An on-demand run through the agent returns the run file but does not commit it; only the two deploy triggers write to
`smoke-results`. A run already in progress answers 409 with `Retry-After` of at most 960 s (`RUN_LOCK_HOLD_S` 900 +
`CLEANUP_GRACE_MAX_S` 60); the trigger waits that long and the agent returns `{error: "run_in_progress", retry_after_s}`.

## Results

One immutable JSON file per run on the orphan `smoke-results` branch: `smoke-results/<env>/<UTC>-<run_id>.json`
(`<env>` is `homelab-staging` or `do-dev`; `<UTC>` is `%Y%m%dT%H%M%SZ`, so filename order is time order). Files are
`schema_version` 1 or 2 (`services/xstockstrat-smoke/schema/run-file.v{1,2}.json`); a run file lists every executed
check as a record (`PASS|FAIL|ERROR|TIMEOUT`, `check_hash`, `rpcs_invoked`, flat `evidence`; v2 adds
`writes_performed` and `cleanup`). A check is **pending** for `(check_id, check_hash, env)` until some run file of that env
holds a `PASS`; the default run set is exactly the pending checks, so an edited check (new hash) runs again and a
passed one is skipped.

### Reading a result (how Claude, or you, checks a deploy)

```bash
git fetch origin smoke-results
git ls-tree -r --name-only origin/smoke-results | grep '^smoke-results/homelab-staging/' | sort | tail -3
git show "origin/smoke-results:smoke-results/homelab-staging/<file>.json" | python3 -m json.tool
```

Look at `deployed_sha` (must be the SHA you shipped), then each `records[]` entry: `outcome` plus `evidence`.
The same run file is the `file.body` of `get_run` and the `smoke-run-<attempt>` artifact of the homelab workflow run.
A deploy with no new file on the branch means the run was lost (`SMOKE_RUN_LOST`, nothing committed, checks stay
pending) or the recorder failed (`SMOKE_RECORD_FAILED`); read the job log.

### Correcting a failure (the next part)

A failed attempt stays in its immutable file and the check stays pending, so fixing it is a normal PR: change the
check (a new `check_hash`) or the code under test, merge, and the next staging deploy re-runs exactly the pending
checks. Never edit or delete a run file on `smoke-results`; a passing run supersedes a failing one by existing.

## Local

`source scripts/mtls-dev-env.sh && docker compose up -d xstockstrat-smoke`; the API listens on `9110` (mutual TLS,
SAN allowlist `xstockstrat-agent`, `xstockstrat-smoke-trigger`). Tests: `cd services/xstockstrat-smoke && uv run pytest`.

## Wiring notes

- The `smoke-record` job runs `python -m app.trigger` from the smoke image (which installs `git`), so the trigger code
  and the DO spec must land together. It carries its own `MTLS_*` trigger leaf and `SMOKE_RESULTS_PAT`; the leaf
  (`xstockstrat-smoke-trigger`) is minted on each deploy by `scripts/mint-smoke-trigger-leaf.sh` from the CA the deploy
  already holds and is never in `gen-dev-certs.sh` `SERVICES`.
- Homelab: the deploy job ships the staging compose normalized (`name`/`networks` removed), runs the strict trigger,
  and uploads the new run file; the separate `record` job (`contents: write`, no tailnet secrets) pushes it with
  `GITHUB_TOKEN`. A red result fails the deploy job but leaves the release in place. Without the overlay file (older
  image tags) or for production, every smoke step is skipped.
- Phase-2 writes are off (`smoke.writes.enabled=false`) and need the portfolio-owner approval → `docs/runbooks/smoke-user.md`.

## External prerequisites (all PENDING; none are provisioned by this repo)

| # | Prerequisite | Owner | Needed by |
|---|---|---|---|
| 1 | GitHub secret `DEV_SMOKE_RESULTS_PAT`: fine-grained PAT confined by a ruleset to the `smoke-results` branch | repo admin | DO dev record job |
| 2 | Ruleset on `smoke-results` that lets `GITHUB_TOKEN` (homelab `record` job) and that PAT push, and blocks force-push and delete | repo admin | both recorders |
| 3 | GitHub secret `DEV_SMOKE_DB_PASSWORD` and the `xstockstrat_staging_smoke_ro` role in DO dev | DBA | DO dev DB checks |
| 4 | `SMOKE_DB_PASSWORD` in the staging `APP_ENV` and the `smoke_ro` role in the homelab database (`docs/runbooks/smoke-db-role.md`) | DBA / homelab operator | **before merge** — `compose.smoke.yml` requires it; missing blocks every homelab staging deploy |
| 5 | GitHub variable `SMOKE_BIND_ADDR` on the `staging` environment, equal to the VM tailnet address | homelab operator | **before merge** — the bind check and render fail without it, blocking every homelab staging deploy |
| 6 | Tailnet ACL `tag:ci` → VM:9110, and no other interface listening on 9110 | tailnet admin | homelab trigger |
| 7 | homelab-edge gate accepts the normalized shipped compose file (staging dry run) | homelab operator | homelab deploy |
| 8 | Smoke user created and `smoke.rpc.user_id` set (`docs/runbooks/smoke-user.md`) | operator (config admin) | RPC checks |
| 9 | Config migrations `035` and `036` applied after feature 264's `034` | DBA + service owner | startup config |
| 10 | Portfolio-owner approval of the write allowlist (only to enable writes) | portfolio owner | phase-2 writes |

## First-deploy proof checklist (record results in the feature's `context.md` before `launched`)

- [ ] ACL: the CI runner reaches VM:9110 and nothing else is listening there.
- [ ] A DO job reaches `${xstockstrat-smoke.PRIVATE_DOMAIN}:9110`; a failing `POST_DEPLOY` job's effect on the deployment is known.
- [ ] Both `smoke_ro` roles exist and the startup role check passes (no "db role not read-only" log).
- [ ] The agent → smoke mTLS hop works with the deployed leaves (`smoke_checks list` as ADMIN).
- [ ] The image carries `SMOKE_GIT_SHA` (`GET /checks` `deployed_sha` equals the deployed commit).
- [ ] The VM gate accepts the normalized shipped file with an unchanged project name.
- [ ] A run file with the deployed SHA lands on `smoke-results` from homelab and from DO dev; a forced red check fails the homelab deploy job and the DO job still exits 0.

## Troubleshooting

- `SMOKE_TRIGGER_FAILED` / `SMOKE_RUN_LOST` / `SMOKE_RECORD_FAILED` in the trigger log: record-only mode still exits 0; strict mode exits 1.
- 403 from the API: the client leaf SAN is outside the allowlist. Handshake failure: no client certificate or wrong CA.
- Every RPC check `ERROR` with "smoke.rpc.user_id unset": step 8 above.
- DB checks `ERROR` "db unavailable" or "db role not read-only": step 3/4 above and `docs/runbooks/smoke-db-role.md`.
