import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import * as cw from './check-config-wiring.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'check-config-wiring.mjs')
const SEED = path.join(HERE, 'config-wiring-fixtures', 'seed')
const MIG = path.join('services', 'xstockstrat-config', 'migrations')
const STORED = path.join('scripts', 'config-wiring-stored.json')

const cli = (root, ...args) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' })

// Restamps a scratch root's stored JSON so --final sees it as fresh.
function stamp(dir) {
  const file = path.join(dir, STORED)
  const json = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { rows: [] }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ ...json, inputs_sha256: cw.storedInputsSha256(dir) }))
  return dir
}

test('1 --declared-migration declares a bare seed under its canonical name', () => {
  assert.deepEqual(cw.declaredFromMigration(path.join(SEED, 'bare-insert', MIG, '001_seed.up.sql')), ['ingest.mcp_client.request_timeout_seconds'])
})

test('6 multi-row VALUES, comments and quoted semicolons split into one statement per INSERT', () => {
  const file = path.join(SEED, 'multi-row', MIG, '001_seed.up.sql')
  assert.equal(cw.splitStatements(fs.readFileSync(file, 'utf8')).length, 2)
  assert.deepEqual(cw.declaredFromMigration(file), ['analysis.k1', 'analysis.k2'])
})

const READERS = path.join(HERE, 'config-wiring-fixtures', 'readers')
const PY_A = 'services/xstockstrat-analysis/app'
const PY_I = 'services/xstockstrat-ingest/app'
const GO_MD = 'services/xstockstrat-marketdata/internal'
const TS_UI = 'services/xstockstrat-ui/src/lib/index_reads.ts'
const FWD_PY = { [`${PY_I}/config/watcher.py:int_positive`]: { keyArg: 1 } }
const FWD_GO = { [`${GO_MD}/service/forwarder.go:resolvePositiveInt`]: { keyArg: 1 } }
const DYN = { [`${PY_A}/dynamic_fstring.py:is_enabled`]: ['analysis.breakout.enabled', 'analysis.momentum.enabled'] }

const reg = (over = {}) => ({ forwarders: {}, dynamic: {}, receivers: {}, ...over })
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

test('join 1 @AC-1 a prefixed seed read relative is a form-mismatch; a relative seed read prefixed is a prefixed-read', () => {
  const r = cli(path.join(JOIN, 'mismatch'), '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [
    `${SEEDS}/001_seed.up.sql:ingest/ingest.signals.window_hours->signals.window_hours:form-mismatch`,
    'services/xstockstrat-ingest/app/mcp_loop.py:ingest.mcp_client.request_timeout_seconds:prefixed-read',
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

const PREFIXED = path.join(JOIN, 'prefixed-read')
const PR_B = 'services/xstockstrat-ledger/src/reader_b.ts'
const LEDGER_RECEIVERS = ['a', 'b', 'c', 'd'].map((x) => `services/xstockstrat-ledger/src/reader_${x}.ts:cfg`)

// A scratch copy of the join/prefixed-read root; `edit(dir)` changes it before the stored JSON is re-stamped.
function prefixedCopy(edit = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgwire-prefixed-'))
  fs.cpSync(PREFIXED, dir, { recursive: true })
  const file = path.join(dir, 'scripts', 'config-wiring.json')
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.registry.receivers = Object.fromEntries(LEDGER_RECEIVERS.map((k) => [k, 'ledger']))
  edit(dir, json)
  fs.writeFileSync(file, JSON.stringify(json))
  return stamp(dir)
}
const baselineOf = (...entries) => entries.map(([kind, key]) => ({ namespace: 'ledger', key, kind, owner: 'feature 304' }))

test('join 9 @AC-6 @AC-8 a relative seed read prefixed is one prefixed-read per key; unbaselined it blocks --final', () => {
  const r = cli(PREFIXED, '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [
    `${SEEDS}/001_seed.up.sql:ledger/ledger.export.enabled->export.enabled:form-mismatch`,
    `${PR_B}:ledger.export.max_window_days:prefixed-read`,
    `${PR_B}:ledger.export.prod_only:prefixed-read`,
    `REPORTED: ${PR_B}:ledger.export.prod_only:read-unseeded:staging`,
  ])
  // The relative reader of the same key adds no read-unseeded; the secret and prefix-catalog keys add nothing.
  assert.ok(!lines(r).some((l) => /export\.max_window_days:read-unseeded|secret_token|tmpl\.alpha/.test(l)))
})

test('join 9 @AC-7 a baseline holding a prefixed-read entry is a schema error: --final exits 2 and nothing can baseline the finding', () => {
  const dir = prefixedCopy((_d, json) => {
    json.findings = baselineOf(['prefixed-read', 'ledger.export.max_window_days'], ['prefixed-read', 'ledger.export.prod_only'], ['form-mismatch', 'ledger.export.enabled'])
  })
  const r = cli(dir, '--final')
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /kind must be one of/)
  assert.throws(() => cw.validateState({ findings: baselineOf(['prefixed-read', 'ledger.export.max_window_days']) }), /kind must be one of/)
})

test('join 9 @AC-24 a second prefixed reader leaves the relative read read-unseeded; an unseeded prefixed read is only read-unseeded', () => {
  const dir = prefixedCopy((d) => {
    fs.writeFileSync(path.join(d, 'services/xstockstrat-ledger/src/reader_d.ts'),
      "export function more(cfg: { getInt(key: string, def: number): number }) {\n  return [cfg.getInt('ledger.export.enabled', 1), cfg.getInt('ledger.export.nowhere', 1)];\n}\n")
  })
  const r = cli(dir, '--final')
  assert.equal(r.status, 1, r.stderr)
  const out = lines(r)
  assert.ok(out.includes('services/xstockstrat-ledger/src/reader_c.ts:export.enabled:read-unseeded'), out.join('\n'))
  assert.ok(out.includes('services/xstockstrat-ledger/src/reader_d.ts:ledger.export.nowhere:read-unseeded'), out.join('\n'))
  assert.ok(!out.some((l) => /ledger\.export\.nowhere:prefixed-read|ledger\/ledger\.export\.enabled->export\.enabled:form-mismatch/.test(l)), out.join('\n'))
})

test('join 9 @AC-7 a leftover prefixed-read entry after the reader is rewritten relative still exits 2 (not STALE)', () => {
  const dir = prefixedCopy((d, json) => {
    json.findings = baselineOf(['prefixed-read', 'ledger.export.max_window_days'], ['form-mismatch', 'ledger.export.enabled'])
    const f = path.join(d, PR_B)
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace("'ledger.export.max_window_days'", "'export.max_window_days'"))
  })
  const r = cli(dir, '--final')
  assert.equal(r.status, 2, r.stdout + r.stderr)
})

