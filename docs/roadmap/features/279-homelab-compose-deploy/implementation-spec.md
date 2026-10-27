# Implementation Spec: homelab-compose-deploy

**Status**: `done`
**Created**: 2026-10-27
**Feature**: `docs/roadmap/features/279-homelab-compose-deploy/feature.md`
**Total Steps**: 16
**Feature Branch**: `feature/homelab-compose-deploy` (work landed on the harness branch `ccr-9bdbcd90-kgj5ev`, based on `main-dev`;
homelab-edge companion on its own branch of the same name)

---

## Execution Summary

**This spec is retroactive.** The implementation session (context.md, "Session 2026-10-27 — implementation") built the
feature straight from design.md's line-level steps and moved the status to `code-completed` without an
implementation spec. This spec records the steps as they were built, in red-before-green order, and cites the shipped
code (`path:line`, commits `98c78d3`, `e733297`, `f42ae86`, `89d96d3`; homelab-edge `5ff45c9`, `9305497`). Every step
is `done`; the `**Verification**` commands are the ones the code passes today (re-run 2026-10-27, see Deviation Log).

Order: Go health (Steps 1–4) → migrator ahead/dirty-ahead check (Steps 5–7) → release `.env`, compose file, render
check (Steps 8–11) → deploy workflows, CI wiring and xstockstrat docs (Steps 12–14) → homelab-edge companion
(Steps 15–16). Each code-bearing group starts with its test step, written so it fails against the pre-implementation tree.

**Consumer surface:** the product spec marks it **None** (internal deploy target and readiness probe; users reach the
same UI and agent at new URLs). No UI or Agent step is required (C-14), by decision, not omission.

**Docker-unavailable trap** (`fails.md` remove-x-mcp-secret-header / frontend-reverse-proxy family): every verification
here runs without a Docker daemon (`docker compose config`, fake-docker gate test, Go unit tests). None is a live-boot
proof. The first staging deploy is the live-boot proof (design.md Open Risks).

### Scenario Coverage (C-15)

| Scenario | Step(s) | How |
|---|---|---|
| AC-1, AC-2, AC-3, AC-4, AC-8, AC-9, AC-13, AC-16, AC-22, AC-23, AC-28, AC-29, AC-31, AC-32, AC-35, AC-36 | 8 | `scripts/homelab-render.test.sh` cases 1–9 |
| AC-5 | 15, 8 | homelab-edge `app-deploy-test.sh` (unhealthy release fails + rolls back) + Step 8's dependency-chain check (every service waits on `db-migrator`) |
| AC-6, AC-7, AC-21 | 1 | `TestProbeServing` / `TestProbeNotServing` / `TestProbeNothingListening` in each Go service |
| AC-17 | 1 | Line-order check: `net.Listen` comes after `WaitForSnapshot` in each `main.go` (structural) |
| AC-24, AC-25, AC-26, AC-27 | 5, 7 | `scripts/migration-ahead-check.test.sh` (offline) + `scripts/migration-rerun.sh` pass 4 (CI, real DB) |
| AC-30 | 7 | CI migrator-image step `test -x` guard / `test -f` checker |
| AC-10, AC-11, AC-12, AC-18, AC-19, AC-20 | 13 | Static workflow assertions (grep) + live evidence on the first run |
| AC-34, AC-38 | 13 | Live evidence, checked once by hand (scenario says so) |
| AC-14, AC-15, AC-33, AC-37, AC-39, AC-40 | 15 | homelab-edge `policy-test.sh`, `app-deploy-test.sh`, `gatus-config-test.py`, `verify.yml` |

All 40 scenarios are covered.

## Step Dependencies

- Step 1 [test] covers Steps 2, 3, 4 [service] (one identical change per Go service; the test was written first).
- Step 5 [test] covers Step 6 [service]; Step 7 [test] needs Step 6 (pass 4 runs the new checker against a real DB).
- Step 8 [test] covers Steps 9, 10, 11 [service]; Step 8 needs Step 11's `render-assert.jq` path to exist before it can go green.
- Step 12 [service] needs Steps 10 and 11 (the workflow calls both scripts) and Step 6 (the `db-migrator` image it deploys).
- Step 13 [test] covers Step 12. Step 14 [test] wires Steps 5, 7, 8 into CI and needs them.
- Step 15 [test] covers Step 16 [service] (homelab-edge, separate repository and PR).
- External, non-blocking: the UI Gatus probes stay red (307) until feature 271 deploys its exact `PUBLIC_HEALTH_PATHS`
  (`docs/roadmap/features/merge-order.md:277`, prose note; 271 `context.md:548`).

---

### Step 1 — test: Go healthcheck probe tests (trading, portfolio, marketdata)

