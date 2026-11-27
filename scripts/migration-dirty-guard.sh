#!/usr/bin/env bash
# scripts/migration-dirty-guard.sh <migrations_dir> <schema> <version_output>
# Never allows a recovery: exit 3 prints the operator's recovery, 2 fails closed (none computable), 1 is usage.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <migrations_dir> <schema> <version_output>" >&2
  exit 1
fi
dir="${1%/}"
schema="$2"

n="$(printf '%s\n' "$3" | sed -n 's/^\([0-9][0-9]*\) (dirty).*/\1/p' | head -n 1)"
if [ -z "$n" ]; then
  echo "db-migrate: cannot parse dirty version from: <$3>" >&2
  exit 2
fi
n=$((10#$n))

prev=""
next=""
lowest=""
file=""
for f in "$dir"/*.up.sql; do
  [ -e "$f" ] || continue
  v="$(basename "$f" | sed 's/^\([0-9]*\)_.*/\1/')"
  case "$v" in '' | *[!0-9]*)
    echo "db-migrate: cannot compute recovery for $schema: cannot parse migration version from: $(basename "$f")" >&2
    exit 2
    ;;
  esac
  v=$((10#$v))
  if [ -z "$lowest" ] || [ "$v" -lt "$lowest" ]; then lowest="$v"; fi
  if [ "$v" -eq "$n" ]; then file="$(basename "$f")"; fi
  if [ "$v" -lt "$n" ] && { [ -z "$prev" ] || [ "$v" -gt "$prev" ]; }; then prev="$v"; fi
  if [ "$v" -gt "$n" ] && { [ -z "$next" ] || [ "$v" -lt "$next" ]; }; then next="$v"; fi
done
if [ -z "$file" ]; then
  echo "db-migrate: cannot compute recovery for $schema dirty at version $n: no up-file for that version in $dir" >&2
  exit 2
fi

mig="services/xstockstrat-$schema/migrations"
# shellcheck disable=SC2016 # $DATABASE_URL is printed as a literal so no credential is ever expanded
{
  echo "db-migrate: $schema is dirty at version $n; refusing to recover it automatically (docs/patterns/database.md § Contract migration recovery)."
  echo "  Read $mig/$file first: a data (DML) statement that already took effect applies twice, without any error, when the file is replayed."
  if [ "$n" -eq "$lowest" ]; then
    echo "  Recover: psql \""'$DATABASE_URL'"\" -c 'TRUNCATE public.${schema}_schema_migrations'"
    echo "  then re-run scripts/db-migrate.sh up (an empty tracking table means no version is applied; up starts at version $n)."
  else
    echo "  Recover: migrate -path $mig -database \""'$DATABASE_URL'"&x-migrations-table=${schema}_schema_migrations\" force $prev"
    echo "  (use '?x-migrations-table=' when DATABASE_URL has no query string), then re-run scripts/db-migrate.sh up."
  fi
  echo "  If that up fails with \"already exists\" in version $n: verify every effect of that file is present, then \`migrate ... force $n\` and re-run up."
  if [ -n "$next" ]; then
    echo "  If it then fails with \"already exists\" in version $next: verify that file the same way, then \`migrate ... force $next\` and re-run up."
  fi
  echo "  Never force forward on doubt: a forced version is skipped for good and nothing reports it. For a contract or prune file verify its effect, not that its objects exist."
  echo "  Use \`migrate force\`, never \`scripts/db-migrate.sh force\` (it forces every service to its highest version)."
} >&2
exit 3
