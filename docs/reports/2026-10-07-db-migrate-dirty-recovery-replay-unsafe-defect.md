# Defect: `db-migrate.sh` dirty-state recovery replays non-idempotent up-files

**Recorded**: 2026-10-07
**Severity**: SEV-2
**Impact type**: deploy-recovery-failure
**Environment**: all (dev, prod PRE_DEPLOY migrator, docker-compose `db-migrator`)
**Affected service(s)**: platform tooling (`scripts/db-migrate.sh`); migrations of xstockstrat-indicators, -ingest, -identity, -config, -portfolio, -analysis
**Config-only fix possible**: no
**Found by**: feature 224 Step 33 (migration-rerun CI design), 2026-10-07

## Observed

When a service's `schema_migrations` row is `dirty` (a previous migrate run failed mid-file),
`scripts/db-migrate.sh up` runs `migrate force 0` and then `migrate up`, which replays every
up-file from `001`. The comment above that branch says "All migrations use IF NOT EXISTS /
if_not_exists => TRUE so re-running is safe."

That is false. Several applied up-files use bare DDL that fails on an already-migrated schema.
Confirmed examples:

- `services/xstockstrat-indicators/migrations/001_formulas.up.sql:3` — `CREATE TABLE indicators.formulas (` (no `IF NOT EXISTS`); `:15-16` unnamed `CREATE INDEX ON …`
- `services/xstockstrat-indicators/migrations/002`–`006` — `ADD COLUMN` without `IF NOT EXISTS`
- `services/xstockstrat-ingest/migrations/001_newsletter_signals.up.sql:8` — `CREATE TABLE ingest.newsletter_signals (`; `:23` `create_hypertable` without `if_not_exists`
- `services/xstockstrat-ingest/migrations/004_add_backfill_chunks.up.sql:6` — bare `CREATE TABLE`
- `services/xstockstrat-ingest/migrations/010_add_signal_source_reliability_weight.up.sql:2` — bare `ADD COLUMN`

Candidates the same heuristic flags (bare DDL lines). These still need checking, because the DDL
may be guarded inside a `DO` block:

- `xstockstrat-identity/migrations/006_user_metadata.up.sql`
- `xstockstrat-config/migrations/017_config_secrets_and_scoping.up.sql`
- `xstockstrat-portfolio/migrations/011_watchlist_system_managed_source.up.sql`
- `xstockstrat-portfolio/migrations/016_account_balance_peak_equity.up.sql`
- `xstockstrat-analysis/migrations/020_job_schedule.up.sql`

## Expected

Dirty-state recovery brings the service back to a consistent, fully migrated state without
manual intervention.

## Impact

- **In production:** if a deploy's PRE_DEPLOY migration fails partway through a file, the next
  run's automatic recovery fails on the first non-idempotent `001` statement ("relation already
  exists"). The migrator job keeps failing, and the deploy is blocked until someone repairs it
  by hand (`migrate force <last good>`).
- **Latent:** nothing has triggered it yet. It is exposed whenever any migration fails mid-file.

## Constraints

- Applied migrations are immutable (Constitution **F-01**), so the old up-files cannot be made
  idempotent in place.
- Fix candidates for `/sdd-triage` (Track C):
  1. Change `db-migrate.sh` recovery to `force <last clean version>` (the version before the
     dirty one) instead of `force 0`. golang-migrate records the failed version as dirty, so
     `version-1` is the last fully applied file.
  2. Or require the operator to repair manually, and correct the false comment.
- Either way, correct the comment in `db-migrate.sh`.

## Workaround in place

Feature 224's `scripts/migration-rerun.sh` no longer replays the whole chain from `0`. It
re-applies only the feature-224 up-files (indicators 007, ingest 013, analysis 026) a second
time to prove they are idempotent (operator decision, 2026-10-07).
