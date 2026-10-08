# Feature: private-by-default-enforce-contract

**Development Branch**: `feature/private-by-default-enforce-contract`
**Created**: 2026-10-07
**Last Updated**: 2026-10-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-07 | `idea` → `draft` | /sdd-story | Product spec generated (created by feature 224 Step 41 as its named follow-up) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec private-by-default-enforce-contract`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Release N+1 of feature 224 (`private-by-default-templates`). Once 224 is launched, this feature makes
the private-by-default ownership model fail-closed and contracts 224's expand-only schema.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| DBA | Contract migrations (analysis 027, indicators 008, ingest 014): drops, NOT NULL, refused downs |
| Service owner — xstockstrat-analysis | Headerless fail-closed, `strategy_scores` drop, `backtest_runs.user_id` NOT NULL |
| Service owner — xstockstrat-indicators | `_INTERNAL_FORMULA_READERS` bypass removal, headerless fail-closed |
| Service owner — xstockstrat-ingest | Headerless fail-closed, N-1 trigger drop, `LEGACY_GLOBAL` path (if shipped) |

## Next Action

`/sdd-review private-by-default-enforce-contract product-spec`. Do this only after 224 is `launched`
(see `merge-order.md`).
