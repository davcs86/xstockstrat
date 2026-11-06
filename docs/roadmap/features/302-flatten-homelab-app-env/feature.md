# Feature: flatten-homelab-app-env

**Development Branch**: `feature/flatten-homelab-app-env`
**Created**: 2026-11-06
**Last Updated**: 2026-11-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-06 | `idea` → `draft` | /sdd-story | Product spec generated; operator decisions captured in-session (see context.md) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec flatten-homelab-app-env`_
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

`/sdd-review flatten-homelab-app-env product-spec` — AI review of product spec before running /sdd-design
