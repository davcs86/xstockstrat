# Product Spec: fix-otel-trace-export

**Type**: bug
**GitHub Issue**: n/a — defect report `docs/reports/2026-10-14-otel-trace-export-broken-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-14

---

## Problem Statement

**Observed:** with `OTEL_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT` set to the Grafana Cloud
OTLP gateway URL (`https://otlp-gateway-<region>.grafana.net/otlp`, current staging), no service
exports traces:

- Go (trading, portfolio, marketdata) passes the full URL to `otlptracegrpc.WithEndpoint` (a
  `host:port`-only option) with `WithInsecure()` → `name resolver error: produced zero addresses` every export.
- Python (indicators, ingest, analysis, agent) uses the gRPC exporter with `insecure=True` against an
  OTLP/HTTP-only gateway — fails silently.
- Node backends (ledger, identity, notify, config) use the gRPC exporter with `url: endpoint` — fails
  silently (no diag logger).
- UI: root-level `instrumentation.ts` is never registered (app uses `src/`), and the HTTP exporter is
  given the endpoint as a verbatim `url` (no `/v1/traces`).
- `docs/setup/grafana-cloud.md` documents `OTEL_EXPORTER_OTLP_HEADERS` in the collector's header-value
  form (`Basic <token>`), which SDKs reading the var directly cannot parse into an `Authorization` header.
- Local compose is broken for Go, Node backends, and UI in the same ways.

**Expected:** every service exports traces over OTLP/HTTP configured solely by the spec env vars, so
the SDK appends `/v1/traces`, derives TLS from the scheme, and sends the `Authorization` header from
`OTEL_EXPORTER_OTLP_HEADERS`; export failures are visible in service logs.

## Reproduction Steps

1. Deploy with `OTEL_ENABLED=true` and the Grafana Cloud gateway URL as `OTEL_EXPORTER_OTLP_ENDPOINT` (current staging).
2. Tail `xstockstrat-trading` runtime logs → repeating `name resolver error: produced zero addresses`.
3. Tail `xstockstrat-ui` startup logs → no `[otel] tracing enabled` line.
4. Query Grafana Cloud Tempo for any `service.name` → no traces.

## Root Cause Hypothesis

Exporters were wired for a local gRPC collector with explicit endpoint options that override the
OTel spec env-var handling; deployed environments push directly to an OTLP/HTTP-only gateway with a
full URL, which none of the four runtime setups can consume. (Confidence: high — Go failure observed
in live staging logs; UI hook absence observed in startup logs.)

## Affected Services

All twelve: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata,
xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-agent,
xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify, xstockstrat-config, xstockstrat-ui.

## Operator Decisions (2026-10-14)

1. **Approach (a):** standardise all runtimes on OTLP/HTTP trace exporters configured only via the
   spec env vars (no explicit endpoint/url/insecure options); local compose points every service at
   `http://otel-collector:4318`. Rejected: (b) deploying a collector on DO App Platform.
2. **Header format:** deployed `OTEL_EXPORTER_OTLP_HEADERS` = `Authorization=Basic%20<token>` with
   `=` padding percent-encoded as `%3D`; the local `.env` value consumed by the collector stays
   `Basic <token>`. Docs must state the split.
   **Superseded by recon (2026-10-14):** `deploy.yml:162-163` prefixes `Authorization=`, and every
   SDK parses the raw `Authorization=Basic <token>` form (empirical probe, recon.md § Risks). The
   GitHub secret therefore stays `Basic <base64(instanceId:apiKey)>` — the same value the local
   collector uses; the encoded form is also accepted. Docs state one format.
3. **Scope:** traces only — metrics/logs pipelines are out of scope (new capability → `/sdd-story`).
4. **Visibility:** export failures must surface in service logs (Node: OTel `diag` logger).
5. **Tests:** an end-to-end regression test in every runtime copy (Go ×3, Python ×4, Node ×4, UI).

## Functional Requirements

- **FR-1** — Every Go, Python, and Node backend service exports traces over OTLP/HTTP, configured only
  by `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` (SDK appends `/v1/traces`, TLS from scheme).
- **FR-2** — `xstockstrat-ui` registers its Next.js instrumentation hook and exports traces the same way.
- **FR-3** — A failed trace export is logged by the service (no silent failure).
- **FR-4** — Local compose, the collector config, and the observability docs describe one OTLP/HTTP
  path and the two header formats (SDK `key=value` vs collector header value).

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated (env vars only; `.do/app*.yaml` keys unchanged — the HEADERS GitHub secret value format changes, operator action)
- Dependency changes: Go `otlptracehttp` (×3 go.mod), Python `opentelemetry-exporter-otlp-proto-http` (×4 pyproject + uv.lock), Node `@opentelemetry/exporter-trace-otlp-http` (×4 package.json + pnpm-lock)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; staging shows traces for every
service in Grafana Cloud after the HEADERS secret is reformatted.

## Out of Scope

- Metrics and logs OTLP pipelines
- Deploying an OTel Collector on DO App Platform
- Refactoring unrelated to the bug; performance improvements unrelated to the fix