test('join 9 @AC-9 a relative key read through a list receiver is unattributed and blocks --final (characterization)', () => {
  const dir = prefixedCopy((_d, json) => {
    json.registry.receivers['services/xstockstrat-ledger/src/reader_c.ts:cfg'] = ['ledger', 'platform']
  })
  const r = cli(dir, '--final')
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.ok(lines(r).some((l) => /reader_c\.ts:cfg:export\.enabled:unattributed/.test(l)), lines(r).join('\n'))
})

test('join 10 @AC-10 a relative read is clean when its relative row is stored, with or without a prefixed prefix-catalog row (characterization)', () => {
  const build = (withCatalog) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgwire-catalog-'))
    fs.cpSync(path.join(JOIN, 'negative-matches'), dir, { recursive: true })
    const watcher = path.join(dir, 'services/xstockstrat-indicators/app/config/watcher.py')
    fs.writeFileSync(watcher, 'class ConfigWatcher:\n    def sandbox_timeout_ms(self):\n        return self.get_int("sandbox.timeout_ms", 5000)\n')
    const storedFile = path.join(dir, STORED)
    const stored = JSON.parse(fs.readFileSync(storedFile, 'utf8'))
    for (const row of stored.rows) if (row.key === 'indicators.sandbox.timeout_ms') row.key = 'sandbox.timeout_ms'
    fs.writeFileSync(storedFile, JSON.stringify(stored))
    if (withCatalog) {
      const header = 'namespace\tkey\tmatch\tvalue_type\tcode_default\tdescription\tconsuming_service\tis_secret\treader\treaders_disagree'
      fs.mkdirSync(path.join(dir, 'scripts', 'config-heal'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'scripts', 'config-heal', 'catalog.tsv'), `${header}\nindicators\tindicators.sandbox.\tprefix\tint\t5000\tfixture\txstockstrat-indicators\tfalse\t\tfalse\n`)
    }
    return stamp(dir)
  }
  for (const withCatalog of [true, false]) {
    const r = cli(build(withCatalog), '--final')
    assert.equal(r.status, 0, `catalog=${withCatalog}: ${r.stdout}${r.stderr}`)
    assert.ok(!/sandbox\.timeout_ms:(read-unseeded|prefixed-read|form-mismatch)/.test(r.stdout), r.stdout)
  }
})

test('CLI usage errors exit 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /config-wiring:/)
})

const RATCHET = path.join(HERE, 'config-wiring-fixtures', 'ratchet')
const ANALYSIS_PREFIXED_READ = 'services/xstockstrat-analysis/app/engine/fundsignal_loop.py:analysis.fundsignal.enabled:prefixed-read'
const LEDGER_UNREAD = `${SEEDS}/001_seed.up.sql:ledger/stream.notify_enabled:seeded-unread`

const RECEIVERS = {
  'services/xstockstrat-ingest/app/flags.py:cfg': 'ingest',
  'services/xstockstrat-ingest/app/engine/backfill.py:cfg': 'ingest',
  'services/xstockstrat-analysis/app/engine/fundsignal_loop.py:cfg': 'analysis',
}

