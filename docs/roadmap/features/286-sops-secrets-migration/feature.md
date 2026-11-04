# Feature: sops-secrets-migration

**Development Branch**: `feature/sops-secrets-migration`
**Created**: 2026-11-03
**Last Updated**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-03 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-03 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-11-03 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + design.md written |
| 2026-11-04 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 20 steps |
| 2026-11-04 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential run started; Step 1 done |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — 20 numbered steps with codebase evidence
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
| Security | Secret custody and blast radius: per-env key isolation, no plaintext in logs/commits/artifacts, fail-closed resolution, fallback RHS pinning (no environment-secret shadowing), pinned + checksum-verified sops/age, `CONFIG_SECRETS_ENCRYPTION_KEY` still delivered byte-identical as a bootstrap env var (Steps 2–16) |
| Platform Lead | Cross-workflow deploy topology (DO + homelab): env-bound reusable `deploy.yml`, app ID by spec name, production reviewer gate on every main push and prod-up, one substitution path for deploy + prod-up, CI gate completeness, `do-setup-check.sh` secret list (Steps 1, 2, 4, 7, 8, 10, 12, 14, 16, 17, 18) |

_No service owner applies: no runtime service changes (product spec § Affected Services). `docs` steps (19, 20) carry no reviewer._

## Next Action

`/sdd-review sops-secrets-migration impl-spec` — validate implementation spec, then `/sdd-execute sops-secrets-migration`
