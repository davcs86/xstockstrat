# Recon: fix-otel-metrics-logs-gap

**Created**: 2026-10-20
**From**: product-spec.md
**Affected services**: packages/otel (alerts, dashboards, docs, collector header comment); docs (`docs/setup/grafana-cloud.md`, `docs/setup/CLAUDE.md`, `docs/patterns/observability.md`, `docs/launch-pdfs/product-features.md`, `docs/context-constitution-findings.md`). No `xstockstrat-*` runtime.

---

## Objective

No runtime exports OTel metrics or logs (traces only, feature 226 Operator Decision 3), yet 3 provisioned alerts, 18 dashboard panel exprs and 1 template variable query Prometheus `rpc_server_duration_milliseconds_*` or Loki streams. Per operator decision 2026-10-20 (narrow to traces), remove or rewrite every alert/panel/variable that depends on an unproduced series, and correct every doc that claims metrics/logs are exported or read. Adding metric/log export (fix (b)) is out of scope.

## Codebase Map

- **`packages/otel`** (YAML / JSON provisioning + Markdown; not a service, no entry point, no migrations, no config reads)
  - Alert rules: `packages/otel/alerts/alert-rules.yaml`
    - `xstk-error-rate-high` — `:26` (critical `:31`, `for: 5m` `:29`, `${DS_PROMETHEUS_UID}` `:39`, expr `:44-45` on `rpc_server_duration_milliseconds_count{rpc_grpc_status_code!="0"}`)
    - `xstk-p99-latency-high` — `:71` (warning `:76`, `for: 3m` `:74`, expr `:88` `histogram_quantile(0.99, … rpc_server_duration_milliseconds_bucket …)`)
    - `xstk-analysis-no-scoring` — `:116` (critical `:121`, `for: 0m` `:119`, label `mute_outside_market_hours` `:123`, `${DS_LOKI_UID}` `:129`, expr `:134` `sum(count_over_time({service_name="analysis"} |~ "ScoreStrategy|RunBacktest" [30m]))`)
    - Header placeholder comment `:7-9` (`${DS_PROMETHEUS_UID}` / `${DS_LOKI_UID}`)
  - Mute timing: `packages/otel/alerts/mute-timings.yaml` (`outside-us-market-hours`), whose header names `xstk-analysis-no-scoring` as its only consumer. Orphaned if that rule is removed.
  - Dashboards: `packages/otel/dashboards/*.json`. 9 PromQL panel exprs, 9 LogQL panel exprs, 1 PromQL variable:

    | File (uid) | PromQL `rpc_server_duration_milliseconds_*` | LogQL |
    |---|---|---|
    | `service-health.json` (`xstk-service-health` `:58`) | variable `:47` `label_values(rpc_server_duration_milliseconds_count, service_name)`; panels `:69`, `:96`, `:122` | `:136` |
    | `signal-pipeline-throughput.json` (`xstk-signal-pipeline` `:47`) | `:89` | `:59`, `:74`, `:104`, `:109` |
    | `infrastructure.json` (`xstk-infrastructure` `:47`) | `:59`, `:90` | `:74`, `:105` |
    | `trading-service.json` (`xstk-trading-service` `:47`) | `:58`, `:72`, `:77` | `:92`, `:107` |

    Each dashboard declares `__inputs` DS_PROMETHEUS (`:4`) and DS_LOKI (`:12`), plus datasource template vars (`:28-38`). If no query of a kind is left, its input is dead.
  - Collector: `packages/otel/otel-collector-config.yaml`. Stale header `:9` ("Exports all three signal types (logs, metrics, traces)"), plus stale wording at `:35` ("Drop spans/metrics/logs") and `:49` ("handles logs, metrics, and traces"). Pipelines: traces `:74-77`, metrics `:79-82`, logs `:84-87`. The metrics and logs pipelines are retained on purpose (226 `design.md:24`; rejected alternative `design.md:38`).
  - Docs: `packages/otel/CLAUDE.md:4` (cites the "`rpc_server_duration_milliseconds` metric-name contract"); `packages/otel/alerts/README.md` (`:8`, `:15-17`, `:25-26`, `:40-46`); `packages/otel/dashboards/README.md` (`:4-5`, `:7-12`, `:16-26`, `:30-39`, attribute list `:40-42`, log-derived panels `:43-49`).
  - Constitution: `packages/otel/docs/context-constitution.md`. OTEL-1 `:16` uses the Loki alert `alert-rules.yaml` `~L134` as its only canonical evidence. OTEL-2 `:17` encodes the `rpc_server_duration_milliseconds` contract.
  - Findings: `packages/otel/docs/context-constitution-findings.md:13` ("Latent bug?" row) and its "Filed as defect reports" table `:20-28`, which names this defect.
