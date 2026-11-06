# Implementation Spec: batch-execute-token-reduction

**Status**: `pending`
**Created**: 2026-11-06
**Feature**: `docs/roadmap/features/301-batch-execute-token-reduction/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/batch-execute-token-reduction`

---

## Execution Summary

Step 1 is the FR-9 PR-0 spike. It runs on a throwaway branch that is never merged, and it is the gate
for everything after it: if `agentType` does not compose with `isolation:'worktree'`, or the checker
cannot reach `mcp__github__list_pull_requests`, or husky does not fire in a linked worktree, execution
stops for an operator decision (P-04) before Step 2. Steps 2–15 then build the change test-first as
seven atomic units, each a `test` step followed by the change it proves, one red→green commit per unit
(`docs/patterns/context-engineering.md:226`, "Change a gate rule → change its test first";
`docs/roadmap/ledger/fails.md:3675-3678`, the test step precedes its service step):

1. Steps 2+3 — agent types, `agentType` wiring, context-map entries (FR-1).
2. Steps 4+5 — shared hook constants and the `writerRules` rewrite (FR-5 writer rules).
3. Steps 6+7 — schemas, preflight, the Gate (record / distill / resume / hook-setup), `TOOLING_HOOK` and
   `setupTask` (FR-2..FR-5).
4. Steps 8+9 — `READ_SCOPE`, `VERIFY` and the step prompt (FR-6, FR-7).
5. Steps 10+11 — Land guards (FR-10).
6. Steps 12–15 — static doc asserts, then `SKILL.md:301`, the distill fence rule, §4 and the
   context-map header (FR-7 wording, FR-8).

**Sequencing change vs `design.md` §1.13 (no design change).** The design's build order puts
`TOOLING_HOOK` + `setupTask` in the same step as `writerRules` (its step 3), after the Gate (its step 2).
The Gate block calls `setupTask(f, p, r)` and interpolates `TOOLING_HOOK` into the hook-setup prompt
(design §1.5), so the Gate cannot pass its own tests without them. This spec therefore lands
`writerRules` first (unit 2; it needs only `MAINWT`/`HOOK_CHECK`/`ENV_REMEDY`), and moves `TOOLING_HOOK`,
`setupTask` and their prompt-contract scenarios (AC-13, 18, 25, 38, 41) into the Gate unit. Every snippet
is still taken verbatim from `design.md` §1.1–§1.12, which binds (IR-1..IR-4 included).

