# SDD Auto-Archiving: Automated Feature Cleanup

When an SDD feature reaches `code-completed` and is eventually promoted to `launched` in production, it should be archived to synthesize terminal reasoning and prune specs. This document covers the automated archiving system.

---

## Quick Start

After a feature is promoted to `main` via `/promote` and reaches `launched` status:

```bash
/sdd-archiver-auto
```

Or manually for a single feature:

```bash
/sdd-archiver <slug>
```

---

## Architecture Overview

### Three-Layer Detection & Notification

The automation system works in layers:

1. **SessionStart Check** (`.claude/hooks/session-start.sh`)  
   On every session start, scans all features and reports those needing archiving.  
   Output: summary of code-completed and launched-not-archived features.

2. **Feature Edit Hook** (`.claude/hooks/on-feature-md-edit.sh`)  
   When you edit a `feature.md` file and transition a feature to `code-completed` or `launched`, the hook immediately notifies you.  
   Output: suggests next action (verify merge order, run archiver, etc.)

3. **Scheduled Routine** (optional; requires `mcp__Claude_Code_Remote__create_trigger`)  
   Periodic check (daily, weekly, or on-demand) to find and archive all pending features.  
   Output: archives pending features automatically.

### Feature Lifecycle & Archiving Timeline

```
In-Progress
    ↓
Code-Completed (all steps done)
    ↓
[Integrate & review merge order]
    ↓
Launched (merged to main, live in production)
    ↓
[Ready for archiving — synthesis, prune specs]
    ↓
Archived (terminal state)
```

**Key insight**: Archiving happens **after** `launched`, not at `code-completed`. A feature must be live in production before its terminal reasoning is synthesized.

---

## Hooks & Automation Files

| File | Purpose |
|---|---|
| `.claude/hooks/session-start.sh` | Called on every session start; calls `check-code-completed-features.sh` to report findings |
| `.claude/hooks/check-code-completed-features.sh` | Scans features, reports code-completed and launched-not-archived |
| `.claude/hooks/on-feature-md-edit.sh` | PostToolUse hook; triggered when `feature.md` is edited; suggests archiving |
| `.claude/settings.json` | Hooks registration: SessionStart and PostToolUse matchers |
| `.claude/skills/sdd-archiver-auto/SKILL.md` | Skill wrapper documenting the automation and setup options |

---

## Setup & Configuration

### Automatic Detection (Always On)

By default, the automation detects and reports findings:

1. **SessionStart**: Run `check-code-completed-features.sh`
   - Scan for code-completed features
   - Scan for launched-but-not-archived features
   - Output suggestions

2. **Feature Edit**: When you update `feature.md`
   - Detect status transitions
   - Output next-step suggestions

No additional setup needed — these are built into `.claude/settings.json` and `session-start.sh`.

### Optional: Scheduled Routine (Automatic Archiving)

To archive features automatically on a schedule (e.g., daily), create a Routine from the Claude Code interface or API:

#### Setup via Claude Code Web UI:

1. Go to **Settings → Routines** (or `/routines` in chat)
2. Click **+ Create Routine**
3. Fill in:
   - **Name**: "Daily SDD Archive"
   - **Schedule**: `0 9 * * *` (9 AM UTC daily; adjust timezone)
   - **Prompt**: `/sdd-archiver-auto`
4. Save

The routine will fire at the scheduled time and automatically archive all pending features.

#### Setup via API/Script:

```bash
curl -X POST https://api.claude.ai/v1/routines \
  -H "Authorization: Bearer $CLAUDE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily SDD Archive Check",
    "cron_expression": "0 9 * * *",
    "prompt": "/sdd-archiver-auto",
    "session_id": "your-session-id"
  }'
```

#### Cron Expression Reference

- `0 9 * * *` — 9 AM UTC daily
- `0 9 * * 1` — 9 AM UTC every Monday (weekday archiving)
- `0 0 * * 0` — Midnight UTC every Sunday (weekend batch)
- `0 */6 * * *` — Every 6 hours (0, 6, 12, 18 UTC)

---

## Workflow Examples

### Example 1: Feature Promoted to Production

**Step 1**: Run `/promote` to merge feature from main-dev to main  
→ Feature status becomes `launched`

**Step 2**: Session detects it (SessionStart hook or automatic)  
→ Output: "Launched features ready for archiving: <slug>"

**Step 3**: Run `/sdd-archiver-auto` or `/sdd-archiver <slug>`  
→ Synthesizes terminal reasoning and archives the feature

### Example 2: Scheduled Daily Archiving

