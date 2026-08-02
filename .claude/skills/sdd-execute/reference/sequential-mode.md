# sdd-execute — SEQUENTIAL MODE

Loaded by the router **only when `$ARGUMENTS[1] == sequential`**. A self-contained alternate
driver. It reuses the BOOT SEQUENCE, PER-STEP EXECUTION (Phase 1 & 3), and ALL-DONE machinery from
`SKILL.md`, but **replaces** the per-step `STEP COMMIT + PR` section with its own commit-and-checkpoint
procedure (§5.5 / §5.6), with the explicit carve-outs documented here and in `## HARD CONSTRAINTS`.
**Standing authorization:** invoking sequential mode is the user's authorization to run Phases 1 and 3
automatically — the per-step Phase-2 prompt is replaced by **one up-front confirmation per feature**
(§5.1b / §5.4). Instead of a PR per step, the run commits **one commit per step directly on the
feature branch** and keeps the operator updated at **smart checkpoints** (§5.5b — consumer-surface
boundaries and a step cap). The flow pauses at a **checkpoint** (§5.5b) or a **blocker** (§5.7).

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
- the behavior summary: **one commit per step directly on the feature branch — no per-step PRs**;
  **one up-front confirmation per feature**; the run pauses at **smart checkpoints** (consumer-surface
  boundaries and a cap of 5 steps) to report progress and at **blockers**; a **single integration PR
  per feature** at the end; CI-watch + rebase/autofix after each integration PR.

Ask a single `AskUserQuestion` (agree / cancel). **Proceed only on agree.** On cancel, stop without
making any change. This entry confirmation is distinct from, and precedes, the per-feature confirm.

### 5.2 Per-feature loop
For each feature in the sequence, in order:
1. Run **BOOT SEQUENCE** (B0–B5) scoped to this feature's slug/dir.
2. **Re-spec gate** (§5.3).
3. **Up-front confirm** (§5.4).
4. **Tooling setup** (§5.4b) — install only what this feature's steps need; blocker if unavailable.
5. **Step loop** — one commit per step, smart checkpoints (§5.5 / §5.5b).
6. **Integration PR** (§5.6) + **CI watch** (§5.8).
7. Advance to the next feature. Do **not** wait for the integration PR to merge first; cross-feature
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
(which steps will be re-spec'd and why) **and** the ordered list of pending steps to execute, with
each step's **consumer surface** annotated (backend / `ui` / `agent` — see §5.5b) so the operator
sees where the checkpoints will fall. Ask one `AskUserQuestion` (proceed / stop). On proceed: commit
the re-spec (if any) per §5.3, then run **TOOLING SETUP** (§5.4b), then run §5.5, pausing only at
**checkpoints** (§5.5b) and **blockers** (§5.7) — no further per-step confirmation. This single
confirmation **replaces** the per-step Phase-2 confirmation for this feature.

### 5.4b Tooling setup (mandatory, once per feature, before the step loop)
Read and execute **`reference/tooling-setup.md`** scoped to this feature's **pending steps** — install
only the toolchain those steps need (nothing speculative), pinned to the version table, and never a
database. A tool that is required but unavailable is a **blocker** (§5.7), raised **now** via
`AskUserQuestion` rather than discovered mid-loop where it would stall the run or skip a verification.

### 5.5 Step loop — one commit per step, no per-step PR
Set up the feature branch **once** via the branch-sync *setup* (fetch, create-or-checkout
`<dev-branch>`, merge `main-dev`) — **skip step 6 of `branch-sync.md`**; there are no
`feature-steps/<slug>-step-<N>` sub-branches in sequential mode. All step commits land directly on
`<dev-branch>`.

Initialize `steps_since_checkpoint = 0`. For each pending step N in order (no per-step confirmation,
no per-step STOP):
- Run **Phase 1 Discovery** unchanged (read-only). A discovery failure (missing file/symbol) → a
  **blocker** (§5.7), not the default "mark blocked + stop".
- **Skip Phase 2's interactive prompt.** Still compute the change plan internally (for the commit
  message + deviation record), but do not ask "Proceed?" and do not wait.
- Run **Phase 3 Execution** + Verification unchanged, including the **offline migration check** (never
  start a DB — SKILL.md Phase 3 / HARD CONSTRAINTS) and the verification fallbacks in
  `## Sequential-mode verification fallbacks` below. A verification failure that would require a spec
  deviation → a **blocker** (§5.7).
