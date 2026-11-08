# Context: batch-execute-token-reduction

**Feature**: `docs/roadmap/features/301-batch-execute-token-reduction/feature.md`
**Product Spec**: `docs/roadmap/features/301-batch-execute-token-reduction/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/301-batch-execute-token-reduction/implementation-spec.md`

---

## Decisions

- **Prior design input.** A design-buddy `full` debate ran before this story, on 2026-11-06 in the originating session: 12 rounds, with the 5-round cap waived by the operator for convergence. It produced the approved design that FR-1..FR-9 encode. `/sdd-design` should treat it as the starting proposal, not re-derive it.
- **Operator gate decisions from that debate** (binding unless the operator changes them):
  - **D1.** Past relaunches were fresh runs with new args, not `resumeFromRunId`. Setup re-ran because runs died, crashed or hit the 5h usage limit.
  - **D2.** The upfront validate result travels in the approval payload (`halted.record` → `approvals.upfront.record`). Nothing is written to the repo before the §5.4 confirm. This was chosen over a context.md write-gate because the F-10 reading of `sequential-mode.md:188-190` is ambiguous.
  - **D3.** context.md is always read in full (C-02). Size is handled by an approvable `distill` gate that points to `/sdd-distill`.
  - **D4.** An explicit `{gate:'resume'}` replaces any setup-done cache. A stale `resume` after a real checkpoint halt is an accepted risk.
  - **D5.** Verification stays at today's baseline: the agent judges as SKILL.md PHASE 3. Only the output volume is reduced (fence run verbatim in `( … ) > log`). A deterministic runner was rejected after rounds 2–11 kept finding false-PASS holes.
  - **D6.** Both new agents stay on `opus`. A tier change is not an input-token lever, and these stages gate irreversible writes (`docs/patterns/context-engineering.md:51`).
- **Rejected alternatives** (from the debate):
  - a step card restating the skill (DRY drift);
  - a deterministic Codebase-Evidence checker (evidence is prose, `.claude/skills/sdd-spec/reference/spec-template.md:43-45`);
  - a persistent worktree;
  - sonnet tiering;
  - a setup-done cache;
  - a context.md write-gate;
  - a header-only context.md read;
  - global `pipefail`, a pipe-position MASKED classifier, per-command markers and redirects;
  - tooling setup once per feature;
  - replacing discover.

## Open Threads

- [x] Decide the `/sdd-design` mode. Done: the operator ran full; 7 rounds (D16).
- [x] Re-run `/sdd-review product-spec` on the D12 spec delta before `/sdd-spec`. Done 2026-11-06: PASS WITH WARNINGS, warnings fixed.
- [ ] Design open risks (design.md § Open Risks; target: the PR-0 spike unless noted):
  - linked-worktree hook firing (Risk 1);
  - structural HOOK_CHECK vs dependency lag (Risk 2);
  - worktree-only re-send-resume loop (Risk 3, accepted);
  - non-atomic stale-lock reclaim (Risk 4);
  - concurrent install after a 30-minute reclaim (Risk 5);
  - hooked merge commit on main-dev ui content (Risk 6, accepted, measured in PR-0);
  - unlocked concurrent `pnpm exec husky` (Risk 7);
  - risks 9–15: operational, accepted.
- [ ] Close implementation-spec Step 1: one interactive AC-48 spike (three `spike-301c` runs: relative, absolute, exclude) and a close entry whose LAST col-0 `- spike.<key>:` line per key is the outcome (re-spike values restated). Needs a fresh operator go-ahead (D21/D23 scope) and the operator's GitHub delete of `spike/batch-execute-token-reduction` (still on origin at d4c21b65). CONTEXT_MAX (65536) and composition are already proven.
- [ ] Follow-ups out of scope, to file after launch:
  - `-X ours` at `sdd-batch-execute.js:163` → resolver;
  - define "session" in `tooling-setup.md`;
  - scoped integration-pr type;
  - a `/sdd-spec` unguarded-pipe rule;
  - the existing `:178` respec commit that bundles feature.md + context.md.

## Files Modified

- `docs/roadmap/features/301-batch-execute-token-reduction/{status.md,feature.md,product-spec.md,acceptance.feature,context.md}` (created)
- `docs/roadmap/features/301-batch-execute-token-reduction/{recon.md,design.md}` (created, /sdd-design); `product-spec.md`, `acceptance.feature` (D12 spec delta)
- `docs/roadmap/ledger/fails.md` (dir-only gitignore patterns vs worktree symlinks)
- `docs/roadmap/features/301-batch-execute-token-reduction/implementation-spec.md` (created, /sdd-spec; regenerated 2026-11-08, re-spec)

