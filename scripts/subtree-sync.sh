#!/usr/bin/env bash
# scripts/subtree-sync.sh
# Push/pull individual service subtrees to/from their remote repos.
#
# Usage:
#   ./scripts/subtree-sync.sh push <service-name>   # monorepo → service repo
#   ./scripts/subtree-sync.sh pull <service-name>   # service repo → monorepo
#   ./scripts/subtree-sync.sh push all              # push all services
#   ./scripts/subtree-sync.sh pull all              # pull all services
#
# Examples:
#   ./scripts/subtree-sync.sh push xstockstrat-config
#   ./scripts/subtree-sync.sh pull xstockstrat-trading
#   ./scripts/subtree-sync.sh push all

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SERVICES=(
  xstockstrat-trading
  xstockstrat-portfolio
  xstockstrat-marketdata
  xstockstrat-indicators
  xstockstrat-ingest
  xstockstrat-analysis
  xstockstrat-ledger
  xstockstrat-identity
  xstockstrat-notify
  xstockstrat-config
  xstockstrat-trader
  xstockstrat-insights
  xstockstrat-config-ui
)

usage() {
  echo "Usage: $0 <push|pull> <service-name|all>"
  echo ""
  echo "Services:"
  for svc in "${SERVICES[@]}"; do
    echo "  $svc"
  done
  exit 1
}

if [[ $# -lt 2 ]]; then
  usage
fi

ACTION="$1"
TARGET="$2"

if [[ "$ACTION" != "push" && "$ACTION" != "pull" ]]; then
  echo "ERROR: action must be 'push' or 'pull', got '$ACTION'"
  usage
fi

do_push() {
  local svc="$1"
  echo "  [push] $svc → monorepo → remote ..."
  git subtree push --prefix="services/$svc" "$svc" main
  echo "  [ok] Pushed $svc"
}

do_pull() {
  local svc="$1"
  echo "  [pull] $svc ← remote → monorepo (squash) ..."
  git subtree pull --prefix="services/$svc" "$svc" main --squash
  echo "  [ok] Pulled $svc"
}

if [[ "$TARGET" == "all" ]]; then
  for svc in "${SERVICES[@]}"; do
    if [[ "$ACTION" == "push" ]]; then
      do_push "$svc"
    else
      do_pull "$svc"
    fi
  done
else
  # Validate service name
  found=false
  for svc in "${SERVICES[@]}"; do
    if [[ "$svc" == "$TARGET" ]]; then
      found=true
      break
    fi
  done

  if [[ "$found" != "true" ]]; then
    echo "ERROR: Unknown service '$TARGET'"
    usage
  fi

  if [[ "$ACTION" == "push" ]]; then
    do_push "$TARGET"
  else
    do_pull "$TARGET"
  fi
fi
