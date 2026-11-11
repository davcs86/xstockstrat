# Implementation Spec: homelab-otel-host-provider

**Status**: `done`
**Created**: 2026-11-11
**Feature**: `docs/roadmap/features/332-homelab-otel-host-provider/feature.md`
**Total Steps**: 17
**Feature Branch**: `feature/homelab-otel-host-provider` (this feature develops on harness branch `ccr-6307b904-swdg1c`; the integration PR targets `main-dev`, see `feature.md` **Development Branch**)

---

## Execution Summary

The work runs in four bands. First, the per-runtime resource stamp (Steps 1–8): Go, Python, Node and UI each get an inline `HOST_PROVIDER` normaliser in their single resource builder, plus `service.instance.id = <provider>-<service.name>` for Go, Node and UI. Each `service` step is paired with a RED-first `test` step that drives the real exporter into the existing in-process OTLP receiver. Second, the homelab delivery pipeline (Steps 9–12): first the SOPS resolver and workflow (so `resolve --target homelab` emits the OTLP keys with the `Authorization=` prefix), then the compose literals, `${VAR:?}` requirements and the render oracle. These come second because the compose requirement fails closed without the resolver change. Third, the DO app specs (Steps 13–14). Fourth, the query guard together with `observability.md` (Steps 15–16), then the remaining docs (Step 17). Step 15's registry row depends on Step 1's Go literal.

Consumer surface: **None — internal/platform-only** (product-spec § Consumer Surface(s), C-14). The operator consumes the capability in Grafana Cloud queries. No `xstockstrat-ui` segment or Agent MCP tool step is required. Env/provider-scoped alerts and dashboard selectors are deferred to the named follow-up feature `otel-env-provider-scoped-alerts` (see Step Dependencies).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| AC-1 | Steps 2, 4, 6, 8 |
| AC-2 | Step 2 |
| AC-3 | Step 4 |
| AC-4 | Step 6 |
| AC-5 | Step 6 |
| AC-6 | Step 12 |
| AC-7 | Step 12 |
| AC-8 | Step 10 |
| AC-9 | Step 10 |
| AC-10 | Step 16 |
| AC-11 | Step 16 |
| AC-12 | Step 16 |
| AC-13 | Step 6 |
| AC-14 | Step 12 |
| AC-15 | Step 14 |
| AC-16 | Step 12 |
| AC-17 | Step 10 |
| AC-18 | Step 12 |
| AC-19 | Steps 2, 6, 8 |
| AC-20 | Step 12 |
| AC-21 | Step 4 |
| AC-22 | Step 16 |
| AC-23 | Step 16 |

## Step Dependencies

- **RED procedure (P-06, applies to every paired test step: 2, 4, 6, 8, 10, 12, 14, 16).** Write the test step's edits first, with the paired service/config step's files still at their pre-feature content (for an executor that has already applied the service step: `git stash push -- <the service step's **Files**>`). Run the test step's **Verification**, capture the failing output (it must fail on the missing behaviour named in that step, not on a compile or syntax error), then apply/restore the service step and re-run green. `/sdd-execute` logs both runs (RED excerpt + GREEN result) in `context.md` for the pair.
- Steps 2, 4, 6, 8 [test] cover Steps 1, 3, 5, 7 [service] respectively. No `**Lands with**` is needed: the tests reach the new behaviour only through the existing builders and exporters (`newResource`, `_build_resource`/`init_telemetry`, `buildResource`/`initTelemetry`, `register`), so each RED is a behaviour failure, not a compile failure (§C).
- Steps 9 and 10 do not form an atomic unit. Step 9 carries every file the `KEYS` change turns red (`deploy-homelab.yml` LEGACY lines for `check_legacy … homelab`, `sops-secrets.test.sh:1067`), so it passes the existing suite on its own. This satisfies design S5's "one `Lands with`" inside a single step.
- Steps 11 and 12 land together (§C trigger "deletes/changes a resource others depend on"). The `${VAR:?}` OTLP requirement in `deploy/homelab/compose.yml` turns `homelab-render.test.sh` cases 1–3 and `sops-secrets.test.sh` case 8 red until their fixtures carry the two OTLP lines.
- Step 11 requires Step 9: without the HOMELAB target on the OTLP `KEYS` rows, the real pipeline renders no OTLP lines, and every homelab render fails at `${OTEL_EXPORTER_OTLP_ENDPOINT:?}`.
- Step 15 requires Step 1: the new `packages/otel/produced-signals.tsv` row `metric⇥target_info⇥services/xstockstrat-trading/internal/telemetry/otel.go⇥host.provider` needs the literal `host.provider` in that file, or the guard reports `AC-8 P1-producer`.
- Step 16 requires Step 15. Step 17 requires Step 15 (`observability.md` is the doc the others point to).
- Overlap and merge order: 307 (`ui-env-themed-bundles`) is already on `main-dev` (`67b857a`, PR #1507; the `ui-theme` step precedes `setup-sops` in `deploy-homelab.yml`), so the `merge-order.md:269` row is satisfied and every anchor below is post-307. The overlap with 329 (`fix-telemetry-startup-log`, telemetry modules) and 331 (`fix-agent-mcp-transport-fallthrough`, `.do/app*.yaml`) is non-blocking (`merge-order.md:367`). Whichever merges second rebases and re-greps these anchors.
- Integration (the `/sdd-execute` integration PR, C-16): promote AC-1..AC-23 into the durable suites. Apply the three signed-off CHANGEs with a "Changed by @feature-332" note. (1) `@AC-13 @FR-9 @feature-279` "OTel is off on the homelab" (`docs/sdd/business-rules/platform.feature:1147`; homelab `OTEL_ENABLED` becomes "true", "no otel-collector service" stays). (2) The `development` half of `@AC-22 @FR-6 @feature-279` (`:1193`). (3) The `@AC-9 @FR-3 @feature-302` Given (`:1526`). Also update the stale pending copy `docs/roadmap/features/279-homelab-compose-deploy/acceptance.feature:95-98`. The EXTEND rules listed in `design.md` § Business Rules Touched are folded in at the same time.
- C-14 deferral: env/provider-scoped alert matchers and dashboard selectors belong to the named follow-up feature `otel-env-provider-scoped-alerts`, which is not yet storied. Create it via `/sdd-story` before `/sdd-execute` (`feature.md` Next Action). Sequence it after 297 (`grafana-dashboards-ci-deploy`).

---

### Step 1 — service: Go resource stamps `host.provider` and a deterministic `service.instance.id`

**Status**: `done`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel.go` — modify
- `services/xstockstrat-portfolio/internal/telemetry/otel.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/otel.go` — modify

**Deployment files**: none in this step. `HOST_PROVIDER` reaches containers through Step 11 (`deploy/homelab/compose.yml` literal `homelab`) and Step 13 (`.do/app.dev.yaml`, `.do/app.yaml` → `digitalocean`); `docker-compose.yml` intentionally sets none (FR-8, unset → `unknown`). `TRADING_MODE` and every other env var are untouched, so compose↔DO parity (B2b) holds per the FR-8 table.

**Reviewers**: `xstockstrat-trading` — order execution correctness, paper-only dev invariant (telemetry init stays non-fatal); `xstockstrat-portfolio` — position snapshot consistency (telemetry init stays non-fatal); `xstockstrat-marketdata` — OHLCV ingestion integrity (telemetry init stays non-fatal)

**Codebase Evidence**:
- `newResource` at `otel.go:124-132` (all three copies identical apart from the `serviceName()` default, `:119`): `resource.New(ctx, resource.WithAttributes(semconv.ServiceName(serviceName()), semconv.DeploymentEnvironment(os.Getenv("APPLICATION_ENV")), attribute.String("platform", "xstockstrat")))`.
- `serviceName()` at `:115-120`. The import `semconv "go.opentelemetry.io/otel/semconv/v1.25.0"` is at `:24` and `"go.opentelemetry.io/otel/attribute"` at `:13`. `os` is already imported (`:7`).
- One resource feeds all three providers (recon Codebase Map: `res := newResource(ctx)` `:58` → trace `:65`, metric `:73`, log `:81`), so one edit covers traces, metrics and logs.
- `grep -rn "HOST_PROVIDER\|host.provider" services/` returns nothing (recon § Not found).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In each `otel.go`, add an unexported helper after `serviceName()` (`:120`), with a ≤2-line comment stating the constraint (exact lowercase match, never fatal):
   ```go
   func hostProvider() string {
   	switch p := os.Getenv("HOST_PROVIDER"); p {
   	case "digitalocean", "homelab":
   		return p
   	}
   	return "unknown"
   }
   ```
2. In `newResource` (`:124-132`), compute `p := hostProvider()`. Add `semconv.ServiceInstanceID(p + "-" + serviceName())` and `attribute.String("host.provider", p)` to the existing `resource.WithAttributes(...)` list. Keep the three existing attributes and add no `WithFromEnv`/`WithHost`/`WithProcess` option. The literal `"host.provider"` must appear verbatim, because Step 15's registry row greps for it. If `semconv.ServiceInstanceID` does not exist in the pinned `v1.25.0` (unverified on this host; there is no module cache), use `attribute.String("service.instance.id", …)` and record the choice in the Deviation Log. Step 2's RED/GREEN build reveals which one applies.
3. Leave `serverMetricViews`, the RPC metric names and the init error paths unchanged (PRESERVE `@AC-56 @feature-294`, `@AC-2 @FR-2 @feature-274`).

**Verification**:
```bash
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off go build ./... && GOWORK=off go vet ./internal/telemetry/) || exit 1; done
grep -n '"host.provider"' services/xstockstrat-{trading,portfolio,marketdata}/internal/telemetry/otel.go   # 3 hits
```

---

### Step 2 — test: Go exported resources carry `host.provider` and the instance id on all three signals

**Status**: `done`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel_test.go` — modify
- `services/xstockstrat-portfolio/internal/telemetry/otel_test.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/otel_test.go` — modify

