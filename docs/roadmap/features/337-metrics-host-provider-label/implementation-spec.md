# Implementation Spec: metrics-host-provider-label

**Status**: `pending`
**Created**: 2026-11-12
**Feature**: `docs/roadmap/features/337-metrics-host-provider-label/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/metrics-host-provider-label`
**Tree**: `feature/metrics-host-provider-label@2f13839 ≡ origin/feature/metrics-host-provider-label` (last code-relevant commit, after merging `origin/main-dev` at `402da1f` which includes feature 336; `git diff --stat 2f13839..9a8a370` touches only `context.md` and `implementation-spec.md` under `docs/roadmap/features/337-metrics-host-provider-label/`, so every citation below still holds) (`origin/main-dev` is an ancestor)

---

## Execution Summary

Chosen design (`design.md`, option B): one metric-exporter wrapper per runtime adds datapoint attribute `host.provider` (Mimir label `host_provider`) after aggregation, immediately before the real OTLP exporter. No View, no `serverMetricViews` change, no new env var or config key, no proto, no migration. `HOST_PROVIDER` is already wired in every deploy target (`.do/app.yaml:34`, `.do/app.dev.yaml:34`, `deploy/homelab/compose.yml:8`; absent from `docker-compose.yml`, which resolves to `unknown`), so `docker-compose.yml` and `.do/app*.yaml` are untouched.

Order: Step 1 is the operator-run gating smoke test (D-9): nothing else starts until the Mimir behavior is proven (`@AC-17`, `@AC-22`). Then four runtime groups, each a `service` step plus its `test` step as one atomic unit (the new test file imports a symbol the service step creates, `step-constraints.md` §C): Go x3 (2-3), Node leaves x4 (4-5), UI (6-7, own step because of the two SDK majors), Python x4 (8-9). Then docs (10), the guard script and its tests (11-12), the C-16 promotion that `/sdd-execute` runs at integration (13), and the two steps that can only run after the change is deployed (14-15): Step 14 measures `@AC-1/6/7/10/11`, and Step 15 records the series delta and promotes those five measured scenarios into `platform.feature`.

Consumer surface (C-14): **None** (product spec). This is an operator-facing observability change consumed as PromQL in Grafana Cloud. It was a decision, not an omission; no `xstockstrat-ui` segment or MCP tool changes beyond the telemetry modules.

Constraints carried: `fails.md:3428` and `:3044` (an explicit SDK component replaces a default, so re-bind selectors and prove with a wire test), `fails.md:3988` (a shared-value claim cites the pipeline line behind each side), `fails.md:3259` (run new doc/guard literals against the intended post-change tree), `insights.md:4584-4598` (wrap the exporter, pre-aggregate the left operand of a `group_left` join, smoke test the third-party behavior first).

### Scenario Coverage (C-15)

| Scenario | Step(s) | Scenario | Step(s) |
|---|---|---|---|
| `@AC-1` | 14 (measurement), 15 (promoted) | `@AC-12` | 1 |
| `@AC-2` | 3, 5, 7, 9 | `@AC-13` | 3, 5, 7, 9 |
| `@AC-3` | 5 (config) | `@AC-14` | 5 (ledger), 7 (ui) |
| `@AC-4` | 5 (ledger) | `@AC-15` | 3 |
| `@AC-5` | 3, 5, 7, 9 | `@AC-16` | 9 |
| `@AC-6` | 14 (measurement), 15 (recorded, promoted) | `@AC-17` | 1 |
| `@AC-7` | 14 (measurement), 15 (promoted) | `@AC-18` | 3 (trading), 7 (ui x2), 9 (agent, analysis) |
| `@AC-8` | 3, 5, 7, 9 | `@AC-19` | 12 |
| `@AC-9` | 12 | `@AC-20` | 12 |
| `@AC-10` | 14 (measurement), 15 (promoted) | `@AC-21` | 3, 5, 7, 9 |
| `@AC-11` | 14 (measurement), 15 (promoted) | `@AC-22` | 1 |

FR coverage (the numbers in parentheses are `@AC-*` scenario numbers, not step numbers): FR-1 (1, 2, 3, 13, 15, 17, 18), FR-2 (2, 4), FR-3 (5), FR-4 (12), FR-5 (6), FR-6 (7, 8, 13, 14, 16, 18, 21), FR-7 (9, 10, 19, 20, 22), FR-8 (11), all via the table above.

## Step Dependencies

- Step 2 and Step 3 land together: Step 3's `hostlabel_test.go` references `newHostLabelExporter` (created in Step 2) and the `newResource(ctx, p)` signature change in Step 2 breaks the existing call at `otel_test.go:69` in all three services (Go `_test.go` files compile with the package). One commit, one red-green cycle.
- Step 4 and Step 5 land together: the leaf `tsc` build compiles `src/__tests__/` (`tsconfig.json` `include: ["src/**/*"]`), so a test importing `withHostProvider` cannot compile until Step 4 creates it.
- Step 6 and Step 7 land together (vitest imports `withHostProvider` from `src/telemetry.ts`).
- Step 8 and Step 9 land together (the tests import `_with_host_provider` from `app/telemetry.py`).
- Step 1 gates Steps 2-9: a GREEN `@AC-17`/`@AC-22` is recorded in `context.md` before any runtime step starts. If `@AC-17` is RED (the datapoint attribute does not become the label, or `host.provider` collides with the resource attribute), stop and return to `/sdd-design` (Open Risk 1 in `design.md`).
- Step 10 (docs) precedes Steps 11-12 (guard): the new guard demands the `otel-guard:host-provider-label` block that Step 10 adds, while the old guard ignores that tag (it matches the tag line by exact equality, `scripts/check-otel-produced-signals.py:483`), so Step 10 is green on its own.
- Step 11 and Step 12 land together: Step 12's new cases fail until Step 11's guard change exists, and a guard change without its cases would be untested (C-08); RED is proven in the working tree before Step 11 is applied, then both commit as one unit.
- Step 13 (promotion) is executed by `/sdd-execute` in its integration phase (`.claude/skills/sdd-execute/SKILL.md` Step 2.5, P-04 operator confirmation), not earlier.
- Steps 14 and 15 run only after the integration PR has deployed to DO dev and to homelab staging/production. Homelab staging is not exporting yet (`context.md` baseline); `@AC-1`, `@AC-6` and `@AC-10` cannot pass until it is. The operator must confirm Step 14's outcome before the `main-dev` to `main` promotion (`fails.md:640-643`).
- Step 15 follows Step 14 and the operator's confirmation of its results (P-04); it ships as a docs-only follow-up PR to `main-dev`, separate from the integration PR that carries Steps 1-13, and appends to `platform.feature` after Step 13's append (no `Lands with` needed: different PRs, append-only).
- Overlap, not a dependency: 333 (`otel-env-provider-scoped-alerts`), 297 and 329 touch `docs/patterns/observability.md`, the guard and `packages/otel/produced-signals.tsv` textually; 336 (Python `service.instance.id`) has already landed on `main-dev` (`c2a197c`), so the Python files below are cited as they stand after it. Rebase-only.

---

### Step 1 — test: Gating smoke test against the staging OTLP gateway (operator-run)

**Status**: `pending`
**Service**: none (a Grafana Cloud behavior check; results recorded in `context.md`)
**Files**:
- `docs/roadmap/features/337-metrics-host-provider-label/context.md` — modify (record the outcome only)

**Reviewers**: none

**Codebase Evidence**:
- Header forms: `docs/patterns/observability.md:57` documents `OTEL_EXPORTER_OTLP_HEADERS` as stored `Basic <base64>` with the deploy workflow prefixing `Authorization=`, and states the percent-encoded `Authorization=Basic%20…` form is also accepted; the operator uses that form in their own shell (read directly: `docs/setup/grafana-cloud.md:177` is the "Secret format: just `Basic <token>`" note).
- Existing pattern: no OTLP push helper exists in `scripts/` (`ls scripts` shows none), so the probe is an inline script run from the operator's shell with the staging token; nothing is committed.
- `design.md` Chosen Approach, Step 1; `debate.md` D-9, D-13, D-19; `fails.md:3473` (quoted third-party output is smoke tested before it is promoted).
- Python `opentelemetry-sdk` and `opentelemetry-exporter-otlp-proto-http` are the services' own dependencies (`services/xstockstrat-analysis/pyproject.toml:15-16`).

**TDD**: `N/A (operator-run gate against a third-party system; no repo code)`

**Covers**: `AC-12, AC-17, AC-22`

