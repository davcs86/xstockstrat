#!/usr/bin/env sh
# docker-entrypoint.sh — generic container entrypoint that probes deps before starting.
#
# Reads WAIT_FOR env var (space-separated HOST:PORT pairs), runs wait-for-deps.sh
# against each, then exec's the container CMD.
#
# Set WAIT_FOR in docker-compose.yml or the DO app spec per service:
#   WAIT_FOR: "xstockstrat-config:50060 xstockstrat-ledger:50057"
#
# Leave WAIT_FOR unset or empty to skip probing and start immediately.
set -e

if [ -n "${WAIT_FOR:-}" ]; then
  # Word-split WAIT_FOR into individual HOST:PORT args.
  # Unquoted expansion is intentional — HOST:PORT pairs never contain spaces.
  # shellcheck disable=SC2086
  /usr/local/bin/wait-for-deps.sh $WAIT_FOR
fi

exec "$@"
