#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Plugin marketplace provisioning (Claude Code on the web).
# The local CLI auto-registers marketplaces declared in .claude/settings.json
# (extraKnownMarketplaces) at startup, so its project-scoped enabledPlugins
# resolve and load. The web/remote provisioner does NOT run that registration,
# leaving enabledPlugins unresolved — context-forge (/context-scrubber,
# /context-constitution) and design-buddy, plus the repo's own mcp-tools-docs
# and sdd-suite, are then absent from web sessions. Bridge it: register each
# declared marketplace so settings.json enabledPlugins take effect (no explicit
# `plugin install` needed — enabling the marketplace is the single missing
# step). The harness re-resolves plugins after this hook runs.
#
# `claude` MUST be invoked by absolute path, not found via PATH: at COLD START
# the web hook environment has a minimal PATH that excludes the CLI, so a bare
# `command -v claude` guard fails and the whole block silently no-ops (it only
# ever fired on RESUME, whose PATH happens to include claude). Resolve the
# binary through CLAUDE_CODE_EXECPATH with fallbacks instead. Idempotent +
# best-effort: an already-registered marketplace is skipped and any failure
# never aborts session start.
# ---------------------------------------------------------------------------
_SETTINGS="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}/.claude/settings.json"

# Resolve a runnable `claude` binary without depending on PATH (see note above).
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