**Reviewers**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` service owners — telemetry init stays non-fatal

**Codebase Evidence**:
- The test files are line-identical in structure: `TestNewResourceOmitsTradingMode` `:45`; helpers `newOTLPReceiver` `:78`, `find` `:94`, `startTelemetry` `:114` (sets `OTEL_ENABLED`, `APPLICATION_ENV=staging`, endpoint, headers; calls `Init`), `flush` `:132`; `TestExportedMetricsCarryResource` `:205-234` decodes `colmetrics.ExportMetricsServiceRequest` from `rc.find("/otlp/v1/metrics")`; `TestLogRecordCarriesTraceContext` `:347` decodes `collogs.ExportLogsServiceRequest` (`:362`); log emission via `slog.New(WrapLogHandler(slog.DiscardHandler)).Info(…)` (`:186`).
- `go.opentelemetry.io/proto/otlp v1.11.0` is already a direct requirement (trading/portfolio `go.mod:22`, marketdata `:23`), so `coltrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"` adds no new module.
- Telemetry is excluded from the coverage measurement (`docs/patterns/ci-overview.md:19,82`).

**TDD**: `red-green required`

**Covers**: AC-1 (Go rows), AC-2, AC-19 (`trading` row)

**Instructions**:
1. Add `TestExportedSignalsCarryHostProvider` (AC-1, AC-19). Call `t.Setenv("HOST_PROVIDER", "homelab")`, then `startTelemetry`. Emit one span (`otel.Tracer("t").Start(…)`/`End()`), one counter add and one `WrapLogHandler` log record, then `flush`. Decode the first request on each of `/otlp/v1/traces` (`coltrace.ExportTraceServiceRequest`), `/otlp/v1/metrics` and `/otlp/v1/logs`. For each of the three resources, assert `host.provider="homelab"`, `service.name=<default>`, `deployment.environment="staging"`, `platform="xstockstrat"`, `service.instance.id="homelab-<default>"` (trading: `homelab-trading`, AC-19) and no `trading_mode`. Put the attribute-map extraction in one local helper inside this file. It has one consumer, so C-13 lets it stay inline.
2. Add `TestExportedSpanCarriesDigitalOcean` (AC-2): `HOST_PROVIDER=digitalocean`, export one span, assert the trace resource has `host.provider="digitalocean"` and `service.instance.id="digitalocean-<default>"`.
3. Extend `TestNewResourceOmitsTradingMode` with a table over `HOST_PROVIDER` ∈ {unset, `""`, `"aws"`, `"Homelab"`, `"homelab"`, `"digitalocean"`}, expecting {`unknown`, `unknown`, `unknown`, `unknown`, `homelab`, `digitalocean`}. Use `os.Unsetenv` after `t.Setenv("HOST_PROVIDER", "")` for the unset row. Keep the existing `trading_mode` absence assertion.
4. RED per the Step Dependencies procedure: with Step 1's `otel.go` edits absent, all three tests fail on the missing attribute, not on a compile error.

**Verification**:
```bash
for s in trading portfolio marketdata; do
  (cd services/xstockstrat-$s && GOWORK=off go test ./internal/telemetry/ -race -count=1 -run 'HostProvider|DigitalOcean|OmitsTradingMode' -v \
   && COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
   && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
   && go tool cover -func=coverage.out | grep "^total:" \
   && GOWORK=off golangci-lint run --modules-download-mode=mod \
   && git diff --exit-code go.mod go.sum) || exit 1
done
```
The new logic is in an excluded package (`telemetry/`), so no coverage threshold applies to it. The total must stay ≥ 40%. `git diff --exit-code go.mod go.sum` catches the `-mod=mod` rewrite trap (`docs/roadmap/ledger/fails.md` 2026-11-10 signal-map-instrumentation).

---

### Step 3 — service: Python resource stamps `host.provider`

**Status**: `done`
**Service**: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-agent`
**Files**:
- `services/xstockstrat-indicators/app/telemetry.py` — modify
- `services/xstockstrat-ingest/app/telemetry.py` — modify
- `services/xstockstrat-analysis/app/telemetry.py` — modify
- `services/xstockstrat-agent/app/telemetry.py` — modify

**Deployment files**: none in this step. `HOST_PROVIDER` reaches containers through Step 11 (`deploy/homelab/compose.yml` literal `homelab`) and Step 13 (`.do/app.dev.yaml`, `.do/app.yaml` → `digitalocean`); `docker-compose.yml` intentionally sets none (FR-8, unset → `unknown`). `TRADING_MODE` and every other env var are untouched, so compose↔DO parity (B2b) holds per the FR-8 table.

**Reviewers**: `xstockstrat-indicators` — no side-effects from formula execution (telemetry init stays non-fatal); `xstockstrat-ingest` — idempotent ingestion (telemetry init stays non-fatal); `xstockstrat-analysis` — backtest reproducibility (telemetry init stays non-fatal); `xstockstrat-agent` — MCP tool contract stability (no tool change)

**Codebase Evidence**:
- `_build_resource()` sits at indicators `:24-35`, ingest `:25-36`, analysis `:25-36` and agent `:17-28`. Each is `Resource.create({"service.name": os.getenv("SERVICE_NAME", "<svc>"), "deployment.environment": os.getenv("APPLICATION_ENV", "development"), "platform": "xstockstrat"})` with a deferred `from opentelemetry.sdk.resources import Resource`.
- `import os` is present in all four (indicators/ingest/analysis `:10`, agent `:12`). One resource feeds all three providers (recon: indicators `:179,185,190,196`; ingest `:180,186,191,197`; analysis `:183,189,194,200`; agent `:57,59,63,70`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In each `telemetry.py`, add a module-level `_host_provider()` above `_build_resource()`: `p = os.getenv("HOST_PROVIDER", ""); return p if p in ("digitalocean", "homelab") else "unknown"`. Keep the comment to ≤2 lines, stating the constraint (exact lowercase, never fatal).
2. Add `"host.provider": _host_provider()` to the `Resource.create({...})` dict. Do **not** add `service.instance.id`, because Python keeps its SDK-generated id (D-7, AC-21). Do not touch the `deployment.environment` default.
3. Make no dependency change, so `uv.lock` is untouched.

**Verification**:
```bash
for s in indicators ingest analysis agent; do (cd services/xstockstrat-$s && ruff check . && ruff format --check .) || exit 1; done
grep -n '"host.provider"' services/xstockstrat-{indicators,ingest,analysis,agent}/app/telemetry.py   # 4 hits
```

---

### Step 4 — test: Python exported resources carry `host.provider`; SDK instance id preserved

**Status**: `done`
**Service**: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-agent`
**Files**:
- `services/xstockstrat-indicators/tests/test_telemetry.py` — modify
- `services/xstockstrat-ingest/tests/test_telemetry.py` — modify
- `services/xstockstrat-analysis/tests/test_telemetry.py` — modify
- `services/xstockstrat-agent/tests/test_telemetry.py` — modify

**Reviewers**: indicators, ingest, analysis, agent service owners — telemetry init stays non-fatal

**Codebase Evidence**:
- Unit test `test_build_resource_omits_trading_mode` is at `:10-18` (all four).
- Wire test `test_init_exports_metrics_and_logs_with_resource` (indicators/ingest/analysis `:157-186`, agent `:144-173`) uses `_start_body_receiver` (`:98`), `_enable` (`:117-120`, sets `OTEL_ENABLED`, endpoint, headers) and `_flush_all` (`:123-129`, flushes tracer, meter and logger providers). It decodes metrics and logs bodies only, with no trace-resource assertion (recon § Not found).
- The `otel_reset` fixture is in `tests/conftest.py` (indicators `:196`, ingest `:103`, analysis `:506`, agent `:302`) and resets the set-once providers, so each test can init with its own env.
- Ingest calls `init_telemetry()` before serving (`app/main.py:44`).

**TDD**: `red-green required` for the `host.provider` assertions (AC-1, AC-3, the unit table). The AC-21 assertion is a PRESERVE check, green before and after Step 3, and is exempt from the RED requirement; the P-06 gate must not halt on it.

**Covers**: AC-1 (Python rows), AC-3, AC-21

