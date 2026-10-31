# Context: otel-metrics-logs-export

**Feature**: `docs/roadmap/features/274-otel-metrics-logs-export/feature.md`
**Product Spec**: `docs/roadmap/features/274-otel-metrics-logs-export/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/274-otel-metrics-logs-export/implementation-spec.md`

---

## Session 2026-10-21 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Source: root `docs/context-constitution-findings.md` row "metrics and logs" (Remedy: "New capability →
  `/sdd-story` to add metrics/logs export") and report
  `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md`.
- Operator decisions (binding, recorded 2026-10-21, answered in-session):
  - **NNN = 274, operator-specified.** max+1 was 254 (highest on main-dev and all `feature/*` branches: 253). This
    deviates from `feature-workflow.md` § Feature Numbering by explicit operator instruction; 254–273 are unused.
  - **Ordering vs feature 250: "250 lands first, 274 after".** 250 (`fix-otel-metrics-logs-gap`,
    implementation-ready, operator decision "Narrow to traces") ships as specced and removes the metric/log-backed
    alerts and panels; 274 then adds export and restores them (FR-6). Recorded as a hard row in `merge-order.md`.
    The design must build on 250's landed state, including its produced-signals guard.
  - **This feature reverses feature 226 Operator Decision 3 (traces only)** for metrics/logs. The operator
    requested it explicitly (C-11 sign-off for a new capability).
  - **Logs path: in-process OTLP log bridge** (Go slog, Python logging, Node winston → LoggerProvider → OTLP/HTTP
    `/v1/logs`); DO `log_destinations` / collector filelog rejected.
  - **`platform.otel.enabled` live switch: not implemented; fix the docs.** Out of 274's scope. The phantom claim
    in `docs/patterns/observability.md` was removed and its root findings row marked resolved in the same docs-only
    change that filed this story (outside SDD, per root CLAUDE.md: docs-only edits are out of the entry-point rule).
- Open forks deferred to `/sdd-design` (see product-spec Open Questions): FR-2 series-name parity across
  languages, cardinality budget, and whether 250's `trace-derived-alerting` follow-up should cite 274 instead.

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Pass 1: FAIL on criterion 9 (7 unchecked Open Questions), plus warnings: FR-2/AC-2 series-name conflict (C-15),
  thin AC coverage of FR-1/3/4/5/6 (C-15), AC-3 log text not in code, deployment env parity (C-1).
  Fixed: series name is the contract (a rename needs operator sign-off and a superseding AC); design forks moved to
  "Deferred to /sdd-design", ledger traps to "Known Traps"; AC-3 rebased on the real line
  `servicer.py:799-800` ("running backtest id=…"); added AC-10..AC-14; env parity stated in FR-1.
- Finding carried to design: the pre-250 scoring-stall regex `ScoreStrategy|RunBacktest` matches no line analysis
  emits, so FR-6 must re-derive that rule (recorded in FR-3).
- Pass 2: PASS WITH WARNINGS (5), all fixed: stale Out-of-Scope pointer; AC-6 made concrete (≤1 s startup delta);
  AC-9 extended to PLAT-3, OTEL-1/OTEL-2, packages/otel docs + findings; AC-1/AC-10 marked representative;
  `OTEL_ENABLED` per target stated (dev "true", prod "false", compose off) and the prod flip scoped out as a separate
  operator rollout step after the cost budget (default chosen by reviewer-fix; operator may override).
- Warnings remaining: none.
- Overlap findings (no FAIL): file-level with 250 on `packages/otel/alerts/*`, dashboards, the produced-signals
  guard and the FR-7 docs (covered by the existing `merge-order.md` row); rebase-only WARN with 252 on identity
  `src/__tests__/telemetry*.test.ts`; soft env-file overlap with 084/242; semantic coupling with 245 (relies on
  `xstk-error-rate-high`); 250's `trace-derived-alerting` placeholder is a possible duplicate (deferred to design).
- Tooling drift noticed (not fixed here, out of scope): `.claude/skills/sdd-review/reference/overlap-check.md:12-13`
  greps `feature.md` for status, but status lives only in `status.md`.

## Session 2026-10-21 — sdd-design (Phase 0 checkpoint)

- Mode: full debate. Operator steer: "using 250 as base design" — design builds on 250's landed end state.
- Phase 0 Recon written (`recon.md`). Pinned-SDK probe: Go otelgrpc v0.52 emits `rpc.server.duration` (ms);
  Python instrumentation-grpc 0.63b1 and Node instrumentation-grpc 0.52.1 emit **no** RPC metric (R1).
