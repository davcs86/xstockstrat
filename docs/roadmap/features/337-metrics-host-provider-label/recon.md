# Recon: metrics-host-provider-label

**Created**: 2026-11-12
**From**: product-spec.md
**Tree**: feature/metrics-host-provider-label@eb69da3 ≡ origin/feature/metrics-host-provider-label (`origin/main-dev` merged)
**Affected services**: trading, portfolio, marketdata (Go); config, identity, ledger, notify (Node); ui (Next.js); analysis, ingest, indicators, agent (Python)

Method note: discovery ran once per runtime group (Go ×3, Node leaves ×4, UI, Python ×4), not once per service. The per-runtime `telemetry` modules are structural copies (verified by the digests), so one agent per runtime covers them. Pinned SDK sources were fetched into the session scratchpad and read directly (fails.md 274 rule): Go `sdk/metric` v1.45.0 and `otelgrpc` v0.52.0 (module cache); `@opentelemetry/sdk-metrics` 1.25.1 and 2.7.1, `sdk-node` 0.52.1 and 0.218.0 (npm); `opentelemetry-sdk` 1.45.1 and `opentelemetry-instrumentation-grpc` 0.66b1 (PyPI). Versions come from `go.mod`, `pnpm-lock.yaml`, `uv.lock`.

---

## Objective

Make `host_provider` (`homelab` | `digitalocean` | `unknown`) a label on every metric series of the 12 runtimes so provider-scoped PromQL needs no `target_info` join. Today `host.provider` is only a resource attribute (feature 332) and lives on `target_info` alone.

## Live Grafana facts (MCP, 2026-11-12, datasource `grafanacloud-prom`)

- Label names on `rpc_server_duration_milliseconds_count`: `deployment_environment, instance, job, rpc_grpc_status_code, rpc_method, rpc_service, rpc_system, service_instance_id, service_name`. No `host_provider`.
- `group_left (L)` over a label the left side already carries is accepted (tested with `deployment_environment`: `count by (service_name)(rpc_server_duration_milliseconds_count * on (job, instance) group_left (deployment_environment) group by (job, instance, deployment_environment) (target_info))` returned all 10 services, no error). So the 332 join block stays valid after the label lands.
- 23 distinct `(job, instance, deployment_environment)` rows in `target_info` right now.

## Mechanism matrix (what each option can do, proven from pinned source)

| Runtime | Pinned | Public View can ADD an attribute? | Supported seam to add it | Source evidence |
|---|---|---|---|---|
| Go (trading, portfolio, marketdata) | `sdk/metric` v1.45.0 | No. `Stream` has only `AttributeFilter` (filter-only) | Wrap `sdkmetric.Exporter` (`Export(ctx, *metricdata.ResourceMetrics)`); `Reader` is sealed (unexported methods), `Producer` can only append metrics | `instrument.go:131-158`, `view.go:100-110`, `reader.go:44-96,107-117`, `exporter.go:19-77`, `periodic_reader.go:111,224-233,262` |
| Node leaves (config, identity, ledger, notify) | `sdk-metrics` 1.25.1 via `sdk-node` 0.52.1 | No. `ViewOptions` has only `attributeKeys`; `AttributesProcessor` not exported from the index | Wrap `PushMetricExporter` and clone datapoints; must forward `selectAggregationTemporality`/`selectAggregation` | `view/View.d.ts:32`, `View.js:103-108`, `index.d.ts:19`, `export/MetricExporter.d.ts:18-39`, `PeriodicExportingMetricReader.js:31-35` |
| UI | `sdk-metrics` 2.7.1 via `sdk-node` 0.218.0 | Yes. `ViewOptions.attributesProcessors` accepts a custom `{process}` object; `View` class not exported but `MeterProvider({views})` takes option objects | Wildcard view (`instrumentName:'*'`, no `name`) with an adding processor, OR the same exporter wrapper as the leaves | `view/View.d.ts:36`, `AttributesProcessor.d.ts:7-16`, `MeterProvider.js:21-25`, `View.js:21-34,104-110`; `NodeSDK` forwards `views` (`sdk-node@0.218.0 build/src/sdk.js:162-175,214`, checked in this session) |
| Python (analysis, ingest, indicators, agent) | `opentelemetry-sdk` 1.45.1 | No. `View(attribute_keys=...)` is filter-only | Wrap `MetricExporter`; datapoints are frozen dataclasses so rebuild with `dataclasses.replace`; forward `_preferred_temporality`/`_preferred_aggregation`; `shutdown(timeout=...)` kwarg | `view.py:96-109`, `_view_instrument_match.py:132-133`, `point.py:18-24`, `export/__init__.py:93-99,434-435,522,541,545` |