**Instructions**:
1. Present this step to the operator and obtain explicit approval naming the manual step ("push one smoke datapoint to the staging OTLP gateway from your own shell with the staging token") before running anything; record the approval in `context.md` (`@AC-12`, F-10).
2. The operator exports `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<token>` (the staging stack, the same token DO dev and homelab staging use) and runs, from a directory outside the repo, a probe script with `uv run --with opentelemetry-sdk --with opentelemetry-exporter-otlp-proto-http python3 -I probe.py`. The script builds a `Resource` with `service.name=smoke-337`, `deployment.environment=smoke`, `host.provider=unknown`, `service.instance.id=smoke-337`; a `MeterProvider` with a `PeriodicExportingMetricReader(OTLPMetricExporter())`; then records counter `smoke337.probe` once with datapoint attribute `host.provider="homelab"`, and counter `smoke337.join` twice (once with no attribute, once with `host.provider="homelab"`); then `force_flush()` and `shutdown()`. `OTEL_RESOURCE_ATTRIBUTES` must be unset.
3. Within 5 minutes, using the Grafana MCP (`query_prometheus`, datasource `grafanacloud-prom`) or the Grafana UI:
   - `@AC-17`: `smoke337_probe_total{deployment_environment="smoke"}` returns exactly one series with `host_provider="homelab"`, and its label names (`list_prometheus_label_names` with that selector) contain `host_provider` and not `host.provider`.
   - `@AC-22`: `last_over_time(smoke337_join_total{deployment_environment="smoke"}[15m])` joined to `target_info{deployment_environment="smoke"}` with `* on (job, instance, deployment_environment) group_left (host_provider) group by (job, instance, deployment_environment, host_provider) (...)`. The form with `sum without (host_provider) (...)` around the left operand returns exactly 1 row with value 2. The form without it either errors with a many-to-one / duplicate-labels message, or its non-reproduction is recorded in `context.md` (the pre-aggregation stays as a defensive measure and the RED sentence of `@AC-22` is reworded before promotion, D-19).
4. Record in `context.md`: the header form used, the raw query results, and that the `smoke` environment will appear in `$environment` dashboard variables until its series go stale (D-13).
5. GREEN for `@AC-17` and `@AC-22` gates Steps 2-9. RED on `@AC-17` stops the feature (return to `/sdd-design`).

**Verification**:
Observed (not scripted): the two Grafana results above, recorded in `context.md`. `git status --porcelain` shows only `context.md` changed.

---

### Step 2 — service: Go exporter wrapper in trading, portfolio and marketdata

**Status**: `pending`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/hostlabel.go` — create
- `services/xstockstrat-trading/internal/telemetry/otel.go` — modify
- `services/xstockstrat-portfolio/internal/telemetry/hostlabel.go` — create
- `services/xstockstrat-portfolio/internal/telemetry/otel.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/hostlabel.go` — create
- `services/xstockstrat-marketdata/internal/telemetry/otel.go` — modify

**Reviewers**: xstockstrat-trading owner — telemetry-only change, order paths untouched; xstockstrat-portfolio owner — no P&L or snapshot path touched; xstockstrat-marketdata owner — no ingestion path touched; Platform Lead — one mechanism across runtimes

**Codebase Evidence**:
- Confirmed via: `grep -n "otlpmetrichttp.New\|newResource(ctx)\|NewPeriodicReader\|func hostProvider\|func newResource" services/xstockstrat-{trading,portfolio,marketdata}/internal/telemetry/otel.go` → `:49`, `:58`, `:72`, `:124`, `:134` in all three (the three files differ only in the `serviceName()` default at `:119` and the label-key block from `:309`).
- Existing pattern: `mexp, err := otlpmetrichttp.New(ctx)` (`otel.go:49`); `mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(sdkmetric.NewPeriodicReader(mexp)), sdkmetric.WithResource(res), sdkmetric.WithView(serverMetricViews()...))` (`:71-75`); `func newResource(ctx context.Context)` begins `p := hostProvider()` and sets `attribute.String("host.provider", p)` (`:134-143`); `hostProvider()` is the exact-lowercase normaliser (`:124-130`).
- `newResource` callers: `grep -rn "newResource(" services/xstockstrat-*/internal` → `otel.go:58` and `otel_test.go:69` only (per service). No other caller.
- Pinned SDK read in this session (`go mod download`): `go.opentelemetry.io/otel/sdk/metric@v1.45.0` `exporter.go` `Exporter` has exactly `Temporality`, `Aggregation`, `Export(ctx, *metricdata.ResourceMetrics)`, `ForceFlush`, `Shutdown`; `metricdata/data.go` `Gauge[N]` `:52`, `Sum[N]` `:61`, `Histogram[N]` `:91`, `ExponentialHistogram[N]` `:132`, each with `DataPoints` whose `Attributes attribute.Set` (`:78,106,147`); `periodic_reader.go:242-262` zeroes and pools the `ResourceMetrics` after `Export`. `go.opentelemetry.io/otel@v1.45.0` `attribute/set.go`: `func NewSet(kvs ...KeyValue) Set` `:209`, `func (l *Set) ToSlice() []KeyValue` `:165`.
- `recon.md` Mechanism matrix: `instrument.go:131-158` and `view.go:100-110` (a Go View only filters attributes), `reader.go:44-96` (sealed). Aggregators reassign datapoints on each collect (`internal/aggregate/sum.go:114,250,291`, `histogram.go:205,386`, `lastvalue.go:124`), so assigning `DataPoints[i].Attributes` inside `Export` is safe.
- Not read: `otlpmetrichttp@v1.45.0` encoder source; the wire test in Step 3 is the proof.
- Break radius: no signature of an exported symbol changes; `newResource` is package-private.

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
In each of the three services:
1. Create `internal/telemetry/hostlabel.go` (`package telemetry`, ~55 lines). Define `hostLabelExporter` embedding `sdkmetric.Exporter` (so `Temporality`, `Aggregation`, `ForceFlush` and `Shutdown` are forwarded), with fields for the provider attribute (`attribute.String("host.provider", provider)`), a `stamp func(attribute.Set) attribute.Set` seam defaulting to the real stamping function, and a per-instance warn-once guard (`sync.Once`). Constructor `newHostLabelExporter(inner sdkmetric.Exporter, provider string) sdkmetric.Exporter`.
2. `Export(ctx, rm)`: in a function guarded by `defer recover()`, walk `rm.ScopeMetrics[i].Metrics[j].Data` with a type switch over the 8 concrete types (`metricdata.Gauge[int64|float64]`, `Sum[...]`, `Histogram[...]`, `ExponentialHistogram[...]`). Index into `DataPoints[k]` (a `for _, dp := range` assigns to a copy and is a silent no-op, D-8). First loop: compute every new `attribute.Set` into a staging slice (build with `ToSlice()`, drop any existing `host.provider` key, append the wrapper's, `attribute.NewSet`). Second loop: commit the staged sets. A panic in the first loop therefore leaves the batch untouched. On any panic: log one `slog.Warn` containing `host_provider` (once per wrapper instance), and call `inner.Export(ctx, rm)` with the original, unlabelled batch. Always return the inner exporter's result.
3. Summary datapoints (`metricdata.Summary`) are not produced by the OTel SDK instruments and are left unlabelled; say so in the file's one constraint comment (max 2 lines, CLAUDE.md "How to Act" 5).
4. In `otel.go` `Init`: hoist `p := hostProvider()` above the resource build, change `newResource(ctx context.Context)` to `newResource(ctx context.Context, p string)` (drop its internal `p := hostProvider()`), call `newResource(ctx, p)` at `:58`, and construct `sdkmetric.NewPeriodicReader(newHostLabelExporter(mexp, p))` at `:72`. `hostProvider()` is read once per `Init` (D-6, FR-2); the wrapper exists only after the `OTEL_ENABLED` early return at `:40`. `serverMetricViews()` is unchanged.
5. Update the single `newResource(context.Background())` call at `otel_test.go:69` to `newResource(context.Background(), hostProvider())` in the same commit (Step 3 owns the file).
6. Implement in two moves so Step 3's RED is a behavior failure, not a compile error (D-20): first commit-local a pass-through stub (`newHostLabelExporter` returns `inner`), run Step 3's tests red, then replace it with the real wrapper.

**Verification**:
```bash
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod) || exit 1; done
grep -n "newHostLabelExporter(mexp, p)\|newResource(ctx, p)" services/xstockstrat-{trading,portfolio,marketdata}/internal/telemetry/otel.go
git diff --exit-code -- 'services/*/go.mod' 'services/*/go.sum'   # must exit 0: golangci-lint --modules-download-mode=mod is known to rewrite go.mod (fails.md:3853)
```

---

### Step 3 — test: Go wrapper unit tests and wire tests

**Status**: `pending`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/hostlabel_test.go` — create
- `services/xstockstrat-trading/internal/telemetry/otel_test.go` — modify
- `services/xstockstrat-portfolio/internal/telemetry/hostlabel_test.go` — create
- `services/xstockstrat-portfolio/internal/telemetry/otel_test.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/hostlabel_test.go` — create
- `services/xstockstrat-marketdata/internal/telemetry/otel_test.go` — modify

**Reviewers**: xstockstrat-trading owner — telemetry-only change, order paths untouched; xstockstrat-portfolio owner — no P&L or snapshot path touched; xstockstrat-marketdata owner — no ingestion path touched

