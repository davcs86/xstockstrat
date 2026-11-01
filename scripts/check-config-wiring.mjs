#!/usr/bin/env node
// Config-key wiring check (feature 278). Prints `file:key:kind[:env]` lines, never config values.
// Usage: node scripts/check-config-wiring.mjs [--root <dir>] [--final] [--declared-from <spec.md>]
//        [--declared-migration <file>] [--keys <ns.key,...>] [--json]   exit 0 clean, 1 findings, 2 error
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = path.join('services', 'xstockstrat-config', 'migrations')
const TABLE = 'config.config_values'
const SCOPE_COLS = new Set(['namespace', 'key', 'environment', 'is_secret', 'user_id'])
const EMPTY_REGISTRY = { forwarders: {}, dynamic: {}, rewriteAllow: [] }
const TWO_CHAR_OPS = new Set(['||', '::', '<>', '!=', '>=', '<=', '=>'])

export function tokenize(sql) {
  const out = []
  let i = 0
  let line = 1
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    if (c === '\n') { line++; i++; continue }
    if (/\s/.test(c)) { i++; continue }
    if (c === '-' && sql[i + 1] === '-') { while (i < n && sql[i] !== '\n') i++; continue }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      line += (sql.slice(i, stop).match(/\n/g) || []).length
      i = stop
      continue
    }
    const start = line
    if (c === "'") {
      let v = ''
      i++
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { v += "'"; i += 2; continue }
        if (sql[i] === "'") { i++; break }
        if (sql[i] === '\n') line++
        v += sql[i++]
      }
      out.push({ t: 'str', v, line: start })
      continue
    }
    const dollar = c === '$' ? /^\$[A-Za-z_]*\$/.exec(sql.slice(i)) : null
    if (dollar) {
      const end = sql.indexOf(dollar[0], i + dollar[0].length)
      const stop = end < 0 ? n : end + dollar[0].length
      line += (sql.slice(i, stop).match(/\n/g) || []).length
      out.push({ t: 'dq', v: '$$', line: start })
      i = stop
      continue
    }
    if (c === '"') {
      const end = sql.indexOf('"', i + 1)
      const stop = end < 0 ? n : end + 1
      out.push({ t: 'id', v: sql.slice(i + 1, stop - 1), line: start })
      i = stop
      continue
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*/.exec(sql.slice(i, i + 256))
    if (ident) { out.push({ t: 'id', v: ident[0], line: start }); i += ident[0].length; continue }
    const num = /^[0-9]+(?:\.[0-9]+)?/.exec(sql.slice(i, i + 64))
    if (num) { out.push({ t: 'num', v: num[0], line: start }); i += num[0].length; continue }
    const two = sql.slice(i, i + 2)
    if (TWO_CHAR_OPS.has(two)) { out.push({ t: 'op', v: two, line: start }); i += 2; continue }
    out.push({ t: 'op', v: c, line: start })
    i++
  }
  return out
}

export function splitStatements(sql) {
  const stmts = []
  let cur = []
  for (const tok of tokenize(sql)) {
    if (tok.t === 'op' && tok.v === ';') { if (cur.length) stmts.push(cur); cur = []; continue }
    cur.push(tok)
  }
  if (cur.length) stmts.push(cur)
  return stmts
}

const render = (tok) => (tok.t === 'str' ? `'${tok.v.replace(/'/g, "''")}'` : tok.t === 'id' ? tok.v.toLowerCase() : tok.v)
const isId = (tok, word) => tok && tok.t === 'id' && tok.v.toLowerCase() === word
const isOp = (tok, v) => tok && tok.t === 'op' && tok.v === v

export const statementHash = (tokens) => createHash('sha256').update(tokens.map(render).join(' ')).digest('hex')

function splitTop(tokens, isSep) {
  const parts = [[]]
  let depth = 0
  for (const tok of tokens) {
    if (isOp(tok, '(')) depth++
    if (isOp(tok, ')')) depth--
    if (depth === 0 && isSep(tok)) { parts.push([]); continue }
    parts[parts.length - 1].push(tok)
  }
  return parts
}

