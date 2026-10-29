#!/usr/bin/env bash
# scripts/homelab-release-env.sh <images_env> <out_env>; reads TARGET_ENV, APP_ENV, MTLS_CA from the environment.
# Pipeline-owned keys are dropped from APP_ENV and written last; never print a value.
set -euo pipefail
umask 077

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <images_env> <out_env>" >&2
  exit 1
fi
images="$1"
out="$2"
: "${APP_ENV:?APP_ENV is required}" "${MTLS_CA:?MTLS_CA is required}"
# Database host, names and roles are homelab-edge's db_host / db_workloads; change both repos together.
DB_HOST=db.ts.natanddavehouse.com
case "${TARGET_ENV:-}" in
production) db=xstockstrat-production role=xstockstrat_production appenv=production mode=live ;;
staging) db=xstockstrat-staging role=xstockstrat_staging appenv=development mode=paper ;;
*)
  echo "homelab-release-env: TARGET_ENV must be staging or production" >&2
  exit 1
  ;;
esac
[ -s "$images" ] || {
  echo "homelab-release-env: $images is empty" >&2
  exit 1
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
certs="$(mktemp -d)"
trap 'rm -rf "$certs" "$out.tmp"' EXIT
bash "$REPO_ROOT/scripts/mtls-provision.sh" decode-ca "$certs"
CERTS_DIR="$certs" bash "$REPO_ROOT/scripts/gen-dev-certs.sh" >/dev/null
owned='^[[:space:]]*(export[[:space:]]+)?(DB_HOST|DB_NAME|DB_USER|APPLICATION_ENV|TRADING_MODE|IMAGE_[A-Z_]+|MTLS_CA_CERT|[A-Z]+_MTLS_(CERT|KEY))[[:space:]]*[=:]'
{
  printf '%s\n' "$APP_ENV" | { grep -Ev "$owned" || true; }
  printf 'DB_HOST=%s\nDB_NAME=%s\nDB_USER=%s\n' "$DB_HOST" "$db" "$role"
  printf 'APPLICATION_ENV=%s\nTRADING_MODE=%s\n' "$appenv" "$mode"
  cat "$images"
  CERTS_DIR="$certs" python3 "$REPO_ROOT/scripts/homelab-mtls-env.py"
} >"$out.tmp"
mv "$out.tmp" "$out"
