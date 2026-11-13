#!/usr/bin/env bash
# Usage: refuse-retheme <tag> <theme> | require-match <tag> <target_env>. Guards the UI image's
# io.xstockstrat.ui-theme label; the exact ::error:: texts are pinned by ui-theme-label.test.sh.
set -euo pipefail

UI_IMAGE_REPO=ghcr.io/davcs86/xstockstrat/xstockstrat-ui

die() {
  echo "::error::$*"
  exit 1
}

# Prints the label ("" when unlabelled). Exit 2 when the ref does not exist; exit 1 on any other failure.
read_label() {
  local ref="$1" out err
  err="$(mktemp)"
  if ! out="$(docker buildx imagetools inspect "$ref" --format '{{json .Image}}' 2>"$err")"; then
    if grep -qi 'not found' "$err"; then
      rm -f "$err"
      return 2
    fi
    echo "::error::failed to inspect $ref: $(cat "$err")"
    rm -f "$err"
    return 1
  fi
  rm -f "$err"
  printf '%s' "$out" | jq -er '
    if type == "object" and has("rootfs") then .
    elif type == "object" and has("linux/amd64") then .["linux/amd64"]
    else error("unrecognised image config shape") end
    | .config.Labels["io.xstockstrat.ui-theme"] // ""' ||
    {
      echo "::error::unrecognised imagetools output for $ref"
      return 1
    }
}

[ "$#" -eq 3 ] || die "usage: $0 refuse-retheme <tag> <theme> | require-match <tag> <target_env>"
cmd="$1" tag="$2" want="$3"
ref="$UI_IMAGE_REPO:$tag"
rc=0
label="$(read_label "$ref")" || rc=$?

case "$cmd" in
refuse-retheme)
  [ "$rc" = 2 ] && exit 0
  [ "$rc" = 0 ] || exit 1
  if [ -n "$label" ] && [ "$label" != "$want" ]; then
    die "refusing to re-theme $ref: SHA $tag already built with UI theme $label; was main-dev fast-forwarded to main? Back-merges must be --no-ff"
  fi
  ;;
require-match)
  [ "$rc" = 2 ] && die "$ref not found; was docker-build.yml run for $tag?"
  [ "$rc" = 0 ] || exit 1
  if [ -z "$label" ]; then
    if [ "$want" = production ]; then
      echo "::warning::$ref has no io.xstockstrat.ui-theme label; deploying the unlabelled image to production"
    fi
  elif [ "$label" != "$want" ]; then
    die "xstockstrat-ui:$tag carries io.xstockstrat.ui-theme=$label; refusing to deploy to $want"
  fi
  ;;
*) die "unknown subcommand: $cmd" ;;
esac
exit 0
