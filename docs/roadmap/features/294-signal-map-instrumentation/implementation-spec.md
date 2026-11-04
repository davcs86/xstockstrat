# Implementation Spec: signal-map-instrumentation

**Status**: `pending`
**Created**: 2026-11-04
**Feature**: `docs/roadmap/features/294-signal-map-instrumentation/feature.md`
**Total Steps**: 30
**Feature Branch**: `ccr-b4aace27-zvuaby` (operator override, product-spec.md Operator decision 4: no `feature/signal-map-instrumentation` branch; one commit per step; PR #1427 into `main-dev` is the single integration PR)

---

## Execution Summary

Signals only: bounded counters, gauges, histograms and log fixes across all 12 services, with no behavior change, no proto, config-key or database change, and no `packages/otel/` edit (AC-43). Consumer surface (C-14): **None, internal/platform-only** (product-spec.md `## Consumer Surface(s)`); operators read the new series in Grafana Cloud, and the later feature that registers and alerts on them is the consumer. No UI-page, `PLATFORM_SUBNAV` or MCP-tool step is required, and that is a decision, not an omission.

Order: one library pair per runtime first (Steps 1-6: Go, Python, Node rebinding accessors plus the `loop tick ok` helpers), then the services SEV-2 first as design.md 1.11 orders them (trading, portfolio, marketdata, analysis, agent, identity, config + ledger, notify, ui), then the SEV-3 tail (ingest, indicators), then a final allowlist/guard pass (Step 29) and the docs + teardown step (Step 30). Every `service` step is followed by its paired `test` step (C-08); each test is authored to fail against the pre-implementation tree (P-06), and Step 1's accessor is stubbed to a no-op so the first RED is an assertion failure, not a compile error.

Clarifications the spec fixes (design.md leaves them open or ambiguous):
- **UI accessor home.** design.md 1.1 lists `src/telemetry.ts` for the UI, but that file exports only `initTelemetry` (`grep -n export services/xstockstrat-ui/src/telemetry.ts` shows one export). The UI's metrics module with the rebinding pattern is `src/lib/bffMetrics.ts:13-23`, so the UI counters live there (Step 23) and the UI is not part of the Node library step (Step 5).
- **Instrument definitions live with their service step.** The library steps add only the generic rebinding accessors and the tick helpers; each service step adds that service's instruments and label-key constants to its telemetry module, so each commit is self-contained.
- **Line numbers.** Sites cited below were re-grepped against HEAD `e1cf809` (the tree is unchanged from the design's grounding). Sites cited "design.md 1.x" were not re-opened here; `/sdd-execute` discovery re-greps every symbol before editing (design.md header; F-09 drift goes to the Deviation Log).
- **Go coverage.** In trading and portfolio all new logic is in the `service` and `telemetry` packages, which the CI `COVERPKGS` filter excludes; the test steps say so and still run the full suite with `-race`.

### Scenario Coverage (C-15)

| AC | Step(s) | AC | Step(s) | AC | Step(s) |
|---|---|---|---|---|---|
| AC-1 | 8 | AC-21 | 16 | AC-41 | 29 |
| AC-2 | 8 | AC-22 | 18 | AC-42 | 2, 4, 6, 29 |
| AC-3 | 8 | AC-23 | 18 | AC-43 | 29 |
| AC-4 | 8 | AC-24 | 18 | AC-44 | 29 |
| AC-5 | 8 | AC-25 | 20 | AC-45 | 8 |
| AC-6 | 8 | AC-26 | 20 | AC-46 | 12 |
| AC-7 | 8, 10, 12, 14, 26, 29 | AC-27 | 20 | AC-47 | 16 |
| AC-8 | 10 | AC-28 | 26 | AC-48 | 20 |
| AC-9 | 10 | AC-29 | 26 | AC-49 | 22 |
| AC-10 | 10 | AC-30 | 26 | AC-50 | 10, 28 |
| AC-11 | 10 | AC-31 | 22 | AC-51 | 14 |
| AC-12 | 12 | AC-32 | 22 | AC-52 | 18 |
| AC-13 | 12 | AC-33 | 24 | AC-53 | 26 |
| AC-14 | 12 | AC-34 | 24 | AC-54 | 20 |
| AC-15 | 14 | AC-35 | 24 | AC-55 | 24 |
| AC-16 | 14 | AC-36 | 24 | AC-56 | 2, 10, 29 |
| AC-17 | 14 | AC-37 | 28 | AC-57 | 8 |
| AC-18 | 14 | AC-38 | 28 | AC-58 | 10 |
| AC-19 | 16 | AC-39 | 14, 26, 28 | AC-59 | 8 |
| AC-20 | 16 | AC-40 | 20 | | |

## Step Dependencies

- Step 2 [test] covers Step 1 [service]; Step 4 covers Step 3; Step 6 covers Step 5; each later even-numbered step 8-28 covers the odd-numbered `service` step immediately before it.
- Steps 7, 9, 11 require Step 1 (Go accessors, `LogTickOK`, `TickThrottle`); Steps 13, 15, 25, 27 require Step 3 (Python accessors; `log_tick_ok` for analysis and ingest); Steps 17, 19, 21 require Step 5 (Node accessors); Step 23 requires only `bffMetrics.ts` (no library step).
- Step 7 (trading) before Step 9 (portfolio) and Step 11 (marketdata): SEV-2 order from design.md 1.11; the Go modules do not depend on each other.
- Step 13 (analysis) must land clear of feature **215-block-fundamentals-strategy-on-etf** (in-progress): do not touch `live_loop.py` ~733-760 and ~876-891, nor `servicer.py` RunBacktest refusal/derivation paths or `evaluator.py` shared helpers beyond the single `fundamentals formula=` log level. 215 lands first per merge-order.md (`block-fundamentals-strategy-on-etf` (215) rows at lines 90-103); if it has not, rebase before editing `servicer.py` and re-grep.
- Step 9 (portfolio) soft-overlaps **281-signal-watchlist-expiry-pruning** (implementation-ready; adds portfolio `emitEvent`/`cmd/server/main.go:77` prune loop, which logs `"signal watchlist prune tick"`). Step 15 (agent `tools.py`) and Step 19 (config `configServiceImpl.ts`) also overlap 281. Textual rebase only; if 281 lands first, add its prune loop name to portfolio's `Loops` slice (design.md 1.3: portfolio has 5 names plus 281's, still at most 8) and keep its record shape `loop tick ok`.
- Step 27 (indicators `servicer.py`) soft-overlaps **243-fix-sandbox-seed-keys** (in-progress, `_clamp_override` just above the FR-12 sites). Re-grep after the rebase.
- Step 29 requires Steps 1-28. Step 30 requires Step 29.
- Deferred behavior halves (product-spec.md FR-16) have no follow-up feature number yet; they are tracked in `context.md` § Deferred behavior follow-ups for debt-radar, which Step 29 checks (AC-44).

---

### Step 1 — service: Go telemetry library (trading, portfolio, marketdata)

**Status**: `pending`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` (three identical-shape edits, one per service)
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel.go` — modify
- `services/xstockstrat-portfolio/internal/telemetry/otel.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/otel.go` — modify

**Reviewers**: Service owner `xstockstrat-trading` — order execution correctness, instrumentation must not alter flatten, bracket, fill or reconciliation paths; Service owner `xstockstrat-portfolio` — snapshot consistency, concurrent write safety; Service owner `xstockstrat-marketdata` — ingestion integrity; Platform Lead — cross-service loop-liveness pattern and shared label discipline

**Codebase Evidence**:
- Confirmed via: `grep -n "otel/metric\|otel/sdk/metric" services/xstockstrat-{trading,portfolio,marketdata}/go.mod` → `go.opentelemetry.io/otel/metric v1.45.0` (l.18) and `sdk/metric v1.45.0` (l.21) already direct requires in all three, so FR-15(d) holds (no new dependency).
- Confirmed via: `sed -n 61,66p internal/telemetry/otel.go` → `mp := sdkmetric.NewMeterProvider(... sdkmetric.WithView(serverMetricViews()...))` then `otel.SetMeterProvider(mp)`; `serverMetricViews()` at `:86` drops exactly four `rpc.server.*` names (`:87-92`).
- Confirmed via: `grep -n "func \|logProviderInstalled" internal/telemetry/otel.go` → `Init` at `:30`, `serverMetricViews` `:86`, `serviceName` `:104`, `newResource` `:113`; no instrument or tick helper exists. `internal/telemetry/logbridge.go` holds `WrapLogHandler` (slog multi-handler to stdout + OTLP).
- Existing pattern: portfolio's injectable clock `now func() time.Time` at `portfolio_service.go:71` with `clock()` at `offline_valuation.go:72`, the model for `TickThrottle.Allow(now)`.
- Not found: any custom instrument, `LogTickOK` or `Loop` type in any Go service (recon.md: "no service has any custom OTel instrument").

**TDD**: red-green required

**Covers**: —

**Instructions**:
In each of the three `internal/telemetry/otel.go` files add (design.md 1.1, 1.2). Per-service duplication is deliberate: a shared cross-language library is out of scope (product-spec.md Out of Scope) and the jscpd pass over Go is report-only (`.husky/pre-commit` step 3).
1. **Rebinding accessors** for counter, histogram and observable gauge. Each caches the instrument keyed on `otel.GetMeterProvider()` identity and re-creates it when the provider changes (so a `sdkmetric.NewManualReader()` provider installed after package init still sees the instrument), with a package generation counter bumped in `Init` after `otel.SetMeterProvider(mp)` as the fallback. Record calls never panic; a nil/no-op provider is a no-op (FR-15(e)). Stub the accessor to return a no-op instrument first so Step 2's RED is an assertion failure.
2. **Tick helper**: `type Loop string` with a closed constant block and an exported `Loops` slice, `const LoopTickOKMsg = "loop tick ok"`, and `func LogTickOK(ctx context.Context, loop Loop, d time.Duration, state string)` writing one `slog.InfoContext(ctx, LoopTickOKMsg, "loop", string(loop), "duration_ms", d.Milliseconds())` plus `"state"` only when non-empty. It takes a duration (not a start time) so the caller's clock seam controls `duration_ms`. State is one of idle, disabled, paused, budget, skipped.
3. `type TickThrottle struct{ last time.Time }` with `Allow(now time.Time) bool` implementing a 60 s leading edge (the first call and any call at least 60 s after the last allowed one return true). The 60 s is a named constant (`tickThrottleInterval`), a fixed invariant (design.md 1.13), not a config key.
4. Do not add an `rpc.client.*` instrument and do not edit `serverMetricViews` (AC-56). Loop-name constants are declared by each service's own step (Steps 7, 9, 11) because the sets differ per service.

**Verification**:
```
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod) || exit 1; done
```
(Behavioral proof is Step 2.)

---

### Step 2 — test: Go telemetry library tests

**Status**: `pending`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/instruments_test.go` — create
- `services/xstockstrat-portfolio/internal/telemetry/instruments_test.go` — create
- `services/xstockstrat-marketdata/internal/telemetry/instruments_test.go` — create

**Reviewers**: Service owner `xstockstrat-trading` — instrumentation must not alter order paths; Service owner `xstockstrat-portfolio` — snapshot consistency; Service owner `xstockstrat-marketdata` — ingestion integrity

**Codebase Evidence**:
- Confirmed via: `grep -n "NewManualReader" services/xstockstrat-{trading,portfolio}/internal/telemetry/otel_test.go` → the existing manual-reader harness (recon.md cites `:242` / `:242-243`); the new tests reuse that style in the same package.
- Confirmed via: `ls services/xstockstrat-trading/internal/telemetry` → `logbridge.go otel.go otel_test.go shutdown.go shutdown_test.go` (no instruments test yet).

**TDD**: red-green required

**Covers**: `AC-42, AC-56`

**Instructions**:
Per module, one new test file (no `t.Parallel()`: provider swaps are process-global; each test installs its own `sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))`, calls `otel.SetMeterProvider`, and restores the previous provider in `t.Cleanup`):
- **Rebind**: create the accessor, install provider A, record 1; install provider B and record 1; each reader sees exactly its own sample (fails against the Step 1 no-op stub).
- **No-op when disabled (AC-42)**: with `OTEL_ENABLED` unset and the global no-op provider, every accessor call and `LogTickOK` returns without panic.
- **LogTickOK**: capture slog with a JSON `bytes.Buffer` handler at INFO (the existing `warnRecorder` drops below WARN, so use the inline JSON handler pattern, recon R12); assert one record, message `loop tick ok`, attrs `loop`, `duration_ms` (int), no `state` when empty.
- **TickThrottle**: `Allow` true at t0, false at t0+59s, true at t0+60s.
- **AC-56 (views)**: `serverMetricViews()` returns exactly the four existing drop views (names `rpc.server.request.size`, `rpc.server.response.size`, `rpc.server.requests_per_rpc`, `rpc.server.responses_per_rpc`), and after exercising the accessors no instrument named `rpc.client.*` is collected.

**Verification**:
```
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off go test ./internal/telemetry/... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod) || exit 1; done
```
`internal/telemetry` is an excluded package in the CI `COVERPKGS` filter; no coverage threshold applies to it, and the `-race` run is the gate.

---

### Step 3 — service: Python telemetry library (agent, analysis, indicators, ingest)

**Status**: `pending`
**Service**: `xstockstrat-agent`, `xstockstrat-analysis`, `xstockstrat-indicators`, `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-agent/app/telemetry.py` — modify
- `services/xstockstrat-analysis/app/telemetry.py` — modify
- `services/xstockstrat-indicators/app/telemetry.py` — modify
- `services/xstockstrat-ingest/app/telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability, no secret values; Service owner `xstockstrat-analysis` — the registered `live_loop: cycle complete` literal is unchanged; Service owner `xstockstrat-indicators` — no side effects from formula execution; Service owner `xstockstrat-ingest` — idempotent ingestion; Platform Lead — cross-service loop-liveness pattern

**Codebase Evidence**:
- Confirmed via: `grep -n "^def \|^async def " services/xstockstrat-analysis/app/telemetry.py` → `_enabled :20`, `_build_resource :24`, `grpc_status_code :38`, `_make_rpc_duration_processor :52`, `_stamp_cancel_status :88`, `server_interceptors :151`, `init_telemetry :156` (analysis, ingest and indicators share this shape).
- Confirmed via: `sed -n 70,85p services/xstockstrat-agent/app/telemetry.py` → agent init sets `metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[PeriodicExportingMetricReader(...)]))` and attaches `LoggingHandler`.
- Confirmed via: `sed -n 76,82p services/xstockstrat-analysis/app/engine/live_loop.py` → module-level `_TRUNCATION_COUNTER = metrics.get_meter(__name__).create_counter("analysis.live_loop.truncated_pairs", ...)`; the only existing custom counter, create-once, so it is NOT the rebind precedent.
- Existing pattern: `services/xstockstrat-agent/app/tool_metrics.py:35-45` creates `mcp.tool.duration` lazily once (`if self._histogram is None`); design.md 1.1 says this create-once form is not the precedent for new instruments.
- Existing test fixtures: `services/xstockstrat-analysis/tests/conftest.py:501` `otel_reset`; `tests/test_telemetry.py` `metric_reader` fixture (`InMemoryMetricReader` + `metrics.set_meter_provider`).

**TDD**: red-green required

**Covers**: —

