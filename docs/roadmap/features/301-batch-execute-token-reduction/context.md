# Context: batch-execute-token-reduction  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: Shipped:
- scoped workflow-internal agent types (`sdd-batch-checker`, `sdd-batch-writer`);
- upfront validation that is approved once and carried as a record;
- resume and distill gates;
- scoped step reads;
- verification logs written to files.

It began as a token-cost fix. Most of the effort went into spikes, and they disproved the first design's assumptions about the agent runtime (the worktree guard, hook firing, exit-status visibility). The original 7-round debate had designed a hook-setup stage, an install lock and heredoc/git-dir logs; all of it was discarded after the first spike. The shipped design makes the main checkout an operator-satisfied precondition, and every decision prints its own status. Before Step 2 started, it took:
- 4 spike rounds: `wf_51d30eaf-c83`, `wf_3f24944b-f87`, `wf_3ce0d1f3-477`, then runs A and B twice;
- 3 design amendments: D23–D27, D29–D30, D32–D34.

**Token baseline (from the pruned product-spec; recorded nowhere else):**
- 14 operator runs used about 1.61B input tokens.
- A default workflow subagent starts every turn from about 100K fixed context tokens, against about 22K for a scoped agent.
- Mean input per agent was 12.12M for step agents, 12.87M for validate and 14.13M for setup.
- Step agents read the whole SKILL.md and 100–160 KB specs over 60–145 turns.

After the change, the scoped first turn measures 23,597 tokens for the checker and 28,309 for the writer. The writer figure includes the ~13 KB spike prompt, so it is not a clean production figure. **No post-launch measurement of total batch tokens has been recorded.**

**Why (irrecoverable rationale)**:
- **D1:** past relaunches were fresh runs with new args (crash or the 5h usage limit), never `resumeFromRunId`. That is why setup re-ran.
- **D2:** the record travels in the approval payload, not through a context.md write-gate. The F-10 reading of `sequential-mode.md:188-190` is ambiguous.
- **D5:** verification stays agent-judged. A deterministic runner was rejected after rounds 2–11 kept finding false-PASS holes.
- **D6:** both agents stay on opus. Model tier is not an input-token lever, and these stages gate irreversible writes.
- **D23:** the hook, `node_modules` and the four `info/exclude` lines are an operator or main-session precondition. The worktree guard refuses any agent operation that targets the main checkout.
- **D26:** writers never run a Node install.
  - The worktree `node_modules` are links into `<M>`, so `pnpm install` would write `<M>/node_modules`.
  - That races `pipeline` writers and runs husky `prepare`, which rewrites the shared `core.hooksPath`.
  - The guard cannot see any of this.
- **D9:** after a respec commit the run ends with a `resume` halt, so the relaunch re-parses the branch tip (`// D9` in `sdd-batch-execute.js`).
- **D32/D34:** every decision-bearing command ends with `; echo "rc=$?"`, because the Bash tool shows a silent pass and a silent fail identically.

**Rejected alternatives**:
- **A step card restating the skill:** DRY drift.
- **A discover `Tree:` stamp:** it is caller-copied, so it always "matches". That is why discover writes `Checkout: UNSTAMPED`.
- **A distill halt on an unreadable size:** it hides a preflight defect, so AC-21 was inverted to "blocked unreadable".
- **D8 at session level:** keeping whole fence-holding sessions verbatim makes the setup session undistillable, and a separate setup session changes the `SKILL.md` layout. So D8 works at fence granularity.
- **A main-worktree install alone:** a relative hooksPath resolves per worktree, so linked worktrees stay inert.
- **Dropping the write-plan guard as scope creep:** the design itself introduces "writer returns commits []".
- **A deterministic Codebase-Evidence checker:** the evidence is prose.
- **Other rejects (no per-item reasons recorded beyond the D-entries):**
  - a persistent worktree;
  - a setup-done cache (replaced by an explicit `resume` gate, D4);
  - a context.md write-gate;
  - a header-only context.md read (C-02);
  - global `pipefail` / a MASKED classifier;
  - once-per-feature tooling;
  - replacing discover;
  - sonnet tiering.
