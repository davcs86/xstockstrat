import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { buildStoredSet } from './check-config-wiring.mjs'
import * as cw from './check-config-wiring.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'check-config-wiring.mjs')
const SEED = path.join(HERE, 'config-wiring-fixtures', 'seed')
const MIG = path.join('services', 'xstockstrat-config', 'migrations')

const rows = (map) => [...map.values()].map((r) => `${r.namespace}|${r.key}|${r.environment}`).sort()
const cli = (root, ...args) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' })

function scratch(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgwire-'))
  fs.cpSync(path.join(SEED, fixture), dir, { recursive: true })
  return dir
}

test('1 bare seed is stored verbatim, never normalized', () => {
  const s = buildStoredSet(path.join(SEED, 'bare-insert'))
  assert.deepEqual(rows(s.stored), [
    'ingest|mcp_client.request_timeout_seconds|production',
    'ingest|mcp_client.request_timeout_seconds|staging',
  ])
  assert.deepEqual(s.unmodelled, [])
})

test('2 029 heal prefixes listed bare non-secret keys only', () => {
  const s = buildStoredSet(path.join(SEED, 'heal-029'))
  assert.deepEqual(rows(s.stored), [
    'ledger|stream.notify_enabled|staging',
    'platform|platform.log_level|staging',
    'trading|trading.risk.max_position_pct|staging',
  ])
  assert.deepEqual(rows(s.secrets), ['marketdata|alpaca.api_key|staging'])
  assert.deepEqual(s.unmodelled, [])
})

test('3 017 rename moves dev rows to staging and ignores config_audit', () => {
  const s = buildStoredSet(path.join(SEED, 'rename-017'))
  assert.deepEqual(rows(s.stored), [
    'ledger|stream.notify_enabled|staging',
    'platform|maintenance_mode|production',
    'platform|maintenance_mode|staging',
  ])
  assert.deepEqual(s.unmodelled, [])
})

test('4 down files, per-user rows and secret values stay out', () => {
  const root = path.join(SEED, 'scope-and-secret')
  const s = buildStoredSet(root)
  assert.deepEqual(rows(s.stored), ['notify|notify.fanout.enabled|staging'])
  assert.deepEqual(rows(s.secrets), ['marketdata|vendor.api_key|staging'])
  assert.deepEqual(s.unmodelled, [])
  assert.ok(!JSON.stringify([...s.stored.values(), ...s.secrets.values()]).includes('TOPSECRET-VALUE-778'))
  for (const args of [[], ['--json']]) {
    const r = cli(root, ...args)
    assert.notEqual(r.status, 2, r.stderr)
    assert.ok(!(r.stdout + r.stderr).includes('TOPSECRET-VALUE-778'))
  }
})

