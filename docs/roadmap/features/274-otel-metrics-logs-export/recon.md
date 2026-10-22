# Recon: otel-metrics-logs-export

**Created**: 2026-10-21
**From**: product-spec.md (plus operator steer: "use 250 as base design")
**Affected services**: xstockstrat-trading, -portfolio, -marketdata (Go); -indicators, -ingest, -analysis, -agent
(Python); -ledger, -identity, -notify, -config (Node); -ui (Next.js); packages/otel (non-service)

---

## Objective

Each of the 12 runtimes gets a MeterProvider and a LoggerProvider. Both export over env-only OTLP/HTTP, next to
the existing traces. The 10 gRPC backends emit `rpc_server_duration_milliseconds_{count,bucket}`. Each runtime's
logger is bridged to OTLP logs, and its stdout output is unchanged. The feature then restores the alerts and
dashboards that feature 250 removes. It builds on 250's landed end state (operator steer), including 250's
produced-signals guard. That guard needs a new "produced path" mechanism so restored rules can pass it.

## Codebase Map

- **Go: trading, portfolio, marketdata.** The three `internal/telemetry/otel.go#Init` copies are identical except
  for the `SERVICE_NAME` default (`otel.go:48`). Each has a gate at `:19-21` and an `otlptracehttp.New(ctx,
  WithTimeout(5s))` exporter at `:23-24`. `sdktrace.NewTracerProvider` + `otel.SetTracerProvider` is at `:34-38`,
  `newResource` at `:45-57`, and `Init` returns `tp.Shutdown` (`:40`).
  - `cmd/server/main.go`:
    - slog JSON setup with `slog.SetDefault`: trading `:31-32`, portfolio `:28-29`, marketdata `:35-36`.
    - `Init` call: trading `:37-46`.
    - Deferred shutdown with a 5s context, and a SIGTERM `GracefulStop`: trading `:148-155`.
    - `os.Exit(1)` paths skip the deferred shutdown (trading `:157-160`).
  - gRPC server: `grpc.StatsHandler(otelgrpc.NewServerHandler())` (trading `main.go:133-142`, portfolio `:84-93`,
    marketdata `:177-186`).
  - `go.mod`: `otelgrpc v0.52.0`, `otel`/`sdk`/`otlptracehttp v1.45.0` (`:11-14`). `otel/metric` is indirect.
  - Logging: about 233 slog call sites, of which only 14 are `*Context`, all in marketdata. No other loggers.
  - Tests: `internal/telemetry/otel_test.go` has `TestInitExportsOverOTLPHTTP` (`:72`, an httptest receiver on
    `/otlp/v1/traces`) and `TestInitLogsExportFailure` (`:93`, captures stdlib `log`).
- **Python: indicators, ingest, analysis, agent.** `app/telemetry.py#init_telemetry` (`:27`; agent `:31`) has the
  gate at `:29`. It builds `OTLPSpanExporter()` with no arguments (`:43-44`), adds a `BatchSpanProcessor`, and calls
  `trace.set_tracer_provider` (`:45-47`).
  - Instrumentation: `GrpcAioInstrumentorServer().instrument()` (`:49`). The agent uses the Client variant
    (`agent/app/telemetry.py:53`).
  - `_build_resource` is at `:13` (agent `:17`).
  - No shutdown or flush exists anywhere in `app/`. The signal handlers use `signal.signal` + `create_task`:
    indicators `main.py:87-93`, ingest `:132-140`, analysis `:119-123`, agent through uvicorn (`main.py:238-246`).
  - `logging.basicConfig` runs at import, before init: indicators `main.py:28-31`, ingest `:28`, analysis `:24`,
    agent `:42`.
  - Pins:

    | Service | OTel SDK pin | instrumentation-grpc pin |
    |---|---|---|
    | indicators, analysis, agent | 1.42.1 | 0.63b1 |
    | ingest | 1.41.1 (lags the others) | 0.62b1 |

  - Tests: `tests/test_telemetry.py` (`:56` export test, `:67` failure test). `tests/conftest.py#otel_reset` resets
    only the tracer provider (analysis `:434-449`).
  - Existing metric: analysis `app/engine/live_loop.py:75-78` creates the counter `analysis.live_loop.truncated_pairs`
    at import. It is a no-op today.
