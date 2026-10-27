# Feature: homelab-compose-deploy

**Development Branch**: `feature/homelab-compose-deploy`
**Created**: 2026-10-24
**Last Updated**: 2026-10-27
**Committed to main**: 497eaa01296f7d8df1e3203e5bdd8534e3cc9eb9
**Launched date**: 2026-10-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-24 | `idea` → `draft` | /sdd-story | Product spec generated; operator decisions captured in-session (see context.md) |
| 2026-10-24 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) after one FAIL round; 084 demoted as superseded |
| 2026-10-27 | `spec-ready` → `design-approved` | /sdd-design | Design debated (7 rounds, quick; operator lifted the 5-round cap) and approved; recon.md + design.md written |
| 2026-10-27 | `design-approved` → `code-completed` | implementation session | Implemented from the line-level design.md (no implementation-spec.md); homelab-edge companion changes on its own PR |
| 2026-10-27 | `code-completed` (unchanged) | /sdd-spec | Retroactive implementation spec, 16 steps, all `done`; status not reset to `implementation-ready` (spec D-1) |

| 2026-10-27 | `code-completed` → `launched` | CI workflow | Promoted via PR #1328; committed 497eaa01296f7d8df1e3203e5bdd8534e3cc9eb9 |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (incl. homelab-edge addendum)
- [Design](design.md) — approved design, rejected alternatives, open risks
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — retroactive, 16 steps, all `done`
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Deploy xstockstrat to the homelab VMs (staging and production) through homelab-edge's tailnet and forced-command
app-deploy gate, in parallel with the DigitalOcean deploys, with a digest-pinned Compose stack and a gRPC health
service on the Go services so the gate's health-gated rollback covers every service.

## Reviewers

_Snapshot finalized by /sdd-spec on 2026-10-27 from docs/runbooks/reviewer-registry.md and the
implementation spec's per-step Reviewers. Re-run /sdd-spec if the registry changes._

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture: new deploy target, port exposure (only 3000/9000 published), inter-service dependency graph in the homelab compose file |
| DBA | Migrator ahead/dirty-ahead check runs before the dirty guard and `force 0`; no migration file edited; same behaviour in DO's PRE_DEPLOY migrator |
| Security | Secrets only via GitHub environment secrets / 1Password into a 0600 `.env`; mTLS CA per environment; no secret in compose, logs or the run summary |
| `xstockstrat-trading` owner | Health service registered only after broker/DB/config init; no change to order execution; paper-only staging invariant (`APPLICATION_ENV` ≠ `production`) |
| `xstockstrat-portfolio` owner | Health service + healthcheck mode only; no change to P&L paths |
| `xstockstrat-marketdata` owner | Health service + healthcheck mode only; no change to ingestion |

## Next Action

`/sdd-review homelab-compose-deploy impl-spec` (advisory), then check `merge-order.md` (279 ↔ 271 prose note, non-blocking) and open the final integration PR into `main-dev`; homelab-edge companion PR separately
