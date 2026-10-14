# Recon: fix-otel-trace-export

**Created**: 2026-10-14
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-agent, xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify, xstockstrat-config, xstockstrat-ui

---

## Objective

No service exports traces to the Grafana Cloud OTLP gateway: Go/Python/Node backends use gRPC
exporters with explicit endpoint options, and the UI's instrumentation hook is never registered. Move
every runtime to an OTLP/HTTP trace exporter configured only by the OTel spec env vars, register the
UI hook, make export failures visible in logs, and align compose/collector/docs to one OTLP/HTTP path.

## Codebase Map

- **Go — `xstockstrat-{trading,portfolio,marketdata}`** (three copies, identical except default service name `otel.go:56`)
  - `Init` — `internal/telemetry/otel.go:17-49`: gate `:19`; fallback endpoint `"otel-collector:4317"` `:23-26`; `otlptracegrpc.New(ctx, WithEndpoint(endpoint), WithInsecure(), WithTimeout(5s))` `:28-32`; `sdktrace.WithBatcher(exp)` + `otel.SetTracerProvider` `:42-48`
  - `newResource` — `otel.go:53-65` (service.name, deployment.environment, platform)
  - Test — `internal/telemetry/otel_test.go:11` `TestNewResourceOmitsTradingMode` (only test; `t.Setenv`; never exercises `Init`)
  - Call site — `cmd/server/main.go` (trading `:37-46`, portfolio `:34-43`, marketdata `:41-50`): Init error → `slog.Warn`, non-fatal; deferred 5 s shutdown
  - Logger — `main.go` (trading `:31-32` …): `slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))`; OTel's default global error handler logs via stdlib `log` → slog (observed live as `"traces export: …"` at INFO). No `otel.SetErrorHandler` anywhere.
  - Deps — `go.mod:12-14`: otel / sdk / otlptracegrpc `v1.45.0`; `otlptrace v1.45.0 // indirect`; no `otlptracehttp` in any go.mod/go.sum/go.work.sum; no vendor/
- **Python — `xstockstrat-{indicators,ingest,analysis,agent}`** (four copies, identical except default service name and instrumentor; agent offsets +4)
  - `init_telemetry` — `app/telemetry.py:27-53`: gate `:29`; deferred import `opentelemetry.exporter.otlp.proto.grpc.trace_exporter.OTLPSpanExporter` `:34`; fallback endpoint `"otel-collector:4317"` `:39`; `OTLPSpanExporter(endpoint=endpoint, insecure=True)` `:43`; `BatchSpanProcessor` `:45`; `GrpcAioInstrumentorServer().instrument()` `:48` (agent: `GrpcAioInstrumentorClient` `:52`); success log with `endpoint` extra `:50`; broad except → `log.warning` `:52-53`
  - `_build_resource` — `app/telemetry.py:13-24`
  - Tests — `tests/test_telemetry.py:4-12` `test_build_resource_omits_trading_mode` (all four); agent only `:15-29` `test_init_telemetry_non_blocking_on_error`, patch target hard-coded `"opentelemetry.exporter.otlp.proto.grpc.trace_exporter.OTLPSpanExporter"` `:24`
  - Logging — `logging.basicConfig(level=INFO, …)` (ingest `app/main.py:28`, analysis `:24`, agent `:42`, indicators `:28-31`), root handler on stderr; no per-logger suppression → exporter WARNING/ERROR records surface
  - Deps — pyproject `opentelemetry-exporter-otlp-proto-grpc>=1.25.0` (indicators `:12-14`, ingest `:15-17`, analysis `:15-17`, agent `:14-16`); locked sdk 1.42.1 (indicators/analysis/agent), 1.41.1 (ingest `uv.lock:888-889`); `opentelemetry-exporter-otlp-proto-http` and `requests` absent from every lock
- **Node — `xstockstrat-{ledger,identity,notify,config}`** (four copies, identical except default service name)
  - `initTelemetry` — `src/telemetry.ts` (ledger `:23-49`): lazy `require('@opentelemetry/exporter-trace-otlp-grpc')` `:30`; fallback `'grpc://otel-collector:4317'` `:34`; `new OTLPTraceExporter({ url: endpoint })` `:39`; `GrpcInstrumentation` `:40`; log `:44`; SIGTERM shutdown; catch → `console.warn` `:48`. No `diag` usage anywhere.
  - `buildResource` — ledger `:15-21` (static ESM imports `:1-5`)
  - Tests — `src/__tests__/telemetry.test.ts` (resource-only). **Two runners**: ledger/identity `node --experimental-strip-types --test src/__tests__/*.test.ts`, import `'../telemetry.ts'`, tsconfig excludes tests (`tsconfig.json:22`); notify/config `tsc && node --test dist/__tests__/*.test.js`, import `'../telemetry'`, tsconfig compiles tests (`:15`)
  - Call site — `src/index.ts:1-2` (before `@grpc/grpc-js` import `:4`)
  - Deps — package.json (ledger `:25-29`): `exporter-trace-otlp-grpc`, `instrumentation-grpc`, `sdk-node` `^0.52.0`; `resources`/`semantic-conventions` `^1.25.0`; no direct `@opentelemetry/api`. Root `pnpm-lock.yaml` already contains `exporter-trace-otlp-http@0.52.1` (`:1578`, transitive via sdk-node `:7606`) and `api@1.9.1` (`:1478`, sole version). Docker uses `pnpm install --frozen-lockfile` (`Dockerfile:13,17`) → root lock must be updated.
  - Coverage gate is `c8 --lines 40` inside `test:coverage` (ledger `package.json:13-14`), CI `ci.yml:578`
