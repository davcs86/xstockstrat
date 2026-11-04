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
FIXTURE_VPC=d7afff57-f807-4893-9fbf-20fff8bb82dd

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
  local leg line absent="$work/none/staging.enc.yaml" f rc
  leg=()
  while IFS= read -r line; do leg+=("$line"); done < <(do_legacy)

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

# mkrepo: a scratch clone at $work/repo (copy of the module) whose origin is a local bare repo with main-dev.
mkrepo() {
  rm -rf "$work/origin.git" "$work/repo"
  git init -q --bare -b main-dev "$work/origin.git"
  git init -q -b main-dev "$work/repo"
  mkdir -p "$work/repo/scripts"
  cp scripts/sops_secrets.py "$work/repo/scripts/"
  git -C "$work/repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  git -C "$work/repo" remote add origin "$work/origin.git"
  git -C "$work/repo" push -q origin main-dev
}

# bld <env> [flags...]: bootstrap build from the scratch clone, with BENV as the only environment.
bld() {
  local e="$1"
  shift
  rm -rf "$work/out"
  mkdir -p "$work/rt"
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="$work/tmp" RUNNER_TEMP="$work/rt" \
    SOPS_AGE_KEY="$(cat "$work/keys/$e.key")" SOPS_OPERATOR_AGE_RECIPIENT="$(cat "$work/keys/operator.pub")" \
    "${BENV[@]}" python3 "$work/repo/scripts/sops_secrets.py" build --env "$e" --out "$work/out" "$@" \
    >"$work/bout" 2>"$work/berr"
}
dec() { SOPS_AGE_KEY="$(cat "$work/keys/$1.key")" sops decrypt --output-type json "$2"; }
no_probe_build() {
  if grep -rqF -- "$probe" "$work/berr" "$work/out" 2>/dev/null; then fail "$1: probe in stderr or out dir"; fi
  if grep -F -- "$probe" "$work/bout" | grep -qv '^::add-mask::'; then fail "$1: probe in stdout outside a mask"; fi
}

group_build() {
  need sops age age-keygen jq python3 git
  setup_keys
  fixture_ca
  local rc base=(LEGACY_JWT_SECRET=jwt-do LEGACY_BROKER_ACCOUNTS_ENCRYPTION_KEY="$probe-brk"
    LEGACY_CONFIG_SECRETS_ENCRYPTION_KEY=cfg-do "LEGACY_MTLS_CA=$(cat "$work/ca_b64")" LEGACY_PROJECT_ID=proj-9)

  # 1. AC-2/AC-20: only common + digitalocean are seeded; homelab and platform credentials never are
  mkrepo
  BENV=("${base[@]}" TS_AUTHKEY=tskey-x APP_ENV=APP_URL=tskey-x DIGITALOCEAN_ACCESS_TOKEN=dotok GH_PAT=ghpat BUF_TOKEN=buftok)
  bld staging || fail "1: build failed ($(cat "$work/berr"))"
  dec staging "$work/out/staging.enc.yaml" >"$work/plain.json" || fail "1: own key cannot decrypt"
  [ "$(jq -c 'keys' "$work/plain.json")" = '["common","digitalocean"]' ] || fail "1: top-level keys $(jq -c keys "$work/plain.json")"
  [ "$(jq -r .common.JWT_SECRET "$work/plain.json")" = jwt-do ] || fail "1: JWT_SECRET"
  [ "$(jq -r .digitalocean.PROJECT_ID "$work/plain.json")" = proj-9 ] || fail "1: PROJECT_ID"
  if grep -qE 'tskey-x|dotok|ghpat|buftok|APP_ID|DIGITALOCEAN_ACCESS_TOKEN|GH_PAT|BUF_TOKEN' "$work/plain.json"; then
    fail "1: a homelab value or platform credential was seeded"
  fi
  if grep -rqF tskey-x "$work/out" "$work/bout" "$work/berr"; then fail "1: tskey-x leaked"; fi
  cp "$work/out/staging.enc.yaml" "$work/seeded-staging.enc.yaml"
  cp "$work/out/staging.recipient" "$work/seeded-staging.recipient"
  no_probe_build 1

  # 3. AC-7: every leaf is ciphertext; the recipient file is the env public key
  python3 -I -c 'import sys,re
t=open(sys.argv[1]).read().split("\nsops:")[0]
leaves=[l for l in t.splitlines() if re.match(r"^\s+\w+: ", l)]
assert leaves and all("ENC[AES256_GCM," in l for l in leaves), "plain leaf"' "$work/out/staging.enc.yaml" ||
    fail "3: a leaf is not ENC[AES256_GCM,"
  [ "$(cat "$work/out/staging.recipient")" = "$(cat "$work/keys/staging.pub")" ] || fail "3: recipient file"

  # 2. AC-1: the staging key cannot decrypt production; exactly 2 recipients (env + operator)
  bld production || fail "2: production build failed ($(cat "$work/berr"))"
  rc=0
  dec staging "$work/out/production.enc.yaml" >"$work/x.out" 2>"$work/x.err" || rc=$?
  [ "$rc" != 0 ] || fail "2: staging key decrypted production"
  grep -qF 'identity did not match any of the recipients' "$work/x.err" || fail "2: refusal text (D-1)"
  [ ! -s "$work/x.out" ] || fail "2: a value was printed"
  dec production "$work/out/production.enc.yaml" >/dev/null || fail "2: own key failed"
  [ "$(yq e '.sops.age | length' "$work/out/production.enc.yaml")" = 2 ] || fail "2: recipient count"
  [ "$(yq e '[.sops.age[].recipient] | sort | join(",")' "$work/out/production.enc.yaml")" = \
    "$(sort <(cat "$work/keys/production.pub") <(cat "$work/keys/operator.pub") | paste -sd, -)" ] || fail "2: recipients"

  # 4. AC-6: a missing required key fails before anything is written, and leaks nothing
  BENV=(LEGACY_BROKER_ACCOUNTS_ENCRYPTION_KEY="$probe-brk" LEGACY_CONFIG_SECRETS_ENCRYPTION_KEY=cfg-do
    "LEGACY_MTLS_CA=$(cat "$work/ca_b64")")
  rc=0
  bld production || rc=$?
  [ "$rc" = 1 ] || fail "4: exit $rc"
  grep -qF 'JWT_SECRET is required but missing' "$work/berr" || fail "4: message"
  [ -z "$(ls -A "$work/out" 2>/dev/null)" ] || fail "4: --out was written"
  no_probe_build 4

  # 7 + 8. absent optional is omitted (never ""); a trailing space/newline survives build -> verify -> decrypt
  BENV=("${base[@]}" $'LEGACY_SENDGRID_API_KEY=trail-v \n')
  bld staging || fail "7: build failed ($(cat "$work/berr"))"
  dec staging "$work/out/staging.enc.yaml" >"$work/plain.json"
  [ "$(jq '.common | has("SLACK_WEBHOOK_URL")' "$work/plain.json")" = false ] || fail "7: absent optional written"
  [ "$(jq -c '.common.SENDGRID_API_KEY' "$work/plain.json")" = '"trail-v \n"' ] || fail "8: value normalised"

  # 5. AC-15: an existing file on main-dev refuses without --force; --force writes a names-only change list
  mkdir -p "$work/repo/secrets"
  cp "$work/seeded-staging.enc.yaml" "$work/repo/secrets/staging.enc.yaml"
  git -C "$work/repo" add secrets/staging.enc.yaml
  git -C "$work/repo" -c user.name=t -c user.email=t@t commit -q -m seed
  git -C "$work/repo" push -q origin main-dev
  BENV=("${base[@]}" LEGACY_JWT_SECRET=jwt-rotated)
  rc=0
  bld staging || rc=$?
  [ "$rc" = 1 ] || fail "5: overwrite allowed without --force"
  grep -qF 'secrets/staging.enc.yaml already exists; re-run with force=true to overwrite' "$work/berr" || fail "5: message"
  [ -z "$(ls -A "$work/out" 2>/dev/null)" ] || fail "5: --out was written"
  bld staging --force || fail "5: --force failed ($(cat "$work/berr"))"
  [ -f "$work/out/staging.changes.md" ] || fail "5: no changes file"
  grep -q 'JWT_SECRET' "$work/out/staging.changes.md" || fail "5: JWT_SECRET not listed"
  if grep -qE 'jwt-rotated|jwt-do|cfg-do' "$work/out/staging.changes.md"; then fail "5: a value in the changes file"; fi
  no_probe_build 5

  # 6. a fetch failure is an error, never "absent"
  git -C "$work/repo" remote set-url origin "$work/missing.git"
  rc=0
  bld staging || rc=$?
  [ "$rc" = 1 ] && grep -qF 'cannot fetch main-dev' "$work/berr" || fail "6: fetch failure not reported"

  # 9. sops-config: two creation rules, each env key + operator, picked up from the clone root
  mkdir -p "$work/cfg"
  cp "$work/seeded-staging.recipient" "$work/cfg/staging.recipient"
  cat "$work/keys/production.pub" >"$work/cfg/production.recipient"
  env -i PATH="$PATH" HOME="$HOME" SOPS_OPERATOR_AGE_RECIPIENT="$(cat "$work/keys/operator.pub")" \
    python3 scripts/sops_secrets.py sops-config "$work/cfg" >"$work/repo/.sops.yaml" || fail "9: sops-config failed"
  [ "$(yq e '.creation_rules | length' "$work/repo/.sops.yaml")" = 2 ] || fail "9: rule count"
  [ "$(yq e '.creation_rules[0].path_regex' "$work/repo/.sops.yaml")" = 'secrets/staging\.enc\.yaml$' ] || fail "9: staging regex"
  [ "$(yq e '.creation_rules[1].path_regex' "$work/repo/.sops.yaml")" = 'secrets/production\.enc\.yaml$' ] || fail "9: production regex"
  printf 'A: x\n' >"$work/repo/secrets/staging.enc.yaml"
  (cd "$work/repo" && sops encrypt -i secrets/staging.enc.yaml) || fail "9: encrypt via .sops.yaml failed"
  [ "$(yq e '[.sops.age[].recipient] | sort | join(",")' "$work/repo/secrets/staging.enc.yaml")" = \
    "$(sort <(cat "$work/keys/staging.pub") <(cat "$work/keys/operator.pub") | paste -sd, -)" ] || fail "9: recipients"
  echo "build: ok"
}

