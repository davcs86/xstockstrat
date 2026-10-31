#!/usr/bin/env bash
# scripts/check-otel-produced-signals.sh [ROOT]
# Fail when a provisioned alert/dashboard queries a series or log literal nothing produces, or when
# docs reference assets that do not exist (feature 250 introduced the guard; feature 274 turned it into a
# registry allowlist once metrics and logs became real).
#
#   Registry  packages/otel/produced-signals.tsv: kind | identifier | producer-path | producer-literal.
#             Every row's literal must still exist in one of its producer paths (AC-8 P1-producer).
#   Part 1    alerts/*.yaml and dashboards/*.json (AC-8): every PromQL metric identifier, Loki service_name
#             value and Loki |= / |~ literal in an expr must be registered.
#   Part 3    docs/ + packages/otel (AC-3): named assets exist, counts match, removed assets are fenced.
#   Part 5    (AC-8/AC-14): every alert rule declares noDataState (OK for the RPC rules, Alerting for the stall
#             heartbeat), and the stall rule carries the label the outside-us-market-hours mute timing keys on.
#   Part 4    (AC-17): every rpc_server_duration_milliseconds_* selector excludes the proto-derived
#             server-streaming methods; no trace sampler or gRPC-exclusion env in deploy specs.
#
# Each hit prints "AC-n <tag> <relpath>:<line>: <text>" to stderr; exit 1 on any hit.
# macOS bash 3.2 + BSD/GNU compatible (grep -E / POSIX awk only; no mapfile, no associative arrays).

set -euo pipefail
shopt -s nullglob

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ROOT="${ROOT%/}"

REGISTRY="${ROOT}/packages/otel/produced-signals.tsv"
OPEN="<!-- otel-guard:removed-assets -->"
CLOSE="<!-- /otel-guard:removed-assets -->"
BT="$(printf '\140')"
NL=$'\n'
FENCE_RE="^- ${BT}(xstk-[a-z0-9-]+|outside-us-market-hours|[a-z0-9-]+\.(json|yaml))${BT}( — | - |: )(alert rule|mute timing|dashboard|file)$"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
hits="${tmp}/hits"
: >"$hits"

hit() {
  printf '%s %s %s:%s: %s\n' "$1" "$2" "$3" "$4" "$5" >>"$hits"
}

# --- Registry -----------------------------------------------------------------------------------
reg=""
if [ -f "$REGISTRY" ]; then
  reg_rel="${REGISTRY#"$ROOT"/}"
  ln=0
  while IFS=$'\t' read -r kind ident paths lit; do
    ln=$((ln + 1))
    if [ "$ln" -eq 1 ] || [ -z "$kind" ]; then continue; fi
    reg="${reg}${kind}"$'\t'"${ident}"$NL
    found=0
    old_ifs="$IFS"
    IFS=,
    for pth in $paths; do
      if [ -f "${ROOT}/${pth}" ] && grep -q -F -- "$lit" "${ROOT}/${pth}"; then found=1; fi
    done
    IFS="$old_ifs"
    if [ "$found" -eq 0 ]; then
      hit AC-8 P1-producer "$reg_rel" "$ln" "${kind} ${ident}"
    fi
  done <"$REGISTRY"
else
  hit AC-8 P1-producer packages/otel/produced-signals.tsv 1 "registry missing"
fi

# --- Part 4: server-streaming methods, derived from the protos ----------------------------------
streams=""
unary=""
while IFS=$'\t' read -r kind val; do
  case "$kind" in
  S) streams="${streams}${val}${NL}" ;;
  U) unary="${unary}${val}${NL}" ;;
  E) hit AC-17 P4 "$val" 1 "rpc line without returns" ;;
  esac
done < <(for p in "$ROOT"/packages/proto/*/v1/*.proto; do
  awk -v rel="${p#"$ROOT"/}" '
    /^[[:space:]]*\/\// { next }
    /^[[:space:]]*rpc[[:space:]]+[A-Za-z0-9_]+/ {
      name = $0
      sub(/^[[:space:]]*rpc[[:space:]]+/, "", name)
      sub(/[^A-Za-z0-9_].*/, "", name)
      if ($0 !~ /returns/) { print "E\t" rel ":" FNR; next }
      if ($0 ~ /returns[[:space:]]*\([[:space:]]*stream[[:space:]]/) print "S\t" name
      else print "U\t" name
    }
  ' "$p"
