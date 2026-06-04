---
name: sdd-execute
description: Phase 3 of SDD — execute implementation steps with mandatory codebase discovery and explicit user confirmation before any writes. Usage: /sdd-execute <feature-slug> [step-number|next|all|sequential]. `sequential` runs a feature (or an ordered multi-feature sequence with per-feature re-spec) end-to-end as stacked per-step PRs, with one up-front confirmation per feature instead of a per-step stop. Re-reads context.md at every session start so prior decisions carry forward.
argument-hint: <feature-slug | "feat-a (re-spec if needed) > feat-b ..."> [step-number|next|all|sequential]
allowed-tools: Read Write Edit Bash(ls *) Bash(find *) Bash(grep *) Bash(mkdir *) Bash(go *) Bash(go install *) Bash(golangci-lint *) Bash(python *) Bash(python3 *) Bash(uv *) Bash(pip *) Bash(ruff *) Bash(pnpm *) Bash(npx *) Bash(buf *) Bash(curl *) Bash(psql *) Bash(docker *) Bash(git diff *) Bash(git status *) Bash(git fetch *) Bash(git pull *) Bash(git show *) Bash(git ls-remote *) Bash(git checkout *) Bash(git branch *) Bash(git merge *) Bash(git rebase *) Bash(git push *) Bash(git add *) Bash(git commit *) Bash(gh pr *)
effort: high
---

You are executing implementation steps for an xstockstrat feature. You follow strict rules: discover before writing, confirm before writes (per step in the default modes; **once up-front per feature** in `sequential` mode — see `## SEQUENTIAL MODE`), and document everything in context.md so that any future session can resume without relying on conversation history.

## Arguments

- `$ARGUMENTS[0]` — feature slug (required). In `sequential` mode this may instead be an **ordered
  feature sequence**: features separated by `>` or `→`, each optionally followed by an inline re-spec
  directive in parentheses, e.g. `"003 (re-spec if needed) > 019 > 016 (re-spec Steps 5-6 first)"`.
- `$ARGUMENTS[1]` — step selector: a number (e.g. `3`), `next` (default), `all`, or `sequential`.

**Mode gating:** every behavior in `## SEQUENTIAL MODE` and every "sequential-mode" carve-out below
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
- `sequential` → **do not** resolve a single step here. Hand control to `## SEQUENTIAL MODE`, which
  parses the feature sequence and drives the per-feature loop (iterating pending steps internally).
- absent or `next` → find the first step where `**Status**: \`pending\``
- a number N → target only Step N
- `all` → process all `pending` steps in order, applying confirmation to each.
  (Note: the per-step STOP in STEP COMMIT + PR currently halts after the first step, so `all` does not
  run multiple steps in one session — use `sequential` for an unattended multi-step run.)

If no `pending` steps are found (all steps are `done`, `skipped`, or `blocked`):
→ go to **ALL-DONE PATH** below instead of stopping.

---

## SEQUENTIAL MODE — runs only when `$ARGUMENTS[1] == sequential`

A self-contained alternate driver. It reuses the BOOT SEQUENCE, PER-STEP EXECUTION (Phase 1 & 3),
STEP COMMIT + PR, and ALL-DONE machinery, with the explicit carve-outs documented here and in
`## HARD CONSTRAINTS`. **Standing authorization:** invoking sequential mode is the user's
authorization to run Phases 1 and 3 automatically — the per-step Phase-2 prompt and per-step STOP are
replaced by **one up-front confirmation per feature** (§5.1b / §5.4). The flow pauses only at a
**blocker** (§5.7).

### 5.1 Parse the feature sequence
- Split `$ARGUMENTS[0]` on `>` or `→` → an ordered list of feature tokens.
- For each token: the leading bare slug/number is the feature id; a trailing `(...)` is its re-spec
  directive:
  - `(re-spec if needed)` → directive = **conditional**.
  - `(re-spec Steps X-Y first)` / `(re-spec Step N first)` → directive = **explicit**, with the parsed
    step set.
  - no parenthetical → directive = **none**.
- A single token with no delimiter = a one-feature sequential run (backward compatible).
- Resolve each feature id to its `FEATURE_DIR` via the B0 glob (`*-<id>`).

### 5.1b Mode-entry confirmation (the very first interactive step)
Before the loop and before any non-read-only action, present to the user:
- "Running `/sdd-execute` in **SEQUENTIAL** mode."
- the parsed ordered sequence with each feature's re-spec directive, and
- the behavior summary: stacked per-step PRs (each based on the prior step branch); **one up-front
  confirmation per feature**; blockers routed to `AskUserQuestion`; CI-watch + rebase/autofix after
  each integration PR.

