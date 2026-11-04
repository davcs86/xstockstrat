#!/usr/bin/env bash
# Hermetic tests for the SOPS deploy-secret tooling (setup-sops action, sops_secrets.py,
# do-render-app-spec.py) and the static rules pinned on the deploy workflows. Usage: [group ...]
# shellcheck disable=SC2015,SC2016 # `A && B || fail` is the assertion idiom (fail always exits); literal $ is test data
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

fail() {
  echo "ASSERT FAIL: $*" >&2
  exit 1
}

need() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null || fail "$tool is required (macOS: brew install $tool)"
  done
  yq --version 2>/dev/null | grep -q 'mikefarah' || fail "yq must be mikefarah yq v4 (brew install yq)"
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

ACTION=.github/actions/setup-sops/action.yml
SOPS_PIN_VERSION=3.13.3
SOPS_PIN_SHA256=e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b
AGE_PIN_VERSION=1.3.2
AGE_PIN_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10

group_action() {
  need yq
  [ -f "$ACTION" ] || fail "action: $ACTION does not exist"
  yq e 'true' "$ACTION" >/dev/null || fail "action: $ACTION does not parse"
  [ "$(yq e '.runs.using' "$ACTION")" = composite ] || fail "action: runs.using must be composite"
  [ "$(yq e '.runs.steps | length' "$ACTION")" = 1 ] || fail "action: expected exactly one step"
  [ "$(yq e '.runs.steps[0].env.SOPS_VERSION' "$ACTION")" = "$SOPS_PIN_VERSION" ] || fail "action: SOPS_VERSION pin"
  [ "$(yq e '.runs.steps[0].env.SOPS_SHA256' "$ACTION")" = "$SOPS_PIN_SHA256" ] || fail "action: SOPS_SHA256 pin"
  [ "$(yq e '.runs.steps[0].env.AGE_VERSION' "$ACTION")" = "$AGE_PIN_VERSION" ] || fail "action: AGE_VERSION pin"
  [ "$(yq e '.runs.steps[0].env.AGE_SHA256' "$ACTION")" = "$AGE_PIN_SHA256" ] || fail "action: AGE_SHA256 pin"
  local run
  run="$(yq e '.runs.steps[0].run' "$ACTION")"
  [ "$(grep -c 'sha256sum -c -' <<<"$run")" = 2 ] || fail "action: expected two sha256sum -c - checks"
  # shellcheck disable=SC2016 # the literal ${VAR} references are what is asserted
  grep -qF 'https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/' <<<"$run" || fail "action: sops URL must use \${SOPS_VERSION}"
  # shellcheck disable=SC2016
  grep -qF 'https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/' <<<"$run" || fail "action: age URL must use \${AGE_VERSION}"
  ! grep -qE '^\s*(-\s+)?uses:' "$ACTION" || fail "action: must contain no uses:"
  echo "action: ok"
}

probe=SECRETPROBE
mkdir -p "$work/tmp"

setup_keys() {
  [ -f "$work/keys/operator.pub" ] && return 0
  mkdir -p "$work/keys"
  local k
  for k in staging production operator; do
    age-keygen -o "$work/keys/$k.key" 2>/dev/null
    age-keygen -y "$work/keys/$k.key" >"$work/keys/$k.pub"
  done
}

# enc_json <env> <json> <out>: a test SOPS file encrypted to <env> + operator, from outside any repo.
enc_json() {
  setup_keys
  mkdir -p "$(dirname "$3")"
  (cd "$work" && printf '%s' "$2" | sops encrypt --input-type json --output-type yaml \
    --filename-override "secrets/$1.enc.yaml" \
    --age "$(cat "$work/keys/$1.pub"),$(cat "$work/keys/operator.pub")" /dev/stdin) >"$3" ||
    fail "enc_json: encrypt failed"
}

fixture_ca() {
  [ -f "$work/ca_b64" ] && return 0
  CERTS_DIR="$work/ca" CA_CN=xstockstrat-sops-test-ca bash scripts/gen-dev-certs.sh >/dev/null
  python3 -I -c 'import base64,json,sys; d=sys.argv[1]; print(base64.b64encode(json.dumps({"ca_cert":open(d+"/_ca/ca.pem").read(),"ca_key":open(d+"/_ca/ca-key.pem").read()}).encode()).decode())' "$work/ca" >"$work/ca_b64"
}

