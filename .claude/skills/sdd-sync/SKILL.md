---
name: sdd-sync
description: Sync authoritative spec files from feature branches into main-dev. Usage: /sdd-sync [feature-slug]. Reads feature.md, product-spec.md, implementation-spec.md, and context.md from origin/feature/<slug> and opens a PR targeting main-dev.
argument-hint: [feature-slug]
allowed-tools: Read Write Bash(ls *) Bash(find *) Bash(mkdir *) Bash(git *) Bash(gh pr *)
effort: low
---

You are syncing authoritative SDD spec files from feature branches into main-dev. Feature branches are the source of truth for SDD artifacts; this skill brings main-dev's copy up to date without waiting for the final integration PR. Changes are docs-only — no service code is touched.

## Arguments

- `$ARGUMENTS[0]` — feature slug (optional). If absent, sync all features that have a live feature branch on origin.

---

## SPEC FILES

The four SDD artifacts per feature (directory is `NNN-<slug>`, e.g. `001-add-ikbr-account-support`):
- `docs/roadmap/features/<NNN-slug>/feature.md`
- `docs/roadmap/features/<NNN-slug>/product-spec.md`
- `docs/roadmap/features/<NNN-slug>/implementation-spec.md`
- `docs/roadmap/features/<NNN-slug>/context.md`

`origin/feature/<slug>` is always the authoritative source (branch name has no NNN prefix).
Sync is one-way: feature branch → main-dev. Files that do not exist on the feature branch are never touched on main-dev.

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
  Capture as `FEATURE_DIR`. Derive `<slug>` = `$ARGUMENTS[0]` (already known).

If `$ARGUMENTS[0]` is absent:
```bash
find docs/roadmap/features -maxdepth 1 -mindepth 1 -type d | sort
```
For each result (e.g. `docs/roadmap/features/001-add-ikbr-account-support`):
- Use the full directory path as `FEATURE_DIR`.
- Derive `<slug>` by stripping the `NNN-` prefix: `sed 's/^[0-9][0-9][0-9]-//'` from the basename.
(`-type d` automatically skips regular files like `merge-order.md`.)

### Step 3 — Detect changed files

For each slug:

**a.** Check whether `origin/feature/<slug>` exists:
```bash
git ls-remote --heads origin feature/<slug>
```
If the command returns no output: skip this feature. Note: "Skipping `<slug>` — no feature branch found on origin."

**b.** If the branch exists, evaluate each spec file:

For each file in `{feature.md, product-spec.md, implementation-spec.md, context.md}`:

1. Confirm the file exists on the feature branch:
   ```bash
   git show origin/feature/<slug>:$FEATURE_DIR/<file> > /dev/null 2>&1
   ```
   If the command fails: skip this file — nothing to sync from the feature branch.

2. Compare with main-dev:
   ```bash
   git diff --quiet origin/main-dev:$FEATURE_DIR/<file> \
             origin/feature/<slug>:$FEATURE_DIR/<file> 2>/dev/null
   echo $?
   ```
   - Exit code `0` → files are identical → skip.
   - Exit code `1` → files differ → mark for sync.
   - Command errors (file absent on main-dev, exit 128) → mark for sync (new file to create).

Collect all `(slug, file)` pairs that need syncing.

### Step 4 — Early exit if nothing to sync

If no files are marked for sync across all features, print:
```
All spec files on main-dev are already up to date with their feature branches.
```
Stop. Do not create a branch or PR.

### Step 5 — Prepare sync branch

```bash
git checkout main-dev
git pull origin main-dev
git checkout -b claude/sync-specs-<YYYYMMDD>
```

Use today's date (YYYYMMDD format) as the suffix. If `claude/sync-specs-<YYYYMMDD>` already exists locally or on origin, append `-2`, `-3`, etc. until an unused name is found.

### Step 6 — Write synced files

For each `(FEATURE_DIR, slug, file)` tuple marked for sync:

1. Ensure the directory exists:
   ```bash
   mkdir -p $FEATURE_DIR
   ```

2. Read the file content from the feature branch:
   ```bash
   git show origin/feature/<slug>:$FEATURE_DIR/<file>
   ```

3. Write the captured content to `$FEATURE_DIR/<file>` using the Write tool.

### Step 7 — Commit

Stage all changed spec files:
```bash
git add docs/roadmap/features/
```

Commit with a descriptive message listing each feature and which files changed:
```bash
git commit -m "docs: sync spec files from feature branches

Features synced:
- <slug>: <file1>, <file2>, ...
- <slug>: <file1>, ..."
```

### Step 8 — Push and create PR

```bash
git push -u origin claude/sync-specs-<YYYYMMDD>
```

Create the PR:
```bash
gh pr create \
  --base main-dev \
  --head claude/sync-specs-<YYYYMMDD> \
  --title "docs: sync spec files from feature branches" \
  --body "$(cat <<'EOF'
## Summary

Syncs authoritative SDD spec files from feature branches into main-dev so that docs reflect the latest progress without waiting for final integration PRs.

**Direction**: one-way, feature branch → main-dev (docs only, no service code)

### Files synced

| Feature | Files changed |
|---------|--------------|
| <slug> | <file list> |

## Review notes

These are documentation-only changes. Verify that the spec content matches the expected state of each feature before merging.
EOF
)"
```

Print the PR URL returned by `gh pr create`.

### Step 9 — Summary

Print:
```
Sync complete.
Branch:  claude/sync-specs-<YYYYMMDD>
PR:      <url>

Features synced:
  <slug>: feature.md, implementation-spec.md, context.md  (3 files)
  <slug>: context.md  (1 file)

Merge the PR into main-dev to bring spec files up to date.
```

---

## HARD CONSTRAINTS

- **Never sync in the reverse direction** (main-dev → feature branch). This skill is read-only with respect to feature branches.
- **Never touch service code files.** Only files under `docs/roadmap/features/` are written.
- **Never delete a file from main-dev** because it is absent on the feature branch — absence on the feature branch means skip, not delete.
- **Never create the sync branch from anything other than an up-to-date main-dev.**
- **Never push directly to main-dev.** Always via a `claude/sync-specs-*` PR.