**Line numbers.** Every `sdd-batch-execute.js:<n>` and `sdd-batch-execute.test.mjs:<n>` cite is to the
pre-feature file at tree `157a6be` (unchanged since recon's `5aac6e6`). Earlier steps shift later lines;
locate each edit by the quoted anchor text, not by number.

**Consumer surface (C-14):** None — internal SDD tooling consumed by the operator through the
`/sdd-batch-execute` saved workflow (product-spec § Consumer Surface(s)). No UI or Agent step is
required; this is a recorded decision, not an omission.

**Coverage threshold (C-08):** the workflow tests have no CI coverage gate (`.github/workflows/ci.yml:877`
runs `node --test scripts/workflow-tests/*.test.mjs` with no coverage flag) and no linter covers
`.claude/workflows/` or `scripts/workflow-tests/` (`package.json:17-19` lint-staged targets only
`services/xstockstrat-ui/**`). The harness loading the script (`scripts/workflow-tests/harness.mjs:9,24`)
is the parse check. Every test-step Verification therefore runs the suite plus `check-context-map.sh`.

**Baseline (2026-11-06, tree `157a6be`):** `node --test scripts/workflow-tests/*.test.mjs` → `# pass 4`,
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
| AC-20 | 1 (conditional: applies only if the spike shows composition fails) |
| AC-21, AC-22 | 6 |
| AC-23 | 8 |
| AC-24, AC-25 | 6 |
| AC-26 | 4 |
| AC-27 | 12 |
| AC-28 – AC-31 | 6 |
| AC-32, AC-33 | 8 |
| AC-34 – AC-38 | 6 |
| AC-39 | 4 (setup, step, write-plan, integration-pr prompts); 6 adds the hook-setup prompt |
| AC-40, AC-41 | 6 |
| AC-42 | 8 |
| AC-43, AC-44 | 10 |
| AC-45 | retired (D19) — no step |
| AC-46 | 6 |

## Step Dependencies

- **Step 1 runs interactively, not under `/sdd-batch-execute`.** It launches a throwaway workflow and
  measures agent transcripts; a workflow subagent cannot spawn agents (`context-engineering.md:157-158`).
  Run it as `/sdd-execute batch-execute-token-reduction 1` in the operator's main session; the
  bash 3.2 item needs the operator's macOS host.
- **Step 2 requires Step 1** with these outcomes recorded; any other outcome is a §5.7 blocker for the
  operator (P-04), not a silent adaptation:
  - `spike.composition: pass` — else AC-20 applies: Steps 3 and 7 put `agentType: CHECKER` on
    preflight only; validate, setup, hook-setup and step keep the default type (FR-9 last paragraph).
  - `spike.checker-pr-lookup` names a working path — else preflight keeps the default type
    (design §1.13 "Spike outcomes").
  - `spike.first-turn-tokens` ≤ 30000 for both agents.
  - `spike.husky-linked-worktree: pass` — else design Open Risk 1's fallback is an operator decision.
  - `spike.context-max: 65536` — any other calibrated value changes the FR-4 / AC-10 literal and needs
    a product-spec delta first.
- Steps 2+3 land together: Step 2 adds tests that fail until Step 3 exists (§C "adds a test that
  references a symbol a later step creates"; F-05).
- Steps 4+5 land together: same trigger.
- Steps 6+7 land together: same trigger; Step 6 also rewrites existing fixtures (blocks 1, 2, 3, 7, 8, 9)
  that only pass against Step 7's Gate.
- Steps 8+9 land together: same trigger.
- Steps 10+11 land together: same trigger.
- Steps 12+13+14+15 land together: Step 12's static asserts fail until all three doc edits exist
  (unit of 4, the §C cap).
- Step 5 requires Step 3: `writerRules` is interpolated into calls that Step 3 gave `agentType`.
- Step 7 requires Step 5: `TOOLING_HOOK` and `setupTask` say "git-protocol item 2", which is the hook
  wiring item Step 5 writes; the preflight prompt interpolates `MAINWT`/`HOOK_CHECK` from Step 5.
- Step 9 requires Step 7: the step-loop `stop here` line (`:191`) is deleted in Step 7; Step 9 replaces
  the `:197` prompt only.
- Step 11 requires Step 3 (`agentType: WRITER` on write-plan is already wired there).
- Step 15 requires Step 3: the context-map header note describes the two entries Step 3 adds.
- All steps are one consumer surface (`backend`: no step's **Service** is `xstockstrat-ui` or
  `xstockstrat-agent`), so every unit is surface-homogeneous (§C).

---

### Step 1 — test: PR-0 spike — prove scoped agents, worktree hooks and helpers; calibrate CONTEXT_MAX

**Status**: `pending`
**Service**: `.claude/workflows` (SDD tooling)
**Files**:
- `docs/roadmap/features/301-batch-execute-token-reduction/context.md` — modify (spike results entry)

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- No existing `agent()` call combines `agentType` with `isolation:'worktree'`: `sdd-batch.js` uses `agentType` at `:183,184,212,213,233,235,289,290` and `isolation:'worktree'` on separate calls `:189,216,251,264,276,292` (recon.md § Codebase Map, "Other workflows"); `sdd-batch-execute.js:196,238` (agentType, no isolation) vs `:163,178,197,240,245` (isolation, no agentType) — confirmed by reading the file.
- No agent today has Bash/Edit/Write/`mcp__` in `tools:` — `.claude/agents/codebase-discovery.md:4` `tools: Glob, Grep, Read` (recon "Agents").
- Hook state in this container: `git config core.hooksPath` prints nothing; `.husky/` holds only `pre-commit` (no `.husky/_`); no `~/.config/husky/` — confirmed by `ls .husky/; git config core.hooksPath; ls ~/.config/husky`.
- `package.json:7` `"prepare": "husky"`, `:12` `"husky": "^9.1.7"`; `.husky/pre-commit:6` `pnpm exec lint-staged || exit 1`, `:10-14` ui-only hard block.
- Resolver CLI: `scripts/merge-train-resolve.mjs:4` `Usage: node scripts/merge-train-resolve.mjs --base <ref> [--own-slug <slug>]`, `:145` exit 64 without `--base`, `:148` exit 2 on unresolvable. ledger-guard CLI: `scripts/ledger-guard.py:49-52` (`--own-slug` required, `--base` default `origin/main-dev`, `--head`, `--fix`).
- CONTEXT_MAX calibration inputs exist: `docs/roadmap/features/282-filter-otc-symbols/context.md` (112748 bytes in the main checkout), `289-fix-analysis-admin-formula-refusal/context.md` (117632), `294-signal-map-instrumentation/context.md` (16048) — `wc -c`, tree `157a6be`.
- Merge-train update protocol to imitate for the merge-commit hook measurement: `.claude/workflows/merge-train.js:107-111`.

**TDD**: `N/A (manual spike — no code is merged; the outcome is recorded evidence that gates Step 2)`

**Covers**: `AC-17, AC-20`

**Instructions**:
1. Create a throwaway branch `spike/batch-execute-token-reduction` from `origin/feature/batch-execute-token-reduction`. It is never merged and never PR'd; delete it (local and origin) at the end of this step, together with any `spike/301-*` target branch.
2. On it, add `.claude/agents/sdd-batch-checker.md` and `.claude/agents/sdd-batch-writer.md` with exactly the frontmatter and body of `design.md` §1.1 (the same content Step 3 commits), and a throwaway workflow `.claude/workflows/spike-301.js` with two `agent()` calls:
   - a checker call `{ agentType: 'sdd-batch-checker', isolation: 'worktree', label: 'spike-checker' }` whose prompt runs `git rev-parse origin/main-dev`, `git cat-file -s <sha>:docs/roadmap/features/301-batch-execute-token-reduction/context.md`, and the design §1.4 item 6 PR lookup (direct call, else ToolSearch `select:mcp__github__list_pull_requests`), and reports which path worked;
   - a writer call `{ agentType: 'sdd-batch-writer', isolation: 'worktree', label: 'spike-writer' }` whose prompt applies the design §1.3 `writerRules` item 2 hook wiring, then (when `HOOK_CHECK` fails on `hooksPath`/`h`) the design §1.2 `TOOLING_HOOK` branch a/b remedy in the main checkout, re-checks, and makes three commits on a `spike/301-target` branch using the §1.3 item 3 CLOG form: a plain doc commit, a commit staging one `services/xstockstrat-ui/` file, and a `git merge --no-commit --no-ff` of a ref that brings in `services/xstockstrat-ui/` files followed by `node "$M"/scripts/merge-train-resolve.mjs --base <40-hex sha>` and a commit; it records each hook's wall time (`date +%s` around the commit) and `wc -c <"$CLOG" | tr -d ' '`; it also runs one design §1.2 `VERIFY` background run (`run_in_background`, `.exit` sentinel, ≤540 s polls) and `python3 scripts/ledger-guard.py --own-slug batch-execute-token-reduction --base <40-hex sha>`.
3. `/reload-skills`, then run `spike-301` with the Workflow tool from the main session. Read both agent transcripts: first-turn input tokens of each, whether the checker's PR call was direct or preceded by a ToolSearch select, and whether the writer ran with `agentType` honoured inside its worktree (its tool list is exactly the writer's).
4. On the operator's macOS host under `/bin/bash` 3.2: `( printf x; exit 3 ) >f 2>&1; echo exit=$?` must print `exit=3`; `wc -c <f | tr -d ' '` must print `1`; also run `mktemp <dir>/X.XXXXXX`, the `mkdir` lock, `find <dir> -maxdepth 0 -mmin +30` and a column-0 quoted heredoc once each.
5. Confirm `pnpm exec husky` wrote the relative value: `git config core.hooksPath` prints `.husky/_`; and that no `~/.config/husky/init.sh` sets `HUSKY=0`.
6. CONTEXT_MAX: record `git cat-file -s origin/<devBranch>:docs/roadmap/features/<dir>/context.md` for features 282, 289 and 294 (dev branch from each `feature.md`, else `origin/main-dev`), and the value chosen (default `65536`, FR-4).
7. Append to this feature's `context.md` a `## Session <ISO> — PR-0 spike (FR-9)` entry with one line per key, each starting exactly `- spike.<key>: ` followed by the result and the evidence (transcript id, numbers): `composition`, `checker-pr-lookup`, `first-turn-tokens`, `husky-linked-worktree`, `hook-cost`, `background-poll`, `raw-sha-base`, `bash32`, `husky-init`, `context-max`. Then apply the outcome rules in `## Step Dependencies` (blocker on any failing outcome; AC-20 when composition fails).

**Verification**:
```bash
F=docs/roadmap/features/301-batch-execute-token-reduction/context.md
for k in composition checker-pr-lookup first-turn-tokens husky-linked-worktree hook-cost background-poll raw-sha-base bash32 husky-init context-max; do
  grep -q "^- spike\.$k: " "$F" || { echo "MISSING spike.$k"; exit 1; }
done
git ls-remote --exit-code --heads origin 'spike/batch-execute-token-reduction' 'spike/301-target' >/dev/null && { echo "spike branches still on origin"; exit 1; }
echo spike-record-ok
```
Expected: `spike-record-ok`.

---

### Step 2 — test: scoped agent types and their wiring (AC-1, AC-2)

**Status**: `pending`
**Service**: `scripts/workflow-tests` (SDD tooling)
**Files**:
- `scripts/workflow-tests/sdd-batch-execute.test.mjs` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- The harness records full `opts` per call: `scripts/workflow-tests/harness.mjs:12` `calls.push({ label: opts.label, opts, prompt })`; prefix-matched replies `:13`; `ROOT` export `:6`.
- Test file is one top-level script with numbered `console.log` blocks: `sdd-batch-execute.test.mjs:23-86`; fixtures `pre()` `:11`, `impl()` `:12`, `replies()` `:13-22`, `steps(done)` `:6-10`, `base` `:5`.
- No test asserts `agentType` today (recon § Risks / Not-found) — confirmed: `grep -n agentType scripts/workflow-tests/sdd-batch-execute.test.mjs` → no hits.
- Agent frontmatter shape: `.claude/agents/codebase-discovery.md:1-6` (`name`, `description`, `tools`, `model`).

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2`

**Instructions**:
1. Add `import fs from 'node:fs'` and, after `:4`, constants used by every later block: `const MD = 'a'.repeat(40), DV = 'b'.repeat(40), SH = 'c'.repeat(40)`, `const CHECKER = 'sdd-batch-checker', WRITER = 'sdd-batch-writer'`, and helpers `const count = (t, p) => t.calls.filter((c) => c.label.startsWith(p)).length` and `const callOf = (t, l) => t.calls.find((c) => c.label === l)` (design §1.12: count with `startsWith`, never `includes`).
2. Append block `10` (before the final `ALL … passed` line) for **AC-1**: run with `checkpoints: 'report', authorizationRef: 'x'`, approvals `{'fix-a': [{gate:'checkpoint:2', decision:'proceed'}, {gate:'promotion', decision:'proceed'}]}` and `replies({ status: 'in-progress', steps: steps(2), workflowSetup: MD, promotionPlan: 'PLAN' })` (the `workflowSetup` field is ignored until Step 7 and keeps this block valid after it). Assert `callOf(t,'preflight:fix-a').opts.agentType === CHECKER`; every `step:fix-a:` call's `opts.agentType === WRITER` and at least one exists; `callOf(t,'integration-pr:fix-a').opts.agentType === undefined`.
3. Append block `11` for **AC-2**: read `.claude/agents/sdd-batch-writer.md` and `.claude/agents/sdd-batch-checker.md` with `fs.readFileSync(path.join(ROOT, …), 'utf8')`; assert each contains a line `model: opus`, contains `spawned only by .claude/workflows/sdd-batch-execute.js; never delegate from a skill session`, and its `description:` line contains `Workflow-internal` and `Never select via Task`; the checker's `tools:` line is exactly `tools: Bash, Read, Glob, Grep, ToolSearch, mcp__github__list_pull_requests`; the writer's is exactly `tools: Bash, Read, Edit, Write, Glob, Grep`.
4. RED (before Step 3): block 10 fails on the preflight `agentType` assertion (today's call at `sdd-batch-execute.js:149` has none); name `AC-1` in the assertion message.

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
- Existing agentType precedent: `:196` `{ agentType: 'codebase-discovery', … }`, `:238` `{ agentType: 'scenario-promoter', … }`.
- Constant placement anchor: `:29` `const FOLD = A.foldPolicy || 'ask'` (design §1.2 placement: constants after `FOLD`).
- context-map agents list ends with `qa-tester` at `.claude/context-map.yaml:45-48`; entry shape `name`/`path`/`returns`/`used_by` (`:17-20`).
- `scripts/check-context-map.sh:29` validates every `.claude/…\.md` path in the map, and `:34-46` scans agent `.md` files for `(\.claude|docs)/….md` refs, so any `.md` path named in the new agent bodies must exist.
- Agent body shape rule: `docs/patterns/context-engineering.md:40-43`; opus tier for "a verdict that gates an irreversible write" `:51`.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `.claude/agents/sdd-batch-checker.md` and `.claude/agents/sdd-batch-writer.md` with exactly the frontmatter in `design.md` §1.1 and a body that states, as rules + method + output format (`context-engineering.md:40-43`), the §1.1 body bullets — including the literal sentence `spawned only by .claude/workflows/sdd-batch-execute.js; never delegate from a skill session.` in both.
2. In `.claude/workflows/sdd-batch-execute.js`, after the `FOLD` guard block (`:30-33`), add `const CHECKER = 'sdd-batch-checker'` and `const WRITER = 'sdd-batch-writer'`.
3. Add `agentType: CHECKER` to the preflight (`:149`) and validate (`:163`) option objects, and `agentType: WRITER` to setup (`:178`), step (`:197`) and write-plan (`:240`). Leave discover (`:196`), promotion-plan (`:238`) and integration-pr (`:245`) unchanged. If Step 1 recorded `spike.composition` as failed, apply AC-20 instead (CHECKER on preflight only) — that path exists only via the Step 1 blocker decision.
4. Append to `.claude/context-map.yaml` `agents:` after the `qa-tester` entry (`:45-48`) the two entries of `design.md` §1.11 (`sdd-batch-checker` and `sdd-batch-writer`, each `used_by: [sdd-batch-execute]`). Leave the `:15` header for Step 15.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
grep -n "agentType: CHECKER\|agentType: WRITER" .claude/workflows/sdd-batch-execute.js
```
Expected: tests green as in Step 2; the grep shows 2 CHECKER and 3 WRITER call sites.

---

### Step 4 — test: writer-rules contract — hook wiring, excludes, CLOG commits (AC-26, AC-39)

**Status**: `pending`
**Service**: `scripts/workflow-tests` (SDD tooling)
**Files**:
- `scripts/workflow-tests/sdd-batch-execute.test.mjs` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Existing writer-rule assertions loop over `setup|step|write-plan|integration-pr` prompts: `sdd-batch-execute.test.mjs:43-46` (`'Push after EACH artifact edit'`, `'no commit before verification'`) — these must keep passing (design §1.3: items 4–6 verbatim).
- Today's writerRules item 2 is the bare `node_modules` symlink sentence: `sdd-batch-execute.js:126`; item 3 the trailer `:127-128`. No `SDD_MSG_EOF`, `HOOK_CHECK` or `info/exclude` text exists (`grep -n "SDD_MSG_EOF\|info/exclude\|hook-fail" .claude/workflows/sdd-batch-execute.js` → no hits).
- Block 2 (`:38-47`) and block 5 (`:59-64`) already render setup, step, write-plan (block 4 `:54-58`) and integration-pr prompts with today's fixtures.

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-26, AC-39`

**Instructions**:
1. Append block `12` for **AC-26**: reuse the block-3 fixture (`checkpoint:2` proceed, `status: 'in-progress', steps: steps(2), workflowSetup: MD`) and take `p = callOf(t,'step:fix-a:s3').prompt`. Assert it contains each of `services/*/node_modules`, `.husky/_`, `core.hooksPath`, `SDD_MSG_EOF`, `pre-commit hook inert`, `hook-fail=`, `provision pnpm 9.15.9`, `re-send the resume approval`, `info/exclude`, `grep -qxF`, `/services/*/node_modules`, `/.husky/_`, `! git diff --quiet`; and contains neither `pnpm install --frozen-lockfile` nor `pnpm exec husky`.
2. Append block `13` for **AC-39**: collect the setup prompt (block-2 run; until Step 6 rewrites it, block 2's fixture reaches setup with today's `{gate:'upfront', decision:'proceed'}`), the step prompt (block 12), the write-plan prompt (block-4 fixture) and the integration-pr prompt (block-5 fixture). For each assert it contains `git commit -F - >"$CLOG" 2>&1 <<'SDD_MSG_EOF'`, `echo "exit=$?"; tail -n 20 "$CLOG"`, `git rev-parse --git-dir` and `Never use --no-verify`, and that `prompt.split('\n')` contains a line exactly `SDD_MSG_EOF`. Write these JS strings in single quotes (IR-4).
3. RED (before Step 5): block 12 fails on `services/*/node_modules`; name `AC-26` in the message.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
```
Expected (after Step 5): `12 …`, `13 …` and `ALL sdd-batch-execute tests passed`; `# fail 0`; context-map OK.

---

### Step 5 — service: shared hook constants and the writerRules rewrite (FR-5 writer rules, D15)

**Status**: `pending`
**Service**: `.claude/workflows` (SDD tooling)
**Files**:
- `.claude/workflows/sdd-batch-execute.js` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- `function writerRules(f, p)` spans `sdd-batch-execute.js:123-133`; item 5 text `:130` ("Push after EACH artifact edit: … (SKILL.md HARD CONSTRAINT: no commit before verification).") is kept verbatim; items 4 and 6 and the closing paraphrase `:129,131-132` likewise.
- Existing escaped-backtick convention inside the template: `:125` `` \`git fetch origin\` `` (IR-1).
- `.gitignore:23` `**/node_modules/` matches directories only (ledger `fails.md:3681-3684`), so the links need root-anchored `info/exclude` patterns.
- husky 9 writes the relative `.husky/_` on `prepare`: `package.json:7` `"prepare": "husky"`.
- `ENV_REMEDY`'s pnpm pin matches root `CLAUDE.md` § Language Versions (`pnpm 9.15.9`).

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. After the `CHECKER`/`WRITER` constants from Step 3, add `MAINWT`, `HOOK_CHECK` and `ENV_REMEDY` exactly as in `design.md` §1.2, as **plain single-quoted strings** (IR-1: `HOOK_CHECK` contains `${HUSKY-}` and must never become a template literal). Keep the design's two one-line constraint comments (≤2 lines, CLAUDE.md How to Act #5).
2. Replace `function writerRules` (`:123-133`) with `design.md` §1.3 verbatim, substituting the placeholder `<unchanged :130 text, …>` with today's `:130` item-5 sentence unchanged. Keep the heredoc body lines and the closing `SDD_MSG_EOF` at column 0 in the source (IR-3); escape every literal backtick as `` \` `` and write no shell `${` inside the template (IR-1).
3. Do not touch any agent call, the Gate or the step loop in this step.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
grep -n "^const HOOK_CHECK = '" .claude/workflows/sdd-batch-execute.js && grep -n "^SDD_MSG_EOF$" .claude/workflows/sdd-batch-execute.js
```
Expected: tests green; `HOOK_CHECK` declared with a single quote; exactly one column-0 `SDD_MSG_EOF` line.

---

### Step 6 — test: Gate, preflight and setup — record, distill, resume, hook-setup, setup contract (FR-2..FR-5)

**Status**: `pending`
**Service**: `scripts/workflow-tests` (SDD tooling)
**Files**:
- `scripts/workflow-tests/sdd-batch-execute.test.mjs` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Fixtures to extend: `pre()` `sdd-batch-execute.test.mjs:11`, `replies()` `:13-22` (`'setup:': { commits: ['c-setup'], notes: [] }` `:16`).
- Existing blocks whose fixtures change (design §1.12 "Fallout"): block 1 `:31-36`, block 2 `:37-47`, block 3 `:48-53`, block 7 `:69-74`, block 8 `:75-81` (second run `:78`), block 9 `:82-85`.
- Prefix matching makes `hook-setup:` distinct from `setup:`: `harness.mjs:13` (`startsWith`).
- No test asserts `validate:` count > 0, `setup:` count > 0, or `isolation` (recon § Risks / Not-found).

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-18, AC-21, AC-22, AC-24, AC-25, AC-28, AC-29, AC-30, AC-31, AC-34, AC-35, AC-36, AC-37, AC-38, AC-39, AC-40, AC-41, AC-46`

**Instructions**:
1. **Fixtures.** Add `const REC = { mainDev: MD, dev: DV, specHash: SH, directive: 'conditional', pending: [1, 2, 3], mismatches: [] }` and `const after = (s, anchor) => s.slice(s.indexOf(anchor))`. `pre()` defaults gain `mainDevSha: MD, devSha: DV, specHash: SH, contextBytes: '1000', workflowSetup: '', hookLive: true`. `replies()`: `'setup:'` → `{ commits: ['c-setup'], notes: [], tooling_blockers: [], stale: false, completed: true }`; add `'hook-setup:': { hookLive: true, tooling_blockers: [], notes: [] }`.
2. **Fallout in existing blocks** (design §1.12): block 1 also asserts `assert.deepEqual(r.halted.record, REC)`; blocks 2, 7(a) and 8(b) send `{gate:'upfront', decision:'proceed', record: REC}` and assert `count(t,'validate:') === 0`; blocks 3, 7(b), 9, 10 and 12 use `status: 'in-progress', workflowSetup: MD`. Block 13's setup prompt comes from the updated block-2 run.
3. **Behavioural blocks** (one numbered block per scenario, assertion messages name the `AC-N`; literals from `acceptance.feature`):
   - AC-3: no approvals, `'validate:'` → `{mismatches:[{n:2,detail:'D'}], tooling_blockers:[]}`; `count validate: === 1`; `halted.gate === 'upfront'`; `halted.record` deep-equals `{...REC, mismatches:[{n:2,detail:'D'}]}`; 0 `setup:`/`step:`/`write-plan:` calls.
   - AC-4: approval with `record: {...REC, mismatches:[{n:2,detail:'D'}]}` → 0 validate; 1 setup whose prompt contains `[{"n":2,"detail":"D"}]`.
   - AC-5: record with `mainDev: 'd'.repeat(40)` → 1 validate; upfront halt whose `record.mainDev === MD`; 0 setup.
   - AC-6: upfront proceed with no record → 1 validate; upfront halt with a `record`; 0 setup.
   - AC-7: `{gate:'blocker:1', decision:'Option A'}`, status implementation-ready, `workflowSetup: ''` → 1 validate; upfront halt; 0 step.
   - AC-8: `status: 'in-progress', workflowSetup: ''`, no approvals → 1 validate; gate `upfront` (not `resume`).
   - AC-9: `status: 'in-progress', workflowSetup: MD`, no approvals → gate `resume`, 0 validate/setup; same with `{gate:'resume', decision:'proceed'}` → 0 validate/setup, ≥1 `step:fix-a`.
   - AC-10: `contextBytes: '70000'` → gate `distill`, `halted.limit === 65536`, 0 validate; with `{gate:'distill', decision:'proceed'}` → gate `upfront`.
   - AC-11: REC approval; setup → `{commits:[], notes:['resolver exit 64'], tooling_blockers:[], stale:false, completed:false}` → `blocked` matches `/setup incomplete/`; 0 step.
   - AC-12: setup → `stale:true, completed:false` → `blocked` matches `/start a NEW run/`; 0 step.
   - AC-21: `contextBytes: 'unknown'` → `blocked` matches `/context.md size unreadable/`; `halted === null`; 0 validate.
   - AC-22: `status: 'in-progress', workflowSetup: MD, steps: steps(2)`, `{gate:'checkpoint:2', decision:'proceed'}` → 0 validate/setup; first `step:` call label is `step:fix-a:s3`.
   - AC-24: setup → `tooling_blockers:['pre-commit hook inert: hook-fail=hooksPath'], completed:false` → `blocked` matches `/tooling: pre-commit hook inert/`; 0 step.
   - AC-28: setup notes `['unresolvable: docs/x.md: off-allowlist — merge origin/main-dev into feature/fix-a by hand resolving docs/x.md, push, start a NEW run']`, `completed:false` → `blocked` matches `/unresolvable/`; `halted === null`; 0 step.
   - AC-29: approval record with `mismatches:[{n:2,detail:'D'}]`, setup `completed:true` → gate `resume`; 0 step.
   - AC-30: `features: [{ slug: 'fix-a', directive: 'none' }]`, approval `record: {...REC, directive:'none', mismatches:[{n:2,detail:'D'}]}` → `blocked` matches `/directive none: steps 2 mismatch/`; 0 setup.
   - AC-31: `mainDevSha: 'origin/main-dev'` → `blocked` matches `/non-hex sha/`; 0 validate.
   - AC-35: `status: 'in-progress', workflowSetup: MD, hookLive: false`, `{gate:'resume', decision:'proceed'}` → exactly 1 `hook-setup:fix-a` call with `opts.agentType === 'sdd-batch-writer'` and `opts.isolation === 'worktree'`, whose index in `t.calls` is lower than the first `step:fix-a` call's; 0 validate/setup.
   - AC-36: as AC-35 with hook-setup → `{hookLive:false, tooling_blockers:['pre-commit hook inert: hook-fail=hooksPath'], notes:[]}` → `blocked` matches `/pre-commit hook inert/`; 0 step.
   - AC-37: (a) REC approval, `hookLive: false` → 0 hook-setup, 1 setup; (b) resume approval, `workflowSetup: MD`, in-progress, `hookLive: true` → 0 hook-setup; (c) `{gate:'checkpoint:2', decision:'stop here'}`, in-progress, `workflowSetup: MD`, `steps: steps(2)`, `hookLive: false` → 0 hook-setup; (d) `status: 'code-completed', steps: steps(3), mergeOrderBlock: '230 first', hookLive: false`, no approvals → gate `merge-order`, 0 hook-setup.
   - AC-40: approval `record: {...REC, pending:[3,1,2]}` → 0 validate, 1 setup; and a fresh run whose preflight `steps` are `[s3, s1, s2]` (re-ordered `steps(0)`) halts with `record.pending` deep-equal `[1,2,3]`.
   - AC-46: approval `record` = REC without the `mismatches` key → 1 validate; gate `upfront`; 0 setup.
4. **Prompt-contract blocks** (render with the REC approval unless noted; single-quoted JS strings for anything containing `${HUSKY-}`, IR-4):
   - AC-13: setup prompt contains `merge-train-resolve.mjs --base ` + MD, `ledger-guard.py`, `--amend`, `Approved-record:`, `git log --first-parent`, `origin/main-dev..HEAD`; in `after(p, 'Operator approved the up-front plan')`, `indexOf('status.md') < indexOf('sdd-batch-setup')`.
   - AC-18: setup prompt contains `Skip if` at least 4 times; splitting `after(p, 'Operator approved the up-front plan')` into column-0 numbered items (`/^(\d+)\. /m`), items 2, 3, 4, 5 and 6 each contain `push`; prompt contains `completed`.
   - AC-25: setup prompt contains `core.hooksPath`, `git worktree list --porcelain`, `pnpm exec husky`, `pnpm install --frozen-lockfile`, `sdd-husky.lock`, `pre-commit hook inert`; in `after(p, '1. Tooling + hook liveness')`, `indexOf('pre-commit hook inert') < indexOf('merge-train-resolve.mjs')`.
   - AC-34: preflight prompt contains `mcp__github__list_pull_requests`, `ToolSearch`, `retry once`, `PR lookup unavailable`, `git cat-file -s`, `docs/roadmap/features/`.
   - AC-38: render setup (REC approval), preflight and `step:fix-a:s1` from one run, and hook-setup from the AC-35 fixture. All four contain `'{ [ "${HUSKY-}" != 0 ] || { echo hook-fail=HUSKY; false; }; }'`, `hook-fail=pnpm`, `hook-fail=hooksPath`, `hook-fail=h;`, `hook-fail=pre-commit`. Preflight contains `'(cd "$M" && { [ "${HUSKY-}" != 0 ]'`. Setup and hook-setup each contain `pnpm exec husky`, `pnpm install --frozen-lockfile`, `sdd-husky.lock`, `trap 'rmdir`, `-mmin +30`, `2 polls`, `run_in_background`, `.exit`, `rmdir <L>`, with `indexOf('sdd-husky.lock') < indexOf('pnpm exec husky')`. Hook-setup contains `no commits`, `ignore git-protocol item 6`, `skip item 1's DETECTION sentence`.
   - AC-39 (extension): add the AC-35 hook-setup prompt to block 13's loop.
   - AC-41: in `after(setupPrompt, 'ledger-guard.py')`: contains `git add -- docs/roadmap/ledger/`; `indexOf('git diff --quiet') < indexOf('--amend')`; contains `! git diff --cached --quiet` and `nothing to amend`.
5. RED (before Step 7): block 1 fails on `halted.record` (today's halt `:166-174` has none); name `AC-3` in the first new assertion so the RED cites it.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
```
Expected (after Step 7): every block prints its line and `ALL sdd-batch-execute tests passed`; `# fail 0`; context-map OK.

---

### Step 7 — service: schemas, preflight, Gate block, TOOLING_HOOK, setupTask, hook-setup (FR-2..FR-5)

**Status**: `pending`
**Service**: `.claude/workflows` (SDD tooling)
**Files**:
- `.claude/workflows/sdd-batch-execute.js` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Schemas: `PREFLIGHT` `sdd-batch-execute.js:47-63` (required list `:62`), `WRITE` `:72-76`, `PR` `:99-103`; `toUnits` starts `:106`.
- Preflight prompt `:141-149` (items 1–7 `:142-148`; PR lookup via ToolSearch `:147`; promotion-plan fence `:148`).
- Open-PR short-circuit `:150-153` is kept; `WR`/`ctx` `:154-155` kept; Gate region to replace `:156-181` (`let pending` `:156`, `blockedStep` `:157`, `const resuming = !!ap` `:160`, validate `:163` with `-X ours` (kept, out of scope, `product-spec.md` Out of Scope), upfront halt `:165-176`, tooling block `:177`, setup `:178-180`).
- `approvals()`/`proceeds()`/`ap`: `:119-121`, `:138`, `:139` (reused as-is).
- Step-loop `stop here` line to delete: `:191` `if (aps.some((x) => x.decision === 'stop here')) { out.stage = 'stopped'; return out }`; `:188-190` and `:198` stay (D19).
- Fence pattern reused for `sdd-batch-setup`: promotion-plan fence written `:240`, read `:148`, schema `:60` (recon § Patterns to REUSE).
- Resolver protocol to mirror: `merge-train.js:107-111` (`--no-commit` merge, resolver, abort on exit 2, abort on hook failure); resolver exits `scripts/merge-train-resolve.mjs:145,148`; ledger-guard `--fix` precondition and unstaged write `scripts/ledger-guard.py` (recon: `:55-58`, `:87`).
- PR lookup retry precedent "re-read once after ~10 s": `merge-train.js:98`.
- `--frozen-lockfile` is what CI runs (recon: `sequential-mode.md:239`).

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Constants** (after Step 5's constants, before `const STEP`): `HEX` and `canon` exactly as `design.md` §1.2, and `const CONTEXT_MAX = <spike.context-max from Step 1>` (default `65536`).
2. **Schemas** (design §1.2): add `mainDevSha`, `devSha`, `specHash`, `contextBytes`, `workflowSetup` (`{type:'string'}`) and `hookLive` (`{type:'boolean'}`) to `PREFLIGHT.properties` and to its `required` array (`:62`); add `SETUP` and `HOOKSETUP` immediately after `WRITE` (`:76`).
3. **TOOLING_HOOK** (template literal, design §1.2) after `PR` (`:103`) and before `toUnits` (`:106`). It interpolates `MAINWT`, `HOOK_CHECK`, `ENV_REMEDY`, which are declared earlier (IR-1 TDZ rule).
4. **setupTask** (design §1.6) as a new function directly after `writerRules`. Keep the fence's three lines at column 0 in the source.
5. **Preflight prompt**: replace the `:141-149` prompt text with design §1.4 (13 items), keeping `agentType: CHECKER` from Step 3.
6. **Gate**: replace `:156-181` with design §1.5 verbatim (from `let pending` through the closing `}` of `if (pending.length && !resuming)`), with `agentType: CHECKER` on validate, `agentType: WRITER` on setup and hook-setup, `schema: SETUP` on setup and `schema: HOOKSETUP` on hook-setup. Delete the old `const resuming = !!ap` (`:160`); `ap` itself (`:139`) stays.
7. **Step loop**: delete `:191` (the `stop here` return now lives in the Gate block). Leave `:188-190`, the `:197` prompt and `:198` unchanged.
8. If Step 1 recorded the AC-20 fallback, validate, setup and hook-setup carry no `agentType` and only preflight uses `CHECKER`.

**Verification**:
```bash
node scripts/workflow-tests/sdd-batch-execute.test.mjs && node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
grep -n "aps.some((x) => x.decision === 'stop here')" .claude/workflows/sdd-batch-execute.js
```
Expected: tests green; the grep shows exactly one hit (the Gate's `const stopping`), none in the step loop.

---

### Step 8 — test: step prompt — scoped reads, verification protocol, wiring gate (AC-14, AC-15, AC-23, AC-32, AC-33, AC-42)

**Status**: `pending`
**Service**: `scripts/workflow-tests` (SDD tooling)
**Files**:
- `scripts/workflow-tests/sdd-batch-execute.test.mjs` — modify

**Reviewers**: Platform Lead — Cross-cutting SDD tooling: workflow gate semantics (P-01/P-04/F-10), agent registry (`.claude/agents/`, `.claude/context-map.yaml`), `docs/patterns/context-engineering.md` §4 contract

**Codebase Evidence**:
- Today's step prompt reads `SKILL.md §PER-STEP EXECUTION, reference/sequential-mode.md (§5.5, verification fallbacks), reference/tdd-gate.md and reference/tooling-setup.md` (`sdd-batch-execute.js:197`) — no `## HARD CONSTRAINTS`, `## Deviation Log`, `context.md IN FULL`, `mktemp` or `exit=` text, so the new assertions fail first.
- Discover prompt `:196` carries no `Tree:` stamp (`codebase-discovery.md:23-25` then writes `Checkout: UNSTAMPED`).
- Wiring gate text the VERIFY clause mirrors: `.claude/skills/sdd-execute/SKILL.md:310-317` (step-time, "A non-zero exit keeps the step not-done", "PENDING: … do not block") and `:323-325` (`--final`); red-N/A wording `.claude/skills/sdd-execute/reference/tdd-gate.md:56`.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: `AC-14, AC-15, AC-23, AC-32, AC-33, AC-42`

**Instructions**:
1. Reuse the block-12 fixture (in-progress, `workflowSetup: MD`, `checkpoint:2` proceed, `steps(2)`) and take `sp = callOf(t,'step:fix-a:s3').prompt` and `dp = callOf(t,'discover:fix-a:s3').prompt`. One block per scenario:
   - AC-14: `sp` contains `## PER-STEP EXECUTION`, `## HARD CONSTRAINTS`, `## Deviation Log`, `sequential-mode.md`, `§5.5`, `tooling-setup.md`, `repo-conventions.md`, `context.md IN FULL`.
   - AC-15: `sp` contains `') >"'`, `'2>&1; echo "exit=$?"'`, `tail -n 60`, ``no `set -o pipefail` ``, ``no `exit=` line``, `FAILED`, `Read the FULL log`, `red N/A — no behavior change; characterization test added`.
   - AC-23: `sp` contains `NEW log` and `the RED run, the GREEN run and every re-run`, `mktemp`, `git rev-parse --git-dir`, `Cite ONLY lines from this run's log`, and its `LOG=` line contains `$(cd "$(git rev-parse --git-dir)" && pwd)`.
   - AC-32: `sp` contains `the discovery digest is advisory`, `re-verify every not-found claim`, `A confirmed miss is a blocker (F-04)`, `Wherever the loaded skill text says AskUserQuestion, return result:'blocker'`, `§5.7`, `carve-outs`; `dp` does not contain `Tree:`.
   - AC-33: `sp` contains `check-config-wiring.mjs`, `--final`, `keeps the step not-done`.
   - AC-42: `sp` contains `echo "log=$LOG"`, `run_in_background`, `<LOG>.exit`, `exit=PENDING`, `540`, `lives only until this worktree is removed`.
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
- Heading anchors READ_SCOPE names (design §1.2 note, re-confirmed by `grep -n "^## \|^### "`): `SKILL.md:233` `## PER-STEP EXECUTION`, `:336` `### STEP COMMIT + PR`, `:404` `## DEVIATION HANDLING`, `:421` `## CONTEXT.MD — Per-step entry format`, `:476` `## HARD CONSTRAINTS`; `sequential-mode.md:81` `### 5.5`, `:162` `### 5.7`, `:186` `## Sequential-mode carve-outs`, `:207` `## Sequential-mode verification fallbacks`; spec step heading `### Step N —` (`.claude/skills/sdd-spec/reference/spec-template.md:28`).
- AskUserQuestion sites the READ_SCOPE sentence covers: `sequential-mode.md:165`, `tooling-setup.md:74`, `atomic-units.md:37`, `deviation-handling.md:57` (grep).
- Placement anchor: after `PR` (`:99-103`) and after Step 7's `TOOLING_HOOK`, before `toUnits` (`:106`).

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `READ_SCOPE` and `VERIFY` exactly as in `design.md` §1.2 (template literals with no interpolation; every literal backtick escaped `` \` ``; no shell `${`), after `TOOLING_HOOK` and before `toUnits`.
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
- Today `:241` `if (wp) out.commits.push(...wp.commits)` then halts at promotion (`:242-243`) whatever the writer did; `:246-249` marks `done` with any `pr.url`, empty included.
- `replies()` integration-pr fixture `sdd-batch-execute.test.mjs:21` `{ url: 'https://pr/1', commits: ['c-pr'] }` (no `notes`); block 4 `:54-58` and block 5 `:59-64` fixtures reach write-plan and integration-pr.

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: `AC-43, AC-44`

**Instructions**:
1. `replies()` `'integration-pr:'` gains `notes: []`.
2. AC-43 block: block-4 fixture (`status: 'code-completed', steps: steps(3)`, `checkpoint:3` proceed) with `'write-plan:'` → `{commits:[], notes:['pre-commit hook inert (hook-fail=hooksPath)']}` → `blocked` matches `/write-plan made no commit/`, `halted === null`; with `'write-plan:'` → `null` → `blocked` matches `/write-plan made no commit: writer died/`.
3. AC-44 block: block-5 fixture (promotion proceed, `promotionPlan: 'PLAN'`) with `'integration-pr:'` → `{url:'', commits:[], notes:['pre-commit hook inert (hook-fail=h)']}` → `blocked` matches `/integration-pr incomplete: pre-commit hook inert/` and `stage !== 'done'`; `{url:'', commits:[], notes:[]}` → `/integration-pr incomplete: no PR url/`; `{url:'https://github.com/o/r/pull/1', commits:[], notes:['plan already applied at the dev-branch tip']}` → `stage === 'done'`, `prUrl === 'https://github.com/o/r/pull/1'`; and the integration-pr prompt contains `Open the PR only if the promotion commit is pushed now`.
4. RED (before Step 11): the AC-43 block fails because the run halts at `promotion` instead of blocking; name `AC-43` in the message.

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
- `.claude/skills/sdd-execute/SKILL.md:291` `### PHASE 3: Execution`; `:301` "3. Run the step's `**Verification**` command. Report the exact output. (For a code-bearing step this is the green run of the TDD gate.)"; next heading `:336`.
- `docs/patterns/context-engineering.md:170` the `/sdd-batch-execute` row; its last cell today: "the up-front confirm · every smart checkpoint (default) · every blocker · merge-order · the promotion confirm". §4 spans `:153` to `## How the three compose` `:230`.
- `.claude/agents/context-distiller.md:51-52` (rubric tail) and `.claude/skills/sdd-distill/SKILL.md:108` (WRITE item 3) contain no `sdd-batch-` text (grep → no hits).
- `.claude/context-map.yaml:15` header and the Step 3 entries.
- CI's checkout is shallow (`.github/workflows/ci.yml:871` `actions/checkout@v7`, no `fetch-depth`), so the test file must not read `origin/main-dev`; the AC-16 HARD CONSTRAINTS byte-identity runs in Step 15's Verification instead.

**Lands with**: `Step 13, Step 14, Step 15`

**TDD**: `red-green required`

**Covers**: `AC-16, AC-19, AC-27`

**Instructions**:
1. AC-19 block: read `SKILL.md`; take the text from `### PHASE 3: Execution` to the next `### `; assert it contains ``Report the cited output lines, the `exit=` line and the log path (full log on request)`` and does not contain `Report the exact output`.
2. AC-27 block: read `context-distiller.md` and `sdd-distill/SKILL.md`; both contain `sdd-batch-`, `byte-for-byte` and `in original order`; `context-distiller.md` contains `Never mark a whole session keep-verbatim only because it holds a fence`.
3. AC-16 block: read `context-engineering.md`; take §4 (from `## 4. Saved workflows` to `## How the three compose`); it contains `record`, `{gate:'resume'`, `{gate:'distill'`, `sdd-batch-setup`, `not resumeFromRunId`, `sdd-batch-writer`, `sdd-batch-checker`; the line starting ``| `/sdd-batch-execute` `` has a last cell (`split('|')`, last non-empty) containing `resume gate`, `distill gate` and `re-halts`. Read `.claude/context-map.yaml`: contains `name: sdd-batch-writer` and `name: sdd-batch-checker`.
4. RED (before Steps 13–15): the AC-19 block fails on the new wording; name `AC-19` in the message.

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
- `:302-317` (no-database rule, config-key wiring gate) and `## HARD CONSTRAINTS` `:476-518` must not change (business rules `@AC-4/@AC-5/@AC-10 @feature-278`, `docs/sdd/business-rules/platform.feature`; FR-8).

**Lands with**: `Step 12, Step 14, Step 15`

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Replace line 301 with the `design.md` §1.9 text exactly: "3. Run the step's `**Verification**` command. Report the cited output lines, the `exit=` line and the log path (full log on request); `exit=<n>` is the command's exit status, and with no log file the path is `none`. (For a code-bearing step this is the green run of the TDD gate.)" Change no other line.

**Verification**:
```bash
git diff --unified=0 origin/main-dev -- .claude/skills/sdd-execute/SKILL.md | grep -c '^[-+][^-+]'
grep -n "Report the cited output lines" .claude/skills/sdd-execute/SKILL.md
```
Expected: `2` (one removed, one added line); the grep shows line 301.

---

### Step 14 — docs: distill keeps every sdd-batch-* fence verbatim (FR-8, D8)

**Status**: `pending`
**Service**: `.claude/agents` (SDD tooling)
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
- `docs/patterns/context-engineering.md:167` `| Workflow | Runs | Stops at |`; `:170` the `/sdd-batch-execute` row; `:180-186` the `approvals` bullet ending "the approved C-16 plan in a `sdd-batch-promotion-plan` block."; `:213-221` Operational notes ending "launch from an up-to-date checkout." (`:221`); `:35` read-only default.
- `.claude/context-map.yaml:15` `# --- Subagent fleet: isolated read-only windows that return condensed digests ---`.
- AC-16 byte-identity baseline: `## HARD CONSTRAINTS` `SKILL.md:476` to `## REPO CONVENTIONS` `:519`.

**Lands with**: `Step 12, Step 13, Step 14`

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Replace the last cell of the `:170` row with the `design.md` §1.11 Stops-at text verbatim.
2. Insert the §1.11 contract bullet as a new `- ` bullet directly after the `approvals` bullet (after `:186`), then the §1.11 roles bullet directly after it.
3. Append the §1.11 operational-note sentence to the Operational notes paragraph, after "launch from an up-to-date checkout." (`:221`).
4. Replace the `.claude/context-map.yaml:15` header with the §1.11 text.

**Verification**:
```bash
node --test scripts/workflow-tests/*.test.mjs && ./scripts/check-context-map.sh
diff <(git show origin/main-dev:.claude/skills/sdd-execute/SKILL.md | sed -n '/^## HARD CONSTRAINTS/,/^## REPO CONVENTIONS/p') <(sed -n '/^## HARD CONSTRAINTS/,/^## REPO CONVENTIONS/p' .claude/skills/sdd-execute/SKILL.md) && echo hard-constraints-identical
```
Expected: `# fail 0`; `OK - all context-map and doc references resolve.`; `hard-constraints-identical`.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
