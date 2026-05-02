---
name: sdd-execute
description: Phase 3 of SDD — execute implementation steps with mandatory codebase discovery and explicit user confirmation before any writes. Usage: /sdd-execute <feature-slug> [step-number|next|all]. Re-reads context.md at every session start so prior decisions carry forward.
argument-hint: <feature-slug> [step-number|next|all]
disable-model-invocation: true
allowed-tools: Read Write Edit Bash(ls *) Bash(find *) Bash(grep *) Bash(mkdir *) Bash(go *) Bash(python *) Bash(buf *) Bash(psql *) Bash(docker *) Bash(git diff *) Bash(git status *) Bash(git fetch *) Bash(git show *) Bash(git ls-remote *) Bash(git checkout *) Bash(git branch *) Bash(git merge *) Bash(git push *) Bash(git add *) Bash(git commit *) Bash(gh pr *)
effort: high
---

You are executing implementation steps for an xstockstrat feature. You follow strict rules: discover before writing, confirm with the user before every step, and document everything in context.md so that any future session can resume without relying on conversation history.

## Arguments

- `$ARGUMENTS[0]` — feature slug. Required.
- `$ARGUMENTS[1]` — step selector: a number (e.g. `3`), `next` (default), or `all`.

---

## BOOT SEQUENCE — Run every session, before any step

**Step B1.** Read `docs/roadmap/features/$ARGUMENTS[0]/implementation-spec.md`.
If absent: stop — "No implementation spec found. Run /sdd-spec $ARGUMENTS[0] first."

**Step B2.** Read `docs/roadmap/features/$ARGUMENTS[0]/feature.md`.
Check lifecycle status. If status is `launched`, `rolled-back`, or `demoted/canceled`:
warn the user — "Feature is marked `<status>`. Proceed anyway? (yes / no)"

**Step B3.** Read `docs/roadmap/features/$ARGUMENTS[0]/context.md`.
This reconstructs everything from prior sessions: deviations, decisions, stopping point, file paths changed. Do not proceed without reading this.

**Step B4.** Read `docs/runbooks/feature-workflow.md`.
Extract and enforce: branch model, migration file naming, proto change gate, PR requirements.

**Step B4.5.** Fetch the feature's integration branch from origin and load authoritative artifacts.

Parse `**Development Branch**` from the already-read `feature.md` — this is `<dev-branch>` (e.g. `feature/<slug>`).
If the field is absent, fall back to `feature/$ARGUMENTS[0]` and note the fallback.

```bash
git fetch origin <dev-branch>
git ls-remote --heads origin <dev-branch>
```

If the `ls-remote` command returns output (branch exists on origin):
- Run the following and replace the in-memory content read in B1–B3 with these authoritative versions:
  ```bash
  git show origin/<dev-branch>:docs/roadmap/features/$ARGUMENTS[0]/implementation-spec.md
  git show origin/<dev-branch>:docs/roadmap/features/$ARGUMENTS[0]/feature.md
  git show origin/<dev-branch>:docs/roadmap/features/$ARGUMENTS[0]/context.md
  ```
- Note to user: "Loaded authoritative spec from `origin/<dev-branch>`."

If the `ls-remote` command returns no output (branch not yet created on origin):
- Use the locally-read files from B1–B3 as-is.
- Note to user: "`origin/<dev-branch>` not found — using local spec (branch not yet pushed)."

**Step B5.** Run `git status`.
`<dev-branch>` was already determined in B4.5.
Evaluate the current branch:
- On `<dev-branch>` or `main-dev` → OK. BRANCH SYNC will handle checkout before each step.
- On `feature-steps/<slug>-step-<N>` matching this feature → note that step N was previously started; BRANCH SYNC will handle.
- On any other branch → stop: "Current branch is `<branch>`, which is unrelated to feature `<slug>`. Check out `<dev-branch>` or `main-dev` before proceeding."

**Step B6.** Announce context to user:
```
Resuming: <slug> (lifecycle: <status>)
Prior sessions: <list ## Session headings from context.md>
Target: Step N — <title>
```

---

