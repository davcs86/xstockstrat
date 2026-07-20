---
name: sdd-sync
description: Sync SDD spec files between feature branches and main-dev via 3-way merge. Usage: /sdd-sync [feature-slug]. Auto-merges non-conflicting diffs in both directions, opens a PR targeting main-dev for the merged result, and offers to delete branches for launched features.
argument-hint: [feature-slug]
allowed-tools: Read Write AskUserQuestion Bash(ls *) Bash(find *) Bash(mkdir *) Bash(git *) Bash(gh pr *) Bash(diff *) Bash(grep *) mcp__github__list_branches
effort: low
---

You are syncing SDD spec files between feature branches and main-dev. Both sides may legitimately advance independently — feature branches receive new SDD progress; main-dev receives state transitions like `launched` set by the `/promote` workflow. This skill performs a 3-way merge per file and only stops on real merge conflicts. Changes are docs-only — no service code is touched.

## Arguments

- `$ARGUMENTS[0]` — feature slug (optional). If absent, sync all features that have a live feature branch on origin.

---

## SPEC FILES

The six SDD artifacts per feature (directory is `NNN-<slug>`, e.g. `001-add-ikbr-account-support`):
- `docs/roadmap/features/<NNN-slug>/feature.md`
- `docs/roadmap/features/<NNN-slug>/product-spec.md`
- `docs/roadmap/features/<NNN-slug>/recon.md`
- `docs/roadmap/features/<NNN-slug>/design.md`
- `docs/roadmap/features/<NNN-slug>/implementation-spec.md`
- `docs/roadmap/features/<NNN-slug>/context.md`

(`recon.md` and `design.md` exist only after `/sdd-design` has run; the per-file logic below already
handles a file present on only one side, so absent artifacts simply skip.)

`origin/feature/<slug>` and `origin/main-dev` are merged 3-way per file using their common ancestor. Files that exist on only one side are taken as-is. The merged result is written to both sides:
- main-dev → via a `claude/sync-specs-*` PR (existing flow)
- feature branch → via a direct commit on `feature/<slug>` (small, docs-only)

---

## PROCEDURE

### Step 1 — Validate

Check the working tree is clean:
```bash
git status --porcelain
```
If any output: stop — "Working tree has uncommitted changes. Commit or stash before running /sdd-sync."

Check the current branch:
```bash
git branch --show-current
```
If the branch starts with `feature/` or `feature-steps/`: stop — "Run /sdd-sync from main-dev or a claude/* branch, not from a feature branch."

### Step 2 — Discover features

```bash
git fetch origin
```

If `$ARGUMENTS[0]` is provided:
- Resolve the directory:
  ```bash
  find docs/roadmap/features -maxdepth 1 -type d -name "*-$ARGUMENTS[0]"
  ```
  If not found: stop — "No feature directory found for slug: `$ARGUMENTS[0]`."
  Capture as `FEATURE_DIR`. Derive `<slug>` = `$ARGUMENTS[0]`.

If `$ARGUMENTS[0]` is absent:
```bash
find docs/roadmap/features -maxdepth 1 -mindepth 1 -type d | sort
```
For each result, use the full directory path as `FEATURE_DIR` and derive `<slug>` by stripping the `NNN-` prefix.

### Step 3 — 3-way merge each spec file

For each slug:

**a.** Check whether `origin/feature/<slug>` exists:
```bash
git ls-remote --heads origin feature/<slug>
```
If no output: skip this feature with note "Skipping `<slug>` — no feature branch on origin."

**b.** Find the common ancestor between the two branches once per feature:
```bash
BASE_COMMIT=$(git merge-base origin/main-dev origin/feature/<slug>)
```
If `git merge-base` fails (unrelated histories): stop — "No common ancestor between origin/main-dev and origin/feature/<slug>. Investigate before re-running."

**c.** For each file in `{feature.md, product-spec.md, recon.md, design.md, implementation-spec.md, context.md}`:

1. Determine which sides have the file:
   ```bash
   git cat-file -e "origin/main-dev:$FEATURE_DIR/<file>" 2>/dev/null   # has_main
   git cat-file -e "origin/feature/<slug>:$FEATURE_DIR/<file>" 2>/dev/null   # has_feat
   ```

