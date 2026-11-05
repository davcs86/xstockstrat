#!/usr/bin/env node
// Resolve an in-progress `git merge origin/<base>` (HEAD = PR branch, MERGE_HEAD = base) using only the
// /merge-train allowlist; exit 2 and stage nothing when any conflicted path falls outside it.
// Usage: node scripts/merge-train-resolve.mjs --base <ref> [--own-slug <slug>]   (run after `git merge --no-commit`; prints JSON)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const UNION = ['docs/roadmap/ledger/fails.md', 'docs/roadmap/ledger/insights.md']
const HOTFIX_LOG = 'docs/runbooks/hotfix-log.md'
const PREPEND_MARKER = '<!-- New entries are prepended below this line'
const ENTRY_HEADER = /^## (\d{4}-\d{2}-\d{2}T[\d:]+Z) — /

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 })

export function classify(path, ownSlug) {
  if (UNION.includes(path)) return 'union'
  if (path === HOTFIX_LOG) return 'hotfix-log'
  const m = path.match(/^docs\/roadmap\/features\/\d{3}-([^/]+)\//)
  if (m) return ownSlug && m[1] === ownSlug ? 'ours' : 'theirs'
  if (/^docs\/reports\/[^/]+\.status$/.test(path)) return 'theirs'
  return null
}

// Each conflict block becomes base side then branch side; append-only files never lose an entry.
export function unionMarkers(text) {
  const out = []
  let mode = null, ours = [], theirs = []
  for (const line of text.split('\n')) {
    if (mode === null && line.startsWith('<<<<<<< ')) { mode = 'ours'; ours = []; theirs = []; continue }
    if (mode === 'ours' && line.startsWith('||||||| ')) { mode = 'base'; continue }
    if ((mode === 'ours' || mode === 'base') && line === '=======') { mode = 'theirs'; continue }
    if (mode === 'theirs' && line.startsWith('>>>>>>> ')) {
      const t = trimBlank(theirs), o = trimBlank(ours)
      out.push(...t)
      if (o.join('\n') !== t.join('\n')) { if (t.length && o.length) out.push(''); out.push(...o) }
      mode = null
      continue
    }
    if (mode === 'ours') ours.push(line)
    else if (mode === 'theirs') theirs.push(line)
    else if (mode === null) out.push(line)
  }
  if (mode !== null) throw new Error('unterminated conflict block')
  return out.join('\n')
}

function trimBlank(lines) {
  let a = 0, b = lines.length
  while (a < b && lines[a].trim() === '') a++
  while (b > a && lines[b - 1].trim() === '') b--
  return lines.slice(a, b)
}

function splitLog(text) {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => l.startsWith(PREPEND_MARKER))
  if (at < 0) throw new Error('hotfix-log prepend marker not found')
  const entries = []
  let cur = null
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('## ')) { cur = { header: line, body: [line] }; entries.push(cur) } else if (cur) cur.body.push(line)
  }
  for (const e of entries) e.text = trimBlank(e.body).join('\n')
  return { preamble: lines.slice(0, at + 1).join('\n'), entries }
}

// Base's entries keep their order; branch-only entries are inserted newest-first by header timestamp.
export function mergeHotfixLog(oursText, theirsText) {
  const o = splitLog(oursText), t = splitLog(theirsText)
  const byHeader = new Map(t.entries.map((e) => [e.header, e]))
  const merged = t.entries.slice()
  for (const e of o.entries) {
    const same = byHeader.get(e.header)
    if (same) { if (same.text !== e.text) throw new Error(`entry differs on both sides: ${e.header}`); continue }
    const ts = (e.header.match(ENTRY_HEADER) || [])[1]
    if (!ts) throw new Error(`entry header has no timestamp: ${e.header}`)
    let i = merged.findIndex((x) => { const xt = (x.header.match(ENTRY_HEADER) || [])[1]; return xt && xt < ts })
    if (i < 0) i = merged.length
    merged.splice(i, 0, e)
  }
  return `${t.preamble}\n\n${merged.map((e) => e.text).join('\n\n\n')}\n`
}

// Blank lines are layout, not content: only non-blank lines must survive, in order.
export function isSubsequence(needle, hay) {
  const n = needle.filter((l) => l.trim() !== '')
  let j = 0
  for (const line of hay) if (j < n.length && line === n[j]) j++
  return j === n.length
}

const stage = (n, path) => {
  try { return execFileSync('git', ['show', `:${n}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }) } catch { return null }
}

export function resolve(ownSlug, baseRef) {
  const paths = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean)
  const report = { resolved: [], unresolvable: [] }
  const plan = []
  for (const path of paths) {
    const rule = classify(path, ownSlug)
    if (!rule) { report.unresolvable.push({ path, reason: 'not on the allowlist' }); continue }
    const ours = stage(2, path), theirs = stage(3, path)
    if ((rule === 'union' || rule === 'hotfix-log') && (ours === null || theirs === null)) {
      report.unresolvable.push({ path, reason: 'deleted on one side' }); continue
    }
    let text = null
    try {
      if (rule === 'union') text = unionMarkers(fs.readFileSync(path, 'utf8'))
      if (rule === 'hotfix-log') text = mergeHotfixLog(ours, theirs)
    } catch (e) { report.unresolvable.push({ path, reason: e.message }); continue }
    if (text !== null) {
      const res = text.split('\n')
      if (!isSubsequence(theirs.split('\n'), res) || !isSubsequence(ours.split('\n'), res)) {
        report.unresolvable.push({ path, reason: 'merged text would drop lines from one side' }); continue
      }
    }
    plan.push({ path, rule, text, keep: rule === 'ours' ? ours : rule === 'theirs' ? theirs : text })
  }
  // A squash-merged parent leaves its files in the branch's history, so a path the base later deleted
  // comes back without a conflict; base-side paths are dropped again, anything else halts.
  if (baseRef) {
    const conflicted = new Set(paths)
    const added = git('diff', '--cached', '--name-only', '--diff-filter=A', baseRef).split('\n').filter((f) => f && !conflicted.has(f))
    for (const path of added) {
      if (!git('log', '-1', '--format=%h', baseRef, '--', path).trim()) continue
      const rule = classify(path, ownSlug)
      if (rule === 'theirs') plan.push({ path, rule: 'pruned (deleted on base)', text: null, keep: null })
      else if (rule !== 'ours') report.unresolvable.push({ path, reason: 'deleted on base, re-added by the branch' })
    }
  }
  if (report.unresolvable.length) return report
  for (const p of plan) {
    if (p.keep === null) git('rm', '-q', '--', p.path)
    else if (p.text !== null) { fs.writeFileSync(p.path, p.text); git('add', '--', p.path) }
    else { git('checkout', p.rule === 'ours' ? '--ours' : '--theirs', '--', p.path); git('add', '--', p.path) }
    report.resolved.push({ path: p.path, rule: p.rule })
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : '' }
  if (!arg('--base')) { console.error('usage: merge-train-resolve.mjs --base <ref> [--own-slug <slug>]'); process.exit(64) }
  const report = resolve(arg('--own-slug'), arg('--base'))
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.unresolvable.length ? 2 : 0)
}
