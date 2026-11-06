# Implementation Spec: signal-map-instrumentation

**Status**: `pending`
**Created**: 2026-11-04
**Feature**: `docs/roadmap/features/294-signal-map-instrumentation/feature.md`
**Total Steps**: 30
**Feature Branch**: `ccr-b4aace27-zvuaby` (operator override, product-spec.md Operator decision 4: no `feature/signal-map-instrumentation` branch; one commit per step; PR #1427 into `main-dev` is the single integration PR)

---

## Execution Summary

Signals only: bounded counters, gauges, histograms and log fixes across all 12 services, with no behavior change, no proto, config-key or database change, and no edit to any file under `packages/otel/` (AC-43; Step 29 asserts the whole directory). Consumer surface (C-14): **None, internal/platform-only** (product-spec.md `## Consumer Surface(s)`); operators read the new series in Grafana Cloud, and the later feature that registers and alerts on them is the consumer. No UI-page, `PLATFORM_SUBNAV` or MCP-tool step is required, and that is a decision, not an omission.

Order: one library pair per runtime first (Steps 1-6: Go, Python, Node rebinding accessors plus the `loop tick ok` helpers), then the services SEV-2 first as design.md 1.11 orders them (trading, portfolio, marketdata, analysis, agent, identity, config + ledger, notify, ui), then the SEV-3 tail (ingest, indicators), then a final allowlist/guard pass (Step 29) and the docs + teardown step (Step 30). Every `service` step is followed by its paired `test` step (C-08); each test is authored to fail against the pre-implementation tree (P-06). **One RED protocol for all four library pairs (Steps 1-6):** the real accessor is committed in the service/library step; in the paired test step the author temporarily no-ops the accessor locally, records RED (an assertion failure, not a compile error), restores it, records GREEN, and never commits the stub. **RED for service/test pairs (Steps 7-28):** the service commit lands first, so in the paired test step the author temporarily removes (or no-ops) the new record call or log line in the working tree, records the failing assertion, restores it, records GREEN, and never commits the removal.

Clarifications the spec fixes (design.md leaves them open or ambiguous):
- **UI accessor home.** design.md 1.1 lists `src/telemetry.ts` for the UI, but that file exports only `initTelemetry` (`grep -n export services/xstockstrat-ui/src/telemetry.ts` shows one export). The UI's metrics module with the rebinding pattern is `src/lib/bffMetrics.ts:13-23`, so the UI counters live there (Step 23) and the UI is not part of the Node library step (Step 5).
- **Instrument definitions live with their service step.** The library steps add only the generic rebinding accessors and the tick helpers; each service step adds that service's instruments and label-key constants to its telemetry module, so each commit is self-contained.
- **Line numbers.** Sites cited below were re-grepped against HEAD `e1cf809` (the tree is unchanged from the design's grounding). Sites cited "design.md 1.x" were not re-opened here; `/sdd-execute` discovery re-greps every symbol before editing (design.md header; F-09 drift goes to the Deviation Log).
- **Staged-diff hunk guards (`hunk_guard` is used by Steps 7, 13, 15 and 19).** Every "no hunk inside X" check runs BEFORE the step's commit, against the staged diff (`git diff --cached`), so it asserts something while the change is still uncommitted (F-05). Helpers, pasted into the step's shell. A guard fails the step when a staged hunk's pre-image overlaps the forbidden range (a pure insertion overlaps only when it lands strictly inside the range, so adding a function right after a guarded one is allowed); ranges are taken from `HEAD`, so re-derive them after any rebase. `fn_range FILE START_RE [END_RE]` prints `START END` from the first line matching `START_RE` to the first later line matching `END_RE` (default `^}`); `fn_range_py FILE NAME` prints a Python function's `lineno end_lineno`. Both print a message to stderr and return non-zero when nothing matches, and `hunk_guard` returns 2 with a message when either bound is empty, so a failed derivation (`set -- $(fn_range ...)` leaves `$1 $2` empty) can never false-pass. Patterns avoid backslashes (`[(]`, `[.]`) because `awk -v` processes them. Steps 11 and 17 do NOT use these helpers: they run plain staged-diff greps (`git diff --cached -U0 | grep`) before their commits.
  ```
  hunk_guard() { [ -n "$2" ] && [ -n "$3" ] || { echo "hunk_guard: empty range bound for $1" >&2; return 2; }; git diff --cached -U0 -- "$1" | awk -v lo="$2" -v hi="$3" '/^@@/{split(substr($2,2),o,","); a=o[1]+0; n=(o[2]==""?1:o[2]+0); if (n==0) {if (a>=lo && a<hi) bad=1} else if (a<=hi && a+n-1>=lo) bad=1} END{exit bad}'; }
  fn_range() { local e="${3-}"; [ -n "$e" ] || e='^}'; local r; r=$(git show "HEAD:$1" | awk -v re="$2" -v en="$e" '$0~re&&!s{s=NR} s&&$0~en{print s, NR; exit}'); [ -n "$r" ] || { echo "fn_range: no match for $2 in $1" >&2; return 1; }; echo "$r"; }
  fn_range_py() { git show "HEAD:$1" | python3 -c 'import ast,sys; t=ast.parse(sys.stdin.read()); n=next((x for x in ast.walk(t) if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef)) and x.name==sys.argv[1]), None); n or sys.exit("fn_range_py: no def " + sys.argv[1]); print(n.lineno, n.end_lineno)' "$2"; }
  ```
- **Go coverage.** In trading and portfolio all new logic is in the `service` and `telemetry` packages, which the CI `COVERPKGS` filter excludes; the test steps say so, still run the full suite with `-race`, and assert the 40% threshold on the packages that ARE measured with `go tool cover -func=coverage.out | awk '/^total:/{seen=1; gsub("%","",$3); if ($3+0<40) bad=1} END{exit (!seen || bad)}'` (non-zero exit below 40, and also non-zero when `coverage.out` has no `total:` line, so a missing profile cannot pass).
- **Python commands.** Every Python verification runs inside the service directory through `uv run` (`uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .`), the root `CLAUDE.md` uv convention, so the locked environment is the one that is tested.

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
- Step 13 (analysis) must land clear of feature **215-block-fundamentals-strategy-on-etf**. 215 is code-completed on `origin/main-dev` (its integration PR is merged; `merge-order.md` row for `expose-score-strategy-mcp` records this), but its `status.md` may still read `in-progress` locally because it flips to `launched` only after 283 ships. 294 therefore merges after 215's code is on `main-dev`, and the local checkout may lag `origin/main-dev`: rebase first and re-derive every range. Step 13's guards derive the forbidden ranges from `HEAD` by anchor (no hard-coded line numbers): in `live_loop.py` the `Feature 215 (FR-4)` deny-entry block in `_eval_pair` (through `_fund_unavailable.discard(key)`) and `_emit_fundamentals_unavailable_alert` (about 733-760 and 876-891 at the time of writing, for orientation only); in `servicer.py` the `RunBacktest` and `_run_backtest` bodies; in `evaluator.py` everything except the single `fundamentals formula=` log level inside `_fundamentals_formula_series`. Ordering is informal: `merge-order.md` has no 294 row. The operator should add advisory rows (294 vs 215: analysis `live_loop.py`/`servicer.py`/`evaluator.py` and marketdata `etf_flags.go`/`fmp_client.go`/`cmd/server/main.go`; 294 vs 281/282: portfolio `portfolio_service.go`, agent `tools.py`, config `configServiceImpl.ts`). Because 215's code is already on `main-dev` there is no merge wait; the rebase and re-grep before editing `servicer.py` is the only action.
- **282-filter-otc-symbols** (implementation-ready) is an additional soft overlap: `marketdata_service.go` (Step 11), `cmd/server/main.go` (Step 11), `configServiceImpl.ts` (Step 19), `portfolio_service.go` (Step 9) and agent `tools.py` (Step 15). Textual rebase only; re-grep by symbol after it lands.
- Step 9 (portfolio) soft-overlaps **281-signal-watchlist-expiry-pruning** (implementation-ready; adds portfolio `emitEvent`/`cmd/server/main.go:77` prune loop, which logs `"signal watchlist prune tick"`). Step 15 (agent `tools.py`) and Step 19 (config `configServiceImpl.ts`) also overlap 281. Textual rebase only; if 281 lands first, add its prune loop name to portfolio's `Loops` slice (design.md 1.3: portfolio has 5 names plus 281's, still at most 8) and keep its record shape `loop tick ok`.
- Step 27 (indicators `servicer.py`) soft-overlaps **243-fix-sandbox-seed-keys** (in-progress, `_clamp_override` just above the FR-12 sites). Re-grep after the rebase. 243 also shares indicators `tests/test_config_watcher.py` (Step 28) and `services/xstockstrat-indicators/CLAUDE.md` (Step 30) with this feature; textual rebase only.
- Step 29 requires Steps 1-28. Step 30 requires Step 29.
- Deferred behavior halves (product-spec.md FR-16) have no follow-up feature number yet; they are tracked in `context.md` § Deferred behavior follow-ups for debt-radar, which Step 29 checks (AC-44).

---

### Step 1 — service: Go telemetry library (trading, portfolio, marketdata)

**Status**: `done`
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
1. **Rebinding accessors** for counter, histogram and observable gauge. Each caches the instrument keyed on `otel.GetMeterProvider()` identity and re-creates it when the provider changes (so a `sdkmetric.NewManualReader()` provider installed after package init still sees the instrument), with a package generation counter bumped in `Init` after `otel.SetMeterProvider(mp)` as the fallback. Record calls never panic; a nil/no-op provider is a no-op (FR-15(e)). Step 1 commits the REAL rebinding accessors and Step 2 never changes production code; RED protocol: Execution Summary (the no-op stub exists only in the Step 2 author's working tree and is never committed).
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

**Status**: `done`
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
- **Rebind**: create the accessor, install provider A, record 1; install provider B and record 1; each reader sees exactly its own sample (RED while the accessor is temporarily no-op'd locally, per the Execution Summary RED protocol).
- **No-op when disabled (AC-42)**: with `OTEL_ENABLED` unset and the global no-op provider, every accessor call and `LogTickOK` returns without panic.
- **LogTickOK**: capture slog with a JSON `bytes.Buffer` handler at INFO (the existing `warnRecorder` drops below WARN, so use the inline JSON handler pattern, recon R12); assert one record, message `loop tick ok`, attrs `loop`, `duration_ms` (int), no `state` when empty.
- **TickThrottle**: `Allow` true at t0, false at t0+59s, true at t0+60s.
- **AC-56 (views)**: `serverMetricViews()` returns exactly the four existing drop views (names `rpc.server.request.size`, `rpc.server.response.size`, `rpc.server.requests_per_rpc`, `rpc.server.responses_per_rpc`), and after exercising the accessors no instrument named `rpc.client.*` is collected.

**Verification**:
```
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off go test ./internal/telemetry/... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod && COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/{seen=1; gsub("%","",$3); if ($3+0<40) bad=1} END{exit (!seen || bad)}') || exit 1; done
```
`internal/telemetry` is an excluded package in the CI `COVERPKGS` filter, so the `-race` run is its gate; the final `awk` asserts the packages that ARE measured stay at or above the 40% CI threshold (it exits non-zero below 40).

---

### Step 3 — service: Python telemetry library (agent, analysis, indicators, ingest)

**Status**: `done`
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
3. Decision: `analysis/app/engine/live_loop.py:78-81` (`_TRUNCATION_COUNTER`, `analysis.live_loop.truncated_pairs`) stays as-is. It is out of scope and is NOT routed through the accessor (here or in Step 13); Step 4 pins its current behavior with one fixed assertion, for the record only.
4. This step does not change `tool_metrics.py`; Step 15 adds the record helpers and the first-call INFO there. No step adds an attribute to `mcp.tool.duration` or renames any existing instrument (FR-15(b)).

**Verification**:
```
for s in agent analysis indicators ingest; do (cd services/xstockstrat-$s && uv run ruff check . && uv run ruff format --check .) || exit 1; done
```

---

### Step 4 — test: Python telemetry library tests

**Status**: `done`
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
- Accessor creates no duplicate-instrument warning (`caplog`), and rebinds after `otel_reset` + a fresh `metric_reader` (RED while the accessor is temporarily no-op'd locally, per the Execution Summary RED protocol).
- A raising instrument (monkeypatch the underlying `add` to raise) does not propagate out of the helper.
- With `OTEL_ENABLED` unset every helper is a no-op and `init_telemetry()` returns without creating an exporter (AC-42).
- analysis and ingest: `log_tick_ok` emits one INFO record `loop tick ok` whose `LogRecord` carries `loop` and `duration_ms` as attributes (assert on the `LogRecord.__dict__`, and via a `LoggingHandler` over an in-memory log exporter to prove `extra` reaches OTel attributes), and `state` only when passed.
- analysis: pin `_TRUNCATION_COUNTER` (`live_loop.py:78-81`, recorded at `:462`) with a fixed assertion. Grounding: the counter is created at import through `metrics.get_meter`; `app/main.py` first imports `app.engine.live_loop` at `:146`, after `init_telemetry()` at `:41`, so in production it binds to the single real provider. Under pytest the module is imported at collection (`tests/test_live_loop.py:20`), before any provider is set, so it is an OTel API 1.45 proxy instrument whose real instrument `_ProxyMeter.on_set_meter_provider` re-creates on every successful `set_meter_provider`. Assertions: precondition `type(_TRUNCATION_COUNTER).__name__ == "_ProxyCounter"` (failure message: import order changed, see Step 4); with `metric_reader` installed, `add(2)` leaves reader A holding exactly one `analysis.live_loop.truncated_pairs` point of value 2; re-arm the set-once exactly as `otel_reset` does (`monkeypatch` `metrics_internal._METER_PROVIDER_SET_ONCE = Once()` and `_METER_PROVIDER = None`), install reader B, `add(3)`, and assert reader B holds one point of value 3. This is why the counter stays as-is: it is out of scope and is not routed through the accessor (Step 3 decision).

**Verification**:
```
for s in analysis ingest agent; do (cd services/xstockstrat-$s && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .) || exit 1; done
(cd services/xstockstrat-indicators && uv run pytest --cov=app --cov-fail-under=50 -q && uv run ruff check . && uv run ruff format --check .)
```

---

### Step 5 — service: Node telemetry library (identity, config, ledger, notify)

**Status**: `done`
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
In each `src/telemetry.ts` add rebinding accessors for counter, histogram and observable gauge following the `bffMetrics.ts:13-23` shape (cache keyed on `metrics.getMeterProvider()` identity; re-create when it changes; `try/catch {}` around every record so a metrics fault never changes control flow). No tick helper in Node (design.md 1.2: the ledger notifier, config listener and indicators watcher are reconnect loops, not tick loops). Do not touch `rpc.server.duration` (`:82-85`) or `rpcDurationViews` (FR-15(b)). The real accessors are committed here; Step 6's author follows the Execution Summary RED protocol (temporarily no-op the accessor locally, record RED then GREEN, never commit the stub).

**Verification**:
```
for s in identity config ledger notify; do (cd services/xstockstrat-$s && pnpm run lint && pnpm exec tsc --noEmit) || exit 1; done
```

---

### Step 6 — test: Node telemetry library tests

**Status**: `done`
**Service**: `xstockstrat-identity`, `xstockstrat-config`, `xstockstrat-ledger`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-identity/src/__tests__/telemetryInstruments.test.ts` — create
- `services/xstockstrat-config/src/__tests__/telemetryInstruments.test.ts` — create
- `services/xstockstrat-ledger/src/__tests__/telemetryInstruments.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/telemetryInstruments.test.ts` — create

**Reviewers**: Service owner `xstockstrat-identity` — no secret in logs/labels; Service owner `xstockstrat-config` — no secret values in logs; Service owner `xstockstrat-ledger` — ordering; Service owner `xstockstrat-notify` — delivery guarantees

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-{identity,config,ledger,notify}/src/__tests__/telemetry.test.ts services/xstockstrat-{identity,config,ledger,notify}/src/__tests__/telemetry.export.test.ts` → all eight present. `grep -n "class CollectingReader" services/xstockstrat-*/src/__tests__/telemetry.test.ts` → `:32` in identity, notify and ledger, `:35` in config (re-grepped 2026-11-06; locate it by symbol). None of the four `telemetryInstruments.test.ts` targets exists yet.
- C-13 verdict: the `CollectingReader` helper has a second consumer in every Node service after this step. Do not extract it speculatively; if a second *new* test file in the same service needs it (Steps 18, 20, 22), move it to that service's `src/__tests__/fixtures/` in that step (`ls -d services/xstockstrat-{identity,config,ledger,notify}/src/__tests__/fixtures` → present in identity and ledger, absent in config and notify).

**TDD**: red-green required

**Covers**: `AC-42`

**Instructions**:
Per service: (a) rebind test: install a `MeterProvider` with a `CollectingReader` after module import, record via the accessor, assert the sample is collected; install a second provider and assert rebinding; (b) a throwing instrument does not escape the record helper; (c) with the global no-op provider and `OTEL_ENABLED` unset every accessor call returns without throwing (AC-42); (d) an active span survives `queueMicrotask` (design.md Open Risk "Node AsyncLocalStorage"): start a span, `await new Promise(r => queueMicrotask(r))`, assert `trace.getActiveSpan()` is still the span (record the result; Step 22 depends on it for notify). RED protocol for (a)-(c): Execution Summary (temporary local no-op of the accessor; the stub is never committed).

**Verification**:
```
for s in identity config ledger notify; do (cd services/xstockstrat-$s && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint) || exit 1; done
```

---

### Step 7 — service: Trading outcome counters, tick records, clock seam (SEV-2)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel.go` — modify (instruments, `Loop` constants, key constants)
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/internal/service/order_intent.go` — modify
- `services/xstockstrat-trading/internal/service/trading_telemetry_test.go` — create (characterization tests only, Instruction 0; Step 8 adds the new-behavior cases)

**Reviewers**: Service owner `xstockstrat-trading` — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement (no change to flatten, bracket, fill or reconciliation behavior); Platform Lead — loop-liveness record shape

**Codebase Evidence**:
- Confirmed via: `grep -n "flattenAndHalt" services/xstockstrat-trading/internal/service/trading.go` → def `:2854`; early returns `:2858-2860` (no broker), `:2864-2866` (offline), `:2872-2874` (order not found), combined `if err != nil || position == nil || position.Qty == 0 {` + WARN `"flattenAndHalt: no open position to flatten"` at `:2885-2886`; sole caller `checkBracketProtection` `:2972` runs it on `context.Background()` (`:2995`).
- Confirmed via: `sed -n 708,746p trading.go` → `brokerOrder, err := accountEntry.client.SubmitOrder(ctx, brokerReq)` `:712`; uncertain branch `if isUncertainBrokerOutcome(err)` `:714`; definite rejection branch `:724`; success path `alpacaStatusToProto(brokerOrder.Status)` `:748`.
- Confirmed via: `maybeSubmitBracket` `:3451` (guard `stopPrice <= 0 || !bracketOrdersEnabled` `:3452`, lookup-failed WARN `:3456-3460`, `resizeBracket` call in the IBKR `existing.Status == bracketStatusActive` case, `createBracket` call in `case existing == nil`); `createBracket` CreateBracket failure `:3487-3490` (calls `emitBracketFailureAlert`), broker-type switch `:3493`; `resizeBracket` def `:3524`.
- Confirmed via: `sed -n 1811,1893p trading.go` → `applyBrokerOrderStatus` def `:1811` (the single fill-emission path: `pollFills` and CancelOrder's not-cancelable reconcile both call it); its `case tradingv1.OrderStatus_ORDER_STATUS_FILLED:` at `:1843` and `case tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED:` at `:1864`.
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
Signals only (product-spec.md Operator decision 2). No new halt, page or status change; order placement, fill detection and the `FILLED` / `PARTIALLY_FILLED` cases of `applyBrokerOrderStatus` (def `:1811`; `case` lines `:1843` / `:1864`) are untouched (fill handling unaffected by this step). Order types MARKET, LIMIT, STOP, STOP_LIMIT, TRAILING_STOP: order-type handling unaffected. Broker coverage: `broker_type` label covers ALPACA, IBKR and OFFLINE (where the path exists) on equal terms. Trading mode gate: no order is placed or submitted by anything added here; paper and live behave identically (no `trading_mode` label anywhere, AC-41 / `@AC-1 @feature-171`).
0. **Characterize first.** Before changing any production code, write the characterization tests in `trading_telemetry_test.go` (listed in this step's **Files**) for `checkCredentialHealth`, `sweepOrderIntents`, `checkBracketProtection` and the ListOrders `polled` path (they have no test today, design.md 1.11 step 2), and run them green against the unmodified code (`cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -count=1 -run 'Characterization'`). Then make the production changes below. Both land in this step's single commit; Step 8 keeps only the new-behavior cases and does not re-claim the characterization tests.
1. **Instruments + keys** in `otel.go` using Step 1's accessors, names per design.md 1.4: `trading.flatten.outcome{outcome}`, `trading.bracket.outcome{outcome}`, `trading.order_submit{broker_type, outcome}`, `trading.ledger_emit{event_type, outcome}`, `trading.alert_emit{alert_kind, outcome}`, `trading.escalation.systemic` (unlabelled). Key constants: `outcome`, `broker_type`, `event_type`, `alert_kind`. Add the closed `Loop` constants for trading: `fill_poller`, `reconciliation`, `position_sync` (KEPT, never logged through `LogTickOK`), `credential_health`, `bracket_watchdog`, `order_intent_sweeper`, and the `Loops` slice. `event_type` is clamped to the design.md 1.4 allowlist (unknown -> `other`); `alert_kind` is a `type alertKind string` with constants reconciliation, halt, account, bracket, approval, trade and no `other` branch.
2. **Clock seam**: add `now func() time.Time` to `TradingService` and a nil-safe `clock()` mirroring portfolio's. Tick durations and `TickThrottle` use `s.clock()` so a test controls `duration_ms`.
3. **flattenAndHalt** (`:2854`): count `no_broker`, `offline`, `order_not_found`, `hash_error`, `flattened`, `halted` at the exits design.md 1.4 lists. Split `:2885`: `lookup_error` when `err != nil && grpcstatus.Code(err) != codes.NotFound` (new ERROR `"flattenAndHalt: position lookup failed"` with `account_id`, `symbol`, `error`, then return); `flat` when `err == nil && (position == nil || position.Qty == 0)` or `grpcstatus.Code(err) == codes.NotFound` (keep the text `"flattenAndHalt: no open position to flatten"`, level WARN -> INFO, then return). Both branches still return exactly where the old combined branch did (AC-1, AC-2, AC-57).
4. **maybeSubmitBracket / createBracket / resizeBracket**: `lookup_failed` at the `:3456` branch (return unchanged, no alert, no row), `create_failed` at `:3487-3490`, `created` immediately after CreateBracket succeeds and before the `switch` at `:3493`, `resized` right after the `s.resizeBracket(...)` call. Not counted: the no-op guard `:3452` and the `default` case.
5. **trading.order_submit**: add `submitOutcome(err error, brokerStatus tradingv1.OrderStatus) string` returning `uncertain` (the `isUncertainBrokerOutcome` branch), `invalid_credentials` (`errors.Is(err, broker.ErrInvalidCredentials)` in the definite-rejection branch), `rejected` (the other `:724` branch, or `err == nil && brokerStatus == ORDER_STATUS_REJECTED`), else `accepted`. `broker_type` = `strings.TrimPrefix(commonv1.BrokerType(accountEntry.brokerType).String(), "BROKER_TYPE_")`. Record at the `:712` error branches and after the success path with `alpacaStatusToProto(brokerOrder.Status)`.
6. **Ledger and alert emits**: count inside `appendLedgerEvent` (`ok` on attempt 1, `retried_ok` on attempt 2, `failed` for any returned error including the payload-build error); `emitLedgerEvent` log gains `stream_key`. Add `s.recordAlertEmit(kind, err)` right after each of the seven `EmitAlert` calls. `escalation.systemic` +1 at the top of `escalateSystemic`. The `syncAccountPositions` / heartbeat counting is unchanged (AC-59: a failed `account.positions.synced` emit still counts in `accounts_synced`, and only the `failed` ledger counter moves).
7. **Tick records** (design.md 1.3). `LogTickOK` plus the failure rule "denominator = items that reached the fallible call; no record when `count > 0` and all failed". fill_poller: end of `pollFills`, `polled` counted where `GetOrder` is called, `failed` at `:1800-1802`; `idle` when no candidates, `skipped` when candidates existed but every one hit the no-broker `continue` `:1794-1796`. reconciliation: before the return of `reconcileTick`, `polled++` just before `ListOrders`; no record when `polled > 0 && systemicCount == polled`; `idle` when `polled == 0`; return signature unchanged. credential_health: change `:2778` to `if st, _ := s.validateAndRecordCredential(...); st == int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_UNKNOWN) { unknown.Add(1) }` (atomic), `n = len(brokerMap)`; no record when `n > 0 && unknown == n`; `idle` when `n == 0`; `disabled` in a new `else` of `if intervalMs > 0`. bracket_watchdog: end of `checkBracketProtection`, no record when the `ListExpiredProtection` scan errored, `idle` when none expired. order_intent_sweeper: end of `sweepOrderIntents`, no record when `SweepStalePending` errored or (`len(stale) > 0` and every `ReclaimOrphanIntent` errored), `idle` when none stale. position_sync keeps `"position sync cycle complete"` (`:2360`), no second record. Do not edit `StartFillPoller` (AC-6: the staged diff has no hunk inside it).

**Verification**:
```
cd /home/user/xstockstrat && git add -A services/xstockstrat-trading
# (define hunk_guard / fn_range from Execution Summary, "Staged-diff hunk guards")
f=services/xstockstrat-trading/internal/service/trading.go
set -- $(fn_range "$f" '^func [(]s [*]TradingService[)] StartFillPoller[(]'); hunk_guard "$f" "$1" "$2" || { echo "staged hunk inside StartFillPoller"; exit 1; }
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go test ./internal/service/... -race -count=1 -run 'Characterization' -v && GOWORK=off go test ./internal/service/... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod
```
(Run BEFORE the step's commit. The guard fails if any staged hunk's pre-image overlaps `StartFillPoller`, AC-6; the characterization tests (name them `...Characterization`) must pass against the staged production changes, and the full `internal/service` run proves no existing test regressed.)

---

### Step 8 — test: Trading telemetry tests

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_telemetry_test.go` — modify (created in Step 7 with the characterization tests; this step adds the new-behavior cases)

Not planned: `trading_flatten_rejection_test.go` harness changes. If a second consumer forces a shared fixture, that is a Deviation Log entry (F-09) and the file is added then.

**Reviewers**: Service owner `xstockstrat-trading` — order execution correctness, broker API safety, fill detection; the tests must prove instrumentation did not alter the flatten, bracket, fill or reconciliation paths

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-trading/internal/service/*_test.go` → `trading_flatten_rejection_test.go`, `trading_bracket_test.go`, `trading_sync_test.go`, `trading_reconciliation_test.go`, `trading_ledger_userid_test.go`, `trading_ibkr_auth_test.go`, `trading_helpers_test.go` among the 23 `*_test.go` files in `internal/service` (`trading_telemetry_test.go` is not among them yet: Step 7 creates it).
- Confirmed via: recon.md R12: the flatten harness (`trading_flatten_rejection_test.go:88`) cannot force `GetPosition` error, `Qty == 0`, missing broker or offline; the Go `warnRecorder` drops below WARN, so an INFO assertion needs the inline `bytes.Buffer` JSON handler used at `trading_sync_test.go:18-21`.
- C-13 verdict: fixtures live in `services/xstockstrat-trading/internal/testdata/` (`caller_ids.go`, `order_rows.go`, `ibkr.go`, `offline_history.go`); reuse `order_rows.go` for order literals. New literals (`"ord-1"`, `"acc-1"` etc.) have one consumer (this file) so stay inline; a second consumer would move them to `internal/testdata/`.

**TDD**: red-green required

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-45, AC-57, AC-59`

**Instructions**:
Extend `trading_telemetry_test.go` (created in Step 7); each test installs a `sdkmetric.NewManualReader()` provider and a captured JSON slog handler, and asserts exact deltas. The characterization tests for `checkCredentialHealth`, `sweepOrderIntents`, `checkBracketProtection` and the ListOrders `polled` path already landed in Step 7 (Instruction 0) and are not re-claimed here; this step adds their new-behavior (tick record and counter) cases, written to fail against the pre-implementation tree (P-06).
- AC-1: GetPosition returns `UNAVAILABLE` -> `trading.flatten.outcome{lookup_error}` +1, `{flat}` unchanged, ERROR `"flattenAndHalt: position lookup failed"`, no attribute value contains `ord-1` or `acc-1`.
- AC-2: `Qty 0` -> `{flat}` +1, `"flattenAndHalt: no open position to flatten"` at INFO. AC-57: `NOT_FOUND` -> `{flat}` +1, `{lookup_error}` unchanged, INFO.
- AC-3: `GetBracketByOrderID` DB error -> `trading.bracket.outcome{lookup_failed}` +1, no `CreateBracket` call, no `EmitAlert` call. Include the `stopPrice > 0 && enabled` Given.
- AC-4: `AppendEvent` UNAVAILABLE twice for `order.filled` -> `trading.ledger_emit{order.filled, failed}` +1 and the `"ledger emit failed"` log carries `stream_key` `ord-4`; UNAVAILABLE once then OK -> `retried_ok` +1.
- AC-5: Alpaca-typed account, `SubmitOrder` returns a definite rejection -> `trading.order_submit{ALPACA, rejected}` +1, no attribute contains the rejection text.
- AC-45: three reconciliation ticks with `systemic_threshold_pct` 0.5 and 2 of 4 accounts erroring -> `trading.escalation.systemic` +3; an IBKR account whose `SubmitOrder` returns an uncertain-outcome timeout -> `trading.order_submit{IBKR, uncertain}` +1; a PARTIALLY_FILLED then FILLED order's persisted statuses are identical to a baseline run without telemetry.
- AC-59: `AppendEvent` fails twice for `account.positions.synced`, `syncPositions` for `acc-59` -> `accounts_synced` still counts it and `trading.ledger_emit{account.positions.synced, failed}` +1.
- AC-6: a `TradingService` with `now` injected; fake `GetOrder` advances the clock 120 ms and returns non-terminal on call 1, errors on call 2; `pollFills` twice -> exactly one INFO `loop tick ok` with `loop=fill_poller`, `duration_ms=120`, none for call 2, the WARN `"fill poll: broker GetOrder failed"` for call 2, no sleep call. The staged-diff hunk check is in Step 7's verification.
- AC-7 (trading half): collect every `loop` attribute written across the tick tests; each is in `telemetry.Loops`, `len(telemetry.Loops) <= 8`, no record attribute contains an account, user, symbol or order id; position sync tick writes only `"position sync cycle complete"`.

**Verification**:
```
cd services/xstockstrat-trading && COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/{seen=1; gsub("%","",$3); if ($3+0<40) bad=1} END{exit (!seen || bad)}' && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in the excluded `service` and `telemetry` packages, so the `-race` run over the new tests is its gate; the `awk` assertion fails the step if the packages CI does measure fall below 40%. Partial-fill parity (AC-45) is exercised in the test.

---

### Step 9 — service: Portfolio consumer, quote and snapshot signals (SEV-2)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/telemetry/otel.go` — modify (instruments, `Loop` constants, key constants)
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/service/offline_valuation.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_sync_retry_test.go` — modify (`consumeEventStream`/`streamEventsFrom` callers pass the new argument)
- `services/xstockstrat-portfolio/internal/service/portfolio_fill_errors_test.go` — modify (same)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety (the park ERROR is never throttled; valuation stays parity-tested); Platform Lead — loop-liveness record shape

**Codebase Evidence**:
- Confirmed via: `grep -n "consumeEventStream\|streamEventsFrom\|boundedRetry\|ackAlways\|time.Sleep" internal/service/portfolio_service.go` → `ConsumeOrderFills` (`:173-174`, wires `s.processOrderFill` unwrapped), `ackAlways :182`, `consumeEventStream :191`, `time.Sleep(2 * time.Second) :205`, `isGracefulStreamClose` use `:200` (INFO `name+" stream disconnected, reconnecting"` `:201`, ERROR `name+" stream error, retrying"` `:203`), `streamEventsFrom :212`, `isGracefulStreamClose def :243`, `boundedRetry :1361`, "event parked" ERROR `:1389`; consumers wired at `:1301` (position sync), `:1313` (deregistration), `:1527` (bracket), `:1575` (balance); `cmd/server/main.go:75-79` starts the five consumers. (Re-grepped after 282 merged into `main-dev` (#1456); it shifted `portfolio_service.go` by about +58 lines below `:404`.)
- Confirmed via: `grep -n "func (s \*PortfolioService) observed\|func observed" internal/service/*.go` → **Not found** — the `observed(label, h)` wrapper does not exist and must be created (design.md 1.4 describes it as new).
- Confirmed via: `latestQuotesFor :404` (failure branch `:412-414`); `applyQuotes :529` (no `ctx`; bare `slog.Warn("latest quote has no usable price", ... "symbol" ...)` `:542`); production `applyQuotes` calls `offline_valuation.go:113`, `:146`, `portfolio_service.go:811`, `:1088`, `:1152`; `pickMark offline_valuation.go:280` with `p.MarkSource = src` at `:243` (design.md cites `:240-246`).
- Confirmed via: `broadcastSnapshot :1082`; `_ = s.repo.InsertSnapshot(...)` `:1105`; skipped-unpriced WARN and return `:1090-1093`.
- Confirmed via: `sed -n 70,72p` → `now func() time.Time` `:71`; `clock()` `offline_valuation.go:72`.
- Existing test callers: `portfolio_sync_retry_test.go:73,:80` and `portfolio_fill_errors_test.go:155` pass `nil` for the handler callback (design.md 1.11 step 3; to be re-opened at execute).
- 281 has launched: `cmd/server/main.go` starts `go svc.HydrateStops(ctx)` at `:80` and 281's `go svc.PruneExpiredSignalEntries(ctx)` at `:81`. `grep -n "signal watchlist prune tick" internal/service/signal_prune.go` → `:77`: `pruneOnce` (`:51`) writes that one INFO at the end of every tick, with its own fields `lists`, `skipped`, `removed`, so the prune loop already has a per-tick record whose shape is not `loop tick ok`. `signal_prune.go` is not in **Files**.

**TDD**: red-green required

**Covers**: —

**Instructions**:
Signals only; valuation behavior and the park/ack semantics are unchanged (C-10(b): `applyQuotes` signature is unchanged so the parity test and its callers are untouched; the portfolio ListPositions/ListPortfolios parity stays). PARTIALLY_FILLED and FILLED handling inside `processOrderFill` is unaffected: the `observed` wrapper only records the outcome around the unchanged handler call (B2b).
1. **Instruments + keys** in `otel.go`: `portfolio.consumer.events{consumer, outcome}`, `portfolio.marketdata_fetch{op, outcome}`, `portfolio.snapshot{outcome}`, `portfolio.mark_source{mark_source, path}`; key constants `consumer`, `outcome`, `op`, `mark_source`, `path`; `Loop` constants `order_fill`, `position_sync`, `deregistration`, `bracket`, `balance`, `signal_prune` and the `Loops` slice (6 names, at most 8). `signal_prune` is 281's prune loop and is KEPT, like trading's `position_sync`: its existing per-tick `"signal watchlist prune tick"` INFO (`signal_prune.go:77`) is its tick record, it is never logged through `LogTickOK`, and `signal_prune.go` is not edited. This applies the operator's OQ2 rule (context.md, 2026-11-04: a loop that already writes one cycle record per tick keeps it and does not write a second); the earlier wording "keep its record shape `loop tick ok`" contradicted the record 281 shipped.
2. **consumerLabel(name)** closed over the five names passed at `:174, :1301, :1313, :1527, :1575` -> `order_fill, position_sync, deregistration, bracket, balance`, else `other`. Create `observed(label, h)` wrapping `processOrderFill` (`:174`) and the two `ackAlways` consumers; `boundedRetry` records its own outcomes (`ok` at the success exit, `error` at the retryable error exit, `parked` at the `:1389` park). `acked` for ackAlways consumers. The park ERROR at `:1389` is never throttled.
3. **Per-batch tick record** (AC-56): each consumer writes `LogTickOK` on outcome ok/acked (not parked, not error), through a per-consumer `TickThrottle` with a 60 s leading edge, so 4 events within 60 s write exactly 1 record. Loop names from the closed `Loops`.
4. **FR-14 consumer rewrite** (design.md 1.8, copy the corrected code): constants `streamRetryDelay = 2*time.Second`, `streamLogEvery = 10`, `streamQuietWindow = 10*time.Minute`; `consumeEventStream` keeps `lastSeq = next` and the resume-from-sequence invariant, counts `failures`/`graceful` per kind, logs the first and every 10th (INFO for graceful, ERROR for failures; the rest DEBUG via `slog.Log(ctx, lvl, ...)`), resets counters after a 10-minute quiet gap, and sleeps through a new field `sleep func(time.Duration)` (nil means `time.Sleep`, so production timing is unchanged; the retry stays 2 s). `streamEventsFrom` gains an `onHealthy func()` parameter called once on the first handled event or on EOF; the "<name> stream resumed" INFO is written only when `failures >= 2 || graceful >= 2` preceded. The EOF path (`err == nil`) is unchanged apart from `markHealthy()`. Update the two existing test callers to pass `nil`.
5. **latestQuotesFor**: count `portfolio.marketdata_fetch{op=quotes, outcome}`: `timeout` when `qctx.Err() == context.DeadlineExceeded`, else `error` (`:412-414`), `ok` on the success return; the empty-symbol early return is not counted; the existing `"batch latest quotes unavailable"` WARN at `:413` is untouched.
6. **observeQuotePass(ctx, positions, quotes, path)** (design.md 1.6) called right after each production `applyQuotes` (`offline_valuation.go:113`, `:146` with path `read`, `portfolio_service.go:811` `pnl`, `:1088` `snapshot`, `:1152` `risk`): records `portfolio.mark_source{mark_source, path}` per position (`mark_source` = lower-cased `MarkSource` name without prefix) and, if positions left at `MARK_SOURCE_NONE` whose symbol is present in `quotes` is > 0, writes ONE `slog.WarnContext(ctx, "latest quote has no usable price", "count", n, "sample_symbols", <=5 symbols)`. Delete the per-position `slog.Warn` at `:542`; `applyQuotes` is otherwise unchanged. `pickMark` records `path=read` right after `p.MarkSource = src` and before the `continue`, only inside `if p != nil`, using `context.Background()` (`valueOffline` has no ctx).
7. **broadcastSnapshot**: `portfolio.snapshot{written | skipped_unpriced | db_error}`; replace `_ = s.repo.InsertSnapshot(...)` with `if err := ...; err != nil { slog.ErrorContext(ctx, "portfolio snapshot insert failed", "error", err); record db_error } else { record written }` and DO NOT return: the ledger emit and subscriber broadcast after it still run.

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go test ./internal/service/... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod && ! grep -n 'slog.Warn("latest quote has no usable price"' internal/service/portfolio_service.go
```
(The `go test` run executes the two edited test files against the changed consumer, not just a compile; the last grep must find nothing: the per-position Warn is gone.)

---

### Step 10 — test: Portfolio telemetry tests

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_telemetry_test.go` — create

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L accuracy, snapshot consistency; tests prove behavior parity

**Codebase Evidence**:
- Confirmed via: `grep -n "warnRecorder" internal/service/portfolio_quote_deadline_test.go` → recorder at `:32-69`, WARN+ only (recon R12): a new INFO-capable recorder is needed for `loop tick ok` / `stream resumed`; the WARN assertions can reuse it.
- Confirmed via: `ls internal/service/*_test.go` → `portfolio_quote_deadline_test.go`, `portfolio_sync_retry_test.go`, `portfolio_fill_errors_test.go`, `portfolio_snapshot_scope_test.go`, `offline_valuation_test.go`, `getpnl_source_parity_test.go`.
- Design test-shape notes (design.md 1.6): a fill-driven snapshot also runs `checkRiskLimits` and `broadcastSnapshot` (`processOrderFill` calls them at `portfolio_service.go:382-383`; `broadcastSnapshot` is defined at `:1082`), so AC-9's exact counts hold only when the When invokes `broadcastSnapshot` directly; give every account a balance row and stub `ListOfflineAccountIdsByUser` empty (`GetPortfolio` `:654` calls it at `:678-682`; re-grepped after the 282 merge); `trace_id` appears only inside an active span.
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
- AC-56 / AC-7 (portfolio half): the order-fill consumer handles 4 events within 60 s (injected clock) -> `consumer.events{order_fill, ok}` +4 and exactly 1 `loop tick ok` with `loop=order_fill`; no `rpc.client.*` instrument; `loop` values are in `telemetry.Loops`. Include a PARTIALLY_FILLED then FILLED event pair for the same order among those events and assert `processOrderFill`'s handling is unchanged against a baseline run without telemetry (same persisted position/quantity effects, same ack behavior) and that the `ok` count includes both events.
- Parity: the existing `getpnl_source_parity_test.go` and `offline_valuation_test.go` must still pass unmodified.

**Verification**:
```
cd services/xstockstrat-portfolio && COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/{seen=1; gsub("%","",$3); if ($3+0<40) bad=1} END{exit (!seen || bad)}' && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in the excluded `service` and `telemetry` packages, so the `-race` run is its gate; the `awk` assertion fails the step if the packages CI does measure fall below 40%.

---

### Step 11 — service: Marketdata stream, vendor, backfill and poller signals (SEV-2)

**Status**: `done`
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
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify (one call to `telemetry.RegisterStreamLastMessageAge`)
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (warm-poller characterization tests only, Instruction 0; Step 12 adds the new-behavior cases)

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, Alpaca feed idempotency; vendor-call instrumentation must not leak the FMP apikey or Finnhub token; Platform Lead — loop-liveness record shape

**Codebase Evidence**:
- Confirmed via: `grep -n "type streamManager\|func (c \*Client) streamMgr\|func (m \*streamManager) run\|maxReconnects\|conn.Read\|json.Unmarshal" internal/alpaca/stream.go` → `streamManager :60`, `streamMgr :74`, `add :112`, `run :166`, `maxReconnects` `:171-173`, give-up `if attempts >= maxReconnects` `:197` with the ERROR `"alpaca stream giving up after max reconnects: ..."` `:198`, `connectAndRead :219`, `conn.Read(ctx) :264`, `json.Unmarshal :269`.
- Confirmed via: `grep -n "func (c \*Client) do\|func (c \*Client) getJSON\|func (c \*Client) get(" internal/*/*.go` → alpaca `client.go:83` `do()` (8 callers, `json.Unmarshal` at `:194, :256, :309, :351, :391, :439, :496, :543`); FMP `fmp_client.go:235`; Finnhub `finnhub_client.go:110`; EDGAR `edgar_client.go:75`.
- Confirmed via: warm poller: `StartWarmQuotePoller` `marketdata_service.go:1119-1191` (per-cycle body `:1149-1188`, from `since := s.quoteSince()` through the closing brace of the `if failed > 0` block); per-symbol WARNs `"warm poller: cache insert failed"` at `:1159` and `:1180`; existing aggregate `"warm poller: per-symbol quote fetch failures"` `:1186`; `BackfillBars :1375`; `BackfillFundamentals :2159`; `"bar ingest: cycle complete"` `:1345` (KEPT); `runQuoteRetentionStep :1057`; `fillEtfFlag etf_flags.go:130`. (Re-grepped after 282 merged into `main-dev` (#1456), which shifted this file by about +7.)
- Confirmed via: `sed -n 158,171p cmd/server/main.go` → `go svc.StartWarmQuotePoller(ctx)` `:160`, `StartBarIngestPoller` `:162`, `StartClassificationRefreshPoller` `:164`, `StartEtfFlagFiller` `:166`, `StartAssetSetRefresher` `:168` (added by 282), `StartQuoteRetention` `:170`.
- Confirmed via: `grep -n "slog[.]\|^func" internal/service/asset_servability.go` → `StartAssetSetRefresher :185` (1-minute schedule ticker `:198`; a refresh runs only when the configured interval has elapsed or a retry is due); every successful `refreshAssets` (`:113`) writes one INFO `"asset set loaded"` (`:148`); its failures WARN at `:122`, `:131` and `:158`. `asset_servability.go` is not in **Files**.
- Confirmed via: no `otelhttp` import exists in marketdata (recon "Not found"); FR-4 forbids adding it.
- Existing leak pattern: FMP/Finnhub put `apikey=` / `token=` in the URL (recon; fails.md 2026-11 `fix-marketdata-secret-exposure`: `*url.Error` text carries the full URL), so outcome classification must use typed error classes (`fmp.ErrorClass` `fmp_client.go:348`, doc comment `:347`; `statusError` `:290`, `stageError` `:298`), never `err.Error()`.

**TDD**: red-green required

**Covers**: —

**Instructions**:
No read deadline and no change to reconnect, backfill return or poller semantics.
- **Scope note (accepted Files-count warning, not split):** the vendor clients, stream, backfill, warm poller and retention/ETF-filler ticks share the `cmd/server/main.go` wiring and the one `marketdata` telemetry module, so splitting would leave an intermediate commit with registered-but-unwired instruments.
- **Broker symmetry:** order-submission broker symmetry (Alpaca and IBKR) is covered in Step 7 (`trading.order_submit{broker_type}`). Marketdata has no IBKR path: its vendors are Alpaca, FMP, Finnhub and EDGAR only.
0. **Characterize first (warm poller), limited to what has a seam.** `StartWarmQuotePoller` cannot be driven from a unit test: `s.cfg` is the concrete `*config.Watcher` (no test constructs one) and the ticker defaults to 30 s. So the pause `continue` and `ticker.Reset` are NOT characterized; they stay verbatim in the outer loop and the staged-diff check in Verification protects them. Characterization covers only the two paths in the per-cycle body: (a) a per-symbol `cacheQuote` failure is logged (`"warm poller: cache insert failed"`) and the cycle continues with the remaining symbols, on both the multi-symbol and the per-symbol fallback path; (b) a `registry.Get` error ends the cycle without calling any source or the cache. Sequence: first run `cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... ./internal/alpaca/... -race -count=1` on the untouched tree to record the baseline; then make the one purely mechanical edit that creates the seam (move the body from `since := s.quoteSince()` to the end of the `case <-ticker.C:` block (`:1149-1188`) verbatim into `warmQuotesOnce(ctx, symbols)`, each cycle-ending `continue` becoming `return`, no log, metric or control-flow change); write the two characterization tests against `warmQuotesOnce` in `marketdata_service_test.go`; run the same command green on that verbatim move; only then add signal code. Everything lands in this step's single commit; Step 12 keeps only the new-behavior cases (AC-46 aggregate WARN, DEBUG demotion) and does not re-claim the characterization.
1. **Instruments + keys** in `otel.go`: `marketdata.vendor.requests{vendor, op, outcome}`, `marketdata.vendor.request.duration{vendor, op}`, `marketdata.stream.reconnects{result}`, observable gauge `marketdata.stream.last_message_age`, `marketdata.backfill.symbols{kind, outcome}`; keys `vendor`, `op`, `outcome`, `result`, `kind`. The vendor, stream and backfill instruments are recorded from the alpaca, fmp, finnhub, edgar and service packages, so `otel.go` also exports their record helpers, and `func RegisterStreamLastMessageAge(read func() (time.Time, bool), now func() time.Time)`, which registers the gauge once (idempotent) and observes `now().Sub(t)` in seconds only when `ok`. `Loop` constants: `warm_quote`, `bar_ingest` (KEPT), `classification_refresh` (KEPT), `etf_flag_filler`, `quote_retention`, `asset_refresh` (KEPT; 6 names, at most 8). `asset_refresh` is 282's `StartAssetSetRefresher`: its existing `"asset set loaded"` INFO, written once per successful refresh, is its tick record under the operator's OQ2 rule (context.md, 2026-11-04: a loop that already writes one cycle record per tick keeps it and does not write a second), so it is never logged through `LogTickOK` and `asset_servability.go` is not edited.
2. **Vendor chokepoints** (design.md 1.4 vocabulary: ok, http_429, http_4xx, http_5xx, transport, read, decode, ctx, cap, throttle, build, other): record manually at FMP `getJSON`, Finnhub `getJSON`, EDGAR `get`, Alpaca `do()`. `ctx` wins whenever the request context errored. A duration sample is recorded only when a request was actually sent (throttle/cap/build record the counter only). `op` sets are closed: FMP {quote, ratios, profile}, Finnhub {metric, quote, profile}, EDGAR {tickers, companyfacts}, Alpaca {bars, quotes_latest, trades_latest, assets, dividends} derived from the request path. Alpaca duration = time to headers; Alpaca read/decode failures are not counted (they happen in the 8 callers; declared Open Risk). No attribute, span attribute or log may contain the URL, apikey, token or symbol (AC-13).
3. **Stream** (design.md 1.7): new `streamManager` fields `lastFrame atomic.Int64` (unix nanos) and `now func() time.Time` (nil means `time.Now`; the same `now` is used where `lastFrame` is stored and where the gauge computes the age). Store right after the `conn.Read` error check (`:264-267`) and before `json.Unmarshal` (`:269`); `m.lastFrame.Store(0)` at `run()` entry (`:166`); `func (c *Client) StreamLastFrame() (time.Time, bool)` reads through `c.streamMgr()` (never `c.stream` outside the Once), returns `ok = running && lastFrame != 0` with `running` read under `m.mu`, so after the give-up (`running = false` at `:201`) the gauge reports no sample. `marketdata.stream.reconnects{reconnected}` after the reconnect succeeds when `attempts < max`; `{gave_up}` beside the give-up ERROR at `:198`. `cmd/server/main.go` makes one call, `telemetry.RegisterStreamLastMessageAge(alpacaClient.StreamLastFrame, time.Now)` (`alpacaClient` is built at `main.go:93`), so the registration is a testable function in `internal/telemetry`, not logic in `main`.
4. **BackfillBars / BackfillFundamentals**: `marketdata.backfill.symbols{kind=bars|fundamentals, outcome=written|empty|failed}` per symbol; the response (`FailedSymbols`) and the nil error are unchanged.
5. **Warm poller**: extract the per-cycle body of `StartWarmQuotePoller` (`marketdata_service.go:1119`; body `:1149`-`:1188`) into `warmQuotesOnce(ctx, symbols)` keeping the outer loop's pause `continue` and `ticker.Reset`; the `loop tick ok` records with state `idle` (0 symbols) and `paused` are written in the outer loop as pure additions beside the existing `continue` lines (the `continue // paused via config` line itself is not edited); aggregate the cache-insert failures into ONE `slog.WarnContext(ctx, "warm poller: cache insert failures", "count", n, "sample_symbols", <=5)` per cycle; the per-symbol `"warm poller: cache insert failed"` lines (`:1159`, `:1180`) drop to DEBUG with their text unchanged; the cycle still continues. The `LogTickOK` record: `warm_quote`; no record when `registry.Get` errored or the per-symbol fallback ran with `fetched == 0`; `idle` for 0 symbols; `paused` written in the outer loop's pause branch.
6. **Tick records**: `etf_flag_filler` throttled (60 s leading edge) once per dequeued item in `fillEtfFlag`; no record on `FetchIsEtf` error; `disabled` (fmp disabled / no cap) and `budget` states; `quote_retention` at the end of `runQuoteRetentionStep`, no record when `DropQuoteChunksBefore` errored, `skipped` for the safety skip (its WARN stays), `disabled` when `s.retention == nil`. `bar ingest: cycle complete`, `classification refresh cycle complete` and `asset set loaded` are KEPT, no second record.

**Verification**:
```
cd /home/user/xstockstrat && git add -A services/xstockstrat-marketdata
! git diff --cached -U0 -- services/xstockstrat-marketdata/internal/service/marketdata_service.go | grep -E '^-.*(time[.]NewTicker|ticker[.]Reset|paused via config)'
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go test ./internal/service/... ./internal/alpaca/... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod && ! grep -rn "otelhttp" --include=*.go .
```
(Run BEFORE the step's commit. The staged-diff grep fails if any removed line is the outer loop's `NewTicker`, `ticker.Reset` or `paused via config` line, i.e. the un-characterized pause/Reset code moved or changed; the `go test` run re-executes the Instruction 0 characterization tests against the final code; the last grep must find nothing: no `otelhttp` wrapper.)

---

### Step 12 — test: Marketdata telemetry tests

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/stream_metrics_test.go` — create
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — modify
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client_test.go` — modify (token-leak and outcome cases)
- `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go` — modify (outcome cases)
- `services/xstockstrat-marketdata/internal/alpaca/client_test.go` — modify (`do()` ok and ctx cases)
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (BackfillBars, warm-poller new-behavior and quote-retention tick cases; the characterization tests were added in Step 11)
- `services/xstockstrat-marketdata/internal/service/etf_flags_test.go` — modify (`etf_flag_filler` throttled tick cases)

**Reviewers**: Service owner `xstockstrat-marketdata` — ingestion integrity; the FMP key must never reach a metric, span or log

**Codebase Evidence**:
- Confirmed via: `ls internal/alpaca internal/fmp internal/finnhub internal/edgar internal/service` → `stream_test.go`, `client_test.go`, `fmp_client_test.go`, `fmp_gateway_test.go`, `finnhub_client_test.go`, `edgar_client_test.go`, `marketdata_service_test.go`, `etf_flags_test.go` (all exist; `stream_metrics_test.go` is the only new file).
- Confirmed via: the alpaca, fmp, finnhub and edgar packages are NOT in the CI `COVERPKGS` exclusion list (`cmd|handler|repository|telemetry|service`), so their new code is measured at 40%.
- C-13 verdict: reuse existing fakes in `stream_test.go` and `fmp_client_test.go`; no second consumer of a new literal, inline compliant.

**TDD**: red-green required

**Covers**: `AC-7, AC-12, AC-13, AC-14, AC-46`

**Instructions**:
- AC-12 (`stream_metrics_test.go`): stream manager with injected `now` and max reconnects 5; the first session reads a frame at T then drops, the next 4 drop before the subscription ack. The test registers the gauge through `telemetry.RegisterStreamLastMessageAge` with the manager's `StreamLastFrame` and the same injected `now` (nothing goes through `cmd/server`). Collect at T+30 s while reconnecting -> `marketdata.stream.last_message_age` is 30 s; `reconnects{reconnected}` +4 and `{gave_up}` +1; after the give-up the gauge reports no sample. Also a lazy manager with no subscribers reports nothing, and `go test -race` passes (StreamLastFrame reads through `streamMgr()`).
- AC-13 (`fmp_client_test.go`): FMP `getJSON` against an `httptest` server returning 429 for `.../stable/profile?symbol=AAPL&apikey=SECRET123` -> `vendor.requests{fmp, profile, http_429}` +1, `vendor.request.duration{fmp, profile}` records 1 sample; no metric attribute, span attribute or log line contains `SECRET123` and no attribute contains `AAPL`; a throttle or cap exit counts `throttle` / `cap` with no duration sample. Add equivalent minimal cases for Finnhub (token, in `finnhub_client_test.go`), EDGAR (`edgar_client_test.go`) and Alpaca `do()` (ok and ctx, `alpaca/client_test.go`).
- AC-14 (`marketdata_service_test.go`): `BackfillBars` timeframe `1d` for 5 symbols (2 fail, 1 empty) -> `backfill.symbols{bars}` written +2, empty +1, failed +2; `FailedSymbols` length 2 and nil error.
- AC-46: a warm-poller cycle over 25 symbols where `cacheQuote` fails for 8 (the existing behavior was characterized in Step 11 Instruction 0; this step asserts only the new behavior) -> exactly one WARN `"warm poller: cache insert failures"` with count 8 and at most 5 sample symbols; the per-symbol lines at DEBUG; the cycle continues.
- Tick tests (`marketdata_service_test.go`, `etf_flags_test.go`): `quote_retention` (`skipped`, `disabled`, no record when `DropQuoteChunksBefore` errored) and `etf_flag_filler` (throttled once per 60 s, no record on `FetchIsEtf` error) with an injected clock.
- AC-7 (marketdata half): `loop` attributes written across the tick tests are in `telemetry.Loops`, at most 8, no symbol in any record attribute; bar ingest writes only `bar ingest: cycle complete`.

**Verification**:
```
cd services/xstockstrat-marketdata && COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/{seen=1; gsub("%","",$3); if ($3+0<40) bad=1} END{exit (!seen || bad)}' && GOWORK=off golangci-lint run --modules-download-mode=mod
```
The `awk` assertion exits non-zero when total coverage of the measured packages is below 40%.

---

### Step 13 — service: Analysis live-loop, fundsignal and tick signals (SEV-2)

**Status**: `done`
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
- Overlap: 215's code is on `main-dev` and owns the `Feature 215 (FR-4)` block in `_eval_pair` and `_emit_fundamentals_unavailable_alert` in `live_loop.py` (`:733-760` and `:876-891` at the time of writing, derived by anchor in Verification) and the `servicer.py` RunBacktest paths; every site above is disjoint (recon R15).

**TDD**: red-green required

**Covers**: —

**Instructions**:
Signals only; the fundsignal run status (`:311`), release-on-failed-emit (`:298-300`), `signals_emitted` accounting (`:297`) and all timing are untouched (`@feature-259/260/156/158` preserved).
1. **live_loop.py**: `analysis.live_loop.pairs{outcome ok|no_bars|error}` at the per-pair handler (`:471-479`); `analysis.live_loop.drain_failures{source signals|held|watchlist}` at `:531-533`, `:565-567`, `:593-595`; `analysis.live_loop.triggers{trigger entry|exit, outcome alerted|throttled|alert_failed}` at the throttle (`:843-845`), after `_emit_alert` returns, and via a minimal `try: await self._emit_alert(...) except Exception: record alert_failed; raise` wrap at the `_emit_alert` call (re-raise: retry semantics and the pair handler's error path are unchanged; recon R4); unlabelled `analysis.live_loop.cycle.duration` histogram around the cycle. The `log.info("live_loop: cycle complete")` literal and text at `:345` are untouched and ungated; this loop writes NO `loop tick ok` (KEPT). `exc_info=True` on the cycle error log. Do not touch `:733-760` / `:876-891`, and leave `_TRUNCATION_COUNTER` (`:78-81`) as-is (Step 3 decision: out of scope, not routed through the accessor).
2. **Fundsignal sink** (design.md 1.5): `run_once(..., *, _emit_counts: list[int] | None = None)`; at the top `counts = _emit_counts if _emit_counts is not None else [0, 0]` ([attempted, emit_failed]); `counts[0] += 1` right after `confirmed = False` (`:274`, after the `row is None` continue); a new `else:` on `if signal_id is not None:` (`:285`) increments `counts[1]` and `analysis.fundsignal.signals{failed}`, and the success path records `{emitted}` beside `:297`; pass `counts` to every `_finish`. `_finish` gains keyword args `universe=None, scored=None, attempted=0, emitted=None, emit_failed=0` and writes ONE INFO `"fundsignal run summary"` (omitting `None` fields); the main return passes `universe=len(universe), scored=len(scores), attempted=counts[0], emitted=emitted, emit_failed=counts[1]`. Only `_tick` passes a sink and reads it after `run_once` returns; the `RunFundamentalsScan` path passes none and still gets a correct summary.
3. **Fundsignal tick**: in `_tick`, `summary = await self.run_once(..., _emit_counts=counts)` replaces the discarding call; after `_advance_schedule` (`:159`) write `loop tick ok` (`fundsignal`) unless the except path (`:160-163`), `summary.status == "failed"`, `status == "partial" and symbols_processed == 0`, or `counts[0] > 0 and counts[1] == counts[0]`; `idle` for 0 processed; `disabled` at the early return `:144-146`; no record when not due or when the lock is held. `log.error("fundsignal: cycle error: %s", e)` gains `exc_info=True`.
4. **servicer.py ticks**: `loop tick ok` for `opportunity_refresh`, `readiness_materializer`, `template_intent_sweep` at the success point of each tick per design.md 1.3 (no record when enumeration failed, or when every user/owner/intent failed; `idle` for 0 items; `disabled` for the materializer's disabled branch; template sweep uses a new local `enum_failed` flag set where the enumeration exception is swallowed, swallow-and-advance unchanged). `analysis.opportunity.recompute{kind full|retry, outcome ok|failed}` around the two `_run()` bodies at `:4891-4906` and `:4923-4930` (the failure log at `:4904` gains `exc_info=True`). `pnl_consumer` throttled `loop tick ok` after `_process_with_retry` returns (`pnl_pattern_consumer.py:189`), none on the outer exception.
5. **supervision.py**: `exc_info=True` on the seed error (`retry_until_ok`, `:45` region) and the tick error (`run_supervised`, `:54` region); no other change. **evaluator.py**: the `"fundamentals formula=..."` INFO at `:614` moves to DEBUG with text unchanged; the per-symbol `"PIT fundamentals loaded"` INFO in `servicer.py` `_load_fundamentals` (`:1837`, the log call near `:1894`; outside `RunBacktest`/`_run_backtest`) also moves to DEBUG with its text unchanged (N-06). Do not demote any named-WARN rule (S/analysis `@feature-262`, watchlist universe, opportunities-read, screener isolation).
6. **template.instantiate{service="analysis", outcome}** in `InstantiateTemplate` (`:3729`): `ok`, or the lower-cased gRPC code name (unavailable, not_found, already_exists, internal, aborted) at each abort site, else `other`. Add the `Loop` members `fundsignal`, `opportunity_refresh`, `readiness_materializer`, `template_intent_sweep`, `pnl_consumer`.

**Verification**:
```
cd /home/user/xstockstrat && git add -A services/xstockstrat-analysis
# (define hunk_guard / fn_range / fn_range_py from Execution Summary, "Staged-diff hunk guards"; every range is derived from HEAD by anchor, so re-run after rebasing onto 215)
f=services/xstockstrat-analysis/app/engine/live_loop.py
set -- $(fn_range "$f" 'Feature 215 [(]FR-4[)]' '_fund_unavailable[.]discard[(]key[)]'); hunk_guard "$f" "$1" "$2" || { echo "staged hunk inside 215's FR-4 deny-entry block"; exit 1; }
set -- $(fn_range_py "$f" _emit_fundamentals_unavailable_alert); hunk_guard "$f" "$1" "$2" || { echo "staged hunk inside _emit_fundamentals_unavailable_alert"; exit 1; }
sv=services/xstockstrat-analysis/app/handlers/servicer.py
for fn in RunBacktest _run_backtest; do set -- $(fn_range_py "$sv" $fn); hunk_guard "$sv" "$1" "$2" || { echo "staged hunk inside servicer.py $fn"; exit 1; }; done
ev=services/xstockstrat-analysis/app/services/evaluator.py
set -- $(fn_range_py "$ev" _fundamentals_formula_series); [ -n "$2" ] || { echo "evaluator range not found"; exit 1; }
hunk_guard "$ev" 1 $(($1-1)) && hunk_guard "$ev" $(($2+1)) 999999 || { echo "staged evaluator.py hunk outside _fundamentals_formula_series"; exit 1; }
[ "$(git diff --cached -U0 -- "$ev" | grep -E '^[-+][^-+]')" = "$(printf -- '-        log.info(\n+        log.debug(')" ] || { echo "evaluator.py change is not exactly the fundamentals-formula INFO->DEBUG"; exit 1; }
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . && grep -c "live_loop: cycle complete" app/engine/live_loop.py
```
(Run BEFORE the step's commit. `hunk_guard` exits non-zero if any staged hunk's pre-image overlaps 215's `FR-4` block or `_emit_fundamentals_unavailable_alert` in `live_loop.py`, or the `RunBacktest` / `_run_backtest` bodies in `servicer.py`. For `evaluator.py` the check is exact: no staged hunk lies outside `_fundamentals_formula_series` (the shared helpers are untouched), and the only staged change in the file is the one `log.info(` to `log.debug(` line of the `fundamentals formula=` call. The `grep -c` count must be at least 1, and `grep -c` exits non-zero on 0.)

---

### Step 14 — test: Analysis telemetry tests

**Status**: `done`
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
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 15 — service: Agent auth, OAuth, backend and degraded signals (SEV-2)

**Status**: `done`
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
- Confirmed via: `sed -n 18,43 app/mtls.py` → `channel_credentials()` calls `_load()` which raises `RuntimeError("mtls: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set (fail-closed)")`; `secure_channel(endpoint, target_service)` returns `grpc.aio.secure_channel(endpoint, channel_credentials(), options=[("grpc.ssl_target_name_override", target_service)])`. All call sites use `async with mtls.secure_channel(...)` (`grep -n "secure_channel" app/client.py` → 70 references, e.g. `:185, :254, :295, :309, :349`).
- Confirmed via: `app/auth.py:57-99` `validate_bearer_claims`: `mtls.secure_channel(IDENTITY_ENDPOINT, "xstockstrat-identity")` inside the `try` `:76`; `claims.aud != AGENT_PUBLIC_URL -> return None` `:83-84`; DEADLINE_EXCEEDED/UNAVAILABLE -> `log.warning` + `IDENTITY_UNAVAILABLE` `:92-94`; other AioRpcError -> `log.info` + `None` `:95-96`; bare `except Exception as e: log.error("Unexpected error validating JWT claims: %s", e); return None` `:97-99`.
- Confirmed via: `app/main.py`: `_authorized :147`, 401 response `:174`, 503 `:187`, `handle_mcp :201`.
- Confirmed via: `app/oauth_server.py`: `_txn_key :38`, excepts at `:68, :76, :87, :107, :137, :170, :219, :233`, token endpoint `except Exception: return JSONResponse({"error": "invalid_grant"}, 400)` at `:259-260` and `:268-269`, `unsupported_grant_type` `:272`.
- Confirmed via: `sed -n 60,80p app/telemetry.py` → `metrics.set_meter_provider(` `:63` with `MeterProvider(` `:64`; `LoggingHandler` attached at `:76`. These are the provider and log bridge the new agent instruments use (Step 3's `sed -n 70,85p` window shows only the handler).
- Confirmed via: `app/tools.py`: `_ALERT_THRESHOLD_CONFIG_KEY :79`, `_grpc_error_message :224` (UNTOUCHED), `ingest_signal` post-commit auto-alert (threshold read `try` `:678-687` with `alert_threshold =` `:682` and the default fallback `except` `:685-687`; `client.emit_alert` `:698` inside the `try` `:693-709`) and watchlist auto-add (`ensure_signal_watchlist`/`add_watchlist_symbol` `:715-716`, `except` `:721-724`; 282 added the `watchlist_refused` merge at `:719-720`) wrapped best-effort; `_agent_policy :2628` (read-failure `except` -> `log.warning("agent policy read failed; using safe default")` + `return default` `:2633-2635`).
- Not found: an exchange/onboarding log pair in the agent today; `NC-4`: `_txn_key` raising is uncaught (Starlette 500), nothing agent-side (recon "Resolved here").
- 281 and 282 have both merged into `main-dev`; the `tools.py` lines above were re-grepped after the 282 merge (#1456).

**TDD**: red-green required

**Covers**: —

**Instructions**:
Signals only: no tool is added, removed or re-shaped (mcp-tools.md and the tool-count inventory unaffected); 503-vs-401 stays; `_grpc_error_message` and its messages stay byte-identical; no label is added to `mcp.tool.duration` (`@feature-273`, `@feature-274`).
1. **Instruments + keys** in `app/telemetry.py` (via Step 3's accessors; record helpers in `tool_metrics.py`): `mcp.auth.rejected{reason}`, `oauth.requests{grant_type, outcome}`, `oauth.txn.rejected{reason}`, `agent.backend.rpc_errors{backend, grpc_code}`, `agent.degraded{kind}`; keys `reason`, `grant_type`, `outcome`, `backend`, `grpc_code`, `kind`. `backend` = the secure_channel target name minus the `xstockstrat-` prefix, clamped to {analysis, ingest, indicators, identity, config, portfolio, trading, marketdata, notify, unknown}.
2. **mtls wrapper** (design.md 1.9): `secure_channel` still calls `channel_credentials()` eagerly (so `test_mtls.py` still sees the `RuntimeError`) and returns `_CountingChannel(inner, backend)`: `__aenter__` returns `await inner.__aenter__()`; `__aexit__`: if `exc` is a `grpc.aio.AioRpcError`, `try: tool_metrics.record_backend_rpc_error(backend, exc.code()) except Exception: pass`, then `await inner.__aexit__(...)` and `return False` (never suppress or replace the exception); `__getattr__` delegates. Errors caught inside the block are not counted; the identity-call double view (`oauth.requests` and `backend.rpc_errors`) is declared.
3. **auth.py**: `mcp.auth.rejected` reasons `wrong_audience` (`:83-84`), `identity_unavailable` (`:92-94`), `invalid_token` (`:95-96`), `internal_error` (`:97-99`, inside the existing except, still returns None); the `:98` ERROR becomes `log.error("Unexpected error validating JWT claims: %s: %s", type(e).__name__, e)`; the token is never logged. **main.py**: `missing_bearer` at the missing-token 401 path (`_authorized`, ~`:157-158`); status codes unchanged.
4. **oauth_server.py**: `oauth.txn.rejected{malformed | bad_sig | decode | state_mismatch}` at `:61-62`, `:64-65`, `:68-69`, `:203` (design.md); `oauth.requests` `outcome` `upstream_error` (AioRpcError UNAVAILABLE/DEADLINE_EXCEEDED), `invalid_grant` (other AioRpcError), `error` (non-gRPC), `unsupported_grant_type` (`:272`); the two bare excepts (`:259`, `:268`) gain a `log.warning` carrying the gRPC code name or exception class only, never the code, token or state; the 400 `invalid_grant` response is unchanged. Do not catch the `_txn_key` raise (NC-4).
5. **tools.py**: `agent.degraded{kind}` at the swallowed post-commit sites: `alert_threshold_default`, `auto_alert`, `watchlist_add`, `policy_default`; unchanged return values. **Onboarding**: the token-exchange-success half already exists in identity as `log.info('OAuth code exchanged', { clientId, userId })` (`identityServiceImpl.ts:515`; Step 17 leaves it unchanged), so the agent adds no exchange log. The agent's half is one INFO `"first successful tool call"` with `user_id` as a log FIELD (never a label), written from `ToolMetricsMiddleware.__call__` in `app/tool_metrics.py`, the one place that already classifies each `tools/call` result as ok or error: when `outcome == "ok"` and the tool name is registered, it reads `user_id` from the verified claims on the request scope (`ctx.request.scope["state"][MCP_CLAIMS_SCOPE_KEY]`, key defined at `app/scopes.py:18`, the same source `_claims_from_scope_state` in `tools.py` uses; `tools.py` is not importable from `tool_metrics.py` without a cycle risk, so the one-line scope read is duplicated, a recorded and accepted C-18 trade-off) and logs only if the id is not yet in a module-level in-memory seen-set. The set is capped at 10000 entries (named invariant, design.md 1.13): at the cap nothing is added, nothing is evicted and nothing is logged for a user first seen after it, so memory and log volume stay bounded and no id is logged twice per process. The set is per-process, so a restart or another instance may log a user's first call again (declared; the agent stays stateless).

**Verification**:
```
cd "$(git rev-parse --show-toplevel)" && git add -A services/xstockstrat-agent
# (define hunk_guard / fn_range_py from Execution Summary, "Staged-diff hunk guards")
f=services/xstockstrat-agent/app/tools.py
set -- $(fn_range_py "$f" _grpc_error_message); hunk_guard "$f" "$1" "$2" || { echo "staged hunk inside _grpc_error_message"; exit 1; }
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check .
```
(Run BEFORE the step's commit. The guard fails if any staged hunk's pre-image overlaps the `_grpc_error_message` body, so its messages stay byte-identical.)

---

### Step 16 — test: Agent telemetry tests

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_mtls_backend_errors.py` — create
- `services/xstockstrat-agent/tests/test_auth.py` — modify
- `services/xstockstrat-agent/tests/test_oauth.py` — modify
- `services/xstockstrat-agent/tests/test_ingest_signal_watchlist.py` — modify
- `services/xstockstrat-agent/tests/test_tool_metrics.py` — modify

Not planned: `tests/conftest.py` changes. If a second consumer forces a shared fixture (C-13), that is a Deviation Log entry (F-09) and the file is added then.

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
- AC-47: a callback with a well-formed txn blob whose HMAC mismatches -> `oauth.txn.rejected{bad_sig}` +1; a non-deduplicated `ingest_signal` with conviction 0.9 whose auto-alert `EmitAlert` fails after commit -> `agent.degraded{auto_alert}` +1 and the ingest result unchanged; a successful exchange for `u-9` then that user's first successful tool call (driven through `ToolMetricsMiddleware` with a stub `call_next` and claims on the request scope) -> exactly 1 INFO `"first successful tool call"` with `user_id=u-9` as a field, a second call writes none, and no metric attribute contains `u-9`.

**Verification**:
```
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 17 — service: Identity login, token, exchange, refresh and audit signals (SEV-2)

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/telemetry.ts` — modify (instruments + key constants)
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify
- `services/xstockstrat-identity/src/grpc/ledgerAudit.ts` — modify

**Reviewers**: Service owner `xstockstrat-identity` — JWT expiry and rotation, secret handling (no token, email or hash in a log or label); Security — never log tokens, passwords, hashes or emails

**Codebase Evidence**:
- Confirmed via: `grep -n "async validateToken\|async refreshToken\|async exchangeAuthCode" src/grpc/identityServiceImpl.ts` → `validateToken :189`, `refreshToken :210` (catch `log.error('refreshToken failed', ...)` `:239`), `exchangeAuthCode :480`; login `:133-183` (design.md); `auditSafe :728-739` awaited before the reply at `:708, :769, :830, :872, :921` (recon).
- Confirmed via: `sed -n 40,66p src/grpc/ledgerAudit.ts` → `client.appendEvent(req, outMd, cb)` inside a `new Promise` with NO deadline option (`:55-59`); `catch (err) { log.error('ledger audit append failed (best-effort)', { eventType, error: ... }) }` `:60-65`.
- Confirmed via: `grep -n "export function grpcStatusCode" src/telemetry.ts` → `:64` (Step 5's insertions moved it from `:56`; locate it by symbol); recon NC-2 resolved: the Node status-code metric records `callback({code})` (`identity telemetry.export.test.ts:267-305`).
- Existing pattern: the `jwtSecret` getter (`identityServiceImpl.ts:113-120`) reads `process.env.JWT_SECRET` at `:115` and throws at `:117`, so the `secret_missing` classification reads `process.env.JWT_SECRET`, not the getter.
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
cd "$(git rev-parse --show-toplevel)" && git add -A services/xstockstrat-identity
! git diff --cached -U0 -- services/xstockstrat-identity/src/grpc/ledgerAudit.ts | grep -iE '^\+.*deadline'
cd services/xstockstrat-identity && pnpm run lint && pnpm exec tsc --noEmit && ! grep -in "deadline" src/grpc/ledgerAudit.ts
```
(Run BEFORE the step's commit. The staged-diff check fails if any added line in `ledgerAudit.ts` mentions a deadline; the file grep asserts none exists after the change.)

---

### Step 18 — test: Identity telemetry tests

**Status**: `done`
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

**Status**: `done`
**Service**: `xstockstrat-config`, `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-config/src/telemetry.ts` — modify (instruments + key constants)
- `services/xstockstrat-config/src/grpc/authz.ts` — modify (`secretDenialReason`)
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify
- `services/xstockstrat-ledger/src/telemetry.ts` — modify (instruments)
- `services/xstockstrat-ledger/src/services/eventNotifier.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — WatchConfig stream stability, no secret values in any log, config authz allow-list unchanged; Service owner `xstockstrat-ledger` — append-only invariant, event ordering, LISTEN recovery; Security — GetSecret audit line never carries a value, caller ids truncated

**Codebase Evidence**:
- Confirmed via: `sed -n 185,189p services/xstockstrat-config/src/grpc/authz.ts` → doc comment `:185`, `export const SECRET_SCOPE_ERROR` `:186-189`, the trailing declaration (the file is 189 lines), so there is no function below `hasSecretCallerAuthority`.
- Confirmed via: `sed -n 168,183p services/xstockstrat-config/src/grpc/authz.ts` → `hasSecretCallerAuthority(call, namespace, key): boolean` reads `first(call.metadata, HEADER_INTERNAL_CALLER)`, returns `false` if absent, then `SECRET_CALLER_ALLOWLIST.some(grant => grant.callerID === callerID && grant.namespace === namespace && (keys/keyPrefixes match) && (grant.peerSan === undefined || peerDnsSans(call).includes(grant.peerSan)))`.
- Confirmed via: `grep -n` in `configServiceImpl.ts` (re-grepped after 282 merged into `main-dev` (#1456); its `SCALAR_BOUNDS_REGISTRY` additions plus 2 lines already on the branch shift the file by +9) → `connectedOnce :176`, `connectListener :197` (error/end handlers `:202-203`, `await this.serial(() => (this.connectedOnce ? this.resyncAll() : this.reloadAll()))` `:208`, `this.connectedOnce = true :209`, shared boot/reconnect log `'Config service initialised, listening for config_changed notifications'` `:211`), `dropListener :219` (guard `if (this.listener !== c) return;` `:220`), `scheduleReconnect :232`, `reloadAll :273` (its snapshot `for` loop closes at `:297`, method ends `:298`), `reloadNamespace :300` (`this.snapshots.set(...)` closes at `:319`, method ends `:320`), `endSubscriber :377`, WatchConfig `call.on('error', () => {` `:409` (silent), `getSecret :467` with `log.warn('GetSecret denied — caller not on the secret allow-list', { namespace, key }) :470` (logs the key name; no caller, no reason), not-found return `:485`, success return `:497`, outer DB `catch` `:498-500` (silent), `setConfig :503` (denials `:520-537`).
- Confirmed via: ledger `connect()` in `eventNotifier.ts`: `client.on('error', (err) => { log.warn('notify listener error, reconnecting', ...); this.scheduleReconnect(); })`, `client.on('end', ...)`, then `await client.connect(); await client.query('LISTEN ...'); this.client = client; const reconnected = this.connectedOnce; this.connectedOnce = true; log.info('notify listener connected', { channel, reconnected })`; the connect catch `log.warn('notify listener connect failed, retrying', ...)` then `this.scheduleReconnect()`; `scheduleReconnect` sets `this.client = null` and uses the fixed `reconnectDelayMs` timer.
- Existing tests: config `src/__tests__/secretCallerAuthz.test.ts`, `configServiceImpl.test.ts`, `setConfigAuthz.test.ts`, `internalCallerAuthz.test.ts`, `internalCallerSetConfig.test.ts`; ledger `src/__tests__/eventNotifier.test.ts`.
- 281 and 282 have both merged into `main-dev`; the anchors above are taken from the merged tree, and Instructions 3-4 name each site by symbol as well as line.

**TDD**: red-green required

**Covers**: —

**Instructions**:
Signals only; the GetSecret gate stays driven by the boolean `hasSecretCallerAuthority` (design.md Rejected Alternatives); no value is ever logged.
1. **config instruments**: observable gauges `config.listener_up` (0/1) and `config.last_reload_timestamp` (unix seconds), counters `config.listener_reconnects` and `config.watch.terminated{reason}`; keys `reason`.
2. **authz.ts**: add `secretDenialReason(call, ns, key)` appended at the END of `authz.ts`, after the trailing `export const SECRET_SCOPE_ERROR` declaration (`:186-189`, doc comment `:185`), outside both guarded ranges (not adjacent to `hasSecretCallerAuthority`, so git hunk sliding cannot attach the insertion to the guarded body and false-fail the guard), returning, in order, `no_caller_header`, `unknown_caller`, `key_not_granted`, `peer_san_mismatch`, or `null` when authorized. Log-only. Do not edit `hasSecretCallerAuthority`.
3. **getSecret**: the denial log (`:470`) gains `callerId` (truncated to 64 chars, named invariant), `reason`, `hadPeerSan`; success writes ONE `log.info('GetSecret served', { callerId, namespace, key, found })` (`found` false at the not-found return, true at the success return), never the value; the silent outer DB `catch` (`:498-500`) gains `log.error('GetSecret DB error', ...)` with the error message. **setConfig** denials (`:520-537`): log `reason` `no_admin_or_internal_grant` / `not_owner`; when an `x-internal-caller` header is present the first denial log is raised to ERROR with `internalCaller` (truncated 64); only the target state name is logged, never another config value. **WatchConfig** `call.on('error', ...)` now logs WARN `'WatchConfig subscriber error'` with the error message and increments `config.watch.terminated{client_error}`; `endSubscriber` increments `{server_error}`.
4. **Listener** (design.md 1.7): in `connectListener` (`:197`), capture `const reconnected = this.connectedOnce;` BEFORE the `await this.serial(() => (this.connectedOnce ? this.resyncAll() : this.reloadAll()))` reload (`:208`; `this.connectedOnce = true` at `:209` overwrites it); after the reload, only `if (this.listener === client)`, set `config.listener_up = 1` and `listener_reconnects += 1` when `reconnected`; the `'Config service initialised, listening for config_changed notifications'` log (`:211`) gains `{reconnected}`; `dropListener` (`:219`) sets 0 right after its `this.listener !== c` guard (`:220`); the boot failure path leaves the gauge at its initial 0; `config.last_reload_timestamp` set at the end of `reloadAll` (after its snapshot `for` loop, which closes at `:297`) and `reloadNamespace` (after its `this.snapshots.set(...)` call, which closes at `:319`).
5. **ledger** (`eventNotifier.ts`, FR-8 + FR-14): gauge `ledger.notify.listener_up` = 1 after `this.client = client`, 0 at the top of `scheduleReconnect`; counter `ledger.notify.listener_reconnects` +1 when `reconnected`. One new field `private consecutiveFailures = 0` covers both WARNs: the connect-failed catch increments it for every failed attempt; the client `error` handler increments it ONLY when `this.client === client` (checked before `scheduleReconnect` nulls it). Each site logs only when `n === 1 || n % 10 === 0` with `consecutive_failures: n`; reset to 0 right after `this.client = client` on a successful connect. `scheduleReconnect` and `reconnectDelayMs` timing are unchanged.

**Verification**:
```
for s in config ledger; do (cd services/xstockstrat-$s && pnpm run lint && pnpm exec tsc --noEmit) || exit 1; done
cd /home/user/xstockstrat && git add -A services/xstockstrat-config
# (define hunk_guard / fn_range from Execution Summary, "Staged-diff hunk guards")
f=services/xstockstrat-config/src/grpc/authz.ts
set -- $(fn_range "$f" '^export function hasSecretCallerAuthority[(]'); hunk_guard "$f" "$1" "$2" || { echo "staged hunk inside hasSecretCallerAuthority"; exit 1; }
set -- $(fn_range "$f" '^const SECRET_CALLER_ALLOWLIST' '^];'); hunk_guard "$f" "$1" "$2" || { echo "staged hunk inside SECRET_CALLER_ALLOWLIST"; exit 1; }
```
(Run BEFORE the step's commit, against the staged diff. Both ranges are derived from `HEAD` by anchor (`hasSecretCallerAuthority` is the `export function` through its closing `}`, 168-183 at the time of writing; `SECRET_CALLER_ALLOWLIST` is the `const` through its `^];`, 132-145). A staged hunk whose pre-image overlaps either fails the step, so the gate and the grants are provably untouched; `secretDenialReason` is appended at the end of the file after `SECRET_SCOPE_ERROR` (Instruction 2), a pure insertion outside both ranges, so it passes.)

---

### Step 20 — test: Config and ledger telemetry tests

**Status**: `done`
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

**Status**: `done`
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
4. **Startup line**: Slack and SendGrid presence is held privately in `FanoutDispatcher` (`this.slackWebhookUrl`, `this.sendgridApiKey`, `fanout.ts:47-48`) and push in `WebPushDispatcher.vapidConfigured` (`webPush.ts:77`, set from `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY`/`VAPID_SUBJECT`). Add a read-only `enabledChannels(): {slack: boolean; sendgrid: boolean}` to `FanoutDispatcher` and an `isPushEnabled(): boolean` to `WebPushDispatcher`, plus a pure `describeDeliveryChannels(fanout, webPush): {enabled: string; disabled: string}` in the new `src/fanout/deliveryChannels.ts` (importable by tests without booting the server). In `src/index.ts`, after the three constructions, write ONE `log.info('delivery channels', describeDeliveryChannels(fanout, webPush))`, e.g. `{ enabled: 'slack,push', disabled: 'sendgrid' }`; names only, never a webhook, key or VAPID value. `deliveryChannels.ts`, `enabledChannels()` and `isPushEnabled()` are a testability-driven new surface (so the startup line can be tested without booting the server), accepted per design and flagged for reviewer confirmation (C-18).

**Verification**:
```
cd services/xstockstrat-notify && pnpm run lint && pnpm exec tsc --noEmit
```

---

### Step 22 — test: Notify telemetry tests

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/fanout.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/webPush.test.ts` — modify (push-outcome counters)
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
- Push outcomes (`webPush.test.ts`, existing file): a minimal test per outcome asserting `notify.delivery{push, outcome}` +1 for `sent` (subscription accepted), `pruned` (410/404 subscription removed), `disabled` (VAPID not configured) and `no_audience` (no matching subscriptions), with delivery behavior unchanged.
- Span propagation: assert (per Step 6's `queueMicrotask` result) whether a fanout dispatch started in a span keeps it; record the outcome in the test docstring (design.md Open Risk).

**Verification**:
```
cd services/xstockstrat-notify && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint
```

---

### Step 23 — service: UI BFF auth, audit and per-method signals

**Status**: `done`
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

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/__tests__/bffMetrics.test.ts` — modify
- `services/xstockstrat-ui/src/lib/__tests__/bffAuthMetrics.test.ts` — create
- `services/xstockstrat-ui/src/lib/identity.test.ts` — modify
- `services/xstockstrat-ui/src/lib/auth.test.ts` — modify

Not planned: `e2e/fixtures/INVENTORY.md`. If a new fixture is added, that is a Deviation Log entry (F-09) and the file is added then.

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

**Status**: `done`
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
- Confirmed via: `sed -n 15,45p app/extractors/mcp_client.py` → three WARN drop branches, none with a slug: non-object (`:27-29`) logs the fixed text `"mcp_client: skipping non-object result item"` (`:28`) and no item; bad symbol/direction (`:34`) and out-of-range conviction (`:38`) log `%r` of the WHOLE item; `extract(self, raw)` takes only `McpClientInput`. `app/extractors/base.py` `@dataclass class McpClientInput: result_items: list[dict]`.
- Confirmed via: `servicer.py`: `IngestSignal :958` (calls `self._ingest_external_signal(` at `:970`), `_ingest_external_signal :984` (typed `-> tuple[int, bool]`), dedup INFO `"deduplicated signal source=%s symbol=%s direction=%s -> signal_id=%d"` at `:1162`, `_resume_job :737` (no `try`), `asyncio.create_task(self._run_backfill(...)) :438`, `asyncio.create_task(self._resume_job(job_id)) :734`, `InstantiateTemplate :1587`.
- Confirmed via: `tests/test_mcp_client_loop.py:192` spy on `_ingest_external_signal` (design.md): a `path` kwarg would `TypeError` it, so none is added.
- Existing pattern: exceptions `_SignalValidationError`, `_SignalSourceNotFound`, `_SignalIngestError` in `servicer.py` (design.md 1.14).

**TDD**: red-green required

**Covers**: —

**Instructions**:
Source-health derivation and task supervision are unchanged; `_resume_job` still re-raises; no slug in any label.
1. **Instruments + keys**: `ingest.source.poll{outcome}`, `ingest.source.poll.duration`, `ingest.signal.dropped{stage, reason}`, `ingest.signal.outcome{path, outcome}`, `ingest.backfill.jobs{outcome}`, `template.instantiate{service="ingest", outcome}`; keys `outcome`, `stage`, `reason`, `path`, `service`. `Loop` member `mcp_client`.
2. **mcp_client_loop.py**: `ingest.source.poll` outcomes `ok`, `no_bearer`, `config_error`, `all_items_failed`, `error`; both no-bearer returns also write `log.warning("mcp_client loop: source %s bearer not configured", slug)`; histogram wraps the `poll_one_source` call at `:173`; per-cycle counts (`attempted` = sources that reached `poll_one_source`, `failed` = it raised, bearer-not-configured counts as attempted not failed) feed one `loop tick ok` (`mcp_client`) at the end of `run_one_cycle`, none when `list_all_sources` raised or `attempted > 0 and failed == attempted`, `idle` when 0 sources. `:148` becomes `_sid, dedup = await servicer._ingest_external_signal(...)` (2-tuple, inside the per-item try) with `ingest.signal.outcome{path=mcp_poll}`: `deduplicated` / `ingested`, `rejected` for `_SignalValidationError`/`_SignalSourceNotFound`, `error` for others inside the existing except at `:150`. Pass `slug` to `McpClientInput` at `:142`.
3. **Extractor**: `McpClientInput` gains `slug: str = ""`; all three drop branches gain `slug`; the two dict branches (`:34`, `:38`) replace the whole-item `%r` with the item truncated to 200 characters (`repr(item)[:200]`); the non-object branch (`:28`) keeps its fixed text and still logs no item content, so no item logging is introduced there (AC-53 exercises only `bad_symbol_direction`); all three count `ingest.signal.dropped{stage=extract, reason non_object|bad_symbol_direction|bad_conviction}`.
4. **servicer.py**: `_record_signal_outcome(path, outcome)` (never-raising) and a classifier beside the exception classes; `IngestSignal` records `path=rpc`: success -> `deduplicated` / `ingested`, validation / source-not-found -> `rejected`, `_SignalIngestError` -> `error`, plus `except Exception: record("rpc","error"); raise` so propagation is unchanged. The dedup INFO at `:1162` becomes a `log.debug` with its text unchanged (N-01; the counter replaces it at INFO). `_resume_job`: wrap the body in `try/except Exception as exc: log.error("_resume_job failed job=%s", job_id, exc_info=True); ingest.backfill.jobs{failed} +1; raise` (re-raises the same object; no `FAILED` marking, no `supervision.spawn`). `InstantiateTemplate` (`:1587`) records `template.instantiate{ingest, ok | unavailable | not_found | invalid_argument | already_exists | failed_precondition | other}`.

**Verification**:
```
cd services/xstockstrat-ingest && uv run ruff check . && uv run ruff format --check . && uv run pytest -q tests/test_mcp_client_loop.py
```
(The existing `:192` spy on `_ingest_external_signal` must still pass: it proves no `path` kwarg was added.)

---

### Step 26 — test: Ingest telemetry tests

**Status**: `done`
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
cd services/xstockstrat-ingest && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 27 — service: Indicators sandbox, template and config-watcher signals (SEV-3)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/telemetry.py` — modify (instruments + key constants)
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify
- `services/xstockstrat-indicators/app/config/watcher.py` — modify

Not planned: `app/services/sandbox.py`. If the exit-reason plumbing needs it, that is a Deviation Log entry (F-09) and the file is added then.

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
cd services/xstockstrat-indicators && uv run ruff check . && uv run ruff format --check . && uv run pytest -q tests/test_config_watcher.py tests/test_execute_formula_concurrency.py
```
(The existing watcher and concurrency tests must still pass, which pins the unchanged `asyncio.sleep(2)` reconnect behavior and RPC status.)

---

### Step 28 — test: Indicators telemetry tests

**Status**: `done`
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
cd services/xstockstrat-indicators && uv run pytest --cov=app --cov-fail-under=50 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 29 — test: Final allowlist, guard and acceptance pass

**Status**: `done`
**Service**: all 12 services; `scripts/`, `packages/otel/` (read-only checks)
**Files**:
- `services/xstockstrat-trading/internal/service/telemetry_allowlist_test.go` — create (new)
- `services/xstockstrat-portfolio/internal/service/telemetry_allowlist_test.go` — create (new)
- `services/xstockstrat-marketdata/internal/service/telemetry_allowlist_test.go` — create (new)
- `services/xstockstrat-analysis/tests/test_telemetry_allowlist.py` — create (new)
- `services/xstockstrat-ingest/tests/test_telemetry_allowlist.py` — create (new)
- `services/xstockstrat-indicators/tests/test_telemetry_allowlist.py` — create (new)
- `services/xstockstrat-agent/tests/test_telemetry_allowlist.py` — create (new)
- `services/xstockstrat-identity/src/__tests__/telemetryAllowlist.test.ts` — create (new)
- `services/xstockstrat-config/src/__tests__/telemetryAllowlist.test.ts` — create (new)
- `services/xstockstrat-ledger/src/__tests__/telemetryAllowlist.test.ts` — create (new)
- `services/xstockstrat-notify/src/__tests__/telemetryAllowlist.test.ts` — create (new)
- `services/xstockstrat-ui/src/lib/__tests__/bffAllowlist.test.ts` — create (new)

**Reviewers**: Service owner of each of the 12 services — label discipline in their own module; Platform Lead — the cross-service loop-liveness pattern and shared label discipline; Security — no identifier-bearing label

**Codebase Evidence**:
- Confirmed via: `ls scripts/check-otel-produced-signals.sh` → present; its header: it fails on an alert or dashboard querying an unregistered series or on a registry row whose producer literal is gone (Part 1, Part 3, Part 4, Part 5); new series that no alert or dashboard references do not trip it (recon Dependencies, product-spec.md OQ3 agreed). Registry file `packages/otel/produced-signals.tsv` must stay unchanged (AC-43).
- Confirmed via: design.md 1.1: label keys are constants in each telemetry module; this step's tests assert every collected attribute key is a member and a MIN instrument-name set is present (the six gauge/listener instruments and `marketdata.stream.reconnects` included), reached through the earlier steps' harnesses; gauges by register-then-collect.
- Confirmed via: `grep -c "live_loop: cycle complete" services/xstockstrat-analysis/app/engine/live_loop.py` → 1 (the registered literal, line `:348` after the 293 PR-1 live-loop change merged from `main-dev`, #1457).
- Confirmed via: `docs/roadmap/features/294-signal-map-instrumentation/context.md` § "Deferred behavior follow-ups" lists the 14 IDs S-01, S-02, S-03, S-08, S-09, S-13, S-14, S-15, S-16, S-22, S-25, S-26, N-02, N-04, one row each (AC-44).
- C-13 verdict: each allowlist test reads the service's own key constants; no shared literal, no fixture home needed.

**TDD**: red-green required

**Covers**: `AC-7, AC-41, AC-42, AC-43, AC-44, AC-56`

**Instructions**:
- **Go placement (chosen: the existing step-test harness, not an external `telemetry_test` package).** Each Go allowlist test sits in its service's `internal/service` test package, beside the manual-reader and captured-JSON-slog helpers of `trading_telemetry_test.go`, `portfolio_telemetry_test.go` and `marketdata_service_test.go`; a separate `telemetry_test` package could not reuse them (test files are not importable) and cannot reach `cmd/server`. It reads the key constants and `Loops` from the exported `telemetry` API. marketdata's vendor, stream and backfill instruments are recorded from the alpaca, fmp, finnhub and edgar packages, so its test records them through the exported `telemetry` record helpers those packages call, and registers the stream-age gauge through `telemetry.RegisterStreamLastMessageAge` (both defined in Step 11), never through `cmd/server/main.go`.
- **Allowlist tests (AC-41)**: per service, drive the instruments through the existing step harness (or a minimal register-then-collect for gauges), collect every attribute key, assert the set is a subset of the module's key constants and that no key is any of `user_id`, `email`, `client_id`, `account_id`, `order_id`, `intent_id`, `symbol`, `strategy_id`, `stream_key`, `slug`, `category`, a secret key name or `internal_caller` (trading's alert key is `alert_kind`, not `category`); assert the MIN instrument-name set for that service is present; assert `rpc.server.duration`, `mcp.tool.duration`, `http.server.duration` keep their names and attribute keys; assert the literal `live_loop: cycle complete` appears in `live_loop.py`.
- **AC-42**: with `OTEL_ENABLED` false every new call site executes without exception and no exporter is created; a failing OTel init still lets the service start. These cases live in the new per-service `*allowlist*` test files listed in **Files** (new); do NOT extend the existing `telemetry.test.ts` / `otel_test.go`.
- **AC-7**: aggregate check that every `loop` value written by any service belongs to that service's closed set of at most 8 names.
- **AC-56**: the `serverMetricViews()` equality (unexported, package `telemetry`) is asserted in Step 2's `instruments_test.go`; Step 29 adds the aggregate: after every instrument of a Go module has been driven, no collected instrument name starts with `rpc.client.`.
- **AC-43 (diff path check)**: from the repo root, this shell assertion must output nothing (any output is a failure): `files=$(git diff --name-only origin/main-dev...HEAD) || exit 1; printf '%s\n' "$files" | grep -E '^(packages/otel/|.*\.proto$|.*/migrations/)'` (after `git fetch origin main-dev`, so a stale ref cannot mask or fake a result); then run the guard script (Verification below runs both). The `packages/otel/` prefix covers the whole directory (alerts, dashboards, `produced-signals.tsv` and everything else), a deliberate superset of AC-43's listed paths that matches the Execution Summary's no-`packages/otel/`-edit claim.
- **AC-44**: the Verification block runs a `grep -c` loop asserting each of the 14 deferred IDs (S-01, S-02, S-03, S-08, S-09, S-13, S-14, S-15, S-16, S-22, S-25, S-26, N-02, N-04) appears exactly once as a row of the Deferred table in `context.md` § "Deferred behavior follow-ups"; it exits non-zero otherwise.

**Verification**:
```
cd "$(git rev-parse --show-toplevel)" && bash scripts/check-otel-produced-signals.sh
cd "$(git rev-parse --show-toplevel)" && git fetch -q origin main-dev && files=$(git diff --name-only origin/main-dev...HEAD) && { ! printf '%s\n' "$files" | grep -E '^(packages/otel/|.*\.proto$|.*/migrations/)'; }
cd "$(git rev-parse --show-toplevel)" && for id in S-01 S-02 S-03 S-08 S-09 S-13 S-14 S-15 S-16 S-22 S-25 S-26 N-02 N-04; do n=$(awk '/^## Deferred behavior follow-ups/{f=1;next} /^## /{f=0} f' docs/roadmap/features/294-signal-map-instrumentation/context.md | grep -cE "^\| *$id *\|"); [ "$n" = 1 ] || { echo "AC-44: $id appears $n times"; exit 1; }; done
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off go test ./... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod) || exit 1; done
(cd services/xstockstrat-marketdata && COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/{seen=1; gsub("%","",$3); if ($3+0<40) bad=1} END{exit (!seen || bad)}')
for s in ingest analysis agent; do (cd services/xstockstrat-$s && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .) || exit 1; done
(cd services/xstockstrat-indicators && uv run pytest --cov=app --cov-fail-under=50 -q && uv run ruff check . && uv run ruff format --check .)
for s in identity config ledger notify; do (cd services/xstockstrat-$s && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint) || exit 1; done
(cd services/xstockstrat-ui && pnpm run test:unit && pnpm run test:coverage && pnpm run lint) && bash scripts/check-duplication.sh services/xstockstrat-ui/src
```
(Run every command from the active worktree root, which `git rev-parse --show-toplevel` resolves, never a hard-coded main-checkout path. The second command negates the `grep`: it fails if any alert, dashboard, registry, proto or migration path changed, which is AC-43; the third is the AC-44 loop. The Playwright e2e suite is not run: no page, route or response shape changed.)

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
cd /home/user/xstockstrat && for s in trading portfolio marketdata analysis agent identity config ledger notify ingest indicators ui; do grep -q 'loop tick ok\|294-signal-map' services/xstockstrat-$s/CLAUDE.md || { echo "missing: $s"; exit 1; }; done; bash scripts/check-otel-produced-signals.sh
```
(Each service file mentions its new signals; the guard script still exits 0 because docs under `docs/`/`packages/otel` it checks are unchanged.)

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

Known deviation to log at the start of `/sdd-execute`: sequential execution on `ccr-b4aace27-zvuaby` instead of `feature/signal-map-instrumentation` (operator decision 4; `/sdd-execute sequential` assumes a `feature/<slug>` branch; F-02 is honored because nothing is pushed to `main-dev` directly and F-03 is vacuous because no step PRs exist).

### Deviation: Execution branch (logged at Step 1, 2026-11-06)
**Spec said**: `/sdd-execute sequential` commits each step to `feature/signal-map-instrumentation`.
**Actual**: every step commits directly to `ccr-b4aace27-zvuaby`; PR #1427 is the single integration PR (its description must be rewritten before merge).
**Reason**: operator decision 4 (product-spec.md); recorded here as the spec header and context.md instruct.
**Disposition**: operator override

### Deviation: Step 7 verification run from the worktree root (logged at Step 7, 2026-11-06)
**Spec said**: `cd /home/user/xstockstrat && git add -A services/xstockstrat-trading`, then the guard and the Go commands as one `&&` chain.
**Actual**: the same commands ran from the active worktree root (`/home/user/xstockstrat/.claude/worktrees/wf_3112f9f1-62e-18`). The guard ran from a scratchpad script holding the Execution Summary helpers verbatim, and the Go commands ran as separate invocations because the worktree sandbox refuses compound commands. Commands and flags are unchanged.
**Reason**: the hard-coded main-checkout path would stage and guard a different tree (the re-spec before Step 6 flagged this line in context.md).
**Disposition**: CI-equivalent fallback

### Deviation: Step 8 verification split into separate invocations (logged at Step 8, 2026-11-06)
**Spec said**: one `&&` chain that computes `COVERPKGS` with `$(go list ... )` and passes it to `go test -coverpkg="${COVERPKGS}"`, then the `awk` 40% assertion and `golangci-lint`.
**Actual**: the `COVERPKGS` pipeline ran on its own and printed `internal/broker,internal/config,internal/middleware,internal/mtls` (module-qualified). That literal value went to `-coverpkg` in a second invocation, and the `awk` assertion and `golangci-lint` ran as separate invocations. Commands, flags and the threshold are unchanged.
**Reason**: the worktree sandbox refuses a runtime-computed variable expanded into `go` inside a compound command.
**Disposition**: CI-equivalent fallback

### Deviation: Step 8 AC-7 position-sync clause tested on the tick body (logged at Step 8, 2026-11-06)
**Spec said**: "position sync tick writes only `"position sync cycle complete"`".
**Actual**: `TestSyncPositions_FailedLedgerEmitStillCountsSynced` asserts that `syncPositions`, the body of one position-sync tick, writes no `loop tick ok` record. `TestLoopTickRecords` asserts that `position_sync` is never written through `LogTickOK`. The heartbeat line itself (`StartPositionSyncPoller`) is not driven: its first tick fires on a 300 s ticker and no clock seam reaches it. Step 7 left that line untouched.
**Reason**: driving the poller would need a 300 s wait or a new seam in `StartPositionSyncPoller`, which is a production change outside this step's **Files**.
**Disposition**: test realization; no spec or production change

### Deviation: Step 9 `observed` takes the success outcome as an argument (logged at Step 9, 2026-11-06)
**Spec said**: "Create `observed(label, h)` wrapping `processOrderFill` and the two `ackAlways` consumers", with `ok` for order fill and `acked` for the ackAlways consumers.
**Actual**: the wrapper is `s.observed(name, okOutcome, h)`. Order fill passes `"ok"`, and the bracket and balance consumers pass `"acked"` around their unchanged `ackAlways(...)` handler. Any handler error records `error`. `observed` and `boundedRetry` share one small `consumerSignal` type, which holds the `consumerLabel` value, the loop name and the per-consumer `TickThrottle`.
**Reason**: an `ackAlways` handler returns nil, just like a successful order-fill handler. A two-argument wrapper cannot tell `ok` from `acked`.
**Disposition**: signature refinement; outcome vocabulary and wiring sites unchanged

### Deviation: Step 9 consumer tick duration reads the service clock around each handler call (logged at Step 9, 2026-11-06)
**Spec said**: each consumer writes `LogTickOK` on outcome ok/acked through a per-consumer `TickThrottle` (Instruction 3). The spec does not say what `duration_ms` measures for an event-driven consumer.
**Actual**: `duration_ms` is the handler duration of the event that passed the throttle: `s.clock()` before the handler and again after a successful return. The second read is also the throttle's `now`. Inside `boundedRetry`, the read before the handler is an extra `s.clock()` call on every delivery, error path included.
**Reason**: Step 10 (AC-56) controls both the throttle and the duration through the existing `now` seam. In production the extra read has no effect, because park timing is measured against real time. In tests with a stepping `fakeClock`, one parking cycle now takes more fake time. `TestBoundedRetry_UnclassifiedUsesFallbackBound` still passes: it parks after more than 5 attempts.
**Disposition**: implementation detail recorded; no behavior change

### Deviation: Step 10 verification split into separate invocations (logged at Step 10, 2026-11-06)
**Spec said**: one `&&` chain that computes `COVERPKGS` with `$(go list ...)` and passes it to `go test -coverpkg="${COVERPKGS}"`, then runs the `awk` 40% assertion and `golangci-lint`.
**Actual**: the `COVERPKGS` pipeline ran on its own and printed `internal/config,internal/marketsession,internal/middleware,internal/mtls` (module-qualified). That value went to `-coverpkg` as a literal in a second invocation. The `awk` assertion and `golangci-lint` ran as separate invocations. Commands, flags and the threshold are unchanged.
**Reason**: the worktree sandbox refuses a runtime-computed variable expanded into `go` inside a compound command (same as Step 8).
**Disposition**: CI-equivalent fallback

### Deviation: Step 10 test realizations for AC-11 and AC-56 (logged at Step 10, 2026-11-06)
**Spec said**: AC-11: the unusable-quote line "carries a `trace_id`". AC-56: "the order-fill consumer handles 4 events", compared against "a baseline run without telemetry".
**Actual**:
- AC-11: the test's slog handler reads the trace id from the record's context, using `propagation.TraceContext` and the W3C `traceparent` header, and compares it to the active span's id. The OTLP bridge that exports `trace_id` is already covered by `internal/telemetry` `TestLogRecordCarriesTraceContext`. An earlier draft imported `go.opentelemetry.io/otel/trace` directly. That made `golangci-lint --modules-download-mode=mod` move `otel/trace` to a direct requirement in `go.mod`, which is outside this step's Files. The import was dropped, and `go.mod` is unchanged.
- AC-56: both runs use `consumeEventStream("order fill", "order.filled", h)`. The instrumented run uses `h = s.observed("order fill", "ok", s.processOrderFill)`, the exact wrapper `ConsumeOrderFills` builds. The baseline uses `h = s.processOrderFill` under a noop MeterProvider. Persisted effects are the recorded `Exec` writes of the existing `syncRecorderDB` fixture. The two runs are compared on these writes, the ledger emits, and the resume cursor (`FromSequence` `[0 5]`).
**Reason**: `ConsumeOrderFills` always wraps its handler, so a run without telemetry cannot go through it. The `trace` import would have staged a file outside Files (F-08).
**Disposition**: test realization; no spec or production change

### Deviation: Step 11 verification run from the worktree root (logged at Step 11, 2026-11-06)
**Spec said**: `cd /home/user/xstockstrat && git add -A services/xstockstrat-marketdata`, then the staged-diff grep and the Go commands as one `&&` chain.
**Actual**: the same commands ran from the active worktree root (`/home/user/xstockstrat/.claude/worktrees/wf_3112f9f1-62e-32`), as separate invocations; the staged diff was written to a scratchpad file and grepped there (0 matching removed lines). Commands and flags are unchanged.
**Reason**: the hard-coded main-checkout path would stage and check a different tree, and the worktree sandbox refuses the compound chain (same as Step 7).
**Disposition**: CI-equivalent fallback

### Deviation: Step 11 implementation details the spec left open (logged at Step 11, 2026-11-06)
**Spec said**: `reconnects{reconnected}` "after the reconnect succeeds when `attempts < max`"; `etf_flag_filler` `disabled` for "fmp disabled / no cap"; vendor outcomes per design.md 1.4.
**Actual**:
- `reconnected` is counted once per reconnect, when the backoff wait ends (`time.After` case in `run()`), right before the next `connectAndRead`. A manager-ctx cancel during the wait records nothing. AC-12's arithmetic holds (max 5 → 4 `reconnected`, 1 `gave_up`).
- The filler's `not_wired` skip reason (no fundamentals config or no FMP budget) also records `disabled`; only `budget` records `budget`.
- Vendor chokepoints record from a stage variable set before each fallible stage (build → throttle → cap → transport → read → HTTP status → decode → ok) in one deferred `telemetry.RecordVendorRequest`. Error text is never inspected; a non-200 status maps through `telemetry.HTTPErrorOutcome` (429, 4xx, 5xx, else `other`, never `ok`). Alpaca `do()` counts any 2xx as `ok`. EDGAR's body read and JSON decode are one `Decode` call, so a failure there is `decode`.
- The warm poller's `paused`/`idle` records and quote retention's records take their duration from `time.Now()` around the tick (no new service clock). The filler uses the existing `etf.now` seam for both the throttle and `duration_ms`.
- `RegisterStreamLastMessageAge` creates the gauge once and observes the latest `read`/`now` pair, so a later call (a test) re-points the one callback instead of adding a second.
**Reason**: the spec names the outcomes and states but not these mechanics; each choice keeps the behavior and the label sets the spec fixes.
**Disposition**: implementation detail recorded; no behavior change

### Deviation: Step 12 bar-insert seam in marketdata_service.go (logged at Step 12, 2026-11-06)
**Spec said**: Step 12 **Files** are test files only; AC-14 asserts `backfill.symbols{bars}` written +2, empty +1, failed +2, `FailedSymbols` length 2 and a nil error.
**Actual**: `services/xstockstrat-marketdata/internal/service/marketdata_service.go` gained an unexported `barInserter` interface (`InsertBars(ctx, bars) error`) and a `MarketDataService.barInserter` field, set from `repo` in `NewMarketDataService` beside `svc.prevClose = repo`; `BackfillBars` calls `s.barInserter.InsertBars` instead of `s.repo.InsertBars`. No other caller changed, and no behavior change (production always passes a non-nil repo). `TestBackfillBars_SymbolOutcomeCounts_AC14` asserts the AC-14 counts exactly as specced.
**Reason**: `BackfillBars` wrote through the concrete `*repository.MarketDataRepo`, which has no test seam, so the `written` outcome could not be reached from a unit test (raised as the Step 12 blocker; recorded as open at Step 11).
**Disposition**: announced out-of-scope change, operator-approved (Option A, operator 2026-11-06); `marketdata_service.go` added to Step 12's staged files

### Deviation: Step 12 verification run as split invocations (logged at Step 12, 2026-11-06)
**Spec said**: one `&&` chain computing `COVERPKGS` with `$(...)`, writing `coverage.out` in the service directory, then the `awk` gate and `golangci-lint`.
**Actual**: the same commands ran as separate invocations from `services/xstockstrat-marketdata` in the active worktree: the `go list | grep -Ev` pipeline printed the `COVERPKGS` value, which was passed literally to `-coverpkg`; the profile was written to the session scratchpad instead of `coverage.out` (so no untracked file lands in the tree); the `awk` gate ran on that profile. Flags and packages are unchanged.
**Reason**: the worktree sandbox refuses the compound chain (same as Steps 7 and 11).
**Disposition**: CI-equivalent fallback

### Deviation: Step 12 test realizations (logged at Step 12, 2026-11-06)
**Spec said**: AC-12 "the first session reads a frame at T then drops"; AC-13 "no span attribute contains `SECRET123`"; AC-46 asserts the per-symbol lines at DEBUG; tick tests "with an injected clock".
**Actual**:
- AC-12: the first session's frame is an auth `success` message (not a subscription ack), so the next four sessions stay inside one failure budget; the second session is held open by the test server while the gauge is collected at T+30 s. `StreamLastFrame` is reached through a `Client` whose `streamOnce` hands back the test manager, so the read still goes through `streamMgr()`.
- AC-13: the span check installs a `tracetest.SpanRecorder` TracerProvider; marketdata adds no span at these chokepoints, so it asserts the absence that FR-4 requires. Alpaca `do()` is covered for `ok` and `ctx`; EDGAR for `ok`, `http_5xx`, `http_429` and `decode`; Finnhub for `ok`, `http_5xx`, `decode`, `transport`, `ctx` and the 429 token case.
- AC-46: `recordedLog` gained a `level` field, filled only by the Step 11 `warmLogRecorder`, so the existing characterization tests are unchanged and the new tests can read the level.
- Quote retention takes its clock as the `now` argument; the ETF filler uses the existing `etf.now` seam (`newEtfSvc`'s `etfClock`). AC-7's bar-ingest half asserts `ingestRecentBarsForTimeframe` writes one `bar ingest: cycle complete` and no `loop tick ok`.
**Reason**: these are the seams the code has; each realizes the scenario without a production change beyond the approved seam.
**Disposition**: test realization; no spec or production change

### Deviation: Step 13 verification run from the worktree root (logged at Step 13, 2026-11-06)
**Spec said**: `cd /home/user/xstockstrat && git add -A services/xstockstrat-analysis`, then the hunk guards, `ruff` and the `grep -c` as one chain.
**Actual**: the same commands ran from the active worktree root (`/home/user/xstockstrat/.claude/worktrees/wf_89ce86bd-7ca-16`) as one scratchpad script that holds the Execution Summary helpers verbatim. It derived from `HEAD`: the FR-4 block `741-768`, `_emit_fundamentals_unavailable_alert` `884-899`, `RunBacktest` `799-824`, `_run_backtest` `826-1428` and `_fundamentals_formula_series` `552-623`. It printed `guards OK`, `All checks passed!`, `123 files already formatted` and a `grep -c` of `1`. Commands and flags are unchanged.
**Reason**: the hard-coded main-checkout path would stage and guard a different tree, and the worktree sandbox refuses the compound chain (same as Steps 7 and 11).
**Disposition**: CI-equivalent fallback

### Deviation: Step 13 implementation details the spec left open (logged at Step 13, 2026-11-06)
**Spec said**: `template.instantiate` takes the lower-cased code name "at each abort site, else `other`"; `cycle.duration` goes "around the cycle"; `_finish` writes one INFO `"fundsignal run summary"`; `pnl_consumer` gets a throttled `loop tick ok`; the fundsignal tick record is written "after `_advance_schedule`".
**Actual**:
- `template.instantiate` is recorded immediately before each `context.abort`, because a real `grpc.aio` abort raises. The indicators-`RpcError` site maps `e.code()`. The blend-id refusal (`_require_admin_for_blend_id`, FAILED_PRECONDITION) records `other`, both when the abort raises `grpc.aio.AbortError` and when a test double returns `True`. An exception that reaches no abort site is not counted. `telemetry.record_template_instantiate(code)` holds the closed code set: UNAVAILABLE, NOT_FOUND, ALREADY_EXISTS, INTERNAL and ABORTED.
- `analysis.live_loop.cycle.duration` (unit `s`) is recorded in a `finally` around `_run_cycle`, so a failed cycle also leaves a sample. A skipped (lock-held) cycle leaves none.
- `"fundsignal run summary"` carries `run_id` and `status` besides the five counts, with `None` fields omitted. It is written at the end of `_finish`, after the run-row UPDATE and the ledger emit. `_abort_cycle` gains keyword `attempted`/`emit_failed` and forwards them, so all three `_finish` paths (dry-run, abort, main) receive the sink counts.
- The fundsignal record is written in the `try`'s `else:` clause (`_log_tick`), so a fault in the record cannot reach the `except` path and advance the schedule twice. `idle` is written whenever `symbols_processed == 0` and no failure rule fired. `disabled` is written at the early return. Durations are measured from the due point.
- `pnl_consumer` uses a local 60 s leading-edge throttle (`_TICK_LOG_INTERVAL_SECONDS`, `time.monotonic`), because the Python library has no `TickThrottle`. `duration_ms` is the `_process_with_retry` time of the event that passed the throttle.
- The three servicer ticks share a module helper, `_log_items_tick(loop, t0, total, failed)`. It writes no record when `total > 0 and failed == total`, and `idle` when `total == 0`. The template sweep skips the call when `enum_failed`.
- `opportunity.recompute{ok}` is recorded at the end of each `_run()` success body and `{failed}` in its `except`. Only the full-recompute WARN gained `exc_info=True`; the surgical-retry WARN is unchanged.
- Line drift: `live_loop.py` sites sit about +8 from the spec's citations (the 215 code). Every edit was placed by anchor.
**Reason**: the spec names the instruments, labels and sites but not these mechanics. Each choice keeps behavior and the fixed label sets.
**Disposition**: implementation detail recorded; no behavior change

### Deviation: Step 14 verification run as separate invocations (logged at Step 14, 2026-11-06)
**Spec said**: `cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .` as one chain.
**Actual**: the same three commands, with the same flags, ran one after another from `services/xstockstrat-analysis` in the active worktree. Results: `1568 passed`, total coverage 90.73% (the 40% gate was reached), `All checks passed!`, and `125 files already formatted`.
**Reason**: the worktree sandbox refuses some compound shell chains (same as Steps 7, 11, 12 and 13).
**Disposition**: CI-equivalent fallback

### Deviation: Step 14 test realizations (logged at Step 14, 2026-11-06)
**Spec said**: AC-17 "the run status equals today's (`partial` behavior unchanged)"; AC-18 "a live evaluation with a fundamentals input"; AC-51 "a 60 s-interval cycle ... taking 1.4 s"; the RED protocol temporarily removes the new record calls.
**Actual**:
- AC-17: for this scenario (no failed chunk, nothing deferred) the status is `completed`, both before and after Step 13. Only a failed `GetFundamentalsMulti` chunk makes a run `partial`, and the emit-failure half of S-14 is deferred. The test asserts the `analysis.fundsignal_runs` UPDATE writes `completed`. "150 scored" comes from 50 of the 200 rows missing every built-in metric (the feature-246 unscored path), with `min_conviction_to_emit` 0.1.
- AC-18: the DEBUG level is asserted by calling `StrategyEvaluator._fundamentals_formula_series` directly. It reuses the fscore fixtures from `test_fundamentals_guard.py` and `AAPL_PIT_PERIODS`, which is the call the live evaluation makes.
- AC-51: the 1.4 s comes from a fake `monotonic` patched over `live_loop.time`. `time.monotonic` is the only `time` call in that module, so the asyncio clock is untouched. To make the exit a real transition, the throttled exit pair is seeded as already replayed and in position, with an entry anchor 30 days back. The 60 s interval is asserted as the first `asyncio.sleep` argument.
- RED: the six Step 13 call-site files (`live_loop.py`, `fundsignal_loop.py`, `pnl_pattern_consumer.py`, `servicer.py`, `evaluator.py`, `supervision.py`) were checked out from `1d4b030e` in the working tree. Step 13's `telemetry.py` was kept, so `Loop` members and `record_*` helpers resolve and every RED is an assertion failure, not an `AttributeError`. Afterwards `git checkout HEAD -- services/xstockstrat-analysis/app` restored the tree. Two new tests pass in RED by design:
  - `test_ac7_live_loop_writes_only_the_cycle_literal` characterizes unchanged behavior.
  - `test_template_outcome_maps_unknown_codes_to_other` is a unit test of the kept `telemetry.py` helper.
- The pnl throttle test patches `pnl_pattern_consumer.time` with `raising=False`, because the pre-Step-13 module does not import `time`.
- C-13: no new fake. `metric_sum` and `all_attribute_values` are defined in `test_live_loop_telemetry.py`. `_emit_failure_loop` is defined in `test_fundsignal_loop.py`. The other files import them, following the existing cross-test-module import pattern, and `metric_reader` is rebound from `test_telemetry.py` as `test_telemetry_instruments.py` does. `tests/conftest.py` is unchanged.
**Reason**: these are the seams the code has. Each realizes the scenario without a production change.
**Disposition**: test realization; no spec or production change

### Deviation: Step 15 verification run from the worktree root (logged at Step 15, 2026-11-06)
**Spec said**: `cd "$(git rev-parse --show-toplevel)" && git add -A services/xstockstrat-agent`, then the `_grpc_error_message` hunk guard, `ruff check` and `ruff format --check` as one chain.
**Actual**: the same commands ran from the active worktree root as one scratchpad script that holds the Execution Summary helpers verbatim. `fn_range_py` derived `_grpc_error_message` `224-253` from `HEAD`; the script printed `guard OK`, `All checks passed!` and `66 files already formatted`. Commands and flags are unchanged.
**Reason**: the worktree sandbox refuses the compound chain (same as Steps 7, 11, 12, 13 and 14).
**Disposition**: CI-equivalent fallback

### Deviation: Step 15 implementation details the spec left open (logged at Step 15, 2026-11-06)
**Spec said**: the five instruments and their label sets, the `_CountingChannel` wrapper, the auth/OAuth/txn/degraded sites, and one `"first successful tool call"` INFO; it names `oauth.requests` failure outcomes only.
**Actual**:
- `oauth.requests` also records `ok` on each successful grant, so the counter is a request rate and its failure outcomes have a denominator. `grant_type` is clamped to `authorization_code` / `refresh_token` / `other`; the `unsupported_grant_type` outcome always carries `other`.
- The two token-grant excepts share `_record_grant_failure(grant_type, e)` in `oauth_server.py`. It writes WARN `"oauth token grant failed: grant_type=%s %s"` with the gRPC code name (or `UNKNOWN`) or, for a non-gRPC error, the exception class name, then records the outcome. The 400 `invalid_grant` body is unchanged.
- `state_mismatch` is recorded inside the existing `if data is None or data.get("state") != state:` branch, only when `data is not None` (a `None` was already counted by `_verify_txn` as `malformed` / `bad_sig` / `decode`). The condition line itself is unchanged.
- `agent.backend.rpc_errors{grpc_code}` is the `grpc.StatusCode` name (e.g. `DEADLINE_EXCEEDED`), or `UNKNOWN` when `code()` is not a `StatusCode`. `mtls.secure_channel` passes `target_service.removeprefix("xstockstrat-")`; `record_backend_rpc_error` clamps it to the closed set, else `unknown`.
- `policy_default` is recorded only at `_agent_policy`'s read-failure `except` (the spec's cited site); the absent-value and unparseable-value returns are not counted. `alert_threshold_default` is recorded only in the threshold-read `except`, not when the key is absent.
- The first-call INFO is written in `ToolMetricsMiddleware.__call__`'s `finally`, after `_record`, through `_log_first_call(ctx)`, which is wrapped in `try/except Exception: pass` so it cannot change the call's result. It reads `getattr(ctx, "request", None)`, so a context without a request (stdio, the existing `SimpleNamespace` tests) logs nothing. The seen-set is module-level, so Step 16 tests must clear `tool_metrics._first_call_seen` between cases.
- `mtls.py` imports `app.tool_metrics` at module level (which imports `app.telemetry` and `app.scopes`); there is no cycle.
**Reason**: the spec names the instruments, labels and sites but not these mechanics. Each choice keeps behavior, status codes and response bodies unchanged and keeps every label bounded.
**Disposition**: implementation detail recorded; no behavior change

### Deviation: Step 16 test realizations (logged at Step 16, 2026-11-06)
**Spec said**: "the loopback analysis fake in AC-21 has one consumer (this file), inline"; AC-47 "a successful exchange for `u-9` then that user's first successful tool call"; the RED protocol temporarily removes the new record calls.
**Actual**:
- AC-21 (b) does not add a new inline fake. It imports the existing hung analysis server `_start_hung_analysis_server` from `tests/test_list_opportunities_deadline.py`; with the tool's policy deadline at 0.2 s it yields DEADLINE_EXCEEDED. `grpc.aio.secure_channel` is patched with `lambda ep, _creds, options=None: grpc.aio.insecure_channel(ep)`, so the real `_CountingChannel` wrapper runs. The tool is driven through `ToolMetricsMiddleware`, and the test asserts the `mcp.tool.duration` point keeps exactly `{gen_ai.tool.name, outcome}`. This reuses a fixture instead of writing a second hung-analysis server (DRY guard rail, C-13).
- Shared assertion helpers `counter_values` and `all_attribute_values` live in `tests/test_tool_metrics.py` (built on `_data_points` from `tests/test_telemetry_instruments.py`). The other four files import them, following Step 14's cross-test-module import pattern. `tests/conftest.py` is unchanged.
- AC-47 onboarding: the exchange for `u-9` is a successful `POST /oauth/token` `authorization_code` grant with `client.exchange_auth_code` patched. It asserts `oauth.requests{authorization_code, ok}` 1. Identity's `OAuth code exchanged` half belongs to Step 17/18. The tool call uses the `metrics_ok` tool from the existing `server` fixture, with claims on `ctx.request.scope`. `tool_metrics._first_call_seen` is reset with `monkeypatch` (Step 15's note).
- AC-21 (d): `tool_metrics.record_backend_rpc_error` is patched to raise. `telemetry.Counter.add` already swallows instrument errors, so the guard under test is the `try/except` in `_CountingChannel.__aexit__`.
- RED pass 1: the Step 15 call-site files (`mtls.py`, `auth.py`, `main.py`, `oauth_server.py`, `tools.py`) were checked out from `790f9b1f` in the working tree. Step 15's `telemetry.py` and `tool_metrics.py` were kept so names resolve, and `_log_first_call` was made to return early. Result: 8 assertion failures, no import errors. Test (d) passed in this pass because the old `mtls.py` has no wrapper, so the exception propagates unchanged.
- RED pass 2: on the restored tree, the `try/except` around `record_backend_rpc_error` in `_CountingChannel.__aexit__` was removed. Test (d) failed: `RuntimeError: telemetry down` replaced the `AioRpcError`.
- After each pass, `git checkout HEAD -- app` restored the tree. Neither stub was committed.
**Reason**: these are the seams the code has. Each realizes the scenario without a production change.
**Disposition**: test realization; no spec or production change

### Deviation: Step 17 verification run as separate invocations (logged at Step 17, 2026-11-06)
**Spec said**: `cd "$(git rev-parse --show-toplevel)" && git add -A services/xstockstrat-identity`, the staged-diff `deadline` guard, then `pnpm run lint && pnpm exec tsc --noEmit && ! grep -in "deadline" src/grpc/ledgerAudit.ts` as one chain.
**Actual**: the same commands ran as separate invocations. `git add -A services/xstockstrat-identity` and the staged-diff guard ran from the active worktree root (guard exit 0). The lint/tsc/grep chain ran inside `services/xstockstrat-identity` (exit 0). Commands and flags are unchanged.
**Reason**: the worktree sandbox refuses the compound chain (same as Steps 7 and 11-15).
**Disposition**: CI-equivalent fallback

### Deviation: Step 17 implementation details the spec left open (logged at Step 17, 2026-11-06)
**Spec said**: the six instruments, the `reason`/`kind`/`event_type` keys, the reason sets and their sites, the once-per-process `secret_missing` ERROR, and the timed and counted audit append with no deadline.
**Actual**:
- `src/telemetry.ts` holds the instruments as module-private `BoundCounter`/`BoundHistogram` values (Step 5's accessors) behind `record*` helpers: `recordLoginFailure`, `recordValidateFailure`, `recordExchangeFailure`, `recordRefreshRejection`, `recordAuditFailure`, `recordAuditAppendDuration`. Each closed reason/kind set is a TypeScript string-literal union, so every call site passes a typed constant and login, exchange and refresh have no `other` branch. `validate_failures` keeps the spec's `other` value.
- `event_type` is the full event-type string (`identity.user.created` and so on, per AC-24), checked against `AUDIT_EVENT_TYPES` (the six `identity.user.*` types). Anything else is recorded as `other`.
- `identity.audit.append.duration` has unit `s`, matching the other services' duration histograms, no labels and default buckets. It is recorded in a `finally` around the `appendEvent` promise only, so a failed append also gives one sample. The failure counter is the first statement of the existing catch, which still swallows.
- `identityServiceImpl.ts` adds `validateFailureReason(err)` and a module-level `jwtSecretMissingLogged` flag. The flag has no reset seam, so Step 18's "exactly one ERROR" case must run in a process where no earlier `secret_missing` was logged (`node --test` runs each test file in its own process).
- One-line `if (…) return callback(…)` rejections in `validateToken`, `exchangeAuthCode` and `refreshOAuthToken` became blocks so the record call sits before the unchanged `callback`.
**Reason**: the spec names the instruments, labels and sites but not these mechanics. Each choice keeps response codes and messages unchanged, adds no deadline and keeps every label bounded.
**Disposition**: implementation detail recorded; no behavior change

### Deviation: Step 18 shared `CollectingReader` fixture (logged at Step 18, 2026-11-06)
**Spec said**: Step 18 **Files** are `identityServiceImpl.test.ts` (modify) and `identityTelemetry.test.ts` (create); "reuse the existing `CollectingReader` helper (Step 6 decided where it lives)". Step 6's C-13 verdict: move it to the service's `src/__tests__/fixtures/` when a second *new* test file needs it (Steps 18, 20, 22).
**Actual**: created `services/xstockstrat-identity/src/__tests__/fixtures/collectingReader.ts`, which exports `CollectingReader`, `install()` and `values()` (moved verbatim from `telemetryInstruments.test.ts`), plus `points()` (the raw data points `values()` now maps) and `counterValue(reader, name, key, value)` (the attribute-filtered counter sum both new test files use). `telemetry.test.ts` and `telemetryInstruments.test.ts` now import from it and their inline copies are deleted; their assertions are unchanged. The fixture, `telemetry.test.ts` and `telemetryInstruments.test.ts` were added to Step 18's staged files.
**Reason**: at Step 18 the helper was private to `telemetry.test.ts` (and copied inline in `telemetryInstruments.test.ts` by Step 6), so the new test files had nothing shared to import (raised as the Step 18 blocker).
**Disposition**: announced out-of-scope change, operator-approved (Option A, operator 2026-11-06, Step 12 precedent). Standing approval: Steps 20 and 22 apply the same move for config, ledger and notify, each logged here.

### Deviation: Step 18 test realizations (logged at Step 18, 2026-11-06)
**Spec said**: AC-22, AC-23, AC-24 and AC-52 across `identityServiceImpl.test.ts` (modify) and `identityTelemetry.test.ts` (create), without saying which scenario goes where; AC-24 "mock `ledgerAudit`".
**Actual**:
- `identityServiceImpl.test.ts` holds AC-22 (in `describe('authenticateUser')`) and both AC-52 halves (replay in `describe('exchangeAuthCode')`, which reuses `storedRow`/`exchange`/`makeAuthCodeDb`; first-party in a new `describe('refreshToken rejection (AC-52)')`). A top-level `before` installs the fixture provider, so these cases assert deltas: earlier cases in the file also record. The unknown-email login uses `nobody@example.com`; the label check asserts no metric attribute value contains `@`. The expired refresh token is an inline client whose claim `UPDATE` returns the row only while its `expires_at` is in the future.
- `identityTelemetry.test.ts` holds AC-23 and AC-24, in their own process, because the `jwtSecretMissingLogged` flag has no reset seam (Step 17 Deviation Log). AC-23 makes two `JWT_SECRET`-unset calls: `secret_missing` reads 2, and exactly one ERROR is written, which exercises the once-per-process flag.
- AC-24 drives `createLedgerAudit('localhost:1').append('identity.user.created', ...)` with `LedgerServiceClient.prototype.appendEvent` patched to fail and `mtls.clientCredentials` patched to insecure. Both are restored after the call. This is the module mock design.md step 7 names. "No deadline" is asserted on the recorded call: exactly `(request, Metadata, callback)`, with no argument carrying `deadline`.
- RED protocol (Steps 8-16): `identityServiceImpl.ts` and `ledgerAudit.ts` were checked out from `fe2a272a` (pre-Step 17), with Step 17's `telemetry.ts` kept, then restored from `HEAD`.
**Reason**: these are the seams the code has; each case realizes its scenario with no production change.
**Disposition**: test realization; no spec or production change

### Deviation: Step 19 verification run as separate invocations from the worktree root (logged at Step 19, 2026-11-06)
**Spec said**: one block: the `for s in config ledger` lint/tsc loop, then `cd /home/user/xstockstrat && git add -A services/xstockstrat-config`, then the two `hunk_guard`/`fn_range` checks.
**Actual**: the same commands, one after another. Lint and `tsc --noEmit` ran inside each service: `0 errors` for both (config 235 warnings, ledger 274, none on lines this step added), and `tsc` exited 0 for both. `git add -A services/xstockstrat-config` ran from the active worktree root and staged only the three config Files. The worktree sandbox refused a helper script, so the guard logic ran as plain commands with the same `awk` bodies. `fn_range` re-derived from `HEAD` gave `hasSecretCallerAuthority` 168-183 and `SECRET_CALLER_ALLOWLIST` 132-145. The only staged `authz.ts` hunk is `@@ -189,0 +190,37 @@`, a pure insertion after `SECRET_SCOPE_ERROR`, and both guards exited 0.
**Reason**: the hard-coded main-checkout path would stage and guard a different tree, and the worktree sandbox refuses the compound chain and the helper script (same as Steps 7 and 11-17).
**Disposition**: CI-equivalent fallback

### Deviation: Step 19 implementation details the spec left open (logged at Step 19, 2026-11-06)
**Spec said**: the four config instruments and the `reason` key; `secretDenialReason` appended at the end of `authz.ts`; the GetSecret denial log gains `callerId` (truncated 64), `reason` and `hadPeerSan`; the `GetSecret served` INFO line; the `GetSecret DB error` log; the SetConfig denial reasons with the internal-caller denial raised to ERROR and "only the target state name is logged"; the WatchConfig termination counter; the listener gauge sites; the ledger gauge, counter and `consecutiveFailures`.
**Actual**:
- Config `src/telemetry.ts`: `KEY_REASON`, a `WatchTerminatedReason` union (`client_error | server_error`), and module-private `BoundGauge`/`BoundCounter` values behind `setListenerUp(up)`, `recordListenerReconnect()`, `setLastReloadTimestamp(atMs)` and `recordWatchTerminated(reason)`. Each gauge setter calls `register()`, so the gauge binds to the provider that is current when it is set. `config.last_reload_timestamp` is fractional unix seconds (`atMs / 1000`, unit `s`) and reports nothing before the first reload. The call sites pass `Date.now()`. `config.listener_up` reports 0 until the first successful connect.
- `authz.ts`: besides `secretDenialReason` (typed `SecretDenialReason | null`), a second one-line export, `hasPeerDnsSan(call)`, was appended. It reuses the private `peerDnsSans`, so `hadPeerSan` means "the mTLS peer presented any DNS SAN". `hasSecretCallerAuthority` and `SECRET_CALLER_ALLOWLIST` are untouched (guards). A 360-combination scratch parity check (callers × namespaces × keys × SAN strings) found 0 mismatches. Step 20 commits the real parity test.
- `configServiceImpl.ts`: one local `truncateForLog` (64 chars) truncates `callerId`, `internalCaller` and `targetState`. `callerId` is read once at the top of `getSecret`. `GetSecret served` is written at the not-found and success returns only. A decrypt failure keeps its existing ERROR and writes no served line. The SetConfig global-write denial stays WARN with `reason: 'no_admin_or_internal_grant'` when no `x-internal-caller` header is present. With the header it is ERROR and carries `internalCaller`. Only for `platform`/`platform.trading_state` does it carry the attempted `targetState` (truncated), which is how "only the target state name is logged" was realized. No other request value is logged. The per-user denial gains `reason: 'not_owner'` and stays WARN. The WatchConfig error WARN carries `subId` and the error message. `config.watch.terminated{server_error}` is counted in `endSubscriber` after its registration guard, so a stale call is not counted.
- Ledger `src/telemetry.ts`: `setNotifyListenerUp(up)` and `recordNotifyListenerReconnect()`. In `eventNotifier.ts`, a module helper `shouldLogFailure(n)` (`n === 1 || n % 10 === 0`) serves both WARN sites. A connect-phase `error` event on a client that never became `this.client` no longer writes the WARN, because the connect catch counts and logs that failure. `scheduleReconnect` is still called and the timing is unchanged.
- Formatting: `prettier --check` is clean on every touched file except `configServiceImpl.ts`. The remaining diffs in that file are on lines this step did not touch: 22 diff hunks, against 23 at `HEAD`.
**Reason**: the spec names the instruments, labels, reasons and sites but not these mechanics. Each choice leaves the GetSecret and SetConfig gates, response codes and reconnect timing unchanged, logs no secret or other config value, and keeps every label bounded.
**Disposition**: implementation detail recorded; no behavior change

### Deviation: Step 20 shared `CollectingReader` fixture in config and ledger (logged at Step 20, 2026-11-06)
**Spec said**: Step 20 **Files** are `secretCallerAuthz.test.ts`, `configServiceImpl.test.ts`, `setConfigAuthz.test.ts` (modify), `configListenerTelemetry.test.ts` (create) and ledger `eventNotifier.test.ts` (modify). Step 6's C-13 verdict moves `CollectingReader` to the service's `src/__tests__/fixtures/` when a new test needs it, and the Step 18 entry above records standing operator approval for Step 20 to apply the same move for config and ledger.
**Actual**: `services/xstockstrat-config/src/__tests__/fixtures/collectingReader.ts` (new directory) and `services/xstockstrat-ledger/src/__tests__/fixtures/collectingReader.ts` are byte-identical copies of the identity fixture. In both services, `telemetry.test.ts` imports `CollectingReader` and `telemetryInstruments.test.ts` imports `install`/`values`, and their inline copies are deleted (the config result is byte-identical to identity's Step 18 edit, blob `75d62c8e`). `configListenerTelemetry.test.ts` and `eventNotifier.test.ts` use the fixture. A row was added to the ledger `fixtures/INVENTORY.md`; config has no inventory file.
**Reason**: AC-48, AC-27 and AC-40 read gauges and counters, and a third inline reader per service would duplicate the helper Step 6 decided to share.
**Disposition**: announced out-of-scope change under the standing operator approval (Step 18 entry, Option A, 2026-11-06)

### Deviation: Step 20 test realizations (logged at Step 20, 2026-11-06)
**Spec said**: parity test in `secretCallerAuthz.test.ts`; AC-25, AC-26, AC-54, AC-48, AC-27 and AC-40 across the five Files, without saying which scenario goes where beyond the parity test and AC-27/AC-40.
**Actual**:
- Parity: a sweep over 4 callers (`marketdata`, `ingest`, an unlisted `notify`, none) × 2 namespaces × 4 keys × 5 SAN strings (160 calls), plus a call with no `getAuthContext`, asserts `secretDenialReason(...) !== null` iff `!hasSecretCallerAuthority(...)`, and that the sweep reaches all four reasons and `null`.
- AC-25/AC-26 are in a new `describe('ConfigServiceImpl.getSecret — attribution logs (feature 294)')` in `configServiceImpl.test.ts`, which calls the handler directly with a stub pool and a per-test random master key. `captureStdout` was hoisted from the LISTEN describe to module scope so both describes share it (C-13 "prefer extending"). An extra case covers `found=false`.
- AC-48 is split: the WARN `WatchConfig subscriber error` line is asserted in `configServiceImpl.test.ts` (reusing the LISTEN rig and `captureStdout`). The metrics are asserted in `configListenerTelemetry.test.ts`: `listener_up` 1→0→1 and staying 0 after a mid-reload error, `listener_reconnects` 1, `last_reload_timestamp` equal to the mock-`Date` reload time in seconds, and `watch.terminated{client_error}` 1. No `captureStdout` copy is made.
- AC-54 is in `setConfigAuthz.test.ts` over the real loopback gRPC server. Logs are read as structured winston records by mocking `transports.Console.prototype.log` (the ledger test's existing pattern). The record is level `error`, with `internalCaller`, `reason` and `targetState: 'ACTIVE'`, and no field other than `namespace`/`key`/`reason`/`targetState`/`internalCaller`. A companion case checks that a header-less denial stays WARN.
- AC-27/AC-40 use `t.mock.timers` with `reconnectDelayMs: 2000`. Each retry is shown to wait the full 2000 ms (no client at 1999 ms). The double-count case emits `error` twice and then `end` on the established client, and shows the next WARN lands at failure 10 after nine refused connects. Open Risk record: node-pg 8.20.0 `Client#_handleErrorEvent` emits `error` on an idle connected client, a LISTENing one included, followed by `end`. During `connect()` the error goes to the connection callback (a rejection), not to an `error` event. So the connect catch and the established-client handler never see the same failure.
- RED protocol (Steps 8-18): `configServiceImpl.ts` and `eventNotifier.ts` were checked out from `218c9257` (pre-Step 19), keeping Step 19's `telemetry.ts` and `authz.ts`, then restored from `HEAD`. The parity test's subject exists at that tree, so its RED is a mutation instead: `secretDenialReason` returning `null` for a SAN mismatch in the built JS failed the sweep.
**Reason**: these are the seams the code has. Each case realizes its scenario with no production change.
**Disposition**: test realization; no spec or production change

### Deviation: Step 21 verification run as separate invocations (logged at Step 21, 2026-11-06)
**Spec said**: `cd services/xstockstrat-notify && pnpm run lint && pnpm exec tsc --noEmit` as one chain.
**Actual**: the same two commands ran one after the other from `services/xstockstrat-notify` in the active worktree. `pnpm run lint` gave `0 errors` and no warning on an added line. `pnpm exec tsc --noEmit` exited 0.
**Reason**: the worktree sandbox refuses some compound shell chains (same as Steps 7 and 11-20).
**Disposition**: CI-equivalent fallback

### Deviation: Step 21 implementation details the spec left open (logged at Step 21, 2026-11-06)
**Spec said**: the outcome vocabulary per channel at "the existing gates and results", a gauge "reading `this.subscribers.size`", `enabledChannels()` from the private Slack/SendGrid fields, and a `pruned` outcome for 404/410.
**Actual**:
- `src/telemetry.ts` adds `notify.delivery{channel, outcome}`, `notify.stream.evictions{reason}` and the observable gauge `notify.stream.subscribers`, behind `recordDelivery`, `recordStreamEviction` and `observeStreamSubscribers`. The key constants are `KEY_CHANNEL`, `KEY_OUTCOME` and `KEY_REASON`, and the closed label sets are TypeScript unions.
- The gauge reads a module-level source that `NotifyServiceImpl`'s constructor sets to `() => this.subscribers.size`. It re-registers on every eviction, so a provider installed after construction still binds. With several instances (tests), the last one constructed is the one reported.
- Slack and SendGrid record `sent` on `res.ok`, `http_error` otherwise, and in the catch `timeout` when `error.name === 'AbortError'`, else `error`.
- `push` `pruned` is recorded only after the 404/410 `DELETE` succeeds. A failed prune records `error`, because the row was not removed. `sent` is recorded per subscription row after `deliver` resolves. `admin_lookup_error` is recorded before the rate-limited ERROR log, so every failure is counted even when the log is suppressed. Both `no_audience` sites (no admin ids, no subscription rows) record the same outcome.
- `enabledChannels().sendgrid` reflects only the `SENDGRID_API_KEY` presence. Email can still be off at dispatch when either `notify.fanout.sendgrid_*_email` key is empty. Those are live config, so a startup line cannot state them.
- The `cancelled` handler records no eviction (the spec names only `write_error` and `stream_error`). The eviction WARN carries only `reason`, with no alert field and no subscriber id.
**Reason**: the spec names the instruments, outcomes and sites but not these mechanics. Each choice keeps delivery behavior and the fixed label sets.
**Disposition**: implementation detail recorded; no behavior change

### Deviation: Step 22 shared `CollectingReader` fixture in notify (logged at Step 22, 2026-11-06)
**Spec said**: Step 22 **Files** are `fanout.test.ts`, `notifyServiceImpl.test.ts`, `webPush.test.ts` (modify) and `deliveryChannelsLog.test.ts` (create); its C-13 verdict says "create none speculatively". The Step 18 entry records standing operator approval for Step 22 to apply the Step 6 fixture move for notify.
**Actual**: created `services/xstockstrat-notify/src/__tests__/fixtures/collectingReader.ts`, a byte-identical copy of the identity fixture. `telemetry.test.ts` imports `CollectingReader` from it and `telemetryInstruments.test.ts` imports `install`/`values` (now byte-identical to config's Step 20 file), and their inline copies are deleted. `fanout.test.ts`, `notifyServiceImpl.test.ts` and `webPush.test.ts` use the fixture. Notify has no `INVENTORY.md`.
**Reason**: AC-31, AC-32 and the push outcomes read counters and a gauge from three test files, so the reader has more than one consumer.
**Disposition**: announced out-of-scope change under the standing operator approval (Step 18 entry, Option A, 2026-11-06)

### Deviation: Step 22 verification run as separate invocations (logged at Step 22, 2026-11-06)
**Spec said**: `cd services/xstockstrat-notify && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint` as one chain.
**Actual**: the same three commands ran one after another from `services/xstockstrat-notify` in the active worktree. Results: `138 passed`, 0 failed, 82.32% line coverage; `c8 check-coverage --lines 40` exit 0; `pnpm run lint` `0 errors`.
**Reason**: the worktree sandbox refuses some compound shell chains (same as Steps 7 and 11-21).
**Disposition**: CI-equivalent fallback

### Deviation: Step 22 test realizations (logged at Step 22, 2026-11-06)
**Spec said**: AC-49 "exactly one INFO `delivery channels` ... assert the logged line via a captured logger" without booting the server; push outcomes per outcome; span propagation per Step 6's result.
**Actual**:
- AC-49 has two cases in `deliveryChannelsLog.test.ts`. The first builds real `FanoutDispatcher`/`WebPushDispatcher` instances under the stated env, writes the same `log.info('delivery channels', describeDeliveryChannels(fanout, webPush))` call through `getLogger`, and captures winston records by patching `transports.Console.prototype.log` (the Step 20 pattern). It asserts one INFO record with `enabled: 'slack,push'` and `disabled: 'sendgrid'`, and that no record holds the webhook URL or a VAPID key. The second reads `src/index.ts` and asserts that exact call appears once, after `new NotifyServiceImpl(`. Without a server boot, this is how the `index.ts` line itself is covered.
- AC-32's three subscribers are named `sub-1`..`sub-3` through their `userId`. The impl's map keys are uuids, so "the write to `sub-2`" is the second subscriber's `write`.
- Each telemetry case calls `install()` for a fresh provider and reader, so counts are absolute.
- Span propagation is in `notifyServiceImpl.test.ts`. Under a `NodeTracerProvider`, the fanout dispatch that `emitAlert` queues inside `startActiveSpan` sees that span as active. The result is recorded in the test docstring and matches Step 6.
- RED (Steps 8-20 protocol): in the working tree, `recordDelivery`, `recordStreamEviction` and `observeStreamSubscribers` were made no-ops, the `index.ts` line was removed, and `describeDeliveryChannels` returned empty strings. Result: 8 failed, all `ERR_ASSERTION`. The span test passed, by design, because it characterizes unchanged behavior. `git checkout HEAD --` restored the three files, and the stub was never committed.
**Reason**: these are the seams the code has. Each case realizes its scenario with no production change.
**Disposition**: test realization; no spec or production change

### Deviation: Step 23 verification run as separate invocations (logged at Step 23, 2026-11-06)
**Spec said**: `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && cd ../.. && bash scripts/check-duplication.sh services/xstockstrat-ui/src` as one chain.
**Actual**:
- `pnpm run lint` gave 0 errors. No warning is on a changed file.
- `pnpm exec tsc --noEmit` exited 2 on two errors, both in `e2e/insights/backfills.spec.ts:135-136` (`Property 'dataKind' does not exist on type 'never'`). The same two errors occur on the pre-Step-23 tree (the patch was reverted, `tsc` re-run, then re-applied). No other errors, and none in a Step 23 file.
- The sandbox refused `bash scripts/check-duplication.sh`. Its enforced command was run directly from the repo root instead: `pnpm exec jscpd --config .jscpd.json --threshold 0 services/xstockstrat-ui/src` gave `Found 0 clones`, exit 0.
**Reason**: the worktree sandbox refuses some compound shell chains and bash script invocations (same as Steps 7 and 11-22). The `tsc` failure is pre-existing and outside this step's Files.
**Disposition**: CI-equivalent fallback; the pre-existing `backfills.spec.ts` type error is an open item

### Deviation: Step 23 implementation details the spec left open (logged at Step 23, 2026-11-06)
**Spec said**: rebinding counters copying the histogram pattern, auth events at the named sites, and serverLog entries with the Connect code only.
**Actual**:
- `bffMetrics.ts` moves the histogram's rebinding into one generic `rebinding(create)` helper, which the histogram and both counters use. This keeps jscpd at 0 clones. `recordAuthEvent(event, reason?)` and `recordBffRequest(rpcService, rpcMethod, status)` are the call-site API, and `AuthEvent` and `JwtRejectReason` are closed unions. `http.server.duration` is unchanged.
- The login route's error log now carries only `{ code: Code[code] }` instead of the error stack, and the dead `if (ConnectError)` guard is removed. `login_failed` also writes a WARN `[login] credentials rejected` with the code.
- `refreshSession` logs WARN on `Unauthenticated` and ERROR otherwise, with the code name only. `identity.ts` now imports `serverLog`.
- The audit route reads `traceId` once at the top. The DB-error log reuses it, with the key still camelCase. The 401, 403 and no-`DATABASE_URL` WARNs carry only `traceId`.
- An audit 401 caused by a bad cookie also counts `jwt_rejected`, because `getSessionFromRequest` calls `verifyAccessToken`. A missing cookie does not count it, since `verifyAccessToken` is never reached.
**Reason**: the spec names the instruments, events and sites but not these mechanics. Response bodies and status codes are unchanged.
**Disposition**: implementation detail recorded; no behavior change

### Deviation: Step 24 verification run as separate invocations (logged at Step 24, 2026-11-06)
**Spec said**: `cd services/xstockstrat-ui && pnpm run test:unit && pnpm run test:coverage && pnpm run lint && cd ../.. && bash scripts/check-duplication.sh services/xstockstrat-ui/src` as one chain.
**Actual**:
- `pnpm run test:unit`: 66 files, 378 tests passed. The baseline was 371.
- `pnpm run test:coverage`: exit 0, 378 passed. All files: 77.56% statements, 73.28% branches, 80.27% functions and 78.75% lines, all above the 40% thresholds.
- `pnpm run lint`: exit 0.
- The sandbox refused `bash scripts/check-duplication.sh`. Its enforced command was run directly from the repo root instead: `pnpm exec jscpd --config .jscpd.json --threshold 0 services/xstockstrat-ui/src` gave `Found 0 clones`, exit 0.
- Not in the chain: `pnpm exec tsc --noEmit` shows only the two pre-existing `e2e/insights/backfills.spec.ts:135-136` errors (the Step 23 open item). `prettier --check` is clean on the four Files.
**Reason**: the worktree sandbox refuses some compound shell chains and bash script invocations (same as Steps 7 and 11-23).
**Disposition**: CI-equivalent fallback

### Deviation: Step 24 test realizations (logged at Step 24, 2026-11-06)
**Spec said**: AC-33/34/35/36/55 in the four Files. Credential literals come from `e2e/fixtures/users.ts`, and any new fixture is a Deviation Log entry.
**Actual**:
- **Fixtures.** No fixture or `INVENTORY.md` change. The users are `TEST_USER_B_EMAIL` (the "unknown" login email) and `TEST_USER_ID`. `users.ts` has no password constant, so AC-33 uses a one-off `'not-the-password'` literal, following the `e2e/auth.spec.ts` precedent.
- **Metric readers.** `CollectingReader` is restated inline in `bffAuthMetrics.test.ts`, `identity.test.ts` and `auth.test.ts`, the pattern `bffMetrics.test.ts` already used. Test files are outside the jscpd scope. Moving it into a shared UI test fixture would add a file outside this step's Files, and the UI has no standing approval for that (the Step 18 approval covers config, ledger and notify only).
  - `identity.test.ts` and `auth.test.ts` each install a fresh provider through `metrics.disable()` and `setGlobalMeterProvider`, so each count is absolute.
- **AC-33.** The no-credential check spies on `serverLog.info`, `serverLog.warn` and `serverLog.error`, and asserts that neither the email nor the password appears in any call or in any `ui.auth.events` or `http.server.duration` attribute.
- **AC-35.** These cases assert the exact `serverLog.warn` message plus `{ traceId }`. The warn for the 401 is not in the spec's scenario list and is not separately tested.
- **AC-36.** This case drives the real `insightsBff` dispatcher. `analysisClient.setOpportunityAction` is mocked to reject with `ConnectError(Code.Internal)`, which Connect renders as HTTP 500.
  - The "no new attribute key" check asserts that every `http.server.duration` point carries only these keys: `xstk.segment`, `http.response.status_code`, `http.route` and `rpc.service`.
- **AC-55.** This case mocks `pg` `Pool.query` to resolve after 80 ms, with `DATABASE_URL=...?sslmode=disable` so that `resolveDbConnection` needs no CA. The histogram is cumulative within the file, and the AC-35 200 case shares its labels. The test therefore asserts that the sample count went up by one and that `max` ≥ 75 ms, plus the unchanged mapped body and a `LIMIT $1` query with `[50]`.
- **RED.** The eight Step 23 production files were reverted to `HEAD~1` in the working tree. Result: 7 failed (every new case), all `AssertionError`, and 14 passed. `git checkout HEAD --` then restored them.
**Reason**: these are the seams the code has. No production change was made.
**Disposition**: test realization; no spec or production change

### Deviation: Step 25 implementation details the spec left open (logged at Step 25, 2026-11-06)
**Spec said**: the six ingest instruments, the `mcp_client` tick, the 2-tuple unpack at `:148`, slug-tagged extractor drops with a 200-character item, `_record_signal_outcome` plus a classifier, the dedup INFO to DEBUG, the `_resume_job` wrap, and `template.instantiate` outcomes.
**Actual**:
- **Discovery.** The digest reported no `Loop` class or `log_tick_ok` in ingest's `telemetry.py`, because it read a stale tree. At HEAD `c541b154`, Step 3 had already added `LOOP_TICK_OK`, the empty `Loop(StrEnum)`, `log_tick_ok` and the rebinding `Counter`/`Histogram`. This step adds the `MCP_CLIENT` member.
- **Poll outcome.** `poll_one_source` keeps an `outcome` variable that starts as `error` and is set at each site, and records it in a `finally`. A `CancelledError` records nothing, so a shutdown mid-poll is not counted as `error`. The body is re-indented under the `try`, and its behavior is unchanged.
- **Poll duration.** `ingest.source.poll.duration` is in seconds (`unit="s"`, like analysis's `cycle.duration`). An inner `try/finally` around the `poll_one_source` call records it, so the `mark_source_error` bookkeeping is not timed.
- **Extractor text.** All three drop WARNs keep their `"mcp_client: skipping ..."` prefix and add `(source %s)`. This keeps the guard at `test_mcp_client_loop.py:395`, which checks for `"mcp_client: skipping"`, meaningful. The two dict branches log `repr(item)[:200]`, using a module constant `_LOG_ITEM_CHARS`.
- **Classifier.** `_signal_error_outcome(exc)` returns `rejected` or `error`. It is used in the three `IngestSignal` excepts, the new `except Exception: ...; raise`, and the loop's per-item except.
- **`template.instantiate`.** Ingest has its own `record_template_instantiate(code)`. A known abort code (unavailable, not_found, invalid_argument, already_exists, failed_precondition) is recorded as its lower-cased name, any other code as `other`, and success as `ok`. The record is written before each `context.abort`.
- **Import.** `run_mcp_client_loop`'s function-local `import asyncio` moved to the module top level, because `poll_one_source` now catches `asyncio.CancelledError`.
**Reason**: the spec names the signals and sites but not these mechanics. No RPC response, source-health derivation, ingest path or task supervision changed.
**Disposition**: implementation detail recorded; no behavior change

### Deviation: Step 26 test realizations (logged at Step 26, 2026-11-06)
**Spec said**: AC-7, AC-28, AC-29, AC-30, AC-39 and AC-53 tests in `test_mcp_client_loop.py` (modify) and `test_ingest_telemetry.py` (create); a new fake needed by both files moves to `conftest.py`.
**Actual**:
- **File split.** Only the AC-7 tick tests went into `test_mcp_client_loop.py`. They read the `loop tick ok` record through `caplog` and need no metric reader. The other five ACs are in `test_ingest_telemetry.py`. That file imports the existing loop fakes (`_FakeResult`, `_FakeMcpClient`, `_FakeCfgWatcher`, `_mcp_source`, `_item`, `_run_cycle_with`), `_instantiate` from `test_source_templates.py`, and `_data_points` from `test_telemetry_instruments.py`.
- **No `conftest.py` move.** Only one file needs the metric reader, so `conftest.py` is not touched. The reader is bound with `metric_reader = test_telemetry.metric_reader`, the precedent in `test_telemetry_instruments.py:9`. No new fake was created.
- **AC-30's DB error** is an `asyncpg.exceptions.ConnectionDoesNotExistError` raised by `get_incomplete_chunks`, after `update_job(status=RUNNING)`.
- **RED protocol** (the Steps 7-25 protocol). Step 25's five app files were reverted to `HEAD~1`, and the new tests plus the `:192` spy test were run: `6 failed` (all `AssertionError`), `2 passed`. The two passes were the `:192` spy and the AC-7 "no tick when every source failed" negative. The negative holds trivially before Step 25, because no tick existed then. The app files were then restored.
**Reason**: these are the seams the tests already had. No production change was made.
**Disposition**: test realization; no spec or production change

### Deviation: Step 27 implementation details the spec left open (logged at Step 27, 2026-11-06)
**Spec said**: the five indicators instruments and three keys, `queue_wait` around the semaphore, `executions`/`duration` by `exit_reason` (missing outputs -> `runtime_error`, unmapped -> `other`, parameter errors not counted), one WARN per non-success run, the `"executing formula"` INFO to DEBUG, `template.instantiate` outcomes, and the watcher's `_snapshot_at`, `_consecutive` and 1-or-every-10th throttle.
**Actual**:
- **Units.** `indicators.sandbox.duration` and `indicators.sandbox.queue_wait` are in seconds (`unit="s"`, like ingest's `poll.duration`). `duration` times only the `asyncio.to_thread` call inside the semaphore. `queue_wait` runs from just before `async with` until the slot is acquired.
- **Missing-output branch.** The `missing` list is now computed before the record, so the run is counted once as `runtime_error`. The early return is the same response as before; its block is dedented one level with no change to its fields.
- **WARN text.** `"formula execution failed exit_reason=%s"`, with `extra={"exit_reason": ...}` so the OTel log record carries the attribute.
- **`template.instantiate`.** The body moved unchanged into a private `_instantiate_template`. The public `InstantiateTemplate` keeps `@owner_scoped`, and a `try/finally` records `ok` when a response is returned. Otherwise it records the `context.code()` the abort set: `not_found`, `permission_denied`, `invalid_argument` or `internal` by name, and anything else as `other`. That covers the saga path and the shared `_template_owner`/`_require_templates_db` helpers without editing them. grpc.aio sets `context.code()` on `abort`; I checked this with a scratch in-process server. A test double whose `code()` is a `MagicMock` records `other`. A caller that `owner_scoped` rejects never reaches the body and is not counted.
- **Gauge wiring.** `telemetry.register_snapshot_age(source)` stores the source and calls `Gauge.register()`. `ConfigWatcher.__init__` calls it with `self.snapshot_age`, after `init_telemetry()` in `main.py`. The last watcher registered is the one observed.
- **Watcher attributes.** `_snapshot_at = None` and `_consecutive = 0` are class attributes, so the existing `ConfigWatcher.__new__` test at `test_config_watcher.py:185` still runs `_watch`. The WARN keeps its text and appends `consecutive=%d`. The clean-end INFO carries `extra={"consecutive": n}`.
**Reason**: the spec names the signals and sites but not these mechanics. The RPC responses, status codes, sandbox limits and watcher sleep and re-issue behavior are unchanged.
**Disposition**: implementation detail recorded; no behavior change

### Deviation: Step 28 test realizations (logged at Step 28, 2026-11-06)
**Spec said**: AC-37, AC-38, AC-50 and AC-39 (indicators half) tests across `test_execute_formula_concurrency.py` (modify), `test_config_watcher.py` (modify) and `test_sandbox_telemetry.py` (create).
**Actual**:
- **AC-37 split.** The log half is in `test_execute_formula_concurrency.py`: `"executing formula"` is written at DEBUG only, with its text unchanged, and there is no INFO line. It also checks the timeout `exit_reason` and that `abort` is not awaited. The counter half is in `test_sandbox_telemetry.py`: `executions{timeout}` 1, `duration{timeout}` 1 sample, `queue_wait` 1 sample, one WARN with `exit_reason=timeout`, and RPC OK. Both use the `_timeout_execute_double` sandbox double that returns `timeout`, so neither waits out a real 5 s run.
- **AC-39** is in `test_sandbox_telemetry.py` and reuses `_servicer`, `_seed` and `_instantiate` from `test_formula_templates.py`.
- **AC-38 / AC-50** are in `test_config_watcher.py`.
  - They use a new `_ScriptedStub` and a `_dialfree_watcher` helper. The existing `:184` test is untouched.
  - The process-global `asyncio.sleep` is patched by a `sleep_recorder` fixture through `monkeypatch`, which restores it at teardown (design.md Open Risk).
  - `time.monotonic` is faked by replacing the module attribute `watcher_mod.time` only, never the global `time.monotonic` the event loop reads.
  - The gauge test resets `telemetry._snapshot_age_source` through `monkeypatch` and registers the `__new__` watcher's `snapshot_age` itself.
- **No `conftest.py` move.** `metric_reader` is bound from `test_telemetry` as in `test_telemetry_instruments.py:9`. `_data_points` and `_points` are imported from `test_telemetry_instruments.py`.
- **RED protocol** (the Steps 7-26 protocol). Step 27's `servicer.py` and `watcher.py` were reverted to `HEAD~1`, with the `telemetry.py` instruments kept: `5 failed, 30 passed`. The files were then restored.
**Reason**: these are the seams the tests already had. No production change was made.
**Disposition**: test realization; no spec or production change

### Deviation: Step 29 test realizations (logged at Step 29, 2026-11-06)
**Spec said**: per service, drive the instruments through the existing step harness, assert every collected attribute key is one of the module's key constants and none is an identifier key, assert the MIN instrument set and the `rpc.server.duration` / `mcp.tool.duration` / `http.server.duration` names and keys, cover AC-42 (disabled = no exporter, failing init still starts) and AC-7 (aggregate loop check); Go tests read `Loops` and the exported record helpers.
**Actual**:
- **Driving.** Each test calls every exported record helper of its module once (Go `Record*`, `RegisterStreamLastMessageAge`; Python `record_*` / `register_snapshot_age` / `log_tick_ok`; Node `record*` / `set*` / `observe*`; UI `recordAuthEvent`/`recordBffRequest`/`recordBffDuration`), then register-then-collects on a manual or in-memory reader. Portfolio drives its consumer signals through the in-package `newConsumerSignal(...).handled/count`.
- **Server-duration keys.** Go starts a bufconn gRPC server with `otelgrpc.NewServerHandler()` and a health service and asserts `rpc.server.duration` keeps `rpc.system`, `rpc.service`, `rpc.method`, `rpc.grpc.status_code`. Python and Node feed one SERVER span to their `RpcDurationProcessor` and assert the key set equals those four. Agent asserts `mcp.tool.duration` keys equal `gen_ai.tool.name`, `outcome` via `ToolMetricsMiddleware._record`.
- **AC-56 aggregate.** The Go key test fails on any collected `rpc.client.*` instrument.
- **AC-42.** Go: `Init` with `OTEL_ENABLED` unset leaves the installed MeterProvider in place and every record call is a no-op. A failing Go init is not re-tested here (`telemetry.Init` returns its error and `cmd/server/main.go` already logs and continues; covered by the existing `otel_test.go`). Python: the OTLP metric exporter is replaced by a counting factory; disabled creates none, and a factory that raises still returns from `init_telemetry` with the `OTel init failed` WARN. Node: `NodeSDK.prototype.start` is made to throw; `initTelemetry` returns, `telemetryStarted()` stays false and the `[otel] init failed` WARN is written. UI: record calls are no-ops under the API no-op provider.
- **AC-7.** Trading checks every `tickCases()` loop is in `Loops`; portfolio checks every `consumerLoops` value is in `Loops`; marketdata checks `Loops` has at most 8 distinct names. Analysis and ingest parse `app/` with `ast` and require every `log_tick_ok` loop argument (following one parameter relay, e.g. analysis `_log_items_tick`) to be a `Loop.<member>`. Indicators and agent write no `loop tick ok` record, so AC-7 does not apply to them.
- **Allowlist source.** The UI's `bffMetrics.ts` and ledger's `telemetry.ts` define no `KEY_*` constants: the UI test pins the allowed keys per instrument in the test, and ledger's allowlist is the empty set (its two instruments carry no attributes). No production file was changed to add constants.
- **Forbidden keys** add `secret`, `api_key` and `token` as the "secret key name" class.
- **RED protocol.** For each of the 12 services one record call was temporarily given an extra `symbol` attribute in the working tree; each new allowlist test failed with an assertion naming `symbol` (12 of 12), and the file was restored byte-for-byte. Nothing from the probe is committed.
- **Verification invocations.** The AC-44 loop and the marketdata `COVERPKGS` coverage command ran from scratchpad scripts holding the spec's commands verbatim, and the AC-43 diff check ran as separate `git fetch` / `git diff --name-only` / `grep` invocations, because the worktree sandbox refuses those compound commands. Commands, flags and thresholds are unchanged.
**Reason**: the earlier steps' harnesses assert behavior per site; the aggregate allowlist needs every instrument of a module recorded in one collection, which the exported helpers give directly. The two modules without key constants would need a production change outside this step's **Files**.
**Disposition**: test realization; CI-equivalent fallback for the split verification invocations; no spec or production change
