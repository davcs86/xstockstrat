#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2016 # `A && B || fail` is the assertion idiom (fail always exits); literal $ is matched text
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1
fail() {
  echo "ASSERT FAIL: $*" >&2
  exit 1
}
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
w="$(mktemp -d)"
trap 'rm -rf "$w"' EXIT
git_q() { git -C "$w" -c user.email=t@t -c user.name=t -c commit.gpgsign=false "$@"; }

check_fixture() {
  local m s
  git_q init -q -b main
  git_q commit -q --allow-empty -m base
  git_q checkout -q -b main-dev
  printf 'd\n' >"$w/d" && git_q add d && git_q commit -q -m D
  git_q checkout -q main
  git_q merge -q --no-ff --no-edit main-dev
  m="$(git_q rev-parse HEAD)"
  git_q checkout -q main-dev
  git_q merge -q --no-ff --no-edit main
  [ "$(git_q rev-parse HEAD)" != "$m" ] && [ "$(git_q rev-parse HEAD^2)" = "$m" ] || fail "AC-18: main-dev's tip must be a new merge commit whose second parent is M"
  git_q diff --quiet "$m" HEAD || fail "AC-18: the sync merge changed content"
  git_q diff --quiet main...main-dev || fail "AC-19: a sync-only main-dev must have nothing to promote"
  git_q checkout -q main
  printf 's\n' >"$w/s" && git_q add s && git_q commit -q -m S
  s="$(git_q rev-parse HEAD)"
  git_q checkout -q main-dev
  git_q merge -q --no-ff --no-edit main
  git_q merge-base --is-ancestor "$m" HEAD && git_q merge-base --is-ancestor "$s" HEAD || fail "AC-20: main-dev must contain M and S"
  git_q diff --quiet main...main-dev || fail "AC-19: the second sync must leave nothing to promote"
  printf 'r\n' >"$w/r" && git_q add r && git_q commit -q -m R
  ! git_q diff --quiet main...main-dev || fail "AC-19: a real change must be promotable"
  echo "fixture: ok"
}

# check_backmerge_no_ff: every back-merge of main into main-dev must be --no-ff (SD-1: only the sync
# workflow must hold one; the doc sites may hold none, but any they hold must carry --no-ff).
check_backmerge_no_ff() {
  local f req hits line re='git merge([[:space:]]+-[^[:space:]]+)*[[:space:]]+(origin/)?main([^-[:alnum:]_/]|$)'
  for f in .github/workflows/sync-main-to-maindev.yml .github/PULL_REQUEST_TEMPLATE/hotfix.md \
    docs/runbooks/feature-workflow.md docs/runbooks/bug-triage.md \
    .claude/skills/sdd-triage/reference/backmerge.md .claude/skills/promote/SKILL.md; do
    [ -f "$f" ] || fail "no-ff: $f is missing"
    req=0
    [ "$f" = .github/workflows/sync-main-to-maindev.yml ] && req=1
    hits="$(grep -nE "$re" "$f" || true)"
    [ "$req" = 0 ] || [ -n "$hits" ] || fail "no-ff: $f must hold the back-merge command"
    while IFS= read -r line; do
      [ -z "$line" ] || grep -qF -- '--no-ff' <<<"$line" || fail "no-ff: $f:${line%%:*} back-merges main without --no-ff"
    done <<<"$hits"
  done
  echo "no-ff: ok"
}

check_static() {
  local sync=.github/workflows/sync-main-to-maindev.yml p=.github/workflows/promote.yml gate cl
  command -v yq >/dev/null && yq --version 2>/dev/null | grep -q mikefarah || fail "yq must be mikefarah yq v4 (brew install yq)"
  [ "$(yq e '.concurrency.group' "$sync")" = sync-main-to-maindev ] &&
    [ "$(yq e '.concurrency."cancel-in-progress"' "$sync")" = false ] ||
    fail "static: $sync needs workflow concurrency group sync-main-to-maindev with cancel-in-progress: false"
  grep -qF 'git diff --quiet origin/main...origin/main-dev' "$p" || fail "static: $p needs the three-dot content gate"
  ! grep -qF 'AHEAD=$(git log' "$p" || fail "static: $p still counts commits ahead (two-dot gate)"
  gate="$(yq e '.jobs.promote.steps | to_entries | map(select(.value.run // "" | contains("git diff --quiet origin/main...origin/main-dev"))) | .[0].key' "$p")"
  cl="$(yq e '.jobs.promote.steps | to_entries | map(select(.value.name == "Commit and push changelog")) | .[0].key' "$p")"
  [ "$gate" != null ] && [ "$cl" != null ] && [ "$gate" -lt "$cl" ] || fail "static: the promote gate must run before Commit and push changelog"
  grep -qF 'git diff --quiet origin/main...origin/main-dev' .claude/skills/promote/SKILL.md || fail "static: promote/SKILL.md needs the three-dot content gate"
  echo "static: ok"
}

check_backmerge_no_ff
check_static
check_fixture
echo "backmerge-no-ff.test.sh: all assertions passed"