- **Node: ledger, identity, notify, config.** `src/telemetry.ts#initTelemetry` (ledger `:29` gate) uses lazy
  requires (`:33-37`) and installs `diag` at WARN (`:43-45`).
  - `NodeSDK` is built with `traceExporter: new OTLPTraceExporter()`, sync `resourceDetectors`, and `[new
    GrpcInstrumentation()]` (`:47-53`).
  - There is no `metricReader` or `logRecordProcessor`. Shutdown is a SIGTERM handler that is not awaited (`:58`).
  - `buildResource()` uses the 1.x `Resource` (`:20-26`).
  - `src/index.ts:1-2` initialises telemetry before `@grpc/grpc-js` (`:4`).
  - Logger: `src/services/logger.ts#getLogger` (identical in all four) calls `createLogger({ ..., transports: [new
    transports.Console()] })`, with a JSON format in production (`:10-19`).
  - Test runners: ledger and identity use `node --experimental-strip-types --test`. notify and config use
    `tsc && node --test dist/...`.
  - Tests: `telemetry.export.test.ts` (an in-process receiver on `/v1/traces`).
- **Next.js: ui.** `src/telemetry.ts` uses `sdk-node@0.218`, 2.x `resourceFromAttributes`, `metricReaders: []`,
  `logRecordProcessors: []` and `instrumentations: []` (`:23-33`).
  - Startup log: `"[otel] tracing enabled →"` (`:37`).
  - The hook is `src/instrumentation.ts:1-6`, guarded to `NEXT_RUNTIME === 'nodejs'`.
  - No logger module exists. Server code calls `console.*` directly (e.g. `app/api/auth/login/route.ts:33`).
  - Tests: vitest (`vitest.config.ts:19`, node env), `src/instrumentation.test.ts`.
- **packages/otel.** The collector already has a `metrics:` pipeline (`otel-collector-config.yaml:79-82`) and a
  `logs:` pipeline (`:84-87`), both on OTLP `:4318` → `otlphttp/grafana`.
  - Pre-250 assets: `alert-rules.yaml` rules `:26`, `:71` and `:116`. Their exprs are at `:44-45`, `:88` and `:134`.
  - Mute timing: `mute-timings.yaml:18`.
  - Four dashboards, with PromQL and LogQL using the labels `service_name`, `rpc_grpc_status_code`, `rpc_method`,
    `platform` and `level`.

## SDK capability probe (pinned versions, 2026-10-21)

Following the 226 insight (`insights.md:3601-3604`), I checked the pinned SDK sources directly rather than trusting
docs:

- **Go `otelgrpc` v0.52.0** records `rpc.server.duration` as a Float64Histogram with unit `ms`
  (`otelgrpc@v0.52.0/config.go:87-89`), on the global MeterProvider. Installing a MeterProvider is enough to make
  Go produce the alert series.
- **Python `opentelemetry-instrumentation-grpc` 0.63b1** has no meter or histogram code (grep `meter|create_histogram`
  returned nothing). Python produces no RPC metric even with a MeterProvider installed.
- **Node `@opentelemetry/instrumentation-grpc` 0.52.1** has no `createHistogram` or `getMeter`. Node also produces
  no RPC metric.
- **Already present:**
  - Python: the SDK ships `opentelemetry.sdk._logs` and `opentelemetry.sdk.metrics`, and
    `exporter.otlp.proto.http` ships `metric_exporter` and `_log_exporter`. No new Python package is needed.
  - Node 0.52 line: `sdk-metrics@1.25.1` and `sdk-logs@0.52.1` are in the lock only as transitive dependencies.
    `exporter-{metrics,logs}-otlp-http@0.52` are absent.
  - UI 0.218 line: `exporter-{metrics,logs}-otlp-http@0.218.0` are in the lock (`pnpm-lock.yaml:1539,1557`).
  - Go: no `otlpmetrichttp`, `otlploghttp`, `sdk/log` or `otelslog` in any `go.mod`. `sdk/metric` is in `go.sum` only.

## Patterns to REUSE

- **Exporter construction.** Use env-only exporters and never pass an endpoint, url or insecure argument
  (PLAT-3, `otel.go:23-24`, `app/telemetry.py:43-44`, `ledger/src/telemetry.ts:47-53`). Apply the same rule to the
  metric and log exporters.
- **Resource.** Reuse each runtime's existing resource builder for all three providers: Go `newResource`, Python
  `_build_resource`, Node `buildResource`, UI inline. This keeps `@AC-1 @feature-171`.
