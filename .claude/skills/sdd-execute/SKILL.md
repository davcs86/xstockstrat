---
name: sdd-execute
description: Phase 3 of SDD — execute implementation steps with mandatory codebase discovery and explicit user confirmation before any writes. Usage: /sdd-execute <feature-slug> [step-number|next|all|sequential]. `sequential` runs a feature (or an ordered multi-feature sequence with per-feature re-spec) end-to-end as stacked per-step PRs, with one up-front confirmation per feature instead of a per-step stop. Re-reads context.md at every session start so prior decisions carry forward.
argument-hint: <feature-slug | "feat-a (re-spec if needed) > feat-b ..."> [step-number|next|all|sequential]
allowed-tools: Read Write Edit Task Bash(ls *) Bash(find *) Bash(grep *) Bash(mkdir *) Bash(go *) Bash(go install *) Bash(golangci-lint *) Bash(python *) Bash(python3 *) Bash(uv *) Bash(pip *) Bash(ruff *) Bash(pnpm *) Bash(npx *) Bash(buf *) Bash(curl *) Bash(psql *) Bash(docker *) Bash(git diff *) Bash(git status *) Bash(git fetch *) Bash(git pull *) Bash(git show *) Bash(git ls-remote *) Bash(git checkout *) Bash(git branch *) Bash(git merge *) Bash(git rebase *) Bash(git push *) Bash(git add *) Bash(git commit *) Bash(gh pr *)
effort: high
---

You are executing implementation steps for an xstockstrat feature. You follow strict rules: discover before writing, confirm before writes (per step in the default modes; **once up-front per feature** in `sequential` mode — see `reference/sequential-mode.md`), and document everything in context.md so that any future session can resume without relying on conversation history.

**Progressive disclosure**: this file is the always-loaded core (boot, the 3-phase per-step
execution, commit/PR, and the HARD CONSTRAINTS safety rails). Three `reference/` files load only
when their path activates — do not read them up front:
- `reference/sequential-mode.md` — read **only** when `$ARGUMENTS[1] == sequential`.
- `reference/deviation-handling.md` — read when a deviation or in-scope-unresolvable gap arises.
- `reference/repo-conventions.md` — read when a step touches proto / migrations / config keys / lint / header propagation.

## Arguments

- `$ARGUMENTS[0]` — feature slug (required). In `sequential` mode this may instead be an **ordered
  feature sequence**: features separated by `>` or `→`, each optionally followed by an inline re-spec
  directive in parentheses, e.g. `"003 (re-spec if needed) > 019 > 016 (re-spec Steps 5-6 first)"`.
- `$ARGUMENTS[1]` — step selector: a number (e.g. `3`), `next` (default), `all`, or `sequential`.

**Mode gating:** every behavior in `reference/sequential-mode.md` and every "sequential-mode" carve-out
applies **only** when `$ARGUMENTS[1] == sequential`. When the selector is a number, `next`, or `all`,
this skill behaves exactly as before (per-step Phase-2 confirmation + per-step STOP).

---

## BOOT SEQUENCE — Run every session, before any step

**Step B0.** Resolve the feature directory:
```bash
find docs/roadmap/features -maxdepth 1 -type d -name "*-$ARGUMENTS[0]"
```
If no directory is found: stop — "No feature directory found for slug `$ARGUMENTS[0]`. Run /sdd-story first."
Capture the result as `FEATURE_DIR` (e.g. `docs/roadmap/features/001-add-ikbr-account-support`).
Use `$FEATURE_DIR` for all file reads and writes in this skill.

**Step B1.** Check that `$FEATURE_DIR/implementation-spec.md` exists:
```bash
ls $FEATURE_DIR/implementation-spec.md 2>/dev/null
```
If the file is not found: stop — "No implementation spec found. Run /sdd-spec $ARGUMENTS[0] first."
Do not read the file contents yet — authoritative content will be loaded in B3.

**Step B2.** Read `$FEATURE_DIR/feature.md`.
Check lifecycle status. If status is `launched`, `rolled-back`, or `demoted/canceled`:
warn the user — "Feature is marked `<status>`. Proceed anyway? (yes / no)"

**Step B3.** Fetch the feature's integration branch from origin and load authoritative artifacts.

