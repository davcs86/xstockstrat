#!/usr/bin/env bash
# scripts/migration-dirty-guard.sh <migrations_dir> <schema> <version_output>
# Exit 0 allows db-migrate.sh's `force 0`; 3 refuses it at/above a contract floor; 2 fails closed.
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

parent="$(dirname "$dir")"
own_dir="$(basename "$(dirname "$parent")")/$(basename "$parent")/$(basename "$dir")"

floor=""
for f in "$dir"/*.up.sql; do
  [ -e "$f" ] || continue
  target="$(head -n 5 "$f" | sed -n 's/^-- contract-of:[[:space:]]*//p' | head -n 1 | tr -d '[:space:]')"
  [ -n "$target" ] || continue
  if [ "$(dirname "$target")" != "$own_dir" ]; then
    echo "db-migrate: contract-of target $target is outside $dir" >&2
    exit 2
  fi
  v="$(basename "$target" | sed 's/^\([0-9]*\)_.*/\1/; s/^0*//')"
  case "$v" in '' | *[!0-9]*)
    echo "db-migrate: cannot parse contract-of target version from: $target" >&2
    exit 2
    ;;
  esac
  if [ -z "$floor" ] || [ "$v" -lt "$floor" ]; then
    floor="$v"
  fi
done

[ -n "$floor" ] || exit 0
[ "$n" -lt "$floor" ] && exit 0

prev=$((n - 1))
# shellcheck disable=SC2016 # $DATABASE_URL is printed as a literal so no credential is ever expanded
{
  echo "db-migrate: $schema is dirty at version $n, at/above contract floor $floor; refusing automatic \`force 0\` (it replays non-idempotent pre-contract up-files — docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md)."
  echo "  Recover: migrate -path services/xstockstrat-$schema/migrations -database \""'$DATABASE_URL'"&x-migrations-table=${schema}_schema_migrations\" force $prev"
  echo "  (use '?x-migrations-table=' when DATABASE_URL has no query string), then re-run scripts/db-migrate.sh up."
  echo "  Use \`migrate force $prev\`, never \`scripts/db-migrate.sh force\` (it forces every service to its highest version)."
} >&2
exit 3