Cross-cutting SDK facts:
- Aliasing: Node and Python datapoint `attributes` can be the caller's own object, kept as the aggregation key and re-emitted every export (`HashMap.js:36-37`, `aggregation.py:86`); wrappers must copy, never mutate. Go differs: the periodic reader zeroes and pools `ResourceMetrics` after `Export` (`periodic_reader.go:247-251`), so reassigning `dp.Attributes` inside `Export` is safe.
- No SDK has a resource-to-metric-attribute option (Go prometheus-only `WithResourceAsConstantLabels` is out of the pinned set; Python grep found none).
- `otelgrpc` v0.52.0 has no metric-attribute option (`config.go:150-257`); `opentelemetry-instrumentation-grpc` 0.66b1 emits no metrics, so Python `rpc.server.duration` comes from a repo-owned span processor.
- Overflow series: Go cardinality limit 2000 stamps `otel.metric.overflow` (`aggregate/limit.go:11`); a wrapper would label those too.

Not read (gaps): `otlpmetrichttp@v1.45.0` source and the Python `OTLPMetricExporter` source were not on disk, so the claim "a wrapper that rewrites datapoint attributes before delegating is seen by the OTLP encoder" rests on the interface contract, not on the encoder code. The design must require a wire-level test per runtime (decode the real OTLP body, assert the datapoint attribute) rather than trust it.

Option A (Grafana-side promotion): doc `https://grafana.com/docs/grafana-cloud/send-data/otlp/promote-resource-attributes/` read in this session. `promoted = (defaults + promote) - neverPromote`; attribute name given with dots (`host.provider` → `host_provider`); applied with `gcx` + a service account; "Self-service configuration for this feature is still experimental. If you would like to configure your resource attributes promotion, contact Grafana Labs Support"; changes apply to newly ingested data only. No repo mechanism can version or CI-apply it (no `gcx`/`MimirOTLPConfiguration` anywhere; feature 297 is `spec-ready` and is a dashboards HTTP-API upsert, no stack-admin credential). Free-tier availability is unverified. Needs the operator and possibly Grafana Support.

## Codebase Map

- **Go** `services/xstockstrat-{trading,portfolio,marketdata}/internal/telemetry/otel.go` (identical lines 1-310):
  - `mp := sdkmetric.NewMeterProvider(WithReader(NewPeriodicReader(mexp)), WithResource(res), WithView(serverMetricViews()...))` — `otel.go:71-75`; exporter `otlpmetrichttp.New(ctx)` — `:49`.
  - `hostProvider()` — `:124-130`; `newResource` — `:134-145`; `serverMetricViews` (4 drop views, no `AttributeFilter`) — `:97-112`.
  - Server stats handler `grpc.StatsHandler(otelgrpc.NewServerHandler())` — trading `cmd/server/main.go:156`, portfolio `:99`, marketdata `:173`; client handler uses a no-op meter provider (`client.go:12`).
  - Custom instruments via rebinding wrappers (`otel.go:184-279`): trading 6 counters, portfolio 4 counters, marketdata 3 counters + 1 histogram + 5 gauges.
