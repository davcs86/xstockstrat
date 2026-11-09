export const meta = {
  name: 'sdd-batch-execute',
  description: 'Run /sdd-execute <slug> sequential for many implementation-ready features in parallel worktrees, halting at every operator gate',
  whenToUse: 'Features are implementation-ready and the operator has given the sequential mode-entry confirmation. args: {date, trailer, prFooter, modeEntryConfirmed:true, features:[{slug, directive?}], approvals?, checkpoints?, foldPolicy?, authorizationRef?}. Docs: docs/patterns/context-engineering.md §4.',
  phases: [
    { title: 'Preflight', detail: 'resolve slug, branch, lifecycle, steps, merge-order, open PR' },
    { title: 'Gate', detail: 're-spec validation + up-front confirm plan' },
    { title: 'Steps', detail: 'per step: discovery → TDD implementation → one commit on the feature branch' },
    { title: 'Land', detail: 'merge-order gate, C-16 promotion plan, integration PR' },
  ],
}

// Contract and gate semantics: docs/patterns/context-engineering.md §4 (Workflows).
const A = args || {}
if (!A.date || !A.trailer || !A.prFooter || !Array.isArray(A.features) || A.features.length === 0) {
  throw new Error('sdd-batch-execute: args.date, args.trailer (commit attribution), args.prFooter (PR-body attribution) and args.features[{slug}] are required')
}
if (A.modeEntryConfirmed !== true) {
  throw new Error('sdd-batch-execute: the operator must give the sequential mode-entry confirmation (sequential-mode.md §5.1b) in the main session first; pass modeEntryConfirmed:true')
}
const CHECKPOINTS = A.checkpoints || 'halt'
if (CHECKPOINTS !== 'halt' && CHECKPOINTS !== 'report') throw new Error("sdd-batch-execute: checkpoints must be 'halt' or 'report'")
if (CHECKPOINTS === 'report' && !A.authorizationRef) {
  throw new Error("sdd-batch-execute: checkpoints 'report' needs args.authorizationRef — where the operator authorized unattended checkpoints")
}
const BASE = A.baseBranch || 'main-dev'
const APPROVALS = A.approvals || {}
const STEP_CAP = 5
const FOLD = A.foldPolicy || 'ask'
if (FOLD !== 'ask' && FOLD !== 'adjacent') throw new Error("sdd-batch-execute: foldPolicy must be 'ask' or 'adjacent'")
if (FOLD === 'adjacent' && !A.authorizationRef) {
  throw new Error("sdd-batch-execute: foldPolicy 'adjacent' needs args.authorizationRef — where the operator authorized unattended folds")
}
const HEX = /^[0-9a-f]{40}$/
const CONTEXT_MAX = 65536
const CHECKER = 'sdd-batch-checker'
const WRITER = 'sdd-batch-writer'
const canon = (a) => JSON.stringify([].concat(a || []).map(Number).sort((x, y) => x - y))
// plain string (IR-1); prints the main checkout path, used literally as <M> (IR-2)
const MAINWT = 'git worktree list --porcelain | sed -n \'1s/^worktree //p\''
// plain string (IR-1); the one status suffix (D32): the Bash tool shows a silent pass and a silent fail alike
const RC = '; echo "rc=$?"'
// plain strings (IR-1); one simple command per step, no $( ), case, ${…} or { …; } (D29); the renderer appends RC (D32); <H>, <B>, <C> are values earlier steps printed
const HOOK_STEPS = [
  { clause: 'HUSKY', cmd: 'printenv HUSKY', passWhen: 'its first printed line is not exactly 0, whatever the rc (an unset HUSKY prints only rc=1, which passes)' },
  { clause: 'pnpm', cmd: 'command -v pnpm', passWhen: 'rc=0' },
  { clause: 'hooksPath', cmd: 'git config core.hooksPath', passWhen: 'rc=0, and its only other printed line is exactly .husky/_ or one absolute path ending in /.husky/_ (that line is <H>)' },
  { clause: 'h', cmd: 'test -f "<H>/pre-commit"', passWhen: 'rc=0' },
  { clause: 'h', cmd: 'test -f "<H>/h"', passWhen: 'rc=0' },
  { clause: 'pre-commit', cmd: 'test -f "<B>/pre-commit"', passWhen: 'rc=0 (<B> is <H> without its final /_)' },
  { clause: 'exclude', cmd: 'git rev-parse --git-common-dir', passWhen: 'rc=0, and its only other printed line is <C>' },
  { clause: 'exclude', cmd: 'grep -qxF -- /node_modules "<C>/info/exclude"', passWhen: 'rc=0' },
  { clause: 'exclude', cmd: 'grep -qxF -- \'/services/*/node_modules\' "<C>/info/exclude"', passWhen: 'rc=0' },
  { clause: 'exclude', cmd: 'grep -qxF -- /.husky/_ "<C>/info/exclude"', passWhen: 'rc=0' },
  { clause: 'exclude', cmd: 'grep -qxF -- /.sdd-logs "<C>/info/exclude"', passWhen: 'rc=0' },
]
// the one rendering of HOOK_STEPS, interpolated by writerRules item 2 and preflight item 13 (D15)
const HOOK_CHECK = `Hook check (read-only), from the checkout under test: run each numbered command as its own Bash call, in order, with the literal value an earlier command printed in place of <H>, <B> and <C>. Every command in this prompt, here and in the git protocol, that ends with an rc= echo has the status its printed rc= line shows, never the tool's display: a command that prints nothing looks the same whether it passed or failed. Stop at the first command that fails its pass condition: the result is its hook-fail=<clause>. A refused call ends the check with hook-fail=unknown. When all pass, the result is hook=0.
${HOOK_STEPS.map((s, i) => `   ${i + 1}) ${s.cmd}${RC} — pass: ${s.passWhen}. Else hook-fail=${s.clause}.`).join('\n')}`
// plain string (IR-1); the HUSKY/pnpm remedy for preflight's block and every writer (m-I)
const ENV_REMEDY = 'provision pnpm 9.15.9 (npm install -g pnpm@9.15.9) or unset HUSKY in the launching environment, then re-send the same approvals'
// plain string (IR-1); hook clauses: provisioning is the operator's or main session's, never a workflow agent's (D23)
const HOOK_REMEDY = 'from the main session (never a workflow agent) run pnpm install --frozen-lockfile in the main checkout, which wires core.hooksPath through husky prepare; check that git config core.hooksPath prints .husky/_ or an absolute path ending in /.husky/_; then re-send the same approvals'
// plain string (IR-1); interpolated into writer prompts, so it holds no ${ and no printf (AC-26)
const EXCLUDE_REMEDY = 'from the main session (never a workflow agent), at the main checkout root, run X="$(git rev-parse --git-common-dir)/info/exclude"; for L in /node_modules \'/services/*/node_modules\' /.husky/_ /.sdd-logs; do grep -qxF -- "$L" "$X" || echo "$L" >> "$X"; done — then re-send the same approvals'
// the one clause-to-message map, shared by the Gate and writerRules item 2 (C-18)
const hookMsg = (c, where) => `${c === 'exclude' ? 'commit precondition unmet' : 'pre-commit hook inert'} in ${where} (hook-fail=${c}) — ${c === 'exclude' ? EXCLUDE_REMEDY : c === 'HUSKY' || c === 'pnpm' ? ENV_REMEDY : HOOK_REMEDY}`
const hookBlocked = (raw) => { const c = String(raw == null ? '' : raw).trim().replace(/^hook-fail=/, ''); return c ? hookMsg(c, 'the main checkout') : '' }