test('5 unmodelled rewrite fails closed; allow-list is file plus statement hash', () => {
  const s = buildStoredSet(path.join(SEED, 'unmodelled'))
  assert.equal(s.unmodelled.length, 1)
  const [u] = s.unmodelled
  assert.equal(u.file, '002_delete.up.sql')
  assert.match(u.sha256, /^[0-9a-f]{64}$/)

  const dir = scratch('unmodelled')
  let r = cli(dir, '--final')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /002_delete\.up\.sql:.*:unmodelled-rewrite/)

  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  const registry = { forwarders: {}, dynamic: {}, rewriteAllow: [{ file: u.file, sha256: u.sha256, reason: 'fixture' }] }
  fs.writeFileSync(path.join(dir, 'scripts', 'config-wiring.json'), JSON.stringify({ registry }))
  r = cli(dir, '--final')
  assert.notEqual(r.status, 2, r.stderr)
  assert.doesNotMatch(r.stdout, /unmodelled-rewrite/)
  assert.deepEqual(buildStoredSet(dir).unmodelled, [])

  const sql = path.join(dir, MIG, '002_delete.up.sql')
  fs.writeFileSync(sql, fs.readFileSync(sql, 'utf8').replace("'staging'", "'production'"))
  r = cli(dir, '--final')
  assert.equal(r.status, 1)
  assert.equal(buildStoredSet(dir).unmodelled.length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('6 multi-row VALUES and duplicates give one entry per (namespace, key, environment)', () => {
  const s = buildStoredSet(path.join(SEED, 'multi-row'))
  assert.equal(s.stored.size, 3)
  assert.deepEqual(rows(s.stored), [
    'analysis|analysis.k1|production',
    'analysis|analysis.k1|staging',
    'analysis|analysis.k2|staging',
  ])
  assert.deepEqual(s.unmodelled, [])
})

test('7 031 heal: twin dedupe, literal-list prefix heal, insert, key-neutral update', () => {
  const s = buildStoredSet(path.join(SEED, 'heal-031'))
  assert.deepEqual(rows(s.stored), [
    'indicators|indicators.sandbox.allowed_imports|staging',
    'indicators|indicators.sandbox.memory_bytes|staging',
    'indicators|indicators.sandbox.timeout_ms|production',
    'indicators|indicators.sandbox.timeout_ms|staging',
    'indicators|sandbox.max_concurrent|staging',
  ])
  assert.deepEqual(rows(s.secrets), ['indicators|sandbox.allowed_imports|staging'])
  assert.deepEqual(s.unmodelled, [])
})

test('8 literal DELETE (key = and key IN) removes the key from every environment', () => {
  const s = buildStoredSet(path.join(SEED, 'literal-delete'))
  assert.deepEqual(rows(s.stored), ['portfolio|portfolio.watchlist.max_per_user|staging'])
  assert.deepEqual(s.unmodelled, [])
})

test('9 key-neutral UPDATE, trigger DDL, function bodies and comments are not rewrites', () => {
  const s = buildStoredSet(path.join(SEED, 'key-neutral'))
  assert.deepEqual(rows(s.stored), [
    'analysis|analysis.opportunity.signal_rank_weight|staging',
    'analysis|signals.weights|staging',
  ])
  assert.deepEqual(s.unmodelled, [])

  for (const stmt of [
    "UPDATE config.config_values SET key = 'other.key' WHERE namespace = 'analysis' AND key = 'signals.weights';",
    "UPDATE config.config_values SET environment = 'production' WHERE namespace = 'analysis';",
  ]) {
    const dir = scratch('key-neutral')
    fs.writeFileSync(path.join(dir, MIG, '003_rewrite.up.sql'), stmt + '\n')
    const u = buildStoredSet(dir).unmodelled
    assert.equal(u.length, 1, stmt)
    assert.equal(u[0].file, '003_rewrite.up.sql')
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

const READERS = path.join(HERE, 'config-wiring-fixtures', 'readers')
const PY_A = 'services/xstockstrat-analysis/app'
const PY_I = 'services/xstockstrat-ingest/app'
const GO_MD = 'services/xstockstrat-marketdata/internal'
const TS_UI = 'services/xstockstrat-ui/src/lib/index_reads.ts'
const FWD_PY = { [`${PY_I}/config/watcher.py:int_positive`]: { keyArg: 1 } }
const FWD_GO = { [`${GO_MD}/service/forwarder.go:resolvePositiveInt`]: { keyArg: 1 } }
const DYN = { [`${PY_A}/dynamic_fstring.py:is_enabled`]: ['analysis.breakout.enabled', 'analysis.momentum.enabled'] }

const reg = (over = {}) => ({ forwarders: {}, dynamic: {}, rewriteAllow: [], ...over })
const readKeys = (res, file) => res.reads.filter((r) => r.file === file).map((r) => r.key).sort()
const dynSites = (res, prefix = '') => res.dynamic.filter((d) => d.file.startsWith(prefix)).map((d) => `${d.file}:${d.symbol}`).sort()

test('a Python multi-line call, plain literal, same-file constant and values index resolve', () => {
  const res = cw.extractReads(READERS, reg())
  assert.deepEqual(readKeys(res, `${PY_A}/literal_and_const.py`), [
    'analysis.backtest.max_duration_seconds',
    'analysis.fundsignal.enabled',
    'analysis.index_lit',
    'marketdata.fundamentals.provider',
  ])
  assert.deepEqual(dynSites(res, `${PY_A}/literal_and_const.py`), [])
})

test('b Python f-string key with a parameter is exactly one dynamic entry', () => {
  const res = cw.extractReads(READERS, reg())
  const d = res.dynamic.filter((x) => x.file === `${PY_A}/dynamic_fstring.py`)
  assert.equal(d.length, 1)
  assert.equal(d[0].symbol, 'is_enabled')
  assert.equal(d[0].line, 2)
  assert.deepEqual(readKeys(res, `${PY_A}/dynamic_fstring.py`), [])
})

test('c registry.dynamic enumerates the site instead of reporting it', () => {
  const res = cw.extractReads(READERS, reg({ dynamic: DYN }))
  assert.deepEqual(readKeys(res, `${PY_A}/dynamic_fstring.py`), ['analysis.breakout.enabled', 'analysis.momentum.enabled'])
  assert.deepEqual(dynSites(res, `${PY_A}/dynamic_fstring.py`), [])
})

test('d Go literal split over lines resolves; comments are not reads (false-dynamic = 0)', () => {
  const res = cw.extractReads(READERS, reg())
  assert.deepEqual(readKeys(res, `${GO_MD}/config/split_literal.go`), [
    'marketdata.factor_map',
    'marketdata.feed.enabled',
    'marketdata.feed.symbols',
  ])
  assert.deepEqual(dynSites(res, `${GO_MD}/config/`), [])
})

test('e Go forwarder is dynamic without a registry entry and resolves at its callers with one', () => {
  const without = cw.extractReads(READERS, reg())
  assert.deepEqual(dynSites(without, `${GO_MD}/service/`), [`${GO_MD}/service/forwarder.go:resolvePositiveInt`])
  assert.deepEqual(readKeys(without, `${GO_MD}/service/forwarder.go`), [])

  const withFwd = cw.extractReads(READERS, reg({ forwarders: FWD_GO }))
  assert.deepEqual(readKeys(withFwd, `${GO_MD}/service/forwarder.go`), ['marketdata.backfill.batch_size', 'marketdata.backfill.max_concurrent'])
  assert.deepEqual(dynSites(withFwd, `${GO_MD}/service/`), [])
})

test('f Go and Python constants resolve to their literal', () => {
  const res = cw.extractReads(READERS, reg({ forwarders: FWD_GO }))
  assert.ok(readKeys(res, `${GO_MD}/config/split_literal.go`).includes('marketdata.factor_map'))
  assert.ok(readKeys(res, `${GO_MD}/service/forwarder.go`).includes('marketdata.backfill.batch_size'))
  assert.ok(readKeys(res, `${PY_A}/literal_and_const.py`).includes('analysis.fundsignal.enabled'))
})

test('g TS literal index and getter are reads; values[key] is dynamic', () => {
  const res = cw.extractReads(READERS, reg())
  assert.deepEqual(readKeys(res, TS_UI), ['performance.risk_free_rate_annual', 'performance.window_days'])
  assert.deepEqual(dynSites(res, TS_UI), [`${TS_UI}:getString`])
})

test('h GetSecret calls are never ordinary reads', () => {
  const res = cw.extractReads(READERS, reg({ forwarders: { ...FWD_PY, ...FWD_GO }, dynamic: DYN }))
  const all = res.reads.map((r) => r.key)
  assert.ok(!all.includes('marketdata.alpaca.api_key'))
  assert.ok(!all.includes('ui.vendor.api_key'))
})

test('i tests/ directories are not scanned', () => {
  const res = cw.extractReads(READERS, reg())
  const files = [...res.reads, ...res.dynamic].map((r) => r.file)
  assert.ok(files.length > 0)
  assert.ok(!files.some((f) => f.includes('/tests/')))
  assert.ok(!res.reads.some((r) => r.key === 'analysis.should_not_be_scanned'))
})

test('j int_positive forwarder: callers resolve with the entry; body is one dynamic without it', () => {
  const withFwd = cw.extractReads(READERS, reg({ forwarders: FWD_PY }))
  assert.deepEqual(readKeys(withFwd, `${PY_I}/config/watcher.py`), ['ingest.backfill.max_concurrent_jobs', 'ingest.backfill.max_retry_attempts'])
  assert.deepEqual(readKeys(withFwd, `${PY_I}/engine/forwarder_caller.py`), ['ingest.mcp_client.request_timeout_seconds'])
  assert.deepEqual(dynSites(withFwd, PY_I), [])

  const without = cw.extractReads(READERS, reg())
  assert.deepEqual(readKeys(without, `${PY_I}/config/watcher.py`), ['ingest.backfill.max_retry_attempts'])
  assert.deepEqual(readKeys(without, `${PY_I}/engine/forwarder_caller.py`), [])
  assert.deepEqual(dynSites(without, PY_I), [`${PY_I}/config/watcher.py:int_positive`])
})

test('k a call through the get_int_present alias resolves like get_int', () => {
  const res = cw.extractReads(READERS, reg())
  const r = res.reads.find((x) => x.key === 'ingest.backfill.max_retry_attempts')
  assert.equal(r.file, `${PY_I}/config/watcher.py`)
  assert.equal(r.line, 15)
})

test('l TS and Go values[...] assignment targets are neither reads nor dynamic-reads', () => {
  const res = cw.extractReads(READERS, reg())
  const TS_W = 'services/xstockstrat-ui/src/lib/index_writes.ts'
  const GO_W = `${GO_MD}/config/index_writes.go`
  assert.deepEqual(readKeys(res, TS_W), ['analysis.breakout.enabled', 'performance.risk_free_rate_annual'])
  assert.deepEqual(dynSites(res, TS_W), [])
  assert.deepEqual(readKeys(res, GO_W), ['marketdata.feed.symbols'])
  assert.deepEqual(dynSites(res, GO_W), [])
})

const JOIN = path.join(HERE, 'config-wiring-fixtures', 'join')
const SEEDS = 'services/xstockstrat-config/migrations'
const lines = (r) => r.stdout.split('\n').filter(Boolean)

test('join 1 @AC-1 form-mismatch names both strings and suppresses the pair (both directions)', () => {
  const r = cli(path.join(JOIN, 'mismatch'), '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [
    `${SEEDS}/001_seed.up.sql:ingest/ingest.signals.window_hours->signals.window_hours:form-mismatch`,
    `${SEEDS}/001_seed.up.sql:ingest/mcp_client.request_timeout_seconds->ingest.mcp_client.request_timeout_seconds:form-mismatch`,
  ])
})

test('join 2 @AC-2 seeded-unread names the last seeding migration, no env', () => {
  const r = cli(path.join(JOIN, 'seeded-unread'), '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [`${SEEDS}/002_reseed.up.sql:ledger/stream.notify_enabled:seeded-unread`])
})

test('join 3+6 @AC-3 read-unseeded is one finding per key across reader files', () => {
  const r = cli(path.join(JOIN, 'read-unseeded'), '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), ['services/xstockstrat-ingest/app/config/watcher.py:ingest.backfill.retry_on_failure:read-unseeded'])
})

test('join 4 @AC-9 an f-string key is one dynamic-read naming file and symbol', () => {
  const r = cli(READERS, '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r).filter((l) => l.startsWith(`${PY_A}/dynamic_fstring.py:`)), [`${PY_A}/dynamic_fstring.py:is_enabled:dynamic-read`])
})

test('join 5 env collapse: missing everywhere has no env; production-only seed reports :staging', () => {
  const root = path.join(JOIN, 'env-collapse')
  const r = cli(root, '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [
    'REPORTED: services/xstockstrat-ingest/app/flags.py:ingest.alpha.enabled:read-unseeded:staging',
    'services/xstockstrat-ingest/app/flags.py:ingest.gamma.enabled:read-unseeded',
  ])
  const j = JSON.parse(cli(root, '--json').stdout)
  assert.deepEqual(j.findings.map((f) => [f.key, f.kind, f.envs]), [
    ['ingest.alpha.enabled', 'read-unseeded', ['staging']],
    ['ingest.gamma.enabled', 'read-unseeded', undefined],
  ])
})

test('join 7 negative matches (dotted, ui/agent bare, 029/031 healed) are wired', () => {
  const r = cli(path.join(JOIN, 'negative-matches'), '--final')
  assert.equal(r.stdout, '')
  assert.equal(r.status, 0, r.stderr)
})

test('join 8 a secret row and a GetSecret read give no finding and no value text', () => {
  for (const args of [[], ['--json']]) {
    const r = cli(path.join(JOIN, 'secret'), '--final', ...args)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.ok(!(r.stdout + r.stderr).includes('SECRETVALUE-JOIN-913'))
  }
  assert.equal(cli(path.join(JOIN, 'secret'), '--final').stdout, '')
})

test('CLI usage errors exit 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /config-wiring:/)
})

const RATCHET = path.join(HERE, 'config-wiring-fixtures', 'ratchet')
const ANALYSIS_MISMATCH = `${SEEDS}/001_seed.up.sql:analysis/fundsignal.enabled->analysis.fundsignal.enabled:form-mismatch`
const LEDGER_UNREAD = `${SEEDS}/001_seed.up.sql:ledger/stream.notify_enabled:seeded-unread`

// Copies fixture trees into a scratch --root and installs `config` as scripts/config-wiring.json.
function stage(trees, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgwire-ratchet-'))
  for (const t of trees) fs.cpSync(path.join(RATCHET, t, 'services'), path.join(dir, 'services'), { recursive: true })
  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
    const text = typeof config === 'string' ? fs.readFileSync(path.join(RATCHET, config), 'utf8') : JSON.stringify(config)
    fs.writeFileSync(path.join(dir, 'scripts', 'config-wiring.json'), text)
  }
  return dir
}
const state = (findings, policy = 'reported') => ({ policy: { envReadUnseeded: policy }, findings, registry: { forwarders: {}, dynamic: {}, rewriteAllow: [] } })

test('ratchet 1 @AC-7 a finding not in the baseline fails --final and is named; a baselined one passes; a gone one is stale', () => {
  let dir = stage(['new-finding'], 'new-finding/config-wiring.json')
  let r = cli(dir, '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [LEDGER_UNREAD])

  dir = stage(['new-finding'], state([{ namespace: 'ledger', key: 'stream.notify_enabled', kind: 'seeded-unread', owner: 'feature 278' }]))
  r = cli(dir, '--final')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(r.stdout, '')

  dir = stage(['new-finding'], state([
    { namespace: 'ledger', key: 'stream.notify_enabled', kind: 'seeded-unread', owner: 'feature 278' },
    { namespace: 'analysis', key: 'backtest.max_duration_seconds', kind: 'seeded-unread', owner: 'feature 278' },
  ]))
  r = cli(dir, '--final')
  assert.equal(r.status, 1)
  assert.deepEqual(lines(r), ['STALE: config-wiring.json:analysis/backtest.max_duration_seconds:seeded-unread'])
})

test('ratchet 2 @AC-8 an entry with an empty or missing owner is rejected by name (exit 2), in every mode', () => {
  const dir = stage([], 'no-owner/config-wiring.json')
  for (const args of [[], ['--final'], ['--keys', 'ledger.stream.notify_enabled']]) {
    const r = cli(dir, ...args)
    assert.equal(r.status, 2, r.stdout)
    assert.match(r.stderr, /findings\[1\] seeded-unread:analysis\/backtest\.max_duration_seconds: owner/)
    assert.match(r.stderr, /findings\[2\] read-unseeded:ingest\.backfill\.retry_on_failure: owner/)
    assert.doesNotMatch(r.stderr, /findings\[0\]/)
  }
  const bogus = stage([], state([{ namespace: 'ledger', key: 'stream.notify_enabled', kind: 'seeded-unread', owner: 'someone' }]))
  const r = cli(bogus, '--final')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /findings\[0\].*owner/)
})

test('ratchet 3 env-list ratchet: an oversized envs entry is stale-in-part and passes once shrunk', () => {
  let dir = stage(['stale-in-part'], 'stale-in-part/config-wiring.json')
  let r = cli(dir, '--final')
  assert.equal(r.status, 1)
  assert.deepEqual(lines(r), ['STALE-IN-PART: config-wiring.json:ingest.alpha.enabled:read-unseeded:staging,production (produced: staging)'])

  const shrunk = JSON.parse(fs.readFileSync(path.join(RATCHET, 'stale-in-part', 'config-wiring.json'), 'utf8'))
  shrunk.findings[0].envs = ['staging']
  dir = stage(['stale-in-part'], shrunk)
  r = cli(dir, '--final')
  assert.equal(r.status, 0, r.stdout + r.stderr)

  shrunk.findings[0].envs = ['production']
  dir = stage(['stale-in-part'], shrunk)
  r = cli(dir, '--final')
  assert.equal(r.status, 1)
  assert.ok(lines(r).includes('services/xstockstrat-ingest/app/flags.py:ingest.alpha.enabled:read-unseeded:staging'))
})

test('ratchet 4 @AC-4 step-time: a form-mismatch on a declared key fails and names finding and key', () => {
  const r = cli(stage(['step-time']), '--keys', 'analysis.fundsignal.enabled')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [ANALYSIS_MISMATCH])
})

test('ratchet 5 @AC-5 step-time: unrelated findings never block', () => {
  const dir = stage(['step-time'])
  let r = cli(dir)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(r.stdout, '')
  r = cli(dir, '--keys', 'ingest.some.other_key')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(r.stdout, /stream\.notify_enabled/)
  assert.equal(cli(dir, '--final').status, 1)
})

test('ratchet 6 @AC-10 --declared-migration on a non-config migration declares its inserted key and fails on its finding', () => {
  assert.deepEqual(cw.declaredFromMigration(path.join(RATCHET, 'declared', 'migration.up.sql')), ['analysis.fundsignal.enabled'])
  const r = cli(stage(['step-time']), '--declared-migration', path.join(RATCHET, 'declared', 'migration.up.sql'))
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [ANALYSIS_MISMATCH])
})

test('ratchet 7 two-step: each leg alone is PENDING at step time and fails --final; both legs pass', () => {
  for (const leg of ['seed-only', 'reader-only']) {
    const dir = stage([`two-step/${leg}`])
    let r = cli(dir, '--keys', 'ingest.backfill.new_flag')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(lines(r).length, 1)
    assert.match(lines(r)[0], /^PENDING: .*new_flag:(seeded-unread|read-unseeded)$/)
    r = cli(dir, '--final', '--keys', 'ingest.backfill.new_flag')
    assert.equal(r.status, 1)
    assert.doesNotMatch(r.stdout, /PENDING/)
  }
  const both = stage(['two-step/seed-only', 'two-step/reader-only'])
  assert.equal(cli(both, '--keys', 'ingest.backfill.new_flag').status, 0)
  assert.equal(cli(both, '--final').status, 0)
})

test('ratchet 8 policy: reported never changes the exit code; blocking does', () => {
  const ALPHA = 'services/xstockstrat-ingest/app/flags.py:ingest.alpha.enabled:read-unseeded:staging'
  let r = cli(stage(['policy'], 'policy/reported/config-wiring.json'), '--final')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(lines(r), [`REPORTED: ${ALPHA}`])
  r = cli(stage(['policy'], 'policy/reported/config-wiring.json'), '--keys', 'ingest.alpha.enabled')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(lines(r), [`REPORTED: ${ALPHA}`])

  r = cli(stage(['policy'], 'policy/blocking/config-wiring.json'), '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [ALPHA])

  r = cli(stage(['policy'], { policy: { envReadUnseeded: 'warn' }, findings: [] }), '--final')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /envReadUnseeded/)
})

test('ratchet 9 --declared-from reads keys only from ## Config Key Changes', () => {
  const spec = path.join(RATCHET, 'declared', 'product-spec.md')
  assert.deepEqual(cw.declaredFromSpec(spec), ['analysis.fundsignal.enabled', 'ingest.backfill.new_flag', 'ingest.backfill.retry_on_failure'])
  const r = cli(stage(['step-time']), '--declared-from', spec)
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [ANALYSIS_MISMATCH])
})
