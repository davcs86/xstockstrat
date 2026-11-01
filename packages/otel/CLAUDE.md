# packages/otel — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious invariants (alerts/dashboards key on the **short** `service.name` (OTEL-1), and the env-only OTLP/HTTP export rule `PLAT-3`) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (collector headers comment) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

The platform's OpenTelemetry Collector config plus checked-in Grafana provisioning (dashboards, alert rules
and a mute timing) over the three exported signals (traces, metrics, logs). `produced-signals.tsv` registers every series
and log literal an alert or dashboard may query; `scripts/check-otel-produced-signals.sh` enforces it. **Local-dev only** — production (DO App Platform) has no collector; services push
OTLP straight to Grafana Cloud. General OTel setup (env vars, per-language modules) is documented in
`docs/patterns/observability.md`.