**Setup**: Create a routine that runs at 9 AM UTC daily  
→ Routine fires, runs `/sdd-archiver-auto`

**Behavior**:
- Scans all features with `launched` status
- Checks which ones are not yet archived
- Archives each one (synthesis + spec pruning)
- Logs results

Result: No manual archiving needed; features clean up automatically after promotion.

### Example 3: Manual Archiving on Demand

You've promoted a feature and want to archive it immediately:

```bash
/sdd-archiver-auto
```

Output:
```
Found 1 launched feature ready for archiving:
  - 045-ui-consolidation-nextjs
Running /sdd-archiver 045-ui-consolidation-nextjs...
✓ Archived: synthesis → context.md + Ledger insights(1)/fails(0); pruned 2 specs
```

---

## Troubleshooting

### "Launched features ready for archiving:" but nothing happens

**Issue**: The skill is suggesting features to archive, but you haven't run `/sdd-archiver-auto` yet.

**Fix**: Run `/sdd-archiver-auto` manually, or set up a scheduled routine (see [Setup](#setup--configuration)).

### Feature was archived but synthesis seems incomplete

**Issue**: The archive ran, but the context.md or ledger updates look sparse.

**Likely cause**: The feature's `context.md` or session history was sparse to begin with. Archiving only synthesizes what's available.

**Fix**: Review `docs/roadmap/ledger/{insights,fails}.md` to ensure terminal reasoning was captured. If missing, add notes before archiving.

### Routine isn't firing

**Issue**: You set up a scheduled routine, but it's not running.

**Causes**:
1. **Wrong time**: Cron expression uses UTC; check your timezone conversion
2. **Routine disabled**: Check if the routine is enabled in Settings → Routines
3. **Session offline**: Routines fire only if the session was created with `create_new_session_on_fire=true`

**Fix**: 
- Delete the routine and recreate with correct settings
- Ensure `create_new_session_on_fire` is enabled if using persistent session
- Verify cron syntax at https://crontab.guru

### Hook isn't triggering on feature.md edit

**Issue**: You edited `feature.md` but the `on-feature-md-edit.sh` hook didn't fire.

**Likely cause**: The hook's regex doesn't match your file path, or the hook is malformed.

**Fix**:
1. Verify the file path matches: `docs/roadmap/features/NNN-<slug>/feature.md`
2. Check `.claude/settings.json` for the PostToolUse hook configuration
3. Run the hook manually: `bash .claude/hooks/on-feature-md-edit.sh docs/roadmap/features/042-example/feature.md`

---

## References

- **`docs/patterns/test-data-inventory.md`** — Per-feature fixture management (related to feature cleanup)
- **`docs/roadmap/features/CLAUDE.md`** — Feature lifecycle statuses and transitions
- **`docs/roadmap/ledger/`** — Cross-feature insights and failure patterns
- **`docs/sdd/constitution.md`** — SDD binding rules and constraints

---

## Implementation Notes

### Why Archive After `launched`, Not `code-completed`?

Archiving is a terminal operation: it synthesizes the feature's final reasoning and prunes specs. A feature shouldn't be archived until:
1. All implementation is done (`code-completed`)
2. All testing is done (merged to main-dev, integration tested)
3. It's live in production (`launched`)

At that point, the feature is stable and the synthesis won't change. Archiving prematurely (at `code-completed`) would mean re-archiving after promotion, which is wasteful.

### Hooks vs. Skills

- **Hooks** (`.claude/hooks/*.sh`) — Lightweight shell scripts; run synchronously on file edits or session start; no skill invocation
- **Skills** (`.claude/skills/*/SKILL.md`) — Full Claude context; can orchestrate multiple operations; invoked manually or by routine

The detection hooks run synchronously (fast feedback on edits). The skill wrapper handles manual or scheduled bulk archiving.

### Why No Auto-Trigger on `code-completed`?

The SDD design principle is that agents suggest next steps but don't act unilaterally on terminal operations. At `code-completed`, the feature still needs:
1. Merge order verification (via `docs/roadmap/features/merge-order.md`)
2. Integration PR creation and review
3. Promotion to main

Archiving before these steps would lose context. The automation suggests archiving *after* `launched`, when the feature is stable.

---

## Future Enhancements

Potential improvements (not yet implemented):

1. **Post-Merge Hook**: Auto-run archiver on merge to `main` (requires CI/GitHub Actions)
2. **Stale Feature Detection**: Warn on features stuck in `code-completed` for >N days
3. **Batch Ledger Updates**: Consolidate multiple features' ledger insights in one pass
4. **Archive Rollback**: Add a "restore" mechanism for disputed archives
