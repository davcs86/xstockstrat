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
