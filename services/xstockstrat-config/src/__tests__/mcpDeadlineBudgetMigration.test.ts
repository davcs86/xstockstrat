// @AC-1 / @AC-2 (feature 314): *_mcp_deadline_budget seeds the extract budget, clamps global read timeouts above 44,
// notifies, and its down deletes only the seed. The real-DB assertion's PREPARE copy must equal the up's clamp.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MIGRATIONS_DIR, findOne, splitStatements } from './migrationSql';

const SUFFIX = '_mcp_deadline_budget';
const ASSERTION_FILE = path.resolve(
  __dirname,
  '../../../../scripts/migration-assertions/config-mcp-deadline-budget.sql',
);
const SENTINEL = 'system:config-migration-feature-fix-mcp-deadline-budget';
const SEED_KEY = 'extract.call_budget_seconds';
const CLAMP_KEY = 'opportunities.read_timeout_seconds';
const CROSS_HOP_KEYS = [
  'marketdata.quote_timeout_ms',
  'quotes.batch_timeout_ms',
  'quotes.mark_timeout_ms',
  'price.batch_timeout_ms',
  'opportunity.live_enrich_timeout_ms',
];
const LIT = "'((?:[^']|'')*)'";
const SEED_COLUMNS =
  '(namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)';
const ON_CONFLICT = "ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING";
const RETURNING = 'RETURNING namespace, environment';
const CLAMP_START = 'UPDATE config.config_values';
const NOTIFY_SELECT =
  "SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text)";
const UP_NOTIFY_SOURCE =
  'FROM (SELECT DISTINCT namespace, environment FROM (SELECT namespace, environment FROM seed UNION ALL SELECT namespace, environment FROM heal) u) t';
const UP_FINAL_SELECT =
  'SELECT (SELECT count(*) FROM seed) AS seeded, (SELECT count(*) FROM heal) AS clamped, (SELECT count(*) FROM nt) AS notified';
const DOWN_TAIL = `${NOTIFY_SELECT} FROM (SELECT DISTINCT namespace, environment FROM d) t`;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

interface Loaded {
  upRaw: string;
  up: string[];
  down: string[];
}

// Loaded inside each `it`: node 22 exits 0 when a describe callback throws, which would hide RED.
let loaded: Loaded | undefined;
function load(): Loaded {
  if (!loaded) {
    const upRaw = findOne(SUFFIX, 'up');
    loaded = {
      upRaw,
      up: splitStatements(upRaw),
      down: splitStatements(findOne(SUFFIX, 'down')),
    };
  }
  return loaded;
}

function clampStatement(stmt: string): string {
  const m = new RegExp(`heal AS \\( (${esc(CLAMP_START)} .*? ${esc(RETURNING)}) \\)`).exec(stmt);
  assert.ok(m, `no heal CTE in: ${stmt}`);
  return m[1];
}