**Codebase Evidence**:
- Confirmed via: `grep -n "^func Test\|^func newOTLPReceiver\|^func startTelemetry\|^func exportedResource\|^type syncBuffer" services/xstockstrat-trading/internal/telemetry/otel_test.go` → `TestNewResourceOmitsTradingMode :48`, `newOTLPReceiver :104`, `startTelemetry :140`, `exportedResource :264`, `TestExportedSignalsCarryHostProvider :310`, `TestServerDurationRecordsStatusCode :361`, `syncBuffer :505`.
- Existing pattern: `TestExportedSignalsCarryHostProvider` runs the real `Init` against an `httptest` OTLP receiver and decodes the body with `colmetrics.ExportMetricsServiceRequest` but asserts resource attributes only (`:310-341`); `TestServerDurationRecordsStatusCode` drives a real gRPC server wrapped by `otelgrpc.NewServerHandler` over `bufconn` (`:361-`), the seam for `@AC-18` (trading row).
- Existing wire/label tests that must stay green unedited (`@AC-8`): `telemetry_allowlist_test.go` (`TestAllowlist_AC41_EveryLabelKeyIsATelemetryConstant`), `instruments_test.go:247` (`TestServerMetricViewsUnchangedAndNoClientInstruments`), `otel_test.go` — they build bare `NewManualReader` providers, not `Init`, so the exporter wrapper is invisible to them (`recon.md` Tests section).
- C-13: the fake inner exporter and batch builders have a second consumer only within the same `hostlabel_test.go` file per service; inline in that file, no `internal/testdata/` home is created. `grep -rn "fakeExporter" --include="*_test.go" services/xstockstrat-trading` must show one declaration site.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: `AC-2, AC-5, AC-8, AC-13, AC-15, AC-18, AC-21`

**Instructions**:
In each service (table-driven, one file each, ~100 lines):
1. `hostlabel_test.go` with a fake `sdkmetric.Exporter` recording `Export` batches and forward counts. Behaviors:
   - B1 `@AC-5`: two batches of 2 datapoints each, `stamp` seam set to panic from its 2nd call: the fake receives both original batches with no `host.provider` added and unchanged values, and exactly one warning containing `host_provider` is logged (capture with `slog.SetDefault` over a `bytes.Buffer`/`syncBuffer`, `otel_test.go:505`).
   - B2 `@AC-13`: a datapoint already carrying `host.provider="x", outcome="ok"` exports with exactly one `host.provider` key `homelab` and `outcome="ok"`; the input batch afterwards has `host.provider="homelab"` (Go assigns in place, so the Examples column says `homelab`).
   - B3/B4 `@AC-21`: a fake inner preferring DELTA for counters: `Temporality(sdkmetric.InstrumentKindCounter)` reports DELTA; one `ForceFlush` and one `Shutdown` reach the inner exporter exactly once. Mark "red N/A, characterization" (embedding forwards them from the stub).
   - B5 `@AC-15`: one `ResourceMetrics` holding Gauge, Sum, Histogram and ExponentialHistogram over `int64` and `float64` (8 datapoints), all carry `host.provider="homelab"` after `Export`; the table must fail when the implementation uses `for _, dp := range`.
