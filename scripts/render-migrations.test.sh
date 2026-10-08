#!/usr/bin/env bash
# Structural assertions for scripts/render-migrations.sh (feature 224). No database: renders a
# fixture migrations dir and inspects the output. Exits non-zero on any failed assertion.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RENDER="${REPO_ROOT}/scripts/render-migrations.sh"
fail() {
  echo "ASSERT FAIL: $*" >&2
  exit 1
}

[ -f "$RENDER" ] || fail "scripts/render-migrations.sh missing"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
src="${work}/src"
mkdir -p "$src"

# shellcheck disable=SC2016 # literal SQL fixtures: $1, $$ and ${SEED_USER_ID} must stay unexpanded here
{
  printf -- '-- requires-env: SEED_USER_ID\n'
  printf 'INSERT INTO t (owner) VALUES (%s);\n' "'\${SEED_USER_ID}'"
  printf 'DO $$ BEGIN PERFORM 1; END $$;\n'
  printf 'PREPARE p AS SELECT $1;\n'
} >"${src}/002_needs_seed.up.sql"
printf 'DROP TABLE t;\n' >"${src}/002_needs_seed.down.sql"
# shellcheck disable=SC2016 # literal SQL fixture: ${NOT_RENDERED} must stay unexpanded
printf 'CREATE TABLE plain (id int); -- ${NOT_RENDERED}\n' >"${src}/001_plain.up.sql"
printf 'DROP TABLE plain;\n' >"${src}/001_plain.down.sql"

# (a) a requires-env header with the variable unset exits non-zero, naming the variable
out_a="${work}/out_a"
mkdir -p "$out_a"
if msg="$(env -u SEED_USER_ID bash "$RENDER" "$src" "$out_a" 2>&1)"; then
  fail "(a) expected non-zero exit with SEED_USER_ID unset"
fi
echo "$msg" | grep -q "SEED_USER_ID" || fail "(a) error does not name SEED_USER_ID (got: ${msg})"

# (b) with it set, ${SEED_USER_ID} is rendered; the $$ block and $1 placeholder are untouched
out_b="${work}/out_b"
mkdir -p "$out_b"
SEED_USER_ID="seed-0000" bash "$RENDER" "$src" "$out_b" >/dev/null 2>&1 || fail "(b) render exited non-zero"
grep -q "VALUES ('seed-0000')" "${out_b}/002_needs_seed.up.sql" || fail "(b) SEED_USER_ID not rendered"
grep -qF 'DO $$ BEGIN PERFORM 1; END $$;' "${out_b}/002_needs_seed.up.sql" || fail "(b) \$\$ block altered"
# shellcheck disable=SC2016 # literal $1 placeholder
grep -qF 'SELECT $1;' "${out_b}/002_needs_seed.up.sql" || fail "(b) \$1 placeholder altered"

# (c) a file with no header is copied byte-identical (even if it mentions a ${VAR})
cmp -s "${src}/001_plain.up.sql" "${out_b}/001_plain.up.sql" || fail "(c) header-less file not byte-identical"

# (d) every .down.sql is copied
for f in 001_plain.down.sql 002_needs_seed.down.sql; do
  cmp -s "${src}/${f}" "${out_b}/${f}" || fail "(d) ${f} not copied"
done

# (e) the migrator image ships every script db-migrate.sh invokes (deviation: Step 3 Dockerfile.migrate)
grep -q "COPY scripts/render-migrations.sh" "${REPO_ROOT}/scripts/Dockerfile.migrate" ||
  fail "(e) scripts/Dockerfile.migrate does not COPY render-migrations.sh, which db-migrate.sh calls"

echo "render-migrations.test.sh: all assertions passed"
