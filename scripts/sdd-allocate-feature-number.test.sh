#!/usr/bin/env bash
# Behavioural assertions for scripts/sdd-allocate-feature-number.sh. Uses a local bare repo as
# `origin`; no network. Exits non-zero on any failed assertion.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALLOC="${REPO_ROOT}/scripts/sdd-allocate-feature-number.sh"
fail() {
  echo "ASSERT FAIL: $*" >&2
  exit 1
}

[ -f "$ALLOC" ] || fail "scripts/sdd-allocate-feature-number.sh missing"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
FEATURES=docs/roadmap/features
CURSOR=sdd/feature-cursor
origin="${work}/origin.git"

git init -q --bare "$origin"
git -C "$origin" symbolic-ref HEAD refs/heads/main-dev

# add_dirs <clone> <NNN-slug>...: commit feature dirs on the clone's current branch
add_dirs() {
  c="$1"
  shift
  for d in "$@"; do
    mkdir -p "${c}/${FEATURES}/${d}"
    : >"${c}/${FEATURES}/${d}/status.md"
  done
  git -C "$c" add -A
  git -C "$c" commit -q -m "add $*"
}

# clone_of <name>: a fresh clone of origin on main-dev
clone_of() {
  git clone -q "$origin" "${work}/$1" 2>/dev/null
  echo "${work}/$1"
}

# alloc <clone> <slug>: run the allocator inside a clone; stdout = number, rc kept in $rc
alloc() {
  out="$(cd "$1" && bash "$ALLOC" "$2" 2>"${work}/err")"
  rc=$?
}

cursor_subject() { git -C "$origin" log -1 --format=%s "refs/heads/${CURSOR}" 2>/dev/null; }
cursor_tip() { git -C "$origin" rev-parse -q --verify "refs/heads/${CURSOR}" 2>/dev/null; }

seed="${work}/seed"
git init -q "$seed"
git -C "$seed" checkout -q -b main-dev
add_dirs "$seed" 001-a 002-b 003-c
git -C "$seed" remote add origin "$origin"
git -C "$seed" push -q origin main-dev 2>/dev/null
git -C "$seed" checkout -q -b feature/x
add_dirs "$seed" 007-unmerged-sibling
git -C "$seed" push -q origin feature/x 2>/dev/null
git -C "$seed" checkout -q main-dev

c1="$(clone_of c1)"

# (a) bootstrap: no cursor yet; the floor is the highest NNN on ANY origin branch (007, unmerged)
alloc "$c1" alpha
[ "$rc" -eq 0 ] || fail "(a) bootstrap rc=$rc ($(cat "${work}/err"))"
[ "$out" = "008" ] || fail "(a) expected 008, got '$out'"
[ "$(cursor_subject)" = "sdd-cursor: 008 alpha" ] || fail "(a) cursor subject: '$(cursor_subject)'"

# (b) next allocation, from a different clone, advances the same cursor
c2="$(clone_of c2)"
alloc "$c2" beta
{ [ "$rc" -eq 0 ] && [ "$out" = "009" ]; } || fail "(b) expected 009, got rc=$rc '$out'"
[ "$(git -C "$origin" rev-list --count "refs/heads/${CURSOR}")" -eq 2 ] || fail "(b) cursor should hold exactly 2 commits"

# (c) trunk floor wins over a lower cursor (a number claimed on main-dev outside the cursor)
add_dirs "$seed" 020-manual
git -C "$seed" push -q origin main-dev 2>/dev/null
alloc "$c1" gamma
{ [ "$rc" -eq 0 ] && [ "$out" = "021" ]; } || fail "(c) expected 021, got rc=$rc '$out'"

# (d) local-tree floor wins too (an uncommitted sibling directory in this checkout)
mkdir -p "${c1}/${FEATURES}/030-local-only"
alloc "$c1" delta
{ [ "$rc" -eq 0 ] && [ "$out" = "031" ]; } || fail "(d) expected 031, got rc=$rc '$out'"

# (e) concurrency: 5 clones allocate simultaneously -> 5 distinct consecutive numbers
for i in 1 2 3 4 5; do clone_of "p$i" >/dev/null; done
for i in 1 2 3 4 5; do
  (
    cd "${work}/p$i" && bash "$ALLOC" "par-$i" >"${work}/par-$i.out" 2>"${work}/par-$i.err"
    echo $? >"${work}/par-$i.rc"
  ) &
done
wait
for i in 1 2 3 4 5; do
  [ "$(cat "${work}/par-$i.rc")" = "0" ] || fail "(e) allocator $i failed: $(cat "${work}/par-$i.err")"
done
nums="$(cat "${work}"/par-?.out | sort)"
[ "$(echo "$nums" | uniq | wc -l | tr -d ' ')" = "5" ] || fail "(e) duplicate numbers: $nums"
{ [ "$(echo "$nums" | head -1)" = "032" ] && [ "$(echo "$nums" | tail -1)" = "036" ]; } || fail "(e) not consecutive 032..036: $nums"

# (f) usage: a non-kebab slug is rejected before touching origin
before="$(cursor_tip)"
alloc "$c1" "Bad Slug"
[ "$rc" -eq 1 ] || fail "(f) bad slug should exit 1, got $rc"
[ "$(cursor_tip)" = "$before" ] || fail "(f) cursor moved on a usage error"

# (g) unreachable remote fails closed: exit 3, no number, no local max+1 fallback
out="$(cd "$c1" && SDD_CURSOR_REMOTE=nonexistent-remote bash "$ALLOC" eps 2>"${work}/err")"
rc=$?
{ [ "$rc" -eq 3 ] && [ -z "$out" ]; } || fail "(g) unreachable should exit 3 with no number, got rc=$rc '$out'"

# (h) push refused by the server (non-race rejection) fails closed: exit 3, cursor unchanged
mkdir -p "${origin}/hooks"
# shellcheck disable=SC2016 # hook body must reach the file unexpanded
printf '#!/bin/sh\nwhile read old new ref; do case "$ref" in refs/heads/sdd/*) echo denied >&2; exit 1;; esac; done\n' >"${origin}/hooks/pre-receive"
chmod +x "${origin}/hooks/pre-receive"
before="$(cursor_tip)"
alloc "$c1" zeta
{ [ "$rc" -eq 3 ] && [ -z "$out" ]; } || fail "(h) denied push should exit 3 with no number, got rc=$rc '$out'"
[ "$(cursor_tip)" = "$before" ] || fail "(h) cursor moved despite a refused push"
rm -f "${origin}/hooks/pre-receive"

# (i) an unparseable cursor tip fails closed: exit 2, cursor unchanged
junk="$(git -C "$origin" commit-tree "$(git hash-object -t tree /dev/null)" -p "$(cursor_tip)" -m "hello")"
git -C "$origin" update-ref "refs/heads/${CURSOR}" "$junk"
alloc "$c1" eta
{ [ "$rc" -eq 2 ] && [ -z "$out" ]; } || fail "(i) unparseable tip should exit 2 with no number, got rc=$rc '$out'"
[ "$(cursor_tip)" = "$junk" ] || fail "(i) cursor moved on an unparseable tip"

echo "sdd-allocate-feature-number.test.sh: all assertions passed"
