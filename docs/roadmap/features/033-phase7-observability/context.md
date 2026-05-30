# Context: phase7-observability

**Feature**: `docs/roadmap/features/033-phase7-observability/feature.md`
**Product Spec**: `docs/roadmap/features/033-phase7-observability/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/033-phase7-observability/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from brainstorming session.
- Feature number assigned: 033.
- Completes the Phase 7 implementation roadmap item (marked Pending in implementation-roadmap.md).
- No proto or schema changes. Primarily DO app spec env var configuration + OTel Collector config + Grafana dashboard provisioning.
- OTel stubs already exist in all services — must verify completeness at impl-spec time.
- Two open questions deferred to impl-spec: Grafana Cloud plan limits, and dashboard provisioning method (file-based preferred).
- Alerting integration with feature 020 (notify-external-fanout via Slack) noted as natural pairing.

## Session 2026-05-30T00:00:00Z — sdd-story (regenerate)

- Product spec regenerated fresh as part of a 4-feature spec batch (033, 041, 045, 044), each
  delivered as an independent PR off `main-dev`. Open questions deliberately left open for the
  `/sdd-review product-spec` gate per the requesting story.
- Grounded against current `main-dev`: confirmed `packages/otel/otel-collector-config.yaml`
  exists, no `packages/otel/dashboards/` directory yet, and the DO app specs currently reference
  OTEL vars only for the collector component (not the per-service workloads) — clarified in FR-1.
- Expanded the open-questions set from two to four: added the per-service OTEL var injection
  mechanism (global vs per-component) and the V1 alert routing target (email/OnCall/Slack-via-020).
- Status unchanged at `draft`; next action is `/sdd-review phase7-observability product-spec`.