// Copies fixture trees into a scratch --root, merges their stored rows (stamped fresh), and installs
// `config` (plus RECEIVERS) as scripts/config-wiring.json.
function stage(trees, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgwire-ratchet-'))
  const rows = []
  for (const t of trees) {
    fs.cpSync(path.join(RATCHET, t, 'services'), path.join(dir, 'services'), { recursive: true })
    const stored = path.join(RATCHET, t, STORED)
    if (fs.existsSync(stored)) rows.push(...JSON.parse(fs.readFileSync(stored, 'utf8')).rows)
  }
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(dir, STORED), JSON.stringify({ rows }))
  stamp(dir)
  const json = config === undefined ? {} : typeof config === 'string' ? JSON.parse(fs.readFileSync(path.join(RATCHET, config), 'utf8')) : config
  json.registry = { ...json.registry, receivers: { ...RECEIVERS, ...json.registry?.receivers } }
  fs.writeFileSync(path.join(dir, 'scripts', 'config-wiring.json'), JSON.stringify(json))
  return dir
}
const state = (findings, policy = 'reported') => ({ policy: { envReadUnseeded: policy }, findings, registry: { forwarders: {}, dynamic: {} } })

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

test('ratchet 4 @AC-4 step-time: a prefixed-read on a declared key fails and names finding and key', () => {
  const r = cli(stage(['step-time']), '--keys', 'analysis.fundsignal.enabled')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [ANALYSIS_PREFIXED_READ])
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
  assert.deepEqual(lines(r), [ANALYSIS_PREFIXED_READ])
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
  assert.deepEqual(lines(r), [ANALYSIS_PREFIXED_READ])
})

const GATE = path.join(HERE, 'config-wiring-fixtures', 'gate')
const fresh = (fixture) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgwire-gate-'))
  fs.cpSync(path.join(GATE, fixture), dir, { recursive: true })
  return stamp(dir)
}
const STORED_LINE = 'scripts/config-wiring-stored.json'

test('ratchet 10 @AC-7 a prefixed-read entry of any owner is a schema error; the finding itself is never covered', () => {
  const f = { kind: 'prefixed-read', namespace: 'ledger', key: 'ledger.export.max_window_days', file: 'x.ts' }
  for (const owner of ['feature 304', 'feature 278']) {
    assert.throws(() => cw.validateState({ findings: [{ namespace: 'ledger', key: f.key, kind: 'prefixed-read', owner }] }), /kind must be one of/)
  }
  assert.ok(cw.ratchet([f], state([])).some((o) => o.fail), 'an unbaselined prefixed-read finding must fail')
})

test('gate 1 @AC-19 a stored row nobody reads is seeded-unread and fails --final', () => {
  const r = cli(fresh('seeded-unread'), '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [`${STORED_LINE}:ledger/ledger.no.reader:seeded-unread`])
})

test('gate 2 @AC-19 get_int of a string row is type-mismatch; get_float of an int row is allowed', () => {
  const r = cli(fresh('type-mismatch'), '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), ['services/xstockstrat-analysis/app/reader.py:analysis/analysis.x.y:type-mismatch'])
})

test('gate 3 @AC-19 a getter on an unregistered receiver is unattributed and blocks in every mode', () => {
  const dir = fresh('unattributed')
  const line = 'services/xstockstrat-ingest/app/reader.py:other:ingest.flag.on:unattributed'
  let r = cli(dir, '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [line])
  r = cli(dir, '--keys', 'ingest.some.other_key')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [line])
})

test('gate 4 metadata-missing and default-mismatch on catalog-read rows; a readers-disagree key is reported only', () => {
  const r = cli(fresh('row-checks'), '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [
    `${STORED_LINE}:ingest/ingest.meta.missing:metadata-missing`,
    'services/xstockstrat-ingest/app/reader.py:ingest/ingest.default.off:default-mismatch',
    'REPORTED: services/xstockstrat-ingest/app/reader.py:ingest/ingest.split.key:readers-disagree',
  ])
})

test('gate 4b a catalog readers_disagree flag reports the key as readers-disagree, not default-mismatch', () => {
  const dir = fresh('row-checks')
  const heal = path.join(dir, 'scripts', 'config-heal')
  fs.mkdirSync(heal, { recursive: true })
  fs.writeFileSync(path.join(heal, 'catalog.tsv'), [
    'namespace\tkey\tmatch\tvalue_type\tcode_default\tdescription\tconsuming_service\tis_secret\treader\treaders_disagree',
    'ingest\tingest.default.off\texact\tint\t5\tFlagged by triage\txstockstrat-ingest\tfalse\tservices/xstockstrat-ingest/app/reader.py:read\ttrue',
    '',
  ].join('\n'))
  const r = cli(dir, '--final')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(lines(r), ['REPORTED: services/xstockstrat-ingest/app/reader.py:ingest/ingest.default.off:readers-disagree'])
})

test('gate 5 --final fails on a stale inputs_sha256 and names the regeneration command', () => {
  const dir = fresh('stale')
  let r = cli(dir, '--final')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  fs.appendFileSync(path.join(dir, MIG, '001_seed.up.sql'), 'SELECT 2;\n')
  r = cli(dir, '--final')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /^STALE-STORED: scripts\/config-wiring-stored\.json .*bash scripts\/config-wiring-stored\.sh$/m)
  assert.equal(cli(dir).status, 0, 'step mode tolerates staleness')
})

