# packages/otel — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. The `observability.md` doc-lie about the OTLP port is recorded at the root (cross-cutting).

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `alerts/README.md` implies `${DS_PROMETHEUS_UID}`/`${DS_LOKI_UID}` placeholders resolve automatically | No in-repo tooling env-substitutes them; they must be hand-replaced before provisioning | `alerts/alert-rules.yaml` + `alerts/README.md:19-28` | Document that substitution is manual (an agent expecting envsubst applies a broken rule file) |

## Open questions (unresolved *why* — needs a maintainer)

- `memory_limiter.limit_mib: 256` / `spike_limit_mib: 64` / `batch.timeout: 10s` are dev-tuned magic numbers with no prod counterpart — deliberately dev-only (collector absent in prod), or placeholders? `otel-collector-config.yaml:38-46` — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