---

## Session 2026-11-06T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 301 reserved via `scripts/sdd-allocate-feature-number.sh` (`sdd/feature-cursor`).
- Consumer surface (C-14): **None**. Internal SDD tooling, used by the operator through the `/sdd-batch-execute` saved workflow.
- Ledger traps surfaced in product-spec Open Questions:
  - `fails.md:3086-3097` (-X ours)
  - `fails.md:3250-3252`, `:3381-3383`, `:3451-3453` (stale digests/prompts)
  - `fails.md:3361-3363` (inert husky)

## Session 2026-11-06T00:30:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Tree: feature/batch-execute-token-reduction@29cf6b4.
- Review loops:
  - Loop 1 — FAIL (criterion 9: unchecked Open Questions) + W1–W6.
  - Loop 2 — PASS WITH WARNINGS (6 minor scenario gaps).
  - Loop 3 — PASS, 0 warnings.
- Fixes, all landed as separate per-file commits:
  - Open Questions split into Known Traps / Accepted Risks.
  - 40-hex literals.
  - `@prompt-contract` / `@manual-spike` tags.
  - AC-18..AC-23 appended (IDs append-only).
  - Unified setupDone fence wording; named the `Stops at` column.
- Warnings: none.
- Overlap findings: none. Low-risk shared dir only: 295 edits `.claude/skills/sdd-execute/reference/repo-conventions.md`, not SKILL.md.
- Recommended design depth: quick (no runtime service, no proto, no migration, no overlap; prior design-buddy debate approved).

## Session 2026-11-06T01:30:00Z — sdd-design (in progress)

- Phase 0 recon written (`recon.md`, commit ca20083).
- Round 1: floor CLEAR. 7 MAJOR and 12 MINOR objections; all adopted for round 2.
- Operator gate decisions at round 1 (P-04):
  - **D7.** Resolver exit 2 during setup → `git merge --abort`, no commits, `completed:false`, unresolvable list surfaced (merge-train parity, `merge-train.js:108-110`).
  - **D8.** `/sdd-distill` + `context-distiller` must carry every fenced `sdd-batch-*` block verbatim. This expands scope beyond product-spec FR-8's file list; to be folded in at the end of the design.
  - **D9.** After setup makes a `respec(` commit, end the run with a `resume` halt so the next relaunch re-parses the branch tip (`fails.md:3250-3252,3449-3453`).
- Round 2: floor CLEAR. 6 of 7 round-1 majors closed. New majors N1–N5 (checker lacks ToolSearch; hook liveness; false discover stamp; wrong contextBytes path; keep-verbatim granularity) plus minors N6–N14.
- Operator gate decisions at round 2 (P-04):
  - **D10.** Inert pre-commit hook (`.husky/_` missing / `core.hooksPath` unset — true in this container): setup runs `pnpm install` once in the main worktree, which triggers husky via `package.json` `prepare`, then re-checks. If the hook is still inert, it becomes a tooling blocker. This touches the shared `.git/config` `core.hooksPath`; accepted by the operator.
  - **D11.** AC-19 is kept as is: `SKILL.md:301`'s "Report the exact output" is replaced for all modes, interactive `/sdd-execute` included.
- Round 3: floor CLEAR. N1, N3, N4 and N5 closed; D10 mechanics verified (husky ^9.1.7 `prepare` sets the shared `core.hooksPath=.husky/_`).
- New majors M1–M3:
  - M1 — symlinks show as untracked, because dir-only gitignore patterns don't match symlinks. Verified empirically; `info/exclude` fixes it. This is pre-existing: writerRules item 2 already symlinks `node_modules`.
  - M2 — the install lock can leak on a Bash timeout.
  - M3 — hook output bloats every commit.
- Operator gate decisions at round 3 (P-04):
  - **D12.** Sign-off on the design-phase spec delta: FR-1..FR-9 rewording; AC-2 and AC-17 amended; AC-21 inverted (distill halt → blocked "unreadable"); AC-24..AC-34 added. Record a Spec Changes table in design.md, then re-run `/sdd-review product-spec` before `/sdd-spec`.
  - **D13 (refines D10).** If the hook is inert:
    - if `$M/node_modules/.bin/husky` exists, run `(cd $M && pnpm exec husky)`;
    - run `pnpm install --frozen-lockfile` only when `$M/node_modules` is missing.
- Round 4: floor CLEAR. M1–M3 closed; D13 compliant. 5 new majors:
  - template-literal `${HUSKY-}` parse break;
  - round-3 clauses dropped in the merge (non-hex gate, AC-17 vs AC-34 ToolSearch, AC-21);
  - preflight `hookLive` and the writer's HOOK_CHECK diverge (resume blocker loop);
  - AC-25/AC-41 stale or vacuous, Spec Changes table rows missing;
  - integration-pr reports done with no commit.
  - Plus 7 minors (m1–m7).