test('gate 6 --emit-heal-data exits 2 on an empty catalog description; otherwise prints both VALUES blocks', () => {
  const inv = path.join(GATE, 'emit', 'inventory.jsonl')
  let r = cli(path.join(GATE, 'emit'), '--emit-heal-data', '--inventory', inv)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /empty description for ingest\/ingest\.empty\.desc/)

  const dir = fresh('emit')
  const tsv = path.join(dir, 'scripts', 'config-heal', 'catalog.tsv')
  fs.writeFileSync(tsv, fs.readFileSync(tsv, 'utf8').replace("it's\t\t", "it's\tNow described\t"))
  r = cli(dir, '--emit-heal-data', '--inventory', inv)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /-- catalog_041:begin\n\(VALUES\n {2}\('ingest', 'ingest\.backfill\.max_jobs', 'exact', 'int', '3', /)
  assert.match(r.stdout, /'it''s', 'Now described', 'xstockstrat-ingest', false, /)
  assert.match(r.stdout, /'services\/xstockstrat-ingest\/app\/config\/watcher\.py:max_jobs', true\),\n/)
  assert.match(r.stdout, /'services\/xstockstrat-ingest\/app\/config\/watcher\.py:empty', false\)\n\) AS catalog_041\(namespace, key, match, value_type, code_default, description, consuming_service, is_secret, reader, readers_disagree\)\n/)
  const allow = r.stdout.slice(r.stdout.indexOf('-- allow_041:begin'))
  assert.deepEqual(allow.match(/\('ingest'[^)]*\)/g), [`('ingest', 'backfill.max_jobs', 'staging', '${'a'.repeat(64)}')`])
  assert.match(allow, /\) AS allow_041\(namespace, key, environment, value_sha256\)\n-- allow_041:end\n$/)
})

test('gate 7 --final: a feature-305/306 seeded-unread entry must be unread-no-partner in dryrun-fresh.tsv', () => {
  const dir = fresh('membership')
  let r = cli(dir, '--final')
  assert.equal(r.status, 1)
  assert.deepEqual(lines(r), ['NOT-IN-DRYRUN: config-wiring.json:ledger/stream.dead:seeded-unread (feature 305) has no unread-no-partner row in scripts/config-heal/dryrun-fresh.tsv'])
  fs.appendFileSync(path.join(dir, 'scripts', 'config-heal', 'dryrun-fresh.tsv'), '2026-11-06T00:00:00Z\tunread-no-partner\tledger\tstream.dead\tstaging\tdead row kept for 296\n')
  r = cli(dir, '--final')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  r = cli(dir, '--final', '--inventory', path.join(GATE, 'emit', 'inventory.jsonl'))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(lines(r).length > 0 && lines(r).every((l) => l.startsWith('REPORTED: inventory inventory.jsonl: ')))
  // A feature-306-owned entry is checked the same way.
  const dir306 = fresh('membership')
  const cfgFile = path.join(dir306, 'scripts', 'config-wiring.json')
  fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile, 'utf8').replace('feature 305', 'feature 306'))
  r = cli(dir306, '--final')
  assert.equal(r.status, 1)
  assert.match(lines(r)[0], /\(feature 306\) has no unread-no-partner row/)
})

const REPO = path.resolve(HERE, '..')
const baseline = () => JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'config-wiring.json'), 'utf8'))
const ids = (findings) => new Set(findings.map((f) => `${f.kind}:${f.namespace}/${f.key}`))

