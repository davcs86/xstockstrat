#!/usr/bin/env bash
# Structural assertions for scripts/check-migration-contract.sh (feature 224). Builds a throwaway
# git repo with a fake origin/main ref; no network, no database. Exits non-zero on any failure.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="${REPO_ROOT}/scripts/check-migration-contract.sh"
fail() {
  echo "ASSERT FAIL: $*" >&2
  exit 1
}

[ -f "$CHECK" ] || fail "scripts/check-migration-contract.sh missing"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git_q() { git -C "$work" -c user.email=t@t -c user.name=t -c commit.gpgsign=false "$@" >/dev/null 2>&1; }

git_q init -q -b main
mig="services/xstockstrat-x/migrations"
mkdir -p "${work}/${mig}"
printf 'CREATE TABLE a (id int);\n' >"${work}/${mig}/001_expand.up.sql"
printf 'DROP TABLE a;\n' >"${work}/${mig}/001_expand.down.sql"
git_q add -A
git_q commit -q -m base
git_q update-ref refs/remotes/origin/main HEAD
base="$(git -C "$work" rev-parse HEAD)"

run_check() { (cd "$work" && bash "$CHECK" "$base") >/dev/null 2>&1; }

# (a) a contract file whose expand file is already on origin/main passes
git_q checkout -q -b case-a
printf -- '-- contract-of: %s/001_expand.up.sql\nDROP TABLE a;\n' "$mig" >"${work}/${mig}/002_contract.up.sql"
printf 'SELECT 1;\n' >"${work}/${mig}/002_contract.down.sql"
git_q add -A
git_q commit -q -m a
run_check || fail "(a) contract of an expand file on origin/main should pass"

# (b) a contract file whose expand file is added in the same diff fails
git_q checkout -q main
git_q checkout -q -b case-b
printf 'CREATE TABLE b (id int);\n' >"${work}/${mig}/002_expand_b.up.sql"
printf -- '-- contract-of: %s/002_expand_b.up.sql\nDROP TABLE b;\n' "$mig" >"${work}/${mig}/003_contract_b.up.sql"
git_q add -A
git_q commit -q -m b
run_check && fail "(b) contract of an expand file added in the same diff should fail"

# (c) a contract file naming a missing expand file fails
git_q checkout -q main
git_q checkout -q -b case-c
printf -- '-- contract-of: %s/999_missing.up.sql\nSELECT 1;\n' "$mig" >"${work}/${mig}/002_contract_c.up.sql"
git_q add -A
git_q commit -q -m c
run_check && fail "(c) contract of a missing expand file should fail"

echo "check-migration-contract.test.sh: all assertions passed"
