#!/usr/bin/env node
// Config-key wiring check (feature 278). Prints `file:key:kind[:env]` lines, never config values.
// Usage: node scripts/check-config-wiring.mjs [--root <dir>] [--final] [--declared-from <spec.md>]
//        [--declared-migration <file>] [--keys <ns.key,...>] [--inventory <jsonl>]... [--json]
//        node scripts/check-config-wiring.mjs --emit-heal-data --inventory <staging> --inventory <fresh>
//        node scripts/check-config-wiring.mjs --doc-check
//        exit 0 clean, 1 findings, 2 error
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = path.join('services', 'xstockstrat-config', 'migrations')
const TABLE = 'config.config_values'
const EMPTY_REGISTRY = { forwarders: {}, dynamic: {}, receivers: {} }
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

const isId = (tok, word) => tok && tok.t === 'id' && tok.v.toLowerCase() === word
const isOp = (tok, v) => tok && tok.t === 'op' && tok.v === v

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
  insert(r) { const k = [r.namespace, r.key, r.environment, r.userId ?? ''].join('\u0000'); if (!this.rows.has(k)) this.rows.set(k, r) }
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

function classify(tokens) {
  const head = tokens[0] && tokens[0].t === 'id' ? tokens[0].v.toLowerCase() : ''
  const table = head === 'update' ? tokens[1] : head === 'insert' || head === 'delete' ? tokens[2] : null
  if (!table || table.t !== 'id' || table.v.toLowerCase() !== TABLE) return null
  if (head === 'insert' && !isId(tokens[1], 'into')) return null
  if (head === 'delete' && !isId(tokens[1], 'from')) return null
  return head
}

export const PREFIXED_READ_OWNER = 'feature 304'
const BASELINE_KINDS = new Set(['seeded-unread', 'read-unseeded', 'form-mismatch', 'prefixed-read', 'dynamic-read', 'unattributed', 'type-mismatch', 'metadata-missing', 'default-mismatch', 'readers-disagree'])
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
      if (e.kind === 'prefixed-read' && e.owner !== PREFIXED_READ_OWNER) errs.push(`${id}: a prefixed-read entry must be owned by "${PREFIXED_READ_OWNER}"`)
    })
  }
  const registry = json.registry ?? {}
  if (typeof registry !== 'object' || Array.isArray(registry)) errs.push('registry must be an object')
  else for (const [k, v] of Object.entries(registry.receivers ?? {})) {
    if (typeof v !== 'string' && !isList(v)) errs.push(`registry.receivers[${JSON.stringify(k)}]: must be a namespace or a non-empty list of namespaces`)
  }
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

const STORED_REL = 'scripts/config-wiring-stored.json'
const GENERATOR_REL = 'scripts/config-wiring-stored.sh'
const ROW_FIELDS = ['namespace', 'key', 'environment', 'global', 'is_secret', 'value_type', 'description', 'consuming_service', 'default_value']
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

// Must match the generator's manifest: `<sha256>  <path>` per input file, LC_ALL=C path order.
export function storedInputsSha256(root) {
  const files = walk(root, SEED_DIR)
  if (fs.existsSync(path.join(root, GENERATOR_REL))) files.push(GENERATOR_REL)
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return sha256(files.map((f) => `${sha256(fs.readFileSync(path.join(root, f)))}  ${f}\n`).join(''))
}

export function loadStored(root) {
  const file = path.join(root, STORED_REL)
  if (!fs.existsSync(file)) return { inputsSha256: null, rows: [] }
  let json
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`${STORED_REL}: ${err.message}`)
  }
  if (!json || !Array.isArray(json.rows)) throw new Error(`${STORED_REL}: rows must be an array`)
  json.rows.forEach((r, i) => {
    const missing = ROW_FIELDS.filter((f) => !(f in (r ?? {})))
    if (missing.length || typeof r.namespace !== 'string' || typeof r.key !== 'string' || typeof r.environment !== 'string') {
      throw new Error(`${STORED_REL}: rows[${i}] lacks ${missing.join(', ') || 'string namespace/key/environment'}`)
    }
  })
  return { inputsSha256: json.inputs_sha256 ?? null, rows: json.rows }
}