- **Writer self-repair of the hook:** the guard refuses `cd`/`git -C <M>`, and it would widen D10 to a workflow writing the shared `core.hooksPath`.
- **A separate preflight hook predicate, or a one-line form in preflight only:** two spellings of one fact caused the MAJOR-3 resume loop. So preflight renders the same 11 split calls even though the guard doesn't apply there (D15).
- **Moving the hook check into a `bash <file>` script to get past the guard:** the operator rejected this as routing around the guard's "split into plain commands" instruction (D29).
- **A hook-setup stage, isolated or not:**
  - Isolated, the guard refuses the install.
  - Non-isolated, a Bash/Edit/Write agent runs `pnpm install` in the live checkout, races `pipeline`, and brings back the lock apparatus.
  - All of this to save one 15.8 s command per container.
- **Writers or preflight appending `info/exclude` lines:** breaks D23. Preflight is the read-only checker, and it runs before the record-matching confirm (F-10).
- **A conditional `.husky/_` link (only when hooksPath is relative):** husky `prepare` flips the path to relative on any main-session install, and a missing hooks dir means the hook is silently skipped (D25).
- **Requiring the absolute hooksPath as the precondition:** the operator's own remedy (`pnpm install`) writes the relative form.
- **A per-worktree unlinked install (`--ignore-scripts`):** costs a whole-workspace install per writer, and its interaction with the pnpm store is unmeasured. Kept as the follow-up if Open Risk 20 bites.
- **One `grep -c` for the four exclude lines:** a duplicated line can stand in for a missing one.
- **`! git diff --quiet; echo "rc=$?"`:** makes rc=0 mean "dirty", the opposite of every other site, and `!` is an unmeasured guard form (D34).
- **Suffixing the 11 HOOK_STEPS commands by hand:** 11 copies of one literal. The renderer appends `RC` once (C-18).
- **Suffixing only the three sites D32 named:** leaves the run-A misreport class in place (D34).
- **An integration-pr `commits.length` guard:** it falsely blocks a relaunch after a pushed promotion, and a plan that dedups to zero scenarios. Replaced by `!pr.url` plus a prompt rule (D18).
- **Operator-note scoping (AC-45, retired):** after a `blocker:<n>` halt, the first pending unit always contains n (D19).
- **A commit-message respec skip key:** unreachable. A pushed respec changes the spec blob, and an unpushed one dies with its worktree.
- **`git add -u` for the ledger-guard amend:** can sweep in non-ledger edits.
- **A `.gitignore` edit to hide symlinks:** a tracked change on every branch.

**Scars & gotchas**:
- **New agent types need a reload.** New `.claude/agents/*.md` types are unusable until `/reload-skills`; the first launch failed with "agent type not found". Deleted throwaway agent types stay registered until the next reload.
- **Guard refusals were misattributed three times.**
  - Run 1 blamed "compound/multi-line" commands.
  - The re-spike said compounds were allowed and blamed targeting `$M`/`.git`.
  - Spike-close run 1 blamed `$( )`, `case`, `${…}` and `{ …; }` as "complex compounds".
  - The transcript then showed ONLY brace groups are refused; `$( )`, `;`, `${…}`, pipes and `[ … ] || ln` are allowed.
  
  Each wrong attribution drove a design amendment.
- **Isolated worktree creation appears to rewrite the shared `core.hooksPath` to absolute.** This is inferred from timing; the setter was never observed. Under workflow isolation the D25 `.husky/_` link is therefore inert, and relative-form behaviour cannot be tested.
- **The Bash tool shows "(Bash completed with no output)" for both passing and failing silent commands.** Spike runs A and B both misreported results because of it.
- **The hook prints 23–32 KB per commit** (jscpd report-only dominates, about 7.8 s) and takes 18–31 s. Without redirecting it to a log, every commit floods the agent's context.
- **Workflow script shadowing.** A variable named `phase` shadowed the workflow's `phase()` function (`wf_a09f699f-7cf`).
- **The proxy refuses `git push origin --delete` (HTTP 403).** The operator deleted the origin spike branch in the GitHub UI.
- **A workflow subagent cannot spawn agents,** so the spike step is interactive only.
- **Reaching integration-pr in one run** needs `checkpoints:'report'` plus a promotion approval. A `checkpoint:2` approval alone halts at `checkpoint:3` first.
- **CI `actions/checkout@v7` is shallow.** AC-16's HARD CONSTRAINTS byte-identity check therefore cannot be a committed test; it runs only in Step 15 Verification.
- **No linter or coverage gate covers `.claude/workflows/` or `scripts/workflow-tests/`.** The harness load is the only parse check.
- **The host runs Node 22, not the pinned 24.** This was fine for the `node --test` suites.
- **CONTEXT_MAX=65536 was kept,** although features 282, 289 and 294 exceeded it on origin/main-dev, so each would halt at distill.