function matchParen(tokens, open) {
  let depth = 0
  for (let j = open; j < tokens.length; j++) {
    if (isOp(tokens[j], '(')) depth++
    if (isOp(tokens[j], ')') && --depth === 0) return j
  }
  return -1
}

const stripAlias = (tokens, alias) =>
  tokens.map((tok) => (alias && tok.t === 'id' && tok.v.toLowerCase().startsWith(`${alias}.`) ? { ...tok, v: tok.v.slice(alias.length + 1) } : tok))
const norm = (tokens) => tokens.map(render).join(' ')

function eqLit(c, col) {
  return c.length === 3 && isId(c[0], col) && isOp(c[1], '=') && c[2].t === 'str' ? c[2].v : null
}

function inList(c, col) {
  if (c.length < 5 || !isId(c[0], col) || !isId(c[1], 'in') || !isOp(c[2], '(') || matchParen(c, 2) !== c.length - 1) return null
  const items = splitTop(c.slice(3, -1), (tok) => isOp(tok, ','))
  return items.every((it) => it.length === 1 && it[0].t === 'str') ? items.map((it) => it[0].v) : null
}

const isFalse = (c, col) => c.length === 3 && isId(c[0], col) && isOp(c[1], '=') && isId(c[2], 'false')
const conjuncts = (tokens, alias) => splitTop(stripAlias(tokens, alias), (tok) => isId(tok, 'and'))

// Each guard list must match the WHERE clause exactly (any order); an extra conjunct is unmodelled.
function matchGuards(conj, guards) {
  if (conj.length !== guards.length) return null
  const out = {}
  const used = new Set()
  for (const g of guards) {
    const idx = conj.findIndex((c, k) => !used.has(k) && g(c, out))
    if (idx < 0) return null
    used.add(idx)
  }
  return out
}

function literal(tokens) {
  if (tokens.length !== 1) return undefined
  const [tok] = tokens
  if (tok.t === 'str') return tok.v
  if (isId(tok, 'null')) return null
  if (isId(tok, 'true')) return true
  if (isId(tok, 'false')) return false
  return undefined
}

class StoredState {
  constructor() { this.rows = new Map() }
  static id(r) { return [r.namespace, r.key, r.environment, r.userId ?? ''].join('\u0000') }
  insert(r) { const k = StoredState.id(r); if (!this.rows.has(k)) this.rows.set(k, r) }
  rewrite(fn) {
    const next = new Map()
    for (const r of this.rows.values()) {
      const nr = fn(r)
      if (!nr) continue
      const k = StoredState.id(nr)
      if (!next.has(k)) next.set(k, nr)
    }
    this.rows = next
  }
  has(ns, key, env, userId) { return this.rows.has(StoredState.id({ namespace: ns, key, environment: env, userId })) }
}

function applyInsert(tokens, state, file) {
  if (!isOp(tokens[3], '(')) return false
  const close = matchParen(tokens, 3)
  const cols = splitTop(tokens.slice(4, close), (tok) => isOp(tok, ',')).map((c) => (c.length === 1 && c[0].t === 'id' ? c[0].v.toLowerCase() : null))
  if (cols.includes(null) || !isId(tokens[close + 1], 'values')) return false
  let j = close + 2
  const tuples = []
  while (isOp(tokens[j], '(')) {
    const end = matchParen(tokens, j)
    if (end < 0) return false
    tuples.push(splitTop(tokens.slice(j + 1, end), (tok) => isOp(tok, ',')))
    j = end + 1
    if (isOp(tokens[j], ',')) j++
  }
  const tail = tokens.slice(j)
  const doNothing = tail.length === 0 || (isId(tail[0], 'on') && isId(tail[1], 'conflict') && isId(tail.at(-2), 'do') && isId(tail.at(-1), 'nothing'))
  if (!tuples.length || !doNothing) return false
  const rows = []
  for (const vals of tuples) {
    if (vals.length !== cols.length) return false
    const v = (col, dflt) => (cols.includes(col) ? literal(vals[cols.indexOf(col)]) : dflt)
    const r = { namespace: v('namespace'), key: v('key'), environment: v('environment', 'dev'), userId: v('user_id', null), isSecret: v('is_secret', false), file }
    if (typeof r.namespace !== 'string' || typeof r.key !== 'string' || typeof r.environment !== 'string') return false
    if (r.userId !== null && typeof r.userId !== 'string') return false
    if (typeof r.isSecret !== 'boolean') return false
    rows.push(r)
  }
  for (const r of rows) state.insert(r)
  return true
}

