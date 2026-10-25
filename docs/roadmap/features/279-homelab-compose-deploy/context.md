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
  The pipeline therefore runs now, against code already written. The code was pushed as a `wip(279)` commit to the
  session branch (a repository stop hook requires pushed work); no PR is opened until `/sdd-design quick` approves,
  and any design objection lands as a follow-up commit before the PR.
- Operator decisions (asked and answered in-session, 2026-10-24): run in parallel with DO; `main-dev`→staging,
  `main`→production; real `grpc.health.v1` service on the Go services; migrations as a one-shot service per deploy;
  DB host `db.ts.natanddavehouse.com`, db/role `xstockstrat` / `xstockstrat_staging`; mirror DO's PgBouncer split
  with `sslmode=require`; OTel off; homelab-edge gets the staging `tag:ci` grant, a configurable gate wait timeout,
  and runbook updates.
- Added without asking (flag for review): `HOMELAB_DEPLOY_ENABLED` repository-variable gate on both caller jobs, so
  pushes do not go red before the VMs and secrets exist.

## Session 2026-10-24T01:00Z — sdd-review product-spec

- Round 1: FAIL (criterion 9: unchecked rollback/schema question) + warnings. Overlap: `084-droplet-compose-deploy`
  (spec-ready) claimed the same `deploy-dev.yml` path; rebase-only overlaps on portfolio/marketdata `main.go`
  (215, 255, 264) and `docs/patterns/ci-overview.md` (084, 248, 250, 252).
- Operator decisions: rollback restores images not schema → accepted, migrations must be backward-compatible;
  084 → demoted/canceled as superseded by 279 (084's feature.md/status.md/context.md updated).
- Fixes: AC-5 Then made observable; AC-16..AC-20 added (production names, health only after init, production
  reviewers, manual run, ephemeral tag:ci join); AC-6/AC-7 widened to all three Go services; AC-21 split out of AC-7.
- Round 2: PASS WITH WARNINGS. Status: draft → spec-ready.
- Warnings carried to design: homelab Postgres/PgBouncer connection budget unstated (F-06 context); the code predates
  the review (C-11 ordering, recorded in the sdd-story session above).

## Session 2026-10-25T00:00Z — sdd-design quick (in progress)

- Phase 0 Recon: wrote recon.md (6 read-only digests). Defects found in the WIP: D1 `TRADING_MODE` absent from the
  homelab compose (trading broker default `trading.go:2597`, marketdata Alpaca `main.go:107` would run paper in
  production); D2 ui binds to Docker's `HOSTNAME` (proved: next@15.5.27 `dist/build/utils.js:1316`
  `const hostname = process.env.HOSTNAME || '0.0.0.0'`), so `nc -z localhost 3000` never passes.
- Phase 1 round 1: proposer endorsed the WIP + 5 changes; adversary NEEDS WORK, no Floor breach. New defect D3:
  a rollback after a release that applied a migration re-runs the previous migrator, and golang-migrate v4.17.1
  `readUp` → `versionExists(from)` fails when the DB version is newer than the image's files (verified in source),
  so the old stack never starts.
- Verified by the orchestrator: compose `getDependencyCondition` (one-shot counts toward `--wait`) exists from
  v2.17.0 through v5.5.1.
- Operator decisions (2026-10-25):
  - D3 → `scripts/db-migrate.sh` tolerates a DB version newer than its files (not dirty): log and skip that service.
  - Homelab production = **live**, alongside DO prod live; runbook warns never to register one live broker account
    on both stacks (double execution, reconciliation halts).
  - App VMs run the same Docker pins as the edge (engine 29.8.2, compose 5.5.1); runbook records compose ≥ v2.17.0.
- Gate after round 1: operator chose **run another round**.
- Round 2 proposer (2026-10-25): D3 as a pure, offline-testable `scripts/migration-ahead-check.sh <dir> <version>`
  (exit 0 = DB ahead → skip service; digits-only version > highest local `.up.sql`; dirty untouched), called in
  `db-migrate.sh` after the dirty `esac`; real-DB proof added to `scripts/migration-rerun.sh`; CI filter/test wiring.
  D1 `appenv`/`mode` from `case "$TARGET_ENV"`, written after APP_ENV, asserted by a silent `jq -e` over every
  service + ui HOSTNAME. New scenarios proposed: AC-22..AC-26. Two live stacks: runbook only.
  Orchestrator-verified: golang-migrate `Migrate.Version()` reads only the DB driver (`migrate.go:385-396`).
