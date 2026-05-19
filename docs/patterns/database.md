# Database Conventions

**Primary DB**: TimescaleDB (PostgreSQL extension). All services use their own schema.

## Schema & Hypertable Map

| Service | Schema | Hypertable | Partition By |
|---|---|---|---|
| xstockstrat-marketdata | marketdata | ohlcv | time (1 day chunks) |
| xstockstrat-marketdata | marketdata | quotes | time (1 hour chunks) |
| xstockstrat-ledger | ledger | events | time (1 day chunks) |
| xstockstrat-trading | trading | orders | time (1 day chunks) |
| xstockstrat-portfolio | portfolio | snapshots | time (1 day chunks) |
| xstockstrat-ingest | ingest | newsletter_signals | ingested_at (7 day chunks) |

## Migration tooling

Orchestrated by `scripts/db-migrate.sh` using **golang-migrate**. State is tracked in a `schema_migrations` table inside each service's schema so re-runs only apply new files.

**Run order** (dependency-respecting): `config → ledger → identity → marketdata → trading → portfolio → notify → ingest`

On DigitalOcean, the `db-migrator` PRE_DEPLOY job runs automatically on every deploy.

## Adding a new migration

1. Create `services/<service>/migrations/NNN_description.up.sql` — NNN is the next integer after `ls services/<service>/migrations/ | sort | tail -1`.
2. Create matching `NNN_description.down.sql` (rollback SQL, or a stub comment if rollback is not supported).
3. **Never edit an applied `.up.sql`** (committed to `main-dev`) — add a new numbered migration instead.
4. Test locally: `./scripts/db-migrate.sh`

## Approval

DB schema migrations require DBA review + service owner approval (see `docs/runbooks/approval-flow.md`).