- Top risks carried into grilling: R1 (7/10 backends need a custom recorder), R2 (Grafana `service_name` label
  promotion unproven), R3 (scoring-stall rule must be re-derived), R10 (250 guard has no produced-path mechanism),
  R11 (250's `trace-derived-alerting` follow-up).

## Session 2026-10-21 — sdd-design (Round 1 checkpoint)

- Proposer R1: span-derived `rpc.server.duration` SpanProcessor for py/node (Go native otelgrpc), env-only meter+
  logger providers, log bridges (otelslog MultiHandler / root LoggingHandler with filter / winston-transport /
  UI serverLog.ts), dev gate G1 before assets, 250 guard Part 1 → produced-signals registry, live-loop heartbeat
  line as stall signal, drop 4 extra otelgrpc instruments via View.
- Orchestrator probes: Go 1.27 has `slog.NewMultiHandler`; `@opentelemetry/winston-transport@0.5.0` deps
  `api-logs ^0.52.0` (compatible with Node 0.52 line).
- Adversary R1: NEEDS WORK, no Floor breach. Folded technical fixes: (1) sdk-node `spanProcessors` drops the
  implicit traceExporter → list BatchSpanProcessor explicitly (C-16 @AC-1 @feature-226); (2) JS api 1.9.1 has no
  proxy MeterProvider → bind histogram lazily after start; (3) Node flush must start in shutdown(), not in
  tryShutdown (long-lived streams block it); (5) pre-250 panels use `{platform=…}` / `| json` / OTLP-failure-in-Loki
  selectors that won't be produced → per-panel decision; (6) stall rule needs `noDataState: Alerting`;
  (11) Python `LoggingHandler` deprecated in sdk 1.42.1; (12–13) status fix-up gaps (span ERROR status, cancel→1,
  non-integer node codes→2); (14) shared golden status vectors; (15) guard fails if a sampler env is set;
  (16) broader metric-identifier extraction; (17) createRequire under ESM; (18) Python atexit double-shutdown;
  (19) stall uid meaning change recorded.
- Open operator forks (R1 gate): AC-10 agent/ui empty-export; Go trace correlation; where G1 runs; 250 story +
  guard Part 2 CHANGE.
- Operator decisions at R1 gate (binding, 2026-10-21), verbatim answers:
  - AC-10 agent/UI: "Agent should have metrics, UI should have metrics in the nextjs backend layer" — agent and the
    UI's Next.js server (BFF/route-handler) layer each emit a real metric; AC-10 rows stay valid.
  - Go trace correlation: "Retrofit all slog calls" — every Go slog call with a context in scope moves to its
    `*Context` variant (trading, portfolio, marketdata).
  - G1 location: "Two PRs via dev" — PR-A runtime export → main-dev → dev; G1 evidence on dev Grafana recorded here;
    PR-B assets/guard/docs against proven names.
  - Feature 250: "Amend 250 before it runs" — 250's spec is amended pre-execution so its follow-up citation points
    at feature 274 (no `trace-derived-alerting` story) and Part 2 is noted for retirement by 274.
    **C-16 CHANGE sign-off**: operator approves 274 retiring 250's guard Part 2 ("docs list only exported signals")
    — record mirrored into 250's context.md when amended.

## Session 2026-10-21 — sdd-design (Round 2 checkpoint)

- Proposer R2: P-0 (amend 250) → PR-A (runtime, all 12 + Go *Context retrofit via sloglint `context: scope` +
  agent `mcp.tool.duration` ServerMiddleware + UI Connect-interceptor `rpc.client.duration` + `serverLog` +
  analysis heartbeat + golden status vectors + egress audit; no docs/ or packages/otel/ edits) → G1 (7 fixed
  queries on dev Grafana) → PR-B (registry/guard, alerts w/ noDataState, mute timing, per-panel dashboards, docs,
  C-16 CHANGE). Node: explicit BatchSpanProcessor, lazy meter, transport attached after start, awaited+bounded
  shutdown, createRequire. Python: SDK LoggingHandler pinned <1.43, atexit flush, ingest pins raised.
- Orchestrator verification: mcp 2.3.0 `ServerMiddleware` exposes `ctx.method` + raw `ctx.params` (tool name)
  before validation; request failures raise `MCPError` (`mcp/server/context.py:146-160`).
- Adversary R2: NEEDS WORK, approvable once folded; no Floor breach (F-09 conditional: re-check 250 untouched
  right before P-0). Strongest proposer risk refuted: py `context.abort` and grpc-js `callback({code})` set
  `rpc.grpc.status_code` (`_aio_server.py:29-37`, `serverUtils.js:75-83`).
  Blocking (folded): (1) py unhandled exception → attr 0 + exception event → record 2 (CancelledError 1);
  (2) streaming RPCs (WatchConfig/StreamEvents/StreamOrderUpdates/StreamQuotes) end on every deploy → would fire
  restored p99/error alerts; (3) Go SIGTERM flush blocked by open streams in GracefulStop → ForceFlush before
  GracefulStop / bounded Stop fallback.
  Non-blocking (folded): /otlp prefix tests for metrics+logs; agent tool set derived at runtime (no "45");
  agent outcome=error for raise and isError; PR-A doc-drift window needs operator waiver + service-docs teardown;
  P-0 wording "implement now; retire in 274 PR-B", re-run /sdd-review 250 impl-spec, merge-order 250→274 PR-B;
  feature branch re-sync between PRs, status stays in-progress; sloglint no-mixed-args=false; shared bucket
  boundaries; unsampled-traceparent asymmetry accepted; UI meter lazy; UI flush best-effort; Go otelslog/sdk-log
  API verification at spec step 0; identity email PII decision before PR-A merges.
- Operator decisions at R2 gate (binding, 2026-10-21), verbatim answers:
  - Gate: "Run round 3" (not yet approved; PR-A doc-drift waiver + Part 2 timing still pending the R3 gate).
  - Streams: "Exclude in alert/panel queries" — recorders keep recording streaming calls (FR-2 unchanged);
    restored rules and p99/error panels exclude streaming methods via an `rpc_method` filter pinned by a guard test.
  - UI metric: "BFF route histogram" — `http.server.duration` per Next.js BFF route (segment + service) and HTTP
    status; no per-method gRPC client histogram. (Supersedes the R2 `rpc.client.duration` proposal.)
  - Identity email: "Replace with user_id everywhere" — `identityServiceImpl.ts:151-154` logs the user id instead
    of the email on stdout and OTLP (small identity behaviour change; PII removed at source).

## Session 2026-10-21 — sdd-design (Round 3 checkpoint)

- Proposer R3: final consolidated design (P-0 → PR-A → G1 → re-sync → PR-B) with R2 findings + R2-gate decisions;
  py/node status rule (non-zero attr → error evidence → ERROR status → 0) + golden vectors; stream exclusion via
  proto-derived guard Part 4; UI `http.server.duration` in `createDispatch` (`bffShared.ts:115-152`); agent
  `ToolMetricsMiddleware` (`mcp.tool.duration`, `gen_ai.tool.name`, tool set from `list_tools()`); identity
  `{ email }` → `{ user_id }`; Go ForceFlush → bounded GracefulStop/Stop; AC-15..AC-21 appended.
- Orchestrator verification: Go SDK default buckets == py/node (`sdk/metric@v1.45.0/reader.go:206`); consistent Go
  set at otel v1.45.0 = sdk/metric + otlpmetrichttp v1.45.0, log/sdk-log/otlploghttp v0.21.0, otelslog v0.20.0
  (latest log modules need otel v1.47.0); golangci-lint v2.14.0 bundles sloglint v0.12.0 with `context` and
  `no-mixed-args` (default true) options.
- Adversary R3: NOT APPROVABLE as written, APPROVABLE once B1/B2 folded; no Floor breach; R2 blockers (1),(3)
  verified resolved. B1: connect `untilFirst` (`handler-factory.js:277-280`) makes UI server-stream duration =
  time-to-first-message (StreamAlerts idle for hours) → record unary only (`methodKind`), try/finally.
  B2: guard Part 4 must match `(count|bucket|sum)` and exempt only templating `label_values`.
  Non-blocking: AC-18 12 s bound > compose 10 s default → 3 s fallback; py CancelledError also covers deadline
  (records 0 vs Go 4) → interceptor or documented divergence; proto regex tolerate `rpc Name (` + comments, fail on
  stream/unary name collision; agent outcome=error for any exception; UI `/accounts` + ledger export unwrapped;
  recorder duplication accepted (C-18); doc-drift waiver must be recorded in PR body with manual reconciliation.
- Operator decisions at R3 gate (binding, 2026-10-21), verbatim answers:
  - Gate: "Approve" — design approved with B1/B2 + folded non-blocking fixes (3 s GracefulStop fallback, agent any
    exception → error, robust proto parser, G1 requires one real non-zero py + node status emission).
  - Python deadlines: "Small interceptor" — grpc.aio server interceptor in the 3 py backends stamps 4 (deadline
    expired) / 1 (cancelled) on CancelledError before re-raise; parity with Go.
  - Doc drift: "Waive the drift" — operator waives the PR-A→PR-B docs under-statement window; PR-A teardown covers
    services/*/docs + service CLAUDE.md; PR-A body records the waiver + manual reconciliation (fails.md:670).
  - UI coverage: "Wrap REST routes too" — `/accounts/api/*` and `/trader/api/ledger/export` route handlers are
    wrapped with the same recorder; every segment reports.

## Session 2026-10-21 — sdd-design

- Phase 0 Recon: wrote recon.md (12 runtimes + packages/otel; reuse: per-runtime resource builders + env-only
  exporters, fake-receiver /otlp tests, 250's guard/fence/otel-signals job).
- Phase 1 Grilling: 3 rounds (full). Chosen approach: P-0 amend 250 → PR-A runtime export (span-derived
  rpc.server.duration for py/node, otelgrpc for Go, otelslog/LoggingHandler/winston-transport/serverLog bridges,
  agent mcp.tool.duration, UI BFF http.server.duration, py cancel/deadline interceptor, Go *Context retrofit) →
  G1 dev proof → re-sync → PR-B registry + proto-derived stream-exclusion guard + restored alerts/dashboards/docs.
  Rejected: narrow-to-traces, per-language interceptors as primary recorder, instrumentation upgrade,
  recorder-side stream exclusion, UI per-method client histogram, console monkey-patch, log_destinations.
- Constitution rules touched: C-02, C-08, C-10, C-11, C-13, C-14, C-15, C-16, C-18, P-01..P-04, F-04, F-06, F-07,
  F-09. Floor breaches: none.
- Acceptance: appended AC-15..AC-22 (append-only; AC-1..AC-14 unchanged).
- Open Threads (target): G1 label/series proof (G1); real cross-language status parity (G1 q2); DO SIGKILL grace
  (PR-A spec step 0); UI Next.js span correlation (PR-A AC-11 ui row); unwrapped UI health/auth/oauth/audit routes
  (accepted); cost budget (G1 q7, prod flip out of scope); P-0 F-09 re-check (P-0).
- Status: spec-ready → design-approved.

## Session 2026-10-30 — sdd-spec

- Generated implementation-spec.md with 59 steps (PR-A steps 1-47, G1 gate step 48, PR-B steps 49-59). Status -> implementation-ready.
  Every `@AC-1..AC-22` scenario is covered by a `**Covers**` line (table in the spec's Scenario Coverage block).
- Key codebase findings (all re-verified against trunk @ `3968bcea`, feature 250 landed; they supersede stale recon/design premises):
  - **D1** Python locks already at `opentelemetry-sdk`/`exporter-otlp-proto-http` 1.45.1 and `instrumentation-grpc` 0.66b1 in all four
    services (recon said 1.42.1/0.63b1 and an ingest lag). Design's pin <1.43 / ==0.63b1 version bumps are void (the one dependency change is D8).
    Probe re-run at 1.45.1/0.66b1: no meter code in instrumentation-grpc; `abort`/`set_code` set `rpc.grpc.status_code`; SDK `LoggingHandler`
    still exists but is deprecated (its constructor warns).
  - **D8** (operator decision 2026-10-30, answer to the spec-session open question; supersedes the design's "keep the SDK handler"): the four Python
    services use `opentelemetry.instrumentation.logging.handler.LoggingHandler` from the new dependency `opentelemetry-instrumentation-logging>=0.66b1`
    (`pyproject.toml` + `uv lock` x4 in steps 16/18/20/24, `uv lock --check` verification). Probed in a throwaway venv at SDK 1.45.1: imports with
    `DeprecationWarning` as error, same `(level, logger_provider)` constructor, span-correlated `trace_id`/`span_id`, no default attributes
    (`log_code_attributes=False`), recursion filter works. `warnings.catch_warnings()` suppression dropped.
  - **D2** the three Python gRPC servers call `grpc.aio.server()` with no `interceptors=`; the cancel/deadline interceptor is a new argument
    (the OTel interceptor is inserted first by `GrpcAioInstrumentorServer`, so ours is inner).
  - **D3** all four Node services are CommonJS and `tsc && node --test dist/...` (no strip-types runner) - `createRequire` not needed.
  - **D4** Go `main.go` lines drifted from recon (re-cited in steps); slog bridge + bounded shutdown live in `internal/telemetry`
    (`WrapLogHandler`, `StopServer`) so they are testable (cmd/ is excluded from CI coverage).
  - **D5** notify fanout code is `src/fanout/{fanout,webPush}.ts`. **D6** UI lockfile is the repo-root `pnpm-lock.yaml`.
    **D7** the agent already has a `ServerMiddleware` precedent (`CallerPropagationMiddleware`, `tools.py:194`, appended `:381`).
  - Feature 250 landed state: guard Parts 1-3 + `.test.sh` + fixtures + `otel-signals` CI job; alerts file holds only `deleteRules`/`deleteMuteTimes`;
    one Tempo-only dashboard; pre-250 rule/panel/mute-timing bodies are recoverable with `git show 3968bcea^:<path>` (cited in PR-B steps).
  - Env parity needs no edit: 12 compose `OTEL_EXPORTER_OTLP_ENDPOINT` lines, `OTEL_ENABLED` anchor, global `.do/app*.yaml` envs; no sampler/BLRP env set.
  - Go modules verified resolvable at the design's pin set (otel 1.45.0 line + log 0.21.0 + otelslog 0.20.0); Go 1.27 `slog.NewMultiHandler` present.
- **DO SIGKILL grace (step 1), resolved 2026-10-30** from the official page https://docs.digitalocean.com/products/app-platform/how-to/configure-termination/ :
  `termination.grace_period_seconds` default 120 s (max 600 s), `termination.drain_seconds` default 15 s (max 110 s); no `termination` block in
  `.do/app.yaml` / `.do/app.dev.yaml`, so 120 s applies and the 10 s shutdown bounds fit. The page does not name component types.
- Open for `/sdd-review impl-spec`: G1 label/series names (step 48).

## Session 2026-10-30 — sdd-review impl-spec (advisory)

- Result: **14 failures, 30 warnings, 15 passes** (advisory — did not block; lifecycle unchanged, `implementation-ready`). The criteria
  reviewer had no shell (no command was run); the blocking claims below were re-verified against the tree before recording.
  Spec revision reviewed: commit `e4b0beea` (includes D8: `opentelemetry-instrumentation-logging` handler; DO grace period verified).
- Unresolved ✗ carried into execution (Floor items first):
  - [x] **Step 43 (F-08, C-10, C-18)**: adds a third `segment` param to `createDispatch` (`bffShared.ts:112-115`, 2 params today); callers
    `insightsBff.ts:218`, `configUiBff.ts:104`, `traderBff.ts:172` are not in Files; also 7 files. Add callers or split the step.
  - [x] **Steps 29, 32, 35, 38 (F-08)**: Instruction 2 requires exporting `telemetryStarted()` from `src/telemetry.ts`; Files omits
    `src/telemetry.ts` and steps 28/31/34/37 never add it. Add the file to Files or move the export into the telemetry steps.
  - [x] **Steps 4, 8, 12 (F-05, B3 ordering)**: change `Init` to a three-value return; the existing tests call `shutdown, err := Init(ctx)`
    (`trading|portfolio|marketdata/internal/telemetry/otel_test.go:59`), and `go vet`/`golangci-lint` compile test files, so Verification
    cannot pass until the later test step. Update those callers in the same step or move the build-only check.
  - [x] **Steps 7, 11, 15 (F-08)**: Files is a prose directory entry, not exact stageable paths; no stated coverage threshold; `Covers` claims
    AC-11 that the step itself disclaims. List exact `*_test.go` paths or fold the `*Context` retrofit gate into steps 6/10/14.
  - [x] **Step 48 (F-05)**: Verification `grep -n 'G1' context.md` already matches (11 hits) before any operator answer; use dated
    `G1 q1..q7:` markers. Spell out that the PR-A squash-merge to `main-dev` and merge-back are operator-owned hand-offs outside the
    `/sdd-execute` loop (F-02/F-03 note).
  - [x] **Steps 25, 27 (C-08)**: `pytest --cov=app` has no `--cov-fail-under=N`.
  - [x] **Steps 16, 18, 20, 24 / D8**: Instruction 2 still lists `opentelemetry.sdk._logs.{LoggerProvider,LoggingHandler}`; contradicts Instruction 3
    (import `LoggingHandler` from `opentelemetry.instrumentation.logging.handler`). Also: the subprocess SIGTERM tests (17, 19, 21, 25) install
    `sys.exit(0)` instead of the real handler (`indicators/app/main.py:87-90` only schedules `grpc_server.stop`), so the atexit flush path is
    not exercised; and no assertion proves the new import path (add `-W error::DeprecationWarning`).
  - [x] **Step 47**: Verification `git diff --stat -- docs packages/otel` is never empty (steps 1/3 edit `docs/roadmap/**/context.md`) and has
    no base ref; use `git diff --stat origin/main-dev -- docs packages/otel ':!docs/roadmap'`.
- Warnings carried (non-blocking, full list in the review output): Steps 5/9/13 use `slog.Warn` where `WarnContext(ctx, …)` is needed for
  trace correlation; Step 13 AC-18 is a function-sequence test, not a process exit within 10 s; Steps 30/33/36/39 prove AC-2 only with
  hand-built spans (no real gRPC `NOT_FOUND` call) and omit AC-2 from `Covers`; Steps 6/14/43 exceed 5 files (C-18); Steps 49/50/53 Verification
  is already green before the change (no red); Step 41 shares a receiver fixture across test files not in Files (C-13); Step 58 lists
  `platform.feature` as "edit only if instructed" but nothing instructs it; AC-9 verification is partial. Line drift to refresh:
  `servicer.py:799-800` is `:836`, `live_loop.py:334-345` is `:329-343`, `tools.py:194` is `:190`, `_LOGGER_PROVIDER_SET_ONCE` is
  `_logs/_internal/__init__.py:422-423`, guard `FOLLOWUP` literal is `:20`.
- Overlap findings: **no FAIL-level** (274 adds no config keys, proto fields or migrations). WARN-level shared files with in-flight features, none
  in `merge-order.md` except 274↔250: `.github/workflows/ci.yml` (278 `config-wiring` job); marketdata `cmd/server/main.go` and
  `marketdata_service.go` (215, 255); analysis `app/main.py`, `engine/live_loop.py`, `tests/test_live_loop.py` (215), `tests/conftest.py`
  (215, 275); ledger `package.json`/`pnpm-lock.yaml` (257); trading `go.mod`/`go.sum` (249). Rebase-only; optional soft merge-order rows
  274↔215, 274↔255, 274↔278, 274↔275 left to the operator. 250 is landed and consistent with 274's guard assumptions.

## Session 2026-10-31 — sdd-review impl-spec re-runs and fixes (advisory)

- **Pass 1 findings fixed** (commit `9190d2be`): the eight [x] items above, plus line-drift refresh and `slog.WarnContext` wording.
- **Pass 2** (spec-reviewer, no shell): 2 FAIL, 27 WARN, 30 PASS, 0 Floor. All but one of the earlier failures confirmed closed. New FAILs: step 46
  (called `createDispatch` with a third argument that step 43 had removed; listed `bffDeadlines.test.ts` as modified with nothing to change) and
  step 57 (its grep matched the roadmap history, so it could never be empty). Fixed in `8437aede`, together with: RED-capture scope, AC-2 now proven
  by one real in-process gRPC `NOT_FOUND` call per Node service (steps 30/33/36/39), a shared OTLP receiver fixture for identity (step 41),
  `handler.service.typeName` verified against `@connectrpc/connect` 2.1.1 (step 43), and discriminating Verification lines on 20 steps.
- **Pass 3** (spec-reviewer, no shell): 3 FAIL, 17 WARN, 39 PASS. The three FAILs were one defect that was **already in the original spec text** (passes 1 and 2 missed it; not introduced by the fixes): steps 5/9/13
  told the executor to export `serverMetricViews()` from `otel.go`, which is not in their Files, and steps 4/8/12 never created it (F-08/F-04).
  Fixed: steps 4/8/12 now create the helper (its doc comment carries the `rpc.server.duration` producer literal for the step-49 registry), steps 5/9/13
  only use it (mechanically checked). Also fixed: RED mechanics when the service step is already committed (`git checkout <pre-step commit> -- <non-test
  files>`; build/import/compile failure accepted as RED in all languages, to be noted in `context.md` at the first test step), step 46 case (3) made
  non-vacuous, step 45 second header form in its own file, step 41 OTLP tests isolated in `identityServiceImpl.otlp.test.ts`, step 49 any-one
  producer semantics and silent-success exit code, static `telemetry.StopServer` grep in steps 5/9/13 (AC-12 wiring), retrofit gates 7/11/15 marked
  `red N/A`, coverage-floor comments on steps 45/46, stale cites refreshed.
- **Not re-reviewed after the pass-3 fix batch.** Remaining known warnings, all structural: steps 4/6/8/10/12/14 (6-7 Files each), 43 (7 Files, recorded),
  55 (5 Files with conditional creates) exceed the C-18 five-file guideline by design; step 54 is a test step that also edits the guard; Node steps 29/32/35/38
  have no discriminating check of their own (covered by 30/33/36/39). The reviewers had no shell, so no Verification command or line cite into an
  uninstalled package (`@connectrpc/connect`, OTel SDKs) has been run; the connect types were checked from the npm tarballs at 2.1.0 and the lock pins 2.1.1.
- Overlap re-scan (after the first fix batch): no FAIL-level collision; WARN-level shared files unchanged (marketdata `cmd/server/main.go` and
  `marketdata_service_test.go` with 215/230/255; portfolio `portfolio_quote_deadline_test.go` with 251/256). No merge-order row proposed.

## Session 2026-10-31 — sdd-execute (sequential, no checkpoints)

- Operator run request 2026-10-31: "Go with execution, sequential mode, no check points". Mode-entry and up-front confirmation are taken from that request; the checkpoint *gates* are skipped, but the accountability facts are still written here and in the PR body. Blockers still stop the run.
- Tooling setup (steps 1-47): go1.27.0 ok, uv 0.11 + python 3.13 ok (`uv sync --extra dev` exit 0 for indicators, ingest, analysis, agent), pnpm 9.15.9 ok (`pnpm install --frozen-lockfile` exit 0), docker present (unused), golangci-lint v2.14.0 installed from source into `/tmp/gobin` (the preinstalled v2.5.0 is older than CI), shellcheck/shfmt via `uvx` wheels, Node v22.22.0 (repo pins 24; Deviation 2). No database was started.

### Step 1 — PR-A precondition check and spec-time deviation record [done]
- 250 landed (`3968bcea`); `bash scripts/check-otel-produced-signals.sh` rc 0 and `bash scripts/check-otel-produced-signals.test.sh` `cases=66 failed=0` on the current tree; `grep OTEL_METRIC|OTEL_BLRP|OTEL_TRACES_SAMPLER` over `docker-compose.yml .do/app.yaml .do/app.dev.yaml` is empty; `grep termination|grace_period|drain_seconds .do/app*.yaml` is empty.
- The six Go modules resolve with `GOWORK=off go list -m`: `otel/sdk/metric@v1.45.0`, `otlpmetrichttp@v1.45.0`, `otel/log@v0.21.0`, `otel/sdk/log@v0.21.0`, `otlploghttp@v0.21.0`, `contrib/bridges/otelslog@v0.20.0`.
- Spec-time deviations from `design.md` (verbatim from the spec, instruction 2):
  - **spec-time deviations from `design.md`** (each is a verified fact that supersedes a design premise; execute steps follow the corrected text): **D1** the four Python locks already resolve `opentelemetry-sdk`/`exporter-otlp-proto-http` 1.45.1 and `opentelemetry-instrumentation-grpc` 0.66b1 (ingest no longer lags) — design's 'pin <1.43 / ==0.63b1' version bumps are void (the one dependency change is **D8**); the probe was re-run at 1.45.1/0.66b1 and all design conclusions hold (no RPC metric in instrumentation-grpc; `abort`/`set_code` set the status attribute; SDK `LoggingHandler` still present but deprecated). **D8** (operator decision 2026-10-30; supersedes the design's choice to keep the SDK handler): the four Python services use `opentelemetry.instrumentation.logging.handler.LoggingHandler` from the new dependency `opentelemetry-instrumentation-logging>=0.66b1` (`pyproject.toml` + `uv lock` ×4; the probe results are in the Python service steps 16/18/20/24). **D2** the three Python gRPC servers are built with no `interceptors=` argument (`grpc.aio.server()` at indicators `main.py:74`, ingest `:104`, analysis `:107`), so the cancel/deadline interceptor is a new argument. **D3** all four Node services are CommonJS and tsc-first (`tsconfig.json: "module": "commonjs"`, `test: tsc && node --test dist/...`) — `createRequire` is unnecessary. **D4** Go `main.go` line numbers drifted from recon (cited fresh in the Go steps); testability refinement: the slog bridge and bounded shutdown live in `internal/telemetry` (`WrapLogHandler`, `StopServer`) rather than inline in `cmd/` (excluded from CI coverage). **D5** notify's fanout code is `src/fanout/{fanout,webPush}.ts` (recon cited `src/services/`). **D6** the UI lockfile is the repo-root `pnpm-lock.yaml`. **D7** the agent already has a `ServerMiddleware` precedent (`CallerPropagationMiddleware`, `tools.py:190`, appended at `:381`).
- DigitalOcean grace period (verbatim, instruction 3): Record in `context.md` the DigitalOcean App Platform SIGKILL grace period, **verified 2026-10-30** from the official page https://docs.digitalocean.com/products/app-platform/how-to/configure-termination/ : `termination.grace_period_seconds` is the time after SIGTERM before the container is killed with SIGKILL, default **120 s**, maximum 600 s; `termination.drain_seconds` (delay before SIGTERM) default 15 s, maximum 110 s. Neither `.do/app.yaml` nor `.do/app.dev.yaml` sets a `termination` block (`grep -n 'termination\|grace_period\|drain_seconds' .do/app.yaml .do/app.dev.yaml` → nothing), so the 120 s default applies and the 2 s flush + 3 s GracefulStop fallback + 5 s deferred shutdown bounds (10 s) fit with margin. The page does not say which component types accept the block (all affected components here are services); if a `termination.grace_period_seconds` below 10 is ever added to a spec, STOP and raise it (P-03) before the Go steps.
- Files modified: `docs/roadmap/features/274-otel-metrics-logs-export/context.md`
- Deviations: Deviation 1 and 2 (see the spec's Deviation Log)

### Step 2 — Shared golden RPC status vectors and bucket boundaries [done]
- `scripts/testdata/rpc-status-vectors.json`: 9 vectors in the specified order; `applies_to` = both for six (`ok`, `abort NOT_FOUND`, `unhandled ValueError`, `deadline-expired cancel`, `client cancel`, `ERROR status only`), python-only `bare Exception`, node-only `node error without code` and `node string code`. The Python rule takes any non-zero integer attribute while the Node rule takes an integer in 0..16, so the shared `unhandled ValueError` vector uses an absent attribute (valid for both). TDD: N/A (data file; the Python and Node recorder suites are the red-before-green proof).
- Files modified: `scripts/testdata/rpc-status-vectors.json`
- Deviations: none

### Step 3 — Egress audit of every log site before PR-A merges [done]
- Method: the four Verification greps were run and every hit read; the Python grep returns 258 log calls, so it was reviewed by (a) a sensitive-term filter (token|secret|pass|cred|auth|bearer|key|header|email|api_|json|body|request) and (b) a second grep for calls formatting whole request/header/metadata/payload/body/credentials objects. The remaining Python sites log fixed messages plus ids/counts and are additionally covered by the egress tests AC-7, AC-13 and AC-20 and the PRESERVE redaction invariants.
- Verdict table (file:line -> what is interpolated -> verdict):
  - config `configServiceImpl.ts:202-592`, `index.ts`, `configWatcher.ts:65,89` (22 sites): namespace, key *names*, env, counts, userId, `err.message`; `GetSecret` denied/decrypt-failed log namespace+key only, never a value -> PASS.
  - notify `notifyServiceImpl.ts:91-252`, `fanout.ts:101-177`, `index.ts`, `configWatcher.ts`: alertId, category, severity, channel, `HTTP <status>`, `err.message` -> PASS. `webPush.ts:71` logs `{ subject }` = `VAPID_SUBJECT`, an operator-set mailto:/https: contact, only on misconfiguration -> PASS.
  - notify `webPush.ts:176,178,182`: log `endpoint: row.endpoint`, the per-subscription push URL (an FCM/Mozilla-style URL embeds a capability token) -> **FIX**: log `subscriptionId: row.subscription_id` (already selected at `webPush.ts:101,116`; `SubscriptionRow` at `:36`). Owning step: notify (35). The Files list of step 35 does not name `webPush.ts` (spec defect, as the review noted); the fix is applied there under the gap protocol default (expand scope) and logged as a Deviation.
  - identity `identityServiceImpl.ts:152`: logs the seed-admin email -> **FIX** already specced as step 40. All other identity sites log userId/clientId/eventType/`err.message` (Postgres `err.message` carries the constraint name, not the offending value) -> PASS. `ledgerAudit.ts:61` -> PASS.
  - ledger `ledgerServiceImpl.ts:106,140,156,417`, `index.ts`, `eventNotifier.ts`, `configWatcher.ts`: streamKey (ids), idempotencyKey/eventId, `err.message` -> PASS.
  - Python `extra=` (5 sites): four are `OTel tracing initialised` with the OTLP endpoint URL (credentials live in the separate headers env, never in the URL) and the service name -> PASS; the fifth (`indicators/app/handlers/servicer.py:223`) is a protobuf field, not a log call -> N/A. Python object-format grep: only `request.intent_id` (an id) -> PASS. `ingest/app/extractors/mcp_client.py:34,38` log `%r` of a malformed extracted signal item (symbol/direction/conviction from a tool result, not a credential) -> PASS, noted.
  - Go (trading, portfolio, marketdata) sites matching key|secret|token|pass|cred|auth: they log account ids, credential *status* names and booleans, key *names* (`marketdata/cmd/server/main.go:77`) and `api_key_placeholder`/`api_secret_placeholder` booleans (`:113`), never values -> PASS.
- Files modified: `docs/roadmap/features/274-otel-metrics-logs-export/context.md`
- Deviations: none yet (the notify FIX is logged when applied in step 35)

### Step 4 — trading: metrics + logs pipelines, slog bridge, bounded shutdown (Go) [done]
- `internal/telemetry/otel.go`: `Init` now returns `(shutdown, forceFlush, err)`; builds the three exporters first (any construction error returns `(nil, nil, err)` with nothing installed), then the trace provider, a `MeterProvider` with a `PeriodicReader` and `serverMetricViews()`, and a `LoggerProvider` with a `BatchProcessor`; `shutdown`/`forceFlush` join the three providers. `serverMetricViews()` drops the four size/count instruments so only `rpc.server.duration` survives; its doc comment carries that literal for the step-49 registry. All exporters are env-only (no endpoint/insecure/headers option; grep confirms).
- `logbridge.go`: `WrapLogHandler` returns `base` unchanged when disabled or no logger provider is installed (an atomic flag set by `Init`); otherwise `slog.NewMultiHandler(base, otelslog.NewHandler(name))` and an OTel error handler that writes through `base` only (recursion guard, FR-4); the record keeps the error text so the existing `400 Bad Request` assertion holds.
- `shutdown.go`: `StopServer` flushes first, then runs graceful stop with a timer and falls back to `force`. `cmd/server/main.go`: three-value `Init`, `slog.SetDefault(WrapLogHandler(...))` after a successful init and before `grpc.NewServer`, signal goroutine now `hs.Shutdown()` -> `StopServer(..., 2s, 3s)` -> `cancel()`; the deferred 5 s `shutdownOtel` is kept. `otel_test.go:59` arity edit only.
- `go.mod`/`go.sum`: the eight pins added and tidied (`otel` family v1.45.0, `otel/log`+`sdk/log`+`otlploghttp` v0.21.0, `otelslog` v0.20.0).
- Verification: `go build ./...` and `go vet ./internal/telemetry/... ./cmd/...` clean; golangci-lint v2.14.0 (rebuilt with the go1.27.0 toolchain, because the first `go install` auto-switched to go1.26.10 and refused the Go 1.27 module) reports 0 issues; the three existing telemetry tests pass with the new signature; the discriminating check passes.
- TDD: red-green for this pair is captured in step 5 (the tests are written against the pre-step source per the Step Dependencies RED protocol).
- Files modified: `services/xstockstrat-trading/internal/telemetry/{otel.go,logbridge.go,shutdown.go,otel_test.go}`, `cmd/server/main.go`, `go.mod`, `go.sum`
- Deviations: none

### Step 5 — trading: telemetry tests — metrics/logs export, status code, bridge, shutdown (Go) [done]
- **RED** (accepted build-failure RED per the Step Dependencies protocol): with only `otel.go`, `logbridge.go`, `shutdown.go` and `cmd/server/main.go` restored to their pre-step-4 content (`git checkout 2bb8340f --`; the two new files moved aside) and the new tests, `go test ./internal/telemetry/...` failed to build: `assignment mismatch: 3 variables but Init returns 2 values`, `undefined: WrapLogHandler`, `undefined: serverMetricViews`, `undefined: logProviderInstalled`. Source then restored from HEAD.
- **GREEN**: `go test ./internal/telemetry/... -race -count=1 -v` passes 12 tests: resource trio (and no `trading_mode`), traces export under both header forms, metrics and logs export under both header forms (AC-19), exported metric request carries `service.name=trading`/`deployment.environment=staging`/`platform=xstockstrat` (AC-1), a real bufconn gRPC server through `otelgrpc` records `rpc.server.duration` in `ms` with `rpc.grpc.status_code=5` for a NOT_FOUND call, with none of the four dropped instruments and bucket bounds equal to `scripts/testdata/rpc-status-vectors.json` (AC-2), a `slog.WarnContext` inside a span exports with severity `WARN` and the span's trace/span id (AC-11), a failed export reaches stdout and is not re-exported over `/v1/logs` for both a 400 response and a refused connection (AC-6), disabled mode installs nothing and `WrapLogHandler(base) == base` (AC-5 analogue), and the three `StopServer` cases plus the failed-flush case.
- Full suite `go test ./... -race` passes; CI's coverage computation gives total 79.1% (floor 40; the telemetry package itself is excluded from CI measurement, so these tests are the proof). golangci-lint v2.14.0: 0 issues. `grep telemetry.StopServer cmd/server/main.go` passes (cmd/ is outside coverage).
- Test-authoring finding recorded: `ForceFlush` reports errors by return, `Shutdown`/background by `otel.Handle`; the failure tests therefore use `shutdown`, mirroring the deferred shutdown in `main.go` (see Deviation 3 for the `StopServer` fix this exposed).
- Files modified: `services/xstockstrat-trading/internal/telemetry/{otel_test.go,shutdown_test.go}`, `go.mod` (otlp proto promoted to direct), plus `shutdown.go` under Deviation 3
- Deviations: Deviation 3

### Step 6 — trading: slog calls with a context in scope use their *Context variant; enforced by sloglint [done]
- **RED**: with `sloglint` (`context: scope`, `no-mixed-args: false`) added to `.golangci.yml`, `golangci-lint run` (v2.14.0) reported 99 issues: 96 `XContext should be used instead` (91 in `internal/service/trading.go`, 3 in `order_intent.go`, 1 each in `broker/ibkr.go` and `broker/ibkr_session.go`) plus 3 `use slog.DiscardHandler` in the step-5 test file. The spec's "120 call sites" counts every `slog.X(`; sloglint flags only those with a context in scope.
- **GREEN**: all 96 calls rewritten mechanically from the lint report to `slog.XContext(ctx, ...)`; every flagged call is in a function with `ctx context.Context` (eight sit in `submitOrder`, whose multi-line signature hid it from a one-line search). No message, key or level changed: diffing the changed lines with `slog.XContext(ctx, ` normalised back to `slog.X(` pairs every deletion with an identical addition, so stdout bytes are unchanged. `golangci-lint run`: 0 issues; `go build ./...` and `go vet ./...` clean; `grep sloglint .golangci.yml` passes. The full suite is run in step 7 (the retrofit gate).
- Files modified: `services/xstockstrat-trading/.golangci.yml`, `internal/broker/{ibkr.go,ibkr_session.go}`, `internal/service/{order_intent.go,trading.go}`, and `internal/telemetry/otel_test.go` under Deviation 4. Not touched (no flagged call): `cmd/server/main.go`, `internal/config/config.go`, `internal/service/trading_sync_test.go`.
- Deviations: Deviation 4

### Step 7 — trading: retrofit gate — full suite green under sloglint [done]
- `go test ./... -race -count=1` with CI's coverage computation: every package `ok`, total 79.1% (floor 40); `golangci-lint run` 0 issues. No test asserted on a removed non-Context call, so `internal/service/trading_sync_test.go` (the one non-telemetry test that swaps `slog`) is unchanged. TDD: red N/A (behaviour-neutral retrofit gate; green run captured here, as `tdd-gate.md` allows).
- Files modified: none (verification only)
- Deviations: none

### Step 8 — portfolio: metrics + logs pipelines, slog bridge, bounded shutdown (Go) [done]
- Applied step 4's change verbatim to portfolio: `internal/telemetry/{otel.go,logbridge.go,shutdown.go}` cloned from the verified trading versions with the `SERVICE_NAME` default set to `portfolio`; `cmd/server/main.go` gets the three-value `Init`, `slog.SetDefault(WrapLogHandler(...))` after a successful init, and `StopServer(..., 2s, 3s)` in the signal goroutine (deferred 5 s `shutdownOtel` kept); `otel_test.go` arity-only edit; the eight module pins added with `go get` + `go mod tidy` (both `go.mod` and `go.sum`). All exporters are env-only.
- Verification: `go build ./...`, `go vet ./internal/telemetry/... ./cmd/...` clean; golangci-lint v2.14.0 0 issues; existing telemetry tests pass with the new signature; discriminating check passes.
- Files modified: `services/xstockstrat-portfolio/internal/telemetry/{otel.go,logbridge.go,shutdown.go,otel_test.go}`, `cmd/server/main.go`, `go.mod`, `go.sum`
- Deviations: none (`shutdown.go` is cloned from trading *after* Deviation 3, so it already routes a failed final flush through `otel.Handle`)

### Step 9 — portfolio: telemetry tests — metrics/logs export, status code, bridge, shutdown (Go) [done]
- Tests are trading's step-5 tests verbatim apart from the expected `service.name` (`portfolio`); portfolio's original `otel_test.go` was identical to trading's modulo the service name, so nothing portfolio-specific was lost.
- **RED** (accepted build-failure RED): with `otel.go` and `cmd/server/main.go` restored from `a937f47e` (pre-step-8) and `logbridge.go`/`shutdown.go` moved aside, `go test ./internal/telemetry/...` fails to build: `assignment mismatch: 3 variables but Init returns 2 values`, `undefined: WrapLogHandler`, `undefined: serverMetricViews`. Source restored from HEAD.
- **GREEN**: 12 tests pass under `-race` (resource trio, traces and metrics+logs export under both header forms, resource attributes on the metric request, `rpc.server.duration` with `rpc.grpc.status_code=5` and the dropped siblings absent, trace correlation, failure visibility without recursion, disabled mode, the four `StopServer` cases). Full suite `-race`: no failures; CI-style coverage total 68.6% (floor 40); golangci-lint v2.14.0 0 issues; `grep telemetry.StopServer cmd/server/main.go` passes.
- Files modified: `services/xstockstrat-portfolio/internal/telemetry/{otel_test.go,shutdown_test.go}`, `go.mod`/`go.sum` (tidy)
- Deviations: none

### Step 10 — portfolio: slog calls with a context in scope use their *Context variant; enforced by sloglint [done]
- **RED**: adding `sloglint` (`context: scope`, `no-mixed-args: false`) to portfolio's `.golangci.yml` made `golangci-lint run` report 32 issues, all `XContext should be used instead`: 29 in `internal/service/portfolio_service.go`, 3 in `internal/service/offline_valuation.go`. No other file and no test file was flagged (the step-9 tests already use `slog.DiscardHandler`).
- **GREEN**: the 32 calls were rewritten mechanically from the lint report to `slog.XContext(ctx, ...)`; `go build ./...` and `go vet ./...` clean; `golangci-lint run`: 0 issues; `grep sloglint .golangci.yml` passes. Behaviour-neutral proof: with `slog.XContext(ctx, ` normalised back to `slog.X(`, every deleted line pairs with an identical added line (no odd-count lines).
- Files modified: `services/xstockstrat-portfolio/.golangci.yml`, `internal/service/{portfolio_service.go,offline_valuation.go}`. Not touched: `cmd/server/main.go`, `internal/config/config.go` (no flagged call).
- Deviations: none

### Step 11 — portfolio: retrofit gate — full suite green under sloglint [done]
- After the retrofit the full suite `go test ./... -race -count=1` is green in portfolio except one intermittent failure of `TestServerDurationRecordsStatusCode`, which is a race in the step-9 test, not a retrofit effect (Deviation 5): it passed 300 loaded repeats, three further full runs and 40 repeats after the fix. Fix: poll for `rpc.server.duration` instead of collecting once (test-only; applied to portfolio and, for the same reason, trading's identical copy).
- Gate result after the fix: every package `ok`; CI-style coverage total 68.6% (floor 40); golangci-lint v2.14.0 0 issues. `internal/service/portfolio_quote_deadline_test.go` (the one non-telemetry test that swaps `slog`) needed no change. TDD: red N/A (behaviour-neutral retrofit gate).
- Files modified: `services/xstockstrat-portfolio/internal/telemetry/otel_test.go` and `services/xstockstrat-trading/internal/telemetry/otel_test.go` (Deviation 5)
- Deviations: Deviation 5

### Step 12 — marketdata: metrics + logs pipelines, slog bridge, bounded shutdown (Go) [done]
- Applied step 4's change to marketdata: telemetry files cloned from trading with the `SERVICE_NAME` default `marketdata`; `cmd/server/main.go` gets the three-value `Init`, the `WrapLogHandler` default after a successful init, and `StopServer(..., 2s, 3s)` in the signal goroutine (the deferred 5 s `shutdownOtel` flushes the stream-end points once `Serve` returns); `otel_test.go` arity-only edit; eight module pins via `go get` + `go mod tidy`. Exporters are env-only.
- Verification: `go build ./...`, `go vet ./internal/telemetry/... ./cmd/...` clean; golangci-lint v2.14.0 0 issues; existing telemetry tests pass with the new signature; discriminating check passes.
- Files modified: `services/xstockstrat-marketdata/internal/telemetry/{otel.go,logbridge.go,shutdown.go,otel_test.go}`, `cmd/server/main.go`, `go.mod`, `go.sum`
- Deviations: none

### Step 13 — marketdata: telemetry tests — metrics/logs export, status code, bridge, shutdown (Go) [done]
- Tests are trading's step-5 tests (with the Deviation 5 polling fix) with `service.name` = `marketdata`, plus marketdata's AC-12/AC-18 test in `shutdown_test.go`: a real `grpc.Server` (health service, `otelgrpc` stats handler) holds a client `Watch` stream open (which blocks `GracefulStop` forever), serves two unary `Check` calls and three INFO log records through `WrapLogHandler` with `OTEL_METRIC_EXPORT_INTERVAL=600000` (so only the stop path can deliver), then `StopServer(forceFlush, srv.GracefulStop, srv.Stop, 2s, 3s)` + `shutdown`. It asserts the whole sequence finishes inside 10 s (measured 3.0 s: the 3 s graceful fallback), the exported `rpc.server.duration` count for `Check` is exactly 2, and `rec-1..3` all arrive on `/otlp/v1/logs`.
- **RED** (accepted build-failure RED): with `otel.go`/`main.go` restored from `8448347f` (pre-step-12) and `logbridge.go`/`shutdown.go` moved aside, the test package fails to build: `assignment mismatch: 3 variables but Init returns 2 values`, `undefined: WrapLogHandler`, `undefined: serverMetricViews`. Sources restored from HEAD (verified byte-identical to the step-12 commit).
- **GREEN**: 13 tests pass under `-race` (and 3 repeated runs); full suite `-race` has no failures; CI-style coverage total 71.5% (floor 40); golangci-lint v2.14.0 0 issues after `gofmt` of the hand-assembled test file; `grep telemetry.StopServer cmd/server/main.go` passes.
- Files modified: `services/xstockstrat-marketdata/internal/telemetry/{otel_test.go,shutdown_test.go}`, `go.mod`/`go.sum` (tidy)
- Deviations: none
