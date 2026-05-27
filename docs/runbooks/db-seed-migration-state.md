# One-Time: Seed golang-migrate State on Existing Databases

## When to Run This

Run this **once** on any database that was bootstrapped before golang-migrate tracking
was introduced (i.e., migrations were applied via the old `psql -f` approach). It marks
each service's current migration version in the `schema_migrations` table without
re-applying any SQL.

For **fresh databases**, skip this entirely — `./scripts/db-migrate.sh` handles everything.

## Prerequisites

- `migrate` binary installed: `go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest`
- `DATABASE_URL` exported and pointing at the target database
- All schemas already exist (the database was previously bootstrapped)

## Steps

```bash
export DATABASE_URL="postgres://xstockstrat:devpassword@localhost:5432/xstockstrat?sslmode=disable"
REPO_ROOT="$(git rev-parse --show-toplevel)"

force_version() {
  local svc="$1" schema="$2" version="$3"
  local base="${DATABASE_URL%%\?*}"
  local qs="${DATABASE_URL#*\?}"
  [ "$qs" = "$DATABASE_URL" ] && qs=""
  local extra="x-migrations-table=schema_migrations&search_path=${schema}"
  local url="${base}?${[ -n "$qs" ] && echo "${qs}&${extra}" || echo "${extra}"}"
  migrate \
    -path "$REPO_ROOT/services/$svc/migrations" \
    -database "${base}?${extra}" \
    force "$version"
  echo "  ✓ $svc → version $version"
}

echo "Seeding migration versions..."
force_version xstockstrat-config     config     4
force_version xstockstrat-ledger     ledger     1
force_version xstockstrat-identity   identity   2
force_version xstockstrat-marketdata marketdata 1
force_version xstockstrat-trading    trading    3
force_version xstockstrat-portfolio  portfolio  3
force_version xstockstrat-notify     notify     1
force_version xstockstrat-ingest     ingest     2
echo "Done. Run ./scripts/db-migrate.sh version to verify."
```

## Verify

```bash
./scripts/db-migrate.sh version
```

Each service should report its current version with no `dirty` flag.

## After This

Future `./scripts/db-migrate.sh` runs will only apply new migration files — existing
ones are skipped because the version is now tracked.
