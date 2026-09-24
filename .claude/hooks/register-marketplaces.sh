#!/usr/bin/env bash
set -euo pipefail

# Minimal SessionStart provisioning: register the plugin marketplaces declared in
# .claude/settings.json → extraKnownMarketplaces so this project's enabledPlugins load.
#
# The local CLI auto-registers these at startup, but the Claude Code web/remote provisioner
# does NOT — leaving enabledPlugins unresolved, so context-forge / design-buddy and the
# repo's own sdd-suite / mcp-tools-docs (and sdd-suite's cross-marketplace context-forge
# dependency) are absent there. This bridges only that gap.
#
# `claude` MUST be resolved by absolute path, not via PATH: at web COLD START the hook
# environment has a minimal PATH that excludes the CLI. Idempotent + best-effort: an
# already-registered marketplace is skipped and any failure never aborts session start.

_SETTINGS="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}/.claude/settings.json"

_claude=""
for _cand in "${CLAUDE_CODE_EXECPATH:-}" "$(command -v claude 2>/dev/null || true)" \
  /opt/claude-code/bin/claude /opt/node22/bin/claude; do
  if [ -n "$_cand" ] && [ -x "$_cand" ]; then
    _claude="$_cand"
    break
  fi
done
_jq="$(command -v jq 2>/dev/null || true)"
[ -x "$_jq" ] || _jq="/usr/bin/jq"

if [ -n "$_claude" ] && [ -x "$_jq" ] && [ -f "$_SETTINGS" ]; then
  _known_marketplaces="$("$_claude" plugin marketplace list 2>/dev/null || true)"
  while IFS=$'\t' read -r _mp_name _mp_repo; do
    [ -n "$_mp_name" ] || continue
    if printf '%s\n' "$_known_marketplaces" | grep -qF "$_mp_name"; then
      continue # already registered (local CLI, or an earlier provisioning pass)
    fi
    echo "[session-start] Registering plugin marketplace: $_mp_name ($_mp_repo)"
    if ! "$_claude" plugin marketplace add "$_mp_repo" >/dev/null 2>&1; then
      echo "[session-start] WARNING: failed to register marketplace $_mp_name ($_mp_repo) — plugins from it will be unavailable"
    fi
  done < <("$_jq" -r '
      (.extraKnownMarketplaces // {}) | to_entries[]
      | select(.value.source.source == "github")
      | [.key, .value.source.repo] | @tsv
    ' "$_SETTINGS" 2>/dev/null || true)
fi
