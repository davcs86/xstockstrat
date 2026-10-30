#!/usr/bin/env bash
# scripts/check-otel-produced-signals.sh [ROOT]
# Fail when a provisioned alert/dashboard targets a metric or log series nothing produces, or when
# docs claim signals the runtimes do not export (feature 250; runtimes export traces only, feature 226).
#
#   Part 1  alerts/*.yaml (AC-1) and dashboards/*.json (AC-2): no metric/log datasource or series tokens.
#   Part 2  docs/ + packages/otel (AC-3): no signal claims beyond traces.
#   Part 3  docs/ + packages/otel (AC-3): named assets exist, counts match, removed assets are fenced.
#
# Each hit prints "AC-n <tag> <relpath>:<line>: <text>" to stderr; exit 1 on any hit.
# macOS bash 3.2 + BSD/GNU compatible (grep -E / POSIX awk only; no mapfile, no associative arrays).

set -euo pipefail
shopt -s nullglob

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ROOT="${ROOT%/}"

SANCTIONED="Metrics and logs are not exported (feature 226)."
FOLLOWUP="docs/roadmap/features/274-otel-metrics-logs-export/"
DEFECT="otel-metrics-logs-never-exported-defect"
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

# stdin: "line:text" rows from grep -n
emit() {
  local row
  while IFS= read -r row; do
    hit "$1" "$2" "$3" "${row%%:*}" "${row#*:}"
  done
}

# --- Part 1 ----------------------------------------------------------------------------------
part1() {
  local rel="${2#"$ROOT"/}"
  grep -n -i -E 'prometheus|mimir|loki|promql|logql' "$2" | emit "$1" P1 "$rel" || true
  grep -n -E 'rpc_server_duration|service_name[[:space:]]*=' "$2" | emit "$1" P1 "$rel" || true
}

for f in "$ROOT"/packages/otel/alerts/*.yaml; do part1 AC-1 "$f"; done
for f in "$ROOT"/packages/otel/dashboards/*.json; do part1 AC-2 "$f"; done

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

  # Part 2: strip the case-exact sanctioned literal and follow-up path, then match.
  awk -v a="$SANCTIONED" -v b="$FOLLOWUP" '
    function cut(s, t,   i) {
      while ((i = index(s, t)) > 0) s = substr(s, 1, i - 1) substr(s, i + length(t))
      return s
    }
    { print cut(cut($0, a), b) }
  ' "$f" >"${tmp}/s"
  case "$rel" in
  docs/context-constitution-findings.md | packages/otel/docs/context-constitution-findings.md)
    awk -v d="$DEFECT" 'index($0, d) { print ""; next } { print }' "${tmp}/s" >"${tmp}/e"
    ;;
  *) cp "${tmp}/s" "${tmp}/e" ;;
  esac
  grep -n -i -E 'loki|mimir|prometheus|promql|logql|all three signal' "${tmp}/e" | emit AC-3 P2-specific "$rel" || true
  grep -n -E 'DS_LOKI|DS_PROMETHEUS|rpc_server_duration|service_name[[:space:]]*=' "${tmp}/e" | emit AC-3 P2-specific "$rel" || true
  if [ "$gen" = 1 ]; then
    grep -n -i -E 'metrics.{0,12}logs|logs.{0,12}metrics|(traces|spans)[^.]{0,15}metrics|\*\*(metrics|logs)\*\*|log error|error logs' "${tmp}/e" | emit AC-3 P2-generic "$rel" || true
    grep -n -E 'P99' "${tmp}/e" | emit AC-3 P2-generic "$rel" || true
  fi

  # Part 3: fence tracking and token extraction in one pass over the original file.
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

if [ -s "$hits" ]; then
  cat "$hits" >&2
  exit 1
fi
exit 0