LIB='import json, os, sys
sys.path.insert(0, os.path.join(os.getcwd(), "scripts"))
import sops_secrets as s
v, src = s.resolve(os.environ["T_ENV"], os.environ["T_TARGET"], file=os.environ["T_FILE"])
with open(os.environ["T_OUT"], "w") as f:
    json.dump({"values": v, "sources": src}, f)'

# lib <env> <target> <file> [VAR=value ...]: library resolve under env -i; out/err/sum/res.json in $work.
lib() {
  local e="$1" t="$2" f="$3"
  shift 3
  rm -f "$work/res.json" "$work/sum"
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="$work/tmp" GITHUB_STEP_SUMMARY="$work/sum" \
    T_ENV="$e" T_TARGET="$t" T_FILE="$f" T_OUT="$work/res.json" "$@" python3 -c "$LIB" >"$work/out" 2>"$work/err"
}

# cli <env> <file> [VAR=value ...]: homelab CLI resolve; heredocs in $work/ghenv.
cli() {
  local e="$1" f="$2"
  shift 2
  rm -f "$work/ghenv" "$work/sum"
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="$work/tmp" GITHUB_STEP_SUMMARY="$work/sum" "$@" \
    python3 scripts/sops_secrets.py resolve --env "$e" --target homelab --github-env "$work/ghenv" --file "$f" \
    >"$work/out" 2>"$work/err"
}

val() { jq -r --arg k "$1" '.values[$k] // "ABSENT"' "$work/res.json"; }
src() { sed -n "s/^- $1: //p" "$work/sum"; }
# ghenv_get <NAME>: one heredoc value from $work/ghenv (value lines only).
ghenv_get() {
  python3 -I -c 'import re,sys
t=open(sys.argv[1]).read(); m=re.search(r"^"+re.escape(sys.argv[2])+r"<<(ghadelim_[0-9a-f]+)\n(.*?)\n\1$", t, re.M|re.S)
sys.exit(1) if not m else sys.stdout.write(m.group(2))' "$work/ghenv" "$1"
}
# only_masked <needle> <case>: the needle may appear in stdout only on ::add-mask:: lines, never in stderr.
only_masked() {
  if grep -qF -- "$1" "$work/err"; then fail "$2: stderr carries a value"; fi
  if grep -F -- "$1" "$work/out" | grep -qv '^::add-mask::'; then fail "$2: stdout carries a value outside a mask"; fi
}
masks_first() {
  awk '!/^::add-mask::/{seen=1} /^::add-mask::/&&seen{bad=1} END{exit bad}' "$work/out" || fail "$1: a mask follows other output"
}

do_legacy() {
  fixture_ca
  printf '%s\n' LEGACY_JWT_SECRET=jwt-gh LEGACY_BROKER_ACCOUNTS_ENCRYPTION_KEY=brk-gh \
    LEGACY_CONFIG_SECRETS_ENCRYPTION_KEY=cfg-gh "LEGACY_MTLS_CA=$(cat "$work/ca_b64")"
}