const STEP = {
  type: 'object',
  properties: {
    n: { type: 'number' },
    title: { type: 'string' },
    status: { type: 'string' },
    service: { type: 'string' },
    surface: { type: 'string', enum: ['backend', 'ui', 'agent'] },
    landsWith: { type: 'array', items: { type: 'number' } },
  },
  required: ['n', 'title', 'status', 'service', 'surface', 'landsWith'],
}
const PREFLIGHT = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    dir: { type: 'string' },
    nnn: { type: 'string' },
    devBranch: { type: 'string' },
    status: { type: 'string' },
    severity: { type: 'string' },
    steps: { type: 'array', items: STEP },
    mergeOrderBlock: { type: 'string' },
    openPrUrl: { type: 'string' },
    promotionPlan: { type: 'string' },
    mainDevSha: { type: 'string' },
    devSha: { type: 'string' },
    specHash: { type: 'string' },
    contextBytes: { type: 'string' },
    workflowSetup: { type: 'string' },
    hookFail: { type: 'string' },
  },
  required: ['ok', 'problems', 'dir', 'nnn', 'devBranch', 'status', 'severity', 'steps', 'mergeOrderBlock', 'openPrUrl', 'promotionPlan', 'mainDevSha', 'devSha', 'specHash', 'contextBytes', 'workflowSetup', 'hookFail'],
}
const VALIDATE = {
  type: 'object',
  properties: {
    mismatches: { type: 'array', items: { type: 'object', properties: { n: { type: 'number' }, detail: { type: 'string' } }, required: ['n', 'detail'] } },
    tooling_blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['mismatches', 'tooling_blockers'],
}
const WRITE = {
  type: 'object',
  properties: { commits: { type: 'array', items: { type: 'string' } }, notes: { type: 'array', items: { type: 'string' } } },
  required: ['commits', 'notes'],
}
const SETUP = { type: 'object', properties: Object.assign({}, WRITE.properties, { tooling_blockers: { type: 'array', items: { type: 'string' } }, stale: { type: 'boolean' }, completed: { type: 'boolean' } }), required: WRITE.required.concat(['tooling_blockers', 'stale', 'completed']) }
const IMPL = {
  type: 'object',
  properties: {
    result: { type: 'string', enum: ['done', 'blocker'] },
    commits: { type: 'array', items: { type: 'string' } },
    red: { type: 'string' },
    green: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'array', items: { type: 'string' } },
    out_of_scope: { type: 'array', items: { type: 'string' } },
    open_items: { type: 'array', items: { type: 'string' } },
    unaddressed_warnings: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
  },
  required: ['result', 'commits', 'red', 'green', 'files', 'deviations', 'out_of_scope', 'open_items', 'unaddressed_warnings', 'blocker', 'options'],
}
const PLAN = {
  type: 'object',
  properties: { plan: { type: 'string' }, scenarios: { type: 'number' } },
  required: ['plan', 'scenarios'],
}
const PR = {
  type: 'object',
  properties: { url: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, notes: { type: 'array', items: { type: 'string' } } },
  required: ['url', 'commits', 'notes'],
}
const READ_SCOPE = `Read ONLY the following; a section runs from its heading to the next heading of the same or higher level (locate with grep -n):
- .claude/skills/sdd-execute/SKILL.md: "## PER-STEP EXECUTION" (skip its "### STEP COMMIT + PR" subsection; PHASE 3's config-key wiring gate stays in scope), "## DEVIATION HANDLING", "## CONTEXT.MD — Per-step entry format" and "## HARD CONSTRAINTS".
- .claude/skills/sdd-execute/reference/sequential-mode.md: §5.5, §5.7, "## Sequential-mode carve-outs" and "## Sequential-mode verification fallbacks".
- reference/tdd-gate.md and reference/tooling-setup.md in full (install only what this step needs, pinned; git-protocol item 2 overrides tooling-setup.md's Node install instructions (its §2 row and §3): never a Node package install; npx and pnpm dlx stay allowed).
- reference/repo-conventions.md only when the step touches its areas; reference/atomic-units.md only for an atomic unit; reference/deviation-handling.md only when a deviation arises.
- This feature's implementation-spec.md: the preamble (line 1 up to the first "### Step"), your own step(s) and "## Deviation Log".
- This feature's context.md IN FULL (C-02).
Wherever the loaded skill text says AskUserQuestion, return result:'blocker' with the question and A/B/C options instead.
Note that the discovery digest is advisory (read from the main checkout): re-verify every not-found claim and every path:line you act on at origin/<dev branch> in your worktree. A confirmed miss is a blocker (F-04).`
const VERIFY = `VERIFICATION protocol (judgment unchanged). Number your verification runs K = 1, 2, … in this agent: the RED run, the GREEN run and every re-run each get a NEW K and so a NEW log; never reuse a K. For each run, first write with the Write tool .sdd-logs/run-<K>.sh holding exactly these two lines, with the step's Verification block in place of <fence> (it may span lines inside the parentheses). Run the block verbatim, once; insert nothing; no \`set -e\`, no \`set -o pipefail\`:
( <fence> ) >.sdd-logs/v-<K>.log 2>&1
echo "exit=$?" >.sdd-logs/v-<K>.exit
- If it can finish within 540 s: ONE Bash call with timeout 600000: bash .sdd-logs/run-<K>.sh; cat .sdd-logs/v-<K>.exit
- Otherwise (a suite or build that may run longer), start bash .sdd-logs/run-<K>.sh with run_in_background,
  and poll, each ONE Bash call of at most 540 s: for i in $(seq 1 108); do [ -f .sdd-logs/v-<K>.exit ] && break; sleep 5; done; cat .sdd-logs/v-<K>.exit 2>/dev/null || echo "exit=PENDING"
  Re-poll on exit=PENDING, up to 6 polls; after that the run FAILED (timeout). A foreground call that times out is FAILED; re-run it in the background form with a NEW K.
A finished run with no \`exit=\` line is FAILED. Then read: grep -nE 'FAIL|Error|error:|panic|Traceback|not ok|AssertionError' .sdd-logs/v-<K>.log | head -n 40; tail -n 60 .sdd-logs/v-<K>.log. Read the FULL log on a non-zero exit, on any expectation you cannot confirm, or on surprising output. Judge exactly as SKILL.md PHASE 3: RED fails for the right reason, or "red N/A — no behavior change; characterization test added"; GREEN cites the executed count and the coverage line. Cite ONLY lines from this run's log; put the cited lines, the exit= line and the log path into red/green. The log lives only until this worktree is removed, so no later "full log" exists.
Config-key wiring gate (C-16): when SKILL.md PHASE 3's config-key wiring gate applies, node scripts/check-config-wiring.mjs (step-time) and, on the feature's last step, node scripts/check-config-wiring.mjs --final are separate commands from the Verification block. Run each the same way, with its own NEW log and exit= line. A non-zero exit keeps the step not-done; quote its finding and key lines. PENDING: findings do not block at step time.`

