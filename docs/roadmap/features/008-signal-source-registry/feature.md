# Feature: signal-source-registry

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/signal-source-registry`
**Created**: 2026-05-16
**Last Updated**: 2026-05-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-05-21 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps |
| 2026-05-22 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 complete |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase-grounded references
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