2. Decide:
   - **neither side has it** → skip.
   - **only feature branch has it** → mark as `new-to-main` (write feature branch's content to main-dev side; feature branch needs no change).
   - **only main-dev has it** → mark as `new-to-feature` (write main-dev's content to feature branch side; main-dev needs no change).
   - **both sides have it**:
     - If content is identical (`git diff --quiet ...`) → skip.
     - Otherwise → run 3-way merge:
       ```bash
       git show "origin/main-dev:$FEATURE_DIR/<file>" > /tmp/ours.<unique>
       git show "origin/feature/<slug>:$FEATURE_DIR/<file>" > /tmp/theirs.<unique>
       if git cat-file -e "$BASE_COMMIT:$FEATURE_DIR/<file>" 2>/dev/null; then
         git show "$BASE_COMMIT:$FEATURE_DIR/<file>" > /tmp/base.<unique>
       else
         : > /tmp/base.<unique>   # empty base — file is new since the ancestor
       fi
       git merge-file -p -L main-dev -L base -L feature/<slug> \
         /tmp/ours.<unique> /tmp/base.<unique> /tmp/theirs.<unique> > /tmp/merged.<unique>
       MERGE_RC=$?
       ```
       - `MERGE_RC == 0` (clean) → mark as `merged` (write merged content to both sides if it differs from each side's current content).
       - `MERGE_RC > 0` (conflict markers present) → mark as `conflict`, retain `/tmp/merged.<unique>` for the report.

   Use a unique suffix per (slug, file) — e.g. `$slug-$file` — so temp files do not collide across iterations.

### Step 4 — Bail on conflicts

If any file is marked `conflict`:

Stop. Print a report listing each conflict file with the path of the merged-with-markers temp file so the user can inspect:
```
Merge conflicts detected — sync aborted. Resolve manually, then re-run /sdd-sync.

  <slug>/<file>  →  /tmp/merged.<slug>-<file>   (contains <<<<<<< markers)
  ...
```
Do not create a branch, do not write any files, do not delete any branches. Exit.

### Step 5 — Early exit if nothing to sync

If after Step 3 no file is marked `new-to-main`, `new-to-feature`, or `merged` (everything was `skip`), print:
```
All spec files are already in sync between feature branches and main-dev.
```
Then proceed to **Step 10 — Branch cleanup for launched features** (still runs on early exit). After Step 10, stop.

### Step 6 — Back-sync to feature branches

For each slug whose files include any `new-to-feature` or `merged` entries (where main-dev's content differs from the feature branch's current content):

1. Check out the feature branch tracking origin:
   ```bash
   git checkout -B feature/<slug> origin/feature/<slug>
   ```

2. For each affected file:
   - `new-to-feature` → write main-dev's content (from `git show origin/main-dev:...`) to the path in the working tree.
   - `merged` → write the merged content (from `/tmp/merged.<unique>`) to the path.

3. Commit and push:
   ```bash
   git add docs/roadmap/features/
   git commit -m "docs: sync feature.md / spec files from main-dev via /sdd-sync"
   git push origin feature/<slug>
   ```

4. Return to a neutral branch before continuing:
   ```bash
   git checkout main-dev
   ```

Note any feature branches updated for the final summary.

### Step 7 — Prepare main-dev sync branch

If no file is marked `new-to-main` or `merged` (where feature branch's content differs from main-dev's), skip to Step 10.

```bash
git checkout main-dev
git pull --ff-only origin main-dev
git checkout -b claude/sync-specs-<YYYYMMDD>
```

If `claude/sync-specs-<YYYYMMDD>` already exists locally or on origin, append `-2`, `-3`, etc.

### Step 8 — Write synced files to main-dev

For each `(FEATURE_DIR, slug, file)` tuple marked `new-to-main` or `merged`:

1. Ensure the directory exists: `mkdir -p $FEATURE_DIR`.
2. Write the content:
   - `new-to-main` → use `git show origin/feature/<slug>:$FEATURE_DIR/<file>`.
   - `merged` → use the contents of `/tmp/merged.<unique>`.
3. Use the Write tool to put the content at `$FEATURE_DIR/<file>` in the working tree.

### Step 9 — Commit, push, and open PR

```bash
git add docs/roadmap/features/
git commit -m "docs: sync spec files from feature branches

Features synced:
- <slug>: <file1>, <file2>, ...
- <slug>: <file1>, ..."
git push -u origin claude/sync-specs-<YYYYMMDD>
```

Open the PR:
```bash
gh pr create \
  --base main-dev \
  --head claude/sync-specs-<YYYYMMDD> \
  --title "docs: sync spec files from feature branches" \
  --body "$(cat <<'EOF'
## Summary

Syncs SDD spec files between feature branches and main-dev using a 3-way merge per file. Both sides receive any non-conflicting changes the other side has made.

**Direction**: bidirectional 3-way merge (docs only, no service code)
**Feature branches updated directly**: see commit "docs: sync … from main-dev via /sdd-sync" on each branch.

### Files synced to main-dev

| Feature | Files changed |
|---------|--------------|
| <slug> | <file list> |

## Review notes

These are documentation-only changes. Verify that the spec content matches the expected state of each feature before merging.
EOF
)"
```

Print the PR URL.

### Step 10 — Branch cleanup for launched features

Read each synced feature's `feature.md` (use the just-merged content for synced features; for skipped features, read from `origin/main-dev:$FEATURE_DIR/feature.md`). Look for:
```
**Lifecycle Status**: `launched`
```

For every feature in `launched` state, enumerate its branches on origin:
```bash
mcp__github__list_branches  (or)  git ls-remote --heads origin "feature/<slug>" "feature-steps/<slug>-step-*"
```

Collect the candidate list. If none, skip to the final summary.

If the list is non-empty, ask the user before deleting:
```
AskUserQuestion:
  question: "<slug> is launched. Delete its branches on origin?"
  header:   "Cleanup <slug>"
  options:
    - label: "Delete all listed branches"
      description: "Removes feature/<slug> and all feature-steps/<slug>-step-* branches on origin via `git push origin --delete`."
    - label: "Keep all branches"
      description: "Leave branches intact (e.g. you may want to keep them for archive)."
```

If the user picks "Delete all listed branches", run:
```bash
git push origin --delete feature/<slug> feature-steps/<slug>-step-1 ... feature-steps/<slug>-step-N
```
(Batch into a single push when possible.)

Alternatively, you may use the GitHub MCP server's delete-branch tools if available. Both paths are acceptable; pick whichever the environment supports.

Ask once per launched feature. Never delete without an explicit "Delete all listed branches" answer.

### Step 11 — Summary

Print:
```
Sync complete.

Feature branches updated:
  feature/<slug>   (commit <sha>) — <file list>
  ...

main-dev PR:
  Branch: claude/sync-specs-<YYYYMMDD>
  URL:    <url>
  Features synced:
    <slug>: feature.md, implementation-spec.md  (2 files)
    ...

Branches deleted (launched features):
  feature/<slug>
  feature-steps/<slug>-step-1
  ...

Skipped:
  <slug> — no feature branch on origin
  <slug> — branch cleanup declined by user
```

---

## HARD CONSTRAINTS

- **Bidirectional merge, but per-file 3-way only.** Never naive-overwrite either side; always feed both versions plus the merge-base into `git merge-file`.
- **Stop on conflict markers, never resolve them automatically.** Leave the conflicted temp files for the user.
- **Never touch service code files.** Only files under `docs/roadmap/features/` are written or deleted.
- **Never delete a file from either side** because it is absent on the other — absence means "skip" for that file.
- **Never create the main-dev sync branch from anything other than an up-to-date main-dev.**
- **Never push directly to main-dev.** Always via a `claude/sync-specs-*` PR.
- **Pushes directly to `feature/<slug>` are allowed only for the back-sync commit in Step 6**, and only with content produced by Step 3's merge.
- **Branch deletion requires explicit user consent per feature.** No deletes on `launched` features without an answer of "Delete all listed branches" from `AskUserQuestion`.
- **Never delete `main`, `main-dev`, `hotfix/*`, or `claude/*` branches** — only `feature/<slug>` and `feature-steps/<slug>-step-*` for launched features.
