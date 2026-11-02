#!/usr/bin/env node
// Config-key wiring check (feature 278). Prints `file:key:kind[:env]` lines, never config values.
// Usage: node scripts/check-config-wiring.mjs [--root <dir>] [--final] [--declared-from <spec.md>]
//        [--declared-migration <file>] [--keys <ns.key,...>] [--json]   exit 0 clean, 1 findings, 2 error
import { spawnSync } from 'node:child_process'
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

const BASELINE_KINDS = new Set(['seeded-unread', 'read-unseeded', 'form-mismatch', 'dynamic-read'])
const OWNER_RE = /^(feature )?(243|278)\b|^(defect|feature) .+/
const POLICIES = new Set(['blocking', 'reported'])
const isList = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s !== '')
const entryId = (e) => `${e.kind}:${e.namespace ? `${e.namespace}/` : ''}${e.key}`

// Schema errors (any entry without a matching owner included) throw, which the CLI maps to exit 2.
export function validateState(json) {
  const errs = []
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('scripts/config-wiring.json: top level must be an object')
  const policy = json.policy ?? {}
  const envReadUnseeded = policy.envReadUnseeded ?? 'reported'
  if (!POLICIES.has(envReadUnseeded)) errs.push(`policy.envReadUnseeded must be "blocking" or "reported", got ${JSON.stringify(envReadUnseeded)}`)
  const findings = json.findings ?? []
  if (!Array.isArray(findings)) errs.push('findings must be an array')
  else {
    findings.forEach((e, i) => {
      if (!e || typeof e !== 'object') return errs.push(`findings[${i}]: must be an object`)
      const id = `findings[${i}] ${entryId(e)}`
      if (typeof e.namespace !== 'string') errs.push(`${id}: namespace must be a string`)
      if (typeof e.key !== 'string' || e.key === '') errs.push(`${id}: key must be a non-empty string`)
      if (!BASELINE_KINDS.has(e.kind)) errs.push(`${id}: kind must be one of ${[...BASELINE_KINDS].join(', ')}`)
      if (e.envs !== undefined && !isList(e.envs)) errs.push(`${id}: envs must be a non-empty list of environment names`)
      if (e.file !== undefined && (typeof e.file !== 'string' || e.file === '')) errs.push(`${id}: file must be a non-empty string`)
      if (typeof e.owner !== 'string' || !OWNER_RE.test(e.owner)) errs.push(`${id}: owner missing or not matching ${OWNER_RE.source}`)
    })
  }
  const registry = json.registry ?? {}
  if (typeof registry !== 'object' || Array.isArray(registry)) errs.push('registry must be an object')
  if (errs.length) throw new Error(`scripts/config-wiring.json:\n  ${errs.join('\n  ')}`)
  return { policy: { envReadUnseeded }, findings, registry: { ...EMPTY_REGISTRY, ...registry } }
}

export function loadState(root) {
  const file = path.join(root, 'scripts', 'config-wiring.json')
  if (!fs.existsSync(file)) return validateState({})
  let json
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`scripts/config-wiring.json: ${err.message}`)
  }
  return validateState(json)
}

export const loadRegistry = (root) => loadState(root).registry

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

const PY_READS = path.join(REPO_ROOT, 'scripts', 'config-wiring-py-reads.py')
const SKIP_DIRS = new Set(['tests', 'test', '__tests__', 'e2e', 'node_modules', 'vendor', '.next', '.venv', 'dist'])
const LANG_EXT = { py: /\.py$/, go: /\.go$/, ts: /\.tsx?$/ }
const GETTER_RE = { go: /\.(Get(?:String|Int|Float|Bool))\s*\(/g, ts: /\.(get(?:String|Int|Float|Bool))\s*\(/g }
const INDEX_RE = /\bvalues\s*(?:\?\.\s*)?\[/g
const DECL_RE = {
  go: /^func\s+(?:\(\s*(?:\w+\s+)?\*?\s*(\w+)(?:\[[^\]]*\])?\s*\)\s*)?(\w+)\s*[([]/gm,
  ts: /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:(?:public|private|protected|static|readonly|override|async)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{;=]+)?\{|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>)/gm,
}
const NOT_DECL = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function'])

function walk(root, rel, out = []) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) return out
  const ents = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const ent of ents) {
    const r = path.posix.join(rel, ent.name)
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(root, r, out) } else if (ent.isFile()) out.push(r)
  }
  return out
}

