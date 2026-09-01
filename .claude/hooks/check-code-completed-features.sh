#!/bin/bash

# ---------------------------------------------------------------------------
# Detect features with code-completed or launched status that haven't been
# archived yet. Reports on those that should be archived.
#
# This script scans docs/roadmap/features/*/feature.md and identifies:
# 1. Features with Lifecycle Status: `code-completed` (ready to verify and archive)
# 2. Features with Lifecycle Status: `launched` (archived in prod, ready to synthesize)
# ---------------------------------------------------------------------------

set -o pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}"
FEATURES_DIR="$PROJECT_DIR/docs/roadmap/features"

# Arrays to track findings
CODE_COMPLETED=()
LAUNCHED_NOT_ARCHIVED=()

echo "[code-completed-check] Scanning features for archiving candidates..."

# Scan all feature.md files
find "$FEATURES_DIR" -maxdepth 2 -name "feature.md" -print0 | sort -z | while IFS= read -r -d '' feature_file; do
  feature_dir=$(dirname "$feature_file")
  feature_slug=$(basename "$feature_dir" | sed 's/^[0-9]\+-//')

  # Extract lifecycle status (safely)
  status=$(grep -E '^\*\*Lifecycle Status\*\*:' "$feature_file" 2>/dev/null | sed "s/.*\`\([^']*\)\`.*/\1/" | head -1 || echo "")

  # Extract Archived field (if present)
  archived=$(grep -E '^\*\*Archived\*\*:' "$feature_file" 2>/dev/null | head -1 || echo "")

  case "$status" in
    code-completed)
      echo "[code-completed-check] Found code-completed: $feature_slug"
      ;;
    launched)
      if [ -z "$archived" ]; then
        echo "[code-completed-check] Found launched (not yet archived): $feature_slug"
      fi
      ;;
  esac
done

echo ""
echo "[code-completed-check] Summary: Scan complete."
echo "[code-completed-check] Check the output above for features needing archiving."

exit 0