- **Gate and non-fatal init.** Keep the existing `OTEL_ENABLED` check and try/except or catch-and-warn in each module.
- **Export tests.** Use the fake-receiver pattern and extend it with `/v1/metrics` and `/v1/logs`, keeping the
  `/otlp` prefix and both header forms of `@AC-1 @feature-226`:
  - Go: `otel_test.go#exportOneSpan` (`:53-68`).
  - Python: `test_telemetry.py#_start_receiver` (`:21`).
  - Node: `telemetry.export.test.ts`.
  - UI: `instrumentation.test.ts`.
- **Python test isolation.** Extend the `otel_reset` conftest fixture to also reset the meter and logger providers.
  Verify the private set-once attribute names against SDK 1.42.1.
- **Single log seam per language.** Bridge at the one place each language builds its logger:
  - Go: `slog.SetDefault` in `main.go`.
  - Python: the root logger after `basicConfig`.
  - Node: `getLogger` in `src/services/logger.ts`.
- **Go RPC metric.** The existing `otelgrpc.NewServerHandler()` stats handler already emits the metric, so no Go
  server change is needed beyond the MeterProvider.
- **Feature 250's guard.** Extend `scripts/check-otel-produced-signals.sh`, its `.test.sh` and the `otel-signals`
  CI job rather than writing a new check. The design is in 250 `design.md:98-206`, and the files exist only after
  250 executes.
- **Feature 250's fence and wording rules.** Reuse the removed-assets fence (`<!-- otel-guard:removed-assets -->`)
  and the "no removed count in prose" rule (250 `design.md:94-96,133-139`).

## Existing Business Rules (preserve / extend)

These come from the `scenario-recon` digest. No rule is changed.

**Telemetry and OTLP export**
- **PRESERVE** `@AC-1 @FR-1 @feature-171` "A telemetry module's built Resource no longer carries the trading_mode
  attribute" (`docs/sdd/business-rules/platform.feature`). All three providers share the one Resource. The
  scenario's Examples omit `ui`, and 274 extends that coverage to `ui`.
- **EXTEND** `@AC-2 @FR-3 @feature-171` "Telemetry init remains non-blocking…" (platform.feature). The new
  meter/logger init and exporter-failure paths stay non-fatal (274 AC-6, AC-12).
- **PRESERVE** `@AC-3 @FR-2 @feature-171`: the dashboards README attribute list, with no `trading_mode`.
- **PRESERVE + EXTEND** `@AC-1 @FR-1 @feature-226` "exports traces over OTLP/HTTP to a path-prefixed gateway URL"
  (platform.feature). `/v1/metrics` and `/v1/logs` must honour the `/otlp` base path and both header forms. Today
  274's ACs test only the unprefixed endpoint.
- **EXTEND** `@AC-3 @FR-3 @feature-226` "A failed trace export is visible in service logs". Metric and log export
  failures are also visible, without re-entering the OTLP log pipeline.
- **PRESERVE** `@AC-4 @FR-4 @feature-226`: one `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` for all
  signals, with no per-signal env var.
- **PRESERVE** `@AC-2 @FR-2 @feature-226` (`services/xstockstrat-ui/acceptance/fix-otel-trace-export.feature`): the
  `"[otel] tracing enabled"` string, `/otlp/v1/traces`, and the `src/` hook with its nodejs guard.

**UI build, mTLS and header propagation**
- **PRESERVE** `@AC-6 @FR-1 @FR-7 @feature-128` (ui-middleware-nodejs-runtime.feature): adding OTel
  metrics/logs packages must not break the standalone build.
- **PRESERVE** `@AC-5 @FR-5 @feature-210` (header propagation beneath mTLS) and `@AC-4 @FR-4 @feature-210` (mTLS
  fail-closed): metric hooks must not reorder interceptors or alter creds.

**Secret and credential redaction**
- **EXTEND** `@AC-35 @FR-14 @feature-224 @feature-225` and `@AC-4 @FR-3 @feature-147` (GetSecret). The OTLP log
  bridge is a new egress edge for secret plaintext, which 274 AC-7 covers.
- **PRESERVE** feature 147 redaction at `WatchConfig`, `GetConfig` and `ListKeys` and in per-user overlays (`@AC-2`,
  `@AC-3`, `@AC-14`), plus marketdata's placeholder WARN (`@AC-7`).
