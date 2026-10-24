# Context: homelab-compose-deploy

**Feature**: `docs/roadmap/features/279-homelab-compose-deploy/feature.md`
**Product Spec**: `docs/roadmap/features/279-homelab-compose-deploy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/279-homelab-compose-deploy/implementation-spec.md`

---

## Session 2026-10-24T00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Order deviation, recorded on purpose:** the code (compose file, workflow, Go health service, homelab-edge
  changes) was written in this session *before* `/sdd-story`. The operator was asked whether the Go health
  endpoint falls under the SDD Commandment and chose "run SDD story + quick design first" rather than waiving it.
  The pipeline therefore runs now, against the uncommitted working tree, and nothing is committed until
  `/sdd-design quick` approves; any design objection is applied to the code before commit.
- Operator decisions (asked and answered in-session, 2026-10-24): run in parallel with DO; `main-dev`→staging,
  `main`→production; real `grpc.health.v1` service on the Go services; migrations as a one-shot service per deploy;
  DB host `db.ts.natanddavehouse.com`, db/role `xstockstrat` / `xstockstrat_staging`; mirror DO's PgBouncer split
  with `sslmode=require`; OTel off; homelab-edge gets the staging `tag:ci` grant, a configurable gate wait timeout,
  and runbook updates.
- Added without asking (flag for review): `HOMELAB_DEPLOY_ENABLED` repository-variable gate on both caller jobs, so
  pushes do not go red before the VMs and secrets exist.
