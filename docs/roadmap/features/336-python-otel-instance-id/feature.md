# Feature: python-otel-instance-id

**Development Branch**: `feature/python-otel-instance-id`
**Created**: 2026-11-12
**Last Updated**: 2026-11-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-12 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-12 | `draft` | operator | Scope widened to all 12 runtimes; `-<suffix6>` added to the id |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec python-otel-instance-id`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

All 12 runtimes export `service.instance.id = <host.provider>-<service.name>-<suffix6>`, where the suffix is the first 6 hex of the Docker container id (OS hostname) or else 6 random hex. This supersedes feature 332 decision D-7, its scenario AC-21 and its exact-id assertions, so every homelab service is selectable by one instance-id prefix and replicas of a service never collide.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture: one instance-id contract across 12 runtimes |
| Service owners of all 12 services | Per registry: `xstockstrat-trading`, `-portfolio`, `-marketdata`, `-indicators`, `-ingest`, `-analysis`, `-ledger`, `-identity`, `-notify`, `-config`, `-ui`, `-agent` — telemetry-only change, no behavior change to their own focus areas |

## Next Action

`/sdd-review python-otel-instance-id product-spec` — AI review of product spec before running /sdd-spec
