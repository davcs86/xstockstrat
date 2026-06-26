#!/usr/bin/env bash
#
# db-connect.sh — temporarily whitelist your current IP on a DigitalOcean managed
# database cluster, open a psql session, then remove the firewall rule on exit.
#
# The DO managed DB only trusts the App Platform apps by default, so a laptop has to
# add its IP to "Trusted Sources" to connect. This script does that append/connect/
# cleanup cycle for you and never leaves a stray rule behind.
#
# Requirements: doctl (authenticated: `doctl auth init`), psql, curl.
#
# Usage:
#   ./db-connect.sh [-c CLUSTER_ID] [-d DB_NAME] [-i IP] [-- <extra psql args>]
#
# Examples:
#   ./db-connect.sh                                  # interactive psql, defaults below
#   ./db-connect.sh -d xstockstrat-staging
#   ./db-connect.sh -d xstockstrat-staging -- -c "select now();"
#
# Defaults can also come from the environment: DB_CLUSTER_ID, DB_NAME, DB_IP.

set -euo pipefail

# ---- defaults (override with flags or env) ---------------------------------
CLUSTER_ID="${DB_CLUSTER_ID:-1b5ad082-8145-4e09-bdcf-936adfc21f2a}"  # xstockstrat cluster
DB_NAME="${DB_NAME:-defaultdb}"   # e.g. xstockstrat-staging | xstockstrat-production
IP="${DB_IP:-}"                   # auto-detected if empty
PSQL_ARGS=()

# ---- arg parsing -----------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    -c|--cluster) CLUSTER_ID="$2"; shift 2 ;;
    -d|--db)      DB_NAME="$2";    shift 2 ;;
    -i|--ip)      IP="$2";         shift 2 ;;
    --)           shift; PSQL_ARGS=("$@"); break ;;
    -h|--help)    sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

# ---- preflight -------------------------------------------------------------
for bin in doctl psql curl; do
  command -v "$bin" >/dev/null 2>&1 || { echo "error: '$bin' not found in PATH" >&2; exit 1; }
done

if [ -z "$IP" ]; then
  IP="$(curl -fsS https://api.ipify.org)" || { echo "error: could not detect public IP" >&2; exit 1; }
fi
echo "Using IP: $IP"

# ---- cleanup: remove only the rule we added, on any exit -------------------
RULE_ADDED=0
cleanup() {
  [ "$RULE_ADDED" -eq 1 ] || return 0
  local uuid
  uuid="$(doctl databases firewalls list "$CLUSTER_ID" --format UUID,Type,Value --no-header 2>/dev/null \
    | awk -v ip="$IP" '$2 == "ip_addr" && $3 == ip { print $1; exit }')"
  if [ -n "${uuid:-}" ]; then
    echo "Removing firewall rule for $IP ($uuid)..."
    doctl databases firewalls remove "$CLUSTER_ID" --uuid "$uuid" >/dev/null \
      && echo "Firewall rule removed." \
      || echo "WARNING: failed to remove rule $uuid — remove it manually in the DO dashboard." >&2
  fi
}
trap cleanup EXIT INT TERM

# ---- append firewall rule --------------------------------------------------
echo "Appending firewall rule ip_addr:$IP to cluster $CLUSTER_ID..."
doctl databases firewalls append "$CLUSTER_ID" --rule "ip_addr:$IP" >/dev/null
RULE_ADDED=1
# DO takes a few seconds to propagate the new trusted source.
sleep 5

# ---- fetch connection details and connect ----------------------------------
# Read host/port/user/password as separate fields so the password (which may contain
# URL-significant characters) is passed via PGPASSWORD rather than embedded in a URI.
read -r HOST PORT USER PASSWORD < <(
  doctl databases connection "$CLUSTER_ID" --format Host,Port,User,Password --no-header
)

echo "Connecting to $DB_NAME on $HOST:$PORT as $USER ..."
# ${PSQL_ARGS[@]+...} guard keeps an empty array safe under `set -u` on bash 3.2 (macOS default).
PGPASSWORD="$PASSWORD" PGSSLMODE=require \
  psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB_NAME" ${PSQL_ARGS[@]+"${PSQL_ARGS[@]}"}
