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
assert.deepEqual(r.halted.record, REC, 'AC-3: the upfront halt returns its record')
assert.equal(t.calls.filter((c) => c.label.startsWith('setup:') || c.label.startsWith('step:')).length, 0)
console.log('1 upfront gate ok')
// 2. upfront approved → setup + steps 1,2 then checkpoint at surface boundary (2→ui)
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'upfront', decision: 'proceed', record: REC } } }), replies())
r = t.result[0]
assert.equal(r.halted.gate, 'checkpoint:2'); assert.deepEqual(r.halted.steps_done, ['1: a ✓', '2: b ✓']); assert.equal(r.halted.next, 'ui (step 3)')
assert.ok(t.calls.find((c) => c.label === 'setup:fix-a'))
assert.equal(count(t, 'validate:'), 0, 'AC-4: a matching record skips re-validation')
assert.deepEqual(r.commits, ['c-setup', 'c-step', 'c-step'])
for (const c of t.calls.filter((c) => /^(setup|step|write-plan|integration-pr):/.test(c.label))) {
  assert.ok(c.prompt.includes('Push after EACH artifact edit'), c.label)
  assert.ok(c.prompt.includes('no commit before verification'), c.label)
}
console.log('2 surface-boundary checkpoint ok')
// 3. checkpoint:2 proceed → step 3 → feature-end checkpoint
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'checkpoint:2', decision: 'proceed' } } }), replies({ status: 'in-progress', steps: steps(2), workflowSetup: MD }))
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
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'upfront', decision: 'proceed', record: REC } } }), replies({}, { 'step:': impl({ result: 'blocker', blocker: 'Q?', options: ['A', 'B'] }) }))
assert.equal(t.result[0].halted.gate, 'blocker:1'); assert.equal(count(t, 'validate:'), 0, 'AC-4: a matching record skips re-validation')
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'blocker:1', decision: 'Option A' } } }), replies({ status: 'in-progress', workflowSetup: MD }))
assert.ok(t.calls.find((c) => c.label === 'step:fix-a:s1').prompt.includes('Operator decision for the blocker on step 1: Option A'))
console.log('7 blocker round-trip ok')
// 8. open PR → done without work; report mode continues through checkpoints
t = await run(F, base, replies({ openPrUrl: 'https://pr/9' }))
assert.equal(t.result[0].prUrl, 'https://pr/9'); assert.equal(t.calls.length, 1)
t = await run(F, Object.assign({}, base, { checkpoints: 'report', authorizationRef: 'x', approvals: { 'fix-a': { gate: 'upfront', decision: 'proceed', record: REC } } }), replies())
r = t.result[0]
assert.equal(r.reports.length, 2); assert.equal(r.halted.gate, 'promotion'); assert.equal(count(t, 'validate:'), 0, 'AC-4: a matching record skips re-validation')
console.log('8 open-PR short-circuit + report mode ok')
// 9. stop here
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'checkpoint:2', decision: 'stop here' } } }), replies({ status: 'in-progress', steps: steps(2), workflowSetup: MD }))
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
// 14. Gate behaviour (Part A)
const RA = (o = {}) => ({ gate: 'upfront', decision: 'proceed', record: Object.assign({}, REC, o) })
const go = (aps, rep, extra = {}, over = {}) => run(F, Object.assign({}, base, over, aps ? { approvals: { 'fix-a': aps } } : {}), replies(rep, extra))
const M2 = [{ n: 2, detail: 'D' }]
t = await go(null, {}, { 'validate:': { mismatches: M2, tooling_blockers: [] } })
assert.equal(count(t, 'validate:'), 1, 'AC-3: one validate'); assert.equal(t.result[0].halted.gate, 'upfront', 'AC-3: upfront halt')
assert.deepEqual(t.result[0].halted.record, Object.assign({}, REC, { mismatches: M2 }), 'AC-3: record carries the mismatches')
assert.equal(count(t, 'setup:') + count(t, 'step:') + count(t, 'write-plan:'), 0, 'AC-3: no writes')
t = await go(RA({ mismatches: M2 }), {})
assert.equal(count(t, 'validate:'), 0, 'AC-4: no validate'); assert.equal(count(t, 'setup:'), 1, 'AC-4: one setup')
assert.ok(callOf(t, 'setup:fix-a').prompt.includes('[{"n":2,"detail":"D"}]'), 'AC-4: setup carries the recorded mismatches')
t = await go(RA({ mainDev: 'd'.repeat(40) }), {})
assert.equal(count(t, 'validate:'), 1, 'AC-5: stale record re-validates'); assert.equal(t.result[0].halted.record.mainDev, MD, 'AC-5: fresh record'); assert.equal(count(t, 'setup:'), 0, 'AC-5: no setup')
t = await go({ gate: 'upfront', decision: 'proceed' }, {})
assert.equal(count(t, 'validate:'), 1, 'AC-6'); assert.ok(t.result[0].halted.record, 'AC-6: halt has a record'); assert.equal(count(t, 'setup:'), 0, 'AC-6: no setup')
t = await go({ gate: 'blocker:1', decision: 'Option A' }, { workflowSetup: '' })
assert.equal(count(t, 'validate:'), 1, 'AC-7'); assert.equal(t.result[0].halted.gate, 'upfront', 'AC-7'); assert.equal(count(t, 'step:'), 0, 'AC-7: no step')
t = await go(null, { status: 'in-progress', workflowSetup: '' })
assert.equal(count(t, 'validate:'), 1, 'AC-8'); assert.equal(t.result[0].halted.gate, 'upfront', 'AC-8: upfront, not resume')
t = await go(null, { status: 'in-progress', workflowSetup: MD })
assert.equal(t.result[0].halted.gate, 'resume', 'AC-9: resume halt'); assert.equal(count(t, 'validate:') + count(t, 'setup:'), 0, 'AC-9: no validate/setup')
t = await go({ gate: 'resume', decision: 'proceed' }, { status: 'in-progress', workflowSetup: MD })
assert.equal(count(t, 'validate:') + count(t, 'setup:'), 0, 'AC-9: resume skips validate/setup'); assert.ok(count(t, 'step:fix-a') >= 1, 'AC-9: steps run')
t = await go(null, { contextBytes: '70000' })
assert.equal(t.result[0].halted.gate, 'distill', 'AC-10'); assert.equal(t.result[0].halted.limit, 65536, 'AC-10: limit'); assert.equal(count(t, 'validate:'), 0, 'AC-10: no validate')
t = await go({ gate: 'distill', decision: 'proceed' }, { contextBytes: '70000' })
assert.equal(t.result[0].halted.gate, 'upfront', 'AC-10: distill approval passes')
const SU = (o) => ({ 'setup:': Object.assign({ commits: [], notes: [], tooling_blockers: [], stale: false, completed: false }, o) })
t = await go(RA(), {}, SU({ notes: ['resolver exit 64'] }))
assert.match(t.result[0].blocked, /setup incomplete/, 'AC-11'); assert.equal(count(t, 'step:'), 0, 'AC-11: no step')
t = await go(RA(), {}, SU({ stale: true }))
assert.match(t.result[0].blocked, /start a NEW run/, 'AC-12'); assert.equal(count(t, 'step:'), 0, 'AC-12: no step')
t = await go(null, { contextBytes: 'unknown' })
assert.match(t.result[0].blocked, /context.md size unreadable/, 'AC-21'); assert.equal(t.result[0].halted, null, 'AC-21: no halt'); assert.equal(count(t, 'validate:'), 0, 'AC-21: no validate')
t = await go({ gate: 'checkpoint:2', decision: 'proceed' }, { status: 'in-progress', workflowSetup: MD, steps: steps(2) })
assert.equal(count(t, 'validate:') + count(t, 'setup:'), 0, 'AC-22: no validate/setup'); assert.equal(t.calls.find((c) => c.label.startsWith('step:')).label, 'step:fix-a:s3', 'AC-22: resumes at step 3')
t = await go(RA(), {}, SU({ tooling_blockers: ['pre-commit hook inert: hook-fail=hooksPath'] }))
assert.match(t.result[0].blocked, /tooling: pre-commit hook inert/, 'AC-24'); assert.equal(count(t, 'step:'), 0, 'AC-24: no step')
t = await go(RA(), {}, SU({ notes: ['unresolvable: docs/x.md: off-allowlist — merge origin/main-dev into feature/fix-a by hand resolving docs/x.md, push, start a NEW run'] }))
assert.match(t.result[0].blocked, /unresolvable/, 'AC-28'); assert.equal(t.result[0].halted, null, 'AC-28: no halt'); assert.equal(count(t, 'step:'), 0, 'AC-28: no step')
t = await go(RA({ mismatches: M2 }), {}, SU({ commits: ['c-setup'], completed: true }))
assert.equal(t.result[0].halted.gate, 'resume', 'AC-29: re-spec relaunch'); assert.equal(count(t, 'step:'), 0, 'AC-29: no step')
t = await go(RA({ directive: 'none', mismatches: M2 }), {}, {}, { features: [{ slug: 'fix-a', directive: 'none' }] })
assert.match(t.result[0].blocked, /directive none: steps 2 mismatch/, 'AC-30'); assert.equal(count(t, 'setup:'), 0, 'AC-30: no setup')
t = await go(null, { mainDevSha: 'origin/main-dev' })
assert.match(t.result[0].blocked, /non-hex sha/, 'AC-31'); assert.equal(count(t, 'validate:'), 0, 'AC-31: no validate')
t = await go({ gate: 'resume', decision: 'proceed' }, { status: 'in-progress', workflowSetup: MD, hookFail: 'hooksPath' })
assert.match(t.result[0].blocked, /pre-commit hook inert in the main checkout \(hook-fail=hooksPath\)/, 'AC-35')
assert.ok(t.result[0].blocked.includes('pnpm install --frozen-lockfile') && t.result[0].blocked.includes('from the main session'), 'AC-35: remedy')
for (const k of ['validate:', 'setup:', 'discover:', 'step:', 'write-plan:', 'integration-pr:']) assert.equal(count(t, k), 0, 'AC-35: no ' + k)
// AC-37 (a)–(g)
t = await go(null, { hookFail: 'hooksPath' })
assert.equal(count(t, 'validate:'), 1, 'AC-37(a)'); assert.equal(t.result[0].halted.gate, 'upfront', 'AC-37(a)'); assert.equal(t.result[0].blocked, null, 'AC-37(a): not blocked')
assert.ok(t.result[0].halted.tooling_blockers.some((x) => x.includes('hook-fail=hooksPath')), 'AC-37(a): tooling_blockers carries the hook')
t = await go(null, { contextBytes: '70000', hookFail: 'hooksPath' })
assert.equal(t.result[0].halted.gate, 'distill', 'AC-37(b)'); assert.equal(t.result[0].blocked, null, 'AC-37(b)'); assert.ok(t.result[0].halted.hook.includes('hook-fail=hooksPath'), 'AC-37(b): hook')
t = await go(null, { status: 'in-progress', workflowSetup: MD, hookFail: 'hooksPath' })
assert.equal(t.result[0].halted.gate, 'resume', 'AC-37(c)'); assert.equal(t.result[0].blocked, null, 'AC-37(c)'); assert.ok(t.result[0].halted.hook.includes('hook-fail=hooksPath'), 'AC-37(c): hook')
t = await go({ gate: 'resume', decision: 'proceed' }, { status: 'in-progress', workflowSetup: MD, hookFail: '' })
assert.equal(t.result[0].blocked, null, 'AC-37(d)'); assert.ok(count(t, 'step:fix-a') >= 1, 'AC-37(d): steps run')
t = await go({ gate: 'checkpoint:2', decision: 'stop here' }, { status: 'in-progress', workflowSetup: MD, steps: steps(2), hookFail: 'hooksPath' })
assert.equal(t.result[0].stage, 'stopped', 'AC-37(e)'); assert.equal(t.result[0].blocked, null, 'AC-37(e)')
t = await go(null, { status: 'code-completed', steps: steps(3), mergeOrderBlock: '230 first', hookFail: 'hooksPath' })
assert.equal(t.result[0].halted.gate, 'merge-order', 'AC-37(f)'); assert.equal(t.result[0].blocked, null, 'AC-37(f)'); assert.ok(t.result[0].halted.hook.includes('hook-fail=hooksPath'), 'AC-37(f): hook')
t = await go(null, { status: 'code-completed', steps: steps(3), mergeOrderBlock: '', hookFail: 'h' })
assert.match(t.result[0].blocked, /\(hook-fail=h\)/, 'AC-37(g)'); assert.equal(count(t, 'promotion-plan:') + count(t, 'write-plan:'), 0, 'AC-37(g): no Land writes')
t = await go(RA({ pending: [3, 1, 2] }), {})
assert.equal(count(t, 'validate:'), 0, 'AC-40: order-insensitive record'); assert.equal(count(t, 'setup:'), 1, 'AC-40: setup')
const s0 = steps(0)
t = await go(null, { steps: [s0[2], s0[0], s0[1]] })
assert.deepEqual(t.result[0].halted.record.pending, [1, 2, 3], 'AC-40: canonical pending')
const recNoM = Object.assign({}, REC); delete recNoM.mismatches
t = await go({ gate: 'upfront', decision: 'proceed', record: recNoM }, {})
assert.equal(count(t, 'validate:'), 1, 'AC-46'); assert.equal(t.result[0].halted.gate, 'upfront', 'AC-46'); assert.equal(count(t, 'setup:'), 0, 'AC-46: no setup')
t = await go(RA(), { hookFail: 'pnpm' })
assert.match(t.result[0].blocked, /pre-commit hook inert in the main checkout \(hook-fail=pnpm\)/, 'AC-47'); assert.ok(t.result[0].blocked.includes('provision pnpm 9.15.9'), 'AC-47: pnpm remedy')
assert.equal(count(t, 'validate:') + count(t, 'setup:') + count(t, 'step:'), 0, 'AC-47: no work')
t = await go(RA(), { hookFail: 'HUSKY' })
assert.ok(t.result[0].blocked.includes('unset HUSKY'), 'AC-47: HUSKY remedy')
t = await go(RA(), { hookFail: 'exclude' })
assert.match(t.result[0].blocked, /commit precondition unmet in the main checkout \(hook-fail=exclude\)/, 'AC-47: exclude')
assert.ok(t.result[0].blocked.includes('/.sdd-logs') && t.result[0].blocked.includes('never a workflow agent'), 'AC-47: exclude remedy')
t = await go(RA(), { hookFail: ' hook-fail=pnpm ' })
assert.ok(t.result[0].blocked.includes('(hook-fail=pnpm)') && !t.result[0].blocked.includes('hook-fail=hook-fail'), 'AC-47: normalised clause')
console.log('14 gate behaviour ok')
// 15. prompt contracts (Part B)
t = await go(RA(), {})
const sp = callOf(t, 'setup:fix-a').prompt, pp = callOf(t, 'preflight:fix-a').prompt, s1p = callOf(t, 'step:fix-a:s1').prompt
for (const s of ['merge-train-resolve.mjs --base ' + MD, 'ledger-guard.py', '--amend', 'Approved-record:', 'git log --first-parent', 'origin/main-dev..HEAD', 'HEAD' + RC_SFX, '--own-slug fix-a' + RC_SFX, '- rc=2:']) assert.ok(sp.includes(s), 'AC-13: setup contains ' + s)
for (const s of ['the tool reports its exit code', '! git diff']) assert.ok(!sp.includes(s), 'AC-13: setup lacks ' + s)
let a = after(sp, 'Operator approved the up-front plan')
assert.ok(a.indexOf('status.md') < a.indexOf('sdd-batch-setup'), 'AC-13: status.md before the setup fence')
const items = {}
for (const part of a.split(/^(?=\d+\. )/m)) { const m = /^(\d+)\. /.exec(part); if (m && !items[m[1]]) items[m[1]] = part }
for (const n of ['2', '3', '4', '6']) assert.ok((items[n] || '').includes('Skip if'), 'AC-18: item ' + n + ' is idempotent')
for (const n of ['2', '3', '4', '5', '6']) assert.ok((items[n] || '').includes('push'), 'AC-18: item ' + n + ' pushes')
assert.ok(sp.includes('completed'), 'AC-18: completed')
for (const s of ['core.hooksPath', 'git worktree list --porcelain', 'pre-commit hook inert', 'tooling_blockers']) assert.ok(sp.includes(s), 'AC-25: setup contains ' + s)
a = after(sp, '1. Tooling (no commit)')
assert.ok(a.indexOf('tooling_blockers') < a.indexOf('merge-train-resolve.mjs'), 'AC-25: tooling before merge')
for (const s of ['pnpm exec husky', 'sdd-husky.lock']) assert.ok(!sp.includes(s), 'AC-25: setup lacks ' + s)
for (const s of ['mcp__github__list_pull_requests', 'ToolSearch', 'retry once', 'PR lookup unavailable', 'git cat-file -s', 'docs/roadmap/features/']) assert.ok(pp.includes(s), 'AC-34: preflight contains ' + s)
const hl = (s) => s.split('\n').filter((l) => /^   \d+\) /.test(l))
for (const [l, x] of [['setup', sp], ['preflight', pp], ['step', s1p]]) {
  for (const s of ['printenv HUSKY' + RC_SFX + ' — pass:', 'Else hook-fail=HUSKY.', 'command -v pnpm' + RC_SFX + ' — pass: rc=0. Else hook-fail=pnpm.', 'git config core.hooksPath' + RC_SFX + ' — pass:', 'Else hook-fail=hooksPath.', 'test -f "<H>/pre-commit"' + RC_SFX + ' — pass: rc=0. Else hook-fail=h.', 'test -f "<H>/h"' + RC_SFX + ' — pass: rc=0. Else hook-fail=h.', 'test -f "<B>/pre-commit"' + RC_SFX, 'Else hook-fail=pre-commit.', 'git rev-parse --git-common-dir' + RC_SFX, 'grep -qxF -- /.sdd-logs "<C>/info/exclude"' + RC_SFX + ' — pass: rc=0. Else hook-fail=exclude.', 'A refused call ends the check with hook-fail=unknown', "never the tool's display"]) assert.ok(x.includes(s), 'AC-38: ' + l + ' contains ' + s)
  assert.equal(hl(x).length, 11, 'AC-38: ' + l + ' has 11 hook-check lines')
  for (const ln of hl(x)) {
    const c = ln.slice(ln.indexOf(') ') + 2, ln.indexOf(' — pass:'))
    assert.ok(c.endsWith(RC_SFX) && c.indexOf(RC_SFX) === c.length - RC_SFX.length, 'AC-38: one trailing suffix: ' + ln)
    for (const f of ['$(', '`', 'case ', '${', '{ ', ';', '&&', '||', ' | ', ' > ', '>>']) assert.ok(!c.slice(0, -RC_SFX.length).includes(f), 'AC-38: ' + f + ' in ' + ln)
    assert.ok(!ln.includes('exit 0'), 'AC-38: no exit 0 in ' + ln)
  }
  for (const s of ['"$M', 'cd "<M>', 'git -C "<M>', 'echo "hook=$?"', '${H%/_}', 'case "$H"', 'sdd-husky.lock', 'pnpm exec husky']) assert.ok(!x.includes(s), 'AC-38: ' + l + ' lacks ' + s)
}
assert.deepEqual(hl(sp), hl(pp), 'AC-38: setup = preflight'); assert.deepEqual(hl(pp), hl(s1p), 'AC-38: preflight = step')
assert.ok(pp.includes('hookFail') && pp.includes('no cd, no git -C'), 'AC-38: preflight hookFail')
a = after(sp, 'ledger-guard.py')
assert.ok(a.includes('git add -- docs/roadmap/ledger/'), 'AC-41: stage ledger'); assert.ok(a.indexOf('git diff --quiet') < a.indexOf('--amend'), 'AC-41: diff before amend')
for (const s of ['git diff --cached --quiet' + RC_SFX, 'nothing to amend', '--fix' + RC_SFX, '- rc=0:', '- any other rc:']) assert.ok(a.includes(s), 'AC-41: contains ' + s)
console.log('15 prompt contracts ok')
// 16. step prompt — scoped reads, .sdd-logs/ verification protocol, wiring gate
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'checkpoint:2', decision: 'proceed' } } }), replies({ status: 'in-progress', steps: steps(2), workflowSetup: MD }))
const stp = callOf(t, 'step:fix-a:s3').prompt, dsp = callOf(t, 'discover:fix-a:s3').prompt
const has = (id, x, list) => { for (const s of list) assert.ok(x.includes(s), id + ': contains ' + s) }
has('AC-14', stp, ['## PER-STEP EXECUTION', '## HARD CONSTRAINTS', '## Deviation Log', 'sequential-mode.md', '§5.5', 'tooling-setup.md', 'repo-conventions.md', 'context.md IN FULL'])
has('AC-15', stp, [') >.sdd-logs/v-<K>.log 2>&1', 'echo "exit=$?" >.sdd-logs/v-<K>.exit', 'tail -n 60', 'no `set -o pipefail`', 'no `exit=` line', 'FAILED', 'Read the FULL log', 'red N/A — no behavior change; characterization test added'])
has('AC-23', stp, ['NEW log', 'the RED run, the GREEN run and every re-run', '.sdd-logs/run-<K>.sh', '.sdd-logs/v-<K>.log', 'never reuse a K', "Cite ONLY lines from this run's log"])
for (const s of ['mktemp', 'git rev-parse --git-dir']) assert.ok(!stp.includes(s), 'AC-23: lacks ' + s)
has('AC-32', stp, ['the discovery digest is advisory', 're-verify every not-found claim', 'A confirmed miss is a blocker (F-04)', "Wherever the loaded skill text says AskUserQuestion, return result:'blocker'", '§5.7', 'carve-outs'])
assert.ok(!dsp.includes('Tree:'), 'AC-32: discover carries no Tree: stamp')
has('AC-33', stp, ['check-config-wiring.mjs', '--final', 'keeps the step not-done'])
has('AC-42', stp, ['with the Write tool .sdd-logs/run-<K>.sh', 'run_in_background', '.sdd-logs/v-<K>.exit', 'exit=PENDING', '540', 'lives only until this worktree is removed'])
console.log('16 step prompt ok')
// 17. AC-43: no silent write-plan no-op
const c3 = { approvals: { 'fix-a': { gate: 'checkpoint:3', decision: 'proceed' } } }
t = await run(F, Object.assign({}, base, c3), replies({ status: 'code-completed', steps: steps(3) }, { 'write-plan:': { commits: [], notes: ['pre-commit hook inert (hook-fail=hooksPath)'] } }))
assert.match(t.result[0].blocked || '', /write-plan made no commit/, 'AC-43: empty write-plan blocks'); assert.equal(t.result[0].halted, null, 'AC-43: no halt')
t = await run(F, Object.assign({}, base, c3), replies({ status: 'code-completed', steps: steps(3) }, { 'write-plan:': null }))
assert.match(t.result[0].blocked || '', /write-plan made no commit: writer died/, 'AC-43: dead writer blocks')
console.log('17 write-plan guard ok')
// 18. AC-44: integration-pr needs a URL
const pr5 = (rep) => run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'promotion', decision: 'proceed' } } }), replies({ status: 'code-completed', steps: steps(3), promotionPlan: 'PLAN' }, { 'integration-pr:': rep }))
t = await pr5({ url: '', commits: [], notes: ['pre-commit hook inert (hook-fail=h)'] })
assert.match(t.result[0].blocked || '', /integration-pr incomplete: pre-commit hook inert/, 'AC-44: note surfaces'); assert.notEqual(t.result[0].stage, 'done', 'AC-44: not done')
t = await pr5({ url: '', commits: [], notes: [] })
assert.match(t.result[0].blocked || '', /integration-pr incomplete: no PR url/, 'AC-44: no url')
t = await pr5({ url: 'https://github.com/o/r/pull/1', commits: [], notes: ['plan already applied at the dev-branch tip'] })
assert.equal(t.result[0].stage, 'done', 'AC-44: url with no commits is done'); assert.equal(t.result[0].prUrl, 'https://github.com/o/r/pull/1', 'AC-44: prUrl')
assert.ok(callOf(t, 'integration-pr:fix-a').prompt.includes('Open the PR only if the promotion commit is pushed now'), 'AC-44: prompt rule')
console.log('18 integration-pr guard ok')
// 19. static contract docs (AC-19, AC-27, AC-16)
const rd = (r) => fs.readFileSync(path.join(ROOT, r), 'utf8')
const sec = (x, a, b) => { const i = x.indexOf(a); assert.ok(i >= 0, 'section not found: ' + a); const j = x.indexOf(b, i + a.length); return x.slice(i, j < 0 ? undefined : j) }
const ph3 = sec(rd('.claude/skills/sdd-execute/SKILL.md'), '### PHASE 3: Execution', '\n### ')
assert.ok(ph3.includes('Report the cited output lines, the `exit=` line and the log path (full log on request)'), 'AC-19: PHASE 3 reports cited lines, exit= and log path')
assert.ok(!ph3.includes('Report the exact output'), 'AC-19: old wording gone')
const cd = rd('.claude/agents/context-distiller.md'), ds = rd('.claude/skills/sdd-distill/SKILL.md')
for (const [l, x] of [['context-distiller.md', cd], ['sdd-distill/SKILL.md', ds]]) for (const k of ['sdd-batch-', 'byte-for-byte', 'in original order']) assert.ok(x.includes(k), 'AC-27: ' + l + ' contains ' + k)
assert.ok(cd.includes('Never mark a whole session keep-verbatim only because it holds a fence'), 'AC-27: no whole-session keep')
const s4 = sec(rd('docs/patterns/context-engineering.md'), '## 4. Saved workflows', '## How the three compose')
for (const k of ['record', "{gate:'resume'", "{gate:'distill'", 'sdd-batch-setup', 'not resumeFromRunId', 'sdd-batch-writer', 'sdd-batch-checker']) assert.ok(s4.includes(k), 'AC-16: §4 contains ' + k)
const row = s4.split('\n').find((l) => l.startsWith('| `/sdd-batch-execute`')) || ''
const cell = row.split('|').map((x) => x.trim()).filter(Boolean).pop() || ''
for (const k of ['resume', 'distill', 're-halts']) assert.ok(cell.includes(k), 'AC-16: Stops-at cell contains ' + k)
const cm = rd('.claude/context-map.yaml')
for (const k of ['name: sdd-batch-writer', 'name: sdd-batch-checker']) assert.ok(cm.includes(k), 'AC-16: context-map contains ' + k)
console.log('19 contract docs ok')
console.log('ALL sdd-batch-execute tests passed')