// Global rows only, keyed (namespace, key, environment); secret rows are kept apart and never joined as seeds.
export function storedSets(rows) {
  const stored = new Map()
  const secrets = new Map()
  for (const r of rows) {
    if (!r.global) continue
    ;(r.is_secret ? secrets : stored).set([r.namespace, r.key, r.environment].join('\u0000'), r)
  }
  return { stored, secrets }
}

const PY_READS = path.join(REPO_ROOT, 'scripts', 'config-wiring-py-reads.py')
const SKIP_DIRS = new Set(['tests', 'test', '__tests__', 'e2e', 'node_modules', 'vendor', '.next', '.venv', 'dist'])
const LANG_EXT = { py: /\.py$/, go: /\.go$/, ts: /\.tsx?$/ }
const GETTER_RE = { go: /\.(Get(?:String|Int|Float|Bool))\s*\(/g, ts: /\.(get(?:String|Int|Float|Bool))\s*\(/g }
const INDEX_RE = /\bvalues\s*(?:\?\.\s*)?\[/g
const ASSIGN_AFTER_RE = /^\s*(?:\*\*|<<|>>>?|\?\?|&&|\|\||[-+*/%&|^])?=(?![=>])/
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

// The receiver expression ending at `end` (the getter's `.`): identifiers, `.`/`?.`/`!`, balanced ()/[] groups.
function receiverBefore(src, end, suffix = '') {
  let j = end
  if (!suffix) while (j > 0 && /\s/.test(src[j - 1])) j--
  const stop = j
  while (j > 0) {
    const c = src[j - 1]
    if (/[\w$.?!]/.test(c)) { j--; continue }
    if (c === ')' || c === ']') {
      const open = c === ')' ? '(' : '['
      let depth = 0
      let k = j - 1
      for (; k >= 0; k--) {
        if (src[k] === c) depth++
        else if (src[k] === open && --depth === 0) break
      }
      if (k < 0) break
      j = k
      continue
    }
    break
  }
  return src.slice(j, stop).replace(/\s+/g, '').replace(/^[!.?]+/, '') + suffix
}

// A literal default argument (string, number or boolean); undefined for anything else.
function literalArg(text, lang) {
  if (text === undefined) return undefined
  if (/^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(text)) return Number(text)
  if (text === 'true' || text === 'false') return text === 'true'
  const k = argKey(text, lang)
  return k && k.key !== undefined ? k.key : undefined
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
      const sites = [
        ...[...src.matchAll(GETTER_RE[lang])].map((m) => ({ open: m.index + m[0].length - 1, keyArg: 0, getter: m[1], receiver: receiverBefore(src, m.index) })),
        ...[...src.matchAll(INDEX_RE)].map((m) => ({ open: m.index + m[0].length - 1, keyArg: 0, index: true, getter: '[]', receiver: receiverBefore(src, m.index, 'values') })),
      ]
      for (const m of fwdRe ? src.matchAll(fwdRe) : []) {
        const open = m.index + m[0].length - 1
        const receiver = /\.\s*$/.test(src.slice(Math.max(0, m.index - 64), m.index)) ? receiverBefore(src, src.lastIndexOf('.', m.index)) : m[1]
        if (!defs.some((d) => d.file === file && d.open === open)) sites.push({ open, keyArg: fwds.find((f) => f.symbol === m[1]).keyArg, getter: m[1], receiver })
      }
      const decls = declsOf(src, lang)
      for (const site of sites.sort((a, b) => a.open - b.open)) {
        const call = callArgs(src, site.open, lang)
        const text = call?.args[site.keyArg]
        if (!text) continue
        if (site.index && ASSIGN_AFTER_RE.test(src.slice(call.end + 1, call.end + 200))) continue
        const def = defs.find((d) => d.file === file && site.open > d.bodyStart && site.open < d.bodyEnd)
        if (def && text === def.param) continue
        const k = argKey(text, lang)
        if (!k) continue
        const key = k.key ?? (k.ident ? resolveIdent(k.ident, file, consts) : null)
        const line = lineAt(src, site.open)
        const at = { file, line, receiver: site.receiver, getter: site.getter }
        const dflt = literalArg(call.args[site.keyArg + 1], lang)
        if (key != null) reads.push({ ...at, key, ...(dflt === undefined ? {} : { default: dflt }) })
        else dynamic.push({ ...at, symbol: symbolAt(decls, site.open) })
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
  return { reads: out.reads, dynamic: out.dynamic.map(({ file, symbol, line, receiver, getter }) => ({ file, symbol, line, receiver, getter })) }
}

// registry.dynamic enumerates the keys a dynamic site can produce; those sites become reads.
export function extractReads(root, registry = loadRegistry(root)) {
  const reads = []
  const dynamic = []
  for (const part of [extractPyReads(root, registry), extractGoReads(root, registry), extractTsReads(root, registry)]) {
    reads.push(...part.reads)
    for (const d of part.dynamic) {
      const keys = (registry.dynamic || {})[`${d.file}:${d.symbol}`]
      if (Array.isArray(keys)) reads.push(...keys.map((key) => ({ file: d.file, line: d.line, key, receiver: d.receiver, getter: d.getter })))
      else dynamic.push(d)
    }
  }
  return { reads, dynamic }
}

const SEED_DIR = MIGRATIONS.split(path.sep).join('/')
const CATALOG_REL = 'scripts/config-heal/catalog.tsv'
const CATALOG_COLS = ['namespace', 'key', 'match', 'value_type', 'code_default', 'description', 'consuming_service', 'is_secret', 'reader', 'readers_disagree']
const BOOL_COLS = new Set(['is_secret', 'readers_disagree'])
const DRYRUN_REL = 'scripts/config-heal/dryrun-fresh.tsv'
const ROW_KINDS = new Set(['seeded-unread', 'type-mismatch', 'metadata-missing', 'default-mismatch', 'readers-disagree'])
const ARMS = [['int', /int/i], ['float', /float/i], ['bool', /bool/i], ['string', /str/i]]
const armOf = (getter) => (ARMS.find(([, re]) => re.test(getter || '')) || [null])[0]
const nk = (ns, key) => `${ns}\u0000${key}`
const rowFile = (r) => (r.file ? `${SEED_DIR}/${r.file}` : r.source || STORED_REL)
const normDefault = (v) => `${typeof v}:${v}`

function defaultMatches(lit, row) {
  const stored = row.default_value
  if (stored === null || stored === undefined) return true
  if (typeof lit === 'number') return stored.trim() !== '' && Number(stored) === lit
  if (typeof lit === 'boolean') return stored.toLowerCase() === String(lit)
  return stored === lit
}

// registry.receivers["<file>:<receiver>"]: one namespace, or a list chosen by the key's `<ns>.` prefix; no default.
function attribute(read, receivers) {
  const v = receivers[`${read.file}:${read.receiver}`]
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.find((ns) => read.key.startsWith(`${ns}.`)) ?? null
  return null
}

export function loadCatalog(root) {
  const file = path.join(root, CATALOG_REL)
  if (!fs.existsSync(file)) return null
  const [, ...lines] = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '')
  return lines.map((l, i) => {
    const cells = l.split('\t')
    if (cells.length !== CATALOG_COLS.length) throw new Error(`${CATALOG_REL}:${i + 2}: expected ${CATALOG_COLS.length} columns, got ${cells.length}`)
    const c = Object.fromEntries(CATALOG_COLS.map((col, j) => [col, cells[j]]))
    return { ...c, is_secret: c.is_secret === 'true', readers_disagree: c.readers_disagree === 'true' }
  })
}

// An inventory (config_inventory.py JSONL) as stored rows; descriptions are presence flags only, values never.
export function loadInventory(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => {
    const r = JSON.parse(l)
    return {
      namespace: r.namespace, key: r.key, environment: r.environment, global: !r.user_sha256,
      is_secret: Boolean(r.is_secret || r.secret_class), value_type: r.value_type ?? null,
      description: r.has_description ? '(set)' : '', consuming_service: r.has_consuming_service ? '(set)' : '',
      default_value: null, value_sha256: r.value_sha256 ?? null, source: file,
    }
  })
}

// Readers join rows by (namespace, key); a prefixed read also matches its relative seed (narrow hoist), and checks beyond presence apply to catalog-read rows only.
export function join({ stored, secrets }, reads, { receivers = {}, catalog = null } = {}) {
  const findings = []
  const unattributed = new Map()
  const byKey = new Map()
  for (const r of reads.reads) {
    const namespace = attribute(r, receivers)
    if (!namespace) {
      const id = `${r.file}\u0000${r.receiver}\u0000${r.key}`
      if (!unattributed.has(id)) unattributed.set(id, { kind: 'unattributed', namespace: '', key: r.key, receiver: r.receiver, file: r.file })
      continue
    }
    const id = nk(namespace, r.key)
    if (!byKey.has(id)) byKey.set(id, { namespace, key: r.key, file: r.file, readers: [] })
    const e = byKey.get(id)
    e.readers.push(r)
    if (r.file < e.file) e.file = r.file
  }
  const allEnvs = [...new Set([...stored.values()].map((s) => s.environment))].sort()
  const seeded = new Map()
  for (const s of stored.values()) {
    const id = nk(s.namespace, s.key)
    if (!seeded.has(id)) seeded.set(id, { namespace: s.namespace, key: s.key, envs: new Set(), file: rowFile(s), rows: [] })
    const e = seeded.get(id)
    e.envs.add(s.environment)
    e.rows.push(s)
    if (rowFile(s) > e.file) e.file = rowFile(s)
  }
  const alt = (ns, key) => (key.startsWith(`${ns}.`) ? key.slice(ns.length + 1) : `${ns}.${key}`)
  const partnerOf = (ns, key) => (byKey.has(nk(ns, alt(ns, key))) ? alt(ns, key) : null)
  const covered = new Map()
  const cover = (id, env) => { if (!covered.has(id)) covered.set(id, new Set()); covered.get(id).add(env) }
  for (const s of seeded.values()) {
    const relSeed = !s.key.startsWith(`${s.namespace}.`)
    for (const env of s.envs) cover(nk(s.namespace, s.key), env)
    // Only a relative seed covers its prefixed read: before the alias is active a prefixed seed must stay visible.
    if (relSeed) for (const env of s.envs) cover(nk(s.namespace, `${s.namespace}.${s.key}`), env)
    if (byKey.has(nk(s.namespace, s.key))) continue
    const readKey = partnerOf(s.namespace, s.key)
    if (readKey === null) findings.push({ kind: 'seeded-unread', namespace: s.namespace, key: s.key, file: s.file })
    else if (!relSeed) {
      for (const env of s.envs) cover(nk(s.namespace, readKey), env)
      findings.push({ kind: 'form-mismatch', namespace: s.namespace, key: s.key, readKey, file: s.file })
    }
  }
  const secretIds = new Set([...secrets.values()].flatMap((r) => [nk(r.namespace, r.key), nk(r.namespace, alt(r.namespace, r.key))]))
  const excluded = (ns, key) => secretIds.has(nk(ns, key)) ||
    (catalog || []).some((c) => c.namespace === ns && (c.match === 'prefix' ? key.startsWith(c.key) : c.is_secret && c.key === key))
  for (const [id, e] of byKey) {
    const missing = allEnvs.filter((env) => !covered.get(id)?.has(env))
    if (e.key.startsWith(`${e.namespace}.`) && seeded.has(nk(e.namespace, e.key.slice(e.namespace.length + 1))) && !excluded(e.namespace, e.key)) {
      findings.push({ kind: 'prefixed-read', namespace: e.namespace, key: e.key, file: e.file })
    }
    if ((allEnvs.length && !missing.length) || excluded(e.namespace, e.key)) continue
    const f = { kind: 'read-unseeded', namespace: e.namespace, key: e.key, file: e.file }
    if (missing.length && missing.length < allEnvs.length) f.envs = missing
    findings.push(f)
  }
  const sites = new Map(reads.dynamic.map((d) => [`${d.file}:${d.symbol}`, d]))
  for (const d of sites.values()) findings.push({ kind: 'dynamic-read', namespace: '', key: d.symbol, file: d.file })
  const both = (c) => [nk(c.namespace, c.key), nk(c.namespace, alt(c.namespace, c.key))]
  const catalogIds = catalog ? new Set(catalog.filter((c) => c.match !== 'prefix').flatMap(both)) : null
  const flaggedIds = new Set((catalog || []).filter((c) => c.match !== 'prefix' && c.readers_disagree).flatMap(both))
  for (const [id, e] of byKey) {
    const s = seeded.get(id) ?? seeded.get(nk(e.namespace, alt(e.namespace, e.key)))
    if (!s || (catalogIds && !catalogIds.has(id))) continue
    const at = { namespace: e.namespace, key: e.key }
    // The catalog flag covers a reader with no literal default, which the literal comparison cannot see.
    const disagree = flaggedIds.has(id) || new Set(e.readers.filter((r) => r.default !== undefined).map((r) => normDefault(r.default))).size > 1
    if (disagree) findings.push({ kind: 'readers-disagree', ...at, file: e.file })
    if (s.rows.some((row) => !row.description || !row.consuming_service)) findings.push({ kind: 'metadata-missing', ...at, file: s.file })
    const badType = e.readers.find((r) => {
      const arm = armOf(r.getter)
      return arm && s.rows.some((row) => row.value_type && row.value_type !== arm && !(arm === 'float' && row.value_type === 'int'))
    })
    if (badType) findings.push({ kind: 'type-mismatch', ...at, file: badType.file })
    const badDefault = !disagree && e.readers.find((r) => r.default !== undefined && s.rows.some((row) => !defaultMatches(r.default, row)))
    if (badDefault) findings.push({ kind: 'default-mismatch', ...at, file: badDefault.file })
  }
  findings.push(...unattributed.values())
  return findings
}

export function findingLine(f) {
  const key = f.kind === 'form-mismatch' ? `${f.namespace}/${f.key}->${f.readKey}`
    : ROW_KINDS.has(f.kind) ? `${f.namespace}/${f.key}`
      : f.kind === 'unattributed' ? `${f.receiver}:${f.key}` : f.key
  return [f.file, key, f.kind, ...(f.envs ? [f.envs.join(',')] : [])].join(':')
}

const sortFindings = (findings) => findings.map((f) => [findingLine(f), f]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, f]) => f)

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
const GATED_UNLESS_BASELINED = new Set(['dynamic-read', 'unattributed'])
const namesOf = (f) => (f.namespace ? [canonical(f.namespace, f.key), f.key, f.readKey].filter(Boolean) : [f.key])
const isReported = (f, policy) => f.kind === 'readers-disagree' || (policy.envReadUnseeded === 'reported' && f.kind === 'read-unseeded' && Boolean(f.envs))
const sameId = (e, f) => e.kind === f.kind && e.namespace === f.namespace && e.key === f.key && (!e.file || e.file === f.file)
const entryLine = (e) => `config-wiring.json:${e.namespace && e.kind !== 'read-unseeded' ? `${e.namespace}/` : ''}${e.key}:${e.kind}${e.envs ? `:${e.envs.join(',')}` : ''}`

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

