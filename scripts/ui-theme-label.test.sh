#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2016 # `A && B || fail` is the assertion idiom (fail always exits); literal ${{ }} is matched text
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

fail() {
  echo "ASSERT FAIL: $*" >&2
  exit 1
}

command -v jq >/dev/null || fail "jq is required (macOS: brew install jq)"
command -v yq >/dev/null || fail "yq is required (macOS: brew install yq)"
yq --version 2>/dev/null | grep -q 'mikefarah' || fail "yq must be mikefarah yq v4 (brew install yq)"
[ -f scripts/ui-theme-label.sh ] || fail "scripts/ui-theme-label.sh is missing"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin"
# Fake docker: FAKE_SHAPE = rootfs | platform | absent | error | garbage; FAKE_LABEL = label or empty.
cat >"$work/bin/docker" <<'EOF'
#!/usr/bin/env bash
[ "$1 $2 $3" = "buildx imagetools inspect" ] || { echo "unexpected docker call: $*" >&2; exit 97; }
labels='{}'
[ -n "${FAKE_LABEL:-}" ] && labels="{\"io.xstockstrat.ui-theme\":\"$FAKE_LABEL\"}"
case "$FAKE_SHAPE" in
  rootfs) echo "{\"config\":{\"Labels\":$labels},\"rootfs\":{\"type\":\"layers\"}}" ;;
  platform) echo "{\"linux/amd64\":{\"config\":{\"Labels\":$labels},\"rootfs\":{\"type\":\"layers\"}}}" ;;
  absent) echo "ERROR: $4: not found" >&2; exit 1 ;;
  error) echo "ERROR: unexpected status from HEAD request: 401 Unauthorized" >&2; exit 1 ;;
  garbage) echo '["unexpected"]' ;;
esac
EOF
chmod +x "$work/bin/docker"

# run <shape> <label> <subcommand> <tag> <arg>: sets $rc and $out (stdout+stderr).
run() {
  out="$(PATH="$work/bin:$PATH" FAKE_SHAPE="$1" FAKE_LABEL="$2" bash scripts/ui-theme-label.sh "$3" "$4" "$5" 2>&1)"
  rc=$?
}
REF=ghcr.io/davcs86/xstockstrat/xstockstrat-ui:abc1234

for shape in rootfs platform; do
  # AC-15: an existing tag built with another theme is never re-themed.
  run "$shape" production refuse-retheme abc1234 staging
  [ "$rc" = 1 ] && grep -qF "::error::refusing to re-theme $REF: SHA abc1234 already built with UI theme production; was main-dev fast-forwarded to main? Back-merges must be --no-ff" <<<"$out" ||
    fail "AC-15 ($shape): refuse-retheme must fail on a differing label: $out"
  for label in production ''; do
    run "$shape" "$label" refuse-retheme abc1234 production
    [ "$rc" = 0 ] || fail "refuse-retheme ($shape, label '$label'): expected pass: $out"
  done

  # AC-16: the 11 Scenario Outline rows (workflow column → the target the step passes).
  while IFS='|' read -r wf label target expect; do
    [ "$label" = '<none>' ] && label=''
    run "$shape" "$label" require-match abc1234 "$target"
    case "$expect" in
    fail)
      [ "$rc" = 1 ] && grep -qF "::error::xstockstrat-ui:abc1234 carries io.xstockstrat.ui-theme=$label; refusing to deploy to $target" <<<"$out" ||
        fail "AC-16 $wf ($shape) $label→$target: expected a refusal naming both: $out"
      ;;
    pass)
      [ "$rc" = 0 ] && ! grep -q '::' <<<"$out" || fail "AC-16 $wf ($shape) $label→$target: expected a silent pass: $out"
      ;;
    warn)
      [ "$rc" = 0 ] && grep -qF "::warning::$REF has no io.xstockstrat.ui-theme label" <<<"$out" ||
        fail "AC-16 $wf ($shape) →$target: expected a warning naming the unlabelled image: $out"
      ;;
    esac
  done <<'ROWS'
deploy-homelab|production|staging|fail
deploy-homelab|staging|production|fail
deploy-homelab|staging|staging|pass
deploy-homelab|<none>|staging|pass
deploy-homelab|<none>|production|warn
staging-up|production|staging|fail
staging-up|staging|staging|pass
prod-up|staging|production|fail
prod-up|production|production|pass
deploy.yml|staging|production|fail
prod-up|<none>|production|warn
ROWS
done