**Permanent deviations**:
- **Hook setup.**
  - Original design (7 rounds): a no-commit hook-setup stage, TOOLING_HOOK a/b/c, an mkdir install lock, writers running `pnpm exec husky`/`pnpm install`, logs under the `git rev-parse --git-dir` mktemp, and a heredoc commit form.
  - Shipped: no workflow install or hook repair. A precondition block names the remedy, logs go to `.sdd-logs/` in the worktree, and commit messages are Write-tool message files.
  - Because: the PR-0 spike showed the guard refused every one of those forms (D23).
- **Status reporting.**
  - Design (D29): status is "the exit code the tool reports".
  - Shipped: `; echo "rc=$?"` at every decision site, with `!` dropped and rc≠0 meaning dirty.
  - Because: spike runs A and B misreported (D32/D34).
- **The `.husky/_` link is created unconditionally,** even though it is inert under the absolute hooksPath that isolation produces. This is deliberate (D25): it is the only cover for a flip to relative during a run. It is not dead code.
- **The only two rc exceptions:** `printenv HUSKY` passes on any rc unless it prints `0`, and the resolver branches on rc=2.
- **Preflight runs 11 single-command Bash calls despite being non-isolated.** Deliberate (D15).
- **A deliberate heuristic backstop:** a commit log under 400 B after rc=0 is treated as hook-fail=h (D30).
- **No commits-length guard on integration-pr** (D18).
- **The `-X ours` validate merge is kept** (out of scope).
- **`SKILL.md:301`'s wording changed for all modes,** including interactive `/sdd-execute` (D11).
- **D8 scope expansion:** `/sdd-distill` and `context-distiller` must keep every `sdd-batch-*` fence byte-for-byte, so that preflight's "LAST fence" still finds the newest one.
- **Sequencing:** writerRules landed before the Gate, and TOOLING_HOOK/setupTask moved into the Gate unit, because the Gate calls setupTask.
- **Test grouping:** Step 6 tests are grouped into blocks 14/15, and Steps 8+9 into block 16, instead of one block per AC. Every assertion still names its AC-N.

**Cross-feature signal**:
- **One class of mistake.** The three existing 301 fails entries plus the guard-misattribution scar are all assumptions about agent-runtime or tool behaviour that a live spike disproved only after desk debate had built on them. The fix is the existing rule "spike agent-runtime assumptions before designing".
- **The hooksPath writer, probably.** Features 289, 290 and 295 also recorded an absolute `core.hooksPath` without finding its writer. 301 inferred it is isolated worktree creation.
- **The silent-exit-status trap is general.** It applies to every skill or workflow prompt that branches on `test`, `grep -q` or `git diff --quiet`.

**Deferred follow-ons**:
- **Small changes to make:**
  - replace `-X ours` at `sdd-batch-execute.js` (validate merge) with the resolver;
  - define "session" in `tooling-setup.md`;
  - add a scoped integration-pr type;
  - add a `/sdd-spec` unguarded-pipe rule;
  - confirm that the new setupTask resolves the respec commit that bundles feature.md and context.md.