function freshness(root, storedData) {
  if (storedData.inputsSha256 === storedInputsSha256(root)) return []
  return [{ line: `STALE-STORED: ${STORED_REL} inputs_sha256 does not match the config migrations; regenerate it with DATABASE_URL=<scratch postgres> bash ${GENERATOR_REL}`, fail: true }]
}

// Every feature-305/306-owned seeded-unread entry must be an `unread-no-partner` row of the committed fresh dry-run.
function membership(root, state) {
  const owed = state.findings.filter((e) => e.kind === 'seeded-unread' && /^feature (305|306)\b/.test(e.owner))
  if (!owed.length) return []
  const have = new Set()
  const file = path.join(root, DRYRUN_REL)
  if (fs.existsSync(file)) {
    const [head, ...rows] = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => l.split('\t'))
    const [a, n, k] = ['action', 'namespace', 'key'].map((col) => {
      const i = head.indexOf(col)
      if (i < 0) throw new Error(`${DRYRUN_REL}: header lacks column ${col}`)
      return i
    })
    for (const r of rows) if (r[a] === 'unread-no-partner') have.add(nk(r[n], canonical(r[n], r[k])))
  }
  return owed.filter((e) => !have.has(nk(e.namespace, canonical(e.namespace, e.key))))
    .map((e) => ({ line: `NOT-IN-DRYRUN: ${entryLine(e)} (${e.owner}) has no unread-no-partner row in ${DRYRUN_REL}`, fail: true }))
}

