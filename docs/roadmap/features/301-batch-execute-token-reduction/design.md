# Design: batch-execute-token-reduction

**Created**: 2026-11-06
**Rounds**: 7 (full; 5-round cap waived by the operator, D16; termination: approved)
**Approved by**: user @ 2026-11-06
**Grounded in**: recon.md

---

## Chosen Approach

Consumer surface: **none**. This is internal SDD tooling, used by the operator through the `/sdd-batch-execute` saved workflow (C-14, product-spec Consumer Surface). Decisions D1–D20 in `context.md` apply throughout.

The change edits one script (`.claude/workflows/sdd-batch-execute.js`), adds two workflow-internal agent types, makes a few edits to contract text, and extends one test file. No runtime service, proto, migration or config key changes.

### 1.0 Implementation rules (binding on every snippet below)

- **IR-1, escaping.** Every prompt constant and prompt function body is a JS **template literal**, except three:
  - `MAINWT`, `HOOK_CHECK` and `ENV_REMEDY` are **plain single-quoted strings**. `HOOK_CHECK` contains `${HUSKY-}` and must never become a template literal. Interpolating any of them with `${NAME}` is safe, because a substituted value is not re-parsed. Each is declared before `TOOLING_HOOK`, a module-level template that interpolates them at load; otherwise the load throws a TDZ ReferenceError.
  - Inside a template literal, a shell `${` must be written `\${` and a literal backtick must be written `` \` ``. `${…}` appears only where JS interpolation is intended.
  - None of the template literals below contains a shell `${`. They use only `$VAR`, `$(…)` and `$?`.
  - Every literal backtick is already shown escaped as `` \` ``. The existing code uses the same convention (`sdd-batch-execute.js:125-126`).
- **IR-2, one call per snippet.** Shell variables do not survive between Bash tool calls. Every multi-line snippet is ONE Bash call, and later calls use the literal path that call printed (`log=`, `clog=`, `lock=`).
- **IR-3, heredoc column.** The heredoc body lines and the closing `SDD_MSG_EOF` sit at column 0 in the JS source, because template literals keep their indentation.
- **IR-4, test strings.** Test-file assertions that contain `${HUSKY-}` use single-quoted JS strings.

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
description: Workflow-internal — the single writer for one /sdd-batch-execute stage (setup, hook-setup, step, write-plan) in its own worktree. Never select via Task.
tools: Bash, Read, Edit, Write, Glob, Grep
model: opus
---
```
Body:
- The same AC-2 literal sentence.
- "The prompt's git protocol and numbered items bind; return exactly the JSON schema; never use --no-verify; never push anywhere but the named dev branch."

**Wiring:**
- `agentType: CHECKER` on preflight and validate.
- `agentType: WRITER` on setup, hook-setup, step and write-plan.
- Unchanged: integration-pr keeps the default type (`:245`), discover keeps `codebase-discovery` (`:196`) and promotion-plan keeps `scenario-promoter` (`:238`).

### 1.2 Constants and schemas (extend `:47-103`; placement below)

Placement (load order, m-D):
- `HEX`, `CONTEXT_MAX`, `CHECKER`, `WRITER`, `canon`, `MAINWT`, `HOOK_CHECK` and `ENV_REMEDY` go after `:29` (`FOLD`).
- `SETUP` and `HOOKSETUP` go after `WRITE` (`:72-76`), because `SETUP` reads `WRITE.properties`.
- `PR` is extended in place (`:99-103`).
- `TOOLING_HOOK`, `READ_SCOPE` and `VERIFY` go after `PR` and before `toUnits` (`:106`), so every name they interpolate is already declared.

```js
const HEX = /^[0-9a-f]{40}$/
const CONTEXT_MAX = 65536
const CHECKER = 'sdd-batch-checker'
const WRITER = 'sdd-batch-writer'
const canon = (a) => JSON.stringify([].concat(a || []).map(Number).sort((x, y) => x - y))
// plain string (IR-1)
const MAINWT = 'M="$(git worktree list --porcelain | sed -n \'1s/^worktree //p\')"'
// plain string (IR-1); each clause names its own failure, first failure wins (D15)
const HOOK_CHECK = '{ [ "${HUSKY-}" != 0 ] || { echo hook-fail=HUSKY; false; }; } && { command -v pnpm >/dev/null || { echo hook-fail=pnpm; false; }; } && { [ "$(git config core.hooksPath)" = .husky/_ ] || { echo hook-fail=hooksPath; false; }; } && { [ -f .husky/_/h ] || { echo hook-fail=h; false; }; } && { [ -f .husky/pre-commit ] || { echo hook-fail=pre-commit; false; }; }'
// plain string (IR-1); the one HUSKY/pnpm remedy for setup, hook-setup and every writer (m-I)
const ENV_REMEDY = 'provision pnpm 9.15.9 (npm install -g pnpm@9.15.9) or unset HUSKY in the launching environment, then re-send the same approvals'
```
- Each clause is grouped in `{ …; }`. Without the grouping, `A || B && C || D` would echo the wrong clause.
- `.husky/_` is the relative value that husky 9's `prepare` writes (`package.json:7,12`).
- An absolute value such as the one recorded at `fails.md:3361` fails the `hooksPath` clause. Branch (a) of item 1 then rewrites it.

Schemas:
- **PREFLIGHT** (`:47-62`) gains these properties, all added to `required`:
  - `mainDevSha`, `devSha`, `specHash`, `contextBytes`, `workflowSetup`: `{type:'string'}`
  - `hookLive`: `{type:'boolean'}`
- **SETUP** is new:
  ```js
  const SETUP = { type: 'object', properties: Object.assign({}, WRITE.properties, { tooling_blockers: { type: 'array', items: { type: 'string' } }, stale: { type: 'boolean' }, completed: { type: 'boolean' } }), required: WRITE.required.concat(['tooling_blockers', 'stale', 'completed']) }
  ```
- **HOOKSETUP** is new:
  ```js
  const HOOKSETUP = { type: 'object', properties: { hookLive: { type: 'boolean' }, tooling_blockers: { type: 'array', items: { type: 'string' } }, notes: { type: 'array', items: { type: 'string' } } }, required: ['hookLive', 'tooling_blockers', 'notes'] }
  ```
- **PR** (`:99-103`) gains `notes: {type:'array', items:{type:'string'}}`, which is required.

**TOOLING_HOOK** (template literal). It is setup item 1 and also the whole task of hook-setup.
```js
const TOOLING_HOOK = `1. Tooling + hook liveness (no commit). Run .claude/skills/sdd-execute/reference/tooling-setup.md DETECTION only for the toolchains the pending steps need (installs stay per step); add each unavailable toolchain with no documented fallback to tooling_blockers. Then, in this worktree after git-protocol item 2, run as ONE Bash call:
   ${MAINWT}; ${HOOK_CHECK}; echo "hook=$?"
   If it prints hook=0, hookLive is true; this item is done. Otherwise take the printed hook-fail=<clause>:
   - Clause HUSKY or pnpm: no remedy here. Add to tooling_blockers "pre-commit hook inert: hook-fail=<clause> — ${ENV_REMEDY}".
   - Any other clause: FIRST wait out a running install. Run: L="$(git rev-parse --git-common-dir)/sdd-husky.lock"; echo "lock=$L" and use the printed path as <L>. If [ -d "<L>" ]: if find "<L>" -maxdepth 0 -mmin +30 | grep -q . the lock is stale, so rmdir "<L>"; else poll, ONE Bash call each (at most 540 s): for i in $(seq 1 108); do [ -d "<L>" ] || break; sleep 5; done; [ -d "<L>" ] && echo lock=HELD || echo lock=FREE. If it is still HELD after 2 polls (and not stale), add to tooling_blockers "install lock held: <L> — if no pnpm install is running, rmdir <L> and re-send the approval" and end this item.
     Then:
     a. If [ -x "$M/node_modules/.bin/husky" ]: (cd "$M" && pnpm exec husky); echo "exit=$?". This takes seconds, is idempotent and leaves node_modules alone.
     b. Else if [ ! -d "$M/node_modules" ]: IL="$(mktemp "$(git rev-parse --git-dir)/sdd-install.XXXXXX")"; echo "log=$IL". Start, with run_in_background, substituting the literal <L>, <M> and <IL>:
          ( mkdir "<L>" || exit 75; trap 'rmdir "<L>"' EXIT; cd "<M>" && pnpm install --frozen-lockfile ) >"<IL>" 2>&1; echo "exit=$?" >"<IL>.exit"
        then poll, ONE Bash call each (at most 540 s): for i in $(seq 1 108); do [ -f "<IL>.exit" ] && break; sleep 5; done; cat "<IL>.exit" 2>/dev/null || echo "exit=PENDING"; tail -n 20 "<IL>"
        exit=75 means another install won the lock: return to the lock wait above, then re-enter at a. Any other non-zero exit: add "pre-commit hook inert: install exit=<N> (log <IL>)" to tooling_blockers.
     c. Else add to tooling_blockers "main-checkout node_modules lacks husky — run \`pnpm install --frozen-lockfile\` in <M>, then re-send the approval".
     After a or b: redo git-protocol item 2's links, then run ${MAINWT}; ${HOOK_CHECK}; echo "hook=$?" again; if it still fails, add "pre-commit hook inert: hook-fail=<clause>" to tooling_blockers.
   hookLive = the last check printed hook=0. In setup, any tooling_blockers entry means completed:false, no commits, and no further item.`
```
Notes on item 1:
- The lock is checked before any a/b/c branching. The blocker fires at 2 polls (at most 18 min), which is less than the 30-minute stale age (m3).
- `--frozen-lockfile` never rewrites the operator's `pnpm-lock.yaml`, and it is what CI runs (`sequential-mode.md:239`).

**READ_SCOPE** (template literal, no interpolation; FR-6):
```js
const READ_SCOPE = `Read ONLY the following; a section runs from its heading to the next heading of the same or higher level (locate with grep -n):
- .claude/skills/sdd-execute/SKILL.md: "## PER-STEP EXECUTION" (skip its "### STEP COMMIT + PR" subsection; PHASE 3's config-key wiring gate stays in scope), "## DEVIATION HANDLING", "## CONTEXT.MD — Per-step entry format" and "## HARD CONSTRAINTS".
- .claude/skills/sdd-execute/reference/sequential-mode.md: §5.5, §5.7, "## Sequential-mode carve-outs" and "## Sequential-mode verification fallbacks".
- reference/tdd-gate.md and reference/tooling-setup.md in full (install only what this step needs, pinned).
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
const VERIFY = `VERIFICATION protocol (judgment unchanged). For EACH verification run (the RED run, the GREEN run and every re-run) make a NEW log, first in its own foreground Bash call:
  LOG="$(mktemp "$(cd "$(git rev-parse --git-dir)" && pwd)/sdd-verify.XXXXXX")"; echo "log=$LOG"
Use that printed literal path as <LOG>. Run the step's Verification block verbatim, once; insert nothing; no \`set -e\`, no \`set -o pipefail\`:
- If it can finish within 540 s: ONE Bash call with timeout 600000: ( <fence> ) >"<LOG>" 2>&1; echo "exit=$?"
- Otherwise (a suite or build that may run longer), start it with run_in_background: ( <fence> ) >"<LOG>" 2>&1; echo "exit=$?" >"<LOG>.exit"
  and poll, each call at most 540 s: for i in $(seq 1 108); do [ -f "<LOG>.exit" ] && break; sleep 5; done; cat "<LOG>.exit" 2>/dev/null || echo "exit=PENDING"
  Re-poll on exit=PENDING, up to 6 polls; after that the run FAILED (timeout). A foreground call that times out is FAILED; re-run it in the background form with a NEW log.
A finished run with no \`exit=\` line is FAILED. Then read: grep -nE 'FAIL|Error|error:|panic|Traceback|not ok|AssertionError' "<LOG>" | head -n 40; tail -n 60 "<LOG>". Read the FULL log on a non-zero exit, on any expectation you cannot confirm, or on surprising output. Judge exactly as SKILL.md PHASE 3: RED fails for the right reason, or "red N/A — no behavior change; characterization test added"; GREEN cites the executed count and the coverage line. Cite ONLY lines from this run's log; put the cited lines, the exit= line and the log path into red/green. The log lives only until this worktree is removed, so no later "full log" exists.
Config-key wiring gate (C-16): when SKILL.md PHASE 3's config-key wiring gate applies, node scripts/check-config-wiring.mjs (step-time) and, on the feature's last step, node scripts/check-config-wiring.mjs --final are separate commands from the Verification block. Run each the same way, with its own NEW log and exit= line. A non-zero exit keeps the step not-done; quote its finding and key lines. PENDING: findings do not block at step time.`
```
The red-N/A wording matches `tdd-gate.md:56`. The wiring-gate wording matches `SKILL.md:310-317,323-325`.

### 1.3 writerRules (replaces `:123-133`)

```js
function writerRules(f, p) {
  return `You are executing /sdd-execute ${f.slug} sequential for feature ${p.dir} (docs/roadmap/features/${p.dir}/), dev branch ${p.devBranch}. You run in your own git worktree and are the only writer for this unit of work (P-01). Shell variables do not survive between Bash calls: run each snippet below as ONE Bash call and, in later calls, use the literal paths it printed. Mandatory git protocol:
1. \`git fetch origin\` then \`git checkout --detach origin/${p.devBranch}\`. Never check out a named local branch.
2. Hook wiring before any commit, as ONE Bash call; every line is idempotent:
${MAINWT}
[ -e node_modules ] || ln -s "$M/node_modules" node_modules
for d in "$M"/services/*/node_modules; do s="services/$(basename "$(dirname "$d")")/node_modules"; [ -d "$d" ] && [ ! -e "$s" ] && ln -s "$d" "$s"; done
[ -e .husky/_ ] || { [ -d "$M/.husky/_" ] && ln -s "$M/.husky/_" .husky/_; }
X="$(git rev-parse --git-common-dir)/info/exclude"; mkdir -p "$(dirname "$X")"
for L in /node_modules '/services/*/node_modules' /.husky/_; do grep -qxF "$L" "$X" || echo "$L" >> "$X"; done
${HOOK_CHECK}; echo "hook=$?"
   If it prints hook≠0 and your task is setup or hook-setup, follow that task's item 1. Any other task: never install anything and make NO commit. A step returns result 'blocker', options [], blocker "pre-commit hook inert (hook-fail=<clause>) — <remedy>"; any other writer returns commits [] with that text in notes. <remedy> for HUSKY or pnpm: "${ENV_REMEDY}". <remedy> for hooksPath, h or pre-commit: "re-send the resume approval {gate:'resume', decision:'proceed'}; that run's hook-setup repairs it". Never use --no-verify. A "dirty tree" means \`! git diff --quiet\` (tracked files only; the links are excluded and never count).
3. Make every commit as ONE Bash call of exactly this form; the closing SDD_MSG_EOF line starts at column 0 with nothing else on it:
CLOG="$(mktemp "$(cd "$(git rev-parse --git-dir)" && pwd)/sdd-commit.XXXXXX")"
git commit -F - >"$CLOG" 2>&1 <<'SDD_MSG_EOF'
<subject>

<body>
${A.trailer}
SDD_MSG_EOF
echo "exit=$?"; tail -n 20 "$CLOG"; echo "clog=$CLOG"
   The message body ends with the trailer lines above, verbatim; never write a message file. Amend in the same shape: CLOG="$(mktemp "$(cd "$(git rev-parse --git-dir)" && pwd)/sdd-commit.XXXXXX")"; git commit --amend --no-edit >"$CLOG" 2>&1; echo "exit=$?"; tail -n 20 "$CLOG"; echo "clog=$CLOG". On exit≠0 read the printed clog file in full, fix the cause and commit again.
4. \`git push origin HEAD:refs/heads/${p.devBranch}\` after every commit; retry up to 4 times (2s/4s/8s/16s) on network errors only. Never push elsewhere, never force-push.
5. <unchanged :130 text, "Push after EACH artifact edit … no commit before verification">
6. Return every commit sha you created, in order, as \`commits\`.
Use ${A.date} for history rows and session headers. Severity tokens: only ${p.severity} may appear. Every HARD CONSTRAINT of .claude/skills/sdd-execute/SKILL.md applies (no guessed paths/symbols, no commit before verification passes, migration immutability, never start a database).`
}
```
- Items 4–6 and the closing paraphrase are verbatim from `:129-132`. `test.mjs:43-46` still holds.
- Why the links are excluded: `.gitignore:23` `**/node_modules/` matches directories only, and a symlink is not a directory. `.husky/_` is not ignored at all. Root-anchored patterns in the common `info/exclude` cover every linked worktree.

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
13. hookLive: run \`${MAINWT}; (cd "$M" && ${HOOK_CHECK}); echo "hook=$?"\` as ONE Bash call (it only reads); true iff it prints hook=0.
ok = no problems.`, { agentType: CHECKER, phase: 'Preflight', schema: PREFLIGHT, label: `preflight:${f.slug}` })
```
- Items 1–5 and 7 are today's text (`:142-148`), with "origin/<devBranch>" replaced by "at <devSha>".
- Item 13 runs the same `HOOK_CHECK` constant against the main checkout (D15), so preflight and the writers cannot drift apart.
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
  // a stop takes precedence over every no-write gate (N1)
  if (stopping) { out.stage = 'stopped'; return out }
  const setupDone = p.status === 'in-progress' && HEX.test(p.workflowSetup)
  const resuming = setupDone && (!!ap || proceeds('resume'))
  if (pending.length) {
    // 1. distill
    if (!/^\d+$/.test(p.contextBytes)) { out.blocked = `context.md size unreadable (contextBytes: ${p.contextBytes})`; return out }
    if (Number(p.contextBytes) > CONTEXT_MAX && !proceeds('distill')) {
      out.halted = { gate: 'distill', bytes: Number(p.contextBytes), limit: CONTEXT_MAX, question: `Run /sdd-distill ${f.slug} on ${p.devBranch}, or approve {gate:'distill', decision:'proceed'} (re-send on every relaunch).` }
      return out
    }
    // 2. resume
    if (setupDone && !resuming) {
      out.halted = { gate: 'resume', question: "Workflow setup is done for this feature. Approve {gate:'resume', decision:'proceed'} (re-send on every relaunch)." }
      return out
    }
  }
  // hook-setup: only when this run will commit without passing through setup (m2: not on the merge-order halt)
  const writesWithoutSetup = pending.length ? resuming : !(p.mergeOrderBlock && !proceeds('merge-order'))
  if (!p.hookLive && writesWithoutSetup) {
    const hs = await agent(`${WR}\n\n${ctx}\nHOOK-SETUP ONLY: make no commits, no push and no file edits; ignore git-protocol item 6 and return {hookLive, tooling_blockers, notes}. Do only item 1 below, and skip item 1's DETECTION sentence (toolchain detection stays with setup and each step).\n${TOOLING_HOOK}`, { agentType: WRITER, phase: 'Gate', schema: HOOKSETUP, isolation: 'worktree', label: `hook-setup:${f.slug}` })
    if (!hs) { out.blocked = 'hook-setup agent died'; return out }
    if (hs.tooling_blockers.length || !hs.hookLive) { out.blocked = `tooling: ${hs.tooling_blockers.join('; ') || 'pre-commit hook inert'}`; return out }
  }
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
        gate: 'upfront', record, directive, respec: v.mismatches, tooling_blockers: v.tooling_blockers,
        blocked_step: blockedStep ? blockedStep.n : null,
        plan: toUnits(pending).map((u) => `${u.members.map((m) => m.n).join('+')}. ${u.title} [${u.surface}]`),
        question: `Proceed with ${pending.length} pending step(s)${v.mismatches.length ? `, re-spec'ing steps ${stepList(v.mismatches)} per directive ${directive}` : ''}?${roll}${none} Approve with {gate:'upfront', decision:'proceed', record:<this halt's record, verbatim>}.`,
      }
      return out
    }
    if (directive === 'none' && r.mismatches.length) { out.blocked = `directive none: steps ${stepList(r.mismatches)} mismatch; re-send with directive conditional or explicit (this re-validates)`; return out }
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
- The upfront halt always fires when there is no matching record, so nothing is written before a record-matching confirm (D2, F-10).

**Step loop edits (`:188-198`):**
- `:191` is deleted. The `stopping` return in the Gate block (above the hook-setup check) replaces it (m-G).
- `:189-190`, the `${operatorNote ? …}` in the `:197` prompt and `:198` `operatorNote = null` stay as today (D19: no note scoping).

### 1.6 setupTask (new function next to writerRules; replaces the `:178` prompt)

```js
function setupTask(f, p, rec) {
  const R = JSON.stringify(rec)
  const ms = rec.mismatches.map((m) => m.n).join(',')
  return `Operator approved the up-front plan with this record (binding, verbatim): ${R}
Do the items below IN ORDER. Each item that changes a file is one commit (git-protocol item 3 form), pushed (item 4) before the next item; "Skip if" means do nothing for that item. Wherever loaded skill text says AskUserQuestion, add a tooling_blockers entry or note instead. Return commits, notes, tooling_blockers, stale and completed.
0. Stale check (no commit). \`git fetch origin\`; if \`git rev-parse origin/main-dev\` ≠ ${rec.mainDev} or \`git rev-parse origin/${p.devBranch}\` ≠ ${rec.dev}: return stale:true, completed:false, commits []. Else \`git checkout --detach ${rec.dev}\` and redo git-protocol item 2.
${TOOLING_HOOK}
2. Merge. Skip if \`git merge-base --is-ancestor ${rec.mainDev} HEAD\`. Else \`git merge --no-commit --no-ff ${rec.mainDev}\` (never -X), then ONE Bash call: ${MAINWT}; node "$M"/scripts/merge-train-resolve.mjs --base ${rec.mainDev} --own-slug ${f.slug}; echo "exit=$?"
   - exit 2: \`git merge --abort\`; note "unresolvable: <each path: reason> — merge origin/main-dev into ${p.devBranch} by hand resolving <paths>, push, start a NEW run"; completed:false; stop.
   - any other non-zero exit or a throw: \`git merge --abort\`; note "resolver exit <N>: <last line>"; completed:false; stop.
   - exit 0: commit the merge, subject "Merge ${rec.mainDev} into ${p.devBranch}". If the hook fails: \`git merge --abort\`; note "hook failed on merge commit (main-dev content) (last 20 lines): <tail>"; completed:false; stop.
   Then: python3 scripts/ledger-guard.py --own-slug ${f.slug} --base ${rec.mainDev} --fix; echo "exit=$?"
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
  > "`sdd-batch-checker` (preflight, validate; read-only) and `sdd-batch-writer` (setup, hook-setup, step, write-plan) are workflow-internal agent types; the writer is the one exception to §1's read-only default (`:35`). hook-setup runs, with no commits, when preflight's `hookLive` is false on a run that commits without passing through setup. It may run `pnpm exec husky`, or `pnpm install --frozen-lockfile` only if the main checkout has no `node_modules`; both rewrite the shared `core.hooksPath` (D10)."
- **Operational note, appended at `:221`:**
  > "Writers append `/node_modules`, `/services/*/node_modules` and `/.husky/_` to `$(git rev-parse --git-common-dir)/info/exclude`; verification and commit logs live under the worktree's git dir and vanish with it."
- **`.claude/context-map.yaml`:**
  - The `:15` header becomes `# --- Subagent fleet: isolated windows that return condensed digests (read-only unless noted) ---`.
  - Append two entries:
    - `sdd-batch-checker`: path `.claude/agents/sdd-batch-checker.md`; returns "preflight/validate JSON for one feature"; `used_by: [sdd-batch-execute]`.
    - `sdd-batch-writer`: path `.claude/agents/sdd-batch-writer.md`; returns "commits + stage result (writes; workflow-internal)"; `used_by: [sdd-batch-execute]`.

### 1.12 Test changes (`scripts/workflow-tests/sdd-batch-execute.test.mjs`; `harness.mjs` is unchanged)

**Constants and fixtures:**
- Add `const MD='a'.repeat(40), DV='b'.repeat(40), SH='c'.repeat(40)` and `const REC = {mainDev:MD, dev:DV, specHash:SH, directive:'conditional', pending:[1,2,3], mismatches:[]}`.
- `pre()` (`:11`) defaults gain `mainDevSha:MD, devSha:DV, specHash:SH, contextBytes:'1000', workflowSetup:'', hookLive:true`. Without `hookLive:true`, the existing blocks would hit "no mock for hook-setup:".
- `replies()` (`:13-22`):
  - `setup:` gains `tooling_blockers:[], stale:false, completed:true`;
  - `integration-pr:` gains `notes:[]`;
  - a new key `'hook-setup:': {hookLive:true, tooling_blockers:[], notes:[]}`. Prefix matching at `harness.mjs:13` keeps `hook-setup:` distinct from `setup:`.

**Fallout in existing blocks:**
- Block 1 asserts `halted.record` deep-equals REC.
- Blocks 2, 7(a) and 8(b) send `{gate:'upfront', decision:'proceed', record:REC}` and assert 0 `validate:` calls.
- Blocks 3, 7(b) and 9 set `workflowSetup: MD` (status in-progress).

**New tests:**
- Each new AC gets a test written RED first (`context-engineering.md:226`).
- Count stage calls with `label.startsWith`, never `includes`.
- Static checks (AC-2, AC-16, AC-19, AC-27) read files with `fs`.
- Assertions that contain `${HUSKY-}` use single-quoted strings (IR-4).

### 1.13 Build order (tests first)

**PR-0 spike** (throwaway branch, never merged; FR-9, AC-17, AC-20). It must prove:
- `agentType` composes with `isolation:'worktree'`.
- The checker calls `list_pull_requests`, and the transcript records whether a ToolSearch select preceded the call.
- The first turn of each agent is ≤30K tokens.
- A real writer step in a linked worktree, after `pnpm exec husky` plus the `.husky/_` and `node_modules` links, runs husky's `_/h` → `.husky/pre-commit` → lint-staged.
- Hook wall time and output bytes for:
  - a plain commit;
  - a commit staging `services/xstockstrat-ui/`;
  - a setup merge commit whose merge brings in ui files (m5).
- `pnpm exec husky` writes the relative `.husky/_`.
- `run_in_background` with `.exit` polling works under the writer's tools.
- `git cat-file -s` works.
- `merge-train-resolve.mjs --base <sha>` and `ledger-guard.py --base <sha>` accept a raw sha.
- bash 3.2 behaves the same for `( )`, `wc -c | tr -d ' '`, `mktemp <dir>/X`, the `mkdir` lock, `find -maxdepth 0 -mmin +30`, and a column-0 quoted heredoc.
- No `~/.config/husky/init.sh` sets `HUSKY=0`.
- `CONTEXT_MAX` is calibrated from features 282, 289 and 294.

Spike outcomes:
- If composition fails, fall back to AC-20.
- If the MCP tool is unreachable by either path, preflight keeps the default type. Return to the operator before Step 1 (P-04).

**Integration branch**, each step RED test → change → GREEN, one commit:
1. Agents, agentType wiring and context-map entries. AC-1, AC-2.
2. Constants, schemas, preflight prompt and the full Gate block, with the fixture fallout. AC-3–12, 21, 22, 24, 28–31, 34–37, 40.
3. TOOLING_HOOK, setupTask and writerRules. AC-13, 18, 25, 26, 38, 39, 41.
4. READ_SCOPE, VERIFY and the step prompt. AC-14, 15, 23, 32, 33, 42.
5. Land guards and the PR schema. AC-43, AC-44.
6. `SKILL.md:301` (docs, `TDD: N/A`, static assert written first). AC-19.
7. Distill fence rule. AC-27.
8. §4 and the context-map header. AC-16, plus `check-context-map.sh`.

**Touchpoints:**
- Files: `.claude/workflows/sdd-batch-execute.js`; `.claude/agents/sdd-batch-{checker,writer}.md` (new); `scripts/workflow-tests/sdd-batch-execute.test.mjs`; `.claude/skills/sdd-execute/SKILL.md:301`; `.claude/agents/context-distiller.md`; `.claude/skills/sdd-distill/SKILL.md:108`; `docs/patterns/context-engineering.md` §4; `.claude/context-map.yaml`.
- Proto, migration, config and services: none.
- Runtime side effect: the shared `.git/config` `core.hooksPath`, plus `$M/node_modules` only when it is missing (D10, D13).

**Reuses:**
- The promotion-plan fence pattern (`:148,240`, schema `:60`).
- `approvals()` / `proceeds()` (`:119-121,138`).
- The merge-train update protocol (`merge-train.js:107-111`).
- `ledger-guard --fix` (`:55-58,87`).
- The agentType + schema composition (`sdd-batch.js:183-184`).
- The agent frontmatter shape (`codebase-discovery.md:1-6`).
- The `/sdd-distill` machinery (`sdd-distill/SKILL.md:102-116`).
- The harness prefix mocks (`harness.mjs:12-16`).
- One constant each for `MAINWT`, `HOOK_CHECK`, `ENV_REMEDY`, `TOOLING_HOOK`, `READ_SCOPE` and `VERIFY` (C-18).

---

### Spec Changes (D12)

These are applied to `product-spec.md` and `acceptance.feature` in this design phase. `/sdd-review product-spec` re-runs before `/sdd-spec`.

| Item | Old → New (final text in product-spec.md) | Driver |
|---|---|---|
| FR-1 | Checker tools "`Bash, Read, Glob, Grep, mcp__github__list_pull_requests`; … directly, without ToolSearch" → "`Bash, Read, Glob, Grep, ToolSearch, mcp__github__list_pull_requests`; preflight calls the GitHub tool directly, or selects it with ToolSearch when it is not callable directly; on a tool error it retries once after about 10 s, then reports "PR lookup unavailable" (distinct from "no open PR")". Writer "setup, step and write-plan" → "setup, hook-setup, step and write-plan". Doc literal → "Workflow-internal — spawned only by .claude/workflows/sdd-batch-execute.js; never delegate from a skill session. Never select via Task." | r2 N1; D15 |
| FR-2 | "the pending step numbers are all equal" → "… compared as a sorted numeric list". Append: "Any non-40-hex `mainDevSha`/`devSha`/`specHash` blocks the run ("non-hex sha"). With directive `none`, a matching record that has mismatches blocks before setup ("directive none: steps X mismatch; …")." Pin: the specHash source "`origin/<dev>:<dir>/implementation-spec.md`" (`product-spec.md:34`) → "`git rev-parse <devSha>:docs/roadmap/features/<dir>/implementation-spec.md`". A record whose `pending` or `mismatches` is not an array never matches (re-validates). | r3 non-hex; N9; canon; m-K; m-F |
| FR-3 | Append: "After a setup that made a `respec(` commit, the run ends at `resume` (D9). When preflight's `hookLive` (the shared hook check run in the main checkout) is false on a run that will commit without setup (resume with pending steps and no `stop here`, or Land past merge-order), a no-commit `hook-setup` writer runs first; its failure blocks." | D9; D15; m2 |
| FR-4 | "… or its size cannot be read, the run halts at `distill`" → "… (`git cat-file -s <devSha>:docs/roadmap/features/<dir>/context.md`) … When the size cannot be read, the run is blocked with "context.md size unreadable" (a read failure is a defect, not a size)." | r2 N4; D12 (AC-21 inverted) |
| FR-5 item 1 | "Tooling detection" → "Tooling detection and pre-commit hook liveness (the shared `HOOK_CHECK`, each clause naming its failure). HUSKY/pnpm failures → tooling blocker. Otherwise, after any running install's `sdd-husky.lock` clears (blocker at 2 polls; stale after 30 min): `pnpm exec husky` in the main worktree if its husky bin exists; else `pnpm install --frozen-lockfile` only when `$M/node_modules` is missing, under the mkdir lock; else blocker. Re-link, re-check; still inert → `tooling_blockers`, no commits." | D10; D13; m3; D15 |
| FR-5 item 2 | "exit 2 → resolve by hand" → "any non-zero exit → `git merge --abort`, no commits, `completed:false`, one note per cause: unresolvable … start a NEW run (exit 2, D7) / resolver exit N / hook failed on merge commit (main-dev content) / ledger-guard exit N (then `git reset --hard`)". Ledger-guard "amended" → "`git add -- docs/roadmap/ledger/`; a tracked non-ledger change (`! git diff --quiet`) resets to the record's dev sha and blocks; else `--amend` only if something is staged; nothing staged → continue (D17)". Non-fast-forward push → `stale:true`. | D7; r4 ledger amend; m5 |
| FR-5 (append) | "Every writer commit and amend uses the quoted-heredoc CLOG form (`git commit -F - >"$CLOG" 2>&1 <<'SDD_MSG_EOF'`, closing delimiter at column 0, `tail -n 20`). Writers link root and per-service `node_modules` and `.husky/_`, add root-anchored patterns to `info/exclude`; a dirty tree is `! git diff --quiet`. A non-setup writer that finds the hook inert never installs and returns a blocker (step) or `commits []` + note, with a remedy keyed on the failing clause." | M1; M3; m1; D15 |
| FR-6 | sequential-mode line → "§5.5, §5.7, the carve-outs and the verification fallbacks". Append: "The discovery digest is advisory; the step re-verifies every not-found claim and every path:line it acts on at origin/<devBranch>. Wherever loaded skill text says AskUserQuestion, the step returns result:'blocker'." | N3; N7 |
| FR-7 | "a new log outside the worktree" → "a new `mktemp` log under `$(cd "$(git rev-parse --git-dir)" && pwd)`, path echoed first; a run longer than 540 s uses `run_in_background` with a `.exit` sentinel and ≤540 s polls; a timeout is FAILED; the log lives until the worktree is removed". Append: "The config-key wiring gate (step-time and `--final`) runs the same way with its own log." SKILL.md:301 line → the "SKILL.md:301" text above, all modes (D11). | N6; Δ9/Δ10; N8; D11 |
| FR-8 | Append: "`/sdd-distill` and `context-distiller` reproduce every fenced `sdd-batch-*` block byte-for-byte and in order (D8). The context-map agents header notes that not every agent is read-only. §4 documents hook-setup, `info/exclude` and log lifetime." | D8; N5 |
| FR-9 | "an MCP tool … callable without ToolSearch" → "a checker can call `mcp__github__list_pull_requests`, and which path it used". "husky firing" → "husky firing in a linked worktree through the symlinked `.husky/_` after the hook-liveness remedy, with hook time/output measured for a ui commit and a ui-bearing merge commit". Add "background-run polling; raw-sha `--base` for the resolver and ledger-guard". | N1; M3; m5 |
| FR-10 (new) | "No silent writer no-op: write-plan with no commit, or a dead write-plan, blocks ("write-plan made no commit"); integration-pr with no url blocks ("integration-pr incomplete: <notes>", or "no PR url" when it returns no notes); the integration-pr prompt opens the PR only once the promotion commit is pushed now or the plan is already applied at the dev-branch tip; the PR result gains `notes`." | MAJOR-5; fails.md:3361-3363; D18 |
| Out of Scope | last bullet + ", except the `SKILL.md:301` wording (D11)" | D11 |
| Affected Services | + `context-distiller.md`, `sdd-distill/SKILL.md` (D8); + main-checkout `.git/config` `core.hooksPath` / `node_modules` (D10/D13) | D8; D10 |
| Known Traps | `fails.md:3361-3363` line → "Setup and hook-setup check liveness with one shared check and repair per D13; other writers block with a clause-keyed remedy." | D15 |
| Accepted Risks | + "When the main checkout's hook is live but a writer's own check fails on clause `h` or `pre-commit` (worktree link failed, or the branch lacks `.husky/pre-commit`), the 're-send resume' blocker repeats, because hook-setup is skipped; the printed `hook-fail=<clause>` names the cause (design Risk 3)." + "When a setup merge brings in `services/xstockstrat-ui/` changes, the pre-commit hook may fail on main-dev content this feature does not own, and setup blocks with 'hook failed on merge commit (main-dev content)'; the FR-9 spike measures how often (design Risk 6)." | m-K; Risk 3; Risk 6 |
| AC-2 | amended in place: checker tools line + description line | N1 |
| AC-13 | amended in place: the "status.md" < "sdd-batch-setup" ordering is measured in the text after "Operator approved the up-front plan" (writerRules item 5 names status.md, so the unanchored check was vacuous) | m-B |
| AC-17 | amended in place: ToolSearch-records line, linked-worktree symlinked hook line, hook cost line incl. merge commit | N1; M3; m5 |
| AC-18 | amended in place: "items 2–6 contain push" is measured on the column-0 items in the text after "Operator approved the up-front plan" (writerRules' own items 2 and 3 have no push) | m-B |
| AC-21 | inverted: distill halt → blocked "context.md size unreadable" | N4; D12 |
| AC-24 | new: inert hook blocks setup | D10 |
| AC-25 | new (round-3 draft amended): show-toplevel dropped; asserts "pnpm exec husky", "sdd-husky.lock"; ordering anchored after "1. Tooling + hook liveness" | MAJOR-4 |
| AC-26 | new (merged): links, exclude, `! git diff --quiet`, clause-keyed remedy; no install strings | M1; D15 |
| AC-27..AC-34 | new (round-3 text) | D8; D7; D9; N9; non-hex; N3/N7; N8; N1 |
| AC-35..AC-40 | new (round-4 text; AC-37 extended for m2, AC-38 for m3 + the shared check, its Given split per m-C and the DETECTION-skip line per m-H) | D13; D15; m2; m3; canon; m-C; m-H |
| AC-41 | new (round-4 draft amended): anchored after "ledger-guard.py"; also asserts "! git diff --cached --quiet" and "nothing to amend" | MAJOR-4; D17 |
| AC-42 | new | Δ9/Δ10 |
| AC-43 | new: write-plan guard (incl. dead agent), tagged @FR-10 | MAJOR-5 |
| AC-44 | new: integration-pr guard keyed on url only, plus the open-PR prompt rule | MAJOR-5; D18 |
| AC-45 | retired (D19); never reused | D19 |
| AC-3 | amended in place (post-design review): concrete validate mismatches in Given and Then | /sdd-review re-run (D12) |
| AC-17 | + agentType/worktree composition, background polling and raw-sha `--base` lines | /sdd-review re-run (D12) |
| AC-46 | new: a record whose `pending`/`mismatches` is not an array re-validates (FR-2) | /sdd-review re-run (D12); m-F |

The new ACs are AC-24..AC-44. IDs are append-only. AC-45 retired (D19); never reused. AC-1, AC-3..AC-12, AC-14..AC-16, AC-19, AC-20, AC-22 and AC-23 are unchanged, and the design satisfies their literals as written.

---

### Assumptions

- **Editing ACs in place.** Editing the Then text of AC-2, AC-17 and AC-21 is allowed before launch with the IDs kept (D12). If the operator treats scenario text as immutable, tag them `@superseded` and move the text to AC-46+.
- **Raw-sha `--base`.** `merge-train-resolve.mjs` and `ledger-guard.py` accept a raw 40-hex `--base`. ledger-guard passes it to `git merge-base`/`rev-parse` (`:55-56`), which accept shas. For the resolver I saw only ref usage (`merge-train.js:109`); PR-0 checks it.
- **husky 9.1.7 behaviour.** It writes the relative `.husky/_` on `prepare` or `pnpm exec husky`, and its `h` exits 0 silently when `HUSKY=0` or the hook file is missing. That is why those two clauses exist. I did not read husky's source.
- **Bash tool limits.** A single Bash call may take up to 600 s, so polls of at most 540 s leave margin. The Bash tool does not keep shell variables between calls; IR-2 is written as if it never does.
- **Shared config.** A linked worktree reads the shared `.git/config` (no `extensions.worktreeConfig`), so `git config core.hooksPath` gives the same answer in every worktree.
- **Spec headings.** Implementation-spec step headings are `### Step N — …` (`.claude/skills/sdd-spec/reference/spec-template.md:28`).
- **Main-worktree path.** `$M` (the first porcelain `worktree` line) contains no newline. Spaces are handled by quoting.
- **Scope of D9.** D9 triggers on `r.mismatches.length > 0` (a re-spec was required). No new SETUP field is added.

## Rejected Alternatives

- **Writer self-repair of the hook** (every writer runs branch a). It widens D10's grant on the shared `core.hooksPath` beyond setup and hook-setup (D15).
- **A separate preflight hook predicate.** Two sources of one fact, the `fails.md:3381` family; it led to the MAJOR-3 resume loop. One `HOOK_CHECK` instead (D15).
- **Blocking once instead of running hook-setup.** It costs a round-trip and a relaunch, and the operator then runs the same `pnpm exec husky` by hand.
- **Main-worktree install alone.** A relative hooksPath resolves per worktree, so linked worktrees stay inert.
- **Rewriting `core.hooksPath` to an absolute main path.** It runs the main checkout's hook against branch content (`fails.md:3361`).
- **Installing in every step, or plain `pnpm install`.** These cause concurrency on the main checkout, and plain install may rewrite the lockfile.
- **Install lock with a 3-poll blocker and a 20-minute stale age.** Self-contradictory, and it reclaimed live locks (m3).
- **Hiding the symlinks via a `.gitignore` edit.** That is a tracked change on every branch; `info/exclude` is local and root-anchored.
- **`git add -u` for the ledger-guard amend.** It can sweep in non-ledger edits.
- **The discover `Tree:` stamp.** It is caller-copied, so it always "matches" (`codebase-discovery.md:23-25`).
- **A distill halt on unreadable size.** It hides a preflight defect.
- **Keep-verbatim for whole fence-holding sessions (N5), and the runner-up N5(b), a separate setup session.** The first makes the setup session undistillable; the second changes the session layout (`SKILL.md:421`) for no gain.
- **Passing the fence's JSON text as `workflowSetup` and parsing it in the script.** Rejected for the mainDev-only value: less mechanism, and it carries the same fact.
- **`--absolute-git-dir`.** It breaks AC-23's literal; `$(cd "$(git rev-parse --git-dir)" && pwd)` instead.
- **A Write-tool message file under `.git/`.** Not needed with a heredoc.
- **Dropping the write-plan guard as scope creep.** The design itself introduces "writer returns commits []".
- **Operator-note scoping (former AC-45).** After a `blocker:<n>` halt every earlier step is done, so the first pending unit always contains n. Scoping only changed an artificial fixture (D19; AC-45 retired, never reused).
- **An integration-pr `commits.length` guard.** It falsely blocks a relaunch after a pushed promotion and a zero-scenario plan. Replaced by the url guard plus the open-PR prompt rule (D18).
- **A commit-message respec skip key (`Approved-record:` matching mainDev/specHash).** Unreachable: a pushed respec changes the spec blob, so later records never match, and an unpushed one dies with its worktree. The "mismatches empty" skip after re-validate is the working idempotency (N2).
- **Carried from the debate** (`context.md:19-29`): a step card, a deterministic evidence checker or verification runner, a persistent worktree, sonnet tiering, a setup-done cache, a context.md write-gate, a header-only read, `pipefail`/masking classifiers, once-per-feature tooling, replacing discover.

## Open Risks

These are accepted but unresolved; each is mirrored into `context.md` `## Open Threads`.

- [ ] 1. **Strongest risk: the D10 remedy may not make the hook fire in a linked worktree.** It depends on `.husky/_/h` running the worktree's tracked `.husky/pre-commit` through the symlinked `.husky/_`, and on pnpm/lint-staged resolving through the symlinked `node_modules`. If it fails, every setup blocks with "pre-commit hook inert". This is a PR-0 gate. Fallback: `pnpm exec husky` inside each worktree, accepting concurrent `.git/config` writes.
- [ ] 2. **HOOK_CHECK is structural.** It can pass while the hook no-ops on main-checkout dependencies that lag `devSha` (the D13 limit). Only PR-0's measured hook output proves the hook fires.
- [ ] 3. **A residual worktree-only loop.** When the main checkout is live (`hookLive` true) but a writer's own check fails on `h` (link failed) or `pre-commit` (the branch lacks `.husky/pre-commit`), the "re-send resume" blocker repeats, because hook-setup is skipped. This is rare; the printed `hook-fail=<clause>` names the cause for the operator.
- [ ] 4. **(m4) The stale reclaim is not atomic.** Two waiters can both `rmdir`, then race on `mkdir`. Only one wins and the loser gets exit 75, so the damage is bounded.
- [ ] 5. **A 30-minute reclaim during a genuinely slow install** can start a second `pnpm install` into the same `node_modules`. This needs both a missing `node_modules` and two features racing. `--frozen-lockfile` bounds the damage.
- [ ] 6. **(m5) Hooked merge commit.** If main-dev brings `services/xstockstrat-ui/` changes, the hook runs ui lint and jscpd (threshold 0) on debt this feature does not own (`.husky/pre-commit:10-13`). Setup then blocks with "hook failed on merge commit (main-dev content)". PR-0 measures this; if it is common, file a follow-up.
- [ ] 7. **Concurrent `pnpm exec husky` is unlocked.** It is idempotent, but there is a small window of `.husky/_` rewrites. It also rewrites the shared `core.hooksPath` from absolute to relative (accepted, D10).
- [ ] 8. (dropped — D18)
- [ ] 9. **Busy main-dev.** Any main-dev push between the halt and the approval re-halts upfront.
- [ ] 10. **D4.** A stale `resume` approval continues past a real checkpoint (accepted).
- [ ] 11. **Partial-setup crash.** It moves `dev`, so the relaunch costs one extra validate; the items then skip.
- [ ] 12. **Relaunch fatigue.** The operator may need to send upfront+record, distill and resume together; §4 shows the array form (`context-engineering.md:180-182`).
- [ ] 13. **Log lifetime.** Logs last only until the worktree is removed; the cited lines in `red`/`green` are the durable record.
- [ ] 14. **The first `pnpm install` is a whole-workspace install** on a 4-CPU box.
- [ ] 15. **`run_in_background` polling depends on the writer's Bash tool alone.** PR-0 proves it.

## Constitution Rules Touched

- **P-01** (noted concern). `sdd-batch-writer` is the documented workflow-internal writer, one per stage, with the script as orchestrator (`context-engineering.md:161-163`). Recorded against the `:35` read-only default.
- **P-03.** Hook clauses name their failure; a confirmed miss and AskUserQuestion become blockers; writer no-ops block (FR-10).
- **P-04.** The upfront, distill, resume, merge-order and promotion gates are operator approvals.
- **C-01 / F-04.** The digest is re-verified, and a miss is a blocker.
- **C-02.** context.md is read in full.
- **F-05.** No commit before verification, unchanged.
- **F-08.** Staging is unchanged. Logs and links never stage (git dir plus `info/exclude`).
- **F-09.** The re-spec stays the sole sanctioned body edit.
- **F-10.** Nothing is written before the record-matching confirm. hook-setup writes no tracked file.
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