// An atomic unit (spec `**Lands with**`) runs as one work item: one discovery, one red→green, one commit.
function toUnits(steps) {
  const byN = new Map(steps.map((s) => [s.n, s]))
  const seen = new Set()
  const units = []
  for (const s of steps) {
    if (seen.has(s.n)) continue
    const members = [s.n].concat(s.landsWith || []).map((n) => byN.get(n)).filter(Boolean).sort((a, b) => a.n - b.n)
    members.forEach((m) => seen.add(m.n))
    units.push({ n: members[0].n, members, title: members.map((m) => m.title).join(' / '), surface: members[members.length - 1].surface })
  }
  return units
}

function approvals(slug) {
  return [].concat(APPROVALS[slug] || []).filter((x) => x && typeof x.gate === 'string')
}

function writerRules(f, p) {
  return `You are executing /sdd-execute ${f.slug} sequential for feature ${p.dir} (docs/roadmap/features/${p.dir}/), dev branch ${p.devBranch}. You run in your own git worktree and are the only writer for this unit of work (P-01). Shell variables do not survive between Bash calls, and you may never cd into or git -C the main checkout <M>, or write a file under it yourself (git-protocol item 2): run each line below as its own Bash call from your worktree root and substitute the literal values earlier calls printed. Mandatory git protocol:
1. \`git fetch origin\` then \`git checkout --detach origin/${p.devBranch}\`. Never check out a named local branch.
2. Hook wiring before any commit. Run each command line below as its own Bash call, in order (every line is idempotent); the indented lines and the hook-check header are instructions, not commands. <M> is the literal path the first call prints:
${MAINWT}
mkdir -p .sdd-logs
[ -e node_modules ] || ln -s "<M>/node_modules" node_modules
ls -d "<M>"/services/*/node_modules
   For each printed <M>/services/<s>/node_modules, ONE call: [ -e services/<s>/node_modules ] || ln -s "<M>/services/<s>/node_modules" services/<s>/node_modules
test -e .husky/_${RC}
   Only if that prints an rc other than 0, run test -d "<M>/.husky/_"${RC} as ONE call, and only if that prints rc=0, run ln -s "<M>/.husky/_" .husky/_ as ONE call.
${HOOK_CHECK}
   Never cd into <M>, never point git at <M> with -C, and never write a file under <M> yourself, directly or through a link (redirects, ln targets, installs); git's own object/ref writes from commands run in your worktree are expected. The links, .sdd-logs/ and the non-Node install outputs below are your only untracked writes. Never run pnpm install (or any Node package install) anywhere in this worktree, the root and services/<s> included: the linked node_modules are the main checkout's. This binds over reference/tooling-setup.md and over a step's Verification block; a Verification block that runs a Node package install is a spec deviation (blocker) and is never run. A missing Node package is a blocker: 'main-checkout node_modules lacks <pkg> — from the main session run pnpm install --frozen-lockfile in the main checkout, then re-send the same approvals'. If the step changes a package.json dependency or pnpm-lock.yaml, or \`git diff --quiet origin/main-dev -- pnpm-lock.yaml${RC}\` prints an rc other than 0 (this branch changed the lockfile), the blocker is instead 'Node dependency change that only this branch adds — run this step with /sdd-execute outside /sdd-batch-execute'. Never edit pnpm-lock.yaml by hand. npx <pkg> and pnpm dlx are not installs here and stay allowed: they write only the caches under $HOME, never the linked node_modules. Non-Node per-step installs that tooling-setup.md names stay allowed, pinned and only what the step needs: uv sync --extra dev in services/<s> (it writes that service's own unlinked .venv in this worktree) and go mod download / go install (they write the Go caches under $HOME).
   If the hook check's result is not hook=0: never install, repair or append anything and make NO commit. <clause> is the clause of its hook-fail=<clause> result (unknown when a call was refused). A step returns result 'blocker', options [], blocker <message>; setup adds <message> to tooling_blockers and returns completed:false; any other writer returns commits [] with <message> in notes. <message> is the matching line below, with that <clause> in place of the clause shown in parentheses:
   - clause exclude: ${hookMsg('exclude', 'this worktree')}
   - clause HUSKY or pnpm: ${hookMsg('pnpm', 'this worktree')}
   - any other clause, unknown included: ${hookMsg('hooksPath', 'this worktree')}
   Never use --no-verify. A "dirty tree" means \`git diff --quiet${RC}\` prints an rc other than 0 (tracked files only; the links and .sdd-logs/ are excluded and never count).
3. Make every commit in two steps. First write the message with the Write tool to .sdd-logs/msg-<N>.txt (N = 1, 2, … for each commit or amend in this agent, never reused): the subject line, a blank line, the body, and last these trailer lines, verbatim:
${A.trailer}
   Then ONE Bash call with timeout 600000 (the hook takes 18–31 s): git commit -F .sdd-logs/msg-<N>.txt > .sdd-logs/commit-<N>.log 2>&1${RC} — its status is the rc= line it prints — and then two separate calls: wc -c .sdd-logs/commit-<N>.log and tail -n 20 .sdd-logs/commit-<N>.log. The pre-commit hook always prints (lint-staged and the report-only jscpd step), so a commit that printed rc=0 with a log under 400 bytes ran no hook: treat it as "pre-commit hook inert (hook-fail=h)", do not push that commit, make no further commit, and block or return commits [] with that note. The check is a heuristic: it catches an inert hook, not a hook that ran but printed little.
   Amend the same way, with no message file: git commit --amend --no-edit > .sdd-logs/commit-<N>.log 2>&1${RC}, then tail -n 20 .sdd-logs/commit-<N>.log. On an rc other than 0 read that log in full, fix the cause and commit again with a new N. Never commit with -m or a heredoc.
4. \`git push origin HEAD:refs/heads/${p.devBranch}\` after every commit; retry up to 4 times (2s/4s/8s/16s) on network errors only. Never push elsewhere, never force-push.
5. Push after EACH artifact edit: every SDD artifact or doc you create or change (status.md, feature.md, context.md, implementation-spec.md re-spec, the promotion plan, durable acceptance suites) is committed alone — subject = this task's commit message + " — <file name>" — and pushed before the next file is touched. The ONE exception is a step's implementation: its **Files** plus that step's implementation-spec.md status, feature.md and context.md updates form a single commit made only after verification passes (SKILL.md HARD CONSTRAINT: no commit before verification).
6. Return every commit sha you created, in order, as \`commits\`.
Use ${A.date} for history rows and session headers. Severity tokens: only ${p.severity} may appear. Every HARD CONSTRAINT of .claude/skills/sdd-execute/SKILL.md applies (no guessed paths/symbols, no commit before verification passes, migration immutability, never start a database).`
}

