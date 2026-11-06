# Product Spec: batch-execute-token-reduction

**Created**: 2026-11-06

---

## Problem Statement

`/sdd-batch-execute` subagents burn tokens and context. Measured on the operator's 14 runs (2026-11-06), about 1.61B input tokens in total:

- The default workflow-subagent starts every turn from about 100K tokens of fixed context: 56 tool schemas, about 700 deferred MCP tool names, the skill listing and root `CLAUDE.md`. A scoped `codebase-discovery` agent starts at about 22K.
- Average input per agent:
  - step: 12.12M
  - validate: 12.87M
  - setup: 14.13M
- Each step agent reads all of `SKILL.md` plus three reference files, and whole 100–160 KB implementation specs, then carries them through 60–145 turns.
- `validate` runs again on the `upfront: proceed` relaunch. `validate` and `setup` run again after every crashed or usage-limited relaunch.

The result is slow, expensive batches and container crashes.

## User Story

As the SDD operator running `/sdd-batch-execute`, I want its subagents to load only what each stage needs, and to skip work whose result I have already approved, so that a batch costs a fraction of today's tokens with no SDD gate weakened.

## Functional Requirements

FR-1. **Scoped agent types.** Two new agent types, both pinned to `opus`. Both are documented as "Workflow-internal — spawned only by `.claude/workflows/sdd-batch-execute.js`; never delegate from a skill session. Never select via Task.":

- `sdd-batch-checker` (`Bash, Read, Glob, Grep, ToolSearch, mcp__github__list_pull_requests`) runs preflight and validate.
  - Preflight calls the GitHub tool directly, or selects it with ToolSearch when it is not callable directly.
  - On a tool error it retries once after about 10 s, then reports "PR lookup unavailable" (distinct from "no open PR").
- `sdd-batch-writer` (`Bash, Read, Edit, Write, Glob, Grep`) runs setup, hook-setup, step and write-plan.

`integration-pr` keeps the default type.

FR-2. **Upfront validate result in the approval.** When validate runs and halts at the `upfront` gate, the halt returns `record = {mainDev, dev, specHash, directive, pending, mismatches}`.

- **Shas.** `mainDev`, `dev` and `specHash` are 40-hex git SHA-1 object names:
  - `git rev-parse origin/main-dev`;
  - `git rev-parse origin/<dev>`;
  - the blob sha `git rev-parse <devSha>:docs/roadmap/features/<dir>/implementation-spec.md`.
- **Matching record.** If an `upfront: proceed` approval carries a record that matches the current state, the run skips validate and gives setup that record's `mismatches` verbatim. Matching means `mainDev`, `dev`, `specHash` and `directive` are equal, and the pending step numbers are equal when compared as a sorted numeric list.
- **Any other upfront approval.** With no record, a stale record, or one whose `pending` or `mismatches` is not an array, the run validates and halts at `upfront` again with a new record.
- **Blocks:**
  - Any non-40-hex `mainDevSha`/`devSha`/`specHash` blocks the run ("non-hex sha").
  - With directive `none`, a matching record that has mismatches blocks before setup ("directive none: steps X mismatch; …").
- Nothing is written to the repository before a record-matching upfront approval.

FR-3. **Explicit resume.**

- Setup's last commit (FR-5 item 6) is its `context.md` session entry, and that entry ends with a fenced `sdd-batch-setup` block (`{"mainDev":"<sha>","date":"<ISO>"}`).
- `setupDone` = status is `in-progress` AND the last `sdd-batch-setup` fence parses with a 40-hex `mainDev`.
- The Gate (validate + setup) is skipped only when `setupDone` holds AND either a `checkpoint:`/`blocker:` approval or `{gate:'resume', decision:'proceed'}` is present. An approval without `setupDone` goes through the Gate path.
- When `setupDone` holds, steps are pending and no such approval is present, the run halts at `resume`.
- After a setup that made a `respec(` commit, the run ends at `resume` (D9).
- **Hook-setup.** Preflight reports `hookLive`, the shared hook check run in the main checkout.
  - When it is false on a run that will commit without setup, a no-commit `hook-setup` writer runs first, and its failure blocks.
  - Such runs are: a resume with pending steps and no `stop here`, or Land past merge-order.
- A `stop here` decision takes precedence over every gate that makes no write.

FR-4. **Distill gate.**

