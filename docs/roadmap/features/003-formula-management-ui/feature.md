# Feature: formula-management-ui

**Lifecycle Status**: `draft`
**Development Branch**: `feature/formula-management-ui`
**Created**: 2026-05-10
**Last Updated**: 2026-05-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-10 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec formula-management-ui`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Persist indicator formulas to TimescaleDB so they survive service restarts, scope them to the owning user (`author = user_id`), and add a full CRUD management UI inside `xstockstrat-insights`.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, backward compatibility (no field removal or type change without deprecation), `buf lint`/`buf breaking` passes, BSR publication readiness |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh` |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution |
| `xstockstrat-insights` owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |

## Next Action

`/sdd-review formula-management-ui product-spec` — AI review of product spec before running /sdd-spec
