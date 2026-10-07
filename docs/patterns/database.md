# Database Conventions

**Primary DB**: TimescaleDB (PostgreSQL extension). All services use their own schema.

## Schema & Hypertable Map

| Service | Schema | Hypertable | Partition By |
|---|---|---|---|
| xstockstrat-marketdata | marketdata | ohlcv | time (30 day chunks; pre-feature-153 chunks stay 1 day — see below) |
| xstockstrat-marketdata | marketdata | quotes | time (1 hour chunks) |
| xstockstrat-ledger | ledger | events | time (1 day chunks) |
| xstockstrat-trading | trading | orders | time (1 day chunks) |
| xstockstrat-portfolio | portfolio | snapshots | time (1 day chunks) |
| xstockstrat-ingest | ingest | newsletter_signals | ingested_at (7 day chunks) |

This map is hypertables only; each service's `CLAUDE.md` § Database is authoritative for plain
tables (e.g. `marketdata.ohlcv_remediation_003`, a one-shot audit table added by feature 080's
`003_canonicalize_ohlcv_timeframe` migration — see `services/xstockstrat-marketdata/CLAUDE.md`).

The `marketdata.ohlcv` chunk interval was widened from 1 day to **30 days** by feature 153's
`004_widen_ohlcv_chunk_interval` migration (`set_chunk_time_interval`, future-only — pre-existing
1-day chunks age out); `services/xstockstrat-marketdata/CLAUDE.md` § Database and
`docs/runbooks/ohlcv-lock-budget-tuning.md` are authoritative for the why (lock-table budget on the
400-day bars scan).

## Migration tooling

Orchestrated by `scripts/db-migrate.sh` using **golang-migrate**. State is tracked in a `schema_migrations` table inside each service's schema so re-runs only apply new files.

**Run order** (dependency-respecting): `config → ledger → identity → marketdata → trading → portfolio → notify → ingest`

On DigitalOcean, the `db-migrator` PRE_DEPLOY job runs automatically on every deploy.

## Adding a new migration

1. Create `services/<service>/migrations/NNN_description.up.sql` — NNN is the next integer after `ls services/<service>/migrations/ | sort | tail -1`.
2. Create matching `NNN_description.down.sql` (rollback SQL, or a stub comment if rollback is not supported).
3. **Never edit an applied `.up.sql`** (committed to `main-dev`) — add a new numbered migration instead.
4. Test locally: `./scripts/db-migrate.sh`

### Migration header directives (feature 224)

Both are read from the **first 5 lines** of an `.up.sql`:

- **`-- requires-env: VAR[,VAR...]`** — `scripts/render-migrations.sh` (called by `db-migrate.sh up`)
  renders the file with `envsubst` restricted to exactly those variables, so `$$` blocks and `$1`
  placeholders survive; each named variable must be set and non-empty or the run fails naming it.
  Files without the header are copied verbatim. A file that embeds a value (e.g. `SEED_USER_ID`)
  should also guard unconditionally against an unrendered `${…}` (see ingest `013`, analysis `026`).
  Any job that runs migrations (the `db-migrator` PRE_DEPLOY job included) must carry those env vars.
- **`-- contract-of: services/<svc>/migrations/<NNN_expand>.up.sql`** — marks a contract migration.
  `scripts/check-migration-contract.sh` refuses it unless the named expand file is already on
  `origin/main` **and** is not added by the same change: ship the expand, deploy, then contract.

**Expand-only up-files must be idempotent** on both the expanded and the contracted schema
(`IF NOT EXISTS`, `to_regclass` guards, one-shot `DO` blocks), because `db-migrate.sh`'s dirty-state
recovery replays from version 0.

**CI jobs** (`.github/workflows/ci.yml`, on `migrations`/`ci` path changes):