- `contextBytes` is `git cat-file -s <devSha>:docs/roadmap/features/<dir>/context.md`.
- When `context.md` on the dev branch is larger than `CONTEXT_MAX` (64 KiB, calibrated in the spike), the run halts at `distill`. That gate is cleared only by `{gate:'distill', decision:'proceed'}`, re-sent on every relaunch.
- When the size cannot be read, the run is blocked with "context.md size unreadable": a read failure is a defect, not a size.
- The full `context.md` read (C-02) is never truncated.

FR-5. **Crash-safe, pinned setup.** Setup works against the shas preflight reported. Each item is one commit, pushed before the next, and is skipped when already done. Order:

0. Stale check: `origin/main-dev` and `origin/<dev>` must still equal the record's shas, else `stale:true` and no commits.
1. Tooling detection and pre-commit hook liveness, using the shared `HOOK_CHECK`, whose every clause names its failure:
   - HUSKY or pnpm failures → tooling blocker.
   - Otherwise, after any running install's `sdd-husky.lock` clears (blocker at 2 polls; stale after 30 min):
     - `pnpm exec husky` in the main worktree if its husky bin exists;
     - else `pnpm install --frozen-lockfile` under the mkdir lock, only when `$M/node_modules` is missing;
     - else blocker.
   - Re-link, re-check; if still inert → `tooling_blockers`, no commits.
2. Merge, in this sequence:
   - normal `git merge --no-commit --no-ff` (never `-X`);
   - `scripts/merge-train-resolve.mjs`;
   - commit;
   - `scripts/ledger-guard.py --fix`;
   - push.

   Failure handling:
   - Any non-zero resolver exit, or a hook failure on the merge commit → `git merge --abort`, no commits, `completed:false`, one note per cause:
     - unresolvable … start a NEW run (exit 2, D7);
     - resolver exit N;
     - hook failed on merge commit (main-dev content).
   - ledger-guard → `git add -- docs/roadmap/ledger/`, then:
     - a tracked non-ledger change (`! git diff --quiet`) resets to the record's dev sha and blocks;
     - else `--amend` into the merge commit, only if something is staged;
     - nothing staged → continue (D17);
     - a non-zero ledger-guard exit → `git reset --hard` and a note.
   - A non-fast-forward push → `stale:true`.
3. Re-spec commit (implementation-spec.md only), skipped when the record's mismatches list is empty. The first body line is `Approved-record: <JSON>`.
4. `feature.md` history row.
5. `status.md` → `in-progress`.
6. Last: the `context.md` entry. It lists every `respec(<slug>)` commit on `git log --first-parent origin/main-dev..HEAD` and ends with the `sdd-batch-setup` fence.

The SETUP result gains `tooling_blockers`, `stale` and `completed`. The script blocks unless `completed === true`.

**Writer rules (all writer stages):**
- **Commit form.** Every commit and amend uses the quoted-heredoc CLOG form: `git commit -F - >"$CLOG" 2>&1 <<'SDD_MSG_EOF'`, closing delimiter at column 0, then `tail -n 20`.
- **Links and excludes.**
  - Writers link the root and per-service `node_modules` and `.husky/_`.
  - They add root-anchored patterns to `info/exclude`.
  - A dirty tree is `! git diff --quiet`.
- **Inert hook outside setup.** A non-setup writer that finds the hook inert never installs. It returns a blocker (step) or `commits []` plus a note, with a remedy keyed on the failing clause.

FR-6. **Scoped step reads.**

- **implementation-spec.md:** the preamble (line 1 up to the first `### Step`), the unit's own step(s), and `## Deviation Log`.
- **context.md:** in full.
- **SKILL.md:** these sections, selected by heading text:
  - `## PER-STEP EXECUTION` (excluding `### STEP COMMIT + PR`)
  - `## DEVIATION HANDLING`
  - `## CONTEXT.MD — Per-step entry format`
  - `## HARD CONSTRAINTS`
- **sequential-mode.md:** §5.5, §5.7, the carve-outs and the verification fallbacks.
- **tdd-gate.md and tooling-setup.md:** in full.
- **repo-conventions.md:** only when the step touches its areas.
- **atomic-units.md / deviation-handling.md:** only when active.
- **Discovery digest:** advisory. The step re-verifies every not-found claim and every path:line it acts on at origin/<devBranch>.
- **AskUserQuestion:** wherever loaded skill text says AskUserQuestion, the step returns `result:'blocker'`.