2. `otel_test.go`: extend `TestExportedSignalsCarryHostProvider` (or add a sibling test next to it) with a helper decoding datapoint attributes from the `/otlp/v1/metrics` request (`colmetrics` + `metricspb`), asserting every datapoint carries `host.provider="homelab"` equal to the request resource's `host.provider` (`@AC-2`, D-6); add the `HOST_PROVIDER="Homelab"`-style normaliser check only where it already exists. This datapoint assertion is the RED for `@AC-2` against the pass-through stub (D-20).
3. Trading only (`@AC-18`): a wire test that drives a real unary RPC through `grpc.NewServer(grpc.StatsHandler(otelgrpc.NewServerHandler()))` using the global provider installed by `Init` (not `otelgrpc.WithMeterProvider`), flushes, and asserts the decoded `rpc.server.duration` datapoint keys are exactly `rpc.grpc.status_code, rpc.method, rpc.service, rpc.system, host.provider`; the in-memory side (`TestServerDurationRecordsStatusCode`) already pins the four keys.
4. Update the `newResource` call at `otel_test.go:69` (done in Step 2's file list; the edit is part of this unit).

**Verification**:
```bash
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off go test ./... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod) || exit 1; done
git diff --exit-code -- 'services/*/go.mod' 'services/*/go.sum'   # must exit 0 (fails.md:3853)
```
`internal/telemetry` is excluded from CI coverage measurement (`-coverpkg` filter drops `telemetry`, `docs/patterns/ci-overview.md`): new logic is in an excluded package — no coverage threshold applies; the wire and unit tests are the verification. Confirm the pass-through-stub run is red and the real run is green, and `git diff --stat -- '*/go.mod' '*/go.sum'` is empty.

---

### Step 4 — service: Node leaf exporter wrapper (config, identity, ledger, notify)

**Status**: `pending`
**Service**: `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-config/src/telemetry.ts` — modify
- `services/xstockstrat-identity/src/telemetry.ts` — modify
- `services/xstockstrat-ledger/src/telemetry.ts` — modify
- `services/xstockstrat-notify/src/telemetry.ts` — modify

**Reviewers**: xstockstrat-config owner — WatchConfig stream stability, no config key added; xstockstrat-identity owner — JWT and secret paths untouched; xstockstrat-ledger owner — append-only invariant untouched; xstockstrat-notify owner — stream delivery untouched; Platform Lead — one mechanism across runtimes

**Codebase Evidence**:
- Confirmed via: `grep -n "function hostProvider\|export function buildResource\|new OTLPMetricExporter\|PeriodicExportingMetricReader\|views: rpcDurationViews" services/xstockstrat-{config,identity,ledger,notify}/src/telemetry.ts` → config `:27,36,188,187,192`; identity `:28,37,189,188,193`; ledger `:28,37,189,188,193`; notify `:29,38,190,189,194` (hostProvider, buildResource, exporter, reader, views; line offsets differ per leaf, so each leaf cites its own).
- Existing pattern (ledger): `const sdk = new NodeSDK({ resource: buildResource(), spanProcessors: [...], metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), ...metricIntervalOptions() }), logRecordProcessor: ..., views: rpcDurationViews(), ... })` (`:183-198`); `buildResource()` returns `new Resource({ ..., 'host.provider': provider })` (`:37-47`); `initTelemetry()` returns at `if (process.env.OTEL_ENABLED !== 'true') return;` before the `try` (config `:154`, identity/ledger `:155`, notify `:156`) and the whole init is in `try/catch` that only warns (`'[otel] init failed — continuing without tracing:'`, config `:203`, identity/ledger `:204`, notify `:205`).
- Dependencies: `@opentelemetry/sdk-metrics ^1.25.0` is already a direct dependency of all four leaves (`package.json` ledger `:41`; same in config `:38`, identity `:40`, notify `:41`); `@opentelemetry/core` is not, so the export callback type is derived with `Parameters<PushMetricExporter['export']>[1]` rather than imported. No `package.json` or lockfile change.
- Pinned SDK facts (`recon.md` Mechanism matrix, `sdk-metrics` 1.25.1): `View.d.ts:32` and `index.d.ts:19` (no way to add an attribute from a View); `PeriodicExportingMetricReader.js:31-35` (the reader binds `selectAggregationTemporality` / `selectAggregation` from the exporter at construction, so they must be `.bind(inner)`); `HashMap.js:36-37` (datapoint `attributes` can be the aggregation key, so the wrapper copies and never mutates).
- tsconfig: `strict: false`, `module: commonjs`, tests compiled (`tsconfig.json` `include: ["src/**/*"]`).
- Break radius: `buildResource` is exported and called by `telemetry.test.ts`; its signature is not changed.

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
In each leaf's `src/telemetry.ts`:
1. Add `import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';` and an exported `withHostProvider(inner: PushMetricExporter, provider: string): PushMetricExporter` (~30 lines).
2. It returns a new object: `export(metrics, resultCallback)` builds a labelled copy inside `try/catch` (new `scopeMetrics[].metrics[].dataPoints[]` with `attributes: { ...dp.attributes, 'host.provider': provider }`; the spread plus later key overwrites an existing `host.provider`, and the input is never mutated), then calls `inner.export(copy, resultCallback)`. On any throw: `console.warn` one line containing `host_provider` (once per wrapper instance, a closure flag) and `inner.export(metrics, resultCallback)` with the original object. `selectAggregationTemporality` and `selectAggregation` are `inner.selectX?.bind(inner)` (omit when the inner has none); `forceFlush` and `shutdown` delegate.
3. In `initTelemetry()` keep the existing `OTEL_ENABLED` early return. Build the resource once: `const resource = buildResource();`, pass `resource` to `NodeSDK`, and read `const provider = String(resource.attributes['host.provider']);` (D-6; one read of `HOST_PROVIDER`, FR-2). Replace `exporter: new OTLPMetricExporter()` with `exporter: withHostProvider(new OTLPMetricExporter(), provider)`. `views: rpcDurationViews()`, `metricIntervalOptions()` and the rest are unchanged.
4. Pass-through stub first (`return inner;`) so Step 5's tests compile and fail on assertions, then the real body (D-20).

**Verification**:
```bash
for s in config identity ledger notify; do (cd services/xstockstrat-$s && pnpm run lint && pnpm exec tsc --noEmit) || exit 1; done
grep -n "withHostProvider(new OTLPMetricExporter()" services/xstockstrat-{config,identity,ledger,notify}/src/telemetry.ts
```

---

### Step 5 — test: Node leaf wrapper unit tests and wire tests

**Status**: `pending`
**Service**: `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-config/src/__tests__/telemetry.hostProvider.test.ts` — create
- `services/xstockstrat-config/src/__tests__/telemetry.export.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/telemetry.hostProvider.test.ts` — create
- `services/xstockstrat-identity/src/__tests__/telemetry.export.test.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/telemetry.hostProvider.test.ts` — create
- `services/xstockstrat-ledger/src/__tests__/telemetry.export.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/telemetry.hostProvider.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/telemetry.export.test.ts` — modify

**Reviewers**: xstockstrat-config owner — WatchConfig stream stability; xstockstrat-identity owner — JWT and secret paths untouched; xstockstrat-ledger owner — append-only invariant untouched; xstockstrat-notify owner — stream delivery untouched

**Codebase Evidence**:
- Confirmed via: `grep -n "exports a recorded counter" services/xstockstrat-{config,identity,ledger,notify}/src/__tests__/telemetry.export.test.ts` → config `:130`, identity `:91`, ledger `:124`, notify `:126`.
- Existing pattern: the export test runs the real `initTelemetry()` against an in-process `createServer` OTLP/JSON receiver (`before` sets `HOST_PROVIDER=homelab`, `OTEL_METRIC_EXPORT_INTERVAL=100`, ledger `:78-95`), decodes `JSON.parse(req.body).resourceMetrics[0]...` and asserts resource attributes only (ledger `:124-146`); child-process runs with env overrides go through `runChild(code, headers, onLine, env)` (ledger `:220`, used with `{ HOST_PROVIDER: 'aws' }` at `:313`).
- Fixtures: `src/__tests__/fixtures/collectingReader.ts` (`install`, `points`, `values`, byte-identical in the four leaves) is the in-memory reader for the unchanged allowlist tests (`@AC-8`): `telemetryAllowlist.test.ts`, `telemetryInstruments.test.ts`, `notify/src/__tests__/fanout.test.ts:192` (exact keys `['channel','outcome']`) stay green with no edit because the wrapper exists only inside `initTelemetry`.
- Config instruments for `@AC-3`: `setListenerUp` (`telemetry.ts:328`), `recordWatchTerminated` (`:343`), gauges/counters `config.listener_up` (`:320`) and `config.watch.terminated` (`:325`).
- C-13: the fake inner exporter and `ResourceMetrics` builder are used by one file per leaf (`telemetry.hostProvider.test.ts`); inline there, no new home. `grep -rn "fakeExporter" services/xstockstrat-ledger/src/__tests__` shows one declaration.

**Lands with**: `Step 4`

**TDD**: `red-green required` (wire assertions and B1/B2 are RED against the stub; B3/B4 and Node B6 are "red N/A, characterization", `tdd-gate.md:55-58`)

**Covers**: `AC-2, AC-3, AC-4, AC-5, AC-8, AC-13, AC-14, AC-21`

**Instructions**:
1. In each leaf, create `telemetry.hostProvider.test.ts` (`node:test`, table-driven, fake inner `PushMetricExporter` recording `export` args and flush/shutdown counts):
   - B1 `@AC-5`: a `ResourceMetrics` whose `scopeMetrics` getter throws (D-14); the fake receives that identical object, exactly one `console.warn` containing `host_provider` over two exports (per-instance warn-once, O-36).
   - B2 `@AC-13`: a datapoint `{ 'host.provider': 'x', outcome: 'ok' }` exports with exactly one `host.provider` key `homelab` and `outcome: 'ok'`; the input afterwards still has `'x'` (Node copies).
   - B3 `@AC-21`: `selectAggregationTemporality` / `selectAggregation` return the inner's answers through `.bind(inner)` (a fake that reads `this`); B4: one `forceFlush` and one `shutdown` reach the inner.
2. In each leaf's `telemetry.export.test.ts`, extend the counter test (`exports a recorded counter …`) to decode `scopeMetrics[].metrics[].sum.dataPoints[].attributes` and assert `host.provider="homelab"` on every datapoint, equal to the resource's `host.provider` (`@AC-2`, D-6).
3. Ledger only: a `runChild` case with `HOST_PROVIDER: 'Homelab'` asserting datapoint and resource both `unknown` (`@AC-4`); a `runChild` case with `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta'` recording a counter and asserting the decoded `sum.aggregationTemporality` is `1` and the datapoint carries `host.provider="homelab"` (`@AC-14`; the `delta` env is not read anywhere in the services, `grep -rn "TEMPORALITY" services/*/src` is empty, so only a wire test can prove forwarding).
4. Config only (`@AC-3`): after `initTelemetry()`, `setListenerUp(true)` and `recordWatchTerminated('client_error')`, flush, and assert the decoded datapoints of `config.listener_up` and `config.watch.terminated` each carry `host.provider="homelab"` and the latter still carries `reason="client_error"`.

**Verification**:
```bash
for s in config identity ledger notify; do (cd services/xstockstrat-$s && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40) || exit 1; done
```

---

### Step 6 — service: UI exporter wrapper

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/telemetry.ts` — modify

**Reviewers**: xstockstrat-ui owner — telemetry module only, no route, segment or component change; Platform Lead — one mechanism across runtimes

**Codebase Evidence**:
- Confirmed via: `grep -n "function hostProvider\|const provider = hostProvider\|resourceFromAttributes(\|new OTLPMetricExporter\|PeriodicExportingMetricReader" services/xstockstrat-ui/src/telemetry.ts` → `:16`, `:44`, `:52`, `:64`, `:34` (require) and `:63` (use).
- Existing pattern: `new NodeSDK({ resource: resourceFromAttributes({ ... 'host.provider': provider, 'service.instance.id': `${provider}-${serviceName}` }), traceExporter: ..., metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), ...metricIntervalOptions() })], ... })` (`:51-67`); the OTEL_ENABLED early return is `:22`; init is in `try/catch` that only warns (`:77`).
- Pinned SDK: `@opentelemetry/sdk-metrics ^2.7.1`, `sdk-node ^0.218.0` (`package.json:64`, `:34`). 2.x differs from the leaves (`recon.md`: `View.d.ts:36` allows an `attributesProcessors` view, rejected as `R-3`), so this is its own step; the `selectAggregationTemporality` / `selectAggregation` binding facts are the same (`recon.md` "Cross-cutting SDK facts").
- Break radius: `initTelemetry` is the only export; no importer changes. `src/lib/bffMetrics.ts` and `bffAllowlist.test.ts:98-102` are untouched (the wrapper is not on the test provider).
- No `package.json` or lockfile change (`@opentelemetry/sdk-metrics` is already a dependency).

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. Add a type import of `PushMetricExporter` and `ResourceMetrics` from `@opentelemetry/sdk-metrics` and an exported `withHostProvider(inner, provider)` with the same behavior as the leaves' wrapper (Step 4 item 2): copy, never mutate; per-instance warn-once via `console.warn` containing `host_provider`; `.bind(inner)` for both selectors when present; delegate `forceFlush`/`shutdown`; on a throw export the original object.
2. In `initTelemetry`, extract the existing `resourceFromAttributes({...})` into `const resource = ...`, pass it as `resource`, read `const stamped = String(resource.attributes['host.provider']);`, and set `exporter: withHostProvider(new OTLPMetricExporter(), stamped)`. Keep the `OTEL_ENABLED` early return and `metricIntervalOptions()`.
3. Pass-through stub first, then the real body (D-20).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
grep -n "withHostProvider(new OTLPMetricExporter()" src/telemetry.ts
```

---