function listServices(root) {
  const dir = path.join(root, 'services')
  return fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []
}

function forwardersOf(registry, lang) {
  return Object.entries(registry.forwarders || {})
    .map(([k, v]) => ({ file: k.slice(0, k.lastIndexOf(':')), symbol: k.slice(k.lastIndexOf(':') + 1), keyArg: v.keyArg }))
    .filter((f) => LANG_EXT[lang].test(f.file) && /^[A-Za-z_$][\w$]*$/.test(f.symbol) && Number.isInteger(f.keyArg))
}

function skipString(src, i, lang) {
  const q = src[i]
  const raw = q === '`' && lang === 'go'
  let j = i + 1
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\' && !raw) j++
    else if (src[j] === '\n' && q !== '`') break
    j++
  }
  return j + 1
}

// Replaces comments with spaces (newlines kept) so offsets and line numbers stay exact.
function blankComments(src, lang) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      const lineComment = src[i + 1] === '/'
      let stop = lineComment ? src.indexOf('\n', i) : src.indexOf('*/', i + 2)
      stop = stop < 0 ? src.length : lineComment ? stop : stop + 2
      out += src.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
    } else if (c === '"' || c === "'" || c === '`') {
      const stop = skipString(src, i, lang)
      out += src.slice(i, stop)
      i = stop
    } else {
      out += c
      i++
    }
  }
  return out
}

function callArgs(src, open, lang) {
  const args = []
  let depth = 0
  let start = open + 1
  for (let j = open; j < src.length; j++) {
    const c = src[j]
    if (c === '"' || c === "'" || c === '`') { j = skipString(src, j, lang) - 1; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (--depth === 0) { args.push(src.slice(start, j).trim()); return { args, end: j } }
    } else if (c === ',' && depth === 1) { args.push(src.slice(start, j).trim()); start = j + 1 }
  }
  return null
}

function argKey(text, lang) {
  const m = /^"((?:[^"\\\n]|\\.)*)"$/.exec(text) || (lang === 'ts' && /^'((?:[^'\\\n]|\\.)*)'$/.exec(text)) || /^`([^`$\\]*)`$/.exec(text)
  if (m) return { key: m[1] }
  if (/^[0-9]/.test(text)) return null
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(text)) return { ident: text }
  return { dynamic: true }
}

function goConsts(src) {
  const out = []
  let block = false
  for (const line of src.split('\n')) {
    if (/^(?:const|var)\s*\(\s*$/.test(line)) { block = true; continue }
    if (block && /^\)/.test(line)) { block = false; continue }
    const re = block ? /^\s+([A-Za-z_]\w*)(?:\s+string)?\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/ : /^(?:const|var)\s+([A-Za-z_]\w*)(?:\s+string)?\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/
    const m = re.exec(line)
    if (m) out.push([m[1], m[2]])
  }
  return out
}

function tsConsts(src) {
  const re = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*(?:'([^'\\\n]*)'|"([^"\\\n]*)")\s*;?\s*$/gm
  return [...src.matchAll(re)].map((m) => [m[1], m[2] ?? m[3]])
}

// Same file, then same package/dir, then service-wide; ambiguous or absent -> unresolved.
function resolveIdent(ident, file, consts) {
  const dot = ident.indexOf('.')
  const dirOf = (f) => path.posix.dirname(f)
  let tiers
  if (dot >= 0) {
    const pkg = ident.slice(0, dot)
    const name = ident.slice(dot + 1)
    tiers = [consts.filter((c) => c.name === name && path.posix.basename(dirOf(c.file)) === pkg)]
  } else {
    const named = consts.filter((c) => c.name === ident)
    tiers = [named.filter((c) => c.file === file), named.filter((c) => dirOf(c.file) === dirOf(file)), named]
  }
  for (const tier of tiers) {
    const values = new Set(tier.map((c) => c.value))
    if (values.size === 1) return [...values][0]
    if (values.size > 1) return null
  }
  return null
}

function declsOf(src, lang) {
  const out = []
  for (const m of src.matchAll(DECL_RE[lang])) {
    const name = lang === 'go' ? (m[1] ? `${m[1]}.${m[2]}` : m[2]) : m[1] || m[2] || m[3]
    if (name && !NOT_DECL.has(name)) out.push({ at: m.index, name })
  }
  return out
}

