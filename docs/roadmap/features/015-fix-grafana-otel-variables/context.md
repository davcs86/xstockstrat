# Context: fix-grafana-otel-variables  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Shipped as "Path B" (runtime derivation of OTel resource attributes inside each of 13 services' telemetry init, in Go/Python/Node/Next.js) rather than the originally-planned "Path A" (fixing the external `OTEL_RESOURCE_ATTRIBUTES` env var string). Post-merge (same branch, PR #277), the user found further drift and the scope grew again: `GRAFANA_OTLP_*` renamed to standard `OTEL_EXPORTER_OTLP_*`, `OTEL_SERVICE_NAME` renamed to `SERVICE_NAME` with the `xstockstrat-` prefix stripped, and a real DO app-spec bug fixed (context.md:130-143).
**Why (irrecoverable rationale)**: Path A was abandoned because DigitalOcean App Platform's global `envs` block cannot reference component-scoped vars, so a global `OTEL_RESOURCE_ATTRIBUTES` string could never correctly compose `service.name=${OTEL_SERVICE_NAME}` per service (context.md:17-27, "Decision — service.name in OTEL_RESOURCE_ATTRIBUTES" / "scope revision: Path B"). Runtime derivation was the only way to keep attributes correct across both Docker Compose (which can interpolate per-container) and DO (which cannot).
**Rejected alternatives**: - Path A (external `OTEL_RESOURCE_ATTRIBUTES` string, fixed in place across 3 config files) — lost because DO global envs can't reference per-component vars, and it required manual attribute-string maintenance that had already drifted once (context.md:9-27).
**Scars & gotchas**:
- `@opentelemetry/resources@2.x` removes the `Resource` class (must use `resourceFromAttributes`); `@opentelemetry/semantic-conventions@1.41.1` renames `SEMRESATTRS_*`→`ATTR_*`, and `ATTR_DEPLOYMENT_ENVIRONMENT_NAME` maps to a *different* wire key (`deployment.environment.name`, not `deployment.environment`) — kept the plain string key to stay consistent with Go/Python (implementation-spec.md:607-610).
- `tsc --noEmit` couldn't run in the remote exec env (no `node_modules`); grep substituted as verification for Step 7 (implementation-spec.md:612-615).
- CI's `ci-validate-feature-status.yml` failed to auto-flip this feature to `launched` due to three combined bugs: unescaped `**` in a BRE grep, a `grep "PR #"` pattern that never matches squash-merge format `(#281)`, and `sed -i` inserting before every `---` in feature.md (context.md:146-154).
- DO app spec: `OTEL_EXPORTER_OTLP_ENDPOINT: value: ""` would have been passed literally to the OTel SDK at runtime; fixed to `scope: RUN_TIME` with no value (context.md:135-136).
**Permanent deviations**:
- design said `OTEL_SERVICE_NAME: xstockstrat-<name>` → shipped `SERVICE_NAME: <name>` (prefix stripped) → because user requested consistency cleanup post-merge (context.md:124-127).
- design said `OTEL_EXPORTER_OTLP_ENDPOINT` as empty-string placeholder → shipped `scope: RUN_TIME` (no value) → because empty string would break the SDK at runtime (context.md:135-136).
- `GRAFANA_OTLP_*` → `OTEL_EXPORTER_OTLP_*` rename was never in the original spec at all (context.md:143).
**Cross-feature signal**: - Promotion-automation (`ci-validate-feature-status.yml`) is fragile against actual commit-message/markdown formats; other features' promotions may hit the same silent-failure mode until that workflow is independently hardened.
**Deferred follow-ons**: none stated.
**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - Candidate PLAT-* note: "DO App Platform global envs cannot reference component-level vars" — worth adding to docs/context-constitution.md if not already captured there.
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 33ff5dc.
