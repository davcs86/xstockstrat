# packages/otel — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. The `observability.md` doc-lie about the OTLP port is recorded at the root (cross-cutting).

## Documentation that lies (docs claim behavior the code lacks)

_None currently open — see Resolved._

## Open questions (unresolved *why* — needs a maintainer)

- `memory_limiter.limit_mib: 256` / `spike_limit_mib: 64` / `batch.timeout: 10s` are dev-tuned magic numbers with no prod counterpart — deliberately dev-only (collector absent in prod), or placeholders? `otel-collector-config.yaml:38-46` — status: **open**

## Resolved

- **`alerts/README.md` implies `${DS_PROMETHEUS_UID}`/`${DS_LOKI_UID}` placeholders resolve automatically** — retired 2026-08-09 (refresh): this row misdiagnosed its own evidence. `alerts/README.md:19-29` ("## Substitutions before provisioning") already explicitly instructs "replace them before applying" with a table of what to substitute; `docs/setup/grafana-cloud.md:246-249` is equally explicit. No `envsubst`/templating tooling was ever implied or expected. Confirmed no such tooling exists (repo-wide grep for `DS_PROMETHEUS_UID|DS_LOKI_UID|envsubst`, only doc references). Not a real doc-lie — dropped.

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