# The 11 do-target non-MTLS keys, each mapped to a fixed-width, delimited sentinel (none is a substring of another).
DO_PLAIN="JWT_SECRET BROKER_ACCOUNTS_ENCRYPTION_KEY CONFIG_SECRETS_ENCRYPTION_KEY SLACK_WEBHOOK_URL SENDGRID_API_KEY
VAPID_PRIVATE_KEY VAPID_PUBLIC_KEY VAPID_SUBJECT OTEL_EXPORTER_OTLP_ENDPOINT OTEL_EXPORTER_OTLP_HEADERS PROJECT_ID"
sentinel_env() {
  local i=0 k
  for k in $DO_PLAIN; do
    printf 'LEGACY_%s=__S286_%02d__\n' "$k" "$i"
    i=$((i + 1))
  done
}

# rnd <env> <spec> <app-name> <out> [VAR=value ...]: run the copied renderer under env -i.
rnd() {
  local e="$1" spec="$2" name="$3" out="$4"
  shift 4
  rm -f "$out" "$work/sum" "$work/ghout"
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="$work/tmp" GITHUB_STEP_SUMMARY="$work/sum" GITHUB_OUTPUT="$work/ghout" "$@" \
    python3 "$work/repo/scripts/do-render-app-spec.py" --env "$e" --spec "$spec" --app-name "$name" \
    --image-tag abc1234 --org testorg --vpc-id "${RND_VPC-$FIXTURE_VPC}" --out "$out" >"$work/out" 2>"$work/err"
}

render_repo() {
  rm -rf "$work/repo"
  mkdir -p "$work/repo/scripts"
  cp scripts/do-render-app-spec.py scripts/sops_secrets.py scripts/mtls-provision.sh scripts/gen-dev-certs.sh "$work/repo/scripts/" ||
    fail "render: copy scripts"
}

REVMAP='import json, re, subprocess, sys
spec, rendered, sentinels, ca_pem, tmp, vpc = sys.argv[1:7]
base = open(spec).read().replace("YOUR_GITHUB_ORG", "testorg").replace("YOUR_IMAGE_TAG", "abc1234").replace("YOUR_VPC_ID", vpc)
got = open(rendered).read()
sent = dict(l.split("=", 1) for l in open(sentinels).read().split())
sent = {k.removeprefix("LEGACY_"): v for k, v in sent.items()}
for v in sent.values():
    assert v not in base, f"sentinel {v} occurs in the baseline"
def pem_q(p):
    q, bs = chr(34), chr(92)
    return q + p.replace(bs, bs + bs).replace(q, bs + q).replace(chr(10), bs + "n") + q
ca_q = pem_q(open(ca_pem).read())
bl, gl = base.split("\n"), got.split("\n")
if len(bl) != len(gl):
    sys.exit(f"line count differs: {len(bl)} vs {len(gl)}")
ph = re.compile(r"^(\s+value: )(YOUR_(?:DEV|PROD)_([A-Z0-9_]+))\s*$")
certs, keys = {}, {}
for i, (b, g) in enumerate(zip(bl, gl), 1):
    if b == g:
        continue
    m = ph.match(b)
    if not m or not g.startswith(m.group(1)):
        sys.exit(f"line {i}: a non-placeholder line changed")
    name, val = m.group(3), g[len(m.group(1)):]
    if name == "MTLS_CA_CERT":
        ok = val == ca_q
    elif name.startswith(("MTLS_CERT_", "MTLS_KEY_")):
        pem = json.loads(val)
        ok = re.fullmatch(r"-----BEGIN [A-Z ]+-----\n[A-Za-z0-9+/=\n]+-----END [A-Z ]+-----\n?", pem) is not None
        kind, sfx = name.split("_")[1], name.split("_", 2)[2]
        (certs if kind == "CERT" else keys)[sfx] = pem
    elif name == "OTEL_EXPORTER_OTLP_HEADERS":
        ok = val == "Authorization=" + sent[name]
    else:
        ok = val == sent.get(name)
    if not ok:
        sys.exit(f"line {i}: {name} does not carry its own value")
def ossl(*a, data=None):
    return subprocess.run(["openssl", *a], input=data, capture_output=True, text=True, check=False)
if sorted(certs) != sorted(keys) or len(certs) != 12:
    sys.exit(f"leaf set mismatch: {sorted(certs)} / {sorted(keys)}")
for sfx in certs:
    cp = f"{tmp}/{sfx}.pem"
    open(cp, "w").write(certs[sfx])
    if f"DNS:xstockstrat-{sfx.lower()}" not in ossl("x509", "-in", cp, "-noout", "-text").stdout:
        sys.exit(f"MTLS_CERT_{sfx}: SAN is not xstockstrat-{sfx.lower()}")
    if ossl("verify", "-CAfile", ca_pem, cp).returncode:
        sys.exit(f"MTLS_CERT_{sfx}: does not verify against the fixture CA")
    if ossl("x509", "-in", cp, "-noout", "-pubkey").stdout != ossl("pkey", "-pubout", data=keys[sfx]).stdout:
        sys.exit(f"MTLS_KEY_{sfx}: does not match MTLS_CERT_{sfx}")
print("revmap ok")'