- **Next.js — `xstockstrat-ui`**
  - Hook — `instrumentation.ts:1-6` at **service root** (guarded by `NEXT_RUNTIME === 'nodejs'`, dynamic `import('./src/telemetry')`); app uses `src/` (`src/app/`, `src/middleware.ts`); no `src/instrumentation.ts` exists
  - `initTelemetry` — `src/telemetry.ts:1-34`: lazy requires `:6-12`; fallback `'http://otel-collector:4318'` `:14`; `new OTLPTraceExporter({ url: endpoint })` `:23` (verbatim URL, no `/v1/traces`); `instrumentations: []` `:24`; log `:28`; catch `:32`
  - `next.config.js:7` standalone; `serverExternalPackages` includes sdk-node + exporter-trace-otlp-http `:12-13`
  - Deps `package.json:31-34`: `exporter-trace-otlp-http`/`sdk-node ^0.218.0`, `resources ^2.7.1`; no direct `@opentelemetry/api`
  - Vitest `vitest.config.ts:19-33`: node env, `include: ['src/**/*.test.ts']`, coverage scoped to `src/lib/**` (telemetry outside it)
  - `CLAUDE.md:288-290,345,399` cite `src/telemetry.ts`, never the hook
- **Shared config / docs**
  - `docker-compose.yml`: endpoint `:4318` for config `:133`, ledger `:166`, identity `:200`, notify `:235`, ui `:515`; `http://otel-collector:4317` for marketdata `:283`, indicators `:316`, ingest `:354`, analysis `:395`, portfolio `:433`, trading `:469`, agent `:568`; collector header env `:62-63`; services' `env_file` (`.env.local`) carries no `OTEL_*`
  - `packages/otel/otel-collector-config.yaml:7-8` (port split comment), receivers `:31,:33`, exporter header `:56`
  - `.github/workflows/deploy.yml:158-165`: OTEL values substituted via Python `str.replace` (safe for `%`/`=`); `:162-163` prepends `Authorization=` when missing. Same logic `scripts/do-inject-prod-secrets.py:52,73-75`
  - `.env.example:79-87` documents both header forms

## Patterns to REUSE

- Env-driven OTLP/HTTP exporter → the SDKs' **own** spec env handling (`OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/traces`, `OTEL_EXPORTER_OTLP_HEADERS`). Verified empirically at the exact pinned versions (Go 1.45.0, Python 1.42.1, Node 0.52.1 and 0.218.0): constructing the exporter with **no** endpoint/url argument POSTs to `<endpoint>/v1/traces` and sends `Authorization` from both `Authorization=Basic <tok>` and `Authorization=Basic%20<tok-%3D>`. No custom URL/header code needed.
- Node HTTP exporter → already-locked `@opentelemetry/exporter-trace-otlp-http@0.52.1` (root `pnpm-lock.yaml:1578`), matching the `sdk-node@0.52.1` line — no new transitive tree.
- Node `diag` → already-locked `@opentelemetry/api@1.9.1` (`pnpm-lock.yaml:1478`), the sdk's peer.
- Header formatting → existing `deploy.yml:162-163` `Authorization=` prefixing; no new deploy logic.
- Test env → Go `t.Setenv` (`otel_test.go`), Python `monkeypatch` (`tests/test_telemetry.py`), Node per-runner import style (`'../telemetry.ts'` vs `'../telemetry'`). Fixture home per C-13: Python `tests/conftest.py` (no domain data needed — env strings only).
- Existing non-blocking-init test pattern → agent `tests/test_telemetry.py:15-29` (repoint to the http module).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @FR-1 @feature-171` "A telemetry module's built Resource no longer carries the trading_mode attribute" (`docs/sdd/business-rules/platform.feature`) — resource builders untouched; still emit service.name / deployment.environment / platform, never trading_mode. (EXTEND-candidate: ui absent from the Examples table `platform.feature:123-135`.)
- **PRESERVE** `@AC-2 @FR-3 @feature-171` "Telemetry init remains non-blocking…" (`platform.feature`) — new exporter + failure logging must not raise or block startup (incl. the ui hook).
- **PRESERVE** `@AC-3 @FR-2 @feature-171` "The dashboards README documents the emitted attribute set…" (`platform.feature`) — doc edits must not alter `packages/otel/dashboards/README.md` attribute list.
- **PRESERVE** `@AC-4 @FR-4 @feature-210` "mTLS is enforced identically in every environment…" (`platform.feature`) — scoped to inter-service gRPC; the OTLP sink is not an inter-service hop. Telemetry init must not reorder the fail-closed `MTLS_*` check.
- **PRESERVE** `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (`platform.feature`) — no new auto-instrumentation; existing instrumentors unchanged.
- **PRESERVE** `@AC-3 @feature-179` (`services/xstockstrat-ui/acceptance/ui-resume-halted-account.feature`) — BFF `x-trace-id` unaffected.
- **PRESERVE** `@AC-1`, `@AC-6 @feature-128` (`services/xstockstrat-ui/acceptance/ui-middleware-nodejs-runtime.feature`) — moving the hook into `src/` must keep the `NEXT_RUNTIME === 'nodejs'` dynamic-import guard so the standalone build has no Edge bundling error; middleware untouched.
- **PRESERVE** `@AC-7 @feature-207` (`services/xstockstrat-agent/acceptance/extract-tool-ssrf-hardening.feature`) — agent audit/telemetry recording of SSRF blocks survives the exporter swap.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none (`platform.otel.enabled` untouched)
- Inter-service edges: none
- Env vars / ports: no new vars. `OTEL_EXPORTER_OTLP_ENDPOINT` value changes to `http://otel-collector:4318` for 7 compose services. No change to `.do/app*.yaml`.
- Packages: Go `otlptracehttp v1.45.0` (+ drop `otlptracegrpc` if unused) ×3 go.mod/go.sum; Python `opentelemetry-exporter-otlp-proto-http` (drop `-proto-grpc` if unused) ×4 pyproject + `uv lock`; Node `@opentelemetry/exporter-trace-otlp-http ^0.52.0` + `@opentelemetry/api` (drop `exporter-trace-otlp-grpc`) ×4 + root `pnpm-lock.yaml`; UI `@opentelemetry/api` (if diag added)