group_resolve() {
  need sops age age-keygen docker jq python3 openssl git
  fixture_ca
  local leg absent="$work/none/staging.enc.yaml" f rc
  mapfile -t leg < <(do_legacy)

  # 1. file absent: every do-target key is read from its LEGACY_ fallback
  lib staging "do" "$absent" "${leg[@]}" LEGACY_SLACK_WEBHOOK_URL=sl-gh LEGACY_SENDGRID_API_KEY=sg-gh \
    LEGACY_VAPID_PRIVATE_KEY=vp-gh LEGACY_VAPID_PUBLIC_KEY=vu-gh LEGACY_VAPID_SUBJECT=mailto:a@b.c \
    LEGACY_OTEL_EXPORTER_OTLP_ENDPOINT=https://o.example LEGACY_OTEL_EXPORTER_OTLP_HEADERS=Basic-x \
    LEGACY_PROJECT_ID=proj-9 || fail "1: resolve failed ($(cat "$work/err"))"
  for k in JWT_SECRET BROKER_ACCOUNTS_ENCRYPTION_KEY CONFIG_SECRETS_ENCRYPTION_KEY MTLS_CA SLACK_WEBHOOK_URL \
    SENDGRID_API_KEY VAPID_PRIVATE_KEY VAPID_PUBLIC_KEY VAPID_SUBJECT OTEL_EXPORTER_OTLP_ENDPOINT \
    OTEL_EXPORTER_OTLP_HEADERS PROJECT_ID; do
    [ "$(src "$k")" = github ] || fail "1: $k source is '$(src "$k")', not github"
  done
  grep -q '^### Secret sources$' "$work/sum" || fail "1: summary heading"
  [ "$(val PROJECT_ID)" = proj-9 ] || fail "1: PROJECT_ID value"

  # 2. AC-9: sops wins, per-key fallback, differs warning names the key only, masks come first
  f="$work/c2/staging.enc.yaml"
  enc_json staging '{"common":{"JWT_SECRET":"jwt-sops"}}' "$f"
  lib staging "do" "$f" "${leg[@]}" SOPS_AGE_KEY="$(cat "$work/keys/staging.key")" \
    LEGACY_SENDGRID_API_KEY=sg-gh || fail "2: resolve failed ($(cat "$work/err"))"
  [ "$(val JWT_SECRET)" = jwt-sops ] || fail "2: JWT_SECRET value"
  [ "$(src JWT_SECRET)" = "sops (differs from legacy)" ] || fail "2: JWT_SECRET source '$(src JWT_SECRET)'"
  [ "$(val SENDGRID_API_KEY)" = sg-gh ] && [ "$(src SENDGRID_API_KEY)" = github ] || fail "2: SENDGRID fallback"
  grep -q '^::warning::.*JWT_SECRET' "$work/out" || fail "2: no differs warning for JWT_SECRET"
  only_masked jwt-sops 2
  only_masked jwt-gh 2
  masks_first 2

  # 3. AC-10: a required key in neither store fails closed and names the key only
  rc=0
  lib staging "do" "$absent" LEGACY_JWT_SECRET="$probe-jwt" LEGACY_BROKER_ACCOUNTS_ENCRYPTION_KEY=brk-gh \
    "LEGACY_MTLS_CA=$(cat "$work/ca_b64")" || rc=$?
  [ "$rc" = 1 ] || fail "3: exit $rc, want 1"
  grep -qF 'CONFIG_SECRETS_ENCRYPTION_KEY is in neither SOPS nor the GitHub secrets' "$work/err" || fail "3: message"
  [ "$(src CONFIG_SECRETS_ENCRYPTION_KEY)" = MISSING ] || fail "3: summary MISSING"
  only_masked "$probe" 3

  # 4. present file: empty SOPS_AGE_KEY or the wrong key is a hard failure, never a fallback
  rc=0
  lib staging "do" "$f" "${leg[@]}" || rc=$?
  [ "$rc" = 1 ] || fail "4: empty SOPS_AGE_KEY exit $rc"
  rc=0
  lib staging "do" "$f" "${leg[@]}" SOPS_AGE_KEY="$(cat "$work/keys/production.key")" || rc=$?
  [ "$rc" = 1 ] || fail "4: wrong key exit $rc"
  grep -qE 'cannot decrypt secrets/staging\.enc\.yaml \(sops exit [0-9]+\)' "$work/err" || fail "4: message"
  if grep -q 'identity did not match' "$work/err"; then fail "4: sops stderr leaked through"; fi
  [ ! -f "$work/res.json" ] || fail "4: fell back to legacy"

  # 5. a non-string leaf is refused by key name
  enc_json staging '{"common":{"JWT_SECRET":5}}' "$work/c5/staging.enc.yaml"
  rc=0
  lib staging "do" "$work/c5/staging.enc.yaml" "${leg[@]}" SOPS_AGE_KEY="$(cat "$work/keys/staging.key")" || rc=$?
  [ "$rc" = 1 ] && grep -qF 'common.JWT_SECRET must be a string' "$work/err" || fail "5: non-string leaf"

  # 6. AC-22: an unprefixed MTLS_CA in the environment is never read
  lib staging "do" "$absent" "${leg[@]}" MTLS_CA=other-ca || fail "6: resolve failed"
  [ "$(val MTLS_CA)" = "$(cat "$work/ca_b64")" ] || fail "6: MTLS_CA came from the unprefixed variable"

  # 7. AC-13: homelab CLI per-key fallback, six heredocs
  local hl=(LEGACY_TS_AUTHKEY=tskey-gh LEGACY_TS_AUTHKEY_EXPIRES=2099-01-01 "LEGACY_DEPLOY_SSH_KEY=ssh-gh-key"
    LEGACY_DEPLOY_KNOWN_HOSTS=known-gh)
  local app_json
  app_json='{"APP_URL":"https://x.example","DB_PASSWORD":"p$w #1 \"x\"","DB_HOST":"ignored","SEED_USER_ID":"00000000-0000-4000-8000-0000000000c1"}'
  f="$work/c7/staging.enc.yaml"
  enc_json staging "$(jq -n --arg ca "$(cat "$work/ca_b64")" --argjson app "$app_json" \
    '{common:{JWT_SECRET:"j$t",BROKER_ACCOUNTS_ENCRYPTION_KEY:"brk-sops",CONFIG_SECRETS_ENCRYPTION_KEY:"cfg-sops",MTLS_CA:$ca},
      homelab:{TS_AUTHKEY:"tskey-sops",TS_AUTHKEY_EXPIRES:"2099-01-01",DEPLOY_SSH_KEY:"ssh-sops",app_env:$app}}')" "$f"
  cli staging "$f" "${hl[@]}" SOPS_AGE_KEY="$(cat "$work/keys/staging.key")" || fail "7: cli failed ($(cat "$work/err"))"
  [ "$(src DEPLOY_KNOWN_HOSTS)" = github ] || fail "7: DEPLOY_KNOWN_HOSTS source"
  [ "$(src TS_AUTHKEY)" = "sops (differs from legacy)" ] || fail "7: TS_AUTHKEY source"
  for k in TS_AUTHKEY TS_AUTHKEY_EXPIRES DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS MTLS_CA APP_ENV; do
    ghenv_get "$k" >/dev/null || fail "7: no $k heredoc"
  done

  # 8. AC-5 + AC-18: through the real release script and compose, values stay literal; DO tail last; shared CA
  ghenv_get APP_ENV >"$work/app_env"
  ghenv_get MTLS_CA >"$work/hl_ca"
  awk -F= '/^(JWT_SECRET|BROKER_ACCOUNTS_ENCRYPTION_KEY|CONFIG_SECRETS_ENCRYPTION_KEY)=/{if(!t)t=NR}
    /^(APP_URL|DB_PASSWORD|DB_HOST|SEED_USER_ID)=/{a=NR} END{exit !(t && a && a < t)}' "$work/app_env" ||
    fail "8: app_env lines must precede the common tail"
  local hexd=0011223344556677889900112233445566778899001122334455667788990011 img="$work/images.env"
  grep -oE '[$][{]IMAGE_[A-Z_]+' deploy/homelab/compose.yml | cut -c3- | sort -u | while read -r var; do
    printf '%s=ghcr.io/x/xstockstrat-%s@sha256:%s\n' "$var" "$(printf '%s' "${var#IMAGE_}" | tr 'A-Z_' 'a-z-')" "$hexd"
  done >"$img"
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="$work/tmp" TARGET_ENV=staging APP_ENV="$(cat "$work/app_env")" \
    MTLS_CA="$(cat "$work/hl_ca")" bash scripts/homelab-release-env.sh "$img" "$work/release.env" 2>"$work/err" ||
    fail "8: release env failed ($(cat "$work/err"))"
  env -i PATH="$PATH" HOME="$HOME" docker compose --env-file "$work/release.env" -f deploy/homelab/compose.yml \
    config --format json >"$work/compose.json" 2>"$work/err" || fail "8: compose render failed ($(cat "$work/err"))"
  local got
  got="$(jq -r '.services["xstockstrat-trading"].environment.DATABASE_URL' "$work/compose.json" | sed 's/[$][$]/$/g')"
  case "$got" in *':p$w #1 "x"@'*) ;; *) fail "8: DB_PASSWORD not literal in DATABASE_URL" ;; esac
  got="$(jq -r '.services["xstockstrat-identity"].environment.JWT_SECRET' "$work/compose.json" | sed 's/[$][$]/$/g')"
  [ "$got" = 'j$t' ] || fail "8: JWT_SECRET not literal"
  jq -j '.services["xstockstrat-trading"].environment.MTLS_CA_CERT' "$work/compose.json" >"$work/got_ca.pem"
  cmp -s "$work/got_ca.pem" "$work/ca/_ca/ca.pem" || fail "8: MTLS_CA_CERT is not the shared fixture CA"

  # 9. AC-23: app_env may not carry a common key
  f="$work/c9/staging.enc.yaml"
  enc_json staging "$(jq -n --arg ca "$(cat "$work/ca_b64")" \
    '{common:{JWT_SECRET:"jwt-do",BROKER_ACCOUNTS_ENCRYPTION_KEY:"brk-sops",CONFIG_SECRETS_ENCRYPTION_KEY:"cfg-sops",MTLS_CA:$ca},
      homelab:{app_env:{JWT_SECRET:"jwt-x",APP_URL:"https://x.example"}}}')" "$f"
  rc=0
  cli staging "$f" "${hl[@]}" SOPS_AGE_KEY="$(cat "$work/keys/staging.key")" || rc=$?
  [ "$rc" = 1 ] && grep -qF 'homelab.app_env must not contain common key JWT_SECRET' "$work/err" || fail "9: AC-23"
  only_masked jwt-x 9
  only_masked jwt-do 9

  # 10. legacy APP_ENV blob: common-key lines are dropped, the DO value is appended last
  cli staging "$absent" "${leg[@]}" "${hl[@]}" \
    "LEGACY_APP_ENV=$(printf 'APP_URL=https://l.example\nexport JWT_SECRET=old\n  JWT_SECRET: old2\nJWT_SECRET_OLD=keep')" ||
    fail "10: cli failed ($(cat "$work/err"))"
  ghenv_get APP_ENV >"$work/app_env"
  if grep -qE '(^|[[:space:]])JWT_SECRET[[:space:]]*[=:][[:space:]]*old' "$work/app_env"; then fail "10: legacy common line kept"; fi
  grep -qx 'JWT_SECRET_OLD=keep' "$work/app_env" || fail "10: non-common line dropped"
  [ "$(grep -cE '(^|\s)JWT_SECRET\s*[=:]' "$work/app_env")" = 1 ] || fail "10: JWT_SECRET lines"
  [ "$(tail -n 3 "$work/app_env" | grep -c "^JWT_SECRET='jwt-gh'$")" = 1 ] || fail "10: DO JWT_SECRET not in the tail"

  # 11. refusals name the key: quote, newline, bad key name, the heredoc delimiter prefix
  local bad
  for bad in '{"APP_URL":"it'"'"'s"}' '{"APP_URL":"a\nb"}' '{"1BAD":"x"}' '{"APP_URL":"x ghadelim_ y"}'; do
    f="$work/c11/staging.enc.yaml"
    rm -f "$f"
    enc_json staging "$(jq -n --arg ca "$(cat "$work/ca_b64")" --argjson app "$bad" \
      '{common:{JWT_SECRET:"jwt-do",BROKER_ACCOUNTS_ENCRYPTION_KEY:"brk-sops",CONFIG_SECRETS_ENCRYPTION_KEY:"cfg-sops",MTLS_CA:$ca},homelab:{app_env:$app}}')" "$f"
    rc=0
    cli staging "$f" "${hl[@]}" SOPS_AGE_KEY="$(cat "$work/keys/staging.key")" || rc=$?
    [ "$rc" = 1 ] || fail "11: $bad was accepted"
    grep -qE 'APP_URL|1BAD' "$work/err" || fail "11: refusal for $bad does not name the key"
  done

  # 12. no normalisation: trailing space and newline survive both paths
  local tv=$'trail-v \n'
  lib staging "do" "$absent" "${leg[@]}" "LEGACY_SLACK_WEBHOOK_URL=$tv" || fail "12: legacy resolve failed"
  [ "$(jq -r '.values.SLACK_WEBHOOK_URL | @json' "$work/res.json")" = '"trail-v \n"' ] || fail "12: legacy value normalised"
  enc_json staging '{"common":{"SLACK_WEBHOOK_URL":"trail-v \n"}}' "$work/c12/staging.enc.yaml"
  lib staging "do" "$work/c12/staging.enc.yaml" "${leg[@]}" SOPS_AGE_KEY="$(cat "$work/keys/staging.key")" ||
    fail "12: sops resolve failed"
  [ "$(jq -r '.values.SLACK_WEBHOOK_URL | @json' "$work/res.json")" = '"trail-v \n"' ] || fail "12: sops value normalised"

  # 13. leak canary: every line of 4+ chars of a multi-line value is masked; short values are not
  lib staging "do" "$absent" "${leg[@]}" "LEGACY_SENDGRID_API_KEY=$(printf '%s-one\nab\n%s-three' "$probe" "$probe")" \
    LEGACY_VAPID_SUBJECT=xy || fail "13: resolve failed"
  grep -qx "::add-mask::$probe-one" "$work/out" && grep -qx "::add-mask::$probe-three" "$work/out" || fail "13: line masks"
  if grep -qx '::add-mask::ab' "$work/out" || grep -qx '::add-mask::xy' "$work/out"; then fail "13: short value masked"; fi
  only_masked "$probe" 13
  echo "resolve: ok"
}

groups="${*:-action resolve build render deploy produp homelab bootstrap ac24 cleanup}"
for g in $groups; do
  declare -F "group_$g" >/dev/null || fail "unknown or not-yet-implemented group: $g"
  "group_$g"
done
echo "sops-secrets.test.sh: all assertions passed ($groups)"