# Absent ref, other inspect failures and unknown shapes.
run absent '' require-match abc1234 staging
[ "$rc" = 1 ] && grep -qF "::error::$REF not found; was docker-build.yml run for abc1234?" <<<"$out" || fail "require-match: absent ref: $out"
run absent '' refuse-retheme abc1234 staging
[ "$rc" = 0 ] || fail "refuse-retheme: an absent ref must proceed: $out"
for sub in refuse-retheme require-match; do
  run error '' "$sub" abc1234 staging
  [ "$rc" = 1 ] || fail "$sub: an inspect failure must fail: $out"
  run garbage '' "$sub" abc1234 staging
  [ "$rc" = 1 ] || fail "$sub: an unrecognised imagetools shape must fail: $out"
done

# Static wiring.
wf=.github/workflows/docker-build.yml
[ "$(yq e '.on.workflow_call.inputs.ui_theme.required' "$wf")" = true ] &&
  [ "$(yq e '.on.workflow_call.inputs.ui_theme.type' "$wf")" = string ] || fail "docker-build: ui_theme must be a required string input"
[ "$(yq e '.jobs.build.needs' "$wf")" = preflight-ui-theme ] || fail "docker-build: build must need preflight-ui-theme"
pre='.jobs.preflight-ui-theme'
[ "$(yq e "$pre.permissions.contents + \",\" + $pre.permissions.packages" "$wf")" = read,read ] || fail "docker-build: preflight permissions"
st() { yq e "$pre.steps[$1] | $2" "$wf"; }
[ "$(yq e "$pre.steps | length" "$wf")" = 4 ] &&
  [[ "$(st 0 .uses)" == actions/checkout@* ]] &&
  [[ "$(st 1 .run)" == 'case "$T" in staging|production) ;; *) exit 1;; esac'* ]] &&
  [ "$(st 2 .uses)" = docker/login-action@v4 ] &&
  grep -qF 'bash scripts/ui-theme-label.sh refuse-retheme "$TAG" "$T"' <<<"$(st 3 .run)" ||
  fail "docker-build: preflight steps must be checkout → case → login → refuse-retheme"
yq e "$pre.steps[] | select(.run == \"*refuse-retheme*\") | .run" "$wf" | grep -qF '${{' &&
  fail "docker-build: refuse-retheme must take TAG/T via env, not inlined expressions" || true
grep -qF "build-args: \${{ matrix.service == 'xstockstrat-ui' && format('UI_THEME={0}', inputs.ui_theme) || '' }}" "$wf" ||
  fail "docker-build: the UI leg must pass UI_THEME as a build-arg"
for e in deploy-dev:staging deploy-prod:production; do
  [ "$(yq e '.jobs[] | select(.uses == "./.github/workflows/docker-build.yml") | .with.ui_theme' ".github/workflows/${e%%:*}.yml")" = "${e#*:}" ] ||
    fail "${e%%:*}: docker-build must get ui_theme ${e#*:}"
done
wf=.github/workflows/homelab-images.yml
[ "$(yq e '.on.workflow_dispatch.inputs.ui_theme.required' "$wf")" = true ] &&
  [ "$(yq e '.on.workflow_dispatch.inputs.ui_theme.type' "$wf")" = choice ] &&
  [ "$(yq e '.on.workflow_dispatch.inputs.ui_theme.options | join(",")' "$wf")" = staging,production ] ||
  fail "homelab-images: ui_theme must be a required choice [staging, production]"
[ "$(yq e '.jobs[] | select(.uses == "./.github/workflows/docker-build.yml") | .with.ui_theme' "$wf")" = '${{ inputs.ui_theme }}' ] ||
  fail "homelab-images: must pass inputs.ui_theme to docker-build"

# Registry drift.
repo="$(sed -n 's/^UI_IMAGE_REPO=//p' scripts/ui-theme-label.sh)"
want="${repo%/xstockstrat-ui}"
[ -n "$repo" ] && [ "$want" != "$repo" ] || fail "drift: UI_IMAGE_REPO must be defined once and end in /xstockstrat-ui"
[ "$(sed -n 's|^[[:space:]]*REPO="\([^"$]*\)/\${{ matrix\.service }}"$|\1|p' .github/workflows/docker-build.yml)" = "$want" ] ||
  fail "drift: docker-build.yml REPO prefix != $want"
[ "$(sed -n 's|^  REGISTRY: ||p' .github/workflows/deploy-homelab.yml)" = "$want" ] ||
  fail "drift: deploy-homelab.yml REGISTRY != $want"

echo "ui-theme-label.test.sh: all assertions passed"
