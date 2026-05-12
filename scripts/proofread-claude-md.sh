#!/usr/bin/env bash
# Advisory proofreader for CLAUDE.md files using the Claude CLI.
# Checks content correctness (stale references, contradictions, clarity) — not markdown syntax.
# Output is informational only; exits 0 regardless of findings.
#
# Usage:
#   ./scripts/proofread-claude-md.sh                         # all CLAUDE.md files
#   ./scripts/proofread-claude-md.sh services/foo/CLAUDE.md  # specific files
set -euo pipefail

if ! command -v claude &>/dev/null; then
  echo "claude CLI not found — install Claude Code to use this script" >&2
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -gt 0 ]]; then
  files=("$@")
else
  mapfile -t files < <(find "$ROOT_DIR" -name "CLAUDE.md" -not -path "*/.git/*" | sort)
fi

PROMPT='You are a technical documentation reviewer. Review this CLAUDE.md file and flag ONLY concrete issues — do not rewrite or suggest stylistic improvements. Flag:
1. Stale references: port numbers, service names, file paths, or tool versions that appear incorrect given the file content
2. Internal contradictions: instructions that conflict with each other within the file
3. Missing critical info: if a section references a concept but omits the information a developer would need to act on it
4. Ambiguous or confusing instructions that could cause a developer to take the wrong action

Format your response as a numbered list. If you find no issues, respond with "No issues found." Keep each item to one sentence.'

echo "Proofreading ${#files[@]} CLAUDE.md file(s)..."
echo

for file in "${files[@]}"; do
  rel="${file#"$ROOT_DIR"/}"
  echo "=== $rel ==="
  content="$(cat "$file")"
  printf '%s\n\n---FILE CONTENT---\n%s' "$PROMPT" "$content" | claude --print 2>/dev/null || echo "(claude CLI error — skipping)"
  echo
done
