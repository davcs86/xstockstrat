# Product Spec: otel-metrics-logs-export

**Created**: 2026-10-21

---

## Problem Statement

No xstockstrat runtime exports OTel metrics or logs. Every telemetry module builds only a tracer provider and trace
exporter, and the UI passes empty pipelines (`services/xstockstrat-ui/src/telemetry.ts`: `metricReaders: []`,
`logRecordProcessors: []`). Because nothing produces `rpc_server_duration_milliseconds_*` or any Loki stream, the
on-call operator loses three alerts: gRPC error rate (`xstk-error-rate-high`), p99 latency (`xstk-p99-latency-high`)
and the analysis scoring stall (`xstk-analysis-no-scoring`). The constitution's OTEL-1/OTEL-2 rules describe these
alerts. Feature 250 (`fix-otel-metrics-logs-gap`) removes them because they evaluate against no data. This feature
supplies the missing data and restores detection. In 250's terms it is "fix (b)", and it reverses feature 226
Operator Decision 3 ("traces only"), with operator sign-off recorded in `context.md`.

## User Story

As the on-call operator, I want every xstockstrat runtime to export OTel metrics (including the RPC server duration
histogram) and logs over OTLP/HTTP to the collector, so the Grafana alerts and dashboards (error rate, p99 latency,
analysis scoring stall) have data to evaluate and can page me.

## Functional Requirements

FR-1. **Metrics pipeline.** With `OTEL_ENABLED=true`, each of the 12 runtimes (Go: trading, portfolio,
marketdata. Python: indicators, ingest, analysis, agent. Node: ledger, identity, notify, config. Next.js: ui)
installs a global `MeterProvider`. It exports over OTLP/HTTP with an env-only exporter: no endpoint, url or insecure
argument, so the SDK appends `/v1/metrics` to `OTEL_EXPORTER_OTLP_ENDPOINT` and reads `OTEL_EXPORTER_OTLP_HEADERS`.
The exporter uses the same resource attributes as traces (`service.name`, `deployment.environment`, `platform`).
This is the PLAT-3 trace contract, extended. No new deployment env var is needed:
`OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are already global `envs:` in
`.do/app.yaml:25-36` and `.do/app.dev.yaml:25-36` and set per service in `docker-compose.yml`. Design verifies parity
across these three targets for all 12 runtimes and fixes any runtime that lacks them.

FR-2. **RPC server duration histogram.** Each of the 10 gRPC-serving backends records a server-side RPC duration
histogram for every handled unary and streaming call, with the gRPC method and status code as attributes. In
Grafana Cloud it must resolve to the series `rpc_server_duration_milliseconds_{count,bucket}`, with labels
`service_name` and `rpc_grpc_status_code`, which is what `xstk-error-rate-high` and `xstk-p99-latency-high` query
(pre-250 `packages/otel/alerts/alert-rules.yaml:44-45,88`). The agent and the UI are not gRPC servers and are exempt
from FR-2. This series name, unit and label set are the contract. Every backend must produce exactly this series,
whether through its stock instrumentation or a shared interceptor (design's choice), and a per-language name split
is not acceptable. Renaming it, for example to semconv `rpc.server.call.duration` in seconds, needs operator
sign-off. A rename also changes every alert and panel in the same PR and adds a superseding `@AC-*`, because `@AC-2`
is append-only.

FR-3. **Logs pipeline.** With `OTEL_ENABLED=true`, each runtime installs a `LoggerProvider` with an env-only
OTLP/HTTP log exporter (`/v1/logs`) and connects its existing logger to it: Go `log/slog`, Python `logging`, Node
`winston`, and the UI's server-side logger. Stdout output stays the same in format and content. A record emitted
inside an active span carries that span's `trace_id` and `span_id`. Severity maps from the native level. Analysis
records reach Loki under `service_name="analysis"`. The scoring-stall alert's pre-250 regex `ScoreStrategy|RunBacktest`
does not match the real handler line (`"running backtest id=%s strategy=%s symbols=%s"`,
`services/xstockstrat-analysis/app/handlers/servicer.py:799-800`), so FR-6 re-derives that rule against lines the
code actually emits.

FR-4. **Non-fatal, off by default when disabled.** When `OTEL_ENABLED` is anything other than `true`, no meter
provider, logger provider or exporter is installed, and stdout logging works exactly as it does today. A metric or
log exporter failure (endpoint unreachable, 4xx/5xx, a bad header) never blocks startup and never fails or blocks a
request path. Export is asynchronous and batched. Failures are logged to stdout only; the OTel SDK's own diagnostic and
exporter loggers are excluded from the OTLP log bridge, so an export failure never produces another export. Shutdown
flushes all three providers within the existing shutdown path.

FR-5. **No secret leakage through logs.** Log records exported over OTLP carry no secret plaintext. Today's stdout
redaction invariants (feature 147: `[redacted]` at every read/broadcast edge) hold unchanged on the OTLP path, so
the bridge must not add attributes (for example, full request metadata or headers) that stdout does not already
emit.

FR-6. **Alerts and dashboards restored.** After feature 250 has merged, the three rules it removed are provisioned
again in `packages/otel/alerts/`, along with their mute timing `outside-us-market-hours`. The PromQL and LogQL
dashboard panels and the `$service` variable it removed or rewrote are restored too. All of them query only series
this feature produces (FR-2, FR-3). The scoring-stall rule is re-derived, not restored as written, because
`RunBacktest`/`ScoreStrategy` are client-invoked (250 `design.md` §6). Feature 250's produced-signals guard
(`scripts/check-otel-produced-signals.sh`) is updated to record the newly produced metric and log paths instead of
being deleted, so CI still fails on any alert or panel that targets an unproduced series.

FR-7. **Docs and constitution reconciled.** These state the three exported signals and their actual series and
stream names: `docs/patterns/observability.md`, `docs/setup/grafana-cloud.md`, `packages/otel` docs, the PLAT-3 row
of `docs/context-constitution.md`, and OTEL-1/OTEL-2 in `packages/otel/docs/context-constitution.md`. The root
findings row "metrics and logs are never sent" and its otel-package counterpart are marked RESOLVED (feature 274).

## Out of Scope

- **The `platform.otel.enabled` live switch.** By operator decision (2026-10-21) it is not implemented. The docs
  claim is removed as doc drift separately, outside this feature (see `context.md`). `OTEL_ENABLED` stays the only
  gate.
- New config keys. Export interval, batch sizes and histogram buckets use SDK defaults or the standard `OTEL_*`
  env vars. A WatchConfig key would need a separate story.
- Application/business metrics beyond the RPC server histogram and the SDK's own runtime metrics (no per-strategy,
  per-order or P&L metrics).
- DO App Platform `log_destinations` or collector `filelog` scraping. Logs go only through the in-process OTLP
  bridge (operator decision 2026-10-21).
- Browser-side (client component) telemetry in `xstockstrat-ui`.
- Span-metrics or TraceQL-metrics alerting (feature 250's `trace-derived-alerting` candidate list). This feature
  replaces that need with directly exported metrics; see "Feature 250's follow-up story" under Deferred to
  /sdd-design.
- Turning telemetry on in production. Expected `OTEL_ENABLED` per target stays as today: DO dev `"true"`
  (`.do/app.dev.yaml`), DO prod `"false"` (`.do/app.yaml:30-31`), compose off unless the shell sets it. The prod flip
  is a separate operator rollout step, taken after design's cost budget is accepted, not a change this feature
  makes.

## Affected Services

- `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`: Go `internal/telemetry/otel.go#Init`:
  add meter and logger providers, slog bridge, gRPC server metrics.