**Instructions**:
1. Extend the wire test in all four files (AC-1). Set `monkeypatch.setenv("HOST_PROVIDER", "homelab")`. Before `_flush_all()`, also start and end one span (`trace.get_tracer("t").start_as_current_span("s")`). Decode `/otlp/v1/traces` with `opentelemetry.proto.collector.trace.v1.trace_service_pb2.ExportTraceServiceRequest`, and add its resource to the existing `for resource in (...)` loop. Assert `res["host.provider"] == "homelab"` on all three.
2. In the same wire test, add the AC-21 assertion on the metrics resource: `service.instance.id` is non-empty and does not start with `"homelab-"`. This is a PRESERVE assertion, green before and after Step 3. Its RED-first run confirms where Python's id comes from (D-17). If the exported resource carries **no** `service.instance.id`, stop and escalate (P-03). Do not drop AC-21: scenario IDs are append-only (C-15), so removing it is a product-spec change for `/sdd-review`.
3. In `services/xstockstrat-ingest/tests/test_telemetry.py` only, add `test_unset_host_provider_exports_unknown` (AC-3). Use `otel_reset` and `monkeypatch.delenv("HOST_PROVIDER", raising=False)`, then `_enable` and `init_telemetry()`. `init_telemetry()` must return without raising: that is the start path's precondition for serving (`app/main.py:44`). Record one counter, flush, and assert the exported metrics resource has `host.provider == "unknown"`.
4. Extend each unit test (`:10-18`) with a parametrised table over `HOST_PROVIDER` ∈ {unset, `"aws"`, `"Homelab"`, `"homelab"`, `"digitalocean"`} → `_build_resource().attributes["host.provider"]`.
5. C-13: the literals are inline with a single consumer each, so no `conftest.py` addition is needed. Record that verdict.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv sync --extra dev && uv run pytest tests/test_telemetry.py -q && uv run pytest --cov=app --cov-fail-under=50 && ruff check . && ruff format --check . && cd -
for s in ingest analysis agent; do (cd services/xstockstrat-$s && uv sync --extra dev && uv run pytest tests/test_telemetry.py -q && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .) || exit 1; done
grep -n "conftest" services/xstockstrat-{indicators,ingest,analysis,agent}/tests/test_telemetry.py || true   # C-13: no new fixture import
```

---

### Step 5 — service: Node resource stamps `host.provider` and a deterministic `service.instance.id`

**Status**: `done`
**Service**: `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-config/src/telemetry.ts` — modify
- `services/xstockstrat-identity/src/telemetry.ts` — modify
- `services/xstockstrat-ledger/src/telemetry.ts` — modify
- `services/xstockstrat-notify/src/telemetry.ts` — modify

**Deployment files**: none in this step. `HOST_PROVIDER` reaches containers through Step 11 (`deploy/homelab/compose.yml` literal `homelab`) and Step 13 (`.do/app.dev.yaml`, `.do/app.yaml` → `digitalocean`); `docker-compose.yml` intentionally sets none (FR-8, unset → `unknown`). `TRADING_MODE` and every other env var are untouched, so compose↔DO parity (B2b) holds per the FR-8 table.

**Reviewers**: `xstockstrat-config` — WatchConfig stream stability; `xstockstrat-identity` — secret store integration (no secret in exported resource); `xstockstrat-ledger` — append-only invariant (unaffected); `xstockstrat-notify` — stream delivery guarantees (unaffected). All four: telemetry init stays non-fatal, and both `node --test` and the production `tsc` build pass (ledger `fails.md` 2026-09-09 feature 171).

**Codebase Evidence**:
- `buildResource()` (config `:29-35`, identity/ledger `:30-36`, notify `:31-37`) is `new Resource({ [SEMRESATTRS_SERVICE_NAME]: process.env.SERVICE_NAME ?? '<svc>', [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.APPLICATION_ENV ?? 'development', platform: 'xstockstrat' })`.
- The semconv imports `SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT` are at `:7-10`, from `@opentelemetry/semantic-conventions` `^1.25.0` (`package.json:29`).
- Consumed once by `NodeSDK({ resource: buildResource() })` (config `:172`, identity/ledger `:173`, notify `:174`), with `resourceDetectors: [envDetectorSync, processDetectorSync, hostDetectorSync]` (config `:183`).
- Build and test: `"test": "tsc && node --test dist/__tests__/*.test.js"` and `"build": "tsc"` (CJS; recon).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In each `telemetry.ts`, add a non-exported `function hostProvider(): string` above `buildResource()`. It returns `process.env.HOST_PROVIDER` when the value is exactly `'digitalocean'` or `'homelab'`, else `'unknown'`. Comment ≤2 lines.
2. In `buildResource()`, compute `const provider = hostProvider();` and `const serviceName = process.env.SERVICE_NAME ?? '<svc>';`, use `serviceName` for `SEMRESATTRS_SERVICE_NAME`, and add `[SEMRESATTRS_SERVICE_INSTANCE_ID]: \`${provider}-${serviceName}\`` (added to the `:7-10` import, D-10/O-24) and `'host.provider': provider`. Keep the function synchronous and exported, and keep the import extensionless (feature-171 trap). If the pinned semconv does not export `SEMRESATTRS_SERVICE_INSTANCE_ID`, `tsc` fails in Step 6's run. In that case use the literal `'service.instance.id'` and log a Deviation.
3. Leave `resourceDetectors` unchanged. The `OTEL_RESOURCE_ATTRIBUTES` override risk is handled by the deploy-spec guard (Step 15, AC-22), not in code (D-22).

**Verification**:
```bash
for s in config identity ledger notify; do (cd services/xstockstrat-$s && pnpm run build && pnpm run lint) || exit 1; done
grep -n "'host.provider'" services/xstockstrat-{config,identity,ledger,notify}/src/telemetry.ts   # 4 hits
```

---

### Step 6 — test: Node exported resources carry `host.provider`, normalisation and the disabled path

**Status**: `done`
**Service**: `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-config/src/__tests__/telemetry.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/telemetry.export.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/telemetry.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/telemetry.export.test.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/telemetry.test.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/telemetry.export.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/telemetry.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/telemetry.export.test.ts` — modify

**Reviewers**: config, identity, ledger, notify service owners — both test runners and the production `tsc` build verified

**Codebase Evidence**:
- Unit test `'built Resource omits trading_mode, keeps the trio'` is at config `telemetry.test.ts:20`, identity/ledger/notify `:17`. Disabled test `'disabled: telemetry never starts and the logger gains no OTLP transport'` is at identity/ledger/notify `:101`, config `:165`.
- Export test: env set in `before(…)` (config `:65`, identity `:31`, ledger/notify `:62`). In-process tests: span `'exports a span over OTLP/HTTP…'` (config `:93`, identity `:54`, ledger `:87`, notify `:89`); metrics `'exports a recorded counter … resource trio'` (config `:117`, identity `:78`, ledger `:111`, notify `:113`; parses `JSON.parse(req.body).resourceMetrics[0].resource.attributes`); logs `'bridges a winston record…'` (config `:140`, identity `:101`, ledger `:134`, notify `:136`).
- Child-process harness `function runChild(code, headers, onLine?)` spawns `process.execPath -e` with `env: { ...process.env, OTEL_ENABLED: 'true', … }` (config `:248`, identity `:171`, ledger `:204`, notify `:206`). `FLUSH_CHILD` (config `:285`, ledger `:241`) emits a span, a counter `t.flush` and logs `flush-1..3`, then awaits `shutdownTelemetry()` and prints `FLUSHED`. `processDetectorSync` (`telemetry.ts:183`) stamps `process.pid` on every resource.

**TDD**: `red-green required`

**Covers**: AC-1 (Node rows), AC-4, AC-5, AC-13, AC-19 (`ledger` row)

**Instructions**:
1. In all four `telemetry.export.test.ts`: in `before`, set `process.env.HOST_PROVIDER = 'homelab'` beside the other env lines. Extend the span, metrics and logs tests to parse each body's `resourceSpans[0]`/`resourceMetrics[0]`/`resourceLogs[0]` resource attributes and assert `host.provider === 'homelab'` (AC-1). In the metrics test, also assert `service.instance.id === 'homelab-<svc>'` (ledger: `homelab-ledger`, AC-19; the other three follow the same rule).
2. In `services/xstockstrat-ledger/src/__tests__/telemetry.export.test.ts` (AC-4) and `services/xstockstrat-config/src/__tests__/telemetry.export.test.ts` (AC-13), give `runChild` an optional trailing `extraEnv: Record<string, string> = {}` that is spread last into the child `env`. Add one test that runs `FLUSH_CHILD` with `{ HOST_PROVIDER: 'aws' }` (ledger) or `{ HOST_PROVIDER: 'Homelab' }` (config). Assert `code === 0` and `FLUSHED` printed: the process initialised and shut down cleanly. This is the stated proxy for "reaches SERVING" (the leaf's telemetry init is the only startup step `HOST_PROVIDER` can affect); name the tests `'unrecognised HOST_PROVIDER exports unknown; init and shutdown stay clean (AC-4 SERVING proxy)'` and `'non-lowercase HOST_PROVIDER exports unknown; init and shutdown stay clean (AC-13 SERVING proxy)'`. Of the requests received after the child started, keep those whose resource `process.pid` (compare as `String`) differs from the test process's `process.pid`. For each of `/v1/traces`, `/v1/metrics` and `/v1/logs`, assert at least one such request exists and every one carries `host.provider === 'unknown'`, never `'aws'`/`'Homelab'`. Identity and notify `runChild` stay unchanged (no consumer).
3. In all four `telemetry.test.ts` unit tests, add a table test that sets `process.env.HOST_PROVIDER` per row (unset, `'aws'`, `'Homelab'`, `'homelab'`, `'digitalocean'`), calls `buildResource()` and asserts `host.provider` (`unknown`, `unknown`, `unknown`, `homelab`, `digitalocean`) and `service.instance.id === \`${expected}-<svc>\``. Restore the env afterwards.
4. In `services/xstockstrat-notify/src/__tests__/telemetry.test.ts:101` (AC-5), set `process.env.HOST_PROVIDER = 'homelab'` before `initTelemetry()`. Keep the `telemetryStarted() === false` assertion and the existing `getLogger('notify').transports.length === 1` assertion (`src/services/logger.ts:32`, the start path's logger): telemetry stays off and the startup path is unaffected (AC-5). Name it `'disabled with HOST_PROVIDER=homelab: no OTLP pipeline, startup path unchanged (AC-5)'`.
5. C-13: all literals are inline and single-consumer per file. No `src/__tests__/fixtures/` home is created.

**Verification**:
```bash
for s in config identity ledger notify; do (cd services/xstockstrat-$s && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run build) || exit 1; done
grep -n "__tests__/fixtures" services/xstockstrat-{config,identity,ledger,notify}/src/__tests__/telemetry*.test.ts || true   # C-13: none expected
```

---

### Step 7 — service: UI resource stamps `host.provider` and a deterministic `service.instance.id`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/telemetry.ts` — modify

**Deployment files**: none in this step. `HOST_PROVIDER` reaches containers through Step 11 (`deploy/homelab/compose.yml` literal `homelab`) and Step 13 (`.do/app.dev.yaml`, `.do/app.yaml` → `digitalocean`); `docker-compose.yml` intentionally sets none (FR-8, unset → `unknown`). `TRADING_MODE` and every other env var are untouched, so compose↔DO parity (B2b) holds per the FR-8 table.

**Reviewers**: `xstockstrat-ui` — no secret values rendered; the Next.js instrumentation hook still lives in `src/`

**Codebase Evidence**:
- `resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName, 'deployment.environment': process.env.APPLICATION_ENV ?? 'development', platform: 'xstockstrat' })` is at `src/telemetry.ts:45-49`, inside `initTelemetry()` (`:15`). `const serviceName = process.env.SERVICE_NAME ?? 'ui'` is at `:37`, and the try/catch at `:18, 67-69` keeps init non-fatal.
- Module-level pure helpers `metricIntervalOptions` (`:2`) and `logBatchOptions` (`:10`) set the pattern. `HOST_PROVIDER` is a plain runtime read: `next.config.js:12` inlines only `UI_THEME_BACKGROUND_HEX` (recon).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a module-level `function hostProvider(): string` after `logBatchOptions` (`:13`), using the same exact-lowercase rule as the other runtimes. The doc comment is one line.
2. In the `resourceFromAttributes({...})` call (`:45-49`), add `'host.provider': provider` and `'service.instance.id': \`${provider}-${serviceName}\`` (string literals, following the `'deployment.environment'` precedent at `:47`), with `const provider = hostProvider();` computed beside `serviceName`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && grep -n "'host.provider'" src/telemetry.ts
```
No Playwright E2E applies to this step (server-side telemetry only; no UI behaviour or route change).

---

### Step 8 — test: UI exported resources carry `host.provider` and the instance id

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/instrumentation.testkit.ts` — modify

**Reviewers**: `xstockstrat-ui` — no secret values rendered

**Codebase Evidence**:
- `defineExportSuite(headers)` sets env in `beforeAll` (`:58-75`, e.g. `process.env.APPLICATION_ENV = 'staging'` `:64`). The traces test (`at('/v1/traces')`, `:94-95`), the metrics resource test (`:112-128`, asserts `deployment.environment` `:125`, no `trading_mode` `:127`) and the logs test (`resourceLogs`, `:131-157`) all share this suite. It is wrapped by `src/instrumentation.test.ts:4` and `src/instrumentation.encoded-header.test.ts`. vitest `include: ['src/**/*.test.ts']` (`vitest.config.ts:20`).
- C-12: the resource test uses no domain objects, so no `e2e/fixtures/` import is needed (recon Patterns to REUSE).

**TDD**: `red-green required`

**Covers**: AC-1 (UI row), AC-19 (`ui` row)

**Instructions**:
1. In `beforeAll`, set `process.env.HOST_PROVIDER = 'homelab'`.
2. In the metrics test (`:112-128`), assert `attrs['host.provider'] === 'homelab'` and `attrs['service.instance.id'] === 'homelab-ui'` (AC-19).
3. In the traces test (`:94-95`) and the serverLog test (`:131-157`), parse the body's `resourceSpans[0]` / `resourceLogs[0]` resource attributes and assert `host.provider === 'homelab'` (AC-1 on all three signals).
4. C-12 verdict: scenario one-off env literals only, so no fixture import is needed. Record that verdict.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:unit -- src/instrumentation && pnpm test:unit && pnpm run lint
```
No coverage threshold applies: coverage is scoped to `src/lib/**` (`vitest.config.ts:25`), and `src/telemetry.ts` is outside it. No Playwright E2E is needed (B3 frontend): there is no UI behaviour, route or rendered-value change; the vitest export suite is the coverage.

---

### Step 9 — service: OTLP keys reach the homelab target through SOPS, prefixed by one shared helper

**Status**: `done`
**Service**: deploy surface (`scripts/`, `.github/workflows/`)
**Files**:
- `scripts/sops_secrets.py` — modify
- `scripts/do-render-app-spec.py` — modify
- `.github/workflows/deploy-homelab.yml` — modify

**Reviewers**: Platform Lead — deploy-target parity DO vs homelab; Security — new credential wiring follows `docs/runbooks/add-data-source.md` § "Wiring a New Vendor Credential Through Deploy"; no plaintext in repo or logs

**Codebase Evidence**:
- `KEYS` rows `scripts/sops_secrets.py:32-33`: `("common", "OTEL_EXPORTER_OTLP_ENDPOINT", False, (DO,))`, `("common", "OTEL_EXPORTER_OTLP_HEADERS", False, (DO,))`. Row shape with both targets, e.g. `:27` `("common", "SLACK_WEBHOOK_URL", False, (DO, HOMELAB))`.
- `mask(value)` is at `:103`, and `resolve()` (`:148-189`) masks every decrypted value and every LEGACY value before any other output (`:155-161`). `_quoted` is at `:192-199`. `cmd_resolve(args)` (`:212-222`) builds `APP_ENV` from `_quoted(n, values[n])` (`:220`).
- `scripts/do-render-app-spec.py:22` `OTEL_HEADERS = "OTEL_EXPORTER_OTLP_HEADERS"`; `:104-107` `headers = fill[OTEL_HEADERS]; if headers and not headers.startswith("Authorization="): fill[OTEL_HEADERS] = "Authorization=" + headers; sops_secrets.mask(fill[OTEL_HEADERS])`. That is the only `OTEL_HEADERS` use in `scripts/` (grep).
- `.github/workflows/deploy-homelab.yml`: `P` at `:62`; the Resolve step env holds LEGACY lines `:101-117`, the last common one `LEGACY_VAPID_SUBJECT` at `:109`, and `resolve` runs at `:118`. The DO form to copy is `.github/workflows/deploy.yml:100-101` `LEGACY_OTEL_EXPORTER_OTLP_ENDPOINT: ${{ secrets[format('{0}_OTEL_EXPORTER_OTLP_ENDPOINT', env.P)] }}` (and `_HEADERS`).
- `scripts/sops-secrets.test.sh`: `expected_legacy` (`:715-738`) derives a common key's homelab RHS as `secrets[format('{0}_<K>', env.P)]`; `check_legacy "$wf" homelab homelab` is at `:1067`; `COMMON_RE` (`:747`) already lists both OTLP names, and `no_unprefixed` forbids `secrets.OTEL_…`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `scripts/sops_secrets.py`: change `:32-33` targets to `(DO, HOMELAB)`. Keep `required=False`, because PRESERVE `@AC-2 @FR-3 @feature-302` requires an absent optional value to add no line.
2. `scripts/sops_secrets.py`: add `OTEL_HEADERS = "OTEL_EXPORTER_OTLP_HEADERS"` and `authorization_header(value)` after `mask` (`:110`):
   ```python
   def authorization_header(value):
       """The OTLP header with "Authorization=" exactly once; empty stays empty."""
       if not value or value.startswith("Authorization="):
           return value
       prefixed = "Authorization=" + value
       mask(prefixed)
       return prefixed
   ```
3. `cmd_resolve` (`:212`): right after `values, _ = resolve(...)`, set `values[OTEL_HEADERS] = authorization_header(values[OTEL_HEADERS])` when the key is present, before `APP_ENV` is built with `_quoted` (`:219-221`).
4. `scripts/do-render-app-spec.py`: delete the local `OTEL_HEADERS` (`:22`). Replace `:104-107` with `fill[sops_secrets.OTEL_HEADERS] = sops_secrets.authorization_header(fill[sops_secrets.OTEL_HEADERS])`. DO output must stay byte-identical (AC-17; pinned by `sops-secrets.test.sh` render case 6, `:669-682`).
5. `.github/workflows/deploy-homelab.yml`: after `:109`, add `LEGACY_OTEL_EXPORTER_OTLP_ENDPOINT: ${{ secrets[format('{0}_OTEL_EXPORTER_OTLP_ENDPOINT', env.P)] }}` and `LEGACY_OTEL_EXPORTER_OTLP_HEADERS: ${{ secrets[format('{0}_OTEL_EXPORTER_OTLP_HEADERS', env.P)] }}`. Never use the `secrets.OTEL_…` form (`COMMON_RE`). Do not move the resolve step, whose position before the image-commit detach is pinned at `sops-secrets.test.sh:1083-1086`.

**Verification**:
```bash
ruff check scripts/sops_secrets.py scripts/do-render-app-spec.py && ruff format --check scripts/sops_secrets.py scripts/do-render-app-spec.py
bash scripts/sops-secrets.test.sh resolve render deploy homelab
```
`sops-secrets.test.sh` needs `sops`/`age` (the CI `sops-secrets` job installs them via `.github/actions/setup-sops`). If they are absent locally, run the job's install step first; never skip the groups.

---

### Step 10 — test: homelab resolve emits the prefixed OTLP keys, masked; DO stays optional and unchanged

**Status**: `done`
**Service**: deploy surface (`scripts/`)
**Files**:
- `scripts/sops-secrets.test.sh` — modify

**Reviewers**: Platform Lead — DO/homelab parity; Security — the credential is never printed outside `::add-mask::`

**Codebase Evidence**:
- `group_resolve` (`:145`) cases 1–18; case 18 ends just before `echo "resolve: ok"` (`:388` at `6801c3e`; re-grep at execute time, placement is semantic: after case 18). **Design S5 names this "new case 17", but cases 14–18 already exist (`:332-390`, feature 302), so the new case is numbered 19.**
- Helpers: `hl_enc <out> <homelab-json> [<common-json>]` (`:137-143`); `cli` (`:104-111`); `src` (`:114`); `ghenv_get` (`:116-120`); `only_masked` (`:122-125`); `masks_first` (`:126-128`); `$flat` and `$sk` from case 7 (`:212-215`). The case-7 `hl` LEGACY list (`:209-210`) prints a `TS_AUTHKEY` `::warning::` ("differs from legacy") before the prefixed-value mask, which would fail `masks_first` (D-17/O-33). `hl_enc` carries `TS_AUTHKEY`, `TS_AUTHKEY_EXPIRES` and `DEPLOY_SSH_KEY` but not `DEPLOY_KNOWN_HOSTS`, so the own list needs only `LEGACY_DEPLOY_KNOWN_HOSTS`.
- DO-side pins `:155-159` (case 1), render case 6 `:669-682` (prefix both ways, absent optional renders empty) stay unchanged.

**TDD**: `red-green required`

**Covers**: AC-8, AC-9, AC-17

**Instructions**:
1. After case 18, add `# 19. AC-8/AC-9 (feature 332): …`. `hl_enc "$work/c19/staging.enc.yaml" "$flat" '{"OTEL_EXPORTER_OTLP_ENDPOINT":"https://otlp.example.test/otlp","OTEL_EXPORTER_OTLP_HEADERS":"Basic dGVzdA=="}'`, then `cli staging "$f" LEGACY_DEPLOY_KNOWN_HOSTS=known-gh "$sk"` (its own LEGACY list, not `hl`). Assert:
   - `src OTEL_EXPORTER_OTLP_ENDPOINT` and `src OTEL_EXPORTER_OTLP_HEADERS` are each `sops` (AC-8);
   - `ghenv_get APP_ENV` contains exactly the line `OTEL_EXPORTER_OTLP_ENDPOINT='https://otlp.example.test/otlp'` and exactly one line `OTEL_EXPORTER_OTLP_HEADERS='Authorization=Basic dGVzdA=='` (AC-9);
   - `only_masked dGVzdA== 19` and `masks_first 19`.
2. Re-run with the SOPS header already `Authorization=Basic dGVzdA==`. Assert the same single line, and that `Authorization=Authorization=` does not appear in `$work/ghenv` (AC-9, second clause).
3. AC-17: add a python check, written like `group_homelab`'s `:1068-1074` heredoc, that every `OTEL_EXPORTER_OTLP_*` row from `keys_for(DO)` and `keys_for(HOMELAB)` has `required == False`. Render case 6 (`:669-682`) remains the byte-level DO prefix pin and must still pass unedited.
4. RED: against the pre-Step-9 tree, case 19 fails (no OTLP lines in `APP_ENV`).

**Verification**:
```bash
bash scripts/sops-secrets.test.sh resolve render homelab && shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```

---

### Step 11 — service: homelab compose exports telemetry with fixed literals and required OTLP vars; staging reports `staging`

**Status**: `done`
**Service**: deploy surface (`deploy/homelab/`, `scripts/`)
**Files**:
- `deploy/homelab/compose.yml` — modify
- `scripts/homelab-release-env.sh` — modify
- `deploy/homelab/render-assert.jq` — modify

**Reviewers**: Platform Lead — deploy-target parity; pipeline owns and asserts values per service (`fails.md` 2026-11-04 homelab-compose-deploy); Security — the header value is never projected or printed

**Codebase Evidence**:
- `deploy/homelab/compose.yml:4-8` `x-common-env` (`APPLICATION_ENV: ${APPLICATION_ENV:?APPLICATION_ENV is required}` `:5`, `TRADING_MODE` `:6`, `OTEL_ENABLED: "false"` `:7`, `MTLS_CA_CERT` `:8`). The required-var idiom is `${VAR:?VAR is required}`. The 12 runtimes merge the anchor (recon: `:47,65,84,105,129,148,170,189,212,239,267,301`); `db-migrator` (`:36-41`) does not. The file has no `env_file:` and no `${OTEL_RESOURCE_ATTRIBUTES}`.
- `scripts/homelab-release-env.sh:18` `staging) db=xstockstrat-staging role=xstockstrat_staging appenv=development mode=paper ;;`. The `owned` regex (`:39`) stays as is (D-13, D-19).
- `deploy/homelab/render-assert.jq`: `want` staging `appenv: "development"` (`:4`); `def pem` (`:13`); the `env` projection (`:22-23`) `{APPLICATION_ENV, TRADING_MODE, OTEL_ENABLED, HOSTNAME, DB_PGBOUNCER, pool: .DB_POOL_MAX, …}`; `$apps` = services minus `db-migrator` (`:25`); `(if .OTEL_ENABLED != "false" then "otel:\($k)" else empty end)` (`:39`).
- `scripts/homelab-render-check.sh:15-17` prints only `required variable <VAR> is missing a value` and discards jq stderr (`:21`).
- Every runtime treats a non-`production` `APPLICATION_ENV` as the staging scope, and DO dev already runs `staging` (`.do/app.dev.yaml:28-29`; design §2, D-6).

**Lands with**: Step 12

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `deploy/homelab/compose.yml` `x-common-env`: replace `:7` with `OTEL_ENABLED: "true"`, then add `HOST_PROVIDER: homelab`, `OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT:?OTEL_EXPORTER_OTLP_ENDPOINT is required}` and `OTEL_EXPORTER_OTLP_HEADERS: ${OTEL_EXPORTER_OTLP_HEADERS:?OTEL_EXPORTER_OTLP_HEADERS is required}`. These are literals, so no `.env` line can change `OTEL_ENABLED`/`HOST_PROVIDER` (D-13). Add no `env_file:`.
2. `scripts/homelab-release-env.sh:18`: `appenv=development` → `appenv=staging`. This is the only change to this file (D-6, D-19).
3. `deploy/homelab/render-assert.jq`:
   - `:4` staging `appenv: "staging"`;
   - after `:13` add `def authz: type == "string" and startswith("Authorization=");`;
   - `:22` projection: add `HOST_PROVIDER` and `otlp: ((.OTEL_EXPORTER_OTLP_ENDPOINT | type == "string" and length > 0) and (.OTEL_EXPORTER_OTLP_HEADERS | authz))`. These are value-free booleans: never project the endpoint or header value;
   - `:39` becomes `(if .OTEL_ENABLED != "true" or .otlp != true then "otel:\($k)" else empty end),` followed by `(if .HOST_PROVIDER != "homelab" then "host-provider:\($k)" else empty end),`. Both run over `$apps`, which excludes `db-migrator`.

**Verification**: the union with Step 12 (one red→green cycle):
```bash
bash scripts/homelab-render.test.sh && bash scripts/sops-secrets.test.sh resolve
shellcheck scripts/homelab-release-env.sh scripts/homelab-render.test.sh && shfmt -d -i 2 scripts/homelab-release-env.sh scripts/homelab-render.test.sh
```

---

### Step 12 — test: homelab render fixtures carry the OTLP lines; the oracle names every broken telemetry render

**Status**: `done`
**Service**: deploy surface (`scripts/`)
**Files**:
- `scripts/homelab-render.test.sh` — modify
- `scripts/sops-secrets.test.sh` — modify

**Reviewers**: Platform Lead — pipeline-owned/asserted values per service; Security — `SECRETPROBE` never printed

**Codebase Evidence**:
- `scripts/homelab-render.test.sh`: `base_env` (`:39-45`, raw `KEY=value` lines plus `SLACK_WEBHOOK_URL=$probe`); `build`/`check`/`render`/`envv`/`mode_all` helpers (`:48-66`); case 1 `mode_all "$work/staging.json" development paper "1"` (`:74`) and `OTEL_ENABLED = "false"` (`:81`); case 3 override (`:95-110`, `grep -q evil` `:105`, `check` `:106`); case 5 missing-var pattern (`:121-124`); case 7 `mutate <label> <jq filter>` (`:157-196`; it fails if the output carries `$probe`); file ends at `echo … all assertions passed` (`:211`). There is no case 10 today.
- `scripts/sops-secrets.test.sh` case 8 (`:243-265`) runs the real release script with `APP_ENV="$(cat "$work/app_env")"` (`:250`, the case-7 resolver output, which has no OTLP keys) and renders compose (`:253-254`). Once Step 11's `${VAR:?}` lands, that render fails.

**Lands with**: Step 11

**TDD**: `red-green required`

**Covers**: AC-6, AC-7, AC-14, AC-16, AC-18, AC-20

**Instructions**:
1. `homelab-render.test.sh` `base_env`: append `OTEL_EXPORTER_OTLP_ENDPOINT='https://otlp.example.test/otlp'` and `OTEL_EXPORTER_OTLP_HEADERS='Authorization=Basic dGVzdA=='`, the resolver's quoted form, as in AC-6.
2. Case 1 (AC-6, AC-18): `:74` → `mode_all "$work/staging.json" staging paper "1"`; `:81` → expect `"true"`. Add a loop over every service except `db-migrator`, the same selection as `mode_all`, asserting `OTEL_ENABLED` = `true`, `HOST_PROVIDER` = `homelab`, `OTEL_EXPORTER_OTLP_ENDPOINT` non-empty, and `OTEL_EXPORTER_OTLP_HEADERS` starting with `Authorization=`. Compare in shell and never print the value. `check` (`:68`) already asserts `[]`.
3. Case 3 (AC-20, D-18): append `OTEL_ENABLED=false` and `HOST_PROVIDER=digitalocean` to `override`. After `build`, add `grep -qx 'OTEL_ENABLED=false' "$work/override.env"` and `grep -qx 'HOST_PROVIDER=digitalocean' "$work/override.env"` as preconditions (the lines pass through unowned; without these the case could pass vacuously). Keep `:105` (`grep -q evil`) and `:106` (`check`). Assert every app in `override.json` still has `OTEL_ENABLED` `true` and `HOST_PROVIDER` `homelab`.
4. Case 7 (AC-7, AC-14): add `mutate otel:xstockstrat-ui '.services["xstockstrat-ui"].environment.OTEL_ENABLED = "false"'`, `mutate otel:xstockstrat-trading ".services[\"xstockstrat-trading\"].environment.OTEL_EXPORTER_OTLP_HEADERS = \"$probe\""` (probe as header, D-10), and `mutate host-provider:xstockstrat-analysis '.services["xstockstrat-analysis"].environment.HOST_PROVIDER = "digitalocean"'`. `mutate` already asserts that the label is reported and the probe is absent. `homelab-render-check.sh:22-25` exits non-zero on any non-`[]` result.
5. New case 10 before `:211`, "rollback/skew (O-4, D-12) and AC-16":
   - (a) old ref + new image: `build staging` with `base_env` minus both OTLP lines, `check` fails, and `grep -qE 'required variable OTEL_EXPORTER_OTLP_(ENDPOINT|HEADERS) is missing a value'` matches (compose reports only one; map order is not deterministic, D-10);
   - (b) AC-16: minus only the `OTEL_EXPORTER_OTLP_HEADERS` line → `check` fails and `$work/err` contains `required variable OTEL_EXPORTER_OTLP_HEADERS is missing a value`; `no_probe "10b"`;
   - (c) new ref + old image is inert: write `$work/old-compose.yml` from `deploy/homelab/compose.yml` with `OTEL_ENABLED: "true"` → `"false"` and the `HOST_PROVIDER:`/`OTEL_EXPORTER_OTLP_` lines deleted. Assert `grep -c OTEL_EXPORTER_OTLP_ "$work/old-compose.yml"` is 0 as a non-vacuity precondition. Render it with the case-1 `.env` (`docker compose --env-file … -f "$work/old-compose.yml" config --format json`) and assert it renders, with every app's `OTEL_EXPORTER_OTLP_HEADERS` `MISSING` and `OTEL_ENABLED` `false`.
6. `sops-secrets.test.sh` case 8 (`:250`): feed `APP_ENV="$(cat "$work/app_env"; printf '%s\n' "OTEL_EXPORTER_OTLP_ENDPOINT='https://otlp.example.test/otlp'" "OTEL_EXPORTER_OTLP_HEADERS='Authorization=Basic dGVzdA=='")"`. This extends the fixture for the signed-off C-16 CHANGE of `@AC-9 @FR-3 @feature-302`; the case's existing assertions are unchanged.

**Verification**: the union with Step 11 (see Step 11 **Verification**).

---

### Step 13 — config: DO app specs set `HOST_PROVIDER=digitalocean`

**Status**: `done`
**Service**: deploy surface (`.do/`)
**Files**:
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: Platform Lead — deploy-target parity DO vs homelab (FR-8 table)

**Codebase Evidence**:
- The global `envs:` block (`.do/app.dev.yaml:25-40`, `.do/app.yaml:25-40`) has `- key: OTEL_ENABLED` at `:32` with `value: "true"` (dev) / `"false"` (prod) at `:33`, followed by `OTEL_EXPORTER_OTLP_ENDPOINT` at `:34`. No component overrides `OTEL_ENABLED` (recon).
- A literal `value: digitalocean` passes `scripts/do-render-app-spec.py`: only `YOUR_(DEV|PROD)_*` (`PLACEHOLDER :21`) and `YOUR_*` (`LEFTOVER :25`) tokens are rewritten.
- `docker-compose.yml:18` `OTEL_ENABLED: ${OTEL_ENABLED:-false}` sets no `HOST_PROVIDER`, and it stays that way (FR-8, PRESERVE `@AC-4 @FR-4 @feature-226`).

**TDD**: `N/A (deploy-spec env literal; behaviour asserted by Step 14)`

**Covers**: —

**Instructions**:
1. In both files, insert after `:33` (the `OTEL_ENABLED` value):
   ```yaml
     - key: HOST_PROVIDER
       value: digitalocean
   ```
   Leave `.do/app.yaml`'s `OTEL_ENABLED` at `"false"` (enabling prod telemetry is out of scope). Make no component-level change.
2. Do not touch `docker-compose.yml`.

**Verification**:
```bash
yq '.envs[] | select(.key == "HOST_PROVIDER") | .value' .do/app.dev.yaml .do/app.yaml   # digitalocean ×2
yq '.envs[] | select(.key == "OTEL_ENABLED") | .value' .do/app.yaml                     # false
! grep -n HOST_PROVIDER docker-compose.yml
```

---

### Step 14 — test: rendered DO specs carry `HOST_PROVIDER=digitalocean`; local compose sets none

**Status**: `done`
**Service**: deploy surface (`scripts/`)
**Files**:
- `scripts/sops-secrets.test.sh` — modify

**Reviewers**: Platform Lead — FR-8 per-target values

**Codebase Evidence**:
- `group_render` (`:600`, `need … yq`) renders both real specs through `do-render-app-spec.py` via `rnd <env> <spec> <app-name> <out> <LEGACY…>` (case 6 `:669-682` uses `req=(…)` LEGACY list `:670-671`). Case 8 is the last, followed by `echo "render: ok"` (`:711` at `6801c3e`; re-grep at execute time, placement is semantic: after case 8).

**TDD**: `red-green required`

**Covers**: AC-15

**Instructions**:
1. After case 8, add `# 9. AC-15 (feature 332): …`. For `staging .do/app.dev.yaml xstockstrat-staging` and `production .do/app.yaml xstockstrat-production`, `rnd` with the case-6 `req` list. Assert `yq '.envs[] | select(.key == "HOST_PROVIDER") | .value'` on the rendered `$work/r.yaml` is `digitalocean`. For the production render, also assert `OTEL_ENABLED` is `false`.
2. In the same case, assert `! grep -q HOST_PROVIDER docker-compose.yml`.
3. RED: fails against the pre-Step-13 tree.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh render && shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```

---

### Step 15 — service: query guard (Part 6, Part 4 scope) + registry row + `observability.md` contract and query blocks

**Status**: `done`
**Service**: deploy surface (`scripts/`, `packages/otel/`, `docs/patterns/`, `.github/workflows/`)
**Files**:
- `scripts/check-otel-produced-signals.sh` — modify
- `packages/otel/produced-signals.tsv` — modify
- `docs/patterns/observability.md` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: Platform Lead — cross-service observability contract; deploy-spec guard covers every target

**Codebase Evidence**:
- `scripts/check-otel-produced-signals.sh`: the header (`:2-18`) lists Parts 1/3/4/5. The stream matcher is built from the protos (`:66-100`, `want_matcher="rpc_method!~\"${stream_matcher}\""`). `check_streams()` (`:102-121`) short-circuits with `[ -n "$want_matcher" ] || return 0`, then an awk loop extracts each `rpc_server_duration_milliseconds_(count|bucket|sum)` selector body and reports a missing matcher as `hit AC-17 P4`. `registered()` is at `:123`; `expr_tokens()` (`:131-171`) strips strings, `{…}`, `[…]` and `by/on/group_left(…)` lists and skips identifiers followed by `(`. `check_expr()` (`:173-183`) calls `check_streams` plus registry lookups (`AC-8 P1`). `hit()` (`:37-39`) prints `AC-n <tag> <relpath>:<line>: <text>`. The Part 4 deploy-spec loop (`:423-430`) covers `"$ROOT"/.do/* "$ROOT"/docker-compose.yml` for `OTEL_TRACES_SAMPLER|OTEL_PYTHON_GRPC_EXCLUDED_SERVICES|OTEL_PYTHON_GRPC_EXCLUDE_SERVICES` → `AC-17 P4-sampler`.
- `packages/otel/produced-signals.tsv`: a 4-column TSV, `kind⇥identifier⇥producer-path(s)⇥producer-literal`, with `metric` and `loki-service` rows (`loki-service⇥analysis⇥…` at `:16`). The registry check `grep -q -F -- "$lit"` runs on any listed path (`:47-60`), so a 4th-column note would break it (D-16).
- The byte-identical stream exclusion is at `packages/otel/alerts/alert-rules.yaml:51`: `rpc_method!~"ExportEvents|StreamAlerts|StreamBars|StreamEvents|StreamOrderUpdates|StreamPortfolioUpdates|StreamQuotes|WatchConfig"`.
- `docs/patterns/observability.md` (70 lines, **no fenced block today**, `grep -c '```'` → 0): env table `:50-57`; resource paragraph `:59` ends "No `OTEL_RESOURCE_ATTRIBUTES` env var is needed or set."; cost note `:40-42` (≈1,200 dev series).
- `scripts/check-otel-produced-signals.test.sh` `fallback_tree` (`:370-377`) deletes doc lines matching `service-health|signal-pipeline|infrastructure|trading-service|service-detail`. Part 3 checks numeric "N dashboards / N alert rules" phrases (D-20/O-48, design §4).
- `.github/workflows/ci.yml:155-161`: the `otel-signals` path filter lists `packages/otel/**`, `packages/proto/**/*.proto`, `docs/**`, `.do/**` and the guard scripts/testdata, **but neither `docker-compose.yml` nor `deploy/homelab/compose.yml`**, so a compose-only PR would skip the AC-22/AC-23 scan (finding at spec time; not in `design.md`, see Instruction 5).

**TDD**: `red-green required`, with the RED cases held by Step 16 (this step adds none of its own). Step 15's own gate is that every existing harness case, including `green-real-tree` (`check-otel-produced-signals.test.sh:125`) and `fallback-fenced` (`:384`), stays green with the new Part 6, the `selector_lacks` refactor and the new fences; run `bash scripts/check-otel-produced-signals.test.sh` before Step 16 edits it.

**Covers**: —

**Instructions**:
1. **Part 4 scope** (D-22): change the deploy-spec loop (`:424`) to `for f in "$ROOT"/.do/* "$ROOT"/docker-compose.yml "$ROOT"/deploy/homelab/compose.yml`. Keep the existing sampler grep (`AC-17 P4-sampler`, now also covering the homelab compose, AC-23). Add a second grep for `OTEL_RESOURCE_ATTRIBUTES` that reports `hit AC-22 P4-resattr "<rel>" "<line>" "<text>"` (AC-22).
2. **`selector_lacks`** (D-20): extract the awk body of `check_streams` into `selector_lacks <metric-regex> <want> <expr>`, which prints one row per selector of `<metric-regex>` lacking `<want>` (bare selector → `(no label matchers)`). `check_streams` becomes a caller and keeps its `[ -n "$want_matcher" ] || return 0` short-circuit and its `AC-17 P4` tag.
3. **Part 6** (new section before Part 5, with a header-comment line). Scan only `docs/patterns/observability.md`:
   - collect fenced blocks whose info string is exactly `promql otel-guard:host-provider` / `logql otel-guard:host-provider`. A count ≠ 1 per language is `hit AC-10 P6` / `hit AC-11 P6` (line 1 when zero);
   - join each block's lines into one expr and check that `( ) { } [ ]` balance and that the double quotes are even. Otherwise hit `AC-10 P6` / `AC-11 P6` "unbalanced";
   - run `check_expr <rel> <ln> <expr> E` on both. The registry plus the Part 4 stream matcher keep their own `AC-8 P1` / `AC-17 P4` tags;
   - PromQL: `selector_lacks rpc_server_duration_milliseconds_count 'deployment_environment="staging"'`; `selector_lacks target_info 'deployment_environment="staging"'` and `'host_provider="homelab"'`; with whitespace normalised, the expr contains `on (job, instance, deployment_environment) group_left (host_provider)` and `group by (job, instance, deployment_environment, host_provider)`. Each miss is a `hit AC-10 P6`;
   - LogQL: contains `| deployment_environment="staging"` and `| host_provider="homelab"`. A miss is a `hit AC-11 P6`.
   Use bash 3.2 + POSIX awk only (file header `:19`).
4. **Registry**: append `metric⇥target_info⇥services/xstockstrat-trading/internal/telemetry/otel.go⇥host.provider` (tabs, 4 columns, no note) to `packages/otel/produced-signals.tsv` (D-16; needs Step 1).
5. **CI filter**: add `'docker-compose.yml'` and `'deploy/homelab/compose.yml'` to the `otel-signals` filter (`ci.yml:155-161`), so the Part 4 deploy-spec scan runs on a compose-only PR (C-10: every surface the guard scans triggers it). This is a spec-time addition outside `design.md`; impl-spec review confirms it.
6. **`docs/patterns/observability.md`** (FR-5, FR-7, AC-10..AC-12):
   - env table (`:50-57`): add a `HOST_PROVIDER` row (local: unset → `unknown`; DO: `digitalocean`; homelab: `homelab`, a compose literal);
   - rewrite `:59`: `host.provider` comes from `HOST_PROVIDER` (`digitalocean` | `homelab` | `unknown`, exact lowercase; an unset or unrecognised value resolves to `unknown` and never blocks startup). Go, Node and UI set `service.instance.id` to `<host.provider>-<service.name>`; Python keeps its SDK-generated id. Replace the last sentence with "Do not set `OTEL_RESOURCE_ATTRIBUTES`: several runtimes merge it into the resource and may override `host.provider` (precedence unverified per SDK); CI rejects it in every deploy spec." (D-19, D-22);
   - new heading `## Separating DO and homelab (host.provider)`. Explain the Grafana promotion facts (`job`, `instance`, `deployment_environment` on series; `host_provider` only on `target_info`; logs: structured metadata). Then add exactly one `promql otel-guard:host-provider` fence with the D-20 query, using the stream list byte-identical to `alert-rules.yaml:51`, and exactly one `logql otel-guard:host-provider` fence with `{service_name="analysis"} | deployment_environment="staging" | host_provider="homelab"`. Give prose variants for DO dev (`host_provider="digitalocean"`) and homelab production (`deployment_environment="production"` on both selectors), and say why the `group by` and the `deployment_environment` join key exist (per-restart `target_info` rows; shared `instance=homelab-<svc>` across homelab environments). Staging and production share one Grafana instance, so every query filters both axes;
   - manual post-deploy check (inline code, outside the fences): `count(group by (job) (target_info{deployment_environment="staging", host_provider="homelab"}))` returns at least 11 jobs on an idle stack and 12 after one UI login; the documented PromQL returns at least one series after one RPC; `instance` is `homelab-<job>` for the 8 Go/Node/UI jobs; an empty `target_info` result 5 minutes after a healthy deploy means blocked egress (services still pass healthchecks, so the VM does not roll back);
   - the homelab egress precondition (outbound HTTPS to the OTLP gateway host, no TLS-intercepting proxy) and the Open Risks from `design.md`: DO rolling-deploy overlap; homelab staging and DO dev share the staging OTLP token; a ≈3,600-series budget across three exporting stacks plus Python restart churn; a one-time relabel of DO dev Go/Node/UI series; alerts are not provider-scoped (follow-up `otel-env-provider-scoped-alerts`);
   - the new text must not contain `service-health`, `signal-pipeline`, `infrastructure`, `trading-service`, `service-detail`, or any "<number> dashboards" / "<number> alert rules" phrase.

**Verification**:
```bash
bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh
shellcheck scripts/check-otel-produced-signals.sh && shfmt -d -i 2 scripts/check-otel-produced-signals.sh
[ "$(grep -c '^```promql otel-guard:host-provider$' docs/patterns/observability.md)" = 1 ] && [ "$(grep -c '^```logql otel-guard:host-provider$' docs/patterns/observability.md)" = 1 ]
yq '.jobs.changes' .github/workflows/ci.yml >/dev/null
```

---

### Step 16 — test: guard RED cases for the query blocks, the deploy-spec scan and the doc contract

**Status**: `done`
**Service**: deploy surface (`scripts/`)
**Files**:
- `scripts/check-otel-produced-signals.test.sh` — modify

**Reviewers**: Platform Lead — the guard cannot pass vacuously

**Codebase Evidence**:
- Harness: `fresh()` (`:37-49`) copies `packages/otel`, `docs/setup`, `docs/patterns` (so `observability.md`), `.do`, `docker-compose.yml`, the protos and the producers, **but not `deploy/homelab/compose.yml`**. `append` is at `:97-99`; `expect_green` `:101-107`; `expect_hit <id> <needle…>` `:109-122`. The existing Part 4 cases `AC-17-sampler-in-do-spec` (`:228-230`) and `AC-17-grpc-exclusion-in-compose` (`:232-234`) are the pattern. The doc-contract precedent is the `c16-attributes` case (`:391-399`). The run ends with `cases=… failed=…` (`:406-411`).

**TDD**: `red-green required`

**Covers**: AC-10, AC-11, AC-12, AC-22, AC-23

**Instructions**:
1. `fresh()`: also `mkdir -p "${tree}/deploy/homelab"` and copy `deploy/homelab/compose.yml`.
2. AC-22: one case per scanned file. Append `      OTEL_RESOURCE_ATTRIBUTES: host.provider=digitalocean` to `deploy/homelab/compose.yml` → `expect_hit AC-22-resattr-in-homelab-compose "AC-22 P4-resattr deploy/homelab/compose.yml:"`. Add the same for `docker-compose.yml`, and `  - key: OTEL_RESOURCE_ATTRIBUTES` for `.do/app.yaml` and `.do/app.dev.yaml`.
3. AC-23: append `      OTEL_TRACES_SAMPLER: traceidratio` to the homelab compose → `expect_hit AC-23-sampler-in-homelab-compose "AC-17 P4-sampler deploy/homelab/compose.yml:"`.
4. AC-10 / AC-11. Each case mutates the tree copy of `docs/patterns/observability.md` with a portable `sed` into a temp file plus `cp` (no `sed -i`, macOS):
   - `AC-10-no-promql-block` (rename the info string), `AC-10-two-promql-blocks` (append a second tagged block), `AC-11-no-logql-block` → `AC-10 P6` / `AC-11 P6`;
   - `AC-10-join-missing-deployment-environment`, `AC-10-target-info-lacks-host-provider`, `AC-10-rpc-selector-lacks-environment`, `AC-10-unbalanced` → `AC-10 P6`;
   - `AC-10-rpc-selector-lacks-stream-matcher` → `AC-17 P4 docs/patterns/observability.md:`;
   - `AC-10-unregistered-metric` (rename `target_info` to `target_infox`) → `AC-8 P1 docs/patterns/observability.md:`;
   - `AC-11-lacks-host-provider`, `AC-11-unbalanced` → `AC-11 P6`; `AC-11-unregistered-stream` (`service_name="nosuch"`) → `AC-8 P1`.
5. AC-12: a doc-contract case modelled on `c16-attributes` that greps the tree's `observability.md` for `host.provider`, each of `digitalocean`, `homelab`, `unknown`, the phrase `<host.provider>-<service.name>`, ``Do not set `OTEL_RESOURCE_ATTRIBUTES` ``, the literal `count(group by (job) (target_info{deployment_environment="staging", host_provider="homelab"}))`, `egress`, and the expected-result text (`11` and `12` jobs). Each miss is a `case_fail AC-12-…`.
6. The real-tree `green-real-tree` case (`:125`) and `fallback-fenced` (`:384`) must stay green with the new blocks.
7. RED: against a tree with Step 15's script but the pre-Step-15 doc, the zero-block cases fire. Against the pre-Step-15 script, every new case fails `expect_hit`.

**Verification**:
```bash
bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh
shellcheck scripts/check-otel-produced-signals.test.sh && shfmt -d -i 2 scripts/check-otel-produced-signals.test.sh
```

---

### Step 17 — docs: runbook, CI, setup, dashboards README, UI CLAUDE.md and the proto findings entry

**Status**: `done`
**Service**: `docs/`, `packages/otel/dashboards/README.md`, `services/xstockstrat-ui/CLAUDE.md`, `packages/proto/docs/`
**Files**:
- `docs/runbooks/sops-secrets.md` — modify
- `docs/patterns/ci-overview.md` — modify
- `docs/setup/grafana-cloud.md` — modify
- `packages/otel/dashboards/README.md` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `packages/proto/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/sops-secrets.md:9`: the `common` row ends "DigitalOcean and homelab (OTEL: DO only)". The "Homelab enablement" checklist is at `:138-149`.
- `docs/patterns/ci-overview.md:33` describes the `otel-signals` row. The homelab paragraph is at `:70-78` (`homelab-release-env.sh` "owns the database names, `APPLICATION_ENV` and `TRADING_MODE`" `:75`).
- `docs/setup/grafana-cloud.md:173`: "Resource attributes (`service.name`, `deployment.environment`, `platform`) … — no `OTEL_RESOURCE_ATTRIBUTES` setting required."
- `packages/otel/dashboards/README.md:44-46` lists the resource attributes `service.name`, `deployment.environment`, `platform=xstockstrat`. The guard test `c16-attributes` (`check-otel-produced-signals.test.sh:391-399`) requires those three to stay and `trading_mode` to stay absent.
- `services/xstockstrat-ui/CLAUDE.md:323-324` env list (`OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`).
- Stale comments: `packages/proto/trading/v1/trading.proto:295` `// application_env: "development" | "production".` and `services/xstockstrat-trading/internal/config/config.go:31` `// "development" | "production"`. `packages/proto/docs/context-constitution-findings.md` § "Documentation that lies" is at `:6` (D-11: findings entry only, no proto edit).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `sops-secrets.md:9`: drop "(OTEL: DO only)", since the OTLP keys now serve both targets and stay optional in the resolver. In the Homelab enablement checklist (`:138-149`), add that both `common.OTEL_EXPORTER_OTLP_ENDPOINT` and `common.OTEL_EXPORTER_OTLP_HEADERS` must be non-empty in **both** SOPS files, or else fall back to the `DEV_`/`PROD_OTEL_EXPORTER_OTLP_*` repo secrets (`sops_secrets.py:163-182`, per key). Otherwise every homelab render fails at the named variable. Name the narrow `sops set` route (not a forced bootstrap, which re-seeds `common` and `digitalocean`). Note that the token persists in the VM release `.env` and `docker inspect` output (same class as `JWT_SECRET`) and is shared by homelab staging and DO dev.
2. `ci-overview.md`: `:33` mentions the Part 6 query-block check and the homelab-compose deploy-spec scan. `:75` says the compose file fixes `OTEL_ENABLED: "true"` and `HOST_PROVIDER: homelab` as literals and requires the two OTLP keys, which come from SOPS. It also says staging renders `APPLICATION_ENV=staging`.
3. `grafana-cloud.md:173`: add `host.provider` to the list and replace the trailing clause with "do not set `OTEL_RESOURCE_ATTRIBUTES`; see `docs/patterns/observability.md`".
4. `packages/otel/dashboards/README.md:44-46`: add `host.provider` (`digitalocean` | `homelab` | `unknown`; on `target_info` only, query via the join in `observability.md`). Keep the three existing attributes (EXTEND `@AC-3 @FR-2 @feature-171`). This edits documentation only. Product-spec Out of Scope excludes dashboard/alert *changes* under `packages/otel/dashboards/**`, and `design.md` §5 S9 names this README, so no dashboard JSON is touched (flag for impl-spec review).
5. `services/xstockstrat-ui/CLAUDE.md`: add `HOST_PROVIDER  # resource attribute host.provider (digitalocean|homelab; else unknown)` beside `OTEL_ENABLED` (`:323`).
6. `packages/proto/docs/context-constitution-findings.md` § "Documentation that lies": add a row saying `trading.proto:295` and `trading/internal/config/config.go:31` document `application_env` as `"development" | "production"`, while DO dev and (after feature 332) homelab staging run `staging`. Status **open**; no proto edit.

**Verification**:
```bash
bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh
npx --yes markdownlint-cli2 --config .markdownlint.yaml services/xstockstrat-ui/CLAUDE.md
! grep -n "OTEL: DO only" docs/runbooks/sops-secrets.md
grep -n "host.provider" docs/setup/grafana-cloud.md packages/otel/dashboards/README.md
! git diff --name-only -- packages/proto | grep -v '^packages/proto/docs/context-constitution-findings.md$' | grep .   # no proto/codegen edit
./scripts/check-context-map.sh   # docs/** context map stays consistent
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 11–12 — shellcheck baseline (2026-11-11, /sdd-execute)

- **Expected**: `shellcheck scripts/homelab-render.test.sh` exits 0.
- **Found**: on this host (shellcheck 0.9.0) the file already exits 1 on the pre-feature tree. Three `SC2015` *info* findings sit on lines this feature does not touch (the case-6 `[ ! -e … ] && [ ! -e … ] || fail` and case-7 `[ -n "$out" ] && … || fail` lines).
- **Disposition**: the pre-existing lines are untouched (behaviour 3). The new lines add no finding: `shellcheck -S warning` is clean on all three scripts, `shellcheck scripts/homelab-release-env.sh` exits 0, and `shfmt -d -i 2` is clean. The CI `shell-lint` job's apt shellcheck version decides whether the infos gate there; this feature does not change that.

### Spec-time notes (pre-execution, confirmed by `/sdd-review impl-spec` iteration 1, 2026-11-11)

- **CI path filter (Step 15 Instruction 5):** adds `docker-compose.yml` and `deploy/homelab/compose.yml` to the `otel-signals` filter in `.github/workflows/ci.yml`; not in `design.md`. Accepted: without it a compose-only PR skips the AC-22/AC-23 scan (C-10).
- **SOPS test case number (Step 10):** design S5 says "case 17"; cases 14–18 already exist (feature 302), so the new case is 19. Accepted.
- **Dashboards README (Step 17 Instruction 4):** product-spec Out of Scope excludes edits under `packages/otel/dashboards/**`; this step changes README prose only (adds `host.provider` to the attribute list) and touches no dashboard JSON. Accepted; `design.md` §5 S9 names the README.
- **Node child-process env (Step 6 Instruction 2):** `runChild` gains an optional trailing `extraEnv` in the ledger and config export tests only; requests are attributed to the child by resource `process.pid`. Accepted as minimal and test-local.
- **AC-21 escalation (Step 4 Instruction 2):** if the Python SDK exports no `service.instance.id`, `/sdd-execute` stops and escalates instead of dropping AC-21 (C-15 append-only IDs). Accepted; stricter than design.md's "else drop".
