# sdd-triage — `backmerge` sub-command

Loaded by the router **only** when `$ARGUMENTS[1] == backmerge`. Do not read it on the triage path.

The hotfix has merged to `main`. Confirm it reached `main-dev`, then record the close-out.

Derive the slug: ask the user "Which hotfix slug should I back-merge? (e.g. `fix-123-wrong-pnl`)"

### BM-1. Confirm the code back-merge landed (never merge or push `main-dev` yourself)

`.github/workflows/sync-main-to-maindev.yml` merges `main` into `main-dev` on every push to `main`,
the hotfix merge included; on a conflict it opens a `sync/main-into-main-dev` PR instead. This step
only checks which of those happened:
```bash
git fetch origin main main-dev
FIX=<hotfix PR head SHA, or origin/hotfix/<slug>>
git merge-base --is-ancestor "$FIX" origin/main-dev && \
  git log origin/main-dev --first-parent --ancestry-path "$FIX"..origin/main-dev --format='%h %s' | tail -1
```
- **Ancestor** → the printed commit is the back-merge commit: the sync merge commit (always a
  `--no-ff` merge since feature 307), or the merged `sync/main-into-main-dev` PR. Go to BM-2.
- **Not an ancestor, an open PR from `sync/main-into-main-dev` exists** → print its URL and stop: the
  conflict is resolved there and merged with **Create a merge commit** (never squash — a squash
  drops `main`'s commits from `main-dev`'s ancestry). Re-run this command after it merges.
- **Neither** → the sync run has not finished or failed; point the user at the latest
  "Sync main → main-dev" run and stop.

### BM-2. Update hotfix-log.md (through a PR)

On a `claude/backmerge-<slug>` branch cut from `origin/main-dev`: read `docs/runbooks/hotfix-log.md`,
find the `## <timestamp> — hotfix/<slug>` entry, set `**Status**` to `deployed`, and fill
`**Back-merge commit**` (plus `**PR**` / `**Platform-lead approver**` if still `_pending_`).

If that entry's `**GitHub issue**` line points at a `docs/reports/*.md` defect report, overwrite the
report's `.status` sidecar with `resolved` / `ref: hotfix:hotfix/<slug>`; skip BM-3 (there is no issue
to close). Commit both, push the branch, and open a docs-only PR to `main-dev` (squash is fine).

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
  hotfix-log.md: Status updated to deployed (PR <url>)
  GitHub issue #<number>: closed   (or: report sidecar → resolved)
```

Stop here — do not continue to the triage flow.
