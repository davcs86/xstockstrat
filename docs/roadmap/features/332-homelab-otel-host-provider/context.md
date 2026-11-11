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
