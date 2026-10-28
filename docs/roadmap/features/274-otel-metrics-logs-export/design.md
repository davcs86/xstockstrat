# Design: otel-metrics-logs-export

**Created**: 2026-10-21
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-10-21 (R3 gate, `context.md` § Round 3 checkpoint)
**Grounded in**: recon.md (plus orchestrator probes recorded in `context.md`)

---

## Chosen Approach

274 builds on feature 250's landed end state (operator steer). It ships in five phases, in this order:
**P-0 → PR-A → G1 → re-sync → PR-B**.

The design has no consumer surface: it is internal and platform-only (product-spec C-14 "None"). The operator
consumes it through Grafana Cloud alerts and dashboards in `packages/otel/`.

### P-0: amend feature 250 before it executes

This is a docs-only change on `feature/fix-otel-metrics-logs-gap`. It runs as a prerequisite and is not one of
274's execute steps.

1. **F-09 re-check, immediately before the edit.** `250/status.md` must still read `implementation-ready` and every
   step `**Status**` must still be `pending`. If any step has started, record the change in 250's `## Deviation
   Log` instead of editing the spec.
2. **Retarget the follow-up.** Retire 250's P-1 prerequisite (`trace-derived-alerting` `/sdd-story`) and its
   Step 1 check. Retarget every follow-up citation literal and the `.test.sh` 4-site citation regex (250
   `design.md` §6 / `implementation-spec.md` P-1, Step 10) to `docs/roadmap/features/274-otel-metrics-logs-export/`.
   No `trace-derived-alerting` story is created.
3. **Annotate guard Part 2** as "implement now; scheduled for retirement in 274 PR-B". The executor still
   implements Part 2. Retiring it is the C-16 CHANGE the operator signed off (`context.md` R1 gate). Mirror that
   sign-off into 250's `context.md`, and add a dated amendment block over 250 `design.md` §6.
4. **Re-run `/sdd-review fix-otel-metrics-logs-gap impl-spec`.**
5. **Update the `merge-order.md` row:** 250 → 274 PR-B is hard (file overlap); PR-A follows 250 by operator order.

### PR-A: runtime export (merges to main-dev, deploys to dev with `OTEL_ENABLED="true"`)

**Scope.** PR-A touches no file under `docs/` or `packages/otel/`. 250's guard Part 2 scans those trees, so any
edit there would fail CI. The operator waived the resulting docs under-statement window (R3 gate).

**Teardown.** It covers `services/*/docs/` and the service `CLAUDE.md` files. The PR body records the waiver and
the manual reconciliation actually performed (`fails.md:670`).

Every runtime follows these rules:
- Reuse its existing resource builder and `OTEL_ENABLED` gate (recon § Patterns to REUSE).
- Use **env-only** OTLP/HTTP exporters with no endpoint, url or insecure argument (PLAT-3).
- Keep init non-fatal.
- Extend every `/otlp` export test to `/otlp/v1/metrics` and `/otlp/v1/logs`, under both the raw and
  %-encoded header forms (EXTEND `@AC-1 @feature-226`).

**Go: trading, portfolio, marketdata** (`internal/telemetry/otel.go#Init`, recon Codebase Map)
- **Init.** `Init` installs a TracerProvider, a MeterProvider and a LoggerProvider:
  - Metrics: `sdkmetric.NewMeterProvider` with a `PeriodicReader(otlpmetrichttp.New(ctx))`.
  - Logs: `sdklog.NewLoggerProvider` with a `BatchProcessor(otlploghttp.New(ctx))`.
  - It returns `(shutdown, forceFlush, err)`, where `shutdown` is `errors.Join` of the three provider shutdowns.
- **Views.** Drop every `otelgrpc` instrument except `rpc.server.duration`: request/response size,
  requests/responses-per-RPC, and `rpc.client.*` (`otelgrpc@v0.52.0/config.go:87-110`).
  - `otelgrpc` stays pinned at v0.52.0.
  - A ManualReader test pins the name `rpc.server.duration` and the unit `ms`.
- **Pins.** Use a consistent set with no `otel` bump, verified by the orchestrator probe:
  - `otel`, `sdk`, `sdk/metric` and `otlpmetrichttp` at v1.45.0.
  - `log`, `sdk/log` and `otlploghttp` at v0.21.0.
  - `contrib/bridges/otelslog` at v0.20.0.
  - The latest log modules require `otel` v1.47.0.
- **Logs.** In `main.go`:
  - Call `slog.SetDefault(slog.New(slog.NewMultiHandler(stdoutJSON, otelslog.NewHandler(svc))))`. Go 1.27 provides
    `slog.NewMultiHandler`. Stdout bytes are unchanged.
  - Route `otel.SetErrorHandler` through the stdout-only handler. This is the recursion guard: once `SetDefault`
    runs, stdlib `log` routes into the default slog handler.
  - Update `TestInitLogsExportFailure` (`otel_test.go:93`) to match.
- **Context retrofit (operator decision B).** Move every slog call that has a `ctx` in scope to its `*Context`
  variant.
  - Enforce it with `sloglint`: `context: scope` and `no-mixed-args: false` in all three `.golangci.yml`.
  - golangci-lint v2.14.0 bundles sloglint v0.12.0, and `no-mixed-args` defaults to true, so it must be set
    explicitly.
  - Tests that swap `slog.SetDefault` keep working.
- **Shutdown.** The signal goroutine runs these steps in order:
  1. Bounded `forceFlush` (2 s).
  2. `GracefulStop` with a `Stop()` fallback after **3 s**.
  3. `cancel()`.

  After that, `Serve` returns: grpc-go v1.83.2 waits on `s.done` (`server.go:902-904`). The existing deferred 5 s
  shutdown then flushes the stream-end points. The worst case (about 8 s plus the deferred bound) fits compose's
  10 s default stop grace. Open streams can no longer block the flush (R2 blocker 3).

**Python: indicators, ingest, analysis, agent** (`app/telemetry.py#init_telemetry`)
- **Providers.**
  - `MeterProvider(PeriodicExportingMetricReader(OTLPMetricExporter()))`.
  - `LoggerProvider` with a `BatchLogRecordProcessor(OTLPLogExporter())`.
  - Flushing relies on the providers' default `atexit` shutdown (`sdk/metrics/_internal/__init__.py:475,502-503`).
    There is no explicit second shutdown, and a subprocess SIGTERM test proves the flush.
- **Logs.** Attach the SDK `LoggingHandler` to the root logger after `basicConfig`.
  - A handler filter excludes `opentelemetry.*` loggers (recursion guard).
  - The DeprecationWarning is suppressed only around the constructor (`sdk/_logs/_internal/__init__.py:537-555`).
- **Pins.** All four services pin `opentelemetry-sdk>=1.42.1,<1.43` and `instrumentation-grpc==0.63b1`. This raises
  ingest from 1.41.1/0.62b1. Run `uv lock` in each service.
- **Test isolation.** Extend `tests/conftest.py#otel_reset` to reset the meter and logger providers.
- **RPC recorder** (the 3 gRPC backends). A span-derived recorder in the telemetry module records
  `rpc.server.duration` in ms on `on_end` of SERVER spans with `rpc.system == "grpc"`. Its attributes are exactly
  Go's: `rpc.system`, `rpc.service`, `rpc.method` and an integer `rpc.grpc.status_code`.

  The status is the first matching rule:
  1. A non-zero `rpc.grpc.status_code` attribute is used as-is. `abort` and `set_code` set it before raising
     (`_aio_server.py:29-48`).
  2. Any exception event records 2. This includes a bare `raise Exception`, which `use_span` records
     (`trace/__init__.py:612-619`).
  3. A span status of ERROR records 2.
  4. Otherwise the recorder records 0.
- **Deadline/cancel interceptor (R3 gate).** A small `grpc.aio` server interceptor in the 3 Python backends
  catches `asyncio.CancelledError`.
  - It stamps `rpc.grpc.status_code` 4 when `context.time_remaining() <= 0`, and 1 otherwise, then re-raises.
  - This gives parity with Go on deadline and cancel. The instrumentation catches only `Exception`
    (`_aio_server.py:109-116`).
  - It is added to the existing `interceptors=` list. mTLS creds are untouched (PRESERVE `@AC-4`/`@AC-5
    @feature-210`).
- **Agent metric (operator decision A).** A `ToolMetricsMiddleware` (`ServerMiddleware`, `mcp/server/context.py:146`)
  records `mcp.tool.duration` (ms) with the attributes `{gen_ai.tool.name, outcome}`. The key is reused from
  `mcp/server/_otel.py:31`.
  - `outcome=error` applies to **any** exception reaching the middleware, and to a
    `CallToolResult(is_error=True)`/`{"isError": true}` result (`_otel.py:56-71`).
  - The tool-name set is read once from `await server.list_tools()` and cached. An unknown name records as
    `unregistered`. No count is hard-coded (ledger 2026-10-14).
  - It is appended in `create_server` after `register_tools`/`register_prompts`.
- **Heartbeat.** Analysis logs `log.info("live_loop: cycle complete")` after each successful `_run_cycle()`
  (`live_loop.py:334-338`). It fires even when no strategy is live, and it is the stall signal (R3).

**Node: ledger, identity, notify, config** (`src/telemetry.ts#initTelemetry`, sdk-node 0.52)
- **Span processors.** Pass `spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter()), rpcDuration]` and
  drop `traceExporter`. Passing `spanProcessors` disables the implicit trace exporter (`sdk-node sdk.js:81-84`).
  - Add `sdk-trace-base` as a direct dependency.
  - The `@AC-1 @feature-226` export test is the regression proof.
- **Metric and log pipelines.** Pass the singular options `metricReader:` and `logRecordProcessor:` on 0.52.
- **Lazy histogram.** The recorder creates its histogram on the first `onEnd`, after `sdk.start()` has registered
  the global meter provider. `@opentelemetry/api` 1.9.1 has no proxy meter provider. A test proves that early
  binding exports nothing.
- **Recorder rules.** The status rule and attributes match Python. A missing code, a non-integer code or a code
  outside 0–16 records 2. A falsy `err.code` (`serverUtils.js:76-87`) also records 2.
- **Logs.** `getLogger` (`src/services/logger.ts`) attaches `@opentelemetry/winston-transport@0.5.0`
  (`api-logs ^0.52.0`) only after telemetry has started, because `api-logs` 0.52 has no proxy logger provider.
  - Stdout keeps its Console transport and format (AC-4).
  - `diag` stays on `console` and is not bridged.
- **Shutdown.** `telemetry.ts` exports `shutdownTelemetry()`, replacing the unawaited SIGTERM handler.
  - Each `shutdown()` starts it at once, in parallel with `tryShutdown`, whose callback awaits the flush before
    `process.exit(0)`.
  - A 5 s timer calls `forceShutdown()`. Long-lived WatchConfig and StreamEvents streams would otherwise block
    `tryShutdown`.
- **ESM-safe require.** `typeof require === 'function' ? require : createRequire(...)` (ledger/identity
  strip-types runner; ledger 2026-09-09).
- **New dependencies:** `exporter-metrics-otlp-http@0.52`, `exporter-logs-otlp-http@0.52`, `sdk-trace-base`,
  `sdk-metrics` and `sdk-logs`.

**UI** (`src/telemetry.ts`, sdk-node 0.218)
- **Pipelines.** Replace `metricReaders: []` and `logRecordProcessors: []` (`:31-32`) with one explicit reader
  and one explicit processor. Declare the 0.218 exporters directly. Keep `traceExporter`, since the UI passes no
  `spanProcessors`.
- **Metric (operator decisions A and R2).** A BFF route histogram, `http.server.duration` (ms), bound lazily on
  first use, Node runtime only. Its attributes are `{xstk.segment, http.route, http.response.status_code}`, plus
  `rpc.service` for Connect calls. Two seams share one recorder helper (C-18):
  - **Connect BFF.** Wrap `await handler(...)` in `createDispatch` (`src/lib/bffShared.ts:115-152`) with
    try/finally. Record **unary methods only** (`handler.method.methodKind === 'unary'`). Connect resolves a
    server stream on its first message (`handler-factory.js:277-280`), so StreamAlerts and StreamOrderUpdates
    would otherwise record time-to-first-alert (R3 B1). An unmatched path records `rpc.service="unmatched"` with
    status 404.
  - **REST route handlers (R3 gate: "Wrap REST routes too").** Wrap `/accounts/api/{profile,mcp-tools,agent-health,
    authorized-apps}` and `/trader/api/ledger/export`. `http.route` is the static route template. Health,
    auth and OAuth routes are not wrapped.
- **Logs.** A new `src/lib/serverLog.ts` writes the same console line, then emits through `logs.getLogger` at call
  time. Server-side `console.*` calls are migrated to it.
  - `telemetry.ts`'s own console lines stay stdout-only. This is the recursion guard, and it keeps the
    `"[otel] tracing enabled"` literal (PRESERVE `@AC-2 @feature-226`).
  - Flushing on deploy is best-effort.

**Identity (R2 gate).** At `identityServiceImpl.ts:151-154`, the seed-admin refusal log changes from `{ email }` to
`{ user_id: user.user_id }`. The user row is already loaded at `:145`, and this is the only email-bearing log in
`src/`. The `target_email` ledger audit payloads are out of scope.

**Shared golden vectors.** `scripts/testdata/rpc-status-vectors.json` holds the status vectors:
- ok → 0
- abort NOT_FOUND → 5
- unhandled `ValueError` → 2
- bare `Exception` → 2
- deadline-expired cancel → 4
- client cancel → 1
- Node error without a code → 2
- Node string code → 2
- ERROR status only → 2

It also holds `bucket_boundaries_ms` `[0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]`, which is
identical across the Go (`sdk/metric@v1.45.0/reader.go:206`), Python and Node SDKs. The 3 Python and 4 Node
recorder suites read the file. Go uses native `otelgrpc` and needs no consumer.

**Egress audit (before PR-A merges).** Grep every log site in config, notify (`fanout.ts`, `webPush.ts`), identity,
agent, ingest and marketdata, plus the Python `extra=` sites. Record the result in `context.md`. AC-7, AC-13 and
AC-20 are the egress tests.

### G1: dev proof gate (operator with Grafana Cloud credentials)

PR-A must be deployed to dev first. The operator runs this fixed query set and records the answers verbatim in
`context.md`:

1. `count by (service_name)(rpc_server_duration_milliseconds_count)` should return 10. If it is empty, check
   `count by (job)(…)` and `target_info` (the R2 branch). A rename then needs a superseding AC and operator
   sign-off.
2. `count by (rpc_service, rpc_method, rpc_grpc_status_code)(…{service_name="indicators"})`, then the same for one
   Node service. **One real non-zero status code** must appear for at least one Python and one Node service.
3. `mcp_tool_duration_milliseconds_count` and `http_server_duration_milliseconds_count{service_name="ui"}`.
4. Loki: `count_over_time({service_name="analysis"} |= "live_loop: cycle complete" [10m])`.
5. Loki label browser: `platform`, `deployment_environment`, `detected_level` vs `severity_text`, and `trace_id`.
6. `{service_name=~".+"} |= "opentelemetry"` must be empty (FR-4).
7. Active series per `service_name`, Loki bytes/day, and the stream-method series by `rpc_method`. This is the
   cost input for the prod flip, which stays out of scope.

### Re-sync

After PR-A squash-merges, merge `origin/main-dev` back into `feature/otel-metrics-logs-export` before starting
PR-B. `status.md` stays `in-progress` until PR-B merges.

### PR-B: assets, guard, docs (built only on names G1 proved)

`/sdd-spec` step 0 re-reads 250's **landed** guard, `alert-rules.yaml` and fence. It does not trust 250's spec
(ledger 2026-08-06).

- **Produced-signals registry.** Add `packages/otel/produced-signals.tsv` with columns `kind | identifier |
  producer-path | producer-literal`.
  - Guard Part 1 changes from a denylist to this allowlist. It extracts every identifier before `{`, `[` or `)`,
    minus PromQL keywords and functions, plus every Loki `service_name` value and `|=`/`|~` literal in an asset
    `expr`. Each must be registered. AC-8's `rpc_client_bogus_total` fails this check.
  - Every row's producer literal must still exist at its producer path.
  - P3-count is relaxed to the real rule count.
- **Guard Part 4: stream exclusion** (operator R2 decision: exclude in queries; recorders still record).
  - It derives the server-streaming set at runtime from `packages/proto/*/v1/*.proto`. Today that set is
    `ExportEvents`, `StreamAlerts`, `StreamBars`, `StreamEvents`, `StreamOrderUpdates`, `StreamPortfolioUpdates`,
    `StreamQuotes` and `WatchConfig`.
  - The proto parse tolerates `rpc Name (`, skips `//` comments, fails on an `rpc` line without `returns`, and
    fails if a stream name equals a unary name.
  - Every `rpc_server_duration_milliseconds_(count|bucket|sum){…}` selector in `alerts/*.yaml` and in panel
    `targets[].expr` must carry exactly the sorted `rpc_method!~"…"` matcher.
  - Only dashboard `templating` `label_values(...)` queries are exempt. Any other bare selector fails (R3 B2).
  - `packages/proto/**/*.proto` is added to the `otel-signals` paths filter.
- **Sampler guard.** The guard fails if `OTEL_TRACES_SAMPLER` or a gRPC excluded-services env var appears in
  `.do/*` or `docker-compose.yml`, because the span-derived metrics depend on sampling.
- **Alert rules.**
  - Restore `xstk-error-rate-high` and `xstk-p99-latency-high` with the stream matcher and `noDataState: OK`.
  - `xstk-analysis-no-scoring` keeps its uid but now means "live loop heartbeat absent". Its query is
    `sum(count_over_time({service_name="analysis"} |= "live_loop: cycle complete" [30m])) < 1`, with
    `noDataState: Alerting`.
  - Restore the `outside-us-market-hours` mute timing and attach it to that rule.
  - Record the meaning change in `alerts/README.md` and in the fence.
  - Guard tests assert `noDataState` on every rule.
- **Dashboards.** Each pre-250 panel gets its own decision:
  - Keep the `rpc_server_duration_*` and `service_name` panels, adding the stream matcher.
  - Rewrite `{platform="xstockstrat"}` and `| json | level=~` according to G1 query 5.
  - Drop `infrastructure.json:105` (OTel export failures in Loki), because FR-4 makes those stdout-only.
  - 250's Tempo panels in `service-health.json` stay as drill-downs.
- **Docs and constitution (FR-7).** Update `observability.md`, `grafana-cloud.md`, the `packages/otel` docs,
  PLAT-3, OTEL-1/OTEL-2 and both findings rows to state traces, metrics and logs. Retire guard Part 2 (C-16
  CHANGE, signed off).
- **Teardown.** Run `/context-forge:context-constitution refresh` scoped to the touched files. The guard and
  `.test.sh` run last.

## Rejected Alternatives

- **Narrow to traces / do nothing at runtime** (feature 226 OD-3, 250's choice). This leaves error-rate, p99 and
  stall undetected. The operator reversed it explicitly (C-11 sign-off).
- **Per-language gRPC server interceptors as the RPC metric for Python and Node.** That makes two mechanisms and
  touches server wiring in 7 services. The span-derived recorder reuses the status the instrumentation already
  computes. The one interceptor that remains (Python cancel/deadline) exists only for the case the instrumentation
  cannot see.
- **Upgrading `instrumentation-grpc` for native metrics.** Neither pinned line emits RPC metrics (recon SDK probe).
  An upgrade is speculative, and it carries the risk of a semconv rename to `rpc.server.call.duration` in seconds
  (FR-2 contract).
- **Excluding streams at the recorders** (an `otelgrpc` Filter plus a py/node predicate). Rejected by the operator
  at R2: FR-2 says streaming calls are recorded, and stream visibility would be lost.
- **A UI per-method `rpc.client.duration` client histogram.** It adds about 5k series that mostly duplicate the
  server side. Rejected by the operator at R2 in favour of the BFF route histogram.
- **Recording UI server-streaming calls.** Connect's `untilFirst` makes the duration mean time-to-first-message,
  which would poison p99 by service (R3 B1).
- **Monkey-patching `console` in the UI.** It would capture OTel diag output (recursion) and global side effects.
  An explicit `serverLog` module is bounded.
- **DO `log_destinations` / collector `filelog` scraping for logs.** No trace correlation, dual app-spec config,
  and divergent local behaviour. Rejected at story time.
- **Running G1 locally or deferring it to rollout.** Local needs workstation credentials and does not prove the DO
  path. Deferral risks dead alerts, which is the exact failure 250 exists to remove. The operator chose two PRs
  via dev.
- **Leaving 250 as-is and superseding its follow-up later.** That creates a story only to cancel it and churns 4
  citations. The operator chose to amend 250 before it runs.
- **Retiring 250's Part 2 in P-0.** It would reopen 250's reviewed AC-3 before 250 runs. The operator waived the
  PR-A doc drift instead.
- **Accepting the Python cancel/deadline divergence.** Python timeouts would be invisible to the error-rate alert.
  The operator chose the interceptor.
- **A hand-maintained stream list or registry row for the matcher.** It is a second list that would drift. The
  guard derives it from the protos.
- **A shared cross-service telemetry package.** None exists. The per-service `telemetry` convention stands
  (C-18 trade-off below).

## Open Risks

- [ ] **Grafana Cloud OTLP→Prometheus label and series names (R2).** Proven only at G1. If `service_name` or the
  `rpc_server_duration_milliseconds_*` name differs, PR-B is re-pointed under a superseding AC with operator
  sign-off.
- [ ] **Span-derived recorder parity is proven on hand-built spans by the golden vectors.** Real cross-language
  emission is proven only at G1 query 2, which requires a real non-zero status from Python and Node.
- [ ] **Accepted asymmetries, documented in the OTEL constitution in PR-B:**
  - Span-derived recorders miss calls with an unsampled inbound `traceparent`.
  - A Node server stream cancelled by the client never ends its span (`serverUtils.js:28-67`). The stream matcher
    excludes it from alerts anyway.
  - Go `os.Exit(1)` startup paths skip the flush; stdout keeps those lines.
  - UI flush is best-effort.
- [ ] **Recorder code is duplicated** across 3 Python and 4 Node telemetry modules, on top of today's jscpd-flagged
  telemetry clones. The shared vectors bound behavioural drift.
- [ ] **DO App Platform's SIGKILL grace is not in the repo.** The 3 s/5 s bounds assume ≥10 s. Verify at PR-A spec
  step 0.
- [ ] **UI trace correlation relies on Next.js's own server spans** (`instrumentations: []`). Unverified until the
  AC-11 UI row runs.
- [ ] **Unwrapped UI routes.** Health, auth, OAuth and `config-ui/api/audit` are not measured.
- [ ] **Cost.** Grafana Cloud active series and Loki volume are measured at G1 query 7. The prod `OTEL_ENABLED`
  flip stays a separate operator rollout step.
- [ ] **P-0 depends on 250 not starting first.** The F-09 re-check gates it.

## Constitution Rules Touched

- `C-02`: honored. Every phase re-read `context.md`, and all checkpoints were written as they happened (P-05).
- `C-08`: honored. Every service step gets a paired test.
- `C-10`: honored.
  - The duplicated surfaces get every instance: all 12 runtimes, all 3 Python and 4 Node recorders, every
    `/otlp` test, and every Go `.golangci.yml`.
  - The stream matcher is enforced on every rule and panel selector by guard Part 4.
- `C-11`: honored. Story → review → full design. The reversal of 226 OD-3 is signed off in `context.md`.
- `C-13`: honored. The shared vectors live under `scripts/testdata/`, and each service keeps its own fixture home.
- `C-14`: honored. Internal only; the consumer is the operator through Grafana (product-spec).
- `C-15`: honored. AC-15 to AC-21 are appended (append-only), and each FR stays covered.
- `C-16`: honored. See Business Rules Touched. The only CHANGE is 250 Part 2, which is signed off.
- `C-18`: honored, with trade-offs recorded:
  - The recorder is duplicated per the per-service convention.
  - There is one UI recorder helper for both seams.
  - No speculative shared package.
  - Go Views drop the unused instruments (cost).
- `P-01`/`P-02`: honored. The orchestrator was the sole writer, and proposer and adversary were mediated.
- `P-03`: honored. Unverifiable items are listed in Open Risks or as spec step-0 checks.
- `P-04`: honored. There were three recorded gates.
- `F-04`: honored. Every cited path was verified by the discovery or adversary passes. The 250 guard files are
  re-read at spec step 0, not assumed.
- `F-06`/`F-07`: honored. No DB and no config keys are touched.
- `F-09`: honored. P-0 edits 250 only while all its steps are `pending` (re-check gate); otherwise it uses the
  Deviation Log.
- Floor breaches: none.

## Business Rules Touched (C-16)

**Telemetry and OTLP export**
- PRESERVE `@AC-1 @feature-171` "A telemetry module's built Resource no longer carries the trading_mode attribute"
  (`docs/sdd/business-rules/platform.feature`). Not regressed: all three providers reuse the one resource builder.
- EXTEND `@AC-2 @feature-171` "Telemetry init remains non-blocking…". New cases: meter and logger init and exporter
  failure stay non-fatal (AC-6, AC-12, AC-18).
- PRESERVE `@AC-3 @feature-171`: the dashboards README attribute list, with no `trading_mode`.
- EXTEND `@AC-1 @feature-226` "exports traces over OTLP/HTTP to a path-prefixed gateway URL". New case:
  `/otlp/v1/metrics` and `/otlp/v1/logs` under both header forms (AC-19).
- EXTEND `@AC-3 @feature-226` "A failed trace export is visible in service logs". New case: metric and log export
  failures are stdout-visible with no recursion (AC-6).
- PRESERVE `@AC-4 @feature-226`: one `OTEL_EXPORTER_OTLP_ENDPOINT` for all signals, no per-signal env var.
- PRESERVE `@AC-2 @feature-226` (`services/xstockstrat-ui/acceptance/fix-otel-trace-export.feature`). The
  `"[otel] tracing enabled"` literal and the nodejs-guarded `src/` hook are kept, and the UI keeps `traceExporter`.

**UI build, mTLS and header propagation**
- PRESERVE `@AC-6 @feature-128` (UI standalone build). The new UI dependencies are Node-runtime only.
- PRESERVE `@AC-4`/`@AC-5 @feature-210` (mTLS fail-closed, header propagation). No credentials change; the Python
  cancel interceptor is appended to the existing interceptors.

**Secret and credential redaction**
- EXTEND `@AC-35 @feature-224 @feature-225` and `@AC-4 @feature-147` (GetSecret). New case: no secret plaintext on
  the OTLP log edge (AC-7, egress audit).
- PRESERVE feature 147 redaction at `WatchConfig`, `GetConfig` and `ListKeys` and in overlays (`@AC-2`, `@AC-3`,
  `@AC-14`), and marketdata's placeholder WARN (`@AC-7`).
- PRESERVE `@AC-10 @feature-043` "Passwords are never returned or displayed" (AC-13), `@AC-2 @feature-166`,
  `@AC-1`/`@AC-4 @feature-164`, `@AC-1 @feature-183` and `@AC-7 @feature-207`. The egress audit and the "no
  attribute stdout doesn't print" rule cover these.

**Stdout log lines**
- PRESERVE `@AC-6 @feature-020`, `@AC-4 @feature-127` and `@AC-5 @feature-215`. Stdout lines are unchanged (AC-4).

**Changed**
- CHANGE feature 250's guard Part 2 rule ("docs list only exported signals"; 250 `@AC-3`). It is retired in PR-B.
  Signed off by the user at the R1 gate, 2026-10-21 (`context.md`), and mirrored into 250's `context.md` at P-0.

## Acceptance additions (append-only)

| AC | Covers | Scenario |
|---|---|---|
| AC-15 | `@FR-2` | Every vector in `rpc-status-vectors.json` holds in the Python and Node recorders, using the shared bucket boundaries. |
| AC-16 | `@FR-1` | A UI unary Connect BFF call and a wrapped REST route record `http.server.duration` with segment, route/service and status. StreamAlerts is **not** recorded. An unmatched path records `unmatched`/404. |
| AC-17 | `@FR-6` | Guard Part 4 fails when any restored `_count`, `_bucket` or `_sum` selector lacks the proto-derived stream matcher, and when a stream RPC is added to a proto without updating the matcher. |
| AC-18 | `@FR-4` | AC-12 variant with an open `StreamQuotes` stream: SIGTERM flushes the RPC points and log records, and the process exits inside compose's 10 s grace. |
| AC-19 | `@FR-1` | Extends `@AC-1 @feature-226`. All 12 runtimes export to `/otlp/v1/metrics` and `/otlp/v1/logs` under both header forms. |
| AC-20 | `@FR-5` | The identity seed-admin refusal record (stdout and OTLP) carries `user_id`, not the email. |
| AC-21 | `@FR-1` | The agent records `mcp.tool.duration` with `outcome=error` for a raising tool and for an `isError` result. An unknown name records as `unregistered`. |
| AC-22 | `@FR-2` | A Python handler whose client deadline expires records `rpc.grpc.status_code=4`, and a client cancel records 1. |