Ask a single `AskUserQuestion` (agree / cancel). **Proceed only on agree.** On cancel, stop without
making any change. This entry confirmation is distinct from, and precedes, the per-feature confirm.

### 5.2 Per-feature loop
For each feature in the sequence, in order:
1. Run **BOOT SEQUENCE** (B0–B5) scoped to this feature's slug/dir.
2. **Re-spec gate** (§5.3).
3. **Up-front confirm** (§5.4).
4. **Stacked step loop** (§5.5).
5. **Integration PR** (§5.6) + **CI watch** (§5.8).
6. Advance to the next feature. Do **not** wait for the integration PR to merge first; cross-feature
   ordering is governed by `merge-order.md` and surfaced as a blocker (§5.7) if violated.

### 5.3 Re-spec gate (read-only validation first; the sole sanctioned spec edit)
1. Merge current `origin/main-dev` into `<dev-branch>` so the feature branch reflects reality
   (`git merge -X ours origin/main-dev` per BRANCH SYNC step 5; push `<dev-branch>`).
2. **Validate** the spec against the live codebase: for each step, re-run its `**Codebase Evidence**`
   greps/ls and confirm each `**Files**` path exists.
3. Apply the directive:
   - **explicit** → re-spec exactly the named steps' bodies.
   - **conditional** → re-spec **only** the steps whose evidence/files no longer match (targeted,
     minimal).
   - **none** → if any step mismatches, do **not** silently edit — raise a **blocker** (§5.7) asking
     whether to re-spec.
4. A re-spec edits the affected step bodies (`**Instructions**`/`**Codebase Evidence**`/`**Files**`/
   `**Verification**`) + appends a feature.md status-history row + a context.md note, and is committed
   to the **feature branch** (not a step branch): `git commit -m "respec(<slug>): align steps <list>
   with current codebase"`, then `git push origin <dev-branch>`.
5. This is the **only** exception to "step bodies are immutable during execution" — it happens
   **before** the step loop, on the feature branch, never mid-step.

### 5.4 Up-front confirm (once per feature)
After §5.3's read-only validation, present the combined plan for this feature: the re-spec summary
(which steps will be re-spec'd and why) **and** the ordered list of pending steps to execute. Ask one
`AskUserQuestion` (proceed / stop). On proceed: commit the re-spec (if any) per §5.3, then run §5.5
unattended (no further per-step confirmation). This single confirmation **replaces** the per-step
Phase-2 confirmation for this feature.

### 5.5 Stacked step loop
For each pending step N in order (no per-step confirmation, no STOP):
- **Branch base:** the first executed step → base = `<dev-branch>`; step N (after the first) → base =
  the **prior executed step's branch** `feature-steps/<slug>-step-<prev>`. (BRANCH SYNC takes a
  `<base-branch>` — see `templates/branch-sync.md`.)
- Run **Phase 1 Discovery** unchanged (read-only). A discovery failure (missing file/symbol) → a
  **blocker** (§5.7), not the default "mark blocked + stop".
- **Skip Phase 2's interactive prompt and STOP.** Still compute the change plan internally (for the
  commit message + deviation record), but do not ask "Proceed?" and do not wait.
- Run **Phase 3 Execution** + Verification unchanged. Apply the verification fallbacks in
  `## REPO CONVENTIONS → Sequential-mode verification fallbacks`. A verification failure that would
  require a spec deviation → a **blocker** (§5.7).
- Run **STEP COMMIT + PR** with the sequential overrides (§5.6): commit, push the step branch, open the
  **stacked** step PR, then **continue to step N+1 in the same session** (no STOP).

### 5.6 PR overrides + per-feature integration PR
- **Step PRs:** use `mcp__github__create_pull_request` (the environment has no `gh`). Set
  `base` = the prior step branch (or `<dev-branch>` for the first executed step) and
  `head` = `feature-steps/<slug>-step-<N>`. Render the body from `templates/step-pr-body.md` (which
  notes the stack). Do **not** print the "merge then run next" STOP.
- **Integration PR (after all of this feature's steps are done):** run the merge-order gate (ALL-DONE
  PATH step 1), then `mcp__github__create_pull_request` with `base: main-dev`, `head: <dev-branch>`,
  body rendered from `templates/integration-pr-body.md`. Print the URL.

