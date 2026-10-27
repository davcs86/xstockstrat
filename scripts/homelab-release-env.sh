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
# Database and role names are homelab-edge's db_workloads; change both repos together.
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
mkdir "$certs/_ca"
if ! CERTS_DIR="$certs" python3 -I -c 'import base64, json, os
d = json.loads(base64.b64decode(os.environ["MTLS_CA"]))
ca = os.path.join(os.environ["CERTS_DIR"], "_ca")
open(os.path.join(ca, "ca.pem"), "w").write(d["ca_cert"])
open(os.path.join(ca, "ca-key.pem"), "w").write(d["ca_key"])' 2>/dev/null; then
  echo "homelab-release-env: MTLS_CA is not a base64 JSON {ca_cert, ca_key}" >&2
  exit 1
fi
# gen-dev-certs.sh hides openssl errors, so a mismatched CA key would mint empty leaves.
if ! ca_pub="$(openssl x509 -in "$certs/_ca/ca.pem" -noout -pubkey 2>/dev/null)" ||
  ! key_pub="$(openssl pkey -in "$certs/_ca/ca-key.pem" -pubout 2>/dev/null)" ||
  [ "$ca_pub" != "$key_pub" ]; then
  echo "homelab-release-env: MTLS_CA ca_key does not match its ca_cert" >&2
  exit 1
fi
CERTS_DIR="$certs" bash "$REPO_ROOT/scripts/gen-dev-certs.sh" >/dev/null
owned='^[[:space:]]*(export[[:space:]]+)?(DB_HOST|DB_NAME|DB_USER|APPLICATION_ENV|TRADING_MODE|IMAGE_[A-Z_]+|MTLS_CA_CERT|[A-Z]+_MTLS_(CERT|KEY))[[:space:]]*[=:]'
{
  printf '%s\n' "$APP_ENV" | { grep -Ev "$owned" || true; }
  printf 'DB_HOST=db.ts.natanddavehouse.com\nDB_NAME=%s\nDB_USER=%s\n' "$db" "$role"
  printf 'APPLICATION_ENV=%s\nTRADING_MODE=%s\n' "$appenv" "$mode"
  cat "$images"
  CERTS_DIR="$certs" python3 "$REPO_ROOT/scripts/homelab-mtls-env.py"
} >"$out.tmp"
mv "$out.tmp" "$out"