function applyUpdate(tokens, state) {
  let j = 2
  const alias = tokens[j] && tokens[j].t === 'id' && !isId(tokens[j], 'set') ? tokens[j++].v.toLowerCase() : null
  if (!isId(tokens[j], 'set')) return false
  const body = tokens.slice(j + 1)
  const [setPart, wherePart = null, ...rest] = splitTop(body, (tok) => isId(tok, 'where'))
  if (rest.length) return false
  const assigns = splitTop(stripAlias(setPart, alias), (tok) => isOp(tok, ','))
  if (assigns.some((a) => a.length < 3 || a[0].t !== 'id' || !isOp(a[1], '='))) return false
  const set = new Map(assigns.map((a) => [a[0].v.toLowerCase(), a.slice(2)]))
  const touched = [...set.keys()].filter((c) => SCOPE_COLS.has(c))
  if (!touched.length) return true
  if (!wherePart) return false
  const conj = conjuncts(wherePart, alias)

  if (touched.length === 1 && touched[0] === 'environment' && set.size === 1) {
    const to = literal(set.get('environment'))
    const from = conj.length === 1 ? eqLit(conj[0], 'environment') : null
    if (typeof to !== 'string' || from === null) return false
    state.rewrite((r) => (r.environment === from ? { ...r, environment: to } : r))
    return true
  }

  if (touched.length !== 1 || touched[0] !== 'key' || norm(set.get('key')) !== "namespace || '.' || key") return false
  const heal029 = matchGuards(conj, [
    (c) => norm(c) === "key not like namespace || '.%'",
    (c) => isFalse(c, 'is_secret'),
    (c, o) => (o.namespaces = inList(c, 'namespace')) !== null,
  ])
  if (heal029) {
    const ns = new Set(heal029.namespaces)
    state.rewrite((r) => (ns.has(r.namespace) && !r.isSecret && !r.key.startsWith(`${r.namespace}.`) ? { ...r, key: `${r.namespace}.${r.key}` } : r))
    return true
  }
  const heal031 = matchGuards(conj, [
    (c, o) => (o.namespace = eqLit(c, 'namespace')) !== null,
    (c, o) => (o.keys = inList(c, 'key')) !== null,
    (c) => isFalse(c, 'is_secret'),
  ])
  if (heal031) {
    const keys = new Set(heal031.keys)
    state.rewrite((r) => (r.namespace === heal031.namespace && keys.has(r.key) && !r.isSecret ? { ...r, key: `${r.namespace}.${r.key}` } : r))
    return true
  }
  return false
}

function applyDelete(tokens, state) {
  let j = 3
  const alias = tokens[j] && tokens[j].t === 'id' && !isId(tokens[j], 'where') ? tokens[j++].v.toLowerCase() : null
  if (!isId(tokens[j], 'where')) return false
  const conj = conjuncts(tokens.slice(j + 1), alias)

  const literalDelete = matchGuards(conj, [
    (c, o) => (o.namespace = eqLit(c, 'namespace')) !== null,
    (c, o) => {
      const one = eqLit(c, 'key')
      o.keys = one !== null ? [one] : inList(c, 'key')
      return o.keys !== null
    },
  ])
  if (literalDelete) {
    const keys = new Set(literalDelete.keys)
    state.rewrite((r) => (r.namespace === literalDelete.namespace && keys.has(r.key) ? null : r))
    return true
  }

  if (!alias) return false
  const twin = matchGuards(conj, [
    (c, o) => (o.namespace = eqLit(c, 'namespace')) !== null,
    (c, o) => (o.keys = inList(c, 'key')) !== null,
    (c) => isFalse(c, 'is_secret'),
    (c, o) => (o.exists = c),
  ])
  if (!twin) return false
  const ex = twin.exists
  const inner = ex[6]
  if (!isId(ex[0], 'exists') || !isOp(ex[1], '(') || matchParen(ex, 1) !== ex.length - 1 || !inner || inner.t !== 'id') return false
  const t = inner.v.toLowerCase()
  const expected =
    `exists ( select 1 from ${TABLE} ${t} where ${t}.namespace = namespace and ${t}.key = '${twin.namespace}.' || key` +
    ` and ${t}.environment = environment and coalesce ( ${t}.user_id , '' ) = coalesce ( user_id , '' ) )`
  if (norm(ex) !== expected) return false
  const keys = new Set(twin.keys)
  const drop = new Set(
    [...state.rows.values()].filter(
      (r) => r.namespace === twin.namespace && keys.has(r.key) && !r.isSecret && state.has(r.namespace, `${r.namespace}.${r.key}`, r.environment, r.userId),
    ),
  )
  state.rewrite((r) => (drop.has(r) ? null : r))
  return true
}

