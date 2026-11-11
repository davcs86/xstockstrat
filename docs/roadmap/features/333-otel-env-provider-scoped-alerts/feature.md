# Feature: otel-env-provider-scoped-alerts

**Development Branch**: `feature/otel-env-provider-scoped-alerts`
**Created**: 2026-11-11
**Last Updated**: 2026-11-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-11 | `idea` → `draft` | /sdd-story | Product spec generated (named follow-up of feature 332, C-14 deferral) |
| 2026-11-11 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings) after one FAIL round (open questions) and three warning rounds |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec otel-env-provider-scoped-alerts`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Scope the three Grafana alert rules and the service-detail dashboard by `deployment_environment` and `host_provider`, so an error in one exporting stack (DO dev, homelab staging, homelab production) pages with a label naming that stack, and a live analysis loop in one stack can no longer hide a dead loop in another.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service observability contract: alert and dashboard semantics across every exporting stack; produced-signal registry stays complete |
| `xstockstrat-analysis` | The live-loop heartbeat still pages for a dead loop; `live_loop: cycle complete` literal stays the producer contract |

## Next Action

`/sdd-design otel-env-provider-scoped-alerts` — full design recommended (file-level overlap with 297 on `produced-signals.tsv` and `dashboards/README.md`; recon must verify the `target_info` join in Grafana-managed rules and LogQL grouping by structured metadata against the live datasource). Feature 332 is merged (`f99f667`).
