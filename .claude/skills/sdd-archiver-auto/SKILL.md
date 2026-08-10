# SDD Auto-Archiver: Automated Feature Archiving

Automatically detect and archive launched SDD features that are ready for cleanup.

argument-hint: (no arguments)

description: Scan for features with `launched` status that haven't been archived yet, and suggest/run archiving. Integrated with session-start checks and feature.md edit detection.

## Purpose

This skill automates the archiving workflow for features that have reached `launched` status in production. Archiving synthesizes terminal reasoning from the feature's context.md and ledger updates, making the feature directory disposable.

## When to Use

- **Manually**: Run `/sdd-archiver-auto` anytime to trigger an archive pass on all pending launched features
- **Automatically**: Scheduled routine (see [Automation Setup](#automation-setup) below)

## What It Does

1. Scans `docs/roadmap/features/*/feature.md` for entries with `Lifecycle Status: launched` and no `Archived:` field
2. For each pending feature, runs `/sdd-archiver <slug>` with synthesis enabled
3. Logs the archive operation and completion status

## Example Scenarios

**Scenario 1: Manual trigger after promotion**  
You've just promoted a feature from main-dev to main via `/promote`. The feature now has `launched` status.

```
/sdd-archiver-auto
```

Output:
```
Found 1 feature ready for archiving:
  - 042-portfolio-risk-alerts
Running /sdd-archiver 042-portfolio-risk-alerts...
✓ Archived: synthesis → context.md + Ledger insights(1)/fails(0); pruned 2 specs
```

**Scenario 2: Scheduled daily check**  
See [Automation Setup](#automation-setup) to configure the skill to run daily on your development machine or CI/CD pipeline.

## Automation Setup

### Option A: Daily Local Routine (Claude Code Desktop / Web)

From any session (or from the web UI Settings → Routines):

```bash
# Create a daily check at 9 AM UTC
/sdd-archiver-auto
# → Then in the session settings, or via the API:
# mcp__Claude_Code_Remote__create_trigger({
#   name: "Daily SDD Archive Check",
#   prompt: "/sdd-archiver-auto",
#   cron_expression: "0 9 * * *"  # 9 AM UTC daily
# })
```

### Option B: CI/CD Integration

Add to your GitHub Actions workflow (`.github/workflows/archive.yml`):

```yaml
name: Daily Archive Check
on:
  schedule:
    - cron: '0 9 * * *'  # 9 AM UTC daily

jobs:
  archive:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: davcs86/claude-code-action@v1  # Use an appropriate action
        with:
          prompt: "/sdd-archiver-auto"
          branch: main-dev
```

### Option C: Post-Promotion Hook

Add to `.claude/hooks/session-start.sh` to run after every `/promote` operation:

```bash
# After /promote completes, run archival check
if [ "$LAST_SKILL" = "/promote" ]; then
  /sdd-archiver-auto
fi
```

## Technical Details

- **Idempotent**: Running the skill multiple times is safe; features are only archived once
- **No rollback**: Archiving is terminal — archived features' specs are pruned and synthesis is final
- **Ledger updates**: Each archival updates `docs/roadmap/ledger/{insights,fails}.md` with terminal reasoning
- **Error handling**: If a feature's archival fails, the skill reports the error and continues to the next feature

## Related Skills

- `/sdd-archiver <slug>` — Archive a single feature manually (with synthesis and pruning)
- `/sdd-status` — View all features and their lifecycle statuses
- `/promote` — Promote features from main-dev to main (populates `Launched date` field)

## See Also

- `docs/roadmap/features/CLAUDE.md` — Feature lifecycle statuses and transitions
- `docs/roadmap/ledger/` — Cross-feature insights and failure patterns
