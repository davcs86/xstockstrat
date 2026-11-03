# Feature: sops-secrets-migration

**Development Branch**: `feature/sops-secrets-migration`
**Created**: 2026-11-03
**Last Updated**: 2026-11-03

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-03 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec sops-secrets-migration`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Move deploy-time secrets (DigitalOcean App Platform runtime secrets and homelab deploy secrets) out of
GitHub secrets / 1Password into per-environment SOPS (age) files committed to the repo. Each
environment's age private key lives in its GitHub Environment secret `SOPS_AGE_KEY`, and a one-shot
bootstrap workflow builds the first files from the values in effect today, so the cutover causes no disruption.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | Secret custody and blast radius: per-env key isolation, no plaintext in logs/commits/artifacts, `CONFIG_SECRETS_ENCRYPTION_KEY` still delivered as a bootstrap env var |
| Platform Lead | Cross-workflow deploy topology (DO + homelab), environment protection-rule impact on DO deploy jobs |

## Next Action

`/sdd-review sops-secrets-migration product-spec` — AI review of product spec before running /sdd-spec