- **Runtimes (read-only, no change).** Confirmed: no metric or log exporter exists under `services/` (`rg 'MeterProvider|LoggerProvider|OTLPMetricExporter|otlpmetric|PeriodicExportingMetricReader|OTLPLogExporter|otlploghttp|BatchLogRecordProcessor' services/` returns nothing). The UI sets `traceExporter: new OTLPTraceExporter()` and explicitly empties both pipelines with `metricReaders: []` and `logRecordProcessors: []` (`services/xstockstrat-ui/src/telemetry.ts:29-32`).
- **Deploy state (read-only).** `.do/app.yaml:30-31` sets `OTEL_ENABLED: "false"` for prod. `.do/app.dev.yaml:30-31` sets `"true"`. So traces reach Grafana from dev and local today, and prod exports nothing. `packages/otel/CLAUDE.md:7-9` and `otel-collector-config.yaml:17-18` describe prod direct-push as intent.
- **Local compose (read-only).** `docker-compose.yml:56` defines the `otel-collector` service (config mount `:65`). 12 services set `OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318`.
- **Docs outside packages/otel** (FR-4 instances, grep-confirmed):
  - `docs/setup/grafana-cloud.md`:
    - `:3` "emits traces, metrics, and logs via OTLP"
    - `:21-24` signal types
    - `:108`
    - `:191-208` Loki and Mimir check steps
    - `:218-223` dashboard table
    - `:226`, `:230`
    - `:233-234` "V1 ships **metrics + logs** dashboards"
    - `:236-241` ad-hoc Loki query
    - `:258-261` alert table and `${DS_LOKI_UID}` step
    - `:313-319` Loki derived fields
    - Correct, keep: `:183-189` Tempo check, `:243-246` TraceQL example
  - `docs/patterns/observability.md:3` ("Grafana Cloud (Loki + Mimir + Tempo)")
  - `docs/setup/CLAUDE.md:10` ("verify traces/metrics/logs arrive")
  - `docs/launch-pdfs/product-features.md:192` ("exports OTLP traces, metrics, and logs")
  - `docs/context-constitution-findings.md:18`

## Patterns to REUSE

