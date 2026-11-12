# Context: python-otel-instance-id

**Feature**: `docs/roadmap/features/336-python-otel-instance-id/feature.md`
**Product Spec**: `docs/roadmap/features/336-python-otel-instance-id/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/336-python-otel-instance-id/implementation-spec.md`

---

## Session 2026-11-12 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 336 reserved on `origin` via `scripts/sdd-allocate-feature-number.py` (cursor `sdd/feature-cursor`).
- Origin of the story: a Grafana investigation found the four homelab Python services exporting UUID instance ids (analysis `7ef0591e-…`, ingest `e08d49a3-…`, indicators `ce83cd93-…`, agent `f1a73349-…`), so `{service_instance_id=~"homelab-.+"}` misses 4 of 12 services. `xstockstrat-ui` was checked and already conforms (`services/xstockstrat-ui/src/telemetry.ts:57`).
- Operator decisions recorded this session: (1) keep `| host_provider="homelab"` as the documented log filter; (2) do NOT use `service.namespace` (rejected here and in feature 332 `R-6`); (3) Grafana Cloud's OTLP index-label setting is unavailable on the current tier, so no `host_provider` label; (4) run the SDD pipeline, no override.
- Supersedes feature 332 decision D-7 (`332-homelab-otel-host-provider/debate.md`) and scenario `@AC-21`. 332 is `launched`, so this is a new follow-up feature; 332's artifacts are not edited.
- Open for recon: single-process-per-service proof (identical-series collision), the real source of Python's `service.instance.id` (332 left it unverified), and any series consumer keyed on a Python `instance` value.
