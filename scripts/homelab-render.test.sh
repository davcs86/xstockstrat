#!/usr/bin/env bash
# Builds and renders homelab release .env files with the real scripts (feature 279); no daemon needed.
# Requires docker compose, jq, python3, openssl. Exits non-zero on any failed assertion.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JQ="$REPO_ROOT/deploy/homelab/render-assert.jq"
fail() {
  echo "ASSERT FAIL: $*" >&2
  exit 1
}

for tool in docker jq python3 openssl; do
  command -v "$tool" >/dev/null || fail "$tool is required"
done
docker compose version >/dev/null 2>&1 || fail "docker compose is required"
for f in scripts/homelab-release-env.sh scripts/homelab-render-check.sh deploy/homelab/render-assert.jq; do
  [ -f "$REPO_ROOT/$f" ] || fail "$f missing"
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/tmp"
hex=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
probe=SECRETPROBE

CERTS_DIR="$work/ca" CA_CN=xstockstrat-homelab-test-ca bash "$REPO_ROOT/scripts/gen-dev-certs.sh" >/dev/null
ca_b64="$(python3 -I -c 'import base64,json,sys; d=sys.argv[1]; print(base64.b64encode(json.dumps({"ca_cert":open(d+"/_ca/ca.pem").read(),"ca_key":open(d+"/_ca/ca-key.pem").read()}).encode()).decode())' "$work/ca")"

