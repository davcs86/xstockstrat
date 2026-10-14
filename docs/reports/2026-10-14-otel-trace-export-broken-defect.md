# Defect: OTel trace export fails for every service — exporter protocol/endpoint mismatch with the Grafana Cloud OTLP gateway

**Recorded**: 2026-10-14
**Reporter**: davcs86@gmail.com (via Claude Code)
**Severity**: SEV-3
**Impact type**: observability-loss (no traces reach Grafana Cloud; no runtime or trading impact — OTel is fail-open)
**Environment**: staging (`xstockstrat-staging`, deployment `bae5db83`, `OTEL_ENABLED=true`) and local docker-compose; production has `OTEL_ENABLED=false` and inherits the same code
**Affected service(s)**: all twelve — xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-agent, xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify, xstockstrat-config, xstockstrat-ui
**Config-only fix possible**: no

## Observed

Staging injects `OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-west-0.grafana.net/otlp`
(global app env, inherited by every component). Each runtime fails to export against it, each for a
different reason:

- **Go** — `otlptracegrpc.WithEndpoint(<full URL>)` + `WithInsecure()`: the option accepts only
  `host:port`, so the gRPC target never resolves. Live log, repeating every ~5 s:
  `traces export: exporter export timeout: rpc error: code = Unavailable desc = name resolver error: produced zero addresses`
- **Python** — gRPC `OTLPSpanExporter(endpoint=…, insecure=True)`: wrong protocol for an
  OTLP/HTTP-only gateway, and `insecure=True` forces plaintext onto :443. No exporter error surfaces in logs.
- **Node backends** — `@opentelemetry/exporter-trace-otlp-grpc` with `url: endpoint`: wrong protocol;
  the `/otlp` path is ignored. Logs `[otel] tracing enabled → …` then nothing — no diag logger, so failures are silent.
- **UI (Next.js)** — `instrumentation.ts` sits at the project root while the app uses `src/`, so
  Next.js never registers the hook (no `[otel] tracing enabled` line at startup). Even if it ran,
  `OTLPTraceExporter({ url: endpoint })` uses the URL verbatim (no `/v1/traces` appended) → 404.

Cross-cutting:

- `docs/setup/grafana-cloud.md` documents `OTEL_EXPORTER_OTLP_HEADERS=Basic <token>` — the
  collector's header-*value* form. SDKs reading the var directly require the spec `key=value` form
  (`Authorization=Basic%20<token>`); the documented value yields no `Authorization` header.
- `docs/setup/grafana-cloud.md` claims the gateway accepts gRPC on :443; the Go failure contradicts it.
- Local compose is broken too: Go gets `http://otel-collector:4317` (URL into a `host:port` option),
  Node backends point a gRPC exporter at the collector's HTTP port `:4318`, UI posts to `:4318/` without `/v1/traces`.

## Expected

Every service exports traces over OTLP/HTTP, configured solely by the spec env vars
(`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`) so the SDK appends `/v1/traces` and
derives TLS from the scheme; export failures are visible in service logs.

## Reproduction

1. Deploy with `OTEL_ENABLED=true` and the Grafana Cloud gateway URL as `OTEL_EXPORTER_OTLP_ENDPOINT` (current staging).
2. Tail `xstockstrat-trading` runtime logs → repeating `name resolver error: produced zero addresses`.
3. Tail `xstockstrat-ui` startup logs → no `[otel] tracing enabled` line.
4. Query Grafana Cloud Tempo for `service.name` of any service → no traces.

## Evidence

`services/xstockstrat-trading/internal/telemetry/otel.go:28-31` (same in portfolio, marketdata)
> `otlptracegrpc.WithEndpoint(endpoint), otlptracegrpc.WithInsecure(),`

`services/xstockstrat-analysis/app/telemetry.py:34,43` (same in indicators, ingest, agent)
> `exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)`

`services/xstockstrat-ledger/src/telemetry.ts:30,39` (same in identity, notify, config)
> `require('@opentelemetry/exporter-trace-otlp-grpc')` … `new OTLPTraceExporter({ url: endpoint })`

`services/xstockstrat-ui/instrumentation.ts:1` and `services/xstockstrat-ui/src/telemetry.ts:23`
> `traceExporter: new OTLPTraceExporter({ url: endpoint }),`

`docker-compose.yml:133,166,200,235` (Node backends → `:4318` with gRPC exporter), `:283-568` (Go/Python → `http://otel-collector:4317`)

`docs/setup/grafana-cloud.md:68,175-179`

## Root cause hypothesis

Exporters were wired for a local gRPC collector with explicit endpoint options that override the
spec env-var handling; production pushes directly to an OTLP/HTTP-only gateway with a full URL, which
none of the four runtime setups can consume.

## Confidence

high
