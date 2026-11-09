import fs from 'node:fs'
import path from 'node:path'
import { run, ROOT } from './harness.mjs'
import assert from 'node:assert/strict'
const F = path.join(ROOT, '.claude/workflows/sdd-batch-execute.js')
const MD = 'a'.repeat(40), DV = 'b'.repeat(40), SH = 'c'.repeat(40)
const REC = { mainDev: MD, dev: DV, specHash: SH, directive: 'conditional', pending: [1, 2, 3], mismatches: [] }
const CHECKER = 'sdd-batch-checker', WRITER = 'sdd-batch-writer'
const count = (t, p) => t.calls.filter((c) => c.label.startsWith(p)).length
const callOf = (t, l) => t.calls.find((c) => c.label === l)
const RC_SFX = '; echo "rc=$?"'
const after = (s, anchor) => { const i = s.indexOf(anchor); assert.ok(i >= 0, 'anchor not found: ' + anchor); return s.slice(i) }
const base = { date: '2026-10-21', trailer: 'Co-Authored-By: X', prFooter: 'FOOT', modeEntryConfirmed: true, features: [{ slug: 'fix-a' }] }
const steps = (done) => [
  { n: 1, title: 'a', status: done >= 1 ? 'done' : 'pending', service: 'xstockstrat-x', surface: 'backend' },
  { n: 2, title: 'b', status: done >= 2 ? 'done' : 'pending', service: 'xstockstrat-x', surface: 'backend' },
  { n: 3, title: 'c', status: done >= 3 ? 'done' : 'pending', service: 'xstockstrat-ui', surface: 'ui' },
]
const pre = (o = {}) => Object.assign({ ok: true, problems: [], dir: '300-fix-a', nnn: '300', devBranch: 'feature/fix-a', status: 'implementation-ready', severity: 'SEV-2', steps: steps(0), mergeOrderBlock: '', openPrUrl: '', promotionPlan: '', mainDevSha: MD, devSha: DV, specHash: SH, contextBytes: '1000', workflowSetup: '', hookFail: '' }, o)
const impl = (o = {}) => Object.assign({ result: 'done', commits: ['c-step'], red: 'RED', green: 'GREEN', files: ['f'], deviations: [], out_of_scope: [], open_items: [], unaddressed_warnings: [], blocker: '', options: [] }, o)
const replies = (preOver, extra = {}) => Object.assign({
  'preflight:': pre(preOver),
  'validate:': { mismatches: [], tooling_blockers: [] },
  'setup:': { commits: ['c-setup'], notes: [], tooling_blockers: [], stale: false, completed: true },
  'discover:': 'digest',
  'step:': impl(),
  'promotion-plan:': { plan: 'PLAN', scenarios: 2 },
  'write-plan:': { commits: ['c-plan'], notes: [] },
  'integration-pr:': { url: 'https://pr/1', commits: ['c-pr'], notes: [] },
}, extra)
let t, r
t = await run(F, Object.assign({}, base, { modeEntryConfirmed: false }), replies())
assert.match(t.error, /mode-entry/)
t = await run(F, Object.assign({}, base, { prFooter: undefined }), replies())
assert.match(t.error, /prFooter/)
t = await run(F, Object.assign({}, base, { checkpoints: 'report' }), replies())
assert.match(t.error, /authorizationRef/)
console.log('0 arg guards ok')
// 1. fresh → upfront gate halt, no writes
t = await run(F, base, replies())
r = t.result[0]
assert.equal(r.halted.gate, 'upfront'); assert.equal(r.halted.plan.length, 3)
assert.equal(t.calls.filter((c) => c.label.startsWith('setup:') || c.label.startsWith('step:')).length, 0)
console.log('1 upfront gate ok')
// 2. upfront approved → setup + steps 1,2 then checkpoint at surface boundary (2→ui)
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'upfront', decision: 'proceed' } } }), replies())
r = t.result[0]
assert.equal(r.halted.gate, 'checkpoint:2'); assert.deepEqual(r.halted.steps_done, ['1: a ✓', '2: b ✓']); assert.equal(r.halted.next, 'ui (step 3)')
assert.ok(t.calls.find((c) => c.label === 'setup:fix-a'))
assert.deepEqual(r.commits, ['c-setup', 'c-step', 'c-step'])
for (const c of t.calls.filter((c) => /^(setup|step|write-plan|integration-pr):/.test(c.label))) {
  assert.ok(c.prompt.includes('Push after EACH artifact edit'), c.label)
  assert.ok(c.prompt.includes('no commit before verification'), c.label)
}
console.log('2 surface-boundary checkpoint ok')
// 3. checkpoint:2 proceed → step 3 → feature-end checkpoint
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'checkpoint:2', decision: 'proceed' } } }), replies({ status: 'in-progress', steps: steps(2) }))
r = t.result[0]
assert.equal(r.halted.gate, 'checkpoint:3'); assert.equal(r.halted.next, 'integration PR')
assert.equal(t.calls.filter((c) => c.label.startsWith('validate:')).length, 0, 'no re-validation on checkpoint resume')
console.log('3 feature-end checkpoint ok')
// 4. all done, no approval → promotion plan persisted + halted
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'checkpoint:3', decision: 'proceed' } } }), replies({ status: 'code-completed', steps: steps(3) }))
r = t.result[0]
assert.equal(r.halted.gate, 'promotion'); assert.ok(t.calls.find((c) => c.label.startsWith('write-plan:')).prompt.includes('sdd-batch-promotion-plan'))
console.log('4 promotion gate ok')
// 5. promotion approved with persisted plan → integration PR with footer
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'promotion', decision: 'proceed' } } }), replies({ status: 'code-completed', steps: steps(3), promotionPlan: 'PLAN' }))
r = t.result[0]
assert.equal(r.stage, 'done'); assert.equal(r.prUrl, 'https://pr/1')
assert.ok(t.calls.find((c) => c.label.startsWith('integration-pr:')).prompt.includes('FOOT'))
console.log('5 integration PR ok')
// 6. merge-order block halts before promotion
t = await run(F, base, replies({ status: 'code-completed', steps: steps(3), mergeOrderBlock: '230 first' }))
assert.equal(t.result[0].halted.gate, 'merge-order')
console.log('6 merge-order gate ok')
// 7. blocker on step 1 → halted; resume with decision → operator note reaches implementer
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'upfront', decision: 'proceed' } } }), replies({}, { 'step:': impl({ result: 'blocker', blocker: 'Q?', options: ['A', 'B'] }) }))
assert.equal(t.result[0].halted.gate, 'blocker:1')
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'blocker:1', decision: 'Option A' } } }), replies({ status: 'in-progress' }))
assert.ok(t.calls.find((c) => c.label === 'step:fix-a:s1').prompt.includes('Operator decision for the blocker on step 1: Option A'))
console.log('7 blocker round-trip ok')
// 8. open PR → done without work; report mode continues through checkpoints
t = await run(F, base, replies({ openPrUrl: 'https://pr/9' }))
assert.equal(t.result[0].prUrl, 'https://pr/9'); assert.equal(t.calls.length, 1)
t = await run(F, Object.assign({}, base, { checkpoints: 'report', authorizationRef: 'x', approvals: { 'fix-a': { gate: 'upfront', decision: 'proceed' } } }), replies())
r = t.result[0]
assert.equal(r.reports.length, 2); assert.equal(r.halted.gate, 'promotion')
console.log('8 open-PR short-circuit + report mode ok')
// 9. stop here
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'checkpoint:2', decision: 'stop here' } } }), replies({ status: 'in-progress', steps: steps(2) }))
assert.equal(t.result[0].stage, 'stopped'); assert.equal(t.calls.filter((c) => c.label.startsWith('step:')).length, 0)
console.log('9 stop here ok')
// 10. AC-1: scoped agent types on preflight and step; integration-pr keeps the default type
t = await run(F, Object.assign({}, base, { checkpoints: 'report', authorizationRef: 'x', approvals: { 'fix-a': [{ gate: 'checkpoint:2', decision: 'proceed' }, { gate: 'promotion', decision: 'proceed' }] } }), replies({ status: 'in-progress', steps: steps(2), workflowSetup: MD, promotionPlan: 'PLAN' }))
assert.equal(callOf(t, 'preflight:fix-a').opts.agentType, CHECKER, 'AC-1: preflight runs as ' + CHECKER)
assert.ok(count(t, 'step:fix-a:') >= 1, 'AC-1: a step call exists')
for (const c of t.calls.filter((c) => c.label.startsWith('step:fix-a:'))) assert.equal(c.opts.agentType, WRITER, 'AC-1: ' + c.label + ' runs as ' + WRITER)
assert.equal(callOf(t, 'integration-pr:fix-a').opts.agentType, undefined, 'AC-1: integration-pr keeps the default type')
console.log('10 scoped agent types ok')
// 11. AC-2: agent definitions are workflow-internal, opus-pinned, with exact tool lists
for (const [name, tools] of [[CHECKER, 'tools: Bash, Read, Glob, Grep, ToolSearch, mcp__github__list_pull_requests'], [WRITER, 'tools: Bash, Read, Edit, Write, Glob, Grep']]) {
  const md = fs.readFileSync(path.join(ROOT, '.claude/agents', name + '.md'), 'utf8')
  const lines = md.split('\n')
  assert.ok(lines.includes('model: opus'), 'AC-2: ' + name + ' model: opus')
  assert.ok(md.includes('spawned only by .claude/workflows/sdd-batch-execute.js; never delegate from a skill session'), 'AC-2: ' + name + ' spawn sentence')
  const desc = lines.find((l) => l.startsWith('description:')) || ''
  assert.ok(desc.includes('Workflow-internal') && desc.includes('Never select via Task'), 'AC-2: ' + name + ' description')
  assert.equal(lines.find((l) => l.startsWith('tools:')), tools, 'AC-2: ' + name + ' tools')
}
console.log('11 agent definitions ok')
// 12. AC-26: writer rules — links, .sdd-logs/, no Node install, read-only re-check, printed status, backstop
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'checkpoint:2', decision: 'proceed' } } }), replies({ status: 'in-progress', steps: steps(2), workflowSetup: MD }))
let p = callOf(t, 'step:fix-a:s3').prompt
for (const s of ['services/*/node_modules', '.husky/_', 'core.hooksPath', 'pre-commit hook inert', 'hook-fail=', 'provision pnpm 9.15.9', 'from the main session (never a workflow agent)', 'info/exclude', 'hook-fail=exclude', 'commit precondition unmet', '/services/*/node_modules', '/.husky/_', '/.sdd-logs', 'mkdir -p .sdd-logs', 'git diff --quiet' + RC_SFX, 'never write a file under <M> yourself', "git's own object/ref writes", 'never install, repair or append anything', 'Never run pnpm install', 'main-checkout node_modules lacks <pkg>', 'outside /sdd-batch-execute', 'uv sync --extra dev', 'Never edit pnpm-lock.yaml by hand', 'only this branch adds', 'git diff --quiet origin/main-dev -- pnpm-lock.yaml' + RC_SFX, 'test -e .husky/_' + RC_SFX, 'test -d "<M>/.husky/_"' + RC_SFX, 'ln -s "<M>/.husky/_" .husky/_', 'wc -c .sdd-logs/commit-<N>.log', 'printed rc=0 with a log under 400 bytes ran no hook', 'git commit -F .sdd-logs/msg-<N>.txt > .sdd-logs/commit-<N>.log 2>&1' + RC_SFX, 'git commit --amend --no-edit > .sdd-logs/commit-<N>.log 2>&1' + RC_SFX]) assert.ok(p.includes(s), 'AC-26: step prompt contains ' + s)
for (const s of ['pnpm exec husky', 'sdd-husky.lock', 're-send the resume approval', '<G>', "printf '%s", '[ -e .husky/_ ] ||', 'the tool reports its exit code', '! git diff', 'exits non-zero']) assert.ok(!p.includes(s), 'AC-26: step prompt lacks ' + s)
console.log('12 writer rules ok')
// 13. AC-39: every writer commits through a Write-tool message file and a worktree-local log
const wp13 = []
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'upfront', decision: 'proceed', record: REC } } }), replies())
wp13.push(['setup:fix-a', callOf(t, 'setup:fix-a')])
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'checkpoint:2', decision: 'proceed' } } }), replies({ status: 'in-progress', steps: steps(2), workflowSetup: MD }))
wp13.push(['step:fix-a:s3', callOf(t, 'step:fix-a:s3')])
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'checkpoint:3', decision: 'proceed' } } }), replies({ status: 'code-completed', steps: steps(3) }))
wp13.push(['write-plan:fix-a', callOf(t, 'write-plan:fix-a')])
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'promotion', decision: 'proceed' } } }), replies({ status: 'code-completed', steps: steps(3), promotionPlan: 'PLAN' }))
wp13.push(['integration-pr:fix-a', callOf(t, 'integration-pr:fix-a')])
for (const [l, c] of wp13) {
  assert.ok(c, 'AC-39: ' + l + ' was called')
  for (const s of ['with the Write tool to .sdd-logs/msg-<N>.txt', 'git commit -F .sdd-logs/msg-<N>.txt > .sdd-logs/commit-<N>.log 2>&1', 'tail -n 20 .sdd-logs/commit-<N>.log', 'git commit --amend --no-edit > .sdd-logs/commit-<N>.log 2>&1', 'timeout 600000', 'Never use --no-verify']) assert.ok(c.prompt.includes(s), 'AC-39: ' + l + ' contains ' + s)
  for (const s of ['SDD_MSG_EOF', 'git rev-parse --git-dir']) assert.ok(!c.prompt.includes(s), 'AC-39: ' + l + ' lacks ' + s)
}
console.log('13 commit form ok')
console.log('ALL sdd-batch-execute tests passed')