- Operator gate decisions at round 4 (P-04):
  - **D14.** Run round 5 (the cap). The proposer emits one fully merged final design (round 3 + round 4 + round-4 fixes), not a delta.
  - **D15 (fixes MAJOR-3).** One shared HOOK_CHECK constant. Preflight `hookLive` runs it against the main checkout, and each clause names its own failure. The step blocker's text depends on the failing clause. D10 scope is unchanged: only setup and hook-setup write `core.hooksPath`. Rejected: writer self-repair (it widens D10).
- Round 5 (merged final design): the round-4 majors are folded in. It adds FR-10 (no silent writer no-op) and AC-43..AC-45.
- Operator gate decision at round 5 (P-04):
  - **D16.** The 5-round cap is waived by the operator ("Override cap, quality design is more important").
  - The debate continues until the adversary finds no MAJOR objection.
- Round 6: floor CLEAR; the round-4 objections are all closed.
  - 1 MAJOR (MAJOR-A): the ledger-guard amend wording resets the merge commit in the common case.
  - 11 minors: m-A..m-K.
- Operator gate decisions at round 6 (P-04):
  - **D17.** MAJOR-A: reword, keep the guard. Check `! git diff --quiet` first (reset and block). Else amend only if staged. Nothing staged → continue.
  - **D18.** integration-pr guard on `!pr.url` only, plus a prompt rule: open the PR only once the promotion commit is pushed now or the plan is already applied at the branch tip. Risk 8 is dropped.
  - **D19.** Drop the operator-note scoping and AC-45 (minimum change). AC-45 is retired, never reused.
  - **D20.** Fold m-B..m-K. Round 7 is confirm-only; stop when there are no MAJORs (D16).
- Round 7 (confirm-only): 0 BLOCKER, 0 MAJOR. Three minors folded in:
  - N1: `stop here` comes before every no-write gate.
  - N2: the unreachable respec skip key is dropped.
  - N3: the Open Risks numbering is kept stable.

## Session 2026-11-06T14:00:00Z — sdd-design

- Phase 0 Recon: wrote recon.md (no runtime services; SDD tooling only; key reuse patterns: the merge-train resolver protocol, and the promotion-plan fence and approvals plumbing).
- Phase 1 Grilling: 7 rounds (full; cap waived D16). Chosen approach:
  - scoped checker/writer agents;
  - the record in the upfront approval;
  - resume and distill gates;
  - a pinned, crash-safe setup (resolver plus ledger-guard amend);
  - a shared self-naming HOOK_CHECK with a no-commit hook-setup stage;
  - CLOG/verify logs;
  - scoped reads;
  - FR-10 no-silent-no-op guards.
- Rejected:
  - a deterministic verify runner;
  - writer self-repair of the hook;
  - integration-pr commits guard;
  - note scoping;
  - respec skip key;
  - plus the earlier list (Decisions).
- Spec delta applied per D12:
  - FR-1..FR-9 reworded; FR-10 added;
  - AC-2/13/17/18/21 amended; AC-24..AC-44 appended; AC-45 retired.
- Ledger: fails.md entry on dir-only gitignore patterns vs symlinks.
- Constitution rules touched: P-01, P-03, P-04, C-01, C-02, C-11, C-15, C-16, C-18, F-04, F-05, F-08, F-09, F-10, F-11. Floor breaches: none.
- Business rules: PRESERVE @AC-4/@AC-5/@AC-10 @feature-278.
- Status: spec-ready → design-approved.

## Session 2026-11-06T15:00:00Z — sdd-review product-spec (D12 re-review)

- Tree: feature/batch-execute-token-reduction@2648b10 (main-dev merged in first; the merge touched no design target).
- Result: PASS WITH WARNINGS; no blockers, no Floor breach. Status stays design-approved; it is not reverted to spec-ready.
- Warnings, all fixed in commit 1800415:
  - AC-3: placeholder mismatches → concrete values.
  - FR-2: the non-array record clause had no scenario → AC-46 added (AC-45 stays retired).
  - FR-9: spike items missing from AC-17 → added.
- Overlap: clean.
  - Low-risk: 295 edits `.claude/skills/sdd-execute/reference/repo-conventions.md`, a different file from SKILL.md.
  - Behavioural dependency: the existing `sdd-batch-setup` / `sdd-batch-promotion-plan` fences in 289/290 must keep parsing under D8. The fence format is unchanged.

