# Design: homelab-compose-deploy

**Created**: 2026-10-27
**Rounds**: 7 (quick mode; operator chose more rounds at each gate and lifted the 5-round cap on 2026-10-27; termination: approved)
**Approved by**: user @ 2026-10-27 (context.md, "Gate after round 7")
**Grounded in**: recon.md (incl. Addendum 2026-10-27, homelab-edge `origin/main` 488d0c4)

---

## Chosen Approach

Deploy the 12 services and a one-shot migrator to two homelab VMs (`xstockstrat`, `xstockstrat-staging`) through
homelab-edge's tailnet and forced-command gate (`templates/app-deploy/app-deploy.sh`), next to the unchanged DO deploys.
Internal only: no consumer surface changes (C-14); users reach the same UI and agent at the homelab URLs.

### 1. Compose stack — `deploy/homelab/compose.yml`
- Every image `${IMAGE_<SVC>:?}` (digest), every env-specific/secret value `${VAR:?}`; no `build:`, no volumes, not at
  the repo root (a root `compose.yml` shadows local `docker-compose.yml`).
- `x-common-env`: `APPLICATION_ENV`, **`TRADING_MODE` (required)**, `OTEL_ENABLED: "false"`, `MTLS_CA_CERT`.
- DB: direct `:5432` for config, ledger, identity, notify, ui, db-migrator; PgBouncer `:6432` + `DB_PGBOUNCER=true`
  for trading, portfolio, marketdata, indicators, ingest, analysis; `sslmode=require`; `DB_USER` and `DB_NAME` separate
  (recon Addendum E1). Direct `DB_POOL_MAX` total 7 (+ ledger's LISTEN conn = 8), pooled services set none (E5).
- Only ui `3000` and agent `9000` published. Healthchecks on every long-running service: Node `nc -z 127.0.0.1`,
  Python bash `/dev/tcp/127.0.0.1`, Go `["CMD","/app/service","healthcheck"]`; `x-hc` interval 5s / timeout 5s /
  retries 6 / start_period 120s (> the 90 s `WaitForSnapshot` cap, recon Codebase Map).
- ui `HOSTNAME: "0.0.0.0"` (next@15.5.27 binds `process.env.HOSTNAME`; Docker sets it to the container id — recon D2).
- Unread mirrored endpoint vars dropped (ledger/identity/indicators `NOTIFY_ENDPOINT`, notify `LEDGER_ENDPOINT`,
  ingest `IDENTITY_ENDPOINT`); ui/agent `JWT_SECRET` get their own `:?`.

### 2. Go health (trading, portfolio, marketdata)
`grpc.health.v1` registered next to reflection, after all blocking init (Listen follows init — recon Codebase Map);
`service healthcheck` argv mode calls `mtls.Probe` → `Check` on `127.0.0.1:$GRPC_PORT` with the service's own leaf and
SAN. No NOT_SERVING on shutdown (`GracefulStop` closes the listener).

### 3. Migrator — `scripts/migration-ahead-check.sh` (new) + `scripts/db-migrate.sh`
- Pure checker `<migrations_dir> <schema> <version_output>`: parses the version like `migration-dirty-guard.sh`
  (strip leading zeros, `[ -gt ]`, no octal), counts local `*.up.sql`. Exit 0 proceed; **10** clean DB newer than the
  image's files (skip, `[ahead]`); **4** dirty DB newer (refuse before any `force 0`); **2** unparsable dirty version,
  unparsable filename, or a numeric version with no up-files; 1 usage. Never echoes the raw version output.
- `db-migrate.sh` calls it via `bash` right after `ver=` and before the dirty `case`: `0` continue, `10` `return 0`,
  anything else `exit 1` (fail closed, incl. a missing checker).
- Shipped by `scripts/Dockerfile.migrate`, so DO's PRE_DEPLOY migrators get the same behaviour (operator, 2026-10-25).

### 4. Release pipeline — `.github/workflows/deploy-homelab.yml` (reusable + dispatch)
- Called by `deploy-dev.yml` (staging) and `deploy-prod.yml` (production, environment reviewers + deployment branches
  `main` only) beside the DO job, from the same `docker-build.yml` images (incl. `xstockstrat-db-migrator`), only while
  `vars.HOMELAB_DEPLOY_ENABLED == 'true'`. Job `defaults.run.shell: bash` (pipefail).
- Resolve step: early target guard, `GITHUB_RUN_ATTEMPT < 100`, manual `image_tag` must match `^[0-9a-f]{7,40}$`,
  every tag → digest (`^sha256:[0-9a-f]{64}$`).
- `scripts/homelab-release-env.sh <images_env> <out_env>` (reads `TARGET_ENV`, `APP_ENV`, `MTLS_CA`): the only
  target→values mapping — production `xstockstrat-production` / `xstockstrat_production` / `production` / `live`,
  staging `xstockstrat-staging` / `xstockstrat_staging` / `development` / `paper`; strips any pipeline-owned key from
  `APP_ENV` (`KEY=` or `KEY:`), writes pipeline values after it; `umask 077`, `mktemp -d` + `trap` (CA key never
  outlives the script); verifies the CA key matches its certificate before minting leaves with `gen-dev-certs.sh`.
- `scripts/homelab-render-check.sh <env> <target>`: `env -i` render; on failure prints only
  `required variable … is missing a value` lines (a dotenv parse error quotes the offending line, or for an unclosed
  quote the rest of the file — H1); then `deploy/homelab/render-assert.jq` over a value-free projection must print `[]`.
- `render-assert.jq`: independent oracle (target mapping restated deliberately); labels for service set, digests,
  build/volumes, healthchecks, APPLICATION_ENV/TRADING_MODE on all 12 apps, OTel, mTLS PEMs, pooled/direct DSN user +
  tail, pool budget, agent has no DB, ui HOSTNAME, published ports exactly ui 3000 / agent 9000. Never passes empty.
- Release name `${GITHUB_SHA::12}-$((RUN_ID*100+ATTEMPT))`; `TS_AUTHKEY_EXPIRES` required and validated.

### 5. CI
New `homelab` paths filter + `homelab-render` job (`ubuntu-24.04`, `bash scripts/homelab-render.test.sh`) in `ci-gate`;
`migrations` filter gains the checker; shell-lint runs `migration-ahead-check.test.sh`; the migrator-image step checks
`test -x` guard and `test -f` checker; `migration-rerun.sh` pass 4 (clean-ahead skip, dirty-ahead refuse) on a temp copy
with marketdata's highest file removed (computed, not hard-coded).

### 6. Monitoring (homelab-edge Gatus)
- UI follows feature 271: probes `http://<vm>:3000/trader/api/health` (in 271's exact `PUBLIC_HEALTH_PATHS`,
  `@AC-3`) with `client.ignore-redirect: true` (tailnet resolver/timeout restated) and conditions `[STATUS] == 200` +
  `[BODY].status == ok`. Until 271 is deployed the probe is red (307), never a false green (Gatus v5.37.0 source,
  context.md). xstockstrat adds no UI route.
- Agent: keeps `/.well-known/oauth-protected-resource` (liveness) + `[BODY].resource ==` that env's public `/agent`
  URL; compose healthcheck stays TCP.

### 7. homelab-edge
Policy `tag:ci → tag:xstockstrat-staging:22` (union with main's `tag:db:22`); gate optional 3rd arg wait timeout
(30–900, xstockstrat pins 300); gate filters `compose config` stderr the same way (H1b, exit 2); Gatus edits + tests;
verify.yml pins `/trader/api/health` 404 publicly; runbooks: §4.1 xstockstrat (names, SOPS password key, pipeline-owned
keys, single-line `APP_ENV`, staging `APP_URL`, `AGENT_PUBLIC_URL` derived, live-account warning, compose ≥ v2.17.0,
pre-deploy ordering + DB probe with public `postgres:16-alpine` `psql`), §3 production deployment branches `main` (H3),
§6 failure rows; decisions.md: rollback/schema, dotenv-quoting trap, Gatus-follows-redirects trap.

## Rejected Alternatives

- Replace DO now — rejected: operator chose parallel deploys.
- `grpc_health_probe` binary — rejected: needs PEM files; the binary self-probe reuses `mtls.ClientConfig`.
- Migrator tolerance only behind a homelab env flag — rejected: one semantics everywhere (operator).
- Down-migrate on rollback / migrate after health — rejected: destructive / new code may need the new schema.
- Dirty-and-ahead keeps feature-225's `force 0` — rejected: the old image cannot see a newer contract file (fail closed).
- Fold the ahead logic into `migration-dirty-guard.sh` — rejected: keeps the guard's contract untouched.
- Hand-written CI fixture `.env` — rejected: cannot catch a workflow that forgets a value; CI runs the real script.
- `TRADING_MODE` in operator `APP_ENV` — rejected: a second, typo-prone mode knob (@AC-9 @feature-196).
- `HOSTNAME` in the ui Dockerfile — rejected: changes the DO image (out of scope).
- Root `/api/health` route + a 9th `PUBLIC_HEALTH_PATHS` entry — rejected: duplicate static handler, two-way coupling with 271.
- Gatus probing `/auth/login` — rejected: proves a rendered page, not health.
- Deep agent health endpoint — rejected: per-call channels; backends have their own checks; restarting the agent fixes nothing.
- `APP_URL` assertion in `render-assert.jq` — rejected: duplicates edge hostnames; Gatus pins it.
- "APP_ENV line N" hint — rejected: stripped lines make N wrong; runbook gives a local repro.
- `enabled: false` on the UI probes until 271 — rejected: decisions.md "staging probes always on".

## Open Risks

- [ ] compose-go dotenv details (colon form, error text, PEM trailing newline) proven only by the render test's red/green — Step: render path.
- [ ] pgx / asyncpg with a hyphenated database name, container DNS to MagicDNS, pg_hba vs NAT'd source — live evidence, first staging deploy (runbook probe first).
- [ ] Gate rollback across a migration (AC-24 live part) — first live rollback.
- [ ] 271's `status:'ok'` body is pinned only by its e2e step, not a durable `@AC` — UI probes go red (safe) if it changes.
- [ ] DO PRE_DEPLOY depends on the image shipping the checker — guarded by the CI image-contents step.
- [ ] Two live stacks (homelab prod + DO prod) — runbook warning only; `trading.broker.paper` config still overrides the env default.
- [ ] Agent with bad-but-present mTLS or unreachable identity passes TCP + metadata — mitigated pre-deploy by render/CA checks.

## Constitution Rules Touched

- `C-01` — honored: every claim cites recon/source; unverifiable items labelled live evidence.
- `C-08`/`P-06` — honored: each code-bearing step is red-before-green (Go probe, checker, render test, gate test, Gatus test).
- `C-10` — honored: migrator change reaches every migrator (homelab + DO); Gatus test pins all four probes.
- `C-11` — honored: story → review → design before shipping; the pre-written WIP is recorded as an ordering deviation.
- `C-14` — honored: consumer surface None (internal).
- `C-15` — honored: AC-22..AC-40 each name a covering test or are marked live evidence.
- `C-16` — honored: no existing guarantee changed (below).
- `C-18` — honored: shared scripts (release env, render check) used by workflow and CI; no new UI handler.
- `P-03` — honored: every operator decision asked and recorded in context.md.
- `F-01` — honored: no migration file edited. `F-06` — honored: homelab budget 25/role documented (E5); DO pools unchanged.
- `F-07` — honored: no config value hardcoded; new values are deploy-time env.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1/2/4/5/6 @feature-210` (`docs/sdd/business-rules/platform.feature`) — probe uses the service's own leaf; render check requires all mTLS PEMs; per-deploy leaves from a per-env CA.
- PRESERVE `@AC-18/@AC-6/@AC-12/@AC-5 @feature-225` — dirty-not-ahead still reaches the unchanged guard; dirty-ahead refuses before `force 0` (stricter); no down migration runs.
- PRESERVE `@AC-9 @feature-196` — paper/live derived from the target environment by the pipeline; no operator knob.
- PRESERVE `@AC-7 @feature-147` (marketdata) — marketdata still reaches SERVING with no vendor credentials.
- PRESERVE `@AC-1..3 @feature-192` (trading) — health registered after the config snapshot; no new default path.
- PRESERVE `@AC-8 @feature-147` — no `MCP_AGENT_SECRET` in the new files.
- External dependency (not yet durable): 271 `@AC-3` `/trader/api/health` public — recorded in merge-order.md (prose) and 271's context.md.