**Status**: `done` (commit `98c78d3`)
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/mtls/mtls_test.go` — modify
- `services/xstockstrat-portfolio/internal/mtls/mtls_test.go` — modify
- `services/xstockstrat-marketdata/internal/mtls/mtls_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — paper-only dev invariant, no change to order execution; `xstockstrat-portfolio` owner — no change to P&L paths; `xstockstrat-marketdata` owner — no change to ingestion

**Codebase Evidence**:
- Reused helpers (recon Patterns to REUSE): `newCA` `mtls_test.go:32`, `setEnv` `:81` (same lines in all three services).
- Added: `probeServer` `:244` (a `health.NewServer()` with `SetServingStatus("", status)` behind `ServerConfig()`),
  `TestProbeServing` `:263`, `TestProbeNotServing` `:276`, `TestProbeNothingListening` `:289` (dials `127.0.0.1:1`).
- Single consumer per test file → inline test data is C-13 compliant (no `internal/testdata/` home created).

**TDD**: `red-green required` — red: `Probe` undefined before Step 2–4.

**Covers**: `AC-6, AC-7, AC-17, AC-21`

**Instructions**:
1. In each service's `internal/mtls/mtls_test.go`, add `probeServer(t, status)` and the three `TestProbe*` tests
   above, presenting the service's own leaf (`root.leaf(t, svcName)`) to a server built from `ServerConfig()`.
2. AC-21 asserts a refused dial on an unused port; the scenario's per-service port (50051/50052/50053) is the runtime
   case of the same code path (`Probe` dials `127.0.0.1:$GRPC_PORT`, Steps 2–4).
3. AC-17 is structural: the health service is registered on the server that is only created after init, so nothing
   listens before init completes. It is checked by line order (Verification), not by a unit test.

**Verification**:
```bash
for s in trading portfolio marketdata; do
  (cd services/xstockstrat-$s && GOWORK=off go test ./internal/mtls/ -run Probe -count=1 -v | grep -E '^(--- |ok)') || exit 1
done
# AC-17: Listen follows WaitForSnapshot in every main.go
for s in trading portfolio marketdata; do f=services/xstockstrat-$s/cmd/server/main.go
  w=$(grep -n 'WaitForSnapshot' $f | head -1 | cut -d: -f1); l=$(grep -n 'net.Listen' $f | head -1 | cut -d: -f1)
  [ "$w" -lt "$l" ] || { echo "$s: Listen before init"; exit 1; }; done
# coverage (CI threshold 40%) + lint, per service
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && \
  COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && \
  GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && \
  go tool cover -func=coverage.out | grep '^total:' && GOWORK=off golangci-lint run --modules-download-mode=mod); done
```

---

### Step 2 — service: trading `grpc.health.v1` + `healthcheck` mode