host=db.ts.natanddavehouse.com
images_of() { grep -ohE '[$][{]IMAGE_[A-Z_]+' "$@" | cut -c3- | sort -u | while read -r var; do
  svc="$(printf '%s' "${var#IMAGE_}" | tr 'A-Z_' 'a-z-')"
  printf '%s=ghcr.io/davcs86/xstockstrat/xstockstrat-%s@sha256:%s\n' "$var" "$svc" "$hex"
done; }
images_of "$REPO_ROOT/deploy/homelab/compose.yml" >"$work/images.env"
[ "$(wc -l <"$work/images.env")" -eq 13 ] || fail "0: compose.yml does not name 13 images"
images_of "$REPO_ROOT/deploy/homelab/compose.yml" "$REPO_ROOT/deploy/homelab/compose.smoke.yml" >"$work/images14.env"
[ "$(wc -l <"$work/images14.env")" -eq 14 ] || fail "0: compose.yml + compose.smoke.yml do not name 14 images"
smoke_bind=100.64.0.7

base_env="DB_PASSWORD=pw
JWT_SECRET=$hex
BROKER_ACCOUNTS_ENCRYPTION_KEY=$hex
CONFIG_SECRETS_ENCRYPTION_KEY=$hex
SEED_USER_ID=00000000-0000-4000-8000-0000000000c1
APP_URL=https://xstockstrat.example.test
SMOKE_DB_PASSWORD=pw
SLACK_WEBHOOK_URL=$probe"

# build <target> <app_env> <out> [mtls_ca]; staging gets the 14-image set and the smoke bind address
build() {
  imgs="$work/images.env"
  [ "$1" != staging ] || imgs="$work/images14.env"
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="$work/tmp" TARGET_ENV="$1" APP_ENV="$2" MTLS_CA="${4:-$ca_b64}" SMOKE_BIND_ADDR="$smoke_bind" \
    bash "$REPO_ROOT/scripts/homelab-release-env.sh" "$imgs" "$3" 2>"$work/err"
}
check() { bash "$REPO_ROOT/scripts/homelab-render-check.sh" "$1" "$2" 2>"$work/err"; }
render() { env -i PATH="$PATH" HOME="$HOME" docker compose --env-file "$1" -f "$REPO_ROOT/deploy/homelab/compose.yml" config --format json 2>/dev/null; }
render_staging() { env -i PATH="$PATH" HOME="$HOME" docker compose --env-file "$1" -f "$REPO_ROOT/deploy/homelab/compose.yml" -f "$REPO_ROOT/deploy/homelab/compose.smoke.yml" config --format json 2>/dev/null; }
envv() { jq -r --arg s "$2" --arg k "$3" '.services[$s].environment[$k] // "MISSING"' "$1"; }
no_probe() { if grep -q "$probe" "$work/err"; then fail "$1: output carries the probe value"; fi; }
tmp_clean() { [ -z "$(ls -A "$work/tmp")" ] || fail "$1: temp files left behind"; }
mode_all() {
  for s in $(jq -r '.services | keys[] | select(. != "db-migrator")' "$1"); do
    [ "$(envv "$1" "$s" APPLICATION_ENV)" = "$2" ] || fail "$4: $s APPLICATION_ENV != $2"
    [ "$(envv "$1" "$s" TRADING_MODE)" = "$3" ] || fail "$4: $s TRADING_MODE != $3"
  done
}

# 1. staging
build staging "$base_env" "$work/staging.env" || fail "1: build failed ($(cat "$work/err"))"
# shellcheck disable=SC2012 # the permission string is the assertion
[ "$(ls -l "$work/staging.env" | cut -c1-10)" = "-rw-------" ] || fail "1: .env is not owner-only"
check "$work/staging.env" staging || fail "1: render check failed ($(cat "$work/err"))"
render_staging "$work/staging.env" >"$work/staging.json" || fail "1: render failed"
[ "$(envv "$work/staging.json" xstockstrat-trading DATABASE_URL)" = "postgresql://xstockstrat_staging:pw@db.ts.natanddavehouse.com:6432/xstockstrat-staging?sslmode=require" ] || fail "1: trading DATABASE_URL"
[ "$(envv "$work/staging.json" xstockstrat-trading DB_PGBOUNCER)" = "true" ] || fail "1: trading DB_PGBOUNCER"
[ "$(envv "$work/staging.json" xstockstrat-config DATABASE_URL)" = "postgresql://xstockstrat_staging:pw@db.ts.natanddavehouse.com:5432/xstockstrat-staging?sslmode=require" ] || fail "1: config DATABASE_URL"
[ "$(envv "$work/staging.json" xstockstrat-config DB_PGBOUNCER)" = "MISSING" ] || fail "1: config has DB_PGBOUNCER"
mode_all "$work/staging.json" development paper "1"
[ "$(envv "$work/staging.json" xstockstrat-ui HOSTNAME)" = "0.0.0.0" ] || fail "1: ui HOSTNAME"
[ "$(envv "$work/staging.json" xstockstrat-trading OTEL_ENABLED)" = "false" ] || fail "1: OTel"
[ "$(jq '.services | length' "$work/staging.json")" = "14" ] || fail "1: not 14 services"
[ "$(envv "$work/staging.json" xstockstrat-smoke DATABASE_URL)" = "postgresql://xstockstrat_staging_smoke_ro:pw@db.ts.natanddavehouse.com:5432/xstockstrat-staging?sslmode=require" ] || fail "1: smoke DATABASE_URL"
[ "$(jq -r '.services["xstockstrat-smoke"].ports[0].host_ip' "$work/staging.json")" = "$smoke_bind" ] || fail "1: smoke port not bound to SMOKE_BIND_ADDR"
if grep -q "SMOKE_BIND_ADDR" "$work/prod.env" 2>/dev/null; then fail "1: production env carries SMOKE_BIND_ADDR"; fi
[ "$(jq '[.services[] | select(has("build") or ((.volumes // []) | length > 0))] | length' "$work/staging.json")" = "0" ] || fail "1: build or volumes present"
[ "$(jq '[.services[].image | select(test("@sha256:[0-9a-f]{64}$") | not)] | length' "$work/staging.json")" = "0" ] || fail "1: image not pinned by digest"
[ "$(jq '[.services | to_entries[] | select(.key != "db-migrator" and .value.healthcheck.test == null)] | length' "$work/staging.json")" = "0" ] || fail "1: missing healthcheck"
[ "$(jq -c '[.services | to_entries[] | select((.value.ports // []) | length > 0) | "\(.key)=\([.value.ports[].published | tostring] | join(","))"] | sort' "$work/staging.json")" = '["xstockstrat-agent=9000","xstockstrat-smoke=9110","xstockstrat-ui=3000"]' ] || fail "1: published ports"

# 2. production
build production "$base_env" "$work/prod.env" || fail "2: build failed"
check "$work/prod.env" production || fail "2: render check failed ($(cat "$work/err"))"
render "$work/prod.env" >"$work/prod.json"
[ "$(envv "$work/prod.json" xstockstrat-config DATABASE_URL)" = "postgresql://xstockstrat_production:pw@db.ts.natanddavehouse.com:5432/xstockstrat-production?sslmode=require" ] || fail "2: config DATABASE_URL"
mode_all "$work/prod.json" production live "2"
[ "$(jq '.services | length' "$work/prod.json")" = "13" ] || fail "2: not 13 services"
if grep -q "SMOKE_BIND_ADDR" "$work/prod.env"; then fail "2: production env carries SMOKE_BIND_ADDR"; fi
jq -e '.services | has("xstockstrat-smoke") | not' "$work/prod.json" >/dev/null || fail "2: production renders smoke"

# 3. APP_ENV cannot override pipeline-owned values (incl. the compose-go `KEY: value` form)
override="$base_env
DB_NAME=evil
DB_USER=evil
IMAGE_UI=evil
APPLICATION_ENV=evil
export TRADING_MODE=paper
DB_HOST: evil.example.test"
build production "$override" "$work/override.env" || fail "3: build failed"
if grep -q evil "$work/override.env"; then fail "3: an APP_ENV override reached the .env"; fi
check "$work/override.env" production || fail "3: render check failed ($(cat "$work/err"))"
render "$work/override.env" >"$work/override.json"
[ "$(envv "$work/override.json" xstockstrat-config DATABASE_URL)" = "postgresql://xstockstrat_production:pw@db.ts.natanddavehouse.com:5432/xstockstrat-production?sslmode=require" ] || fail "3: config DATABASE_URL"
[ "$(jq -r '.services["xstockstrat-ui"].image' "$work/override.json")" = "ghcr.io/davcs86/xstockstrat/xstockstrat-ui@sha256:$hex" ] || fail "3: ui image"
mode_all "$work/override.json" production live "3"

# 4. mTLS leaves: verify against the rendered CA, own SAN, key matches, CA byte-identical
jq -j '.services["xstockstrat-trading"].environment.MTLS_CERT' "$work/prod.json" >"$work/c.pem"
jq -j '.services["xstockstrat-trading"].environment.MTLS_KEY' "$work/prod.json" >"$work/k.pem"
jq -j '.services["xstockstrat-trading"].environment.MTLS_CA_CERT' "$work/prod.json" >"$work/ca.pem"
openssl verify -CAfile "$work/ca.pem" "$work/c.pem" >/dev/null 2>&1 || fail "4: leaf does not verify"
openssl x509 -in "$work/c.pem" -noout -text | grep -qF "DNS:xstockstrat-trading" || fail "4: SAN"
[ "$(openssl x509 -in "$work/c.pem" -noout -pubkey)" = "$(openssl pkey -in "$work/k.pem" -pubout)" ] || fail "4: key does not match cert"
cmp -s "$work/ca.pem" "$work/ca/_ca/ca.pem" || fail "4: rendered CA differs from the CA's ca.pem"

# 5. a missing required value names the variable
build staging "$(printf '%s\n' "$base_env" | grep -v '^DB_PASSWORD=')" "$work/nopw.env" || fail "5: build failed"
if check "$work/nopw.env" staging; then fail "5: render passed without DB_PASSWORD"; fi
grep -q "required variable DB_PASSWORD is missing a value" "$work/err" || fail "5: variable not named ($(cat "$work/err"))"

# 6. bad inputs leave nothing behind and print no value
rc=0
build qa "$base_env" "$work/qa.env" || rc=$?
[ "$rc" -eq 1 ] || fail "6: target qa exit $rc"
[ ! -e "$work/qa.env" ] || fail "6: qa wrote a file"
rc=0
build staging "$base_env" "$work/bad.env" "$probe" || rc=$?
[ "$rc" -ne 0 ] || fail "6: malformed MTLS_CA accepted"
[ ! -e "$work/bad.env" ] && [ ! -e "$work/bad.env.tmp" ] || fail "6: malformed MTLS_CA wrote a file"
no_probe "6 malformed CA"
tmp_clean "6 malformed CA"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/other-key.pem" -out "$work/other.pem" -days 1 -subj /CN=other >/dev/null 2>&1
bad_ca="$(python3 -I -c 'import base64,json,sys; print(base64.b64encode(json.dumps({"ca_cert":open(sys.argv[1]).read(),"ca_key":open(sys.argv[2]).read()}).encode()).decode())' "$work/ca/_ca/ca.pem" "$work/other-key.pem")"
rc=0
build staging "$base_env" "$work/mis.env" "$bad_ca" || rc=$?
[ "$rc" -ne 0 ] || fail "6: mismatched CA key accepted"
[ ! -e "$work/mis.env" ] || fail "6: mismatched CA wrote a file"
grep -q "does not match" "$work/err" || fail "6: mismatch not reported ($(cat "$work/err"))"
if grep -q "PRIVATE KEY" "$work/err"; then fail "6: key material printed"; fi
tmp_clean "6 mismatched CA"

# 7. the oracle names every broken render, never passes an empty one, never prints a value
[ "$(jq -c --arg target production --arg host "$host" -f "$JQ" "$work/prod.json")" = "[]" ] || fail "7: unmodified production render does not pass"
mutate() { # mutate <label> <jq filter> [target]
  out="$(jq "$2" "$work/prod.json" | jq -c --arg target "${3:-production}" --arg host "$host" -f "$JQ" 2>/dev/null)" || out="ERR"
  case "$out" in *"\"$1"*) ;; *) fail "7: '$2' did not report $1 (got $out)" ;; esac
  case "$out" in *"$probe"*) fail "7: '$2' printed a value" ;; esac
}
mutate services 'del(.services["db-migrator"])'
mutate unclassified:xstockstrat-new '.services["xstockstrat-new"] = .services["xstockstrat-trading"]'
mutate depends-migrator:xstockstrat-config 'del(.services["xstockstrat-config"].depends_on["db-migrator"])'
mutate depends-migrator:xstockstrat-trading 'del(.services["xstockstrat-config"].depends_on["db-migrator"])'
mutate ui-hostname 'del(.services["xstockstrat-ui"].environment.HOSTNAME)'
mutate trading-mode:xstockstrat-trading '.services["xstockstrat-trading"].environment.TRADING_MODE = "paper"'
mutate image:xstockstrat-config '.services["xstockstrat-config"].image = "ghcr.io/davcs86/xstockstrat/xstockstrat-config:latest"'
mutate ports '.services["xstockstrat-trading"].ports = [{"target": 50051, "published": "50051"}]'
mutate direct:xstockstrat-config '.services["xstockstrat-config"].environment.DB_PGBOUNCER = "true"'
mutate healthcheck:xstockstrat-ledger 'del(.services["xstockstrat-ledger"].healthcheck)'
mutate services '.services = {}'
mutate pooled:xstockstrat-trading ".services[\"xstockstrat-trading\"].environment.DATABASE_URL = \"x-$probe\""
mutate mtls:xstockstrat-trading ".services[\"xstockstrat-trading\"].environment.MTLS_KEY = \"$probe\""
mutate direct:xstockstrat-config '.services["xstockstrat-config"].environment.DATABASE_URL |= sub("xstockstrat_production:"; "xstockstrat-production:")'
mutate direct:xstockstrat-config '.services["xstockstrat-config"].environment.DATABASE_URL |= sub("/xstockstrat-production[?]"; "/xstockstrat_production?")'
mutate pool-budget '.services["xstockstrat-config"].environment.DB_POOL_MAX = "5"'
mutate pool-budget 'del(.services["xstockstrat-notify"].environment.DB_POOL_MAX)'
mutate pool-budget:xstockstrat-trading '.services["xstockstrat-trading"].environment.DB_POOL_MAX = "2"'
mutate application-env: '.' staging
mutate smoke-in-production '.services["xstockstrat-smoke"] = {image: "x"}'
smutate() { # smutate <label> <jq filter>: staging fixture with the overlay asserted
  out="$(jq "$2" "$work/staging.json" | jq -c --arg target staging --arg host "$host" --arg bind "$smoke_bind" --arg overlay yes -f "$JQ" 2>/dev/null)" || out="ERR"
  case "$out" in *"\"$1"*) ;; *) fail "7: '$2' did not report $1 (got $out)" ;; esac
}
[ "$(jq -c --arg target staging --arg host "$host" --arg bind "$smoke_bind" --arg overlay yes -f "$JQ" "$work/staging.json")" = "[]" ] || fail "7: unmodified staging render does not pass"
smutate smoke-dsn '.services["xstockstrat-smoke"].environment.DATABASE_URL |= sub("_smoke_ro"; "")'
smutate smoke-dsn '.services["xstockstrat-smoke"].environment.DB_PGBOUNCER = "true"'
smutate smoke-pool '.services["xstockstrat-smoke"].environment.DB_POOL_MAX = "2"'
smutate smoke-bind 'del(.services["xstockstrat-smoke"].ports[0].host_ip)'
smutate smoke-bind '.services["xstockstrat-smoke"].ports[0].host_ip = "0.0.0.0"'
smutate smoke-healthcheck '.services["xstockstrat-smoke"].healthcheck.start_period = "30s"'
smutate smoke-restart '.services["xstockstrat-smoke"].restart = "no"'
smutate smoke-missing 'del(.services["xstockstrat-smoke"])'
smutate ports '.services["xstockstrat-smoke"].ports = []'
mutate target '.' qa
out="$(jq -c --arg target production --arg host "x/$probe" -f "$JQ" "$work/prod.json" 2>/dev/null)" || out="ERR"
case "$out" in *'"db-host"'*) ;; *) fail "7: a malformed DB host was not reported (got $out)" ;; esac
case "$out" in *"$probe"*) fail "7: a malformed DB host printed its value" ;; esac
out="$(printf '"%s"' "$probe" | jq -c --arg target production --arg host "$host" -f "$JQ" 2>/dev/null)" || out=""
[ -n "$out" ] && [ "$out" != "[]" ] || fail "7: a non-object input passed"
case "$out" in *"$probe"*) fail "7: a non-object input printed its value" ;; esac

# 8. a line compose cannot parse fails the render without printing the .env
build staging "$base_env
BAD!KEY=$probe" "$work/garbled.env" || fail "8: build failed"
if check "$work/garbled.env" staging; then fail "8: render passed a garbled .env"; fi
no_probe "8 garbled"
grep -q "details suppressed" "$work/err" || fail "8: no suppression notice ($(cat "$work/err"))"

# 9. an unclosed quote fails the render without printing the rest of the file
build staging "$base_env
BROKEN=\"$probe" "$work/unclosed.env" || fail "9: build failed"
if check "$work/unclosed.env" staging; then fail "9: render passed an unclosed quote"; fi
no_probe "9 unclosed"
if grep -q "PRIVATE KEY" "$work/err"; then fail "9: key material printed"; fi

echo "homelab-render.test.sh: all assertions passed"