- `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`: Python `app/telemetry.py#init_telemetry`:
  meter and logger providers, `logging` handler, gRPC server metrics; `uv lock` per service.
- `xstockstrat-agent`: Python `app/telemetry.py`: meter and logger providers, `logging` handler (no gRPC server).
- `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config`: Node
  `src/telemetry.ts#initTelemetry`: metric reader, log processor, winston bridge, gRPC server metrics.
- `xstockstrat-ui`: Next.js `src/telemetry.ts`: replace the empty `metricReaders`/`logRecordProcessors` (server
  side only).
- `packages/otel` (non-service): alert rules, mute timings, dashboards, docs, collector header comment.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI**
- [ ] **Agent**
- [x] **None**: internal/platform-only. The consumer is the on-call operator through Grafana Cloud alerts and
  dashboards (`packages/otel/`), which are provisioned operator tooling outside every `xstockstrat-ui` segment and
  every MCP tool. No end-user product behaviour changes.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys. The standard OTel SDK env vars (`OTEL_EXPORTER_OTLP_*`, optional
  `OTEL_METRIC_EXPORT_INTERVAL`) are read by the SDK, not by app code; whether any are set explicitly in
  `.do/app*.yaml` / `docker-compose.yml` is decided at design.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/otel-metrics-logs-export` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval per affected service (service code change; no proto/config/migration gate)
- [ ] 2 service owners + platform lead (breaking proto change): n/a
- [ ] DBA review + service owner (schema migration): n/a
- Platform Lead review: cross-service telemetry contract across all 12 runtimes.

**Hard ordering:** merges only after `fix-otel-metrics-logs-gap` (250); see `merge-order.md`. FR-6 restores the
assets 250 removes, and both features edit `packages/otel/alerts/alert-rules.yaml`, dashboards and the same docs.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`), the single source of acceptance truth (Constitution **C-15**). Each
`FR-N` above is covered by at least one tagged scenario there.

## Open Questions

- [x] **Series name across languages (FR-2).** Resolved in the spec: the pre-250 alert series is the contract, and
  a rename needs operator sign-off. How each language produces it (stock `otelgrpc` v0.52 `rpc.server.duration` in
  ms for Go; the Python/Node instrumentations' metric support is unverified) is a design mechanism, not an open
  requirement.
- [x] **Log-export recursion.** Resolved as an FR-4 requirement: SDK and exporter loggers are excluded from the
  bridge.

## Deferred to /sdd-design

These are design forks, not requirement gaps. `context.md` (sdd-story session) defers them to `/sdd-design`, which
must close each one in `design.md`.

- **Cardinality and cost.** Histogram attributes are limited to `rpc.service`, `rpc.method` and status code, never
  user IDs or symbols. Design estimates the Grafana Cloud active-series and log-volume budget for 12 runtimes × 2
  environments before prod enablement.
- **Feature 250's follow-up story.** 250 `design.md` §6 creates `NNN-trace-derived-alerting`, and its guard asserts
  that directory exists. Design decides, with the operator, whether 250 cites 274 instead, to avoid a duplicate
  story, or whether both stay, with 274 as the fix (b) candidate that story lists.

## Known Traps

From the ledger (`docs/roadmap/ledger/fails.md`):

- **2026-08-06 trading-safety-dashboard-slos.** FR-6 depends on feature 250's end state. Recon re-reads 250's
  status and its landed `alert-rules.yaml` and guard, not this spec's description of them.
- **2026-09-09 171-fix-agent-trading-mode-otel-attr.** Node leaf services run tests under two runners
  (strip-types ESM and tsc-first CJS). New imports in `src/telemetry.ts` must work under both. Feature 252 edits
  identity's telemetry tests (rebase-only overlap).
- **2026-10-15 fix-otel-trace-export.** vitest clears `vi.spyOn` history before each test, so UI telemetry tests
  must trigger the behaviour inside the test.