**Status**: `done` (commit `98c78d3`)
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/mtls/mtls.go` — modify
- `services/xstockstrat-trading/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-trading` owner — health registered only after broker/DB/config init; no order-execution change

**Codebase Evidence**:
- `Probe(ctx, addr, serverName)` `internal/mtls/mtls.go:75` reuses `ClientConfig(serverName)` `:61` (SAN-pinned, no
  insecure path), calls `healthpb.NewHealthClient(conn).Check`, errors unless `SERVING`.
- `main.go:34` argv short-circuit `if len(os.Args) > 1 && os.Args[1] == "healthcheck" { os.Exit(healthcheck()) }`,
  before any init; `healthcheck()` `:171` probes `"127.0.0.1:"+config.LoadFromEnv().GRPCPort` as `"xstockstrat-trading"` (3 s).
- Init order (recon Codebase Map): `WaitForSnapshot` `:75` → … → `net.Listen` `:129` → `RegisterHealthServer(grpcServer, health.NewServer())` `:151`.
- Upstream `google.golang.org/grpc/health` was already a dependency (recon: `mtls_test.go:110`).

**TDD**: `red-green required` (Step 1 is the red).

**Covers**: —

**Instructions**: Add `Probe` to `internal/mtls/mtls.go`; in `main.go` add the `healthcheck` argv branch at the top of
`main`, `func healthcheck() int`, and `healthpb.RegisterHealthServer(grpcServer, health.NewServer())` next to reflection.
No NOT_SERVING on shutdown (`GracefulStop` closes the listener; design.md §2). Header propagation: no new outbound
per-request call (self-probe on `127.0.0.1`). Trading-domain constraints: broker, order type, fill handling and the
`TRADING_MODE` gate are unaffected by this step (paper/live mapping lives in Step 10).

**Verification**: Step 1's commands for `xstockstrat-trading`; `grep -n 'RegisterHealthServer\|os.Args\[1\] == "healthcheck"' services/xstockstrat-trading/cmd/server/main.go`.

---

### Step 3 — service: portfolio `grpc.health.v1` + `healthcheck` mode

**Status**: `done` (commit `98c78d3`)
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/mtls/mtls.go` — modify
- `services/xstockstrat-portfolio/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — health service + healthcheck mode only; no P&L path change

**Codebase Evidence**: `Probe` `internal/mtls/mtls.go:75`; argv branch `main.go:31`; `WaitForSnapshot` `:60` →
`net.Listen` `:80` → `RegisterHealthServer` `:102`; `healthcheck()` `:122` probes as `"xstockstrat-portfolio"`.

**TDD**: `red-green required` (Step 1 is the red).

**Covers**: —

**Instructions**: Same change as Step 2, for portfolio.

**Verification**: Step 1's commands for `xstockstrat-portfolio`.

---

### Step 4 — service: marketdata `grpc.health.v1` + `healthcheck` mode

**Status**: `done` (commit `98c78d3`)
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/mtls/mtls.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — health service + healthcheck mode only; no ingestion change

**Codebase Evidence**: `Probe` `internal/mtls/mtls.go:75`; argv branch `main.go:38`; `WaitForSnapshot` `:67` →
`net.Listen` `:173` → `RegisterHealthServer` `:195`; `healthcheck()` `:262` probes as `"xstockstrat-marketdata"`.
PRESERVE `@AC-7 @feature-147`: a missing vendor secret only WARNs (`main.go:74-89`, recon), so marketdata reaches SERVING
on a fresh homelab.

**TDD**: `red-green required` (Step 1 is the red).

**Covers**: —

**Instructions**: Same change as Step 2, for marketdata.

**Verification**: Step 1's commands for `xstockstrat-marketdata`.

---

### Step 5 — test: migrator ahead-check structural test

**Status**: `done` (commit `e733297`)
**Service**: `scripts/` (migrator tooling; also DO's PRE_DEPLOY migrator)
**Files**:
- `scripts/migration-ahead-check.test.sh` — create

**Reviewers**: Platform Lead — new deploy target; DBA — run-order compliance with `scripts/db-migrate.sh`

**Codebase Evidence**:
- Cases `migration-ahead-check.test.sh:40-60`: (a) clean at highest → 0; (b) `10` vs `009` → 10 (decimal, not octal);
  (c) `8 (dirty)` → 0; (d) `10 (dirty)` → 4; (e) `garbage dirty` → 2; (f) fresh DB → 0; (g)/(h) only `000`; (i) no
  up-files + numeric → 2; (j) no up-files + fresh → 0; (k) unparsable filename → 2; (m) no credential printed, recovery
  text names the literal `$DATABASE_URL` (`:66-68`).
- Pattern reused: `scripts/migration-dirty-guard.test.sh` (throwaway migrations dirs, no DB).

**TDD**: `red-green required` — red: the checker does not exist before Step 6.

**Covers**: `AC-25, AC-26, AC-27`

**Instructions**: Build throwaway `services/xstockstrat-x/migrations` trees per case and assert each exit code above.

**Verification**: `bash scripts/migration-ahead-check.test.sh && shellcheck scripts/migration-ahead-check.test.sh`

---

### Step 6 — service: `migration-ahead-check.sh` + `db-migrate.sh` call + migrator image

**Status**: `done` (commit `e733297`)
**Service**: `scripts/` (homelab and DO PRE_DEPLOY migrators)
**Files**:
- `scripts/migration-ahead-check.sh` — create
- `scripts/db-migrate.sh` — modify
- `scripts/Dockerfile.migrate` — modify

**Reviewers**: Platform Lead — one migrator semantics for homelab and DO; DBA — dirty-contract guard (feature 225) left unchanged, dirty-ahead refused before `force 0`

**Codebase Evidence**:
- Checker exit codes `migration-ahead-check.sh`: usage `:8` (1), unparsable dirty `:18` (2), fresh DB `:24` (0),
  unparsable filename / no up-files `:40`,`:47` (2), not ahead `:49` (0), clean-ahead `:53` (10), dirty-ahead `:62` (4).
- `db-migrate.sh:68` `ver=…`; `:70-76` `ahead=0; bash …/migration-ahead-check.sh "$dir" "$schema" "$ver" || ahead=$?`
  then `0) ;; 10) return 0 ;; *) exit 1 ;;`, placed **before** the dirty `case` at `:77` (guard `:78`, `force 0` `:80`).
- `Dockerfile.migrate:14` `COPY scripts/migration-ahead-check.sh /repo/scripts/migration-ahead-check.sh` (next to the guard `:13`).
- DO PRE_DEPLOY uses this image (`.do/app.yaml:669`, `.do/app.dev.yaml:671`; product-spec Out of Scope, operator 2026-10-25).

**TDD**: `red-green required` (Step 5 is the red).

**Covers**: —

**Instructions**: Parse the version like `migration-dirty-guard.sh` (strip leading zeros, `[ -gt ]`), never echo the raw
version output; call the checker via `bash` so a missing exec bit cannot change DO behaviour; any non-0/10 result fails
closed. F-01 honoured: no migration file edited.

**Verification**: `bash scripts/migration-ahead-check.test.sh && shellcheck scripts/migration-ahead-check.sh scripts/db-migrate.sh && grep -n 'migration-ahead-check' scripts/db-migrate.sh scripts/Dockerfile.migrate`

---

### Step 7 — test: real-DB rerun pass 4 + migrator image contents

**Status**: `done` (commit `e733297`; CI wiring in `89d96d3`)
**Service**: `scripts/`, `.github/workflows/ci.yml`
**Files**:
- `scripts/migration-rerun.sh` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: DBA — rollback against an ahead schema; Platform Lead — CI gate

**Codebase Evidence**:
- `migration-rerun.sh:193` "pass 4": copies the scripts to a temp tree with marketdata's highest file removed (`:196`,
  top version computed, not hard-coded, `:214`); clean-ahead must log `[ahead] marketdata is at version $top` (`:223`);
  dirty-ahead checker must return 4 (`:230-232`) and old `db-migrate.sh up` must return 1 (`:236-238`).
- `ci.yml:638` shell-lint runs `migration-ahead-check.test.sh`; `ci.yml:670` migrator image check
  `test -x /repo/scripts/migration-dirty-guard.sh && test -f /repo/scripts/migration-ahead-check.sh`; `migrations`
  filter gains the checker (`ci.yml:75`); job `migration-rerun` `ci.yml:642` is in `ci-gate` (`:809`).

**TDD**: `red-green required` — pass 4 fails against the pre-Step-6 `db-migrate.sh` (old migrator crashes on `readUp`, recon D3).

**Covers**: `AC-24, AC-25, AC-30`

**Instructions**: Add pass 4 to `migration-rerun.sh` with the `|| rc=$?` form; extend the CI image-contents step and filters.

**Verification**: CI job `migration-rerun` (needs Postgres; runs in CI only, never in `/sdd-execute`); locally
`shellcheck scripts/migration-rerun.sh && grep -n 'pass 4' scripts/migration-rerun.sh && grep -n 'migration-ahead-check' .github/workflows/ci.yml`.

---

### Step 8 — test: homelab release `.env` + render test

**Status**: `done` (commit `f42ae86`)
**Service**: `deploy/homelab/`, `scripts/`
**Files**:
- `scripts/homelab-render.test.sh` — create

**Reviewers**: Platform Lead — published ports exactly 3000/9000, inter-service graph; Security — no value in any output, 0600 `.env`, per-env CA

**Codebase Evidence** (`scripts/homelab-render.test.sh`):
- Runs the real `homelab-release-env.sh` under `env -i` (`build()` `:43`) and the real render check (`check()` `:47`);
  gitleaks-safe dummies (`hex=0011…eeff` `:24`), probe value `SECRETPROBE` `:25`.
- Case 1 staging (`:58-77`): 0600 mode, trading pooled DSN + `DB_PGBOUNCER`, config direct DSN without it, all 12 apps
  `development`/`paper`, ui `HOSTNAME=0.0.0.0`, `OTEL_ENABLED=false`, 13 services, no build/volumes, digests only,
  healthchecks on all but `db-migrator`, ports `agent=9000`, `ui=3000`.
- Case 2 production (`:80-84`); case 3 APP_ENV overrides incl. `export` and `KEY: value` (`:87-100`); case 4 mTLS leaf
  verify/SAN/key match/CA byte-identical (`:103-110`); case 5 missing `DB_PASSWORD` (`:113-115`); case 6 bad target /
  malformed CA / mismatched CA key, nothing left behind, no value printed (`:118-136`); case 7 oracle mutations (`:139-163`);
  case 8 `BAD!KEY` (`:166-170`); case 9 unclosed quote (`:173-177`).

**TDD**: `red-green required` — red: scripts and `render-assert.jq` absent before Steps 9–11.

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5 (dependency chain, below), AC-8, AC-9, AC-13, AC-16, AC-22, AC-23, AC-28, AC-29, AC-31, AC-32, AC-35, AC-36`