group_render() {
  need sops age age-keygen jq python3 openssl yq
  setup_keys
  fixture_ca
  render_repo
  local rc spec name e s sents=() line
  while IFS= read -r line; do sents+=("$line"); done < <(sentinel_env)
  sentinel_env >"$work/sentinels"
  mkdir -p "$work/rev"

  # 1 + 2. AC-8: reverse substitution on both real specs (file absent), every key reported github
  for s in "staging .do/app.dev.yaml xstockstrat-staging" "production .do/app.yaml xstockstrat-production"; do
    read -r e spec name <<<"$s"
    rnd "$e" "$PWD/$spec" "$name" "$work/r.yaml" "${sents[@]}" "LEGACY_MTLS_CA=$(cat "$work/ca_b64")" ||
      fail "1: render $spec failed ($(cat "$work/err"))"
    python3 -I -c "$REVMAP" "$spec" "$work/r.yaml" "$work/sentinels" "$work/ca/_ca/ca.pem" "$work/rev" "$FIXTURE_VPC" >/dev/null ||
      fail "1: reverse substitution of $spec"
    [ "$(yq e '.vpc.id' "$work/r.yaml")" = "$FIXTURE_VPC" ] || fail "AC-1: $spec rendered no top-level vpc.id"
    for k in $DO_PLAIN MTLS_CA; do
      [ "$(src "$k")" = github ] || fail "2: $spec $k source '$(src "$k")'"
    done
    [ "$(grep -o 'YOUR_[A-Z0-9_]*' "$work/r.yaml" | sort -u | tr '\n' ' ')" = "" ] || fail "6: $spec left a placeholder"
    [ "$(grep -c 'xstockstrat.CA_CERT' "$work/r.yaml")" = "$(grep -c 'xstockstrat.CA_CERT' "$spec")" ] ||
      fail "6: \${xstockstrat.CA_CERT} bindings changed in $spec"
    # shellcheck disable=SC2012 # the permission string is the assertion
    [ "$(ls -l "$work/r.yaml" | cut -c1-10)" = "-rw-------" ] || fail "5: $spec output is not owner-only"
    [ "$(sort "$work/ghout" | cut -d= -f1 | tr '\n' ' ')" = "app_name project_id " ] || fail "6: GITHUB_OUTPUT keys"
    grep -qx "app_name=$name" "$work/ghout" && grep -qx 'project_id=__S286_10__' "$work/ghout" || fail "6: GITHUB_OUTPUT values"
    while IFS='=' read -r _ v; do
      grep -qx "::add-mask::$v" "$work/out" || fail "6: $v not masked"
    done <"$work/sentinels"
    python3 -I -c 'import sys,re
out=set(open(sys.argv[2]).read().splitlines())
for l in open(sys.argv[1]):
    m=re.match(r"^\s+value: (\x22-----BEGIN.*\x22)\s*$", l)
    if m and "::add-mask::"+m.group(1) not in out: sys.exit("unmasked pem")' "$work/r.yaml" "$work/out" ||
      fail "6: a yaml_pem string is not masked"
    masks_first "6: $spec"
  done

  # 3. AC-9: SOPS value wins, a missing key falls back
  enc_json staging '{"common":{"JWT_SECRET":"jwt-sops"}}' "$work/repo/secrets/staging.enc.yaml"
  rnd staging "$PWD/.do/app.dev.yaml" xstockstrat-staging "$work/r.yaml" SOPS_AGE_KEY="$(cat "$work/keys/staging.key")" \
    LEGACY_BROKER_ACCOUNTS_ENCRYPTION_KEY=brk-gh LEGACY_CONFIG_SECRETS_ENCRYPTION_KEY=cfg-gh \
    "LEGACY_MTLS_CA=$(cat "$work/ca_b64")" LEGACY_SENDGRID_API_KEY=sg-gh || fail "3: render failed ($(cat "$work/err"))"
  grep -q 'value: jwt-sops$' "$work/r.yaml" && grep -q 'value: sg-gh$' "$work/r.yaml" || fail "3: values"
  rm -f "$work/repo/secrets/staging.enc.yaml"

  # 4. AC-10: a required key in neither store fails before --out exists
  rc=0
  rnd staging "$PWD/.do/app.dev.yaml" xstockstrat-staging "$work/r.yaml" LEGACY_JWT_SECRET=jwt-gh \
    LEGACY_BROKER_ACCOUNTS_ENCRYPTION_KEY=brk-gh "LEGACY_MTLS_CA=$(cat "$work/ca_b64")" || rc=$?
  [ "$rc" = 1 ] && grep -qF 'CONFIG_SECRETS_ENCRYPTION_KEY is in neither SOPS nor the GitHub secrets' "$work/err" ||
    fail "4: AC-10"
  [ ! -e "$work/r.yaml" ] || fail "4: --out was written"

  # 5. AC-11/AC-16: prod-up's render carries the SOPS JWT, VAPID public key and every mTLS leaf
  enc_json production "$(jq -n --arg ca "$(cat "$work/ca_b64")" '{common:{JWT_SECRET:"jwt-sops",VAPID_PUBLIC_KEY:"BPub",MTLS_CA:$ca}}')" \
    "$work/repo/secrets/production.enc.yaml"
  mkdir -p "$work/RUNNER_TEMP"
  rnd production "$PWD/.do/app.yaml" xstockstrat-production "$work/RUNNER_TEMP/app.yaml" \
    SOPS_AGE_KEY="$(cat "$work/keys/production.key")" LEGACY_BROKER_ACCOUNTS_ENCRYPTION_KEY=brk-gh \
    LEGACY_CONFIG_SECRETS_ENCRYPTION_KEY=cfg-gh || fail "5: render failed ($(cat "$work/err"))"
  grep -q 'value: jwt-sops$' "$work/RUNNER_TEMP/app.yaml" && grep -q 'value: BPub$' "$work/RUNNER_TEMP/app.yaml" || fail "5: values"
  if grep -qE 'YOUR_(DEV|PROD)_' "$work/RUNNER_TEMP/app.yaml"; then fail "5: a placeholder is left"; fi
  # shellcheck disable=SC2012
  [ "$(ls -l "$work/RUNNER_TEMP/app.yaml" | cut -c1-10)" = "-rw-------" ] || fail "5: not owner-only"
  rm -f "$work/repo/secrets/production.enc.yaml"

  # 6. targeted: OTEL prefix both ways, absent optional renders empty, name mismatch fails
  local req=(LEGACY_JWT_SECRET=jwt-gh LEGACY_BROKER_ACCOUNTS_ENCRYPTION_KEY=brk-gh
    LEGACY_CONFIG_SECRETS_ENCRYPTION_KEY=cfg-gh "LEGACY_MTLS_CA=$(cat "$work/ca_b64")")
  rnd staging "$PWD/.do/app.dev.yaml" xstockstrat-staging "$work/r.yaml" "${req[@]}" \
    "LEGACY_OTEL_EXPORTER_OTLP_HEADERS=Basic x" || fail "6: render failed"
  grep -q 'value: Authorization=Basic x$' "$work/r.yaml" || fail "6: OTEL prefix not added"
  grep -qE 'value: (""|)$' "$work/r.yaml" || fail "6: absent optional did not render empty"
  rnd staging "$PWD/.do/app.dev.yaml" xstockstrat-staging "$work/r.yaml" "${req[@]}" \
    "LEGACY_OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic x" || fail "6: render failed"
  grep -q 'value: Authorization=Basic x$' "$work/r.yaml" || fail "6: prefixed header changed"
  rc=0
  rnd staging "$PWD/.do/app.dev.yaml" xstockstrat-production "$work/r.yaml" "${req[@]}" || rc=$?
  [ "$rc" = 1 ] && [ ! -e "$work/r.yaml" ] || fail "6: --app-name mismatch accepted"

  # 7. AC-2: an unfillable YOUR_VPC_ID fails before any secret is resolved or --out exists
  grep -v -e '^vpc:$' -e '^  id: YOUR_VPC_ID$' .do/app.dev.yaml >"$work/novpc.yaml"
  sed 's/^  id: YOUR_VPC_ID$/  id: YOUR_VPC_ID # YOUR_VPC_ID/' .do/app.dev.yaml >"$work/twovpc.yaml"
  for s in "empty|$PWD/.do/app.dev.yaml|" "bad|$PWD/.do/app.dev.yaml|not-a-uuid" \
    "upper|$PWD/.do/app.dev.yaml|D7AFFF57-F807-4893-9FBF-20FFF8BB82DD" \
    "deleted|$work/novpc.yaml|$FIXTURE_VPC" "doubled|$work/twovpc.yaml|$FIXTURE_VPC"; do
    IFS='|' read -r e spec line <<<"$s"
    rc=0
    RND_VPC="$line" rnd staging "$spec" xstockstrat-staging "$work/r.yaml" "${req[@]}" || rc=$?
    [ "$rc" = 1 ] || fail "AC-2 $e: exited $rc ($(cat "$work/err"))"
    grep -qF YOUR_VPC_ID "$work/err" || fail "AC-2 $e: stderr does not name YOUR_VPC_ID"
    grep '^::error::' "$work/out" | grep -qF YOUR_VPC_ID || fail "AC-2 $e: ::error:: does not name YOUR_VPC_ID"
    [ ! -e "$work/r.yaml" ] || fail "AC-2 $e: --out was written"
    ! grep -q '^::add-mask::' "$work/out" || fail "AC-2 $e: secrets were resolved before the VPC check"
  done

  # 8. a leftover-looking value is reported by count only, never echoed
  rc=0
  rnd staging "$PWD/.do/app.dev.yaml" xstockstrat-staging "$work/r.yaml" "${req[@]}" \
    LEGACY_SLACK_WEBHOOK_URL=YOUR_PROD_LEAKED || rc=$?
  [ "$rc" = 1 ] && [ ! -e "$work/r.yaml" ] || fail "8: a leftover-looking value rendered (rc $rc)"
  {
    grep '^::error::' "$work/out"
    cat "$work/err"
  } >"$work/leak"
  grep -qF 'placeholder-like token(s) remain' "$work/leak" && grep -qF 'values withheld' "$work/leak" ||
    fail "8: leftover count message ($(cat "$work/leak"))"
  ! grep -qF YOUR_PROD_LEAKED "$work/leak" || fail "8: the leftover value was echoed"
  echo "render: ok"
}

# expected_legacy <format|prod|homelab|bootstrap>: the exact LEGACY_* lines a workflow must carry, derived from KEYS.
expected_legacy() {
  python3 - "$1" <<'PY'
import sys
sys.path.insert(0, "scripts")
import sops_secrets as s
mode = sys.argv[1]
target = s.HOMELAB if mode == "homelab" else s.DO
ns_of = {n: ns for ns, n, _, _ in s.KEYS}
prefix = "matrix.prefix" if mode == "bootstrap" else "env.P"
for legacy in s.legacy_names(target):
    k = legacy.removeprefix("LEGACY_")
    k = "app_env" if k == "APP_ENV" and target == s.HOMELAB else k
    if mode == "prod":
        rhs = "secrets.DO_PROD_PROJECT_ID" if k == "PROJECT_ID" else f"secrets.PROD_{k}"
    elif ns_of[k] == "homelab":
        rhs = "vars.TS_AUTHKEY_EXPIRES" if k == "TS_AUTHKEY_EXPIRES" else f"secrets.{legacy.removeprefix('LEGACY_')}"
    elif k == "PROJECT_ID":
        rhs = f"secrets[format('DO_{{0}}_PROJECT_ID', {prefix})]"
    else:
        rhs = f"secrets[format('{{0}}_{k}', {prefix})]"
    print(f"{legacy}: ${{{{ {rhs} }}}}")
PY
}
# check_legacy <file> <mode> <case>: every LEGACY_ line exactly as expected, each name once.
check_legacy() {
  local want got
  want="$(expected_legacy "$2" | sort)"
  got="$(grep -E '^[[:space:]]*LEGACY_[A-Z0-9_]+:' "$1" | sed -E 's/^[[:space:]]+//' | sort)"
  [ -n "$want" ] && [ "$got" = "$want" ] || fail "$3: LEGACY_ lines in $1 differ from KEYS:
$(diff <(printf '%s\n' "$want") <(printf '%s\n' "$got"))"
}
COMMON_RE='JWT_SECRET|BROKER_ACCOUNTS_ENCRYPTION_KEY|CONFIG_SECRETS_ENCRYPTION_KEY|MTLS_CA|SLACK_WEBHOOK_URL|SENDGRID_API_KEY|VAPID_PRIVATE_KEY|VAPID_PUBLIC_KEY|VAPID_SUBJECT|OTEL_EXPORTER_OTLP_ENDPOINT|OTEL_EXPORTER_OTLP_HEADERS'
P_EXPR="\${{ inputs.environment == 'production' && 'PROD' || 'DEV' }}"
check_p() {
  [ "$(grep -cE '^[[:space:]]*P:' "$1")" = 1 ] || fail "$2: expected exactly one P: line in $1"
  [ "$(yq e ".jobs.$3.env.P" "$1")" = "$P_EXPR" ] || fail "$2: job $3 env P in $1"
}
no_unprefixed() {
  if grep -nE "secrets\.($COMMON_RE)\b" "$1"; then fail "$2: unprefixed common secret in $1"; fi
}

