import path from 'node:path'
import { run, ROOT } from './harness.mjs'
import assert from 'node:assert/strict'
const F = path.join(ROOT, '.claude/workflows/sdd-batch-execute.js')
const base = { date: '2026-10-21', trailer: 'Co-Authored-By: X', prFooter: 'FOOT', modeEntryConfirmed: true, features: [{ slug: 'fix-a' }] }
const steps = (done) => [
  { n: 1, title: 'a', status: done >= 1 ? 'done' : 'pending', service: 'xstockstrat-x', surface: 'backend' },
  { n: 2, title: 'b', status: done >= 2 ? 'done' : 'pending', service: 'xstockstrat-x', surface: 'backend' },
  { n: 3, title: 'c', status: done >= 3 ? 'done' : 'pending', service: 'xstockstrat-ui', surface: 'ui' },
]
const pre = (o = {}) => Object.assign({ ok: true, problems: [], dir: '300-fix-a', nnn: '300', devBranch: 'feature/fix-a', status: 'implementation-ready', severity: 'SEV-2', steps: steps(0), mergeOrderBlock: '', openPrUrl: '', promotionPlan: '' }, o)
const impl = (o = {}) => Object.assign({ result: 'done', commits: ['c-step'], red: 'RED', green: 'GREEN', files: ['f'], deviations: [], out_of_scope: [], open_items: [], unaddressed_warnings: [], blocker: '', options: [] }, o)
const replies = (preOver, extra = {}) => Object.assign({
  'preflight:': pre(preOver),
  'validate:': { mismatches: [], tooling_blockers: [] },
  'setup:': { commits: ['c-setup'], notes: [] },
  'discover:': 'digest',
  'step:': impl(),
  'promotion-plan:': { plan: 'PLAN', scenarios: 2 },
  'write-plan:': { commits: ['c-plan'], notes: [] },
  'integration-pr:': { url: 'https://pr/1', commits: ['c-pr'] },
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
console.log('ALL sdd-batch-execute tests passed')
