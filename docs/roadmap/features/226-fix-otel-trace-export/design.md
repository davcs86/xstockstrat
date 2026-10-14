# Design: fix-otel-trace-export

**Created**: 2026-10-14
**Rounds**: 3 (quick mode, operator opted into rounds 2–3; termination: approved)
**Approved by**: user @ 2026-10-14
**Grounded in**: recon.md

---

## Chosen Approach

Every runtime exports traces over **OTLP/HTTP using the SDK's own spec env handling** — the exporter is
constructed with **no** endpoint/url/insecure argument and every hardcoded fallback endpoint is
deleted, so `OTEL_EXPORTER_OTLP_ENDPOINT` gets `/v1/traces` appended, TLS follows the scheme, and
`OTEL_EXPORTER_OTLP_HEADERS` supplies `Authorization` (empirically verified at the pinned versions,
recon.md § Patterns to REUSE). Internal-only: no consumer surface changes (C-14); the observable
outcome is traces per `service.name` in Grafana Cloud Tempo.

- **Go ×3** (`internal/telemetry/otel.go:23-32`): `otlptracehttp.New(ctx, otlptracehttp.WithTimeout(5*time.Second))`; fallback `"otel-collector:4317"` deleted; `newResource` untouched. Failure visibility already exists (default error handler → stdlib `log` → slog, recon.md Codebase Map).
- **Python ×4** (`app/telemetry.py:34-43`): deferred `opentelemetry.exporter.otlp.proto.http.trace_exporter.OTLPSpanExporter()`; fallback deleted; `_build_resource` untouched. Failures already surface via `logging` (exporter logs ERROR).
- **Node backends ×4** (`src/telemetry.ts`): lazy `require('@opentelemetry/exporter-trace-otlp-http')`, `new OTLPTraceExporter()`; fallback deleted. Inside the existing `OTEL_ENABLED` gate and `try`, before `new NodeSDK`: lazy `require('@opentelemetry/api')` and, **only when `OTEL_LOG_LEVEL` is unset**, `diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN)` (sdk-node registers its own logger when it is set — `sdk-node@0.52.1 sdk.js:46-50`). Pass `resourceDetectors: [envDetectorSync, processDetectorSync, hostDetectorSync]` from the already-direct `@opentelemetry/resources`, with a ≤2-line constraint comment: 0.52.1's default async detectors read `.attributes` early and emit a false `diag.error` on every boot once a logger exists (empirically confirmed; sync detectors remove it with an identical attribute set). `initTelemetry(): void` unchanged; `buildResource` untouched.
- **UI** (`xstockstrat-ui`): `git mv instrumentation.ts src/instrumentation.ts` (Next.js only loads `src/instrumentation.ts` in a `src/` project), import `./telemetry`, `NEXT_RUNTIME === 'nodejs'` guard kept. `src/telemetry.ts`: `new OTLPTraceExporter()`, fallback deleted, same lazy diag block, and `metricReaders: []` + `logRecordProcessors: []` so sdk-node 0.218 does not auto-start env-default OTLP metrics/logs pipelines (Operator Decision 3: traces only; `sdk-node@0.218.0 sdk.js:146-177`).
- **Dependencies**: `@opentelemetry/api ^1.9.0` added to ledger, identity, notify, config, ui (resolves to the locked 1.9.1; absent today → a lazy require would throw → tracing off). Backends replace `exporter-trace-otlp-grpc` with `exporter-trace-otlp-http ^0.52.0` (locked 0.52.1). Go `otlptracehttp v1.45.0` replaces `otlptracegrpc`. Python `opentelemetry-exporter-otlp-proto-http` replaces `-proto-grpc` (+ `uv lock`). Root `pnpm-lock.yaml`; stale per-service `pnpm-lock.yaml` files left untouched (orphaned — Docker/CI use the root lock).
- **Compose / collector / docs**: the 7 `:4317` service endpoints → `http://otel-collector:4318`; collector **keeps** its `:4317` receiver (metrics/logs pipelines + telemetrygen); comments, `.env.example`, `observability.md`, `grafana-cloud.md`, `digitalocean.md`, UI `CLAUDE.md`, PLAT-3 (`docs/context-constitution.md:33`) and its restatement (`packages/otel/docs/context-constitution.md:21`), findings row (NARROW per fails.md 174). One header format documented: `Basic <base64(instanceId:apiKey)>` (deploy.yml prefixes `Authorization=`; encoded form also accepted). `implementation-roadmap.md` left as a historical record.

