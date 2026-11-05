import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { resolve, mergeHotfixLog, unionMarkers } from '../merge-train-resolve.mjs'

const LOG_HEAD = '# Hotfix Incident Register\n\n---\n\n<!-- New entries are prepended below this line, most-recent first -->\n\n'
const entry = (ts, br, status = 'in-progress') => `## ${ts} — ${br}\n\n- **PR**: #1\n- **Status**: ${status}`
const log = (...e) => LOG_HEAD + e.join('\n\n\n') + '\n'

// Builds base → (pr branch, main) divergence, then leaves `git merge main` in progress on pr.
function scenario(baseFiles, prFiles, mainFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-'))
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  const put = (files) => { for (const [f, c] of Object.entries(files)) { if (c === null) { fs.rmSync(path.join(dir, f)); continue } fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c) } g('add', '-A'); g('commit', '-qm', 'x') }
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false')
  put(baseFiles)
  g('checkout', '-qb', 'pr'); put(prFiles)
  g('checkout', '-q', 'main'); put(mainFiles)
  g('checkout', '-q', 'pr')
  try { g('merge', '-q', '--no-edit', 'main') } catch { /* conflicts expected */ }
  const prev = process.cwd()
  process.chdir(dir)
  return { dir, g, done: () => process.chdir(prev) }
}

let s, r

// 1. append-only ledger: both sides keep their entries, base first
s = scenario({ 'docs/roadmap/ledger/fails.md': '# Fails\n\n### e1\n- a\n' },
  { 'docs/roadmap/ledger/fails.md': '# Fails\n\n### e1\n- a\n\n### pr-entry\n- p\n' },
  { 'docs/roadmap/ledger/fails.md': '# Fails\n\n### e1\n- a\n\n### base-entry\n- b\n' })
r = resolve('fix-a')
assert.deepEqual(r.unresolvable, [])
const fails = fs.readFileSync('docs/roadmap/ledger/fails.md', 'utf8')
assert.ok(fails.indexOf('### base-entry') < fails.indexOf('### pr-entry') && fails.includes('### e1'))
assert.ok(!fails.includes('<<<<<<<'))
assert.equal(s.g('diff', '--name-only', '--diff-filter=U'), '')
s.done(); console.log('1 ledger union ok')

// 2. hotfix log: both prepended → newest first, shared tail fields kept per entry
s = scenario({ 'docs/runbooks/hotfix-log.md': log(entry('2026-10-02T14:01:51Z', 'hotfix/old', 'deployed')) },
  { 'docs/runbooks/hotfix-log.md': log(entry('2026-10-20T02:59:43Z', 'hotfix/b'), entry('2026-10-02T14:01:51Z', 'hotfix/old', 'deployed')) },
  { 'docs/runbooks/hotfix-log.md': log(entry('2026-10-20T02:40:18Z', 'hotfix/a'), entry('2026-10-02T14:01:51Z', 'hotfix/old', 'deployed')) })
r = resolve('')
assert.deepEqual(r.unresolvable, [])
const hl = fs.readFileSync('docs/runbooks/hotfix-log.md', 'utf8')
const order = ['hotfix/b', 'hotfix/a', 'hotfix/old'].map((b) => hl.indexOf(`— ${b}`))
assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], hl)
assert.equal((hl.match(/- \*\*Status\*\*/g) || []).length, 3)
s.done(); console.log('2 hotfix-log merge ok')

// 3. own feature dir → branch side; other feature dir and report sidecar → base side; deletion honoured
s = scenario({ 'docs/roadmap/features/300-fix-a/status.md': 'draft\n', 'docs/roadmap/features/301-fix-b/status.md': 'draft\n', 'docs/reports/x-defect.status': 'open\n' },
  { 'docs/roadmap/features/300-fix-a/status.md': 'implementation-ready\n', 'docs/roadmap/features/301-fix-b/status.md': 'spec-ready\n', 'docs/reports/x-defect.status': 'open\nref: a\n' },
  { 'docs/roadmap/features/300-fix-a/status.md': 'draft-base\n', 'docs/roadmap/features/301-fix-b/status.md': null, 'docs/reports/x-defect.status': 'triaged\n' })
