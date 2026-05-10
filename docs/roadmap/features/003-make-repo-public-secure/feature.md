# Feature: make-repo-public-secure

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/make-repo-public-secure`
**Created**: 2026-05-10
**Last Updated**: 2026-05-10T00:00:00Z

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-10 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 advisory warning) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec make-repo-public-secure`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Audit the xstockstrat-orchestration repository for all hardcoded secrets, credentials, API keys, and sensitive configuration values, remove or replace them with environment variable references or safe placeholders, and update documentation to reflect public-repo best practices before making the repository public on GitHub.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct |
| Platform Lead | Cross-service architecture, service registry consistency, inter-service dependency graph correctness |
| `xstockstrat-identity` owner | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) |

## Next Action

`/sdd-spec make-repo-public-secure` — generate implementation spec from the approved product spec