const sqlText = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

// Prints the catalog_041 and allow_041 VALUES blocks; allow tuples are global, non-secret twins of an exact catalog key.
export function emitHealData(root, inventories) {
  const catalog = loadCatalog(root)
  if (!catalog) throw new Error(`${CATALOG_REL} not found; --emit-heal-data needs the frozen catalog`)
  const empty = catalog.filter((c) => c.description.trim() === '')
  if (empty.length) throw new Error(`${CATALOG_REL}: empty description for ${empty.map((c) => `${c.namespace}/${c.key}`).join(', ')}`)
  const matches = (ns, key, exactOnly) => catalog.some((c) => c.namespace === ns && (c.match === 'prefix' ? !exactOnly && key.startsWith(c.key) : c.key === key))
  const tuples = new Set()
  for (const file of inventories) {
    for (const r of loadInventory(file)) {
      if (!r.global || r.is_secret || !r.value_sha256 || matches(r.namespace, r.key, false)) continue
      const partner = r.key.startsWith(`${r.namespace}.`) ? r.key.slice(r.namespace.length + 1) : `${r.namespace}.${r.key}`
      if (matches(r.namespace, partner, true)) tuples.add([r.namespace, r.key, r.environment, r.value_sha256].map(sqlText).join(', '))
    }
  }
  const block = (name, cols, rows) => [
    `-- ${name}:begin`,
    rows.length ? `(VALUES\n${rows.map((r) => `  (${r})`).join(',\n')}\n) AS ${name}(${cols.join(', ')})` : `(SELECT ${cols.map((c) => `NULL::text AS ${c}`).join(', ')} WHERE false) AS ${name}`,
    `-- ${name}:end`,
  ].join('\n')
  const catalogRows = catalog.map((c) => CATALOG_COLS.map((col) => (BOOL_COLS.has(col) ? String(c[col]) : sqlText(c[col]))).join(', '))
  return `${block('catalog_041', CATALOG_COLS, catalogRows)}\n${block('allow_041', ['namespace', 'key', 'environment', 'value_sha256'], [...tuples].sort())}\n`
}