- **PRESERVE** identity `@AC-10 @FR-10 @feature-043` "Passwords are never returned or displayed". It already covers
  "log line", so exported records fall under it; 274 AC-13 is the concrete test.
- **PRESERVE** ingest `@AC-2 @FR-2 @feature-166` (bearer redaction) and agent `@AC-1`/`@AC-4 @feature-164`
  (`credentials_json`).
- **PRESERVE** agent `@AC-1 @feature-183` (`manage_user` password) and `@AC-7 @feature-207` (SSRF block recorded).

**Stdout log lines that must stay as they are**
- **PRESERVE** notify `@AC-6 @FR-6 @feature-020` (fanout WARN text), agent `@AC-4 @FR-3 @feature-127` (WARN with
  gRPC code), and analysis `@AC-5 @FR-6 @feature-215` (refusal log line).

**Gaps**
- No durable rule covers Grafana alert rules, dashboards or mute timings. Feature 250's removals and this feature's
  restorations are guarded only by the guard script and 274 AC-8/AC-14.

## Dependencies

- Proto/RPC: none.
- Migration: none.
- Config keys: none. No WatchConfig key is added (product-spec Out of Scope).
- Inter-service edges: unchanged.
- New env vars or ports: none required. `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT` and `_HEADERS` are already
  set as follows:
  - compose: `docker-compose.yml:18` (anchor), with one `OTEL_EXPORTER_OTLP_ENDPOINT` line per service at
    `:133,…,568`.
  - DO: global `envs:` in `.do/app.yaml:25-38` (prod `OTEL_ENABLED="false"`) and `.do/app.dev.yaml:25-38` (dev
    `"true"`).
  - The SDK may read the optional `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_BLRP_*` and `OTEL_METRICS_EXEMPLAR_FILTER`.
    None is set anywhere today.
- New packages:
  - Go: `otel/sdk/metric`, `otlpmetric/otlpmetrichttp`, `otel/log`, `otel/sdk/log`, `otlplog/otlploghttp`, and
    `contrib/bridges/otelslog`, in all three `go.mod`.
  - Node 0.52 line: `exporter-metrics-otlp-http@0.52`, `exporter-logs-otlp-http@0.52`, and a winston bridge.
    `@opentelemetry/winston-transport` / `instrumentation-winston` are absent from the lock.
  - UI: possibly none (0.218 exporters are transitive). They must be declared, not relied on transitively.
  - Python: none. `uv lock` is still required if any constraint changes, and the ingest lock lags.
- Feature dependency: feature 250 must be executed and merged first (`merge-order.md`). On trunk today, 250's
  guard, `.test.sh`, fixtures, `otel-signals` job and `trace-derived-alerting` story do not exist.

## Risks / Not-found

- **R1. Python and Node emit no `rpc.server.duration` (probe).**
  - It is 7 of the 10 backends. A custom server-side recorder is needed in Python (grpc.aio interceptor) and Node
    (grpc-js server wrapper or span-derived), with identical name, unit (`ms`) and attributes (`rpc.service`,
    `rpc.method`, `rpc.grpc.status_code`) to Go `otelgrpc` v0.52.
  - Parity of attribute keys and status-code encoding across three implementations is the core correctness risk.
- **R2. Grafana Cloud label promotion is unverified in the repo.**
  - Alerts query the Prometheus label `service_name`. The only evidence that Grafana Cloud promotes `service.name`
    to that label is a README claim (`packages/otel/dashboards/README.md:42`).
  - Grafana Cloud's OTLP→Prometheus translation commonly puts `service.name` in `job` and `target_info`.
  - This must be proven on dev (`OTEL_ENABLED="true"`) before alerts are restored as written. A dev-import gate is
    needed, like 250's.
- **R3. Scoring-stall rule cannot be restored as written.**
  - The regex `ScoreStrategy|RunBacktest` matches no analysis log line. The real line is `"running backtest
    id=%s…"` at `servicer.py:799-800`.
  - `RunBacktest`/`ScoreStrategy` are client-invoked (`analysis.proto:13-14`), so silence is not a stall (250
    `design.md` §6).
  - A re-derived signal could be RPC count from the new histogram, a background-loop log line, or a counter.
- **R4. Go log/trace correlation is near-zero.** Only 14 of about 233 slog calls carry a ctx. FR-3's "record inside
  a span carries trace_id" holds only for `*Context` calls. Retro-fitting ctx is out of minimal scope.