const symbolAt = (decls, at) => decls.filter((d) => d.at < at).at(-1)?.name ?? '<module>'
const lineAt = (src, at) => src.slice(0, at).split('\n').length

function locateDef(src, fw, lang) {
  if (!src) return null
  const re = lang === 'go'
    ? new RegExp(`func\\s+(?:\\([^)]*\\)\\s*)?${fw.symbol}\\s*\\(`)
    : new RegExp(`(?:function\\s+${fw.symbol}|^[ \\t]*(?:(?:public|private|protected|static|async)\\s+)*${fw.symbol})\\s*\\(`, 'm')
  const m = re.exec(src)
  if (!m) return null
  const open = m.index + m[0].length - 1
  const params = callArgs(src, open, lang)
  const bodyStart = params ? src.indexOf('{', params.end) : -1
  const body = bodyStart >= 0 ? callArgs(src, bodyStart, lang) : null
  if (!body) return null
  const param = /^[A-Za-z_$][\w$]*/.exec(params.args[fw.keyArg] || '')
  return { file: fw.file, open, bodyStart, bodyEnd: body.end, param: param ? param[0] : null }
}

function extractRegexReads(root, registry, lang) {
  const reads = []
  const dynamic = []
  const allFwds = forwardersOf(registry, lang)
  for (const svc of listServices(root)) {
    const base = lang === 'go' ? `services/${svc}` : `services/${svc}/src`
    const files = walk(root, base).filter((f) => (lang === 'go' ? /\.go$/.test(f) && !/_test\.go$/.test(f) : /\.tsx?$/.test(f) && !/\.(test|spec|d)\.tsx?$/.test(f)))
    const srcs = new Map(files.map((f) => [f, blankComments(fs.readFileSync(path.join(root, f), 'utf8'), lang)]))
    const consts = [...srcs].flatMap(([file, src]) => (lang === 'go' ? goConsts : tsConsts)(src).map(([name, value]) => ({ file, name, value })))
    const fwds = allFwds.filter((f) => f.file.startsWith(`services/${svc}/`))
    const defs = fwds.map((fw) => locateDef(srcs.get(fw.file), fw, lang)).filter(Boolean)
    const fwdRe = fwds.length ? new RegExp(`(?<![\\w$])(${fwds.map((f) => f.symbol).join('|')})\\s*\\(`, 'g') : null
    for (const [file, src] of srcs) {
      const sites = [...src.matchAll(GETTER_RE[lang]), ...src.matchAll(INDEX_RE)].map((m) => ({ open: m.index + m[0].length - 1, keyArg: 0 }))
      for (const m of fwdRe ? src.matchAll(fwdRe) : []) {
        const open = m.index + m[0].length - 1
        if (!defs.some((d) => d.file === file && d.open === open)) sites.push({ open, keyArg: fwds.find((f) => f.symbol === m[1]).keyArg })
      }
      const decls = declsOf(src, lang)
      for (const site of sites.sort((a, b) => a.open - b.open)) {
        const text = callArgs(src, site.open, lang)?.args[site.keyArg]
        if (!text) continue
        const def = defs.find((d) => d.file === file && site.open > d.bodyStart && site.open < d.bodyEnd)
        if (def && text === def.param) continue
        const k = argKey(text, lang)
        if (!k) continue
        const key = k.key ?? (k.ident ? resolveIdent(k.ident, file, consts) : null)
        const line = lineAt(src, site.open)
        if (key != null) reads.push({ file, line, key })
        else dynamic.push({ file, symbol: symbolAt(decls, site.open), line })
      }
    }
  }
  return { reads, dynamic }
}

export const extractGoReads = (root, registry) => extractRegexReads(root, registry, 'go')
export const extractTsReads = (root, registry) => extractRegexReads(root, registry, 'ts')

export function extractPyReads(root, registry) {
  const r = spawnSync('python3', ['-I', PY_READS, root, JSON.stringify(forwardersOf(registry, 'py'))], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`python reader failed: ${(r.stderr || r.error?.message || '').trim()}`)
  const out = JSON.parse(r.stdout)
  return { reads: out.reads, dynamic: out.dynamic.map(({ file, symbol, line }) => ({ file, symbol, line })) }
}

