# Implementation Spec: fix-otel-trace-export

**Status**: `pending`
**Created**: 2026-10-14
**Feature**: `docs/roadmap/features/226-fix-otel-trace-export/feature.md`
**Total Steps**: 11
**Feature Branch**: `ccr-3c062b89-cl8ixo` (session-pinned **Development Branch**; operator-approved deviation from `feature/fix-otel-trace-export`, see `context.md` 2026-10-14 /sdd-triage). Sequential-style execution: one commit per step, with a single integration PR to `main-dev`.

---

## Execution Summary

The spec follows `design.md` § Chosen Approach. Every runtime builds its OTLP/**HTTP** trace exporter
with **no** endpoint, url or insecure argument, so the SDK's own spec env handling appends
`/v1/traces`, takes TLS from the scheme and reads `Authorization` from `OTEL_EXPORTER_OTLP_HEADERS`.
Each design work unit (acceptance reconcile, Go, Python, Node, UI, compose/docs) maps to steps here.
Each code-bearing family becomes a `service` step plus its paired `test` step (C-08), so
the design's six units are eleven commits. Families land in the design's order: 1 acceptance → 2–3
Go → 4–5 Python → 6–7 Node → 8–9 UI → 10 compose/collector → 11 docs and teardown.

**Red-before-green ordering (P-06).** For each pair, `/sdd-execute` writes the `test` step's file
first and leaves it unstaged. It captures RED against the pre-fix code, makes the `service` change,
commits only the `service` step's **Files**, then commits the test once it is GREEN. For Python, Node
and UI, the *new* dependency is installed before the RED capture. The *old* dependency is removed
only after it, so RED fails on behaviour (no `POST …/v1/traces`, no logged 400), not on
`MODULE_NOT_FOUND` (design.md § Step order).

**Consumer surface (C-14):** none. This is internal/platform-only and changes no UI segment or Agent MCP
tool. The observable outcome is traces per `service.name` in Grafana Cloud Tempo (design.md
§ Chosen Approach).

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) | Notes |
|---|---|---|
| `@AC-1` OTLP/HTTP export to a path-prefixed URL + `Authorization` header | Step 3 (Go ×3), Step 5 (Python ×4), Step 7 (Node ×4), Step 9 (UI) | Go and Python cover **both** Example rows (raw + encoded). Node and UI cover the **raw** row only, which is the form `deploy.yml:162-163` produces (design.md § Tests). |
| `@AC-2` UI registers its hook from `src/` and exports | Step 9 (vitest `register()` + file-location assertion); Step 8 Verification (`next build` → `.next/server/instrumentation.js` + standalone boot log) | |
| `@AC-3` failed export visible in service logs | Step 3, Step 5, Step 7, Step 9 | Go: stdlib `log` via OTel's default error handler. Python: `logging` ERROR. Node/UI: diag `console.error`. |
| `@AC-4` local compose → `http://otel-collector:4318` | Step 10 (grep of the 12 service blocks, RED recorded before the edit) | |

## Step Dependencies

- Step 2 [service] is covered by Step 3 [test]. Step 3's tests are authored first and run RED against the pre-Step-2 `otel.go`.
- Step 4 [service] is covered by Step 5 [test]. Step 4 sub-step (a), which adds `opentelemetry-exporter-otlp-proto-http`, must be installed before Step 5's RED capture. Removing `-proto-grpc` (sub-step c) comes after it.
- Step 6 [service] is covered by Step 7 [test]. Step 6 sub-step (a) adds `@opentelemetry/exporter-trace-otlp-http` + `@opentelemetry/api` and runs `pnpm install` before Step 7's RED. Removing `@opentelemetry/exporter-trace-otlp-grpc` (sub-step c) comes after it.
- Step 8 [service] is covered by Step 9 [test]. `xstockstrat-ui` is a frontend, so C-08 pairing is not mandatory, but design.md requires the test. Step 8 adds `@opentelemetry/api` before Step 9's RED.
- Steps 6 and 8 both modify the root `pnpm-lock.yaml`. They run in order (6 then 8) and must not be reordered or interleaved.
- Step 10 requires Steps 2, 4, 6 and 8. Moving 7 compose services to `:4318` is correct only once every runtime exports OTLP/HTTP.
- Step 11 requires Steps 2–10. Its docs describe the shipped state, and the context-forge teardown audits it.
- Step 1 has no code dependency but runs first, so the acceptance scenarios that Steps 3/5/7/9 cite are final before any RED capture.

---

### Step 1 — docs: AC-1 Scenario Outline (raw + encoded) and product-spec dependency reconcile

**Status**: `done`
**Service**: `docs/roadmap/features/226-fix-otel-trace-export/`
**Files**:
- `docs/roadmap/features/226-fix-otel-trace-export/acceptance.feature` — modify
- `docs/roadmap/features/226-fix-otel-trace-export/product-spec.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `acceptance.feature` `@AC-1` is a plain `Scenario:` with only the encoded header form `"Authorization=Basic%20dGVzdDprZXk%3D"`.
- design.md § Constitution Rules Touched: "`C-15` — honored by: AC-1 Scenario Outline with raw + encoded Examples". design.md § Step order: "1 acceptance + product-spec reconcile".
- `.github/workflows/deploy.yml:162-163`: `if otel_headers and not otel_headers.startswith('Authorization='): otel_headers = 'Authorization=' + otel_headers`. The deployed value is therefore the **raw** form `Authorization=Basic <tok>`.
- `product-spec.md` § Fix Scope "Dependency changes" lists `otlptracehttp`, `opentelemetry-exporter-otlp-proto-http` and `@opentelemetry/exporter-trace-otlp-http`. It omits `@opentelemetry/api`, which design.md § Chosen Approach → Dependencies adds to ledger, identity, notify, config and ui. It also omits removing the gRPC exporters.

**TDD**: `N/A (docs — spec artifacts, non-code-bearing)`

**Covers**: —

**Instructions**:
1. In `acceptance.feature`, convert `@AC-1` to a `Scenario Outline:`. Keep the tags `@AC-1 @FR-1 @regression` and the title unchanged, since `@AC-*` IDs are append-only per C-15. Replace the `OTEL_EXPORTER_OTLP_HEADERS` line with `And OTEL_EXPORTER_OTLP_HEADERS is "<headers>"`. Add:
   ```gherkin
       Examples:
         | form    | headers                              |
         | raw     | Authorization=Basic dGVzdDprZXk=     |
         | encoded | Authorization=Basic%20dGVzdDprZXk%3D |
   ```
   In an Outline, `<…>` is an Examples placeholder. The existing AC-1 endpoint text `"http://<otlp-receiver>/otlp"` would therefore become an unbound placeholder. Reword that one line as `And OTEL_EXPORTER_OTLP_ENDPOINT is the receiver's base URL with path "/otlp"`. Leave AC-2, AC-3 and AC-4 unchanged; they are plain `Scenario:` blocks.
2. In `product-spec.md` § Fix Scope, rewrite the "Dependency changes" bullet. It should read: Go `otlptracehttp` replaces `otlptracegrpc` (×3 go.mod/go.sum). Python `opentelemetry-exporter-otlp-proto-http` replaces `-proto-grpc` (×4 pyproject + uv.lock). Node `@opentelemetry/exporter-trace-otlp-http ^0.52.0` replaces `-otlp-grpc`, and `@opentelemetry/api ^1.9.0` is added (×4 package.json). UI adds `@opentelemetry/api ^1.9.0`. The root `pnpm-lock.yaml` is updated. Change nothing else in the product spec.

**Verification**:
```bash
grep -n "Scenario Outline\|Examples:\|Authorization=Basic dGVzdDprZXk=\|Authorization=Basic%20dGVzdDprZXk%3D\|<otlp-receiver>" docs/roadmap/features/226-fix-otel-trace-export/acceptance.feature
# expect: 1 Outline (AC-1), 1 Examples, both header rows; <otlp-receiver> only inside AC-2 (a plain Scenario)
grep -c "@AC-[1-4]" docs/roadmap/features/226-fix-otel-trace-export/acceptance.feature   # expect 4
grep -n "@opentelemetry/api" docs/roadmap/features/226-fix-otel-trace-export/product-spec.md
```

---

### Step 2 — service: Go ×3 — OTLP/HTTP trace exporter from spec env vars

**Status**: `done`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel.go` — modify
- `services/xstockstrat-trading/go.mod` — modify
- `services/xstockstrat-trading/go.sum` — modify
- `services/xstockstrat-portfolio/internal/telemetry/otel.go` — modify
- `services/xstockstrat-portfolio/go.mod` — modify
- `services/xstockstrat-portfolio/go.sum` — modify
- `services/xstockstrat-marketdata/internal/telemetry/otel.go` — modify
- `services/xstockstrat-marketdata/go.mod` — modify
- `services/xstockstrat-marketdata/go.sum` — modify
- `go.work.sum` is **never staged**: every command runs with `GOWORK=off`, so any change to it is incidental — revert it with `git checkout -- go.work.sum` before committing (F-08).

**Reviewers**: xstockstrat-trading owner — order execution correctness, broker API safety (startup path unaffected); xstockstrat-portfolio owner — position snapshot consistency (startup path unaffected); xstockstrat-marketdata owner — Alpaca feed idempotency (startup path unaffected)

**Codebase Evidence**:
- `services/xstockstrat-trading/internal/telemetry/otel.go:10` imports `go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc`.
- `otel.go:23-26` is the fallback `endpoint = "otel-collector:4317"`.
- `otel.go:28-32` is `otlptracegrpc.New(ctx, otlptracegrpc.WithEndpoint(endpoint), otlptracegrpc.WithInsecure(), otlptracegrpc.WithTimeout(5*time.Second))`. This is the defect: a full URL handed to a `host:port`-only option (recon.md Codebase Map).
- `otel.go:42-48`: `sdktrace.WithBatcher(exp)` and `otel.SetTracerProvider(tp)` stay unchanged. `newResource` at `:53-65` stays untouched (PRESERVE `@AC-1 @feature-171`).
- `diff` of the three `otel.go` copies shows a single difference, the default service name at `:56`. The edits are identical across services (C-10).
- `go.mod:13` (all three) is `go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.45.0`. `otlptracehttp` is absent from every `go.mod`, and `grep -c otlptracehttp go.work.sum` → 0.
- `otlptracehttp@v1.45.0` is present in the module cache: `exporter.go:13` `func New(ctx context.Context, opts ...Option)`, `options.go:142` `func WithTimeout(duration time.Duration) Option`.
- Call site `cmd/server/main.go` (trading `:37-46`, portfolio `:34-43`, marketdata `:41-50`). An Init error is logged at `slog.Warn` and is non-fatal. Shutdown is deferred under a 5 s `context.WithTimeout`. design.md keeps `WithTimeout(5s)` because the 10 s default outlives that context (Rejected Alternatives).
- Failure visibility already exists. `otel@v1.45.0/internal/errorhandler/errorhandler.go:36` `log.Print(err)` is the default global handler, and `sdk@v1.45.0/trace/batch_span_processor.go:333,353,380,386` call `otel.Handle(err)` on export failure, including the drain-on-shutdown path. No `otel.SetErrorHandler` exists anywhere in the repo.

**TDD**: `red-green required` (paired with Step 3; Step 3's tests fail against the current `otlptracegrpc` code)

**Covers**: — (behaviour asserted by Step 3)

**Instructions** (identical in all three services):
1. Author Step 3's tests in `internal/telemetry/otel_test.go` first and leave them unstaged. Capture RED with `GOWORK=off go test ./internal/telemetry/ -run 'TestInit' -count=1 -v`. Expected failure reason: the receiver never sees `POST /otlp/v1/traces`, and no `400 Bad Request` is logged.
2. In `otel.go`, replace the import at `:10` with `go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp`.
3. Delete `:23-26` (the `endpoint` variable and its `"otel-collector:4317"` fallback). Replace `:28-32` with:
   ```go
   	// No endpoint/insecure options: they override OTEL_EXPORTER_OTLP_* (path, TLS, headers).
   	exp, err := otlptracehttp.New(ctx, otlptracehttp.WithTimeout(5*time.Second))
   ```
   That is a one-line constraint comment (root `CLAUDE.md` How to Act #5) plus the call. Leave everything else in the file unchanged.
4. In each service run `GOWORK=off go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp@v1.45.0 && GOWORK=off go mod tidy`. `otlptracegrpc` must leave `go.mod` (no remaining importer). The `otlptrace v1.45.0` indirect entry stays. `google.golang.org/grpc` stays direct because the services are gRPC servers (recon.md Risks).

**Verification**:
```bash
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && \
  grep -c "otlptracegrpc\|WithEndpoint\|WithInsecure\|otel-collector:4317" internal/telemetry/otel.go ; \
  grep -n "otlptracehttp\|otlptracegrpc" go.mod ; \
  GOWORK=off go build ./... && GOWORK=off go vet ./internal/telemetry/ && \
  GOWORK=off golangci-lint run --modules-download-mode=mod ); done
# expect: grep -c → 0 per service; go.mod lists otlptracehttp v1.45.0 and no otlptracegrpc; build/vet/lint clean
git checkout -- go.work.sum 2>/dev/null; git status --short go.work.sum   # expect empty (never staged, F-08)
```

---

### Step 3 — test: Go ×3 — AC-1 (raw + encoded) export and AC-3 logged 400

**Status**: `done`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel_test.go` — modify
- `services/xstockstrat-portfolio/internal/telemetry/otel_test.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/otel_test.go` — modify

**Reviewers**: xstockstrat-trading owner — order execution correctness (test-only); xstockstrat-portfolio owner — concurrent write safety (test-only); xstockstrat-marketdata owner — OHLCV ingestion integrity (test-only)

**Codebase Evidence**:
- `internal/telemetry/otel_test.go:11` `TestNewResourceOmitsTradingMode` is the only test. It uses `t.Setenv` and never exercises `Init`. The three copies are byte-identical (`diff` empty).
- `Init(ctx) (func(context.Context) error, error)` is at `otel.go:18`. Its gate is `os.Getenv("OTEL_ENABLED") != "true"` at `:19`.
- `otlptracehttp@v1.45.0/client.go:281` returns `fmt.Errorf("failed to send to %s: %s (%w)", request.URL, resp.Status, bodyErr)`, so a 400 response yields text containing `400 Bad Request`. That error reaches `log.Print` through `errorhandler.go:36`.
- The BSP drain on `Shutdown` routes export errors to `otel.Handle` (`batch_span_processor.go:380,386`). A test can therefore trigger and observe the failure by calling the shutdown func returned by `Init` with a deadline ctx.
- The `telemetry` package is excluded from the CI coverage `-coverpkg` (`.github/workflows/ci.yml:256` `grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)'`).

**TDD**: `red-green required` (RED against pre-Step-2 `otel.go`: no `POST /otlp/v1/traces` reaches the `httptest` server; no `400 Bad Request` in the captured log)

**Covers**: `AC-1` (both Example rows), `AC-3`

**Instructions** (append to `otel_test.go`; identical in all three services, imports `net/http`, `net/http/httptest`, `log`, `bytes`, `strings`, `time`, `go.opentelemetry.io/otel`):
1. `TestInitExportsOverOTLPHTTP` (AC-1) is table-driven over `{"raw", "Authorization=Basic dGVzdDprZXk="}` and `{"encoded", "Authorization=Basic%20dGVzdDprZXk%3D"}`. For each case:
   - Start an `httptest.NewServer` whose handler records `r.Method`, `r.URL.Path` and `r.Header.Get("Authorization")` into a buffered channel and replies `200`.
   - `t.Setenv("OTEL_ENABLED","true")`, `t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", srv.URL+"/otlp")`, `t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", tc.headers)`.
   - `shutdown, err := Init(ctx)`, then end one span via `otel.Tracer("t").Start(ctx, "s")`. Call `shutdown` with a `context.WithTimeout(…, 5*time.Second)` ctx.
   - Assert the recorded request is `POST`, path `/otlp/v1/traces`, `Authorization` `Basic dGVzdDprZXk=`. Fail if nothing arrives within the deadline.
2. `TestInitLogsExportFailure` (AC-3) starts a server that replies `400`.
   - Save `w := log.Writer()`, then `log.SetOutput(&buf)` with `t.Cleanup(func(){ log.SetOutput(w) })`.
   - Use the same env as above with the raw header. Init, end one span, then shut down with a deadline ctx.
   - Assert `strings.Contains(buf.String(), "400 Bad Request")`.
3. C-13: the env strings and the receiver are scenario one-offs with a single consumer (this file). They stay inline and no `internal/testdata/` home is created.
4. Keep `TestNewResourceOmitsTradingMode` unchanged (PRESERVE `@AC-1 @feature-171`).

**Verification**:
```bash
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && \
  GOWORK=off go test ./internal/telemetry/ -run 'TestInit|TestNewResource' -count=1 -race -v && \
  COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && \
  GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && \
  GOWORK=off go tool cover -func=coverage.out | awk '/^total:/ {sub("%","",$3); print "total", $3; exit ($3+0 < 40)}' && \
  GOWORK=off golangci-lint run --modules-download-mode=mod ); done
# The new logic is in an excluded package (telemetry/); the awk exits non-zero if the CI total falls below 40% (C-08).
grep -rn "dGVzdDprZXk" --include="*_test.go" services/xstockstrat-trading   # C-13: single declaration file
```

---

### Step 4 — service: Python ×4 — OTLP/HTTP span exporter from spec env vars

**Status**: `done`
**Service**: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-agent`
**Files**:
- `services/xstockstrat-indicators/app/telemetry.py` — modify
- `services/xstockstrat-indicators/pyproject.toml` — modify
- `services/xstockstrat-indicators/uv.lock` — modify
- `services/xstockstrat-ingest/app/telemetry.py` — modify
- `services/xstockstrat-ingest/pyproject.toml` — modify
- `services/xstockstrat-ingest/uv.lock` — modify
- `services/xstockstrat-analysis/app/telemetry.py` — modify
- `services/xstockstrat-analysis/pyproject.toml` — modify
- `services/xstockstrat-analysis/uv.lock` — modify
- `services/xstockstrat-agent/app/telemetry.py` — modify
- `services/xstockstrat-agent/pyproject.toml` — modify
- `services/xstockstrat-agent/uv.lock` — modify
- `services/xstockstrat-agent/tests/test_telemetry.py` — modify (one-line patch-target repoint, forced by the dependency removal)

**Reviewers**: xstockstrat-indicators owner — no side-effects from formula execution (startup path only); xstockstrat-ingest owner — idempotent ingestion (startup path only); xstockstrat-analysis owner — backtest reproducibility (startup path only); xstockstrat-agent owner — MCP tool contract stability (unchanged; telemetry only)

**Codebase Evidence**:
- `services/xstockstrat-indicators/app/telemetry.py` (ingest and analysis use the same lines):
  - `:34` `from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter`
  - `:39` `endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "otel-collector:4317")`
  - `:43` `exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)`
  - `:50` `log.info("OTel tracing initialised", extra={"endpoint": endpoint, "service": svc_name})`
  - `:52-53` broad `except` → `log.warning`
- Agent (`diff`: +4 docstring lines, client instrumentor) has the same statements at `:38`, `:43`, `:47`, `:54`, with `GrpcAioInstrumentorClient` at `:39`/`:52`.
- `_build_resource` (`:13-24`; agent `:17-28`) stays untouched (PRESERVE `@AC-1 @feature-171`).
- `pyproject.toml`: `"opentelemetry-exporter-otlp-proto-grpc>=1.25.0"` at indicators `:13`, ingest `:16`, analysis `:16`, agent `:15`.
- `uv.lock`: `opentelemetry-exporter-otlp-proto-grpc` 1.42.1 (indicators/analysis/agent), 1.41.1 (ingest `uv.lock:828-829`). `opentelemetry-exporter-otlp-proto-http` is absent from every lock.
- The proto-http exporter, at the pinned line (uv cache `opentelemetry/exporter/otlp/proto/http/trace_exporter/__init__.py`), defines:
  - `:67` `DEFAULT_TRACES_EXPORT_PATH = "v1/traces"`
  - `:89` `_append_trace_path(`
  - `:112-114` `OTEL_EXPORTER_OTLP_HEADERS` parsed by `parse_env_headers`
  - `:217` the log message `"Failed to export span batch code: %s, reason: %s"`
- `services/xstockstrat-agent/tests/test_telemetry.py:23-26` patches the hard-coded target `"opentelemetry.exporter.otlp.proto.grpc.trace_exporter.OTLPSpanExporter"`. That target breaks once `-proto-grpc` is uninstalled, so the repoint must land in this step.
- CI runs `uv lock --check` (`.github/workflows/ci.yml:332`) and `uv sync --frozen --extra dev`.

**TDD**: `red-green required` (paired with Step 5; Step 5's tests fail against the current gRPC exporter code)

**Covers**: — (behaviour asserted by Step 5)

**Instructions** (all four services; the order matters for RED):
- **(a) Add the new dependency.** In `pyproject.toml`, add `"opentelemetry-exporter-otlp-proto-http>=1.25.0",` next to the existing `-proto-grpc` line and keep `-proto-grpc` for now. Run `uv lock && uv sync --extra dev` in the service directory.
- **(b) Capture RED.** Author Step 5's tests (unstaged) and capture RED: `uv run --no-sync pytest tests/test_telemetry.py -v`. The failure should be that no `POST /otlp/v1/traces` arrives and that no `code: 400` is logged.
- **(c) Change `app/telemetry.py`.**
  - Change the deferred import (`:34`; agent `:38`) to `from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter`.
  - Change `:39` (agent `:43`) to `endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")`, deleting the fallback. That value is only used by the existing success log.
  - Change `:43` (agent `:47`) to `exporter = OTLPSpanExporter()`.
  - Add a one-line constraint comment above it: `# No endpoint/insecure args: they override OTEL_EXPORTER_OTLP_* (path, TLS, headers).`
  - Leave the instrumentor, `BatchSpanProcessor`, `except` and `_build_resource` unchanged.
- **(d) Remove the old dependency.** Delete the `-proto-grpc` line from `pyproject.toml`, then run `uv lock && uv sync --extra dev`.
  - Ingest may move from SDK 1.41.1 to 1.42.x. That is acceptable; mention it in the commit body (design.md Open Risk).
  - `requests` is now a transitive dependency of proto-http (recon.md Risks).
- **(e) Repoint the agent test.** In `services/xstockstrat-agent/tests/test_telemetry.py:24`, repoint the patch target to `"opentelemetry.exporter.otlp.proto.http.trace_exporter.OTLPSpanExporter"`. This keeps PRESERVE `@AC-2 @feature-171`, the non-blocking init guarantee.

**Verification**:
```bash
for s in indicators ingest analysis agent; do (cd services/xstockstrat-$s && \
  grep -c "proto.grpc\|insecure=True\|otel-collector:4317" app/telemetry.py ; \
  grep -n "otlp-proto" pyproject.toml ; \
  uv lock --check && uv sync --frozen --extra dev && \
  uv run --no-sync python -c "import app.telemetry, opentelemetry.exporter.otlp.proto.http.trace_exporter" && \
  ruff check . && ruff format --check . ); done
# expect: grep -c → 0; pyproject lists only -proto-http; lock check + import + ruff clean
(cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_telemetry.py -k non_blocking -v)   # PRESERVE @AC-2 @feature-171
```
**Commit hygiene**: `services/xstockstrat-agent/tests/test_telemetry.py` is shared with Step 5, whose RED tests are already written into it at sub-step (b). Stage only the `:24` patch-target hunk for this step's commit (`git add -p`); the new test functions are committed with Step 5 (F-08, P-06).

---

### Step 5 — test: Python ×4 — AC-1 (raw + encoded) export and AC-3 logged 400

**Status**: `done`
**Service**: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-agent`
**Files**:
- `services/xstockstrat-indicators/tests/conftest.py` — modify
- `services/xstockstrat-indicators/tests/test_telemetry.py` — modify
- `services/xstockstrat-ingest/tests/conftest.py` — modify
- `services/xstockstrat-ingest/tests/test_telemetry.py` — modify
- `services/xstockstrat-analysis/tests/conftest.py` — modify
- `services/xstockstrat-analysis/tests/test_telemetry.py` — modify
- `services/xstockstrat-agent/tests/conftest.py` — modify
- `services/xstockstrat-agent/tests/test_telemetry.py` — modify

**Reviewers**: xstockstrat-indicators owner — numeric precision (test-only); xstockstrat-ingest owner — signal normalization correctness (test-only); xstockstrat-analysis owner — strategy scoring determinism (test-only); xstockstrat-agent owner — no secret values in tool output (test-only)

**Codebase Evidence**:
- `tests/test_telemetry.py:4-12` `test_build_resource_omits_trading_mode` exists in all four, and the agent adds `:15-29` `test_init_telemetry_non_blocking_on_error`. All use `monkeypatch`.
- `tests/conftest.py` exists in all four (indicators 55 lines, ingest 66, analysis 72, agent 91). This is the C-13 canonical Python fixture home.
  - The agent conftest has an autouse `set_env` at `:51-52`, which sets no `OTEL_*` vars. There is no conflict.
  - indicators/ingest/analysis conftests define no `@pytest.fixture` today. They are plain helpers plus `_setup_gen_path()`, and indicators/ingest/analysis do not import `pytest` in conftest.
- In the OTel API (uv cache `opentelemetry/trace/__init__.py`):
  - `:101` `from opentelemetry.util._once import Once`
  - `:519` `_TRACER_PROVIDER_SET_ONCE = Once()`
  - `:520` `_TRACER_PROVIDER: TracerProvider | None = None`
  - `:553` `do_once(set_tp)`, so a second `set_tracer_provider` in one process is ignored unless reset.
- The instrumentors are imported inside `init_telemetry` from `opentelemetry.instrumentation.grpc`. They are `GrpcAioInstrumentorServer` (indicators/ingest/analysis `:35`/`:48`) and `GrpcAioInstrumentorClient` (agent `:39`/`:52`).
- The exporter error log is `"Failed to export span batch code: %s, reason: %s"` (proto-http `trace_exporter/__init__.py:217`).
- `asyncio_mode = "auto"` (agent `pyproject.toml:32`). The new tests are sync and unaffected.

**TDD**: `red-green required` (RED against pre-Step-4(c) `telemetry.py`: the gRPC exporter never POSTs `/otlp/v1/traces`, and no `code: 400` is logged)

**Covers**: `AC-1` (both Example rows), `AC-3`

**Instructions** (all four services):
1. In `tests/conftest.py`, add an **opt-in** fixture (not autouse) `otel_reset(monkeypatch)`, plus `import pytest` where it is absent. The fixture:
   - Sets `opentelemetry.trace._TRACER_PROVIDER_SET_ONCE` to a fresh `Once()` and `opentelemetry.trace._TRACER_PROVIDER` to `None` via `monkeypatch.setattr`.
   - Sets `NO_PROXY` and `no_proxy` to `127.0.0.1`, because `requests` honours the proxy env.
   - No-ops the service's instrumentor: `monkeypatch.setattr(<GrpcAioInstrumentorServer|GrpcAioInstrumentorClient>, "instrument", lambda self, **kw: None)`.
   - On teardown, calls `shutdown()` on the provider that `trace.get_tracer_provider()` returns when it has one.
   - Has a ≤2-line docstring stating the constraint ("tracer provider is set-once per process").
2. In `tests/test_telemetry.py`, add an inline `ThreadingHTTPServer` receiver on `127.0.0.1:0`. It is a one-off with a single consumer per service, so it stays inline under C-13. Its handler records path and `Authorization`, replies with a configurable status, and runs in a daemon thread.
3. `test_init_exports_over_otlp_http` (AC-1) is `@pytest.mark.parametrize("headers", ["Authorization=Basic dGVzdDprZXk=", "Authorization=Basic%20dGVzdDprZXk%3D"])` and uses `otel_reset`.
   - Set `OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<port>/otlp` and the headers.
   - Call `init_telemetry()`, end one span via `trace.get_tracer("t").start_as_current_span("s")`, then `trace.get_tracer_provider().shutdown()`.
   - Assert path `/otlp/v1/traces` and `Authorization == "Basic dGVzdDprZXk="`.
4. `test_init_logs_export_failure` (AC-3) uses `otel_reset` and a receiver that replies `400`, with `caplog.at_level(logging.ERROR)`. Init, end one span and shut down, then assert `"code: 400" in caplog.text`. Pin the assertion to `code: 400` only, not the reason text, so the ingest lock bump cannot break it (design.md Open Risk).
5. Keep `test_build_resource_omits_trading_mode` and the agent's repointed `test_init_telemetry_non_blocking_on_error` unchanged.

**Verification**:
```bash
(cd services/xstockstrat-indicators && uv run --no-sync pytest tests/test_telemetry.py -v && uv run --no-sync pytest --cov=app --cov-fail-under=50 && ruff check . && ruff format --check .)
for s in ingest analysis agent; do (cd services/xstockstrat-$s && uv run --no-sync pytest tests/test_telemetry.py -v && uv run --no-sync pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .); done
grep -n "def otel_reset\|otel_reset" services/xstockstrat-*/tests/conftest.py services/xstockstrat-*/tests/test_telemetry.py   # C-13: fixture defined once per service in conftest
```

---

### Step 6 — service: Node ×4 — OTLP/HTTP exporter, WARN diag logger, sync resource detectors

**Status**: `done`
**Service**: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config`
**Files**:
- `services/xstockstrat-ledger/src/telemetry.ts` — modify
- `services/xstockstrat-ledger/package.json` — modify
- `services/xstockstrat-identity/src/telemetry.ts` — modify
- `services/xstockstrat-identity/package.json` — modify
- `services/xstockstrat-notify/src/telemetry.ts` — modify
- `services/xstockstrat-notify/package.json` — modify
- `services/xstockstrat-config/src/telemetry.ts` — modify
- `services/xstockstrat-config/package.json` — modify
- `pnpm-lock.yaml` — modify (root; the per-service `pnpm-lock.yaml` files are stale orphans and stay untouched per design.md)

