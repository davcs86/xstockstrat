---
name: promote
description: Create a production PR from main-dev to main with auto-generated changelog. Runs buf breaking against main to verify production safety. Usage: /promote
argument-hint: (no arguments)
allowed-tools: Read Write Edit Bash(git fetch *) Bash(git log *) Bash(git diff *) Bash(git show *) Bash(git ls-remote *) Bash(git status *) Bash(git add *) Bash(git commit *) Bash(git push *) Bash(git checkout *) Bash(buf *) Bash(find *) Bash(grep *) Bash(gh pr list *) Bash(gh run list *) Bash(gh workflow run *)
effort: medium
---

You are creating a production promotion PR from `main-dev` to `main` for the xstockstrat platform. This skill uses `main` as the tooling baseline — buf breaking checks against `main`, and the PR targets `main`.

---

## P0. Detect automation state

Before doing anything else, check whether the GitHub Action already handled P1–P6:

```bash
# Check for an open promote PR created by the automation
OPEN_PR=$(gh pr list --base main --head main-dev --state open --json url,title --jq '.[0].url')

# Check for a recent failed workflow run
FAILED_RUN=$(gh run list --workflow=promote.yml --status=failure --limit=1 --json url,conclusion,createdAt --jq '.[0].url')
```

**If `OPEN_PR` is non-empty** → The GitHub Action succeeded. Skip P1–P6 entirely.
Print: "GitHub Action created the PR: `<url>`. Proceeding with feature tracking (P7) only."
Go directly to P7 using the PR URL from `OPEN_PR`.

**If `OPEN_PR` is empty AND `FAILED_RUN` is non-empty** → The GitHub Action ran but failed.
Print: "Automation failed. Run logs: `<FAILED_RUN url>`. Falling back to manual P1–P6."
Proceed with P1–P6 below, then P7. At the end of P6 report: "Completed P1–P6 manually (automation failure fallback)."

**If both are empty** → The automation has not been triggered. Ask the user:
"No promotion PR found and no recent workflow run detected. Should I:
  1. Trigger the GitHub Action (`promote.yml`) and wait for it to complete, then do P7
  2. Handle P1–P6 here directly

Which would you prefer?"

- If the user chooses **trigger**:
  ```bash
  gh workflow run promote.yml --ref main-dev
  ```
  Then poll every 15 seconds until the run completes:
  ```bash
  gh run list --workflow=promote.yml --limit=1 --json status,conclusion,url --jq '.[0]'
  ```
  - If the run succeeds → do P7.
  - If the run fails → print the run URL and offer to fall back to P1–P6.

- If the user chooses **handle here** → proceed with P1–P6 below, then P7.

---

---

## P1. Validate state

Fetch both branches:
```bash
git fetch origin main main-dev
```

Check that `main-dev` is ahead of `main`:
```bash
git log origin/main..origin/main-dev --oneline
```

If the output is empty: stop — "main-dev has no commits ahead of main. Nothing to promote."

Check for an existing open PR from `main-dev` to `main`:
```bash
git ls-remote --heads origin main-dev
```

Also check via gh if an open PR already exists:
```bash
gh pr list --base main --head main-dev --state open
```

If an open PR exists: stop and print — "A promote PR is already open: <URL>. Close or merge it before creating a new one."

---

## P2. Collect changelog inputs

**Merge commits since last promotion:**
```bash
git log origin/main..origin/main-dev --merges --oneline
```

**New migrations since main:**
```bash
git diff --name-only origin/main origin/main-dev -- services/*/migrations/
```
Filter to only `*.up.sql` files.

**Proto changes since main:**
```bash
git diff --name-only origin/main origin/main-dev -- packages/proto/
```
Filter to only `*.proto` files (not generated stubs).

**Features at `code-completed`:**
```bash
find docs/roadmap/features -name feature.md
```
Read each `feature.md` and collect:
- Entries where `**Lifecycle Status**` is `code-completed` AND `**Type**` is `feature` (or `**Type**` is absent — default is `feature`). Extract slug and **Summary** first sentence.
- Entries where `**Lifecycle Status**` is `code-completed` AND `**Type**` is `bug`. Extract slug, **Summary** first sentence, and `**Severity**`.

For each result, capture the full feature directory path as `FEATURE_DIR` (e.g.
`docs/roadmap/features/001-add-ikbr-account-support`). Derive the display slug by stripping the
leading `NNN-` prefix from the directory basename
(e.g. `001-add-ikbr-account-support` → `add-ikbr-account-support`).
Use `FEATURE_DIR` for all file read/write operations; use the stripped slug for CHANGELOG display.

**Commit count:**
```bash
git log origin/main..origin/main-dev --oneline | wc -l
```