**Tests** (one per runtime copy; each must show red on current code, green after — P-06):
- **Go**: `httptest`; AC-1 table-driven over raw and encoded header forms → `POST /otlp/v1/traces` + `Authorization: Basic dGVzdDprZXk=`; AC-3 400 server, `log.Default().SetOutput` capture (restored in cleanup), assert `400 Bad Request`, shutdown with deadline ctx.
- **Python**: opt-in `otel_reset` fixture in `tests/conftest.py` (fresh `Once()`, provider shutdown, `NO_PROXY=127.0.0.1`, no-op grpc instrumentor); `ThreadingHTTPServer`; AC-1 parametrized both forms; AC-3 `caplog` asserts `code: 400`; agent non-blocking test repointed to `proto.http`.
- **Node**: new `src/__tests__/telemetry.export.test.ts` per service (separate file: the existing resource test loads `@opentelemetry/api` at import, and `DiagConsoleLogger` binds console at module load). Spy `console.error/warn/info` **before** the first OTel load, then `await import()` telemetry (per-runner import style; ledger/identity `globalThis.require` shim). `OTEL_BSP_SCHEDULE_DELAY=50`, `delete OTEL_LOG_LEVEL`, one init per process; counter receiver keyed on `/v1/traces` (first → 200 for AC-1, later → 400 for AC-3). AC-1 (raw form): path + header + **no `console.error` before the 400 phase** (detector-fix guard); AC-3: `console.error` contains `OTLPExporterError` / `400`; every test asserts no `[otel] init failed`; `after()` → `closeAllConnections()` + `close()`.
- **UI**: `src/instrumentation.test.ts` (vitest): spy-first, `NEXT_RUNTIME=nodejs`, `await import('./instrumentation')`, `register()`; AC-2 `console.info` `[otel] tracing enabled` + receiver got `/otlp/v1/traces`; AC-1 raw + AC-3 via the same counter receiver; file-location assertion. Build proof (verification): `next build` → `.next/server/instrumentation.js`, then boot `.next/standalone/server.js` with `OTEL_ENABLED=true` and grep `[otel] tracing enabled`.
- **AC-4**: verification-only grep of the 12 service blocks in `docker-compose.yml` (excludes the collector's own `:62`).
- Node/UI cover the raw Example row of AC-1; Go/Python cover both rows — the impl-spec coverage table states this (C-15).

**Step order** (one commit each; dependency + lock lands *before* RED capture in steps 4–5 so RED fails on behaviour, not `MODULE_NOT_FOUND`): 1 acceptance + product-spec reconcile → 2 Go ×3 → 3 Python ×4 → 4 Node ×4 (+ `pnpm lint`, `tsc`, both runners) → 5 UI → 6 compose/collector/docs + context-forge teardown.

## Rejected Alternatives

- Remove the collector's `:4317` receiver — feeds the out-of-scope metrics/logs pipelines and the documented telemetrygen smoke tests.
- Add `@opentelemetry/api` to `serverExternalPackages` — api globals are `Symbol.for`-keyed, so a bundled and an external copy already share state.
- Child-process (stderr) test harness — strip-types ESM breaks the lazy `require` in a child too; per-file process isolation already gives a clean load order at lower cost.
- `initTelemetry()` returning a shutdown handle — test-only API surface; the BSP timer path plus receiver assertions suffice (C-18).
- EXTEND `platform.feature` `@AC-1 @feature-171` with `xstockstrat-ui` — hand-authored durable rule with no backing test; out of scope.
- Drop Go `WithTimeout(5s)` — the 10 s default outlives `main.go`'s 5 s shutdown context.
- Encoded `Authorization=Basic%20…` as the canonical header — deploy produces the raw form and every SDK parses it; would force a needless secret change.
- `autoDetectResources: false` — silently drops host/process/env resource attributes.
- Accept the per-boot `Accessing resource attributes…` diag error — a false ERROR that pollutes the very signal FR-3 creates.
- Bump Node backends to sdk-node 0.218 / resources 2.x — removes the detector workaround but rewrites `buildResource` ×4 (feature-171 guard) for a SEV-3 fix.
- `OTEL_METRICS_EXPORTER=none` / `OTEL_LOGS_EXPORTER=none` in deploy env — config-dependent, needs both `.do` specs and compose; the code-level empty arrays are self-contained.

## Open Risks

- [ ] Another 0.52.1 boot-time `diag.warn/error` could trip the Node "no `console.error` before 400" assertion — if seen, narrow the assertion to the resource message and record it in the Deviation Log (step 4).
- [ ] `uv lock` may move ingest from sdk 1.41.1 to 1.42.x; the AC-3 assertion is pinned to `code: 400` only (step 3).
- [ ] `next build` + standalone boot is heavy; if it cannot run in the session, AC-2's hook-registration proof rests on the vitest `register()` test + file-location assertion, recorded as a deviation (step 5).
- [ ] `go.work.sum` may change on `go mod tidy` — add to step 2 Files via Deviation Log, never silently (step 2).
- [ ] The mixed resources 1.30.1 (detectors) / 1.25.1 (sdk-node merge) path is verified by probe, not by a production run — the step-4 no-`console.error` assertion is the regression guard.

## Constitution Rules Touched

- `C-01` / `F-04` — honored by: every path/symbol cited from discovery digests or installed sources at pinned versions.
- `C-08` / `P-06` — honored by: one paired regression test per runtime copy, each with an observed red on current code (deps-first ordering in steps 4–5).
- `C-10` — honored by: all 12 duplicated telemetry copies change in lockstep, one step per runtime family.
- `C-13` — honored by: Python fixtures in `tests/conftest.py`; no domain data used.
- `C-15` — honored by: AC-1 Scenario Outline with raw + encoded Examples; each `@AC` traced to named tests; partial-row coverage stated.
- `C-16` — honored by: all 9 recon business rules PRESERVE (below).
- `C-18` — honored by: least mechanism — SDK env handling instead of URL/header code; one diag line, one detector option, two empty arrays; no new abstractions.
- `F-02` / `F-03` — honored by: work lands on the pinned branch via PR #1246 to `main-dev`.
- `F-05` — honored by: each step commits only after its verification passes.
- `F-06` / `F-07` — honored by: no DB, no config keys.
- `F-08` — honored by: exact per-step Files lists including `go.sum`, `uv.lock` ×4, `pnpm-lock.yaml`, `packages/otel/docs/context-constitution.md`; defect `.status` sidecar excluded (stays `triaged`).

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @feature-171` "A telemetry module's built Resource no longer carries the trading_mode attribute" (`docs/sdd/business-rules/platform.feature`) — not regressed by: `buildResource` / `newResource` / `_build_resource` untouched; sync detectors add the same host/process/env attributes as the defaults, never `trading_mode`.
- PRESERVE `@AC-2 @feature-171` "Telemetry init remains non-blocking…" (`platform.feature`) — not regressed by: all new requires and diag setup inside the existing gate + `try`.
- PRESERVE `@AC-3 @feature-171` "The dashboards README documents the emitted attribute set…" (`platform.feature`) — not regressed by: `packages/otel/dashboards/README.md` untouched.
- PRESERVE `@AC-4 @feature-210` "mTLS is enforced identically…" (`platform.feature`) — not regressed by: the OTLP sink is not an inter-service hop; startup order of the `MTLS_*` check unchanged.
- PRESERVE `@AC-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (`platform.feature`) — not regressed by: no new instrumentation; existing instrumentors unchanged.
- PRESERVE `@AC-3 @feature-179` (`services/xstockstrat-ui/acceptance/ui-resume-halted-account.feature`) — not regressed by: BFF header code untouched.
- PRESERVE `@AC-1`, `@AC-6 @feature-128` (`services/xstockstrat-ui/acceptance/ui-middleware-nodejs-runtime.feature`) — not regressed by: hook keeps the `NEXT_RUNTIME === 'nodejs'` dynamic-import guard; middleware untouched; `next build` in verification.
- PRESERVE `@AC-7 @feature-207` (`services/xstockstrat-agent/acceptance/extract-tool-ssrf-hardening.feature`) — not regressed by: agent instrumentor and audit path unchanged; only the exporter class swaps.
