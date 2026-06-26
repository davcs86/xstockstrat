#!/usr/bin/env bash
# scripts/check-context-map.sh
# Validate the AI-tooling context map and its cross-references.
#
#   1. Every concrete file path listed in .claude/context-map.yaml must exist.
#   2. Every docs/*.md or .claude/**/*.md reference inside the CLAUDE.md files
#      and the skill routers/reference files must resolve (catches stale
#      "read X for task Y" pointers).
#
# Placeholder paths (containing <...>, ..., path/to, exact/, or *) are skipped.
# macOS bash 3.2 + BSD/GNU compatible (grep -oE only; no GNU-only flags).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MAP=".claude/context-map.yaml"
if [ ! -f "$MAP" ]; then
  echo "MISSING: $MAP"
  exit 1
fi

REFS="$(mktemp)"
SRCS="$(mktemp)"
trap 'rm -f "$REFS" "$SRCS"' EXIT

# (1) Concrete paths declared in the context map.
grep -oE '(\.claude|docs|scripts)/[A-Za-z0-9._/<>-]+\.(md|ya?ml|sh)' "$MAP" >>"$REFS"

# (2) doc/skill references embedded in CLAUDE.md files and skill routers.
find . -name CLAUDE.md -not -path '*/node_modules/*' >>"$SRCS"
find .claude/skills -name SKILL.md >>"$SRCS"
find .claude/skills -path '*/reference/*.md' >>"$SRCS"

while IFS= read -r f; do
  # Strip URLs first so paths embedded in links (e.g. github.com/.../docs/x.md)
  # are not mistaken for repo-relative references.
  sed -E 's#https?://[^[:space:])]*##g' "$f" |
    grep -oE '(\.claude|docs)/[A-Za-z0-9._/-]+\.md' >>"$REFS" || true
done <"$SRCS"

sort -u "$REFS" -o "$REFS"

is_placeholder() {
  case "$1" in
  *"<"* | *"..."* | *"path/to"* | *"exact/"* | *"*"*) return 0 ;;
  *) return 1 ;;
  esac
}

fail=0
while IFS= read -r p; do
  [ -n "$p" ] || continue
  if is_placeholder "$p"; then
    continue
  fi
  if [ ! -e "$p" ]; then
    echo "  MISSING: $p"
    fail=1
  fi
done <"$REFS"

if [ "$fail" -eq 0 ]; then
  echo "OK - all context-map and doc references resolve."
else
  echo "FAILED - fix the MISSING references above (or mark them as placeholders)."
fi
exit "$fail"