**Instructions**:
In each `app/telemetry.py` add (design.md 1.1, 1.2):
1. **Rebinding accessors** for counter, histogram and observable gauge. Each rebinds when `metrics.get_meter_provider()` identity changes (so `metric_reader` installed after import sees the instrument and there is no duplicate-instrument warning). Every record helper wraps its body in `try/except Exception: pass` so a metrics fault can never change control flow.
2. **analysis and ingest only**: `LOOP_TICK_OK = "loop tick ok"`, `class Loop(StrEnum)` (closed set; names per Steps 13 and 25), and `log_tick_ok(logger, loop, duration_ms, state=None)` writing `logger.info(LOOP_TICK_OK, extra={"loop": str(loop), "duration_ms": int(duration_ms), ...})` with `state` in `extra` only when set. `extra` keys are what the OTel `LoggingHandler` (attached at each module's `init_telemetry`) turns into log attributes.
3. Leave `analysis/app/engine/live_loop.py:78-81` (`analysis.live_loop.truncated_pairs`) alone here; Step 13 decides whether to route it through the accessor after Step 4's characterization test.
4. Do not change `tool_metrics.py` or any existing instrument name/attribute (FR-15(b)).

**Verification**:
```
for s in agent analysis indicators ingest; do (cd services/xstockstrat-$s && ruff check . && ruff format --check .) || exit 1; done
```

---

### Step 4 — test: Python telemetry library tests

**Status**: `pending`
**Service**: `xstockstrat-agent`, `xstockstrat-analysis`, `xstockstrat-indicators`, `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-agent/tests/test_telemetry_instruments.py` — create
- `services/xstockstrat-analysis/tests/test_telemetry_instruments.py` — create
- `services/xstockstrat-indicators/tests/test_telemetry_instruments.py` — create
- `services/xstockstrat-ingest/tests/test_telemetry_instruments.py` — create

**Reviewers**: Service owner `xstockstrat-agent` — tool contract stability; Service owner `xstockstrat-analysis` — loop literal unchanged; Service owner `xstockstrat-indicators` — no formula side effects; Service owner `xstockstrat-ingest` — idempotent ingestion

**Codebase Evidence**:
- Confirmed via: `grep -n "otel_reset\|metric_reader" services/xstockstrat-analysis/tests/conftest.py services/xstockstrat-analysis/tests/test_telemetry.py` → `otel_reset` fixture `conftest.py:501`; `metric_reader` fixture in `test_telemetry.py` (`InMemoryMetricReader`).
- Confirmed via: `ls services/xstockstrat-agent/tests` → `test_telemetry.py` and `test_tool_metrics.py` exist; no `test_telemetry_instruments.py`.
- C-13 verdict: the in-memory reader fixture already exists per service (`conftest.py` / `test_telemetry.py`); new tests reuse it, introduce no second inline copy of any domain literal.

**TDD**: red-green required

**Covers**: `AC-42`

**Instructions**:
Per service, a new test file reusing `metric_reader` + `otel_reset`:
- Accessor creates no duplicate-instrument warning (`caplog`), and rebinds after `otel_reset` + a fresh `metric_reader` (fails against a stub that returns a no-op).
- A raising instrument (monkeypatch the underlying `add` to raise) does not propagate out of the helper.
- With `OTEL_ENABLED` unset every helper is a no-op and `init_telemetry()` returns without creating an exporter (AC-42).
- analysis and ingest: `log_tick_ok` emits one INFO record `loop tick ok` whose `LogRecord` carries `loop` and `duration_ms` as attributes (assert on the `LogRecord.__dict__`, and via a `LoggingHandler` over an in-memory log exporter to prove `extra` reaches OTel attributes), and `state` only when passed.
- analysis: characterize `_TRUNCATION_COUNTER` (`live_loop.py:78-81`): record, then `otel_reset` + new reader, record again, and assert whether the second sample is visible. Record the result in the test docstring (design.md Open Risk "Python LoggingHandler mapping / rebinding", recon R12 says this was unverified).

**Verification**:
```
for s in analysis ingest agent; do (cd services/xstockstrat-$s && pytest --cov=app --cov-fail-under=40 -q && ruff check . && ruff format --check .) || exit 1; done
(cd services/xstockstrat-indicators && pytest --cov=app --cov-fail-under=50 -q && ruff check . && ruff format --check .)
```

---

### Step 5 — service: Node telemetry library (identity, config, ledger, notify)

**Status**: `pending`
**Service**: `xstockstrat-identity`, `xstockstrat-config`, `xstockstrat-ledger`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-identity/src/telemetry.ts` — modify
- `services/xstockstrat-config/src/telemetry.ts` — modify
- `services/xstockstrat-ledger/src/telemetry.ts` — modify
- `services/xstockstrat-notify/src/telemetry.ts` — modify

**Reviewers**: Service owner `xstockstrat-identity` — secret handling (no token, email or hash in a log or label); Service owner `xstockstrat-config` — WatchConfig stream stability; no secret values in any log; Service owner `xstockstrat-ledger` — append-only invariant, event ordering; Service owner `xstockstrat-notify` — stream delivery guarantees; Platform Lead — shared label discipline

**Codebase Evidence**:
- Confirmed via: `grep -n "export function\|getMeter\|this.histogram" services/xstockstrat-identity/src/telemetry.ts` → `buildResource :22`, `RPC_DURATION_BUCKETS_MS :31`, `rpcDurationViews :44`, `grpcStatusCode :56`, a lazy rebinding histogram class that checks `metrics.getMeterProvider()` and calls `metrics.getMeter('xstockstrat.rpc').createHistogram('rpc.server.duration', ...)` (`:82-85`), `initTelemetry :135`. config/ledger/notify have the same shape at `:81-86` / `:82-86` / `:83-86`.
- Existing pattern (reuse, not copy): `services/xstockstrat-ui/src/lib/bffMetrics.ts:13-23` rebinds on `boundTo !== provider`; API 1.9 has no proxy MeterProvider (fails.md 2026-10-21 `otel-metrics-logs-export`), so an early-bound instrument is a permanent no-op.
- Not found: any custom instrument in the four Node services; no shared log-capture helper (recon R12), so tests use the `captureStdout` approach at `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts` (recon cites `:388-396`).

**TDD**: red-green required

**Covers**: —

**Instructions**:
In each `src/telemetry.ts` add rebinding accessors for counter, histogram and observable gauge following the `bffMetrics.ts:13-23` shape (cache keyed on `metrics.getMeterProvider()` identity; re-create when it changes; `try/catch {}` around every record so a metrics fault never changes control flow). No tick helper in Node (design.md 1.2: the ledger notifier, config listener and indicators watcher are reconnect loops, not tick loops). Do not touch `rpc.server.duration` (`:82-85`) or `rpcDurationViews` (FR-15(b)). Stub the accessor to a no-op first for Step 6's RED.

**Verification**:
```
for s in identity config ledger notify; do (cd services/xstockstrat-$s && pnpm run lint && pnpm exec tsc --noEmit) || exit 1; done
```

---

### Step 6 — test: Node telemetry library tests

**Status**: `pending`
**Service**: `xstockstrat-identity`, `xstockstrat-config`, `xstockstrat-ledger`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-identity/src/__tests__/telemetryInstruments.test.ts` — create
- `services/xstockstrat-config/src/__tests__/telemetryInstruments.test.ts` — create
- `services/xstockstrat-ledger/src/__tests__/telemetryInstruments.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/telemetryInstruments.test.ts` — create

**Reviewers**: Service owner `xstockstrat-identity` — no secret in logs/labels; Service owner `xstockstrat-config` — no secret values in logs; Service owner `xstockstrat-ledger` — ordering; Service owner `xstockstrat-notify` — delivery guarantees

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-{identity,config,notify}/src/__tests__/telemetry.test.ts` → present; recon cites the `CollectingReader` at `:32-48` of each. ledger has `telemetry.test.ts` and `telemetry.export.test.ts` too.
- C-13 verdict: the `CollectingReader` helper has a second consumer in every Node service after this step. Do not extract it speculatively; if a second *new* test file in the same service needs it (Steps 18, 20, 22), move it to that service's `src/__tests__/fixtures/` in that step (the fixtures dir exists in identity and ledger: `ls services/xstockstrat-identity/src/__tests__/fixtures`).

**TDD**: red-green required

**Covers**: `AC-42`

**Instructions**:
Per service: (a) rebind test: install a `MeterProvider` with a `CollectingReader` after module import, record via the accessor, assert the sample is collected; install a second provider and assert rebinding; (b) a throwing instrument does not escape the record helper; (c) with the global no-op provider and `OTEL_ENABLED` unset every accessor call returns without throwing (AC-42); (d) an active span survives `queueMicrotask` (design.md Open Risk "Node AsyncLocalStorage"): start a span, `await new Promise(r => queueMicrotask(r))`, assert `trace.getActiveSpan()` is still the span (record the result; Step 22 depends on it for notify).

**Verification**:
```
for s in identity config ledger notify; do (cd services/xstockstrat-$s && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint) || exit 1; done
```

---

### Step 7 — service: Trading outcome counters, tick records, clock seam (SEV-2)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel.go` — modify (instruments, `Loop` constants, key constants)
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/internal/service/order_intent.go` — modify

**Reviewers**: Service owner `xstockstrat-trading` — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement (no change to flatten, bracket, fill or reconciliation behavior); Platform Lead — loop-liveness record shape

**Codebase Evidence**:
- Confirmed via: `grep -n "flattenAndHalt" services/xstockstrat-trading/internal/service/trading.go` → def `:2854`; early returns `:2858-2860` (no broker), `:2864-2866` (offline), `:2872-2874` (order not found), combined `if err != nil || position == nil || position.Qty == 0 {` + WARN `"flattenAndHalt: no open position to flatten"` at `:2885-2886`; sole caller `checkBracketProtection` `:2972` runs it on `context.Background()` (`:2995`).
- Confirmed via: `sed -n 708,746p trading.go` → `brokerOrder, err := accountEntry.client.SubmitOrder(ctx, brokerReq)` `:712`; uncertain branch `if isUncertainBrokerOutcome(err)` `:714`; definite rejection branch `:724`; success path `alpacaStatusToProto(brokerOrder.Status)` `:748`.
- Confirmed via: `maybeSubmitBracket` `:3451` (guard `stopPrice <= 0 || !bracketOrdersEnabled` `:3452`, lookup-failed WARN `:3456-3460`, `resizeBracket` call in the IBKR `existing.Status == bracketStatusActive` case, `createBracket` call in `case existing == nil`); `createBracket` CreateBracket failure `:3487-3490` (calls `emitBracketFailureAlert`), broker-type switch `:3492`; `resizeBracket` def `:3524`.
- Confirmed via: ledger: `appendLedgerEvent` `:3762`, `appendMaxAttempts = 2` `:3752`, retry only on `codes.Unavailable` `:3779`, payload-build error `:3765`; `emitLedgerEvent` `:3802` logs `"ledger emit failed"` at `:3804` with `event_type` and `error` only; direct `appendLedgerEvent` caller at `:1103` (design.md 1.4).
- Confirmed via: `grep -n "EmitAlert(" trading.go` → `:1985, :2237, :2839, :3151, :3433, :3809, :3823`; `Category:` lines follow at `:1987/:2239/:2841/:3153/:3435/:3811/:3825` (design.md 1.4).
- Confirmed via: `escalateSystemic` def `:2218`, sole call `:2208-2209` with no already-REDUCE_ONLY check.
- Confirmed via: pollers. `StartFillPoller :1729` (only production caller of `pollFills` `:1752`; ends `:1807`; `GetOrder` failure WARN `"fill poll: broker GetOrder failed"` `:1801`; no-broker `continue` `:1794-1796`); `StartReconciliationPoller :1924`, `reconcileTick :2001` (returns `(systemicCount, totalAccounts int)` `:2001`; `escalateSystemic` call `:2209`; ListOrders `polled++` site just before the call after the skip continues, design.md 1.3 `:2035-2036`); `StartPositionSyncPoller :2341` with the KEPT `slog.InfoContext(ctx, "position sync cycle complete", ...)` `:2360`; `syncPositions :2385`, `syncAccountPositions :2430`; `StartCredentialHealthPoller :2735` (tick inside `if intervalMs > 0` `:2748`), `checkCredentialHealth :2757` (goroutine calls `s.validateAndRecordCredential(ctx, accountID, b)` and discards the result at `:2778`), `validateAndRecordCredential :2690`; `checkBracketProtection :2972-2998`; `StartOrderIntentSweeper order_intent.go:111`, `sweepOrderIntents :162-180`, `reclaimedUnknownEventType :134`.
- Confirmed via: `sed -n 127,135p trading.go` → `type TradingService struct` `:127` has no `now` field; tests build `TradingService{}` literals, so `clock()` must be nil-safe.
- Existing pattern: portfolio `now func() time.Time` `portfolio_service.go:71` and nil-safe `clock()` `offline_valuation.go:72-76`.
- IBKR/trading-domain: `grep -n "ErrInvalidCredentials" trading.go` → `:2039, :2128, :3043` only; there is NO invalid-credentials branch at submit today (recon R8), so `submitOutcome` derives it with `errors.Is(err, broker.ErrInvalidCredentials)` inside the existing `:724` branch without changing it. `BrokerType` values `packages/proto/common/v1/common.proto:69-74` (UNSPECIFIED 0, ALPACA 1, IBKR 2, OFFLINE 3).

**TDD**: red-green required

**Covers**: —

**Instructions**:
Signals only (product-spec.md Operator decision 2). No new halt, page or status change; order placement, fill detection and the `PARTIALLY_FILLED` / `FILLED` handling at `:1812` are untouched (fill handling unaffected by this step). Order types MARKET, LIMIT, STOP, STOP_LIMIT, TRAILING_STOP: order-type handling unaffected. Broker coverage: `broker_type` label covers ALPACA, IBKR and OFFLINE (where the path exists) on equal terms. Trading mode gate: no order is placed or submitted by anything added here; paper and live behave identically (no `trading_mode` label anywhere, AC-41 / `@AC-1 @feature-171`).
1. **Instruments + keys** in `otel.go` using Step 1's accessors, names per design.md 1.4: `trading.flatten.outcome{outcome}`, `trading.bracket.outcome{outcome}`, `trading.order_submit{broker_type, outcome}`, `trading.ledger_emit{event_type, outcome}`, `trading.alert_emit{alert_kind, outcome}`, `trading.escalation.systemic` (unlabelled). Key constants: `outcome`, `broker_type`, `event_type`, `alert_kind`. Add the closed `Loop` constants for trading: `fill_poller`, `reconciliation`, `position_sync` (KEPT, never logged through `LogTickOK`), `credential_health`, `bracket_watchdog`, `order_intent_sweeper`, and the `Loops` slice. `event_type` is clamped to the design.md 1.4 allowlist (unknown -> `other`); `alert_kind` is a `type alertKind string` with constants reconciliation, halt, account, bracket, approval, trade and no `other` branch.
2. **Clock seam**: add `now func() time.Time` to `TradingService` and a nil-safe `clock()` mirroring portfolio's. Tick durations and `TickThrottle` use `s.clock()` so a test controls `duration_ms`.
3. **flattenAndHalt** (`:2854`): count `no_broker`, `offline`, `order_not_found`, `hash_error`, `flattened`, `halted` at the exits design.md 1.4 lists. Split `:2885`: `lookup_error` when `err != nil && grpcstatus.Code(err) != codes.NotFound` (new ERROR `"flattenAndHalt: position lookup failed"` with `account_id`, `symbol`, `error`, then return); `flat` when `err == nil && (position == nil || position.Qty == 0)` or `grpcstatus.Code(err) == codes.NotFound` (keep the text `"flattenAndHalt: no open position to flatten"`, level WARN -> INFO, then return). Both branches still return exactly where the old combined branch did (AC-1, AC-2, AC-57).
4. **maybeSubmitBracket / createBracket / resizeBracket**: `lookup_failed` at the `:3456` branch (return unchanged, no alert, no row), `create_failed` at `:3487-3490`, `created` immediately after CreateBracket succeeds and before the `switch` at `:3492`, `resized` right after the `s.resizeBracket(...)` call. Not counted: the no-op guard `:3452` and the `default` case.
5. **trading.order_submit**: add `submitOutcome(err error, brokerStatus tradingv1.OrderStatus) string` returning `uncertain` (the `isUncertainBrokerOutcome` branch), `invalid_credentials` (`errors.Is(err, broker.ErrInvalidCredentials)` in the definite-rejection branch), `rejected` (the other `:724` branch, or `err == nil && brokerStatus == ORDER_STATUS_REJECTED`), else `accepted`. `broker_type` = `strings.TrimPrefix(commonv1.BrokerType(accountEntry.brokerType).String(), "BROKER_TYPE_")`. Record at the `:712` error branches and after the success path with `alpacaStatusToProto(brokerOrder.Status)`.
6. **Ledger and alert emits**: count inside `appendLedgerEvent` (`ok` on attempt 1, `retried_ok` on attempt 2, `failed` for any returned error including the payload-build error); `emitLedgerEvent` log gains `stream_key`. Add `s.recordAlertEmit(kind, err)` right after each of the seven `EmitAlert` calls. `escalation.systemic` +1 at the top of `escalateSystemic`. The `syncAccountPositions` / heartbeat counting is unchanged (AC-59: a failed `account.positions.synced` emit still counts in `accounts_synced`, and only the `failed` ledger counter moves).
7. **Tick records** (design.md 1.3). `LogTickOK` plus the failure rule "denominator = items that reached the fallible call; no record when `count > 0` and all failed". fill_poller: end of `pollFills`, `polled` counted where `GetOrder` is called, `failed` at `:1800-1802`; `idle` when no candidates, `skipped` when candidates existed but every one hit the no-broker `continue` `:1794-1796`. reconciliation: before the return of `reconcileTick`, `polled++` just before `ListOrders`; no record when `polled > 0 && systemicCount == polled`; `idle` when `polled == 0`; return signature unchanged. credential_health: change `:2778` to `if st, _ := s.validateAndRecordCredential(...); st == int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_UNKNOWN) { unknown.Add(1) }` (atomic), `n = len(brokerMap)`; no record when `n > 0 && unknown == n`; `idle` when `n == 0`; `disabled` in a new `else` of `if intervalMs > 0`. bracket_watchdog: end of `checkBracketProtection`, no record when the `ListExpiredProtection` scan errored, `idle` when none expired. order_intent_sweeper: end of `sweepOrderIntents`, no record when `SweepStalePending` errored or (`len(stale) > 0` and every `ReclaimOrphanIntent` errored), `idle` when none stale. position_sync keeps `"position sync cycle complete"` (`:2360`), no second record. Do not edit `StartFillPoller` (AC-6: the diff has no hunk inside it).
8. Characterize first (RED-adjacent, Step 8): `checkCredentialHealth` and the tick bodies have no test today (design.md 1.11 step 2).

**Verification**:
```
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod && ! git diff -U0 -- internal/service/trading.go | grep -q "^@@.*StartFillPoller"
```
(No diff hunk may sit inside `StartFillPoller`, AC-6. The Go `service` package is where all of this logic lives.)

---

### Step 8 — test: Trading telemetry tests

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_telemetry_test.go` — create
- `services/xstockstrat-trading/internal/service/trading_flatten_rejection_test.go` — modify (extend the harness only if a second consumer forces it; see C-13 verdict)

**Reviewers**: Service owner `xstockstrat-trading` — order execution correctness, broker API safety, fill detection; the tests must prove instrumentation did not alter the flatten, bracket, fill or reconciliation paths

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-trading/internal/service/*_test.go` → `trading_flatten_rejection_test.go`, `trading_bracket_test.go`, `trading_sync_test.go`, `trading_reconciliation_test.go`, `trading_ledger_userid_test.go`, `trading_ibkr_auth_test.go`, `trading_helpers_test.go` among 26 test files.
- Confirmed via: recon.md R12: the flatten harness (`trading_flatten_rejection_test.go:88`) cannot force `GetPosition` error, `Qty == 0`, missing broker or offline; the Go `warnRecorder` drops below WARN, so an INFO assertion needs the inline `bytes.Buffer` JSON handler used at `trading_sync_test.go:18-21`.
- C-13 verdict: fixtures live in `services/xstockstrat-trading/internal/testdata/` (`caller_ids.go`, `order_rows.go`, `ibkr.go`, `offline_history.go`); reuse `order_rows.go` for order literals. New literals (`"ord-1"`, `"acc-1"` etc.) have one consumer (this file) so stay inline; a second consumer would move them to `internal/testdata/`.

**TDD**: red-green required

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-45, AC-57, AC-59`

**Instructions**:
One new file `trading_telemetry_test.go`; each test installs a `sdkmetric.NewManualReader()` provider and a captured JSON slog handler, and asserts exact deltas. Characterization tests first (they pass against the old tree and pin behavior): `checkCredentialHealth`, `sweepOrderIntents`, `checkBracketProtection` and the ListOrders `polled` path.
- AC-1: GetPosition returns `UNAVAILABLE` -> `trading.flatten.outcome{lookup_error}` +1, `{flat}` unchanged, ERROR `"flattenAndHalt: position lookup failed"`, no attribute value contains `ord-1` or `acc-1`.
- AC-2: `Qty 0` -> `{flat}` +1, `"flattenAndHalt: no open position to flatten"` at INFO. AC-57: `NOT_FOUND` -> `{flat}` +1, `{lookup_error}` unchanged, INFO.
- AC-3: `GetBracketByOrderID` DB error -> `trading.bracket.outcome{lookup_failed}` +1, no `CreateBracket` call, no `EmitAlert` call. Include the `stopPrice > 0 && enabled` Given.
- AC-4: `AppendEvent` UNAVAILABLE twice for `order.filled` -> `trading.ledger_emit{order.filled, failed}` +1 and the `"ledger emit failed"` log carries `stream_key` `ord-4`; UNAVAILABLE once then OK -> `retried_ok` +1.
- AC-5: Alpaca-typed account, `SubmitOrder` returns a definite rejection -> `trading.order_submit{ALPACA, rejected}` +1, no attribute contains the rejection text.
- AC-45: three reconciliation ticks with `systemic_threshold_pct` 0.5 and 2 of 4 accounts erroring -> `trading.escalation.systemic` +3; an IBKR account whose `SubmitOrder` returns an uncertain-outcome timeout -> `trading.order_submit{IBKR, uncertain}` +1; a PARTIALLY_FILLED then FILLED order's persisted statuses are identical to a baseline run without telemetry.
- AC-59: `AppendEvent` fails twice for `account.positions.synced`, `syncPositions` for `acc-59` -> `accounts_synced` still counts it and `trading.ledger_emit{account.positions.synced, failed}` +1.
- AC-6: a `TradingService` with `now` injected; fake `GetOrder` advances the clock 120 ms and returns non-terminal on call 1, errors on call 2; `pollFills` twice -> exactly one INFO `loop tick ok` with `loop=fill_poller`, `duration_ms=120`, none for call 2, the WARN `"fill poll: broker GetOrder failed"` for call 2, no sleep call. The `git diff` hunk check is in Step 7's verification.
- AC-7 (trading half): collect every `loop` attribute written across the tick tests; each is in `telemetry.Loops`, `len(telemetry.Loops) <= 8`, no record attribute contains an account, user, symbol or order id; position sync tick writes only `"position sync cycle complete"`.

**Verification**:
```
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in the excluded `service` and `telemetry` packages: no coverage threshold applies (CI measures the remaining packages at 40%); the `-race` run over the new tests is the gate. Partial-fill parity (AC-45) is exercised in the test.

---

### Step 9 — service: Portfolio consumer, quote and snapshot signals (SEV-2)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/telemetry/otel.go` — modify (instruments, `Loop` constants, key constants)
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/service/offline_valuation.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_sync_retry_test.go` — modify (`consumeEventStream`/`streamEventsFrom` callers pass the new argument)
- `services/xstockstrat-portfolio/internal/service/portfolio_fill_errors_test.go` — modify (same)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety (the park ERROR is never throttled; valuation stays parity-tested); Platform Lead — loop-liveness record shape

**Codebase Evidence**:
- Confirmed via: `grep -n "consumeEventStream\|streamEventsFrom\|boundedRetry\|ackAlways\|time.Sleep" internal/service/portfolio_service.go` → `ConsumeOrderFills` (`:173-174`, wires `s.processOrderFill` unwrapped), `ackAlways :182`, `consumeEventStream :191`, `time.Sleep(2 * time.Second) :205`, `isGracefulStreamClose` use `:200` (INFO `name+" stream disconnected, reconnecting"` `:201`, ERROR `name+" stream error, retrying"` `:203`), `streamEventsFrom :212`, `isGracefulStreamClose def :243`, `boundedRetry :1297`, "event parked" ERROR `:1325`; consumers wired at `:1237` (position sync), `:1249` (deregistration), `:1463` (bracket), `:1511` (balance); `cmd/server/main.go:72-76` starts the five consumers.
- Confirmed via: `grep -n "func (s \*PortfolioService) observed\|func observed" internal/service/*.go` → **Not found** — the `observed(label, h)` wrapper does not exist and must be created (design.md 1.4 describes it as new).
- Confirmed via: `latestQuotesFor :404` (failure branch `:412-414`); `applyQuotes :471` (no `ctx`; bare `slog.Warn("latest quote has no usable price", ... "symbol" ...)` `:484`); production `applyQuotes` calls `offline_valuation.go:113`, `:146`, `portfolio_service.go:753`, `:1030`, `:1094`; `pickMark offline_valuation.go:280` with `p.MarkSource = src` at `:243` (design.md cites `:240-246`).
- Confirmed via: `broadcastSnapshot :1024`; `_ = s.repo.InsertSnapshot(...)` `:1047`; skipped-unpriced return `:1032-1035` (design.md).
- Confirmed via: `sed -n 70,72p` → `now func() time.Time` `:71`; `clock()` `offline_valuation.go:72`.
- Existing test callers: `portfolio_sync_retry_test.go:73,:80` and `portfolio_fill_errors_test.go:155` pass `nil` for the handler callback (design.md 1.11 step 3; to be re-opened at execute).
- 281 overlap: portfolio `cmd/server/main.go:77` region (`go svc.HydrateStops(ctx)` follows the consumers at `:77`).

**TDD**: red-green required

**Covers**: —

**Instructions**:
Signals only; valuation behavior and the park/ack semantics are unchanged (C-10(b): `applyQuotes` signature is unchanged so the parity test and its callers are untouched; the portfolio ListPositions/ListPortfolios parity stays).
1. **Instruments + keys** in `otel.go`: `portfolio.consumer.events{consumer, outcome}`, `portfolio.marketdata_fetch{op, outcome}`, `portfolio.snapshot{outcome}`, `portfolio.mark_source{mark_source, path}`; key constants `consumer`, `outcome`, `op`, `mark_source`, `path`; `Loop` constants `order_fill`, `position_sync`, `deregistration`, `bracket`, `balance` and the `Loops` slice (281's prune loop name is appended only if 281 has landed, at most 8).
2. **consumerLabel(name)** closed over the five names passed at `:174, :1237, :1249, :1463, :1511` -> `order_fill, position_sync, deregistration, bracket, balance`, else `other`. Create `observed(label, h)` wrapping `processOrderFill` (`:174`) and the two `ackAlways` consumers; `boundedRetry` records its own outcomes (`ok` at the success exit, `error` at the retryable error exit, `parked` at the `:1325` park). `acked` for ackAlways consumers. The park ERROR at `:1325` is never throttled.
3. **Per-batch tick record** (AC-56): each consumer writes `LogTickOK` on outcome ok/acked (not parked, not error), through a per-consumer `TickThrottle` with a 60 s leading edge, so 4 events within 60 s write exactly 1 record. Loop names from the closed `Loops`.
4. **FR-14 consumer rewrite** (design.md 1.8, copy the corrected code): constants `streamRetryDelay = 2*time.Second`, `streamLogEvery = 10`, `streamQuietWindow = 10*time.Minute`; `consumeEventStream` keeps `lastSeq = next` and the resume-from-sequence invariant, counts `failures`/`graceful` per kind, logs the first and every 10th (INFO for graceful, ERROR for failures; the rest DEBUG via `slog.Log(ctx, lvl, ...)`), resets counters after a 10-minute quiet gap, and sleeps through a new field `sleep func(time.Duration)` (nil means `time.Sleep`, so production timing is unchanged; the retry stays 2 s). `streamEventsFrom` gains an `onHealthy func()` parameter called once on the first handled event or on EOF; the "<name> stream resumed" INFO is written only when `failures >= 2 || graceful >= 2` preceded. The EOF path (`err == nil`) is unchanged apart from `markHealthy()`. Update the two existing test callers to pass `nil`.
5. **latestQuotesFor**: count `portfolio.marketdata_fetch{op=quotes, outcome}`: `timeout` when `qctx.Err() == context.DeadlineExceeded`, else `error` (`:412-414`), `ok` on the success return; the empty-symbol early return is not counted; the existing `"batch latest quotes unavailable"` WARN at `:413` is untouched.
6. **observeQuotePass(ctx, positions, quotes, path)** (design.md 1.6) called right after each production `applyQuotes` (`offline_valuation.go:113`, `:146` with path `read`, `portfolio_service.go:753` `pnl`, `:1030` `snapshot`, `:1094` `risk`): records `portfolio.mark_source{mark_source, path}` per position (`mark_source` = lower-cased `MarkSource` name without prefix) and, if positions left at `MARK_SOURCE_NONE` whose symbol is present in `quotes` is > 0, writes ONE `slog.WarnContext(ctx, "latest quote has no usable price", "count", n, "sample_symbols", <=5 symbols)`. Delete the per-position `slog.Warn` at `:484`; `applyQuotes` is otherwise unchanged. `pickMark` records `path=read` right after `p.MarkSource = src` and before the `continue`, only inside `if p != nil`, using `context.Background()` (`valueOffline` has no ctx).
7. **broadcastSnapshot**: `portfolio.snapshot{written | skipped_unpriced | db_error}`; replace `_ = s.repo.InsertSnapshot(...)` with `if err := ...; err != nil { slog.ErrorContext(ctx, "portfolio snapshot insert failed", "error", err); record db_error } else { record written }` and DO NOT return: the ledger emit and subscriber broadcast after it still run.

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/... && GOWORK=off golangci-lint run --modules-download-mode=mod && ! grep -n 'slog.Warn("latest quote has no usable price"' internal/service/portfolio_service.go
```
(The last grep must find nothing: the per-position Warn is gone.)

---

### Step 10 — test: Portfolio telemetry tests

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_telemetry_test.go` — create

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L accuracy, snapshot consistency; tests prove behavior parity

**Codebase Evidence**:
- Confirmed via: `grep -n "warnRecorder" internal/service/portfolio_quote_deadline_test.go` → recorder at `:32-69`, WARN+ only (recon R12): a new INFO-capable recorder is needed for `loop tick ok` / `stream resumed`; the WARN assertions can reuse it.
- Confirmed via: `ls internal/service/*_test.go` → `portfolio_quote_deadline_test.go`, `portfolio_sync_retry_test.go`, `portfolio_fill_errors_test.go`, `portfolio_snapshot_scope_test.go`, `offline_valuation_test.go`, `getpnl_source_parity_test.go`.
- Design test-shape notes (design.md 1.6): a fill-driven snapshot also runs `checkRiskLimits` and `broadcastSnapshot` (`portfolio_service.go:382-383`), so AC-9's exact counts hold only when the When invokes `broadcastSnapshot` directly; give every account a balance row and stub `ListOfflineAccountIdsByUser` empty (`:620-624`); `trace_id` appears only inside an active span.
- C-13 verdict: the existing recorder and stubs stay in their files; the new file has one consumer of any new literal (inline compliant). Use `internal/testdata` only on a second consumer.

**TDD**: red-green required

**Covers**: `AC-7, AC-8, AC-9, AC-10, AC-11, AC-50, AC-56, AC-58`

**Instructions**:
- AC-8: invoke the `boundedRetry("position sync", h)` handler directly 5 times for event `evt-9` failing with SQLSTATE 23505 -> `{position_sync,error}` +4, `{parked}` +1, the `"event parked"` ERROR names `evt-9`, `{ok}` unchanged.
- AC-9: user `u-1`, one broker account with an `account_balances` row, no offline accounts, 2 positions with CurrentPrice 0 and source UNSPECIFIED; a `GetLatestQuotes` fake that blocks until `qctx` expires (an immediate DeadlineExceeded counts as `error`, not `timeout`); `GetPortfolio` then `broadcastSnapshot` directly -> `marketdata_fetch{quotes,timeout}` +2, `snapshot{skipped_unpriced}` +1, `mark_source{none}` +2 for `read` and +2 for `snapshot`, no `"latest quote has no usable price"` line, RPC OK.
- AC-10: `InsertSnapshot` returns an error -> `snapshot{db_error}` +1, ERROR `"portfolio snapshot insert failed"` contains the message, the `portfolio.snapshot` ledger event is still emitted and a matching subscriber still receives the snapshot.
- AC-11: 40 positions, quotes for all 40 symbols of which 12 lack a mark and a two-sided bid/ask, run inside an active span -> exactly one `"latest quote has no usable price"` line with `trace_id` and `count` 12; `mark_source{none,read}` +12.
- AC-50 (portfolio half): a consumer with injected clock and sleep seam; 10 graceful closes -> closes 1 and 10 at INFO, 2-9 at DEBUG, no ERROR, every sleep 2 s; a following healthy session writes exactly one INFO `"<name> stream resumed"` with `consecutive_graceful` 10 and `consecutive_failures` 0; no "resumed" line unless 2 or more closes of the same kind preceded.
- AC-58: 3 graceful closes, no event, a 4th close 11 minutes later (injected clock) -> logged at INFO with `consecutive_graceful` 1, no resumed line, sleep 2 s.
- AC-56 / AC-7 (portfolio half): the order-fill consumer handles 4 events within 60 s (injected clock) -> `consumer.events{order_fill, ok}` +4 and exactly 1 `loop tick ok` with `loop=order_fill`; no `rpc.client.*` instrument; `loop` values are in `telemetry.Loops`.
- Parity: the existing `getpnl_source_parity_test.go` and `offline_valuation_test.go` must still pass unmodified.

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in the excluded `service` and `telemetry` packages: no coverage threshold applies; the `-race` run is the gate.

---

### Step 11 — service: Marketdata stream, vendor, backfill and poller signals (SEV-2)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/telemetry/otel.go` — modify (instruments, `Loop` constants, key constants)
- `services/xstockstrat-marketdata/internal/alpaca/stream.go` — modify
- `services/xstockstrat-marketdata/internal/alpaca/client.go` — modify
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — modify
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go` — modify
- `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/service/etf_flags.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify (register the stream-age gauge callback)

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, Alpaca feed idempotency; vendor-call instrumentation must not leak the FMP apikey or Finnhub token; Platform Lead — loop-liveness record shape

**Codebase Evidence**:
- Confirmed via: `grep -n "type streamManager\|func (c \*Client) streamMgr\|func (m \*streamManager) run\|maxReconnects\|conn.Read\|json.Unmarshal" internal/alpaca/stream.go` → `streamManager :60`, `streamMgr :74`, `add :112`, `run :166`, `maxReconnects` `:171-173`, give-up `if attempts >= maxReconnects` `:197` with the ERROR `"alpaca stream giving up after max reconnects: ..."` `:198`, `connectAndRead :219`, `conn.Read(ctx) :264`, `json.Unmarshal :269`.
- Confirmed via: `grep -n "func (c \*Client) do\|func (c \*Client) getJSON\|func (c \*Client) get(" internal/*/*.go` → alpaca `client.go:83` `do()` (8 callers, `json.Unmarshal` at `:194, :256, :309, :351, :391, :439, :496, :543`); FMP `fmp_client.go:235`; Finnhub `finnhub_client.go:110`; EDGAR `edgar_client.go:75`.
- Confirmed via: warm poller: per-symbol WARNs `"warm poller: cache insert failed"` at `marketdata_service.go:1152` and `:1173`; existing aggregate `"warm poller: per-symbol quote fetch failures"` `:1179`; `BackfillBars :1368`; `BackfillFundamentals :2152`; `"bar ingest: cycle complete"` `:1338` (KEPT); `runQuoteRetentionStep :1050`; `fillEtfFlag etf_flags.go:130`.
- Confirmed via: `sed -n 150,175p cmd/server/main.go` → `go svc.StartWarmQuotePoller(ctx)`, `StartBarIngestPoller`, `StartClassificationRefreshPoller`, `StartEtfFlagFiller`, `StartQuoteRetention`.
- Confirmed via: no `otelhttp` import exists in marketdata (recon "Not found"); FR-4 forbids adding it.
- Existing leak pattern: FMP/Finnhub put `apikey=` / `token=` in the URL (recon; fails.md 2026-11 `fix-marketdata-secret-exposure`: `*url.Error` text carries the full URL), so outcome classification must use typed error classes (`fmp.ErrorClass` `fmp_client.go:347`, `stageError`/`statusError` `:289-293`), never `err.Error()`.

**TDD**: red-green required

**Covers**: —

**Instructions**:
No read deadline and no change to reconnect, backfill return or poller semantics.
1. **Instruments + keys** in `otel.go`: `marketdata.vendor.requests{vendor, op, outcome}`, `marketdata.vendor.request.duration{vendor, op}`, `marketdata.stream.reconnects{result}`, observable gauge `marketdata.stream.last_message_age`, `marketdata.backfill.symbols{kind, outcome}`; keys `vendor`, `op`, `outcome`, `result`, `kind`. `Loop` constants: `warm_quote`, `bar_ingest` (KEPT), `classification_refresh` (KEPT), `etf_flag_filler`, `quote_retention`.
2. **Vendor chokepoints** (design.md 1.4 vocabulary: ok, http_429, http_4xx, http_5xx, transport, read, decode, ctx, cap, throttle, build, other): record manually at FMP `getJSON`, Finnhub `getJSON`, EDGAR `get`, Alpaca `do()`. `ctx` wins whenever the request context errored. A duration sample is recorded only when a request was actually sent (throttle/cap/build record the counter only). `op` sets are closed: FMP {quote, ratios, profile}, Finnhub {metric, quote, profile}, EDGAR {tickers, companyfacts}, Alpaca {bars, quotes_latest, trades_latest, assets, dividends} derived from the request path. Alpaca duration = time to headers; Alpaca read/decode failures are not counted (they happen in the 8 callers; declared Open Risk). No attribute, span attribute or log may contain the URL, apikey, token or symbol (AC-13).
3. **Stream** (design.md 1.7): new `streamManager` fields `lastFrame atomic.Int64` (unix nanos) and `now func() time.Time` (nil means `time.Now`; the same `now` is used where `lastFrame` is stored and where the gauge computes the age). Store right after the `conn.Read` error check (`:264-267`) and before `json.Unmarshal` (`:269`); `m.lastFrame.Store(0)` at `run()` entry (`:166`); `func (c *Client) StreamLastFrame() (time.Time, bool)` reads through `c.streamMgr()` (never `c.stream` outside the Once), returns `ok = running && lastFrame != 0` with `running` read under `m.mu`, so after the give-up (`running = false` at `:201`) the gauge reports no sample. `marketdata.stream.reconnects{reconnected}` after the reconnect succeeds when `attempts < max`; `{gave_up}` beside the give-up ERROR at `:198`. Register the gauge callback once in `cmd/server/main.go`, observing only when `ok`.
4. **BackfillBars / BackfillFundamentals**: `marketdata.backfill.symbols{kind=bars|fundamentals, outcome=written|empty|failed}` per symbol; the response (`FailedSymbols`) and the nil error are unchanged.
5. **Warm poller**: extract the per-cycle body from `StartWarmQuotePoller` (`marketdata_service.go:1112`-`1181`) into `warmQuotesOnce(ctx, symbols)` keeping the outer loop's pause `continue` and `ticker.Reset`; aggregate the cache-insert failures into ONE `slog.WarnContext(ctx, "warm poller: cache insert failures", "count", n, "sample_symbols", <=5)` per cycle; the per-symbol `"warm poller: cache insert failed"` lines (`:1152`, `:1173`) drop to DEBUG with their text unchanged; the cycle still continues. The `LogTickOK` record: `warm_quote`; no record when `registry.Get` errored or the per-symbol fallback ran with `fetched == 0`; `idle` for 0 symbols; `paused` written in the outer loop's pause branch.
6. **Tick records**: `etf_flag_filler` throttled (60 s leading edge) once per dequeued item in `fillEtfFlag`; no record on `FetchIsEtf` error; `disabled` (fmp disabled / no cap) and `budget` states; `quote_retention` at the end of `runQuoteRetentionStep`, no record when `DropQuoteChunksBefore` errored, `skipped` for the safety skip (its WARN stays), `disabled` when `s.retention == nil`. `bar ingest: cycle complete` and `classification refresh cycle complete` are KEPT, no second record.

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod && ! grep -rn "otelhttp" --include=*.go .
```
(The final grep must find nothing: no `otelhttp` wrapper.)

---

### Step 12 — test: Marketdata telemetry tests

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/stream_metrics_test.go` — create
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: Service owner `xstockstrat-marketdata` — ingestion integrity; the FMP key must never reach a metric, span or log

**Codebase Evidence**:
- Confirmed via: `ls internal/alpaca internal/fmp internal/service` → `stream_test.go`, `client_test.go`, `fmp_client_test.go`, `fmp_gateway_test.go`, `marketdata_service_test.go`.
- Confirmed via: the alpaca, fmp, finnhub and edgar packages are NOT in the CI `COVERPKGS` exclusion list (`cmd|handler|repository|telemetry|service`), so their new code is measured at 40%.
- C-13 verdict: reuse existing fakes in `stream_test.go` and `fmp_client_test.go`; no second consumer of a new literal, inline compliant.

**TDD**: red-green required

**Covers**: `AC-7, AC-12, AC-13, AC-14, AC-46`

**Instructions**:
- AC-12 (`stream_metrics_test.go`): stream manager with injected `now` and max reconnects 5; the first session reads a frame at T then drops, the next 4 drop before the subscription ack. Collect at T+30 s while reconnecting -> `marketdata.stream.last_message_age` is 30 s; `reconnects{reconnected}` +4 and `{gave_up}` +1; after the give-up the gauge reports no sample. Also a lazy manager with no subscribers reports nothing, and `go test -race` passes (StreamLastFrame reads through `streamMgr()`).
- AC-13 (`fmp_client_test.go`): FMP `getJSON` against an `httptest` server returning 429 for `.../stable/profile?symbol=AAPL&apikey=SECRET123` -> `vendor.requests{fmp, profile, http_429}` +1, `vendor.request.duration{fmp, profile}` records 1 sample; no metric attribute, span attribute or log line contains `SECRET123` and no attribute contains `AAPL`; a throttle or cap exit counts `throttle` / `cap` with no duration sample. Add equivalent minimal cases for Finnhub (token), EDGAR and Alpaca `do()` (ok and ctx).
- AC-14 (`marketdata_service_test.go`): `BackfillBars` timeframe `1d` for 5 symbols (2 fail, 1 empty) -> `backfill.symbols{bars}` written +2, empty +1, failed +2; `FailedSymbols` length 2 and nil error.
- AC-46: a warm-poller cycle over 25 symbols where `cacheQuote` fails for 8 (characterize the existing warm-poller behavior first) -> exactly one WARN `"warm poller: cache insert failures"` with count 8 and at most 5 sample symbols; the per-symbol lines at DEBUG; the cycle continues.
- AC-7 (marketdata half): `loop` attributes written across the tick tests are in `telemetry.Loops`, at most 8, no symbol in any record attribute; bar ingest writes only `bar ingest: cycle complete`.

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Confirm total ≥ 40%.

---

### Step 13 — service: Analysis live-loop, fundsignal and tick signals (SEV-2)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/telemetry.py` — modify (instruments, `Loop` members, key constants)
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/supervision.py` — modify
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: Service owner `xstockstrat-analysis` — backtest reproducibility, strategy scoring determinism, no look-ahead bias; the registered `live_loop: cycle complete` literal and its text are unchanged; Platform Lead — loop-liveness record shape

**Codebase Evidence**:
- Confirmed via: `grep -n "cycle complete\|def run_forever\|async def _emit_alert\|async def _eval_pair\|async def _emit_ledger\|_DRAIN_PAGES" live_loop.py` → `run_forever :334`, `log.info("live_loop: cycle complete") :345`, `_eval_pair :701`, `_emit_alert :852` (no `try`), `_emit_ledger :893` (swallows, no instrument), drains `_drain_system_signals :501`, `_drain_signals_with :509`, `_drain_held :546`; drain failure sites per design.md 1.4 `:531-533` (signals), `:565-567` (held), `:593-595` (watchlist); per-pair handler `:471-479`.
- Confirmed via: `grep -n "async def \(run_once\|_tick\|_emit_signal\|_finish\|_abort_cycle\|_advance_schedule\)" app/engine/fundsignal_loop.py` → `_tick :136`, `run_once :176` (signature `run_once(self, force=False, dry_run=False, override_symbols=None, metadata=())`), `confirmed = False :274`, `if signal_id is not None: :285`, `_finish :632`, `_abort_cycle :680`, `_advance_schedule :130`; `log.error("fundsignal: cycle error: %s", e) :161` (no exc_info); `_finish` call sites `:207, :319, :685`; abort sites `:213, :302`.
- Confirmed via: `grep -n "RunFundamentalsScan" servicer.py` → `:3901`; it calls `self._fundsignal_loop.run_once(...)` directly without the lock (design.md 1.5, `:3921-3926`); only `_tick` takes `self._lock` (`fundsignal_loop.py:153`).
- Confirmed via: `servicer.py` ticks: `_opportunity_refresh_tick :5961`, `_readiness_materializer_tick :6138`, `_template_intent_sweep_tick :6199`; `_kick_opportunity_recompute :4884` with `log.warning("opportunity recompute failed ...") :4904`; bare `asyncio.get_event_loop().create_task(_run())` at `:4331, :4908, :4932`; `InstantiateTemplate :3729`.
- Confirmed via: `supervision.py`: `spawn :16`, `_on_done :23` (only call that passes `exc_info`, `:32`), `retry_until_ok :40` (seed error, no exc_info), `run_supervised :49` (tick error, no exc_info).
- Confirmed via: `evaluator.py:614` `"fundamentals formula=%s ref=%s bars=%d ..."` at INFO.
- Confirmed via: `pnl_pattern_consumer.py:180-206` stream loop with `_process_with_retry(event)` and the outer `except Exception` reconnect.
- Overlap: 215 owns `live_loop.py:733-760` and `:876-891` and `servicer.py` RunBacktest paths; every site above is disjoint (recon R15).

**TDD**: red-green required

**Covers**: —

**Instructions**:
Signals only; the fundsignal run status (`:311`), release-on-failed-emit (`:298-300`), `signals_emitted` accounting (`:297`) and all timing are untouched (`@feature-259/260/156/158` preserved).
1. **live_loop.py**: `analysis.live_loop.pairs{outcome ok|no_bars|error}` at the per-pair handler (`:471-479`); `analysis.live_loop.drain_failures{source signals|held|watchlist}` at `:531-533`, `:565-567`, `:593-595`; `analysis.live_loop.triggers{trigger entry|exit, outcome alerted|throttled|alert_failed}` at the throttle (`:843-845`), after `_emit_alert` returns, and via a minimal `try: await self._emit_alert(...) except Exception: record alert_failed; raise` wrap at the `_emit_alert` call (re-raise: retry semantics and the pair handler's error path are unchanged; recon R4); unlabelled `analysis.live_loop.cycle.duration` histogram around the cycle. The `log.info("live_loop: cycle complete")` literal and text at `:345` are untouched and ungated; this loop writes NO `loop tick ok` (KEPT). `exc_info=True` on the cycle error log. Do not touch `:733-760` / `:876-891`.
2. **Fundsignal sink** (design.md 1.5): `run_once(..., *, _emit_counts: list[int] | None = None)`; at the top `counts = _emit_counts if _emit_counts is not None else [0, 0]` ([attempted, emit_failed]); `counts[0] += 1` right after `confirmed = False` (`:274`, after the `row is None` continue); a new `else:` on `if signal_id is not None:` (`:285`) increments `counts[1]` and `analysis.fundsignal.signals{failed}`, and the success path records `{emitted}` beside `:297`; pass `counts` to every `_finish`. `_finish` gains keyword args `universe=None, scored=None, attempted=0, emitted=None, emit_failed=0` and writes ONE INFO `"fundsignal run summary"` (omitting `None` fields); the main return passes `universe=len(universe), scored=len(scores), attempted=counts[0], emitted=emitted, emit_failed=counts[1]`. Only `_tick` passes a sink and reads it after `run_once` returns; the `RunFundamentalsScan` path passes none and still gets a correct summary.
3. **Fundsignal tick**: in `_tick`, `summary = await self.run_once(..., _emit_counts=counts)` replaces the discarding call; after `_advance_schedule` (`:159`) write `loop tick ok` (`fundsignal`) unless the except path (`:160-163`), `summary.status == "failed"`, `status == "partial" and symbols_processed == 0`, or `counts[0] > 0 and counts[1] == counts[0]`; `idle` for 0 processed; `disabled` at the early return `:144-146`; no record when not due or when the lock is held. `log.error("fundsignal: cycle error: %s", e)` gains `exc_info=True`.
4. **servicer.py ticks**: `loop tick ok` for `opportunity_refresh`, `readiness_materializer`, `template_intent_sweep` at the success point of each tick per design.md 1.3 (no record when enumeration failed, or when every user/owner/intent failed; `idle` for 0 items; `disabled` for the materializer's disabled branch; template sweep uses a new local `enum_failed` flag set where the enumeration exception is swallowed, swallow-and-advance unchanged). `analysis.opportunity.recompute{kind full|retry, outcome ok|failed}` around the two `_run()` bodies at `:4891-4906` and `:4923-4930` (the failure log at `:4904` gains `exc_info=True`). `pnl_consumer` throttled `loop tick ok` after `_process_with_retry` returns (`pnl_pattern_consumer.py:189`), none on the outer exception.
5. **supervision.py**: `exc_info=True` on the seed error (`retry_until_ok`, `:45` region) and the tick error (`run_supervised`, `:54` region); no other change. **evaluator.py**: the `"fundamentals formula=..."` INFO at `:614` moves to DEBUG with text unchanged; the per-symbol INFO near `servicer.py:1894` also moves to DEBUG (N-06). Do not demote any named-WARN rule (S/analysis `@feature-262`, watchlist universe, opportunities-read, screener isolation).
6. **template.instantiate{service="analysis", outcome}** in `InstantiateTemplate` (`:3729`): `ok`, or the lower-cased gRPC code name (unavailable, not_found, already_exists, internal, aborted) at each abort site, else `other`. Add the `Loop` members `fundsignal`, `opportunity_refresh`, `readiness_materializer`, `template_intent_sweep`, `pnl_consumer`.

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && grep -c "live_loop: cycle complete" app/engine/live_loop.py && git diff -U0 -- app/engine/live_loop.py | grep -E "^@@" | head -20
```
(Count must be ≥ 1; review the hunk headers to confirm none falls in 215's regions ~733-760 and ~876-891.)

---

### Step 14 — test: Analysis telemetry tests

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop_telemetry.py` — create
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_tick_telemetry.py` — create

**Reviewers**: Service owner `xstockstrat-analysis` — loop timing, run status and counts unchanged; named-warning rules preserved

**Codebase Evidence**:
- Confirmed via: `grep -n "run_once" services/xstockstrat-analysis/tests/test_fundsignal_loop.py` → existing tests patch `loop.run_once` with `AsyncMock` and assert only `assert_awaited_once()` / `assert_not_awaited()` (design.md 1.5, `:455-529`); the sink stays `[0, 0]` there so they stay green.
- Confirmed via: fixtures `tests/conftest.py:501` `otel_reset`, `metric_reader` (`tests/test_telemetry.py`), `caplog` for logs.
- C-13 verdict: shared fakes (ingest/portfolio/ledger stubs) already live in `tests/conftest.py`; use them. A new fake used by both new test files moves to `conftest.py` in this step.

**TDD**: red-green required

**Covers**: `AC-7, AC-15, AC-16, AC-17, AC-18, AC-39, AC-51`

**Instructions**:
- AC-15: a live cycle evaluating 10 pairs where all 10 raise -> `analysis.live_loop.pairs{error}` +10 and the text `"live_loop: cycle complete"` is written exactly once.
- AC-16: portfolio `ListPositions` fails for owner `o-1` -> `drain_failures{held}` +1, no attribute contains `o-1`.
- AC-17: 200-symbol universe, 150 scored at or above `min_conviction_to_emit`, none emitted today, `IngestSignal` raising UNAVAILABLE for all 150 -> `fundsignal.signals{failed}` +150; exactly 1 INFO `"fundsignal run summary"` with universe 200, scored 150, attempted 150, emitted 0, emit_failed 150; NO `loop tick ok` with `loop=fundsignal`; the run status equals today's (`partial` behavior unchanged); the RPC path (no sink) logs the same correct summary.
- AC-18: a live cycle raising `KeyError('x')` -> the log record has `exc_info`; a live evaluation with a fundamentals input emits `"fundamentals formula="` at DEBUG, not INFO.
- AC-51: a 60 s-interval cycle sending 1 entry alert, throttling 1 exit alert and taking 1.4 s -> `triggers{entry, alerted}` +1, `{exit, throttled}` +1, `cycle.duration` has 1 sample near 1.4 s; a full recompute that fails -> `opportunity.recompute{full, failed}` +1; the `"fundsignal: cycle error"` and supervised `"tick error"` logs carry `exc_info`. Add `alert_failed` characterization: `_emit_alert` raising still propagates to the pair handler and the transition retries.
- AC-39 (analysis half): `InstantiateTemplate` returning ALREADY_EXISTS -> `template.instantiate{analysis, already_exists}` +1; success -> `ok`.
- AC-7 (analysis half): every `loop` value written across tick tests is in `Loop`, at most 8; the live loop writes only `live_loop: cycle complete`.

**Verification**:
```
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40 -q && ruff check . && ruff format --check .
```

---

### Step 15 — service: Agent auth, OAuth, backend and degraded signals (SEV-2)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/telemetry.py` — modify (instruments + key constants)
- `services/xstockstrat-agent/app/tool_metrics.py` — modify (`record_backend_rpc_error`, other record helpers)
- `services/xstockstrat-agent/app/mtls.py` — modify (`_CountingChannel` wrapper)
- `services/xstockstrat-agent/app/auth.py` — modify
- `services/xstockstrat-agent/app/main.py` — modify
- `services/xstockstrat-agent/app/oauth_server.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity (no tool added or re-shaped), no secret values in tool output, OAuth statelessness; Security — never log code, token, state or refresh token

**Codebase Evidence**:
- Confirmed via: `sed -n 25,60p app/tool_metrics.py` → `mcp.tool.duration` histogram created once in `_record` (`if self._histogram is None`), attributes `{"gen_ai.tool.name": name, "outcome": outcome}`; must stay unchanged (AC-21 "gains no new attribute key").
- Confirmed via: `sed -n 18,43 app/mtls.py` → `channel_credentials()` calls `_load()` which raises `RuntimeError("mtls: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set (fail-closed)")`; `secure_channel(endpoint, target_service)` returns `grpc.aio.secure_channel(endpoint, channel_credentials(), options=[("grpc.ssl_target_name_override", target_service)])`. All call sites use `async with mtls.secure_channel(...)` (`grep -n "secure_channel" app/client.py` → 12+ sites, e.g. `:185, :254, :295, :309, :328`).
- Confirmed via: `app/auth.py:57-99` `validate_bearer_claims`: `mtls.secure_channel(IDENTITY_ENDPOINT, "xstockstrat-identity")` inside the `try` `:76`; `claims.aud != AGENT_PUBLIC_URL -> return None` `:83-84`; DEADLINE_EXCEEDED/UNAVAILABLE -> `log.warning` + `IDENTITY_UNAVAILABLE` `:92-94`; other AioRpcError -> `log.info` + `None` `:95-96`; bare `except Exception as e: log.error("Unexpected error validating JWT claims: %s", e); return None` `:97-99`.
- Confirmed via: `app/main.py`: `_authorized :147`, 401 response `:174`, 503 `:187`, `handle_mcp :201`.
- Confirmed via: `app/oauth_server.py`: `_txn_key :38`, excepts at `:68, :76, :87, :107, :137, :170, :219, :233`, token endpoint `except Exception: return JSONResponse({"error": "invalid_grant"}, 400)` at `:259-260` and `:268-269`, `unsupported_grant_type` `:272`.
- Confirmed via: `app/tools.py`: `_ALERT_THRESHOLD_CONFIG_KEY :79`, `_grpc_error_message :224` (UNTOUCHED), `ingest_signal` post-commit auto-alert (`alert_threshold` `:674-683`, `client.emit_alert` `:690`) and watchlist auto-add (`ensure_signal_watchlist`/`add_watchlist_symbol` `:707-708`) wrapped best-effort; `_agent_policy` policy default region (design.md `:2609-2611`).
- Not found: an exchange/onboarding log pair in the agent today; `NC-4`: `_txn_key` raising is uncaught (Starlette 500), nothing agent-side (recon "Resolved here").
- 281 overlap: agent `tools.py` `:692` region (signal-add path); textual rebase only.

**TDD**: red-green required

**Covers**: —

**Instructions**:
Signals only: no tool is added, removed or re-shaped (mcp-tools.md and the tool-count inventory unaffected); 503-vs-401 stays; `_grpc_error_message` and its messages stay byte-identical; no label is added to `mcp.tool.duration` (`@feature-273`, `@feature-274`).
1. **Instruments + keys** in `app/telemetry.py` (via Step 3's accessors; record helpers in `tool_metrics.py`): `mcp.auth.rejected{reason}`, `oauth.requests{grant_type, outcome}`, `oauth.txn.rejected{reason}`, `agent.backend.rpc_errors{backend, grpc_code}`, `agent.degraded{kind}`; keys `reason`, `grant_type`, `outcome`, `backend`, `grpc_code`, `kind`. `backend` = the secure_channel target name minus the `xstockstrat-` prefix, clamped to {analysis, ingest, indicators, identity, config, portfolio, trading, marketdata, notify, unknown}.
2. **mtls wrapper** (design.md 1.9): `secure_channel` still calls `channel_credentials()` eagerly (so `test_mtls.py` still sees the `RuntimeError`) and returns `_CountingChannel(inner, backend)`: `__aenter__` returns `await inner.__aenter__()`; `__aexit__`: if `exc` is a `grpc.aio.AioRpcError`, `try: tool_metrics.record_backend_rpc_error(backend, exc.code()) except Exception: pass`, then `await inner.__aexit__(...)` and `return False` (never suppress or replace the exception); `__getattr__` delegates. Errors caught inside the block are not counted; the identity-call double view (`oauth.requests` and `backend.rpc_errors`) is declared.
3. **auth.py**: `mcp.auth.rejected` reasons `wrong_audience` (`:83-84`), `identity_unavailable` (`:92-94`), `invalid_token` (`:95-96`), `internal_error` (`:97-99`, inside the existing except, still returns None); the `:98` ERROR becomes `log.error("Unexpected error validating JWT claims: %s: %s", type(e).__name__, e)`; the token is never logged. **main.py**: `missing_bearer` at the missing-token 401 path (`_authorized`, ~`:157-158`); status codes unchanged.
4. **oauth_server.py**: `oauth.txn.rejected{malformed | bad_sig | decode | state_mismatch}` at `:61-62`, `:64-65`, `:68-69`, `:203` (design.md); `oauth.requests` `outcome` `upstream_error` (AioRpcError UNAVAILABLE/DEADLINE_EXCEEDED), `invalid_grant` (other AioRpcError), `error` (non-gRPC), `unsupported_grant_type` (`:272`); the two bare excepts (`:259`, `:268`) gain a `log.warning` carrying the gRPC code name or exception class only, never the code, token or state; the 400 `invalid_grant` response is unchanged. Do not catch the `_txn_key` raise (NC-4).
5. **tools.py**: `agent.degraded{kind}` at the swallowed post-commit sites: `alert_threshold_default`, `auto_alert`, `watchlist_add`, `policy_default`; unchanged return values. **Onboarding**: log `OAuth` token-exchange success is identity's existing `"OAuth code exchanged"` INFO (carries `userId`); the agent adds one INFO `"first successful tool call"` with `user_id` as a log FIELD (never a label), guarded by an in-memory seen-set capped at 10000 entries (named invariant, design.md 1.13).

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . && ! git diff -U0 -- app/tools.py | grep -q "_grpc_error_message"
```
(`_grpc_error_message` must not appear in the diff.)

---

### Step 16 — test: Agent telemetry tests

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_mtls_backend_errors.py` — create
- `services/xstockstrat-agent/tests/test_auth.py` — modify
- `services/xstockstrat-agent/tests/test_oauth.py` — modify
- `services/xstockstrat-agent/tests/test_ingest_signal_watchlist.py` — modify
- `services/xstockstrat-agent/tests/test_tool_metrics.py` — modify
- `services/xstockstrat-agent/tests/conftest.py` — modify (only if a second consumer forces a fixture, C-13)

**Reviewers**: Service owner `xstockstrat-agent` — tool contract stability; Security — no code, token or state in any log or label

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-agent/tests` → `test_auth.py`, `test_oauth.py`, `test_mtls.py`, `test_ingest_signal_watchlist.py`, `test_tool_metrics.py`, `test_list_opportunities_deadline.py`.
- Confirmed via: `grep -n "secure_channel" services/xstockstrat-agent/tests/conftest.py` (design.md cites `:124-126` and `:197-199` as fixtures that BYPASS the wrapper); the new test must patch the `grpc.aio.secure_channel` attribute that `mtls.py` calls, never `app.client.mtls`.
- C-13 verdict: the loopback analysis fake in AC-21 has one consumer (this file), inline; `conftest.py` changes only on a second consumer.

**TDD**: red-green required

**Covers**: `AC-19, AC-20, AC-21, AC-47`

**Instructions**:
- `test_mtls_backend_errors.py` (design.md 1.9 a-d): (a) an `AioRpcError(DEADLINE_EXCEEDED)` raised inside `async with mtls.secure_channel(...)` gives `agent.backend.rpc_errors` +1 and `pytest.raises` receives the SAME exception object; (b) AC-21 end to end: a loopback analysis fake with `lambda ep, _creds, options=None: grpc.aio.insecure_channel(ep)` patched onto `grpc.aio.secure_channel`, tool `list_opportunities` receives DEADLINE_EXCEEDED -> `{backend=analysis, grpc_code=DEADLINE_EXCEEDED}` +1 and `mcp.tool.duration` gains no new attribute key; (c) a non-RPC exception gives no count, with a positive control in the same reader; (d) a raising accessor still lets the original exception propagate. `test_mtls.py:122` (eager `RuntimeError`) must still pass.
- AC-19: `MTLS_CERT` unset, request with a bearer token -> `mcp.auth.rejected{internal_error}` +1, HTTP status still 401, the ERROR log names `RuntimeError` and does not contain the token.
- AC-20: identity `RefreshOAuthToken` fails UNAVAILABLE for refresh token `rt-secret-1`, `POST /oauth/token` with `grant_type=refresh_token` -> `oauth.requests{refresh_token, upstream_error}` +1, a warning contains `UNAVAILABLE`, no log line or label contains `rt-secret-1`, response still 400 `invalid_grant`.
- AC-47: a callback with a well-formed txn blob whose HMAC mismatches -> `oauth.txn.rejected{bad_sig}` +1; a non-deduplicated `ingest_signal` with conviction 0.9 whose auto-alert `EmitAlert` fails after commit -> `agent.degraded{auto_alert}` +1 and the ingest result unchanged; a successful exchange for `u-9` then that user's first successful tool call -> exactly 1 INFO `"first successful tool call"` with `user_id=u-9` as a field, a second call writes none, and no metric attribute contains `u-9`.

**Verification**:
```
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40 -q && ruff check . && ruff format --check .
```

---

### Step 17 — service: Identity login, token, exchange, refresh and audit signals (SEV-2)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/telemetry.ts` — modify (instruments + key constants)
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify
- `services/xstockstrat-identity/src/grpc/ledgerAudit.ts` — modify

**Reviewers**: Service owner `xstockstrat-identity` — JWT expiry and rotation, secret handling (no token, email or hash in a log or label); Security — never log tokens, passwords, hashes or emails

**Codebase Evidence**:
- Confirmed via: `grep -n "async validateToken\|async refreshToken\|async exchangeAuthCode" src/grpc/identityServiceImpl.ts` → `validateToken :189`, `refreshToken :210` (catch `log.error('refreshToken failed', ...)` `:239`), `exchangeAuthCode :480`; login `:133-183` (design.md); `auditSafe :728-739` awaited before the reply at `:708, :769, :830, :872, :921` (recon).
- Confirmed via: `sed -n 40,66p src/grpc/ledgerAudit.ts` → `client.appendEvent(req, outMd, cb)` inside a `new Promise` with NO deadline option; `catch (err) { log.error('ledger audit append failed (best-effort)', { eventType, error: ... }) }` `~:60-65`.
- Confirmed via: `telemetry.ts` `grpcStatusCode :56`; recon NC-2 resolved: the Node status-code metric records `callback({code})` (`identity telemetry.export.test.ts:267-305`).
- Existing pattern: the JWT secret getter throws (`:113-120` per design.md), so the `secret_missing` classification reads `process.env.JWT_SECRET`, not the getter.
- Existing tests: `src/__tests__/identityServiceImpl.test.ts`, `identityServiceImpl.otlp.test.ts`; `ledgerAudit` has no client injection seam (design.md step 7), so the audit test mocks the module.

**TDD**: red-green required

**Covers**: —

**Instructions**:
Signals only: response bodies and codes are unchanged (`code 16 "invalid credentials"`, `"invalid or expired token"`), the audit `AppendEvent` gets NO new deadline, no per-call log in `validateToken`.
1. **Instruments + keys**: `identity.login.failures{reason}`, `identity.token.validate_failures{reason}`, `identity.oauth.exchange_failures{reason}`, `identity.refresh.rejections{kind}`, `identity.audit.failures{event_type}`, `identity.audit.append.duration`; keys `reason`, `kind`, `event_type` (the six `user.*` types plus `other`).
2. **login** reasons (design.md 1.4): `missing_fields`, `unknown_or_inactive`, `blocked_default_admin`, `bad_password`, `internal` (the outer catch, which also catches the `mintAccessToken` throw: a declared overlap).
3. **validateToken**: `missing_token` at the missing-token return; classify in the catch before `callback`: `!process.env.JWT_SECRET` -> `secret_missing`, `err.name === 'TokenExpiredError'` -> `expired`, `JsonWebTokenError` or `NotBeforeError` -> `invalid`, else `other`. Only `secret_missing` logs: one `log.error('ValidateToken: JWT secret missing')` per process (module-level flag).
4. **exchangeAuthCode** reasons: `missing_fields`, `unknown_code`, `replay`, `expired`, `client_or_redirect_mismatch`, `pkce_mismatch`, `redeem_race`, `internal`. **refresh**: `identity.refresh.rejections{first_party}` at the first-party rejection (`:217-218`), `{oauth}` at the OAuth refresh rejection (`:534`).
5. **ledgerAudit.ts**: time the `appendEvent` promise (histogram `identity.audit.append.duration`) and count `identity.audit.failures{event_type}` in the existing catch (`:60-65`); no deadline is added, the catch still swallows.

**Verification**:
```
cd services/xstockstrat-identity && pnpm run lint && pnpm exec tsc --noEmit && ! grep -n "deadline" src/grpc/ledgerAudit.ts
```
(No `deadline` token may appear in `ledgerAudit.ts`.)

---

### Step 18 — test: Identity telemetry tests

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/identityTelemetry.test.ts` — create

**Reviewers**: Service owner `xstockstrat-identity` — secret handling; Security — no email or token in any log or label

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-identity/src/__tests__` → `identityServiceImpl.test.ts`, `identityServiceImpl.otlp.test.ts`, `telemetry.test.ts`, `telemetry.export.test.ts`, and a `fixtures/` directory (C-13 Node home).
- C-13 verdict: reuse the existing `CollectingReader` helper (Step 6 decided where it lives); user rows come from `src/__tests__/fixtures/` if present, otherwise inline (one consumer).

**TDD**: red-green required

**Covers**: `AC-22, AC-23, AC-24, AC-52`

**Instructions**:
- AC-22: login `a@example.com` with a wrong password and an unknown email -> `login.failures{bad_password}` +1, `{unknown_or_inactive}` +1, both responses code 16 `invalid credentials`, no log line or label contains `a@example.com`.
- AC-23: `validateToken` with an expired token, a malformed token, and `JWT_SECRET` unset -> `validate_failures` +1 each for `expired`, `invalid`, `secret_missing`; exactly one ERROR `ValidateToken: JWT secret missing`; no per-call log for expired/invalid; every response code 16 `invalid or expired token`.
- AC-24: mock `ledgerAudit` so `appendEvent` fails for `identity.user.created` -> `audit.failures{identity.user.created}` +1, `audit.append.duration` 1 sample, and the AppendEvent call options carry no deadline.
- AC-52: an auth code redeemed once then redeemed again -> `exchange_failures{replay}` +1; an expired first-party refresh token -> `refresh.rejections{first_party}` +1; both responses unchanged.

**Verification**:
```
cd services/xstockstrat-identity && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint
```

---

### Step 19 — service: Config GetSecret/SetConfig attribution, listener health and ledger notifier (SEV-2)

**Status**: `pending`
**Service**: `xstockstrat-config`, `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-config/src/telemetry.ts` — modify (instruments + key constants)
- `services/xstockstrat-config/src/grpc/authz.ts` — modify (`secretDenialReason`)
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify
- `services/xstockstrat-ledger/src/telemetry.ts` — modify (instruments)
- `services/xstockstrat-ledger/src/services/eventNotifier.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — WatchConfig stream stability, no secret values in any log, config authz allow-list unchanged; Service owner `xstockstrat-ledger` — append-only invariant, event ordering, LISTEN recovery; Security — GetSecret audit line never carries a value, caller ids truncated

**Codebase Evidence**:
- Confirmed via: `sed -n 168,183p services/xstockstrat-config/src/grpc/authz.ts` → `hasSecretCallerAuthority(call, namespace, key): boolean` reads `first(call.metadata, HEADER_INTERNAL_CALLER)`, returns `false` if absent, then `SECRET_CALLER_ALLOWLIST.some(grant => grant.callerID === callerID && grant.namespace === namespace && (keys/keyPrefixes match) && (grant.peerSan === undefined || peerDnsSans(call).includes(grant.peerSan)))`.
- Confirmed via: `grep -n` in `configServiceImpl.ts` → `connectedOnce :167`, `connectListener :188` (error/end handlers `:193-194`, `this.connectedOnce ? this.resyncAll() : this.reloadAll()` `:199`, `this.connectedOnce = true :200`, shared boot/reconnect log `:202`), `dropListener :210`, `scheduleReconnect :223`, `reloadAll :264`, `reloadNamespace :291`, WatchConfig `call.on('error', () => {` `:400` (silent), `getSecret :458` with `log.warn('GetSecret denied — caller not on the secret allow-list', { namespace, key }) :461` (logs the key name; no caller, no reason), `setConfig :494`.
- Confirmed via: ledger `connect()` in `eventNotifier.ts`: `client.on('error', (err) => { log.warn('notify listener error, reconnecting', ...); this.scheduleReconnect(); })`, `client.on('end', ...)`, then `await client.connect(); await client.query('LISTEN ...'); this.client = client; const reconnected = this.connectedOnce; this.connectedOnce = true; log.info('notify listener connected', { channel, reconnected })`; the connect catch `log.warn('notify listener connect failed, retrying', ...)` then `this.scheduleReconnect()`; `scheduleReconnect` sets `this.client = null` and uses the fixed `reconnectDelayMs` timer.
- Existing tests: config `src/__tests__/secretCallerAuthz.test.ts`, `configServiceImpl.test.ts`, `setConfigAuthz.test.ts`, `internalCallerAuthz.test.ts`, `internalCallerSetConfig.test.ts`; ledger `src/__tests__/eventNotifier.test.ts`.
- 281 overlap: config `configServiceImpl.ts` / `SCALAR_BOUNDS_REGISTRY`; textual rebase only.

**TDD**: red-green required

**Covers**: —

**Instructions**:
Signals only; the GetSecret gate stays driven by the boolean `hasSecretCallerAuthority` (design.md Rejected Alternatives); no value is ever logged.
1. **config instruments**: observable gauges `config.listener_up` (0/1) and `config.last_reload_timestamp` (unix seconds), counters `config.listener_reconnects` and `config.watch.terminated{reason}`; keys `reason`.
2. **authz.ts**: add `secretDenialReason(call, ns, key)` beside `hasSecretCallerAuthority`, returning, in order, `no_caller_header`, `unknown_caller`, `key_not_granted`, `peer_san_mismatch`, or `null` when authorized. Log-only. Do not edit `hasSecretCallerAuthority`.
3. **getSecret**: the denial log (`:461`) gains `callerId` (truncated to 64 chars, named invariant), `reason`, `hadPeerSan`; success writes ONE `log.info('GetSecret served', { callerId, namespace, key, found })` (`found` false at the not-found return, true at the success return), never the value; the silent DB catch (`~:489-491`) gains `log.error('GetSecret DB error', ...)` with the error message. **setConfig** denials (`:511-528`): log `reason` `no_admin_or_internal_grant` / `not_owner`; when an `x-internal-caller` header is present the first denial log is raised to ERROR with `internalCaller` (truncated 64); only the target state name is logged, never another config value. **WatchConfig** `call.on('error', ...)` now logs WARN `'WatchConfig subscriber error'` with the error message and increments `config.watch.terminated{client_error}`; `endSubscriber` increments `{server_error}`.
4. **Listener** (design.md 1.7): capture `const reconnected = this.connectedOnce;` BEFORE the reload at `:199` (`:200` overwrites it); after the reload, only `if (this.listener === client)`, set `config.listener_up = 1` and `listener_reconnects += 1` when `reconnected`; `:202` log gains `{reconnected}`; `dropListener` sets 0 right after its `this.listener !== c` guard; the boot failure path leaves the gauge at its initial 0; `config.last_reload_timestamp` set at the end of `reloadAll` (after `:288`) and `reloadNamespace` (after `:310`).
5. **ledger** (`eventNotifier.ts`, FR-8 + FR-14): gauge `ledger.notify.listener_up` = 1 after `this.client = client`, 0 at the top of `scheduleReconnect`; counter `ledger.notify.listener_reconnects` +1 when `reconnected`. One new field `private consecutiveFailures = 0` covers both WARNs: the connect-failed catch increments it for every failed attempt; the client `error` handler increments it ONLY when `this.client === client` (checked before `scheduleReconnect` nulls it). Each site logs only when `n === 1 || n % 10 === 0` with `consecutive_failures: n`; reset to 0 right after `this.client = client` on a successful connect. `scheduleReconnect` and `reconnectDelayMs` timing are unchanged.

**Verification**:
```
for s in config ledger; do (cd services/xstockstrat-$s && pnpm run lint && pnpm exec tsc --noEmit) || exit 1; done; cd services/xstockstrat-config && ! git diff -U0 -- src/grpc/authz.ts | grep -qE "^-.*(SECRET_CALLER_ALLOWLIST|hasSecretCallerAuthority)"
```
(No removed line in `authz.ts` may touch the gate.)

---

### Step 20 — test: Config and ledger telemetry tests

**Status**: `pending`
**Service**: `xstockstrat-config`, `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-config/src/__tests__/secretCallerAuthz.test.ts` — modify (parity test)
- `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/setConfigAuthz.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/configListenerTelemetry.test.ts` — create
- `services/xstockstrat-ledger/src/__tests__/eventNotifier.test.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — no secret values in any log; Service owner `xstockstrat-ledger` — LISTEN recovery; Security — denial and audit lines carry no value

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-config/src/__tests__` → `secretCallerAuthz.test.ts`, `internalCallerAuthz.test.ts`, `setConfigAuthz.test.ts`, `configServiceImpl.test.ts` (recon cites `captureStdout` at `:388-396`), `perUserSecrets.test.ts`.
- Confirmed via: `ls services/xstockstrat-ledger/src/__tests__` → `eventNotifier.test.ts`.
- C-13 verdict: grant fixtures for the parity test are the existing `SECRET_CALLER_ALLOWLIST` entries (no new literal); `captureStdout` is copied into `configListenerTelemetry.test.ts` only if `configServiceImpl.test.ts` is not extended instead (prefer extending, one consumer).

**TDD**: red-green required

**Covers**: `AC-25, AC-26, AC-27, AC-40, AC-48, AC-54`

**Instructions**:
- Parity (`secretCallerAuthz.test.ts`): for every grant fixture combination, `secretDenialReason(...) !== null` iff `!hasSecretCallerAuthority(...)`.
- AC-25: caller `marketdata`, ns `marketdata`, key `fmp.api_key`, no `xstockstrat-marketdata` peer SAN -> warn log has `callerId=marketdata`, `reason=peer_san_mismatch`, `hadPeerSan=false`; caller `ingest` asking for that ns/key -> `key_not_granted`; no log contains a secret value; the response is still `PERMISSION_DENIED`.
- AC-26: authorized read of an existing secret -> exactly one INFO `GetSecret served` with `callerId=marketdata`, `namespace`, key name, `found=true`; no log contains the decrypted value.
- AC-54: caller `trading-reconciliation-poller` with no admin scope writes `platform.trading_state` to `ACTIVE` (forbidden by its grant) -> log at error level with `internalCaller=trading-reconciliation-poller`, response `PERMISSION_DENIED`, no config value other than the target state name logged.
- AC-48: a fake LISTEN client that drops and reconnects, and a WatchConfig subscriber call that errors -> `config.listener_up` is 0 while disconnected and 1 after reconnect (and stays 0 if the client errors mid-reload), `listener_reconnects` +1, `last_reload_timestamp` equals the injected last-reload time, `watch.terminated{client_error}` +1, WARN `WatchConfig subscriber error` with the message and no config value.
- AC-27 and AC-40 (`eventNotifier.test.ts`): a fake pg client dropping then reconnecting after 2 s -> `ledger.notify.listener_up` 0 then 1, `listener_reconnects` +1; a fake client that only rejects `connect` 30 times with `reconnectDelayMs` 2000 -> warn lines only at consecutive failures 1, 10, 20, 30, each with `consecutive_failures`, each retry still 2000 ms apart, and after a successful connect the next failure logs as 1; a second fake whose ESTABLISHED client emits `error` proves one failure is never counted twice (record whether node-pg emits `error` during LISTEN, design.md Open Risk).

**Verification**:
```
for s in config ledger; do (cd services/xstockstrat-$s && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint) || exit 1; done
```

---

### Step 21 — service: Notify delivery, stream and startup signals

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/telemetry.ts` — modify (instruments + key constants)
- `services/xstockstrat-notify/src/fanout/fanout.ts` — modify
- `services/xstockstrat-notify/src/fanout/webPush.ts` — modify
- `services/xstockstrat-notify/src/fanout/deliveryChannels.ts` — create
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify
- `services/xstockstrat-notify/src/index.ts` — modify

**Reviewers**: Service owner `xstockstrat-notify` — stream delivery guarantees, backpressure handling, alert deduplication (a Slack timeout never delays the stream); Security — no key or webhook value in any log

**Codebase Evidence**:
- Confirmed via: `grep -n "export class FanoutDispatcher\|min_severity" src/fanout/fanout.ts` → `FanoutDispatcher :41`, `notify.fanout.min_severity` read at `:56`; gates `:57, :65, :76`, dispatch error `:100-102`, Slack/SendGrid logs `:130-134`, `:173-177` (recon/design.md).
- Confirmed via: `sed -n 70,95p src/grpc/notifyServiceImpl.ts` → the alert write loop: `for (const [subId, sub] of this.subscribers) { if (this.matchesSubscriber(alert, sub)) { try { sub.call.write(alert); deliveredCount++; } catch { this.subscribers.delete(subId); } } }` — the eviction is silent today; `cancelled`/`error` handlers at `:139-143`.
- Confirmed via: `sed -n 30,50 src/index.ts` → `const fanout = new FanoutDispatcher(configWatcher); const webPush = new WebPushDispatcher(pool, configWatcher, createAdminDirectory()); const notifyImpl = new NotifyServiceImpl(pool, configWatcher, fanout, webPush);` — the startup log goes after these constructions; no "enabled channels" log exists (recon "Not found").
- Existing tests: `src/__tests__/fanout.test.ts`, `notifyServiceImpl.test.ts`, `webPush.test.ts`.

**TDD**: red-green required

**Covers**: —

**Instructions**:
`category` and `sourceService` are never labels. Delivery semantics are unchanged.
1. **Instruments**: `notify.delivery{channel, outcome}`, `notify.stream.evictions{reason}`, observable gauge `notify.stream.subscribers` reading `this.subscribers.size`; keys `channel`, `outcome`, `reason`.
2. **fanout.ts**: channel `fanout` outcomes `gated_severity`, `gated_conviction`, `deduped`, `dispatch_error` at the existing gates and the `:100-102` catch; channel `slack` / `sendgrid`: `sent`, `http_error`, `timeout` (AbortError), `error` at the existing send results. **webPush.ts**: channel `push` outcomes `disabled`, `gated_severity`, `admin_lookup_error`, `no_audience`, `sent`, `pruned`, `error`, `dispatch_error` at the existing silent returns and results (recon: silent returns `:87, :93, :111-113, :122`).
3. **notifyServiceImpl.ts**: the silent `catch` in the write loop records `notify.stream.evictions{write_error}` and writes `log.warn('StreamAlerts subscriber evicted', { reason })` (no alert body), still deleting the subscriber; the stream `error` handler (`~:143`) records `{stream_error}`.
4. **Startup line**: Slack and SendGrid presence is held privately in `FanoutDispatcher` (`this.slackWebhookUrl`, `this.sendgridApiKey`, `fanout.ts:47-48`) and push in `WebPushDispatcher.vapidConfigured` (`webPush.ts:77`, set from `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY`/`VAPID_SUBJECT`). Add a read-only `enabledChannels(): {slack: boolean; sendgrid: boolean}` to `FanoutDispatcher` and an `isPushEnabled(): boolean` to `WebPushDispatcher`, plus a pure `describeDeliveryChannels(fanout, webPush): {enabled: string; disabled: string}` in the new `src/fanout/deliveryChannels.ts` (importable by tests without booting the server). In `src/index.ts`, after the three constructions, write ONE `log.info('delivery channels', describeDeliveryChannels(fanout, webPush))`, e.g. `{ enabled: 'slack,push', disabled: 'sendgrid' }`; names only, never a webhook, key or VAPID value.

**Verification**:
```
cd services/xstockstrat-notify && pnpm run lint && pnpm exec tsc --noEmit
```

---

### Step 22 — test: Notify telemetry tests

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/fanout.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/deliveryChannelsLog.test.ts` — create

**Reviewers**: Service owner `xstockstrat-notify` — stream delivery guarantees; Security — no key or webhook value in the startup line

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-notify/src/__tests__` → `fanout.test.ts`, `notifyServiceImpl.test.ts`, `webPush.test.ts`, `telemetry.test.ts`.
- C-13 verdict: notify has no `src/__tests__/fixtures/` directory (`ls` shows none); create none speculatively. Subscriber fakes stay inline in the existing test files (one consumer each).

**TDD**: red-green required

**Covers**: `AC-31, AC-32, AC-49`

**Instructions**:
- AC-31: alert severity INFO below `notify.fanout.min_severity` 2, Slack disabled -> `notify.delivery{fanout, gated_severity}` +1, no sample with `channel=slack`, no attribute carries the category or `sourceService`.
- AC-32: 3 matching `StreamAlerts` subscribers, the write to `sub-2` throws -> `notify.stream.evictions{write_error}` +1 and the gauge `notify.stream.subscribers` reads 2; the other two still receive the alert.
- AC-49: `SLACK_WEBHOOK_URL` set, `SENDGRID_API_KEY` unset, VAPID configured -> exactly one INFO `delivery channels` listing enabled `slack,push` and disabled `sendgrid`; no key or webhook value appears. Test `describeDeliveryChannels` from `src/fanout/deliveryChannels.ts` with real `FanoutDispatcher` / `WebPushDispatcher` instances built under the stated env vars (no server boot), and assert the logged line via a captured logger.
- Span propagation: assert (per Step 6's `queueMicrotask` result) whether a fanout dispatch started in a span keeps it; record the outcome in the test docstring (design.md Open Risk).

**Verification**:
```
cd services/xstockstrat-notify && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint
```

---

### Step 23 — service: UI BFF auth, audit and per-method signals

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/bffMetrics.ts` — modify (`'auth'` segment, `ui.auth.events`, `ui.bff.requests`)
- `services/xstockstrat-ui/src/lib/bffShared.ts` — modify
- `services/xstockstrat-ui/src/lib/identity.ts` — modify
- `services/xstockstrat-ui/src/lib/auth.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/login/route.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/refresh/route.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/logout/route.ts` — modify
- `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts` — modify

**Reviewers**: Service owner `xstockstrat-ui` — BFF correctness, no secret values rendered or logged, no direct DB access beyond the audit route; Security — never log email, password or token; Connect code only

**Codebase Evidence**:
- Confirmed via: `cat src/lib/bffMetrics.ts` → `type BffSegment = 'trader' | 'insights' | 'config-ui' | 'accounts'` (`:7`), lazy histogram rebinding on `boundTo !== provider` (`:13-23`), `recordBffDuration({segment, route, rpcService, status, startMs})` (`:26-40`), `withBffMetrics(segment, route, handler)` (`:43`).
- Confirmed via: `sed -n 108,148 src/lib/bffShared.ts` → `createDispatch(router, prefix)`; unmatched path -> `recordBffDuration({ segment, rpcService: 'unmatched', status: 404, startMs })`; `const timed = handler.method.methodKind === 'unary'`; `finally { if (timed) recordBffDuration({ segment, rpcService: handler.service.typeName, status, startMs }) }` — `handler.method.name` and `handler.service.typeName` are in scope.
- Confirmed via: `cat src/app/api/auth/login/route.ts` → invalid body 400; success `setSessionCookies`; `Code.Unauthenticated` -> 401 `{error:'Invalid credentials'}`; other -> `serverLog.error('[login] identity service error:', ...)` + 503. `refresh/route.ts`: no cookie -> 401, `refreshSession` null -> 401 + `clearSessionCookies`. `logout/route.ts`: `revokeToken` then 200.
- Confirmed via: `src/lib/identity.ts` `refreshSession` bare `catch { return null }` and `revokeToken` bare catch; `src/lib/auth.ts` `verifyAccessToken`: `if (!secret) return null` and bare `catch { return null }`.
- Confirmed via: `src/app/config-ui/api/audit/route.ts` `GET`: 401 `Unauthorized`, 403 `Forbidden` for non-admin, `if (!process.env.DATABASE_URL) return NextResponse.json({ entries: [] })`, DB error `serverLog.error('config-ui audit: database error', { traceId: req.headers.get(HEADER_TRACE_ID) ?? '', ... })` — camelCase `traceId` (design.md 1.10 records the divergence from `trace_id`).
- Confirmed via: `src/lib/serverLog.ts` `serverLog.info/warn/error(message, detail)` writes stdout plus an OTLP log record; `src/telemetry.ts` exports only `initTelemetry`, hence the accessor lives in `bffMetrics.ts`.
- DRY: `.husky/pre-commit` ENFORCES jscpd (threshold 0) on `services/xstockstrat-ui/src`; reuse `recordBffDuration`/`withBffMetrics` rather than a parallel wrapper.

**TDD**: red-green required

**Covers**: —

**Instructions**:
Response bodies and status codes are unchanged. Constitution C-17 does not apply (no UI component or page is touched).
1. **bffMetrics.ts**: extend `BffSegment` with `'auth'`; add rebinding counters `ui.auth.events{event[, reason]}` and `ui.bff.requests{rpc_service, rpc_method, outcome}` (bucket-free, separate from `http.server.duration`, so that histogram gains no new attribute key); never user id, email, symbol or raw path.
2. **bffShared.ts** `createDispatch` finally block: unary only, record `ui.bff.requests` with `rpc_service = handler.service.typeName` (verbatim, e.g. `xstockstrat.analysis.v1.AnalysisService`), `rpc_method = handler.method.name`, `outcome` = `ok` (status < 400), `client_error` (4xx), `server_error` (5xx); an unmatched path records `unmatched` / `unmatched` / `client_error`.
3. **auth events**: `login_invalid_request`, `login_ok`, `login_failed` (Unauthenticated), `login_error` in the login route; `refresh_missing` in the refresh route; `refresh_ok` / `refresh_rejected` (Unauthenticated) / `refresh_error` inside `refreshSession` (the function still returns `null` on any failure); `logout` in the logout route (no failure outcome because `revokeToken` swallows errors); `jwt_rejected` with `reason` `no_secret` (the `!secret` early return) or `expired` / `invalid` (the catch, classified by the `jose` error class) in `verifyAccessToken`, which still returns `null`.
4. **Wrap routes**: `withBffMetrics('auth', '/api/auth/login', ...)`, `.../refresh`, and `withBffMetrics('config-ui', '/config-ui/api/audit', ...)` around `GET`, so these join `http.server.duration` (`@AC-16 @feature-274` extend); logout is wrapped likewise.
5. **serverLog entries** (Connect code or class only, never the token, email or password): login failure/error, refresh rejection/error, and the audit route: `serverLog.warn` for the 401, the 403 (non-admin probe) and the `!process.env.DATABASE_URL` case, using the existing camelCase `traceId` key; the missing-DATABASE_URL response stays `200 {entries: []}`.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && cd ../.. && bash scripts/check-duplication.sh services/xstockstrat-ui/src
```
(The duplication script runs from the repo root and must report no clones; it is the enforced pre-commit gate for `xstockstrat-ui/src`.)

---

### Step 24 — test: UI BFF telemetry tests

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/__tests__/bffMetrics.test.ts` — modify
- `services/xstockstrat-ui/src/lib/__tests__/bffAuthMetrics.test.ts` — create
- `services/xstockstrat-ui/src/lib/identity.test.ts` — modify
- `services/xstockstrat-ui/src/lib/auth.test.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify only if a fixture is added

**Reviewers**: Service owner `xstockstrat-ui` — BFF correctness, no secret values logged; Security — no email or password in any log or label

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-ui/src/lib/__tests__` → `bffMetrics.test.ts`, `insightsBff.test.ts`, `traderBff.test.ts`; `identity.test.ts` and `auth.test.ts` live beside the modules; vitest config includes `src/**/*.test.ts`, coverage scoped to `src/lib/**` with thresholds lines/functions/statements 40 (`vitest.config.ts`), and `identity.ts` is excluded from coverage.
- Confirmed via: `ls services/xstockstrat-ui/e2e/fixtures` → `users.ts`, `index.ts`, `INVENTORY.md`, etc.; recon: `bffMetrics.test.ts` uses a custom `CollectingReader` with fixtures from `e2e/fixtures/` (C-12).
- C-12 rule: user/credential literals come from `e2e/fixtures/users.ts` (import via `../fixtures`), auth helpers from `e2e/helpers/auth.ts`; error payloads and `{ ...FIXTURE, override }` spreads are exempt one-offs. Route handlers are tested by calling `POST(new NextRequest(...))` with `identityClient` mocked.

**TDD**: red-green required

**Covers**: `AC-33, AC-34, AC-35, AC-36, AC-55`

**Instructions**:
- AC-33: `POST /api/auth/login` with an unknown email, identity mock throwing `ConnectError(Code.Unauthenticated)` -> `ui.auth.events{login_failed}` +1, an `http.server.duration` sample for route `/api/auth/login` with status 401, response still 401 `{"error":"Invalid credentials"}`, no log line or label contains the email or password.
- AC-34: `refreshSession` with identity throwing `DeadlineExceeded` -> `ui.auth.events{refresh_error}` +1 and the function returns `null`; `verifyAccessToken` with `JWT_SECRET` empty -> `ui.auth.events{jwt_rejected, reason=no_secret}` +1 and returns `null`.
- AC-35: `DATABASE_URL` unset, non-admin session `GET /config-ui/api/audit` -> a warn log records the 403 and the response is 403; admin session with `DATABASE_URL` unset -> still `200 {"entries":[]}` and a warn is logged.
- AC-36: the Connect dispatcher handling analysis `SetOpportunityAction` returning HTTP 500 -> `ui.bff.requests{rpc_service=xstockstrat.analysis.v1.AnalysisService, rpc_method=SetOpportunityAction, outcome=server_error}` +1, and `http.server.duration` gains no new attribute key.
- AC-55: admin `GET /config-ui/api/audit?limit=50` with an 80 ms query and 200 response -> an `http.server.duration` sample for route `/config-ui/api/audit` with status 200 and the body unchanged.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run test:unit && pnpm run test:coverage && pnpm run lint && cd ../.. && bash scripts/check-duplication.sh services/xstockstrat-ui/src
```
Coverage thresholds (40%) are enforced by `vitest.config.ts`; the Playwright e2e suite is not re-run (no page or response shape changed).

---

### Step 25 — service: Ingest poll, signal-outcome, backfill and dedup signals (SEV-3)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/telemetry.py` — modify (instruments, `Loop` member, key constants)
- `services/xstockstrat-ingest/app/engine/mcp_client_loop.py` — modify
- `services/xstockstrat-ingest/app/extractors/base.py` — modify (`McpClientInput.slug`)
- `services/xstockstrat-ingest/app/extractors/mcp_client.py` — modify
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — signal normalization correctness, idempotent ingestion; the per-item try keeps ingesting; the slug is never a label

**Codebase Evidence**:
- Confirmed via: `grep -n "def \|log\." app/engine/mcp_client_loop.py` → `poll_one_source :113` (per-item skip WARN `:151`, polled summary INFO `:155`), `run_one_cycle :160` (per-source failure WARN `:175`), `run_mcp_client_loop :184` (cycle failed WARN `:198`); design.md sites: config error `:125-126`, no-bearer returns `:129-131`/`:136-138` (they only call `mark_source_error`, no log), `_ingest_external_signal` call `:148` inside the per-item try `:147-154`, `list_all_sources` `:164`, `poll_one_source` call `:173`.
- Confirmed via: `sed -n 15,45 app/extractors/mcp_client.py` → three WARN drop branches log `%r` of the WHOLE item with no slug: non-object, bad symbol/direction, out-of-range conviction; `extract(self, raw)` takes only `McpClientInput`. `app/extractors/base.py` `@dataclass class McpClientInput: result_items: list[dict]`.
- Confirmed via: `servicer.py`: `IngestSignal :958` (calls `self._ingest_external_signal(` at `:970`), `_ingest_external_signal :984` (typed `-> tuple[int, bool]`), dedup INFO `"deduplicated signal source=%s symbol=%s direction=%s -> signal_id=%d"` at `:1162`, `_resume_job :737` (no `try`), `asyncio.create_task(self._run_backfill(...)) :438`, `asyncio.create_task(self._resume_job(job_id)) :734`, `InstantiateTemplate :1587`.
- Confirmed via: `tests/test_mcp_client_loop.py:192` spy on `_ingest_external_signal` (design.md): a `path` kwarg would `TypeError` it, so none is added.
- Existing pattern: exceptions `_SignalValidationError`, `_SignalSourceNotFound`, `_SignalIngestError` in `servicer.py` (design.md 1.14).

**TDD**: red-green required

**Covers**: —

**Instructions**:
Source-health derivation and task supervision are unchanged; `_resume_job` still re-raises; no slug in any label.
1. **Instruments + keys**: `ingest.source.poll{outcome}`, `ingest.source.poll.duration`, `ingest.signal.dropped{stage, reason}`, `ingest.signal.outcome{path, outcome}`, `ingest.backfill.jobs{outcome}`, `template.instantiate{service="ingest", outcome}`; keys `outcome`, `stage`, `reason`, `path`, `service`. `Loop` member `mcp_client`.
2. **mcp_client_loop.py**: `ingest.source.poll` outcomes `ok`, `no_bearer`, `config_error`, `all_items_failed`, `error`; both no-bearer returns also write `log.warning("mcp_client loop: source %s bearer not configured", slug)`; histogram wraps the `poll_one_source` call at `:173`; per-cycle counts (`attempted` = sources that reached `poll_one_source`, `failed` = it raised, bearer-not-configured counts as attempted not failed) feed one `loop tick ok` (`mcp_client`) at the end of `run_one_cycle`, none when `list_all_sources` raised or `attempted > 0 and failed == attempted`, `idle` when 0 sources. `:148` becomes `_sid, dedup = await servicer._ingest_external_signal(...)` (2-tuple, inside the per-item try) with `ingest.signal.outcome{path=mcp_poll}`: `deduplicated` / `ingested`, `rejected` for `_SignalValidationError`/`_SignalSourceNotFound`, `error` for others inside the existing except at `:150`. Pass `slug` to `McpClientInput` at `:142`.
3. **Extractor**: `McpClientInput` gains `slug: str = ""`; the three drop branches log `slug` and the item truncated to 200 characters (`repr(item)[:200]`), and count `ingest.signal.dropped{stage=extract, reason non_object|bad_symbol_direction|bad_conviction}`.
4. **servicer.py**: `_record_signal_outcome(path, outcome)` (never-raising) and a classifier beside the exception classes; `IngestSignal` records `path=rpc`: success -> `deduplicated` / `ingested`, validation / source-not-found -> `rejected`, `_SignalIngestError` -> `error`, plus `except Exception: record("rpc","error"); raise` so propagation is unchanged. The dedup INFO at `:1162` becomes a `log.debug` with its text unchanged (N-01; the counter replaces it at INFO). `_resume_job`: wrap the body in `try/except Exception as exc: log.error("_resume_job failed job=%s", job_id, exc_info=True); ingest.backfill.jobs{failed} +1; raise` (re-raises the same object; no `FAILED` marking, no `supervision.spawn`). `InstantiateTemplate` (`:1587`) records `template.instantiate{ingest, ok | unavailable | not_found | invalid_argument | already_exists | failed_precondition | other}`.

**Verification**:
```
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && grep -n "_ingest_external_signal(" tests/test_mcp_client_loop.py | head -3
```

---

### Step 26 — test: Ingest telemetry tests

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — modify
- `services/xstockstrat-ingest/tests/test_ingest_telemetry.py` — create

**Reviewers**: Service owner `xstockstrat-ingest` — idempotent ingestion; per-item skip semantics unchanged

**Codebase Evidence**:
- Confirmed via: `tests/test_mcp_client_loop.py:192` spy (design.md); `grep -n "def \|fixture" services/xstockstrat-ingest/tests/conftest.py | head` for the shared fakes (Python home per C-13).
- C-13 verdict: the fake `servicer` / DB stubs already in `tests/conftest.py` and `test_mcp_client_loop.py` are reused; a new fake needed by both files moves to `conftest.py` in this step.

**TDD**: red-green required

**Covers**: `AC-7, AC-28, AC-29, AC-30, AC-39, AC-53`

**Instructions**:
- AC-28: source slug `my-feed` with no credential -> `ingest.source.poll{no_bearer}` +1, a log line names `my-feed` (the new WARN literal), no metric attribute equals `my-feed`, and the source-health derivation result is unchanged (assert `mark_source_error` is still called exactly as before).
- AC-29: a polled signal that deduplicates against signal id 41 -> `ingest.signal.outcome{mcp_poll, deduplicated}` +1, no INFO `deduplicated signal`, one DEBUG line with the same text.
- AC-30: `_resume_job` for `job-7` raising a DB error after setting RUNNING -> ERROR `_resume_job failed` names `job-7`, `ingest.backfill.jobs{failed}` +1, and the task re-raises the same exception object (`is`).
- AC-53: source `my-feed` returns 5 items, 2 with a bad direction (one with a 4000-char headline) -> `ingest.source.poll.duration` 1 sample, `signal.dropped{extract, bad_symbol_direction}` +2, each extractor warning names `my-feed` and shows at most 200 characters of the item, the 3 valid items are still ingested.
- AC-39 (ingest half): `InstantiateTemplate` success -> `template.instantiate{ingest, ok}` +1.
- AC-7 (ingest half): the cycle's `loop tick ok` has `loop=mcp_client`, and none is written when every attempted source failed. The `:192` spy must still pass (no `path` kwarg).

**Verification**:
```
cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40 -q && ruff check . && ruff format --check .
```

---

### Step 27 — service: Indicators sandbox, template and config-watcher signals (SEV-3)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/telemetry.py` — modify (instruments + key constants)
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify
- `services/xstockstrat-indicators/app/config/watcher.py` — modify
- `services/xstockstrat-indicators/app/services/sandbox.py` — modify only if the exit-reason plumbing needs it (design.md step 12)

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, timeout enforcement (`indicators.sandbox.timeout_ms`), no side effects from formula execution; a clean watcher end still re-issues immediately

**Codebase Evidence**:
- Confirmed via: `grep -n "executing formula\|_sandbox_sem\|exit_reason_map" app/handlers/servicer.py` → pre-run INFO `"executing formula timeout_ms=%d memory_bytes=%d"` at `:293`, `self._sandbox_sem = asyncio.Semaphore(...)` `:107`, `async with self._sandbox_sem:` `:301`, `exit_reason_map = {` `:313`, `exit_reason_map.get(` `:350`; missing-output branch design.md `:324-337`; `InstantiateTemplate :664`.
- Confirmed via: `sed -n 60,100p app/config/watcher.py` → `_watch`: `async for snapshot in stream: self._snapshot = snapshot; self._snapshot_event.set(); log.debug("config updated ...")`; `except Exception as e: log.warning("config stream error (%s): %s, reconnecting in 2s", type(e).__name__, e); await asyncio.sleep(2)`; a clean end falls out of the `try` and re-loops immediately (no sleep, no log); no snapshot timestamp field.
- Existing test: `tests/test_config_watcher.py:217` asserts the ERROR path only; design.md Cross-step rule: watcher.py:90 WARN is unpinned.
- 243 overlap: `servicer.py` `_clamp_override` just above the FR-12 sites (recon R15).

**TDD**: red-green required

**Covers**: —

**Instructions**:
Signals only; the watcher's sleep behavior and the RPC status are unchanged; the `"executing formula"` text is kept verbatim.
1. **Instruments + keys**: `indicators.sandbox.executions{exit_reason}`, `indicators.sandbox.duration{exit_reason}`, `indicators.sandbox.queue_wait`, observable gauge `indicators.config.snapshot_age`, `template.instantiate{service="indicators", outcome}`; keys `exit_reason`, `outcome`, `service`.
2. **servicer.py**: `queue_wait` brackets `async with self._sandbox_sem` (`:301`); after the sandbox returns record `executions` and `duration` with `exit_reason` from `exit_reason_map` (success, timeout, memory_exceeded, runtime_error, import_blocked); the missing-declared-output branch counts `runtime_error`; unmapped -> `other`; the parameter-errors path is not counted. A non-success run writes one `log.warning` carrying `exit_reason`. The `"executing formula ..."` INFO at `:293` moves to DEBUG, text unchanged. `InstantiateTemplate` records `template.instantiate{indicators, ok | not_found | permission_denied | invalid_argument | internal | other}`.
3. **watcher.py** (design.md 1.7): `self._snapshot_at = time.monotonic()` where the snapshot is stored (`:82`), the gauge reports `time.monotonic() - _snapshot_at` and nothing before the first snapshot; one counter `self._consecutive` (reset to 0 when a snapshot arrives) serves both paths: clean end (after the `async for` exits normally, inside the `try`) does `_consecutive += 1` and writes INFO `"config stream ended cleanly"` only when the counter is 1 or a multiple of 10; the failure `except` does `_consecutive += 1` and writes the WARN only when the counter is 1 or a multiple of 10 (carrying the count). `await asyncio.sleep(2)` is unchanged and the clean-end loop still re-issues immediately.

**Verification**:
```
cd services/xstockstrat-indicators && ruff check . && ruff format --check . && grep -n "asyncio.sleep(2)" app/config/watcher.py
```

---

### Step 28 — test: Indicators telemetry tests

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_execute_formula_concurrency.py` — modify
- `services/xstockstrat-indicators/tests/test_config_watcher.py` — modify
- `services/xstockstrat-indicators/tests/test_sandbox_telemetry.py` — create

**Reviewers**: Service owner `xstockstrat-indicators` — timeout enforcement, no side effects from formula execution

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-indicators/tests` → `test_execute_formula_concurrency.py`, `test_config_watcher.py`, `test_sandbox.py`, `test_formula_templates.py`.
- C-13 verdict: existing sandbox/servicer fakes in `tests/conftest.py` are reused; one consumer for any new literal, inline compliant.
- Design.md Open Risk: the AC-50 test monkeypatches the PROCESS-GLOBAL `asyncio.sleep` (`watcher.py` calls `asyncio.sleep(2)`): restore it in a fixture teardown.

**TDD**: red-green required

**Covers**: `AC-37, AC-38, AC-39, AC-50`

**Instructions**:
- AC-37: `ExecuteFormula` for a formula exceeding `timeout_ms` 5000 with the sandbox returning `exit_reason` `timeout` -> `sandbox.executions{timeout}` +1, `sandbox.duration{timeout}` 1 sample, `queue_wait` 1 sample, one warning carrying `exit_reason=timeout`, the RPC status still OK, `"executing formula"` written at DEBUG with its text unchanged and no INFO line.
- AC-38: a `WatchConfig` stream that ends without raising -> INFO `"config stream ended cleanly"`, gauge `indicators.config.snapshot_age` reports the seconds since the last snapshot (monkeypatched `time.monotonic`), and the watcher re-issues the call immediately (no `asyncio.sleep` call).
- AC-50 (indicators half): the stream fails 20 times in a row (monkeypatched `asyncio.sleep` recorder) -> fewer than 20 warn lines and the first failure among them (lines at failures 1, 10, 20), every sleep still 2 s.
- AC-39 (indicators half): `InstantiateTemplate` success -> `template.instantiate{indicators, ok}` +1.
- `test_config_watcher.py:217` (ERROR path) must still pass.

**Verification**:
```
cd services/xstockstrat-indicators && pytest --cov=app --cov-fail-under=50 -q && ruff check . && ruff format --check .
```

---

### Step 29 — test: Final allowlist, guard and acceptance pass

**Status**: `pending`
**Service**: all 12 services; `scripts/`, `packages/otel/` (read-only checks)
**Files**:
- `services/xstockstrat-trading/internal/telemetry/allowlist_test.go` — create
- `services/xstockstrat-portfolio/internal/telemetry/allowlist_test.go` — create
- `services/xstockstrat-marketdata/internal/telemetry/allowlist_test.go` — create
- `services/xstockstrat-analysis/tests/test_telemetry_allowlist.py` — create
- `services/xstockstrat-ingest/tests/test_telemetry_allowlist.py` — create
- `services/xstockstrat-indicators/tests/test_telemetry_allowlist.py` — create
- `services/xstockstrat-agent/tests/test_telemetry_allowlist.py` — create
- `services/xstockstrat-identity/src/__tests__/telemetryAllowlist.test.ts` — create
- `services/xstockstrat-config/src/__tests__/telemetryAllowlist.test.ts` — create
- `services/xstockstrat-ledger/src/__tests__/telemetryAllowlist.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/telemetryAllowlist.test.ts` — create
- `services/xstockstrat-ui/src/lib/__tests__/bffAllowlist.test.ts` — create

**Reviewers**: Service owner of each of the 12 services — label discipline in their own module; Platform Lead — the cross-service loop-liveness pattern and shared label discipline; Security — no identifier-bearing label

**Codebase Evidence**:
- Confirmed via: `ls scripts/check-otel-produced-signals.sh` → present; its header: it fails on an alert or dashboard querying an unregistered series or on a registry row whose producer literal is gone (Part 1, Part 3, Part 4, Part 5); new series that no alert or dashboard references do not trip it (recon Dependencies, product-spec.md OQ3 agreed). Registry file `packages/otel/produced-signals.tsv` must stay unchanged (AC-43).
- Confirmed via: design.md 1.1: label keys are constants in each telemetry module; this step's tests assert every collected attribute key is a member and a MIN instrument-name set is present (the six gauge/listener instruments and `marketdata.stream.reconnects` included), reached through the earlier steps' harnesses; gauges by register-then-collect.
- Confirmed via: `grep -c "live_loop: cycle complete" services/xstockstrat-analysis/app/engine/live_loop.py` → 1 (the registered literal, line `:345`).
- Confirmed via: `docs/roadmap/features/294-signal-map-instrumentation/context.md` § "Deferred behavior follow-ups" lists the 14 IDs S-01, S-02, S-03, S-08, S-09, S-13, S-14, S-15, S-16, S-22, S-25, S-26, N-02, N-04, one row each (AC-44).
- C-13 verdict: each allowlist test reads the service's own key constants; no shared literal, no fixture home needed.

**TDD**: red-green required

**Covers**: `AC-7, AC-41, AC-42, AC-43, AC-44, AC-56`

**Instructions**:
- **Allowlist tests (AC-41)**: per service, drive the instruments through the existing step harness (or a minimal register-then-collect for gauges), collect every attribute key, assert the set is a subset of the module's key constants and that no key is any of `user_id`, `email`, `client_id`, `account_id`, `order_id`, `intent_id`, `symbol`, `strategy_id`, `stream_key`, `slug`, `category`, a secret key name or `internal_caller` (trading's alert key is `alert_kind`, not `category`); assert the MIN instrument-name set for that service is present; assert `rpc.server.duration`, `mcp.tool.duration`, `http.server.duration` keep their names and attribute keys; assert the literal `live_loop: cycle complete` appears in `live_loop.py`.
- **AC-42**: with `OTEL_ENABLED` false every new call site executes without exception and no exporter is created; a failing OTel init still lets the service start (extend the existing `telemetry.test.ts` / `otel_test.go` cases rather than duplicating).
- **AC-7**: aggregate check that every `loop` value written by any service belongs to that service's closed set of at most 8 names.
- **AC-56**: each Go module's `serverMetricViews()` output equals the pre-feature four drop views and no `rpc.client.*` instrument is registered.
- **AC-43 (diff path check)**: from the repo root assert `git diff --name-only main-dev...HEAD` (or the branch's merge-base) lists nothing under `packages/otel/alerts/`, `packages/otel/dashboards/`, `packages/proto/`, any `*/migrations/*`, and that `packages/otel/produced-signals.tsv` is unchanged; then run the guard script.
- **AC-44**: assert `context.md` § "Deferred behavior follow-ups" has exactly one row for each of the 14 IDs.

**Verification**:
```
cd /home/user/xstockstrat && bash scripts/check-otel-produced-signals.sh
cd /home/user/xstockstrat && ! git diff --name-only origin/main-dev...HEAD | grep -qE '^(packages/otel/(alerts|dashboards)/|packages/otel/produced-signals.tsv|packages/proto/)|/migrations/'
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off go test ./... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod) || exit 1; done
(cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:")
for s in ingest analysis agent; do (cd services/xstockstrat-$s && pytest --cov=app --cov-fail-under=40 -q && ruff check . && ruff format --check .) || exit 1; done
(cd services/xstockstrat-indicators && pytest --cov=app --cov-fail-under=50 -q && ruff check . && ruff format --check .)
for s in identity config ledger notify; do (cd services/xstockstrat-$s && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint) || exit 1; done
(cd services/xstockstrat-ui && pnpm run test:unit && pnpm run test:coverage && pnpm run lint) && bash scripts/check-duplication.sh services/xstockstrat-ui/src
```
(The second command negates the `grep`: it fails if any alert, dashboard, registry, proto or migration path changed, which is AC-43. The Playwright e2e suite is not run: no page, route or response shape changed.)

---

### Step 30 — docs: Service CLAUDE.md invariants and context teardown

**Status**: `pending`
**Service**: `docs/`, the 12 `services/xstockstrat-*/CLAUDE.md` files
**Files**:
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-identity/CLAUDE.md` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify
- `services/xstockstrat-ledger/CLAUDE.md` — modify
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `docs/roadmap/features/294-signal-map-instrumentation/context.md` — modify (session log; Deferred table already present)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-{trading,portfolio,marketdata,analysis,agent,identity,config,ledger,notify,ingest,indicators,ui}/CLAUDE.md` → all 12 exist.
- Confirmed via: root `CLAUDE.md` § Teardown: changing a context file or behavior those files describe requires `/context-forge:context-constitution refresh` scoped to what was touched as the last step before pushing; if the plugin is unavailable, the PR body must record BOTH that it was unavailable AND the manual reconciliation performed. Root `CLAUDE.md` § How to Act #5: comments state constraints in at most 2 lines.
- Confirmed via: design.md 1.13 fixed invariants to document: tick throttle 60 s; FR-14 N=10 (portfolio, ledger, indicators); portfolio quiet window 10 minutes; portfolio retry 2 s; 5 sample symbols per aggregate; 200-character item truncation; 64-character caller-id truncation; onboarding seen-set cap 10000; the loop cadences in design.md 1.3. Existing service CLAUDE.md literals that must stay accurate: trading `CLAUDE.md` § Position & Balance Sync Observability (`position sync cycle complete`, `position sync stalled`).

**TDD**: N/A (docs only)

**Covers**: —

**Instructions**:
1. In each affected service's `CLAUDE.md`, add or extend its observability section with only the facts an agent cannot read from the code: the new instrument names and bounded label vocabulary for that service (from design.md 1.4), the `loop tick ok` record shape and loop names where the service writes it, the log literals that are load-bearing (design.md 1.12), and that the fixed invariants above are code constants, not config keys. Keep each addition short; do not restate code.
2. Append a `## Session <ISO timestamp> — sdd-execute` summary to `context.md`; confirm the Deferred behavior follow-ups table still has the 14 rows.
3. **Teardown (root CLAUDE.md)**: because 12 context files changed, run `/context-forge:context-constitution refresh` scoped to those files and fix the grounded drift it reports. If the plugin is unavailable, re-read each touched CLAUDE.md against the current code, reconcile the drift, and record in the PR body that the plugin was unavailable AND the manual reconciliation performed (a bare "plugin unavailable" does not pass). Rewrite the PR #1427 description (it now carries the survey report, the SDD artifacts and the implementation).

**Verification**:
```
cd /home/user/xstockstrat && for s in trading portfolio marketdata analysis agent identity config ledger notify ingest indicators ui; do grep -c "loop tick ok\|signal-map\|294" services/xstockstrat-$s/CLAUDE.md; done; bash scripts/check-otel-produced-signals.sh
```
(Each service file mentions its new signals; the guard script still exits 0 because docs under `docs/`/`packages/otel` it checks are unchanged.)

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

Known deviation to log at the start of `/sdd-execute`: sequential execution on `ccr-b4aace27-zvuaby` instead of `feature/signal-map-instrumentation` (operator decision 4; `/sdd-execute sequential` assumes a `feature/<slug>` branch; F-02 is honored because nothing is pushed to `main-dev` directly and F-03 is vacuous because no step PRs exist).
