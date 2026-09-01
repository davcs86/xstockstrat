#!/bin/bash

# ---------------------------------------------------------------------------
# Hook: Post-edit automation for feature.md files
# Triggered when feature.md files are written/edited
# AUTOMATIC: Queues launched features for archiving
# ---------------------------------------------------------------------------

file_path="$1"

# Only process feature.md files
if [[ ! "$file_path" =~ docs/roadmap/features/[0-9]+-[^/]+/feature\.md$ ]]; then
  exit 0
fi

feature_slug=$(echo "$file_path" | sed 's|.*/docs/roadmap/features/[0-9]*-\([^/]*\)/feature\.md|\1|')

# Extract current lifecycle status
status=$(grep -E '^\*\*Lifecycle Status\*\*:' "$file_path" 2>/dev/null | sed "s/.*\`\([^']*\)\`.*/\1/" | head -1 || echo "")
archived=$(grep -E '^\*\*Archived\*\*:' "$file_path" 2>/dev/null | head -1 || echo "")

case "$status" in
  code-completed)
    echo "[feature-md-edit] ✓ Feature '$feature_slug' transitioned to code-completed"
    echo "[feature-md-edit] → Next: verify merge-order, create integration PR, then promote to main"
    ;;
  launched)
    if [ -z "$archived" ]; then
      echo "[feature-md-edit] ✓ Feature '$feature_slug' reached launched status"
      echo "[feature-md-edit] → Auto-archiving will trigger on next check (within 1 minute)"

      # Queue for auto-archiving by writing to a marker file
      PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
      PENDING_ARCHIVE_DIR="$PROJECT_DIR/.claude/pending-archives"
      mkdir -p "$PENDING_ARCHIVE_DIR"
      echo "$feature_slug" > "$PENDING_ARCHIVE_DIR/$feature_slug.pending"
    fi
    ;;
esac

exit 0
