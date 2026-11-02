#!/usr/bin/env bash
# Reserves the next feature NNN by advancing the sdd/feature-cursor ref with a non-force push
# (server-side compare-and-swap) and prints it. Never falls back to a local max+1.
# Exit: 1 usage, 2 unparseable cursor tip, 3 cannot reserve (unreachable, push refused, retries spent).
set -euo pipefail

REMOTE="${SDD_CURSOR_REMOTE:-origin}"
CURSOR_REF="${SDD_CURSOR_REF:-sdd/feature-cursor}"
TRUNK="${SDD_CURSOR_TRUNK:-main-dev}"
FEATURES_DIR="${SDD_FEATURES_DIR:-docs/roadmap/features}"
MAX_TRIES="${SDD_CURSOR_MAX_TRIES:-8}"
export LC_ALL=C

die() {
  local rc="$1"
  shift
  echo "sdd-allocate-feature-number: $*" >&2
  exit "$rc"
}

slug="${1:-}"
[[ "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die 1 "usage: $0 <kebab-case-slug>"
cd "$(git rev-parse --show-toplevel)"

# Highest NNN among "NNN-*" names on stdin; 0 when none.
max_nnn() {
  local m
  m="$(sed -nE 's/^([0-9]{3})-.*/\1/p' | sort -n | tail -1)"
  echo $((10#${m:-0}))
}

# Highest NNN under FEATURES_DIR at <treeish>; 0 when the path is absent.
tree_max() {
  git ls-tree --name-only "$1:$FEATURES_DIR" 2>/dev/null | max_nnn || true
}

# Highest NNN on ANY remote branch; used only while no cursor exists (one-time seed).
bootstrap_floor() {
  local best=0 ref v
  git fetch --quiet "$REMOTE" "+refs/heads/*:refs/remotes/${REMOTE}/*" ||
    die 3 "cannot fetch ${REMOTE}; refusing to allocate from local state"
  while IFS= read -r ref; do
    v="$(tree_max "$ref")"
    if [ "$v" -gt "$best" ]; then best="$v"; fi
  done < <(git for-each-ref --format='%(refname)' "refs/remotes/${REMOTE}")
  echo "$best"
}

if [ -z "$(git config user.name || true)" ]; then
  export GIT_AUTHOR_NAME=sdd-allocator GIT_COMMITTER_NAME=sdd-allocator
fi
if [ -z "$(git config user.email || true)" ]; then
  export GIT_AUTHOR_EMAIL=sdd-allocator@localhost GIT_COMMITTER_EMAIL=sdd-allocator@localhost
fi

empty_tree="$(git hash-object -t tree /dev/null)"
cursor_re='^sdd-cursor: ([0-9]{3,}) '
tries=0
while [ "$tries" -lt "$MAX_TRIES" ]; do
  tries=$((tries + 1))

  listing="$(git ls-remote "$REMOTE" "refs/heads/${CURSOR_REF}")" ||
    die 3 "cannot reach ${REMOTE}; refusing to allocate from local state"

  tip=""
  if [ -n "$listing" ]; then
    git fetch --quiet "$REMOTE" "refs/heads/${CURSOR_REF}" || die 3 "cannot fetch ${REMOTE}/${CURSOR_REF}"
    tip="$(git rev-parse FETCH_HEAD)"
    subject="$(git log -1 --format=%s "$tip")"
    [[ "$subject" =~ $cursor_re ]] || die 2 "cursor tip ${tip} has an unparseable message: ${subject}"
    floor=$((10#${BASH_REMATCH[1]}))
    git fetch --quiet "$REMOTE" "$TRUNK" || die 3 "cannot fetch ${REMOTE}/${TRUNK}"
    v="$(tree_max FETCH_HEAD)"
  else
    floor=0
    v="$(bootstrap_floor)"
  fi
  if [ "$v" -gt "$floor" ]; then floor="$v"; fi
  v="$( (cd "$FEATURES_DIR" 2>/dev/null && printf '%s\n' [0-9][0-9][0-9]-*) | max_nnn || true)"
  if [ "$v" -gt "$floor" ]; then floor="$v"; fi

  nnn="$(printf '%03d' $((floor + 1)))"
  msg="sdd-cursor: ${nnn} ${slug}"
  if [ -n "$tip" ]; then
    commit="$(git commit-tree "$empty_tree" -p "$tip" -m "$msg")"
  else
    commit="$(git commit-tree "$empty_tree" -m "$msg")"
  fi

  if out="$(git push "$REMOTE" "${commit}:refs/heads/${CURSOR_REF}" 2>&1)"; then
    echo "$nnn"
    exit 0
  fi
  case "$out" in
  *"[rejected]"*"fetch first"* | *"[rejected]"*"non-fast-forward"* | *"cannot lock ref"* | *"failed to update ref"* | *"incorrect old value"*)
    sleep "0.$(printf '%02d' $((RANDOM % 50)))"
    ;;
  *)
    die 3 "push to ${REMOTE}/${CURSOR_REF} refused; not allocating: $(echo "$out" | tail -n 5)"
    ;;
  esac
done
die 3 "lost the cursor race ${MAX_TRIES} times; re-run"
