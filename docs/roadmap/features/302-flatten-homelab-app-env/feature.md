# Feature: flatten-homelab-app-env

**Development Branch**: `feature/flatten-homelab-app-env`
**Created**: 2026-11-06
**Last Updated**: 2026-11-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-06 | `idea` → `draft` | /sdd-story | Product spec generated; operator decisions captured in-session (see context.md) |
| 2026-11-06 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings, after one FAIL round on Open Questions) |
| 2026-11-07 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, quick, extended at operator request) and approved; recon.md + design.md written; FR-7 added |
| 2026-11-07 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps (Steps 1-4 one atomic unit) |
| 2026-11-07 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1-4 (atomic unit) done on ccr-9bdbcd90-kgj5ev |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — 5 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the nested `homelab.app_env` map in the SOPS deploy secrets (feature 286) with three flat, required `homelab` keys (`DB_PASSWORD`, `APP_URL`, `SEED_USER_ID`) in the `KEYS` table, the same pattern `common` and `digitalocean` already use; drop the legacy `APP_ENV` blob fallback.

## Reviewers

| Role | Review Focus |
|---|---|
| Security | Secret resolution order (SOPS first, same-named environment secret second), values never printed, fail-closed on a missing required key, no secret in an error message |
| Platform Lead | CI/deploy tooling consistency: `KEYS` table, `deploy-homelab.yml` LEGACY_* env, runbook and durable suite stay in step |

No service owner applies: no runtime service changes.

## Next Action

`/sdd-review flatten-homelab-app-env impl-spec` — validate implementation spec, then `/sdd-execute flatten-homelab-app-env`
