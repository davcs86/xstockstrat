# Context: metrics-host-provider-label

**Feature**: `docs/roadmap/features/337-metrics-host-provider-label/feature.md`
**Product Spec**: `docs/roadmap/features/337-metrics-host-provider-label/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/337-metrics-host-provider-label/implementation-spec.md`

---

## Session 2026-11-12 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 337 reserved on origin via `scripts/sdd-allocate-feature-number.py`. Branch `feature/metrics-host-provider-label` from `origin/main-dev` (cee3bae).
- Operator constraints (pre-decided): no `service.namespace` or standard-attribute reuse; logs filter unchanged; metrics-only; alerts/dashboards out of scope; must not depend on or touch feature 336 (PR #1527).
- Prior art: feature 332 `debate.md` locked R-1 (Grafana-side promotion as sole mechanism: "unversioned stack setting, untestable from the repo") and R-2 (per-datapoint attribute via views: "touches every instrument in 12 runtimes; Go views can only drop attributes and `serverMetricViews` must stay unchanged (`@AC-56 @feature-294`)"). This feature reopens both at the operator's request; design must address those reasons, not ignore them.
- C-16: AC-10/AC-11 of 332 in `docs/sdd/business-rules/platform.feature` document the join; expected EXTEND (simple form added), recon to classify.

## Session 2026-11-12 — sdd-review product-spec

- Round 1: FAIL — FR-4 had no covering `@AC-*` (C-15); five Open Questions unchecked. Fixed: added `@AC-12 @FR-4`; AC-2 expanded to all 12 runtimes; AC-6 pinned to 3600 (`observability.md:114`); FR-7 now states that `check-otel-produced-signals.py` Part 6 (`:368-384`, exactly one promql block; `:502-505` target_info matchers) changes; open questions checked off as deferred to /sdd-design; ledger traps moved to a constraints note.
- Round 2: PASS WITH WARNINGS, no blockers; stale "All five" count fixed. Product spec approved. Status: draft → spec-ready. Tree: feature/metrics-host-provider-label@ca75255 ≡ origin.
- Overlap (WARN only, no FAIL): `observability.md` §"Separating DO and homelab" and `check-otel-produced-signals.py` shared with 333 (`otel-env-provider-scoped-alerts`) and 297; `produced-signals.tsv` append-at-end shared with 297; per-runtime telemetry modules shared with 329 and 332 (only if option B); 336 has no directory on disk (unverifiable, spec forbids depending on it); `platform.feature` `@AC-10`/`@AC-11` are reused across many features, target the `@feature-332` pair (`:2325`, `:2331`). No merge-order row written (non-blocking textual overlap; precedent `merge-order.md:367-376`); awaiting operator confirmation.
- Recommended design depth: **full** per `docs/sdd/design-depth-rubric.md` (12 services, overlap findings). Operator instruction was `quick`; running `quick` and surfacing the divergence.
- Live check (Grafana MCP, 2026-11-12): label names on `rpc_server_duration_milliseconds_count` = `deployment_environment, instance, job, rpc_grpc_status_code, rpc_method, rpc_service, rpc_system, service_instance_id, service_name` — no `host_provider`. Grafana docs for option A: self-service "experimental, contact Grafana Labs Support"; changes apply to newly ingested data only.
