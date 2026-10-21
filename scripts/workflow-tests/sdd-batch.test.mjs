import path from 'node:path'
import { run, ROOT } from './harness.mjs'
import assert from 'node:assert/strict'
const F = path.join(ROOT, '.claude/workflows/sdd-batch.js')
const base = { date: '2026-10-21', trailer: 'Co-Authored-By: X', features: [{ slug: 'fix-a', decisions: ['d1'] }] }
const pre = (o = {}) => Object.assign({ ok: true, problems: [], dir: '300-fix-a', nnn: '300', devBranch: 'feature/fix-a', branchExists: false, status: 'draft', severity: 'SEV-2', report: 'r.md', services: ['xstockstrat-x', 'xstockstrat-y'], subject: 's', demotedSimilar: [], implReviewDone: false, priorDesignState: '', productSpec: 'PS', acceptance: 'AC', reconMd: '', implSpecMd: '' }, o)
const synth = (o = {}) => Object.assign({ approach: 'A', open_objections: [], floor_breaches: [], business_rule_changes: [], rejected_alternatives: [], open_risks: ['r'], constitution_rules_touched: [], rationale: '' }, o)
const common = (preOver, synthFn) => ({
  'preflight:': pre(preOver),
  'review-spec:': { overall: 'PASS WITH WARNINGS', fails: [], warnings: ['w'], floor_breaches: [] },
  'overlap:': { level: 'PASS', collisions: [] },
  'write-review:': { spec_ready: true, commit: 'c-rev', product_spec_md: 'PS2', acceptance_feature: 'AC2' },
  'discover:': 'digest', 'scenario-recon:': 'rules',
  'write-recon:': { commit: 'c-recon', content: 'RECON' },
  'propose:': 'PROP', 'attack:': 'ADV',
  'synth:': synthFn || synth(),
  'write-gate:': { commit: 'c-gate', content: 'gate' },
  'write-design:': { commit: 'c-design', content: 'DESIGN' },
  'write-spec:': { commit: 'c-spec', content: 'SPEC', steps: 3, step_titles: ['a', 'b', 'c'] },
  'review-impl:': { overall: 'PASS', fails: [], warnings: [], floor_breaches: [] },
  'overlap-impl:': { level: 'PASS', collisions: [] },
  'write-implreview:': { commit: 'c-ir', addressed: [], still_open: [] },
})
let t
// 1. halt (default): draft → review → recon → 2 rounds → halted at design gate
t = await run(F, base, common())
assert.equal(t.error, undefined, t.error)
let r = t.result[0]
assert.equal(r.halted.gate, 'design'); assert.equal(r.halted.round, 2)
assert.equal(t.calls.filter((c) => c.label.startsWith('propose:')).length, 2)
assert.ok(t.calls.find((c) => c.label.startsWith('write-gate:')).prompt.includes('sdd-batch-design-state'))
assert.ok(t.calls.find((c) => c.label.startsWith('propose:fix-a:r1')).prompt.includes('PS2'), 'revised spec inlined')
assert.equal(t.calls.filter((c) => c.label.startsWith('discover:')).length, 2)
console.log('1 halt-at-gate ok')
// 2. resume with persisted state + approve → no new rounds, design/spec/implreview → done
const prior = JSON.stringify({ round: 2, synth: synth(), floor_breaches: [] })
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'design', decision: 'approve' } } }), common({ status: 'spec-ready', branchExists: true, reconMd: 'RECON', priorDesignState: prior }))
r = t.result[0]
assert.equal(t.error, undefined, t.error); assert.equal(r.stage, 'done'); assert.equal(r.status, 'implementation-ready')
assert.equal(t.calls.filter((c) => c.label.startsWith('propose:')).length, 0)
assert.ok(t.calls.find((c) => c.label.startsWith('write-design:')).prompt.includes('operator approval at the gate'))
console.log('2 resume+approve ok')
// 3. approve refused when a Floor breach is persisted → runs another round then halts
t = await run(F, Object.assign({}, base, { approvals: { 'fix-a': { gate: 'design', decision: 'approve' } } }), common({ status: 'spec-ready', branchExists: true, reconMd: 'RECON', priorDesignState: JSON.stringify({ round: 2, synth: synth({ floor_breaches: ['F-1'] }), floor_breaches: ['F-1'] }) }, synth({ floor_breaches: ['F-1'] })))
r = t.result[0]
assert.equal(r.halted.gate, 'design'); assert.equal(r.halted.round, 3); assert.deepEqual(r.halted.floor_breaches, ['F-1'])
console.log('3 floor blocks approval ok')
// 4. auto mode needs authorizationRef
t = await run(F, Object.assign({}, base, { designGate: 'auto' }), common())
assert.match(t.error, /authorizationRef/)
// 5. auto mode approves at r2 when clean
t = await run(F, Object.assign({}, base, { designGate: 'auto', authorizationRef: 'ctx.md#x' }), common())
r = t.result[0]
assert.equal(r.stage, 'done'); assert.equal(r.rounds, 2)
assert.ok(t.calls.find((c) => c.label.startsWith('write-design:')).prompt.includes('auto-approved under ctx.md#x'))
console.log('5 auto approve ok')
// 6. auto mode: uncovered @AC CHANGE halts even in auto
t = await run(F, Object.assign({}, base, { designGate: 'auto', authorizationRef: 'x' }), common({}, synth({ business_rule_changes: [{ ac_id: '@AC-4', kind: 'CHANGE', covered_by_operator_decision: false }] })))
r = t.result[0]
assert.equal(r.halted.gate, 'design'); assert.deepEqual(r.halted.uncovered_changes, ['@AC-4']); assert.equal(r.halted.round, 2)
console.log('6 uncovered C-16 change halts ok')
// 7. auto mode: blocking objection loops to cap 5 then halts
t = await run(F, Object.assign({}, base, { designGate: 'auto', authorizationRef: 'x' }), common({}, synth({ open_objections: [{ text: 'o', blocking: true }] })))
r = t.result[0]
assert.equal(r.halted.round, 5); assert.equal(t.calls.filter((c) => c.label.startsWith('propose:')).length, 5)
console.log('7 cap at 5 ok')
// 8. preflight problem → blocked; demoted-similar → halted
t = await run(F, base, common({ ok: false, problems: ['slug not unique: 173-x, 244-x'] }))
assert.match(t.result[0].blocked, /slug not unique/)
t = await run(F, base, common({ demotedSimilar: ['fix-a-old'] }))
assert.equal(t.result[0].halted.gate, 'demoted-duplicate')
console.log('8 preflight guards ok')
// 9. review FAIL twice → blocked, never reaches recon
t = await run(F, base, Object.assign(common(), { 'review-spec:': { overall: 'FAIL', fails: ['c8'], warnings: [], floor_breaches: [] }, 'write-review:': { spec_ready: false, commit: 'c', product_spec_md: 'P', acceptance_feature: 'A' } }))
assert.match(t.result[0].blocked, /still FAIL/); assert.equal(t.calls.filter((c) => c.label.startsWith('discover:')).length, 0)
console.log('9 review fail ok')
// 10. trailer + severity reach every writer
t = await run(F, base, common())
for (const c of t.calls.filter((c) => c.label.startsWith('write-'))) { assert.ok(c.prompt.includes('Co-Authored-By: X')); assert.ok(c.prompt.includes('only SEV-2 may appear')); assert.equal(c.opts.isolation, 'worktree') }
console.log('10 writer rules ok')
console.log('ALL sdd-batch tests passed')
