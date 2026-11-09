# Implementation Spec: batch-execute-token-reduction

**Status**: `pending`
**Created**: 2026-11-06 (re-spec 2026-11-08 against the D23–D27 design amendment; re-spec 2026-11-09 against the D29–D30 amendment)
**Feature**: `docs/roadmap/features/301-batch-execute-token-reduction/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/batch-execute-token-reduction`

---

## Execution Summary

Step 1 is the FR-9 PR-0 spike. Two spike runs are already recorded in `context.md` (`wf_51d30eaf-c83`,
`wf_3f24944b-f87`), and a third (`wf_3ce0d1f3-477`) halted on the guard and drove D29; Step 1 closes by
running the re-scoped AC-48 checks (phases `absolute` and `exclude`) and appending one close entry
whose last-written `spike.*` line per key is the outcome. It runs interactively, on no merged branch,
and gates everything after it (P-04). Steps 2–15 then build the change test-first as six atomic
units, each a `test` step followed by the change it proves, one red→green commit per unit
(`docs/patterns/context-engineering.md:226`, "Change a gate rule → change its test first";
`docs/roadmap/ledger/fails.md:3449`, a test step that covers a service step must precede it):

1. Steps 2+3 — agent types, `agentType` wiring, context-map entries, shared test fixtures (FR-1).
2. Steps 4+5 — the hook/remedy constants (`HOOK_STEPS` rendered once as `HOOK_CHECK`) and the
   `writerRules` rewrite: links (the `.husky/_` link split into plain calls), `.sdd-logs/`, the read-only
   hook re-check, no Node install, Write-tool commit messages and the 400-byte hook-ran backstop (FR-5
   writer rules, D23–D34).
3. Steps 6+7 — schemas, preflight (`hookFail`), the Gate (record / distill / resume / hook
   precondition), `setupTask`, the merge-order halt's `hook` field (FR-2..FR-5).
4. Steps 8+9 — `READ_SCOPE`, `VERIFY` (`.sdd-logs/` wrapper) and the step prompt (FR-6, FR-7).
5. Steps 10+11 — Land guards (FR-10).
6. Steps 12–15 — static doc asserts, then `SKILL.md:301`, the distill fence rule, §4 and the
   context-map header (FR-7 wording, FR-8).

**What changed in this re-spec (design amendment D23–D27).** The hook-setup stage, `HOOKSETUP`,
`TOOLING_HOOK`, the install lock, `hookLive`, the heredoc/CLOG commit form and the `mktemp` git-dir
logs are gone. In their place: `hookFail` (a clause string) from a non-isolated preflight,
`hookMsg`/`hookBlocked` and the `HOOK_REMEDY`/`EXCLUDE_REMEDY` constants, a Gate that blocks only runs
that would commit, and `.sdd-logs/` for message files, commit logs and verification logs. AC-36 is
retired; AC-47 and AC-48 are new. Every snippet is taken verbatim from `design.md` §1.1–§1.12, which
binds (IR-1, IR-2 and IR-4 included; IR-3 is retired).

**What changed in the 2026-11-09 re-spec (design amendment D29–D30).** The worktree guard refuses any
Bash call holding a `{ …; }` brace group (`wf_3ce0d1f3-477`; recon § "Amendment recon 2", correction).
The one-line `HOOK_CHECK` plain string is replaced by `HOOK_STEPS` (11 plain single commands, one Bash
call each) and its one template-literal rendering `HOOK_CHECK`, shared by writerRules item 2 and
preflight item 13 (D15). The `.husky/_` link line is split into `test -e` / `test -d` / `ln -s`.
writerRules item 3 gains the D30 backstop: after a commit that prints `rc=0` (D32), `wc -c` of its log under 400
bytes means no hook ran (`hook-fail=h`). AC-26 and AC-38 are amended in place (Steps 4 and 6); AC-48 is
re-scoped to the absolute `core.hooksPath` form and `exclude` (Step 1). Re-spec'd: Steps 1, 4, 5, 6
(AC-38 block) and the evidence of Steps 8 and 9 (VERIFY's poll forms are measured guard-accepted, so
VERIFY is unchanged). Steps 2, 3, 7 and 10–15 are unchanged: Step 7 lands `setupTask` and the preflight
prompt verbatim from `design.md` §1.4/§1.6, which already carry the D29 text.

**What changed in the 2026-11-09 re-spec (design amendment D32–D34).** Spike-close runs A and B showed
that the Bash tool displays a silent pass and a silent fail identically (`context.md` § "PR-0 spike
close, runs A and B (D31)"). Every decision-bearing command now ends with one `RC` constant
(`; echo "rc=$?"`, `design.md` §1.2), which the `HOOK_CHECK` renderer appends and every prose decision
site interpolates. `!` is dropped from the `git diff --quiet` checks (an rc other than 0 means dirty).
AC-13, AC-26, AC-38, AC-41 and AC-48 are amended in place; no AC is added. Re-spec'd: Step 1 (spike
re-runs A/B, printed-rc evidence, two guard probes), Steps 4, 5 and 6 (literals, one shared `RC_SFX`
test constant), and Step 7's Verification. Step 7 still lands §1.4/§1.6 verbatim.

**Sequencing vs `design.md` §1.13 (no design change).** The design builds the Gate (its step 2)
before `setupTask` + `writerRules` (its step 3). The Gate calls `setupTask(f, p, r)`, and
`setupTask` and the Gate both use `hookMsg`/`HOOK_CHECK` and say "git-protocol item 2", so this spec
lands `writerRules` and the hook constants first (unit 2) and moves `setupTask` with its
prompt-contract scenarios (AC-13, 18, 25, 38, 41) into the Gate unit (unit 3). The test fixtures that
are inert against today's script (`MD`/`DV`/`SH`, `REC`, the new `pre()` defaults and the new
`replies()` fields) land in Step 2, so later units only add blocks.

**Line numbers.** Every `sdd-batch-execute.js:<n>` and `sdd-batch-execute.test.mjs:<n>` cite is to the
pre-feature file at tree `23f866b` (identical to `157a6be` and recon's `5aac6e6` for every
touchpoint: `git diff --stat 157a6be HEAD` over them is empty). Re-confirmed at `bb7cb63` (2026-11-09,
after merging `origin/main-dev@ee9a301`): `git diff --stat 23f866b HEAD` over the touchpoints shows only
`.claude/agents/codebase-discovery.md:34`, which no step cites. Earlier steps shift later lines; locate
each edit by the quoted anchor text, not by number.

**Consumer surface (C-14):** None — internal SDD tooling consumed by the operator through the
`/sdd-batch-execute` saved workflow (product-spec § Consumer Surface(s)). No UI or Agent step is
required; this is a recorded decision, not an omission.

**Coverage threshold (C-08) and lint:** the workflow tests have no CI coverage gate
(`.github/workflows/ci.yml:903` runs `node --test scripts/workflow-tests/*.test.mjs` with no coverage
flag) and no linter covers `.claude/workflows/` or `scripts/workflow-tests/` (`package.json` lint-staged
targets only `services/xstockstrat-ui/**`). The harness loading the script
(`scripts/workflow-tests/harness.mjs:9,24`) is the parse check. Every test-step Verification therefore
runs the suite plus `check-context-map.sh` (`ci.yml:900`).

**Baseline (2026-11-09, tree `bb7cb63`; unchanged from 2026-11-08 at `23f866b`):** `node --test scripts/workflow-tests/*.test.mjs` → `# pass 4`,
`# fail 0`; `./scripts/check-context-map.sh` → `OK - all context-map and doc references resolve.`

### Scenario Coverage (C-15)

| Scenario | Step(s) |
|---|---|
| AC-1, AC-2 | 2 |
| AC-3 – AC-13 | 6 |
| AC-14, AC-15 | 8 |
| AC-16 | 12 (+ Step 15 Verification for the HARD CONSTRAINTS byte-identity and the two CI commands) |
| AC-17 | 1 |
| AC-18 | 6 |
| AC-19 | 12 |
| AC-20 | 1 (recorded `spike.composition: pass`, so the fallback is not taken) |
| AC-21, AC-22 | 6 |
| AC-23 | 8 |
| AC-24, AC-25 | 6 |
| AC-26 | 4 |
| AC-27 | 12 |
| AC-28 – AC-31 | 6 |
| AC-32, AC-33 | 8 |
| AC-34, AC-35 | 6 |
| AC-36 | retired (D23) — no step |
| AC-37, AC-38 | 6 |
| AC-39 | 4 |
| AC-40, AC-41 | 6 |
| AC-42 | 8 |
| AC-43, AC-44 | 10 |
| AC-45 | retired (D19) — no step |
| AC-46, AC-47 | 6 |
| AC-48 | 1 |

## Step Dependencies

- **Step 1 runs interactively, not under `/sdd-batch-execute`.** It launches a throwaway workflow and
  measures agent transcripts; a workflow subagent cannot spawn agents (`context-engineering.md:157-158`).
  Run it as `/sdd-execute batch-execute-token-reduction 1` in the operator's main session.
- **Step 2 requires Step 1** with these outcomes as the LAST `- spike.<key>:` line per key in
  `context.md`; any other outcome is a §5.7 blocker for the operator (P-04), not a silent adaptation:
  - `composition: pass` — else AC-20 applies (CHECKER on preflight only) and Steps 3 and 7 are
    re-spec'd first;
  - `checker-pr-lookup: pass` — else preflight keeps the default type (design §1.13 "Spike outcomes");
  - `first-turn-tokens` ≤ 30000;
  - `husky-linked-worktree`, `background-poll`, `raw-sha-base`, `bash32` (D22), `husky-init`: `pass`;
    `hook-cost: recorded`;
  - every `ac48-*` key `pass`, except `ac48-commit-log-bytes`, which is an integer ≥ 400 — a value
    under 400 means the D30 backstop would block every real commit; any AC-48 failure is design Open
    Risk 16, 18 or 21 and an operator decision;
  - `context-max: 65536` — any other value changes the FR-4 / AC-10 literal and needs a product-spec
    delta first.
- Steps 2+3 land together: Step 2 adds tests that reference agent files and `agentType` values Step 3
  creates (§C "adds a test that references a symbol a later step creates"; F-05).
- Steps 4+5 land together: same trigger.
- Steps 6+7 land together: same trigger; Step 6 also rewrites existing fixtures (blocks 1, 2, 3, 7, 8,
  9) that only pass against Step 7's Gate.
- Steps 8+9 land together: same trigger.
- Steps 10+11 land together: same trigger.
- Steps 12+13+14+15 land together: Step 12's static asserts fail until all three doc edits exist
  (unit of 4, the §C cap).
