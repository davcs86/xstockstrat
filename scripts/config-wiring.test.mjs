import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { buildStoredSet } from './check-config-wiring.mjs'

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
    assert.equal(r.status, 0, r.stderr)
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
  let r = cli(dir)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /002_delete\.up\.sql:.*:unmodelled-rewrite/)

  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  const registry = { forwarders: {}, dynamic: {}, rewriteAllow: [{ file: u.file, sha256: u.sha256, reason: 'fixture' }] }
  fs.writeFileSync(path.join(dir, 'scripts', 'config-wiring.json'), JSON.stringify({ registry }))
  r = cli(dir)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(buildStoredSet(dir).unmodelled, [])

  const sql = path.join(dir, MIG, '002_delete.up.sql')
  fs.writeFileSync(sql, fs.readFileSync(sql, 'utf8').replace("'staging'", "'production'"))
  r = cli(dir)
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

test('CLI usage errors exit 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /config-wiring:/)
})