test('baseline 1 @AC-7 --final on the real tree exits 0 (committed baseline equals the tree)', () => {
  const r = cli(REPO, '--final')
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

const NEW_KINDS = ['unattributed', 'type-mismatch', 'metadata-missing', 'default-mismatch']

test('baseline 2 @AC-8 every committed entry has an owner and a baseline kind; new kinds are owned by 295, none is dynamic-read', () => {
  const { findings } = baseline()
  assert.ok(findings.length > 0, 'findings is empty')
  for (const f of findings) {
    const id = `${f.kind}:${f.namespace}/${f.key}`
    assert.ok(typeof f.owner === 'string' && f.owner.trim() !== '', `no owner: ${id}`)
    assert.ok(['seeded-unread', 'read-unseeded', 'form-mismatch', ...NEW_KINDS].includes(f.kind), `bad kind: ${id}`)
    if (NEW_KINDS.includes(f.kind)) assert.equal(f.owner, 'feature 295', id)
    if (f.kind === 'read-unseeded') assert.notEqual(f.namespace, '', `unattributed read-unseeded: ${id}`)
  }
  assert.equal(findings.filter((f) => f.kind === 'prefixed-read').length, 0, 'the prefixed-read baseline must stay empty')
  assert.deepEqual(cw.loadStored(REPO).inputsSha256, cw.storedInputsSha256(REPO), 'committed stored JSON is stale')
})

// Copied from context.md (Step 9 reconciliation of the 277 sweep); never recompute it from the tree.
const SWEEP_277 = [
  ...['backfill.chunk_max_bars', 'backfill.chunk_window_days', 'backfill.max_concurrent_chunks',
    'mcp_client.poll_interval_seconds', 'mcp_client.request_timeout_seconds'].map((k) => `form-mismatch:ingest/${k}`),
  ...['buy_quantile', 'daily_call_budget', 'enabled', 'explicit_symbols', 'max_symbols_per_run', 'min_conviction_to_emit',
    'run_interval_hours', 'scoring_formula_id', 'sell_quantile', 'source_slug', 'universe_source', 'valid_days',
  ].map((k) => `form-mismatch:analysis/fundsignal.${k}`),
  'form-mismatch:analysis/scoring.signal_decay_half_life_hours',
  'form-mismatch:analysis/backtest.max_duration_seconds',
  'seeded-unread:ledger/stream.notify_enabled',
  ...['ingest.backfill.max_concurrent_jobs', 'ingest.backfill.retry_on_failure', 'ingest.backfill.max_retry_attempts',
    'ingest.signals.dedup_window_hours', 'analysis.fundsignal.retry_seconds', 'analysis.fundsignal.startup_jitter_seconds',
    'indicators.sandbox.max_concurrent'].map((k) => `read-unseeded:${k.split('.')[0]}/${k}`),
]

test('baseline 3 @AC-19 the 277-sweep set is drained; only its dead keys stay, as feature-305/306 seeded-unread', () => {
  const have = ids(baseline().findings.filter((f) => !(f.kind === 'seeded-unread' && /^feature (305|306)$/.test(f.owner))))
  assert.deepEqual(SWEEP_277.filter((id) => have.has(id)), [])
  assert.equal(SWEEP_277.filter((id) => id.startsWith('form-mismatch:')).length, 19)
})

test('baseline 4 the committed JSON carries no value text and no secret-class key', () => {
  const json = baseline()
  const ENTRY_FIELDS = new Set(['namespace', 'key', 'kind', 'owner', 'envs', 'file'])
  for (const f of json.findings) assert.deepEqual(Object.keys(f).filter((k) => !ENTRY_FIELDS.has(k)), [], `${f.namespace}/${f.key}`)
  assert.doesNotMatch(JSON.stringify(json), /"(value|value_data|value_encrypted|default)"\s*:/)
  const { secrets } = cw.storedSets(cw.loadStored(REPO).rows)
  assert.ok(secrets.size > 0, 'no secret rows in the stored JSON')
  assert.ok([...secrets.values()].every((r) => r.default_value === null), 'a secret row carries a default_value')
  const secretForms = new Set([...secrets.values()].flatMap((s) => [s.key, `${s.namespace}.${s.key}`]))
  assert.deepEqual(json.findings.filter((f) => secretForms.has(f.key)).map((f) => f.key), [])
})

function ciFilterGlobs(name) {
  const lines = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8').split('\n')
  const start = lines.findIndex((l) => l === `            ${name}:`)
  if (start < 0) return []
  const globs = []
  for (const l of lines.slice(start + 1)) {
    const m = /^ {14}- '([^']+)'$/.exec(l)
    if (!m) break
    globs.push(m[1])
  }
  return globs
}

const globRe = (g) => new RegExp(`^${g.split(/(\*\*\/|\*\*|\*)/).map((p) =>
  p === '**/' ? '(?:[^/]+/)*' : p === '**' ? '.*' : p === '*' ? '[^/]*' : p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('')}$`)

test('baseline 5 @AC-7 the CI config-wiring filter covers every file the extractors read', () => {
  const globs = ciFilterGlobs('config-wiring')
  for (const g of ['services/**/*.go', 'services/*/app/**/*.py', 'services/*/src/**/*.ts', 'services/*/src/**/*.tsx',
    'services/xstockstrat-config/migrations/**']) assert.ok(globs.includes(g), `filter lacks ${g}`)
  const { reads, dynamic } = cw.extractReads(REPO)
  const files = [...new Set([...reads, ...dynamic].map((r) => r.file))]
  assert.ok(files.includes('services/xstockstrat-marketdata/cmd/server/main.go'))
  const res = globs.map(globRe)
  assert.deepEqual(files.filter((f) => !res.some((re) => re.test(f))), [])
})

const skill = (rel) => fs.readFileSync(path.join(REPO, '.claude', 'skills', rel), 'utf8').replace(/\s+/g, ' ')
const between = (text, from, to) => {
  const a = text.indexOf(from)
  const b = text.indexOf(to, a + from.length)
  assert.ok(a >= 0 && b > a, `missing span ${from} .. ${to}`)
  return text.slice(a, b)
}
const before = (text, first, second) => {
  const a = text.indexOf(first)
  assert.ok(a >= 0, `missing: ${first}`)
  assert.ok(text.indexOf(second, a) > a, `${first} is not before ${second}`)
}

test('skill 1 @AC-4 @AC-5 @AC-10 sdd-execute Phase 3 gates the done flip and the code-completed flip', () => {
  const phase3 = between(skill('sdd-execute/SKILL.md'), '### PHASE 3: Execution', '### STEP COMMIT + PR')
  const gate = between(phase3, '**Config-key wiring gate.**', '4. If verification **passes**')
  before(phase3, "Run the step's `**Verification**`", '**Config-key wiring gate.**')
  before(phase3, 'node scripts/check-config-wiring.mjs --declared-from <FEATURE_DIR>/product-spec.md', '→ `**Status**: \\`done\\``')
  for (const trigger of ['typed `config`', 'inserts into `config.config_values`', '`## Config Key Changes` lists a key']) {
    assert.ok(gate.includes(trigger), `gate lacks trigger: ${trigger}`)
  }
  assert.match(gate, /a step that declares no key is not blocked/)
  before(phase3.slice(phase3.indexOf('If **all steps are now done**')), 'node scripts/check-config-wiring.mjs --final', '`code-completed`')
})