- `migration-rerun` — runs `scripts/migration-rerun.sh` in the `scripts/Dockerfile.migrate` image
  against a fresh TimescaleDB: migrates to the pre-224 versions, loads fixtures, applies the rest, then
  re-applies the feature-224 up-files (indicators `007`, ingest `013`, analysis `026`) a second time
  and asserts the N-1 trigger count is unchanged, then runs `scripts/migration-assertions/*.sql`.
  Older up-files are not replayed — many are not idempotent (defect report
  `docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md`).
- `migration-contract-gate` — PR-only; runs `scripts/check-migration-contract.sh` against the base
  branch.

## Connection pooling (PgBouncer)

Staging and production share **one** managed cluster (`xstockstrat`, plan `db-s-1vcpu-1gb`, single
node) — two databases on ~22 usable connections. The per-service pool budget below (§ root
`CLAUDE.md`) sums to 20 *per environment*, sized as if one environment owned the cluster. During a
rolling deploy DigitalOcean runs old + new replicas concurrently, briefly doubling a service's
connections; with both environments deploying at once (the daily promotion) this overruns the shared
limit and Postgres returns `53300 remaining connection slots are reserved…`. A service that connects
without retry (config's `SELECT 1`) then exits non-zero, failing its readiness probe and triggering
an auto-rollback.

To absorb that spike, the six **stateless-query** Go/Python services route through DigitalOcean's
transaction-mode connection pool (PgBouncer) instead of the direct cluster port:

| Route | Port | Services |
|---|---|---|
| **Pooled** (PgBouncer transaction mode) | `:25061`, pool `staging` / `production` (one per database) | trading, portfolio, marketdata (Go) · indicators, ingest, analysis (Python) |
| **Direct** | `:25060` | config, ledger, identity, notify, ui · the `db-migrator` job |

Transaction pooling returns a backend connection to the pool after each transaction, so many idle
client-pool connections multiplex onto a handful of backends — removing the deploy-time spike.

**Why the split (do not pool these):**

- **`LISTEN`/`NOTIFY` is incompatible with transaction pooling.** `config` runs `LISTEN
  config_changed` and `ledger` holds a dedicated `EventNotifier` listener — both need a
  session-pinned connection, so they stay **direct**.
- **golang-migrate needs session-level advisory locks + DDL**, so the `db-migrator` job stays
  **direct**.

**Driver requirements — gated behind the `DB_PGBOUNCER` env var** (set only on the pooled services;
the direct path is unchanged, so production and the Node services are untouched):

| Driver | Requirement when `DB_PGBOUNCER=true` | Where |
|---|---|---|
| pgx (Go) | `cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec` — unnamed statements, safe per-transaction | `services/xstockstrat-{trading,portfolio,marketdata}/internal/repository/pool.go` |
| asyncpg (Python) | `statement_cache_size=0` | `services/xstockstrat-{indicators,ingest,analysis}/app/main.py` |
| node-postgres (Node) | none (no server-side prepared statements by default) | — |

**`DB_POOL_MAX` is not set on the pooled services.** Behind a transaction pool it bounds only the
client→PgBouncer connection count, not backend slots — so it's left at the code default (2, via
`defaultMaxConns` in pgx / the `"2"` fallback in `asyncpg.create_pool`). The backend cap for the six
pooled services is the pool's own `size`, not `DB_POOL_MAX`; raising `DB_POOL_MAX` there is a safe
concurrency knob that does not consume cluster slots. Only the **direct** services (`config`, `ledger`,
`identity`, `notify`, `ui`) still set `DB_POOL_MAX`, and theirs are the real backend-slot budget.

**Both environments are pooled.** Each database has its own transaction-mode pool on the cluster —
`staging` (db `xstockstrat-staging`, wired in `.do/app.dev.yaml`) and `production` (db
`xstockstrat-production`, wired in `.do/app.yaml`) — and both use the `:25061/<pool-name>` URL +
`DB_PGBOUNCER=true` for the same six services. Pool size is small (5) because transaction mode needs
only a few backends per pool and the two pools share the cluster with the direct services; raise it
only after re-checking the ~22-slot cluster budget.

## Approval

DB schema migrations require DBA review + service owner approval (see `docs/runbooks/approval-flow.md`).

