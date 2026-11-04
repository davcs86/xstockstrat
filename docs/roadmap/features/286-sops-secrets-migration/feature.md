# Feature: sops-secrets-migration

**Development Branch**: `feature/sops-secrets-migration`
**Created**: 2026-11-03
**Last Updated**: 2026-11-04
**Committed to main**: 86132e77a5e1a8da3e2b24f2fc58809cfc008d9a
**Launched date**: 2026-11-04
**Archived**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-03 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-03 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-11-03 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + design.md written |
| 2026-11-04 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 20 steps |
| 2026-11-04 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential run started; Step 1 done |
| 2026-11-04 | `in-progress` → `code-completed` | /sdd-execute | All 21 steps done (sequential); deviations D-1..D-4 |

| 2026-11-04 | `code-completed` → `launched` | CI workflow | Promoted via PR #1406; committed 86132e77a5e1a8da3e2b24f2fc58809cfc008d9a |
| 2026-11-04 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(2); pruned 4 specs |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15); scenarios already promoted at launch (see feature's acceptance.feature and service suites)
- Recon — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
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
