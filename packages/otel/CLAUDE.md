# packages/otel — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious invariants (alerts key on the **short** `service.name`, the `rpc_server_duration_milliseconds` metric-name contract, and the confirmed OTLP port-by-runtime split `PLAT-3`) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (`observability.md` port doc-lie at root, manual `DS_*_UID` substitution) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

The platform's OpenTelemetry Collector config plus checked-in Grafana provisioning (alert rules, mute
timings, dashboards). **Local-dev only** — production (DO App Platform) has no collector; services push
OTLP straight to Grafana Cloud. General OTel setup (env vars, per-language modules) is documented in
`docs/patterns/observability.md`.
