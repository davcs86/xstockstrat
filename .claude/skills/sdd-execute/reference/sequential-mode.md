# sdd-execute — SEQUENTIAL MODE

Loaded by the router **only when `$ARGUMENTS[1] == sequential`**. A self-contained alternate
driver. It reuses the BOOT SEQUENCE, PER-STEP EXECUTION (Phase 1 & 3), STEP COMMIT + PR, and
ALL-DONE machinery from `SKILL.md`, with the explicit carve-outs documented here and in
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
  `## Sequential-mode verification fallbacks` below. A verification failure that would require a spec
  deviation → a **blocker** (§5.7).
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
- If the failure is a **real defect in this feature**, fix it on the feature branch (or the relevant
  step branch) and push.
- If the failure is a **known flake** (e.g. timing-only e2e), do not churn — report it as re-runnable.
- Stop watching once the PR is merged or closed.

---

## Sequential-mode carve-outs (apply ONLY when `$ARGUMENTS[1] == sequential`)

- "Never write or edit any file before Phase 2 user confirmation" is satisfied by the **mode-entry
  confirmation (§5.1b)** plus the **one up-front confirmation per feature (§5.4)**. After those, Phases
  1 and 3 run automatically; the per-step Phase-2 prompt and per-step STOP are skipped.
- "step bodies are immutable during execution" still holds **during** step execution. The **re-spec
  gate (§5.3)** is the sole exception: it edits step bodies **before** the step loop, on the feature
  branch, in a separate `respec(<slug>): …` commit — never mid-step.
- **Step PRs are stacked**: a step PR's `base` is the prior step branch (or `<dev-branch>` for the
  first). Step PRs still never target `main-dev`/`main`; the integration PR → `main-dev` is the
  existing sanctioned exception.
- **Verification fallbacks** (below) may be applied without asking, provided the fallback matches CI
  and the divergence is logged in the `## Deviation Log`. Keeping `uv.lock` / `pnpm-lock.yaml` in sync
  when a manifest changes is a sanctioned staging exception (log it).
- **All other HARD CONSTRAINTS remain in force** (no guessing paths/symbols; no commit before
  verification passes; migration immutability).

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
- **`migrate` / DB unavailable**: apply both `NNN_*.up.sql` and `NNN_*.down.sql` against a throwaway
  `postgres:16` container (`docker run … postgres:16`; `psql -v ON_ERROR_STOP=1 < …`) to prove the
  migration is reversible.
- **Playwright dev-server harness times out / browsers unavailable**: fall back to
  `pnpm --filter <svc> exec tsc --noEmit` + `pnpm --filter <svc> run lint` (the spec's documented e2e
  fallback).
- **Lockfiles**: whenever a step changes `pyproject.toml` / `package.json`, regenerate and stage
  `uv.lock` / `pnpm-lock.yaml` in the same commit, even if not listed in the step's `**Files**` (CI
  runs `uv lock --check` / `pnpm install --frozen-lockfile`).