### Step 7 — test: UI wrapper unit test and wire tests

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/telemetry.hostProvider.test.ts` — create
- `services/xstockstrat-ui/src/instrumentation.testkit.ts` — modify
- `services/xstockstrat-ui/src/instrumentation.delta.test.ts` — create

**Reviewers**: xstockstrat-ui owner — `bffAllowlist.test.ts` label-allowlist parity unchanged

**Codebase Evidence**:
- Confirmed via: `grep -n "defineExportSuite\|exports a recorded counter" services/xstockstrat-ui/src/instrumentation.testkit.ts services/xstockstrat-ui/src/instrumentation.test.ts` → testkit `:36`, counter test at `:128`; both `instrumentation.test.ts:1` and `instrumentation.encoded-header.test.ts:1` import it (one header form per file because the OTel globals are set once per process).
- Existing pattern: `beforeAll` sets `HOST_PROVIDER=homelab`, `OTEL_METRIC_EXPORT_INTERVAL=100` and calls `register()` from `./instrumentation` (testkit `:70-84`); the counter test decodes `resourceMetrics[0].resource.attributes` only (`:128-148`).
- `vitest.config.ts`: `include: ['src/**/*.test.ts']`, coverage scoped to `src/lib/**` with 40% thresholds (so `src/telemetry.ts` adds no coverage pressure).
- `bffAllowlist.test.ts:12-18,98-102` defines `CollectingReader` (a `MetricReader` subclass) and pins `http.server.duration` keys `['xstk.segment','http.response.status_code','http.route','rpc.service']`; `src/lib/bffMetrics.ts:59-70` `recordBffDuration` writes `xstk.segment` + `http.response.status_code` plus `http.route` (REST) or `rpc.service` (Connect).
- C-12: a telemetry test uses no domain objects from `e2e/fixtures/` (`INVENTORY.md`); reserved sentinels and OTLP payload literals are scenario one-offs (exempt). No fixture module is added.

**Lands with**: `Step 6`

**TDD**: `red-green required` (as in Step 5)

**Covers**: `AC-2, AC-5, AC-8, AC-13, AC-14, AC-18, AC-21`

**Instructions**:
1. `telemetry.hostProvider.test.ts` (vitest): B1-B4 exactly as Step 5 item 1, importing `withHostProvider` from `./telemetry`.
2. `instrumentation.testkit.ts`: extend the counter test so every decoded datapoint carries `host.provider="homelab"` equal to the resource attribute (`@AC-2`); add a test that records `recordBffDuration` once with `route` (REST) and once with `rpcService` (Connect), flushes, and asserts the decoded `http.server.duration` datapoint keys are exactly `xstk.segment, http.response.status_code, http.route, host.provider` and `xstk.segment, http.response.status_code, rpc.service, host.provider`; for each, a `CollectingReader` provider (pattern of `bffAllowlist.test.ts:12-18`) records exactly the same keys minus `host.provider` (`@AC-18`). Both header-form files run it.
3. `instrumentation.delta.test.ts`: set `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` before `defineExportSuite` is invoked (module top level), record a counter, and assert the decoded `sum.aggregationTemporality` is `1` and the datapoint carries `host.provider="homelab"` (`@AC-14`); it needs its own file because the globals are per process.
4. `@AC-8`: `bffAllowlist.test.ts`, `bffMetrics.test.ts` are not edited and must pass.

**Verification**:
E2E: the change is telemetry-only (no route, segment, page or BFF contract), so the existing Playwright suites are unaffected and not extended; the vitest wire tests below are the verification. Coverage: the vitest 40% threshold is scoped to `src/lib/**` (`vitest.config.ts`); `src/telemetry.ts` is outside it, so this step is gated by the new unit and wire tests plus the lint and duplication checks below, not by the threshold.
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:coverage && pnpm run lint:dup
```

---

### Step 8 — service: Python exporter wrapper (analysis, ingest, indicators, agent)

**Status**: `pending`
**Service**: `xstockstrat-analysis`, `xstockstrat-ingest`, `xstockstrat-indicators`, `xstockstrat-agent`
**Files**:
- `services/xstockstrat-analysis/app/telemetry.py` — modify
- `services/xstockstrat-ingest/app/telemetry.py` — modify
- `services/xstockstrat-indicators/app/telemetry.py` — modify
- `services/xstockstrat-agent/app/telemetry.py` — modify

**Reviewers**: xstockstrat-analysis owner — no backtest or scoring path touched; xstockstrat-ingest owner — no ingestion path touched; xstockstrat-indicators owner — formula sandbox untouched; xstockstrat-agent owner — no tool contract change; Platform Lead — one mechanism across runtimes

**Codebase Evidence**:
- Confirmed via: `grep -n "def _host_provider\|def _build_resource\|metric_exporter = OTLPMetricExporter()\|PeriodicExportingMetricReader(" services/xstockstrat-{analysis,ingest,indicators,agent}/app/telemetry.py` → analysis `:25,31,196,206`; ingest `:25,31,193,203`; indicators `:24,30,192,202`; agent `:17,23,76` (the agent has no `metric_exporter` local; it builds `PeriodicExportingMetricReader(OTLPMetricExporter())` inline at `:76`).
- Existing pattern (analysis): `resource = _build_resource()` (`:193`) then `metric_exporter = OTLPMetricExporter()` (`:196`) and `MeterProvider(resource=resource, metric_readers=[PeriodicExportingMetricReader(metric_exporter)])` (`:204-207`); the whole init is in `try/except Exception` that logs `"OTel init failed — continuing without tracing: %s"` (analysis `:227`, ingest `:222`, indicators `:221`, agent `:95`); the `OTEL_ENABLED` early return is first (analysis/ingest `:169`, indicators `:168`, agent `:46`). In `init_telemetry` the local name `provider` is the `TracerProvider`, so the stamped value needs another name.
- `_build_resource` already contains `"host.provider": provider` (analysis `:37-43`); 336 landed, so `service.instance.id` is `f"{provider}-{service_name}"` in all four.
- Deferred-import precedent: `_make_rpc_duration_processor` defines its class inside the factory (`analysis/app/telemetry.py:63`) so the SDK import stays lazy; the wrapper class follows it (the agent module's docstring requires lazy OTel imports, `agent/app/telemetry.py:3-4`).
- Pinned SDK (`recon.md`, `opentelemetry-sdk` 1.45.1; not installed in this environment, `python3 -c "import opentelemetry.sdk"` fails): datapoints are frozen dataclasses (`point.py:18-24`), rebuild with `dataclasses.replace`; the reader reads `exporter._preferred_temporality` / `_preferred_aggregation` (`export/__init__.py:93-99,434-435`) and calls `shutdown(timeout=...)` (`:541`). Not read: the Python `OTLPMetricExporter` source; Step 9's wire test is the proof.
- Existing tests that monkeypatch the exporter: `tests/test_telemetry_allowlist.py` `_counting_exporter` replaces `OTLPMetricExporter` with a factory that raises (the `test_ac42_failing_init_still_lets_the_service_start` path, `analysis :118-125`) or returns `object()`; the construction failure happens before the wrapper, and `getattr(..., default)` keeps a bare `object()` safe.
- No `pyproject.toml` change, so `uv.lock` is untouched (`opentelemetry-sdk>=1.25.0` is already declared, `analysis/pyproject.toml:15`).

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
In each module:
1. Add `_with_host_provider(exporter, host_provider: str)` (~35 lines) that imports `MetricExporter` lazily and returns an instance of a class defined inside the function: `__init__` calls `super().__init__(preferred_temporality=getattr(exporter, "_preferred_temporality", None), preferred_aggregation=getattr(exporter, "_preferred_aggregation", None))`; `_labelled(self, metrics_data)` rebuilds `MetricsData` -> `ResourceMetrics` -> `ScopeMetrics` -> `Metric` -> data (`Sum`, `Gauge`, `Histogram`, `ExponentialHistogram`) with `dataclasses.replace`, setting each point's `attributes={**point.attributes, "host.provider": host_provider}` (spread then key overwrites an existing `host.provider`); `export(self, metrics_data, *args, **kwargs)` tries `self._labelled(metrics_data)` inside `try/except Exception`, on failure logs one `log.warning` containing `host_provider` (once per instance, an instance flag) and exports the original `metrics_data`; `force_flush(self, *args, **kwargs)` and `shutdown(self, *args, **kwargs)` forward verbatim.
2. In `init_telemetry`, after `resource = _build_resource()`, read `host_provider = str(resource.attributes["host.provider"])` (D-6) and wrap: analysis/ingest/indicators `metric_exporter = _with_host_provider(OTLPMetricExporter(), host_provider)`; agent `PeriodicExportingMetricReader(_with_host_provider(OTLPMetricExporter(), host_provider))`.
3. Pass-through stub first (`return exporter`), then the real class (D-20).

**Verification**:
```bash
for s in analysis ingest indicators agent; do (cd services/xstockstrat-$s && uv run --extra dev --frozen ruff check . && uv run --extra dev --frozen ruff format --check .) || exit 1; done
grep -n "_with_host_provider(OTLPMetricExporter()" services/xstockstrat-{analysis,ingest,indicators,agent}/app/telemetry.py
```

---

### Step 9 — test: Python wrapper unit tests and wire tests

**Status**: `pending`
**Service**: `xstockstrat-analysis`, `xstockstrat-ingest`, `xstockstrat-indicators`, `xstockstrat-agent`
**Files**:
- `services/xstockstrat-analysis/tests/test_telemetry_host_provider.py` — create
- `services/xstockstrat-analysis/tests/test_telemetry.py` — modify
- `services/xstockstrat-ingest/tests/test_telemetry_host_provider.py` — create
- `services/xstockstrat-ingest/tests/test_telemetry.py` — modify
- `services/xstockstrat-indicators/tests/test_telemetry_host_provider.py` — create
- `services/xstockstrat-indicators/tests/test_telemetry.py` — modify
- `services/xstockstrat-agent/tests/test_telemetry_host_provider.py` — create
- `services/xstockstrat-agent/tests/test_telemetry.py` — modify

**Reviewers**: xstockstrat-analysis owner — no backtest or scoring path touched; xstockstrat-ingest owner — no ingestion path touched; xstockstrat-indicators owner — formula sandbox untouched; xstockstrat-agent owner — no tool contract change

**Codebase Evidence**:
- Confirmed via: `grep -n "def test_init_exports_metrics_and_logs_with_resource" services/xstockstrat-{analysis,ingest,indicators,agent}/tests/test_telemetry.py` → analysis `:180`, ingest `:179`, indicators `:179`, agent `:166`.
- Existing pattern (analysis): `_start_body_receiver` keeps `(path, auth, body)` (`:120-136`), `_enable` sets `OTEL_ENABLED`/endpoint/headers (`:139`), `_flush_all` force-flushes the three providers (`:145`); the test calls `init_telemetry()`, records `metrics.get_meter("t").create_counter("t.count").add(1)`, decodes `metrics_service_pb2.ExportMetricsServiceRequest` and asserts resource attributes only (`:180-225`); fixtures `otel_reset` (`tests/conftest.py:506`; agent `:302`) and `metric_reader` (analysis `test_telemetry.py:155`, ingest and indicators the same file; agent `tests/conftest.py:337`).
- `@AC-18` seams: agent `ToolMetricsMiddleware` (`app/tool_metrics.py:95`) `_record` creates `mcp.tool.duration` with `{"gen_ai.tool.name", "outcome"}` (`:111-120`); analysis `record_live_loop_cycle_duration(seconds)` (`app/telemetry.py:418`) records `analysis.live_loop.cycle.duration` with no attributes, pinned in memory by `tests/test_live_loop_telemetry.py:202` (`dict(point.attributes) == {}`).
- `@AC-8` files that must stay green unedited: `test_telemetry_allowlist.py` (`ALLOWED_KEYS`, `RPC_KEYS`), `test_ingest_telemetry.py:33`, `test_sandbox_telemetry.py:20,24`, `test_live_loop_telemetry.py:202` — they use in-memory readers, which never see the wrapper.
- Python wire decode uses protobuf (`opentelemetry.proto.collector.metrics.v1.metrics_service_pb2`), the Node leaves use OTLP/JSON, so Step 1's smoke covers the protobuf path only (Open Risk 1); the leaves' JSON path is proven by Step 5 and by Step 14.
- C-13: the fake inner exporter and dataclass batch builder live in the new per-service file (one consumer file); not placed in `tests/conftest.py`. `grep -n "class FakeExporter\|def _batch" services/xstockstrat-analysis/tests/*.py` must show one site.

**Lands with**: `Step 8`

**TDD**: `red-green required` (as in Step 5)

**Covers**: `AC-2, AC-5, AC-8, AC-13, AC-16, AC-18, AC-21`

**Instructions**:
1. In each service create `tests/test_telemetry_host_provider.py` with a fake inner `MetricExporter` subclass recording `export`/`force_flush`/`shutdown` args, preferring DELTA for counters:
   - B1 `@AC-5`: monkeypatch `_labelled` to raise; two exports reach the fake as the original batches with no `host.provider` added and unchanged values; `caplog` holds exactly one warning containing `host_provider`.
   - B2 `@AC-13`: a point `{"host.provider": "x", "outcome": "ok"}` exports with exactly one `host.provider` key `homelab`; the input batch still holds `"x"` (frozen dataclasses are rebuilt).
   - B3 `@AC-21`: `_preferred_temporality` equals the inner's (DELTA for a counter); B4: the inner receives exactly one `force_flush` and one `shutdown`.
   - `@AC-16`: a `PeriodicExportingMetricReader(wrapper)` inside a `MeterProvider`; `reader.shutdown()` returns without raising and the inner `shutdown` is called once with a `timeout` keyword.
2. In each `tests/test_telemetry.py`, extend `test_init_exports_metrics_and_logs_with_resource` (ingest/indicators: the same-named test at the lines above) so every datapoint decoded from the metrics request carries `host.provider` equal to `res["host.provider"]` (`@AC-2`, D-6); this assertion is the RED.
3. Agent: a wire test sending one tool call through `ToolMetricsMiddleware` and asserting the decoded `mcp.tool.duration` keys are exactly `gen_ai.tool.name, outcome, host.provider`, with the in-memory reader recording exactly `gen_ai.tool.name, outcome` (`@AC-18`). Analysis: a wire test calling `record_live_loop_cycle_duration(1.4)` asserting the decoded keys are exactly `host.provider` while the in-memory side is `{}` (`@AC-18`).

**Verification**:
```bash
(cd services/xstockstrat-analysis && uv run --extra dev --frozen ruff check . && uv run --extra dev --frozen ruff format --check . && uv run --extra dev --frozen pytest --cov=app --cov-fail-under=40) && \
(cd services/xstockstrat-ingest && uv run --extra dev --frozen ruff check . && uv run --extra dev --frozen ruff format --check . && uv run --extra dev --frozen pytest --cov=app --cov-fail-under=40) && \
(cd services/xstockstrat-indicators && uv run --extra dev --frozen ruff check . && uv run --extra dev --frozen ruff format --check . && uv run --extra dev --frozen pytest --cov=app --cov-fail-under=50) && \
(cd services/xstockstrat-agent && uv run --extra dev --frozen ruff check . && uv run --extra dev --frozen ruff format --check . && uv run --extra dev --frozen pytest --cov=app --cov-fail-under=40)
```
(thresholds: `.github/workflows/ci.yml:466-478`).

---

### Step 10 — docs: Preferred label query, pre-aggregated join, dashboards README

**Status**: `pending`
**Service**: `docs/patterns/`, `packages/otel/dashboards/`
**Files**:
- `docs/patterns/observability.md` — modify
- `packages/otel/dashboards/README.md` — modify (prose at `:47` only; no `*.json` or `alerts/*.yaml`, `@AC-11`)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n "lives only on\|Why \`group by\` before the join\|otel-guard:host-provider\|Post-deploy check\|The PromQL above returns\|Series budget\|first deploy with a fixed instance id" docs/patterns/observability.md` → `:68` ("`host_provider` is a resource attribute that lives only on `target_info`"), `:72`, the PromQL block (tag line `​```promql otel-guard:host-provider`, `:79`), the LogQL block, the post-deploy list at `:103-112` ("The PromQL above returns at least one series after one RPC" `:109`), Open risks `:117-`, "Series budget" `:123`.
- `packages/otel/dashboards/README.md:47`: "`host.provider` … is attached too, but in Prometheus it is only on `target_info`: query it through the join in `docs/patterns/observability.md`." (read in this session).
- The guard constraints this edit must keep: the existing `test_query_block_mutation` cases need these substrings in the join block: `on (job, instance, deployment_environment) group_left`, `target_info{deployment_environment="staging", host_provider="homelab"}`, `count{deployment_environment="staging", rpc_method`, `, <MATCHER>}[5m]`, a closing `\n)\n```\n` (`scripts/tests/test_check_otel_produced_signals.py`, the parametrization before `test_query_block_mutation` at `:400`); `test_the_host_provider_contract_stays_documented` requires the strings at `:419-436`; Part 3 scans the whole doc for asset names and `N dashboards`-style counts (`scripts/check-otel-produced-signals.py:332-349`), so the new prose adds no such count claim (`fails.md:3259`).
- Pipeline lines behind the shared-value claim (`fails.md:3988`): DO dev `HOST_PROVIDER` `.do/app.dev.yaml:34`; homelab `deploy/homelab/compose.yml:8` (a literal); DO prod `.do/app.yaml:34` (`OTEL_ENABLED=false`).

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. In `docs/patterns/observability.md` § "Separating DO and homelab": rewrite the "What Grafana promotes" bullet (`:67-68`) so it contains exactly the sentence "`host_provider` is a datapoint label on every metric series the workloads export, and also a resource attribute on `target_info`" (set by the exporter wrapper, feature 337; Step 12 asserts the substring "`host_provider` is a datapoint label on every metric series the workloads export"); logs are unchanged (`| host_provider="homelab"`).
2. Add, before the join block, a PromQL block tagged `promql otel-guard:host-provider-label` as the preferred form: `sum by (service_name, host_provider) (rate(rpc_server_duration_milliseconds_count{deployment_environment="staging", host_provider="homelab", <the stream matcher, byte-identical to the join block>}[5m]))`, with no `target_info`.
3. Keep the existing block under `promql otel-guard:host-provider` as the fallback and wrap its left operand: `sum without (host_provider) (rate(...{deployment_environment="staging", <matcher>}[5m]))` followed by the unchanged `* on (job, instance, deployment_environment) group_left (host_provider) group by (...) (target_info{...})`, and add one bullet saying why (for about 5 minutes after each stack's first labelled deploy, old unlabelled and new labelled series share one `instance`, and `group_left` would otherwise produce duplicate result label sets, D-12).
4. Post-deploy check (`observability.md:109`): replace the line "The PromQL above returns at least one series after one RPC." with exactly "Each PromQL block above returns at least 1 series after one RPC." (`@AC-20`; Step 12 asserts this literal).
5. Open risks: add a bullet that the first deploy of this label forks each series once (the old unlabelled series go stale after about 5 minutes) on DO dev, homelab staging and homelab production. Leave the "Series budget" line for Step 15 (it needs the measurement).
6. In `packages/otel/dashboards/README.md:47`, replace the "only on `target_info`" sentence with: `host.provider` is attached to the resource and is also the datapoint label `host_provider` on every metric the workloads export, so filter directly with `{host_provider="homelab"}`; the `target_info` join in `docs/patterns/observability.md` is the fallback.

**Verification**:
```bash
git diff --name-only origin/main-dev...HEAD -- 'packages/otel/dashboards/*.json' 'packages/otel/alerts/*.yaml'   # must print nothing
python3 scripts/check-otel-produced-signals.py
(cd scripts && uv run --extra dev --frozen pytest tests/test_check_otel_produced_signals.py)
```

---

### Step 11 — service: Guard Part 6 checks each tag with its own rules

**Status**: `pending`
**Service**: `scripts/` (`scripts/check-otel-produced-signals.py`)
**Files**:
- `scripts/check-otel-produced-signals.py` — modify

**Reviewers**: Platform Lead — cross-service consistency of the observability guard

**Codebase Evidence**:
- Confirmed via: `grep -n "QUERY_TAG\|PROMQL_JOIN\|def check_query_blocks\|def query_blocks\|def query_block_misses\|def check_streams" scripts/check-otel-produced-signals.py` → `QUERY_TAG :48`, `PROMQL_JOIN :49-52`, `check_query_blocks :369`, `query_blocks :471`, tag match `:483`, `query_block_misses :496`, `check_streams :232`.
- Existing pattern: `check_query_blocks` loops `(("promql","AC-10"),("logql","AC-11"))`, requires exactly one block per language (`:376-384`), runs `self.check_expr(OBS_DOC, ln, expr)` (Part 1 registration plus the `AC-17 P4` stream matcher via `check_streams`, `:232-237`) and appends `query_block_misses` rows; `hit()` formats `"{ac} {tag} {rel}:{line}: {text}"` (`:174-175`).
- Break radius: `query_blocks` and `query_block_misses` are called only inside the same file (`grep -rn "query_blocks\|query_block_misses" scripts .github` → only `check-otel-produced-signals.py:371,390,471,496`); no test imports them directly.
- `query_blocks` matches the tag line by equality (`line == f"```{kind} {QUERY_TAG}"`, `:483`), so the new tag `otel-guard:host-provider-label` is invisible to the old guard and not a prefix match.

**Lands with**: `Step 12`

**TDD**: `red-green required` (Step 12's tests are written first and run RED against the unchanged guard; both steps then land as one commit)

**Covers**: `—`

**Instructions**:
1. Add constants next to `QUERY_TAG` (`:48`): `LABEL_TAG = "otel-guard:host-provider-label"` and `JOIN_PREAGG = "sum without (host_provider) ("`.
2. Make `query_blocks` recognise both tags and return the tag with each block (a 4-tuple, adjusting the single caller).
3. In `check_query_blocks`: keep the existing logic for blocks tagged `QUERY_TAG` unchanged (rows stay `AC-10 P6` / `AC-11 P6`). Add: exactly one `promql` block tagged `LABEL_TAG` (otherwise `337-AC-9 P6 ... expected exactly one promql otel-guard:host-provider-label block, found N`); balanced; `self.check_expr` (so removing the stream matcher yields the existing `AC-17 P4` row); `rpc_server_duration_milliseconds_count` selector lacking `deployment_environment="staging"` or `host_provider="homelab"` yields `337-AC-9 P6`; any `target_info` in the block yields `337-AC-9 P6`. For the join block add `337-AC-19 P6` when `JOIN_PREAGG` is not in the whitespace-normalised expression (the substring-anywhere weakness is accepted, `design.md` Open Risks).

**Verification**:
```bash
python3 scripts/check-otel-produced-signals.py
cd scripts && uv run --extra dev --frozen ruff check . && uv run --extra dev --frozen ruff format --check .
```

---

### Step 12 — test: Guard mutation cases and documentation contract

**Status**: `pending`
**Service**: `scripts/` (`scripts/tests/test_check_otel_produced_signals.py`)
**Files**:
- `scripts/tests/test_check_otel_produced_signals.py` — modify

**Reviewers**: Platform Lead — cross-service consistency of the observability guard

**Codebase Evidence**:
- Confirmed via: `grep -n "def test_query_block_mutation\|def test_two_promql_blocks_fail\|def test_the_host_provider_contract_stays_documented\|^def sub\|^OBS =" scripts/tests/test_check_otel_produced_signals.py` → `OBS :336`, `sub :339`, `test_query_block_mutation :400`, `test_two_promql_blocks_fail :405`, `test_the_host_provider_contract_stays_documented :419`.
- Existing pattern: `test_query_block_mutation` is parametrized by `(old, new, needles)` against `docs/patterns/observability.md` in a copied tree and calls `assert_hit`; `test_two_promql_blocks_fail` appends a second ```` ```promql otel-guard:host-provider ```` block and expects `found 2` (it stays valid: the join tag is unchanged and the label tag is a distinct tag, so it is not inverted); the pristine tree copies `docs/patterns`, `packages/otel`, `platform.feature` (`:45-70`).
- CI: `cd scripts && uv run --extra dev --frozen pytest tests/test_check_otel_produced_signals.py` (`.github/workflows/ci.yml:1113-1116`).
- C-13: reuses `sub`, `append`, `rewrite`, `assert_hit`, `MATCHER` already in the file; no new fixture.

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: `AC-9, AC-19, AC-20`

**Instructions**:
1. Add cases to the `test_query_block_mutation` parametrization (or a sibling parametrized test) asserting `337-AC-9 P6 {OBS}:` when, in the label block only: `host_provider="homelab"` is removed from the selector; `deployment_environment="staging"` is removed; `target_info` is added. Assert `AC-17 P4 {OBS}:` when the stream matcher is removed from the label block. (The `sub()` helper replaces all occurrences, so anchor each `old` text on the label block's own selector text, which differs from the join block's.)
2. Add `test_two_label_blocks_fail`: append a second ```` ```promql otel-guard:host-provider-label ```` block and assert `337-AC-9 P6` and `found 2`.
3. Add `337-AC-19 P6` coverage: remove `sum without (host_provider) (` from the join block and assert the row.
4. Extend the documentation-contract test (`:419`) with the `@AC-20` strings: the label tag, the join tag, the exact substring "`host_provider` is a datapoint label on every metric series the workloads export", and the exact sentence "Each PromQL block above returns at least 1 series after one RPC.".
5. Prove RED first, in this order: write the Step 12 cases, run them against the unchanged guard (record in `context.md` that no `337-AC-*` row is produced and the new cases fail), then apply Step 11 and re-run to GREEN. Steps 11 and 12 are one atomic unit, so no intermediate commit has a red suite (F-05).

**Verification**:
Coverage: no threshold applies to `scripts/`; the `scripts-python` CI job (`ci.yml:860`, "ruff + pytest") runs lint and tests only.
```bash
(cd scripts && uv run --extra dev --frozen pytest tests/test_check_otel_produced_signals.py && uv run --extra dev --frozen ruff check . && uv run --extra dev --frozen ruff format --check .)
python3 scripts/check-otel-produced-signals.py
```

---

### Step 13 — docs: C-16 promotion into the durable suites (integration, operator-confirmed)

**Status**: `pending`
**Service**: `docs/sdd/business-rules/`, `services/xstockstrat-ui/acceptance/`, `services/xstockstrat-analysis/acceptance/`
**Files**:
- `docs/sdd/business-rules/platform.feature` — modify (append only, plus comment lines above existing scenarios)
- `services/xstockstrat-ui/acceptance/signal-map-instrumentation.feature` — modify (one comment above `@AC-36`)
- `services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature` — modify (one comment above `@AC-51`)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n "@AC-41 @FR-15 @feature-294\|@AC-10 @FR-5 @feature-332\|@AC-12 @FR-7 @feature-332" docs/sdd/business-rules/platform.feature` → `:1341`, `:2325`, `:2338`; `grep -n "@AC-36 @FR-11 @feature-294" services/xstockstrat-ui/acceptance/signal-map-instrumentation.feature` → `:29`; `grep -n "@AC-51 @FR-5 @feature-294" services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature` → `:36`.
- Existing pattern: promoted suites carry "Verbatim; do not edit by hand" headers (ui `:1`, analysis `:1`); supersede is a `# …` comment above the scenario, e.g. `platform.feature:17-21` (feature 282) and the 336 comment above `@AC-12 @feature-332` (`:2337`), `services/xstockstrat-indicators/acceptance/signal-map-instrumentation.feature:15`. D-17: no promoted scenario text is edited.
- Operator sign-off for the three CHANGEs is recorded in `context.md` (round-1 gate, 2026-11-12) and `design.md` § Business Rules Touched.
- `/sdd-execute` Step 2.5 (`.claude/skills/sdd-execute/SKILL.md:187-201`): promotion is an inline, operator-confirmed append (P-04), with `@feature-337` added to each promoted tag line; there is no scenario-promoter CONFLICT flow here.

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. Show the operator the append plan and obtain a yes before writing (P-04): promote the durable scenarios of `acceptance.feature` into `docs/sdd/business-rules/platform.feature` (their guarantee spans services), tagged `@feature-337`, preserving `@AC-*`/`@FR-*`. Proposed set at integration (code-verified): `@AC-2`..`@AC-5`, `@AC-8`, `@AC-9`, `@AC-13`..`@AC-16`, `@AC-18`..`@AC-21`. `@AC-1`, `@AC-6`, `@AC-7`, `@AC-10` and `@AC-11` are measured post-deploy, so they are promoted in Step 15 after Step 14 records them (a durable scenario never asserts an unmeasured guarantee). Not promoted: `@AC-12` (a design-time approval gate) and `@AC-17`/`@AC-22` (one-off smoke gates, D-19), unless the operator asks.
2. Add read-as comments (no text edit to any scenario) citing feature 337 and the `context.md` sign-off: above `@AC-41 @feature-294` (platform `:1341`), above ui `@AC-36` (`:29`), above analysis `@AC-51` (`:36`): "apart from the platform-wide `host.provider` export label (feature 337), added after aggregation, the keys are unchanged"; and above `@AC-10` (`:2325`) and `@AC-12` (`:2338`) of feature 332: "extended by 337 `@AC-9`, `@AC-19`, `@AC-20` (label query preferred, join pre-aggregated)". The design text counts "four" comments, but D-17 names these five anchors; the operator-confirmed plan decides the final set.
3. `grep -c "@feature-337" docs/sdd/business-rules/platform.feature` shows the promoted scenario count; the `@feature-332` scenario text is byte-identical apart from added comment lines.

**Verification**:
```bash
! git diff -U0 origin/main-dev...HEAD -- docs/sdd/business-rules/platform.feature services/xstockstrat-ui/acceptance services/xstockstrat-analysis/acceptance | grep -q '^-[^-]'   # no removed lines (append-only, D-17)
test "$(grep -c '@feature-337' docs/sdd/business-rules/platform.feature)" -eq 14   # @AC-2..5, 8, 9, 13..16, 18..21")
python3 scripts/check-otel-produced-signals.py
```

---

### Step 14 — test: Post-deploy verification on DO dev and homelab (operator-confirmed)

**Status**: `pending`
**Service**: none (live Grafana Cloud checks; results recorded in `context.md`)
**Files**:
- `docs/roadmap/features/337-metrics-host-provider-label/context.md` — modify (results only)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `acceptance.feature` `@AC-1` (`:7-11`), `@AC-6`, `@AC-7`, `@AC-10`, `@AC-11` carry the exact queries; the usage series `grafanacloud_instance_active_series` exists on datasource `grafanacloud-usage` (T0 = 2671, `context.md` round-2 gate); `@AC-10` UI check uses `http_server_duration_milliseconds_count` because the UI has no gRPC server (`src/lib/bffMetrics.ts:38`).
- Precondition: homelab staging must be exporting, i.e. `count(group by (job)(target_info{deployment_environment="staging", host_provider="homelab"})) >= 11` (`@AC-1` Given; not true at design time, `context.md` baseline). `fails.md:640-643`: a human confirms outstanding manual ACs before the promotion PR.

**TDD**: `N/A (post-deploy observation)`

**Covers**: `AC-1, AC-6, AC-7, AC-10, AC-11`

**Instructions**:
1. Run after the integration PR is merged and DO dev, homelab staging and homelab production have each deployed it; the later deploy starts the clocks.
2. `@AC-11` (can run pre-merge): the merged PR's changed paths contain no `packages/otel/dashboards/*.json` or `packages/otel/alerts/*.yaml`.
3. `@AC-1`: 10 minutes after the later deploy and one RPC to trading on each stack, run the `@AC-1` query; the result is exactly `digitalocean` and `homelab`, with no empty `host_provider`.
4. `@AC-10`: 10 minutes later, after one RPC to each of trading, portfolio, marketdata, ledger, identity, notify, config, analysis, ingest, indicators and one UI login: `count by (service_name)` of the label block and of the 332 join block return the same 10 `service_name` values; the UI `http_server_duration_milliseconds_count{deployment_environment="staging", host_provider="homelab", service_name="ui"}` count is at least 1; the join evaluated as a range query spanning the rollout returns no error (D-12, D-20). The agent is covered by wire tests only.
5. `@AC-6`: 30 minutes after the last deploy, first run `count by (__name__) ({deployment_environment="staging"})` to exclude Grafana-generated series (compare with T0), then record `max_over_time(grafanacloud_instance_active_series[1h])` (pass: below 10000), `count by (service_name) ({deployment_environment="staging", host_provider=""})` and the same for `"production"` (pass: no series), and `count({deployment_environment="staging"})` equals `count({deployment_environment="staging", host_provider!=""})` at one instant. Record raw numbers, not a percentage band (D-13).
6. `@AC-7`: LogQL `{service_name="analysis"} | host_provider="homelab"` and `target_info{host_provider="homelab"}` still return results.
7. Show the operator the recorded results and obtain confirmation before the `main-dev` to `main` promotion.

**Verification**:
```bash
# @AC-11: run on the feature branch before merge, must print nothing (after merge HEAD is on main-dev and the diff is vacuous;
# post-merge use: gh pr diff <integration-PR-number> --name-only | grep -E 'packages/otel/(dashboards/.*\.json|alerts/.*\.yaml)')
git diff --name-only origin/main-dev...HEAD -- 'packages/otel/dashboards/*.json' 'packages/otel/alerts/*.yaml'
# guard green on the deployed tree
python3 scripts/check-otel-produced-signals.py
# @AC-1 / @AC-10 / @AC-6 / @AC-7: run each query string from acceptance.feature against the stack
# (Grafana Cloud MCP query_prometheus on datasource grafanacloud-prom, query_loki_logs for the LogQL,
#  datasource grafanacloud-usage for grafanacloud_instance_active_series), or from the operator's shell:
#   curl -s -u "$PROM_USER:$PROM_READ_TOKEN" --data-urlencode "query=<query>" "$PROM_QUERY_URL/api/v1/query"
# ($PROM_USER, $PROM_READ_TOKEN and $PROM_QUERY_URL are the operator's own read credentials; never committed.)
```
Observed: each query's raw result is pasted into `context.md` with its timestamp and the pass condition it was judged against; the operator's confirmation is logged there.

---

### Step 15 — docs: Record the measured series delta in the cost line

**Status**: `pending`
**Service**: `docs/patterns/observability.md`
**Files**:
- `docs/patterns/observability.md` — modify
- `docs/sdd/business-rules/platform.feature` — modify (append only: the measured scenarios `@AC-1`, `@AC-6`, `@AC-7`, `@AC-10`, `@AC-11`, tagged `@feature-337`, operator-confirmed)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n "Cost (dev, 2026-10-31)\|Series budget" docs/patterns/observability.md` → the "Cost (dev, 2026-10-31)" bullet (`:40` before Step 10) and the "Series budget" bullet (`:123` before Step 10; Step 10 inserts lines above it, so locate both by text) ("three exporting stacks at roughly 1,200 series each come to about 3,600 active series").
- FR-5: the doc is updated with the measured delta; baseline T0 = 2671 (`grafanacloud_instance_active_series`, DO dev only, 2026-11-12). The measurement exists only after Step 14.

**TDD**: `N/A (docs)`

**Covers**: `AC-1, AC-6, AC-7, AC-10, AC-11 (promotion of the measured scenarios)`

**Instructions**:
1. Using Step 14's raw numbers, update `:40-42` and `:123` with the post-deploy 1-hour peak, the T0 value, and the statement that a constant `host_provider` label on a single-sender series adds no series (the delta being the recorded figure, plus the one-time fork of old unlabelled series that go stale after about 5 minutes).
2. No new count claim of the form `N dashboards` / `N alert rules`; run the guard on the post-change tree (`fails.md:3259`).
3. Mechanism: an operator-confirmed inline append (the `/sdd-execute` Step 2.5 pattern, `.claude/skills/sdd-execute/SKILL.md:187-201`), not a scenario-promoter run. `context.md` records Step 13's plan as intentionally partial, and any later `/promote` or `/sdd-archiver` run must dedup by `@feature-337` plus `@AC-n` so these five are neither flagged missing nor promoted twice. After the operator confirms Step 14's results (P-04), append `@AC-1`, `@AC-6`, `@AC-7`, `@AC-10` and `@AC-11` to `docs/sdd/business-rules/platform.feature` with `@feature-337`, wording adjusted only to what Step 14 actually measured (the original scenario text in `acceptance.feature` is not rewritten).
4. This ships as a docs-only follow-up PR to `main-dev` after the deploy because the numbers do not exist earlier.

**Verification**:
```bash
! git diff -U0 origin/main-dev...HEAD -- docs/sdd/business-rules/platform.feature | grep -q '^-[^-]'   # no removed lines (append-only, D-17)
test "$(grep -c '@feature-337' docs/sdd/business-rules/platform.feature)" -eq 19   # Step 13's 14 plus the five measured scenarios
python3 scripts/check-otel-produced-signals.py
cd scripts && uv run --extra dev --frozen pytest tests/test_check_otel_produced_signals.py
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