// registry.dynamic enumerates the keys a dynamic site can produce; those sites become reads.
export function extractReads(root, registry = loadRegistry(root)) {
  const reads = []
  const dynamic = []
  for (const part of [extractPyReads(root, registry), extractGoReads(root, registry), extractTsReads(root, registry)]) {
    reads.push(...part.reads)
    for (const d of part.dynamic) {
      const keys = (registry.dynamic || {})[`${d.file}:${d.symbol}`]
      if (Array.isArray(keys)) reads.push(...keys.map((key) => ({ file: d.file, line: d.line, key })))
      else dynamic.push(d)
    }
  }
  return { reads, dynamic }
}

const SEED_DIR = MIGRATIONS.split(path.sep).join('/')

// Per (namespace, key, environment), then one finding per (namespace, key, kind); `envs` only on partial seeding.
export function join(stored, reads) {
  const byKey = new Map()
  for (const r of reads.reads) if (!byKey.has(r.key) || r.file < byKey.get(r.key)) byKey.set(r.key, r.file)
  const allEnvs = [...new Set([...stored.values()].map((s) => s.environment))].sort()
  const seeded = new Map()
  for (const s of stored.values()) {
    const id = `${s.namespace}\u0000${s.key}`
    if (!seeded.has(id)) seeded.set(id, { namespace: s.namespace, key: s.key, envs: new Set(), file: s.file })
    const e = seeded.get(id)
    e.envs.add(s.environment)
    if (s.file > e.file) e.file = s.file
  }
  const partnerOf = (ns, key) => (byKey.has(`${ns}.${key}`) ? `${ns}.${key}` : key.startsWith(`${ns}.`) && byKey.has(key.slice(ns.length + 1)) ? key.slice(ns.length + 1) : null)
  const findings = []
  const covered = new Map()
  const cover = (key, env) => { if (!covered.has(key)) covered.set(key, new Set()); covered.get(key).add(env) }
  for (const s of seeded.values()) {
    for (const env of s.envs) cover(s.key, env)
    if (byKey.has(s.key)) continue
    const readKey = partnerOf(s.namespace, s.key)
    const file = `${SEED_DIR}/${s.file}`
    if (readKey === null) findings.push({ kind: 'seeded-unread', namespace: s.namespace, key: s.key, file })
    else {
      for (const env of s.envs) cover(readKey, env)
      findings.push({ kind: 'form-mismatch', namespace: s.namespace, key: s.key, readKey, file })
    }
  }
  for (const [key, file] of byKey) {
    const missing = allEnvs.filter((env) => !covered.get(key)?.has(env))
    if (allEnvs.length && !missing.length) continue
    const f = { kind: 'read-unseeded', namespace: '', key, file }
    if (missing.length && missing.length < allEnvs.length) f.envs = missing
    findings.push(f)
  }
  const sites = new Map(reads.dynamic.map((d) => [`${d.file}:${d.symbol}`, d]))
  for (const d of sites.values()) findings.push({ kind: 'dynamic-read', namespace: '', key: d.symbol, file: d.file })
  return findings
}

export function findingLine(f) {
  const key = f.kind === 'form-mismatch' ? `${f.namespace}/${f.key}->${f.readKey}` : f.kind === 'seeded-unread' ? `${f.namespace}/${f.key}` : f.key
  return [f.file, key, f.kind, ...(f.envs ? [f.envs.join(',')] : [])].join(':')
}

const DECLARED_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/
const canonical = (ns, key) => (key.startsWith(`${ns}.`) ? key : `${ns}.${key}`)