- **Node leaves** `services/xstockstrat-{config,identity,ledger,notify}/src/telemetry.ts` (same layout, line offsets 1-2):
  - `hostProvider()` ~`:27-31`; `buildResource()` ~`:37-47`; `rpcDurationViews()` (single `new View({instrumentName:'rpc.server.duration', aggregation})`) ~`:62-72`; `NodeSDK({metricReader: new PeriodicExportingMetricReader({exporter: new OTLPMetricExporter(), ...metricIntervalOptions()}), views: rpcDurationViews(), ...})` ~`:182-198`.
  - `rpc.server.duration` is derived from spans by `RpcDurationProcessor` (config `:89-123`). Instruments: config 4+1, identity 6+1, ledger 2+1, notify 3+1.
- **UI** `services/xstockstrat-ui/src/telemetry.ts`: `hostProvider()` `:16-19`; resource `:52-58`; `NodeSDK` with `metricReaders:[new PeriodicExportingMetricReader({exporter:new OTLPMetricExporter(), ...})]` `:62-67`; no `views` today. Instruments only in `src/lib/bffMetrics.ts` (3: `http.server.duration`, `ui.auth.events`, `ui.bff.requests`).
- **Python** `services/xstockstrat-{analysis,ingest,indicators,agent}/app/telemetry.py`: `_host_provider` (analysis `:25-28`), `_build_resource` (`:31-43`), `MeterProvider(resource=..., metric_readers=[PeriodicExportingMetricReader(metric_exporter)])` (analysis `:201-204`, ingest `:198-201`, indicators `:197-200`, agent `:70-75`), whole init in `try/except` (non-fatal). Instruments go through `_Bound` helpers; raw instruments outside them: `analysis/app/engine/live_loop.py:79`, `agent/app/tool_metrics.py:111`.
- **Docs/guards**: `scripts/check-otel-produced-signals.py` Part 6 (`:369-391`, `query_blocks` `:471-487`, `query_block_misses` `:496-506`, constants `:48-53`); tests `scripts/tests/test_check_otel_produced_signals.py:334-433`; `docs/patterns/observability.md:62-119` (section), `:40-42` and `:114-115` (cost), `:46-48` (registry); `packages/otel/produced-signals.tsv` (label names are not registered, so no change needed for a new label).

## Patterns to REUSE

- The 332 normaliser (`hostProvider()`/`_host_provider()`) is the single reader of `HOST_PROVIDER` per runtime; the exporter wrapper takes the already-resolved `provider` value built in `newResource`/`buildResource` (FR-2). Go `otel.go:124-145`, Node `telemetry.ts` `buildResource`, UI `telemetry.ts:16-58`, Python `app/telemetry.py:25-43`.
- Exporter wrapper at the one construction site per runtime: Go `otel.go:49`/`:71`, Node `telemetry.ts` ~`:187` (`new OTLPMetricExporter()`), UI `:63`, Python `metric_exporter = OTLPMetricExporter()` (analysis `:193`).
- Test seams: Go `TestExportedSignalsCarryHostProvider` (`otel_test.go:310`) runs real `Init` against an httptest OTLP receiver (resource-only assertions today; add a datapoint assertion there); Node `telemetry.export.test.ts:130-152,405-428`; UI `src/instrumentation.testkit.ts:128-146`; Python `test_telemetry.py` `test_init_exports_metrics_and_logs_with_resource` (analysis `:172-218`). All four already decode the wire; none inspects datapoint attributes.
- Guard extension: split `QUERY_TAG` handling into per-block sub-tags in `check-otel-produced-signals.py` and extend `test_query_block_mutation` (`:347-402`), invert `test_two_promql_blocks_fail` (`:405-413`).
- No shared telemetry package exists in any language (`packages/` holds only `otel/` and `proto/`; per-service Dockerfiles copy only the service dir plus `packages/proto`). The status quo is per-service duplication; `.jscpd.json` has precedent ignores for duplicated files (`watch_core.py`, `live_limits.py`). A new shared module needs a Dockerfile COPY and lock changes in every service.
- C-13 fixture homes: Go ManualReader helpers (`installMetricReader`, `trading_telemetry_test.go:285-296`); Node `src/__tests__/fixtures/collectingReader.ts` (byte-identical ×4); Python `otel_reset` (`tests/conftest.py`) and `metric_reader` (`tests/test_telemetry.py:148-157`); UI `bffAllowlist.test.ts`.