test('skill 2 @AC-4 @AC-10 sequential-mode mirrors the step-time gate (5.5) and --final before the integration PR (5.6)', () => {
  const seq = skill('sdd-execute/reference/sequential-mode.md')
  assert.ok(between(seq, '### 5.5 Step loop', '### 5.5b').includes('`node scripts/check-config-wiring.mjs`, step-time mode'))
  before(between(seq, '### 5.6 Per-feature integration PR', '### 5.7'), 'node scripts/check-config-wiring.mjs --final', 'create_pull_request')
})

test('skill 3 @AC-6 @AC-11 impl-spec B2 Config key wiring row carries clauses (a) and (b)', () => {
  const row = skill('sdd-review/reference/impl-spec-criteria.md').match(/\| Config key wiring \|[^|]*\|/)
  assert.ok(row, 'no Config key wiring row')
  for (const c of ['(a)', '(b)']) assert.ok(row[0].includes(c), `row lacks clause ${c}`)
  assert.match(row[0], /\(a\) no step names the reader file and symbol/)
  assert.match(row[0], /\(b\) no test builds a config snapshot from the seeded key/)
  assert.doesNotMatch(row[0], /backtick|stored-key quote/i)
})

test('skill 4 sdd-story pins the declared-key format read by --declared-from', () => {
  const section = between(skill('sdd-story/SKILL.md'), '## Config Key Changes', '## Database Changes')
  for (const s of ['one declared key per bullet', 'single backticked `<namespace>.<key>`', '--declared-from']) {
    assert.ok(section.includes(s), `declared-key format lacks: ${s}`)
  }
})

const DOC_C05 = path.join('docs', 'sdd', 'constitution.md')
const DOC_CONFIG9 = path.join('services', 'xstockstrat-config', 'docs', 'context-constitution.md')
const DOC_GOV = path.join('docs', 'patterns', 'config-governance.md')
const CONTRACT = 'namespace, key, `value_type`, code default, reader `path:symbol`, seed migration, live mechanism'
const C05_ROW = /^\| \*\*C-05\*\* \|/m
const rowOf = (text, id) => text.split('\n').find((l) => l.startsWith(`| **${id}** |`)) ?? ''
const ruleTexts = (root) => {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
  return { [DOC_C05]: rowOf(read(DOC_C05), 'C-05'), [DOC_CONFIG9]: rowOf(read(DOC_CONFIG9), 'CONFIG-9'), [DOC_GOV]: read(DOC_GOV) }
}