- Step 5 requires Step 3: `writerRules` is interpolated into calls Step 3 gave `agentType`, and its
  constants are placed after Step 3's `CHECKER`/`WRITER`.
- Step 7 requires Step 5: `setupTask` and the Gate use `hookMsg`, `HOOK_CHECK` and "git-protocol item
  2", all written in Step 5; the preflight prompt interpolates `HOOK_CHECK`.
- Step 9 requires Step 7 only for line placement (both edit the region after `PR`); no symbol dependency.
- Step 11 requires Step 3 (`agentType: WRITER` on write-plan is already wired there).
- Step 15 requires Step 3: the context-map header note describes the two entries Step 3 adds.
- All steps are one consumer surface (`backend`: no step's **Service** is `xstockstrat-ui` or
  `xstockstrat-agent`), so every unit is surface-homogeneous (§C).

---

### Step 1 — test: PR-0 spike close — AC-48 split hook check under the absolute form, exclude, guard parity; printed status (D32); final spike record

**Status**: `pending`
**Service**: `.claude/workflows` (SDD tooling)
**Files**:
- `docs/roadmap/features/301-batch-execute-token-reduction/context.md` — modify (operator go-ahead line; spike close entry)
- Throwaway, never committed or pushed: `.claude/agents/sdd-batch-checker.md`, `.claude/agents/sdd-batch-writer.md` and `.claude/workflows/spike-301c.js` as untracked files in the main checkout. They are deleted at the end of this step; Step 3 commits the real agent files.
- Temporary main-session edits, reverted in this step: `.husky/pre-commit` (marker line) and the shared `info/exclude` (`/.sdd-logs` line).

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Spike runs already recorded at col 0 in `context.md:219-232` (run 1, `wf_51d30eaf-c83`: `composition`, `checker-pr-lookup` (path `toolsearch`), `first-turn-tokens: 28309`, `raw-sha-base`, `bash32` (D22), `husky-init` pass; `husky-linked-worktree`, `background-poll` fail; `hook-cost: not-recorded`; `context-max: 65536`), and the re-spike values as nested bullets at `context.md:274-277` (`wf_3f24944b-f87`: `husky-linked-worktree: pass` via the absolute form, `hook-cost: recorded` 18/31/29 s, `background-poll: pass` through the wrapper form).
- Spike-close run 1 (`wf_3ce0d1f3-477`, `context.md:391-415`) wrote no `- spike.` line. It found: the guard refused the one-line `HOOK_CHECK` and the grouped `.husky/_` link line, both brace groups (`context.md:397-401`, corrected at `:418`); isolated worktree creation leaves `core.hooksPath` absolute (`context.md:402`, inferred from timing); and `bash .sdd-logs/run-1.sh` under `run_in_background` printed `exit=3` (`context.md:404`). The relative-form and no-link sub-checks are dropped (D29; design Rejected Alternatives, Open Risk 1).
- Still to record, per `design.md` §1.13 "Still to record in the Step 1 close (AC-48, re-scoped by D29)": the split `HOOK_CHECK` under the absolute form, with a commit that runs `<M>/.husky/pre-commit`; the `exclude` clause; guard parity of every split command. The forms assumed allowed and confirmed here are `printenv HUSKY`, `grep -qxF -- <line> "<C>/info/exclude"`, `test -e`, `test -d` and `wc -c` (design § Assumptions "Guard parity of the split forms (D29)"). D30 adds the byte size of run A's `commit-1.log` (design Open Risk 21).
- Hook path under the absolute form: `.husky/_/h:4` `s=$(dirname "$(dirname "$0")")/$n` resolves to `<M>/.husky/pre-commit`, `:6` `[ ! -f "$s" ] && exit 0`, `:17` `sh -e "$s" "$@"`. So AC-48's marker goes in the main checkout's working copy: `.husky/pre-commit:1` is the shebang and `:6` `pnpm exec lint-staged || exit 1`, so a marker at line 2 runs before lint-staged.
- Runs A and B (D31; `context.md` § "PR-0 spike close, runs A and B (D31)"). Run A (`wf_617a0ba5-58a`) passed: `commit-1.log` was 23,058 B with the marker on line 1, and no call was refused. But the writer reported the failing `test -e .husky/_` as exit 0. Run B (`wf_b9d83e65-5be`) was invalid: it reported `hook=0` with the `/.sdd-logs` line absent. The tool displays a silent pass and fail alike, and `<cmd>; echo "rc=$?"` prints the real status (main session: `rc=1`). No `- spike.ac48-*` line was written, so both runs are repeated here under the D32 prompt (D33).
- Container state (`0f00d9f4`): `node_modules/` present in the main checkout; `git config core.hooksPath` → `/home/user/xstockstrat/.husky/_` (absolute); `.husky/` holds `_` and `pre-commit`; `.git/info/exclude` ends with `/node_modules`, `/services/*/node_modules`, `/.husky/_`, `/.sdd-logs`. The three throwaway files are present, untracked, from runs A/B; this step regenerates `spike-301c.js` from the amended §1.2/§1.3 constants and checks that the two agent files still equal §1.1.
- `spike/batch-execute-token-reduction` is still on origin at `d4c21b65` (`git ls-remote --heads origin 'spike/*'`, 2026-11-09); `git push --delete` was refused by the proxy (`context.md:235`), so the operator deletes it on GitHub.
- New agent types load only after `/reload-skills` (`context.md:213`). A spike-script variable named `phase` shadows the workflow's `phase()` (`context.md:394`).

**TDD**: `N/A (manual spike — no code is merged; the outcome is recorded evidence that gates Step 2)`

**Covers**: `AC-17, AC-20, AC-48`

**Instructions**:
1. **Operator go-ahead (P-04).** D31 approved runs A and B; D33 is the go-ahead to re-run them under the amended design, reusing D31's marker/exclude edits and restores, with no stop unless something fails. Record a decision line citing D31 and D33 in `context.md` before launching; no new question.
2. **Main-session preconditions** (the main session, never an agent): if `node_modules` is missing in the main checkout, run `pnpm install --frozen-lockfile` there; if any of the four lines is missing from `$(git rev-parse --git-common-dir)/info/exclude`, apply `EXCLUDE_REMEDY` (`design.md` §1.2). `git status --porcelain -- .husky/pre-commit` must print nothing (else stop: the marker revert would discard an operator edit). Record `git config core.hooksPath` as `<H0>`; if it is not `<M>/.husky/_`, run `git config core.hooksPath "<M>/.husky/_"` (AC-48 Given).
3. **Throwaway files.** In the main checkout, write (untracked, never `git add`ed) `.claude/agents/sdd-batch-checker.md` and `.claude/agents/sdd-batch-writer.md` with exactly the `design.md` §1.1 frontmatter and body, and `.claude/workflows/spike-301c.js` with ONE writer call `{ agentType: 'sdd-batch-writer', isolation: 'worktree', label: 'spike-writer' }` whose protocol is selected by `args.phase` (read it as `args.phase`; name no variable `phase`). Its prompt is `writerRules` items 1–3 of `design.md` §1.3 (with the literal trailer `Spike-Of: feature 301 PR-0 close (throwaway, never pushed)` in place of `${A.trailer}`), rendered by the design's own code for `MAINWT`, `RC`, `HOOK_STEPS`, `HOOK_CHECK`, `hookMsg` and the three remedies (copied from §1.2, so the agent sees the same 11 numbered hook-check lines AC-38 pins), with `devBranch = feature/batch-execute-token-reduction`, followed by the phase protocol below. The prompt states: never push (item 4 is not part of the spike prompt); for phase `absolute` only, item 2's write-set limit ("your only untracked writes") does not cover the scratch file `spike-ac48.txt`. No other rule is waived, and phase `exclude` gets no override. The agent returns one line per sub-check, every decision-bearing call (each hook-check command, the split link's `test -e`/`test -d`, the probes, the commit) with its full printed output quoted verbatim, including its `rc=` line, never a status it did not see printed, and every Bash call the guard refused with the refusal text. Every phase starts with item 2 exactly as written (each command line its own Bash call, including `ls -d "<M>"/services/*/node_modules` and the split `.husky/_` link calls).
   - **phase `absolute`:** (a) item 2's hook check → expect every hook-check call to print its own `rc=` line and pass (step 1 prints only `rc=1` while HUSKY is unset, which passes) and the result `hook=0`, with `<H>` = `<M>/.husky/_`; item 2's `test -e .husky/_; echo "rc=$?"` prints `rc=1` and `test -d "<M>/.husky/_"; echo "rc=$?"` prints `rc=0`; (a2) two read-only probes of the setupTask forms, each its own Bash call: `git diff --quiet; echo "rc=$?"` and `git merge-base --is-ancestor HEAD HEAD; echo "rc=$?"` → each prints `rc=0`; (b) write `spike-ac48.txt`, `git add -- spike-ac48.txt`, commit in the item-3 form → the commit call prints `rc=0`, `.sdd-logs/commit-1.log` contains `SPIKE-AC48-MARKER`, and the agent reports the `wc -c .sdd-logs/commit-1.log` output. If that size is under 400, item 3's backstop applies as written: record it and do not retry.
   - **phase `exclude`:** item 2's hook check → expect steps 1–10 to print their passing rc and step 11 (`grep -qxF -- /.sdd-logs "<C>/info/exclude"; echo "rc=$?"`) to print `rc=1`; result `hook-fail=exclude` and NO commit (item 2's rule).
4. `/reload-skills`, then two Workflow re-runs of `spike-301c` (D33); the main session changes the shared state before each, because an agent cannot wait for it mid-run:
   - run A `{phase:'absolute'}` after the main session inserts `echo SPIKE-AC48-MARKER` with the Edit tool as line 2 of `<M>/.husky/pre-commit` (after the shebang, before `:6` lint-staged; uncommitted, never staged). Right after the run, revert it with `git checkout -- .husky/pre-commit` and confirm `git status --porcelain -- .husky/pre-commit` prints nothing.
   - run B `{phase:'exclude'}` after the main session removes the `/.sdd-logs` line from the shared `info/exclude`; restore the line with `EXCLUDE_REMEDY` right after the run.