FR-7. **Verification output hygiene, with judgment unchanged.**

- **Fresh log per run.** Each verification run (RED, GREEN, every re-run) writes to a new `mktemp` log under `$(cd "$(git rev-parse --git-dir)" && pwd)`, with the path echoed first. The log lives until the worktree is removed.
- **Run verbatim, once.** The step's Verification block runs as `( <fence> ) >"<log>" 2>&1; echo "exit=$?"`.
  - Nothing is inserted, and no `set -e`/`pipefail` is added.
  - A missing `exit=` line counts as FAILED.
- **Long runs.** A run longer than 540 s uses `run_in_background` with a `.exit` sentinel and ≤540 s polls. A timeout is FAILED.
- **Read the log.** The agent reads a failure grep plus `tail -n 60`. It reads the full log on a non-zero exit, on any expectation it cannot confirm, or on surprising output.
- **Judge as today.** The agent judges exactly as SKILL.md PHASE 3 requires, citing only lines from the current run.
- **TDD keeps its rules.** RED must fail for the right reason; the red-N/A escape still applies; GREEN cites the executed count and the coverage line.
- **Config-key wiring gate.** Its step-time and `--final` runs work the same way, each with its own log.
- **SKILL.md:301** changes, in all modes (D11), from "Report the exact output" to "Report the cited output lines, the `exit=` line and the log path (full log on request); `exit=<n>` is the command's exit status, and with no log file the path is `none`."

FR-8. **Contract docs and registry.**

- `docs/patterns/context-engineering.md` §4 documents:
  - the `record` on upfront approvals;
  - the `resume` and `distill` gates (re-send each relaunch; relaunches are fresh runs, not `resumeFromRunId`);
  - the `sdd-batch-setup` fence;
  - the new `resume`, `distill` and upfront-re-halt stops in the `Stops at` column of the §4 workflows table (`docs/patterns/context-engineering.md:167-170`);
  - the writer/checker roles;
  - hook-setup, `info/exclude`, and log lifetime.
- Both agents are registered in `.claude/context-map.yaml`. The context-map agents header notes that not every agent is read-only.
- `/sdd-distill` and `context-distiller` reproduce every fenced `sdd-batch-*` block byte-for-byte and in order (D8).
- `SKILL.md` `## HARD CONSTRAINTS` stays byte-identical.
- No Constitution edit and no new carve-out.

FR-9. **Spike before merge (PR-0, throwaway branch).** Before PR-1, prove:

- `agentType` composes with `isolation:'worktree'`;
- a checker can call `mcp__github__list_pull_requests`, and which path it used;
- a scoped first turn is ≤30K tokens;
- **husky fires in a linked worktree.** One real step runs end-to-end, and husky fires through the symlinked `.husky/_` after the hook-liveness remedy. Hook time and output are measured for a ui commit and for a merge commit that brings in ui files.
- background-run polling works;
- the resolver and ledger-guard accept a raw-sha `--base`;
- `( … )` and `wc -c | tr -d ' '` behave the same on macOS bash 3.2.

Calibrate `CONTEXT_MAX`. If composition fails, only preflight uses `sdd-batch-checker`, and FR-1 shrinks accordingly.

FR-10. **No silent writer no-op.**

- **write-plan:** a write-plan with no commit, or a dead write-plan, blocks ("write-plan made no commit").
- **integration-pr:**
  - An integration-pr with no url blocks ("integration-pr incomplete: <notes>", or "no PR url" when it returns no notes).
  - The integration-pr prompt opens the PR only once the promotion commit is pushed now, or the plan is already applied at the dev-branch tip.
  - The PR result gains `notes`.

## Out of Scope

- Replacing `-X ours` in the validate prompt (`sdd-batch-execute.js:163`; ledger `fails.md:3095`). A follow-up will switch it to the resolver.
- Defining "session" in `tooling-setup.md` vs `sequential-mode.md:75`, and moving tooling setup to once per feature.
- A scoped agent type for `integration-pr`.
- A `/sdd-spec` authoring rule against unguarded test-runner pipes.
- Model-tier (sonnet/haiku) changes for any stage.
- A deterministic verification runner or exit-code oracle. This was rejected after 8 debate rounds.
- A persistent per-feature worktree.
- Changes to `/sdd-batch`, `/merge-train` or the interactive `/sdd-execute` modes, except the `SKILL.md:301` wording (D11).

