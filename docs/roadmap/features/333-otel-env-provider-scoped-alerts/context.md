# Context: otel-env-provider-scoped-alerts

**Feature**: `docs/roadmap/features/333-otel-env-provider-scoped-alerts/feature.md`
**Product Spec**: `docs/roadmap/features/333-otel-env-provider-scoped-alerts/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/333-otel-env-provider-scoped-alerts/implementation-spec.md`

---

## Session 2026-11-11 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 333 reserved on origin via `scripts/sdd-allocate-feature-number.sh`.
- Named C-14 follow-up of feature 332 (`homelab-otel-host-provider`, design D-8): 332 accepted that alerts are not provider-scoped and deferred the scoping here.
- Story-time reads: the heartbeat (`xstk-analysis-no-scoring`) is a Loki rule, so its scoping uses the `deployment_environment` stream label and `host_provider` structured metadata, not the `target_info` join; 297 keeps alert rules a manual import (297 product-spec G11), so changed rules reach Grafana by operator re-import.
- Depends on 332 merged; sequence after 297.