Parse `**Development Branch**` from the already-read `feature.md` — this is `<dev-branch>` (e.g. `feature/<slug>`).
If the field is absent, fall back to `feature/$ARGUMENTS[0]` and note the fallback.

```bash
git fetch origin <dev-branch>
git ls-remote --heads origin <dev-branch>
```

If the `ls-remote` command returns output (branch exists on origin):
- Run the following to load the authoritative versions of the three spec files:
  ```bash
  git show origin/<dev-branch>:$FEATURE_DIR/implementation-spec.md
  git show origin/<dev-branch>:$FEATURE_DIR/feature.md
  git show origin/<dev-branch>:$FEATURE_DIR/context.md
  ```
- If the `git show` for `context.md` returns an error (file not yet on this branch), fall back to the local working tree: Read `$FEATURE_DIR/context.md`. If the local file also does not exist, treat context.md as empty and note: "No prior session history found (context.md not yet on remote)."
- Note to user: "Loaded authoritative spec from `origin/<dev-branch>`."

If the `ls-remote` command returns no output (branch not yet created on origin):
- Fall back to reading from `origin/main-dev`:
  ```bash
  git fetch origin main-dev
  git show origin/main-dev:$FEATURE_DIR/implementation-spec.md
  git show origin/main-dev:$FEATURE_DIR/feature.md
  git show origin/main-dev:$FEATURE_DIR/context.md
  ```
- If the `git show` for `context.md` returns an error (file not yet on main-dev), fall back to the local working tree: Read `$FEATURE_DIR/context.md`. If the local file also does not exist, treat context.md as empty and note: "No prior session history found (context.md not yet pushed)."
- These are now the authoritative spec files for the session.
- Note to user: "`origin/<dev-branch>` not found — loaded spec from `origin/main-dev` (feature branch not yet pushed)."

**Step B4.** Run `git status`.
`<dev-branch>` was already determined in B3.
Evaluate the current branch:
- On `<dev-branch>` or `main-dev` → OK. BRANCH SYNC will handle checkout before each step.
- On `feature-steps/<slug>-step-<N>` matching this feature → note that step N was previously started; BRANCH SYNC will handle.
- On any other branch → stop: "Current branch is `<branch>`, which is unrelated to feature `<slug>`. Check out `<dev-branch>` or `main-dev` before proceeding."

**Step B5.** Announce context to user:
```
Resuming: <slug> (lifecycle: <status>)
Prior sessions: <list ## Session headings from context.md>
Target: Step N — <title>
```

---

## STEP SELECTOR

Parse `$ARGUMENTS[1]`:
- `sequential` → **do not** resolve a single step here. Read `reference/sequential-mode.md` and hand
  control to it; that driver parses the feature sequence and runs the per-feature loop.
- absent or `next` → find the first step where `**Status**: \`pending\``
- a number N → target only Step N
- `all` → process all `pending` steps in order, applying confirmation to each.
  (Note: the per-step STOP in STEP COMMIT + PR currently halts after the first step, so `all` does not
  run multiple steps in one session — use `sequential` for an unattended multi-step run.)

If no `pending` steps are found (all steps are `done`, `skipped`, or `blocked`):
→ go to **ALL-DONE PATH** below instead of stopping.

---

## SEQUENTIAL MODE

When `$ARGUMENTS[1] == sequential`, read **`reference/sequential-mode.md`** and follow it end to end.
It is a self-contained driver (feature-sequence parsing, mode-entry confirmation, per-feature re-spec
gate, stacked step loop, integration PR + CI watch, blocker handling) plus the sequential-mode
carve-outs to HARD CONSTRAINTS and the CI-equivalent verification fallbacks. Do not load it for any
other selector.

---

## ALL-DONE PATH — runs when no pending steps remain

When invoked and all steps are already complete (lifecycle `code-completed`):

1. **Merge-order gate** — same check as STEP COMMIT + PR step 4:
   a. Read `docs/roadmap/features/merge-order.md`.
   b. If `<slug>` appears in the **Feature** column and **Resolved** ≠ `Yes`:
      > "merge-order.md requires `<blocking-feature>` to merge first.
      > Reason: <reason>
      > Create the integration PR anyway? (yes / no)"
      - `no` → stop without creating PR.
      - `yes` → proceed.
   c. No entry (or Resolved = Yes) → proceed without warning.