## Affected Services

None of the runtime services in the CLAUDE.md Service Registry. This is platform SDD tooling only:

- `.claude/workflows/sdd-batch-execute.js` — gate predicates, schemas and prompts
- `.claude/agents/sdd-batch-writer.md`, `.claude/agents/sdd-batch-checker.md` — new
- `.claude/skills/sdd-execute/SKILL.md` — `:301` wording only
- `scripts/workflow-tests/sdd-batch-execute.test.mjs` — change-first tests
- `docs/patterns/context-engineering.md` §4, `.claude/context-map.yaml`
- `.claude/agents/context-distiller.md`, `.claude/skills/sdd-distill/SKILL.md` — verbatim `sdd-batch-*` fences (D8)
- Runtime side effect: the main checkout's shared `.git/config` `core.hooksPath`, and `node_modules` only when it is missing (D10/D13)

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — internal SDD tooling. The capability is consumed by the operator through the `/sdd-batch-execute` saved workflow in the Claude Code main session. It has no end-user, UI segment or MCP-tool surface.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/batch-execute-token-reduction` (branch from `main-dev`)

Approval gates required (per docs/runbooks/feature-workflow.md):

- [ ] 1 service owner approval (non-breaking proto or config change) — n/a; Platform Lead review of the tooling contract instead
- [ ] 2 service owners + platform lead (breaking proto change) — n/a
- [ ] DBA review + service owner (schema migration) — n/a

Gate-rule changes must change their test first (`docs/patterns/context-engineering.md:226`). CI's `context-map` job runs `node --test scripts/workflow-tests/*.test.mjs` and `./scripts/check-context-map.sh` (`.github/workflows/ci.yml:863-877`).

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`), the single source of acceptance truth (Constitution **C-15**). Each `FR-N` above is covered by at least one tagged scenario there.

The deliverable is an orchestration script, so its observable outputs are:
- the halt or blocked result it returns;
- the agent calls it makes, each with its `agentType`;
- the prompts it renders.

The mock harness (`scripts/workflow-tests/harness.mjs`) observes all three. The scenarios fall into three kinds:
- **Untagged:** behavioural. They assert the returned result and the agent calls.
- **`@prompt-contract`:** they assert rendered-prompt text, because that text is the instruction the subagent receives.
- **`@manual-spike`:** they are verified once from the FR-9 spike transcripts, not by an automated test.

## Known Traps

- `docs/roadmap/ledger/fails.md:3086-3097`: never merge shared append-only docs with `-X ours`/`-X theirs`. FR-5 uses a normal merge plus the resolver; validate's local `-X ours` is an Out of Scope follow-up.
- `fails.md:3250-3252`, `:3381-3383`, `:3451-3453`: launcher digests and prompt titles go stale, and discover reads the main checkout. FR-2 and FR-3 pin shas; FR-6 has the step agent read the branch-tip spec preamble and its own step.
- `fails.md:3361-3363`: husky is inert in batch worktrees. Setup and hook-setup check liveness with one shared check and repair per D13; other writers block with a clause-keyed remedy. FR-9 verifies that husky fires under the writer type.

## Accepted Risks

- Under FR-3, a stale `resume` approval sent after a real checkpoint halt continues past that checkpoint. Accepted by the operator (decision D4 in `context.md`); FR-8 documents it in the §4 args contract.
- When the main checkout's hook is live but a writer's own check fails on clause `h` or `pre-commit` (worktree link failed, or the branch lacks `.husky/pre-commit`), the 're-send resume' blocker repeats, because hook-setup is skipped. The printed `hook-fail=<clause>` names the cause (design Risk 3).
- When a setup merge brings in `services/xstockstrat-ui/` changes, the pre-commit hook may fail on main-dev content this feature does not own. Setup then blocks with 'hook failed on merge commit (main-dev content)'. The FR-9 spike measures how often (design Risk 6).

## Open Questions

- [x] **Design depth.** Resolved: the operator ran `/sdd-design` in `full` mode. It took 7 rounds, with the 5-round cap waived (D16). It was seeded with the prior design-buddy debate recorded in `context.md`. The result is `design.md`.