- **Rewriting any alert onto trace data** → keep the three-node chain: A is the query, B is `reduce`, C is `threshold` (`alert-rules.yaml:37-63`, the same shape at `:81-106` and `:127-153`). Do not invent a new rule shape.
- **Trace-only verification steps in `grafana-cloud.md`** → reuse the existing "Check Traces (Tempo)" step (`docs/setup/grafana-cloud.md:183-189`) and the TraceQL example (`:243-246`) as the template. Do not write new Tempo wording from scratch.
- **Market-hours gating for any replacement scoring-stall alert** → reuse the `outside-us-market-hours` mute timing (`packages/otel/alerts/mute-timings.yaml`) and the `mute_outside_market_hours` label (`alert-rules.yaml:123`). The rule evaluates 24/7 and routing suppresses paging (insights.md:1901-1903). If no replacement rule is kept, remove or re-scope the mute timing and its `alerts/README.md:40-46` section together (C-10).
- **Findings-row resolution marker** → follow 226's "findings row NARROW" convention (226 `design.md:24`, "NARROW per fails.md 174"). Narrow or mark the row in place and cite this feature. Do not delete it silently. This applies to `packages/otel/docs/context-constitution-findings.md:13` and `:20-28`, and to `docs/context-constitution-findings.md:18`.
- **Doc-content assertion test** → the closest precedent is `docs/sdd/business-rules/platform.feature:144-149` (`@AC-3 @feature-171`), which asserts the content of `dashboards/README.md`. The "mechanical produced-set check" has no existing home (see Not found). If `/sdd-spec` adds one, check `scripts/` conventions and `docs/patterns/dry-guard-rail.md` first.
- **Ops dashboards stay in Grafana assets** → insights.md:1180-1182. Keep the fix inside `packages/otel/dashboards/`, with no new UI surface.
- **OTel export configuration** → no change. PLAT-3 (`docs/context-constitution.md:37`) holds: traces only, over OTLP/HTTP, configured by spec env vars. Docs must keep describing this path.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-3 @FR-2 @regression @feature-171` "The dashboards README documents the emitted attribute set, without trading_mode" (`docs/sdd/business-rules/platform.feature:144-149`). `packages/otel/dashboards/README.md` is in the FR-4 edit set. The rewrite must keep `service.name`, `deployment.environment` and `platform` (`:40-42`) and must not list `trading_mode`. This is the likeliest place for a silent regression.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-171` "A telemetry module's built Resource no longer carries the trading_mode attribute" (`docs/sdd/business-rules/platform.feature`). Runtimes are untouched. Rewritten alerts, dashboards and docs must not select on or document a `trading_mode` label.
- **PRESERVE** `@AC-2 @FR-3 @regression @feature-171` "Telemetry init remains non-blocking after the trading_mode attribute is removed" (`docs/sdd/business-rules/platform.feature`). Docs must not describe telemetry init as blocking.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-226` "A backend service exports traces over OTLP/HTTP to a path-prefixed gateway URL" (`docs/sdd/business-rules/platform.feature`). Traces-only export to `/otlp/v1/traces` is the premise of narrow-to-traces. Docs must keep describing it, and the collector `metrics`/`logs` pipelines stay.
- **PRESERVE** `@AC-3 @FR-3 @regression @feature-226` "A failed trace export is visible in service logs" (`docs/sdd/business-rules/platform.feature`). The failure goes to service stdout, which is not a Loki stream. A replacement alert or doc (e.g. a rewrite of the OTLP-failure panel `infrastructure.json:105`) must not assume it reaches Loki.
- **PRESERVE** `@AC-4 @FR-4 @regression @feature-226` "Local compose routes every service to the collector's OTLP/HTTP receiver" (`docs/sdd/business-rules/platform.feature`). The collector-config edits are comment-only. `docker-compose.yml` endpoints stay `http://otel-collector:4318`.
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-226` "The UI registers its instrumentation hook and exports over OTLP/HTTP" (`services/xstockstrat-ui/acceptance/fix-otel-trace-export.feature`). The UI exports traces only and keeps `metricReaders: []` / `logRecordProcessors: []`. FR-4 docs must not claim the UI emits metrics or logs.
- `packages/otel` has no existing acceptance suite (it is not a service and has no `acceptance/` dir).
- No CHANGE verdicts. No promoted `@AC-*` guarantees that `alert-rules.yaml` or `dashboards/*.json` exist or what they contain. No suite asserts that metrics or logs are exported, so that premise rests on 226 Operator Decision 3, not an `@AC-*`.
- The `rpc_server_duration_milliseconds` "contract" (`packages/otel/CLAUDE.md:4`, OTEL-2) is an OTEL constitution invariant, not a Gherkin rule. FR-4 reconciles it.
- Coverage:
  - Read in full: `platform.feature` (36 scenarios) and `services/xstockstrat-ui/acceptance/fix-otel-trace-export.feature`.
  - Keyword grep across every `services/*/acceptance/*.feature` (otel, OTLP, telemetry, grafana, loki, tempo, prometheus, mimir, rpc_server_duration, observab): no other relevant subject.
  - Same-named but unrelated: `strategy-performance-dashboard.feature` is the `/insights` page, not Grafana.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none
- Inter-service edges: none
- New env vars / ports: none. `OTEL_ENABLED` stays as is (`.do/app.yaml:31` `"false"`, `.do/app.dev.yaml:31` `"true"`). Compose collector routing is unchanged.

## Risks / Not-found

- **Not found: span-metrics path.**
  - No `spanmetrics`, `metrics_generator`, `traces_spanmetrics` or `log_destinations` exists in the repo outside `docs/roadmap/` and `docs/reports/`. I re-grepped on 2026-10-20 and the result was empty.
  - So the produced set has no PromQL metric name. Under AC-1, a span-metric name is admissible only with recorded evidence in design.md that the stack returns those series, and that evidence can only come from Grafana, not from the repo.
  - Until it exists, the default is to remove the PromQL alerts and panels, not rename them.
- **Not found: a trace-based alert or panel.** No Tempo or TraceQL query exists anywhere in `packages/otel/`. The only Tempo mention is the "out of scope" note at `dashboards/README.md:5`.
  - Whether Grafana-managed alerting can evaluate a TraceQL-metrics query on this stack is unverified in the repo.
  - So any "trace-based replacement" alert is a claim the design must prove, or defer to a named follow-up `/sdd-story` (product-spec "Operator coverage after the fix").
- **Not found: a mechanical produced-set check.** No script, CI job, promtool, jsonschema or yamllint over `alert-rules.yaml` or `dashboards/*.json` (`.github` grep was empty). `/sdd-spec` must define a new one or a `platform.feature`-style assertion (C-15 coverage of AC-1..3).
- **Coverage loss (operator-visible).**
  - Removing `xstk-error-rate-high`, `xstk-p99-latency-high` and the critical `xstk-analysis-no-scoring` leaves those failures undetected.
  - These alerts never fired anyway, so this makes the gap honest without adding new blindness.
  - design.md must name, for each rule, its replacement or a follow-up `/sdd-story`.
- **OTEL-1 loses its only evidence** (`packages/otel/docs/context-constitution.md:16` cites `alert-rules.yaml` `~L134`). Removing the Loki alert forces OTEL-1 to be re-grounded on a remaining query or retired, along with OTEL-2 (`:17`), which goes with the PromQL series. This is a Teardown trigger (root `CLAUDE.md` § Teardown).
- **Prod exports nothing.** `.do/app.yaml:31` sets `OTEL_ENABLED: "false"`.
  - A doc saying "traces reach Grafana" is true only for dev and local.
  - The design decides whether FR-4 docs scope the claim. Do not assert prod behavior without this grounding (fails.md:1562).
- **Out of scope, do not fold in:** the separate open defect on the collector headers comment, `otel-collector-config.yaml:13-15` (`docs/reports/2026-10-19-otel-collector-headers-comment-contradiction-defect.md`).
- **Overlap:** feature 084-droplet-compose-deploy may also edit `docs/patterns/observability.md` (context.md 2026-10-20 review). This is rebase-only, with no merge-order row.
- **fails.md traps that apply:**
  - fails.md:711-713: citing upstream telemetry as a data source without re-verifying it is still emitted. This defect has the same shape. Every query kept or added must be checked against the produced set.
  - fails.md:179-182: a scope-narrowing sentence ("only these N panels", "no other doc") is a claim about absence. Grep-verify it at the gate. The FR-4 inventory is a known-instances list, not an exhaustive one.
  - fails.md:1562: ground infra-state claims (`.do`, collector) against the repo.
  - fails.md:2854-2856 (vitest `beforeAll` spy history) applies only if runtime tests are touched, and they are not.
- **insights.md entries carried:** insights.md:1180-1182 (extend the Grafana dashboards, no new UI); insights.md:1901-1903 (alert visibility vs paging via mute timing); insights.md:1905-1908 (re-ground every FR against HEAD; the product-spec counts matched HEAD on 2026-10-20); insights.md:2921-2930 (171: real consumers of OTel series and attributes include out-of-repo Grafana dashboards and alerts, an accepted blind spot).

## Recommended Scope

Advisory only, not binding:

1. **Alerts.**
   - Remove `xstk-error-rate-high`, `xstk-p99-latency-high` and `xstk-analysis-no-scoring` (`alert-rules.yaml:26`, `:71`, `:116`), or rewrite any of them onto a verified trace query using the A/B/C chain.
   - Reconcile `mute-timings.yaml` and the `alerts/README.md` rules table, placeholders and market-hours section.
   - Record in design.md, for each removed rule, its replacement or a named follow-up `/sdd-story`.
2. **Dashboards.**
   - Remove or rewrite the 9 PromQL and 9 LogQL panel exprs and the `$service` variable (`service-health.json:47`).
   - Drop any DS_PROMETHEUS or DS_LOKI `__inputs` and datasource vars left unused.
   - Decide whether a dashboard left empty is deleted or kept as a Tempo-backed dashboard.
3. **packages/otel docs.**
   - Rewrite `dashboards/README.md`, preserving `:40-42` (171 `@AC-3`).
   - Correct `packages/otel/CLAUDE.md:4`.
   - Re-ground or retire OTEL-1 and OTEL-2.
   - Mark the findings rows and the "Filed as defect reports" table resolved, per the NARROW convention.
   - Correct the collector header comments at `:9`, `:35` and `:49`. Comments only; leave the pipelines alone.
4. **docs/.**
   - Correct `grafana-cloud.md` (FR-4 line set), `observability.md:3`, `docs/setup/CLAUDE.md:10`, `launch-pdfs/product-features.md:192` and `docs/context-constitution-findings.md:18`.
   - Decide whether to scope the claims to `OTEL_ENABLED=true` environments.
5. **Verification.**
   - Add the mechanical produced-set check that covers AC-1/AC-2: extract PromQL metric names and LogQL selectors from `alert-rules.yaml` and `dashboards/*.json` and assert each is in the produced set.
   - Add a doc-claim check for AC-3.
   - Finish with the root `CLAUDE.md` Teardown over the touched context files.