group_deploy() {
  need yq python3
  local wf=.github/workflows/deploy.yml f run rows rc e wait phase polls
  for f in "$wf" .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml; do
    yq e 'true' "$f" >/dev/null || fail "deploy: $f does not parse"
  done
  check_legacy "$wf" format deploy
  check_p "$wf" deploy deploy
  no_unprefixed "$wf" deploy
  if grep -nE 'DO_(DEV_|PROD_)?APP_ID' "$wf"; then fail "deploy: DO_*APP_ID still in $wf"; fi
  [ "$(yq e '.on.workflow_call | has("secrets")' "$wf")" = false ] || fail "deploy: workflow_call still declares secrets"
  [ "$(yq e '.on.workflow_call.inputs.environment.required' "$wf")" = true ] || fail "deploy: environment input"
  # shellcheck disable=SC2016 # the literal expression is asserted
  [ "$(yq e '.jobs.deploy.environment' "$wf")" = '${{ inputs.environment }}' ] || fail "deploy: job environment binding"
  [ "$(yq e '.jobs.validate | has("environment")' "$wf")" = false ] || fail "deploy: validate must have no environment"
  [ "$(yq e '.jobs.deploy.needs' "$wf")" = validate ] || fail "deploy: deploy must need validate"
  # AC-2: deploys to one DO app serialise on a job-level group that is defined here only
  # shellcheck disable=SC2016 # the literal expression is asserted
  [ "$(yq e '.jobs.deploy.concurrency.group' "$wf")" = 'deploy-${{ inputs.environment }}' ] || fail "AC-2: deploy job concurrency group"
  [ "$(yq e '.jobs.deploy.concurrency.cancel-in-progress' "$wf")" = false ] || fail "AC-2: cancel-in-progress must be false (never abort an in-flight deployment)"
  [ "$(yq e '.jobs.validate | has("concurrency")' "$wf")" = false ] || fail "AC-2: validate must not carry the deploy group"
  [ "$(yq e 'has("concurrency")' "$wf")" = false ] || fail "AC-2: no workflow-level concurrency in the reusable workflow"
  # AC-17/AC-21: the real resolve-app-id step against a stub doctl
  run="$(yq e '.jobs.deploy.steps[] | select(.id == "resolve-app-id") | .run' "$wf")"
  [ -n "$run" ] && [ "$run" != null ] || fail "deploy: no resolve-app-id step"
  printf '%s\n' "$run" >"$work/appid.sh"
  mkdir -p "$work/stub"
  for rows in 0 1 2; do
    {
      echo '#!/bin/sh'
      echo 'echo "x9 xstockstrat-production"'
      [ "$rows" -ge 1 ] && echo 'echo "app-new xstockstrat-staging"'
      [ "$rows" -ge 2 ] && echo 'echo "app-two xstockstrat-staging"'
    } >"$work/stub/doctl"
    chmod +x "$work/stub/doctl"
    rm -f "$work/genv" "$work/gsum"
    rc=0
    env -i PATH="$work/stub:$PATH" HOME="$HOME" APP_NAME=xstockstrat-staging GITHUB_ENV="$work/genv" \
      GITHUB_STEP_SUMMARY="$work/gsum" bash -eo pipefail "$work/appid.sh" >"$work/aout" 2>&1 || rc=$?
    case "$rows" in
    1)
      [ "$rc" = 0 ] || fail "AC-17: 1 match exited $rc ($(cat "$work/aout"))"
      grep -qx 'APP_ID=app-new' "$work/genv" || fail "AC-17: APP_ID not exported"
      grep -qF 'app: xstockstrat-staging → app-new' "$work/gsum" || fail "AC-17: summary line"
      ;;
    *)
      [ "$rc" != 0 ] || fail "AC-21: $rows matches accepted"
      grep -qF "expected exactly 1 app named xstockstrat-staging, found $rows" "$work/aout" || fail "AC-21: message for $rows"
      ;;
    esac
  done
  # AC-2: the VPC lookup feeds the render, which precedes the update; nothing soft-fails
  local db_i render_i upd_i
  db_i="$(yq e '.jobs.deploy.steps | to_entries | .[] | select(.value.id == "db") | .key' "$wf")"
  render_i="$(yq e '.jobs.deploy.steps | to_entries | .[] | select(.value.id == "render") | .key' "$wf")"
  upd_i="$(yq e '.jobs.deploy.steps | to_entries | .[] | select(.value.run // "" | test("doctl apps update")) | .key' "$wf")"
  [ -n "$db_i" ] && [ -n "$render_i" ] && [ -n "$upd_i" ] || fail "deploy: db / render / update step missing"
  [ "$db_i" -lt "$render_i" ] && [ "$render_i" -lt "$upd_i" ] || fail "deploy: order must be db < render < update"
  db_wiring "$wf" deploy deploy '${{ inputs.app_spec }}'
  # AC-1: the real "Wait for deployment" step against stub doctl/sleep, one run per DO phase
  wait="$(yq e '.jobs.deploy.steps[] | select(.name == "Wait for deployment") | .run' "$wf")"
  [ -n "$wait" ] && [ "$wait" != null ] || fail "deploy: no Wait for deployment step"
  printf '%s\n' "$wait" >"$work/wait.sh"
  {
    echo '#!/bin/sh'
    echo 'case "$2" in'
    echo '  list-deployments) echo dep-1 ;;'
    echo "  get-deployment) echo x >>\"$work/polls\"; echo \"\$STUB_PHASE\" ;;"
    echo 'esac'
  } >"$work/stub/doctl"
  printf '#!/bin/sh\necho x >>"%s/sleeps"\n' "$work" >"$work/stub/sleep"
  chmod +x "$work/stub/doctl" "$work/stub/sleep"
  for phase in SUPERSEDED ACTIVE ERROR CANCELED BUILDING; do
    : >"$work/polls"
    : >"$work/sleeps"
    rc=0
    env -i PATH="$work/stub:$PATH" HOME="$HOME" APP_ID=app-1 STUB_PHASE="$phase" \
      bash -eo pipefail "$work/wait.sh" >"$work/wout" 2>&1 || rc=$?
    polls="$(wc -l <"$work/polls" | tr -d ' ')"
    case "$phase" in
    SUPERSEDED)
      [ "$rc" = 0 ] || fail "AC-1: SUPERSEDED exited $rc after $polls polls ($(tail -1 "$work/wout"))"
      [ "$polls" = 1 ] && [ ! -s "$work/sleeps" ] || fail "AC-1: SUPERSEDED did not end the loop on its first poll ($polls polls)"
      if grep -qF 'Timeout:' "$work/wout"; then fail "AC-1: SUPERSEDED reached the timeout"; fi
      grep -qF '::warning::' "$work/wout" || fail "AC-1: SUPERSEDED must emit a ::warning::"
      ;;
    ACTIVE)
      [ "$rc" = 0 ] && [ "$polls" = 1 ] || fail "AC-1: ACTIVE exited $rc after $polls polls"
      ;;
    ERROR | CANCELED)
      [ "$rc" = 1 ] && [ "$polls" = 1 ] || fail "AC-1: $phase exited $rc after $polls polls"
      grep -qF "Deployment failed with phase: $phase" "$work/wout" || fail "AC-1: $phase failure message"
      ;;
    BUILDING)
      [ "$rc" = 1 ] && [ "$polls" = 60 ] || fail "AC-1: BUILDING exited $rc after $polls polls"
      grep -qF 'Timeout: deployment did not complete within 15 minutes.' "$work/wout" || fail "AC-1: BUILDING timeout message"
      ;;
    esac
  done
  # callers: secrets inherit + environment; homelab caller jobs and their gates intact
  for e in staging production; do
    f=.github/workflows/deploy-dev.yml
    [ "$e" = production ] && f=.github/workflows/deploy-prod.yml
    [ "$(yq e '.jobs.deploy | has("concurrency")' "$f")" = false ] && [ "$(yq e 'has("concurrency")' "$f")" = false ] ||
      fail "AC-2: $f must not define its own concurrency (the group lives in deploy.yml)"
    [ "$(yq e '.jobs.deploy.secrets' "$f")" = inherit ] || fail "deploy: $f job deploy must use secrets: inherit"
    [ "$(yq e '.jobs.deploy.with.environment' "$f")" = "$e" ] || fail "deploy: $f with.environment"
    if grep -nE 'DO_(DEV|PROD)_APP_ID' "$f"; then fail "deploy: $f still passes the app ID"; fi
    [ "$(yq e '.jobs.deploy-homelab.uses' "$f")" = ./.github/workflows/deploy-homelab.yml ] || fail "deploy: $f homelab uses"
    [ "$(yq e '.jobs.deploy-homelab.secrets' "$f")" = inherit ] || fail "deploy: $f homelab secrets"
    [ "$(yq e '.jobs.deploy-homelab.with.environment' "$f")" = "$e" ] || fail "deploy: $f homelab environment"
  done
  [ "$(yq e '.jobs.deploy-homelab.if' .github/workflows/deploy-dev.yml)" = "vars.HOMELAB_STAGING_ENABLED == 'true'" ] ||
    fail "deploy: deploy-dev homelab gate"
  [ "$(yq e '.jobs.deploy-homelab.if' .github/workflows/deploy-prod.yml)" = "vars.HOMELAB_PRODUCTION_ENABLED == 'true'" ] ||
    fail "deploy: deploy-prod homelab gate"
  echo "deploy: ok"
}

