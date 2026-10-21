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
