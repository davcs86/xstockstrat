#!/usr/bin/env bash
# scripts/check-watcher-copies.sh [ROOT]
# Fail when the per-service copies of a config watcher core or live-limits module differ
# (feature 295). Each group's files must be byte-identical; the exemption is recorded in
# docs/patterns/dry-guard-rail.md.
# macOS bash 3.2 compatible (no associative arrays, no mapfile).

set -euo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ROOT="${ROOT%/}"

# group<TAB>path — one line per copy.
COPIES="go	services/xstockstrat-trading/internal/config/watchcore.go
go	services/xstockstrat-portfolio/internal/config/watchcore.go
go	services/xstockstrat-marketdata/internal/config/watchcore.go
py	services/xstockstrat-indicators/app/config/watch_core.py
py	services/xstockstrat-ingest/app/config/watch_core.py
py	services/xstockstrat-analysis/app/config/watch_core.py
py	services/xstockstrat-agent/app/config/watch_core.py
py-limits	services/xstockstrat-indicators/app/config/live_limits.py
py-limits	services/xstockstrat-ingest/app/config/live_limits.py
py-limits	services/xstockstrat-analysis/app/config/live_limits.py
node	services/xstockstrat-ledger/src/services/configWatcher.ts
node	services/xstockstrat-identity/src/services/configWatcher.ts
node	services/xstockstrat-notify/src/services/configWatcher.ts"

fail=0
groups="$(printf '%s\n' "$COPIES" | cut -f1 | sort -u)"
for g in $groups; do
  ref=""
  ref_path=""
  while IFS=$'\t' read -r grp path; do
    [ "$grp" = "$g" ] || continue
    if [ ! -f "${ROOT}/${path}" ]; then
      echo "check-watcher-copies: group ${g}: missing ${path}" >&2
      fail=1
      continue
    fi
    sum="$(shasum -a 256 "${ROOT}/${path}" | cut -d' ' -f1)"
    if [ -z "$ref" ]; then
      ref="$sum"
      ref_path="$path"
    elif [ "$sum" != "$ref" ]; then
      echo "check-watcher-copies: group ${g}: ${path} differs from ${ref_path}" >&2
      fail=1
    fi
  done <<EOF
$COPIES
EOF
done

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "check-watcher-copies: all groups byte-identical"
