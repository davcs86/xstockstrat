# Design: batch-execute-token-reduction

**Created**: 2026-11-06
**Rounds**: 7 (full; 5-round cap waived by the operator, D16; termination: approved). Amended after the PR-0 spikes: 3 quick rounds (D23–D27), and again after the spike-close run 1: 1 quick round (D29–D30); termination: approved
**Approved by**: user @ 2026-11-06; amendment approved by user @ 2026-11-08 (D27); second amendment approved @ 2026-11-09 (D30)
**Grounded in**: recon.md

---

## Chosen Approach

Consumer surface: **none**. This is internal SDD tooling, used by the operator through the `/sdd-batch-execute` saved workflow (C-14, product-spec Consumer Surface). Decisions D1–D29 in `context.md` apply throughout. D29: the hook check is a list of plain single commands, one Bash call each, and AC-48 is re-scoped to the absolute `core.hooksPath` form that isolated worktree creation leaves. D23 supersedes D10, D13 and the hook-setup grant in D15: no workflow agent installs Node packages, installs or repairs the hook, writes `core.hooksPath`, or writes a file under the main checkout itself (git's own object/ref writes from commands run in a worktree are expected). D24 keeps the absolute-hooksPath arm untightened. D25 keeps the `.husky/_` link unconditionally. D26: writers never run a Node package install; a missing package is a blocker with a main-session remedy.

The change edits one script (`.claude/workflows/sdd-batch-execute.js`), adds two workflow-internal agent types, makes a few edits to contract text, and extends one test file. No runtime service, proto, migration or config key changes.

### 1.0 Implementation rules (binding on every snippet below)

- **IR-1, escaping.** Every prompt constant and prompt function body is a JS **template literal**, except the plain strings below:
  - `MAINWT`, `ENV_REMEDY`, `HOOK_REMEDY`, `EXCLUDE_REMEDY` and every field of every `HOOK_STEPS` entry are **plain single-quoted strings**. `HOOK_CHECK` is the one template literal rendered from `HOOK_STEPS` (D29). A substituted value is not re-parsed, and since D29 no hook string contains a shell `${`. All of them are declared after `FOLD` (`:29`), before `hookMsg`, `hookBlocked` and every function that interpolates them.
  - Inside a template literal, a shell `${` must be written `\${` and a literal backtick must be written `` \` ``. `${…}` appears only where JS interpolation is intended.
  - None of the template literals below contains a shell `${` written as JS interpolation. Shell text inside them uses only `$VAR`, `$(…)` and `$?`; the guard allows these, but never a `{ …; }` brace group (D29).
  - Every literal backtick is already shown escaped as `` \` ``. The existing code uses the same convention (`sdd-batch-execute.js:125-126`).
- **IR-2, simple calls inside the worktree (D23; measured in `wf_3f24944b-f87`, recon § Amendment recon).** A worktree-isolated agent's guard refuses `git -C <M>`, `cd <M>`, and redirects or subshells that write under `<M>/.git`.
  - Every writer prompt therefore runs each command as its own Bash call from the worktree root. A simple `a && b` that stays inside the worktree is allowed (measured).
  - The guard refuses, as "too complex to verify", a call that contains a `{ …; }` brace group. In `wf_3ce0d1f3-477`, the only two refused calls were the one-line `HOOK_CHECK` and the grouped `.husky/_` link line, and both contain brace groups. That run also allowed `$(seq 1 108)` in the VERIFY poll loop, a `;`-chain with `${HUSKY-unset}`, a pipe (`MAINWT`), and `[ -e … ] || ln -s …` (recon § "Amendment recon 2", as corrected). The hook check and the `.husky/_` link are therefore split into plain single commands, and no writer-prompt command uses a brace group.
  - Shell variables do not survive between calls, so a value that one call prints (`<M>`) is substituted literally into later calls.
  - The only touches of `<M>` are read-only: tests, `ls -d`, `node <M>/scripts/*.mjs`, `ln -s <M>/… <relative path>`, and `HOOK_CHECK`'s read of the shared `info/exclude`.
  - No worktree agent writes a file under `<M>` itself, directly or through a link (redirects, `ln` targets, installs). Git's own object and ref writes, from commands run in the worktree, land in the shared common dir and are expected (D23 consequence 1).
  - In particular, no writer runs a Node package install. The worktree's `node_modules` and `services/*/node_modules` are links into `<M>` (writerRules item 2; D26).
  - The guard cannot see a write through a link, so the prompt rule is the only control.
  - Preflight is not isolated: it runs in the main checkout and needs none of this.
- **IR-3 (retired, D23).** There is no heredoc. Commit messages and verification wrappers are written with the Write tool under `.sdd-logs/`.
- **IR-4, test strings.** Test-file assertions that contain a shell `${` use single-quoted JS strings. Since D29 the only such assertions are the negative checks for the retired one-liner, such as `${H%/_}`.

### 1.1 Agents (FR-1)

Both agents use the frontmatter shape of `.claude/agents/codebase-discovery.md:1-6` and the rules/method/output body shape of `docs/patterns/context-engineering.md:40-43`. Both are pinned to opus (D6, `context-engineering.md:51`).

**`.claude/agents/sdd-batch-checker.md`**
```
---
name: sdd-batch-checker
description: Workflow-internal — read-only checker for /sdd-batch-execute preflight and validate (branch shas, sizes, open PR, hook liveness, Codebase-Evidence re-runs). Never select via Task.
tools: Bash, Read, Glob, Grep, ToolSearch, mcp__github__list_pull_requests
model: opus
---
```
Body:
- "spawned only by .claude/workflows/sdd-batch-execute.js; never delegate from a skill session."
- Rules:
  - Read-only. Use Bash for git reads only. The only exceptions are local checkout/merge operations that the prompt names inside your own worktree.
  - Never commit, push, edit a file or change git config.
  - The prompt's numbered protocol binds.
  - The JSON schema is your output.
  - Report what you could not determine as a `problems` entry; never guess (P-03).

**`.claude/agents/sdd-batch-writer.md`**
```
---
name: sdd-batch-writer
description: Workflow-internal — the single writer for one /sdd-batch-execute stage (setup, step, write-plan) in its own worktree. Never select via Task.
tools: Bash, Read, Edit, Write, Glob, Grep
model: opus
---
```
Body:
- The same AC-2 literal sentence.
- "The prompt's git protocol and numbered items bind; return exactly the JSON schema; never use --no-verify; never push anywhere but the named dev branch."

**Wiring:**
- `agentType: CHECKER` on preflight and validate.
- `agentType: WRITER` on setup, step and write-plan.
- Unchanged: integration-pr keeps the default type (`:245`), discover keeps `codebase-discovery` (`:196`) and promotion-plan keeps `scenario-promoter` (`:238`).

### 1.2 Constants and schemas (extend `:47-103`; placement below)

Placement (load order, m-D):
- `HEX`, `CONTEXT_MAX`, `CHECKER`, `WRITER`, `canon`, `MAINWT`, `HOOK_STEPS`, `HOOK_CHECK`, `ENV_REMEDY`, `HOOK_REMEDY`, `EXCLUDE_REMEDY`, `hookMsg` and `hookBlocked` go after `:29` (`FOLD`), in that order.
- `SETUP` goes after `WRITE` (`:72-76`), because it reads `WRITE.properties`.
- `PR` is extended in place (`:99-103`).
- `READ_SCOPE` and `VERIFY` go after `PR` and before `toUnits` (`:106`).

```js
const HEX = /^[0-9a-f]{40}$/
const CONTEXT_MAX = 65536
const CHECKER = 'sdd-batch-checker'
const WRITER = 'sdd-batch-writer'
const canon = (a) => JSON.stringify([].concat(a || []).map(Number).sort((x, y) => x - y))
// plain string (IR-1); prints the main checkout path, used literally as <M> (IR-2)
const MAINWT = 'git worktree list --porcelain | sed -n \'1s/^worktree //p\''
// plain strings (IR-1); one simple command per step, no $( ), case, ${…} or { …; } (D29); <H>, <B>, <C> are values earlier steps printed
const HOOK_STEPS = [
  { clause: 'HUSKY', cmd: 'printenv HUSKY', passWhen: 'it does not print exactly 0 (an unset HUSKY prints nothing and exits 1, which passes)' },
  { clause: 'pnpm', cmd: 'command -v pnpm', passWhen: 'exit 0' },
  { clause: 'hooksPath', cmd: 'git config core.hooksPath', passWhen: 'it prints exactly .husky/_ or one absolute path ending in /.husky/_ (that printed value is <H>)' },
  { clause: 'h', cmd: 'test -f "<H>/pre-commit"', passWhen: 'exit 0' },
  { clause: 'h', cmd: 'test -f "<H>/h"', passWhen: 'exit 0' },
  { clause: 'pre-commit', cmd: 'test -f "<B>/pre-commit"', passWhen: 'exit 0 (<B> is <H> without its final /_)' },
  { clause: 'exclude', cmd: 'git rev-parse --git-common-dir', passWhen: 'exit 0 (the printed path is <C>)' },
  { clause: 'exclude', cmd: 'grep -qxF -- /node_modules "<C>/info/exclude"', passWhen: 'exit 0' },
  { clause: 'exclude', cmd: 'grep -qxF -- \'/services/*/node_modules\' "<C>/info/exclude"', passWhen: 'exit 0' },
  { clause: 'exclude', cmd: 'grep -qxF -- /.husky/_ "<C>/info/exclude"', passWhen: 'exit 0' },
  { clause: 'exclude', cmd: 'grep -qxF -- /.sdd-logs "<C>/info/exclude"', passWhen: 'exit 0' },
]
// the one rendering of HOOK_STEPS, interpolated by writerRules item 2 and preflight item 13 (D15)
const HOOK_CHECK = `Hook check (read-only), from the checkout under test: run each numbered command as its own Bash call, in order, with the literal value an earlier command printed in place of <H>, <B> and <C>. Stop at the first command that fails its pass condition: the result is its hook-fail=<clause>. A refused call ends the check with hook-fail=unknown. When all pass, the result is hook=0.
${HOOK_STEPS.map((s, i) => `   ${i + 1}) ${s.cmd} — pass: ${s.passWhen}. Else hook-fail=${s.clause}.`).join('\n')}`
// plain string (IR-1); the HUSKY/pnpm remedy for preflight's block and every writer (m-I)
const ENV_REMEDY = 'provision pnpm 9.15.9 (npm install -g pnpm@9.15.9) or unset HUSKY in the launching environment, then re-send the same approvals'
// plain string (IR-1); hook clauses: provisioning is the operator's or main session's, never a workflow agent's (D23)
const HOOK_REMEDY = 'from the main session (never a workflow agent) run pnpm install --frozen-lockfile in the main checkout, which wires core.hooksPath through husky prepare; check that git config core.hooksPath prints .husky/_ or an absolute path ending in /.husky/_; then re-send the same approvals'
// plain string (IR-1); interpolated into writer prompts, so it holds no ${ and no printf (AC-26)
const EXCLUDE_REMEDY = 'from the main session (never a workflow agent), at the main checkout root, run X="$(git rev-parse --git-common-dir)/info/exclude"; for L in /node_modules \'/services/*/node_modules\' /.husky/_ /.sdd-logs; do grep -qxF -- "$L" "$X" || echo "$L" >> "$X"; done — then re-send the same approvals'
// the one clause-to-message map, shared by the Gate and writerRules item 2 (C-18)
const hookMsg = (c, where) => `${c === 'exclude' ? 'commit precondition unmet' : 'pre-commit hook inert'} in ${where} (hook-fail=${c}) — ${c === 'exclude' ? EXCLUDE_REMEDY : c === 'HUSKY' || c === 'pnpm' ? ENV_REMEDY : HOOK_REMEDY}`
const hookBlocked = (raw) => { const c = String(raw == null ? '' : raw).trim().replace(/^hook-fail=/, ''); return c ? hookMsg(c, 'the main checkout') : '' }
```
- Each step is one simple command. The agent decides its pass condition from the printed output and the exit code the tool reports (D29). The first failing step names its clause, in the old order (HUSKY, pnpm, hooksPath, h, pre-commit, exclude), so `hookMsg` and `hookBlocked` are unchanged.
  - `<H>` and `<C>` are the literal values that earlier steps printed. `<B>` is `<H>` without its final `/_`, worked out as text by the agent (no `${H%/_}`).
  - Exclude uses four exact `grep -qxF` calls, not one `grep -c`. With a count, a duplicated line can stand in for a missing one; each `grep -qxF` exit code decides one line by itself.
- Both `core.hooksPath` forms pass (recon § Amendment recon). Under workflow isolation, writers see only the absolute form: isolated worktree creation leaves the shared value absolute. This is inferred from timing (recon § "Amendment recon 2"; D29).
  - For both, git executes `$H/pre-commit`, which is the husky wrapper that sources `$H/h` (`.husky/_/pre-commit:2`).
  - `h:3-6` then runs `dirname($H)/pre-commit`.
  - `h:6` exits 0 silently when that body is missing.
  - **Relative `.husky/_`** (husky 9 `prepare`, `package.json:7,12`) resolves against the cwd. A worktree reaches it only through the `.husky/_` link (writerRules item 2), and `h` runs `./.husky/pre-commit`, which is the branch's own tracked body.
  - **Absolute `<X>/.husky/_`**: `h` runs `<X>/.husky/pre-commit`. The only value observed is `<X>` = `<M>` (`context.md:251`), which is the main checkout's working-tree copy for every worktree. Any other absolute `<X>` whose `h` and `pre-commit` exist is also accepted (Open Risk 16; D24 keeps this untightened).
  - Clause `h` tests both `$H/pre-commit` and `$H/h` (m4). Suppose the wrapper is missing but `h` is present: a check on `h` alone would pass, and git would then commit with no hook. Clause `pre-commit` tests `<B>/pre-commit` (`<B>` = `<H>` without its final `/_`), the body that `h` runs. Together the two clauses cover the three files that git and `h` use, for either form.
  - `h:16` puts the cwd's `node_modules/.bin` on `PATH`, so the `node_modules` links stay for both forms.
- **The `.husky/_` link is made whatever the current form.** This is D25, an operator-approved exception to D23 consequence 4. The evidence is measured, not assumed:
  - **A missing hooks dir is a silent skip.** Orchestrator scratch repo, 2026-11-08: `core.hooksPath=.husky/_` with no such dir → exit 0, no hook, no warning (`context.md:312`). It is not re-confirmed in a linked worktree, because the relative form cannot be reproduced under workflow isolation (D29).
  - **The relative form has a known writer.** Husky `prepare` (`package.json:7`) writes it whenever `pnpm install` runs in the main checkout (`context.md:250-251,315`), and that install is the operator's own remedy (`HOOK_REMEDY`).
  - **The form also changes during a run.** It changed from relative to absolute within one session (`context.md:251`). The writer is now inferred to be isolated worktree creation (recon § "Amendment recon 2"; `context.md:402`), and an operator `pnpm install` in the main checkout writes the relative form back. So "absolute now" does not hold for a writer's whole run.
  - **The link is inert under the absolute form, and so inert under workflow isolation (D29).** With the link present, the hook fired on all three re-spike commits (`context.md:260,266`).
    - It costs three plain calls.
    - It is the only cover for a flip to relative after a writer's worktree exists, for example an operator `pnpm install` in the main checkout during a `pipeline` run.
    - It also covers the case where the timing inference about the writer is wrong.
- **Clause `exclude`.** The four root-anchored `info/exclude` lines are part of the precondition, because no workflow agent writes a file under the main checkout (D23 consequence 1).
  - `git rev-parse --git-common-dir` prints `.git` in the main checkout and the absolute common dir in a linked worktree. Both reach the one shared file, and the clause only reads it.
  - All four lines are present in this container (`.git/info/exclude:7-10`).
- The workflow never writes `core.hooksPath`. The absolute form's writer is inferred to be isolated worktree creation but has not been observed (recon § "Amendment recon 2"), so the check accepts both forms rather than rewriting either.

Schemas:
- **PREFLIGHT** (`:47-62`) gains these properties, all added to `required`:
  - `mainDevSha`, `devSha`, `specHash`, `contextBytes`, `workflowSetup`: `{type:'string'}`
  - `hookFail`: `{type:'string'}` — `""` when the hook check passes in the main checkout, else its failing clause (D15, D23)
- **SETUP** is new:
  ```js
  const SETUP = { type: 'object', properties: Object.assign({}, WRITE.properties, { tooling_blockers: { type: 'array', items: { type: 'string' } }, stale: { type: 'boolean' }, completed: { type: 'boolean' } }), required: WRITE.required.concat(['tooling_blockers', 'stale', 'completed']) }
  ```
- **HOOKSETUP**: retired with the hook-setup stage (D23).
- **PR** (`:99-103`) gains `notes: {type:'array', items:{type:'string'}}`, which is required.

**TOOLING_HOOK**: retired (D23). Setup item 1 is now inline in `setupTask` (§1.6). The live hook and the four `info/exclude` lines are an operator or main-session precondition: preflight item 13 checks them (§1.4) and the Gate enforces them (§1.5).

**READ_SCOPE** (template literal, no interpolation; FR-6):
```js
const READ_SCOPE = `Read ONLY the following; a section runs from its heading to the next heading of the same or higher level (locate with grep -n):
- .claude/skills/sdd-execute/SKILL.md: "## PER-STEP EXECUTION" (skip its "### STEP COMMIT + PR" subsection; PHASE 3's config-key wiring gate stays in scope), "## DEVIATION HANDLING", "## CONTEXT.MD — Per-step entry format" and "## HARD CONSTRAINTS".
- .claude/skills/sdd-execute/reference/sequential-mode.md: §5.5, §5.7, "## Sequential-mode carve-outs" and "## Sequential-mode verification fallbacks".
- reference/tdd-gate.md and reference/tooling-setup.md in full (install only what this step needs, pinned; git-protocol item 2 overrides tooling-setup.md's Node install instructions (its §2 row and §3): never a Node package install; npx and pnpm dlx stay allowed).
- reference/repo-conventions.md only when the step touches its areas; reference/atomic-units.md only for an atomic unit; reference/deviation-handling.md only when a deviation arises.
- This feature's implementation-spec.md: the preamble (line 1 up to the first "### Step"), your own step(s) and "## Deviation Log".
- This feature's context.md IN FULL (C-02).
Wherever the loaded skill text says AskUserQuestion, return result:'blocker' with the question and A/B/C options instead.
Note that the discovery digest is advisory (read from the main checkout): re-verify every not-found claim and every path:line you act on at origin/<dev branch> in your worktree. A confirmed miss is a blocker (F-04).`
```
- Heading anchors checked: `SKILL.md:233,336,404,421,476`; `sequential-mode.md:81,162,186,207`; spec step heading `### Step N —` at `spec-template.md:28`.
- The AskUserQuestion sentence covers `sequential-mode.md:165`, `tooling-setup.md:74`, `atomic-units.md:37` and `deviation-handling.md:57`.

**VERIFY** (template literal, no interpolation; FR-7, D5):
```js
const VERIFY = `VERIFICATION protocol (judgment unchanged). Number your verification runs K = 1, 2, … in this agent: the RED run, the GREEN run and every re-run each get a NEW K and so a NEW log; never reuse a K. For each run, first write with the Write tool .sdd-logs/run-<K>.sh holding exactly these two lines, with the step's Verification block in place of <fence> (it may span lines inside the parentheses). Run the block verbatim, once; insert nothing; no \`set -e\`, no \`set -o pipefail\`:
( <fence> ) >.sdd-logs/v-<K>.log 2>&1
echo "exit=$?" >.sdd-logs/v-<K>.exit
- If it can finish within 540 s: ONE Bash call with timeout 600000: bash .sdd-logs/run-<K>.sh; cat .sdd-logs/v-<K>.exit
- Otherwise (a suite or build that may run longer), start bash .sdd-logs/run-<K>.sh with run_in_background,
  and poll, each ONE Bash call of at most 540 s: for i in $(seq 1 108); do [ -f .sdd-logs/v-<K>.exit ] && break; sleep 5; done; cat .sdd-logs/v-<K>.exit 2>/dev/null || echo "exit=PENDING"
  Re-poll on exit=PENDING, up to 6 polls; after that the run FAILED (timeout). A foreground call that times out is FAILED; re-run it in the background form with a NEW K.
A finished run with no \`exit=\` line is FAILED. Then read: grep -nE 'FAIL|Error|error:|panic|Traceback|not ok|AssertionError' .sdd-logs/v-<K>.log | head -n 40; tail -n 60 .sdd-logs/v-<K>.log. Read the FULL log on a non-zero exit, on any expectation you cannot confirm, or on surprising output. Judge exactly as SKILL.md PHASE 3: RED fails for the right reason, or "red N/A — no behavior change; characterization test added"; GREEN cites the executed count and the coverage line. Cite ONLY lines from this run's log; put the cited lines, the exit= line and the log path into red/green. The log lives only until this worktree is removed, so no later "full log" exists.
Config-key wiring gate (C-16): when SKILL.md PHASE 3's config-key wiring gate applies, node scripts/check-config-wiring.mjs (step-time) and, on the feature's last step, node scripts/check-config-wiring.mjs --final are separate commands from the Verification block. Run each the same way, with its own NEW log and exit= line. A non-zero exit keeps the step not-done; quote its finding and key lines. PENDING: findings do not block at step time.`
```
The red-N/A wording matches `tdd-gate.md:56`. The wiring-gate wording matches `SKILL.md:310-317,323-325`.

### 1.3 writerRules (replaces `:123-133`)

```js
function writerRules(f, p) {
  return `You are executing /sdd-execute ${f.slug} sequential for feature ${p.dir} (docs/roadmap/features/${p.dir}/), dev branch ${p.devBranch}. You run in your own git worktree and are the only writer for this unit of work (P-01). Shell variables do not survive between Bash calls, and you may never cd into or git -C the main checkout <M>, or write a file under it yourself (git-protocol item 2): run each line below as its own Bash call from your worktree root and substitute the literal values earlier calls printed. Mandatory git protocol:
1. \`git fetch origin\` then \`git checkout --detach origin/${p.devBranch}\`. Never check out a named local branch.
2. Hook wiring before any commit. Run each command line below as its own Bash call, in order (every line is idempotent); the indented lines and the hook-check header are instructions, not commands. <M> is the literal path the first call prints:
${MAINWT}
mkdir -p .sdd-logs
[ -e node_modules ] || ln -s "<M>/node_modules" node_modules
ls -d "<M>"/services/*/node_modules
   For each printed <M>/services/<s>/node_modules, ONE call: [ -e services/<s>/node_modules ] || ln -s "<M>/services/<s>/node_modules" services/<s>/node_modules
test -e .husky/_
   Only if that exits non-zero, run test -d "<M>/.husky/_" as ONE call, and only if that exits 0, run ln -s "<M>/.husky/_" .husky/_ as ONE call.
${HOOK_CHECK}
   Never cd into <M>, never point git at <M> with -C, and never write a file under <M> yourself, directly or through a link (redirects, ln targets, installs); git's own object/ref writes from commands run in your worktree are expected. The links, .sdd-logs/ and the non-Node install outputs below are your only untracked writes. Never run pnpm install (or any Node package install) anywhere in this worktree, the root and services/<s> included: the linked node_modules are the main checkout's. This binds over reference/tooling-setup.md and over a step's Verification block; a Verification block that runs a Node package install is a spec deviation (blocker) and is never run. A missing Node package is a blocker: 'main-checkout node_modules lacks <pkg> — from the main session run pnpm install --frozen-lockfile in the main checkout, then re-send the same approvals'. If the step changes a package.json dependency or pnpm-lock.yaml, or \`! git diff --quiet origin/main-dev -- pnpm-lock.yaml\` (this branch changed the lockfile), the blocker is instead 'Node dependency change that only this branch adds — run this step with /sdd-execute outside /sdd-batch-execute'. Never edit pnpm-lock.yaml by hand. npx <pkg> and pnpm dlx are not installs here and stay allowed: they write only the caches under $HOME, never the linked node_modules. Non-Node per-step installs that tooling-setup.md names stay allowed, pinned and only what the step needs: uv sync --extra dev in services/<s> (it writes that service's own unlinked .venv in this worktree) and go mod download / go install (they write the Go caches under $HOME).
   If the hook check's result is not hook=0: never install, repair or append anything and make NO commit. <clause> is the clause of its hook-fail=<clause> result (unknown when a call was refused). A step returns result 'blocker', options [], blocker <message>; setup adds <message> to tooling_blockers and returns completed:false; any other writer returns commits [] with <message> in notes. <message> is the matching line below, with that <clause> in place of the clause shown in parentheses:
   - clause exclude: ${hookMsg('exclude', 'this worktree')}
   - clause HUSKY or pnpm: ${hookMsg('pnpm', 'this worktree')}
   - any other clause, unknown included: ${hookMsg('hooksPath', 'this worktree')}
   Never use --no-verify. A "dirty tree" means \`! git diff --quiet\` (tracked files only; the links and .sdd-logs/ are excluded and never count).
3. Make every commit in two steps. First write the message with the Write tool to .sdd-logs/msg-<N>.txt (N = 1, 2, … for each commit or amend in this agent, never reused): the subject line, a blank line, the body, and last these trailer lines, verbatim:
${A.trailer}
   Then ONE Bash call with timeout 600000 (the hook takes 18–31 s): git commit -F .sdd-logs/msg-<N>.txt > .sdd-logs/commit-<N>.log 2>&1 — the tool reports its exit code — and then two separate calls: wc -c .sdd-logs/commit-<N>.log and tail -n 20 .sdd-logs/commit-<N>.log. The pre-commit hook always prints (lint-staged and the report-only jscpd step), so a commit that exited 0 with a log under 400 bytes ran no hook: treat it as "pre-commit hook inert (hook-fail=h)", do not push that commit, make no further commit, and block or return commits [] with that note. The check is a heuristic: it catches an inert hook, not a hook that ran but printed little.
   Amend the same way, with no message file: git commit --amend --no-edit > .sdd-logs/commit-<N>.log 2>&1, then tail -n 20 .sdd-logs/commit-<N>.log. On a non-zero exit read that log in full, fix the cause and commit again with a new N. Never commit with -m or a heredoc.
4. \`git push origin HEAD:refs/heads/${p.devBranch}\` after every commit; retry up to 4 times (2s/4s/8s/16s) on network errors only. Never push elsewhere, never force-push.
5. <unchanged :130 text, "Push after EACH artifact edit … no commit before verification">
6. Return every commit sha you created, in order, as \`commits\`.
Use ${A.date} for history rows and session headers. Severity tokens: only ${p.severity} may appear. Every HARD CONSTRAINT of .claude/skills/sdd-execute/SKILL.md applies (no guessed paths/symbols, no commit before verification passes, migration immutability, never start a database).`
}
```
- Items 4–6 and the closing paraphrase are verbatim from `:129-132`. `test.mjs:43-46` still holds.
- Why the links are excluded: `.gitignore:23` `**/node_modules/` matches directories only, and a symlink is not a directory. `.husky/_` is not ignored at all. Root-anchored patterns in the common `info/exclude` cover every linked worktree. `/.sdd-logs` is excluded the same way, so message files and logs never stage. The four lines are an operator or main-session precondition, verified by `HOOK_CHECK`'s `exclude` clause; no workflow agent writes them (D23).
- **No Node package install in a writer (MAJOR-1, D26).** `node_modules` and `services/*/node_modules` are links into `<M>`, so a worktree `pnpm install` would:
  - (a) write `<M>/node_modules`, racing other features' writers under `pipeline` (`sdd-batch-execute.js:253`);
  - (b) run the root `prepare: husky` (`package.json:7`), which rewrites the shared `core.hooksPath` to the relative form;
  - (c) rewrite `<M>/.husky/_/*` through the link.

  The guard sees none of this, because every path the command names is inside the worktree. pnpm installs the whole workspace from any workspace dir (`pnpm-workspace.yaml:1-3`), so the ban covers the whole worktree. `tooling-setup.md:30,43` prescribes that install for Node steps. Item 2 overrides it, and READ_SCOPE says so.

  A missing package blocks with your main-session remedy. A step that changes a Node dependency or the lockfile (or runs on a branch that already changed `pnpm-lock.yaml` versus main-dev) can never be satisfied from the main checkout, so it blocks and goes outside the workflow (Open Risk 20). The trigger is read in the worktree (the step's own Files, and `git diff --quiet origin/main-dev -- pnpm-lock.yaml`), never from `<M>`. Writers never hand-edit `pnpm-lock.yaml`.
- **Non-Node per-step installs stay (`tooling-setup.md:28-29,43`).**
  - `uv sync --extra dev` in `services/<s>` writes that service's own `.venv`. Item 2 never links it (it links only `node_modules`), so it is a real dir in the worktree, ignored by `.gitignore:12`. `uv` runs no git-hook installer.
  - `go mod download` / `go install` write the Go module and binary caches under `$HOME`, not under `<M>`, and touch no git config.
  - Neither path reaches `<M>` or `core.hooksPath`, so neither causes (a)–(c). The shared `$HOME` caches are the one surface writers share (Assumptions).

### 1.4 Preflight (checker; replaces the `:141-149` prompt)

```js
  const p = await agent(`Read-only preflight for /sdd-execute ${f.slug} sequential. Never write, commit, push or change config. \`git fetch origin\`, then do items 1, 2, 8 and 9 first; from then on read every dev-branch file as \`git show <devSha>:<path>\`, never through a ref name:
1. Resolve the feature dir on origin/${BASE} (\`git ls-tree --name-only origin/${BASE} docs/roadmap/features/\`, dirs ending \`-${f.slug}\`): exactly one, else a problem ("slug not unique").
2. Development Branch from feature.md (default \`feature/${f.slug}\`); it must exist on origin (problem otherwise). Severity from feature.md (or "n/a").
3. status = status.md at <devSha>. It must be implementation-ready, in-progress or code-completed (problem otherwise).
4. steps: parse implementation-spec.md at <devSha>: for each numbered step its number, title, **Status** (pending/done/blocked), **Service**, and surface (xstockstrat-ui → ui, xstockstrat-agent → agent, else backend), and landsWith (the step numbers in its **Lands with** field, [] if none).
5. mergeOrderBlock: if docs/roadmap/features/merge-order.md (on origin/main-dev) lists ${f.slug} in its Feature column with Resolved != Yes, the blocking feature + reason; else "".
6. openPrUrl: call mcp__github__list_pull_requests (state open, head <owner>:<devBranch>, base main-dev; owner/repo from \`git remote get-url origin\`). If it is not callable directly, select it with ToolSearch (select:mcp__github__list_pull_requests) and call it. On a tool error wait about 10 s and retry once; if it still fails add the problem "PR lookup unavailable: <error>". Zero open PRs → "" (not a problem).
7. promotionPlan: the text of the LAST fenced block tagged \`sdd-batch-promotion-plan\` in context.md at <devSha>, else "".
8. mainDevSha = the 40-hex output of \`git rev-parse origin/main-dev\`.
9. devSha = the 40-hex output of \`git rev-parse origin/<devBranch>\`.
10. specHash = \`git rev-parse <devSha>:docs/roadmap/features/<dir>/implementation-spec.md\` (the blob sha).
11. contextBytes = \`git cat-file -s <devSha>:docs/roadmap/features/<dir>/context.md\` as a decimal string; if that command fails, the literal "unknown".
12. workflowSetup = the "mainDev" value inside the LAST fenced block tagged \`sdd-batch-setup\` in context.md at <devSha>, else "".
13. hookFail: in this checkout (the main checkout; preflight is not worktree-isolated) run the hook check below; it only reads (no cd, no git -C). hookFail = "" when its result is hook=0, else the <clause> of its hook-fail=<clause> result, or "unknown" if a call was refused or no result was reached.
${HOOK_CHECK}
ok = no problems.`, { agentType: CHECKER, phase: 'Preflight', schema: PREFLIGHT, label: `preflight:${f.slug}` })
```
- Items 1–5 and 7 are today's text (`:142-148`), with "origin/<devBranch>" replaced by "at <devSha>".
- Item 13 runs the same `HOOK_CHECK` constant in the main checkout, where the non-isolated preflight already runs (`sdd-batch-execute.js:141-149` sets no `isolation`). It needs no `cd` or `git -C`, and it cannot drift from the writers' check (D15). It covers the hook and the four exclude lines.
  - The guard does not apply here, but item 13 still renders the same `HOOK_STEPS` list as separate calls rather than a one-line form. A second spelling of one predicate is what caused the MAJOR-3 resume loop (D15).
  - The cost is about ten extra one-line Bash calls per preflight (Open Risk 22).
- The retry follows the precedent at `merge-train.js:98` ("re-read once after ~10 s").

### 1.5 Gate (replaces `:156-181`; the open-PR short-circuit at `:150-155` is unchanged)

```js
  let pending = p.steps.filter((s) => s.status !== 'done')
  const blockedStep = pending.find((s) => s.status === 'blocked')
  const pendKey = canon(pending.map((s) => s.n))
  const directive = f.directive || 'conditional'
  const stepList = (ms) => ms.map((m) => m.n).join(', ')
  const stopping = aps.some((x) => x.decision === 'stop here')

  // 0. non-hex shas are a preflight defect
  for (const k of ['mainDevSha', 'devSha', 'specHash']) {
    if (!HEX.test(p[k])) { out.blocked = `preflight: non-hex sha (${k}=${p[k]})`; return out }
  }
  const hookErr = hookBlocked(p.hookFail)
  // a stop takes precedence over every no-write gate (N1)
  if (stopping) { out.stage = 'stopped'; return out }
  const setupDone = p.status === 'in-progress' && HEX.test(p.workflowSetup)
  const resuming = setupDone && (!!ap || proceeds('resume'))
  if (pending.length) {
    // 1. distill
    if (!/^\d+$/.test(p.contextBytes)) { out.blocked = `context.md size unreadable (contextBytes: ${p.contextBytes})`; return out }
    if (Number(p.contextBytes) > CONTEXT_MAX && !proceeds('distill')) {
      out.halted = { gate: 'distill', bytes: Number(p.contextBytes), limit: CONTEXT_MAX, hook: hookErr, question: `Run /sdd-distill ${f.slug} on ${p.devBranch}, or approve {gate:'distill', decision:'proceed'} (re-send on every relaunch).` }
      return out
    }
    // 2. resume
    if (setupDone && !resuming) {
      out.halted = { gate: 'resume', hook: hookErr, question: "Workflow setup is done for this feature. Approve {gate:'resume', decision:'proceed'} (re-send on every relaunch)." }
      return out
    }
  }
  // the hook precondition (D23): block a run that commits without passing through setup (m2: not on the merge-order halt)
  const writesWithoutSetup = pending.length ? resuming : !(p.mergeOrderBlock && !proceeds('merge-order'))
  if (hookErr && writesWithoutSetup) { out.blocked = hookErr; return out }
  // 3. Gate
  if (pending.length && !resuming) {
    out.stage = 'Gate'
    const up = aps.find((x) => x.gate === 'upfront' && x.decision === 'proceed')
    const r = up && up.record
    const same = !!r && Array.isArray(r.pending) && Array.isArray(r.mismatches) && r.mainDev === p.mainDevSha && r.dev === p.devSha && r.specHash === p.specHash && r.directive === directive && canon(r.pending) === pendKey
    if (!same) {
      const v = await agent(`${ctx}\n/sdd-execute ${f.slug} sequential §5.3 re-spec gate, READ-ONLY validation (do not commit or push). In your worktree: \`git fetch origin && git checkout --detach ${p.devSha} && git merge --no-edit -X ours ${p.mainDevSha}\` (local only). For every pending step of docs/roadmap/features/${p.dir}/implementation-spec.md re-run its **Codebase Evidence** greps/ls and confirm each **Files** path exists; report mismatches per step. Also run .claude/skills/sdd-execute/reference/tooling-setup.md's DETECTION only (no installs) for the toolchains the pending steps need and report any that is unavailable with no documented fallback.`, { agentType: CHECKER, phase: 'Gate', schema: VALIDATE, isolation: 'worktree', label: `validate:${f.slug}` })
      if (!v) { out.blocked = 'validation agent died'; return out }
      const record = { mainDev: p.mainDevSha, dev: p.devSha, specHash: p.specHash, directive, pending: JSON.parse(pendKey), mismatches: v.mismatches }
      const roll = p.status === 'in-progress' ? ' This feature is in-progress without a finished workflow setup (set up by hand, by a pre-301 workflow, or a prior workflow setup did not finish); approving re-runs setup, and every item already done is skipped.' : ''
      const none = directive === 'none' && v.mismatches.length ? ` Directive none: steps ${stepList(v.mismatches)} mismatch; re-send with directive conditional or explicit (this re-validates).` : ''
      out.halted = {
        gate: 'upfront', record, directive, respec: v.mismatches, tooling_blockers: hookErr ? v.tooling_blockers.concat([hookErr]) : v.tooling_blockers,
        blocked_step: blockedStep ? blockedStep.n : null,
        plan: toUnits(pending).map((u) => `${u.members.map((m) => m.n).join('+')}. ${u.title} [${u.surface}]`),
        question: `Proceed with ${pending.length} pending step(s)${v.mismatches.length ? `, re-spec'ing steps ${stepList(v.mismatches)} per directive ${directive}` : ''}?${roll}${none} Approve with {gate:'upfront', decision:'proceed', record:<this halt's record, verbatim>}.`,
      }
      return out
    }
    if (directive === 'none' && r.mismatches.length) { out.blocked = `directive none: steps ${stepList(r.mismatches)} mismatch; re-send with directive conditional or explicit (this re-validates)`; return out }
    if (hookErr) { out.blocked = hookErr; return out }
    const ws = await agent(`${WR}\n\n${ctx}\n${setupTask(f, p, r)}`, { agentType: WRITER, phase: 'Gate', schema: SETUP, isolation: 'worktree', label: `setup:${f.slug}` })
    if (!ws) { out.blocked = 'setup writer died'; return out }
    out.commits.push(...ws.commits)
    if (ws.stale) { out.blocked = 'setup: origin moved since the approved record — start a NEW run'; return out }
    if (ws.tooling_blockers.length) { out.blocked = `tooling: ${ws.tooling_blockers.join('; ')}`; return out }
    if (!ws.completed) { out.blocked = `setup incomplete: ${ws.notes.join('; ')}`; return out }
    if (r.mismatches.length) { // D9
      out.halted = { gate: 'resume', reason: 're-spec committed; the relaunch re-parses the branch tip', question: "Relaunch as a fresh run with {gate:'resume', decision:'proceed'} (re-send on every relaunch)." }
      return out
    }
  }
```
- The validate `-X ours` stays; replacing it is out of scope (`product-spec.md:109`).
- **Halt symmetry (m8).** Several halts write nothing but still carry the hook precondition, so the operator can fix it before approving:
  - the distill and resume halts carry `hook: hookErr`;
  - the merge-order halt in Land (`sdd-batch-execute.js:234`) gains `hook: hookErr` after `reason: p.mergeOrderBlock`. It lands with this Gate block, because AC-37 covers it;
  - the upfront halt carries the same message in `tooling_blockers`.

  The D9 resume halt is not tagged: by the time it is reached, `hookErr` is `''`, because the setup-path check above it blocks first.
- The upfront halt always fires when there is no matching record, so nothing is written before a record-matching confirm (D2, F-10).

**Step loop edits (`:188-198`):**
- `:191` is deleted. The `stopping` return in the Gate block (above the hook-precondition check) replaces it (m-G).
- `:189-190`, the `${operatorNote ? …}` in the `:197` prompt and `:198` `operatorNote = null` stay as today (D19: no note scoping).

### 1.6 setupTask (new function next to writerRules; replaces the `:178` prompt)

```js
function setupTask(f, p, rec) {
  const R = JSON.stringify(rec)
  const ms = rec.mismatches.map((m) => m.n).join(',')
  return `Operator approved the up-front plan with this record (binding, verbatim): ${R}
Do the items below IN ORDER. Each item that changes a file is one commit (git-protocol item 3 form), pushed (item 4) before the next item; "Skip if" means do nothing for that item. Wherever loaded skill text says AskUserQuestion, add a tooling_blockers entry or note instead. Return commits, notes, tooling_blockers, stale and completed.
0. Stale check (no commit). \`git fetch origin\`; if \`git rev-parse origin/main-dev\` ≠ ${rec.mainDev} or \`git rev-parse origin/${p.devBranch}\` ≠ ${rec.dev}: return stale:true, completed:false, commits []. Else \`git checkout --detach ${rec.dev}\` and redo git-protocol item 2.
1. Tooling (no commit). Run .claude/skills/sdd-execute/reference/tooling-setup.md DETECTION only for the toolchains the pending steps need (installs stay per step, and never a Node package install: git-protocol item 2); add each unavailable toolchain with no documented fallback to tooling_blockers. A failing hook check from git-protocol item 2 is a tooling_blockers entry too (item 2's rule). Any tooling_blockers entry means completed:false, no commits, and no further item.
2. Merge. Skip if \`git merge-base --is-ancestor ${rec.mainDev} HEAD\`. Else \`git merge --no-commit --no-ff ${rec.mainDev}\` (never -X), then ONE Bash call, with the literal <M> from git-protocol item 2: node "<M>"/scripts/merge-train-resolve.mjs --base ${rec.mainDev} --own-slug ${f.slug} (the tool reports its exit code)
   - exit 2: \`git merge --abort\`; note "unresolvable: <each path: reason> — merge origin/main-dev into ${p.devBranch} by hand resolving <paths>, push, start a NEW run"; completed:false; stop.
   - any other non-zero exit or a throw: \`git merge --abort\`; note "resolver exit <N>: <last line>"; completed:false; stop.
   - exit 0: commit the merge, subject "Merge ${rec.mainDev} into ${p.devBranch}". If the hook fails: \`git merge --abort\`; note "hook failed on merge commit (main-dev content) (last 20 lines): <tail>"; completed:false; stop.
   Then: python3 scripts/ledger-guard.py --own-slug ${f.slug} --base ${rec.mainDev} --fix (the tool reports its exit code)
   - exit 0: \`git add -- docs/roadmap/ledger/\`. If \`! git diff --quiet\` (a tracked non-ledger file changed): \`git reset --hard ${rec.dev}\`, note "ledger-guard touched non-ledger paths", completed:false, stop. Else, only if \`! git diff --cached --quiet\`, amend with git commit --amend --no-edit (item 3 amend form); if nothing is staged there is nothing to amend — continue.
   - non-zero: \`git reset --hard ${rec.dev}\`; note "ledger-guard exit <N>: <output>"; completed:false; stop.
   Then push. A non-fast-forward rejection: \`git reset --hard ${rec.dev}\`; return stale:true, completed:false.
3. Re-spec. Skip if the record's mismatches list is empty. Else edit ONLY implementation-spec.md, ONLY the bodies (Instructions/Codebase Evidence/Files/Verification) of steps ${ms || '(none)'}, per directive ${rec.directive} (.claude/skills/sdd-execute/reference/sequential-mode.md §5.3), to match: ${JSON.stringify(rec.mismatches)}. Commit alone with subject "respec(${f.slug}): align steps ${ms} with current codebase" and first body line "Approved-record: ${R}"; push.
4. feature.md: append the Status History row "→ in-progress (sdd-batch-execute setup)" dated ${A.date}. Skip if status.md is already in-progress, or the newest row is already "→ in-progress" for ${A.date}. Commit alone; push.
5. status.md → in-progress. Skip if it already is. Commit alone; push.
6. context.md, LAST. Skip if the LAST fenced \`sdd-batch-setup\` block in context.md already holds "mainDev":"${rec.mainDev}". Else append "## Session ${A.date} — sdd-execute sequential (sdd-batch-execute)" recording the up-front confirmation (the record above), listing every respec(${f.slug}) commit in \`git log --first-parent origin/main-dev..HEAD\`, and ending with exactly these three lines at column 0:
\`\`\`sdd-batch-setup
{"mainDev":"${rec.mainDev}","date":"${A.date}"}
\`\`\`
Commit alone; push. Return completed:true only after this push.`
}
```
- The resolver protocol (link, `--no-commit` merge, resolver, abort on exit 2, abort on hook failure) is the one at `merge-train.js:107-111`.
- `ledger-guard.py` reads committed trees (`:61`) and writes the working tree without staging (`:87-88`), so it has to run after the merge commit and be amended into it.
- With `--fix`, ledger-guard exits 2 when the base is not merged (`:55-58`).
- Removing today's `:178` re-spec commit, which bundles feature.md and context.md, resolves recon's `:230` deviation.

### 1.7 Step prompt (replaces the `:197` prompt; discover `:196` is unchanged and carries no `Tree:` stamp, so it writes `Checkout: UNSTAMPED` per `codebase-discovery.md:23-25`)

```js
    const impl = await agent(`${WR}\n\n${ctx}\nExecute step ${nums} — ${s.title} (sequential mode: no Phase-2 prompt).${unitNote}\n${READ_SCOPE}\nIf a required symbol/file is confirmed missing at origin/${p.devBranch}, or verification would need a spec deviation, or the fix is ambiguous: do NOT commit code — return result 'blocker' with the question and A/B/C options (Option A = fix now by expanding this step's scope; when the step cannot pass its own Verification without the immediately following step, Option A is folding it in per atomic-units.md). Otherwise: run the TDD gate (RED before implementing, GREEN after; TDD: N/A only for non-code categories) and the step's **Verification**, both per the VERIFICATION protocol below, then commit per §5.5 ("feat(${f.slug}): step ${s.n} — ${s.title}", staging only the step's **Files** + implementation-spec.md (step **Status** → done) + feature.md + status.md + context.md, plus lockfiles when a manifest changed), push. FOLD POLICY ${FOLD}: <unchanged :197 fold text>. Report deviations (also in the spec's ## Deviation Log), out-of-scope changes, open items and still-unaddressed impl-spec review warnings for the checkpoint report.${operatorNote ? `\n\nOPERATOR NOTE (binding): ${operatorNote}` : ''}\n\n${VERIFY}\n\n--- discovery digest (advisory) ---\n${disc || '(discovery agent returned nothing — verify inline)'}`, { agentType: WRITER, phase: 'Steps', schema: IMPL, isolation: 'worktree', label: `step:${f.slug}:s${s.n}` })
```

### 1.8 Land (`:237-249`)

- **write-plan** gets `agentType: WRITER`. Replace `:241` with:
  ```js
  if (!wp || !wp.commits.length) { out.blocked = `write-plan made no commit: ${wp ? wp.notes.join('; ') : 'writer died'}`; return out }
  out.commits.push(...wp.commits)
  ```
- **integration-pr** keeps the default type. In its `:245` prompt (an existing template literal; `${p.devBranch}` is intended interpolation), "Return its URL and the commits." becomes:
  ```
  Open the PR only if the promotion commit is pushed now or the plan is already applied at origin/${p.devBranch} (say which in notes); otherwise return url ''. Return its URL, the commits and notes.
  ```
  After `:246-247`:
  ```js
  if (!pr.url) { out.blocked = `integration-pr incomplete: ${pr.notes.join('; ') || 'no PR url'}`; return out }
  ```
  - There is no commits check (D18). Two runs legitimately return `commits []` with a URL: a relaunch after the promotion commit was already pushed, and a plan that dedups to zero scenarios. The prompt rule, not the guard, prevents "PR opened without the promotion".

### 1.9 SKILL.md:301 (all modes, D11)

The new text:

"3. Run the step's `**Verification**` command. Report the cited output lines, the `exit=` line and the log path (full log on request); `exit=<n>` is the command's exit status, and with no log file the path is `none`. (For a code-bearing step this is the green run of the TDD gate.)"

`:302-317` (the migration rule and the wiring gate) and `## HARD CONSTRAINTS` (`:476`) are untouched.

### 1.10 Distill fence rule (D8)

- **`.claude/agents/context-distiller.md`**: append after the rubric paragraph at `:51-52`:
  > "Every fenced `sdd-batch-*` block (`sdd-batch-setup`, `sdd-batch-promotion-plan`, `sdd-batch-design-state`) is PRESERVE-verbatim: reproduce it byte-for-byte, fence lines at column 0, inside its session's summary right after the summary lines (it does not count toward the ≤3 lines), in original order; condense only the prose around it. Never mark a whole session keep-verbatim only because it holds a fence."
- **`.claude/skills/sdd-distill/SKILL.md:108`** (WRITE item 3): append the same first sentence.
- Superseded Sessions are written before the kept recent sessions (`:108-110`), so the relative order of the fences survives and preflight's "LAST fence" still finds the newest one.

### 1.11 context-engineering.md §4 and context-map.yaml (FR-8)

- **`:170` Stops at cell** becomes: "the distill gate (oversized context.md) · the resume gate (a workflow-set-up feature with no checkpoint/blocker/resume approval, and after a setup re-spec) · the up-front confirm (re-halts when the approval's record is absent or stale) · every smart checkpoint (default) · every blocker · merge-order · the promotion confirm".
- **New contract bullet after `:186`:**
  > "`/sdd-batch-execute` gate answers: the upfront halt returns a `record` `{mainDev, dev, specHash, directive, pending, mismatches}`; approve with `{gate:'upfront', decision:'proceed', record}` (the halt's record verbatim). A record that no longer matches origin re-validates and re-halts. `{gate:'resume', decision:'proceed'}` and `{gate:'distill', decision:'proceed'}` are re-sent on every relaunch. A relaunch that answers a gate is a fresh run with new args, not resumeFromRunId; `resumeFromRunId` with unchanged args is only for a run cut short. Setup's last commit ends its context.md entry with a `sdd-batch-setup` fence `{"mainDev":"<sha>","date":"<ISO>"}`; `/sdd-distill` keeps every `sdd-batch-*` fence byte-for-byte. Accepted risk (D4): a stale `resume` sent after a real checkpoint halt continues past it."
- **New roles bullet:**
  > "`sdd-batch-checker` (preflight, validate; read-only) and `sdd-batch-writer` (setup, step, write-plan) are workflow-internal agent types; the writer is the one exception to §1's read-only default (`:35`). A live pre-commit hook in the main checkout, and the four root-anchored `info/exclude` lines, are an operator precondition. Preflight runs the shared hook check there. A run that would commit while the check fails is blocked, with the failing clause and its remedy (from the main session: `pnpm install --frozen-lockfile`, the pnpm/HUSKY fix, or appending the missing exclude lines). No workflow agent installs, repairs the hook, writes `core.hooksPath` or writes a file under the main checkout itself; git's own object/ref writes from a worktree are expected (D23). No writer runs a Node package install: the worktree's `node_modules` are links into the main checkout, so a missing package blocks with a main-session `pnpm install --frozen-lockfile` remedy, and a package only the branch adds sends that step outside the workflow (D26). Non-Node per-step installs (`uv sync`, Go) stay."
- **Operational note, appended at `:221`:**
  > "The shared `info/exclude` must hold `/node_modules`, `/services/*/node_modules`, `/.husky/_` and `/.sdd-logs`. This is an operator precondition, checked by the shared hook check; writers only read it. Commit messages, commit logs and verification logs live in the worktree's `.sdd-logs/` and vanish with it."
- **`.claude/context-map.yaml`:**
  - The `:15` header becomes `# --- Subagent fleet: isolated windows that return condensed digests (read-only unless noted) ---`.
  - Append two entries:
    - `sdd-batch-checker`: path `.claude/agents/sdd-batch-checker.md`; returns "preflight/validate JSON for one feature"; `used_by: [sdd-batch-execute]`.
    - `sdd-batch-writer`: path `.claude/agents/sdd-batch-writer.md`; returns "commits + stage result (writes; workflow-internal)"; `used_by: [sdd-batch-execute]`.

### 1.12 Test changes (`scripts/workflow-tests/sdd-batch-execute.test.mjs`; `harness.mjs` is unchanged)

**Constants and fixtures:**
- Add `const MD='a'.repeat(40), DV='b'.repeat(40), SH='c'.repeat(40)` and `const REC = {mainDev:MD, dev:DV, specHash:SH, directive:'conditional', pending:[1,2,3], mismatches:[]}`.
- `pre()` (`:11`) defaults gain `mainDevSha:MD, devSha:DV, specHash:SH, contextBytes:'1000', workflowSetup:'', hookFail:''`. `hookFail:''` is an explicit default for schema parity; no existing block depends on it.
- `replies()` (`:13-22`):
  - `setup:` gains `tooling_blockers:[], stale:false, completed:true`;
  - `integration-pr:` gains `notes:[]`.

**Fallout in existing blocks:**
- Block 1 asserts `halted.record` deep-equals REC.
- Blocks 2, 7(a) and 8(b) send `{gate:'upfront', decision:'proceed', record:REC}` and assert 0 `validate:` calls.
- Blocks 3, 7(b) and 9 set `workflowSetup: MD` (status in-progress).

**New tests:**
- Each new AC gets a test written RED first (`context-engineering.md:226`).
- Count stage calls with `label.startsWith`, never `includes`.
- Static checks (AC-2, AC-16, AC-19, AC-27) read files with `fs`.
- Assertions that contain a shell `${` use single-quoted strings (IR-4); since D29 these are only the negative checks for the retired one-liner.

### 1.13 Build order (tests first)

**PR-0 spike** (throwaway branch, never merged; FR-9, AC-17, AC-20). It must prove:
- `agentType` composes with `isolation:'worktree'`.
- The checker calls `list_pull_requests`, and the transcript records whether a ToolSearch select preceded the call.
- The first turn of each agent is ≤30K tokens.
- A real writer step in a linked worktree, after the main session provisions the main checkout (D23) and the writer makes its links, runs husky's `_/h` → `.husky/pre-commit` → lint-staged.
  - Done for the absolute `core.hooksPath` in `wf_3f24944b-f87`.
  - Still to record in the Step 1 close (AC-48, re-scoped by D29):
    - the split HOOK_CHECK under the absolute form, with a commit that runs `<M>/.husky/pre-commit`;
    - the `exclude` clause;
    - guard parity of every split command.

    The background wrapper's `exit=3` is already measured (`wf_3ce0d1f3-477`). The relative-form checks are dropped: isolated worktree creation leaves `core.hooksPath` absolute, so they cannot be reproduced under workflow isolation.
- Hook wall time and output bytes for:
  - a plain commit;
  - a commit staging `services/xstockstrat-ui/`;
  - a setup merge commit whose merge brings in ui files (m5).
- (dropped, D23: the workflow never runs husky; `pnpm install --frozen-lockfile` wrote the relative `.husky/_`, `context.md` § PR-0 re-spike.)
- `run_in_background` with `.exit` polling works under the writer's tools.
- `git cat-file -s` works.
- `merge-train-resolve.mjs --base <sha>` and `ledger-guard.py --base <sha>` accept a raw sha.
- bash 3.2 behaves the same for `( )`, `wc -c | tr -d ' '`, the `bash .sdd-logs/run-<K>.sh` wrapper ending `echo "exit=$?" >file`, the split `HOOK_CHECK`'s `printenv`, `test -f` and `grep -qxF --` (D22: so far run only on GNU bash 5.2).
- No `~/.config/husky/init.sh` sets `HUSKY=0`.
- `CONTEXT_MAX` is calibrated from features 282, 289 and 294.

Spike outcomes:
- If composition fails, fall back to AC-20.
- If the MCP tool is unreachable by either path, preflight keeps the default type. Return to the operator before Step 1 (P-04).

**Integration branch**, each step RED test → change → GREEN, one commit:
1. Agents, agentType wiring and context-map entries. AC-1, AC-2.
2. Constants, schemas, preflight prompt and the full Gate block, with the fixture fallout. AC-3–12, 21, 22, 24, 28–31, 34, 35, 37, 40, 47.
3. setupTask and writerRules. AC-13, 18, 25, 26, 38, 39, 41.
4. READ_SCOPE, VERIFY and the step prompt. AC-14, 15, 23, 32, 33, 42.
5. Land guards and the PR schema. AC-43, AC-44.
6. `SKILL.md:301` (docs, `TDD: N/A`, static assert written first). AC-19.
7. Distill fence rule. AC-27.
8. §4 and the context-map header. AC-16, plus `check-context-map.sh`.

**Touchpoints:**
- Files: `.claude/workflows/sdd-batch-execute.js`; `.claude/agents/sdd-batch-{checker,writer}.md` (new); `scripts/workflow-tests/sdd-batch-execute.test.mjs`; `.claude/skills/sdd-execute/SKILL.md:301`; `.claude/agents/context-distiller.md`; `.claude/skills/sdd-distill/SKILL.md:108`; `docs/patterns/context-engineering.md` §4; `.claude/context-map.yaml`.
- Proto, migration, config and services: none.
- Runtime side effect: none outside the worktrees, the dev branch, and git's own object/ref writes into the shared common dir.
  - The main checkout's `node_modules`, its `core.hooksPath` and the four shared `info/exclude` lines are an operator or main-session precondition, never a workflow write (D23).
  - No writer runs a Node package install, because the worktree's `node_modules` are links into the main checkout (D26).
  - Non-Node per-step installs write only the worktree (`services/<s>/.venv`) or the caches under `$HOME`.

**Reuses:**
- The promotion-plan fence pattern (`:148,240`, schema `:60`).
- `approvals()` / `proceeds()` (`:119-121,138`).
- The merge-train update protocol (`merge-train.js:107-111`).
- `ledger-guard --fix` (`:55-58,87`).
- The agentType + schema composition (`sdd-batch.js:183-184`).
- The agent frontmatter shape (`codebase-discovery.md:1-6`).
- The `/sdd-distill` machinery (`sdd-distill/SKILL.md:102-116`).
- The harness prefix mocks (`harness.mjs:12-16`).
- One constant each for `MAINWT`, `HOOK_STEPS` (rendered once as `HOOK_CHECK`), `ENV_REMEDY`, `HOOK_REMEDY`, `EXCLUDE_REMEDY`, `READ_SCOPE` and `VERIFY`, plus one `hookMsg` renderer (C-18). `hookBlocked` and writerRules item 2 both call `hookMsg`, and the Gate renders `hookErr` once for both of its checks and for every no-write halt.

---

### Spec Changes (D12)

These are applied to `product-spec.md` and `acceptance.feature` in this design phase. `/sdd-review product-spec` re-runs before `/sdd-spec`.

| Item | Old → New (final text in product-spec.md) | Driver |
|---|---|---|
| FR-1 (writer clause superseded by FR-1 (D23)) | Checker tools "`Bash, Read, Glob, Grep, mcp__github__list_pull_requests`; … directly, without ToolSearch" → "`Bash, Read, Glob, Grep, ToolSearch, mcp__github__list_pull_requests`; preflight calls the GitHub tool directly, or selects it with ToolSearch when it is not callable directly; on a tool error it retries once after about 10 s, then reports "PR lookup unavailable" (distinct from "no open PR")". Writer "setup, step and write-plan" → "setup, hook-setup, step and write-plan". Doc literal → "Workflow-internal — spawned only by .claude/workflows/sdd-batch-execute.js; never delegate from a skill session. Never select via Task." | r2 N1; D15 |
| FR-2 | "the pending step numbers are all equal" → "… compared as a sorted numeric list". Append: "Any non-40-hex `mainDevSha`/`devSha`/`specHash` blocks the run ("non-hex sha"). With directive `none`, a matching record that has mismatches blocks before setup ("directive none: steps X mismatch; …")." Pin: the specHash source "`origin/<dev>:<dir>/implementation-spec.md`" (`product-spec.md:34`) → "`git rev-parse <devSha>:docs/roadmap/features/<dir>/implementation-spec.md`". A record whose `pending` or `mismatches` is not an array never matches (re-validates). | r3 non-hex; N9; canon; m-K; m-F |
| FR-3 (hook/log clauses superseded by the D23 rows; the D9 resume clause stands) | Append: "After a setup that made a `respec(` commit, the run ends at `resume` (D9). When preflight's `hookLive` (the shared hook check run in the main checkout) is false on a run that will commit without setup (resume with pending steps and no `stop here`, or Land past merge-order), a no-commit `hook-setup` writer runs first; its failure blocks." | D9; D15; m2 |
| FR-4 | "… or its size cannot be read, the run halts at `distill`" → "… (`git cat-file -s <devSha>:docs/roadmap/features/<dir>/context.md`) … When the size cannot be read, the run is blocked with "context.md size unreadable" (a read failure is a defect, not a size)." | r2 N4; D12 (AC-21 inverted) |
| FR-5 item 1 (superseded by the D23 rows) | "Tooling detection" → "Tooling detection and pre-commit hook liveness (the shared `HOOK_CHECK`, each clause naming its failure). HUSKY/pnpm failures → tooling blocker. Otherwise, after any running install's `sdd-husky.lock` clears (blocker at 2 polls; stale after 30 min): `pnpm exec husky` in the main worktree if its husky bin exists; else `pnpm install --frozen-lockfile` only when `$M/node_modules` is missing, under the mkdir lock; else blocker. Re-link, re-check; still inert → `tooling_blockers`, no commits." | D10; D13; m3; D15 |
| FR-5 item 2 | "exit 2 → resolve by hand" → "any non-zero exit → `git merge --abort`, no commits, `completed:false`, one note per cause: unresolvable … start a NEW run (exit 2, D7) / resolver exit N / hook failed on merge commit (main-dev content) / ledger-guard exit N (then `git reset --hard`)". Ledger-guard "amended" → "`git add -- docs/roadmap/ledger/`; a tracked non-ledger change (`! git diff --quiet`) resets to the record's dev sha and blocks; else `--amend` only if something is staged; nothing staged → continue (D17)". Non-fast-forward push → `stale:true`. | D7; r4 ledger amend; m5 |
| FR-5 (append) (superseded by the D23 rows) | "Every writer commit and amend uses the quoted-heredoc CLOG form (`git commit -F - >"$CLOG" 2>&1 <<'SDD_MSG_EOF'`, closing delimiter at column 0, `tail -n 20`). Writers link root and per-service `node_modules` and `.husky/_`, add root-anchored patterns to `info/exclude`; a dirty tree is `! git diff --quiet`. A non-setup writer that finds the hook inert never installs and returns a blocker (step) or `commits []` + note, with a remedy keyed on the failing clause." | M1; M3; m1; D15 |
| FR-6 | sequential-mode line → "§5.5, §5.7, the carve-outs and the verification fallbacks". Append: "The discovery digest is advisory; the step re-verifies every not-found claim and every path:line it acts on at origin/<devBranch>. Wherever loaded skill text says AskUserQuestion, the step returns result:'blocker'." | N3; N7 |
| FR-7 (log clauses superseded by the D23 rows; the wiring-gate log and SKILL.md:301 (D11) stand) | "a new log outside the worktree" → "a new `mktemp` log under `$(cd "$(git rev-parse --git-dir)" && pwd)`, path echoed first; a run longer than 540 s uses `run_in_background` with a `.exit` sentinel and ≤540 s polls; a timeout is FAILED; the log lives until the worktree is removed". Append: "The config-key wiring gate (step-time and `--final`) runs the same way with its own log." SKILL.md:301 line → the "SKILL.md:301" text above, all modes (D11). | N6; Δ9/Δ10; N8; D11 |
| FR-8 (hook clauses superseded by the D23 rows; the D8 distill rule and context-map header stand) | Append: "`/sdd-distill` and `context-distiller` reproduce every fenced `sdd-batch-*` block byte-for-byte and in order (D8). The context-map agents header notes that not every agent is read-only. §4 documents hook-setup, `info/exclude` and log lifetime." | D8; N5 |
| FR-9 (husky clauses superseded by the D23 rows; ToolSearch path, background polling and raw-sha --base stand) | "an MCP tool … callable without ToolSearch" → "a checker can call `mcp__github__list_pull_requests`, and which path it used". "husky firing" → "husky firing in a linked worktree through the symlinked `.husky/_` after the hook-liveness remedy, with hook time/output measured for a ui commit and a ui-bearing merge commit". Add "background-run polling; raw-sha `--base` for the resolver and ledger-guard". | N1; M3; m5 |
| FR-10 (new) | "No silent writer no-op: write-plan with no commit, or a dead write-plan, blocks ("write-plan made no commit"); integration-pr with no url blocks ("integration-pr incomplete: <notes>", or "no PR url" when it returns no notes); the integration-pr prompt opens the PR only once the promotion commit is pushed now or the plan is already applied at the dev-branch tip; the PR result gains `notes`." | MAJOR-5; fails.md:3361-3363; D18 |
| Out of Scope | last bullet + ", except the `SKILL.md:301` wording (D11)" | D11 |
| Affected Services (main-checkout write clause superseded by the D23 rows; the D8 additions stand) | + `context-distiller.md`, `sdd-distill/SKILL.md` (D8); + main-checkout `.git/config` `core.hooksPath` / `node_modules` (D10/D13) | D8; D10 |
| Known Traps (superseded by the D23 rows) | `fails.md:3361-3363` line → "Setup and hook-setup check liveness with one shared check and repair per D13; other writers block with a clause-keyed remedy." | D15 |
| Accepted Risks (first clause superseded by the D23 rows) | + "When the main checkout's hook is live but a writer's own check fails on clause `h` or `pre-commit` (worktree link failed, or the branch lacks `.husky/pre-commit`), the 're-send resume' blocker repeats, because hook-setup is skipped; the printed `hook-fail=<clause>` names the cause (design Risk 3)." + "When a setup merge brings in `services/xstockstrat-ui/` changes, the pre-commit hook may fail on main-dev content this feature does not own, and setup blocks with 'hook failed on merge commit (main-dev content)'; the FR-9 spike measures how often (design Risk 6)." | m-K; Risk 3; Risk 6 |
| AC-2 | amended in place: checker tools line + description line | N1 |
| AC-13 | amended in place: the "status.md" < "sdd-batch-setup" ordering is measured in the text after "Operator approved the up-front plan" (writerRules item 5 names status.md, so the unanchored check was vacuous) | m-B |
| AC-17 (hook lines superseded by the D23 rows; the ToolSearch-records line stands) | amended in place: ToolSearch-records line, linked-worktree symlinked hook line, hook cost line incl. merge commit | N1; M3; m5 |
| AC-18 | amended in place: "items 2–6 contain push" is measured on the column-0 items in the text after "Operator approved the up-front plan" (writerRules' own items 2 and 3 have no push) | m-B |
| AC-21 | inverted: distill halt → blocked "context.md size unreadable" | N4; D12 |
| AC-24 | new: inert hook blocks setup | D10 |
| AC-25 (superseded by the D23 rows) | new (round-3 draft amended): show-toplevel dropped; asserts "pnpm exec husky", "sdd-husky.lock"; ordering anchored after "1. Tooling + hook liveness" | MAJOR-4 |
| AC-26 (superseded by the D23 rows) | new (merged): links, exclude, `! git diff --quiet`, clause-keyed remedy; no install strings | M1; D15 |
| AC-27..AC-34 | new (round-3 text) | D8; D7; D9; N9; non-hex; N3/N7; N8; N1 |
| AC-35..AC-40 (AC-35..AC-39 superseded/amended by the D23 rows; AC-40 stands) | new (round-4 text; AC-37 extended for m2, AC-38 for m3 + the shared check, its Given split per m-C and the DETECTION-skip line per m-H) | D13; D15; m2; m3; canon; m-C; m-H |
| AC-41 | new (round-4 draft amended): anchored after "ledger-guard.py"; also asserts "! git diff --cached --quiet" and "nothing to amend" | MAJOR-4; D17 |
| AC-42 | new | Δ9/Δ10 |
| AC-43 | new: write-plan guard (incl. dead agent), tagged @FR-10 | MAJOR-5 |
| AC-44 | new: integration-pr guard keyed on url only, plus the open-PR prompt rule | MAJOR-5; D18 |
| AC-45 | retired (D19); never reused | D19 |
| AC-3 | amended in place (post-design review): concrete validate mismatches in Given and Then | /sdd-review re-run (D12) |
| AC-17 | + agentType/worktree composition, background polling and raw-sha `--base` lines | /sdd-review re-run (D12) |
| AC-46 | new: a record whose `pending`/`mismatches` is not an array re-validates (FR-2) | /sdd-review re-run (D12); m-F |
| FR-1 (D23) | `:32` "runs setup, hook-setup, step and write-plan" → "runs setup, step and write-plan" | D23 |
| FR-3 (D23) | `:56-58` "**Hook-setup.** Preflight reports `hookLive` … or Land past merge-order." → "**Hook precondition (D23).** Preflight reports `hookFail`, the shared hook check run in the main checkout: `""` when it passes, else the failing clause (surrounding whitespace and a leading `hook-fail=` are ignored). A live hook and the four `info/exclude` lines (`/node_modules`, `/services/*/node_modules`, `/.husky/_`, `/.sdd-logs`) are an operator/main-session precondition; no workflow agent installs, repairs or appends them. When `hookFail` is non-empty on a run that will commit (setup after a record-matching upfront approval, a resume with pending steps and no `stop here`, or Land past merge-order), the run blocks before spawning any writer: clause `exclude` → "commit precondition unmet in the main checkout (hook-fail=exclude) — <the exact append command, run from the main session>"; HUSKY/pnpm → "pre-commit hook inert in the main checkout (hook-fail=<clause>) — <provision pnpm 9.15.9 or unset HUSKY>"; any other → "… — <run `pnpm install --frozen-lockfile` in the main checkout from the main session>". Runs that write nothing are not blocked: the upfront halt lists that message in its `tooling_blockers`, and the distill, resume and merge-order halts carry it as `hook` (`""` when the check passes); `stop here` returns `stopped`." | D23; D24; r1 m5, m8; r2 m3, m8 |
| FR-5 item 1 (D23) | `:71-77` "Tooling detection and pre-commit hook liveness … if still inert → `tooling_blockers`, no commits." → "Tooling detection (no commit; never a Node package install). An unavailable toolchain with no documented fallback, and a failing shared hook check from the writer rules, each become a `tooling_blockers` entry; any entry → `completed:false`, no commits." | D23; D26 |
| FR-5 writer rules (D23) | `:104` "Every commit and amend uses the quoted-heredoc CLOG form …" → "The writer writes each message (subject, blank line, body, the trailer lines last) with the Write tool to `.sdd-logs/msg-<N>.txt`, commits with `git commit -F .sdd-logs/msg-<N>.txt > .sdd-logs/commit-<N>.log 2>&1` (Bash timeout 600000; amend: `git commit --amend --no-edit > .sdd-logs/commit-<N>.log 2>&1`), takes the exit code from the tool, then reads `tail -n 20` of that log." `:105-108` → "Writers link the root and per-service `node_modules` and `.husky/_` (the `.husky/_` link whatever the current `core.hooksPath` form, D25) and keep logs and message files in a worktree-local `.sdd-logs/`. Each command is its own Bash call from the worktree root. Writers never `cd` into or `git -C` the main checkout, and never write a file under it themselves, directly or through a link (redirects, `ln` targets, installs); git's own object/ref writes from commands run in the worktree are expected. They only read the shared `info/exclude`, through the hook check. **No Node package install (D26):** writers never run `pnpm install` (or any Node package install) anywhere in the worktree, because the linked `node_modules` are the main checkout's; this overrides `tooling-setup.md`'s Node rows and any step Verification block that installs (a spec-deviation blocker). A missing Node package is a blocker: "main-checkout node_modules lacks <pkg> — from the main session run pnpm install --frozen-lockfile in the main checkout, then re-send the same approvals", or, for a package only the branch adds, "… which only this branch adds — run this step with /sdd-execute outside /sdd-batch-execute". Non-Node per-step installs stay allowed (`uv sync --extra dev` into the service's own unlinked `.venv`; `go mod download`/`go install` into `$HOME` caches). A dirty tree is `! git diff --quiet`." `:109` "**Inert hook outside setup.** …" → "**Failing hook check.** Any writer whose shared hook check fails, or is refused, never installs, repairs or appends anything and makes no commit: step → blocker; setup → `tooling_blockers`; other writers → `commits []` + note; the message is keyed on the failing clause." | D23; D25; D26 (MAJOR-1); re-spike |
| FR-6 (D26) | `:121` "**tdd-gate.md and tooling-setup.md:** in full." → "**tdd-gate.md and tooling-setup.md:** in full; the writer rules override tooling-setup.md's Node install rows (no Node package install in a writer)." | D26 (MAJOR-1) |
| FR-7 (D23) | `:129` "a new `mktemp` log under `$(cd "$(git rev-parse --git-dir)" && pwd)`, with the path echoed first" → "a wrapper `.sdd-logs/run-<K>.sh` (Write tool, a NEW K per run) holding `( <fence> ) >.sdd-logs/v-<K>.log 2>&1` and `echo "exit=$?" >.sdd-logs/v-<K>.exit`, run as `bash .sdd-logs/run-<K>.sh; cat .sdd-logs/v-<K>.exit` (foreground, ≤540 s) or with `run_in_background` and ≤540 s polls of the `.exit` file". `:130` "runs as `( <fence> ) >"<log>" 2>&1; echo "exit=$?"`" → "runs inside that wrapper". | D23; re-spike |
| FR-8 (D23) | `:148` "hook-setup, `info/exclude`, and log lifetime." → "the hook precondition (including the four `info/exclude` lines), the no-Node-install writer rule, and log lifetime." | D23; D26 |
| FR-9 (D23) | `:159` → "**husky fires in a linked worktree.** After the main session provisions the main checkout, one real step runs end-to-end and husky fires. The shared hook check passes in a worktree for both `core.hooksPath` forms; with the relative form the commit runs the worktree's own `.husky/pre-commit`, and without the `.husky/_` link it runs none (re-confirming the measured silent skip). Hook time and output are measured for a ui commit and for a merge commit that brings in ui files." | D23; D25; AC-48 |
| Affected Services (D23) | `:195` → "Runtime side effect: none beyond the worktrees, the dev branch and git's own object/ref writes into the shared common dir. The main checkout's `node_modules`, `core.hooksPath` and the four shared `.git/info/exclude` lines are an operator/main-session precondition, never a workflow write; no writer runs a Node package install (D26)." | D23; D26 |
| Known Traps (D23) | `:247` "Setup and hook-setup check liveness with one shared check and repair per D13; other writers block with a clause-keyed remedy." → "Preflight runs the shared check in the main checkout and blocks a run that would commit while it fails; every writer re-runs it in its worktree and blocks with a clause-keyed remedy; no workflow agent repairs the hook, writes a file under the main checkout or runs a Node package install (D23, D26)." | D23; D26 |
| Accepted Risks (D23) | `:252` "the 're-send resume' blocker repeats, because hook-setup is skipped" → "the writer's clause-keyed blocker repeats on each relaunch, because preflight's main-checkout check passes". Add: "With an absolute `core.hooksPath` `<X>/.husky/_`, every worktree runs `<X>/.husky/pre-commit`; the only value observed is the main checkout's, and any other absolute `<X>` with `h` and `pre-commit` is accepted too (design Risk 16, D24)." Add: "Writers make the `.husky/_` link even while `core.hooksPath` is absolute (D25, an operator-approved exception to D23 consequence 4)." | D23; D24; D25 |
| Accepted Risks (D26) | Add: "A step that needs a Node package the main checkout's lockfile lacks (a new or upgraded dependency on this branch) cannot run under `/sdd-batch-execute`: its writer blocks and the operator runs that step with `/sdd-execute` outside the workflow (design Risk 20)." | D26 (MAJOR-1) |
| AC-15, AC-17, AC-23, AC-25, AC-26, AC-35, AC-37, AC-38, AC-39, AC-42 | amended in place (D12 precedent): `.sdd-logs/` logs and Write-tool message files; the hook precondition (including `exclude`) replaces hook-setup; AC-37 gains the upfront `tooling_blockers`, Land, distill-halt and resume-halt `hook` clauses; AC-26 gains the no-Node-install literals; AC-38 gains the wrapper test of clause `h` | D23; D26; r1 m4, m5; r2 MAJOR-1, m2, m4, m8 |
| AC-36 | retired (hook-setup removed); never reused | D23 |
| AC-47 | new: a hook-precondition failure blocks setup with the clause-keyed remedy (HUSKY, pnpm, exclude, a padded `hook-fail=`-prefixed value) | D23; r1 m8; r2 m3 |
| AC-48 | new @manual-spike: HOOK_CHECK in a linked worktree for both forms and `exclude`; the relative form runs the worktree's own body, and no link means no hook | D23; D24; D25 |
| FR-9 (D29) | `product-spec.md:161` "The shared hook check passes in a worktree for both `core.hooksPath` forms. With the relative form the commit runs the worktree's own `.husky/pre-commit`, and without the `.husky/_` link it runs none (re-confirming the measured silent skip)." → "The shared hook check, run as plain single commands (one Bash call each), passes in a linked worktree under the absolute `core.hooksPath` that isolated worktree creation leaves, and a commit there runs the main checkout's `.husky/pre-commit`; a missing `info/exclude` line fails clause `exclude`; the worktree guard refuses none of the check's commands. The relative-form checks cannot be reproduced under workflow isolation (D29)." | D29 |
| Accepted Risks (D29) | `product-spec.md:256` + "Under workflow isolation this is every writer commit: isolated worktree creation leaves the value absolute (D29)." `:257` + "Under workflow isolation the link is inert; it covers a flip to the relative form during a run." | D29; D25 |
| AC-26, AC-38 | amended in place: AC-38's one-liner literals become the rendered `HOOK_STEPS` lines, plus a guard-parity check and a same-block-in-all-three check; AC-26 gains the split `.husky/_` link literals | D29 |
| AC-48 | amended in place: absolute form only (a split check that passes, a commit that runs `<M>/.husky/pre-commit`), `exclude`, guard parity of the split commands, and the background wrapper's `exit=3`. Relative and no-link sub-checks dropped (Rejected; Open Risk 1) | D29 |

The new ACs are AC-24..AC-44 and AC-46..AC-48. IDs are append-only. AC-45 (D19) and AC-36 (D23) are retired and never reused. In the D23 amendment, AC-47 and AC-48 are new, and AC-15, AC-17, AC-23, AC-25, AC-26, AC-35, AC-37, AC-38, AC-39 and AC-42 are amended in place. AC-1, AC-3..AC-12, AC-14, AC-16, AC-19, AC-20 and AC-22 are unchanged, and the design satisfies their literals as written. The D29 amendment adds and retires no AC: AC-26, AC-38 and AC-48 are amended in place, and AC-47 is unchanged because `hookMsg` and `hookBlocked` keep the six clause names.

---

### Assumptions

- **Editing ACs in place.** Editing the Then text of AC-2, AC-17 and AC-21 is allowed before launch with the IDs kept (D12). If the operator treats scenario text as immutable, tag them `@superseded` and move the text to AC-46+.
- **Raw-sha `--base`.** `merge-train-resolve.mjs` and `ledger-guard.py` accept a raw 40-hex `--base`. ledger-guard passes it to `git merge-base`/`rev-parse` (`:55-56`), which accept shas. For the resolver I saw only ref usage (`merge-train.js:109`); PR-0 checks it.
- **husky 9.1.7 behaviour.** It writes the relative `.husky/_` on `prepare` (`package.json:7`; measured, `context.md:251`).
  - Read in this checkout:
    - `.husky/_/pre-commit:2` sources `h`;
    - `h:6` exits 0 silently when the hook body is missing;
    - `h:14` exits 0 when `HUSKY=0`;
    - `h:16` prepends `node_modules/.bin` to `PATH`.
  - Those behaviours are why the HUSKY, `h` (wrapper + `h`) and `pre-commit` clauses exist.
- **Bash tool limits.** A single Bash call may take up to 600 s, so polls of at most 540 s leave margin. The Bash tool does not keep shell variables between calls; IR-2 is written as if it never does.
- **Shared config.** A linked worktree reads the shared `.git/config` (no `extensions.worktreeConfig`), so `git config core.hooksPath` gives the same answer in every worktree.
- **Spec headings.** Implementation-spec step headings are `### Step N — …` (`.claude/skills/sdd-spec/reference/spec-template.md:28`).
- **Main-worktree path.** `<M>`, the line `MAINWT` prints, contains no newline. Spaces are handled by quoting.
- **Scope of D9.** D9 triggers on `r.mismatches.length > 0` (a re-spec was required). No new SETUP field is added.
- **Preflight cwd.** A non-isolated agent runs at the main checkout root (recon § Amendment recon, "Patterns to REUSE"), so `HOOK_CHECK`'s relative paths resolve there.
- **`git rev-parse --git-common-dir`** prints `.git` in the main checkout and an absolute path in a linked worktree. Both name the one shared `info/exclude`.
- **Guard parity of the split forms (D29).** The one-line `HOOK_CHECK` and the grouped link line were refused in `wf_3ce0d1f3-477`.
  - Measured allowed in that run (transcript of `wf_3ce0d1f3-477`):
    - `MAINWT` (`git worktree list --porcelain | sed -n '1s/^worktree //p'`), `mkdir -p .sdd-logs`, `ls -d "<M>"/services/*/node_modules` and the `[ -e … ] || ln -s …` lines for `node_modules` and `services/<s>/node_modules`;
    - `git config core.hooksPath`, `git rev-parse --git-common-dir`, `command -v pnpm; echo "HUSKY=${HUSKY-unset}"`, `grep -nxF -e … <M>/.git/info/exclude`, `ln -s`, `rm`;
    - `bash .sdd-logs/run-1.sh` under `run_in_background`, and the VERIFY poll `for i in $(seq 1 108); do …; done; cat … || echo "exit=PENDING"`.
  - Assumed allowed, as plain single commands of measured kinds; the Step 1 close confirms them (AC-48): `printenv HUSKY`, `grep -qxF -- <line> "<C>/info/exclude"`, `test -e`, `test -d`, `wc -c`.

  The guard has no measured grammar (recon § "Amendment recon 2", "Not found"). A refused call ends the check as clause `unknown` (writerRules item 2).
- **A missing hooks dir is a silent skip (measured).** Orchestrator scratch repo, 2026-11-08: `core.hooksPath=.husky/_` with no such dir → exit 0, no hook, no warning (`context.md:312`). It is not re-confirmed in a linked worktree, because the relative form cannot be reproduced under workflow isolation (D29). This is the case the unconditional `.husky/_` link prevents (D25).
- **Worktree removal.** `.sdd-logs/` is ignored through `info/exclude`, so `git worktree remove` deletes it without `--force`, as it does the excluded links. The `.venv` that `uv sync` creates is ignored through `.gitignore:12`.
- **`grep -qxF --`, `printenv` and `test -f`** behave the same on BSD (macOS) and GNU.
- **Shared non-Node caches.** Concurrent writers under `pipeline` may run `uv sync` or `go mod download` at the same time. The uv cache and the Go module cache, both under `$HOME`, are assumed to tolerate concurrent writers. This has not been measured here. A collision would fail that step's own Verification; it cannot write `<M>` or `core.hooksPath`.
- **The `.husky/_` link is unconditional (D25, signed off).** The conditional-link runner-up is rejected (Rejected Alternatives).

## Rejected Alternatives

- **Writer self-repair of the hook** (every writer runs `pnpm exec husky`). The worktree guard refuses it (`cd`/`git -C` into the main checkout), and it would write the shared `core.hooksPath` from a workflow (D15, D23).
- **A separate preflight hook predicate.** Two sources of one fact, the `fails.md:3381` family; it led to the MAJOR-3 resume loop. One `HOOK_CHECK` instead (D15).
- **Moving the check into a script file, run as `bash <file>`, to get past the guard.** Rejected by the operator (D29): it routes around the guard instead of following its instruction, "Split it into plain, separate commands".
- **A one-line check in preflight, with split steps only in writers.** The guard does not apply to the non-isolated preflight, but two spellings of one predicate is what caused the MAJOR-3 resume loop. One `HOOK_STEPS` list renders both (D15).
- **One `grep -c` for the four exclude lines.** A duplicated line can stand in for a missing one in the count. Four `grep -qxF` calls decide each line by exit code.
- **Keeping `{ …; }` groups or `$( )` inside one call.** Refused by the guard (recon § "Amendment recon 2").
- **Re-measuring the relative form under workflow isolation (the former AC-48 relative and no-link sub-checks).** Isolated worktree creation leaves the value absolute before the agent runs, so these sub-checks cannot be set up (D29). Tracked as Open Risk 1.
- **A hook-setup stage** (worktree-isolated, or run without `isolation` in the main checkout).
  - Isolated, the guard refuses its install (`cd <M>`, run `wf_51d30eaf-c83`).
  - Non-isolated, a writer with Bash, Edit and Write would run `pnpm install` in the operator's live checkout from inside a workflow.
    - It would race other features under `pipeline` (`sdd-batch-execute.js:253`).
    - It would bring back the whole lock apparatus (old Risks 4, 5 and 7).
    - All of that would save one 15.8 s command per container.
  - Blocking with the exact remedy costs one relaunch (D23).
- **Writers append the missing `info/exclude` lines** (round 1). This breaks D23 consequence 1 (`context.md:279`). The lines persist per clone and are already present here (`.git/info/exclude:7-10`), so a precondition block costs at most one relaunch per clone.
- **The non-isolated preflight appends the lines.** Preflight is the read-only checker: its agent rules say never edit or change git config, and its prompt says "Never write". It also runs on every run, including halts that write nothing, before the record-matching confirm (F-10). Making it a writer changes the checker contract to save the same one relaunch.
- **A conditional `.husky/_` link (only when hooksPath is relative).** Rejected by D25.
  - It complies with D23 consequence 4 literally.
  - But husky `prepare` (`package.json:7`) rewrites the path to the relative form on any main-session `pnpm install`. If that flip happens after the writer's check, the commit runs with no hook and no warning (measured, `context.md:312`).
- **Requiring the absolute form as part of the precondition.**
  - The operator's own measured remedy writes the relative form (`context.md:251`), so it would fail the check.
  - It would need a main-session `git config` write every time.
  - It is the already-rejected "absolute main path" (`fails.md:3361`), and it would make Open Risk 16 universal.
- **Per-worktree unlinked `node_modules` with a writer-run install** (for example `pnpm install --frozen-lockfile --ignore-scripts` in the worktree). It would let a dependency-adding step run inside the workflow. But it costs a whole-workspace install in every writer, its interaction with the shared pnpm store under `pipeline` is unmeasured, and D26 directs that writers never run `pnpm install`. Kept as the follow-up if Open Risk 20 bites.
- **Main-worktree install alone.** A relative hooksPath resolves per worktree, so linked worktrees stay inert.
- **Rewriting `core.hooksPath` to an absolute main path.** It runs the main checkout's hook against branch content (`fails.md:3361`). The workflow still never writes it. An absolute value already in place is accepted (§1.2 notes, Open Risk 16, D24).
- **A writer-run `pnpm install` (per step, per `tooling-setup.md:30,43`, or plain).** Through the `node_modules` links it would:
  - write `<M>/node_modules`, racing other features under `pipeline` (`sdd-batch-execute.js:253`);
  - run `prepare: husky` (`package.json:7`), rewriting the shared `core.hooksPath` and `<M>/.husky/_/*`;
  - with a plain install, also rewrite the lockfile.

  The guard sees none of this (MAJOR-1, D26).
- **Install lock with a 3-poll blocker and a 20-minute stale age.** Self-contradictory, and it reclaimed live locks (m3).
- **Hiding the symlinks via a `.gitignore` edit.** That is a tracked change on every branch; `info/exclude` is local and root-anchored.
- **`git add -u` for the ledger-guard amend.** It can sweep in non-ledger edits.
- **The discover `Tree:` stamp.** It is caller-copied, so it always "matches" (`codebase-discovery.md:23-25`).
- **A distill halt on unreadable size.** It hides a preflight defect.
- **Keep-verbatim for whole fence-holding sessions (N5), and the runner-up N5(b), a separate setup session.** The first makes the setup session undistillable; the second changes the session layout (`SKILL.md:421`) for no gain.
- **Passing the fence's JSON text as `workflowSetup` and parsing it in the script.** Rejected for the mainDev-only value: less mechanism, and it carries the same fact.
- **`--absolute-git-dir`.** It breaks AC-23's literal; `$(cd "$(git rev-parse --git-dir)" && pwd)` instead (moot after D23: logs are in `.sdd-logs/`).
- **A heredoc commit form (`git commit -F - <<'SDD_MSG_EOF'`).** Replaced by a Write-tool message file in `.sdd-logs/`, which is the measured form. It needs no column-0 rule (IR-3 retired) and no shell quoting of the message. A message file under `.git/` stays rejected, because the guard refuses writes there.
- **Dropping the write-plan guard as scope creep.** The design itself introduces "writer returns commits []".
- **Operator-note scoping (former AC-45).** After a `blocker:<n>` halt every earlier step is done, so the first pending unit always contains n. Scoping only changed an artificial fixture (D19; AC-45 retired, never reused).
- **An integration-pr `commits.length` guard.** It falsely blocks a relaunch after a pushed promotion and a zero-scenario plan. Replaced by the url guard plus the open-PR prompt rule (D18).
- **A commit-message respec skip key (`Approved-record:` matching mainDev/specHash).** Unreachable: a pushed respec changes the spec blob, so later records never match, and an unpushed one dies with its worktree. The "mismatches empty" skip after re-validate is the working idempotency (N2).
- **Carried from the debate** (`context.md:19-29`): a step card, a deterministic evidence checker or verification runner, a persistent worktree, sonnet tiering, a setup-done cache, a context.md write-gate, a header-only read, `pipefail`/masking classifiers, once-per-feature tooling, replacing discover.

## Open Risks

These are accepted but unresolved; each is mirrored into `context.md` `## Open Threads`.

- [ ] 1. **(re-scoped, D29) The relative `core.hooksPath` form in a linked worktree stays unproven.** Accepted.
  - Isolated worktree creation leaves the shared value absolute (inferred from timing, `context.md:402`). The relative-form sub-checks (the link runs the branch's own body; no link means no hook) therefore cannot be reproduced under workflow isolation, and they were dropped from AC-48.
  - The check still accepts the relative form, and writers still make the `.husky/_` link (D25). A flip to relative during a run would therefore run the branch's own body through the link. That path is reasoned from `.husky/_/h:3-6`, not measured.
- [ ] 2. **HOOK_CHECK is structural.** It can pass while the hook no-ops on main-checkout dependencies that lag `devSha` (main-checkout dependencies can lag `devSha` because the workflow never installs). Only PR-0's measured hook output proves the hook fires.
- [ ] 3. **A residual worktree-only loop.** The main checkout passes (`hookFail` empty), but a writer's own check fails on `h` (link failed, relative form) or `pre-commit` (the branch lacks `.husky/pre-commit`). The writer's `HOOK_REMEDY` blocker then repeats on each relaunch, because preflight's main-checkout check passes. This is rare; the printed `hook-fail=<clause>` names the cause for the operator. Clause `exclude` cannot diverge, because both checks read the one shared file.
- [ ] 4. (dropped — D23: no workflow install, no lock)
- [ ] 5. (dropped — D23: no workflow install, no lock)
- [ ] 6. **(m5) Hooked merge commit.** If main-dev brings `services/xstockstrat-ui/` changes, the hook runs ui lint and jscpd (threshold 0) on debt this feature does not own (`.husky/pre-commit:10-13`). Setup then blocks with "hook failed on merge commit (main-dev content)". Measured in the re-spike: a merge bringing in 21 ui files took 29 s, wrote 30,824 B of log and passed. If it fails in practice, file a follow-up.
- [ ] 7. (dropped — D23: the workflow never runs husky)
- [ ] 8. (dropped — D18)
- [ ] 9. **Busy main-dev.** Any main-dev push between the halt and the approval re-halts upfront.
- [ ] 10. **D4.** A stale `resume` approval continues past a real checkpoint (accepted).
- [ ] 11. **Partial-setup crash.** It moves `dev`, so the relaunch costs one extra validate; the items then skip.
- [ ] 12. **Relaunch fatigue.** The operator may need to send upfront+record, distill and resume together; §4 shows the array form (`context-engineering.md:180-182`).
- [ ] 13. **Log lifetime.** Logs last only until the worktree is removed; the cited lines in `red`/`green` are the durable record.
- [ ] 14. (dropped — D23: the install is the operator's precondition, 15.8 s measured)
- [ ] 15. **`run_in_background` polling depends on the writer's Bash tool alone.** It was proven once through the wrapper-script form (`wf_3f24944b-f87`), but it is still a single-tool dependency.
- [ ] 16. **An absolute `core.hooksPath` runs a hook body outside the worktree, and under workflow isolation that applies to every writer commit (D29).** With `<X>/.husky/_`, `h:3-6` executes `<X>/.husky/pre-commit` in every worktree. The `.husky/_` link (D25) is inert in this case.
  - The only value observed is `<X>` = `<M>` (`context.md:251`), the main checkout's working-tree copy. A branch that edits `.husky/pre-commit`, or a main checkout on a branch with a different body, then gates commits with the wrong body.
  - Any other absolute `<X>` whose `h` and `pre-commit` exist is also accepted, and its body then gates every worktree's commits. D24 accepts this and does not tighten it.
  - There is no check for it. `h:16` still resolves tools from the worktree's own `node_modules` link.
  - If it bites, add a `pre-commit-body` step (`cmp -s "<B>/pre-commit" .husky/pre-commit`, a plain command). Having the main session set `git config core.hooksPath .husky/_` no longer helps, because isolated worktree creation rewrites it to absolute (D29).
- [ ] 17. **The absolute form's writer is inferred, not observed** (recon § "Amendment recon 2": isolated worktree creation, from timing). The value can still flip during a run, because an operator `pnpm install` writes the relative form.
  - HOOK_CHECK accepts both forms.
  - The `.husky/_` link is made unconditionally (D25), so a flip from absolute to relative after a writer's check still runs the branch's hook instead of none.
  - The residual window is a flip to a value HOOK_CHECK would reject, between the check and a commit. It is unguarded.
- [ ] 18. **The worktree guard is measured only in cloud sessions, and its grammar is unknown** (recon § Amendment recon and § "Amendment recon 2", "Not found"). The one-line HOOK_CHECK and the grouped link line were refused in `wf_3ce0d1f3-477`. IR-2 now uses only measured-allowed or AC-48-recorded forms and never a brace group (D29); AC-48 records that none of them is refused. A refused call ends the check as clause `unknown`. A laxer guard on macOS changes nothing.
- [ ] 19. **Precondition misses surface one clause at a time** (first failure wins, D15). A container failing both a hook clause and `exclude` costs two relaunches. A fresh clone needs the four exclude lines once (`EXCLUDE_REMEDY`).
- [ ] 20. **A step that needs a Node package the main checkout cannot provide stops the batch for that feature (D26).** This covers a step that adds or upgrades a Node dependency, and any later step that needs a package an earlier step of the same branch added.
  - Its packages and lockfile need a `pnpm install` that no writer may run.
  - The main checkout's lockfile (on main-dev) lacks the package, so the `--frozen-lockfile` remedy cannot help.
  - The writer blocks with "Node dependency change that only this branch adds — run this step with /sdd-execute outside /sdd-batch-execute", and never edits `pnpm-lock.yaml` by hand.
  - The guard cannot enforce the ban (a write through a link is invisible to it), so the prompt rule and AC-26 are the only controls.
  - Follow-up if this is common: the unlinked per-worktree install in Rejected Alternatives.
- [ ] 21. **Strongest risk (D29): the check is now evaluated by the agent.** The shell used to compute the result; now the agent reads each step's output and exit code against `passWhen`, fills in `<H>`, `<B>` and `<C>`, and names the first failing clause.
  - A misread in the safe direction, such as treating `printenv HUSKY`'s exit 1 as a failure, blocks with a wrong remedy.
  - A misread in the unsafe direction, such as a skipped step or a wrongly worked-out `<B>`, could let a writer commit with an inert hook.
  - Mitigations:
    - each `passWhen` names an exit code or an exact text;
    - the `test -f` steps re-check whatever `<H>` the agent accepted;
    - AC-38 pins the rendered steps, and AC-48 measures one real run.
    - A deterministic backstop: after a commit exits 0, a commit log under 400 bytes means the hook did not run, and the writer blocks (writerRules item 3). The hook prints 24–32 KB per commit (`context.md:267-272`); AC-48 run A records `commit-1.log`'s size.
- [ ] 22. **Preflight cost.** Item 13 now runs eleven one-line Bash calls instead of one, trading call count for a single source (D15). Each call prints at most one line, but the cost is paid per feature on every run.

## Constitution Rules Touched

- **P-01** (noted concern). `sdd-batch-writer` is the documented workflow-internal writer, one per stage, with the script as orchestrator (`context-engineering.md:161-163`). Recorded against the `:35` read-only default.
- **P-03.** Hook clauses name their failure; a confirmed miss and AskUserQuestion become blockers; writer no-ops block (FR-10).
- **P-04.** The upfront, distill, resume, merge-order and promotion gates are operator approvals.
- **C-01 / F-04.** The digest is re-verified, and a miss is a blocker.
- **C-02.** context.md is read in full.
- **F-05.** No commit before verification, unchanged.
- **F-08.** Staging is unchanged. Logs, message files and links never stage: `.sdd-logs/` and the links are root-anchored in the precondition `info/exclude` lines, which the shared check verifies.
- **F-09.** The re-spec stays the sole sanctioned body edit.
- **F-10.** Nothing is written before the record-matching confirm. No workflow agent writes a file under the main checkout itself, `core.hooksPath` included, and no writer runs a Node package install; git's own object/ref writes from a worktree are expected (D23, D26).
- **C-11.** Design-phase ledger touch: the `fails.md` entry on dir-only gitignore patterns.
- **C-15 / C-16.** ACs are appended or amended in place, and promotion keeps `@feature-301`.
- **C-18.** One constant per snippet; the remaining trade-offs are listed under Open Risks.
- **F-11.** No Floor breach.
- No Constitution edit.

## Business Rules Touched (C-16)

**Business rules:** PRESERVE `@AC-4`, `@AC-5` and `@AC-10` `@feature-278` (`docs/sdd/business-rules/platform.feature`):
- the wiring gate (`SKILL.md:310-317`) stays inside the scoped `## PER-STEP EXECUTION`;
- the `:301` edit leaves `:302-317` alone;
- the step-time and `--final` runs are log-based, with an explicit non-zero rule and "PENDING: does not block" (AC-33).

No CHANGE is made, so no C-16 sign-off is needed.
