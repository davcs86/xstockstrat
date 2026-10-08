#!/usr/bin/env bash
# scripts/check-migration-contract.sh <base_ref>
# For every migration *.up.sql added since <base_ref> that declares `-- contract-of: <path>`, the
# named expand migration must already be on origin/main and must not be added by this same diff.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <base_ref>" >&2
  exit 2
fi
base="$1"

added="$(git diff --name-only --diff-filter=A "${base}...HEAD" -- 'services/*/migrations/*.up.sql')"
status=0
for f in $added; do
  target="$(head -n 5 "$f" | sed -n 's/^-- contract-of:[[:space:]]*//p' | head -n 1 | tr -d '[:space:]')"
  [ -n "$target" ] || continue
  if echo "$added" | grep -qxF "$target"; then
    echo "contract-gate: $f contracts $target, which is added in this same change (ship the expand first)" >&2
    status=1
  elif ! git cat-file -e "origin/main:${target}" 2>/dev/null; then
    echo "contract-gate: $f contracts $target, which is not on origin/main" >&2
    status=1
  else
    echo "contract-gate: ok — $f contracts $target (on origin/main)"
  fi
done
exit "$status"
