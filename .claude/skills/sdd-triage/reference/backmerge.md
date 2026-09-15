# sdd-triage — `backmerge` sub-command

Loaded by the router **only** when `$ARGUMENTS[1] == backmerge`. Do not read it on the triage path.

The hotfix has merged to `main`. Complete the back-merge into `main-dev`.

Derive the slug: ask the user "Which hotfix slug should I back-merge? (e.g. `fix-123-wrong-pnl`)"

### BM-1. Fetch and back-merge
```bash
git fetch origin main main-dev
git checkout main-dev
git pull origin main-dev
git merge origin/main --no-edit
git push origin main-dev
```

If the merge fails with conflicts:
- Print each conflicting file.
- Ask the user to resolve conflicts manually, then re-run this command.
- Stop — do not continue until conflicts are resolved.

Record the back-merge commit SHA:
```bash
git rev-parse HEAD
```

### BM-2. Update hotfix-log.md

Read `docs/runbooks/hotfix-log.md`. Find the entry for `hotfix/<slug>` (match by the `## <timestamp> — hotfix/<slug>` heading). Update its `**Status**` line from `in-progress` to `deployed` and add `**Back-merge commit**: <SHA>`.

Write the file back.

### BM-3. Close GitHub issue

```bash
gh issue close $ARGUMENTS[0] --comment "Hotfix merged and back-merged into main-dev (commit: <SHA>). Fix: hotfix/<slug> PR merged to main. Trading resumed."
```

### BM-4. Announce

Print:
```
Back-merge complete.
  main-dev now contains: hotfix/<slug>
  Back-merge SHA: <SHA>
  hotfix-log.md: Status updated to deployed
  GitHub issue #<number>: closed
```

Stop here — do not continue to the triage flow.
