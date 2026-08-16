# Feature: droplet-compose-deploy

**Development Branch**: `feature/droplet-compose-deploy`
**Created**: 2026-07-31
**Last Updated**: 2026-07-31

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-31 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-31 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings, 2 factually corrected) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec droplet-compose-deploy`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Migrate the dev/staging environment's compute layer from DigitalOcean App Platform to a single
DigitalOcean Droplet running the repo's existing `docker-compose.yml`, fronted by Caddy in
blue/green mode to preserve near-zero-downtime deploys and TLS termination, while keeping the DO
Managed Database unchanged. Production stays on App Platform for this feature.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture, new service additions, port assignments — applies here as deployment-topology architecture, service reachability, and inter-service dependency graph correctness on the new droplet |
| Security | Identity, API keys, secrets, auth scope — applies here as the new droplet-side secrets story (no encrypted-secret-store equivalent to App Platform's `type: SECRET` exists in `docker-compose.yml` today) |

## Next Action

`/sdd-design droplet-compose-deploy` — full mode recommended (not `quick`), given the cross-cutting infra scope