2. **Ensure the feature branch is current:**
   ```bash
   git checkout <dev-branch>
   git pull origin <dev-branch>
   ```

3. **Build the integration PR body** by rendering `.claude/skills/sdd-execute/templates/integration-pr-body.md`
   (title; per-step one-liners from implementation-spec.md; new migrations; new env vars; deviation
   summary from the Deviation Log; test-plan checklist).

4. **Create the integration PR** using `mcp__github__create_pull_request` (not `gh pr create`):
   - `base`: `main-dev`
   - `head`: `<dev-branch>`
   - title and body as built above

5. **Print and stop:**
   ```
   Integration PR created: <url>
   Merge when CI passes and reviewers approve.
   ```

---

## BRANCH SYNC — Run before Phase 1 of every step

Read `.claude/skills/sdd-execute/templates/branch-sync.md` and execute the procedure,
substituting `<dev-branch>` and `<slug>` from `feature.md` and `<N>` from the current step number.
`<base-branch>` defaults to `<dev-branch>`; in **sequential mode** pass the prior step branch for
steps after the first (`reference/sequential-mode.md` §5.5).

---

## PER-STEP EXECUTION — 3 mandatory phases

### PHASE 1: Discovery (read-only — no writes under any circumstances)

Re-verify that the codebase matches what the spec documented at spec-generation time.

**Delegation (recommended when the step lists several files or greps):** hand the step's `**Files**`
and `**Codebase Evidence**` commands to a **`codebase-discovery`** subagent via the Task tool. It reads
and re-runs them in its own window and returns a confirmed/blocked digest (`path:line` for each symbol,
plus a `## Not found` section). This keeps the verification reads out of this window — you read the
target files fresh in Phase 3 only if you proceed to edit. For a single-file step you may verify inline
instead. Either way, apply the exact block/confirm logic below to the result.

1. Read every file listed in the step's `**Files**` section (or take them from the discovery digest).
2. Re-run every grep/ls command listed in the step's `**Codebase Evidence**` section. Confirm each symbol exists at the stated location.
3. If a file does not exist or a symbol is not found at the expected location (the digest reports it under `## Not found`):
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
   - Update **only** the step's `**Status**` field in implementation-spec.md: `**Status**: \`pending\`` → `**Status**: \`done\``
   - **Do NOT modify any other part of the step** — `**Instructions**`, `**Codebase Evidence**`, `**Verification**`, `**Files**`, and `**Reviewers**` are immutable records of the original plan. Deviations go in the `## Deviation Log` only.
   - If this is the **first step completed** in the feature: update `feature.md` status to `in-progress`, append status history row.
   - If **all steps are now done**: update `feature.md` status to `code-completed`, append status history row.
5. If verification **fails**:
   - Diagnose the failure.
   - If the fix is clear and stays within the step's scope: apply it, re-run verification, report.
   - If the fix requires deviating from the spec: follow `reference/deviation-handling.md` (document the deviation and ask the user to confirm before continuing).

### STEP COMMIT + PR — runs immediately after Phase 3 verification passes

Read `.claude/skills/sdd-execute/templates/step-pr-body.md` for the PR body template.
Substitute all `<placeholders>` before use.

1. Stage exactly the files listed in the step's `**Files**` section plus the three spec/context files:
   ```bash
   git add <file1> <file2> ...
   git add $FEATURE_DIR/implementation-spec.md
   git add $FEATURE_DIR/feature.md
   git add $FEATURE_DIR/context.md
   ```
2. Commit:
   ```bash
   git commit -m "feat(<slug>): step <N> — <title>"
   ```
3. Push:
   ```bash
   git push -u origin feature-steps/<slug>-step-<N>
   ```
4. **Merge-order gate (final integration PR only)**

   If this is the **last step** (all steps are now `done`) and the next PR would target
   `<dev-branch>` (the feature integration branch → `main-dev`), run this gate first:

   a. Read `docs/roadmap/features/merge-order.md`.
   b. Check if `<slug>` appears in the **Feature** column of the Blocking Dependencies table.
   c. If a blocking entry exists and the **Resolved** column is not `Yes`:
      > "merge-order.md requires `<blocking-feature>` to merge first.
      > Reason: <reason from merge-order.md>
      > Create the final integration PR anyway? (yes / no)"
      - If `no`: stop. Do not create the PR.
      - If `yes`: proceed.
   d. If no entry for `<slug>` (or Resolved = Yes): proceed without warning.

   This gate only applies to the integration PR (feature branch → `main-dev`).
   Per-step PRs (step branch → feature branch) are not subject to this gate.