function classify(tokens) {
  const head = tokens[0] && tokens[0].t === 'id' ? tokens[0].v.toLowerCase() : ''
  const table = head === 'update' ? tokens[1] : head === 'insert' || head === 'delete' ? tokens[2] : null
  if (!table || table.t !== 'id' || table.v.toLowerCase() !== TABLE) return null
  if (head === 'insert' && !isId(tokens[1], 'into')) return null
  if (head === 'delete' && !isId(tokens[1], 'from')) return null
  return head
}

export function loadRegistry(root) {
  const file = path.join(root, 'scripts', 'config-wiring.json')
  if (!fs.existsSync(file)) return { ...EMPTY_REGISTRY }
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  return { ...EMPTY_REGISTRY, ...(json.registry || {}) }
}

export function buildStoredSet(root, { registry = loadRegistry(root) } = {}) {
  const dir = path.join(root, MIGRATIONS)
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d+_.*\.up\.sql$/.test(f)).sort() : []
  const allow = new Set((registry.rewriteAllow || []).map((e) => `${e.file}\u0000${e.sha256}`))
  const state = new StoredState()
  const unmodelled = []
  for (const file of files) {
    for (const tokens of splitStatements(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      const kind = classify(tokens)
      if (!kind) continue
      const ok = kind === 'insert' ? applyInsert(tokens, state, file) : kind === 'update' ? applyUpdate(tokens, state) : applyDelete(tokens, state)
      if (ok) continue
      const sha256 = statementHash(tokens)
      if (!allow.has(`${file}\u0000${sha256}`)) unmodelled.push({ file, line: tokens[0].line, sha256 })
    }
  }
  const stored = new Map()
  const secrets = new Map()
  for (const r of state.rows.values()) {
    if (r.userId !== null) continue
    const entry = { namespace: r.namespace, key: r.key, environment: r.environment, file: r.file }
    ;(r.isSecret ? secrets : stored).set([r.namespace, r.key, r.environment].join('\u0000'), entry)
  }
  return { stored, secrets, unmodelled }
}

export function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string', default: REPO_ROOT },
      final: { type: 'boolean', default: false },
      'declared-from': { type: 'string' },
      'declared-migration': { type: 'string' },
      keys: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  })
  const root = path.resolve(values.root)
  const { stored, secrets, unmodelled } = buildStoredSet(root)
  const findings = unmodelled.map((u) => ({ file: path.posix.join(MIGRATIONS.split(path.sep).join('/'), u.file), key: `L${u.line}`, kind: 'unmodelled-rewrite', sha256: u.sha256 }))
  const lines = findings.map((f) => `${f.file}:${f.key}:${f.kind}`)
  if (values.json) process.stdout.write(JSON.stringify({ findings, counts: { stored: stored.size, secrets: secrets.size } }, null, 2) + '\n')
  else if (lines.length) process.stdout.write(lines.join('\n') + '\n')
  return findings.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    process.exitCode = run(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`config-wiring: ${err.message}\n`)
    process.exitCode = 2
  }
}