## Existing Business Rules (preserve / extend)

- **EXTEND** `@AC-10 @FR-5 @feature-332` (`docs/sdd/business-rules/platform.feature:2325`) — join block keeps its tag and matchers; a second block (the simple form) is added; the "exactly one promql block" Given is reworded.
- **PRESERVE** `@AC-11 @FR-5 @feature-332` (`:2331`) — logs filter unchanged.
- **EXTEND** `@AC-12 @FR-7 @feature-332` (`:2337`) — attribute-contract text and the `target_info` post-deploy check stay; the simple metric query is added as the preferred form.
- **PRESERVE** `@AC-1..5,13,19,21,22,23 @feature-332` (`:2242-2385`) — resource attribute and normaliser rules, non-fatal startup, `OTEL_ENABLED=false` no-op, `service.instance.id` rules, `OTEL_RESOURCE_ATTRIBUTES` guard; `@AC-6,7,14,15,20 @feature-332` — no new env var (none needed).
- **PRESERVE** `@AC-56 @FR-15 @FR-2 @feature-294` (`:1381`) — Go `serverMetricViews` byte-identical; no `rpc.client.*`. An exporter wrapper leaves it untouched; a view-based approach would CHANGE it.
- **PRESERVE** `@AC-42`, `@AC-43 @feature-294` (`:1349`, `:1356`) — telemetry never blocks startup; no change under `packages/otel/{alerts,dashboards}`; `produced-signals.tsv` unchanged.
- **PRESERVE** `@feature-274` regression scenarios (series names, status-code labels, buckets, gateway/header transport, SIGTERM flush ≤10 s, unreachable endpoint never blocks startup, disabled installs no pipeline) and `@feature-250`, `@feature-171` (no `trading_mode`).
- **CHANGE (needs operator sign-off recorded in `context.md`), if a datapoint attribute is added (option B)** — literal sentences that option B breaks: `@AC-41 @FR-15 @feature-294` (`:1346`) "`rpc.server.duration`, `mcp.tool.duration`, `http.server.duration` keep their names and attribute keys"; `@AC-36 @FR-11 @feature-294` (`services/xstockstrat-ui/acceptance/signal-map-instrumentation.feature:29`) "`http.server.duration` gains no new attribute key"; `@AC-51 @FR-5 @feature-294` (`services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature:36`) "unlabelled `analysis.live_loop.cycle.duration`". Option A adds no SDK attribute and breaks none of them.

## Dependencies

- Proto/RPC: none. Migration: none. Config keys: none. Inter-service edges: none.
- Env vars: `HOST_PROVIDER` only, already set in every target (`.do/app.yaml:32-40`, `.do/app.dev.yaml`, `deploy/homelab/compose.yml:7-10`; local `docker-compose.yml` unset → `unknown`). Nothing new.
- External: option A needs a Grafana Cloud stack-admin service-account token and `gcx` (not present anywhere in the repo).

## Tests a datapoint-level `host_provider` would break (option B), by runtime

