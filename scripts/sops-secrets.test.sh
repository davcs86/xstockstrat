#!/usr/bin/env bash
# Hermetic tests for the SOPS deploy-secret tooling (setup-sops action, sops_secrets.py,
# do-render-app-spec.py) and the static rules pinned on the deploy workflows. Usage: [group ...]
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

groups="${*:-action resolve build render deploy produp homelab bootstrap ac24 cleanup}"
for g in $groups; do
  declare -F "group_$g" >/dev/null || fail "unknown or not-yet-implemented group: $g"
  "group_$g"
done
echo "sops-secrets.test.sh: all assertions passed ($groups)"