done)
stream_matcher=""
for m in $(printf '%s' "$streams" | sort -u); do
  stream_matcher="${stream_matcher:+${stream_matcher}|}${m}"
  case "${NL}${unary}" in
  *"${NL}${m}${NL}"*) hit AC-17 P4 packages/proto 1 "stream rpc ${m} shares its name with a unary rpc" ;;
  esac
done
if [ -n "$streams" ]; then
  want_matcher="rpc_method!~\"${stream_matcher}\""
else
  want_matcher=""
fi

# $1 relpath, $2 line, $3 expr: every rpc_server_duration selector must carry the exact stream matcher.
check_streams() {
  local row
  [ -n "$want_matcher" ] || return 0
  while IFS= read -r row; do
    hit AC-17 P4 "$1" "$2" "$row"
  done < <(printf '%s\n' "$3" | awk -v want="$want_matcher" '
    {
      s = $0
      while (match(s, /rpc_server_duration_milliseconds_(count|bucket|sum)/)) {
        name = substr(s, RSTART, RLENGTH)
        rest = substr(s, RSTART + RLENGTH)
        s = rest
        if (substr(rest, 1, 1) != "{") { print name " (no label matchers)"; continue }
        body = substr(rest, 2)
        sub(/\}.*/, "", body)
        if (index(body, want) == 0) print name " (missing " want ")"
      }
    }
  ')
}

registered() {
  case "${NL}${reg}" in
  *"${NL}$1"$'\t'"$2${NL}"*) return 0 ;;
  esac
  return 1
}

# stdin: one expr per line; prints "M<TAB>metric", "S<TAB>service_name" and "L<TAB>literal" rows.
expr_tokens() {
  awk '
    BEGIN {
      n = split("and or unless bool offset inf nan start end", k, " ")
      for (i = 1; i <= n; i++) kw[k[i]] = 1
    }
    {
      s = $0
      t = s
      while (match(t, /\|[=~][[:space:]]*"([^"\\]|\\.)*"/)) {
        lit = substr(t, RSTART, RLENGTH)
        sub(/^\|[=~][[:space:]]*"/, "", lit)
        sub(/"$/, "", lit)
        print "L\t" lit
        t = substr(t, RSTART + RLENGTH)
      }
      t = s
      while (match(t, /service_name[[:space:]]*=[[:space:]]*"[^"]*"/)) {
        v = substr(t, RSTART, RLENGTH)
        sub(/^[^"]*"/, "", v)
        sub(/"$/, "", v)
        print "S\t" v
        t = substr(t, RSTART + RLENGTH)
      }
      gsub(/"([^"\\]|\\.)*"/, "", s)
      if (s ~ /^[[:space:]]*label_values\(/) sub(/,[^)]*\)[[:space:]]*$/, ")", s)
      gsub(/\|[[:space:]]*[A-Za-z_][A-Za-z0-9_]*([[:space:]]*(=~|!~|!=|==|=|>=|<=|>|<)[[:space:]]*[A-Za-z0-9_.]*)?/, "", s)
      gsub(/\{[^}]*\}/, "", s)
      gsub(/\[[^]]*\]/, "", s)
      gsub(/(by|without|on|ignoring|group_left|group_right)[[:space:]]*\([^)]*\)/, "", s)
      while (match(s, /[A-Za-z_:][A-Za-z0-9_:]*/)) {
        id = substr(s, RSTART, RLENGTH)
        s = substr(s, RSTART + RLENGTH)
        if (s ~ /^[[:space:]]*\(/) continue
        if (id in kw) continue
        print "M\t" id
      }
    }
  '
}