r = resolve('fix-a')
assert.deepEqual(r.unresolvable, [])
assert.equal(fs.readFileSync('docs/roadmap/features/300-fix-a/status.md', 'utf8'), 'implementation-ready\n')
assert.equal(fs.existsSync('docs/roadmap/features/301-fix-b/status.md'), false)
assert.equal(fs.readFileSync('docs/reports/x-defect.status', 'utf8'), 'triaged\n')
s.done(); console.log('3 ours/theirs/deletion ok')

// 4. a conflict off the allowlist halts and stages nothing
s = scenario({ 'services/x/a.ts': 'v0\n', 'docs/roadmap/ledger/fails.md': '# F\n' },
  { 'services/x/a.ts': 'v-pr\n', 'docs/roadmap/ledger/fails.md': '# F\n### p\n' },
  { 'services/x/a.ts': 'v-main\n', 'docs/roadmap/ledger/fails.md': '# F\n### m\n' })
r = resolve('fix-a')
assert.deepEqual(r.unresolvable.map((u) => u.path), ['services/x/a.ts'])
assert.deepEqual(r.resolved, [])
assert.ok(fs.readFileSync('docs/roadmap/ledger/fails.md', 'utf8').includes('<<<<<<<'), 'nothing written when halting')
s.done(); console.log('4 off-allowlist halt ok')

// 4b. squash-merged parent: the branch still carries a dir the base later deleted → base-side path pruned, code path halts
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-'))
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c) }
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false')
  put('README', 'r\n'); g('add', '-A'); g('commit', '-qm', 'base')
  g('checkout', '-qb', 'pr')
  put('docs/roadmap/features/302-old-slug/status.md', 'draft\n'); put('services/x/gone.ts', 'x\n'); g('add', '-A'); g('commit', '-qm', 'triage')
  put('docs/roadmap/features/300-fix-a/status.md', 'implementation-ready\n'); g('add', '-A'); g('commit', '-qm', 'spec')
  g('checkout', '-q', 'main')
  put('docs/roadmap/features/302-old-slug/status.md', 'draft\n'); put('services/x/gone.ts', 'x\n'); g('add', '-A'); g('commit', '-qm', 'squash of triage')
  g('rm', '-rq', 'docs/roadmap/features/302-old-slug', 'services/x/gone.ts'); g('commit', '-qm', 'rename')
  g('checkout', '-q', 'pr'); g('merge', '-q', '--no-commit', '--no-ff', 'main')
  const prev = process.cwd(); process.chdir(dir)
  r = resolve('fix-a', 'main')
  assert.deepEqual(r.unresolvable, [{ path: 'services/x/gone.ts', reason: 'deleted on base, re-added by the branch' }])
  g('rm', '-q', '--cached', 'services/x/gone.ts')
  r = resolve('fix-a', 'main')
  assert.deepEqual(r.unresolvable, [])
  assert.deepEqual(r.resolved, [{ path: 'docs/roadmap/features/302-old-slug/status.md', rule: 'pruned (deleted on base)' }])
  assert.equal(fs.existsSync('docs/roadmap/features/302-old-slug/status.md'), false)
  assert.ok(fs.existsSync('docs/roadmap/features/300-fix-a/status.md'), 'own new files are untouched')
  process.chdir(prev)
}
console.log('4b resurrected paths ok')

// 5. same hotfix-log entry edited differently on both sides is ambiguous
assert.throws(() => mergeHotfixLog(log(entry('2026-10-20T02:40:18Z', 'hotfix/a', 'deployed')), log(entry('2026-10-20T02:40:18Z', 'hotfix/a', 'in-progress'))), /differs on both sides/)
// 6. diff3-style markers keep only the two sides
assert.equal(unionMarkers('h\n<<<<<<< HEAD\nours\n||||||| base\nold\n=======\ntheirs\n>>>>>>> main\nt'), 'h\ntheirs\n\nours\nt')
console.log('5-6 ambiguity + diff3 ok')