const DOC_RULES = [
  ['docs/sdd/constitution.md', 'C-05'],
  ['services/xstockstrat-config/docs/context-constitution.md', 'CONFIG-9'],
  ['docs/patterns/config-governance.md', null],
]
const DOC_RULE_SENTENCES = ["the stored key equals the reader's exact spelling", 'every read key is seeded']
const DOC_BANNED = [/NO fixed convention/, /seeding waiver/i]

// Reads only the DOC_RULES files: docs/reports and feature dirs are point-in-time records.
export function docCheck(root) {
  const out = []
  for (const [rel, rowId] of DOC_RULES) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8')
    const scope = rowId ? (text.split('\n').find((l) => l.startsWith(`| **${rowId}** |`)) ?? '') : text
    if (!scope) { out.push({ line: `${rel}: ${rowId} row not found`, fail: true }); continue }
    const flat = scope.replace(/\s+/g, ' ').toLowerCase()
    for (const s of DOC_RULE_SENTENCES) if (!flat.includes(s)) out.push({ line: `${rel}: missing rule sentence "${s}"`, fail: true })
    for (const re of DOC_BANNED) if (re.test(scope)) out.push({ line: `${rel}: banned phrase ${re}`, fail: true })
  }
  return out
}

// Step-time: only declared keys gate (missing-side legs are PENDING); unattributed and dynamic reads gate unless baselined.
export function stepTime(findings, state, declared) {
  const out = []
  if (!declared.size) return out
  for (const f of findings) {
    if (namesOf(f).some((n) => declared.has(n))) {
      if (isReported(f, state.policy)) out.push({ line: `REPORTED: ${findingLine(f)}`, fail: false })
      else if (MISSING_SIDE.has(f.kind)) out.push({ line: `PENDING: ${findingLine(f)}`, fail: false })
      else out.push({ line: findingLine(f), fail: true })
    } else if (GATED_UNLESS_BASELINED.has(f.kind) && !state.findings.some((e) => sameId(e, f))) out.push({ line: findingLine(f), fail: true })
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
      inventory: { type: 'string', multiple: true },
      'emit-heal-data': { type: 'boolean', default: false },
      'doc-check': { type: 'boolean', default: false },
    },
  })
  const root = path.resolve(values.root)
  const inventories = values.inventory ?? []
  if (values['emit-heal-data']) {
    process.stdout.write(emitHealData(root, inventories))
    return 0
  }
  if (values['doc-check']) {
    const out = docCheck(root)
    if (out.length) process.stdout.write(out.map((r) => r.line).join('\n') + '\n')
    return out.length ? 1 : 0
  }
  const state = loadState(root)
  const { registry } = state
  const declared = new Set([
    ...(values['declared-from'] ? declaredFromSpec(values['declared-from']) : []),
    ...(values['declared-migration'] ? declaredFromMigration(values['declared-migration']) : []),
    ...(values.keys ? values.keys.split(',').map((k) => k.trim()).filter(Boolean) : []),
  ])
  const storedData = loadStored(root)
  const sets = storedSets(storedData.rows)
  const reads = extractReads(root, registry)
  const opts = { receivers: registry.receivers, catalog: loadCatalog(root) }
  const findings = sortFindings(join(sets, reads, opts))
  const results = values.final
    ? [...ratchet(findings, state), ...freshness(root, storedData), ...membership(root, state)]
    : stepTime(findings, state, declared)
  const reported = inventories.map((file) => ({ file, findings: sortFindings(join(storedSets(loadInventory(file)), reads, opts)) }))
  for (const inv of reported) for (const f of inv.findings) results.push({ line: `REPORTED: inventory ${path.basename(inv.file)}: ${findingLine(f)}`, fail: false })
  const lines = results.map((r) => r.line)
  if (values.json) process.stdout.write(JSON.stringify({ findings, results, inventories: reported, counts: { stored: sets.stored.size, secrets: sets.secrets.size } }, null, 2) + '\n')
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
