# Feature: ci-docker-registry-deploy

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/ci-docker-registry-deploy`
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec ci-docker-registry-deploy`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Move Docker image builds from DigitalOcean's infrastructure into GitHub Actions CI, push images to a container registry, and configure DO App Platform to deploy pre-built images. This surfaces build failures at PR time rather than during deployment and eliminates cold `pnpm install + pnpm build` runs on DO for every deploy.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service CI/CD architecture, port assignments, inter-service consistency; this change restructures the entire build pipeline for all 14 services |

## Next Action

`/sdd-spec ci-docker-registry-deploy` — generate implementation spec from the approved product spec