### 5.7 Blocker handling (sequential override of DEVIATION HANDLING)
A **blocker** is any of: a Phase-1 discovery failure; an ambiguous fix; an in-scope-unresolvable gap;
a deviation that needs a decision; or a re-spec scope decision. On a blocker:
- Stop the automatic flow and use the `AskUserQuestion` tool — **never decide unilaterally.**
- Reuse the A/B/C "gap" option shape from `## DEVIATION HANDLING`, but presented via `AskUserQuestion`,
  with **Option A ("fix now — expand this step's scope to fix it properly") as the preferred default**
  over deferring or working around.
- After the user answers, resume the loop where it stopped; record the decision in context.md (and the
  Deviation Log if it is a deviation).

### 5.8 Post-integration CI watch + rebase/autofix
After opening each feature's integration PR:
- `subscribe_pr_activity` to it. On a CI-failure event, fetch the failed job log (`mcp__github__
  get_job_logs`) and diagnose.
- If the feature branch is **behind `main-dev`** (e.g. a shared fix landed), rebase or merge `main-dev`
  in and push so the PR re-runs with current reality.
- If the failure is a **real defect in this feature**, fix it on the feature branch (or the relevant
  step branch) and push.
- If the failure is a **known flake** (e.g. timing-only e2e), do not churn — report it as re-runnable.
- Stop watching once the PR is merged or closed.

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
steps after the first (§5.5).

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
   - Update **only** the step's `**Status**` field in implementation-spec.md: `**Status**: \`pending\`` → `**Status**: \`done\``
   - **Do NOT modify any other part of the step** — `**Instructions**`, `**Codebase Evidence**`, `**Verification**`, `**Files**`, and `**Reviewers**` are immutable records of the original plan. Deviations go in the `## Deviation Log` only.
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
   `base` = the prior step branch (or `<dev-branch>` for the first executed step) — see §5.6.
6. Print the PR URL returned by `gh pr create`.
7. **STOP.** Tell the user:
   ```
   Step <N> complete. PR created: <url>
   Merge the PR into <dev-branch>, then run: /sdd-execute <slug> next
   ```
   Do not proceed to the next step in the same session.
   **Sequential-mode override:** do NOT stop — print "Step <N> done (PR <url>). Continuing to Step
   <N+1>." and proceed to the next step (§5.5).

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

### No vague deferrals — always resolve with the user

**Never write "deferred" without a specific target step or explicit user decision.**

If, during Phase 2 or Phase 3, you identify a gap that cannot be addressed within the current step's scope (e.g. a param the route doesn't handle, a missing field in a proto, a side-effect from an earlier step's scope limit), you must explicitly surface it and ask the user before proceeding:

```
Gap found: <one-sentence description of the issue>.
Options:
  A) Fix it now — expand scope of this step to include <specific change>.
  B) Accept as known limitation — <explain why it's safe/harmless>.
  C) Track as follow-up — I'll note it in context.md for the next relevant step.

Which do you prefer? (A / B / C)
```

**STOP HERE. Wait for the user's explicit reply (A / B / C) before taking any action.**

- Do NOT auto-select an option based on your own judgment — not even Option B ("accepted limitation"). The user must choose.
- If the session is compacted or resumed before a reply arrives, re-surface the same gap question at the top of the next response and wait again.

- **Option A**: add the fix to the Phase 2 plan and re-present the plan for confirmation before writing.
- **Option B**: record it in the Deviation Log with `**Disposition**: accepted limitation` and a clear rationale. Only apply after the user explicitly selects B.
- **Option C**: record it in context.md under a `## Open Items` section with a description and the earliest step where it could be addressed; do NOT write "deferred" in the PR body or deviation log without this entry.

Do not proceed with a vague "deferred" note unless you have a specific step number or explicit user sign-off.

**Sequential-mode override:** present this same A/B/C gap choice via the `AskUserQuestion` tool (not
free text), with **Option A ("fix now — expand this step's scope") as the recommended first option**.
This is the only place sequential mode pauses for the human (a "blocker", §5.7). After the answer,
resume the loop and record the decision in context.md (+ Deviation Log if applicable).

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

### Sequential-mode carve-outs (apply ONLY when `$ARGUMENTS[1] == sequential`)

- "Never write or edit any file before Phase 2 user confirmation" is satisfied by the **mode-entry
  confirmation (§5.1b)** plus the **one up-front confirmation per feature (§5.4)**. After those, Phases
  1 and 3 run automatically; the per-step Phase-2 prompt and per-step STOP are skipped.