**Instructions**: As above. AC-5's compose half (every service waits on the migrator) is a structural check: only
`xstockstrat-config` names `db-migrator` with `service_completed_successfully` (`compose.yml:53-55`) and every other
service reaches config through `service_healthy` dependencies. The render test does not assert this chain today; the
Verification below does (see Deviation Log D-2).

**Verification**:
```bash
bash scripts/homelab-render.test.sh   # needs docker compose (CLI only, no daemon), jq, python3, openssl
# AC-5 compose half: every service reaches db-migrator through depends_on (prints true; false if a link is dropped)
docker compose -f deploy/homelab/compose.yml config --no-interpolate --format json 2>/dev/null \
 | jq -e '.services as $s | def reach($k): [$s[$k].depends_on // {} | keys[]] as $d | ($d | index("db-migrator")) != null or any($d[]; reach(.));
   [$s | keys[] | select(. != "db-migrator") | select(reach(.) | not)] == []'
```

---

### Step 9 — service: `deploy/homelab/compose.yml`

**Status**: `done` (commits `98c78d3`, `f42ae86`)
**Service**: `deploy/homelab/` (deploys all 12 services + `db-migrator`, no service code change)
**Files**:
- `deploy/homelab/compose.yml` — create

**Reviewers**: Platform Lead — port exposure (only 3000/9000), dependency graph; `xstockstrat-trading` owner — `TRADING_MODE` required, paper on staging

