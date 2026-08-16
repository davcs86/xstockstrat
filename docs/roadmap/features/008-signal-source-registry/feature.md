# Feature: signal-source-registry

**Committed to main**: c84aef67e8ee726451f0a1ecce8a477656cd0141
**Launched date**: 2026-05-23
**Development Branch**: `feature/signal-source-registry`
**Created**: 2026-05-16
**Last Updated**: 2026-05-22
**Archived**: 2026-08-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-05-21 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps |
| 2026-05-22 | `implementation-ready` → `implementation-ready` | /sdd-spec (re-run) | Implementation spec updated to 12 steps — added mediated source types to migration CHECK constraint, noop extractor step, and corrected DO yaml line references |
| 2026-05-22 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 complete |
| 2026-05-22 | `in-progress` → `code-completed` | /sdd-execute | Step 12 complete — all 12 steps done |
| 2026-08-05 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 2 specs |

| 2026-05-23 | `code-completed` → `launched` | CI workflow | Promoted via PR #307; committed c84aef67e8ee726451f0a1ecce8a477656cd0141 |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-05; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add a DB-backed signal source registry to the ingest service that defines all valid sources, their types (simple_email, email_attachment, linked_email, simple_website, authenticated_website), and per-source Python extractor modules. The registry enforces canonical source slugs across ingest and analysis, and is a prerequisite for the AI agent feature and signal-source-weighting (007).

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-05-21. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-config-ui` owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint` passes |
| DBA | Migration NNN numbering, up+down pair present, JSONB column strategy, index correctness |
| Security | credentials_ref never in responses, admin auth scope on ManageSignalSource, secret.* prefix enforced |

## Next Action

`/sdd-execute signal-source-registry` — implementation spec reviewed and ready for execution
