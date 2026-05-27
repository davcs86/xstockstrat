# Feature: ci-docker-registry-deploy

**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/ci-docker-registry-deploy`
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-05-26 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |
| 2026-05-26 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done — docker-build job added to ci.yml |
| 2026-05-26 | `in-progress` → `code-completed` | /sdd-execute | All 5 steps done — open integration PR to main-dev |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Move Docker image builds from DigitalOcean's infrastructure into GitHub Actions CI, push images to a container registry, and configure DO App Platform to deploy pre-built images. This surfaces build failures at PR time rather than during deployment and eliminates cold `pnpm install + pnpm build` runs on DO for every deploy.

## Reviewers

_(Snapshot finalized by /sdd-spec — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service CI/CD architecture, port assignments, inter-service consistency; this change restructures the entire build pipeline for all 14 services |

## Next Action

`/sdd-review ci-docker-registry-deploy impl-spec` — validate implementation spec, then `/sdd-execute ci-docker-registry-deploy`