# $1 relpath, $2 line, $3 expr, $4 E (an expr) or Q (a templating label_values query: Part 4 exempt)
check_expr() {
  local kind tok
  if [ "${4:-E}" = E ]; then check_streams "$1" "$2" "$3"; fi
  while IFS=$'\t' read -r kind tok; do
    case "$kind" in
    M) registered metric "$tok" || hit AC-8 P1 "$1" "$2" "$tok" ;;
    S) registered loki-service "$tok" || hit AC-8 P1 "$1" "$2" "service_name=\"${tok}\"" ;;
    L) registered loki-literal "$tok" || hit AC-8 P1 "$1" "$2" "|= \"${tok}\"" ;;
    esac
  done < <(printf '%s\n' "$3" | expr_tokens)
}

# stdin: "line<TAB>E|Q<TAB>expr" rows
check_rows() {
  local ln ty ex
  while IFS=$'\t' read -r ln ty ex; do
    check_expr "$1" "$ln" "$ex" "$ty"
  done
}

alert_exprs() {
  awk '
    function flush() { if (cur != "") { print startln "\tE\t" cur; cur = "" } }
    inblk {
      if ($0 ~ /^[[:space:]]*$/) next
      match($0, /^[[:space:]]*/)
      if (RLENGTH > ind) { l = $0; sub(/^[[:space:]]+/, "", l); cur = cur " " l; next }
      flush(); inblk = 0
    }
    /^[[:space:]]*expr:[[:space:]]*[|>][-+]?[[:space:]]*$/ { match($0, /^[[:space:]]*/); ind = RLENGTH; inblk = 1; startln = NR; cur = ""; next }
    /^[[:space:]]*expr:[[:space:]]*[^|>[:space:]]/ { v = $0; sub(/^[[:space:]]*expr:[[:space:]]*/, "", v); gsub(/^["\047]|["\047][[:space:]]*$/, "", v); print NR "\tE\t" v }
    END { flush() }
  ' "$1"
}

dashboard_exprs() {
  {
    grep -n -E '^[[:space:]]*"expr": "' "$1" |
      sed -E 's/^([0-9]+):[[:space:]]*"expr": "(.*)"[[:space:]]*,?[[:space:]]*$/\1\tE\t\2/'
    grep -n -E '^[[:space:]]*"query": "label_values' "$1" |
      sed -E 's/^([0-9]+):[[:space:]]*"query": "(.*)"[[:space:]]*,?[[:space:]]*$/\1\tQ\t\2/'
  } | sed -E 's/\\"/"/g' || true
}

