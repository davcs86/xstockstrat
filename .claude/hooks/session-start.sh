#!/bin/bash
set -euo pipefail

SKILLS_DIR="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}/.claude/skills"

[ -d "$SKILLS_DIR" ] || exit 0

MAX_DESC=55  # max chars for description column

# Collect rows as parallel arrays
invocations=()
descs=()

while IFS= read -r -d '' skill_file; do
  name=$(basename "$(dirname "$skill_file")")
  # Use awk to extract frontmatter fields (avoids pipe-in-value issues)
  hint=$(awk '/^argument-hint:/{sub(/^argument-hint:[[:space:]]*/,""); print; exit}' "$skill_file")
  desc=$(awk '/^description:/{sub(/^description:[[:space:]]*/,""); gsub(/\. .*/,""); print; exit}' "$skill_file")

  if [ -z "$hint" ] || [ "$hint" = "(no arguments)" ]; then
    invocations+=("/$name")
  else
    invocations+=("/$name $hint")
  fi

  # Truncate long descriptions
  if [ ${#desc} -gt $MAX_DESC ]; then
    desc="${desc:0:$((MAX_DESC-1))}…"
  fi
  descs+=("$desc")
done < <(find "$SKILLS_DIR" -name "SKILL.md" -print0 | sort -z)

[ ${#invocations[@]} -eq 0 ] && exit 0

# Measure max invocation width
max_inv=0
for inv in "${invocations[@]}"; do
  [ ${#inv} -gt $max_inv ] && max_inv=${#inv}
done

max_desc=0
for desc in "${descs[@]}"; do
  [ ${#desc} -gt $max_desc ] && max_desc=${#desc}
done

inner=$(( max_inv + max_desc + 3 ))  # " | " separator
title="SDD Skills"
lpad=$(( (inner - ${#title}) / 2 ))
rpad=$(( inner - ${#title} - lpad ))

hline=$(printf '═%.0s' $(seq 1 $inner))
printf '╔%s╗\n' "$hline"
printf '║%*s%s%*s║\n' $lpad "" "$title" $rpad ""
printf '╠%s╣\n' "$hline"
for i in "${!invocations[@]}"; do
  inv="${invocations[$i]}"
  desc="${descs[$i]}"
  printf '║ %-*s  %-*s║\n' "$max_inv" "$inv" "$max_desc" "$desc"
done
printf '╚%s╝\n' "$hline"