## Risks / Not-found

- **Header-format premise corrected.** `deploy.yml:162-163` prefixes `Authorization=`, so a secret stored as `Basic <token>` becomes `Authorization=Basic <token>` — parsed correctly by every SDK (empirical probe). The defect report's claim that the documented value "yields no Authorization header" is wrong for deployed envs; the operator likely needs **no** secret change. Docs must state this accurately.
- `fails.md` 2026-09-09 (171): two Node test runners — new Node tests must use the per-service import style, and both test run **and** `tsc` build must be verified per service.
- Go: removing `otlptracegrpc` may let `go mod tidy` drop `google.golang.org/grpc`-adjacent indirect deps? No — services are gRPC servers; grpc stays direct. `otelgrpc v0.52.0` is old vs otel v1.45 (pre-existing; out of scope).
- Go `Init` test can't assert export without a receiver — use `httptest.Server`; `telemetry` package is excluded from coverage `-coverpkg` (`ci.yml:256`), so no gate impact either way.
- UI: telemetry sits outside vitest coverage scope (`src/lib/**`) — test still runs (include is `src/**/*.test.ts`), gate unaffected. Hook relocation is only provable by a `next build` (heavy) or a file-location assertion; Next.js convention (src/ dir → `src/instrumentation.ts`) not verified by a build in recon.
- Python: exporter logs go to **stderr** (DO captures both streams — staging logs already show stderr lines). `requests` becomes a new transitive dep of proto-http.
- Ingest's lock is one minor behind (1.41.1); `uv lock` for the new dep may bump it — acceptable but visible in diff.
- Local plaintext `http://otel-collector:4318` vs `@AC-4 @feature-210`: out of that rule's scope (not inter-service gRPC) — adversary to confirm.
- Not found: `src/instrumentation.ts`; any `initTelemetry`/`Init` export test outside agent; `diag` usage; `OTEL_EXPORTER_OTLP_PROTOCOL` anywhere.

## Recommended Scope

1. Go ×3: `otlptracehttp.New(ctx, WithTimeout(5s))`, no endpoint/insecure options, drop fallback; `httptest` regression test (AC-1) + failure-surfaces test (AC-3, via `otel.SetErrorHandler` capture or exporter error); go.mod/go.sum.
2. Python ×4: proto-http `OTLPSpanExporter()`, drop fallback; local `HTTPServer` regression test (AC-1) + caplog failure test (AC-3); repoint agent patch path; pyproject + `uv lock`.
3. Node ×4: `exporter-trace-otlp-http` no-url + `diag.setLogger(DiagConsoleLogger, WARN)`; `node:http` receiver test per runner style; package.json + root lock; `tsc` build check.
4. UI: move hook to `src/instrumentation.ts` (keep runtime guard), no-url exporter + diag; vitest receiver test; hook-location test.
5. Compose (all → `:4318`), collector config comments, `.env.example`, docs (`observability.md`, `grafana-cloud.md`, `digitalocean.md`), PLAT-3 + findings row, defect report correction; context-forge teardown.