**Reviewers**: xstockstrat-ledger owner — append-only invariant (unchanged; startup path only); xstockstrat-identity owner — secret store integration, never plaintext secrets (telemetry carries none); xstockstrat-notify owner — stream delivery guarantees (unchanged); xstockstrat-config owner — WatchConfig stream stability (unchanged; startup path only)

**Codebase Evidence**:
- `services/xstockstrat-ledger/src/telemetry.ts` (identity identical; notify +1 line; config −1 line):
  - `:1` `import { Resource } from '@opentelemetry/resources';`
  - `:30` `require('@opentelemetry/exporter-trace-otlp-grpc')` (notify `:31`, config `:29`)
  - `:34` `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'grpc://otel-collector:4317';` (notify `:35`, config `:33`)
  - `:37-41` `new NodeSDK({ resource: buildResource(), traceExporter: new OTLPTraceExporter({ url: endpoint }), instrumentations: [new GrpcInstrumentation()] })` (exporter at `:39`, notify `:40`, config `:38`)
  - `:44` the `[otel] tracing enabled` log
  - `:47-48` `catch` → `console.warn('[otel] init failed …')`
- `buildResource` (`:15-21`) stays untouched (PRESERVE `@AC-1 @feature-171`).
- `package.json` (ledger `:25-29`; identity/notify/config `:24-28`) has `exporter-trace-otlp-grpc`, `instrumentation-grpc` and `sdk-node` at `^0.52.0`, and `resources`/`semantic-conventions` at `^1.25.0`. No service declares `@opentelemetry/api`, and `.npmrc` hoists only `@bufbuild/*`. A lazy `require('@opentelemetry/api')` would therefore throw without the new dependency (context.md R2 MAJOR).
- The root `pnpm-lock.yaml` already resolves `'@opentelemetry/exporter-trace-otlp-http@0.52.1'` (`:1578`) and `'@opentelemetry/api@1.9.1'` (`:1478`). Both are installed (`node_modules/.pnpm/@opentelemetry+exporter-trace-otlp-http@0.52.1_…`, `@opentelemetry+api@1.9.1`).
- `@opentelemetry/resources@1.30.1` (the resolved `^1.25.0`) exports `envDetectorSync`, `hostDetectorSync` and `processDetectorSync` (`build/src/index.d.ts:6`).
- `sdk-node@0.52.1 sdk.js:46-50` registers `DiagConsoleLogger` only when `OTEL_LOG_LEVEL` is set. `:60-61` sets `this._resourceDetectors = configuration.resourceDetectors ?? defaultDetectors`.
- The design probe (context.md R3) found that the default async detectors emit a false `Accessing resource attributes before async attributes settled` diag error on every boot once a logger exists. Sync detectors remove it and yield an identical attribute set.
- Call site `src/index.ts:1-2` (all four): `import { initTelemetry } from './telemetry'; initTelemetry();`. It is unchanged.
- Docker installs with `pnpm install --frozen-lockfile` against the root lock (recon.md Codebase Map), so the root lock must be committed.

