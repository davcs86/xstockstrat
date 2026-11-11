# Context: homelab-otel-host-provider

**Feature**: `docs/roadmap/features/332-homelab-otel-host-provider/feature.md`
**Product Spec**: `docs/roadmap/features/332-homelab-otel-host-provider/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/332-homelab-otel-host-provider/implementation-spec.md`

---

## Session 2026-11-11 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 332 reserved on origin via `scripts/sdd-allocate-feature-number.sh`.
- Operator decisions (Q&A before story): (1) Grafana Cloud free tier acceptable now, self-hosted migration is future work; (2) attribute name is `host_provider`; (3) reuse the DO OTLP endpoint/credential mechanism where possible; (4) Grafana Cloud usage is not a constraint, DO will be cut over to homelab.
- Pre-story recon: `deploy/homelab/compose.yml:7` hardcodes `OTEL_ENABLED: "false"`; Grafana `deployment_environment` has only `staging`; `host_name` values are k8s pod names; resource attributes are on `target_info`, not on metric series.
- Branch note: harness branch is `ccr-6307b904-swdg1c`; the `feature/homelab-otel-host-provider` name in feature.md is the SDD convention, the PR still targets `main-dev`.

## Session 2026-11-11 — rename

- Operator renamed the resource attribute `host_provider` -> `host.provider` (OTel dotted form, matching `deployment.environment`). Prometheus/Loki label form is `host_provider` (dots -> underscores). Env var stays `HOST_PROVIDER`; slug/directory unchanged.
- Flag for review: `host.*` is an OTel semantic-convention namespace; `host.provider` is not a defined semconv attribute (the standard one is `cloud.provider`), so a future semconv addition could collide. Recorded, operator decision stands.

## Session 2026-11-11 — product-spec fixes after review FAIL

- First `/sdd-review product-spec` returned FAIL: criterion 9 (7 unchecked Open Questions) and trading-domain C-1 (no per-target `HOST_PROVIDER`/`OTEL_ENABLED` values). No Floor breach; overlap scan clean (WARN-level shared files only: 307 `deploy-homelab.yml`, 329 telemetry resource builders, 331 `.do/app*.yaml`, 297 dashboards).
- Operator decisions: unset or unrecognised `HOST_PROVIDER` resolves to `unknown`; DO dev and DO prod set `digitalocean` explicitly; fixes approved.
- Spec changes: FR-1 binds only the deploy interface (mechanism left to design); FR-2 value set gains `unknown`; FR-6 excludes `db-migrator` and names the `render-assert.jq:22,39` inversion; new FR-8 plus a per-target table (local compose `${OTEL_ENABLED:-false}`, DO dev `"true"`, DO prod `"false"`, homelab pipeline-owned `"true"`). Open Questions checked off as resolved or deferred with an owner.
- Finding recorded: DO production (`.do/app.yaml:33`) has `OTEL_ENABLED "false"`, so only DO dev exports to Grafana Cloud today. Enabling prod telemetry is out of scope.
- Acceptance: AC-3/AC-4 pinned to `unknown`; AC-6 uses the `us-central-0` example and excludes `db-migrator`; AC-7 asserts the `otel:xstockstrat-ui` label; AC-10/AC-11 made concrete and tagged `@smoke`; added AC-13 (exact lowercase match), AC-14 (wrong provider fails the render check), AC-15 (per-target values, FR-8).