**Codebase Evidence**:
- `x-common-env` `:4` with `TRADING_MODE: ${TRADING_MODE:?…}` `:6` (recon D1) and `OTEL_ENABLED: "false"` `:7`.
- `x-db-direct` `:11-12` (`:5432`, `sslmode=require`, separate `DB_USER`/`DB_NAME`); `x-db-pooled` `:14-15` (`:6432`).
- `db-migrator` `:32` (`restart: "no"`); config depends on it with `service_completed_successfully` `:53-55`.
- Direct `DB_POOL_MAX`: config 2 `:48`, ledger 1 `:68`, identity 2 `:89`, notify 1 `:108`, ui 1 `:278` (= 7, +1 ledger
  LISTEN = 8, homelab-edge sizes 25/role, recon E5); pooled services set none. F-06 honoured; DO pools unchanged.
- Go healthchecks `["CMD", "/app/service", "healthcheck"]` `:135`, `:154`, `:219`; ui `HOSTNAME: "0.0.0.0"` `:280`
  (recon D2), ports `"3000:3000"` `:282`, agent `"9000:9000"` `:314`.
- Not at the repo root (a root `compose.yml` would shadow `docker-compose.yml`).

**TDD**: `red-green required` (Step 8 is the red).

**Covers**: —

**Instructions**: Every image `${IMAGE_<SVC>:?}`, every env-specific/secret value `${VAR:?}`; no `build:`, no
volumes; `x-hc` start_period 120 s (> the 90 s `WaitForSnapshot` cap); unread mirrored endpoint vars dropped (design §1).
Docker Compose ↔ DO parity: `docker-compose.yml` and `.do/app*.yaml` are unchanged by design (product-spec Out of Scope);
the homelab `TRADING_MODE` value comes from Step 10 (staging `paper`, production `live`), matching DO dev `paper` / prod `live`.

**Verification**: `bash scripts/homelab-render.test.sh && grep -n 'TRADING_MODE' docker-compose.yml .do/app.dev.yaml .do/app.yaml deploy/homelab/compose.yml`

---

### Step 10 — service: `scripts/homelab-release-env.sh` + `scripts/homelab-mtls-env.py`

**Status**: `done` (commits `98c78d3`, `f42ae86`)
**Service**: `scripts/`
**Files**:
- `scripts/homelab-release-env.sh` — create
- `scripts/homelab-mtls-env.py` — create

**Reviewers**: Security — CA key never outlives the script, no value printed, 0600; `xstockstrat-trading` owner — production `live` / staging `paper` derived from the target only

**Codebase Evidence**:
- `umask 077` `:5`; required inputs `:13`; the only target mapping `case "${TARGET_ENV:-}"` `:15-19` (production
  `xstockstrat-production`/`xstockstrat_production`/`production`/`live`; staging `xstockstrat-staging`/`xstockstrat_staging`/`development`/`paper`).
- `mktemp -d` + `trap 'rm -rf "$certs" "$out.tmp"' EXIT` `:29-30`; CA key ↔ cert check `:40-45` before minting;
  reuses `gen-dev-certs.sh` `:47` (recon Patterns to REUSE).
- Pipeline-owned key strip `owned=` `:48` ending `[=:]` (compose-go `KEY: value` form, optional `export`); pipeline
  values written after APP_ENV `:49-55`; atomic `mv` `:56`.