- **R5. Shutdown flush gaps.** Go `os.Exit(1)` paths skip defer. Python has no flush seam at all. Node SIGTERM
  shutdown is not awaited. AC-12 (flush on SIGTERM) needs a new seam in Python and an awaited one in Node.
- **R6. Log-export recursion.** The OTel SDK error and diag output goes to stdlib `log` (Go,
  `TestInitLogsExportFailure`), Python `logging`, and `console` (Node `diag`).
  - A Python root-logger bridge would capture the `opentelemetry.*` loggers and recurse. They must be excluded.
- **R7. Two Node OTel majors.** The Node services are on 0.52 / resources 1.x and the UI on 0.218 / resources 2.x,
  so a shared Node helper cannot span both lines. The UI has no logger: capturing `console.*` means a monkey-patch
  or a new logger module.
- **R8. Secret egress on the new log edge.** No logger has a redaction layer.
  - Python interpolates exception text widely.
  - notify `fanout.ts` and `webPush.ts` hold the Slack, SendGrid and VAPID secrets and were not audited.
  - identity logs `{ email }` (`identityServiceImpl.ts:151-154`).
  - These are PII and secret-exposure points that an exported log store widens beyond stdout.
- **R9. Cardinality and cost.**
  - `rpc.method` × status × 10 services × 2 envs.
  - Go `otelgrpc` also emits request/response size and per-RPC count histograms (`config.go:97-110`) that the
    alerts do not need.
  - Default metric export is 60s, and the log volume is unknown.
  - Prod stays `OTEL_ENABLED="false"`, so the flip is a separate rollout step (product-spec).
- **R10. Feature 250's guard has no produced-path mechanism.**
  - Part 1 is a flat denylist (`prometheus|loki|rpc_server_duration|service_name=`…), and P3-count expects 0 rules.
  - 274 must design how a produced series or stream is recorded so restored rules pass. 250 only notes "relax
    Part 1 and P3-count".
- **R11. Feature 250's `trace-derived-alerting` follow-up story.**
  - 250's test asserts that 4 citation sites match `[0-9]{3}-trace-derived-alerting/`.
  - Once 274 restores the alerts, those citations and the story's premise go stale.
  - Whether 274 retargets or supersedes that story is an open decision (product-spec "Deferred to /sdd-design").
- **R12. Analysis live_loop counter.** It is created before `init_telemetry()` (`live_loop.py:75-78`). Whether the
  API proxy meter re-binds after `set_meter_provider` is unverified. It becomes a produced series once a provider
  exists.
- **Ledger traps:**
  - fails `2026-08-06` (re-read 250's landed state, not the spec).
  - fails `2026-09-09 171` (Node dual runners, ESM `require`).
  - fails `2026-10-15 226` (vitest spy history).
  - insights `3606-3609` (JS diag spy before OTel load; the BSP timer path, not flush).
- **Not found:**
  - 250's branch `acceptance.feature` (the working-tree copy is stale per 250 `design.md:5-6`).
  - Any `NNN-trace-derived-alerting` dir.
  - The UI logger module.
  - Any log redaction layer.
  - Any Python telemetry flush.
  - Grafana Cloud label-promotion evidence beyond the README claim.

## Recommended Scope

These are advisory boundaries, not binding:

1. **Go (×3).** Add MeterProvider + LoggerProvider + otelslog bridge into `Init`, and return a combined shutdown.
   Tests extend `otel_test.go`.
2. **Python (×4).** Add providers, a `LoggingHandler` that excludes `opentelemetry.*`, a gRPC server-duration
   interceptor (×3 backends), and a flush on shutdown. Tests extend `test_telemetry.py` and `otel_reset`.
3. **Node (×4).** Add a metric reader + log processor, a winston OTLP transport, a gRPC server-duration recorder,
   and an awaited shutdown. Bump the 0.52 exporters.
4. **UI.** Add a metric reader + log processor, and decide on the console capture (R7).
5. **Dev verification gate.** Prove the series and label names in Grafana Cloud dev (R2) before any asset is
   restored.
6. **packages/otel.** Restore the rules and dashboards on proven series; re-derive the scoring stall (R3).
7. **Guard.** Add the produced-path mechanism to 250's guard and test (R10).
8. **Docs, constitution and follow-up story reconciliation (FR-7, R11).**
