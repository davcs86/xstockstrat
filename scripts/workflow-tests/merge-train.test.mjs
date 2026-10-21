import path from 'node:path'
import { run, ROOT } from './harness.mjs'
import assert from 'node:assert/strict'
const F = path.join(ROOT, '.claude/workflows/merge-train.js')
const base = { date: '2026-10-21', trailer: 'Co-Authored-By: X', repo: 'o/r', mergeAuthorized: true, authorizationRef: 'chat 2026-10-21' }

// Simulated GitHub: each PR's live state; merging one can turn others into conflicts (shared append-only files).
function gh(prs, { conflictsAfter = {}, waitResult = {}, updateResult = {} } = {}) {
  const S = {}
  for (const [n, p] of Object.entries(prs)) S[n] = Object.assign({ number: +n, state: 'open', title: `PR ${n}`, base: 'main-dev', head: `feature/f${n}`, headSha: `s${n}-0`, mergeable: 'clean', ci: 'green', failing: [], changesRequested: false, approvals: 'absent' }, p)
  const num = (label) => +label.match(/#(\d+)/)[1]
  const replies = {
    'inspect:': (prompt) => ({ prs: [...prompt.matchAll(/#(\d+)/g)].map((m) => Object.assign({}, S[m[1]])) }),
    'retarget:': (prompt, o) => { S[num(o.label)].base = prompt.match(/base "([^"]+)"/)[1]; S[num(o.label)].mergeable = 'behind'; S[num(o.label)].ci = 'none'; return { ok: true, error: '' } },
    'update:': (prompt, o) => {
      const n = num(o.label)
      if (updateResult[n]) return updateResult[n]
      const p = S[n]
      if (p.mergeable === 'clean') return { result: 'up-to-date', sha: p.headSha, resolved: [], unresolvable: [], note: '' }
      p.headSha = `s${n}-${+p.headSha.split('-')[1] + 1}`; p.mergeable = 'clean'; p.ci = 'pending'
      return { result: 'pushed', sha: p.headSha, resolved: ['docs/roadmap/ledger/fails.md (union)'], unresolvable: [], note: '' }
    },
    'wait:': (prompt, o) => {
      const n = num(o.label)
      const ci = waitResult[n] || 'green'
      S[n].ci = ci
      return { ci, headSha: S[n].headSha, failing: ci === 'red' ? ['Python lint'] : [] }
    },
    'merge:': (prompt, o) => {
      const n = num(o.label)
      assert.ok(prompt.includes(`expectedHeadSha "${S[n].headSha}"`), 'merges the head CI ran on')
      S[n].state = 'merged'
      for (const k of conflictsAfter[n] || []) if (S[k].state === 'open') S[k].mergeable = 'conflict'
      return { merged: true, sha: `m${n}`, error: '' }
    },
  }
  return { S, replies }
}
const labels = (t, p) => t.calls.map((c) => c.label).filter((l) => l.startsWith(p))
let t, g

t = await run(F, Object.assign({}, base, { mergeAuthorized: false, prs: [1] }), {})
assert.match(t.error, /mergeAuthorized/)
t = await run(F, Object.assign({}, base, { authorizationRef: undefined, prs: [1] }), {})
assert.match(t.error, /authorizationRef/)
t = await run(F, Object.assign({}, base, { repo: undefined, prs: [1] }), {})
assert.match(t.error, /repo/)
t = await run(F, Object.assign({}, base, { prs: [{ number: 1, dependsOn: [9] }] }), {})
assert.match(t.error, /not in args.prs/)
console.log('0 arg guards ok')

// 1. independent, current, green → merged in queue order with squash, nothing pushed
g = gh({ 1: {}, 2: {} })
t = await run(F, Object.assign({}, base, { prs: [1, 2] }), g.replies)
assert.deepEqual(t.result.merged.map((m) => [m.number, m.method]), [[1, 'squash'], [2, 'squash']])
assert.deepEqual(labels(t, 'update:').concat(labels(t, 'wait:')), [])
console.log('1 clean queue ok')

// 2. merging #1 makes #2 conflict on a shared ledger → update via resolver, wait on the new head, merge
g = gh({ 1: {}, 2: {} }, { conflictsAfter: { 1: [2] } })
t = await run(F, Object.assign({}, base, { prs: [1, 2] }), g.replies)
assert.deepEqual(t.result.merged.map((m) => m.number), [1, 2])
assert.deepEqual(t.result.merged[1].resolved, ['docs/roadmap/ledger/fails.md (union)'])
const up = t.calls.find((c) => c.label.startsWith('update:#2'))
assert.ok(up.prompt.includes('--own-slug "f2"') && up.prompt.includes('merge-train-resolve.mjs') && up.prompt.includes('Never use --no-verify'))
assert.ok(up.prompt.includes('Co-Authored-By: X'), 'merge commit carries the trailer')
assert.equal(up.opts.isolation, 'worktree')
assert.deepEqual(labels(t, 'wait:'), ['wait:#2:r2'])
console.log('2 progressive conflict ok')

// 3. stacked: #2's base is #1's head → after #1 merges, #2 is retargeted, updated, merged
g = gh({ 1: {}, 2: { base: 'feature/f1' } })
t = await run(F, Object.assign({}, base, { prs: [2, 1] }), g.replies)
assert.deepEqual(t.result.merged.map((m) => m.number), [1, 2])
assert.ok(t.calls.find((c) => c.label === 'retarget:#2').prompt.includes('base "main-dev"'))
assert.ok(labels(t, 'update:#2').length === 1)
console.log('3 stacked retarget ok')

// 4. red CI halts that PR and its dependents; the independent PR still merges
g = gh({ 1: { ci: 'red', failing: ['Go lint'] }, 2: {}, 3: {} })
t = await run(F, Object.assign({}, base, { prs: [1, { number: 2, dependsOn: [1] }, 3] }), g.replies)
assert.deepEqual(t.result.merged.map((m) => m.number), [3])
assert.deepEqual(t.result.halted.map((h) => [h.number, h.reason]), [[1, 'CI red'], [2, 'waits on #1, which halted']])
assert.deepEqual(t.result.halted[0].failing, ['Go lint'])
g = gh({ 1: { mergeable: 'behind' } }, { waitResult: { 1: 'red' } })
t = await run(F, Object.assign({}, base, { prs: [1] }), g.replies)
assert.equal(t.result.halted[0].reason, 'CI red'); assert.deepEqual(labels(t, 'merge:'), [])
console.log('4 red CI ok')

// 5. off-allowlist conflict → halted with the resolver's list, never merged
g = gh({ 1: { mergeable: 'conflict' } }, { updateResult: { 1: { result: 'halt', sha: '', resolved: [], unresolvable: ['services/x/a.ts: not on the allowlist'], note: 'resolver exit 2' } } })
t = await run(F, Object.assign({}, base, { prs: [1] }), g.replies)
assert.deepEqual(t.result.halted[0].unresolvable, ['services/x/a.ts: not on the allowlist'])
assert.deepEqual(labels(t, 'merge:'), [])
console.log('5 unresolvable conflict ok')

// 6. main needs allowMain; only hotfix/* or main-dev may land there, with a merge commit
g = gh({ 1: { base: 'main', head: 'hotfix/x' } })
t = await run(F, Object.assign({}, base, { prs: [1] }), g.replies)
assert.match(t.result.halted[0].reason, /allowMain/)
g = gh({ 1: { base: 'main', head: 'hotfix/x' }, 2: { base: 'main', head: 'feature/y' } })
t = await run(F, Object.assign({}, base, { allowMain: true, prs: [1, 2] }), g.replies)
assert.deepEqual(t.result.merged.map((m) => [m.number, m.method]), [[1, 'merge']])
assert.match(t.result.halted[0].reason, /may not merge into main/)
console.log('6 main policy ok')

// 7. no CI on a current head cannot be fixed without an empty commit → halt; review signals halt
g = gh({ 1: { ci: 'none' }, 2: { changesRequested: true }, 3: { approvals: 'fail' } })
t = await run(F, Object.assign({}, base, { prs: [1, 2, 3] }), g.replies)
assert.deepEqual(t.result.halted.map((h) => h.number), [1, 2, 3])
assert.match(t.result.halted[0].reason, /real push/)
console.log('7 no-CI + review halts ok')

// 8. merged outside the train counts as merged; a dependency cycle halts both
g = gh({ 1: { state: 'merged' }, 2: {} })
t = await run(F, Object.assign({}, base, { prs: [1, { number: 2, dependsOn: [1] }] }), g.replies)
assert.deepEqual(t.result.merged.map((m) => m.number), [1, 2])
g = gh({ 1: {}, 2: {} })
t = await run(F, Object.assign({}, base, { prs: [{ number: 1, dependsOn: [2] }, { number: 2, dependsOn: [1] }] }), g.replies)
assert.deepEqual(t.result.halted.map((h) => h.reason), ['dependency cycle: no PR can go first', 'dependency cycle: no PR can go first'])
console.log('8 external merge + cycle ok')
