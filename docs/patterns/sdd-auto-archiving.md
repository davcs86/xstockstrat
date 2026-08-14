# SDD Auto-Archiving: Automated Feature Cleanup

When an SDD feature reaches `code-completed` and is eventually promoted to `launched` in production, it is **automatically archived** to synthesize terminal reasoning and prune specs. This document covers the automated archiving system.

---

## Quick Start

### Automatic Archiving (Default)
Features are automatically archived within 1 hour of reaching `launched` status. A routine runs every hour to detect and archive all launched-not-archived features.

**No action needed** — archiving happens automatically.

### Manual Archiving (On Demand)
To archive a single feature immediately:

```bash
/sdd-archiver <slug>
```

Or to trigger a manual scan/archive pass:

```bash
/sdd-archiver-auto
```

---

## Architecture Overview

### Three-Layer Automatic Archiving

The automation system works in layers:

1. **SessionStart Check** (`.claude/hooks/session-start.sh`)  
   On every session start, scans all features and reports those needing archiving.  
   Output: summary of code-completed and launched-not-archived features.

2. **Feature Edit Hook** (`.claude/hooks/on-feature-md-edit.sh`)  
   When you edit a `feature.md` file and transition a feature to `launched`:
   - Immediately queues the feature for archiving
   - Notifies you that auto-archiving will trigger within the hour  
   Output: "Auto-archiving will trigger on next check (within 1 hour)"

3. **Scheduled Auto-Archive Routine** (always-on)  
   Runs every hour at :15 past the hour (UTC).
   - Scans for all `launched` features without `Archived:` field
   - Automatically runs `/sdd-archiver <slug>` for each found feature
   - Runs in a fresh session (doesn't interfere with user work)
   - Silent when no features found; logs when archives complete

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

### Automatic Archiving (Always Active)

The system is fully automatic and requires **no setup**:

1. **SessionStart Detection** — Enabled by default
   - Runs `check-code-completed-features.sh` on every session start
   - Reports code-completed and launched-not-archived features
   - Built into `.claude/hooks/session-start.sh`

2. **Feature Edit Hook** — Enabled by default
   - Triggers when you update `feature.md`
   - Detects transitions to `launched` status
   - Queues the feature for auto-archiving
   - Built into `.claude/settings.json` PostToolUse hook

3. **Hourly Auto-Archive Routine** — Enabled by default ✓
   - **Trigger**: `SDD Auto-Archive: Launched Features`
   - **Schedule**: Every hour at :15 past the hour (UTC)
   - **Action**: Automatically archives all launched-not-archived features
   - **Session**: Runs in a fresh session (doesn't interfere with your work)
   - **Notifications**: Silent (no email/push alerts)

**No manual setup required** — when a feature reaches `launched`, it will be automatically archived within the hour.

### Optional: Modify Archiving Frequency

If you want to change the archiving schedule (e.g., every 6 hours, daily, etc.), you can update the routine from Claude Code:

1. Go to **Settings → Routines** (or visit `/routines` in chat)
2. Find **"SDD Auto-Archive: Launched Features"**
3. Edit the `cron_expression`:
   - `0 * * * *` — Every hour (current)
   - `0 */6 * * *` — Every 6 hours
   - `0 9 * * *` — 9 AM UTC daily
   - `0 0 * * 0` — Midnight UTC weekly (Sundays)

---

## Workflow Examples

### Example 1: Feature Promoted to Production (Automatic Archiving)

**Step 1**: Run `/promote` to merge feature from main-dev to main  
→ Feature status becomes `launched`

**Step 2**: Feature Edit Hook detects `launched` transition (automatic)  
→ Output: "Feature 'xyz' reached launched status"  
→ Output: "Auto-archiving will trigger on next check (within 1 hour)"

**Step 3**: Hourly routine runs and archives automatically  
→ `/sdd-archiver-auto` executes
→ Feature is synthesized and archived
→ No user action needed ✓

### Example 2: Real-Time Feedback from Edit Hook

When you manually update a feature's status to `launched` in `feature.md`:

```
**Lifecycle Status**: `launched`
```

**Immediate feedback** (from on-feature-md-edit.sh hook):
```
[feature-md-edit] ✓ Feature 'my-feature' reached launched status
[feature-md-edit] → Auto-archiving will trigger on next check (within 1 hour)
```

**Within the hour**, the automatic routine archives it.

### Example 3: Manual Archiving on Demand

If you want to archive a feature immediately (don't wait for the hourly routine):

```bash
/sdd-archiver <slug>
```

Or trigger a manual scan:

```bash
/sdd-archiver-auto
```

Output:
```
Found 2 launched features ready for archiving:
  - 045-ui-consolidation-nextjs
  - 052-portfolio-risk-alerts
Running /sdd-archiver 045-ui-consolidation-nextjs...
✓ Archived: synthesis → context.md + Ledger insights(1)/fails(0); pruned 2 specs
Running /sdd-archiver 052-portfolio-risk-alerts...
✓ Archived: synthesis → context.md + Ledger insights(2)/fails(1); pruned 2 specs
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

### Why Automatic Archiving Happens After `launched`, Not `code-completed`?

Archiving is a terminal operation: it synthesizes the feature's final reasoning and prunes specs. A feature is only archived when:
1. All implementation is done (`code-completed`)
2. All testing is done (merged to main-dev, integration tested)
3. **It's live in production** (`launched`) ← Automatic archiving triggers here

Once a feature reaches `launched`, it's stable and the synthesis is final. The system automatically archives it within the hour, with no user intervention needed. This happens immediately after promotion, minimizing manual cleanup work.

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
