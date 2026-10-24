# Feature: homelab-compose-deploy

**Development Branch**: `feature/homelab-compose-deploy`
**Created**: 2026-10-24
**Last Updated**: 2026-10-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-24 | `idea` → `draft` | /sdd-story | Product spec generated; operator decisions captured in-session (see context.md) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec homelab-compose-deploy`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Deploy xstockstrat to the homelab VMs (staging and production) through homelab-edge's tailnet and forced-command
app-deploy gate, in parallel with the DigitalOcean deploys, with a digest-pinned Compose stack and a gRPC health
service on the Go services so the gate's health-gated rollback covers every service.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture: new deploy target, port exposure (only 3000/9000 published), inter-service dependency graph in the homelab compose file |
| Security | Secrets only via GitHub environment secrets / 1Password into a 0600 `.env`; mTLS CA per environment; no secret in compose, logs or the run summary |
| `xstockstrat-trading` owner | Health service registered only after broker/DB/config init; no change to order execution; paper-only staging invariant (`APPLICATION_ENV` ≠ `production`) |
| `xstockstrat-portfolio` owner | Health service + healthcheck mode only; no change to P&L paths |
| `xstockstrat-marketdata` owner | Health service + healthcheck mode only; no change to ingestion |

## Next Action

`/sdd-review homelab-compose-deploy product-spec` — AI review of product spec before running /sdd-spec