- "step bodies are immutable during execution" still holds **during** step execution. The **re-spec
  gate (§5.3)** is the sole exception: it edits step bodies **before** the step loop, on the feature
  branch, in a separate `respec(<slug>): …` commit — never mid-step.
- **Step PRs are stacked**: a step PR's `base` is the prior step branch (or `<dev-branch>` for the
  first). Step PRs still never target `main-dev`/`main`; the integration PR → `main-dev` is the
  existing sanctioned exception.
- **Verification fallbacks** (REPO CONVENTIONS below) may be applied without asking, provided the
  fallback matches CI and the divergence is logged in the `## Deviation Log`. Keeping `uv.lock` /
  `pnpm-lock.yaml` in sync when a manifest changes is a sanctioned staging exception (log it).
- **All other HARD CONSTRAINTS remain in force** (no guessing paths/symbols; no commit before
  verification passes; migration immutability).

---

## REPO CONVENTIONS (from docs/runbooks/feature-workflow.md)

- **Branch model**: `**Development Branch**` in `feature.md` is the integration branch (PR target). Per-step work happens on `feature-steps/<slug>-step-<N>` sub-branches created by BRANCH SYNC. Boot Step B4 validates the current branch context.
- **Proto edits**: after any `.proto` change, run from `packages/proto/`:
  ```bash
  buf lint && buf breaking --against ".git#branch=<dev-branch>"
  ```
  where `<dev-branch>` is the `**Development Branch**` value from `feature.md` (parsed in Boot Step B4).
  If `buf` is not installed: fall back to `grpc_tools.protoc` (precedent: docs/roadmap/phase3-deviations.md) and document as deviation.
- **Migrations**: naming is `NNN_description.up.sql` + `NNN_description.down.sql`. NNN is the next integer after the last file found by `ls services/<name>/migrations/ | sort | tail -1`.
- **After proto changes**: run `./scripts/buf-gen.sh` to regenerate stubs; include generated files in the commit.
- **Config keys**: format is `<service-short-name>.<category>.<key>` — verify before writing.
- **Never edit applied migrations**: any applied `.up.sql` file (committed to main-dev) is immutable; add a new numbered migration for corrections.
- **Lint gate**: a `service` step's `**Verification**` (or its paired `test` step's) includes the language's lint command — Go `GOWORK=off golangci-lint run --modules-download-mode=mod`, Python `ruff check . && ruff format --check .`, Node/Next `pnpm run lint` (sdd-spec §5c). Phase 3 runs it like any other Verification; a lint/format failure on the step's own code must be fixed (see HARD CONSTRAINTS carve-out) and re-run before the step is marked `done`.
- **Header propagation**: any new outbound gRPC call added by a step must forward `x-user-id` / `x-access-scope` / `x-trace-id` via the service's existing mechanism (`docs/patterns/header-propagation.md`). Confirm in Phase 1 discovery; do not introduce a bare client that drops them.

### Sequential-mode verification fallbacks

In `sequential` mode, when the sanctioned verification tool is unavailable, use a **CI-equivalent**
fallback and log a `## Deviation Log` entry (`**Disposition**: CI-equivalent fallback`). In the
default modes, surface these as a deviation question instead of auto-applying.

- **Proto codegen container blocked** (e.g. Docker Hub rate limit): install the codegen toolchain on
  the host pinned to the **CI `proto-freshness` job versions** in `.github/workflows/ci.yml` — `buf`,
  `protoc-gen-go` / `protoc-gen-go-grpc` / `protoc-gen-connect-go` (the exact pinned versions),
  `grpcio-tools` + a `protobuf` runtime matching the committed stubs, and the TS plugins from the
  committed lockfile — then run `./scripts/buf-gen.sh` and confirm `git diff --exit-code
  packages/proto/gen/` is limited to the intended service (mirrors CI's stale-stub check).
- **`migrate` / DB unavailable**: apply both `NNN_*.up.sql` and `NNN_*.down.sql` against a throwaway
  `postgres:16` container (`docker run … postgres:16`; `psql -v ON_ERROR_STOP=1 < …`) to prove the
  migration is reversible.
- **Playwright dev-server harness times out / browsers unavailable**: fall back to
  `pnpm --filter <svc> exec tsc --noEmit` + `pnpm --filter <svc> run lint` (the spec's documented e2e
  fallback).
- **Lockfiles**: whenever a step changes `pyproject.toml` / `package.json`, regenerate and stage
  `uv.lock` / `pnpm-lock.yaml` in the same commit, even if not listed in the step's `**Files**` (CI
  runs `uv lock --check` / `pnpm install --frozen-lockfile`).
