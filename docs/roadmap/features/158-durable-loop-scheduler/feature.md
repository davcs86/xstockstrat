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
| 2026-08-26 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Thin DurableSchedule class + additive ALTER migration; live_loop descoped (operator); @AC-6 retired, @AC-9 added |
| 2026-08-26 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — 8 numbered steps with codebase evidence (C-01)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Generalize feature 156's durable, crash-safe schedule (used only by the fundamentals producer today)
into a reusable scheduler + a schedule table keyed by `(job_name, user_id)`, and migrate the other
interval background loops onto it so every loop fires promptly on boot and keeps a redeploy-/crash-safe
cadence.

## Reviewers

_(Snapshot finalized at /sdd-spec time from docs/runbooks/reviewer-registry.md — the distinct set of
per-step reviewers. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias — service/config/test steps (helper, fundsignal migration, opportunity rewrite, config keys); no new DB pool (F-06) |
| DBA | Migration NNN numbering (no gaps/conflicts), up+down pair present, index/PK correctness, run-order compliance — the `020_job_schedule` additive-ALTER off the feature-156 `fundsignal_schedule` table |

## Next Action

`/sdd-review durable-loop-scheduler impl-spec` — validate implementation spec, then `/sdd-execute durable-loop-scheduler`
