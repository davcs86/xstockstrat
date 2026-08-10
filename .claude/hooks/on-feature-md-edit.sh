#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Hook: Post-edit notification for feature.md files
# Triggered when feature.md files are written/edited
# Checks if status changed to code-completed or launched, and suggests archiving
# ---------------------------------------------------------------------------

file_path="$1"

# Only process feature.md files
if [[ ! "$file_path" =~ docs/roadmap/features/[0-9]+-[^/]+/feature\.md$ ]]; then
  exit 0
fi

feature_slug=$(echo "$file_path" | sed 's|.*/docs/roadmap/features/[0-9]*-\([^/]*\)/feature\.md|\1|')

# Extract current lifecycle status
status=$(grep -E '^\*\*Lifecycle Status\*\*:' "$file_path" 2>/dev/null | sed "s/.*\`\([^']*\)\`.*/\1/" | head -1)
archived=$(grep -E '^\*\*Archived\*\*:' "$file_path" 2>/dev/null | head -1)

case "$status" in
  code-completed)
    echo "[feature-md-edit] ✓ Feature '$feature_slug' transitioned to code-completed"
    echo "[feature-md-edit] → Next: verify merge-order, create integration PR, then run /sdd-archiver $feature_slug after promotion"
    ;;
  launched)
    if [ -z "$archived" ]; then
      echo "[feature-md-edit] ✓ Feature '$feature_slug' is now launched in production"
      echo "[feature-md-edit] → Ready for archiving: run /sdd-archiver $feature_slug"
    fi
    ;;
esac

exit 0