- `homelab-mtls-env.py` emits double-quoted `\n`-escaped PEM lines; refuses a character dotenv would reinterpret (`:30`).

**TDD**: `red-green required` (Step 8 is the red).

**Covers**: —

**Instructions**: As above (design §4).

**Verification**: `bash scripts/homelab-render.test.sh && shellcheck scripts/homelab-release-env.sh && python3 -m py_compile scripts/homelab-mtls-env.py`

---

### Step 11 — service: `scripts/homelab-render-check.sh` + `deploy/homelab/render-assert.jq`

**Status**: `done` (commit `f42ae86`)
**Service**: `scripts/`, `deploy/homelab/`
**Files**:
- `scripts/homelab-render-check.sh` — create
- `deploy/homelab/render-assert.jq` — create

**Reviewers**: Security — a dotenv parse error quotes `.env` content (H1), output keeps only variable names; Platform Lead — oracle restates the target mapping on purpose

**Codebase Evidence**:
- `homelab-render-check.sh:13` `env -i` render; `:15-19` on failure prints only `required variable … is missing a value`
  lines, else "details suppressed"; `:20-24` `jq … -f render-assert.jq` must print exactly `[]`.
- `render-assert.jq` projects values away first (`project` `:14-20`), then emits labels: `target`, `services` (13 exact),
  `image:`, `build-or-volumes:`, `healthcheck:`, `application-env:`, `trading-mode:`, `otel:`, `mtls:`, `pooled:`,
  `direct:`, `pool-budget` (direct total ≤ 7, missing counts 99), `pool-budget:<pooled>`, `agent-db`, `ui-hostname`, `ports`.

**TDD**: `red-green required` (Step 8 is the red).

**Covers**: —

**Instructions**: As above. Never passes an empty or non-object input (a non-object projects to `{}` → `services` label).

**Verification**: `bash scripts/homelab-render.test.sh && shellcheck scripts/homelab-render-check.sh`

---

### Step 12 — service: deploy workflows (`deploy-homelab.yml`, callers, image matrix)

**Status**: `done` (commits `98c78d3`, `89d96d3`)
**Service**: `.github/workflows/`
**Files**:
- `.github/workflows/deploy-homelab.yml` — create
- `.github/workflows/deploy-dev.yml` — modify
- `.github/workflows/deploy-prod.yml` — modify
- `.github/workflows/docker-build.yml` — modify

**Reviewers**: Platform Lead — new deploy target beside DO; Security — secrets from 1Password or GitHub environment secrets only, never in logs or summary

**Codebase Evidence**:
- `deploy-homelab.yml`: `workflow_call` `:6` + `workflow_dispatch` `:16` (environment choice, `image_tag`);
  `runs-on: ubuntu-24.04` `:43`; `environment: ${{ inputs.environment }}` `:45`; `shell: bash` `:58`.
- Resolve step `:62-78`: `GITHUB_RUN_ATTEMPT < 100` `:68`, `image_tag` `^[0-9a-f]{7,40}$` `:70`, `not found` `:77`,
  digest `^sha256:[0-9a-f]{64}$` `:78`.
- Secret source `:85-105`; summary `S_<NAME>` = `1password`/`github`/`MISSING` `:139-143`; `"$n is in neither 1Password
  nor the GitHub secrets"` `:154`; `TS_AUTHKEY_EXPIRES` required + parsed `:159-166`.
- `homelab-release-env.sh` `:174`, `homelab-render-check.sh` `:178`; tailnet join `--hostname
  "gha-${APP_NAME}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"` `:188-197`; release name
  `${GITHUB_SHA::12}-$((GITHUB_RUN_ID * 100 + GITHUB_RUN_ATTEMPT))` `:213`; gate `deploy` `:218`; "Leave the tailnet" `:222`.
- Callers: `deploy-dev.yml:65-73` "Deploy to homelab staging", `deploy-prod.yml:64-72` "Deploy to homelab production",
  both `needs: [prepare, build-images]`, `if: vars.HOMELAB_DEPLOY_ENABLED == 'true'`, `secrets: inherit`.
- `docker-build.yml:50-51` matrix entry `xstockstrat-db-migrator` / `scripts/Dockerfile.migrate`.
- Transport/secret/tailnet steps copied from homelab-edge `templates/app-deploy/deploy.yml` with its pins (recon REUSE).

**TDD**: `N/A (workflow YAML; behaviour proven by Step 13's static checks and live evidence on the first run)`

**Covers**: —

**Instructions**: As above (design §4). DO jobs (`deploy:`) unchanged and independent.

**Verification**: `actionlint .github/workflows/deploy-homelab.yml .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml .github/workflows/docker-build.yml` (local; not a CI job here) and Step 13.