# db_wiring <wf> <job> <label> <SPEC>: a hard-failing lookup step feeds --vpc-id to the render step.
db_wiring() {
  local wf="$1" j="$2" l="$3" sel
  sel=".jobs.$j.steps[] | select(.id == \"db\")"
  [ "$(yq e "$sel | has(\"continue-on-error\")" "$wf")" = false ] || fail "$l: db step must not continue-on-error"
  [ "$(yq e "$sel | has(\"if\")" "$wf")" = false ] || fail "$l: db step must not be gated"
  [ "$(yq e "$sel | .env.SPEC" "$wf")" = "$4" ] || fail "$l: db env.SPEC"
  yq e "$sel | .run" "$wf" | grep -qF 'do-db-cluster.sh lookup' || fail "$l: db step must run do-db-cluster.sh lookup"
  ! yq e "$sel | .run" "$wf" | grep -qF '${{' || fail "$l: db run inlines an expression"
  [ "$(yq e ".jobs.$j.steps[] | select(.id == \"render\") | .env.VPC_ID" "$wf")" = '${{ steps.db.outputs.vpc_id }}' ] ||
    fail "$l: render env.VPC_ID"
  yq e ".jobs.$j.steps[] | select(.id == \"render\") | .run" "$wf" | grep -qF -- '--vpc-id "$VPC_ID"' ||
    fail "$l: render must pass --vpc-id \"\$VPC_ID\""
}

# step_idx <wf> <job> <yq-predicate on .value>: the index of the one step matching it.
step_idx() {
  yq e ".jobs.$2.steps | to_entries | .[] | select($3) | .key" "$1"
}

# wait_stub: a stateful doctl for prod-up's check/wait runs (LIST_SEQ / PHASES advance per call; "-" = empty).
wait_stub() {
  mkdir -p "$work/stub"
  cat >"$work/stub/doctl" <<'EOF2'
#!/bin/sh
echo "$*" >>"$W/wlog"
nth() {
  n=$(($(cat "$W/$1.n" 2>/dev/null || echo 0) + 1))
  echo "$n" >"$W/$1.n"
  echo "$2" | awk -v n="$n" '{ print (n <= NF) ? $n : $NF }'
}
case "$1 $2" in
"apps list")
  cat "$W/apps.txt"
  ;;
"apps list-deployments")
  v=$(nth list "$LIST_SEQ")
  [ "$v" = - ] || echo "$v"
  ;;
"apps get-deployment")
  nth phase "$PHASES"
  ;;
"apps create-deployment")
  [ "${CREATE_RC:-0}" = 0 ] || exit "$CREATE_RC"
  [ -z "${CREATE_OUT-new1}" ] || echo "${CREATE_OUT-new1}"
  ;;
*)
  echo "stub doctl: unexpected $*" >&2
  exit 99
  ;;
esac
EOF2
  chmod +x "$work/stub/doctl"
  printf '#!/bin/sh\n' >"$work/stub/sleep"
  chmod +x "$work/stub/sleep"
}

# wrun <script> [VAR=value ...]: run an extracted prod-up/prod-down step the way Actions does (bash -e).
wrun() {
  local sh="$1"
  shift
  rm -f "$work/wlog" "$work/list.n" "$work/phase.n" "$work/wout"
  : >"$work/wlog"
  rc=0
  env -i PATH="$work/stub:$PATH" HOME="$HOME" W="$work" GITHUB_OUTPUT="$work/wout" \
    GITHUB_STEP_SUMMARY="$work/wsum" "$@" bash -e "$sh" >"$work/wso" 2>&1 || rc=$?
}

# produp_lifecycle <wf>: AC-3 — trust the app, then wait with at most one gated redeploy.
produp_lifecycle() {
  local wf="$1" j=up i prev n id k sel c
  local app_expr='${{ steps.create.outputs.app_id || steps.check.outputs.app_id }}'
  local gate="steps.create.outputs.app_id != '' || steps.trust.outputs.appended == 'true'"
  prev=-1
  for sel in '.value.id == "check"' '.value.id == "db"' '.value.uses == "./.github/actions/setup-sops"' \
    '.value.id == "render"' '.value.id == "create"' '.value.id == "assign"' '.value.id == "trust"' \
    '.value.id == "wait"' '.value.id == "report"' '.value.if == "always()"'; do
    i="$(step_idx "$wf" "$j" "$sel")"
    [ -n "$i" ] && [ "$i" -gt "$prev" ] || fail "produp: step order broken at $sel"
    prev="$i"
  done
  sel='.jobs.up.steps[] | select(.id == "trust")'
  [ "$(yq e "$sel | .env.APP_ID" "$wf")" = "$app_expr" ] || fail "produp: trust env.APP_ID"
  [ "$(yq e "$sel | .env.CLUSTER_ID" "$wf")" = '${{ steps.db.outputs.cluster_id }}' ] || fail "produp: trust env.CLUSTER_ID"
  yq e "$sel | .run" "$wf" | grep -qF 'do-db-cluster.sh trust "$CLUSTER_ID" "$APP_ID"' || fail "produp: trust run"
  [ "$(yq e "$sel | has(\"continue-on-error\") or has(\"if\")" "$wf")" = false ] || fail "produp: trust must be ungated and hard"
  for id in wait report; do
    sel=".jobs.up.steps[] | select(.id == \"$id\")"
    [ "$(yq e "$sel | .if" "$wf")" = "$gate" ] || fail "produp: $id if"
    [ "$(yq e "$sel | .env.APP_ID" "$wf")" = "$app_expr" ] || fail "produp: $id env.APP_ID"
    ! yq e "$sel | .run" "$wf" | grep -qF '${{' || fail "produp: $id run inlines an expression"
  done
  sel='.jobs.up.steps[] | select(.id == "wait")'
  [ "$(yq e "$sel | .env.CREATED" "$wf")" = '${{ steps.create.outputs.app_id }}' ] || fail "produp: wait env.CREATED"
  [ "$(yq e "$sel | .env.APPENDED" "$wf")" = '${{ steps.trust.outputs.appended }}' ] || fail "produp: wait env.APPENDED"
  [ "$(yq e "$sel | has(\"shell\")" "$wf")" = false ] || fail "produp: wait must use the default bash -e shell"

  wait_stub
  # check: 0 / 1 / 2 existing apps
  yq e '.jobs.up.steps[] | select(.id == "check") | .run' "$wf" >"$work/check.sh"
  for n in 0 1 2; do
    : >"$work/apps.txt"
    for k in $(seq 1 "$n"); do echo "app$k xstockstrat-production" >>"$work/apps.txt"; done
    echo "x9 xstockstrat-staging" >>"$work/apps.txt"
    wrun "$work/check.sh"
    case "$n" in
    0) [ "$rc" = 0 ] && grep -qx 'app_id=' "$work/wout" || fail "produp: check with no app ($(cat "$work/wso"))" ;;
    1)
      [ "$rc" = 0 ] && grep -qx 'app_id=app1' "$work/wout" || fail "produp: check with one app"
      grep -qF 'already exists — ensuring it is a trusted source; redeploys only if the rule was just added and the latest deployment failed' \
        "$work/wso" || fail "produp: check existing-app message"
      ;;
    2) [ "$rc" != 0 ] && grep -qF 'expected at most 1 app named xstockstrat-production, found 2' "$work/wso" ||
      fail "produp: check accepted two apps" ;;
    esac
  done
  # wait: <label> <rc> <creates> LIST_SEQ PHASES [VAR=value ...]
  yq e '.jobs.up.steps[] | select(.id == "wait") | .run' "$wf" >"$work/wait.sh"
  while IFS='|' read -r c k n i id extra; do
    [ -n "$c" ] || continue
    # shellcheck disable=SC2086 # extra is a list of VAR=value words
    wrun "$work/wait.sh" APP_ID=app1 LIST_SEQ="$i" PHASES="$id" $extra
    [ "$rc" = "$k" ] || fail "produp: wait $c exited $rc, want $k ($(cat "$work/wso"))"
    [ "$(grep -c '^apps create-deployment' "$work/wlog")" = "$n" ] || fail "produp: wait $c made $(grep -c '^apps create-deployment' "$work/wlog") redeploys, want $n"
  done <<'CASES'
active|0|0|d1|ACTIVE|CREATED=app1
error-created|0|1|d1|ERROR ACTIVE|CREATED=app1
error-appended|0|1|d1|ERROR ACTIVE|APPENDED=true
error-unchanged|1|0|d1|ERROR|APPENDED=false
error-twice|1|1|d1|ERROR ERROR|CREATED=app1
superseded|0|0|d1 d2|SUPERSEDED ACTIVE|CREATED=app1
canceled|1|0|d1|CANCELED|CREATED=app1
create-fails|3|1|d1|ERROR|CREATED=app1 CREATE_RC=3
create-empty|1|1|d1|ERROR|CREATED=app1 CREATE_OUT=
late-list|0|0|- - d1|ACTIVE|CREATED=app1
never-listed|1|0|-|ACTIVE|CREATED=app1
CASES
  wrun "$work/wait.sh" APP_ID=app1 LIST_SEQ=d1 PHASES="ERROR ACTIVE" CREATED=app1
  grep -qF 'apps get-deployment app1 new1 --format Phase' "$work/wlog" || fail "produp: wait must follow the redeployment it created"
  wrun "$work/wait.sh" APP_ID=app1 LIST_SEQ="d1 d2" PHASES="SUPERSEDED ACTIVE" CREATED=app1
  grep -qF 'apps get-deployment app1 d2 --format Phase' "$work/wlog" || fail "produp: wait must follow the newest deployment after SUPERSEDED"
  wrun "$work/wait.sh" APP_ID=app1 LIST_SEQ=d1 PHASES=PENDING_DEPLOY CREATED=app1
  [ "$rc" = 0 ] && grep -q '^::warning::' "$work/wso" || fail "produp: wait timeout must warn and exit 0"
  [ "$(grep -c '^apps get-deployment' "$work/wlog")" = 60 ] || fail "produp: wait must poll 60 times"
}

