# Feature: signal-source-registry

**Lifecycle Status**: `draft`
**Development Branch**: `feature/signal-source-registry`
**Created**: 2026-05-16
**Last Updated**: 2026-05-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-16 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec signal-source-registry`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add a DB-backed signal source registry to the ingest service that defines all valid sources, their types (simple_email, email_attachment, linked_email, simple_website, authenticated_website), and per-source Python extractor modules. The registry enforces canonical source slugs across ingest and analysis, and is a prerequisite for the AI agent feature and signal-source-weighting (007).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint` passes |
| DBA | Migration NNN numbering, up+down pair present, JSONB column strategy, index correctness |
| Security | credentials_ref pattern — no secrets stored in registry row, secret.* prefix enforced |

## Next Action

`/sdd-review signal-source-registry product-spec` — AI review of product spec before running /sdd-spec
