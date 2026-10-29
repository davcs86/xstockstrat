#!/usr/bin/env bash
# Structural assertions for scripts/migration-ahead-check.sh (feature 279). Builds throwaway
# migrations dirs; no database. Exits non-zero on any failed assertion.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="${REPO_ROOT}/scripts/migration-ahead-check.sh"
fail() {
  echo "ASSERT FAIL: $*" >&2
  exit 1
}

[ -f "$CHECK" ] || fail "scripts/migration-ahead-check.sh missing"

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
  bash "$CHECK" "$2" x "$3" >/dev/null 2>"$err"
  rc=$?
  cat "$err" >>"$all_err"
  [ "$rc" -eq "$1" ] || fail "$4: expected exit $1, got $rc ($(cat "$err"))"
}

d="$(new_dir padded)"
printf 'SELECT 1;\n' >"${d}/008_a.up.sql"
printf 'SELECT 1;\n' >"${d}/009_b.up.sql"
printf 'SELECT 1;\n' >"${d}/009_b.down.sql"
expect 0 "$d" "9" "(a) clean at the image's highest version proceeds"
expect 10 "$d" "10" "(b) clean and newer than the image is skipped (decimal, not octal)"
expect 0 "$d" "8 (dirty)" "(c) dirty within the image's files is left to the dirty guard"
expect 4 "$d" "10 (dirty)" "(d) dirty and newer than the image is refused"
grep -q "force 9" "$err" || fail "(d) recovery text lacks 'force 9'"
grep -q "x is dirty at version 10" "$err" || fail "(d) refusal does not name the schema and version"
expect 2 "$d" "garbage dirty" "(e) an unparsable dirty version fails closed"
expect 0 "$d" "error: no migration" "(f) a fresh database proceeds"

z="$(new_dir zero)"
printf 'SELECT 1;\n' >"${z}/000_x.up.sql"
expect 10 "$z" "1" "(g) only 000 and a database at 1 is skipped"
expect 0 "$z" "0" "(h) only 000 and a database at 0 proceeds"

e="$(new_dir empty)"
expect 2 "$e" "3" "(i) no up-files but a numeric version fails closed"
expect 0 "$e" "error: no migration" "(j) no up-files and a fresh database proceeds"

b="$(new_dir badname)"
printf 'SELECT 1;\n' >"${b}/abc_x.up.sql"
expect 2 "$b" "3" "(k) an unparsable migration filename fails closed"

rc=0
bash "$CHECK" "$d" x >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 1 ] || fail "(l) two arguments: expected exit 1, got $rc"

# (m) no credential ever printed; the recovery text names the literal $DATABASE_URL
if grep -q "postgres://" "$all_err"; then fail "(m) stderr contains a postgres:// URL"; fi
# shellcheck disable=SC2016 # the literal, unexpanded variable name is the assertion
grep -qF '$DATABASE_URL' "$all_err" || fail "(m) stderr lacks the literal \$DATABASE_URL"

echo "migration-ahead-check.test.sh: all assertions passed"