5. **Cleanup.** Restore `git config core.hooksPath "<H0>"`. Delete the three throwaway files, `/reload-skills`, remove the spike worktrees (`git worktree remove`) and delete the local `worktree-wf_*` and any `spike/*` branches. Ask the operator to delete `spike/batch-execute-token-reduction` on GitHub (the proxy refuses the push-delete).
6. **Record.** Append to `context.md` a `## Session <ISO> — PR-0 spike close (AC-48)` entry. Each result line starts at column 0, exactly `- spike.<key>: <value> — <evidence>` (transcript id, the quoted output line). It restates the re-spike outcomes as col-0 lines citing `wf_3f24944b-f87` — `husky-linked-worktree: pass`, `hook-cost: recorded`, `background-poll: pass` — so the LAST line per key is the outcome, and adds the AC-48 keys:
   - `ac48-absolute-check` (`pass`/`fail`) — run A (a)/(a2): every step passed and the result was `hook=0` under `<M>/.husky/_`; quote each step's `rc=` line, the split link's `rc=1`/`rc=0` and the two probes' `rc=0`;
   - `ac48-absolute-fires` (`pass`/`fail`) — run A (b): the commit printed `rc=0` and `commit-1.log` holds the marker (the main checkout's body ran);
   - `ac48-commit-log-bytes` (an integer) — run A (b): the `wc -c` count of `commit-1.log` (D30);
   - `ac48-exclude-check` (`pass`/`fail`) — run B: step 11 printed `rc=1` (quoted), the agent reported `hook-fail=exclude`, made no commit, and the line was restored;
   - `ac48-background` (`pass`/`fail`) — `bash .sdd-logs/run-1.sh` under `run_in_background` reported `exit=3`; cite `wf_3ce0d1f3-477` (`context.md:404`), already measured (design §1.13);
   - `ac48-guard` (`pass`/`fail`) — the guard refused none of run A's or run B's Bash calls, including every `; echo "rc=$?"` call (design Open Risk 18); name the forms the runs exercised.
   For `ac48-absolute-check`, `ac48-absolute-fires` and `ac48-exclude-check`, an outcome not backed by a quoted printed `rc=` line is `fail`.
   Then apply the outcome rules in `## Step Dependencies`. macOS `/bin/bash` 3.2 stays D22's accepted risk; this run is GNU bash.

**Verification**:
```bash
F=docs/roadmap/features/301-batch-execute-token-reduction/context.md
last() { grep "^- spike\.$1: " "$F" | tail -n 1 | sed -E "s/^- spike\.$1: ([^ ]+).*/\1/"; }
isint() { case "$1" in ''|*[!0-9]*) return 1;; esac; }
rc=0
for k in composition checker-pr-lookup first-turn-tokens husky-linked-worktree hook-cost background-poll raw-sha-base bash32 husky-init context-max ac48-absolute-check ac48-absolute-fires ac48-commit-log-bytes ac48-exclude-check ac48-background ac48-guard; do
  [ -n "$(last "$k")" ] || { echo "MISSING spike.$k"; rc=1; }
done
for k in composition checker-pr-lookup husky-linked-worktree background-poll raw-sha-base bash32 husky-init ac48-absolute-check ac48-absolute-fires ac48-exclude-check ac48-background ac48-guard; do
  [ "$(last "$k")" = pass ] || { echo "OUTCOME spike.$k = $(last "$k")"; rc=1; }
done
[ "$(last hook-cost)" = recorded ] || { echo "OUTCOME spike.hook-cost = $(last hook-cost)"; rc=1; }
T=$(last first-turn-tokens)
if isint "$T"; then [ "$T" -le 30000 ] || { echo "OUTCOME first-turn-tokens $T > 30000"; rc=1; }; else echo "OUTCOME first-turn-tokens not an integer"; rc=1; fi
B=$(last ac48-commit-log-bytes)
if isint "$B"; then [ "$B" -ge 400 ] || { echo "OUTCOME ac48-commit-log-bytes $B < 400 (D30 backstop would block every commit)"; rc=1; }; else echo "OUTCOME ac48-commit-log-bytes not an integer"; rc=1; fi
[ "$(last context-max)" = 65536 ] || { echo "OUTCOME context-max != 65536 (needs a product-spec change first)"; rc=1; }
git ls-remote --exit-code --heads origin 'spike/batch-execute-token-reduction' 'spike/301-target' >/dev/null; lr=$?
[ "$lr" -eq 2 ] || { echo "spike branches still on origin, or origin unreachable (ls-remote exit $lr)"; rc=1; }
[ -z "$(git status --porcelain -- .claude/agents/sdd-batch-checker.md .claude/agents/sdd-batch-writer.md .claude/workflows/spike-301c.js .husky/pre-commit)" ] || { echo "throwaway spike files or the marker edit still present"; rc=1; }
X="$(git rev-parse --git-common-dir)/info/exclude"
for L in /node_modules '/services/*/node_modules' /.husky/_ /.sdd-logs; do grep -qxF -- "$L" "$X" || { echo "info/exclude lacks $L"; rc=1; }; done
grep '^- spike\.ac48-exclude-check: ' "$F" | tail -n 1 | grep -q 'rc=1' || { echo "OUTCOME ac48-exclude-check lacks its printed rc=1 evidence"; rc=1; }
A=$(grep '^- spike\.ac48-absolute-check: ' "$F" | tail -n 1)
case "$A" in *rc=1*) case "$A" in *rc=0*) ;; *) echo "OUTCOME ac48-absolute-check lacks its printed rc=0 evidence"; rc=1;; esac;; *) echo "OUTCOME ac48-absolute-check lacks its printed rc=1 evidence"; rc=1;; esac
[ "$rc" -eq 0 ] && echo spike-record-ok
```
Expected: `spike-record-ok`. A `MISSING` line means the close entry is incomplete: finish instruction 6. An `OUTCOME` line is a failing spike result; it is not fixed inside this step but routes to `## Step Dependencies` (P-04 operator decision; AC-20 when only `composition` fails), and Step 2 does not start until that decision is in `context.md`. The `ls-remote` line stays failing until the operator deletes the origin spike branch. A `.husky/pre-commit` or `info/exclude` line means instruction 4's revert was not done.

---

### Step 2 — test: scoped agent types and their wiring; shared fixtures (AC-1, AC-2)

**Status**: `pending`
**Service**: `scripts/workflow-tests` (SDD tooling)
**Files**:
- `scripts/workflow-tests/sdd-batch-execute.test.mjs` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- The harness records full `opts` per call: `scripts/workflow-tests/harness.mjs:12` `calls.push({ label: opts.label, opts, prompt })`; replies are prefix-matched `:13`; `ROOT` export `:6`.
- Test file is one top-level script with numbered `console.log` blocks: `sdd-batch-execute.test.mjs:23-86`; fixtures `base` `:5`, `steps(done)` `:6-10`, `pre()` `:11`, `impl()` `:12`, `replies()` `:13-22` (`'setup:'` `:16`, `'integration-pr:'` `:21`); final line `:86` `console.log('ALL sdd-batch-execute tests passed')`.
- No test asserts `agentType` today (recon § Risks / Not-found): `grep -n agentType scripts/workflow-tests/sdd-batch-execute.test.mjs` → no hits.
- Today's script ignores unknown preflight fields and extra setup/PR reply fields (it reads only `p.ok`, `p.problems`, `p.openPrUrl`, `p.steps`, … at `sdd-batch-execute.js:150-157`, and `ws.commits` `:180`, `pr.url`/`pr.commits` `:247-248`), so the new fixture fields below are inert until Steps 7 and 11.
- Agent frontmatter shape: `.claude/agents/codebase-discovery.md:1-6` (`name`, `description`, `tools`, `model`).

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2`

**Instructions**:
1. **Shared fixtures** (design §1.12; used by every later test step). Add `import fs from 'node:fs'` and, after `:4`: `const MD = 'a'.repeat(40), DV = 'b'.repeat(40), SH = 'c'.repeat(40)`; `const REC = { mainDev: MD, dev: DV, specHash: SH, directive: 'conditional', pending: [1, 2, 3], mismatches: [] }`; `const CHECKER = 'sdd-batch-checker', WRITER = 'sdd-batch-writer'`; helpers `const count = (t, p) => t.calls.filter((c) => c.label.startsWith(p)).length`, `const callOf = (t, l) => t.calls.find((c) => c.label === l)`, and `const after = (s, anchor) => { const i = s.indexOf(anchor); assert.ok(i >= 0, 'anchor not found: ' + anchor); return s.slice(i) }` (count with `startsWith`, never `includes`). `pre()` (`:11`) defaults gain `mainDevSha: MD, devSha: DV, specHash: SH, contextBytes: '1000', workflowSetup: '', hookFail: ''`. `replies()`: `'setup:'` → `{ commits: ['c-setup'], notes: [], tooling_blockers: [], stale: false, completed: true }`; `'integration-pr:'` gains `notes: []`. Existing blocks 0–9 must still pass unchanged against today's script.
2. Append block `10` (before the final `ALL … passed` line) for **AC-1**: run with `checkpoints: 'report', authorizationRef: 'x'`, approvals `{'fix-a': [{gate:'checkpoint:2', decision:'proceed'}, {gate:'promotion', decision:'proceed'}]}` and `replies({ status: 'in-progress', steps: steps(2), workflowSetup: MD, promotionPlan: 'PLAN' })` (report mode + a promotion approval reach integration-pr in one run; a `checkpoint:2` approval alone halts at `checkpoint:3`). Assert `callOf(t,'preflight:fix-a').opts.agentType === CHECKER`; at least one `step:fix-a:` call exists and each has `opts.agentType === WRITER`; `callOf(t,'integration-pr:fix-a').opts.agentType === undefined`.
3. Append block `11` for **AC-2**: read `.claude/agents/sdd-batch-writer.md` and `.claude/agents/sdd-batch-checker.md` with `fs.readFileSync(path.join(ROOT, …), 'utf8')`; assert each has a line `model: opus`, contains `spawned only by .claude/workflows/sdd-batch-execute.js; never delegate from a skill session`, and its `description:` line contains `Workflow-internal` and `Never select via Task`; the checker's `tools:` line is exactly `tools: Bash, Read, Glob, Grep, ToolSearch, mcp__github__list_pull_requests`; the writer's is exactly `tools: Bash, Read, Edit, Write, Glob, Grep`.
4. Every new assertion message names its scenario. RED (before Step 3): block 10 fails on the preflight `agentType` assertion (today's call at `sdd-batch-execute.js:149` has none); name `AC-1` in that message.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
```
Expected (after Step 3): the script prints `10 …` and `11 …` lines and `ALL sdd-batch-execute tests passed`; `# fail 0`; `OK - all context-map and doc references resolve.`

---

### Step 3 — service: add sdd-batch-checker / sdd-batch-writer, wire agentType, register in context-map (FR-1)

**Status**: `pending`
**Service**: `.claude/workflows` (SDD tooling)
**Files**:
- `.claude/agents/sdd-batch-checker.md` — create
- `.claude/agents/sdd-batch-writer.md` — create
- `.claude/workflows/sdd-batch-execute.js` — modify
- `.claude/context-map.yaml` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Agent calls to wire (pre-feature `sdd-batch-execute.js`): preflight `:149` `{ phase: 'Preflight', schema: PREFLIGHT, label: \`preflight:${f.slug}\` }`; validate `:163` `{ phase: 'Gate', schema: VALIDATE, isolation: 'worktree', label: \`validate:${f.slug}\` }`; setup `:178` `{ phase: 'Gate', schema: WRITE, isolation: 'worktree', label: \`setup:${f.slug}\` }`; step `:197` `{ phase: 'Steps', schema: IMPL, isolation: 'worktree', … }`; write-plan `:240` `{ phase: 'Land', schema: WRITE, isolation: 'worktree', … }`; integration-pr `:245` (stays default).
- Existing agentType precedent: `:196` `{ agentType: 'codebase-discovery', … }`, `:238` `{ agentType: 'scenario-promoter', … }`; `agentType` composes with `isolation:'worktree'` (Step 1 `spike.composition: pass`, `context.md:219`).
- Constant placement anchor: `:29-33` `const FOLD = A.foldPolicy || 'ask'` and its guard (design §1.2 placement: constants after `FOLD`).
- context-map agents list ends with `qa-tester` at `.claude/context-map.yaml:45-48`; entry shape `name`/`path`/`returns`/`used_by`.
- `scripts/check-context-map.sh` validates every `.claude/….md` path in the map and the `(\.claude|docs)/….md` refs inside agent files, so every `.md` path named in the new agent bodies must exist.
- Agent body shape rule: `docs/patterns/context-engineering.md:40-43`; opus tier for "a verdict that gates an irreversible write" `:51`.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `.claude/agents/sdd-batch-checker.md` and `.claude/agents/sdd-batch-writer.md` with exactly the frontmatter in `design.md` §1.1 and a body that states the §1.1 body bullets as rules + method + output format (`context-engineering.md:40-43`), including the literal sentence `spawned only by .claude/workflows/sdd-batch-execute.js; never delegate from a skill session.` in both.
2. In `.claude/workflows/sdd-batch-execute.js`, after the `FOLD` guard block (`:30-33`), add `const CHECKER = 'sdd-batch-checker'` and `const WRITER = 'sdd-batch-writer'`.
3. Add `agentType: CHECKER` to the preflight (`:149`) and validate (`:163`) option objects, and `agentType: WRITER` to setup (`:178`), step (`:197`) and write-plan (`:240`). Leave discover (`:196`), promotion-plan (`:238`) and integration-pr (`:245`) unchanged.
4. Append to `.claude/context-map.yaml` `agents:` after the `qa-tester` entry (`:45-48`) the two entries of `design.md` §1.11 (`sdd-batch-checker` and `sdd-batch-writer`, each `used_by: [sdd-batch-execute]`). Leave the `:15` header for Step 15.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
grep -cE "agentType: CHECKER" .claude/workflows/sdd-batch-execute.js; grep -cE "agentType: WRITER" .claude/workflows/sdd-batch-execute.js
```
Expected: tests green as in Step 2; the two counts print `2` and `3`.

---

### Step 4 — test: writer-rules contract — links (split `.husky/_` link), .sdd-logs/, no Node install, read-only re-check, Write-tool commits, hook-ran backstop (AC-26, AC-39)

**Status**: `pending`
**Service**: `scripts/workflow-tests` (SDD tooling)
**Files**:
- `scripts/workflow-tests/sdd-batch-execute.test.mjs` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Existing writer-rule assertions loop over `setup|step|write-plan|integration-pr` prompts: `sdd-batch-execute.test.mjs:43-46` (`'Push after EACH artifact edit'`, `'no commit before verification'`) — these must keep passing (design §1.3: items 4–6 verbatim).
- All four writer prompts start with `${WR}` (`sdd-batch-execute.js:178,197,240,245`), so each renders `writerRules`.
- Today's writerRules item 2 is the bare `node_modules` symlink sentence (`:126`); item 3 the trailer (`:127-128`). `grep -nE "sdd-logs|hook-fail|info/exclude|services/\*/node_modules" .claude/workflows/sdd-batch-execute.js` → no hits; `grep -nE 'test -e \.husky|wc -c|400 bytes' .claude/workflows/sdd-batch-execute.js` → no hits (2026-11-09).
- AC-26 as amended by D29–D30 and D32 (`acceptance.feature:228-241`): the split link literals come from `design.md` §1.3 item 2 (`test -e .husky/_`, then `test -d "<M>/.husky/_"`, then `ln -s "<M>/.husky/_" .husky/_`, each its own call), and the backstop literals from item 3 (`wc -c .sdd-logs/commit-<N>.log`, "a log under 400 bytes ran no hook"); the brace-group line `[ -e .husky/_ ] || { … }` is gone because the guard refuses brace groups (`context.md:397-401,418`).
- D32/D34 (`design.md` §1.3 items 2–3, `RC`): every decision-bearing command in writerRules ends with `; echo "rc=$?"`, namely `test -e .husky/_`, `test -d "<M>/.husky/_"`, the lockfile and dirty-tree `git diff --quiet` (no `!`), the commit and the amend. The backstop reads "printed rc=0 with a log under 400 bytes ran no hook". `grep -nE 'the tool reports its exit code|! git diff|exits non-zero' .claude/workflows/sdd-batch-execute.js` → no hits (2026-11-09).
- Fixtures that reach each writer against both today's and Step 7's Gate: setup via `{gate:'upfront', decision:'proceed', record: REC}` (today `proceeds('upfront')` `:165`; after Step 7, the matching record); step via block 3's `checkpoint:2` proceed with `status: 'in-progress', steps: steps(2), workflowSetup: MD` (today `resuming = !!ap` `:160`; after Step 7, `setupDone && !!ap`); write-plan via block 4's fixture (`:55`); integration-pr via block 5's (`:60`).

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-26, AC-39`

**Instructions**:
1. Declare once, at the top level of the test file after the shared fixtures, `const RC_SFX = '; echo "rc=$?"'` (the one spelling of the D32 suffix in the tests, C-18). Build every suffixed literal in blocks 12, 13 and Step 6 as `<cmd> + RC_SFX`. Then append block `12` for **AC-26**: run `{gate:'checkpoint:2', decision:'proceed'}` with `replies({ status: 'in-progress', steps: steps(2), workflowSetup: MD })` and take `p = callOf(t,'step:fix-a:s3').prompt`. Assert it contains each of `services/*/node_modules`, `.husky/_`, `core.hooksPath`, `pre-commit hook inert`, `hook-fail=`, `provision pnpm 9.15.9`, `from the main session (never a workflow agent)`, `info/exclude`, `hook-fail=exclude`, `commit precondition unmet`, `/services/*/node_modules`, `/.husky/_`, `/.sdd-logs`, `mkdir -p .sdd-logs`, `'git diff --quiet' + RC_SFX`, `never write a file under <M> yourself`, `git's own object/ref writes`, `never install, repair or append anything`, `Never run pnpm install`, `main-checkout node_modules lacks <pkg>`, `outside /sdd-batch-execute`, `uv sync --extra dev`, `Never edit pnpm-lock.yaml by hand`, `only this branch adds`, `'git diff --quiet origin/main-dev -- pnpm-lock.yaml' + RC_SFX`, `'test -e .husky/_' + RC_SFX`, `'test -d "<M>/.husky/_"' + RC_SFX`, `'ln -s "<M>/.husky/_" .husky/_'`, `wc -c .sdd-logs/commit-<N>.log`, `printed rc=0 with a log under 400 bytes ran no hook`, `'git commit -F .sdd-logs/msg-<N>.txt > .sdd-logs/commit-<N>.log 2>&1' + RC_SFX`, `'git commit --amend --no-edit > .sdd-logs/commit-<N>.log 2>&1' + RC_SFX`; and contains none of `pnpm exec husky`, `sdd-husky.lock`, `re-send the resume approval`, `<G>`, `printf '%s`, `'[ -e .husky/_ ] ||'`, `the tool reports its exit code`, `! git diff`, `exits non-zero`.
2. Append block `13` for **AC-39**: collect four prompts — `setup:fix-a` (run with `{gate:'upfront', decision:'proceed', record: REC}` and default `replies()`), `step:fix-a:s3` (block 12's run), `write-plan:fix-a` (block 4's fixture) and `integration-pr:fix-a` (block 5's fixture). For each assert it contains `with the Write tool to .sdd-logs/msg-<N>.txt`, `git commit -F .sdd-logs/msg-<N>.txt > .sdd-logs/commit-<N>.log 2>&1`, `tail -n 20 .sdd-logs/commit-<N>.log`, `git commit --amend --no-edit > .sdd-logs/commit-<N>.log 2>&1`, `timeout 600000` and `Never use --no-verify`, and contains neither `SDD_MSG_EOF` nor `git rev-parse --git-dir`. Name the prompt label in each message.
3. Write any JS string containing a shell `${` in single quotes (IR-4); since D29 none of the block-12/13 literals has one. Literals that contain double quotes (the split-link strings and `RC_SFX`) are single-quoted JS strings, as shown; `$?` is neither `${` nor `$(`.
4. RED (before Step 5): block 12 fails on `services/*/node_modules`; name `AC-26` in the message.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
```
Expected (after Step 5): `12 …`, `13 …` and `ALL sdd-batch-execute tests passed`; `# fail 0`; context-map OK.

---

### Step 5 — service: RC, HOOK_STEPS/HOOK_CHECK, remedy constants, hookMsg and the writerRules rewrite (FR-5 writer rules, D15, D23–D34)

**Status**: `pending`
**Service**: `.claude/workflows` (SDD tooling)
**Files**:
- `.claude/workflows/sdd-batch-execute.js` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- `function writerRules(f, p)` spans `sdd-batch-execute.js:123-133`; item 5 text `:130` ("Push after EACH artifact edit: … (SKILL.md HARD CONSTRAINT: no commit before verification).") is kept verbatim; items 4 and 6 and the closing paraphrase `:129,131-132` likewise (design §1.3).
- Existing escaped-backtick convention inside the template: `:125` `` \`git fetch origin\` `` (IR-1).
- `.gitignore:23` `**/node_modules/` matches directories only (`fails.md` 2026-11-06 entry, "batch-execute-token-reduction — assumption"), so the links rely on the root-anchored `info/exclude` lines that `HOOK_CHECK`'s `exclude` clause verifies.
- The measured commit form `git commit -F .sdd-logs/msg-N.txt > .sdd-logs/commit-N.log 2>&1` and the worktree-local `.sdd-logs/` (recon § Amendment recon, "Patterns to REUSE"); hook cost 18–31 s per commit, hence `timeout 600000`.
- The writer must never run a Node package install (D26): `tooling-setup.md:30,43` prescribes `pnpm install --frozen-lockfile` for Node steps, which item 2 overrides; `uv sync --extra dev` (`tooling-setup.md:29`) stays.
- `ENV_REMEDY`'s pnpm pin matches root `CLAUDE.md` § Language Versions (`pnpm 9.15.9`).
- Guard (D29): an isolated agent's Bash call holding a `{ …; }` brace group is refused as "too complex to verify"; in `wf_3ce0d1f3-477` the only refused calls were the one-line `HOOK_CHECK` and the grouped `.husky/_` link line (`context.md:397-401`; recon § "Amendment recon 2", correction; `context.md:418`). Hence `HOOK_STEPS` (11 plain single commands, first failure names its clause in the old order HUSKY, pnpm, hooksPath, h, pre-commit, exclude, so `hookMsg`/`hookBlocked` keep the six clause names) and the three-call link (`design.md` §1.2, §1.3 item 2).
- Hook-ran backstop (D30, `product-spec.md:111`): the hook always prints — `.husky/pre-commit:6` runs lint-staged and `:18` the report-only `check-duplication.sh … || true` — measured at 23,058–32,432 B per commit (`context.md:268-272`; spike run A), so a commit log under 400 B after the commit prints `rc=0` means no hook ran (`design.md` §1.3 item 3; Open Risk 21).
- Printed status (D32/D34; `context.md` § "PR-0 spike close, runs A and B (D31)"): the Bash tool displays a silent pass and a silent fail identically, so `RC = '; echo "rc=$?"'` (`design.md` §1.2) is appended by the `HOOK_CHECK` renderer and interpolated at every writerRules decision site (§1.3 items 2–3).

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. After the `CHECKER`/`WRITER` constants from Step 3, add `MAINWT`, `RC`, `HOOK_STEPS`, `HOOK_CHECK`, `ENV_REMEDY`, `HOOK_REMEDY`, `EXCLUDE_REMEDY` and `hookMsg` exactly as in `design.md` §1.2, in that order. `MAINWT`, `RC`, the three remedies and every field of every `HOOK_STEPS` entry are **plain single-quoted strings**; `HOOK_CHECK` is the one template literal, rendered from `HOOK_STEPS` (IR-1, D29). No hook string contains a shell `${`. Keep the design's one-line constraint comments (≤2 lines each, CLAUDE.md How to Act #5). `hookBlocked` is added in Step 7, where its first caller lands.
2. Replace `function writerRules` (`:123-133`) with `design.md` §1.3 verbatim, substituting the placeholder `<unchanged :130 text, …>` with today's `:130` item-5 sentence unchanged. Escape every literal backtick as `` \` `` and write no shell `${` inside the template (IR-1); the three `${hookMsg(…)}` lines and `${MAINWT}`/`${HOOK_CHECK}`/`${RC}`/`${A.trailer}` are the only interpolations besides `${f.slug}`, `${p.*}`, `${A.date}`.
3. Do not touch any agent call, the Gate or the step loop in this step.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
grep -cE "^const (MAINWT|RC|ENV_REMEDY|HOOK_REMEDY|EXCLUDE_REMEDY) = '" .claude/workflows/sdd-batch-execute.js
grep -cE '^const HOOK_STEPS = \[|^const HOOK_CHECK = `' .claude/workflows/sdd-batch-execute.js
node -e "const s=require('fs').readFileSync('.claude/workflows/sdd-batch-execute.js','utf8');const a=s.indexOf('const HOOK_STEPS = ['),b=s.indexOf(']',a);console.log((s.slice(a,b).match(/\{ clause: '/g)||[]).length)"
! grep -nE 'SDD_MSG_EOF|git rev-parse --git-dir|pnpm exec husky|grep -qsxF|\$\{H%/_\}|\$\{HUSKY-\}|case "\$H"|\[ -e \.husky/_ \] \|\||passWhen: .exit 0|the tool reports its exit code|! git diff' .claude/workflows/sdd-batch-execute.js && echo no-retired-forms
```
Expected: tests green; the counts print `5`, `2` and `11`; `no-retired-forms` (no heredoc/git-dir log, no husky repair, none of the retired one-line `HOOK_CHECK` or grouped-link forms, and no exit-status read from the tool's display, D32). The `.` in `passWhen: .exit 0` stands for the quote, so the ERE stays inside one single-quoted shell word.

---

### Step 6 — test: Gate, preflight and setup — record, distill, resume, hook precondition, setup contract (FR-2..FR-5)

**Status**: `pending`
**Service**: `scripts/workflow-tests` (SDD tooling)
**Files**:
- `scripts/workflow-tests/sdd-batch-execute.test.mjs` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Existing blocks whose fixtures change (design §1.12 "Fallout"): block 1 `sdd-batch-execute.test.mjs:31-36`, block 2 `:37-47`, block 3 `:48-53`, block 7 `:69-74` (7(a) `:70`, 7(b) `:72`), block 8 `:75-81` (8(b) `:78`), block 9 `:82-85`.
- Today's upfront halt has no `record` (`sdd-batch-execute.js:166-174`), and `resuming = !!ap` (`:160`) skips the Gate for any checkpoint/blocker approval, so block 1's new `record` assertion and AC-7/AC-8 fail first.
- Block 7(b) (`:72`) resumes `blocker:1` on `status: 'in-progress'` with no fence; under Step 7's Gate that is not `setupDone`, so it needs `workflowSetup: MD` to keep reaching `step:fix-a:s1`.
- No test asserts `validate:` count > 0, `setup:` count > 0, or `isolation` (recon § Risks / Not-found).
- Step 2's fixtures (`MD`, `DV`, `SH`, `REC`, `count`, `callOf`, `after`, the `pre()` defaults including `hookFail: ''`) are reused as-is.

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-18, AC-21, AC-22, AC-24, AC-25, AC-28, AC-29, AC-30, AC-31, AC-34, AC-35, AC-37, AC-38, AC-40, AC-41, AC-46, AC-47`

**Instructions**:
1. **Fallout in existing blocks** (design §1.12): block 1 also asserts `assert.deepEqual(r.halted.record, REC)`; blocks 2, 7(a) and 8(b) send `{gate:'upfront', decision:'proceed', record: REC}` and assert `count(t,'validate:') === 0`; blocks 3, 7(b) and 9 use `status: 'in-progress', workflowSetup: MD`.

**Part A: Gate behaviour** (instructions 1–2; AC-3..AC-12, AC-21, AC-22, AC-24, AC-28..AC-31, AC-35, AC-37, AC-40, AC-46, AC-47). Write and run Part A first; its RED is instruction 4.

2. **Behavioural blocks** (one numbered block per scenario; assertion messages name the `AC-N`; literals from `acceptance.feature`; "REC approval" = `{gate:'upfront', decision:'proceed', record: REC}`):
   - AC-3: no approvals, `'validate:'` → `{mismatches:[{n:2,detail:'D'}], tooling_blockers:[]}`; `count validate: === 1`; `halted.gate === 'upfront'`; `halted.record` deep-equals `{...REC, mismatches:[{n:2,detail:'D'}]}`; 0 `setup:`/`step:`/`write-plan:` calls.
   - AC-4: approval with `record: {...REC, mismatches:[{n:2,detail:'D'}]}` → 0 validate; exactly 1 setup whose prompt contains `[{"n":2,"detail":"D"}]`.
   - AC-5: record with `mainDev: 'd'.repeat(40)` → 1 validate; upfront halt whose `record.mainDev === MD`; 0 setup.
   - AC-6: `{gate:'upfront', decision:'proceed'}` with no record → 1 validate; upfront halt with a `record`; 0 setup.
   - AC-7: `{gate:'blocker:1', decision:'Option A'}`, status implementation-ready, `workflowSetup: ''` → 1 validate; upfront halt; 0 step.
   - AC-8: `status: 'in-progress', workflowSetup: ''`, no approvals → 1 validate; gate `upfront` (not `resume`).
   - AC-9: `status: 'in-progress', workflowSetup: MD`, no approvals → gate `resume`, 0 validate/setup; same with `{gate:'resume', decision:'proceed'}` → 0 validate/setup, ≥1 `step:fix-a`.
   - AC-10: `contextBytes: '70000'` → gate `distill`, `halted.limit === 65536`, 0 validate; with `{gate:'distill', decision:'proceed'}` → gate `upfront`.
   - AC-11: REC approval; setup → `{commits:[], notes:['resolver exit 64'], tooling_blockers:[], stale:false, completed:false}` → `blocked` matches `/setup incomplete/`; 0 step.
   - AC-12: setup → `{commits:[], notes:[], tooling_blockers:[], stale:true, completed:false}` → `blocked` matches `/start a NEW run/`; 0 step.
   - AC-21: `contextBytes: 'unknown'` → `blocked` matches `/context.md size unreadable/`; `halted === null`; 0 validate.
   - AC-22: `status: 'in-progress', workflowSetup: MD, steps: steps(2)`, `{gate:'checkpoint:2', decision:'proceed'}` → 0 validate/setup; the first `step:` call's label is `step:fix-a:s3`.
   - AC-24: setup → `{commits:[], notes:[], tooling_blockers:['pre-commit hook inert: hook-fail=hooksPath'], stale:false, completed:false}` → `blocked` matches `/tooling: pre-commit hook inert/`; 0 step.
   - AC-28: setup notes `['unresolvable: docs/x.md: off-allowlist — merge origin/main-dev into feature/fix-a by hand resolving docs/x.md, push, start a NEW run']`, `completed:false` → `blocked` matches `/unresolvable/`; `halted === null`; 0 step.
   - AC-29: approval record with `mismatches:[{n:2,detail:'D'}]`, setup `completed:true` → gate `resume`; 0 step.
   - AC-30: `features: [{ slug: 'fix-a', directive: 'none' }]`, approval `record: {...REC, directive:'none', mismatches:[{n:2,detail:'D'}]}` → `blocked` matches `/directive none: steps 2 mismatch/`; 0 setup.
   - AC-31: `mainDevSha: 'origin/main-dev'` → `blocked` matches `/non-hex sha/`; 0 validate.
   - AC-35: `status: 'in-progress', workflowSetup: MD, hookFail: 'hooksPath'`, `{gate:'resume', decision:'proceed'}` → `blocked` matches `/pre-commit hook inert in the main checkout \(hook-fail=hooksPath\)/` and contains `pnpm install --frozen-lockfile` and `from the main session`; 0 `validate:`, `setup:`, `discover:`, `step:`, `write-plan:`, `integration-pr:` calls.
   - AC-37, seven runs, each with `hookFail` as stated: (a) no approvals, `hookFail: 'hooksPath'` → 1 validate, gate `upfront`, `blocked === null`, some `halted.tooling_blockers` entry contains `hook-fail=hooksPath`; (b) `contextBytes: '70000'`, `hookFail: 'hooksPath'` → gate `distill`, not blocked, `halted.hook` contains `hook-fail=hooksPath`; (c) `status: 'in-progress', workflowSetup: MD`, no approvals, `hookFail: 'hooksPath'` → gate `resume`, not blocked, `halted.hook` contains `hook-fail=hooksPath`; (d) as (c) with `{gate:'resume', decision:'proceed'}` and `hookFail: ''` → not blocked, ≥1 `step:fix-a`; (e) `status: 'in-progress', workflowSetup: MD, steps: steps(2)`, `{gate:'checkpoint:2', decision:'stop here'}`, `hookFail: 'hooksPath'` → `stage === 'stopped'`, not blocked; (f) `status: 'code-completed', steps: steps(3), mergeOrderBlock: '230 first', hookFail: 'hooksPath'`, no approvals → gate `merge-order`, not blocked, `halted.hook` contains `hook-fail=hooksPath`; (g) `status: 'code-completed', steps: steps(3), mergeOrderBlock: '', hookFail: 'h'` → `blocked` matches `/\(hook-fail=h\)/`; 0 `promotion-plan:`/`write-plan:`.
   - AC-40: approval `record: {...REC, pending:[3,1,2]}` → 0 validate, 1 setup; and a fresh run whose preflight `steps` are `steps(0)` re-ordered as `[s3, s1, s2]` halts with `record.pending` deep-equal `[1,2,3]`.
   - AC-46: approval `record` = `REC` without its `mismatches` key → 1 validate; gate `upfront`; 0 setup.
   - AC-47: REC approval with `hookFail: 'pnpm'` → `blocked` matches `/pre-commit hook inert in the main checkout \(hook-fail=pnpm\)/` and contains `provision pnpm 9.15.9`; 0 validate/setup/step. `hookFail: 'HUSKY'` → `blocked` contains `unset HUSKY`. `hookFail: 'exclude'` → `blocked` matches `/commit precondition unmet in the main checkout \(hook-fail=exclude\)/` and contains `/.sdd-logs` and `never a workflow agent`. `hookFail: ' hook-fail=pnpm '` → `blocked` contains `(hook-fail=pnpm)` and not `hook-fail=hook-fail`.

**Part B: prompt contracts** (instruction 3; AC-13, AC-18, AC-25, AC-34, AC-38, AC-41). Write it after Part A. Its RED is AC-13: today's setup prompt has no `merge-train-resolve.mjs`.

3. **Prompt-contract blocks** (render with the REC approval unless noted; write any string containing a shell `${` or `$(` in single quotes, IR-4 — since D29 these are AC-38's negative checks; `after()` asserts its anchor exists):
   - AC-13: setup prompt contains `'merge-train-resolve.mjs --base ' + MD`, `ledger-guard.py`, `--amend`, `Approved-record:`, `git log --first-parent`, `origin/main-dev..HEAD`; in `a = after(p, 'Operator approved the up-front plan')`, `a.indexOf('status.md') < a.indexOf('sdd-batch-setup')`. D32/D34: it also contains `'HEAD' + RC_SFX`, `'--own-slug fix-a' + RC_SFX` and `- rc=2:`, and contains neither `the tool reports its exit code` nor `! git diff`.
   - AC-18: split `after(p, 'Operator approved the up-front plan')` into column-0 numbered items (`/^(\d+)\. /m`); items 2, 3, 4 and 6 each contain `Skip if`; items 2, 3, 4, 5 and 6 each contain `push`; the prompt contains `completed`.
   - AC-25: setup prompt contains `core.hooksPath`, `git worktree list --porcelain`, `pre-commit hook inert`, `tooling_blockers`; in `a = after(p, '1. Tooling (no commit)')`, `a.indexOf('tooling_blockers') < a.indexOf('merge-train-resolve.mjs')`; the prompt contains neither `pnpm exec husky` nor `sdd-husky.lock`.
   - AC-34: preflight prompt contains `mcp__github__list_pull_requests`, `ToolSearch`, `retry once`, `PR lookup unavailable`, `git cat-file -s`, `docs/roadmap/features/`.
   - AC-38 (amended by D29 and D32/D34, `acceptance.feature` @AC-38): from one REC-approval run, render `setup:fix-a`, `preflight:fix-a` and `step:fix-a:s1`. All three contain `'printenv HUSKY' + RC_SFX + ' — pass:'`, `Else hook-fail=HUSKY.`, `'command -v pnpm' + RC_SFX + ' — pass: rc=0. Else hook-fail=pnpm.'`, `'git config core.hooksPath' + RC_SFX + ' — pass:'`, `Else hook-fail=hooksPath.`, `'test -f "<H>/pre-commit"' + RC_SFX + ' — pass: rc=0. Else hook-fail=h.'`, `'test -f "<H>/h"' + RC_SFX + ' — pass: rc=0. Else hook-fail=h.'`, `'test -f "<B>/pre-commit"' + RC_SFX`, `Else hook-fail=pre-commit.`, `'git rev-parse --git-common-dir' + RC_SFX`, `'grep -qxF -- /.sdd-logs "<C>/info/exclude"' + RC_SFX + ' — pass: rc=0. Else hook-fail=exclude.'`, `A refused call ends the check with hook-fail=unknown` and `never the tool's display`. With `const hl = (s) => s.split('\n').filter((l) => /^   \d+\) /.test(l))`: each prompt has `hl(p).length === 11`, and the three arrays are `deepEqual`. For every such line, the command `c = l.slice(l.indexOf(') ') + 2, l.indexOf(' — pass:'))` satisfies `c.endsWith(RC_SFX) && c.indexOf(RC_SFX) === c.length - RC_SFX.length` (exactly one trailing suffix), and `c.slice(0, -RC_SFX.length)` contains none of `'$('`, `` '`' ``, `'case '`, `'${'`, `'{ '`, `';'`, `'&&'`, `'||'`, `' | '`, `' > '`, `'>>'`; no `hl()` line contains `exit 0`. None of the three prompts contains `'"$M'`, `'cd "<M>'`, `'git -C "<M>'`, `'echo "hook=$?"'`, `'${H%/_}'`, `'case "$H"'`, `sdd-husky.lock` or `pnpm exec husky`; the preflight prompt contains `hookFail` and `no cd, no git -C`. (The rendered lines come from `design.md` §1.2 `HOOK_CHECK`: `   ${i + 1}) ${s.cmd}${RC} — pass: ${s.passWhen}. Else hook-fail=${s.clause}.`; no other line of the three prompts starts with three spaces, a number and `) `.)
   - AC-41: in `a = after(setupPrompt, 'ledger-guard.py')`: contains `git add -- docs/roadmap/ledger/`; `a.indexOf('git diff --quiet') < a.indexOf('--amend')`; contains `'git diff --cached --quiet' + RC_SFX`, `nothing to amend`, `'--fix' + RC_SFX`, `- rc=0:` and `- any other rc:` (D32/D34).
4. RED (before Step 7): Part A fails first on block 1's `halted.record` (today's halt `:166-174` has none); name `AC-3` in the first new assertion so the RED cites it. Part B fails on AC-13. Report both REDs.

**Why one step, not two.** Parts A and B change the same test file. Both go green only against Step 7's Gate, and Step 7 cannot be split: the Gate calls `setupTask` and renders `hookErr` from `hookBlocked`. Two test steps would still land in one commit as a 3-member unit, so the A/B split gives the same review granularity with one fewer landing member.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
```
Expected (after Step 7): every block prints its line and `ALL sdd-batch-execute tests passed`; `# fail 0`; context-map OK.

---

### Step 7 — service: schemas, preflight, Gate block, hookBlocked, setupTask, merge-order hook field (FR-2..FR-5)

**Status**: `pending`
**Service**: `.claude/workflows` (SDD tooling)
**Files**:
- `.claude/workflows/sdd-batch-execute.js` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Schemas: `PREFLIGHT` `sdd-batch-execute.js:47-63` (required list `:62`), `WRITE` `:72-76`; `toUnits` starts `:106`.
- Preflight prompt `:141-149` (items 1–7 `:142-148`; PR lookup via ToolSearch `:147`; promotion-plan fence `:148`); preflight sets no `isolation`, so it runs in the main checkout (recon § Amendment recon "Patterns to REUSE").
- Open-PR short-circuit `:150-153` is kept; `WR`/`ctx` `:154-155` kept; Gate region to replace `:156-181` (`let pending` `:156`, `blockedStep` `:157`, `const resuming = !!ap` `:160`, validate `:163` with `-X ours` (kept, product-spec Out of Scope), upfront halt `:165-176`, tooling block `:177`, setup `:178-180`).
- `approvals()`/`proceeds()`/`ap`: `:119-121`, `:138`, `:139` (reused as-is).
- Step-loop `stop here` line to delete: `:191` `if (aps.some((x) => x.decision === 'stop here')) { out.stage = 'stopped'; return out }`; `:188-190` and `:198` stay (D19).
- Merge-order halt in Land `:234` `out.halted = { gate: 'merge-order', reason: p.mergeOrderBlock, question: … }` gains `hook: hookErr` (design §1.5 "Halt symmetry"; AC-37(f)).
- Fence pattern reused for `sdd-batch-setup`: promotion-plan fence written `:240`, read `:148`, schema `:60` (recon § Patterns to REUSE).
- Resolver protocol mirrored by `setupTask` item 2: `merge-train.js:107-111` (`--no-commit` merge, resolver, abort on exit 2, abort on hook failure); resolver usage and exits `scripts/merge-train-resolve.mjs:4,145,148`; ledger-guard `--fix` precondition `scripts/ledger-guard.py:55-58`; both accept a raw-sha `--base` (`spike.raw-sha-base: pass`, `context.md:225`).
- PR lookup retry precedent "re-read once after ~10 s": `merge-train.js:98`.
- `CONTEXT_MAX` = `65536` (`spike.context-max`, `context.md:232`).

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Constants** (design §1.2 placement): `HEX` and `const CONTEXT_MAX = 65536` immediately before Step 3's `CHECKER`; `canon` immediately after `WRITER`; `hookBlocked` immediately after Step 5's `hookMsg`. All exactly as `design.md` §1.2.
2. **Schemas** (design §1.2): add `mainDevSha`, `devSha`, `specHash`, `contextBytes`, `workflowSetup` and `hookFail` (each `{type:'string'}`) to `PREFLIGHT.properties` and to its `required` array (`:62`); add `SETUP` immediately after `WRITE` (`:76`). No `HOOKSETUP` (retired, D23).
3. **setupTask** (`design.md` §1.6) as a new function directly after `writerRules`. Keep the fence's three lines at column 0 in the source.
4. **Preflight prompt**: replace the `:141-149` prompt text with `design.md` §1.4 (13 items), keeping `agentType: CHECKER` from Step 3 and adding no `isolation`.
5. **Gate**: replace `:156-181` with `design.md` §1.5 verbatim (from `let pending` through the closing `}` of `if (pending.length && !resuming)`), with `agentType: CHECKER` on validate and `agentType: WRITER`, `schema: SETUP` on setup. Delete the old `const resuming = !!ap` (`:160`); `ap` itself (`:139`) stays.
6. **Step loop**: delete `:191` (the `stop here` return now lives in the Gate block). Leave `:188-190`, the `:197` prompt and `:198` unchanged.
7. **Land**: in the `:234` merge-order halt, insert `hook: hookErr` after `reason: p.mergeOrderBlock`.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
grep -cE "decision *=== *'stop here'" .claude/workflows/sdd-batch-execute.js
! grep -nE "hook-setup|HOOKSETUP|TOOLING_HOOK|hookLive|sdd-husky" .claude/workflows/sdd-batch-execute.js && echo no-retired-stages
! grep -nE 'the tool reports its exit code|! git diff' .claude/workflows/sdd-batch-execute.js && echo no-tool-status
```
Expected: the test suite is the gate. It must be green, including AC-37(e) (a `stop here` returns `stopped` with a failing hook) and block 9. The `grep -c` is a cheap secondary check and should print `1` (the Gate's `const stopping`, with the step-loop line gone); `no-retired-stages`; `no-tool-status` (setupTask's merge-base, resolver, ledger-guard and `git diff` checks read their printed `rc=`, D32/D34).

---

### Step 8 — test: step prompt — scoped reads, .sdd-logs/ verification protocol, wiring gate (AC-14, AC-15, AC-23, AC-32, AC-33, AC-42)

**Status**: `pending`
**Service**: `scripts/workflow-tests` (SDD tooling)
**Files**:
- `scripts/workflow-tests/sdd-batch-execute.test.mjs` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Today's step prompt reads "SKILL.md §PER-STEP EXECUTION, reference/sequential-mode.md (§5.5, verification fallbacks), reference/tdd-gate.md and reference/tooling-setup.md" (`sdd-batch-execute.js:197`) — no `## PER-STEP EXECUTION`, `## HARD CONSTRAINTS`, `## Deviation Log`, `context.md IN FULL`, `.sdd-logs/v-<K>.log` or `exit=PENDING` text, so the new assertions fail first.
- Discover prompt `:196` carries no `Tree:` stamp (`.claude/agents/codebase-discovery.md:23-25` then writes `Checkout: UNSTAMPED`).
- Wiring-gate text the VERIFY clause mirrors: `.claude/skills/sdd-execute/SKILL.md:310-317` and `:323-325` (`--final`); red-N/A wording `.claude/skills/sdd-execute/reference/tdd-gate.md:56`.
- Step 4's block-12 fixture reaches `step:fix-a:s3` and `discover:fix-a:s3` against both today's and Step 7's Gate.
- D29 leaves VERIFY and these scenarios unchanged: the forms AC-15/AC-42 pin are guard-accepted as measured — `bash .sdd-logs/run-1.sh` under `run_in_background` and the poll `for i in $(seq 1 108); do …; done; cat … || echo "exit=PENDING"` were allowed in `wf_3ce0d1f3-477` (`context.md:404,425`; recon § "Amendment recon 2", correction; `design.md` §1.0 IR-2). The guard refuses only brace groups, and VERIFY has none.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: `AC-14, AC-15, AC-23, AC-32, AC-33, AC-42`

**Instructions**:
1. Reuse the block-12 fixture (in-progress, `workflowSetup: MD`, `checkpoint:2` proceed, `steps(2)`) and take `sp = callOf(t,'step:fix-a:s3').prompt` and `dp = callOf(t,'discover:fix-a:s3').prompt`. One block per scenario:
   - AC-14: `sp` contains `## PER-STEP EXECUTION`, `## HARD CONSTRAINTS`, `## Deviation Log`, `sequential-mode.md`, `§5.5`, `tooling-setup.md`, `repo-conventions.md`, `context.md IN FULL`.
   - AC-15: `sp` contains `) >.sdd-logs/v-<K>.log 2>&1`, `'echo "exit=$?" >.sdd-logs/v-<K>.exit'`, `tail -n 60`, ``no `set -o pipefail` ``, ``no `exit=` line``, `FAILED`, `Read the FULL log`, `red N/A — no behavior change; characterization test added`.
   - AC-23: `sp` contains `NEW log`, `the RED run, the GREEN run and every re-run`, `.sdd-logs/run-<K>.sh`, `.sdd-logs/v-<K>.log`, `never reuse a K`, `Cite ONLY lines from this run's log`; and contains neither `mktemp` nor `git rev-parse --git-dir`.
   - AC-32: `sp` contains `the discovery digest is advisory`, `re-verify every not-found claim`, `A confirmed miss is a blocker (F-04)`, `Wherever the loaded skill text says AskUserQuestion, return result:'blocker'`, `§5.7`, `carve-outs`; `dp` does not contain `Tree:`.
   - AC-33: `sp` contains `check-config-wiring.mjs`, `--final`, `keeps the step not-done`.
   - AC-42: `sp` contains `with the Write tool .sdd-logs/run-<K>.sh`, `run_in_background`, `.sdd-logs/v-<K>.exit`, `exit=PENDING`, `540`, `lives only until this worktree is removed`.
2. RED (before Step 9): the AC-14 block fails on `## PER-STEP EXECUTION`; name `AC-14` in the message.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
```
Expected (after Step 9): all blocks pass; `# fail 0`; context-map OK.

---

### Step 9 — service: READ_SCOPE, VERIFY and the step prompt (FR-6, FR-7)

**Status**: `pending`
**Service**: `.claude/workflows` (SDD tooling)
**Files**:
- `.claude/workflows/sdd-batch-execute.js` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Step call `sdd-batch-execute.js:197`; its FOLD POLICY text (`${FOLD === 'adjacent' ? '…' : '…'}`) and the `${operatorNote ? … : ''}` tail are kept verbatim (design §1.7, D19).
- Heading anchors READ_SCOPE names (re-confirmed by `grep -n "^## \|^### "` at `23f866b`): `SKILL.md:233` `## PER-STEP EXECUTION — 3 mandatory phases`, `:291` `### PHASE 3: Execution`, `:404` `## DEVIATION HANDLING`, `:421` `## CONTEXT.MD — Per-step entry format`, `:476` `## HARD CONSTRAINTS — Never violate`; `sequential-mode.md:81` `### 5.5`, `:162` `### 5.7`, `:186` `## Sequential-mode carve-outs`, `:207` `## Sequential-mode verification fallbacks`; spec step heading `### Step N —` (`.claude/skills/sdd-spec/reference/spec-template.md:28`).
- AskUserQuestion sites the READ_SCOPE sentence covers: `sequential-mode.md:165`, `tooling-setup.md:74`, `atomic-units.md:37`, `deviation-handling.md:57` (grep).
- The background wrapper form (`run_in_background` + a `.exit` sentinel written by a script under `.sdd-logs/`) is measured (`spike.background-poll: pass`, `context.md:277`), and the exact `bash .sdd-logs/run-1.sh` start and `$(seq 1 108)` poll of `design.md` §1.2 VERIFY were allowed by the guard in `wf_3ce0d1f3-477` (`context.md:404,425`). D29 therefore changes neither `VERIFY` nor `READ_SCOPE` (design diff `bf197dd2..d2c8262d` touches neither).
- Placement anchor: after `PR` (`:99-103`), before `toUnits` (`:106`).

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `READ_SCOPE` and `VERIFY` exactly as in `design.md` §1.2 (template literals with no interpolation; every literal backtick escaped `` \` ``; no shell `${`), after `PR` and before `toUnits`.
2. Replace the `:197` step `agent()` call with `design.md` §1.7, substituting `<unchanged :197 fold text>` with today's `${FOLD === 'adjacent' ? … : …}` expression unchanged. Keep `agentType: WRITER` (Step 3). The discover call `:196` is unchanged.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
```
Expected: all blocks pass; `# fail 0`; context-map OK.

---

### Step 10 — test: no silent writer no-op in Land (AC-43, AC-44)

**Status**: `pending`
**Service**: `scripts/workflow-tests` (SDD tooling)
**Files**:
- `scripts/workflow-tests/sdd-batch-execute.test.mjs` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Today `sdd-batch-execute.js:241` `if (wp) out.commits.push(...wp.commits)` then halts at promotion (`:242-243`) whatever the writer did; `:246-249` marks `done` with any `pr.url`, empty included.
- The `'integration-pr:'` reply already carries `notes: []` (Step 2); block 4 (`sdd-batch-execute.test.mjs:54-58`) and block 5 (`:59-64`) fixtures reach write-plan and integration-pr.

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: `AC-43, AC-44`

**Instructions**:
1. AC-43 block: block-4 fixture (`status: 'code-completed', steps: steps(3)`, `checkpoint:3` proceed) with `'write-plan:'` → `{commits:[], notes:['pre-commit hook inert (hook-fail=hooksPath)']}` → `blocked` matches `/write-plan made no commit/`, `halted === null`; with `'write-plan:'` → `null` → `blocked` matches `/write-plan made no commit: writer died/`.
2. AC-44 block: block-5 fixture (promotion proceed, `promotionPlan: 'PLAN'`) with `'integration-pr:'` → `{url:'', commits:[], notes:['pre-commit hook inert (hook-fail=h)']}` → `blocked` matches `/integration-pr incomplete: pre-commit hook inert/` and `stage !== 'done'`; `{url:'', commits:[], notes:[]}` → `/integration-pr incomplete: no PR url/`; `{url:'https://github.com/o/r/pull/1', commits:[], notes:['plan already applied at the dev-branch tip']}` → `stage === 'done'`, `prUrl === 'https://github.com/o/r/pull/1'`; and the integration-pr prompt contains `Open the PR only if the promotion commit is pushed now`.
3. RED (before Step 11): the AC-43 block fails because the run halts at `promotion` instead of blocking; name `AC-43` in the message.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
```
Expected (after Step 11): all blocks pass; `# fail 0`; context-map OK.

---

### Step 11 — service: write-plan and integration-pr guards, PR notes (FR-10)

**Status**: `pending`
**Service**: `.claude/workflows` (SDD tooling)
**Files**:
- `.claude/workflows/sdd-batch-execute.js` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- `PR` schema `sdd-batch-execute.js:99-103` (`properties: { url, commits }`, `required: ['url', 'commits']`).
- write-plan result line `:241` `if (wp) out.commits.push(...wp.commits)`.
- integration-pr prompt `:245` ends "… base main-dev, head ${p.devBranch}. Return its URL and the commits."; result handling `:246-249`.

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `PR` schema: add `notes: { type: 'array', items: { type: 'string' } }` to `properties` and `'notes'` to `required` (design §1.2).
2. Replace `:241` with the two-line write-plan guard of `design.md` §1.8.
3. In the `:245` prompt, replace "Return its URL and the commits." with the design §1.8 sentence ("Open the PR only if the promotion commit is pushed now or the plan is already applied at origin/${p.devBranch} (say which in notes); otherwise return url ''. Return its URL, the commits and notes."). integration-pr keeps the default agent type (D18; product-spec FR-1).
4. After `:246-247` (the `!pr` guard and `out.commits.push(...pr.commits)`), add the design §1.8 `if (!pr.url) { … }` guard before `out.prUrl = pr.url`. No commits-length guard (D18).

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
```
Expected: all blocks pass; `# fail 0`; context-map OK.

---

### Step 12 — test: static contract-doc asserts (AC-16, AC-19, AC-27)

**Status**: `pending`
**Service**: `scripts/workflow-tests` (SDD tooling)
**Files**:
- `scripts/workflow-tests/sdd-batch-execute.test.mjs` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- `.claude/skills/sdd-execute/SKILL.md:291` `### PHASE 3: Execution`; `:301` "3. Run the step's `**Verification**` command. Report the exact output. (For a code-bearing step this is the green run of the TDD gate.)"; next `### ` heading after `:291` is `### STEP COMMIT + PR` (`:336`).
- `docs/patterns/context-engineering.md:170` the `/sdd-batch-execute` row; its last cell today: "the up-front confirm · every smart checkpoint (default) · every blocker · merge-order · the promotion confirm". §4 spans `:153` (`## 4. Saved workflows`) to `## How the three compose` (`:230`).
- `.claude/agents/context-distiller.md:51-52` (rubric tail) and `.claude/skills/sdd-distill/SKILL.md:108` (WRITE item 3) contain no `sdd-batch-` text (grep → no hits).
- `.claude/context-map.yaml:15` header and the Step 3 entries.
- CI's checkout is shallow (`.github/workflows/ci.yml:897` `actions/checkout@v7`, no `fetch-depth`), so the test file must not read `origin/main-dev`; the AC-16 HARD CONSTRAINTS byte-identity runs in Step 15's Verification instead.

**Lands with**: `Step 13, Step 14, Step 15`

**TDD**: `red-green required`

**Covers**: `AC-16, AC-19, AC-27`

**Instructions**:
1. AC-19 block: read `SKILL.md`; take the text from `### PHASE 3: Execution` to the next `### `; assert it contains ``Report the cited output lines, the `exit=` line and the log path (full log on request)`` and does not contain `Report the exact output`.
2. AC-27 block: read `context-distiller.md` and `sdd-distill/SKILL.md`; both contain `sdd-batch-`, `byte-for-byte` and `in original order`; `context-distiller.md` contains `Never mark a whole session keep-verbatim only because it holds a fence`.
3. AC-16 block: read `context-engineering.md`; take §4 (from `## 4. Saved workflows` to `## How the three compose`); it contains `record`, `{gate:'resume'`, `{gate:'distill'`, `sdd-batch-setup`, `not resumeFromRunId`, `sdd-batch-writer`, `sdd-batch-checker`; the line starting ``| `/sdd-batch-execute` `` has a last cell (`split('|')`, last non-empty) containing `resume`, `distill` and `re-halts`. These are the AC-16 terms; the design's §1.11 cell text supplies all three. Read `.claude/context-map.yaml`: contains `name: sdd-batch-writer` and `name: sdd-batch-checker`.
4. Every assertion message names its scenario (`AC-16`, `AC-19` or `AC-27`).
5. RED (before Steps 13–15): the AC-19 block fails on the new wording; name `AC-19` in the message.
6. This landing unit (Steps 12–15) is at the 4-member cap: no further step may join it.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
```
Expected (after Steps 13–15): all blocks pass; `# fail 0`; context-map OK.

---

### Step 13 — docs: SKILL.md:301 report-the-output wording, all modes (FR-7, D11)

**Status**: `pending`
**Service**: `.claude/skills/sdd-execute` (SDD tooling)
**Files**:
- `.claude/skills/sdd-execute/SKILL.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `.claude/skills/sdd-execute/SKILL.md:301`: "3. Run the step's `**Verification**` command. Report the exact output. (For a code-bearing step this is the green run of the TDD gate.)"
- `:302-317` (no-database rule, config-key wiring gate) and `## HARD CONSTRAINTS` `:476-518` must not change (business rules `@AC-4/@AC-5/@AC-10 @feature-278`, `docs/sdd/business-rules/platform.feature:818,826`; FR-8).

**Lands with**: `Step 12, Step 14, Step 15`

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Replace line 301 with the `design.md` §1.9 text exactly: "3. Run the step's `**Verification**` command. Report the cited output lines, the `exit=` line and the log path (full log on request); `exit=<n>` is the command's exit status, and with no log file the path is `none`. (For a code-bearing step this is the green run of the TDD gate.)" Change no other line.

**Verification**:
```bash
git fetch -q origin main-dev && B=$(git merge-base HEAD origin/main-dev)
git diff --unified=0 "$B" -- .claude/skills/sdd-execute/SKILL.md | grep -c '^[-+][^-+]'
grep -n "Report the cited output lines" .claude/skills/sdd-execute/SKILL.md
```
Expected: `2` (one removed, one added line, measured against the branch point, so later `main-dev` moves cannot skew it); the grep shows line 301.

---

### Step 14 — docs: distill keeps every sdd-batch-* fence verbatim (FR-8, D8)

**Status**: `pending`
**Service**: `.claude/agents`, `.claude/skills/sdd-distill` (SDD tooling)
**Files**:
- `.claude/agents/context-distiller.md` — modify
- `.claude/skills/sdd-distill/SKILL.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `.claude/agents/context-distiller.md:51-52` "When a session's entire content is droppable … `- <date>: routine progress; durable state already in header`." — insertion point after it (before `---` `:54`).
- `.claude/skills/sdd-distill/SKILL.md:108` "3. `## Superseded Sessions` — the compressed ≤3-line summaries from the plan, oldest first."; Superseded Sessions precede the kept sessions (`:108-110`), so fence order survives (design §1.10).
- Fences in use: `sdd-batch-promotion-plan` (`sdd-batch-execute.js:148,240`), `sdd-batch-design-state` (`context-engineering.md:185-186`), plus the new `sdd-batch-setup`.

**Lands with**: `Step 12, Step 13, Step 15`

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. In `context-distiller.md`, add after line 52 (blank line before and after) the two-sentence paragraph quoted in `design.md` §1.10.
2. In `sdd-distill/SKILL.md`, append to item 3 (`:108`) the first sentence of that paragraph, as a continuation line indented to the item.

**Verification**:
```bash
grep -n "byte-for-byte" .claude/agents/context-distiller.md .claude/skills/sdd-distill/SKILL.md
grep -c "Never mark a whole session keep-verbatim only because it holds a fence" .claude/agents/context-distiller.md
```
Expected: one hit in each file; count `1`.

---

### Step 15 — docs: context-engineering.md §4 contract and the context-map header (FR-8)

**Status**: `pending`
**Service**: `docs/patterns` (SDD tooling)
**Files**:
- `docs/patterns/context-engineering.md` — modify
- `.claude/context-map.yaml` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/context-engineering.md:167` `| Workflow | Runs | Stops at |`; `:170` the `/sdd-batch-execute` row; `:180-186` the `approvals` bullet ending "the approved C-16 plan in a `sdd-batch-promotion-plan` block."; `:213-221` Operational notes ending "launch from an up-to-date checkout." (`:221`); `:35` read-only default ("Read-only by default").
- `.claude/context-map.yaml:15` `# --- Subagent fleet: isolated read-only windows that return condensed digests ---`.
- AC-16 byte-identity baseline: `## HARD CONSTRAINTS` `SKILL.md:476` to `## REPO CONVENTIONS` `:519`.

**Lands with**: `Step 12, Step 13, Step 14`

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Replace the last cell of the `:170` row with the `design.md` §1.11 Stops-at text verbatim.
2. Insert the §1.11 contract bullet as a new `- ` bullet directly after the `approvals` bullet (after `:186`), then the §1.11 roles bullet (hook precondition, the four exclude lines, no workflow write under the main checkout, no writer Node install, D23/D26) directly after it.
3. Append the §1.11 operational-note sentences (the four `info/exclude` lines as an operator precondition; `.sdd-logs/` lifetime) to the Operational notes paragraph, after "launch from an up-to-date checkout." (`:221`).
4. Replace the `.claude/context-map.yaml:15` header with the §1.11 text.

**Verification**:
```bash
node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
git fetch -q origin main-dev && B=$(git merge-base HEAD origin/main-dev)
diff <(git show "$B":.claude/skills/sdd-execute/SKILL.md | sed -n '/^## HARD CONSTRAINTS/,/^## REPO CONVENTIONS/p') <(sed -n '/^## HARD CONSTRAINTS/,/^## REPO CONVENTIONS/p' .claude/skills/sdd-execute/SKILL.md) && echo hard-constraints-identical
```
Expected: `# fail 0`; `OK - all context-map and doc references resolve.`; `hard-constraints-identical`.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
