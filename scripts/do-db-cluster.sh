#!/usr/bin/env bash
# Usage: do-db-cluster.sh lookup (env SPEC) | trust <cluster_id> <app_id> | untrust <cluster_id> <app_id>
# prod-down needs only cluster_id, yet lookup also requires the VPC: its continue-on-error + summary step cover that.
set -euo pipefail

UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
RERUN="re-run ${LIFECYCLE_UP_WORKFLOW:-Prod — bring up}"

die() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::error::$*"
  fi
  echo "$*" >&2
  exit 1
}

out() {
  echo "$1=$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$1=$2" >>"$GITHUB_OUTPUT"
  fi
}

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "$*" >>"$GITHUB_STEP_SUMMARY"
  fi
}

check_ids() {
  [[ $1 =~ $UUID_RE ]] || die "cluster id '$1' is not a lowercase UUID"
  [[ $2 =~ $UUID_RE ]] || die "app id '$2' is not a lowercase UUID"
}

rules_of() {
  doctl databases firewalls list "$1" -o json
}

lookup() {
  local spec="${SPEC:-}" names n rows id vpc
  [ -f "$spec" ] || die "lookup: SPEC '$spec' is not a file"
  case "$(yq --version 2>&1)" in
  *mikefarah*) ;;
  *) die "yq must be mikefarah yq v4 (brew install yq)" ;;
  esac
  names="$(yq e -o=json '[.databases[].cluster_name | select(. != null)] | unique' "$spec")"
  n="$(jq 'length' <<<"$names")"
  [ "$n" = 1 ] || die "expected exactly 1 databases[].cluster_name in $spec, found $n"
  names="$(jq -r '.[0]' <<<"$names")"
  rows="$(doctl databases list -o json)"
  rows="$(jq -c --arg n "$names" '[(. // [])[] | select(.name == $n)]' <<<"$rows")"
  n="$(jq 'length' <<<"$rows")"
  [ "$n" = 1 ] || die "expected exactly 1 database cluster named $names, found $n"
  id="$(jq -r '.[0].id // ""' <<<"$rows")"
  vpc="$(jq -r '.[0].private_network_uuid // ""' <<<"$rows")"
  [[ $id =~ $UUID_RE ]] || die "cluster $names: id '$id' is not a lowercase UUID"
  [[ $vpc =~ $UUID_RE ]] || die "cluster $names: private_network_uuid '$vpc' is not a lowercase UUID (cannot fill YOUR_VPC_ID)"
  out cluster_id "$id"
  out vpc_id "$vpc"
}

trust() {
  local cid="$1" app="$2" rules
  check_ids "$cid" "$app"
  rules="$(rules_of "$cid")" || die "cannot list the trusted sources of cluster $cid; $RERUN"
  rules="$(jq -c '. // []' <<<"$rules")"
  if [ "$(jq 'length' <<<"$rules")" = 0 ]; then
    echo "::warning::cluster $cid has no trusted sources (open to all); not restricting it to app:$app"
    out appended false
    return 0
  fi
  if jq -e --arg a "$app" 'any(.[]; .type == "app" and .value == $a)' <<<"$rules" >/dev/null; then
    echo "app:$app is already a trusted source of cluster $cid"
    out appended false
    return 0
  fi
  doctl databases firewalls append "$cid" --rule "app:$app" >/dev/null ||
    die "appending trusted source app:$app to cluster $cid failed; $RERUN"
  echo "Added trusted source app:$app to cluster $cid"
  out appended true
}

untrust() {
  local cid="$1" app="$2" rules uuids total n u
  check_ids "$cid" "$app"
  rules="$(rules_of "$cid")" || die "cannot list the trusted sources of cluster $cid"
  rules="$(jq -c '. // []' <<<"$rules")"
  uuids="$(jq -r --arg a "$app" '.[] | select(.type == "app" and .value == $a) | .uuid' <<<"$rules")"
  if [ -z "$uuids" ]; then
    echo "No trusted-source rule for app:$app on cluster $cid"
    return 0
  fi
  total="$(jq 'length' <<<"$rules")"
  n="$(grep -c . <<<"$uuids")"
  if [ "$n" -ge "$total" ]; then
    summary "Trusted-source rule(s) $(echo "$uuids" | tr '\n' ' ')(app:$app) left on cluster $cid: removing the last trusted source would open it to all sources."
    die "refusing to remove the last trusted source of cluster $cid (it would open the cluster to all sources)"
  fi
  for u in $uuids; do
    [[ $u =~ $UUID_RE ]] || die "rule uuid '$u' is not a lowercase UUID"
  done
  for u in $uuids; do
    if ! doctl databases firewalls remove "$cid" --uuid "$u" >/dev/null; then
      summary "Stale trusted-source rule $u (app:$app) remains on cluster $cid: doctl databases firewalls remove $cid --uuid $u"
      die "removing trusted-source rule $u from cluster $cid failed"
    fi
    echo "Removed trusted source app:$app ($u) from cluster $cid"
  done
}

command -v doctl >/dev/null || die "doctl is required"
command -v jq >/dev/null || die "jq is required (macOS: brew install jq)"
case "${1:-}" in
lookup)
  [ $# = 1 ] || die "usage: do-db-cluster.sh lookup (with env SPEC)"
  lookup
  ;;
trust | untrust)
  [ $# = 3 ] || die "usage: do-db-cluster.sh $1 <cluster_id> <app_id>"
  "$1" "$2" "$3"
  ;;
*) die "usage: do-db-cluster.sh lookup | trust <cluster_id> <app_id> | untrust <cluster_id> <app_id>" ;;
esac
