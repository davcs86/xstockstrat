# Product Spec: fix-migration-tooling-safety

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md, docs/reports/2026-10-19-config-seed-migration-late-lower-nnn-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10

---

## Problem Statement

### `db-migrate.sh` dirty-state recovery replays non-idempotent up-files (SEV-2)

- **Observed:** when a service's `schema_migrations` row is dirty, `db-migrate.sh up` runs `migrate force 0` then
  `migrate up`, replaying every up-file from `001`. Several applied up-files use bare DDL (e.g. indicators
  `001_formulas.up.sql:3` `CREATE TABLE indicators.formulas (`; indicators 002–006 bare `ADD COLUMN`; ingest 001
  `create_hypertable` without `if_not_exists`; ingest 004, 010), so recovery fails with "relation already exists"
  and a PRE_DEPLOY migrator keeps failing until hand repair. Feature 225 partially mitigated it: the dirty guard
  refuses `force 0` at/above a service's `contract-of` floor. Still exposed: dirty states below the floor and every
  service with no contract file.
- **Expected:** dirty-state recovery brings the service back to a consistent, fully migrated state without manual
  intervention.
- Report: [docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md](../../../reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md)

### A late-merging lower-numbered config seed migration never applies (SEV-3)

- **Observed:** migration numbers reserved ahead in `merge-order.md` can merge out of order; golang-migrate `up`
  applies only versions above the current one, so a lower NNN merged after a higher one is skipped on persistent
  dev/prod DBs (exit 0, "no change") yet passes on a fresh CI DB. Seeded keys go missing and readers silently fall
  back to code defaults. Near-misses: config 024 → 026; marketdata 007 → 009. Applies to every `services/*/migrations`.
- **Expected:** CI fails a PR whose new `services/*/migrations/NNN_*` is not above the current maximum on the target
  branch, or the forward-only rule explicitly forbids pre-reserving numbers.
- Report: [docs/reports/2026-10-19-config-seed-migration-late-lower-nnn-defect.md](../../../reports/2026-10-19-config-seed-migration-late-lower-nnn-defect.md)

## Reproduction Steps

1. Dirty recovery: on a service with no contract file (or dirty below its floor), make a migration fail mid-file;
   re-run `scripts/db-migrate.sh up` → `force 0` + `up` fails on the first non-idempotent `001` statement.
2. Late lower NNN: on a database migrated through N, merge a branch adding migration N-1; run
   `scripts/db-migrate.sh` → N-1 is not applied (no error) and its seeded keys are absent from
   `config.config_values`. (Reproduced with golang-migrate v4.17.1: after 025, adding 024 gives `no change`.)

## Root Cause Hypothesis

- Recovery resets to 0 on the false assumption that all up-files are idempotent; applied files are immutable (F-01),
  so they cannot be fixed in place.
- Planning-time number reservation + forward-only migrator + no CI ordering gate; `docs/patterns/database.md` has no
  forward-only / next-free rule (guidance lives only in `docs/roadmap/ledger/fails.md`).
- Current sites (main-dev 0fecb24d): `scripts/db-migrate.sh:66-81` (`up` branch: `migration-ahead-check.sh`,
  `migration-dirty-guard.sh`, then `force 0` at `:80`); `scripts/migration-dirty-guard.sh` (contract-floor refusal);
  CI `.github/workflows/ci.yml:705` runs the migration script tests but no NNN-ordering check.

## Affected Services

- Platform tooling: `scripts/db-migrate.sh`, `scripts/migration-dirty-guard.sh`, CI (`.github/workflows/ci.yml`),
  `docs/patterns/database.md`
- Migration dirs of xstockstrat-indicators, -ingest, -identity, -config, -portfolio, -analysis (dirty-replay exposure)
  and every `services/*/migrations` dir (ordering gate)

## Fix Scope

- Proto changes anticipated: **no** — tooling and CI only.
- DB migrations anticipated: **no** — applied migrations are immutable (F-01); the fix is in the migrator script and a
  CI gate, not new migration files.
- Config key changes anticipated: **no** — neither report names a config change.

## Open Questions

1. Dirty-recovery policy (report's fix candidates): automatic `force <dirty-1>` then `up`, vs. refusing and
   requiring operator repair (with recovery text) for every service, not only those at/above a contract floor.
2. Ordering policy: a CI gate (new NNN must exceed target-branch max) vs. a written forward-only rule forbidding
   pre-reserved numbers in `merge-order.md` — or both.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix
(Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on dev.

## Out of Scope

- Editing applied up-files to make them idempotent (forbidden by F-01).
- Feature 224's `scripts/migration-rerun.sh` workaround (operator decision 2026-10-07) — unchanged.
- Refactoring unrelated to the bug; performance improvements unrelated to the fix.
