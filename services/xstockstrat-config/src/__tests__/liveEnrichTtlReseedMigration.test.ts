/**
 * @AC-1 (feature 330): the *_analysis_live_enrich_ttl_reseed migration moves only the seeded global '10'
 * live-enrich memo TTL to '20' (above the 15s UI poll), stamps the actor columns on the value branch only,
 * fires the config_changed notify, and its down reverts only rows still carrying the 330 sentinel.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findOne, splitStatements } from './migrationSql';

const SUFFIX = '_analysis_live_enrich_ttl_reseed';
const SENTINEL = 'system:config-migration-feature-330';
const KEY = 'opportunity.live_enrich_ttl_seconds';
const UI_POLL_SECONDS = 15;
const LIT = "'((?:[^']|'')*)'";
const FORBIDDEN = [/INSERT/i, /DELETE/i, /default_value/i, /SET\s+key/i];
const ACTOR_COLUMNS = ['updated_by', 'update_reason', 'caller_identity'];
const NOTIFY_CTE =
  "nt AS ( SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'key', t.key, 'environment', t.environment, 'user_id', NULL)::text)";
const NOTIFY_SOURCE = 'FROM (SELECT DISTINCT namespace, key, environment FROM u) t';
const FINAL_SELECT =
  'SELECT (SELECT count(*) FROM u) AS updated, (SELECT count(*) FROM nt) AS notified';
const DOWN_GUARD = `v.value_data = '20' AND v.updated_by = '${SENTINEL}'`;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function seededOldDescription(): string {
  const seed = splitStatements(findOne('_analysis_opportunity_keys', 'up')).join(' ');
  const re = new RegExp(
    `'analysis\\.opportunity\\.live_enrich_ttl_seconds', 'int', '10', ${LIT}, '10', 'xstockstrat-analysis', '(staging|production)'`,
    'g',
  );
  const rows = [...seed.matchAll(re)];
  assert.equal(rows.length, 2, 'expected the staging + production 028 seed rows at value 10');
  assert.deepEqual(rows.map((r) => r[2]).sort(), ['production', 'staging']);
  assert.equal(rows[0][1], rows[1][1], '028 staging/production descriptions differ');
  return rows[0][1];
}

function setClause(stmt: string): string {
  const m = /\bSET (.*?) WHERE v\.namespace/.exec(stmt);
  assert.ok(m, `no SET … WHERE clause in: ${stmt}`);
  return m[1];
}

interface Loaded {
  up: string[];
  down: string[];
  OLD: string;
}

// Loaded inside each `it`: node 22 exits 0 when a describe callback throws, which would hide RED.
let loaded: Loaded | undefined;
function load(): Loaded {
  loaded ??= {
    up: splitStatements(findOne(SUFFIX, 'up')),
    down: splitStatements(findOne(SUFFIX, 'down')),
    OLD: seededOldDescription(),
  };
  return loaded;
}

function newDescription(): string {
  const { up, OLD } = load();
  const m = new RegExp(
    `description = CASE WHEN v\\.description = '${esc(OLD)}' THEN ${LIT} ELSE v\\.description END`,
  ).exec(up[0]);
  assert.ok(m, 'up has no description CASE guarded on the 028 text');
  return m[1];
}

describe('live-enrich TTL reseed migration (@AC-1, feature 330)', () => {
  it('@AC-1 is one guarded UPDATE CTE per direction with no insert, delete or default_value write', () => {
    const { up, down } = load();
    assert.equal(up.length, 1);
    assert.equal(down.length, 1);
    for (const s of [up[0], down[0]]) {
      assert.ok(s.startsWith('WITH u AS ( UPDATE config.config_values v SET'), s);
      for (const re of FORBIDDEN) assert.doesNotMatch(s, re, `forbidden ${re} in: ${s}`);
    }
  });

  it('@AC-1 targets the namespace-relative global staging/production rows only', () => {
    const { up, down } = load();
    for (const s of [up[0], down[0]]) {
      assert.ok(s.includes("v.namespace = 'analysis'"));
      assert.ok(s.includes(`v.key = '${KEY}'`));
      assert.ok(s.includes('v.user_id IS NULL'));
      assert.ok(s.includes("v.environment IN ('staging', 'production')"));
      assert.ok(!s.includes("'analysis.opportunity.live_enrich_ttl_seconds'"), 'prefixed key');
    }
  });

  it('@AC-1 moves only the seeded 10 to a TTL above the 15s UI poll', () => {
    const { up } = load();
    const m =
      /value_data = CASE WHEN v\.value_data = '10' THEN '(\d+)' ELSE v\.value_data END/.exec(up[0]);
    assert.ok(m, 'up has no guarded value CASE');
    assert.equal(m[1], '20');
    assert.ok(Number(m[1]) > UI_POLL_SECONDS);
  });

  it('@AC-1 rewrites the description only where it is still the verbatim 028 text', () => {
    const { up, OLD } = load();
    const NEW = newDescription();
    assert.notEqual(NEW, OLD);
    assert.ok(!NEW.includes(';'), 'new description contains ;');
    assert.ok(!NEW.includes('sparkline'), 'new description still names the sparkline');
    assert.ok(up[0].includes(`(v.value_data = '10' OR v.description = '${OLD}')`));
  });

  it('@AC-1 stamps the actor columns on the value branch only', () => {
    const { up, down } = load();
    assert.ok(
      up[0].includes(
        `updated_by = CASE WHEN v.value_data = '10' THEN '${SENTINEL}' ELSE v.updated_by END`,
      ),
    );
    assert.ok(
      up[0].includes(
        "caller_identity = CASE WHEN v.value_data = '10' THEN NULL ELSE v.caller_identity END",
      ),
    );
    assert.match(
      up[0],
      /update_reason = CASE WHEN v\.value_data = '10' THEN '[^';]+' ELSE v\.update_reason END/,
    );
    for (const s of [up[0], down[0]]) {
      const set = setClause(s);
      const assignments = [
        ...set.matchAll(/(?<![.\w])(updated_by|update_reason|caller_identity) = (\S+ \S+)/g),
      ];
      assert.equal(assignments.length, ACTOR_COLUMNS.length, `actor assignments in: ${set}`);
      for (const a of assignments) assert.equal(a[2], 'CASE WHEN', `unguarded ${a[1]} assignment`);
    }
  });

  it('@AC-1 fires the four-field config_changed notify, forced by the final SELECT', () => {
    const { up, down } = load();
    for (const s of [up[0], down[0]]) {
      assert.ok(s.includes(NOTIFY_CTE), `no notify CTE in: ${s}`);
      assert.ok(s.includes(NOTIFY_SOURCE));
      assert.ok(s.endsWith(FINAL_SELECT), `final SELECT does not force the notify CTE: ${s}`);
    }
  });

  it('@AC-1 down reverts only the sentinel rows at 20 and the 330 description', () => {
    const { down, OLD } = load();
    const NEW = newDescription();
    const d = down[0];
    assert.ok(d.includes(`value_data = CASE WHEN ${DOWN_GUARD} THEN '10' ELSE v.value_data END`));
    assert.ok(
      d.includes(
        `description = CASE WHEN v.description = '${NEW}' THEN '${OLD}' ELSE v.description END`,
      ),
    );
    assert.ok(d.includes(`((${DOWN_GUARD}) OR v.description = '${NEW}')`));
    for (const col of ACTOR_COLUMNS) {
      assert.match(
        setClause(d),
        new RegExp(
          `(?<![.\\w])${col} = CASE WHEN ${esc(DOWN_GUARD)} THEN (?:'[^']*'|NULL) ELSE v\\.${col} END`,
        ),
        `down ${col} is not guarded on the sentinel value branch`,
      );
    }
  });

  it('@AC-1 carries no ; outside the single statement terminator', () => {
    for (const ext of ['up', 'down'] as const) {
      const body = findOne(SUFFIX, ext)
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim();
      assert.equal(body.split(';').length - 1, 1, `${ext}: ; inside a literal`);
      assert.ok(body.endsWith(';'), `${ext}: does not end with the statement terminator`);
    }
  });
});
