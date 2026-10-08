#!/usr/bin/env bash
# scripts/render-migrations.sh <src_dir> <dst_dir>
# Copies every *.sql from src_dir into dst_dir. An *.up.sql whose first 5 lines carry
# `-- requires-env: VAR[,VAR...]` is rendered with envsubst restricted to exactly those variables,
# so $$ blocks and $1 placeholders survive; each named variable must be set and non-empty.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <src_dir> <dst_dir>" >&2
  exit 2
fi
src="$1"
dst="$2"
[ -d "$src" ] || {
  echo "render-migrations: source dir not found: $src" >&2
  exit 1
}
mkdir -p "$dst"

for f in "$src"/*.sql; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  header="$(head -n 5 "$f" | sed -n 's/^-- requires-env:[[:space:]]*//p' | head -n 1)"
  case "$name" in
  *.up.sql) ;;
  *) header="" ;;
  esac
  if [ -z "$header" ]; then
    cp "$f" "$dst/$name"
    continue
  fi
  allow=""
  for var in $(echo "$header" | tr ',' ' '); do
    case "$var" in
    *[!A-Za-z0-9_]* | [0-9]*)
      echo "render-migrations: invalid variable name '$var' in $name" >&2
      exit 1
      ;;
    esac
    if [ -z "$(printenv "$var" || true)" ]; then
      echo "render-migrations: $var is required to render $name (-- requires-env)" >&2
      exit 1
    fi
    allow="${allow}\$${var} "
  done
  envsubst "$allow" <"$f" >"$dst/$name"
done
