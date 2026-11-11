# Product Spec: fix-telemetry-startup-log

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-telemetry-startup-log-raw-endpoint-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### Telemetry startup log prints the raw OTLP endpoint env var (undefined/None when unset)

- **Observed**: since feature 226 the exporters take no endpoint argument and resolve it from the OTel
  spec env vars (falling back to the SDK default), but the startup log still prints the raw
  `OTEL_EXPORTER_OTLP_ENDPOINT` value: with it unset the log reads `→ undefined` (Node) or
  `endpoint: None` (Python) while the SDK exports to `http://localhost:4318`. The UI `CLAUDE.md` env
  block lists the var with no note that it is required when `OTEL_ENABLED` is on.
- **Expected**: log the effective endpoint (or "SDK default" when unset), and document the variable as
  required when `OTEL_ENABLED=true`.
- Report: [docs/reports/2026-10-19-telemetry-startup-log-raw-endpoint-defect.md](../../../reports/2026-10-19-telemetry-startup-log-raw-endpoint-defect.md)

## Reproduction Steps

1. Set `OTEL_ENABLED=true`, leave `OTEL_EXPORTER_OTLP_ENDPOINT` unset.
2. Start `xstockstrat-ui` (or any Node/Python service).
3. Startup log reads `[otel] tracing enabled → undefined (service=…)`.

## Root Cause Hypothesis

The log line survived from the pre-226 code where `endpoint` was passed to the exporter; feature 226
removed the argument but kept the variable for logging only. Current sites (lines moved since the
report):
- Node: `services/xstockstrat-ui/src/telemetry.ts:36` (raw read), `:64` (log); `xstockstrat-config`
  `src/telemetry.ts:190`, `xstockstrat-identity` `:191`, `xstockstrat-ledger` `:191`,
  `xstockstrat-notify` `:192`
- Python: `xstockstrat-analysis` `app/telemetry.py:214`, `xstockstrat-indicators` `:208`,
  `xstockstrat-ingest` `:209`, `xstockstrat-agent` `:82`
- Docs: `services/xstockstrat-ui/CLAUDE.md:302`

## Affected Services

xstockstrat-config, xstockstrat-identity, xstockstrat-ledger, xstockstrat-notify, xstockstrat-ui,
xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-agent

## Fix Scope

- Proto changes anticipated: **no** — startup logging and docs only.
- DB migrations anticipated: **no** — no schema or data involved.
- Config key changes anticipated: **no** — `OTEL_*` are boot env vars, not `WatchConfig` keys; only their documentation changes.

## Open Questions

None raised by the report.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Go services (trading, portfolio, marketdata) — not cited by the report; their `internal/telemetry` does not log the raw var
- Changing how the exporters resolve the endpoint (feature 226 behaviour stays)