---

### Step 13 — test: workflow assertions and live-evidence checklist

**Status**: `done` (static part); live part pending the first deploy (see Deviation Log D-3)
**Service**: `.github/workflows/`
**Files**: none (verification only)

**Reviewers**: Platform Lead — deploy gating; Security — summary prints sources, not values

**Codebase Evidence**: Step 12's line references.

**TDD**: `N/A (no executable harness for GitHub Actions jobs in this repo; scripts/workflow-tests covers merge-train/sdd-batch only)`

**Covers**: `AC-10, AC-11, AC-12, AC-18, AC-19, AC-20, AC-34, AC-38`

**Instructions**: Static assertions below cover the code side of each scenario. Live evidence, recorded once in
context.md after the first runs: AC-11 (a `main-dev` push with the variable unset skips the homelab job), AC-18
(production waits for approval), AC-19 (manual run summary), AC-20 (ephemeral node leaves), AC-34 (GitHub rejects a
non-`main` production dispatch), AC-38 (runbook `psql` probe from the VM, homelab-edge runbook §4.1).

**Verification**:
```bash
w=.github/workflows/deploy-homelab.yml
grep -q 'not found; was docker-build.yml run' $w                                  # AC-10
grep -c "HOMELAB_DEPLOY_ENABLED == 'true'" .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml  # AC-11/18: 1 each
grep -q "|| 'MISSING'" $w && grep -q 'is in neither 1Password nor the GitHub secrets' $w   # AC-12
grep -q 'environment: \${{ inputs.environment }}' $w                              # AC-18/34 (reviewers + branch rule live in GitHub)
grep -q 'workflow_dispatch:' $w && grep -q '\^\[0-9a-f\]{7,40}\$' $w              # AC-19
grep -q 'gha-${APP_NAME}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}' $w && grep -q 'name: Leave the tailnet' $w  # AC-20
```

---

### Step 14 — test: CI wiring for the offline tests + xstockstrat docs

**Status**: `done` (commit `89d96d3`; docs also in `98c78d3`, `8575a33`)
**Service**: `.github/workflows/ci.yml`, `docs/`
**Files**:
- `.github/workflows/ci.yml` — modify
- `docs/patterns/ci-overview.md` — modify
- `docs/patterns/docker-build.md` — modify
- `docs/patterns/database.md` — modify
- `docs/patterns/inter-service-mtls.md` — modify
- `docs/context-constitution.md` — modify
- `docs/roadmap/features/merge-order.md` — modify (prose note)
- `docs/roadmap/features/271-fix-ui-transport-hardening/context.md` — modify (operator-approved note)

**Reviewers**: Platform Lead — CI gate completeness

**Codebase Evidence**:
- `ci.yml:80-84` `homelab` paths filter (`deploy/homelab/**`, `scripts/homelab-*`, `scripts/gen-dev-certs.sh`,
  `deploy-homelab.yml`); job `homelab-render` `:782-793` (`ubuntu-24.04`, `bash scripts/homelab-render.test.sh`) in
  `ci-gate` `:811`, reported `:831`.
- Docs: `ci-overview.md:21` (job), `:50-60` (deploy table + homelab paragraph); `docker-build.md:510`, `:539-542`,
  `:566-568` (Go `/app/service healthcheck`); `database.md:92` (ahead check, DO + homelab); `inter-service-mtls.md:88-90`
  (homelab CA path); `context-constitution.md:54` PLAT-N2; `merge-order.md:277-283`; 271 `context.md:548-552`.

**TDD**: `N/A (CI wiring and docs; the wired tests are Steps 5, 7, 8)`

**Covers**: `AC-30` (CI image-contents step, with Step 7)

**Instructions**: As above. Teardown: re-read each touched doc against the code (context.md records this was done by
hand; context-forge plugin unavailable).

**Verification**: `grep -n 'homelab-render\|homelab:' .github/workflows/ci.yml && grep -n 'homelab' docs/patterns/ci-overview.md docs/patterns/docker-build.md docs/patterns/database.md docs/patterns/inter-service-mtls.md docs/context-constitution.md`

---

### Step 15 — test: homelab-edge gate, policy and Gatus tests (separate repository)

**Status**: `done` (homelab-edge commits `5ff45c9`, `9305497`)
**Service**: homelab-edge (`/home/user/homelab-edge`, its own PR)
**Files** (homelab-edge):
- `scripts/app-deploy-test.sh` — modify
- `scripts/gatus-config-test.py` — modify
- `.github/workflows/verify.yml` — modify

**Reviewers**: Platform Lead — gate behaviour, monitoring; Security — gate never echoes `.env` content