- Go: with the label applied in an `Export` wrapper installed inside `Init`, none of `telemetry_allowlist_test.go` (`TestAllowlist_AC41_EveryLabelKeyIsATelemetryConstant` `:100`), `instruments_test.go` (`TestServerMetricViewsUnchangedAndNoClientInstruments` `:247`), `otel_test.go` break (they build bare `NewManualReader` providers, not `Init`).
- Node leaves: `*/telemetryAllowlist.test.ts` break only if the label is applied through the test provider; `notify/src/__tests__/fanout.test.ts:192` asserts exact keys `['channel','outcome']` via `install()`; with an exporter wrapper installed only in `initTelemetry`, all stay green.
- UI: `bffAllowlist.test.ts:98-102` exact-equality on `http.server.duration` and `bffMetrics.test.ts:206-209` break only if the test provider carries the label.
- Python: `test_telemetry_allowlist.py` (`ALLOWED_KEYS`, `RPC_KEYS` equality), `test_ingest_telemetry.py:33`, `test_sandbox_telemetry.py:20,24`, `test_live_loop_telemetry.py:202` (`dict(point.attributes) == {}`) break only if the label is applied at record time or via the test provider; `test_ac42_failing_init_still_lets_the_service_start` (monkeypatched exporter returns `object()`) must still log and not raise with a wrapper.
- Key consequence: an exporter-level wrapper is invisible to the in-memory-reader tests, so the existing allowlist tests keep guarding the instrument-level label sets (the intent of feature 294), while the new datapoint label needs its own wire-level test per runtime.

## Risks / Not-found

- Not found: Go `otlpmetrichttp` source and `attribute.Set` definition, Python `OTLPMetricExporter` source (see gaps above); free-tier availability of option A; any shared telemetry package; any datapoint-attribute assertion on a real `Init` pipeline.
- A Go exporter wrapper must type-switch over `Gauge|Sum|Histogram|ExponentialHistogram` × `int64|float64` (`metricdata/data.go:52,61,91,132`) and forward `Temporality`/`Aggregation`; Node/Python wrappers must forward the aggregation/temporality selectors or the default temporality silently changes (bucketed histograms, delta vs cumulative).
- Series budget: `docs/patterns/observability.md:114` documents ~3,600 active series across three exporting stacks (free cap 10,000, `docs/setup/grafana-cloud.md:45`). A constant label per sender adds zero series; a first-deploy relabel forks identity once per series (old series stale ~5 min); Python restart churn is unaffected. Overflow (Go 2000, Node 1999) would also be stamped.
- Observed live counts: 23 `target_info` rows; marketdata alone ~270 series.
- DRY: a ~30-line wrapper copied into 3 Go + 4 Node + 1 UI + 4 Python telemetry modules will trip jscpd (`.jscpd.json` `minTokens 100`); needs a shared home or documented ignore entries (precedent exists).
- Ledger traps: fails.md 274 family (prove SDK behavior at the pinned version, add a test that fails on the naive assumption); fails.md 2026-11-11 `homelab-otel-host-provider` (cite the pipeline line behind any shared-value claim); fails.md 3259 (vocabulary-denylist doc guards trip on the feature's own literals — new guard sub-tags and doc prose must be run against the intended post-change tree).
- Feature 332 `debate.md` R-1 (promotion as sole mechanism: "unversioned stack setting, untestable from the repo") and R-2 (view-based per-datapoint attribute: touches every instrument, `serverMetricViews` must stay unchanged) are locked rejections in a different feature's register; this feature reopens them at the operator's request. Recon result on R-2: the premise "views can only drop attributes" is true for Go, Node leaves and Python, false for UI sdk-metrics 2.x; an exporter wrapper avoids views entirely and so leaves `serverMetricViews` untouched. Feature 333 (`otel-env-provider-scoped-alerts`) and 297 overlap docs/guard/tsv only; 336 (Python `service.instance.id`) has no directory on disk and is not depended on.

## Recommended Scope

Advisory, only if option B (exporter wrapper) is chosen:
1. RED wire-level tests: one per runtime that decodes the real OTLP body and asserts every datapoint carries `host_provider` (the failing-on-naive-assumption test).
2. Per-runtime wrapper in the existing `telemetry` module, reading the already-resolved provider (Go ×3, Node ×4, UI, Python ×4), plus allowlist/test updates for the three amended `@feature-294` sentences.
3. Guard Part 6 sub-tags + `observability.md` simple-form block + series-budget measurement + `platform.feature` EXTEND/CHANGE edits.
If option A: docs + a versioned `MimirOTLPConfiguration` file + an operator runbook step; no service code.