5. Create PR (use the filled-in body from the template):
   ```bash
   gh pr create \
     --base <dev-branch> \
     --head feature-steps/<slug>-step-<N> \
     --title "feat(<slug>): Step <N> — <title>" \
     --body "$(cat .claude/skills/sdd-execute/templates/step-pr-body.md)"
   ```
   Pass the rendered body with all placeholders substituted.
   If `gh` is unavailable, use `mcp__github__create_pull_request` with the same `base`/`head`/`title`/
   `body`. **Sequential mode** always uses `mcp__github__create_pull_request` and sets
   `base` = the prior step branch (or `<dev-branch>` for the first executed step) — see
   `reference/sequential-mode.md` §5.6.
6. Print the PR URL returned by `gh pr create`.
7. **STOP.** Tell the user:
   ```
   Step <N> complete. PR created: <url>
   Merge the PR into <dev-branch>, then run: /sdd-execute <slug> next
   ```
   Do not proceed to the next step in the same session.
   **Sequential-mode override:** do NOT stop — print "Step <N> done (PR <url>). Continuing to Step
   <N+1>." and proceed to the next step (`reference/sequential-mode.md` §5.5).

---

## DEVIATION HANDLING

When actual implementation differs from what the spec said, or when Phase 2/Phase 3 surfaces an
in-scope-unresolvable gap, follow **`reference/deviation-handling.md`** — the `## Deviation Log` entry
format and the mandatory A/B/C "no vague deferrals" gap protocol (with its sequential-mode
`AskUserQuestion` override). Never write "deferred" without a specific target step or explicit user
sign-off.

---

## CONTEXT.MD — Per-step entry format

Append after each step completes (or is blocked/skipped):

```markdown
### Step N — <title> [done|skipped|blocked]
- <1–2 sentences describing what was done or why it was blocked>
- Files modified: `path/to/file`, `path/to/other`
- Deviations: none | <brief description — full detail in Deviation Log>
```

If the feature uses the structured-header memory schema (`docs/patterns/context-engineering.md`), also
update the `## Files Modified` and `## Open Threads` header blocks — not just the session log.

---

## SESSION-END SUMMARY

In **sequential mode**, write this summary per feature (after its integration PR opens) and once more
for the whole run; the "Next" line becomes the next feature in the sequence, or "sequence complete" at
the end. Otherwise:

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
   Context log: $FEATURE_DIR/context.md
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
- **Never make changes outside the current step's scope** — no opportunistic cleanup, no refactoring, no extra files. (Exception: making the code the step *itself* introduced pass the step's lint/format Verification — e.g. `ruff format`, gofmt, or fixing a `golangci-lint`/`pnpm run lint` finding on the step's own changed lines — is in scope, not cleanup. Do not reformat or lint-fix code the step did not touch.)
- **`implementation-spec.md` step bodies are immutable during execution.** The only permitted change to a step entry is flipping `**Status**` from `pending` to `done` (or `blocked`/`skipped`). The `**Instructions**`, `**Codebase Evidence**`, `**Verification**`, `**Files**`, and `**Reviewers**` fields must never be edited — they are the permanent record of the original plan. All divergence from that plan belongs exclusively in the `## Deviation Log` section.

**Sequential-mode carve-outs** to these constraints (mode-entry + per-feature confirmation satisfying
the Phase-2 gate, the re-spec exception, stacked step PRs, auto-applied verification fallbacks) apply
**only** when `$ARGUMENTS[1] == sequential` and are documented in `reference/sequential-mode.md`. All
other HARD CONSTRAINTS remain in force in every mode.

---

## REPO CONVENTIONS

Proto/migration/config-key/lint/header-propagation conventions from `docs/runbooks/feature-workflow.md`
live in **`reference/repo-conventions.md`**. Load it when a step touches any of those areas.