## Session 2026-11-06T16:00:00Z — sdd-spec

- Tree: feature/batch-execute-token-reduction@157a6be ≡ origin/feature/batch-execute-token-reduction (origin/main-dev already an ancestor). No target file changed since recon's 5aac6e6 (`git diff --stat 5aac6e6 HEAD` over the touchpoints is empty), so recon/design line cites hold.
- Generated implementation-spec.md with 15 steps. Status → implementation-ready.
- Structure: Step 1 = PR-0 spike (interactive only; a workflow subagent cannot spawn agents). Steps 2–15 = seven test-first atomic units (`**Lands with**`), per fails.md:3675-3678 (test step precedes its service step).
- Sequencing change vs design §1.13 (no design change): writerRules lands before the Gate (unit 4+5), and TOOLING_HOOK + setupTask move into the Gate unit (6+7), because the Gate calls setupTask and interpolates TOOLING_HOOK. AC-13/18/25/38/41 move with them.
- Key codebase findings:
  - Baseline green: `node --test scripts/workflow-tests/*.test.mjs` 4 pass / 0 fail; `check-context-map.sh` OK.
  - No linter or coverage gate covers `.claude/workflows/` or `scripts/workflow-tests/` (lint-staged is ui-only, `package.json:17-19`; `ci.yml:877` has no coverage flag); the harness load is the parse check.
  - CI's `actions/checkout@v7` (`ci.yml:871`) is shallow, so AC-16's HARD CONSTRAINTS byte-identity cannot live in the committed test (no origin/main-dev there); it runs in Step 15's Verification.
  - AC-1 needs `checkpoints:'report'` + a promotion approval to reach integration-pr in one run (a `checkpoint:2` approval alone halts at `checkpoint:3` first).
  - CONTEXT_MAX inputs today (main checkout): 282 = 112748 B, 289 = 117632 B, 294 = 16048 B. Any calibrated value other than 65536 needs a product-spec delta (FR-4/AC-10 literal) before Step 7.
  - This container: `core.hooksPath` unset, no `.husky/_`, no `~/.config/husky/` — the inert-hook state the spike must repair.


## Session 2026-11-06T16:30:00Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 0 warnings after 2 loops (advisory; did not block). Tree: feature/batch-execute-token-reduction@f8dbf4e.
- Loop 1 found 6 warnings, all fixed in commit f8dbf4e:
  - Step 1: verification checks outcome values, and `ls-remote` must exit 2.
  - Step 6: Parts A/B with separate REDs.
  - Step 7: the test suite is the primary gate.
  - Step 12: assertions use the AC-16 terms, messages name their scenario, and the 4-member cap is recorded.
  - Steps 13 and 15: diff against the merge-base after a fetch.
  - Step 14: the Service field names both directories.
- Loop 2 was a clean PASS.
- Unresolved ✗ / ⚠ carried into execution: none.
- Overlap findings: none. Low-risk only: 295 edits other `.claude/` tooling files.

## Session 2026-11-07T00:00:00Z — operator decisions before Step 1 (PR-0 spike)

- **D21.** For this one Step 1 spike run, the operator lifted the session's original "no Workflow run" constraint. Scope: a throwaway `spike-301` workflow, one checker and one writer agent, on the `spike/batch-execute-token-reduction` branch, deleted afterwards. merge-train and `/sdd-batch-execute` stay off-limits. No other session's worktree exists in this container.
- **D22.** spike.bash32 is accepted as run on Linux GNU bash 5.2.21, not macOS `/bin/bash` 3.2. Accepted risk: macOS-only behaviour differences (BSD `find`/`mktemp`, bash 3.2 parsing) are unproven until the first real batch run on the operator's Mac.

## Session 2026-11-07T01:00:00Z — PR-0 spike (FR-9)

- Run: Workflow `spike-301`, run `wf_51d30eaf-c83` (D21). Script generated from the design's own constants: `MAINWT`, `HOOK_CHECK`, `ENV_REMEDY`, `TOOLING_HOOK`, `VERIFY` and writerRules items 2–3. `node --check` on it passes (IR-1).
  - The first launch (`wf_9c2e5ee8-b0f`) failed with "agent type not found": new `.claude/agents/*.md` files are picked up only after `/reload-skills`.
- Isolated worktree agents run behind a guard that refuses:
  - compound or multi-line Bash ("too complex to verify"): this breaks IR-2's one-call snippets, HOOK_CHECK as one line, and writerRules item 2 as one block;
  - redirects or subshells that write under the main `.git` dir: this breaks the CLOG and VERIFY logs under `git rev-parse --git-dir`, and the `info/exclude` loop form (a plain `printf >>` worked);
  - any `cd` into the main checkout `$M`: this breaks TOOLING_HOOK branches a and b.