---

## P3. Run buf breaking against main (tooling points to main)

```bash
cd packages/proto
buf breaking . --against '../../.git#branch=origin/main,subdir=packages/proto'
```

- If no breaking changes: continue.
- If breaking changes found: print the output, then ask the user:
  "Breaking proto changes detected. These require sign-off per `docs/runbooks/proto-versioning.md` before this PR can merge. Proceed with creating the PR anyway? (yes / no)"
  If user says no: stop.

---

## P4. Format the changelog entry

Use today's date in `YYYY-MM-DD` format. Format the entry as:

```markdown
## YYYY-MM-DD

### Features
- <slug>: <summary sentence> (`code-completed`)

(omit this section if no features at code-completed)

### Bug Fixes
- <slug> [<SEV-N>]: <summary sentence> (`code-completed`)

(omit this section if no bugs at code-completed)

### Proto Changes
- <filename.proto>

(omit this section if no proto changes)

### DB Migrations
- <service>: <migration-filename.up.sql>

(omit this section if no new migrations)

### Summary
<N> commits, <M> feature merges since last promotion.
```

If there are no features, bug fixes, proto changes, or migrations — just include the Summary line.

---

## P5. Update CHANGELOG.md

Read `CHANGELOG.md` at the repo root.

If it does not exist, create it with this header:
```markdown
# Changelog

All production promotions from `main-dev` to `main` are recorded here.
Each entry corresponds to one `main-dev → main` PR merge.

---

```

Prepend the new changelog entry (from P4) immediately after the `---` separator line.

Write the file back.

Commit the update to `main-dev`:
```bash
git add CHANGELOG.md
git commit -m "chore: update CHANGELOG for <YYYY-MM-DD> promotion"
git push origin main-dev
```

---

## P6. Create PR from main-dev → main

Build the PR body from the changelog entry plus these sections:

```
## Promotion Checklist

- [ ] All services smoke-tested on dev (paper trading) environment
- [ ] No open incidents or active maintenance mode on dev
- [ ] Config keys for new features registered in prod config service (see docs/runbooks/config-rollout.md)
- [ ] Proto breaking changes signed off (if any — see docs/runbooks/proto-versioning.md)

> ⚠️ **Merge strategy: "Create a merge commit" — NEVER squash or rebase.**
> Squash-merging breaks git ancestry and causes `main-dev` to appear permanently ahead of `main`.
> On GitHub: click the dropdown arrow next to the merge button → **"Create a merge commit"**.

## Changelog

<changelog entry from P4>
```

Create the PR:
```bash
gh pr create \
  --base main \
  --head main-dev \
  --title "release: promote main-dev to main (YYYY-MM-DD)" \
  --body "<PR body above>"
```

Print the PR URL.

---

## P7. Update feature tracking

For each feature **or bug** found at `code-completed` in P2:

Read its `$FEATURE_DIR/feature.md` (using the `FEATURE_DIR` captured in P2). Add a new row to the **Status History** table:

```markdown
| YYYY-MM-DD | `code-completed` → `launched (pending merge)` | /promote | Promote PR created: <PR URL> |
```

Write the file back.

Append to `$FEATURE_DIR/context.md`:

```markdown
## Session YYYY-MM-DD (/promote)

- Promote PR created: <PR URL>
- Lifecycle updated to `launched (pending merge)`
- After the PR merges to main, update feature.md status to `launched`
```

---

## P8. Announce result

Print a summary:

```
Promotion PR created: <PR URL>
Branch: main-dev → main
Changelog: CHANGELOG.md updated

Features included (code-completed):
  - <slug>: <summary>

Bug fixes included (code-completed):
  - <slug> [<SEV-N>]: <summary>

Next steps:
  1. Complete the Promotion Checklist in the PR description.
  2. Get at least 1 reviewer approval (branch protection enforced).
  3. After merging, update each feature.md status from 'launched (pending merge)' to 'launched'.
  4. The sync-main-to-maindev workflow runs automatically after the PR merges —
     it merges the resulting main commit back into main-dev so the branches
     stay in sync. No manual action needed unless the workflow reports a conflict.
```

---

## Post-merge sync (automated)

After the promotion PR merges to `main`, the `.github/workflows/sync-main-to-maindev.yml`
workflow fires automatically. It merges the new `main` tip back into `main-dev`, ensuring
`main-dev` always contains every commit that is on `main`.

**If the workflow fails** (e.g. merge conflict from a commit pushed directly to `main`):
1. Fetch both branches locally.
2. Check out `main-dev`.
3. Run `git merge origin/main` and resolve conflicts.
4. Push: `git push origin main-dev`.
