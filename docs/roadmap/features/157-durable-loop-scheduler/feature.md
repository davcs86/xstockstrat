# Feature: durable-loop-scheduler

**Development Branch**: `feature/durable-loop-scheduler`
**Created**: 2026-08-26
**Last Updated**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 advisory warnings addressed; 2 scope OQs resolved with operator → include wall-clock mode + ship per-user key) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec durable-loop-scheduler`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Generalize feature 156's durable, crash-safe schedule (used only by the fundamentals producer today)
into a reusable scheduler + a schedule table keyed by `(job_name, user_id)`, and migrate the other
interval background loops onto it so every loop fires promptly on boot and keeps a redeploy-/crash-safe
cadence.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and change types.
Override as needed. Snapshot finalized at /sdd-spec time — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Scheduler determinism / no look-ahead; loop cadence + crash-safety; no new DB pool (F-06); no regression to migrated loops' outputs |
| DBA | Migration NNN numbering (no gaps), up+down pair, index correctness; safe migration off the feature-156 `fundsignal_schedule` table |

## Next Action

`/sdd-design durable-loop-scheduler` — recon + adversarial design debate before running /sdd-spec