- Result lines (the key list is from implementation-spec Step 1):
- spike.composition: pass — `agentType` was honoured under `isolation:'worktree'`. Checker tools = Bash, Read, Glob, Grep, ToolSearch (+StructuredOutput); writer tools = Bash, Read, Edit, Write, Glob, Grep (+StructuredOutput). Transcripts agent-a63cac2346a656da5, agent-aa26f6354c2c8ee07.
- spike.checker-pr-lookup: pass — path `toolsearch`. `mcp__github__list_pull_requests` was deferred, not directly callable; the ToolSearch select worked on the first try and found 0 open PRs. This is the FR-1 fallback path. AC-17 records which path was used.
- spike.first-turn-tokens: 28309 — checker 23597, writer 28309 (the writer's count includes its ~13 KB spike prompt); both ≤ 30000.
- spike.husky-linked-worktree: fail — the hook stayed inert (hook-fail=hooksPath). The main checkout has no `node_modules`, so TOOLING_HOOK branch b applied, and the guard refused `cd "$M" && pnpm install --frozen-lockfile`. No commit was made (writerRules item 2 held: commits []).
- spike.hook-cost: not-recorded — no commit was made because the hook was inert.
- spike.background-poll: fail — the guard refused the VERIFY background fence that redirects into the git-dir log (`sdd-verify.XXXXXX` under `.git/worktrees/…`). `mktemp` itself was allowed.
- spike.raw-sha-base: pass — `merge-train-resolve.mjs --base 0d97dda…` printed exit=0 (`{"resolved":[],"unresolvable":[]}`, clean merge, then aborted). `ledger-guard.py --base 0d97dda…` printed exit=0, "ledger-guard: clean".
- spike.bash32: pass — run on Linux GNU bash 5.2.21 (D22):
  - `( printf x; exit 3 ) >f 2>&1` → exit=3, and `wc -c | tr -d ' '` → 1;
  - `mktemp` is ok, the `mkdir` lock refuses a second taker, and the EXIT trap releases it;
  - `find -maxdepth 0 -mmin +30` → stale detected, fresh not stale;
  - a column-0 quoted heredoc stays literal.
- spike.husky-init: pass — `HUSKY` is unset; there is no `~/.config/husky/init.sh` and no `~/.huskyrc`.
- spike.context-max: 65536 — calibration sizes on origin/main-dev: 282 = 112748, 289 = 117877, 294 = 187033 bytes. All three exceed 64 KiB, so each would halt at distill. Keeping 65536 (FR-4); any other value needs a product-spec change first.
- Cleanup:
  - The spike worktree and the local `spike/*` branches were removed. `spike/301-target` was local only and never pushed.
  - `git push origin --delete spike/batch-execute-token-reduction` was refused by the proxy (HTTP 403, policy denial). That branch (commit d4c21b6: the two agent files only) still exists on origin and must be deleted on GitHub by the operator.
- Side effects that remain:
  - The shared `.git/info/exclude` gained `/node_modules`, `/services/*/node_modules` and `/.husky/_` (intended by design, idempotent).
  - `core.hooksPath` is still unset, and the main checkout still has no `node_modules`.
- Outcome: failing results are `husky-linked-worktree`, `hook-cost` and `background-poll`. Per Step Dependencies this is a P-04 operator decision before Step 2. Step 1 stays `pending`; nothing is committed.
- **D23 (operator, P-04 after the spike).** Re-spike the fixes, then amend the design:
  - The main session provisions the main checkout (`pnpm install --frozen-lockfile`, which wires husky through `prepare`).
  - A second 2-agent spike then tests the replacements:
    - logs in an excluded `.sdd-logs/` directory inside the worktree;
    - commands split into simple single-purpose Bash calls;
    - hook liveness as a preflight precondition that the operator or main session satisfies, never a worktree agent.
  - Then a focused `/sdd-design` amendment and re-spec on the measured results.

## Session 2026-11-07T02:00:00Z — PR-0 re-spike (D23)

- **Main checkout provisioned by the main session.** `pnpm install --frozen-lockfile` took 15.8 s under Node v22.23.4 (CLAUDE.md pins 24) with no engine warnings. Husky's `prepare` wired the hook.
- **`core.hooksPath` changed from relative to absolute.** Right after the install, `git config core.hooksPath` printed `.husky/_` (relative). By the re-spike it read `/home/user/xstockstrat/.husky/_` (absolute) in the shared `.git/config`, and nothing in this session set it. The writer was therefore not the cause of the change. I have not established what rewrote it.
- Run: Workflow `spike-301b`, run `wf_3f24944b-f87`. Every Bash form either agent tried was recorded as allowed or refused.
- **Guard rule, corrected.** The worktree-isolation guard refuses operations that target the main checkout from a worktree agent:
  - `git -C $M …` (refused, with its message quoted in the run);
  - `cd $M`;
  - writes under the main `.git` dir (run 1).

  Compound commands (`a && b`) were ALLOWED in this run. The run-1 attribution of "compound/multi-line" refusals was wrong: those snippets were refused because they referenced `$M` or `.git` paths.
- **Allowed forms:**
  - `ln -s $M/node_modules node_modules` (also for `.husky/_` and `services/xstockstrat-ui/node_modules`);
  - read-only `test -f $M/...`;
  - `node $M/scripts/merge-train-resolve.mjs` (reads only);
  - logs in a worktree-local `.sdd-logs/`, excluded through `.git/info/exclude`: `git status --porcelain --untracked-files=all` stayed empty;
  - `git commit -F .sdd-logs/msg-N.txt > .sdd-logs/commit-N.log 2>&1`, with the exit code reported by the tool;
  - a background wrapper `sh .sdd-logs/run.sh` writing `v1.exit`. It printed `exit=3`, and `spike-bg-ok` appeared in the log after 3 polls.
- **Hook firing in a linked worktree: yes, on all three commits.** The hook ran through the absolute shared `core.hooksPath`, so the `.husky/_` symlink was not needed.
- **Hook cost per commit (wall time, log bytes):**
  - plain 18 s, 24,325 B (lint-staged no-op + jscpd 7.8 s report-only);
  - ui 31 s, 32,432 B (prettier on 1 file + jscpd);
  - merge bringing 21 ui files 29 s, 30,824 B (resolver exit 0, clean).

  The main-session docs commit `120a052c` printed about 10 KB of jscpd output. Without the log redirect, every commit would put 24–32 KB into an agent's context.
- **Checker hookLive:** `false` only because `git -C $M config core.hooksPath` was refused. The worktree's own `git config core.hooksPath` reads the same shared config and is allowed (writer). The other clauses passed: `h` present, `pre-commit` present, pnpm found, `HUSKY` unset.
- **Re-spike result lines** (these replace the run-1 failures):
  - spike.husky-linked-worktree: pass (via absolute `core.hooksPath`; HOOK_CHECK's `= .husky/_` clause must also accept `$M/.husky/_`);
  - spike.hook-cost: recorded (18/31/29 s; 24–32 KB per commit);
  - spike.background-poll: pass (wrapper-script form under `.sdd-logs/`).
- **Design consequences, for the focused amendment (D23):**
  1. No worktree agent may install, repair hooks or write to the main checkout or the main `.git`. Hook provisioning becomes a preflight precondition satisfied by the operator or main session, or by a hook-setup stage run WITHOUT worktree isolation.
  2. Logs move from `git rev-parse --git-dir` to worktree-local `.sdd-logs/`; the exclude line `/.sdd-logs` is added.
  3. HOOK_CHECK runs in the agent's own worktree (no `git -C`), and its hooksPath clause accepts `.husky/_` or an absolute path whose `h` exists.
  4. The `.husky/_` symlink is dropped while hooksPath is absolute; the `node_modules` links stay.
  5. The `run_in_background` + `.exit` sentinel works through a wrapper script.
- **Cleanup:** the re-spike worktree, `spike/301-target` and the harness branches `worktree-wf_*` were deleted locally. `spike/batch-execute-token-reduction` is still on origin (proxy 403), and the operator deletes it.

## Session 2026-11-08T00:00:00Z — sdd-design amendment (D23), quick, round 1 gate

- Phase 0: scoped amendment recon written (`recon.md` § "Amendment recon — 2026-11-07", commit 201cf104). No escalate-to-full signal, so the mode stays quick.
- Round 1 proposal: the hook is an operator/main-session precondition.
  - Preflight runs the shared HOOK_CHECK non-isolated.
  - The gate blocks only runs that would commit.
  - Writers re-check and never repair.
  - Logs move to `.sdd-logs/`.
  - Hook-setup, TOOLING_HOOK a/b/c and the install lock are removed.
- Round 1 adversary: Floor clear, 0 MAJOR, 8 MINOR. These are:
  - Risk-16 wording;
  - dangling text;
  - Step 1/Step 6 re-spec gaps;
  - an untested Land block;
  - hookFail hidden at the upfront halt;
  - two D23 departures (info/exclude append; `.husky/_` link kept);
  - no rule for a failed exclude append;
  - clause normalisation.
- **D24 (operator, P-04 at the round-1 gate).** Run another round; do not approve yet. On the absolute hooksPath arm: keep accepting any absolute `<X>/.husky/_` whose `h` and `pre-commit` exist, and only reword the risk (Open Risk 16) honestly. The two D23 departures are NOT signed off; round 2 must resolve them.
- Round 2: floor CLEAR.
  - Departure 1 resolved: the excludes become a precondition, via the new `exclude` clause in HOOK_CHECK, and no writer writes the main `.git`.
  - Departure 2 judged sound: the `.husky/_` link is kept unconditionally.
  - 1 MAJOR: a step writer following `tooling-setup.md` would run `pnpm install` in its worktree.
    - Through the `node_modules` links this writes `<M>/node_modules`.
    - It also runs `prepare: husky`, which rewrites the shared `core.hooksPath` to relative. The guard cannot see this.
  - 9 MINOR (m1–m9).
- Measured by the orchestrator, 2026-11-08: in a scratch repo with `core.hooksPath=.husky/_` and no such directory, `git commit` exits 0, runs no hook and prints no warning. A missing hooks dir is a silent skip.
- **D25 (operator, P-04).** Departure 2 is signed off: keep the `.husky/_` link unconditionally, as an operator-approved exception to D23 consequence 4. The evidence is:
  - the measured silent skip;
  - the known flip source: husky `prepare` (`package.json:7`) writes the relative form whenever `pnpm install` runs.
- **D26 (operator, P-04).** Run round 3 to fold MAJOR-1 (writers never run `pnpm install`; a missing package is a blocker with a main-session remedy) and all nine minors, m8 and m9 included. Round 3's adversary re-checks only the changed edits.
- Round 3 (scoped re-check): floor CLEAR, 0 MAJOR, 4 MINOR. All four were folded in by the orchestrator:
  - superseded-row labels made partial where live clauses remain, plus FR-1 labelled;
  - a lockfile/dependency-change blocker keyed on the worktree, with "never edit pnpm-lock.yaml by hand";
  - `hookBlocked` treats a blank or whitespace value as healthy (verified in node: undefined, "", " " → "");
  - wording fixes.
- **D27 (operator, P-04).** Amendment approved. `npx <pkg>` and `pnpm dlx` are allowed: they write only `$HOME` caches, never the linked `node_modules`.

## Session 2026-11-08T03:00:00Z — sdd-design (amendment, quick)

- Phase 0: scoped amendment recon (recon.md § "Amendment recon — 2026-11-07").
- Phase 1: 3 quick rounds (D23–D27). Chosen approach:
  - a live hook plus the four `info/exclude` lines are an operator/main-session precondition;
  - preflight (non-isolated) runs the shared HOOK_CHECK and reports `hookFail`;
  - the gate blocks only runs that would commit, and halts carry the message;
  - writers re-check, never repair, never write under `<M>`, never run a Node install;
  - logs and message files live in `.sdd-logs/`;
  - the `.husky/_` link is kept (D25).
- Rejected:
  - a non-isolated hook-setup stage (an install race in the operator's checkout);
  - a conditional `.husky/_` link (silent skip);
  - writers appending the excludes (D23 consequence 1);
  - per-worktree unlinked installs (cost; follow-up if Risk 20 is common).
- Spec delta:
  - FR-1, FR-3, FR-5, FR-6, FR-7, FR-8 and FR-9, Affected Services, Known Traps and Accepted Risks reworded;
  - AC-15, AC-17, AC-23, AC-25, AC-26, AC-35, AC-37, AC-38, AC-39 and AC-42 amended in place;
  - AC-36 retired; AC-47 and AC-48 added.
- Constitution rules touched: P-01, P-03, P-04, C-16, C-18, F-04, F-08, F-10, F-11. Floor breaches: none. Business rules: PRESERVE @AC-4/@AC-5/@AC-10 @feature-278.
- Status unchanged (`implementation-ready`). `implementation-spec.md` is stale against the amended design (Steps 1, 3–9 and the Step 6/7 fixtures, per the re-spec list in the round-3 proposal). Next: `/sdd-review product-spec` (D12 precedent), then `/sdd-spec` re-spec. Step 1 closes after the re-spec, with spike lines from the re-spike plus AC-48.

## Session 2026-11-08T04:00:00Z — sdd-review product-spec (D23 re-review)

- Tree: feature/batch-execute-token-reduction@020740fa.
- Result: PASS WITH WARNINGS. No blockers, no Floor breach. Status stays `implementation-ready`.
- Warnings:
  - 2 stale cites (`ci.yml:863-877` → `:900,903`; `context-engineering.md:167-170` → `:170`): fixed.
  - AC-48 uses implementation names: waived, because it is a `@manual-spike` that measures exactly those.
- Overlap: clean. Low-risk only: 295 edits `.claude/skills/sdd-execute/reference/repo-conventions.md`, a different file from SKILL.md.
- Next: `/sdd-spec` re-spec against the amended design.

## Session 2026-11-08T05:00:00Z — sdd-spec (re-spec, D23–D27)

- Tree: feature/batch-execute-token-reduction@23f866b ≡ origin/feature/batch-execute-token-reduction (origin/main-dev@0d97ddaf already an ancestor). Every touchpoint is byte-identical to 157a6be (`git diff --stat 157a6be HEAD` over them is empty), so recon/design line cites hold.
- Regenerated implementation-spec.md: 15 steps, same seven test-first units. Status stays implementation-ready.
- Changes vs the 2026-11-06 spec:
  - Step 1 is now the spike close: AC-48 only (three `spike-301c` runs with `args.phase`), plus a last-wins `spike.*` record so the run-1 failures are superseded by col-0 restatements of the re-spike results. Its Verification fails today only on the AC-48 keys, those three restatements and the origin spike branch (dry-run checked).
  - Inert fixtures (`MD`/`DV`/`SH`, `REC`, `count`/`callOf`/`after`, the new `pre()` defaults incl. `hookFail: ''`, the new `setup:`/`integration-pr:` reply fields) move to Step 2; today's script ignores them.
  - Steps 4+5: AC-26/AC-39 on the `.sdd-logs/` Write-tool commit form and the no-Node-install rules; constants `MAINWT`, `HOOK_CHECK`, `ENV_REMEDY`, `HOOK_REMEDY`, `EXCLUDE_REMEDY`, `hookMsg`. `hookBlocked` moves to Step 7 with its first caller.
  - Steps 6+7: hook-setup, `HOOKSETUP`, `TOOLING_HOOK` and `hookLive` are gone. Added: `hookFail`, the `writesWithoutSetup` block, AC-47, AC-37's seven cases, and the merge-order halt's `hook` field (`:234`). AC-36 is retired. Part B's RED is now AC-13.
  - Steps 8+9: AC-15/23/42 on the `.sdd-logs/run-<K>.sh` wrapper; READ_SCOPE/VERIFY go right after `PR` (no TOOLING_HOOK).
  - Steps 10–15: unchanged apart from refreshed cites (`ci.yml:897,900,903`; `fails.md:3449`).
- Key codebase findings:
  - Container already satisfies the hook precondition: `node_modules/` present, `core.hooksPath` = `/home/user/xstockstrat/.husky/_` (absolute), `.husky/_` exists, all four `info/exclude` lines present.
  - Baseline: `node --test scripts/workflow-tests/*.test.mjs` 4 pass / 0 fail; `check-context-map.sh` OK.
  - `design.md` Spec Changes table still holds the literal placeholder row `<the (B) rows, verbatim>` (the D23 rows were never written in). This is doc drift only: product-spec.md and acceptance.feature carry the final text, and no step depends on that table. Fixed 2026-11-08: the round-3 (B) rows were written in.


## Session 2026-11-08T05:00:00Z — sdd-review impl-spec (advisory, re-spec)

- Result: 0 failures and 0 warnings after 3 loops (advisory; did not block). Tree: feature/batch-execute-token-reduction@8e9e8833.
- Loop 1, 1 warning (fixed in b9185069): Step 1's spike prompt inherited writerRules item 2's no-commit rule, which conflicts with phase `relative` (c). Added an explicit spike override.
- Loop 2, 1 warning and 1 note (fixed in 8e9e8833):
  - The override now also waives item 2's write-set limit for phase `relative`'s own three writes only, with no override for other phases.
  - The marker moved to line 2 of `.husky/pre-commit`, before lint-staged, and is recorded rather than retried.
- Loop 3: clean PASS (15/15 ✓).
- Unresolved ✗ / ⚠ carried into execution: none.
- Notes, optional and not carried:
  - No test asserts that "spike override" is absent from the real writerRules; the override text exists only in the throwaway `spike-301c.js`.
  - Step 6 is large, which the spec justifies.
- Overlap findings: none. 301 is the only feature at implementation-ready or in-progress.

## Session 2026-11-08T06:00:00Z — operator go-ahead for the third spike run

- **D28 (operator, P-04).** The operator approves the third spike run for Step 1 (AC-48 close-out): one writer and three short phases (`relative`, `absolute`, `exclude`), with the main session changing the shared git config between phases as Step 1 specifies. It extends D21/D23 to this run only. merge-train and `/sdd-batch-execute` stay off-limits.
