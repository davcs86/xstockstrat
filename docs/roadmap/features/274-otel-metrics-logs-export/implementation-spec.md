# Implementation Spec: otel-metrics-logs-export

**Status**: `in-progress`
**Created**: 2026-10-30
**Feature**: `docs/roadmap/features/274-otel-metrics-logs-export/feature.md`
**Total Steps**: 59
**Feature Branch**: `feature/otel-metrics-logs-export`

---

## Execution Summary

Implements the approved design (`design.md`) in three phases that mirror its **PR-A → G1 → PR-B** order. **Phase A (steps 1-47)** exports metrics and logs from all 12 runtimes next to traces: shared golden status vectors first, an egress audit, then per runtime a service step + paired test step (Go ×3 with a `*Context` slog retrofit, Python ×4 incl. the agent's `mcp.tool.duration`, Node ×4, UI), ending in a service-docs teardown; the **G1 dev-proof gate** follows PR-A. PR-A touches no file under `docs/` or `packages/otel/` (feature 250's guard Part 2 would fail CI; the operator waived the resulting docs-lag window). **Phase B** rebuilds the produced-signals guard as a registry allowlist, adds the proto-derived stream-exclusion Part 4, restores the three alert rules, the mute timing and the dashboards on the series G1 proved, and reconciles the docs (FR-7). Bugs found by re-reading the code at spec time are recorded in step 1 as deviations D1-D7 from `design.md` (most important: the Python locks are already at SDK 1.45.1 / instrumentation-grpc 0.66b1, so the design's pin/`uv lock` work is void, and the three Python servers have no `interceptors=` list today).

**Consumer surface (C-14)**: `None — internal/platform-only` (product-spec). The consumer is the on-call operator through Grafana Cloud alerts and dashboards in `packages/otel/`; no UI segment or MCP tool changes behaviour (the UI and agent gain *metrics*, not features). This is a decision, not an omission.

**Phase boundaries**: PR-A = steps 1-48 (the G1 gate, step 48, follows and blocks PR-B); PR-B = steps 49-59. Between them: PR-A squash-merges to `main-dev`, deploys to dev with `OTEL_ENABLED="true"`, the operator runs G1, `origin/main-dev` is merged back into the feature branch, and `status.md` stays `in-progress` until PR-B merges. Hard ordering vs feature 250 is already satisfied (250 landed as `3968bcea`).

**Test layout (C-08/C-13)**: every `service` step is followed by its paired `test` step (Go: service → test → retrofit service → retrofit test). Go tests live next to the telemetry package (excluded from CI coverage — the telemetry tests are the proof); Python fixtures extend each service's `tests/conftest.py`; Node tests stay in `src/__tests__/`; UI uses vitest (`src/**/*.test.ts`) with inventory fixtures where domain objects appear.

## Scenario Coverage (C-15)

| Scenario | Step(s) |
|---|---|
| AC-1 | 5 |
| AC-2 | 5, 9, 13, 17, 19, 21, 30, 33, 36, 39 |
| AC-3 | 21, 23 |
| AC-4 | 30 |
| AC-5 | 39 |
| AC-6 | 9 |
| AC-7 | 39 |
| AC-8 | 50, 53, 54 |
| AC-9 | 50, 57, 58 |
| AC-10 | 17, 25, 36, 45 |
| AC-11 | 5, 25, 33, 45 |
| AC-12 | 13 |
| AC-13 | 41 |
| AC-14 | 53, 54, 55, 56 |
| AC-15 | 2, 17, 19, 21, 30, 33, 36, 39 |
| AC-16 | 46 |
| AC-17 | 51, 52 |
| AC-18 | 13 |
| AC-19 | 5, 9, 13, 17, 19, 21, 25, 30, 33, 36, 39, 45 |
| AC-20 | 41 |
| AC-21 | 27 |
| AC-22 | 17, 19, 21 |

AC-2's Node rows are driven by a real in-process gRPC `NOT_FOUND` call (steps 30/33/36/39); its Grafana-Cloud series assertion (`rpc_server_duration_milliseconds_count{service_name=…,rpc_grpc_status_code="5"}`), AC-3's Loki query and AC-9's rendered-docs reading are additionally proven at the G1 gate (step 48).

## Step Dependencies

- Steps 2 and 3 precede every runtime step: the Python/Node recorder suites read `scripts/testdata/rpc-status-vectors.json` (step 2); the egress audit (step 3) must be complete before PR-A merges and any FIX it finds lands in the owning service step.
- Within every runtime: a service step is followed by its paired test step (Node has two service steps — telemetry, then logger/index — before the single test step, which covers both) (the test is written first and must be RED against the pre-implementation tree — P-06); Go adds a second service+test pair for the slog retrofit, which requires the first pair (the retrofit's tests rely on `WrapLogHandler`).
- **RED capture for a test step that follows its service step** (`.claude/skills/sdd-execute/reference/tdd-gate.md`, which treats the pair as one cycle): author the test step's tests first, then reproduce the pre-implementation tree by restoring only the paired service step's non-test source files to their pre-step content. In sequential mode the service step is already committed, so run `git checkout <commit-before-the-service-step> -- <that step's Files minus *_test.go, go.mod/go.sum, pyproject.toml and lockfiles>` (for files the step created, move them aside instead, because `git stash` skips untracked files), capture RED, then `git checkout HEAD -- <the same paths>`; the test step edits the excluded files, so they must stay. A build, import or compile failure of the test package in that tree is accepted as RED in every language (Go build error, Python `ImportError`, Node `tsc` error), because the new symbols and imports are exactly the behaviour under test; record that reading of `tdd-gate.md` step 2 in `context.md` at the first test step, run the tests to capture RED, restore (`git stash pop`), and run the step's Verification for GREEN. Record both captures in the PR body and `context.md` (never in the step body, F-09).
- Go steps require the module set in step 1's evidence; `portfolio` and `marketdata` clone `trading`'s approach and may be executed in parallel after `trading` is merged into the feature branch as a reference.
- Step 22 (analysis heartbeat) requires step 20; the PR-B stall rule and registry row depend on the literal `live_loop: cycle complete` it emits.
- Step 26 (agent middleware) requires step 24 (providers installed) so `mcp.tool.duration` binds to the real provider.
- Identity: step 40 (email → user_id) is independent of the telemetry steps but must merge before PR-A (operator R2 decision; AC-20).
- UI: steps 42-44 are paired with the two UI test steps that follow; `serverLog` must never be used by `telemetry.ts` (recursion guard).
- Step 48 (G1) blocks every PR-B step: PR-B is built only on names G1 proved; if G1 contradicts a design assumption, PR-B is re-pointed under a superseding AC with operator sign-off.
- PR-B order is mandatory: registry/Part-2 retirement (49-50) → Part 4 (51-52) → alerts (53-54) → dashboards (55-56) → docs (57-59). Docs may only mention Loki/Prometheus after Part 2 is retired, and restored assets only pass once the allowlist and Part 4 exist.
- No deployment-file, proto, migration or config-key step exists: env parity is already complete (step 1 evidence), `OTEL_ENABLED` per target stays dev `"true"` / prod `"false"` (the prod flip is a separate operator rollout), and there is no WatchConfig key (product-spec Out of Scope; F-07 honoured).
- Carried traps (ledger fails.md): 2026-08-06 re-read 250's landed state (step 1); 2026-09-09 Node dual runners (now moot, D3); 2026-10-15 vitest clears `vi.spyOn` history before each test, so UI telemetry tests use plain console recorders and trigger behaviour inside the test; insights 3606-3609 (install the JS console spy before OTel loads; drive the BSP/periodic timer path).

---

### Step 1 — docs: PR-A precondition check and spec-time deviation record (no code)

**Status**: `done`
**Service**: `docs/roadmap/features/274-otel-metrics-logs-export/`
**Files**:
- `docs/roadmap/features/274-otel-metrics-logs-export/context.md` — modify (append)

**Reviewers**: none

**Codebase Evidence**:
- `docs/roadmap/features/250-fix-otel-metrics-logs-gap/status.md` = `code-completed`; 250 landed on trunk as commit `3968bcea` (`git log -1 3968bcea`). Landed assets: `packages/otel/alerts/alert-rules.yaml` (`deleteRules`/`deleteMuteTimes` only), `packages/otel/dashboards/service-health.json` (3 Tempo panels, uid `xstk-service-health`), `scripts/check-otel-produced-signals.sh` (Parts 1-3) + `.test.sh` + `scripts/testdata/otel-produced-signals/{alert-rules.prefix.yaml,fr4.prefix.tsv,service-health.prefix.json}`, CI job `otel-signals` (`.github/workflows/ci.yml:802-813`, paths filter `:102-107`). P-0 is already done: the guard's `FOLLOWUP` literal is `docs/roadmap/features/274-otel-metrics-logs-export/` (`check-otel-produced-signals.sh:20`) and `merge-order.md:78` carries the P-0 amendment row.
- Env parity (FR-1 audit): `grep -n OTEL_ docker-compose.yml` → `OTEL_ENABLED: ${OTEL_ENABLED:-false}` (:18, shared anchor) and one `OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318` per service at :133,166,200,236,284,317,355,396,434,470,516,569 (12 lines = 12 runtimes); `.do/app.yaml:30-36` and `.do/app.dev.yaml:30-36` set `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` as global `envs:`. No `OTEL_METRIC_*`, `OTEL_BLRP_*`, `OTEL_TRACES_SAMPLER` or gRPC-excluded-services env exists anywhere (grep empty) — **no deployment-file edit is needed by this feature**.

**TDD**: N/A (non-code-bearing)

**Covers**: —

**Instructions**:
1. Re-read 250's landed state (ledger fails 2026-08-06): confirm the files above exist and `bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh` exits 0 on the current tree.
2. Append a dated `context.md` block recording these **spec-time deviations from `design.md`** (each is a verified fact that supersedes a design premise; execute steps follow the corrected text): **D1** the four Python locks already resolve `opentelemetry-sdk`/`exporter-otlp-proto-http` 1.45.1 and `opentelemetry-instrumentation-grpc` 0.66b1 (ingest no longer lags) — design's 'pin <1.43 / ==0.63b1' version bumps are void (the one dependency change is **D8**); the probe was re-run at 1.45.1/0.66b1 and all design conclusions hold (no RPC metric in instrumentation-grpc; `abort`/`set_code` set the status attribute; SDK `LoggingHandler` still present but deprecated). **D8** (operator decision 2026-10-30; supersedes the design's choice to keep the SDK handler): the four Python services use `opentelemetry.instrumentation.logging.handler.LoggingHandler` from the new dependency `opentelemetry-instrumentation-logging>=0.66b1` (`pyproject.toml` + `uv lock` ×4; the probe results are in the Python service steps 16/18/20/24). **D2** the three Python gRPC servers are built with no `interceptors=` argument (`grpc.aio.server()` at indicators `main.py:74`, ingest `:104`, analysis `:107`), so the cancel/deadline interceptor is a new argument. **D3** all four Node services are CommonJS and tsc-first (`tsconfig.json: "module": "commonjs"`, `test: tsc && node --test dist/...`) — `createRequire` is unnecessary. **D4** Go `main.go` line numbers drifted from recon (cited fresh in the Go steps); testability refinement: the slog bridge and bounded shutdown live in `internal/telemetry` (`WrapLogHandler`, `StopServer`) rather than inline in `cmd/` (excluded from CI coverage). **D5** notify's fanout code is `src/fanout/{fanout,webPush}.ts` (recon cited `src/services/`). **D6** the UI lockfile is the repo-root `pnpm-lock.yaml`. **D7** the agent already has a `ServerMiddleware` precedent (`CallerPropagationMiddleware`, `tools.py:190`, appended at `:381`).
3. Record in `context.md` the DigitalOcean App Platform SIGKILL grace period, **verified 2026-10-30** from the official page https://docs.digitalocean.com/products/app-platform/how-to/configure-termination/ : `termination.grace_period_seconds` is the time after SIGTERM before the container is killed with SIGKILL, default **120 s**, maximum 600 s; `termination.drain_seconds` (delay before SIGTERM) default 15 s, maximum 110 s. Neither `.do/app.yaml` nor `.do/app.dev.yaml` sets a `termination` block (`grep -n 'termination\|grace_period\|drain_seconds' .do/app.yaml .do/app.dev.yaml` → nothing), so the 120 s default applies and the 2 s flush + 3 s GracefulStop fallback + 5 s deferred shutdown bounds (10 s) fit with margin. The page does not say which component types accept the block (all affected components here are services); if a `termination.grace_period_seconds` below 10 is ever added to a spec, STOP and raise it (P-03) before the Go steps.
4. Confirm the seven Go modules resolve at the pinned set (already verified at spec time with `go list -m`/`go mod download`): `otel/sdk/metric@v1.45.0`, `otlpmetrichttp@v1.45.0`, `otel/log@v0.21.0`, `otel/sdk/log@v0.21.0`, `otlploghttp@v0.21.0`, `contrib/bridges/otelslog@v0.20.0`; `otelslog` requires Go >= 1.25 (services are 1.27).

**Verification**:
```bash
cd /home/user/xstockstrat && bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh
grep -n 'OTEL_METRIC\|OTEL_BLRP\|OTEL_TRACES_SAMPLER' docker-compose.yml .do/app.yaml .do/app.dev.yaml  # expect no output
```

---

### Step 2 — test: Shared golden RPC status vectors and bucket boundaries (consumed by the Python and Node recorder suites)

**Status**: `done`
**Service**: `scripts/`
**Files**:
- `scripts/testdata/rpc-status-vectors.json` — create

**Reviewers**: none

**Codebase Evidence**:
- `ls scripts/testdata` → only `otel-produced-signals/` today; **Not found**: `rpc-status-vectors.json` — create from scratch (design § Shared golden vectors; C-13 shared home under `scripts/testdata/`)
- Bucket boundaries identical across SDKs: Go `sdk/metric@v1.45.0/reader.go:206`, Python and Node defaults (design § Shared golden vectors)

**TDD**: N/A (data file; the consumer suites in the Python and Node test steps are the red-before-green proof)

**Covers**: `AC-15`

**Instructions**:
1. Create the JSON document `{ "bucket_boundaries_ms": [0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000], "vectors": [ ... ] }`. Each vector: `{ "name", "applies_to": ["python","node"], "span": { "kind": "SERVER", "attributes": {...}, "events": [...], "status": "UNSET|ERROR" }, "expected_code": N }`. Required vectors, in this order: `ok` → 0; `abort NOT_FOUND` (attribute `rpc.grpc.status_code`=5) → 5; `unhandled ValueError` (attribute 0/absent + `exception` event, ERROR status) → 2; `bare Exception` (exception event, no attribute) → 2; `deadline-expired cancel` (attribute 4) → 4; `client cancel` (attribute 1) → 1; `node error without code` (attribute absent, ERROR status) → 2; `node string code` (attribute `"5"` as a string) → 2; `ERROR status only` → 2. `applies_to` limits Node-only (`node error without code`, `node string code`) and Python-only (`bare Exception`) vectors; the other six apply to both. This covers AC-15's seven named vectors plus the deadline/cancel pair.

**Verification**:
```bash
python3 -c "import json; d=json.load(open('scripts/testdata/rpc-status-vectors.json')); assert d['bucket_boundaries_ms']==[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]; assert len(d['vectors'])==9; print('ok')"
```

---

### Step 3 — docs: Egress audit of every log site before PR-A merges (FR-5; record in context.md)

**Status**: `done`
**Service**: `all runtimes`
**Files**:
- `docs/roadmap/features/274-otel-metrics-logs-export/context.md` — modify (append)

**Reviewers**: none

**Codebase Evidence**:
- No log redaction layer exists in any runtime (recon R8). Sites to audit (counts at spec time): Node `log.*(` in config `src/` = 22 call sites; notify `src/fanout/fanout.ts:101,131,134,174,177` and `src/fanout/webPush.ts:71`, `src/grpc/notifyServiceImpl.ts:91-252`; identity (only email-bearing log is `identityServiceImpl.ts:151-154`, fixed by its own step); Python `extra=` sites = 5 (`grep -n "extra=" -r services/xstockstrat-*/app --include=*.py | wc -l`, incl. the `OTel tracing initialised` lines); marketdata placeholder-credential WARN (`looksLikePlaceholderCred`, `cmd/server/main.go` after :218)
- Preserved redaction invariants (design § Business Rules Touched): feature 147 `[redacted]` edges, `@AC-10 @feature-043`, `@AC-2 @feature-166` (ingest bearer), `@AC-1`/`@AC-4 @feature-164` (agent `credentials_json`), `@AC-1 @feature-183` (`manage_user` password), `@AC-7 @feature-207`

**TDD**: N/A (non-code-bearing)

**Covers**: —

**Instructions**:
1. Run the grep commands in Verification and read every hit. For each log call record in `context.md`: file:line, what it interpolates, and PASS (no secret/credential/token/full-header/PII) or FIX. Any FIX is corrected **at the call site** (log the id, not the value) in the owning service's step before PR-A merges; do not add a redaction layer to the bridge (YAGNI, design).
2. The bridge emits only what stdout already prints plus `code.*` attributes and caller-supplied `extra=` keys (Python) — confirm each `extra=` site carries no secret. Record the verdict table; AC-7, AC-13 and AC-20 are the egress tests.

**Verification**:
```bash
grep -rnE "log\.(info|warn|error|debug)\(" services/xstockstrat-{config,notify,identity,ledger}/src --include=*.ts | grep -v __tests__
grep -rnE "log(ger)?\.(info|warning|error|exception|debug)\(" services/xstockstrat-{agent,ingest,indicators,analysis}/app --include=*.py
grep -rnE "slog\.[A-Za-z]+\(" services/xstockstrat-{trading,portfolio,marketdata} --include=*.go | grep -v _test.go | grep -iE "key|secret|token|pass|cred|auth"
grep -rn "extra=" services/xstockstrat-*/app --include=*.py
```

---

### Step 4 — service: trading: metrics + logs pipelines, slog bridge, bounded shutdown (Go)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel.go` — modify
- `services/xstockstrat-trading/internal/telemetry/logbridge.go` — create
- `services/xstockstrat-trading/internal/telemetry/shutdown.go` — create
- `services/xstockstrat-trading/cmd/server/main.go` — modify
- `services/xstockstrat-trading/go.mod` — modify
- `services/xstockstrat-trading/go.sum` — modify
- `services/xstockstrat-trading/internal/telemetry/otel_test.go` — modify (call-site arity only: `Init` now returns three values)

**Reviewers**: Service owner (`xstockstrat-trading`) — order execution correctness, fill detection; no hot-path latency regression

**Codebase Evidence**:
- `grep -n "func Init\|SetTracerProvider\|WithTimeout\|svcName =" services/xstockstrat-trading/internal/telemetry/otel.go` → `Init(ctx) (func(context.Context) error, error)` at :18, `otlptracehttp.New(ctx, WithTimeout(5s))` env-only exporter, `otel.SetTracerProvider(tp)`, `return tp.Shutdown, nil`; `newResource` at :45 (default `svcName = "trading"` at :48)
- `grep -n "slog.SetDefault\|telemetry.Init\|StatsHandler\|signal.Notify\|GracefulStop" services/xstockstrat-trading/cmd/server/main.go` → `slog.SetDefault(logger)` :39, `telemetry.Init(ctx)` :44 (before `grpc.NewServer`, so `otelgrpc.NewServerHandler()` at :143 reads the already-set global MeterProvider — `otelgrpc@v0.52.0/config.go:69` `MeterProvider: otel.GetMeterProvider()`), `signal.Notify` :158, `grpcServer.GracefulStop()` :163 then `cancel()`
- `otelgrpc@v0.52.0/config.go:87-120` creates exactly five server instruments: `rpc.server.duration` (Float64Histogram, unit `ms`), `rpc.server.request.size`, `rpc.server.response.size`, `rpc.server.requests_per_rpc`, `rpc.server.responses_per_rpc`
- Go 1.27.0 toolchain ships `log/slog.NewMultiHandler` (`$GOROOT/src/log/slog/multi_handler.go:13`); `otelslog.NewHandler(name, opts...)`/`WithLoggerProvider` (`otelslog@v0.20.0/handler.go:144,184`); `otel/log/global.SetLoggerProvider` (`otel/log@v0.21.0/global/log.go:47`); `otlploghttp.New(ctx, ...)` (`otlploghttp@v0.21.0/exporter.go:29`); `sdkmetric.NewView`/`AggregationDrop` (`sdk/metric@v1.45.0/view.go:49`, `aggregation.go:25`); `NewPeriodicReader` honours `OTEL_METRIC_EXPORT_INTERVAL` (`sdk/metric@v1.45.0/env.go:17`); `sdklog.NewBatchProcessor` honours `OTEL_BLRP_*` (`sdk/log@v0.21.0/batch.go:26-29`) — all confirmed in the module cache by the spec-time probe
- No go.mod entry for `sdk/metric`, `otlpmetrichttp`, `otel/log`, `sdk/log`, `otlploghttp` or `otelslog` today (`grep -n otel services/xstockstrat-trading/go.mod` → only otelgrpc v0.52.0, otel/sdk/otlptracehttp v1.45.0; `otel/metric` indirect) — **create from scratch**

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **go.mod**: add the pins (`go.opentelemetry.io/otel`, `otel/sdk`, `otel/sdk/metric`, `otel/exporters/otlp/otlpmetric/otlpmetrichttp` at **v1.45.0**; `otel/log`, `otel/sdk/log`, `otel/exporters/otlp/otlplog/otlploghttp` at **v0.21.0**; `go.opentelemetry.io/contrib/bridges/otelslog` at **v0.20.0** (all resolve against `otel` v1.45.0; the newer log modules need `otel` v1.47.0 — design.md § PR-A Go Pins; `otelgrpc` stays v0.52.0)); run `cd services/xstockstrat-trading && GOWORK=off go mod tidy`. Promote `otel/metric` from indirect only if tidy requires it.
2. **otel.go**: change the signature to `Init(ctx context.Context) (shutdown func(context.Context) error, forceFlush func(context.Context) error, err error)`. Disabled gate (`OTEL_ENABLED != "true"`) returns two no-op funcs (unchanged semantic). Enabled: build the Resource once with the existing `newResource(ctx)`, then (a) keep the trace provider as-is; (b) `otlpmetrichttp.New(ctx)` with **no** endpoint/url/insecure option (PLAT-3) → `sdkmetric.NewMeterProvider(sdkmetric.WithReader(sdkmetric.NewPeriodicReader(mexp)), sdkmetric.WithResource(res), sdkmetric.WithView(serverMetricViews()...))` → `otel.SetMeterProvider`; factor the Views into an unexported helper `func serverMetricViews() []sdkmetric.View` in `otel.go` (the paired test step builds its MeterProvider from the same list), whose doc comment names `rpc.server.duration` — the instrument otelgrpc creates and these Views keep, and the grep-able Go producer literal the step-49 registry points at — with one `sdkmetric.NewView(sdkmetric.Instrument{Name: X}, sdkmetric.Stream{Aggregation: sdkmetric.AggregationDrop{}})` for X in `rpc.server.request.size`, `rpc.server.response.size`, `rpc.server.requests_per_rpc`, `rpc.server.responses_per_rpc` (keeps only `rpc.server.duration`, cardinality design § PR-A Views); (c) `otlploghttp.New(ctx)` env-only → `sdklog.NewLoggerProvider(sdklog.WithProcessor(sdklog.NewBatchProcessor(lexp)), sdklog.WithResource(res))` → `global.SetLoggerProvider(lp)`. Any exporter-construction error returns `(nil, nil, err)` (non-fatal at the caller, FR-4). `shutdown` = `errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx), lp.Shutdown(ctx))`; `forceFlush` = `errors.Join(tp.ForceFlush(ctx), mp.ForceFlush(ctx), lp.ForceFlush(ctx))`.
3. **logbridge.go** (new, same package): `func WrapLogHandler(base slog.Handler) slog.Handler`. When `OTEL_ENABLED != "true"` or no logger provider was installed it returns `base` unchanged (stdout bytes identical, AC-4/AC-5). Otherwise it returns `slog.NewMultiHandler(base, otelslog.NewHandler(svcName))` (service name from the same `SERVICE_NAME` default as `newResource`) **and** calls `otel.SetErrorHandler(otel.ErrorHandlerFunc(...))` so every OTel SDK/exporter error is written through `base` only — the recursion guard, because once `slog.SetDefault` runs the stdlib `log` package (the default OTel error sink) routes into the default slog handler and would re-enter the OTLP pipeline (FR-4, R6). The record keeps the same message text so the existing `"400 Bad Request"` assertion still holds.
4. **shutdown.go** (new): `func StopServer(forceFlush func(context.Context) error, graceful func(), force func(), flushTimeout, gracefulTimeout time.Duration)`: (1) `forceFlush` under `context.WithTimeout(flushTimeout)`; (2) run `graceful()` in a goroutine and wait up to `gracefulTimeout`; on timeout call `force()` (grpc `Stop()`). Open server streams otherwise block `GracefulStop` forever and starve the flush (design R2 blocker 3).
5. **main.go**: (a) keep `slog.SetDefault(logger)` at :39 (so the init-failure Warn still prints); (b) change the `telemetry.Init` call at :44 to receive `(shutdownOtel, forceFlushOtel, err)`; (c) after a successful Init and **before** `grpc.NewServer`, call `slog.SetDefault(slog.New(telemetry.WrapLogHandler(logger.Handler())))`; (d) replace the signal goroutine body (`hs.Shutdown()` then `grpcServer.GracefulStop()` then `cancel()` at :163) with `hs.Shutdown()` then `telemetry.StopServer(forceFlushOtel, grpcServer.GracefulStop, grpcServer.Stop, 2*time.Second, 3*time.Second)` then `cancel()`; keep the deferred 5 s `shutdownOtel` (it flushes the stream-end points once `Serve` returns). Worst case ≈ 2+3+5 s, inside compose's 10 s stop grace. `os.Exit(1)` startup paths still skip the flush (accepted asymmetry, stdout keeps those lines).
6. Do **not** add any endpoint, url, headers or insecure argument to either new exporter, and add no config key and no new env var (`OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` are already set for this service in `docker-compose.yml` and both `.do/app*.yaml` — verified in step 1).
7. **Existing test call sites** (compile-only, so this step's `go vet` — which compiles `_test.go` files — can pass): in `internal/telemetry/otel_test.go` change every `shutdown, err := Init(ctx)` (currently only `exportOneSpan`, `:59`) to `shutdown, _, err := Init(ctx)`. No other test edit belongs here; the new tests are the next step.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go vet ./internal/telemetry/... ./cmd/...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
test -f services/xstockstrat-trading/internal/telemetry/logbridge.go && test -f services/xstockstrat-trading/internal/telemetry/shutdown.go && grep -q 'telemetry.WrapLogHandler' services/xstockstrat-trading/cmd/server/main.go   # fails before the step
```

---

### Step 5 — test: trading: telemetry tests — metrics/logs export, status code, bridge, shutdown (Go)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel_test.go` — modify
- `services/xstockstrat-trading/internal/telemetry/shutdown_test.go` — create
- `services/xstockstrat-trading/go.mod` — modify (go mod tidy promotes the otlp proto module)
- `services/xstockstrat-trading/go.sum` — modify

**Reviewers**: Service owner (`xstockstrat-trading`) — order execution correctness, fill detection; no hot-path latency regression

**Codebase Evidence**:
- `grep -n "^func " services/xstockstrat-trading/internal/telemetry/otel_test.go` → `TestNewResourceOmitsTradingMode` :19, `newOTLPReceiver` :42, `exportOneSpan` :53, `TestInitExportsOverOTLPHTTP` :72 (both header forms, `/otlp/v1/traces`), `TestInitLogsExportFailure` :93 (captures stdlib `log`, asserts `"400 Bad Request"`)
- `healthpb.Watch` (grpc health v1) is a server-streaming RPC already linked into every Go service (`healthpb.RegisterHealthServer`) — usable as the 'open stream' in the shutdown test without a new proto

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-11, AC-19`

**Instructions**:
1. Write the tests first and run them against the pre-implementation tree to capture RED (restore the pre-step content of only the service step's non-test source — `otel.go`, `logbridge.go`, `shutdown.go`, `cmd/server/main.go` (mechanics in Step Dependencies) — and keep `otel_test.go`, `go.mod`, `go.sum`: the telemetry test package then fails to build because the 3-value `Init`, `WrapLogHandler` and `StopServer` do not exist in that tree; that build failure is the accepted RED, and GREEN is this step's Verification).
2. Extend `exportOneSpan`'s receiver so it records every path (`/otlp/v1/traces`, `/otlp/v1/metrics`, `/otlp/v1/logs`). **Export (AC-19, EXTEND `@AC-1 @feature-226`)**: under both header forms (`Authorization=Basic dGVzdDprZXk=` and `Authorization=Basic%20dGVzdDprZXk%3D`) a recorded metric (`otel.Meter("t").Int64Counter`) and a log record (`global.GetLoggerProvider()` emit or `WrapLogHandler` + `slog.Info`) followed by `forceFlush` produce `POST /otlp/v1/metrics` and `POST /otlp/v1/logs` with `Authorization: Basic dGVzdDprZXk=`.
3. **Status/duration (AC-2)**: build a real `grpc.NewServer(grpc.StatsHandler(otelgrpc.NewServerHandler()))` over a `bufconn`/loopback listener with a tiny unary handler returning `status.Error(codes.NotFound, ...)` (register via `grpc.ServiceDesc` inline, no proto), install a `sdkmetric.NewManualReader` MeterProvider **with the same Views as Init (use the unexported helper `serverMetricViews()` that the service step added to `otel.go`, so the test and `Init` share one view list; this step does not edit `otel.go`)**, call it, collect, and assert: instrument name `rpc.server.duration`, unit `ms`, a data point with `rpc.grpc.status_code` = 5, and **no** `rpc.server.request.size|response.size|requests_per_rpc|responses_per_rpc` instruments. Also assert bucket boundaries equal `scripts/testdata/rpc-status-vectors.json#bucket_boundaries_ms` (read the file; Go SDK default = `[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]`).
4. **Resource (AC-1)**: the exported metric request carries `service.name`, `deployment.environment=staging`, `platform=xstockstrat` — decode the OTLP protobuf body with `go.opentelemetry.io/proto/otlp/collector/metrics/v1` in the receiver (`go.opentelemetry.io/proto/otlp v1.11.0` is already an indirect requirement, `go.mod:33` / `go.sum:58-59`; `go mod tidy` promotes it to direct). `TestNewResourceOmitsTradingMode` stays green (PRESERVE `@AC-1 @feature-171`).
5. **Trace correlation (AC-11)**: inside `tracer.Start(ctx, "s")` call `slog.InfoContext(ctx, ...)` through `WrapLogHandler`; decode the `/v1/logs` body and assert the record's `trace_id`/`span_id` equal the span's and severity text/number map from the slog level (use `slog.WarnContext(ctx, …)` for the AC-11 WARN row so the record carries the active span context).
6. **Failure visibility without recursion (AC-6/EXTEND `@AC-3 @feature-226`)**: update `TestInitLogsExportFailure` to install `slog.SetDefault(slog.New(WrapLogHandler(jsonHandlerOverBuffer)))`, point the exporter at a receiver returning 400 and at `http://127.0.0.1:1`, and assert the failure text reaches the stdout buffer **and** that the receiver sees no `/v1/logs` record containing the failure text (count `/v1/logs` posts after the failure; assert it carries only the test's own records).
7. **Disabled (AC-5 analogue)**: with `OTEL_ENABLED="false"`, `Init` returns no-op funcs, no provider is installed (`otel.GetMeterProvider()` is the global no-op), `WrapLogHandler(base)` returns `base` (compare with `==`), and the receiver sees zero requests.
8. **StopServer (shutdown_test.go)**: table test with fakes asserting call order (`forceFlush` before `graceful`) and that a `graceful` that never returns triggers `force` after `gracefulTimeout`. No process-level test here (trading's AC set does not include shutdown).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"  # confirm >= 40%; the telemetry package is excluded from CI measurement, so no threshold applies to this step's new logic — the telemetry tests below are the proof
cd services/xstockstrat-trading && GOWORK=off go test ./internal/telemetry/... -race -count=1 -v
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -q 'telemetry.StopServer' services/xstockstrat-trading/cmd/server/main.go   # the signal goroutine really calls StopServer (cmd/ is excluded from coverage, so a unit test cannot see it)
```

---

### Step 6 — service: trading: move every slog call with a context in scope to its *Context variant; enforce with sloglint

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/.golangci.yml` — modify
- `services/xstockstrat-trading/cmd/server/main.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-trading/internal/config/config.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-trading/internal/broker/ibkr.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-trading/internal/broker/ibkr_session.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-trading/internal/service/order_intent.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-trading/internal/service/trading.go` — modify (only if sloglint reports a call in it)

**Reviewers**: Service owner (`xstockstrat-trading`) — order execution correctness, fill detection; no hot-path latency regression

**Codebase Evidence**:
- `grep -rEn 'slog\.(Info|Warn|Error|Debug)\(' services/xstockstrat-trading --include=*.go | grep -v _test.go | wc -l` → 120 call sites in 6 files; `*Context` variants today: 0
- `services/xstockstrat-trading/.golangci.yml` enables `govet, errcheck, staticcheck, ineffassign, unused` (linters block) and is byte-identical in trading, portfolio and marketdata
- golangci-lint v2.14.0 (root CLAUDE.md § Language Versions) bundles sloglint v0.12.0 with `context: scope` and `no-mixed-args` options (design.md § PR-A Go; orchestrator probe R3) — `no-mixed-args` defaults to true, so it must be set explicitly to false

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **RED first**: add `sloglint` to `linters.enable` and a `linters.settings.sloglint` block with `context: scope` and `no-mixed-args: false` (keep `kv-only`/`attr-only` unset). Run the lint command and capture the failing run (the report lists every offending call).
2. **GREEN**: rewrite each reported call: `slog.Info(msg, args...)` → `slog.InfoContext(ctx, msg, args...)` (same for Warn/Error/Debug) using the `ctx` already in scope. Do not introduce a new `ctx`, do not change messages, keys or levels (stdout bytes unchanged — PRESERVE `@AC-6 @feature-020`/`@AC-4 @feature-127`/`@AC-5 @feature-215` stdout lines), and leave calls with no context in scope untouched (sloglint `scope` only flags in-scope contexts).
3. Tests that swap `slog.SetDefault` keep working (a `*Context` call goes through the same default handler).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go vet ./...
grep -q 'sloglint' services/xstockstrat-trading/.golangci.yml   # fails before the step
```

---

### Step 7 — test: trading: retrofit gate — full suite green under sloglint (Go)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_sync_test.go` — modify (only if it asserted on a removed non-Context call; it is the one test file outside `internal/telemetry` that swaps `slog` or asserts log text, found by `grep -rln 'slog.SetDefault\|slog.New(' services/xstockstrat-trading --include=*_test.go`; if the suite is green after the retrofit no file changes)

**Reviewers**: Service owner (`xstockstrat-trading`) — order execution correctness, fill detection; no hot-path latency regression

**Codebase Evidence**:
- `grep -rn "slog.SetDefault" services/xstockstrat-trading --include=*_test.go` → tests that swap the default handler (they capture `*Context` records equally)

**TDD**: `red N/A — behaviour-neutral retrofit gate; capture the green run only (tdd-gate.md explicit escape; say so in the PR body and context.md)`

**Covers**: —

**Instructions**:
1. Run the whole service suite after the retrofit; fix only test code that fails because it matched a removed call shape. The behavioural proof that a *Context call inside a span carries `trace_id` is the telemetry test of the previous test step (AC-11 trading row); this step proves the retrofit is behaviour-neutral.
2. C-13: no new fixture literal; the retrofit adds no domain test data.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # CI floor 40%: total must be >= 40.0
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 8 — service: portfolio: metrics + logs pipelines, slog bridge, bounded shutdown (Go)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/telemetry/otel.go` — modify
- `services/xstockstrat-portfolio/internal/telemetry/logbridge.go` — create
- `services/xstockstrat-portfolio/internal/telemetry/shutdown.go` — create
- `services/xstockstrat-portfolio/cmd/server/main.go` — modify
- `services/xstockstrat-portfolio/go.mod` — modify
- `services/xstockstrat-portfolio/go.sum` — modify
- `services/xstockstrat-portfolio/internal/telemetry/otel_test.go` — modify (call-site arity only: `Init` now returns three values)

**Reviewers**: Service owner (`xstockstrat-portfolio`) — P&L calculation accuracy, concurrent write safety; no hot-path latency regression

**Codebase Evidence**:
- `grep -n "func Init\|SetTracerProvider\|WithTimeout\|svcName =" services/xstockstrat-portfolio/internal/telemetry/otel.go` → `Init(ctx) (func(context.Context) error, error)` at :18, `otlptracehttp.New(ctx, WithTimeout(5s))` env-only exporter, `otel.SetTracerProvider(tp)`, `return tp.Shutdown, nil`; `newResource` at :45 (default `svcName = "portfolio"` at :48)
- `grep -n "slog.SetDefault\|telemetry.Init\|StatsHandler\|signal.Notify\|GracefulStop" services/xstockstrat-portfolio/cmd/server/main.go` → `slog.SetDefault(logger)` :36, `telemetry.Init(ctx)` :41 (before `grpc.NewServer`, so `otelgrpc.NewServerHandler()` at :94 reads the already-set global MeterProvider — `otelgrpc@v0.52.0/config.go:69` `MeterProvider: otel.GetMeterProvider()`), `signal.Notify` :109, `grpcServer.GracefulStop()` :114 then `cancel()`
- `otelgrpc@v0.52.0/config.go:87-120` creates exactly five server instruments: `rpc.server.duration` (Float64Histogram, unit `ms`), `rpc.server.request.size`, `rpc.server.response.size`, `rpc.server.requests_per_rpc`, `rpc.server.responses_per_rpc`
- Go 1.27.0 toolchain ships `log/slog.NewMultiHandler` (`$GOROOT/src/log/slog/multi_handler.go:13`); `otelslog.NewHandler(name, opts...)`/`WithLoggerProvider` (`otelslog@v0.20.0/handler.go:144,184`); `otel/log/global.SetLoggerProvider` (`otel/log@v0.21.0/global/log.go:47`); `otlploghttp.New(ctx, ...)` (`otlploghttp@v0.21.0/exporter.go:29`); `sdkmetric.NewView`/`AggregationDrop` (`sdk/metric@v1.45.0/view.go:49`, `aggregation.go:25`); `NewPeriodicReader` honours `OTEL_METRIC_EXPORT_INTERVAL` (`sdk/metric@v1.45.0/env.go:17`); `sdklog.NewBatchProcessor` honours `OTEL_BLRP_*` (`sdk/log@v0.21.0/batch.go:26-29`) — all confirmed in the module cache by the spec-time probe
- No go.mod entry for `sdk/metric`, `otlpmetrichttp`, `otel/log`, `sdk/log`, `otlploghttp` or `otelslog` today (`grep -n otel services/xstockstrat-portfolio/go.mod` → only otelgrpc v0.52.0, otel/sdk/otlptracehttp v1.45.0; `otel/metric` indirect) — **create from scratch**

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **go.mod**: add the pins (`go.opentelemetry.io/otel`, `otel/sdk`, `otel/sdk/metric`, `otel/exporters/otlp/otlpmetric/otlpmetrichttp` at **v1.45.0**; `otel/log`, `otel/sdk/log`, `otel/exporters/otlp/otlplog/otlploghttp` at **v0.21.0**; `go.opentelemetry.io/contrib/bridges/otelslog` at **v0.20.0** (all resolve against `otel` v1.45.0; the newer log modules need `otel` v1.47.0 — design.md § PR-A Go Pins; `otelgrpc` stays v0.52.0)); run `cd services/xstockstrat-portfolio && GOWORK=off go mod tidy`. Promote `otel/metric` from indirect only if tidy requires it.
2. **otel.go**: change the signature to `Init(ctx context.Context) (shutdown func(context.Context) error, forceFlush func(context.Context) error, err error)`. Disabled gate (`OTEL_ENABLED != "true"`) returns two no-op funcs (unchanged semantic). Enabled: build the Resource once with the existing `newResource(ctx)`, then (a) keep the trace provider as-is; (b) `otlpmetrichttp.New(ctx)` with **no** endpoint/url/insecure option (PLAT-3) → `sdkmetric.NewMeterProvider(sdkmetric.WithReader(sdkmetric.NewPeriodicReader(mexp)), sdkmetric.WithResource(res), sdkmetric.WithView(serverMetricViews()...))` → `otel.SetMeterProvider`; factor the Views into an unexported helper `func serverMetricViews() []sdkmetric.View` in `otel.go` (the paired test step builds its MeterProvider from the same list), whose doc comment names `rpc.server.duration` — the instrument otelgrpc creates and these Views keep, and the grep-able Go producer literal the step-49 registry points at — with one `sdkmetric.NewView(sdkmetric.Instrument{Name: X}, sdkmetric.Stream{Aggregation: sdkmetric.AggregationDrop{}})` for X in `rpc.server.request.size`, `rpc.server.response.size`, `rpc.server.requests_per_rpc`, `rpc.server.responses_per_rpc` (keeps only `rpc.server.duration`, cardinality design § PR-A Views); (c) `otlploghttp.New(ctx)` env-only → `sdklog.NewLoggerProvider(sdklog.WithProcessor(sdklog.NewBatchProcessor(lexp)), sdklog.WithResource(res))` → `global.SetLoggerProvider(lp)`. Any exporter-construction error returns `(nil, nil, err)` (non-fatal at the caller, FR-4). `shutdown` = `errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx), lp.Shutdown(ctx))`; `forceFlush` = `errors.Join(tp.ForceFlush(ctx), mp.ForceFlush(ctx), lp.ForceFlush(ctx))`.
3. **logbridge.go** (new, same package): `func WrapLogHandler(base slog.Handler) slog.Handler`. When `OTEL_ENABLED != "true"` or no logger provider was installed it returns `base` unchanged (stdout bytes identical, AC-4/AC-5). Otherwise it returns `slog.NewMultiHandler(base, otelslog.NewHandler(svcName))` (service name from the same `SERVICE_NAME` default as `newResource`) **and** calls `otel.SetErrorHandler(otel.ErrorHandlerFunc(...))` so every OTel SDK/exporter error is written through `base` only — the recursion guard, because once `slog.SetDefault` runs the stdlib `log` package (the default OTel error sink) routes into the default slog handler and would re-enter the OTLP pipeline (FR-4, R6). The record keeps the same message text so the existing `"400 Bad Request"` assertion still holds.
4. **shutdown.go** (new): `func StopServer(forceFlush func(context.Context) error, graceful func(), force func(), flushTimeout, gracefulTimeout time.Duration)`: (1) `forceFlush` under `context.WithTimeout(flushTimeout)`; (2) run `graceful()` in a goroutine and wait up to `gracefulTimeout`; on timeout call `force()` (grpc `Stop()`). Open server streams otherwise block `GracefulStop` forever and starve the flush (design R2 blocker 3).
5. **main.go**: (a) keep `slog.SetDefault(logger)` at :36 (so the init-failure Warn still prints); (b) change the `telemetry.Init` call at :41 to receive `(shutdownOtel, forceFlushOtel, err)`; (c) after a successful Init and **before** `grpc.NewServer`, call `slog.SetDefault(slog.New(telemetry.WrapLogHandler(logger.Handler())))`; (d) replace the signal goroutine body (`hs.Shutdown()` then `grpcServer.GracefulStop()` then `cancel()` at :114) with `hs.Shutdown()` then `telemetry.StopServer(forceFlushOtel, grpcServer.GracefulStop, grpcServer.Stop, 2*time.Second, 3*time.Second)` then `cancel()`; keep the deferred 5 s `shutdownOtel` (it flushes the stream-end points once `Serve` returns). Worst case ≈ 2+3+5 s, inside compose's 10 s stop grace. `os.Exit(1)` startup paths still skip the flush (accepted asymmetry, stdout keeps those lines).
6. Do **not** add any endpoint, url, headers or insecure argument to either new exporter, and add no config key and no new env var (`OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` are already set for this service in `docker-compose.yml` and both `.do/app*.yaml` — verified in step 1).
7. **Existing test call sites** (compile-only, so this step's `go vet` — which compiles `_test.go` files — can pass): in `internal/telemetry/otel_test.go` change every `shutdown, err := Init(ctx)` (currently only `exportOneSpan`, `:59`) to `shutdown, _, err := Init(ctx)`. No other test edit belongs here; the new tests are the next step.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./internal/telemetry/... ./cmd/...
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
test -f services/xstockstrat-portfolio/internal/telemetry/logbridge.go && test -f services/xstockstrat-portfolio/internal/telemetry/shutdown.go && grep -q 'telemetry.WrapLogHandler' services/xstockstrat-portfolio/cmd/server/main.go   # fails before the step
```

---

### Step 9 — test: portfolio: telemetry tests — metrics/logs export, status code, bridge, shutdown (Go)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/telemetry/otel_test.go` — modify
- `services/xstockstrat-portfolio/internal/telemetry/shutdown_test.go` — create
- `services/xstockstrat-portfolio/go.mod` — modify (go mod tidy promotes the otlp proto module)
- `services/xstockstrat-portfolio/go.sum` — modify

**Reviewers**: Service owner (`xstockstrat-portfolio`) — P&L calculation accuracy, concurrent write safety; no hot-path latency regression

**Codebase Evidence**:
- `grep -n "^func " services/xstockstrat-portfolio/internal/telemetry/otel_test.go` → `TestNewResourceOmitsTradingMode` :19, `newOTLPReceiver` :42, `exportOneSpan` :53, `TestInitExportsOverOTLPHTTP` :72 (both header forms, `/otlp/v1/traces`), `TestInitLogsExportFailure` :93 (captures stdlib `log`, asserts `"400 Bad Request"`)
- `healthpb.Watch` (grpc health v1) is a server-streaming RPC already linked into every Go service (`healthpb.RegisterHealthServer`) — usable as the 'open stream' in the shutdown test without a new proto

**TDD**: `red-green required`

**Covers**: `AC-2, AC-6, AC-19`

**Instructions**:
1. Write the tests first and run them against the pre-implementation tree to capture RED (restore the pre-step content of only the service step's non-test source — `otel.go`, `logbridge.go`, `shutdown.go`, `cmd/server/main.go` (mechanics in Step Dependencies) — and keep `otel_test.go`, `go.mod`, `go.sum`: the telemetry test package then fails to build because the 3-value `Init`, `WrapLogHandler` and `StopServer` do not exist in that tree; that build failure is the accepted RED, and GREEN is this step's Verification).
2. Extend `exportOneSpan`'s receiver so it records every path (`/otlp/v1/traces`, `/otlp/v1/metrics`, `/otlp/v1/logs`). **Export (AC-19, EXTEND `@AC-1 @feature-226`)**: under both header forms (`Authorization=Basic dGVzdDprZXk=` and `Authorization=Basic%20dGVzdDprZXk%3D`) a recorded metric (`otel.Meter("t").Int64Counter`) and a log record (`global.GetLoggerProvider()` emit or `WrapLogHandler` + `slog.Info`) followed by `forceFlush` produce `POST /otlp/v1/metrics` and `POST /otlp/v1/logs` with `Authorization: Basic dGVzdDprZXk=`.
3. **Status/duration (AC-2)**: build a real `grpc.NewServer(grpc.StatsHandler(otelgrpc.NewServerHandler()))` over a `bufconn`/loopback listener with a tiny unary handler returning `status.Error(codes.NotFound, ...)` (register via `grpc.ServiceDesc` inline, no proto), install a `sdkmetric.NewManualReader` MeterProvider **with the same Views as Init (use the unexported helper `serverMetricViews()` that the service step added to `otel.go`, so the test and `Init` share one view list; this step does not edit `otel.go`)**, call it, collect, and assert: instrument name `rpc.server.duration`, unit `ms`, a data point with `rpc.grpc.status_code` = 5, and **no** `rpc.server.request.size|response.size|requests_per_rpc|responses_per_rpc` instruments. Also assert bucket boundaries equal `scripts/testdata/rpc-status-vectors.json#bucket_boundaries_ms` (read the file; Go SDK default = `[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]`).
4. **Resource (AC-1)**: the exported metric request carries `service.name`, `deployment.environment=staging`, `platform=xstockstrat` — decode the OTLP protobuf body with `go.opentelemetry.io/proto/otlp/collector/metrics/v1` in the receiver (`go.opentelemetry.io/proto/otlp v1.11.0` is already an indirect requirement, `go.mod:33` / `go.sum:58-59`; `go mod tidy` promotes it to direct). `TestNewResourceOmitsTradingMode` stays green (PRESERVE `@AC-1 @feature-171`).
5. **Trace correlation (AC-11)**: inside `tracer.Start(ctx, "s")` call `slog.InfoContext(ctx, ...)` through `WrapLogHandler`; decode the `/v1/logs` body and assert the record's `trace_id`/`span_id` equal the span's and severity text/number map from the slog level (use `slog.WarnContext(ctx, …)` for the AC-11 WARN row so the record carries the active span context).
6. **Failure visibility without recursion (AC-6/EXTEND `@AC-3 @feature-226`)**: update `TestInitLogsExportFailure` to install `slog.SetDefault(slog.New(WrapLogHandler(jsonHandlerOverBuffer)))`, point the exporter at a receiver returning 400 and at `http://127.0.0.1:1`, and assert the failure text reaches the stdout buffer **and** that the receiver sees no `/v1/logs` record containing the failure text (count `/v1/logs` posts after the failure; assert it carries only the test's own records).
7. **Disabled (AC-5 analogue)**: with `OTEL_ENABLED="false"`, `Init` returns no-op funcs, no provider is installed (`otel.GetMeterProvider()` is the global no-op), `WrapLogHandler(base)` returns `base` (compare with `==`), and the receiver sees zero requests.
8. **StopServer (shutdown_test.go)**: table test with fakes asserting call order (`forceFlush` before `graceful`) and that a `graceful` that never returns triggers `force` after `gracefulTimeout`. **AC-6**: `Init` with `OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:1`; assert `Init` returns in < 1 s, a unary call on a bufconn server using `otelgrpc.NewServerHandler()` returns OK, and the export failure appears on the stdout buffer only (no further OTLP attempt for the failure log).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"  # confirm >= 40%; the telemetry package is excluded from CI measurement, so no threshold applies to this step's new logic — the telemetry tests below are the proof
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/telemetry/... -race -count=1 -v
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -q 'telemetry.StopServer' services/xstockstrat-portfolio/cmd/server/main.go   # the signal goroutine really calls StopServer (cmd/ is excluded from coverage, so a unit test cannot see it)
```

---

### Step 10 — service: portfolio: move every slog call with a context in scope to its *Context variant; enforce with sloglint

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/.golangci.yml` — modify
- `services/xstockstrat-portfolio/cmd/server/main.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-portfolio/internal/config/config.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-portfolio/internal/service/offline_valuation.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (only if sloglint reports a call in it)

**Reviewers**: Service owner (`xstockstrat-portfolio`) — P&L calculation accuracy, concurrent write safety; no hot-path latency regression

**Codebase Evidence**:
- `grep -rEn 'slog\.(Info|Warn|Error|Debug)\(' services/xstockstrat-portfolio --include=*.go | grep -v _test.go | wc -l` → 45 call sites in 4 files; `*Context` variants today: 0
- `services/xstockstrat-portfolio/.golangci.yml` enables `govet, errcheck, staticcheck, ineffassign, unused` (linters block) and is byte-identical in trading, portfolio and marketdata
- golangci-lint v2.14.0 (root CLAUDE.md § Language Versions) bundles sloglint v0.12.0 with `context: scope` and `no-mixed-args` options (design.md § PR-A Go; orchestrator probe R3) — `no-mixed-args` defaults to true, so it must be set explicitly to false

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **RED first**: add `sloglint` to `linters.enable` and a `linters.settings.sloglint` block with `context: scope` and `no-mixed-args: false` (keep `kv-only`/`attr-only` unset). Run the lint command and capture the failing run (the report lists every offending call).
2. **GREEN**: rewrite each reported call: `slog.Info(msg, args...)` → `slog.InfoContext(ctx, msg, args...)` (same for Warn/Error/Debug) using the `ctx` already in scope. Do not introduce a new `ctx`, do not change messages, keys or levels (stdout bytes unchanged — PRESERVE `@AC-6 @feature-020`/`@AC-4 @feature-127`/`@AC-5 @feature-215` stdout lines), and leave calls with no context in scope untouched (sloglint `scope` only flags in-scope contexts).
3. Tests that swap `slog.SetDefault` keep working (a `*Context` call goes through the same default handler).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./...
grep -q 'sloglint' services/xstockstrat-portfolio/.golangci.yml   # fails before the step
```

---

### Step 11 — test: portfolio: retrofit gate — full suite green under sloglint (Go)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go` — modify (only if it asserted on a removed non-Context call; it is the one test file outside `internal/telemetry` that swaps `slog` or asserts log text, found by `grep -rln 'slog.SetDefault\|slog.New(' services/xstockstrat-portfolio --include=*_test.go`; if the suite is green after the retrofit no file changes)

**Reviewers**: Service owner (`xstockstrat-portfolio`) — P&L calculation accuracy, concurrent write safety; no hot-path latency regression

**Codebase Evidence**:
- `grep -rn "slog.SetDefault" services/xstockstrat-portfolio --include=*_test.go` → tests that swap the default handler (they capture `*Context` records equally)

**TDD**: `red N/A — behaviour-neutral retrofit gate; capture the green run only (tdd-gate.md explicit escape; say so in the PR body and context.md)`

**Covers**: —

**Instructions**:
1. Run the whole service suite after the retrofit; fix only test code that fails because it matched a removed call shape. The behavioural proof that a *Context call inside a span carries `trace_id` is the telemetry test of the previous test step (AC-11 trading row); this step proves the retrofit is behaviour-neutral.
2. C-13: no new fixture literal; the retrofit adds no domain test data.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # CI floor 40%: total must be >= 40.0
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 12 — service: marketdata: metrics + logs pipelines, slog bridge, bounded shutdown (Go)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/telemetry/otel.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/logbridge.go` — create
- `services/xstockstrat-marketdata/internal/telemetry/shutdown.go` — create
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify
- `services/xstockstrat-marketdata/go.mod` — modify
- `services/xstockstrat-marketdata/go.sum` — modify
- `services/xstockstrat-marketdata/internal/telemetry/otel_test.go` — modify (call-site arity only: `Init` now returns three values)

**Reviewers**: Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity, feed idempotency; stream shutdown stability

**Codebase Evidence**:
- `grep -n "func Init\|SetTracerProvider\|WithTimeout\|svcName =" services/xstockstrat-marketdata/internal/telemetry/otel.go` → `Init(ctx) (func(context.Context) error, error)` at :18, `otlptracehttp.New(ctx, WithTimeout(5s))` env-only exporter, `otel.SetTracerProvider(tp)`, `return tp.Shutdown, nil`; `newResource` at :45 (default `svcName = "marketdata"` at :48)
- `grep -n "slog.SetDefault\|telemetry.Init\|StatsHandler\|signal.Notify\|GracefulStop" services/xstockstrat-marketdata/cmd/server/main.go` → `slog.SetDefault(logger)` :43, `telemetry.Init(ctx)` :48 (before `grpc.NewServer`, so `otelgrpc.NewServerHandler()` at :187 reads the already-set global MeterProvider — `otelgrpc@v0.52.0/config.go:69` `MeterProvider: otel.GetMeterProvider()`), `signal.Notify` :202, `grpcServer.GracefulStop()` :207 then `cancel()`
- `otelgrpc@v0.52.0/config.go:87-120` creates exactly five server instruments: `rpc.server.duration` (Float64Histogram, unit `ms`), `rpc.server.request.size`, `rpc.server.response.size`, `rpc.server.requests_per_rpc`, `rpc.server.responses_per_rpc`
- Go 1.27.0 toolchain ships `log/slog.NewMultiHandler` (`$GOROOT/src/log/slog/multi_handler.go:13`); `otelslog.NewHandler(name, opts...)`/`WithLoggerProvider` (`otelslog@v0.20.0/handler.go:144,184`); `otel/log/global.SetLoggerProvider` (`otel/log@v0.21.0/global/log.go:47`); `otlploghttp.New(ctx, ...)` (`otlploghttp@v0.21.0/exporter.go:29`); `sdkmetric.NewView`/`AggregationDrop` (`sdk/metric@v1.45.0/view.go:49`, `aggregation.go:25`); `NewPeriodicReader` honours `OTEL_METRIC_EXPORT_INTERVAL` (`sdk/metric@v1.45.0/env.go:17`); `sdklog.NewBatchProcessor` honours `OTEL_BLRP_*` (`sdk/log@v0.21.0/batch.go:26-29`) — all confirmed in the module cache by the spec-time probe
- No go.mod entry for `sdk/metric`, `otlpmetrichttp`, `otel/log`, `sdk/log`, `otlploghttp` or `otelslog` today (`grep -n otel services/xstockstrat-marketdata/go.mod` → only otelgrpc v0.52.0, otel/sdk/otlptracehttp v1.45.0; `otel/metric` indirect) — **create from scratch**

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **go.mod**: add the pins (`go.opentelemetry.io/otel`, `otel/sdk`, `otel/sdk/metric`, `otel/exporters/otlp/otlpmetric/otlpmetrichttp` at **v1.45.0**; `otel/log`, `otel/sdk/log`, `otel/exporters/otlp/otlplog/otlploghttp` at **v0.21.0**; `go.opentelemetry.io/contrib/bridges/otelslog` at **v0.20.0** (all resolve against `otel` v1.45.0; the newer log modules need `otel` v1.47.0 — design.md § PR-A Go Pins; `otelgrpc` stays v0.52.0)); run `cd services/xstockstrat-marketdata && GOWORK=off go mod tidy`. Promote `otel/metric` from indirect only if tidy requires it.
2. **otel.go**: change the signature to `Init(ctx context.Context) (shutdown func(context.Context) error, forceFlush func(context.Context) error, err error)`. Disabled gate (`OTEL_ENABLED != "true"`) returns two no-op funcs (unchanged semantic). Enabled: build the Resource once with the existing `newResource(ctx)`, then (a) keep the trace provider as-is; (b) `otlpmetrichttp.New(ctx)` with **no** endpoint/url/insecure option (PLAT-3) → `sdkmetric.NewMeterProvider(sdkmetric.WithReader(sdkmetric.NewPeriodicReader(mexp)), sdkmetric.WithResource(res), sdkmetric.WithView(serverMetricViews()...))` → `otel.SetMeterProvider`; factor the Views into an unexported helper `func serverMetricViews() []sdkmetric.View` in `otel.go` (the paired test step builds its MeterProvider from the same list), whose doc comment names `rpc.server.duration` — the instrument otelgrpc creates and these Views keep, and the grep-able Go producer literal the step-49 registry points at — with one `sdkmetric.NewView(sdkmetric.Instrument{Name: X}, sdkmetric.Stream{Aggregation: sdkmetric.AggregationDrop{}})` for X in `rpc.server.request.size`, `rpc.server.response.size`, `rpc.server.requests_per_rpc`, `rpc.server.responses_per_rpc` (keeps only `rpc.server.duration`, cardinality design § PR-A Views); (c) `otlploghttp.New(ctx)` env-only → `sdklog.NewLoggerProvider(sdklog.WithProcessor(sdklog.NewBatchProcessor(lexp)), sdklog.WithResource(res))` → `global.SetLoggerProvider(lp)`. Any exporter-construction error returns `(nil, nil, err)` (non-fatal at the caller, FR-4). `shutdown` = `errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx), lp.Shutdown(ctx))`; `forceFlush` = `errors.Join(tp.ForceFlush(ctx), mp.ForceFlush(ctx), lp.ForceFlush(ctx))`.
3. **logbridge.go** (new, same package): `func WrapLogHandler(base slog.Handler) slog.Handler`. When `OTEL_ENABLED != "true"` or no logger provider was installed it returns `base` unchanged (stdout bytes identical, AC-4/AC-5). Otherwise it returns `slog.NewMultiHandler(base, otelslog.NewHandler(svcName))` (service name from the same `SERVICE_NAME` default as `newResource`) **and** calls `otel.SetErrorHandler(otel.ErrorHandlerFunc(...))` so every OTel SDK/exporter error is written through `base` only — the recursion guard, because once `slog.SetDefault` runs the stdlib `log` package (the default OTel error sink) routes into the default slog handler and would re-enter the OTLP pipeline (FR-4, R6). The record keeps the same message text so the existing `"400 Bad Request"` assertion still holds.
4. **shutdown.go** (new): `func StopServer(forceFlush func(context.Context) error, graceful func(), force func(), flushTimeout, gracefulTimeout time.Duration)`: (1) `forceFlush` under `context.WithTimeout(flushTimeout)`; (2) run `graceful()` in a goroutine and wait up to `gracefulTimeout`; on timeout call `force()` (grpc `Stop()`). Open server streams otherwise block `GracefulStop` forever and starve the flush (design R2 blocker 3).
5. **main.go**: (a) keep `slog.SetDefault(logger)` at :43 (so the init-failure Warn still prints); (b) change the `telemetry.Init` call at :48 to receive `(shutdownOtel, forceFlushOtel, err)`; (c) after a successful Init and **before** `grpc.NewServer`, call `slog.SetDefault(slog.New(telemetry.WrapLogHandler(logger.Handler())))`; (d) replace the signal goroutine body (`hs.Shutdown()` then `grpcServer.GracefulStop()` then `cancel()` at :207) with `hs.Shutdown()` then `telemetry.StopServer(forceFlushOtel, grpcServer.GracefulStop, grpcServer.Stop, 2*time.Second, 3*time.Second)` then `cancel()`; keep the deferred 5 s `shutdownOtel` (it flushes the stream-end points once `Serve` returns). Worst case ≈ 2+3+5 s, inside compose's 10 s stop grace. `os.Exit(1)` startup paths still skip the flush (accepted asymmetry, stdout keeps those lines).
6. Do **not** add any endpoint, url, headers or insecure argument to either new exporter, and add no config key and no new env var (`OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` are already set for this service in `docker-compose.yml` and both `.do/app*.yaml` — verified in step 1).
7. **Existing test call sites** (compile-only, so this step's `go vet` — which compiles `_test.go` files — can pass): in `internal/telemetry/otel_test.go` change every `shutdown, err := Init(ctx)` (currently only `exportOneSpan`, `:59`) to `shutdown, _, err := Init(ctx)`. No other test edit belongs here; the new tests are the next step.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/telemetry/... ./cmd/...
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
test -f services/xstockstrat-marketdata/internal/telemetry/logbridge.go && test -f services/xstockstrat-marketdata/internal/telemetry/shutdown.go && grep -q 'telemetry.WrapLogHandler' services/xstockstrat-marketdata/cmd/server/main.go   # fails before the step
```

---

### Step 13 — test: marketdata: telemetry tests — metrics/logs export, status code, bridge, shutdown (Go)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/telemetry/otel_test.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/shutdown_test.go` — create
- `services/xstockstrat-marketdata/go.mod` — modify (go mod tidy promotes the otlp proto module)
- `services/xstockstrat-marketdata/go.sum` — modify

**Reviewers**: Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity, feed idempotency; stream shutdown stability

**Codebase Evidence**:
- `grep -n "^func " services/xstockstrat-marketdata/internal/telemetry/otel_test.go` → `TestNewResourceOmitsTradingMode` :19, `newOTLPReceiver` :42, `exportOneSpan` :53, `TestInitExportsOverOTLPHTTP` :72 (both header forms, `/otlp/v1/traces`), `TestInitLogsExportFailure` :93 (captures stdlib `log`, asserts `"400 Bad Request"`)
- `healthpb.Watch` (grpc health v1) is a server-streaming RPC already linked into every Go service (`healthpb.RegisterHealthServer`) — usable as the 'open stream' in the shutdown test without a new proto

**TDD**: `red-green required`

**Covers**: `AC-2, AC-12, AC-18, AC-19`

**Instructions**:
1. Write the tests first and run them against the pre-implementation tree to capture RED (restore the pre-step content of only the service step's non-test source — `otel.go`, `logbridge.go`, `shutdown.go`, `cmd/server/main.go` (mechanics in Step Dependencies) — and keep `otel_test.go`, `go.mod`, `go.sum`: the telemetry test package then fails to build because the 3-value `Init`, `WrapLogHandler` and `StopServer` do not exist in that tree; that build failure is the accepted RED, and GREEN is this step's Verification).
2. Extend `exportOneSpan`'s receiver so it records every path (`/otlp/v1/traces`, `/otlp/v1/metrics`, `/otlp/v1/logs`). **Export (AC-19, EXTEND `@AC-1 @feature-226`)**: under both header forms (`Authorization=Basic dGVzdDprZXk=` and `Authorization=Basic%20dGVzdDprZXk%3D`) a recorded metric (`otel.Meter("t").Int64Counter`) and a log record (`global.GetLoggerProvider()` emit or `WrapLogHandler` + `slog.Info`) followed by `forceFlush` produce `POST /otlp/v1/metrics` and `POST /otlp/v1/logs` with `Authorization: Basic dGVzdDprZXk=`.
3. **Status/duration (AC-2)**: build a real `grpc.NewServer(grpc.StatsHandler(otelgrpc.NewServerHandler()))` over a `bufconn`/loopback listener with a tiny unary handler returning `status.Error(codes.NotFound, ...)` (register via `grpc.ServiceDesc` inline, no proto), install a `sdkmetric.NewManualReader` MeterProvider **with the same Views as Init (use the unexported helper `serverMetricViews()` that the service step added to `otel.go`, so the test and `Init` share one view list; this step does not edit `otel.go`)**, call it, collect, and assert: instrument name `rpc.server.duration`, unit `ms`, a data point with `rpc.grpc.status_code` = 5, and **no** `rpc.server.request.size|response.size|requests_per_rpc|responses_per_rpc` instruments. Also assert bucket boundaries equal `scripts/testdata/rpc-status-vectors.json#bucket_boundaries_ms` (read the file; Go SDK default = `[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]`).
4. **Resource (AC-1)**: the exported metric request carries `service.name`, `deployment.environment=staging`, `platform=xstockstrat` — decode the OTLP protobuf body with `go.opentelemetry.io/proto/otlp/collector/metrics/v1` in the receiver (`go.opentelemetry.io/proto/otlp v1.11.0` is already an indirect requirement, `go.mod:33` / `go.sum:58-59`; `go mod tidy` promotes it to direct). `TestNewResourceOmitsTradingMode` stays green (PRESERVE `@AC-1 @feature-171`).
5. **Trace correlation (AC-11)**: inside `tracer.Start(ctx, "s")` call `slog.InfoContext(ctx, ...)` through `WrapLogHandler`; decode the `/v1/logs` body and assert the record's `trace_id`/`span_id` equal the span's and severity text/number map from the slog level (use `slog.WarnContext(ctx, …)` for the AC-11 WARN row so the record carries the active span context).
6. **Failure visibility without recursion (AC-6/EXTEND `@AC-3 @feature-226`)**: update `TestInitLogsExportFailure` to install `slog.SetDefault(slog.New(WrapLogHandler(jsonHandlerOverBuffer)))`, point the exporter at a receiver returning 400 and at `http://127.0.0.1:1`, and assert the failure text reaches the stdout buffer **and** that the receiver sees no `/v1/logs` record containing the failure text (count `/v1/logs` posts after the failure; assert it carries only the test's own records).
7. **Disabled (AC-5 analogue)**: with `OTEL_ENABLED="false"`, `Init` returns no-op funcs, no provider is installed (`otel.GetMeterProvider()` is the global no-op), `WrapLogHandler(base)` returns `base` (compare with `==`), and the receiver sees zero requests.
8. **StopServer (shutdown_test.go)**: table test with fakes asserting call order (`forceFlush` before `graceful`) and that a `graceful` that never returns triggers `force` after `gracefulTimeout`. **AC-12/AC-18**: with `OTEL_METRIC_EXPORT_INTERVAL=600000`, run a real `grpc.Server` (health service) with an open `Watch` stream held by a client, serve 2 unary calls and log 3 INFO records through `WrapLogHandler`, then call `StopServer(forceFlush, srv.GracefulStop, srv.Stop, 2s, 3s)` followed by `shutdown(ctx)`; assert the receiver got `/v1/metrics` with the 2 data points and `/v1/logs` with the 3 records and that the whole sequence returns within 10 s.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"  # confirm >= 40%; the telemetry package is excluded from CI measurement, so no threshold applies to this step's new logic — the telemetry tests below are the proof
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/telemetry/... -race -count=1 -v
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -q 'telemetry.StopServer' services/xstockstrat-marketdata/cmd/server/main.go   # the signal goroutine really calls StopServer (cmd/ is excluded from coverage, so a unit test cannot see it)
```

---

### Step 14 — service: marketdata: move every slog call with a context in scope to its *Context variant; enforce with sloglint

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/.golangci.yml` — modify
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-marketdata/internal/config/config.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-marketdata/internal/alpaca/stream.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (only if sloglint reports a call in it)
- `services/xstockstrat-marketdata/internal/service/classification_service.go` — modify (only if sloglint reports a call in it)

**Reviewers**: Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity, feed idempotency; stream shutdown stability

**Codebase Evidence**:
- `grep -rEn 'slog\.(Info|Warn|Error|Debug)\(' services/xstockstrat-marketdata --include=*.go | grep -v _test.go | wc -l` → 73 call sites in 5 files; `*Context` variants today: 14
- `services/xstockstrat-marketdata/.golangci.yml` enables `govet, errcheck, staticcheck, ineffassign, unused` (linters block) and is byte-identical in trading, portfolio and marketdata
- golangci-lint v2.14.0 (root CLAUDE.md § Language Versions) bundles sloglint v0.12.0 with `context: scope` and `no-mixed-args` options (design.md § PR-A Go; orchestrator probe R3) — `no-mixed-args` defaults to true, so it must be set explicitly to false

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **RED first**: add `sloglint` to `linters.enable` and a `linters.settings.sloglint` block with `context: scope` and `no-mixed-args: false` (keep `kv-only`/`attr-only` unset). Run the lint command and capture the failing run (the report lists every offending call).
2. **GREEN**: rewrite each reported call: `slog.Info(msg, args...)` → `slog.InfoContext(ctx, msg, args...)` (same for Warn/Error/Debug) using the `ctx` already in scope. Do not introduce a new `ctx`, do not change messages, keys or levels (stdout bytes unchanged — PRESERVE `@AC-6 @feature-020`/`@AC-4 @feature-127`/`@AC-5 @feature-215` stdout lines), and leave calls with no context in scope untouched (sloglint `scope` only flags in-scope contexts).
3. Tests that swap `slog.SetDefault` keep working (a `*Context` call goes through the same default handler).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./...
grep -q 'sloglint' services/xstockstrat-marketdata/.golangci.yml   # fails before the step
```

---

### Step 15 — test: marketdata: retrofit gate — full suite green under sloglint (Go)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (only if it asserted on a removed non-Context call; it is the one test file outside `internal/telemetry` that swaps `slog` or asserts log text, found by `grep -rln 'slog.SetDefault\|slog.New(' services/xstockstrat-marketdata --include=*_test.go`; if the suite is green after the retrofit no file changes)

**Reviewers**: Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity, feed idempotency; stream shutdown stability

**Codebase Evidence**:
- `grep -rn "slog.SetDefault" services/xstockstrat-marketdata --include=*_test.go` → tests that swap the default handler (they capture `*Context` records equally)

**TDD**: `red N/A — behaviour-neutral retrofit gate; capture the green run only (tdd-gate.md explicit escape; say so in the PR body and context.md)`

**Covers**: —

**Instructions**:
1. Run the whole service suite after the retrofit; fix only test code that fails because it matched a removed call shape. The behavioural proof that a *Context call inside a span carries `trace_id` is the telemetry test of the previous test step (AC-11 trading row); this step proves the retrofit is behaviour-neutral.
2. C-13: no new fixture literal; the retrofit adds no domain test data.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # CI floor 40%: total must be >= 40.0
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 16 — service: indicators: meter + logger providers, logging bridge, span-derived rpc.server.duration, cancel/deadline interceptor (Python)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/telemetry.py` — modify
- `services/xstockstrat-indicators/app/main.py` — modify
- `services/xstockstrat-indicators/pyproject.toml` — modify (add `opentelemetry-instrumentation-logging>=0.66b1`, D8)
- `services/xstockstrat-indicators/uv.lock` — modify (`uv lock`, same commit)

**Reviewers**: Service owner (`xstockstrat-indicators`) — formula sandboxing, timeout enforcement (`indicators.sandbox.timeout_ms`) unaffected

**Codebase Evidence**:
- `services/xstockstrat-indicators/app/telemetry.py`: `_build_resource` :13, `init_telemetry` :27 (gate `OTEL_ENABLED` :29), `OTLPSpanExporter()` no-arg, `BatchSpanProcessor`, `trace.set_tracer_provider(provider)`, `GrpcAioInstrumentorServer().instrument()`, `except Exception` → `log.warning("OTel init failed — continuing without tracing: %s", exc)`
- `services/xstockstrat-indicators/app/main.py`: `logging.basicConfig` :28, `init_telemetry()` :43, `grpc.aio.server()` :74, SIGTERM `signal.signal` :93 (grep: `grep -n "basicConfig\|init_telemetry\|grpc.aio.server\|signal.signal" services/xstockstrat-indicators/app/main.py`)
- `services/xstockstrat-indicators/uv.lock`: `opentelemetry-sdk` 1.45.1, `opentelemetry-exporter-otlp-proto-http` 1.45.1, `opentelemetry-instrumentation-grpc` 0.66b1; `pyproject.toml` floors `>=1.25.0`/`>=1.25.0`/`>=0.46b0` (unchanged), plus the new `opentelemetry-instrumentation-logging>=0.66b1` added by this step (D8)
- Pinned-SDK probe at 1.45.1/0.66b1 (this spec, venv `/tmp/probe-py`): no meter/histogram in `instrumentation/grpc/`; `_OpenTelemetryAioServicerContext.abort`/`set_code` set `RPC_GRPC_STATUS_CODE` (`_aio_server.py:29-48`); uncaught non-bare exceptions are recorded via `span.record_exception` and re-raised (`_aio_server.py:109-116`); `_server_status` maps UNKNOWN/DEADLINE_EXCEEDED/UNIMPLEMENTED/INTERNAL/UNAVAILABLE/DATA_LOSS to ERROR (`_utilities.py:29-40`)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Versions and dependency (design deviations D1, D8)**: do **not** change the existing `opentelemetry-sdk`/`exporter-otlp-proto-http`/`instrumentation-grpc` entries. The four locks already resolve `opentelemetry-sdk`/`exporter-otlp-proto-http` **1.45.1** and `opentelemetry-instrumentation-grpc` **0.66b1** (`uv.lock`; recon/design assumed 1.42.1/0.63b1 and a lagging ingest — stale). The probe was re-run at 1.45.1/0.66b1: instrumentation-grpc still has no meter/histogram code, `context.abort`/`set_code` still set `rpc.grpc.status_code` (`_aio_server.py:29-48`), and the SDK `LoggingHandler` still exists but its constructor emits a `DeprecationWarning` (`sdk/_logs/_internal/__init__.py:615-619`). **Log handler (D8, operator decision 2026-10-30)**: use the successor in `opentelemetry-instrumentation-logging`: add `"opentelemetry-instrumentation-logging>=0.66b1",` to `pyproject.toml` `dependencies` beside the other `opentelemetry-*` lines, run `uv lock` in the service directory and stage `pyproject.toml` and `uv.lock` together (root `CLAUDE.md` uv lock rule; the `python-lint` job runs `uv lock --check`). Spec-time probe in a throwaway venv (`opentelemetry-sdk==1.45.1` + `opentelemetry-instrumentation-logging==0.66b1`): `from opentelemetry.instrumentation.logging.handler import LoggingHandler` imports with `DeprecationWarning` promoted to an error; constructor `(level=0, logger_provider=None, log_code_attributes=False)`; a WARNING logged inside a span exports with severity `WARN` and `trace_id`/`span_id` equal to the span's, and outside a span with zeros; with no `extra=` it adds no attributes; the `opentelemetry*` logger-name filter drops export-failure records. If `uv lock` cannot resolve it, escalate (P-03).
2. In `init_telemetry()` (inside the existing `try`, after the span-processor setup and `trace.set_tracer_provider(provider)`), add deferred imports and build, **reusing `resource = _build_resource()`**: `PeriodicExportingMetricReader(OTLPMetricExporter())` → `MeterProvider(resource=resource, metric_readers=[reader])` → `opentelemetry.metrics.set_meter_provider(...)`; `LoggerProvider(resource=resource)` + `add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))` → `opentelemetry._logs.set_logger_provider(...)`. Import paths verified at 1.45.1: `opentelemetry.exporter.otlp.proto.http.metric_exporter.OTLPMetricExporter`, `opentelemetry.exporter.otlp.proto.http._log_exporter.OTLPLogExporter`, `opentelemetry.sdk.metrics.export.PeriodicExportingMetricReader`, `opentelemetry.sdk._logs.LoggerProvider`, `opentelemetry.instrumentation.logging.handler.LoggingHandler` (D8; not the deprecated SDK class), `opentelemetry.sdk._logs.export.BatchLogRecordProcessor`. Exporters take **no** arguments (PLAT-3). Do not add explicit shutdown/atexit calls: both providers register their own `atexit` shutdown (`sdk/metrics/_internal/__init__.py:464`, `sdk/_logs/_internal/__init__.py:898`), which flushes on the normal interpreter exit the existing SIGTERM handler leads to.
3. **Log bridge**: after the providers are installed, create `handler = LoggingHandler(level=logging.NOTSET, logger_provider=logger_provider)` using `from opentelemetry.instrumentation.logging.handler import LoggingHandler` (not the deprecated `opentelemetry.sdk._logs.LoggingHandler`; leave `log_code_attributes` at its default `False`; no warning suppression is needed), add `handler.addFilter(lambda r: not r.name.startswith("opentelemetry"))` (recursion guard — SDK/exporter failures stay stdout-only, FR-4/R6), then `logging.getLogger().addHandler(handler)`. `logging.basicConfig` runs at import time before `init_telemetry` (see main.py evidence), so the stdout StreamHandler and format are untouched (AC-4 analogue). The handler builds record attributes from `vars(record)` minus reserved keys (`opentelemetry/instrumentation/logging/handler.py:140`; `code.*` attributes only when `log_code_attributes=True`, `:153`): it adds nothing the stdout line does not already print except `extra=` keys the caller supplied (FR-5; the egress audit in step 3 covers every `extra=` site).
4. **RPC recorder** (design § PR-A Python): add `class _RpcDurationProcessor(SpanProcessor)` to `app/telemetry.py` (import `opentelemetry.sdk.trace.SpanProcessor`, `opentelemetry.trace.SpanKind`/`StatusCode`). In `on_end(span)`: ignore unless `span.kind == SpanKind.SERVER` and `span.attributes.get("rpc.system") == "grpc"`; compute `duration_ms = (span.end_time - span.start_time) / 1e6`; record on a lazily created `meter.create_histogram("rpc.server.duration", unit="ms")` (meter from the **installed** provider, created on first use) with exactly the attributes `rpc.system`, `rpc.service`, `rpc.method` and an **integer** `rpc.grpc.status_code`, and an explicit bucket view/`explicit_bucket_boundaries_advisory=[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]` matching `scripts/testdata/rpc-status-vectors.json#bucket_boundaries_ms`. Status rule, first match wins: (1) a non-zero integer `rpc.grpc.status_code` attribute is used as-is (`abort`/`set_code` set it before raising); (2) any span event named `exception` → 2 (covers a bare `raise Exception`, which `use_span` records at `trace/__init__.py:612-619`); (3) span status `ERROR` → 2; (4) else 0. Attach with `provider.add_span_processor(_RpcDurationProcessor(...))` on the tracer provider.
5. **Deadline/cancel interceptor** (operator R3 decision 'Small interceptor'): add `class _CancelStatusInterceptor(grpc.aio.ServerInterceptor)` to `app/telemetry.py` whose `intercept_service` wraps the continuation's handler behaviours (unary and stream) so that on `asyncio.CancelledError` it calls `trace.get_current_span().set_attribute("rpc.grpc.status_code", 4 if context.time_remaining() is not None and context.time_remaining() <= 0 else 1)` and re-raises. Expose `def server_interceptors() -> list` returning `[_CancelStatusInterceptor()]` when telemetry is enabled and `[]` otherwise (no behaviour change when `OTEL_ENABLED != "true"`).
6. **Server wiring** (`app/main.py`): change `grpc.aio.server()` to `grpc.aio.server(interceptors=server_interceptors())` (import from `app.telemetry`). `GrpcAioInstrumentorServer` patches `grpc.aio.server` and inserts the OTel interceptor **first** (`opentelemetry/instrumentation/grpc/__init__.py:371-381`), so ours is inner: the `CancelledError` passes through our wrapper (stamping the live span) before the OTel wrapper's `except Exception` (which ignores `BaseException`) and the span closes with the attribute set. Mind ordering: `init_telemetry()` must still run before `grpc.aio.server(...)` (it does: main.py `serve()` calls it first). Today the server is created with **no** interceptors (`grpc.aio.server()`), so this is a new argument, not an append (design said 'existing `interceptors=` list' — deviation D2). Credentials are untouched: `add_secure_port(..., mtls.server_credentials())` stays (PRESERVE `@AC-4`/`@AC-5 @feature-210`).

**Verification**:
```bash
cd services/xstockstrat-indicators && python -c "import ast,sys; ast.parse(open('app/telemetry.py').read()); ast.parse(open('app/main.py').read())"
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
cd services/xstockstrat-indicators && uv lock --check   # pyproject.toml and uv.lock in sync (D8)
grep -q 'opentelemetry-instrumentation-logging' services/xstockstrat-indicators/pyproject.toml && grep -q 'opentelemetry.instrumentation.logging.handler' services/xstockstrat-indicators/app/telemetry.py   # fails before the step (D8)
```

---

### Step 17 — test: indicators: telemetry tests — metrics/logs export, status vectors, recorder, subprocess flush (Python)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_telemetry.py` — modify
- `services/xstockstrat-indicators/tests/conftest.py` — modify

**Reviewers**: Service owner (`xstockstrat-indicators`) — formula sandboxing, timeout enforcement (`indicators.sandbox.timeout_ms`) unaffected

**Codebase Evidence**:
- `grep -n "def otel_reset" -A16 services/xstockstrat-indicators/tests/conftest.py` → monkeypatches `trace._TRACER_PROVIDER_SET_ONCE`/`_TRACER_PROVIDER`, `NO_PROXY`, stubs `GrpcAioInstrumentorServer.instrument`, shuts the provider down in teardown (resets only the tracer provider today)
- `services/xstockstrat-indicators/tests/test_telemetry.py`: `_start_receiver` :21, `_export_one_span` :36, `test_init_exports_over_otlp_http` (both header forms), `test_init_logs_export_failure`
- Private set-once attributes at 1.45.1: `opentelemetry.metrics._internal._METER_PROVIDER_SET_ONCE`/`_METER_PROVIDER` (`metrics/_internal/__init__.py:832-833`) and `opentelemetry._logs._internal._LOGGER_PROVIDER_SET_ONCE` and `_LOGGER_PROVIDER` (`_logs/_internal/__init__.py:422-423`); patch via `monkeypatch.setattr(opentelemetry._logs._internal, ...)`

**TDD**: `red-green required`

**Covers**: `AC-2, AC-10, AC-15, AC-19, AC-22`

**Instructions**:
1. Write first, capture RED against the pre-implementation tree.
2. **conftest**: extend `otel_reset` to also reset the meter and logger provider set-once state (`Once()` + `None`), remove the `LoggingHandler`s that `init_telemetry` added to the root logger on teardown, and shut the new providers down. This is the shared fixture home (C-13) — no inline copy in test files.
3. **Export (AC-19, EXTEND `@AC-1 @feature-226`)**: extend `_start_receiver` to record paths; under both header forms, after `init_telemetry()`, record one counter and one `logging.getLogger("t").warning(...)`, call `force_flush()` on the meter and logger providers, and assert `/otlp/v1/metrics` and `/otlp/v1/logs` were POSTed with `Authorization: Basic dGVzdDprZXk=`.
4. **Resource (AC-10 indicators row)**: the decoded metric request carries `service.name`, `deployment.environment`, `platform=xstockstrat`.
5. **Status vectors (AC-15)**: parametrize over `scripts/testdata/rpc-status-vectors.json` (resolve the repo root from `__file__`); for each Python-applicable vector build a real SDK span (kind SERVER, `rpc.system=grpc`, attributes/events/status per the vector), end it through a `TracerProvider` carrying `_RpcDurationProcessor`, and assert the recorded integer `rpc.grpc.status_code` equals the vector's expected code and the data point uses the shared bucket boundaries.
6. **Failure visibility without recursion (EXTEND `@AC-3 @feature-226`)**: with the receiver returning 400, assert `caplog` (stdout path) still contains `code: 400` and that **no** `/v1/logs` record's body contains it (the `opentelemetry*` filter).
7. **Disabled**: with `OTEL_ENABLED=false`, `init_telemetry()` installs no provider and adds no handler (`logging.getLogger().handlers` unchanged), and `server_interceptors()` is `[]`.
8. **Subprocess flush (design: SIGTERM test proves the atexit flush)**: spawn `python -c` with a child that mirrors the service's real shutdown shape: `asyncio.run(main())` where `main()` calls `init_telemetry()` with `OTEL_METRIC_EXPORT_INTERVAL=600000`, records 2 counter points and 3 INFO logs, installs `signal.signal(SIGTERM, handler)` whose handler only schedules a task that sets an `asyncio.Event` (as `handle_shutdown` in `app/main.py` only schedules `grpc_server.stop`/`db_pool.close`), and awaits that event so `main()` returns and the interpreter exits **normally** (no `sys.exit`, no `os._exit`); the parent sends SIGTERM and asserts the receiver got `/v1/metrics` and `/v1/logs` before the child exits. Because the child models the handler instead of running it, also add a static test that reads the real `app/main.py` and asserts it contains neither `os._exit` nor `sys.exit` (true today in all four Python services), so the exit path the child proves is the one the service takes. **Handler import path (D8)**: assert `type(h).__module__ == 'opentelemetry.instrumentation.logging.handler'` for the handler `init_telemetry` installed on the root logger.
9. **AC-22**: start a real `grpc.aio.server(interceptors=[_CancelStatusInterceptor()])` on loopback (build it as `grpc.aio.server(interceptors=[aio_server_interceptor(tracer_provider=tp), _CancelStatusInterceptor()])` using the public `opentelemetry.instrumentation.grpc.aio_server_interceptor` (`instrumentation/grpc/__init__.py:643`) with the test's own TracerProvider, because `otel_reset` stubs `GrpcAioInstrumentorServer.instrument` to a no-op) hosting a sleeping unary method; a client with `timeout=0.05` must yield a recorded `rpc.grpc.status_code=4`, and a task cancelled by the client yields `1` (read the `InMemoryMetricReader`).

**Verification**:
```bash
cd services/xstockstrat-indicators && pytest --cov=app --cov-fail-under=50
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
```

---

### Step 18 — service: ingest: meter + logger providers, logging bridge, span-derived rpc.server.duration, cancel/deadline interceptor (Python)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/telemetry.py` — modify
- `services/xstockstrat-ingest/app/main.py` — modify
- `services/xstockstrat-ingest/pyproject.toml` — modify (add `opentelemetry-instrumentation-logging>=0.66b1`, D8)
- `services/xstockstrat-ingest/uv.lock` — modify (`uv lock`, same commit)

**Reviewers**: Service owner (`xstockstrat-ingest`) — signal normalization, idempotent ingestion; no bearer/secret plaintext in logs

**Codebase Evidence**:
- `services/xstockstrat-ingest/app/telemetry.py`: `_build_resource` :13, `init_telemetry` :27 (gate `OTEL_ENABLED` :29), `OTLPSpanExporter()` no-arg, `BatchSpanProcessor`, `trace.set_tracer_provider(provider)`, `GrpcAioInstrumentorServer().instrument()`, `except Exception` → `log.warning("OTel init failed — continuing without tracing: %s", exc)`
- `services/xstockstrat-ingest/app/main.py`: `logging.basicConfig` :28, `init_telemetry()` :44, `grpc.aio.server()` :104, SIGTERM `signal.signal` :140 (grep: `grep -n "basicConfig\|init_telemetry\|grpc.aio.server\|signal.signal" services/xstockstrat-ingest/app/main.py`)
- `services/xstockstrat-ingest/uv.lock`: `opentelemetry-sdk` 1.45.1, `opentelemetry-exporter-otlp-proto-http` 1.45.1, `opentelemetry-instrumentation-grpc` 0.66b1; `pyproject.toml` floors `>=1.25.0`/`>=1.25.0`/`>=0.46b0` (unchanged), plus the new `opentelemetry-instrumentation-logging>=0.66b1` added by this step (D8)
- Pinned-SDK probe at 1.45.1/0.66b1 (this spec, venv `/tmp/probe-py`): no meter/histogram in `instrumentation/grpc/`; `_OpenTelemetryAioServicerContext.abort`/`set_code` set `RPC_GRPC_STATUS_CODE` (`_aio_server.py:29-48`); uncaught non-bare exceptions are recorded via `span.record_exception` and re-raised (`_aio_server.py:109-116`); `_server_status` maps UNKNOWN/DEADLINE_EXCEEDED/UNIMPLEMENTED/INTERNAL/UNAVAILABLE/DATA_LOSS to ERROR (`_utilities.py:29-40`)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Versions and dependency (design deviations D1, D8)**: do **not** change the existing `opentelemetry-sdk`/`exporter-otlp-proto-http`/`instrumentation-grpc` entries. The four locks already resolve `opentelemetry-sdk`/`exporter-otlp-proto-http` **1.45.1** and `opentelemetry-instrumentation-grpc` **0.66b1** (`uv.lock`; recon/design assumed 1.42.1/0.63b1 and a lagging ingest — stale). The probe was re-run at 1.45.1/0.66b1: instrumentation-grpc still has no meter/histogram code, `context.abort`/`set_code` still set `rpc.grpc.status_code` (`_aio_server.py:29-48`), and the SDK `LoggingHandler` still exists but its constructor emits a `DeprecationWarning` (`sdk/_logs/_internal/__init__.py:615-619`). **Log handler (D8, operator decision 2026-10-30)**: use the successor in `opentelemetry-instrumentation-logging`: add `"opentelemetry-instrumentation-logging>=0.66b1",` to `pyproject.toml` `dependencies` beside the other `opentelemetry-*` lines, run `uv lock` in the service directory and stage `pyproject.toml` and `uv.lock` together (root `CLAUDE.md` uv lock rule; the `python-lint` job runs `uv lock --check`). Spec-time probe in a throwaway venv (`opentelemetry-sdk==1.45.1` + `opentelemetry-instrumentation-logging==0.66b1`): `from opentelemetry.instrumentation.logging.handler import LoggingHandler` imports with `DeprecationWarning` promoted to an error; constructor `(level=0, logger_provider=None, log_code_attributes=False)`; a WARNING logged inside a span exports with severity `WARN` and `trace_id`/`span_id` equal to the span's, and outside a span with zeros; with no `extra=` it adds no attributes; the `opentelemetry*` logger-name filter drops export-failure records. If `uv lock` cannot resolve it, escalate (P-03).
2. In `init_telemetry()` (inside the existing `try`, after the span-processor setup and `trace.set_tracer_provider(provider)`), add deferred imports and build, **reusing `resource = _build_resource()`**: `PeriodicExportingMetricReader(OTLPMetricExporter())` → `MeterProvider(resource=resource, metric_readers=[reader])` → `opentelemetry.metrics.set_meter_provider(...)`; `LoggerProvider(resource=resource)` + `add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))` → `opentelemetry._logs.set_logger_provider(...)`. Import paths verified at 1.45.1: `opentelemetry.exporter.otlp.proto.http.metric_exporter.OTLPMetricExporter`, `opentelemetry.exporter.otlp.proto.http._log_exporter.OTLPLogExporter`, `opentelemetry.sdk.metrics.export.PeriodicExportingMetricReader`, `opentelemetry.sdk._logs.LoggerProvider`, `opentelemetry.instrumentation.logging.handler.LoggingHandler` (D8; not the deprecated SDK class), `opentelemetry.sdk._logs.export.BatchLogRecordProcessor`. Exporters take **no** arguments (PLAT-3). Do not add explicit shutdown/atexit calls: both providers register their own `atexit` shutdown (`sdk/metrics/_internal/__init__.py:464`, `sdk/_logs/_internal/__init__.py:898`), which flushes on the normal interpreter exit the existing SIGTERM handler leads to.
3. **Log bridge**: after the providers are installed, create `handler = LoggingHandler(level=logging.NOTSET, logger_provider=logger_provider)` using `from opentelemetry.instrumentation.logging.handler import LoggingHandler` (not the deprecated `opentelemetry.sdk._logs.LoggingHandler`; leave `log_code_attributes` at its default `False`; no warning suppression is needed), add `handler.addFilter(lambda r: not r.name.startswith("opentelemetry"))` (recursion guard — SDK/exporter failures stay stdout-only, FR-4/R6), then `logging.getLogger().addHandler(handler)`. `logging.basicConfig` runs at import time before `init_telemetry` (see main.py evidence), so the stdout StreamHandler and format are untouched (AC-4 analogue). The handler builds record attributes from `vars(record)` minus reserved keys (`opentelemetry/instrumentation/logging/handler.py:140`; `code.*` attributes only when `log_code_attributes=True`, `:153`): it adds nothing the stdout line does not already print except `extra=` keys the caller supplied (FR-5; the egress audit in step 3 covers every `extra=` site).
4. **RPC recorder** (design § PR-A Python): add `class _RpcDurationProcessor(SpanProcessor)` to `app/telemetry.py` (import `opentelemetry.sdk.trace.SpanProcessor`, `opentelemetry.trace.SpanKind`/`StatusCode`). In `on_end(span)`: ignore unless `span.kind == SpanKind.SERVER` and `span.attributes.get("rpc.system") == "grpc"`; compute `duration_ms = (span.end_time - span.start_time) / 1e6`; record on a lazily created `meter.create_histogram("rpc.server.duration", unit="ms")` (meter from the **installed** provider, created on first use) with exactly the attributes `rpc.system`, `rpc.service`, `rpc.method` and an **integer** `rpc.grpc.status_code`, and an explicit bucket view/`explicit_bucket_boundaries_advisory=[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]` matching `scripts/testdata/rpc-status-vectors.json#bucket_boundaries_ms`. Status rule, first match wins: (1) a non-zero integer `rpc.grpc.status_code` attribute is used as-is (`abort`/`set_code` set it before raising); (2) any span event named `exception` → 2 (covers a bare `raise Exception`, which `use_span` records at `trace/__init__.py:612-619`); (3) span status `ERROR` → 2; (4) else 0. Attach with `provider.add_span_processor(_RpcDurationProcessor(...))` on the tracer provider.
5. **Deadline/cancel interceptor** (operator R3 decision 'Small interceptor'): add `class _CancelStatusInterceptor(grpc.aio.ServerInterceptor)` to `app/telemetry.py` whose `intercept_service` wraps the continuation's handler behaviours (unary and stream) so that on `asyncio.CancelledError` it calls `trace.get_current_span().set_attribute("rpc.grpc.status_code", 4 if context.time_remaining() is not None and context.time_remaining() <= 0 else 1)` and re-raises. Expose `def server_interceptors() -> list` returning `[_CancelStatusInterceptor()]` when telemetry is enabled and `[]` otherwise (no behaviour change when `OTEL_ENABLED != "true"`).
6. **Server wiring** (`app/main.py`): change `grpc.aio.server()` to `grpc.aio.server(interceptors=server_interceptors())` (import from `app.telemetry`). `GrpcAioInstrumentorServer` patches `grpc.aio.server` and inserts the OTel interceptor **first** (`opentelemetry/instrumentation/grpc/__init__.py:371-381`), so ours is inner: the `CancelledError` passes through our wrapper (stamping the live span) before the OTel wrapper's `except Exception` (which ignores `BaseException`) and the span closes with the attribute set. Mind ordering: `init_telemetry()` must still run before `grpc.aio.server(...)` (it does: main.py `serve()` calls it first). Today the server is created with **no** interceptors (`grpc.aio.server()`), so this is a new argument, not an append (design said 'existing `interceptors=` list' — deviation D2). Credentials are untouched: `add_secure_port(..., mtls.server_credentials())` stays (PRESERVE `@AC-4`/`@AC-5 @feature-210`).

**Verification**:
```bash
cd services/xstockstrat-ingest && python -c "import ast,sys; ast.parse(open('app/telemetry.py').read()); ast.parse(open('app/main.py').read())"
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
cd services/xstockstrat-ingest && uv lock --check   # pyproject.toml and uv.lock in sync (D8)
grep -q 'opentelemetry-instrumentation-logging' services/xstockstrat-ingest/pyproject.toml && grep -q 'opentelemetry.instrumentation.logging.handler' services/xstockstrat-ingest/app/telemetry.py   # fails before the step (D8)
```

---

### Step 19 — test: ingest: telemetry tests — metrics/logs export, status vectors, recorder, subprocess flush (Python)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_telemetry.py` — modify
- `services/xstockstrat-ingest/tests/conftest.py` — modify

**Reviewers**: Service owner (`xstockstrat-ingest`) — signal normalization, idempotent ingestion; no bearer/secret plaintext in logs

**Codebase Evidence**:
- `grep -n "def otel_reset" -A16 services/xstockstrat-ingest/tests/conftest.py` → monkeypatches `trace._TRACER_PROVIDER_SET_ONCE`/`_TRACER_PROVIDER`, `NO_PROXY`, stubs `GrpcAioInstrumentorServer.instrument`, shuts the provider down in teardown (resets only the tracer provider today)
- `services/xstockstrat-ingest/tests/test_telemetry.py`: `_start_receiver` :21, `_export_one_span` :36, `test_init_exports_over_otlp_http` (both header forms), `test_init_logs_export_failure`
- Private set-once attributes at 1.45.1: `opentelemetry.metrics._internal._METER_PROVIDER_SET_ONCE`/`_METER_PROVIDER` (`metrics/_internal/__init__.py:832-833`) and `opentelemetry._logs._internal._LOGGER_PROVIDER_SET_ONCE` and `_LOGGER_PROVIDER` (`_logs/_internal/__init__.py:422-423`); patch via `monkeypatch.setattr(opentelemetry._logs._internal, ...)`

**TDD**: `red-green required`

**Covers**: `AC-2, AC-15, AC-19, AC-22`

**Instructions**:
1. Write first, capture RED against the pre-implementation tree.
2. **conftest**: extend `otel_reset` to also reset the meter and logger provider set-once state (`Once()` + `None`), remove the `LoggingHandler`s that `init_telemetry` added to the root logger on teardown, and shut the new providers down. This is the shared fixture home (C-13) — no inline copy in test files.
3. **Export (AC-19, EXTEND `@AC-1 @feature-226`)**: extend `_start_receiver` to record paths; under both header forms, after `init_telemetry()`, record one counter and one `logging.getLogger("t").warning(...)`, call `force_flush()` on the meter and logger providers, and assert `/otlp/v1/metrics` and `/otlp/v1/logs` were POSTed with `Authorization: Basic dGVzdDprZXk=`.
4. **Resource**: same assertion as the indicators instance.
5. **Status vectors (AC-15)**: parametrize over `scripts/testdata/rpc-status-vectors.json` (resolve the repo root from `__file__`); for each Python-applicable vector build a real SDK span (kind SERVER, `rpc.system=grpc`, attributes/events/status per the vector), end it through a `TracerProvider` carrying `_RpcDurationProcessor`, and assert the recorded integer `rpc.grpc.status_code` equals the vector's expected code and the data point uses the shared bucket boundaries.
6. **Failure visibility without recursion (EXTEND `@AC-3 @feature-226`)**: with the receiver returning 400, assert `caplog` (stdout path) still contains `code: 400` and that **no** `/v1/logs` record's body contains it (the `opentelemetry*` filter).
7. **Disabled**: with `OTEL_ENABLED=false`, `init_telemetry()` installs no provider and adds no handler (`logging.getLogger().handlers` unchanged), and `server_interceptors()` is `[]`.
8. **Subprocess flush (design: SIGTERM test proves the atexit flush)**: spawn `python -c` with a child that mirrors the service's real shutdown shape: `asyncio.run(main())` where `main()` calls `init_telemetry()` with `OTEL_METRIC_EXPORT_INTERVAL=600000`, records 2 counter points and 3 INFO logs, installs `signal.signal(SIGTERM, handler)` whose handler only schedules a task that sets an `asyncio.Event` (as `handle_shutdown` in `app/main.py` only schedules `grpc_server.stop`/`db_pool.close`), and awaits that event so `main()` returns and the interpreter exits **normally** (no `sys.exit`, no `os._exit`); the parent sends SIGTERM and asserts the receiver got `/v1/metrics` and `/v1/logs` before the child exits. Because the child models the handler instead of running it, also add a static test that reads the real `app/main.py` and asserts it contains neither `os._exit` nor `sys.exit` (true today in all four Python services), so the exit path the child proves is the one the service takes. **Handler import path (D8)**: assert `type(h).__module__ == 'opentelemetry.instrumentation.logging.handler'` for the handler `init_telemetry` installed on the root logger.
9. **AC-22 (ingest instance)**: same deadline/cancel assertions against a minimal sleeping servicer.

**Verification**:
```bash
cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
```

---

### Step 20 — service: analysis: meter + logger providers, logging bridge, span-derived rpc.server.duration, cancel/deadline interceptor (Python)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/telemetry.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify
- `services/xstockstrat-analysis/pyproject.toml` — modify (add `opentelemetry-instrumentation-logging>=0.66b1`, D8)
- `services/xstockstrat-analysis/uv.lock` — modify (`uv lock`, same commit)

**Reviewers**: Service owner (`xstockstrat-analysis`) — backtest reproducibility, scoring determinism

**Codebase Evidence**:
- `services/xstockstrat-analysis/app/telemetry.py`: `_build_resource` :13, `init_telemetry` :27 (gate `OTEL_ENABLED` :29), `OTLPSpanExporter()` no-arg, `BatchSpanProcessor`, `trace.set_tracer_provider(provider)`, `GrpcAioInstrumentorServer().instrument()`, `except Exception` → `log.warning("OTel init failed — continuing without tracing: %s", exc)`
- `services/xstockstrat-analysis/app/main.py`: `logging.basicConfig` :25, `init_telemetry()` :41, `grpc.aio.server()` :107, SIGTERM `signal.signal` :124 (grep: `grep -n "basicConfig\|init_telemetry\|grpc.aio.server\|signal.signal" services/xstockstrat-analysis/app/main.py`)
- `services/xstockstrat-analysis/uv.lock`: `opentelemetry-sdk` 1.45.1, `opentelemetry-exporter-otlp-proto-http` 1.45.1, `opentelemetry-instrumentation-grpc` 0.66b1; `pyproject.toml` floors `>=1.25.0`/`>=1.25.0`/`>=0.46b0` (unchanged), plus the new `opentelemetry-instrumentation-logging>=0.66b1` added by this step (D8)
- Pinned-SDK probe at 1.45.1/0.66b1 (this spec, venv `/tmp/probe-py`): no meter/histogram in `instrumentation/grpc/`; `_OpenTelemetryAioServicerContext.abort`/`set_code` set `RPC_GRPC_STATUS_CODE` (`_aio_server.py:29-48`); uncaught non-bare exceptions are recorded via `span.record_exception` and re-raised (`_aio_server.py:109-116`); `_server_status` maps UNKNOWN/DEADLINE_EXCEEDED/UNIMPLEMENTED/INTERNAL/UNAVAILABLE/DATA_LOSS to ERROR (`_utilities.py:29-40`)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Versions and dependency (design deviations D1, D8)**: do **not** change the existing `opentelemetry-sdk`/`exporter-otlp-proto-http`/`instrumentation-grpc` entries. The four locks already resolve `opentelemetry-sdk`/`exporter-otlp-proto-http` **1.45.1** and `opentelemetry-instrumentation-grpc` **0.66b1** (`uv.lock`; recon/design assumed 1.42.1/0.63b1 and a lagging ingest — stale). The probe was re-run at 1.45.1/0.66b1: instrumentation-grpc still has no meter/histogram code, `context.abort`/`set_code` still set `rpc.grpc.status_code` (`_aio_server.py:29-48`), and the SDK `LoggingHandler` still exists but its constructor emits a `DeprecationWarning` (`sdk/_logs/_internal/__init__.py:615-619`). **Log handler (D8, operator decision 2026-10-30)**: use the successor in `opentelemetry-instrumentation-logging`: add `"opentelemetry-instrumentation-logging>=0.66b1",` to `pyproject.toml` `dependencies` beside the other `opentelemetry-*` lines, run `uv lock` in the service directory and stage `pyproject.toml` and `uv.lock` together (root `CLAUDE.md` uv lock rule; the `python-lint` job runs `uv lock --check`). Spec-time probe in a throwaway venv (`opentelemetry-sdk==1.45.1` + `opentelemetry-instrumentation-logging==0.66b1`): `from opentelemetry.instrumentation.logging.handler import LoggingHandler` imports with `DeprecationWarning` promoted to an error; constructor `(level=0, logger_provider=None, log_code_attributes=False)`; a WARNING logged inside a span exports with severity `WARN` and `trace_id`/`span_id` equal to the span's, and outside a span with zeros; with no `extra=` it adds no attributes; the `opentelemetry*` logger-name filter drops export-failure records. If `uv lock` cannot resolve it, escalate (P-03).
2. In `init_telemetry()` (inside the existing `try`, after the span-processor setup and `trace.set_tracer_provider(provider)`), add deferred imports and build, **reusing `resource = _build_resource()`**: `PeriodicExportingMetricReader(OTLPMetricExporter())` → `MeterProvider(resource=resource, metric_readers=[reader])` → `opentelemetry.metrics.set_meter_provider(...)`; `LoggerProvider(resource=resource)` + `add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))` → `opentelemetry._logs.set_logger_provider(...)`. Import paths verified at 1.45.1: `opentelemetry.exporter.otlp.proto.http.metric_exporter.OTLPMetricExporter`, `opentelemetry.exporter.otlp.proto.http._log_exporter.OTLPLogExporter`, `opentelemetry.sdk.metrics.export.PeriodicExportingMetricReader`, `opentelemetry.sdk._logs.LoggerProvider`, `opentelemetry.instrumentation.logging.handler.LoggingHandler` (D8; not the deprecated SDK class), `opentelemetry.sdk._logs.export.BatchLogRecordProcessor`. Exporters take **no** arguments (PLAT-3). Do not add explicit shutdown/atexit calls: both providers register their own `atexit` shutdown (`sdk/metrics/_internal/__init__.py:464`, `sdk/_logs/_internal/__init__.py:898`), which flushes on the normal interpreter exit the existing SIGTERM handler leads to.
3. **Log bridge**: after the providers are installed, create `handler = LoggingHandler(level=logging.NOTSET, logger_provider=logger_provider)` using `from opentelemetry.instrumentation.logging.handler import LoggingHandler` (not the deprecated `opentelemetry.sdk._logs.LoggingHandler`; leave `log_code_attributes` at its default `False`; no warning suppression is needed), add `handler.addFilter(lambda r: not r.name.startswith("opentelemetry"))` (recursion guard — SDK/exporter failures stay stdout-only, FR-4/R6), then `logging.getLogger().addHandler(handler)`. `logging.basicConfig` runs at import time before `init_telemetry` (see main.py evidence), so the stdout StreamHandler and format are untouched (AC-4 analogue). The handler builds record attributes from `vars(record)` minus reserved keys (`opentelemetry/instrumentation/logging/handler.py:140`; `code.*` attributes only when `log_code_attributes=True`, `:153`): it adds nothing the stdout line does not already print except `extra=` keys the caller supplied (FR-5; the egress audit in step 3 covers every `extra=` site).
4. **RPC recorder** (design § PR-A Python): add `class _RpcDurationProcessor(SpanProcessor)` to `app/telemetry.py` (import `opentelemetry.sdk.trace.SpanProcessor`, `opentelemetry.trace.SpanKind`/`StatusCode`). In `on_end(span)`: ignore unless `span.kind == SpanKind.SERVER` and `span.attributes.get("rpc.system") == "grpc"`; compute `duration_ms = (span.end_time - span.start_time) / 1e6`; record on a lazily created `meter.create_histogram("rpc.server.duration", unit="ms")` (meter from the **installed** provider, created on first use) with exactly the attributes `rpc.system`, `rpc.service`, `rpc.method` and an **integer** `rpc.grpc.status_code`, and an explicit bucket view/`explicit_bucket_boundaries_advisory=[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]` matching `scripts/testdata/rpc-status-vectors.json#bucket_boundaries_ms`. Status rule, first match wins: (1) a non-zero integer `rpc.grpc.status_code` attribute is used as-is (`abort`/`set_code` set it before raising); (2) any span event named `exception` → 2 (covers a bare `raise Exception`, which `use_span` records at `trace/__init__.py:612-619`); (3) span status `ERROR` → 2; (4) else 0. Attach with `provider.add_span_processor(_RpcDurationProcessor(...))` on the tracer provider.
5. **Deadline/cancel interceptor** (operator R3 decision 'Small interceptor'): add `class _CancelStatusInterceptor(grpc.aio.ServerInterceptor)` to `app/telemetry.py` whose `intercept_service` wraps the continuation's handler behaviours (unary and stream) so that on `asyncio.CancelledError` it calls `trace.get_current_span().set_attribute("rpc.grpc.status_code", 4 if context.time_remaining() is not None and context.time_remaining() <= 0 else 1)` and re-raises. Expose `def server_interceptors() -> list` returning `[_CancelStatusInterceptor()]` when telemetry is enabled and `[]` otherwise (no behaviour change when `OTEL_ENABLED != "true"`).
6. **Server wiring** (`app/main.py`): change `grpc.aio.server()` to `grpc.aio.server(interceptors=server_interceptors())` (import from `app.telemetry`). `GrpcAioInstrumentorServer` patches `grpc.aio.server` and inserts the OTel interceptor **first** (`opentelemetry/instrumentation/grpc/__init__.py:371-381`), so ours is inner: the `CancelledError` passes through our wrapper (stamping the live span) before the OTel wrapper's `except Exception` (which ignores `BaseException`) and the span closes with the attribute set. Mind ordering: `init_telemetry()` must still run before `grpc.aio.server(...)` (it does: main.py `serve()` calls it first). Today the server is created with **no** interceptors (`grpc.aio.server()`), so this is a new argument, not an append (design said 'existing `interceptors=` list' — deviation D2). Credentials are untouched: `add_secure_port(..., mtls.server_credentials())` stays (PRESERVE `@AC-4`/`@AC-5 @feature-210`).

**Verification**:
```bash
cd services/xstockstrat-analysis && python -c "import ast,sys; ast.parse(open('app/telemetry.py').read()); ast.parse(open('app/main.py').read())"
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && uv lock --check   # pyproject.toml and uv.lock in sync (D8)
grep -q 'opentelemetry-instrumentation-logging' services/xstockstrat-analysis/pyproject.toml && grep -q 'opentelemetry.instrumentation.logging.handler' services/xstockstrat-analysis/app/telemetry.py   # fails before the step (D8)
```

---

### Step 21 — test: analysis: telemetry tests — metrics/logs export, status vectors, recorder, subprocess flush (Python)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_telemetry.py` — modify
- `services/xstockstrat-analysis/tests/conftest.py` — modify

**Reviewers**: Service owner (`xstockstrat-analysis`) — backtest reproducibility, scoring determinism

**Codebase Evidence**:
- `grep -n "def otel_reset" -A16 services/xstockstrat-analysis/tests/conftest.py` → monkeypatches `trace._TRACER_PROVIDER_SET_ONCE`/`_TRACER_PROVIDER`, `NO_PROXY`, stubs `GrpcAioInstrumentorServer.instrument`, shuts the provider down in teardown (resets only the tracer provider today)
- `services/xstockstrat-analysis/tests/test_telemetry.py`: `_start_receiver` :21, `_export_one_span` :36, `test_init_exports_over_otlp_http` (both header forms), `test_init_logs_export_failure`
- Private set-once attributes at 1.45.1: `opentelemetry.metrics._internal._METER_PROVIDER_SET_ONCE`/`_METER_PROVIDER` (`metrics/_internal/__init__.py:832-833`) and `opentelemetry._logs._internal._LOGGER_PROVIDER_SET_ONCE` and `_LOGGER_PROVIDER` (`_logs/_internal/__init__.py:422-423`); patch via `monkeypatch.setattr(opentelemetry._logs._internal, ...)`

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-15, AC-19, AC-22`

**Instructions**:
1. Write first, capture RED against the pre-implementation tree.
2. **conftest**: extend `otel_reset` to also reset the meter and logger provider set-once state (`Once()` + `None`), remove the `LoggingHandler`s that `init_telemetry` added to the root logger on teardown, and shut the new providers down. This is the shared fixture home (C-13) — no inline copy in test files.
3. **Export (AC-19, EXTEND `@AC-1 @feature-226`)**: extend `_start_receiver` to record paths; under both header forms, after `init_telemetry()`, record one counter and one `logging.getLogger("t").warning(...)`, call `force_flush()` on the meter and logger providers, and assert `/otlp/v1/metrics` and `/otlp/v1/logs` were POSTed with `Authorization: Basic dGVzdDprZXk=`.
4. **Resource**: same assertion as the indicators instance.
5. **Status vectors (AC-15)**: parametrize over `scripts/testdata/rpc-status-vectors.json` (resolve the repo root from `__file__`); for each Python-applicable vector build a real SDK span (kind SERVER, `rpc.system=grpc`, attributes/events/status per the vector), end it through a `TracerProvider` carrying `_RpcDurationProcessor`, and assert the recorded integer `rpc.grpc.status_code` equals the vector's expected code and the data point uses the shared bucket boundaries.
6. **Failure visibility without recursion (EXTEND `@AC-3 @feature-226`)**: with the receiver returning 400, assert `caplog` (stdout path) still contains `code: 400` and that **no** `/v1/logs` record's body contains it (the `opentelemetry*` filter).
7. **Disabled**: with `OTEL_ENABLED=false`, `init_telemetry()` installs no provider and adds no handler (`logging.getLogger().handlers` unchanged), and `server_interceptors()` is `[]`.
8. **Subprocess flush (design: SIGTERM test proves the atexit flush)**: spawn `python -c` with a child that mirrors the service's real shutdown shape: `asyncio.run(main())` where `main()` calls `init_telemetry()` with `OTEL_METRIC_EXPORT_INTERVAL=600000`, records 2 counter points and 3 INFO logs, installs `signal.signal(SIGTERM, handler)` whose handler only schedules a task that sets an `asyncio.Event` (as `handle_shutdown` in `app/main.py` only schedules `grpc_server.stop`/`db_pool.close`), and awaits that event so `main()` returns and the interpreter exits **normally** (no `sys.exit`, no `os._exit`); the parent sends SIGTERM and asserts the receiver got `/v1/metrics` and `/v1/logs` before the child exits. Because the child models the handler instead of running it, also add a static test that reads the real `app/main.py` and asserts it contains neither `os._exit` nor `sys.exit` (true today in all four Python services), so the exit path the child proves is the one the service takes. **Handler import path (D8)**: assert `type(h).__module__ == 'opentelemetry.instrumentation.logging.handler'` for the handler `init_telemetry` installed on the root logger.
9. **AC-22 (analysis instance)**: same deadline/cancel assertions; **AC-3**: drive `AnalysisServicer.RunBacktest` through the existing test harness in `tests/test_analysis_servicer.py` with `LoggingHandler` attached to an `InMemoryLogRecordExporter`-backed provider and assert the INFO record whose body matches `running backtest id=<id> strategy=s-1 symbols=['AAPL']` (the real line `servicer.py:836` region; confirm the exact `log.info` text with grep before asserting) carries `trace_id`/`span_id` equal to the surrounding SERVER span, and that the stdout `caplog` line is unchanged.

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 22 — service: analysis: live-loop heartbeat log line after each successful cycle

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: Service owner (`xstockstrat-analysis`) — backtest reproducibility, scoring determinism

**Codebase Evidence**:
- `services/xstockstrat-analysis/app/engine/live_loop.py:329-343` (`run_forever`): `while True:` → sleep `analysis.engine.eval_interval_seconds` (default 60) → `if self._lock.locked(): log.info("live_loop: previous cycle still running — skipping"); continue` → `async with self._lock: try: await self._run_cycle() except Exception as e: log.error("live_loop: cycle error: %s", e)`; `_run_cycle` defined at :343
- Pre-250 stall regex `ScoreStrategy|RunBacktest` matches no emitted line; `RunBacktest`/`ScoreStrategy` are client-invoked so silence is not a stall (250 design § 6); the real RunBacktest line is `servicer.py:836`-region `"running backtest id=%s strategy=%s symbols=%s"`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `run_forever`, immediately after `await self._run_cycle()` inside the `try:` (so only a **successful** cycle logs), add `log.info("live_loop: cycle complete")`. It fires even when no strategy is live (that is the point: it is the liveness signal the restored `xstk-analysis-no-scoring` rule counts, design § Alert rules). The exact literal `live_loop: cycle complete` is load-bearing: the PR-B alert expr, the produced-signals registry row and G1 query 4 all match it. Do not change the existing `skipping` / `cycle error` lines.
2. Cardinality/volume: one INFO line per `eval_interval_seconds` (60 s default) — recorded for G1 query 7.

**Verification**:
```bash
cd services/xstockstrat-analysis && python -c "import ast; ast.parse(open('app/engine/live_loop.py').read())"
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -q 'live_loop: cycle complete' services/xstockstrat-analysis/app/engine/live_loop.py   # fails before the step
```

---

### Step 23 — test: analysis: heartbeat emitted once per successful cycle, not on error or skip

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify

**Reviewers**: Service owner (`xstockstrat-analysis`) — backtest reproducibility, scoring determinism

**Codebase Evidence**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` exists (`ls services/xstockstrat-analysis/tests | grep live_loop`); `tests/test_loop_supervision.py` also exercises loop supervision

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:
1. Using the existing live-loop test harness (reuse its fixtures/conftest helpers — C-13, no new inline domain literal), run `run_forever` for one iteration with `_run_cycle` patched to succeed and assert `caplog` contains exactly one `live_loop: cycle complete` record; with `_run_cycle` raising, assert the record is absent and `live_loop: cycle error` is present; with `self._lock` held, assert absent and `skipping` present. Note AC-3's trace-correlation assertion lives in the analysis telemetry test step.

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 24 — service: agent: meter + logger providers and logging bridge (no gRPC server, no RPC recorder)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/telemetry.py` — modify
- `services/xstockstrat-agent/pyproject.toml` — modify (add `opentelemetry-instrumentation-logging>=0.66b1`, D8)
- `services/xstockstrat-agent/uv.lock` — modify (`uv lock`, same commit)

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP tool contract stability, no secret values in tool-output logs, stateless OAuth unaffected

**Codebase Evidence**:
- `services/xstockstrat-agent/app/telemetry.py`: `_build_resource` :17, `init_telemetry` :31, `GrpcAioInstrumentorClient().instrument()` :53 (the agent is a gRPC **client**), env-only `OTLPSpanExporter()`; called from `main()` (`app/main.py:265-268`, non-fatal) and `logging.basicConfig` at `app/main.py:42`
- `services/xstockstrat-agent/uv.lock`: sdk 1.45.1, exporter-otlp-proto-http 1.45.1, instrumentation-grpc 0.66b1 (same as the backends); `pyproject.toml` gains `opentelemetry-instrumentation-logging>=0.66b1` in this step (D8)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Versions and dependency (design deviations D1, D8)**: do **not** change the existing `opentelemetry-sdk`/`exporter-otlp-proto-http`/`instrumentation-grpc` entries. The four locks already resolve `opentelemetry-sdk`/`exporter-otlp-proto-http` **1.45.1** and `opentelemetry-instrumentation-grpc` **0.66b1** (`uv.lock`; recon/design assumed 1.42.1/0.63b1 and a lagging ingest — stale). The probe was re-run at 1.45.1/0.66b1: instrumentation-grpc still has no meter/histogram code, `context.abort`/`set_code` still set `rpc.grpc.status_code` (`_aio_server.py:29-48`), and the SDK `LoggingHandler` still exists but its constructor emits a `DeprecationWarning` (`sdk/_logs/_internal/__init__.py:615-619`). **Log handler (D8, operator decision 2026-10-30)**: use the successor in `opentelemetry-instrumentation-logging`: add `"opentelemetry-instrumentation-logging>=0.66b1",` to `pyproject.toml` `dependencies` beside the other `opentelemetry-*` lines, run `uv lock` in the service directory and stage `pyproject.toml` and `uv.lock` together (root `CLAUDE.md` uv lock rule; the `python-lint` job runs `uv lock --check`). Spec-time probe in a throwaway venv (`opentelemetry-sdk==1.45.1` + `opentelemetry-instrumentation-logging==0.66b1`): `from opentelemetry.instrumentation.logging.handler import LoggingHandler` imports with `DeprecationWarning` promoted to an error; constructor `(level=0, logger_provider=None, log_code_attributes=False)`; a WARNING logged inside a span exports with severity `WARN` and `trace_id`/`span_id` equal to the span's, and outside a span with zeros; with no `extra=` it adds no attributes; the `opentelemetry*` logger-name filter drops export-failure records. If `uv lock` cannot resolve it, escalate (P-03).
2. In `init_telemetry()` (inside the existing `try`, after the span-processor setup and `trace.set_tracer_provider(provider)`), add deferred imports and build, **reusing `resource = _build_resource()`**: `PeriodicExportingMetricReader(OTLPMetricExporter())` → `MeterProvider(resource=resource, metric_readers=[reader])` → `opentelemetry.metrics.set_meter_provider(...)`; `LoggerProvider(resource=resource)` + `add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))` → `opentelemetry._logs.set_logger_provider(...)`. Import paths verified at 1.45.1: `opentelemetry.exporter.otlp.proto.http.metric_exporter.OTLPMetricExporter`, `opentelemetry.exporter.otlp.proto.http._log_exporter.OTLPLogExporter`, `opentelemetry.sdk.metrics.export.PeriodicExportingMetricReader`, `opentelemetry.sdk._logs.LoggerProvider`, `opentelemetry.instrumentation.logging.handler.LoggingHandler` (D8; not the deprecated SDK class), `opentelemetry.sdk._logs.export.BatchLogRecordProcessor`. Exporters take **no** arguments (PLAT-3). Do not add explicit shutdown/atexit calls: both providers register their own `atexit` shutdown (`sdk/metrics/_internal/__init__.py:464`, `sdk/_logs/_internal/__init__.py:898`), which flushes on the normal interpreter exit the existing SIGTERM handler leads to.
3. **Log bridge**: after the providers are installed, create `handler = LoggingHandler(level=logging.NOTSET, logger_provider=logger_provider)` using `from opentelemetry.instrumentation.logging.handler import LoggingHandler` (not the deprecated `opentelemetry.sdk._logs.LoggingHandler`; leave `log_code_attributes` at its default `False`; no warning suppression is needed), add `handler.addFilter(lambda r: not r.name.startswith("opentelemetry"))` (recursion guard — SDK/exporter failures stay stdout-only, FR-4/R6), then `logging.getLogger().addHandler(handler)`. `logging.basicConfig` runs at import time before `init_telemetry` (see main.py evidence), so the stdout StreamHandler and format are untouched (AC-4 analogue). The handler builds record attributes from `vars(record)` minus reserved keys (`opentelemetry/instrumentation/logging/handler.py:140`; `code.*` attributes only when `log_code_attributes=True`, `:153`): it adds nothing the stdout line does not already print except `extra=` keys the caller supplied (FR-5; the egress audit in step 3 covers every `extra=` site).
4. The agent is not a gRPC server: **no** `_RpcDurationProcessor`, no cancel interceptor, no `rpc.server.duration` (FR-2 exempts agent and UI). Its metric is `mcp.tool.duration`, added by the next service step. Keep `GrpcAioInstrumentorClient().instrument()` as is.

**Verification**:
```bash
cd services/xstockstrat-agent && python -c "import ast; ast.parse(open('app/telemetry.py').read())"
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && uv lock --check   # pyproject.toml and uv.lock in sync (D8)
grep -q 'opentelemetry-instrumentation-logging' services/xstockstrat-agent/pyproject.toml && grep -q 'opentelemetry.instrumentation.logging.handler' services/xstockstrat-agent/app/telemetry.py   # fails before the step (D8)
```

---

### Step 25 — test: agent: telemetry tests — metrics/logs export, resource, log correlation, flush

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_telemetry.py` — modify
- `services/xstockstrat-agent/tests/conftest.py` — modify

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP tool contract stability, no secret values in tool-output logs, stateless OAuth unaffected

**Codebase Evidence**:
- `grep -n "def otel_reset" -A16 services/xstockstrat-agent/tests/conftest.py` → patches `GrpcAioInstrumentorClient.instrument` (:257) and resets only the tracer provider
- `services/xstockstrat-agent/tests/test_telemetry.py` exists (`ls services/xstockstrat-agent/tests | grep telemetry`)

**TDD**: `red-green required`

**Covers**: `AC-10, AC-11, AC-19`

**Instructions**:
1. Mirror the Python backend test step minus the recorder/interceptor/AC-22 parts: extend `otel_reset` for meter/logger providers and handler removal; `/otlp/v1/metrics` + `/otlp/v1/logs` under both header forms; **AC-10 agent row**: metric request resource has `service.name=agent`, `deployment.environment=staging`, `platform=xstockstrat` (a registered counter is enough — the agent's own `mcp.tool.duration` is asserted in the middleware test step); **AC-11 agent row**: a `logging` WARN inside `trace.get_tracer("t").start_as_current_span("s")` is exported with severity WARN and `trace_id` equal to the span's; opentelemetry-logger filter prevents a `/v1/logs` record for an export failure; disabled path adds no handler; subprocess SIGTERM flush as in the backend steps (the agent's SIGTERM is handled by uvicorn, which ends `asyncio.run` normally: assert statically that `app/main.py` has neither `os._exit` nor `sys.exit`, true today); **handler import path (D8)**: assert `type(h).__module__ == 'opentelemetry.instrumentation.logging.handler'` for the installed root-logger handler.

**Verification**:
```bash
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40   # CI floor for xstockstrat-agent (python-test matrix)
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 26 — service: agent: ToolMetricsMiddleware records mcp.tool.duration with outcome

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tool_metrics.py` — create
- `services/xstockstrat-agent/app/main.py` — modify

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP tool contract stability, no secret values in tool-output logs, stateless OAuth unaffected

**Codebase Evidence**:
- `services/xstockstrat-agent/app/main.py:77-81`: `create_server()` → `MCPServer("xstockstrat-agent", instructions=...)`, `register_tools(server)`, `register_prompts(server)`, `return server`
- `services/xstockstrat-agent/app/tools.py:379-381`: `register_tools` appends `CallerPropagationMiddleware()` to `server.middleware`; the class (`tools.py:190+`) is the in-repo `ServerMiddleware` precedent: `async def __call__(self, ctx, call_next)`, `getattr(ctx, "method", None) == "tools/call"`, `finally:` cleanup
- mcp 2.3.0 (`uv.lock:597-598`): `ServerMiddleware` runs before params validation and exposes `ctx.method` and the raw `ctx.params` (`mcp/server/context.py:146-162`); request failures surface as raised `MCPError`/`ValidationError`; `mcp/server/_otel.py:56-71` marks tool errors as `CallToolResult(is_error=True)` or `{"isError": True}`; `MCPServer.list_tools()` is `async def` at `mcp/server/mcpserver/server.py:516`; the span attribute key `gen_ai.tool.name` is `mcp/server/_otel.py:31`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `app/tool_metrics.py` with `class ToolMetricsMiddleware` (`async def __call__(self, ctx, call_next)`): for any method other than `tools/call` just `return await call_next(ctx)`. For `tools/call`: read `name = (ctx.params or {}).get("name")`; map it to the registered set (loaded once, lazily, from `await server.list_tools()` and cached; the class takes `server` in `__init__`) — a name not in the set records as `unregistered` (no hard-coded tool count, ledger 2026-10-14). Time with `time.perf_counter()`; in a `try/except BaseException`/`finally` record `mcp.tool.duration` (unit `ms`, histogram from `opentelemetry.metrics.get_meter(__name__)` created lazily on first call so it binds to the installed provider) with attributes `{"gen_ai.tool.name": <name|unregistered>, "outcome": "ok"|"error"}`. `outcome=error` for **any** exception reaching the middleware (`MCPError`, `ValidationError`, tool exceptions) and for a returned `CallToolResult(is_error=True)` / `{"isError": True}` (match the same two shapes as `_otel.py:56-71`). Re-raise exceptions unchanged; return the result unchanged.
2. In `create_server()` append `server.middleware.append(ToolMetricsMiddleware(server))` **after** `register_tools(server)`/`register_prompts(server)` (so it is inner to `CallerPropagationMiddleware`, which `register_tools` appended first, and the identity binding is unaffected). The middleware is a no-op cost when OTel is disabled (the API meter is a no-op).

**Verification**:
```bash
cd services/xstockstrat-agent && python -c "import ast; ast.parse(open('app/tool_metrics.py').read())"
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 27 — test: agent: mcp.tool.duration data points for raise, isError and unknown tool

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tool_metrics.py` — create

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP tool contract stability, no secret values in tool-output logs, stateless OAuth unaffected

**Codebase Evidence**:
- `ls services/xstockstrat-agent/tests` → `test_tools.py`, `test_header_propagation.py` (how existing tests build a server/`ctx`); `conftest.py` is the canonical fixture home (C-13)

**TDD**: `red-green required`

**Covers**: `AC-21`

**Instructions**:
1. Build `create_server()` (or `MCPServer` + `register_tools`) with an `InMemoryMetricReader` MeterProvider, register an extra raising tool and an `isError`-returning tool through the public tool API (or monkeypatch two existing tool callables), then drive `tools/call` through the middleware chain and assert `mcp.tool.duration` points: raising tool → `outcome=error`; `isError` result → `outcome=error`; `get_strategy`/`list_formulas`-style real tool names are used only if the registration exists (derive the names from `await server.list_tools()` at test time, do not hard-code a count); `tools/call` naming `no_such_tool` → `gen_ai.tool.name=unregistered`. Also assert a successful call records `outcome=ok` and that non-`tools/call` methods record nothing.

**Verification**:
```bash
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40   # CI floor for xstockstrat-agent (python-test matrix)
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 28 — service: ledger: metric reader, log processor, span-derived rpc.server.duration, awaited shutdown (Node)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/telemetry.ts` — modify
- `services/xstockstrat-ledger/package.json` — modify
- `services/xstockstrat-ledger/pnpm-lock.yaml` — modify

**Reviewers**: Service owner (`xstockstrat-ledger`) — append-only invariant, event ordering

**Codebase Evidence**:
- `services/xstockstrat-ledger/src/telemetry.ts`: `buildResource()` (sync `Resource` 1.x), `initTelemetry()` gate `OTEL_ENABLED !== 'true'`, lazy requires of `NodeSDK`/`OTLPTraceExporter`/`GrpcInstrumentation`, `new NodeSDK({ resource, traceExporter: new OTLPTraceExporter(), resourceDetectors: [envDetectorSync, processDetectorSync, hostDetectorSync], instrumentations: [new GrpcInstrumentation()] })`, `sdk.start()`, `process.on('SIGTERM', () => sdk.shutdown().catch(console.error))` (default `SERVICE_NAME` fallback `'ledger'`; the four files differ only in that literal and the header comment — `diff` vs ledger)
- `services/xstockstrat-ledger/package.json`: `@opentelemetry/{api ^1.9.0, exporter-trace-otlp-http ^0.52.0, instrumentation-grpc ^0.52.0, resources ^1.25.0, sdk-node ^0.52.0, semantic-conventions ^1.25.0}`; scripts `test: tsc && node --test dist/__tests__/*.test.js`, `test:coverage` (c8), `lint: eslint src --ext .ts`
- `src/index.ts:1-2` `initTelemetry()` before gRPC; shutdown :67-76 (`grpcServer.tryShutdown(async () => { await notifier.stop(); await pool.end(); process.exit(0); })`, `process.on('SIGINT'|'SIGTERM', shutdown)`)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Dependencies** (`package.json` + that service's `pnpm-lock.yaml`; run `cd services/xstockstrat-ledger && pnpm install` and commit the lock): add `@opentelemetry/exporter-metrics-otlp-http@^0.52.0`, `@opentelemetry/exporter-logs-otlp-http@^0.52.0`, `@opentelemetry/sdk-trace-base@^1.25.0`, `@opentelemetry/sdk-metrics@^1.25.0`, `@opentelemetry/sdk-logs@^0.52.0`, `@opentelemetry/api-logs@^0.52.0` (currently only transitive: lock has `sdk-metrics@1.25.1`, `sdk-logs@0.52.1`, `api-logs@0.52.1`, `sdk-trace-base@1.25.1`, `sdk-node@0.52.1`; the exporter packages are absent). sdk-node 0.52.1 supports `metricReader`, `logRecordProcessor`, `views` and `spanProcessors` options (`sdk-node/build/src/types.d.ts:12-22`).
2. **telemetry.ts**: keep `buildResource()` and the `OTEL_ENABLED` gate. Replace `traceExporter: new OTLPTraceExporter()` with `spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter()), rpcDuration]` — passing `spanProcessors` disables sdk-node's implicit trace exporter (`sdk-node/build/src/sdk.js:61-84`), so the trace `BatchSpanProcessor` **must** be listed explicitly or traces silently stop (the `@AC-1 @feature-226` test is the regression proof). Add `metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })` and `logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter())` (singular option names on 0.52). All three exporters are constructed with **no** url/headers/endpoint argument (PLAT-3). Keep the lazy `require(...)` style, `diag` WARN logger and the `[otel] tracing enabled →` line. All four services compile to CommonJS (`tsconfig.json: "module": "commonjs"`; tests run `tsc && node --test dist/__tests__/*.test.js`), so plain `require` stays — design's `createRequire` guard is not needed (deviation D3; recon's 'strip-types runner' claim no longer holds).
3. **RPC recorder** (`class RpcDurationProcessor implements SpanProcessor` in `telemetry.ts`, exported for tests): `onEnd(span)` ignores spans unless `span.kind === SpanKind.SERVER && span.attributes['rpc.system'] === 'grpc'`; duration in ms from `span.duration` (`[s, ns]`); histogram `rpc.server.duration` (unit `ms`, bucket boundaries `[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]` via a `views` entry or advice) is created **lazily on the first `onEnd`**, after `sdk.start()` registered the global meter provider — `@opentelemetry/api` 1.9.1 has no proxy MeterProvider, so early binding would export nothing (a test proves it). Attributes exactly `rpc.system`, `rpc.service`, `rpc.method` and an **integer** `rpc.grpc.status_code`. Status rule: use the integer attribute when it is in `0..16`, otherwise (missing, non-integer such as a string, falsy `err.code`, out of range) fall back to: an `exception` event or span status ERROR → 2, else 0. grpc-js sets the attribute via `callback({code})` (`@opentelemetry/instrumentation-grpc` `serverUtils.js:75-83`) and a falsy/absent `err.code` leaves it unset (`serverUtils.js:76-87`) → recorded 2.
4. **Shutdown**: export `async function shutdownTelemetry()` that calls `sdk.shutdown()` once (idempotent promise) and replace the unawaited `process.on('SIGTERM', ...)` line. Also export `function telemetryStarted(): boolean`, true only after `sdk.start()` has returned (the winston bridge in the next step imports it; `telemetry.ts` is in this step's Files). `index.ts` `shutdown()` (see logger/index step) starts it immediately, in parallel with `grpcServer.tryShutdown`, because long-lived `WatchConfig`/`StreamEvents` streams block `tryShutdown` indefinitely.

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run build
cd services/xstockstrat-ledger && pnpm run lint
grep -q 'telemetryStarted' services/xstockstrat-ledger/src/telemetry.ts && grep -q 'RpcDurationProcessor' services/xstockstrat-ledger/src/telemetry.ts   # fails before the step
```

---

### Step 29 — service: ledger: winston → OTLP log bridge and awaited SIGTERM flush (Node)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/services/logger.ts` — modify
- `services/xstockstrat-ledger/src/index.ts` — modify
- `services/xstockstrat-ledger/package.json` — modify
- `services/xstockstrat-ledger/pnpm-lock.yaml` — modify

**Reviewers**: Service owner (`xstockstrat-ledger`) — append-only invariant, event ordering

**Codebase Evidence**:
- `services/xstockstrat-ledger/src/services/logger.ts`: `getLogger(service)` → `createLogger({ level, defaultMeta: { service }, format: isDev ? combine(colorize(), simple()) : combine(timestamp(), json()), transports: [new transports.Console()] })` (identical across ledger/identity/notify/config modulo a header comment)
- `src/index.ts:1-2` `initTelemetry()` before gRPC; shutdown :67-76 (`grpcServer.tryShutdown(async () => { await notifier.stop(); await pool.end(); process.exit(0); })`, `process.on('SIGINT'|'SIGTERM', shutdown)`)
- `@opentelemetry/winston-transport@0.5.0` depends on `@opentelemetry/api-logs ^0.52.0` + `winston-transport 4.*` (npm metadata checked at spec time) — compatible with the 0.52 line; `api-logs` 0.52 has no proxy logger provider, so the transport must be attached only after `sdk.start()`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `@opentelemetry/winston-transport@0.5.0` (pin exact) to `package.json`; `pnpm install` and commit `pnpm-lock.yaml`.
2. **logger.ts**: keep the Console transport, `defaultMeta` and both `format` branches byte-identical (AC-4: stdout line and format unchanged). Export a small `attachOtlpLogTransport(logger)` used by `getLogger` that, only when `OTEL_ENABLED === 'true'` **and telemetry has started** (import the `telemetryStarted()` boolean that `telemetry.ts` exports since the previous step, true after `sdk.start()`), does `logger.add(new OpenTelemetryTransportV3())` (`require('@opentelemetry/winston-transport')`) inside try/catch (non-fatal, warn to console). Loggers created before start stay stdout-only — `index.ts` calls `initTelemetry()` on line 1, before any `getLogger` call, so every service logger is bridged. Do not bridge the OTel `diag` logger (it stays on `console`): that is the recursion guard (FR-4). Winston levels map to OTel severity inside the transport.
3. **index.ts**: change the `shutdown` function (see the evidence lines) to start `const flush = shutdownTelemetry()` immediately, run `grpcServer.tryShutdown(async () => { await flush; <existing pool/notifier cleanup>; process.exit(0); })` unchanged otherwise, and add `setTimeout(() => { grpcServer.forceShutdown(); }, 5000).unref()` so open streams cannot block exit; the flush promise is awaited both in the callback and after `forceShutdown()` (`flush.finally(() => process.exit(0))`). Import `shutdownTelemetry` from `./telemetry`.

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run build
cd services/xstockstrat-ledger && pnpm run lint
```

---

### Step 30 — test: ledger: telemetry tests — export paths, status vectors, lazy histogram, log bridge, shutdown (Node)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/telemetry.export.test.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/telemetry.test.ts` — modify

**Reviewers**: Service owner (`xstockstrat-ledger`) — append-only invariant, event ordering

**Codebase Evidence**:
- `services/xstockstrat-ledger/src/__tests__/telemetry.export.test.ts`: in-process `createServer` receiver that only accepts `/v1/traces` (404 otherwise), `OTEL_BSP_SCHEDULE_DELAY=50`, console spies installed **before** the first OTel `import()` (DiagConsoleLogger binds `console.*` at load — ledger insights 2026-10-14), `waitFor` poller, tests `exports a span over OTLP/HTTP...` and `logs a rejected export`
- `services/xstockstrat-ledger/src/__tests__/telemetry.test.ts` (resource attribute test, PRESERVE `@AC-1 @feature-171`)
- Node fixtures home is `src/__tests__/fixtures/` (C-13) — materialise only on a second consumer

**TDD**: `red-green required`

**Covers**: `AC-2, AC-4, AC-15, AC-19`

**Instructions**:
1. Write first, capture RED. Keep one-file-per-process (the OTel globals are set once per process).
2. **Export (AC-19, EXTEND `@AC-1 @feature-226`)**: extend the receiver to accept `/v1/traces`, `/v1/metrics` and `/v1/logs` and record each with its `authorization` header; run the file under both header forms (`Authorization=Basic dGVzdDprZXk=` and `Authorization=Basic%20dGVzdDprZXk%3D`, via two child-process runs or two parametrised files since globals are set-once) and assert a recorded counter and a winston `warn` produce `POST /otlp/v1/metrics` and `POST /otlp/v1/logs` with `Basic dGVzdDprZXk=`; traces must still export (regression for the explicit `BatchSpanProcessor`). Set `OTEL_METRIC_EXPORT_INTERVAL=100` for the test.
3. **Lazy histogram**: a test that constructs `RpcDurationProcessor` and calls `onEnd` **before** `sdk.start()` records nothing exported; after start it exports (proves lazy binding).
4. **Status vectors (AC-15)**: read `scripts/testdata/rpc-status-vectors.json` (resolve from `__dirname` up to the repo root, path stable under `dist/__tests__`), feed each Node-applicable vector's hand-built `ReadableSpan` to `RpcDurationProcessor.onEnd` with an in-memory reader, assert the recorded `rpc.grpc.status_code` and bucket boundaries.
5. **Failure visibility**: the existing `logs a rejected export` test stays green and additionally asserts no `/v1/logs` record contains the failure text.
6. **Shutdown flush (AC-12-style)**: with `OTEL_METRIC_EXPORT_INTERVAL=600000`, record 2 metric points + 3 log lines, call `shutdownTelemetry()` and assert both arrive before it resolves; a second call is idempotent.
7. **AC-4**: with `OTEL_ENABLED=true`, `getLogger('ledger').info('event appended')` writes to `process.stdout` the same line as with `OTEL_ENABLED=false` (capture both via a spied `Console` transport stream; compare bytes) while the receiver also gets the record on `/v1/logs`.
8. **AC-2 end-to-end (real gRPC call)**: in its own child process (OTel globals are set once), run `initTelemetry()` with `OTEL_METRIC_EXPORT_INTERVAL=100`, then `require('@grpc/grpc-js')` **after** `sdk.start()` (the gRPC instrumentation patches the module on first require); start an in-process `grpc.Server` on `127.0.0.1:0` with insecure credentials and one inline unary method (`/t.T/Get`, Buffer-identity serializers, no proto) whose handler returns `{ code: grpc.status.NOT_FOUND }`, call it with a client, and assert the receiver's JSON `/otlp/v1/metrics` body contains an `rpc.server.duration` data point with `rpc.grpc.status_code` = 5 and the shared bucket boundaries. This proves the instrumentation really sets the attribute `RpcDurationProcessor` reads; the hand-built-span vectors above prove only the mapping rules.

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
cd services/xstockstrat-ledger && pnpm run lint
```

---

### Step 31 — service: identity: metric reader, log processor, span-derived rpc.server.duration, awaited shutdown (Node)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/telemetry.ts` — modify
- `services/xstockstrat-identity/package.json` — modify
- `services/xstockstrat-identity/pnpm-lock.yaml` — modify

**Reviewers**: Service owner (`xstockstrat-identity`) — no plaintext credentials in config or logs

**Codebase Evidence**:
- `services/xstockstrat-identity/src/telemetry.ts`: `buildResource()` (sync `Resource` 1.x), `initTelemetry()` gate `OTEL_ENABLED !== 'true'`, lazy requires of `NodeSDK`/`OTLPTraceExporter`/`GrpcInstrumentation`, `new NodeSDK({ resource, traceExporter: new OTLPTraceExporter(), resourceDetectors: [envDetectorSync, processDetectorSync, hostDetectorSync], instrumentations: [new GrpcInstrumentation()] })`, `sdk.start()`, `process.on('SIGTERM', () => sdk.shutdown().catch(console.error))` (default `SERVICE_NAME` fallback `'identity'`; the four files differ only in that literal and the header comment — `diff` vs ledger)
- `services/xstockstrat-identity/package.json`: `@opentelemetry/{api ^1.9.0, exporter-trace-otlp-http ^0.52.0, instrumentation-grpc ^0.52.0, resources ^1.25.0, sdk-node ^0.52.0, semantic-conventions ^1.25.0}`; scripts `test: tsc && node --test dist/__tests__/*.test.js`, `test:coverage` (c8), `lint: eslint src --ext .ts`
- `src/index.ts:1-2`; shutdown :59-62 (`grpcServer.tryShutdown(() => { pool.end(); process.exit(0); })`)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Dependencies** (`package.json` + that service's `pnpm-lock.yaml`; run `cd services/xstockstrat-identity && pnpm install` and commit the lock): add `@opentelemetry/exporter-metrics-otlp-http@^0.52.0`, `@opentelemetry/exporter-logs-otlp-http@^0.52.0`, `@opentelemetry/sdk-trace-base@^1.25.0`, `@opentelemetry/sdk-metrics@^1.25.0`, `@opentelemetry/sdk-logs@^0.52.0`, `@opentelemetry/api-logs@^0.52.0` (currently only transitive: lock has `sdk-metrics@1.25.1`, `sdk-logs@0.52.1`, `api-logs@0.52.1`, `sdk-trace-base@1.25.1`, `sdk-node@0.52.1`; the exporter packages are absent). sdk-node 0.52.1 supports `metricReader`, `logRecordProcessor`, `views` and `spanProcessors` options (`sdk-node/build/src/types.d.ts:12-22`).
2. **telemetry.ts**: keep `buildResource()` and the `OTEL_ENABLED` gate. Replace `traceExporter: new OTLPTraceExporter()` with `spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter()), rpcDuration]` — passing `spanProcessors` disables sdk-node's implicit trace exporter (`sdk-node/build/src/sdk.js:61-84`), so the trace `BatchSpanProcessor` **must** be listed explicitly or traces silently stop (the `@AC-1 @feature-226` test is the regression proof). Add `metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })` and `logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter())` (singular option names on 0.52). All three exporters are constructed with **no** url/headers/endpoint argument (PLAT-3). Keep the lazy `require(...)` style, `diag` WARN logger and the `[otel] tracing enabled →` line. All four services compile to CommonJS (`tsconfig.json: "module": "commonjs"`; tests run `tsc && node --test dist/__tests__/*.test.js`), so plain `require` stays — design's `createRequire` guard is not needed (deviation D3; recon's 'strip-types runner' claim no longer holds).
3. **RPC recorder** (`class RpcDurationProcessor implements SpanProcessor` in `telemetry.ts`, exported for tests): `onEnd(span)` ignores spans unless `span.kind === SpanKind.SERVER && span.attributes['rpc.system'] === 'grpc'`; duration in ms from `span.duration` (`[s, ns]`); histogram `rpc.server.duration` (unit `ms`, bucket boundaries `[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]` via a `views` entry or advice) is created **lazily on the first `onEnd`**, after `sdk.start()` registered the global meter provider — `@opentelemetry/api` 1.9.1 has no proxy MeterProvider, so early binding would export nothing (a test proves it). Attributes exactly `rpc.system`, `rpc.service`, `rpc.method` and an **integer** `rpc.grpc.status_code`. Status rule: use the integer attribute when it is in `0..16`, otherwise (missing, non-integer such as a string, falsy `err.code`, out of range) fall back to: an `exception` event or span status ERROR → 2, else 0. grpc-js sets the attribute via `callback({code})` (`@opentelemetry/instrumentation-grpc` `serverUtils.js:75-83`) and a falsy/absent `err.code` leaves it unset (`serverUtils.js:76-87`) → recorded 2.
4. **Shutdown**: export `async function shutdownTelemetry()` that calls `sdk.shutdown()` once (idempotent promise) and replace the unawaited `process.on('SIGTERM', ...)` line. Also export `function telemetryStarted(): boolean`, true only after `sdk.start()` has returned (the winston bridge in the next step imports it; `telemetry.ts` is in this step's Files). `index.ts` `shutdown()` (see logger/index step) starts it immediately, in parallel with `grpcServer.tryShutdown`, because long-lived `WatchConfig`/`StreamEvents` streams block `tryShutdown` indefinitely.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run build
cd services/xstockstrat-identity && pnpm run lint
grep -q 'telemetryStarted' services/xstockstrat-identity/src/telemetry.ts && grep -q 'RpcDurationProcessor' services/xstockstrat-identity/src/telemetry.ts   # fails before the step
```

---

### Step 32 — service: identity: winston → OTLP log bridge and awaited SIGTERM flush (Node)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/services/logger.ts` — modify
- `services/xstockstrat-identity/src/index.ts` — modify
- `services/xstockstrat-identity/package.json` — modify
- `services/xstockstrat-identity/pnpm-lock.yaml` — modify

**Reviewers**: Service owner (`xstockstrat-identity`) — no plaintext credentials in config or logs

**Codebase Evidence**:
- `services/xstockstrat-identity/src/services/logger.ts`: `getLogger(service)` → `createLogger({ level, defaultMeta: { service }, format: isDev ? combine(colorize(), simple()) : combine(timestamp(), json()), transports: [new transports.Console()] })` (identical across ledger/identity/notify/config modulo a header comment)
- `src/index.ts:1-2`; shutdown :59-62 (`grpcServer.tryShutdown(() => { pool.end(); process.exit(0); })`)
- `@opentelemetry/winston-transport@0.5.0` depends on `@opentelemetry/api-logs ^0.52.0` + `winston-transport 4.*` (npm metadata checked at spec time) — compatible with the 0.52 line; `api-logs` 0.52 has no proxy logger provider, so the transport must be attached only after `sdk.start()`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `@opentelemetry/winston-transport@0.5.0` (pin exact) to `package.json`; `pnpm install` and commit `pnpm-lock.yaml`.
2. **logger.ts**: keep the Console transport, `defaultMeta` and both `format` branches byte-identical (AC-4: stdout line and format unchanged). Export a small `attachOtlpLogTransport(logger)` used by `getLogger` that, only when `OTEL_ENABLED === 'true'` **and telemetry has started** (import the `telemetryStarted()` boolean that `telemetry.ts` exports since the previous step, true after `sdk.start()`), does `logger.add(new OpenTelemetryTransportV3())` (`require('@opentelemetry/winston-transport')`) inside try/catch (non-fatal, warn to console). Loggers created before start stay stdout-only — `index.ts` calls `initTelemetry()` on line 1, before any `getLogger` call, so every service logger is bridged. Do not bridge the OTel `diag` logger (it stays on `console`): that is the recursion guard (FR-4). Winston levels map to OTel severity inside the transport.
3. **index.ts**: change the `shutdown` function (see the evidence lines) to start `const flush = shutdownTelemetry()` immediately, run `grpcServer.tryShutdown(async () => { await flush; <existing pool/notifier cleanup>; process.exit(0); })` unchanged otherwise, and add `setTimeout(() => { grpcServer.forceShutdown(); }, 5000).unref()` so open streams cannot block exit; the flush promise is awaited both in the callback and after `forceShutdown()` (`flush.finally(() => process.exit(0))`). Import `shutdownTelemetry` from `./telemetry`.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run build
cd services/xstockstrat-identity && pnpm run lint
```

---

### Step 33 — test: identity: telemetry tests — export paths, status vectors, lazy histogram, log bridge, shutdown (Node)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/telemetry.export.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/telemetry.test.ts` — modify

**Reviewers**: Service owner (`xstockstrat-identity`) — no plaintext credentials in config or logs

**Codebase Evidence**:
- `services/xstockstrat-identity/src/__tests__/telemetry.export.test.ts`: in-process `createServer` receiver that only accepts `/v1/traces` (404 otherwise), `OTEL_BSP_SCHEDULE_DELAY=50`, console spies installed **before** the first OTel `import()` (DiagConsoleLogger binds `console.*` at load — ledger insights 2026-10-14), `waitFor` poller, tests `exports a span over OTLP/HTTP...` and `logs a rejected export`
- `services/xstockstrat-identity/src/__tests__/telemetry.test.ts` (resource attribute test, PRESERVE `@AC-1 @feature-171`)
- Node fixtures home is `src/__tests__/fixtures/` (C-13) — materialise only on a second consumer

**TDD**: `red-green required`

**Covers**: `AC-2, AC-11, AC-15, AC-19`

**Instructions**:
1. Write first, capture RED. Keep one-file-per-process (the OTel globals are set once per process).
2. **Export (AC-19, EXTEND `@AC-1 @feature-226`)**: extend the receiver to accept `/v1/traces`, `/v1/metrics` and `/v1/logs` and record each with its `authorization` header; run the file under both header forms (`Authorization=Basic dGVzdDprZXk=` and `Authorization=Basic%20dGVzdDprZXk%3D`, via two child-process runs or two parametrised files since globals are set-once) and assert a recorded counter and a winston `warn` produce `POST /otlp/v1/metrics` and `POST /otlp/v1/logs` with `Basic dGVzdDprZXk=`; traces must still export (regression for the explicit `BatchSpanProcessor`). Set `OTEL_METRIC_EXPORT_INTERVAL=100` for the test.
3. **Lazy histogram**: a test that constructs `RpcDurationProcessor` and calls `onEnd` **before** `sdk.start()` records nothing exported; after start it exports (proves lazy binding).
4. **Status vectors (AC-15)**: read `scripts/testdata/rpc-status-vectors.json` (resolve from `__dirname` up to the repo root, path stable under `dist/__tests__`), feed each Node-applicable vector's hand-built `ReadableSpan` to `RpcDurationProcessor.onEnd` with an in-memory reader, assert the recorded `rpc.grpc.status_code` and bucket boundaries.
5. **Failure visibility**: the existing `logs a rejected export` test stays green and additionally asserts no `/v1/logs` record contains the failure text.
6. **Shutdown flush (AC-12-style)**: with `OTEL_METRIC_EXPORT_INTERVAL=600000`, record 2 metric points + 3 log lines, call `shutdownTelemetry()` and assert both arrive before it resolves; a second call is idempotent.
7. **AC-11 identity row**: a WARN logged inside `trace.getTracer('t').startActiveSpan(...)` is exported with severity WARN and `traceId` equal to the active span's.
8. **AC-2 end-to-end (real gRPC call)**: in its own child process (OTel globals are set once), run `initTelemetry()` with `OTEL_METRIC_EXPORT_INTERVAL=100`, then `require('@grpc/grpc-js')` **after** `sdk.start()` (the gRPC instrumentation patches the module on first require); start an in-process `grpc.Server` on `127.0.0.1:0` with insecure credentials and one inline unary method (`/t.T/Get`, Buffer-identity serializers, no proto) whose handler returns `{ code: grpc.status.NOT_FOUND }`, call it with a client, and assert the receiver's JSON `/otlp/v1/metrics` body contains an `rpc.server.duration` data point with `rpc.grpc.status_code` = 5 and the shared bucket boundaries. This proves the instrumentation really sets the attribute `RpcDurationProcessor` reads; the hand-built-span vectors above prove only the mapping rules.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
cd services/xstockstrat-identity && pnpm run lint
```

---

### Step 34 — service: notify: metric reader, log processor, span-derived rpc.server.duration, awaited shutdown (Node)

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/telemetry.ts` — modify
- `services/xstockstrat-notify/package.json` — modify
- `services/xstockstrat-notify/pnpm-lock.yaml` — modify

**Reviewers**: Service owner (`xstockstrat-notify`) — stream delivery guarantees, backpressure handling

**Codebase Evidence**:
- `services/xstockstrat-notify/src/telemetry.ts`: `buildResource()` (sync `Resource` 1.x), `initTelemetry()` gate `OTEL_ENABLED !== 'true'`, lazy requires of `NodeSDK`/`OTLPTraceExporter`/`GrpcInstrumentation`, `new NodeSDK({ resource, traceExporter: new OTLPTraceExporter(), resourceDetectors: [envDetectorSync, processDetectorSync, hostDetectorSync], instrumentations: [new GrpcInstrumentation()] })`, `sdk.start()`, `process.on('SIGTERM', () => sdk.shutdown().catch(console.error))` (default `SERVICE_NAME` fallback `'notify'`; the four files differ only in that literal and the header comment — `diff` vs ledger)
- `services/xstockstrat-notify/package.json`: `@opentelemetry/{api ^1.9.0, exporter-trace-otlp-http ^0.52.0, instrumentation-grpc ^0.52.0, resources ^1.25.0, sdk-node ^0.52.0, semantic-conventions ^1.25.0}`; scripts `test: tsc && node --test dist/__tests__/*.test.js`, `test:coverage` (c8), `lint: eslint src --ext .ts`
- `src/index.ts:1-2`; shutdown :58-61 (`grpcServer.tryShutdown(() => { pool.end(); process.exit(0); })`)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Dependencies** (`package.json` + that service's `pnpm-lock.yaml`; run `cd services/xstockstrat-notify && pnpm install` and commit the lock): add `@opentelemetry/exporter-metrics-otlp-http@^0.52.0`, `@opentelemetry/exporter-logs-otlp-http@^0.52.0`, `@opentelemetry/sdk-trace-base@^1.25.0`, `@opentelemetry/sdk-metrics@^1.25.0`, `@opentelemetry/sdk-logs@^0.52.0`, `@opentelemetry/api-logs@^0.52.0` (currently only transitive: lock has `sdk-metrics@1.25.1`, `sdk-logs@0.52.1`, `api-logs@0.52.1`, `sdk-trace-base@1.25.1`, `sdk-node@0.52.1`; the exporter packages are absent). sdk-node 0.52.1 supports `metricReader`, `logRecordProcessor`, `views` and `spanProcessors` options (`sdk-node/build/src/types.d.ts:12-22`).
2. **telemetry.ts**: keep `buildResource()` and the `OTEL_ENABLED` gate. Replace `traceExporter: new OTLPTraceExporter()` with `spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter()), rpcDuration]` — passing `spanProcessors` disables sdk-node's implicit trace exporter (`sdk-node/build/src/sdk.js:61-84`), so the trace `BatchSpanProcessor` **must** be listed explicitly or traces silently stop (the `@AC-1 @feature-226` test is the regression proof). Add `metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })` and `logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter())` (singular option names on 0.52). All three exporters are constructed with **no** url/headers/endpoint argument (PLAT-3). Keep the lazy `require(...)` style, `diag` WARN logger and the `[otel] tracing enabled →` line. All four services compile to CommonJS (`tsconfig.json: "module": "commonjs"`; tests run `tsc && node --test dist/__tests__/*.test.js`), so plain `require` stays — design's `createRequire` guard is not needed (deviation D3; recon's 'strip-types runner' claim no longer holds).
3. **RPC recorder** (`class RpcDurationProcessor implements SpanProcessor` in `telemetry.ts`, exported for tests): `onEnd(span)` ignores spans unless `span.kind === SpanKind.SERVER && span.attributes['rpc.system'] === 'grpc'`; duration in ms from `span.duration` (`[s, ns]`); histogram `rpc.server.duration` (unit `ms`, bucket boundaries `[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]` via a `views` entry or advice) is created **lazily on the first `onEnd`**, after `sdk.start()` registered the global meter provider — `@opentelemetry/api` 1.9.1 has no proxy MeterProvider, so early binding would export nothing (a test proves it). Attributes exactly `rpc.system`, `rpc.service`, `rpc.method` and an **integer** `rpc.grpc.status_code`. Status rule: use the integer attribute when it is in `0..16`, otherwise (missing, non-integer such as a string, falsy `err.code`, out of range) fall back to: an `exception` event or span status ERROR → 2, else 0. grpc-js sets the attribute via `callback({code})` (`@opentelemetry/instrumentation-grpc` `serverUtils.js:75-83`) and a falsy/absent `err.code` leaves it unset (`serverUtils.js:76-87`) → recorded 2.
4. **Shutdown**: export `async function shutdownTelemetry()` that calls `sdk.shutdown()` once (idempotent promise) and replace the unawaited `process.on('SIGTERM', ...)` line. Also export `function telemetryStarted(): boolean`, true only after `sdk.start()` has returned (the winston bridge in the next step imports it; `telemetry.ts` is in this step's Files). `index.ts` `shutdown()` (see logger/index step) starts it immediately, in parallel with `grpcServer.tryShutdown`, because long-lived `WatchConfig`/`StreamEvents` streams block `tryShutdown` indefinitely.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run build
cd services/xstockstrat-notify && pnpm run lint
grep -q 'telemetryStarted' services/xstockstrat-notify/src/telemetry.ts && grep -q 'RpcDurationProcessor' services/xstockstrat-notify/src/telemetry.ts   # fails before the step
```

---

### Step 35 — service: notify: winston → OTLP log bridge and awaited SIGTERM flush (Node)

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/services/logger.ts` — modify
- `services/xstockstrat-notify/src/index.ts` — modify
- `services/xstockstrat-notify/package.json` — modify
- `services/xstockstrat-notify/pnpm-lock.yaml` — modify

**Reviewers**: Service owner (`xstockstrat-notify`) — stream delivery guarantees, backpressure handling

**Codebase Evidence**:
- `services/xstockstrat-notify/src/services/logger.ts`: `getLogger(service)` → `createLogger({ level, defaultMeta: { service }, format: isDev ? combine(colorize(), simple()) : combine(timestamp(), json()), transports: [new transports.Console()] })` (identical across ledger/identity/notify/config modulo a header comment)
- `src/index.ts:1-2`; shutdown :58-61 (`grpcServer.tryShutdown(() => { pool.end(); process.exit(0); })`)
- `@opentelemetry/winston-transport@0.5.0` depends on `@opentelemetry/api-logs ^0.52.0` + `winston-transport 4.*` (npm metadata checked at spec time) — compatible with the 0.52 line; `api-logs` 0.52 has no proxy logger provider, so the transport must be attached only after `sdk.start()`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `@opentelemetry/winston-transport@0.5.0` (pin exact) to `package.json`; `pnpm install` and commit `pnpm-lock.yaml`.
2. **logger.ts**: keep the Console transport, `defaultMeta` and both `format` branches byte-identical (AC-4: stdout line and format unchanged). Export a small `attachOtlpLogTransport(logger)` used by `getLogger` that, only when `OTEL_ENABLED === 'true'` **and telemetry has started** (import the `telemetryStarted()` boolean that `telemetry.ts` exports since the previous step, true after `sdk.start()`), does `logger.add(new OpenTelemetryTransportV3())` (`require('@opentelemetry/winston-transport')`) inside try/catch (non-fatal, warn to console). Loggers created before start stay stdout-only — `index.ts` calls `initTelemetry()` on line 1, before any `getLogger` call, so every service logger is bridged. Do not bridge the OTel `diag` logger (it stays on `console`): that is the recursion guard (FR-4). Winston levels map to OTel severity inside the transport.
3. **index.ts**: change the `shutdown` function (see the evidence lines) to start `const flush = shutdownTelemetry()` immediately, run `grpcServer.tryShutdown(async () => { await flush; <existing pool/notifier cleanup>; process.exit(0); })` unchanged otherwise, and add `setTimeout(() => { grpcServer.forceShutdown(); }, 5000).unref()` so open streams cannot block exit; the flush promise is awaited both in the callback and after `forceShutdown()` (`flush.finally(() => process.exit(0))`). Import `shutdownTelemetry` from `./telemetry`.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run build
cd services/xstockstrat-notify && pnpm run lint
```

---

### Step 36 — test: notify: telemetry tests — export paths, status vectors, lazy histogram, log bridge, shutdown (Node)

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/telemetry.export.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/telemetry.test.ts` — modify

**Reviewers**: Service owner (`xstockstrat-notify`) — stream delivery guarantees, backpressure handling

**Codebase Evidence**:
- `services/xstockstrat-notify/src/__tests__/telemetry.export.test.ts`: in-process `createServer` receiver that only accepts `/v1/traces` (404 otherwise), `OTEL_BSP_SCHEDULE_DELAY=50`, console spies installed **before** the first OTel `import()` (DiagConsoleLogger binds `console.*` at load — ledger insights 2026-10-14), `waitFor` poller, tests `exports a span over OTLP/HTTP...` and `logs a rejected export`
- `services/xstockstrat-notify/src/__tests__/telemetry.test.ts` (resource attribute test, PRESERVE `@AC-1 @feature-171`)
- Node fixtures home is `src/__tests__/fixtures/` (C-13) — materialise only on a second consumer

**TDD**: `red-green required`

**Covers**: `AC-2, AC-10, AC-15, AC-19`

**Instructions**:
1. Write first, capture RED. Keep one-file-per-process (the OTel globals are set once per process).
2. **Export (AC-19, EXTEND `@AC-1 @feature-226`)**: extend the receiver to accept `/v1/traces`, `/v1/metrics` and `/v1/logs` and record each with its `authorization` header; run the file under both header forms (`Authorization=Basic dGVzdDprZXk=` and `Authorization=Basic%20dGVzdDprZXk%3D`, via two child-process runs or two parametrised files since globals are set-once) and assert a recorded counter and a winston `warn` produce `POST /otlp/v1/metrics` and `POST /otlp/v1/logs` with `Basic dGVzdDprZXk=`; traces must still export (regression for the explicit `BatchSpanProcessor`). Set `OTEL_METRIC_EXPORT_INTERVAL=100` for the test.
3. **Lazy histogram**: a test that constructs `RpcDurationProcessor` and calls `onEnd` **before** `sdk.start()` records nothing exported; after start it exports (proves lazy binding).
4. **Status vectors (AC-15)**: read `scripts/testdata/rpc-status-vectors.json` (resolve from `__dirname` up to the repo root, path stable under `dist/__tests__`), feed each Node-applicable vector's hand-built `ReadableSpan` to `RpcDurationProcessor.onEnd` with an in-memory reader, assert the recorded `rpc.grpc.status_code` and bucket boundaries.
5. **Failure visibility**: the existing `logs a rejected export` test stays green and additionally asserts no `/v1/logs` record contains the failure text.
6. **Shutdown flush (AC-12-style)**: with `OTEL_METRIC_EXPORT_INTERVAL=600000`, record 2 metric points + 3 log lines, call `shutdownTelemetry()` and assert both arrive before it resolves; a second call is idempotent.
7. **AC-10 notify row**: metric request resource has `service.name=notify`, `deployment.environment=staging`, `platform=xstockstrat`.
8. **AC-2 end-to-end (real gRPC call)**: in its own child process (OTel globals are set once), run `initTelemetry()` with `OTEL_METRIC_EXPORT_INTERVAL=100`, then `require('@grpc/grpc-js')` **after** `sdk.start()` (the gRPC instrumentation patches the module on first require); start an in-process `grpc.Server` on `127.0.0.1:0` with insecure credentials and one inline unary method (`/t.T/Get`, Buffer-identity serializers, no proto) whose handler returns `{ code: grpc.status.NOT_FOUND }`, call it with a client, and assert the receiver's JSON `/otlp/v1/metrics` body contains an `rpc.server.duration` data point with `rpc.grpc.status_code` = 5 and the shared bucket boundaries. This proves the instrumentation really sets the attribute `RpcDurationProcessor` reads; the hand-built-span vectors above prove only the mapping rules.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
cd services/xstockstrat-notify && pnpm run lint
```

---

### Step 37 — service: config: metric reader, log processor, span-derived rpc.server.duration, awaited shutdown (Node)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/telemetry.ts` — modify
- `services/xstockstrat-config/package.json` — modify
- `services/xstockstrat-config/pnpm-lock.yaml` — modify

**Reviewers**: Service owner (`xstockstrat-config`) — secret redaction, WatchConfig stream stability

**Codebase Evidence**:
- `services/xstockstrat-config/src/telemetry.ts`: `buildResource()` (sync `Resource` 1.x), `initTelemetry()` gate `OTEL_ENABLED !== 'true'`, lazy requires of `NodeSDK`/`OTLPTraceExporter`/`GrpcInstrumentation`, `new NodeSDK({ resource, traceExporter: new OTLPTraceExporter(), resourceDetectors: [envDetectorSync, processDetectorSync, hostDetectorSync], instrumentations: [new GrpcInstrumentation()] })`, `sdk.start()`, `process.on('SIGTERM', () => sdk.shutdown().catch(console.error))` (default `SERVICE_NAME` fallback `'config'`; the four files differ only in that literal and the header comment — `diff` vs ledger)
- `services/xstockstrat-config/package.json`: `@opentelemetry/{api ^1.9.0, exporter-trace-otlp-http ^0.52.0, instrumentation-grpc ^0.52.0, resources ^1.25.0, sdk-node ^0.52.0, semantic-conventions ^1.25.0}`; scripts `test: tsc && node --test dist/__tests__/*.test.js`, `test:coverage` (c8), `lint: eslint src --ext .ts`
- `src/index.ts:1-2`; shutdown :59-65 (`grpcServer.tryShutdown(() => {... process.exit(0); })`)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Dependencies** (`package.json` + that service's `pnpm-lock.yaml`; run `cd services/xstockstrat-config && pnpm install` and commit the lock): add `@opentelemetry/exporter-metrics-otlp-http@^0.52.0`, `@opentelemetry/exporter-logs-otlp-http@^0.52.0`, `@opentelemetry/sdk-trace-base@^1.25.0`, `@opentelemetry/sdk-metrics@^1.25.0`, `@opentelemetry/sdk-logs@^0.52.0`, `@opentelemetry/api-logs@^0.52.0` (currently only transitive: lock has `sdk-metrics@1.25.1`, `sdk-logs@0.52.1`, `api-logs@0.52.1`, `sdk-trace-base@1.25.1`, `sdk-node@0.52.1`; the exporter packages are absent). sdk-node 0.52.1 supports `metricReader`, `logRecordProcessor`, `views` and `spanProcessors` options (`sdk-node/build/src/types.d.ts:12-22`).
2. **telemetry.ts**: keep `buildResource()` and the `OTEL_ENABLED` gate. Replace `traceExporter: new OTLPTraceExporter()` with `spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter()), rpcDuration]` — passing `spanProcessors` disables sdk-node's implicit trace exporter (`sdk-node/build/src/sdk.js:61-84`), so the trace `BatchSpanProcessor` **must** be listed explicitly or traces silently stop (the `@AC-1 @feature-226` test is the regression proof). Add `metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })` and `logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter())` (singular option names on 0.52). All three exporters are constructed with **no** url/headers/endpoint argument (PLAT-3). Keep the lazy `require(...)` style, `diag` WARN logger and the `[otel] tracing enabled →` line. All four services compile to CommonJS (`tsconfig.json: "module": "commonjs"`; tests run `tsc && node --test dist/__tests__/*.test.js`), so plain `require` stays — design's `createRequire` guard is not needed (deviation D3; recon's 'strip-types runner' claim no longer holds).
3. **RPC recorder** (`class RpcDurationProcessor implements SpanProcessor` in `telemetry.ts`, exported for tests): `onEnd(span)` ignores spans unless `span.kind === SpanKind.SERVER && span.attributes['rpc.system'] === 'grpc'`; duration in ms from `span.duration` (`[s, ns]`); histogram `rpc.server.duration` (unit `ms`, bucket boundaries `[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]` via a `views` entry or advice) is created **lazily on the first `onEnd`**, after `sdk.start()` registered the global meter provider — `@opentelemetry/api` 1.9.1 has no proxy MeterProvider, so early binding would export nothing (a test proves it). Attributes exactly `rpc.system`, `rpc.service`, `rpc.method` and an **integer** `rpc.grpc.status_code`. Status rule: use the integer attribute when it is in `0..16`, otherwise (missing, non-integer such as a string, falsy `err.code`, out of range) fall back to: an `exception` event or span status ERROR → 2, else 0. grpc-js sets the attribute via `callback({code})` (`@opentelemetry/instrumentation-grpc` `serverUtils.js:75-83`) and a falsy/absent `err.code` leaves it unset (`serverUtils.js:76-87`) → recorded 2.
4. **Shutdown**: export `async function shutdownTelemetry()` that calls `sdk.shutdown()` once (idempotent promise) and replace the unawaited `process.on('SIGTERM', ...)` line. Also export `function telemetryStarted(): boolean`, true only after `sdk.start()` has returned (the winston bridge in the next step imports it; `telemetry.ts` is in this step's Files). `index.ts` `shutdown()` (see logger/index step) starts it immediately, in parallel with `grpcServer.tryShutdown`, because long-lived `WatchConfig`/`StreamEvents` streams block `tryShutdown` indefinitely.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run build
cd services/xstockstrat-config && pnpm run lint
grep -q 'telemetryStarted' services/xstockstrat-config/src/telemetry.ts && grep -q 'RpcDurationProcessor' services/xstockstrat-config/src/telemetry.ts   # fails before the step
```

---

### Step 38 — service: config: winston → OTLP log bridge and awaited SIGTERM flush (Node)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/services/logger.ts` — modify
- `services/xstockstrat-config/src/index.ts` — modify
- `services/xstockstrat-config/package.json` — modify
- `services/xstockstrat-config/pnpm-lock.yaml` — modify

**Reviewers**: Service owner (`xstockstrat-config`) — secret redaction, WatchConfig stream stability

**Codebase Evidence**:
- `services/xstockstrat-config/src/services/logger.ts`: `getLogger(service)` → `createLogger({ level, defaultMeta: { service }, format: isDev ? combine(colorize(), simple()) : combine(timestamp(), json()), transports: [new transports.Console()] })` (identical across ledger/identity/notify/config modulo a header comment)
- `src/index.ts:1-2`; shutdown :59-65 (`grpcServer.tryShutdown(() => {... process.exit(0); })`)
- `@opentelemetry/winston-transport@0.5.0` depends on `@opentelemetry/api-logs ^0.52.0` + `winston-transport 4.*` (npm metadata checked at spec time) — compatible with the 0.52 line; `api-logs` 0.52 has no proxy logger provider, so the transport must be attached only after `sdk.start()`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `@opentelemetry/winston-transport@0.5.0` (pin exact) to `package.json`; `pnpm install` and commit `pnpm-lock.yaml`.
2. **logger.ts**: keep the Console transport, `defaultMeta` and both `format` branches byte-identical (AC-4: stdout line and format unchanged). Export a small `attachOtlpLogTransport(logger)` used by `getLogger` that, only when `OTEL_ENABLED === 'true'` **and telemetry has started** (import the `telemetryStarted()` boolean that `telemetry.ts` exports since the previous step, true after `sdk.start()`), does `logger.add(new OpenTelemetryTransportV3())` (`require('@opentelemetry/winston-transport')`) inside try/catch (non-fatal, warn to console). Loggers created before start stay stdout-only — `index.ts` calls `initTelemetry()` on line 1, before any `getLogger` call, so every service logger is bridged. Do not bridge the OTel `diag` logger (it stays on `console`): that is the recursion guard (FR-4). Winston levels map to OTel severity inside the transport.
3. **index.ts**: change the `shutdown` function (see the evidence lines) to start `const flush = shutdownTelemetry()` immediately, run `grpcServer.tryShutdown(async () => { await flush; <existing pool/notifier cleanup>; process.exit(0); })` unchanged otherwise, and add `setTimeout(() => { grpcServer.forceShutdown(); }, 5000).unref()` so open streams cannot block exit; the flush promise is awaited both in the callback and after `forceShutdown()` (`flush.finally(() => process.exit(0))`). Import `shutdownTelemetry` from `./telemetry`.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run build
cd services/xstockstrat-config && pnpm run lint
```

---

### Step 39 — test: config: telemetry tests — export paths, status vectors, lazy histogram, log bridge, shutdown (Node)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/telemetry.export.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/telemetry.test.ts` — modify

**Reviewers**: Service owner (`xstockstrat-config`) — secret redaction, WatchConfig stream stability

**Codebase Evidence**:
- `services/xstockstrat-config/src/__tests__/telemetry.export.test.ts`: in-process `createServer` receiver that only accepts `/v1/traces` (404 otherwise), `OTEL_BSP_SCHEDULE_DELAY=50`, console spies installed **before** the first OTel `import()` (DiagConsoleLogger binds `console.*` at load — ledger insights 2026-10-14), `waitFor` poller, tests `exports a span over OTLP/HTTP...` and `logs a rejected export`
- `services/xstockstrat-config/src/__tests__/telemetry.test.ts` (resource attribute test, PRESERVE `@AC-1 @feature-171`)
- Node fixtures home is `src/__tests__/fixtures/` (C-13) — materialise only on a second consumer

**TDD**: `red-green required`

**Covers**: `AC-2, AC-5, AC-7, AC-15, AC-19`

**Instructions**:
1. Write first, capture RED. Keep one-file-per-process (the OTel globals are set once per process).
2. **Export (AC-19, EXTEND `@AC-1 @feature-226`)**: extend the receiver to accept `/v1/traces`, `/v1/metrics` and `/v1/logs` and record each with its `authorization` header; run the file under both header forms (`Authorization=Basic dGVzdDprZXk=` and `Authorization=Basic%20dGVzdDprZXk%3D`, via two child-process runs or two parametrised files since globals are set-once) and assert a recorded counter and a winston `warn` produce `POST /otlp/v1/metrics` and `POST /otlp/v1/logs` with `Basic dGVzdDprZXk=`; traces must still export (regression for the explicit `BatchSpanProcessor`). Set `OTEL_METRIC_EXPORT_INTERVAL=100` for the test.
3. **Lazy histogram**: a test that constructs `RpcDurationProcessor` and calls `onEnd` **before** `sdk.start()` records nothing exported; after start it exports (proves lazy binding).
4. **Status vectors (AC-15)**: read `scripts/testdata/rpc-status-vectors.json` (resolve from `__dirname` up to the repo root, path stable under `dist/__tests__`), feed each Node-applicable vector's hand-built `ReadableSpan` to `RpcDurationProcessor.onEnd` with an in-memory reader, assert the recorded `rpc.grpc.status_code` and bucket boundaries.
5. **Failure visibility**: the existing `logs a rejected export` test stays green and additionally asserts no `/v1/logs` record contains the failure text.
6. **Shutdown flush (AC-12-style)**: with `OTEL_METRIC_EXPORT_INTERVAL=600000`, record 2 metric points + 3 log lines, call `shutdownTelemetry()` and assert both arrive before it resolves; a second call is idempotent.
7. **AC-5**: with `OTEL_ENABLED=false`, start the module, simulate 10 WatchConfig-style gRPC calls on a local `@grpc/grpc-js` server (reuse an existing config test's server harness), and assert the receiver got zero requests and no meter/logger provider exists (`metrics.getMeterProvider()` is the no-op); **AC-7**: with `OTEL_ENABLED=true`, log a request line through `getLogger` while serving `GetSecret` for a secret row whose plaintext is `AKTESTSECRET123` (reuse the secret fixtures in `src/__tests__/secretsAndScope.test.ts`/`secretCallerAuthz.test.ts`), and assert no `/v1/logs` body or attribute contains `AKTESTSECRET123` (decode the OTLP/JSON or protobuf body as text).
8. **AC-2 end-to-end (real gRPC call)**: in its own child process (OTel globals are set once), run `initTelemetry()` with `OTEL_METRIC_EXPORT_INTERVAL=100`, then `require('@grpc/grpc-js')` **after** `sdk.start()` (the gRPC instrumentation patches the module on first require); start an in-process `grpc.Server` on `127.0.0.1:0` with insecure credentials and one inline unary method (`/t.T/Get`, Buffer-identity serializers, no proto) whose handler returns `{ code: grpc.status.NOT_FOUND }`, call it with a client, and assert the receiver's JSON `/otlp/v1/metrics` body contains an `rpc.server.duration` data point with `rpc.grpc.status_code` = 5 and the shared bucket boundaries. This proves the instrumentation really sets the attribute `RpcDurationProcessor` reads; the hand-built-span vectors above prove only the mapping rules.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
cd services/xstockstrat-config && pnpm run lint
```

---

### Step 40 — service: identity: seed-admin refusal log carries user_id, not the email

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify

**Reviewers**: Service owner (`xstockstrat-identity`) — no plaintext credentials in config or logs

**Codebase Evidence**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:138-156`: `SELECT user_id, password_hash, roles FROM identity.users WHERE email = $1` → `const user = result.rows[0]` → `if (isBlockedDefaultAdmin(user.password_hash, process.env.APPLICATION_ENV)) { log.warn('Refused default seed-admin login in production; rotate its password via scripts/manage-users.py reset-password', { email }); return callback({ code: 16, message: 'invalid credentials' }); }`
- Only email-bearing log call in `src/` (`grep -rn "email" services/xstockstrat-identity/src --include=*.ts | grep -i "log\."`); `target_email` ledger audit payloads are out of scope (design § Identity)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Change the second argument of that `log.warn` from `{ email }` to `{ user_id: user.user_id }` (the row already selects `user_id`). Message text unchanged. Operator decision R2: 'Replace with user_id everywhere' — PII removed at source on stdout and OTLP.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run build
cd services/xstockstrat-identity && pnpm run lint
grep -q 'user_id: user.user_id' services/xstockstrat-identity/src/grpc/identityServiceImpl.ts   # fails before the step
```

---

### Step 41 — test: identity: seed-admin log has user_id only; auth logs export no credential plaintext

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/fixtures/otlpReceiver.ts` — create
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.otlp.test.ts` — create (the OTLP-bridged halves of AC-20 and AC-13; `node --test` runs each test file in its own process, which the set-once OTel globals require)
- `services/xstockstrat-identity/src/__tests__/telemetry.export.test.ts` — modify (import the shared receiver instead of its inline copy)

**Reviewers**: Service owner (`xstockstrat-identity`) — no plaintext credentials in config or logs

**Codebase Evidence**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts:110-135`: `describe('default seed-admin lockout')` with `authenticateUser refuses the default seed-admin credential in production (code 16)`; rebase-only overlap with feature 252 on identity telemetry tests

**TDD**: `red-green required`

**Covers**: `AC-13, AC-20`

**Instructions**:
1. **AC-20**: in the existing seed-admin test spy the logger (`getLogger` is module-level `log`; assert via the winston transport stream or a spy on `logger.warn`) and require the second argument deep-equals `{ user_id: <row user_id> }` and that `JSON.stringify` of the call contains neither `admin@example.com` nor the email. With `OTEL_ENABLED=true` and the in-process OTLP receiver, which this step extracts from step 33's `telemetry.export.test.ts` into `src/__tests__/fixtures/otlpReceiver.ts` (C-13: this is its second consumer; that test file is edited to import it), additionally assert, in `identityServiceImpl.otlp.test.ts` (own process; `initTelemetry()` runs before the implementation is imported), that the exported `/v1/logs` record carries `user_id` and not the email.
2. **AC-13** (in `identityServiceImpl.otlp.test.ts`, same isolation reason): serve `authenticateUser` with password `Hunter2!Plain` returning an access token (reuse the file's pool mock/fixtures — C-13 second consumer rule) with the OTLP bridge active; decode every exported `/v1/logs` body and assert none contains `Hunter2!Plain` or the issued token string. If the check fails, the leak is in an existing log call — fix at the call site (egress audit step) rather than redacting in the bridge.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
cd services/xstockstrat-identity && pnpm run lint
```

---

### Step 42 — service: ui: explicit metric reader + log processor (0.218 line), declared exporter deps

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/telemetry.ts` — modify
- `services/xstockstrat-ui/package.json` — modify
- `pnpm-lock.yaml` — modify

**Reviewers**: Service owner (`xstockstrat-ui`) — Connect-RPC call safety, no secret values rendered/logged

**Codebase Evidence**:
- `services/xstockstrat-ui/src/telemetry.ts` (sdk-node 0.218, 2.x `resourceFromAttributes`): `new NodeSDK({ resource: resourceFromAttributes({...service.name, 'deployment.environment', platform}), traceExporter: new OTLPTraceExporter(), metricReaders: [], logRecordProcessors: [], instrumentations: [] })`, then `console.info('[otel] tracing enabled → ...')` and `process.on('SIGTERM', ...)`; hook `src/instrumentation.ts:1-6` guarded by `NEXT_RUNTIME === 'nodejs'`
- `services/xstockstrat-ui/package.json:31-35`: `@opentelemetry/{api ^1.9.0, exporter-trace-otlp-http ^0.218.0, resources ^2.7.1, sdk-node ^0.218.0, semantic-conventions ^1.41.1}`; root `pnpm-lock.yaml` already resolves `exporter-metrics-otlp-http@0.218.0` (:1560), `exporter-logs-otlp-http@0.218.0` (:1542), `sdk-metrics@2.7.1`, `sdk-logs@0.218.0` transitively — must be **declared**, not relied on
- UI workspace lock is the repo-root `pnpm-lock.yaml` (no `services/xstockstrat-ui/pnpm-lock.yaml`)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Declare `@opentelemetry/exporter-metrics-otlp-http@^0.218.0`, `@opentelemetry/exporter-logs-otlp-http@^0.218.0`, `@opentelemetry/sdk-metrics@^2.7.1`, `@opentelemetry/sdk-logs@^0.218.0`, `@opentelemetry/api-logs@^0.218.0`; `pnpm install` from the repo root and commit `pnpm-lock.yaml`. Node-runtime only: imports stay inside the lazy `require` block (PRESERVE `@AC-6 @feature-128` standalone build).
2. In `new NodeSDK({...})` replace `metricReaders: []` with `metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })]` and `logRecordProcessors: []` with `logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())]` (env-only exporters, no url — PLAT-3). **Keep** `traceExporter: new OTLPTraceExporter()` (the UI passes no `spanProcessors`, so the implicit trace processor stays), keep `instrumentations: []` and the exact `[otel] tracing enabled →` literal (PRESERVE `@AC-2 @feature-226`). The file's own `console.*` lines stay stdout-only — they must **not** be routed through `serverLog` (recursion guard). Update the stale comment above the empty arrays.
3. Flush on deploy is best-effort (accepted): keep the `process.on('SIGTERM', ...)` shutdown; Next.js owns process lifecycle.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm run test:unit
grep -q 'PeriodicExportingMetricReader' services/xstockstrat-ui/src/telemetry.ts && ! grep -q 'metricReaders: \[\]' services/xstockstrat-ui/src/telemetry.ts   # fails before the step
```

---

### Step 43 — service: ui: http.server.duration recorder for Connect BFF (unary only) and REST route handlers

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/bffMetrics.ts` — create
- `services/xstockstrat-ui/src/lib/bffShared.ts` — modify
- `services/xstockstrat-ui/src/app/accounts/api/profile/route.ts` — modify
- `services/xstockstrat-ui/src/app/accounts/api/mcp-tools/route.ts` — modify
- `services/xstockstrat-ui/src/app/accounts/api/agent-health/route.ts` — modify
- `services/xstockstrat-ui/src/app/accounts/api/authorized-apps/route.ts` — modify
- `services/xstockstrat-ui/src/app/trader/api/ledger/export/route.ts` — modify

**Reviewers**: Service owner (`xstockstrat-ui`) — Connect-RPC call safety, no secret values rendered/logged

**Codebase Evidence**:
- `services/xstockstrat-ui/src/lib/bffShared.ts:115-152`: `createDispatch(router, prefix)` builds `handlerMap = new Map(router.handlers.map((h) => [prefix + h.requestPath, h]))`; `dispatchConnect(req)` → `const handler = handlerMap.get(pathname); if (!handler) return new Response(null, { status: 404 }); const uRes = await handler({...}); ... return new Response(...)`; used by `src/lib/traderBff.ts`, `insightsBff.ts`, `configUiBff.ts` (and route files `trader|insights|config-ui/api/[...connect]/route.ts`)
- REST handlers: `accounts/api/profile/route.ts` exports `GET` :32 and `PUT` :49; `mcp-tools` GET :12; `agent-health` GET :6; `authorized-apps` GET :13, POST :39; `trader/api/ledger/export/route.ts` GET :86. Health, auth, OAuth, `config-ui/api/audit` routes are **not** wrapped (accepted, design Open Risks)
- `@connectrpc/connect` resolves a server stream on its first message (`protocol-connect/handler-factory.js:277-280`, `untilFirst`) so a server-stream handler's duration is time-to-first-message — only `handler.method.methodKind === 'unary'` is recorded (design R3 B1)
- **File count (C-18, recorded)**: seven Files because five are the same mechanical one-line `withBffMetrics(...)` wrap of an existing exported handler. Splitting them out would renumber steps 44-59 and every cross-reference (the same call feature 250 accepted for its step 7), so the step stays whole and its Verification (lint + unit) covers all seven.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `src/lib/bffMetrics.ts` exporting `recordBffDuration({ segment, route?, rpcService?, status, startMs })` and `withBffMetrics(segment, route, handler)` (the one shared helper for both seams — C-18). The histogram `http.server.duration` (unit `ms`) is created lazily on first use via `metrics.getMeter('xstockstrat-ui')` (API 1.9.1 has no proxy provider; no-op when OTel is off). Attributes: `xstk.segment` (`trader|insights|config-ui|accounts`), `http.route` (static template for REST; omit for Connect), `http.response.status_code`, and `rpc.service` (Connect only; `unmatched` for an unmatched path). Never user ids, symbols or raw paths (cardinality).
2. In `createDispatch`: capture `const t0 = performance.now()` before the handler lookup; for an unmatched path record `rpc.service="unmatched"`, status 404 and return; for a matched handler wrap `await handler(...)` in `try/finally` and record **only when `handler.method.methodKind === 'unary'`**, with `rpc.service = handler.service.typeName` (verified at spec time: the UI resolves `@connectrpc/connect` 2.1.1, whose `UniversalHandler` carries `service: DescService` and `method: DescMethod`, `dist/esm/protocol/universal-handler.d.ts:95,99`; `DescService.typeName` is the proto-qualified name) and `http.response.status_code = uRes.status` (status 500 when it threw). Server-streaming methods (StreamAlerts, StreamOrderUpdates, ...) are never recorded. `createDispatch` already receives the segment inside its `prefix` argument (`'/trader/api'`, `'/insights/api'`, `'/config-ui/api'` at `traderBff.ts:172`, `insightsBff.ts:218`, `configUiBff.ts:104`), so derive it with `prefix.split('/')[1]`; the signature and the three callers stay unchanged (nothing outside this step's Files is touched).
3. Wrap each exported REST handler with `withBffMetrics('accounts'|'trader', '/accounts/api/profile', handler)` etc. (`http.route` = the literal route template). Do not change response bodies, status codes or auth logic.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm run test:unit
```

---

### Step 44 — service: ui: serverLog module bridging server-side logs to the OTel logger; migrate console.* sites

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/serverLog.ts` — create
- `services/xstockstrat-ui/src/app/api/auth/login/route.ts` — modify
- `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts` — modify

**Reviewers**: Service owner (`xstockstrat-ui`) — Connect-RPC call safety, no secret values rendered/logged

**Codebase Evidence**:
- `grep -rn "console\." services/xstockstrat-ui/src --include=*.ts --include=*.tsx | grep -v test` → only `src/app/api/auth/login/route.ts:33` (`console.error('[login] identity service error:', ...)`), `src/app/config-ui/api/audit/route.ts:68` (`console.error('config-ui audit: database error', {...})`) and `src/telemetry.ts` (stdout-only by design). No logger module exists today (recon: 'Not found')

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `src/lib/serverLog.ts`: `serverLog.{info,warn,error}(message, attrs?)` writes the **same** console line the call site writes today (`console.error(message, attrs)` etc.) and then emits through `logs.getLogger('xstockstrat-ui').emit({ severityNumber, severityText, body: message, attributes })` (from `@opentelemetry/api-logs`) resolved **at call time** (no module-level binding; no-op when OTel off). Emit only the message and the attributes the caller passes — no request/headers objects (FR-5). Convert `Error` attrs to `{ 'exception.message', 'exception.stack' }` only where the stdout line already prints the stack.
2. Migrate the two call sites to `serverLog.error(...)` keeping message text and arguments. `telemetry.ts` console lines are **not** migrated (recursion guard).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm run test:unit
```

---

### Step 45 — test: ui: telemetry tests — export paths under both header forms, resource, log correlation

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/instrumentation.test.ts` — modify
- `services/xstockstrat-ui/src/lib/serverLog.test.ts` — create
- `services/xstockstrat-ui/src/instrumentation.encoded-header.test.ts` — create (the percent-encoded header form; OTel globals are set once per process and vitest isolates files, so one header form per file)

**Reviewers**: Service owner (`xstockstrat-ui`) — Connect-RPC call safety, no secret values rendered/logged

**Codebase Evidence**:
- `services/xstockstrat-ui/src/instrumentation.test.ts:1-60`: plain console recorders installed before OTel loads (not `vi.spyOn` — vitest clears spy history before each test, ledger fails 2026-10-15), receiver on `/v1/traces` only, `OTEL_BSP_SCHEDULE_DELAY=50`, `register()` then `trace.getTracer('t').startSpan(...)`
- `vitest.config.ts:20` includes `src/**/*.test.ts`; coverage scoped to `src/lib/**` with 40% thresholds (`:21-33`)

**TDD**: `red-green required`

**Covers**: `AC-10, AC-11, AC-19`

**Instructions**:
1. Extend the receiver to record `/v1/metrics` and `/v1/logs`; under the raw header form here and the percent-encoded form `Authorization=Basic%20dGVzdDprZXk%3D` in `instrumentation.encoded-header.test.ts` (same assertions, shared receiver helper) assert metric and log POSTs to `/otlp/v1/metrics` and `/otlp/v1/logs` with `Basic dGVzdDprZXk=` and that traces still export (`traceExporter` kept). **AC-10 ui row**: the metric request resource has `service.name=ui` (`SERVICE_NAME=ui`), `deployment.environment=staging`, `platform=xstockstrat`. **AC-11 ui row**: `serverLog.warn('x')` called inside `trace.getTracer('t').startActiveSpan(...)` is exported with severity WARN and `traceId` equal to the active span's (this is the open-risk 'UI trace correlation' proof; if Next's own server span is needed instead, record the finding in `context.md`).
2. `serverLog.test.ts` (unit): the stdout line equals the call site's prior `console.*` output; disabled OTel emits nothing; the telemetry module's own console lines never reach `/v1/logs` (recursion guard). Keep the preserved literals: `[otel] tracing enabled` and `/otlp/v1/traces`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:coverage   # floors enforced by vitest.config.ts:29-33
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 46 — test: ui: BFF route histogram — unary Connect and REST recorded; stream and unmatched handled

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/__tests__/bffMetrics.test.ts` — create

**Reviewers**: Service owner (`xstockstrat-ui`) — Connect-RPC call safety, no secret values rendered/logged

**Codebase Evidence**:
- `services/xstockstrat-ui/src/lib/__tests__/traderBff.test.ts` drives the real `dispatchConnect` from `traderBff.ts` with `vi.mock('@/lib/auth')` and `vi.mock('@/lib/connectClients')` (`:8-30`), and `src/lib/bffDeadlines.test.ts` does the same per segment through `dispatchers[segment]` (`:45-49`, `:63-74`): copy that mocking pattern into the new test file (neither existing file exports it, and this step modifies neither); `traderBff.ts` registers `ListBrokerAccounts` (`:64`, unary) and `StreamAlerts` (`:95-98`, server-streaming); `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` (C-12): no new Playwright fixtures are needed — these are vitest unit tests

**TDD**: `red-green required`

**Covers**: `AC-16`

**Instructions**:
1. With an `InMemoryMetricReader` MeterProvider: (1) a unary `TradingService` Connect call returning 200 through the real `dispatchConnect` from `traderBff.ts` (`ListBrokerAccounts`, with `tradingClient` mocked as in `traderBff.test.ts`) produces an `http.server.duration` point with `xstk.segment=trader`, `rpc.service=xstockstrat.trading.v1.TradingService`, `http.response.status_code=200`; (2) a wrapped `GET /accounts/api/profile` returns 200 and records `xstk.segment=accounts`, `http.route=/accounts/api/profile`; (3) a server-streaming method (`StreamAlerts` on `NotifyService`, registered at `traderBff.ts:95-98`) records **no** point: mock `notifyClient.streamAlerts` in the new file as an async generator that yields one message and then awaits an unresolved promise (`traderBff.test.ts` stubs `notifyClient` as `{}`, so this file mocks it itself), read the first message through `dispatchConnect` so the response has started, and assert no point carries `rpc.service=xstockstrat.notify.v1.NotifyService` while the stream is open and after it is released — only `methodKind === 'unary'` is recorded; (4) an unmatched path records `rpc.service=unmatched`, status 404; (5) a handler that throws still records (try/finally) with status 500. Use inventory fixtures for domain objects (C-12); error payloads stay inline.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:coverage   # floors enforced by vitest.config.ts:29-33
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 47 — docs: PR-A teardown: reconcile service-level context files and record the doc-drift waiver

**Status**: `pending`
**Service**: `services/*/CLAUDE.md, services/*/docs/`
**Files**:
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `services/xstockstrat-ui/docs/context-constitution.md` — modify
- `services/xstockstrat-ui/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-agent/docs/context-constitution.md` — modify
- `services/xstockstrat-notify/docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `grep -ln -i "otel\|opentelemetry" services/xstockstrat-*/CLAUDE.md services/xstockstrat-*/docs/*.md` → ui `CLAUDE.md` (:301-302 env block, :358 OTel prose, :412 path table), ui `docs/context-constitution.md:60` (OTel hook row), ui `docs/context-constitution-findings.md:12` (env-block row), agent `docs/context-constitution.md:37` ('instruments the gRPC *client* channel'), notify `docs/context-constitution.md:39` (OTel gate row)
- Constraint: PR-A must touch **no** file under `docs/` or `packages/otel/` — guard Part 2 scans both trees and would fail CI (design § PR-A Scope). `services/*/docs` and service `CLAUDE.md` are outside the guard's scope.
- Operator waiver (R3 gate, `context.md`): the PR-A → PR-B window leaves `docs/` and `packages/otel/` understating (they still say 'traces only').

**TDD**: N/A (non-code-bearing)

**Covers**: —

**Instructions**:
1. Re-read each listed file against the code as changed by PR-A and fix drift: ui `CLAUDE.md` § Observability must say the UI now exports traces, metrics and logs (`http.server.duration`, `serverLog`); the agent row must add `mcp.tool.duration`; notify row line hints re-stamped; ui findings row re-checked. Apply the `/context-forge:context-constitution refresh` teardown scoped to these files; if the plugin is unavailable, do the manual re-read-against-code and record **both** the unavailability **and** the reconciliation performed in the PR-A body (fails.md:670).
2. PR-A body must also record the operator-waived docs under-statement window and link the egress-audit verdicts from `context.md`.

**Verification**:
```bash
git diff --stat origin/main-dev...HEAD -- docs packages/otel ':!docs/roadmap'  # expect empty: PR-A touches neither tree (docs/roadmap context bookkeeping excluded; the guard skips it)
bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh  # still green (guard unchanged in PR-A)
```

---

### Step 48 — docs: G1 dev proof gate (operator) and feature-branch re-sync — blocks PR-B

**Status**: `pending`
**Service**: `operator / Grafana Cloud dev`
**Files**:
- `docs/roadmap/features/274-otel-metrics-logs-export/context.md` — modify (append G1 answers)

**Reviewers**: none

**Codebase Evidence**:
- Design § G1: PR-A deploys to dev with `OTEL_ENABLED="true"` (`.do/app.dev.yaml:30-31`); prod stays `"false"` (`.do/app.yaml:30-31`) — the prod flip is out of scope
- Open risks closed here: Grafana Cloud OTLP→Prometheus label/series names (R2), real cross-language non-zero status emission, UI trace correlation, cost budget

**TDD**: N/A (non-code-bearing)

**Covers**: —

**Instructions**:
0. **Operator hand-offs (outside the `/sdd-execute` loop; no step opens or merges a PR to `main-dev`, F-02/F-03)**: the operator squash-merges PR-A, confirms the dev deploy finished, and tells the orchestrator, who records `- G1 handoff (<YYYY-MM-DD>): PR-A merged <sha>, dev deployed` first. Do not continue without it.
1. After PR-A squash-merges to `main-dev` and the dev app has deployed, the operator (with Grafana Cloud credentials) runs this fixed set and the orchestrator records each answer **verbatim** in `context.md`, one line each, as `- G1 q<n> (<YYYY-MM-DD>): <answer>`: (1) `count by (service_name)(rpc_server_duration_milliseconds_count)` returns 10 — if empty check `count by (job)(…)` and `target_info`; a different name/label means PR-B is re-pointed under a superseding AC with operator sign-off (AC-2 is append-only); (2) `count by (rpc_service, rpc_method, rpc_grpc_status_code)(rpc_server_duration_milliseconds_count{service_name="indicators"})` and the same for one Node service — at least one **real non-zero** status from one Python and one Node service; (3) `mcp_tool_duration_milliseconds_count` and `http_server_duration_milliseconds_count{service_name="ui"}`; (4) Loki `count_over_time({service_name="analysis"} |= "live_loop: cycle complete" [10m])`; (5) Loki label browser: `platform`, `deployment_environment`, `detected_level` vs `severity_text`, `trace_id`; (6) `{service_name=~".+"} |= "opentelemetry"` must be empty (FR-4); (7) active series per `service_name`, Loki bytes/day, and the stream-method series by `rpc_method` (cost input for the prod flip).
2. If any answer contradicts a design assumption, STOP: raise it (P-03); do not start PR-B. Otherwise merge `origin/main-dev` into `feature/otel-metrics-logs-export` (re-sync) and set `status.md` to remain `in-progress` until PR-B merges.

**Verification**:
```bash
c=docs/roadmap/features/274-otel-metrics-logs-export/context.md
grep -q -E '^- G1 handoff \([0-9]{4}-[0-9]{2}-[0-9]{2}\):' "$c" || echo 'MISSING G1 handoff'
for n in 1 2 3 4 5 6 7; do grep -q -E "^- G1 q$n \([0-9]{4}-[0-9]{2}-[0-9]{2}\):" "$c" || echo "MISSING G1 q$n"; done   # expect no output
```

---

### Step 49 — service: guard: produced-signals registry as an allowlist; retire Part 2; relax P3-count

**Status**: `pending`
**Service**: `scripts/ + packages/otel (non-service)`
**Files**:
- `packages/otel/produced-signals.tsv` — create
- `scripts/check-otel-produced-signals.sh` — modify

**Reviewers**: Platform Lead — cross-service telemetry contract; produced-signal guard correctness

**Codebase Evidence**:
- `scripts/check-otel-produced-signals.sh` (landed by 250): `part1()` is a denylist (`grep -n -i -E 'prometheus|mimir|loki|promql|logql'` and `'rpc_server_duration|service_name[[:space:]]*='` over `packages/otel/alerts/*.yaml` → `AC-1`, `dashboards/*.json` → `AC-2`); Part 2 = `scan_file` strip of `$SANCTIONED`/`$FOLLOWUP` + `P2-specific`/`P2-generic` greps over `docs/` and `packages/otel`; Part 3 = fence/existence/`check_count` (`P3-name|file|count|fence`); header comment :1-12; `FOLLOWUP`/`SANCTIONED`/`DEFECT` literals :18-21
- `scripts/check-otel-produced-signals.test.sh` (267 lines) asserts hit prefixes `AC-1 P1`, `AC-2 P1`, `AC-3 P2-*`, `P3-*` using fixtures under `scripts/testdata/otel-produced-signals/` — Part 2 red cases (`fr4.prefix.tsv` loop at :104-107) and the sanctioned-literal cases (`strip-exact-literal` … `followup-trailing-prose`) become obsolete when Part 2 retires
- Design § PR-B: registry columns `kind | identifier | producer-path | producer-literal`; Part 1 extracts every PromQL identifier before `{`/`[`/`)` minus PromQL keywords/functions, plus every Loki `service_name` value and `|=`/`|~` literal in an asset `expr`; each must be registered; every row's producer literal must still exist at its producer path; the Part 2 retirement is the signed-off **C-16 CHANGE** of 250 `@AC-3` (context.md R1 gate). **Not found**: `packages/otel/produced-signals.tsv` — create

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `packages/otel/produced-signals.tsv` (tab-separated, header row) with one row per produced series/stream, each with a producer literal grep-able at its producer path: metrics `rpc_server_duration_milliseconds_count|_bucket|_sum` (producers: Go `internal/telemetry/otel.go` literal `rpc.server.duration` via otelgrpc — path `services/xstockstrat-trading/internal/telemetry/otel.go`; Python `services/xstockstrat-indicators/app/telemetry.py` literal `rpc.server.duration`; Node `services/xstockstrat-ledger/src/telemetry.ts` literal `rpc.server.duration` — one row per language is enough, list the others in the producer-path column separated by `,`; the registry-integrity check passes when **any one** listed path contains the literal), `mcp_tool_duration_milliseconds_*` (`services/xstockstrat-agent/app/tool_metrics.py`, literal `mcp.tool.duration`), `http_server_duration_milliseconds_*` (`services/xstockstrat-ui/src/lib/bffMetrics.ts`, literal `http.server.duration`); Loki stream label value `service_name` ∈ the 12 service names (producer = each runtime's `SERVICE_NAME` default); Loki literal `live_loop: cycle complete` (`services/xstockstrat-analysis/app/engine/live_loop.py`). **Use the exact series/label names G1 proved**, not the design's expected names. Add Tempo/TraceQL identifiers only if the guard extracts them (it does not today).
2. In the script: replace `part1()` with the allowlist check — extract identifiers/literals from each alert `expr` and each dashboard `targets[].expr` (use the same awk/grep-E/bash-3.2 style; no associative arrays, no `grep -P`), fail with `AC-8 P1 <relpath>:<line>: <identifier>` when an identifier is not in the registry. Add a registry-integrity check: every row's producer literal must exist at its producer path (`AC-8 P1-producer`). Retire Part 2 entirely (`scan_file`'s strip/grep and the `SANCTIONED`/`FOLLOWUP`/`DEFECT` handling) and relax `P3-count` to compare against the real rule/dashboard counts without an expected-zero. Keep Part 3's existence/fence checks (the removed-assets fences stay valid for the three deleted dashboards, `mute-timings.yaml` is re-created later so its fence line must be removed in the alerts step). Update the header comment to describe registry + Parts 1/3/4.
3. Keep it bash-3.2/BSD-compatible and `shfmt -i 2` clean (CI `shell-lint`). On success the guard stays silent and exits 0, as it does today; later Verification comments refer to that exit code.

**Verification**:
```bash
bash scripts/check-otel-produced-signals.sh  # exit 0 against the current tree (alert-rules.yaml has no rules yet)
shellcheck scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh && shfmt -d -i 2 scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh
test -f packages/otel/produced-signals.tsv   # fails before the step
```

---

### Step 50 — test: guard tests: registry allowlist (AC-8), producer-literal drift, Part 2 cases removed

**Status**: `pending`
**Service**: `scripts/`
**Files**:
- `scripts/check-otel-produced-signals.test.sh` — modify
- `scripts/testdata/otel-produced-signals/fr4.prefix.tsv` — delete
- `scripts/testdata/otel-produced-signals/alert-rules.prefix.yaml` — modify (kept as the AC-1 verbatim-pre-fix red fixture only if still meaningful, else delete)
- `scripts/testdata/otel-produced-signals/service-health.prefix.json` — modify (same rule)

**Reviewers**: Platform Lead — cross-service telemetry contract; produced-signal guard correctness

**Codebase Evidence**:
- `scripts/check-otel-produced-signals.test.sh:1-22` header + `fresh()`/`guard()`/`append()`/`expect_green()`/`expect_hit()` harness; cases: green-fixed-tree, AC-1-red, AC-2-red, AC-3 per-cite loop, multi-tag, sanctioned-literal, follow-up-path, fence, comment-existence, removal-prose-count

**TDD**: `red-green required`

**Covers**: `AC-8, AC-9`

**Instructions**:
1. Write the new cases first (RED against the pre-change guard): (a) green with the real restored assets (added later; for now green with the empty alert file); (b) **AC-8**: append an alert rule whose `expr` queries `rpc_client_bogus_total` to a throwaway copy of `alerts/alert-rules.yaml` → `expect_hit … "AC-8 P1 packages/otel/alerts/alert-rules.yaml:"`; (c) a rule querying a registered series passes; (d) a Loki `service_name="nosuch"` selector or an unregistered `|=` literal fails; (e) delete the producer literal from its file in the throwaway tree → `AC-8 P1-producer`; (f) a docs line mentioning Loki/Prometheus no longer trips anything (Part 2 retired — AC-9 prerequisite). Remove the cases that exercise Part 2 and the fixtures they alone consumed (`fr4.prefix.tsv`); keep `alert-rules.prefix.yaml`/`service-health.prefix.json` only as AC-8 red fixtures if the allowlist still rejects their content, otherwise delete them (leave no dead fixture).

**Verification**:
```bash
bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh
shellcheck scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh && shfmt -d -i 2 scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh
```

---

### Step 51 — service: guard Part 4 (proto-derived stream exclusion), sampler guard, CI paths filter

**Status**: `pending`
**Service**: `scripts/ + .github/workflows/ci.yml`
**Files**:
- `scripts/check-otel-produced-signals.sh` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: Platform Lead — cross-service telemetry contract; produced-signal guard correctness

**Codebase Evidence**:
- `.github/workflows/ci.yml:102-107` `otel-signals` filter lists `packages/otel/**`, `docs/**`, `.do/**`, `scripts/check-otel-produced-signals*.sh`, `scripts/testdata/otel-produced-signals/**`; job at :802-813 runs the script and `.test.sh`
- `grep -rn "returns (stream" packages/proto/*/v1/*.proto` → today's server-streaming RPCs: `ExportEvents`, `StreamAlerts`, `StreamBars`, `StreamEvents`, `StreamOrderUpdates`, `StreamPortfolioUpdates`, `StreamQuotes`, `WatchConfig` (design § Guard Part 4; re-derive at runtime, do not hard-code)
- Design: stream calls end on every deploy and would fire restored error/p99 alerts; recorders keep recording; queries exclude via `rpc_method!~"<sorted names joined by |>"`

**TDD**: `red-green required`

**Covers**: `AC-17`

**Instructions**:
1. Part 4: derive the stream set at runtime by scanning `packages/proto/*/v1/*.proto` for `rpc <Name> (<Req>) returns (stream <Resp>);` — tolerate `rpc Name (` spacing, skip `//` comment lines, **fail** on any `rpc` line lacking `returns`, and **fail** if a stream RPC name equals a unary RPC name in any proto (the matcher is name-based). Build the sorted `rpc_method!~"A|B|…"` matcher; require every `rpc_server_duration_milliseconds_(count|bucket|sum){…}` selector in `packages/otel/alerts/*.yaml` and in dashboard `targets[].expr` to contain exactly that matcher (`AC-17 P4 <file>:<line>`). Only a dashboard `templating` `label_values(...)` query is exempt; any other bare selector fails (R3 B2). Use the G1-proven label spelling for `rpc_method`.
2. Sampler guard: fail (`AC-17 P4-sampler`) if `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` or a gRPC excluded-services env (`OTEL_PYTHON_GRPC_EXCLUDED_SERVICES`, `OTEL_PYTHON_GRPC_EXCLUDE_SERVICES`) appears in `.do/*` or `docker-compose.yml` (the span-derived Python/Node metrics depend on spans being sampled).
3. CI: add `'packages/proto/**/*.proto'` to the `otel-signals` filter (:102-107) so a new stream RPC re-runs the guard.

**Verification**:
```bash
bash scripts/check-otel-produced-signals.sh
grep -n "packages/proto" .github/workflows/ci.yml | head -5
shellcheck scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh && shfmt -d -i 2 scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh
```

---

### Step 52 — test: guard tests: Part 4 stream matcher and sampler guard (AC-17)

**Status**: `pending`
**Service**: `scripts/`
**Files**:
- `scripts/check-otel-produced-signals.test.sh` — modify

**Reviewers**: Platform Lead — cross-service telemetry contract; produced-signal guard correctness

**Codebase Evidence**:
- Harness at `scripts/check-otel-produced-signals.test.sh` (`fresh` copies `packages/otel`, `docs`, `.do`; Part 4 needs `packages/proto` and `docker-compose.yml` copied too — extend `fresh()`)

**TDD**: `red-green required`

**Covers**: `AC-17`

**Instructions**:
1. Cases: (1) a restored-style rule whose `rpc_server_duration_milliseconds_sum` selector omits the matcher → `AC-17 P4`; (2) `_count`, `_bucket`, `_sum` each checked; (3) a dashboard `label_values(rpc_server_duration_milliseconds_count, service_name)` templating query passes but the same selector in `targets[].expr` fails; (4) append `rpc StreamFoo(Req) returns (stream Resp);` to a copied proto without updating the matcher → non-zero; (5) an `rpc Foo(Req)` line with no `returns` fails; (6) a stream RPC named like a unary RPC fails; (7) a commented-out stream rpc is ignored; (8) `OTEL_TRACES_SAMPLER=…` appended to a copied `.do/app.yaml` or `docker-compose.yml` fails.

**Verification**:
```bash
bash scripts/check-otel-produced-signals.test.sh
shellcheck scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh && shfmt -d -i 2 scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh
```

---

### Step 53 — service: alerts: restore error-rate and p99 rules, re-derive the scoring-stall rule, restore the mute timing

**Status**: `pending`
**Service**: `packages/otel (non-service)`
**Files**:
- `packages/otel/alerts/alert-rules.yaml` — modify
- `packages/otel/alerts/mute-timings.yaml` — create
- `packages/otel/alerts/README.md` — modify

**Reviewers**: Platform Lead — cross-service telemetry contract; produced-signal guard correctness

**Codebase Evidence**:
- Landed `packages/otel/alerts/alert-rules.yaml`: only `deleteRules` for `xstk-error-rate-high`, `xstk-p99-latency-high`, `xstk-analysis-no-scoring` and `deleteMuteTimes` `outside-us-market-hours`; `packages/otel/alerts/README.md` has the fenced `<!-- otel-guard:removed-assets -->` list (3 rules + mute timing + `mute-timings.yaml`) and the 'Metrics and logs are not exported (feature 226).' sentence
- Pre-250 definitions recoverable verbatim: `git show 3968bcea^:packages/otel/alerts/alert-rules.yaml` (rules at :26 error-rate `for: 5m`, :71 p99 `for: 3m`, :116 no-scoring `for: 0m` with label `mute_outside_market_hours: "true"`, datasource placeholders `${DS_PROMETHEUS_UID}`/`${DS_LOKI_UID}`) and `git show 3968bcea^:packages/otel/alerts/mute-timings.yaml` (`muteTimes` name `outside-us-market-hours`: weekdays 00:00-09:30 and 16:00-24:00 `America/New_York` plus Sat/Sun)
- Design § Alert rules: error-rate and p99 restored with the stream matcher and `noDataState: OK`; `xstk-analysis-no-scoring` keeps its uid but now means 'live-loop heartbeat absent': `sum(count_over_time({service_name="analysis"} |= "live_loop: cycle complete" [30m])) < 1`, `noDataState: Alerting`, mute timing attached; guard tests assert `noDataState` on every rule; record the meaning change in `alerts/README.md` and the fence

**TDD**: `red-green required`

**Covers**: `AC-8, AC-14`

**Instructions**:
1. Rewrite `alert-rules.yaml` as `apiVersion: 1` `groups:` using the pre-250 rule bodies as the starting point, with: `xstk-error-rate-high` and `xstk-p99-latency-high` queries gaining the guard-pinned `rpc_method!~"…"` matcher on **every** `rpc_server_duration_milliseconds_*` selector (copy the exact sorted matcher the guard derives) and `noDataState: OK`; `xstk-analysis-no-scoring` as above (uid unchanged, title updated to state the heartbeat meaning, `noDataState: Alerting`, label `mute_outside_market_hours: "true"`). Keep datasource placeholder style consistent with how the README documents substitution (restore the 'Substitutions before provisioning' section the pre-250 README had: `git show 3968bcea^:packages/otel/alerts/README.md`). Use the series/label names G1 proved.
2. Re-create `mute-timings.yaml` from the pre-250 file. In `README.md`: remove the 'provisions no rules' text and the 'Metrics and logs are not exported' sentence, remove the `mute-timings.yaml` line and the three rule lines and the mute-timing line from the removed-assets fence (the fence keeps only assets still absent — if none remain, delete the fence block), document the stall rule's meaning change (heartbeat, not RPC activity) and the stream exclusion, and the restored `Applying` instructions.

**Verification**:
```bash
bash scripts/check-otel-produced-signals.sh  # exit 0: every identifier registered, every selector carries the matcher
test -f packages/otel/alerts/mute-timings.yaml && [ "$(grep -c -E '^[[:space:]]+- uid:' packages/otel/alerts/alert-rules.yaml)" -ge 3 ]   # fails before the step (rules were deleted by feature 250)
```

---

### Step 54 — test: guard tests: restored rules pass; noDataState on every rule; mute timing referenced (AC-8, AC-14)

**Status**: `pending`
**Service**: `scripts/`
**Files**:
- `scripts/check-otel-produced-signals.test.sh` — modify
- `scripts/check-otel-produced-signals.sh` — modify

**Reviewers**: Platform Lead — cross-service telemetry contract; produced-signal guard correctness

**Codebase Evidence**:
- Guard has no `noDataState` or mute-timing-reference check yet; AC-14 requires 'the mute timing exists and is referenced by the re-derived analysis scoring-stall rule'

**TDD**: `red-green required`

**Covers**: `AC-8, AC-14`

**Instructions**:
1. Add guard checks + tests: every rule in `alerts/*.yaml` must declare `noDataState` (`AC-8 P5`), error-rate/p99 must be `OK` and the stall rule `Alerting`; `outside-us-market-hours` must exist in `mute-timings.yaml` and the stall rule must carry the matching `mute_outside_market_hours` label. RED cases: strip `noDataState` from a rule; rename the mute timing; drop the label. Green: the real tree passes.

**Verification**:
```bash
bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh
shellcheck scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh && shfmt -d -i 2 scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh
```

---

### Step 55 — service: dashboards: per-panel restore on produced series; keep Tempo panels; update README

**Status**: `pending`
**Service**: `packages/otel (non-service)`
**Files**:
- `packages/otel/dashboards/service-health.json` — modify
- `packages/otel/dashboards/signal-pipeline-throughput.json` — create (only if panels survive the per-panel decision)
- `packages/otel/dashboards/infrastructure.json` — create (same rule)
- `packages/otel/dashboards/trading-service.json` — create (same rule)
- `packages/otel/dashboards/README.md` — modify

**Reviewers**: Platform Lead — cross-service telemetry contract; produced-signal guard correctness

**Codebase Evidence**:
- Landed `service-health.json` (uid `xstk-service-health`): three Tempo panels (`{ kind = server && status = error }`, slow server spans excluding `Watch|Stream|Export`, analysis RunBacktest/ScoreStrategy spans), `templating` only `DS_TEMPO`; README fences removed assets `xstk-signal-pipeline`, `xstk-infrastructure`, `xstk-trading-service` and files `signal-pipeline-throughput.json`, `infrastructure.json`, `trading-service.json`
- Pre-250 panel queries recoverable with `git show 3968bcea^:packages/otel/dashboards/<file>.json`: service-health — request rate, error rate, P99 latency over `rpc_server_duration_milliseconds_*{service_name=~"$service"}`, `$service` = `label_values(rpc_server_duration_milliseconds_count, service_name)`, and a Loki panel `{platform="xstockstrat", service_name=~"$service"} | json | level=~"error|ERROR"`; signal-pipeline — Loki `|= "signal.ingested"`, analysis scoring P99 by `rpc_method`, agent `scheduler`/`run.completed` Loki counts; infrastructure — status codes `4|8|14`, DB connection-error Loki regex, services-reporting count, OTLP export failures in Loki; trading-service — `PlaceOrder` rate/latency, `order.filled` Loki count, trading error logs
- Design § Dashboards: keep `rpc_server_duration_*` and `service_name` panels (adding the stream matcher); rewrite `{platform="xstockstrat"}` and `| json | level=~` per G1 query 5; **drop** `infrastructure.json`'s OTLP-export-failure panel (FR-4 makes those stdout-only); 250's Tempo panels stay as drill-downs

**TDD**: `red-green required`

**Covers**: `AC-14`

**Instructions**:
1. Per pre-250 panel decide keep / rewrite / drop and record the decision table in `context.md`. Mandatory: service-health regains the `DS_PROMETHEUS`/`DS_LOKI` inputs and the `$service` variable querying `rpc_server_duration_milliseconds_count` (AC-14); every `rpc_server_duration_milliseconds_*` panel selector carries the guard-pinned stream matcher; log panels use selectors/literals G1 proved (e.g. `detected_level` vs `severity_text`) and only `service_name` values / `|=` literals present in the registry — panels whose literals nothing produces (`signal.ingested`, `scheduler`/`run.completed`, `order.filled`, DB-connection regex) are dropped unless the registry gains a real producer in this feature (it does not). If a restored dashboard file ends up with zero surviving panels, do not create it; leave its fence line in the README.
2. README: restate the datasource inputs (Tempo + Prometheus + Loki), the Query assumptions, remove the 'Metrics and logs are not exported' sentence, and keep the fence only for assets still absent.

**Verification**:
```bash
bash scripts/check-otel-produced-signals.sh  # exit 0 (the guard is silent on success)
python3 -c "import json,glob; [json.load(open(f)) for f in glob.glob('packages/otel/dashboards/*.json')]; print('json ok')"
grep -q 'rpc_server_duration_milliseconds' packages/otel/dashboards/service-health.json   # fails before the step (the dashboard is Tempo-only today)
```

---

### Step 56 — test: guard tests: restored dashboards reference only produced series; $service variable (AC-14)

**Status**: `pending`
**Service**: `scripts/`
**Files**:
- `scripts/check-otel-produced-signals.test.sh` — modify

**Reviewers**: Platform Lead — cross-service telemetry contract; produced-signal guard correctness

**Codebase Evidence**:
- Guard walks `targets[].expr` and `templating` of every `packages/otel/dashboards/*.json` (Part 1 allowlist + Part 4)

**TDD**: `red-green required`

**Covers**: `AC-14`

**Instructions**:
1. Cases: service-health `$service` variable query must contain `rpc_server_duration_milliseconds_count` (assert via grep on the real tree); a panel expr with an unregistered series or Loki literal fails; a panel selector without the stream matcher fails; the real tree reports 0 failing exprs.

**Verification**:
```bash
bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh
shellcheck scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh && shfmt -d -i 2 scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh
```

---

### Step 57 — docs: FR-7: docs state the three exported signals (observability, grafana-cloud, product-features, collector, packages/otel)

**Status**: `pending`
**Service**: `docs/, packages/otel/`
**Files**:
- `docs/patterns/observability.md` — modify
- `docs/setup/grafana-cloud.md` — modify
- `docs/launch-pdfs/product-features.md` — modify
- `packages/otel/otel-collector-config.yaml` — modify (header comment only)
- `packages/otel/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/observability.md:5` and `docs/setup/grafana-cloud.md:5` and `docs/launch-pdfs/product-features.md:194` carry the sentence 'Metrics and logs are not exported (feature 226).'; `docs/setup/grafana-cloud.md:237` cites `274-otel-metrics-logs-export` ('until it lands, nothing pages'); `observability.md:11` describes env-only **trace** exporters only; `observability.md:28-31` per-language module table; `packages/otel/otel-collector-config.yaml` header references the follow-up (guard literal); collector already has `metrics:` and `logs:` pipelines on OTLP `:4318` → `otlphttp/grafana` (`otel-collector-config.yaml:79-87`)

**TDD**: N/A (non-code-bearing)

**Covers**: `AC-9`

**Instructions**:
1. Replace the 'not exported' sentences with the three signals and endpoints: traces `/v1/traces`, metrics `/v1/metrics`, logs `/v1/logs`, all env-only (no endpoint option), each runtime's `OTEL_ENABLED` gate, resource attributes, the produced series/stream names **as G1 proved them** (`rpc_server_duration_milliseconds_{count,bucket,sum}` with `service_name`, `rpc_grpc_status_code`; `mcp_tool_duration_milliseconds_*`; `http_server_duration_milliseconds_*`; Loki `{service_name="analysis"}` etc.), the optional SDK env vars (`OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_BLRP_*`), recursion-guard/stdout-only failure behaviour, the stream-exclusion rule, and the cost figures from G1 query 7. Remove the `grafana-cloud.md:237` 'until it lands' text. Update the per-language module table (Go also `logbridge.go`/`shutdown.go`; Python recorder/interceptor; Node recorder + winston transport; UI `bffMetrics.ts`/`serverLog.ts`). `packages/otel/CLAUDE.md` and the collector header comment: state the three signals and drop the follow-up pointer.

**Verification**:
```bash
grep -rn 'Metrics and logs are not exported' docs packages/otel --exclude-dir=roadmap --exclude-dir=reports  # expect no output (roadmap/reports keep the historical text)
grep -n '/v1/metrics' docs/patterns/observability.md docs/setup/grafana-cloud.md
bash scripts/check-otel-produced-signals.sh
```

---

### Step 58 — docs: FR-7: constitution rows (PLAT-3, OTEL-1/OTEL-2) and the findings rows marked RESOLVED (feature 274)

**Status**: `pending`
**Service**: `docs/, packages/otel/docs/`
**Files**:
- `docs/context-constitution.md` — modify
- `docs/context-constitution-findings.md` — modify
- `packages/otel/docs/context-constitution.md` — modify
- `packages/otel/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/context-constitution.md:38` PLAT-3 says 'Every runtime exports **traces** over OTLP/HTTP…' with exporter cites (`otel.go:24`, `telemetry.py:44`, `telemetry.ts:49`/`:29`); `docs/context-constitution-findings.md:18` row 'metrics and logs' is **NARROWED (feature 250)**; `packages/otel/docs/context-constitution.md:16-17` OTEL-1 re-grounded on Tempo, OTEL-2 **RETIRED (feature 250)**; `packages/otel/docs/context-constitution-findings.md` open-questions row ~NARROWED and Resolved row citing the defect report

**TDD**: N/A (non-code-bearing)

**Covers**: `AC-9`

**Instructions**:
1. PLAT-3: name the `/v1/metrics` and `/v1/logs` exporters alongside traces and re-stamp the exporter cite lines (the new metric/log exporter constructions in each telemetry module). OTEL-1: add the metric/Loki forms (`service_name` is the short name) while keeping the Tempo form; restore OTEL-2 (un-retire) as the metric-name/Loki-stream contract naming `rpc_server_duration_milliseconds` and the `service_name` Loki stream as **produced**, with the accepted asymmetries from design § Open Risks (unsampled inbound traceparent, Node cancelled streams, Go `os.Exit(1)` paths, UI best-effort flush). Mark the root findings row 'metrics and logs are never sent' and the otel counterpart **RESOLVED (feature 274)** (keep the defect-report link). The guard's Part 2 no longer scans these files, so wording is free.

**Verification**:
```bash
grep -n 'RESOLVED (feature 274)' docs/context-constitution-findings.md packages/otel/docs/context-constitution-findings.md
grep -n '/v1/metrics\|/v1/logs' docs/context-constitution.md
bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh
```

---

### Step 59 — docs: PR-B teardown: context-constitution refresh scoped to touched files; final guard run

**Status**: `pending`
**Service**: `docs/, packages/otel/`
**Files**:
- `docs/roadmap/features/274-otel-metrics-logs-export/context.md` — modify (append)

**Reviewers**: none

**Codebase Evidence**:
- Root `CLAUDE.md` § Teardown: run `/context-forge:context-constitution refresh` scoped to touched files as the last step before pushing; if the plugin is unavailable record both the unavailability and the manual reconciliation in the PR body (fails.md:670)

**TDD**: N/A (non-code-bearing)

**Covers**: —

**Instructions**:
1. Run the refresh over `docs/patterns/observability.md`, `docs/setup/grafana-cloud.md`, `docs/context-constitution*.md`, `packages/otel/CLAUDE.md`, `packages/otel/docs/*`, `packages/otel/alerts/README.md`, `packages/otel/dashboards/README.md`; fix grounded drift. Record the result in `context.md` and the PR-B body. Run the guard and its test last; update `merge-order.md` only if the PR order changed.

**Verification**:
```bash
bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh
ls .claude/skills | grep -i context-forge || echo 'plugin unavailable: record manual reconciliation'
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation 1 — Branch layout (session branch; the spec PR becomes PR-A)
- **Spec said**: work on `feature/otel-metrics-logs-export`, PR-A as its own squash PR into `main-dev`.
- **Actual**: the harness assigns `ccr-4f43fb65-lagupv`, pushes elsewhere are not permitted, and the open spec PR #1379 already sits on it. Steps 1-47 are committed here, one commit per step, and #1379 is retitled as PR-A when step 47 lands. PR-B (steps 49-59) needs a fresh branch from `main-dev` after the operator merges PR-A and passes G1.
- **Disposition**: sequential mode, operator-approved (run request 2026-10-31); F-03 not engaged (no step PR targets `main-dev`).

### Deviation 2 — Lint tooling and Node version
- shellcheck/shfmt are not installed: `uvx` PyPI wheels are used (as in feature 250); golangci-lint is installed from source at CI's v2.14.0; Node here is v22.22.0 while the repo pins Node 24 (root CLAUDE.md): Node/UI steps run on 22 and CI re-runs them on 24.
- **Disposition**: CI-equivalent fallback.

### Deviation 3 — Step 5 edited a Step 4 source file (found by the paired tests)
- **Spec said**: Step 5's Files are the tests, `go.mod` and `go.sum`; it "does not edit `otel.go`".
- **Actual**: the new failure-visibility tests showed that `ForceFlush` returns export errors instead of reporting them through `otel.Handle` (only the background and shutdown paths do), so `StopServer`'s `_ = forceFlush(ctx)` silently dropped a failed final flush, contradicting FR-4. `internal/telemetry/shutdown.go` now routes that error through `otel.Handle` (stdout-only once `WrapLogHandler` is installed), covered by `TestStopServerReportsFailedFlushThroughOTelErrorHandler`.
- **Disposition**: gap-protocol default (fix now, expand scope): one line in the paired service step's own file, found inside the red-green cycle of the pair. Steps 9 and 13 clone `shutdown.go` from this corrected version.

### Deviation 4 — Step 6 edited the Step 5 test file (sloglint applies to tests too)
- **Spec said**: Step 6 Files are `.golangci.yml` plus the conditional source files; no test file.
- **Actual**: enabling `sloglint` also flagged three `slog.NewTextHandler(io.Discard, nil)` / `slog.NewJSONHandler(io.Discard, nil)` uses in Step 5's new `internal/telemetry/otel_test.go` ("use slog.DiscardHandler"). Left alone they would fail CI's golangci-lint on the same PR.
- **Disposition**: gap-protocol default (fix now): the three uses were replaced by `slog.DiscardHandler`; behaviour is identical. Steps 10 and 14 apply the same fix to portfolio's and marketdata's copies of the test file.

### Deviation 5 — A flaky status-code test fixed in two earlier steps' files (found by the portfolio retrofit gate)
- **Spec said**: Step 11 fixes only test code that fails because it matched a removed call shape.
- **Actual**: `TestServerDurationRecordsStatusCode` (Step 5 for trading, Step 9 for portfolio) failed once in a full parallel `go test ./... -race` run of portfolio and then passed on 300 loaded repeats and 3 further full runs. Cause: grpc-go delivers the server stats `End` event from a deferred call after the reply and trailers are written, so a client can see the response before `rpc.server.duration` is recorded, and the test collected once, immediately. The test now polls until the metric appears. Applied to both existing copies; marketdata's copy is cloned from the fixed version.
- **Disposition**: gap-protocol default (fix now): test-only change, no behaviour change, committed with Step 11 (the retrofit gate).

### Deviation 6 — An analysis AC-5 guard test matched the new server-interceptor argument (step 20)
- **Spec said**: Step 20 changes only `app/telemetry.py`, `app/main.py`, `pyproject.toml`, `uv.lock`.
- **Actual**: `tests/test_owner_header_guard.py::test_main_wires_no_channel_interceptor` (`@AC-5`, nothing below the stub adds an `x-internal-caller` grant) asserted `"interceptors=" not in inspect.getsource(app_main)`. That substring also matches the new `grpc.aio.server(interceptors=server_interceptors())`, a *server* interceptor that cannot add an outbound grant. The guard now strips that one exact call before the check, so any channel/client `interceptors=` (the thing AC-5 forbids) still fails it.
- **Disposition**: gap-protocol default (fix now): test-only narrowing committed with Step 20; the guard stays as strict for its purpose.