CHECKOUT_PIN='actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'
DOCTL_PIN='digitalocean/action-doctl@3cb3953159719656269e044e0e24ca16dd2a690f'

group_produp() {
  need yq python3
  local wf=.github/workflows/prod-up.yml
  yq e 'true' "$wf" >/dev/null || fail "produp: $wf does not parse"
  check_legacy "$wf" prod produp
  [ "$(yq e '.jobs.up.environment' "$wf")" = production ] || fail "produp: job up must bind environment production"
  [ "$(yq e '.jobs.up.permissions.contents' "$wf")" = read ] || fail "produp: permissions contents: read"
  [ "$(yq e '[.jobs.up.steps[].uses | select(. != null)] | join(" ")' "$wf")" = \
    "$CHECKOUT_PIN $DOCTL_PIN ./.github/actions/setup-sops" ] || fail "produp: action pins / setup-sops"
  grep -qF 'python3 scripts/do-render-app-spec.py' "$wf" || fail "produp: renderer not called"
  for a in '--env production' '--spec .do/app.yaml' '--app-name xstockstrat-production' '--out "$RUNNER_TEMP/app.yaml"'; do
    grep -qF -- "$a" "$wf" || fail "produp: render argument $a"
  done
  grep -qF 'doctl apps create --spec "$RUNNER_TEMP/app.yaml"' "$wf" || fail "produp: create from \$RUNNER_TEMP/app.yaml"
  [ "$(yq e '[.jobs.up.steps[] | select(.if == "always()") | .run] | join("")' "$wf")" = 'rm -f "$RUNNER_TEMP/app.yaml"' ] ||
    fail "produp: always-run spec removal"
  if grep -nE 'do-inject-prod-secrets|DO_PROD_APP_ID|MCP_AGENT_SECRET' "$wf"; then fail "produp: a retired name remains"; fi
  no_unprefixed "$wf" produp
  [ ! -e scripts/do-inject-prod-secrets.py ] || fail "produp: scripts/do-inject-prod-secrets.py still exists"
  # AC-2: prod-up looks up the VPC before setup-sops and the render
  local check_i db_i sops_i render_i
  check_i="$(yq e '.jobs.up.steps | to_entries | .[] | select(.value.id == "check") | .key' "$wf")"
  db_i="$(yq e '.jobs.up.steps | to_entries | .[] | select(.value.id == "db") | .key' "$wf")"
  sops_i="$(yq e '.jobs.up.steps | to_entries | .[] | select(.value.uses == "./.github/actions/setup-sops") | .key' "$wf")"
  render_i="$(yq e '.jobs.up.steps | to_entries | .[] | select(.value.id == "render") | .key' "$wf")"
  [ -n "$db_i" ] || fail "produp: no db step"
  [ "$check_i" -lt "$db_i" ] && [ "$db_i" -lt "$sops_i" ] && [ "$sops_i" -lt "$render_i" ] ||
    fail "produp: order must be check < db < setup-sops < render"
  db_wiring "$wf" up produp .do/app.yaml
  produp_lifecycle "$wf"
  echo "produp: ok"
}

group_homelab() {
  need yq python3
  local wf=.github/workflows/deploy-homelab.yml resolve_ln detach_ln
  yq e 'true' "$wf" >/dev/null || fail "homelab: $wf does not parse"
  if grep -nE '\bop\b|\bOP_' "$wf"; then fail "homelab: AC-12 op/OP_ reference remains"; fi
  if grep -niE '1password|load-secrets-action' "$wf"; then fail "homelab: AC-12 1Password reference remains"; fi
  check_legacy "$wf" homelab homelab
  check_p "$wf" homelab deploy
  no_unprefixed "$wf" homelab
  [ "$(yq e '.jobs.validate | has("environment")' "$wf")" = false ] || fail "homelab: validate must have no environment"
  [ "$(yq e '.jobs.deploy.needs' "$wf")" = validate ] || fail "homelab: deploy must need validate"
  resolve_ln="$(grep -n 'sops_secrets.py resolve' "$wf" | head -1 | cut -d: -f1)"
  detach_ln="$(grep -n 'git checkout --quiet --detach' "$wf" | head -1 | cut -d: -f1)"
  [ -n "$resolve_ln" ] && [ -n "$detach_ln" ] && [ "$resolve_ln" -lt "$detach_ln" ] ||
    fail "homelab: resolve must run before the image-commit detach"
  if tail -n "+$resolve_ln" "$wf" | grep -nE '^[[:space:]]*(-[[:space:]]+)?uses:'; then
    fail "homelab: a uses: step runs after resolve"
  fi
  echo "homelab: ok"
}

UPLOAD_PIN='actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9'
DOWNLOAD_PIN='actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131'

group_bootstrap() {
  need yq python3
  local wf=.github/workflows/sops-bootstrap.yml a
  [ -f "$wf" ] || fail "bootstrap: $wf does not exist"
  yq e 'true' "$wf" >/dev/null || fail "bootstrap: $wf does not parse"
  [ "$(yq e '.on.workflow_dispatch.inputs.force.type' "$wf")" = boolean ] || fail "bootstrap: force must be a boolean input"
  [ "$(yq e '.permissions.contents' "$wf")" = read ] || fail "bootstrap: workflow permissions contents: read"
  [ "$(yq -o=json -I=0 e '.jobs.seed.strategy.matrix.include' "$wf")" = \
    '[{"environment":"staging","prefix":"DEV"},{"environment":"production","prefix":"PROD"}]' ] || fail "bootstrap: matrix pairs"
  [ "$(yq e '.jobs.seed.strategy.matrix | keys | join(",")' "$wf")" = include ] || fail "bootstrap: matrix has extra axes"
  [ "$(yq e '.jobs.seed.strategy.fail-fast' "$wf")" = true ] || fail "bootstrap: fail-fast"
  # shellcheck disable=SC2016
  [ "$(yq e '.jobs.seed.environment' "$wf")" = '${{ matrix.environment }}' ] || fail "bootstrap: seed environment binding"
  check_legacy "$wf" bootstrap bootstrap
  grep -qF 'SOPS_OPERATOR_AGE_RECIPIENT: ${{ vars.SOPS_OPERATOR_AGE_RECIPIENT }}' "$wf" || fail "bootstrap: operator recipient var"
  [ "$(yq e '.jobs.seed.steps[] | select(.uses == "'"$UPLOAD_PIN"'") | .with.retention-days' "$wf")" = 1 ] ||
    fail "bootstrap: pinned upload-artifact with retention-days 1"
  [ "$(yq e '.jobs.pr.needs' "$wf")" = seed ] || fail "bootstrap: pr must need seed"
  for a in 'GH_PAT is required' "$DOWNLOAD_PIN" 'scripts/sops_secrets.py sops-config' \
    'git push --force-with-lease origin chore/sops-bootstrap' 'gh pr create --base main-dev' 'GH_TOKEN: ${{ secrets.GH_PAT }}'; do
    grep -qF -- "$a" "$wf" || fail "bootstrap: missing '$a'"
  done
  [ "$(yq e '.jobs.pr.steps[] | select(.uses == "'"$CHECKOUT_PIN"'") | .with.ref' "$wf")" = main-dev ] ||
    fail "bootstrap: pr checks out main-dev"
  if grep -nE 'git push[^#]*[[:space:]](main-dev|main)([[:space:]]|$)' "$wf"; then fail "bootstrap: F-02 push to a trunk"; fi
  echo "bootstrap: ok"
}