- **Commit the step directly on `<dev-branch>`** (this replaces STEP COMMIT + PR):
  ```bash
  git add <the step's **Files**> $FEATURE_DIR/implementation-spec.md $FEATURE_DIR/feature.md $FEATURE_DIR/context.md
  git commit -m "feat(<slug>): step <N> — <title>"
  git push origin <dev-branch>
  ```
  (Stage only the step's `**Files**` + the three spec/context files — F-08 still holds; add a ledger
  file only when a ledger write is due.) **No per-step PR.** Push each step so work is durable and the
  eventual integration PR shows incremental commits.
- Increment `steps_since_checkpoint`. Evaluate the **checkpoint condition** (§5.5b); if it fires, run
  the checkpoint report + gate, then reset `steps_since_checkpoint = 0` and continue. Otherwise
  continue straight to step N+1 in the same session.

### 5.5b Smart checkpoints (keep the operator updated)
A **step's consumer surface** is derived from its `**Service**`: `xstockstrat-ui` → `ui`;
`xstockstrat-agent` → `agent`; everything else (backend services, `packages/proto`, migrations,
config, docs) → `backend`.

After committing step N, a **checkpoint fires** when **any** of:
1. **Surface boundary** — the next pending step's surface differs from step N's (e.g. the last
   `backend` step is done and the next is a `ui` step). This is the "group steps per surface" boundary
   — it lands the operator right at the seam where the consumer surface starts, the seam C-14 cares
   about.
2. **Step cap** — `steps_since_checkpoint == 5` (bounds blast radius when one surface has many steps).
3. **Feature end** — step N was the feature's last pending step (the checkpoint here precedes the
   integration PR in §5.6).

On a checkpoint, print this report and then gate via **one `AskUserQuestion`** (`proceed` /
`stop here` / `adjust: <note>`; recommended = `proceed`):
```
Checkpoint — <slug>: steps <first>–<N> done (surface: <backend|ui|agent>), <K> pending.
Committed to <dev-branch> (no PR yet).
- Steps: <N: title ✓>, ...
- Files touched this checkpoint: <paths>
Accountability (P-03):
- Out-of-scope changes: none | <list + disposition>
- Open questions / items: none | <unresolved ## Open Items / Open Threads without a target step>
- Unaddressed review warnings: none | <items still `[ ] unaddressed` from the sdd-review impl-spec note>
- Deviations this checkpoint: none | <one-liners; full detail in ## Deviation Log>
Next surface: <backend|ui|agent> (steps <…>) | integration PR.
```
- `proceed` → reset the counter and continue.
- `stop here` → run the SESSION-END SUMMARY and stop (the feature resumes later with `/sdd-execute
  <slug> sequential`; committed steps are already on `<dev-branch>`).
- `adjust: <note>` → treat as a blocker (§5.7): incorporate the note, then continue.
Never skip a checkpoint silently — the report is the operator's window into an otherwise unattended
run, and the accountability block is where out-of-scope changes, open questions, and unaddressed
warnings surface (the failure this mode is being fixed to prevent).

### 5.6 Per-feature integration PR
After all of this feature's steps are done (the feature-end checkpoint has passed):
- Run the merge-order gate (ALL-DONE PATH step 1), then `mcp__github__create_pull_request` (the
  environment has no `gh`) with `base: main-dev`, `head: <dev-branch>`, body rendered from
  `templates/integration-pr-body.md`. Print the URL.
