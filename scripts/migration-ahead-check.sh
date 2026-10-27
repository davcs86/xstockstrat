#!/usr/bin/env bash
# scripts/migration-ahead-check.sh <migrations_dir> <schema> <version_output>
# Exit 0 proceeds; 10 = clean and newer than this image's files (skip); 4 = dirty and newer (refuse); 2 fails closed.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <migrations_dir> <schema> <version_output>" >&2
  exit 1
fi
dir="${1%/}"
schema="$2"

case "$3" in
*dirty*)
  n="$(printf '%s\n' "$3" | sed -n 's/^\([0-9][0-9]*\) (dirty).*/\1/p' | head -n 1)"
  if [ -z "$n" ]; then
    echo "db-migrate: cannot parse dirty version for $schema; refusing" >&2
    exit 2
  fi
  state=dirty
  ;;
*)
  n="$(printf '%s\n' "$3" | sed -n 's/^\([0-9][0-9]*\)$/\1/p' | head -n 1)"
  [ -n "$n" ] || exit 0
  state=clean
  ;;
esac
n="$(printf '%s' "$n" | sed 's/^0*//')"
n="${n:-0}"

highest=0
files=0
for f in "$dir"/*.up.sql; do
  [ -e "$f" ] || continue
  files=$((files + 1))
  v="$(basename "$f" | sed 's/^\([0-9]*\)_.*/\1/; s/^0*//')"
  v="${v:-0}"
  case "$v" in *[!0-9]*)
    echo "db-migrate: cannot parse migration version from: $(basename "$f")" >&2
    exit 2
    ;;
  esac
  if [ "$v" -gt "$highest" ]; then highest="$v"; fi
done
if [ "$files" -eq 0 ]; then
  echo "db-migrate: $schema has no up-files in this image but its database is at version $n; refusing" >&2
  exit 2
fi
[ "$n" -gt "$highest" ] || exit 0

if [ "$state" = clean ]; then
  echo "  [ahead] $schema is at version $n, newer than this image's highest migration $highest; skipping (a newer release applied it)"
  exit 10
fi
prev=$((n - 1))
# shellcheck disable=SC2016 # $DATABASE_URL is printed as a literal so no credential is ever expanded
{
  echo "db-migrate: $schema is dirty at version $n, newer than this image's highest migration $highest; refusing \`force 0\` (a newer release's migration failed part-way; this image cannot see its files)."
  echo "  Recover with the newer release's files: migrate -path services/xstockstrat-$schema/migrations -database \""'$DATABASE_URL'"&x-migrations-table=${schema}_schema_migrations\" force $prev"
  echo "  (use '?x-migrations-table=' when DATABASE_URL has no query string), then fix forward and redeploy that release."
} >&2
exit 4