for f in "$ROOT"/packages/otel/alerts/*.yaml; do
  alert_exprs "$f" | check_rows "${f#"$ROOT"/}"
done
for f in "$ROOT"/packages/otel/dashboards/*.json; do
  dashboard_exprs "$f" | check_rows "${f#"$ROOT"/}"
done

# --- Existence sets (value lines only: a comment can never make a deleted asset count) -------
names=""
files=""
rules=0
dashboards=0

for f in "$ROOT"/packages/otel/alerts/*.yaml; do
  while IFS=$'\t' read -r kind val; do
    names="${names}${val}${NL}"
    if [ "$kind" = uid ]; then
      rules=$((rules + 1))
    fi
  done < <(awk '
    /^[A-Za-z_]/ { k = $0; sub(/:.*/, "", k); next }
    k == "" || k ~ /^delete/ { next }
    /^[[:space:]]*- uid:/ { v = $0; sub(/^[[:space:]]*- uid:[[:space:]]*/, "", v); kind = "uid" }
    /^[[:space:]]*name:/ { v = $0; sub(/^[[:space:]]*name:[[:space:]]*/, "", v); kind = "name" }
    /^[[:space:]]*(- uid|name):/ { sub(/[[:space:]]+#.*/, "", v); sub(/[[:space:]]+$/, "", v); gsub(/"/, "", v); print kind "\t" v }
  ' "$f")
done

for f in "$ROOT"/packages/otel/dashboards/*.json; do
  dashboards=$((dashboards + 1))
  while IFS= read -r val; do
    names="${names}${val}${NL}"
  done < <(grep -E '^  "uid": "' "$f" | sed -E 's/^  "uid": "([^"]*)".*/\1/' || true)
done

while IFS= read -r f; do
  files="${files}${f#"$ROOT"/}${NL}${f##*/}${NL}"
done < <(find "$ROOT/packages/otel" -type f 2>/dev/null || true)

in_set() {
  case "${NL}${names}${files}" in
  *"${NL}$1${NL}"*) return 0 ;;
  esac
  return 1
}

file_exists() {
  local tok="$1"
  local inner="${1#packages/otel/}"
  if [ -e "${ROOT}/${tok}" ] || [ -e "${ROOT}/packages/otel/${inner}" ]; then
    return 0
  fi
  case "$tok" in
  */*) return 1 ;;
  esac
  case "${NL}${files}" in
  *"${NL}${tok}${NL}"*) return 0 ;;
  esac
  return 1
}

check_fenced() {
  local tok
  if ! printf '%s\n' "$3" | grep -q -E "$FENCE_RE"; then
    hit AC-3 P3-fence "$1" "$2" "$3"
    return 0
  fi
  tok="$(printf '%s\n' "$3" | awk -v bt="$BT" '{ sub("^- " bt, ""); i = index($0, bt); print substr($0, 1, i - 1) }')"
  if in_set "$tok"; then
    hit AC-3 P3-fence "$1" "$2" "$3"
  fi
}

check_count() {
  local want real
  case "${3%%[[:space:]]*}" in
  one) want=1 ;;
  two) want=2 ;;
  three) want=3 ;;
  four) want=4 ;;
  five) want=5 ;;
  six) want=6 ;;
  seven) want=7 ;;
  eight) want=8 ;;
  nine) want=9 ;;
  ten) want=10 ;;
  *) want="${3%%[[:space:]]*}" ;;
  esac
  case "$3" in
  *dashboard*) real="$dashboards" ;;
  *) real="$rules" ;;
  esac
  if [ "$want" != "$real" ]; then
    hit AC-3 P3-count "$1" "$2" "$(sed -n "${2}p" "${ROOT}/${1}")"
  fi
}

# --- Parts 2 and 3 over SCOPE --------------------------------------------------------------
scan_file() {
  local f="$1" rel="$2" gen="$3"
  local kind ln a
  # Part 3: fence tracking and token extraction in one pass over the file.
  awk -v op="$OPEN" -v cl="$CLOSE" -v gen="$gen" '
    function toks(s, re, kind,   t) {
      while (match(s, re)) {
        t = substr(s, RSTART, RLENGTH)
        print kind "\t" NR "\t" t
        s = substr(s, RSTART + RLENGTH)
      }
    }
    $0 == op {
      if (infence) print "E\t" NR "\tnested fence"
      else { infence = 1; start = NR }
      next
    }
    $0 == cl {
      if (!infence) print "E\t" NR "\tclosing marker without an opening marker"
      infence = 0
      next
    }
    infence { if ($0 !~ /^[[:space:]]*$/) print "X\t" NR "\t" $0; next }
    {
      toks($0, "xstk-[a-z0-9]+(-[a-z0-9]+)*|outside-us-market-hours", "N")
      if (gen == 1) {
        toks($0, "[A-Za-z0-9_./-]+\\.(json|yaml)", "F")
        low = tolower($0)
        while (match(low, "(^|[^a-z0-9])(one|two|three|four|five|six|seven|eight|nine|ten|[0-9]+)[[:space:]]+(v1[[:space:]]+)?(dashboards?|alert rules?)")) {
          t = substr(low, RSTART, RLENGTH)
          sub(/^[^a-z0-9]/, "", t)
          print "C\t" NR "\t" t
          low = substr(low, RSTART + RLENGTH)
        }
      }
    }
    END { if (infence) print "E\t" start "\tunclosed fence" }
  ' "$f" >"${tmp}/p3"
  while IFS=$'\t' read -r kind ln a; do
    case "$kind" in
    E) hit AC-3 P3-fence "$rel" "$ln" "$a" ;;
    X) check_fenced "$rel" "$ln" "$a" ;;
    N)
      if ! in_set "$a"; then
        hit AC-3 P3-name "$rel" "$ln" "$(sed -n "${ln}p" "$f")"
      fi
      ;;
    F)
      if ! file_exists "$a"; then
        hit AC-3 P3-file "$rel" "$ln" "$(sed -n "${ln}p" "$f")"
      fi
      ;;
    C) check_count "$rel" "$ln" "$a" ;;
    esac
  done <"${tmp}/p3"
}

while IFS= read -r f; do
  rel="${f#"$ROOT"/}"
  case "$rel" in
  docs/roadmap/* | docs/reports/* | packages/otel/alerts/*.yaml) continue ;;
  esac
  gen=0
  case "$rel" in
  docs/setup/grafana-cloud.md | docs/setup/CLAUDE.md | docs/patterns/observability.md | docs/launch-pdfs/product-features.md | packages/otel/*) gen=1 ;;
  esac
  scan_file "$f" "$rel" "$gen"
done < <(for base in docs packages/otel; do
  if [ -d "${ROOT}/${base}" ]; then
    find "${ROOT}/${base}" -type f \( -name '*.md' -o -name '*.yaml' -o -name '*.yml' \) -print
  fi
done | sort)

# --- Part 5: alert rule invariants -----------------------------------------------------------------
mute_ok=0
if [ -f "$ROOT/packages/otel/alerts/mute-timings.yaml" ] &&
  grep -q -E '^[[:space:]]+name:[[:space:]]*outside-us-market-hours[[:space:]]*$' "$ROOT/packages/otel/alerts/mute-timings.yaml"; then
  mute_ok=1
fi
f="$ROOT/packages/otel/alerts/alert-rules.yaml"
if [ -f "$f" ]; then
  rel="${f#"$ROOT"/}"
  while IFS='|' read -r ln uid nodata muted; do
    if [ -z "$nodata" ]; then
      hit AC-8 P5 "$rel" "$ln" "${uid} has no noDataState"
    else
      case "$uid" in
      xstk-error-rate-high | xstk-p99-latency-high)
        [ "$nodata" = OK ] || hit AC-8 P5 "$rel" "$ln" "${uid} noDataState must be OK, got ${nodata}"
        ;;
      xstk-analysis-no-scoring)
        [ "$nodata" = Alerting ] || hit AC-8 P5 "$rel" "$ln" "${uid} noDataState must be Alerting, got ${nodata}"
        ;;
      esac
    fi
    if [ "$uid" = xstk-analysis-no-scoring ]; then
      [ "$muted" = 1 ] || hit AC-14 P5 "$rel" "$ln" "${uid} lacks the mute_outside_market_hours label"
      [ "$mute_ok" = 1 ] || hit AC-14 P5 packages/otel/alerts/mute-timings.yaml 1 "outside-us-market-hours mute timing missing"
    fi
  done < <(awk '
    function emit() { if (uid != "") print ln "|" uid "|" nodata "|" muted }
    /^[[:space:]]*- uid:/ { emit(); uid = $0; sub(/^[[:space:]]*- uid:[[:space:]]*/, "", uid); gsub(/[[:space:]"]/, "", uid); ln = NR; nodata = ""; muted = 0; next }
    uid != "" && /^[[:space:]]*noDataState:/ { nodata = $0; sub(/^[[:space:]]*noDataState:[[:space:]]*/, "", nodata); gsub(/[[:space:]"]/, "", nodata) }
    uid != "" && /^[[:space:]]*mute_outside_market_hours:[[:space:]]*"?true"?[[:space:]]*$/ { muted = 1 }
    END { emit() }
  ' "$f")
fi

# --- Part 4: the span-derived metrics need every inbound span sampled ----------------------------
for f in "$ROOT"/.do/* "$ROOT"/docker-compose.yml; do
  [ -f "$f" ] || continue
  grep -n -E 'OTEL_TRACES_SAMPLER|OTEL_PYTHON_GRPC_EXCLUDED_SERVICES|OTEL_PYTHON_GRPC_EXCLUDE_SERVICES' "$f" |
    while IFS= read -r row; do
      hit AC-17 P4-sampler "${f#"$ROOT"/}" "${row%%:*}" "${row#*:}"
    done || true
done

if [ -s "$hits" ]; then
  cat "$hits" >&2
  exit 1
fi
exit 0