test('doc 1 @AC-20 C-05, CONFIG-9 and config-governance state the rule and carry no fixed-convention or 227 waiver text', () => {
  for (const [rel, text] of Object.entries(ruleTexts(REPO))) {
    assert.ok(text, `${rel}: rule text not found`)
    const flat = text.replace(/\s+/g, ' ').toLowerCase()
    for (const s of cw.DOC_RULE_SENTENCES) assert.ok(flat.includes(s), `${rel} lacks: ${s}`)
    assert.ok(!flat.includes('via the alias until'), `${rel} still carries the alias caveat`)
    assert.doesNotMatch(text, /the stored key equals the reader's exact spelling/i, `${rel} still carries the retired sentence`)
    assert.ok(!text.includes('NO fixed convention'), `${rel} still says NO fixed convention`)
    assert.doesNotMatch(text, /seeding waiver/i, `${rel} still carries the 227 seeding waiver`)
  }
})

test('doc 2 @AC-20 --doc-check exits 0 on the real tree', () => {
  const r = cli(REPO, '--doc-check')
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

// A scratch root holding every document --doc-check scans (three rule scopes plus the widened banned-phrase set).
const DOC_WIDE = ['CLAUDE.md', path.join('docs', 'runbooks', 'config-rollout.md')]
function scratchDocs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgwire-doc-'))
  const consumers = fs.readdirSync(path.join(REPO, 'services')).map((d) => path.join('services', d, 'CLAUDE.md')).filter((r) => fs.existsSync(path.join(REPO, r)))
  for (const rel of [DOC_C05, DOC_CONFIG9, DOC_GOV, ...DOC_WIDE, ...consumers]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.copyFileSync(path.join(REPO, rel), path.join(dir, rel))
  }
  return dir
}

test('doc 7 @AC-11 --doc-check fails naming a consumer CLAUDE.md that carries the alias caveat, and no CLAUDE.md carries the 296 transition note', () => {
  const dir = scratchDocs()
  assert.equal(cli(dir, '--doc-check').status, 0)
  const rel = path.join('services', 'xstockstrat-trading', 'CLAUDE.md')
  const file = path.join(dir, rel)
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}\nReaders may still use the prefixed spelling via the alias until a later feature.\n`)
  const r = cli(dir, '--doc-check')
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.ok((r.stdout + r.stderr).includes('services/xstockstrat-trading/CLAUDE.md'), r.stdout)
  for (const d of fs.readdirSync(path.join(REPO, 'services'))) {
    const p = path.join(REPO, 'services', d, 'CLAUDE.md')
    if (fs.existsSync(p)) assert.ok(!fs.readFileSync(p, 'utf8').includes('Target form is namespace-relative, cutover in feature 296'), p)
  }
})

test('doc 8 @AC-11 --doc-check skips a widened-scan document that does not exist', () => {
  const dir = scratchDocs()
  fs.rmSync(path.join(dir, 'docs', 'runbooks', 'config-rollout.md'))
  const r = cli(dir, '--doc-check')
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('doc 3 @AC-20 --doc-check fails naming the doc on a waiver or fixed-convention phrase; docs/reports is not read', () => {
  const dir = scratchDocs()
  fs.mkdirSync(path.join(dir, 'docs', 'reports'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs', 'reports', 'old.md'), 'NO fixed convention\nSeeding waiver (227 D2 precedent)\n')
  const clean = cli(dir, '--doc-check')
  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
  for (const [rel, phrase] of [[DOC_GOV, 'Seeding waiver (227 D2 precedent)'], [DOC_C05, 'NO fixed convention']]) {
    const file = path.join(dir, rel)
    const original = fs.readFileSync(file, 'utf8')
    fs.writeFileSync(file, rel === DOC_C05 ? original.replace(C05_ROW, `$& ${phrase};`) : `${original}\n${phrase}\n`)
    const r = cli(dir, '--doc-check')
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.ok((r.stdout + r.stderr).includes(rel.split(path.sep).join('/')), `output does not name ${rel}`)
    fs.writeFileSync(file, original)
  }
})

test('doc 6 @AC-11 --doc-check fails naming the document when the C-05 row still carries the old sentence', () => {
  const dir = scratchDocs()
  const file = path.join(dir, DOC_C05)
  const old = "| **C-05** | **Config key naming:** the stored key equals the reader's exact spelling, and every read key is seeded by a config migration. |"
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').map((l) => (C05_ROW.test(l) ? old : l)).join('\n'))
  const r = cli(dir, '--doc-check')
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.ok((r.stdout + r.stderr).includes('docs/sdd/constitution.md: missing rule sentence "the stored key is namespace-relative"'), r.stdout)
})

const claudeDoc = (rel) => fs.readFileSync(path.join(REPO, '.claude', rel), 'utf8').replace(/\s+/g, ' ')

test('doc 4 @AC-13 product-spec criterion 6 names the full config-key contract and fails a key listed without it', () => {
  const row = claudeDoc('skills/sdd-review/reference/product-spec-criteria.md').match(/\| 6 \| \*\*Config keys\*\* \|[^|]*\|/)
  assert.ok(row, 'no criterion 6 Config keys row')
  assert.ok(row[0].includes(CONTRACT), `criterion 6 lacks the contract: ${CONTRACT}`)
  assert.match(row[0], /without/i)
})

test('doc 5 @AC-13 story, spec, review, execute and agent docs require the same config-key contract', () => {
  for (const rel of [
    'skills/sdd-story/SKILL.md',
    'skills/sdd-spec/reference/spec-template.md',
    'skills/sdd-review/reference/impl-spec-criteria.md',
    'skills/sdd-execute/reference/repo-conventions.md',
    'agents/spec-reviewer.md',
    'agents/codebase-discovery.md',
  ]) {
    assert.ok(claudeDoc(rel).includes(CONTRACT), `.claude/${rel} lacks the config-key contract`)
  }
})

// ---- feature 305: evidence loader and dead-row verdict (pure functions; run() never calls them) ----
const DEAD = path.join(HERE, 'config-wiring-fixtures', 'dead')
const EVI = fs.readFileSync(path.join(DEAD, 'evidence.tsv'), 'utf8')
const EVI_UI = fs.readFileSync(path.join(DEAD, 'evidence-ui.tsv'), 'utf8')
const EVI_BINS = ['2026-11-03T06:00:00Z', '2026-11-03T12:00:00Z', '2026-11-03T18:00:00Z', '2026-11-04T00:00:00Z']
const row = (...cells) => cells.join('\t')
const without = (text, prefix) => text.split('\n').filter((l) => !l.startsWith(prefix)).join('\n')
const verdict = (text, ns, key) => {
  const e = cw.loadEvidence(text)
  return cw.deadRowVerdict({ ns, key }, e, e.subscribers)
}
const extra = (text, ...lines) => text + lines.join('\n') + '\n'

test('dead 1a @AC-1 no hit and full coverage judges both signed keys dead', () => {
  assert.equal(verdict(EVI, 'analysis', 'opportunity.sparkline_bars'), 'dead')
  assert.equal(verdict(EVI, 'marketdata', 'alpaca.paper'), 'dead')
})

test('dead 1b @AC-3 a subscriber missing one 6 h bin keeps the row', () => {
  const gap = row('coverage', 'analysis', 'marketdata', EVI_BINS[1], '2')
  assert.ok(EVI.includes(gap))
  assert.equal(verdict(EVI.replace(gap + '\n', ''), 'marketdata', 'alpaca.paper'), 'kept:missing-coverage')
})

test('dead 1c @AC-4 a ui receiver on the namespace is never proven dead', () => {
  assert.equal(verdict(EVI_UI, 'ui', 'fixture.unread'), 'kept:ui-reader')
})

test('dead 1d @AC-5 a hit in either spelling keeps the row; a hit in another namespace does not', () => {
  const prefixed = row('read-hit', 'analysis', 'analysis', 'analysis.opportunity.sparkline_bars', '1')
  assert.equal(verdict(extra(EVI, prefixed), 'analysis', 'opportunity.sparkline_bars'), 'kept:read-hit')
  const relative = row('read-hit', 'analysis', 'analysis', 'opportunity.sparkline_bars', '1')
  assert.equal(verdict(extra(EVI, relative), 'analysis', 'opportunity.sparkline_bars'), 'kept:read-hit')
  const other = row('read-hit', 'analysis', 'marketdata', 'opportunity.sparkline_bars', '1')
  assert.equal(verdict(extra(EVI, other), 'analysis', 'opportunity.sparkline_bars'), 'dead')
})

test('dead 1e verdict order: missing coverage outranks list-receiver; a covered list subscriber keeps the row', () => {
  const list = (cover) => extra(EVI, row('subscriber', 'sidecar', 'marketdata', 'list'), row('keys', 'sidecar', 'marketdata', '0'),
    ...EVI_BINS.slice(0, cover).map((b) => row('coverage', 'sidecar', 'marketdata', b, '1')))
  assert.equal(verdict(list(4), 'marketdata', 'alpaca.paper'), 'kept:list-receiver')
  assert.equal(verdict(list(3), 'marketdata', 'alpaca.paper'), 'kept:missing-coverage')
})

test('dead 1f the loader rejects each malformed evidence input with its pinned message', () => {
  const win = EVI.split('\n')[0]
  const cov = row('coverage', 'analysis', 'analysis', EVI_BINS[0], '2')
  const bad = (text, re) => assert.throws(() => cw.loadEvidence(text), (e) => re.test(e.message) && e.message.startsWith('evidence:'), re.source)
  assert.equal(cw.loadEvidence(EVI).window.bins.length, 4)
  bad(extra(EVI, row('bogus', 'x')), /unknown kind/)
  bad(extra(EVI, row('subscriber', 'x', 'y')), /expects 4 cells/)
  bad(extra(EVI, cov), /duplicate coverage row/)
  bad(extra(EVI, win), /second window row/)
  bad(without(EVI, 'window'), /missing window row/)
  bad(EVI.replace(win, win.replace('21600', '3600')), /window/)
  bad(extra(EVI, row('coverage', 'analysis', 'analysis', '2026-11-03T07:00:00Z', '1')), /is off the 6 h grid or outside the window/)
  bad(extra(EVI, row('coverage', 'analysis', 'analysis', '2026-11-04T06:00:00Z', '1')), /is off the 6 h grid or outside the window/)
  bad(EVI.replace(cov, row('coverage', 'analysis', 'analysis', EVI_BINS[0], '0')), /count must be a positive integer/)
  bad(without(EVI, 'subscriber'), /no subscriber rows/)
  bad(without(EVI, 'keys\tmarketdata\tmarketdata'), /positive control: missing keys row for marketdata\/marketdata/)
  bad(EVI.replace(row('keys', 'marketdata', 'marketdata', '1'), row('keys', 'marketdata', 'marketdata', '2')),
    /positive control: marketdata\/marketdata has 1 distinct read-hit keys but its last coverage line logged keys=2/)
})

test('dead 1g subscribersOf derives class and service from the registry; the verdict never suppresses a seeded-unread finding', () => {
  const rec = {
    'services/xstockstrat-analysis/app/a.py:w': 'analysis',
    'services/xstockstrat-trading/internal/s.go:cfg': ['trading', 'platform'],
    'services/xstockstrat-ui/src/lib/x.ts:values': 'ui',
    'services/xstockstrat-analysis/app/b.py:w2': 'analysis',
  }
  assert.deepEqual(cw.subscribersOf(rec), [
    { service: 'analysis', ns: 'analysis', class: 'single' },
    { service: 'trading', ns: 'platform', class: 'list' },
    { service: 'trading', ns: 'trading', class: 'list' },
    { service: 'ui', ns: 'ui', class: 'ui' },
  ])
  const dir = fresh('seeded-unread')
  const evi = [row('window', '2026-11-03T00:00:00Z', '2026-11-04T00:00:00Z', '21600', 'deployment_environment="staging"'), row('subscriber', 'ledger', 'ledger', 'single'),
    ...EVI_BINS.map((b) => row('coverage', 'ledger', 'ledger', b, '1')), row('keys', 'ledger', 'ledger', '0')].join('\n') + '\n'
  assert.equal(verdict(evi, 'ledger', 'ledger.no.reader'), 'dead')
  fs.mkdirSync(path.join(dir, 'scripts', 'config-heal'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'scripts', 'config-heal', 'dead-row-evidence.tsv'), evi)
  const r = cli(dir, '--final')
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(lines(r), [`${STORED_LINE}:ledger/ledger.no.reader:seeded-unread`])
})