function setupTask(f, p, rec) {
  const R = JSON.stringify(rec)
  const ms = rec.mismatches.map((m) => m.n).join(',')
  return `Operator approved the up-front plan with this record (binding, verbatim): ${R}
Do the items below IN ORDER. Each item that changes a file is one commit (git-protocol item 3 form), pushed (item 4) before the next item; "Skip if" means do nothing for that item. Wherever loaded skill text says AskUserQuestion, add a tooling_blockers entry or note instead. Return commits, notes, tooling_blockers, stale and completed.
0. Stale check (no commit). \`git fetch origin\`; if \`git rev-parse origin/main-dev\` ≠ ${rec.mainDev} or \`git rev-parse origin/${p.devBranch}\` ≠ ${rec.dev}: return stale:true, completed:false, commits []. Else \`git checkout --detach ${rec.dev}\` and redo git-protocol item 2.
1. Tooling (no commit). Run .claude/skills/sdd-execute/reference/tooling-setup.md DETECTION only for the toolchains the pending steps need (installs stay per step, and never a Node package install: git-protocol item 2); add each unavailable toolchain with no documented fallback to tooling_blockers. A failing hook check from git-protocol item 2 is a tooling_blockers entry too (item 2's rule). Any tooling_blockers entry means completed:false, no commits, and no further item.
2. Merge. Skip if \`git merge-base --is-ancestor ${rec.mainDev} HEAD${RC}\` prints rc=0. Else \`git merge --no-commit --no-ff ${rec.mainDev}\` (never -X), then ONE Bash call, with the literal <M> from git-protocol item 2: node "<M>"/scripts/merge-train-resolve.mjs --base ${rec.mainDev} --own-slug ${f.slug}${RC}
   - rc=2: \`git merge --abort\`; note "unresolvable: <each path: reason> — merge origin/main-dev into ${p.devBranch} by hand resolving <paths>, push, start a NEW run"; completed:false; stop.
   - any other rc than 0, or a throw: \`git merge --abort\`; note "resolver exit <N>: <last line>" (<N> is the printed rc); completed:false; stop.
   - rc=0: commit the merge (item 3 form), subject "Merge ${rec.mainDev} into ${p.devBranch}". If that commit prints an rc other than 0: \`git merge --abort\`; note "hook failed on merge commit (main-dev content) (last 20 lines): <tail>"; completed:false; stop.
   Then ONE Bash call: python3 scripts/ledger-guard.py --own-slug ${f.slug} --base ${rec.mainDev} --fix${RC}
   - rc=0: \`git add -- docs/roadmap/ledger/\`. If \`git diff --quiet${RC}\` prints an rc other than 0 (a tracked non-ledger file changed): \`git reset --hard ${rec.dev}\`, note "ledger-guard touched non-ledger paths", completed:false, stop. Else, only if \`git diff --cached --quiet${RC}\` prints an rc other than 0, amend with git commit --amend --no-edit (item 3 amend form); if it prints rc=0 nothing is staged and there is nothing to amend — continue.
   - any other rc: \`git reset --hard ${rec.dev}\`; note "ledger-guard exit <N>: <output>" (<N> is the printed rc); completed:false; stop.
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

async function runFeature(f) {
  const out = { slug: f.slug, stage: 'Preflight', halted: null, blocked: null, commits: [], reports: [] }
  const aps = approvals(f.slug)
  const proceeds = (gate) => aps.some((x) => x.gate === gate && x.decision === 'proceed')
  const ap = aps.find((x) => x.gate.indexOf('checkpoint:') === 0 || x.gate.indexOf('blocker:') === 0) || null

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
  if (!p) { out.blocked = 'preflight agent died'; return out }
  Object.assign(out, { nnn: p.nnn, devBranch: p.devBranch, status: p.status })
  if (!p.ok) { out.blocked = `preflight: ${p.problems.join('; ')}`; return out }
  if (p.openPrUrl) { out.stage = 'done'; out.prUrl = p.openPrUrl; return out }
  const WR = writerRules(f, p)
  const ctx = `Feature ${p.dir} (${p.severity}), dev branch ${p.devBranch}.`
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

  // ── Steps: one commit per step on the dev branch (§5.5) ──────────────────
  out.stage = 'Steps'
  const units = toUnits(pending)
  let sinceCheckpoint = 0
  let doneSince = []
  const adjust = aps.find((x) => typeof x.decision === 'string' && x.decision.indexOf('adjust:') === 0)
  let operatorNote = adjust ? adjust.decision.slice(7).trim() : null
  if (ap && ap.gate.indexOf('blocker:') === 0) operatorNote = `Operator decision for the blocker on step ${ap.gate.slice(8)}: ${ap.decision}`
  for (let i = 0; i < units.length; i++) {
    const s = units[i]
    const nums = s.members.map((m) => m.n).join('+')
    const unitNote = s.members.length > 1 ? ` This is an ATOMIC UNIT (steps ${nums}, **Lands with**): read .claude/skills/sdd-execute/reference/atomic-units.md — discover, implement, verify (union of Verifications) and commit all members as ONE commit titled "feat(${f.slug}): steps ${nums} — ${s.title}", flipping every member's Status to done.` : ''
    const disc = await agent(`${ctx}\nPhase 1 discovery (read-only) for step ${nums} — ${s.title} of docs/roadmap/features/${p.dir}/implementation-spec.md (read it from your working tree; if it differs from origin/${p.devBranch} trust the step text quoted in the spec on that branch). Re-run the step's **Codebase Evidence** commands and read its **Files**; return a confirmed/blocked digest with path:line for each symbol and a '## Not found' section.`, { agentType: 'codebase-discovery', phase: 'Steps', label: `discover:${f.slug}:s${s.n}` })
    const impl = await agent(`${WR}\n\n${ctx}\nExecute step ${nums} — ${s.title} (sequential mode: no Phase-2 prompt).${unitNote}\n${READ_SCOPE}\nIf a required symbol/file is confirmed missing at origin/${p.devBranch}, or verification would need a spec deviation, or the fix is ambiguous: do NOT commit code — return result 'blocker' with the question and A/B/C options (Option A = fix now by expanding this step's scope; when the step cannot pass its own Verification without the immediately following step, Option A is folding it in per atomic-units.md). Otherwise: run the TDD gate (RED before implementing, GREEN after; TDD: N/A only for non-code categories) and the step's **Verification**, both per the VERIFICATION protocol below, then commit per §5.5 ("feat(${f.slug}): step ${s.n} — ${s.title}", staging only the step's **Files** + implementation-spec.md (step **Status** → done) + feature.md + status.md + context.md, plus lockfiles when a manifest changed), push. FOLD POLICY ${FOLD}: ${FOLD === 'adjacent' ? 'if the step cannot pass its own Verification because the immediately following step(s) repair it (adjacent, one consumer surface, unit ≤ 4), fold them in per atomic-units.md WITHOUT returning a blocker, recording a Deviation Log entry; any other gap is still a blocker' : 'an unplanned fold is a blocker — return it with the fold as Option A'}. Report deviations (also in the spec's ## Deviation Log), out-of-scope changes, open items and still-unaddressed impl-spec review warnings for the checkpoint report.${operatorNote ? `\n\nOPERATOR NOTE (binding): ${operatorNote}` : ''}\n\n${VERIFY}\n\n--- discovery digest (advisory) ---\n${disc || '(discovery agent returned nothing — verify inline)'}`, { agentType: WRITER, phase: 'Steps', schema: IMPL, isolation: 'worktree', label: `step:${f.slug}:s${s.n}` })
    operatorNote = null
    if (!impl) { out.blocked = `implementer died on step ${nums}`; return out }
    if (impl.result === 'blocker') {
      out.halted = { gate: `blocker:${s.n}`, step: s.n, steps: s.members.map((m) => m.n), title: s.title, question: impl.blocker, options: impl.options }
      return out
    }
    out.commits.push(...impl.commits)
    sinceCheckpoint += s.members.length
    doneSince = doneSince.concat(s.members.map((m) => `${m.n}: ${m.title} ✓`))
    const next = units[i + 1]
    const fire = !next || next.surface !== s.surface || sinceCheckpoint >= STEP_CAP
    if (!fire) continue
    const report = {
      gate: `checkpoint:${s.n}`,
      steps_done: doneSince,
      surface: s.surface,
      pending: units.slice(i + 1).reduce((n, u) => n + u.members.length, 0),
      files: impl.files,
      out_of_scope: impl.out_of_scope,
      open_items: impl.open_items,
      unaddressed_warnings: impl.unaddressed_warnings,
      deviations: impl.deviations,
      next: next ? `${next.surface} (step ${next.n})` : 'integration PR',
    }
    sinceCheckpoint = 0
    doneSince = []
    if (CHECKPOINTS === 'halt') {
      out.halted = Object.assign(report, { question: "Approve with {gate:'checkpoint:<n>', decision:'proceed' | 'stop here' | 'adjust: <note>'}." })
      return out
    }
    out.reports.push(report)
  }

  // ── Land: merge-order gate, C-16 promotion, integration PR (§5.6) ────────
  out.stage = 'Land'
  if (p.mergeOrderBlock && !proceeds('merge-order')) {
    out.halted = { gate: 'merge-order', reason: p.mergeOrderBlock, hook: hookErr, question: "merge-order.md requires another feature first. Create the integration PR anyway? {gate:'merge-order', decision:'proceed'}" }
    return out
  }
  if (!proceeds('promotion') || !p.promotionPlan) {
    const plan = await agent(`${ctx}\nPlan the C-16 promotion of docs/roadmap/features/${p.dir}/acceptance.feature (read it on origin/${p.devBranch}) into the durable suites per .claude/skills/sdd-execute/SKILL.md ALL-DONE PATH step 2.5: target suite per scenario, @feature-${p.nnn} provenance tags, dedup against existing suites. Return the ready-to-write plan.`, { agentType: 'scenario-promoter', phase: 'Land', schema: PLAN, label: `promotion-plan:${f.slug}` })
    if (!plan) { out.blocked = 'promotion planner died'; return out }
    const wp = await agent(`${WR}\n\n${ctx}\nAppend a context.md session entry "sdd-batch-execute promotion plan (awaiting operator confirm)" containing the plan below inside a fenced block tagged \`sdd-batch-promotion-plan\`. Change nothing else. Commit "docs(${f.slug}): C-16 promotion plan awaiting confirm (${p.nnn})", push.\n\n${plan.plan}`, { agentType: WRITER, phase: 'Land', schema: WRITE, isolation: 'worktree', label: `write-plan:${f.slug}` })
    if (!wp || !wp.commits.length) { out.blocked = `write-plan made no commit: ${wp ? wp.notes.join('; ') : 'writer died'}`; return out }
    out.commits.push(...wp.commits)
    out.halted = { gate: 'promotion', scenarios: plan.scenarios, plan: plan.plan, question: "Confirm the C-16 promotion plan (P-04): {gate:'promotion', decision:'proceed'}." }
    return out
  }
  const pr = await agent(`${WR}\n\n${ctx}\nALL-DONE PATH (SKILL.md) for ${f.slug}: the operator confirmed the C-16 promotion plan recorded in context.md (block \`sdd-batch-promotion-plan\`). Apply exactly that plan to the durable suite files, make sure status.md is code-completed (history row if it changes), commit "docs(${f.slug}): promote acceptance scenarios (C-16) (${p.nnn})" and push. Then render .claude/skills/sdd-execute/templates/integration-pr-body.md (per-step one-liners from implementation-spec.md, new migrations, new env vars, Deviation Log summary, test plan), ending the body with these lines verbatim:\n${A.prFooter}\nand open the integration PR with mcp__github__create_pull_request (load via ToolSearch): base main-dev, head ${p.devBranch}. Open the PR only if the promotion commit is pushed now or the plan is already applied at origin/${p.devBranch} (say which in notes); otherwise return url ''. Return its URL, the commits and notes.`, { phase: 'Land', schema: PR, isolation: 'worktree', label: `integration-pr:${f.slug}` })
  if (!pr) { out.blocked = 'integration-PR writer died'; return out }
  out.commits.push(...pr.commits)
  if (!pr.url) { out.blocked = `integration-pr incomplete: ${pr.notes.join('; ') || 'no PR url'}`; return out }
  out.prUrl = pr.url
  out.stage = 'done'
  return out
}

return await pipeline(A.features, (f) => runFeature(f))