- **Open Risk 2:** HOOK_CHECK passes on structure alone. The main checkout's dependencies can lag `devSha` (there is no workflow install), so the hook may silently do nothing. Only the 400-B backstop catches it.
- **Open Risk 3:** preflight can pass on main while a writer fails clause `h` or `pre-commit`, so the blocker repeats on each relaunch. The hook-fail=<clause> line is the only diagnostic.
- **Open Risk 17:** hooksPath can flip (e.g. after an operator `pnpm install`) between a writer's check and its commit. Nothing guards that window.
- **Assumed, not measured:** the `$HOME` uv and Go module caches tolerate concurrent writers under `pipeline`. A collision fails that step's own Verification; it cannot write `<M>` or `core.hooksPath`.
- **Open Risk 18:** the setupTask resolver and the ledger-guard rc-suffixed calls were never spiked under the guard.
- **D22:** macOS bash 3.2 and BSD tools are unproven until the first real batch run on the operator's Mac.
- **Open Risk 20:** a step that adds or upgrades a Node dependency cannot run under `/sdd-batch-execute`. If this is common, the follow-up is a per-worktree unlinked install.
- **Open Risk 16:** an absolute hooksPath gates every worktree's commits with the main checkout's `.husky/pre-commit` body. If it bites, add a `cmp -s "<B>/pre-commit" .husky/pre-commit` step.
- **Open Risk 6:** a hooked merge commit can fail on main-dev UI debt. File a follow-up if it happens.
- **Open Risk 21:** the hook check is agent-evaluated, so an unsafe-direction misread could commit with an inert hook. The 400-B backstop is the only deterministic guard.
- **Measure the actual post-launch token reduction** against the 1.61B / 14-run baseline.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-11-10 entries. The existing gitignore-symlink, worktree-repair, silent-exit-status and spike-first entries were skipped as duplicates.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **PLAT, worktree guard:** a worktree-isolated workflow agent's guard refuses:
  - `git -C <main>` and `cd <main>`;
  - writes or redirects under the main `.git`;
  - any Bash call containing a `{ …; }` brace group.
  
  Writes through a symlink into the main checkout are invisible to it.
- **PLAT, exit status:** the Bash tool reports a silent command's success and failure identically; decide by `; echo "rc=$?"`.
- **PLAT, hooksPath:**
  - isolated worktree creation appears to leave the shared `core.hooksPath` absolute;
  - husky `prepare` writes it relative;
  - a hooksPath naming a missing dir makes `git commit` succeed with no hook and no warning.
- **PLAT, hook cost:** the pre-commit hook costs 18–31 s and prints 23–32 KB per commit. Agents must redirect commit output to a log.
- **PLAT, agent types:** new `.claude/agents/*.md` types need `/reload-skills`.
- **PLAT, environment:** the proxy denies `git push --delete` (403).

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51. The pre-archive context.md Session blocks, cited by the existing 301 fails entries, are also at that SHA.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-11-07T00:00:00Z — operator decisions before Step 1 (PR-0 spike)

- **D21.** For this one Step 1 spike run, the operator lifted the session's original "no Workflow run" constraint. Scope: a throwaway `spike-301` workflow, one checker and one writer agent, on the `spike/batch-execute-token-reduction` branch, deleted afterwards. merge-train and `/sdd-batch-execute` stay off-limits. No other session's worktree exists in this container.
- **D22.** spike.bash32 is accepted as run on Linux GNU bash 5.2.21, not macOS `/bin/bash` 3.2. Accepted risk: macOS-only behaviour differences (BSD `find`/`mktemp`, bash 3.2 parsing) are unproven until the first real batch run on the operator's Mac.

### Session 2026-11-09T04:00:00Z — operator decisions on design amendment 3

- **D32 (operator, P-04).** Every decision-bearing command prints its own status:
  - Scope: the 11 `HOOK_STEPS`, `git commit -F …`, and the setupTask ledger-guard `--fix` call.
  - Form: the command ends with `; echo "rc=$?"`, and passes only when it prints `rc=0`.
  - AC-38 is narrowed to allow exactly that suffix. Every other `;` / `&&` / `$(` stays forbidden.
- **D33 (operator, P-04).** Carry amendment 3 through without stopping in between unless something fails:
  - `/sdd-design quick`;
  - re-spec;
  - an impl-spec review loop;
  - re-runs of spike runs A and B. These are the same throwaway `spike-301c` Workflow regenerated from the amended constants, with nothing pushed; D31's marker/exclude edits and their restores are reused.

  merge-train and `/sdd-batch-execute` stay off-limits.