## STEP SELECTOR

Parse `$ARGUMENTS[1]`:
- absent or `next` → find the first step where `**Status**: \`pending\``
- a number N → target only Step N
- `all` → process all `pending` steps in order, applying confirmation to each

---

## BRANCH SYNC — Run before Phase 1 of every step

Read `.claude/skills/sdd-execute/templates/branch-sync.md` and execute the procedure,
substituting `<dev-branch>` and `<slug>` from `feature.md` and `<N>` from the current step number.

---

## PER-STEP EXECUTION — 3 mandatory phases

### PHASE 1: Discovery (read-only — no writes under any circumstances)

Re-verify that the codebase matches what the spec documented at spec-generation time.

1. Read every file listed in the step's `**Files**` section.
2. Re-run every grep/ls command listed in the step's `**Codebase Evidence**` section. Confirm each symbol exists at the stated location.
3. If a file does not exist or a symbol is not found at the expected location:
   - Do **not** guess a substitute
   - Do **not** proceed with the step
   - Update the step's `**Status**` to `blocked` in implementation-spec.md
   - Append to context.md (see format below): record what was expected vs. what was found
   - Tell the user: "Step N blocked — `<symbol>` not found at `<path>:<line>`. See context.md."
   - Stop.
4. If all evidence checks out, summarize to the user:
   ```
   Discovery confirmed for Step N — <title>:
   - `<symbol1>` at `<file>:<line>` ✓
   - last migration: `<NNN_name.up.sql>` ✓
   - (etc.)
   ```

### PHASE 2: Change plan + user confirmation (no writes yet)

Present the exact planned changes. Do not write anything until the user explicitly approves.

Format:
```
Ready to execute Step N — <title>.

Planned changes:

1. MODIFY <exact/path/to/file>
   - <what will change, with a 3–5 line code sketch showing the key logic>

2. CREATE <exact/path/to/file>
   - <content description or snippet>

3. (etc.)

Proceed? (yes / no / adjust: <instruction>)
```

**STOP HERE. Wait for the user's reply before writing anything.**

- `no` → mark step `blocked` (user declined), append to context.md, stop.
- `adjust: <instruction>` → incorporate the instruction, re-present the revised plan, wait again.
- `yes` → proceed to Phase 3.

### PHASE 3: Execution

1. Read each target file fully before editing (never overwrite blindly).
2. Apply **only** the changes described in the confirmed plan — no cleanup, no refactoring, no extra improvements.
3. Run the step's `**Verification**` command. Report the exact output.
4. If verification **passes**:
   - Update the step in implementation-spec.md: `**Status**: \`pending\`` → `**Status**: \`done\``
   - If this is the **first step completed** in the feature: update `feature.md` status to `in-progress`, append status history row.
   - If **all steps are now done**: update `feature.md` status to `code-completed`, append status history row.
5. If verification **fails**:
   - Diagnose the failure.
   - If the fix is clear and stays within the step's scope: apply it, re-run verification, report.
   - If the fix requires deviating from the spec: document the deviation (see below) and ask user to confirm before continuing.

### STEP COMMIT + PR — runs immediately after Phase 3 verification passes

Read `.claude/skills/sdd-execute/templates/step-pr-body.md` for the PR body template.
Substitute all `<placeholders>` before use.

1. Stage exactly the files listed in the step's `**Files**` section plus the three spec/context files:
   ```bash
   git add <file1> <file2> ...
   git add docs/roadmap/features/<slug>/implementation-spec.md
   git add docs/roadmap/features/<slug>/feature.md
   git add docs/roadmap/features/<slug>/context.md
   ```
2. Commit:
   ```bash
   git commit -m "feat(<slug>): step <N> — <title>"
   ```
3. Push:
   ```bash
   git push -u origin feature-steps/<slug>-step-<N>
   ```
4. Create PR (use the filled-in body from the template):
   ```bash
   gh pr create \
     --base <dev-branch> \
     --head feature-steps/<slug>-step-<N> \
     --title "feat(<slug>): Step <N> — <title>" \
     --body "$(cat .claude/skills/sdd-execute/templates/step-pr-body.md)"
   ```
   Pass the rendered body with all placeholders substituted.
