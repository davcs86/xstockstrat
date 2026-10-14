#!/usr/bin/env bash
# Structural assertions for scripts/migration-dirty-guard.sh (feature 225). Builds throwaway
# migrations dirs; no database. Exits non-zero on any failed assertion.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="${REPO_ROOT}/scripts/migration-dirty-guard.sh"
fail() {
  echo "ASSERT FAIL: $*" >&2
  exit 1
}

[ -x "$GUARD" ] || fail "scripts/migration-dirty-guard.sh missing or not executable"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
err="${work}/stderr"
all_err="${work}/all-stderr"
: >"$all_err"

# new_dir <case>: an empty services/xstockstrat-x/migrations tree for one case
new_dir() {
  d="${work}/$1/services/xstockstrat-x/migrations"
  mkdir -p "$d"
  echo "$d"
}

# expect <exit> <dir> <version_output> <label>
expect() {
  bash "$GUARD" "$2" x "$3" 2>"$err"
  rc=$?
  cat "$err" >>"$all_err"
  [ "$rc" -eq "$1" ] || fail "$4: expected exit $1, got $rc ($(cat "$err"))"
}

contract_line() { printf -- '-- contract-of: services/xstockstrat-%s/migrations/%s\n' "$1" "$2"; }

# (a) no contract file -> the legacy force 0 path is allowed
da="$(new_dir a)"
printf 'SELECT 1;\n' >"${da}/027_plain.up.sql"
expect 0 "$da" "27 (dirty)" "(a) no contract file"

# (b)-(d) one contract 027 -> 026: floor 26
db="$(new_dir b)"
printf 'CREATE TABLE y (id int);\n' >"${db}/026_y.up.sql"
{
  contract_line x 026_y.up.sql
  printf 'DROP TABLE y;\n'
} >"${db}/027_x.up.sql"
expect 3 "$db" "27 (dirty)" "(b) dirty at the contract version"
grep -q "force 26" "$err" || fail "(b) stderr lacks 'force 26'"
grep -q "x is dirty at version 27" "$err" || fail "(b) stderr lacks the schema name"

# (c) dirty at the expand version (a refused down)
expect 3 "$db" "26 (dirty)" "(c) dirty at the expand version"
grep -q "force 25" "$err" || fail "(c) stderr lacks 'force 25'"

# (d) below the floor -> allowed (the "20 (dirty)" half is AC-19)
expect 0 "$db" "25 (dirty)" "(d) dirty below the floor"
expect 0 "$db" "20 (dirty)" "(d) dirty well below the floor"

# (e) unparseable version output fails closed
expect 2 "$db" "garbage dirty" "(e) unparseable version output"

# (f) a contract-of header on line 6 is ignored (5-line rule)
df="$(new_dir f)"
{
  printf -- '-- 1\n-- 2\n-- 3\n-- 4\n-- 5\n'
  contract_line x 026_y.up.sql
} >"${df}/027_x.up.sql"
expect 0 "$df" "27 (dirty)" "(f) header past line 5"

# (h) two contract files -> the lowest target is the floor
dh="$(new_dir h)"
contract_line x 013_a.up.sql >"${dh}/014_c.up.sql"
contract_line x 020_b.up.sql >"${dh}/021_d.up.sql"
expect 3 "$dh" "13 (dirty)" "(h) dirty at the lowest floor"
expect 0 "$dh" "12 (dirty)" "(h) dirty below the lowest floor"

# (i) a contract-of target in another service's directory fails closed
di="$(new_dir i)"
contract_line other 026_y.up.sql >"${di}/027_x.up.sql"
expect 2 "$di" "27 (dirty)" "(i) target outside the migrations dir"

# (g) no credential ever printed; the recovery text names the literal $DATABASE_URL
if grep -q "postgres://" "$all_err"; then fail "(g) stderr contains a postgres:// URL"; fi
# shellcheck disable=SC2016 # the literal, unexpanded variable name is the assertion
grep -qF '$DATABASE_URL' "$all_err" || fail "(g) stderr lacks the literal \$DATABASE_URL"

echo "migration-dirty-guard.test.sh: all assertions passed"