- This is the **only** PR sequential mode opens for a feature. Its diff is the full feature (every
  step's commit), which squash-merges cleanly into `main-dev`.

### 5.7 Blocker handling (sequential override of DEVIATION HANDLING)
A **blocker** is any of: a Phase-1 discovery failure; an ambiguous fix; an in-scope-unresolvable gap;
a deviation that needs a decision; or a re-spec scope decision. On a blocker:
- Stop the automatic flow and use the `AskUserQuestion` tool — **never decide unilaterally.**
- Reuse the A/B/C "gap" option shape from `reference/deviation-handling.md`, but presented via
  `AskUserQuestion`, with **Option A ("fix now — expand this step's scope to fix it properly") as the
  preferred default** over deferring or working around.
- After the user answers, resume the loop where it stopped; record the decision in context.md (and the
  Deviation Log if it is a deviation).

### 5.8 Post-integration CI watch + rebase/autofix
After opening each feature's integration PR:
- `subscribe_pr_activity` to it. On a CI-failure event, fetch the failed job log (`mcp__github__
  get_job_logs`) and diagnose.
- If the feature branch is **behind `main-dev`** (e.g. a shared fix landed), rebase or merge `main-dev`
  in and push so the PR re-runs with current reality.
- If the failure is a **real defect in this feature**, fix it on the feature branch `<dev-branch>`
  (a new commit — sequential mode has no step branches) and push.
- If the failure is a **known flake** (e.g. timing-only e2e), do not churn — report it as re-runnable.
- Stop watching once the PR is merged or closed.

---

## Sequential-mode carve-outs (apply ONLY when `$ARGUMENTS[1] == sequential`)

- "Never write or edit any file before Phase 2 user confirmation" is satisfied by the **mode-entry
  confirmation (§5.1b)** plus the **one up-front confirmation per feature (§5.4)**. After those, Phases
  1 and 3 run automatically; the per-step Phase-2 prompt is skipped. The run still pauses at
  **checkpoints (§5.5b)** and **blockers (§5.7)** — those are periodic/exceptional, not per-step.
- "step bodies are immutable during execution" still holds **during** step execution. The **re-spec
  gate (§5.3)** is the sole exception: it edits step bodies **before** the step loop, on the feature
  branch, in a separate `respec(<slug>): …` commit — never mid-step.
- **No per-step PRs.** Each step is one commit **directly on `<dev-branch>`** (§5.5); there are no
  `feature-steps/<slug>-step-<N>` branches and no step PRs. The **integration PR → `main-dev`** (§5.6)
  is the only PR sequential mode opens per feature and is the existing sanctioned target exception
  (F-03 forbids a *step* PR targeting `main-dev`; the integration PR is not a step PR).
- **Verification fallbacks** (below) may be applied without asking, provided the fallback matches CI
  and the divergence is logged in the `## Deviation Log`. Keeping `uv.lock` / `pnpm-lock.yaml` in sync
  when a manifest changes is a sanctioned staging exception (log it).
- **All other HARD CONSTRAINTS remain in force** (no guessing paths/symbols; no commit before
  verification passes; migration immutability; **never start a DB to verify a step**).

---

## Sequential-mode verification fallbacks

In `sequential` mode, when the sanctioned verification tool is unavailable, use a **CI-equivalent**
fallback and log a `## Deviation Log` entry (`**Disposition**: CI-equivalent fallback`). In the
default modes, surface these as a deviation question instead of auto-applying.

- **Proto codegen container blocked** (e.g. Docker Hub rate limit): install the codegen toolchain on
  the host pinned to the **CI `proto-freshness` job versions** in `.github/workflows/ci.yml` — `buf`,
  `protoc-gen-go` / `protoc-gen-go-grpc` / `protoc-gen-connect-go` (the exact pinned versions),
  `grpcio-tools` + a `protobuf` runtime matching the committed stubs, and the TS plugins from the
  committed lockfile — then run `./scripts/buf-gen.sh` and confirm `git diff --exit-code
  packages/proto/gen/` is limited to the intended service (mirrors CI's stale-stub check).
- **Migration steps are verified offline — never start a database.** Do **not** spin up a
  `postgres` container or run a `migrate`/`psql` apply against a live instance (that is exactly the
  step that hangs waiting on the container to become ready). Verify reversibility **statically**:
  confirm `NNN_*.up.sql` and `NNN_*.down.sql` both exist with the correct next `NNN`, and read both
  to confirm every `CREATE`/`ALTER`/`ADD` in `.up` has an inverse `DROP`/`ALTER` in `.down`. The real
  apply-and-rollback runs in CI / at deploy against the managed database. (This is a HARD CONSTRAINT
  in every mode, not a sequential-only fallback — see SKILL.md Phase 3 / HARD CONSTRAINTS.)
- **Playwright dev-server harness times out / browsers unavailable**: fall back to
  `pnpm --filter <svc> exec tsc --noEmit` + `pnpm --filter <svc> run lint` (the spec's documented e2e
  fallback).
- **Lockfiles**: whenever a step changes `pyproject.toml` / `package.json`, regenerate and stage
  `uv.lock` / `pnpm-lock.yaml` in the same commit, even if not listed in the step's `**Files**` (CI
  runs `uv lock --check` / `pnpm install --frozen-lockfile`).