**TDD**: `red-green required` (paired with Step 7; Step 7's tests fail against the current gRPC exporter code)

**Covers**: — (behaviour asserted by Step 7)

**Instructions** (all four services; the order matters for RED):
- **(a) Add the new dependencies.** In `package.json` `dependencies`, add `"@opentelemetry/api": "^1.9.0"` and `"@opentelemetry/exporter-trace-otlp-http": "^0.52.0"`, and keep `-otlp-grpc` for now. Run `pnpm install` at the repo root. The lock should resolve to the already-locked 1.9.1 / 0.52.1 with no new transitive tree.
- **(b) Capture RED.** Author Step 7's test files (unstaged) and capture RED with `pnpm test` per service. The failure should be that no `/otlp/v1/traces` request arrives and no diag `console.error` appears.
- **(c) Change `src/telemetry.ts`.**
  - Extend the static import on line 1 to `import { Resource, envDetectorSync, hostDetectorSync, processDetectorSync } from '@opentelemetry/resources';`.
  - Replace the gRPC exporter `require` with `require('@opentelemetry/exporter-trace-otlp-http')`.
  - Change the endpoint line to `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;`, deleting the fallback. It is used only by the existing log line.
  - Inside the existing `try`, before `new NodeSDK`, add:
    ```ts
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
    // sdk-node registers its own diag logger when OTEL_LOG_LEVEL is set.
    if (!process.env.OTEL_LOG_LEVEL) diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
    ```
  - In `new NodeSDK({...})`, set `traceExporter: new OTLPTraceExporter()`. Add `resourceDetectors: [envDetectorSync, processDetectorSync, hostDetectorSync]` with a ≤2-line constraint comment: `// 0.52's default async detectors log a false diag.error on every boot once a logger exists.`
  - Keep `instrumentations: [new GrpcInstrumentation()]`, the `initTelemetry(): void` signature, the SIGTERM shutdown and the `catch` unchanged. That keeps PRESERVE `@AC-2 @feature-171`: everything new sits inside the gate and the `try`.
- **(d) Remove the old dependency.** Remove `"@opentelemetry/exporter-trace-otlp-grpc"` from all four `package.json`, then run `pnpm install` at the root.

**Verification**:
```bash
pnpm install --frozen-lockfile
grep -n "exporter-trace-otlp-grpc" services/xstockstrat-{ledger,identity,notify,config}/package.json ; echo "expect none"
grep -n "^      '@opentelemetry/exporter-trace-otlp-grpc':$" pnpm-lock.yaml   # expect none: importer entries (today :57,:136,:227,:312) end the line with ':'; the sdk-node snapshot lines (:7583, :7605) carry a version after ':' and are excluded by the '$' anchor
for s in ledger identity notify config; do (cd services/xstockstrat-$s && \
  grep -c "otlp-grpc\|otel-collector:4317\|url: endpoint" src/telemetry.ts ; \
  pnpm run lint && pnpm run build ); done
# expect: grep -c → 0; lint + tsc build clean in all four (fails.md 2026-09-09 (171): build AND test per runner)
```
**Deployment files**: the code now reads `OTEL_LOG_LEVEL`, an optional OTel spec var that nothing sets. Unset → our WARN logger applies; no `docker-compose.yml` or `.do/app*.yaml` change is needed.

---

### Step 7 — test: Node ×4 — AC-1 (raw) export and AC-3 diag-logged 400

**Status**: `done`
**Service**: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/telemetry.export.test.ts` — create
- `services/xstockstrat-identity/src/__tests__/telemetry.export.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/telemetry.export.test.ts` — create
- `services/xstockstrat-config/src/__tests__/telemetry.export.test.ts` — create

**Reviewers**: xstockstrat-ledger owner — event ordering (test-only); xstockstrat-identity owner — JWT expiry and rotation (test-only); xstockstrat-notify owner — backpressure handling (test-only); xstockstrat-config owner — config key naming (test-only)

**Codebase Evidence**:
- There are two test runners (recon.md; fails.md 2026-09-09 (171)).
  - ledger/identity: `"test": "node --experimental-strip-types --test src/__tests__/*.test.ts"` (ledger `package.json:13`, identity `:12`). The existing test imports `'../telemetry.ts'`, and `tsconfig.json:19-22` excludes `src/**/*.test.ts` from `tsc`. Under strip-types ESM, `require` is undefined, and no `createRequire` shim exists anywhere in either service. **Not found**, so it is created here.
  - notify/config: `"test": "tsc && node --test dist/__tests__/*.test.js"` (`:12`). Their `tsconfig.json` has `"module": "commonjs"` (`:4`) and includes tests (`:14-15`). The existing test imports `'../telemetry'`.
- `test:coverage` is `c8 … --lines 40` over the same globs (ledger `:14`, notify `:13`). A new `telemetry.export.test.ts` matches both `src/__tests__/*.test.ts` and `dist/__tests__/*.test.js`. `node --test` runs each file in its own process, so OTel state is isolated per file.
- The existing dynamic-import pattern is `await import('../services/eventNotifier.js')` at `services/xstockstrat-ledger/src/__tests__/eventNotifier.test.ts:18`.
- `@opentelemetry/api@1.9.1 build/src/diag/consoleLogger.js:15-20` saves the original console methods at module load. A `console.*` spy must therefore be installed before the first OTel load, and telemetry is then `await import()`ed (ledger insights.md 2026-10-14).
- Only the BSP *timer* path routes export errors to diag, so the tests set `OTEL_BSP_SCHEDULE_DELAY` (insights.md 2026-10-14, trap 2).
- The existing `telemetry.test.ts` statically imports `buildResource` and thus loads `@opentelemetry/resources` → api at import time. That is why the new test is a separate file (design.md § Tests).

**TDD**: `red-green required` (RED against pre-Step-6(c) `telemetry.ts`: no `/otlp/v1/traces` request; no diag `console.error`)

**Covers**: `AC-1` (raw Example row), `AC-3`

**Instructions** (one file per service; only the import style differs):
1. The top of the file has **no** static OTel or telemetry import. Import `test`, `after` and `mock` from `node:test`, plus `node:assert/strict` and `node:http`.
   - ledger/identity only: `import { createRequire } from 'node:module'; (globalThis as { require?: NodeRequire }).require = createRequire(import.meta.url);`. Add a ≤2-line comment: strip-types ESM has no `require`, and `telemetry.ts` lazy-requires its SDK.
2. Install `mock.method(console, 'error')`, `mock.method(console, 'warn')` and `mock.method(console, 'info')` **before** any OTel module loads.
3. Start a `node:http` receiver on `127.0.0.1:0`. It is keyed on paths ending `/v1/traces`. The first such request records path + `authorization` and replies `200`; later ones reply `400`.
4. Set `OTEL_ENABLED='true'`, `OTEL_EXPORTER_OTLP_ENDPOINT=\`http://127.0.0.1:${port}/otlp\``, `OTEL_EXPORTER_OTLP_HEADERS='Authorization=Basic dGVzdDprZXk='` and `OTEL_BSP_SCHEDULE_DELAY='50'`, and `delete process.env.OTEL_LOG_LEVEL`. Then:
   - ledger/identity: `const { initTelemetry } = await import('../telemetry.ts')`
   - notify/config: `await import('../telemetry')`
   - Call `initTelemetry()` once per process.
   - **Placement**: the env setup, dynamic import and `initTelemetry()` call go inside a `before()` hook in **all four** services. notify/config compile tests as CommonJS (`tsconfig.json` `"module": "commonjs"`), where top-level `await` is TS1378 and breaks `pnpm run build`.
5. AC-1 test:
   - End one span via `(await import('@opentelemetry/api')).trace.getTracer('t').startSpan('s').end()`.
   - Poll up to 5 s for the first `/v1/traces` request.
   - Assert path `/otlp/v1/traces` and `authorization === 'Basic dGVzdDprZXk='`.
   - Assert **no `console.error` call so far**. This guards the detector fix and design.md Open Risk 5.
   - Assert no `console.warn` call contains `[otel] init failed`.
6. AC-3 test: end a second span, then poll up to 5 s until a `console.error` call's joined args contain `OTLPExporterError` or `400`. Assert that, and again assert no `[otel] init failed`.
7. `after()`: `server.closeAllConnections(); server.close();`.
8. C-13: the env strings and receiver are scenario one-offs with no domain data. They stay inline, and no `src/__tests__/fixtures/` home is created.
9. If another 0.52.1 boot-time diag warn or error trips the "no `console.error`" assertion, narrow it to the resource-attributes message and record that in the Deviation Log (design.md Open Risk 1).

**Verification**:
```bash
for s in ledger identity notify config; do (cd services/xstockstrat-$s && \
  pnpm run test:coverage && pnpm run lint && pnpm run build ); done
# test:coverage enforces c8 --lines 40; build proves the ledger/identity import style does not break tsc (fails.md 2026-09-09 (171))
grep -n "__tests__/fixtures" services/xstockstrat-{ledger,identity,notify,config}/src/__tests__/telemetry.export.test.ts ; echo "expect none (C-13: no domain data)"
```

---

### Step 8 — service: UI — register the hook from `src/`, OTLP/HTTP from env, traces-only, WARN diag

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/instrumentation.ts` — delete (via `git mv`)
- `services/xstockstrat-ui/src/instrumentation.ts` — create (via `git mv`)
- `services/xstockstrat-ui/src/telemetry.ts` — modify
- `services/xstockstrat-ui/package.json` — modify
- `pnpm-lock.yaml` — modify (root)

**Reviewers**: xstockstrat-ui owner — no secret values rendered in UI (telemetry logs only the endpoint, never headers); Connect-RPC call safety (BFF header code untouched)

**Codebase Evidence**:
- `services/xstockstrat-ui/instrumentation.ts:1-6` sits at the **service root**: `export async function register() { if (process.env.NEXT_RUNTIME === 'nodejs') { const { initTelemetry } = await import('./src/telemetry'); initTelemetry(); } }`. `ls src/instrumentation.ts` → not found.
- The app uses `src/` (`src/app/`, `src/middleware.ts`), and Next.js loads only `src/instrumentation.ts` in a `src/` project (design.md § Chosen Approach).
- `git grep "instrumentation.ts"` shows no reference in `Dockerfile`, `Dockerfile.e2e`, eslint or playwright config. The only references are `docs/patterns/observability.md:28` (Step 11) and historical docs.
- `src/telemetry.ts`:
  - `:8` `require('@opentelemetry/exporter-trace-otlp-http')`
  - `:14` `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-collector:4318';`
  - `:17-25` `new NodeSDK({ resource: resourceFromAttributes({...}), traceExporter: new OTLPTraceExporter({ url: endpoint }), instrumentations: [] })`. The `url` is verbatim, so no `/v1/traces` is appended.
  - `:28` `console.info(\`[otel] tracing enabled → …\`)`
  - `:31-32` `catch` → `console.warn`
- `package.json:31-34` has `exporter-trace-otlp-http`/`sdk-node ^0.218.0` and `resources ^2.7.1`, with no `@opentelemetry/api`. The root lock resolves `0.218.0(@opentelemetry/api@1.9.1)` (`pnpm-lock.yaml:429-435`).
- `sdk-node@0.218.0 build/src/sdk.js:145-176`: when `configuration.logRecordProcessors`/`metricReaders` are absent, it calls `configureLoggerProviderFromEnv()` / `getMetricReadersFromEnv()`, which auto-start env-default OTLP logs and metrics pipelines. Passing empty arrays bypasses both, so the app stays traces-only per Operator Decision 3.
- `next.config.js:7` sets `output: … 'standalone'`, and `:8-14` `serverExternalPackages` includes sdk-node and exporter-trace-otlp-http. This stays unchanged: design.md rejects adding api (Symbol.for-keyed globals).
- The standalone server path is `services/xstockstrat-ui/server.js` inside `.next/standalone` (`Dockerfile:25,31`).
- PRESERVE `@AC-1`, `@AC-6 @feature-128` (`services/xstockstrat-ui/acceptance/ui-middleware-nodejs-runtime.feature`): the `NEXT_RUNTIME === 'nodejs'` dynamic-import guard is kept.

**TDD**: `red-green required` (paired with Step 9; Step 9's test fails while the hook is at the root and while the url is verbatim)

**Covers**: — (behaviour asserted by Step 9; build proof in Verification below)

**Instructions** (the order matters for RED):
- **(a)** Add `"@opentelemetry/api": "^1.9.0"` to `package.json` `dependencies`, then run `pnpm install` at the repo root. It resolves to the locked 1.9.1.
- **(b)** Author Step 9's `src/instrumentation.test.ts` (unstaged) and capture **RED #1** with `pnpm exec vitest run src/instrumentation.test.ts`. AC-2 fails because `./instrumentation` does not exist in `src/`. That absence is the defect itself.
- **(c)** Run `git mv services/xstockstrat-ui/instrumentation.ts services/xstockstrat-ui/src/instrumentation.ts` and change its import to `await import('./telemetry')`, keeping the `NEXT_RUNTIME === 'nodejs'` guard. Capture **RED #2** with the same command. The hook now loads, but AC-1 fails (POST goes to `/otlp`, not `/otlp/v1/traces`) and AC-3 fails (no diag `console.error`).
- **(d)** In `src/telemetry.ts`:
  - Change `:14` to `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;`, deleting the fallback.
  - Add the same lazy diag block as Step 6(c) inside the `try`, before `new NodeSDK`: `require('@opentelemetry/api')`, then `diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN)` only when `!process.env.OTEL_LOG_LEVEL`.
  - In the `NodeSDK` config, set `traceExporter: new OTLPTraceExporter()` and add `metricReaders: []` and `logRecordProcessors: []`, with a ≤2-line constraint comment: `// Empty arrays stop sdk-node auto-starting env-default OTLP metrics/logs (traces only).`
  - Add the one-line exporter constraint comment as in Step 2. Leave `resourceFromAttributes`, `instrumentations: []`, SIGTERM and `catch` unchanged.

**Verification**:
```bash
pnpm install --frozen-lockfile
cd services/xstockstrat-ui
test ! -e instrumentation.ts && test -f src/instrumentation.ts && grep -n "NEXT_RUNTIME === 'nodejs'\|import('./telemetry')" src/instrumentation.ts
grep -c "otel-collector:4318\|url: endpoint" src/telemetry.ts   # expect 0
pnpm run lint
pnpm run build && ls .next/server/instrumentation.js            # AC-2 build proof: Next.js compiled the src/ hook
LOG=$(mktemp); OTEL_ENABLED=true OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 PORT=3999 HOSTNAME=127.0.0.1 \
  node .next/standalone/services/xstockstrat-ui/server.js > "$LOG" 2>&1 & PID=$!; sleep 15; kill $PID
grep -m1 "\[otel\] tracing enabled" "$LOG"   # macOS/Linux-portable (no GNU timeout)
# If next build or the standalone boot cannot run in-session, AC-2 rests on Step 9's register() test plus the
# file-location assertion. Record that in the Deviation Log (design.md Open Risk 3).
```
**Deployment files**: as in Step 6, `OTEL_LOG_LEVEL` is optional and unset everywhere; no compose or `.do` change.
**Frontend e2e (B3)**: no Playwright step. The Playwright suite runs with `OTEL_ENABLED` unset, so `initTelemetry` returns at its gate and the hook move is a no-op there; existing e2e coverage applies unchanged.

---

### Step 9 — test: UI — AC-2 hook registration, AC-1 (raw) export, AC-3 diag-logged 400

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/instrumentation.test.ts` — create

**Reviewers**: xstockstrat-ui owner — no secret values rendered in UI (test-only)

**Codebase Evidence**:
- `services/xstockstrat-ui/vitest.config.ts:19-20` has `environment: 'node'` and `include: ['src/**/*.test.ts']`, so `src/instrumentation.test.ts` is collected.
- `vitest.config.ts:25` scopes coverage to `src/lib/**` with thresholds 40 at `:29-33`. Telemetry sits outside that scope, so the gate is unaffected (recon.md Risks).
- `package.json` scripts: `"test:unit": "vitest run"`, `"test:coverage": "vitest run --coverage"`. CI runs `pnpm run test:coverage` (`.github/workflows/ci.yml:578`).
- The diag spy-before-load trap is the same as Step 7 (`@opentelemetry/api@1.9.1 consoleLogger.js:15-20`). design.md § Tests says the design probe captured a timer-path `OTLPExporterError` `"code":"400"` via `console.error` on 0.218.0 (ui) (context.md R2).
- C-12: this test uses no domain objects, only env strings and an inline receiver. Those are scenario one-offs, so it needs no `e2e/fixtures/` import or `INVENTORY.md` row.

**TDD**: `red-green required` (RED #1 / RED #2 captured in Step 8 (b)/(c); GREEN after Step 8 (d))

**Covers**: `AC-2`, `AC-1` (raw Example row), `AC-3`

**Instructions**:
1. The file has no static import of `./instrumentation`, `./telemetry` or `@opentelemetry/*`. Import `{ test, expect, vi, afterAll }` from `vitest`, plus `node:http` and `node:fs`.
2. Install `vi.spyOn(console, 'error')`, `vi.spyOn(console, 'warn')` and `vi.spyOn(console, 'info')` **before** any OTel load. Do not mock their implementations away; record the calls.
3. Use the same counter receiver as Step 7 (first `/v1/traces` → 200, later → 400). Set `NEXT_RUNTIME='nodejs'`, `OTEL_ENABLED='true'`, the endpoint `http://127.0.0.1:<port>/otlp`, `OTEL_EXPORTER_OTLP_HEADERS='Authorization=Basic dGVzdDprZXk='` and `OTEL_BSP_SCHEDULE_DELAY='50'`, and delete `OTEL_LOG_LEVEL`. Then `const { register } = await import('./instrumentation'); await register();`, once per file.
4. Tests:
   - **AC-2, file location:** `fs.existsSync(new URL('./instrumentation.ts', import.meta.url))` is true and `fs.existsSync(new URL('../instrumentation.ts', import.meta.url))` is false.
   - **AC-2, init:** some `console.info` call contains `[otel] tracing enabled`.
   - **AC-1:** end a span via `(await import('@opentelemetry/api')).trace.getTracer('t').startSpan('s').end()`, poll up to 5 s, then assert path `/otlp/v1/traces` and `authorization === 'Basic dGVzdDprZXk='`.
   - **AC-3:** end a second span and poll until a `console.error` call contains `OTLPExporterError` or `400`.
   - Every test asserts no `console.warn` contains `[otel] init failed`.
5. `afterAll`: `server.closeAllConnections(); server.close();`.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm exec vitest run src/instrumentation.test.ts
pnpm run test:coverage          # whole vitest suite + src/lib thresholds (40%)
pnpm run lint
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" src/instrumentation.test.ts ; echo "expect none — C-12 exempt (no domain objects)"
```

---

### Step 10 — config: local compose → collector OTLP/HTTP `:4318` for every service

**Status**: `done`
**Service**: `docker-compose.yml`, `packages/otel/`
**Files**:
- `docker-compose.yml` — modify
- `packages/otel/otel-collector-config.yaml` — modify (header comment only)

**Reviewers**: Platform Lead — port uniqueness and service-registry consistency (no config key is added, so the registry's `config`-row key owner does not apply)

**Codebase Evidence**:
- `docker-compose.yml` has `OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317` in 7 service blocks: marketdata `:283`, indicators `:316`, ingest `:354`, analysis `:395`, portfolio `:433`, trading `:469`, agent `:568`. The value `:4318` is already set for config `:133`, ledger `:166`, identity `:200`, notify `:235` and ui `:515`.
- The collector's own `OTEL_EXPORTER_OTLP_ENDPOINT` (`:62`) is its Grafana upstream and is **excluded**. The port mappings `:67-68` (`4317:4317`, `4318:4318`) stay.
- `packages/otel/otel-collector-config.yaml:6-8` reads "Receives OTLP from all xstockstrat services on: gRPC :4317 (preferred for Go and Python services) / HTTP :4318 (preferred for Node.js services)". The receivers at `:31` (grpc) and `:33` (http) are **kept**: design.md rejects removing `:4317` because it feeds the metrics/logs pipelines and telemetrygen smoke tests.
- The `:14-16` header-value comment ("Authorization header VALUE only: Basic <base64(instanceId:apiKey)>") is correct for the collector's `headers.Authorization` (`:56`) and stays unchanged.
- `.do/app.yaml:32-36` / `.do/app.dev.yaml:32-36` carry the OTEL keys as `YOUR_*_OTEL_EXPORTER_OTLP_*` placeholders. They are unchanged (recon.md Dependencies: no `.do` change).

**TDD**: `N/A (config — local compose env + comment; non-code-bearing)`

**Covers**: `AC-4` (verification grep with a recorded RED → GREEN)

**Instructions**:
0. **RED (AC-4)**: before editing, run the Verification `awk` and record its output — 7 of the 12 rows read `http://otel-collector:4317` — in the step's commit body. After the edit the same command shows 12 × `:4318`.
1. In `docker-compose.yml`, change the 7 `http://otel-collector:4317` service values listed above to `http://otel-collector:4318`. Touch no other line.
2. In `otel-collector-config.yaml`, rewrite the header comment `:6-8` to say that every xstockstrat service exports traces over OTLP/HTTP to `:4318`, and that the gRPC `:4317` receiver stays for other OTLP clients such as telemetrygen. Keep it to ≤3 lines and leave the receivers and exporter config unchanged.

**Verification**:
```bash
awk '/^  [a-z][a-z0-9-]*:$/{svc=$1} /^ +OTEL_EXPORTER_OTLP_ENDPOINT:/ && svc ~ /^xstockstrat-/ {print svc, $2}' docker-compose.yml
# AC-4: expect exactly 12 lines (one per xstockstrat-* service; the collector's own upstream at :62 is excluded), every value http://otel-collector:4318
grep -c "otel-collector:4317" docker-compose.yml   # expect 0
docker compose config --quiet && echo compose-valid   # if docker is available; otherwise note it in the Deviation Log
grep -n "endpoint: 0.0.0.0:4317\|endpoint: 0.0.0.0:4318" packages/otel/otel-collector-config.yaml   # both receivers kept
```

---

### Step 11 — docs: one OTLP/HTTP export path and one header format; PLAT-3; teardown

**Status**: `pending`
**Service**: `docs/`, `packages/otel/`, `services/xstockstrat-ui/` (CLAUDE.md only), `.env.example`
**Files**:
- `docs/patterns/observability.md` — modify
- `docs/setup/grafana-cloud.md` — modify
- `docs/setup/digitalocean.md` — modify
- `.env.example` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `docs/context-constitution.md` — modify (PLAT-3)
- `packages/otel/docs/context-constitution.md` — modify
- `packages/otel/CLAUDE.md` — modify (constitution-pointer line)
- `docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/observability.md`:
  - `:5` "Services push OTLP to `otel-collector:4317`"
  - `:16` local `http://otel-collector:4317`
  - `:17` production `Authorization=Basic <token>`
  - `:28` "Next.js | `src/telemetry.ts` + `instrumentation.ts`"
- `docs/setup/grafana-cloud.md`:
  - `:13` `otel-collector:4317/4318`
  - `:106-107` "gRPC :4317 (Go + Python services connect here) / HTTP :4318 (Node.js services connect here)"
  - `:118-119` the per-language compose endpoints
  - `:175,:179` "Go services use gRPC OTLP … Python services use gRPC OTLP"
  - `:150,152` GitHub secret value `Basic <base64(instanceId:apiKey)>` (correct)
  - `:329` the troubleshooting header-format hint
- `docs/setup/digitalocean.md:430`: `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64-token>`.
- `.env.example:81-86` documents two forms: Docker "header VALUE only" and DO "standard OTel SDK key=value format: Authorization=Basic …".
- `.github/workflows/deploy.yml:162-163` and `scripts/do-inject-prod-secrets.py:73-74` both prefix `Authorization=`. Therefore one stored format, `Basic <base64(instanceId:apiKey)>`, serves the collector and the SDKs (Operator Decision 2, superseded per recon).
- `services/xstockstrat-ui/CLAUDE.md`: `:345` "OTel via `src/telemetry.ts`" and `:399` the `| OTel | src/telemetry.ts |` row. Neither names the hook.
- `docs/context-constitution.md:33` **PLAT-3** "OTLP export port is chosen by language runtime: Node.js/Next.js → `:4318`; Go/Python → `:4317`" cites stale compose lines `:127,158,…`.
- `packages/otel/docs/context-constitution.md:21` restates the split.
- `packages/otel/CLAUDE.md:4` (constitution-pointer) mentions "the confirmed OTLP port-by-runtime split `PLAT-3`" and the "`observability.md` port doc-lie".
- `docs/context-constitution-findings.md:17` is the row "`observability.md` states all services push OTLP to `otel-collector:4317`", with suggested action "encode the 4317-gRPC / 4318-HTTP split".
- Root `CLAUDE.md` § Teardown, and `.agents/context-forge.json` `scrubberExtraTargets: ["README.md", "docs/patterns/ui-ux-governance.md"]`. Neither has an OTel or port reference (`grep -n -i "otel\|4317\|4318" README.md docs/patterns/ui-ux-governance.md` returns nothing).
- design.md decisions: `docs/roadmap/implementation-roadmap.md` and `docs/roadmap/phase7-deviations.md:15-16` stay as historical records. The defect `.status` sidecar stays `triaged`. The defect report already carries its `## Correction` (`:78`) and is untouched.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `observability.md`:
   - `:5` → services export OTLP/HTTP to `http://otel-collector:4318`.
   - `:16` → `http://otel-collector:4318`.
   - `:17` → the stored value is `Basic <base64(instanceId:apiKey)>`. Deploy prefixes `Authorization=`, and the encoded `Authorization=Basic%20…` form is also accepted.
   - `:28` → `src/instrumentation.ts` (must live in `src/`) + `src/telemetry.ts`.
   - Add one sentence: exporters are constructed with no endpoint/url/insecure argument, so the SDK appends `/v1/traces` and reads headers from env.
2. `grafana-cloud.md`:
   - `:13`, `:106-107` and `:118-119` → every service uses `:4318`. The collector still listens on `:4317` for other OTLP clients.
   - `:175,:179` → all runtimes use OTLP/HTTP, and the SDK appends `/v1/traces` to the gateway URL.
   - `:329` → point at the single `Basic <…>` secret format, and note that export failures now appear in service logs.
3. `digitalocean.md:430` → set the GitHub secret to `Basic <base64(instanceId:apiKey)>` and note that deploy adds `Authorization=`.
4. `.env.example:81-86` → one format, `Basic <base64(instanceId:apiKey)>`. The collector uses it as the header value, and the deploy workflow prefixes `Authorization=` for the SDKs.
5. `services/xstockstrat-ui/CLAUDE.md:345,399` → name `src/instrumentation.ts` as the hook. It must stay in `src/` with its `NEXT_RUNTIME === 'nodejs'` guard.
6. **PLAT-3** (`docs/context-constitution.md:33`): rewrite as "every runtime exports OTLP/HTTP configured only by the spec env vars; never pass endpoint/url/insecure to an exporter". The why: an explicit option overrides `/v1/traces`, TLS and headers, and failed silently in all 12 services (feature 226). Evidence: the four exporter call sites, plus `docker-compose.yml` (12 × `:4318`), with refreshed line numbers. Update `packages/otel/docs/context-constitution.md:21` and the `packages/otel/CLAUDE.md:4` pointer to match.
7. `context-constitution-findings.md:17`: mark the row **RESOLVED (feature 226)**. The doc now states a single `:4318` path, and the port split it asked to document no longer exists. Touch only that row (fails.md 2026-09-09 (174)).
8. **Teardown** (root `CLAUDE.md` § Teardown): run `/context-forge:context-constitution refresh` scoped to the files above and fix the grounded drift. If the plugin is unavailable, re-read every touched context file against the code by hand and record both the unavailability and the manual reconciliation in the integration PR body.

**Verification**:
```bash
grep -n "4317" docs/patterns/observability.md docs/setup/grafana-cloud.md docs/context-constitution.md packages/otel/docs/context-constitution.md packages/otel/CLAUDE.md .env.example
# expect: only the "collector still listens on :4317 for other OTLP clients" mention(s); no per-runtime :4317 claim
grep -n "gRPC OTLP" docs/setup/grafana-cloud.md   # expect 0
grep -n "src/instrumentation.ts" docs/patterns/observability.md services/xstockstrat-ui/CLAUDE.md
grep -n "PLAT-3" docs/context-constitution.md packages/otel/CLAUDE.md packages/otel/docs/context-constitution.md
git diff --stat -- docs/roadmap/implementation-roadmap.md docs/roadmap/phase7-deviations.md docs/reports/   # expect empty
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation 1 — Step 6: non-frozen `pnpm install` bumped an unrelated transitive pin
- **Expected**: adding two direct deps changes only the four importer entries in the root `pnpm-lock.yaml`.
- **Actual**: `pnpm install` also re-resolved `@opentelemetry/otlp-transformer@0.52.1`'s snapshot dependency `protobufjs: 7.5.6 → 7.6.6`.
- **Disposition**: reverted that single line (both versions already exist in the lock); `pnpm install --frozen-lockfile` passes; the committed lock delta is importer-only.

### Deviation 2 — Step 7: "no `console.error` before the 400" assertion narrowed to exclude Node runtime warnings
- **Expected**: `console.error` sees nothing before the rejected export (design.md Open Risk 1 / Step 7 instr. 9).
- **Actual**: under `--experimental-strip-types` (ledger/identity), Node emits a `(node:<pid>) [MODULE_TYPELESS_PACKAGE_JSON] Warning …` process warning through `console.error` — not OTel diag output.
- **Disposition**: the shared `logged()` helper drops lines starting `(node:`; no OTel diag message was narrowed. All four services GREEN with the guard intact (the sync-detector fix is still guarded).

### Deviation 3 — Step 9: plain console recorders instead of `vi.spyOn`
- **Expected**: Step 9 instr. 2 — `vi.spyOn(console, 'error'|'warn'|'info')` installed before OTel loads.
- **Actual**: vitest 5.0.3 clears spy call history before each test, so calls recorded during `beforeAll` (the `[otel] tracing enabled` line from `register()`) were wiped — a false RED on AC-2 (probe: `beforeAll calls=1` → `test calls=0`).
- **Disposition**: the test installs plain recorder functions on `console.error/warn/info` (still before the first OTel load, restored in `afterAll`), which vitest's mock lifecycle does not touch. Assertions unchanged. Ledger: fails.md entry added.


### Deviation 4 — Steps 8/9: commit attribution of the hook rename
- **Expected**: the `git mv instrumentation.ts → src/instrumentation.ts` rename lands in Step 8's commit.
- **Actual**: Step 8's `git add` errored on the already-renamed source path, so the staged 0-line rename was swept into Step 9's commit `31c0b1e` (already pushed); Step 8's content changes (import fix, `telemetry.ts`, `package.json`, lock) land in the following commit. Commit `31c0b1e` alone does not build (moved file still imports `./src/telemetry`).
- **Disposition**: no force-push on the pushed branch; the integration PR squash-merges into `main-dev`, so no intermediate state reaches the trunk. All verification ran on the combined tree.