group_ac24() {
  local f files=(scripts/do-render-app-spec.py scripts/sops_secrets.py .github/workflows/sops-bootstrap.yml
    .github/workflows/deploy.yml .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml
    .github/workflows/deploy-homelab.yml .github/workflows/prod-up.yml .do/app.yaml .do/app.dev.yaml)
  for f in secrets/*.enc.yaml; do [ -f "$f" ] && files+=("$f"); done
  for f in "${files[@]}"; do
    [ -f "$f" ] || fail "ac24: $f does not exist"
    if grep -n MCP_AGENT_SECRET "$f"; then fail "ac24: MCP_AGENT_SECRET in $f"; fi
  done
  [ ! -e scripts/do-inject-prod-secrets.py ] || fail "ac24: scripts/do-inject-prod-secrets.py still exists"
  echo "ac24: ok"
}

group_cleanup() {
  if grep -nE 'DO_(DEV|PROD)_APP_ID' .do/app.yaml .do/app.dev.yaml scripts/do-setup-check.sh; then
    fail "cleanup: DO_*_APP_ID still referenced"
  fi
  grep -qx 'REQUIRED_SECRETS=(DIGITALOCEAN_ACCESS_TOKEN BUF_TOKEN)' scripts/do-setup-check.sh || fail "cleanup: REQUIRED_SECRETS"
  local hdr
  hdr="$(sed -n 1,20p scripts/mtls-provision.sh)"
  grep -q 'common\.MTLS_CA' <<<"$hdr" || fail "cleanup: mtls-provision header must name common.MTLS_CA"
  grep -qiE 'DO and homelab|homelab and DO' <<<"$hdr" || fail "cleanup: mtls-provision header must say DO and homelab share the CA"
  if grep -qF 'DEV_MTLS_CA / PROD_MTLS_CA' <<<"$hdr"; then
    fail "cleanup: mtls-provision header still presents DEV_/PROD_MTLS_CA as the CA store"
  fi
  echo "cleanup: ok"
}

# group_proddown: AC-4 — teardown deletes the app first, then best-effort removes only its trusted-source rule.
group_proddown() {
  need yq python3
  local wf=.github/workflows/prod-down.yml j=down prev=-1 i sel id n k
  local app_expr='${{ steps.find.outputs.app_id }}' has_app="steps.find.outputs.app_id != ''"
  yq e 'true' "$wf" >/dev/null || fail "proddown: $wf does not parse"
  [ "$(yq e '[.jobs.down.steps[].uses | select(. != null)] | join(" ")' "$wf")" = "$CHECKOUT_PIN $DOCTL_PIN" ] ||
    fail "proddown: action pins"
  [ "$(yq e '.jobs.down.permissions.contents' "$wf")" = read ] || fail "proddown: permissions contents: read"
  [ "$(yq e '.jobs.down.if' "$wf")" = "\${{ inputs.confirm == 'destroy-prod' }}" ] || fail "proddown: confirm gate"
  for id in find delete db untrust summary; do
    i="$(step_idx "$wf" "$j" ".value.id == \"$id\"")"
    [ -n "$i" ] && [ "$i" -gt "$prev" ] || fail "proddown: step order broken at $id"
    prev="$i"
    ! yq e ".jobs.down.steps[] | select(.id == \"$id\") | .run" "$wf" | grep -qF '${{' ||
      fail "proddown: $id run inlines an expression"
  done
  sel='.jobs.down.steps[] | select(.id == "delete")'
  [ "$(yq e "$sel | .if" "$wf")" = "$has_app" ] || fail "proddown: delete if"
  [ "$(yq e "$sel | has(\"continue-on-error\")" "$wf")" = false ] || fail "proddown: delete must fail hard"
  [ "$(yq e "$sel | .env.APP_ID" "$wf")" = "$app_expr" ] || fail "proddown: delete env.APP_ID"
  yq e "$sel | .run" "$wf" | grep -qF 'doctl apps delete "$APP_ID" --force' || fail "proddown: delete run"
  sel='.jobs.down.steps[] | select(.id == "db")'
  [ "$(yq e "$sel | .continue-on-error" "$wf")" = true ] || fail "proddown: db must be best-effort"
  [ "$(yq e "$sel | .if" "$wf")" = "$has_app" ] || fail "proddown: db if"
  [ "$(yq e "$sel | .env.SPEC" "$wf")" = .do/app.yaml ] || fail "proddown: db env.SPEC"
  yq e "$sel | .run" "$wf" | grep -qF 'do-db-cluster.sh lookup' || fail "proddown: db run"
  sel='.jobs.down.steps[] | select(.id == "untrust")'
  [ "$(yq e "$sel | .continue-on-error" "$wf")" = true ] || fail "proddown: untrust must be best-effort"
  [ "$(yq e "$sel | .if" "$wf")" = "$has_app && steps.db.outputs.cluster_id != ''" ] || fail "proddown: untrust if"
  [ "$(yq e "$sel | .env.APP_ID" "$wf")" = "$app_expr" ] || fail "proddown: untrust env.APP_ID"
  [ "$(yq e "$sel | .env.CLUSTER_ID" "$wf")" = '${{ steps.db.outputs.cluster_id }}' ] || fail "proddown: untrust env.CLUSTER_ID"
  yq e "$sel | .run" "$wf" | grep -qF 'do-db-cluster.sh untrust "$CLUSTER_ID" "$APP_ID"' || fail "proddown: untrust run"
  sel='.jobs.down.steps[] | select(.id == "summary")'
  [ "$(yq e "$sel | .if" "$wf")" = "always() && $has_app && steps.delete.outcome == 'success' && steps.untrust.outcome != 'success'" ] ||
    fail "proddown: summary if"
  [ "$(yq e "$sel | .env.DB_OUTCOME" "$wf")" = '${{ steps.db.outcome }}' ] || fail "proddown: summary env.DB_OUTCOME"
  if grep -nE 'doctl databases (delete|resize|migrate|db delete|pool delete|user delete)|firewalls (append|replace)' "$wf"; then
    fail "proddown: a cluster-mutating doctl verb"
  fi
  grep -qF 'cluster data untouched' <(sed -n '1,12p' "$wf") || fail "proddown: header must say cluster data untouched"
  yq e '.jobs.down.steps[] | select(.id == "delete") | .run' "$wf" | grep -qiF 'cluster data untouched' ||
    fail "proddown: delete echo must say cluster data untouched"

  wait_stub
  # find: 0 / 1 / 2 production apps
  yq e '.jobs.down.steps[] | select(.id == "find") | .run' "$wf" >"$work/find.sh"
  for n in 0 1 2; do
    : >"$work/apps.txt"
    for k in $(seq 1 "$n"); do echo "app$k xstockstrat-production" >>"$work/apps.txt"; done
    echo "x9 xstockstrat-staging" >>"$work/apps.txt"
    wrun "$work/find.sh"
    case "$n" in
    0) [ "$rc" = 0 ] && grep -qx 'app_id=' "$work/wout" && grep -qF 'already down' "$work/wso" || fail "proddown: find with no app" ;;
    1) [ "$rc" = 0 ] && grep -qx 'app_id=app1' "$work/wout" || fail "proddown: find with one app" ;;
    2) [ "$rc" != 0 ] && grep -qF 'expected at most 1 app named xstockstrat-production, found 2' "$work/wso" ||
      fail "proddown: find accepted two apps" ;;
    esac
  done
  # summary: names the remediation; never prints an empty cluster id
  yq e '.jobs.down.steps[] | select(.id == "summary") | .run' "$wf" >"$work/summary.sh"
  rm -f "$work/wsum"
  wrun "$work/summary.sh" APP_ID=app1 CLUSTER_ID=c1 DB_OUTCOME=success
  [ "$rc" = 0 ] && grep -qF 'app:app1' "$work/wsum" && grep -qF 'c1' "$work/wsum" || fail "proddown: summary (lookup ok)"
  rm -f "$work/wsum"
  wrun "$work/summary.sh" APP_ID=app1 CLUSTER_ID= DB_OUTCOME=failure
  [ "$rc" = 0 ] && grep -qF 'cluster lookup failed' "$work/wsum" && grep -qF 'app:app1' "$work/wsum" ||
    fail "proddown: summary (lookup failed)"
  ! grep -qE 'remove +--uuid|firewalls (list|remove) +(--|$)' "$work/wsum" || fail "proddown: summary printed an empty cluster id"
  echo "proddown: ok"
}

DB_CID=11111111-2222-4333-8444-555555555555
DB_APP=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee
DB_OTHER=99999999-8888-4777-8666-555555555555
DB_RULE=12345678-1234-4234-8234-123456789abc

# dbx [VAR=value ...] -- <subcommand args>: run the real do-db-cluster.sh against the stub doctl.
dbx() {
  local envs=()
  while [ "$1" != -- ]; do
    envs+=("$1")
    shift
  done
  shift
  : >"$work/doctl.log"
  : >"$work/dout"
  : >"$work/dsum"
  rc=0
  env -i PATH="$work/stub:$PATH" HOME="$HOME" W="$work" GITHUB_OUTPUT="$work/dout" \
    GITHUB_STEP_SUMMARY="$work/dsum" ${envs[@]+"${envs[@]}"} \
    bash "$PWD/scripts/do-db-cluster.sh" "$@" >"$work/dso" 2>"$work/dse" || rc=$?
}

no_doctl_write() {
  if grep -vE '^databases (list -o json|firewalls (list|append|remove) .*)$' "$work/doctl.log" | grep -q .; then
    fail "dbnet: $1: unexpected doctl call ($(cat "$work/doctl.log"))"
  fi
}

group_dbnet() {
  need yq jq
  local fw
  mkdir -p "$work/stub"
  cat >"$work/stub/doctl" <<'EOF'
#!/bin/sh
echo "$*" >>"$W/doctl.log"
case "$*" in
"databases list -o json") cat "$W/dbs.json" ;;
"databases firewalls list "*" -o json")
  [ "${FW_LIST_RC:-0}" = 0 ] || exit "$FW_LIST_RC"
  cat "$W/fw.json"
  ;;
"databases firewalls append "*) exit "${FW_APPEND_RC:-0}" ;;
"databases firewalls remove "*) exit "${FW_REMOVE_RC:-0}" ;;
*)
  echo "stub doctl: unexpected $*" >&2
  exit 99
  ;;
esac
EOF
  chmod +x "$work/stub/doctl"
  printf 'databases:\n  - name: xstockstrat\n    cluster_name: xstockstrat\n' >"$work/spec.yaml"
  local one="{\"id\":\"$DB_CID\",\"name\":\"xstockstrat\",\"private_network_uuid\":\"$FIXTURE_VPC\"}"
  local decoy="{\"id\":\"$DB_OTHER\",\"name\":\"other\",\"private_network_uuid\":\"$FIXTURE_VPC\"}"

  # lookup: exactly one cluster (a decoy is ignored) → cluster_id + vpc_id
  echo "[$decoy,$one]" >"$work/dbs.json"
  dbx SPEC="$work/spec.yaml" -- lookup
  [ "$rc" = 0 ] || fail "dbnet: lookup 1 cluster exited $rc ($(cat "$work/dse"))"
  grep -qx "cluster_id=$DB_CID" "$work/dout" || fail "dbnet: lookup cluster_id not in GITHUB_OUTPUT"
  grep -qx "vpc_id=$FIXTURE_VPC" "$work/dout" || fail "dbnet: lookup vpc_id not in GITHUB_OUTPUT"
  grep -qx "vpc_id=$FIXTURE_VPC" "$work/dso" || fail "dbnet: lookup vpc_id not on stdout"
  no_doctl_write lookup
  # lookup: 0 clusters ([] and null), 2 same-named
  for fw in '[]' null "[$one,$one]"; do
    echo "$fw" >"$work/dbs.json"
    dbx SPEC="$work/spec.yaml" -- lookup
    [ "$rc" != 0 ] || fail "dbnet: lookup accepted $fw"
    local want=0
    [ "$fw" = "[$one,$one]" ] && want=2
    grep -qF "expected exactly 1 database cluster named xstockstrat, found $want" "$work/dse" ||
      fail "dbnet: lookup message for $fw ($(cat "$work/dse"))"
  done
  # lookup: empty / absent private_network_uuid
  for fw in "[{\"id\":\"$DB_CID\",\"name\":\"xstockstrat\",\"private_network_uuid\":\"\"}]" \
    "[{\"id\":\"$DB_CID\",\"name\":\"xstockstrat\"}]"; do
    echo "$fw" >"$work/dbs.json"
    dbx SPEC="$work/spec.yaml" -- lookup
    [ "$rc" != 0 ] || fail "dbnet: lookup accepted a cluster without a VPC"
    grep -qF 'private_network_uuid' "$work/dse" || fail "dbnet: VPC failure must name private_network_uuid"
    ! grep -q . "$work/dout" || fail "dbnet: VPC failure wrote GITHUB_OUTPUT"
  done
  # lookup: two databases entries on the same cluster → ok; on different clusters → fail
  echo "[$one]" >"$work/dbs.json"
  printf 'databases:\n  - name: a\n    cluster_name: xstockstrat\n  - name: b\n    cluster_name: xstockstrat\n' >"$work/spec2.yaml"
  dbx SPEC="$work/spec2.yaml" -- lookup
  [ "$rc" = 0 ] || fail "dbnet: lookup rejected two entries on one cluster"
  printf 'databases:\n  - name: a\n    cluster_name: xstockstrat\n  - name: b\n    cluster_name: other\n' >"$work/spec2.yaml"
  dbx SPEC="$work/spec2.yaml" -- lookup
  [ "$rc" != 0 ] || fail "dbnet: lookup accepted two different clusters"
  grep -qF 'cluster_name' "$work/dse" || fail "dbnet: two-cluster message must name cluster_name"

  # trust: rule absent → one append, appended=true
  echo "[{\"uuid\":\"$DB_RULE\",\"type\":\"app\",\"value\":\"$DB_OTHER\"}]" >"$work/fw.json"
  dbx -- trust "$DB_CID" "$DB_APP"
  [ "$rc" = 0 ] || fail "dbnet: trust exited $rc ($(cat "$work/dse"))"
  [ "$(grep -c 'firewalls append' "$work/doctl.log")" = 1 ] || fail "dbnet: trust must append once"
  grep -qx "databases firewalls append $DB_CID --rule app:$DB_APP" "$work/doctl.log" || fail "dbnet: trust append argv"
  grep -qx 'appended=true' "$work/dout" || fail "dbnet: trust appended=true"
  no_doctl_write trust
  # trust: rule present → no append, appended=false
  echo "[{\"uuid\":\"$DB_RULE\",\"type\":\"app\",\"value\":\"$DB_APP\"}]" >"$work/fw.json"
  dbx -- trust "$DB_CID" "$DB_APP"
  [ "$rc" = 0 ] || fail "dbnet: trust (present) exited $rc"
  ! grep -q 'firewalls append' "$work/doctl.log" || fail "dbnet: trust appended a present rule"
  grep -qx 'appended=false' "$work/dout" || fail "dbnet: trust (present) appended=false"
  # trust: empty list ([] / null) → warning, rc 0, no append
  for fw in '[]' null; do
    echo "$fw" >"$work/fw.json"
    dbx -- trust "$DB_CID" "$DB_APP"
    [ "$rc" = 0 ] || fail "dbnet: trust on an open cluster ($fw) exited $rc"
    grep -q '^::warning::.*open to all' "$work/dso" || fail "dbnet: trust on an open cluster must warn"
    ! grep -q 'firewalls append' "$work/doctl.log" || fail "dbnet: trust restricted an open cluster"
    grep -qx 'appended=false' "$work/dout" || fail "dbnet: trust (open) appended=false"
  done
  # trust: list / append failure → rc≠0 with the re-run hint
  echo "[{\"uuid\":\"$DB_RULE\",\"type\":\"app\",\"value\":\"$DB_OTHER\"}]" >"$work/fw.json"
  dbx FW_LIST_RC=1 -- trust "$DB_CID" "$DB_APP"
  [ "$rc" != 0 ] || fail "dbnet: trust ignored a list failure"
  ! grep -q 'firewalls append' "$work/doctl.log" || fail "dbnet: trust appended after a list failure"
  grep -qF 're-run Prod — bring up' "$work/dse" || fail "dbnet: trust list failure hint"
  dbx FW_APPEND_RC=1 -- trust "$DB_CID" "$DB_APP"
  [ "$rc" != 0 ] || fail "dbnet: trust ignored an append failure"
  grep -qF 're-run Prod — bring up' "$work/dse" || fail "dbnet: trust append failure hint"
  # trust/untrust: non-UUID ids → rc≠0 and no doctl call
  for fw in trust untrust; do
    dbx -- "$fw" not-a-uuid "$DB_APP"
    [ "$rc" != 0 ] && ! grep -q . "$work/doctl.log" || fail "dbnet: $fw accepted a non-UUID cluster id"
    dbx -- "$fw" "$DB_CID" AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE
    [ "$rc" != 0 ] && ! grep -q . "$work/doctl.log" || fail "dbnet: $fw accepted an uppercase app id"
  done

  # untrust: a match among other rules → removed by uuid
  echo "[{\"uuid\":\"$DB_RULE\",\"type\":\"app\",\"value\":\"$DB_APP\"},{\"uuid\":\"$DB_OTHER\",\"type\":\"app\",\"value\":\"$DB_OTHER\"}]" >"$work/fw.json"
  dbx -- untrust "$DB_CID" "$DB_APP"
  [ "$rc" = 0 ] || fail "dbnet: untrust exited $rc ($(cat "$work/dse"))"
  [ "$(grep -c 'firewalls remove' "$work/doctl.log")" = 1 ] || fail "dbnet: untrust must remove exactly once"
  grep -qx "databases firewalls remove $DB_CID --uuid $DB_RULE" "$work/doctl.log" || fail "dbnet: untrust remove argv"
  no_doctl_write untrust
  # untrust: remove failure → rc≠0, summary names the rule
  dbx FW_REMOVE_RC=1 -- untrust "$DB_CID" "$DB_APP"
  [ "$rc" != 0 ] || fail "dbnet: untrust ignored a remove failure"
  grep -qF "$DB_RULE" "$work/dsum" || fail "dbnet: untrust remove failure must name the rule in the summary"
  # untrust: no match, empty list → rc 0, no remove
  for fw in "[{\"uuid\":\"$DB_OTHER\",\"type\":\"app\",\"value\":\"$DB_OTHER\"}]" '[]' null; do
    echo "$fw" >"$work/fw.json"
    dbx -- untrust "$DB_CID" "$DB_APP"
    [ "$rc" = 0 ] || fail "dbnet: untrust with no match ($fw) exited $rc"
    ! grep -q 'firewalls remove' "$work/doctl.log" || fail "dbnet: untrust removed a non-matching rule"
  done
  # untrust: the match is the only rule → refuse (would open the cluster), summary names it
  echo "[{\"uuid\":\"$DB_RULE\",\"type\":\"app\",\"value\":\"$DB_APP\"}]" >"$work/fw.json"
  dbx -- untrust "$DB_CID" "$DB_APP"
  [ "$rc" != 0 ] || fail "dbnet: untrust emptied the trusted-source list"
  ! grep -q 'firewalls remove' "$work/doctl.log" || fail "dbnet: untrust removed the last rule"
  grep -qF "$DB_RULE" "$work/dsum" || fail "dbnet: last-rule refusal must name the rule in the summary"

  # ::error:: only under GitHub Actions; stderr always
  dbx GITHUB_ACTIONS=true -- untrust "$DB_CID" "$DB_APP"
  grep -q '^::error::' "$work/dso" || fail "dbnet: no ::error:: under GITHUB_ACTIONS"
  dbx -- untrust "$DB_CID" "$DB_APP"
  ! grep -q '::error::' "$work/dso" || fail "dbnet: ::error:: outside GitHub Actions"
  grep -q . "$work/dse" || fail "dbnet: failure must write stderr"
  echo "dbnet: ok"
}

groups="${*:-action resolve build render deploy produp homelab bootstrap ac24 cleanup dbnet proddown}"
for g in $groups; do
  declare -F "group_$g" >/dev/null || fail "unknown or not-yet-implemented group: $g"
  "group_$g"
done
echo "sops-secrets.test.sh: all assertions passed ($groups)"
