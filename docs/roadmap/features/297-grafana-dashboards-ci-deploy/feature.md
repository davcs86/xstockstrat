# Feature: grafana-dashboards-ci-deploy

**Development Branch**: `feature/grafana-dashboards-ci-deploy`
**Created**: 2026-11-05
**Last Updated**: 2026-11-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-05 | `idea` → `draft` | /sdd-story | Distilled from stale PR [davcs86/xstockstrat#653](https://github.com/davcs86/xstockstrat/pull/653) and re-based against `main-dev` @ b371a3e |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements, PR-653 delta analysis, governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec grafana-dashboards-ci-deploy`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Automate the deploy of the checked-in Grafana dashboards (`packages/otel/dashboards/`) to Grafana Cloud from CI. The Grafana MCP part of PR 653 is split out (decided 2026-11-05). Environment scoping of the four unscoped dashboards is folded in; alert rules stay out of scope (decided 2026-11-05). Distilled from PR 653 (open since 2026-06-09, base `main`, `mergeable_state: dirty`); the PR's design is re-validated against the post-274 dashboards, the SOPS secrets model (286) and the produced-signals guard, and its gaps are captured as requirements and open questions.

## Reviewers

| Role | Review Focus |
|---|---|
| Platform Lead | New workflow + script under `.github/workflows/` and `scripts/`; CI path filters; single deploy lane (`main-dev`); docs/context-file consistency |
| Security | New CI credential (`GRAFANA_SERVICE_ACCOUNT_TOKEN`, Editor role): GitHub Environment secret in a dedicated `grafana` environment (decided), scope, expiry and rotation, no echo in logs |

No service owner applies: no `services/*` code, proto, config key or migration changes (`packages/otel` has no registry row).

## Next Action

`/sdd-review grafana-dashboards-ci-deploy product-spec`. Q9a is the only open item that blocks `/sdd-design`; Q4–Q8 are non-blocking.
