---
name: sdd-status
description: Show feature implementation status for all or a specific feature. Usage: /sdd-status [feature-slug]. Lists lifecycle status, step completion, last session, and next action. Read-only — makes no changes.
argument-hint: [feature-slug]
allowed-tools: Read Bash(ls *) Bash(find *) Bash(grep *) Bash(git fetch *) Bash(git show *) Bash(git ls-remote *)
effort: low
---

You are reporting the status of SDD features. This skill is read-only — you make no changes to any files.

## Arguments

- `$ARGUMENTS[0]` — feature slug (optional). If absent, show all features.

---

## If no slug provided — show all features

1. Run: `find docs/roadmap/features -maxdepth 1 -mindepth 1 -type d | sort`
1.5. Fetch all feature branches at once so the reads below use authoritative remote state:
   ```bash
   git fetch origin
   ```
2. For each directory found (e.g. `docs/roadmap/features/001-add-ikbr-account-support`):
   - Extract the full directory name (e.g. `001-add-ikbr-account-support`).
   - Derive `<NNN>` (the numeric prefix) and `<slug>` (the part after the first `-` that follows NNN)
     by stripping the leading `NNN-` prefix: `slug=$(basename <dir> | sed 's/^[0-9][0-9][0-9]-//')`.
   - Check whether `origin/feature/<slug>` exists:
     ```bash
     git ls-remote --heads origin feature/<slug>
     ```
   - If it exists: read `feature.md`, `implementation-spec.md`, and `context.md` using
     `git show origin/feature/<slug>:<full-dir-path>/<file>`.
   - If it does not exist: fall back to `git show origin/main-dev:<full-dir-path>/<file>` for each file.
   - From the chosen source: extract `**Lifecycle Status**`, `**Type**` (if present — `feature` or `bug`; default `feature` if absent), and the last row of the Status History table from `feature.md`; count steps by status from `implementation-spec.md` (grep for `` **Status**: `done` ``, `` **Status**: `pending` ``, `` **Status**: `blocked` ``, `` **Status**: `in-progress` ``); find the most recent `## Session` heading from `context.md`.

3. Print two tables — features first, bugs second (omit a table if it has no rows):

```
Features
#    | Slug                  | Status               | Steps     | Last Session
-----|---------------------- |----------------------|-----------|----------------------------
001  | polygon-data-source   | in-progress          | 3/7 done  | 2026-05-01 sdd-execute
002  | rsi-alert             | implementation-ready | 0/5 done  | 2026-04-30 sdd-spec
003  | legacy-cleanup        | demoted/canceled     | —         | 2026-04-28 sdd-story

Bugs
#    | Slug                       | Status      | Steps    | Severity | Last Session
-----|----------------------------|-------------|----------|----------|----------------------------
004  | fix-42-wrong-pnl-portfolio | draft       | —        | SEV-2    | 2026-05-02 sdd-triage
005  | fix-51-order-stuck         | in-progress | 2/4 done | SEV-1    | 2026-05-03 sdd-execute
```

For bug rows, also extract `**Severity**` from `feature.md` (default `—` if absent).

4. After the tables, print:
   - Features/bugs with `blocked` steps: "⚠ Blocked steps in: <slug-list>"
   - If no features exist: "No features found. Start with: /sdd-story <slug> <story text>"
   - If no bugs exist: (omit — no message needed)

---

## If slug provided — show detail for one feature

### 0. Resolve feature directory and fetch authoritative state

Resolve the feature directory for this slug:
```bash
find docs/roadmap/features -maxdepth 1 -type d -name "*-$ARGUMENTS[0]"
```
If no directory is found: stop — "No feature directory found for slug `$ARGUMENTS[0]`."
Capture as `FEATURE_DIR` (e.g. `docs/roadmap/features/001-add-ikbr-account-support`).

```bash
git fetch origin feature/$ARGUMENTS[0]
git ls-remote --heads origin feature/$ARGUMENTS[0]
```

If the branch exists on origin: read `feature.md`, `implementation-spec.md`, and `context.md` using:
```bash
git show origin/feature/$ARGUMENTS[0]:$FEATURE_DIR/feature.md
git show origin/feature/$ARGUMENTS[0]:$FEATURE_DIR/implementation-spec.md
git show origin/feature/$ARGUMENTS[0]:$FEATURE_DIR/context.md
```
Use these as the authoritative source for all steps below. Note: "Reading from `origin/feature/$ARGUMENTS[0]`."

If the branch does not exist on origin: fall back to `origin/main-dev`:
```bash
git fetch origin main-dev
git show origin/main-dev:$FEATURE_DIR/feature.md
git show origin/main-dev:$FEATURE_DIR/implementation-spec.md
git show origin/main-dev:$FEATURE_DIR/context.md
```
Note: "`origin/feature/$ARGUMENTS[0]` not found — reading from `origin/main-dev`."

### 1. Read feature.md

Print:
```
Feature: <slug>
Type: <feature | bug>
Lifecycle Status: <status>
Severity: <SEV-N>          (omit if Type is feature)
GitHub Issue: <url>        (omit if Type is feature or no issue linked)

Status History:
<full table from feature.md>
```

### 2. Read implementation-spec.md (if exists)

Print all steps with their current statuses:
```
Implementation Steps:
  Step 1 [done]     — proto: Add IngestSignal RPC
  Step 2 [done]     — proto-gen: Regenerate stubs
  Step 3 [pending]  — migration: Add signals table
  Step 4 [blocked]  — service: Register handler (see context.md)
  Step 5 [pending]  — config: Add ingest.signals.enabled key
```

Highlight any `blocked` steps with a note: "Step N is blocked — check context.md for details."

### 3. Read context.md (if exists)

Print all session entries (## Session headings) with their summaries:
```
Session Log:
  2026-05-01T10:00Z — sdd-story: created product-spec.md
  2026-05-01T11:30Z — sdd-spec: generated 7 steps, status → implementation-ready
  2026-05-01T14:00Z — sdd-execute: steps 1–2 done, stopped at step 3
```

### 4. Merge-order status (code-completed features only)

If lifecycle status is `code-completed`:

Read `docs/roadmap/features/merge-order.md`. Check whether `<slug>` appears in the
**Feature** column of the Blocking Dependencies table.

Print:
- If a blocking entry exists and Resolved ≠ Yes:
  ```
  ⏸ Merge blocked — waiting for `<blocking-feature>` to reach `launched`
     Reason: <reason from merge-order.md>
     See: docs/roadmap/features/merge-order.md
  ```
- If no entry or Resolved = Yes:
  ```
  ✓ No merge-order dependency — ready to open final integration PR
  ```

### 5. Print recommended next action

- Status `code-completed`, merge blocked → "Resolve merge-order dependency first (see above), then open final PR with /sdd-execute <slug> next"
- Status `code-completed`, no blocker → "Feature complete (code-completed). Open the final integration PR: /sdd-execute <slug> next"
- Status `launched` → "Feature is live in production."
- Any `blocked` steps → "Step N is blocked. Read context.md and resolve the blocker, then re-run /sdd-execute <slug> N"
- Steps pending → "/sdd-execute <slug> next  (next: Step N — <title>)"
- Status `implementation-ready`, no execution started → "/sdd-review <slug> impl-spec  (validate spec before executing)"
- No implementation-spec.md → "/sdd-spec <slug>  (implementation spec not yet generated)"
- Status `spec-ready` → "/sdd-spec <slug>  (product spec approved — generate implementation spec)"
- Status `draft` → "/sdd-review <slug> product-spec  (product spec awaiting AI review)"
- No product-spec.md → "/sdd-story <slug>  (no product spec — provide story text)"