describe('MCP deadline budget migration (@AC-1, @AC-2, feature 314)', () => {
  it('is one statement per direction', () => {
    const { up, down } = load();
    assert.equal(up.length, 1);
    assert.equal(down.length, 1);
  });

  it('@AC-1 seeds the global staging + production extract budget at 35', () => {
    const { up } = load();
    const s = up[0];
    assert.ok(
      s.startsWith(`WITH seed AS ( INSERT INTO config.config_values ${SEED_COLUMNS} VALUES`),
      s,
    );
    assert.ok(s.includes(`${ON_CONFLICT} ${RETURNING} ), heal AS (`), 'seed conflict target');
    const rows = [
      ...s.matchAll(
        new RegExp(
          `\\('agent', '${esc(SEED_KEY)}', 'float', '35', ${LIT}, '35', 'xstockstrat-agent', '${esc(SENTINEL)}', '(staging|production)', NULL\\)`,
          'g',
        ),
      ),
    ];
    assert.equal(rows.length, 2, 'expected exactly the staging + production seed rows');
    assert.deepEqual(rows.map((r) => r[2]).sort(), ['production', 'staging']);
    assert.ok(rows[0][1].trim().length > 0, 'empty description');
    assert.equal(rows[0][1], rows[1][1], 'staging/production descriptions differ');
    assert.ok(!s.includes(`'agent.${SEED_KEY}'`), 'prefixed key');
  });

  it('@AC-2 clamps only global, non-secret, numeric read timeouts above 44 to 44', () => {
    const { up } = load();
    const c = clampStatement(up[0]);
    assert.match(
      c,
      new RegExp(
        `^UPDATE config\\.config_values SET value_data = '44', updated_by = '${esc(SENTINEL)}', update_reason = '[^']+', caller_identity = NULL WHERE `,
      ),
    );
    assert.ok(c.includes(`WHERE namespace = 'agent' AND key = '${CLAMP_KEY}' AND user_id IS NULL`));
    assert.ok(c.includes('AND NOT is_secret AND CASE WHEN'));
    const guard =
      /CASE WHEN value_data ~ '([^']+)' THEN value_data::numeric > 44 ELSE false END/.exec(c);
    assert.ok(guard, `no CASE-guarded cast in: ${c}`);
    const re = new RegExp(guard[1]);
    for (const v of ['55', '44.5', '+45', '.5', '45.', '4.5e1', '1E2']) assert.match(v, re);
    for (const v of ['abc', '50s', '', '1e1234', 'Infinity', 'NaN', '4 5'])
      assert.doesNotMatch(v, re);
  });

  it('@AC-2 changes no other key: no inverted-pair heal, no delete', () => {
    const { up } = load();
    const s = up[0];
    assert.equal(s.split('UPDATE ').length - 1, 1, 'more than one UPDATE');
    assert.doesNotMatch(s, /DELETE/i);
    for (const k of CROSS_HOP_KEYS) assert.ok(!s.includes(k), `cross-hop key ${k} appears`);
    const keys = new Set(
      [...s.matchAll(/'(?:agent)', '([^']+)'|key = '([^']+)'/g)].map((m) => m[1] ?? m[2]),
    );
    assert.deepEqual([...keys].sort(), [SEED_KEY, CLAMP_KEY].sort());
  });

  it('@AC-2 notifies the distinct seed and heal (namespace, environment) pairs, forced by the final SELECT', () => {
    const { up } = load();
    const s = up[0];
    assert.ok(s.includes(`${ON_CONFLICT} ${RETURNING}`));
    assert.ok(
      s.includes(
        `ELSE false END ${RETURNING} ), nt AS ( ${NOTIFY_SELECT} AS sent ${UP_NOTIFY_SOURCE} )`,
      ),
      s,
    );
    assert.ok(s.endsWith(UP_FINAL_SELECT), `final SELECT does not force the notify CTE: ${s}`);
  });

  it('down deletes only the sentinel seed rows, never reverses the clamp, and notifies', () => {
    const { down } = load();
    const d = down[0];
    assert.ok(d.startsWith('WITH d AS ( DELETE FROM config.config_values WHERE'), d);
    for (const g of [
      "namespace = 'agent'",
      `key = '${SEED_KEY}'`,
      "value_data = '35'",
      'user_id IS NULL',
      "environment IN ('staging', 'production')",
      `updated_by = '${SENTINEL}'`,
    ]) {
      assert.ok(d.includes(g), `down lacks ${g}`);
    }
    assert.ok(d.includes(`${RETURNING} )`));
    assert.doesNotMatch(d, /\b(UPDATE|INSERT)\b/i);
    assert.ok(!d.includes(CLAMP_KEY), 'down references the clamped key');
    assert.ok(d.endsWith(DOWN_TAIL), `down does not end with the DISTINCT notify: ${d}`);
  });

  it('carries no migration number in its SQL', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(`${SUFFIX}.up.sql`));
    assert.equal(files.length, 1);
    const num = files[0].slice(0, files[0].indexOf('_'));
    for (const ext of ['up', 'down'] as const) {
      assert.doesNotMatch(
        findOne(SUFFIX, ext),
        new RegExp(`(?<!\\d)${num}(?!\\d)`),
        `${ext} names ${num}`,
      );
    }
  });

  it('pins the assertion file PREPARE copy to the up clamp', () => {
    const { upRaw } = load();
    const text = fs.readFileSync(ASSERTION_FILE, 'utf8');
    const prepared = /PREPARE mdb_clamp AS\s([\s\S]*?);/.exec(text);
    assert.ok(prepared, 'no PREPARE mdb_clamp in the assertion file');
    const at = upRaw.indexOf(CLAMP_START);
    assert.notEqual(at, -1, 'no clamp UPDATE in the up');
    const source = upRaw.slice(at, upRaw.indexOf(RETURNING, at) + RETURNING.length);
    assert.equal(collapse(prepared[1]), collapse(source), 'PREPARE copy drifted from the up clamp');
    assert.ok(text.includes('EXECUTE mdb_clamp;'), 'the copy is never executed');
    const body = text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .trim();
    assert.ok(body.startsWith('BEGIN;'), 'assertion file does not start with BEGIN;');
    assert.ok(body.endsWith('ROLLBACK;'), 'assertion file does not end with ROLLBACK;');
  });
});