**Codebase Evidence** (homelab-edge):
- `app-deploy-test.sh:38-44` unhealthy release fails (exit 1) and `current` rolls back; `:49` default wait 120 s; `:51-54`
  third argument `300` → `--wait-timeout 300`; `:56`, `:58` below-30 / non-numeric rejected with exit 2; `:17`, `:61-66`
  render error with `SECRETPROBE` never echoed.
- `gatus-config-test.py:51-52` UI probes at `:3000/trader/api/health`; `:62` `ignore-redirect` true; `:66-69` agent
  `[BODY].resource ==` each environment's public `/agent` URL.
- `verify.yml:68` public edge paths incl. `/trader/api/health` expected 404.
- Policy tests in `policy/policy.hujson:71` (`tag:ci` accepts `tag:xstockstrat-staging:22`, denies `:3000`, `:9000`, `tag:db:6432`).

**TDD**: `red-green required` (written before the gate/Gatus edits in Step 16).

**Covers**: `AC-5, AC-14, AC-15, AC-33, AC-37, AC-39, AC-40`

**Instructions**: As above. AC-40 runs in `verify.yml` against the live edge.

**Verification** (in `/home/user/homelab-edge`): `bash scripts/app-deploy-test.sh && python3 scripts/gatus-config-test.py && bash scripts/policy-test.sh` (policy test needs the pinned headscale binary).

---

### Step 16 — service: homelab-edge gate, policy, Gatus, runbooks (separate repository)

**Status**: `done` (homelab-edge commits `5ff45c9`, `9305497`)
**Service**: homelab-edge
**Files** (homelab-edge):
- `policy/policy.hujson` — modify
- `templates/app-deploy/app-deploy.sh` — modify
- `roles/stack/templates/gatus-config.yaml.j2` — modify
- `docs/runbooks/deploy-compose-app.md` — modify
- `docs/runbooks/home-side.md` — modify
- `docs/decisions.md` — modify

**Reviewers**: Platform Lead — staging-only SSH grant, gate timeout bounds; Security — render errors show variable names only

**Codebase Evidence** (homelab-edge):
- `policy.hujson:58` grant `tag:ci → tag:xstockstrat, tag:xstockstrat-staging, tag:db` on `tcp:22` (union with main's `tag:db:22`, recon E7).
- `app-deploy.sh:8` `wait_seconds="${3:-120}"`; `:12-13` must be 30–900 else exit 2; `:44` keeps only
  `required variable … is missing a value` lines (H1b); `:55`, `:65`, `:75` `--wait-timeout "$wait_seconds"`.
- `gatus-config.yaml.j2:81-120` `xstockstrat-ui`, `xstockstrat-agent`, `xstockstrat-staging-ui`, `xstockstrat-staging-agent`.
- `deploy-compose-app.md` § 4.1 xstockstrat (`:84`), § 6 failure modes (`:151`).

**TDD**: `red-green required` (Step 15 is the red).

**Covers**: —

**Instructions**: As above (design §6–7). homelab-edge rules apply there (its own CLAUDE.md: Ansible only, pins in
`versions.yml`, no secret in repo or log).

**Verification**: Step 15's commands.

---

## Deviation Log

- **D-1 (2026-10-27, /sdd-spec):** Spec written after the code. Status kept at `code-completed` (not reset to
  `implementation-ready`), because resetting would tell `/sdd-execute` to redo shipped work. All steps marked `done`
  with the commit that landed them.
- **D-2 (2026-10-27, /sdd-spec):** Finding: the render oracle (`render-assert.jq`) and `homelab-render.test.sh` do not
  assert that every service waits on `db-migrator`. Today the chain holds (only config names the migrator,
  `compose.yml:53-55`; every other service reaches config via `service_healthy`), checked by Step 8's extra jq command.
  A future edit that drops a `depends_on` would pass CI. Not fixed here; a candidate `depends-migrator` label for
  `render-assert.jq`.
- **D-3 (2026-10-27, /sdd-spec):** Live-only scenarios (AC-11/18/19/20 run behaviour, AC-34, AC-38, AC-40, AC-24's gate
  rollback) are unproven until the first staging/production deploy, as context.md already records.
- **Re-run 2026-10-27 (/sdd-spec):** `migration-ahead-check.test.sh` all passed; Go `TestProbe*` ok in all three
  services; `homelab-render.test.sh` all passed (docker compose v5.6.1, no daemon); homelab-edge `app-deploy-test.sh`
  PASS, `gatus-config-test.py` OK. Not re-run: `policy-test.sh` (no headscale binary in this sandbox), CI
  `migration-rerun` (needs Postgres), `actionlint` (not installed here), golangci-lint/coverage.