5. Print the PR URL returned by `gh pr create`.
6. **STOP.** Tell the user:
   ```
   Step <N> complete. PR created: <url>
   Merge the PR into <dev-branch>, then run: /sdd-execute <slug> next
   ```
   Do not proceed to the next step in the same session.

---

## DEVIATION HANDLING

When actual implementation differs from what the spec said:

Append to the `## Deviation Log` section of implementation-spec.md:
```markdown
### Deviation: Step N — <title>
**Spec said**: <exact quote from spec Instructions>
**Actual**: <what was done instead>
**Reason**: <why the deviation was necessary>
```

Also record under `Deviations:` in the context.md step entry.

This mirrors the `docs/roadmap/phase*-deviations.md` pattern used throughout this project.

---

## CONTEXT.MD — Per-step entry format

Append after each step completes (or is blocked/skipped):

```markdown
### Step N — <title> [done|skipped|blocked]
- <1–2 sentences describing what was done or why it was blocked>
- Files modified: `path/to/file`, `path/to/other`
- Deviations: none | <brief description — full detail in Deviation Log>
```

---

## SESSION-END SUMMARY

After the last step in the requested range (or on any stop):

1. Count statuses: done=N, pending=N, blocked=N, skipped=N of total M
2. Update `implementation-spec.md` header `**Status**`:
   - Any steps still pending/blocked → `in-progress`
   - All steps done → `complete`
3. Append to context.md:
   ```markdown
   ## Session <ISO timestamp> — sdd-execute
   **Steps this session**: [list step numbers]
   **Progress**: N done / M total
   **Stopped at**: Step X (<reason, or "all complete">)
   **Next**: /sdd-execute <slug> next
   ```
4. Print to user:
   ```
   Session complete. N/M steps done. Feature lifecycle: <status>.
   Context log: docs/roadmap/features/<slug>/context.md
   Next: /sdd-execute <slug> next
   ```

---

## HARD CONSTRAINTS — Never violate

- **Never write or edit any file before Phase 2 user confirmation.**
- **Never guess a file path or symbol name.** If not found in Phase 1 discovery, block the step.
- **Never commit before Phase 3 verification passes.** All commits happen in STEP COMMIT + PR, after verification.
- **Never target `main-dev` or `main` in a step PR.** Always target the `**Development Branch**` from `feature.md`.
- **Never stage files outside the step's `**Files**` section plus `implementation-spec.md`, `feature.md`, and `context.md`.**
- **Never edit a `.up.sql` migration that has been committed to `main-dev`.** Add a new numbered migration instead.
- **Never make changes outside the current step's scope** — no opportunistic cleanup, no refactoring, no extra files.

---

## REPO CONVENTIONS (from docs/runbooks/feature-workflow.md)

- **Branch model**: `**Development Branch**` in `feature.md` is the integration branch (PR target). Per-step work happens on `feature-steps/<slug>-step-<N>` sub-branches created by BRANCH SYNC. Boot Step B5 validates the current branch context.
- **Proto edits**: after any `.proto` change, run from `packages/proto/`:
  ```bash
  buf lint && buf breaking --against ".git#branch=<dev-branch>"
  ```
  where `<dev-branch>` is the `**Development Branch**` value from `feature.md` (parsed in Boot Step B5).
  If `buf` is not installed: fall back to `grpc_tools.protoc` (precedent: docs/roadmap/phase3-deviations.md) and document as deviation.
- **Migrations**: naming is `NNN_description.up.sql` + `NNN_description.down.sql`. NNN is the next integer after the last file found by `ls services/<name>/migrations/ | sort | tail -1`.
- **After proto changes**: run `./scripts/buf-gen.sh` to regenerate stubs; include generated files in the commit.
- **Config keys**: format is `<service-short-name>.<category>.<key>` — verify before writing.
- **Never edit applied migrations**: any applied `.up.sql` file (committed to main-dev) is immutable; add a new numbered migration for corrections.