export function declaredFromSpec(file) {
  const out = new Set()
  let inSection = false
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (/^##\s/.test(line)) { inSection = /^##\s+Config Key Changes\s*$/.test(line); continue }
    if (inSection) for (const m of line.matchAll(/`([^`\n]+)`/g)) if (DECLARED_KEY_RE.test(m[1])) out.add(m[1])
  }
  return [...out].sort()
}

export function declaredFromMigration(file) {
  const out = new Set()
  for (const tokens of splitStatements(fs.readFileSync(file, 'utf8'))) {
    if (classify(tokens) !== 'insert') continue
    const state = new StoredState()
    if (!applyInsert(tokens, state, path.basename(file))) throw new Error(`${file}:L${tokens[0].line}: INSERT INTO ${TABLE} shape not understood`)
    for (const r of state.rows.values()) out.add(canonical(r.namespace, r.key))
  }
  return [...out].sort()
}

const MISSING_SIDE = new Set(['seeded-unread', 'read-unseeded'])
const KEYLESS = new Set(['dynamic-read', 'unmodelled-rewrite'])
const namesOf = (f) => (f.namespace ? [canonical(f.namespace, f.key), f.readKey].filter(Boolean) : [f.key])
const isReported = (f, policy) => policy.envReadUnseeded === 'reported' && f.kind === 'read-unseeded' && Boolean(f.envs)
const sameId = (e, f) => e.kind === f.kind && e.namespace === f.namespace && e.key === f.key && (!e.file || e.file === f.file)
const entryLine = (e) => `config-wiring.json:${e.namespace ? `${e.namespace}/` : ''}${e.key}:${e.kind}${e.envs ? `:${e.envs.join(',')}` : ''}`

// Entries may only shrink: a produced finding must be covered, and every entry must still be produced at its full env list.
export function ratchet(findings, state) {
  const out = []
  const entries = state.findings.filter((e) => !isReported(e, state.policy))
  const used = new Set()
  for (const f of findings) {
    if (isReported(f, state.policy)) { out.push({ line: `REPORTED: ${findingLine(f)}`, fail: false }); continue }
    const i = entries.findIndex((e, k) => !used.has(k) && sameId(e, f))
    if (i >= 0) used.add(i)
    const e = entries[i]
    if (!e || (e.envs && (!f.envs || !f.envs.every((env) => e.envs.includes(env))))) { out.push({ line: findingLine(f), fail: true }); continue }
    if (f.envs && (!e.envs || e.envs.length > f.envs.length)) out.push({ line: `STALE-IN-PART: ${entryLine(e)} (produced: ${f.envs.join(',')})`, fail: true })
  }
  entries.forEach((e, k) => { if (!used.has(k)) out.push({ line: `STALE: ${entryLine(e)}`, fail: true }) })
  return out
}

// Step-time: only declared keys gate (missing-side legs are PENDING); keyless kinds gate unless baselined.
export function stepTime(findings, state, declared) {
  const out = []
  if (!declared.size) return out
  for (const f of findings) {
    if (namesOf(f).some((n) => declared.has(n))) {
      if (isReported(f, state.policy)) out.push({ line: `REPORTED: ${findingLine(f)}`, fail: false })
      else if (MISSING_SIDE.has(f.kind)) out.push({ line: `PENDING: ${findingLine(f)}`, fail: false })
      else out.push({ line: findingLine(f), fail: true })
    } else if (KEYLESS.has(f.kind) && !state.findings.some((e) => sameId(e, f))) out.push({ line: findingLine(f), fail: true })
  }
  return out
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
  const state = loadState(root)
  const { registry } = state
  const declared = new Set([
    ...(values['declared-from'] ? declaredFromSpec(values['declared-from']) : []),
    ...(values['declared-migration'] ? declaredFromMigration(values['declared-migration']) : []),
    ...(values.keys ? values.keys.split(',').map((k) => k.trim()).filter(Boolean) : []),
  ])
  const { stored, secrets, unmodelled } = buildStoredSet(root, { registry })
  const findings = [
    ...unmodelled.map((u) => ({ kind: 'unmodelled-rewrite', namespace: '', key: `L${u.line}`, file: `${SEED_DIR}/${u.file}`, sha256: u.sha256 })),
    ...join(stored, extractReads(root, registry)),
  ]
    .map((f) => [findingLine(f), f])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, f]) => f)
  const results = values.final ? ratchet(findings, state) : stepTime(findings, state, declared)
  const lines = results.map((r) => r.line)
  if (values.json) process.stdout.write(JSON.stringify({ findings, results, counts: { stored: stored.size, secrets: secrets.size } }, null, 2) + '\n')
  else if (lines.length) process.stdout.write(lines.join('\n') + '\n')
  return results.some((r) => r.fail) ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    process.exitCode = run(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`config-wiring: ${err.message}\n`)
    process.exitCode = 2
  }
}
