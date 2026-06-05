#!/usr/bin/env sh
# wait-for-deps.sh — probe TCP endpoints before starting a service.
#
# Usage:
#   wait-for-deps.sh HOST:PORT [HOST:PORT ...] [-- COMMAND [ARGS...]]
#   WAIT_FOR="HOST:PORT HOST:PORT" wait-for-deps.sh [-- COMMAND [ARGS...]]
#
# Env vars:
#   WAIT_FOR      Space-separated HOST:PORT list (alternative to positional args).
#                 Positional HOST:PORT args take precedence if provided.
#   WAIT_TIMEOUT  Seconds before giving up per endpoint (default: 150).
#   WAIT_INTERVAL Seconds between retry attempts (default: 15).
#
# Examples:
#   ./scripts/wait-for-deps.sh xstockstrat-config:50060
#   ./scripts/wait-for-deps.sh localhost:50060 localhost:50057 -- echo "all up"
#   WAIT_FOR="localhost:50060 localhost:50057" ./scripts/wait-for-deps.sh
set -e

TIMEOUT=${WAIT_TIMEOUT:-150}
INTERVAL=${WAIT_INTERVAL:-15}
WAIT_ARGS=""

# Parse positional HOST:PORT args; stop at -- and leave remaining as CMD
while [ $# -gt 0 ]; do
  case "$1" in
  --)
    shift
    break
    ;;
  *:*)
    WAIT_ARGS="${WAIT_ARGS} $1"
    shift
    ;;
  *)
    printf 'Usage: %s HOST:PORT [HOST:PORT ...] [-- COMMAND [ARGS...]]\n' "$0" >&2
    exit 1
    ;;
  esac
done

# Fall back to WAIT_FOR env var when no positional HOST:PORT args given
if [ -z "$WAIT_ARGS" ] && [ -n "${WAIT_FOR:-}" ]; then
  WAIT_ARGS="$WAIT_FOR"
fi

if [ -z "$WAIT_ARGS" ]; then
  printf 'Usage: %s HOST:PORT [HOST:PORT ...] [-- COMMAND [ARGS...]]\n' "$0" >&2
  printf 'Or set WAIT_FOR="HOST:PORT HOST:PORT ..."\n' >&2
  exit 1
fi

probe() {
  local host="$1" port="$2"
  if command -v nc >/dev/null 2>&1; then
    # nc -z: zero-I/O mode — just check TCP connectivity, no data exchange
    # Works on: Alpine busybox nc, GNU netcat, macOS BSD nc
    nc -z "$host" "$port" >/dev/null 2>&1
  else
    # bash built-in /dev/tcp — no external tools needed (bash 3.2+)
    # Used on: python:3.12-slim (Debian) where nc is not installed by default
    bash -c "echo >/dev/tcp/$host/$port" >/dev/null 2>&1
  fi
}

wait_for() {
  local addr="$1"
  local host="${addr%:*}"
  local port="${addr##*:}"
  local elapsed=0

  printf '[wait-for-deps] Waiting for %s...\n' "$addr"
  until probe "$host" "$port"; do
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
      printf '[wait-for-deps] ERROR: timed out after %ss waiting for %s\n' "$TIMEOUT" "$addr" >&2
      exit 1
    fi
    sleep "$INTERVAL"
    elapsed=$((elapsed + INTERVAL))
  done
  printf '[wait-for-deps] %s is ready (%ss elapsed)\n' "$addr" "$elapsed"
}

# Word-split is intentional here — WAIT_ARGS is a space-separated list
# shellcheck disable=SC2086
for addr in $WAIT_ARGS; do
  wait_for "$addr"
done

if [ $# -gt 0 ]; then
  exec "$@"
fi
