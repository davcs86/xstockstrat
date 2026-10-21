# Context: otel-metrics-logs-export

**Feature**: `docs/roadmap/features/274-otel-metrics-logs-export/feature.md`
**Product Spec**: `docs/roadmap/features/274-otel-metrics-logs-export/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/274-otel-metrics-logs-export/implementation-spec.md`

---

## Session 2026-10-21 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Source: root `docs/context-constitution-findings.md` row "metrics and logs" (Remedy: "New capability →
  `/sdd-story` to add metrics/logs export") and report
  `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md`.
- Operator decisions (binding, recorded 2026-10-21, answered in-session):
  - **NNN = 274, operator-specified.** max+1 was 254 (highest on main-dev and all `feature/*` branches: 253). This
    deviates from `feature-workflow.md` § Feature Numbering by explicit operator instruction; 254–273 are unused.
  - **Ordering vs feature 250: "250 lands first, 274 after".** 250 (`fix-otel-metrics-logs-gap`,
    implementation-ready, operator decision "Narrow to traces") ships as specced and removes the metric/log-backed
    alerts and panels; 274 then adds export and restores them (FR-6). Recorded as a hard row in `merge-order.md`.
    The design must build on 250's landed state, including its produced-signals guard.
  - **This feature reverses feature 226 Operator Decision 3 (traces only)** for metrics/logs. The operator
    requested it explicitly (C-11 sign-off for a new capability).
  - **Logs path: in-process OTLP log bridge** (Go slog, Python logging, Node winston → LoggerProvider → OTLP/HTTP
    `/v1/logs`); DO `log_destinations` / collector filelog rejected.
  - **`platform.otel.enabled` live switch: not implemented; fix the docs.** Out of 274's scope. The phantom claim
    in `docs/patterns/observability.md` was removed and its root findings row marked resolved in the same docs-only
    change that filed this story (outside SDD, per root CLAUDE.md: docs-only edits are out of the entry-point rule).
- Open forks deferred to `/sdd-design` (see product-spec Open Questions): FR-2 series-name parity across
  languages, cardinality budget, and whether 250's `trace-derived-alerting` follow-up should cite 274 instead.
